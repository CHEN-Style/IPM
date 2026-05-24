// desktop/Agent/pi-runtime/tools/webTools.js
//
// KnowClaw customTools for web access. Registers two tools:
//
//   1. `search_web` (K1) — Bocha Web Search API. Falls back to a
//      descriptive prompt that asks the model to request a URL from the
//      user and call `fetch_web` instead.
//
//   2. `fetch_web` (Phase-6 + K1 upgrade) — fetch a single URL. Default
//      is the lightweight Node `fetch` + HTML strip pipeline. When the
//      caller passes `rendered: true` and the `fetchWebRendered` bridge
//      is available (provided by main process via `toolDeps`), goes
//      through F2's hidden BrowserWindow + Readability + Turndown
//      pipeline for JS-heavy pages, returning Markdown. Falls back to
//      Node fetch when the bridge is unavailable or the rendered call
//      fails — KnowClaw never silently loses access to the URL.
//
// Design constraints (same as projectTools.js):
//
// 1. ESM file loaded by Node directly. No imports from
//    `desktop/Agent/supervisor/*` or `desktop/Agent/db/*` (those are
//    ESM-syntax-but-CJS-defaulted and only reachable through the Vite
//    bundle).
//
// 2. `execute()` returns the `AgentToolResult` shape:
//        { content: [{ type: 'text', text }], details: T }
//
// 3. Network only depends on Node global `fetch` (Node >= 18). The F2
//    rendered pipeline is wired in from the main process via
//    `fetchWebRendered` so this file stays Electron-free.

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { bochaWebSearch } from '../../services/searchService.js';

const MAX_RESPONSE_SIZE = 200_000;
const FETCH_TIMEOUT_MS = 30_000;
const RENDERED_TIMEOUT_MS = 45_000;

function textResult(text) {
  return {
    content: [{ type: 'text', text: String(text ?? '') }],
    details: null,
  };
}

function stripHtmlTags(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[... 截断, 原始长度 ${text.length} 字符]`;
}

// ---------------------------------------------------------------------
// search_web — Bocha-backed structured web search
// ---------------------------------------------------------------------

const SEARCH_NOT_CONFIGURED_HINT = [
  '搜索 API 未配置（设置 → 网页搜索 API）。',
  '',
  '建议：',
  '1. 请用户提供具体的网页 URL，然后调用 fetch_web 抓取内容；',
  '2. 或者请用户前往「设置」配置博查 (Bocha) 搜索 API Key，新用户可免费获得 1000 次额度。',
].join('\n');

function describeSearchFailure(errorType, errorMessage) {
  const baseHint = '\n\n建议：请用户提供具体网页 URL，然后调用 fetch_web 抓取。';
  switch (errorType) {
    case 'unauthorized':
      return `搜索 API Key 无效或未授权（${errorMessage || ''}）。请用户在「设置 → 网页搜索 API」中检查 API Key。${baseHint}`;
    case 'quota':
      return `搜索 API 额度不足或已被限流（${errorMessage || ''}）。请用户在博查开放平台充值或稍后重试。${baseHint}`;
    case 'timeout':
      return `搜索请求超时（${errorMessage || ''}）。可能是网络不稳定。${baseHint}`;
    case 'network':
      return `搜索网络请求失败（${errorMessage || ''}）。${baseHint}`;
    case 'parse':
      return `搜索响应异常（${errorMessage || ''}）。${baseHint}`;
    default:
      return `搜索暂时不可用（${errorMessage || '未知错误'}）。${baseHint}`;
  }
}

function formatSearchResults(query, results) {
  if (!results.length) {
    return `搜索词「${query}」没有返回结果。建议换个关键词，或者请用户提供具体网页 URL 后用 fetch_web 抓取。`;
  }
  const lines = [`搜索词：${query}`, `结果数：${results.length}`, ''];
  results.forEach((r, idx) => {
    const num = idx + 1;
    const title = r.title || '(无标题)';
    lines.push(`${num}. [${title}](${r.url})`);
    const desc = (r.summary || r.snippet || '').replace(/\s+/g, ' ').trim();
    if (desc) lines.push(`   摘要：${truncate(desc, 400)}`);
    const meta = [];
    if (r.siteName) meta.push(`来源：${r.siteName}`);
    if (r.datePublished) meta.push(`发布：${r.datePublished.slice(0, 10)}`);
    if (meta.length) lines.push(`   ${meta.join(' | ')}`);
    lines.push('');
  });
  lines.push('提示：可以挑选最相关的 URL，调用 fetch_web 获取该页面的完整内容。');
  return lines.join('\n');
}

function buildSearchWebTool({ searchApiKey }) {
  const hasKey = Boolean(searchApiKey && String(searchApiKey).trim());
  const usageGuideline = [
    'search_web 用于联网检索全网信息（新闻、百科、案例、官方文档等）。',
    '何时使用：用户问题涉及实时信息、外部资料、背景调查、行业现状、法律法规检索等。',
    '使用步骤：先 search_web(query) 拿到候选 URL → 再用 fetch_web(url) 抓取相关页面的完整正文。',
    '降级处理：如果工具返回"搜索 API 未配置/不可用/额度不足"，请向用户说明情况，并请用户提供具体的网页 URL，再用 fetch_web 抓取。',
  ].join(' ');

  return defineTool({
    name: 'search_web',
    label: 'Search Web',
    description: hasKey
      ? '通过博查 (Bocha) 搜索 API 检索全网信息，返回带标题、URL、摘要、来源的搜索结果列表。'
      : '搜索全网信息（当前未配置 API Key，将返回降级提示，引导你向用户索取 URL）。',
    promptSnippet:
      'search_web: 联网搜索，返回标题/URL/摘要/来源；不可用时引导用户提供 URL 并用 fetch_web 抓取。',
    promptGuidelines: [usageGuideline],
    parameters: Type.Object({
      query: Type.String({
        minLength: 1,
        description: '搜索词（自然语言，可包含 site: 等高级语法）。',
      }),
      count: Type.Optional(Type.Number({
        description: '返回结果条数 (1-20，默认 8)。',
      })),
      freshness: Type.Optional(Type.String({
        description: '时间过滤：noLimit / oneDay / oneWeek / oneMonth / oneYear，或 YYYY-MM-DD..YYYY-MM-DD。默认 noLimit。',
      })),
    }),
    async execute(_toolCallId, params, signal) {
      const query = String(params?.query || '').trim();
      if (!query) return textResult('错误: 必须提供 query 参数。');

      if (!hasKey) {
        return textResult(SEARCH_NOT_CONFIGURED_HINT);
      }

      const count = typeof params?.count === 'number' ? Math.min(Math.max(Math.floor(params.count), 1), 20) : 8;
      const freshness = typeof params?.freshness === 'string' ? params.freshness : undefined;

      try {
        const res = await bochaWebSearch(searchApiKey, query, {
          count,
          freshness,
          summary: true,
          signal,
        });
        if (!res.ok) {
          return textResult(describeSearchFailure(res.errorType, res.error));
        }
        return textResult(formatSearchResults(query, res.results || []));
      } catch (e) {
        return textResult(describeSearchFailure('unknown', e?.message || String(e)));
      }
    },
  });
}

// ---------------------------------------------------------------------
// fetch_web — single-URL fetch with optional F2 rendered pipeline
// ---------------------------------------------------------------------

async function fetchSimpleViaNode(url, params, signal) {
  const maxLength = typeof params?.maxLength === 'number' ? params.maxLength : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const onHostAbort = () => controller.abort();
  if (signal && typeof signal.addEventListener === 'function') {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onHostAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'IPM-KnowClaw/1.0',
        'Accept': 'text/html, application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      return { ok: false, text: `HTTP ${response.status} ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (
      contentType.includes('image') ||
      contentType.includes('video') ||
      contentType.includes('audio')
    ) {
      return { ok: false, text: `该 URL 返回的是媒体内容 (${contentType})，无法以文本形式展示。` };
    }

    let text = await response.text();
    const limit = Math.min(maxLength || MAX_RESPONSE_SIZE, MAX_RESPONSE_SIZE);
    text = truncate(text, limit);
    if (contentType.includes('text/html')) {
      text = stripHtmlTags(text);
    }
    return { ok: true, text };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { ok: false, text: `请求超时或被取消 (${FETCH_TIMEOUT_MS / 1000}s 上限)` };
    }
    return { ok: false, text: `网络请求失败: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
    if (signal && typeof signal.removeEventListener === 'function') {
      try { signal.removeEventListener('abort', onHostAbort); } catch { /* ignore */ }
    }
  }
}

async function fetchRenderedViaBridge(url, params, signal, fetchWebRendered) {
  const maxLength = typeof params?.maxLength === 'number' ? params.maxLength : undefined;
  const timer = setTimeout(() => { /* upper bound; webFetch has its own */ }, RENDERED_TIMEOUT_MS);
  try {
    // Race against external abort signal so an aborted tool call doesn't
    // wait for the BrowserWindow render to finish.
    const renderPromise = fetchWebRendered(url, { signal });
    let result;
    if (signal && typeof signal.addEventListener === 'function') {
      result = await new Promise((resolve, reject) => {
        const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        renderPromise.then(
          (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
          (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
        );
      });
    } else {
      result = await renderPromise;
    }

    if (!result || !result.ok) {
      return { ok: false, error: result?.error || '渲染抓取失败（未知原因）' };
    }
    let body = result.markdown || result.textContent || '';
    body = String(body || '').trim();
    if (!body) {
      return { ok: false, error: '渲染结果为空' };
    }
    const limit = Math.min(maxLength || MAX_RESPONSE_SIZE, MAX_RESPONSE_SIZE);
    body = truncate(body, limit);

    const lines = [];
    if (result.title) lines.push(`# ${result.title}`);
    if (result.url) lines.push(`URL: ${result.url}`);
    if (result.siteName) lines.push(`Site: ${result.siteName}`);
    if (lines.length) lines.push('');
    lines.push(body);
    return { ok: true, text: lines.join('\n') };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { ok: false, error: '渲染请求被取消' };
    }
    return { ok: false, error: `渲染抓取异常: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}

function buildFetchWebTool({ fetchWebRendered }) {
  const hasBridge = typeof fetchWebRendered === 'function';
  const usageGuideline = [
    '使用 fetch_web 抓取单个 URL（网页或 HTTP API）。',
    '默认走轻量级 HTTP 抓取（~1-2 秒），适合普通静态页面或 JSON 接口。',
    '若页面是 SPA / 单页应用 / 内容由 JS 动态生成（如 React 站、Twitter、知乎热点），请加上 `rendered: true`，会用浏览器内核完整渲染后再提取 Markdown 正文（耗时 ~5-10 秒）。',
    '降级链路：rendered 模式失败会自动 fallback 到简单 HTTP 抓取。',
  ].join(' ');

  return defineTool({
    name: 'fetch_web',
    label: 'Fetch URL',
    description:
      'Fetch content from a URL. Default mode strips HTML tags and returns plain text. Pass `rendered: true` to run the page through a full browser engine and return Readability-extracted Markdown (handles JS-heavy SPAs). Times out after 30s (45s for rendered) and truncates responses to ~200 KB.',
    promptSnippet:
      'fetch_web: 抓取单个 URL 内容。普通页面用默认模式；JS 动态渲染的复杂页面加 rendered:true（更慢但能拿到完整正文）。',
    promptGuidelines: [usageGuideline],
    parameters: Type.Object({
      url: Type.String({
        minLength: 1,
        description: '要抓取的 URL，必须包含协议（如 https://example.com）。',
      }),
      rendered: Type.Optional(Type.Boolean({
        description: '是否使用浏览器内核渲染后再抓取。默认 false（HTTP GET + HTML strip）。设为 true 适合 SPA / JS 动态页面，会返回 Markdown 正文。',
      })),
      maxLength: Type.Optional(Type.Number({
        description: `返回内容的最大字符数（默认 ${MAX_RESPONSE_SIZE}，硬上限也是 ${MAX_RESPONSE_SIZE}）。`,
      })),
    }),
    async execute(_toolCallId, params, signal) {
      const url = String(params?.url || '').trim();
      if (!url) return textResult('错误: 必须提供 url 参数。');

      try {
        new URL(url);
      } catch {
        return textResult(`无效的 URL: ${url}`);
      }

      const wantRendered = Boolean(params?.rendered);

      if (wantRendered) {
        if (!hasBridge) {
          const simple = await fetchSimpleViaNode(url, params, signal);
          const prefix = '[rendered 模式不可用，已自动降级到普通 HTTP 抓取]\n\n';
          return textResult(prefix + simple.text);
        }
        const rendered = await fetchRenderedViaBridge(url, params, signal, fetchWebRendered);
        if (rendered.ok) {
          return textResult(rendered.text);
        }
        // 渲染失败 → 自动降级到 Node fetch，并在结果前标注 fallback 原因。
        const simple = await fetchSimpleViaNode(url, params, signal);
        const prefix = `[rendered 模式失败：${rendered.error}；已自动降级到普通 HTTP 抓取]\n\n`;
        return textResult(prefix + simple.text);
      }

      const simple = await fetchSimpleViaNode(url, params, signal);
      return textResult(simple.text);
    },
  });
}

/**
 * Build the array of web-related custom tools.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.searchApiKey]                Bocha API Key (or null).
 * @param {(url: string, opts?: object) => Promise<object>} [opts.fetchWebRendered]
 *   Bridge to the main-process F2 webFetch.fetchWeb. When provided, `fetch_web`
 *   supports the `rendered: true` parameter. When omitted, rendered mode
 *   silently falls back to Node fetch.
 *
 * @returns {Array<object>} pi `ToolDefinition[]` ready to pass to `customTools`.
 */
export function buildWebTools(opts = {}) {
  const searchApiKey = opts.searchApiKey || null;
  const fetchWebRendered = typeof opts.fetchWebRendered === 'function' ? opts.fetchWebRendered : null;

  const searchTool = buildSearchWebTool({ searchApiKey });
  const fetchTool = buildFetchWebTool({ fetchWebRendered });

  return [searchTool, fetchTool];
}

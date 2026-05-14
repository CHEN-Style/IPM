// desktop/Agent/pi-runtime/tools/webTools.js
//
// Phase-6 customTools: HTTP / web-fetch tooling for the pi-coding-agent
// runtime. pi 0.74.0 ships built-in `read`, `write`, `edit`, `bash`,
// `grep`, `find`, `ls`, but does NOT ship an HTTP fetch tool. We expose
// one here so the model can pull URL content without falling back to
// `bash curl` (which is unreliable on Windows and forces the model to
// hand-craft shell commands).
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
// 3. No external deps required: this tool uses the Node global
//    `fetch` (available since v18, confirmed working on the project's
//    Node v22.12.0).

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';

const MAX_RESPONSE_SIZE = 200_000;
const FETCH_TIMEOUT_MS = 30_000;

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

/**
 * Build the array of web-related custom tools.
 *
 * Currently a single tool: `fetch_web`. Does not depend on any IPM
 * business helpers, so it can be registered regardless of whether
 * `toolDeps` is provided.
 *
 * @returns {Array<object>} pi `ToolDefinition[]` ready to pass to `customTools`.
 */
export function buildWebTools() {
  const usageGuideline =
    'Use fetch_web to retrieve content from a URL (web page or HTTP API). Prefer this tool over invoking curl/wget through bash — it handles timeouts, HTML stripping, and response truncation automatically.';

  const fetchWebTool = defineTool({
    name: 'fetch_web',
    label: 'Fetch URL',
    description:
      'Fetch content from a URL. Returns text or HTML content (HTML tags stripped). Useful for web scraping, API calls, or downloading text data. Times out after 30 seconds and truncates responses to ~200 KB by default.',
    promptSnippet:
      'fetch_web: GET a URL and return its text body (HTML stripped, 30s timeout, ~200KB cap).',
    promptGuidelines: [usageGuideline],
    parameters: Type.Object({
      url: Type.String({
        minLength: 1,
        description: 'The URL to fetch (must include scheme, e.g. https://example.com).',
      }),
      maxLength: Type.Optional(Type.Number({
        description: `Max response length in characters (default ${MAX_RESPONSE_SIZE}, hard cap also ${MAX_RESPONSE_SIZE}).`,
      })),
    }),
    async execute(_toolCallId, params, signal) {
      const url = String(params?.url || '').trim();
      const maxLength = typeof params?.maxLength === 'number' ? params.maxLength : undefined;

      if (!url) return textResult('错误: 必须提供 url 参数。');

      try {
        new URL(url);
      } catch {
        return textResult(`无效的 URL: ${url}`);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      // Chain the host abort signal (from pi) so user-initiated aborts
      // also cancel in-flight fetches.
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
          return textResult(`HTTP ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (
          contentType.includes('image') ||
          contentType.includes('video') ||
          contentType.includes('audio')
        ) {
          return textResult(`该 URL 返回的是媒体内容 (${contentType})，无法以文本形式展示。`);
        }

        let text = await response.text();
        const limit = Math.min(maxLength || MAX_RESPONSE_SIZE, MAX_RESPONSE_SIZE);

        if (text.length > limit) {
          text = text.slice(0, limit) + `\n\n[... 截断, 原始长度 ${text.length} 字符]`;
        }

        if (contentType.includes('text/html')) {
          text = stripHtmlTags(text);
        }

        return textResult(text);
      } catch (e) {
        if (e?.name === 'AbortError') {
          return textResult(`请求超时或被取消 (${FETCH_TIMEOUT_MS / 1000}s 上限)`);
        }
        return textResult(`网络请求失败: ${e?.message || e}`);
      } finally {
        clearTimeout(timer);
        if (signal && typeof signal.removeEventListener === 'function') {
          try { signal.removeEventListener('abort', onHostAbort); } catch { /* ignore */ }
        }
      }
    },
  });

  return [fetchWebTool];
}

// desktop/Agent/services/searchService.js
//
// K1 — KnowClaw 网页搜索 API 封装
//
// 当前 provider：博查 (Bocha) Web Search API
//   - 文档：https://open.bochaai.com
//   - 端点：POST https://api.bochaai.com/v1/web-search
//   - 认证：Authorization: Bearer <API_KEY>
//   - 计费：新用户 1000 次免费额度，之后约 ¥0.036/次
//
// 设计目标：
//   * ESM 纯 Node fetch 实现，无 Electron / 主进程依赖，
//     既可在 pi-runtime（子进程）内直接 import，也可在 Electron
//     主进程做连通性测试。
//   * 错误分类清晰，调用方（webTools.search_web / prefs.testSearchApi）
//     可根据 errorType 渲染不同的提示文本。
//   * 不做自动重试 / 限流：失败由 LLM 通过自然语言降级（引导用户提供
//     URL → fetch_web），上层无需复杂状态机。

const BOCHA_ENDPOINT = 'https://api.bochaai.com/v1/web-search';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_COUNT = 10;
const MIN_COUNT = 1;
const MAX_COUNT = 50;

const FRESHNESS_VALUES = new Set([
  'noLimit',
  'oneDay',
  'oneWeek',
  'oneMonth',
  'oneYear',
]);

/**
 * @typedef {object} BochaSearchResult
 * @property {string} title
 * @property {string} url
 * @property {string} snippet
 * @property {string} summary
 * @property {string} siteName
 * @property {string} datePublished
 */

/**
 * @typedef {object} BochaSearchResponse
 * @property {boolean} ok
 * @property {BochaSearchResult[]} [results]
 * @property {string} [error]            Human-readable error message.
 * @property {string} [errorType]        'unauthorized' | 'quota' | 'timeout' | 'network' | 'http' | 'parse' | 'unknown'
 * @property {number} [status]           Raw HTTP status when applicable.
 */

function clampCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n)) return DEFAULT_COUNT;
  return Math.min(Math.max(Math.floor(n), MIN_COUNT), MAX_COUNT);
}

function normalizeFreshness(freshness) {
  if (!freshness) return 'noLimit';
  const f = String(freshness);
  if (FRESHNESS_VALUES.has(f)) return f;
  // 透传 YYYY-MM-DD / 范围语法（博查也支持），但不再做正则校验，
  // 错误格式由博查自身回 4xx，我们如实转发。
  if (/^\d{4}-\d{2}-\d{2}(\.\.\d{4}-\d{2}-\d{2})?$/.test(f)) return f;
  return 'noLimit';
}

function mapHttpError(status, detailText) {
  if (status === 401 || status === 403) {
    return {
      errorType: 'unauthorized',
      error: 'API Key 无效或未授权（HTTP ' + status + '）',
    };
  }
  if (status === 402) {
    return {
      errorType: 'quota',
      error: 'API 额度不足（HTTP 402）。请前往博查开放平台充值或检查账户余额。',
    };
  }
  if (status === 429) {
    return {
      errorType: 'quota',
      error: '请求过于频繁或额度耗尽（HTTP 429）。',
    };
  }
  return {
    errorType: 'http',
    error: 'HTTP ' + status + (detailText ? ': ' + detailText.slice(0, 200) : ''),
  };
}

/**
 * 调博查 Web Search API。
 *
 * @param {string} apiKey   博查 API Key（必填，不做缓存）。
 * @param {string} query    搜索词（必填）。
 * @param {object} [opts]
 * @param {number} [opts.count=10]              返回结果数 (1-50)。
 * @param {string} [opts.freshness='noLimit']   时间范围。
 * @param {boolean} [opts.summary=true]         是否请求摘要字段。
 * @param {number} [opts.timeoutMs=15000]       超时毫秒。
 * @param {AbortSignal} [opts.signal]           外部 abort 信号（pi 工具调用链）。
 * @returns {Promise<BochaSearchResponse>}
 */
export async function bochaWebSearch(apiKey, query, opts = {}) {
  const key = String(apiKey || '').trim();
  if (!key) {
    return {
      ok: false,
      errorType: 'unauthorized',
      error: '未配置 API Key',
    };
  }
  const q = String(query || '').trim();
  if (!q) {
    return {
      ok: false,
      errorType: 'parse',
      error: '搜索词不能为空',
    };
  }

  const count = clampCount(opts.count);
  const freshness = normalizeFreshness(opts.freshness);
  const summary = opts.summary !== false;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Chain external abort (e.g. pi tool host abort).
  const onHostAbort = () => controller.abort();
  if (opts.signal && typeof opts.signal.addEventListener === 'function') {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onHostAbort, { once: true });
  }

  try {
    let response;
    try {
      response = await fetch(BOCHA_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
          'User-Agent': 'IPM-KnowClaw/1.0',
        },
        body: JSON.stringify({ query: q, freshness, count, summary }),
      });
    } catch (e) {
      if (e?.name === 'AbortError') {
        return {
          ok: false,
          errorType: 'timeout',
          error: '请求超时（' + Math.round(timeoutMs / 1000) + 's 上限）或已取消',
        };
      }
      return {
        ok: false,
        errorType: 'network',
        error: '网络请求失败: ' + (e?.message || String(e)),
      };
    }

    if (!response.ok) {
      let detail = '';
      try { detail = await response.text(); } catch { /* ignore */ }
      const mapped = mapHttpError(response.status, detail);
      return { ok: false, status: response.status, ...mapped };
    }

    let json;
    try {
      json = await response.json();
    } catch (e) {
      return {
        ok: false,
        errorType: 'parse',
        error: '响应不是合法 JSON: ' + (e?.message || e),
      };
    }

    // 博查统一响应结构：{ code, msg, data: { webPages: { value: [...] }, ... } }
    // 不同时期 code 表示成功的语义略有差异，凡是拿不到 webPages.value 都按失败处理。
    const code = json?.code;
    const data = json?.data;
    const pages = data?.webPages?.value;

    if (!Array.isArray(pages)) {
      // 兼容 code !== 200 的业务错误
      const msg = json?.msg || json?.message || ('响应缺少 data.webPages.value（code=' + code + '）');
      return {
        ok: false,
        errorType: code === 401 || code === 403 ? 'unauthorized' : 'parse',
        error: String(msg),
      };
    }

    const results = pages.map((p) => ({
      title: String(p?.name || p?.title || '').trim(),
      url: String(p?.url || '').trim(),
      snippet: String(p?.snippet || '').trim(),
      summary: String(p?.summary || '').trim(),
      siteName: String(p?.siteName || '').trim(),
      datePublished: String(p?.datePublished || p?.dateLastCrawled || '').trim(),
    })).filter((r) => r.url);

    return { ok: true, results };
  } catch (e) {
    return {
      ok: false,
      errorType: 'unknown',
      error: '调用失败: ' + (e?.message || String(e)),
    };
  } finally {
    clearTimeout(timer);
    if (opts.signal && typeof opts.signal.removeEventListener === 'function') {
      try { opts.signal.removeEventListener('abort', onHostAbort); } catch { /* ignore */ }
    }
  }
}

/**
 * 轻量连通性测试：发送一个最小代价的查询（count=1），
 * 仅用于设置页的「测试连接」按钮。
 *
 * @param {string} apiKey
 * @returns {Promise<{ok: boolean, error?: string, errorType?: string}>}
 */
export async function testBochaApiKey(apiKey) {
  const res = await bochaWebSearch(apiKey, '测试连接', {
    count: 1,
    timeoutMs: 10_000,
    summary: false,
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: res.error, errorType: res.errorType };
}

export const SEARCH_PROVIDERS = Object.freeze({
  bocha: {
    id: 'bocha',
    label: '博查 (Bocha)',
    homepage: 'https://open.bochaai.com',
  },
});

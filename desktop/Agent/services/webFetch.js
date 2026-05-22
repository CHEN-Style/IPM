// desktop/Agent/services/webFetch.js
//
// F2 — 网页完整信息抓取升级
//
// 统一的网页抓取服务，提供两条管道：
//
//   1. fetchRendered(url, opts)  — 隐藏 BrowserWindow + Electron Chromium
//      渲染 → executeJavaScript 抽取完整 DOM → Readability → Turndown → Markdown
//      可选 capturePage 全页截图。能跑 JS、复用系统代理、支持 SPA。
//
//   2. fetchSimple(url, opts)    — 旧的 HTTP + JSDOM + Readability 管道
//      （内部委托给 webclip.js 的 fetchAndExtract，保留作为快速 / 降级路径）。
//
// 设计原则：
//
//   * 隐藏窗口池：限制最大并发 2，每次用完即销毁，防止内存暴涨。
//   * 超时兜底：渲染最多等待 RENDER_TIMEOUT_MS，超时强制销毁窗口。
//   * 失败降级：fetchRendered 内部任意环节抛异常都返回 error，调用方
//     可以选择性地 fallback 到 fetchSimple，确保不比现有差。
//   * 仅在 Electron 主进程可用：依赖 BrowserWindow / session API。
//     被 Node-only 上下文（pi-runtime 子进程）调用时会自动降级到
//     fetchSimple。
//
// 与 webclip.js 的关系：
//
//   * webclip.js 仍然存在，现在是本服务的 HTTP fallback。
//   * webclip.js 的 summarizeContent 也保留（LLM 摘要不在本服务职责内）。

import { Readability } from '@mozilla/readability';

// jsdom 在某些 Node 版本（<22.13）+ 新版 html-encoding-sniffer 上会因
// CommonJS / ESM 互操作问题报错。webFetch 内部仅用 jsdom 做正文提取的"清洗"，
// 失败时可以降级到纯字符串 strip，所以这里做 lazy import + 容错。
let cachedJsdom = null;
async function getJSDOM() {
  if (cachedJsdom !== null) return cachedJsdom;
  try {
    const mod = await import('jsdom');
    cachedJsdom = mod.JSDOM || mod.default?.JSDOM || null;
  } catch (err) {
    console.warn('[webFetch] jsdom 加载失败，将使用 strip-only 提取:', err?.message || err);
    cachedJsdom = null;
  }
  return cachedJsdom;
}

// 旧 HTTP 管道（webclip.js）也是 lazy 引用，避免在 jsdom 不可用时整体阻塞。
async function getLegacyFetch() {
  try {
    const mod = await import('./webclip.js');
    return mod.fetchAndExtract || null;
  } catch (err) {
    console.warn('[webFetch] webclip.js 加载失败:', err?.message || err);
    return null;
  }
}

const RENDER_TIMEOUT_MS = 30_000;
const POST_LOAD_IDLE_MS = 800;
const MAX_CONCURRENT_RENDERS = 2;
const DEFAULT_VIEWPORT = { width: 1280, height: 900 };
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let inflight = 0;
const waitQueue = [];

function acquireSlot() {
  if (inflight < MAX_CONCURRENT_RENDERS) {
    inflight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitQueue.push(resolve));
}

function releaseSlot() {
  const next = waitQueue.shift();
  if (next) {
    next();
  } else {
    inflight = Math.max(0, inflight - 1);
  }
}

async function loadElectron() {
  try {
    const mod = await import('electron');
    return mod;
  } catch {
    return null;
  }
}

function isMainProcess(electronMod) {
  if (!electronMod) return false;
  return Boolean(electronMod.app && electronMod.BrowserWindow && electronMod.app.isReady);
}

/**
 * 在 BrowserWindow 中加载 URL 并等到「合理 idle」。
 *
 * 这里 idle 的定义保守：did-finish-load 后再等一段固定的 settle 时间，
 * 让大部分懒加载脚本完成首屏。后续可加 MutationObserver-based detection。
 */
function loadAndSettle(win, url, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, payload) => {
      if (done) return;
      done = true;
      try { win.webContents?.removeListener('did-fail-load', onFail); } catch { /* ignore */ }
      try { win.webContents?.removeListener('did-finish-load', onFinish); } catch { /* ignore */ }
      if (timer) clearTimeout(timer);
      if (err) reject(err); else resolve(payload);
    };

    const onFail = (_evt, code, desc, validatedURL) => {
      if (code === -3) return;
      finish(new Error(`renderer 加载失败 (${code} ${desc || ''} ${validatedURL || url})`));
    };
    const onFinish = () => {
      setTimeout(() => finish(null, true), POST_LOAD_IDLE_MS);
    };

    win.webContents.on('did-fail-load', onFail);
    win.webContents.on('did-finish-load', onFinish);

    const timer = setTimeout(() => finish(new Error(`渲染超时 (${timeoutMs / 1000}s)`)), timeoutMs);

    try {
      win.loadURL(url, { userAgent: CHROME_UA }).catch((err) => finish(err));
    } catch (err) {
      finish(err);
    }
  });
}

/**
 * 在已加载完成的窗口里抽取页面内容。
 *
 * 注入脚本会：
 *   - 滚动到底（触发懒加载图片 / 滚动加载内容）
 *   - 等一帧后取 documentElement.outerHTML / title / location
 */
async function extractFromWindow(win) {
  const script = `
    (async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        const maxScrolls = 12;
        let prevHeight = 0;
        for (let i = 0; i < maxScrolls; i++) {
          window.scrollTo(0, document.body.scrollHeight);
          await sleep(120);
          const h = document.body.scrollHeight;
          if (h === prevHeight) break;
          prevHeight = h;
        }
        window.scrollTo(0, 0);
        await sleep(80);
      } catch (_) {}
      return {
        html: document.documentElement.outerHTML,
        title: document.title || '',
        url: window.location.href,
      };
    })()
  `;
  return win.webContents.executeJavaScript(script, true);
}

/**
 * 从 HTML 里跑 Readability + 退化 strip。
 * jsdom 不可用时会自动 fall through 到纯字符串管道。
 */
async function readabilityFromHtml(html, url) {
  const JSDOM = await getJSDOM();
  if (JSDOM) {
    try {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article && article.textContent && article.textContent.trim().length > 50) {
        return {
          title: article.title || '',
          content: article.content || '',
          textContent: article.textContent || '',
          excerpt: article.excerpt || '',
          siteName: article.siteName || '',
        };
      }
    } catch { /* fall through */ }
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 200) : '',
    content: '',
    textContent: stripped.slice(0, 50_000),
    excerpt: stripped.slice(0, 300),
    siteName: '',
  };
}

let cachedTurndown = null;
async function getTurndown() {
  if (cachedTurndown) return cachedTurndown;
  try {
    const mod = await import('turndown');
    const TurndownService = mod.default || mod;
    const td = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
    });
    cachedTurndown = td;
    return td;
  } catch (err) {
    console.warn('[webFetch] turndown 加载失败，将仅返回 textContent:', err?.message || err);
    return null;
  }
}

async function htmlToMarkdown(cleanHtml, plainText) {
  if (!cleanHtml) return plainText || '';
  const td = await getTurndown();
  if (!td) return plainText || '';
  try {
    return td.turndown(cleanHtml).trim();
  } catch (err) {
    console.warn('[webFetch] turndown 转换失败，回退到 textContent:', err?.message || err);
    return plainText || '';
  }
}

/**
 * 在主进程中创建一个隐藏 BrowserWindow 渲染目标 URL，抽取 DOM，
 * 用 Readability 提取正文，再用 Turndown 转 Markdown。
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.screenshot=false]  是否一并 capturePage 截图
 * @param {number}  [opts.timeoutMs=RENDER_TIMEOUT_MS]
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   title: string,
 *   url: string,
 *   html: string,
 *   markdown: string,
 *   textContent: string,
 *   excerpt: string,
 *   siteName: string,
 *   screenshotPng: Buffer|null,
 *   renderMode: 'rendered'
 * }>}
 */
export async function fetchRendered(url, opts = {}) {
  try {
    new URL(url);
  } catch {
    return { ok: false, error: `无效的 URL: ${url}`, renderMode: 'rendered' };
  }

  const electronMod = await loadElectron();
  if (!isMainProcess(electronMod)) {
    return { ok: false, error: 'fetchRendered 仅在 Electron 主进程可用', renderMode: 'rendered' };
  }

  const { BrowserWindow, app } = electronMod;
  if (typeof app?.whenReady === 'function') {
    try { await app.whenReady(); } catch { /* ignore */ }
  }

  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : RENDER_TIMEOUT_MS;
  const wantScreenshot = Boolean(opts.screenshot);

  await acquireSlot();
  let win = null;
  try {
    win = new BrowserWindow({
      show: false,
      width: DEFAULT_VIEWPORT.width,
      height: DEFAULT_VIEWPORT.height,
      paintWhenInitiallyHidden: wantScreenshot,
      webPreferences: {
        offscreen: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    try { win.webContents.setAudioMuted(true); } catch { /* ignore */ }
    try { win.webContents.setUserAgent(CHROME_UA); } catch { /* ignore */ }

    await loadAndSettle(win, url, { timeoutMs });

    const extracted = await extractFromWindow(win);
    const html = String(extracted?.html || '');
    const finalUrl = String(extracted?.url || url);
    const pageTitle = String(extracted?.title || '');

    const article = await readabilityFromHtml(html, finalUrl);
    const cleanHtml = article.content || html;
    const markdown = await htmlToMarkdown(cleanHtml, article.textContent);

    let screenshotPng = null;
    if (wantScreenshot) {
      try {
        const fullPageScript = `
          (async () => {
            return {
              w: Math.max(document.documentElement.scrollWidth, window.innerWidth),
              h: Math.max(document.documentElement.scrollHeight, window.innerHeight),
            };
          })()
        `;
        const { w, h } = await win.webContents.executeJavaScript(fullPageScript, true);
        const targetW = Math.min(Math.max(Math.ceil(w || DEFAULT_VIEWPORT.width), 320), 1600);
        const targetH = Math.min(Math.max(Math.ceil(h || DEFAULT_VIEWPORT.height), 320), 8000);
        try { win.setContentSize(targetW, targetH); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 200));
        const image = await win.webContents.capturePage();
        screenshotPng = image && !image.isEmpty?.() ? image.toPNG() : null;
      } catch (err) {
        console.warn('[webFetch] capturePage 失败:', err?.message || err);
        screenshotPng = null;
      }
    }

    return {
      ok: true,
      error: null,
      title: article.title || pageTitle,
      url: finalUrl,
      html: cleanHtml,
      markdown,
      textContent: article.textContent || '',
      excerpt: article.excerpt || '',
      siteName: article.siteName || '',
      screenshotPng,
      renderMode: 'rendered',
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err) || '渲染失败',
      renderMode: 'rendered',
    };
  } finally {
    if (win) {
      try { win.removeAllListeners(); } catch { /* ignore */ }
      try { win.destroy(); } catch { /* ignore */ }
    }
    releaseSlot();
  }
}

/**
 * 旧的纯 HTTP + JSDOM 管道。返回字段对齐 fetchRendered 以便降级。
 */
export async function fetchSimple(url, opts = {}) {
  const legacyFetch = await getLegacyFetch();
  if (!legacyFetch) {
    return {
      ok: false,
      error: 'webclip.js 不可用（jsdom 加载失败）',
      renderMode: 'http_fallback',
    };
  }
  const result = await legacyFetch(url);
  if (result.error && !result.textContent) {
    return {
      ok: false,
      error: result.error,
      renderMode: 'http_fallback',
    };
  }

  let markdown = '';
  if (opts.toMarkdown !== false) {
    if (result.content) {
      markdown = await htmlToMarkdown(result.content, result.textContent || '');
    } else {
      markdown = String(result.textContent || '');
    }
  }

  return {
    ok: true,
    error: result.error || null,
    title: result.title || '',
    url,
    html: result.content || '',
    markdown,
    textContent: result.textContent || '',
    excerpt: result.excerpt || '',
    siteName: result.siteName || '',
    screenshotPng: null,
    renderMode: 'http_fallback',
  };
}

/**
 * 自动模式：先尝试 fetchRendered，失败则降级到 fetchSimple。
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {'auto'|'render'|'http'} [opts.mode='auto']
 * @param {boolean} [opts.screenshot=false]
 * @param {number} [opts.timeoutMs]
 */
export async function fetchWeb(url, opts = {}) {
  const mode = opts.mode || 'auto';
  if (mode === 'http') {
    return fetchSimple(url, opts);
  }
  if (mode === 'render') {
    return fetchRendered(url, opts);
  }
  const rendered = await fetchRendered(url, opts);
  if (rendered.ok && (rendered.markdown || rendered.textContent)) {
    return rendered;
  }
  const simple = await fetchSimple(url, opts);
  if (simple.ok) {
    simple.fallbackReason = rendered.error || '渲染结果为空';
    return simple;
  }
  return rendered.ok ? rendered : simple;
}

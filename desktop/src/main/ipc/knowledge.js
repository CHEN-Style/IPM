import fs from 'node:fs';
import path from 'node:path';
import {
  createItem,
  getItem,
  listItems,
  updateItem,
  deleteItem,
  addLink,
  removeLink,
  removeLinkByItemAndPath,
  getItemLinks,
  getLinkedItems,
  countItems,
  countLinkedItems,
} from '../../../Agent/db/knowledge.js';
import {
  listBoards,
  getBoard,
  createBoard,
  renameBoard,
  deleteBoard,
  setMainBoard,
  getBoardItems,
  addBoardItem,
  removeBoardItem,
  updateBoardLayout,
  countBoardItems,
  lockItem,
  unlockItem,
  listConnections,
  addConnection,
  removeConnection,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  lockGroup,
  unlockGroup,
  updateBoardStyle,
  copyBoardToGroup,
  copyGroupToBoard,
  createTimeline,
  listTimelines,
  updateTimeline,
  deleteTimeline,
  addTimelinePoint,
  updateTimelinePoint,
  deleteTimelinePoint,
  listTimelinePoints,
} from '../../../Agent/db/board.js';

// F2: createWebclip / createDraft 不再直接调用 webclip.fetchAndExtract，
// 而是通过 webFetch.fetchWeb 统一入口（内部会按需降级到 webclip 的 HTTP 管道）。
// 仅保留 summarizeContent（LLM 摘要功能不变）。
import { summarizeContent } from '../../../Agent/services/webclip.js';
import { fetchWeb } from '../../../Agent/services/webFetch.js';
// F3: OCR 服务静态导入 — 模块本身轻量（只引用 fs/path），
// ppu-paddle-ocr + onnxruntime-node 在 ocrService 内部首次 recognize 时才懒加载，
// 因此安全地放在顶层 import，不会拖慢主进程启动。
import * as ocrService from '../../../Agent/services/ocrService.js';

// F3: OCR 服务是 lazy import，避免主进程启动时强依赖 onnxruntime-node 原生模块。
// runOcrInBackground() 在 knowledge/create 与 createWebclip 创建后异步执行：
//   1. 调用 ocrService.recognize 拿到识别文本
//   2. 把识别结果写到原碎片的 content_text / content_json（便于搜索 + 标记已识别）
//   3. 把识别文本另存为一份 .txt 文件 + 一个新的 snippet 类型知识碎片，
//      碎片之间通过 content_json.ocrSourceItemId / ocrChildItemId 双向引用，
//      实现"识别后产出独立可管理的知识碎片"
//   4. 可选：调用 LLM 生成摘要写入新 snippet 的 summary 字段
// 不阻塞主流程，识别完成后通过 emit('updated') 通知前端刷新。
async function runOcrInBackground({
  imagePath,
  itemId,
  projectName,
  projectDir,
  db,
  lang = 'ch',
  runLlmSummary = false,
  emit,
  type = 'screenshot',
  // 辅助函数（从外层闭包传入，避免循环依赖）
  ensureClipboardSnippetsDir: _ensureClipboardSnippetsDir,
  ensureUniqueDestPath: _ensureUniqueDestPath,
  sanitizeFileName: _sanitizeFileName,
  formatStamp: _formatStamp,
  makeShortId: _makeShortId,
}) {
  if (!imagePath || !itemId) return;
  try {
    const result = await ocrService.recognize(imagePath, { lang });
    const text = String(result?.text || '').trim();
    if (!text) return;

    const now = new Date();
    const ocrLang = result.lang || lang;
    const ocrConfidence = Number(result.confidence) || 0;

    // === 1. 写一份 .txt 文件 + 新建 snippet 知识碎片 ===
    let snippetId = '';
    let snippetRelPath = '';
    let snippetSummary = '';

    if (runLlmSummary && text.length > 100) {
      try {
        snippetSummary = await summarizeContent(text);
      } catch (err) {
        console.warn('[ocr] LLM 摘要失败:', err?.message || err);
      }
    }

    try {
      const snippetsDir = _ensureClipboardSnippetsDir(projectDir);
      const stamp = _formatStamp(now);
      const shortId = _makeShortId();
      const baseName = `ocr_${stamp}-${shortId}.txt`;
      const filePath = _ensureUniqueDestPath(snippetsDir, _sanitizeFileName(baseName) || 'ocr.txt');
      fs.writeFileSync(filePath, text, 'utf-8');
      snippetRelPath = String(path.relative(projectDir, filePath)).split(path.sep).join('/');

      snippetId = `snip_${stamp}_${shortId}`;
      const sourceItem = getItem(db, itemId);
      const sourceTitle = sourceItem?.title || (type === 'webclip' ? '网页截图' : '截图');
      const firstLine = text.split(/\r?\n/)[0].slice(0, 40);
      const snippetTitle = firstLine || `OCR: ${sourceTitle}`;

      const snippetContentJson = JSON.stringify({
        ocrSourceItemId: itemId,
        ocrSourceType: type,
        ocrLang,
        ocrConfidence,
        ocrCompletedAt: now.toISOString(),
      });

      createItem(db, {
        id: snippetId,
        type: 'snippet',
        title: snippetTitle,
        content_text: text,
        content_json: snippetContentJson,
        content_path: snippetRelPath,
        summary: snippetSummary,
        tags: ['ocr', type === 'webclip' ? 'webclip' : 'screenshot'],
        importance: null,
        source_kind: 'ocr',
        source_url: null,
        pinned: false,
        archived: false,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      });
      if (typeof emit === 'function') emit(projectName, 'created', snippetId);
    } catch (err) {
      console.warn('[ocr] 写 OCR snippet 失败:', err?.message || err);
    }

    // === 2. 更新原碎片：标记已识别 + 回链 snippetId ===
    const patch = { updated_at: now.toISOString() };
    try {
      const existing = getItem(db, itemId);
      if (existing) {
        let meta = {};
        try { meta = JSON.parse(existing.content_json || '{}'); } catch { meta = {}; }
        meta.ocrText = text;
        meta.ocrLang = ocrLang;
        meta.ocrConfidence = ocrConfidence;
        meta.ocrCompletedAt = now.toISOString();
        if (snippetId) {
          meta.ocrChildItemId = snippetId;
          meta.ocrChildPath = snippetRelPath;
        }
        patch.content_json = JSON.stringify(meta);

        // 对 screenshot 类型，也把识别文本写到 content_text（搜索友好；保留预览）。
        if (type === 'screenshot') {
          patch.content_text = text.length > 500 ? `${text.slice(0, 500)}…` : text;
          if (snippetSummary) patch.summary = snippetSummary;
        }
      }
    } catch (err) {
      console.warn('[ocr] 原碎片元信息更新失败:', err?.message || err);
    }

    updateItem(db, itemId, patch);
    if (typeof emit === 'function') emit(projectName, 'updated', itemId);
  } catch (err) {
    console.warn('[ocr] runOcrInBackground failed:', err?.message || err);
  }
}

export function registerKnowledgeIpc({
  ipcMain,
  clipboardImageCache,
  getWorkspaceDirOrThrow,
  getProjectDb,
  ensureProjectStructure,
  ensureClipboardSnippetsDir,
  ensureScreenshotsDir,
  formatStamp,
  makeShortId,
  ensureUniqueDestPath,
  sanitizeFileName,
  normalizeRelPathPosix,
  resolveInside,
  // F1: 附属壳（外部导入项目）感知 — 禁止 addLink。
  isAttachedProject,
  trashOrRm,
  emitKnowledgeChanged,
  getProjectsRoot,
  getCasesRoot,
  getStudyRoot,
  isTombstoneProjectName,
}) {
  if (!ipcMain) throw new Error('registerKnowledgeIpc: ipcMain is required');

  const getDb = (payload) => {
    const { name, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    ensureProjectStructure(name, payload?.domain);
    const db = getProjectDb(projectDir);
    return { db, projectName: name, projectDir };
  };

  const emit = (projectName, changeType, id) => {
    if (typeof emitKnowledgeChanged === 'function') {
      emitKnowledgeChanged({ projectName, type: changeType, id });
    }
  };

  // ===== List =====
  ipcMain.handle('knowledge/list', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const items = listItems(db, {
      type: payload?.type || undefined,
      importance: payload?.importance || undefined,
      pinned: payload?.pinned,
      archived: payload?.archived,
      search: payload?.search || undefined,
      tags: payload?.tags || undefined,
      limit: payload?.limit,
      offset: payload?.offset,
    });
    for (const item of items) {
      if (item.content_path) {
        try { item._absolutePath = resolveInside(projectDir, item.content_path); } catch { /* ignore */ }
      }
    }
    return { ok: true, projectName, items };
  });

  // ===== Get =====
  ipcMain.handle('knowledge/get', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const id = String(payload?.id || '');
    if (!id) throw new Error('id 不能为空');
    const item = getItem(db, id);
    if (!item) throw new Error('未找到该知识碎片');
    if (item.content_path) {
      try {
        const absPath = resolveInside(projectDir, item.content_path);
        item._absolutePath = absPath;
      } catch { /* ignore */ }
    }
    if (item.type === 'webclip' && item.content_json) {
      try {
        const meta = JSON.parse(item.content_json);
        if (Array.isArray(meta.images) && meta.images.length > 0) {
          meta._resolvedImages = meta.images.map((relPath) => {
            try { return resolveInside(projectDir, relPath).replace(/\\/g, '/'); } catch { return ''; }
          }).filter(Boolean);
          item.content_json = JSON.stringify(meta);
        }
      } catch { /* ignore */ }
    }
    return { ok: true, projectName, item };
  });

  // ===== Create =====
  ipcMain.handle('knowledge/create', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const type = String(payload?.type || 'snippet');
    const now = new Date();
    const stamp = formatStamp(now);
    const shortId = makeShortId();

    let contentPath = '';
    let contentText = String(payload?.content_text || payload?.text || '');
    const contentJson = payload?.content_json || null;

    if (type === 'snippet') {
      const trimmed = contentText.trim();
      if (!trimmed) throw new Error('内容为空');
      const snippetsDir = ensureClipboardSnippetsDir(projectDir);
      const baseName = `${stamp}-${shortId}.txt`;
      const filePath = ensureUniqueDestPath(snippetsDir, sanitizeFileName(baseName) || 'snippet.txt');
      fs.writeFileSync(filePath, contentText, 'utf-8');
      contentPath = String(path.relative(projectDir, filePath)).split(path.sep).join('/');
    } else if (type === 'screenshot') {
      let pngBuffer = payload?.pngBuffer;
      if (!pngBuffer && payload?.token && clipboardImageCache) {
        const cached = clipboardImageCache.get(payload.token);
        if (cached?.png) pngBuffer = cached.png;
      }
      if (!pngBuffer) throw new Error('截图数据为空');
      const screenshotsDir = ensureScreenshotsDir(projectDir);
      const baseName = `${stamp}-${shortId}.png`;
      const filePath = ensureUniqueDestPath(screenshotsDir, sanitizeFileName(baseName) || 'screenshot.png');
      fs.writeFileSync(filePath, Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer));
      contentPath = String(path.relative(projectDir, filePath)).split(path.sep).join('/');
      // 缓存绝对路径供 F3 OCR 异步使用（在 createItem 之后立刻调度）。
      payload._screenshotAbsPath = filePath;
    }
    // type === 'note' or 'webclip': no physical file

    const id = `${type.slice(0, 4)}_${stamp}_${shortId}`;
    const preview = contentText.trim().length > 200 ? `${contentText.trim().slice(0, 200)}…` : contentText.trim();
    const title = payload?.title || (contentText ? contentText.split(/\r?\n/)[0].slice(0, 40) : '') || (type === 'screenshot' ? '截图' : '知识碎片');

    const item = createItem(db, {
      id,
      type,
      title,
      content_text: (type === 'note' || type === 'webclip') ? contentText : preview,
      content_json: contentJson ? (typeof contentJson === 'string' ? contentJson : JSON.stringify(contentJson)) : null,
      content_path: contentPath,
      summary: payload?.summary || '',
      tags: Array.isArray(payload?.tags) ? payload.tags : ['temp'],
      importance: payload?.importance || null,
      source_kind: payload?.source_kind || (type === 'snippet' ? 'clipboardText' : type === 'screenshot' ? 'clipboardImage' : 'manual'),
      source_url: payload?.source_url || null,
      pinned: false,
      archived: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    emit(projectName, 'created', id);

    // F3: 图片碎片入库时按需触发 OCR（不阻塞主返回流程）。
    //   - payload.runOcr === true 才会跑（前端弹窗确认后传入）
    //   - payload.lang === 'ch' | 'en'
    //   - payload.runLlmSummary === true 时识别完成后调用 LLM 总结写入 summary 字段
    if (type === 'screenshot' && payload?.runOcr === true && payload?._screenshotAbsPath) {
      runOcrInBackground({
        imagePath: payload._screenshotAbsPath,
        itemId: id,
        projectName,
        projectDir,
        db,
        lang: payload.lang === 'en' ? 'en' : 'ch',
        runLlmSummary: payload.runLlmSummary === true,
        emit,
        type: 'screenshot',
        ensureClipboardSnippetsDir,
        ensureUniqueDestPath,
        sanitizeFileName,
        formatStamp,
        makeShortId,
      }).catch(() => { /* logged inside */ });
    }

    return { ok: true, projectName, item };
  });

  // ===== Update =====
  ipcMain.handle('knowledge/update', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const id = String(payload?.id || '');
    if (!id) throw new Error('id 不能为空');
    const patch = payload?.patch && typeof payload.patch === 'object' ? payload.patch : {};

    // If content_text changed and has content_path, sync file
    if (typeof patch.content_text === 'string') {
      const existing = getItem(db, id);
      if (existing?.content_path && existing.content_path.startsWith('snippets/clipboard/') && existing.content_path.endsWith('.txt')) {
        try {
          const target = resolveInside(projectDir, existing.content_path);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, patch.content_text, 'utf-8');
        } catch { /* best-effort */ }
      }
    }

    const item = updateItem(db, id, patch);
    if (!item) throw new Error('未找到该知识碎片');
    emit(projectName, 'updated', id);
    return { ok: true, projectName, item };
  });

  // ===== Delete =====
  ipcMain.handle('knowledge/delete', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const id = String(payload?.id || '');
    if (!id) throw new Error('id 不能为空');
    const contentPath = deleteItem(db, id);
    if (contentPath) {
      try {
        const target = resolveInside(projectDir, contentPath);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          await trashOrRm(target);
        }
      } catch { /* best-effort */ }
    }
    emit(projectName, 'deleted', id);
    return { ok: true, projectName, deleted: true };
  });

  // ===== Add Link =====
  ipcMain.handle('knowledge/addLink', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const itemId = String(payload?.itemId || '');
    const targetPath = normalizeRelPathPosix(payload?.targetPath || '');
    const targetKind = String(payload?.targetKind || 'file').toLowerCase();
    if (!itemId) throw new Error('itemId 不能为空');
    if (!targetPath) throw new Error('targetPath 不能为空');
    if (targetPath === 'snippets' || targetPath.startsWith('snippets/') || targetPath === 'meta' || targetPath.startsWith('meta/')) {
      throw new Error('禁止关联到系统目录');
    }
    // F1: 附属壳（外部导入项目）禁止知识碎片关联文件。
    // 外部目录可能在应用外被 rename / move / delete，关联会静默失效，
    // 因此完全禁用此特性，仅保留"收集"能力。
    if (typeof isAttachedProject === 'function' && isAttachedProject(projectDir)) {
      throw new Error('外部导入项目不支持文件关联（仅支持碎片收集）');
    }
    const link = addLink(db, itemId, targetPath, targetKind);
    emit(projectName, 'updated', itemId);
    return { ok: true, projectName, link };
  });

  // ===== Remove Link =====
  ipcMain.handle('knowledge/removeLink', async (_evt, payload) => {
    const { db, projectName } = getDb(payload);
    const linkId = payload?.linkId;
    const itemId = payload?.itemId;
    const targetPath = payload?.targetPath;
    if (linkId) {
      removeLink(db, linkId);
    } else if (itemId && targetPath) {
      removeLinkByItemAndPath(db, itemId, normalizeRelPathPosix(targetPath));
    } else {
      throw new Error('需要 linkId 或 itemId+targetPath');
    }
    emit(projectName, 'updated', itemId || '');
    return { ok: true, projectName };
  });

  // ===== Get Links =====
  ipcMain.handle('knowledge/getLinks', async (_evt, payload) => {
    const { db, projectName } = getDb(payload);
    const itemId = String(payload?.itemId || '');
    if (!itemId) throw new Error('itemId 不能为空');
    const links = getItemLinks(db, itemId);
    return { ok: true, projectName, links };
  });

  // ===== Get Linked Items (reverse) =====
  ipcMain.handle('knowledge/getLinkedItems', async (_evt, payload) => {
    const { db, projectName } = getDb(payload);
    const targetPath = normalizeRelPathPosix(payload?.targetPath || '');
    if (!targetPath) throw new Error('targetPath 不能为空');
    const items = getLinkedItems(db, targetPath);
    return { ok: true, projectName, items };
  });

  // ===== Create Webclip =====
  // F2: 使用统一抓取服务 fetchWeb（隐藏 BrowserWindow + Markdown + 截图）。
  //   - mode='auto'  : 先尝试渲染抓取，失败降级到旧 HTTP 管道
  //   - mode='render': 强制渲染（慢但全）
  //   - mode='http'  : 强制旧管道（快但弱）
  //   - screenshot   : 是否一并 capturePage 全页截图（默认 true）
  ipcMain.handle('knowledge/createWebclip', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const url = String(payload?.url || '').trim();
    if (!url) throw new Error('URL 不能为空');

    const mode = ['auto', 'render', 'http'].includes(payload?.mode) ? payload.mode : 'auto';
    const wantScreenshot = payload?.screenshot !== false;

    const result = await fetchWeb(url, { mode, screenshot: wantScreenshot });
    if (!result.ok || (!result.textContent && !result.markdown)) {
      return { ok: false, projectName, error: result.error || '抓取失败' };
    }

    const summarySource = result.textContent || result.markdown || '';
    let summary = '';
    if (summarySource && summarySource.trim().length > 100) {
      summary = await summarizeContent(summarySource);
    }

    let hostname = '';
    try { hostname = new URL(url).hostname; } catch { /* ignore */ }

    const now = new Date();
    const stamp = formatStamp(now);
    const shortId = makeShortId();
    const id = `webc_${stamp}_${shortId}`;
    const title = result.title || hostname || url.slice(0, 60);

    let screenshotRel = '';
    let screenshotAbs = '';
    if (wantScreenshot && result.screenshotPng) {
      try {
        const screenshotsDir = ensureScreenshotsDir(projectDir);
        const baseName = `webclip_${stamp}_${shortId}.png`;
        const filePath = ensureUniqueDestPath(screenshotsDir, sanitizeFileName(baseName) || 'webclip.png');
        fs.writeFileSync(filePath, result.screenshotPng);
        screenshotRel = String(path.relative(projectDir, filePath)).split(path.sep).join('/');
        screenshotAbs = filePath;
      } catch (err) {
        console.warn('[webclip] 截图保存失败:', err?.message || err);
      }
    }

    const contentJson = JSON.stringify({
      images: screenshotRel ? [screenshotRel] : [],
      readability: {
        siteName: result.siteName || '',
        excerpt: result.excerpt || '',
      },
      renderMode: result.renderMode || 'http_fallback',
      markdown: result.markdown || '',
      fetchedAt: now.toISOString(),
      finalUrl: result.url || url,
    });

    const item = createItem(db, {
      id,
      type: 'webclip',
      title,
      content_text: result.markdown || result.textContent || '',
      content_json: contentJson,
      content_path: '',
      summary: summary || result.excerpt || '',
      tags: Array.isArray(payload?.tags) ? payload.tags : ['webclip'],
      importance: null,
      source_kind: 'webclip',
      source_url: url,
      pinned: false,
      archived: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    emit(projectName, 'created', id);

    // F3: webclip 截图自动 OCR（默认开启，payload.ocrScreenshot === false 时关闭）。
    // 识别结果写入 content_json.ocrText，不阻塞主流程。
    if (screenshotAbs && payload?.ocrScreenshot !== false) {
      runOcrInBackground({
        imagePath: screenshotAbs,
        itemId: id,
        projectName,
        projectDir,
        db,
        lang: payload?.ocrLang === 'en' ? 'en' : 'ch',
        runLlmSummary: false, // webclip 已有自己的 markdown summary
        emit,
        type: 'webclip',
        ensureClipboardSnippetsDir,
        ensureUniqueDestPath,
        sanitizeFileName,
        formatStamp,
        makeShortId,
      }).catch(() => { /* logged inside */ });
    }

    return {
      ok: true,
      projectName,
      item,
      fetchError: result.error || null,
      renderMode: result.renderMode || 'http_fallback',
      screenshotPath: screenshotRel || null,
      fallbackReason: result.fallbackReason || null,
    };
  });

  // ===== Add Webclip Image =====
  ipcMain.handle('knowledge/addWebclipImage', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const itemId = String(payload?.itemId || '');
    if (!itemId) throw new Error('itemId 不能为空');

    const existing = getItem(db, itemId);
    if (!existing) throw new Error('未找到该知识碎片');
    if (existing.type !== 'webclip') throw new Error('只能给 webclip 类型添加截图');

    let pngBuffer = payload?.pngBuffer;
    if (!pngBuffer) throw new Error('截图数据为空');

    const screenshotsDir = ensureScreenshotsDir(projectDir);
    const now = new Date();
    const stamp = formatStamp(now);
    const shortId = makeShortId();
    const baseName = `webclip_${stamp}_${shortId}.png`;
    const filePath = ensureUniqueDestPath(screenshotsDir, sanitizeFileName(baseName) || 'webclip.png');
    fs.writeFileSync(filePath, Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer));
    const relPath = String(path.relative(projectDir, filePath)).split(path.sep).join('/');

    let meta = {};
    try { meta = JSON.parse(existing.content_json || '{}'); } catch { meta = {}; }
    if (!Array.isArray(meta.images)) meta.images = [];
    meta.images.push(relPath);

    updateItem(db, itemId, {
      content_json: JSON.stringify(meta),
      updated_at: now.toISOString(),
    });

    emit(projectName, 'updated', itemId);
    return { ok: true, projectName, imagePath: relPath };
  });

  // ===== Remove Webclip Image =====
  ipcMain.handle('knowledge/removeWebclipImage', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const itemId = String(payload?.itemId || '');
    const imagePath = String(payload?.imagePath || '');
    if (!itemId) throw new Error('itemId 不能为空');
    if (!imagePath) throw new Error('imagePath 不能为空');

    const existing = getItem(db, itemId);
    if (!existing) throw new Error('未找到该知识碎片');
    if (existing.type !== 'webclip') throw new Error('只能对 webclip 类型操作截图');

    let meta = {};
    try { meta = JSON.parse(existing.content_json || '{}'); } catch { meta = {}; }
    if (!Array.isArray(meta.images)) meta.images = [];

    const normalizedTarget = imagePath.replace(/\\/g, '/');
    const idx = meta.images.findIndex((p) => p.replace(/\\/g, '/') === normalizedTarget);
    if (idx === -1) throw new Error('该截图不存在于此碎片中');

    meta.images.splice(idx, 1);
    delete meta._resolvedImages;

    const now = new Date();
    updateItem(db, itemId, {
      content_json: JSON.stringify(meta),
      updated_at: now.toISOString(),
    });

    try {
      const absPath = resolveInside(projectDir, imagePath);
      if (fs.existsSync(absPath)) {
        trashOrRm(absPath);
      }
    } catch (err) {
      console.warn('[knowledge] 删除截图文件失败:', err?.message || err);
    }

    emit(projectName, 'updated', itemId);
    return { ok: true, projectName };
  });

  // ===== F3: 手动触发 OCR =====
  // 对已存在的 screenshot 或 webclip 碎片重新跑 OCR：
  //   - screenshot: 用 item.content_path 指向的 PNG
  //   - webclip   : 用 item.content_json.images[imageIndex] 指向的截图（默认 0）
  // 完成后写回 content_text / content_json 并产出独立 snippet 知识碎片。
  ipcMain.handle('knowledge/runOcr', async (_evt, payload) => {
    const { db, projectName, projectDir } = getDb(payload);
    const itemId = String(payload?.itemId || '');
    if (!itemId) throw new Error('itemId 不能为空');
    const lang = payload?.lang === 'en' ? 'en' : 'ch';
    const runLlmSummary = payload?.runLlmSummary === true;
    const imageIndex = Number.isFinite(payload?.imageIndex) ? payload.imageIndex : 0;

    const item = getItem(db, itemId);
    if (!item) throw new Error('未找到该知识碎片');

    let imagePath = '';
    let type = item.type;
    if (item.type === 'screenshot' && item.content_path) {
      imagePath = resolveInside(projectDir, item.content_path);
    } else if (item.type === 'webclip' && item.content_json) {
      try {
        const meta = JSON.parse(item.content_json);
        const images = Array.isArray(meta?.images) ? meta.images : [];
        const target = images[imageIndex];
        if (!target) throw new Error('该 webclip 没有可识别的截图');
        imagePath = resolveInside(projectDir, target);
      } catch (err) {
        throw new Error(`解析 webclip 截图路径失败: ${err?.message || err}`);
      }
    } else {
      throw new Error('该碎片类型不支持 OCR（仅支持 screenshot / webclip）');
    }

    if (!fs.existsSync(imagePath)) throw new Error(`图片文件不存在: ${imagePath}`);

    // 同步等待识别完成（前端可以显示 loading 并直接拿到结果）。
    try {
      const result = await ocrService.recognize(imagePath, { lang });
      const text = String(result?.text || '').trim();
      if (!text) return { ok: true, projectName, recognized: false, message: '未识别到文字' };

      // 调用与自动 OCR 同一套写回逻辑 — 但这里我们已经在事务里了，直接复用 helper。
      await runOcrInBackground({
        imagePath,
        itemId,
        projectName,
        projectDir,
        db,
        lang,
        runLlmSummary,
        emit,
        type,
        ensureClipboardSnippetsDir,
        ensureUniqueDestPath,
        sanitizeFileName,
        formatStamp,
        makeShortId,
      });

      return {
        ok: true,
        projectName,
        recognized: true,
        text,
        confidence: result.confidence || 0,
        lang: result.lang || lang,
      };
    } catch (err) {
      console.warn('[knowledge/runOcr] failed:', err?.message || err);
      return { ok: false, projectName, error: String(err?.message || err) };
    }
  });

  // ===== Search =====
  ipcMain.handle('knowledge/search', async (_evt, payload) => {
    const { db, projectName } = getDb(payload);
    const query = String(payload?.query || '');
    if (!query.trim()) return { ok: true, projectName, items: [] };
    const items = listItems(db, { search: query, limit: payload?.limit || 50 });
    return { ok: true, projectName, items };
  });

  // ===== Stats =====
  ipcMain.handle('knowledge/stats', async (_evt, payload) => {
    const { db, projectName } = getDb(payload);
    const total = countItems(db, {});
    const snippets = countItems(db, { type: 'snippet' });
    const screenshots = countItems(db, { type: 'screenshot' });
    const notes = countItems(db, { type: 'note' });
    const webclips = countItems(db, { type: 'webclip' });
    const linked = countLinkedItems(db);
    return { ok: true, projectName, stats: { total, snippets, screenshots, notes, webclips, linked } };
  });

  // ===========================================================================
  //  Cross-project global aggregation
  // ===========================================================================

  const enumerateWorkspaceDirs = () => {
    const dirs = [];
    for (const [root, domain] of [[getProjectsRoot(), 'projects'], [getCasesRoot(), 'cases']]) {
      try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory() || isTombstoneProjectName(e.name)) continue;
          dirs.push({ name: e.name, domain, projectDir: path.join(root, e.name) });
        }
      } catch { /* root may not exist yet */ }
    }
    return dirs;
  };

  const getStudyDb = () => {
    const studyDir = getStudyRoot();
    if (!fs.existsSync(studyDir)) fs.mkdirSync(studyDir, { recursive: true });
    ensureProjectStructure('study', 'study');
    return { db: getProjectDb(studyDir), projectDir: studyDir };
  };

  ipcMain.handle('knowledge/listGlobal', async (_evt, payload) => {
    const filters = {
      type: payload?.type || undefined,
      search: payload?.search || undefined,
      limit: Number(payload?.limit) || 500,
      offset: Number(payload?.offset) || 0,
    };
    const projectNameFilter = payload?.projectName || undefined;
    const domainFilter = payload?.domain || undefined;
    const draftsOnly = payload?.draftsOnly === true;

    let allItems = [];

    if (!draftsOnly) {
      const dirs = enumerateWorkspaceDirs();
      for (const { name, domain, projectDir } of dirs) {
        if (projectNameFilter && name !== projectNameFilter) continue;
        if (domainFilter && domainFilter !== 'draft' && domain !== domainFilter) continue;
        try {
          const db = getProjectDb(projectDir);
          const items = listItems(db, { type: filters.type, search: filters.search, limit: 1000 });
          for (const it of items) {
            it._projectName = name;
            it._domain = domain;
            it._projectDir = projectDir;
            if (it.content_path) {
              try { it._absolutePath = resolveInside(projectDir, it.content_path); } catch { /* */ }
            }
          }
          allItems.push(...items);
        } catch { /* skip broken DBs */ }
      }
    }

    if (!projectNameFilter && (!domainFilter || domainFilter === 'draft')) {
      try {
        const { db: studyDb, projectDir: studyDir } = getStudyDb();
        const draftFilter = { type: filters.type, search: filters.search, limit: 1000 };
        const studyItems = listItems(studyDb, draftFilter);
        for (const it of studyItems) {
          const isDraft = it.source_kind === 'draft';
          it._projectName = isDraft ? '草稿箱' : 'Study';
          it._domain = isDraft ? 'draft' : 'study';
          it._projectDir = studyDir;
          if (it.content_path) {
            try { it._absolutePath = resolveInside(studyDir, it.content_path); } catch { /* */ }
          }
        }
        if (draftsOnly || domainFilter === 'draft') {
          allItems.push(...studyItems.filter((i) => i.source_kind === 'draft'));
        } else {
          allItems.push(...studyItems);
        }
      } catch { /* */ }
    }

    allItems.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });

    const total = allItems.length;
    const sliced = allItems.slice(filters.offset, filters.offset + filters.limit);
    return { ok: true, items: sliced, total };
  });

  ipcMain.handle('knowledge/statsGlobal', async () => {
    let total = 0, snippets = 0, screenshots = 0, notes = 0, webclips = 0, drafts = 0, linked = 0;
    const byProject = [];

    const dirs = enumerateWorkspaceDirs();
    for (const { name, domain, projectDir } of dirs) {
      try {
        const db = getProjectDb(projectDir);
        const t = countItems(db, {});
        const s = countItems(db, { type: 'snippet' });
        const sc = countItems(db, { type: 'screenshot' });
        const n = countItems(db, { type: 'note' });
        const w = countItems(db, { type: 'webclip' });
        const l = countLinkedItems(db);
        total += t; snippets += s; screenshots += sc; notes += n; webclips += w; linked += l;
        byProject.push({ name, domain, total: t, snippets: s, screenshots: sc, notes: n, webclips: w, linked: l });
      } catch { /* skip */ }
    }

    try {
      const { db: studyDb } = getStudyDb();
      const allStudy = countItems(studyDb, {});
      const draftRows = studyDb.prepare("SELECT COUNT(*) as cnt FROM knowledge_items WHERE source_kind = 'draft'").get();
      drafts = draftRows?.cnt || 0;
      total += allStudy;
      snippets += countItems(studyDb, { type: 'snippet' });
      screenshots += countItems(studyDb, { type: 'screenshot' });
      notes += countItems(studyDb, { type: 'note' });
      webclips += countItems(studyDb, { type: 'webclip' });
      linked += countLinkedItems(studyDb);
      if (allStudy > 0) byProject.push({ name: 'Study', domain: 'study', total: allStudy, drafts });
    } catch { /* */ }

    const allTags = {};
    for (const { projectDir } of dirs) {
      try {
        const db = getProjectDb(projectDir);
        const rows = db.prepare('SELECT tags FROM knowledge_items').all();
        for (const r of rows) {
          try {
            const tags = JSON.parse(r.tags || '[]');
            for (const t of tags) { allTags[t] = (allTags[t] || 0) + 1; }
          } catch { /* */ }
        }
      } catch { /* */ }
    }
    try {
      const { db: studyDb } = getStudyDb();
      const rows = studyDb.prepare('SELECT tags FROM knowledge_items').all();
      for (const r of rows) {
        try {
          const tags = JSON.parse(r.tags || '[]');
          for (const t of tags) { allTags[t] = (allTags[t] || 0) + 1; }
        } catch { /* */ }
      }
    } catch { /* */ }

    const tagDistribution = Object.entries(allTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    return {
      ok: true,
      stats: { total, snippets, screenshots, notes, webclips, drafts, linked, byProject, tagDistribution },
    };
  });

  // ===========================================================================
  //  Draft system (Study DB)
  // ===========================================================================

  ipcMain.handle('knowledge/createDraft', async (_evt, payload) => {
    const type = String(payload?.type || 'snippet');
    const { db, projectDir } = getStudyDb();

    const now = new Date();
    const stamp = formatStamp(now);
    const shortId = makeShortId();

    let contentPath = '';
    let contentText = String(payload?.content_text || payload?.text || '');
    const contentJson = payload?.content_json || null;

    if (type === 'snippet') {
      const trimmed = contentText.trim();
      if (!trimmed) throw new Error('内容为空');
      const snippetsDir = ensureClipboardSnippetsDir(projectDir);
      const baseName = `${stamp}-${shortId}.txt`;
      const filePath = ensureUniqueDestPath(snippetsDir, sanitizeFileName(baseName) || 'snippet.txt');
      fs.writeFileSync(filePath, contentText, 'utf-8');
      contentPath = String(path.relative(projectDir, filePath)).split(path.sep).join('/');
    } else if (type === 'screenshot') {
      let pngBuffer = payload?.pngBuffer;
      if (!pngBuffer) throw new Error('截图数据为空');
      const screenshotsDir = ensureScreenshotsDir(projectDir);
      const baseName = `${stamp}-${shortId}.png`;
      const filePath = ensureUniqueDestPath(screenshotsDir, sanitizeFileName(baseName) || 'screenshot.png');
      fs.writeFileSync(filePath, Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer));
      contentPath = String(path.relative(projectDir, filePath)).split(path.sep).join('/');
    } else if (type === 'webclip') {
      const url = String(payload?.url || '').trim();
      if (url) {
        // F2: 使用 fetchWeb (auto 模式：先渲染再降级)，草稿默认不存截图。
        const result = await fetchWeb(url, { mode: 'auto', screenshot: false });
        if (result.ok && (result.markdown || result.textContent)) {
          contentText = result.markdown || result.textContent || '';
          const summarySource = result.textContent || result.markdown || '';
          const summary = summarySource.trim().length > 100 ? await summarizeContent(summarySource) : '';
          payload = {
            ...payload,
            title: payload?.title || result.title || url.slice(0, 60),
            summary: summary || result.excerpt || '',
            source_url: url,
            content_json: JSON.stringify({
              images: [],
              readability: { siteName: result.siteName || '', excerpt: result.excerpt || '' },
              renderMode: result.renderMode || 'http_fallback',
              markdown: result.markdown || '',
              fetchedAt: now.toISOString(),
              finalUrl: result.url || url,
            }),
          };
        }
      }
    }

    const id = `${type.slice(0, 4)}_${stamp}_${shortId}`;
    const preview = contentText.trim().length > 200 ? `${contentText.trim().slice(0, 200)}…` : contentText.trim();
    const title = payload?.title || (contentText ? contentText.split(/\r?\n/)[0].slice(0, 40) : '') || '草稿';

    const item = createItem(db, {
      id,
      type,
      title,
      content_text: (type === 'note' || type === 'webclip') ? contentText : preview,
      content_json: (payload?.content_json || contentJson) ? (typeof (payload?.content_json || contentJson) === 'string' ? (payload?.content_json || contentJson) : JSON.stringify(payload?.content_json || contentJson)) : null,
      content_path: contentPath,
      summary: payload?.summary || '',
      tags: Array.isArray(payload?.tags) ? payload.tags : ['草稿'],
      importance: payload?.importance || null,
      source_kind: 'draft',
      source_url: payload?.source_url || null,
      pinned: false,
      archived: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    emit('study', 'created', id);
    return { ok: true, item, isDraft: true };
  });

  ipcMain.handle('knowledge/assignDraft', async (_evt, payload) => {
    const itemId = String(payload?.itemId || '');
    const targetProjectName = String(payload?.targetProjectName || '');
    const targetDomain = String(payload?.targetDomain || 'projects');
    if (!itemId) throw new Error('itemId 不能为空');
    if (!targetProjectName) throw new Error('目标项目名称不能为空');

    const { db: studyDb, projectDir: studyDir } = getStudyDb();
    const sourceItem = getItem(studyDb, itemId);
    if (!sourceItem) throw new Error('未找到该草稿');
    if (sourceItem.source_kind !== 'draft') throw new Error('该碎片不是草稿');

    const { projectDir: targetDir } = getWorkspaceDirOrThrow(targetProjectName, targetDomain);
    ensureProjectStructure(targetProjectName, targetDomain);
    const targetDb = getProjectDb(targetDir);

    const now = new Date();
    const stamp = formatStamp(now);
    const shortId = makeShortId();
    const newId = `${sourceItem.type.slice(0, 4)}_${stamp}_${shortId}`;

    let newContentPath = '';
    if (sourceItem.content_path) {
      try {
        const srcFile = resolveInside(studyDir, sourceItem.content_path);
        if (fs.existsSync(srcFile)) {
          const isScreenshot = sourceItem.content_path.includes('screenshots');
          const destDir = isScreenshot ? ensureScreenshotsDir(targetDir) : ensureClipboardSnippetsDir(targetDir);
          const destFile = ensureUniqueDestPath(destDir, path.basename(srcFile));
          fs.copyFileSync(srcFile, destFile);
          newContentPath = String(path.relative(targetDir, destFile)).split(path.sep).join('/');
        }
      } catch { /* best-effort */ }
    }

    let newContentJson = sourceItem.content_json || null;
    if (sourceItem.type === 'webclip' && newContentJson) {
      try {
        const meta = JSON.parse(newContentJson);
        if (Array.isArray(meta.images) && meta.images.length > 0) {
          const newImages = [];
          for (const relImg of meta.images) {
            try {
              const srcImg = resolveInside(studyDir, relImg);
              if (fs.existsSync(srcImg)) {
                const destDir = ensureScreenshotsDir(targetDir);
                const destFile = ensureUniqueDestPath(destDir, path.basename(srcImg));
                fs.copyFileSync(srcImg, destFile);
                newImages.push(String(path.relative(targetDir, destFile)).split(path.sep).join('/'));
              }
            } catch { /* skip */ }
          }
          meta.images = newImages;
          newContentJson = JSON.stringify(meta);
        }
      } catch { /* keep original */ }
    }

    const newItem = createItem(targetDb, {
      id: newId,
      type: sourceItem.type,
      title: sourceItem.title,
      content_text: sourceItem.content_text,
      content_json: newContentJson,
      content_path: newContentPath,
      summary: sourceItem.summary,
      tags: sourceItem.tags,
      importance: sourceItem.importance,
      source_kind: sourceItem.type === 'webclip' ? 'webclip' : sourceItem.type === 'screenshot' ? 'clipboardImage' : 'manual',
      source_url: sourceItem.source_url,
      pinned: sourceItem.pinned,
      archived: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    // Clean up source files from study dir
    if (sourceItem.content_path) {
      try {
        const srcFile = resolveInside(studyDir, sourceItem.content_path);
        if (fs.existsSync(srcFile)) await trashOrRm(srcFile);
      } catch { /* */ }
    }
    deleteItem(studyDb, itemId);

    emit(targetProjectName, 'created', newId);
    emit('study', 'deleted', itemId);
    return { ok: true, newItem, targetProjectName, targetDomain };
  });

  ipcMain.handle('knowledge/listDrafts', async (_evt, payload) => {
    const filters = {
      type: payload?.type || undefined,
      search: payload?.search || undefined,
      limit: Number(payload?.limit) || 200,
      offset: Number(payload?.offset) || 0,
    };
    try {
      const { db: studyDb, projectDir: studyDir } = getStudyDb();
      const all = listItems(studyDb, { ...filters, limit: 1000 });
      const draftItems = all.filter((i) => i.source_kind === 'draft');
      for (const it of draftItems) {
        it._projectName = '草稿箱';
        it._domain = 'draft';
        it._projectDir = studyDir;
        if (it.content_path) {
          try { it._absolutePath = resolveInside(studyDir, it.content_path); } catch { /* */ }
        }
      }
      const sliced = draftItems.slice(filters.offset, filters.offset + filters.limit);
      return { ok: true, items: sliced, total: draftItems.length };
    } catch (e) {
      return { ok: false, error: e.message, items: [], total: 0 };
    }
  });

  // ===== List all projects (for draft assignment UI) =====
  ipcMain.handle('knowledge/listProjects', async () => {
    const dirs = enumerateWorkspaceDirs();
    return { ok: true, projects: dirs.map((d) => ({ name: d.name, domain: d.domain })) };
  });

  // ===========================================================================
  // Board IPC handlers (Wabi-Sabi Board)
  // ===========================================================================

  ipcMain.handle('board/list', async () => {
    const { db } = getStudyDb();
    return { ok: true, boards: listBoards(db) };
  });

  ipcMain.handle('board/create', async (_evt, payload) => {
    const { db } = getStudyDb();
    const id = `board-${makeShortId()}`;
    const board = createBoard(db, { id, name: payload?.name || '新看板' });
    return { ok: true, board };
  });

  ipcMain.handle('board/rename', async (_evt, payload) => {
    const { db } = getStudyDb();
    const board = renameBoard(db, payload.id, payload.name);
    return { ok: true, board };
  });

  ipcMain.handle('board/delete', async (_evt, payload) => {
    const { db } = getStudyDb();
    deleteBoard(db, payload.id);
    return { ok: true };
  });

  ipcMain.handle('board/setMain', async (_evt, payload) => {
    const { db } = getStudyDb();
    const board = setMainBoard(db, payload.id);
    return { ok: true, board };
  });

  ipcMain.handle('board/getItems', async (_evt, payload) => {
    const { db: studyDb } = getStudyDb();
    const boardId = payload?.boardId;
    if (!boardId) throw new Error('boardId is required');
    const layoutItems = getBoardItems(studyDb, boardId);

    const grouped = {};
    for (const li of layoutItems) {
      const key = `${li.source_domain}::${li.source_project}`;
      if (!grouped[key]) grouped[key] = { domain: li.source_domain, project: li.source_project, ids: [] };
      grouped[key].ids.push(li.knowledge_id);
    }

    const knowledgeMap = {};

    for (const { domain, project, ids } of Object.values(grouped)) {
      try {
        let db;
        if (domain === 'draft' || domain === 'study') {
          db = studyDb;
        } else {
          const dirs = enumerateWorkspaceDirs();
          const dir = dirs.find((d) => d.name === project && d.domain === domain);
          if (!dir) continue;
          db = getProjectDb(dir.projectDir);
        }
        for (const kid of ids) {
          const item = getItem(db, kid);
          if (item) {
            if (item.content_path) {
              try {
                const baseDir = domain === 'draft' || domain === 'study'
                  ? studyDb === db ? getStudyRoot() : ''
                  : enumerateWorkspaceDirs().find((d) => d.name === project && d.domain === domain)?.projectDir || '';
                if (baseDir) item._absolutePath = resolveInside(baseDir, item.content_path);
              } catch { /* */ }
            }
            knowledgeMap[kid] = item;
          }
        }
      } catch { /* project may have been deleted */ }
    }

    const enriched = layoutItems.map((li) => ({
      ...li,
      knowledge: knowledgeMap[li.knowledge_id] || null,
    }));

    return { ok: true, items: enriched };
  });

  ipcMain.handle('board/addItem', async (_evt, payload) => {
    const { db } = getStudyDb();
    const id = `bi-${makeShortId()}`;
    const item = addBoardItem(db, {
      id,
      boardId: payload.boardId,
      knowledgeId: payload.knowledgeId,
      sourceProject: payload.sourceProject || '',
      sourceDomain: payload.sourceDomain || 'projects',
      x: payload.x,
      y: payload.y,
      rotation: payload.rotation,
      width: payload.width,
      height: payload.height,
    });
    return { ok: true, item };
  });

  ipcMain.handle('board/removeItem', async (_evt, payload) => {
    const { db } = getStudyDb();
    removeBoardItem(db, payload.id);
    return { ok: true };
  });

  ipcMain.handle('board/updateLayout', async (_evt, payload) => {
    const { db } = getStudyDb();
    updateBoardLayout(db, payload.boardId, payload.items || []);
    return { ok: true };
  });

  ipcMain.handle('board/createAndAdd', async (_evt, payload) => {
    const { db, projectDir } = getStudyDb();

    const type = String(payload?.type || 'snippet');
    const now = new Date();
    const stamp = formatStamp(now);
    const shortId = makeShortId();

    let contentPath = '';
    let contentText = String(payload?.content_text || payload?.text || '');
    const contentJson = payload?.content_json || null;

    if (type === 'snippet') {
      const dir = ensureClipboardSnippetsDir(projectDir);
      const fname = `${stamp}-${shortId}.txt`;
      fs.writeFileSync(path.join(dir, fname), contentText, 'utf-8');
      contentPath = `clipboard-snippets/${fname}`;
    }

    const itemId = `ki-${stamp}-${shortId}`;
    createItem(db, {
      id: itemId,
      type,
      title: payload?.title || contentText.slice(0, 40) || `新建${type}`,
      content_text: contentText,
      content_json: contentJson ? JSON.stringify(contentJson) : null,
      content_path: contentPath,
      tags: JSON.stringify(payload?.tags || []),
      source_kind: 'draft',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    const biId = `bi-${makeShortId()}`;
    const boardItem = addBoardItem(db, {
      id: biId,
      boardId: payload.boardId,
      knowledgeId: itemId,
      sourceProject: '',
      sourceDomain: 'draft',
      x: payload.x ?? 200 + Math.random() * 300,
      y: payload.y ?? 200 + Math.random() * 200,
      rotation: payload.rotation ?? (Math.random() * 6 - 3),
      width: payload.width,
    });

    const knowledge = getItem(db, itemId);
    return { ok: true, item: { ...boardItem, knowledge } };
  });

  ipcMain.handle('board/stats', async () => {
    const { db } = getStudyDb();
    const boards = listBoards(db);
    const stats = boards.map((b) => ({
      ...b,
      itemCount: countBoardItems(db, b.id),
    }));
    return { ok: true, stats };
  });

  // --- Connections ---

  ipcMain.handle('board/listConnections', async (_evt, payload) => {
    const { db } = getStudyDb();
    return { ok: true, connections: listConnections(db, payload.boardId) };
  });

  ipcMain.handle('board/addConnection', async (_evt, payload) => {
    const { db } = getStudyDb();
    const id = `conn-${makeShortId()}`;
    const conn = addConnection(db, {
      id,
      boardId: payload.boardId,
      fromItemId: payload.fromItemId,
      toItemId: payload.toItemId,
      color: payload.color,
    });
    return { ok: true, connection: conn };
  });

  ipcMain.handle('board/removeConnection', async (_evt, payload) => {
    const { db } = getStudyDb();
    removeConnection(db, payload.id);
    return { ok: true };
  });

  // --- Groups ---

  ipcMain.handle('board/listGroups', async (_evt, payload) => {
    const { db } = getStudyDb();
    return { ok: true, groups: listGroups(db, payload.boardId) };
  });

  ipcMain.handle('board/createGroup', async (_evt, payload) => {
    const { db } = getStudyDb();
    const id = `grp-${makeShortId()}`;
    const group = createGroup(db, {
      id,
      boardId: payload.boardId,
      name: payload.name,
      x: payload.x,
      y: payload.y,
      width: payload.width,
      height: payload.height,
      color: payload.color,
    });
    return { ok: true, group };
  });

  ipcMain.handle('board/updateGroup', async (_evt, payload) => {
    const { db } = getStudyDb();
    const group = updateGroup(db, payload.id, payload.patch || {});
    return { ok: true, group };
  });

  ipcMain.handle('board/deleteGroup', async (_evt, payload) => {
    const { db } = getStudyDb();
    deleteGroup(db, payload.id);
    return { ok: true };
  });

  // --- Locking ---

  ipcMain.handle('board/lockItem', async (_evt, payload) => {
    const { db } = getStudyDb();
    lockItem(db, payload.id);
    return { ok: true };
  });

  ipcMain.handle('board/unlockItem', async (_evt, payload) => {
    const { db } = getStudyDb();
    unlockItem(db, payload.id);
    return { ok: true };
  });

  ipcMain.handle('board/lockGroup', async (_evt, payload) => {
    const { db } = getStudyDb();
    lockGroup(db, payload.id);
    return { ok: true };
  });

  ipcMain.handle('board/unlockGroup', async (_evt, payload) => {
    const { db } = getStudyDb();
    unlockGroup(db, payload.id);
    return { ok: true };
  });

  // --- Board <-> Group conversion ---

  ipcMain.handle('board/convertBoardToGroup', async (_evt, payload) => {
    const { db } = getStudyDb();
    const mainBoard = db.prepare('SELECT * FROM boards WHERE is_main = 1').get();
    if (!mainBoard) return { ok: false, error: '主看板不存在' };
    const sourceBoard = db.prepare('SELECT * FROM boards WHERE id = ?').get(payload.sourceBoardId);
    if (!sourceBoard) return { ok: false, error: '源看板不存在' };
    const result = copyBoardToGroup(db, {
      sourceBoardId: payload.sourceBoardId,
      targetBoardId: mainBoard.id,
      groupName: sourceBoard.name || '',
      groupX: payload.groupX ?? 100,
      groupY: payload.groupY ?? 100,
    });
    return { ok: true, ...result };
  });

  ipcMain.handle('board/convertGroupToBoard', async (_evt, payload) => {
    const { db } = getStudyDb();
    const group = db.prepare('SELECT * FROM board_groups WHERE id = ?').get(payload.groupId);
    if (!group) return { ok: false, error: '分组不存在' };
    const result = copyGroupToBoard(db, {
      groupId: payload.groupId,
      sourceBoardId: group.board_id,
      newBoardName: group.name || '新看板',
    });
    return { ok: true, ...result };
  });

  // --- Board style ---

  ipcMain.handle('board/updateBoardStyle', async (_evt, payload) => {
    const { db } = getStudyDb();
    const board = updateBoardStyle(db, payload.id, { bgStyle: payload.bgStyle, bgColor: payload.bgColor });
    return { ok: true, board };
  });

  // --- Timelines ---

  ipcMain.handle('board/listTimelines', async (_evt, payload) => {
    const { db } = getStudyDb();
    const tls = listTimelines(db, payload.boardId);
    return tls.map(tl => ({ ...tl, points: listTimelinePoints(db, tl.id) }));
  });

  ipcMain.handle('board/createTimeline', async (_evt, payload) => {
    const { db } = getStudyDb();
    return createTimeline(db, payload);
  });

  ipcMain.handle('board/updateTimeline', async (_evt, payload) => {
    const { db } = getStudyDb();
    return updateTimeline(db, payload.id, payload.patch);
  });

  ipcMain.handle('board/deleteTimeline', async (_evt, payload) => {
    const { db } = getStudyDb();
    deleteTimeline(db, payload.id);
    return { ok: true };
  });

  ipcMain.handle('board/addTimelinePoint', async (_evt, payload) => {
    const { db } = getStudyDb();
    return addTimelinePoint(db, payload);
  });

  ipcMain.handle('board/updateTimelinePoint', async (_evt, payload) => {
    const { db } = getStudyDb();
    return updateTimelinePoint(db, payload.id, payload.patch);
  });

  ipcMain.handle('board/deleteTimelinePoint', async (_evt, payload) => {
    const { db } = getStudyDb();
    deleteTimelinePoint(db, payload.id);
    return { ok: true };
  });
}

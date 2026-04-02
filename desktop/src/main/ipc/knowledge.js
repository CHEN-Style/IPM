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
import { fetchAndExtract, summarizeContent } from '../../../Agent/services/webclip.js';

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
  trashOrRm,
  emitKnowledgeChanged,
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
    const { db, projectName } = getDb(payload);
    const itemId = String(payload?.itemId || '');
    const targetPath = normalizeRelPathPosix(payload?.targetPath || '');
    const targetKind = String(payload?.targetKind || 'file').toLowerCase();
    if (!itemId) throw new Error('itemId 不能为空');
    if (!targetPath) throw new Error('targetPath 不能为空');
    if (targetPath === 'snippets' || targetPath.startsWith('snippets/') || targetPath === 'meta' || targetPath.startsWith('meta/')) {
      throw new Error('禁止关联到系统目录');
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
  ipcMain.handle('knowledge/createWebclip', async (_evt, payload) => {
    const { db, projectName } = getDb(payload);
    const url = String(payload?.url || '').trim();
    if (!url) throw new Error('URL 不能为空');

    const result = await fetchAndExtract(url);
    if (result.error && !result.textContent) {
      return { ok: false, projectName, error: result.error };
    }

    let summary = '';
    if (result.textContent && result.textContent.trim().length > 100) {
      summary = await summarizeContent(result.textContent);
    }

    let hostname = '';
    try { hostname = new URL(url).hostname; } catch { /* ignore */ }

    const now = new Date();
    const stamp = formatStamp(now);
    const shortId = makeShortId();
    const id = `webc_${stamp}_${shortId}`;
    const title = result.title || hostname || url.slice(0, 60);

    const contentJson = JSON.stringify({
      images: [],
      readability: {
        siteName: result.siteName || '',
        excerpt: result.excerpt || '',
      },
    });

    const item = createItem(db, {
      id,
      type: 'webclip',
      title,
      content_text: result.textContent || '',
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
    return {
      ok: true,
      projectName,
      item,
      fetchError: result.error || null,
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
}

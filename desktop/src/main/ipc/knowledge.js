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
        const result = await fetchAndExtract(url);
        if (!result.error || result.textContent) {
          contentText = result.textContent || '';
          const summary = contentText.trim().length > 100 ? await summarizeContent(contentText) : '';
          payload = {
            ...payload,
            title: payload?.title || result.title || url.slice(0, 60),
            summary: summary || result.excerpt || '',
            source_url: url,
            content_json: JSON.stringify({ images: [], readability: { siteName: result.siteName || '', excerpt: result.excerpt || '' } }),
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

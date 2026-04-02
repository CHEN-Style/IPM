import fs from 'node:fs';
import path from 'node:path';

export function registerSnippetsIpc({
  ipcMain,
  getWorkspaceDirOrThrow,
  ensureProjectStructure,
  migrateLegacySnippetRecordFilesIfNeeded,
  migrateLegacyItemsJsonIfNeeded,
  ensureClipboardSnippetsDir,
  getClipboardRecordPath,
  getProjectLogPath,
  formatStamp,
  makeShortId,
  ensureUniqueDestPath,
  sanitizeFileName,
  safeReadJson,
  atomicWriteFileSync,
  appendJsonl,
  emitClipboardRecordChanged,
  ensureClipboardRecordDoc,
  normalizeRelPathPosix,
  resolveInside,
  trashOrRm,
}) {
  if (!ipcMain) throw new Error('registerSnippetsIpc: ipcMain is required');

  // ===== [DEPRECATED] Use knowledge/create instead =====
  ipcMain.handle('snippets/saveClipboardText', async (_evt, payload) => {
    console.warn('[DEPRECATED] snippets/saveClipboardText — use knowledge/create with type=snippet instead');
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const text = String(payload?.text ?? '');
    const trimmed = text.trim();
    if (!trimmed) throw new Error('剪贴板内容为空');

    // Ensure dirs/files
    ensureProjectStructure(projectName, payload?.domain);
    migrateLegacySnippetRecordFilesIfNeeded(projectDir, projectName);
    const snippetsDir = ensureClipboardSnippetsDir(projectDir);
    migrateLegacyItemsJsonIfNeeded(projectDir, projectName);
    const recordPath = getClipboardRecordPath(projectDir);
    const logPath = getProjectLogPath(projectDir);

    // Write txt file (one snippet -> one file)
    const now = new Date();
    const stamp = formatStamp(now);
    const baseName = `${stamp}-${makeShortId()}.txt`;
    const filePath = ensureUniqueDestPath(snippetsDir, sanitizeFileName(baseName) || 'snippet.txt');
    fs.writeFileSync(filePath, text, 'utf-8');

    const relPath = String(path.relative(projectDir, filePath)).split(path.sep).join('/');
    const id = `snip_${stamp}_${makeShortId()}`;
    const preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
    const title = trimmed.split(/\r?\n/)[0].slice(0, 40) || '知识碎片';

    const doc = safeReadJson(recordPath, null) || {
      schemaVersion: 1,
      projectName,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      items: [],
    };
    doc.schemaVersion = doc.schemaVersion || 1;
    doc.projectName = doc.projectName || projectName;
    doc.items = Array.isArray(doc.items) ? doc.items : [];

    const item = {
      id,
      type: 'snippet',
      createdAt: now.toISOString(),
      title,
      summary: '',
      tags: ['temp'],
      pinned: false,
      archived: false,
      content: {
        format: 'text',
        relPath,
        preview,
      },
      source: {
        kind: 'clipboardText',
      },
    };
    doc.items.unshift(item);
    doc.updatedAt = now.toISOString();
    atomicWriteFileSync(recordPath, JSON.stringify(doc, null, 2), 'utf-8');

    try {
      appendJsonl(logPath, {
        ts: now.toISOString(),
        event: 'snippet.clipboard.saved',
        projectName,
        id,
        relPath,
        size: text.length,
      });
    } catch {
      // ignore logging errors in MVP
    }

    try {
      emitClipboardRecordChanged({ projectName, type: 'created', id, relPath });
    } catch {
      // ignore
    }

    return { ok: true, projectName, id, relPath };
  });

  // ===== [DEPRECATED] Use knowledge/* APIs instead =====
  ipcMain.handle('snippets/clipboardRecord/list', async (_evt, payload) => {
    console.warn('[DEPRECATED] snippets/clipboardRecord/list — use knowledge/list instead');
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    ensureProjectStructure(projectName, payload?.domain);
    migrateLegacySnippetRecordFilesIfNeeded(projectDir, projectName);
    migrateLegacyItemsJsonIfNeeded(projectDir, projectName);
    const doc = ensureClipboardRecordDoc(projectDir, projectName);
    doc.schemaVersion = doc.schemaVersion || 1;
    doc.projectName = doc.projectName || projectName;
    doc.items = Array.isArray(doc.items) ? doc.items : [];
    return { ok: true, projectName, record: doc };
  });

  ipcMain.handle('snippets/clipboardRecord/updateMeta', async (_evt, payload) => {
    console.warn('[DEPRECATED] snippets/clipboardRecord/updateMeta — use knowledge/update instead');
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const id = String(payload?.id || '');
    const patch = payload?.patch && typeof payload.patch === 'object' ? payload.patch : {};
    if (!id) throw new Error('id 不能为空');

    ensureProjectStructure(projectName, payload?.domain);
    migrateLegacySnippetRecordFilesIfNeeded(projectDir, projectName);
    migrateLegacyItemsJsonIfNeeded(projectDir, projectName);
    const recordPath = getClipboardRecordPath(projectDir);
    const doc = ensureClipboardRecordDoc(projectDir, projectName);
    doc.items = Array.isArray(doc.items) ? doc.items : [];
    const idx = doc.items.findIndex((x) => String(x?.id || '') === id);
    if (idx < 0) throw new Error('未找到该知识碎片');

    const item = doc.items[idx];
    if (typeof patch.title === 'string') {
      item.title = patch.title;
    }
    if (Array.isArray(patch.tags)) {
      item.tags = patch.tags.map((t) => String(t)).filter(Boolean);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'importance')) {
      const v = patch.importance;
      if (v === null || v === undefined || v === '') {
        item.importance = undefined;
      } else {
        const s = String(v).toLowerCase();
        if (s !== 'low' && s !== 'medium' && s !== 'high') throw new Error('importance 必须为 low/medium/high');
        item.importance = s;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'linkedTo')) {
      const v = patch.linkedTo;
      if (v === null) {
        item.linkedTo = null;
      } else if (v && typeof v === 'object') {
        const relPath = normalizeRelPathPosix(v.relPath || '');
        const kind = String(v.kind || '').toLowerCase();
        if (!relPath) throw new Error('linkedTo.relPath 不能为空');
        if (relPath === 'snippets' || relPath.startsWith('snippets/') || relPath === 'meta' || relPath.startsWith('meta/')) {
          throw new Error('禁止关联到系统目录（snippets/meta）');
        }
        if (kind !== 'file' && kind !== 'dir') throw new Error('linkedTo.kind 必须为 file 或 dir');
        item.linkedTo = { relPath, kind };
      } else {
        throw new Error('linkedTo 格式不正确');
      }
    }

    const now = new Date().toISOString();
    item.updatedAt = now;
    doc.updatedAt = now;
    atomicWriteFileSync(recordPath, JSON.stringify(doc, null, 2), 'utf-8');

    try {
      emitClipboardRecordChanged({ projectName, type: 'updated', id });
    } catch {
      // ignore
    }
    return { ok: true, projectName, item };
  });

  ipcMain.handle('snippets/clipboardRecord/updateContent', async (_evt, payload) => {
    console.warn('[DEPRECATED] snippets/clipboardRecord/updateContent — use knowledge/update instead');
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const id = String(payload?.id || '');
    const text = String(payload?.text ?? '');
    if (!id) throw new Error('id 不能为空');

    ensureProjectStructure(projectName, payload?.domain);
    migrateLegacySnippetRecordFilesIfNeeded(projectDir, projectName);
    migrateLegacyItemsJsonIfNeeded(projectDir, projectName);
    const recordPath = getClipboardRecordPath(projectDir);
    const doc = ensureClipboardRecordDoc(projectDir, projectName);
    doc.items = Array.isArray(doc.items) ? doc.items : [];
    const idx = doc.items.findIndex((x) => String(x?.id || '') === id);
    if (idx < 0) throw new Error('未找到该知识碎片');

    const item = doc.items[idx];
    const relPath = normalizeRelPathPosix(item?.content?.relPath || '');
    if (!relPath) throw new Error('content.relPath 缺失');
    if (!(relPath === 'snippets/clipboard' || relPath.startsWith('snippets/clipboard/')) || !relPath.toLowerCase().endsWith('.txt')) {
      throw new Error('仅允许更新 snippets/clipboard 下的 .txt 内容');
    }

    const target = resolveInside(projectDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf-8');

    const trimmed = String(text || '').trim();
    const preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
    item.content = item.content && typeof item.content === 'object' ? item.content : { format: 'text', relPath, preview: '' };
    item.content.preview = preview;

    const now = new Date().toISOString();
    item.updatedAt = now;
    doc.updatedAt = now;
    atomicWriteFileSync(recordPath, JSON.stringify(doc, null, 2), 'utf-8');

    try {
      emitClipboardRecordChanged({ projectName, type: 'updated', id, relPath });
    } catch {
      // ignore
    }
    return { ok: true, projectName, item };
  });

  ipcMain.handle('snippets/clipboardRecord/delete', async (_evt, payload) => {
    console.warn('[DEPRECATED] snippets/clipboardRecord/delete — use knowledge/delete instead');
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const id = String(payload?.id || '');
    if (!id) throw new Error('id 不能为空');

    ensureProjectStructure(projectName, payload?.domain);
    migrateLegacySnippetRecordFilesIfNeeded(projectDir, projectName);
    migrateLegacyItemsJsonIfNeeded(projectDir, projectName);
    const recordPath = getClipboardRecordPath(projectDir);
    const doc = ensureClipboardRecordDoc(projectDir, projectName);
    doc.items = Array.isArray(doc.items) ? doc.items : [];
    const idx = doc.items.findIndex((x) => String(x?.id || '') === id);
    if (idx < 0) return { ok: true, projectName, deleted: false };

    const item = doc.items[idx];
    const relPath = normalizeRelPathPosix(item?.content?.relPath || '');
    // remove from record
    doc.items.splice(idx, 1);
    const now = new Date().toISOString();
    doc.updatedAt = now;
    atomicWriteFileSync(recordPath, JSON.stringify(doc, null, 2), 'utf-8');

    // delete content file (best-effort)
    if (relPath && (relPath === 'snippets/clipboard' || relPath.startsWith('snippets/clipboard/')) && relPath.toLowerCase().endsWith('.txt')) {
      try {
        const target = resolveInside(projectDir, relPath);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          await trashOrRm(target);
        }
      } catch {
        // ignore
      }
    }

    try {
      emitClipboardRecordChanged({ projectName, type: 'deleted', id, relPath });
    } catch {
      // ignore
    }
    return { ok: true, projectName, deleted: true };
  });
}



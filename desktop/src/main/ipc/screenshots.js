import fs from 'node:fs';
import path from 'node:path';

export function registerScreenshotsIpc({
  ipcMain,
  clipboardImageCache,
  getWorkspaceDirOrThrow,
  ensureProjectStructure,
  migrateLegacySnippetRecordFilesIfNeeded,
  migrateLegacyScreenshotFolderIfNeeded,
  migrateLegacyItemsJsonIfNeeded,
  ensureScreenshotsDir,
  getScreenshotRecordPath,
  getProjectLogPath,
  formatStamp,
  makeShortId,
  ensureUniqueDestPath,
  sanitizeFileName,
  safeReadJson,
  atomicWriteFileSync,
  appendJsonl,
}) {
  if (!ipcMain) throw new Error('registerScreenshotsIpc: ipcMain is required');

  // ===== [DEPRECATED] Use knowledge/create with type=screenshot instead =====
  ipcMain.handle('screenshots/saveClipboardImage', async (_evt, payload) => {
    console.warn('[DEPRECATED] screenshots/saveClipboardImage — use knowledge/create with type=screenshot instead');
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const token = String(payload?.token ?? '');
    if (!token) throw new Error('截图 token 为空');
    const cached = clipboardImageCache.get(token);
    if (!cached?.png) throw new Error('截图已过期，请重新截图');

    ensureProjectStructure(projectName, payload?.domain);
    migrateLegacySnippetRecordFilesIfNeeded(projectDir, projectName);
    migrateLegacyScreenshotFolderIfNeeded(projectDir);
    migrateLegacyItemsJsonIfNeeded(projectDir, projectName);
    const screenshotsDir = ensureScreenshotsDir(projectDir);
    const recordPath = getScreenshotRecordPath(projectDir);
    const logPath = getProjectLogPath(projectDir);

    const now = new Date();
    const stamp = formatStamp(now);
    const baseName = `${stamp}-${makeShortId()}.png`;
    const filePath = ensureUniqueDestPath(screenshotsDir, sanitizeFileName(baseName) || 'screenshot.png');
    fs.writeFileSync(filePath, cached.png);
    const relPath = String(path.relative(projectDir, filePath)).split(path.sep).join('/');

    const id = `shot_${stamp}_${makeShortId()}`;
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
      type: 'screenshot',
      createdAt: now.toISOString(),
      title: '截图',
      summary: '',
      tags: [],
      pinned: false,
      archived: false,
      content: {
        format: 'png',
        relPath,
        width: cached.width || 0,
        height: cached.height || 0,
      },
      source: {
        kind: 'clipboardImage',
      },
    };
    doc.items.unshift(item);
    doc.updatedAt = now.toISOString();
    atomicWriteFileSync(recordPath, JSON.stringify(doc, null, 2), 'utf-8');

    try {
      appendJsonl(logPath, {
        ts: now.toISOString(),
        event: 'screenshot.clipboard.saved',
        projectName,
        id,
        relPath,
        bytes: cached.png.length,
        width: cached.width || 0,
        height: cached.height || 0,
      });
    } catch {
      // ignore
    }

    // one-time token
    clipboardImageCache.delete(token);
    return { ok: true, projectName, id, relPath };
  });
}



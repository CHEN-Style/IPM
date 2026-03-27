import fs from 'node:fs';
import path from 'node:path';
import { appendClassifyEvent, lookupSourceInfo } from '../../../Agent/storage/classifyEvents.js';
import { matchPreferences, updatePreference } from '../../../Agent/storage/preferences.js';
import { getProjectDb } from '../../../Agent/db/index.js';
import { appendLog } from '../../../Agent/db/activityLog.js';

const DECAY_STEP = 0.1;
const DECAY_FLOOR = 0.1;

function decayPreferencesOnReject(projectDir, suggestion) {
  if (!suggestion) return;
  const fileName = suggestion.fileName || '';
  const ext = suggestion.ext || '';
  const suggestedFolder = suggestion.suggestedFolderRelPath || '';
  if (!suggestedFolder) return;

  let sourceDir = '';
  try {
    const src = lookupSourceInfo(projectDir, suggestion.sourceRelPath || '');
    sourceDir = src?.sourceDir || '';
  } catch {
    // ignore
  }

  const matched = matchPreferences(projectDir, { fileName, ext, sourceDir });
  const now = new Date().toISOString();

  for (const pref of matched) {
    if (pref.tendency?.folder !== suggestedFolder) continue;
    const oldStrength = pref.tendency?.strength ?? 0.7;
    const newStrength = Math.max(DECAY_FLOOR, oldStrength - DECAY_STEP);
    const evidence = pref.evidence || { totalMatched: 0, accepted: 0, rejected: 0, lastSeenAt: null };
    updatePreference(projectDir, pref.id, {
      tendency: { ...pref.tendency, strength: newStrength },
      evidence: {
        ...evidence,
        rejected: (evidence.rejected || 0) + 1,
        lastSeenAt: now,
      },
    });
  }
}

export function registerAiStorageIpc({
  ipcMain,
  getWorkspaceDirOrThrow,
  normalizeRelPathPosix,
  listAiSuggestions,
  setAiSuggestionStatus,
  ensureSourceIsTempOrThrow,
  ensureTargetFolderIsAllowedOrThrow,
  resolveInside,
  sanitizeFileName,
  ensureUniqueDestPath,
}) {
  if (!ipcMain) throw new Error('registerAiStorageIpc: ipcMain is required');

  // ===== AI Storage (staging area): ghost files & accept/reject =====
  ipcMain.handle('aiStorage/list', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const status = payload?.status ? String(payload.status) : '';
    const folderRelPath = payload?.folderRelPath ? normalizeRelPathPosix(payload.folderRelPath) : '';
    const items = listAiSuggestions(projectDir, projectName, { status, folderRelPath });
    return { ok: true, projectName, suggestions: items };
  });

  ipcMain.handle('aiStorage/reject', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const sourceRelPath = normalizeRelPathPosix(payload?.sourceRelPath ?? '');
    if (!sourceRelPath) throw new Error('sourceRelPath 不能为空');
    const userFeedback = payload?.userFeedback ? String(payload.userFeedback).trim() : null;

    const items = listAiSuggestions(projectDir, projectName, {});
    const s = items.find((x) => normalizeRelPathPosix(x?.sourceRelPath) === sourceRelPath);

    const now = new Date().toISOString();
    const updated = setAiSuggestionStatus(projectDir, projectName, sourceRelPath, { status: 'rejected', rejectedAt: now, userFeedback });
    if (!updated) throw new Error('未找到对应暂存记录');

    try {
      const src = lookupSourceInfo(projectDir, sourceRelPath);
      appendClassifyEvent(projectDir, {
        event: 'classify.rejected',
        fileName: s?.fileName || path.basename(sourceRelPath),
        ext: s?.ext || '',
        sourcePath: src?.sourcePath || '',
        sourceDir: src?.sourceDir || '',
        suggestedFolder: s?.suggestedFolderRelPath || '',
        rationale: s?.rationale || '',
        confidence: s?.confidence ?? null,
        classifiedBy: s?.classifiedBy || '',
        actualFolder: null,
        movedToRelPath: null,
        userFeedback,
      });
    } catch {
      // non-critical
    }

    try {
      decayPreferencesOnReject(projectDir, s);
    } catch {
      // non-critical
    }

    return { ok: true, projectName, suggestion: updated };
  });

  ipcMain.handle('aiStorage/accept', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const sourceRelPath = normalizeRelPathPosix(payload?.sourceRelPath ?? '');
    if (!sourceRelPath) throw new Error('sourceRelPath 不能为空');

    // Find suggestion
    const items = listAiSuggestions(projectDir, projectName, {});
    const s = items.find((x) => normalizeRelPathPosix(x?.sourceRelPath) === sourceRelPath);
    if (!s) throw new Error('未找到对应暂存记录');
    if (String(s.status) !== 'pending') return { ok: true, projectName, already: true, suggestion: s };

    // Guards
    const srcRel = ensureSourceIsTempOrThrow(sourceRelPath);
    const targetRel = ensureTargetFolderIsAllowedOrThrow(projectDir, s.suggestedFolderRelPath);

    const srcAbs = resolveInside(projectDir, srcRel);
    if (!fs.existsSync(srcAbs)) throw new Error('源文件不存在（可能已被移动或删除）');
    const st = fs.statSync(srcAbs);
    if (!st.isFile()) throw new Error('源路径不是文件');

    const targetDirAbs = resolveInside(projectDir, targetRel);
    if (!fs.existsSync(targetDirAbs)) throw new Error('目标目录不存在');
    const targetSt = fs.statSync(targetDirAbs);
    if (!targetSt.isDirectory()) throw new Error('目标不是目录');

    const baseName = sanitizeFileName(path.basename(srcAbs)) || 'file';
    const destAbs = ensureUniqueDestPath(targetDirAbs, baseName);
    fs.renameSync(srcAbs, destAbs);
    const movedToRelPath = String(path.relative(projectDir, destAbs)).split(path.sep).join('/');

    const now = new Date().toISOString();
    const updated = setAiSuggestionStatus(projectDir, projectName, sourceRelPath, {
      status: 'accepted',
      acceptedAt: now,
      movedToRelPath,
      targetRelPath: targetRel,
    });

    try {
      const db = getProjectDb(projectDir);
      appendLog(db, 'aiStorage.accepted', {
        ts: now,
        projectName,
        sourceRelPath,
        targetRelPath: targetRel,
        movedToRelPath,
      });
    } catch {
      // ignore
    }

    try {
      const src = lookupSourceInfo(projectDir, sourceRelPath);
      appendClassifyEvent(projectDir, {
        event: 'classify.accepted',
        fileName: s.fileName || path.basename(sourceRelPath),
        ext: s.ext || '',
        sourcePath: src?.sourcePath || '',
        sourceDir: src?.sourceDir || '',
        suggestedFolder: s.suggestedFolderRelPath || '',
        rationale: s.rationale || '',
        confidence: s.confidence ?? null,
        classifiedBy: s.classifiedBy || '',
        actualFolder: targetRel,
        movedToRelPath,
        userFeedback: null,
      });
    } catch {
      // non-critical
    }

    return { ok: true, projectName, movedToRelPath, suggestion: updated };
  });

  ipcMain.handle('aiStorage/acceptAll', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const folderRelPath = payload?.folderRelPath ? normalizeRelPathPosix(payload.folderRelPath) : '';
    const all = listAiSuggestions(projectDir, projectName, { status: 'pending', folderRelPath });
    let accepted = 0;
    let failed = 0;
    for (const s of all) {
      try {
        // reuse accept logic by direct invocation of internal operations
        const sourceRelPath = normalizeRelPathPosix(s.sourceRelPath || '');
        if (!sourceRelPath) continue;
        // Guards
        const srcRel = ensureSourceIsTempOrThrow(sourceRelPath);
        const targetRel = ensureTargetFolderIsAllowedOrThrow(projectDir, s.suggestedFolderRelPath);
        const srcAbs = resolveInside(projectDir, srcRel);
        if (!fs.existsSync(srcAbs)) throw new Error('源文件不存在');
        const st = fs.statSync(srcAbs);
        if (!st.isFile()) throw new Error('源不是文件');
        const targetDirAbs = resolveInside(projectDir, targetRel);
        if (!fs.existsSync(targetDirAbs) || !fs.statSync(targetDirAbs).isDirectory()) throw new Error('目标目录不存在');
        const baseName = sanitizeFileName(path.basename(srcAbs)) || 'file';
        const destAbs = ensureUniqueDestPath(targetDirAbs, baseName);
        fs.renameSync(srcAbs, destAbs);
        const movedToRelPath = String(path.relative(projectDir, destAbs)).split(path.sep).join('/');
        const now = new Date().toISOString();
        setAiSuggestionStatus(projectDir, projectName, sourceRelPath, {
          status: 'accepted',
          acceptedAt: now,
          movedToRelPath,
          targetRelPath: targetRel,
        });
        try {
          const src = lookupSourceInfo(projectDir, sourceRelPath);
          appendClassifyEvent(projectDir, {
            event: 'classify.accepted',
            fileName: s.fileName || path.basename(sourceRelPath),
            ext: s.ext || '',
            sourcePath: src?.sourcePath || '',
            sourceDir: src?.sourceDir || '',
            suggestedFolder: s.suggestedFolderRelPath || '',
            rationale: s.rationale || '',
            confidence: s.confidence ?? null,
            classifiedBy: s.classifiedBy || '',
            actualFolder: targetRel,
            movedToRelPath,
            userFeedback: null,
          });
        } catch {
          // non-critical
        }
        accepted += 1;
      } catch {
        failed += 1;
      }
    }
    return { ok: true, projectName, accepted, failed };
  });

  ipcMain.handle('aiStorage/rejectAll', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const folderRelPath = payload?.folderRelPath ? normalizeRelPathPosix(payload.folderRelPath) : '';
    const all = listAiSuggestions(projectDir, projectName, { status: 'pending', folderRelPath });
    const now = new Date().toISOString();
    let rejected = 0;
    for (const s of all) {
      const sourceRelPath = normalizeRelPathPosix(s.sourceRelPath || '');
      if (!sourceRelPath) continue;
      const updated = setAiSuggestionStatus(projectDir, projectName, sourceRelPath, { status: 'rejected', rejectedAt: now });
      if (updated) {
        rejected += 1;
        try {
          const src = lookupSourceInfo(projectDir, sourceRelPath);
          appendClassifyEvent(projectDir, {
            event: 'classify.rejected',
            fileName: s.fileName || path.basename(sourceRelPath),
            ext: s.ext || '',
            sourcePath: src?.sourcePath || '',
            sourceDir: src?.sourceDir || '',
            suggestedFolder: s.suggestedFolderRelPath || '',
            rationale: s.rationale || '',
            confidence: s.confidence ?? null,
            classifiedBy: s.classifiedBy || '',
            actualFolder: null,
            movedToRelPath: null,
            userFeedback: null,
          });
        } catch {
          // non-critical
        }
        try {
          decayPreferencesOnReject(projectDir, s);
        } catch {
          // non-critical
        }
      }
    }
    return { ok: true, projectName, rejected };
  });

  ipcMain.handle('aiStorage/getTrace', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const sourceRelPath = normalizeRelPathPosix(payload?.sourceRelPath ?? '');
    if (!sourceRelPath) throw new Error('sourceRelPath 不能为空');
    const items = listAiSuggestions(projectDir, projectName, {});
    const s = items.find((x) => normalizeRelPathPosix(x?.sourceRelPath) === sourceRelPath);
    if (!s) throw new Error('未找到对应暂存记录');
    return {
      ok: true,
      projectName,
      trace: Array.isArray(s.trace) ? s.trace : [],
      suggestion: {
        sourceRelPath: s.sourceRelPath,
        fileName: s.fileName,
        ext: s.ext,
        suggestedFolderRelPath: s.suggestedFolderRelPath,
        status: s.status,
        rationale: s.rationale,
        confidence: s.confidence,
        classifiedBy: s.classifiedBy,
        agentMeta: s.agentMeta,
        toolCallCount: s.toolCallCount,
      },
    };
  });
}



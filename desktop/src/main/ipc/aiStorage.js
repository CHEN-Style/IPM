import fs from 'node:fs';
import path from 'node:path';
import { appendClassifyEvent, lookupSourceInfo } from '../../../Agent/storage/classifyEvents.js';
import { matchPreferences, updatePreference } from '../../../Agent/storage/preferences.js';
import { getProjectDb } from '../../../Agent/db/index.js';
import { appendLog } from '../../../Agent/db/activityLog.js';

const DECAY_STEP = 0.1;
const DECAY_FLOOR = 0.1;

/** When temp source is gone: if file already exists at suggested target, treat as accepted; else mark stale. */
function acceptOrResolveStaleWhenSourceMissing({
  projectDir,
  projectName,
  s,
  sourceRelPath,
  targetRel,
  resolveInside,
  resolveContentForProject,
  contentRootForProject,
  sanitizeFileName,
  setAiSuggestionStatus,
  getProjectDb,
  appendLog,
  appendClassifyEvent,
  lookupSourceInfo,
}) {
  const baseName = sanitizeFileName(s.fileName || path.basename(sourceRelPath)) || path.basename(sourceRelPath);
  const destRelJoined = `${targetRel}/${baseName}`.replace(/\\/g, '/');
  let destAbs;
  try {
    // F1: 附属壳的 target 在外部根；resolveContentForProject 自动分流。
    destAbs = resolveContentForProject(projectDir, destRelJoined);
  } catch {
    destAbs = null;
  }
  const now = new Date().toISOString();

  if (destAbs && fs.existsSync(destAbs) && fs.statSync(destAbs).isFile()) {
    const root = contentRootForProject(projectDir);
    const movedToRelPath = String(path.relative(root, destAbs)).split(path.sep).join('/');
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
        note: 'source_already_moved',
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
    return { kind: 'already_applied', movedToRelPath, suggestion: updated };
  }

  const updated = setAiSuggestionStatus(projectDir, projectName, sourceRelPath, {
    status: 'stale',
    rejectedAt: now,
    userFeedback: '源文件已不在 temp，可能已通过其他方式移动；本条建议已自动关闭。',
  });
  return { kind: 'stale', suggestion: updated };
}

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
  // F1: 双根路径解析 + 附属壳感知
  resolveContentPath,
  isAttachedProject,
  sanitizeFileName,
  ensureUniqueDestPath,
}) {
  if (!ipcMain) throw new Error('registerAiStorageIpc: ipcMain is required');

  // F1: 选择正确的"内容根"。原生项目 = projectDir；附属壳 = 外部根。
  const contentRootForProject = (projectDir) => {
    if (typeof isAttachedProject === 'function' && isAttachedProject(projectDir)) {
      // 通过 resolveContentPath 解析空业务路径得到外部根（projectDir 本身在附属壳是 metadata 目录）
      try {
        return resolveContentPath(projectDir, '');
      } catch {
        return projectDir;
      }
    }
    return projectDir;
  };
  const resolveContentForProject = (projectDir, rel) => {
    if (typeof resolveContentPath === 'function') return resolveContentPath(projectDir, rel);
    return resolveInside(projectDir, rel);
  };

  // F1: 跨盘安全的物理移动 — 优先 rename，跨设备时回退 copy + unlink。
  const movePhysical = (srcAbs, destAbs) => {
    try {
      fs.renameSync(srcAbs, destAbs);
      return;
    } catch (e) {
      // EXDEV = 跨盘移动；Windows 下也可能给 ENOTSUP / EPERM。
      const code = e?.code || '';
      if (code === 'EXDEV' || code === 'ENOTSUP' || code === 'EPERM' || code === 'EACCES') {
        // 跨盘：copy + unlink
        fs.copyFileSync(srcAbs, destAbs);
        try { fs.unlinkSync(srcAbs); }
        catch { /* 源文件未删也不致命，下次清理 */ }
        return;
      }
      throw e;
    }
  };

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

    // F1: temp/ 始终在壳内（系统路径）；resolveContentPath 也会落到壳内。
    const srcAbs = resolveContentForProject(projectDir, srcRel);
    if (!fs.existsSync(srcAbs)) {
      const resolved = acceptOrResolveStaleWhenSourceMissing({
        projectDir,
        projectName,
        s,
        sourceRelPath,
        targetRel,
        resolveInside,
        resolveContentForProject,
        contentRootForProject,
        sanitizeFileName,
        setAiSuggestionStatus,
        getProjectDb,
        appendLog,
        appendClassifyEvent,
        lookupSourceInfo,
      });
      if (resolved.kind === 'already_applied') {
        return {
          ok: true,
          projectName,
          movedToRelPath: resolved.movedToRelPath,
          suggestion: resolved.suggestion,
          alreadyApplied: true,
        };
      }
      return {
        ok: true,
        projectName,
        stale: true,
        suggestion: resolved.suggestion,
      };
    }
    const st = fs.statSync(srcAbs);
    if (!st.isFile()) throw new Error('源路径不是文件');

    // F1: target 是业务路径 — 附属壳指向外部根。
    const targetDirAbs = resolveContentForProject(projectDir, targetRel);
    if (!fs.existsSync(targetDirAbs)) throw new Error('目标目录不存在');
    const targetSt = fs.statSync(targetDirAbs);
    if (!targetSt.isDirectory()) throw new Error('目标不是目录');

    const baseName = sanitizeFileName(path.basename(srcAbs)) || 'file';
    const destAbs = ensureUniqueDestPath(targetDirAbs, baseName);
    movePhysical(srcAbs, destAbs);
    const contentRoot = contentRootForProject(projectDir);
    const movedToRelPath = String(path.relative(contentRoot, destAbs)).split(path.sep).join('/');

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
    let staleClosed = 0;
    let alreadyApplied = 0;
    for (const s of all) {
      try {
        // reuse accept logic by direct invocation of internal operations
        const sourceRelPath = normalizeRelPathPosix(s.sourceRelPath || '');
        if (!sourceRelPath) continue;
        // Guards
        const srcRel = ensureSourceIsTempOrThrow(sourceRelPath);
        const targetRel = ensureTargetFolderIsAllowedOrThrow(projectDir, s.suggestedFolderRelPath);
        const srcAbs = resolveContentForProject(projectDir, srcRel);
        if (!fs.existsSync(srcAbs)) {
          const resolved = acceptOrResolveStaleWhenSourceMissing({
            projectDir,
            projectName,
            s,
            sourceRelPath,
            targetRel,
            resolveInside,
            resolveContentForProject,
            contentRootForProject,
            sanitizeFileName,
            setAiSuggestionStatus,
            getProjectDb,
            appendLog,
            appendClassifyEvent,
            lookupSourceInfo,
          });
          if (resolved.kind === 'already_applied') {
            alreadyApplied += 1;
            accepted += 1;
          } else {
            staleClosed += 1;
          }
          continue;
        }
        const st = fs.statSync(srcAbs);
        if (!st.isFile()) throw new Error('源不是文件');
        const targetDirAbs = resolveContentForProject(projectDir, targetRel);
        if (!fs.existsSync(targetDirAbs) || !fs.statSync(targetDirAbs).isDirectory()) throw new Error('目标目录不存在');
        const baseName = sanitizeFileName(path.basename(srcAbs)) || 'file';
        const destAbs = ensureUniqueDestPath(targetDirAbs, baseName);
        movePhysical(srcAbs, destAbs);
        const contentRoot = contentRootForProject(projectDir);
        const movedToRelPath = String(path.relative(contentRoot, destAbs)).split(path.sep).join('/');
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
    return { ok: true, projectName, accepted, failed, staleClosed, alreadyApplied };
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



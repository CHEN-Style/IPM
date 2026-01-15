import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { classifyFileOnce } from '../Agent/index.js';
import { upsertAiSuggestion, listAiSuggestions, setAiSuggestionStatus } from '../Agent/storage/aiStorage.js';
import { registerLocalFoldersIpc } from './main/modules/localFolders.js';
import { registerLocalExplorerIpc } from './main/modules/localExplorer.js';

const shouldAgentLog = () => {
  const v = String(process.env.IPM_AGENT_LOG || '').trim();
  if (v === '0' || v.toLowerCase() === 'false') return false;
  if (v === '1' || v.toLowerCase() === 'true') return true;
  // default: log in dev, quiet in packaged
  return !app.isPackaged;
};

const agentLog = (level, msg, extra = null) => {
  if (!shouldAgentLog()) return;
  const ts = new Date().toISOString();
  const prefix = `[IPM][Agent][${level}]`;
  const toAsciiSafe = (v) => {
    const escapeStr = (s) =>
      String(s).replace(/[^\x20-\x7E]/g, (ch) => {
        const cp = ch.codePointAt(0);
        if (!cp) return '';
        if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, '0')}`;
        return `\\u{${cp.toString(16)}}`;
      });
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return escapeStr(v);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.map(toAsciiSafe);
    if (typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        out[escapeStr(k)] = toAsciiSafe(val);
      }
      return out;
    }
    return escapeStr(String(v));
  };
  if (extra !== null && extra !== undefined) {
    console.log(`${ts} ${prefix} ${msg}`, toAsciiSafe(extra));
  } else {
    console.log(`${ts} ${prefix} ${msg}`);
  }
};

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Business archive root: fixed to repo folder in dev per requirement.
// - Dev:   <repo>/desktop/userfile
// - Packaged: fallback to userData/IPM/userfile (install dir is often not writable)
const getUserFileRoot = () => {
  if (!app.isPackaged) {
    return path.resolve(process.cwd(), 'userfile');
  }
  return path.join(app.getPath('userData'), 'IPM', 'userfile');
};

const getProjectsRoot = () => path.join(getUserFileRoot(), 'projects');
const getCasesRoot = () => path.join(getUserFileRoot(), 'cases');
const getStudyRoot = () => path.join(getUserFileRoot(), 'study');
const getAppRoot = () => path.join(getUserFileRoot(), '_app');
const getStatePath = () => path.join(getAppRoot(), 'state.json');

// ===== Domain: folder templates (MVP->vNext) =====
const WORK_BIZ_FOLDERS = ['收到资料', '过程文档', '调研研究', '交付成果'];
const STUDY_WORKSPACE_NAME = '学习';
const STUDY_BIZ_FOLDERS = ['模板', '案例', 'PPT', '专业文章', '调研报告', '读书笔记', '奇思妙想', '素材库'];
const STUDY_TEMPLATE_FOLDERS = ['合同模板', '条款模板', '文书模板'];

const normalizeWorkspaceDomain = (domain) => {
  const d = String(domain || '').trim().toLowerCase();
  if (d === 'cases' || d === 'case') return 'cases';
  if (d === 'study' || d === 'learning') return 'study';
  return 'projects';
};

const getWorkspaceRoot = (domain) => {
  const d = normalizeWorkspaceDomain(domain);
  if (d === 'cases') return getCasesRoot();
  if (d === 'study') return getStudyRoot();
  return getProjectsRoot();
};

const getBizFolderDefaultDescriptions = () => {
  return {
    收到资料:
      '外部收到的资料：客户提供的合同/协议/附件、沟通记录截图等，这类文件有可能文件名是较乱的，尤其是图片和截图。\n路径中包含“wechat”，“WXWork”的大概率是收到的资料',
    过程文档: '内部过程文档：律师撰写/修改中的工作稿、备忘录、版本迭代文件等（可频繁更新）。通常文件名中存在类似“v1”，（1）的文件都为过程文档',
    调研研究: '针对具体问题的调研与研究：法规检索、专题研究、文章/报告草稿、类案分析等。\n路径中包含Downloads的文件有概率为调研研究文件。',
    交付成果: '对外交付成果：定稿文件、正式出具材料、交付给客户的版本，如果文件名中出现多余后缀，前缀比如“v1”，“（1）”等，那么这个文件一定不是交付文件，请排除。',
  };
};

const getStudyFolderDefaultDescriptions = () => {
  return {
    模板: '模板沉淀：合同模板、条款模板、文书模板等通用材料。',
    '模板/合同模板': '通用合同模板（按行业/交易类型/版本管理）。',
    '模板/条款模板': '优质条款/风险提示条款/可复用条款库。',
    '模板/文书模板': '诉讼/仲裁/非诉文书模板、函件模板等。',
    案例: '类案/裁判文书/典型案例沉淀（可按关键词建立子目录）。',
    PPT: '演示材料/培训课件/会议分享 PPT 模板与成品。',
    专业文章: '专业文章/法条解读/剪藏网页/观点摘要等。',
    调研报告: '专题调研、研究报告、课题报告等。',
    读书笔记: '读书笔记/读后感/知识卡片整理。',
    奇思妙想: '阶段性思考、复盘、灵感与话题性总结（开放区）。',
    素材库: '兜底：暂时不确定归类的文件先放这里，后续再整理。',
  };
};

const sanitizeProjectName = (name) => {
  const raw = String(name ?? '').trim();
  if (!raw) return '';

  // Windows reserved characters: < > : " / \ | ? *
  let safe = raw.replace(/[<>:"/\\|?*]/g, '_');

  // Prevent path traversal / oddities
  safe = safe.replace(/\.\./g, '_');
  safe = safe.replace(/[. ]+$/g, ''); // Windows: no trailing dot/space

  return safe.trim();
};

const sanitizeFileName = (name) => {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  let safe = raw.replace(/[<>:"/\\|?*]/g, '_');
  safe = safe.replace(/\.\./g, '_');
  safe = safe.replace(/[. ]+$/g, '');
  return safe.trim();
};

const asPosixRel = (p) => String(p || '').split(path.sep).join('/');

const getProjectMetaDir = (projectDir) => path.join(projectDir, 'meta');
const getProjectLogPath = (projectDir) => path.join(getProjectMetaDir(projectDir), 'log.jsonl');
const getProjectStructurePath = (projectDir) => path.join(getProjectMetaDir(projectDir), 'structure.json');
const getTempSourceRecordPath = (projectDir) => path.join(getProjectMetaDir(projectDir), 'temp-source-record.json');

const getSnippetsDir = (projectDir) => path.join(projectDir, 'snippets');
const getSnippetsMetaDir = (projectDir) => path.join(getSnippetsDir(projectDir), 'snippets-meta');

// User uploads (NOT knowledge snippets)
const getPictureDir = (projectDir) => path.join(projectDir, 'picture');

// Knowledge snippets live under snippets/
const getSnippetClipboardDir = (projectDir) => path.join(getSnippetsDir(projectDir), 'clipboard');
const getSnippetScreenshotsDir = (projectDir) => path.join(getSnippetsDir(projectDir), 'screenshots');

// Knowledge snippet metadata lives under snippets/snippets-meta/
const getClipboardRecordPath = (projectDir) => path.join(getSnippetsMetaDir(projectDir), 'clipboard-record.json');
const getScreenshotRecordPath = (projectDir) => path.join(getSnippetsMetaDir(projectDir), 'screenshots-record.json');

const isSystemFolderRelPath = (relPath) => {
  const rp = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rp) return true; // root record is also "system"
  if (rp === '_app' || rp.startsWith('_app/')) return true;
  if (rp === 'meta' || rp.startsWith('meta/')) return true;
  if (rp === 'temp' || rp.startsWith('temp/')) return true;
  if (rp === 'snippets' || rp.startsWith('snippets/')) return true;
  if (rp === 'snippets/snippets-meta' || rp.startsWith('snippets/snippets-meta/')) return true;
  // legacy (older layout)
  if (rp === 'screenshots/screenshots-meta' || rp.startsWith('screenshots/screenshots-meta/')) return true;
  return false;
};

const normalizeRelPathPosix = (relPath) => {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
};

const isProtectedRelPath = (relPath) => {
  const rp = normalizeRelPathPosix(relPath);
  // User should not be allowed to delete/rename/move meta records (and temp)
  if (rp === 'meta' || rp.startsWith('meta/')) return true;
  if (rp === 'temp' || rp.startsWith('temp/')) return true;
  if (rp === 'snippets/snippets-meta' || rp.startsWith('snippets/snippets-meta/')) return true;
  // legacy (older layout)
  if (rp === 'screenshots/screenshots-meta' || rp.startsWith('screenshots/screenshots-meta/')) return true;
  return false;
};

const isProtectedFolderNameRelPath = (relPath) => {
  const rp = normalizeRelPathPosix(relPath);
  // These folders cannot be renamed/moved/deleted as folders (but their contents may be handled separately).
  if (WORK_BIZ_FOLDERS.includes(rp)) return true;
  if (rp === 'snippets') return true;
  if (rp === 'meta') return true;
  if (rp === 'temp') return true;
  return false;
};

const shouldExcludeFromStructureRelPath = (relPath) => {
  const rp = normalizeRelPathPosix(relPath);
  if (!rp) return false; // keep root
  if (rp === 'snippets' || rp.startsWith('snippets/')) return true;
  if (rp === 'meta' || rp.startsWith('meta/')) return true;
  if (rp === 'temp' || rp.startsWith('temp/')) return true;
  return false;
};

const buildFolderCandidatesFromStructure = (projectDir, projectName) => {
  const doc = safeReadJson(getProjectStructurePath(projectDir), null);
  const folders = doc && typeof doc === 'object' && doc.folders && typeof doc.folders === 'object' ? doc.folders : {};
  const candidates = Object.values(folders)
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      relPath: String(f.relPath || ''),
      name: String(f.name || ''),
      description: typeof f.description === 'string' ? f.description : '',
      system: Boolean(f.system),
    }))
    .filter((f) => f.relPath && f.name && !f.system && f.relPath !== '');
  // stable order (shorter path first)
  candidates.sort((a, b) => a.relPath.length - b.relPath.length);
  return candidates.map(({ relPath, name, description }) => ({ relPath, name, description }));
};

const ensureTargetFolderIsAllowedOrThrow = (projectDir, targetRelPath) => {
  const doc = safeReadJson(getProjectStructurePath(projectDir), null);
  const folders = doc && typeof doc === 'object' && doc.folders && typeof doc.folders === 'object' ? doc.folders : {};
  const rp = normalizeRelPathPosix(targetRelPath);
  const meta = folders[rp] && typeof folders[rp] === 'object' ? folders[rp] : null;
  if (!meta) throw new Error(`目标目录不在 structure.json 中：${rp}`);
  if (meta.system) throw new Error('目标目录为系统目录，禁止归档');
  if (rp === '') throw new Error('禁止归档到项目根目录');
  return rp;
};

const ensureSourceIsTempOrThrow = (sourceRelPath) => {
  const rp = normalizeRelPathPosix(sourceRelPath);
  if (!(rp === 'temp' || rp.startsWith('temp/'))) {
    throw new Error('仅允许从 temp 目录接受移动（MVP 限制）');
  }
  return rp;
};

const triggerAutoClassifyToAiStorage = async ({ domain, projectName, projectDir, sourceRelPath }) => {
  const startedAt = Date.now();
  try {
    const fileName = path.basename(String(sourceRelPath || ''));
    const ext = path.extname(fileName || '').replace(/^\./, '').toLowerCase();
    // Ensure structure exists (best-effort). structure.json excludes system folders by design.
    const d = normalizeWorkspaceDomain(domain);
    // IMPORTANT: study uses the workspace root; its "projectName" is a display name only.
    ensureProjectStructure(d === 'study' ? '' : projectName, d);
    const folders = buildFolderCandidatesFromStructure(projectDir, projectName);
    agentLog('INFO', 'trigger', { domain: d, projectName, sourceRelPath, fileName, ext, folderCandidates: folders.length });
    if (!folders.length) {
      agentLog('WARN', 'skip: no folder candidates from structure.json', { projectName, structurePath: getProjectStructurePath(projectDir) });
      return;
    }

    const tempSourceInfo = getTempSourceInfoByRelPath(projectDir, sourceRelPath);
    const sourceDir = tempSourceInfo?.sourceDir || '';

    const decision = await classifyFileOnce({
      projectName,
      sourceRelPath,
      fileName,
      ext,
      sourceDir,
      folders,
    });
    agentLog('INFO', 'decision', { domain: d, projectName, sourceRelPath, targetRelPath: decision.targetRelPath, ms: Date.now() - startedAt });

    // Stage result to ai-storage.json (no file move here)
    const written = upsertAiSuggestion(projectDir, projectName, {
      sourceRelPath,
      fileName,
      ext,
      suggestedFolderRelPath: decision.targetRelPath,
      status: 'pending',
      rationale: decision.rationale || '',
      agentMeta: decision.agentMeta || {},
    });
    agentLog('INFO', 'ai-storage upserted', { domain: d, projectName, sourceRelPath: written.sourceRelPath, suggestedFolderRelPath: written.suggestedFolderRelPath });
  } catch (e) {
    const msg = e?.message || String(e);
    agentLog('ERROR', 'failed', { domain: normalizeWorkspaceDomain(domain), projectName, sourceRelPath, error: msg, stack: e?.stack || '' });
  }
};

const ensureProjectStructure = (projectName, domain = 'projects') => {
  const d = normalizeWorkspaceDomain(domain);
  const effectiveName = projectName || (d === 'study' ? STUDY_WORKSPACE_NAME : projectName);
  const projectDir = path.join(getWorkspaceRoot(d), projectName || '');

  // vNext default structure:
  // - Projects/Cases business: 收到资料 / 过程文档 / 调研研究 / 交付成果
  // - Study business: 模板/案例/PPT/专业文章/调研报告/读书笔记/奇思妙想/素材库 (+ 模板子类)
  // - System: snippets / temp / meta
  const bizFolders = d === 'study' ? STUDY_BIZ_FOLDERS : WORK_BIZ_FOLDERS;
  for (const f of bizFolders) {
    fs.mkdirSync(path.join(projectDir, f), { recursive: true });
  }
  if (d === 'study') {
    for (const sub of STUDY_TEMPLATE_FOLDERS) {
      fs.mkdirSync(path.join(projectDir, '模板', sub), { recursive: true });
    }
  }
  fs.mkdirSync(getSnippetsDir(projectDir), { recursive: true });
  fs.mkdirSync(getProjectMetaDir(projectDir), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'temp'), { recursive: true });

  // Project logs (append-only)
  const logPath = getProjectLogPath(projectDir);
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf-8');

  // Snippets metadata (domain-local)
  const snippetsMetaDir = getSnippetsMetaDir(projectDir);
  fs.mkdirSync(snippetsMetaDir, { recursive: true });
  const clipboardRecordPath = getClipboardRecordPath(projectDir);
  if (!fs.existsSync(clipboardRecordPath)) {
    const now = new Date().toISOString();
    fs.writeFileSync(
      clipboardRecordPath,
      JSON.stringify({ schemaVersion: 1, projectName: effectiveName, createdAt: now, updatedAt: now, items: [] }, null, 2),
      'utf-8',
    );
  }

  const screenshotRecordPath = getScreenshotRecordPath(projectDir);
  if (!fs.existsSync(screenshotRecordPath)) {
    const now = new Date().toISOString();
    fs.writeFileSync(
      screenshotRecordPath,
      JSON.stringify({ schemaVersion: 1, projectName: effectiveName, createdAt: now, updatedAt: now, items: [] }, null, 2),
      'utf-8',
    );
  }

  // Project folder structure mirror (folders only; descriptions persisted)
  const structurePath = getProjectStructurePath(projectDir);
  if (!fs.existsSync(structurePath)) {
    try {
      const now = new Date().toISOString();
      const desc = d === 'study' ? getStudyFolderDefaultDescriptions() : getBizFolderDefaultDescriptions();
      const seedFolders =
        d === 'study' ? [...STUDY_BIZ_FOLDERS, ...STUDY_TEMPLATE_FOLDERS.map((x) => `模板/${x}`)] : WORK_BIZ_FOLDERS;
      const seeded = {
        schemaVersion: 1,
        projectName: effectiveName,
        createdAt: now,
        updatedAt: now,
        folders: Object.fromEntries(
          seedFolders.map((rp) => [
            rp,
            {
              relPath: rp,
              name: rp.split('/').slice(-1)[0],
              description: desc[rp] || '',
              system: false,
              createdAt: now,
              updatedAt: now,
            },
          ]),
        ),
      };
      syncStructureJson(projectDir, effectiveName, seeded);
    } catch {
      // best-effort
    }
  }

  return {
    name: effectiveName,
    path: projectDir,
    meta: {
      logPath,
      structurePath,
    },
  };
};

const readState = () => {
  try {
    if (!fs.existsSync(getStatePath())) return {};
    return JSON.parse(fs.readFileSync(getStatePath(), 'utf-8'));
  } catch {
    return {};
  }
};

const writeState = (state) => {
  fs.mkdirSync(getAppRoot(), { recursive: true });
  fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2), 'utf-8');
};

const normalizeProjectStatus = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'active' || s === 'pending' || s === 'archived') return s;
  return 'active';
};

const normalizeFloatingUploadMode = (mode) => {
  const v = String(mode || '').toLowerCase();
  if (v === 'auto' || v === 'confirm') return v;
  // default: require confirm (safer)
  return 'confirm';
};

const resolveInside = (baseDir, unsafeRelPath) => {
  const rel = String(unsafeRelPath ?? '');
  const target = path.resolve(baseDir, rel);
  const base = path.resolve(baseDir);
  if (target === base) return target;
  if (!target.startsWith(base + path.sep)) {
    throw new Error('路径非法');
  }
  return target;
};

const getWorkspaceDirOrThrow = (nameRaw, domain = 'projects') => {
  const d = normalizeWorkspaceDomain(domain);
  const name = sanitizeProjectName(nameRaw);
  if (!name) {
    if (d === 'study') {
      const projectDir = getStudyRoot();
      if (!fs.existsSync(projectDir)) throw new Error('目录不存在：study');
      return { domain: d, name: STUDY_WORKSPACE_NAME, projectDir };
    }
    throw new Error('名称不能为空');
  }
  const projectDir = path.join(getWorkspaceRoot(d), name);
  if (!fs.existsSync(projectDir)) throw new Error(`目录不存在：${name}`);
  return { domain: d, name, projectDir };
};

// Backward compatible wrapper for legacy callers (projects-only).
const getProjectDirOrThrow = (projectName) => getWorkspaceDirOrThrow(projectName, 'projects');

const ensureUniqueDestPath = (destDir, fileName) => {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = fileName;
  let i = 1;
  while (fs.existsSync(path.join(destDir, candidate))) {
    candidate = `${base} (${i})${ext}`;
    i += 1;
  }
  return path.join(destDir, candidate);
};

const atomicWriteFileSync = (filePath, data, encoding = 'utf-8') => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  fs.writeFileSync(tmpPath, data, encoding);
  if (fs.existsSync(bakPath)) {
    safeRmSync(bakPath);
  }
  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, bakPath);
  }
  fs.renameSync(tmpPath, filePath);
  if (fs.existsSync(bakPath)) {
    safeRmSync(bakPath);
  }
};

const safeReadJson = (filePath, fallback = null) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
};

// Record source info for files copied into temp/, keyed by sourceRelPath (temp/xxx)
const upsertTempSourceRecord = (projectDir, projectName, entry) => {
  const recordPath = getTempSourceRecordPath(projectDir);
  const nowIso = new Date().toISOString();
  const doc = safeReadJson(recordPath, null) || {
    schemaVersion: 1,
    projectName: projectName || '',
    createdAt: nowIso,
    updatedAt: nowIso,
    items: [],
  };

  doc.schemaVersion = doc.schemaVersion || 1;
  doc.projectName = doc.projectName || projectName || '';
  doc.items = Array.isArray(doc.items) ? doc.items : [];

  const sourceRelPath = normalizeRelPathPosix(entry?.sourceRelPath || '');
  if (!sourceRelPath) return null;

  const normalized = {
    sourceRelPath,
    sourcePath: String(entry?.sourcePath || ''),
    sourceDir: String(entry?.sourceDir || ''),
    fileName: String(entry?.fileName || ''),
    sourceSizeBytes: Number.isFinite(entry?.sourceSizeBytes) ? entry.sourceSizeBytes : null,
    capturedAt: entry?.capturedAt || nowIso,
  };

  const idx = doc.items.findIndex((x) => normalizeRelPathPosix(x?.sourceRelPath || '') === sourceRelPath);
  if (idx >= 0) {
    doc.items[idx] = { ...(doc.items[idx] || {}), ...normalized };
  } else {
    doc.items.push(normalized);
  }

  // prevent unbounded growth
  const MAX_ITEMS = 500;
  if (doc.items.length > MAX_ITEMS) {
    doc.items = doc.items.slice(doc.items.length - MAX_ITEMS);
  }

  doc.updatedAt = nowIso;
  atomicWriteFileSync(recordPath, JSON.stringify(doc, null, 2), 'utf-8');
  return normalized;
};

const deleteTempSourceRecordByRelPath = (projectDir, sourceRelPathRaw) => {
  const sourceRelPath = normalizeRelPathPosix(sourceRelPathRaw || '');
  if (!sourceRelPath) return false;
  const recordPath = getTempSourceRecordPath(projectDir);
  const doc = safeReadJson(recordPath, null);
  if (!doc || typeof doc !== 'object') return false;
  const items = Array.isArray(doc.items) ? doc.items : [];
  const next = items.filter((x) => normalizeRelPathPosix(x?.sourceRelPath || '') !== sourceRelPath);
  if (next.length === items.length) return false;
  doc.items = next;
  doc.updatedAt = new Date().toISOString();
  atomicWriteFileSync(recordPath, JSON.stringify(doc, null, 2), 'utf-8');
  return true;
};

const getTempSourceInfoByRelPath = (projectDir, sourceRelPathRaw) => {
  const sourceRelPath = normalizeRelPathPosix(sourceRelPathRaw || '');
  if (!sourceRelPath) return null;
  const recordPath = getTempSourceRecordPath(projectDir);
  const doc = safeReadJson(recordPath, null);
  const items = doc && typeof doc === 'object' && Array.isArray(doc.items) ? doc.items : [];
  const hit = items.find((x) => normalizeRelPathPosix(x?.sourceRelPath || '') === sourceRelPath);
  if (!hit || typeof hit !== 'object') return null;
  return {
    sourceRelPath,
    sourcePath: typeof hit.sourcePath === 'string' ? hit.sourcePath : '',
    sourceDir: typeof hit.sourceDir === 'string' ? hit.sourceDir : '',
  };
};

const safeRenameSync = (fromPath, toPath) => {
  try {
    fs.renameSync(fromPath, toPath);
    return true;
  } catch {
    return false;
  }
};

const appendJsonl = (filePath, obj) => {
  const line = JSON.stringify(obj) + '\n';
  fs.appendFileSync(filePath, line, 'utf-8');
};

const ensureTempDir = (projectDir) => {
  const tempDir = path.join(projectDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
};

const ensureClipboardSnippetsDir = (projectDir) => {
  const dir = getSnippetClipboardDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const ensureScreenshotsDir = (projectDir) => {
  const dir = getSnippetScreenshotsDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const makeShortId = () => Math.random().toString(36).slice(2, 6);
const pad2 = (n) => String(n).padStart(2, '0');
const formatStamp = (d) => {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
};

const ensureUniqueDirPath = (parentDir, folderName) => {
  let candidate = folderName;
  let i = 1;
  while (fs.existsSync(path.join(parentDir, candidate))) {
    candidate = `${folderName} (${i})`;
    i += 1;
  }
  return { name: candidate, fullPath: path.join(parentDir, candidate) };
};

const confirmAutoSuffix = async () => {
  const res = await dialog.showMessageBox({
    type: 'question',
    buttons: ['自动添加后缀', '取消'],
    defaultId: 0,
    cancelId: 1,
    title: '发现重名',
    message: '目标位置已存在同名文件/文件夹。',
    detail: '是否自动添加一个小后缀来避免重名？',
  });
  return res.response === 0;
};

const sleepSync = (ms) => {
  // Node.js synchronous sleep
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const makeWritableRecursiveSync = (targetPath) => {
  if (!fs.existsSync(targetPath)) return;
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isDirectory()) {
      try {
        fs.chmodSync(targetPath, 0o777);
      } catch {
        // ignore
      }
      const entries = fs.readdirSync(targetPath, { withFileTypes: true });
      for (const e of entries) {
        makeWritableRecursiveSync(path.join(targetPath, e.name));
      }
    } else {
      try {
        fs.chmodSync(targetPath, 0o666);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
};

const safeRmSync = (targetPath) => {
  // Windows may throw EPERM/EBUSY if files are read-only or temporarily locked.
  // We retry a few times and attempt to chmod to writable before retry.
  const maxRetries = 3;
  let lastErr = null;
  for (let i = 0; i <= maxRetries; i += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      const code = e?.code;
      // ENOTEMPTY can still happen on Windows due to filesystem delays/races even with recursive=true.
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOTEMPTY') {
        makeWritableRecursiveSync(targetPath);
        sleepSync(120 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('删除失败');
};

const waitUntilGoneSync = (targetPath, timeoutMs = 2500) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!fs.existsSync(targetPath)) return true;
    sleepSync(80);
  }
  return !fs.existsSync(targetPath);
};

const trashOrRm = async (targetPath) => {
  // Prefer recycle bin: behaves closer to Explorer and can reduce Windows locking edge cases.
  try {
    await shell.trashItem(targetPath);
    return;
  } catch {
    // fall back to hard delete
  }
  safeRmSync(targetPath);
};

const isEmptyDirSync = (dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) return true;
    const st = fs.statSync(dirPath);
    if (!st.isDirectory()) return false;
    const entries = fs.readdirSync(dirPath);
    return entries.length === 0;
  } catch {
    return false;
  }
};

const looksLikeValidProjectDirSync = (projectDir) => {
  try {
    if (!fs.existsSync(projectDir)) return false;
    const st = fs.statSync(projectDir);
    if (!st.isDirectory()) return false;
    // A valid project created by this app always has at least one of these.
    const mustHaveAny = [
      path.join(projectDir, WORK_BIZ_FOLDERS[0]),
      path.join(projectDir, WORK_BIZ_FOLDERS[1]),
      path.join(projectDir, WORK_BIZ_FOLDERS[2]),
      path.join(projectDir, WORK_BIZ_FOLDERS[3]),
      path.join(projectDir, 'snippets'),
      path.join(projectDir, 'meta'),
      path.join(projectDir, 'temp'),
    ];
    for (const p of mustHaveAny) {
      if (fs.existsSync(p)) return true;
    }
    return false;
  } catch {
    return false;
  }
};

const isTombstoneProjectName = (name) => {
  return String(name || '').startsWith('__deleted__');
};

const quarantineProjectDirSync = (projectsRoot, projectName) => {
  const base = `__deleted__${sanitizeFileName(projectName) || 'project'}__${Date.now()}`;
  const { fullPath } = ensureUniqueDirPath(projectsRoot, base);
  const src = path.join(projectsRoot, projectName);
  fs.renameSync(src, fullPath);
  return fullPath;
};

const listAllDirsRelPosix = (projectDir) => {
  const baseAbs = path.resolve(projectDir);
  const out = new Set(['']); // include root
  const stack = [{ abs: baseAbs, rel: '' }];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(cur.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (!name || name === '.' || name === '..') continue;
      const abs = path.join(cur.abs, name);
      const rel = cur.rel ? `${cur.rel}/${name}` : name;
      // Do not record system folders (snippets/meta/temp) in structure.json; also avoid recursing into them.
      if (shouldExcludeFromStructureRelPath(rel)) {
        continue;
      }
      out.add(rel);
      stack.push({ abs, rel });
    }
  }
  return Array.from(out);
};

const syncStructureJson = (projectDir, projectName, seedDoc = null) => {
  const now = new Date().toISOString();
  const structurePath = getProjectStructurePath(projectDir);
  const prev = seedDoc || safeReadJson(structurePath, null) || null;
  const prevFolders = prev && prev.folders && typeof prev.folders === 'object' ? prev.folders : {};

  const relDirs = listAllDirsRelPosix(projectDir);
  const folders = {};
  for (const rel of relDirs) {
    if (shouldExcludeFromStructureRelPath(rel)) continue;
    const prevMeta = prevFolders[rel] && typeof prevFolders[rel] === 'object' ? prevFolders[rel] : {};
    const name = rel ? rel.split('/').slice(-1)[0] : projectName;
    folders[rel] = {
      ...prevMeta,
      relPath: rel,
      name,
      description: typeof prevMeta.description === 'string' ? prevMeta.description : '',
      system: typeof prevMeta.system === 'boolean' ? prevMeta.system : isSystemFolderRelPath(rel),
      createdAt: typeof prevMeta.createdAt === 'string' ? prevMeta.createdAt : now,
      updatedAt: now,
    };
  }

  const doc = {
    schemaVersion: 1,
    projectName,
    createdAt: prev && typeof prev.createdAt === 'string' ? prev.createdAt : now,
    updatedAt: now,
    folders,
  };
  atomicWriteFileSync(structurePath, JSON.stringify(doc, null, 2), 'utf-8');
  return doc;
};

const remapStructureDocRelPaths = (doc, fromRel, toRel) => {
  const src = String(fromRel || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const dst = String(toRel || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!doc || !doc.folders || typeof doc.folders !== 'object') return doc;
  if (!src || src === dst) return doc;

  const nextFolders = {};
  for (const [k, v] of Object.entries(doc.folders)) {
    const key = String(k || '');
    const meta = v && typeof v === 'object' ? v : {};
    if (key === src || key.startsWith(src + '/')) {
      const suffix = key.slice(src.length);
      const newKey = dst + suffix;
      nextFolders[newKey] = { ...meta, relPath: newKey };
    } else {
      nextFolders[key] = meta;
    }
  }
  doc.folders = nextFolders;
  return doc;
};

const ensureClipboardRecordDoc = (projectDir, projectName) => {
  const recordPath = getClipboardRecordPath(projectDir);
  const doc = safeReadJson(recordPath, null);
  if (doc && typeof doc === 'object' && Array.isArray(doc.items)) return doc;
  const now = new Date().toISOString();
  const init = { schemaVersion: 1, projectName, createdAt: now, updatedAt: now, items: [] };
  atomicWriteFileSync(recordPath, JSON.stringify(init, null, 2), 'utf-8');
  return init;
};

const emitClipboardRecordChanged = (payload) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('snippets/clipboardRecord.changed', payload);
    }
  } catch {
    // ignore
  }
  try {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.webContents.send('snippets/clipboardRecord.changed', payload);
    }
  } catch {
    // ignore
  }
};

const ensureScreenshotRecordDoc = (projectDir, projectName) => {
  const recordPath = getScreenshotRecordPath(projectDir);
  const doc = safeReadJson(recordPath, null);
  if (doc && typeof doc === 'object' && Array.isArray(doc.items)) return doc;
  const now = new Date().toISOString();
  const init = { schemaVersion: 1, projectName, createdAt: now, updatedAt: now, items: [] };
  atomicWriteFileSync(recordPath, JSON.stringify(init, null, 2), 'utf-8');
  return init;
};

const mergeItemsById = (existingItems, incomingItems) => {
  const out = [];
  const seen = new Set();
  const a = Array.isArray(incomingItems) ? incomingItems : [];
  const b = Array.isArray(existingItems) ? existingItems : [];
  for (const it of a) {
    const id = String(it?.id || '');
    if (!id || seen.has(id)) continue;
    out.push(it);
    seen.add(id);
  }
  for (const it of b) {
    const id = String(it?.id || '');
    if (!id || seen.has(id)) continue;
    out.push(it);
    seen.add(id);
  }
  return out;
};

const migrateLegacyItemsJsonIfNeeded = (projectDir, projectName) => {
  const legacyItemsPath = path.join(getProjectMetaDir(projectDir), 'items.json');
  const legacyBackupPath = path.join(getProjectMetaDir(projectDir), 'items.legacy.json');
  if (!fs.existsSync(legacyItemsPath)) return { migrated: false, reason: 'no_legacy_items' };

  // If backup exists, assume already migrated (do not overwrite).
  if (fs.existsSync(legacyBackupPath)) return { migrated: false, reason: 'already_backed_up' };

  const legacy = safeReadJson(legacyItemsPath, null);
  const legacyItems = Array.isArray(legacy?.items) ? legacy.items : [];
  const legacySnips = legacyItems.filter((x) => String(x?.type) === 'snippet');
  const legacyShots = legacyItems.filter((x) => String(x?.type) === 'screenshot');

  // Ensure new records exist
  fs.mkdirSync(getSnippetsMetaDir(projectDir), { recursive: true });
  const snipDoc = ensureClipboardRecordDoc(projectDir, projectName);
  const shotDoc = ensureScreenshotRecordDoc(projectDir, projectName);

  snipDoc.items = mergeItemsById(snipDoc.items, legacySnips);
  snipDoc.updatedAt = new Date().toISOString();
  atomicWriteFileSync(getClipboardRecordPath(projectDir), JSON.stringify(snipDoc, null, 2), 'utf-8');

  shotDoc.items = mergeItemsById(shotDoc.items, legacyShots);
  shotDoc.updatedAt = new Date().toISOString();
  atomicWriteFileSync(getScreenshotRecordPath(projectDir), JSON.stringify(shotDoc, null, 2), 'utf-8');

  // Move legacy file out of the way (keep a backup for manual recovery)
  const renamed = safeRenameSync(legacyItemsPath, legacyBackupPath);
  if (!renamed) {
    try {
      fs.copyFileSync(legacyItemsPath, legacyBackupPath);
      safeRmSync(legacyItemsPath);
    } catch {
      return { migrated: false, reason: 'backup_failed' };
    }
  }

  try {
    appendJsonl(getProjectLogPath(projectDir), {
      ts: new Date().toISOString(),
      event: 'migration.meta.items_json.v1_to_domain_records',
      projectName,
      legacyItems: legacyItems.length,
      snippets: legacySnips.length,
      screenshots: legacyShots.length,
      legacyBackupRelPath: asPosixRel(path.relative(projectDir, legacyBackupPath)),
    });
  } catch {
    // ignore
  }

  return { migrated: true, legacyItems: legacyItems.length, snippets: legacySnips.length, screenshots: legacyShots.length };
};

const removeRecordItemsByContentRelPath = (recordPath, projectName, deletedRelPath, isDir) => {
  const rp = normalizeRelPathPosix(deletedRelPath);
  if (!rp) return { updated: false, removed: 0 };
  const doc = safeReadJson(recordPath, null);
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) return { updated: false, removed: 0 };

  const prefix = isDir ? `${rp}/` : rp;
  const before = doc.items.length;
  doc.items = doc.items.filter((it) => {
    const p = normalizeRelPathPosix(it?.content?.relPath || '');
    if (!p) return true;
    if (isDir) return !(p === rp || p.startsWith(prefix));
    return p !== rp;
  });
  const removed = before - doc.items.length;
  if (!removed) return { updated: false, removed: 0 };
  doc.projectName = doc.projectName || projectName;
  doc.schemaVersion = doc.schemaVersion || 1;
  doc.updatedAt = new Date().toISOString();
  atomicWriteFileSync(recordPath, JSON.stringify(doc, null, 2), 'utf-8');
  return { updated: true, removed };
};

const rewriteRecordRelPathsPrefix = (recordDoc, fromPrefix, toPrefix) => {
  const from = normalizeRelPathPosix(fromPrefix);
  const to = normalizeRelPathPosix(toPrefix);
  if (!recordDoc || typeof recordDoc !== 'object' || !Array.isArray(recordDoc.items)) return recordDoc;
  if (!from || !to || from === to) return recordDoc;
  const fromWithSlash = from.endsWith('/') ? from : `${from}/`;
  const toWithSlash = to.endsWith('/') ? to : `${to}/`;
  for (const it of recordDoc.items) {
    const p = normalizeRelPathPosix(it?.content?.relPath || '');
    if (!p) continue;
    if (p === from) {
      it.content.relPath = to;
      continue;
    }
    if (p.startsWith(fromWithSlash)) {
      it.content.relPath = toWithSlash + p.slice(fromWithSlash.length);
    }
  }
  return recordDoc;
};

const migrateLegacySnippetRecordFilesIfNeeded = (projectDir, projectName) => {
  // old clipboard record: snippets/snippets-meta/record.json -> clipboard-record.json
  const oldClipboardPath = path.join(getSnippetsMetaDir(projectDir), 'record.json');
  const newClipboardPath = getClipboardRecordPath(projectDir);
  const oldClipboardBackup = path.join(getSnippetsMetaDir(projectDir), 'record.legacy.json');
  if (fs.existsSync(oldClipboardPath) && !fs.existsSync(newClipboardPath)) {
    const doc = safeReadJson(oldClipboardPath, null);
    if (doc && typeof doc === 'object' && Array.isArray(doc.items)) {
      doc.projectName = doc.projectName || projectName;
      doc.schemaVersion = doc.schemaVersion || 1;
      doc.updatedAt = new Date().toISOString();
      atomicWriteFileSync(newClipboardPath, JSON.stringify(doc, null, 2), 'utf-8');
    } else {
      const now = new Date().toISOString();
      atomicWriteFileSync(newClipboardPath, JSON.stringify({ schemaVersion: 1, projectName, createdAt: now, updatedAt: now, items: [] }, null, 2), 'utf-8');
    }
    safeRenameSync(oldClipboardPath, oldClipboardBackup);
  }

  // old screenshot record: screenshots/screenshots-meta/record.json -> snippets/snippets-meta/screenshots-record.json
  const oldShotsPath = path.join(projectDir, 'screenshots', 'screenshots-meta', 'record.json');
  const newShotsPath = getScreenshotRecordPath(projectDir);
  const oldShotsBackup = path.join(projectDir, 'screenshots', 'screenshots-meta', 'record.legacy.json');
  if (fs.existsSync(oldShotsPath) && !fs.existsSync(newShotsPath)) {
    const doc = safeReadJson(oldShotsPath, null);
    if (doc && typeof doc === 'object' && Array.isArray(doc.items)) {
      doc.projectName = doc.projectName || projectName;
      doc.schemaVersion = doc.schemaVersion || 1;
      rewriteRecordRelPathsPrefix(doc, 'screenshots', 'snippets/screenshots');
      doc.updatedAt = new Date().toISOString();
      atomicWriteFileSync(newShotsPath, JSON.stringify(doc, null, 2), 'utf-8');
    } else {
      const now = new Date().toISOString();
      atomicWriteFileSync(newShotsPath, JSON.stringify({ schemaVersion: 1, projectName, createdAt: now, updatedAt: now, items: [] }, null, 2), 'utf-8');
    }
    safeRenameSync(oldShotsPath, oldShotsBackup);
  }
};

const migrateLegacyScreenshotFolderIfNeeded = (projectDir) => {
  // Move old screenshots/*.png to snippets/screenshots/*.png (do not move screenshots-meta)
  const oldDir = path.join(projectDir, 'screenshots');
  if (!fs.existsSync(oldDir)) return { moved: 0 };
  let moved = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(oldDir, { withFileTypes: true });
  } catch {
    return { moved: 0 };
  }
  const newDir = getSnippetScreenshotsDir(projectDir);
  fs.mkdirSync(newDir, { recursive: true });
  for (const e of entries) {
    if (e.isDirectory() && e.name === 'screenshots-meta') continue;
    if (!e.isFile()) continue;
    const from = path.join(oldDir, e.name);
    const to = ensureUniqueDestPath(newDir, e.name);
    try {
      fs.renameSync(from, to);
      moved += 1;
    } catch {
      // ignore
    }
  }
  return { moved };
};

let mainWindow = null;
let floatingWindow = null;
let clipboardWatchTimer = null;
let lastClipboardText = '';
let lastClipboardImageHash = '';
const clipboardImageCache = new Map(); // token -> { png: Buffer, width, height, createdAt, hash }

// Best-effort async deletion queue (Windows filesystem can delay deletes while handles are around).
const pendingDeleteDirs = new Set(); // absolute paths
let pendingDeleteTimer = null;
const enqueueDeleteDir = (absPath) => {
  if (!absPath) return;
  pendingDeleteDirs.add(String(absPath));
  if (pendingDeleteTimer) return;
  pendingDeleteTimer = setInterval(() => {
    for (const p of Array.from(pendingDeleteDirs)) {
      try {
        if (!fs.existsSync(p)) {
          pendingDeleteDirs.delete(p);
          continue;
        }
        // hard delete retry
        safeRmSync(p);
        if (!fs.existsSync(p)) {
          pendingDeleteDirs.delete(p);
        }
      } catch {
        // keep it; retry later
      }
    }
    if (pendingDeleteDirs.size === 0) {
      clearInterval(pendingDeleteTimer);
      pendingDeleteTimer = null;
    }
  }, 1200);
};

const pruneClipboardImageCache = () => {
  const now = Date.now();
  for (const [token, v] of clipboardImageCache.entries()) {
    if (!v?.createdAt || now - v.createdAt > 60_000) {
      clipboardImageCache.delete(token);
    }
  }
  // soft cap
  if (clipboardImageCache.size > 8) {
    const entries = Array.from(clipboardImageCache.entries()).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    for (const [token] of entries.slice(0, clipboardImageCache.size - 8)) clipboardImageCache.delete(token);
  }
};

const startClipboardWatcher = () => {
  if (clipboardWatchTimer) return;
  clipboardWatchTimer = setInterval(() => {
    try {
      // Only emit when floating window exists (we only need it there for MVP)
      if (!floatingWindow || floatingWindow.isDestroyed()) return;
      const text = clipboard.readText() || '';
      const trimmed = String(text).trim();
      if (trimmed && trimmed !== lastClipboardText) {
        lastClipboardText = trimmed;
        floatingWindow.webContents.send('clipboard/textChanged', { text });
      }

      // Clipboard image (Win+Shift+S)
      const img = clipboard.readImage();
      if (img && !img.isEmpty()) {
        const png = img.toPNG();
        const hash = crypto.createHash('sha1').update(png).digest('hex');
        if (hash !== lastClipboardImageHash) {
          lastClipboardImageHash = hash;
          const token = `clipimg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const size = img.getSize?.() || { width: 0, height: 0 };
          clipboardImageCache.set(token, { png, width: size.width || 0, height: size.height || 0, createdAt: Date.now(), hash });
          pruneClipboardImageCache();
          const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
          floatingWindow.webContents.send('clipboard/imageChanged', {
            token,
            dataUrl,
            width: size.width || 0,
            height: size.height || 0,
          });
        }
      }
    } catch {
      // ignore
    }
  }, 400);
};

const stopClipboardWatcher = () => {
  if (!clipboardWatchTimer) return;
  clearInterval(clipboardWatchTimer);
  clipboardWatchTimer = null;
  lastClipboardText = '';
  lastClipboardImageHash = '';
  clipboardImageCache.clear();
};

const loadRenderer = (win, uiMode = 'main') => {
  const search = uiMode === 'floating' ? 'ui=floating' : '';
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = search ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?${search}` : MAIN_WINDOW_VITE_DEV_SERVER_URL;
    win.loadURL(url);
  } else {
    const filePath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    win.loadFile(filePath, search ? { search } : undefined);
  }
};

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadRenderer(mainWindow, 'main');

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const createFloatingWindow = () => {
  if (floatingWindow) return floatingWindow;

  floatingWindow = new BrowserWindow({
    width: 420,
    height: 560,
    frame: false, // 关键：无系统标题栏（无最小化/最大化/关闭那一栏）
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadRenderer(floatingWindow, 'floating');

  // DevTools 默认不开，避免打扰（需要时可以手动打开）
  floatingWindow.on('closed', () => {
    floatingWindow = null;
    stopClipboardWatcher();
    // 如果用户直接关掉浮窗，则回到中台
    if (mainWindow) mainWindow.show();
  });

  startClipboardWatcher();
  return floatingWindow;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  fs.mkdirSync(getUserFileRoot(), { recursive: true });
  fs.mkdirSync(getProjectsRoot(), { recursive: true });
  fs.mkdirSync(getCasesRoot(), { recursive: true });
  fs.mkdirSync(getStudyRoot(), { recursive: true });
  fs.mkdirSync(getAppRoot(), { recursive: true });

  // Ensure study root has default knowledge library structure (best-effort)
  try {
    ensureProjectStructure('', 'study');
  } catch {
    // ignore
  }

  // ===== Local folders (Imported local directories) =====
  // Keep this feature modular to avoid bloating main.js.
  registerLocalFoldersIpc({ ipcMain, dialog, getStatePath });
  registerLocalExplorerIpc({ ipcMain, dialog, shell, getStatePath });

  ipcMain.handle('app/ping', async () => {
    return {
      ok: true,
      now: new Date().toISOString(),
      version: app.getVersion(),
      userDataPath: app.getPath('userData'),
      userFileRoot: getUserFileRoot(),
      projectsRoot: getProjectsRoot(),
      casesRoot: getCasesRoot(),
      studyRoot: getStudyRoot(),
      currentProject: readState().currentProject ?? null,
      currentCase: readState().currentCase ?? null,
    };
  });

  // ===== UI Window Switching (only window management; no business integration) =====
  ipcMain.handle('ui/openFloating', async () => {
    if (!mainWindow) createMainWindow();
    const fw = createFloatingWindow();
    fw.show();
    fw.focus();
    // 进入悬浮窗时隐藏中台主窗
    if (mainWindow) mainWindow.hide();
    return { ok: true };
  });

  ipcMain.handle('ui/resizeFloating', async (_evt, payload) => {
    if (!floatingWindow || floatingWindow.isDestroyed()) return { ok: false, reason: 'no_floating_window' };
    const w = Math.max(200, Math.min(900, Number(payload?.width) || 0));
    const h = Math.max(180, Math.min(900, Number(payload?.height) || 0));
    if (!w || !h) return { ok: false, reason: 'invalid_size' };
    // Resize content area so there is no extra transparent region that blocks clicks
    floatingWindow.setContentSize(Math.round(w), Math.round(h));
    return { ok: true, width: Math.round(w), height: Math.round(h) };
  });

  ipcMain.handle('ui/backToMain', async () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
    if (floatingWindow) {
      floatingWindow.close();
      floatingWindow = null;
    }
    return { ok: true };
  });

  // ===== Floating: file copy to temp (no business indexing yet) =====
  ipcMain.handle('floating/copyToTemp', async (_evt, payload) => {
    const { name: projectName, projectDir, domain } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const srcPath = String(payload?.srcPath ?? '');
    if (!srcPath) throw new Error('源文件路径不能为空');
    if (!fs.existsSync(srcPath)) throw new Error('源文件不存在');
    const st = fs.statSync(srcPath);
    if (!st.isFile()) throw new Error('源路径不是文件');

    const rawName = payload?.fileName ? String(payload.fileName) : path.basename(srcPath);
    const safeName = sanitizeFileName(rawName) || 'file';

    const tempDir = ensureTempDir(projectDir);
    // temp/ might be created lazily; keep structure.json in sync (best-effort)
    if (!fs.existsSync(getProjectStructurePath(projectDir))) {
      try {
        syncStructureJson(projectDir, projectName);
      } catch {
        // ignore
      }
    }
    const destPath = ensureUniqueDestPath(tempDir, safeName);
    fs.copyFileSync(srcPath, destPath);

    // Record source info immediately (independent of AI success/failure)
    const sourceRelPath = path.relative(projectDir, destPath).split(path.sep).join('/');
    try {
      upsertTempSourceRecord(projectDir, projectName, {
        sourceRelPath,
        sourcePath: srcPath,
        sourceDir: path.dirname(srcPath),
        fileName: safeName,
        sourceSizeBytes: st.size,
        capturedAt: new Date().toISOString(),
      });
    } catch {
      // ignore
    }

    // Trigger AI classification (non-blocking): ONLY uses fileName/ext + structure.json
    try {
      agentLog('INFO', 'floating upload saved to temp', { projectName, sourceRelPath });
      void triggerAutoClassifyToAiStorage({ domain, projectName, projectDir, sourceRelPath });
    } catch {
      // ignore
    }

    return {
      ok: true,
      projectName,
      domain,
      savedRelPath: path.relative(projectDir, destPath).split(path.sep).join('/'),
    };
  });

  ipcMain.handle('floating/deleteRelPath', async (_evt, payload) => {
    const { name: projectName, projectDir, domain } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = String(payload?.relPath ?? '');
    if (!relPath) throw new Error('目标路径不能为空');
    const target = resolveInside(projectDir, relPath);
    if (!fs.existsSync(target)) return { ok: true, projectName, deleted: false };
    // Only allow undo deletion inside temp/
    const tempDir = ensureTempDir(projectDir);
    const tempAbs = path.resolve(tempDir);
    const targetAbs = path.resolve(target);
    if (!(targetAbs === tempAbs || targetAbs.startsWith(tempAbs + path.sep))) {
      throw new Error('仅允许删除 temp 目录下的文件');
    }
    safeRmSync(targetAbs);
    try {
      deleteTempSourceRecordByRelPath(projectDir, relPath);
    } catch {
      // ignore
    }
    return { ok: true, projectName, domain, deleted: true };
  });

  // ===== Snippets: clipboard text -> txt + snippets/snippets-meta/clipboard-record.json index =====
  ipcMain.handle('snippets/saveClipboardText', async (_evt, payload) => {
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

    const relPath = asPosixRel(path.relative(projectDir, filePath));
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

  // ===== Snippets: clipboard-record.json CRUD (for snippet linker persistence) =====
  ipcMain.handle('snippets/clipboardRecord/list', async (_evt, payload) => {
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

  // ===== Screenshots: clipboard image -> png + snippets/screenshots + snippets/snippets-meta/screenshots-record.json index =====
  ipcMain.handle('screenshots/saveClipboardImage', async (_evt, payload) => {
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
    const relPath = asPosixRel(path.relative(projectDir, filePath));

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

  // ===== Preferences (persisted in userfile/_app/state.json) =====
  ipcMain.handle('prefs/get', async () => {
    const state = readState();
    const prefs = state.prefs && typeof state.prefs === 'object' ? state.prefs : {};
    return {
      ok: true,
      prefs: {
        floatingUploadMode: normalizeFloatingUploadMode(prefs.floatingUploadMode || 'confirm'),
      },
    };
  });

  ipcMain.handle('prefs/set', async (_evt, payload) => {
    const patch = payload?.patch && typeof payload.patch === 'object' ? payload.patch : {};
    const state = readState();
    state.prefs = state.prefs && typeof state.prefs === 'object' ? state.prefs : {};
    if (Object.prototype.hasOwnProperty.call(patch, 'floatingUploadMode')) {
      state.prefs.floatingUploadMode = normalizeFloatingUploadMode(patch.floatingUploadMode);
    }
    writeState(state);
    return {
      ok: true,
      prefs: {
        floatingUploadMode: normalizeFloatingUploadMode(state.prefs.floatingUploadMode || 'confirm'),
      },
    };
  });

  ipcMain.handle('projects/list', async () => {
    const root = getProjectsRoot();
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const state = readState();
    const statusMap = state.projectStatuses && typeof state.projectStatuses === 'object' ? state.projectStatuses : {};
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (isTombstoneProjectName(name)) {
        // best-effort cleanup of tombstones; never show in UI
        const fullPath = path.join(root, name);
        if (isEmptyDirSync(fullPath)) {
          try {
            safeRmSync(fullPath);
          } catch {
            // ignore
          }
        }
        continue;
      }
      const fullPath = path.join(root, name);
      // Clean up ghost project dirs that may remain as empty stubs after deletion (Windows edge cases).
      if (isEmptyDirSync(fullPath)) {
        try {
          safeRmSync(fullPath);
        } catch {
          // If we cannot delete, quarantine it so the name becomes available for re-creation.
          try {
            quarantineProjectDirSync(root, name);
          } catch {
            // ignore
          }
        }
        continue;
      }
      out.push({
        name,
        path: fullPath,
        status: normalizeProjectStatus(statusMap[name] || 'active'),
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return out;
  });

  ipcMain.handle('projects/setStatus', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('项目名不能为空');
    const projDir = path.join(getProjectsRoot(), name);
    if (!fs.existsSync(projDir)) throw new Error(`项目不存在：${name}`);
    const status = normalizeProjectStatus(payload?.status);
    const state = readState();
    state.projectStatuses = state.projectStatuses && typeof state.projectStatuses === 'object' ? state.projectStatuses : {};
    state.projectStatuses[name] = status;
    writeState(state);
    return { ok: true, name, status };
  });

  ipcMain.handle('projects/create', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('项目名不能为空');
    const projectsRoot = getProjectsRoot();
    const projDir = path.join(projectsRoot, name);
    if (fs.existsSync(projDir)) {
      // If it's a ghost / invalid dir (or empty), clean/quarantine it so user can re-create same name.
      const isGhost = isEmptyDirSync(projDir) || !looksLikeValidProjectDirSync(projDir);
      if (!isGhost) {
        throw new Error(`项目已存在：${name}`);
      }
      
      // ENHANCED: Make writable first (Windows EPERM fix)
      try {
        makeWritableRecursiveSync(projDir);
      } catch {
        // ignore
      }
      
      // Try multiple strategies to remove ghost folder
      let cleared = false;
      
      // Strategy 1: Direct hard delete
      try {
        safeRmSync(projDir);
        if (!fs.existsSync(projDir)) {
          cleared = true;
        }
      } catch {
        // ignore, try next strategy
      }
      
      // Strategy 2: Move to recycle bin
      if (!cleared) {
        try {
          await shell.trashItem(projDir);
          if (!fs.existsSync(projDir)) {
            cleared = true;
          }
        } catch {
          // ignore, try next strategy
        }
      }
      
      // Strategy 3: Quarantine (rename) to free the name
      if (!cleared && fs.existsSync(projDir)) {
        try {
          const tombstone = quarantineProjectDirSync(projectsRoot, name);
          cleared = !fs.existsSync(projDir);
          // Try to delete tombstone in background
          if (cleared) {
            try {
              enqueueDeleteDir(tombstone);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }
      
      // Final check: if original name still exists, we cannot proceed
      if (fs.existsSync(projDir)) {
        throw new Error(`发现残留项目目录但无法清理：${name}。请稍后重试、重启应用，或手动删除该文件夹。`);
      }
    }
    const proj = ensureProjectStructure(name);
    // best-effort: seed structure.json immediately on creation
    try {
      syncStructureJson(proj.path, name);
    } catch {
      // ignore
    }
    // auto set current on creation
    const state = readState();
    state.currentProject = name;
    state.projectStatuses = state.projectStatuses && typeof state.projectStatuses === 'object' ? state.projectStatuses : {};
    state.projectStatuses[name] = normalizeProjectStatus(state.projectStatuses[name] || 'active');
    writeState(state);
    return proj;
  });

  ipcMain.handle('projects/getCurrent', async () => {
    return readState().currentProject ?? null;
  });

  ipcMain.handle('projects/setCurrent', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('项目名不能为空');
    const projDir = path.join(getProjectsRoot(), name);
    if (!fs.existsSync(projDir)) throw new Error(`项目不存在：${name}`);
    const state = readState();
    state.currentProject = name;
    writeState(state);
    return { ok: true, currentProject: name };
  });

  ipcMain.handle('projects/delete', async (_evt, payload) => {
    const { name, projectDir } = getProjectDirOrThrow(payload?.name);
    const root = getProjectsRoot();

    if (!fs.existsSync(projectDir)) {
      // Already gone, just clean up state
      const state = readState();
      if (state.currentProject === name) {
        state.currentProject = null;
      }
      if (state.projectStatuses && typeof state.projectStatuses === 'object') {
        delete state.projectStatuses[name];
      }
      writeState(state);
      return { ok: true };
    }

    // STRATEGY A: Try to rename (quarantine) first to free the name immediately
    let tombstonePath = null;
    let renameSucceeded = false;
    
    // Try up to 3 times to rename (with aggressive permission fixes)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (fs.existsSync(projectDir) && path.dirname(projectDir) === root) {
          // Aggressive prep: make writable + wait
          try {
            makeWritableRecursiveSync(projectDir);
          } catch {
            // ignore
          }
          
          if (attempt > 0) {
            sleepSync(80 * attempt); // Brief delay for filesystem to settle
          }
          
          tombstonePath = quarantineProjectDirSync(root, name);
          
          // Verify rename actually succeeded
          if (!fs.existsSync(projectDir) && fs.existsSync(tombstonePath)) {
            renameSucceeded = true;
            break;
          } else {
            // Rename returned but didn't work? Roll back if needed
            if (fs.existsSync(tombstonePath) && fs.existsSync(projectDir)) {
              try {
                safeRmSync(tombstonePath);
              } catch {
                // ignore
              }
            }
            tombstonePath = null;
          }
        }
      } catch (e) {
        // Retry on next iteration
        tombstonePath = null;
      }
    }

    // STRATEGY B: If rename failed, try direct deletion + verify it's gone
    if (!renameSucceeded) {
      // Make writable before delete
      try {
        makeWritableRecursiveSync(projectDir);
      } catch {
        // ignore
      }

      // Try recycle bin first (often works better than fs.rmSync on Windows)
      try {
        await shell.trashItem(projectDir);
        if (!fs.existsSync(projectDir)) {
          // Success! Original name is now free.
          const state = readState();
          if (state.currentProject === name) {
            state.currentProject = null;
          }
          if (state.projectStatuses && typeof state.projectStatuses === 'object') {
            delete state.projectStatuses[name];
          }
          writeState(state);
          return { ok: true };
        }
      } catch {
        // ignore, try hard delete
      }

      // Try hard delete
      try {
        safeRmSync(projectDir);
        // Wait a bit and verify
        sleepSync(100);
        if (!fs.existsSync(projectDir)) {
          // Success! Original name is now free.
          const state = readState();
          if (state.currentProject === name) {
            state.currentProject = null;
          }
          if (state.projectStatuses && typeof state.projectStatuses === 'object') {
            delete state.projectStatuses[name];
          }
          writeState(state);
          return { ok: true };
        }
      } catch {
        // ignore
      }

      // Both rename and delete failed => cannot proceed safely
      throw new Error(`无法删除项目文件夹：${name}。\n\n可能原因：\n1. 文件夹被其他程序占用\n2. 权限不足\n3. Windows资源管理器正在访问该文件夹\n\n建议：\n- 关闭可能访问该文件夹的程序\n- 或重启应用后重试`);
    }

    // Rename succeeded! Now the original name is FREE.
    // Delete the tombstone in background (don't block user).

    // Best-effort: attempt immediate delete of tombstone (prefer recycle bin)
    try {
      await trashOrRm(tombstonePath);
    } catch {
      try {
        safeRmSync(tombstonePath);
      } catch {
        // ignore; will retry in background
      }
    }

    // If tombstone still exists, enqueue for background deletion
    if (fs.existsSync(tombstonePath)) {
      try {
        enqueueDeleteDir(tombstonePath);
      } catch {
        // ignore
      }
    }

    // CRITICAL: Double-check that original name is truly free (Windows edge case: may recreate empty stub)
    if (fs.existsSync(projectDir)) {
      try {
        makeWritableRecursiveSync(projectDir);
        if (isEmptyDirSync(projectDir)) {
          // Remove empty ghost folder immediately
          safeRmSync(projectDir);
          if (fs.existsSync(projectDir)) {
            // Still there? Quarantine it again
            try {
              const ghost = quarantineProjectDirSync(root, name);
              enqueueDeleteDir(ghost);
            } catch {
              enqueueDeleteDir(projectDir);
            }
          }
        } else {
          // Non-empty ghost? Quarantine (should never happen, but failsafe)
          try {
            const ghost = quarantineProjectDirSync(root, name);
            enqueueDeleteDir(ghost);
          } catch {
            enqueueDeleteDir(projectDir);
          }
        }
      } catch {
        // Best effort
        try {
          enqueueDeleteDir(projectDir);
        } catch {
          // ignore
        }
      }
    }

    // Clean up app state
    const state = readState();
    if (state.currentProject === name) {
      state.currentProject = null;
    }
    if (state.projectStatuses && typeof state.projectStatuses === 'object') {
      delete state.projectStatuses[name];
    }
    writeState(state);
    return { ok: true };
  });

  // ===== Cases (案件) =====
  ipcMain.handle('cases/list', async () => {
    const root = getCasesRoot();
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const state = readState();
    const statusMap = state.caseStatuses && typeof state.caseStatuses === 'object' ? state.caseStatuses : {};
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (isTombstoneProjectName(name)) {
        const fullPath = path.join(root, name);
        if (isEmptyDirSync(fullPath)) {
          try {
            safeRmSync(fullPath);
          } catch {
            // ignore
          }
        }
        continue;
      }
      const fullPath = path.join(root, name);
      if (isEmptyDirSync(fullPath)) {
        try {
          safeRmSync(fullPath);
        } catch {
          try {
            quarantineProjectDirSync(root, name);
          } catch {
            // ignore
          }
        }
        continue;
      }
      out.push({
        name,
        path: fullPath,
        status: normalizeProjectStatus(statusMap[name] || 'active'),
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return out;
  });

  ipcMain.handle('cases/setStatus', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('名称不能为空');
    const dir = path.join(getCasesRoot(), name);
    if (!fs.existsSync(dir)) throw new Error(`目录不存在：${name}`);
    const status = normalizeProjectStatus(payload?.status);
    const state = readState();
    state.caseStatuses = state.caseStatuses && typeof state.caseStatuses === 'object' ? state.caseStatuses : {};
    state.caseStatuses[name] = status;
    writeState(state);
    return { ok: true, name, status };
  });

  ipcMain.handle('cases/create', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('名称不能为空');
    const root = getCasesRoot();
    const dir = path.join(root, name);
    if (fs.existsSync(dir)) {
      const isGhost = isEmptyDirSync(dir) || !looksLikeValidProjectDirSync(dir);
      if (!isGhost) {
        throw new Error(`已存在：${name}`);
      }
      try {
        makeWritableRecursiveSync(dir);
      } catch {
        // ignore
      }

      let cleared = false;
      try {
        safeRmSync(dir);
        if (!fs.existsSync(dir)) cleared = true;
      } catch {
        // ignore
      }

      if (!cleared) {
        try {
          await shell.trashItem(dir);
          if (!fs.existsSync(dir)) cleared = true;
        } catch {
          // ignore
        }
      }

      if (!cleared && fs.existsSync(dir)) {
        try {
          const tombstone = quarantineProjectDirSync(root, name);
          cleared = !fs.existsSync(dir);
          if (cleared) {
            try {
              enqueueDeleteDir(tombstone);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }

      if (fs.existsSync(dir)) {
        throw new Error(`发现残留目录但无法清理：${name}。请稍后重试、重启应用，或手动删除该文件夹。`);
      }
    }

    const created = ensureProjectStructure(name, 'cases');
    try {
      syncStructureJson(created.path, name);
    } catch {
      // ignore
    }
    const state = readState();
    state.currentCase = name;
    state.caseStatuses = state.caseStatuses && typeof state.caseStatuses === 'object' ? state.caseStatuses : {};
    state.caseStatuses[name] = normalizeProjectStatus(state.caseStatuses[name] || 'active');
    writeState(state);
    return created;
  });

  ipcMain.handle('cases/getCurrent', async () => {
    return readState().currentCase ?? null;
  });

  ipcMain.handle('cases/setCurrent', async (_evt, payload) => {
    const name = sanitizeProjectName(payload?.name);
    if (!name) throw new Error('名称不能为空');
    const dir = path.join(getCasesRoot(), name);
    if (!fs.existsSync(dir)) throw new Error(`目录不存在：${name}`);
    const state = readState();
    state.currentCase = name;
    writeState(state);
    return { ok: true, currentCase: name };
  });

  ipcMain.handle('cases/delete', async (_evt, payload) => {
    const { name, projectDir } = getWorkspaceDirOrThrow(payload?.name, 'cases');
    const root = getCasesRoot();

    if (!fs.existsSync(projectDir)) {
      const state = readState();
      if (state.currentCase === name) state.currentCase = null;
      if (state.caseStatuses && typeof state.caseStatuses === 'object') delete state.caseStatuses[name];
      writeState(state);
      return { ok: true };
    }

    let tombstonePath = null;
    let renameSucceeded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (fs.existsSync(projectDir) && path.dirname(projectDir) === root) {
          try {
            makeWritableRecursiveSync(projectDir);
          } catch {
            // ignore
          }
          if (attempt > 0) sleepSync(80 * attempt);
          tombstonePath = quarantineProjectDirSync(root, name);
          if (!fs.existsSync(projectDir) && fs.existsSync(tombstonePath)) {
            renameSucceeded = true;
            break;
          }
          if (fs.existsSync(tombstonePath) && fs.existsSync(projectDir)) {
            try {
              safeRmSync(tombstonePath);
            } catch {
              // ignore
            }
          }
          tombstonePath = null;
        }
      } catch {
        tombstonePath = null;
      }
    }

    if (!renameSucceeded) {
      try {
        makeWritableRecursiveSync(projectDir);
      } catch {
        // ignore
      }

      try {
        await shell.trashItem(projectDir);
        if (!fs.existsSync(projectDir)) {
          const state = readState();
          if (state.currentCase === name) state.currentCase = null;
          if (state.caseStatuses && typeof state.caseStatuses === 'object') delete state.caseStatuses[name];
          writeState(state);
          return { ok: true };
        }
      } catch {
        // ignore
      }

      try {
        safeRmSync(projectDir);
        sleepSync(100);
        if (!fs.existsSync(projectDir)) {
          const state = readState();
          if (state.currentCase === name) state.currentCase = null;
          if (state.caseStatuses && typeof state.caseStatuses === 'object') delete state.caseStatuses[name];
          writeState(state);
          return { ok: true };
        }
      } catch {
        // ignore
      }

      throw new Error(`无法删除案件文件夹：${name}。\n\n可能原因：\n1. 文件夹被其他程序占用\n2. 权限不足\n3. Windows资源管理器正在访问该文件夹\n\n建议：\n- 关闭可能访问该文件夹的程序\n- 或重启应用后重试`);
    }

    try {
      await trashOrRm(tombstonePath);
    } catch {
      try {
        safeRmSync(tombstonePath);
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(tombstonePath)) {
      try {
        enqueueDeleteDir(tombstonePath);
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(projectDir)) {
      try {
        makeWritableRecursiveSync(projectDir);
        if (isEmptyDirSync(projectDir)) {
          safeRmSync(projectDir);
          if (fs.existsSync(projectDir)) {
            try {
              const ghost = quarantineProjectDirSync(root, name);
              enqueueDeleteDir(ghost);
            } catch {
              enqueueDeleteDir(projectDir);
            }
          }
        } else {
          try {
            const ghost = quarantineProjectDirSync(root, name);
            enqueueDeleteDir(ghost);
          } catch {
            enqueueDeleteDir(projectDir);
          }
        }
      } catch {
        try {
          enqueueDeleteDir(projectDir);
        } catch {
          // ignore
        }
      }
    }

    const state = readState();
    if (state.currentCase === name) state.currentCase = null;
    if (state.caseStatuses && typeof state.caseStatuses === 'object') delete state.caseStatuses[name];
    writeState(state);
    return { ok: true };
  });

  ipcMain.handle('explorer/list', async (_evt, payload) => {
    const projectName = sanitizeProjectName(payload?.projectName);
    // Normalize relPath to a safe posix-style relative path.
    // This prevents subtle Windows path separator issues (e.g. "\"), extra slashes,
    // or leading/trailing whitespace from breaking directory expansion in Explorer View.
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');
    const domain = normalizeWorkspaceDomain(payload?.domain);
    const isStudyRoot = domain === 'study' && !projectName;
    if (!projectName && !isStudyRoot) throw new Error('名称不能为空');

    const effectiveName = isStudyRoot ? STUDY_WORKSPACE_NAME : projectName;
    const projectDir = isStudyRoot ? getStudyRoot() : path.join(getWorkspaceRoot(domain), projectName);
    if (!fs.existsSync(projectDir)) throw new Error(`目录不存在：${effectiveName}`);

    // Lazy init for legacy projects: ensure new meta layout exists, and migrate old meta/items.json once.
    try {
      ensureProjectStructure(isStudyRoot ? '' : effectiveName, domain);
      if (domain !== 'study') {
        migrateLegacySnippetRecordFilesIfNeeded(projectDir, effectiveName);
        migrateLegacyScreenshotFolderIfNeeded(projectDir);
        migrateLegacyItemsJsonIfNeeded(projectDir, effectiveName);
      }
    } catch {
      // ignore
    }

    const dir = resolveInside(projectDir, relPath);
    if (!fs.existsSync(dir)) throw new Error('目录不存在');

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const mapped = entries.map((e) => {
      const fullPath = path.join(dir, e.name);
      const st = fs.statSync(fullPath);
      const kind = e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other';
      return {
        name: e.name,
        kind,
        relPath: path.relative(projectDir, fullPath).split(path.sep).join('/'),
        sizeBytes: kind === 'file' ? st.size : 0,
        mtimeMs: st.mtimeMs,
      };
    });

    const dirRank = (entry) => {
      if (entry.kind !== 'dir') return 1000;
      const rp = normalizeRelPathPosix(entry.relPath);
      // Keep system folders always at the bottom of the folder list.
      if (rp === 'temp') return 900;
      if (rp === 'snippets') return 910;
      if (rp === 'meta') return 920;
      return 0;
    };
    mapped.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      const ra = dirRank(a);
      const rb = dirRank(b);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });

    return {
      projectName: effectiveName,
      relPath,
      entries: mapped,
    };
  });

  // ===== Explorer: read text file (limited, for snippet cards) =====
  ipcMain.handle('explorer/readText', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');
    if (!relPath) throw new Error('目标路径不能为空');

    // Security/constraint (Step 2 MVP): only allow reading snippet clipboard txt files
    if (!(relPath === 'snippets/clipboard' || relPath.startsWith('snippets/clipboard/'))) {
      throw new Error('仅允许读取 snippets/clipboard 下的文本文件');
    }
    if (!relPath.toLowerCase().endsWith('.txt')) {
      throw new Error('仅允许读取 .txt 文件');
    }

    const target = resolveInside(projectDir, relPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');
    const st = fs.statSync(target);
    if (!st.isFile()) throw new Error('目标不是文件');

    const maxBytes = Math.max(1024, Math.min(1024 * 1024, Number(payload?.maxBytes) || 256 * 1024));
    const buf = fs.readFileSync(target);
    const truncated = buf.length > maxBytes;
    const sliced = truncated ? buf.subarray(0, maxBytes) : buf;
    const text = sliced.toString('utf-8');

    return { ok: true, projectName, relPath, text, truncated };
  });

  // ===== Explorer: open a file with OS default application =====
  ipcMain.handle('explorer/open', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = String(payload?.relPath ?? '');
    if (!relPath) throw new Error('目标路径不能为空');
    const target = resolveInside(projectDir, relPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');
    const st = fs.statSync(target);
    if (!st.isFile()) throw new Error('仅支持打开文件（不支持打开文件夹）');

    // shell.openPath returns '' on success, otherwise an error message string.
    const errMsg = await shell.openPath(target);
    if (errMsg) throw new Error(`打开失败：${errMsg}`);
    return { ok: true, projectName, relPath: asPosixRel(relPath) };
  });

  // ===== Meta: folder info (from meta/structure.json) =====
  ipcMain.handle('meta/getFolderInfo', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');

    // Ensure structure exists and is reasonably up to date (best-effort)
    try {
      ensureProjectStructure(projectName, payload?.domain);
      syncStructureJson(projectDir, projectName);
    } catch {
      // ignore
    }

    const doc = safeReadJson(getProjectStructurePath(projectDir), null);
    const folders = doc && typeof doc === 'object' && doc.folders && typeof doc.folders === 'object' ? doc.folders : {};
    const meta = folders[relPath] && typeof folders[relPath] === 'object' ? folders[relPath] : null;
    return {
      ok: true,
      projectName,
      relPath,
      folder: meta,
      structureUpdatedAt: doc?.updatedAt || null,
    };
  });

  ipcMain.handle('meta/setFolderDescription', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = normalizeRelPathPosix(payload?.relPath ?? '');
    const description = String(payload?.description ?? '');

    if (isProtectedRelPath(relPath) || isSystemFolderRelPath(relPath)) {
      throw new Error('该目录为系统目录，禁止编辑简介');
    }

    // Ensure structure exists & contains folder entries
    ensureProjectStructure(projectName, payload?.domain);
    let doc = null;
    try {
      doc = syncStructureJson(projectDir, projectName);
    } catch {
      doc = safeReadJson(getProjectStructurePath(projectDir), null);
    }
    if (!doc || typeof doc !== 'object') throw new Error('structure.json 不可用');
    doc.folders = doc.folders && typeof doc.folders === 'object' ? doc.folders : {};
    if (!doc.folders[relPath]) {
      throw new Error('文件夹不存在或未被结构索引收录');
    }

    const now = new Date().toISOString();
    const folder = doc.folders[relPath] && typeof doc.folders[relPath] === 'object' ? doc.folders[relPath] : {};
    folder.description = description;
    folder.updatedAt = now;
    doc.folders[relPath] = folder;
    doc.updatedAt = now;

    atomicWriteFileSync(getProjectStructurePath(projectDir), JSON.stringify(doc, null, 2), 'utf-8');

    try {
      appendJsonl(getProjectLogPath(projectDir), {
        ts: now,
        event: 'folder.description.updated',
        projectName,
        relPath,
        size: description.length,
      });
    } catch {
      // ignore
    }

    return { ok: true, projectName, relPath, folder };
  });

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
    const updated = setAiSuggestionStatus(projectDir, projectName, sourceRelPath, { status: 'rejected', rejectedAt: new Date().toISOString() });
    if (!updated) throw new Error('未找到对应暂存记录');
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
    const movedToRelPath = asPosixRel(path.relative(projectDir, destAbs));

    const now = new Date().toISOString();
    const updated = setAiSuggestionStatus(projectDir, projectName, sourceRelPath, {
      status: 'accepted',
      acceptedAt: now,
      movedToRelPath,
      targetRelPath: targetRel,
    });

    try {
      appendJsonl(getProjectLogPath(projectDir), {
        ts: now,
        event: 'aiStorage.accepted',
        projectName,
        sourceRelPath,
        targetRelPath: targetRel,
        movedToRelPath,
      });
    } catch {
      // ignore
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
        const movedToRelPath = asPosixRel(path.relative(projectDir, destAbs));
        const now = new Date().toISOString();
        setAiSuggestionStatus(projectDir, projectName, sourceRelPath, {
          status: 'accepted',
          acceptedAt: now,
          movedToRelPath,
          targetRelPath: targetRel,
        });
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
      if (updated) rejected += 1;
    }
    return { ok: true, projectName, rejected };
  });

  ipcMain.handle('explorer/mkdir', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const relPath = String(payload?.relPath ?? '');
    const folderName = sanitizeFileName(payload?.folderName);
    if (!folderName) throw new Error('文件夹名称不能为空');

    const dir = resolveInside(projectDir, relPath);
    if (!fs.existsSync(dir)) throw new Error('目录不存在');

    const relPosix = normalizeRelPathPosix(path.join(relPath, folderName));
    if (isProtectedFolderNameRelPath(relPosix)) {
      throw new Error('业务/系统固定目录禁止创建/覆盖');
    }

    const desired = resolveInside(projectDir, path.join(relPath, folderName));
    if (fs.existsSync(desired)) {
      const ok = await confirmAutoSuffix();
      if (!ok) return { ok: false, projectName, conflict: true };
      const { fullPath, name } = ensureUniqueDirPath(dir, folderName);
      fs.mkdirSync(fullPath, { recursive: true });
      try {
        syncStructureJson(projectDir, projectName);
      } catch {
        // ignore
      }
      return { ok: true, projectName, createdName: name };
    }

    fs.mkdirSync(desired, { recursive: true });
    try {
      syncStructureJson(projectDir, projectName);
    } catch {
      // ignore
    }
    return { ok: true, projectName, createdName: folderName };
  });

  ipcMain.handle('explorer/delete', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const entryRelPath = String(payload?.relPath ?? '');
    if (!entryRelPath) throw new Error('目标路径不能为空');
    const relPosix = normalizeRelPathPosix(entryRelPath);
    if (isProtectedFolderNameRelPath(relPosix)) {
      throw new Error('系统目录禁止删除（如需删除请直接删除整个项目）');
    }
    const target = resolveInside(projectDir, entryRelPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');
    let wasDir = false;
    try {
      wasDir = fs.statSync(target).isDirectory();
    } catch {
      wasDir = false;
    }

    // Allow deleting files under temp/ (but not folders) to support user cleanup of staging files.
    const isTempChild = relPosix.startsWith('temp/');
    if (!isTempChild && isProtectedRelPath(relPosix)) {
      throw new Error('该目录为系统元数据目录，禁止删除');
    }
    if (isTempChild && wasDir) {
      throw new Error('temp 目录下不允许删除文件夹');
    }
    await trashOrRm(target);
    if (!waitUntilGoneSync(target)) {
      throw new Error('删除尚未完成，请稍后重试');
    }

    // If user deleted a staged temp file, mark pending AI suggestion as source_deleted to avoid stale ghosts.
    if (isTempChild && !wasDir) {
      try {
        const all = listAiSuggestions(projectDir, projectName, {});
        const s = all.find((x) => normalizeRelPathPosix(x?.sourceRelPath) === relPosix);
        if (s && String(s.status) === 'pending') {
          setAiSuggestionStatus(projectDir, projectName, relPosix, { status: 'source_deleted', deletedAt: new Date().toISOString() });
        }
      } catch {
        // ignore
      }
    }

    // If user deletes snippet/screenshot content files via explorer, keep records in sync (best-effort).
    try {
      // Ensure new layout exists for legacy projects
      ensureProjectStructure(projectName, payload?.domain);
      migrateLegacySnippetRecordFilesIfNeeded(projectDir, projectName);
      migrateLegacyScreenshotFolderIfNeeded(projectDir);
      migrateLegacyItemsJsonIfNeeded(projectDir, projectName);
      const rp = relPosix;

      // Clipboard snippets content deletion => update clipboard record
      if ((rp === 'snippets/clipboard' || rp.startsWith('snippets/clipboard/')) && !(rp === 'snippets/snippets-meta' || rp.startsWith('snippets/snippets-meta/'))) {
        removeRecordItemsByContentRelPath(getClipboardRecordPath(projectDir), projectName, rp, wasDir);
      }

      // Screenshot snippets content deletion => update screenshot record
      if ((rp === 'snippets/screenshots' || rp.startsWith('snippets/screenshots/')) && !(rp === 'snippets/snippets-meta' || rp.startsWith('snippets/snippets-meta/'))) {
        removeRecordItemsByContentRelPath(getScreenshotRecordPath(projectDir), projectName, rp, wasDir);
      }
    } catch {
      // ignore in MVP
    }

    try {
      syncStructureJson(projectDir, projectName);
    } catch {
      // ignore
    }
    return { ok: true, projectName };
  });

  ipcMain.handle('explorer/upload', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const destRelPath = String(payload?.destRelPath ?? '');
    const destDir = resolveInside(projectDir, destRelPath);
    if (!fs.existsSync(destDir)) throw new Error('目标目录不存在');

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled) return { ok: true, projectName, copied: 0 };

    // Check conflicts first (same filename+ext)
    const planned = filePaths.map((srcPath) => {
      const baseName = path.basename(srcPath);
      const safeName = sanitizeFileName(baseName) || 'file';
      return { srcPath, safeName };
    });
    const conflicts = planned
      .map((p) => p.safeName)
      .filter((name, idx, arr) => arr.indexOf(name) !== idx || fs.existsSync(path.join(destDir, name)));
    const uniqConflicts = Array.from(new Set(conflicts));
    if (uniqConflicts.length) {
      const ok = await confirmAutoSuffix();
      if (!ok) return { ok: false, projectName, copied: 0, conflict: true, conflicts: uniqConflicts };
    }

    let copied = 0;
    for (const p of planned) {
      const targetPath = uniqConflicts.length ? ensureUniqueDestPath(destDir, p.safeName) : path.join(destDir, p.safeName);
      fs.copyFileSync(p.srcPath, targetPath);
      copied += 1;
    }
    return { ok: true, projectName, copied };
  });

  ipcMain.handle('explorer/rename', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const entryRelPath = String(payload?.relPath ?? '');
    const newNameRaw = String(payload?.newName ?? '');
    if (!entryRelPath) throw new Error('目标路径不能为空');
    if (isProtectedFolderNameRelPath(entryRelPath)) {
      throw new Error('系统目录禁止重命名');
    }
    if (isProtectedRelPath(entryRelPath)) {
      throw new Error('该目录为系统元数据目录，禁止重命名');
    }
    const target = resolveInside(projectDir, entryRelPath);
    if (!fs.existsSync(target)) throw new Error('目标不存在');

    const st = fs.statSync(target);
    const parentDir = path.dirname(target);
    const newName = sanitizeFileName(newNameRaw);
    if (!newName) throw new Error('新名称不能为空');

    let desired = path.join(parentDir, newName);
    // Same name (no-op)
    if (path.resolve(desired) === path.resolve(target)) {
      return { ok: true, projectName, renamedTo: path.basename(target) };
    }
    if (fs.existsSync(desired)) {
      const ok = await confirmAutoSuffix();
      if (!ok) return { ok: false, projectName, conflict: true };
      if (st.isDirectory()) {
        const { fullPath, name } = ensureUniqueDirPath(parentDir, newName);
        desired = fullPath;
        try {
          const prev = safeReadJson(getProjectStructurePath(projectDir), null);
          const fromRel = asPosixRel(entryRelPath);
          const toRel = asPosixRel(path.relative(projectDir, desired));
          const seeded = remapStructureDocRelPaths(prev, fromRel, toRel);
          fs.renameSync(target, desired);
          syncStructureJson(projectDir, projectName, seeded);
        } catch {
          fs.renameSync(target, desired);
          try {
            syncStructureJson(projectDir, projectName);
          } catch {
            // ignore
          }
        }
        return { ok: true, projectName, renamedTo: name };
      }
      const unique = ensureUniqueDestPath(parentDir, newName);
      fs.renameSync(target, unique);
      return { ok: true, projectName, renamedTo: path.basename(unique) };
    }

    if (st.isDirectory()) {
      try {
        const prev = safeReadJson(getProjectStructurePath(projectDir), null);
        const fromRel = asPosixRel(entryRelPath);
        const toRel = asPosixRel(path.relative(projectDir, desired));
        const seeded = remapStructureDocRelPaths(prev, fromRel, toRel);
        fs.renameSync(target, desired);
        syncStructureJson(projectDir, projectName, seeded);
      } catch {
        fs.renameSync(target, desired);
        try {
          syncStructureJson(projectDir, projectName);
        } catch {
          // ignore
        }
      }
    } else {
      fs.renameSync(target, desired);
    }
    return { ok: true, projectName, renamedTo: newName };
  });

  ipcMain.handle('explorer/move', async (_evt, payload) => {
    const { name: projectName, projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const srcRelPath = String(payload?.srcRelPath ?? '');
    const destDirRelPath = String(payload?.destDirRelPath ?? '');
    if (!srcRelPath) throw new Error('源路径不能为空');
    if (isProtectedFolderNameRelPath(srcRelPath)) {
      throw new Error('系统目录禁止移动');
    }
    if (isProtectedRelPath(srcRelPath) || isProtectedRelPath(destDirRelPath)) {
      throw new Error('该目录为系统元数据目录，禁止移动');
    }

    const srcPath = resolveInside(projectDir, srcRelPath);
    if (!fs.existsSync(srcPath)) throw new Error('源目标不存在');

    const destDirPath = resolveInside(projectDir, destDirRelPath);
    if (!fs.existsSync(destDirPath)) throw new Error('目标目录不存在');
    const destDirStat = fs.statSync(destDirPath);
    if (!destDirStat.isDirectory()) throw new Error('目标不是目录');

    const st = fs.statSync(srcPath);
    const baseName = path.basename(srcPath);
    let desired = path.join(destDirPath, baseName);

    // no-op: moving into same folder
    if (path.resolve(desired) === path.resolve(srcPath)) {
      return { ok: true, projectName, movedTo: srcRelPath };
    }

    // prevent moving a folder into itself/descendant
    if (st.isDirectory()) {
      const srcAbs = path.resolve(srcPath);
      const destAbs = path.resolve(destDirPath);
      // drop into itself => treat as no-op
      if (destAbs === srcAbs) {
        return { ok: true, projectName, movedTo: srcRelPath };
      }
      if (destAbs.startsWith(srcAbs + path.sep)) {
        throw new Error('不能将文件夹移动到其自身或子目录中');
      }
    }

    if (fs.existsSync(desired)) {
      const ok = await confirmAutoSuffix();
      if (!ok) return { ok: false, projectName, conflict: true };
      if (st.isDirectory()) {
        const { fullPath, name } = ensureUniqueDirPath(destDirPath, baseName);
        desired = fullPath;
        try {
          const prev = safeReadJson(getProjectStructurePath(projectDir), null);
          const fromRel = asPosixRel(srcRelPath);
          const toRel = asPosixRel(path.relative(projectDir, desired));
          const seeded = remapStructureDocRelPaths(prev, fromRel, toRel);
          fs.renameSync(srcPath, desired);
          syncStructureJson(projectDir, projectName, seeded);
        } catch {
          fs.renameSync(srcPath, desired);
          try {
            syncStructureJson(projectDir, projectName);
          } catch {
            // ignore
          }
        }
        return {
          ok: true,
          projectName,
          movedTo: asPosixRel(path.relative(projectDir, desired)),
          movedName: name,
        };
      }
      const unique = ensureUniqueDestPath(destDirPath, baseName);
      fs.renameSync(srcPath, unique);
      return {
        ok: true,
        projectName,
        movedTo: asPosixRel(path.relative(projectDir, unique)),
        movedName: path.basename(unique),
      };
    }

    if (st.isDirectory()) {
      try {
        const prev = safeReadJson(getProjectStructurePath(projectDir), null);
        const fromRel = asPosixRel(srcRelPath);
        const toRel = asPosixRel(path.relative(projectDir, desired));
        const seeded = remapStructureDocRelPaths(prev, fromRel, toRel);
        fs.renameSync(srcPath, desired);
        syncStructureJson(projectDir, projectName, seeded);
      } catch {
        fs.renameSync(srcPath, desired);
        try {
          syncStructureJson(projectDir, projectName);
        } catch {
          // ignore
        }
      }
    } else {
      fs.renameSync(srcPath, desired);
    }
    return {
      ok: true,
      projectName,
      movedTo: asPosixRel(path.relative(projectDir, desired)),
      movedName: baseName,
    };
  });

  createMainWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

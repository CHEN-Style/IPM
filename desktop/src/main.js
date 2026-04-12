import { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard, protocol, net } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { classifyFile } from '../Agent/index.js';
import { upsertAiSuggestion, listAiSuggestions, setAiSuggestionStatus } from '../Agent/storage/aiStorage.js';
import { registerLocalFoldersIpc } from './main/modules/localFolders.js';
import { registerLocalExplorerIpc } from './main/modules/localExplorer.js';
import { registerAppIpc } from './main/ipc/app.js';
import { registerPrefsIpc } from './main/ipc/prefs.js';
import { registerMetaIpc } from './main/ipc/meta.js';
import { registerAiStorageIpc } from './main/ipc/aiStorage.js';
import { registerExplorerIpc } from './main/ipc/explorer.js';
import { registerProjectsIpc } from './main/ipc/projects.js';
import { registerCasesIpc } from './main/ipc/cases.js';
import { registerSnippetsIpc } from './main/ipc/snippets.js';
import { registerScreenshotsIpc } from './main/ipc/screenshots.js';
import { registerFloatingIpc } from './main/ipc/floating.js';
import { registerUiIpc } from './main/ipc/ui.js';
import { registerClassifyRulesIpc } from './main/ipc/classifyRules.js';
import { registerClassifyEventsIpc } from './main/ipc/classifyEvents.js';
import { seedDefaultRules } from '../Agent/storage/classifyRules.js';
import { registerProjectAgentIpc } from './main/ipc/projectAgent.js';
import { getSession as getAgentSession, removeSession as removeAgentSession } from '../Agent/project-agent/session.js';
import { registerSupervisorIpc } from './main/ipc/supervisor.js';
import { registerPreferencesIpc } from './main/ipc/preferences.js';
import { registerKnowledgeIpc } from './main/ipc/knowledge.js';
import { registerAnalyticsIpc, uploadPendingAnalytics } from './main/ipc/analytics.js';
import { registerSearchIpc } from './main/ipc/search.js';
import { ClassifyTracker } from './main/classifyTracker.js';
import { getProjectDb, closeProjectDb, closeAllDbs } from '../Agent/db/index.js';
import { getSupervisorDb, closeSupervisorDb } from '../Agent/db/supervisorDb.js';
import { ensureBuiltinSkills } from '../Agent/supervisor/skills/builtinSkills.js';
import { runProactiveCheck } from '../Agent/supervisor/proactiveChecker.js';
import { upsertSourceRecord, deleteSourceRecord, getSourceInfo as dbGetSourceInfo } from '../Agent/db/sourceRecords.js';
import { appendLog as dbAppendLog } from '../Agent/db/activityLog.js';

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
  const prefix = `${ts} [IPM][Agent][${level}]`;
  if (extra !== null && extra !== undefined) {
    console.log(`${prefix} ${msg}`, extra);
  } else {
    console.log(`${prefix} ${msg}`);
  }
};


// Bootstrap config: tiny JSON in the app's Application Support directory
// that stores the user's chosen data directory. Separate from state.json
// which lives inside the data directory itself.
const getBootstrapConfigPath = () => path.join(app.getPath('userData'), 'config.json');

const readBootstrapConfig = () => {
  try {
    const p = getBootstrapConfigPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* ignore */ }
  return {};
};

const writeBootstrapConfig = (patch) => {
  const cfg = { ...readBootstrapConfig(), ...patch };
  fs.mkdirSync(path.dirname(getBootstrapConfigPath()), { recursive: true });
  fs.writeFileSync(getBootstrapConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
};

const getDefaultUserFileRoot = () => path.join(app.getPath('userData'), 'IPM', 'userfile');

const getUserFileRoot = () => {
  if (!app.isPackaged) {
    return path.resolve(process.cwd(), 'userfile');
  }
  const cfg = readBootstrapConfig();
  if (cfg.userFileRoot && typeof cfg.userFileRoot === 'string') {
    return cfg.userFileRoot;
  }
  return getDefaultUserFileRoot();
};

const getProjectsRoot = () => path.join(getUserFileRoot(), 'projects');
const getCasesRoot = () => path.join(getUserFileRoot(), 'cases');
const getStudyRoot = () => path.join(getUserFileRoot(), 'study');
const getAppRoot = () => path.join(getUserFileRoot(), '_app');
const getSandboxRoot = () => path.join(getAppRoot(), 'sandbox');
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

  // macOS disallows : and / in filenames (HFS+/APFS)
  let safe = raw.replace(/[/:]/g, '_');

  // Prevent path traversal
  safe = safe.replace(/\.\./g, '_');

  return safe.trim();
};

const sanitizeFileName = (name) => {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  let safe = raw.replace(/[/:]/g, '_');
  safe = safe.replace(/\.\./g, '_');
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

const classifyTracker = new ClassifyTracker();

const triggerAutoClassifyToAiStorage = async ({ domain, projectName, projectDir, sourceRelPath }) => {
  const startedAt = Date.now();
  const fileName = path.basename(String(sourceRelPath || ''));
  classifyTracker.trackQueued(projectName, sourceRelPath, fileName);
  try {
    const ext = path.extname(fileName || '').replace(/^\./, '').toLowerCase();
    // Ensure structure exists (best-effort). structure.json excludes system folders by design.
    const d = normalizeWorkspaceDomain(domain);
    // IMPORTANT: study uses the workspace root; its "projectName" is a display name only.
    ensureProjectStructure(d === 'study' ? '' : projectName, d);
    const folders = buildFolderCandidatesFromStructure(projectDir, projectName);
    agentLog('INFO', `▶ 开始分类 | 文件: ${fileName} | 项目: ${projectName} | 候选文件夹: ${folders.length}`);
    if (!folders.length) {
      agentLog('WARN', `⏭ 跳过分类 — structure.json 中无候选文件夹 | 项目: ${projectName}`);
      classifyTracker.trackFailed(projectName, sourceRelPath, '无候选文件夹');
      return;
    }

    const tempSourceInfo = getTempSourceInfoByRelPath(projectDir, sourceRelPath);
    const sourceDir = tempSourceInfo?.sourceDir || '';

    classifyTracker.trackClassifying(projectName, sourceRelPath);
    const decision = await classifyFile({
      projectName,
      projectDir,
      sourceRelPath,
      fileName,
      ext,
      sourceDir,
      folders,
    });
    const elapsed = Date.now() - startedAt;
    const route = decision.classifiedBy === 'fast-path' ? '⚡ 快速通道' : '🤖 Agent';
    const toolInfo = decision.toolCallCount > 0 ? ` | tool calls: ${decision.toolCallCount}` : '';
    agentLog('INFO', `${route} → ${decision.targetRelPath} | confidence: ${decision.confidence}${toolInfo} | ${elapsed}ms`);
    if (decision.rationale) {
      agentLog('INFO', `   理由: ${decision.rationale}`);
    }

    // Stage result to ai-storage.json (no file move here)
    const written = upsertAiSuggestion(projectDir, projectName, {
      sourceRelPath,
      fileName,
      ext,
      suggestedFolderRelPath: decision.targetRelPath,
      status: 'pending',
      rationale: decision.rationale || '',
      confidence: decision.confidence ?? 0,
      classifiedBy: decision.classifiedBy || '',
      agentMeta: decision.agentMeta || {},
      trace: decision.trace || [],
    });
    agentLog('INFO', `✓ 已写入暂存区 | ${written.sourceRelPath} → ${written.suggestedFolderRelPath}`);
    classifyTracker.trackClassified(projectName, sourceRelPath, {
      targetRelPath: decision.targetRelPath,
      confidence: decision.confidence,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    agentLog('ERROR', 'failed', { domain: normalizeWorkspaceDomain(domain), projectName, sourceRelPath, error: msg, stack: e?.stack || '' });
    classifyTracker.trackFailed(projectName, sourceRelPath, msg);
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

  // Project logs (append-only) — kept for backward compat
  const logPath = getProjectLogPath(projectDir);
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf-8');

  // Initialize SQLite database for the project
  try { getProjectDb(projectDir); } catch { /* ignore */ }

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

  try { seedDefaultRules(projectDir, d); } catch { /* best-effort */ }

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
  const db = getProjectDb(projectDir);
  return upsertSourceRecord(db, entry);
};

const deleteTempSourceRecordByRelPath = (projectDir, sourceRelPathRaw) => {
  const db = getProjectDb(projectDir);
  return deleteSourceRecord(db, sourceRelPathRaw);
};

const getTempSourceInfoByRelPath = (projectDir, sourceRelPathRaw) => {
  const db = getProjectDb(projectDir);
  return dbGetSourceInfo(db, sourceRelPathRaw);
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
  try {
    const metaDir = path.dirname(filePath);
    const projectDir = path.dirname(metaDir);
    const db = getProjectDb(projectDir);
    dbAppendLog(db, obj.event || 'unknown', obj);
  } catch {
    const line = JSON.stringify(obj) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }
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
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return;
  } catch (e) {
    const code = e?.code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY') {
      makeWritableRecursiveSync(targetPath);
      sleepSync(120);
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    }
    throw e;
  }
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
  // Prefer macOS Trash; fall back to hard delete.
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
  // Parallel broadcast to knowledge subscribers for compatibility
  emitKnowledgeChanged({ projectName: payload?.projectName, type: 'updated', id: payload?.id || '' });
};

const emitKnowledgeChanged = (payload) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('knowledge:changed', payload);
    }
  } catch { /* ignore */ }
  try {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.webContents.send('knowledge:changed', payload);
    }
  } catch { /* ignore */ }
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
const mainWindowRef = { current: null };
const floatingWindowRef = { current: null };
let clipboardWatchTimer = null;
let lastClipboardText = '';
let lastClipboardImageHash = '';
const clipboardImageCache = new Map(); // token -> { png: Buffer, width, height, createdAt, hash }

// Best-effort async deletion queue for deferred cleanup.
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
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const menuTemplate = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  loadRenderer(mainWindow, 'main');

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    mainWindowRef.current = null;
  });
  mainWindowRef.current = mainWindow;
};

const createFloatingWindow = () => {
  if (floatingWindow) return floatingWindow;

  floatingWindow = new BrowserWindow({
    width: 420,
    height: 560,
    frame: false,
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

  floatingWindow.setAlwaysOnTop(true, 'floating');

  loadRenderer(floatingWindow, 'floating');

  floatingWindow.on('blur', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.setAlwaysOnTop(true, 'floating');
    }
  });

  floatingWindow.on('closed', () => {
    floatingWindow = null;
    floatingWindowRef.current = null;
    stopClipboardWatcher();
    if (mainWindow) mainWindow.show();
  });

  startClipboardWatcher();
  floatingWindowRef.current = floatingWindow;
  return floatingWindow;
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'ipm-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } },
]);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  process.env.IPM_USER_DATA = app.getPath('userData');
  process.env.IPM_STATE_PATH = getStatePath();

  protocol.handle('ipm-file', (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    return net.fetch(`file://${filePath}`);
  });
  fs.mkdirSync(getUserFileRoot(), { recursive: true });
  fs.mkdirSync(getProjectsRoot(), { recursive: true });
  fs.mkdirSync(getCasesRoot(), { recursive: true });
  fs.mkdirSync(getStudyRoot(), { recursive: true });
  fs.mkdirSync(getAppRoot(), { recursive: true });
  fs.mkdirSync(path.join(getSandboxRoot(), 'skills'), { recursive: true });
  fs.mkdirSync(path.join(getSandboxRoot(), 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(getSandboxRoot(), 'output'), { recursive: true });

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

  // ===== Core IPC (split out of main.js to keep it maintainable) =====
  registerAppIpc({ ipcMain, app, getUserFileRoot, getProjectsRoot, getCasesRoot, getStudyRoot, readState });
  registerPrefsIpc({ ipcMain, readState, writeState, normalizeFloatingUploadMode });

  // ===== Data directory management =====
  ipcMain.handle('prefs/getDataDir', async () => {
    return { ok: true, path: getUserFileRoot(), isCustom: !!readBootstrapConfig().userFileRoot };
  });

  ipcMain.handle('prefs/chooseDataDir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择数据存储目录',
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('prefs/setDataDir', async (_evt, { newPath }) => {
    const oldPath = getUserFileRoot();
    if (path.resolve(newPath) === path.resolve(oldPath)) {
      return { ok: true, changed: false };
    }
    try {
      fs.mkdirSync(newPath, { recursive: true });
      // Move existing data to new location
      if (fs.existsSync(oldPath)) {
        const entries = fs.readdirSync(oldPath);
        for (const entry of entries) {
          const src = path.join(oldPath, entry);
          const dest = path.join(newPath, entry);
          if (!fs.existsSync(dest)) {
            fs.cpSync(src, dest, { recursive: true });
          }
        }
      }
      writeBootstrapConfig({ userFileRoot: newPath });
      return { ok: true, changed: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('prefs/resetDataDir', async () => {
    const cfg = readBootstrapConfig();
    delete cfg.userFileRoot;
    fs.writeFileSync(getBootstrapConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
    return { ok: true };
  });

  ipcMain.handle('prefs/restartApp', async () => {
    app.relaunch();
    app.exit(0);
  });
  registerMetaIpc({
    ipcMain,
    getWorkspaceDirOrThrow,
    normalizeRelPathPosix,
    isProtectedRelPath,
    isSystemFolderRelPath,
    ensureProjectStructure,
    syncStructureJson,
    safeReadJson,
    getProjectStructurePath,
    atomicWriteFileSync,
    appendJsonl,
    getProjectLogPath,
  });
  registerAiStorageIpc({
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
  });

  registerClassifyRulesIpc({ ipcMain, getWorkspaceDirOrThrow });
  registerClassifyEventsIpc({ ipcMain, getWorkspaceDirOrThrow });
  registerPreferencesIpc({ ipcMain, getWorkspaceDirOrThrow });
  registerProjectAgentIpc({ ipcMain, getWorkspaceDirOrThrow, syncStructureJson });
  registerSupervisorIpc({
    ipcMain,
    getAppRoot,
    getSandboxRoot,
    getWorkspaceDirs: () => ({
      projectsRoot: getProjectsRoot(),
      casesRoot: getCasesRoot(),
      studyRoot: getStudyRoot(),
    }),
    getWorkspaceDirOrThrow,
    syncStructureJson,
    readState,
  });

  ipcMain.handle('classify:getSnapshot', async (_evt, payload) => {
    const projectName = String(payload?.projectName || '');
    return { ok: true, ...classifyTracker.getSnapshot(projectName) };
  });
  ipcMain.handle('classify:clearCompleted', async (_evt, payload) => {
    const projectName = String(payload?.projectName || '');
    classifyTracker.clearCompleted(projectName);
    return { ok: true };
  });

  registerExplorerIpc({
    ipcMain,
    dialog,
    shell,
    sanitizeProjectName,
    normalizeRelPathPosix,
    normalizeWorkspaceDomain,
    getWorkspaceRoot,
    getStudyRoot,
    STUDY_WORKSPACE_NAME,
    getWorkspaceDirOrThrow,
    resolveInside,
    asPosixRel,
    isProtectedRelPath,
    isProtectedFolderNameRelPath,
    trashOrRm,
    waitUntilGoneSync,
    sanitizeFileName,
    ensureUniqueDestPath,
    ensureUniqueDirPath,
    confirmAutoSuffix,
    ensureProjectStructure,
    syncStructureJson,
    safeReadJson,
    getProjectStructurePath,
    remapStructureDocRelPaths,
    migrateLegacySnippetRecordFilesIfNeeded,
    migrateLegacyScreenshotFolderIfNeeded,
    migrateLegacyItemsJsonIfNeeded,
    removeRecordItemsByContentRelPath,
    getClipboardRecordPath,
    getScreenshotRecordPath,
    listAiSuggestions,
    setAiSuggestionStatus,
  });

  registerProjectsIpc({
    ipcMain,
    shell,
    readState,
    writeState,
    getProjectsRoot,
    sanitizeProjectName,
    normalizeProjectStatus,
    isTombstoneProjectName,
    isEmptyDirSync,
    safeRmSync,
    quarantineProjectDirSync,
    looksLikeValidProjectDirSync,
    makeWritableRecursiveSync,
    enqueueDeleteDir,
    ensureProjectStructure,
    syncStructureJson,
    getProjectDirOrThrow,
    sleepSync,
    trashOrRm,
    closeProjectDb,
    getAgentSession,
    removeAgentSession,
  });

  registerCasesIpc({
    ipcMain,
    shell,
    readState,
    writeState,
    getCasesRoot,
    sanitizeProjectName,
    normalizeProjectStatus,
    isTombstoneProjectName,
    isEmptyDirSync,
    safeRmSync,
    quarantineProjectDirSync,
    looksLikeValidProjectDirSync,
    makeWritableRecursiveSync,
    enqueueDeleteDir,
    ensureProjectStructure,
    syncStructureJson,
    getWorkspaceDirOrThrow,
    sleepSync,
    trashOrRm,
    closeProjectDb,
    getAgentSession,
    removeAgentSession,
  });

  registerSnippetsIpc({
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
  });

  registerScreenshotsIpc({
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
  });

  registerKnowledgeIpc({
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
  });

  registerFloatingIpc({
    ipcMain,
    getWorkspaceDirOrThrow,
    sanitizeFileName,
    ensureTempDir,
    getProjectStructurePath,
    syncStructureJson,
    ensureUniqueDestPath,
    upsertTempSourceRecord,
    triggerAutoClassifyToAiStorage,
    agentLog,
    resolveInside,
    safeRmSync,
    deleteTempSourceRecordByRelPath,
  });

  registerUiIpc({
    ipcMain,
    createMainWindow,
    createFloatingWindow,
    mainWindowRef,
    floatingWindowRef,
  });

  registerAnalyticsIpc({ ipcMain, getAppRoot });
  registerSearchIpc({ ipcMain, getProjectsRoot, getCasesRoot, getStudyRoot });

  uploadPendingAnalytics(getAppRoot()).catch(() => {});

  // ui/* moved to `src/main/ipc/ui.js`
  // floating/* moved to `src/main/ipc/floating.js`

  // snippets/* moved to `src/main/ipc/snippets.js`
  // screenshots/* moved to `src/main/ipc/screenshots.js`

  // prefs/* moved to `src/main/ipc/prefs.js`

  // projects/* moved to `src/main/ipc/projects.js`
  // cases/* moved to `src/main/ipc/cases.js`

  // explorer/* moved to `src/main/ipc/explorer.js`

  // Initialize Supervisor DB early
  try { getSupervisorDb(getAppRoot()); } catch { /* ignore */ }

  // Install builtin skills if missing
  try { ensureBuiltinSkills(getSandboxRoot()); } catch { /* ignore */ }

  createMainWindow();

  const proactiveCheckArgs = () => ({
    appRoot: getAppRoot(),
    projectsRoot: getProjectsRoot(),
    casesRoot: getCasesRoot(),
    studyRoot: getStudyRoot(),
    readState,
  });

  // Proactive check: run every 30 minutes
  const proactiveCheckInterval = setInterval(() => {
    try { runProactiveCheck(proactiveCheckArgs()); } catch { /* ignore */ }
  }, 30 * 60 * 1000);

  // Initial proactive check after a short delay (let things settle)
  setTimeout(() => {
    try { runProactiveCheck(proactiveCheckArgs()); } catch { /* ignore */ }
  }, 10_000);

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
  closeAllDbs();
  closeSupervisorDb();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

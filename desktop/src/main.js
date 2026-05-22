import { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard, protocol, net, globalShortcut, Tray } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { classifyFile } from '../Agent/index.js';
import { upsertAiSuggestion, listAiSuggestions, setAiSuggestionStatus } from '../Agent/storage/aiStorage.js';
import { registerLocalFoldersIpc } from './main/modules/localFolders.js';
import { registerLocalExplorerIpc } from './main/modules/localExplorer.js';
import { registerAppIpc } from './main/ipc/app.js';
import { registerPrefsIpc } from './main/ipc/prefs.js';
import { registerMetaIpc } from './main/ipc/meta.js';
import { registerAiStorageIpc } from './main/ipc/aiStorage.js';
import { registerExplorerIpc } from './main/ipc/explorer.js';
import { remapInternalPath as pathRemapInternal, cleanupDeletedPath as pathCleanupDeleted } from '../Agent/storage/pathRemapper.js';
import { registerProjectsIpc } from './main/ipc/projects.js';
import { registerCasesIpc } from './main/ipc/cases.js';
import { registerSnippetsIpc } from './main/ipc/snippets.js';
import { registerScreenshotsIpc } from './main/ipc/screenshots.js';
import { registerFloatingIpc } from './main/ipc/floating.js';
import { registerUiIpc } from './main/ipc/ui.js';
import { registerClassifyRulesIpc } from './main/ipc/classifyRules.js';
import { registerClassifyEventsIpc } from './main/ipc/classifyEvents.js';
// W2: seedDefaultRules 不再在新建时调用，但保留模块以备未来「导入模板规则」。
// import { seedDefaultRules } from '../Agent/storage/classifyRules.js';
import { registerKnowClawIpc } from './main/ipc/knowclaw.js';
import { registerPreferencesIpc } from './main/ipc/preferences.js';
import { registerKnowledgeIpc } from './main/ipc/knowledge.js';
import { registerAnalyticsIpc, uploadPendingAnalytics } from './main/ipc/analytics.js';
import { registerSearchIpc } from './main/ipc/search.js';
import { registerOcrIpc } from './main/ipc/ocr.js';
import { ClassifyTracker } from './main/classifyTracker.js';
import { getProjectDb, closeProjectDb, closeAllDbs } from '../Agent/db/index.js';
import { getSupervisorDb, closeSupervisorDb } from '../Agent/db/supervisorDb.js';
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

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Bootstrap config: tiny JSON in a fixed AppData location that stores
// the user's chosen data directory. Separate from state.json which lives
// inside the data directory itself.
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

// ===== F1 · Attached project (external folder) helpers =====
//
// 附属壳 = 数据存储区下的项目壳，业务文件在外部目录。结构：
//   projects/{shellName}/meta/external-link.json  → { rootPath, broken, ... }
//   projects/{shellName}/meta|temp|snippets       → 系统目录（壳内）
// 所有"内容文件"（业务路径）通过 resolveContentPath 解析到外部根。
const getExternalLinkPath = (projectDir) =>
  path.join(getProjectMetaDir(projectDir), 'external-link.json');

const isAttachedProject = (projectDir) => {
  if (!projectDir) return false;
  try {
    return fs.existsSync(getExternalLinkPath(projectDir));
  } catch {
    return false;
  }
};

const readExternalLink = (projectDir) => {
  const p = getExternalLinkPath(projectDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
};

const writeExternalLink = (projectDir, doc) => {
  const p = getExternalLinkPath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload = {
    schemaVersion: 1,
    rootPath: '',
    importedAt: new Date().toISOString(),
    lastScanAt: '',
    lastScanStatus: '',
    broken: false,
    brokenReason: '',
    ...(doc || {}),
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
};

const getExternalRootPath = (projectDir) => {
  const link = readExternalLink(projectDir);
  if (!link || !link.rootPath) return null;
  return String(link.rootPath);
};

// 系统路径（temp/snippets/meta）始终走壳内；业务路径走外部根。
const isAttachedSystemRel = (relPath) => {
  const rp = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rp) return true; // root itself is logically the shell root for metadata
  if (rp === 'temp' || rp.startsWith('temp/')) return true;
  if (rp === 'snippets' || rp.startsWith('snippets/')) return true;
  if (rp === 'meta' || rp.startsWith('meta/')) return true;
  return false;
};

// F1 核心：双根路径解析。
// - 附属壳的"业务路径" → 外部根
// - 附属壳的"系统路径"（temp/snippets/meta）→ 壳内
// - 原生项目 → 全部壳内（行为不变）
// 当 relPath 为空（即"项目根"）时，附属壳返回外部根（用于 explorer/list 根视图）。
const resolveContentPath = (projectDir, relPath) => {
  const rp = String(relPath || '');
  if (!isAttachedProject(projectDir)) {
    return resolveInside(projectDir, rp);
  }
  // attached
  const norm = rp.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (norm === '') {
    // root → external root
    const ext = getExternalRootPath(projectDir);
    if (!ext) throw new Error('附属壳的外部根路径未配置');
    return path.resolve(ext);
  }
  if (isAttachedSystemRel(norm)) {
    return resolveInside(projectDir, norm);
  }
  const ext = getExternalRootPath(projectDir);
  if (!ext) throw new Error('附属壳的外部根路径未配置');
  return resolveInside(ext, norm);
};

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
  // W1: 业务文件夹（收到资料/过程文档/调研研究/交付成果）不再受名称级保护，
  // 用户可自由删除/重命名/移动。仅系统目录保留保护。
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

const ensureProjectStructure = (projectName, domain = 'projects', opts = {}) => {
  const d = normalizeWorkspaceDomain(domain);
  const effectiveName = projectName || (d === 'study' ? STUDY_WORKSPACE_NAME : projectName);
  const projectDir = path.join(getWorkspaceRoot(d), projectName || '');

  // W1: 模板参数控制首次创建时是否落地业务文件夹。
  // - 'default'：保留原有四类（项目/案件）或学习域固定结构（学习域不受 D2 影响）。
  // - 'blank' ：仅创建系统目录，业务夹完全由用户自定义。
  const template = opts.template === 'blank' ? 'blank' : 'default';

  // 系统目录始终保证存在（已删 = 损坏，需补齐）
  fs.mkdirSync(getSnippetsDir(projectDir), { recursive: true });
  fs.mkdirSync(getProjectMetaDir(projectDir), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'temp'), { recursive: true });

  // W1: 业务文件夹仅在「首次初始化」时按模板创建，老项目反复调用本函数不会
  // 再次重建用户已删除的业务夹（RW-W1-2 缓解）。`structure.json` 是否存在是
  // 区分「首次创建 / 已存在工作区」最可靠的信号。
  const structurePath = getProjectStructurePath(projectDir);
  const isFirstInit = !fs.existsSync(structurePath);

  if (isFirstInit) {
    if (d === 'study') {
      // 学习域固定结构保持原状（W1 D2：学习域本阶段不放开）
      for (const f of STUDY_BIZ_FOLDERS) {
        fs.mkdirSync(path.join(projectDir, f), { recursive: true });
      }
      for (const sub of STUDY_TEMPLATE_FOLDERS) {
        fs.mkdirSync(path.join(projectDir, '模板', sub), { recursive: true });
      }
    } else if (template !== 'blank') {
      // 项目/案件 default 模板：落地四类业务夹
      for (const f of WORK_BIZ_FOLDERS) {
        fs.mkdirSync(path.join(projectDir, f), { recursive: true });
      }
    }
    // template === 'blank' 时：项目/案件不创建任何业务夹
  }

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
  if (isFirstInit) {
    try {
      const now = new Date().toISOString();
      if (d === 'study') {
        const desc = getStudyFolderDefaultDescriptions();
        const seedFolders = [...STUDY_BIZ_FOLDERS, ...STUDY_TEMPLATE_FOLDERS.map((x) => `模板/${x}`)];
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
      } else if (template === 'blank') {
        // W1: 空白模板写入空 folders 壳，后续由用户新建文件夹时通过
        // explorer.js syncStructureJson 自动追加 entry。
        const seeded = {
          schemaVersion: 1,
          projectName: effectiveName,
          createdAt: now,
          updatedAt: now,
          folders: {},
        };
        syncStructureJson(projectDir, effectiveName, seeded);
      } else {
        const desc = getBizFolderDefaultDescriptions();
        const seedFolders = WORK_BIZ_FOLDERS;
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
      }
    } catch {
      // best-effort
    }
  }

  // W2: 不再在新建工作区时自动写入种子硬规则（seedDefaultRules）。
  // 用户在「分类规则」面板中从零自定义。已有项目的旧规则文件不受影响。
  // seedDefaultRules 函数保留（可用于未来「导入模板规则」功能）。

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
    // W1: 业务文件夹现在可由用户全部删除（空白模板亦无业务夹），
    // 因此不能再用 WORK_BIZ_FOLDERS 作为「有效项目」判据；
    // 改用系统目录（必定存在）。
    const mustHaveAny = [
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

// F1: 通用目录扫描（仅文件夹，POSIX 相对路径），用于扫描外部根。
// - 不应用 shouldExcludeFromStructureRelPath（外部根没有 IPM 系统文件夹）
// - 跳过隐藏目录（. 开头）
// - 深度限制 maxDepth=20，节点上限 50000，防止意外死循环 / 巨型挂载点
const listExternalDirsRelPosix = (rootDir, opts = {}) => {
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 20;
  const maxEntries = Number.isFinite(opts.maxEntries) ? opts.maxEntries : 50000;
  const baseAbs = path.resolve(rootDir);
  const out = new Set(['']); // root
  const stack = [{ abs: baseAbs, rel: '', depth: 0 }];
  while (stack.length) {
    const cur = stack.pop();
    if (cur.depth >= maxDepth) continue;
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
      if (name.startsWith('.')) continue; // hidden / dotfiles
      const abs = path.join(cur.abs, name);
      const rel = cur.rel ? `${cur.rel}/${name}` : name;
      out.add(rel);
      if (out.size > maxEntries) {
        return Array.from(out);
      }
      stack.push({ abs, rel, depth: cur.depth + 1 });
    }
  }
  return Array.from(out);
};

const syncStructureJson = (projectDir, projectName, seedDoc = null) => {
  // F1: 附属壳禁用原版 sync — 它会扫描壳目录磁盘并清除外部镜像条目。
  // 自动改走 syncStructureFromExternal，调用者无需特殊判断。
  if (isAttachedProject(projectDir)) {
    return syncStructureFromExternal(projectDir, projectName, seedDoc);
  }
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

// F1: 扫描外部根并合并到壳内 structure.json。
// - 磁盘存在但 structure 无记录 → 新增条目（空 description）
// - structure 有记录但磁盘不存在 → 不写入（stale 自然清除，description 丢失可接受）
// - 两者匹配 → 保留 prev 的 description / createdAt
// 同时写回 external-link.json 的 lastScanAt / lastScanStatus / broken 字段。
const syncStructureFromExternal = (projectDir, projectName, seedDoc = null) => {
  const now = new Date().toISOString();
  const structurePath = getProjectStructurePath(projectDir);
  const prev = seedDoc || safeReadJson(structurePath, null) || null;
  const prevFolders = prev && prev.folders && typeof prev.folders === 'object' ? prev.folders : {};

  const link = readExternalLink(projectDir);
  const externalRoot = link?.rootPath ? path.resolve(link.rootPath) : '';

  // 检查外部根是否仍然可访问；不可访问时标 broken，保留 prev.folders 不动。
  let externalOk = false;
  let brokenReason = '';
  if (!externalRoot) {
    brokenReason = '外部链接未配置 rootPath';
  } else {
    try {
      if (!fs.existsSync(externalRoot)) {
        brokenReason = `外部目录不存在：${externalRoot}`;
      } else {
        const st = fs.statSync(externalRoot);
        if (!st.isDirectory()) brokenReason = `外部路径不是目录：${externalRoot}`;
        else externalOk = true;
      }
    } catch (e) {
      brokenReason = `外部目录访问失败：${e?.message || e}`;
    }
  }

  // 写回 external-link.json 状态
  if (link) {
    writeExternalLink(projectDir, {
      ...link,
      lastScanAt: now,
      lastScanStatus: externalOk ? 'ok' : 'broken',
      broken: !externalOk,
      brokenReason: externalOk ? '' : brokenReason,
    });
  }

  let folders = {};
  if (externalOk) {
    const relDirs = listExternalDirsRelPosix(externalRoot);
    for (const rel of relDirs) {
      const prevMeta = prevFolders[rel] && typeof prevFolders[rel] === 'object' ? prevFolders[rel] : {};
      const name = rel ? rel.split('/').slice(-1)[0] : projectName;
      folders[rel] = {
        ...prevMeta,
        relPath: rel,
        name,
        description: typeof prevMeta.description === 'string' ? prevMeta.description : '',
        // 外部目录条目均非系统目录（root 例外，但 root 不参与候选）
        system: rel === '' ? true : false,
        createdAt: typeof prevMeta.createdAt === 'string' ? prevMeta.createdAt : now,
        updatedAt: now,
      };
    }
  } else {
    // broken 时保留 prev.folders（避免破坏既有 description；用户重新定位后会再次扫描）
    folders = { ...prevFolders };
  }

  const doc = {
    schemaVersion: 1,
    projectName,
    attached: true,
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
// G1.2a 系统托盘实例。在 app.whenReady 内创建，will-quit 时 destroy。
let tray = null;
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

// ============================================================================
// Splash window (shown immediately on launch while main window initializes).
//
// Why this exists:
//   We disabled ASAR (see `forge.config.js`) so that Node's native ESM
//   loader can resolve `Agent/pi-runtime/` and its dependencies on
//   physical disk. The trade-off is ~3–8 extra seconds of cold-start
//   while ~24k small files get stat'd / opened by Vite's main bundle,
//   the renderer HTML/JS/CSS load, and React mounts.
//
//   During that window the OS only shows a taskbar entry, which
//   looks like "nothing happened". The splash gives users an
//   immediate visual confirmation that the app is starting, with a
//   progress line we update from key main-process milestones
//   (IPC ready / runtime warmed / opening window).
//
// Implementation notes:
//   * The HTML/CSS/JS is inlined as a `data:` URL, so the splash is
//     fully self-contained — it does NOT touch the renderer bundle,
//     React, or any Vite-managed asset. That keeps splash startup
//     latency well under 50ms even on a cold machine.
//   * Sizing/position: small fixed window centred on the primary
//     display so it doesn't fight the user's monitor layout.
//   * `transparent: true` + `frame: false` + `resizable: false`
//     give a clean "loading card" feel.
//   * Always-on-top while alive, never in the taskbar (the main
//     window's taskbar entry covers that role).
//   * `closeSplashWindow()` is idempotent and tolerates an already-
//     destroyed window so the timeout-fallback and the normal
//     ready-to-show path can both call it safely.

let splashWindow = null;
let splashShownAt = 0;            // wall-clock ms when splash actually became visible
let splashCloseDeferred = false;  // true if closeSplashWindow() was called before min-visible elapsed
const SPLASH_MIN_VISIBLE_MS = 600;  // floor so users always perceive the splash

// Best-effort splash logger. Uses console.log so it lands in stdout when the
// packaged app is launched with `--enable-logging` and in the renderer
// devtools / terminal during `npm start`.
const splashLog = (...args) => {
  try { console.log('[splash]', ...args); } catch { /* ignore */ }
};

const SPLASH_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0; padding: 0; width: 100%; height: 100%;
    background: transparent;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
      "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    user-select: none; -webkit-user-select: none;
    overflow: hidden;
  }
  .card {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 16px;
    background: linear-gradient(135deg, #ffffff 0%, #f3f5fb 100%);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(60, 70, 110, 0.18),
                0 2px 6px rgba(60, 70, 110, 0.08);
  }
  .logo {
    width: 56px; height: 56px;
    border-radius: 14px;
    background: linear-gradient(135deg, #3e4b9c 0%, #5667c4 100%);
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: 22px;
    letter-spacing: 0.5px;
    box-shadow: 0 4px 12px rgba(62, 75, 156, 0.25);
  }
  .title {
    font-size: 17px; font-weight: 600; color: #2f3545;
    letter-spacing: 0.4px;
  }
  .subtitle {
    font-size: 12px; color: #6e7389; font-weight: 400;
    letter-spacing: 0.2px;
  }
  .progress {
    margin-top: 4px;
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; color: #8b90a3;
  }
  .spinner {
    width: 12px; height: 12px;
    border: 2px solid rgba(62, 75, 156, 0.18);
    border-top-color: #3e4b9c;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .progress-text {
    transition: opacity 0.18s ease;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">IPM</div>
    <div class="title">智能项目管理器</div>
    <div class="subtitle">Intelligent Project Manager</div>
    <div class="progress">
      <div class="spinner"></div>
      <div id="progress-text" class="progress-text">正在启动...</div>
    </div>
  </div>
  <script>
    // Listen for progress messages from the main process. We can't use
    // contextBridge here (no preload) so we use the legacy
    // \`ipcRenderer\` exposed by Electron when \`nodeIntegration: true\`.
    // This is safe because the splash window only loads our trusted
    // inline HTML — no third-party content can run in here.
    try {
      const { ipcRenderer } = require('electron');
      ipcRenderer.on('splash:progress', (_evt, text) => {
        const el = document.getElementById('progress-text');
        if (el && typeof text === 'string') {
          el.style.opacity = '0';
          setTimeout(() => { el.textContent = text; el.style.opacity = '1'; }, 100);
        }
      });
    } catch (_err) {
      // ipcRenderer unavailable — splash still renders, just without updates.
    }
  </script>
</body>
</html>`;

const createSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) return splashWindow;

  const t0 = Date.now();
  splashShownAt = 0;
  splashCloseDeferred = false;

  splashWindow = new BrowserWindow({
    width: 340,
    height: 220,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // SYNCHRONOUS SHOW (was: show:false + once('ready-to-show')).
    //
    // Why: in the packaged build, `loadFile(index.html)` for the main
    // window starts almost immediately and its `ready-to-show`
    // fires within ~150ms. The splash's own `ready-to-show`
    // (after data: URL parse + first paint of transparent window)
    // could land *after* that, at which point our main-window
    // ready-to-show handler had already called `closeSplashWindow()`
    // and torn the splash down before it ever made it on-screen.
    //
    // By using `show: true` the OS shows the window as soon as
    // its native frame is created. Combined with `transparent: true`
    // + `backgroundColor: '#00000000'` the worst case is a brief
    // fully-transparent rect for ~1 frame before our inline HTML
    // paints — invisible to the user in practice on Windows.
    show: true,
    backgroundColor: '#00000000',
    webPreferences: {
      // The splash needs `ipcRenderer` access for progress updates and
      // does NOT load any user-supplied or third-party content — only
      // the inline data: URL above. So enabling nodeIntegration here
      // is safe and avoids the cost of compiling/loading a preload.
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  splashLog('window created in', Date.now() - t0, 'ms');

  splashWindow.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML),
  );

  // Track when the splash actually has pixels on screen, so
  // `closeSplashWindow()` can enforce the minimum visible time.
  splashWindow.once('ready-to-show', () => {
    splashShownAt = Date.now();
    splashLog('ready-to-show after', splashShownAt - t0, 'ms');
    if (splashCloseDeferred) {
      // Main window already finished loading before splash had paint.
      // Honour the min-visible floor, then tear down.
      splashLog('close was deferred — honouring min-visible floor');
      closeSplashWindow();
    }
  });

  splashWindow.webContents.once('did-fail-load', (_evt, code, desc) => {
    splashLog('did-fail-load', code, desc);
  });

  splashWindow.on('closed', () => {
    splashLog('closed');
    splashWindow = null;
  });

  return splashWindow;
};

/**
 * Update the splash window's progress line. Safe to call before the
 * splash has finished its initial paint (Electron buffers IPC sends
 * until the renderer is ready) and after it has been closed (no-op).
 */
const updateSplashProgress = (text) => {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  try {
    splashWindow.webContents.send('splash:progress', String(text || ''));
  } catch {
    // Renderer might be torn down between the check and the send;
    // either way we'd rather drop one progress tick than crash main.
  }
};

// Pending onAfterClose callbacks coalesced across multiple closeSplashWindow
// invocations. The fast-launch path can call closeSplashWindow from both the
// main-window ready-to-show handler AND the 25s safety timeout; both want to
// be notified the instant the splash truly disappears, so we just collect them.
let splashCloseCallbacks = [];

const closeSplashWindow = (onAfterClose) => {
  if (typeof onAfterClose === 'function') splashCloseCallbacks.push(onAfterClose);
  if (!splashWindow) {
    // Already closed (or never opened). Run any newly-registered callback
    // on the next tick so callers can rely on it being asynchronous.
    if (splashCloseCallbacks.length) {
      const pending = splashCloseCallbacks;
      splashCloseCallbacks = [];
      setImmediate(() => pending.forEach((fn) => { try { fn(); } catch { /* ignore */ } }));
    }
    return;
  }

  // Min-visible-time guard.
  //
  // Without this, a "fast packaged launch" path can call
  // `closeSplashWindow()` from `mainWindow.ready-to-show` *before*
  // the splash has had a chance to paint a single frame. The user
  // sees: nothing → main window. We instead delay the actual
  // teardown until at least `SPLASH_MIN_VISIBLE_MS` has elapsed
  // since the splash became visible, so the user always perceives
  // a deliberate hand-off rather than a flash.
  //
  // Two cases:
  //   (a) splashShownAt > 0  → splash is already on-screen; if it's
  //       been visible long enough, close immediately; otherwise
  //       schedule a close at the floor.
  //   (b) splashShownAt === 0 → splash has not finished its first
  //       paint yet. Mark the close as deferred; the `ready-to-show`
  //       handler will re-invoke `closeSplashWindow()` once the
  //       splash is visible, falling into case (a). Belt-and-braces:
  //       we also schedule an unconditional teardown at the
  //       SPLASH_MIN_VISIBLE_MS deadline in case `ready-to-show`
  //       never fires for some reason.
  const win = splashWindow;
  // Idempotency guard: don't schedule the real close more than once.
  if (win.__closeScheduled) {
    splashLog('close request coalesced (already scheduled)');
    return;
  }
  win.__closeScheduled = true;

  const doClose = () => {
    splashWindow = null;
    try {
      if (win && !win.isDestroyed()) win.close();
    } catch { /* ignore */ }
    const pending = splashCloseCallbacks;
    splashCloseCallbacks = [];
    pending.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  };

  if (splashShownAt > 0) {
    const elapsed = Date.now() - splashShownAt;
    const wait = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
    splashLog('close requested; visible for', elapsed, 'ms; waiting', wait, 'ms');
    if (wait === 0) {
      doClose();
    } else {
      setTimeout(doClose, wait);
    }
  } else {
    splashLog('close requested BEFORE first paint — deferring until ready-to-show');
    splashCloseDeferred = true;
    // Belt-and-braces: never wait longer than the min-visible deadline,
    // even if ready-to-show never fires. Cap absolute wait at
    // SPLASH_MIN_VISIBLE_MS so a broken splash never blocks main window.
    setTimeout(doClose, SPLASH_MIN_VISIBLE_MS);
  }
};

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(app.getAppPath(), 'assets', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f8f9fb',
      symbolColor: '#414659',
      height: 36,
    },
    // Splash hand-off: keep the main window hidden while it's still
    // loading the renderer bundle so the user only ever sees one of
    // (splash) or (fully-painted main window) — never a half-rendered
    // flash of white. `paintWhenInitiallyHidden` ensures the
    // renderer keeps painting offscreen so `ready-to-show` actually
    // fires (without it, hidden windows can be paused by Chromium).
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  loadRenderer(mainWindow, 'main');

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // Once the renderer has painted its first frame, hand off from
  // splash → main. We deliberately defer `mainWindow.show()` until
  // the splash has actually closed, so the user never sees both
  // windows on screen at the same time (which would happen on a
  // fast packaged launch where main is ready in <200ms but the
  // splash hasn't yet hit its SPLASH_MIN_VISIBLE_MS floor).
  //
  // `closeSplashWindow` invokes the callback synchronously if the
  // splash is already torn down (or absent), and asynchronously the
  // moment the real close completes otherwise — giving us a clean
  // single frame transition.
  mainWindow.once('ready-to-show', () => {
    closeSplashWindow(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });

  // Hard safety: if `ready-to-show` somehow never fires (e.g. the
  // renderer crashed before painting), force the main window visible
  // and tear down the splash after 25s so the user isn't stranded
  // staring at "正在启动...".
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      try { mainWindow.show(); } catch { /* ignore */ }
    }
    closeSplashWindow();
  }, 25_000);

  mainWindow.on('closed', () => {
    mainWindow = null;
    mainWindowRef.current = null;
  });
  mainWindowRef.current = mainWindow;
};

const createFloatingWindow = () => {
  // G1.1a: 实例存活则直接复用 show + focus，避免重建带来的「正在加载目标...」闪烁
  // 与内部状态清零。watcher 依赖 show/hide 事件，复用路径同样会触发 startClipboardWatcher。
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    if (!floatingWindow.isVisible()) floatingWindow.show();
    floatingWindow.focus();
    return floatingWindow;
  }

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
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  floatingWindow.setAlwaysOnTop(true, 'screen-saver');

  loadRenderer(floatingWindow, 'floating');

  floatingWindow.on('blur', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  // G1.1a: 剪贴板 watcher 改为跟随窗口可见性。这样 hide 期间不会空转，
  // show 期间自动恢复；start/stop 都已经做了去重，重复触发也安全。
  floatingWindow.on('show', () => {
    startClipboardWatcher();
  });
  floatingWindow.on('hide', () => {
    stopClipboardWatcher();
  });

  floatingWindow.on('closed', () => {
    floatingWindow = null;
    floatingWindowRef.current = null;
    stopClipboardWatcher();
    // 兜底：用户从系统级 X 直接关掉悬浮（而非通过 backToMain）时，确保中台仍可见。
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  // 首次创建时窗口默认可见，'show' 事件可能晚于此处触发，因此显式 startClipboardWatcher
  // 兜底一次（startClipboardWatcher 内部去重，无副作用）。
  startClipboardWatcher();
  floatingWindowRef.current = floatingWindow;
  return floatingWindow;
};

// G1.0/G1.1 全局切换：Ctrl+Shift+Space / 托盘单击 / 标题栏按钮共享此函数。
// 逻辑：若悬浮窗存在且可见 → 切到中台（隐藏悬浮）；否则 → 切到悬浮（隐藏中台）。
const toggleFloatingAndMain = () => {
  const fwAlive = floatingWindow && !floatingWindow.isDestroyed();
  const mwAlive = mainWindow && !mainWindow.isDestroyed();
  if (fwAlive && floatingWindow.isVisible()) {
    if (mwAlive) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
    // G1.1a: 隐藏而非销毁，保留内部状态。
    floatingWindow.hide();
  } else {
    if (!mwAlive) createMainWindow();
    const fw = createFloatingWindow();
    fw.show();
    fw.focus();
    if (mwAlive) mainWindow.hide();
  }
};

// G1.2a 系统托盘。提供「打开中台 / 打开悬浮窗 / 退出」右键菜单和
// 单击 = 切换的快捷操作，作为快捷键 / 按钮的兜底入口。
const createTray = () => {
  if (tray) return tray;
  try {
    const iconPath = path.join(app.getAppPath(), 'assets', 'icon.ico');
    tray = new Tray(iconPath);
    tray.setToolTip('IPM');
    const buildMenu = () => Menu.buildFromTemplate([
      {
        label: '打开中台',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            createMainWindow();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
          if (floatingWindow && !floatingWindow.isDestroyed()) {
            floatingWindow.hide();
          }
        },
      },
      {
        label: '打开悬浮窗',
        click: () => {
          const fw = createFloatingWindow();
          fw.show();
          fw.focus();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出 IPM',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(buildMenu());
    tray.on('click', () => {
      try { toggleFloatingAndMain(); } catch (err) {
        console.warn('[IPM] tray click toggle failed:', err?.message || err);
      }
    });
  } catch (err) {
    // 部分 Linux 桌面环境（GNOME 等）需要扩展才能显示托盘；失败时静默跳过，
    // 不影响其他入口工作。
    console.warn('[IPM] tray init failed:', err?.message || err);
    tray = null;
  }
  return tray;
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'ipm-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } },
]);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Splash FIRST. Everything below this line is "real init" work; we
  // want the user to see *something* on screen within ~200ms of
  // launch even though the IPC handler registration + renderer
  // boot together can take 4–10s on a cold start. The splash window
  // tears itself down once `mainWindow.ready-to-show` fires (see
  // `createMainWindow`).
  try {
    createSplashWindow();
  } catch (err) {
    // Splash failure must never block the real launch path.
    console.warn('[IPM] splash window failed (continuing):', err?.message || err);
  }
  updateSplashProgress('正在准备运行环境...');

  process.env.IPM_USER_DATA = app.getPath('userData');
  process.env.IPM_STATE_PATH = getStatePath();
  process.env.KNOWCLAW_SESSION_ROOT = path.join(app.getPath('userData'), 'knowclaw-sessions');

  // Phase 8 follow-up: user-authored skills directory. Global (not cwd-scoped)
  // so a skill created once is usable across all IPM workspaces. First-run
  // seeds an empty directory with a README so users can discover what it is.
  const userSkillsRoot = path.join(app.getPath('userData'), 'knowclaw-skills');
  process.env.KNOWCLAW_USER_SKILLS_ROOT = userSkillsRoot;
  try {
    fs.mkdirSync(userSkillsRoot, { recursive: true });

    // Seed a .ignore so pi's skill scanner (which loads any root-level .md as
    // a "flat skill") doesn't try to parse README.md as a skill and emit a
    // noisy "description is required" diagnostic on every session boot.
    // pi reads .gitignore / .ignore / .fdignore from each scanned directory.
    const skillsIgnorePath = path.join(userSkillsRoot, '.ignore');
    if (!fs.existsSync(skillsIgnorePath)) {
      fs.writeFileSync(
        skillsIgnorePath,
        [
          '# Files pi should skip when scanning this directory for skills.',
          '# Do NOT delete this file — without it, README.md gets misread as a skill.',
          'README.md',
          'README.txt',
          '.DS_Store',
          'Thumbs.db',
          '',
        ].join('\n'),
        'utf-8',
      );
    }

    const skillsReadmePath = path.join(userSkillsRoot, 'README.md');
    if (!fs.existsSync(skillsReadmePath)) {
      fs.writeFileSync(
        skillsReadmePath,
        [
          '# KnowClaw 用户技能目录',
          '',
          '这个目录用来存放**你自己写的** KnowClaw 技能（skill）。每个 skill 是一个子目录，',
          '里面至少包含一个 `SKILL.md` 文件。例如：',
          '',
          '```',
          'knowclaw-skills/',
          '├── .ignore            ← 告诉 KnowClaw 忽略 README 等非 skill 文件，请勿删除',
          '├── README.md          ← 本文件',
          '└── my-skill/',
          '    └── SKILL.md       ← 技能定义',
          '```',
          '',
          '## 怎么用',
          '',
          '- KnowClaw 启动时会自动扫描这个目录，把每个 skill 的 `name + description`',
          '  注入到系统提示中。当你的请求匹配某个 skill 的 description 时，模型会',
          '  自动读取对应的 `SKILL.md` 并按里面的指令执行。',
          '- **新增 / 修改 skill 后需要重新创建会话才能生效**（开新会话或重启 IPM）。',
          '',
          '## 怎么创建',
          '',
          '在 KnowClaw 对话里说"帮我创建一个 skill"，内置的 `skill-builder` 会引导你',
          '完成 frontmatter 编写、目录结构、写作原则等所有细节，并把成品写到这里。',
          '',
          '## 注意',
          '',
          '- 不要删除 `.ignore` 文件——它告诉 KnowClaw 哪些根级文件不是 skill。',
          '- 删除某个 skill 子目录即可下线它，下次创建会话时模型就看不到了。',
          '- 如果想加额外的非 skill 文件（如笔记、临时草稿），把文件名加到 `.ignore` 里。',
        ].join('\n'),
        'utf-8',
      );
    }
  } catch (err) {
    console.warn('[KnowClaw] failed to seed user skills dir:', err?.message || err);
  }

  protocol.handle('ipm-file', (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
    return net.fetch(`file:///${filePath.replace(/\\/g, '/')}`);
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

  updateSplashProgress('正在注册系统服务...');

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
    isAttachedProject,
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
    resolveContentPath,
    isAttachedProject,
    sanitizeFileName,
    ensureUniqueDestPath,
  });

  registerClassifyRulesIpc({ ipcMain, getWorkspaceDirOrThrow, isAttachedProject });
  registerClassifyEventsIpc({ ipcMain, getWorkspaceDirOrThrow });
  registerPreferencesIpc({ ipcMain, getWorkspaceDirOrThrow, isAttachedProject });
  registerKnowClawIpc({
    ipcMain,
    getUserFileRoot,
    getWorkspaceDirs: () => ({
      projectsRoot: getProjectsRoot(),
      casesRoot: getCasesRoot(),
      studyRoot: getStudyRoot(),
    }),
    readState,
    writeState,
    getWorkspaceDirOrThrow,
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
    resolveContentPath,
    isAttachedProject,
    getExternalRootPath,
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
    syncStructureFromExternal,
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
    // W3a: 路径联动统一入口
    remapInternalPath: pathRemapInternal,
    cleanupDeletedPath: pathCleanupDeleted,
  });

  // W3b: rename 联动需要的跨库 helpers
  const getStudyDbForRename = () => {
    const studyDir = getStudyRoot();
    try { ensureProjectStructure('', 'study'); } catch { /* ignore */ }
    return { db: getProjectDb(studyDir), projectDir: studyDir };
  };
  const getSupervisorDbForRename = () => {
    try { return getSupervisorDb(getAppRoot()); } catch { return null; }
  };

  registerProjectsIpc({
    ipcMain,
    dialog,
    shell,
    readState,
    writeState,
    getProjectsRoot,
    sanitizeProjectName,
    sanitizeFileName,
    ensureUniqueDirPath,
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
    syncStructureFromExternal,
    isAttachedProject,
    readExternalLink,
    writeExternalLink,
    getProjectDirOrThrow,
    sleepSync,
    trashOrRm,
    closeProjectDb,
    getStudyDb: getStudyDbForRename,
    getSupervisorDb: getSupervisorDbForRename,
  });

  registerCasesIpc({
    ipcMain,
    dialog,
    shell,
    readState,
    writeState,
    getCasesRoot,
    sanitizeProjectName,
    sanitizeFileName,
    ensureUniqueDirPath,
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
    syncStructureFromExternal,
    isAttachedProject,
    readExternalLink,
    writeExternalLink,
    getWorkspaceDirOrThrow,
    sleepSync,
    trashOrRm,
    closeProjectDb,
    getStudyDb: getStudyDbForRename,
    getSupervisorDb: getSupervisorDbForRename,
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
    isAttachedProject,
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

  // G1.0 全局快捷键：Ctrl+Shift+Space 双向切换悬浮 / 中台
  try {
    const ok = globalShortcut.register('CommandOrControl+Shift+Space', () => {
      try { toggleFloatingAndMain(); } catch (err) {
        console.warn('[IPM] toggle on shortcut failed:', err?.message || err);
      }
    });
    if (!ok) console.warn('[IPM] failed to register Ctrl+Shift+Space (key may be in use)');
  } catch (err) {
    console.warn('[IPM] globalShortcut.register error:', err?.message || err);
  }

  // G1.2a 系统托盘
  createTray();

  registerAnalyticsIpc({ ipcMain, getAppRoot });
  registerSearchIpc({ ipcMain, getProjectsRoot, getCasesRoot, getStudyRoot });
  registerOcrIpc({ ipcMain });

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

  // F1: 启动时遍历所有附属壳，执行健康检查 + 增量扫描。
  // - 外部根存在 → syncStructureFromExternal 增量更新 structure.json（保留已有 description）
  // - 外部根不存在 → 标记 broken（UI 红色警告 + 提供重新定位入口）
  // 失败不阻塞主窗口启动；异常吞掉记录到 console。
  try {
    const scanRootsForAttached = [
      { root: getProjectsRoot() },
      { root: getCasesRoot() },
    ];
    let scanned = 0;
    let broken = 0;
    for (const { root } of scanRootsForAttached) {
      if (!fs.existsSync(root)) continue;
      let entries;
      try { entries = fs.readdirSync(root, { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const name = e.name;
        if (isTombstoneProjectName(name)) continue;
        const projectDir = path.join(root, name);
        if (!isAttachedProject(projectDir)) continue;
        scanned += 1;
        try {
          const doc = syncStructureFromExternal(projectDir, name);
          if (doc?.attached) {
            const link = readExternalLink(projectDir);
            if (link?.broken) broken += 1;
          }
        } catch (err) {
          console.warn(`[IPM][F1] startup scan failed for ${name}:`, err?.message || err);
        }
      }
    }
    if (scanned > 0) {
      agentLog('INFO', `F1 启动扫描：检查 ${scanned} 个附属壳，其中 ${broken} 个外部路径失效`);
    }
  } catch (err) {
    console.warn('[IPM][F1] startup health-check failed (non-fatal):', err?.message || err);
  }

  updateSplashProgress('正在打开主窗口...');
  createMainWindow();

  // Background warm-up: load the pi-coding-agent runtime in the
  // background so the first KnowClaw page open doesn't pay the
  // "模型加载中..." latency. The renderer-side IPC handler in
  // `src/main/ipc/knowclaw.js` caches the resolved module on first
  // hit, so calling `ensurePiRuntime()` once here makes any later
  // `knowclaw:listModels` / `knowclaw:getStatus` call return
  // instantly.
  //
  // We delay this until *after* `createMainWindow()` so that the
  // main window's renderer process gets first crack at the file
  // system (its bundle + initial IPC fetches are on the critical
  // path to "ready-to-show"). `setTimeout(...,800)` is a small
  // empirical headroom that lets the renderer finish its initial
  // module graph load before we contend for disk on the same
  // process. Any failure here is silent — KnowClaw will simply
  // do its own lazy load on first visit, identical to today.
  setTimeout(() => {
    updateSplashProgress('正在预热 KnowClaw 运行时...');
    try {
      let piRuntimePath = path.resolve(__dirname, '..', '..', 'Agent', 'pi-runtime', 'index.js');
      if (piRuntimePath.includes('app.asar' + path.sep) || piRuntimePath.includes('app.asar/')) {
        piRuntimePath = piRuntimePath.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
      }
      const url = pathToFileURL(piRuntimePath).href;
      import(/* @vite-ignore */ url)
        .then(() => { /* cached, ready for first KnowClaw visit */ })
        .catch((err) => {
          console.warn('[KnowClaw] background runtime warm-up failed (non-fatal):', err?.message || err);
        });
    } catch (err) {
      console.warn('[KnowClaw] background warm-up scheduling failed:', err?.message || err);
    }
  }, 800);

  // ===== KnowClaw v2 (pi-coding-agent) Phase-0 PoC =====
  // Opt-in only: set KNOWCLAW_PI_POC=1 to trigger one in-memory session
  // and stream pi events to the main-process console. Zero impact on
  // the rest of IPM when the env var is unset.
  //
  // IMPORTANT: we load `pi-runtime/index.js` via an absolute file:// URL
  // wrapped with the `@vite-ignore` hint so Vite does NOT statically
  // analyze (and therefore does NOT inline) this dynamic import into the
  // CJS main bundle. That keeps pi-runtime on Node's native ESM loader,
  // which in turn satisfies the ESM-only `@earendil-works/pi-coding-agent`
  // package's `exports."."` (it only exposes an "import" condition).
  //
  // See: desktop/Agent/KNOWCLAW_REBUILD_PLAN.md (Phase 0)
  if (process.env.KNOWCLAW_PI_POC === '1') {
    setTimeout(async () => {
      try {
        // __dirname at runtime is <desktop>/.vite/build/ ; pi-runtime lives at
        // <desktop>/Agent/pi-runtime/ — i.e. two levels up.
        let piRuntimePath = path.resolve(__dirname, '..', '..', 'Agent', 'pi-runtime', 'index.js');
        if (piRuntimePath.includes('app.asar' + path.sep) || piRuntimePath.includes('app.asar/')) {
          piRuntimePath = piRuntimePath.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
        }
        const piRuntimeUrl = pathToFileURL(piRuntimePath).href;
        const mod = await import(/* @vite-ignore */ piRuntimeUrl);
        const { createKnowClawSession } = mod;
        console.log('[KnowClaw-PoC] starting…');
        const out = await createKnowClawSession({
          cwd: getUserFileRoot(),
          prompt: process.env.KNOWCLAW_PI_POC_PROMPT || '',
          mode: process.env.KNOWCLAW_PI_POC_MODE || undefined,
        });
        console.log('[KnowClaw-PoC] done', out);
      } catch (e) {
        console.error('[KnowClaw-PoC] failed:', e);
      }
    }, 3000);
  }

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

// G1.0 反注册全局快捷键，避免应用退出后仍残留拦截系统按键。
// G1.2a 同步清理托盘图标。
app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  try { tray?.destroy(); tray = null; } catch { /* ignore */ }
  // F3 OCR: release ONNX sessions to free ~200-400MB before quit.
  // ocrService.shutdown() is a no-op if OCR was never initialized, so safe
  // to call unconditionally. The actual onnxruntime-node native module is
  // only loaded inside recognize(); shutdown() just resets the singleton.
  try {
    // Loaded lazily via require/dynamic-import alternative — avoid cycle.
    import('../Agent/services/ocrService.js')
      .then((mod) => mod.shutdown && mod.shutdown())
      .catch(() => { /* ignore */ });
  } catch { /* ignore */ }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

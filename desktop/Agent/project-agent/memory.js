import fs from 'node:fs';
import path from 'node:path';
import { createChatModel } from '../services/llm.js';

const AGENT_DIR = 'agent';
const SUMMARY_FILE = 'project-summary.md';
const SYSTEM_DIRS = new Set(['meta', 'snippets']);
const MAX_FILES_PER_FOLDER = 10;
const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_FOLDERS = 50;

function getAgentDir(projectDir) {
  return path.join(projectDir, 'meta', AGENT_DIR);
}

function getSummaryPath(projectDir) {
  return path.join(getAgentDir(projectDir), SUMMARY_FILE);
}

function ensureAgentDir(projectDir) {
  const dir = getAgentDir(projectDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readProjectSummary(projectDir) {
  const p = getSummaryPath(projectDir);
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

export function writeProjectSummary(projectDir, content) {
  ensureAgentDir(projectDir);
  fs.writeFileSync(getSummaryPath(projectDir), content, 'utf-8');
}

export function hasSummary(projectDir) {
  return fs.existsSync(getSummaryPath(projectDir));
}

function scanProjectStructure(projectDir) {
  const structurePath = path.join(projectDir, 'meta', 'structure.json');
  let structureDoc = null;
  try {
    if (fs.existsSync(structurePath)) {
      structureDoc = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));
    }
  } catch { /* ignore */ }

  const folderDescriptions = {};
  if (structureDoc?.folders) {
    for (const f of Object.values(structureDoc.folders)) {
      if (f?.relPath && f?.description) {
        folderDescriptions[f.relPath] = f.description;
      }
    }
  }

  const result = [];

  function walkDir(dirPath, relBase, depth = 0) {
    if (depth > MAX_SCAN_DEPTH || result.length >= MAX_SCAN_FOLDERS) return;

    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }

    const files = [];
    const subDirs = [];

    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      if (relBase === '' && SYSTEM_DIRS.has(ent.name)) continue;
      if (ent.isDirectory()) {
        subDirs.push(ent.name);
      } else if (ent.isFile()) {
        files.push(ent.name);
      }
    }

    const rel = relBase || '(root)';
    const desc = folderDescriptions[relBase] || '';
    const sampleFiles = files.slice(0, MAX_FILES_PER_FOLDER);
    const totalFiles = files.length;

    result.push({ path: rel, description: desc, totalFiles, sampleFiles });

    for (const sub of subDirs) {
      if (result.length >= MAX_SCAN_FOLDERS) break;
      const subRel = relBase ? `${relBase}/${sub}` : sub;
      walkDir(path.join(dirPath, sub), subRel, depth + 1);
    }
  }

  walkDir(projectDir, '', 0);
  return result;
}

export async function performFirstEncounter(projectDir, projectName) {
  const scan = scanProjectStructure(projectDir);

  const report = scan.map((folder) => {
    let line = `## ${folder.path}`;
    if (folder.description) line += `\n描述：${folder.description}`;
    line += `\n文件总数：${folder.totalFiles}`;
    if (folder.sampleFiles.length > 0) {
      line += `\n文件样本：${folder.sampleFiles.join(', ')}`;
      if (folder.totalFiles > folder.sampleFiles.length) {
        line += ` ... 等共 ${folder.totalFiles} 个`;
      }
    }
    return line;
  }).join('\n\n');

  const prompt = `你是一个文件管理助理，正在第一次认识一个项目。请根据以下项目扫描结果，生成一份简洁的项目认知摘要（Markdown 格式）。

项目名称：${projectName}

扫描结果：
${report}

要求：
1. 总结这个项目的大致用途和特征
2. 列出主要文件夹及其功能
3. 记录关键观察（比如文件类型分布、命名规律等）
4. 控制在 300 字以内
5. 使用中文`;

  try {
    const model = createChatModel();
    const response = await model.invoke([{ role: 'user', content: prompt }]);
    const content = typeof response.content === 'string' ? response.content : String(response.content);
    const header = `# ${projectName} — 项目认知摘要\n\n> 自动生成于 ${new Date().toISOString()}\n\n`;
    const summary = header + content;
    writeProjectSummary(projectDir, summary);
    return summary;
  } catch (e) {
    const fallback = `# ${projectName} — 项目认知摘要\n\n> 自动扫描于 ${new Date().toISOString()}（LLM 不可用，使用原始扫描）\n\n${report}`;
    writeProjectSummary(projectDir, fallback);
    return fallback;
  }
}

export async function lightUpdateSummary(projectDir, sessionNotes) {
  const existing = readProjectSummary(projectDir);
  if (!existing) return;

  const ts = new Date().toISOString();
  const appendix = `\n\n---\n\n### 会话记录 (${ts})\n\n${sessionNotes}`;
  writeProjectSummary(projectDir, existing + appendix);
}

export async function deepUpdateSummary(projectDir, projectName) {
  return performFirstEncounter(projectDir, projectName);
}

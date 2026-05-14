// desktop/Agent/shared/projectRegistry.js
//
// Shared utility for enumerating IPM projects, cases, and the study
// workspace. Originally lived under `desktop/Agent/supervisor/` but
// moved here in Phase 12 — the supervisor tree was deleted, while
// `knowclaw.js` (pi-runtime IPC bridge) still needs this enumeration
// to power custom tools like `list_projects` and `cross_project_stats`.
//
// Pure Node.js (`fs`, `path`) — no AI / LangChain dependency.

import fs from 'node:fs';
import path from 'node:path';

const CACHE_TTL_MS = 5 * 60 * 1000;
const SUMMARY_SNIPPET_CHARS = 200;

let cachedRegistry = null;
let cachedAt = 0;

/**
 * Build a registry of all projects, cases, and the study workspace.
 * Results are cached with a 5-minute TTL.
 */
export function buildProjectRegistry({ projectsRoot, casesRoot, studyRoot, readState }) {
  const now = Date.now();
  if (cachedRegistry && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedRegistry;
  }

  const state = typeof readState === 'function' ? readState() : {};
  const result = [];

  result.push(...enumerateWorkspace(projectsRoot, 'projects', state.projectStatuses));
  result.push(...enumerateWorkspace(casesRoot, 'cases', state.caseStatuses));

  if (fs.existsSync(studyRoot)) {
    const entry = buildEntry(studyRoot, '学习', 'study', 'active');
    if (entry) result.push(entry);
  }

  cachedRegistry = result;
  cachedAt = now;
  return result;
}

export function invalidateRegistryCache() {
  cachedRegistry = null;
  cachedAt = 0;
}

function enumerateWorkspace(rootDir, domain, statusMap) {
  const entries = [];
  if (!fs.existsSync(rootDir)) return entries;

  let dirEntries;
  try {
    dirEntries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return entries;
  }

  const statuses = statusMap && typeof statusMap === 'object' ? statusMap : {};

  for (const de of dirEntries) {
    if (!de.isDirectory()) continue;
    const name = de.name;
    if (name.startsWith('__deleted__') || name.startsWith('.')) continue;

    const projectDir = path.join(rootDir, name);
    const status = statuses[name] || 'active';
    const entry = buildEntry(projectDir, name, domain, status);
    if (entry) entries.push(entry);
  }

  return entries;
}

function buildEntry(projectDir, name, domain, status) {
  try {
    const structurePath = path.join(projectDir, 'meta', 'structure.json');
    let folderCount = 0;
    let folderDescriptions = [];

    if (fs.existsSync(structurePath)) {
      try {
        const doc = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));
        const folders = doc?.folders && typeof doc.folders === 'object' ? doc.folders : {};
        const folderEntries = Object.values(folders).filter(
          (f) => f && typeof f === 'object' && !f.system,
        );
        folderCount = folderEntries.length;
        folderDescriptions = folderEntries
          .filter((f) => f.description)
          .slice(0, 4)
          .map((f) => `${f.name}: ${f.description.slice(0, 60)}`);
      } catch { /* ignore */ }
    }

    let fileCount = 0;
    try {
      const topLevelEntries = fs.readdirSync(projectDir, { withFileTypes: true });
      for (const e of topLevelEntries) {
        if (e.isFile()) fileCount++;
        if (e.isDirectory() && !['meta', 'temp', 'snippets'].includes(e.name)) {
          try {
            const sub = fs.readdirSync(path.join(projectDir, e.name));
            fileCount += sub.length;
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    let summarySnippet = '';
    const summaryPath = path.join(projectDir, 'meta', 'agent', 'project-summary.md');
    if (fs.existsSync(summaryPath)) {
      try {
        const raw = fs.readFileSync(summaryPath, 'utf-8');
        summarySnippet = raw.slice(0, SUMMARY_SNIPPET_CHARS);
      } catch { /* ignore */ }
    }

    let lastModified = null;
    try {
      const stat = fs.statSync(projectDir);
      lastModified = stat.mtime.toISOString();
    } catch { /* ignore */ }

    return {
      name,
      domain,
      path: projectDir,
      status,
      folderCount,
      fileCount,
      folderDescriptions,
      summarySnippet,
      lastModified,
    };
  } catch {
    return null;
  }
}

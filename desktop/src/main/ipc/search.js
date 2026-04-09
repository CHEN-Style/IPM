import fs from 'node:fs';
import path from 'node:path';

const SYSTEM_DIRS = new Set(['meta', 'snippets']);
const MAX_RESULTS = 80;

function searchRecursive(dirPath, relBase, queryLower, results, maxResults) {
  if (results.length >= maxResults) return;
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }

  for (const ent of entries) {
    if (results.length >= maxResults) return;
    if (ent.name.startsWith('.')) continue;
    if (relBase === '' && SYSTEM_DIRS.has(ent.name)) continue;

    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
    const isDir = ent.isDirectory();

    if (ent.name.toLowerCase().includes(queryLower)) {
      results.push({ name: ent.name, kind: isDir ? 'dir' : 'file', relPath: rel, parentPath: relBase });
    }

    if (isDir) {
      searchRecursive(path.join(dirPath, ent.name), rel, queryLower, results, maxResults);
    }
  }
}

function scanDomain(root, domain, queryLower, allResults) {
  if (!fs.existsSync(root)) return;

  if (domain === 'study') {
    const buf = [];
    searchRecursive(root, '', queryLower, buf, MAX_RESULTS - allResults.length);
    for (const r of buf) allResults.push({ ...r, projectName: '', domain });
    return;
  }

  let projectDirs;
  try { projectDirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }

  for (const pDir of projectDirs) {
    if (allResults.length >= MAX_RESULTS) return;
    if (!pDir.isDirectory() || pDir.name.startsWith('.')) continue;

    if (pDir.name.toLowerCase().includes(queryLower)) {
      allResults.push({ name: pDir.name, kind: 'project', relPath: '', parentPath: '', projectName: pDir.name, domain });
    }

    const buf = [];
    searchRecursive(path.join(root, pDir.name), '', queryLower, buf, MAX_RESULTS - allResults.length);
    for (const r of buf) allResults.push({ ...r, projectName: pDir.name, domain });
  }
}

function domainRoot(domain, getProjectsRoot, getCasesRoot, getStudyRoot) {
  if (domain === 'cases') return getCasesRoot();
  if (domain === 'study') return getStudyRoot();
  return getProjectsRoot();
}

export function registerSearchIpc({ ipcMain, getProjectsRoot, getCasesRoot, getStudyRoot }) {
  ipcMain.handle('search/global', async (_evt, payload) => {
    const query = String(payload?.query || '').trim();
    if (!query) return { ok: true, results: [], truncated: false };

    const queryLower = query.toLowerCase();
    const results = [];

    scanDomain(getCasesRoot(), 'cases', queryLower, results);
    scanDomain(getProjectsRoot(), 'projects', queryLower, results);
    scanDomain(getStudyRoot(), 'study', queryLower, results);

    return { ok: true, results, truncated: results.length >= MAX_RESULTS };
  });

  ipcMain.handle('search/project', async (_evt, payload) => {
    const query = String(payload?.query || '').trim();
    const projectName = String(payload?.projectName || '');
    const domain = String(payload?.domain || 'projects');
    if (!query) return { ok: true, results: [], truncated: false };

    const root = domainRoot(domain, getProjectsRoot, getCasesRoot, getStudyRoot);
    const projectDir = domain === 'study' ? root : path.join(root, projectName);
    if (!fs.existsSync(projectDir)) return { ok: true, results: [], truncated: false };

    const results = [];
    searchRecursive(projectDir, '', query.toLowerCase(), results, MAX_RESULTS);
    return { ok: true, results, truncated: results.length >= MAX_RESULTS };
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getProjectDb } from '../../db/index.js';
import { listEvents } from '../../db/events.js';
import { listLogs } from '../../db/activityLog.js';

const projectDomainSchema = {
  projectName: z.string().min(1).describe('Name of the project or case'),
  domain: z.enum(['projects', 'cases', 'study']).describe('Workspace domain'),
};

function resolveProjectDir(getWorkspaceDirOrThrow, projectName, domain) {
  const resolved = getWorkspaceDirOrThrow(projectName, domain);
  return resolved.projectDir;
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function countFiles(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    return fs.readdirSync(dirPath, { withFileTypes: true }).filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

export function createSupervisorReadTools(deps) {
  const { getWorkspaceDirOrThrow } = deps;
  const tools = [];

  tools.push(tool(
    async ({ projectName, domain }) => {
      const projectDir = resolveProjectDir(getWorkspaceDirOrThrow, projectName, domain);
      const structurePath = path.join(projectDir, 'meta', 'structure.json');
      const doc = safeReadJson(structurePath, null);
      const folders = doc?.folders && typeof doc.folders === 'object' ? doc.folders : {};

      const candidates = Object.values(folders)
        .filter((f) => f && typeof f === 'object' && !f.system)
        .sort((a, b) => (a.relPath || '').length - (b.relPath || '').length)
        .map((f) => ({
          relPath: f.relPath,
          name: f.name,
          description: f.description || '',
          fileCount: countFiles(path.join(projectDir, f.relPath)),
        }));

      if (!candidates.length) return `项目 "${projectName}" 没有可用的文件夹。`;
      return JSON.stringify(candidates, null, 2);
    },
    {
      name: 'supervisor_browse_structure',
      description: 'Browse the folder structure of a specific project/case, showing folder names, descriptions, and file counts.',
      schema: z.object({ ...projectDomainSchema }),
    },
  ));

  tools.push(tool(
    async ({ projectName, domain, folderRelPath }) => {
      const projectDir = resolveProjectDir(getWorkspaceDirOrThrow, projectName, domain);
      const absPath = path.join(projectDir, folderRelPath);
      if (!fs.existsSync(absPath)) return `文件夹 "${folderRelPath}" 不存在。`;

      try {
        const stat = fs.statSync(absPath);
        if (!stat.isDirectory()) return `"${folderRelPath}" 不是文件夹。`;
      } catch {
        return `无法读取 "${folderRelPath}"。`;
      }

      let entries;
      try {
        entries = fs.readdirSync(absPath, { withFileTypes: true });
      } catch {
        return `无法列出 "${folderRelPath}" 的内容。`;
      }

      const files = entries
        .filter((e) => e.isFile())
        .map((e) => {
          let mtime = '';
          const fullPath = path.join(absPath, e.name);
          try { mtime = fs.statSync(fullPath).mtime.toISOString(); } catch { /* ignore */ }
          return { name: e.name, absolutePath: fullPath, modifiedAt: mtime };
        })
        .sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));

      if (!files.length) return `文件夹 "${folderRelPath}" 为空。`;

      return JSON.stringify({
        project: projectName,
        folderRelPath,
        absoluteFolderPath: absPath,
        totalFiles: files.length,
        files: files.slice(0, 50),
      }, null, 2);
    },
    {
      name: 'supervisor_inspect_folder',
      description: 'List files inside a specific folder of a project/case, showing file names and last modified times.',
      schema: z.object({
        ...projectDomainSchema,
        folderRelPath: z.string().min(1).describe('Relative path of the folder to inspect'),
      }),
    },
  ));

  tools.push(tool(
    async ({ projectName, domain }) => {
      const projectDir = resolveProjectDir(getWorkspaceDirOrThrow, projectName, domain);
      const SYSTEM_DIRS = new Set(['meta', 'snippets']);

      let totalFiles = 0;
      let totalBytes = 0;
      const folderStats = [];

      function walkStats(dirPath, relBase) {
        let entries;
        try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
        let fc = 0, bytes = 0;
        for (const ent of entries) {
          if (ent.name.startsWith('.')) continue;
          if (relBase === '' && SYSTEM_DIRS.has(ent.name)) continue;
          if (ent.isFile()) {
            fc++;
            try { bytes += fs.statSync(path.join(dirPath, ent.name)).size; } catch { /* skip */ }
          } else if (ent.isDirectory()) {
            walkStats(path.join(dirPath, ent.name), relBase ? `${relBase}/${ent.name}` : ent.name);
          }
        }
        if (relBase) folderStats.push({ folder: relBase, fileCount: fc, sizeMB: Math.round(bytes / 1024 / 1024 * 100) / 100 });
        totalFiles += fc;
        totalBytes += bytes;
      }

      walkStats(projectDir, '');

      let pendingCount = 0;
      try {
        const db = getProjectDb(projectDir);
        const row = db.prepare("SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending'").get();
        pendingCount = row?.cnt || 0;
      } catch { /* ignore */ }

      return JSON.stringify({
        project: projectName,
        totalFiles,
        totalSizeMB: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
        folderCount: folderStats.length,
        pendingSuggestions: pendingCount,
        folders: folderStats,
      }, null, 2);
    },
    {
      name: 'supervisor_get_project_stats',
      description: 'Get statistics for a specific project: total files, folder counts, sizes, and pending AI suggestions.',
      schema: z.object({ ...projectDomainSchema }),
    },
  ));

  tools.push(tool(
    async ({ projectName, domain, query, extension }) => {
      const projectDir = resolveProjectDir(getWorkspaceDirOrThrow, projectName, domain);
      const SYSTEM_DIRS = new Set(['meta', 'snippets']);
      const MAX_RESULTS = 50;
      const results = [];

      function searchRecursive(dirPath, relBase) {
        if (results.length >= MAX_RESULTS) return;
        let entries;
        try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
          if (results.length >= MAX_RESULTS) return;
          if (ent.name.startsWith('.')) continue;
          if (relBase === '' && SYSTEM_DIRS.has(ent.name)) continue;
          const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
          if (ent.isFile()) {
            const nameMatch = !query || ent.name.toLowerCase().includes(query.toLowerCase());
            const extMatch = !extension || ent.name.toLowerCase().endsWith(`.${extension.toLowerCase()}`);
            if (nameMatch && extMatch) {
              results.push({
                path: rel,
                absolutePath: path.join(projectDir, rel),
                name: ent.name,
              });
            }
          } else if (ent.isDirectory()) {
            searchRecursive(path.join(dirPath, ent.name), rel);
          }
        }
      }

      searchRecursive(projectDir, '');
      if (!results.length) return `在 "${projectName}" 中没有找到匹配的文件。`;
      return JSON.stringify({ project: projectName, matchCount: results.length, files: results }, null, 2);
    },
    {
      name: 'supervisor_search_files',
      description: 'Search for files in a specific project by name keyword and/or extension.',
      schema: z.object({
        ...projectDomainSchema,
        query: z.string().optional().default('').describe('Keyword to search in file names'),
        extension: z.string().optional().default('').describe('File extension filter without dot'),
      }),
    },
  ));

  tools.push(tool(
    async ({ projectName, domain, count }) => {
      const projectDir = resolveProjectDir(getWorkspaceDirOrThrow, projectName, domain);
      const db = getProjectDb(projectDir);
      const limit = Math.min(50, Math.max(1, count || 20));

      const classifyEvents = listEvents(db, { limit });
      const activityLogs = listLogs(db, { limit: Math.min(limit, 20) });

      const combined = [];
      for (const e of classifyEvents.events) {
        combined.push({
          type: 'classify', time: e.ts, event: e.event,
          fileName: e.fileName, suggestedFolder: e.suggestedFolder,
        });
      }
      for (const l of activityLogs) {
        combined.push({ type: 'activity', time: l.ts, event: l.event });
      }

      combined.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      const result = combined.slice(0, limit);
      if (!result.length) return `"${projectName}" 没有近期事件。`;
      return JSON.stringify({ project: projectName, events: result }, null, 2);
    },
    {
      name: 'supervisor_get_recent_events',
      description: 'Get recent classification events and activity logs for a specific project.',
      schema: z.object({
        ...projectDomainSchema,
        count: z.number().optional().default(20).describe('Number of events to return (max 50)'),
      }),
    },
  ));

  tools.push(tool(
    async ({ projectName, domain, status, keyword }) => {
      const projectDir = resolveProjectDir(getWorkspaceDirOrThrow, projectName, domain);
      const db = getProjectDb(projectDir);

      const conditions = [];
      const params = {};
      if (status) {
        const eventType = status === 'accepted' ? 'classify.accepted' : status === 'rejected' ? 'classify.rejected' : '';
        if (eventType) { conditions.push('event = @eventType'); params.eventType = eventType; }
      }
      if (keyword) {
        conditions.push("(file_name LIKE @kw COLLATE NOCASE OR suggested_folder LIKE @kw COLLATE NOCASE)");
        params.kw = `%${keyword}%`;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = db.prepare(`SELECT * FROM events ${where} ORDER BY ts DESC LIMIT 30`).all(params);

      if (!rows.length) return `"${projectName}" 没有匹配的分类历史。`;
      const summary = rows.map((r) => ({
        fileName: r.file_name, event: r.event,
        suggestedFolder: r.suggested_folder,
        userFeedback: r.user_feedback || undefined,
        time: r.ts,
      }));
      return JSON.stringify({ project: projectName, history: summary }, null, 2);
    },
    {
      name: 'supervisor_query_history',
      description: 'Query past classification events for a specific project.',
      schema: z.object({
        ...projectDomainSchema,
        status: z.enum(['accepted', 'rejected', '']).optional().default('').describe('Filter by decision type'),
        keyword: z.string().optional().default('').describe('Keyword filter'),
      }),
    },
  ));

  return tools;
}

import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';

const SYSTEM_DIRS = new Set(['meta', 'temp', 'snippets']);

function walkStats(dirPath, relBase) {
  const stats = [];
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return stats; }

  let fileCount = 0;
  let totalBytes = 0;
  const subDirs = [];

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (relBase === '' && SYSTEM_DIRS.has(ent.name)) continue;

    if (ent.isFile()) {
      fileCount++;
      try { totalBytes += fs.statSync(path.join(dirPath, ent.name)).size; } catch { /* skip */ }
    } else if (ent.isDirectory()) {
      subDirs.push(ent.name);
    }
  }

  const rel = relBase || '(root)';
  stats.push({ folder: rel, fileCount, sizeBytes: totalBytes });

  for (const sub of subDirs) {
    const childRel = relBase ? `${relBase}/${sub}` : sub;
    stats.push(...walkStats(path.join(dirPath, sub), childRel));
  }
  return stats;
}

export function createGetProjectStatsTool(projectDir) {
  return tool(
    async () => {
      const folderStats = walkStats(projectDir, '');

      const totalFiles = folderStats.reduce((s, f) => s + f.fileCount, 0);
      const totalSize = folderStats.reduce((s, f) => s + f.sizeBytes, 0);
      const folderCount = folderStats.filter((f) => f.folder !== '(root)').length;

      let pendingCount = 0;
      try {
        const db = getProjectDb(projectDir);
        const row = db.prepare("SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending'").get();
        pendingCount = row?.cnt || 0;
      } catch { /* ignore */ }

      let recentEventTs = null;
      try {
        const db = getProjectDb(projectDir);
        const row = db.prepare('SELECT ts FROM events ORDER BY ts DESC LIMIT 1').get();
        recentEventTs = row?.ts || null;
      } catch { /* ignore */ }

      const summary = {
        totalFiles,
        totalSizeBytes: totalSize,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        folderCount,
        pendingSuggestions: pendingCount,
        lastEventTime: recentEventTs,
        folders: folderStats.filter((f) => f.folder !== '(root)').map((f) => ({
          folder: f.folder,
          fileCount: f.fileCount,
          sizeMB: Math.round(f.sizeBytes / 1024 / 1024 * 100) / 100,
        })),
      };

      return JSON.stringify(summary, null, 2);
    },
    {
      name: 'get_project_stats',
      description: 'Get project statistics: total files, folder counts, sizes, pending AI suggestions, and last activity time.',
      schema: z.object({}),
    },
  );
}

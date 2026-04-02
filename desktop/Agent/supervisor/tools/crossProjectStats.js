import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { buildProjectRegistry } from '../projectRegistry.js';
import { getProjectDb } from '../../db/index.js';

export function createCrossProjectStatsTool(deps) {
  const { getWorkspaceDirs, readState } = deps;

  return tool(
    async () => {
      const { projectsRoot, casesRoot, studyRoot } = getWorkspaceDirs();
      const registry = buildProjectRegistry({ projectsRoot, casesRoot, studyRoot, readState });

      let totalFiles = 0;
      let totalFolders = 0;
      const projectStats = [];

      for (const p of registry) {
        totalFiles += p.fileCount || 0;
        totalFolders += p.folderCount || 0;

        let pendingSuggestions = 0;
        let recentEventCount = 0;
        let tempFileCount = 0;

        try {
          const db = getProjectDb(p.path);
          const pendingRow = db.prepare("SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending'").get();
          pendingSuggestions = pendingRow?.cnt || 0;

          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const eventRow = db.prepare('SELECT COUNT(*) as cnt FROM events WHERE ts > ?').get(cutoff);
          recentEventCount = eventRow?.cnt || 0;
        } catch { /* ignore - db may not exist */ }

        try {
          const tempDir = path.join(p.path, 'temp');
          if (fs.existsSync(tempDir)) {
            const entries = fs.readdirSync(tempDir, { withFileTypes: true });
            tempFileCount = entries.filter((e) => e.isFile()).length;
          }
        } catch { /* ignore */ }

        projectStats.push({
          name: p.name,
          domain: p.domain,
          files: p.fileCount,
          folders: p.folderCount,
          pendingSuggestions,
          tempFiles: tempFileCount,
          recentEvents24h: recentEventCount,
        });
      }

      const summary = {
        totalProjects: registry.length,
        totalFiles,
        totalFolders,
        projects: projectStats,
      };

      return JSON.stringify(summary, null, 2);
    },
    {
      name: 'cross_project_stats',
      description: 'Get cross-project statistics: total files, folders, pending AI suggestions, temp backlog, and recent events across all projects and cases.',
      schema: z.object({}),
    },
  );
}

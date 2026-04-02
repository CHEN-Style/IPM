import fs from 'node:fs';
import path from 'node:path';
import { getSupervisorDb, addNotification } from '../db/supervisorDb.js';
import { buildProjectRegistry, invalidateRegistryCache } from './projectRegistry.js';
import { getProjectDb } from '../db/index.js';

let lastCheckResult = null;

/**
 * Run a lightweight proactive check across all projects.
 * If new issues are found, write them to the notifications table.
 * Called periodically from main.js.
 */
export function runProactiveCheck({ appRoot, projectsRoot, casesRoot, studyRoot, readState }) {
  invalidateRegistryCache();
  const registry = buildProjectRegistry({ projectsRoot, casesRoot, studyRoot, readState });
  const db = getSupervisorDb(appRoot);
  const newIssues = [];
  const allCurrentKeys = new Set();

  for (const p of registry) {
    let tempFileCount = 0;
    try {
      const tempDir = path.join(p.path, 'temp');
      if (fs.existsSync(tempDir)) {
        const entries = fs.readdirSync(tempDir, { withFileTypes: true });
        tempFileCount = entries.filter((e) => e.isFile()).length;
      }
    } catch { /* ignore */ }

    if (tempFileCount > 5) {
      const key = `temp_backlog:${p.name}`;
      allCurrentKeys.add(key);
      if (!lastCheckResult?.has(key)) {
        newIssues.push({
          type: 'warning',
          title: `${p.name} 有 ${tempFileCount} 个待分类文件`,
          content: `项目「${p.name}」的 temp/ 目录积压了 ${tempFileCount} 个文件，建议尽快处理。`,
          projectName: p.name,
        });
      }
    }

    try {
      const pdb = getProjectDb(p.path);

      const pendingRow = pdb.prepare("SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending'").get();
      const pendingCount = pendingRow?.cnt || 0;

      if (pendingCount > 5) {
        const key = `pending_suggestions:${p.name}`;
        allCurrentKeys.add(key);
        if (!lastCheckResult?.has(key)) {
          newIssues.push({
            type: 'info',
            title: `${p.name} 有 ${pendingCount} 条待处理建议`,
            content: `项目「${p.name}」有 ${pendingCount} 条 AI 分类建议等待确认。`,
            projectName: p.name,
          });
        }
      }

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const staleRow = pdb.prepare(
        "SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending' AND created_at < ?",
      ).get(threeDaysAgo);
      const staleCount = staleRow?.cnt || 0;

      if (staleCount > 0) {
        const key = `stale_suggestions:${p.name}`;
        allCurrentKeys.add(key);
        if (!lastCheckResult?.has(key)) {
          newIssues.push({
            type: 'warning',
            title: `${p.name} 有 ${staleCount} 条过期建议`,
            content: `项目「${p.name}」有 ${staleCount} 条超过 3 天未处理的分类建议。`,
            projectName: p.name,
          });
        }
      }
    } catch { /* ignore - db may not exist for this project */ }
  }

  for (const issue of newIssues) {
    try {
      addNotification(db, {
        type: issue.type,
        title: issue.title,
        content: issue.content,
        projectName: issue.projectName,
      });
    } catch { /* ignore */ }
  }

  lastCheckResult = allCurrentKeys;
  return { issuesFound: newIssues.length };
}

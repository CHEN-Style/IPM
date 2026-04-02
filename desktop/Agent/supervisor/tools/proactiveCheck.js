import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { buildProjectRegistry } from '../projectRegistry.js';
import { getProjectDb } from '../../db/index.js';

export function createProactiveCheckTool(deps) {
  const { getWorkspaceDirs, readState } = deps;

  return tool(
    async () => {
      const { projectsRoot, casesRoot, studyRoot } = getWorkspaceDirs();
      const registry = buildProjectRegistry({ projectsRoot, casesRoot, studyRoot, readState });

      const issues = [];
      const activitySummaries = [];

      for (const p of registry) {
        let tempFileCount = 0;
        try {
          const tempDir = path.join(p.path, 'temp');
          if (fs.existsSync(tempDir)) {
            const entries = fs.readdirSync(tempDir, { withFileTypes: true });
            tempFileCount = entries.filter((e) => e.isFile()).length;
          }
        } catch { /* ignore */ }

        if (tempFileCount > 0) {
          issues.push({
            project: p.name,
            domain: p.domain,
            type: 'temp_backlog',
            severity: tempFileCount > 10 ? 'high' : tempFileCount > 3 ? 'medium' : 'low',
            message: `${p.name} 的 temp/ 目录有 ${tempFileCount} 个待分类文件`,
          });
        }

        try {
          const db = getProjectDb(p.path);

          const pendingRow = db.prepare("SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending'").get();
          const pendingCount = pendingRow?.cnt || 0;
          if (pendingCount > 0) {
            issues.push({
              project: p.name,
              domain: p.domain,
              type: 'pending_suggestions',
              severity: pendingCount > 10 ? 'high' : pendingCount > 3 ? 'medium' : 'low',
              message: `${p.name} 有 ${pendingCount} 条 AI 分类建议待处理`,
            });
          }

          const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
          const oldPendingRow = db.prepare(
            "SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending' AND created_at < ?",
          ).get(threeDaysAgo);
          const oldPendingCount = oldPendingRow?.cnt || 0;
          if (oldPendingCount > 0) {
            issues.push({
              project: p.name,
              domain: p.domain,
              type: 'stale_suggestions',
              severity: 'medium',
              message: `${p.name} 有 ${oldPendingCount} 条超过 3 天未处理的建议`,
            });
          }

          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const recentEvents = db.prepare(
            'SELECT COUNT(*) as cnt FROM events WHERE ts > ?',
          ).get(oneDayAgo);
          const recentLogs = db.prepare(
            'SELECT COUNT(*) as cnt FROM activity_log WHERE ts > ?',
          ).get(oneDayAgo);

          if ((recentEvents?.cnt || 0) > 0 || (recentLogs?.cnt || 0) > 0) {
            activitySummaries.push({
              project: p.name,
              domain: p.domain,
              classifyEvents24h: recentEvents?.cnt || 0,
              activityLogs24h: recentLogs?.cnt || 0,
            });
          }
        } catch { /* ignore - db may not exist */ }
      }

      if (!issues.length && !activitySummaries.length) {
        return '所有项目状况良好，没有需要关注的事项。';
      }

      const result = { issues, recentActivity: activitySummaries };
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'proactive_check',
      description: 'Proactively check all projects for potential issues: temp file backlog, pending/stale AI suggestions, and summarize recent activity across all workspaces.',
      schema: z.object({}),
    },
  );
}

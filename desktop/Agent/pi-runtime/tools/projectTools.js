// desktop/Agent/pi-runtime/tools/projectTools.js
//
// Phase-5 customTools: IPM-specific read-only project tools, exposed to
// the pi-coding-agent runtime via `defineTool` + TypeBox schemas.
//
// Design constraints:
//
// 1. This file is loaded by Node.js as ESM (pi-runtime has its own
//    package.json with `"type": "module"`). It must NOT import any
//    sibling files from `desktop/Agent/supervisor/...` or
//    `desktop/Agent/db/...` directly — those use ESM syntax but live
//    under a CJS-defaulted package, so they can only be loaded by the
//    Vite-compiled main bundle. Business helpers are instead injected
//    via the `deps` parameter from `desktop/src/main/ipc/knowclaw.js`.
//
// 2. Returned tool results MUST conform to `AgentToolResult`:
//        { content: [{ type: 'text', text }], details: T }
//    (see node_modules/@earendil-works/pi-agent-core/dist/types.d.ts).
//
// 3. Schemas use TypeBox (`typebox` package), which is already a
//    transitive dependency of `@earendil-works/pi-coding-agent`.

import fs from 'node:fs';
import path from 'node:path';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function textResult(text) {
  return {
    content: [{ type: 'text', text: String(text ?? '') }],
    details: null,
  };
}

function safeCount(db, sql, params = []) {
  try {
    const row = db.prepare(sql).get(...(Array.isArray(params) ? params : [params]));
    return row?.cnt || 0;
  } catch {
    return 0;
  }
}

function tempFileCount(projectPath) {
  try {
    const tempDir = path.join(projectPath, 'temp');
    if (!fs.existsSync(tempDir)) return 0;
    return fs.readdirSync(tempDir, { withFileTypes: true }).filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

// ----------------------------------------------------------------------------
// Shared TypeBox fragments
// ----------------------------------------------------------------------------

const projectDomainParams = {
  projectName: Type.String({
    minLength: 1,
    description: 'Name of the IPM project, case, or study workspace.',
  }),
  domain: Type.Union(
    [Type.Literal('projects'), Type.Literal('cases'), Type.Literal('study')],
    {
      description:
        'IPM workspace domain. Must be one of: "projects" (项目), "cases" (案件), or "study" (学习空间). ' +
        'Use "projects" for items created under 我的资料→项目, "cases" for items under 我的资料→案件, ' +
        'and "study" for the single study workspace. When the user says "项目X", use domain="projects"; ' +
        'when they say "案件D" or "案件X", use domain="cases".',
    },
  ),
};

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Build the array of IPM read-only project tools.
 *
 * @param {object} deps
 * @param {() => { projectsRoot: string, casesRoot: string, studyRoot: string }} deps.getWorkspaceDirs
 * @param {() => any} deps.readState
 * @param {(name: string, domain: 'projects'|'cases'|'study') => { projectDir: string }} deps.getWorkspaceDirOrThrow
 * @param {(args: object) => Array<object>} deps.buildProjectRegistry
 * @param {(projectDir: string) => any} deps.getProjectDb
 * @param {(db: any, opts?: object) => { events: Array<object> }} deps.listEvents
 * @param {(db: any, opts?: object) => Array<object>} deps.listLogs
 * @returns {Array<object>} pi `ToolDefinition[]` ready to pass to `customTools`.
 */
export function buildProjectTools(deps) {
  if (!deps || typeof deps !== 'object') {
    throw new Error('buildProjectTools: deps is required');
  }
  const {
    getWorkspaceDirs,
    readState,
    getWorkspaceDirOrThrow,
    buildProjectRegistry,
    getProjectDb,
    listEvents,
    listLogs,
  } = deps;

  const usageGuideline =
    'Only call IPM-specific tools (list_projects, cross_project_stats, proactive_check, get_recent_events, query_history) when the user explicitly asks about their IPM projects, cases, study workspaces, or related activity.';

  // --- 1. list_projects ----------------------------------------------------

  const listProjectsTool = defineTool({
    name: 'list_projects',
    label: 'List IPM Projects',
    description:
      'List all IPM projects, cases, and study workspaces with their status, folder count, file count, and summary snippets. Use when the user asks "what projects do I have", "show my cases", or anything requiring an inventory of their IPM workspaces.',
    promptSnippet:
      'list_projects: enumerate IPM projects/cases/study workspaces with file counts.',
    promptGuidelines: [usageGuideline],
    parameters: Type.Object({}),
    async execute() {
      const { projectsRoot, casesRoot, studyRoot } = getWorkspaceDirs();
      const registry = buildProjectRegistry({
        projectsRoot, casesRoot, studyRoot, readState,
      });

      if (!registry.length) {
        return textResult('当前没有任何项目/案件/学习空间。');
      }

      const grouped = { projects: [], cases: [], study: [] };
      for (const p of registry) {
        (grouped[p.domain] || grouped.projects).push(p);
      }

      const lines = [];
      if (grouped.projects.length) {
        lines.push('## 项目');
        for (const p of grouped.projects) {
          lines.push(`- **${p.name}** [${p.status}] — ${p.folderCount} 个文件夹, ~${p.fileCount} 个文件`);
          if (p.summarySnippet) lines.push(`  摘要: ${p.summarySnippet.slice(0, 120)}`);
        }
      }
      if (grouped.cases.length) {
        lines.push('## 案件');
        for (const p of grouped.cases) {
          lines.push(`- **${p.name}** [${p.status}] — ${p.folderCount} 个文件夹, ~${p.fileCount} 个文件`);
          if (p.summarySnippet) lines.push(`  摘要: ${p.summarySnippet.slice(0, 120)}`);
        }
      }
      if (grouped.study.length) {
        lines.push('## 学习空间');
        for (const p of grouped.study) {
          lines.push(`- **${p.name}** — ${p.folderCount} 个文件夹, ~${p.fileCount} 个文件`);
        }
      }

      return textResult(lines.join('\n'));
    },
  });

  // --- 2. cross_project_stats ---------------------------------------------

  const crossProjectStatsTool = defineTool({
    name: 'cross_project_stats',
    label: 'Cross-Project Statistics',
    description:
      'Get aggregated statistics across all IPM projects/cases: total files, folders, pending AI classification suggestions, temp-folder backlog, and recent events in the last 24 hours.',
    promptSnippet:
      'cross_project_stats: aggregated counts (files, suggestions, temp backlog, recent events) for all IPM projects.',
    promptGuidelines: [usageGuideline],
    parameters: Type.Object({}),
    async execute() {
      const { projectsRoot, casesRoot, studyRoot } = getWorkspaceDirs();
      const registry = buildProjectRegistry({
        projectsRoot, casesRoot, studyRoot, readState,
      });

      let totalFiles = 0;
      let totalFolders = 0;
      const projects = [];
      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      for (const p of registry) {
        totalFiles += p.fileCount || 0;
        totalFolders += p.folderCount || 0;

        let pendingSuggestions = 0;
        let recentEvents24h = 0;
        try {
          const db = getProjectDb(p.path);
          pendingSuggestions = safeCount(
            db,
            "SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending'",
          );
          recentEvents24h = safeCount(
            db,
            'SELECT COUNT(*) as cnt FROM events WHERE ts > ?',
            [cutoff24h],
          );
        } catch { /* db may not exist */ }

        projects.push({
          name: p.name,
          domain: p.domain,
          files: p.fileCount,
          folders: p.folderCount,
          pendingSuggestions,
          tempFiles: tempFileCount(p.path),
          recentEvents24h,
        });
      }

      return textResult(JSON.stringify({
        totalProjects: registry.length,
        totalFiles,
        totalFolders,
        projects,
      }, null, 2));
    },
  });

  // --- 3. proactive_check --------------------------------------------------

  const proactiveCheckTool = defineTool({
    name: 'proactive_check',
    label: 'Proactive Project Health Check',
    description:
      'Proactively scan all IPM projects for issues that need attention: temp-folder backlog, pending or stale AI suggestions, and recent activity summary. Returns a JSON report or a clean-bill-of-health message.',
    promptSnippet:
      'proactive_check: scan IPM projects for issues (temp backlog, stale AI suggestions, recent activity).',
    promptGuidelines: [usageGuideline],
    parameters: Type.Object({}),
    async execute() {
      const { projectsRoot, casesRoot, studyRoot } = getWorkspaceDirs();
      const registry = buildProjectRegistry({
        projectsRoot, casesRoot, studyRoot, readState,
      });

      const issues = [];
      const recentActivity = [];
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      for (const p of registry) {
        const tempCnt = tempFileCount(p.path);
        if (tempCnt > 0) {
          issues.push({
            project: p.name,
            domain: p.domain,
            type: 'temp_backlog',
            severity: tempCnt > 10 ? 'high' : tempCnt > 3 ? 'medium' : 'low',
            message: `${p.name} 的 temp/ 目录有 ${tempCnt} 个待分类文件`,
          });
        }

        try {
          const db = getProjectDb(p.path);

          const pendingCnt = safeCount(
            db,
            "SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending'",
          );
          if (pendingCnt > 0) {
            issues.push({
              project: p.name,
              domain: p.domain,
              type: 'pending_suggestions',
              severity: pendingCnt > 10 ? 'high' : pendingCnt > 3 ? 'medium' : 'low',
              message: `${p.name} 有 ${pendingCnt} 条 AI 分类建议待处理`,
            });
          }

          const stalePendingCnt = safeCount(
            db,
            "SELECT COUNT(*) as cnt FROM suggestions WHERE status = 'pending' AND created_at < ?",
            [threeDaysAgo],
          );
          if (stalePendingCnt > 0) {
            issues.push({
              project: p.name,
              domain: p.domain,
              type: 'stale_suggestions',
              severity: 'medium',
              message: `${p.name} 有 ${stalePendingCnt} 条超过 3 天未处理的建议`,
            });
          }

          const classifyEvents24h = safeCount(
            db,
            'SELECT COUNT(*) as cnt FROM events WHERE ts > ?',
            [oneDayAgo],
          );
          const activityLogs24h = safeCount(
            db,
            'SELECT COUNT(*) as cnt FROM activity_log WHERE ts > ?',
            [oneDayAgo],
          );
          if (classifyEvents24h > 0 || activityLogs24h > 0) {
            recentActivity.push({
              project: p.name,
              domain: p.domain,
              classifyEvents24h,
              activityLogs24h,
            });
          }
        } catch { /* db may not exist */ }
      }

      if (!issues.length && !recentActivity.length) {
        return textResult('所有项目状况良好，没有需要关注的事项。');
      }
      return textResult(JSON.stringify({ issues, recentActivity }, null, 2));
    },
  });

  // --- 4. get_recent_events ------------------------------------------------

  const getRecentEventsTool = defineTool({
    name: 'get_recent_events',
    label: 'Get Recent Project Events',
    description:
      'Get recent classification events and activity logs for a specific IPM project or case. Use to answer "what happened in project X recently".',
    promptSnippet:
      'get_recent_events: classification + activity events for one IPM project.',
    promptGuidelines: [usageGuideline],
    parameters: Type.Object({
      ...projectDomainParams,
      count: Type.Optional(Type.Number({
        minimum: 1,
        maximum: 50,
        default: 20,
        description: 'Maximum number of events to return (1–50, default 20).',
      })),
    }),
    async execute(_toolCallId, params) {
      const { projectName, domain, count } = params || {};
      const limit = Math.min(50, Math.max(1, Number(count) || 20));

      let projectDir;
      try {
        projectDir = getWorkspaceDirOrThrow(projectName, domain).projectDir;
      } catch (err) {
        return textResult(`无法解析项目目录: ${err?.message || err}`);
      }

      let db;
      try {
        db = getProjectDb(projectDir);
      } catch (err) {
        return textResult(`无法打开项目数据库: ${err?.message || err}`);
      }

      const combined = [];
      try {
        const ce = listEvents(db, { limit });
        for (const e of ce.events || []) {
          combined.push({
            type: 'classify',
            time: e.ts,
            event: e.event,
            fileName: e.fileName,
            suggestedFolder: e.suggestedFolder,
          });
        }
      } catch { /* ignore */ }
      try {
        const logs = listLogs(db, { limit: Math.min(limit, 20) });
        for (const l of logs || []) {
          combined.push({ type: 'activity', time: l.ts, event: l.event });
        }
      } catch { /* ignore */ }

      combined.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      const events = combined.slice(0, limit);
      if (!events.length) {
        return textResult(`"${projectName}" 没有近期事件。`);
      }
      return textResult(JSON.stringify({ project: projectName, events }, null, 2));
    },
  });

  // --- 5. query_history ----------------------------------------------------

  const queryHistoryTool = defineTool({
    name: 'query_history',
    label: 'Query Classification History',
    description:
      'Query past file-classification events for a specific IPM project, optionally filtered by user decision (accepted / rejected) and a keyword over file name or suggested folder.',
    promptSnippet:
      'query_history: filter past classification events for one IPM project by decision and keyword.',
    promptGuidelines: [usageGuideline],
    parameters: Type.Object({
      ...projectDomainParams,
      status: Type.Optional(Type.Union(
        [Type.Literal('accepted'), Type.Literal('rejected'), Type.Literal('')],
        { default: '', description: "Filter by user decision: 'accepted', 'rejected', or empty for both." },
      )),
      keyword: Type.Optional(Type.String({
        default: '',
        description: 'Keyword to match against file name or suggested folder (case-insensitive).',
      })),
    }),
    async execute(_toolCallId, params) {
      const { projectName, domain, status, keyword } = params || {};

      let projectDir;
      try {
        projectDir = getWorkspaceDirOrThrow(projectName, domain).projectDir;
      } catch (err) {
        return textResult(`无法解析项目目录: ${err?.message || err}`);
      }

      let db;
      try {
        db = getProjectDb(projectDir);
      } catch (err) {
        return textResult(`无法打开项目数据库: ${err?.message || err}`);
      }

      const conditions = [];
      const sqlParams = {};
      if (status) {
        const eventType =
          status === 'accepted' ? 'classify.accepted'
          : status === 'rejected' ? 'classify.rejected'
          : '';
        if (eventType) {
          conditions.push('event = @eventType');
          sqlParams.eventType = eventType;
        }
      }
      if (keyword) {
        conditions.push('(file_name LIKE @kw COLLATE NOCASE OR suggested_folder LIKE @kw COLLATE NOCASE)');
        sqlParams.kw = `%${keyword}%`;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      let rows;
      try {
        rows = db.prepare(`SELECT * FROM events ${where} ORDER BY ts DESC LIMIT 30`).all(sqlParams);
      } catch (err) {
        return textResult(`查询失败: ${err?.message || err}`);
      }

      if (!rows?.length) {
        return textResult(`"${projectName}" 没有匹配的分类历史。`);
      }
      const history = rows.map((r) => ({
        fileName: r.file_name,
        event: r.event,
        suggestedFolder: r.suggested_folder,
        userFeedback: r.user_feedback || undefined,
        time: r.ts,
      }));
      return textResult(JSON.stringify({ project: projectName, history }, null, 2));
    },
  });

  return [
    listProjectsTool,
    crossProjectStatsTool,
    proactiveCheckTool,
    getRecentEventsTool,
    queryHistoryTool,
  ];
}

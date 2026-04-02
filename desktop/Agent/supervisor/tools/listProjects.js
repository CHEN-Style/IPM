import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { buildProjectRegistry } from '../projectRegistry.js';

export function createListProjectsTool(deps) {
  const { getWorkspaceDirs, readState } = deps;

  return tool(
    async () => {
      const { projectsRoot, casesRoot, studyRoot } = getWorkspaceDirs();
      const registry = buildProjectRegistry({ projectsRoot, casesRoot, studyRoot, readState });

      if (!registry.length) return '当前没有任何项目/案件/学习空间。';

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

      return lines.join('\n');
    },
    {
      name: 'list_projects',
      description: 'List all projects, cases, and study workspaces with their status, folder count, file count, and summary snippets.',
      schema: z.object({}),
    },
  );
}

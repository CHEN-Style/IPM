import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readProjectSummary } from '../project-agent/memory.js';

export function createReadOwnMemoryTool(projectDir) {
  return tool(
    async () => {
      const summary = readProjectSummary(projectDir);
      if (!summary) return 'No project summary exists yet. This appears to be the first interaction with this project.';
      return summary;
    },
    {
      name: 'read_own_memory',
      description: 'Read your own project knowledge summary (project-summary.md). Contains your understanding of this project gathered from past sessions.',
      schema: z.object({}),
    },
  );
}

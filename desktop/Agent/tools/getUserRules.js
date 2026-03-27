import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readClassifyRules } from '../storage/classifyRules.js';

export function createGetUserRulesTool(projectDir) {
  return tool(
    async () => {
      if (!projectDir) return JSON.stringify([], null, 2);
      let rules;
      try {
        rules = readClassifyRules(projectDir);
      } catch {
        return JSON.stringify([], null, 2);
      }
      const enabled = rules
        .filter((r) => r.enabled !== false)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .map((r) => ({
          label: r.label || '',
          targetFolder: r.targetFolder || '',
          conditions: r.conditions || {},
          confidence: r.confidence,
          source: r.source || 'user_defined',
        }));
      return JSON.stringify(enabled, null, 2);
    },
    {
      name: 'get_user_rules',
      description:
        'Get user-defined classification rules for this project. Each rule has conditions (nameIncludes, nameExcludes, exts, sourceIncludes, sourceExcludes) and a target folder. Use this to understand explicit user preferences before making a classification decision.',
      schema: z.object({}),
    },
  );
}

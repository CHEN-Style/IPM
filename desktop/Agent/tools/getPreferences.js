import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { matchPreferences } from '../storage/preferences.js';

export function createGetPreferencesTool(projectDir) {
  return tool(
    async ({ fileName, ext, sourceDir }) => {
      if (!projectDir) return JSON.stringify([], null, 2);
      let matched;
      try {
        matched = matchPreferences(projectDir, { fileName, ext, sourceDir });
      } catch {
        return JSON.stringify([], null, 2);
      }
      const result = matched.map((p) => ({
        pattern: p.pattern || '',
        folder: p.tendency?.folder || '',
        strength: p.tendency?.strength ?? 0,
        source: p.source || 'user_defined',
      }));
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'get_preferences',
      description:
        'Get soft preferences (learned tendencies) that match the current file. Each preference has a natural-language pattern description, a suggested folder, and a strength (0-1). These are NOT hard rules — they indicate tendencies that should influence but not override your judgment. Higher strength means stronger tendency.',
      schema: z.object({
        fileName: z.string().describe('The file name to match preferences against'),
        ext: z.string().describe('The file extension (without dot)'),
        sourceDir: z.string().optional().describe('The original source directory path'),
      }),
    },
  );
}

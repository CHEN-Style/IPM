import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getProjectDb } from '../db/index.js';
import { getSourceInfo } from '../db/sourceRecords.js';

export function createGetSourceInfoTool(projectDir) {
  return tool(
    async ({ sourceRelPath }) => {
      const normalized = String(sourceRelPath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\/{2,}/g, '/');
      if (!normalized) return 'sourceRelPath is empty.';

      const db = getProjectDb(projectDir);
      const info = getSourceInfo(db, normalized);

      if (!info) {
        return `No source info found for "${normalized}". The file may have been added without tracking its origin.`;
      }

      return JSON.stringify(
        {
          sourceRelPath: normalized,
          sourcePath: info.sourcePath || '',
          sourceDir: info.sourceDir || '',
        },
        null,
        2,
      );
    },
    {
      name: 'get_source_info',
      description:
        'Get the original source path (where the file was dragged/uploaded from) for a file in temp/. Use this to understand where the file came from, which may hint at its category.',
      schema: z.object({
        sourceRelPath: z
          .string()
          .min(1)
          .describe('Relative path of the file in temp/ (e.g. "temp/contract.pdf").'),
      }),
    },
  );
}

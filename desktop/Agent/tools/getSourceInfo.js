import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function normalizeRelPathPosix(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
}

export function createGetSourceInfoTool(projectDir) {
  return tool(
    async ({ sourceRelPath }) => {
      const normalized = normalizeRelPathPosix(sourceRelPath);
      if (!normalized) return 'sourceRelPath is empty.';

      const recordPath = path.join(projectDir, 'meta', 'temp-source-record.json');
      const doc = safeReadJson(recordPath, null);
      const items =
        doc && typeof doc === 'object' && Array.isArray(doc.items) ? doc.items : [];
      const hit = items.find(
        (x) => normalizeRelPathPosix(x?.sourceRelPath || '') === normalized,
      );

      if (!hit || typeof hit !== 'object') {
        return `No source info found for "${normalized}". The file may have been added without tracking its origin.`;
      }

      const info = {
        sourceRelPath: normalized,
        sourcePath: typeof hit.sourcePath === 'string' ? hit.sourcePath : '',
        sourceDir: typeof hit.sourceDir === 'string' ? hit.sourceDir : '',
      };
      return JSON.stringify(info, null, 2);
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

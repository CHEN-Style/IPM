import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { classifyFile } from '../index.js';
import { upsertAiSuggestion } from '../storage/aiStorage.js';

function buildFolderCandidates(projectDir) {
  const structurePath = path.join(projectDir, 'meta', 'structure.json');
  let doc;
  try { doc = JSON.parse(fs.readFileSync(structurePath, 'utf-8')); } catch { return []; }
  const folders = doc?.folders && typeof doc.folders === 'object' ? doc.folders : {};
  return Object.values(folders)
    .filter((f) => f?.relPath && f?.name && !f.system && f.relPath !== '')
    .sort((a, b) => (a.relPath || '').length - (b.relPath || '').length)
    .map(({ relPath, name, description }) => ({ relPath, name, description: description || '' }));
}

export function createClassifyBatchTool(projectDir, projectName) {
  return tool(
    async ({ files }) => {
      const folders = buildFolderCandidates(projectDir);
      if (!folders.length) return JSON.stringify({ error: 'No candidate folders in structure.json.' });

      const results = [];

      for (const sourceRelPath of files) {
        const fileName = path.basename(sourceRelPath);
        const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();

        try {
          const decision = await classifyFile({
            projectName,
            projectDir,
            sourceRelPath,
            fileName,
            ext,
            sourceDir: '',
            folders,
          });

          upsertAiSuggestion(projectDir, projectName, {
            sourceRelPath,
            fileName,
            ext,
            suggestedFolderRelPath: decision.targetRelPath,
            status: 'pending',
            rationale: decision.rationale || '',
            confidence: decision.confidence ?? 0,
            classifiedBy: decision.classifiedBy || 'agent',
            agentMeta: decision.agentMeta || {},
            trace: decision.trace || [],
          });

          results.push({
            fileName,
            suggestedFolder: decision.targetRelPath,
            confidence: decision.confidence,
            success: true,
          });
        } catch (e) {
          results.push({ fileName, success: false, error: e.message });
        }
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return JSON.stringify({ total: files.length, succeeded, failed, results }, null, 2);
    },
    {
      name: 'classify_batch',
      description: 'Classify multiple files in batch using the AI classification subsystem. Each file is classified sequentially and saved as a pending suggestion.',
      schema: z.object({
        files: z.array(z.string()).min(1).describe('Array of relative file paths to classify (e.g. ["temp/a.pdf", "temp/b.docx"])'),
      }),
    },
  );
}

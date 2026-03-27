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

export function createClassifyFileTool(projectDir, projectName) {
  return tool(
    async ({ sourceRelPath }) => {
      const fileName = path.basename(sourceRelPath);
      const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();
      const folders = buildFolderCandidates(projectDir);

      if (!folders.length) return JSON.stringify({ error: 'No candidate folders in structure.json.' });

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

        return JSON.stringify({
          success: true,
          fileName,
          suggestedFolder: decision.targetRelPath,
          confidence: decision.confidence,
          rationale: decision.rationale,
        });
      } catch (e) {
        return JSON.stringify({ error: `Classification failed: ${e.message}` });
      }
    },
    {
      name: 'classify_file',
      description: 'Delegate file classification to the AI classification subsystem. Classifies a single file and saves the result as a pending suggestion.',
      schema: z.object({
        sourceRelPath: z.string().min(1).describe('Relative path of the file to classify (e.g. "temp/contract.pdf")'),
      }),
    },
  );
}

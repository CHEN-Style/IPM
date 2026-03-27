import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { addRule } from '../storage/classifyRules.js';

export function createAddClassifyRuleTool(projectDir) {
  return tool(
    async ({ targetFolder, label, nameIncludes, nameExcludes, exts, sourceIncludes, sourceExcludes, confidence }) => {
      if (!targetFolder) return JSON.stringify({ error: '缺少 targetFolder（目标文件夹）' });

      const hasCondition = (nameIncludes?.length || nameExcludes?.length || exts?.length || sourceIncludes?.length || sourceExcludes?.length);
      if (!hasCondition) {
        return JSON.stringify({ error: '至少需要一个条件（nameIncludes / exts / sourceIncludes 等），否则规则无法匹配任何文件' });
      }

      try {
        const rule = addRule(projectDir, {
          targetFolder,
          label: label || '',
          conditions: {
            nameIncludes: nameIncludes || [],
            nameExcludes: nameExcludes || [],
            exts: exts || [],
            sourceIncludes: sourceIncludes || [],
            sourceExcludes: sourceExcludes || [],
          },
          confidence: typeof confidence === 'number' ? confidence : 0.95,
          source: 'agent',
        });

        return JSON.stringify({
          message: `已添加硬规则「${label || rule.id}」→ ${targetFolder}`,
          rule: {
            id: rule.id,
            label: rule.label,
            targetFolder: rule.targetFolder,
            conditions: rule.conditions,
            confidence: rule.confidence,
          },
        });
      } catch (e) {
        return JSON.stringify({ error: `添加规则失败: ${e.message}` });
      }
    },
    {
      name: 'add_classify_rule',
      description: `Add a hard classification rule. Rules automatically classify files matching conditions to a target folder with high confidence.
Before calling, make sure you have enough info: targetFolder + at least one condition.
If user's description is vague, ASK them to clarify:
- Which folder should matching files go to?
- What file name keywords, extensions, or source paths identify these files?`,
      schema: z.object({
        targetFolder: z.string().min(1).describe('Relative path of the target folder'),
        label: z.string().optional().default('').describe('Human-readable description of the rule'),
        nameIncludes: z.array(z.string()).optional().default([]).describe('File name must contain any of these keywords (case-insensitive)'),
        nameExcludes: z.array(z.string()).optional().default([]).describe('File name must NOT contain these keywords'),
        exts: z.array(z.string()).optional().default([]).describe('File extensions to match (without dot, e.g. "pdf", "docx")'),
        sourceIncludes: z.array(z.string()).optional().default([]).describe('Original source path must contain any of these keywords'),
        sourceExcludes: z.array(z.string()).optional().default([]).describe('Original source path must NOT contain these keywords'),
        confidence: z.number().optional().default(0.95).describe('Confidence level 0-1, default 0.95'),
      }),
    },
  );
}

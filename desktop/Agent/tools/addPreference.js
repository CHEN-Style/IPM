import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { addPreference } from '../storage/preferences.js';

export function createAddPreferenceTool(projectDir) {
  return tool(
    async ({ pattern, folder, strength, nameIncludes, nameExcludes, exts, sourceIncludes, sourceExcludes }) => {
      if (!folder) return JSON.stringify({ error: '缺少 folder（倾向文件夹）' });
      if (!pattern) return JSON.stringify({ error: '缺少 pattern（自然语言描述）' });

      const hasCondition = (nameIncludes?.length || nameExcludes?.length || exts?.length || sourceIncludes?.length || sourceExcludes?.length);
      if (!hasCondition) {
        return JSON.stringify({ error: '至少需要一个条件（nameIncludes / exts / sourceIncludes 等），否则偏好无法匹配任何文件' });
      }

      try {
        const pref = addPreference(projectDir, {
          pattern,
          conditions: {
            nameIncludes: nameIncludes || [],
            nameExcludes: nameExcludes || [],
            exts: exts || [],
            sourceIncludes: sourceIncludes || [],
            sourceExcludes: sourceExcludes || [],
          },
          tendency: {
            folder,
            strength: typeof strength === 'number' ? strength : 0.7,
          },
          source: 'agent',
        });

        return JSON.stringify({
          message: `已添加软偏好「${pattern}」→ ${folder}（强度 ${pref.tendency.strength}）`,
          preference: {
            id: pref.id,
            pattern: pref.pattern,
            folder: pref.tendency.folder,
            strength: pref.tendency.strength,
            conditions: pref.conditions,
          },
        });
      } catch (e) {
        return JSON.stringify({ error: `添加偏好失败: ${e.message}` });
      }
    },
    {
      name: 'add_preference',
      description: `Add a soft preference (learned tendency). Unlike hard rules, preferences influence but don't override classification — they represent "this type of file TENDS to go here".
Before calling, make sure you have:
- A natural-language pattern description (e.g. "没有编号的合同文件倾向于交付文档")
- A target folder
- At least one matching condition
If user is unclear, guide them:
- What kind of files does this apply to?
- Which folder should they lean towards?
- How strong is this tendency? (0.5 = weak suggestion, 0.7 = moderate, 0.9 = strong)`,
      schema: z.object({
        pattern: z.string().min(1).describe('Natural language description of the preference pattern'),
        folder: z.string().min(1).describe('Relative path of the preferred target folder'),
        strength: z.number().optional().default(0.7).describe('Tendency strength 0-1 (0.5=weak, 0.7=moderate, 0.9=strong)'),
        nameIncludes: z.array(z.string()).optional().default([]).describe('File name keywords to match'),
        nameExcludes: z.array(z.string()).optional().default([]).describe('File name keywords to exclude'),
        exts: z.array(z.string()).optional().default([]).describe('File extensions to match (without dot)'),
        sourceIncludes: z.array(z.string()).optional().default([]).describe('Source path keywords to match'),
        sourceExcludes: z.array(z.string()).optional().default([]).describe('Source path keywords to exclude'),
      }),
    },
  );
}

import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  readReference,
} from '../skills/skillStore.js';
import { executeSkillFlow } from '../skills/skillExecutor.js';

export function createSkillManagementTools(deps) {
  const { getSandboxRoot, getAppRoot, getWorkspaceDirs, getAutonomousMode } = deps;

  const listSkillsTool = tool(
    async () => {
      try {
        const skills = listSkills(getSandboxRoot());
        if (!skills.length) return '当前没有已安装的 Skill。';

        return skills.map((s) => {
          const status = s.maturity === 'stable' ? '✅ 成熟' : '🔧 草稿';
          const perms = s.permissions.length ? `[${s.permissions.join(', ')}]` : '无特殊权限';
          return `- **${s.name}** (${status}) — ${s.description}\n  权限: ${perms}`;
        }).join('\n');
      } catch (e) {
        return `列出 Skill 失败: ${e.message}`;
      }
    },
    {
      name: 'list_skills',
      description: 'List all available Skills with their name, description, maturity status, and permissions.',
      schema: z.object({}),
    },
  );

  const getSkillDetailTool = tool(
    async ({ skillName }) => {
      try {
        const skill = getSkill(getSandboxRoot(), skillName);
        const parts = [];
        parts.push(`# ${skill.meta.name}`);
        parts.push(`描述: ${skill.meta.description}`);
        parts.push(`版本: ${skill.meta.version}`);
        parts.push(`状态: ${skill.meta.maturity}`);
        parts.push(`权限: ${skill.meta.permissions.join(', ') || '无'}`);

        if (skill.meta.inputs?.length) {
          parts.push('\n## 输入参数');
          for (const inp of skill.meta.inputs) {
            parts.push(`- ${inp.name} (${inp.type || 'string'}): ${inp.description || ''}`);
          }
        }

        if (skill.scripts.length) {
          parts.push(`\n## 脚本文件\n${skill.scripts.map((s) => `- scripts/${s}`).join('\n')}`);
        }
        if (skill.references.length) {
          parts.push(`\n## 参考资料\n${skill.references.map((r) => `- references/${r}`).join('\n')}`);
        }

        parts.push('\n## 指令\n' + skill.instructions);
        return parts.join('\n');
      } catch (e) {
        return `获取 Skill 详情失败: ${e.message}`;
      }
    },
    {
      name: 'get_skill_detail',
      description: 'Get the full definition of a Skill, including its instructions, scripts, and references.',
      schema: z.object({
        skillName: z.string().min(1).describe('Name of the Skill to retrieve'),
      }),
    },
  );

  const createSkillTool = tool(
    async ({ name, description, permissions, instructions, maturity }) => {
      try {
        const result = createSkill(getSandboxRoot(), {
          name,
          description,
          permissions: permissions || [],
          maturity: maturity || 'draft',
          instructions: instructions || '',
        });
        return `Skill "${result.meta.name}" 创建成功 (${result.dirName})。状态: ${result.meta.maturity}`;
      } catch (e) {
        return `创建 Skill 失败: ${e.message}`;
      }
    },
    {
      name: 'create_skill',
      description: 'Create a new Skill from a name, description, instructions, and permission declarations. The Skill starts in draft mode by default.',
      schema: z.object({
        name: z.string().min(1).describe('Skill name (used as directory name)'),
        description: z.string().describe('Short description of what the Skill does'),
        permissions: z.array(z.string()).optional().describe('Required permissions: read_file_content, write_file_content, run_script, fetch_web'),
        instructions: z.string().describe('Full instructions (markdown) for the Skill — the AI prompt that defines behavior'),
        maturity: z.enum(['draft', 'stable']).optional().default('draft').describe('Initial maturity state'),
      }),
    },
  );

  const updateSkillTool = tool(
    async ({ skillName, description, instructions, permissions, maturity }) => {
      try {
        const patch = {};
        if (description !== undefined) patch.description = description;
        if (instructions !== undefined) patch.instructions = instructions;
        if (permissions !== undefined) patch.permissions = permissions;
        if (maturity !== undefined) patch.maturity = maturity;

        const result = updateSkill(getSandboxRoot(), skillName, patch);
        return `Skill "${result.meta.name}" 更新成功。`;
      } catch (e) {
        return `更新 Skill 失败: ${e.message}`;
      }
    },
    {
      name: 'update_skill',
      description: 'Update an existing Skill\'s definition — description, instructions, permissions, or maturity state.',
      schema: z.object({
        skillName: z.string().min(1).describe('Name of the Skill to update'),
        description: z.string().optional().describe('New description'),
        instructions: z.string().optional().describe('New instructions'),
        permissions: z.array(z.string()).optional().describe('New permission list'),
        maturity: z.enum(['draft', 'stable']).optional().describe('New maturity state'),
      }),
    },
  );

  const saveSkillScriptTool = tool(
    async ({ skillName, fileName, code }) => {
      try {
        const skill = getSkill(getSandboxRoot(), skillName);
        const scriptsDir = path.join(skill.dir, 'scripts');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.writeFileSync(path.join(scriptsDir, fileName), code, 'utf-8');
        return `脚本 "${fileName}" 已保存到 Skill "${skillName}" 的 scripts/ 目录。`;
      } catch (e) {
        return `保存脚本失败: ${e.message}`;
      }
    },
    {
      name: 'save_skill_script',
      description: 'Save a script file into a Skill\'s scripts/ directory. Used when teaching a Skill that includes executable scripts.',
      schema: z.object({
        skillName: z.string().min(1).describe('Name of the Skill'),
        fileName: z.string().min(1).describe('Script file name (e.g. "extract.py")'),
        code: z.string().describe('Script source code'),
      }),
    },
  );

  const executeSkillTool = tool(
    async ({ skillName, task, inputs }) => {
      try {
        const result = await executeSkillFlow({
          skillName,
          task: task || '',
          inputs: inputs || {},
          sandboxRoot: getSandboxRoot(),
          appRoot: getAppRoot(),
          getWorkspaceDirs,
          getAutonomousMode,
        });
        return result;
      } catch (e) {
        return `Skill 执行失败: ${e.message}`;
      }
    },
    {
      name: 'execute_skill',
      description: 'Execute a Skill by name. The "task" field is CRITICAL — you MUST include ALL context the Skill needs: file paths, user intent, search results, etc. The sub-agent has NO access to your conversation history.',
      schema: z.object({
        skillName: z.string().min(1).describe('Name of the Skill to execute'),
        task: z.string().min(1).describe('Complete task description in natural language. MUST include all relevant context: file paths, user requirements, any information gathered from previous tool calls. The Skill sub-agent cannot see your conversation — this is its ONLY source of context.'),
        inputs: z.record(z.string(), z.any()).optional().describe('Optional structured input parameters as key-value pairs (e.g. {"filePath": "/path/to/file"})'),
      }),
    },
  );

  return [
    listSkillsTool,
    getSkillDetailTool,
    createSkillTool,
    updateSkillTool,
    saveSkillScriptTool,
    executeSkillTool,
  ];
}

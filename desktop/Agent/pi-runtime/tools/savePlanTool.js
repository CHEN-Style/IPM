// desktop/Agent/pi-runtime/tools/savePlanTool.js
//
// E.5: `save_plan` customTool.
//
// Plan-mode-friendly file writer. Saves the agreed-upon plan as a
// Markdown file under `<cwd>/.knowclaw/plans/`, bypassing the
// beforeToolCall write block (which only covers the generic `write` /
// `edit` / `bash` tools). The plan directory is auto-created.
//
// Why a dedicated tool instead of letting the model use `write` after
// switching back to Agent mode?
//   1. It captures user-approved plans **at the moment of approval**,
//      so the artefact survives mode switches and session reloads.
//   2. The fixed `.knowclaw/plans/` path means we know where to look
//      when the user later asks "按上次的计划继续".
//   3. The Plan-mode prompt can reference it by name as the "save your
//      plan" step, making the workflow legible.
//
// Design constraints (same as projectTools/webTools):
//   1. ESM. Loaded directly by Node.
//   2. execute() returns AgentToolResult shape.
//   3. Only fs / path are imported — no Electron / supervisor deps.

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import fs from 'node:fs/promises';
import path from 'node:path';

const PLAN_SUBDIR = '.knowclaw/plans';
const MAX_PLAN_BYTES = 1_000_000; // 1 MB — way more than any reasonable plan
const SAFE_FILENAME = /^[\w\u4e00-\u9fff][\w\u4e00-\u9fff.\- ]{0,128}$/;

function textResult(text, details = null) {
  return {
    content: [{ type: 'text', text: String(text ?? '') }],
    details,
  };
}

function defaultPlanFilename() {
  // ISO-ish stamp avoiding chars that confuse Windows filesystems
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `plan-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`;
}

function sanitizeFilename(raw) {
  let name = String(raw || '').trim();
  if (!name) return defaultPlanFilename();
  // Strip directory components so the model can't escape the plans dir
  // via "../../etc/passwd" or absolute paths
  name = name.replace(/[\\/]/g, '_');
  // Ensure .md extension
  if (!/\.md$/i.test(name)) name = name + '.md';
  if (!SAFE_FILENAME.test(name)) {
    // Fallback to default if the model picked something weird
    return defaultPlanFilename();
  }
  return name;
}

/**
 * @param {object} opts
 * @param {string} opts.cwd  Session working directory. Plans land under
 *                           `<cwd>/.knowclaw/plans/`.
 * @returns {Array<object>}
 */
export function buildSavePlanTool({ cwd } = {}) {
  const baseDir = typeof cwd === 'string' && cwd ? cwd : process.cwd();

  const tool = defineTool({
    name: 'save_plan',
    label: '保存规划方案',
    description:
      '在 Plan 模式下，将与用户达成一致的实施方案写入工作空间的 .knowclaw/plans/ 目录。' +
      '方案应是完整的 Markdown 文档，包含：目标、影响文件清单、具体改动点、验证要点。' +
      '保存成功后，用户可以点击「开始执行」按钮切换到 Agent 模式按方案执行。',
    promptSnippet:
      'save_plan: 在 .knowclaw/plans/ 下写入用户已确认的方案 Markdown，绕过 Plan 模式的写入拦截。',
    parameters: Type.Object({
      content: Type.String({
        minLength: 16,
        description: '方案的完整 Markdown 内容。',
      }),
      filename: Type.Optional(Type.String({
        description: '文件名（不含路径）。可选；默认 plan-YYYYMMDD-HHmm.md。如无 .md 后缀会自动补齐。',
      })),
    }),
    async execute(_toolCallId, params) {
      const content = String(params?.content || '');
      if (!content.trim()) {
        return textResult('错误: save_plan 必须提供非空的 content。');
      }
      const byteLen = Buffer.byteLength(content, 'utf8');
      if (byteLen > MAX_PLAN_BYTES) {
        return textResult(`错误: 方案内容过大 (${byteLen} 字节，上限 ${MAX_PLAN_BYTES})。请拆分为多份方案或精简。`);
      }

      const filename = sanitizeFilename(params?.filename);
      const planDir = path.join(baseDir, PLAN_SUBDIR);
      const filepath = path.join(planDir, filename);

      try {
        await fs.mkdir(planDir, { recursive: true });
        await fs.writeFile(filepath, content, 'utf8');
      } catch (err) {
        return textResult(`save_plan 失败: ${String(err?.message || err)}`);
      }

      return textResult(
        `方案已保存到 ${filepath}\n\n提示用户：方案已就绪，点击对话下方「开始执行」按钮切换到 Agent 模式按方案执行。`,
        { filepath, bytes: byteLen, filename },
      );
    },
  });

  return [tool];
}

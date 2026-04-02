import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  executeScript,
  writeTempScript,
  validateScriptPath,
  scanForDangerousCommands,
} from '../skills/scriptExecutor.js';

export function createRunScriptTool(deps) {
  const { getSandboxRoot } = deps;

  return tool(
    async ({ code, scriptPath, args, timeout }) => {
      const sandboxRoot = getSandboxRoot();
      let resolvedPath;

      try {
        if (code) {
          const warnings = scanForDangerousCommands(code);
          if (warnings.length) {
            return `⚠ 脚本安全检查未通过:\n${warnings.join('\n')}\n\n请修改脚本后重试。`;
          }
          resolvedPath = writeTempScript(sandboxRoot, code);
        } else if (scriptPath) {
          resolvedPath = validateScriptPath(scriptPath, sandboxRoot);
        } else {
          return '错误: 必须提供 code（内联代码）或 scriptPath（脚本路径）';
        }

        const result = await executeScript({
          scriptPath: resolvedPath,
          args: args || [],
          sandboxRoot,
          timeout,
        });

        const parts = [];
        parts.push(`退出码: ${result.exitCode ?? 'N/A'}`);
        parts.push(`耗时: ${result.durationMs}ms`);
        if (result.killed) parts.push('⚠ 脚本因超时被终止');
        if (result.truncated) parts.push('⚠ 输出已截断（超过 1MB 限制）');
        if (result.stdout) parts.push(`\n--- stdout ---\n${result.stdout}`);
        if (result.stderr) parts.push(`\n--- stderr ---\n${result.stderr}`);
        return parts.join('\n');
      } catch (e) {
        return `脚本执行错误: ${e.message}`;
      }
    },
    {
      name: 'run_script',
      description: 'Execute a Python script. Provide inline code (which is saved to a temp file) or a script path within the sandbox. Scripts run in a sandboxed workspace with timeout protection.',
      schema: z.object({
        code: z.string().optional().describe('Inline Python code to execute (mutually exclusive with scriptPath)'),
        scriptPath: z.string().optional().describe('Absolute path to an existing script file within the sandbox'),
        args: z.array(z.string()).optional().default([]).describe('Command-line arguments to pass to the script'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default 60000, max 300000)'),
      }),
    },
  );
}

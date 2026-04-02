import { randomUUID } from 'node:crypto';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { tool as langTool } from '@langchain/core/tools';
import { createChatModel } from '../../services/llm.js';
import { getSkill, readReference } from './skillStore.js';
import { getSupervisorDb, addSkillExecution, updateSkillExecution } from '../../db/supervisorDb.js';
import { createReadFileContentTool, createWriteFileContentTool } from '../tools/fileTools.js';
import { createRunScriptTool } from '../tools/scriptTool.js';
import { createFetchWebTool } from '../tools/webTool.js';

const log = (msg) => console.log(`[IPM][SkillExecutor] ${msg}`);

const PERMISSION_TOOL_MAP = {
  read_file_content: createReadFileContentTool,
  write_file_content: createWriteFileContentTool,
  run_script: createRunScriptTool,
  fetch_web: createFetchWebTool,
};

const MAX_SKILL_RECURSION = 30;

/**
 * Build the system prompt for a Skill sub-agent.
 * Injects the Skill's instructions, references, and input parameters.
 */
function buildSkillPrompt(skill, inputs) {
  const parts = [];

  parts.push(`你正在执行 Skill「${skill.meta.name}」。`);
  parts.push(`描述: ${skill.meta.description}`);
  parts.push('');
  parts.push('## 指令');
  parts.push(skill.instructions);

  if (skill.references.length) {
    parts.push('');
    parts.push('## 参考资料');
    for (const refName of skill.references) {
      try {
        const content = readReference(skill._sandboxRoot, skill.meta.name, refName);
        parts.push(`### ${refName}`);
        parts.push(content);
      } catch {
        parts.push(`### ${refName}\n(无法读取)`);
      }
    }
  }

  if (inputs && Object.keys(inputs).length) {
    parts.push('');
    parts.push('## 输入参数');
    for (const [key, val] of Object.entries(inputs)) {
      parts.push(`- **${key}**: ${typeof val === 'string' ? val : JSON.stringify(val)}`);
    }
  }

  parts.push('');
  parts.push('## 规则');
  parts.push('- 始终使用中文回复');
  parts.push('- 按照指令中的步骤逐步执行');
  parts.push('- 遇到错误时说明原因并尝试修复');
  parts.push('- 执行完成后提供清晰的结果摘要');

  return parts.join('\n');
}

/**
 * Assemble tools based on the Skill's declared permissions.
 */
function assembleTools(permissions, deps) {
  const tools = [];
  for (const perm of permissions) {
    const factory = PERMISSION_TOOL_MAP[perm];
    if (!factory) continue;
    tools.push(factory(deps));
  }
  return tools;
}

/**
 * Execute a Skill as a temporary sub-agent.
 *
 * - stable: runs the agent to completion and returns results
 * - draft: runs a "dry-run" where write tools log intended actions,
 *          then returns a preview; re-invoke with confirmed=true to execute
 */
export async function executeSkillFlow({
  skillName,
  task = '',
  inputs = {},
  sandboxRoot,
  appRoot,
  getWorkspaceDirs,
  getAutonomousMode,
  confirmed = false,
}) {
  const executionId = randomUUID();
  const db = getSupervisorDb(appRoot);

  let skill;
  try {
    skill = getSkill(sandboxRoot, skillName);
    skill._sandboxRoot = sandboxRoot;
  } catch (e) {
    return `Skill "${skillName}" 未找到: ${e.message}`;
  }

  const isDraft = skill.meta.maturity === 'draft' && !confirmed;

  addSkillExecution(db, { id: executionId, skillName, inputJson: { task, ...inputs } });
  log(`Execution ${executionId} started for "${skillName}" (${isDraft ? 'draft-preview' : 'execute'})`);

  const deps = { getSandboxRoot: () => sandboxRoot, getWorkspaceDirs };

  let tools;
  if (isDraft) {
    tools = assembleDryRunTools(skill.meta.permissions, deps);
  } else {
    tools = assembleTools(skill.meta.permissions, deps);
  }

  if (!tools.length && !task) {
    const msg = `Skill "${skillName}" 没有声明任何权限，无需执行工具操作。\n\n${skill.instructions}`;
    updateSkillExecution(db, executionId, { status: 'completed', outputJson: { message: msg } });
    return msg;
  }

  const prompt = buildSkillPrompt(skill, inputs);
  const model = createChatModel();
  const checkpointer = new MemorySaver();

  const agent = createReactAgent({
    llm: model,
    tools,
    prompt,
    checkpointer,
  });

  const threadId = randomUUID();
  const config = {
    configurable: { thread_id: threadId },
    recursionLimit: MAX_SKILL_RECURSION,
  };

  const taskParts = [];
  if (task) {
    taskParts.push(task);
  }
  if (Object.keys(inputs).length) {
    taskParts.push(`\n结构化参数: ${JSON.stringify(inputs, null, 2)}`);
  }
  if (!taskParts.length) {
    taskParts.push('请根据 Skill 指令执行任务。');
  }
  if (isDraft) {
    taskParts.push('\n（当前为预览模式，工具调用会返回模拟结果而非实际执行）');
  }
  const taskMessage = taskParts.join('\n');

  log(`[${executionId}] System prompt length: ${prompt.length} chars`);
  log(`[${executionId}] User message: ${taskMessage.slice(0, 200)}...`);
  log(`[${executionId}] Tools available: [${tools.map((t) => t.name).join(', ')}]`);

  try {
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: taskMessage }] },
      config,
    );

    const messages = result.messages || [];
    const lastMsg = messages[messages.length - 1];
    const assistantText = typeof lastMsg?.content === 'string' ? lastMsg.content : '';

    const traceEntries = [];
    const toolResults = [];
    let stepIdx = 0;

    for (const msg of messages) {
      const msgType = msg._getType?.() || msg.constructor?.name || 'unknown';

      if (msgType === 'ai' || msg.constructor?.name === 'AIMessage') {
        if (msg.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            stepIdx++;
            const argsStr = JSON.stringify(tc.args || {});
            traceEntries.push(`[步骤${stepIdx}] 🔧 调用工具: ${tc.name}\n  参数: ${argsStr.slice(0, 300)}${argsStr.length > 300 ? '...' : ''}`);
            log(`[${executionId}] Step ${stepIdx}: tool_call ${tc.name}(${argsStr.slice(0, 200)})`);
          }
        }
      }

      if (msgType === 'tool' || msg.constructor?.name === 'ToolMessage') {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const truncated = content.slice(0, 800);
        traceEntries.push(`  ← 结果 (${msg.name || 'unknown'}): ${truncated}${content.length > 800 ? `\n  ... [总长 ${content.length} 字符, 已截断]` : ''}`);
        toolResults.push({
          tool: msg.name || 'unknown',
          args: msg.tool_call_id || '',
          content: content.slice(0, 1000),
        });
        log(`[${executionId}] Tool result (${msg.name}): ${content.slice(0, 150)}...`);
      }
    }

    const outputParts = [];

    if (isDraft) {
      outputParts.push(`## Skill「${skillName}」执行预览 (草稿模式)\n`);
    } else {
      outputParts.push(`## Skill「${skillName}」执行完成\n`);
    }

    outputParts.push(`> 执行ID: \`${executionId}\` | 工具调用: ${toolResults.length} 次 | 模式: ${isDraft ? '预览' : '正式'}\n`);

    if (traceEntries.length) {
      outputParts.push('### 执行追踪');
      outputParts.push(traceEntries.join('\n'));
      outputParts.push('');
    }

    if (assistantText) {
      outputParts.push('### 结果');
      outputParts.push(assistantText);
    } else {
      outputParts.push('### 结果');
      outputParts.push('（sub-agent 未返回文本结果）');
    }

    if (isDraft) {
      outputParts.push('\n---');
      outputParts.push('⚠ 这是预览模式。如需实际执行，请确认后再次调用 execute_skill。');
    }

    const output = outputParts.join('\n');

    updateSkillExecution(db, executionId, {
      status: 'completed',
      outputJson: { text: assistantText, toolResults, trace: traceEntries },
      logText: output,
    });

    log(`[${executionId}] Completed. ${toolResults.length} tool calls, result: ${assistantText.slice(0, 100)}...`);
    return output;

  } catch (e) {
    log(`[${executionId}] FAILED: ${e.message}`);
    log(`[${executionId}] Stack: ${e.stack?.slice(0, 500)}`);
    updateSkillExecution(db, executionId, {
      status: 'failed',
      error: e.message,
    });
    return `Skill "${skillName}" 执行失败:\n错误: ${e.message}\n执行ID: ${executionId}\n\n如需调试，请检查应用控制台日志（搜索执行ID）。`;
  }
}

/**
 * For draft mode, wrap tools so they return previews instead of executing.
 */
function assembleDryRunTools(permissions, deps) {
  const realTools = assembleTools(permissions, deps);

  return realTools.map((t) => {
    const schema = t.schema;
    return langTool(
      async (input) => {
        const inputStr = JSON.stringify(input, null, 2);
        return `[预览模式] 工具 "${t.name}" 将被调用，参数:\n${inputStr}\n\n（实际执行需要确认）`;
      },
      {
        name: t.name,
        description: `[预览] ${t.description}`,
        schema,
      },
    );
  });
}

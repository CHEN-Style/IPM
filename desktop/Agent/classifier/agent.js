import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createChatModel, getOpenAIConfig } from '../services/llm.js';
import { SYSTEM_PROMPT, buildUserMessage, PROMPT_VERSION } from '../prompts/systemPrompt.js';
import { ClassifyOutputSchema } from '../schemas/output.js';
import { createBrowseStructureTool } from '../tools/browseStructure.js';
import { createQueryHistoryTool } from '../tools/queryHistory.js';
import { createInspectFolderTool } from '../tools/inspectFolder.js';
import { createGetSourceInfoTool } from '../tools/getSourceInfo.js';
import { createGetUserRulesTool } from '../tools/getUserRules.js';

const MAX_RECURSION = 15;

const log = (msg) => console.log(`[IPM][Agent:LLM] ${msg}`);

function extractToolCalls(messages) {
  const calls = [];
  for (const m of messages) {
    try {
      if (m._getType() === 'ai' && m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          calls.push({ name: tc.name, args: tc.args });
        }
      }
    } catch {
      // skip non-standard messages
    }
  }
  return calls;
}

function extractToolResults(messages) {
  const results = [];
  for (const m of messages) {
    try {
      if (m._getType() === 'tool') {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        results.push({ name: m.name, preview: content.slice(0, 120) });
      }
    } catch {
      // skip
    }
  }
  return results;
}

function extractFullTrace(messages) {
  const steps = [];
  for (const m of messages) {
    let type;
    try { type = m._getType?.(); } catch { continue; }

    if (type === 'ai') {
      const text = typeof m.content === 'string' ? m.content.trim() : '';
      if (text) {
        steps.push({ type: 'reasoning', content: text, ts: Date.now() });
      }
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          steps.push({ type: 'tool-call', name: tc.name, args: tc.args ?? {}, ts: Date.now() });
        }
      }
    } else if (type === 'tool') {
      const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      steps.push({ type: 'tool-result', name: m.name, content: raw, ts: Date.now() });
    }
  }
  return steps;
}

export async function runClassifyAgent(input, signal) {
  const { projectDir, projectName, fileName, ext, sourceRelPath, sourceDir, folders } = input;
  const aborted = () => signal?.aborted ?? false;

  const tools = [
    createBrowseStructureTool(projectDir),
    createQueryHistoryTool(projectDir, projectName),
    createInspectFolderTool(projectDir),
    createGetSourceInfoTool(projectDir),
    createGetUserRulesTool(),
  ];

  const model = createChatModel();

  const agent = createReactAgent({
    llm: model,
    tools,
    prompt: SYSTEM_PROMPT,
  });

  const userMsg = buildUserMessage({ fileName, ext, sourceRelPath, sourceDir, projectName });
  log(`开始推理 | ${fileName}`);

  const result = await agent.invoke(
    { messages: [{ role: 'user', content: userMsg }] },
    { recursionLimit: MAX_RECURSION },
  );

  const toolCalls = extractToolCalls(result.messages);
  const toolResults = extractToolResults(result.messages);
  const toolCallCount = toolResults.length;
  const trace = extractFullTrace(result.messages);

  if (aborted()) { log(`⏹ 已超时，丢弃结果`); return; }

  if (toolCalls.length > 0) {
    log(`Tool 调用链:`);
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const argsStr = Object.keys(tc.args || {}).length > 0
        ? ` (${JSON.stringify(tc.args)})`
        : '';
      const resultPreview = toolResults[i] ? ` → ${toolResults[i].preview}` : '';
      log(`  ${i + 1}. ${tc.name}${argsStr}${resultPreview}`);
    }
  } else {
    log(`无 Tool 调用（直接输出结论）`);
  }

  const lastMessage = result.messages[result.messages.length - 1];
  const content =
    typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Agent did not return valid JSON. Raw output: ${content.slice(0, 200)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Agent returned malformed JSON: ${e.message}`);
  }

  const validated = ClassifyOutputSchema.parse({
    ...parsed,
    classifiedBy: 'agent',
  });

  const allowedPaths = new Set(folders.map((f) => f.relPath));
  if (!allowedPaths.has(validated.targetRelPath)) {
    throw new Error(
      `Agent output targetRelPath "${validated.targetRelPath}" is not in the candidate folder list`,
    );
  }

  log(`结论: → ${validated.targetRelPath} | confidence: ${validated.confidence}`);

  const { model: modelName, baseURL } = getOpenAIConfig();

  return {
    ...validated,
    toolCallCount,
    trace,
    agentMeta: {
      provider: 'openai-compatible',
      model: modelName,
      baseURL,
      promptVersion: PROMPT_VERSION,
    },
  };
}

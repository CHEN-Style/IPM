import { ClassifyInputSchema } from '../schemas/input.js';
import { tryFastPath } from './fastPath.js';
import { runClassifyAgent } from './agent.js';
import { validateClassifyOutput, withTimeout } from '../guardrails/validator.js';

const AGENT_TIMEOUT_MS = 60_000;

const log = (msg) => console.log(`[IPM][Classifier] ${msg}`);

/**
 * Unified classification entry point.
 *
 * Waterfall: 硬规则 (fast-path) → Tool-Calling Agent (软偏好 + 推理) → validator.
 * Returns a ClassifyOutput-shaped result with confidence, classifiedBy, etc.
 */
export async function classifyFile(rawInput) {
  const input = ClassifyInputSchema.parse(rawInput);
  const { fileName, ext, folders, projectDir, sourceDir } = input;

  // --- 1. 硬规则快速通道 (classify-rules.json, no LLM) ---
  log(`[1/3] 硬规则检查 | ${fileName}`);
  const fastResult = tryFastPath({ fileName, ext, folders, projectDir, sourceDir });
  if (fastResult) {
    const { valid, errors } = validateClassifyOutput(fastResult, folders);
    if (valid) {
      log(`[1/3] ⚡ 硬规则命中 → ${fastResult.targetRelPath}`);
      return { ...fastResult, toolCallCount: 0, trace: fastResult.trace || [] };
    }
    log(`[1/3] ⚠ 硬规则命中但校验失败: ${errors.join('; ')}，转入 Agent`);
  } else {
    log(`[1/3] 无硬规则命中，转入 Tool-Calling Agent`);
  }

  // --- 2. Tool-Calling Agent (with timeout) ---
  log(`[2/3] 🤖 启动 Tool-Calling Agent (超时: ${AGENT_TIMEOUT_MS / 1000}s)`);
  const ac = new AbortController();
  const agentResult = await withTimeout(
    runClassifyAgent(input, ac.signal),
    AGENT_TIMEOUT_MS,
    () => ac.abort(),
  );

  // --- 3. Validator ---
  const { valid, errors } = validateClassifyOutput(agentResult, folders);
  if (!valid) {
    log(`[3/3] ✗ Agent 输出校验失败: ${errors.join('; ')}`);
    throw new Error(`Agent output failed validation: ${errors.join('; ')}`);
  }
  log(`[3/3] ✓ 护栏校验通过`);

  return agentResult;
}

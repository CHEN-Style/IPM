// desktop/Agent/pi-runtime/tools/askUserTool.js
//
// E.5: `ask_user` customTool.
//
// Bridges the model back to the user with **structured multiple-choice
// questions**, instead of asking in free text and forcing the user to
// type answers. Primarily for Plan mode, where KnowClaw needs to nail
// down ambiguous requirements before proposing an implementation.
//
// Wire-up:
//   bootstrap.js -> buildAskUserTool({ askUser })  (askUser is supplied
//   by knowclaw.js's askUserViaRenderer, which IPC-pushes the questions
//   to the renderer, awaits the AskUserCard reply, and resolves with
//   the answers object).
//
// Design constraints (same as projectTools/webTools):
//   1. ESM. Loaded directly by Node.
//   2. execute() returns AgentToolResult shape:
//        { content: [{ type: 'text', text }], details: T }
//   3. The answers object is JSON.stringified into the text result so
//      the model gets it as a structured payload it can read back.

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';

function textResult(text, details = null) {
  return {
    content: [{ type: 'text', text: String(text ?? '') }],
    details,
  };
}

/**
 * @param {object} opts
 * @param {(questions: any[], signal?: AbortSignal) => Promise<any>} opts.askUser
 *   Bridge to renderer. Receives the questions array (already validated
 *   by pi's schema layer) and returns either:
 *     - `{ [questionId]: optionId }`              — single-choice answers
 *     - `{ [questionId]: optionId[] }`            — multi-choice answers
 *     - `{ cancelled: true }`                     — user dismissed dialog
 *     - `{ timeout: true, message: string }`      — 5-minute hard limit
 *     - `{ error: string, message: string }`     — no renderer / send failure
 * @returns {Array<object>}
 */
export function buildAskUserTool({ askUser } = {}) {
  if (typeof askUser !== 'function') {
    // Defensive: if no bridge is wired, the tool degrades to an error
    // result so the model can decide to retry or fall back to plain
    // text. We still register it so the prompt's plan-mode guidance
    // remains coherent.
    askUser = async () => ({ error: 'no_bridge', message: 'ask_user is not wired up in this runtime' });
  }

  const tool = defineTool({
    name: 'ask_user',
    label: '向用户提问',
    description:
      '向用户发起结构化多选题（每题 2 个以上选项）。适合 Plan 模式下澄清需求细节、技术选型、命名风格等。' +
      '不要用它代替自然对话；只在需求确实模糊、用户必须做出明确选择时使用。',
    promptSnippet:
      'ask_user: 弹出结构化选择题（1-5 个问题，每题 2+ 选项）由用户在 UI 中点选确认。',
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          id: Type.String({
            minLength: 1,
            description: '问题的稳定 slug，用于在 answers 对象中索引，例如 "scope" / "naming".',
          }),
          prompt: Type.String({
            minLength: 1,
            description: '展示给用户的问题文本（中文，简洁明确）。',
          }),
          options: Type.Array(
            Type.Object({
              id: Type.String({ minLength: 1, description: '选项 slug。' }),
              label: Type.String({ minLength: 1, description: '选项显示文本。' }),
            }),
            { minItems: 2, description: '至少 2 个选项。' },
          ),
          allow_multiple: Type.Optional(
            Type.Boolean({ description: '是否允许多选。默认 false（单选）。' }),
          ),
        }),
        { minItems: 1, maxItems: 5, description: '一次最多 5 个问题。' },
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const questions = Array.isArray(params?.questions) ? params.questions : [];
      if (questions.length === 0) {
        return textResult('错误: ask_user 必须提供至少 1 个问题。');
      }
      try {
        const answers = await askUser(questions, signal);
        // The renderer may reply with structured signals (cancelled /
        // timeout / error). Surface them clearly to the model so it
        // can decide what to do next instead of treating them as
        // user-provided answers.
        if (answers && typeof answers === 'object') {
          if (answers.cancelled) {
            return textResult('用户取消了本次提问。请改为用自然语言提问，或直接给出方案让用户决定。', answers);
          }
          if (answers.timeout) {
            return textResult('用户未在 5 分钟内回复。请发一条文字消息提醒用户，或先把方案做出来等用户回头确认。', answers);
          }
          if (answers.error) {
            return textResult(`ask_user 桥接异常: ${answers.message || answers.error}`, answers);
          }
        }
        return textResult(
          '用户回复:\n' + JSON.stringify(answers, null, 2),
          answers,
        );
      } catch (err) {
        return textResult('ask_user 执行失败: ' + String(err?.message || err));
      }
    },
  });

  return [tool];
}

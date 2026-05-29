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
      '向用户发起结构化多选题（每题 2-5 个选项，1-5 道题）。Plan 与 Agent 模式都可调用：' +
      '当需求里出现"有限的可枚举分支"——命名/风格/受众/技术选型/破坏性操作确认等——优先用本工具发起选择题，' +
      '比自然语言罗列让用户手打回答更顺。每次最多 5 题，问完即停等回复。' +
      '前端会自动在每题末尾追加"其他…"自由文本选项和全局"跳过"按钮，不要在 options 里手动塞这两项。' +
      '不要用它代替开放式对话；候选答案完全开放或只有一个明显方向时，用普通文本回复即可。',
    promptSnippet:
      'ask_user: 弹出结构化选择题（1-5 题，每题 2+ 选项）由用户在 UI 中点选确认。' +
      '前端自动追加"其他…"输入框 + "跳过"按钮，无需手动加。',
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
        // The renderer may reply with structured signals
        // (cancelled / skipped / timeout / error / aborted). Surface
        // each clearly to the model so it can decide what to do next
        // instead of treating any of them as user-provided answers.
        if (answers && typeof answers === 'object') {
          if (answers.cancelled) {
            return textResult(
              '用户取消了本次提问。请不要重复发起 ask_user；改为用自然语言提问，' +
              '或直接给出方案让用户决定。',
              answers,
            );
          }
          if (answers.skipped) {
            // The user explicitly opted out of answering. The model
            // should proceed on its best judgement and may re-confirm
            // later if a critical decision arises — but it should NOT
            // immediately re-fire another ask_user with the same
            // questions, that's annoying.
            return textResult(
              '用户选择跳过本次提问，请根据你已有的上下文与默认偏好继续推进；' +
              '若后续出现关键不确定，可以在执行到那一步时再发一次 ask_user。' +
              '不要立刻就同一组问题重复发起。',
              answers,
            );
          }
          if (answers.timeout) {
            return textResult('用户未在 5 分钟内回复。请发一条文字消息提醒用户，或先把方案做出来等用户回头确认。', answers);
          }
          if (answers.aborted) {
            // Agent-loop was aborted (user clicked Stop). Don't push
            // more wording — the loop will tear down anyway.
            return textResult('提问被中断。', answers);
          }
          if (answers.error) {
            return textResult(`ask_user 桥接异常: ${answers.message || answers.error}`, answers);
          }
        }
        // Normal answers payload. Free-text "其他…" entries are encoded
        // as `other:<typed text>` strings inline with the rest of the
        // answers map; the model should treat any value starting with
        // `other:` as the user's verbatim freeform response.
        return textResult(
          '用户回复:\n' + JSON.stringify(answers, null, 2) +
          '\n\n说明：值若以 `other:` 开头，表示用户在「其他…」自由文本框中填写的内容，' +
          '冒号后即为原文，请把它当成用户的明确输入。',
          answers,
        );
      } catch (err) {
        return textResult('ask_user 执行失败: ' + String(err?.message || err));
      }
    },
  });

  return [tool];
}

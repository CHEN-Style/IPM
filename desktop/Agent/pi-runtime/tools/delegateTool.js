// desktop/Agent/pi-runtime/tools/delegateTool.js
//
// U6: sub-agent delegation tool (`delegate_task`).
//
// What it does
// ------------
// Exposes a single customTool that the main pi agent can invoke to
// hand a self-contained sub-task to an *isolated* pi AgentSession.
// The sub-agent runs with:
//
//   - A fresh, in-memory SessionManager (no JSONL pollution).
//   - A `DefaultResourceLoader` configured with `noContextFiles: true`
//     so AGENTS.md / CLAUDE.md scanning doesn't bloat the sub-agent
//     prompt; built-in + user skills are still loaded so the
//     sub-agent can call `python "$KNOWCLAW_SKILLS_DIR/_shared/..."`
//     scripts when needed.
//   - An explicit `tools` allowlist:
//       kind="research" (default) → read / grep / find / ls (read-only)
//       kind="edit"               → read / write / edit / grep / find /
//                                   ls / bash
//   - The same `authStorage` / `modelRegistry` / `model` as the main
//     agent (so we don't re-register the IPM provider or burn another
//     auth roundtrip).
//   - `customTools: []` — crucially, the sub-agent does NOT get its
//     own `delegate_task`, which is what prevents runaway recursion.
//
// Once the child session is built, we:
//
//   1. Optionally chain the parent's install-guard `beforeToolCall`
//      onto the child agent (kind="edit" only, since research mode
//      has no `bash` and thus no install path).
//   2. Subscribe to the child session's event stream, tracking turn
//      count, tool call count, and file operations (read / write /
//      edit) by walking `tool_execution_start` args.
//   3. Throttle a progress snapshot (~500ms) back to the parent
//      via the tool's `onUpdate` callback — the renderer renders it
//      as the standard "streaming stdout" stripe inside the
//      `delegate_task` ToolCallCard, reusing U3's plumbing.
//   4. Run `childSession.prompt(...)` with a fixed task wrapper.
//   5. Enforce a hard 5-minute timeout, an N=10 max-turns cap, and
//      a cooperative abort path (parent `ctx.signal` → child abort).
//   6. Collect a structured result:
//
//        {
//          ok:               boolean,
//          summary:          string (final assistant text, ≤500 chars
//                            target — the model is asked to be brief),
//          filesRead:        string[],
//          filesModified:    string[],
//          toolCallCount:    number,
//          turnCount:        number,
//          durationMs:       number,
//          truncatedReason:  null | 'aborted' | 'timeout' | 'max_turns'
//                            | 'error',
//          error?:           string (when truncatedReason==='error'),
//        }
//
//      The structured payload is returned as `details` so the parent
//      agent can reason on `filesRead` / `filesModified` etc., and
//      the same payload is stringified into `content[0].text` so the
//      LLM can consume it directly.
//
// File-operation extraction note
// ------------------------------
// pi's `extractFileOpsFromMessage` lives in `core/compaction/utils.js`
// but is NOT re-exported from the package root `index.d.ts` (only
// the `FileOperations` *type* is). We therefore do our own
// lightweight extraction off the live event stream instead of
// importing private subpaths: the `path` field is the first
// parameter on `read` / `write` / `edit` tool schemas (see
// `dist/core/tools/{read,write,edit}.d.ts`), so we capture
// `args.path` at `tool_execution_start` and confirm it on the
// matching `tool_execution_end` (skipping errored calls). This is
// roughly equivalent to pi's own internal logic for the common
// cases without depending on an unstable subpath.

import path from 'node:path';

import { Type } from 'typebox';
import {
  defineTool,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const PROGRESS_THROTTLE_MS = 500;
const SUMMARY_BUF_MAX = 2_000;

/**
 * True if `child` is the same directory as `parent`, or a descendant
 * of it. Case-insensitive on Windows because dialog.showOpenDialog
 * and `path.resolve` may yield different casings for the same path.
 */
function isSubdirOrEqual(parentAbs, childAbs) {
  const p = path.resolve(parentAbs);
  const c = path.resolve(childAbs);
  const pKey = process.platform === 'win32' ? p.toLowerCase() : p;
  const cKey = process.platform === 'win32' ? c.toLowerCase() : c;
  if (pKey === cKey) return true;
  // Path separator boundary so `/foo` does not match `/foobar`.
  return cKey.startsWith(pKey + path.sep);
}

/**
 * Extract the file path argument from a built-in pi tool call, if
 * applicable. Returns null for tools that don't operate on a single
 * file path (grep / find / ls / bash all take queries or commands).
 */
function extractPathFromArgs(toolName, args) {
  if (!args || typeof args !== 'object') return null;
  if (toolName === 'read' || toolName === 'write' || toolName === 'edit') {
    return typeof args.path === 'string' && args.path ? args.path : null;
  }
  return null;
}

/**
 * Trim a streaming buffer down to a fixed tail for the progress
 * snapshot. We keep the tail (rather than the head) because the
 * final summary appears at the end of the assistant's last message.
 */
function tailExcerpt(buffer, maxChars = SUMMARY_BUF_MAX) {
  if (!buffer) return '';
  if (buffer.length <= maxChars) return buffer;
  return '...' + buffer.slice(-maxChars);
}

function formatProgressHeader(state) {
  const parts = [];
  parts.push(`Turn ${state.turnCount}/${state.maxTurns}`);
  if (state.currentTool) parts.push(`tool: ${state.currentTool}`);
  if (state.toolCallCount > 0) parts.push(`calls: ${state.toolCallCount}`);
  return `[delegate_task | ${state.kind}] ${parts.join('  ·  ')}`;
}

/**
 * Build the wrapped task prompt sent to the sub-agent. We do NOT
 * include the cwd in the body verbatim if it's the parent cwd
 * because that's already in the system prompt — but we always state
 * it explicitly for the sub-agent to anchor on.
 */
function buildTaskPrompt(task, cwd) {
  return [
    '你是一个隔离的子任务执行器（sub-agent）。',
    `工作目录: ${cwd}`,
    '约束：',
    '- 你只能在工作目录及其子目录下操作。',
    '- 你的工具集已经被显式限制，不要假设有未列出的工具。',
    '- 不要尝试调用 delegate_task：你本身就是子代理，不能再委托。',
    '- 完成任务后请给出 ≤ 500 字的结构化结论（必要时使用项目符号）。',
    '- 若任务超出能力或工具范围，明确说明并停止——不要瞎猜。',
    '',
    `任务: ${task}`,
  ].join('\n');
}

/**
 * Build the `delegate_task` tool definition.
 *
 * @param {object} deps
 * @param {*}      [deps.authStorage]            shared AuthStorage (avoid re-registering provider)
 * @param {*}      [deps.modelRegistry]          shared ModelRegistry
 * @param {*}      [deps.model]                  shared resolved Model
 * @param {string} [deps.parentCwd]              absolute cwd of the parent session
 * @param {string} [deps.thinkingLevel='medium'] inherited thinking level
 * @param {Function} [deps.parentBeforeToolCall] U3 install-guard hook (chained when kind='edit')
 * @param {string} [deps.builtinSkillsDir]       absolute path to built-in skills (loaded into child RL)
 * @param {string} [deps.userSkillsRoot]         optional absolute path to user skills
 * @param {Function} [deps.log]                  diagnostic logger; defaults to no-op
 * @returns {Array<object>} A ToolDefinition[] suitable for `customTools`.
 */
export function buildDelegateTool(deps = {}) {
  const {
    authStorage,
    modelRegistry,
    model,
    parentCwd,
    thinkingLevel = 'medium',
    parentBeforeToolCall = null,
    builtinSkillsDir = null,
    userSkillsRoot = null,
    log = () => {},
  } = deps;

  const tool = defineTool({
    name: 'delegate_task',
    label: '委托子任务',
    description: [
      '将一个边界清晰、可独立完成的子任务委托给隔离的子代理执行。',
      '子代理在独立的上下文中工作，最后返回结构化摘要（不污染主对话）。',
      '',
      '适合：',
      '- 需要读大量文件但主对话只需要结论的任务（例如"分析整个项目的代码风格"）',
      '- 可以独立完成、不需要主代理实时介入的子任务',
      '- 探索性的研究（grep / find / 文件扫描），主对话只关心结论',
      '',
      '不适合：',
      '- 单步操作（直接调 read / bash 更快）',
      '- 需要主代理保持完整上下文以便后续追问的任务',
      '- 涉及业务数据修改（项目/案件/学习）的操作 — 子代理无业务工具',
    ].join('\n'),
    promptSnippet:
      'delegate_task: launch an isolated sub-agent to handle a self-contained sub-task (research / multi-file scan / code analysis). The sub-agent runs in a fresh context and returns a structured summary { summary, filesRead, filesModified, ... }.',
    promptGuidelines: [
      '当任务涉及大量文件扫描或独立子目标时，优先使用 delegate_task 委托给子代理。',
      '子代理可以隔离上下文消耗；但每次委托产生独立 API 调用，不要为了小任务委托。',
      '默认 kind="research"（只读工具集，安全）；只有当任务确实需要写/改文件时才指定 kind="edit"。',
      'cwd 必须等于或为主工作目录的子目录；否则会被拒绝。',
      '子代理无 delegate_task — 不要在 task 描述里要求它进一步委托。',
    ],
    parameters: Type.Object({
      task: Type.String({
        minLength: 1,
        description: '清晰、可独立完成的任务描述。会作为子代理的唯一指令。',
      }),
      kind: Type.Optional(
        Type.Union(
          [Type.Literal('research'), Type.Literal('edit')],
          {
            description:
              "子代理工具集。'research'（默认）：只读（read/grep/find/ls）。'edit'：完整（read/write/edit/grep/find/ls/bash）。",
          },
        ),
      ),
      cwd: Type.Optional(
        Type.String({
          description:
            '可选——子代理工作目录的绝对路径。必须等于或为主代理 cwd 的子目录。默认继承主代理 cwd。',
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const startedAt = Date.now();
      const kind = params?.kind === 'edit' ? 'edit' : 'research';
      const task = String(params?.task || '').trim();

      // ---- 1. validate task ----
      if (!task) {
        const err = {
          ok: false,
          summary: '',
          error: 'task is required and must not be empty',
          truncatedReason: 'error',
          filesRead: [],
          filesModified: [],
          toolCallCount: 0,
          turnCount: 0,
          durationMs: Date.now() - startedAt,
        };
        return {
          details: err,
          content: [{ type: 'text', text: JSON.stringify(err, null, 2) }],
        };
      }

      // ---- 2. resolve + sandbox cwd ----
      const parentCwdAbs = path.resolve(parentCwd || process.cwd());
      let targetCwd = parentCwdAbs;
      if (params?.cwd && String(params.cwd).trim()) {
        try {
          targetCwd = path.resolve(String(params.cwd).trim());
        } catch (err) {
          const out = {
            ok: false,
            summary: '',
            error: `invalid cwd: ${err?.message || err}`,
            truncatedReason: 'error',
            filesRead: [],
            filesModified: [],
            toolCallCount: 0,
            turnCount: 0,
            durationMs: Date.now() - startedAt,
          };
          return {
            details: out,
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
          };
        }
        if (!isSubdirOrEqual(parentCwdAbs, targetCwd)) {
          const out = {
            ok: false,
            summary: '',
            error: `cwd '${targetCwd}' is outside the parent workspace '${parentCwdAbs}'`,
            truncatedReason: 'error',
            filesRead: [],
            filesModified: [],
            toolCallCount: 0,
            turnCount: 0,
            durationMs: Date.now() - startedAt,
          };
          return {
            details: out,
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
          };
        }
      }

      // ---- 3. tool allowlist ----
      const tools = kind === 'edit'
        ? ['read', 'write', 'edit', 'grep', 'find', 'ls', 'bash']
        : ['read', 'grep', 'find', 'ls'];

      // ---- 4. ResourceLoader (no AGENTS.md, skills inherited) ----
      const additionalSkillPaths = [];
      if (builtinSkillsDir) additionalSkillPaths.push(builtinSkillsDir);
      if (userSkillsRoot) additionalSkillPaths.push(userSkillsRoot);

      let childRL;
      try {
        childRL = new DefaultResourceLoader({
          cwd: targetCwd,
          agentDir: getAgentDir(),
          noContextFiles: true,
          additionalSkillPaths,
        });
        await childRL.reload();
      } catch (err) {
        log('delegateTool: ResourceLoader build failed:', err?.message || err);
        const out = {
          ok: false,
          summary: '',
          error: `failed to initialize sub-agent resource loader: ${err?.message || err}`,
          truncatedReason: 'error',
          filesRead: [],
          filesModified: [],
          toolCallCount: 0,
          turnCount: 0,
          durationMs: Date.now() - startedAt,
        };
        return {
          details: out,
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        };
      }

      // ---- 5. in-memory session manager ----
      const childSM = SessionManager.inMemory(targetCwd);

      // ---- 6. create child AgentSession ----
      let childSession;
      try {
        const result = await createAgentSession({
          cwd: targetCwd,
          sessionManager: childSM,
          resourceLoader: childRL,
          authStorage,
          modelRegistry,
          model,
          thinkingLevel,
          tools,           // explicit allowlist (read/grep/find/ls or +write/edit/bash)
          customTools: [], // intentional: sub-agent has NO delegate_task → no recursion
        });
        childSession = result.session;
      } catch (err) {
        log('delegateTool: createAgentSession failed:', err?.message || err);
        const out = {
          ok: false,
          summary: '',
          error: `failed to spawn sub-agent: ${err?.message || err}`,
          truncatedReason: 'error',
          filesRead: [],
          filesModified: [],
          toolCallCount: 0,
          turnCount: 0,
          durationMs: Date.now() - startedAt,
        };
        return {
          details: out,
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        };
      }

      // ---- 6b. inherit install-guard hook in edit mode ----
      //
      // The parent agent's `beforeToolCall` (U3) gates `pip install` /
      // `npm install` style commands with a renderer-confirmed dialog
      // — the same UX must apply when the sub-agent issues installs
      // in `kind='edit'` mode. We chain the parent's hook in front of
      // pi's default agent hook on the *child* agent so:
      //
      //   1. The parent guard runs first and can short-circuit
      //      (`{ block: true, reason }`) the install.
      //   2. The pi extension hook still runs when we allow through,
      //      preserving any future built-in behaviour.
      if (kind === 'edit' && typeof parentBeforeToolCall === 'function') {
        try {
          const agent = childSession.agent;
          const inner = agent.beforeToolCall;
          agent.beforeToolCall = async (event, sig) => {
            const mine = await parentBeforeToolCall(event, sig);
            if (mine && mine.block) return mine;
            if (typeof inner === 'function') return inner.call(agent, event, sig);
            return undefined;
          };
        } catch (err) {
          log('delegateTool: failed to chain install-guard onto sub-agent:', err?.message || err);
        }
      }

      // ---- 7. progress tracking + file-op extraction ----
      const fileOpsByCallId = new Map(); // toolCallId → { name, path }
      const filesRead = new Set();
      const filesModified = new Set();

      let turnCount = 0;
      let toolCallCount = 0;
      let currentTool = null;
      let assistantTextBuf = '';
      let lastFinalAssistantText = '';
      let aborted = false; // true once we (or the parent) called childSession.abort()
      const maxTurns = DEFAULT_MAX_TURNS;

      // Throttled progress emission: at most one update every
      // PROGRESS_THROTTLE_MS, but coalesce trailing events so the
      // final state isn't lost.
      let progressTimer = null;
      let pendingProgress = false;
      const emitProgress = () => {
        if (!onUpdate) return;
        try {
          const header = formatProgressHeader({ turnCount, maxTurns, currentTool, toolCallCount, kind });
          const body = tailExcerpt(assistantTextBuf);
          onUpdate({
            content: [{ type: 'text', text: body ? `${header}\n\n${body}` : header }],
          });
        } catch {
          /* never break the agent loop on a UI push failure */
        }
      };
      const pushProgress = () => {
        if (progressTimer) {
          pendingProgress = true;
          return;
        }
        emitProgress();
        progressTimer = setTimeout(() => {
          progressTimer = null;
          if (pendingProgress) {
            pendingProgress = false;
            pushProgress();
          }
        }, PROGRESS_THROTTLE_MS);
      };

      const unsubscribe = childSession.subscribe((evt) => {
        if (!evt || typeof evt !== 'object') return;
        try {
          switch (evt.type) {
            case 'turn_start': {
              turnCount += 1;
              // Hard cap: when we cross maxTurns, abort the child
              // before it actually consumes the (N+1)-th turn. We
              // remember which side triggered the abort via the
              // local `aborted` flag so truncatedReason can be
              // computed accurately on the way out.
              if (turnCount > maxTurns) {
                aborted = true;
                try { childSession.abort(); } catch { /* ignore */ }
                break;
              }
              pushProgress();
              break;
            }
            case 'tool_execution_start': {
              toolCallCount += 1;
              currentTool = evt.toolName || 'tool';
              const pathArg = extractPathFromArgs(evt.toolName, evt.args);
              if (pathArg && evt.toolCallId) {
                fileOpsByCallId.set(evt.toolCallId, { name: evt.toolName, path: pathArg });
              }
              pushProgress();
              break;
            }
            case 'tool_execution_end': {
              const entry = evt.toolCallId ? fileOpsByCallId.get(evt.toolCallId) : null;
              if (entry && !evt.isError) {
                if (entry.name === 'read') filesRead.add(entry.path);
                else if (entry.name === 'write' || entry.name === 'edit') filesModified.add(entry.path);
              }
              currentTool = null;
              pushProgress();
              break;
            }
            case 'message_update': {
              const sub = evt.assistantMessageEvent;
              if (sub?.type === 'text_delta' && typeof sub.delta === 'string') {
                assistantTextBuf += sub.delta;
                // Avoid unbounded growth: tailExcerpt also bounds
                // the snapshot, but bounding the source buffer too
                // keeps memory predictable for very long runs.
                if (assistantTextBuf.length > SUMMARY_BUF_MAX * 4) {
                  assistantTextBuf = assistantTextBuf.slice(-SUMMARY_BUF_MAX * 2);
                }
                pushProgress();
              }
              break;
            }
            case 'message_end': {
              const msg = evt.message;
              if (msg && msg.role === 'assistant' && Array.isArray(msg.content)) {
                const parts = msg.content
                  .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
                  .map((b) => b.text);
                if (parts.length > 0) lastFinalAssistantText = parts.join('\n');
              }
              break;
            }
            default:
              break;
          }
        } catch (err) {
          log('delegateTool: subscribe handler failed:', err?.message || err);
        }
      });

      // ---- 8. abort propagation (parent ctx.signal → child) ----
      const onParentAbort = () => {
        aborted = true;
        try { childSession.abort(); } catch { /* ignore */ }
      };
      try {
        if (signal) {
          if (signal.aborted) {
            onParentAbort();
          } else {
            signal.addEventListener('abort', onParentAbort, { once: true });
          }
        }
      } catch { /* older Node — leave the parent abort unhooked */ }

      // ---- 9. hard timeout ----
      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        aborted = true;
        try { childSession.abort(); } catch { /* ignore */ }
      }, DEFAULT_TIMEOUT_MS);

      // ---- 10. run the sub-agent ----
      const taskPrompt = buildTaskPrompt(task, targetCwd);
      let runError = null;
      try {
        await childSession.prompt(taskPrompt);
      } catch (err) {
        runError = err;
      }

      // ---- 11. cleanup timers + listeners ----
      clearTimeout(timeoutTimer);
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      try { signal?.removeEventListener?.('abort', onParentAbort); } catch { /* ignore */ }
      try { unsubscribe?.(); } catch { /* ignore */ }

      // ---- 12. derive truncatedReason ----
      // Precedence: explicit parent-abort > timeout > max_turns > error > null.
      let truncatedReason = null;
      if (signal?.aborted) truncatedReason = 'aborted';
      else if (timedOut) truncatedReason = 'timeout';
      else if (turnCount > maxTurns) truncatedReason = 'max_turns';
      else if (runError && !aborted) truncatedReason = 'error';

      // ---- 13. assemble structured result ----
      const summary =
        (lastFinalAssistantText && lastFinalAssistantText.trim()) ||
        (assistantTextBuf && assistantTextBuf.trim()) ||
        '';

      const result = {
        ok: !truncatedReason && !runError,
        summary: summary || '(no summary)',
        filesRead: Array.from(filesRead),
        filesModified: Array.from(filesModified),
        toolCallCount,
        turnCount,
        durationMs: Date.now() - startedAt,
        truncatedReason,
      };
      if (runError && truncatedReason !== 'aborted') {
        result.error = String(runError?.message || runError);
      }

      // ---- 14. dispose child session ----
      try {
        if (typeof childSession.dispose === 'function') childSession.dispose();
      } catch { /* ignore */ }

      return {
        details: result,
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  });

  return [tool];
}

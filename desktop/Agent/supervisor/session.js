import { randomUUID } from 'node:crypto';
import { Command } from '@langchain/langgraph';
import { createSupervisorAgent } from './createSupervisorAgent.js';
import { buildProjectRegistry } from './projectRegistry.js';
import { SUPERVISOR_PROMPT_VERSION } from './prompts.js';
import { createSummaryModel } from '../services/llm.js';
import { getSupervisorDb } from '../db/supervisorDb.js';
import { appendConversation, listConversations, trimConversations } from '../db/conversations.js';
import { createSession as dbCreateSession, updateSession as dbUpdateSession, markActiveSessions, getSessionById as dbGetSession } from '../db/chatSessions.js';
import { appendMessage as dbAppendMessage, countMessages as dbCountMessages, listMessages as dbListMessages } from '../db/chatMessages.js';

const log = (msg) => console.log(`[IPM][Supervisor] ${msg}`);

const MAX_CONVERSATIONS_KEEP = 20;
const TOKEN_COMPRESS_THRESHOLD = 3000;
const RECENT_TURNS_TO_KEEP = 4;

let supervisorSession = null;

export function getOrCreateSupervisorSession(deps) {
  if (supervisorSession) return supervisorSession;
  supervisorSession = new SupervisorSession(deps);
  return supervisorSession;
}

export function getSupervisorSession() {
  return supervisorSession || null;
}

export function removeSupervisorSession() {
  supervisorSession = null;
}

export class SupervisorSession {
  constructor(deps) {
    this.appRoot = deps.appRoot;
    this.getSandboxRoot = deps.getSandboxRoot;
    this.getWorkspaceDirs = deps.getWorkspaceDirs;
    this.getWorkspaceDirOrThrow = deps.getWorkspaceDirOrThrow;
    this.syncStructureJson = deps.syncStructureJson;
    this.readState = deps.readState;

    this.threadId = null;
    this.agent = null;
    this.recursionLimit = 40;
    this.started = false;
    this.busy = false;
    this.turnCount = 0;
    this.conversationTopics = [];
    this._lastAssistantText = '';
    this._lastAssistantTools = [];
    this._toolContext = { sessionId: null };
    this._rollingSummary = '';
    this._originalDbSessionId = null;
    this._resumedFromSession = null;
    this.autonomousMode = false;
    this._interrupted = false;
  }

  _getDb() {
    return getSupervisorDb(this.appRoot);
  }

  async startSession() {
    this.threadId = randomUUID();
    this.turnCount = 0;
    this.busy = false;
    this.conversationTopics = [];
    this._lastAssistantText = '';
    this._lastAssistantTools = [];
    this._toolContext.sessionId = this.threadId;

    const db = this._getDb();
    try { markActiveSessions(db, 'interrupted'); } catch { /* ignore */ }
    try { dbCreateSession(db, { id: this.threadId }); } catch (e) { log(`DB createSession failed: ${e.message}`); }

    const { agent, recursionLimit } = createSupervisorAgent({
      appRoot: this.appRoot,
      getSandboxRoot: this.getSandboxRoot,
      getWorkspaceDirs: this.getWorkspaceDirs,
      getWorkspaceDirOrThrow: this.getWorkspaceDirOrThrow,
      syncStructureJson: this.syncStructureJson,
      readState: this.readState,
      toolContext: this._toolContext,
      getAutonomousMode: () => this.autonomousMode,
    });
    this.agent = agent;
    this.recursionLimit = recursionLimit;

    const contextParts = [];

    try {
      const { projectsRoot, casesRoot, studyRoot } = this.getWorkspaceDirs();
      const registry = buildProjectRegistry({
        projectsRoot,
        casesRoot,
        studyRoot,
        readState: this.readState,
      });
      if (registry.length) {
        const registryText = registry.map((p) => {
          const parts = [`- ${p.name} (${p.domain}, ${p.status})`];
          if (p.folderCount) parts.push(`  文件夹: ${p.folderCount}`);
          if (p.fileCount) parts.push(`  文件数: ~${p.fileCount}`);
          if (p.summarySnippet) parts.push(`  摘要: ${p.summarySnippet.slice(0, 100)}`);
          return parts.join('\n');
        }).join('\n');
        contextParts.push(`<workspace_registry>\n${registryText}\n</workspace_registry>`);
      }
    } catch (e) {
      log(`Registry build failed (non-fatal): ${e.message}`);
    }

    try {
      const recentConvos = listConversations(db, { limit: 5 });
      if (recentConvos.length) {
        const convoText = recentConvos
          .reverse()
          .map((c) => `[${c.ts}] ${c.summary}`)
          .join('\n');
        contextParts.push(`<recent_conversations>\n${convoText}\n</recent_conversations>`);
      }
    } catch { /* ignore */ }

    if (contextParts.length) {
      const contextMsg = `[System context — do not repeat this to the user]\n\n${contextParts.join('\n\n')}`;
      const config = this._threadConfig();
      try {
        await this.agent.invoke(
          { messages: [{ role: 'user', content: contextMsg }] },
          config,
        );
      } catch (e) {
        log(`Context injection failed (non-fatal): ${e.message}`);
      }
    }

    this.started = true;
    log(`Session started: ${this.threadId}`);
    return { sessionId: this.threadId };
  }

  async resumeHistoricalSession(sessionId) {
    const db = this._getDb();
    const historySession = dbGetSession(db, sessionId);
    if (!historySession) throw new Error(`Session ${sessionId} not found`);

    try { markActiveSessions(db, 'interrupted'); } catch { /* ignore */ }

    this.threadId = randomUUID();
    this.turnCount = 0;
    this.busy = false;
    this.conversationTopics = [];
    this._lastAssistantText = '';
    this._lastAssistantTools = [];
    this._rollingSummary = historySession.summary || '';
    this._toolContext.sessionId = this.threadId;
    this._resumedFromSession = sessionId;

    const { agent, recursionLimit } = createSupervisorAgent({
      appRoot: this.appRoot,
      getSandboxRoot: this.getSandboxRoot,
      getWorkspaceDirs: this.getWorkspaceDirs,
      getWorkspaceDirOrThrow: this.getWorkspaceDirOrThrow,
      syncStructureJson: this.syncStructureJson,
      readState: this.readState,
      toolContext: this._toolContext,
      getAutonomousMode: () => this.autonomousMode,
    });
    this.agent = agent;
    this.recursionLimit = recursionLimit;

    const contextParts = [];

    try {
      const { projectsRoot, casesRoot, studyRoot } = this.getWorkspaceDirs();
      const registry = buildProjectRegistry({
        projectsRoot,
        casesRoot,
        studyRoot,
        readState: this.readState,
      });
      if (registry.length) {
        const registryText = registry.map((p) =>
          `- ${p.name} (${p.domain}, ${p.status}, ~${p.fileCount} files)`,
        ).join('\n');
        contextParts.push(`<workspace_registry>\n${registryText}\n</workspace_registry>`);
      }
    } catch { /* ignore */ }

    if (historySession.summary) {
      contextParts.push(`<conversation_summary>\n${historySession.summary}\n</conversation_summary>`);
    }

    const historyMessages = dbListMessages(db, sessionId);
    if (historyMessages.length) {
      const recent = historyMessages.slice(-6).map((m) => {
        const role = m.role === 'user' ? '用户' : '助理';
        const content = (m.content || '').slice(0, 300);
        return `${role}: ${content}`;
      }).join('\n');
      contextParts.push(`<recent_messages>\n${recent}\n</recent_messages>`);
    }

    if (contextParts.length) {
      const contextMsg = `[System context — do not repeat this to the user]\n\n你正在继续一个之前的对话。以下是之前的上下文，请据此理解用户的意图，不要重复自我介绍。\n\n${contextParts.join('\n\n')}`;
      const config = this._threadConfig();
      try {
        await this.agent.invoke(
          { messages: [{ role: 'user', content: contextMsg }] },
          config,
        );
      } catch (e) {
        log(`Context injection failed (non-fatal): ${e.message}`);
      }
    }

    dbUpdateSession(db, sessionId, { status: 'active' });

    this.started = true;
    log(`Resumed historical session ${sessionId} → new thread ${this.threadId}`);
    return { sessionId: this.threadId, resumedFrom: sessionId };
  }

  async *sendMessage(userMessage) {
    if (!this.started) await this.startSession();
    if (this.busy) throw new Error('Supervisor is already processing a message.');

    this.busy = true;
    this.turnCount++;
    this._lastAssistantText = '';
    this._lastAssistantTools = [];

    this._persistUserMessage(userMessage);

    if (this._interrupted) {
      log('Session interrupted — cancelling pending interrupt before processing new message');
      await this._cancelInterruptAndRebuild(userMessage);
      this._interrupted = false;
    }

    await this._compressIfNeeded();

    try {
      yield* this._streamAgent({ messages: [{ role: 'user', content: userMessage }] });
    } finally {
      this.busy = false;
    }
  }

  async *resumeAfterApproval(executionResult) {
    if (!this.started || !this.agent) throw new Error('No active session to resume.');
    if (this.busy) throw new Error('Supervisor is already processing.');

    this.busy = true;
    this._interrupted = false;
    this._lastAssistantText = '';
    this._lastAssistantTools = [];

    try {
      yield* this._streamAgent(new Command({ resume: executionResult }));
    } finally {
      this.busy = false;
    }
  }

  async *_streamAgent(input) {
    const config = this._threadConfig();

    const stream = this.agent.streamEvents(input, {
      ...config,
      version: 'v2',
      streamMode: 'values',
    });

    let currentToolName = null;
    let textBuffer = '';
    const toolEvents = [];

    for await (const event of stream) {
      if (event.event === 'on_chat_model_stream') {
        const chunk = event.data?.chunk;
        if (chunk?.content && typeof chunk.content === 'string') {
          textBuffer += chunk.content;
          yield { type: 'token', content: chunk.content };
        }
      } else if (event.event === 'on_tool_start') {
        currentToolName = event.name || 'unknown';
        toolEvents.push({ name: currentToolName, args: event.data?.input || {} });
        yield { type: 'tool-start', name: currentToolName, args: event.data?.input || {} };
      } else if (event.event === 'on_tool_end') {
        const output = event.data?.output;
        let content = typeof output === 'string' ? output : (output?.content || JSON.stringify(output));
        const toolName = event.name || currentToolName || 'unknown';

        let undoActionId;
        try {
          const parsed = JSON.parse(content);
          if (parsed?._undoId) {
            undoActionId = parsed._undoId;
            content = parsed.message || content;
          }
        } catch { /* not JSON, keep as-is */ }

        const existing = toolEvents.find((t) => t.name === toolName && !t.result);
        if (existing) existing.result = content;
        const toolEndEvt = { type: 'tool-end', name: toolName, result: content };
        if (undoActionId) toolEndEvt.undoActionId = undoActionId;
        yield toolEndEvt;
        currentToolName = null;
      }
    }

    this._lastAssistantText = textBuffer;
    this._lastAssistantTools = toolEvents;

    const state = await this.agent.getState(config);
    const tasks = state?.tasks || [];
    const interruptData = tasks.find((t) => t.interrupts?.length)?.interrupts?.[0]?.value;

    if (interruptData && interruptData.requiresConfirmation) {
      this._interrupted = true;
      this._persistAssistantMessage(textBuffer, toolEvents);
      yield { type: 'interrupt', plan: interruptData };
    } else {
      this._interrupted = false;
      this._persistAssistantMessage(textBuffer, toolEvents);
      yield { type: 'done', turnCount: this.turnCount };
    }
  }

  get _dbSessionId() {
    return this._originalDbSessionId || this._resumedFromSession || this.threadId;
  }

  _persistUserMessage(content) {
    try {
      const db = this._getDb();
      const sid = this._dbSessionId;
      dbAppendMessage(db, { sessionId: sid, role: 'user', content });
      if (this.turnCount === 1 && !this._resumedFromSession) {
        dbUpdateSession(db, sid, { title: content.slice(0, 30) });
      }
      dbUpdateSession(db, sid, { messageCount: dbCountMessages(db, sid) });
    } catch (e) {
      log(`persistUserMessage failed: ${e.message}`);
    }
  }

  _persistAssistantMessage(text, tools) {
    if (!text && (!tools || !tools.length)) return;
    try {
      const db = this._getDb();
      const sid = this._dbSessionId;
      dbAppendMessage(db, {
        sessionId: sid,
        role: 'assistant',
        content: text,
        toolsJson: JSON.stringify(tools),
      });
      dbUpdateSession(db, sid, { messageCount: dbCountMessages(db, sid) });
    } catch (e) {
      log(`persistAssistantMessage failed: ${e.message}`);
    }
  }

  async _cancelInterruptAndRebuild(pendingUserMessage) {
    try {
      const oldConfig = this._threadConfig();
      let state;
      try { state = await this.agent.getState(oldConfig); } catch { state = null; }

      const contextParts = [];
      if (this._rollingSummary) {
        contextParts.push(`<conversation_summary>\n${this._rollingSummary}\n</conversation_summary>`);
      }

      if (state?.values?.messages) {
        const relevantMsgs = state.values.messages
          .filter((m) => {
            const content = typeof m.content === 'string' ? m.content : '';
            if (content.startsWith('[System context')) return false;
            const type = m._getType?.() || '';
            if (type === 'tool') return false;
            return true;
          })
          .slice(-6)
          .map((m) => {
            const type = m._getType?.() || '';
            const role = type === 'human' ? '用户' : '助理';
            let content = typeof m.content === 'string' ? m.content : '';
            if (m.tool_calls?.length) {
              const toolNames = m.tool_calls.map((tc) => tc.name).join(', ');
              content = content || `[调用了工具: ${toolNames}]`;
            }
            return `${role}: ${content.slice(0, 300)}`;
          });

        if (relevantMsgs.length) {
          contextParts.push(`<recent_messages>\n${relevantMsgs.join('\n')}\n</recent_messages>`);
        }
      }

      if (!this._originalDbSessionId) {
        this._originalDbSessionId = this._dbSessionId;
      }

      const { agent: newAgent, recursionLimit } = createSupervisorAgent({
        appRoot: this.appRoot,
        getSandboxRoot: this.getSandboxRoot,
        getWorkspaceDirs: this.getWorkspaceDirs,
        getWorkspaceDirOrThrow: this.getWorkspaceDirOrThrow,
        syncStructureJson: this.syncStructureJson,
        readState: this.readState,
        toolContext: this._toolContext,
        getAutonomousMode: () => this.autonomousMode,
      });

      const newThreadId = randomUUID();
      this.agent = newAgent;
      this.threadId = newThreadId;
      this._toolContext.sessionId = newThreadId;
      this.recursionLimit = recursionLimit;

      if (contextParts.length) {
        const contextMsg = `[System context — do not repeat this to the user]\n\n你之前有一个操作计划等待用户确认，但用户发送了新消息而不是批准/取消。请基于用户的新消息继续对话。\n\n${contextParts.join('\n\n')}`;
        const config = this._threadConfig();
        try {
          await this.agent.invoke(
            { messages: [{ role: 'user', content: contextMsg }] },
            config,
          );
        } catch (e) {
          log(`Interrupt rebuild context injection failed: ${e.message}`);
        }
      }

      log(`Interrupt cancelled, rebuilt agent with new thread: ${newThreadId}`);
    } catch (e) {
      log(`_cancelInterruptAndRebuild failed: ${e.message}`);
    }
  }

  async _compressIfNeeded() {
    if (this.turnCount <= 1) return;

    try {
      const config = this._threadConfig();
      const state = await this.agent.getState(config);
      const allMessages = state?.values?.messages || [];

      const userMessages = allMessages.filter((m) => {
        const content = typeof m.content === 'string' ? m.content : '';
        return !content.startsWith('[System context');
      });

      const totalTokens = estimateTokens(userMessages);
      if (totalTokens < TOKEN_COMPRESS_THRESHOLD) return;

      log(`Turn ${this.turnCount}: ~${totalTokens} tokens exceeds ${TOKEN_COMPRESS_THRESHOLD}, compressing...`);

      const recentMessages = userMessages.slice(-RECENT_TURNS_TO_KEEP);
      const evictedMessages = userMessages.slice(0, -RECENT_TURNS_TO_KEEP);

      if (evictedMessages.length > 0) {
        this._rollingSummary = await this._updateRollingSummary(evictedMessages);
      }

      const recentFormatted = [];
      for (const m of recentMessages) {
        const type = m._getType?.() || m.constructor?.name || '';
        if (type === 'tool' || type === 'ToolMessage') continue;

        const role = type === 'human' ? 'user' : 'assistant';
        let content = typeof m.content === 'string' ? m.content : '';

        if (m.tool_calls?.length) {
          const toolSummary = m.tool_calls.map((tc) => `${tc.name}(${JSON.stringify(tc.args || {}).slice(0, 100)})`).join(', ');
          content = content ? `${content}\n[之前调用了工具: ${toolSummary}]` : `[调用了工具: ${toolSummary}]`;
        }
        if (!content.trim()) continue;
        recentFormatted.push({ role, content });
      }

      if (!this._originalDbSessionId) {
        this._originalDbSessionId = this._dbSessionId;
      }

      const { agent: newAgent, recursionLimit } = createSupervisorAgent({
        appRoot: this.appRoot,
        getSandboxRoot: this.getSandboxRoot,
        getWorkspaceDirs: this.getWorkspaceDirs,
        getWorkspaceDirOrThrow: this.getWorkspaceDirOrThrow,
        syncStructureJson: this.syncStructureJson,
        readState: this.readState,
        toolContext: this._toolContext,
        getAutonomousMode: () => this.autonomousMode,
      });
      const newThreadId = randomUUID();
      this.agent = newAgent;
      this.threadId = newThreadId;
      this._toolContext.sessionId = newThreadId;
      this.recursionLimit = recursionLimit;

      const contextParts = [];
      if (this._rollingSummary) contextParts.push(`<conversation_summary>\n${this._rollingSummary}\n</conversation_summary>`);
      if (recentFormatted.length) {
        const recentText = recentFormatted.map((m) => `${m.role === 'user' ? '用户' : '助理'}: ${m.content.slice(0, 300)}`).join('\n');
        contextParts.push(`<recent_messages>\n${recentText}\n</recent_messages>`);
      }

      const injectionMsg = `[System context — do not repeat this to the user. Do NOT call any tools in response to this message. Simply acknowledge by saying "已恢复上下文" in one short sentence.]\n\n${contextParts.join('\n\n')}`;

      const newConfig = this._threadConfig();
      await this.agent.invoke({ messages: [{ role: 'user', content: injectionMsg }] }, newConfig);

      log(`Compressed. New thread: ${newThreadId}, rolling summary: ${this._rollingSummary.length} chars`);
    } catch (e) {
      log(`Compression failed (non-fatal): ${e.message}`);
    }
  }

  async _updateRollingSummary(evictedMessages) {
    const evictedText = evictedMessages
      .map((m) => {
        const role = m._getType?.() === 'human' ? '用户' : '助理';
        const content = typeof m.content === 'string' ? m.content.slice(0, 300) : '';
        return `${role}: ${content}`;
      })
      .join('\n');

    const prompt = this._rollingSummary
      ? `以下是之前的对话摘要和新淘汰的对话内容，请生成一个更新后的综合摘要（3-5句中文，保留关键操作和用户意图）：\n\n<旧摘要>\n${this._rollingSummary}\n</旧摘要>\n\n<新淘汰内容>\n${evictedText}\n</新淘汰内容>`
      : `请用3-5句中文总结以下对话的要点（关键操作、用户意图、结果）：\n\n${evictedText}`;

    try {
      const model = createSummaryModel();
      const response = await model.invoke([{ role: 'user', content: prompt }]);
      return typeof response.content === 'string' ? response.content : String(response.content);
    } catch {
      return this._rollingSummary || '对话涉及跨项目文件管理。';
    }
  }

  _threadConfig() {
    return { configurable: { thread_id: this.threadId }, recursionLimit: this.recursionLimit };
  }

  async endSession() {
    if (!this.started || !this.threadId) return { ok: true, reason: 'no_session' };

    log(`Ending session ${this.threadId}`);

    const db = this._getDb();
    const dbSid = this._dbSessionId;

    if (this.turnCount > 0) {
      try {
        const summaryText = await this._generateConversationSummary();

        appendConversation(db, {
          sessionId: dbSid,
          summary: summaryText,
          topics: this.conversationTopics,
        });
        trimConversations(db, MAX_CONVERSATIONS_KEEP);

        dbUpdateSession(db, dbSid, { status: 'ended', summary: summaryText });
        log(`Session summary saved`);
      } catch (e) {
        log(`Failed to save session summary: ${e.message}`);
      }
    } else {
      try { dbUpdateSession(db, dbSid, { status: 'ended' }); } catch { /* ignore */ }
    }

    this.agent = null;
    this.started = false;
    this.threadId = null;
    this.turnCount = 0;
    this.conversationTopics = [];
    this._lastAssistantText = '';
    this._lastAssistantTools = [];
    this._rollingSummary = '';
    this._resumedFromSession = null;
    this._originalDbSessionId = null;
    supervisorSession = null;

    return { ok: true };
  }

  async _generateConversationSummary() {
    if (this._rollingSummary) return this._rollingSummary;

    try {
      const state = await this.agent?.getState?.(this._threadConfig());
      const messages = state?.values?.messages || [];
      const turns = messages
        .filter((m) => {
          const content = typeof m.content === 'string' ? m.content : '';
          return !content.startsWith('[System context');
        })
        .slice(-20)
        .map((m) => {
          const role = m._getType?.() === 'human' ? '用户' : '助理';
          const content = typeof m.content === 'string' ? m.content.slice(0, 200) : '';
          return `${role}: ${content}`;
        })
        .join('\n');

      if (!turns) return '（空对话）';

      const model = createSummaryModel();
      const response = await model.invoke([{
        role: 'user',
        content: `请用1-3句中文总结以下对话的要点（关键操作、用户意图、结果）：\n\n${turns}`,
      }]);
      return typeof response.content === 'string' ? response.content : String(response.content);
    } catch {
      return `对话 ${this.turnCount} 轮，涉及跨项目文件管理。`;
    }
  }

  setAutonomousMode(enabled) {
    this.autonomousMode = Boolean(enabled);
    log(`Autonomous mode: ${this.autonomousMode ? 'ON' : 'OFF'}`);
  }

  getInfo() {
    return {
      sessionId: this.threadId,
      started: this.started,
      busy: this.busy,
      turnCount: this.turnCount,
      autonomousMode: this.autonomousMode,
      promptVersion: SUPERVISOR_PROMPT_VERSION,
    };
  }
}

function estimateTokens(messages) {
  let total = 0;
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : '';
    for (const ch of text) {
      total += ch.charCodeAt(0) > 127 ? 1.5 : 0.25;
    }
    total += 4;
  }
  return Math.ceil(total);
}

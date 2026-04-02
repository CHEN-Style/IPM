import { randomUUID } from 'node:crypto';
import { Command } from '@langchain/langgraph';
import { createProjectAgent } from './createProjectAgent.js';
import { readProjectSummary, hasSummary, performFirstEncounter, lightUpdateSummary } from './memory.js';
import { PROJECT_AGENT_PROMPT_VERSION } from './prompts.js';
import { createChatModel, createSummaryModel } from '../services/llm.js';
import { getProjectDb } from '../db/index.js';
import { appendConversation, listConversations, trimConversations } from '../db/conversations.js';
import { createSession as dbCreateSession, updateSession as dbUpdateSession, markActiveSessions, getSessionById as dbGetSession } from '../db/chatSessions.js';
import { appendMessage as dbAppendMessage, countMessages as dbCountMessages, listMessages as dbListMessages } from '../db/chatMessages.js';

const log = (msg) => console.log(`[IPM][ProjectAgent] ${msg}`);

const MAX_CONVERSATIONS_KEEP = 20;
const TOKEN_COMPRESS_THRESHOLD = 3000;
const RECENT_TURNS_TO_KEEP = 4;

const sessionCache = new Map();

export function getOrCreateSession(projectDir, projectName, domain) {
  if (sessionCache.has(projectDir)) return sessionCache.get(projectDir);
  const session = new ProjectAgentSession(projectDir, projectName, domain);
  sessionCache.set(projectDir, session);
  return session;
}

export function getSession(projectDir) {
  return sessionCache.get(projectDir) || null;
}

export function removeSession(projectDir) {
  sessionCache.delete(projectDir);
}

export class ProjectAgentSession {
  constructor(projectDir, projectName, domain) {
    this.projectDir = projectDir;
    this.projectName = projectName;
    this.domain = domain;
    this.threadId = null;
    this.agent = null;
    this.recursionLimit = 30;
    this.started = false;
    this.busy = false;
    this.turnCount = 0;
    this.conversationTopics = [];
    this._lastAssistantText = '';
    this._lastAssistantTools = [];
    this._toolContext = { sessionId: null };
    this._rollingSummary = '';
    this._originalDbSessionId = null;
  }

  async startSession() {
    this.threadId = randomUUID();
    this.turnCount = 0;
    this.busy = false;
    this.conversationTopics = [];
    this._lastAssistantText = '';
    this._lastAssistantTools = [];
    this._toolContext.sessionId = this.threadId;

    const db = getProjectDb(this.projectDir);
    try { markActiveSessions(db, 'interrupted'); } catch { /* ignore */ }
    try { dbCreateSession(db, { id: this.threadId }); } catch (e) { log(`DB createSession failed: ${e.message}`); }

    if (!hasSummary(this.projectDir)) {
      log(`首次认识项目 ${this.projectName}，开始扫描...`);
      try {
        await performFirstEncounter(this.projectDir, this.projectName);
        log(`项目扫描完成: ${this.projectName}`);
      } catch (e) {
        log(`项目扫描失败: ${e.message}`);
      }
    }

    const { agent, recursionLimit } = createProjectAgent(
      this.projectDir, this.projectName, this.domain,
      { toolContext: this._toolContext },
    );
    this.agent = agent;
    this.recursionLimit = recursionLimit;

    const contextParts = [];

    const summary = readProjectSummary(this.projectDir);
    if (summary) {
      contextParts.push(`<project_summary>\n${summary}\n</project_summary>`);
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
    log(`Session started: ${this.threadId} for ${this.projectName}`);
    return { sessionId: this.threadId };
  }

  async resumeHistoricalSession(sessionId) {
    const db = getProjectDb(this.projectDir);
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

    const { agent, recursionLimit } = createProjectAgent(
      this.projectDir, this.projectName, this.domain,
      { toolContext: this._toolContext },
    );
    this.agent = agent;
    this.recursionLimit = recursionLimit;

    const contextParts = [];

    const projectSummary = readProjectSummary(this.projectDir);
    if (projectSummary) {
      contextParts.push(`<project_summary>\n${projectSummary}\n</project_summary>`);
    }

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
    log(`Resumed historical session ${sessionId} → new thread ${this.threadId} for ${this.projectName}`);
    return { sessionId: this.threadId, resumedFrom: sessionId };
  }

  async *sendMessage(userMessage) {
    if (!this.started) await this.startSession();
    if (this.busy) throw new Error('Agent is already processing a message.');

    this.busy = true;
    this.turnCount++;
    this._lastAssistantText = '';
    this._lastAssistantTools = [];

    this._persistUserMessage(userMessage);

    await this._compressIfNeeded();

    try {
      yield* this._streamAgent({ messages: [{ role: 'user', content: userMessage }] });
    } finally {
      this.busy = false;
    }
  }

  async *resumeAfterApproval(executionResult) {
    if (!this.started || !this.agent) throw new Error('No active session to resume.');
    if (this.busy) throw new Error('Agent is already processing.');

    this.busy = true;
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
      this._persistAssistantMessage(textBuffer, toolEvents);
      yield { type: 'interrupt', plan: interruptData };
    } else {
      this._persistAssistantMessage(textBuffer, toolEvents);
      yield { type: 'done', turnCount: this.turnCount };
    }
  }

  get _dbSessionId() {
    return this._originalDbSessionId || this._resumedFromSession || this.threadId;
  }

  _persistUserMessage(content) {
    try {
      const db = getProjectDb(this.projectDir);
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
      const db = getProjectDb(this.projectDir);
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

      const { agent: newAgent, recursionLimit } = createProjectAgent(
        this.projectDir, this.projectName, this.domain,
        { toolContext: this._toolContext },
      );
      const newThreadId = randomUUID();
      this.agent = newAgent;
      this.threadId = newThreadId;
      this._toolContext.sessionId = newThreadId;
      this.recursionLimit = recursionLimit;

      const contextParts = [];
      const projectSummary = readProjectSummary(this.projectDir);
      if (projectSummary) contextParts.push(`<project_summary>\n${projectSummary}\n</project_summary>`);
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
      return this._rollingSummary || `对话涉及 ${this.projectName} 项目文件管理。`;
    }
  }

  _threadConfig() {
    return { configurable: { thread_id: this.threadId }, recursionLimit: this.recursionLimit };
  }

  async endSession() {
    if (!this.started || !this.threadId) return { ok: true, reason: 'no_session' };

    log(`Ending session ${this.threadId} for ${this.projectName}`);

    const db = getProjectDb(this.projectDir);

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

        await lightUpdateSummary(this.projectDir, summaryText);
        log(`Session summary saved for ${this.projectName}`);
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
    sessionCache.delete(this.projectDir);

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
      return `对话 ${this.turnCount} 轮，涉及 ${this.projectName} 项目文件管理。`;
    }
  }

  getInfo() {
    return {
      sessionId: this.threadId,
      projectName: this.projectName,
      domain: this.domain,
      started: this.started,
      busy: this.busy,
      turnCount: this.turnCount,
      promptVersion: PROJECT_AGENT_PROMPT_VERSION,
    };
  }
}

/**
 * Rough token estimation for mixed Chinese/English text.
 * Chinese chars ≈ 1.5 tokens, ASCII ≈ 0.25 tokens per char.
 */
function estimateTokens(messages) {
  let total = 0;
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : '';
    for (const ch of text) {
      total += ch.charCodeAt(0) > 127 ? 1.5 : 0.25;
    }
    total += 4; // per-message overhead (role, separators)
  }
  return Math.ceil(total);
}

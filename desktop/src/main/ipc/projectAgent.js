import { getOrCreateSession, getSession, removeSession } from '../../../Agent/project-agent/session.js';
import { getProjectDb } from '../../../Agent/db/index.js';
import { listSessions as dbListSessions, getSessionById, deleteSession as dbDeleteSession } from '../../../Agent/db/chatSessions.js';
import { listMessages as dbListMessages } from '../../../Agent/db/chatMessages.js';
import { getLogById } from '../../../Agent/db/activityLog.js';
import { undoAction } from '../../../Agent/project-agent/undoExecutor.js';

export function registerProjectAgentIpc({ ipcMain, getWorkspaceDirOrThrow, syncStructureJson }) {
  if (!ipcMain) throw new Error('registerProjectAgentIpc: ipcMain is required');

  ipcMain.handle('projectAgent/sendMessage', async (evt, payload) => {
    const { projectName, domain, message } = payload || {};
    if (!projectName || !message) return { ok: false, error: 'Missing projectName or message' };

    const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);
    const session = getOrCreateSession(projectDir, projectName, domain);

    try {
      await streamSessionEvents(session.sendMessage(message), evt.sender, session);
      trySyncStructure(syncStructureJson, projectDir, projectName);
      return { ok: true, sessionId: session.threadId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('projectAgent/executePlan', async (evt, payload) => {
    const { projectName, domain, plan, selectedIds } = payload || {};
    if (!projectName || !plan) return { ok: false, error: 'Missing projectName or plan' };

    const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);
    const session = getSession(projectDir);
    if (!session) return { ok: false, error: 'No active session' };

    try {
      const resumeValue = { approved: true, selectedIds: selectedIds || [] };
      await streamSessionEvents(session.resumeAfterApproval(resumeValue), evt.sender, session);
      trySyncStructure(syncStructureJson, projectDir, projectName);
      return { ok: true, sessionId: session.threadId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('projectAgent/cancelPlan', async (evt, payload) => {
    const { projectName, domain } = payload || {};
    if (!projectName) return { ok: false, error: 'Missing projectName' };

    const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);
    const session = getSession(projectDir);
    if (!session) return { ok: false, error: 'No active session' };

    try {
      await streamSessionEvents(
        session.resumeAfterApproval({ cancelled: true }),
        evt.sender,
        session,
      );
      return { ok: true, sessionId: session.threadId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('projectAgent/endSession', async (_evt, payload) => {
    const { projectName, domain } = payload || {};
    if (!projectName) return { ok: false, error: 'Missing projectName' };

    const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);
    const session = getSession(projectDir);

    if (!session) return { ok: true, reason: 'no_session' };

    try {
      const result = await session.endSession();
      return { ok: true, ...result };
    } catch (e) {
      removeSession(projectDir);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('projectAgent/getSessionInfo', async (_evt, payload) => {
    const { projectName, domain } = payload || {};
    if (!projectName) return { ok: false, error: 'Missing projectName' };

    const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);
    const session = getSession(projectDir);

    if (!session) return { ok: true, active: false };
    return { ok: true, active: true, ...session.getInfo() };
  });

  ipcMain.handle('projectAgent/resumeSession', async (evt, payload) => {
    const { projectName, domain, sessionId } = payload || {};
    if (!projectName || !sessionId) return { ok: false, error: 'Missing projectName or sessionId' };

    const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);

    const existingSession = getSession(projectDir);
    if (existingSession?.started) {
      try { await existingSession.endSession(); } catch { /* ignore */ }
    }

    const session = getOrCreateSession(projectDir, projectName, domain);

    try {
      const result = await session.resumeHistoricalSession(sessionId);
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('projectAgent/listSessions', async (_evt, payload) => {
    const { projectName, domain, limit, offset } = payload || {};
    if (!projectName) return { ok: false, error: 'Missing projectName' };

    try {
      const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);
      const db = getProjectDb(projectDir);
      const sessions = dbListSessions(db, { limit, offset });
      return { ok: true, sessions };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('projectAgent/loadSession', async (_evt, payload) => {
    const { projectName, domain, sessionId } = payload || {};
    if (!projectName || !sessionId) return { ok: false, error: 'Missing projectName or sessionId' };

    try {
      const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);
      const db = getProjectDb(projectDir);
      const session = getSessionById(db, sessionId);
      if (!session) return { ok: false, error: 'Session not found' };
      const messages = dbListMessages(db, sessionId);
      return { ok: true, session, messages };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('projectAgent/deleteSession', async (_evt, payload) => {
    const { projectName, domain, sessionId } = payload || {};
    if (!projectName || !sessionId) return { ok: false, error: 'Missing projectName or sessionId' };

    try {
      const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);
      const db = getProjectDb(projectDir);
      dbDeleteSession(db, sessionId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('projectAgent/undoAction', async (_evt, payload) => {
    const { projectName, domain, actionId } = payload || {};
    if (!projectName || !actionId) return { ok: false, error: 'Missing projectName or actionId' };

    try {
      const { projectDir } = getWorkspaceDirOrThrow(projectName, domain);
      const db = getProjectDb(projectDir);
      const logEntry = getLogById(db, Number(actionId));
      if (!logEntry) return { ok: false, error: '找不到操作记录' };
      if (logEntry.isUndone) return { ok: false, error: '操作已被撤销' };

      const result = undoAction(projectDir, logEntry, db);
      if (result.ok) {
        trySyncStructure(syncStructureJson, projectDir, projectName);
      }
      return result;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

async function streamSessionEvents(generator, sender, session) {
  for await (const event of generator) {
    try {
      sender.send('projectAgent:stream-event', {
        sessionId: session.threadId,
        ...event,
      });
    } catch {
      break;
    }
  }
}

function trySyncStructure(syncStructureJson, projectDir, projectName) {
  if (typeof syncStructureJson === 'function') {
    try { syncStructureJson(projectDir, projectName); } catch { /* best effort */ }
  }
}

import { getOrCreateSupervisorSession, getSupervisorSession, removeSupervisorSession } from '../../../Agent/supervisor/session.js';
import {
  getSupervisorDb, listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
  listCandidates, setCandidateStatus, getLastAnalysisTime, updateAnalysisTime, addCandidate, addNotification,
  listSkillExecutions,
} from '../../../Agent/db/supervisorDb.js';
import { listSessions as dbListSessions, getSessionById, deleteSession as dbDeleteSession } from '../../../Agent/db/chatSessions.js';
import { listMessages as dbListMessages } from '../../../Agent/db/chatMessages.js';
import { addPreference } from '../../../Agent/storage/preferences.js';
import { buildProjectRegistry, invalidateRegistryCache } from '../../../Agent/supervisor/projectRegistry.js';
import { getProjectDb } from '../../../Agent/db/index.js';
import { extractPreferenceCandidates } from '../../../Agent/supervisor/preferenceExtractor.js';
import { listSkills, getSkill, setSkillMaturity, deleteSkill } from '../../../Agent/supervisor/skills/skillStore.js';

const ANALYSIS_INTERVAL_DAYS = 7;
const MIN_NEW_ACCEPTED = 20;

let sessionRejectedExtraction = false;

export function registerSupervisorIpc({ ipcMain, getAppRoot, getSandboxRoot, getWorkspaceDirs, getWorkspaceDirOrThrow, syncStructureJson, readState }) {
  if (!ipcMain) throw new Error('registerSupervisorIpc: ipcMain is required');

  const sessionDeps = () => ({
    appRoot: getAppRoot(),
    getSandboxRoot,
    getWorkspaceDirs,
    getWorkspaceDirOrThrow,
    syncStructureJson,
    readState,
  });

  ipcMain.handle('supervisor/sendMessage', async (evt, payload) => {
    const { message } = payload || {};
    if (!message) return { ok: false, error: 'Missing message' };

    const session = getOrCreateSupervisorSession(sessionDeps());

    try {
      await streamSessionEvents(session.sendMessage(message), evt.sender, session);
      return { ok: true, sessionId: session.threadId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/executePlan', async (evt, payload) => {
    const { plan, selectedIds } = payload || {};
    if (!plan) return { ok: false, error: 'Missing plan' };

    const session = getSupervisorSession();
    if (!session) return { ok: false, error: 'No active session' };

    try {
      const resumeValue = { approved: true, selectedIds: selectedIds || [] };
      await streamSessionEvents(session.resumeAfterApproval(resumeValue), evt.sender, session);
      return { ok: true, sessionId: session.threadId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/cancelPlan', async (evt) => {
    const session = getSupervisorSession();
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

  ipcMain.handle('supervisor/endSession', async () => {
    const session = getSupervisorSession();
    if (!session) return { ok: true, reason: 'no_session' };

    try {
      const result = await session.endSession();
      return { ok: true, ...result };
    } catch (e) {
      removeSupervisorSession();
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/getSessionInfo', async () => {
    const session = getSupervisorSession();
    if (!session) return { ok: true, active: false };
    return { ok: true, active: true, ...session.getInfo() };
  });

  ipcMain.handle('supervisor/resumeSession', async (evt, payload) => {
    const { sessionId } = payload || {};
    if (!sessionId) return { ok: false, error: 'Missing sessionId' };

    const existingSession = getSupervisorSession();
    if (existingSession?.started) {
      try { await existingSession.endSession(); } catch { /* ignore */ }
    }

    const session = getOrCreateSupervisorSession(sessionDeps());

    try {
      const result = await session.resumeHistoricalSession(sessionId);
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/listSessions', async (_evt, payload) => {
    const { limit, offset } = payload || {};
    try {
      const db = getSupervisorDb(getAppRoot());
      const sessions = dbListSessions(db, { limit, offset });
      return { ok: true, sessions };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/loadSession', async (_evt, payload) => {
    const { sessionId } = payload || {};
    if (!sessionId) return { ok: false, error: 'Missing sessionId' };

    try {
      const db = getSupervisorDb(getAppRoot());
      const session = getSessionById(db, sessionId);
      if (!session) return { ok: false, error: 'Session not found' };
      const messages = dbListMessages(db, sessionId);
      return { ok: true, session, messages };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/deleteSession', async (_evt, payload) => {
    const { sessionId } = payload || {};
    if (!sessionId) return { ok: false, error: 'Missing sessionId' };

    try {
      const db = getSupervisorDb(getAppRoot());
      dbDeleteSession(db, sessionId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/setAutonomousMode', async (_evt, payload) => {
    const { enabled } = payload || {};
    const session = getSupervisorSession();
    if (session) {
      session.setAutonomousMode(Boolean(enabled));
    }
    return { ok: true, autonomousMode: Boolean(enabled) };
  });

  ipcMain.handle('supervisor/getNotifications', async (_evt, payload) => {
    const { onlyUnread, limit } = payload || {};
    try {
      const db = getSupervisorDb(getAppRoot());
      const notifications = listNotifications(db, { onlyUnread, limit });
      const unreadCount = getUnreadCount(db);
      return { ok: true, notifications, unreadCount };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/markNotificationRead', async (_evt, payload) => {
    const { id, all } = payload || {};
    try {
      const db = getSupervisorDb(getAppRoot());
      if (all) {
        markAllNotificationsRead(db);
      } else if (id) {
        markNotificationRead(db, id);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Preference Candidates ──

  ipcMain.handle('supervisor/listPreferenceCandidates', async (_evt, payload) => {
    const { status, projectName } = payload || {};
    try {
      const db = getSupervisorDb(getAppRoot());
      const candidates = listCandidates(db, { status: status || 'pending', projectName });
      return { ok: true, candidates };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/acceptPreferenceCandidate', async (_evt, payload) => {
    const { id } = payload || {};
    if (!id) return { ok: false, error: 'Missing id' };

    try {
      const db = getSupervisorDb(getAppRoot());
      const [candidate] = listCandidates(db, { status: 'pending' }).filter((c) => c.id === id);
      if (!candidate) return { ok: false, error: 'Candidate not found or already resolved' };

      const pref = addPreference(candidate.projectDir, {
        pattern: candidate.pattern,
        conditions: candidate.conditions,
        tendency: {
          folder: candidate.targetFolder,
          strength: candidate.suggestedStrength,
        },
        source: 'auto_learned',
      });

      setCandidateStatus(db, id, 'accepted');
      return { ok: true, preference: pref };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/dismissPreferenceCandidate', async (_evt, payload) => {
    const { id } = payload || {};
    if (!id) return { ok: false, error: 'Missing id' };

    try {
      const db = getSupervisorDb(getAppRoot());
      setCandidateStatus(db, id, 'dismissed');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Preference Extraction (user-initiated on app open) ──

  ipcMain.handle('supervisor/checkPreferenceExtraction', async () => {
    if (sessionRejectedExtraction) return { ok: true, needed: false, reason: 'rejected_this_session' };

    try {
      const db = getSupervisorDb(getAppRoot());
      const dirs = getWorkspaceDirs();
      invalidateRegistryCache();
      const registry = buildProjectRegistry({ ...dirs, readState });

      const qualifying = [];
      for (const p of registry) {
        try {
          const lastAnalysis = getLastAnalysisTime(db, p.name);
          const daysSince = lastAnalysis
            ? (Date.now() - new Date(lastAnalysis).getTime()) / 86400000
            : Infinity;
          if (daysSince < ANALYSIS_INTERVAL_DAYS) continue;

          const pdb = getProjectDb(p.path);
          const sinceTs = lastAnalysis || new Date(0).toISOString();
          const row = pdb.prepare(
            "SELECT COUNT(*) as cnt FROM events WHERE event = 'classify.accepted' AND ts > ?",
          ).get(sinceTs);
          const newAccepted = row?.cnt || 0;
          if (newAccepted < MIN_NEW_ACCEPTED) continue;

          qualifying.push({
            name: p.name,
            domain: p.domain,
            path: p.path,
            newAccepted,
            daysSince: Math.floor(daysSince),
          });
        } catch { /* skip project */ }
      }

      if (!qualifying.length) return { ok: true, needed: false };

      const totalEvents = qualifying.reduce((s, p) => s + p.newAccepted, 0);
      return {
        ok: true,
        needed: true,
        projects: qualifying.map((p) => ({ name: p.name, domain: p.domain, newAccepted: p.newAccepted, daysSince: p.daysSince })),
        totalEvents,
        summary: `${qualifying.length} 个项目共积累了 ${totalEvents} 条新的分类记录，可以进行一次模式学习。`,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/runPreferenceExtraction', async () => {
    try {
      const db = getSupervisorDb(getAppRoot());
      const dirs = getWorkspaceDirs();
      invalidateRegistryCache();
      const registry = buildProjectRegistry({ ...dirs, readState });

      let totalCandidates = 0;

      for (const p of registry) {
        try {
          const lastAnalysis = getLastAnalysisTime(db, p.name);
          const daysSince = lastAnalysis
            ? (Date.now() - new Date(lastAnalysis).getTime()) / 86400000
            : Infinity;
          if (daysSince < ANALYSIS_INTERVAL_DAYS) continue;

          const pdb = getProjectDb(p.path);
          const sinceTs = lastAnalysis || new Date(0).toISOString();
          const row = pdb.prepare(
            "SELECT COUNT(*) as cnt FROM events WHERE event = 'classify.accepted' AND ts > ?",
          ).get(sinceTs);
          const newAccepted = row?.cnt || 0;
          if (newAccepted < MIN_NEW_ACCEPTED) continue;

          const candidates = await extractPreferenceCandidates(p.path, p.name, p.domain);

          if (candidates.length > 0) {
            for (const c of candidates) {
              try { addCandidate(db, c); } catch { /* ignore */ }
            }
            totalCandidates += candidates.length;
            try {
              addNotification(db, {
                type: 'info',
                title: `${p.name} 发现 ${candidates.length} 条新的分类模式`,
                content: `系统从最近的分类记录中学习到了新的文件归档规律，请在「学习」面板中查看并确认。`,
                projectName: p.name,
              });
            } catch { /* ignore */ }
          }

          updateAnalysisTime(db, p.name, newAccepted);
        } catch (e) {
          console.error(`[IPM][PreferenceExtraction] Failed for ${p.name}:`, e.message);
        }
      }

      return { ok: true, totalCandidates };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/rejectPreferenceExtraction', async () => {
    sessionRejectedExtraction = true;
    return { ok: true };
  });

  // ── Skill Management ──

  ipcMain.handle('supervisor/listSkills', async () => {
    try {
      const sandboxRoot = getSandboxRoot();
      const skills = listSkills(sandboxRoot);
      return { ok: true, skills };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/getSkill', async (_evt, payload) => {
    const { skillName } = payload || {};
    if (!skillName) return { ok: false, error: 'Missing skillName' };
    try {
      const sandboxRoot = getSandboxRoot();
      const skill = getSkill(sandboxRoot, skillName);
      return { ok: true, skill: { meta: skill.meta, instructions: skill.instructions, scripts: skill.scripts, references: skill.references, dirName: skill.dirName } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/setSkillMaturity', async (_evt, payload) => {
    const { skillName, maturity } = payload || {};
    if (!skillName || !maturity) return { ok: false, error: 'Missing skillName or maturity' };
    try {
      const sandboxRoot = getSandboxRoot();
      setSkillMaturity(sandboxRoot, skillName, maturity);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/deleteSkill', async (_evt, payload) => {
    const { skillName } = payload || {};
    if (!skillName) return { ok: false, error: 'Missing skillName' };
    try {
      const sandboxRoot = getSandboxRoot();
      deleteSkill(sandboxRoot, skillName);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('supervisor/listSkillExecutions', async (_evt, payload) => {
    const { skillName, status, limit, offset } = payload || {};
    try {
      const db = getSupervisorDb(getAppRoot());
      const executions = listSkillExecutions(db, { skillName, status, limit, offset });
      return { ok: true, executions };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

async function streamSessionEvents(generator, sender, session) {
  try {
    for await (const event of generator) {
      try {
        sender.send('supervisor:stream-event', {
          sessionId: session.threadId,
          ...event,
        });
      } catch {
        break;
      }
    }
  } catch (e) {
    try {
      sender.send('supervisor:stream-event', {
        sessionId: session.threadId,
        type: 'error',
        error: e.message || 'Unknown stream error',
      });
    } catch { /* sender destroyed */ }
    throw e;
  }
}

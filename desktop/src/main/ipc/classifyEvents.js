import {
  readClassifyEvents,
  updateEventFeedback,
} from '../../../Agent/storage/classifyEvents.js';

export function registerClassifyEventsIpc({ ipcMain, getWorkspaceDirOrThrow }) {
  if (!ipcMain) throw new Error('registerClassifyEventsIpc: ipcMain is required');

  ipcMain.handle('classifyEvents/list', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const result = readClassifyEvents(projectDir, {
      eventType: payload?.eventType,
      search: payload?.search,
      limit: payload?.limit,
      offset: payload?.offset,
    });
    return { ok: true, ...result };
  });

  ipcMain.handle('classifyEvents/updateFeedback', async (_evt, payload) => {
    const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
    const eventId = payload?.eventId;
    const feedback = payload?.feedback;
    if (!eventId) throw new Error('eventId 不能为空');
    updateEventFeedback(projectDir, eventId, feedback);
    return { ok: true };
  });
}

import { getProjectDb } from '../db/index.js';
import { appendEvent, listEvents, updateEventFeedback as dbUpdateFeedback } from '../db/events.js';
import { getSourceInfo } from '../db/sourceRecords.js';

export function appendClassifyEvent(projectDir, eventData) {
  const db = getProjectDb(projectDir);
  return appendEvent(db, eventData);
}

export function readClassifyEvents(projectDir, opts = {}) {
  const db = getProjectDb(projectDir);
  return listEvents(db, opts);
}

export function updateEventFeedback(projectDir, eventId, feedback) {
  const db = getProjectDb(projectDir);
  return dbUpdateFeedback(db, eventId, feedback);
}

export function lookupSourceInfo(projectDir, sourceRelPath) {
  try {
    const db = getProjectDb(projectDir);
    return getSourceInfo(db, sourceRelPath);
  } catch {
    return null;
  }
}

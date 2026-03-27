import { getProjectDb } from '../db/index.js';
import {
  upsertSuggestion,
  listSuggestions,
  getSuggestionByRelPath,
  setSuggestionStatus,
} from '../db/suggestions.js';

export const AI_STORAGE_SCHEMA_VERSION = 1;

export function readAiStorage(projectDir, projectName) {
  const db = getProjectDb(projectDir);
  const suggestions = listSuggestions(db);
  const now = new Date().toISOString();
  return {
    schemaVersion: AI_STORAGE_SCHEMA_VERSION,
    projectName: projectName || '',
    updatedAt: now,
    suggestions,
  };
}

export function upsertAiSuggestion(projectDir, projectName, suggestion) {
  const db = getProjectDb(projectDir);
  return upsertSuggestion(db, suggestion);
}

export function listAiSuggestions(projectDir, projectName, opts = {}) {
  const db = getProjectDb(projectDir);
  return listSuggestions(db, {
    status: opts?.status || '',
    folderRelPath: opts?.folderRelPath || '',
  });
}

export function setAiSuggestionStatus(projectDir, projectName, sourceRelPath, patch = {}) {
  const db = getProjectDb(projectDir);
  return setSuggestionStatus(db, sourceRelPath, patch);
}

import fs from 'node:fs';
import path from 'node:path';

export const AI_STORAGE_SCHEMA_VERSION = 1;

export function getAiStoragePath(projectDir) {
  return path.join(projectDir, 'meta', 'ai-storage.json');
}

export function readAiStorage(projectDir, projectName) {
  const p = getAiStoragePath(projectDir);
  if (!fs.existsSync(p)) {
    const now = new Date().toISOString();
    return { schemaVersion: AI_STORAGE_SCHEMA_VERSION, projectName, updatedAt: now, suggestions: [] };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8'));
    doc.schemaVersion = doc.schemaVersion || AI_STORAGE_SCHEMA_VERSION;
    doc.projectName = doc.projectName || projectName;
    doc.suggestions = Array.isArray(doc.suggestions) ? doc.suggestions : [];
    return doc;
  } catch {
    const now = new Date().toISOString();
    return { schemaVersion: AI_STORAGE_SCHEMA_VERSION, projectName, updatedAt: now, suggestions: [] };
  }
}

export function atomicWriteJson(filePath, doc) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function upsertAiSuggestion(projectDir, projectName, suggestion) {
  const p = getAiStoragePath(projectDir);
  const doc = readAiStorage(projectDir, projectName);
  const now = new Date().toISOString();
  doc.updatedAt = now;
  const idx = doc.suggestions.findIndex((s) => String(s?.sourceRelPath) === String(suggestion.sourceRelPath));
  const next = {
    ...suggestion,
    status: suggestion.status || 'pending',
    updatedAt: now,
    createdAt: suggestion.createdAt || now,
  };
  if (idx >= 0) {
    const prev = doc.suggestions[idx] || {};
    doc.suggestions[idx] = { ...prev, ...next, createdAt: prev.createdAt || next.createdAt };
  } else {
    doc.suggestions.unshift(next);
  }
  atomicWriteJson(p, doc);
  return next;
}

export function listAiSuggestions(projectDir, projectName, opts = {}) {
  const doc = readAiStorage(projectDir, projectName);
  const status = opts?.status ? String(opts.status) : '';
  const folderRelPath = opts?.folderRelPath ? String(opts.folderRelPath) : '';
  const items = Array.isArray(doc.suggestions) ? doc.suggestions : [];
  return items.filter((s) => {
    if (status && String(s?.status) !== status) return false;
    if (folderRelPath && String(s?.suggestedFolderRelPath) !== folderRelPath) return false;
    return true;
  });
}

export function setAiSuggestionStatus(projectDir, projectName, sourceRelPath, patch = {}) {
  const p = getAiStoragePath(projectDir);
  const doc = readAiStorage(projectDir, projectName);
  const now = new Date().toISOString();
  doc.updatedAt = now;
  const idx = doc.suggestions.findIndex((s) => String(s?.sourceRelPath) === String(sourceRelPath));
  if (idx < 0) return null;
  const prev = doc.suggestions[idx] || {};
  doc.suggestions[idx] = { ...prev, ...patch, sourceRelPath: String(sourceRelPath), updatedAt: now };
  atomicWriteJson(p, doc);
  return doc.suggestions[idx];
}



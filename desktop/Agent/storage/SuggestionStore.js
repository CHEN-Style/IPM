import {
  readAiStorage,
  upsertAiSuggestion,
  listAiSuggestions,
  setAiSuggestionStatus,
} from './aiStorage.js';

const DEFAULTS = {
  confidence: 0,
  classifiedBy: '',
};

function withDefaults(suggestion) {
  return {
    ...DEFAULTS,
    ...suggestion,
  };
}

function normalizeItem(item) {
  if (!item) return item;
  return {
    ...DEFAULTS,
    ...item,
  };
}

export class SuggestionStore {
  #projectDir;
  #projectName;

  constructor(projectDir, projectName) {
    if (!projectDir) throw new Error('SuggestionStore: projectDir is required');
    if (!projectName) throw new Error('SuggestionStore: projectName is required');
    this.#projectDir = projectDir;
    this.#projectName = projectName;
  }

  list(opts = {}) {
    const raw = listAiSuggestions(this.#projectDir, this.#projectName, {
      status: opts.status || '',
      folderRelPath: opts.folder || '',
    });
    return raw.map(normalizeItem);
  }

  upsert(suggestion) {
    const enriched = withDefaults(suggestion);
    const written = upsertAiSuggestion(this.#projectDir, this.#projectName, enriched);
    return normalizeItem(written);
  }

  setStatus(sourceRelPath, patch) {
    const updated = setAiSuggestionStatus(
      this.#projectDir,
      this.#projectName,
      sourceRelPath,
      patch,
    );
    return normalizeItem(updated);
  }

  findPending() {
    return this.list({ status: 'pending' });
  }

  read() {
    const doc = readAiStorage(this.#projectDir, this.#projectName);
    doc.suggestions = (doc.suggestions || []).map(normalizeItem);
    return doc;
  }
}

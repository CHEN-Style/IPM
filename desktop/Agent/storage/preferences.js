import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = 1;

export function getPreferencesPath(projectDir) {
  return path.join(projectDir, 'meta', 'preferences.json');
}

function readDoc(projectDir) {
  const p = getPreferencesPath(projectDir);
  if (!fs.existsSync(p)) return { schemaVersion: SCHEMA_VERSION, preferences: [] };
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8'));
    doc.schemaVersion = doc.schemaVersion || SCHEMA_VERSION;
    doc.preferences = Array.isArray(doc.preferences) ? doc.preferences : [];
    return doc;
  } catch {
    return { schemaVersion: SCHEMA_VERSION, preferences: [] };
  }
}

function writeDoc(projectDir, doc) {
  const p = getPreferencesPath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

let _counter = 0;
function genId() {
  return `pref_${Date.now().toString(36)}_${(++_counter).toString(36)}`;
}

function normalizeConditions(c) {
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  return {
    nameIncludes: arr(c?.nameIncludes),
    nameExcludes: arr(c?.nameExcludes),
    exts: arr(c?.exts).map((e) => e.toLowerCase().replace(/^\./, '')),
    sourceIncludes: arr(c?.sourceIncludes),
    sourceExcludes: arr(c?.sourceExcludes),
  };
}

export function readPreferences(projectDir) {
  return readDoc(projectDir).preferences;
}

export function addPreference(projectDir, pref) {
  const doc = readDoc(projectDir);
  const now = new Date().toISOString();
  const entry = {
    id: genId(),
    pattern: String(pref.pattern || ''),
    conditions: normalizeConditions(pref.conditions),
    tendency: {
      folder: String(pref.tendency?.folder || ''),
      strength: typeof pref.tendency?.strength === 'number'
        ? Math.max(0, Math.min(1, pref.tendency.strength))
        : 0.7,
    },
    evidence: {
      totalMatched: 0,
      accepted: 0,
      rejected: 0,
      lastSeenAt: null,
    },
    enabled: pref.enabled !== false,
    source: pref.source || 'user_defined',
    createdAt: now,
    updatedAt: now,
  };
  doc.preferences.push(entry);
  writeDoc(projectDir, doc);
  return entry;
}

export function updatePreference(projectDir, prefId, patch) {
  const doc = readDoc(projectDir);
  const idx = doc.preferences.findIndex((p) => p.id === prefId);
  if (idx < 0) return null;
  const prev = doc.preferences[idx];
  const now = new Date().toISOString();
  if (patch.conditions) patch.conditions = normalizeConditions(patch.conditions);
  if (patch.tendency) {
    patch.tendency = {
      ...prev.tendency,
      ...patch.tendency,
      strength: typeof patch.tendency.strength === 'number'
        ? Math.max(0, Math.min(1, patch.tendency.strength))
        : prev.tendency.strength,
    };
  }
  doc.preferences[idx] = { ...prev, ...patch, id: prefId, updatedAt: now };
  writeDoc(projectDir, doc);
  return doc.preferences[idx];
}

export function deletePreference(projectDir, prefId) {
  const doc = readDoc(projectDir);
  const before = doc.preferences.length;
  doc.preferences = doc.preferences.filter((p) => p.id !== prefId);
  if (doc.preferences.length === before) return false;
  writeDoc(projectDir, doc);
  return true;
}

export function matchPreferences(projectDir, { fileName, ext, sourceDir }) {
  const prefs = readPreferences(projectDir);
  const fn = String(fileName || '').toLowerCase();
  const fileExt = String(ext || '').toLowerCase().replace(/^\./, '');
  const src = String(sourceDir || '').toLowerCase();

  return prefs
    .filter((p) => p.enabled !== false)
    .filter((p) => {
      const c = p.conditions || {};
      const ni = c.nameIncludes || [];
      const ne = c.nameExcludes || [];
      const exts = c.exts || [];
      const si = c.sourceIncludes || [];
      const se = c.sourceExcludes || [];

      const hasAnyCondition = ni.length || exts.length || si.length;
      if (!hasAnyCondition) return false;

      if (ni.length && !ni.some((kw) => fn.includes(kw.toLowerCase()))) return false;
      if (ne.length && ne.some((kw) => fn.includes(kw.toLowerCase()))) return false;
      if (exts.length && !exts.some((e) => e.toLowerCase() === fileExt)) return false;
      if (si.length && !si.some((kw) => src.includes(kw.toLowerCase()))) return false;
      if (se.length && se.some((kw) => src.includes(kw.toLowerCase()))) return false;

      return true;
    })
    .sort((a, b) => (b.tendency?.strength || 0) - (a.tendency?.strength || 0));
}

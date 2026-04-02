import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = 1;

export function getClassifyRulesPath(projectDir) {
  return path.join(projectDir, 'meta', 'classify-rules.json');
}

function readDoc(projectDir) {
  const p = getClassifyRulesPath(projectDir);
  if (!fs.existsSync(p)) return { schemaVersion: SCHEMA_VERSION, rules: [] };
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf-8'));
    doc.schemaVersion = doc.schemaVersion || SCHEMA_VERSION;
    doc.rules = Array.isArray(doc.rules) ? doc.rules : [];
    return doc;
  } catch {
    return { schemaVersion: SCHEMA_VERSION, rules: [] };
  }
}

function writeDoc(projectDir, doc) {
  const p = getClassifyRulesPath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

let _counter = 0;
function genId() {
  return `rule_${Date.now().toString(36)}_${(++_counter).toString(36)}`;
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

export function readClassifyRules(projectDir) {
  return readDoc(projectDir).rules;
}

export function addRule(projectDir, rule) {
  const doc = readDoc(projectDir);
  const now = new Date().toISOString();
  const maxPriority = doc.rules.reduce((m, r) => Math.max(m, r.priority || 0), 0);
  const entry = {
    id: genId(),
    enabled: rule.enabled !== false,
    source: rule.source || 'user_defined',
    targetFolder: String(rule.targetFolder || ''),
    conditions: normalizeConditions(rule.conditions),
    confidence: typeof rule.confidence === 'number' ? rule.confidence : 0.95,
    priority: typeof rule.priority === 'number' ? rule.priority : maxPriority + 10,
    label: String(rule.label || ''),
    hitCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  doc.rules.push(entry);
  writeDoc(projectDir, doc);
  return entry;
}

export function updateRule(projectDir, ruleId, patch) {
  const doc = readDoc(projectDir);
  const idx = doc.rules.findIndex((r) => r.id === ruleId);
  if (idx < 0) return null;
  const prev = doc.rules[idx];
  const now = new Date().toISOString();
  if (patch.conditions) patch.conditions = normalizeConditions(patch.conditions);
  doc.rules[idx] = { ...prev, ...patch, id: ruleId, updatedAt: now };
  writeDoc(projectDir, doc);
  return doc.rules[idx];
}

export function deleteRule(projectDir, ruleId) {
  const doc = readDoc(projectDir);
  const before = doc.rules.length;
  doc.rules = doc.rules.filter((r) => r.id !== ruleId);
  if (doc.rules.length === before) return false;
  writeDoc(projectDir, doc);
  return true;
}

export function reorderRules(projectDir, orderedIds) {
  const doc = readDoc(projectDir);
  const map = new Map(doc.rules.map((r) => [r.id, r]));
  const reordered = [];
  for (const id of orderedIds) {
    const r = map.get(id);
    if (r) reordered.push(r);
    map.delete(id);
  }
  for (const r of map.values()) reordered.push(r);
  const now = new Date().toISOString();
  reordered.forEach((r, i) => {
    r.priority = (reordered.length - i) * 10;
    r.updatedAt = now;
  });
  doc.rules = reordered;
  writeDoc(projectDir, doc);
  return doc.rules;
}

export function incrementHitCount(projectDir, ruleId) {
  const doc = readDoc(projectDir);
  const r = doc.rules.find((r) => r.id === ruleId);
  if (!r) return;
  r.hitCount = (r.hitCount || 0) + 1;
  r.updatedAt = new Date().toISOString();
  writeDoc(projectDir, doc);
}

const SEED_RULES_WORK = [
  { label: '发票/收据 → 收到资料', targetFolder: '收到资料', confidence: 0.88, conditions: { nameIncludes: ['发票', 'invoice', 'receipt'] } },
  { label: '会议纪要/会议记录 → 过程文档', targetFolder: '过程文档', confidence: 0.92, conditions: { nameIncludes: ['会议纪要', 'meeting minutes', '会议记录'] } },
  { label: '备忘录 → 过程文档', targetFolder: '过程文档', confidence: 0.88, conditions: { nameIncludes: ['备忘录', 'memo', 'memorandum'] } },
  { label: '工作底稿/草稿 → 过程文档', targetFolder: '过程文档', confidence: 0.85, conditions: { nameIncludes: ['工作底稿', 'draft', '草稿'] } },
  { label: '笔录/谈话记录 → 过程文档', targetFolder: '过程文档', confidence: 0.88, conditions: { nameIncludes: ['笔录', '谈话记录', 'interview record'] } },
  { label: '研究/调研/分析报告 → 调研研究', targetFolder: '调研研究', confidence: 0.88, conditions: { nameIncludes: ['研究', '调研', '分析', 'report', 'analysis'] } },
  { label: '案例/判例 → 调研研究', targetFolder: '调研研究', confidence: 0.85, conditions: { nameIncludes: ['案例', 'case study', '判例'] } },
  { label: '法规/法律文件 → 调研研究', targetFolder: '调研研究', confidence: 0.85, conditions: { nameIncludes: ['法规', '法律', 'regulation', 'statute'] } },
  { label: '交付/终版/成果 → 交付成果', targetFolder: '交付成果', confidence: 0.90, conditions: { nameIncludes: ['交付', 'final', 'deliverable', '成果', '终版'] } },
  { label: '意见书/法律意见 → 交付成果', targetFolder: '交付成果', confidence: 0.90, conditions: { nameIncludes: ['意见书', '法律意见', 'legal opinion'] } },
  { label: '思维导图 → 调研研究', targetFolder: '调研研究', confidence: 0.85, conditions: { exts: ['xmind', 'mindmap'] } },
];

/**
 * Seed default hard rules into a newly created project/case.
 * Only writes if classify-rules.json does not yet exist (idempotent).
 * @param {string} projectDir - absolute path to the project directory
 * @param {'projects'|'cases'} [domain] - workspace domain (study skipped)
 */
export function seedDefaultRules(projectDir, domain) {
  if (domain === 'study') return;
  const p = getClassifyRulesPath(projectDir);
  if (fs.existsSync(p)) return;

  const now = new Date().toISOString();
  const seeds = SEED_RULES_WORK;
  const rules = seeds.map((s, i) => ({
    id: genId(),
    enabled: true,
    source: 'system_seed',
    targetFolder: s.targetFolder,
    conditions: normalizeConditions(s.conditions),
    confidence: s.confidence,
    priority: (seeds.length - i) * 10,
    label: s.label,
    hitCount: 0,
    createdAt: now,
    updatedAt: now,
  }));

  const doc = { schemaVersion: SCHEMA_VERSION, rules };
  writeDoc(projectDir, doc);
}

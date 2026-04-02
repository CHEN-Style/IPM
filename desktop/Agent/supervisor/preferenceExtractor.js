import { getProjectDb } from '../db/index.js';
import { readPreferences } from '../storage/preferences.js';
import { readClassifyRules } from '../storage/classifyRules.js';
import { createSummaryModel } from '../services/llm.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

const MIN_SAMPLE_SIZE = 3;
const ACCEPT_RATE_THRESHOLD = 0.8;
const MAX_LLM_FILE_NAMES = 200;
const EVENT_WINDOW_DAYS = 60;

/**
 * Extract preference candidates for a single project.
 * Returns an array of candidate objects ready for addCandidate().
 */
export async function extractPreferenceCandidates(projectDir, projectName, domain) {
  const pdb = getProjectDb(projectDir);

  const since = new Date(Date.now() - EVENT_WINDOW_DAYS * 86400000).toISOString();
  const accepted = pdb.prepare(
    "SELECT file_name, ext, suggested_folder, source_dir FROM events WHERE event = 'classify.accepted' AND ts > ? ORDER BY ts DESC",
  ).all(since);
  const rejected = pdb.prepare(
    "SELECT file_name, ext, suggested_folder, source_dir FROM events WHERE event = 'classify.rejected' AND ts > ? ORDER BY ts DESC",
  ).all(since);

  if (accepted.length < MIN_SAMPLE_SIZE) return [];

  const statCandidates = buildStatisticalCandidates(accepted, rejected);
  const llmCandidates = await extractKeywordsViaLLM(accepted);
  const merged = mergeCandidates(statCandidates, llmCandidates);
  const deduped = deduplicateAgainstExisting(merged, projectDir);

  return deduped.map((c) => ({
    projectName,
    projectDir,
    domain: domain || 'projects',
    ...c,
  }));
}

function buildStatisticalCandidates(accepted, rejected) {
  const candidates = [];

  const extGroups = groupBy(accepted, (r) => `${(r.ext || '').toLowerCase()}→${r.suggested_folder}`);
  const extRejGroups = groupBy(rejected, (r) => `${(r.ext || '').toLowerCase()}→${r.suggested_folder}`);

  for (const [key, items] of extGroups) {
    if (items.length < MIN_SAMPLE_SIZE) continue;
    const ext = items[0].ext?.toLowerCase();
    const folder = items[0].suggested_folder;
    if (!ext || !folder) continue;

    const rejCount = extRejGroups.get(key)?.length || 0;
    const total = items.length + rejCount;
    const rate = items.length / total;
    if (rate < ACCEPT_RATE_THRESHOLD) continue;

    candidates.push({
      pattern: `扩展名 .${ext} → ${folder}`,
      conditions: { exts: [ext] },
      targetFolder: folder,
      suggestedStrength: rateToStrength(rate),
      evidenceSummary: `${items.length} 次接受 / ${rejCount} 次拒绝（${Math.round(rate * 100)}%）`,
      sampleFiles: items.slice(0, 3).map((r) => r.file_name),
      eventCount: items.length,
      acceptRate: Math.round(rate * 100) / 100,
    });
  }

  const srcGroups = groupBy(
    accepted.filter((r) => r.source_dir),
    (r) => `${r.source_dir}→${r.suggested_folder}`,
  );
  const srcRejGroups = groupBy(
    rejected.filter((r) => r.source_dir),
    (r) => `${r.source_dir}→${r.suggested_folder}`,
  );

  for (const [key, items] of srcGroups) {
    if (items.length < MIN_SAMPLE_SIZE) continue;
    const srcDir = items[0].source_dir;
    const folder = items[0].suggested_folder;
    if (!srcDir || !folder) continue;

    const rejCount = srcRejGroups.get(key)?.length || 0;
    const total = items.length + rejCount;
    const rate = items.length / total;
    if (rate < ACCEPT_RATE_THRESHOLD) continue;

    candidates.push({
      pattern: `来源 ${srcDir} → ${folder}`,
      conditions: { sourceIncludes: [srcDir] },
      targetFolder: folder,
      suggestedStrength: rateToStrength(rate),
      evidenceSummary: `${items.length} 次接受 / ${rejCount} 次拒绝（${Math.round(rate * 100)}%）`,
      sampleFiles: items.slice(0, 3).map((r) => r.file_name),
      eventCount: items.length,
      acceptRate: Math.round(rate * 100) / 100,
    });
  }

  return candidates;
}

async function extractKeywordsViaLLM(accepted) {
  const inputRows = accepted.slice(0, MAX_LLM_FILE_NAMES);
  if (inputRows.length < MIN_SAMPLE_SIZE) return [];

  const folderMap = new Map();
  for (const r of inputRows) {
    if (!r.suggested_folder) continue;
    const arr = folderMap.get(r.suggested_folder) || [];
    arr.push(r.file_name);
    folderMap.set(r.suggested_folder, arr);
  }

  const lines = [];
  for (const [folder, files] of folderMap) {
    lines.push(`## ${folder}`);
    for (const f of files) lines.push(`- ${f}`);
  }

  const system = new SystemMessage(`你是一个文件分类模式分析器。你的任务是从一组已归档的文件名中提取有意义的关键词模式。

规则：
- 只提取有区分力的关键词（如"合同""裁定书""证据目录""发票"），忽略日期、编号、版本号等无区分力的部分
- 每个模式至少要有 3 个文件支持
- 返回 JSON 数组，每个元素格式为：
  {"keywords": ["关键词1"], "targetFolder": "目标文件夹路径", "sampleFiles": ["示例文件1", "示例文件2"], "count": 匹配文件数, "reasoning": "简要说明"}
- 如果没有发现有意义的模式，返回空数组 []
- 只返回 JSON，不要其他文字`);

  const human = new HumanMessage(`以下是按目标文件夹分组的已归档文件名列表：\n\n${lines.join('\n')}`);

  try {
    const model = createSummaryModel();
    const response = await model.invoke([system, human]);
    const text = response.content || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((p) => Array.isArray(p.keywords) && p.keywords.length && p.targetFolder && (p.count || 0) >= MIN_SAMPLE_SIZE)
      .map((p) => ({
        pattern: `文件名含「${p.keywords.join('」「')}」→ ${p.targetFolder}`,
        conditions: { nameIncludes: p.keywords },
        targetFolder: p.targetFolder,
        suggestedStrength: 0.7,
        evidenceSummary: p.reasoning || `${p.count} 个文件匹配此关键词模式`,
        sampleFiles: (p.sampleFiles || []).slice(0, 3),
        eventCount: p.count || 0,
        acceptRate: 0,
      }));
  } catch (e) {
    console.error('[IPM][PreferenceExtractor] LLM keyword extraction failed:', e.message);
    return [];
  }
}

function mergeCandidates(statCandidates, llmCandidates) {
  const all = [...statCandidates];
  const existingKeys = new Set(statCandidates.map(candidateKey));

  for (const c of llmCandidates) {
    const key = candidateKey(c);
    if (!existingKeys.has(key)) {
      all.push(c);
      existingKeys.add(key);
    }
  }
  return all;
}

function deduplicateAgainstExisting(candidates, projectDir) {
  let existingPrefs = [];
  let existingRules = [];
  try { existingPrefs = readPreferences(projectDir); } catch { /* ignore */ }
  try { existingRules = readClassifyRules(projectDir); } catch { /* ignore */ }

  return candidates.filter((c) => {
    for (const p of existingPrefs) {
      if (isEquivalentPreference(c, p)) return false;
    }
    for (const r of existingRules) {
      if (isEquivalentRule(c, r)) return false;
    }
    return true;
  });
}

function isEquivalentPreference(candidate, existing) {
  if ((existing.tendency?.folder || '') !== candidate.targetFolder) return false;
  const ec = existing.conditions || {};
  const cc = candidate.conditions || {};

  if (cc.exts?.length && ec.exts?.length) {
    const overlap = cc.exts.some((e) => ec.exts.includes(e));
    if (overlap) return true;
  }
  if (cc.nameIncludes?.length && ec.nameIncludes?.length) {
    const overlap = cc.nameIncludes.some((k) =>
      ec.nameIncludes.some((ek) => ek.toLowerCase() === k.toLowerCase()),
    );
    if (overlap) return true;
  }
  if (cc.sourceIncludes?.length && ec.sourceIncludes?.length) {
    const overlap = cc.sourceIncludes.some((s) =>
      ec.sourceIncludes.some((es) => es.toLowerCase() === s.toLowerCase()),
    );
    if (overlap) return true;
  }
  return false;
}

function isEquivalentRule(candidate, existing) {
  if ((existing.targetFolder || '') !== candidate.targetFolder) return false;
  const ec = existing.conditions || {};
  const cc = candidate.conditions || {};

  if (cc.exts?.length && ec.exts?.length) {
    if (cc.exts.some((e) => ec.exts.includes(e))) return true;
  }
  if (cc.nameIncludes?.length && ec.nameIncludes?.length) {
    if (cc.nameIncludes.some((k) => ec.nameIncludes.some((ek) => ek.toLowerCase() === k.toLowerCase()))) return true;
  }
  return false;
}

function candidateKey(c) {
  const cond = c.conditions || {};
  const parts = [c.targetFolder || ''];
  if (cond.exts?.length) parts.push(`ext:${cond.exts.sort().join(',')}`);
  if (cond.nameIncludes?.length) parts.push(`name:${cond.nameIncludes.map((k) => k.toLowerCase()).sort().join(',')}`);
  if (cond.sourceIncludes?.length) parts.push(`src:${cond.sourceIncludes.map((s) => s.toLowerCase()).sort().join(',')}`);
  return parts.join('|');
}

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const key = keyFn(item);
    const group = map.get(key) || [];
    group.push(item);
    map.set(key, group);
  }
  return map;
}

function rateToStrength(rate) {
  if (rate >= 0.95) return 0.8;
  if (rate >= 0.9) return 0.7;
  return 0.6;
}

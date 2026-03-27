import { readClassifyRules, incrementHitCount } from '../storage/classifyRules.js';

const DEFAULT_RULES = [
  { pattern: /发票|invoice|receipt/i, target: '收到资料', confidence: 0.88 },
  { pattern: /会议纪要|meeting.*minutes|会议记录/i, target: '过程文档', confidence: 0.92 },
  { pattern: /备忘录|memo|memorandum/i, target: '过程文档', confidence: 0.88 },
  { pattern: /工作底稿|draft|草稿/i, target: '过程文档', confidence: 0.85 },
  { pattern: /笔录|谈话记录|interview.*record/i, target: '过程文档', confidence: 0.88 },
  { pattern: /研究|调研|分析|report|analysis/i, target: '调研研究', confidence: 0.88 },
  { pattern: /案例|case.*study|判例/i, target: '调研研究', confidence: 0.85 },
  { pattern: /法规|法律|regulation|statute/i, target: '调研研究', confidence: 0.85 },
  { pattern: /交付|final|deliverable|成果|终版/i, target: '交付成果', confidence: 0.90 },
  { pattern: /意见书|法律意见|legal.*opinion/i, target: '交付成果', confidence: 0.90 },
  { ext: ['xmind', 'mindmap'], target: '调研研究', confidence: 0.85 },
];

function matchUserRule(rule, fileName, ext, sourceDir) {
  const c = rule.conditions || {};
  const fnLower = (fileName || '').toLowerCase();
  const extLower = (ext || '').toLowerCase().replace(/^\./, '');
  const srcLower = (sourceDir || '').toLowerCase();

  if (c.nameExcludes?.length) {
    for (const kw of c.nameExcludes) {
      if (kw && fnLower.includes(kw.toLowerCase())) return false;
    }
  }

  let nameMatched = !c.nameIncludes?.length;
  if (c.nameIncludes?.length) {
    nameMatched = c.nameIncludes.some((kw) => kw && fnLower.includes(kw.toLowerCase()));
  }

  let extMatched = !c.exts?.length;
  if (c.exts?.length) {
    extMatched = c.exts.some((e) => e && extLower === e.toLowerCase());
  }

  let sourceMatched = !c.sourceIncludes?.length;
  if (c.sourceIncludes?.length) {
    sourceMatched = c.sourceIncludes.some((kw) => kw && srcLower.includes(kw.toLowerCase()));
  }
  if (sourceMatched && c.sourceExcludes?.length) {
    for (const kw of c.sourceExcludes) {
      if (kw && srcLower.includes(kw.toLowerCase())) {
        sourceMatched = false;
        break;
      }
    }
  }

  const hasAnyPositive = (c.nameIncludes?.length || 0) + (c.exts?.length || 0) + (c.sourceIncludes?.length || 0);
  if (!hasAnyPositive) return false;

  return nameMatched && extMatched && sourceMatched;
}

function tryUserRules(projectDir, fileName, ext, sourceDir, folderSet) {
  if (!projectDir) return null;
  let rules;
  try {
    rules = readClassifyRules(projectDir);
  } catch {
    return null;
  }
  const sorted = rules
    .filter((r) => r.enabled !== false && folderSet.has(r.targetFolder))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const rule of sorted) {
    if (matchUserRule(rule, fileName, ext, sourceDir)) {
      try { incrementHitCount(projectDir, rule.id); } catch { /* best-effort */ }
      const ruleDesc = rule.label || `用户规则命中 → ${rule.targetFolder}`;
      return {
        targetRelPath: rule.targetFolder,
        confidence: rule.confidence || 0.95,
        rationale: ruleDesc,
        classifiedBy: 'fast-path-user-rule',
        renameSuggestion: '',
        trace: [{
          type: 'fast-path-user-rule',
          ruleId: rule.id,
          ruleLabel: rule.label || '',
          target: rule.targetFolder,
          rationale: ruleDesc,
          ts: Date.now(),
        }],
      };
    }
  }
  return null;
}

function matchDefaultRules(fileName, ext, folderSet) {
  for (const rule of DEFAULT_RULES) {
    if (!folderSet.has(rule.target)) continue;

    if (rule.pattern && rule.pattern.test(fileName)) {
      const ruleDesc = '文件名匹配快速通道规则（关键词命中）';
      return {
        targetRelPath: rule.target,
        confidence: rule.confidence,
        rationale: ruleDesc,
        classifiedBy: 'fast-path',
        renameSuggestion: '',
        trace: [{ type: 'fast-path', rule: rule.pattern.toString(), target: rule.target, rationale: ruleDesc, ts: Date.now() }],
      };
    }

    if (rule.ext && Array.isArray(rule.ext)) {
      const lower = (ext || '').toLowerCase();
      if (lower && rule.ext.includes(lower)) {
        const ruleDesc = `扩展名 .${lower} 匹配快速通道规则`;
        return {
          targetRelPath: rule.target,
          confidence: rule.confidence,
          rationale: ruleDesc,
          classifiedBy: 'fast-path',
          renameSuggestion: '',
          trace: [{ type: 'fast-path', rule: `.${lower} ext match`, target: rule.target, rationale: ruleDesc, ts: Date.now() }],
        };
      }
    }
  }
  return null;
}

/**
 * Try the fast path (rule engine, no LLM).
 * Priority: user-defined rules > built-in default rules.
 *
 * @param {object} opts
 * @param {string} opts.fileName
 * @param {string} opts.ext
 * @param {Array}  opts.folders - [{relPath, ...}]
 * @param {string} [opts.projectDir] - needed for user rules
 * @param {string} [opts.sourceDir] - file source directory for source-based rules
 */
export function tryFastPath({ fileName, ext, folders, projectDir, sourceDir }) {
  const folderSet = new Set(folders.map((f) => f.relPath));

  const userResult = tryUserRules(projectDir, fileName, ext, sourceDir, folderSet);
  if (userResult) return userResult;

  return matchDefaultRules(fileName, ext, folderSet);
}

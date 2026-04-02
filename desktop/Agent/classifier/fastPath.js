import { readClassifyRules, incrementHitCount } from '../storage/classifyRules.js';

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
      const ruleDesc = rule.label || `硬规则命中 → ${rule.targetFolder}`;
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

/**
 * Try the fast path (硬规则引擎, no LLM).
 * Only matches against user-defined hard rules stored in classify-rules.json.
 * If no rule matches, returns null and the caller should fall through to the Agent.
 */
export function tryFastPath({ fileName, ext, folders, projectDir, sourceDir }) {
  const folderSet = new Set(folders.map((f) => f.relPath));
  return tryUserRules(projectDir, fileName, ext, sourceDir, folderSet);
}

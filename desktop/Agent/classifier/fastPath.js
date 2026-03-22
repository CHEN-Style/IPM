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

function matchRules(fileName, ext, availableFolders) {
  const folderSet = new Set(availableFolders.map((f) => f.relPath));

  for (const rule of DEFAULT_RULES) {
    if (!folderSet.has(rule.target)) continue;

    if (rule.pattern && rule.pattern.test(fileName)) {
      const ruleDesc = `文件名匹配快速通道规则（关键词命中）`;
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
 * Try the fast path (rule engine only, no LLM).
 * Returns a ClassifyOutput-shaped object on hit, or null on miss.
 *
 * Phase 2 will add history-based matching here.
 */
export function tryFastPath({ fileName, ext, folders }) {
  return matchRules(fileName, ext, folders);
}

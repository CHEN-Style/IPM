// desktop/src/ui/components/knowclaw-v2/SkillSelector.jsx
//
// Skill Selector for KnowClaw Input — popover button rendered next to
// the ImagePlus attachment button in ChatInput. Users pick one or more
// skills before sending; the selected skill names ride along on the
// IPC payload and the main process expands each SKILL.md into a
// `<pinned_skills>` XML block prepended to the user's text. This lets
// the model execute the skill in the *first* response instead of
// burning a tool call to discover + Read SKILL.md.
//
// Behaviour:
//   - Trigger button: Puzzle icon with a tiny count badge when one or
//     more skills are pinned. Click toggles a popover panel.
//   - Panel: search box at top, then a scrollable list of available
//     skills (only `enabled` ones, sorted by source then name). Each
//     row is a multi-select item — clicking flips the selection state.
//   - Footer: a single "导入技能..." button that calls back to the
//     parent (reuses the existing ImportSkillModal flow).
//   - Outside-click closes the popover (mousedown listener).
//
// Visual contract intentionally mirrors `ThinkingLevelSelector` /
// `WorkspaceSelector` so the chrome around the composer feels uniform.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Puzzle, Search, Plus, Check, X, Settings } from 'lucide-react';

const SOURCE_LABEL = {
  builtin: '内置',
  workspace: '工作空间',
  user: '用户',
  imported: '导入',
};

const SOURCE_BADGE_CLASS = {
  builtin: 'bg-slate-100 text-slate-600',
  workspace: 'bg-amber-50 text-amber-700',
  user: 'bg-emerald-50 text-emerald-700',
  imported: 'bg-blue-50 text-blue-700',
};

// Stable sort key: source bucket order, then alphabetical by name.
const SOURCE_ORDER = { builtin: 0, workspace: 1, user: 2, imported: 3 };

function truncate(text, max = 80) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

const SkillSelector = ({
  skills,
  selected,
  onSelect,
  onImport,
  onManage,
  loading,
  disabled,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => searchInputRef.current?.focus?.(), 0);
    }
  }, [open]);

  // Filter to enabled skills only — disabled skills aren't part of the
  // model's tool surface for the next session, so offering them here
  // would create a "selected but won't actually run" trap.
  const visibleSkills = useMemo(() => {
    const list = Array.isArray(skills) ? skills.filter((s) => s?.enabled) : [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (s) =>
            s.name.toLowerCase().includes(q)
            || String(s.description || '').toLowerCase().includes(q),
        )
      : list;
    return [...filtered].sort((a, b) => {
      const da = SOURCE_ORDER[a.source] ?? 99;
      const db = SOURCE_ORDER[b.source] ?? 99;
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });
  }, [skills, query]);

  const selectedSet = useMemo(
    () => new Set(Array.isArray(selected) ? selected : []),
    [selected],
  );

  const toggleOne = (name) => {
    const next = new Set(selectedSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onSelect?.([...next]);
  };

  const clearAll = (e) => {
    e?.stopPropagation();
    onSelect?.([]);
  };

  const count = selectedSet.size;

  return (
    <div className="relative" ref={ref}>
      {/* Pill-style trigger so the button sits naturally inside the
          composer's bottom toolbar alongside Plan/Agent and Model
          selectors. The previous icon-only square button has been
          replaced after the composer UI revamp. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`relative shrink-0 h-7 inline-flex items-center gap-1 px-2 rounded-md text-[12px] font-medium transition-colors ${
          disabled
            ? 'text-slate-300 cursor-not-allowed'
            : count > 0
              ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200'
              : open
                ? 'bg-slate-100 text-slate-700 border border-slate-200'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100 border border-transparent'
        }`}
        title={count > 0 ? `已选中 ${count} 个技能` : '选择技能 — 发送时附带 SKILL.md 上下文'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Puzzle size={13} strokeWidth={1.9} />
        <span>技能</span>
        {count > 0 && (
          <span
            className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-semibold flex items-center justify-center leading-none"
            aria-hidden="true"
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 bottom-full mb-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col max-h-[420px]"
          role="dialog"
          aria-label="选择技能"
        >
          <div className="shrink-0 px-3 py-2 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
            <Puzzle size={13} className="text-indigo-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-slate-700 leading-tight">技能</div>
              <div className="text-[10px] text-slate-400">发送时附带 SKILL.md 上下文</div>
            </div>
            {count > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-[11px] text-slate-400 hover:text-rose-600 transition-colors"
                title="清空已选"
              >
                清空
              </button>
            )}
          </div>

          <div className="shrink-0 px-3 py-2 border-b border-slate-100">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索技能..."
                className="w-full h-8 pl-7 pr-7 text-[12px] rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-colors"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  title="清空搜索"
                  aria-label="清空搜索"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto py-1">
            {loading && visibleSkills.length === 0 ? (
              <div className="px-4 py-6 text-[12px] text-slate-400 text-center">
                正在加载技能...
              </div>
            ) : visibleSkills.length === 0 ? (
              <div className="px-4 py-6 text-[12px] text-slate-400 text-center leading-relaxed">
                {query
                  ? `未找到匹配「${query}」的技能。`
                  : '暂无可用技能。可通过下方「导入技能」添加。'}
              </div>
            ) : (
              <ul className="px-1.5 space-y-0.5">
                {visibleSkills.map((s) => {
                  const isSelected = selectedSet.has(s.name);
                  const badgeClass = SOURCE_BADGE_CLASS[s.source] || SOURCE_BADGE_CLASS.user;
                  const sourceLabel = SOURCE_LABEL[s.source] || s.source;
                  return (
                    <li key={`${s.source}-${s.name}`}>
                      <button
                        type="button"
                        onClick={() => toggleOne(s.name)}
                        className={`w-full px-2 py-2 flex items-start gap-2 rounded-lg text-left transition-colors ${
                          isSelected
                            ? 'bg-indigo-50 hover:bg-indigo-100'
                            : 'hover:bg-slate-50'
                        }`}
                        title={s.description}
                      >
                        <span
                          className={`mt-0.5 shrink-0 w-4 h-4 flex items-center justify-center rounded border ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                          aria-hidden="true"
                        >
                          {isSelected && <Check size={10} strokeWidth={3} />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[12.5px] font-medium truncate ${isSelected ? 'text-indigo-800' : 'text-slate-800'}`}>
                              {s.name}
                            </span>
                            <span className={`text-[9px] px-1 rounded shrink-0 ${badgeClass}`}>
                              {sourceLabel}
                            </span>
                          </div>
                          <div className={`text-[11px] leading-snug mt-0.5 ${isSelected ? 'text-indigo-700/80' : 'text-slate-500'}`}>
                            {truncate(s.description, 80)}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {(onImport || onManage) && (
            <div className="shrink-0 px-3 py-2 border-t border-slate-100 bg-slate-50/40 flex items-center gap-2">
              {/* UI revamp: the header's skill-manager toggle was
                  removed when controls migrated into the composer, so
                  the popover footer now offers a direct entry into the
                  Skill Manager panel as well as the existing import
                  flow. */}
              {onManage && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onManage();
                  }}
                  className="flex-1 h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                  title="打开技能管理面板"
                >
                  <Settings size={13} />
                  管理技能
                </button>
              )}
              {onImport && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onImport();
                  }}
                  className="flex-1 h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-md text-[12px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                  title="从外部目录导入技能"
                >
                  <Plus size={13} />
                  导入技能...
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SkillSelector;

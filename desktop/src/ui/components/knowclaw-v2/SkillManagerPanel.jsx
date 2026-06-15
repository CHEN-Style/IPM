// desktop/src/ui/components/knowclaw-v2/SkillManagerPanel.jsx
//
// SK1: right-side skill management panel. Mirrors WorkspaceFileTree's
// shell (288 px wide aside, header / body / footer) so the two panels
// feel like siblings sharing the same right-rail slot.
//
// Composition:
//   - Header   : Puzzle icon + title + refresh button + close (X)
//   - Search   : single text input, filters name + description
//   - Body     : 3 collapsible groups (内置 / 用户 / 导入), each row
//                shows skill name + truncated description + status
//                pill button (enable/disable). User & imported rows
//                expose a delete affordance.
//   - Footer   : '+ 导入技能' placeholder button (SK2 wires it up)
//
// Per the plan we DON'T introduce a sliding Toggle Switch component;
// instead we re-use the pill-button pattern already established by
// SubAgentToggle / PlanModeToggle (aria-pressed + colour swap). Two
// reasons:
//   1. consistency — all per-skill controls feel like the existing
//      header toggles;
//   2. no new design tokens — pure Tailwind utility classes, no
//      animation timing to maintain.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Puzzle,
  RefreshCw,
  Loader2,
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Trash2,
  Plus,
  Info,
} from 'lucide-react';

import { useConfirmDialog } from '../../hooks/useConfirmDialog.jsx';
import SkillMarketplacePanel from './SkillMarketplacePanel.jsx';
import MySubmissionsPanel from './MySubmissionsPanel.jsx';
import { parseRegistryProvenance } from './skillDiff.js';

// Visual config for the four source buckets. `key` matches SkillInfo
// `source` field exactly so the grouping pass is a straight lookup.
//
// SK4: the `workspace` bucket sits between `builtin` and `user` to
// mirror the priority order applied by the listSkills IPC
// (builtin > workspace > user > imported). Workspace skills come
// from the active project's `.knowclaw/skills/` directory and are
// only visible when a non-global cwd is bound. When no workspace
// skills exist (the common case), the section auto-hides because
// the grouping pass filters out empty groups.
const GROUP_CONFIG = [
  {
    key: 'builtin',
    label: '内置技能',
    badge: '内置',
    badgeClass: 'bg-slate-100 text-slate-600',
    description: '由 KnowClaw 预装，覆盖 docx / pptx / xlsx / pdf 等常见办公场景。',
  },
  {
    key: 'workspace',
    label: '工作空间技能',
    badge: '工作空间',
    badgeClass: 'bg-amber-50 text-amber-700',
    description: '仅在当前工作空间活跃时加载，存放于项目的 .knowclaw/skills/ 目录。',
  },
  {
    key: 'user',
    label: '用户技能',
    badge: '用户',
    badgeClass: 'bg-emerald-50 text-emerald-700',
    description: '存放在用户技能目录下的自建技能（含 AI 通过 skill-builder 生成的）。',
  },
  {
    key: 'imported',
    label: '导入技能',
    badge: '导入',
    badgeClass: 'bg-blue-50 text-blue-700',
    description: '从 Claude Code / Cursor 等外部目录导入的技能，可在导入入口管理来源。',
  },
];

function truncate(text, max = 64) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

// One row per skill. We split it out so the per-row component can
// own its hover state for the (otherwise visually noisy) delete
// button without re-rendering the whole panel on hover.
const SkillRow = ({ skill, onToggle, onDelete, onViewDetail, busy, updateAvailable }) => {
  const [hover, setHover] = useState(false);
  const canDelete = skill.source !== 'builtin';
  const enabled = Boolean(skill.enabled);

  const handleToggle = useCallback(
    (e) => {
      e.stopPropagation();
      if (busy) return;
      onToggle?.(skill.name, !enabled);
    },
    [busy, enabled, onToggle, skill.name],
  );

  const handleDelete = useCallback(
    (e) => {
      e.stopPropagation();
      if (busy || !canDelete) return;
      onDelete?.(skill);
    },
    [busy, canDelete, onDelete, skill],
  );

  const handleView = useCallback(() => {
    onViewDetail?.(skill);
  }, [onViewDetail, skill]);

  return (
    <li
      className="group px-2 py-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition-colors cursor-pointer"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={handleView}
      title={skill.description}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[13px] font-medium truncate ${enabled ? 'text-slate-800' : 'text-slate-400'}`}>
              {skill.name}
            </span>
            {skill.disableModelInvocation && (
              <span
                className="text-[10px] px-1 rounded bg-amber-50 text-amber-600 shrink-0"
                title="只能通过 /skill:name 命令显式调用"
              >
                manual
              </span>
            )}
            {updateAvailable && (
              <span
                className="text-[10px] px-1 rounded bg-amber-50 text-amber-700 shrink-0"
                title="组织市场有新版本，可到「组织市场」Tab 更新"
              >
                可更新
              </span>
            )}
          </div>
          <div className={`text-[11px] leading-snug mt-0.5 ${enabled ? 'text-slate-500' : 'text-slate-400'}`}>
            {truncate(skill.description, 60)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Delete: only visible on hover for user/imported rows.
              We keep the slot in DOM (`opacity-0`) so the toggle's
              horizontal position doesn't jitter when hover begins. */}
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className={`h-7 w-7 flex items-center justify-center rounded-md transition-opacity ${
                hover ? 'opacity-100' : 'opacity-0'
              } text-slate-400 hover:text-rose-600 hover:bg-rose-50`}
              title={`删除技能「${skill.name}」`}
              aria-label={`删除技能 ${skill.name}`}
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={handleToggle}
            disabled={busy}
            aria-pressed={enabled}
            className={`relative h-7 px-2 flex items-center gap-1 rounded-md text-[11px] font-medium transition-colors ${
              busy
                ? 'text-slate-300 cursor-not-allowed bg-slate-50'
                : enabled
                  ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                  : 'text-slate-400 bg-slate-100 hover:bg-slate-200'
            }`}
            title={
              enabled
                ? '已启用 — 点击禁用（下次新对话生效）'
                : '已禁用 — 点击启用（下次新对话生效）'
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-slate-400'}`}
              aria-hidden="true"
            />
            {enabled ? '启用' : '禁用'}
          </button>
        </div>
      </div>
    </li>
  );
};

// One collapsible bucket of skills. We render the header even when
// the group is empty so the user can see the empty state in context
// (especially relevant for 用户 / 导入 buckets that may be empty for
// fresh installs).
const SkillGroup = ({ config, skills, onToggle, onDelete, onViewDetail, busyName, updateBadges }) => {
  const [collapsed, setCollapsed] = useState(false);
  const count = skills.length;

  return (
    <div className="px-2 py-1.5">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors"
      >
        {collapsed ? <ChevronRight size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
        <span className="text-[12px] font-semibold text-slate-700 flex-1 text-left">{config.label}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.badgeClass}`}>{count}</span>
      </button>
      {!collapsed && count === 0 && (
        <div className="px-3 py-3 text-[11px] text-slate-400 leading-relaxed">
          {config.key === 'user' && '当前还没有用户技能。可让 AI 通过 skill-builder 生成，或导入外部技能。'}
          {config.key === 'imported' && '尚未从 Claude Code / Cursor 等导入任何技能。'}
          {config.key === 'builtin' && '未发现内置技能（异常，请检查 KnowClaw 安装）。'}
        </div>
      )}
      {!collapsed && count > 0 && (
        <ul className="mt-1 space-y-0.5">
          {skills.map((s) => (
            <SkillRow
              key={s.name}
              skill={s}
              onToggle={onToggle}
              onDelete={onDelete}
              onViewDetail={onViewDetail}
              busy={busyName === s.name}
              updateAvailable={Boolean(updateBadges?.has?.(s.name))}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const SkillManagerPanel = ({
  skills,
  loading,
  onToggle,
  onDelete,
  onRefresh,
  onViewDetail,
  onClose,
  onImport,
  onPublish,
  listRegistrySkills,
  installRegistrySkill,
  getRegistrySkill,
  previewRegistrySkill,
  listMineRegistrySkills,
  onRegistryInstalled,
  cwd,
}) => {
  const confirm = useConfirmDialog();
  const [query, setQuery] = useState('');
  const [busyName, setBusyName] = useState(null);
  const [activeTab, setActiveTab] = useState('local');
  const searchInputRef = useRef(null);

  // H5: "可更新" badges on the local tab. We fetch the market list once
  // (and again on local-tab re-entry) and cross-reference each installed
  // registry skill's provenance (`org_registry:<id>:<versionId>`) against
  // the server-computed `updateAvailable` flag. The result is a Set of
  // local skill names whose registry counterpart has a newer version.
  const [updateBadges, setUpdateBadges] = useState(() => new Set());
  useEffect(() => {
    if (activeTab !== 'local') return undefined;
    let cancelled = false;
    (async () => {
      const res = await listRegistrySkills?.({});
      if (cancelled || !res?.ok) return;
      const byId = new Map((res.skills || []).map((s) => [s.id, s]));
      const next = new Set();
      for (const s of Array.isArray(skills) ? skills : []) {
        const prov = parseRegistryProvenance(s.importedFrom);
        if (!prov) continue;
        const remote = byId.get(prov.skillId);
        if (remote?.updateAvailable) next.add(s.name);
      }
      setUpdateBadges(next);
    })();
    return () => { cancelled = true; };
  }, [activeTab, listRegistrySkills, skills]);

  // Filter + group in one pass. We rebuild the filtered map on each
  // render because both `skills` and `query` are cheap inputs and the
  // panel never holds more than a couple dozen skills.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (s) => {
      if (!q) return true;
      return s.name.toLowerCase().includes(q)
        || String(s.description || '').toLowerCase().includes(q);
    };
    // SK4: include `workspace` bucket. Unknown sources still fall back
    // to `user` for forward compatibility with future bucket keys.
    const acc = { builtin: [], workspace: [], user: [], imported: [] };
    for (const s of Array.isArray(skills) ? skills : []) {
      if (!matches(s)) continue;
      const bucket = acc[s.source] ? s.source : 'user';
      acc[bucket].push(s);
    }
    // Stable alphabetical inside each bucket so the list doesn't
    // jitter when toggles happen.
    for (const k of Object.keys(acc)) {
      acc[k].sort((a, b) => a.name.localeCompare(b.name));
    }
    return acc;
  }, [skills, query]);

  const totalMatched = grouped.builtin.length
    + grouped.workspace.length
    + grouped.user.length
    + grouped.imported.length;

  // Wrap onToggle so we can briefly mark the row as busy while the
  // IPC roundtrip is in flight. The hook itself already does optimistic
  // updates; the busy flag is purely a click-debounce.
  const handleToggle = useCallback(
    async (name, enabled) => {
      setBusyName(name);
      try {
        await onToggle?.(name, enabled);
      } finally {
        setBusyName(null);
      }
    },
    [onToggle],
  );

  const handleDelete = useCallback(
    async (skill) => {
      const ok = await confirm({
        title: '删除技能',
        message: `确定要删除技能「${skill.name}」吗？\n\n这会从磁盘移除技能目录，操作不可撤销。下次新对话起，模型将不再看到该技能。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        danger: true,
      });
      if (!ok) return;
      setBusyName(skill.name);
      try {
        // SK4: pass the skill's source so the parent can pin `scope`
        // when invoking the IPC. Workspace and user copies of a
        // same-named skill are distinct entities; the panel knows
        // which one the user clicked, the parent does not.
        await onDelete?.(skill.name, { source: skill.source });
      } finally {
        setBusyName(null);
      }
    },
    [confirm, onDelete],
  );

  // Focus the search box on mount so the user can immediately type to
  // filter. Doesn't apply when the panel re-mounts via React strict
  // mode double-invoke — the ref still points at the same input.
  useEffect(() => {
    if (activeTab === 'local') searchInputRef.current?.focus?.();
  }, [activeTab]);

  return (
    <aside className="w-[340px] shrink-0 h-full flex flex-col border-l border-slate-100 bg-slate-50/50">
      {/* Header */}
      <div className="shrink-0 px-3 py-3 bg-white border-b border-slate-100 flex items-center gap-2">
        <Puzzle size={16} className="text-indigo-500" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-slate-700 leading-tight">技能管理</div>
          <div className="text-[10px] text-slate-400 mt-0.5">下次新对话生效</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:cursor-not-allowed"
          title="刷新技能列表"
          aria-label="刷新技能列表"
        >
          {loading
            ? <Loader2 size={13} className="animate-spin" />
            : <RefreshCw size={13} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          title="关闭面板"
          aria-label="关闭面板"
        >
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 py-2 bg-white border-b border-slate-100">
        {/* H5: admin review moved to the enterprise console「技能治理」tab;
            members get a「我的提交」tab to track their own publications. */}
        <div className="grid grid-cols-3 gap-1 p-1 mb-2 rounded-lg bg-slate-100">
          {[
            ['local', '本地'],
            ['market', '组织市场'],
            ['mine', '我的提交'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`h-7 rounded-md text-[12px] font-medium transition-colors ${
                activeTab === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {activeTab === 'local' && (
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
        )}
      </div>

      {/* Body */}
      {activeTab === 'mine' ? (
        <MySubmissionsPanel
          listMineRegistrySkills={listMineRegistrySkills}
          onSubmitNewVersion={(registrySkill) => onPublish?.(registrySkill)}
        />
      ) : activeTab === 'market' ? (
        <SkillMarketplacePanel
          listRegistrySkills={listRegistrySkills}
          installRegistrySkill={installRegistrySkill}
          getRegistrySkill={getRegistrySkill}
          previewRegistrySkill={previewRegistrySkill}
          onPublish={() => onPublish?.(null)}
          onInstalled={onRegistryInstalled}
          cwd={cwd}
        />
      ) : (
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {loading && skills.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-slate-400 leading-relaxed flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            正在加载技能列表...
          </div>
        ) : skills.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-slate-400 leading-relaxed">
            <Info size={16} className="mb-2 text-slate-300" />
            <div className="font-medium text-slate-500 mb-1">没有可用技能</div>
            <div>检查 KnowClaw 是否正确启动；如确有问题请点击右上角刷新。</div>
          </div>
        ) : query && totalMatched === 0 ? (
          <div className="px-4 py-6 text-[12px] text-slate-400 leading-relaxed">
            未找到匹配「{query}」的技能。
          </div>
        ) : (
          GROUP_CONFIG
            // SK4: hide the workspace group when empty. Other groups
            // always render so the user sees an empty-state hint
            // (e.g. how to acquire user / imported skills). Workspace
            // is different: when no `.knowclaw/skills/` directory
            // exists, surfacing an empty group adds visual noise
            // without actionable guidance (the user is unlikely to
            // know what `.knowclaw/skills/` is without context).
            .filter((cfg) => cfg.key !== 'workspace' || grouped.workspace.length > 0)
            .map((cfg) => (
              <SkillGroup
                key={cfg.key}
                config={cfg}
                skills={grouped[cfg.key]}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onViewDetail={onViewDetail}
                busyName={busyName}
                updateBadges={updateBadges}
              />
            ))
        )}
      </div>
      )}

      {/* Footer */}
      {activeTab === 'local' && (
      <div className="shrink-0 px-3 py-2.5 bg-white border-t border-slate-100">
        <button
          type="button"
          onClick={onImport}
          disabled={!onImport}
          className="w-full h-8 px-3 flex items-center justify-center gap-1.5 rounded-md text-[12px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:text-slate-400 disabled:bg-slate-50 disabled:cursor-not-allowed transition-colors"
          title={onImport ? '导入外部技能' : '导入功能即将上线（SK2）'}
        >
          <Plus size={13} />
          导入技能
        </button>
      </div>
      )}
    </aside>
  );
};

export default SkillManagerPanel;

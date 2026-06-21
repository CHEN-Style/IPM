// H5: enterprise console「技能治理」tab — org-wide skill governance.
//
// Admin counterpart of the member-facing KnowClaw skill panel. Surfaces the
// full registry catalogue (any review status) with install statistics,
// review queue actions (approve + grant / reject with reason), access-grant
// editing, archive / unarchive, version history with client-side diff
// summaries, and the installer list with version-lag flags.
//
// Visual language mirrors the H2/H3 console views (shared.jsx primitives).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, MoreHorizontal, Loader2, RefreshCw, X, Eye, Archive,
  RotateCcw, CheckCircle2, XCircle, SlidersHorizontal, Puzzle, History,
  Users, AlertTriangle,
} from 'lucide-react';
import { useToast } from '../../hooks/useToast.js';
import { avatarColor, fmtDate, fmtRelative, fmtBytes, Modal, WarnBox, FIELD_LABEL } from './shared.jsx';
import { diffManifests, diffSummaryText } from '../knowclaw-v2/skillDiff.js';

// ── meta maps ───────────────────────────────────────────────────────────

const STATUS_META = {
  pending_review: { label: '待审核', bg: '#fef3c7', color: '#b45309' },
  approved: { label: '已上架', bg: '#ecfdf5', color: '#2d7a5f' },
  rejected: { label: '已拒绝', bg: '#fef2f2', color: '#b91c1c' },
  archived: { label: '已归档', bg: '#f1f5f9', color: '#64748b' },
};

function StatusTag({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending_review;
  return (
    <span className="inline-flex items-center whitespace-nowrap text-[11px] font-medium px-2 py-0.5 rounded"
      style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

function accessText(skill) {
  if (skill.status !== 'approved') return '—';
  if (skill.orgGrant) return '全组织';
  if (skill.userGrantCount > 0) return `指定 ${skill.userGrantCount} 人`;
  return '未授权';
}

const SECONDARY_BTN = { background: '#fff', border: '1px solid #e8eaf0', color: '#475569' };

// ── access editor modal (org-wide vs per-user grants) ──────────────────

function AccessModal({ open, skill, orgUsers, initialGrants, saving, title, confirmLabel, onClose, onSave }) {
  const [mode, setMode] = useState('org');
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    if (!open) return;
    const grants = Array.isArray(initialGrants) ? initialGrants : [];
    const hasOrg = grants.some((g) => g.grantType === 'org' || g.grant_type === 'org');
    setMode(hasOrg || grants.length === 0 ? 'org' : 'users');
    setSelected(new Set(grants.map((g) => g.userId || g.user_id).filter(Boolean)));
  }, [open, initialGrants]);

  if (!open || !skill) return null;

  const users = (Array.isArray(orgUsers) ? orgUsers : []).filter((u) => u?.id);
  const toggleUser = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const canSave = mode === 'org' || selected.size > 0;
  const save = () => {
    const grants = mode === 'org'
      ? [{ grantType: 'org' }]
      : [...selected].map((userId) => ({ grantType: 'user', userId }));
    onSave?.(grants);
  };

  return (
    <Modal open width={460} onClose={onClose}>
      <div className="px-5 pt-[18px]">
        <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>{title || '设置可见范围'}</h3>
        <p className="text-[12.5px] mt-0.5 truncate" style={{ color: '#64748b' }}>{skill.name}</p>
      </div>
      <div className="px-5 pt-4 pb-1 flex flex-col gap-[7px]">
        <button type="button" onClick={() => setMode('org')}
          className="flex items-start gap-2.5 rounded-[9px] px-3 py-[11px] text-left transition-all"
          style={{ border: mode === 'org' ? '1px solid #3e4b9c' : '1px solid #e8eaf0', background: mode === 'org' ? 'rgba(62,75,156,0.08)' : '#fff' }}>
          <span className="w-3.5 h-3.5 rounded-full mt-px shrink-0 transition-all"
            style={{ border: mode === 'org' ? '4.5px solid #3e4b9c' : '1.5px solid #cbd5e1' }} />
          <span>
            <span className="block text-[13px] font-medium" style={{ color: '#1e293b' }}>全组织可见</span>
            <span className="block text-[11.5px] mt-0.5" style={{ color: '#64748b' }}>组织内所有成员都能在市场中看到并安装。</span>
          </span>
        </button>
        <button type="button" onClick={() => setMode('users')}
          className="flex items-start gap-2.5 rounded-[9px] px-3 py-[11px] text-left transition-all"
          style={{ border: mode === 'users' ? '1px solid #3e4b9c' : '1px solid #e8eaf0', background: mode === 'users' ? 'rgba(62,75,156,0.08)' : '#fff' }}>
          <span className="w-3.5 h-3.5 rounded-full mt-px shrink-0 transition-all"
            style={{ border: mode === 'users' ? '4.5px solid #3e4b9c' : '1.5px solid #cbd5e1' }} />
          <span>
            <span className="block text-[13px] font-medium" style={{ color: '#1e293b' }}>指定用户可见</span>
            <span className="block text-[11.5px] mt-0.5" style={{ color: '#64748b' }}>只有被勾选的成员能看到并安装。</span>
          </span>
        </button>
        {mode === 'users' && (
          <div className="rounded-[9px] overflow-hidden" style={{ border: '1px solid #e8eaf0' }}>
            {users.length === 0 ? (
              <div className="px-3 py-4 text-[12px]" style={{ color: '#94a3b8' }}>暂无可选组织成员。</div>
            ) : (
              <div className="max-h-52 overflow-y-auto">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors hover:bg-slate-50"
                    style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleUser(u.id)} />
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9.5px] font-semibold text-white shrink-0"
                      style={{ background: avatarColor(u.id) }}>
                      {(u.displayName || u.email || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium truncate" style={{ color: '#1e293b' }}>{u.displayName || u.email}</span>
                      <span className="block text-[10.5px] truncate" style={{ color: '#94a3b8' }}>{u.email} · {u.role}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 px-5 py-4 mt-2">
        <button type="button" onClick={onClose}
          className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
        <button type="button" disabled={!canSave || saving} onClick={save}
          className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60"
          style={{ background: '#3e4b9c' }}>
          {saving ? '保存中…' : (confirmLabel || '保存')}
        </button>
      </div>
    </Modal>
  );
}

// ── main view ───────────────────────────────────────────────────────────

const EnterpriseSkillsView = () => {
  const { showToast } = useToast();

  const [skills, setSkills] = useState([]);
  const [orgUsers, setOrgUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const STATUS_FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'pending_review', label: '待审核' },
    { key: 'approved', label: '已上架' },
    { key: 'rejected', label: '已拒绝' },
    { key: 'archived', label: '已归档' },
  ];
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');

  const [menu, setMenu] = useState(null); // { x, y, skill }
  const [drawer, setDrawer] = useState(null); // { id, name, loading, skill, versions, installers, grants, tab, error }
  const [busy, setBusy] = useState(false);

  // modals
  const [accessState, setAccessState] = useState(null); // { skill, grants, reviewMode }
  const [rejectTarget, setRejectTarget] = useState(null); // skill
  const [rejectNote, setRejectNote] = useState('');
  const [archiveTarget, setArchiveTarget] = useState(null); // skill

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [listRes, usersRes] = await Promise.all([
        window.ipm?.skills?.registryAdminOverview?.(),
        window.ipm?.skills?.registryAdminListOrgUsers?.(),
      ]);
      if (!listRes?.ok) throw new Error(listRes?.error || '加载技能列表失败');
      setSkills(listRes.skills || []);
      if (usersRes?.ok) setOrgUsers(usersRes.users || []);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const openDrawer = useCallback(async (skill, keepTab) => {
    setDrawer((prev) => ({
      id: skill.id, name: skill.name, loading: true,
      skill, versions: [], installers: [], grants: [],
      tab: keepTab || prev?.tab || 'versions',
    }));
    const [detailRes, installersRes, accessRes] = await Promise.all([
      window.ipm?.skills?.registryGet?.(skill.id),
      window.ipm?.skills?.registryListInstallers?.(skill.id),
      window.ipm?.skills?.registryAdminGetAccess?.(skill.id),
    ]);
    setDrawer((prev) => {
      if (prev?.id !== skill.id) return prev;
      if (!detailRes?.ok) return { ...prev, loading: false, error: detailRes?.error || '加载详情失败' };
      return {
        ...prev,
        loading: false,
        skill: { ...skill, ...detailRes.skill },
        versions: Array.isArray(detailRes.versions) ? detailRes.versions : [],
        installers: installersRes?.ok ? (installersRes.installers || []) : [],
        grants: accessRes?.ok ? (accessRes.grants || []) : [],
      };
    });
  }, []);

  const refreshAll = useCallback(async (skillForDrawer) => {
    await loadList();
    if (skillForDrawer && drawer?.id === skillForDrawer.id) {
      await openDrawer(skillForDrawer, drawer?.tab);
    }
  }, [loadList, openDrawer, drawer?.id, drawer?.tab]);

  // ── derived ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (q && !`${s.name} ${s.slug} ${s.description || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [skills, statusFilter, query]);

  const stats = useMemo(() => ({
    total: skills.length,
    pending: skills.filter((s) => s.status === 'pending_review').length,
    approved: skills.filter((s) => s.status === 'approved').length,
    installs: skills.reduce((sum, s) => sum + (s.installCount || 0), 0),
    outdated: skills.reduce((sum, s) => sum + (s.outdatedInstallCount || 0), 0),
  }), [skills]);

  const countByStatus = (key) => (key === 'all' ? skills.length : skills.filter((s) => s.status === key).length);

  // Version rows for the drawer, annotated with diffs against the previous
  // version (per-file sha256 when both manifests carry it).
  const drawerVersionRows = useMemo(() => {
    const versions = drawer?.versions || [];
    return versions.map((v, i) => {
      const prev = versions[i + 1];
      const diff = prev ? diffManifests(prev.manifest, v.manifest) : null;
      return { ...v, diffText: diff ? diffSummaryText(diff) : '首个版本' };
    });
  }, [drawer?.versions]);

  // ── actions ───────────────────────────────────────────────────────────

  const openApprove = (skill) => {
    setAccessState({ skill, grants: [{ grantType: 'org' }], reviewMode: true });
  };

  const openAccessEdit = async (skill) => {
    setBusy(true);
    const res = await window.ipm?.skills?.registryAdminGetAccess?.(skill.id);
    setBusy(false);
    if (!res?.ok) {
      showToast(res?.error || '访问范围加载失败', 'error');
      return;
    }
    setAccessState({ skill, grants: res.grants || [], reviewMode: false });
  };

  const saveAccess = async (grants) => {
    const st = accessState;
    if (!st) return;
    setBusy(true);
    try {
      const res = st.reviewMode
        ? await window.ipm?.skills?.registryAdminReview?.({ id: st.skill.id, decision: 'approved', grants })
        : await window.ipm?.skills?.registryAdminSetAccess?.({ id: st.skill.id, grants });
      if (!res?.ok) throw new Error(res?.error || '保存失败');
      showToast(st.reviewMode ? `「${st.skill.name}」已通过并授权` : '可见范围已更新');
      setAccessState(null);
      await refreshAll(st.skill);
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    const skill = rejectTarget;
    if (!skill) return;
    setBusy(true);
    try {
      const res = await window.ipm?.skills?.registryAdminReview?.({
        id: skill.id, decision: 'rejected', note: rejectNote.trim() || undefined,
      });
      if (!res?.ok) throw new Error(res?.error || '拒绝失败');
      showToast(`已拒绝「${skill.name}」`);
      setRejectTarget(null);
      setRejectNote('');
      await refreshAll(skill);
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doArchive = async () => {
    const skill = archiveTarget;
    if (!skill) return;
    setBusy(true);
    try {
      const res = await window.ipm?.skills?.registryArchive?.(skill.id);
      if (!res?.ok) throw new Error(res?.error || '归档失败');
      showToast(`「${skill.name}」已归档`);
      setArchiveTarget(null);
      await refreshAll(skill);
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doUnarchive = async (skill) => {
    setBusy(true);
    try {
      const res = await window.ipm?.skills?.registryUnarchive?.(skill.id);
      if (!res?.ok) throw new Error(res?.error || '恢复失败');
      showToast(`「${skill.name}」已恢复${res.status === 'approved' ? '上架' : `为${STATUS_META[res.status]?.label || res.status}`}`);
      await refreshAll(skill);
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openRowMenu = (e, skill) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: Math.min(r.left, window.innerWidth - 220), y: r.bottom + 4, skill });
  };

  // ── render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-[13px]" style={{ color: '#94a3b8' }}>
        <Loader2 size={16} className="animate-spin" />加载中…
      </div>
    );
  }

  const drawerSkill = drawer?.skill;

  return (
    <>
      {error && (
        <div className="mt-4 flex items-center justify-between gap-2 text-[13px] px-3 py-2 rounded-lg"
          style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
          <span>{error}</span>
          <button type="button" onClick={loadList} className="flex items-center gap-1 text-[12px] shrink-0 hover:underline">
            <RefreshCw size={12} />重试
          </button>
        </div>
      )}

      {/* ── 统计条 ── */}
      <div className="flex flex-wrap gap-2.5 mt-[18px] [&>*]:min-w-[120px]">
        {[
          { k: '技能总数', v: <>{stats.total} <small>全状态</small></> },
          { k: '待审核', v: <span style={stats.pending ? { color: '#b45309' } : undefined}>{stats.pending} {stats.pending > 0 && <small>需处理</small>}</span> },
          { k: '已上架', v: stats.approved },
          { k: '累计安装', v: <>{stats.installs} <small>{stats.outdated > 0 ? `${stats.outdated} 处落后` : '全部最新'}</small></> },
        ].map((s) => (
          <div key={s.k} className="flex-1 rounded-[10px] px-4 py-3" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
            <div style={FIELD_LABEL}>{s.k}</div>
            <div className="text-[22px] font-semibold mt-1 [&_small]:text-[12px] [&_small]:font-normal [&_small]:text-slate-400 [&_small]:ml-1"
              style={{ color: '#1e293b', letterSpacing: '-0.02em' }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* ── 工具条 ── */}
      <div className="flex items-center flex-wrap gap-2.5 gap-y-2 mt-[18px] mb-3.5">
        <div className="inline-flex rounded-[7px] p-0.5 shrink-0 max-w-full overflow-x-auto no-scrollbar" style={{ background: '#eef0f4' }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className="px-3 py-[5px] rounded-md text-[12.5px] transition-all shrink-0 whitespace-nowrap"
              style={statusFilter === f.key
                ? { background: '#fff', color: '#1e293b', fontWeight: 500, boxShadow: '0 1px 2px rgba(15,23,42,0.08)' }
                : { color: '#64748b' }}
            >{f.label} {countByStatus(f.key)}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 flex-1 min-w-[140px] max-w-[220px]" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
          <Search size={13} style={{ color: '#94a3b8' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能名称…"
            className="w-full outline-none text-[12.5px] bg-transparent"
            style={{ color: '#1e293b' }}
          />
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={loadList}
          className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] transition-colors hover:bg-slate-50 shrink-0 whitespace-nowrap"
          style={SECONDARY_BTN}
        >
          <RefreshCw size={12} />刷新
        </button>
      </div>

      {/* ── 技能表格 ── */}
      <div className="rounded-[10px] overflow-x-auto" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
        <table className="w-full min-w-[720px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fbfcfd' }}>
              {[['技能', '28%'], ['状态', '10%'], ['最新版本', '10%'], ['提交人', '13%'], ['安装', '10%'], ['可见范围', '11%'], ['更新时间', '13%'], ['', '5%']].map(([h, w], i) => (
                <th key={h || i} className="text-left px-4 py-[9px] text-[11px] font-medium uppercase whitespace-nowrap"
                  style={{ color: '#94a3b8', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', width: w }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-[13px]" style={{ color: '#94a3b8' }}>
                {skills.length === 0 ? '组织内还没有提交过技能' : '没有匹配的技能'}
              </td></tr>
            )}
            {filtered.map((s) => {
              const muted = s.status === 'archived';
              return (
                <tr key={s.id} className="group transition-colors hover:bg-slate-50 cursor-pointer" onClick={() => openDrawer(s)}>
                  <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <div className="flex items-center gap-2.5">
                      <div className="rounded-lg flex items-center justify-center shrink-0"
                        style={{ width: 30, height: 30, background: 'rgba(62,75,156,0.08)', color: '#3e4b9c', opacity: muted ? 0.45 : 1 }}>
                        <Puzzle size={15} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate" style={{ color: muted ? '#b6bdc9' : '#1e293b' }}>{s.name}</div>
                        <div className="text-[11.5px] truncate" style={{ color: muted ? '#cbd5e1' : '#94a3b8' }}>{s.description || s.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}><StatusTag status={s.status} /></td>
                  <td className="px-4 py-[11px] text-[12px] whitespace-nowrap" style={{ borderBottom: '1px solid #f1f5f9', color: muted ? '#b6bdc9' : '#64748b' }}>
                    {s.latestVersion || '—'}{s.versionCount > 1 ? ` · 共${s.versionCount}版` : ''}
                  </td>
                  <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <div className="flex items-center gap-2 text-[12.5px]" style={{ color: muted ? '#b6bdc9' : '#475569' }}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9.5px] font-semibold text-white shrink-0"
                        style={{ background: avatarColor(s.publisherId), opacity: muted ? 0.5 : 1 }}>
                        {(s.publisherName || '?').slice(0, 1).toUpperCase()}
                      </span>
                      <span className="truncate">{s.publisherName || '未知'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-[11px] text-[12px] whitespace-nowrap" style={{ borderBottom: '1px solid #f1f5f9', color: muted ? '#b6bdc9' : '#64748b' }}>
                    {s.installCount || 0}
                    {s.outdatedInstallCount > 0 && (
                      <span className="ml-1 text-[10.5px]" style={{ color: '#b45309' }}>({s.outdatedInstallCount} 落后)</span>
                    )}
                  </td>
                  <td className="px-4 py-[11px] text-[12px] whitespace-nowrap" style={{ borderBottom: '1px solid #f1f5f9', color: muted ? '#b6bdc9' : '#64748b' }}>
                    {accessText(s)}
                  </td>
                  <td className="px-4 py-[11px] text-[12px] whitespace-nowrap" style={{ borderBottom: '1px solid #f1f5f9', color: muted ? '#b6bdc9' : '#64748b' }}>
                    {fmtRelative(s.updatedAt) || '—'}
                  </td>
                  <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => openRowMenu(e, s)}
                        className="w-[26px] h-[26px] rounded-md flex items-center justify-center transition-colors hover:bg-slate-100"
                        style={{ color: '#94a3b8' }}
                        title="治理操作"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[11.5px]" style={{ color: '#94a3b8' }}>
        点击行打开详情;行尾菜单执行审核、授权与归档操作。归档后技能在市场不可见、不可安装、不可提交新版本,可随时恢复。
      </p>

      {/* ── 行操作菜单 ── */}
      {menu && (
        <div className="fixed z-50 rounded-[9px] p-1"
          style={{ top: menu.y, left: menu.x, minWidth: 196, background: '#fff', border: '1px solid #e8eaf0', boxShadow: '0 4px 24px rgba(15,23,42,0.12), 0 1px 3px rgba(15,23,42,0.08)' }}
          onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { openDrawer(menu.skill); setMenu(null); }}
            className="w-full flex items-start gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
            <Eye size={13} className="mt-0.5" />
            <span>查看详情<span className="block text-[10.5px]" style={{ color: '#94a3b8' }}>版本、安装者与授权</span></span>
          </button>
          {menu.skill.status === 'pending_review' && (
            <>
              <div className="h-px my-1 mx-1.5" style={{ background: '#f1f5f9' }} />
              <button type="button" disabled={busy} onClick={() => { openApprove(menu.skill); setMenu(null); }}
                className="w-full flex items-start gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#2d7a5f' }}>
                <CheckCircle2 size={13} className="mt-0.5" />
                <span>通过并授权<span className="block text-[10.5px]" style={{ color: '#94a3b8' }}>设置可见范围后上架</span></span>
              </button>
              <button type="button" disabled={busy} onClick={() => { setRejectTarget(menu.skill); setRejectNote(''); setMenu(null); }}
                className="w-full flex items-start gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-red-50" style={{ color: '#b91c1c' }}>
                <XCircle size={13} className="mt-0.5" />
                <span>拒绝<span className="block text-[10.5px]" style={{ color: '#94a3b8' }}>填写原因反馈给提交人</span></span>
              </button>
            </>
          )}
          {menu.skill.status === 'approved' && (
            <>
              <div className="h-px my-1 mx-1.5" style={{ background: '#f1f5f9' }} />
              <button type="button" disabled={busy} onClick={() => { const s = menu.skill; setMenu(null); openAccessEdit(s); }}
                className="w-full flex items-start gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
                <SlidersHorizontal size={13} className="mt-0.5" />
                <span>调整可见范围<span className="block text-[10.5px]" style={{ color: '#94a3b8' }}>全组织或指定成员</span></span>
              </button>
            </>
          )}
          {menu.skill.status !== 'archived' ? (
            <button type="button" disabled={busy} onClick={() => { setArchiveTarget(menu.skill); setMenu(null); }}
              className="w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-red-50" style={{ color: '#b91c1c' }}>
              <Archive size={13} />归档技能
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => { const s = menu.skill; setMenu(null); doUnarchive(s); }}
              className="w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
              <RotateCcw size={13} />恢复技能
            </button>
          )}
        </div>
      )}

      {/* ── 详情抽屉 ── */}
      {drawer && (
        <>
          <div className="fixed inset-0 z-[80]" style={{ background: 'rgba(15,23,42,0.18)' }} onClick={() => setDrawer(null)} />
          <aside className="fixed top-0 right-0 h-screen z-[90] bg-white flex flex-col w-[min(560px,calc(100vw-32px))]"
            style={{ boxShadow: '-8px 0 40px rgba(15,23,42,0.12)' }}>
            <div className="px-6 pt-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-lg flex items-center justify-center shrink-0"
                    style={{ width: 36, height: 36, background: 'rgba(62,75,156,0.08)', color: '#3e4b9c' }}>
                    <Puzzle size={18} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[16px] font-semibold flex items-center gap-2 truncate" style={{ color: '#1e293b' }}>
                      <span className="truncate">{drawer.name}</span>
                      {drawerSkill && <StatusTag status={drawerSkill.status} />}
                    </h2>
                    <div className="text-[12px] mt-0.5 truncate" style={{ color: '#94a3b8' }}>
                      {drawerSkill ? `${drawerSkill.slug} · 提交人 ${drawerSkill.publisherName || '未知'} · 更新于 ${fmtRelative(drawerSkill.updatedAt) || '—'}` : ''}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => setDrawer(null)}
                  className="w-7 h-7 rounded-[7px] flex items-center justify-center transition-colors hover:bg-slate-100 shrink-0" style={{ color: '#94a3b8' }}>
                  <X size={15} />
                </button>
              </div>

              {drawer.loading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-[13px]" style={{ color: '#94a3b8' }}>
                  <Loader2 size={16} className="animate-spin" />加载详情…
                </div>
              ) : drawer.error ? (
                <div className="mt-4 text-[13px] px-3 py-2 rounded-lg" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>{drawer.error}</div>
              ) : drawerSkill && (
                <>
                  {drawerSkill.description && (
                    <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: '#64748b' }}>{drawerSkill.description}</p>
                  )}
                  {drawerSkill.status === 'rejected' && drawerSkill.reviewNote && (
                    <div className="mt-3 px-3 py-2 rounded-lg text-[12px]" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
                      拒绝原因：{drawerSkill.reviewNote}
                      {drawerSkill.reviewerName && <span style={{ color: '#dc8a8a' }}>（{drawerSkill.reviewerName}）</span>}
                    </div>
                  )}
                  <div className="flex gap-2 mt-4">
                    {[
                      ['最新版本', drawerSkill.latestVersion || '—'],
                      ['版本数', drawer.versions.length],
                      ['安装人数', drawer.installers.length],
                      ['可见范围', drawerSkill.status === 'approved'
                        ? (drawer.grants.some((g) => g.grantType === 'org') ? '全组织'
                          : drawer.grants.length > 0 ? `指定 ${drawer.grants.length} 人` : '未授权')
                        : '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex-1 rounded-lg px-3 py-2" style={{ background: '#fbfcfd', border: '1px solid #f1f5f9' }}>
                        <div className="text-[10.5px] uppercase" style={{ color: '#94a3b8', letterSpacing: '0.04em' }}>{k}</div>
                        <div className="text-[15px] font-semibold mt-0.5 truncate" style={{ color: '#1e293b' }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* 治理动作 */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {drawerSkill.status === 'pending_review' && (
                      <>
                        <button type="button" disabled={busy} onClick={() => openApprove(drawerSkill)}
                          className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] font-medium text-white transition-colors disabled:opacity-60"
                          style={{ background: '#2d7a5f' }}>
                          <CheckCircle2 size={13} />通过并授权
                        </button>
                        <button type="button" disabled={busy} onClick={() => { setRejectTarget(drawerSkill); setRejectNote(''); }}
                          className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] font-medium transition-colors hover:bg-red-50 disabled:opacity-60"
                          style={{ background: '#fff', border: '1px solid #fecaca', color: '#b91c1c' }}>
                          <XCircle size={13} />拒绝
                        </button>
                      </>
                    )}
                    {drawerSkill.status === 'approved' && (
                      <button type="button" disabled={busy} onClick={() => openAccessEdit(drawerSkill)}
                        className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] transition-colors hover:bg-slate-50 disabled:opacity-60"
                        style={SECONDARY_BTN}>
                        <SlidersHorizontal size={13} />调整可见范围
                      </button>
                    )}
                    {drawerSkill.status !== 'archived' ? (
                      <button type="button" disabled={busy} onClick={() => setArchiveTarget(drawerSkill)}
                        className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] transition-colors hover:bg-slate-50 disabled:opacity-60"
                        style={SECONDARY_BTN}>
                        <Archive size={13} />归档
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => doUnarchive(drawerSkill)}
                        className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] transition-colors hover:bg-slate-50 disabled:opacity-60"
                        style={SECONDARY_BTN}>
                        <RotateCcw size={13} />恢复
                      </button>
                    )}
                  </div>

                  <div className="flex gap-[18px] mt-[18px]" style={{ borderBottom: '1px solid #e8eaf0' }}>
                    {[['versions', `版本历史 ${drawer.versions.length}`], ['installers', `安装者 ${drawer.installers.length}`]].map(([key, label]) => (
                      <div key={key} onClick={() => setDrawer({ ...drawer, tab: key })}
                        className="pb-[9px] pt-[7px] text-[12.5px] cursor-pointer select-none"
                        style={drawer.tab === key
                          ? { color: '#1e293b', fontWeight: 600, borderBottom: '2px solid #3e4b9c', marginBottom: -1 }
                          : { color: '#64748b', borderBottom: '2px solid transparent', marginBottom: -1 }}>
                        {label}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {!drawer.loading && !drawer.error && drawerSkill && (
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {drawer.tab === 'versions' && (
                  drawerVersionRows.length === 0 ? (
                    <div className="py-10 text-center text-[13px]" style={{ color: '#94a3b8' }}>暂无版本记录</div>
                  ) : (
                    <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid #e8eaf0' }}>
                      {drawerVersionRows.map((v, i) => (
                        <div key={v.id} className="flex items-center gap-3 px-3.5 py-[11px]"
                          style={{ borderBottom: '1px solid #f1f5f9', background: i === 0 ? '#fbfcfd' : '#fff' }}>
                          <History size={13} style={{ color: '#94a3b8' }} className="shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[12.5px] font-semibold" style={{ color: '#1e293b' }}>{v.version}</span>
                              {v.id === drawerSkill.latestVersionId && (
                                <span className="text-[10px] font-medium px-1.5 py-px rounded" style={{ background: 'rgba(62,75,156,0.08)', color: '#3e4b9c' }}>最新</span>
                              )}
                            </div>
                            <div className="text-[11.5px] mt-0.5" style={{ color: '#94a3b8' }}>{v.diffText} · {fmtBytes(v.sizeBytes)}</div>
                          </div>
                          <span className="text-[11.5px] shrink-0" style={{ color: '#94a3b8' }}>{fmtDate(v.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
                {drawer.tab === 'installers' && (
                  drawer.installers.length === 0 ? (
                    <div className="py-10 text-center text-[13px]" style={{ color: '#94a3b8' }}>
                      <Users size={28} style={{ color: '#cbd5e1' }} className="mx-auto mb-2" />
                      还没有成员安装该技能
                    </div>
                  ) : (
                    <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid #e8eaf0' }}>
                      {drawer.installers.map((it) => (
                        <div key={it.userId} className="flex items-center gap-3 px-3.5 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                            style={{ background: avatarColor(it.userId) }}>
                            {(it.displayName || it.email || '?').slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-medium truncate" style={{ color: '#1e293b' }}>{it.displayName || it.email}</div>
                            <div className="text-[11px] truncate" style={{ color: '#94a3b8' }}>{it.email}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11.5px]" style={{ color: '#64748b' }}>{it.version || '—'}</span>
                            {it.outdated && (
                              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-px rounded-full"
                                style={{ background: '#fef3c7', color: '#b45309' }}>
                                <AlertTriangle size={9} />落后
                              </span>
                            )}
                            <span className="text-[11.5px]" style={{ color: '#94a3b8' }}>{fmtRelative(it.installedAt) || '—'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
          </aside>
        </>
      )}

      {/* ── 弹窗:通过并授权 / 调整可见范围 ── */}
      <AccessModal
        open={Boolean(accessState)}
        skill={accessState?.skill}
        orgUsers={orgUsers}
        initialGrants={accessState?.grants}
        saving={busy}
        title={accessState?.reviewMode ? '通过审核并设置可见范围' : '调整可见范围'}
        confirmLabel={accessState?.reviewMode ? '通过并上架' : '保存'}
        onClose={() => { if (!busy) setAccessState(null); }}
        onSave={saveAccess}
      />

      {/* ── 弹窗:拒绝 ── */}
      <Modal open={Boolean(rejectTarget)} width={420} onClose={() => { if (!busy) setRejectTarget(null); }}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>拒绝「{rejectTarget?.name}」?</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>拒绝原因会在「我的提交」中展示给提交人。</p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <span style={FIELD_LABEL} className="block mb-[7px]">拒绝原因(可留空)</span>
          <textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={3}
            placeholder="例如:描述不完整、脚本存在风险、与现有技能重复…"
            className="w-full rounded-[7px] px-2.5 py-2 text-[13px] outline-none resize-none"
            style={{ border: '1px solid #e8eaf0', color: '#1e293b' }}
          />
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setRejectTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy} onClick={doReject}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60"
            style={{ background: '#b91c1c' }}>
            {busy ? '处理中…' : '确认拒绝'}
          </button>
        </div>
      </Modal>

      {/* ── 弹窗:归档 ── */}
      <Modal open={Boolean(archiveTarget)} width={400} onClose={() => { if (!busy) setArchiveTarget(null); }}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>归档技能「{archiveTarget?.name}」?</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>{archiveTarget?.slug}</p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <WarnBox>归档后该技能在组织市场<b>不可见、不可安装</b>,也不能提交新版本。已安装成员的本地副本不受影响。可随时恢复。</WarnBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setArchiveTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy} onClick={doArchive}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60"
            style={{ background: '#b91c1c' }}>
            {busy ? '处理中…' : '确认归档'}
          </button>
        </div>
      </Modal>
    </>
  );
};

export default EnterpriseSkillsView;

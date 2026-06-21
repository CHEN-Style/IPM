// H3: enterprise console "云端项目" tab — org-wide workspace governance.
//
// UI baseline: desktop/design/enterprise-workspaces-mockup.html. Admins see
// every workspace in the org (regardless of their own membership) and can
// archive / disable / restore, transfer the workspace owner, and remove
// members. Governance never touches anyone's local files.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, MoreHorizontal, Loader2, RefreshCw, X, Eye, Archive, Ban,
  RotateCcw, ArrowLeftRight, UserX, AlertTriangle, FolderKanban,
  BookMarked, GraduationCap, Lock,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../hooks/useToast.js';
import { avatarColor, fmtDate, fmtRelative, fmtBytes, Modal, WarnBox, InfoBox, FIELD_LABEL } from './shared.jsx';

// ── meta maps ───────────────────────────────────────────────────────────

const DOMAIN_META = {
  projects: { label: '项目', icon: FolderKanban, bg: 'rgba(62,75,156,0.08)', color: '#3e4b9c' },
  cases: { label: '案例', icon: BookMarked, bg: '#fdf4ff', color: '#a21caf' },
  study: { label: '学习', icon: GraduationCap, bg: '#f0fdfa', color: '#0f766e' },
};

const STATUS_META = {
  active: { label: '正常', bg: '#ecfdf5', color: '#2d7a5f' },
  archived: { label: '已归档 · 只读', bg: '#fef3c7', color: '#b45309' },
  disabled: { label: '已停用', bg: '#fef2f2', color: '#b91c1c' },
};

const RISK_LABELS = {
  NO_OWNER: '无 Owner',
  OWNER_DISABLED: 'Owner 已停用',
  NO_VERSION: '无版本',
  INACTIVE: '30 天未活动',
};

function eventText(e) {
  const p = e.payload || {};
  switch (e.eventType) {
    case 'workspace.created': return '创建了项目';
    case 'workspace.joined': return '加入了项目';
    case 'version.committed': return `推送了版本 v${p.versionNumber ?? '?'}`;
    case 'version.milestone': return `将 v${p.versionNumber ?? '?'} 设为里程碑${p.label ? `「${p.label}」` : ''}`;
    case 'version.conflict_auto_kept_both': return '同步时产生冲突副本';
    case 'workspace.archived': return '归档了项目';
    case 'workspace.disabled': return '停用了项目';
    case 'workspace.restored': return '恢复了项目';
    case 'workspace.owner_transferred': return '转移了项目 Owner';
    case 'workspace.member_removed': return '将一名成员移出项目';
    default: return e.eventType;
  }
}

const GOV_EVENTS = new Set([
  'workspace.archived', 'workspace.disabled', 'workspace.restored',
  'workspace.owner_transferred', 'workspace.member_removed',
]);

function StatusTag({ status }) {
  const meta = STATUS_META[status] || STATUS_META.active;
  return (
    <span className="inline-flex items-center whitespace-nowrap text-[11px] font-medium px-2 py-0.5 rounded"
      style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

function DomainGlyph({ domain, size = 30 }) {
  const meta = DOMAIN_META[domain] || DOMAIN_META.projects;
  const Icon = meta.icon;
  return (
    <div className="rounded-lg flex items-center justify-center shrink-0"
      style={{ width: size, height: size, background: meta.bg, color: meta.color }}>
      <Icon size={Math.round(size / 2)} />
    </div>
  );
}

const SECONDARY_BTN = { background: '#fff', border: '1px solid #e8eaf0', color: '#475569' };

// ── main view ───────────────────────────────────────────────────────────

const EnterpriseWorkspacesView = () => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const STATUS_FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '正常' },
    { key: 'archived', label: '已归档' },
    { key: 'disabled', label: '已停用' },
  ];
  const DOMAIN_FILTERS = ['全部', '项目', '案例', '学习'];
  const DOMAIN_KEYS = [null, 'projects', 'cases', 'study'];
  const [statusFilter, setStatusFilter] = useState('all');
  const [domainFilter, setDomainFilter] = useState(0);
  const [query, setQuery] = useState('');

  const [menu, setMenu] = useState(null); // { x, y, ws }
  const [drawer, setDrawer] = useState(null); // { id, name, loading, data, tab }
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [disableTarget, setDisableTarget] = useState(null);
  const [transferState, setTransferState] = useState(null); // { ws, members, selected }
  const [removeTarget, setRemoveTarget] = useState(null); // { ws, member }
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await window.ipm?.org?.listWorkspaces?.();
      if (!res?.ok) throw new Error(res?.error || '加载云端项目失败');
      setWorkspaces(res.workspaces || []);
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

  const openDrawer = useCallback(async (ws, keepTab) => {
    setDrawer((prev) => ({ id: ws.id, name: ws.name, loading: true, data: null, tab: keepTab || prev?.tab || 'members' }));
    const res = await window.ipm?.org?.getWorkspaceDetail?.({ id: ws.id });
    if (res?.ok) {
      setDrawer((prev) => (prev?.id === ws.id ? { ...prev, loading: false, data: res } : prev));
    } else {
      setDrawer((prev) => (prev?.id === ws.id ? { ...prev, loading: false, error: res?.error || '加载详情失败' } : prev));
    }
  }, []);

  const refreshAll = useCallback(async (wsForDrawer) => {
    await loadList();
    if (wsForDrawer && drawer?.id === wsForDrawer.id) {
      await openDrawer(wsForDrawer, drawer?.tab);
    }
  }, [loadList, openDrawer, drawer?.id, drawer?.tab]);

  // ── derived ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const domain = DOMAIN_KEYS[domainFilter];
    return workspaces.filter((w) => {
      if (statusFilter !== 'all' && w.status !== statusFilter) return false;
      if (domain && w.domain !== domain) return false;
      if (q && !w.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [workspaces, statusFilter, domainFilter, query]);

  const stats = useMemo(() => ({
    total: workspaces.length,
    active: workspaces.filter((w) => w.status === 'active').length,
    archived: workspaces.filter((w) => w.status === 'archived').length,
    disabled: workspaces.filter((w) => w.status === 'disabled').length,
    risky: workspaces.filter((w) => w.status !== 'disabled' && (w.risks || []).length > 0).length,
  }), [workspaces]);

  const countByStatus = (key) => (key === 'all' ? workspaces.length : workspaces.filter((w) => w.status === key).length);

  // ── actions ───────────────────────────────────────────────────────────
  const doSetStatus = async (ws, action, successMsg) => {
    setBusy(true);
    try {
      const res = await window.ipm?.org?.setWorkspaceStatus?.({ id: ws.id, action });
      if (!res?.ok) throw new Error(res?.error || '操作失败');
      showToast(successMsg);
      setArchiveTarget(null);
      setDisableTarget(null);
      await refreshAll(ws);
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openTransfer = (ws, members) => {
    const candidates = (members || []).filter((m) => m.role !== 'owner');
    setTransferState({ ws, members: candidates, selected: candidates.find((m) => m.orgStatus === 'active' && m.userStatus === 'active')?.userId || null });
  };

  const doTransfer = async () => {
    const st = transferState;
    if (!st?.selected) return;
    setBusy(true);
    try {
      const res = await window.ipm?.org?.transferWorkspaceOwner?.({ id: st.ws.id, userId: st.selected });
      if (!res?.ok) throw new Error(res?.error || '转移失败');
      showToast('项目 Owner 已转移');
      setTransferState(null);
      await refreshAll(st.ws);
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async () => {
    const t = removeTarget;
    if (!t) return;
    setBusy(true);
    try {
      const res = await window.ipm?.org?.removeWorkspaceMember?.({ id: t.ws.id, userId: t.member.userId });
      if (!res?.ok) throw new Error(res?.error || '移出失败');
      showToast(`已将 ${t.member.displayName} 移出项目`);
      setRemoveTarget(null);
      await refreshAll(t.ws);
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openRowMenu = (e, ws) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: Math.min(r.left, window.innerWidth - 220), y: r.bottom + 4, ws });
  };

  // ── render ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-[13px]" style={{ color: '#94a3b8' }}>
        <Loader2 size={16} className="animate-spin" />加载中…
      </div>
    );
  }

  const detail = drawer?.data;
  const drawerWs = detail?.workspace;

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
          { k: '云端项目', v: <>{stats.total} <small>全企业</small></> },
          { k: '正常协作', v: stats.active },
          { k: '已归档 / 已停用', v: <>{stats.archived} <small>/ {stats.disabled}</small></> },
          { k: '风险项目', v: <span style={stats.risky ? { color: '#b45309' } : undefined}>{stats.risky} {stats.risky > 0 && <small>需关注</small>}</span> },
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
            placeholder="搜索项目名称…"
            className="w-full outline-none text-[12.5px] bg-transparent"
            style={{ color: '#1e293b' }}
          />
        </div>
        <button
          type="button"
          onClick={() => setDomainFilter((domainFilter + 1) % DOMAIN_FILTERS.length)}
          className="px-[11px] py-1.5 rounded-[7px] text-[12.5px] transition-colors shrink-0 whitespace-nowrap"
          style={{ background: '#fff', border: '1px solid #e8eaf0', color: domainFilter ? '#3e4b9c' : '#475569' }}
        >类型:{DOMAIN_FILTERS[domainFilter]}</button>
        <div className="flex-1" />
      </div>

      {/* ── 项目表格 ── */}
      <div className="rounded-[10px] overflow-x-auto" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
        <table className="w-full min-w-[720px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fbfcfd' }}>
              {[['项目', '27%'], ['Owner', '15%'], ['成员', '7%'], ['版本', '7%'], ['最近同步', '12%'], ['状态', '12%'], ['风险', '15%'], ['', '5%']].map(([h, w], i) => (
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
                {workspaces.length === 0 ? '企业内还没有云端项目' : '没有匹配的项目'}
              </td></tr>
            )}
            {filtered.map((w) => {
              const muted = w.status !== 'active';
              const ownerDisabled = w.owner && (w.owner.orgStatus !== 'active' || w.owner.userStatus !== 'active');
              const firstRisk = (w.risks || [])[0];
              return (
                <tr key={w.id} className="group transition-colors hover:bg-slate-50 cursor-pointer" onClick={() => openDrawer(w)}>
                  <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <div className="flex items-center gap-2.5">
                      <div style={{ opacity: muted ? 0.45 : 1 }}><DomainGlyph domain={w.domain} /></div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate" style={{ color: muted ? '#b6bdc9' : '#1e293b' }}>{w.name}</div>
                        <div className="text-[11.5px]" style={{ color: muted ? '#cbd5e1' : '#94a3b8' }}>
                          {DOMAIN_META[w.domain]?.label || w.domain} · {w.domain}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                    {w.owner ? (
                      <div className="flex items-center gap-2 text-[12.5px]" style={{ color: muted ? '#b6bdc9' : '#475569' }}>
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9.5px] font-semibold text-white shrink-0"
                          style={{ background: avatarColor(w.owner.userId), opacity: muted || ownerDisabled ? 0.5 : 1 }}>
                          {(w.owner.displayName || '?').slice(0, 1).toUpperCase()}
                        </span>
                        <span className="truncate" style={ownerDisabled ? { color: '#94a3b8' } : undefined}>
                          {w.owner.displayName}{ownerDisabled ? '(已停用)' : ''}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[12px]" style={{ color: '#b6bdc9' }}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-[11px] text-[12px] whitespace-nowrap" style={{ borderBottom: '1px solid #f1f5f9', color: muted ? '#b6bdc9' : '#64748b' }}>{w.memberCount}</td>
                  <td className="px-4 py-[11px] text-[12px] whitespace-nowrap" style={{ borderBottom: '1px solid #f1f5f9', color: muted ? '#b6bdc9' : '#64748b' }}>
                    {w.currentVersionNumber ? `v${w.currentVersionNumber}` : '—'}
                  </td>
                  <td className="px-4 py-[11px] text-[12px] whitespace-nowrap" style={{ borderBottom: '1px solid #f1f5f9', color: muted ? '#b6bdc9' : '#64748b' }}>
                    {fmtRelative(w.lastVersionAt) || '—'}
                  </td>
                  <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}><StatusTag status={w.status} /></td>
                  <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                    {firstRisk ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: '#fef3c7', color: '#b45309' }}>
                        <AlertTriangle size={10} className="shrink-0" />{RISK_LABELS[firstRisk] || firstRisk}
                      </span>
                    ) : (
                      <span className="text-[12px]" style={{ color: '#b6bdc9' }}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => openRowMenu(e, w)}
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
        点击行打开详情;行尾菜单执行治理操作。已归档 = 成员只读可拉取;已停用 = 成员完全不可访问(本地文件均不受影响)。
      </p>

      {/* ── 行操作菜单 ── */}
      {menu && (
        <div className="fixed z-50 rounded-[9px] p-1"
          style={{ top: menu.y, left: menu.x, minWidth: 188, background: '#fff', border: '1px solid #e8eaf0', boxShadow: '0 4px 24px rgba(15,23,42,0.12), 0 1px 3px rgba(15,23,42,0.08)' }}
          onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { openDrawer(menu.ws); setMenu(null); }}
            className="w-full flex items-start gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
            <Eye size={13} className="mt-0.5" />
            <span>查看详情<span className="block text-[10.5px]" style={{ color: '#94a3b8' }}>成员、版本、事件与风险</span></span>
          </button>
          <div className="h-px my-1 mx-1.5" style={{ background: '#f1f5f9' }} />
          {menu.ws.status === 'active' && (
            <button type="button" disabled={busy} onClick={() => { setArchiveTarget(menu.ws); setMenu(null); }}
              className="w-full flex items-start gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
              <Archive size={13} className="mt-0.5" />
              <span>归档项目<span className="block text-[10.5px]" style={{ color: '#94a3b8' }}>成员只读,可拉取不可推送</span></span>
            </button>
          )}
          {menu.ws.status !== 'active' && (
            <button type="button" disabled={busy} onClick={() => { const ws = menu.ws; setMenu(null); doSetStatus(ws, 'restore', '已恢复为正常协作'); }}
              className="w-full flex items-start gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
              <RotateCcw size={13} className="mt-0.5" />
              <span>恢复项目<span className="block text-[10.5px]" style={{ color: '#94a3b8' }}>恢复为正常协作状态</span></span>
            </button>
          )}
          {menu.ws.status !== 'disabled' && (
            <button type="button" disabled={busy} onClick={() => { setDisableTarget(menu.ws); setMenu(null); }}
              className="w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-red-50" style={{ color: '#b91c1c' }}>
              <Ban size={13} />停用项目
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
                  <DomainGlyph domain={drawerWs?.domain || 'projects'} size={36} />
                  <div className="min-w-0">
                    <h2 className="text-[16px] font-semibold flex items-center gap-2 truncate" style={{ color: '#1e293b' }}>
                      <span className="truncate">{drawer.name}</span>
                      {drawerWs && <StatusTag status={drawerWs.status} />}
                    </h2>
                    <div className="text-[12px] mt-0.5" style={{ color: '#94a3b8' }}>
                      {drawerWs ? `${DOMAIN_META[drawerWs.domain]?.label || drawerWs.domain} · ${drawerWs.domain} · 创建于 ${fmtDate(drawerWs.createdAt)} · 最近同步 ${fmtRelative(drawerWs.lastVersionAt) || '—'}` : ''}
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
              ) : detail && (
                <>
                  <div className="flex gap-2 mt-4">
                    {[
                      ['成员', detail.members.length],
                      ['版本', drawerWs.currentVersionNumber ? `v${drawerWs.currentVersionNumber}` : '—'],
                      ['文件', detail.stats.fileCount],
                      ['存储量', fmtBytes(detail.stats.totalBytes)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex-1 rounded-lg px-3 py-2" style={{ background: '#fbfcfd', border: '1px solid #f1f5f9' }}>
                        <div className="text-[10.5px] uppercase" style={{ color: '#94a3b8', letterSpacing: '0.04em' }}>{k}</div>
                        <div className="text-[15px] font-semibold mt-0.5" style={{ color: '#1e293b' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-[18px] mt-[18px]" style={{ borderBottom: '1px solid #e8eaf0' }}>
                    {[['members', `成员 ${detail.members.length}`], ['versions', '最近版本'], ['events', '事件']].map(([key, label]) => (
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

            {!drawer.loading && detail && (
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {/* 成员 */}
                {drawer.tab === 'members' && (
                  <>
                    {(drawerWs.risks || []).includes('OWNER_DISABLED') && (
                      <div className="mb-3.5">
                        <InfoBox>项目 Owner 的企业账号已停用,owner 专属操作(文件夹结构、里程碑)目前无人可执行,建议转移 Owner。</InfoBox>
                      </div>
                    )}
                    {(drawerWs.risks || []).includes('NO_OWNER') && (
                      <div className="mb-3.5">
                        <InfoBox>该项目没有 Owner,建议从成员中指定一位。</InfoBox>
                      </div>
                    )}
                    {detail.members.length === 0 && (
                      <div className="py-10 text-center text-[13px]" style={{ color: '#94a3b8' }}>暂无成员</div>
                    )}
                    {detail.members.map((m) => {
                      const off = m.orgStatus !== 'active' || m.userStatus !== 'active';
                      const isSelf = m.userId === user?.userId;
                      return (
                        <div key={m.userId} className="group flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11.5px] font-semibold text-white shrink-0"
                            style={{ background: avatarColor(m.userId), opacity: off ? 0.45 : 1 }}>
                            {(m.displayName || '?').slice(0, 1).toUpperCase()}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium truncate" style={{ color: off ? '#b6bdc9' : '#1e293b' }}>
                              {m.displayName}{isSelf ? '(我)' : ''}
                            </div>
                            <div className="text-[11.5px] truncate" style={{ color: off ? '#cbd5e1' : '#94a3b8' }}>{m.email}</div>
                          </div>
                          {off ? (
                            <span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded" style={{ background: '#fef2f2', color: '#b91c1c' }}>企业账号已停用</span>
                          ) : m.role === 'owner' ? (
                            <span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded" style={{ background: '#fef3c7', color: '#b45309' }}>项目 Owner</span>
                          ) : (
                            <span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded" style={{ background: '#f1f5f9', color: '#475569' }}>
                              {m.role === 'viewer' ? 'Viewer' : 'Editor'}
                            </span>
                          )}
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {m.role !== 'owner' && (
                              <button type="button" title="设为项目 Owner" disabled={busy}
                                onClick={() => setTransferState({ ws: drawerWs, members: detail.members.filter((x) => x.role !== 'owner'), selected: m.userId })}
                                className="w-[26px] h-[26px] rounded-md flex items-center justify-center transition-colors hover:bg-slate-100" style={{ color: '#94a3b8' }}>
                                <ArrowLeftRight size={13} />
                              </button>
                            )}
                            {m.role !== 'owner' && (
                              <button type="button" title="移出项目" disabled={busy}
                                onClick={() => setRemoveTarget({ ws: drawerWs, member: m })}
                                className="w-[26px] h-[26px] rounded-md flex items-center justify-center transition-colors hover:bg-red-50" style={{ color: '#94a3b8' }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#b91c1c'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; }}>
                                <UserX size={13} />
                              </button>
                            )}
                            {m.role === 'owner' && (
                              <button type="button" title="转移 Owner(owner 需先转移才能移出)" disabled={busy}
                                onClick={() => openTransfer(drawerWs, detail.members)}
                                className="w-[26px] h-[26px] rounded-md flex items-center justify-center transition-colors hover:bg-slate-100" style={{ color: '#94a3b8' }}>
                                <ArrowLeftRight size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <p className="mt-2.5 text-[11.5px]" style={{ color: '#94a3b8' }}>
                      悬停成员行可转移 Owner 或移出项目;移出不影响其企业账号与本地文件。
                    </p>
                  </>
                )}

                {/* 最近版本 */}
                {drawer.tab === 'versions' && (
                  <>
                    {detail.recentVersions.length === 0 && (
                      <div className="py-10 text-center text-[13px]" style={{ color: '#94a3b8' }}>还没有版本</div>
                    )}
                    {detail.recentVersions.map((v) => (
                      <div key={v.id} className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <span className="text-[12px] font-semibold px-2 py-0.5 rounded shrink-0"
                          style={v.type === 'milestone'
                            ? { background: '#fef3c7', color: '#b45309', fontFamily: '"SF Mono", Menlo, monospace' }
                            : { background: 'rgba(62,75,156,0.08)', color: '#3e4b9c', fontFamily: '"SF Mono", Menlo, monospace' }}>
                          v{v.versionNumber}{v.type === 'milestone' ? ' ★' : ''}
                        </span>
                        <span className="flex-1 text-[12.5px] truncate" style={{ color: '#475569' }}>
                          {v.type === 'milestone' && v.label ? `里程碑:${v.label}` : (v.message || '同步')}
                        </span>
                        <span className="text-[11.5px] shrink-0" style={{ color: '#94a3b8' }}>
                          {v.authorName || '—'} · {fmtRelative(v.createdAt)}
                        </span>
                      </div>
                    ))}
                  </>
                )}

                {/* 事件 */}
                {drawer.tab === 'events' && (
                  <>
                    {detail.recentEvents.length === 0 && (
                      <div className="py-10 text-center text-[13px]" style={{ color: '#94a3b8' }}>暂无事件</div>
                    )}
                    {detail.recentEvents.map((e) => (
                      <div key={e.id} className="flex items-start gap-2.5 py-2" style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <span className="w-[7px] h-[7px] rounded-full mt-[5px] shrink-0"
                          style={{ background: GOV_EVENTS.has(e.eventType) ? '#b45309' : '#cbd5e1' }} />
                        <div className="flex-1 text-[12.5px] leading-relaxed" style={{ color: '#475569' }}>
                          <b className="font-medium" style={{ color: '#1e293b' }}>{e.actorName || '系统'}</b> {eventText(e)}
                        </div>
                        <span className="text-[11.5px] shrink-0" style={{ color: '#94a3b8' }}>{fmtRelative(e.createdAt)}</span>
                      </div>
                    ))}
                    <p className="mt-2.5 text-[11.5px]" style={{ color: '#94a3b8' }}>显示最近 20 条;完整审计查询将在「概览与审计」提供。</p>
                  </>
                )}
              </div>
            )}
          </aside>
        </>
      )}

      {/* ── 弹窗:归档 ── */}
      <Modal open={Boolean(archiveTarget)} onClose={() => setArchiveTarget(null)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>归档项目「{archiveTarget?.name}」?</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>
            {DOMAIN_META[archiveTarget?.domain]?.label} · {archiveTarget?.memberCount} 名成员{archiveTarget?.currentVersionNumber ? ` · 当前 v${archiveTarget.currentVersionNumber}` : ''}
          </p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <InfoBox icon={<Archive size={15} className="shrink-0 mt-0.5" />}>
            归档后项目进入<b>只读</b>状态:成员仍可拉取文件、查看版本历史,但<b>无法推送新变更</b>。本地文件不受影响,可随时恢复。
          </InfoBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setArchiveTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy} onClick={() => doSetStatus(archiveTarget, 'archive', '项目已归档(只读)')}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60" style={{ background: '#b45309' }}>
            {busy ? '处理中…' : '确认归档'}
          </button>
        </div>
      </Modal>

      {/* ── 弹窗:停用 ── */}
      <Modal open={Boolean(disableTarget)} onClose={() => setDisableTarget(null)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>停用项目「{disableTarget?.name}」?</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>
            {DOMAIN_META[disableTarget?.domain]?.label} · {disableTarget?.memberCount} 名成员{disableTarget?.currentVersionNumber ? ` · 当前 v${disableTarget.currentVersionNumber}` : ''}
          </p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <WarnBox>停用后所有成员<b>立即</b>无法推送、拉取或查看此项目,项目从成员的协作列表中消失。云端数据与成员本地文件均保留,可随时恢复。</WarnBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setDisableTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy} onClick={() => doSetStatus(disableTarget, 'disable', '项目已停用')}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60" style={{ background: '#b91c1c' }}>
            {busy ? '处理中…' : '确认停用'}
          </button>
        </div>
      </Modal>

      {/* ── 弹窗:转移 Owner ── */}
      <Modal open={Boolean(transferState)} onClose={() => setTransferState(null)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>转移项目 Owner</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>「{transferState?.ws?.name}」</p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <span style={FIELD_LABEL} className="block mb-[7px]">选择新 Owner(项目现有成员)</span>
          <div className="rounded-[9px] overflow-y-auto mb-3" style={{ border: '1px solid #e8eaf0', maxHeight: 218 }}>
            {(transferState?.members || []).length === 0 && (
              <div className="px-3 py-6 text-center text-[12.5px]" style={{ color: '#94a3b8' }}>项目中没有其他成员可接任 Owner</div>
            )}
            {(transferState?.members || []).map((m) => {
              const off = m.orgStatus !== 'active' || m.userStatus !== 'active';
              const selected = transferState?.selected === m.userId;
              return (
                <button key={m.userId} type="button" disabled={off}
                  onClick={() => setTransferState({ ...transferState, selected: m.userId })}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    background: selected ? 'rgba(62,75,156,0.08)' : '#fff',
                    cursor: off ? 'not-allowed' : 'pointer',
                    opacity: off ? 0.55 : 1,
                  }}>
                  {off ? (
                    <Lock size={12} style={{ color: '#b6bdc9' }} className="shrink-0" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full shrink-0 transition-all"
                      style={{ border: selected ? '4.5px solid #3e4b9c' : '1.5px solid #cbd5e1' }} />
                  )}
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9.5px] font-semibold text-white shrink-0"
                    style={{ background: avatarColor(m.userId) }}>
                    {(m.displayName || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium truncate" style={{ color: '#1e293b' }}>
                      {m.displayName}{off ? '(企业账号已停用)' : ''}
                    </span>
                    <span className="block text-[11.5px] truncate" style={{ color: '#94a3b8' }}>{m.email}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <InfoBox icon={<ArrowLeftRight size={15} className="shrink-0 mt-0.5" />}>
            原 Owner 将降为 Editor;新 Owner 获得文件夹结构调整、里程碑等项目管理权限。
          </InfoBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setTransferState(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy || !transferState?.selected} onClick={doTransfer}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60" style={{ background: '#3e4b9c' }}>
            {busy ? '处理中…' : '确认转移'}
          </button>
        </div>
      </Modal>

      {/* ── 弹窗:移出成员 ── */}
      <Modal open={Boolean(removeTarget)} width={400} onClose={() => setRemoveTarget(null)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>将 {removeTarget?.member?.displayName} 移出此项目?</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>「{removeTarget?.ws?.name}」· {removeTarget?.member?.role === 'viewer' ? 'Viewer' : 'Editor'}</p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <WarnBox>移出后该成员<b>立即</b>无法访问此项目。其企业账号与其他项目不受影响;其本地文件保留。该成员可重新加入。</WarnBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setRemoveTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy} onClick={doRemove}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60" style={{ background: '#b91c1c' }}>
            {busy ? '处理中…' : '确认移出'}
          </button>
        </div>
      </Modal>
    </>
  );
};

export default EnterpriseWorkspacesView;

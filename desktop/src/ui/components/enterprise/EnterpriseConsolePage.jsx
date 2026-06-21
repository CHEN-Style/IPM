// H2: Enterprise console — org member & invite management (owner/admin).
//
// UI baseline: desktop/design/enterprise-console-mockup.html (Linear-style
// top tabs, no nested sidebar). The "成员" tab is functional in H2; the other
// tabs are placeholders that H3/H5/H6/H7 will fill in.
//
// Permission rules are enforced server-side; this page only adapts what it
// shows to the caller's role:
//   * owner rows are immutable (managed by the platform)
//   * admins see member-level actions only
//   * the role-change action is owner-only

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, Plus, Search, Copy, Lock, MoreHorizontal,
  ArrowUp, ArrowDown, Ban, RefreshCw, Loader2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../hooks/useToast.js';
import { avatarColor, fmtDate, fmtRelative, copyText, Modal, WarnBox, FIELD_LABEL } from './shared.jsx';
import EnterpriseWorkspacesView from './EnterpriseWorkspacesView.jsx';
import EnterpriseSkillsView from './EnterpriseSkillsView.jsx';
import EnterpriseConfigView from './EnterpriseConfigView.jsx';
import EnterpriseOverviewView from './EnterpriseOverviewView.jsx';

// ── helpers ─────────────────────────────────────────────────────────────

const ROLE_META = {
  owner: { label: 'Owner', bg: '#fef3c7', color: '#b45309' },
  admin: { label: 'Admin', bg: '#e0e7ff', color: '#3730a3' },
  member: { label: 'Member', bg: '#f1f5f9', color: '#475569' },
};

function RoleTag({ role }) {
  const meta = ROLE_META[role] || ROLE_META.member;
  return (
    <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded"
      style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

// ── main page ───────────────────────────────────────────────────────────

const EnterpriseConsolePage = () => {
  const { user, orgRole } = useAuth();
  const { showToast } = useToast();

  const [org, setOrg] = useState(null);
  const [myRole, setMyRole] = useState(orgRole);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState('members'); // members | workspaces
  const [view, setView] = useState('members'); // members | invites
  const [query, setQuery] = useState('');
  const ROLE_FILTERS = ['全部', 'Owner', 'Admin', 'Member'];
  const STATUS_FILTERS = ['全部', '正常', '已停用'];
  const [roleFilter, setRoleFilter] = useState(0);
  const [statusFilter, setStatusFilter] = useState(0);

  const [menu, setMenu] = useState(null); // { x, y, member }
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteUses, setInviteUses] = useState('10');
  const [inviteDays, setInviteDays] = useState('30');
  const [inviteResult, setInviteResult] = useState(null);
  const [disableTarget, setDisableTarget] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const isOwner = myRole === 'owner';

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [infoRes, membersRes, invitesRes] = await Promise.all([
        window.ipm?.org?.getInfo?.(),
        window.ipm?.org?.listMembers?.(),
        window.ipm?.org?.listInvites?.(),
      ]);
      if (!infoRes?.ok) throw new Error(infoRes?.error || '加载企业信息失败');
      setOrg(infoRes.org);
      setMyRole(infoRes.myRole);
      if (membersRes?.ok) setMembers(membersRes.members || []);
      if (invitesRes?.ok) setInvites(invitesRes.invites || []);
      if (!membersRes?.ok) throw new Error(membersRes?.error || '加载成员列表失败');
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // ── derived data ──────────────────────────────────────────────────────
  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (q && !`${m.displayName} ${m.email}`.toLowerCase().includes(q)) return false;
      const rf = ROLE_FILTERS[roleFilter].toLowerCase();
      if (roleFilter > 0 && m.role !== rf) return false;
      if (statusFilter === 1 && m.status !== 'active') return false;
      if (statusFilter === 2 && m.status === 'active') return false;
      return true;
    });
  }, [members, query, roleFilter, statusFilter]);

  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === 'active').length;
    const admins = members.filter((m) => m.status === 'active' && (m.role === 'admin' || m.role === 'owner')).length;
    const owners = members.filter((m) => m.status === 'active' && m.role === 'owner').length;
    const activeInvites = invites.filter((i) => !i.revokedAt && (!i.expiresAt || new Date(i.expiresAt) > new Date()) && i.usedCount < i.maxUses);
    const remainingUses = activeInvites.reduce((sum, i) => sum + (i.maxUses - i.usedCount), 0);
    const weekAgo = Date.now() - 7 * 86400_000;
    const newThisWeek = members.filter((m) => m.joinedAt && new Date(m.joinedAt).getTime() > weekAgo).length;
    return { active, total: members.length, admins, owners, activeInvites: activeInvites.length, remainingUses, newThisWeek };
  }, [members, invites]);

  // ── actions ───────────────────────────────────────────────────────────
  const handleSetRole = async (member, role) => {
    setMenu(null);
    setBusy(true);
    try {
      const res = await window.ipm?.org?.setMemberRole?.({ userId: member.userId, role });
      if (!res?.ok) throw new Error(res?.error || '调整失败');
      showToast(`已将 ${member.displayName} 调整为 ${ROLE_META[role].label}`);
      await loadAll();
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    const member = disableTarget;
    if (!member) return;
    setBusy(true);
    try {
      const res = await window.ipm?.org?.disableMember?.({ userId: member.userId });
      if (!res?.ok) throw new Error(res?.error || '停用失败');
      showToast(`已停用成员:${member.displayName}`);
      setDisableTarget(null);
      await loadAll();
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (member) => {
    setBusy(true);
    try {
      const res = await window.ipm?.org?.restoreMember?.({ userId: member.userId });
      if (!res?.ok) throw new Error(res?.error || '恢复失败');
      showToast(`已恢复成员:${member.displayName}`);
      await loadAll();
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateInvite = async () => {
    setBusy(true);
    try {
      const res = await window.ipm?.org?.createInvite?.({
        role: inviteRole,
        maxUses: Math.max(1, parseInt(inviteUses, 10) || 10),
        expiresDays: Math.max(1, parseInt(inviteDays, 10) || 30),
      });
      if (!res?.ok) throw new Error(res?.error || '创建失败');
      setInviteResult(res.invite);
      await loadAll();
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    const invite = revokeTarget;
    if (!invite) return;
    setBusy(true);
    try {
      const res = await window.ipm?.org?.revokeInvite?.({ id: invite.id });
      if (!res?.ok) throw new Error(res?.error || '撤销失败');
      showToast('邀请码已撤销');
      setRevokeTarget(null);
      await loadAll();
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openInviteModal = () => {
    setInviteRole('member');
    setInviteUses('10');
    setInviteDays('30');
    setInviteResult(null);
    setInviteOpen(true);
  };

  // ── row action menu ───────────────────────────────────────────────────
  const openRowMenu = (e, member) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: Math.min(r.left, window.innerWidth - 200), y: r.bottom + 4, member });
  };

  const renderRowActions = (m) => {
    const isSelf = m.userId === user?.userId;
    if (m.role === 'owner') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#b6bdc9' }}>
          <Lock size={11} />由平台管理
        </span>
      );
    }
    if (m.status !== 'active') {
      // Restore: members by admin+, admins by owner only.
      const canRestore = m.role === 'member' || isOwner;
      if (!canRestore) return null;
      return (
        <button
          type="button"
          disabled={busy}
          onClick={() => handleRestore(m)}
          className="px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors"
          style={{ background: '#fff', border: '1px solid #e8eaf0', color: '#475569' }}
        >恢复</button>
      );
    }
    // Active non-owner rows: menu when the caller can do something.
    const canAct = (m.role === 'member' && !isSelf) || (m.role === 'admin' && isOwner && !isSelf);
    if (!canAct) return null;
    return (
      <button
        type="button"
        onClick={(e) => openRowMenu(e, m)}
        className="w-[26px] h-[26px] rounded-md flex items-center justify-center transition-colors hover:bg-slate-100"
        style={{ color: '#94a3b8' }}
        title="操作"
      >
        <MoreHorizontal size={14} />
      </button>
    );
  };

  // ── access gate ───────────────────────────────────────────────────────
  if (myRole && myRole !== 'owner' && myRole !== 'admin') {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: '#f8f9fb' }}>
        <div className="text-center">
          <Lock size={36} style={{ color: '#cbd5e1' }} className="mx-auto" />
          <p className="mt-3 text-[14px]" style={{ color: '#64748b' }}>企业管理仅对企业 Owner / Admin 开放</p>
        </div>
      </div>
    );
  }

  const orgStatusOk = org?.status === 'active';

  return (
    <div className="h-full overflow-y-auto" style={{ background: '#f8f9fb' }}>
      <div className="mx-auto" style={{ maxWidth: 1080, padding: '28px clamp(12px,4vw,36px) 60px' }}>

        {/* ── 页头 ── */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-[16px] font-bold"
              style={{ background: 'rgba(62,75,156,0.08)', color: '#3e4b9c' }}>
              {org?.name ? org.name.slice(0, 1) : <Building2 size={18} />}
            </div>
            <div>
              <h1 className="text-[19px] font-semibold flex items-center gap-2" style={{ color: '#1e293b', letterSpacing: '-0.01em' }}>
                {org?.name || '企业管理'}
                {org && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style={orgStatusOk ? { background: '#ecfdf5', color: '#2d7a5f' } : { background: '#fef2f2', color: '#b91c1c' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: orgStatusOk ? '#2d7a5f' : '#b91c1c' }} />
                    {orgStatusOk ? '正常' : '已停用'}
                  </span>
                )}
              </h1>
              <div className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>
                企业管理 · 您的角色:
                <b style={{ color: myRole === 'owner' ? '#b45309' : '#3730a3' }}> {ROLE_META[myRole]?.label || '—'}</b>
              </div>
            </div>
          </div>
          {org && (
            <div className="flex items-center gap-3.5 pt-2.5 text-[12px]" style={{ color: '#94a3b8' }}>
              <span><b style={{ color: '#475569' }}>{org.memberCount}</b> 名成员</span>
              <span><b style={{ color: '#475569' }}>{org.workspaceCount}</b> 个云端项目</span>
              <span>创建于 {fmtDate(org.createdAt)}</span>
            </div>
          )}
        </div>

        {/* ── 顶部 Tab ── */}
        <nav className="flex items-center gap-[22px] mt-[22px] overflow-x-auto no-scrollbar" style={{ borderBottom: '1px solid #e8eaf0' }}>
          {[
            { key: 'members', label: '成员', count: members.length || null },
            { key: 'workspaces', label: '云端项目', count: org?.workspaceCount ?? null },
            { key: 'skills', label: '技能治理', count: null },
            { key: 'config', label: '配置中心', count: null },
            { key: 'overview', label: '概览与审计', count: null },
          ].map((t) => (
            <div
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex items-center gap-1.5 pb-[11px] pt-[9px] text-[13px] cursor-pointer select-none transition-colors shrink-0 whitespace-nowrap"
              style={activeTab === t.key
                ? { color: '#1e293b', fontWeight: 600, borderBottom: '2px solid #3e4b9c', marginBottom: -1 }
                : { color: '#64748b', borderBottom: '2px solid transparent', marginBottom: -1 }}
            >
              {t.label}
              {t.count != null && (
                <span className="text-[11px] font-medium" style={{ color: activeTab === t.key ? '#3e4b9c' : '#94a3b8' }}>{t.count}</span>
              )}
            </div>
          ))}
        </nav>

        {/* ── 云端项目 Tab(H3) ── */}
        {activeTab === 'workspaces' && <EnterpriseWorkspacesView />}

        {/* ── 技能治理 Tab(H5) ── */}
        {activeTab === 'skills' && <EnterpriseSkillsView />}

        {/* ── 配置中心 Tab(H6) ── */}
        {activeTab === 'config' && <EnterpriseConfigView />}

        {/* ── 概览与审计 Tab(H7) ── */}
        {activeTab === 'overview' && <EnterpriseOverviewView />}

        {/* ── 成员 Tab(H2) ── */}
        {activeTab === 'members' && (
        <>
        {/* ── 错误 / 加载 ── */}
        {error && (
          <div className="mt-4 flex items-center justify-between gap-2 text-[13px] px-3 py-2 rounded-lg"
            style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
            <span>{error}</span>
            <button type="button" onClick={loadAll} className="flex items-center gap-1 text-[12px] shrink-0 hover:underline">
              <RefreshCw size={12} />重试
            </button>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-[13px]" style={{ color: '#94a3b8' }}>
            <Loader2 size={16} className="animate-spin" />加载中…
          </div>
        ) : (
          <>
            {/* ── 统计条 ── */}
            <div className="flex flex-wrap gap-2.5 mt-[18px] [&>*]:min-w-[120px]">
              {[
                { k: '活跃成员', v: <>{stats.active} <small>/ {stats.total}</small></> },
                { k: '管理员', v: <>{stats.admins} <small>含 {stats.owners} 位 owner</small></> },
                { k: '有效邀请码', v: <>{stats.activeInvites} <small>剩余 {stats.remainingUses} 次</small></> },
                { k: '本周新加入', v: stats.newThisWeek },
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
              <div className="inline-flex rounded-[7px] p-0.5 shrink-0" style={{ background: '#eef0f4' }}>
                {[['members', `成员`], ['invites', `邀请码 ${invites.length}`]].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setView(key)}
                    className="px-3 py-[5px] rounded-md text-[12.5px] transition-all"
                    style={view === key
                      ? { background: '#fff', color: '#1e293b', fontWeight: 500, boxShadow: '0 1px 2px rgba(15,23,42,0.08)' }
                      : { color: '#64748b' }}
                  >{label}</button>
                ))}
              </div>
              {view === 'members' && (
                <>
                  <div className="flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 flex-1 min-w-[140px] max-w-[220px]" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
                    <Search size={13} style={{ color: '#94a3b8' }} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索姓名或邮箱…"
                      className="w-full outline-none text-[12.5px] bg-transparent"
                      style={{ color: '#1e293b' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setRoleFilter((roleFilter + 1) % ROLE_FILTERS.length)}
                    className="px-[11px] py-1.5 rounded-[7px] text-[12.5px] transition-colors shrink-0 whitespace-nowrap"
                    style={{ background: '#fff', border: '1px solid #e8eaf0', color: roleFilter ? '#3e4b9c' : '#475569' }}
                  >角色:{ROLE_FILTERS[roleFilter]}</button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter((statusFilter + 1) % STATUS_FILTERS.length)}
                    className="px-[11px] py-1.5 rounded-[7px] text-[12.5px] transition-colors shrink-0 whitespace-nowrap"
                    style={{ background: '#fff', border: '1px solid #e8eaf0', color: statusFilter ? '#3e4b9c' : '#475569' }}
                  >状态:{STATUS_FILTERS[statusFilter]}</button>
                </>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={openInviteModal}
                className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors shrink-0 whitespace-nowrap"
                style={{ background: '#3e4b9c' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#34407e'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#3e4b9c'; }}
              >
                <Plus size={13} strokeWidth={2.2} />邀请成员
              </button>
            </div>

            {/* ── 成员表格 ── */}
            {view === 'members' && (
              <>
                <div className="rounded-[10px] overflow-x-auto" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
                  <table className="w-full min-w-[580px]" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#fbfcfd' }}>
                        {['成员', '角色', '状态', '加入时间', '最近活动', ''].map((h, i) => (
                          <th key={h || i} className="text-left px-4 py-[9px] text-[11px] font-medium uppercase"
                            style={{ color: '#94a3b8', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', width: ['30%', '12%', '13%', '14%', '17%', '8%'][i] }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMembers.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: '#94a3b8' }}>
                          {members.length === 0 ? '暂无成员' : '没有匹配的成员'}
                        </td></tr>
                      )}
                      {filteredMembers.map((m) => {
                        const disabled = m.status !== 'active';
                        const isSelf = m.userId === user?.userId;
                        return (
                          <tr key={m.userId} className="group transition-colors hover:bg-slate-50">
                            <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11.5px] font-semibold text-white shrink-0"
                                  style={{ background: avatarColor(m.userId), opacity: disabled ? 0.45 : 1 }}>
                                  {(m.displayName || m.email || '?').slice(0, 1).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-[13px] font-medium truncate" style={{ color: disabled ? '#b6bdc9' : '#1e293b' }}>
                                    {m.displayName}{isSelf ? '(我)' : ''}
                                  </div>
                                  <div className="text-[11.5px] truncate" style={{ color: disabled ? '#cbd5e1' : '#94a3b8' }}>{m.email}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9', opacity: disabled ? 0.55 : 1 }}>
                              <RoleTag role={m.role} />
                            </td>
                            <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: disabled ? '#94a3b8' : '#475569' }}>
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: disabled ? '#cbd5e1' : '#2d7a5f' }} />
                                {disabled ? '已停用' : '正常'}
                              </span>
                            </td>
                            <td className="px-4 py-[11px] text-[12px]" style={{ borderBottom: '1px solid #f1f5f9', color: disabled ? '#b6bdc9' : '#64748b' }}>
                              {fmtDate(m.joinedAt)}
                            </td>
                            <td className="px-4 py-[11px] text-[12px]" style={{ borderBottom: '1px solid #f1f5f9', color: disabled ? '#b6bdc9' : '#64748b' }}>
                              {fmtRelative(m.lastActiveAt || m.lastLoginAt) || '—'}
                            </td>
                            <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <div className={m.role === 'owner' ? 'flex justify-end' : 'flex justify-end opacity-0 group-hover:opacity-100 transition-opacity'}>
                                {renderRowActions(m)}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2.5 text-[11.5px]" style={{ color: '#94a3b8' }}>
                  悬停行尾出现操作按钮;Owner 行不可操作(由平台管理);{isOwner ? 'Admin 调整仅 Owner 可执行。' : '您是 Admin,可邀请与停用普通成员。'}
                </p>
              </>
            )}

            {/* ── 邀请码列表 ── */}
            {view === 'invites' && (
              <>
                <div className="rounded-[10px] overflow-hidden" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
                  {invites.length === 0 && (
                    <div className="px-4 py-10 text-center text-[13px]" style={{ color: '#94a3b8' }}>
                      还没有邀请码,点击右上角「邀请成员」创建一个
                    </div>
                  )}
                  {invites.map((inv) => {
                    const revoked = Boolean(inv.revokedAt);
                    const expired = inv.expiresAt && new Date(inv.expiresAt) < new Date();
                    const usedUp = inv.usedCount >= inv.maxUses;
                    const pct = Math.min(100, Math.round((inv.usedCount / Math.max(1, inv.maxUses)) * 100));
                    return (
                      <div key={inv.id} className="group flex flex-wrap items-center gap-3 gap-y-2 px-4 py-[13px] transition-colors hover:bg-slate-50"
                        style={{ borderBottom: '1px solid #f1f5f9', opacity: revoked ? 0.5 : 1 }}>
                        <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-[12.5px] font-semibold"
                          style={{ background: '#f1f5f9', color: revoked ? '#94a3b8' : '#1e293b', fontFamily: '"SF Mono", "JetBrains Mono", Menlo, monospace', letterSpacing: '0.04em', textDecoration: revoked ? 'line-through' : 'none' }}>
                          {inv.code}
                          {!revoked && (
                            <button type="button" title="复制" className="flex transition-colors hover:text-[#3e4b9c]" style={{ color: '#94a3b8' }}
                              onClick={async () => { (await copyText(inv.code)) ? showToast('邀请码已复制') : showToast('复制失败', 'error'); }}>
                              <Copy size={12} />
                            </button>
                          )}
                        </span>
                        {revoked
                          ? <span className="inline-flex text-[11px] font-medium px-2 py-0.5 rounded" style={{ background: '#fef2f2', color: '#b91c1c' }}>已撤销</span>
                          : <RoleTag role={inv.role} />}
                        <div className="flex-1 flex flex-wrap items-center gap-x-[18px] gap-y-1 text-[12px] min-w-0" style={{ color: '#64748b' }}>
                          <div className="flex items-center gap-2 shrink-0">

                            <span>已用 {inv.usedCount} / {inv.maxUses}</span>
                            <div className="rounded-full overflow-hidden" style={{ width: 64, height: 4, background: '#eef0f4' }}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: revoked ? '#cbd5e1' : '#3e4b9c' }} />
                            </div>
                          </div>
                          <span>
                            {revoked ? `${fmtDate(inv.revokedAt)} 撤销`
                              : expired ? <span style={{ color: '#b45309' }}>已过期</span>
                              : usedUp ? <span style={{ color: '#b45309' }}>次数已用尽</span>
                              : inv.expiresAt ? `${fmtDate(inv.expiresAt)} 过期` : '永久有效'}
                          </span>
                          {inv.createdByName && <span>{inv.createdByName} 创建</span>}
                        </div>
                        {!revoked && (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <button type="button" className="px-2 py-1 rounded-md text-[12px] transition-colors hover:bg-red-50"
                              style={{ color: '#94a3b8' }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = '#b91c1c'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; }}
                              onClick={() => setRevokeTarget(inv)}>撤销</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2.5 text-[11.5px]" style={{ color: '#94a3b8' }}>
                  撤销后的邀请码立即失效,已注册成员不受影响;Admin 邀请码仅 Owner 可创建。
                </p>
              </>
            )}
          </>
        )}
        </>
        )}
      </div>

      {/* ── 行操作菜单 ── */}
      {menu && (
        <div className="fixed z-50 rounded-[9px] p-1"
          style={{ top: menu.y, left: menu.x, minWidth: 168, background: '#fff', border: '1px solid #e8eaf0', boxShadow: '0 4px 24px rgba(15,23,42,0.12), 0 1px 3px rgba(15,23,42,0.08)' }}
          onClick={(e) => e.stopPropagation()}>
          {isOwner && menu.member.role === 'member' && (
            <button type="button" disabled={busy} onClick={() => handleSetRole(menu.member, 'admin')}
              className="w-full flex items-start gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
              <ArrowUp size={13} className="mt-0.5" />
              <span>调整为 Admin<span className="block text-[10.5px]" style={{ color: '#94a3b8' }}>授予企业管理权限</span></span>
            </button>
          )}
          {isOwner && menu.member.role === 'admin' && (
            <button type="button" disabled={busy} onClick={() => handleSetRole(menu.member, 'member')}
              className="w-full flex items-start gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
              <ArrowDown size={13} className="mt-0.5" />
              <span>调整为 Member<span className="block text-[10.5px]" style={{ color: '#94a3b8' }}>收回管理权限</span></span>
            </button>
          )}
          {isOwner && <div className="h-px my-1 mx-1.5" style={{ background: '#f1f5f9' }} />}
          <button type="button" disabled={busy} onClick={() => { setMenu(null); setDisableTarget(menu.member); }}
            className="w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-red-50" style={{ color: '#b91c1c' }}>
            <Ban size={13} />停用成员
          </button>
        </div>
      )}

      {/* ── 弹窗:邀请成员 ── */}
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>邀请成员</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>生成邀请码并发送给同事,对方注册后自动加入企业。</p>
        </div>
        <div className="px-5 pt-4 pb-1">
          {!inviteResult ? (
            <>
              <span style={FIELD_LABEL} className="block mb-[7px]">角色</span>
              <div className="flex flex-col gap-[7px] mb-4">
                <button type="button" onClick={() => setInviteRole('member')}
                  className="flex items-start gap-2.5 rounded-[9px] px-3 py-[11px] text-left transition-all"
                  style={{ border: inviteRole === 'member' ? '1px solid #3e4b9c' : '1px solid #e8eaf0', background: inviteRole === 'member' ? 'rgba(62,75,156,0.08)' : '#fff' }}>
                  <span className="w-3.5 h-3.5 rounded-full mt-px shrink-0 transition-all"
                    style={{ border: inviteRole === 'member' ? '4.5px solid #3e4b9c' : '1.5px solid #cbd5e1' }} />
                  <span>
                    <span className="block text-[13px] font-medium" style={{ color: '#1e293b' }}>Member · 普通成员</span>
                    <span className="block text-[11.5px] mt-0.5 leading-relaxed" style={{ color: '#64748b' }}>参与云端项目协作、使用 Skill 市场与企业 AI 配置。</span>
                  </span>
                </button>
                <button type="button" disabled={!isOwner} onClick={() => isOwner && setInviteRole('admin')}
                  className="flex items-start gap-2.5 rounded-[9px] px-3 py-[11px] text-left transition-all"
                  style={{
                    border: inviteRole === 'admin' ? '1px solid #3e4b9c' : '1px solid #e8eaf0',
                    background: !isOwner ? '#fafbfc' : inviteRole === 'admin' ? 'rgba(62,75,156,0.08)' : '#fff',
                    cursor: isOwner ? 'pointer' : 'not-allowed',
                  }}>
                  {isOwner ? (
                    <span className="w-3.5 h-3.5 rounded-full mt-px shrink-0 transition-all"
                      style={{ border: inviteRole === 'admin' ? '4.5px solid #3e4b9c' : '1.5px solid #cbd5e1' }} />
                  ) : (
                    <Lock size={12} className="mt-0.5 shrink-0" style={{ color: '#b6bdc9' }} />
                  )}
                  <span>
                    <span className="block text-[13px] font-medium" style={{ color: isOwner ? '#1e293b' : '#b6bdc9' }}>Admin · 管理员</span>
                    <span className="block text-[11.5px] mt-0.5 leading-relaxed" style={{ color: isOwner ? '#64748b' : '#b6bdc9' }}>
                      {isOwner ? '额外可管理普通成员、审核 Skill、管理企业配置。' : '管理员邀请码仅企业 Owner 可创建。'}
                    </span>
                  </span>
                </button>
                <div className="flex items-start gap-2.5 rounded-[9px] px-3 py-[11px]" style={{ border: '1px solid #e8eaf0', background: '#fafbfc', cursor: 'not-allowed' }}>
                  <Lock size={12} className="mt-0.5 shrink-0" style={{ color: '#b6bdc9' }} />
                  <span>
                    <span className="block text-[13px] font-medium" style={{ color: '#b6bdc9' }}>Owner · 企业所有者</span>
                    <span className="block text-[11.5px] mt-0.5" style={{ color: '#b6bdc9' }}>由 IPM 平台指定,无法通过邀请码创建。</span>
                  </span>
                </div>
              </div>
              <div className="flex gap-2.5 mb-4">
                <div className="flex-1">
                  <span style={FIELD_LABEL} className="block mb-[7px]">可使用次数</span>
                  <input value={inviteUses} onChange={(e) => setInviteUses(e.target.value.replace(/[^0-9]/g, ''))}
                    className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none"
                    style={{ border: '1px solid #e8eaf0', color: '#1e293b' }} />
                </div>
                <div className="flex-1">
                  <span style={FIELD_LABEL} className="block mb-[7px]">有效期(天)</span>
                  <input value={inviteDays} onChange={(e) => setInviteDays(e.target.value.replace(/[^0-9]/g, ''))}
                    className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none"
                    style={{ border: '1px solid #e8eaf0', color: '#1e293b' }} />
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[9px] px-4 py-3.5 text-center mb-1" style={{ border: '1px dashed #c3c9e8', background: 'rgba(62,75,156,0.08)' }}>
              <div className="text-[19px] font-bold" style={{ color: '#3e4b9c', fontFamily: '"SF Mono", "JetBrains Mono", Menlo, monospace', letterSpacing: '0.08em' }}>
                {inviteResult.code}
              </div>
              <div className="text-[11.5px] mt-1.5" style={{ color: '#64748b' }}>
                {ROLE_META[inviteResult.role]?.label} · 可用 {inviteResult.maxUses} 次{inviteResult.expiresAt ? ` · ${fmtDate(inviteResult.expiresAt)} 过期` : ''}
              </div>
              <button type="button"
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-medium transition-all"
                style={{ background: '#fff', border: '1px solid #c3c9e8', color: '#3e4b9c' }}
                onClick={async () => { (await copyText(inviteResult.code)) ? showToast('邀请码已复制') : showToast('复制失败', 'error'); }}>
                <Copy size={12} />复制邀请码
              </button>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setInviteOpen(false)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50"
            style={{ background: '#fff', border: '1px solid #e8eaf0', color: '#475569' }}>关闭</button>
          {!inviteResult && (
            <button type="button" disabled={busy} onClick={handleCreateInvite}
              className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60"
              style={{ background: '#3e4b9c' }}>
              {busy ? '生成中…' : '生成邀请码'}
            </button>
          )}
        </div>
      </Modal>

      {/* ── 弹窗:停用成员 ── */}
      <Modal open={Boolean(disableTarget)} width={400} onClose={() => setDisableTarget(null)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>停用成员「{disableTarget?.displayName}」?</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>{disableTarget?.email}</p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <WarnBox>该成员将<b>立即</b>无法登录、同步云端项目、访问 Skill 市场与企业配置。本地文件不受影响,随时可恢复。</WarnBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setDisableTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50"
            style={{ background: '#fff', border: '1px solid #e8eaf0', color: '#475569' }}>取消</button>
          <button type="button" disabled={busy} onClick={handleDisable}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60"
            style={{ background: '#b91c1c' }}>
            {busy ? '处理中…' : '确认停用'}
          </button>
        </div>
      </Modal>

      {/* ── 弹窗:撤销邀请码 ── */}
      <Modal open={Boolean(revokeTarget)} width={400} onClose={() => setRevokeTarget(null)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>撤销邀请码 {revokeTarget?.code}?</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>
            {ROLE_META[revokeTarget?.role]?.label} · 已使用 {revokeTarget?.usedCount} / {revokeTarget?.maxUses} 次
          </p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <WarnBox>撤销后此邀请码立即失效,无法再用于注册。已通过它加入的成员<b>不受影响</b>。</WarnBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setRevokeTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50"
            style={{ background: '#fff', border: '1px solid #e8eaf0', color: '#475569' }}>取消</button>
          <button type="button" disabled={busy} onClick={handleRevoke}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60"
            style={{ background: '#b91c1c' }}>
            {busy ? '处理中…' : '确认撤销'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default EnterpriseConsolePage;

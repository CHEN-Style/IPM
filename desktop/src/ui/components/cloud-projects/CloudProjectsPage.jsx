import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder, Briefcase, GraduationCap, Lock, Globe, Users, Loader2, Search,
  MoreHorizontal, Copy, Check, KeyRound, Plus, FolderOpen,
  Pencil, Eye, ArrowLeftRight, UserMinus, RefreshCw,
} from 'lucide-react';
import { avatarColor, fmtDate, fmtRelative, fmtBytes, copyText } from '../enterprise/shared.jsx';

// H4: Cloud project management hub.
//
// "我的项目" lists only workspaces the user is a member of (created or
// joined); "公开项目" lists owner-published discoverable workspaces that can
// be self-joined read-only. Clicking a row opens the project detail where the
// owner manages members, invite codes and visibility. File browsing and sync
// stay in 我的资料 — pulling a local copy remains available from the detail.
// Visual language follows desktop/design/cloud-projects-mockup.html (Linear
// style: full-width hairline rows, pill filters, main + right rail detail).

const C = {
  bg: '#fcfcfc', bgHover: '#f6f6f7', bgActive: '#f0f0f2',
  border: '#ececee', borderSoft: '#f2f2f4',
  t1: '#18181b', t2: '#52525b', t3: '#8f8f98', t4: '#b4b4bc',
  accent: '#5e6ad2', accentSoft: '#eef0fb',
  green: '#2e9e6b', amber: '#c08a26', red: '#c5483e',
};

const DOMAIN_LABEL = { cases: '案件', projects: '项目', study: '学习' };
const DOMAIN_ICON = { cases: Briefcase, projects: Folder, study: GraduationCap };
const DOMAIN_TINT = { cases: '#b65fb4', projects: '#6e79d6', study: '#3aa99a' };
const ROLE_LABEL = { owner: 'Owner', editor: '协作', viewer: '只读' };

function DomainGlyph({ domain, size = 15 }) {
  const Icon = DOMAIN_ICON[domain] || Folder;
  return <Icon size={size} style={{ color: DOMAIN_TINT[domain] || DOMAIN_TINT.projects, flexShrink: 0 }} />;
}

function Chip({ tone, icon, children }) {
  const tones = {
    owner: { color: C.amber, border: '#eadfc3' },
    editor: { color: C.accent, border: '#dadef4' },
    viewer: { color: C.t3, border: C.border },
    public: { color: C.green, border: '#cfe7db' },
    default: { color: C.t3, border: C.border },
  };
  const t = tones[tone] || tones.default;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap"
      style={{ fontSize: 11, color: t.color, padding: '1px 7px', border: `1px solid ${t.border}`, borderRadius: 999, background: '#fff' }}>
      {icon}{children}
    </span>
  );
}

function RoleChip({ role }) {
  return <Chip tone={role}>{ROLE_LABEL[role] || role}</Chip>;
}

function VisChip({ visibility }) {
  return visibility === 'public'
    ? <Chip tone="public" icon={<Globe size={10} />}>公开</Chip>
    : <Chip icon={<Lock size={10} />}>私有</Chip>;
}

function Health({ tone, children }) {
  const colors = { ok: C.green, pending: C.accent, idle: C.t3, warn: C.amber };
  const color = colors[tone] || C.t3;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" style={{ fontSize: 12, color }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone === 'idle' ? '#d4d4d8' : color, flexShrink: 0 }} />
      {children}
    </span>
  );
}

function Btn({ primary, danger, ghost, disabled, onClick, children, title, style }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 6,
    padding: '4px 10px', fontSize: 12, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap', transition: 'all 0.1s', opacity: disabled ? 0.5 : 1,
    background: 'transparent', border: `1px solid ${C.border}`, color: C.t2,
    ...(primary ? { background: C.accent, borderColor: C.accent, color: '#fff' } : {}),
    ...(danger ? { background: C.red, borderColor: C.red, color: '#fff' } : {}),
    ...(ghost ? { borderColor: 'transparent', color: C.t3 } : {}),
    ...style,
  };
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title} style={base}>{children}</button>
  );
}

function IconBtn({ onClick, title, children }) {
  return (
    <button type="button" title={title}
      onClick={onClick}
      className="inline-flex items-center justify-center transition-colors"
      style={{ width: 24, height: 24, borderRadius: 5, border: 0, background: 'transparent', color: C.t3, cursor: 'pointer' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.bgActive; e.currentTarget.style.color = C.t1; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.t3; }}>
      {children}
    </button>
  );
}

function Pill({ on, onClick, children, count }) {
  return (
    <span onClick={onClick}
      className="inline-flex items-center gap-1.5 select-none whitespace-nowrap"
      style={{
        padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', transition: 'all 0.1s',
        color: on ? C.t1 : C.t3, fontWeight: on ? 500 : 400,
        background: on ? C.bgActive : 'transparent', border: `1px solid ${on ? C.border : 'transparent'}`,
      }}>
      {children}
      {count != null && <span style={{ fontSize: 11, color: on ? C.t3 : C.t4 }}>{count}</span>}
    </span>
  );
}

function ModalShell({ open, onClose, title, sub, children, footer, width = 420 }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center" style={{ background: 'rgba(0,0,0,0.25)', paddingTop: '14vh' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width, background: '#fff', borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 16px 48px rgba(0,0,0,0.16)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px 0' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: C.t1 }}>{title}</h3>
          {sub && <p style={{ fontSize: 12, color: C.t3, marginTop: 3 }}>{sub}</p>}
        </div>
        <div style={{ padding: '14px 18px 2px' }}>{children}</div>
        <div className="flex justify-end gap-2" style={{ padding: '14px 18px' }}>{footer}</div>
      </div>
    </div>
  );
}

function NoteBox({ tone, children }) {
  const edge = tone === 'warn' ? C.red : tone === 'ok' ? C.green : C.t4;
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderLeft: `2px solid ${edge}`, borderRadius: 6,
      padding: '9px 12px', fontSize: 12, color: C.t2, lineHeight: 1.6, background: '#fafafb',
    }}>
      {children}
    </div>
  );
}

const INPUT_STYLE = {
  width: '100%', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px',
  fontSize: 13, color: C.t1, outline: 'none', background: '#fff',
};

const MONO = '"SF Mono", "JetBrains Mono", Menlo, monospace';

function statusHealth(ws) {
  if (ws.status === 'archived') return { tone: 'warn', text: '已归档 · 只读' };
  if (ws.myRole === 'viewer') return { tone: 'idle', text: '只读 · 可拉取' };
  if (!ws.currentVersionNumber) return { tone: 'idle', text: '暂无版本' };
  return { tone: 'ok', text: '正常' };
}

const CloudProjectsPage = ({ onOpenLocal }) => {
  // ── List state ──────────────────────────────────────────────────────
  const [view, setView] = useState('list'); // 'list' | 'detail'
  const [topTab, setTopTab] = useState('mine'); // 'mine' | 'public'
  const [mineFilter, setMineFilter] = useState('all'); // all | created | joined
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState([]);
  const [pub, setPub] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [me, setMe] = useState(null); // { userId }

  // ── Detail state ────────────────────────────────────────────────────
  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [overview, setOverview] = useState(null); // { workspace, myRole, stats, recentVersions }
  const [members, setMembers] = useState(null); // { myRole, members }
  const [invites, setInvites] = useState(null); // array
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Action / modal state ────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const [menu, setMenu] = useState(null); // { member, x, y }
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinResult, setJoinResult] = useState(null); // { workspaceName, alreadyMember }
  const [joinErr, setJoinErr] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteMaxUses, setInviteMaxUses] = useState('10');
  const [inviteDays, setInviteDays] = useState('30');
  const [inviteResult, setInviteResult] = useState(null); // created invite
  const [revokeTarget, setRevokeTarget] = useState(null); // invite
  const [visOpen, setVisOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null); // member
  const [transferTarget, setTransferTarget] = useState(null); // member
  const [pullProgress, setPullProgress] = useState(null); // { step, status, current, total }
  const [pulledLocal, setPulledLocal] = useState(null); // { projectName, domain }
  const [copiedCode, setCopiedCode] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }, []);

  // ── Loaders ─────────────────────────────────────────────────────────
  const loadLists = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [mineRes, pubRes] = await Promise.all([
        window.ipm?.cloud?.listWorkspaces?.(),
        window.ipm?.cloud?.listPublicWorkspaces?.(),
      ]);
      if (mineRes?.ok) setMine(mineRes.workspaces || []);
      else setError(mineRes?.error || '加载失败');
      if (pubRes?.ok) setPub(pubRes.workspaces || []);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.ipm?.auth?.getStatus?.();
        const user = res?.user || res?.currentUser || null;
        if (user?.userId || user?.id) setMe({ userId: user.userId || user.id });
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    const off = window.ipm?.cloud?.onPullProgress?.((data) => {
      if (!detailId || data?.workspaceId !== detailId) return;
      setPullProgress(data);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [detailId]);

  const loadDetail = useCallback(async (wsId, { withInvites } = {}) => {
    setDetailLoading(true);
    try {
      const [ov, mem] = await Promise.all([
        window.ipm?.cloud?.getWorkspaceOverview?.({ workspaceId: wsId }),
        window.ipm?.cloud?.listWorkspaceMembers?.({ workspaceId: wsId }),
      ]);
      if (ov?.ok) setOverview(ov);
      if (mem?.ok) setMembers(mem);
      const amOwner = (ov?.myRole || mem?.myRole) === 'owner';
      if (amOwner || withInvites) {
        const inv = await window.ipm?.cloud?.listInvites?.({ workspaceId: wsId });
        if (inv?.ok) setInvites(inv.invites || []);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openDetail = useCallback((ws) => {
    setDetailId(ws.id);
    setDetailTab('overview');
    setOverview(null);
    setMembers(null);
    setInvites(null);
    setPullProgress(null);
    setPulledLocal(null);
    setView('detail');
    loadDetail(ws.id);
  }, [loadDetail]);

  const backToList = useCallback(() => {
    setView('list');
    setDetailId(null);
    loadLists();
  }, [loadLists]);

  // ── Derived data ────────────────────────────────────────────────────
  const detailWs = overview?.workspace || mine.find((w) => w.id === detailId) || null;
  const myRole = overview?.myRole || members?.myRole || mine.find((w) => w.id === detailId)?.myRole || null;
  const amOwner = myRole === 'owner';

  const filteredMine = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mine.filter((w) => {
      if (mineFilter === 'created' && w.myRole !== 'owner') return false;
      if (mineFilter === 'joined' && w.myRole === 'owner') return false;
      if (q && !`${w.name} ${w.description || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [mine, mineFilter, search]);

  const filteredPub = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pub.filter((w) => !q || `${w.name} ${w.description || ''} ${w.ownerName || ''}`.toLowerCase().includes(q));
  }, [pub, search]);

  const createdCount = mine.filter((w) => w.myRole === 'owner').length;
  const joinedCount = mine.length - createdCount;
  const activeInvites = (invites || []).filter((i) => i.active);

  // ── Actions ─────────────────────────────────────────────────────────
  const handleJoinPublic = useCallback(async (ws) => {
    setBusy(true);
    try {
      const res = await window.ipm?.cloud?.joinWorkspace?.({ workspaceId: ws.id });
      if (res?.ok) {
        showToast(res.alreadyMember ? '你已是该项目成员' : `已以只读身份加入「${ws.name}」`);
        loadLists();
      } else {
        showToast(res?.error || '加入失败');
      }
    } finally {
      setBusy(false);
    }
  }, [loadLists, showToast]);

  const handleJoinByCode = useCallback(async () => {
    const code = joinCode.trim();
    if (!code) return;
    setBusy(true);
    setJoinErr('');
    try {
      const res = await window.ipm?.cloud?.joinByCode?.({ code });
      if (res?.ok) {
        setJoinResult({ workspaceName: res.workspaceName, alreadyMember: res.alreadyMember });
        loadLists();
      } else {
        setJoinErr(res?.error || '邀请码无效或已失效。');
      }
    } finally {
      setBusy(false);
    }
  }, [joinCode, loadLists]);

  const handleCreateInvite = useCallback(async () => {
    const maxUses = Math.max(1, parseInt(inviteMaxUses, 10) || 1);
    const days = inviteDays.trim() === '' ? null : Math.max(1, parseInt(inviteDays, 10) || 1);
    setBusy(true);
    try {
      const res = await window.ipm?.cloud?.createInvite?.({ workspaceId: detailId, maxUses, expiresInDays: days });
      if (res?.ok) {
        setInviteResult(res.invite);
        const inv = await window.ipm?.cloud?.listInvites?.({ workspaceId: detailId });
        if (inv?.ok) setInvites(inv.invites || []);
      } else {
        showToast(res?.error || '生成失败');
      }
    } finally {
      setBusy(false);
    }
  }, [detailId, inviteMaxUses, inviteDays, showToast]);

  const handleRevokeInvite = useCallback(async () => {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      const res = await window.ipm?.cloud?.revokeInvite?.({ workspaceId: detailId, inviteId: revokeTarget.id });
      if (res?.ok) {
        showToast('邀请码已撤销');
        setRevokeTarget(null);
        const inv = await window.ipm?.cloud?.listInvites?.({ workspaceId: detailId });
        if (inv?.ok) setInvites(inv.invites || []);
      } else {
        showToast(res?.error || '撤销失败');
      }
    } finally {
      setBusy(false);
    }
  }, [detailId, revokeTarget, showToast]);

  const handleSetVisibility = useCallback(async () => {
    const next = detailWs?.visibility === 'public' ? 'private' : 'public';
    setBusy(true);
    try {
      const res = await window.ipm?.cloud?.setVisibility?.({ workspaceId: detailId, visibility: next });
      if (res?.ok) {
        showToast(next === 'public' ? '项目已设为公开' : '项目已改回私有');
        setVisOpen(false);
        loadDetail(detailId);
      } else {
        showToast(res?.error || '操作失败');
      }
    } finally {
      setBusy(false);
    }
  }, [detailId, detailWs, loadDetail, showToast]);

  const handleSetRole = useCallback(async (member, role) => {
    setBusy(true);
    try {
      const res = await window.ipm?.cloud?.setMemberRole?.({ workspaceId: detailId, userId: member.userId, role });
      if (res?.ok) {
        showToast(role === 'editor' ? `已为 ${member.displayName} 开通协作权限` : `已将 ${member.displayName} 调整为只读`);
        loadDetail(detailId);
      } else {
        showToast(res?.error || '操作失败');
      }
    } finally {
      setBusy(false);
    }
  }, [detailId, loadDetail, showToast]);

  const handleRemoveMember = useCallback(async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      const res = await window.ipm?.cloud?.removeMember?.({ workspaceId: detailId, userId: removeTarget.userId });
      if (res?.ok) {
        showToast(`已将 ${removeTarget.displayName} 移出项目`);
        setRemoveTarget(null);
        loadDetail(detailId);
      } else {
        showToast(res?.error || '移出失败');
      }
    } finally {
      setBusy(false);
    }
  }, [detailId, removeTarget, loadDetail, showToast]);

  const handleTransferOwner = useCallback(async () => {
    if (!transferTarget) return;
    setBusy(true);
    try {
      const res = await window.ipm?.cloud?.transferOwner?.({ workspaceId: detailId, newOwnerId: transferTarget.userId });
      if (res?.ok) {
        showToast(`已将项目 Owner 转移给 ${transferTarget.displayName}`);
        setTransferTarget(null);
        loadDetail(detailId);
      } else {
        showToast(res?.error || '转移失败');
      }
    } finally {
      setBusy(false);
    }
  }, [detailId, transferTarget, loadDetail, showToast]);

  const handlePull = useCallback(async () => {
    if (!detailWs) return;
    setBusy(true);
    setPullProgress({ step: 'fetching', status: 'running' });
    try {
      const res = await window.ipm?.cloud?.pull?.({ workspaceId: detailWs.id, name: detailWs.name, domain: detailWs.domain });
      if (res?.ok) {
        setPulledLocal({ projectName: res.projectName, domain: res.domain });
        showToast('已拉取到本地副本');
      } else {
        showToast(res?.error || '拉取失败');
        setPullProgress(null);
      }
    } finally {
      setBusy(false);
    }
  }, [detailWs, showToast]);

  const handleCopy = useCallback(async (code) => {
    const ok = await copyText(code);
    if (ok) {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(''), 1600);
    }
    showToast(ok ? '已复制邀请码' : '复制失败');
  }, [showToast]);

  // Close member menu on outside click.
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  // ── Shared sub-renders ──────────────────────────────────────────────
  const colHead = (cols) => (
    <div className="flex items-center whitespace-nowrap select-none" style={{ padding: '6px 20px', fontSize: 11.5, color: C.t4, borderBottom: `1px solid ${C.borderSoft}` }}>
      {cols}
    </div>
  );

  const renderMineRow = (ws) => {
    const health = statusHealth(ws);
    const muted = ws.status === 'archived';
    return (
      <div key={ws.id}
        className="flex items-center whitespace-nowrap cursor-pointer group"
        style={{ padding: '0 20px', height: 46, borderBottom: `1px solid ${C.borderSoft}`, opacity: muted ? 0.62 : 1 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        onClick={() => openDetail(ws)}>
        <div className="flex items-center gap-2.5 min-w-0" style={{ flex: 1 }}>
          <DomainGlyph domain={ws.domain} />
          <span className="truncate" style={{ fontSize: 13, fontWeight: 500, color: C.t1 }}>{ws.name}</span>
          {ws.myRole !== 'owner' && ws.ownerName && (
            <span style={{ fontSize: 12, color: C.t4 }}>· {ws.ownerName}</span>
          )}
        </div>
        <span style={{ width: 90, flexShrink: 0 }}><RoleChip role={ws.myRole} /></span>
        <span style={{ width: 80, flexShrink: 0 }}><VisChip visibility={ws.visibility} /></span>
        <span style={{ width: 64, flexShrink: 0, fontSize: 12, color: C.t3 }}>{ws.memberCount}</span>
        <span style={{ width: 64, flexShrink: 0, fontSize: 12, color: C.t3 }}>{ws.currentVersionNumber ? `v${ws.currentVersionNumber}` : '—'}</span>
        <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: C.t3 }}>{fmtRelative(ws.updatedAt) || '—'}</span>
        <span style={{ width: 150, flexShrink: 0 }}><Health tone={health.tone}>{health.text}</Health></span>
        <span className="opacity-0 group-hover:opacity-100 flex justify-end transition-opacity" style={{ width: 32, flexShrink: 0 }}>
          <IconBtn title="查看详情" onClick={(e) => { e.stopPropagation(); openDetail(ws); }}>
            <MoreHorizontal size={14} />
          </IconBtn>
        </span>
      </div>
    );
  };

  const renderPubRow = (ws) => (
    <div key={ws.id}
      className="flex items-center whitespace-nowrap group"
      style={{ padding: '0 20px', height: 52, borderBottom: `1px solid ${C.borderSoft}` }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      <div className="flex flex-col justify-center min-w-0" style={{ flex: 1, gap: 1 }}>
        <span className="flex items-center gap-2.5 max-w-full">
          <DomainGlyph domain={ws.domain} />
          <span className="truncate" style={{ fontSize: 13, fontWeight: 500, color: C.t1 }}>{ws.name}</span>
        </span>
        {ws.description && (
          <span className="truncate" style={{ fontSize: 12, color: C.t3, paddingLeft: 26 }}>{ws.description}</span>
        )}
      </div>
      <span className="flex items-center gap-1.5" style={{ width: 200, flexShrink: 0, fontSize: 12, color: C.t3 }}>
        <span className="inline-flex items-center justify-center" style={{ width: 18, height: 18, borderRadius: '50%', background: avatarColor(ws.ownerName), color: '#fff', fontSize: 9, fontWeight: 600 }}>
          {(ws.ownerName || '?').slice(0, 1)}
        </span>
        {ws.ownerName || '—'}
      </span>
      <span style={{ width: 64, flexShrink: 0, fontSize: 12, color: C.t3 }}>{ws.memberCount}</span>
      <span style={{ width: 64, flexShrink: 0, fontSize: 12, color: C.t3 }}>{ws.currentVersionNumber ? `v${ws.currentVersionNumber}` : '—'}</span>
      <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: C.t3 }}>{fmtRelative(ws.updatedAt) || '—'}</span>
      <span className="flex justify-end" style={{ width: 96, flexShrink: 0 }}>
        {ws.isMember ? (
          <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: C.t3 }}>
            <Check size={12} style={{ color: C.green }} />已加入
          </span>
        ) : (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
            <Btn disabled={busy} onClick={() => handleJoinPublic(ws)}>加入(只读)</Btn>
          </span>
        )}
      </span>
    </div>
  );

  // ── Detail renders ──────────────────────────────────────────────────
  const renderOverviewTab = () => {
    const ws = detailWs;
    if (!ws) return null;
    const stats = overview?.stats;
    const versions = overview?.recentVersions || [];
    const memberRows = members?.members || [];
    const editors = memberRows.filter((m) => m.role === 'editor').length;
    const viewers = memberRows.filter((m) => m.role === 'viewer').length;
    const health = statusHealth({ ...ws, myRole });
    return (
      <div className="flex min-h-0" style={{ flex: 1 }}>
        <div className="min-w-0 overflow-y-auto" style={{ flex: 1, padding: '28px 40px 60px' }}>
          <div style={{ maxWidth: 660 }}>
            <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 8, background: C.bgActive, marginBottom: 12 }}>
              <DomainGlyph domain={ws.domain} size={18} />
            </div>
            <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3, color: C.t1 }}>{ws.name}</h1>
            {ws.description && <div style={{ fontSize: 13, color: C.t3, marginTop: 6 }}>{ws.description}</div>}

            {pullProgress && pullProgress.status !== 'done' && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', marginTop: 22 }}>
                <div className="flex items-center gap-2" style={{ fontSize: 12, color: C.t3 }}>
                  {pullProgress.status === 'error'
                    ? <Health tone="warn">拉取失败:{pullProgress.error || ''}</Health>
                    : <Health tone="pending">正在拉取本地副本… {pullProgress.total > 0 ? `(${pullProgress.current}/${pullProgress.total})` : ''}</Health>}
                </div>
              </div>
            )}
            {pulledLocal && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', marginTop: 22 }}>
                <div className="flex items-center justify-between gap-3">
                  <Health tone="ok">已拉取本地副本「{pulledLocal.projectName}」</Health>
                  <Btn onClick={() => onOpenLocal?.(pulledLocal.domain)}><FolderOpen size={13} />在我的资料中打开</Btn>
                </div>
              </div>
            )}

            <div style={{ marginTop: 28 }}>
              <div className="flex items-center justify-between" style={{ fontSize: 12, fontWeight: 500, color: C.t3, paddingBottom: 7, borderBottom: `1px solid ${C.borderSoft}` }}>
                最近版本 <span style={{ fontSize: 11.5, color: C.t4, fontWeight: 400 }}>完整历史在「我的资料」中查看</span>
              </div>
              {detailLoading && !versions.length ? (
                <div className="flex items-center gap-2" style={{ padding: '12px 2px', fontSize: 12, color: C.t4 }}>
                  <Loader2 size={12} className="animate-spin" />加载中…
                </div>
              ) : versions.length === 0 ? (
                <div style={{ padding: '12px 2px', fontSize: 12, color: C.t4 }}>还没有任何版本</div>
              ) : versions.map((v) => (
                <div key={v.id} className="flex items-center gap-2.5 whitespace-nowrap" style={{ padding: '9px 2px', borderBottom: `1px solid ${C.borderSoft}`, fontSize: 12.5 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11.5, color: v.type === 'milestone' ? C.amber : C.t3, width: 52, flexShrink: 0 }}>
                    v{v.versionNumber}{v.type === 'milestone' ? ' ★' : ''}
                  </span>
                  <span className="truncate" style={{ flex: 1, minWidth: 0, color: C.t2 }}>
                    {v.type === 'milestone' && v.label ? `里程碑:${v.label}` : v.message}
                  </span>
                  <span style={{ fontSize: 11.5, color: C.t4, flexShrink: 0 }}>
                    {v.authorName ? `${v.authorName} · ` : ''}{fmtRelative(v.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="overflow-y-auto" style={{ width: 264, flexShrink: 0, borderLeft: `1px solid ${C.border}`, padding: '18px 18px 40px' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: C.t3, marginBottom: 10 }}>属性</div>
            <RailProp k="可见性"><VisChip visibility={ws.visibility} /></RailProp>
            <RailProp k="状态"><Health tone={ws.status === 'archived' ? 'warn' : 'ok'}>{ws.status === 'archived' ? '已归档' : '正常'}</Health></RailProp>
            <RailProp k="Owner">
              <span className="inline-flex items-center justify-center" style={{ width: 16, height: 16, borderRadius: '50%', background: avatarColor(ws.ownerName), color: '#fff', fontSize: 8, fontWeight: 600 }}>
                {(ws.ownerName || '?').slice(0, 1)}
              </span>
              {ws.ownerName || '—'}{amOwner ? '(我)' : ''}
            </RailProp>
            <RailProp k="类型">{DOMAIN_LABEL[ws.domain] || ws.domain} · {ws.domain}</RailProp>
            <RailProp k="创建于">{fmtDate(ws.createdAt)}</RailProp>
          </div>
          <div style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 14, marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: C.t3, marginBottom: 10 }}>数据</div>
            <RailProp k="成员">{memberRows.length || '—'}{memberRows.length ? `(协作 ${editors} · 只读 ${viewers})` : ''}</RailProp>
            <RailProp k="当前版本">{versions[0] ? `v${versions[0].versionNumber}` : '—'}</RailProp>
            <RailProp k="文件">{stats ? `${stats.fileCount} 个` : '—'}</RailProp>
            <RailProp k="存储量">{stats ? fmtBytes(stats.totalBytes) : '—'}</RailProp>
            {amOwner && <RailProp k="邀请码">{invites === null ? '—' : `${activeInvites.length} 个有效`}</RailProp>}
          </div>
          <div style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 14, marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: C.t3, marginBottom: 10 }}>操作</div>
            <RailLink onClick={handlePull} disabled={busy || !versions.length}>拉取本地副本…</RailLink>
            {amOwner && ws.status !== 'archived' && (
              <RailLink onClick={() => setVisOpen(true)}>{ws.visibility === 'public' ? '改回私有…' : '设为公开…'}</RailLink>
            )}
            {amOwner && <RailLink onClick={() => setDetailTab('members')}>转移 Owner…</RailLink>}
          </div>
        </aside>
      </div>
    );
  };

  const renderMembersTab = () => {
    const rows = members?.members || [];
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {colHead(<>
          <span style={{ flex: 1 }}>成员</span>
          <span style={{ width: 170, flexShrink: 0 }}>加入时间</span>
          <span style={{ width: 80, flexShrink: 0 }}>权限</span>
          <span style={{ width: 32, flexShrink: 0 }} />
        </>)}
        {rows.map((m) => {
          const isMe = me?.userId && m.userId === me.userId;
          const manageable = amOwner && m.role !== 'owner' && !isMe;
          return (
            <div key={m.userId} className="flex items-center whitespace-nowrap group" style={{ padding: '0 20px', height: 48, borderBottom: `1px solid ${C.borderSoft}` }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <div className="flex items-center gap-2.5 min-w-0" style={{ flex: 1 }}>
                <span className="inline-flex items-center justify-center shrink-0" style={{ width: 22, height: 22, borderRadius: '50%', background: avatarColor(m.displayName || m.email), color: '#fff', fontSize: 10, fontWeight: 600 }}>
                  {(m.displayName || m.email || '?').slice(0, 1)}
                </span>
                <span className="truncate">
                  <span style={{ fontSize: 13, fontWeight: 500, color: C.t1 }}>{m.displayName}{isMe ? '(我)' : ''}</span>
                  <span style={{ fontSize: 12, color: C.t4, marginLeft: 6 }}>{m.email}</span>
                </span>
              </div>
              <span style={{ width: 170, flexShrink: 0, fontSize: 11.5, color: C.t4 }}>{m.role === 'owner' ? '创建者' : fmtDate(m.joinedAt)}</span>
              <span style={{ width: 80, flexShrink: 0 }}><RoleChip role={m.role} /></span>
              <span className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity" style={{ width: 32, flexShrink: 0 }}>
                {manageable && (
                  <IconBtn title="管理成员" onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ member: m, x: Math.min(r.left, window.innerWidth - 200), y: r.bottom + 4 });
                  }}>
                    <MoreHorizontal size={14} />
                  </IconBtn>
                )}
              </span>
            </div>
          );
        })}
        <p style={{ padding: '10px 20px', fontSize: 11.5, color: C.t4 }}>
          「协作」可推送修改;「只读」仅可拉取查看 · 移出成员不影响其企业账号与本地文件
        </p>
      </div>
    );
  };

  const renderInvitesTab = () => (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div className="flex items-center gap-2" style={{ padding: '8px 20px', fontSize: 12, color: C.t3, borderBottom: `1px solid ${C.borderSoft}`, background: '#fafafb' }}>
        <KeyRound size={13} style={{ color: C.t4, flexShrink: 0 }} />
        凭邀请码加入的成员直接获得协作(写)权限,请只发给信任的同事
      </div>
      {colHead(<>
        <span style={{ width: 190, flexShrink: 0 }}>邀请码</span>
        <span style={{ width: 110, flexShrink: 0 }}>用量</span>
        <span style={{ width: 150, flexShrink: 0 }}>有效期</span>
        <span style={{ flex: 1 }}>创建</span>
        <span style={{ width: 60, flexShrink: 0 }} />
      </>)}
      {(invites || []).length === 0 ? (
        <div style={{ padding: '16px 20px', fontSize: 12, color: C.t4 }}>还没有生成邀请码</div>
      ) : (invites || []).map((inv) => {
        const expired = !inv.revokedAt && inv.expiresAt && new Date(inv.expiresAt).getTime() <= Date.now();
        const usedUp = !inv.revokedAt && inv.usedCount >= inv.maxUses;
        const inactive = Boolean(inv.revokedAt) || expired || usedUp;
        return (
          <div key={inv.id} className="flex items-center whitespace-nowrap group" style={{ padding: '0 20px', height: 44, borderBottom: `1px solid ${C.borderSoft}`, opacity: inactive ? 0.55 : 1 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
            <span className="flex items-center gap-1.5" style={{ width: 190, flexShrink: 0 }}>
              <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, letterSpacing: '0.03em', color: inv.revokedAt ? C.t4 : C.t1, textDecoration: inv.revokedAt ? 'line-through' : 'none' }}>
                {inv.code}
              </span>
              {!inv.revokedAt && (
                <IconBtn title="复制" onClick={() => handleCopy(inv.code)}>
                  {copiedCode === inv.code ? <Check size={12} style={{ color: C.green }} /> : <Copy size={12} />}
                </IconBtn>
              )}
            </span>
            <span style={{ width: 110, flexShrink: 0, fontSize: 12, color: C.t3 }}>{inv.usedCount} / {inv.maxUses}{usedUp ? ' · 已用完' : ''}</span>
            <span style={{ width: 150, flexShrink: 0, fontSize: 12, color: inv.revokedAt ? C.red : expired ? C.red : C.t3 }}>
              {inv.revokedAt ? '已撤销' : inv.expiresAt ? `${fmtDate(inv.expiresAt)} ${expired ? '已过期' : '过期'}` : '不过期'}
            </span>
            <span style={{ flex: 1, fontSize: 12, color: C.t4 }}>{inv.createdByName || '—'} · {fmtRelative(inv.createdAt)}</span>
            <span className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity" style={{ width: 60, flexShrink: 0 }}>
              {!inv.revokedAt && (
                <button type="button" onClick={() => setRevokeTarget(inv)}
                  style={{ border: 0, background: 'transparent', fontSize: 12, color: C.t4, cursor: 'pointer', padding: '3px 8px', borderRadius: 5 }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = C.red; e.currentTarget.style.background = '#faf0ef'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = C.t4; e.currentTarget.style.background = 'transparent'; }}>
                  撤销
                </button>
              )}
            </span>
          </div>
        );
      })}
      <p style={{ padding: '10px 20px', fontSize: 11.5, color: C.t4 }}>
        撤销后邀请码立即失效 · 已通过该码加入的成员不受影响,可在「成员」中单独管理
      </p>
    </div>
  );

  const renderSettingsTab = () => {
    const ws = detailWs;
    if (!ws) return null;
    const isPublic = ws.visibility === 'public';
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 40px 60px' }}>
        <div style={{ maxWidth: 660 }}>
          <div className="flex items-start justify-between gap-8" style={{ padding: '16px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.t1 }}>项目可见性</div>
              <div style={{ fontSize: 12.5, color: C.t3, marginTop: 4, lineHeight: 1.6, maxWidth: 560 }}>
                {isPublic ? (
                  <>当前为<b style={{ color: C.t1 }}>公开</b>:企业内所有成员可在「公开项目」中看到并以只读身份自助加入,协作权限仍需你手动开通。改回私有后,未加入的成员将不再可见,已加入成员保留。</>
                ) : (
                  <>当前为<b style={{ color: C.t1 }}>私有</b>:只有项目成员可以看到此项目,其他人需凭邀请码加入。设为公开后,企业内所有成员可在「公开项目」中看到并以只读身份自助加入,协作权限仍需你手动开通,可随时改回。</>
                )}
              </div>
            </div>
            <Btn disabled={busy || ws.status === 'archived'} onClick={() => setVisOpen(true)} style={{ flexShrink: 0 }}>
              {isPublic ? '改回私有…' : '设为公开…'}
            </Btn>
          </div>
          <div className="flex items-start justify-between gap-8" style={{ padding: '16px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.t1 }}>转移项目 Owner</div>
              <div style={{ fontSize: 12.5, color: C.t3, marginTop: 4, lineHeight: 1.6, maxWidth: 560 }}>
                将项目所有权转移给其他成员,你将降为协作权限。转移后由新 Owner 管理成员、邀请码与项目设置。
              </div>
            </div>
            <Btn disabled={busy} onClick={() => setDetailTab('members')} style={{ flexShrink: 0 }}>在成员中选择…</Btn>
          </div>
        </div>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col" style={{ background: C.bg, color: C.t1, fontSize: 13 }}>
      {/* Topbar */}
      <div className="flex items-center justify-between shrink-0" style={{ padding: '0 20px', height: 44, borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2" style={{ fontSize: 13, fontWeight: 500 }}>
          {view === 'detail' ? (
            <>
              <span style={{ color: C.t3, fontWeight: 400, cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.t1; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.t3; }}
                onClick={backToList}>云端项目</span>
              <span style={{ color: C.t4, fontWeight: 400 }}>›</span>
              <span className="truncate" style={{ maxWidth: 360 }}>{detailWs?.name || '…'}</span>
            </>
          ) : '云端项目'}
        </div>
        <div className="flex items-center gap-1.5">
          {view === 'list' ? (
            <>
              <Btn ghost disabled={loading} onClick={loadLists} title="刷新">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </Btn>
              <Btn onClick={() => { setJoinCode(''); setJoinResult(null); setJoinErr(''); setJoinCodeOpen(true); }}>
                <KeyRound size={13} />凭邀请码加入
              </Btn>
            </>
          ) : (
            <Btn ghost onClick={() => onOpenLocal?.(detailWs?.domain || 'projects')}>
              <FolderOpen size={13} />在我的资料中打开
            </Btn>
          )}
        </div>
      </div>

      {view === 'list' ? (
        <>
          {/* Filter bar */}
          <div className="flex items-center justify-between shrink-0" style={{ padding: '8px 20px', borderBottom: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-1">
              <Pill on={topTab === 'mine'} onClick={() => setTopTab('mine')} count={mine.length}>我的项目</Pill>
              <Pill on={topTab === 'public'} onClick={() => setTopTab('public')} count={pub.length}>公开项目</Pill>
              {topTab === 'mine' && (
                <>
                  <span style={{ width: 1, height: 14, background: C.border, margin: '0 6px' }} />
                  <Pill on={mineFilter === 'all'} onClick={() => setMineFilter('all')}>全部</Pill>
                  <Pill on={mineFilter === 'created'} onClick={() => setMineFilter('created')} count={createdCount}>我创建的</Pill>
                  <Pill on={mineFilter === 'joined'} onClick={() => setMineFilter('joined')} count={joinedCount}>我参与的</Pill>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5" style={{ fontSize: 12, color: C.t3 }}>
              <Search size={13} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索…"
                style={{ border: 0, outline: 0, background: 'transparent', fontSize: 12, width: 110, color: C.t1 }} />
            </div>
          </div>

          {/* List body */}
          <div className="flex-1 overflow-y-auto">
            {error && (
              <div style={{ padding: '10px 20px', fontSize: 12.5, color: C.red, borderBottom: `1px solid ${C.borderSoft}` }}>{error}</div>
            )}
            {loading ? (
              <div className="flex items-center justify-center gap-2" style={{ padding: '60px 0', color: C.t4 }}>
                <Loader2 size={16} className="animate-spin" />加载中…
              </div>
            ) : topTab === 'mine' ? (
              <>
                {colHead(<>
                  <span style={{ flex: 1 }}>名称</span>
                  <span style={{ width: 90, flexShrink: 0 }}>角色</span>
                  <span style={{ width: 80, flexShrink: 0 }}>可见性</span>
                  <span style={{ width: 64, flexShrink: 0 }}>成员</span>
                  <span style={{ width: 64, flexShrink: 0 }}>版本</span>
                  <span style={{ width: 110, flexShrink: 0 }}>最近更新</span>
                  <span style={{ width: 150, flexShrink: 0 }}>状态</span>
                  <span style={{ width: 32, flexShrink: 0 }} />
                </>)}
                {filteredMine.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center" style={{ padding: '60px 0' }}>
                    <Users size={32} style={{ color: C.t4 }} />
                    <p style={{ marginTop: 12, fontSize: 13, color: C.t3 }}>
                      {mine.length === 0 ? '还没有云端项目' : '没有匹配的项目'}
                    </p>
                    {mine.length === 0 && (
                      <p style={{ marginTop: 4, fontSize: 12, color: C.t4 }}>在「我的资料」中发布项目,或凭邀请码加入他人的项目</p>
                    )}
                  </div>
                ) : filteredMine.map(renderMineRow)}
                {filteredMine.length > 0 && (
                  <p style={{ padding: '10px 20px', fontSize: 11.5, color: C.t4 }}>
                    点击行进入项目管理(Owner)或查看项目信息(参与者) · 新发布的项目默认私有 · 文件查看与同步在「我的资料」中进行
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2" style={{ padding: '8px 20px', fontSize: 12, color: C.t3, borderBottom: `1px solid ${C.borderSoft}`, background: '#fafafb' }}>
                  <Globe size={13} style={{ color: C.t4, flexShrink: 0 }} />
                  公开项目对企业内全部成员可见;加入后默认只读,协作权限需项目 Owner 开通
                </div>
                {colHead(<>
                  <span style={{ flex: 1 }}>名称</span>
                  <span style={{ width: 200, flexShrink: 0 }}>Owner</span>
                  <span style={{ width: 64, flexShrink: 0 }}>成员</span>
                  <span style={{ width: 64, flexShrink: 0 }}>版本</span>
                  <span style={{ width: 110, flexShrink: 0 }}>最近更新</span>
                  <span style={{ width: 96, flexShrink: 0 }} />
                </>)}
                {filteredPub.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center" style={{ padding: '60px 0' }}>
                    <Globe size={32} style={{ color: C.t4 }} />
                    <p style={{ marginTop: 12, fontSize: 13, color: C.t3 }}>企业内还没有公开项目</p>
                  </div>
                ) : filteredPub.map(renderPubRow)}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Detail tabs */}
          <div className="flex items-center justify-between shrink-0" style={{ padding: '8px 20px', borderBottom: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-1">
              <Pill on={detailTab === 'overview'} onClick={() => setDetailTab('overview')}>概览</Pill>
              <Pill on={detailTab === 'members'} onClick={() => setDetailTab('members')} count={members?.members?.length}>成员</Pill>
              {amOwner && <Pill on={detailTab === 'invites'} onClick={() => setDetailTab('invites')} count={activeInvites.length}>邀请码</Pill>}
              {amOwner && <Pill on={detailTab === 'settings'} onClick={() => setDetailTab('settings')}>设置</Pill>}
            </div>
            {amOwner && detailWs?.status !== 'archived' && (
              <Btn primary disabled={busy} onClick={() => { setInviteMaxUses('10'); setInviteDays('30'); setInviteResult(null); setInviteOpen(true); }}>
                <Plus size={13} />生成邀请码
              </Btn>
            )}
          </div>

          {detailLoading && !overview ? (
            <div className="flex items-center justify-center gap-2 flex-1" style={{ color: C.t4 }}>
              <Loader2 size={16} className="animate-spin" />加载中…
            </div>
          ) : detailTab === 'overview' ? renderOverviewTab()
            : detailTab === 'members' ? renderMembersTab()
              : detailTab === 'invites' ? renderInvitesTab()
                : renderSettingsTab()}
        </>
      )}

      {/* ── Member management menu ── */}
      {menu && (
        <div className="fixed z-50" style={{ top: menu.y, left: menu.x, minWidth: 180, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', padding: 4 }}
          onMouseDown={(e) => e.stopPropagation()}>
          {menu.member.role === 'viewer' ? (
            <MenuItem icon={<Pencil size={13} />} onClick={() => { handleSetRole(menu.member, 'editor'); setMenu(null); }}>开通协作权限</MenuItem>
          ) : (
            <>
              <MenuItem icon={<Eye size={13} />} onClick={() => { handleSetRole(menu.member, 'viewer'); setMenu(null); }}>调整为只读</MenuItem>
              <MenuItem icon={<ArrowLeftRight size={13} />} onClick={() => { setTransferTarget(menu.member); setMenu(null); }}>设为项目 Owner</MenuItem>
            </>
          )}
          <div style={{ height: 1, background: C.borderSoft, margin: '4px 6px' }} />
          <MenuItem danger icon={<UserMinus size={13} />} onClick={() => { setRemoveTarget(menu.member); setMenu(null); }}>移出项目</MenuItem>
        </div>
      )}

      {/* ── Modals ── */}
      <ModalShell open={joinCodeOpen} onClose={() => setJoinCodeOpen(false)}
        title="凭邀请码加入项目" sub="输入项目 Owner 发给你的邀请码,加入后即可协作"
        footer={joinResult ? (
          <Btn primary onClick={() => setJoinCodeOpen(false)}>完成</Btn>
        ) : (
          <>
            <Btn onClick={() => setJoinCodeOpen(false)}>取消</Btn>
            <Btn primary disabled={busy || !joinCode.trim()} onClick={handleJoinByCode}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}加入项目
            </Btn>
          </>
        )}>
        {joinResult ? (
          <NoteBox tone="ok">
            {joinResult.alreadyMember
              ? <>你已是「<b style={{ color: C.t1 }}>{joinResult.workspaceName}</b>」的成员。</>
              : <>已加入「<b style={{ color: C.t1 }}>{joinResult.workspaceName}</b>」,并获得协作权限。可在「我的项目」中拉取本地副本。</>}
          </NoteBox>
        ) : (
          <>
            <input value={joinCode}
              onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleJoinByCode(); }}
              placeholder="WS-XXXX-XXXX" maxLength={20} autoFocus
              style={{ ...INPUT_STYLE, fontFamily: MONO, fontSize: 14, letterSpacing: '0.06em', textAlign: 'center', padding: 9, marginBottom: 12 }} />
            {joinErr && <NoteBox tone="warn">{joinErr}</NoteBox>}
          </>
        )}
      </ModalShell>

      <ModalShell open={inviteOpen} onClose={() => setInviteOpen(false)}
        title="生成项目邀请码" sub="凭码加入的成员获得协作(写)权限"
        footer={inviteResult ? (
          <Btn primary onClick={() => setInviteOpen(false)}>关闭</Btn>
        ) : (
          <>
            <Btn onClick={() => setInviteOpen(false)}>取消</Btn>
            <Btn primary disabled={busy} onClick={handleCreateInvite}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}生成
            </Btn>
          </>
        )}>
        {inviteResult ? (
          <div style={{ border: `1px solid ${C.border}`, background: '#fafafb', borderRadius: 8, padding: 14, textAlign: 'center', marginBottom: 4 }}>
            <div style={{ fontFamily: MONO, fontSize: 17, fontWeight: 600, letterSpacing: '0.06em', color: C.t1 }}>{inviteResult.code}</div>
            <div style={{ fontSize: 11.5, color: C.t3, marginTop: 6 }}>
              可用 {inviteResult.maxUses} 次 · {inviteResult.expiresAt ? `${fmtDate(inviteResult.expiresAt)} 前有效` : '不过期'} · 撤销后立即失效
            </div>
            <Btn style={{ marginTop: 10 }} onClick={() => handleCopy(inviteResult.code)}>
              {copiedCode === inviteResult.code ? <Check size={13} style={{ color: C.green }} /> : <Copy size={13} />}复制邀请码
            </Btn>
          </div>
        ) : (
          <div className="flex gap-2.5" style={{ marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: C.t3, marginBottom: 6, display: 'block' }}>可用次数</span>
              <input type="number" min="1" max="500" value={inviteMaxUses} onChange={(e) => setInviteMaxUses(e.target.value)} style={INPUT_STYLE} />
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: C.t3, marginBottom: 6, display: 'block' }}>有效期(天,留空不过期)</span>
              <input type="number" min="1" max="365" value={inviteDays} onChange={(e) => setInviteDays(e.target.value)} style={INPUT_STYLE} />
            </div>
          </div>
        )}
      </ModalShell>

      <ModalShell open={Boolean(revokeTarget)} onClose={() => setRevokeTarget(null)}
        title={`撤销邀请码 ${revokeTarget?.code || ''}?`} sub={revokeTarget ? `已使用 ${revokeTarget.usedCount} / ${revokeTarget.maxUses} 次` : ''}
        footer={<>
          <Btn onClick={() => setRevokeTarget(null)}>取消</Btn>
          <Btn danger disabled={busy} onClick={handleRevokeInvite}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}确认撤销
          </Btn>
        </>}>
        <NoteBox tone="warn">撤销后此码<b style={{ color: C.t1 }}>立即失效</b>,无法再用于加入项目。已通过该码加入的成员不受影响。</NoteBox>
      </ModalShell>

      <ModalShell open={visOpen} onClose={() => setVisOpen(false)}
        title={detailWs?.visibility === 'public' ? `将「${detailWs?.name}」改回私有?` : `将「${detailWs?.name}」设为公开?`}
        sub={`当前为${detailWs?.visibility === 'public' ? '公开' : '私有'}项目 · ${members?.members?.length ?? '—'} 名成员`}
        footer={<>
          <Btn onClick={() => setVisOpen(false)}>取消</Btn>
          <Btn primary disabled={busy} onClick={handleSetVisibility}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            {detailWs?.visibility === 'public' ? '确认改回私有' : '确认公开'}
          </Btn>
        </>}>
        {detailWs?.visibility === 'public' ? (
          <NoteBox>改回私有后,<b style={{ color: C.t1 }}>未加入的企业成员</b>将不再看到此项目,新成员只能凭邀请码加入。<b style={{ color: C.t1 }}>已加入的成员保留</b>,权限不变。</NoteBox>
        ) : (
          <NoteBox>设为公开后,<b style={{ color: C.t1 }}>企业内所有成员</b>都能看到此项目,并可自助以<b style={{ color: C.t1 }}>只读</b>身份加入(可拉取查看,不能修改)。协作权限仍需你在成员管理中手动开通。可随时改回私有,已加入成员保留。</NoteBox>
        )}
      </ModalShell>

      <ModalShell open={Boolean(removeTarget)} onClose={() => setRemoveTarget(null)}
        title={`将 ${removeTarget?.displayName || ''} 移出此项目?`}
        sub={`${detailWs?.name || ''} · ${ROLE_LABEL[removeTarget?.role] || ''}`}
        footer={<>
          <Btn onClick={() => setRemoveTarget(null)}>取消</Btn>
          <Btn danger disabled={busy} onClick={handleRemoveMember}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}确认移出
          </Btn>
        </>}>
        <NoteBox tone="warn">移出后该成员<b style={{ color: C.t1 }}>立即</b>无法访问此项目;其企业账号与本地文件不受影响,之后可凭邀请码或公开渠道重新加入。</NoteBox>
      </ModalShell>

      <ModalShell open={Boolean(transferTarget)} onClose={() => setTransferTarget(null)}
        title={`将项目 Owner 转移给 ${transferTarget?.displayName || ''}?`}
        sub={detailWs?.name || ''}
        footer={<>
          <Btn onClick={() => setTransferTarget(null)}>取消</Btn>
          <Btn danger disabled={busy} onClick={handleTransferOwner}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}确认转移
          </Btn>
        </>}>
        <NoteBox tone="warn">转移后 <b style={{ color: C.t1 }}>{transferTarget?.displayName}</b> 成为项目 Owner,负责成员、邀请码与项目设置;你将降为<b style={{ color: C.t1 }}>协作</b>权限。此操作不可自行撤销。</NoteBox>
      </ModalShell>

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed z-[200] left-1/2 -translate-x-1/2" style={{ bottom: 24, background: '#18181b', color: '#fff', fontSize: 12, padding: '7px 14px', borderRadius: 7 }}>
          {toast}
        </div>
      )}
    </div>
  );
};

function RailProp({ k, children }) {
  return (
    <div className="flex items-center gap-2" style={{ minHeight: 28 }}>
      <span style={{ width: 76, flexShrink: 0, fontSize: 12, color: C.t4 }}>{k}</span>
      <span className="flex items-center gap-1.5 min-w-0" style={{ fontSize: 12.5, color: C.t2 }}>{children}</span>
    </div>
  );
}

function RailLink({ onClick, disabled, children }) {
  return (
    <span onClick={disabled ? undefined : onClick}
      className="block"
      style={{ fontSize: 12, color: disabled ? C.t4 : C.t3, padding: '5px 0', cursor: disabled ? 'default' : 'pointer' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = C.accent; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = disabled ? C.t4 : C.t3; }}>
      {children}
    </span>
  );
}

function MenuItem({ icon, danger, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-2 w-full text-left whitespace-nowrap"
      style={{ padding: '6px 8px', border: 0, background: 'transparent', borderRadius: 5, fontSize: 12.5, color: danger ? C.red : C.t2, cursor: 'pointer' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? '#faf0ef' : C.bgHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ color: danger ? C.red : C.t3, display: 'inline-flex' }}>{icon}</span>
      {children}
    </button>
  );
}

export default CloudProjectsPage;

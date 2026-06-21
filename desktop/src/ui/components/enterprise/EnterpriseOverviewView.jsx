// H7: Enterprise overview & audit — owner/admin dashboard.
//
// Reads from `/api/org/stats` (aggregate metrics) and `/api/org/events`
// (paginated, filterable audit feed). Pure read surface; no mutations here.
// Visual language follows the other enterprise/* views (Linear-style cards).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, AlertTriangle, Activity, Filter,
} from 'lucide-react';
import { useToast } from '../../hooks/useToast.js';
import { avatarColor, fmtDate, fmtRelative, FIELD_LABEL } from './shared.jsx';

// ── audit event metadata ─────────────────────────────────────────────────
// Maps known event_type values to a human label + tone. Unknown types fall
// back to the raw type so new events still render legibly.
const EVENT_META = {
  'org.member_role_changed': { label: '调整成员角色', tone: 'neutral' },
  'org.member_disabled': { label: '停用成员', tone: 'danger' },
  'org.member_restored': { label: '恢复成员', tone: 'good' },
  'org.invite_created': { label: '创建邀请码', tone: 'neutral' },
  'org.invite_revoked': { label: '撤销邀请码', tone: 'warn' },
  'workspace.archived': { label: '归档项目', tone: 'warn' },
  'workspace.disabled': { label: '停用项目', tone: 'danger' },
  'workspace.restored': { label: '恢复项目', tone: 'good' },
  'workspace.owner_transferred': { label: '转移项目所有权', tone: 'neutral' },
  'workspace.member_removed': { label: '移除项目成员', tone: 'warn' },
  'skill.installed': { label: '安装技能', tone: 'good' },
  'skill.archived': { label: '归档技能', tone: 'warn' },
  'skill.unarchived': { label: '恢复技能', tone: 'good' },
  'skill.access_changed': { label: '调整技能可见性', tone: 'neutral' },
  'skill.submitted': { label: '提交技能', tone: 'neutral' },
  'skill.approved': { label: '通过技能审核', tone: 'good' },
  'skill.rejected': { label: '驳回技能', tone: 'danger' },
  'org_config_template.created': { label: '创建配置模板', tone: 'neutral' },
  'org_config_template.enabled': { label: '启用配置模板', tone: 'good' },
  'org_config_template.disabled': { label: '停用配置模板', tone: 'warn' },
  'org_config_template.updated': { label: '更新配置模板', tone: 'neutral' },
  'org_config_template.imported': { label: '导入配置模板', tone: 'good' },
  'org_config_template.rotated': { label: '轮换配置码', tone: 'neutral' },
};

const TONE_STYLE = {
  neutral: { background: '#f1f5f9', color: '#475569' },
  good: { background: '#ecfdf5', color: '#2d7a5f' },
  warn: { background: '#fef3c7', color: '#b45309' },
  danger: { background: '#fef2f2', color: '#b91c1c' },
};

function eventMeta(type) {
  return EVENT_META[type] || { label: type, tone: 'neutral' };
}

// Type filters offered in the toolbar (value '' = 全部).
const TYPE_FILTERS = [
  { value: '', label: '全部活动' },
  { value: 'org.member_disabled', label: '停用成员' },
  { value: 'org.member_restored', label: '恢复成员' },
  { value: 'org.invite_created', label: '创建邀请码' },
  { value: 'workspace.archived', label: '归档项目' },
  { value: 'workspace.disabled', label: '停用项目' },
  { value: 'skill.installed', label: '安装技能' },
  { value: 'org_config_template.imported', label: '导入配置' },
];

function StatCard({ label, value, hint, tone }) {
  return (
    <div className="flex-1 rounded-[10px] px-4 py-3" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
      <div style={FIELD_LABEL}>{label}</div>
      <div className="text-[22px] font-semibold mt-1" style={{ color: tone || '#1e293b', letterSpacing: '-0.02em' }}>
        {value}
        {hint != null && <small className="text-[12px] font-normal ml-1" style={{ color: '#94a3b8' }}>{hint}</small>}
      </div>
    </div>
  );
}

const EnterpriseOverviewView = () => {
  const { showToast } = useToast();
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadStats = useCallback(async () => {
    const res = await window.ipm?.org?.getStats?.();
    if (!res?.ok) throw new Error(res?.error || '加载统计失败');
    setStats(res.stats);
  }, []);

  const loadEvents = useCallback(async (type) => {
    const res = await window.ipm?.org?.listEvents?.({ type: type || undefined, limit: 30 });
    if (!res?.ok) throw new Error(res?.error || '加载审计日志失败');
    setEvents(res.events || []);
    setHasMore(Boolean(res.hasMore));
    setNextBefore(res.nextBefore || null);
  }, []);

  const reload = useCallback(async (type) => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadStats(), loadEvents(type)]);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, [loadStats, loadEvents]);

  useEffect(() => { reload(typeFilter); }, [reload, typeFilter]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await window.ipm?.org?.listEvents?.({
        type: typeFilter || undefined,
        before: nextBefore,
        limit: 30,
      });
      if (!res?.ok) throw new Error(res?.error || '加载更多失败');
      setEvents((prev) => [...prev, ...(res.events || [])]);
      setHasMore(Boolean(res.hasMore));
      setNextBefore(res.nextBefore || null);
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  // ── derived risk signals ──────────────────────────────────────────────
  const risks = useMemo(() => {
    if (!stats) return [];
    const out = [];
    if (stats.members?.disabled > 0) {
      out.push(`${stats.members.disabled} 名成员已停用`);
    }
    if (stats.skills?.pending_review > 0) {
      out.push(`${stats.skills.pending_review} 个技能待审核`);
    }
    if (stats.workspaces?.disabled > 0) {
      out.push(`${stats.workspaces.disabled} 个项目已停用`);
    }
    return out;
  }, [stats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-[13px]" style={{ color: '#94a3b8' }}>
        <Loader2 size={16} className="animate-spin" />加载中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-4 flex items-center justify-between gap-2 text-[13px] px-3 py-2 rounded-lg"
        style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
        <span>{error}</span>
        <button type="button" onClick={() => reload(typeFilter)} className="flex items-center gap-1 text-[12px] shrink-0 hover:underline">
          <RefreshCw size={12} />重试
        </button>
      </div>
    );
  }

  return (
    <div className="mt-[18px]">
      {/* ── 统计条 ── */}
      <div className="flex flex-wrap gap-2.5 [&>*]:min-w-[120px]">
        <StatCard label="活跃成员" value={stats?.members?.active ?? 0} hint={`/ ${stats?.members?.total ?? 0}`} />
        <StatCard label="云端项目" value={stats?.workspaces?.active ?? 0} hint={`/ ${stats?.workspaces?.total ?? 0}`} />
        <StatCard label="技能(已发布)" value={stats?.skills?.approved ?? 0} hint={`安装 ${stats?.skills?.installs ?? 0}`} />
        <StatCard label="AI 配置模板" value={stats?.configTemplates?.active ?? 0} hint={`导入 ${stats?.configTemplates?.imports ?? 0}`} />
      </div>

      {/* ── 次级统计 ── */}
      <div className="flex flex-wrap gap-2.5 mt-2.5 [&>*]:min-w-[120px]">
        <StatCard label="管理员" value={(stats?.members?.byRole?.owner ?? 0) + (stats?.members?.byRole?.admin ?? 0)} hint={`含 ${stats?.members?.byRole?.owner ?? 0} 位 owner`} />
        <StatCard label="版本提交" value={stats?.versions?.total ?? 0} />
        <StatCard label="待审技能" value={stats?.skills?.pending_review ?? 0} tone={stats?.skills?.pending_review ? '#b45309' : undefined} />
        <StatCard label="已停用成员" value={stats?.members?.disabled ?? 0} tone={stats?.members?.disabled ? '#b91c1c' : undefined} />
      </div>

      {/* ── 风险提示 ── */}
      {risks.length > 0 && (
        <div className="flex gap-2.5 rounded-lg px-3 py-2.5 mt-3.5 text-[12.5px] leading-relaxed"
          style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#b45309' }}>
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <div>需要关注:{risks.join(' · ')}。</div>
        </div>
      )}

      {/* ── 审计日志 ── */}
      <div className="flex items-center gap-2.5 mt-[22px] mb-3">
        <div className="flex items-center gap-1.5 text-[13.5px] font-semibold" style={{ color: '#1e293b' }}>
          <Activity size={15} style={{ color: '#3e4b9c' }} />审计日志
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 rounded-[7px] pl-2 pr-1 py-1" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
          <Filter size={12} style={{ color: '#94a3b8' }} />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-transparent outline-none text-[12.5px] pr-1"
            style={{ color: typeFilter ? '#3e4b9c' : '#475569' }}
          >
            {TYPE_FILTERS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => reload(typeFilter)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-[7px] text-[12.5px] transition-colors hover:bg-slate-50"
          style={{ background: '#fff', border: '1px solid #e8eaf0', color: '#475569' }}
        >
          <RefreshCw size={12} />刷新
        </button>
      </div>

      <div className="rounded-[10px] overflow-hidden" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
        {events.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px]" style={{ color: '#94a3b8' }}>
            暂无审计记录
          </div>
        ) : (
          events.map((ev) => {
            const meta = eventMeta(ev.eventType);
            const tone = TONE_STYLE[meta.tone] || TONE_STYLE.neutral;
            return (
              <div key={ev.id} className="flex items-center gap-3 px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded shrink-0" style={tone}>
                  {meta.label}
                </span>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {ev.actorName ? (
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                      style={{ background: avatarColor(ev.actorId || ev.actorName) }}>
                      {ev.actorName.slice(0, 1).toUpperCase()}
                    </span>
                  ) : null}
                  <span className="text-[12.5px] truncate" style={{ color: '#475569' }}>
                    {ev.actorName || '系统'}
                    {ev.workspaceName && <span style={{ color: '#94a3b8' }}> · {ev.workspaceName}</span>}
                  </span>
                </div>
                <span className="text-[11.5px] shrink-0" style={{ color: '#94a3b8' }} title={fmtDate(ev.createdAt)}>
                  {fmtRelative(ev.createdAt)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {hasMore && (
        <div className="flex justify-center mt-3">
          <button
            type="button"
            disabled={loadingMore}
            onClick={loadMore}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-[7px] text-[12.5px] transition-colors hover:bg-slate-50 disabled:opacity-60"
            style={{ background: '#fff', border: '1px solid #e8eaf0', color: '#475569' }}
          >
            {loadingMore ? <Loader2 size={12} className="animate-spin" /> : null}
            加载更多
          </button>
        </div>
      )}
    </div>
  );
};

export default EnterpriseOverviewView;

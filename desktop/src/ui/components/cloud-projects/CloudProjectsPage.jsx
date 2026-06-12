import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, Users, Download, FolderOpen, RefreshCw, Check, Loader2, AlertCircle, History, Flag } from 'lucide-react';

// C4: Cloud collaboration projects browser.
//
// Lists every workspace in the user's org with their role and member count.
// Members can join (then pull a local copy); non-members can join directly.
// Pulling streams files into a fresh local project, with progress shown inline.

const DOMAIN_LABEL = { cases: '案件', projects: '项目', study: '学习' };
const DOMAIN_COLOR = {
  cases: { bg: 'rgba(102,112,176,0.14)', text: '#5b6bb0' },
  projects: { bg: 'rgba(45,122,95,0.12)', text: '#2d7a5f' },
  study: { bg: 'rgba(156,115,62,0.12)', text: '#9c733e' },
};

const STEP_LABEL = {
  fetching: '获取清单',
  preparing: '准备目录',
  downloading: '下载文件',
  finalizing: '写入绑定',
  done: '完成',
  error: '出错',
};

function ProgressBar({ progress }) {
  if (!progress) return null;
  const { step, status, current, total } = progress;
  const pct = total > 0 ? Math.round((current / total) * 100) : status === 'done' ? 100 : 0;
  const label = STEP_LABEL[step] || step;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: '#64748b' }}>
        <span>{status === 'error' ? `错误：${progress.error || ''}` : label}{total > 0 ? ` (${current}/${total})` : ''}</span>
        {status !== 'error' && <span>{pct}%</span>}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#e2e8f0' }}>
        <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: status === 'error' ? '#ef4444' : '#3e4b9c' }} />
      </div>
    </div>
  );
}

const CloudProjectsPage = ({ onOpenLocal }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [busyId, setBusyId] = useState(null); // workspace id currently joining/pulling
  const [progressById, setProgressById] = useState({}); // id -> progress
  const [pulledById, setPulledById] = useState({}); // id -> { projectName, domain }
  const [historyId, setHistoryId] = useState(null); // workspace id whose history is open
  const [historyById, setHistoryById] = useState({}); // id -> { loading, versions }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await window.ipm?.cloud?.listWorkspaces?.();
      if (res?.ok) {
        setWorkspaces(res.workspaces || []);
      } else {
        setError(res?.error || '加载失败');
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Subscribe to pull progress.
  useEffect(() => {
    const off = window.ipm?.cloud?.onPullProgress?.((data) => {
      if (!data?.workspaceId) return;
      setProgressById((prev) => ({ ...prev, [data.workspaceId]: data }));
    });
    return () => { if (typeof off === 'function') off(); };
  }, []);

  const handleJoin = useCallback(async (ws) => {
    setBusyId(ws.id);
    try {
      const res = await window.ipm?.cloud?.joinWorkspace?.({ workspaceId: ws.id });
      if (res?.ok) {
        setWorkspaces((prev) => prev.map((w) => (w.id === ws.id ? { ...w, myRole: res.role || 'editor', memberCount: res.alreadyMember ? w.memberCount : w.memberCount + 1 } : w)));
      } else {
        setError(res?.error || '加入失败');
      }
    } finally {
      setBusyId(null);
    }
  }, []);

  const toggleHistory = useCallback(async (ws) => {
    if (historyId === ws.id) {
      setHistoryId(null);
      return;
    }
    setHistoryId(ws.id);
    if (!historyById[ws.id]) {
      setHistoryById((prev) => ({ ...prev, [ws.id]: { loading: true, versions: [] } }));
      try {
        const res = await window.ipm?.cloud?.listVersions?.({ workspaceId: ws.id, type: 'milestone' });
        setHistoryById((prev) => ({ ...prev, [ws.id]: { loading: false, versions: res?.ok ? res.versions || [] : [] } }));
      } catch {
        setHistoryById((prev) => ({ ...prev, [ws.id]: { loading: false, versions: [] } }));
      }
    }
  }, [historyId, historyById]);

  const handlePull = useCallback(async (ws) => {
    if (busyId) return;
    setBusyId(ws.id);
    setError('');
    setProgressById((prev) => ({ ...prev, [ws.id]: { step: 'fetching', status: 'running' } }));
    try {
      const res = await window.ipm?.cloud?.pull?.({ workspaceId: ws.id, name: ws.name, domain: ws.domain });
      if (res?.ok) {
        setPulledById((prev) => ({ ...prev, [ws.id]: { projectName: res.projectName, domain: res.domain } }));
        setWorkspaces((prev) => prev.map((w) => (w.id === ws.id ? { ...w, myRole: w.myRole || 'editor' } : w)));
      } else {
        setError(res?.error || '拉取失败');
        setProgressById((prev) => ({ ...prev, [ws.id]: null }));
      }
    } catch (err) {
      setError(err?.message || String(err));
      setProgressById((prev) => ({ ...prev, [ws.id]: null }));
    } finally {
      setBusyId(null);
    }
  }, [busyId]);

  return (
    <div className="h-full overflow-y-auto" style={{ background: '#f8f9fb' }}>
      <div className="max-w-[920px] mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(62,75,156,0.1)' }}>
              <Cloud size={20} style={{ color: '#3e4b9c' }} />
            </div>
            <div>
              <h1 className="text-[20px] font-semibold" style={{ color: '#1e293b' }}>协作项目</h1>
              <p className="text-[13px]" style={{ color: '#64748b' }}>组织内的云端项目，可加入并拉取到本地副本</p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
            style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#475569' }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 text-[13px] px-3 py-2 rounded-lg" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20" style={{ color: '#94a3b8' }}>
            <Loader2 size={20} className="animate-spin mr-2" />
            加载中…
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Cloud size={40} style={{ color: '#cbd5e1' }} />
            <p className="mt-3 text-[14px]" style={{ color: '#64748b' }}>组织内还没有云端项目</p>
            <p className="mt-1 text-[12px]" style={{ color: '#94a3b8' }}>在「我的资料」中发布一个项目，它就会出现在这里</p>
          </div>
        ) : (
          <div className="space-y-3">
            {workspaces.map((ws) => {
              const domainStyle = DOMAIN_COLOR[ws.domain] || DOMAIN_COLOR.projects;
              const isMember = Boolean(ws.myRole);
              const isBusy = busyId === ws.id;
              const progress = progressById[ws.id];
              const pulled = pulledById[ws.id];
              const showProgress = isBusy || (progress && progress.status !== 'done');
              return (
                <div key={ws.id} className="rounded-xl p-4 transition-shadow" style={{ background: '#fff', border: '1px solid #e8eaf0' }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-semibold truncate" style={{ color: '#1e293b' }}>{ws.name}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: domainStyle.bg, color: domainStyle.text }}>
                          {DOMAIN_LABEL[ws.domain] || ws.domain}
                        </span>
                        {ws.currentVersionNumber ? (
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>v{ws.currentVersionNumber}</span>
                        ) : (
                          <span className="text-[11px]" style={{ color: '#cbd5e1' }}>暂无版本</span>
                        )}
                      </div>
                      {ws.description && (
                        <p className="mt-1 text-[12px] truncate" style={{ color: '#64748b' }}>{ws.description}</p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3 text-[11px]" style={{ color: '#94a3b8' }}>
                        <span className="flex items-center gap-1"><Users size={11} />{ws.memberCount} 名成员</span>
                        {isMember && <span className="flex items-center gap-1" style={{ color: '#2d7a5f' }}><Check size={11} />已加入（{ws.myRole}）</span>}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {ws.currentVersionNumber ? (
                        <button
                          type="button"
                          onClick={() => toggleHistory(ws)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
                          style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#475569' }}
                          title="查看里程碑版本"
                        >
                          <History size={13} />
                          版本
                        </button>
                      ) : null}
                      {pulled ? (
                        <button
                          type="button"
                          onClick={() => onOpenLocal?.(pulled.domain)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
                          style={{ background: 'rgba(45,122,95,0.1)', color: '#2d7a5f' }}
                        >
                          <FolderOpen size={13} />
                          打开本地副本
                        </button>
                      ) : !isMember ? (
                        <button
                          type="button"
                          onClick={() => handleJoin(ws)}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
                          style={{ background: '#3e4b9c', color: '#fff', opacity: isBusy ? 0.6 : 1 }}
                        >
                          {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />}
                          加入
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handlePull(ws)}
                          disabled={isBusy || !ws.currentVersionNumber}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
                          style={{ background: '#3e4b9c', color: '#fff', opacity: isBusy || !ws.currentVersionNumber ? 0.5 : 1 }}
                          title={!ws.currentVersionNumber ? '该项目还没有提交任何版本' : '拉取到本地'}
                        >
                          {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                          拉取副本
                        </button>
                      )}
                    </div>
                  </div>

                  {showProgress && <ProgressBar progress={progress} />}

                  {historyId === ws.id && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid #f1f5f9' }}>
                      {historyById[ws.id]?.loading ? (
                        <div className="flex items-center gap-2 text-[12px]" style={{ color: '#94a3b8' }}>
                          <Loader2 size={12} className="animate-spin" />加载版本历史…
                        </div>
                      ) : (historyById[ws.id]?.versions || []).length === 0 ? (
                        <div className="text-[12px]" style={{ color: '#94a3b8' }}>还没有发布里程碑版本</div>
                      ) : (
                        <div className="space-y-1.5">
                          {historyById[ws.id].versions.map((v) => (
                            <div key={v.id} className="flex items-center gap-2 text-[12px]">
                              <Flag size={12} style={{ color: '#9c733e' }} />
                              <span className="font-medium" style={{ color: '#1e293b' }}>{v.label || `版本 v${v.versionNumber}`}</span>
                              <span style={{ color: '#cbd5e1' }}>·</span>
                              <span style={{ color: '#94a3b8' }}>v{v.versionNumber}</span>
                              {v.authorName && <span style={{ color: '#cbd5e1' }}>· {v.authorName}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CloudProjectsPage;

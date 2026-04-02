import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Brain, Bell, MessageSquare, X, Check, CheckCheck, Sparkles,
  ThumbsUp, ThumbsDown, FolderOpen, Loader2, SearchCheck,
  Zap, Trash2, Shield, Rocket,
} from 'lucide-react';
import useSupervisorNotifications from '../hooks/useSupervisorNotifications.js';
import { useToast } from '../hooks/useToast.js';

/* ── Variant color dot mapping ── */

const VARIANT_DOT = {
  info: 'bg-sky-400',
  success: 'bg-emerald-500',
  error: 'bg-rose-500',
  warn: 'bg-amber-500',
  warning: 'bg-amber-500',
};

/* ── Main component ── */

const SupervisorBubble = ({ onNavigateToKnowClaw }) => {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('notifications');
  const panelRef = useRef(null);

  const {
    notifications, unreadCount, loading, candidates, extractionPrompt,
    markRead, markAllRead, acceptCandidate, dismissCandidate,
    acceptExtraction, rejectExtraction, dismissExtractionDone, loadFull,
  } = useSupervisorNotifications();

  const [skills, setSkills] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);

  const fetchSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const res = await window.ipm.supervisor.listSkills();
      if (res?.ok) setSkills(res.skills || []);
    } catch { /* ignore */ }
    setSkillsLoading(false);
  }, []);

  const handleDeleteSkill = useCallback(async (skillName) => {
    try {
      await window.ipm.supervisor.deleteSkill(skillName);
      fetchSkills();
    } catch { /* ignore */ }
  }, [fetchSkills]);

  const handleToggleMaturity = useCallback(async (skillName, currentMaturity) => {
    const newMaturity = currentMaturity === 'stable' ? 'draft' : 'stable';
    try {
      await window.ipm.supervisor.setSkillMaturity(skillName, newMaturity);
      fetchSkills();
    } catch { /* ignore */ }
  }, [fetchSkills]);

  const hasExtractionPrompt = extractionPrompt && extractionPrompt !== 'done';
  const badgeCount = unreadCount + candidates.length + (hasExtractionPrompt ? 1 : 0);
  // Skills count is informational only, not shown as badge

  useEffect(() => {
    if (extractionPrompt?.needed && !expanded) {
      setExpanded(true);
      setActiveTab('learning');
    }
  }, [extractionPrompt]);

  useEffect(() => {
    if (expanded) { loadFull(); fetchSkills(); }
  }, [expanded, loadFull, fetchSkills]);

  useEffect(() => {
    if (!expanded) return;
    const onClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setExpanded(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [expanded]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    onNavigateToKnowClaw?.();
  };

  /* ── Toast morph engine ── */

  const { queue, dequeue } = useToast();
  const [morphState, setMorphState] = useState('idle'); // idle | expanding | showing | collapsing
  const [currentToast, setCurrentToast] = useState(null);
  const morphTimerRef = useRef(null);

  const clearMorphTimer = () => {
    if (morphTimerRef.current) { clearTimeout(morphTimerRef.current); morphTimerRef.current = null; }
  };

  const startMorph = useCallback((toast) => {
    clearMorphTimer();
    setCurrentToast(toast);
    setMorphState('expanding');
    morphTimerRef.current = setTimeout(() => {
      setMorphState('showing');
      morphTimerRef.current = setTimeout(() => {
        setMorphState('collapsing');
        morphTimerRef.current = setTimeout(() => {
          setMorphState('idle');
          setCurrentToast(null);
          dequeue();
        }, 300);
      }, 3500);
    }, 300);
  }, [dequeue]);

  useEffect(() => {
    if (expanded || morphState !== 'idle' || queue.length === 0) return;
    startMorph(queue[0]);
  }, [queue, morphState, expanded, startMorph]);

  useEffect(() => {
    if (expanded && morphState !== 'idle') {
      clearMorphTimer();
      setMorphState('idle');
      setCurrentToast(null);
    }
  }, [expanded]);

  useEffect(() => () => clearMorphTimer(), []);

  const isMorphing = morphState !== 'idle' && currentToast;
  const dotColor = currentToast ? (VARIANT_DOT[currentToast.variant] || VARIANT_DOT.info) : VARIANT_DOT.info;

  /* ── Render: collapsed bubble / morph toast ── */

  if (!expanded) {
    return (
      <div className="fixed bottom-10 right-6 z-50">
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              if (isMorphing) {
                clearMorphTimer();
                setMorphState('idle');
                setCurrentToast(null);
                dequeue();
              }
              setExpanded(true);
            }}
            onContextMenu={handleContextMenu}
            className={[
              'relative flex items-center',
              'bg-gradient-to-br from-violet-600 to-indigo-600 text-white',
              'shadow-lg shadow-violet-300/40 hover:shadow-xl hover:shadow-violet-300/60',
              'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
              'overflow-hidden group',
              isMorphing
                ? 'h-11 rounded-full pl-3.5 pr-5'
                : 'w-12 h-12 rounded-full justify-center hover:scale-105',
            ].join(' ')}
            style={isMorphing ? { width: 'auto', maxWidth: '380px' } : {}}
            title="KnowClaw — 右键跳转完整界面"
          >
            {/* Brain icon: visible when idle, hidden when morphing */}
            <div className={`flex items-center justify-center transition-all duration-200 ${
              isMorphing ? 'w-0 opacity-0 overflow-hidden' : 'w-full opacity-100'
            }`}>
              <Brain size={22} className="group-hover:scale-110 transition-transform" />
            </div>

            {/* Morph toast content */}
            {isMorphing && (
              <div className={`flex items-center gap-2.5 whitespace-nowrap ${
                morphState === 'collapsing' ? 'animate-morph-text-out' : 'animate-morph-text-in'
              }`}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                <span className="text-sm font-medium leading-none">{currentToast.message}</span>
              </div>
            )}
          </button>

          {/* Badge — outside button to avoid overflow-hidden clipping */}
          {!isMorphing && badgeCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1 animate-bounce-subtle pointer-events-none">
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
        </div>
      </div>
    );
  }

  /* ── Render: expanded panel ── */

  return (
    <div className="fixed bottom-10 right-6 z-50" ref={panelRef}>
      <div className="w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-bubble-expand">
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
          <div className="flex items-center gap-2">
            <Brain size={16} />
            <span className="text-sm font-medium">KnowClaw</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setExpanded(false); onNavigateToKnowClaw?.(); }}
              className="px-2 py-1 rounded text-[10px] bg-white/20 hover:bg-white/30 transition-colors"
            >
              完整界面
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/20 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tabs — fixed layout: no flex-1, badges are absolute */}
        <div className="flex border-b border-slate-100">
          <TabButton
            active={activeTab === 'notifications'}
            onClick={() => setActiveTab('notifications')}
            icon={<Bell size={12} />}
            label="通知"
            badge={unreadCount}
          />
          <TabButton
            active={activeTab === 'learning'}
            onClick={() => setActiveTab('learning')}
            icon={<Sparkles size={12} />}
            label="学习"
            badge={candidates.length}
          />
          <TabButton
            active={activeTab === 'skills'}
            onClick={() => setActiveTab('skills')}
            icon={<Zap size={12} />}
            label="Skills"
          />
          <TabButton
            active={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
            icon={<MessageSquare size={12} />}
            label="对话"
          />
        </div>

        {/* Content */}
        <div className="max-h-72 overflow-y-auto">
          {activeTab === 'notifications' && (
            <NotificationList
              notifications={notifications}
              loading={loading}
              onMarkRead={markRead}
              onMarkAllRead={markAllRead}
            />
          )}
          {activeTab === 'learning' && (
            <div>
              <ExtractionPromptCard
                prompt={extractionPrompt}
                onAccept={acceptExtraction}
                onReject={rejectExtraction}
                onDismissDone={dismissExtractionDone}
              />
              <CandidateList
                candidates={candidates}
                loading={loading}
                onAccept={acceptCandidate}
                onDismiss={dismissCandidate}
              />
            </div>
          )}
          {activeTab === 'skills' && (
            <SkillListPanel
              skills={skills}
              loading={skillsLoading}
              onToggleMaturity={handleToggleMaturity}
              onDelete={handleDeleteSkill}
              onNavigate={onNavigateToKnowClaw}
              onClose={() => setExpanded(false)}
            />
          )}
          {activeTab === 'chat' && (
            <QuickChatHint onNavigate={onNavigateToKnowClaw} onClose={() => setExpanded(false)} />
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Tab button (fixed layout: badge absolute, no squeeze) ── */

const TabButton = ({ active, onClick, icon, label, badge }) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
      active
        ? 'text-violet-600 border-b-2 border-violet-600'
        : 'text-slate-400 hover:text-slate-600'
    }`}
  >
    {icon}
    <span>{label}</span>
    {badge > 0 && (
      <span className="absolute top-1 right-1 min-w-[14px] h-[14px] bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center px-0.5 leading-none">
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </button>
);

/* ── Notification list ── */

const NotificationList = ({ notifications, loading, onMarkRead, onMarkAllRead }) => {
  if (loading) return <div className="px-4 py-6 text-center text-xs text-slate-400">加载中...</div>;

  if (!notifications.length) {
    return (
      <div className="px-4 py-8 text-center">
        <Bell size={20} className="mx-auto mb-2 text-slate-300" />
        <p className="text-xs text-slate-400">暂无通知</p>
      </div>
    );
  }

  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <div>
      {hasUnread && (
        <div className="px-4 py-2 border-b border-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-[10px] text-violet-500 hover:text-violet-700 flex items-center gap-1"
          >
            <CheckCheck size={10} /> 全部已读
          </button>
        </div>
      )}
      {notifications.map((n) => (
        <div
          key={n.id}
          onClick={() => !n.isRead && onMarkRead(n.id)}
          className={`px-4 py-3 border-b border-slate-50 last:border-b-0 cursor-pointer hover:bg-slate-50 transition-colors ${
            n.isRead ? 'opacity-60' : ''
          }`}
        >
          <div className="flex items-start gap-2">
            {!n.isRead && <div className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1.5 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700 truncate">{n.title}</span>
                <span className="text-[10px] text-slate-400 flex-shrink-0">
                  {new Date(n.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {n.content && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.content}</p>}
              {n.projectName && (
                <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-500 rounded">
                  {n.projectName}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── Extraction prompt card ── */

const ExtractionPromptCard = ({ prompt, onAccept, onReject, onDismissDone }) => {
  if (!prompt) return null;

  if (prompt === 'running') {
    return (
      <div className="px-4 py-4 border-b border-slate-100 bg-violet-50/50">
        <div className="flex items-center gap-2">
          <Loader2 size={16} className="text-violet-600 animate-spin" />
          <div>
            <div className="text-xs font-medium text-violet-700">正在分析分类记录...</div>
            <p className="text-[10px] text-violet-500 mt-0.5">系统正在从历史数据中提取分类模式，请稍候</p>
          </div>
        </div>
      </div>
    );
  }

  if (prompt === 'done') {
    return (
      <div className="px-4 py-3 border-b border-slate-100 bg-emerald-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check size={14} className="text-emerald-600" />
            <span className="text-xs text-emerald-700">分析完成，请在下方查看结果</span>
          </div>
          <button type="button" onClick={onDismissDone} className="text-slate-400 hover:text-slate-600">
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (!prompt?.needed) return null;

  return (
    <div className="px-4 py-3 border-b border-slate-100 bg-amber-50/50">
      <div className="flex items-start gap-2">
        <SearchCheck size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-slate-700">模式学习申请</div>
          <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{prompt.summary}</p>
          {prompt.projects?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {prompt.projects.map((p) => (
                <span key={p.name} className="px-1.5 py-0.5 text-[9px] bg-white border border-slate-200 rounded text-slate-600">
                  {p.name}（{p.newAccepted} 条）
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mt-2.5">
            <button
              type="button"
              onClick={onReject}
              className="px-3 py-1.5 text-[10px] text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg transition-colors"
            >
              暂不需要
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="px-3 py-1.5 text-[10px] text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors"
            >
              开始分析
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Candidate list ── */

const CandidateList = ({ candidates, loading, onAccept, onDismiss }) => {
  if (loading) return <div className="px-4 py-6 text-center text-xs text-slate-400">加载中...</div>;

  if (!candidates.length) {
    return (
      <div className="px-4 py-8 text-center">
        <Sparkles size={20} className="mx-auto mb-2 text-slate-300" />
        <p className="text-xs text-slate-400">暂无待确认的分类模式</p>
        <p className="text-[10px] text-slate-300 mt-1">系统会自动从分类历史中学习</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-50">
      {candidates.map((c) => (
        <CandidateCard key={c.id} candidate={c} onAccept={onAccept} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const CandidateCard = ({ candidate, onAccept, onDismiss }) => {
  const [busy, setBusy] = useState(false);
  const c = candidate;

  const handleAccept = async () => { setBusy(true); await onAccept(c.id); setBusy(false); };
  const handleDismiss = async () => { setBusy(true); await onDismiss(c.id); setBusy(false); };

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2">
        <Sparkles size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-slate-700 leading-snug">{c.pattern}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <FolderOpen size={10} className="text-slate-400" />
            <span className="text-[10px] text-slate-500">{c.targetFolder}</span>
          </div>
          {c.evidenceSummary && <p className="text-[10px] text-slate-400 mt-0.5">{c.evidenceSummary}</p>}
          {c.sampleFiles?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.sampleFiles.slice(0, 3).map((f, i) => (
                <span key={i} className="px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-500 rounded truncate max-w-[120px]">
                  {f}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-block px-1.5 py-0.5 text-[9px] bg-violet-50 text-violet-600 rounded">{c.projectName}</span>
            <span className="text-[9px] text-slate-400">强度 {Math.round((c.suggestedStrength || 0.7) * 100)}%</span>
            <div className="flex-1" />
            <button type="button" disabled={busy} onClick={handleDismiss}
              className="px-2 py-1 text-[10px] text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-40">
              <ThumbsDown size={10} className="inline mr-0.5" />忽略
            </button>
            <button type="button" disabled={busy} onClick={handleAccept}
              className="px-2 py-1 text-[10px] text-white bg-violet-600 hover:bg-violet-700 rounded transition-colors disabled:opacity-40">
              <ThumbsUp size={10} className="inline mr-0.5" />采纳
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Skill list ── */

const SkillListPanel = ({ skills, loading, onToggleMaturity, onDelete, onNavigate, onClose }) => {
  if (loading) return <div className="px-4 py-6 text-center text-xs text-slate-400">加载中...</div>;

  if (!skills.length) {
    return (
      <div className="px-4 py-8 text-center">
        <Zap size={20} className="mx-auto mb-2 text-slate-300" />
        <p className="text-xs text-slate-400">暂无已安装的 Skill</p>
        <p className="text-[10px] text-slate-300 mt-1">在 KnowClaw 对话中教我新的 Skill</p>
        <button type="button" onClick={() => { onClose?.(); onNavigate?.(); }}
          className="mt-3 px-3 py-1.5 text-[10px] bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors">
          去创建
        </button>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-50">
      {skills.map((s) => (
        <SkillCard key={s.dirName} skill={s} onToggleMaturity={onToggleMaturity} onDelete={onDelete} />
      ))}
    </div>
  );
};

const SkillCard = ({ skill, onToggleMaturity, onDelete }) => {
  const isStable = skill.maturity === 'stable';
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2">
        <Zap size={14} className={`mt-0.5 flex-shrink-0 ${isStable ? 'text-emerald-500' : 'text-amber-500'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-700 truncate">{skill.name}</span>
            <span className={`px-1.5 py-0.5 text-[9px] rounded ${isStable ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              {isStable ? '成熟' : '草稿'}
            </span>
          </div>
          {skill.description && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{skill.description}</p>}
          {skill.permissions?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {skill.permissions.map((p) => (
                <span key={p} className="px-1 py-0.5 text-[8px] bg-slate-100 text-slate-400 rounded">{p}</span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-2">
            <button type="button" onClick={() => onToggleMaturity(skill.dirName, skill.maturity)}
              className="px-2 py-1 text-[10px] text-slate-500 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors flex items-center gap-0.5"
              title={isStable ? '降级为草稿' : '标记为成熟'}>
              {isStable ? <Shield size={10} /> : <Rocket size={10} />}
              {isStable ? '降为草稿' : '标为成熟'}
            </button>
            <div className="flex-1" />
            <button type="button" onClick={() => onDelete(skill.dirName)}
              className="px-2 py-1 text-[10px] text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
              <Trash2 size={10} className="inline mr-0.5" />删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Quick chat hint ── */

const QuickChatHint = ({ onNavigate, onClose }) => (
  <div className="px-4 py-8 text-center">
    <MessageSquare size={20} className="mx-auto mb-2 text-slate-300" />
    <p className="text-xs text-slate-400 mb-3">在完整界面中与 KnowClaw 对话</p>
    <button type="button" onClick={() => { onClose?.(); onNavigate?.(); }}
      className="px-4 py-2 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors">
      打开 KnowClaw
    </button>
  </div>
);

export default SupervisorBubble;

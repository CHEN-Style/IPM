import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Brain, Bell, MessageSquare, X } from 'lucide-react';
import { useToast } from '../hooks/useToast.js';

// ─── Variant color dot mapping ──────────────────────────────────────

const VARIANT_DOT = {
  info: 'bg-sky-400',
  success: 'bg-emerald-500',
  error: 'bg-rose-500',
  warn: 'bg-amber-500',
  warning: 'bg-amber-500',
  tip: 'bg-violet-400',
};

const USAGE_TIPS = [
  '💡 拖拽文件到悬浮窗即可快速上传到当前项目',
  '💡 想要快速移动文件? 进入项目，打开 Explorer 视图，拖拽文件到目标位置',
  '💡 右键点击 KnowClaw 气泡可跳转到完整界面',
  '💡 Ctrl+K 可快速搜索所有项目、案件和文件',
  '💡 上传文件后 AI 会自动分类，你可以在暂存区审核结果',
  '💡 在偏好与记录中添加"硬规则"，可跳过 AI 直接分类特定文件',
  '💡 "软偏好"会影响 AI 的分类倾向，但不会强制执行',
  '💡 支持用自然语言描述偏好，AI 会自动解析为结构化规则',
  '💡 知识碎片可以关联到项目文件夹，方便跨项目复用笔记',
  '💡 在文件详情面板中可以查看 AI 分类的完整推理过程',
  '💡 点击面包屑导航可以快速跳转到上级目录',
  '💡 temp 文件夹用于临时存放未分类的文件',
  '💡 删除案件或项目前需要输入名称确认，防止误操作',
  '💡 KnowClaw v2 由 pi-coding-agent 驱动，已接入 Skill 系统',
  '💡 设置页可以配置 AI 模型参数和上传行为',
  '💡 想要可视化的整理知识碎片? 快去试试 Knowledge Thread Board',
];

// ─── Main component ──────────────────────────────────────────────────
//
// P12 refactor:
//   - Framework preserved: toast morph engine, usage tips scheduler,
//     bubble expand / collapse, badge layout.
//   - Supervisor-specific logic stripped: useSupervisorNotifications,
//     `window.ipm.supervisor.*` IPC, Learning tab, Skills tab.
//   - Notifications tab is now a stub displaying an empty state. A
//     future phase can wire it to pi-runtime or a local notification
//     source.
//   - Right-click / 完整界面 button navigates to KnowClaw v2 page.
//
const KnowClawBubble = ({ onNavigateToKnowClaw }) => {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('notifications');
  const panelRef = useRef(null);

  // Notifications stub — empty list until a new source is wired in.
  const notifications = [];
  const unreadCount = 0;

  const badgeCount = unreadCount;

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

  // ─── Toast morph engine ───────────────────────────────────────────

  const { queue, dequeue } = useToast();
  const [morphState, setMorphState] = useState('idle'); // idle | expanding | showing | collapsing
  const [currentToast, setCurrentToast] = useState(null);
  const [isTip, setIsTip] = useState(false);
  const morphTimerRef = useRef(null);

  const clearMorphTimer = () => {
    if (morphTimerRef.current) { clearTimeout(morphTimerRef.current); morphTimerRef.current = null; }
  };

  const dismissMorph = useCallback((skipDequeue) => {
    clearMorphTimer();
    setMorphState('collapsing');
    morphTimerRef.current = setTimeout(() => {
      setMorphState('idle');
      setCurrentToast(null);
      setIsTip(false);
      if (!skipDequeue) dequeue();
    }, 300);
  }, [dequeue]);

  const startMorph = useCallback((toast, tip = false) => {
    clearMorphTimer();
    setCurrentToast(toast);
    setIsTip(tip);
    setMorphState('expanding');
    const showDuration = tip ? 5000 : toast.action ? 6000 : 3500;
    morphTimerRef.current = setTimeout(() => {
      setMorphState('showing');
      morphTimerRef.current = setTimeout(() => {
        dismissMorph(tip);
      }, showDuration);
    }, 300);
  }, [dismissMorph]);

  useEffect(() => {
    if (expanded || morphState !== 'idle' || queue.length === 0) return;
    startMorph(queue[0]);
  }, [queue, morphState, expanded, startMorph]);

  // Incoming toast preempts any active tip.
  useEffect(() => {
    if (queue.length > 0 && isTip && morphState !== 'idle') {
      clearMorphTimer();
      setMorphState('idle');
      setCurrentToast(null);
      setIsTip(false);
    }
  }, [queue.length, isTip, morphState]);

  useEffect(() => {
    if (expanded && morphState !== 'idle') {
      clearMorphTimer();
      setMorphState('idle');
      setCurrentToast(null);
      setIsTip(false);
    }
  }, [expanded]);

  useEffect(() => () => clearMorphTimer(), []);

  // ─── Usage tips (lowest priority) ─────────────────────────────────

  const tipTimerRef = useRef(null);
  const tipIndexPool = useRef([]);
  const morphStateRef = useRef(morphState);
  const queueLenRef = useRef(queue.length);
  const expandedRef = useRef(expanded);
  morphStateRef.current = morphState;
  queueLenRef.current = queue.length;
  expandedRef.current = expanded;

  const clearTipTimer = useCallback(() => {
    if (tipTimerRef.current) { clearTimeout(tipTimerRef.current); tipTimerRef.current = null; }
  }, []);

  useEffect(() => {
    const scheduleNext = () => {
      clearTipTimer();
      const delay = (5 + Math.random() * 5) * 60_000;
      tipTimerRef.current = setTimeout(() => {
        tipTimerRef.current = null;
        if (morphStateRef.current !== 'idle' || queueLenRef.current > 0 || expandedRef.current) {
          scheduleNext();
          return;
        }
        if (tipIndexPool.current.length === 0) {
          tipIndexPool.current = Array.from({ length: USAGE_TIPS.length }, (_, i) => i);
          for (let i = tipIndexPool.current.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tipIndexPool.current[i], tipIndexPool.current[j]] = [tipIndexPool.current[j], tipIndexPool.current[i]];
          }
        }
        const idx = tipIndexPool.current.pop();
        startMorph({ message: USAGE_TIPS[idx], variant: 'tip' }, true);
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    return () => clearTipTimer();
  }, [startMorph, clearTipTimer]);

  const isMorphing = morphState !== 'idle' && currentToast;
  const dotColor = currentToast ? (VARIANT_DOT[currentToast.variant] || VARIANT_DOT.info) : VARIANT_DOT.info;

  // ─── Render: collapsed bubble / morph toast ───────────────────────

  if (!expanded) {
    return (
      <div className="fixed bottom-10 right-6 z-50 flex flex-col items-end">
        <div className="relative">
          <div
            onClick={(e) => {
              if (e.defaultPrevented) return;
              if (isMorphing) {
                dismissMorph(isTip);
                return;
              }
              setExpanded(true);
            }}
            onContextMenu={handleContextMenu}
            className={[
              'relative flex items-center cursor-pointer',
              'bg-gradient-to-br from-violet-600 to-indigo-600 text-white',
              'shadow-lg shadow-violet-300/40 hover:shadow-xl hover:shadow-violet-300/60',
              'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
              'overflow-hidden group',
              isMorphing
                ? 'h-11 rounded-full pl-3.5 pr-4'
                : 'w-12 h-12 rounded-full justify-center hover:scale-105',
            ].join(' ')}
            style={isMorphing ? { width: 'auto', maxWidth: 'calc(100vw - 48px)' } : {}}
            title="KnowClaw — 右键跳转完整界面"
          >
            <div className={`flex items-center justify-center transition-all duration-200 ${
              isMorphing ? 'w-0 opacity-0 overflow-hidden' : 'w-full opacity-100'
            }`}>
              <Brain size={22} className="group-hover:scale-110 transition-transform" />
            </div>

            {isMorphing && (
              <div className={`flex items-center gap-2.5 min-w-0 ${
                morphState === 'collapsing' ? 'animate-morph-text-out' : 'animate-morph-text-in'
              }`}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                <span className="text-sm font-medium leading-none truncate">{currentToast.message}</span>
                {currentToast.action && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      currentToast.action.onClick?.();
                      dismissMorph();
                    }}
                    className="shrink-0 ml-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-white/20 hover:bg-white/35 transition-colors"
                  >
                    {currentToast.action.label}
                  </button>
                )}
              </div>
            )}
          </div>

          {!isMorphing && badgeCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1 animate-bounce-subtle pointer-events-none">
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ─── Render: expanded panel ───────────────────────────────────────

  return (
    <div className="fixed bottom-10 right-6 z-50" ref={panelRef}>
      <div className="w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-bubble-expand">
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

        <div className="flex border-b border-slate-100">
          <TabButton
            active={activeTab === 'notifications'}
            onClick={() => setActiveTab('notifications')}
            icon={<Bell size={12} />}
            label="通知"
            badge={unreadCount}
          />
          <TabButton
            active={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
            icon={<MessageSquare size={12} />}
            label="对话"
          />
        </div>

        <div className="max-h-72 overflow-y-auto">
          {activeTab === 'notifications' && (
            <NotificationList notifications={notifications} />
          )}
          {activeTab === 'chat' && (
            <QuickChatHint onNavigate={onNavigateToKnowClaw} onClose={() => setExpanded(false)} />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Tab button (fixed layout: badge absolute, no squeeze) ──────────

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

// ─── Notification list (stub) ───────────────────────────────────────

const NotificationList = ({ notifications }) => {
  if (!notifications.length) {
    return (
      <div className="px-4 py-8 text-center">
        <Bell size={20} className="mx-auto mb-2 text-slate-300" />
        <p className="text-xs text-slate-400">暂无通知</p>
        <p className="text-[10px] text-slate-300 mt-1">通知系统将在下一阶段接入</p>
      </div>
    );
  }
  return null;
};

// ─── Quick chat hint ────────────────────────────────────────────────

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

export default KnowClawBubble;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import appIconUrl from '../../../assets/icon.png';

const STEPS = [
  {
    id: 'welcome',
    overline: null,
    title: 'KnowVault',
    body: null,
    left: 'INTELLIGENT KNOWLEDGE',
    right: 'MANAGEMENT PLATFORM',
    footer: '重新定义文件与知识的组织方式',
  },
  {
    id: 'files',
    overline: '01',
    title: '智能文件管理',
    body: '上传文件，AI 自动分析内容并归类到合适的文件夹。\n系统持续学习你的分类偏好，越用越精准。',
    left: 'AI-POWERED',
    right: 'FILE ORGANIZATION',
    footer: '项目 · 案件 · 学习空间',
  },
  {
    id: 'floating',
    overline: '02',
    title: '悬浮窗模式',
    body: '始终置顶的桌面快捷入口。\n无需切换应用，随时拖入文件、截图、粘贴内容，一切自动归档。',
    left: 'ALWAYS ON TOP',
    right: 'INSTANT CAPTURE',
    footer: '拖放 · 截图 · 剪贴板',
  },
  {
    id: 'knowledge',
    overline: '03',
    title: '知识碎片',
    body: '将零散的笔记、截图、网页摘录收集为知识碎片，\n与项目文件建立关联，形成结构化的知识网络。',
    left: 'COLLECT',
    right: 'CONNECT',
    footer: '采集 · 关联 · 全景视图',
  },
  {
    id: 'board',
    overline: '04',
    title: 'Knowledge Board',
    body: '在无限画布上以卡片、分组、连线、时间线\n的方式可视化整理知识，让思维自由流动。',
    left: 'INFINITE CANVAS',
    right: 'VISUAL THINKING',
    footer: '卡片 · 连线 · 时间线 · 分组',
  },
  {
    id: 'name',
    overline: null,
    title: null,
    body: null,
    left: 'WELCOME',
    right: 'ABOARD',
    footer: null,
  },
];

/* ── Inline UI mockups for each feature step ── */

const MockFiles = () => (
  <div className="w-[320px] rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
    <div className="h-6 flex items-center px-3 gap-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
    </div>
    <div className="flex">
      {/* File list */}
      <div className="flex-1 p-3 space-y-1.5">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>合同_v2.pdf</span>
        </div>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>起诉状.docx</span>
        </div>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>证据清单.xlsx</span>
        </div>
      </div>
      {/* Arrow */}
      <div className="flex items-center px-2">
        <div className="flex flex-col items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(180,140,100,0.5)" strokeWidth="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>
          <div className="w-px h-6" style={{ background: 'rgba(180,140,100,0.2)' }} />
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(180,140,100,0.4)" strokeWidth="3"><path d="m5 12 7 7 7-7" /></svg>
        </div>
      </div>
      {/* Folder tree */}
      <div className="p-3 space-y-1.5 w-[120px]">
        <div className="flex items-center gap-1.5 px-1.5 py-1 rounded" style={{ background: 'rgba(180,140,100,0.08)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(180,140,100,0.5)" strokeWidth="2"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
          <span className="text-[9px]" style={{ color: 'rgba(180,140,100,0.5)' }}>法律文书</span>
        </div>
        <div className="flex items-center gap-1.5 px-1.5 py-1 rounded" style={{ background: 'rgba(180,140,100,0.05)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(180,140,100,0.4)" strokeWidth="2"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
          <span className="text-[9px]" style={{ color: 'rgba(180,140,100,0.4)' }}>合同</span>
        </div>
        <div className="flex items-center gap-1.5 px-1.5 py-1 rounded" style={{ background: 'rgba(180,140,100,0.05)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(180,140,100,0.4)" strokeWidth="2"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
          <span className="text-[9px]" style={{ color: 'rgba(180,140,100,0.4)' }}>证据</span>
        </div>
      </div>
    </div>
  </div>
);

const MockFloating = () => (
  <div className="w-[200px] rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 8px 40px rgba(0,0,0,0.3)' }}>
    <div className="h-5 flex items-center justify-between px-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="flex items-center gap-1">
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>
      <span className="text-[7px]" style={{ color: 'rgba(255,255,255,0.15)' }}>KnowVault</span>
    </div>
    <div className="p-3 flex flex-col items-center">
      {/* Drop zone */}
      <div className="w-full rounded-lg py-5 flex flex-col items-center gap-2" style={{ border: '1.5px dashed rgba(180,140,100,0.25)', background: 'rgba(180,140,100,0.03)' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(180,140,100,0.35)" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
        <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.18)' }}>拖放文件到这里</span>
      </div>
      {/* Action row */}
      <div className="flex items-center gap-2 mt-2.5 w-full">
        <div className="flex-1 h-5 rounded flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-[8px]" style={{ color: 'rgba(255,255,255,0.2)' }}>📋 剪贴板</span>
        </div>
        <div className="flex-1 h-5 rounded flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-[8px]" style={{ color: 'rgba(255,255,255,0.2)' }}>📸 截图</span>
        </div>
      </div>
    </div>
  </div>
);

const MockKnowledge = () => (
  <div className="w-[300px]">
    <div className="flex items-start gap-3">
      {/* Knowledge cards */}
      <div className="flex-1 space-y-2">
        <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="px-1 py-0.5 rounded text-[7px] font-semibold" style={{ background: 'rgba(180,140,100,0.15)', color: 'rgba(180,140,100,0.6)' }}>笔记</div>
          </div>
          <div className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>案件分析要点</div>
          <div className="text-[8px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.12)' }}>一、事实认定关键点…</div>
        </div>
        <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="px-1 py-0.5 rounded text-[7px] font-semibold" style={{ background: 'rgba(100,140,180,0.15)', color: 'rgba(100,140,180,0.6)' }}>网页</div>
          </div>
          <div className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>相关判例摘要</div>
          <div className="text-[8px] mt-1" style={{ color: 'rgba(255,255,255,0.12)' }}>裁判要旨…</div>
        </div>
      </div>
      {/* Connection lines */}
      <div className="flex items-center pt-6">
        <svg width="40" height="60" viewBox="0 0 40 60">
          <line x1="0" y1="15" x2="40" y2="10" stroke="rgba(180,140,100,0.2)" strokeWidth="1" strokeDasharray="3,3" />
          <line x1="0" y1="45" x2="40" y2="30" stroke="rgba(180,140,100,0.15)" strokeWidth="1" strokeDasharray="3,3" />
          <circle cx="40" cy="10" r="2" fill="rgba(180,140,100,0.3)" />
          <circle cx="40" cy="30" r="2" fill="rgba(180,140,100,0.3)" />
        </svg>
      </div>
      {/* File reference */}
      <div className="w-[90px] space-y-2 pt-1">
        <div className="rounded-md p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" className="mb-1"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
          <div className="text-[8px]" style={{ color: 'rgba(255,255,255,0.18)' }}>起诉状.docx</div>
        </div>
        <div className="rounded-md p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" className="mb-1"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
          <div className="text-[8px]" style={{ color: 'rgba(255,255,255,0.18)' }}>合同.pdf</div>
        </div>
      </div>
    </div>
  </div>
);

const MockBoard = () => (
  <div className="w-[320px] rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
    <div className="h-5 flex items-center px-2.5 gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span className="text-[8px]" style={{ color: 'rgba(255,255,255,0.15)' }}>Board: 案件梳理</span>
      <div className="flex-1" />
      <div className="flex gap-1">
        {[1, 2, 3].map(i => <div key={i} className="w-2.5 h-2.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }} />)}
      </div>
    </div>
    <div className="p-3 relative" style={{ height: 120 }}>
      {/* Cards on canvas */}
      <div className="absolute rounded-md p-1.5" style={{ left: 12, top: 8, width: 80, background: 'rgba(180,140,100,0.06)', border: '1px solid rgba(180,140,100,0.12)' }}>
        <div className="text-[7px] font-medium" style={{ color: 'rgba(180,140,100,0.5)' }}>证据清单</div>
        <div className="text-[6px] mt-0.5" style={{ color: 'rgba(255,255,255,0.12)' }}>3 项关联</div>
      </div>
      <div className="absolute rounded-md p-1.5" style={{ left: 130, top: 4, width: 80, background: 'rgba(100,140,180,0.06)', border: '1px solid rgba(100,140,180,0.12)' }}>
        <div className="text-[7px] font-medium" style={{ color: 'rgba(100,140,180,0.5)' }}>法条依据</div>
        <div className="text-[6px] mt-0.5" style={{ color: 'rgba(255,255,255,0.12)' }}>民法典 §584</div>
      </div>
      <div className="absolute rounded-md p-1.5" style={{ left: 60, top: 60, width: 90, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="text-[7px] font-medium" style={{ color: 'rgba(255,255,255,0.25)' }}>时间线要点</div>
        <div className="text-[6px] mt-0.5" style={{ color: 'rgba(255,255,255,0.12)' }}>2024.03 — 签约</div>
      </div>
      <div className="absolute rounded-md p-1.5" style={{ left: 200, top: 55, width: 80, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="text-[7px] font-medium" style={{ color: 'rgba(255,255,255,0.25)' }}>策略分析</div>
      </div>
      {/* Connection lines */}
      <svg className="absolute inset-0 pointer-events-none" width="320" height="120">
        <line x1="92" y1="22" x2="130" y2="18" stroke="rgba(180,140,100,0.15)" strokeWidth="1" />
        <line x1="70" y1="35" x2="95" y2="60" stroke="rgba(180,140,100,0.1)" strokeWidth="1" strokeDasharray="3,2" />
        <line x1="150" y1="72" x2="200" y2="68" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      </svg>
      {/* Group outline */}
      <div className="absolute rounded-lg" style={{ left: 5, top: 0, width: 220, height: 50, border: '1px dashed rgba(255,255,255,0.05)' }} />
    </div>
  </div>
);

const STEP_MOCKS = {
  files: MockFiles,
  floating: MockFloating,
  knowledge: MockKnowledge,
  board: MockBoard,
};

const OnboardingScreen = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState('in');
  const [displayStep, setDisplayStep] = useState(0);
  const [userName, setUserName] = useState('');
  const inputRef = useRef(null);

  const current = STEPS[displayStep];
  const isLast = step === STEPS.length - 1;
  const isNameStep = current.id === 'name';
  const isWelcome = displayStep === 0;

  const transitionTo = useCallback(
    (next) => {
      if (next === step) return;
      setPhase('out');
      setTimeout(() => {
        setDisplayStep(next);
        setStep(next);
        setPhase('in');
      }, 400);
    },
    [step],
  );

  const finish = useCallback(() => {
    onComplete?.(userName.trim() || '');
  }, [onComplete, userName]);

  const goNext = useCallback(() => {
    if (isLast) { finish(); return; }
    transitionTo(step + 1);
  }, [isLast, finish, step, transitionTo]);

  const goPrev = useCallback(() => {
    if (step === 0) return;
    transitionTo(step - 1);
  }, [step, transitionTo]);

  useEffect(() => {
    const onKey = (e) => {
      if (isNameStep && e.key === 'Enter') { finish(); return; }
      if (isNameStep) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, isNameStep, finish]);

  useEffect(() => {
    if (isNameStep && phase === 'in' && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 500);
    }
  }, [isNameStep, phase]);

  const nameInitial = userName.trim() ? userName.trim()[0].toUpperCase() : '?';

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col select-none overflow-hidden" style={{ background: '#060608' }}>
      <style>{`
        @keyframes ob-glow-drift {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.12; }
          50% { transform: translate(-45%, -55%) scale(1.15); opacity: 0.18; }
        }
        @keyframes ob-glow-drift-2 {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.06; }
          50% { transform: translate(-55%, -45%) scale(1.2); opacity: 0.1; }
        }
        .ob-phase-in { opacity: 1; transform: translateY(0); transition: opacity 0.6s cubic-bezier(0.16,1,0.3,1), transform 0.6s cubic-bezier(0.16,1,0.3,1); }
        .ob-phase-out { opacity: 0; transform: translateY(12px); transition: opacity 0.35s ease-in, transform 0.35s ease-in; }
        .ob-side-text { writing-mode: vertical-lr; letter-spacing: 0.18em; }
        .ob-name-input {
          background: transparent;
          border: none;
          border-bottom: 1px solid rgba(255,255,255,0.12);
          outline: none;
          color: #ffffff;
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.02em;
          text-align: center;
          width: 280px;
          padding: 8px 0;
          caret-color: rgba(255,255,255,0.4);
          transition: border-color 0.3s;
        }
        .ob-name-input::placeholder { color: rgba(255,255,255,0.12); }
        .ob-name-input:focus { border-bottom-color: rgba(255,255,255,0.3); }
      `}</style>

      {/* Ambient warm glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute rounded-full"
          style={{
            width: 700, height: 700,
            left: '55%', top: '45%',
            background: 'radial-gradient(circle, rgba(180,140,100,1) 0%, rgba(120,80,40,0.4) 40%, transparent 70%)',
            filter: 'blur(80px)',
            animation: 'ob-glow-drift 18s ease-in-out infinite',
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: 500, height: 500,
            left: '30%', top: '55%',
            background: 'radial-gradient(circle, rgba(140,110,80,0.8) 0%, transparent 60%)',
            filter: 'blur(90px)',
            animation: 'ob-glow-drift-2 22s ease-in-out infinite',
          }}
        />
      </div>

      {/* Noise texture overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.035]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")' }} />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-10 pt-8">
        <span className="text-[10px] font-medium tracking-[0.2em] uppercase" style={{ color: 'rgba(255,255,255,0.2)' }}>
          KnowVault
        </span>
        {!isLast && !isNameStep && (
          <button
            type="button"
            onClick={() => onComplete?.('')}
            className="text-[10px] font-medium tracking-[0.15em] uppercase transition-colors duration-500 px-4 py-1.5 rounded-full"
            style={{ color: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.2)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          >
            Skip
          </button>
        )}
      </div>

      {/* Side labels */}
      <div className="absolute left-8 top-1/2 -translate-y-1/2 z-10">
        <span className={`ob-side-text text-[9px] font-medium uppercase ${phase === 'in' ? 'ob-phase-in' : 'ob-phase-out'}`} style={{ color: 'rgba(255,255,255,0.1)' }}>
          {current.left}
        </span>
      </div>
      <div className="absolute right-8 top-1/2 -translate-y-1/2 z-10">
        <span className={`ob-side-text text-[9px] font-medium uppercase ${phase === 'in' ? 'ob-phase-in' : 'ob-phase-out'}`} style={{ color: 'rgba(255,255,255,0.1)' }}>
          {current.right}
        </span>
      </div>

      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10">
        <div className={`flex flex-col items-center ${phase === 'in' ? 'ob-phase-in' : 'ob-phase-out'}`}>

          {isNameStep ? (
            /* ── Name input step ── */
            <>
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-[22px] font-bold mb-8"
                style={{
                  background: userName.trim() ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                  color: userName.trim() ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  transition: 'all 0.4s',
                }}
              >
                {nameInitial}
              </div>
              <p className="text-[13px] mb-6 tracking-[0.05em]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                你的名字
              </p>
              <input
                ref={inputRef}
                type="text"
                className="ob-name-input"
                placeholder="输入名字"
                value={userName}
                onChange={(e) => setUserName(e.target.value.slice(0, 20))}
                maxLength={20}
              />
              <p className="mt-4 text-[11px]" style={{ color: 'rgba(255,255,255,0.12)' }}>
                将显示在侧边栏中，可随时在设置中修改
              </p>
            </>
          ) : (
            /* ── Feature steps ── */
            <>
              {isWelcome && (
                <div className="mb-8">
                  <div className="w-[72px] h-[72px] rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                    <img src={appIconUrl} alt="" className="w-full h-full object-contain" draggable={false} />
                  </div>
                </div>
              )}

              {!isWelcome && current.overline && (
                <div className="mb-4">
                  <span className="text-[11px] font-medium tracking-[0.25em] uppercase" style={{ color: 'rgba(255,255,255,0.2)' }}>
                    {current.overline}
                  </span>
                </div>
              )}

              <h1
                className="text-center font-bold"
                style={{
                  fontSize: isWelcome ? 56 : 38,
                  color: '#ffffff',
                  letterSpacing: isWelcome ? '-0.04em' : '-0.03em',
                  lineHeight: 1.05,
                }}
              >
                {current.title}
              </h1>

              {/* Mockup illustration */}
              {STEP_MOCKS[current.id] && (
                <div className="mt-7 mb-2 flex justify-center">
                  {React.createElement(STEP_MOCKS[current.id])}
                </div>
              )}

              {current.body && (
                <p
                  className="mt-4 text-center text-[13px] leading-[1.8] whitespace-pre-line max-w-[380px]"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  {current.body}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bottom area */}
      <div className="relative z-10 flex flex-col items-center pb-10 gap-6">
        {/* Footer text */}
        {current.footer && (
          <div className={`text-center ${phase === 'in' ? 'ob-phase-in' : 'ob-phase-out'}`}>
            <span className="text-[11px] tracking-[0.08em]" style={{ color: 'rgba(255,255,255,0.18)' }}>
              {current.footer}
            </span>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-6">
          {step > 0 && (
            <button
              type="button"
              onClick={goPrev}
              className="text-[11px] font-medium tracking-[0.1em] uppercase transition-colors duration-400"
              style={{ color: 'rgba(255,255,255,0.2)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}
            >
              Back
            </button>
          )}

          {/* Dots */}
          <div className="flex items-center gap-[6px]">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => transitionTo(i)}
                className="p-0.5"
              >
                <div
                  className="rounded-full transition-all duration-700"
                  style={{
                    width: i === step ? 20 : 4,
                    height: 4,
                    background: i === step ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.12)',
                  }}
                />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={isNameStep ? finish : goNext}
            className="text-[11px] font-medium tracking-[0.1em] uppercase transition-colors duration-400"
            style={{ color: isNameStep ? 'rgba(255,255,255,0.8)' : isLast ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.2)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = isNameStep || isLast ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.2)')}
          >
            {isNameStep ? '开始使用' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingScreen;

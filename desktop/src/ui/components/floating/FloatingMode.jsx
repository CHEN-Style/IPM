import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clipboard, Mic, Briefcase, FolderKanban, GraduationCap, Sparkles } from 'lucide-react';
import TrayWidget from './TrayWidget.jsx';
import KnowClawFloating from '../floating-knowclaw/KnowClawFloating.jsx';

const MOCK_QUICK_PASTES = [
  {
    id: 'qp-1',
    title: '开庭通知确认',
    text: '收到开庭通知，我方已确认。请问法庭是否支持线上庭审/远程出庭？如需补充材料，请告知截止时间。',
  },
  {
    id: 'qp-2',
    title: '证据目录模板（简）',
    text: '证据一：______（形式：______）。证明目的：______。\n证据二：______（形式：______）。证明目的：______。\n证据三：______（形式：______）。证明目的：______。',
  },
  {
    id: 'qp-3',
    title: '律师函结尾（温和版）',
    text: '为避免扩大损失及进入诉讼程序，请贵方于收到本函之日起三日内与我方联系协商解决。如逾期未予回应，我方将依法采取进一步措施，相关费用与不利后果由贵方承担。',
  },
  {
    id: 'qp-4',
    title: '当事人信息采集',
    text: '请提供：1) 身份证/营业执照；2) 联系方式；3) 通讯地址；4) 事实时间线；5) 现有证据（合同/聊天/转账/邮件等）；6) 诉求与底线。',
  },
];

const copyText = async (text) => {
  const t = String(text ?? '');
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
};

const FloatingMode = ({ onBackToMain }) => {
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0 });
  const [activeDomain, setActiveDomain] = useState('projects'); // projects | cases | study
  const [itemsByDomain, setItemsByDomain] = useState({ projects: [], cases: [], study: [{ id: '', label: '学习', status: 'active' }] });
  const [currentByDomain, setCurrentByDomain] = useState({ projects: null, cases: null });
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadMode, setUploadMode] = useState('confirm'); // confirm | auto
  const widgetRef = useRef(null);
  const [toolPanel, setToolPanel] = useState(''); // '' | 'clipboard'
  const [recording, setRecording] = useState(false);
  const [copiedId, setCopiedId] = useState('');
  // FK1: top-level mode toggle. 'vault' = existing file-classifier
  // surface; 'knowclaw' = the new floating KnowClaw assistant.
  // Switching is purely visual on the renderer side — the main
  // process keeps `channels.floating` warm regardless, so flipping
  // back and forth does not destroy the session.
  const [mode, _setMode] = useState('vault');
  // FK2: when leaving knowclaw mode, hide the external bubble
  const setMode = useCallback((v) => {
    _setMode((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (prev === 'knowclaw' && next !== 'knowclaw') {
        window.ipm?.bubble?.hide?.();
      }
      return next;
    });
  }, []);

  // FK6-5: pending text that KnowClawFloating should drop into its
  // input as soon as it mounts. We set this when the user picks
  // "发送给 AI 分析" from the Vault staged-file UI and want the
  // floating KnowClaw to come up with `@relPath` prefilled, waiting
  // for the user to add their actual question. The hook only consumes
  // it once and then calls `onInjectionConsumed` to clear it.
  const [pendingKcInject, setPendingKcInject] = useState('');

  const handleSendFilesToAi = useCallback(async (files) => {
    const items = Array.isArray(files) ? files.filter((f) => f && f.srcPath) : [];
    if (items.length === 0) return { ok: false, error: 'no files' };
    const uploadApi = window.ipm?.knowclawFloating?.uploadToWorkspace;
    if (typeof uploadApi !== 'function') {
      return { ok: false, error: 'knowclawFloating.uploadToWorkspace 未就绪' };
    }
    const srcPaths = items.map((f) => f.srcPath);
    try {
      const res = await uploadApi(srcPaths, '');
      const uploaded = Array.isArray(res?.uploaded) ? res.uploaded : [];
      const skipped = Array.isArray(res?.skipped) ? res.skipped : [];
      if (uploaded.length === 0) {
        const reason = skipped[0]?.reason || res?.error || '未知错误';
        return { ok: false, error: `上传到 _floating 失败：${reason}` };
      }
      // Format the @ref tokens. Spaces in relPath would break the
      // KnowClaw `@`-expander regex (which terminates on whitespace
      // and a few punctuation chars), so we keep names verbatim
      // here — sanitizeFileName on the main side already strips
      // the worst offenders.
      const refLine = uploaded.map((u) => `@${u.relPath}`).join(' ');
      // Switch into KnowClaw mode first so the panel exists when
      // we hand it the injection text. setPendingKcInject runs in
      // the same React batch as setMode, so the panel mounts with
      // the value already set.
      setMode('knowclaw');
      setPendingKcInject(refLine + ' ');
      if (skipped.length > 0) {
        // Partial success — just warn via alert (toast provider is
        // tied to the main window). The successful files still get
        // injected; the user can decide to retry the rest.
        const head = skipped[0];
        const headStr = `${head.src ? head.src.split(/[\\/]/).pop() : '?'}: ${head.reason || '失败'}`;
        const tail = skipped.length > 1 ? `（另 ${skipped.length - 1} 个）` : '';
        window.alert(`部分文件未上传 — ${headStr}${tail}`);
      }
      return { ok: true, uploaded, skipped };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, [setMode]);

  const handlePendingInjectionConsumed = useCallback(() => {
    setPendingKcInject('');
  }, []);

  const domainLabel = activeDomain === 'cases' ? '案件' : activeDomain === 'study' ? '学习' : '项目';
  const projects = useMemo(() => {
    const arr = itemsByDomain?.[activeDomain];
    return Array.isArray(arr) ? arr : [];
  }, [itemsByDomain, activeDomain]);
  const hasActiveTarget = activeDomain === 'study' ? true : projects.length > 0;
  const disabledHint = `该分类暂无可用${domainLabel}（仅 status=ACTIVE 的会显示在悬浮窗标签栏）。请先在中台创建并设为 ACTIVE。`;

  const actions = useMemo(() => {
    return [
      {
        id: 'back',
        label: '回到中台',
        icon: <ArrowLeft size={14} />,
        onClick: () => onBackToMain?.(),
      },
    ];
  }, [onBackToMain]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [projList, projCur, caseList, caseCur, prefsRes] = await Promise.all([
          window.ipm?.projects?.list?.(),
          window.ipm?.projects?.getCurrent?.(),
          window.ipm?.cases?.list?.(),
          window.ipm?.cases?.getCurrent?.(),
          window.ipm?.prefs?.get?.(),
        ]);
        const mode = prefsRes?.prefs?.floatingUploadMode || 'confirm';
        setUploadMode(mode);

        const projAll = (projList || []).map((p) => ({ id: p.name, label: p.name, status: p.status || 'active' }));
        const projActive = projAll.filter((p) => String(p.status || '').toLowerCase() === 'active');
        const caseAll = (caseList || []).map((p) => ({ id: p.name, label: p.name, status: p.status || 'active' }));
        const caseActive = caseAll.filter((p) => String(p.status || '').toLowerCase() === 'active');
        const study = [{ id: '', label: '学习', status: 'active' }];
        if (cancelled) return;

        const nextItemsByDomain = { projects: projActive, cases: caseActive, study };
        setItemsByDomain(nextItemsByDomain);
        setCurrentByDomain({ projects: projCur || null, cases: caseCur || null });

        // Choose active target per current domain
        const pickPreferred = (domain) => {
          if (domain === 'study') return '';
          const list = nextItemsByDomain[domain] || [];
          const cur = domain === 'cases' ? caseCur : projCur;
          return cur && list.some((m) => m.id === cur) ? cur : list[0]?.id || null;
        };
        const preferred = pickPreferred(activeDomain);
        setActiveProjectId(preferred);
        // keep main process state aligned for projects/cases
        if (activeDomain === 'projects' && preferred && preferred !== projCur) {
          window.ipm?.projects?.setCurrent?.(preferred).catch(() => {});
        }
        if (activeDomain === 'cases' && preferred && preferred !== caseCur) {
          window.ipm?.cases?.setCurrent?.(preferred).catch(() => {});
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setItemsByDomain({ projects: [], cases: [], study: [{ id: '', label: '学习', status: 'active' }] });
          setActiveProjectId(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectProject = async (projectId) => {
    setActiveProjectId(projectId);
    try {
      if (activeDomain === 'projects') await window.ipm?.projects?.setCurrent?.(projectId);
      if (activeDomain === 'cases') await window.ipm?.cases?.setCurrent?.(projectId);
    } catch (e) {
      console.error(e);
    }
  };

  const switchDomain = async (nextDomain) => {
    const d = nextDomain === 'cases' ? 'cases' : nextDomain === 'study' ? 'study' : 'projects';
    setActiveDomain(d);
    if (d === 'study') {
      setActiveProjectId('');
      return;
    }
    const list = itemsByDomain?.[d] || [];
    const cur = d === 'cases' ? currentByDomain?.cases : currentByDomain?.projects;
    const preferred = cur && list.some((m) => m.id === cur) ? cur : list[0]?.id || null;
    setActiveProjectId(preferred);
    try {
      if (d === 'projects' && preferred) await window.ipm?.projects?.setCurrent?.(preferred);
      if (d === 'cases' && preferred) await window.ipm?.cases?.setCurrent?.(preferred);
    } catch {
      // ignore
    }
  };

  // FK7-2: KnowClawFloating registers its own Esc cascade
  // (bubble → preview → OCR → history/settings → expanded) via
  // `onRegisterEscHandler`. We call it first and only fall back
  // to the global cascade (menu → toolPanel → KnowClaw → main)
  // when nothing internal was closed. Storing in a ref keeps the
  // outer effect's deps small.
  const kcEscHandlerRef = useRef(null);
  const registerKcEscHandler = useCallback((fn) => {
    kcEscHandlerRef.current = typeof fn === 'function' ? fn : null;
  }, []);

  useEffect(() => {
    const close = () => setMenu((m) => (m.open ? { ...m, open: false } : m));
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      // Skip the cascade while the user is in the middle of an IME
      // composition (Chinese / Japanese / Korean) — Esc there is
      // meant to cancel the composition, not collapse panels.
      if (e.isComposing || e.nativeEvent?.isComposing) return;

      // 1) Floating context menu always closes first.
      if (menu.open) { close(); return; }
      // 2) Vault tool panels (clipboard, etc.).
      if (toolPanel) { setToolPanel(''); return; }
      // 3) FK7-2: KnowClaw-internal cascade (only when active).
      if (mode === 'knowclaw') {
        try {
          if (kcEscHandlerRef.current?.()) return;
        } catch { /* ignore — fall through to mode swap */ }
        setMode('vault');
        return;
      }
      // 4) Last resort — back to main.
      onBackToMain?.();
    };
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu.open, toolPanel, mode, onBackToMain]);

  // Keep the floating BrowserWindow content size equal to the widget size,
  // so there is no extra transparent region that blocks clicks outside the widget.
  useEffect(() => {
    if (!widgetRef.current) return;
    if (!window.ipm?.ui?.resizeFloating) return;
    const el = widgetRef.current;

    const applySize = () => {
      const r = el.getBoundingClientRect();
      const w = Math.ceil(r.width);
      const h = Math.ceil(r.height);
      if (w > 0 && h > 0) {
        window.ipm.ui.resizeFloating(w, h).catch(() => {});
      }
    };

    applySize();
    const ro = new ResizeObserver(() => applySize());
    ro.observe(el);
    return () => ro.disconnect();
    // FK1: include `mode` so the BrowserWindow resizes when the
    // user toggles into / out of KnowClaw mode (the panel sizes
    // differ from the Vault tray).
  }, [loading, projects.length, activeProjectId, uploadMode, activeDomain, mode]);

  return (
    <div
      className="h-full w-full overflow-hidden select-none antialiased bg-transparent"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ open: true, x: e.clientX, y: e.clientY });
      }}
    >
      {/* 桌面悬浮窗本体 */}
      {loading ? (
        <div className="text-xs text-slate-400 p-3">正在加载目标...</div>
      ) : (
        <div
          ref={widgetRef}
          className="inline-block align-top"
          style={{ width: 'fit-content' }}
        >
          {/* G1.2c 顶部 8px 可见拖拽把手。frameless transparent 窗的拖动入口
              此前只能靠右键菜单或者拽 rail，没有视觉暗示。这里给一条
              hover 高亮 + 小横条样式，明确告诉用户可拖动。 */}
          <div
            className="h-2 w-full bg-slate-800/40 hover:bg-slate-700/60 transition-colors flex items-center justify-center cursor-move rounded-t-2xl"
            style={{ WebkitAppRegion: 'drag' }}
            title="拖动以移动悬浮窗"
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="w-8 h-0.5 rounded-full bg-slate-400/50" />
          </div>
          <div className="flex items-stretch">
            {/* 左侧工具栏 + 可展开面板（注意：面板使用 absolute，避免在收起时“高度撑开”导致窗口出现透明遮挡区） */}
            <div
              className="relative flex-shrink-0 overflow-hidden bg-slate-900/70 border border-slate-800/60 border-r-0 rounded-bl-2xl shadow-2xl backdrop-blur w-12"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Rail（固定在右侧；面板从 rail 左侧向左滑出，向右收回） */}
              <div className="absolute right-0 top-0 bottom-0 w-12 flex flex-col items-center py-2 gap-2">
                {/* G1.0 顶部：回中台按钮（取代原本仅存在于右键菜单的入口） */}
                <button
                  type="button"
                  className="w-9 h-9 rounded-xl border bg-slate-950/20 border-slate-800/70 text-slate-300 hover:bg-slate-800/40 transition-all flex items-center justify-center mb-1"
                  title="回到中台 (Esc / Ctrl+Shift+Space)"
                  onClick={(e) => { e.stopPropagation(); onBackToMain?.(); }}
                  data-track="float-back-to-main"
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="w-6 h-px bg-slate-800/60 mb-1" />

                {/* Domain Switcher (top).
                    FK1: when `mode === 'knowclaw'` we dim the active
                    domain colour to a neutral slate so the rail
                    visually communicates "you are in KnowClaw, not
                    Vault" — yet still remembers which domain was
                    last chosen, so flipping back to Vault doesn't
                    reset the user's selection. Clicking any of
                    these buttons in KnowClaw mode flips `mode` back
                    to `vault` AND switches the domain in one step. */}
                <div className="w-full flex flex-col items-center pb-2 mb-2 border-b border-slate-800/60">
                  <button
                    type="button"
                    className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center mb-1 ${
                      mode === 'vault' && activeDomain === 'cases'
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-950/20 border-slate-800/70 text-slate-300 hover:bg-slate-800/40'
                    }`}
                    title="案件"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode !== 'vault') setMode('vault');
                      void switchDomain('cases');
                    }}
                  >
                    <Briefcase size={16} />
                  </button>
                  <button
                    type="button"
                    className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center mb-1 ${
                      mode === 'vault' && activeDomain === 'projects'
                        ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                        : 'bg-slate-950/20 border-slate-800/70 text-slate-300 hover:bg-slate-800/40'
                    }`}
                    title="项目"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode !== 'vault') setMode('vault');
                      void switchDomain('projects');
                    }}
                    data-tour="float-domain-projects"
                  >
                    <FolderKanban size={16} />
                  </button>
                  <button
                    type="button"
                    className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center ${
                      mode === 'vault' && activeDomain === 'study'
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        : 'bg-slate-950/20 border-slate-800/70 text-slate-300 hover:bg-slate-800/40'
                    }`}
                    title="学习"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode !== 'vault') setMode('vault');
                      void switchDomain('study');
                    }}
                  >
                    <GraduationCap size={16} />
                  </button>
                </div>

                {/* FK1: bottom-of-rail KnowClaw AI toggle. The
                    `flex-1` spacer pushes it to the absolute bottom
                    so it sits visually away from the three-domain
                    cluster — this is the "AI 不是 Vault 的一员"
                    cue from the user's design feedback. Violet
                    palette mirrors the demo's accent. */}
                <div className="flex-1" />
                <button
                  type="button"
                  className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center mb-1 ${
                    mode === 'knowclaw'
                      ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                      : 'bg-slate-950/20 border-slate-800/70 text-slate-300 hover:bg-slate-800/40'
                  }`}
                  title="KnowClaw 助手（Esc 收起）"
                  aria-label="KnowClaw 助手"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMode((m) => (m === 'knowclaw' ? 'vault' : 'knowclaw'));
                  }}
                  data-track="float-toggle-knowclaw"
                >
                  <Sparkles size={16} />
                </button>
              </div>
            </div>

            {/* 主体悬浮组件.
                FK1: switches between the existing Vault tray (file
                drop / capture) and the new floating KnowClaw panel.
                Both surfaces stay mounted-on-demand; the unmounted
                side loses its local state, but the global session
                state lives in main process `channels.{main,floating}`
                so flipping back doesn't kill an in-flight turn. */}
            <div className="rounded-br-2xl overflow-hidden">
              {/* FK7-1: 120-220ms fade when swapping Vault ↔ KnowClaw
                  so the transition reads as deliberate. Keyed on
                  `mode` so React remounts the wrapper and the CSS
                  animation re-fires; the underlying Vault tray + the
                  floating channel session stay in main process state
                  so nothing is lost. */}
              <div key={mode} className="fk-mode-in">
                {mode === 'knowclaw' ? (
                  <KnowClawFloating
                    pendingInjectText={pendingKcInject}
                    onPendingInjectionConsumed={handlePendingInjectionConsumed}
                    onRegisterEscHandler={registerKcEscHandler}
                  />
                ) : (
                  <TrayWidget
                    windowMode
                    projects={projects}
                    activeProjectId={activeProjectId}
                    onSelectProject={selectProject}
                    uploadMode={uploadMode}
                    activeDomain={activeDomain}
                    disabled={!hasActiveTarget}
                    disabledHint={disabledHint}
                    onSendFilesToAi={handleSendFilesToAi}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 右键菜单：回到中台 */}
      {menu.open ? (
        <div
          className="fixed z-[9999]"
          style={{
            left: menu.x,
            top: menu.y,
          }}
        >
          <div className="min-w-40 bg-slate-900/95 backdrop-blur border border-slate-700/60 rounded-lg shadow-2xl overflow-hidden">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setMenu((m) => ({ ...m, open: false }));
                  a.onClick?.();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800 active:bg-slate-700 transition-colors"
              >
                <span className="text-slate-300">{a.icon}</span>
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default FloatingMode;



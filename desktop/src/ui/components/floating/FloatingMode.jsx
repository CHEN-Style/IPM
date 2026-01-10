import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clipboard, Mic, Briefcase, FolderKanban, GraduationCap } from 'lucide-react';
import TrayWidget from './TrayWidget.jsx';

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

  useEffect(() => {
    const close = () => setMenu((m) => (m.open ? { ...m, open: false } : m));
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        close();
        setToolPanel('');
      }
    };
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

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
  }, [loading, projects.length, activeProjectId, uploadMode, activeDomain]);

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
          <div className="flex items-stretch">
            {/* 左侧工具栏 + 可展开面板（注意：面板使用 absolute，避免在收起时“高度撑开”导致窗口出现透明遮挡区） */}
            <div
              className={`relative flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out bg-slate-900/70 border border-slate-800/60 border-r-0 rounded-l-2xl shadow-2xl backdrop-blur ${
                toolPanel === 'clipboard' ? 'w-[336px]' : 'w-12'
              }`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Rail（固定在右侧；面板从 rail 左侧向左滑出，向右收回） */}
              <div className="absolute right-0 top-0 bottom-0 w-12 flex flex-col items-center py-2 gap-2">
                {/* Domain Switcher (top) */}
                <div className="w-full flex flex-col items-center pb-2 mb-2 border-b border-slate-800/60">
                  <button
                    type="button"
                    className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center mb-1 ${
                      activeDomain === 'cases'
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-950/20 border-slate-800/70 text-slate-300 hover:bg-slate-800/40'
                    }`}
                    title="案件"
                    onClick={(e) => {
                      e.stopPropagation();
                      void switchDomain('cases');
                    }}
                  >
                    <Briefcase size={16} />
                  </button>
                  <button
                    type="button"
                    className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center mb-1 ${
                      activeDomain === 'projects'
                        ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                        : 'bg-slate-950/20 border-slate-800/70 text-slate-300 hover:bg-slate-800/40'
                    }`}
                    title="项目"
                    onClick={(e) => {
                      e.stopPropagation();
                      void switchDomain('projects');
                    }}
                  >
                    <FolderKanban size={16} />
                  </button>
                  <button
                    type="button"
                    className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center ${
                      activeDomain === 'study'
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                        : 'bg-slate-950/20 border-slate-800/70 text-slate-300 hover:bg-slate-800/40'
                    }`}
                    title="学习"
                    onClick={(e) => {
                      e.stopPropagation();
                      void switchDomain('study');
                    }}
                  >
                    <GraduationCap size={16} />
                  </button>
                </div>

                <button
                  type="button"
                  className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center ${
                    toolPanel === 'clipboard'
                      ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                      : 'bg-slate-900/40 border-slate-800/70 text-slate-300 hover:bg-slate-800/40'
                  }`}
                  title="快速粘贴板"
                  onClick={(e) => {
                    e.stopPropagation();
                    setToolPanel((p) => (p === 'clipboard' ? '' : 'clipboard'));
                  }}
                >
                  <Clipboard size={16} />
                </button>

                <button
                  type="button"
                  className={`w-9 h-9 rounded-xl border transition-all flex items-center justify-center ${
                    recording
                      ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse'
                      : 'bg-slate-900/40 border-slate-800/70 text-slate-300 hover:bg-slate-800/40'
                  }`}
                  title={recording ? '录音中（示例）' : '快速录音（示例）'}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRecording((v) => !v);
                  }}
                >
                  <Mic size={16} />
                </button>
              </div>

              {/* Panel */}
              <div
                className={`absolute left-0 top-0 bottom-0 w-72 bg-slate-900/80 border-y border-slate-800/60 backdrop-blur transition-all duration-300 ease-in-out ${
                  toolPanel === 'clipboard'
                    ? 'opacity-100 translate-x-0'
                    : 'opacity-0 translate-x-full pointer-events-none'
                }`}
              >
                <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between">
                  <div className="text-[11px] font-bold text-slate-300 tracking-wide">快速粘贴板</div>
                  <div className="text-[10px] text-slate-500">点击条目复制</div>
                </div>
                <div className="p-2 space-y-2 h-full overflow-y-auto">
                  {MOCK_QUICK_PASTES.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${
                        copiedId === it.id
                          ? 'bg-emerald-500/10 border-emerald-500/25'
                          : 'bg-slate-900/30 border-slate-800/70 hover:bg-slate-800/40'
                      }`}
                      onClick={async () => {
                        const ok = await copyText(it.text);
                        setCopiedId(it.id);
                        window.setTimeout(() => setCopiedId(''), 900);
                        if (!ok) {
                          // best-effort silent fail (no toast system here yet)
                        }
                      }}
                      title="点击复制到剪贴板"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-slate-200 truncate">{it.title}</div>
                        <div className={`text-[10px] ${copiedId === it.id ? 'text-emerald-300' : 'text-slate-500'}`}>
                          {copiedId === it.id ? '已复制' : '复制'}
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400 line-clamp-2 whitespace-pre-wrap">{it.text}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 主体悬浮组件 */}
            <div className="rounded-r-2xl overflow-hidden">
              <TrayWidget
                windowMode
                projects={projects}
                activeProjectId={activeProjectId}
                onSelectProject={selectProject}
                uploadMode={uploadMode}
            activeDomain={activeDomain}
            disabled={!hasActiveTarget}
            disabledHint={disabledHint}
              />
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



// desktop/src/ui/components/floating-knowclaw/SettingsMenu.jsx
//
// FK3-6: settings dropdown for the floating KnowClaw panel.
// Triggered by the gear icon in the header. Positioned absolutely
// below the header, covering the body area. Contains model selection
// and thinking-level controls.

import React, { useCallback, useEffect, useRef, useState } from 'react';

const THINKING_LEVELS = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

export default function SettingsMenu({
  thinkingLevel = 'off',
  onSetThinkingLevel,
  onClose,
}) {
  const panelRef = useRef(null);
  const [models, setModels] = useState([]);
  const [activeModel, setActiveModel] = useState(null);
  const [loadingModels, setLoadingModels] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingModels(true);
      try {
        const res = await window.ipm?.knowclaw?.listModels?.();
        if (cancelled) return;
        if (res?.ok && Array.isArray(res.models)) {
          // runtime 返回 { provider, id, name, isDefault, input }，把它适配
          // 成本组件历史上使用的 { providerId, modelId, label, active }
          // 形态，避免后续渲染逻辑大改。
          const normalized = res.models.map((m) => ({
            providerId: m.provider,
            modelId: m.id,
            label: m.name || m.id,
            apiMode: m.apiMode || null,
            active: Boolean(m.isDefault),
            input: Array.isArray(m.input) ? m.input : ['text'],
          }));
          setModels(normalized);
          const current = normalized.find((m) => m.active);
          if (current) setActiveModel(current);
        }
      } catch { /* non-fatal */ }
      if (!cancelled) setLoadingModels(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Close on click outside
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleModelChange = useCallback(async (model) => {
    setActiveModel(model);
    try {
      await window.ipm?.knowclaw?.setModel?.(model.providerId, model.modelId);
    } catch { /* best-effort */ }
  }, []);

  return (
    <div
      ref={panelRef}
      className="absolute right-2 z-20 w-[220px] py-2 px-2.5
                 border border-slate-200 rounded-xl bg-white/98
                 shadow-[0_12px_40px_rgba(15,23,42,0.12)]
                 animate-[fadeIn_120ms_ease-out]"
      style={{ top: 44, backdropFilter: 'blur(12px)' }}
    >
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Model section */}
      <div className="mb-2">
        <div className="px-1 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          模型
        </div>
        {loadingModels ? (
          <div className="px-1 py-2 text-[11px] text-slate-400">加载中...</div>
        ) : models.length === 0 ? (
          <div className="px-1 py-2 text-[11px] text-slate-400">无可用模型</div>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-[120px] overflow-y-auto"
               style={{ scrollbarWidth: 'thin' }}>
            {models.map((m) => {
              const isActive = activeModel?.modelId === m.modelId
                && activeModel?.providerId === m.providerId;
              return (
                <button
                  key={`${m.providerId}/${m.modelId}`}
                  type="button"
                  onClick={() => handleModelChange(m)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px]
                             transition-colors truncate
                             ${isActive
                               ? 'bg-indigo-50 text-indigo-700 font-semibold'
                               : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{m.label || m.modelId}</span>
                    {m.apiMode && (
                      <span className="px-1 py-0.5 rounded bg-slate-100 text-[9px] text-slate-500 font-bold">
                        {m.apiMode === 'chat' ? '/c' : '/r'}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-px bg-slate-100 mx-1 my-1" />

      {/* Thinking level section */}
      <div>
        <div className="px-1 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          思考深度
        </div>
        <div className="flex gap-1 px-1 py-1">
          {THINKING_LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              onClick={() => onSetThinkingLevel?.(level.value)}
              className={`flex-1 h-7 rounded-lg text-[11px] font-semibold
                         border transition-colors
                         ${thinkingLevel === level.value
                           ? 'bg-slate-800 text-white border-slate-800'
                           : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

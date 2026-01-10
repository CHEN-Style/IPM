import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Settings2, ShieldCheck, ToggleLeft } from 'lucide-react';

const Card = ({ title, description, children }) => {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            {description ? <div className="text-xs text-slate-500 mt-1">{description}</div> : null}
          </div>
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
};

const OptionRow = ({ icon, title, desc, right }) => {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 p-2 rounded-lg bg-slate-100 text-slate-600">{icon}</div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900">{title}</div>
          {desc ? <div className="text-xs text-slate-500 mt-0.5">{desc}</div> : null}
        </div>
      </div>
      <div className="flex-shrink-0">{right}</div>
    </div>
  );
};

const RadioPill = ({ checked, label, hint, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
        checked ? 'border-slate-900 bg-slate-900 text-white shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-sm">{label}</div>
        {checked ? <CheckCircle2 size={16} className="text-white" /> : null}
      </div>
      {hint ? <div className={`text-xs mt-1 ${checked ? 'text-slate-200' : 'text-slate-500'}`}>{hint}</div> : null}
    </button>
  );
};

const SettingsPage = () => {
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState({ floatingUploadMode: 'confirm' }); // confirm | auto

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await window.ipm?.prefs?.get?.();
        if (cancelled) return;
        const mode = res?.prefs?.floatingUploadMode || 'confirm';
        setPrefs({ floatingUploadMode: mode });
      } catch (e) {
        console.error(e);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setFloatingUploadMode = async (mode) => {
    setPrefs((p) => ({ ...p, floatingUploadMode: mode }));
    setSaving(true);
    try {
      await window.ipm?.prefs?.set?.({ floatingUploadMode: mode });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const mockSwitch = useMemo(() => {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-500 hover:bg-slate-50"
        title="Mock"
      >
        <ToggleLeft size={14} className="text-slate-400" />
        未接入
      </button>
    );
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full bg-white">
      <header className="px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight truncate">偏好设置</h1>
          <p className="text-xs text-slate-500 mt-0.5">本地优先：设置将保存到本机 userfile。</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Settings2 size={16} className="text-slate-400" />
          {saving ? '正在保存…' : '已就绪'}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6 bg-slate-50/40">
        <div className="grid grid-cols-1 gap-6 max-w-4xl">
          <Card
            title="悬浮窗上传文件模式（真实功能）"
            description="决定悬浮窗里拖拽/选择文件后的行为。"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <RadioPill
                checked={prefs.floatingUploadMode === 'auto'}
                label="先斩后奏模式"
                hint="拖拽/选择文件后立即上传到当前项目 temp/，并提供 3 秒撤销。"
                onClick={() => setFloatingUploadMode('auto')}
              />
              <RadioPill
                checked={prefs.floatingUploadMode === 'confirm'}
                label="手动确认模式"
                hint="拖拽/选择后需要点击“确认并保存”，行为与当前一致。"
                onClick={() => setFloatingUploadMode('confirm')}
              />
            </div>
          </Card>

          <Card title="外观与交互（Mock）" description="这些选项先占位，后续逐步接入。">
            <div className="divide-y divide-slate-100">
              <OptionRow
                icon={<ShieldCheck size={16} />}
                title="启动时打开悬浮窗"
                desc="应用启动后自动打开悬浮窗（后续接入）。"
                right={mockSwitch}
              />
              <OptionRow
                icon={<Clock size={16} />}
                title="悬浮窗提示音"
                desc="保存成功/失败提示音（后续接入）。"
                right={mockSwitch}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;



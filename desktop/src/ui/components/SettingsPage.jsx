import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { CheckCircle2, Clock, Eye, EyeOff, FolderOpen, RefreshCw, Settings2, Cpu, Loader2 } from 'lucide-react';

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

const DataDirCard = () => {
  const [currentPath, setCurrentPath] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success'|'error', text }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.ipm?.prefs?.getDataDir?.();
        if (cancelled) return;
        if (res?.ok) {
          setCurrentPath(res.path);
          setIsCustom(res.isCustom);
        }
      } catch (e) {
        console.error('Failed to load data dir:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback(async () => {
    setMessage(null);
    const chosen = await window.ipm?.prefs?.chooseDataDir?.();
    if (!chosen?.ok || chosen.canceled) return;

    setChanging(true);
    try {
      const res = await window.ipm?.prefs?.setDataDir?.(chosen.path);
      if (res?.ok && res.changed) {
        setCurrentPath(chosen.path);
        setIsCustom(true);
        setMessage({ type: 'success', text: '数据目录已更新，需要重启应用生效。' });
      } else if (res?.ok && !res.changed) {
        setMessage({ type: 'success', text: '所选目录与当前相同，无需更改。' });
      } else {
        setMessage({ type: 'error', text: '更改失败：' + (res?.error || '未知错误') });
      }
    } catch (e) {
      setMessage({ type: 'error', text: '更改失败：' + (e?.message || String(e)) });
    } finally {
      setChanging(false);
    }
  }, []);

  const handleReset = useCallback(async () => {
    setMessage(null);
    try {
      await window.ipm?.prefs?.resetDataDir?.();
      const res = await window.ipm?.prefs?.getDataDir?.();
      if (res?.ok) setCurrentPath(res.path);
      setIsCustom(false);
      setMessage({ type: 'success', text: '已恢复默认路径，需要重启应用生效。' });
    } catch (e) {
      setMessage({ type: 'error', text: '重置失败：' + (e?.message || String(e)) });
    }
  }, []);

  const handleRestart = useCallback(() => {
    window.ipm?.prefs?.restartApp?.();
  }, []);

  return (
    <Card title="数据存储位置" description="所有项目文件、案件资料、数据库均存储在此目录下。">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">当前路径</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 truncate font-mono" title={currentPath}>
              {currentPath || '加载中…'}
            </div>
            <button
              type="button"
              onClick={handleChange}
              disabled={changing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {changing ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
              更改
            </button>
            {isCustom && (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors whitespace-nowrap"
                title="恢复默认路径"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        </div>

        {message && (
          <div className={`text-xs px-3 py-2 rounded-lg flex items-center justify-between ${message.type === 'success' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            <span>{message.text}</span>
            {message.type === 'success' && message.text.includes('重启') && (
              <button
                type="button"
                onClick={handleRestart}
                className="ml-3 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors whitespace-nowrap"
              >
                <RefreshCw size={12} />
                立即重启
              </button>
            )}
          </div>
        )}

        <div className="text-xs text-slate-400">
          更改后，已有数据会自动复制到新目录，需重启应用生效。
        </div>
      </div>
    </Card>
  );
};

const LlmConfigCard = () => {
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [summaryModel, setSummaryModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, error? }
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.ipm?.prefs?.get?.();
        if (cancelled) return;
        const llm = res?.prefs?.llm;
        if (llm) {
          setApiKey(llm.apiKey || '');
          setBaseURL(llm.baseURL || '');
          setModel(llm.model || '');
          setSummaryModel(llm.summaryModel || '');
        }
      } catch (e) {
        console.error('Failed to load LLM config:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback((setter) => (e) => {
    setter(e.target.value);
    setDirty(true);
    setTestResult(null);
    setSaveMsg('');
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      await window.ipm?.prefs?.set?.({ llm: { apiKey, baseURL, model, summaryModel } });
      setDirty(false);
      setSaveMsg('已保存');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (e) {
      setSaveMsg('保存失败：' + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  }, [apiKey, baseURL, model, summaryModel]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.ipm?.prefs?.testLlm?.({ apiKey, baseURL, model });
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: e?.message || String(e) });
    } finally {
      setTesting(false);
    }
  }, [apiKey, baseURL, model]);

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition-colors';

  return (
    <Card title="AI 模型配置" description="配置大语言模型的连接参数，用于驱动所有 AI 功能。">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">API Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={handleChange(setApiKey)}
              placeholder="sk-..."
              className={inputCls + ' pr-10'}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              tabIndex={-1}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">API Base URL</label>
          <input
            type="text"
            value={baseURL}
            onChange={handleChange(setBaseURL)}
            placeholder="https://api.openai.com/v1"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">主模型名称</label>
            <input
              type="text"
              value={model}
              onChange={handleChange(setModel)}
              placeholder="gpt-4o"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">总结模型名称 <span className="text-slate-400 font-normal">(可选，留空则使用主模型)</span></label>
            <input
              type="text"
              value={summaryModel}
              onChange={handleChange(setSummaryModel)}
              placeholder="gpt-4o-mini"
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || (!apiKey && !baseURL && !model)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            保存
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !apiKey || !baseURL || !model}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testing && <Loader2 size={14} className="animate-spin" />}
            测试连接
          </button>
          {saveMsg && <span className="text-xs text-green-600 font-medium">{saveMsg}</span>}
        </div>

        {testResult && (
          <div className={`text-xs px-3 py-2 rounded-lg ${testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {testResult.ok ? '连接成功，模型可正常使用。' : `连接失败：${testResult.error || '未知错误'}`}
          </div>
        )}
      </div>
    </Card>
  );
};

const SettingsPage = () => {
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState({ floatingUploadMode: 'auto' });

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
          <DataDirCard />
          <LlmConfigCard />

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
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;



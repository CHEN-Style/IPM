import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  CheckCircle2, Eye, EyeOff, FolderOpen, RefreshCw, Settings2, Loader2,
  Search, ExternalLink, Plus, Trash2, ChevronDown, ChevronUp, AlertCircle, X,
  Server, Sparkles, Check, Route,
} from 'lucide-react';

const Card = ({ title, description, children, overflowVisible = false }) => {
  return (
    <section className={`bg-white border border-slate-200 rounded-xl shadow-sm ${overflowVisible ? 'overflow-visible' : 'overflow-hidden'}`}>
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

// ---- 多 Provider AI 配置 ----
//
// 概念：
//   - Provider 是一个 API 接入点（一个 baseURL + apiKey 的组合），可对应
//     OpenAI 官方、Claude 官方、Gemini 官方、任意 OpenAI 兼容中转站。
//   - 用户可以同时配置多个 Provider，并按"角色"把它们的具体模型分配给
//     KnowClaw、文件分类、摘要、偏好解析等功能。

const PROVIDER_TYPE_OPTIONS = [
  { value: 'openai-compatible', label: 'OpenAI 兼容（中转站/自建）', supportsKnowClaw: true },
  { value: 'openai', label: 'OpenAI 官方', supportsKnowClaw: true },
  { value: 'anthropic', label: 'Claude 官方 (Anthropic)', supportsKnowClaw: false },
  { value: 'gemini', label: 'Google Gemini 官方', supportsKnowClaw: false },
];

const ROLE_OPTIONS = [
  { value: 'knowclaw', label: 'KnowClaw 对话', multi: true, desc: '可配置多个模型，运行时可切换。' },
  { value: 'classification', label: '文件分类', multi: false, desc: '驱动文件入库时的自动分类决策。' },
  { value: 'summary', label: '网页摘要 / 总结', multi: false, desc: '网页剪藏与文本碎片自动总结。' },
  { value: 'preferenceParsing', label: '偏好自然语言解析', multi: false, desc: '把口语描述解析为分类偏好规则。' },
];

const DEFAULT_BASE_URL_FOR = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  'openai-compatible': '',
};

const PROVIDER_TYPE_TO_LABEL = Object.fromEntries(
  PROVIDER_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

const API_MODE_META = {
  responses: { short: '/r', label: '/responses' },
  chat: { short: '/c', label: '/chat/completions' },
};

const providerSupportsKnowClaw = (type) => {
  const opt = PROVIDER_TYPE_OPTIONS.find((o) => o.value === type);
  return opt ? opt.supportsKnowClaw : true;
};

const newProviderId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `prov_${crypto.randomUUID().slice(0, 8)}`;
    }
  } catch { /* ignore */ }
  return `prov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
};

const cloneProvider = (p) => ({ ...p, modelsCache: { ...(p.modelsCache || { fetchedAt: '', models: [] }) } });

const isOpenAIResponsesModelId = (modelId) => {
  const id = String(modelId || '').toLowerCase();
  if (!id) return false;
  if (id.startsWith('gpt-')) return true;
  if (id === 'o1' || id === 'o3' || id === 'o4') return true;
  return /^o[134]-/.test(id);
};

const inferAssignmentApiMode = (provider, modelId) => {
  if (!provider) return 'responses';
  const providerMode = provider.apiMode === 'chat' ? 'chat' : 'responses';
  if (providerMode === 'chat') return 'chat';
  if (provider.type === 'openai') return providerMode;
  if (provider.type === 'openai-compatible') {
    return isOpenAIResponsesModelId(modelId) ? providerMode : 'chat';
  }
  return providerMode;
};

const VISION_MODEL_HINTS = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'claude-3',
  'gemini-1.5',
  'gemini-2',
  'vision',
  'vl',
  'glm-4v',
  'qwen-vl',
  'qwen2.5-vl',
  'doubao-vision',
];

const VISION_REASONING_EXACT = ['o1', 'o3'];

const inferModelSupportsImages = (modelId) => {
  const id = String(modelId || '').toLowerCase();
  if (!id) return false;
  if (VISION_MODEL_HINTS.some((hint) => id.includes(hint))) return true;
  return VISION_REASONING_EXACT.some((hint) => id === hint || id.endsWith(`/${hint}`));
};

const resolveAssignmentSupportsImages = (item, option) => {
  if (typeof item?.supportsImages === 'boolean') return item.supportsImages;
  if (typeof option?.supportsImages === 'boolean') return option.supportsImages;
  return inferModelSupportsImages(option?.model || item?.model);
};

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition-colors';
const selectCls = inputCls + ' appearance-none cursor-pointer';

const ProviderEditor = ({
  provider,
  expanded,
  onToggle,
  onChange,
  onDelete,
  onModelsFetched,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testModel, setTestModel] = useState('');

  const patch = useCallback((field, value) => {
    onChange({ ...provider, [field]: value });
  }, [provider, onChange]);

  const handleTypeChange = useCallback((newType) => {
    const next = { ...provider, type: newType };
    // 类型切换时，如果 baseURL 是空或仍是旧默认值，自动替换为新类型的默认值。
    const oldDefault = DEFAULT_BASE_URL_FOR[provider.type] || '';
    if (!provider.baseURL || provider.baseURL === oldDefault) {
      next.baseURL = DEFAULT_BASE_URL_FOR[newType] || '';
    }
    if (newType !== 'openai' && newType !== 'openai-compatible') {
      // 非 OpenAI 类不消费 apiMode，但保留以便切换回来时不丢配置。
    }
    onChange(next);
  }, [provider, onChange]);

  const handleFetchModels = useCallback(async () => {
    setFetching(true);
    setFetchError('');
    try {
      const res = await window.ipm?.prefs?.listAiModels?.(provider);
      if (res?.ok) {
        const fetchedAt = new Date().toISOString();
        const updated = {
          ...provider,
          modelsCache: { fetchedAt, models: res.models || [] },
        };
        onChange(updated);
        onModelsFetched?.(updated);
        if (!res.models || res.models.length === 0) {
          setFetchError('该 API 未返回任何模型，请确认地址/Key 是否正确。');
        }
      } else {
        setFetchError(res?.error || '查询失败');
      }
    } catch (err) {
      setFetchError(err?.message || String(err));
    } finally {
      setFetching(false);
    }
  }, [provider, onChange, onModelsFetched]);

  const handleTest = useCallback(async () => {
    const m = testModel.trim() || provider.modelsCache?.models?.[0]?.id || '';
    if (!m) {
      setTestResult({ ok: false, error: '请先查询模型，或在测试输入框里填一个模型 ID' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.ipm?.prefs?.testAiProvider?.(provider, m);
      setTestResult(res || { ok: false, error: '未收到响应' });
    } catch (err) {
      setTestResult({ ok: false, error: err?.message || String(err) });
    } finally {
      setTesting(false);
    }
  }, [provider, testModel]);

  const models = provider.modelsCache?.models || [];
  const fetchedAt = provider.modelsCache?.fetchedAt;
  const supportsKnowClaw = providerSupportsKnowClaw(provider.type);
  const isOpenAIFamily = provider.type === 'openai' || provider.type === 'openai-compatible';

  return (
    <div className="border border-slate-200 rounded-2xl bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 px-4 py-4 hover:bg-slate-50/70 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-2xl bg-slate-950 text-white flex items-center justify-center shrink-0">
            <Server size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-950 truncate">{provider.name || '未命名 Provider'}</div>
            <div className="text-xs text-slate-500 truncate mt-0.5">
              {PROVIDER_TYPE_TO_LABEL[provider.type] || provider.type}
              {' · '}
              {provider.baseURL || '未设置 Base URL'}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                provider.apiKey
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}>
                {provider.apiKey ? 'Key 已配置' : '未配置 Key'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200">
                {models.length} 个模型
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!supportsKnowClaw && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">仅非 KnowClaw 角色</span>
          )}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onDelete(); } }}
            className="h-8 w-8 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center"
            title="删除"
          >
            <Trash2 size={14} />
          </span>
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">显示名称</label>
              <input
                type="text"
                value={provider.name || ''}
                onChange={(e) => patch('name', e.target.value)}
                placeholder="例如 OpenAI 官方 / CloseAI 中转"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">类型</label>
              <select
                value={provider.type}
                onChange={(e) => handleTypeChange(e.target.value)}
                className={selectCls}
              >
                {PROVIDER_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">API Base URL</label>
            <input
              type="text"
              value={provider.baseURL || ''}
              onChange={(e) => patch('baseURL', e.target.value)}
              placeholder={DEFAULT_BASE_URL_FOR[provider.type] || 'https://api.example.com/v1'}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={provider.apiKey || ''}
                onChange={(e) => patch('apiKey', e.target.value)}
                placeholder="sk-... 或 ak-..."
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

          {isOpenAIFamily && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                OpenAI 协议端点
                <span className="text-slate-400 font-normal ml-1">影响 KnowClaw 思考流；不确定就保持 responses。</span>
              </label>
              <select
                value={provider.apiMode || 'responses'}
                onChange={(e) => patch('apiMode', e.target.value)}
                className={selectCls}
              >
                <option value="responses">/responses（推荐，支持推理模型思考流）</option>
                <option value="chat">/chat/completions（兼容老网关）</option>
              </select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleFetchModels}
              disabled={fetching || !provider.apiKey || !provider.baseURL}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              查询可用模型
            </button>
            {fetchedAt && (
              <span className="text-[11px] text-slate-500">
                上次查询：{new Date(fetchedAt).toLocaleString()}（{models.length} 个）
              </span>
            )}
          </div>
          {fetchError && (
            <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <div>{fetchError}</div>
            </div>
          )}
          {models.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 text-[11px] text-slate-500 border-b border-slate-200">
                共 {models.length} 个模型
              </div>
              <div className="max-h-40 overflow-y-auto text-xs divide-y divide-slate-100">
                {models.map((m) => (
                  <div key={m.id} className="px-3 py-1.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-slate-700 truncate">{m.id}</span>
                    {m.name && m.name !== m.id && (
                      <span className="text-slate-400 truncate">{m.name}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <label className="block text-xs font-medium text-slate-700">测试连接</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={testModel}
                onChange={(e) => setTestModel(e.target.value)}
                placeholder={models[0]?.id || '输入要测试的模型 ID'}
                className={inputCls + ' flex-1 min-w-[200px]'}
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !provider.apiKey || !provider.baseURL}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {testing && <Loader2 size={12} className="animate-spin" />}
                测试
              </button>
            </div>
            {testResult && (
              <div className={`text-xs px-3 py-2 rounded-lg ${testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {testResult.ok ? '连接成功。' : `连接失败：${testResult.error || '未知错误'}`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// 给定 providers 列表，扁平展开成 { providerId, model, label } 的下拉条目。
// 当 onlyKnowClawCompatible 为真，只包含 KnowClaw 可用的 provider。
const buildModelOptions = (providers, { onlyKnowClawCompatible = false } = {}) => {
  const out = [];
  for (const p of providers) {
    if (onlyKnowClawCompatible && !providerSupportsKnowClaw(p.type)) continue;
    const models = p.modelsCache?.models || [];
    for (const m of models) {
      out.push({
        providerId: p.id,
        model: m.id,
        apiMode: inferAssignmentApiMode(p, m.id),
        supportsImages: inferModelSupportsImages(m.id),
        label: `${p.name || p.id} · ${m.id}`,
      });
    }
  }
  return out;
};

const optionKey = (o) => `${o.providerId}::${o.model}`;
const assignmentKey = (a) => (a ? `${a.providerId}::${a.model}` : '');

const ModelSearchSelect = ({
  options,
  value,
  onChange,
  placeholder = '选择模型',
  emptyText = '没有可用模型',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const currentKey = typeof value === 'string' ? value : assignmentKey(value);
  const selected = options.find((o) => optionKey(o) === currentKey) || null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const haystack = `${o.label} ${o.model} ${o.providerId}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  const handleChoose = (opt) => {
    onChange?.(opt ? {
      providerId: opt.providerId,
      model: opt.model,
      apiMode: opt.apiMode,
      supportsImages: opt.supportsImages,
    } : null);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`w-full h-11 px-3 rounded-xl border bg-white text-left transition-all ${
          open
            ? 'border-slate-900 ring-4 ring-slate-900/5'
            : 'border-slate-200 hover:border-slate-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {selected ? (
              <>
                <div className="text-xs text-slate-400 truncate">{selected.label.split(' · ')[0]}</div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-slate-900 truncate">{selected.model}</span>
                  {selected.apiMode && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500">
                      {API_MODE_META[selected.apiMode]?.short || selected.apiMode}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-400">{placeholder}</div>
            )}
          </div>
          <ChevronDown size={15} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && !disabled && (
        <div className="absolute z-40 mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.16)] overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索模型或 Provider..."
                className="w-full h-9 pl-9 pr-3 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:bg-white focus:border-slate-400 transition-colors"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400">{emptyText}</div>
            ) : (
              filtered.map((opt) => {
                const active = optionKey(opt) === currentKey;
                return (
                  <button
                    key={optionKey(opt)}
                    type="button"
                    onClick={() => handleChoose(opt)}
                    className={`w-full px-3 py-2.5 rounded-xl text-left transition-colors ${
                      active ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className={`text-[11px] truncate ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                          {opt.label.split(' · ')[0]}
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{opt.model}</span>
                          {opt.apiMode && (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                              active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {API_MODE_META[opt.apiMode]?.short || opt.apiMode}
                            </span>
                          )}
                        </div>
                      </div>
                      {active && <Check size={14} className="shrink-0" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const AssignedModelCard = ({ item, option, onRemove, onModeChange, onImageInputChange }) => {
  const providerName = option?.label?.split(' · ')[0] || item.providerId;
  const modelName = option?.model || item.model;
  const apiMode = item.apiMode || option?.apiMode || 'responses';
  const supportsImages = resolveAssignmentSupportsImages(item, option);
  return (
    <div className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-xl bg-slate-950 text-white flex items-center justify-center shrink-0">
          <Sparkles size={15} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">{modelName}</div>
          <div className="text-xs text-slate-500 truncate">{providerName}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onImageInputChange?.(!supportsImages)}
          className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-[10px] font-semibold transition-colors ${
            supportsImages
              ? 'border-blue-200 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-800'
          }`}
          title={supportsImages ? '允许在输入框粘贴图片' : '禁止在输入框粘贴图片'}
        >
          <Eye size={12} />
          图片
        </button>
        <div className="flex items-center rounded-full border border-slate-200 bg-slate-50 p-0.5" title="模型协议">
          {['responses', 'chat'].map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange?.(mode)}
              className={`h-6 px-2 rounded-full text-[10px] font-semibold transition-colors ${
                apiMode === mode
                  ? 'bg-slate-950 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title={API_MODE_META[mode].label}
            >
              {API_MODE_META[mode].short}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="h-8 w-8 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-70 group-hover:opacity-100 transition-all flex items-center justify-center"
          title="移除"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

const RoleAssignmentRow = ({ role, providers, value, onChange }) => {
  const options = useMemo(
    () => buildModelOptions(providers, { onlyKnowClawCompatible: role.value === 'knowclaw' }),
    [providers, role.value],
  );
  const hasOptions = options.length > 0;
  // 必须在顶层调用 hook，无论是单选还是多选模式都要保持调用顺序一致。
  const [pending, setPending] = useState(null);

  if (role.multi) {
    const items = Array.isArray(value) ? value : [];
    const handleAdd = () => {
      if (!pending) return;
      const key = assignmentKey(pending);
      if (items.some((a) => assignmentKey(a) === key)) {
        setPending(null);
        return;
      }
      onChange([...items, { ...pending, apiMode: pending.apiMode || 'responses' }]);
      setPending(null);
    };
    const handleRemove = (idx) => {
      const next = items.slice();
      next.splice(idx, 1);
      onChange(next);
    };
    const handleModeChange = (idx, apiMode) => {
      onChange(items.map((item, i) => (i === idx ? { ...item, apiMode } : item)));
    };
    const handleImageInputChange = (idx, supportsImages) => {
      onChange(items.map((item, i) => (i === idx ? { ...item, supportsImages } : item)));
    };
    return (
      <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-950">{role.label}</div>
            {role.desc && <div className="text-xs text-slate-500 mt-1">{role.desc}</div>}
          </div>
          <span className="text-[11px] px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-500">
            {items.length} 个模型
          </span>
        </div>
        {items.length === 0 && (
          <div className="text-sm px-4 py-4 rounded-2xl bg-white border border-dashed border-slate-200 text-slate-500">
            尚未分配 KnowClaw 模型。添加后会出现在 KnowClaw 的模型切换菜单中。
          </div>
        )}
        {items.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {items.map((item, idx) => {
              const opt = options.find((o) => o.providerId === item.providerId && o.model === item.model);
              return (
                <AssignedModelCard
                  key={`${item.providerId}/${item.model}/${idx}`}
                  item={item}
                  option={opt}
                  onRemove={() => handleRemove(idx)}
                  onModeChange={(apiMode) => handleModeChange(idx, apiMode)}
                  onImageInputChange={(supportsImages) => handleImageInputChange(idx, supportsImages)}
                />
              );
            })}
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <ModelSearchSelect
            options={options}
            value={pending}
            onChange={setPending}
            placeholder={hasOptions ? '搜索并选择一个 KnowClaw 模型' : '请先在 Provider 中查询模型'}
            emptyText="没有匹配的 KnowClaw 模型"
            disabled={!hasOptions}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!pending}
            className="inline-flex items-center gap-1.5 px-4 h-11 text-sm font-medium rounded-xl bg-slate-950 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={14} />
            添加
          </button>
        </div>
      </div>
    );
  }

  const current = value || null;
  const currentKey = assignmentKey(current);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-950">{role.label}</div>
        {role.desc && <div className="text-xs text-slate-500 mt-1">{role.desc}</div>}
      </div>
      <ModelSearchSelect
        options={options}
        value={currentKey}
        onChange={onChange}
        placeholder={hasOptions ? '搜索并选择模型' : '请先在 Provider 中查询模型'}
        emptyText="没有匹配的模型"
        disabled={!hasOptions}
      />
      {!current && hasOptions && (
        <div className="text-[11px] text-slate-400">未选择时会自动回退到 KnowClaw 的第一个模型。</div>
      )}
    </div>
  );
};

const emptyRoleAssignments = () => ({
  knowclaw: [],
  classification: null,
  summary: null,
  preferenceParsing: null,
});

const LlmConfigCard = () => {
  const [providers, setProviders] = useState([]);
  const [roleAssignments, setRoleAssignments] = useState(emptyRoleAssignments());
  const [expandedId, setExpandedId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveError, setSaveError] = useState('');

  const loadFromState = useCallback(async () => {
    try {
      const res = await window.ipm?.prefs?.get?.();
      const ai = res?.prefs?.ai;
      if (ai && Array.isArray(ai.providers)) {
        setProviders(ai.providers.map(cloneProvider));
        setRoleAssignments({
          knowclaw: Array.isArray(ai.roleAssignments?.knowclaw) ? ai.roleAssignments.knowclaw : [],
          classification: ai.roleAssignments?.classification || null,
          summary: ai.roleAssignments?.summary || null,
          preferenceParsing: ai.roleAssignments?.preferenceParsing || null,
        });
        if (ai.providers.length > 0 && !expandedId) {
          setExpandedId(ai.providers[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load AI config:', e);
    }
  }, [expandedId]);

  useEffect(() => {
    loadFromState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markDirty = useCallback(() => {
    setDirty(true);
    setSaveMsg('');
    setSaveError('');
  }, []);

  const handleAddProvider = useCallback(() => {
    const id = newProviderId();
    const next = {
      id,
      name: '新 Provider',
      type: 'openai-compatible',
      baseURL: '',
      apiKey: '',
      apiMode: 'responses',
      modelsCache: { fetchedAt: '', models: [] },
    };
    setProviders((list) => [...list, next]);
    setExpandedId(id);
    markDirty();
  }, [markDirty]);

  const handleProviderChange = useCallback((idx, updated) => {
    setProviders((list) => list.map((p, i) => (i === idx ? updated : p)));
    markDirty();
  }, [markDirty]);

  const handleProviderDelete = useCallback((idx) => {
    setProviders((list) => {
      const toDelete = list[idx];
      const next = list.filter((_, i) => i !== idx);
      // 同步清理引用到该 provider 的角色分配
      if (toDelete) {
        setRoleAssignments((ra) => ({
          knowclaw: ra.knowclaw.filter((a) => a.providerId !== toDelete.id),
          classification: ra.classification?.providerId === toDelete.id ? null : ra.classification,
          summary: ra.summary?.providerId === toDelete.id ? null : ra.summary,
          preferenceParsing: ra.preferenceParsing?.providerId === toDelete.id ? null : ra.preferenceParsing,
        }));
      }
      return next;
    });
    markDirty();
  }, [markDirty]);

  const handleRoleChange = useCallback((roleValue, value) => {
    setRoleAssignments((ra) => ({ ...ra, [roleValue]: value }));
    markDirty();
  }, [markDirty]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg('');
    setSaveError('');
    try {
      const payload = {
        ai: {
          providers,
          roleAssignments,
        },
      };
      const res = await window.ipm?.prefs?.set?.(payload);
      if (res?.ok) {
        setDirty(false);
        setSaveMsg('已保存');
        // 用主进程返回的规范化结果回写，避免本地状态和后端漂移
        const ai = res?.prefs?.ai;
        if (ai) {
          setProviders(ai.providers.map(cloneProvider));
          setRoleAssignments({
            knowclaw: Array.isArray(ai.roleAssignments?.knowclaw) ? ai.roleAssignments.knowclaw : [],
            classification: ai.roleAssignments?.classification || null,
            summary: ai.roleAssignments?.summary || null,
            preferenceParsing: ai.roleAssignments?.preferenceParsing || null,
          });
        }
        setTimeout(() => setSaveMsg(''), 2000);
      } else {
        setSaveError('保存失败');
      }
    } catch (e) {
      setSaveError('保存失败：' + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  }, [providers, roleAssignments]);

  const knowclawHasModel = (roleAssignments.knowclaw || []).length > 0;

  return (
    <Card
      title="AI 模型配置"
      description="管理多个 AI Provider，并把不同模型分配给 KnowClaw、文件分类等功能。修改后需点击下方“保存”。"
      overflowVisible
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400 font-semibold">Providers</div>
            <div className="text-2xl font-semibold text-slate-950 mt-1">{providers.length}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400 font-semibold">KnowClaw Models</div>
            <div className="text-2xl font-semibold text-slate-950 mt-1">{roleAssignments.knowclaw?.length || 0}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400 font-semibold">Status</div>
            <div className={`text-sm font-medium mt-2 ${dirty ? 'text-amber-700' : 'text-emerald-700'}`}>
              {dirty ? '有未保存修改' : '配置已同步'}
            </div>
          </div>
        </div>

        {/* Providers 列表 */}
        <section className="rounded-3xl border border-slate-200 bg-white overflow-visible">
          <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Server size={15} className="text-slate-500" />
                1. API 接入点
              </div>
              <p className="text-xs text-slate-500 mt-1">
                管理 OpenAI、Claude、Gemini 或任意 OpenAI 兼容中转站。先查询模型，再在下方分配用途。
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddProvider}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 hover:border-slate-300 transition-colors shrink-0"
            >
              <Plus size={13} />
              新增 Provider
            </button>
          </div>

          <div className="p-4">
            {providers.length === 0 ? (
              <div className="text-sm px-4 py-8 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-slate-500 text-center">
                尚未配置任何 Provider。点击“新增 Provider”开始；旧版 `llm` 配置会自动迁移并展示在这里。
              </div>
            ) : (
              <div className="space-y-2.5">
              {providers.map((p, idx) => (
                <ProviderEditor
                  key={p.id}
                  provider={p}
                  expanded={expandedId === p.id}
                  onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  onChange={(updated) => handleProviderChange(idx, updated)}
                  onDelete={() => handleProviderDelete(idx)}
                  onModelsFetched={() => markDirty()}
                />
              ))}
              </div>
            )}
          </div>
        </section>

        {/* 角色分配 */}
        <section className="rounded-3xl border border-slate-200 bg-white overflow-visible">
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Route size={15} className="text-slate-500" />
              2. 模型路由
            </div>
            <p className="text-xs text-slate-500 mt-1">
              为每个 AI 功能选择最适合的模型。KnowClaw 支持多个模型，其它功能使用一个固定模型。
            </p>
          </div>

          <div className="p-4 space-y-4">
            <RoleAssignmentRow
              role={ROLE_OPTIONS[0]}
              providers={providers}
              value={roleAssignments.knowclaw}
              onChange={(v) => handleRoleChange('knowclaw', v)}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {ROLE_OPTIONS.slice(1).map((role) => (
              <RoleAssignmentRow
                key={role.value}
                role={role}
                providers={providers}
                value={roleAssignments[role.value]}
                onChange={(v) => handleRoleChange(role.value, v)}
              />
              ))}
            </div>

            {!knowclawHasModel && providers.length > 0 && (
              <div className="text-xs px-3 py-2 rounded-xl bg-amber-50 text-amber-700 border border-amber-200">
                未给 KnowClaw 分配任何模型时，KnowClaw 对话将无法启动。请至少添加一个模型。
              </div>
            )}
          </div>
        </section>

        {/* 保存 */}
        <div className="sticky bottom-0 z-10 -mx-6 -mb-5 px-6 py-4 bg-white/90 backdrop-blur border-t border-slate-100 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {dirty ? '更改尚未写入本地配置。' : '当前配置已保存到本地。'}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-xl bg-slate-950 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            保存配置
          </button>
          {saveMsg && <span className="text-xs text-green-600 font-medium">{saveMsg}</span>}
          {saveError && <span className="text-xs text-red-600 font-medium">{saveError}</span>}
          {dirty && !saveMsg && !saveError && <span className="text-xs text-slate-500">有未保存的修改</span>}
        </div>

        <div className="text-[11px] text-slate-500 leading-relaxed space-y-1">
          <div>• OpenAI 兼容 / OpenAI 官方 类型可同时用于 KnowClaw 与所有其他角色。</div>
          <div>• Claude / Gemini 官方暂不支持作为 KnowClaw 的直连后端，但可分配给文件分类、摘要、偏好解析。若想在 KnowClaw 中使用 Claude/Gemini，可改走 OpenAI 兼容协议的中转网关。</div>
          <div>• 修改保存后，KnowClaw 已存在的会话保持原模型；新建会话或在 KnowClaw 头部切换模型时使用新配置。</div>
        </div>
      </div>
    </Card>
  );
};

const SearchApiCard = () => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.ipm?.prefs?.get?.();
        if (cancelled) return;
        const sa = res?.prefs?.searchApi;
        if (sa) setApiKey(sa.apiKey || '');
      } catch (e) {
        console.error('Failed to load search API config:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback((e) => {
    setApiKey(e.target.value);
    setDirty(true);
    setTestResult(null);
    setSaveMsg('');
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      await window.ipm?.prefs?.set?.({ searchApi: { provider: 'bocha', apiKey } });
      setDirty(false);
      setSaveMsg('已保存');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (e) {
      setSaveMsg('保存失败：' + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  }, [apiKey]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.ipm?.prefs?.testSearchApi?.({ provider: 'bocha', apiKey });
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: e?.message || String(e) });
    } finally {
      setTesting(false);
    }
  }, [apiKey]);

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition-colors';

  const hasKey = Boolean(apiKey && apiKey.trim());

  return (
    <Card
      title="网页搜索 API"
      description="配置博查 (Bocha) 搜索 API Key，为 KnowClaw 提供联网搜索能力。"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">API Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={handleChange}
              placeholder="sk-bocha-..."
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

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            保存
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !hasKey}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testing && <Loader2 size={14} className="animate-spin" />}
            测试连接
          </button>
          {saveMsg && <span className="text-xs text-green-600 font-medium">{saveMsg}</span>}
        </div>

        {testResult && (
          <div className={`text-xs px-3 py-2 rounded-lg ${testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {testResult.ok ? '连接成功，搜索 API 可正常使用。' : `连接失败：${testResult.error || '未知错误'}`}
          </div>
        )}

        {!hasKey && (
          <div className="text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
            未配置搜索 API Key 时，KnowClaw 仍可抓取你指定的 URL，但无法主动联网搜索。
          </div>
        )}

        <div className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
          <div className="flex items-start gap-2">
            <Search size={14} className="text-slate-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-slate-700 font-medium mb-0.5">如何获取 API Key</div>
              <div>
                前往
                <a
                  href="https://open.bochaai.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-slate-900 hover:underline mx-1"
                >
                  博查 AI 开放平台
                  <ExternalLink size={11} />
                </a>
                注册账号，新用户可免费获得 1000 次搜索调用额度。
              </div>
              <div className="mt-1 text-slate-400">
                配置变更将在下次新建 / 打开 KnowClaw 会话时生效。
              </div>
            </div>
          </div>
        </div>
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
          <SearchApiCard />

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



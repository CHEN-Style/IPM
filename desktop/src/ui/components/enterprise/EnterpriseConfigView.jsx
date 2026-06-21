// H6: Enterprise console — Config Center (AI config templates).
//
// Admins manage org AI config templates here: create from the local machine's
// current AI settings, rotate/disable/enable codes, edit metadata, and review
// who imported each template. Member-side import lives in the Settings page.
//
// UI baseline: desktop/design/settings-mockup.html (#console-config), reusing
// the Linear-style primitives from shared.jsx.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, Copy, Loader2, RefreshCw, MoreHorizontal, KeyRound,
  Ban, RotateCw, Pencil, Power, Users, ShieldCheck,
} from 'lucide-react';
import { useToast } from '../../hooks/useToast.js';
import { fmtDate, fmtRelative, copyText, avatarColor, Modal, WarnBox, FIELD_LABEL } from './shared.jsx';

const ACCENT = '#3e4b9c';
const BORDER = '#e8eaf0';
const SECONDARY_BTN = { background: '#fff', border: `1px solid ${BORDER}`, color: '#475569' };

function StatusTag({ status }) {
  const map = {
    active: { label: '启用', bg: '#ecfdf5', color: '#2d7a5f', dot: '#2d7a5f' },
    disabled: { label: '已停用', bg: '#f1f5f9', color: '#64748b', dot: '#cbd5e1' },
    archived: { label: '已归档', bg: '#fef3c7', color: '#b45309', dot: '#b45309' },
  };
  const m = map[status] || map.disabled;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: m.bg, color: m.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.label}
    </span>
  );
}

function summaryChips(summary) {
  const s = summary || {};
  const roles = s.roles || {};
  const roleParts = [];
  if (roles.knowclaw) roleParts.push(`KnowClaw ${roles.knowclaw} 个`);
  if (roles.classification) roleParts.push('分类');
  if (roles.summary) roleParts.push('摘要');
  if (roles.preferenceParsing) roleParts.push('偏好解析');
  const providerNames = Array.isArray(s.providerNames) ? s.providerNames.filter(Boolean) : [];
  return [
    { text: providerNames.length ? `${s.providerCount || providerNames.length} 个 Provider:${providerNames.join('、')}` : `${s.providerCount || 0} 个 Provider` },
    { text: roleParts.length ? roleParts.join(' / ') : '未配置角色分配' },
    { text: s.hasSearchApi ? '包含搜索 API' : '不含搜索 API Key' },
    { text: s.containsSecrets ? '包含 API Key 等敏感凭证' : '未检测到敏感凭证', warn: Boolean(s.containsSecrets) },
  ];
}

const EnterpriseConfigView = () => {
  const { showToast } = useToast();

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(null); // { x, y, template }

  // drawer: { template, uses, usesLoading }
  const [drawer, setDrawer] = useState(null);

  // create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [localSummary, setLocalSummary] = useState(null); // { providerCount, keyCount, hasSearchKey }
  const [form, setForm] = useState({ name: '', description: '', maxUses: '', expiresAt: '' });

  // edit / disable / rotate targets
  const [editTarget, setEditTarget] = useState(null); // template
  const [editForm, setEditForm] = useState({ name: '', description: '', maxUses: '', expiresAt: '' });
  const [disableTarget, setDisableTarget] = useState(null);
  const [rotateTarget, setRotateTarget] = useState(null);

  const orgConfig = () => window.ipm?.prefs?.orgConfig;

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await orgConfig()?.listTemplates?.();
      if (!res?.ok) throw new Error(res?.error || '加载模板失败');
      setTemplates(res.templates || []);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => {
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // ── derived ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => `${t.name} ${t.description} ${t.code}`.toLowerCase().includes(q));
  }, [templates, query]);

  const stats = useMemo(() => {
    const enabled = templates.filter((t) => t.status === 'active').length;
    const imports = templates.reduce((sum, t) => sum + (Number(t.usedCount) || 0), 0);
    const activeCodes = templates.filter((t) => t.status === 'active' && (!t.expiresAt || new Date(t.expiresAt) > new Date()) && (t.maxUses == null || t.usedCount < t.maxUses)).length;
    return { total: templates.length, enabled, imports, activeCodes };
  }, [templates]);

  // ── actions ─────────────────────────────────────────────────────────────
  const openDrawer = useCallback(async (template) => {
    setDrawer({ template, uses: [], usesLoading: true });
    try {
      const res = await orgConfig()?.listUses?.(template.id);
      setDrawer((d) => (d && d.template.id === template.id ? { ...d, uses: res?.ok ? res.uses || [] : [], usesLoading: false } : d));
    } catch {
      setDrawer((d) => (d && d.template.id === template.id ? { ...d, uses: [], usesLoading: false } : d));
    }
  }, []);

  const openCreate = useCallback(async () => {
    setForm({ name: '', description: '', maxUses: '', expiresAt: '' });
    setLocalSummary(null);
    setCreateOpen(true);
    try {
      const res = await window.ipm?.prefs?.get?.();
      const ai = res?.prefs?.ai || {};
      const providers = Array.isArray(ai.providers) ? ai.providers : [];
      const keyCount = providers.filter((p) => p && p.apiKey).length;
      const hasSearchKey = Boolean(res?.prefs?.searchApi?.apiKey);
      setLocalSummary({ providerCount: providers.length, keyCount, hasSearchKey });
    } catch {
      setLocalSummary({ providerCount: 0, keyCount: 0, hasSearchKey: false });
    }
  }, []);

  const handleCreate = async () => {
    const name = form.name.trim();
    if (!name) { showToast('请填写模板名称', 'error'); return; }
    const maxUsesText = String(form.maxUses).trim();
    const maxUses = maxUsesText ? Number(maxUsesText) : null;
    if (maxUsesText && (!Number.isInteger(maxUses) || maxUses <= 0)) { showToast('最大使用次数必须是正整数', 'error'); return; }
    setBusy(true);
    try {
      const res = await orgConfig()?.createTemplate?.({
        name,
        description: form.description,
        maxUses,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      });
      if (!res?.ok) throw new Error(res?.error || '创建失败');
      showToast(`模板已创建 · 配置码 ${res.template?.code || ''}`);
      setCreateOpen(false);
      await loadTemplates();
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (template) => {
    setMenu(null);
    setEditForm({
      name: template.name || '',
      description: template.description || '',
      maxUses: template.maxUses == null ? '' : String(template.maxUses),
      expiresAt: template.expiresAt ? new Date(template.expiresAt).toISOString().slice(0, 16) : '',
    });
    setEditTarget(template);
  };

  const handleEdit = async () => {
    const t = editTarget;
    if (!t) return;
    const name = editForm.name.trim();
    if (!name) { showToast('请填写模板名称', 'error'); return; }
    const maxUsesText = String(editForm.maxUses).trim();
    const maxUses = maxUsesText ? Number(maxUsesText) : null;
    if (maxUsesText && (!Number.isInteger(maxUses) || maxUses <= 0)) { showToast('最大使用次数必须是正整数', 'error'); return; }
    setBusy(true);
    try {
      const res = await orgConfig()?.updateTemplate?.(t.id, {
        name,
        description: editForm.description,
        maxUses,
        expiresAt: editForm.expiresAt ? new Date(editForm.expiresAt).toISOString() : null,
      });
      if (!res?.ok) throw new Error(res?.error || '保存失败');
      showToast('模板已更新');
      setEditTarget(null);
      await loadTemplates();
      if (drawer?.template.id === t.id) setDrawer((d) => ({ ...d, template: res.template }));
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async () => {
    const t = rotateTarget;
    if (!t) return;
    setBusy(true);
    try {
      const res = await orgConfig()?.rotateCode?.(t.id);
      if (!res?.ok) throw new Error(res?.error || '刷新失败');
      showToast(`配置码已刷新 · ${res.template?.code || ''}`);
      setRotateTarget(null);
      await loadTemplates();
      if (drawer?.template.id === t.id) setDrawer((d) => ({ ...d, template: res.template }));
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    const t = disableTarget;
    if (!t) return;
    setBusy(true);
    try {
      const res = await orgConfig()?.disableTemplate?.(t.id);
      if (!res?.ok) throw new Error(res?.error || '停用失败');
      showToast('模板已停用');
      setDisableTarget(null);
      await loadTemplates();
      if (drawer?.template.id === t.id) setDrawer((d) => ({ ...d, template: res.template }));
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async (template) => {
    setMenu(null);
    setBusy(true);
    try {
      const res = await orgConfig()?.enableTemplate?.(template.id);
      if (!res?.ok) throw new Error(res?.error || '启用失败');
      showToast('模板已重新启用');
      await loadTemplates();
      if (drawer?.template.id === template.id) setDrawer((d) => ({ ...d, template: res.template }));
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (code) => {
    (await copyText(code)) ? showToast('配置码已复制') : showToast('复制失败', 'error');
  };

  const openRowMenu = (e, template) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: Math.min(r.left, window.innerWidth - 200), y: r.bottom + 4, template });
  };

  const drawerChips = drawer ? summaryChips(drawer.template.summary) : [];

  return (
    <>
      {/* ── 过滤行 ── */}
      <div className="flex items-center flex-wrap gap-2.5 gap-y-2 mt-[18px] mb-3.5">
        <div className="inline-flex rounded-[7px] p-0.5 shrink-0" style={{ background: '#eef0f4' }}>
          <button type="button" className="px-3 py-[5px] rounded-md text-[12.5px]"
            style={{ background: '#fff', color: '#1e293b', fontWeight: 500, boxShadow: '0 1px 2px rgba(15,23,42,0.08)' }}>
            AI 配置 {templates.length}
          </button>
          <span className="px-3 py-[5px] rounded-md text-[12.5px] inline-flex items-center gap-1.5" style={{ color: '#b6bdc9', cursor: 'not-allowed' }}>
            MCP 配置
            <span className="text-[10px] font-medium px-1.5 py-px rounded-full" style={{ background: '#f1f5f9', color: '#94a3b8' }}>规划中</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 flex-1 min-w-[140px] max-w-[220px]" style={{ background: '#fff', border: `1px solid ${BORDER}` }}>
          <Search size={13} style={{ color: '#94a3b8' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索模板名称或配置码…"
            className="w-full outline-none text-[12.5px] bg-transparent" style={{ color: '#1e293b' }} />
        </div>
        <div className="flex-1" />
        <button type="button" onClick={openCreate}
          className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors shrink-0 whitespace-nowrap"
          style={{ background: ACCENT }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#34407e'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ACCENT; }}>
          <Plus size={13} strokeWidth={2.2} />从本机配置创建模板
        </button>
      </div>

      {/* ── 错误 / 加载 ── */}
      {error && (
        <div className="mt-1 mb-3 flex items-center justify-between gap-2 text-[13px] px-3 py-2 rounded-lg"
          style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
          <span>{error}</span>
          <button type="button" onClick={loadTemplates} className="flex items-center gap-1 text-[12px] shrink-0 hover:underline">
            <RefreshCw size={12} />重试
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-[13px]" style={{ color: '#94a3b8' }}>
          <Loader2 size={16} className="animate-spin" />加载中…
        </div>
      ) : (
        <>
          {/* ── 统计条 ── */}
          <div className="flex flex-wrap gap-2.5 mb-[18px] [&>*]:min-w-[120px]">
            {[
              { k: 'AI 配置模板', v: <>{stats.total} <small>· {stats.enabled} 启用</small></> },
              { k: '累计导入', v: <>{stats.imports} <small>次</small></> },
              { k: '活跃配置码', v: stats.activeCodes },
            ].map((s) => (
              <div key={s.k} className="flex-1 rounded-[10px] px-4 py-3" style={{ background: '#fff', border: `1px solid ${BORDER}` }}>
                <div style={FIELD_LABEL}>{s.k}</div>
                <div className="text-[22px] font-semibold mt-1 [&_small]:text-[12px] [&_small]:font-normal [&_small]:text-slate-400 [&_small]:ml-1"
                  style={{ color: '#1e293b', letterSpacing: '-0.02em' }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* ── 表格 ── */}
          <div className="rounded-[10px] overflow-x-auto" style={{ background: '#fff', border: `1px solid ${BORDER}` }}>
            <table className="w-full min-w-[640px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fbfcfd' }}>
                  {[['模板', '34%'], ['状态', '11%'], ['配置码', '20%'], ['使用', '13%'], ['过期', '13%'], ['创建人', '13%'], ['', '6%']].map(([h, w], i) => (
                    <th key={h || i} className="text-left px-4 py-[9px] text-[11px] font-medium uppercase"
                      style={{ color: '#94a3b8', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', width: w }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-[13px]" style={{ color: '#94a3b8' }}>
                    {templates.length === 0 ? '暂无 AI 配置模板,点击右上角「从本机配置创建模板」开始' : '没有匹配的模板'}
                  </td></tr>
                )}
                {filtered.map((t) => {
                  const disabled = t.status !== 'active';
                  const pct = t.maxUses ? Math.min(100, Math.round((t.usedCount / Math.max(1, t.maxUses)) * 100)) : 0;
                  return (
                    <tr key={t.id} className="group transition-colors hover:bg-slate-50 cursor-pointer" onClick={() => openDrawer(t)}>
                      <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium truncate" style={{ color: disabled ? '#94a3b8' : '#1e293b' }}>{t.name}</div>
                          {t.description && <div className="text-[11.5px] truncate mt-0.5" style={{ color: '#b6bdc9' }}>{t.description}</div>}
                        </div>
                      </td>
                      <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}><StatusTag status={t.status} /></td>
                      <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold"
                          style={{ fontFamily: '"SF Mono", "JetBrains Mono", Menlo, monospace', letterSpacing: '0.03em', color: disabled ? '#94a3b8' : '#1e293b', textDecoration: disabled ? 'line-through' : 'none' }}>
                          {t.code}
                          {!disabled && (
                            <button type="button" title="复制" className="flex transition-colors hover:text-[#3e4b9c]" style={{ color: '#94a3b8' }}
                              onClick={(e) => { e.stopPropagation(); copyCode(t.code); }}>
                              <Copy size={12} />
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <div className="text-[12px]" style={{ color: '#64748b' }}>{t.usedCount} / {t.maxUses ?? '不限'}</div>
                        {t.maxUses != null && (
                          <div className="rounded-full overflow-hidden mt-1" style={{ width: 64, height: 4, background: '#eef0f4' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: disabled ? '#cbd5e1' : ACCENT }} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-[11px] text-[12px]" style={{ borderBottom: '1px solid #f1f5f9', color: '#64748b' }}>
                        {t.expiresAt ? fmtDate(t.expiresAt) : '不过期'}
                      </td>
                      <td className="px-4 py-[11px] text-[12px]" style={{ borderBottom: '1px solid #f1f5f9', color: '#64748b' }}>
                        {t.createdByName || '—'}
                      </td>
                      <td className="px-4 py-[11px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={(e) => openRowMenu(e, t)}
                            className="w-[26px] h-[26px] rounded-md flex items-center justify-center transition-colors hover:bg-slate-100"
                            style={{ color: '#94a3b8' }} title="操作">
                            <MoreHorizontal size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2.5 text-[11.5px]" style={{ color: '#94a3b8' }}>
            模板从管理员本机当前 AI 配置打包并<b style={{ color: '#64748b' }}>加密存储</b>;成员在「设置 › 企业配置」中凭配置码导入。点击行查看详情与导入记录。
          </p>
        </>
      )}

      {/* ── 行操作菜单 ── */}
      {menu && (
        <div className="fixed z-50 rounded-[9px] p-1"
          style={{ top: menu.y, left: menu.x, minWidth: 176, background: '#fff', border: `1px solid ${BORDER}`, boxShadow: '0 4px 24px rgba(15,23,42,0.12), 0 1px 3px rgba(15,23,42,0.08)' }}
          onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { setMenu(null); copyCode(menu.template.code); }}
            className="w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
            <Copy size={13} />复制配置码
          </button>
          <button type="button" onClick={() => openEdit(menu.template)}
            className="w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
            <Pencil size={13} />编辑元数据
          </button>
          {menu.template.status === 'active' && (
            <button type="button" onClick={() => { setMenu(null); setRotateTarget(menu.template); }}
              className="w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#475569' }}>
              <RotateCw size={13} />刷新配置码
            </button>
          )}
          <div className="h-px my-1 mx-1.5" style={{ background: '#f1f5f9' }} />
          {menu.template.status === 'active' ? (
            <button type="button" onClick={() => { setMenu(null); setDisableTarget(menu.template); }}
              className="w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-red-50" style={{ color: '#b91c1c' }}>
              <Ban size={13} />停用模板
            </button>
          ) : menu.template.status === 'disabled' ? (
            <button type="button" onClick={() => handleEnable(menu.template)}
              className="w-full flex items-center gap-2 px-2 py-[7px] rounded-md text-left text-[12.5px] transition-colors hover:bg-slate-100" style={{ color: '#2d7a5f' }}>
              <Power size={13} />重新启用
            </button>
          ) : null}
        </div>
      )}

      {/* ── 详情抽屉 ── */}
      {drawer && (
        <>
          <div className="fixed inset-0 z-[80]" style={{ background: 'rgba(15,23,42,0.18)' }} onClick={() => setDrawer(null)} />
          <aside className="fixed top-0 right-0 h-screen z-[90] bg-white flex flex-col w-[min(480px,calc(100vw-32px))]"
            style={{ boxShadow: '-8px 0 40px rgba(15,23,42,0.12)' }}>
            <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid #e8eaf0' }}>
              <h2 className="text-[16px] font-semibold flex items-center gap-2 truncate" style={{ color: '#1e293b' }}>
                <span className="truncate">{drawer.template.name}</span>
                <StatusTag status={drawer.template.status} />
              </h2>
              {drawer.template.description && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: '#64748b' }}>{drawer.template.description}</p>
              )}
              <div className="flex items-center gap-2 mt-3">
                <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-[12.5px] font-semibold"
                  style={{ background: '#f1f5f9', color: drawer.template.status === 'active' ? '#1e293b' : '#94a3b8', fontFamily: '"SF Mono", "JetBrains Mono", Menlo, monospace', letterSpacing: '0.04em', textDecoration: drawer.template.status === 'active' ? 'none' : 'line-through' }}>
                  {drawer.template.code}
                  <button type="button" title="复制" className="flex hover:text-[#3e4b9c]" style={{ color: '#94a3b8' }} onClick={() => copyCode(drawer.template.code)}>
                    <Copy size={12} />
                  </button>
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* 属性 */}
              <div className="mb-5">
                <div style={FIELD_LABEL} className="mb-2.5">属性</div>
                {[
                  ['使用次数', `${drawer.template.usedCount} / ${drawer.template.maxUses ?? '不限'}`],
                  ['过期时间', drawer.template.expiresAt ? fmtDate(drawer.template.expiresAt) : '不过期'],
                  ['创建人', drawer.template.createdByName || '—'],
                  ['创建于', fmtDate(drawer.template.createdAt)],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center min-h-[28px] gap-2">
                    <span className="text-[12px] shrink-0" style={{ color: '#94a3b8', width: 84 }}>{k}</span>
                    <span className="text-[12.5px]" style={{ color: '#475569' }}>{v}</span>
                  </div>
                ))}
                <div className="flex items-center min-h-[28px] gap-2">
                  <span className="text-[12px] shrink-0" style={{ color: '#94a3b8', width: 84 }}>凭证</span>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: '#b45309' }}>
                    <ShieldCheck size={13} />已加密存储 · AES-256-GCM
                  </span>
                </div>
              </div>

              {/* 配置摘要 */}
              <div className="mb-5">
                <div style={FIELD_LABEL} className="mb-2.5">配置摘要</div>
                <div className="grid grid-cols-2 gap-2">
                  {drawerChips.map((c, i) => (
                    <div key={i} className="rounded-md px-2.5 py-2 text-[11.5px] leading-snug"
                      style={c.warn ? { background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309' } : { background: '#f8fafc', border: '1px solid #f1f5f9', color: '#475569' }}>
                      {c.text}
                    </div>
                  ))}
                </div>
              </div>

              {/* 导入记录 */}
              <div>
                <div style={FIELD_LABEL} className="mb-2.5">导入记录 · {drawer.template.usedCount || 0} 次</div>
                {drawer.usesLoading ? (
                  <div className="flex items-center gap-2 py-4 text-[12.5px]" style={{ color: '#94a3b8' }}>
                    <Loader2 size={14} className="animate-spin" />加载中…
                  </div>
                ) : drawer.uses.length === 0 ? (
                  <div className="py-8 text-center text-[12.5px]" style={{ color: '#94a3b8' }}>
                    <Users size={26} style={{ color: '#cbd5e1' }} className="mx-auto mb-2" />还没有成员导入此配置
                  </div>
                ) : (
                  <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid #e8eaf0' }}>
                    {drawer.uses.map((u) => (
                      <div key={u.id} className="flex items-center gap-2.5 px-3.5 py-[9px]" style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                          style={{ background: avatarColor(u.userId) }}>
                          {(u.displayName || u.email || '?').slice(0, 1).toUpperCase()}
                        </span>
                        <span className="flex-1 min-w-0 text-[12.5px] truncate" style={{ color: '#475569' }}>{u.displayName || u.email || u.userId}</span>
                        <span className="text-[11.5px] shrink-0" style={{ color: '#94a3b8' }}>{fmtRelative(u.usedAt) || fmtDate(u.usedAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-3.5 flex flex-wrap gap-2" style={{ borderTop: '1px solid #e8eaf0' }}>
              <button type="button" disabled={busy} onClick={() => openEdit(drawer.template)}
                className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] transition-colors hover:bg-slate-50 disabled:opacity-60" style={SECONDARY_BTN}>
                <Pencil size={13} />编辑元数据
              </button>
              {drawer.template.status === 'active' && (
                <button type="button" disabled={busy} onClick={() => setRotateTarget(drawer.template)}
                  className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] transition-colors hover:bg-slate-50 disabled:opacity-60" style={SECONDARY_BTN}>
                  <RotateCw size={13} />刷新配置码
                </button>
              )}
              {drawer.template.status === 'active' ? (
                <button type="button" disabled={busy} onClick={() => setDisableTarget(drawer.template)}
                  className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] font-medium transition-colors hover:bg-red-50 disabled:opacity-60"
                  style={{ background: '#fff', border: '1px solid #fecaca', color: '#b91c1c' }}>
                  <Ban size={13} />停用
                </button>
              ) : drawer.template.status === 'disabled' ? (
                <button type="button" disabled={busy} onClick={() => handleEnable(drawer.template)}
                  className="flex items-center gap-1.5 px-3 py-[7px] rounded-[7px] text-[12.5px] font-medium text-white transition-colors disabled:opacity-60"
                  style={{ background: '#2d7a5f' }}>
                  <Power size={13} />重新启用
                </button>
              ) : null}
            </div>
          </aside>
        </>
      )}

      {/* ── 弹窗:创建模板 ── */}
      <Modal open={createOpen} width={460} onClose={() => setCreateOpen(false)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold flex items-center gap-2" style={{ color: '#1e293b' }}>
            <KeyRound size={15} style={{ color: ACCENT }} />从本机配置创建模板
          </h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>将你当前电脑的 AI Provider、模型路由与搜索 API 打包为企业模板。</p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <div className="mb-3.5">
            <span style={FIELD_LABEL} className="block mb-[7px]">模板名称</span>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例如 公司统一 AI 配置" className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: '#1e293b' }} />
          </div>
          <div className="flex gap-2.5 mb-3.5">
            <div className="flex-1">
              <span style={FIELD_LABEL} className="block mb-[7px]">最大使用次数</span>
              <input value={form.maxUses} onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value.replace(/[^0-9]/g, '') }))}
                placeholder="留空不限" className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: '#1e293b' }} />
            </div>
            <div className="flex-1">
              <span style={FIELD_LABEL} className="block mb-[7px]">过期时间</span>
              <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: '#1e293b' }} />
            </div>
          </div>
          <div className="mb-3.5">
            <span style={FIELD_LABEL} className="block mb-[7px]">描述(给成员看)</span>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="可选" className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: '#1e293b' }} />
          </div>
          <WarnBox>
            本机当前包含 <b>{localSummary?.providerCount ?? '…'} 个 Provider</b>
            {localSummary?.keyCount ? <>(其中 {localSummary.keyCount} 个含 API Key)</> : null}
            {localSummary?.hasSearchKey ? ' 与搜索 API Key' : ''}。这些敏感凭证将随模板<b>加密存储于服务器</b>,凭配置码导入的成员会在其本地获得完整凭证。请仅发给受信任成员。
          </WarnBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setCreateOpen(false)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy} onClick={handleCreate}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60" style={{ background: ACCENT }}>
            {busy ? '创建中…' : '创建并生成配置码'}
          </button>
        </div>
      </Modal>

      {/* ── 弹窗:编辑元数据 ── */}
      <Modal open={Boolean(editTarget)} width={460} onClose={() => setEditTarget(null)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>编辑模板元数据</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>仅可修改名称、描述、次数与过期时间;配置内容本身不可更改。</p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <div className="mb-3.5">
            <span style={FIELD_LABEL} className="block mb-[7px]">模板名称</span>
            <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: '#1e293b' }} />
          </div>
          <div className="flex gap-2.5 mb-3.5">
            <div className="flex-1">
              <span style={FIELD_LABEL} className="block mb-[7px]">最大使用次数</span>
              <input value={editForm.maxUses} onChange={(e) => setEditForm((f) => ({ ...f, maxUses: e.target.value.replace(/[^0-9]/g, '') }))}
                placeholder="留空不限" className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: '#1e293b' }} />
            </div>
            <div className="flex-1">
              <span style={FIELD_LABEL} className="block mb-[7px]">过期时间</span>
              <input type="datetime-local" value={editForm.expiresAt} onChange={(e) => setEditForm((f) => ({ ...f, expiresAt: e.target.value }))}
                className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: '#1e293b' }} />
            </div>
          </div>
          <div className="mb-1">
            <span style={FIELD_LABEL} className="block mb-[7px]">描述</span>
            <input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-[7px] px-2.5 py-[7px] text-[13px] outline-none" style={{ border: `1px solid ${BORDER}`, color: '#1e293b' }} />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setEditTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy} onClick={handleEdit}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60" style={{ background: ACCENT }}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </Modal>

      {/* ── 弹窗:刷新配置码 ── */}
      <Modal open={Boolean(rotateTarget)} width={400} onClose={() => setRotateTarget(null)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>刷新「{rotateTarget?.name}」的配置码?</h3>
        </div>
        <div className="px-5 pt-4 pb-1">
          <WarnBox>刷新后旧配置码<b>立即失效</b>,需要重新分发新码。已导入的成员本地配置不受影响。</WarnBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setRotateTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy} onClick={handleRotate}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60" style={{ background: ACCENT }}>
            {busy ? '处理中…' : '确认刷新'}
          </button>
        </div>
      </Modal>

      {/* ── 弹窗:停用模板 ── */}
      <Modal open={Boolean(disableTarget)} width={400} onClose={() => setDisableTarget(null)}>
        <div className="px-5 pt-[18px]">
          <h3 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>停用「{disableTarget?.name}」?</h3>
          <p className="text-[12.5px] mt-0.5" style={{ color: '#64748b' }}>已用 {disableTarget?.usedCount} / {disableTarget?.maxUses ?? '不限'} 次</p>
        </div>
        <div className="px-5 pt-4 pb-1">
          <WarnBox>停用后该配置码<b>立即失效</b>,无法再预览或导入。已导入的成员本地配置不受影响,可随时重新启用。</WarnBox>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 mt-2">
          <button type="button" onClick={() => setDisableTarget(null)}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] transition-colors hover:bg-slate-50" style={SECONDARY_BTN}>取消</button>
          <button type="button" disabled={busy} onClick={handleDisable}
            className="px-3.5 py-[7px] rounded-[7px] text-[13px] font-medium text-white transition-colors disabled:opacity-60" style={{ background: '#b91c1c' }}>
            {busy ? '处理中…' : '确认停用'}
          </button>
        </div>
      </Modal>
    </>
  );
};

export default EnterpriseConfigView;

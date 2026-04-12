import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ArrowLeft, Plus, Search, X, ChevronDown,
  FileText, StickyNote, Image, Globe, Check,
  MoreHorizontal, Star, Pencil, Trash2,
  Grid3X3, Circle, Minus, Palette, HelpCircle,
  Layers, ArrowRightLeft, Undo2, Redo2, Group,
  Pin, PinOff, Eye, EyeOff, Clock,
} from 'lucide-react';
import BoardCanvas from './BoardCanvas.jsx';
import CardReaderModal from './CardReaderModal.jsx';
import ViewerToolbar from './ViewerToolbar.jsx';


function CollectModal({ isOpen, onClose, boardId, existingCountMap, onAdd }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    window.ipm.knowledge.listGlobal({ type: typeFilter || undefined, search: search || undefined })
      .then((res) => { if (res?.ok) setItems(res.items || []); })
      .finally(() => setLoading(false));
  }, [isOpen, typeFilter, search]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div
        style={{
          background: 'white', borderRadius: 16, width: 520, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
        className="animate-fadeIn"
      >
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1F2937' }}>收集知识碎片到看板</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '12px 24px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            background: '#F9FAFB', borderRadius: 10, padding: '8px 12px',
          }}>
            <Search size={14} color="#9CA3AF" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索碎片..."
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, color: '#374151',
              }}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{
              border: '1px solid #E5E7EB', borderRadius: 8, padding: '7px 8px',
              fontSize: 12, color: '#6B7280', background: 'white', cursor: 'pointer',
            }}
          >
            <option value="">全部类型</option>
            <option value="snippet">文本</option>
            <option value="note">笔记</option>
            <option value="screenshot">截图</option>
            <option value="webclip">网页</option>
          </select>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}>
          {loading && <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', padding: 24 }}>加载中...</p>}
          {!loading && items.length === 0 && (
            <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', padding: 24 }}>暂无碎片</p>
          )}
          {!loading && items.map((it) => {
            const count = existingCountMap?.[it.id] || 0;
            return (
              <div
                key={it.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
                  borderBottom: '1px solid #F3F4F6', cursor: 'pointer',
                  opacity: count > 0 ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = count > 0 ? '0.6' : '1'; }}
                onClick={() => {
                  onAdd({
                    knowledgeId: it.id,
                    sourceProject: it._projectName || '',
                    sourceDomain: it._domain || 'projects',
                  });
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: it.type === 'snippet' ? '#FFFBE0' : it.type === 'note' ? '#F0FDF4' : it.type === 'screenshot' ? '#FFF1F2' : '#FFFDF2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {it.type === 'snippet' && <FileText size={14} color="#D97706" />}
                  {it.type === 'note' && <StickyNote size={14} color="#16A34A" />}
                  {it.type === 'screenshot' && <Image size={14} color="#E11D48" />}
                  {it.type === 'webclip' && <Globe size={14} color="#4a9e8e" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.title || it.content_text?.slice(0, 50) || '无标题'}
                  </p>
                  <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                    {it._projectName || '未知项目'} · {it.type}
                  </p>
                </div>
                {count > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 10, color: '#4a9e8e', background: 'rgba(74,158,142,0.08)',
                      padding: '2px 6px', borderRadius: 6, whiteSpace: 'nowrap',
                    }}>
                      已有 {count} 个
                    </span>
                    <Plus size={14} color="#9CA3AF" />
                  </div>
                ) : (
                  <Plus size={16} color="#4a9e8e" style={{ flexShrink: 0 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CreateMenu({ isOpen, onClose, onSelect, onCreateBoard, onCreateEmptyGroup, onCreateTimeline, isMainBoard }) {
  if (!isOpen) return null;
  const knowledgeOpts = [
    { key: 'snippet', label: '文本碎片', icon: FileText, color: '#D97706' },
    { key: 'note', label: '笔记', icon: StickyNote, color: '#16A34A' },
    { key: 'webclip', label: '网页摘录', icon: Globe, color: '#4a9e8e' },
  ];
  const menuBtn = (onClick, icon, label, color) => (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '8px 12px', border: 'none', background: 'none',
        cursor: 'pointer', borderRadius: 8, fontSize: 13, color: '#374151',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
    >
      {React.createElement(icon, { size: 15, color })}
      {label}
    </button>
  );
  return (
    <div
      style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 6,
        background: 'white', borderRadius: 12, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
        border: '1px solid #F3F4F6', padding: 6, zIndex: 100, minWidth: 170,
      }}
      className="animate-fadeIn"
    >
      {knowledgeOpts.map((opt) => (
        <React.Fragment key={opt.key}>
          {menuBtn(() => { onSelect(opt.key); onClose(); }, opt.icon, opt.label, opt.color)}
        </React.Fragment>
      ))}
      <div style={{ borderTop: '1px solid #F3F4F6', margin: '4px 6px' }} />
      {menuBtn(() => { onCreateBoard?.(); onClose(); }, Star, '新建看板', '#D97706')}
      {isMainBoard && menuBtn(() => { onCreateEmptyGroup?.(); onClose(); }, Group, '新建空分组', '#4a9e8e')}
      {isMainBoard && (
        <>
          <div style={{ borderTop: '1px solid #F3F4F6', margin: '4px 6px' }} />
          {menuBtn(() => { onCreateTimeline?.('vertical'); onClose(); }, Clock, '竖向时间线', '#6366F1')}
          {menuBtn(() => { onCreateTimeline?.('horizontal'); onClose(); }, Clock, '横向时间线', '#6366F1')}
        </>
      )}
    </div>
  );
}

function BoardSwitcher({ boards, currentBoardId, onSwitch }) {
  const [open, setOpen] = useState(false);
  const current = boards.find((b) => b.id === currentBoardId);
  if (boards.length <= 1) {
    return <span style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'Inter, system-ui, sans-serif', letterSpacing: '0.1em' }}>{current?.name || '看板'}</span>;
  }
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
          cursor: 'pointer', fontSize: 10, color: '#9CA3AF', fontFamily: 'Inter, system-ui, sans-serif',
          letterSpacing: '0.1em',
        }}
      >
        {current?.name || '看板'}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
            marginBottom: 8, background: 'white', borderRadius: 10,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', border: '1px solid #F3F4F6',
            padding: 6, zIndex: 100, minWidth: 160,
          }}
          className="animate-fadeIn"
        >
          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => { onSwitch(b.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '7px 12px', border: 'none',
                background: b.id === currentBoardId ? '#F9FAFB' : 'none',
                cursor: 'pointer', borderRadius: 6, fontSize: 12, color: '#374151',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {b.is_main ? <Star size={11} color="#D97706" fill="#D97706" /> : null}
                {b.name}
              </span>
              {b.id === currentBoardId && <Check size={13} color="#4a9e8e" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickCreateModal({ isOpen, type, onClose, onSubmit }) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setText('');
      setTitle('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, type]);

  if (!isOpen) return null;

  const typeLabels = { snippet: '文本碎片', note: '笔记', webclip: '网页摘录' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div
        style={{
          background: 'white', borderRadius: 16, width: 440, padding: 24,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
        className="animate-fadeIn"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1F2937' }}>新建{typeLabels[type] || '碎片'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
            <X size={18} />
          </button>
        </div>

        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（可选）"
          style={{
            width: '100%', border: '1px solid #E5E7EB', borderRadius: 10,
            padding: '10px 14px', fontSize: 13, marginBottom: 10, outline: 'none',
          }}
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={type === 'webclip' ? '输入 URL 或粘贴网页内容...' : '输入内容...'}
          style={{
            width: '100%', border: '1px solid #E5E7EB', borderRadius: 10,
            padding: '10px 14px', fontSize: 13, minHeight: 120, resize: 'vertical', outline: 'none',
            fontFamily: 'inherit', lineHeight: 1.6,
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid #E5E7EB',
              background: 'white', fontSize: 13, cursor: 'pointer', color: '#6B7280',
            }}
          >
            取消
          </button>
          <button
            onClick={() => { onSubmit({ type, title: title || text.slice(0, 40), content_text: text }); onClose(); }}
            disabled={!text.trim()}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: text.trim() ? '#4a9e8e' : '#E5E7EB',
              color: text.trim() ? 'white' : '#9CA3AF',
              fontSize: 13, cursor: text.trim() ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}
          >
            添加到看板
          </button>
        </div>
      </div>
    </div>
  );
}

const HELP_SECTIONS = [
  {
    title: '画布操作',
    items: [
      { key: '拖拽卡片', desc: '直接拖拽卡片移动位置' },
      { key: '旋转卡片', desc: '选中后拖拽底部 ↻ 手柄' },
      { key: '缩放卡片', desc: '选中后拖拽四角 ⤢ 手柄' },
      { key: '画布平移', desc: '空格 + 拖拽 / 鼠标中键拖拽（仅主看板）' },
      { key: '画布缩放', desc: '滚轮滚动（仅主看板）' },
    ],
  },
  {
    title: '选择与多选',
    items: [
      { key: '单选', desc: '点击卡片' },
      { key: '多选', desc: 'Shift + 点击 追加选择' },
      { key: '框选', desc: '在空白区域拖拽框选' },
      { key: '全选', desc: '⌘A' },
      { key: '取消选择', desc: 'Esc / 点击空白区域' },
    ],
  },
  {
    title: '卡片操作',
    items: [
      { key: '编辑碎片', desc: '选中后点击左侧 ↗ 图标跳转编辑' },
      { key: '删除卡片', desc: '选中后点击右上角 × / Delete 键' },
      { key: '锁定/解锁', desc: '⌘L（仅自由卡片，组内卡片跟随组锁定）' },
    ],
  },
  {
    title: '连线',
    items: [
      { key: '卡片连线', desc: '选中两个元素 → 工具栏「连线」' },
      { key: '组连线', desc: 'Shift+点击组框选中组，组合卡片/组可连' },
      { key: '取消连线', desc: '点击连线 → 删除图标 / 选中两端「取消连线」' },
    ],
  },
  {
    title: '分组操作',
    items: [
      { key: '新建分组', desc: '右上角「新建」→ 新建空分组' },
      { key: '移动分组', desc: '拖拽分组标题栏或空白区域' },
      { key: '缩放分组', desc: '拖拽右下角手柄' },
      { key: '重命名', desc: '双击分组名称 / 标题栏铅笔图标' },
      { key: '切换风格', desc: '标题栏调色板图标（默认/黑板/白板/Mac窗口）' },
      { key: '拖入/拖出', desc: '将卡片拖入分组区域自动归入' },
      { key: '锁定分组', desc: '分组标题栏 → 锁图标（锁定后组内全部不可操作）' },
      { key: '转为看板', desc: '分组标题栏 → ⇆ 图标' },
    ],
  },
  {
    title: '时间线',
    items: [
      { key: '新建时间线', desc: '右上角「新建」→ 竖向/横向时间线' },
      { key: '移动时间线', desc: '拖拽标题栏移动位置' },
      { key: '拉伸时间线', desc: '拖拽底部（竖向）/ 右侧（横向）手柄' },
      { key: '添加时间点', desc: '双击时间线空白区域' },
      { key: '编辑标签', desc: '单击时间点标签文字' },
      { key: '移动时间点', desc: '拖拽时间点圆点沿轴方向移动' },
      { key: '删除时间点', desc: 'hover 时间点 → 点击删除图标' },
      { key: '重命名', desc: '双击标题栏名称' },
    ],
  },
  {
    title: '看板管理',
    items: [
      { key: '切换看板', desc: '底部看板名称切换' },
      { key: '新建看板', desc: '右上角「新建」→ 新建看板' },
      { key: '重命名/删除', desc: '看板名称旁 ··· 菜单' },
      { key: '画布背景', desc: '右上角调色板图标' },
      { key: '收集碎片', desc: '右上角「收集」按钮添加已有碎片' },
      { key: '撤回/重做', desc: '⌘Z / ⇧⌘Z' },
    ],
  },
];

function HelpTooltip({ onCreateGuideNote }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const visible = pinned || hovered;
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={() => setPinned((p) => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
          borderRadius: 9999, background: pinned ? 'rgba(74,158,142,0.08)' : 'none',
          border: pinned ? '1px solid rgba(74,158,142,0.2)' : '1px solid transparent',
          cursor: 'pointer', color: pinned ? '#4a9e8e' : '#9CA3AF',
          transition: 'all 0.25s ease',
        }}
      >
        <HelpCircle size={14} style={{ transition: 'transform 0.25s', transform: pinned ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      {visible && (
        <div
          className="animate-fadeIn"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6,
            background: 'white', borderRadius: 14,
            boxShadow: '0 16px 40px -8px rgba(0,0,0,0.14)',
            border: '1px solid #F3F4F6', padding: '16px 20px',
            zIndex: 200, width: 340, maxHeight: '70vh', overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1F2937' }}>
              Knowledge Thread Board 使用指南
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {onCreateGuideNote && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCreateGuideNote(); }}
                  title="创建使用指南笔记到看板"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: 6,
                    background: 'rgba(74,158,142,0.08)', border: '1px solid rgba(74,158,142,0.2)',
                    cursor: 'pointer', padding: 0, transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(74,158,142,0.15)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(74,158,142,0.08)'; }}
                >
                  <Plus size={12} color="#4a9e8e" />
                </button>
              )}
              <button
                onClick={() => setPinned((p) => !p)}
                title={pinned ? '取消固定' : '固定面板'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: 6,
                  background: pinned ? 'rgba(74,158,142,0.1)' : 'rgba(0,0,0,0.03)',
                  border: '1px solid transparent', cursor: 'pointer', padding: 0,
                  transition: 'background 0.15s',
                }}
              >
                {pinned ? <PinOff size={11} color="#4a9e8e" /> : <Pin size={11} color="#9CA3AF" />}
              </button>
            </div>
          </div>
          {HELP_SECTIONS.map((sec) => (
            <div key={sec.title} style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 10, fontWeight: 600, color: '#4a9e8e',
                letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6,
              }}>
                {sec.title}
              </div>
              {sec.items.map((item) => (
                <div key={item.key} style={{ display: 'flex', gap: 8, marginBottom: 4, lineHeight: 1.5 }}>
                  <span style={{ fontSize: 11, color: '#374151', fontWeight: 500, whiteSpace: 'nowrap', minWidth: 80 }}>
                    {item.key}
                  </span>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{item.desc}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ fontSize: 9, color: '#D1D5DB', textAlign: 'center', marginTop: 8, letterSpacing: '0.1em' }}>
            主看板支持无限画布 · 小地图位于右下角
          </div>
        </div>
      )}
    </div>
  );
}

const BG_OPTIONS = [
  { key: 'grid', label: '方格线', icon: Grid3X3 },
  { key: 'dots', label: '点阵', icon: Circle },
  { key: 'blank', label: '纯净', icon: Minus },
  { key: 'color', label: '自定义颜色', icon: Palette },
];

const PRESET_COLORS = ['#F9F8F4', '#FFF8E1', '#F3E5F5', '#E3F2FD', '#E8F5E9', '#FCE4EC', '#EFEBE9', '#ECEFF1'];

function BgMenu({ isOpen, currentStyle, currentColor, onSelect, onClose }) {
  if (!isOpen) return null;
  return (
    <div
      style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 6,
        background: 'white', borderRadius: 12, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
        border: '1px solid #F3F4F6', padding: 8, zIndex: 100, minWidth: 180,
      }}
      className="animate-fadeIn"
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 10, color: '#9CA3AF', padding: '4px 8px', letterSpacing: '0.1em' }}>画布背景</div>
      {BG_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => { onSelect(opt.key, opt.key === 'color' ? (currentColor || '#F9F8F4') : ''); if (opt.key !== 'color') onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '7px 10px', border: 'none',
            background: currentStyle === opt.key ? '#F3F4F6' : 'none',
            cursor: 'pointer', borderRadius: 6, fontSize: 12, color: '#374151',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = currentStyle === opt.key ? '#F3F4F6' : 'none'; }}
        >
          <opt.icon size={13} />
          {opt.label}
          {currentStyle === opt.key && <Check size={12} color="#4a9e8e" style={{ marginLeft: 'auto' }} />}
        </button>
      ))}
      {currentStyle === 'color' && (
        <div style={{ padding: '8px 10px 4px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESET_COLORS.map((c) => (
            <div
              key={c}
              onClick={() => { onSelect('color', c); onClose(); }}
              style={{
                width: 20, height: 20, borderRadius: 6, background: c, cursor: 'pointer',
                border: currentColor === c ? '2px solid #4a9e8e' : '1px solid #E5E7EB',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Group Navigator Dropdown (main board only) ---
function GroupNavigator({ groups, onNavigate }) {
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return null;
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', borderRadius: 8, background: 'none',
          border: '1px solid #E5E7EB', cursor: 'pointer',
          fontSize: 11, color: '#6B7280', fontFamily: 'Inter, system-ui, sans-serif',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
      >
        <Layers size={12} />
        分组
        <ChevronDown size={10} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6,
            background: 'white', borderRadius: 10,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', border: '1px solid #F3F4F6',
            padding: 4, zIndex: 100, minWidth: 160, maxHeight: 240, overflowY: 'auto',
          }}
          className="animate-fadeIn"
        >
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => { onNavigate(g); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 12px', border: 'none', background: 'none',
                cursor: 'pointer', borderRadius: 6, fontSize: 12, color: '#374151',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <div style={{
                width: 8, height: 8, borderRadius: 2,
                background: g.color || 'rgba(74,158,142,0.3)',
                flexShrink: 0,
              }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.name || '未命名分组'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Confirmation Dialog (reusable) ---
function ConfirmDialog({ title, description, matchText, isOpen, onClose, onConfirm }) {
  const [input, setInput] = useState('');
  useEffect(() => { if (isOpen) setInput(''); }, [isOpen]);
  if (!isOpen) return null;
  const matches = input === matchText;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div
        style={{
          background: 'white', borderRadius: 16, width: 420, padding: 24,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
        className="animate-fadeIn"
      >
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1F2937', marginBottom: 12 }}>{title}</h3>
        <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.7, marginBottom: 16 }}>{description}</p>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 8 }}>
          请输入名称 <span style={{ color: '#EF4444', fontWeight: 600 }}>{matchText}</span> 以确认：
        </p>
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && matches) { onConfirm(); onClose(); } if (e.key === 'Escape') onClose(); }}
          placeholder={matchText}
          style={{
            width: '100%', border: '1px solid #E5E7EB', borderRadius: 10,
            padding: '10px 14px', fontSize: 13, outline: 'none', marginBottom: 16,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid #E5E7EB',
              background: 'white', fontSize: 13, cursor: 'pointer', color: '#6B7280',
            }}
          >
            取消
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            disabled={!matches}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: matches ? '#EF4444' : '#F3F4F6',
              color: matches ? 'white' : '#D1D5DB',
              fontSize: 13, cursor: matches ? 'pointer' : 'default',
              fontWeight: 500, transition: 'background 0.15s, color 0.15s',
            }}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

const SHAPE_LOADER_STYLE = `
.wabi-shape-loader{--path:#5E8A82;--dot:#4a9e8e;--duration:3s;width:44px;height:44px;position:relative;display:inline-block;margin:0 16px}
.wabi-shape-loader:before{content:"";width:6px;height:6px;border-radius:50%;position:absolute;display:block;background:var(--dot);top:37px;left:19px;transform:translate(-18px,-18px);animation:wabi-dotRect var(--duration) cubic-bezier(.785,.135,.15,.86) infinite}
.wabi-shape-loader svg{display:block;width:100%;height:100%}
.wabi-shape-loader svg rect,.wabi-shape-loader svg polygon,.wabi-shape-loader svg circle{fill:none;stroke:var(--path);stroke-width:10px;stroke-linejoin:round;stroke-linecap:round}
.wabi-shape-loader svg polygon{stroke-dasharray:145 76 145 76;stroke-dashoffset:0;animation:wabi-pathTriangle var(--duration) cubic-bezier(.785,.135,.15,.86) infinite}
.wabi-shape-loader svg rect{stroke-dasharray:192 64 192 64;stroke-dashoffset:0;animation:wabi-pathRect 3s cubic-bezier(.785,.135,.15,.86) infinite}
.wabi-shape-loader svg circle{stroke-dasharray:150 50 150 50;stroke-dashoffset:75;animation:wabi-pathCircle var(--duration) cubic-bezier(.785,.135,.15,.86) infinite}
.wabi-shape-loader.wabi-triangle{width:48px}
.wabi-shape-loader.wabi-triangle:before{left:21px;transform:translate(-10px,-18px);animation:wabi-dotTriangle var(--duration) cubic-bezier(.785,.135,.15,.86) infinite}
@keyframes wabi-pathTriangle{33%{stroke-dashoffset:74}66%{stroke-dashoffset:147}100%{stroke-dashoffset:221}}
@keyframes wabi-dotTriangle{33%{transform:translate(0,0)}66%{transform:translate(10px,-18px)}100%{transform:translate(-10px,-18px)}}
@keyframes wabi-pathRect{25%{stroke-dashoffset:64}50%{stroke-dashoffset:128}75%{stroke-dashoffset:192}100%{stroke-dashoffset:256}}
@keyframes wabi-dotRect{25%{transform:translate(0,0)}50%{transform:translate(18px,-18px)}75%{transform:translate(0,-36px)}100%{transform:translate(-18px,-18px)}}
@keyframes wabi-pathCircle{25%{stroke-dashoffset:125}50%{stroke-dashoffset:175}75%{stroke-dashoffset:225}100%{stroke-dashoffset:275}}
`;

function ShapeLoader() {
  useEffect(() => {
    if (document.getElementById('wabi-shape-loader-style')) return;
    const s = document.createElement('style');
    s.id = 'wabi-shape-loader-style';
    s.textContent = SHAPE_LOADER_STYLE;
    document.head.appendChild(s);
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="wabi-shape-loader">
        <svg viewBox="0 0 80 80"><circle r="32" cy="40" cx="40" /></svg>
      </div>
      <div className="wabi-shape-loader wabi-triangle">
        <svg viewBox="0 0 86 80"><polygon points="43 8 79 72 7 72" /></svg>
      </div>
      <div className="wabi-shape-loader">
        <svg viewBox="0 0 80 80"><rect height="64" width="64" y="8" x="8" /></svg>
      </div>
    </div>
  );
}

export default function WabiBoardPage({ onBack }) {
  const [boards, setBoards] = useState([]);
  const [currentBoardId, setCurrentBoardId] = useState(null);
  const [boardItems, setBoardItems] = useState([]);
  const [connections, setConnections] = useState([]);
  const [groups, setGroups] = useState([]);
  const [timelines, setTimelines] = useState([]);
  const [collectOpen, setCollectOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [quickCreateType, setQuickCreateType] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [bgMenuOpen, setBgMenuOpen] = useState(false);
  const [activeBgStyle, setActiveBgStyle] = useState('grid');
  const [activeBgColor, setActiveBgColor] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [viewerMode, setViewerMode] = useState(false);
  const [viewerReaderItem, setViewerReaderItem] = useState(null);
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  const renameRef = useRef(null);
  const canvasRef = useRef(null);

  // Delete confirmation states
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null); // { type: 'board'|'group', id, name }

  // Convert group → board confirmation
  const [convertGroupConfirm, setConvertGroupConfirm] = useState(null); // { groupId, groupName }

  // Toast notification
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Undo/Redo
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const UNDO_LIMIT = 50;

  const pushUndoAction = useCallback((action) => {
    undoStackRef.current.push(action);
    if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }, []);

  const undoRedoRef = useRef({
    undo: async () => {
      const action = undoStackRef.current.pop();
      if (!action) return;
      await action.undo();
      redoStackRef.current.push(action);
      setUndoCount(undoStackRef.current.length);
      setRedoCount(redoStackRef.current.length);
    },
    redo: async () => {
      const action = redoStackRef.current.pop();
      if (!action) return;
      await action.redo();
      undoStackRef.current.push(action);
      setUndoCount(undoStackRef.current.length);
      setRedoCount(redoStackRef.current.length);
    },
  });

  const loadBoards = useCallback(async () => {
    const res = await window.ipm.board.list();
    if (!res?.ok) return;
    let list = res.boards || [];

    if (list.length === 0) {
      const createRes = await window.ipm.board.create('主看板');
      if (createRes?.ok && createRes.board) {
        list = [createRes.board];
      }
    }

    setBoards(list);
    if (!currentBoardId || !list.find((b) => b.id === currentBoardId)) {
      const main = list.find((b) => b.is_main) || list[0];
      if (main) setCurrentBoardId(main.id);
    }
  }, [currentBoardId]);

  const loadItems = useCallback(async (boardId) => {
    if (!boardId) return;
    const res = await window.ipm.board.getItems(boardId);
    if (res?.ok) setBoardItems(res.items || []);
  }, []);

  const loadConnections = useCallback(async (boardId) => {
    if (!boardId) return;
    const res = await window.ipm.board.listConnections(boardId);
    if (res?.ok) setConnections(res.connections || []);
  }, []);

  const loadGroups = useCallback(async (boardId) => {
    if (!boardId) return;
    const res = await window.ipm.board.listGroups(boardId);
    if (res?.ok) setGroups(res.groups || []);
  }, []);

  const loadTimelines = useCallback(async (boardId) => {
    if (!boardId) return;
    const list = await window.ipm.board.listTimelines(boardId);
    setTimelines(Array.isArray(list) ? list : []);
  }, []);

  useEffect(() => { loadBoards(); }, []);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashFading(true), 800);
    const removeTimer = setTimeout(() => setSplashVisible(false), 1200);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, []);

  useEffect(() => {
    if (currentBoardId) {
      loadItems(currentBoardId);
      loadConnections(currentBoardId);
      loadGroups(currentBoardId);
      loadTimelines(currentBoardId);
      const board = boards.find((b) => b.id === currentBoardId);
      if (board) {
        setActiveBgStyle(board.bg_style || 'grid');
        setActiveBgColor(board.bg_color || '');
      }
      // Clear undo/redo on board switch
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoCount(0);
      setRedoCount(0);
    }
  }, [currentBoardId, loadItems, loadConnections, loadGroups, loadTimelines, boards]);

  const handleLayoutChange = useCallback(async (items) => {
    if (!currentBoardId) return;
    setSaveStatus('saving');
    await window.ipm.board.updateLayout(currentBoardId, items);
    setSaveStatus('saved');
  }, [currentBoardId]);

  const handleRemoveItem = useCallback(async (itemId) => {
    const removedItem = boardItems.find((it) => it.id === itemId);
    await window.ipm.board.removeItem(itemId);
    setBoardItems((prev) => prev.filter((it) => it.id !== itemId));
    loadConnections(currentBoardId);

    if (removedItem) {
      pushUndoAction({
        type: 'remove-item',
        undo: async () => {
          await window.ipm.board.addItem({
            boardId: currentBoardId,
            knowledgeId: removedItem.knowledge_id,
            sourceProject: removedItem.source_project,
            sourceDomain: removedItem.source_domain,
            x: removedItem.x, y: removedItem.y,
            rotation: removedItem.rotation,
            width: removedItem.width, height: removedItem.height,
          });
          loadItems(currentBoardId);
          loadConnections(currentBoardId);
        },
        redo: async () => {
          await window.ipm.board.removeItem(itemId);
          loadItems(currentBoardId);
          loadConnections(currentBoardId);
        },
      });
    }
  }, [currentBoardId, boardItems, loadConnections, loadItems, pushUndoAction]);

  const ensureBoardId = useCallback(async () => {
    if (currentBoardId) return currentBoardId;
    const createRes = await window.ipm.board.create('主看板');
    if (createRes?.ok && createRes.board) {
      setCurrentBoardId(createRes.board.id);
      setBoards((prev) => [...prev, createRes.board]);
      return createRes.board.id;
    }
    return null;
  }, [currentBoardId]);

  const handleAddItem = useCallback(async ({ knowledgeId, sourceProject, sourceDomain }) => {
    const boardId = await ensureBoardId();
    if (!boardId) return;
    const x = 100 + Math.random() * 400;
    const y = 100 + Math.random() * 300;
    const rotation = Math.random() * 6 - 3;
    await window.ipm.board.addItem({ boardId, knowledgeId, sourceProject, sourceDomain, x, y, rotation });
    loadItems(boardId);
  }, [ensureBoardId, loadItems]);

  const handleCreateAndAdd = useCallback(async ({ type, title, content_text }) => {
    const boardId = await ensureBoardId();
    if (!boardId) return;
    await window.ipm.board.createAndAdd({ boardId, type, title, content_text });
    loadItems(boardId);
  }, [ensureBoardId, loadItems]);

  const handleCreateBoard = useCallback(async () => {
    const nonMainCount = boards.filter((b) => !b.is_main).length;
    const res = await window.ipm.board.create(`看板 ${nonMainCount + 1}`);
    if (res?.ok) {
      await loadBoards();
      setCurrentBoardId(res.board.id);
    }
  }, [boards, loadBoards]);

  const handleRenameBoard = useCallback(async () => {
    if (!currentBoardId || !renameValue.trim()) return;
    await window.ipm.board.rename(currentBoardId, renameValue.trim());
    setRenaming(false);
    loadBoards();
  }, [currentBoardId, renameValue, loadBoards]);

  const handleDeleteBoard = useCallback(async () => {
    if (!currentBoardId) return;
    const current = boards.find((b) => b.id === currentBoardId);
    if (current?.is_main) return;
    await window.ipm.board.delete(currentBoardId);
    setCurrentBoardId(null);
    loadBoards();
  }, [currentBoardId, boards, loadBoards]);

  // Connections
  const handleAddConnection = useCallback(async (fromItemId, toItemId) => {
    if (!currentBoardId) return;
    const hasGroup = fromItemId?.startsWith('grp-') || toItemId?.startsWith('grp-');
    const color = hasGroup ? '#4a9e8e' : '#e8a0a0';
    await window.ipm.board.addConnection({ boardId: currentBoardId, fromItemId, toItemId, color });
    loadConnections(currentBoardId);
  }, [currentBoardId, loadConnections]);

  const handleRemoveConnection = useCallback(async (id) => {
    await window.ipm.board.removeConnection(id);
    loadConnections(currentBoardId);
  }, [currentBoardId, loadConnections]);

  // Groups - returns the created group for BoardCanvas to use
  const handleCreateGroup = useCallback(async ({ x, y, width, height }) => {
    if (!currentBoardId) return null;
    const res = await window.ipm.board.createGroup({ boardId: currentBoardId, name: '', x, y, width, height });
    await loadGroups(currentBoardId);
    return res?.group || null;
  }, [currentBoardId, loadGroups]);

  const handleUpdateGroup = useCallback(async (id, patch) => {
    await window.ipm.board.updateGroup(id, patch);
    loadGroups(currentBoardId);
  }, [currentBoardId, loadGroups]);

  const handleDeleteGroup = useCallback(async (id) => {
    await window.ipm.board.deleteGroup(id);
    loadGroups(currentBoardId);
    loadItems(currentBoardId);
  }, [currentBoardId, loadGroups, loadItems]);

  // Group delete confirmation trigger
  const handleRequestGroupDeleteConfirm = useCallback((groupId) => {
    const g = groups.find((gr) => gr.id === groupId);
    if (!g) return;
    setDeleteConfirmTarget({ type: 'group', id: groupId, name: g.name || '未命名分组' });
    setDeleteConfirmOpen(true);
  }, [groups]);

  // Board delete confirmation trigger
  const handleRequestBoardDeleteConfirm = useCallback(() => {
    const board = boards.find((b) => b.id === currentBoardId);
    if (!board || board.is_main) return;
    setDeleteConfirmTarget({ type: 'board', id: currentBoardId, name: board.name || '' });
    setDeleteConfirmOpen(true);
  }, [boards, currentBoardId]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirmTarget) return;
    if (deleteConfirmTarget.type === 'board') {
      await handleDeleteBoard();
    } else if (deleteConfirmTarget.type === 'group') {
      await handleDeleteGroup(deleteConfirmTarget.id);
    }
    setDeleteConfirmTarget(null);
  }, [deleteConfirmTarget, handleDeleteBoard, handleDeleteGroup]);

  // Locking
  const handleLockItem = useCallback(async (id) => {
    await window.ipm.board.lockItem(id);
    setBoardItems((prev) => prev.map((it) => it.id === id ? { ...it, locked: 1 } : it));
  }, []);

  const handleUnlockItem = useCallback(async (id) => {
    await window.ipm.board.unlockItem(id);
    setBoardItems((prev) => prev.map((it) => it.id === id ? { ...it, locked: 0 } : it));
  }, []);

  // Background style
  const handleBgChange = useCallback(async (newBgStyle, newBgColor) => {
    if (!currentBoardId) return;
    setActiveBgStyle(newBgStyle);
    setActiveBgColor(newBgColor);
    await window.ipm.board.updateBoardStyle(currentBoardId, newBgStyle, newBgColor);
    setBoards((prev) => prev.map((b) => b.id === currentBoardId ? { ...b, bg_style: newBgStyle, bg_color: newBgColor } : b));
  }, [currentBoardId]);

  // Edit navigation
  const handleEditCard = useCallback((item) => {
    if (typeof onBack === 'function') {
      onBack({
        navigate: {
          project: item.source_project,
          domain: item.source_domain,
          search: item.knowledge?.title || '',
        },
      });
    }
  }, [onBack]);

  // Board <-> Group conversion
  const handleConvertBoardToGroup = useCallback(async () => {
    if (!currentBoardId) return;
    const current = boards.find((b) => b.id === currentBoardId);
    if (!current || current.is_main) return;
    const mainBoard = boards.find((b) => b.is_main);
    if (!mainBoard) return;

    await window.ipm.board.convertBoardToGroup(currentBoardId, 100, 100);
    setCurrentBoardId(mainBoard.id);
    await loadBoards();
  }, [currentBoardId, boards, loadBoards]);

  const doConvertGroupToBoard = useCallback(async (groupId, groupName) => {
    if (!currentBoardId) return;
    await window.ipm.board.convertGroupToBoard(groupId);
    await loadBoards();
    loadGroups(currentBoardId);
    showToast(`已成功创建看板「${groupName}」`);
  }, [currentBoardId, loadBoards, loadGroups, showToast]);

  const handleConvertGroupToBoard = useCallback((groupId) => {
    const g = groups.find((gr) => gr.id === groupId);
    if (!g) return;
    setConvertGroupConfirm({ groupId, groupName: g.name || '未命名分组' });
  }, [groups]);

  // Create empty group
  const handleCreateEmptyGroup = useCallback(async () => {
    if (!currentBoardId) return;
    const center = canvasRef.current?.getViewportCenter?.() || { x: 200, y: 200 };
    const w = 400, h = 300;
    await window.ipm.board.createGroup({
      boardId: currentBoardId,
      name: '',
      x: center.x - w / 2,
      y: center.y - h / 2,
      width: w,
      height: h,
    });
    loadGroups(currentBoardId);
  }, [currentBoardId, loadGroups]);

  // Toggle group lock
  const handleToggleGroupLock = useCallback(async (groupId, lock) => {
    if (lock) {
      await window.ipm.board.lockGroup(groupId);
    } else {
      await window.ipm.board.unlockGroup(groupId);
    }
    loadGroups(currentBoardId);
  }, [currentBoardId, loadGroups]);

  // --- Timeline handlers ---
  const handleCreateTimeline = useCallback(async (orientation) => {
    const boardId = await ensureBoardId();
    if (!boardId) return;
    const id = `tl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const center = canvasRef.current?.getViewportCenter?.() || { x: 400, y: 300 };
    const isVert = orientation === 'vertical';
    await window.ipm.board.createTimeline({
      id, boardId, name: '', orientation,
      x: center.x - (isVert ? 80 : 250),
      y: center.y - (isVert ? 250 : 40),
      width: isVert ? 160 : 500,
      height: isVert ? 500 : 80,
    });
    loadTimelines(boardId);
  }, [ensureBoardId, loadTimelines]);

  const handleUpdateTimeline = useCallback(async (id, patch) => {
    await window.ipm.board.updateTimeline(id, patch);
    loadTimelines(currentBoardId);
  }, [currentBoardId, loadTimelines]);

  const handleDeleteTimeline = useCallback(async (id) => {
    await window.ipm.board.deleteTimeline(id);
    loadTimelines(currentBoardId);
  }, [currentBoardId, loadTimelines]);

  const handleAddTimelinePoint = useCallback(async (data) => {
    await window.ipm.board.addTimelinePoint(data);
    loadTimelines(currentBoardId);
  }, [currentBoardId, loadTimelines]);

  const handleUpdateTimelinePoint = useCallback(async (id, patch) => {
    await window.ipm.board.updateTimelinePoint(id, patch);
    loadTimelines(currentBoardId);
  }, [currentBoardId, loadTimelines]);

  const handleDeleteTimelinePoint = useCallback(async (id) => {
    await window.ipm.board.deleteTimelinePoint(id);
    loadTimelines(currentBoardId);
  }, [currentBoardId, loadTimelines]);

  // Create guide note and add to board
  const handleCreateGuideNote = useCallback(async () => {
    const boardId = await ensureBoardId();
    if (!boardId) return;
    const content = HELP_SECTIONS.map((sec) =>
      `## ${sec.title}\n${sec.items.map((i) => `- **${i.key}**: ${i.desc}`).join('\n')}`
    ).join('\n\n');
    await window.ipm.board.createAndAdd({
      boardId,
      type: 'note',
      title: 'Knowledge Thread Board 使用指南',
      content_text: content,
    });
    loadItems(boardId);
    showToast('已创建使用指南笔记并添加到看板');
  }, [ensureBoardId, loadItems, showToast]);

  // Group navigation
  const handleGroupNavigate = useCallback((group) => {
    canvasRef.current?.focusOnRegion({
      x: group.x, y: group.y,
      width: group.width, height: group.height,
    }, viewerMode);
  }, [viewerMode]);

  // Undo/Redo buttons
  const handleUndo = useCallback(() => { undoRedoRef.current.undo(); }, []);
  const handleRedo = useCallback(() => { undoRedoRef.current.redo(); }, []);

  useEffect(() => {
    if (renaming) setTimeout(() => renameRef.current?.focus(), 50);
  }, [renaming]);

  const currentBoard = boards.find((b) => b.id === currentBoardId);
  const existingKnowledgeCountMap = useMemo(() => {
    const m = {};
    for (const it of boardItems) {
      m[it.knowledge_id] = (m[it.knowledge_id] || 0) + 1;
    }
    return m;
  }, [boardItems]);
  const isMainBoard = !!currentBoard?.is_main;

  const typeCounts = {};
  for (const it of boardItems) {
    const t = it.knowledge?.type || 'other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#F9F8F4' }}>
      {/* Header */}
      <header style={{
        height: 64, borderBottom: '1px solid rgba(0,0,0,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', background: 'rgba(249,248,244,0.8)',
        backdropFilter: 'blur(4px)', zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => { if (typeof onBack === 'function') onBack(); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#374151'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#9CA3AF'; }}
          >
            <ArrowLeft size={16} />
            <span>返回总览</span>
          </button>
          <div style={{ width: 1, height: 20, background: '#E5E7EB' }} />
          {renaming ? (
            <input
              ref={renameRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameBoard}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameBoard(); if (e.key === 'Escape') setRenaming(false); }}
              style={{
                border: '1px solid #4a9e8e', borderRadius: 6, padding: '4px 8px',
                fontSize: 13, fontWeight: 500, outline: 'none', width: 160,
              }}
            />
          ) : (
            <h1 style={{
              fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11,
              textTransform: 'uppercase', color: '#6B7280',
              letterSpacing: '0.2em', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {currentBoard?.is_main ? (
                <Star size={10} color="#D97706" fill="#D97706" style={{ flexShrink: 0 }} />
              ) : null}
              {currentBoard?.name || 'Knowledge Thread Board'}
            </h1>
          )}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setBoardMenuOpen(!boardMenuOpen)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}
            >
              <MoreHorizontal size={16} />
            </button>
            {boardMenuOpen && (
              <div
                style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  background: 'white', borderRadius: 10, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
                  border: '1px solid #F3F4F6', padding: 4, zIndex: 100, minWidth: 160,
                }}
                className="animate-fadeIn"
              >
                <button
                  onClick={() => { setRenaming(true); setRenameValue(currentBoard?.name || ''); setBoardMenuOpen(false); }}
                  style={menuBtnStyle}
                  onMouseEnter={menuHover} onMouseLeave={menuLeave}
                >
                  <Pencil size={13} /> 重命名
                </button>
                {!isMainBoard && (
                  <button
                    onClick={() => { handleConvertBoardToGroup(); setBoardMenuOpen(false); }}
                    style={menuBtnStyle}
                    onMouseEnter={menuHover} onMouseLeave={menuLeave}
                  >
                    <ArrowRightLeft size={13} /> 转为主看板分组
                  </button>
                )}
                {!isMainBoard && (
                  <button
                    onClick={() => { handleRequestBoardDeleteConfirm(); setBoardMenuOpen(false); }}
                    style={{ ...menuBtnStyle, color: '#EF4444' }}
                    onMouseEnter={menuHover} onMouseLeave={menuLeave}
                  >
                    <Trash2 size={13} /> 删除看板
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Group navigator (main board only) */}
          {isMainBoard && groups.length > 0 && (
            <>
              <div style={{ width: 1, height: 20, background: '#E5E7EB' }} />
              <GroupNavigator groups={groups} onNavigate={handleGroupNavigate} />
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Viewer Mode toggle (main board only) */}
          {isMainBoard && (
            <button
              onClick={() => setViewerMode((v) => !v)}
              title={viewerMode ? '退出阅览模式' : '进入阅览模式'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 9999,
                background: viewerMode ? '#4a9e8e' : 'none',
                border: viewerMode ? 'none' : '1px solid #E5E7EB',
                cursor: 'pointer', transition: 'all 0.25s ease',
                fontSize: 11, color: viewerMode ? 'white' : '#9CA3AF',
              }}
              onMouseEnter={(e) => { if (!viewerMode) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
              onMouseLeave={(e) => { if (!viewerMode) e.currentTarget.style.background = 'none'; }}
            >
              {viewerMode ? <EyeOff size={13} /> : <Eye size={13} />}
              {viewerMode ? '退出阅览' : '阅览'}
            </button>
          )}

          {!viewerMode && (
            <>
              {/* Undo/Redo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button
                  onClick={handleUndo}
                  disabled={undoCount === 0}
                  title="撤回 (⌘Z)"
                  style={{
                    display: 'flex', alignItems: 'center', padding: '6px 8px',
                    borderRadius: 6, background: 'none', border: 'none',
                    cursor: undoCount > 0 ? 'pointer' : 'default',
                    color: undoCount > 0 ? '#6B7280' : '#D1D5DB',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { if (undoCount > 0) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <Undo2 size={14} />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={redoCount === 0}
                  title="重做 (⇧⌘Z)"
                  style={{
                    display: 'flex', alignItems: 'center', padding: '6px 8px',
                    borderRadius: 6, background: 'none', border: 'none',
                    cursor: redoCount > 0 ? 'pointer' : 'default',
                    color: redoCount > 0 ? '#6B7280' : '#D1D5DB',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { if (redoCount > 0) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <Redo2 size={14} />
                </button>
              </div>

              <HelpTooltip onCreateGuideNote={handleCreateGuideNote} />

              {/* Background menu */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setBgMenuOpen(!bgMenuOpen)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '6px 10px', borderRadius: 9999, background: 'none',
                    border: 'none', cursor: 'pointer', fontSize: 11, color: '#9CA3AF',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  <Palette size={13} />
                </button>
                <BgMenu
                  isOpen={bgMenuOpen}
                  currentStyle={activeBgStyle}
                  currentColor={activeBgColor}
                  onSelect={handleBgChange}
                  onClose={() => setBgMenuOpen(false)}
                />
              </div>

              <button
                onClick={() => setCollectOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 9999, background: 'none',
                  border: 'none', cursor: 'pointer', transition: 'background 0.15s',
                  fontSize: 11, color: '#6B7280', fontFamily: 'Inter, system-ui, sans-serif',
                  letterSpacing: '0.08em',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                <Plus size={14} color="#9CA3AF" />
                收集
              </button>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setCreateMenuOpen(!createMenuOpen)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 9999,
                    background: '#4a9e8e', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: 'white', fontFamily: 'Inter, system-ui, sans-serif',
                    letterSpacing: '0.08em', transition: 'opacity 0.15s',
                  }}
                >
                  <Plus size={14} />
                  新建
                </button>
                <CreateMenu
                  isOpen={createMenuOpen}
                  onClose={() => setCreateMenuOpen(false)}
                  onSelect={(type) => setQuickCreateType(type)}
                  onCreateBoard={handleCreateBoard}
                  onCreateEmptyGroup={handleCreateEmptyGroup}
                  onCreateTimeline={handleCreateTimeline}
                  isMainBoard={isMainBoard}
                />
              </div>
            </>
          )}
        </div>
      </header>

      {/* Canvas */}
      <BoardCanvas
        ref={canvasRef}
        items={boardItems}
        onLayoutChange={handleLayoutChange}
        onRemoveItem={handleRemoveItem}
        onEditCard={handleEditCard}
        onLockItem={handleLockItem}
        onUnlockItem={handleUnlockItem}
        isMain={isMainBoard}
        connections={connections}
        onAddConnection={handleAddConnection}
        onRemoveConnection={handleRemoveConnection}
        groups={groups}
        onCreateGroup={handleCreateGroup}
        onUpdateGroup={handleUpdateGroup}
        onRequestGroupDeleteConfirm={handleRequestGroupDeleteConfirm}
        onConvertGroupToBoard={handleConvertGroupToBoard}
        onToggleGroupLock={handleToggleGroupLock}
        onShowToast={showToast}
        bgStyle={activeBgStyle}
        bgColor={activeBgColor}
        undoRedoRef={undoRedoRef}
        viewerMode={viewerMode}
        onViewerDoubleClick={(item) => setViewerReaderItem(item)}
        timelines={timelines}
        onUpdateTimeline={handleUpdateTimeline}
        onDeleteTimeline={handleDeleteTimeline}
        onAddTimelinePoint={handleAddTimelinePoint}
        onUpdateTimelinePoint={handleUpdateTimelinePoint}
        onDeleteTimelinePoint={handleDeleteTimelinePoint}
      />

      {/* Footer */}
      <footer style={{
        height: 40, borderTop: '1px solid rgba(0,0,0,0.05)',
        background: '#F9F8F4', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 24px', zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#9CA3AF', fontFamily: 'Inter, system-ui, sans-serif', letterSpacing: '0.1em' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: saveStatus === 'saved' ? '#4a9e8e' : '#D97706' }} />
            {saveStatus === 'saved' ? '已保存' : '保存中...'}
          </div>
        </div>

        <BoardSwitcher
          boards={boards}
          currentBoardId={currentBoardId}
          onSwitch={setCurrentBoardId}
        />

        <span style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'Inter, system-ui, sans-serif', letterSpacing: '0.1em' }}>
          {Object.entries(typeCounts).map(([t, c], i) => (
            <React.Fragment key={t}>
              {i > 0 && <span style={{ color: '#D1D5DB', margin: '0 4px' }}>/</span>}
              {t === 'snippet' ? '文本' : t === 'note' ? '笔记' : t === 'screenshot' ? '截图' : t === 'webclip' ? '网页' : t} {c}
            </React.Fragment>
          ))}
          {Object.keys(typeCounts).length === 0 && '空看板'}
        </span>
      </footer>

      {/* Modals */}
      <CollectModal
        isOpen={collectOpen}
        onClose={() => setCollectOpen(false)}
        boardId={currentBoardId}
        existingCountMap={existingKnowledgeCountMap}
        onAdd={handleAddItem}
      />
      <QuickCreateModal
        isOpen={!!quickCreateType}
        type={quickCreateType}
        onClose={() => setQuickCreateType(null)}
        onSubmit={handleCreateAndAdd}
      />

      {/* Unified delete confirmation dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title={deleteConfirmTarget?.type === 'board' ? '确认删除看板' : '确认删除分组'}
        description={deleteConfirmTarget?.type === 'board'
          ? '此操作不可撤销。看板上的所有卡片布局将被永久删除（知识碎片本身不会被删除）。'
          : '此操作不可撤销。组内卡片将变为自由卡片（转为绝对坐标），不会被删除。'}
        matchText={deleteConfirmTarget?.name || ''}
        onClose={() => { setDeleteConfirmOpen(false); setDeleteConfirmTarget(null); }}
        onConfirm={handleConfirmDelete}
      />

      {/* Convert group → board confirmation */}
      {convertGroupConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
        }} onClick={() => setConvertGroupConfirm(null)}>
          <div
            style={{
              background: 'white', borderRadius: 16, width: 420, padding: 24,
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
            className="animate-fadeIn"
          >
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1F2937', marginBottom: 12 }}>转为独立看板</h3>
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.7, marginBottom: 20 }}>
              将分组「<span style={{ color: '#4a9e8e', fontWeight: 600 }}>{convertGroupConfirm.groupName}</span>」的内容副本创建为新的独立看板。原分组将保留不变。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setConvertGroupConfirm(null)}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: '1px solid #E5E7EB',
                  background: 'white', fontSize: 13, cursor: 'pointer', color: '#6B7280',
                }}
              >
                取消
              </button>
              <button
                onClick={async () => {
                  const { groupId, groupName } = convertGroupConfirm;
                  setConvertGroupConfirm(null);
                  await doConvertGroupToBoard(groupId, groupName);
                }}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: '#4a9e8e', color: 'white',
                  fontSize: 13, cursor: 'pointer', fontWeight: 500,
                  transition: 'opacity 0.15s',
                }}
              >
                确认创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Viewer mode: Card Reader Modal */}
      <CardReaderModal
        item={viewerReaderItem}
        onClose={() => setViewerReaderItem(null)}
        onNavigateProject={(projName, domain) => {
          if (typeof onBack === 'function') onBack();
        }}
        onNavigateFile={(filePath, fileKind) => {
          window.ipm?.shell?.openExternal?.(`file:///${filePath.replace(/\\/g, '/')}`);
        }}
      />

      {/* Viewer mode: Filter/Search Toolbar */}
      {viewerMode && isMainBoard && (
        <ViewerToolbar
          items={boardItems}
          groups={groups}
          connections={connections}
          canvasRef={canvasRef}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div
          className="animate-fadeIn"
          style={{
            position: 'fixed', bottom: 60, left: '50%', transform: 'translateX(-50%)',
            background: '#1F2937', color: 'white', padding: '10px 20px',
            borderRadius: 10, fontSize: 13, zIndex: 2000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <Check size={14} color="#4ade80" />
          {toast}
        </div>
      )}

      {/* Splash loading overlay */}
      {splashVisible && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 3000,
          background: '#F9F8F4',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28,
          opacity: splashFading ? 0 : 1,
          transition: 'opacity 0.4s ease',
          pointerEvents: splashFading ? 'none' : 'auto',
        }}>
          <ShapeLoader />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#4a9e8e', letterSpacing: '0.05em', marginBottom: 5 }}>
              Knowledge Thread Board
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 400 }}>
              正在加载看板...
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const menuBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  padding: '7px 12px', border: 'none', background: 'none',
  cursor: 'pointer', borderRadius: 6, fontSize: 12, color: '#374151',
  transition: 'background 0.15s',
};

function menuHover(e) { e.currentTarget.style.background = '#F9FAFB'; }
function menuLeave(e) { e.currentTarget.style.background = 'none'; }

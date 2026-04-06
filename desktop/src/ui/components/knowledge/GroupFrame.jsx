import React, { useRef, useState, useCallback, useMemo } from 'react';
import { X, GripHorizontal, ArrowRightLeft, Lock, Unlock, Pencil, Palette } from 'lucide-react';

const GROUP_STYLES = {
  default: {
    label: '默认',
    bg: (locked) => locked ? 'rgba(243,244,246,0.6)' : 'rgba(255,255,255,0.55)',
    border: (hovered, selected, locked) => {
      const color = selected ? 'rgba(74,158,142,0.7)' : locked ? 'rgba(156,163,175,0.4)' : 'rgba(74,158,142,0.3)';
      return `${selected ? 2 : 1.5}px ${hovered || selected ? 'solid' : 'dashed'} ${color}`;
    },
    radius: 14,
    headerBg: (hovered, selected) => hovered || selected ? 'rgba(74,158,142,0.04)' : 'transparent',
    headerBorder: (hovered, selected) => hovered || selected ? '1px solid rgba(74,158,142,0.1)' : '1px solid transparent',
    titleColor: (locked) => locked ? '#9CA3AF' : 'rgba(74,158,142,0.7)',
    iconColor: '#4a9e8e',
    backdrop: 'blur(2px)',
    shadow: (hovered, selected) => selected
      ? '0 0 0 3px rgba(74,158,142,0.1), 0 4px 20px rgba(0,0,0,0.06)'
      : hovered ? '0 4px 20px rgba(0,0,0,0.06)' : '0 1px 4px rgba(0,0,0,0.02)',
    preview: { bg: '#fff', border: '1.5px dashed rgba(74,158,142,0.35)', headerBg: 'rgba(74,158,142,0.06)' },
  },
  blackboard: {
    label: '黑板',
    bg: () => 'rgba(35,40,44,0.92)',
    border: (hovered, selected) => {
      const color = selected ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)';
      return `${selected ? 2 : 1.5}px solid ${color}`;
    },
    radius: 8,
    headerBg: () => 'rgba(255,255,255,0.06)',
    headerBorder: (hovered) => hovered ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
    titleColor: () => 'rgba(255,255,255,0.7)',
    iconColor: 'rgba(255,255,255,0.6)',
    backdrop: 'none',
    shadow: (hovered, selected) => selected
      ? '0 0 0 3px rgba(255,255,255,0.08), 0 8px 30px rgba(0,0,0,0.3)'
      : hovered ? '0 8px 30px rgba(0,0,0,0.3)' : '0 4px 12px rgba(0,0,0,0.2)',
    preview: { bg: '#23282c', border: '1.5px solid rgba(255,255,255,0.15)', headerBg: 'rgba(255,255,255,0.08)' },
  },
  whiteboard: {
    label: '白板',
    bg: () => 'rgba(255,255,255,0.96)',
    border: (hovered, selected) => {
      const color = selected ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.08)';
      return `${selected ? 2 : 1}px solid ${color}`;
    },
    radius: 12,
    headerBg: (hovered) => hovered ? 'rgba(0,0,0,0.02)' : 'transparent',
    headerBorder: (hovered) => hovered ? '1px solid rgba(0,0,0,0.04)' : '1px solid transparent',
    titleColor: () => 'rgba(0,0,0,0.55)',
    iconColor: '#6B7280',
    backdrop: 'none',
    shadow: (hovered, selected) => selected
      ? '0 0 0 3px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.08)'
      : hovered ? '0 8px 24px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.04)',
    preview: { bg: '#fff', border: '1px solid rgba(0,0,0,0.1)', headerBg: 'rgba(0,0,0,0.03)' },
  },
  macwindow: {
    label: 'Mac 窗口',
    bg: () => 'rgba(255,255,255,0.94)',
    border: (hovered, selected) => {
      const color = selected ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.12)';
      return `1px solid ${color}`;
    },
    radius: 10,
    headerBg: () => 'linear-gradient(to bottom, #ececec, #d8d8d8)',
    headerBorder: () => '1px solid rgba(0,0,0,0.08)',
    titleColor: () => 'rgba(0,0,0,0.7)',
    iconColor: '#555',
    backdrop: 'none',
    shadow: (hovered, selected) => selected
      ? '0 0 0 3px rgba(0,0,0,0.06), 0 10px 30px rgba(0,0,0,0.12)'
      : hovered ? '0 10px 30px rgba(0,0,0,0.12)' : '0 2px 10px rgba(0,0,0,0.08)',
    macDots: true,
    preview: { bg: '#fff', border: '1px solid rgba(0,0,0,0.12)', headerBg: '#e0e0e0' },
  },
};

function StylePicker({ current, onSelect, onClose }) {
  return (
    <div
      className="group-handle animate-fadeIn"
      style={{
        position: 'absolute', top: 32, right: 4, zIndex: 20,
        background: 'white', borderRadius: 10, padding: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: '1px solid #E5E7EB',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
        width: 160,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {Object.entries(GROUP_STYLES).map(([key, s]) => (
        <button
          key={key}
          onClick={() => { onSelect(key); onClose(); }}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: 6, border: current === key ? '1.5px solid #4a9e8e' : '1.5px solid #E5E7EB',
            borderRadius: 8, background: current === key ? 'rgba(74,158,142,0.04)' : '#FAFAFA',
            cursor: 'pointer', transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => { if (current !== key) e.currentTarget.style.borderColor = '#9CA3AF'; }}
          onMouseLeave={(e) => { if (current !== key) e.currentTarget.style.borderColor = '#E5E7EB'; }}
        >
          {/* Mini preview */}
          <div style={{
            width: 56, height: 36, borderRadius: Math.min(s.radius, 6),
            background: s.preview.bg,
            border: s.preview.border,
            overflow: 'hidden', position: 'relative',
          }}>
            <div style={{
              height: 10, background: s.preview.headerBg,
              borderBottom: '1px solid rgba(0,0,0,0.05)',
              display: 'flex', alignItems: 'center', padding: '0 3px', gap: 2,
            }}>
              {s.macDots && (
                <>
                  <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#FF5F57' }} />
                  <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#FEBC2E' }} />
                  <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#28C840' }} />
                </>
              )}
            </div>
          </div>
          <span style={{ fontSize: 9, color: current === key ? '#4a9e8e' : '#6B7280', fontWeight: current === key ? 600 : 400 }}>
            {s.label}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function GroupFrame({
  group,
  readOnly = false,
  scale = 1,
  isSelected = false,
  onUpdate,
  onDragEnd,
  onRequestDeleteConfirm,
  onConvertToBoard,
  onToggleLock,
  onShiftClick,
  viewerMode = false,
  highlightState = 'normal',
  onViewerClick,
}) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(group.name || '');
  const [hovered, setHovered] = useState(false);
  const [showStylePicker, setShowStylePicker] = useState(false);

  const isLocked = !!group.locked;
  const isInteractable = !readOnly && !isLocked;
  const styleKey = group.frame_style || 'default';
  const S = GROUP_STYLES[styleKey] || GROUP_STYLES.default;

  const handleDragStart = useCallback((e) => {
    if (!isInteractable || e.target.closest('.group-handle')) return;
    if (e.shiftKey && onShiftClick) { e.stopPropagation(); onShiftClick(); return; }
    e.stopPropagation();
    dragRef.current = { startX: group.x, startY: group.y, px: e.clientX, py: e.clientY };
    const el = e.currentTarget;
    if (el?.setPointerCapture) el.setPointerCapture(e.pointerId);
  }, [isInteractable, group, onShiftClick]);

  const handleResizeStart = useCallback((e) => {
    if (!isInteractable) return;
    e.stopPropagation();
    resizeRef.current = { startW: group.width, startH: group.height, px: e.clientX, py: e.clientY };
    const el = e.currentTarget;
    if (el?.setPointerCapture) el.setPointerCapture(e.pointerId);
  }, [isInteractable, group]);

  const handleMove = useCallback((e) => {
    if (dragRef.current) {
      const dx = (e.clientX - dragRef.current.px) / scale;
      const dy = (e.clientY - dragRef.current.py) / scale;
      onUpdate?.({ x: dragRef.current.startX + dx, y: dragRef.current.startY + dy });
    }
    if (resizeRef.current) {
      const dx = (e.clientX - resizeRef.current.px) / scale;
      const dy = (e.clientY - resizeRef.current.py) / scale;
      onUpdate?.({ width: Math.max(200, resizeRef.current.startW + dx), height: Math.max(120, resizeRef.current.startH + dy) });
    }
  }, [onUpdate, scale]);

  const handleUp = useCallback(() => {
    const hadInteraction = !!dragRef.current || !!resizeRef.current;
    dragRef.current = null;
    resizeRef.current = null;
    if (hadInteraction) onDragEnd?.();
  }, [onDragEnd]);

  const commitName = useCallback(() => {
    setEditing(false);
    if (nameValue.trim() !== (group.name || '')) {
      onUpdate?.({ name: nameValue.trim() });
    }
  }, [nameValue, group.name, onUpdate]);

  const handleStyleChange = useCallback((newStyle) => {
    onUpdate?.({ frame_style: newStyle });
  }, [onUpdate]);

  const isMac = styleKey === 'macwindow';
  const headerBgValue = S.headerBg(hovered, isSelected);
  const isGradientBg = headerBgValue.startsWith('linear-gradient');

  const headerBtnStyle = useMemo(() => ({
    background: styleKey === 'blackboard' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
    border: `1px solid ${styleKey === 'blackboard' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 4, width: 16, height: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', padding: 0, flexShrink: 0,
  }), [styleKey]);

  const hlOpacity = highlightState === 'dimmed' ? 0.25 : highlightState === 'filter-dimmed' ? 0.15 : 1;
  const hlBorder = highlightState === 'anchor' ? '2px solid #4a9e8e'
    : highlightState === 'connected' ? '2px solid rgba(74,158,142,0.4)'
    : S.border(hovered, isSelected, isLocked);
  const hlShadow = highlightState === 'anchor' ? '0 0 16px rgba(74,158,142,0.3), ' + S.shadow(hovered, isSelected)
    : highlightState === 'connected' ? '0 0 10px rgba(74,158,142,0.15), ' + S.shadow(hovered, isSelected)
    : S.shadow(hovered, isSelected);

  return (
    <div
      ref={frameRef}
      style={{
        position: 'absolute', left: group.x, top: group.y,
        width: group.width, height: group.height,
        background: S.bg(isLocked),
        border: hlBorder,
        borderRadius: S.radius,
        zIndex: group.z_index ?? 0,
        pointerEvents: 'auto',
        transition: 'border 0.3s, box-shadow 0.3s, background 0.2s, opacity 0.3s, filter 0.3s',
        boxShadow: hlShadow,
        backdropFilter: S.backdrop,
        opacity: hlOpacity,
        filter: highlightState === 'filter-dimmed' ? 'grayscale(0.5)' : 'none',
        cursor: viewerMode ? 'pointer' : undefined,
      }}
      onPointerDown={viewerMode ? undefined : handleDragStart}
      onPointerMove={viewerMode ? undefined : handleMove}
      onPointerUp={viewerMode ? undefined : handleUp}
      onPointerCancel={viewerMode ? undefined : handleUp}
      onClick={viewerMode ? ((e) => { e.stopPropagation(); onViewerClick?.(); }) : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowStylePicker(false); }}
    >
      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: isMac ? 32 : 28,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: isMac ? '0 12px' : '0 10px',
        borderBottom: S.headerBorder(hovered, isSelected),
        borderRadius: `${S.radius}px ${S.radius}px 0 0`,
        background: isGradientBg ? undefined : headerBgValue,
        backgroundImage: isGradientBg ? headerBgValue : undefined,
        transition: 'background 0.15s',
        cursor: isLocked ? 'default' : (readOnly ? 'default' : 'grab'),
      }}>
        {/* Mac dots */}
        {isMac && (
          <div style={{ display: 'flex', gap: 5, marginRight: 6, flexShrink: 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF5F57', border: '0.5px solid rgba(0,0,0,0.1)' }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FEBC2E', border: '0.5px solid rgba(0,0,0,0.1)' }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#28C840', border: '0.5px solid rgba(0,0,0,0.1)' }} />
          </div>
        )}

        {!isMac && isInteractable && hovered && (
          <GripHorizontal size={12} color={S.iconColor} style={{ flexShrink: 0, opacity: 0.5 }} />
        )}

        {isLocked && !isMac && (
          <Lock size={10} color="#9CA3AF" style={{ flexShrink: 0 }} />
        )}

        {editing && isInteractable ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditing(false); }}
            style={{
              border: `1px solid ${styleKey === 'blackboard' ? 'rgba(255,255,255,0.3)' : 'rgba(74,158,142,0.4)'}`,
              borderRadius: 4, padding: '1px 6px', fontSize: isMac ? 11 : 10, outline: 'none',
              background: styleKey === 'blackboard' ? 'rgba(255,255,255,0.1)' : 'white',
              color: styleKey === 'blackboard' ? '#fff' : '#374151',
              fontFamily: 'Inter, system-ui, sans-serif', flex: 1, minWidth: 0,
              textAlign: isMac ? 'center' : 'left',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            style={{
              fontSize: isMac ? 11 : 10, color: S.titleColor(isLocked),
              fontFamily: 'Inter, system-ui, sans-serif',
              fontWeight: isMac ? 500 : 400,
              letterSpacing: isMac ? '0.02em' : '0.08em',
              cursor: isInteractable ? 'text' : 'default',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              flex: 1, minWidth: 0, textAlign: isMac ? 'center' : 'left',
            }}
            onDoubleClick={(e) => { if (isInteractable) { e.stopPropagation(); setEditing(true); setNameValue(group.name || ''); } }}
          >
            {group.name || '未命名分组'}
          </span>
        )}

        {/* Action buttons — visible on hover */}
        {!readOnly && hovered && (
          <div className="group-handle" style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            {/* Rename */}
            {isInteractable && (
              <button
                className="group-handle"
                onClick={(e) => { e.stopPropagation(); setEditing(true); setNameValue(group.name || ''); }}
                title="重命名"
                style={headerBtnStyle}
              >
                <Pencil size={8} color={S.iconColor} />
              </button>
            )}

            {/* Style picker */}
            {isInteractable && (
              <button
                className="group-handle"
                onClick={(e) => { e.stopPropagation(); setShowStylePicker((p) => !p); }}
                title="切换风格"
                style={headerBtnStyle}
              >
                <Palette size={8} color={S.iconColor} />
              </button>
            )}

            {/* Lock/Unlock */}
            {onToggleLock && (
              <button
                className="group-handle"
                onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
                title={isLocked ? '解锁分组' : '锁定分组'}
                style={headerBtnStyle}
              >
                {isLocked ? <Unlock size={9} color="#4a9e8e" /> : <Lock size={9} color="#9CA3AF" />}
              </button>
            )}

            {/* Convert to board */}
            {isInteractable && onConvertToBoard && (
              <button
                className="group-handle"
                onClick={(e) => { e.stopPropagation(); onConvertToBoard(); }}
                title="转为独立看板"
                style={headerBtnStyle}
              >
                <ArrowRightLeft size={9} color={S.iconColor} />
              </button>
            )}

            {/* Delete */}
            {isInteractable && onRequestDeleteConfirm && (
              <button
                className="group-handle"
                onClick={(e) => { e.stopPropagation(); onRequestDeleteConfirm(); }}
                title="删除分组"
                style={{
                  ...headerBtnStyle,
                  border: '1px solid rgba(239,68,68,0.3)',
                }}
              >
                <X size={10} color="#ef4444" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Style picker popup */}
      {showStylePicker && isInteractable && (
        <StylePicker
          current={styleKey}
          onSelect={handleStyleChange}
          onClose={() => setShowStylePicker(false)}
        />
      )}

      {/* Blackboard chalk dust effect */}
      {styleKey === 'blackboard' && (
        <div style={{
          position: 'absolute', bottom: 6, left: 10, right: 10, height: 1,
          background: 'rgba(255,255,255,0.06)', borderRadius: 1, pointerEvents: 'none',
        }} />
      )}

      {/* Resize handle */}
      {isInteractable && (
        <div
          className="group-handle"
          style={{
            position: 'absolute', bottom: -4, right: -4,
            width: 12, height: 12, cursor: 'se-resize',
            background: hovered
              ? (styleKey === 'blackboard' ? 'rgba(255,255,255,0.15)' : 'rgba(74,158,142,0.2)')
              : 'transparent',
            borderRadius: 3, transition: 'background 0.15s',
          }}
          onPointerDown={handleResizeStart}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        />
      )}
    </div>
  );
}

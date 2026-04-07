import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Trash2, GripHorizontal } from 'lucide-react';

const AXIS_OFFSET = 22;
const POINT_RADIUS = 5;
const TICK_LEN = 14;
const LABEL_FONT = 12;
const HEADER_H = 30;
const MIN_LENGTH = 120;
const MIN_WIDTH = 80;
const HANDLE_SIZE = 6;

export default function TimelineStrip({
  timeline,
  scale = 1,
  readOnly = false,
  viewerMode = false,
  onUpdate,
  onDelete,
  onAddPoint,
  onUpdatePoint,
  onDeletePoint,
}) {
  const stripRef = useRef(null);
  const dragRef = useRef(null);
  const pointDragRef = useRef(null);

  const [hovered, setHovered] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(timeline.name || '');
  const [editingPointId, setEditingPointId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [hoveredPointId, setHoveredPointId] = useState(null);

  const [localX, setLocalX] = useState(timeline.x);
  const [localY, setLocalY] = useState(timeline.y);
  const [localW, setLocalW] = useState(timeline.width);
  const [localH, setLocalH] = useState(timeline.height);
  const [localPoints, setLocalPoints] = useState(timeline.points || []);

  useEffect(() => { setLocalX(timeline.x); }, [timeline.x]);
  useEffect(() => { setLocalY(timeline.y); }, [timeline.y]);
  useEffect(() => { setLocalW(timeline.width); }, [timeline.width]);
  useEffect(() => { setLocalH(timeline.height); }, [timeline.height]);
  useEffect(() => { setLocalPoints(timeline.points || []); }, [timeline.points]);
  useEffect(() => { setNameValue(timeline.name || ''); }, [timeline.name]);

  const isVertical = timeline.orientation === 'vertical';
  const effectiveReadOnly = readOnly || viewerMode;

  const handleDragStart = useCallback((e) => {
    if (effectiveReadOnly) return;
    e.stopPropagation();
    const startMX = e.clientX, startMY = e.clientY;
    const origX = localX, origY = localY;
    dragRef.current = { startMX, startMY, origX, origY };

    const onMove = (ev) => {
      const dx = (ev.clientX - startMX) / scale;
      const dy = (ev.clientY - startMY) / scale;
      setLocalX(origX + dx);
      setLocalY(origY + dy);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const dx = (ev.clientX - startMX) / scale;
      const dy = (ev.clientY - startMY) / scale;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        onUpdate?.(timeline.id, { x: origX + dx, y: origY + dy });
      }
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [effectiveReadOnly, localX, localY, scale, timeline.id, onUpdate]);

  const makeResizeHandler = useCallback((axis) => (e) => {
    if (effectiveReadOnly) return;
    e.stopPropagation();
    e.preventDefault();
    const startMX = e.clientX, startMY = e.clientY;
    const origW = localW, origH = localH;

    const onMove = (ev) => {
      if (axis === 'height') {
        const dy = (ev.clientY - startMY) / scale;
        setLocalH(Math.max(MIN_LENGTH, origH + dy));
      } else {
        const dx = (ev.clientX - startMX) / scale;
        setLocalW(Math.max(MIN_WIDTH, origW + dx));
      }
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (axis === 'height') {
        const dy = (ev.clientY - startMY) / scale;
        onUpdate?.(timeline.id, { height: Math.max(MIN_LENGTH, origH + dy) });
      } else {
        const dx = (ev.clientX - startMX) / scale;
        onUpdate?.(timeline.id, { width: Math.max(MIN_WIDTH, origW + dx) });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [effectiveReadOnly, localW, localH, scale, timeline.id, onUpdate]);

  const handlePointDragStart = useCallback((e, pt) => {
    if (effectiveReadOnly) return;
    e.stopPropagation();
    const startM = isVertical ? e.clientY : e.clientX;
    const origPos = pt.position;
    pointDragRef.current = { id: pt.id, startM, origPos };

    const maxPos = isVertical ? (localH - HEADER_H - 16) : (localW - HEADER_H - 16);

    const onMove = (ev) => {
      const delta = ((isVertical ? ev.clientY : ev.clientX) - startM) / scale;
      const newPos = Math.max(8, Math.min(maxPos, origPos + delta));
      setLocalPoints(prev => prev.map(p => p.id === pt.id ? { ...p, position: newPos } : p));
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const delta = ((isVertical ? ev.clientY : ev.clientX) - startM) / scale;
      const newPos = Math.max(8, Math.min(maxPos, origPos + delta));
      onUpdatePoint?.(pt.id, { position: newPos });
      pointDragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [effectiveReadOnly, isVertical, localH, localW, scale, onUpdatePoint]);

  const handleStripDblClick = useCallback((e) => {
    if (effectiveReadOnly) return;
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect) return;
    let pos;
    if (isVertical) {
      pos = (e.clientY - rect.top) / scale - HEADER_H;
    } else {
      pos = (e.clientX - rect.left) / scale - HEADER_H;
    }
    pos = Math.max(8, pos);
    const id = `tp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    onAddPoint?.({ id, timelineId: timeline.id, label: '', position: pos, color: '#4a9e8e' });
  }, [effectiveReadOnly, isVertical, scale, timeline.id, onAddPoint]);

  const commitName = useCallback(() => {
    setEditingName(false);
    if (nameValue !== (timeline.name || '')) {
      onUpdate?.(timeline.id, { name: nameValue });
    }
  }, [nameValue, timeline.name, timeline.id, onUpdate]);

  const commitLabel = useCallback(() => {
    if (!editingPointId) return;
    onUpdatePoint?.(editingPointId, { label: editingLabel });
    setEditingPointId(null);
    setEditingLabel('');
  }, [editingPointId, editingLabel, onUpdatePoint]);

  const axisLen = isVertical ? (localH - HEADER_H) : (localW - HEADER_H);
  const labelAreaW = localW - AXIS_OFFSET - TICK_LEN - 8;

  const renderVerticalPoint = (pt, isEditing, isHovered) => (
    <div
      key={pt.id}
      onMouseEnter={() => setHoveredPointId(pt.id)}
      onMouseLeave={() => setHoveredPointId(null)}
      onPointerDown={(e) => handlePointDragStart(e, pt)}
      style={{
        position: 'absolute',
        left: 0,
        top: pt.position,
        width: '100%',
        height: 24,
        display: 'flex',
        alignItems: 'center',
        cursor: effectiveReadOnly ? 'default' : 'ns-resize',
      }}
    >
      <div style={{
        position: 'absolute',
        left: AXIS_OFFSET - TICK_LEN / 2 + 0.75,
        top: '50%', transform: 'translateY(-50%)',
        width: TICK_LEN, height: 1.5,
        background: isHovered ? 'rgba(74,158,142,0.5)' : 'rgba(0,0,0,0.12)',
        transition: 'background 0.15s',
      }} />
      <div style={{
        position: 'absolute',
        left: AXIS_OFFSET + 0.75 - POINT_RADIUS,
        top: '50%', transform: 'translateY(-50%)',
        width: POINT_RADIUS * 2, height: POINT_RADIUS * 2,
        borderRadius: '50%',
        background: pt.color || '#4a9e8e',
        boxShadow: isHovered ? `0 0 0 3px ${(pt.color || '#4a9e8e')}33` : 'none',
        transition: 'box-shadow 0.15s',
        zIndex: 2,
      }} />
      <div style={{
        position: 'absolute',
        left: AXIS_OFFSET + TICK_LEN / 2 + 6,
        top: '50%', transform: 'translateY(-50%)',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        {isEditing ? (
          <input
            autoFocus
            value={editingLabel}
            onChange={(e) => setEditingLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingPointId(null); }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              fontSize: LABEL_FONT, border: 'none', outline: 'none',
              background: 'rgba(74,158,142,0.08)', borderRadius: 4,
              padding: '2px 6px', color: '#374151', minWidth: 40,
              width: Math.max(40, (editingLabel.length + 1) * 8),
              boxShadow: '0 0 0 1px rgba(74,158,142,0.2)',
            }}
          />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (!effectiveReadOnly) { setEditingPointId(pt.id); setEditingLabel(pt.label || ''); }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              fontSize: LABEL_FONT, color: '#444',
              cursor: effectiveReadOnly ? 'default' : 'text',
              whiteSpace: 'nowrap',
              minHeight: 16, padding: '1px 4px',
              borderRadius: 3,
              background: (!pt.label && !effectiveReadOnly) ? 'rgba(0,0,0,0.03)' : 'transparent',
              transition: 'background 0.15s',
            }}
          >
            {pt.label || (effectiveReadOnly ? '' : '点击编辑')}
          </span>
        )}
        {!effectiveReadOnly && isHovered && !isEditing && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDeletePoint?.(pt.id); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#EF4444', padding: 1, display: 'flex',
              opacity: 0.5, transition: 'opacity 0.15s', flexShrink: 0,
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.5'}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );

  const renderHorizontalPoint = (pt, isEditing, isHovered) => (
    <div
      key={pt.id}
      onMouseEnter={() => setHoveredPointId(pt.id)}
      onMouseLeave={() => setHoveredPointId(null)}
      onPointerDown={(e) => handlePointDragStart(e, pt)}
      style={{
        position: 'absolute',
        left: pt.position,
        top: 0,
        height: '100%',
        width: 24,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: effectiveReadOnly ? 'default' : 'ew-resize',
      }}
    >
      <div style={{
        position: 'absolute',
        top: AXIS_OFFSET - TICK_LEN / 2 + 0.75,
        left: '50%', transform: 'translateX(-50%)',
        height: TICK_LEN, width: 1.5,
        background: isHovered ? 'rgba(74,158,142,0.5)' : 'rgba(0,0,0,0.12)',
        transition: 'background 0.15s',
      }} />
      <div style={{
        position: 'absolute',
        top: AXIS_OFFSET + 0.75 - POINT_RADIUS,
        left: '50%', transform: 'translateX(-50%)',
        width: POINT_RADIUS * 2, height: POINT_RADIUS * 2,
        borderRadius: '50%',
        background: pt.color || '#4a9e8e',
        boxShadow: isHovered ? `0 0 0 3px ${(pt.color || '#4a9e8e')}33` : 'none',
        transition: 'box-shadow 0.15s',
        zIndex: 2,
      }} />
      <div style={{
        position: 'absolute',
        top: AXIS_OFFSET + TICK_LEN / 2 + 6,
        left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      }}>
        {isEditing ? (
          <input
            autoFocus
            value={editingLabel}
            onChange={(e) => setEditingLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingPointId(null); }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              fontSize: LABEL_FONT, border: 'none', outline: 'none',
              background: 'rgba(74,158,142,0.08)', borderRadius: 4,
              padding: '2px 6px', color: '#374151', minWidth: 40,
              width: Math.max(40, (editingLabel.length + 1) * 8),
              textAlign: 'center',
              boxShadow: '0 0 0 1px rgba(74,158,142,0.2)',
            }}
          />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (!effectiveReadOnly) { setEditingPointId(pt.id); setEditingLabel(pt.label || ''); }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              fontSize: LABEL_FONT, color: '#444',
              cursor: effectiveReadOnly ? 'default' : 'text',
              whiteSpace: 'nowrap',
              minHeight: 16, padding: '1px 4px', textAlign: 'center',
            }}
          >
            {pt.label || (effectiveReadOnly ? '' : '...')}
          </span>
        )}
        {!effectiveReadOnly && isHovered && !isEditing && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDeletePoint?.(pt.id); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#EF4444', padding: 1, display: 'flex',
              opacity: 0.5, transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.5'}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={stripRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setHoveredPointId(null); }}
      onDoubleClick={handleStripDblClick}
      style={{
        position: 'absolute',
        left: localX,
        top: localY,
        width: localW,
        height: localH,
        zIndex: timeline.z_index || 0,
        background: 'rgba(255,255,255,0.92)',
        border: hovered ? '1px solid rgba(74,158,142,0.35)' : '1px solid rgba(0,0,0,0.08)',
        borderRadius: 8,
        boxShadow: hovered
          ? '0 4px 20px rgba(0,0,0,0.08), 0 0 0 2px rgba(74,158,142,0.08)'
          : '0 1px 6px rgba(0,0,0,0.04)',
        cursor: effectiveReadOnly ? 'default' : 'grab',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        userSelect: 'none',
        overflow: 'visible',
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div
        onPointerDown={handleDragStart}
        style={{
          height: HEADER_H,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 8px',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          cursor: effectiveReadOnly ? 'default' : 'grab',
          gap: 4,
        }}
      >
        {!effectiveReadOnly && (
          <GripHorizontal size={12} style={{ color: '#9CA3AF', flexShrink: 0 }} />
        )}
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameValue(timeline.name || ''); setEditingName(false); } }}
            style={{
              flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600,
              border: 'none', outline: 'none', background: 'rgba(74,158,142,0.06)',
              borderRadius: 4, padding: '2px 6px', color: '#374151',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); if (!effectiveReadOnly) setEditingName(true); }}
            style={{
              flex: 1, fontSize: 11, fontWeight: 600,
              color: 'rgba(74,158,142,0.8)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: effectiveReadOnly ? 'default' : 'text',
              letterSpacing: 0.3,
            }}
          >
            {nameValue || '时间线'}
          </span>
        )}
        {!effectiveReadOnly && hovered && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(timeline.id); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: '#EF4444', display: 'flex', alignItems: 'center', opacity: 0.6,
              transition: 'opacity 0.15s', flexShrink: 0,
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Axis + points */}
      <div style={{
        position: 'relative',
        width: isVertical ? '100%' : localW,
        height: isVertical ? (localH - HEADER_H) : '100%',
        overflow: 'visible',
      }}>
        {isVertical ? (
          <div style={{
            position: 'absolute', left: AXIS_OFFSET, top: 8,
            width: 1.5, height: axisLen - 16,
            background: 'rgba(0,0,0,0.1)', borderRadius: 1,
          }} />
        ) : (
          <div style={{
            position: 'absolute', top: AXIS_OFFSET, left: 8,
            height: 1.5, width: axisLen - 16,
            background: 'rgba(0,0,0,0.1)', borderRadius: 1,
          }} />
        )}

        {localPoints.map((pt) => {
          const isEditing = editingPointId === pt.id;
          const isHovered = hoveredPointId === pt.id;
          return isVertical
            ? renderVerticalPoint(pt, isEditing, isHovered)
            : renderHorizontalPoint(pt, isEditing, isHovered);
        })}
      </div>

      {/* Resize handles */}
      {!effectiveReadOnly && (
        <>
          {/* Length handle: bottom (vertical) or right (horizontal) */}
          {isVertical ? (
            <div
              onPointerDown={makeResizeHandler('height')}
              style={{
                position: 'absolute', bottom: -3, left: '50%',
                transform: 'translateX(-50%)',
                width: '60%', height: HANDLE_SIZE, borderRadius: 3,
                background: hovered ? 'rgba(74,158,142,0.5)' : 'rgba(0,0,0,0.06)',
                cursor: 'ns-resize', transition: 'background 0.2s',
              }}
            />
          ) : (
            <div
              onPointerDown={makeResizeHandler('width')}
              style={{
                position: 'absolute', right: -3, top: '50%',
                transform: 'translateY(-50%)',
                width: HANDLE_SIZE, height: '60%', borderRadius: 3,
                background: hovered ? 'rgba(74,158,142,0.5)' : 'rgba(0,0,0,0.06)',
                cursor: 'ew-resize', transition: 'background 0.2s',
              }}
            />
          )}
          {/* Width handle for vertical / height handle for horizontal */}
          {isVertical ? (
            <div
              onPointerDown={makeResizeHandler('width')}
              style={{
                position: 'absolute', right: -3, top: '50%',
                transform: 'translateY(-50%)',
                width: HANDLE_SIZE, height: '40%', borderRadius: 3,
                background: hovered ? 'rgba(74,158,142,0.35)' : 'transparent',
                cursor: 'ew-resize', transition: 'background 0.2s',
              }}
            />
          ) : (
            <div
              onPointerDown={makeResizeHandler('height')}
              style={{
                position: 'absolute', bottom: -3, left: '50%',
                transform: 'translateX(-50%)',
                width: '40%', height: HANDLE_SIZE, borderRadius: 3,
                background: hovered ? 'rgba(74,158,142,0.35)' : 'transparent',
                cursor: 'ns-resize', transition: 'background 0.2s',
              }}
            />
          )}
        </>
      )}

      {/* Empty hint */}
      {!effectiveReadOnly && hovered && localPoints.length === 0 && (
        <div style={{
          position: 'absolute',
          left: '50%', top: isVertical ? '50%' : undefined,
          bottom: isVertical ? undefined : 4,
          transform: isVertical ? 'translate(-50%, -50%)' : 'translateX(-50%)',
          fontSize: 10, color: 'rgba(0,0,0,0.2)', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          双击添加时间点
        </div>
      )}
    </div>
  );
}

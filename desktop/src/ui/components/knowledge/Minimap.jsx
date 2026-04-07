import React, { useMemo, useRef, useCallback } from 'react';

const MINIMAP_W = 120;
const MINIMAP_H = 80;

const TYPE_COLORS = {
  snippet: '#F59E0B',
  note: '#10B981',
  screenshot: '#EC4899',
  webclip: '#4a9e8e',
  draft: '#D97706',
};

export default function Minimap({
  items = [],
  groups = [],
  timelines = [],
  viewportX,
  viewportY,
  scale,
  canvasRef,
  onNavigate,
}) {
  const minimapRef = useRef(null);

  const bounds = useMemo(() => {
    if (items.length === 0 && timelines.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + (it.width || 240));
      maxY = Math.max(maxY, it.y + 150);
    }
    for (const g of groups) {
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.width);
      maxY = Math.max(maxY, g.y + g.height);
    }
    for (const tl of timelines) {
      minX = Math.min(minX, tl.x);
      minY = Math.min(minY, tl.y);
      maxX = Math.max(maxX, tl.x + tl.width);
      maxY = Math.max(maxY, tl.y + tl.height);
    }
    const pad = 200;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [items, groups, timelines]);

  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const scaleX = MINIMAP_W / worldW;
  const scaleY = MINIMAP_H / worldH;
  const s = Math.min(scaleX, scaleY);

  const canvasRect = canvasRef?.current?.getBoundingClientRect();
  const vpW = canvasRect ? canvasRect.width / scale : 800;
  const vpH = canvasRect ? canvasRect.height / scale : 600;

  const vpRectX = (-viewportX / scale - bounds.minX) * s;
  const vpRectY = (-viewportY / scale - bounds.minY) * s;
  const vpRectW = vpW * s;
  const vpRectH = vpH * s;

  const handleClick = useCallback((e) => {
    const rect = minimapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldX = mx / s + bounds.minX;
    const worldY = my / s + bounds.minY;
    onNavigate(-worldX * scale + vpW * scale / 2, -worldY * scale + vpH * scale / 2);
  }, [s, bounds, scale, vpW, vpH, onNavigate]);

  return (
    <div
      ref={minimapRef}
      onClick={handleClick}
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        width: MINIMAP_W,
        height: MINIMAP_H,
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(6px)',
        borderRadius: 8,
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        zIndex: 30,
        cursor: 'crosshair',
        overflow: 'hidden',
      }}
    >
      {/* Groups as faint rectangles */}
      {groups.map((g) => (
        <div
          key={g.id}
          style={{
            position: 'absolute',
            left: (g.x - bounds.minX) * s,
            top: (g.y - bounds.minY) * s,
            width: g.width * s,
            height: g.height * s,
            background: g.frame_style === 'blackboard' ? 'rgba(35,40,44,0.3)' : g.frame_style === 'macwindow' ? 'rgba(200,200,200,0.2)' : 'rgba(74,158,142,0.1)',
            borderRadius: 1,
          }}
        />
      ))}

      {/* Timelines as narrow colored strips */}
      {timelines.map((tl) => (
        <div
          key={tl.id}
          style={{
            position: 'absolute',
            left: (tl.x - bounds.minX) * s,
            top: (tl.y - bounds.minY) * s,
            width: Math.max(2, tl.width * s),
            height: Math.max(2, tl.height * s),
            background: 'rgba(99,102,241,0.35)',
            borderRadius: 1,
          }}
        />
      ))}

      {/* Cards as small colored blocks */}
      {items.map((it) => {
        const type = it.knowledge?.source_kind === 'draft' ? 'draft' : (it.knowledge?.type || 'snippet');
        return (
          <div
            key={it.id}
            style={{
              position: 'absolute',
              left: (it.x - bounds.minX) * s,
              top: (it.y - bounds.minY) * s,
              width: Math.max(2, (it.width || 240) * s),
              height: Math.max(2, 100 * s),
              background: TYPE_COLORS[type] || '#9CA3AF',
              borderRadius: 1,
              opacity: 0.7,
            }}
          />
        );
      })}

      {/* Viewport rectangle */}
      <div
        style={{
          position: 'absolute',
          left: vpRectX,
          top: vpRectY,
          width: vpRectW,
          height: vpRectH,
          border: '1.5px solid rgba(74,158,142,0.6)',
          borderRadius: 2,
          background: 'rgba(74,158,142,0.05)',
        }}
      />
    </div>
  );
}

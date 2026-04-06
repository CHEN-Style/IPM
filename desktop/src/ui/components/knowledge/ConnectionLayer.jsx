import React, { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

export default function ConnectionLayer({
  connections = [],
  items = [],
  groups = [],
  selectedIds = new Set(),
  onRemoveConnection,
  readOnly = false,
  highlightedIds,
  highlightAnchor,
  filterMatchIds,
  viewerMode = false,
}) {
  const [hoveredConn, setHoveredConn] = useState(null);
  const [activeConn, setActiveConn] = useState(null);

  const entityMap = useMemo(() => {
    const m = {};
    for (const it of items) m[it.id] = { ...it, _entityType: 'item' };
    for (const g of groups) m[g.id] = { ...g, _entityType: 'group' };
    return m;
  }, [items, groups]);

  if (connections.length === 0) return null;

  function getCenter(entity) {
    if (!entity) return null;
    if (entity._entityType === 'group') {
      return { x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 };
    }
    return { x: entity.x + (entity.width || 240) / 2, y: entity.y + 75 };
  }

  function getConnStyle(fromEntity, toEntity) {
    const hasGroup = fromEntity?._entityType === 'group' || toEntity?._entityType === 'group';
    if (hasGroup) {
      return { color: '#4a9e8e', dash: '8 5', width: 2.5, endR: 5, opacity: 0.6 };
    }
    return { color: '#e8a0a0', dash: '6 4', width: 2, endR: 3, opacity: 0.7 };
  }

  return (
    <>
      <svg
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: 1, overflow: 'visible',
        }}
      >
        <defs>
          <filter id="rope-shadow">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="rgba(0,0,0,0.06)" />
          </filter>
          <filter id="teal-shadow">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(74,158,142,0.12)" />
          </filter>
        </defs>
        {connections.map((conn) => {
          const fromEntity = entityMap[conn.from_item_id];
          const toEntity = entityMap[conn.to_item_id];
          const p1 = getCenter(fromEntity);
          const p2 = getCenter(toEntity);
          if (!p1 || !p2) return null;

          const style = getConnStyle(fromEntity, toEntity);
          const hasGroup = fromEntity?._entityType === 'group' || toEntity?._entityType === 'group';

          const midX = (p1.x + p2.x) / 2;
          const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
          const sag = hasGroup ? Math.min(dist * 0.15, 50) : Math.min(dist * 0.25, 80);
          const midY = Math.max(p1.y, p2.y) + sag;

          const pathD = `M ${p1.x} ${p1.y} Q ${midX} ${midY} ${p2.x} ${p2.y}`;
          const isHovered = hoveredConn === conn.id;
          const isActive = activeConn === conn.id;
          const filterUrl = hasGroup ? 'url(#teal-shadow)' : 'url(#rope-shadow)';

          const hlSet = highlightedIds || new Set();
          const hlActive = hlSet.size > 0;
          const connHighlighted = hlActive && hlSet.has(conn.from_item_id) && hlSet.has(conn.to_item_id);
          const connFilterMatch = filterMatchIds ? (filterMatchIds.has(conn.from_item_id) || filterMatchIds.has(conn.to_item_id)) : true;

          let connOpacity = isActive ? 1 : isHovered ? 1 : style.opacity;
          if (viewerMode && hlActive && !connHighlighted) connOpacity = 0.08;
          if (viewerMode && filterMatchIds && !connFilterMatch) connOpacity = 0.08;

          return (
            <g key={conn.id}>
              <path
                d={pathD}
                fill="none"
                stroke={connHighlighted && viewerMode ? '#4a9e8e' : style.color}
                strokeWidth={connHighlighted && viewerMode ? style.width + 1.5 : isActive ? style.width + 1 : isHovered ? style.width + 1 : style.width}
                strokeLinecap="round"
                strokeDasharray={connHighlighted && viewerMode ? 'none' : isActive ? 'none' : isHovered ? 'none' : style.dash}
                style={{
                  filter: filterUrl,
                  opacity: connOpacity,
                  transition: 'stroke-width 0.3s, opacity 0.3s, stroke 0.3s',
                }}
              />
              {!readOnly && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredConn(conn.id)}
                  onMouseLeave={() => setHoveredConn(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveConn((prev) => (prev === conn.id ? null : conn.id));
                  }}
                />
              )}
              {/* Endpoint nodes */}
              <circle cx={p1.x} cy={p1.y} r={style.endR} fill={style.color} opacity={0.5} />
              <circle cx={p2.x} cy={p2.y} r={style.endR} fill={style.color} opacity={0.5} />
              {/* Diamond markers for group endpoints */}
              {fromEntity?._entityType === 'group' && (
                <rect x={p1.x - 4} y={p1.y - 4} width={8} height={8} rx={1}
                  fill={style.color} opacity={0.4}
                  transform={`rotate(45 ${p1.x} ${p1.y})`} />
              )}
              {toEntity?._entityType === 'group' && (
                <rect x={p2.x - 4} y={p2.y - 4} width={8} height={8} rx={1}
                  fill={style.color} opacity={0.4}
                  transform={`rotate(45 ${p2.x} ${p2.y})`} />
              )}
            </g>
          );
        })}
      </svg>

      {/* Delete icon for active connection */}
      {activeConn && (() => {
        const conn = connections.find((c) => c.id === activeConn);
        if (!conn) return null;
        const fromEntity = entityMap[conn.from_item_id];
        const toEntity = entityMap[conn.to_item_id];
        const p1 = getCenter(fromEntity);
        const p2 = getCenter(toEntity);
        if (!p1 || !p2) return null;

        const hasGroup = fromEntity?._entityType === 'group' || toEntity?._entityType === 'group';
        const midX = (p1.x + p2.x) / 2;
        const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
        const sag = hasGroup ? Math.min(dist * 0.15, 50) : Math.min(dist * 0.25, 80);
        const midY = Math.max(p1.y, p2.y) + sag;
        const btnY = midY * 0.75 + Math.max(p1.y, p2.y) * 0.25;

        return (
          <div
            style={{
              position: 'absolute', left: midX - 14, top: btnY + 6,
              width: 28, height: 28, background: 'white',
              border: '1.5px solid rgba(239,68,68,0.4)', borderRadius: '50%',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)', zIndex: 5, pointerEvents: 'auto',
              transition: 'transform 0.15s',
            }}
            className="animate-fadeIn"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveConnection?.(activeConn);
              setActiveConn(null);
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
          >
            <Trash2 size={12} color="#ef4444" />
          </div>
        );
      })()}
    </>
  );
}

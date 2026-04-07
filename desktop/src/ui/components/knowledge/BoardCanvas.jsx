import React, { useRef, useState, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { RotateCw, Trash2, SquareArrowOutUpRight, Lock, Unlock, Link2, Link2Off } from 'lucide-react';
import BoardCard from './BoardCard.jsx';
import ConnectionLayer from './ConnectionLayer.jsx';
import GroupFrame from './GroupFrame.jsx';
import TimelineStrip from './TimelineStrip.jsx';
import Minimap from './Minimap.jsx';

const MIN_SIZE = 120;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.001;

const BoardCanvas = forwardRef(function BoardCanvas({
  items = [],
  onLayoutChange,
  onRemoveItem,
  onEditCard,
  onLockItem,
  onUnlockItem,
  readOnly = false,
  isMain = false,
  connections = [],
  onAddConnection,
  onRemoveConnection,
  groups = [],
  onCreateGroup,
  onUpdateGroup,
  onRequestGroupDeleteConfirm,
  onConvertGroupToBoard,
  onToggleGroupLock,
  onShowToast,
  bgStyle = 'grid',
  bgColor = '',
  viewportState,
  onViewportChange,
  undoRedoRef,
  viewerMode = false,
  onViewerDoubleClick,
  timelines = [],
  onUpdateTimeline,
  onDeleteTimeline,
  onAddTimelinePoint,
  onUpdateTimelinePoint,
  onDeleteTimelinePoint,
}, ref) {
  const canvasRef = useRef(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState(new Set());
  const dragRef = useRef(null);
  const rotateRef = useRef(null);
  const resizeRef = useRef(null);
  const panRef = useRef(null);
  const viewerClickRef = useRef({ time: 0, id: null });
  const zCounterRef = useRef(100);
  const [localItems, setLocalItems] = useState([]);
  const [localGroups, setLocalGroups] = useState([]);
  const [localTimelines, setLocalTimelines] = useState([]);

  const [viewportX, setViewportX] = useState(viewportState?.x ?? 0);
  const [viewportY, setViewportY] = useState(viewportState?.y ?? 0);
  const [scale, setScale] = useState(viewportState?.scale ?? 1);
  const [spaceDown, setSpaceDown] = useState(false);

  const [marquee, setMarquee] = useState(null);
  const marqueeRef = useRef(null);

  const totalSelected = selectedIds.size + selectedGroupIds.size;
  const effectiveReadOnly = readOnly || viewerMode;
  const enablePanZoom = isMain && (!readOnly || viewerMode);

  const [highlightedIds, setHighlightedIds] = useState(new Set());
  const [highlightAnchor, setHighlightAnchor] = useState(null);
  const [filterMatchIds, setFilterMatchIds] = useState(null);

  useEffect(() => {
    setLocalItems((prev) => {
      const prevMap = {};
      for (const it of prev) prevMap[it.id] = it;
      return items.map((it, i) => {
        const local = prevMap[it.id];
        if (local) {
          const propsGroupId = it.group_id ?? null;
          const localGroupId = local.group_id ?? null;
          if (propsGroupId !== localGroupId) {
            return {
              ...it, rotation: it.rotation ?? 0, width: it.width ?? 240,
              height: it.height ?? null, z_index: it.z_index ?? i,
              locked: it.locked ?? 0, group_id: propsGroupId,
            };
          }
          return { ...local, locked: it.locked ?? 0, group_id: propsGroupId };
        }
        return {
          ...it, x: it.x ?? 100, y: it.y ?? 100, rotation: it.rotation ?? 0,
          width: it.width ?? 240, height: it.height ?? null,
          z_index: it.z_index ?? i, locked: it.locked ?? 0, group_id: it.group_id ?? null,
        };
      });
    });
  }, [items]);

  useEffect(() => {
    setLocalGroups(groups.map((g) => ({ ...g })));
  }, [groups]);

  useEffect(() => {
    setLocalTimelines(timelines.map((t) => ({ ...t })));
  }, [timelines]);

  useEffect(() => {
    if (onViewportChange && enablePanZoom) {
      onViewportChange({ x: viewportX, y: viewportY, scale });
    }
  }, [viewportX, viewportY, scale]);

  const groupsMap = useMemo(() => {
    const m = {};
    for (const g of localGroups) m[g.id] = g;
    return m;
  }, [localGroups]);

  const absItems = useMemo(() => {
    return localItems.map((it) => {
      const g = it.group_id ? groupsMap[it.group_id] : null;
      if (!g) return it;
      return { ...it, x: g.x + it.x, y: g.y + it.y };
    });
  }, [localItems, groupsMap]);

  const isGroupLocked = useCallback((groupId) => {
    return !!groupsMap[groupId]?.locked;
  }, [groupsMap]);

  const isItemEffectivelyLocked = useCallback((item) => {
    if (item.group_id && isGroupLocked(item.group_id)) return true;
    if (!item.group_id && item.locked) return true;
    return false;
  }, [isGroupLocked]);

  const smoothAnimRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focusOnRegion({ x, y, width, height }, smooth = false) {
      if (!enablePanZoom) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const padding = 60;
      const fitScaleX = (rect.width - padding * 2) / width;
      const fitScaleY = (rect.height - padding * 2) / height;
      const fitScale = Math.min(fitScaleX, fitScaleY, ZOOM_MAX);
      const clampedScale = Math.max(ZOOM_MIN, fitScale);
      const cx = x + width / 2;
      const cy = y + height / 2;
      const targetVpX = rect.width / 2 - cx * clampedScale;
      const targetVpY = rect.height / 2 - cy * clampedScale;

      if (!smooth) {
        setScale(clampedScale);
        setViewportX(targetVpX);
        setViewportY(targetVpY);
        return;
      }

      if (smoothAnimRef.current) cancelAnimationFrame(smoothAnimRef.current);
      const startVpX = viewportX, startVpY = viewportY, startScale = scale;
      const duration = 600;
      const startTime = performance.now();
      const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      function animate(now) {
        const elapsed = now - startTime;
        const t = easeInOutCubic(Math.min(elapsed / duration, 1));
        setViewportX(startVpX + (targetVpX - startVpX) * t);
        setViewportY(startVpY + (targetVpY - startVpY) * t);
        setScale(startScale + (clampedScale - startScale) * t);
        if (elapsed < duration) smoothAnimRef.current = requestAnimationFrame(animate);
        else smoothAnimRef.current = null;
      }
      smoothAnimRef.current = requestAnimationFrame(animate);
    },
    getViewportCenter() {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 200, y: 200 };
      const rect = canvas.getBoundingClientRect();
      if (enablePanZoom) {
        return {
          x: (rect.width / 2 - viewportX) / scale,
          y: (rect.height / 2 - viewportY) / scale,
        };
      }
      return { x: rect.width / 2, y: rect.height / 2 };
    },
    setFilterMatchIds(ids) { setFilterMatchIds(ids); },
    clearHighlights() { setHighlightedIds(new Set()); setHighlightAnchor(null); },
  }), [enablePanZoom, viewportX, viewportY, scale]);

  const updateLocalItem = useCallback((id, patch) => {
    setLocalItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const flushLayout = useCallback(() => {
    if (!onLayoutChange || effectiveReadOnly) return;
    setLocalItems((current) => {
      const payload = current.map((it) => ({
        id: it.id, x: it.x, y: it.y, rotation: it.rotation,
        width: it.width, height: it.height, zIndex: it.z_index, groupId: it.group_id,
      }));
      onLayoutChange(payload);
      return current;
    });
  }, [onLayoutChange, effectiveReadOnly]);

  const screenToCanvas = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (enablePanZoom) {
      return {
        x: (clientX - rect.left - viewportX) / scale,
        y: (clientY - rect.top - viewportY) / scale,
      };
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, [enablePanZoom, viewportX, viewportY, scale]);

  const handlePointerDown = useCallback((e, itemId, mode) => {
    if (effectiveReadOnly) return;
    e.preventDefault();
    e.stopPropagation();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const item = localItems.find((it) => it.id === itemId);
    if (!item) return;

    const effectivelyLocked = isItemEffectivelyLocked(item);
    if (effectivelyLocked && mode !== 'select') return;

    const canvasCoord = screenToCanvas(e.clientX, e.clientY);

    if (e.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
        return next;
      });
      return;
    }

    if (!selectedIds.has(itemId)) {
      setSelectedIds(new Set([itemId]));
      setSelectedGroupIds(new Set());
    }

    zCounterRef.current += 1;
    updateLocalItem(itemId, { z_index: zCounterRef.current });

    if (mode === 'rotate') {
      const el = canvas.querySelector(`[data-board-item="${itemId}"]`);
      if (!el) return;
      const g = item.group_id ? groupsMap[item.group_id] : null;
      const absX = g ? g.x + item.x : item.x;
      const absY = g ? g.y + item.y : item.y;
      const cx = absX + (el.offsetWidth || item.width) / 2;
      const cy = absY + (el.offsetHeight || 150) / 2;
      const startPointerAngle = Math.atan2(canvasCoord.y - cy, canvasCoord.x - cx) * 180 / Math.PI;
      rotateRef.current = { itemId, cx, cy, startAngle: item.rotation, startPointerAngle };
    } else if (mode?.startsWith('resize-')) {
      const dir = mode.replace('resize-', '');
      const el = canvas.querySelector(`[data-board-item="${itemId}"]`);
      resizeRef.current = {
        itemId, dir,
        startW: el?.offsetWidth || item.width,
        startH: el?.offsetHeight || 200,
        startX: item.x, startY: item.y,
        px: canvasCoord.x, py: canvasCoord.y,
      };
    } else if (mode === 'drag') {
      const draggingIds = selectedIds.has(itemId) ? selectedIds : new Set([itemId]);
      const startPositions = {};
      for (const id of draggingIds) {
        const it = localItems.find((i) => i.id === id);
        if (it && !isItemEffectivelyLocked(it)) startPositions[id] = { x: it.x, y: it.y };
      }
      dragRef.current = { itemId, draggingIds, startPositions, px: canvasCoord.x, py: canvasCoord.y };
    }

    const target = e.currentTarget;
    if (target?.setPointerCapture) target.setPointerCapture(e.pointerId);
  }, [effectiveReadOnly, localItems, updateLocalItem, selectedIds, screenToCanvas, groupsMap, isItemEffectivelyLocked]);

  const handlePointerMove = useCallback((e) => {
    const canvasCoord = screenToCanvas(e.clientX, e.clientY);

    if (panRef.current) {
      const dx = e.clientX - panRef.current.lastX;
      const dy = e.clientY - panRef.current.lastY;
      panRef.current.lastX = e.clientX;
      panRef.current.lastY = e.clientY;
      setViewportX((v) => v + dx);
      setViewportY((v) => v + dy);
      return;
    }

    if (marqueeRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      setMarquee({ ...marqueeRef.current, x2: e.clientX - rect.left, y2: e.clientY - rect.top });
      return;
    }

    if (dragRef.current) {
      const { draggingIds, startPositions, px, py } = dragRef.current;
      const dx = canvasCoord.x - px;
      const dy = canvasCoord.y - py;
      setLocalItems((prev) => prev.map((it) => {
        if (draggingIds.has(it.id) && startPositions[it.id]) {
          return { ...it, x: startPositions[it.id].x + dx, y: startPositions[it.id].y + dy };
        }
        return it;
      }));
      return;
    }

    if (rotateRef.current) {
      const { itemId, cx, cy, startAngle, startPointerAngle } = rotateRef.current;
      const angle = Math.atan2(canvasCoord.y - cy, canvasCoord.x - cx) * 180 / Math.PI;
      const delta = angle - startPointerAngle;
      updateLocalItem(itemId, { rotation: Math.round((startAngle + delta) * 10) / 10 });
    }

    if (resizeRef.current) {
      const { itemId, dir, startW, startH, startX, startY, px, py } = resizeRef.current;
      const rdx = canvasCoord.x - px;
      const rdy = canvasCoord.y - py;
      let nw = startW, nh = startH, nx = startX, ny = startY;
      if (dir === 'se') { nw = Math.max(MIN_SIZE, startW + rdx); nh = Math.max(MIN_SIZE, startH + rdy); }
      else if (dir === 'sw') { nw = Math.max(MIN_SIZE, startW - rdx); nh = Math.max(MIN_SIZE, startH + rdy); if (nw > MIN_SIZE) nx = startX + rdx; }
      else if (dir === 'ne') { nw = Math.max(MIN_SIZE, startW + rdx); nh = Math.max(MIN_SIZE, startH - rdy); if (nh > MIN_SIZE) ny = startY + rdy; }
      else if (dir === 'nw') { nw = Math.max(MIN_SIZE, startW - rdx); nh = Math.max(MIN_SIZE, startH - rdy); if (nw > MIN_SIZE) nx = startX + rdx; if (nh > MIN_SIZE) ny = startY + rdy; }
      updateLocalItem(itemId, { width: nw, height: nh, x: nx, y: ny });
    }
  }, [updateLocalItem, screenToCanvas]);

  const handlePointerUp = useCallback((e) => {
    if (marqueeRef.current && marquee) {
      const canvas = canvasRef.current;
      if (canvas) {
        const mx1 = Math.min(marquee.x1, marquee.x2);
        const my1 = Math.min(marquee.y1, marquee.y2);
        const mx2 = Math.max(marquee.x1, marquee.x2);
        const my2 = Math.max(marquee.y1, marquee.y2);

        let cx1, cy1, cx2, cy2;
        if (enablePanZoom) {
          cx1 = (mx1 - viewportX) / scale; cy1 = (my1 - viewportY) / scale;
          cx2 = (mx2 - viewportX) / scale; cy2 = (my2 - viewportY) / scale;
        } else {
          cx1 = mx1; cy1 = my1; cx2 = mx2; cy2 = my2;
        }

        const hits = new Set();
        for (const item of absItems) {
          const itemCx = item.x + (item.width || 240) / 2;
          const itemCy = item.y + 75;
          if (itemCx >= cx1 && itemCx <= cx2 && itemCy >= cy1 && itemCy <= cy2) hits.add(item.id);
        }
        if (hits.size > 0) {
          setSelectedIds((prev) => {
            if (e.shiftKey) { const next = new Set(prev); for (const id of hits) next.add(id); return next; }
            return hits;
          });
        }
      }
      marqueeRef.current = null;
      setMarquee(null);
      return;
    }

    if (panRef.current) { panRef.current = null; return; }

    const hadInteraction = dragRef.current || rotateRef.current || resizeRef.current;

    if (dragRef.current) {
      const { draggingIds } = dragRef.current;
      let blockedByLockedGroup = false;
      setLocalItems((prev) => {
        return prev.map((it) => {
          if (!draggingIds.has(it.id)) return it;
          const oldGroup = it.group_id ? groupsMap[it.group_id] : null;
          let absX = it.x, absY = it.y;
          if (oldGroup) { absX = oldGroup.x + it.x; absY = oldGroup.y + it.y; }

          const cx = absX + (it.width || 240) / 2;
          const cy = absY + 75;

          let newGroupId = null;
          let newGroup = null;
          for (const g of localGroups) {
            if (cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height) {
              if (g.locked) { blockedByLockedGroup = true; break; }
              newGroupId = g.id; newGroup = g; break;
            }
          }

          if (it.group_id === newGroupId) return it;
          if (newGroup) {
            return { ...it, x: absX - newGroup.x, y: absY - newGroup.y, group_id: newGroupId };
          } else {
            return { ...it, x: absX, y: absY, group_id: null };
          }
        });
      });
      if (blockedByLockedGroup) {
        onShowToast?.('该分组已锁定，无法拖入卡片');
      }
    }

    dragRef.current = null;
    rotateRef.current = null;
    resizeRef.current = null;
    if (hadInteraction) flushLayout();
  }, [flushLayout, marquee, enablePanZoom, viewportX, viewportY, scale, absItems, localGroups, groupsMap]);

  const handleCanvasPointerDown = useCallback((e) => {
    const isBlank = e.target === canvasRef.current
      || e.target.classList?.contains('wabi-bg')
      || e.target.classList?.contains('wabi-inner-layer');
    if (!isBlank) return;

    if (enablePanZoom && (spaceDown || e.button === 1 || viewerMode)) {
      e.preventDefault();
      panRef.current = { lastX: e.clientX, lastY: e.clientY };
      if (viewerMode) {
        setHighlightedIds(new Set());
        setHighlightAnchor(null);
      }
      return;
    }

    if (effectiveReadOnly) return;

    if (e.button === 0) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      marqueeRef.current = { x1: sx, y1: sy };
      setMarquee({ x1: sx, y1: sy, x2: sx, y2: sy });
      if (!e.shiftKey) {
        setSelectedIds(new Set());
        setSelectedGroupIds(new Set());
      }
    }
  }, [effectiveReadOnly, enablePanZoom, spaceDown, viewerMode]);

  const handleCanvasClick = useCallback((e) => {
    const isBlank = e.target === canvasRef.current
      || e.target.classList?.contains('wabi-bg')
      || e.target.classList?.contains('wabi-inner-layer');
    if (isBlank && !marqueeRef.current) {
      setSelectedIds(new Set());
      setSelectedGroupIds(new Set());
      if (viewerMode) {
        setHighlightedIds(new Set());
        setHighlightAnchor(null);
      }
    }
  }, [viewerMode]);

  const handleWheel = useCallback((e) => {
    if (!enablePanZoom) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setScale((prev) => {
      const delta = -e.deltaY * ZOOM_STEP;
      const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev + delta));
      const ratio = newScale / prev;
      setViewportX((vx) => mx - (mx - vx) * ratio);
      setViewportY((vy) => my - (my - vy) * ratio);
      return newScale;
    });
  }, [enablePanZoom]);

  // Group shift-click selection
  const handleGroupShiftClick = useCallback((groupId) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleViewerClick = useCallback((entityId) => {
    if (!viewerMode) return;
    const connected = new Set([entityId]);
    for (const c of connections) {
      if (c.from_item_id === entityId) connected.add(c.to_item_id);
      if (c.to_item_id === entityId) connected.add(c.from_item_id);
    }
    setHighlightedIds(connected);
    setHighlightAnchor(entityId);
  }, [viewerMode, connections]);

  // Keyboard shortcuts
  useEffect(() => {
    if (effectiveReadOnly) return;
    const handleKeyDown = (e) => {
      const canvas = canvasRef.current;
      if (!canvas || !canvas.contains(document.activeElement) && document.activeElement !== canvas) return;

      if (e.key === ' ') { e.preventDefault(); setSpaceDown(true); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        for (const id of selectedIds) onRemoveItem?.(id);
        setSelectedIds(new Set());
      }
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedIds(new Set(localItems.map((it) => it.id)));
      }
      if (e.key === 'Escape') {
        setSelectedIds(new Set());
        setSelectedGroupIds(new Set());
      }
      if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedIds.size > 0) {
          const freeSelected = [...selectedIds].filter((sid) => {
            const it = localItems.find((i) => i.id === sid);
            return it && !it.group_id;
          });
          const groupedCount = selectedIds.size - freeSelected.length;
          if (groupedCount > 0) {
            onShowToast?.('组内卡片无法单独锁定，请在分组标题栏锁定整个分组');
          }
          if (freeSelected.length > 0) {
            const allLocked = freeSelected.every((sid) => {
              const it = localItems.find((i) => i.id === sid);
              return it?.locked;
            });
            if (allLocked) {
              for (const id of freeSelected) onUnlockItem?.(id);
            } else {
              for (const id of freeSelected) {
                const item = localItems.find((it) => it.id === id);
                if (!item?.locked) onLockItem?.(id);
              }
            }
          }
        }
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault(); undoRedoRef?.current?.undo?.();
      }
      if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault(); undoRedoRef?.current?.redo?.();
      }
    };
    const handleKeyUp = (e) => { if (e.key === ' ') setSpaceDown(false); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [effectiveReadOnly, selectedIds, localItems, onRemoveItem, onLockItem, onUnlockItem, undoRedoRef]);

  // Connection logic — supports mixed item/group endpoints
  const allSelectedEntities = useMemo(() => [...selectedIds, ...selectedGroupIds], [selectedIds, selectedGroupIds]);

  const existingConnectionBetweenSelected = useMemo(() => {
    if (allSelectedEntities.length !== 2) return null;
    const [a, b] = allSelectedEntities;
    return connections.find(
      (c) => (c.from_item_id === a && c.to_item_id === b) || (c.from_item_id === b && c.to_item_id === a)
    ) || null;
  }, [allSelectedEntities, connections]);

  const handleConnectSelected = useCallback(() => {
    if (allSelectedEntities.length !== 2) return;
    const [a, b] = allSelectedEntities;
    if (existingConnectionBetweenSelected) {
      onRemoveConnection?.(existingConnectionBetweenSelected.id);
    } else {
      onAddConnection?.(a, b);
    }
  }, [allSelectedEntities, onAddConnection, onRemoveConnection, existingConnectionBetweenSelected]);

  // Lock logic — only free items (not in group)
  const lockableSelected = useMemo(() => {
    return [...selectedIds].filter((id) => {
      const it = localItems.find((i) => i.id === id);
      return it && !it.group_id;
    });
  }, [selectedIds, localItems]);

  const allLockableLocked = useMemo(() => {
    if (lockableSelected.length === 0) return false;
    return lockableSelected.every((id) => {
      const it = localItems.find((i) => i.id === id);
      return it?.locked;
    });
  }, [lockableSelected, localItems]);

  const handleLockSelected = useCallback(() => {
    if (lockableSelected.length === 0) {
      onShowToast?.('组内卡片无法单独锁定，请在分组标题栏锁定整个分组');
      return;
    }
    if (allLockableLocked) {
      for (const id of lockableSelected) onUnlockItem?.(id);
    } else {
      for (const id of lockableSelected) {
        const item = localItems.find((it) => it.id === id);
        if (!item?.locked) onLockItem?.(id);
      }
    }
  }, [lockableSelected, localItems, onLockItem, onUnlockItem, allLockableLocked, onShowToast]);

  const handleDeleteSelected = useCallback(() => {
    for (const id of selectedIds) onRemoveItem?.(id);
    setSelectedIds(new Set());
  }, [selectedIds, onRemoveItem]);

  // Local group handlers
  const handleLocalGroupUpdate = useCallback((groupId, patch) => {
    setLocalGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, ...patch } : g));
    if ('name' in patch || 'frame_style' in patch) onUpdateGroup?.(groupId, patch);
  }, [onUpdateGroup]);

  const handleGroupDragEnd = useCallback((groupId) => {
    const g = localGroups.find((gr) => gr.id === groupId);
    if (g) onUpdateGroup?.(groupId, { x: g.x, y: g.y, width: g.width, height: g.height, name: g.name, frame_style: g.frame_style });
  }, [localGroups, onUpdateGroup]);

  // Background
  const bgElement = useMemo(() => {
    const style = bgStyle || 'grid';
    const color = bgColor || '#F9F8F4';
    if (style === 'dots') {
      return <div className="wabi-bg wabi-dots-bg" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundSize: '20px 20px', backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.15) 1px, transparent 1px)', backgroundColor: color }} />;
    }
    if (style === 'blank') {
      return <div className="wabi-bg" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundColor: color }} />;
    }
    if (style === 'color') {
      return <div className="wabi-bg" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundColor: color || '#F9F8F4' }} />;
    }
    return <div className="wabi-bg wabi-grid-bg" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, backgroundSize: '40px 40px', backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)', backgroundColor: color }} />;
  }, [bgStyle, bgColor]);

  return (
    <div
      ref={canvasRef}
      className="wabi-canvas"
      tabIndex={0}
      style={{
        flex: 1, position: 'relative', overflow: 'hidden',
        background: bgColor || '#F9F8F4',
        cursor: viewerMode ? (panRef.current ? 'grabbing' : 'grab') : (spaceDown ? 'grab' : (panRef.current ? 'grabbing' : 'default')),
        isolation: 'isolate', outline: 'none',
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerDown={handleCanvasPointerDown}
      onClick={handleCanvasClick}
      onWheel={handleWheel}
    >
      {bgElement}

      <div
        className="wabi-inner-layer"
        style={{
          position: 'absolute', top: 0, left: 0,
          transformOrigin: '0 0',
          transform: enablePanZoom ? `translate(${viewportX}px, ${viewportY}px) scale(${scale})` : undefined,
          width: enablePanZoom ? '10000px' : '100%',
          height: enablePanZoom ? '10000px' : '100%',
          pointerEvents: 'none',
        }}
      >
        {/* Group frames */}
        {localGroups.map((g) => (
          <GroupFrame
            key={g.id}
            group={g}
            readOnly={effectiveReadOnly}
            scale={enablePanZoom ? scale : 1}
            isSelected={selectedGroupIds.has(g.id)}
            onUpdate={(patch) => handleLocalGroupUpdate(g.id, patch)}
            onDragEnd={() => handleGroupDragEnd(g.id)}
            onRequestDeleteConfirm={!g.locked && !viewerMode ? (() => onRequestGroupDeleteConfirm?.(g.id)) : undefined}
            onConvertToBoard={!g.locked && !viewerMode ? (() => onConvertGroupToBoard?.(g.id)) : undefined}
            onToggleLock={!viewerMode ? (() => onToggleGroupLock?.(g.id, !g.locked)) : undefined}
            onShiftClick={() => handleGroupShiftClick(g.id)}
            viewerMode={viewerMode}
            highlightState={highlightedIds.size > 0 ? (highlightAnchor === g.id ? 'anchor' : highlightedIds.has(g.id) ? 'connected' : 'dimmed') : (filterMatchIds ? (filterMatchIds.has(g.id) ? 'normal' : 'filter-dimmed') : 'normal')}
            onViewerClick={viewerMode ? (() => handleViewerClick(g.id)) : undefined}
          />
        ))}

        {/* Timelines */}
        {localTimelines.map((tl) => (
          <TimelineStrip
            key={tl.id}
            timeline={tl}
            scale={enablePanZoom ? scale : 1}
            readOnly={effectiveReadOnly}
            viewerMode={viewerMode}
            onUpdate={onUpdateTimeline}
            onDelete={onDeleteTimeline}
            onAddPoint={onAddTimelinePoint}
            onUpdatePoint={onUpdateTimelinePoint}
            onDeletePoint={onDeleteTimelinePoint}
          />
        ))}

        {/* Connections — pass both items and groups for mixed endpoints */}
        <ConnectionLayer
          connections={connections}
          items={absItems}
          groups={localGroups}
          selectedIds={selectedIds}
          onRemoveConnection={onRemoveConnection}
          readOnly={effectiveReadOnly}
          highlightedIds={highlightedIds}
          highlightAnchor={highlightAnchor}
          filterMatchIds={filterMatchIds}
          viewerMode={viewerMode}
        />

        {/* Cards */}
        {localItems.map((item) => {
          const isSelected = selectedIds.has(item.id) && !effectiveReadOnly;
          const isDragging = dragRef.current?.draggingIds?.has(item.id);
          const inGroup = !!item.group_id;
          const groupLocked = inGroup && isGroupLocked(item.group_id);
          const effectivelyLocked = isItemEffectivelyLocked(item);
          const showHandles = isSelected && !effectiveReadOnly && !effectivelyLocked;
          const g = item.group_id ? groupsMap[item.group_id] : null;
          const renderX = g ? g.x + item.x : item.x;
          const renderY = g ? g.y + item.y : item.y;
          return (
            <div
              key={item.id}
              data-board-item={item.id}
              style={{
                position: 'absolute', left: renderX, top: renderY,
                width: item.width,
                height: item.height || undefined,
                maxHeight: item.height ? undefined : 360,
                transform: `rotate(${item.rotation}deg)`,
                zIndex: item.z_index,
                cursor: effectiveReadOnly ? (viewerMode ? 'pointer' : 'default') : (effectivelyLocked ? 'default' : isDragging ? 'grabbing' : 'grab'),
                touchAction: 'none',
                transition: isDragging ? 'none' : 'box-shadow 0.2s ease',
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => {
                if (viewerMode) return;
                if (e.target.closest('.wabi-handle')) return;
                handlePointerDown(e, item.id, effectivelyLocked ? 'select' : 'drag');
              }}
              onClick={viewerMode ? ((e) => {
                e.stopPropagation();
                const now = Date.now();
                if (now - viewerClickRef.current.time < 400 && viewerClickRef.current.id === item.id) {
                  viewerClickRef.current = { time: 0, id: null };
                  onViewerDoubleClick?.(item);
                  return;
                }
                viewerClickRef.current = { time: now, id: item.id };
                handleViewerClick(item.id);
              }) : undefined}
            >
              {/* Viewer mode highlight styles */}
              {viewerMode && highlightedIds.size > 0 && (
                <div style={{
                  position: 'absolute', inset: -2, borderRadius: 10, pointerEvents: 'none', zIndex: -1,
                  border: highlightAnchor === item.id ? '2px solid #4a9e8e' : highlightedIds.has(item.id) ? '2px solid rgba(74,158,142,0.4)' : 'none',
                  boxShadow: highlightAnchor === item.id ? '0 0 12px rgba(74,158,142,0.3)' : highlightedIds.has(item.id) ? '0 0 8px rgba(74,158,142,0.15)' : 'none',
                  transition: 'all 0.3s ease',
                }} />
              )}
              <div style={{
                height: '100%', overflow: 'hidden',
                opacity: viewerMode && highlightedIds.size > 0 && !highlightedIds.has(item.id) && highlightAnchor !== item.id ? 0.25
                  : viewerMode && filterMatchIds && !filterMatchIds.has(item.id) ? 0.15
                  : 1,
                filter: viewerMode && filterMatchIds && !filterMatchIds.has(item.id) ? 'grayscale(0.5)' : 'none',
                transition: 'opacity 0.3s ease, filter 0.3s ease',
              }}>
                <BoardCard item={item} isSelected={isSelected} isDragging={isDragging} readOnly={effectiveReadOnly} />
              </div>

              {/* Lock indicator for free locked items */}
              {!inGroup && item.locked && (
                <div style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 18, height: 18, borderRadius: 4,
                  background: 'rgba(0,0,0,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <Lock size={10} color="#9CA3AF" />
                </div>
              )}

              {showHandles && (
                <>
                  {onEditCard && item.knowledge && (
                    <div
                      className="wabi-handle"
                      style={{
                        position: 'absolute', top: '50%', left: -16,
                        transform: 'translateY(-50%)',
                        width: 26, height: 26, background: 'white',
                        border: '1.5px solid rgba(74,158,142,0.6)', borderRadius: '50%',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                      }}
                      onClick={(e) => { e.stopPropagation(); onEditCard(item); }}
                      title="跳转编辑"
                    >
                      <SquareArrowOutUpRight size={11} color="#4a9e8e" />
                    </div>
                  )}

                  <div
                    className="wabi-handle"
                    style={{
                      position: 'absolute', bottom: -28, left: '50%', transform: 'translateX(-50%)',
                      width: 24, height: 24, background: 'white',
                      border: '1.5px solid rgba(74,158,142,0.6)', borderRadius: '50%',
                      cursor: 'crosshair', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      zIndex: 10,
                    }}
                    onPointerDown={(e) => handlePointerDown(e, item.id, 'rotate')}
                  >
                    <RotateCw size={11} color="#4a9e8e" />
                  </div>

                  {['se', 'sw', 'ne', 'nw'].map((dir) => (
                    <div
                      key={dir}
                      className="wabi-handle"
                      style={{
                        position: 'absolute', width: 10, height: 10,
                        background: 'white', border: '1.5px solid rgba(74,158,142,0.6)', borderRadius: 2,
                        zIndex: 10,
                        ...(dir === 'se' ? { bottom: -5, right: -5, cursor: 'se-resize' } : {}),
                        ...(dir === 'sw' ? { bottom: -5, left: -5, cursor: 'sw-resize' } : {}),
                        ...(dir === 'ne' ? { top: -5, right: -5, cursor: 'ne-resize' } : {}),
                        ...(dir === 'nw' ? { top: -5, left: -5, cursor: 'nw-resize' } : {}),
                      }}
                      onPointerDown={(e) => handlePointerDown(e, item.id, `resize-${dir}`)}
                    />
                  ))}

                  {onRemoveItem && !groupLocked && (
                    <div
                      className="wabi-handle"
                      style={{
                        position: 'absolute', top: -12, right: -12,
                        width: 24, height: 24, background: 'white',
                        border: '1.5px solid rgba(239,68,68,0.4)', borderRadius: '50%',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 10,
                      }}
                      onClick={(e) => { e.stopPropagation(); onRemoveItem(item.id); }}
                    >
                      <Trash2 size={11} color="#ef4444" />
                    </div>
                  )}

                  <div style={{
                    position: 'absolute', bottom: -44, left: '50%', transform: 'translateX(-50%)',
                    whiteSpace: 'nowrap', fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: 9, letterSpacing: '0.12em', color: 'rgba(74,158,142,0.8)',
                    pointerEvents: 'none',
                  }}>
                    拖拽移动 · ↻ 旋转 · ⤢ 缩放
                  </div>
                </>
              )}

              {/* Unlock button for free locked items */}
              {isSelected && !effectiveReadOnly && !inGroup && item.locked && onUnlockItem && (
                <div
                  className="wabi-handle"
                  style={{
                    position: 'absolute', bottom: -28, left: '50%', transform: 'translateX(-50%)',
                    width: 24, height: 24, background: 'white',
                    border: '1.5px solid rgba(156,163,175,0.6)', borderRadius: '50%',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 10,
                  }}
                  onClick={(e) => { e.stopPropagation(); onUnlockItem(item.id); }}
                >
                  <Unlock size={10} color="#9CA3AF" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Marquee */}
      {marquee && (
        <div style={{
          position: 'absolute',
          left: Math.min(marquee.x1, marquee.x2), top: Math.min(marquee.y1, marquee.y2),
          width: Math.abs(marquee.x2 - marquee.x1), height: Math.abs(marquee.y2 - marquee.y1),
          border: '1.5px dashed rgba(74,158,142,0.5)',
          background: 'rgba(74,158,142,0.05)', borderRadius: 4, zIndex: 9999, pointerEvents: 'none',
        }} />
      )}

      {/* Multi-select toolbar */}
      {totalSelected > 1 && !effectiveReadOnly && (
        <div
          style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'white', borderRadius: 12, padding: '6px 10px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)', border: '1px solid #E5E7EB',
            display: 'flex', alignItems: 'center', gap: 6, zIndex: 9998,
          }}
          className="animate-fadeIn"
        >
          <span style={{ fontSize: 11, color: '#6B7280', marginRight: 4 }}>{totalSelected} 选中</span>
          {allSelectedEntities.length === 2 && (onAddConnection || onRemoveConnection) && (
            <ToolbarBtn
              icon={existingConnectionBetweenSelected ? Link2Off : Link2}
              label={existingConnectionBetweenSelected ? '取消连线' : '连线'}
              onClick={handleConnectSelected}
              color={existingConnectionBetweenSelected ? '#9CA3AF' : '#e8a0a0'}
            />
          )}
          {lockableSelected.length > 0 && (
            <ToolbarBtn icon={allLockableLocked ? Unlock : Lock} label={allLockableLocked ? '解锁' : '锁定'} onClick={handleLockSelected} color="#6B7280" />
          )}
          {selectedIds.size > 0 && (
            <ToolbarBtn icon={Trash2} label="删除" onClick={handleDeleteSelected} color="#ef4444" />
          )}
        </div>
      )}

      {/* Minimap */}
      {enablePanZoom && (
        <Minimap
          items={absItems} groups={localGroups} timelines={localTimelines}
          viewportX={viewportX} viewportY={viewportY} scale={scale}
          canvasRef={canvasRef}
          onNavigate={(x, y) => { setViewportX(x); setViewportY(y); }}
        />
      )}

      {/* Zoom indicator */}
      {enablePanZoom && (
        <div style={{
          position: 'absolute', bottom: 8, left: 12,
          fontSize: 10, color: '#9CA3AF', fontFamily: 'Inter, system-ui, sans-serif',
          letterSpacing: '0.1em', background: 'rgba(255,255,255,0.7)', padding: '2px 8px',
          borderRadius: 6, zIndex: 20, pointerEvents: 'none',
        }}>
          {Math.round(scale * 100)}%
        </div>
      )}

      {/* Viewer mode vignette */}
      {viewerMode && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 19,
          boxShadow: 'inset 0 0 80px 30px rgba(0,0,0,0.06)',
          transition: 'box-shadow 0.4s ease',
        }} />
      )}
    </div>
  );
});

export default BoardCanvas;

function ToolbarBtn({ icon: Icon, label, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 8px', border: 'none', background: 'none',
        cursor: 'pointer', borderRadius: 6, fontSize: 11, color: color || '#374151',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

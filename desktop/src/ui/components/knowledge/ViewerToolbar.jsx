import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Search, X, Filter, ChevronDown, FileText, StickyNote, Image, Globe, Tag, FolderOpen } from 'lucide-react';

export default function ViewerToolbar({ items = [], groups = [], connections = [], canvasRef }) {
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [visible, setVisible] = useState(false);
  const filterRef = useRef(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    return () => setVisible(false);
  }, []);

  const allTags = useMemo(() => {
    const s = new Set();
    for (const it of items) {
      const tags = it.knowledge?.tags;
      if (Array.isArray(tags)) tags.forEach((t) => s.add(t));
    }
    return [...s].sort();
  }, [items]);

  const allProjects = useMemo(() => {
    const s = new Set();
    for (const it of items) {
      const p = it.source_project || it.knowledge?._projectName;
      if (p) s.add(p);
    }
    return [...s].sort();
  }, [items]);

  const hasAnyFilter = !!(search || tagFilter || projectFilter || typeFilter);

  const applyFilter = useCallback(() => {
    if (!hasAnyFilter) {
      canvasRef?.current?.setFilterMatchIds?.(null);
      return;
    }

    const matchedIds = new Set();
    const q = search.toLowerCase().trim();

    for (const it of items) {
      const k = it.knowledge || {};
      const title = (k.title || '').toLowerCase();
      const content = (k.content_text || '').toLowerCase();
      const tags = Array.isArray(k.tags) ? k.tags : [];
      const proj = it.source_project || k._projectName || '';
      const type = k.type || '';

      if (q && !title.includes(q) && !content.includes(q)) continue;
      if (tagFilter && !tags.includes(tagFilter)) continue;
      if (projectFilter && proj !== projectFilter) continue;
      if (typeFilter && type !== typeFilter) continue;

      matchedIds.add(it.id);
    }

    for (const g of groups) {
      const groupItems = items.filter((it) => it.group_id === g.id);
      if (groupItems.some((it) => matchedIds.has(it.id))) {
        matchedIds.add(g.id);
      }
    }

    canvasRef?.current?.setFilterMatchIds?.(matchedIds);
  }, [search, tagFilter, projectFilter, typeFilter, items, groups, canvasRef, hasAnyFilter]);

  useEffect(() => {
    applyFilter();
  }, [applyFilter]);

  useEffect(() => {
    return () => {
      canvasRef?.current?.setFilterMatchIds?.(null);
    };
  }, [canvasRef]);

  const clearAll = useCallback(() => {
    setSearch('');
    setTagFilter('');
    setProjectFilter('');
    setTypeFilter('');
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setShowFilters(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectStyle = {
    padding: '5px 8px', borderRadius: 6,
    border: '1px solid #E5E7EB', background: 'white',
    fontSize: 11, color: '#374151', cursor: 'pointer',
    outline: 'none', minWidth: 80,
  };

  return (
    <div
      style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      {/* Main search bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)',
        borderRadius: 14, padding: '6px 12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.06)',
      }}>
        <Search size={14} color="#9CA3AF" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索卡片标题或内容..."
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: 12, color: '#374151', width: 200,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        />

        <div style={{ width: 1, height: 16, background: '#E5E7EB' }} />

        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{
            display: 'flex', alignItems: 'center', gap: 3,
            padding: '3px 8px', borderRadius: 6,
            border: 'none', cursor: 'pointer',
            background: showFilters || hasAnyFilter ? 'rgba(74,158,142,0.08)' : 'transparent',
            color: hasAnyFilter ? '#4a9e8e' : '#9CA3AF',
            fontSize: 11, transition: 'all 0.15s',
          }}
        >
          <Filter size={12} />
          筛选
          {hasAnyFilter && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#4a9e8e',
            }} />
          )}
        </button>

        {hasAnyFilter && (
          <button
            onClick={clearAll}
            style={{
              display: 'flex', alignItems: 'center',
              padding: 3, borderRadius: 4, border: 'none',
              cursor: 'pointer', background: 'rgba(239,68,68,0.06)',
              color: '#EF4444', transition: 'background 0.15s',
            }}
            title="清除所有筛选"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Dropdown filter panel */}
      {showFilters && (
        <div
          ref={filterRef}
          style={{
            background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)',
            borderRadius: 12, padding: '12px 16px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.1)', border: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', gap: 10,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          {/* Type filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <FileText size={11} color="#9CA3AF" />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
              <option value="">全部类型</option>
              <option value="snippet">文本</option>
              <option value="note">笔记</option>
              <option value="screenshot">截图</option>
              <option value="webclip">网页</option>
            </select>
          </div>

          {/* Tag filter */}
          {allTags.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Tag size={11} color="#9CA3AF" />
              <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={selectStyle}>
                <option value="">全部标签</option>
                {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}

          {/* Project filter */}
          {allProjects.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <FolderOpen size={11} color="#9CA3AF" />
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={selectStyle}>
                <option value="">全部项目</option>
                {allProjects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

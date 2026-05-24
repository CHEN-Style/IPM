// desktop/src/ui/components/knowclaw-v2/WorkspaceFileTree.jsx
//
// K2 / U1.5: right-side collapsible file-tree panel for the KnowClaw v2
// page. Powered entirely by `useKnowClawV2Chat`'s `workspaceTree`,
// `recentTouchedFiles`, and the new `knowclaw:listWorkspaceTree` IPC.
//
// E.7 additions:
//   - Single-click selects a file (blue-tinted row). Click another row
//     or outside-clear to change selection. The selection is purely a
//     visual affordance — it doesn't open or read anything.
//   - Double-click opens the file (replaces the old single-click open).
//   - File rows are `draggable`. Drag start writes the file's relPath
//     into `text/knowclaw-file-path`; the ChatInput's onDrop handler
//     recognises that MIME type and inserts a `@relPath` reference into
//     the composer.
//   - Whole panel accepts native file drops from the OS file manager
//     (Finder / Explorer). Drop on a directory row → copy to that dir;
//     drop on whitespace / file rows → copy to workspace root. Uses
//     `window.ipm.files.getPathForFile(file)` (Electron's webUtils
//     bridge replacing the removed `File.path` property in v32+).
//
// Responsibilities:
//   - Render the workspace as a collapsible directory tree (depth 3
//     by default; the IPC enforces the hard cap).
//   - In global mode, show a guidance message — the user has not
//     picked a workspace, so the tree would only display IPM's
//     internal folders.
//   - Highlight files marked "new" / "edited" by `recentTouchedFiles`
//     for 5 seconds with an amber background + dot indicator. The
//     hook prunes those entries on a 1s tick so the highlight fades.
//   - Footer toolbar: refresh button + "在资源管理器中打开" the
//     current cwd.
//
// Layout: fixed-width drawer (`w-72`) — wide enough for nested paths
// without ballooning into the chat column. Folded into the page by
// `KnowClawV2Page.jsx`'s `showFileTree` state.

import React, { useCallback, useMemo, useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileSpreadsheet,
  Image as ImageIcon,
  FileArchive,
  File as FileIcon,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronDown,
  FolderTree,
  ExternalLink,
  Upload,
} from 'lucide-react';

// Custom MIME type used to mark drags originating from within our tree.
// Picked deliberately specific so the ChatInput's onDrop can distinguish
// "user dragged a workspace file" from "user dropped a real OS file".
export const TREE_DRAG_MIME = 'text/knowclaw-file-path';

// Map well-known extensions → icon. Defaults to a plain FileIcon so
// unknown formats still render.
const EXT_ICON = {
  md: FileText, txt: FileText, log: FileText, rtf: FileText,
  js: FileCode, jsx: FileCode, mjs: FileCode, cjs: FileCode,
  ts: FileCode, tsx: FileCode, json: FileCode,
  py: FileCode, rb: FileCode, go: FileCode, rs: FileCode,
  java: FileCode, kt: FileCode, swift: FileCode,
  c: FileCode, h: FileCode, cpp: FileCode, hpp: FileCode,
  cs: FileCode, php: FileCode,
  html: FileCode, css: FileCode, scss: FileCode, sass: FileCode,
  vue: FileCode, svelte: FileCode,
  sh: FileCode, bash: FileCode, ps1: FileCode, bat: FileCode, cmd: FileCode,
  yaml: FileCode, yml: FileCode, toml: FileCode, xml: FileCode,
  csv: FileSpreadsheet, tsv: FileSpreadsheet, xlsx: FileSpreadsheet, xls: FileSpreadsheet,
  zip: FileArchive, tar: FileArchive, gz: FileArchive, '7z': FileArchive, rar: FileArchive,
  png: ImageIcon, jpg: ImageIcon, jpeg: ImageIcon, gif: ImageIcon, webp: ImageIcon,
  svg: ImageIcon, bmp: ImageIcon, ico: ImageIcon,
};

function getFileIcon(name) {
  if (!name) return FileIcon;
  const idx = name.lastIndexOf('.');
  if (idx < 0) return FileIcon;
  const ext = name.slice(idx + 1).toLowerCase();
  return EXT_ICON[ext] || FileIcon;
}

function formatSize(size) {
  if (typeof size !== 'number' || !Number.isFinite(size)) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Build a nested tree from the flat entry list returned by the IPC.
function buildTree(entries) {
  const root = { name: '__root__', relPath: '', type: 'directory', children: [] };
  const byRel = new Map();
  byRel.set('', root);
  const sorted = [...entries].sort((a, b) => a.relPath.localeCompare(b.relPath));
  for (const e of sorted) {
    const parentRel = e.relPath.includes('/')
      ? e.relPath.slice(0, e.relPath.lastIndexOf('/'))
      : '';
    let parent = byRel.get(parentRel);
    if (!parent) continue;
    const node = { ...e, children: [] };
    parent.children.push(node);
    if (e.type === 'directory') byRel.set(e.relPath, node);
  }
  return root;
}

// Single node renderer (recursive).
function TreeNode({
  node, depth, expanded, onToggle,
  recentTouchedFiles, onOpenFile,
  // E.7 selection + drag state
  selectedPath, onSelect,
  dropTargetDir, onDirDragOver, onDirDragLeave,
  onSystemDrop,
}) {
  const isDir = node.type === 'directory';
  const isExpanded = expanded.has(node.relPath);
  const touched = recentTouchedFiles?.get(node.relPath);
  const isSelected = !isDir && selectedPath === node.relPath;
  const isDropTarget = isDir && dropTargetDir === node.relPath;

  const indent = depth * 12;

  // E.7 single-click: select files (no open), still toggle dirs.
  const handleClick = useCallback(() => {
    if (isDir) {
      onToggle(node.relPath);
    } else {
      onSelect?.(node.relPath);
    }
  }, [isDir, node, onToggle, onSelect]);

  // E.7 double-click: open file via shell. Directories ignore dblclick
  // (the single click already toggled them; a fast double-click would
  // collapse what just expanded — undesirable).
  const handleDoubleClick = useCallback(() => {
    if (!isDir) {
      onOpenFile?.(node.path);
    }
  }, [isDir, node, onOpenFile]);

  // E.7 outbound drag: only files (directories don't carry a useful
  // "drop me into the prompt" semantic). Sets a custom MIME so the
  // ChatInput's drop handler can recognise it.
  const handleDragStart = useCallback((e) => {
    if (isDir) {
      e.preventDefault();
      return;
    }
    try {
      e.dataTransfer.setData(TREE_DRAG_MIME, node.relPath);
      // Plain text fallback for non-IPM drop targets — at worst a
      // textarea outside IPM receives the relPath as text. Better
      // than dropping nothing.
      e.dataTransfer.setData('text/plain', node.relPath);
      e.dataTransfer.effectAllowed = 'copy';
    } catch { /* ignore — best-effort */ }
  }, [isDir, node.relPath]);

  // E.7 inbound system drop: dirs become drop targets. We only update
  // hover state for native file drags (`Files` type present); intra-
  // tree drags are blocked by `effectAllowed = none`.
  const handleDragOver = useCallback((e) => {
    if (!isDir) return;
    const types = e.dataTransfer?.types;
    const hasFiles = types && (types.includes ? types.includes('Files') : Array.from(types).includes('Files'));
    if (!hasFiles) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    onDirDragOver?.(node.relPath);
  }, [isDir, node.relPath, onDirDragOver]);

  const handleDragLeave = useCallback((e) => {
    if (!isDir) return;
    // Only clear if the pointer truly leaves this row (related target
    // is outside). Otherwise child elements trigger spurious leaves.
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    onDirDragLeave?.(node.relPath);
  }, [isDir, node.relPath, onDirDragLeave]);

  const handleDrop = useCallback((e) => {
    if (!isDir) return;
    e.preventDefault();
    e.stopPropagation();
    onSystemDrop?.(e, node.relPath);
  }, [isDir, node.relPath, onSystemDrop]);

  // Composite background classes:
  //   selected (blue) > drop-target (blue ring) > touched (emerald/amber)
  //   > default
  const stateBg = isSelected
    ? 'bg-blue-50 ring-1 ring-blue-300'
    : isDropTarget
      ? 'bg-blue-50/70 ring-1 ring-blue-200'
      : touched
        ? touched.action === 'new'
          ? 'bg-emerald-50/70'
          : 'bg-amber-50/70'
        : '';

  const FileIconCmp = isDir
    ? (isExpanded ? FolderOpen : Folder)
    : getFileIcon(node.name);

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        draggable={!isDir}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`group w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[12px] text-slate-700 hover:bg-slate-100 transition-colors ${stateBg}`}
        style={{ paddingLeft: 8 + indent }}
        title={
          isDir
            ? `${node.relPath} — 拖文件到此目录上传`
            : `${node.relPath}${node.size != null ? '  ·  ' + formatSize(node.size) : ''}\n单击选中，双击打开，拖出可引用到对话`
        }
      >
        {isDir ? (
          isExpanded
            ? <ChevronDown size={12} className="text-slate-400 shrink-0" />
            : <ChevronRight size={12} className="text-slate-400 shrink-0" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <FileIconCmp
          size={13}
          className={isDir ? 'text-amber-500 shrink-0' : 'text-slate-400 shrink-0'}
        />
        <span className="flex-1 min-w-0 truncate">
          {node.name}
        </span>
        {touched && (
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              touched.action === 'new' ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            title={touched.action === 'new' ? '本轮新增' : '本轮修改'}
          />
        )}
        {!isDir && typeof node.size === 'number' && (
          <span className="text-[10px] text-slate-300 font-mono shrink-0 group-hover:text-slate-400">
            {formatSize(node.size)}
          </span>
        )}
      </button>
      {isDir && isExpanded && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.relPath || child.name}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              recentTouchedFiles={recentTouchedFiles}
              onOpenFile={onOpenFile}
              selectedPath={selectedPath}
              onSelect={onSelect}
              dropTargetDir={dropTargetDir}
              onDirDragOver={onDirDragOver}
              onDirDragLeave={onDirDragLeave}
              onSystemDrop={onSystemDrop}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const WorkspaceFileTree = ({
  entries,
  loading,
  truncated,
  isGlobal,
  cwd,
  recentTouchedFiles,
  onRefresh,
  onOpenFile,
  onOpenFolder,
  // E.7 new prop — async; resolves with `{ ok, uploaded, skipped, error }`.
  // Called by both the panel-level drop target (uploads to workspace
  // root) and per-directory drop targets.
  onUpload,
}) => {
  const [expanded, setExpanded] = useState(() => new Set());
  // E.7 selection — only one file at a time. Purely visual.
  const [selectedPath, setSelectedPath] = useState(null);
  // E.7 drop-target indicator — relPath of the directory currently
  // under the cursor during a system file drag. `''` means "root /
  // panel whitespace". `null` means no drag active.
  const [dropTargetDir, setDropTargetDir] = useState(null);

  const tree = useMemo(() => buildTree(Array.isArray(entries) ? entries : []), [entries]);

  React.useEffect(() => {
    if (!entries || entries.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const e of entries) {
        if (e.type === 'directory' && e.depth === 1 && !next.has(e.relPath)) {
          next.add(e.relPath);
        }
      }
      return next;
    });
  }, [entries]);

  // Clear selection when the workspace switches — the previously
  // selected relPath belongs to a different tree.
  React.useEffect(() => {
    setSelectedPath(null);
  }, [cwd]);

  const handleToggle = useCallback((relPath) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  const cwdLabel = useMemo(() => {
    if (!cwd) return '';
    const norm = String(cwd).replace(/\\/g, '/');
    const tail = norm.split('/').filter(Boolean).pop() || norm;
    return tail;
  }, [cwd]);

  // Run a system drop through the upload IPC. `destRelDir` defaults to
  // root when the drop landed on whitespace / non-dir rows.
  const performSystemDrop = useCallback(async (e, destRelDir = '') => {
    setDropTargetDir(null);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const filePaths = [];
    for (const f of Array.from(files)) {
      // Electron 32+ removed File.path. window.ipm.files.getPathForFile
      // wraps the replacement `webUtils.getPathForFile`.
      let p = '';
      try { p = window.ipm?.files?.getPathForFile?.(f) || ''; } catch { /* ignore */ }
      // Fallback for older Electron / odd code paths.
      if (!p && typeof f.path === 'string') p = f.path;
      if (p) filePaths.push(p);
    }
    if (filePaths.length === 0) return;
    if (!onUpload) return;
    try {
      await onUpload(filePaths, destRelDir);
    } catch {
      // Caller (KnowClawV2Page) is responsible for surfacing errors.
    }
  }, [onUpload]);

  // Panel-level drag handlers. The root container catches drops that
  // land on whitespace below the tree, and acts as the fallback target
  // for any drop the inner rows didn't claim (e.g. on a file row, on
  // the truncated-warning, etc.).
  const handlePanelDragOver = useCallback((e) => {
    if (isGlobal) return;
    const types = e.dataTransfer?.types;
    const hasFiles = types && (types.includes ? types.includes('Files') : Array.from(types).includes('Files'));
    if (!hasFiles) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropTargetDir((prev) => (prev == null ? '' : prev));
  }, [isGlobal]);

  const handlePanelDragLeave = useCallback((e) => {
    // Only clear when leaving the entire aside, not when moving
    // between child rows.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropTargetDir(null);
  }, []);

  const handlePanelDrop = useCallback((e) => {
    if (isGlobal) return;
    const types = e.dataTransfer?.types;
    const hasFiles = types && (types.includes ? types.includes('Files') : Array.from(types).includes('Files'));
    if (!hasFiles) return;
    e.preventDefault();
    void performSystemDrop(e, '');
  }, [isGlobal, performSystemDrop]);

  // Directory-row drag enter / leave handlers. The TreeNode calls these
  // so the parent owns the single-active-target state.
  const handleDirDragOver = useCallback((relPath) => {
    setDropTargetDir(relPath);
  }, []);

  const handleDirDragLeave = useCallback((relPath) => {
    setDropTargetDir((cur) => (cur === relPath ? '' : cur));
  }, []);

  const handleDirDrop = useCallback((e, relPath) => {
    void performSystemDrop(e, relPath);
  }, [performSystemDrop]);

  // Click on panel whitespace clears the file selection. Reduces the
  // chance of stale selection lingering after the user moves on.
  const handlePanelClick = useCallback((e) => {
    // Ignore clicks that originated from within a tree row.
    if (e.target.closest('button')) return;
    setSelectedPath(null);
  }, []);

  const showRootDropOverlay = !isGlobal && dropTargetDir === '';

  return (
    <aside
      className={`w-72 shrink-0 h-full flex flex-col border-l border-slate-100 bg-slate-50/50 relative ${
        showRootDropOverlay ? 'ring-2 ring-inset ring-blue-300' : ''
      }`}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
      onClick={handlePanelClick}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 bg-white">
        <FolderTree size={14} className="text-slate-500" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-slate-700 truncate">
            工作空间
          </div>
          {!isGlobal && cwdLabel && (
            <div className="text-[10px] text-slate-400 truncate" title={cwd}>
              {cwdLabel}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors"
          title="刷新文件树"
        >
          {loading
            ? <Loader2 size={12} className="animate-spin" />
            : <RefreshCw size={12} />}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto py-2">
        {isGlobal ? (
          <div className="px-4 py-6 text-[12px] text-slate-400 leading-relaxed">
            <FolderTree size={20} className="mb-2 text-slate-300" />
            <div className="font-medium text-slate-500 mb-1">未选择工作空间</div>
            <div>
              当前处于全局模式。切换到具体工作空间后，这里会显示该目录下的文件树（最多 3 层 / 500 项）。
            </div>
          </div>
        ) : (entries == null || entries.length === 0) && !loading ? (
          <div className="px-4 py-6 text-[12px] text-slate-400 leading-relaxed">
            当前工作空间内暂无文件。
            <div className="mt-2 text-slate-300">
              提示：可以将本机文件拖入此面板，会复制到工作空间根目录。
            </div>
          </div>
        ) : (
          <ul className="px-1.5">
            {tree.children.map((child) => (
              <TreeNode
                key={child.relPath || child.name}
                node={child}
                depth={0}
                expanded={expanded}
                onToggle={handleToggle}
                recentTouchedFiles={recentTouchedFiles}
                onOpenFile={onOpenFile}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                dropTargetDir={dropTargetDir}
                onDirDragOver={handleDirDragOver}
                onDirDragLeave={handleDirDragLeave}
                onSystemDrop={handleDirDrop}
              />
            ))}
          </ul>
        )}

        {truncated && (
          <div className="mt-2 px-4 text-[10px] text-amber-600 italic leading-relaxed">
            （已达到 500 项上限，部分文件未列出。请使用搜索或访问资源管理器查看完整内容。）
          </div>
        )}
      </div>

      {/* E.7 root-drop visual hint — only appears while a system file
          drag is hovering over panel whitespace (i.e. not on a specific
          directory row). Sits as a centered banner so it doesn't obscure
          the tree itself. */}
      {showRootDropOverlay && (
        <div
          className="absolute inset-x-3 bottom-14 pointer-events-none flex items-center justify-center"
          aria-hidden="true"
        >
          <div className="px-3 py-2 rounded-lg bg-blue-500/90 text-white text-[11px] flex items-center gap-1.5 shadow-lg">
            <Upload size={12} />
            <span>放开以上传到工作空间根目录</span>
          </div>
        </div>
      )}

      {/* Footer */}
      {!isGlobal && (
        <div className="border-t border-slate-100 bg-white px-3 py-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenFolder?.()}
            className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md text-[11px] text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            title="在资源管理器中打开当前工作空间"
          >
            <ExternalLink size={11} />
            <span>在资源管理器中打开</span>
          </button>
        </div>
      )}
    </aside>
  );
};

export default WorkspaceFileTree;

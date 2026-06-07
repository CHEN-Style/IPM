// C3: Publish-to-cloud modal.
//
// Two phases, driven by `activity.phase`:
//   - preview     : scan the workspace, let the user edit the cloud name /
//                   description / commit message, show a collapsible file tree.
//   - publishing / done / error : a step indicator that tracks the live
//                   publish progress (fed by the global cloud-publish state).
//
// Styling follows the app's existing inline-modal pattern (Linear-like:
// neutral surfaces, restrained accents, clear hierarchy).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CloudUpload, Folder, FileText, Check, Loader2, X, AlertTriangle,
  ChevronRight, ChevronDown, RefreshCw, Minus, CheckCircle2,
} from 'lucide-react';
import { fmtBytes } from './utils.js';
import { PUBLISH_STEP_ORDER } from '../../hooks/useCloudPublish.jsx';

function buildTree(entries) {
  const root = { name: '', type: 'folder', children: new Map(), sizeBytes: 0 };
  for (const e of entries || []) {
    const segments = String(e.path || '').split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      const isLeaf = i === segments.length - 1;
      if (!node.children.has(seg)) {
        node.children.set(seg, {
          name: seg,
          type: isLeaf ? e.entryType : 'folder',
          children: new Map(),
          sizeBytes: isLeaf && e.entryType === 'file' ? (e.sizeBytes || 0) : 0,
        });
      }
      node = node.children.get(seg);
    }
  }
  return root;
}

function TreeNode({ node, depth, collapsed, onToggle, pathKey }) {
  const isFolder = node.type === 'folder';
  const children = [...node.children.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const isCollapsed = collapsed.has(pathKey);

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-1 pr-2 rounded hover:bg-slate-50 ${isFolder ? 'cursor-pointer' : ''}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={isFolder ? () => onToggle(pathKey) : undefined}
      >
        {isFolder ? (
          isCollapsed ? <ChevronRight size={13} className="text-slate-400 shrink-0" /> : <ChevronDown size={13} className="text-slate-400 shrink-0" />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        {isFolder ? <Folder size={14} className="text-[#3e4b9c] shrink-0" /> : <FileText size={14} className="text-slate-400 shrink-0" />}
        <span className="text-[12.5px] text-slate-700 truncate flex-1">{node.name}</span>
        {!isFolder && (
          <span className="text-[10.5px] text-slate-400 shrink-0">{fmtBytes(node.sizeBytes || 0)}</span>
        )}
      </div>
      {isFolder && !isCollapsed && children.map((child) => (
        <TreeNode
          key={`${pathKey}/${child.name}`}
          node={child}
          depth={depth + 1}
          collapsed={collapsed}
          onToggle={onToggle}
          pathKey={`${pathKey}/${child.name}`}
        />
      ))}
    </div>
  );
}

function StepRow({ label, status, detail }) {
  const icon = (() => {
    if (status === 'done') return <Check size={14} className="text-emerald-600" />;
    if (status === 'running') return <Loader2 size={14} className="text-[#3e4b9c] animate-spin" />;
    if (status === 'error') return <AlertTriangle size={14} className="text-rose-600" />;
    return <span className="w-3.5 h-3.5 rounded-full border border-slate-300 inline-block" />;
  })();
  const textCls = status === 'pending' ? 'text-slate-400' : status === 'error' ? 'text-rose-600' : 'text-slate-700';
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="shrink-0 w-4 flex justify-center">{icon}</span>
      <span className={`text-[13px] ${textCls}`}>{label}</span>
      {detail ? <span className="text-[11px] text-slate-400 truncate ml-auto">{detail}</span> : null}
    </div>
  );
}

const PublishModal = ({ activity, activityKey, onClose, onStart, onCancel, onDismiss, stepLabels }) => {
  const { projectName, domain, phase } = activity;
  const domainLabel = domain === 'cases' ? '案件' : domain === 'study' ? '学习' : '项目';

  const [cloudName, setCloudName] = useState(activity.cloudName || projectName);
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('初始发布');

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError('');
    try {
      const res = await window.ipm?.cloud?.scanWorkspace?.({ projectName, domain });
      if (!res?.ok) throw new Error(res?.error || '扫描失败');
      setScanResult(res);
    } catch (e) {
      setScanError(e?.message || String(e));
    } finally {
      setScanning(false);
    }
  }, [projectName, domain]);

  useEffect(() => {
    if (phase === 'preview') void runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tree = useMemo(() => (scanResult ? buildTree(scanResult.entries) : null), [scanResult]);
  const onToggle = useCallback((pathKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }, []);

  const stats = scanResult?.stats;
  const canPublish = !scanning && !scanError && scanResult && (stats?.totalFiles > 0 || stats?.totalFolders > 0);

  const handlePublish = () => {
    onStart?.({ projectName, domain, cloudName: cloudName.trim() || projectName, description: description.trim(), message: message.trim() || '初始发布' });
  };

  const isPreview = phase === 'preview';

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[560px] max-h-[82vh] flex flex-col bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[#3e4b9c]/10">
            <CloudUpload size={16} className="text-[#3e4b9c]" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800">
              {isPreview ? `发布${domainLabel}到云端` : `发布${domainLabel}`}
            </div>
            <div className="text-[11px] text-slate-400 truncate">{projectName}</div>
          </div>
          <button
            type="button"
            className="ml-auto h-7 w-7 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        {isPreview ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">云端名称</label>
                <input
                  value={cloudName}
                  onChange={(e) => setCloudName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40"
                  placeholder="云端项目名称"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">描述（可选）</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40"
                  placeholder="一句话描述这个项目"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">提交说明</label>
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3e4b9c]/20 focus:border-[#3e4b9c]/40"
                  placeholder="初始发布"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-slate-500">将要发布的文件</span>
                {scanning ? (
                  <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin" /> 扫描中…
                  </span>
                ) : (
                  <button type="button" className="text-[11px] text-slate-400 hover:text-slate-600 inline-flex items-center gap-1" onClick={runScan}>
                    <RefreshCw size={11} /> 重新扫描
                  </button>
                )}
              </div>
              <div className="border border-slate-200 rounded-lg max-h-[220px] overflow-y-auto p-1.5 bg-slate-50/40">
                {scanError ? (
                  <div className="text-[12px] text-rose-600 px-2 py-3">{scanError}</div>
                ) : scanning && !tree ? (
                  <div className="text-[12px] text-slate-400 px-2 py-3">正在扫描本地文件…</div>
                ) : tree && tree.children.size > 0 ? (
                  [...tree.children.values()]
                    .sort((a, b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)))
                    .map((child) => (
                      <TreeNode
                        key={child.name}
                        node={child}
                        depth={0}
                        collapsed={collapsed}
                        onToggle={onToggle}
                        pathKey={child.name}
                      />
                    ))
                ) : (
                  <div className="text-[12px] text-slate-400 px-2 py-3">没有可发布的文件</div>
                )}
              </div>
            </div>

            {stats ? (
              <div className="flex items-center gap-4 text-[11px] text-slate-500">
                <span>{stats.totalFiles} 个文件</span>
                <span>{stats.totalFolders} 个文件夹</span>
                <span>共 {fmtBytes(stats.totalSizeBytes || 0)}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {phase === 'done' ? (
              <div className="flex flex-col items-center text-center py-4">
                <CheckCircle2 size={40} className="text-emerald-500 mb-3" />
                <div className="text-sm font-semibold text-slate-800">发布成功</div>
                <div className="text-[12px] text-slate-500 mt-1">
                  已创建云端版本 {activity.result?.versionNumber ? `v${activity.result.versionNumber}` : ''}
                </div>
              </div>
            ) : (
              <div className="space-y-0.5">
                {PUBLISH_STEP_ORDER.map((s) => {
                  const status = activity.steps?.[s] || 'pending';
                  let detail = '';
                  if (s === 'uploading' && (status === 'running' || status === 'done')) {
                    const { current, total, currentFile } = activity.upload || {};
                    if (total) detail = `${current}/${total}`;
                    if (status === 'running' && currentFile) {
                      const base = currentFile.split('/').filter(Boolean).slice(-1)[0] || currentFile;
                      detail = `${detail}  ${base}`;
                    }
                  }
                  if (s === 'scanning' && status === 'done' && activity.scanStats) {
                    detail = `${activity.scanStats.totalFiles} 文件`;
                  }
                  return <StepRow key={s} label={stepLabels?.[s] || s} status={status} detail={detail} />;
                })}
              </div>
            )}

            {phase === 'error' ? (
              <div className="mt-3 text-[12px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5">
                {activity.error || '发布失败'}
              </div>
            ) : null}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
          {isPreview ? (
            <>
              <button type="button" className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                disabled={!canPublish}
                className="px-4 py-1.5 text-sm bg-[#3e4b9c] text-white rounded-lg hover:bg-[#4e5bab] disabled:opacity-50 inline-flex items-center gap-1.5"
                onClick={handlePublish}
              >
                <CloudUpload size={14} /> 发布
              </button>
            </>
          ) : phase === 'publishing' ? (
            <>
              <button type="button" className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1.5" onClick={onClose}>
                <Minus size={14} /> 最小化
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 rounded-lg"
                onClick={() => onCancel?.(projectName, domain)}
              >
                取消发布
              </button>
            </>
          ) : phase === 'error' ? (
            <>
              <button type="button" className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg" onClick={() => onDismiss?.(activityKey)}>
                关闭
              </button>
              <button
                type="button"
                className="px-4 py-1.5 text-sm bg-[#3e4b9c] text-white rounded-lg hover:bg-[#4e5bab] inline-flex items-center gap-1.5"
                onClick={handlePublish}
              >
                <RefreshCw size={14} /> 重试
              </button>
            </>
          ) : (
            <button
              type="button"
              className="px-4 py-1.5 text-sm bg-[#3e4b9c] text-white rounded-lg hover:bg-[#4e5bab]"
              onClick={() => onDismiss?.(activityKey)}
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublishModal;

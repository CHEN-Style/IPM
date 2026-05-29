import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CornerDownLeft, GripHorizontal, Maximize2, Minimize2, X, Loader2, CheckCircle2, FileText, Sparkles } from 'lucide-react';
import DropTray, { TrayState } from './DropTray.jsx';
import ProjectBar from './ProjectBar.jsx';

const TrayWidget = ({
  windowMode = false,
  projects = [],
  activeProjectId,
  onSelectProject,
  uploadMode = 'confirm',
  activeDomain = 'projects',
  disabled = false,
  disabledHint = '',
  // FK6-5: optional. When provided, the FILE_STAGED confirm zone
  // renders a second "发送给 AI 分析" button next to "确认并保存".
  // Receives `{ srcPath, name }` for the currently staged file so
  // the parent can upload it into `_floating` and inject the
  // resulting `@relPath` into the KnowClaw input. The handler is
  // expected to return a promise; while it's pending we keep the
  // staged file in place so the user can see what's being sent.
  onSendFilesToAi,
}) => {
  const [trayState, setTrayState] = useState(TrayState.IDLE);
  const [currentFile, setCurrentFile] = useState(null);
  const [pendingSnippet, setPendingSnippet] = useState(null); // { text, preview }
  const [snippetStatus, setSnippetStatus] = useState('idle'); // idle | pending | saving | saved
  const [pendingShot, setPendingShot] = useState(null); // { token, dataUrl, width, height }
  const [shotStatus, setShotStatus] = useState('idle'); // idle | pending | saving | saved
  const snippetTimerRef = useRef(null);
  const [snippetConfetti, setSnippetConfetti] = useState({ show: false, particles: [] });
  const [note, setNote] = useState('');
  const [captureNotice, setCaptureNotice] = useState(null); // string | null (brief banner for compact capture save)
  const captureNoticeTimerRef = useRef(null);
  const [lastSaved, setLastSaved] = useState(null);
  const [undo, setUndo] = useState(null); // { relPath, secondsLeft, timerId }
  const [batchProgress, setBatchProgress] = useState(null); // { current: number, total: number, fileName: string }
  const lastClipboardRef = useRef('');
  const lastImageTokenRef = useRef('');

  // Layout & Drag States
  const [isCompact, setIsCompact] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 }); // only used when not windowMode
  const [isDragging, setIsDragging] = useState(false); // only used when not windowMode
  const dragOffset = useRef({ x: 0, y: 0 }); // only used when not windowMode

  // Initialize position to bottom-right
  useEffect(() => {
    if (windowMode) {
      // In real floating window: the *window* is draggable; widget stays anchored.
      setPosition({ x: 0, y: 0 });
      setIsInitialized(true);
      return;
    }
    const initialX = window.innerWidth - 400;
    const initialY = window.innerHeight - 500;
    setPosition({ x: Math.max(20, initialX), y: Math.max(20, initialY) });
    setIsInitialized(true);
  }, [windowMode]);

  // Handle Dragging Events
  useEffect(() => {
    if (windowMode) return;
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, windowMode]);

  const handleMouseDown = (e) => {
    if (windowMode) return;
    if (e.button !== 0) return; // Only left click
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleDragEnter = () => {
    if (!hasTarget) return;
    // File interaction should override snippet confirm
    if (pendingSnippet || pendingShot) {
      if (snippetTimerRef.current) {
        window.clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
      setPendingSnippet(null);
      setSnippetStatus('idle');
      setPendingShot(null);
      setShotStatus('idle');
    }
    if (trayState === TrayState.IDLE) setTrayState(TrayState.DRAGGING);
  };

  const handleDragLeave = () => {
    if (!hasTarget) return;
    if (trayState === TrayState.DRAGGING) setTrayState(TrayState.IDLE);
  };

  const showSnippet = useMemo(() => {
    return Boolean(pendingSnippet && snippetStatus !== 'idle' && trayState === TrayState.IDLE && !currentFile);
  }, [pendingSnippet, snippetStatus, trayState, currentFile]);

  const showShot = useMemo(() => {
    return Boolean(pendingShot && shotStatus !== 'idle' && trayState === TrayState.IDLE && !currentFile);
  }, [pendingShot, shotStatus, trayState, currentFile]);

  const showCapture = showShot || showSnippet;

  const baseCenterHeight = isCompact ? 80 : 128;
  // When snippet card shows, we collapse the drop zone to 0 (it can still accept drops via the parent container)
  // so the card can "take over" the entire center area. When card hides, drop zone restores.
  const centerGap = 0;
  const snippetHeight = showCapture ? baseCenterHeight : 0;
  const dropHeight = showCapture ? 0 : baseCenterHeight;

  const getSrcPathFromFile = (file) => {
    if (!file) return '';
    return file?.path || (window.ipm?.files?.getPathForFile ? window.ipm.files.getPathForFile(file) : '');
  };

  const hasTarget = !disabled && (activeDomain === 'study' ? true : Boolean(activeProjectId));

  const autoUploadSingle = async (file, { allowUndo = true } = {}) => {
    if (!hasTarget) return;
    const srcPath = getSrcPathFromFile(file);
    if (!srcPath) {
      window.alert('未获取到文件路径，请重新拖拽或点击选择文件');
      return;
    }
    setTrayState(TrayState.PROCESSING);
    try {
      const res = await window.ipm?.floating?.copyToTemp(activeProjectId, srcPath, file?.name || 'file', { domain: activeDomain });
      const relPath = res?.savedRelPath || '';
      setLastSaved(relPath || null);
      setTrayState(TrayState.COMPLETED);

      if (allowUndo) {
        // start undo countdown (3s)
        if (undo?.timerId) window.clearInterval(undo.timerId);
        let seconds = 3;
        const timerId = window.setInterval(() => {
          seconds -= 1;
          setUndo((u) => (u ? { ...u, secondsLeft: seconds } : u));
          if (seconds <= 0) {
            window.clearInterval(timerId);
            setUndo(null);
            handleReset();
          }
        }, 1000);
        setUndo({ relPath, secondsLeft: seconds, timerId });
      }
    } catch (e) {
      console.error(e);
      window.alert(`保存失败：${e?.message || String(e)}`);
      setTrayState(TrayState.IDLE);
    }
  };

  const autoUploadBatch = async (files) => {
    if (!hasTarget) return;
    const arr = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!arr.length) return;

    // Batch mode: serial upload, no undo (避免状态冲突)
    if (undo?.timerId) window.clearInterval(undo.timerId);
    setUndo(null);
    setLastSaved(null);
    setCurrentFile(null);

    setTrayState(TrayState.PROCESSING);
    try {
      for (let i = 0; i < arr.length; i += 1) {
        const f = arr[i];
        const name = f?.name || 'file';
        setBatchProgress({ current: i + 1, total: arr.length, fileName: name });

        const srcPath = getSrcPathFromFile(f);
        if (!srcPath) {
          throw new Error('未获取到文件路径，请重新拖拽或点击选择文件');
        }

        await window.ipm?.floating?.copyToTemp(activeProjectId, srcPath, name, { domain: activeDomain });
      }

      setTrayState(TrayState.COMPLETED);
      window.setTimeout(() => handleReset(), 1500);
    } catch (e) {
      console.error(e);
      window.alert(`保存失败：${e?.message || String(e)}`);
      setTrayState(TrayState.IDLE);
    } finally {
      setBatchProgress(null);
    }
  };

  // Clipboard text capture (floating window only) - main process pushes events (more reliable than polling)
  useEffect(() => {
    if (!windowMode) return;
    if (!hasTarget) return;
    const subscribe = window.ipm?.clipboard?.subscribeText;
    if (!subscribe) return;
    const unsubscribe = subscribe((payload) => {
      try {
        // Only prompt when we are not in file flow
        if (trayState !== TrayState.IDLE) return;
        if (currentFile) return;
        if (snippetStatus === 'saving' || shotStatus === 'saving') return;
        const text = String(payload?.text || '');
        const trimmed = text.trim();
        if (!trimmed) return;
        if (trimmed === lastClipboardRef.current) return;
        lastClipboardRef.current = trimmed;
        const preview = trimmed.length > 220 ? `${trimmed.slice(0, 220)}…` : trimmed;
        // latest clipboard wins: clear pending screenshot
        if (pendingShot) {
          setPendingShot(null);
          setShotStatus('idle');
        }
        setPendingSnippet({ text, preview });
        setSnippetStatus('pending');

        // auto hide after 5 seconds; reset if new clipboard arrives
        if (snippetTimerRef.current) window.clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = window.setTimeout(() => {
          setPendingSnippet(null);
          setSnippetStatus('idle');
          snippetTimerRef.current = null;
        }, 5000);

        // confetti burst
        const generateParticles = (count) => {
          return Array.from({ length: count }).map((_, i) => ({
            id: `${Date.now()}_${i}`,
            tx: `${(Math.random() - 0.5) * 220}px`,
            ty: `${(Math.random() - 0.5) * 180}px`,
            rot: `${Math.random() * 360}deg`,
            color: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'][Math.floor(Math.random() * 4)],
            delay: `${Math.random() * 0.15}s`,
            shape: Math.random() > 0.5 ? '50%' : '0%',
          }));
        };
        setSnippetConfetti({ show: true, particles: generateParticles(18) });
        window.setTimeout(() => setSnippetConfetti((s) => ({ ...s, show: false })), 900);
      } catch {
        // ignore
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [windowMode, hasTarget, trayState, currentFile, snippetStatus, activeDomain]);

  // Clipboard image capture (floating window only)
  useEffect(() => {
    if (!windowMode) return;
    if (!hasTarget) return;
    const subscribe = window.ipm?.clipboard?.subscribeImage;
    if (!subscribe) return;
    const unsubscribe = subscribe((payload) => {
      try {
        if (trayState !== TrayState.IDLE) return;
        if (currentFile) return;
        if (shotStatus === 'saving' || snippetStatus === 'saving') return;
        const token = String(payload?.token || '');
        const dataUrl = String(payload?.dataUrl || '');
        if (!token || !dataUrl) return;
        if (token === lastImageTokenRef.current) return;
        lastImageTokenRef.current = token;

        // latest clipboard wins: clear pending snippet
        if (pendingSnippet) {
          setPendingSnippet(null);
          setSnippetStatus('idle');
        }

        setPendingShot({
          token,
          dataUrl,
          width: Number(payload?.width) || 0,
          height: Number(payload?.height) || 0,
        });
        setShotStatus('pending');

        // auto hide after 5 seconds; reset if new clipboard arrives
        if (snippetTimerRef.current) window.clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = window.setTimeout(() => {
          setPendingShot(null);
          setShotStatus('idle');
          snippetTimerRef.current = null;
        }, 5000);

        // confetti burst
        const generateParticles = (count) => {
          return Array.from({ length: count }).map((_, i) => ({
            id: `${Date.now()}_${i}`,
            tx: `${(Math.random() - 0.5) * 220}px`,
            ty: `${(Math.random() - 0.5) * 180}px`,
            rot: `${Math.random() * 360}deg`,
            color: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6'][Math.floor(Math.random() * 4)],
            delay: `${Math.random() * 0.15}s`,
            shape: Math.random() > 0.5 ? '50%' : '0%',
          }));
        };
        setSnippetConfetti({ show: true, particles: generateParticles(18) });
        window.setTimeout(() => setSnippetConfetti((s) => ({ ...s, show: false })), 900);
      } catch {
        // ignore
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [windowMode, hasTarget, trayState, currentFile, shotStatus, snippetStatus, pendingSnippet, activeDomain]);

  const handleFileDrop = (file) => {
    if (!hasTarget) return;
    // File drop overrides snippet confirm
    if (pendingSnippet || pendingShot) {
      if (snippetTimerRef.current) {
        window.clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
      setPendingSnippet(null);
      setSnippetStatus('idle');
      setPendingShot(null);
      setShotStatus('idle');
    }
    setCurrentFile({
      name: file?.name || 'file',
      path: file?.path || '',
      file,
    });
    if (uploadMode === 'auto') {
      // 先斩后奏：直接上传，保留 compact 状态，由用户手动放大
      void autoUploadSingle(file);
      return;
    }
    setTrayState(TrayState.FILE_STAGED);
  };

  const handleFilesDrop = (files) => {
    if (!hasTarget) return;
    const arr = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!arr.length) return;

    // multi-file only supported in auto mode; confirm mode keeps old behavior (single file)
    if (uploadMode !== 'auto') {
      if (arr.length > 1) {
        window.alert('当前模式需要逐个确认：请一次拖入一个文件。');
      }
      handleFileDrop(arr[0]);
      return;
    }

    // File drop overrides snippet confirm
    if (pendingSnippet || pendingShot) {
      if (snippetTimerRef.current) {
        window.clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
      setPendingSnippet(null);
      setSnippetStatus('idle');
      setPendingShot(null);
      setShotStatus('idle');
    }

    void autoUploadBatch(arr);
  };

  const handleReset = () => {
    setTrayState(TrayState.IDLE);
    setCurrentFile(null);
    setNote('');
    setLastSaved(null);
    if (undo?.timerId) window.clearInterval(undo.timerId);
    setUndo(null);
    if (snippetTimerRef.current) {
      window.clearTimeout(snippetTimerRef.current);
      snippetTimerRef.current = null;
    }
    setPendingSnippet(null);
    setSnippetStatus('idle');
    setPendingShot(null);
    setShotStatus('idle');
    if (captureNoticeTimerRef.current) {
      window.clearTimeout(captureNoticeTimerRef.current);
      captureNoticeTimerRef.current = null;
    }
    setCaptureNotice(null);
  };

  // If target becomes unavailable, disable all flows immediately.
  useEffect(() => {
    if (!hasTarget) {
      handleReset();
      setTrayState(TrayState.IDLE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTarget]);

  const handleCancel = () => {
    handleReset();
  };

  const undoUpload = async () => {
    if (!undo?.relPath) return;
    if (!hasTarget) return;
    try {
      await window.ipm?.floating?.deleteRelPath?.(activeProjectId, undo.relPath, { domain: activeDomain });
    } catch (e) {
      console.error(e);
    } finally {
      handleReset();
    }
  };

  const savePendingSnippet = async () => {
    if (!pendingSnippet?.text) return;
    if (!hasTarget) return;
    if (snippetStatus === 'saving') return;
    const kApi = window.ipm?.knowledge?.create;
    if (!kApi) {
      window.alert('knowledge/create 未就绪：请重启应用');
      return;
    }

    const draft = pendingSnippet;
    const flash = (msg) => {
      if (captureNoticeTimerRef.current) window.clearTimeout(captureNoticeTimerRef.current);
      setCaptureNotice(msg);
      if (!msg) return;
      captureNoticeTimerRef.current = window.setTimeout(() => {
        setCaptureNotice(null);
        captureNoticeTimerRef.current = null;
      }, 1200);
    };

    if (isCompact) {
      if (snippetTimerRef.current) {
        window.clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
      setPendingSnippet(null);
      setSnippetStatus('saving');
      flash('保存中…');
    } else {
      setSnippetStatus('saving');
    }
    try {
      await kApi(activeProjectId, { type: 'snippet', text: draft.text, source_kind: 'clipboardText', domain: activeDomain });
      if (isCompact) {
        setSnippetStatus('idle');
        flash('已保存知识碎片');
        return;
      }

      setSnippetStatus('saved');
      if (snippetTimerRef.current) {
        window.clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
      window.setTimeout(() => {
        setPendingSnippet(null);
        setSnippetStatus('idle');
      }, 1200);
    } catch (e) {
      console.error(e);
      window.alert(`保存失败：${e?.message || String(e)}`);
      if (isCompact) {
        setPendingSnippet(draft);
      }
      setSnippetStatus('pending');
    }
  };

  const savePendingShot = async () => {
    if (!pendingShot?.token) return;
    if (!hasTarget) return;
    if (shotStatus === 'saving') return;
    const kApi = window.ipm?.knowledge?.create;
    if (!kApi) {
      window.alert('knowledge/create 未就绪：请重启应用');
      return;
    }

    const draft = pendingShot;
    const flash = (msg) => {
      if (captureNoticeTimerRef.current) window.clearTimeout(captureNoticeTimerRef.current);
      setCaptureNotice(msg);
      if (!msg) return;
      captureNoticeTimerRef.current = window.setTimeout(() => {
        setCaptureNotice(null);
        captureNoticeTimerRef.current = null;
      }, 1200);
    };

    if (isCompact) {
      if (snippetTimerRef.current) {
        window.clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
      setPendingShot(null);
      setShotStatus('saving');
      flash('保存中…');
    } else {
      setShotStatus('saving');
    }
    try {
      await kApi(activeProjectId, { type: 'screenshot', token: draft.token, source_kind: 'clipboardImage', domain: activeDomain });
      if (isCompact) {
        setShotStatus('idle');
        flash('已保存截图');
        return;
      }

      setShotStatus('saved');
      if (snippetTimerRef.current) {
        window.clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
      window.setTimeout(() => {
        setPendingShot(null);
        setShotStatus('idle');
      }, 1200);
    } catch (e) {
      console.error(e);
      window.alert(`保存失败：${e?.message || String(e)}`);
      if (isCompact) {
        setPendingShot(draft);
      }
      setShotStatus('pending');
    }
  };

  // FK6-5: "发送给 AI 分析" path. We hand the staged file's
  // absolute path to the parent callback (which uploads it into
  // `_floating` and injects `@relPath` into the floating KnowClaw
  // input) and reset the tray when the upload succeeds. On failure
  // we restore FILE_STAGED so the user can pick "确认并保存" instead.
  const handleSendToAi = async () => {
    if (!currentFile) return;
    if (typeof onSendFilesToAi !== 'function') return;
    const srcPath =
      currentFile.path ||
      (currentFile.file && window.ipm?.files?.getPathForFile ? window.ipm.files.getPathForFile(currentFile.file) : '');
    if (!srcPath) {
      window.alert('未获取到文件路径，请重新拖拽或点击选择文件');
      return;
    }
    const stagedName = currentFile.name || 'file';
    setTrayState(TrayState.PROCESSING);
    try {
      const res = await onSendFilesToAi([{ srcPath, name: stagedName }]);
      if (res?.ok === false) {
        window.alert(`发送给 AI 失败：${res?.error || '未知错误'}`);
        setTrayState(TrayState.FILE_STAGED);
        return;
      }
      handleReset();
    } catch (e) {
      console.error(e);
      window.alert(`发送给 AI 失败：${e?.message || String(e)}`);
      setTrayState(TrayState.FILE_STAGED);
    }
  };

  const handleConfirm = async () => {
    if (!currentFile) return;
    if (!hasTarget) return;
    if (uploadMode === 'auto') return; // auto mode doesn't require confirm
    const srcPath =
      currentFile.path ||
      (currentFile.file && window.ipm?.files?.getPathForFile ? window.ipm.files.getPathForFile(currentFile.file) : '');
    if (!srcPath) {
      window.alert('未获取到文件路径，请重新拖拽或点击选择文件');
      return;
    }
    setTrayState(TrayState.PROCESSING);
    try {
      const res = await window.ipm?.floating?.copyToTemp(activeProjectId, srcPath, currentFile.name, { domain: activeDomain });
      setLastSaved(res?.savedRelPath || null);
      setTrayState(TrayState.COMPLETED);
      window.setTimeout(() => handleReset(), 2500);
    } catch (e) {
      console.error(e);
      window.alert(`保存失败：${e?.message || String(e)}`);
      setTrayState(TrayState.FILE_STAGED);
    }
  };

  const toggleSize = (e) => {
    e.stopPropagation(); // Prevent drag start
    setIsCompact((v) => !v);
  };

  if (!isInitialized) return null;

  const rootStyle = windowMode
    ? { position: 'relative' }
    : {
        left: `${position.x}px`,
        top: `${position.y}px`,
        position: 'fixed',
      };

  return (
    <div
      style={rootStyle}
      className={`
        z-50 bg-white/95 backdrop-blur-xl shadow-2xl rounded-xl border border-slate-200/60 overflow-hidden flex flex-col font-sans text-slate-800 ring-1 ring-slate-900/5
        transition-all duration-300 ease-out
        ${!windowMode && isDragging ? 'cursor-grabbing shadow-[0_25px_60px_-12px_rgba(0,0,0,0.3)] scale-[1.02]' : ''}
        ${!windowMode ? 'hover:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)]' : ''}
        ${isCompact ? 'w-[240px]' : 'w-[360px]'}
      `}
    >
      {/* Header / Drag Handle Area */}
      <div
        onMouseDown={handleMouseDown}
        style={windowMode ? { WebkitAppRegion: 'drag' } : undefined}
        className={`
          h-8 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex items-center justify-between px-3 cursor-grab select-none group active:cursor-grabbing
          ${!windowMode && isDragging ? 'bg-slate-100' : ''}
          ${windowMode ? 'cursor-default' : ''}
        `}
      >
        <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
          <GripHorizontal size={14} className="text-slate-400" />
        </div>

        <div className="flex items-center gap-2">
          {!isCompact && (
            <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase pointer-events-none">
              KNOW VAULT
            </span>
          )}
          <button
            onClick={toggleSize}
            style={windowMode ? { WebkitAppRegion: 'no-drag' } : undefined}
            className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors"
            title={isCompact ? 'Expand' : 'Compact'}
          >
            {isCompact ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div
        className={`flex flex-col relative transition-all duration-300 ${
          isCompact ? 'p-2' : 'p-4'
        } ${showSnippet ? (isCompact ? 'gap-1' : 'gap-2') : isCompact ? 'gap-2' : 'gap-4'}`}
      >
        {/* State Banner / Prompt (hidden when snippet card is showing, to avoid "mysterious" top gap) */}
        {!showSnippet ? (
          <div className="flex items-center justify-between min-h-[1.25rem]">
            <span
              className={`font-medium transition-colors duration-300 truncate ${isCompact ? 'text-[10px]' : 'text-xs'} ${
                captureNotice
                  ? 'text-emerald-600'
                  : trayState === TrayState.IDLE
                    ? 'text-slate-400'
                    : trayState === TrayState.FILE_STAGED
                      ? 'text-orange-600'
                      : trayState === TrayState.COMPLETED
                        ? 'text-emerald-600'
                        : 'text-blue-600'
              }`}
            >
              {captureNotice ||
                (trayState === TrayState.IDLE && (isCompact ? '拖入保存' : '等待内容...')) ||
                (trayState === TrayState.DRAGGING && '松开以放入') ||
                (trayState === TrayState.FILE_STAGED && '确认保存') ||
                (trayState === TrayState.PROCESSING &&
                  (batchProgress
                    ? `正在上传 ${batchProgress.current}/${batchProgress.total}：${batchProgress.fileName}`
                    : '处理中...')) ||
                (trayState === TrayState.COMPLETED && '已保存')}
            </span>
            {uploadMode === 'auto' && undo?.secondsLeft ? (
              <button
                onClick={undoUpload}
                style={windowMode ? { WebkitAppRegion: 'no-drag' } : undefined}
                className="text-[10px] font-bold px-2 py-1 rounded bg-rose-500/10 text-rose-600 border border-rose-200 hover:bg-rose-500/15 transition-colors"
              >
                取消上传（{undo.secondsLeft}s）
              </button>
            ) : null}
            {uploadMode !== 'auto' && trayState === TrayState.FILE_STAGED && (
              <button
                onClick={handleCancel}
                className="text-slate-400 hover:text-red-500 hover:rotate-90 transition-all duration-300 transform"
              >
                <X size={isCompact ? 12 : 14} />
              </button>
            )}
          </div>
        ) : null}

        {/* Center Stack: fixed height; when snippet appears it "borrows" space from DropTray (no window resize) */}
        <div
          className="w-full relative flex flex-col"
          style={{ height: `${baseCenterHeight}px` }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={(e) => {
            // allow dropping files even on snippet card area
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
              handleFilesDrop(Array.from(files));
            }
          }}
        >
          {/* Confetti burst when new clipboard arrives */}
          {showCapture && snippetConfetti.show ? (
            <div className="absolute inset-0 pointer-events-none overflow-visible flex items-center justify-center z-30">
              {snippetConfetti.particles.map((p) => (
                <div
                  key={p.id}
                  className="particle"
                  style={{
                    '--tx': p.tx,
                    '--ty': p.ty,
                    '--rot': p.rot,
                    backgroundColor: p.color,
                    borderRadius: p.shape,
                    animationDelay: p.delay,
                  }}
                />
              ))}
            </div>
          ) : null}

          {/* Snippet area (animated) */}
          <div
            className="w-full overflow-hidden transition-all duration-300 ease-out flex-shrink-0"
            style={{ height: `${snippetHeight}px` }}
          >
            {showCapture ? (
              isCompact ? (
                <div className="h-full w-full rounded-lg border border-amber-200/70 bg-gradient-to-b from-amber-50 to-amber-100/60 shadow-sm overflow-hidden relative">
                  {/* small corner fold */}
                  <div className="absolute top-0 right-0 w-6 h-6 bg-gradient-to-bl from-white/80 to-transparent pointer-events-none" />
                  <div className="h-full w-full flex items-stretch">
                    <button
                      type="button"
                      onClick={showShot ? savePendingShot : savePendingSnippet}
                      style={windowMode ? { WebkitAppRegion: 'no-drag' } : undefined}
                      className="flex-1 min-w-0 px-2 py-1.5 text-left flex flex-col justify-start"
                      title={showShot ? '点击保存截图' : '点击保存为知识碎片'}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-700/70">
                        <FileText size={12} className="text-amber-600/70" />
                        <span className="font-semibold tracking-wide">{showShot ? '截图' : '笔记'}</span>
                      </div>
                      {showShot ? (
                        <div className="mt-1 flex-1 min-h-0 overflow-hidden rounded-md border border-amber-200/70 bg-white/60">
                          <img src={pendingShot?.dataUrl} alt="clipboard screenshot" className="w-full h-full object-cover" draggable={false} />
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11px] text-slate-800 leading-snug line-clamp-2 whitespace-pre-wrap">
                          {pendingSnippet?.preview}
                        </div>
                      )}
                    </button>
                    <div className="w-px bg-amber-200/70 my-1.5" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (snippetTimerRef.current) {
                          window.clearTimeout(snippetTimerRef.current);
                          snippetTimerRef.current = null;
                        }
                        if (showShot) {
                          setPendingShot(null);
                          setShotStatus('idle');
                        } else {
                          setPendingSnippet(null);
                          setSnippetStatus('idle');
                        }
                      }}
                      style={windowMode ? { WebkitAppRegion: 'no-drag' } : undefined}
                      className="px-2 flex items-center justify-center text-rose-400 hover:text-rose-500 hover:bg-rose-50/60 transition-colors"
                      title="取消"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={showShot ? savePendingShot : savePendingSnippet}
                  className="h-full w-full rounded-lg border border-slate-200 bg-gradient-to-b from-[#fffdf6] to-[#fff7db] hover:from-[#fff7db] hover:to-[#ffefc2] transition-colors px-3 py-2 text-left shadow-sm overflow-hidden relative flex flex-col justify-start"
                  title={showShot ? '点击保存截图' : '点击保存为知识碎片'}
                >
                  {/* ruled paper lines + corner fold */}
                  <div className="absolute inset-0 pointer-events-none opacity-[0.45] bg-[linear-gradient(to_bottom,rgba(15,23,42,0.06)_1px,transparent_1px)] [background-size:100%_18px]" />
                  <div className="absolute top-0 right-0 w-8 h-8 bg-gradient-to-bl from-white/90 to-transparent pointer-events-none" />

                  <div className="relative flex items-center justify-between gap-3">
                    <div
                      className={`text-[10px] font-bold tracking-widest px-2 py-1 rounded-md border ${
                        (showShot ? shotStatus : snippetStatus) === 'saving'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : (showShot ? shotStatus : snippetStatus) === 'saved'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-900 text-white border-slate-900'
                      }`}
                    >
                      {(showShot ? shotStatus : snippetStatus) === 'saving'
                        ? '保存中…'
                        : (showShot ? shotStatus : snippetStatus) === 'saved'
                          ? '已保存'
                          : '点击保存'}
                    </div>
                    <div className="text-slate-400">
                      {(showShot ? shotStatus : snippetStatus) === 'saving' ? (
                        <Loader2 size={14} className="animate-spin text-indigo-500" />
                      ) : (showShot ? shotStatus : snippetStatus) === 'saved' ? (
                        <CheckCircle2 size={14} className="text-emerald-600" />
                      ) : null}
                    </div>
                  </div>

                  <div className="relative mt-2 flex-1 min-h-0 px-1">
                    {showShot ? (
                      <div className="w-full h-full rounded-lg border border-amber-200/60 bg-white/30 overflow-hidden">
                        <img src={pendingShot?.dataUrl} alt="clipboard screenshot" className="w-full h-full object-contain" draggable={false} />
                      </div>
                    ) : (
                      <div className="text-xs text-slate-800 line-clamp-6 whitespace-pre-wrap leading-relaxed">
                        {pendingSnippet?.preview}
                      </div>
                    )}
                  </div>
                </button>
              )
            ) : null}
          </div>

          {/* Drop zone area (animated height) */}
          {centerGap ? <div className="flex-shrink-0" style={{ height: `${centerGap}px` }} /> : null}
          <div className="w-full transition-all duration-300 ease-out flex-shrink-0" style={{ height: `${dropHeight}px` }}>
            <DropTray
              state={trayState}
              fileName={currentFile?.name || null}
              onFileDrop={handleFileDrop}
              onFilesDrop={handleFilesDrop}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              isCompact={isCompact}
              heightClass="h-full"
              hideIdleText={showSnippet}
              disabled={!hasTarget}
              disabledText={disabledHint}
            />
          </div>
        </div>

        {/* Input & Actions - Only visible when needed */}
        <div
          className={`
          flex flex-col gap-3 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] origin-top
          ${uploadMode !== 'auto' && (trayState === TrayState.FILE_STAGED || trayState === TrayState.COMPLETED) ? 'opacity-100' : 'opacity-40 max-h-0 overflow-hidden pointer-events-none grayscale'}
        `}
        >
          <div className="relative group">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isCompact ? '备注...' : '添加备注或标签...'}
              disabled={trayState !== TrayState.FILE_STAGED}
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-200 transition-all placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
            />
            {!isCompact && (
              <div className="absolute right-2 top-2.5 text-slate-300 pointer-events-none group-focus-within:text-blue-400 transition-colors">
                <CornerDownLeft size={14} />
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {!isCompact && (
              <button
                onClick={handleCancel}
                className="flex-1 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-800 transition-colors active:scale-95"
              >
                取消
              </button>
            )}
            <button
              onClick={handleConfirm}
              className="group flex-[2] flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-white bg-slate-800 rounded-lg hover:bg-slate-700 active:bg-slate-900 active:scale-90 transition-all duration-150 shadow-sm shadow-slate-300"
            >
              <span>{isCompact ? '确认' : '确认并保存'}</span>
              <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          {/* FK6-5: "发送给 AI 分析" — secondary action that uploads the
              staged file to `_floating` and injects `@relPath` into the
              KnowClaw input instead of classifying it into the active
              workspace. Only rendered when the parent passes
              `onSendFilesToAi` (i.e. inside the floating window). */}
          {typeof onSendFilesToAi === 'function' && trayState === TrayState.FILE_STAGED && (
            <button
              onClick={handleSendToAi}
              className="group w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 hover:border-violet-300 active:scale-95 transition-all duration-150"
              title="把当前文件上传到悬浮助手工作空间，并在 KnowClaw 输入框插入 @文件引用（不会自动发送）"
            >
              <Sparkles size={12} className="text-violet-500" />
              <span>{isCompact ? '发给 AI' : '发送给 AI 分析'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Footer / Context Bar */}
      <ProjectBar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelect={onSelectProject}
        icon={activeDomain}
        title={activeDomain === 'cases' ? 'Active Cases' : activeDomain === 'study' ? 'Study' : 'Active Projects'}
        emptyText={activeDomain === 'cases' ? '暂无可用案件（ACTIVE）' : activeDomain === 'study' ? '学习（固定目标）' : '暂无可用项目（ACTIVE）'}
      />
    </div>
  );
};

export default TrayWidget;



import { useCallback, useRef, useState } from 'react';

const useClipboardUpload = ({ cwd, domainOpts, refreshEntries, refreshGhosts, setNotice, setErrorText }) => {
  const aiUploadInputRef = useRef(null);
  const [aiUpload, setAiUpload] = useState({ running: false, current: 0, total: 0, fileName: '' });

  const uploadFilesAndAiClassify = useCallback(
    async (files) => {
      // Requirement: only files (no folders), allow multi-select, serial, reuse floating/copyToTemp
      if (cwd.type !== 'project') {
        setNotice?.({ variant: 'warn', message: '仅支持在项目/案件/学习中使用（不支持本地文件夹视图）' });
        return;
      }
      if (!window.ipm?.floating?.copyToTemp) {
        setNotice?.({ variant: 'error', message: 'floating/copyToTemp 未就绪：请重启应用（不要只刷新页面）' });
        return;
      }
      const arr = Array.isArray(files) ? files.filter(Boolean) : [];
      if (!arr.length) return;

      setErrorText?.('');
      setAiUpload({ running: true, current: 0, total: arr.length, fileName: '' });
      try {
        for (let i = 0; i < arr.length; i += 1) {
          const f = arr[i];
          const name = String(f?.name || 'file');
          const srcPath = String(
            f?.path || (window.ipm?.files?.getPathForFile ? window.ipm.files.getPathForFile(f) : '') || '',
          );
          setAiUpload({ running: true, current: i + 1, total: arr.length, fileName: name });
          if (!srcPath) throw new Error('未获取到文件路径：请在桌面应用中重新选择文件（不要在浏览器里打开 UI 页面）');
          await window.ipm.floating.copyToTemp(cwd.name, srcPath, name, domainOpts);
        }

        setNotice?.({ variant: 'success', message: `已放入 temp 并触发 AI 分类（${arr.length} 个）。稍后可在「AI 暂存区」查看建议。` });
        await refreshEntries?.();
        // AI 推荐写入是异步的：做一次轻微延迟刷新
        window.setTimeout(() => refreshGhosts?.().catch(() => {}), 700);
        window.setTimeout(() => refreshGhosts?.().catch(() => {}), 1500);
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      } finally {
        setAiUpload({ running: false, current: 0, total: 0, fileName: '' });
      }
    },
    [cwd, domainOpts, refreshEntries, refreshGhosts, setErrorText, setNotice],
  );

  const pickFilesAndAiClassify = useCallback(() => {
    if (aiUpload.running) return;
    aiUploadInputRef.current?.click?.();
  }, [aiUpload.running]);

  return {
    aiUploadInputRef,
    aiUpload,
    uploadFilesAndAiClassify,
    pickFilesAndAiClassify,
  };
};

export default useClipboardUpload;



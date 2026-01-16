import { useCallback, useEffect, useState } from 'react';

const normalizeRelPathPosix = (p) =>
  String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');

const useFolderDetail = ({ cwd, domainOpts, setNotice }) => {
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null); // { entry, folderMeta }
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [descSaving, setDescSaving] = useState(false);

  useEffect(() => {
    const d = detail?.folderMeta?.description;
    setDescDraft(typeof d === 'string' ? d : '');
    setDescEditing(false);
    setDescSaving(false);
  }, [detail?.entry?.relPath, detail?.folderMeta?.description]);

  const openFolderDetail = useCallback(
    async (entry) => {
      if (cwd.type !== 'project') return;
      if (!entry || entry.kind !== 'dir') return;
      setDetailOpen(true);
      setDetailVisible(false);
      setDetailLoading(true);
      const rp = normalizeRelPathPosix(entry?.relPath);
      const inferredSystem = rp === 'snippets' || rp === 'meta' || rp === 'temp';
      setDetail({ entry, folderMeta: inferredSystem ? { system: true, description: '' } : null });
      // allow transition
      window.setTimeout(() => setDetailVisible(true), 0);
      try {
        const api = window.ipm?.meta?.getFolderInfo;
        if (!api) {
          setDetailLoading(false);
          return;
        }
        const res = await api(cwd.name, entry.relPath, domainOpts);
        setDetail({ entry, folderMeta: res?.folder || (inferredSystem ? { system: true, description: '' } : null) });
      } catch (e) {
        setNotice?.({ variant: 'error', message: e?.message || String(e) });
      } finally {
        setDetailLoading(false);
      }
    },
    [cwd, domainOpts, setNotice],
  );

  const closeFolderDetail = useCallback(() => {
    setDetailVisible(false);
    window.setTimeout(() => {
      setDetailOpen(false);
      setDetailLoading(false);
      setDetail(null);
      setDescEditing(false);
      setDescDraft('');
      setDescSaving(false);
    }, 180);
  }, []);

  const saveFolderDescription = useCallback(async () => {
    if (cwd.type !== 'project') return;
    const relPath = detail?.entry?.relPath;
    if (!relPath) return;
    if (!window.ipm?.meta?.setFolderDescription) {
      setNotice?.({ variant: 'error', message: 'meta/setFolderDescription 未就绪：请重启应用（不要只刷新页面）' });
      return;
    }
    setDescSaving(true);
    try {
      const res = await window.ipm.meta.setFolderDescription(cwd.name, relPath, descDraft, domainOpts);
      setDetail((d) => (d ? { ...d, folderMeta: res?.folder || d.folderMeta } : d));
      setDescEditing(false);
      setNotice?.({ variant: 'success', message: '简介已保存' });
    } catch (e) {
      setNotice?.({ variant: 'error', message: e?.message || String(e) });
    } finally {
      setDescSaving(false);
    }
  }, [cwd, detail, descDraft, domainOpts, setNotice]);

  return {
    detailOpen,
    detailVisible,
    detailLoading,
    detail,
    descEditing,
    descDraft,
    descSaving,
    setDescEditing,
    setDescDraft,
    openFolderDetail,
    closeFolderDetail,
    saveFolderDescription,
  };
};

export default useFolderDetail;



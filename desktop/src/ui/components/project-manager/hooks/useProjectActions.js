import { useCallback, useState } from 'react';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog.jsx';

const useProjectActions = ({
  entityApi,
  entityLabel,
  isStudy,
  refreshProjects,
  refreshLocalFolders,
  setCwd,
  setErrorText,
  setNotice,
  setCurrentProject,
  // W1: 模板选择回调；提供时点击「新建」会先弹模板选择窗，由调用方负责
  // 调用 createProjectWithTemplate(template) 完成最终创建。缺省时回退到
  // 原行为（直接以 'default' 模板创建），保持向后兼容。
  onRequestTemplate,
  // F1: 项目列表（用于在删除时识别附属壳，给出区别于原生项目的提示文案）
  projects,
}) => {
  const confirm = useConfirmDialog();
  const [newProjectName, setNewProjectName] = useState('');

  const enterProject = useCallback(
    async (name) => {
      await entityApi?.setCurrent?.(name);
      setCurrentProject?.(name);
      setCwd({ type: 'project', name, relPath: '' });
    },
    [entityApi, setCurrentProject, setCwd],
  );

  const enterLocalFolder = useCallback(
    async (rootPath) => {
      const rp = String(rootPath || '').trim();
      if (!rp) return;
      setCwd({ type: 'local', rootPath: rp, relPath: '' });
    },
    [setCwd],
  );

  const goRoot = useCallback(async () => {
    if (isStudy) {
      setCwd({ type: 'project', name: '', relPath: '' });
      return;
    }
    setCwd({ type: 'root' });
    await refreshProjects?.();
    await refreshLocalFolders?.().catch(() => {});
  }, [isStudy, refreshLocalFolders, refreshProjects, setCwd]);

  // W1: 真正执行带模板的创建（被模板弹窗或回退路径调用）。
  const createProjectWithTemplate = useCallback(
    async (template) => {
      const name = newProjectName.trim();
      if (!name) {
        setErrorText?.(`请输入${entityLabel}名称`);
        return;
      }
      if (!entityApi?.create) {
        setErrorText?.('create 未就绪：请重启应用（不要只刷新页面）');
        return;
      }
      setErrorText?.('');
      try {
        await entityApi.create(name, { template });
        setNewProjectName('');
        await refreshProjects?.();
        setCwd({ type: 'root' });
      } catch (e) {
        setErrorText?.(e?.message || String(e));
      }
    },
    [entityApi, entityLabel, newProjectName, refreshProjects, setCwd, setErrorText],
  );

  // W1: 入口按钮触发的「新建」。校验通过后请求模板选择；调用方未提供
  // onRequestTemplate 时按 'default' 模板直接创建。
  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) {
      setErrorText?.(`请输入${entityLabel}名称`);
      return;
    }
    if (!entityApi?.create) {
      setErrorText?.('create 未就绪：请重启应用（不要只刷新页面）');
      return;
    }
    setErrorText?.('');
    if (typeof onRequestTemplate === 'function') {
      onRequestTemplate(name);
      return;
    }
    await createProjectWithTemplate('default');
  }, [createProjectWithTemplate, entityApi, entityLabel, newProjectName, onRequestTemplate, setErrorText]);

  const deleteProject = useCallback(
    async (name) => {
      if (!entityApi?.delete) {
        setErrorText?.('delete 未就绪：请重启应用（不要只刷新页面）');
        return;
      }
      // F1: 附属壳的删除文案与原生项目区分。
      // - 原生项目：删除整个文件夹及其内容（不可恢复）。
      // - 附属壳：仅取消关联（删除壳内 meta/temp/snippets 等系统目录），外部文件夹不会被删除。
      const meta = (projects || []).find((p) => p && p.name === name) || null;
      const isAttached = Boolean(meta?.attached);
      const externalRoot = String(meta?.externalRootPath || '');
      const ok = await confirm({
        title: isAttached ? `取消导入${entityLabel}` : `删除${entityLabel}`,
        message: isAttached
          ? `确认取消导入${entityLabel}「${name}」？\n` +
            `\n仅会删除应用内的关联数据（meta / temp / snippets 等系统目录）。\n` +
            (externalRoot ? `\n外部文件夹「${externalRoot}」不会被删除。\n` : '\n外部文件夹不会被删除。\n') +
            `\n注意：知识碎片、AI 分类记录等关联数据会一并丢失。`
          : `确定删除${entityLabel}「${name}」吗？\n此操作将删除整个文件夹及其所有内容，不可恢复。`,
        confirmLabel: isAttached ? '取消导入' : `删除${entityLabel}`,
        danger: true,
        requireInput: name,
        inputHint: `输入${entityLabel}名称`,
      });
      if (!ok) return;
      setErrorText?.('');
      try {
        await entityApi.delete(name);
        await refreshProjects?.();
        setCwd({ type: 'root' });
      } catch (e) {
        setErrorText?.(e?.message || String(e));
      }
    },
    [entityApi, entityLabel, projects, refreshProjects, setCwd, setErrorText],
  );

  return {
    newProjectName,
    setNewProjectName,
    enterProject,
    enterLocalFolder,
    goRoot,
    createProject,
    createProjectWithTemplate,
    deleteProject,
  };
};

export default useProjectActions;



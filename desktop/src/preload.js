import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('ipm', {
  ping: () => ipcRenderer.invoke('app/ping'),
  ui: {
    openFloating: () => ipcRenderer.invoke('ui/openFloating'),
    backToMain: () => ipcRenderer.invoke('ui/backToMain'),
    resizeFloating: (width, height) => ipcRenderer.invoke('ui/resizeFloating', { width, height }),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs/get'),
    set: (patch) => ipcRenderer.invoke('prefs/set', { patch }),
  },
  clipboard: {
    readText: () => clipboard.readText(),
    subscribeText: (cb) => {
      if (typeof cb !== 'function') return () => {};
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('clipboard/textChanged', handler);
      return () => ipcRenderer.removeListener('clipboard/textChanged', handler);
    },
    subscribeImage: (cb) => {
      if (typeof cb !== 'function') return () => {};
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('clipboard/imageChanged', handler);
      return () => ipcRenderer.removeListener('clipboard/imageChanged', handler);
    },
  },
  files: {
    getPathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },
  snippets: {
    saveClipboardText: (projectName, text, opts = {}) => ipcRenderer.invoke('snippets/saveClipboardText', { projectName, text, ...opts }),
    clipboardRecord: {
      list: (projectName, opts = {}) => ipcRenderer.invoke('snippets/clipboardRecord/list', { projectName, ...opts }),
      updateMeta: (projectName, id, patch, opts = {}) =>
        ipcRenderer.invoke('snippets/clipboardRecord/updateMeta', { projectName, id, patch, ...opts }),
      updateContent: (projectName, id, text, opts = {}) =>
        ipcRenderer.invoke('snippets/clipboardRecord/updateContent', { projectName, id, text, ...opts }),
      delete: (projectName, id, opts = {}) => ipcRenderer.invoke('snippets/clipboardRecord/delete', { projectName, id, ...opts }),
      subscribe: (cb) => {
        if (typeof cb !== 'function') return () => {};
        const handler = (_evt, payload) => cb(payload);
        ipcRenderer.on('snippets/clipboardRecord.changed', handler);
        return () => ipcRenderer.removeListener('snippets/clipboardRecord.changed', handler);
      },
    },
  },
  screenshots: {
    saveClipboardImage: (projectName, token, opts = {}) => ipcRenderer.invoke('screenshots/saveClipboardImage', { projectName, token, ...opts }),
  },
  floating: {
    copyToTemp: (projectName, srcPath, fileName, opts = {}) =>
      ipcRenderer.invoke('floating/copyToTemp', { projectName, srcPath, fileName, ...opts }),
    deleteRelPath: (projectName, relPath, opts = {}) => ipcRenderer.invoke('floating/deleteRelPath', { projectName, relPath, ...opts }),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects/list'),
    create: (name) => ipcRenderer.invoke('projects/create', { name }),
    getCurrent: () => ipcRenderer.invoke('projects/getCurrent'),
    setCurrent: (name) => ipcRenderer.invoke('projects/setCurrent', { name }),
    setStatus: (name, status) => ipcRenderer.invoke('projects/setStatus', { name, status }),
    delete: (name) => ipcRenderer.invoke('projects/delete', { name }),
  },
  cases: {
    list: () => ipcRenderer.invoke('cases/list'),
    create: (name) => ipcRenderer.invoke('cases/create', { name }),
    getCurrent: () => ipcRenderer.invoke('cases/getCurrent'),
    setCurrent: (name) => ipcRenderer.invoke('cases/setCurrent', { name }),
    setStatus: (name, status) => ipcRenderer.invoke('cases/setStatus', { name, status }),
    delete: (name) => ipcRenderer.invoke('cases/delete', { name }),
  },
  localFolders: {
    list: () => ipcRenderer.invoke('localFolders/list'),
    import: () => ipcRenderer.invoke('localFolders/import'),
    remove: (absPath) => ipcRenderer.invoke('localFolders/remove', { path: absPath }),
  },
  localExplorer: {
    list: (rootPath, relPath = '') => ipcRenderer.invoke('localExplorer/list', { rootPath, relPath }),
    mkdir: (rootPath, relPath, folderName) => ipcRenderer.invoke('localExplorer/mkdir', { rootPath, relPath, folderName }),
    upload: (rootPath, destRelPath) => ipcRenderer.invoke('localExplorer/upload', { rootPath, destRelPath }),
    delete: (rootPath, relPath) => ipcRenderer.invoke('localExplorer/delete', { rootPath, relPath }),
    rename: (rootPath, relPath, newName) => ipcRenderer.invoke('localExplorer/rename', { rootPath, relPath, newName }),
    move: (rootPath, srcRelPath, destDirRelPath) =>
      ipcRenderer.invoke('localExplorer/move', { rootPath, srcRelPath, destDirRelPath }),
    open: (rootPath, relPath) => ipcRenderer.invoke('localExplorer/open', { rootPath, relPath }),
  },
  explorer: {
    list: (projectName, relPath = '', opts = {}) => ipcRenderer.invoke('explorer/list', { projectName, relPath, ...opts }),
    readText: (projectName, relPath, opts = {}) => ipcRenderer.invoke('explorer/readText', { projectName, relPath, ...opts }),
    mkdir: (projectName, relPath, folderName, opts = {}) => ipcRenderer.invoke('explorer/mkdir', { projectName, relPath, folderName, ...opts }),
    upload: (projectName, destRelPath, opts = {}) => ipcRenderer.invoke('explorer/upload', { projectName, destRelPath, ...opts }),
    delete: (projectName, relPath, opts = {}) => ipcRenderer.invoke('explorer/delete', { projectName, relPath, ...opts }),
    rename: (projectName, relPath, newName, opts = {}) => ipcRenderer.invoke('explorer/rename', { projectName, relPath, newName, ...opts }),
    move: (projectName, srcRelPath, destDirRelPath, opts = {}) =>
      ipcRenderer.invoke('explorer/move', { projectName, srcRelPath, destDirRelPath, ...opts }),
    open: (projectName, relPath, opts = {}) => ipcRenderer.invoke('explorer/open', { projectName, relPath, ...opts }),
  },
  meta: {
    getFolderInfo: (projectName, relPath, opts = {}) => ipcRenderer.invoke('meta/getFolderInfo', { projectName, relPath, ...opts }),
    setFolderDescription: (projectName, relPath, description, opts = {}) =>
      ipcRenderer.invoke('meta/setFolderDescription', { projectName, relPath, description, ...opts }),
  },
  aiStorage: {
    list: (projectName, opts = {}) => ipcRenderer.invoke('aiStorage/list', { projectName, ...opts }),
    accept: (projectName, sourceRelPath, opts = {}) => ipcRenderer.invoke('aiStorage/accept', { projectName, sourceRelPath, ...opts }),
    reject: (projectName, sourceRelPath, opts = {}) => ipcRenderer.invoke('aiStorage/reject', { projectName, sourceRelPath, ...opts }),
    acceptAll: (projectName, opts = {}) => ipcRenderer.invoke('aiStorage/acceptAll', { projectName, ...opts }),
    rejectAll: (projectName, opts = {}) => ipcRenderer.invoke('aiStorage/rejectAll', { projectName, ...opts }),
  },
});

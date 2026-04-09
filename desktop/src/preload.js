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
    testLlm: (config) => ipcRenderer.invoke('prefs/testLlm', config),
    getDataDir: () => ipcRenderer.invoke('prefs/getDataDir'),
    chooseDataDir: () => ipcRenderer.invoke('prefs/chooseDataDir'),
    setDataDir: (newPath) => ipcRenderer.invoke('prefs/setDataDir', { newPath }),
    resetDataDir: () => ipcRenderer.invoke('prefs/resetDataDir'),
    restartApp: () => ipcRenderer.invoke('prefs/restartApp'),
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
  knowledge: {
    list: (projectName, filters = {}, opts = {}) => ipcRenderer.invoke('knowledge/list', { projectName, ...filters, ...opts }),
    get: (projectName, id, opts = {}) => ipcRenderer.invoke('knowledge/get', { projectName, id, ...opts }),
    create: (projectName, item, opts = {}) => ipcRenderer.invoke('knowledge/create', { projectName, ...item, ...opts }),
    update: (projectName, id, patch, opts = {}) => ipcRenderer.invoke('knowledge/update', { projectName, id, patch, ...opts }),
    delete: (projectName, id, opts = {}) => ipcRenderer.invoke('knowledge/delete', { projectName, id, ...opts }),
    addLink: (projectName, itemId, targetPath, targetKind, opts = {}) =>
      ipcRenderer.invoke('knowledge/addLink', { projectName, itemId, targetPath, targetKind, ...opts }),
    removeLink: (projectName, linkId, opts = {}) => ipcRenderer.invoke('knowledge/removeLink', { projectName, linkId, ...opts }),
    removeLinkByItem: (projectName, itemId, targetPath, opts = {}) =>
      ipcRenderer.invoke('knowledge/removeLink', { projectName, itemId, targetPath, ...opts }),
    getLinks: (projectName, itemId, opts = {}) => ipcRenderer.invoke('knowledge/getLinks', { projectName, itemId, ...opts }),
    getLinkedItems: (projectName, targetPath, opts = {}) =>
      ipcRenderer.invoke('knowledge/getLinkedItems', { projectName, targetPath, ...opts }),
    search: (projectName, query, opts = {}) => ipcRenderer.invoke('knowledge/search', { projectName, query, ...opts }),
    stats: (projectName, opts = {}) => ipcRenderer.invoke('knowledge/stats', { projectName, ...opts }),
    createWebclip: (projectName, url, opts = {}) => ipcRenderer.invoke('knowledge/createWebclip', { projectName, url, ...opts }),
    addWebclipImage: (projectName, itemId, pngBuffer, opts = {}) => ipcRenderer.invoke('knowledge/addWebclipImage', { projectName, itemId, pngBuffer, ...opts }),
    listGlobal: (filters = {}) => ipcRenderer.invoke('knowledge/listGlobal', filters),
    statsGlobal: () => ipcRenderer.invoke('knowledge/statsGlobal'),
    createDraft: (item) => ipcRenderer.invoke('knowledge/createDraft', item),
    assignDraft: (itemId, targetProjectName, targetDomain) => ipcRenderer.invoke('knowledge/assignDraft', { itemId, targetProjectName, targetDomain }),
    listDrafts: (filters = {}) => ipcRenderer.invoke('knowledge/listDrafts', filters),
    listProjects: () => ipcRenderer.invoke('knowledge/listProjects'),
    subscribe: (cb) => {
      if (typeof cb !== 'function') return () => {};
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('knowledge:changed', handler);
      return () => ipcRenderer.removeListener('knowledge:changed', handler);
    },
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
    reject: (projectName, sourceRelPath, opts = {}) => ipcRenderer.invoke('aiStorage/reject', { projectName, sourceRelPath, userFeedback: opts.userFeedback || null, ...opts }),
    acceptAll: (projectName, opts = {}) => ipcRenderer.invoke('aiStorage/acceptAll', { projectName, ...opts }),
    rejectAll: (projectName, opts = {}) => ipcRenderer.invoke('aiStorage/rejectAll', { projectName, ...opts }),
    getTrace: (projectName, sourceRelPath, opts = {}) => ipcRenderer.invoke('aiStorage/getTrace', { projectName, sourceRelPath, ...opts }),
  },
  classifyRules: {
    list: (projectName, opts = {}) => ipcRenderer.invoke('classifyRules/list', { projectName, ...opts }),
    add: (projectName, rule, opts = {}) => ipcRenderer.invoke('classifyRules/add', { projectName, rule, ...opts }),
    update: (projectName, ruleId, patch, opts = {}) => ipcRenderer.invoke('classifyRules/update', { projectName, ruleId, patch, ...opts }),
    delete: (projectName, ruleId, opts = {}) => ipcRenderer.invoke('classifyRules/delete', { projectName, ruleId, ...opts }),
    reorder: (projectName, ruleIds, opts = {}) => ipcRenderer.invoke('classifyRules/reorder', { projectName, ruleIds, ...opts }),
  },
  preferences: {
    list: (projectName, opts = {}) => ipcRenderer.invoke('preferences/list', { projectName, ...opts }),
    add: (projectName, pref, opts = {}) => ipcRenderer.invoke('preferences/add', { projectName, pref, ...opts }),
    update: (projectName, prefId, patch, opts = {}) => ipcRenderer.invoke('preferences/update', { projectName, prefId, patch, ...opts }),
    delete: (projectName, prefId, opts = {}) => ipcRenderer.invoke('preferences/delete', { projectName, prefId, ...opts }),
    parseNaturalLanguage: (projectName, text, opts = {}) =>
      ipcRenderer.invoke('preferences/parseNaturalLanguage', { projectName, text, ...opts }),
  },
  classifyEvents: {
    list: (projectName, opts = {}) => ipcRenderer.invoke('classifyEvents/list', { projectName, ...opts }),
    updateFeedback: (projectName, eventId, feedback, opts = {}) =>
      ipcRenderer.invoke('classifyEvents/updateFeedback', { projectName, eventId, feedback, ...opts }),
  },
  classify: {
    getSnapshot: (projectName) => ipcRenderer.invoke('classify:getSnapshot', { projectName }),
    clearCompleted: (projectName) => ipcRenderer.invoke('classify:clearCompleted', { projectName }),
    onStatusChanged: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('classify:status-changed', handler);
      return () => ipcRenderer.removeListener('classify:status-changed', handler);
    },
  },
  agent: {
    sendMessage: (projectName, domain, message) =>
      ipcRenderer.invoke('projectAgent/sendMessage', { projectName, domain, message }),
    executePlan: (projectName, domain, plan, selectedIds) =>
      ipcRenderer.invoke('projectAgent/executePlan', { projectName, domain, plan, selectedIds }),
    cancelPlan: (projectName, domain) =>
      ipcRenderer.invoke('projectAgent/cancelPlan', { projectName, domain }),
    endSession: (projectName, domain) =>
      ipcRenderer.invoke('projectAgent/endSession', { projectName, domain }),
    getSessionInfo: (projectName, domain) =>
      ipcRenderer.invoke('projectAgent/getSessionInfo', { projectName, domain }),
    resumeSession: (projectName, domain, sessionId) =>
      ipcRenderer.invoke('projectAgent/resumeSession', { projectName, domain, sessionId }),
    listSessions: (projectName, domain, opts = {}) =>
      ipcRenderer.invoke('projectAgent/listSessions', { projectName, domain, ...opts }),
    loadSession: (projectName, domain, sessionId) =>
      ipcRenderer.invoke('projectAgent/loadSession', { projectName, domain, sessionId }),
    deleteSession: (projectName, domain, sessionId) =>
      ipcRenderer.invoke('projectAgent/deleteSession', { projectName, domain, sessionId }),
    undoAction: (projectName, domain, actionId) =>
      ipcRenderer.invoke('projectAgent/undoAction', { projectName, domain, actionId }),
    onStreamEvent: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('projectAgent:stream-event', handler);
      return () => ipcRenderer.removeListener('projectAgent:stream-event', handler);
    },
  },
  board: {
    list: () => ipcRenderer.invoke('board/list'),
    create: (name) => ipcRenderer.invoke('board/create', { name }),
    rename: (id, name) => ipcRenderer.invoke('board/rename', { id, name }),
    delete: (id) => ipcRenderer.invoke('board/delete', { id }),
    setMain: (id) => ipcRenderer.invoke('board/setMain', { id }),
    getItems: (boardId) => ipcRenderer.invoke('board/getItems', { boardId }),
    addItem: (payload) => ipcRenderer.invoke('board/addItem', payload),
    removeItem: (id) => ipcRenderer.invoke('board/removeItem', { id }),
    updateLayout: (boardId, items) => ipcRenderer.invoke('board/updateLayout', { boardId, items }),
    createAndAdd: (payload) => ipcRenderer.invoke('board/createAndAdd', payload),
    stats: () => ipcRenderer.invoke('board/stats'),
    listConnections: (boardId) => ipcRenderer.invoke('board/listConnections', { boardId }),
    addConnection: (payload) => ipcRenderer.invoke('board/addConnection', payload),
    removeConnection: (id) => ipcRenderer.invoke('board/removeConnection', { id }),
    listGroups: (boardId) => ipcRenderer.invoke('board/listGroups', { boardId }),
    createGroup: (payload) => ipcRenderer.invoke('board/createGroup', payload),
    updateGroup: (id, patch) => ipcRenderer.invoke('board/updateGroup', { id, patch }),
    deleteGroup: (id) => ipcRenderer.invoke('board/deleteGroup', { id }),
    lockItem: (id) => ipcRenderer.invoke('board/lockItem', { id }),
    unlockItem: (id) => ipcRenderer.invoke('board/unlockItem', { id }),
    lockGroup: (id) => ipcRenderer.invoke('board/lockGroup', { id }),
    unlockGroup: (id) => ipcRenderer.invoke('board/unlockGroup', { id }),
    updateBoardStyle: (id, bgStyle, bgColor) => ipcRenderer.invoke('board/updateBoardStyle', { id, bgStyle, bgColor }),
    convertBoardToGroup: (sourceBoardId, groupX, groupY) => ipcRenderer.invoke('board/convertBoardToGroup', { sourceBoardId, groupX, groupY }),
    convertGroupToBoard: (groupId) => ipcRenderer.invoke('board/convertGroupToBoard', { groupId }),
    listTimelines: (boardId) => ipcRenderer.invoke('board/listTimelines', { boardId }),
    createTimeline: (data) => ipcRenderer.invoke('board/createTimeline', data),
    updateTimeline: (id, patch) => ipcRenderer.invoke('board/updateTimeline', { id, patch }),
    deleteTimeline: (id) => ipcRenderer.invoke('board/deleteTimeline', { id }),
    addTimelinePoint: (data) => ipcRenderer.invoke('board/addTimelinePoint', data),
    updateTimelinePoint: (id, patch) => ipcRenderer.invoke('board/updateTimelinePoint', { id, patch }),
    deleteTimelinePoint: (id) => ipcRenderer.invoke('board/deleteTimelinePoint', { id }),
  },
  supervisor: {
    sendMessage: (message) =>
      ipcRenderer.invoke('supervisor/sendMessage', { message }),
    executePlan: (plan, selectedIds) =>
      ipcRenderer.invoke('supervisor/executePlan', { plan, selectedIds }),
    cancelPlan: () =>
      ipcRenderer.invoke('supervisor/cancelPlan'),
    endSession: () =>
      ipcRenderer.invoke('supervisor/endSession'),
    getSessionInfo: () =>
      ipcRenderer.invoke('supervisor/getSessionInfo'),
    resumeSession: (sessionId) =>
      ipcRenderer.invoke('supervisor/resumeSession', { sessionId }),
    listSessions: (opts = {}) =>
      ipcRenderer.invoke('supervisor/listSessions', opts),
    loadSession: (sessionId) =>
      ipcRenderer.invoke('supervisor/loadSession', { sessionId }),
    deleteSession: (sessionId) =>
      ipcRenderer.invoke('supervisor/deleteSession', { sessionId }),
    setAutonomousMode: (enabled) =>
      ipcRenderer.invoke('supervisor/setAutonomousMode', { enabled }),
    getNotifications: (opts = {}) =>
      ipcRenderer.invoke('supervisor/getNotifications', opts),
    markNotificationRead: (id, all = false) =>
      ipcRenderer.invoke('supervisor/markNotificationRead', { id, all }),
    listPreferenceCandidates: (opts = {}) =>
      ipcRenderer.invoke('supervisor/listPreferenceCandidates', opts),
    acceptPreferenceCandidate: (id) =>
      ipcRenderer.invoke('supervisor/acceptPreferenceCandidate', { id }),
    dismissPreferenceCandidate: (id) =>
      ipcRenderer.invoke('supervisor/dismissPreferenceCandidate', { id }),
    checkPreferenceExtraction: () =>
      ipcRenderer.invoke('supervisor/checkPreferenceExtraction'),
    runPreferenceExtraction: () =>
      ipcRenderer.invoke('supervisor/runPreferenceExtraction'),
    rejectPreferenceExtraction: () =>
      ipcRenderer.invoke('supervisor/rejectPreferenceExtraction'),
    listSkills: () =>
      ipcRenderer.invoke('supervisor/listSkills'),
    getSkill: (skillName) =>
      ipcRenderer.invoke('supervisor/getSkill', { skillName }),
    setSkillMaturity: (skillName, maturity) =>
      ipcRenderer.invoke('supervisor/setSkillMaturity', { skillName, maturity }),
    deleteSkill: (skillName) =>
      ipcRenderer.invoke('supervisor/deleteSkill', { skillName }),
    listSkillExecutions: (opts = {}) =>
      ipcRenderer.invoke('supervisor/listSkillExecutions', opts),
    onStreamEvent: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('supervisor:stream-event', handler);
      return () => ipcRenderer.removeListener('supervisor:stream-event', handler);
    },
  },
  search: {
    global: (query) => ipcRenderer.invoke('search/global', { query }),
    project: (projectName, domain, query) => ipcRenderer.invoke('search/project', { projectName, domain, query }),
  },
  analytics: {
    flush: (events, userName) => ipcRenderer.invoke('analytics/flush', { events, userName }),
    getDataPath: () => ipcRenderer.invoke('analytics/getDataPath'),
  },
});

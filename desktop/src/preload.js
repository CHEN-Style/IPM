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
    testSearchApi: (config) => ipcRenderer.invoke('prefs/testSearchApi', config),
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
  // F3 OCR: 内置 PaddleOCR PP-OCRv5 mobile（中/英）
  //   - recognize(imagePath, { lang })       → 用绝对路径读取图片识别
  //   - recognizeBuffer(buffer, { lang })    → 直接传 PNG/JPEG 二进制
  //   - status()                              → 查询模型加载状态、当前语言、模型目录
  // 返回结构：{ ok, result: { text, lines, confidence, lang } } 或 { ok:false, error }
  ocr: {
    recognize: (imagePath, opts = {}) => ipcRenderer.invoke('ocr/recognize', { imagePath, ...opts }),
    recognizeBuffer: (buffer, opts = {}) => ipcRenderer.invoke('ocr/recognizeBuffer', { buffer, ...opts }),
    status: () => ipcRenderer.invoke('ocr/status'),
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
    removeWebclipImage: (projectName, itemId, imagePath, opts = {}) => ipcRenderer.invoke('knowledge/removeWebclipImage', { projectName, itemId, imagePath, ...opts }),
    // F3: 手动触发 OCR — 返回 { ok, recognized, text, confidence, lang }；
    // 会同步写回原碎片 + 产出独立 snippet 知识碎片。
    runOcr: (projectName, itemId, opts = {}) => ipcRenderer.invoke('knowledge/runOcr', { projectName, itemId, ...opts }),
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
    // W1: create(name) 兼容旧调用；create(name, { template }) 支持模板选择。
    // 模板取值：'default'（含四类业务夹）/ 'blank'（仅系统目录）。
    create: (name, opts) => ipcRenderer.invoke('projects/create', { name, template: opts?.template }),
    getCurrent: () => ipcRenderer.invoke('projects/getCurrent'),
    setCurrent: (name) => ipcRenderer.invoke('projects/setCurrent', { name }),
    setStatus: (name, status) => ipcRenderer.invoke('projects/setStatus', { name, status }),
    delete: (name) => ipcRenderer.invoke('projects/delete', { name }),
    // W3b: 项目重命名（联动 state / structure / DB 引用）
    rename: (oldName, newName) => ipcRenderer.invoke('projects/rename', { oldName, newName }),
    // F1: 外部文件夹「附属导入」。importAttached() 弹出系统文件夹选择对话框；
    // relocateAttached(name) 重新定位失效的外部根；refreshAttached(name) 手动重新扫描。
    importAttached: (path) => ipcRenderer.invoke('projects/importAttached', { path }),
    relocateAttached: (name, newPath) => ipcRenderer.invoke('projects/relocateAttached', { name, newPath }),
    refreshAttached: (name) => ipcRenderer.invoke('projects/refreshAttached', { name }),
  },
  cases: {
    list: () => ipcRenderer.invoke('cases/list'),
    create: (name, opts) => ipcRenderer.invoke('cases/create', { name, template: opts?.template }),
    getCurrent: () => ipcRenderer.invoke('cases/getCurrent'),
    setCurrent: (name) => ipcRenderer.invoke('cases/setCurrent', { name }),
    setStatus: (name, status) => ipcRenderer.invoke('cases/setStatus', { name, status }),
    delete: (name) => ipcRenderer.invoke('cases/delete', { name }),
    rename: (oldName, newName) => ipcRenderer.invoke('cases/rename', { oldName, newName }),
    // F1: 同 projects.*Attached
    importAttached: (path) => ipcRenderer.invoke('cases/importAttached', { path }),
    relocateAttached: (name, newPath) => ipcRenderer.invoke('cases/relocateAttached', { name, newPath }),
    refreshAttached: (name) => ipcRenderer.invoke('cases/refreshAttached', { name }),
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
    dropUpload: (projectName, destRelPath, filePaths, opts = {}) => ipcRenderer.invoke('explorer/drop-upload', { projectName, destRelPath, filePaths, ...opts }),
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
  search: {
    global: (query) => ipcRenderer.invoke('search/global', { query }),
    project: (projectName, domain, query) => ipcRenderer.invoke('search/project', { projectName, domain, query }),
  },
  analytics: {
    flush: (events, userName) => ipcRenderer.invoke('analytics/flush', { events, userName }),
    getDataPath: () => ipcRenderer.invoke('analytics/getDataPath'),
  },
  knowclaw: {
    // U8b-3: `images` is an optional second argument carrying an array
    // of `{ mimeType, data }` objects (data = base64 string without
    // the `data:...;base64,` prefix). Main-process validates and
    // forwards it to `AgentSession.prompt(text, { images })`. Older
    // call sites that only pass `message` keep working unchanged
    // because `images` defaults to undefined and the IPC handler
    // sanitises non-arrays down to `[]`.
    send: (message, images) => ipcRenderer.invoke('knowclaw:send', { message, images }),
    abort: () => ipcRenderer.invoke('knowclaw:abort'),
    // U4: steer / followUp / clearQueue. `steer` injects an interrupt
    // at the next tool-call boundary; `followUp` queues the message
    // and lets pi drain it when the current task settles; `clearQueue`
    // drops everything still waiting in either lane.
    // U8b-3: steer/followUp accept the same optional `images` arg.
    steer: (message, images) => ipcRenderer.invoke('knowclaw:steer', { message, images }),
    followUp: (message, images) => ipcRenderer.invoke('knowclaw:followUp', { message, images }),
    clearQueue: () => ipcRenderer.invoke('knowclaw:clearQueue'),
    // U5: manual context compaction. `customInstructions` is an
    // optional plain string that pi appends to its summarization
    // prompt; the V2 UI currently passes undefined (auto behaviour).
    compact: (customInstructions) =>
      ipcRenderer.invoke('knowclaw:compact', { customInstructions }),
    // U6: persistent sub-agent kill-switch. When disabled, the next
    // session is created without the `delegate_task` customTool so
    // the model can't even see it. Toggling does NOT mutate the
    // active session — change takes effect on the next new/open/fork.
    getSubAgentEnabled: () => ipcRenderer.invoke('knowclaw:getSubAgentEnabled'),
    setSubAgentEnabled: (enabled) =>
      ipcRenderer.invoke('knowclaw:setSubAgentEnabled', { enabled: Boolean(enabled) }),
    newSession: () => ipcRenderer.invoke('knowclaw:newSession'),
    continueRecent: () => ipcRenderer.invoke('knowclaw:continueRecent'),
    listModels: () => ipcRenderer.invoke('knowclaw:listModels'),
    setModel: (providerId, modelId) => ipcRenderer.invoke('knowclaw:setModel', { providerId, modelId }),
    setThinkingLevel: (level) => ipcRenderer.invoke('knowclaw:setThinkingLevel', { level }),
    // U1: dynamic workspace controls. `setCwd(null)` returns to global
    // mode (cwd = userfile root); any non-null value must be an
    // absolute directory path that exists on disk.
    setCwd: (cwd) => ipcRenderer.invoke('knowclaw:setCwd', { cwd }),
    getCwd: () => ipcRenderer.invoke('knowclaw:getCwd'),
    listWorkspaces: () => ipcRenderer.invoke('knowclaw:listWorkspaces'),
    chooseDirectory: () => ipcRenderer.invoke('knowclaw:chooseDirectory'),
    createWorkspace: (label) => ipcRenderer.invoke('knowclaw:createWorkspace', { label }),
    // Open a workspace folder in the OS file manager. Pass `null` /
    // omit `path` to open the *active* workspace.
    // K2: also handles file paths (shell.openPath handles both).
    openInExplorer: (folderPath) =>
      ipcRenderer.invoke('knowclaw:openInExplorer', { path: folderPath || null }),
    // K2: list the active workspace's file tree (flat node list with
    // depth/size). `path` overrides the active cwd; `depth` defaults
    // to 3 (capped at 6). Returns `{ ok, cwd, global, entries, truncated }`.
    listWorkspaceTree: (folderPath, depth) =>
      ipcRenderer.invoke('knowclaw:listWorkspaceTree', { path: folderPath || null, depth }),
    // E.7: copy external files (absolute paths from drag-drop) into the
    // current workspace at `destRelDir` (relative to cwd, '' for root).
    // Returns `{ ok, uploaded: [{ name, relPath, size, src }], skipped }`.
    uploadToWorkspace: (filePaths, destRelDir) =>
      ipcRenderer.invoke('knowclaw:uploadToWorkspace', {
        filePaths: Array.isArray(filePaths) ? filePaths : [],
        destRelDir: destRelDir || '',
      }),
    // U1 hotfix-2: persistent pin / hide of arbitrary workspace
    // paths so the dropdown can act as the user's curated list
    // rather than a derived view of the filesystem.
    pinWorkspace: (folderPath) =>
      ipcRenderer.invoke('knowclaw:pinWorkspace', { path: folderPath }),
    hideWorkspace: (folderPath) =>
      ipcRenderer.invoke('knowclaw:hideWorkspace', { path: folderPath }),
    getStatus: () => ipcRenderer.invoke('knowclaw:getStatus'),
    // D.1: cold-start state recovery. Returns the live session's
    // messages / tasks / streaming flag so the renderer can repaint
    // the chat after an Electron / devtools reload without making
    // the user manually `openSession`. No-op (returns
    // `{ ok: false, hasSession: false }`) when no session is live.
    rehydrate: () => ipcRenderer.invoke('knowclaw:rehydrate'),
    rescanBash: () => ipcRenderer.invoke('knowclaw:rescanBash'),
    listSessions: () => ipcRenderer.invoke('knowclaw:listSessions'),
    openSession: (sessionFile) => ipcRenderer.invoke('knowclaw:openSession', { sessionFile }),
    deleteSession: (sessionFile) => ipcRenderer.invoke('knowclaw:deleteSession', { sessionFile }),
    forkSession: (sessionFile, entryIndex) =>
      ipcRenderer.invoke('knowclaw:forkSession', { sessionFile, entryIndex }),
    onEvent: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('knowclaw:event', handler);
      return () => ipcRenderer.removeListener('knowclaw:event', handler);
    },
    // U3: install-confirmation roundtrip. Main process gates every
    // `pip install` / `npm install` (and friends) issued by the
    // model — it pushes a `knowclaw:confirm-install` event with a
    // `{ requestId, manager, packages, command, cwd }` payload, then
    // awaits the renderer's reply via `replyConfirmInstall`.
    onConfirmInstall: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('knowclaw:confirm-install', handler);
      return () => ipcRenderer.removeListener('knowclaw:confirm-install', handler);
    },
    replyConfirmInstall: (requestId, allow) =>
      ipcRenderer.invoke('knowclaw:confirm-install-reply', { requestId, allow: Boolean(allow) }),

    // ---- E.5: Plan-mode toggle + ask_user roundtrip ----
    // setPlanMode flips the in-memory flag in main; takes effect on the
    // very next prompt/steer/followUp via the [MODE: plan] tag injection.
    setPlanMode: (enabled) =>
      ipcRenderer.invoke('knowclaw:setPlanMode', Boolean(enabled)),
    getPlanMode: () => ipcRenderer.invoke('knowclaw:getPlanMode'),
    // onAskUser: subscribe to the `knowclaw:askUser` push event. Payload:
    //   { requestId: string,
    //     questions: Array<{ id, prompt, options: [{id,label}], allow_multiple? }> }
    // Returns an unsubscribe function.
    onAskUser: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('knowclaw:askUser', handler);
      return () => ipcRenderer.removeListener('knowclaw:askUser', handler);
    },
    // replyAskUser: send the user's selections back to the waiting tool.
    // `answers` shape: { [questionId]: optionId | optionId[] }.
    // Pass `{ cancelled: true }` as the second arg to abandon the prompt.
    replyAskUser: (requestId, answers, opts) =>
      ipcRenderer.invoke('knowclaw:askUserReply', {
        requestId,
        answers: answers && typeof answers === 'object' ? answers : null,
        cancelled: Boolean(opts?.cancelled),
      }),
  },
});

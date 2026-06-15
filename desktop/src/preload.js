import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('ipm', {
  ping: () => ipcRenderer.invoke('app/ping'),
  ui: {
    openFloating: () => ipcRenderer.invoke('ui/openFloating'),
    backToMain: () => ipcRenderer.invoke('ui/backToMain'),
    resizeFloating: (width, height) => ipcRenderer.invoke('ui/resizeFloating', { width, height }),
    // FK6-1: floating → main bridge that also re-binds KnowClaw cwd
    // to `_floating`. Returns one of:
    //   { ok: true }
    //   { ok: false, blocked: true, reason: 'main_knowclaw_streaming' }
    //   { ok: false, reason: 'timeout' | 'no_main_window' | ... }
    backToFloatingWorkspace: () => ipcRenderer.invoke('ui/backToFloatingWorkspace'),
    // FK6-1 (main-window side): subscribe to "请打开 _floating 工作空间"
    // requests pushed by `ui/backToFloatingWorkspace`. Callback receives
    // `{ requestId }`; reply with `ui.replyOpenFloatingWorkspace(requestId, result)`.
    onOpenFloatingWorkspaceRequest: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_evt, data) => callback(data);
      ipcRenderer.on('ui:openFloatingWorkspaceRequest', handler);
      return () => ipcRenderer.removeListener('ui:openFloatingWorkspaceRequest', handler);
    },
    replyOpenFloatingWorkspace: (requestId, result) =>
      ipcRenderer.invoke('ui/replyOpenFloatingWorkspace', { requestId, result }),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs/get'),
    set: (patch) => ipcRenderer.invoke('prefs/set', { patch }),
    testLlm: (config) => ipcRenderer.invoke('prefs/testLlm', config),
    // 多 Provider 升级：以下三个接口让设置页能枚举 / 测试 / 元数据查询
    listAiModels: (provider) => ipcRenderer.invoke('prefs/listAiModels', { provider }),
    testAiProvider: (provider, modelId) => ipcRenderer.invoke('prefs/testAiProvider', { provider, modelId }),
    getAiMeta: () => ipcRenderer.invoke('prefs/getAiMeta'),
    onUpdated: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_evt, payload) => callback(payload);
      ipcRenderer.on('prefs:updated', handler);
      return () => ipcRenderer.removeListener('prefs:updated', handler);
    },
    testSearchApi: (config) => ipcRenderer.invoke('prefs/testSearchApi', config),
    orgConfig: {
      createTemplate: (payload) =>
        ipcRenderer.invoke('prefs/orgConfig/createTemplate', {
          name: typeof payload?.name === 'string' ? payload.name : undefined,
          description: typeof payload?.description === 'string' ? payload.description : undefined,
          maxUses: Number.isInteger(payload?.maxUses) ? payload.maxUses : null,
          expiresAt: typeof payload?.expiresAt === 'string' ? payload.expiresAt : null,
        }),
      listTemplates: () => ipcRenderer.invoke('prefs/orgConfig/listTemplates'),
      rotateCode: (id) => ipcRenderer.invoke('prefs/orgConfig/rotateCode', { id }),
      disableTemplate: (id) => ipcRenderer.invoke('prefs/orgConfig/disableTemplate', { id }),
      enableTemplate: (id) => ipcRenderer.invoke('prefs/orgConfig/enableTemplate', { id }),
      updateTemplate: (id, patch) =>
        ipcRenderer.invoke('prefs/orgConfig/updateTemplate', {
          id,
          name: typeof patch?.name === 'string' ? patch.name : undefined,
          description: typeof patch?.description === 'string' ? patch.description : undefined,
          maxUses: patch?.maxUses === null || Number.isInteger(patch?.maxUses) ? patch.maxUses : undefined,
          expiresAt: patch?.expiresAt === null || typeof patch?.expiresAt === 'string' ? patch.expiresAt : undefined,
        }),
      listUses: (id) => ipcRenderer.invoke('prefs/orgConfig/listUses', { id }),
      previewCode: (code) => ipcRenderer.invoke('prefs/orgConfig/previewCode', { code }),
      importCode: (code) => ipcRenderer.invoke('prefs/orgConfig/importCode', { code }),
    },
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
    // FK5-1: pull the most recent PNG buffer cached by the main-process
    // clipboard watcher. Returns
    //   { ok:true, pngBuffer, width, height, token, ageMs }
    // or { ok:false, reason:'no_image'|'expired'|'error' }. Buffer is
    // structured-cloned across IPC; renderer receives a Uint8Array view.
    getLatestImage: () => ipcRenderer.invoke('clipboard/getLatestImage'),
  },
  // FK4 + FK5: full-screen capture + capture/note persistence helpers.
  // All three resolve via `ipcMain.handle` in `desktop/src/main/ipc/capture.js`.
  capture: {
    fullScreen: () => ipcRenderer.invoke('capture/fullScreen'),
    saveArtifacts: (payload) =>
      ipcRenderer.invoke('capture/saveArtifacts', payload || {}),
    saveNote: (content, opts = {}) =>
      ipcRenderer.invoke('capture/saveNote', { content, ...opts }),
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
    //
    // Skill Selector: optional `pinnedSkills` arg carries an array of
    // skill names the user pinned for this turn. The main process
    // resolves each name to its SKILL.md and prepends the bodies to
    // `message` as a `<pinned_skills>` XML block so the model can
    // execute the skill without first calling Read.
    send: (message, images, pinnedSkills) =>
      ipcRenderer.invoke('knowclaw:send', {
        message,
        images,
        pinnedSkills: Array.isArray(pinnedSkills) ? pinnedSkills : undefined,
      }),
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
    // `answers` shape: { [questionId]: optionId | optionId[] } where
    // a free-text "其他…" answer is encoded as the wire string
    // `other:<typed text>`. The second arg supports two dismissal verbs:
    //   - `{ cancelled: true }` — user abandoned the whole ask_user
    //   - `{ skipped:   true }` — user let the model decide
    replyAskUser: (requestId, answers, opts) =>
      ipcRenderer.invoke('knowclaw:askUserReply', {
        requestId,
        answers: answers && typeof answers === 'object' ? answers : null,
        cancelled: Boolean(opts?.cancelled),
        skipped:   Boolean(opts?.skipped),
      }),
  },

  // ======================================================================
  // FK0: Floating-window KnowClaw convenience namespace.
  //
  // Mirrors the most commonly used `window.ipm.knowclaw.*` methods but
  // pre-binds every IPC call to `channel: 'floating'`. The main
  // process routes payloads with `channel === 'floating'` to a
  // dedicated `channels.floating` state slot — independent session,
  // independent sender, locked cwd (`userfile/workspaces/_floating/`),
  // independent thinkingLevel / planMode.
  //
  // This keeps the floating-window React tree free from having to
  // remember to pass `{ channel: 'floating' }` on every call (one
  // forgotten arg and you'd silently mutate the main-window session
  // — exactly what RW-FK-5 calls out). It also gives the future
  // macOS-adapter branch a clean template: add a parallel
  // `knowclawMac` namespace if/when needed.
  //
  // We intentionally only expose the subset the floating window
  // actually uses. Phase FK0/FK1 needs send/abort/newSession/
  // continueRecent/getStatus/rehydrate/listSessions/setThinkingLevel
  // plus onEvent (which doesn't take a channel arg — the main
  // process pushes events directly to `ch.sender`, which is the
  // floating window's own WebContents, so the channel binding is
  // implicit in *which* renderer registered the listener). Other
  // methods (steer/followUp/openSession/etc.) are included up-front
  // so FK2–FK6 don't need to revisit this file.
  knowclawFloating: {
    send: (message, images) =>
      ipcRenderer.invoke('knowclaw:send', { message, images, channel: 'floating' }),
    abort: () =>
      ipcRenderer.invoke('knowclaw:abort', { channel: 'floating' }),
    steer: (message, images) =>
      ipcRenderer.invoke('knowclaw:steer', { message, images, channel: 'floating' }),
    followUp: (message, images) =>
      ipcRenderer.invoke('knowclaw:followUp', { message, images, channel: 'floating' }),
    clearQueue: () =>
      ipcRenderer.invoke('knowclaw:clearQueue', { channel: 'floating' }),
    compact: (customInstructions) =>
      ipcRenderer.invoke('knowclaw:compact', { customInstructions, channel: 'floating' }),
    newSession: () =>
      ipcRenderer.invoke('knowclaw:newSession', { channel: 'floating' }),
    continueRecent: () =>
      ipcRenderer.invoke('knowclaw:continueRecent', { channel: 'floating' }),
    getStatus: () =>
      ipcRenderer.invoke('knowclaw:getStatus', { channel: 'floating' }),
    rehydrate: () =>
      ipcRenderer.invoke('knowclaw:rehydrate', { channel: 'floating' }),
    listSessions: () =>
      ipcRenderer.invoke('knowclaw:listSessions', { channel: 'floating' }),
    openSession: (sessionFile) =>
      ipcRenderer.invoke('knowclaw:openSession', { sessionFile, channel: 'floating' }),
    deleteSession: (sessionFile) =>
      ipcRenderer.invoke('knowclaw:deleteSession', { sessionFile, channel: 'floating' }),
    forkSession: (sessionFile, entryIndex) =>
      ipcRenderer.invoke('knowclaw:forkSession', { sessionFile, entryIndex, channel: 'floating' }),
    setThinkingLevel: (level) =>
      ipcRenderer.invoke('knowclaw:setThinkingLevel', { level, channel: 'floating' }),
    getCwd: () =>
      ipcRenderer.invoke('knowclaw:getCwd', { channel: 'floating' }),
    listWorkspaceTree: (folderPath, depth) =>
      ipcRenderer.invoke('knowclaw:listWorkspaceTree', { path: folderPath || null, depth, channel: 'floating' }),
    openInExplorer: (folderPath) =>
      ipcRenderer.invoke('knowclaw:openInExplorer', { path: folderPath || null, channel: 'floating' }),
    uploadToWorkspace: (filePaths, destRelDir) =>
      ipcRenderer.invoke('knowclaw:uploadToWorkspace', {
        filePaths: Array.isArray(filePaths) ? filePaths : [],
        destRelDir: destRelDir || '',
        channel: 'floating',
      }),
    // onEvent / onConfirmInstall / onAskUser have no channel arg —
    // the main process routes events via `ch.sender.send(...)`, which
    // means each window only receives events for its own channel
    // automatically. Registering on `'knowclaw:event'` is correct for
    // both channels; the listener will simply never fire for events
    // owned by the other channel.
    onEvent: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('knowclaw:event', handler);
      return () => ipcRenderer.removeListener('knowclaw:event', handler);
    },
    onConfirmInstall: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('knowclaw:confirm-install', handler);
      return () => ipcRenderer.removeListener('knowclaw:confirm-install', handler);
    },
    replyConfirmInstall: (requestId, allow) =>
      ipcRenderer.invoke('knowclaw:confirm-install-reply', { requestId, allow: Boolean(allow) }),
    onAskUser: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('knowclaw:askUser', handler);
      return () => ipcRenderer.removeListener('knowclaw:askUser', handler);
    },
    replyAskUser: (requestId, answers, opts) =>
      ipcRenderer.invoke('knowclaw:askUserReply', {
        requestId,
        answers: answers && typeof answers === 'object' ? answers : null,
        cancelled: Boolean(opts?.cancelled),
        skipped:   Boolean(opts?.skipped),
      }),
  },

  // ── FK2: bubble window IPC ─────────────────────────────────────
  // Used by the floating window's renderer to control the external
  // assistant bubble, and by the bubble window's renderer to receive
  // content + send expand requests.
  bubble: {
    // FK4-6: third `ocrText` arg is optional. When passed, BubbleView
    // renders a "复制 OCR 原文" button below the AI body so the user
    // can pull the OCR-recognised text into the system clipboard. We
    // do NOT render the OCR text in the bubble itself — full text
    // lives on disk under `_floating/captures/*.ocr.txt`.
    show: (html, thinking, ocrText) =>
      ipcRenderer.invoke('bubble/show', {
        html, thinking: !!thinking, ocrText: typeof ocrText === 'string' ? ocrText : '',
      }),
    hide: () =>
      ipcRenderer.invoke('bubble/hide'),
    setContent: (html, thinking, ocrText) =>
      ipcRenderer.invoke('bubble/setContent', {
        html, thinking: !!thinking, ocrText: typeof ocrText === 'string' ? ocrText : '',
      }),
    expandRequest: () =>
      ipcRenderer.invoke('bubble/expandRequest'),
    onContent: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_e, data) => callback(data);
      ipcRenderer.on('bubble:content', handler);
      return () => ipcRenderer.removeListener('bubble:content', handler);
    },
    onExpandRequest: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = () => callback();
      ipcRenderer.on('bubble:expandRequest', handler);
      return () => ipcRenderer.removeListener('bubble:expandRequest', handler);
    },
  },

  // ── SK0: KnowClaw skill management ─────────────────────────────
  // Mirrors the 7 handlers registered in `main/ipc/skills.js`. All
  // calls are stateless request/response — there's no skill-side
  // event stream. State changes (toggle / import / delete) require a
  // fresh KnowClaw session to take effect; the renderer should
  // surface that nudge in the UI (see `requiresNewSession` flag in
  // the responses).
  skills: {
    // SK4: `list` accepts an optional `opts.cwd` so the main process
    // can also scan `<cwd>/.knowclaw/skills/` and surface workspace-
    // scoped entries. Global mode (no cwd) gives the historical
    // builtin+user-only result.
    list: (opts) =>
      ipcRenderer.invoke('knowclaw:listSkills', {
        cwd: typeof opts?.cwd === 'string' ? opts.cwd : undefined,
      }),
    // SK4: `getContent` accepts `opts.cwd` so the safety check on the
    // main side knows that workspace skill paths are trusted.
    getContent: (filePath, opts) =>
      ipcRenderer.invoke('knowclaw:getSkillContent', {
        filePath,
        cwd: typeof opts?.cwd === 'string' ? opts.cwd : undefined,
      }),
    // SK2: `import` accepts `overwrite` and `newName` in opts. When
    // `newName` is provided and differs from the SKILL.md-declared
    // name, the main process renames the destination dir AND patches
    // SKILL.md's `name:` field so pi SDK sees the new identity.
    import: (srcDir, opts) =>
      ipcRenderer.invoke('knowclaw:importSkill', {
        srcDir,
        overwrite: Boolean(opts?.overwrite),
        newName: typeof opts?.newName === 'string' ? opts.newName : undefined,
      }),
    // SK4: `delete` accepts `opts.cwd` (for workspace skill lookup)
    // and an optional `opts.scope` ('workspace' | 'user') to pin which
    // copy gets removed when both happen to exist with the same name.
    // Default policy (no scope) is workspace-wins-if-present.
    delete: (name, opts) =>
      ipcRenderer.invoke('knowclaw:deleteSkill', {
        name,
        cwd: typeof opts?.cwd === 'string' ? opts.cwd : undefined,
        scope: typeof opts?.scope === 'string' ? opts.scope : undefined,
      }),
    toggle: (name, enabled) =>
      ipcRenderer.invoke('knowclaw:toggleSkill', { name, enabled: Boolean(enabled) }),
    reload: () =>
      ipcRenderer.invoke('knowclaw:reloadSkills'),
    scanExternal: () =>
      ipcRenderer.invoke('knowclaw:scanExternalSkills'),
    // SK2: native folder picker + SKILL.md preview in one round-trip.
    // Returns { ok, dir, name, description, files } on success, or
    // { ok: false, canceled: true } when the user dismisses the dialog.
    chooseDir: () =>
      ipcRenderer.invoke('knowclaw:chooseSkillDir'),
    registryList: (opts) =>
      ipcRenderer.invoke('knowclaw:registryListSkills', {
        q: typeof opts?.q === 'string' ? opts.q : undefined,
      }),
    registryGet: (id) =>
      ipcRenderer.invoke('knowclaw:registryGetSkill', { id }),
    registryPublish: (payload) =>
      ipcRenderer.invoke('knowclaw:registryPublishSkill', {
        skillDir: typeof payload?.skillDir === 'string' ? payload.skillDir : undefined,
        version: typeof payload?.version === 'string' ? payload.version : undefined,
        description: typeof payload?.description === 'string' ? payload.description : undefined,
        cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
      }),
    registryPublishVersion: (payload) =>
      ipcRenderer.invoke('knowclaw:registryPublishVersion', {
        id: typeof payload?.id === 'string' ? payload.id : undefined,
        skillDir: typeof payload?.skillDir === 'string' ? payload.skillDir : undefined,
        version: typeof payload?.version === 'string' ? payload.version : undefined,
        cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
      }),
    registryInstall: (payload) =>
      ipcRenderer.invoke('knowclaw:registryInstallSkill', {
        id: typeof payload?.id === 'string' ? payload.id : undefined,
        versionId: typeof payload?.versionId === 'string' ? payload.versionId : undefined,
        overwrite: Boolean(payload?.overwrite),
        newName: typeof payload?.newName === 'string' ? payload.newName : undefined,
      }),
    registryAdminListReviewQueue: (opts) =>
      ipcRenderer.invoke('knowclaw:registryAdminListReviewQueue', {
        status: typeof opts?.status === 'string' ? opts.status : undefined,
      }),
    registryAdminListOrgUsers: () =>
      ipcRenderer.invoke('knowclaw:registryAdminListOrgUsers'),
    registryAdminReview: (payload) =>
      ipcRenderer.invoke('knowclaw:registryAdminReviewSkill', {
        id: typeof payload?.id === 'string' ? payload.id : undefined,
        decision: typeof payload?.decision === 'string' ? payload.decision : undefined,
        note: typeof payload?.note === 'string' ? payload.note : undefined,
        grants: Array.isArray(payload?.grants) ? payload.grants : undefined,
      }),
    registryAdminGetAccess: (id) =>
      ipcRenderer.invoke('knowclaw:registryAdminGetAccess', { id }),
    registryAdminSetAccess: (payload) =>
      ipcRenderer.invoke('knowclaw:registryAdminSetAccess', {
        id: typeof payload?.id === 'string' ? payload.id : undefined,
        grants: Array.isArray(payload?.grants) ? payload.grants : [],
      }),
    // H5: skill governance additions.
    registryListMine: () =>
      ipcRenderer.invoke('knowclaw:registryListMine'),
    registryAdminOverview: () =>
      ipcRenderer.invoke('knowclaw:registryAdminOverview'),
    registryListInstallers: (id) =>
      ipcRenderer.invoke('knowclaw:registryListInstallers', { id }),
    registryPreview: (payload) =>
      ipcRenderer.invoke('knowclaw:registryPreviewSkill', {
        id: typeof payload?.id === 'string' ? payload.id : undefined,
        versionId: typeof payload?.versionId === 'string' ? payload.versionId : undefined,
      }),
    registryArchive: (id) =>
      ipcRenderer.invoke('knowclaw:registryArchiveSkill', { id }),
    registryUnarchive: (id) =>
      ipcRenderer.invoke('knowclaw:registryUnarchiveSkill', { id }),
  },

  // ── C2: Cloud binding + local workspace scan ───────────────────
  // Offline-only in C2. `getBindingStatus` reads meta/cloud.json;
  // `scanWorkspace` walks the workspace and returns a SHA-256 manifest.
  // `onScanProgress` subscribes to per-file hashing progress pushed on
  // the `cloud:scanProgress` channel; returns an unsubscribe function.
  cloud: {
    getBindingStatus: (params) =>
      ipcRenderer.invoke('cloud/getBindingStatus', params || {}),
    scanWorkspace: (params) =>
      ipcRenderer.invoke('cloud/scanWorkspace', params || {}),
    onScanProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_evt, data) => callback(data);
      ipcRenderer.on('cloud:scanProgress', handler);
      return () => ipcRenderer.removeListener('cloud:scanProgress', handler);
    },
    // C3: publish flow
    publish: (params) => ipcRenderer.invoke('cloud/publish', params || {}),
    cancelPublish: (params) => ipcRenderer.invoke('cloud/cancelPublish', params || {}),
    getLockedWorkspaces: () => ipcRenderer.invoke('cloud/getLockedWorkspaces'),
    onPublishProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_evt, data) => callback(data);
      ipcRenderer.on('cloud:publishProgress', handler);
      return () => ipcRenderer.removeListener('cloud:publishProgress', handler);
    },
    // C4: member join + pull copy
    listWorkspaces: () => ipcRenderer.invoke('cloud/listWorkspaces'),
    joinWorkspace: (params) => ipcRenderer.invoke('cloud/joinWorkspace', params || {}),
    pull: (params) => ipcRenderer.invoke('cloud/pull', params || {}),
    cancelPull: (params) => ipcRenderer.invoke('cloud/cancelPull', params || {}),
    downloadFile: (params) => ipcRenderer.invoke('cloud/downloadFile', params || {}),
    onPullProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_evt, data) => callback(data);
      ipcRenderer.on('cloud:pullProgress', handler);
      return () => ipcRenderer.removeListener('cloud:pullProgress', handler);
    },
    // C5: explicit push/pull sync + milestone versions
    getSyncStatus: (params) => ipcRenderer.invoke('cloud/getSyncStatus', params || {}),
    computeSyncPlan: (params) => ipcRenderer.invoke('cloud/computeSyncPlan', params || {}),
    pushSync: (params) => ipcRenderer.invoke('cloud/pushSync', params || {}),
    pullUpdate: (params) => ipcRenderer.invoke('cloud/pullUpdate', params || {}),
    cancelSync: (params) => ipcRenderer.invoke('cloud/cancelSync', params || {}),
    createMilestone: (params) => ipcRenderer.invoke('cloud/createMilestone', params || {}),
    listVersions: (params) => ipcRenderer.invoke('cloud/listVersions', params || {}),
    // C6: conflict recovery + single-file restore
    listFileHistory: (params) => ipcRenderer.invoke('cloud/listFileHistory', params || {}),
    restoreFileFromVersion: (params) => ipcRenderer.invoke('cloud/restoreFileFromVersion', params || {}),
    onSyncProgress: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = (_evt, data) => callback(data);
      ipcRenderer.on('cloud:syncProgress', handler);
      return () => ipcRenderer.removeListener('cloud:syncProgress', handler);
    },
    // H4: cloud project management hub (visibility / invites / members)
    listPublicWorkspaces: () => ipcRenderer.invoke('cloud/listPublicWorkspaces'),
    joinByCode: (params) => ipcRenderer.invoke('cloud/joinByCode', params || {}),
    getWorkspaceOverview: (params) => ipcRenderer.invoke('cloud/getWorkspaceOverview', params || {}),
    listWorkspaceMembers: (params) => ipcRenderer.invoke('cloud/listWorkspaceMembers', params || {}),
    setMemberRole: (params) => ipcRenderer.invoke('cloud/setMemberRole', params || {}),
    removeMember: (params) => ipcRenderer.invoke('cloud/removeMember', params || {}),
    transferOwner: (params) => ipcRenderer.invoke('cloud/transferOwner', params || {}),
    setVisibility: (params) => ipcRenderer.invoke('cloud/setVisibility', params || {}),
    listInvites: (params) => ipcRenderer.invoke('cloud/listInvites', params || {}),
    createInvite: (params) => ipcRenderer.invoke('cloud/createInvite', params || {}),
    revokeInvite: (params) => ipcRenderer.invoke('cloud/revokeInvite', params || {}),
  },

  // ── C3.5: Authentication ───────────────────────────────────────
  auth: {
    getStatus: () => ipcRenderer.invoke('auth/getStatus'),
    register: (params) => ipcRenderer.invoke('auth/register', params || {}),
    login: (params) => ipcRenderer.invoke('auth/login', params || {}),
    logout: () => ipcRenderer.invoke('auth/logout'),
    useOffline: () => ipcRenderer.invoke('auth/useOffline'),
    switchUser: () => ipcRenderer.invoke('auth/switchUser'),
  },

  // H2: enterprise console — org members & invite management.
  org: {
    getInfo: () => ipcRenderer.invoke('org/getInfo'),
    listMembers: () => ipcRenderer.invoke('org/listMembers'),
    setMemberRole: (params) => ipcRenderer.invoke('org/setMemberRole', params || {}),
    disableMember: (params) => ipcRenderer.invoke('org/disableMember', params || {}),
    restoreMember: (params) => ipcRenderer.invoke('org/restoreMember', params || {}),
    listInvites: () => ipcRenderer.invoke('org/listInvites'),
    createInvite: (params) => ipcRenderer.invoke('org/createInvite', params || {}),
    revokeInvite: (params) => ipcRenderer.invoke('org/revokeInvite', params || {}),
    // H7: enterprise stats & audit
    getStats: () => ipcRenderer.invoke('org/getStats'),
    listEvents: (params) => ipcRenderer.invoke('org/listEvents', params || {}),
    // H3: workspace governance
    listWorkspaces: () => ipcRenderer.invoke('org/listWorkspaces'),
    getWorkspaceDetail: (params) => ipcRenderer.invoke('org/getWorkspaceDetail', params || {}),
    setWorkspaceStatus: (params) => ipcRenderer.invoke('org/setWorkspaceStatus', params || {}),
    transferWorkspaceOwner: (params) => ipcRenderer.invoke('org/transferWorkspaceOwner', params || {}),
    removeWorkspaceMember: (params) => ipcRenderer.invoke('org/removeWorkspaceMember', params || {}),
  },
});

# main 进程结构说明（main.js 及其拆分模块）

本文档用于帮助工程师快速理解 `desktop/src/main.js` 及其拆分后的 IPC 模块，明确各模块职责、依赖关系与扩展方式，便于后续维护与升级。

## 总体结构概览

`main.js` 现在主要承担：
- 进程级初始化：应用启动、目录初始化、窗口创建与剪贴板监听。
- 通用工具/领域函数：路径处理、权限与安全校验、结构/迁移、文件系统操作等。
- IPC 模块注册：通过 `registerXxxIpc(...)` 统一挂载，逻辑实现已拆分到 `src/main/ipc/`。

IPC 拆分后的目标是：让 `main.js` 保持“组装层”，业务逻辑按域拆分，降低耦合与体积。

---

## main.js 的核心职责

### 1) App 初始化与路径根目录
- `getUserFileRoot()`：确定用户数据根目录（开发/生产环境差异）。
- `getProjectsRoot()` / `getCasesRoot()` / `getStudyRoot()` / `getAppRoot()`：固定业务根路径。
- `ensureProjectStructure(...)`：创建项目/案件/学习的默认目录结构与元数据文件。

### 2) 窗口管理与剪贴板监听
- `createMainWindow()`：主窗创建与生命周期管理。
- `createFloatingWindow()`：悬浮窗创建与生命周期管理。
- `startClipboardWatcher()` / `stopClipboardWatcher()`：剪贴板文字与截图监听（用于浮窗功能）。

### 3) 通用工具与领域函数（供 IPC 模块复用）
- 路径与安全：`sanitizeProjectName` / `sanitizeFileName` / `resolveInside` / `normalizeRelPathPosix`
- 文件系统：`safeRmSync` / `trashOrRm` / `ensureUniqueDestPath` / `ensureUniqueDirPath`
- 结构/迁移：`syncStructureJson` / `migrateLegacy*` / `isProtectedRelPath`
- 业务日志：`appendJsonl` 等

---

## IPC 模块拆分（src/main/ipc）

### `app.js`
- 职责：基础信息与健康检查
- 接口：`app/ping`

### `prefs.js`
- 职责：用户偏好读写（`state.json`）
- 接口：`prefs/get`、`prefs/set`

### `meta.js`
- 职责：目录元信息（结构索引、描述）
- 接口：`meta/getFolderInfo`、`meta/setFolderDescription`

### `aiStorage.js`
- 职责：AI 归档建议的暂存与接受/拒绝逻辑
- 接口：`aiStorage/list|accept|reject|acceptAll|rejectAll`

### `explorer.js`
- 职责：项目/案件/学习目录的通用文件管理
- 接口：`explorer/list|readText|open|mkdir|delete|upload|rename|move`

### `projects.js`
- 职责：项目空间管理
- 接口：`projects/list|create|delete|getCurrent|setCurrent|setStatus`
- 特性：处理 Windows 文件锁/残留目录等边界情况（quarantine / 重试）。

### `cases.js`
- 职责：案件空间管理（与 projects 类似）
- 接口：`cases/list|create|delete|getCurrent|setCurrent|setStatus`

### `snippets.js`
- 职责：剪贴板文本知识碎片保存与元信息 CRUD
- 接口：
  - `snippets/saveClipboardText`
  - `snippets/clipboardRecord/list|updateMeta|updateContent|delete`

### `screenshots.js`
- 职责：剪贴板截图保存与索引
- 接口：`screenshots/saveClipboardImage`

### `floating.js`
- 职责：浮窗上传/撤销（写入 temp + 触发 AI 归档）
- 接口：`floating/copyToTemp`、`floating/deleteRelPath`

### `ui.js`
- 职责：窗口切换与尺寸调整
- 接口：`ui/openFloating`、`ui/resizeFloating`、`ui/backToMain`

---

## 运行时依赖关系

- `preload.js` 通过 `contextBridge` 暴露 `window.ipm.*`，所有调用最终映射到 `ipcMain.handle(...)`。
- `ProjectManager.jsx` / `MyDataPage.jsx` 等 UI 组件主要依赖：
  - `projects/cases/explorer/aiStorage/meta/snippets/screenshots/floating`

---

## 维护与扩展指南

1. 新增主进程功能：优先创建新的 `ipc/*.js` 文件并导出 `registerXxxIpc`。
2. 扩展现有域：在对应模块里追加 `ipcMain.handle(...)`，避免直接回写 `main.js`。
3. 工具函数归属：
   - 通用工具继续留在 `main.js`（供模块复用）
   - 如出现明显“可复用子域”，考虑继续拆到 `src/main/services/` 或 `src/main/utils/`
4. 避免循环依赖：IPC 模块只依赖 `main.js` 传入的函数/对象，不反向 import `main.js`。

---

## 常见问题排查

- IPC 未就绪：检查 `registerXxxIpc` 是否在 `app.whenReady()` 中调用。
- 路径异常：优先使用 `resolveInside` 与 `normalizeRelPathPosix` 进行校验。
- Windows 删除失败：确认是否触发了 `safeRmSync`、`trashOrRm` 及 `makeWritableRecursiveSync` 的 fallback 逻辑。


# ProjectManager 页面结构说明（我的资料 / 项目 / 案件 / 学习）

本文档用于帮助工程师快速理解 `ProjectManager.jsx` 以及拆分后的组件/逻辑结构，明确职责边界与扩展方式，便于后续维护与优化。

## 总体结构概览

`ProjectManager.jsx` 现在主要承担：
- 页面级状态编排：根据 domain 决定项目/案件/学习行为。
- 组件拼装：Header、AI 暂存区、列表/树形视图、详情侧栏、弹窗等。
- 逻辑调用编排：组合 hooks 的输入/输出，避免业务逻辑混在 JSX。

拆分目标：让页面“只负责组装”，逻辑按域抽离到 hooks，UI 区块按组件拆分。

---

## UI 组件拆分（project-manager/）

### `HeaderBar.jsx`
- 顶部标题、视图切换、快捷操作入口（新建/上传/AI 分类）
- 只接收 props，不维护业务逻辑

### `AIGhostOverview.jsx`
- AI 暂存区总览（按文件夹分组的待处理建议）
- 批量接受/放弃与单条操作入口

### `RootTable.jsx`
- 根视图列表（项目/案件/学习 + 本地文件夹）
- 项目状态切换与“整理知识”入口

### `EntryTable.jsx`
- 目录列表视图 + Explorer 树视图切换
- 文件/文件夹行操作与拖拽联动

### `ExplorerTree.jsx`
- 树形目录组件（递归渲染）

### `FolderDetailPanel.jsx`
- 右侧详情侧栏（文件夹元信息与简介编辑）

---

## 逻辑 Hooks 拆分（project-manager/hooks）

### `useProjects`
- 项目/案件/学习列表加载
- 当前项目读取与状态切换

### `useExplorerEntries`
- 目录读取/进入/返回
- entries、loading、errorText 状态管理

### `useGhosts`
- AI 暂存区数据加载与分组统计
- 接受/拒绝/批量处理逻辑

### `useClipboardUpload`
- 上传并 AI 分类（copyToTemp + 异步刷新）
- `aiUpload` 进度状态 + input ref 管理

### `useLocalFolders`
- 导入本地文件夹列表管理
- 失效检查与移除逻辑

### `useFolderDetail`
- 详情侧栏开关/加载/保存描述
- system folder 自动处理与过渡动效状态

### `useFolderTree`
- Explorer 视图树节点加载/缓存/刷新
- 展开/收起与 root 预加载

### `useFileActions`
- 新建文件夹/上传/重命名/删除/打开文件
- 与 `refreshEntries`、`refreshGhosts`、`refreshTreeDir` 协同

### `useProjectActions`
- 新建/删除项目
- 进入项目/本地文件夹、返回根视图

### `useDragDrop`
- 拖拽移动逻辑
- 冲突/自引用检测与 UI 提示

### `useResumeRefresh`
- 窗口恢复与可见性变化触发刷新
- 延迟刷新用于等待 AI 暂存写入

---

## 工具函数（project-manager/utils.js）

- `normalizeRelPathPosix`：统一路径格式
- `fmtBytes` / `fmtTime`：文件大小与时间格式化
- `folderDecor`：系统目录（temp/snippets/meta）视觉装饰

---

## 运行时依赖关系

- `window.ipm.*`：来自 `preload` 通过 `contextBridge` 暴露
- UI 主要依赖：
  - `projects/cases/explorer/aiStorage/meta/localExplorer/localFolders/floating`
- 页面内部通过 hooks 组合这些 API，避免在 JSX 中直接编排业务逻辑

---

## 维护与扩展指南

1. 新增 UI 区块：优先拆成独立组件，避免继续放大 `ProjectManager.jsx`。
2. 新增业务逻辑：先考虑加入对应 `useXxx`，页面只做拼装。
3. 复用逻辑：跨页面逻辑优先抽到 `hooks/` 或 `utils.js`。
4. 保持依赖单向：组件依赖 hooks/hooks 依赖 utils，避免反向依赖。

---

## 常见问题排查

- 数据不刷新：检查 `useResumeRefresh` 与 `refreshEntries/refreshGhosts` 是否触发。
- 目录树不更新：确认 `useFolderTree.refreshTreeDir` 是否被调用。
- 上传后无 AI 暂存：检查 `floating/copyToTemp` 是否就绪。



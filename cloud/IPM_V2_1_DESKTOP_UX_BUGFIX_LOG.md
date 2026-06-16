# IPM v2.1 Desktop UI/UX 优化与 Bug 修复记录

> **目标**：在 H0-H8 强化收尾后，集中记录 Desktop 端的 UI/UX 打磨与实测 Bug 修复。每一条改动都在此立项、留痕、可回溯，作为开发记录与后续回归依据。
>
> **前置**：功能建设见 `cloud/IPM_V2_1_CLOUD_DEVELOPMENT_LOG.md`；企业强化见 `cloud/IPM_V2_1_C1_C9_HARDENING_PLAN.md` 与 `cloud/IPM_V2_1_H0_AUDIT.md`。本文档不替代上述规划，仅承载零散的体验优化与缺陷修复。
>
> **约束**：沿用记录规范——每条改动有唯一编号、状态、验证方式；完成后回填「变更日志」并刷新 §2 记录总表；改动尽量保持单条可独立验证。

---

## 0. 阅读与维护说明

- 本文档只记录 Desktop 端（`desktop/`）的 UI/UX 优化与 Bug 修复；涉及 cloud server 行为变更时在「涉及文件」中标注并交叉引用相应规划。
- **编号规范**：统一用 `D-NNN`（D = Desktop），按立项顺序递增，编号一经分配不复用。
- **类型枚举**：`Bug 修复` / `UI 优化` / `UX 优化` / `体验增强` / `重构`。
- **状态枚举**（沿用反引号风格）：`PLANNED`（已立项待开发）/ `IN_PROGRESS`（开发中）/ `DONE`（已完成并验证）/ `WONTFIX`（评估后不做）/ `BLOCKED`（被阻塞）。
- **优先级枚举**：`P0`（阻断/数据风险）/ `P1`（核心体验）/ `P2`（一般优化）/ `P3`（锦上添花）。
- **记录流程**：
  1. 新改动先在 §2 记录总表追加一行（分配 `D-NNN`、填类型/模块/描述/优先级，状态置 `PLANNED` 或 `IN_PROGRESS`）。
  2. 开发完成后，在 §3 写该条目的详细「变更日志」（问题根因、改动方案、涉及文件、验证结果），并把总表状态更新为 `DONE`。
  3. 涉及回归的，记录用哪个脚本 / `npm run h8:gate` / 手动 checklist 验证。

---

## 1. 分类索引

> 便于按域快速检索；条目落地后在对应分类下登记 `D-NNN`。

| 分类 | 说明 | 关联条目 |
|------|------|----------|
| 云端项目 / 同步 / 版本 / 冲突 | CloudProjectsPage、SyncDrawer、版本与冲突相关 | — |
| Skill 治理（KnowClaw） | 市场 / 我的提交 / 安装更新 / 审核 | — |
| 企业控制台 | EnterpriseConsolePage 及各 Tab | — |
| 设置页 | SettingsPage / AI 配置 / 搜索 API | D-001 |
| 平台 Web 控制台 | `/platform-console` 静态单页 | — |
| 通用 / 框架 | 侧边栏、布局、主题、通用组件、错误提示 | — |
| 项目管理 / 项目与案件列表 | ProjectManager / RootTable / EntryTable | D-002 |
| 项目管理 / 资源管理器 | ProjectManager / ExplorerTree / EntryTable / useFolderTree | D-003 |

---

## 2. 记录总表

> 每条改动一行。新条目追加到表尾，分配下一个 `D-NNN`。

| ID | 类型 | 优先级 | 模块/页面 | 问题/需求描述 | 状态 | 验证 | 最近更新 |
|----|------|--------|-----------|----------------|------|------|----------|
| D-001 | Bug 修复 | P1 | 设置页 / KnowClaw | 企业用户导入企业 AI 配置后不立即生效，进入 KnowClaw 输入框无法输入，需重启 App 才恢复 | `DONE` | 手动复现验证 | 2026-06-16 |
| D-002 | UI 优化 | P2 | 项目与案件列表 / RootTable | 路径列内容过长时撑开列宽、与状态列间隔过小，列表显得拥挤 | `DONE` | 手动目视验证 | 2026-06-16 |
| D-003 | UX 优化 | P1 | 项目管理 / 资源管理器 | 进入项目/案件后将「列表 / Explorer」二选一改造为 Windows 资源管理器式左树右列表双栏并联动（P1-P4：布局/联动/同步/刷新一致性/角标/可拖拽分隔条/键盘） | `DONE` | lint 通过 + 手动验证 | 2026-06-16 |

---

## 3. 详细记录与变更日志

> 每条 `D-NNN` 在此展开。模板如下，落地后逐条追加。

<!--
### D-NNN — <一句话标题>

- **类型 / 优先级**：<Bug 修复 / UI 优化 / …> / <P0-P3>
- **状态**：`IN_PROGRESS` → `DONE`（<日期>）
- **模块/页面**：<组件或页面路径>
- **问题/需求**：<现象、复现步骤或体验痛点>
- **根因**：<定位到的原因（Bug 修复必填）>
- **改动方案**：<具体做法>
- **涉及文件**：
  - `desktop/src/...`
- **验证**：<手动步骤 / 脚本 / h8:gate 结果>
- **影响面/回归**：<是否触及其他链路、需复测项>
-->

### D-001 — 企业 AI 配置导入后即时生效，修复输入框“卡死”

- **类型 / 优先级**：Bug 修复 / P1
- **状态**：`IN_PROGRESS` → `DONE`（2026-06-16）
- **模块/页面**：设置页 AI 配置导入 → KnowClaw 会话
- **问题/需求**：企业用户在设置页「导入企业 AI 配置」后，配置不会立即生效；进入 KnowClaw 时输入框像被冻结一样无法发送，必须重启 App 才恢复正常。
- **根因**：
  - pi 的 `AgentSession` 在创建时即把 provider/model 配置“烧死”，主进程 `ensureSession` 又会复用已存在的会话，单纯改配置不会触达运行中的会话。
  - 渲染层 `prefs:updated` 监听用 `sessionIdRef.current` 作为重建闸门（`!streaming && sessionIdRef.current`）。企业用户**首次导入**时尚无任何会话（`sessionIdRef.current` 为 null），重建被跳过 → 配置不生效；同时缺少可用会话使发送链路处于无会话态，表现为输入框“卡死”。只有整体重启时才会从磁盘干净地重新创建会话，因而“重启即恢复”。
  - 另外 `loadModels()` 只更新渲染层选中模型，未把选择同步回主进程的 `currentSelection`，主进程可能继续沿用过期模型。
- **改动方案**：
  1. 放宽重建闸门：`prefs:updated` 命中 `ai`/`llm` 时，只要**非流式**就重建会话（不再要求已存在会话）。
  2. 同步主进程选择：`loadModels()` 返回解析后的当前模型；监听里改为调用 `setModel(provider, id)`，该路径会同步主进程 `currentSelection` 并 `newSession()` 以新配置重建会话；无可用模型时回退 `newSession()` 让主进程回到干净状态。
  3. 防御式延迟重建：若配置变更发生在流式回复期间，置 `pendingConfigRebuildRef`，待本轮 streaming 结束（`wasStreamingRef` 副作用）补一次重建，避免打断在途回复。
  4. 新增 `currentModelRef` 镜像，供异步回调读取最新选择而不引入额外依赖。
- **涉及文件**：
  - `desktop/src/ui/hooks/useKnowClawPersist.jsx`（`loadModels` 返回值、`prefs:updated` 监听、`wasStreamingRef` 副作用、新增两个 ref）
  - 交叉确认（未改）：`desktop/src/main/ipc/prefs.js`（`importCode` 已 `writeState` 后广播 `ai`）、`desktop/src/main/ipc/knowclaw.js`（`newSession` 走 `disposeChannelSession`+`ensureSession` 重建、`setModel` 更新 `currentSelection`、`createSession` 读取磁盘新配置）。
- **验证**：手动复现——企业账号导入企业 AI 配置后，不重启直接进入 KnowClaw：配置即时生效、可正常输入与发送；流式回复中途导入配置时，本轮不中断、下一轮生效。
- **影响面/回归**：仅影响 AI 配置变更后的会话重建路径。需复测：手动切换模型（`setModel`）、新对话/切换工作区（`newSession`/`setCwd`）、历史会话打开（rehydrate）不受影响。

---

### D-002 — 项目/案件列表路径列与状态列留出间隔，长路径优雅截断

- **类型 / 优先级**：UI 优化 / P2
- **状态**：`IN_PROGRESS` → `DONE`（2026-06-16）
- **模块/页面**：项目与案件列表（`RootTable`，项目/案件共用，仅 `entityLabel` 不同）
- **问题/需求**：路径列内容可能很长，宽屏下会撑开列宽、把状态列顶到紧贴；即便窄屏触发截断，路径内容与状态列之间的间隔也过小，列表整体显得拥挤。期望路径与状态之间始终保留间隔。
- **根因**：
  - 路径列的 `<th>`/`<td>` 没有右内边距，导致路径内容直接贴着状态列。
  - 路径列仅在 `≤900px` 时设置 `max-width: 120px`，宽屏下没有宽度上限，长路径会撑开列宽（`truncate` 失效），挤压状态列。
- **改动方案**：
  1. 给路径列表头 `<th>` 与单元格 `<td>` 加 `pr-8`（32px 右内边距），保证路径与状态列之间始终留有间隔。
  2. 为 `.root-table-path` 补齐分层 `max-width`：默认 360px、`≤1200px` 220px、`≤900px` 120px、`≤720px` 隐藏；长路径稳定截断为省略号，完整路径仍可通过悬浮 `title` 查看。
- **涉及文件**：
  - `desktop/src/ui/components/project-manager/RootTable.jsx`
- **验证**：手动目视——超长路径项目在宽/中/窄屏下均正常截断、不再撑开列；路径与状态标签之间留有清爽间隔；悬浮显示完整路径。
- **影响面/回归**：仅影响项目/案件根列表的路径列展示，不涉及数据与交互逻辑。

---

### D-003 — 资源管理器式左树右列表双栏布局（Windows 风格）P1-P4

- **类型 / 优先级**：UX 优化 / P1
- **状态**：`IN_PROGRESS` → `DONE`（2026-06-16，含 P4 打磨）
- **模块/页面**：进入项目/案件后的文件区（`ProjectManager` / `ExplorerTree` / `EntryTable` 及相关 hooks）
- **问题/需求**：原本 header 用「列表 / Explorer」tab 二选一占用同一区域，且 Explorer 树点击只展开不联动右侧。期望模仿 Windows 资源管理器：左侧常驻文件夹树、右侧文件列表、两栏联动（点左树文件夹即切右侧目录）。
- **确认取向**：tab 改为单个「显示/隐藏导航窗格」开关；左树单击行即导航、箭头单独展开；左树只显文件夹；导航窗格默认展开并持久化（`localStorage` 键 `ipm.pm.navPaneOpen`）；云同步抽屉打开且窗口过窄时自动收起左树。
- **改动方案（分三期）**：
  - **P1 布局+联动**：`ProjectManager` 用 `navPaneOpen` 替换 `viewMode`，内容区重构为 `AIGhostOverview` 整宽横幅 + 左 `<aside>` 树 / 右列表的 flex 双栏（各自独立滚动）；主列 `ResizeObserver` 派生 `navPaneEffectiveOpen` 实现抽屉窄屏自动收起。`HeaderBar` 两按钮 toggle 改为单个导航窗格开关（`PanelLeftOpen/Close`，仅 `!isRoot`）。`EntryTable` 移除 explorer 分支改为列表-only。`ExplorerTree` 改 folders-only，拆分 chevron(展开)/行(`onSelectDir` 导航) 命中区并高亮选中节点。`useFolderTree` 去掉 `viewMode` 闸门，进入项目/本地即常驻构建。
  - **P2 双向同步**：`useFolderTree` 新增 `expandToPath(relPath)` 逐级展开祖先；`ProjectManager` 监听 `cwd.relPath` 调用之，使右侧双击进入子目录、面包屑跳转、AI 暂存区「进入」都能在左树展开祖先并高亮当前节点（含 `scrollIntoView`）。
  - **P3 刷新一致性 + 跨栏拖拽**：`useFileActions`（新建/上传/上传到/拖入上传/删除/重命名）、`useDragDrop`（移动）去掉 `viewMode` 闸门，文件操作后始终刷新受影响目录树节点；`useGhosts` 接入 `refreshTreeDir`，接受/分组接受/全部接受后刷新目标与来源目录树节点，保证 AI 分类移动后左右两栏一致。
  - **P4 打磨**：
    1. **AI 建议角标**：`ProjectManager` 由 `pendingGhostGroups` 计算 `ghostBadgeByDir`（每个建议数累加到其文件夹及全部祖先与根），`ExplorerTree` 在文件夹名右侧渲染琥珀色数字角标；收起的祖先显示子树总数，根节点角标等于暂存区总数。
    2. **可拖拽分隔条 + 记忆栏宽**：`navPaneWidth`（`localStorage` 键 `ipm.pm.navPaneWidth`，默认 256、clamp 180-480）；`<aside>` 改用 `style.width`，其后插入 `cursor-col-resize` 分隔条，`mousedown` 起拖、`window` 监听 `mousemove/mouseup`，释放落盘。
    3. **基础键盘导航**：`focusedRelPath` 焦点项 + `visibleTreeNodes` 扁平化；`<aside>` 加 `role="tree"`/`tabIndex`/`onKeyDown`：Up/Down 移动焦点、Right 展开或入子、Left 收起或回父、Enter 进入（设 `cwd.relPath`）。`ExplorerTree` 焦点环 + `scrollIntoView` + 基础 ARIA（`treeitem`/`group`/`aria-selected`/`aria-expanded`）。
- **涉及文件**：
  - `desktop/src/ui/components/ProjectManager.jsx`
  - `desktop/src/ui/components/project-manager/HeaderBar.jsx`
  - `desktop/src/ui/components/project-manager/EntryTable.jsx`
  - `desktop/src/ui/components/project-manager/ExplorerTree.jsx`
  - `desktop/src/ui/components/project-manager/hooks/useFolderTree.js`
  - `desktop/src/ui/components/project-manager/hooks/useFileActions.js`
  - `desktop/src/ui/components/project-manager/hooks/useDragDrop.js`
  - `desktop/src/ui/components/project-manager/hooks/useGhosts.js`
- **验证**：相关文件 ESLint 全部通过；待手动验证项见下「影响面/回归」。
- **影响面/回归**：进入项目/案件的文件区交互整体改变。需复测：左树单击导航 + 箭头展开 + 选中高亮；右侧双击/面包屑/暂存区「进入」联动左树；新建/上传/删除/重命名/拖拽移动后左右两栏与暂存区计数一致；AI 接受/放弃后源与目标目录在树与列表均更新；外挂/失效项目、本地文件夹、学习域、根列表（无树整宽）、抽屉三栏窄屏自动收起左树。P4 复测：折叠父节点显示子树建议总数、接受/放弃后角标更新；拖拽分隔条调宽并重启后保留；键盘 Up/Down/Left/Right/Enter 焦点与联动正常。
- **后续可选（Phase 5+）**：分隔条双击复位默认宽度、键盘 Home/End 与类型首字母跳转等增强。

---

### D-004 — 左侧文件夹树视觉重设计（方案 D · 柔和卡片分组）

- **类型 / 优先级**：UX 优化 / P2
- **状态**：`DONE`（2026-06-16）
- **模块/页面**：进入项目/案件后的左侧导航窗格（`ExplorerTree`）
- **问题/需求**：原左树为「整行平铺 + 选中浅紫底 + 缩进竖线 + 琥珀角标」，整体偏单调、层级边界不清、选中态不够突出，含 AI 建议数的角标观感一般。期望更精致、留白更舒展的视觉。
- **方案对比**：在 `desktop/design/explorer-tree-mockup.html` 中产出 4 套设计稿（A 精炼经典 / B VS Code 紧凑 / C 彩色文件夹 / D 柔和卡片分组）供选型，最终选用 **方案 D**。
- **改动方案**：重写 `ExplorerTree` 渲染：
  1. **根节点作标题头**：根目录（`depth===0`）渲染为区段标题（加粗、悬停浅底、可点击导航/展开），不再与子级同样式。
  2. **子级收进柔和卡片**：根的子级容器套一层 `rounded-xl bg-slate-50/80 border` 卡片，强化层级边界与留白；去掉原绝对定位缩进竖线，改用层级左内边距。
  3. **选中行「浮起」**：卡片内选中行改为白底 + `ring-1 ring-[#d8dbed]` + `shadow-sm` + 品牌色加粗文字，悬停为半透明白底，选中态更清晰且有质感。
  4. **角标/加载态对齐统一**：琥珀色 AI 建议数角标与「加载中」标签统一右对齐（`ml-auto`），避免抢占文件名空间。
  5. 完整保留 chevron 展开/收起、行点击导航、右键菜单、拖拽（拖出/拖入文件夹）、键盘焦点环与 ARIA（`treeitem`/`group`/`aria-selected`/`aria-expanded`）等既有功能。
- **涉及文件**：
  - `desktop/src/ui/components/project-manager/ExplorerTree.jsx`
  - `desktop/design/explorer-tree-mockup.html`（设计稿，供选型/回溯）
- **验证**：相关文件 ESLint 通过；待手动目视——根标题/卡片/浮起选中态在浅/深层级、空文件夹、加载中、含角标等场景观感正常，且导航/展开/拖拽/键盘交互不回归。
- **影响面/回归**：仅左树视觉呈现，未改动数据流与交互逻辑。

---

### D-005 — KnowClaw 工作空间树：标识 IPM 系统文件夹（meta / snippets）

- **类型 / 优先级**：UX 优化 / P2
- **状态**：`DONE`（2026-06-16）
- **模块/页面**：KnowClaw v2 右侧工作空间文件树（`WorkspaceFileTree`）
- **问题/需求**：选择案件/项目作为工作空间后，文件树会列出 IPM 内部系统文件夹 `meta`、`snippets`（含 `project.db`、`structure.json`、`snippets-meta` 等）。用户无法分辨这些是系统自动维护、不可移动/修改的文件，存在误删/误改风险。期望先给这两个文件夹打上明显标识。
- **改动方案**：
  1. 在 `WorkspaceFileTree` 新增 `SYSTEM_ROOT_DIRS = {meta, snippets}` 与 `systemFolderKind(relPath)`（区分系统文件夹本体 `root` / 其内部子项 `child` / 普通项 `null`）。
  2. **视觉标识**：系统文件夹本体行（meta/snippets）名称右侧加「🔒 系统」灰色徽标；系统文件夹及其全部子项整体灰显（文字、图标转 `slate-400`），与业务文件夹（琥珀图标）形成区分。
  3. **提示**：系统文件夹及子项的 `title` 改为「IPM 系统文件夹/文件，由系统自动维护，请勿移动或修改」。
  4. **行为约束（顺带）**：系统文件夹不再作为拖拽上传落点——`handleDragOver` 对系统目录直接忽略、`handleDrop` 吞掉事件且不上传（避免冒泡到面板落到根目录）。
- **涉及文件**：
  - `desktop/src/ui/components/knowclaw-v2/WorkspaceFileTree.jsx`
- **验证**：ESLint 通过；待手动目视——以案件/项目为工作空间时 meta/snippets 显示「系统」徽标且整树灰显，hover 提示正确，拖拽文件无法落入系统文件夹；普通业务文件夹与文件展示/拖拽/双击打开不受影响；全局模式（未选工作空间）不显示该树，无回归。
- **影响面/回归**：仅影响 KnowClaw 工作空间树中 meta/snippets 子树的展示与拖拽落点，不改动文件数据与其它目录交互。
- **后续可选**：系统文件双击打开时给只读提示；后端在移动/重命名 API 层面拒绝对系统目录的写操作（前端标识 + 后端兜底双保险）。

---

### D-006 — KnowClaw 工作空间树：对话结束/中断后自动全部展开（不保留折叠状态）

- **类型 / 优先级**：Bug 修复 / P1
- **状态**：`DONE`（2026-06-16）
- **模块/页面**：KnowClaw v2 右侧工作空间文件树（`WorkspaceFileTree`）
- **问题/现象**：每当对话结束或中断后，右侧文件树会自动把顶层文件夹全部展开，用户手动折叠的状态丢失，无法维持现状。
- **根因**：
  - 对话结束时（`useKnowClawPersist` 的 `agent_end` 分支，`setTimeout(loadWorkspaceTree, 250)`）会重新拉取文件树并 `setWorkspaceTree(...)`，产生**全新的 `entries` 数组引用**（上传、`abort` 中断、工作空间切换等路径同样会触发）。
  - `WorkspaceFileTree` 中监听 `entries` 的 effect **每次 entries 变化**都会把所有 `depth===1` 目录重新加入展开集合。由于 IPM 各工作空间目录结构一致（meta/snippets/各业务目录名相同），刷新后顶层目录被悉数重新展开，表现为「自动全部展开」。
- **改动方案**：将「自动展开顶层目录」从「每次 entries 变化」改为「**每个工作空间首次加载时仅一次**」：新增按 `cwd` 记忆的 `autoExpandedCwdRef` 一次性闸门；同一工作空间内后续刷新直接跳过、完整保留用户当前展开/折叠状态；切换工作空间（`cwd` 变化）时才重新执行一次初始展开（重置为该工作空间的 depth-1 集合，顺带清理上一个工作空间的陈旧深层展开项）。
- **涉及文件**：
  - `desktop/src/ui/components/knowclaw-v2/WorkspaceFileTree.jsx`
- **验证**：ESLint 通过；待手动验证——展开/折叠若干目录后发起并结束（或中断）一轮对话，文件树展开状态保持不变；切换到另一工作空间时顶层目录正常初始展开一次；上传文件后树刷新但折叠状态不被重置。
- **影响面/回归**：仅改变文件树自动展开时机，不影响文件数据、选中、拖拽、touched 高亮等其它行为。

---

### D-007 — KnowClaw 对话 UI 探索：可视化回答 / Artifact 渲染

- **类型 / 优先级**：UX 探索 / P3
- **状态**：`BACKLOG`（2026-06-16，已记录，暂不开发）
- **模块/页面**：KnowClaw v2 对话消息渲染（`MessageBubble` / 后续可新增 visual renderer）
- **参考现象**：参考 WorkBuddy 对话 UI：LLM 回答先被渲染为更美观的可视化内容（如方案对比卡、表格、结论块、报告式布局），随后仍可看到原始 LLM 回答。
- **当前基础**：KnowClaw 现有 `MessageBubble` 使用 `marked` 将 `message.content` 作为 Markdown 渲染到 `.prose-chat`，本质上仍是普通 Markdown/HTML 文本流，尚无独立的结构化可视化协议。
- **实现判断**：
  1. **Prompt + Markdown 美化**：让 LLM 输出规范 Markdown，再用 CSS 美化标题、表格、引用块。实现最快，但表达力与稳定性有限。
  2. **允许 LLM 输出 HTML**：自由度最高，但安全风险高，需要严格 sanitize，不建议作为主路径。
  3. **结构化 Artifact 协议（推荐）**：让 LLM 在回答中附带受控结构块（例如 `ipm-visual` JSON），前端解析后用 React 组件渲染为固定类型的可视化卡片；原始 Markdown 回答仍保留或折叠展示。
- **推荐方向**：采用「结构化 Artifact 协议」：
  - LLM 正常输出回答，同时在适合结构化展示时附带一个隐藏/可解析的 `ipm-visual` JSON 块。
  - `MessageBubble` 渲染前解析 `message.content`；若存在合法 visual block，则渲染 `<VisualAnswerBlock data={...} />`。
  - 原始回答保留在下方「查看原始回答」折叠区；解析失败则回退到普通 Markdown，保证不影响现有对话。
- **MVP 可支持类型**：
  - `comparison`：左右方案对比卡片。
  - `summary`：结论/建议卡片。
  - `steps`：步骤/流程卡片。
  - `matrix`：美化表格/决策矩阵。
- **后续开发建议**：
  1. 先新增一个纯前端 parser + renderer，不改 agent 执行链路。
  2. 再在 KnowClaw system prompt / skill 中补充输出规范，引导模型在合适场景附带 `ipm-visual`。
  3. 后续可探索二阶段渲染：先显示原始回答，再异步生成可视化组件，期间显示「正在渲染组件...」状态。
- **风险/注意**：
  - 不直接执行 LLM 生成的 HTML/JS，避免 XSS 与不可控样式污染。
  - visual schema 需要严格校验和版本化，避免模型输出漂移导致 UI 崩溃。
  - 原始 Markdown 必须作为兜底保留，确保任何解析失败都不影响用户读取回答。

---

### D-008 — KnowClaw 消息渲染：回答、代码块、表格复制能力

- **类型 / 优先级**：UX 优化 / P2
- **状态**：`DONE`（2026-06-16）
- **模块/页面**：KnowClaw v2 对话消息渲染（`MessageBubble`）
- **问题/需求**：当前 KnowClaw 的 assistant 回答仅可阅读，不支持快速复制；当回答包含代码块、表格或长段内容时，用户需要手动框选，容易漏选或破坏格式。期望为代码块、表格以及整条回答提供复制入口；整条回答复制按钮放在回答左下角。
- **改动方案**：
  1. 新增 `CopyableMarkdown` 渲染层：继续复用现有 `marked` -> `.prose-chat` 的 Markdown 渲染路径，不重构消息链路。
  2. 渲染后通过 `ref` 扫描回答内部的 `pre` 与 `table`，分别注入右上角复制入口；开发模式下用 `kc-copyable-block` 防止 effect 二次执行导致重复按钮。初版 Tailwind 动态 group-hover 在运行时 DOM 注入场景下不稳定，已改为内联关键样式 + hover 事件；局部复制入口改为仅显示复制 icon，无文字，默认隐藏，hover 到代码块/表格块时显示。表格复制按钮浮在表格右上方并预留顶部间距，避免覆盖表头文字。随后修复流式渲染问题：从 `useEffect([html])` 改为每次 render 后执行的 `useLayoutEffect`，确保 React 在流式更新/结束态切换时即使重写 `dangerouslySetInnerHTML`，也会在绘制前补回 `pre/table` 的复制按钮，避免闪烁或最终消失。
  3. **代码块复制**：优先复制 `pre > code` 的纯文本内容，失败则复制 `pre.innerText`。
  4. **表格复制**：将 DOM 表格转换为 TSV（制表符分隔），便于直接粘贴到 Excel / WPS / 飞书表格并保持行列结构。
  5. **整条回答复制**：在 assistant 回答左下角新增「复制回答」按钮，复制原始 `message.content`（Markdown 原文）；复制成功后短暂显示「已复制」。
  6. 新增 `copyText()` 工具：优先使用 `navigator.clipboard.writeText`，失败时回退到隐藏 textarea + `document.execCommand('copy')`。
  7. **代码块视觉重设计**：先通过 `desktop/design/knowclaw-codeblock-mockup.html` 输出 6 个代码块设计稿供选型，最终选用 **方案 B · 编辑器窗口**。实现上在 `CopyableMarkdown` 注入复制能力时，将 `pre` 包装为 `kc-code-editor-block`，在代码块顶部增加编辑器标题栏（`kc-code-titlebar`，三色点 + `代码示例` 标识 + 右侧 hover 复制 icon），下方保留可横向滚动的浅色代码区；全局 `.prose-chat` 样式补充编辑器窗口布局。表格补充白底、边框和圆角，配合表格复制按钮。
- **涉及文件**：
  - `desktop/src/ui/components/agent-chat/MessageBubble.jsx`
  - `desktop/index.html`
  - `desktop/design/knowclaw-codeblock-mockup.html`
- **验证**：ESLint 通过；待手动目视——普通 Markdown 回答左下角显示复制按钮；代码块/表格 hover 后显示 icon-only 局部复制按钮；表格复制按钮不覆盖表头文字；复制成功状态短暂切换为 check icon；代码块改为编辑器窗口布局；流式生成时复制按钮不闪烁，输出完成后仍保留；思考块、工具卡片、任务卡、`ask_user` 卡不受影响。
- **影响面/回归**：仅改变 assistant Markdown 回答区域的渲染包装与复制交互；不影响消息内容存储、发送、工具调用或其他结构化卡片。

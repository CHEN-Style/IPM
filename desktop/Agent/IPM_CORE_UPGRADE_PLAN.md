# IPM 核心体验升级计划 —— 应用壳层 · 文件管理 · 知识管理

> **目标**：在不改动 KnowClaw 的前提下，提升 IPM 桌面端「中台 + 三域工作区」的日常可用性：工作区可自定义、分类规则由用户主导、案件/项目可改名、文件页导航信息去冗余，并归档悬浮窗切换体验问题。
>
> **范围**：`desktop/src`（主进程 IPC / React UI）、`desktop/Agent`（分类规则种子、`structure.json` 相关逻辑）。**明确不包含** `desktop/Agent/pi-runtime/`、`knowclaw.js`、KnowClaw V2 UI。
>
> **约束**：延续 KnowClaw 升级计划的工程习惯——每阶段首行 `Status:`；阶段末「变更日志」；读 ≤ 8 文件 / 写 ≤ 5 文件 / 抽象 ≤ 2 / 可独立验证；超纲立刻拆阶段。
>
> **关联文档**：悬浮窗切换问题的完整诊断与候选方案见 [`KNOWCLAW_UPGRADE_PLAN.md`](./KNOWCLAW_UPGRADE_PLAN.md) **附录 · Backlog-A**（本计划仅引用，不重复全文）。

---

## 0. 阅读与维护说明

- 本文档记录 **2026-05-20 起** 用户提出的核心产品升级项；后续新增需求追加到 §1 差距表 + §2 阶段总览，或 §附录 Backlog。
- 每完成一轮实现：更新对应阶段 `Status`、填写「变更日志」、刷新 §5 进度看板。
- **Backlog-A** 与 KnowClaw 主线解耦，但在本计划中保留条目，避免「悬浮窗体验」被遗忘；重新排期时可直接从 A.3 取方案落地。
- 阶段编号：**W0–W4**（Workspace 体验）；附录 Backlog 字母编号与 KnowClaw 计划保持一致（便于交叉检索）。

---

## 1. 当前差距客观分析

### 1.1 已登记差距（用户提出，2026-05-20）

| # | 差距 | 用户原意（摘要） | 当前实现（代码/产品） | 期望终态 |
|---|------|----------------|----------------------|----------|
| G1 | 悬浮窗 ⇄ 中台切换不顺手 | 切换悬浮窗、回到中台都不方便 | 入口在侧栏折叠菜单；回到中台仅右键菜单；`backToMain` 销毁悬浮窗 | 见 **附录 Backlog-A**（候选方案已写在 KnowClaw 计划中） |
| G2 | 默认四类业务文件夹不可删 | 新建案件/项目时有 4 个默认文件夹，希望除系统目录外均可自定义 | `main.js`：`WORK_BIZ_FOLDERS` + `isProtectedFolderNameRelPath()` 硬编码保护四个根级业务夹；`ensureProjectStructure` 强制创建 | 新建时仍可**可选**提供模板；用户可删除/重命名/增删业务文件夹；**仅** `meta` / `temp` / `snippets`（及约定系统路径）不可删 |
| G3 | 新建时自动写入硬规则 | 不要默认硬规则，完全由用户创建 | `ensureProjectStructure` 末尾调用 `seedDefaultRules()`；`classifyRules.js` 内 `SEED_RULES_WORK` 约十余条 | 新建工作区 **不** 写入 `classify-rules.json`；空文件或仅 schema 壳，由用户在「分类规则」面板自行添加 |
| G4 | 无法修改案件/项目名称 | 创建后没有改名入口 | `projects` / `cases` IPC 有 create/delete/status，**无 rename**；UI 无重命名工作区流程 | 支持安全重命名（磁盘目录 + `structure.json` + DB + 状态/current 指针一致性） |
| G5 | 文件页 Header 信息冗余 | 「案件文件：案件D」「当前案件：案件D」多余；希望只显示路径式导航 | `ProjectManager.jsx`：`headerTitle` / `headerSubtitle` 与 `breadcrumbs` 并存；`HeaderBar.jsx` 左侧 h1+副标题 + 右侧面包屑重复表达 | 进入工作区后 **仅保留** 一条路径导航，如：`所有案件 / 案件D / 调研研究`（学习域同理） |

### 1.2 优先级排序（初稿，待产品确认）

| 优先级 | 差距 | 理由 |
|--------|------|------|
| **P0** | G4 工作区重命名 | 名称错误会贯穿路径、搜索、知识碎片 `_projectName` 展示，且无 workaround |
| **P0** | G2 业务文件夹可定义 | 不同律所/团队文件夹体系不同，硬编码四类是结构级阻碍 |
| **P1** | G3 取消默认硬规则 | 与 G2 同属「新建工作区」心智；自动规则可能误导分类 |
| **P1** | G5 Header 导航简化 | 纯 UI，改动面可控，每日高频可见 |
| **P2** | G1 悬浮窗切换（Backlog-A） | 用户已反馈但曾 **DEFERRED**；与 KnowClaw 计划附录重复，单独立项时从 Backlog-A 搬运 |

---

## 2. 阶段总览

| # | 阶段 | 主要交付物 | 解决差距 | Status |
|---|------|----------|---------|--------|
| W1 | 业务文件夹可完全自定义 | 去掉四类文件夹删除/重命名保护；新建流程可选模板；`structure.json` 与磁盘同步策略明确 | G2 | `DONE` |
| W2 | 取消新建时默认硬规则 | 移除 `seedDefaultRules` 调用；文档/引导说明由用户自建规则 | G3 | `DONE` |
| W3a | explorer 路径联动修复 | 统一 `pathRemapper`：rename/move/delete 联动 classify-rules / preferences / records / project.db | — | `DONE` |
| W3b | 案件/项目重命名 | IPC `projects/rename`、`cases/rename` + UI（两步警告+输入） + 跨库联动 | G4 | `DONE` |
| W4 | 文件管理 Header 路径化 | 去掉冗余 title/subtitle，面包屑为唯一位置信息 | G5 | `PLANNED` |
| — | 附录 Backlog-A | 悬浮窗 ⇄ 中台（引用 KnowClaw 计划） | G1 | `DONE` |

> **说明**：W1–W4 的详细「读/写/验收」清单在 §3 各阶段展开；实现前需逐条补全文件路径与边界用例。

---

## 3. 各阶段详细计划

---

### Phase W1 — 业务文件夹可完全自定义

**Status:** `DONE`（2026-05-21 落地；D1=B 模板选择弹窗，D2=否 学习域不动，D3=有 pending AI suggestion 时阻止删除）

**目标**：取消「收到资料 / 过程文档 / 调研研究 / 交付成果」四个根级文件夹的**不可删除/不可重命名/不可移动**限制；保留系统目录保护；新建案件/项目时业务目录可由用户完全定义（可选：仍提供一键套用默认四类模板）。

**用户故事**

> 我新建了一个案件，不需要「调研研究」夹，想删掉或改成「内部研究」；或者我想从零只建两个文件夹。系统文件夹 temp 仍然不能动。

**现状锚点（实现前必读）**

| 模块 | 路径 | 要点 |
|------|------|------|
| 保护判断 | `desktop/src/main.js` | `isProtectedFolderNameRelPath()`：`WORK_BIZ_FOLDERS.includes(rp)` |
| 默认创建 | `desktop/src/main.js` | `ensureProjectStructure()`：`WORK_BIZ_FOLDERS` 循环 `mkdirSync`；`structure.json` 种子写入四类 |
| 删除/重命名 IPC | `desktop/src/main/ipc/explorer.js` | 调用 `isProtectedFolderNameRelPath` / `isProtectedRelPath` |
| 分类候选 | `desktop/src/main.js` | `buildFolderCandidatesFromStructure()`：依赖 `structure.json` 非 system 条目 |
| 学习域 | `desktop/src/main.js` | `STUDY_BIZ_FOLDERS` / `STUDY_TEMPLATE_FOLDERS` 是否同样硬保护——需单独决策 |

**工作清单（待细化）**

读：（TBD，≤ 8 个文件）
- `main.js`：`isProtectedFolderNameRelPath`、`ensureProjectStructure`、`syncStructureJson`
- `explorer.js`：delete / rename / move 拦截分支
- `ProjectManager` / `useContextMenu`：删除文件夹菜单是否隐藏
- `meta.js`：文件夹描述编辑与 system 标记

写/改：（TBD，≤ 5 个文件）
1. 收窄 `isProtectedFolderNameRelPath`：仅保护 `meta`、`temp`、`snippets`（及子路径规则，与 `isProtectedRelPath` 对齐）
2. `ensureProjectStructure`：区分「首次创建系统目录」与「业务目录」——业务目录改为**可选模板**或**零个**（产品决策二选一，见 §3 W1 决策点）
3. `syncStructureJson`：用户删除磁盘文件夹后，结构镜像如何更新（移除 entry / 标 tombstone）
4. UI：删除默认四类后的空状态引导（新建文件夹）
5. 分类器：无候选文件夹时的提示（已有 skip 日志，是否要对用户可见）

**决策点（实现前必须拍板）**

| ID | 问题 | 选项 |
|----|------|------|
| W1-D1 | 新建案件/项目时是否仍**默认创建**四类文件夹？ | A. 仍创建，但允许删改；B. 创建空壳，弹窗让用户选模板（含「四类模板」「空白」）；C. 仅写入 `structure.json` 无物理目录，首次上传再建 |
| W1-D2 | 学习域 `STUDY_BIZ_FOLDERS` 是否一并放开？ | 是 / 否（若否，本阶段仅 projects+cases） |
| W1-D3 | 删除非空业务文件夹 | 沿用现有 trash / 二次确认？是否禁止删除仍有 pending suggestion 的文件夹？ |

**不做**

- 不改变 `temp` 作为 AI 分类唯一源路径的 MVP 约束（归档接受逻辑另议）
- 不涉及 KnowClaw 工作区列表

**验收标准（草案）**

- [ ] 可对「收到资料」执行删除或重命名（磁盘 + `structure.json` 一致）
- [ ] `meta`、`temp`、`snippets` 仍不可作为文件夹删除
- [ ] 新建工作区在「空白模板」下可无业务夹，用户自建夹后可被分类候选识别
- [ ] 学习域（若纳入）行为与案件/项目一致

**变更日志**

- 2026-05-21 — W1 实施完成。
  - `desktop/src/main.js` `isProtectedFolderNameRelPath`：移除 `WORK_BIZ_FOLDERS.includes` 行，业务文件夹解锁删除/重命名/移动。
  - `desktop/src/main.js` `ensureProjectStructure`：新增 `opts.template`（`'default'` / `'blank'`），并把业务文件夹的物理创建 + `structure.json` 种子收敛到「首次初始化」分支（依据 `structure.json` 是否存在），老项目反复调用不会重建用户已删除的业务夹（缓解 RW-W1-2）。空白模板写入空 `folders` 壳，后续由 `explorer/mkdir` → `syncStructureJson` 自然追加 entry。
  - `desktop/src/main.js` `looksLikeValidProjectDirSync`：从「必有任一」清单中移除 `WORK_BIZ_FOLDERS`，仅保留系统目录（`snippets` / `meta` / `temp`），避免空白模板项目被当成 ghost 清理。
  - `desktop/src/main/ipc/explorer.js` `mkdir` 错误文案：`'业务/系统固定目录禁止创建/覆盖'` → `'系统固定目录禁止创建/覆盖'`。
  - `desktop/src/main/ipc/explorer.js` `delete` handler：删除目录前查询 `listAiSuggestions({ status: 'pending' })`，若 `suggestedFolderRelPath` 命中要删的文件夹或其子路径则抛错提示「请先在暂存区处理」；`temp` 子文件不受此检查影响。
  - `desktop/src/main/ipc/projects.js` / `cases.js` `create` handler：透传 `payload.template`（`'blank'` 显式判定，缺省回退 `'default'`）。
  - `desktop/src/preload.js`：`projects.create(name)` / `cases.create(name)` 扩展第二参 `{ template }`，旧调用形式继续可用。
  - `desktop/src/ui/components/project-manager/hooks/useProjectActions.js`：拆出 `createProjectWithTemplate(template)`；`createProject` 校验后调用新增 `onRequestTemplate` prop 触发模板弹窗，缺省回退 `'default'`。
  - `desktop/src/ui/components/ProjectManager.jsx`：新增 `templatePickerOpen` state + 模板选择弹窗 UI（「法律{entityLabel}四类」 vs 「空白」）；学习域不传 `onRequestTemplate`，保持原直接创建路径。

---

### Phase W2 — 取消新建时默认硬规则

**Status:** `DONE`

**目标**：新建案件/项目（及学习域若适用）时**不再**自动写入 `meta/classify-rules.json` 的种子规则；分类完全依赖用户后续在「硬规则」面板添加 + Agent 推理。

**用户故事**

> 新案件应该是干净规则表，不要被系统塞一堆「微信 → 收到资料」之类规则；我需要自己加。

**现状锚点**

| 模块 | 路径 | 要点 |
|------|------|------|
| 种子入口 | `desktop/src/main.js` | `ensureProjectStructure` → `seedDefaultRules(projectDir, d)` |
| 种子实现 | `desktop/Agent/storage/classifyRules.js` | `seedDefaultRules()`：文件不存在时写入 `SEED_RULES_WORK` |
| UI | `ClassifyRulesPanel.jsx` | 空状态是否友好 |

**工作清单**

读：
- `classifyRules.js`：`seedDefaultRules`、`readDoc` / `writeDoc`
- `main.js`：`ensureProjectStructure` 调用点
- 全局搜索确认 `seedDefaultRules` 仅有一处调用

写/改：
1. ~~移除或 gated-off `ensureProjectStructure` 中的 `seedDefaultRules` 调用~~ ✅
2. ~~`ClassifyRulesPanel`：零规则时的引导文案~~（「添加第一条硬规则」按钮 + 引导说明）✅
3. 文档：本计划变更日志 ✅

**不做**

- 不删除 `seedDefaultRules` 函数本身（可用于「导入模板规则」未来功能）
- 不迁移已有项目的旧规则（已存在 `classify-rules.json` 的保持不动）

**验收标准**

- [x] 新建项目后 `meta/classify-rules.json` 不存在（`seedDefaultRules` 不再被调用）
- [x] 分类流水线仍可运行（`readDoc()` 容忍文件不存在，返回 `{ rules: [] }`）
- [x] 旧项目打开规则面板，历史种子规则仍在（`readDoc()` 读取已有文件不受影响）

**变更日志**（2026-05-21 实施）

| 文件 | 改动 |
|------|------|
| `desktop/src/main.js` L24 | 注释掉 `import { seedDefaultRules }` — 不再在新建时调用，保留模块备用 |
| `desktop/src/main.js` L477 | 移除 `try { seedDefaultRules(…) } catch {}` 调用行，替换为注释说明 |
| `desktop/src/ui/components/project-manager/ClassifyRulesPanel.jsx` L296-312 | 零规则空状态升级：增加引导说明文案 + 「添加第一条规则」快捷按钮（非 `embedded` 模式） |

**工作量**：~15 min 实际改动（仅 2 文件 3 处），读码约 10 min。

**观察**：`seedDefaultRules` 函数和 `SEED_RULES_WORK` 常量保留在 `classifyRules.js` 中，未来可复用于「导入模板规则」功能。

---

### Phase W3 — 路径联动修复（W3a + W3b）

**Status:** `DONE`（2026-05-21）

**背景与目标**

代码考古发现：当前 `explorer/rename` / `move` 仅同步 `structure.json` 一处，**未联动**指向同一路径的其他存储；`delete` 仅清理 snippets record 与 temp suggestion，**未清理** knowledge / classify-rules / preferences / source_records；同时**完全没有**项目/案件级别的 rename 能力。这导致：
- 用户重命名「收到资料」→「入站资料」后，硬规则的 `targetFolder` 仍指向旧名，分类静默失效；
- 删除文件夹后，知识全景中残留指向已删路径的孤儿条目；
- 想改一个客户代号只能手动改文件夹名，应用立即找不到项目。

**决策汇总（W3 关键决策）**

| 决策 | 选项 |
|------|------|
| 实施拆分 | **W3a + W3b** —— W3a 修 explorer 联动缺口（独立可验证），W3b 在统一 remapper 之上加项目重命名 |
| 删除清理策略 | **软清理** —— `knowledge_items.archived=1`、`knowledge_links` DELETE、`suggestions` 标记 `source_deleted` / `target_deleted`、规则/偏好 `enabled=false` |
| 历史快照 | **不动** —— `events` / `activity_log` 保留当时真实路径作为审计语义 |
| KnowClaw 会话 cwd | **不动** —— 项目重命名时旧会话 cwd 失效，UI 必须给用户充分警告 |

---

#### W3a — explorer rename/move/delete 联动修复

**新增模块**：[`desktop/Agent/storage/pathRemapper.js`](../Agent/storage/pathRemapper.js)，导出 3 个 API：

- `remapInternalPath(projectDir, projectName, fromRel, toRel, { isDir, clipboardRecordPath, screenshotRecordPath })`
  - 文件夹（前缀替换）/文件（精确替换）rename / move 后调用
  - 联动 6 处存储：`classify-rules.json` / `preferences.json` / `clipboard-record.json` / `screenshots-record.json` / `project.db`（5 表事务）

- `cleanupDeletedPath(projectDir, projectName, deletedRel, { isDir })`
  - 文件夹/文件 delete 后调用
  - 软清理：`knowledge_items.archived` / `knowledge_links` DELETE / `suggestions` 标记 / `source_records` DELETE / 规则与偏好 `enabled=false`

**变更日志**

| 文件 | 变更 |
|------|------|
| `desktop/Agent/storage/pathRemapper.js` | 新增（700+ 行），统一管理路径联动 |
| `desktop/Agent/db/init.js` L5、L262-289 | `user_version` 8 → 9；新增 `archived_at` 列迁移（`archived` 列在 v3 已存在） |
| `desktop/Agent/db/knowledge.js` L67-74 | `listItems` 默认过滤 `archived = 0`；调用方可传 `includeArchived: true` 显式查看归档 |
| `desktop/src/main.js` 顶部 + L2020-2023 | 导入 `pathRemapInternal` / `pathCleanupDeleted` 并注入到 `registerExplorerIpc` |
| `desktop/src/main/ipc/explorer.js` 工厂 + L368-409、L489-560 | 注入 `remapInternalPath` / `cleanupDeletedPath` 并封装 `runRemap` / `runCleanup` helper；rename / move / delete 三个 handler 在主操作完成后统一调用，**文件与目录均覆盖**（修复历史上文件 rename 不联动的差异） |

**实施细节**

- **SQLite 多表事务**：`remapProjectDb` / `cleanupProjectDb` 用 `db.transaction(() => ...)` 包裹 5 张表更新，保证原子。
- **UNIQUE 冲突处理**：`suggestions.source_rel_path` 与 `source_records.source_rel_path` 是 UNIQUE 索引。前缀替换可能撞库，逻辑会先查目标是否存在，存在则跳过并计入 `suggestionsSkippedConflict` 返回值。
- **错误收敛**：所有联动失败收敛到 `{ ok, summary, errors }` 返回值；`runRemap` / `runCleanup` 仅 `console.warn`，不阻塞主操作。
- **历史快照保护**：`events` 表与 `activity_log.data` JSON 完全不动（W3 决策 D3）。

---

#### W3b — 项目 / 案件重命名

**复用 W3a 的统一模块** [`desktop/Agent/storage/pathRemapper.js`](../Agent/storage/pathRemapper.js) 中的 `renameWorkspace({ oldName, newName, domain, oldDir, newDir, readState, writeState, closeProjectDb, getStudyDb, getSupervisorDb })`。

**执行流程**

1. **关闭项目 DB 连接**（避免 Windows 文件锁）
2. **`fs.renameSync(oldDir, newDir)`** —— 主操作；失败立即抛错
3. **项目内 JSON `projectName` 字段替换**（3 个文件 best-effort）
4. **study 库 `board_items.source_project`** —— `UPDATE ... WHERE source_project = oldName AND source_domain = ?`
5. **supervisor.db 3 张表事务**：`notifications.project_name`、`preference_candidates.project_name + project_dir`、`preference_analysis_log`（PK 是 project_name，先 DELETE 冲突行再 UPDATE）
6. **state.json 迁移**：`currentProject`/`currentCase`、`projectStatuses`/`caseStatuses` keys、`localFolders[]` / `knowclaw.pinnedWorkspaces[]` / `hiddenWorkspaces[]` 中以 oldDir 为前缀的绝对路径
7. **不处理**：KnowClaw 会话 JSONL 的 `header.cwd`（决策 D4，旧会话失效由 UI 警告告知）

**变更日志**

| 文件 | 变更 |
|------|------|
| `desktop/Agent/storage/pathRemapper.js` | 新增 `renameWorkspace` API（与 W3a 同文件交付） |
| `desktop/src/main/ipc/projects.js` 顶部 + L188-227 | 注入 `getStudyDb` / `getSupervisorDb`，新增 `projects/rename` handler |
| `desktop/src/main/ipc/cases.js` 顶部 + L170-209 | 同上，新增 `cases/rename` handler |
| `desktop/src/main.js` L2025-2080 | 新增 `getStudyDbForRename` / `getSupervisorDbForRename` 并注入 |
| `desktop/src/preload.js` projects/cases 命名空间 | 暴露 `rename(oldName, newName)` |
| `desktop/src/ui/components/project-manager/hooks/useContextMenu.js` | `handleRowContextMenuRoot` 新增「重命名」菜单项（学习域不传 `renameProject` 则不显示） |
| `desktop/src/ui/components/ProjectManager.jsx` L138-198、L902-1020 | 新增 `renameWorkspaceState` 状态 + 两步模态（**警告页**：明确告知 KnowClaw 会话 cwd 失效、外部硬链接断裂、操作不可一键撤销；**输入页**：客户端非法字符校验 + 重命名后自动 `setCurrent` 新名 + `refreshProjects`） |

**验收**

- [x] 重命名「收到资料」→「入站资料」后，硬规则面板中规则的 `targetFolder` 显示新名
- [x] 重命名后知识全景中绑定的文件链接仍可点击跳转
- [x] 删除目录后该目录下的知识碎片在全景中消失（archived 默认过滤）
- [x] 项目重命名后 `setCurrent` 与列表显示新名；state.json 的 statuses key 迁移；study 库 board_items 跟随
- [x] 学习域不显示「重命名」菜单
- [x] 项目重命名前显示警告页，列出 KnowClaw 会话失效等隐患
- [x] 部分联动失败时主流程不回滚，UI 通过 notice 提示「已重命名但部分联动失败」

**观察**

- `knowledge_items.archived` 在 v3 schema 已存在但未使用，本期补 `archived_at` 时间戳即可。
- `events.suggested_folder` 等历史字段按决策保持原样；若未来 UI 想反向跳转到分类历史，需要做软重定向层。
- `source_records.source_path` 是用户上传时的外部绝对路径，不属于项目内 relPath，不参与 remap。

---

### Phase W4 — 文件管理 Header 路径化（去冗余）

**Status:** `DONE`（2026-05-21）

**目标**：进入案件/项目（及学习、本地文件夹视图）后，Header 第一行**不再**显示「案件文件：xxx」「当前案件：xxx」等重复文案；位置信息**只**通过面包屑表达，例如：`所有案件 / 案件D / 调研研究`。

**用户故事**

> 左上角一块写「案件文件：案件D」，下面又写「当前案件：案件D」，右边面包屑还是「所有案件/案件D/…」，信息重复三遍。

**现状锚点**

| 模块 | 路径 | 要点 |
|------|------|------|
| 文案计算 | `desktop/src/ui/components/ProjectManager.jsx` | `headerTitle`、`headerSubtitle`（约 257–276 行） |
| 面包屑 | 同文件 `breadcrumbs` useMemo（约 309–349 行） |
| 布局 | `desktop/src/ui/components/project-manager/HeaderBar.jsx` | 左侧 `h1`+`subtitle` 与右侧 `nav` 面包屑并列（约 169–205 行） |

**工作清单（待细化）**

读：
- `HeaderBar.jsx` 完整 Row1 布局
- 根列表页（`isRoot`）是否仍需独立标题——「所有案件」可能只保留面包屑一项

写/改：
1. `ProjectManager`：进入 `cwd.type === 'project'` 时，`title`/`subtitle` 改为空或合并进面包屑
2. `HeaderBar`：当无 subtitle 时 Row1 仅渲染面包屑（可放大字号/加粗当前节点）
3. 根目录页、本地文件夹页、学习域的特例样式（保持可读性）
4. 确认 `showBackHome` 返回按钮区域布局不塌陷

**设计草案**

```
[←]  所有案件 / 案件D / 调研研究
      ^root    ^project  ^active (semibold)
```

- 去掉：`案件文件：案件D`（h1）
- 去掉：`当前案件：案件D / 调研研究`（subtitle）

**不做**

- 不改 Row2 操作按钮区（上传、筛选、AI 暂存区等）
- 不涉及侧栏「我的数据」层级

**验收标准**

- [x] 进入「案件D / 调研研究」仅见一条路径，无重复项目名行
- [x] 根列表「所有案件/项目」保留 `entityLabelAll` 标题 + 「共 N 个」副标题，可辨认当前域
- [x] 窄屏下面包屑可横向滚动（`overflow-x-auto no-scrollbar` 保持）

**实施摘要**

| 决策 | 选择 |
|------|------|
| 工作区视图（项目/案件/学习/本地）的 title/subtitle | **完全清空**，位置语义全部交给面包屑 |
| 根列表（`isRoot`）的 title/subtitle | **保留**：标题 = `所有项目/案件`，副标题 = `共 N 个项目/案件`（提供数量统计） |
| 面包屑当前节点视觉强化 | 字号 `text-[14px]` + `font-semibold text-slate-900`；非当前段为 `text-[13px]`；max-w 由 `120px` → `160px` |
| 左侧标题块容器 | 当 `title` 与 `subtitle` 均为空时**整块 + 右侧分隔线一起隐藏**；只有返回按钮（`showBackHome`）独立保留并使用更紧凑的 `mr-1` 间距 |
| 学习域 / 本地文件夹的语义提示 | 通过面包屑第一段 `学习` / 本地根目录名表达（已在 `ProjectManager.breadcrumbs` 中实现，本期未改动） |

**变更日志**

| 文件 | 变更 |
|------|------|
| `desktop/src/ui/components/ProjectManager.jsx` L326-345 | `headerTitle` / `headerSubtitle` 重写：仅 `isRoot` 保留语义文案，其它分支返回空字符串。删除原来的 `案件文件：xxx` / `当前案件：xxx / yyy` / `本地文件夹：xxx` / `路径：…` 等四种重复表达 |
| `desktop/src/ui/components/project-manager/HeaderBar.jsx` L168-216 | Row1 左标题块改为条件渲染：`title \|\| subtitle` 为空时整块（含 `border-r` 分隔线）隐藏；`showBackHome` 仍可独立显示。面包屑容器字号 `text-sm` → `text-[13px]`，当前节点 `text-[14px]` 加粗，`max-w-[120px]` → `max-w-[160px]` |

**观察**

- W3b 中重命名后会自动 `setCurrent` 新名 + 刷新列表，本期 W4 直接通过面包屑显示新名，无需额外联动。
- 学习域因没有项目段（`isStudy` 时 `breadcrumbs` 不 push `project` 段），单一 `学习` 面包屑配合后续目录段已能完整表达位置；本期不在 breadcrumb 上再追加"学习"前缀避免冗余。
- 本地文件夹的根面包屑使用磁盘文件夹名而非固定的"本地"前缀；考虑到外部目录通常名称已具辨识度，且独立 title 已去除，未发现可读性下降问题。若后续 RW-5 风险显现，可在 `breadcrumbs` 计算处把第一段统一为"本地 / {folderName}"。

---

## 4. 风险登记表

| ID | 风险 | 触发阶段 | 概率 | 影响 | 缓解 |
|----|------|---------|------|------|------|
| RW-1 | 放开删除默认四类后，分类候选为空 | W1 | 中 | 中 | UI 提示 + 上传前检查 structure；保留「套用默认模板」可选 |
| RW-2 | 重命名未迁移 `source_project` 导致看板卡片断链 | W3 | 高 | 高 | W3 实现前列出所有存 projectName 的表；改名事务内批量 UPDATE |
| RW-3 | `structure.json` 与磁盘不同步 | W1/W3 | 中 | 高 | 删除/重命名后强制 `syncStructureJson`；单测覆盖 |
| RW-4 | 去掉种子规则后新用户分类质量下降 | W2 | 中 | 低 | 空状态引导 + 教程页补充「建议第一条规则」示例（非自动写入） |
| RW-5 | Header 仅面包屑后，学习域/本地文件夹语义不清 | W4 | 低 | 低 | 域前缀词固定（「学习」「本地」）保留在 breadcrumb 第一段 |

---

## 5. 进度看板

| 阶段 / 条目 | Status | 完成日期 | 备注 |
|------------|--------|---------|------|
| W1 — 业务文件夹可完全自定义 | DONE | 2026-05-21 | D1=B 模板弹窗 / D2=否 / D3=阻止；改动 7 文件 |
| W2 — 取消新建默认硬规则 | PLANNED | | |
| W3 — 案件/项目重命名 | PLANNED | | 依赖 W3-D1 数据迁移范围 |
| W4 — Header 路径化 | DONE | 2026-05-21 | 工作区视图去除 title/subtitle，root 保留语义；改动 2 个文件 |
| Backlog-A — 悬浮窗 ⇄ 中台 | DONE | 2026-05-20 | G1.0/G1.1/G1.2 全量落地；改动 5 个文件，约 ~250 行；详情见 KnowClaw 计划附录 Backlog-A |

---

## 6. 升级后终态画像（W1–W4 完成后）

1. **工作区结构用户主权**：除系统目录外，业务文件夹可增删改；新建可选空白或模板，不锁死四类。
2. **分类规则用户主权**：新工作区零硬规则；规则面板由用户从零或模板导入。
3. **工作区可改名**：案件/项目名称可在应用内修正，磁盘与索引一致。
4. **文件页导航清晰**：Header 单一面包屑路径，无三重重复项目名。
5. **悬浮窗体验**：Backlog-A 已于 2026-05-20 完成 G1.0/G1.1/G1.2 全量改造（P0+P1+P2），切换路径瞬时无闪烁、入口三处可见、托盘 + 快捷键 + 拖拽把手齐备。

---

## 7. 术语表

- **业务文件夹**：项目/案件根下用户用于归档的目录（原默认四类：收到资料、过程文档、调研研究、交付成果）。
- **系统文件夹**：`meta`、`temp`、`snippets` 等不可删改的目录（具体列表以 `isProtectedRelPath` / `isProtectedFolderNameRelPath` 为准，W1 后需更新文档）。
- **硬规则**：`meta/classify-rules.json`，Classifier 快速通道，不经过 LLM。
- **structure.json**：`meta/structure.json`，文件夹描述与分类候选的权威来源之一。
- **种子规则**：`seedDefaultRules()` 写入的 `source: 'system_seed'` 规则集（W2 后新建工作区不再自动写入）。

---

## 附录 · Backlog（待评估 / 非 W1–W4 主线）

本节归档与 **W1–W4 不直接相关**、但已记录的体验问题。格式与 KnowClaw 计划附录一致。

---

### Backlog-A · 悬浮窗 ⇄ 中台 切换不顺手（2026-05-20 提出）

> **完整正文**（用户原文、代码根因、P0/P1/P2 候选方案、Checklist）见：  
> [`KNOWCLAW_UPGRADE_PLAN.md` → 附录 · Backlog-A](./KNOWCLAW_UPGRADE_PLAN.md#backlog-a--悬浮窗--中台-切换不顺手2026-05-20-提出)

#### A.0 在本计划中的定位

| 字段 | 值 |
|------|-----|
| 对应差距 | §1 G1 |
| 与 W1–W4 关系 | **不阻塞**文件夹/规则/重命名/Header 改造；可独立排期 |
| 决策状态 | **DONE**（2026-05-20 一次性落地 P0+P1+P2，全局快捷键定为 `Ctrl+Shift+Space`） |
| 实际工作量 | 5 文件，约 ~250 行净增（含注释）；接近计划估算（读 ≤ 8 / 写 ≤ 5 满足） |
| 偏差 | rail 顶部 `rounded-l-2xl` 与新增的 8px 拖拽把手 `rounded-t-2xl` 会视觉冲突，额外把 rail / 右主面板的圆角从 `rounded-l/r-2xl` 调整为 `rounded-bl/br-2xl`（计划未提及，写时发现并修正） |
| 建议后续观察 | 多显示器拔插后 hide 悬浮窗的位置/尺寸恢复；`startClipboardWatcher` 在 hide→show 周期里是否重复通知首段剪贴板内容（RW-1.1-2，预期无害） |

#### A.1 摘要（便于本计划内检索）

- **进入悬浮**：侧栏 → 工作区菜单 →「悬浮模式」，入口深。
- **回到中台**：仅悬浮窗右键「回到中台」，无显眼按钮/快捷键。
- **性能**：`ui/backToMain` 关闭悬浮窗，再次打开需完整重建。

#### A.2 推荐落地顺序（摘自 KnowClaw 计划）

1. P0-1 悬浮窗显眼「回到中台」按钮  
2. P0-2 全局快捷键切换  
3. P0-3 Esc 回到中台  
4. P1-4 `hide` 替代 `close`  
5. P1-5 侧栏入口前移  

#### A.3 后续启动 Checklist

- [x] 从 KnowClaw 计划 Backlog-A 复制最新决策状态
- [x] 实现前确认剪贴板 watcher 在 hide/show 下的生命周期（A.6 原 Checklist）
- [x] 完成后在两份计划的 Backlog-A 表中将状态改为 **DONE**

#### A.4 实际改动清单（2026-05-20 完成）

| 改动点 | 文件 | 说明 |
|--------|------|------|
| 悬浮窗左侧 rail 顶部「回中台」按钮 + Esc 三档升档 | `desktop/src/ui/components/floating/FloatingMode.jsx` | 取代仅在右键菜单的入口；Esc 先关右键菜单→关子面板→回中台 |
| 全局快捷键 `Ctrl+Shift+Space` 双向切换 + `will-quit` 反注册 + Tray 系统托盘（打开中台/打开悬浮/退出，单击切换） | `desktop/src/main.js` | 同步把 `createFloatingWindow` 改为「存活即复用 show」，watcher 改挂 `show`/`hide` 事件 |
| `ui/backToMain` 从 `close` 改为 `hide`；`ui/openFloating` / `ui/backToMain` 接入 120ms 淡入淡出（macOS 透明窗降级为单步 setOpacity） | `desktop/src/main/ipc/ui.js` | 复用悬浮窗内部状态，多次切换瞬时；fadeWindow 工具函数封装 |
| 侧栏底部独立「悬浮模式」按钮（折叠态可见）+ 原 workspaceMenu 入口加迁移提示 | `desktop/src/ui/components/Sidebar.jsx` | 入口前移，老用户保留兼容路径 |
| 主窗 36px 顶部 drag 条右侧加「切换到悬浮窗」图标按钮（避开 Windows 系统 caption controls） | `desktop/src/ui/App.jsx` | 与悬浮窗左上「回中台」对称，发现性提升 |
| 悬浮窗顶部 8px 可视拖拽把手（小横条样式 + `WebkitAppRegion: drag`，rail / 右主面板圆角调整） | `desktop/src/ui/components/floating/FloatingMode.jsx` | frameless transparent 窗的拖动入口可视化 |

---

## 附录 · 变更记录（文档级）

| 日期 | 作者 | 变更 |
|------|------|------|
| 2026-05-20 | — | 初版：登记 G1–G5；建立 W1–W4 框架；Backlog-A 交叉引用 KnowClaw 计划 |
| 2026-05-20 | — | Backlog-A 实施完成：G1.0/G1.1/G1.2 一次性落地（P0 三件套 + hide 改造 + 入口前移 + 标题栏按钮 + Tray + fade 过渡 + 拖拽把手）；状态由 DEFERRED 改为 DONE |
| 2026-05-21 | — | W1 实施完成：业务文件夹解锁删除/重命名/移动；新建支持「默认四类 / 空白」模板选择；删除文件夹前阻止仍含 pending AI suggestion 的目录；改动 7 个文件（main.js / explorer.js / projects.js / cases.js / preload.js / useProjectActions.js / ProjectManager.jsx） |

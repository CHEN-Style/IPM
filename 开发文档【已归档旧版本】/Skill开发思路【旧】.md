# Skill 开发思路

## 1. 讨论背景

当前 IPM 的文件分类 Agent 已具备一定学习能力，主要依赖以下信息源：

- 过往的 `accept / reject` 分类记录
- 项目文件夹描述
- 文件名、文件路径、来源路径等元信息

我们讨论的核心问题是：是否可以借鉴 `OpenClaw` 的 `Skills / Soul` 思想，让文件分类 Agent 具备更强的可教导性、可演化性与个性化能力。

初步结论是：**值得借鉴，但不能照搬通用 Agent 方案，必须做垂直领域重构。**

---

## 2. 对 Skills 的理解

我们已经对 `Skills` 的本质达成了一致理解：

- 它通常不是模型底层的新能力
- 本质上是把一类任务的经验、流程、约束、最佳实践做成模块化能力包
- 系统按需发现、筛选、加载这些模块，而不是把所有说明长期堆在主 prompt 中

因此，`Skill` 的价值不只是“省去每次手写 prompt”，更重要的是：

- 让经验可复用
- 让流程更稳定
- 让上下文按需注入
- 让复杂业务知识可以持续维护

---

## 3. 在文件分类 Agent 中如何映射 Skill

在 IPM 里，`Skill` 不适合定义为“让 Agent 会更多事”，而更适合定义为：

**面向分类判断的策略模块。**

三者关系可总结为：

- `Tool`：负责取证
- `Skill`：负责解释证据、形成判断倾向
- `Agent`：负责选择 Skill、调度 Tool、综合输出最终分类结果

因此，Skill 的主要职责不是直接给出最终分类，而是输出：

- 倾向信号
- 候选目录偏向
- 风险提醒
- 适用边界

---

## 4. 对 Soul 的理解

对于 IPM 来说，不建议把 `Soul` 做成泛人格化设定。

更适合的方向是：

**把 Soul 理解为用户的分类哲学、判断原则和长期偏好。**

也就是说，Soul 的价值不在于“更像人”，而在于“更像这个用户本人如何分类”。

例如：

- 宁可保守不乱放
- 外部收到的原始材料通常放 `收到资料`
- 带有 `草稿 / 修改意见 / v2` 的文件更偏 `过程文档`
- 某用户习惯把法院文书与客户原始资料分开管理

---

## 5. 目前重点讨论的三类 Skill

### 5.1 文件名语义 Skill

它不是简单替代快速通道，而是对快速通道背后“文件名判断逻辑”的上升抽象。

区别在于：

- `Fast Path` 更像执行层，命中后直接出结果
- `文件名语义 Skill` 更像认知层，先分析文件名中有哪些信号、哪些信号冲突、这些信号各自支持什么目录

例如：

- `合同-王某某.pdf`：语义明确，可直接支撑 fast path
- `合同修改意见-v3.docx`：既有“合同”又有“修改意见”“v3”，不适合粗暴套规则，应先做语义拆解，再作为分类证据参与综合判断

结论：

**文件名语义 Skill 是对现有快速通道认知逻辑的模块化升级。**

### 5.2 来源判断 Skill

它可以看作是把当前 prompt 里“根据来源路径推断文件性质”的经验显式化、模块化。

现有经验包括：

- 微信 / 企业微信 / 邮件附件来源，大概率偏 `收到资料`
- 本地编辑目录、桌面草稿、Office 编辑路径，大概率偏 `过程文档`
- `research`、调研相关下载目录，大概率偏 `调研研究`

这类经验当前写在 prompt 中，存在问题：

- 不可观察
- 不可单独调试
- 不便于后续增量优化

如果升级为 `来源判断 Skill`，则可以输出：

- 识别出的来源特征
- 对各候选目录的支持程度
- 来源信号强弱
- 风险提示（例如：来源仅是弱证据，不能独立决定分类）

结论：

**来源判断 Skill 可以逐步替代 system prompt 中的具体来源经验，使 prompt 只保留总原则。**

### 5.3 用户偏好 Skill

这是最重要、也最复杂的一块。

其目标是让 Agent 不仅能从行为数据中学习，还能从用户的自然语言教导中学习，例如：

- 用户直接描述自己的分类习惯
- 用户在拒绝分类结果时，用自然语言解释“为什么分错了”

这一能力会形成明显差异化，但风险也最大。

---

## 6. 快速通道的升级方向

我们讨论出的重要方向之一是：

**将快速通道升级为项目级、用户可配置的规则系统。**

含义是：

- 用户可以为每个项目配置高确定性的分类规则
- 一旦规则命中，可直接进入 fast path
- 这类规则因为由用户主动定义，通常置信度最高

建议优先级顺序：

1. 项目级用户显式规则
2. 项目级自动学习规则
3. 通用/默认规则

建议支持的条件不应只限于“文件名包含关键词”，还应支持少量结构化条件，例如：

- 文件名关键词
- 扩展名
- 来源特征
- 排除词

这样可以避免出现：

- 命中“合同”就进入 `收到资料`
- 但 `合同修改意见.docx` 实际应进入 `过程文档`

结论：

**项目级、用户可配置的快速通道规则，既符合可信赖原则，也有很强的产品价值。**

---

## 7. 用户偏好 Skill 的关键风险

用户偏好 Skill 是一个更庞大的体系，而且随着项目使用时间增长，信息量可能持续膨胀。

我们已经明确：**不能把它做成一段越来越长的文本直接塞进 prompt。**

否则会出现以下问题：

- token 消耗持续上升
- 上下文噪声变大
- 新旧偏好相互冲突
- 模型难以判断哪些偏好更重要
- 记忆从资产变成负担

因此，用户偏好 Skill 必须走：

**结构化记忆 + 检索 + 压缩摘要**

而不是：

**长文本累计注入**

---

## 8. 用户偏好系统的设计方向

当前讨论的方向是将用户偏好拆为分层系统，而不是单一文本块。

建议分层如下：

### 8.1 原始事件层

记录客观事实，但不直接进入 prompt。

例如：

- 某文件被 accept
- 某文件被 reject
- 用户手动改到其他目录
- 用户补充了“为什么错了”

这一层负责追溯，不直接参与最终分类 prompt 注入。

### 8.2 结构化偏好层

将原始事件提炼为结构化偏好条目，例如：

- 含 `修改意见` 的 docx 偏向 `过程文档`
- 带 `草稿` 的文件降低进入 `收到资料` 的概率
- 来自微信但文件名含 `回复函草稿` 时，应降低来源信号权重

这一层才是分类系统真正可利用的记忆。

### 8.3 检索层

每次分类时，不加载全部偏好，只检索与当前文件最相关的一小部分。

检索维度可以包括：

- 当前项目
- 文件名关键词
- 扩展名
- 来源特征
- 候选目录
- 相似历史错因

### 8.4 摘要层

定期把高频偏好压缩成项目级短摘要，用于辅助 prompt 注入。

例如：

- 用户通常将外部原始材料归入 `收到资料`
- 带 `草稿 / 修改意见 / v2` 的文件更倾向 `过程文档`
- 该项目中法院文书与客户资料倾向分开管理

摘要应保持短小，只用于补充，不应替代结构化检索。

---

## 9. 当前已形成的关键判断

### 9.1 关于快速通道

- 适合升级为项目级用户可配置规则
- 用户主动配置的规则通常具有最高可信度
- 这类规则应优先于自动学习规则

### 9.2 关于来源判断 Skill

- 完全可以承接 prompt 中现有的来源经验
- 一旦成熟，system prompt 可只保留原则，不再保留细碎领域经验
- 这会让系统更可观察、更可调试、更易迭代

### 9.3 关于用户偏好 Skill

- 必然是一个大体系
- 不能做成长文本记忆
- 必须设计成分层、结构化、可检索的偏好系统

---

## 10. 后续最值得深入讨论的三个边界

接下来最值得继续定义的，不是 UI，而是以下三个边界：

1. 什么属于 `项目级硬规则`
2. 什么属于 `可检索的软偏好`
3. 什么只属于原始事件，不直接参与分类

这三个边界一旦明确，后续无论是 prompt、Skill、规则引擎、数据结构、UI 入口，都会容易很多。

---

## 11. 当前阶段的总体结论

当前讨论的总体方向可以概括为：

- 借鉴 `OpenClaw` 的 `Skills` 思想是合理的
- 但不应照搬通用 Agent 的实现方式
- IPM 中的 Skill 更适合作为“分类判断策略模块”
- `Soul` 更适合作为“用户分类哲学 / 判断原则 / 长期偏好”
- `Fast Path`、`来源判断 Skill`、`用户偏好 Skill` 将构成后续分类能力增强的三个关键支点

后续深入时，应优先保证：

- 可信赖优先
- 上下文可控
- token 成本可控
- 偏好可解释
- 规则与偏好边界清晰

---

## 12. 三层模型定义

在讨论中，我们将用户偏好系统明确定义为三层模型：

### 12.1 项目级硬规则

- **定义**：用户显式配置的确定性分类规则
- **特征**：置信度最高，命中后直接走 Fast Path，跳过 AI
- **存储**：每个项目独立的 `meta/classify-rules.json`
- **来源**：用户手动创建，或后续由软偏好自动提升
- **支持条件**：文件名包含/排除、扩展名、来源路径包含/排除
- **优先级**：用户规则 > 内置默认规则

### 12.2 软偏好

- **定义**：概率性分类倾向，影响 Agent 决策权重但不直接决定结果
- **特征**：带强度（strength）的倾向信号，Agent 综合考虑后做最终判断
- **存储**：每个项目独立的 `meta/preferences.json`
- **来源**：用户手动创建、自然语言教导（LLM 解析）、后续可扩展自动提炼
- **机制**：支持偏好衰减——当偏好导致错误分类被拒绝时，自动降低 strength

### 12.3 原始事件

- **定义**：所有分类活动的完整事实记录
- **特征**：只增不删，append-only，是学习的数据地基
- **存储**：`meta/classify-events.jsonl`（JSONL 格式）
- **来源**：accept / reject 操作时自动写入
- **用途**：为软偏好提供学习数据，为用户提供完整可追溯性

#### 关键架构决策：拆分 ai-storage.json

现有 `ai-storage.json` 同时承担了"暂存区"和"历史记录"两个职责，随着使用时间增长会持续膨胀且职责混乱。升级方案为：

- **`ai-storage.json` 回归纯暂存区**：只保留 pending 状态的分类建议，用户 accept/reject 处理完后，关键信息沉淀到原始事件存储，已处理条目可定期从暂存区清理。
- **新增独立的 `原始事件` 存储**（`classify-events.jsonl`）：在 accept/reject 流程中，把文件名、扩展名、来源、Agent 建议、用户决策、reject 后手动去向、用户自然语言反馈等事实写入此处。只增不删，专为学习服务。
- **新增 `软偏好` 存储**（如 `preference-history.json`）：保存从原始事件中提炼出的结构化偏好条目，而不是长文本 prompt。
- **升级 `硬规则` 存储**：支持项目级用户显式规则，以及后续由软偏好提升而来的规则。

---

## 13. 开发记录：硬规则层

### 13.1 后端：规则存储模块

**新建文件**：`desktop/Agent/storage/classifyRules.js`

实现了项目级分类规则的完整 CRUD：

- `readClassifyRules(projectDir)` — 读取规则列表
- `addRule(projectDir, rule)` — 新增规则
- `updateRule(projectDir, ruleId, patch)` — 更新规则
- `deleteRule(projectDir, ruleId)` — 删除规则
- `reorderRules(projectDir, orderedIds)` — 重排优先级
- `incrementHitCount(projectDir, ruleId)` — 命中计数 +1

规则 Schema：

```json
{
  "id": "短UUID",
  "label": "规则名称",
  "targetFolder": "目标文件夹相对路径",
  "conditions": {
    "nameIncludes": ["关键词1", "关键词2"],
    "nameExcludes": ["排除词"],
    "exts": ["docx", "pdf"],
    "sourceIncludes": ["WXWork"],
    "sourceExcludes": []
  },
  "confidence": 0.95,
  "enabled": true,
  "priority": 100,
  "source": "user_defined",
  "hitCount": 0,
  "createdAt": "ISO时间戳",
  "updatedAt": "ISO时间戳"
}
```

存储位置：`meta/classify-rules.json`，每个项目独立。

### 13.2 后端：Fast Path 升级

**改造文件**：`desktop/Agent/classifier/fastPath.js`

- `tryFastPath` 新增 `projectDir` 和 `sourceDir` 参数
- 执行顺序改为：先匹配用户规则 → 再匹配内置默认规则
- 用户规则按 priority 降序排列
- 命中用户规则时自动 `incrementHitCount`
- 返回结果携带 `classifiedBy: 'fast-path-user-rule'` 标识

**改造文件**：`desktop/Agent/classifier/index.js`

- 从 input 中解构 `projectDir` 和 `sourceDir`，传给 `tryFastPath`

### 13.3 后端：Agent Tool 升级

**改造文件**：`desktop/Agent/tools/getUserRules.js`

- `createGetUserRulesTool` 接受 `projectDir` 参数
- 实际读取 `classify-rules.json` 中 enabled 的规则并暴露给 Agent

**改造文件**：`desktop/Agent/classifier/agent.js`

- `createGetUserRulesTool()` 改为 `createGetUserRulesTool(projectDir)`

### 13.4 后端：IPC 接口

**新建文件**：`desktop/src/main/ipc/classifyRules.js`

注册了 5 个 IPC handler：
- `classifyRules/list` — 列出所有规则
- `classifyRules/add` — 新增规则
- `classifyRules/update` — 更新规则
- `classifyRules/delete` — 删除规则
- `classifyRules/reorder` — 重排序

**改造文件**：`desktop/src/main.js` — 注册新 IPC 模块
**改造文件**：`desktop/src/preload.js` — 暴露 `classifyRules` API 给前端

### 13.5 前端：规则管理 UI

**新建文件**：`desktop/src/ui/components/project-manager/ClassifyRulesPanel.jsx`

完整的规则管理面板，支持：
- 规则列表展示（启用/禁用开关、编辑、删除、命中次数）
- 新增/编辑表单（规则名称、目标文件夹选择、文件名包含/排除、扩展名、来源路径条件）
- `embedded` 模式（内嵌到 PreferencesPage）和 `modal` 模式（独立弹窗）

### 13.6 前端：分类追踪升级

**改造文件**：`desktop/src/ui/components/project-manager/ClassifyTraceView.jsx`

- `classifiedByLabel` 新增识别 `'fast-path-user-rule'`，显示为"快速通道（用户规则）"
- `TraceStepNode` 新增用户规则匹配的展示节点（蓝色闪电图标 + 规则名称）

### 13.7 前端：偏好与记录入口

**改造文件**：`desktop/src/ui/components/project-manager/RootTable.jsx`

- 表头新增"偏好与记录"列
- 每个项目行新增 `Settings2` 图标按钮，点击调用 `onOpenPreferences`
- 本地文件夹行补齐占位 td

**新建文件**：`desktop/src/ui/components/project-manager/PreferencesPage.jsx`

独立页面，三个 Tab 切换：
- **硬规则**：内嵌 ClassifyRulesPanel（embedded 模式）
- **软偏好**：Mock 占位
- **原始事件**：接入真实数据（后续开发完成）

**改造文件**：`desktop/src/ui/components/ProjectManager.jsx`

- 新增 `preferencesCtx` state，类似 `snippetLinkerCtx` 的页面跳转模式
- RootTable 传入 `onOpenPreferences` 回调
- 页面拦截：`preferencesCtx` 非 null 时渲染 `PreferencesPage`
- 清理旧的 `rulesOpen` state 和 `ClassifyRulesPanel` 弹窗渲染

### 13.8 Bug 修复

**问题**：硬规则表单的目标文件夹下拉框无法选择文件夹

**原因**：`explorer/list` IPC 返回的目录条目使用 `kind: 'dir'` 标识文件夹，但 ClassifyRulesPanel 中的过滤条件用了 `e.isDirectory`（始终为 undefined），同时 `!e.system` 也无效（entries 没有 system 属性）。

**修复**：将 `e.isDirectory` 改为 `e.kind === 'dir'`，将 `!e.system` 改为显式排除系统目录名（`meta`、`temp`、`snippets`）。

---

## 14. 开发记录：原始事件层

### 14.1 事件 Schema 设计

每条事件记录一个用户决策时刻（accept 或 reject），存储为 JSONL 格式，每行一个 JSON 对象：

```json
{
  "id": "UUID",
  "ts": "2026-03-19T10:30:00.000Z",
  "event": "classify.accepted | classify.rejected",
  "fileName": "争议焦点拆解v1.docx",
  "ext": "docx",
  "sourcePath": "D:\\知识管理测试文件\\争议焦点拆解v1.docx",
  "sourceDir": "D:\\知识管理测试文件",
  "suggestedFolder": "过程文档/工作文件",
  "rationale": "文件名含v1表明是内部迭代中的工作稿...",
  "confidence": 0.85,
  "classifiedBy": "agent | fast-path | fast-path-user-rule",
  "actualFolder": "过程文档/工作文件（accepted时）| null（rejected时）",
  "movedToRelPath": "过程文档/工作文件/争议焦点拆解v1.docx（accepted时）| null",
  "userFeedback": "用户填写的拒绝原因（可选）| null",
  "feedbackAt": "反馈填写/修改时间（如有）"
}
```

设计要点：
- **不记录 `classify.created`**：pending 状态已存在于 `ai-storage.json`，无需重复
- **只记录用户决策**：`classify.accepted` 和 `classify.rejected`
- **合并来源信息**：从 `temp-source-record.json` 中查找 `sourcePath` 和 `sourceDir` 并写入事件
- **预留 `userFeedback`**：reject 时可选填写原因，也支持事后补填

### 14.2 后端：事件存储模块

**新建文件**：`desktop/Agent/storage/classifyEvents.js`

四个核心函数：

- `appendClassifyEvent(projectDir, eventData)` — 追加写入 JSONL，自动生成 UUID 和时间戳
- `readClassifyEvents(projectDir, opts)` — 读取事件列表，支持 `eventType` 筛选、`search` 搜索、分页（`limit`/`offset`），返回 `{ total, offset, limit, events }`，默认按时间倒序
- `updateEventFeedback(projectDir, eventId, feedback)` — 更新指定事件的 `userFeedback` 字段，支持事后补填/修改
- `lookupSourceInfo(projectDir, sourceRelPath)` — 从 `temp-source-record.json` 查找文件原始来源路径

### 14.3 后端：IPC 接口

**新建文件**：`desktop/src/main/ipc/classifyEvents.js`

注册了 2 个 IPC handler：
- `classifyEvents/list` — 查询事件列表（支持筛选、搜索、分页）
- `classifyEvents/updateFeedback` — 更新事件反馈

**改造文件**：`desktop/src/main.js` — 注册新 IPC 模块
**改造文件**：`desktop/src/preload.js` — 暴露 `classifyEvents.list()` 和 `classifyEvents.updateFeedback()` API

### 14.4 后端：accept/reject 流程改造

**改造文件**：`desktop/src/main/ipc/aiStorage.js`

在四个 handler 中植入事件写入逻辑：

- **`aiStorage/accept`**：accept 成功后，查找来源信息，写入 `classify.accepted` 事件
- **`aiStorage/acceptAll`**：每条成功 accept 后写入事件
- **`aiStorage/reject`**：新增 `userFeedback` 参数支持；reject 成功后写入 `classify.rejected` 事件（携带 userFeedback）
- **`aiStorage/rejectAll`**：每条成功 reject 后写入事件

所有事件写入均为 non-critical（try-catch 包裹），不影响主流程。

### 14.5 前端：拒绝反馈 Popover

**新建文件**：`desktop/src/ui/components/project-manager/RejectPopover.jsx`

轻量级弹出组件（方案 B）：
- 点击"放弃"按钮后弹出，显示在按钮下方
- 包含一个 textarea 输入框（placeholder："例如：这个文件应该归到交付成果"）
- Enter 确认拒绝，Escape 取消
- 不填反馈直接点"确认放弃"也可以

**改造文件**：`desktop/src/ui/components/project-manager/AIGhostOverview.jsx`

- 引入 `RejectPopover`，逐条拒绝按钮改为先弹出 popover，确认后调用 `onRejectItem(src, { userFeedback })`

**改造文件**：`desktop/src/ui/components/project-manager/EntryTable.jsx`

- 同样引入 `RejectPopover`，拒绝按钮改为弹出 popover

**改造文件**：`desktop/src/ui/components/project-manager/hooks/useGhosts.js`

- `rejectGhost` 签名从 `(sourceRelPath)` 改为 `(sourceRelPath, { userFeedback } = {})`
- 透传 `userFeedback` 到 `aiStorage.reject` IPC 调用

### 14.6 前端：原始事件 Tab

**新建文件**：`desktop/src/ui/components/project-manager/ClassifyEventsTab.jsx`

完整的事件时间线 UI：

- **时间线展示**：按日期分组，每组显示日期标题和事件数量
- **搜索**：文件名、文件夹关键词搜索
- **筛选**：全部 / 已接受 / 已拒绝 三种筛选
- **详细/简略模式切换**：
  - 详细模式：显示分类方式、置信度、来源路径
  - 简略模式：只显示文件名、事件类型图标、目标文件夹、时间
- **展开详情**：点击任意事件行可展开，查看完整信息（分类方式、置信度、建议文件夹、实际归入、原始来源路径、AI 理由、用户反馈）
- **反馈编辑**：rejected 事件展开后可点击编辑按钮，弹出 modal 补填/修改反馈（方案 C）

**改造文件**：`desktop/src/ui/components/project-manager/PreferencesPage.jsx`

- 引入 `ClassifyEventsTab`
- "原始事件" Tab 从 Mock 占位替换为真实的 `<ClassifyEventsTab>` 组件

### 14.7 文件变更清单

| 操作 | 文件路径 |
|------|----------|
| 新建 | `desktop/Agent/storage/classifyEvents.js` |
| 新建 | `desktop/src/main/ipc/classifyEvents.js` |
| 新建 | `desktop/src/ui/components/project-manager/RejectPopover.jsx` |
| 新建 | `desktop/src/ui/components/project-manager/ClassifyEventsTab.jsx` |
| 改造 | `desktop/src/main/ipc/aiStorage.js` |
| 改造 | `desktop/src/main.js` |
| 改造 | `desktop/src/preload.js` |
| 改造 | `desktop/src/ui/components/project-manager/hooks/useGhosts.js` |
| 改造 | `desktop/src/ui/components/project-manager/AIGhostOverview.jsx` |
| 改造 | `desktop/src/ui/components/project-manager/EntryTable.jsx` |
| 改造 | `desktop/src/ui/components/project-manager/PreferencesPage.jsx` |

---

## 15. 开发记录：软偏好层（基础架构）

### 15.1 偏好 Schema 设计

每条软偏好表示一个概率性分类倾向，存储在 `meta/preferences.json` 中：

```json
{
  "schemaVersion": 1,
  "preferences": [
    {
      "id": "pref_xxx_1",
      "pattern": "来自微信的 PDF 文件通常是客户发来的外部资料",
      "conditions": {
        "nameIncludes": [],
        "nameExcludes": [],
        "exts": ["pdf"],
        "sourceIncludes": ["WeChat", "微信"],
        "sourceExcludes": []
      },
      "tendency": {
        "folder": "收到资料",
        "strength": 0.7
      },
      "evidence": {
        "totalMatched": 0,
        "accepted": 0,
        "rejected": 0,
        "lastSeenAt": null
      },
      "enabled": true,
      "source": "user_defined | natural_language | auto_learned",
      "createdAt": "ISO时间戳",
      "updatedAt": "ISO时间戳"
    }
  ]
}
```

设计要点：
- **conditions 与硬规则同构**：`nameIncludes`、`nameExcludes`、`exts`、`sourceIncludes`、`sourceExcludes`，方便后续偏好提升为硬规则
- **tendency.strength**：0.1~1.0 的倾向强度，语义标签为极弱/弱/中/强/极强
- **evidence**：记录匹配/采纳/拒绝次数，为衰减和提升提供数据支撑
- **source**：区分来源类型（手动创建、自然语言教导、自动学习）

### 15.2 后端：偏好存储模块

**新建文件**：`desktop/Agent/storage/preferences.js`

五个核心函数：

- `readPreferences(projectDir)` — 读取偏好列表
- `addPreference(projectDir, pref)` — 新增偏好（自动生成 ID、时间戳、初始化 evidence）
- `updatePreference(projectDir, prefId, patch)` — 更新偏好（支持部分更新，自动 normalize conditions 和 strength 边界）
- `deletePreference(projectDir, prefId)` — 删除偏好
- `matchPreferences(projectDir, { fileName, ext, sourceDir })` — 匹配偏好：根据文件名、扩展名、来源路径查找所有匹配的已启用偏好，按 strength 降序返回

匹配逻辑要点：
- 必须至少有一个有效条件（`nameIncludes`、`exts`、`sourceIncludes` 任一非空），无条件的偏好不会匹配任何文件
- 所有条件之间为 AND 关系：满足所有非空条件才算匹配
- `nameExcludes` 和 `sourceExcludes` 为排除条件：命中则排除

### 15.3 后端：IPC 接口

**改造文件**：`desktop/src/main/ipc/preferences.js`

注册了 4 个 IPC handler：
- `preferences/list` — 列出所有偏好
- `preferences/add` — 新增偏好
- `preferences/update` — 更新偏好
- `preferences/delete` — 删除偏好

**改造文件**：`desktop/src/main.js` — 注册新 IPC 模块
**改造文件**：`desktop/src/preload.js` — 暴露 `preferences` API（`list`、`add`、`update`、`delete`）

### 15.4 后端：Agent Tool 集成

**新建文件**：`desktop/Agent/tools/getPreferences.js`

- `createGetPreferencesTool(projectDir)` — 创建 Agent 可调用的 tool
- 接受 `fileName`、`ext`、`sourceDir` 参数，内部调用 `matchPreferences`
- 返回匹配的偏好列表供 Agent 在分类决策时参考

**改造文件**：`desktop/Agent/classifier/agent.js`

- 导入 `createGetPreferencesTool`，加入 Agent 的 tools 数组
- Agent 可以在分类时主动查询与当前文件匹配的软偏好

### 15.5 前端：偏好管理面板

**新建文件**：`desktop/src/ui/components/project-manager/PreferencesPanel.jsx`

完整的偏好管理 UI：

- **偏好列表**：每行显示偏好描述、目标文件夹标签、来源标签、强度进度条、启用/禁用开关、编辑/删除按钮
- **新增/编辑表单**：偏好描述（textarea）、倾向文件夹（下拉选择）、倾向强度（range slider）、文件名包含/排除关键词、扩展名、来源路径条件
- **embedded 模式**：内嵌到 PreferencesPage 的 Tab 中

**改造文件**：`desktop/src/ui/components/project-manager/PreferencesPage.jsx`

- "软偏好" Tab 从 Mock 占位替换为 `<PreferencesPanel embedded />` 组件

### 15.6 文件变更清单

| 操作 | 文件路径 |
|------|----------|
| 新建 | `desktop/Agent/storage/preferences.js` |
| 新建 | `desktop/Agent/tools/getPreferences.js` |
| 新建 | `desktop/src/ui/components/project-manager/PreferencesPanel.jsx` |
| 改造 | `desktop/src/main/ipc/preferences.js` |
| 改造 | `desktop/src/main.js` |
| 改造 | `desktop/src/preload.js` |
| 改造 | `desktop/Agent/classifier/agent.js` |
| 改造 | `desktop/src/ui/components/project-manager/PreferencesPage.jsx` |

---

## 16. 开发记录：软偏好层（自然语言教导 + 偏好衰减）

### 16.1 自然语言教导

#### 后端：LLM 解析接口

**改造文件**：`desktop/src/main/ipc/preferences.js`

新增 `preferences/parseNaturalLanguage` IPC handler：

- 接收参数：`text`（用户自然语言描述）、`projectName`、`domain`
- 自动获取项目文件夹列表（通过 `fs.readdirSync` 读取项目目录，排除 `meta`、`temp`、`snippets` 系统目录）
- 调用 `createChatModel()`（复用现有 LLM 配置）进行解析
- 精心设计的 system prompt 指导 LLM 将自然语言解析为结构化偏好 JSON

LLM Prompt 设计要点：
- 输入：用户自然语言 + 项目可用文件夹列表
- 输出：`{ pattern, conditions, tendency }` 结构化 JSON
- 约束：folder 必须是项目中已存在的文件夹
- strength 根据语气推断："一定/肯定"→0.9，"通常/一般"→0.7，"可能/也许"→0.5
- conditions 只填用户明确提到的条件，未提到的留空数组

返回结果校验：
- 从 LLM 原始输出中提取 JSON（正则匹配 `{...}`）
- 验证 folder 存在于项目文件夹列表中
- 归一化 strength 到 0.1~1.0 范围
- 归一化 conditions 各字段为数组

**改造文件**：`desktop/src/preload.js`

- `preferences` 对象新增 `parseNaturalLanguage(projectName, text, opts)` 方法

#### 前端：自然语言输入 + 预览确认

**改造文件**：`desktop/src/ui/components/project-manager/PreferencesPanel.jsx`

新增自然语言教导流程：

1. **输入区域**：偏好列表上方新增 textarea + "AI 解析"按钮
   - 支持 Ctrl+Enter / Cmd+Enter 快捷键触发解析
   - 解析中按钮显示 loading 动画（Loader2 旋转图标）
   - 解析失败显示红色错误提示

2. **预览卡片**（`NLPreviewCard` 组件）：解析成功后展示
   - 展示 pattern（偏好描述）、folder（目标文件夹）、strength（强度）、conditions（条件汇总）
   - 三个操作按钮：
     - **确认添加**：直接调用 `preferences/add`，source 标记为 `natural_language`
     - **编辑后添加**：将解析结果填充到手动表单中，用户可二次编辑后保存
     - **取消**：放弃本次解析结果

3. **底部按钮**：原"添加偏好"改为"手动添加"，与上方的"AI 解析"形成两种添加入口

### 16.2 偏好衰减

#### 触发条件

当用户拒绝一条分类建议时，检查是否有软偏好"参与"了这次错误建议：

1. 从被拒绝的 suggestion 中获取 `fileName`、`ext`、`sourceDir`（从 temp-source-record 查）、`suggestedFolderRelPath`
2. 调用 `matchPreferences(projectDir, { fileName, ext, sourceDir })` 查找匹配偏好
3. 筛选出 `tendency.folder === suggestedFolderRelPath` 的偏好（指向同一错误方向的偏好）
4. 对这些偏好执行衰减

#### 实现

**改造文件**：`desktop/src/main/ipc/aiStorage.js`

新增 `decayPreferencesOnReject(projectDir, suggestion)` 函数：

- 导入 `matchPreferences` 和 `updatePreference`
- 衰减参数：每次 `-0.1`（`DECAY_STEP`），最低 `0.1`（`DECAY_FLOOR`）
- 同时更新 `evidence.rejected` 计数 +1 和 `evidence.lastSeenAt` 时间戳
- 在 `aiStorage/reject` 和 `aiStorage/rejectAll` handler 中，写入 `classify.rejected` 事件之后触发
- 整体包裹在 try-catch 中，确保衰减失败不影响核心 reject 流程

衰减逻辑伪代码：
```
for each matched preference where tendency.folder === suggestedFolder:
    strength = max(0.1, strength - 0.1)
    evidence.rejected += 1
    evidence.lastSeenAt = now
    updatePreference(projectDir, prefId, { tendency, evidence })
```

### 16.3 文件变更清单

| 操作 | 文件路径 |
|------|----------|
| 改造 | `desktop/src/main/ipc/preferences.js` — 新增 parseNaturalLanguage handler |
| 改造 | `desktop/src/main/ipc/aiStorage.js` — reject/rejectAll 增加衰减逻辑 |
| 改造 | `desktop/src/preload.js` — 暴露 parseNaturalLanguage |
| 改造 | `desktop/src/ui/components/project-manager/PreferencesPanel.jsx` — NL 输入 + 预览 UI |

# IPM Agent 开发全景

> 本文档是 IPM 项目 Agent 体系的高级概览与代码索引。目标是让 AI 助手或新工程师在 5 分钟内理解全貌，并知道每个功能在哪里找到。

## 1. 项目定位

IPM（Intelligent Project Manager）是一个 Electron 桌面应用，面向法律从业者的文件与知识管理。技术栈：Electron + Vite + React（前端）、Node.js + better-sqlite3 + LangChain/LangGraph（后端 Agent）。

核心价值：**让用户尽可能少地把时间花在管理文件上**。Agent 是活的助理，不是冰冷的工具。

---

## 2. 三级 Agent 架构

```
Level 2: Supervisor / KnowClaw   — 全局主管，跨项目感知+委托
            ↓ 委托
Level 1: 项目专员 Agent            — 有状态对话式助理，21 个工具（读+写+教导+委托）
            ↓ 可调用
Level 0: 分类 Agent               — 后台静默工作者，6 个只读工具，专注分类
            ↑ 也可被文件上传事件直接触发
```

两条独立触发路径：
- **事件路径**（后台静默）：文件上传 → 分类 Agent → DB suggestions → 幽灵文件
- **对话路径**（前台交互）：用户对话 → Supervisor/专员 → 调用分类 Agent 的能力

---

## 3. Level 0：分类 Agent

**职责**：对上传到 temp/ 的文件自动分类，决定应归入哪个文件夹。

### 3.1 瀑布流程

```
文件进入 temp/ → 快速通道 Pre-check（无 LLM）→ 未命中 → Tool-Calling Agent（LLM）→ 护栏校验 → 写入 DB
```

### 3.2 快速通道（`classifier/fastPath.js`）

- **用户硬规则优先**：从 `classify-rules.json` 读取用户手动配置的规则，按 priority 降序匹配
- **内置默认规则**：17 条律师场景规则（合同→收到资料、会议纪要→过程文档 等）
- 命中则 `classifiedBy: 'fast-path'` 或 `'fast-path-user-rule'`，零 LLM 调用

### 3.3 Tool-Calling Agent（`classifier/agent.js`）

- 使用 `createReactAgent`（LangGraph），`recursionLimit: 15`
- 6 个只读工具：`browse_project_structure`, `query_classification_history`, `inspect_folder_contents`, `get_file_source_info`, `get_user_rules`, `get_preferences`
- Prompt 版本：`v6-feedback-aware`（`prompts/systemPrompt.js`），强制前 3 个工具必调，证据优先级体系（userFeedback 最高）
- 输出经 Zod 校验 + 候选列表硬校验 + 15 秒超时

### 3.4 推理链路（Trace）

- `extractFullTrace()` 捕获完整推理链（tool-call / tool-result / reasoning / fast-path）
- Trace 存入 DB `suggestions.trace` 字段
- 前端 `ClassifyTraceView.jsx` 以垂直时间线可视化展示

### 3.5 关键代码位置

| 模块 | 路径 |
|------|------|
| 统一入口 | `Agent/classifier/index.js` → `classifyFile()` |
| 快速通道 | `Agent/classifier/fastPath.js` |
| Agent | `Agent/classifier/agent.js` → `runClassifyAgent()` |
| Prompt | `Agent/prompts/systemPrompt.js` |
| 护栏 | `Agent/guardrails/validator.js` |
| 分类结果存储 | `Agent/db/suggestions.js` |
| 6 个 Tools | `Agent/tools/browseStructure.js`, `queryHistory.js`, `inspectFolder.js`, `getSourceInfo.js`, `getUserRules.js`, `getPreferences.js` |

---

## 4. Level 1：项目专员 Agent

**职责**：每个项目/案件的有状态对话式文件管理助理，可读可写可教导。

### 4.1 核心架构

- 工厂函数 `createProjectAgent()` 组装 21 个 Tools + System Prompt + MemorySaver
- 使用 LangGraph `createReactAgent` + `MemorySaver` checkpointer + `interrupt()` 确认机制
- `recursionLimit: 30`，支持多步骤链式写操作

### 4.2 工具全景（21 个）

**读操作（10 个，直接执行）**：

| 工具 | 文件 | 功能 |
|------|------|------|
| browse_project_structure | `tools/browseStructure.js` | 文件夹结构+描述+文件数 |
| inspect_folder_contents | `tools/inspectFolder.js` | 文件夹内文件列表 |
| get_file_source_info | `tools/getSourceInfo.js` | 文件原始来源路径 |
| query_classification_history | `tools/queryHistory.js` | 分类事件历史（含 userFeedback） |
| get_user_rules | `tools/getUserRules.js` | 用户硬规则列表 |
| get_preferences | `tools/getPreferences.js` | 匹配的软偏好 |
| get_project_stats | `tools/getProjectStats.js` | 项目统计（文件数/大小/pending 数） |
| get_recent_events | `tools/getRecentEvents.js` | 近期分类事件+操作日志 |
| search_files | `tools/searchFiles.js` | 按关键词/扩展名搜索文件 |
| read_own_memory | `tools/readOwnMemory.js` | 读取 project-summary.md |

**写操作（5 个，interrupt 暂停等待确认）**：

| 工具 | 文件 | 功能 |
|------|------|------|
| move_files | `tools/moveFiles.js` | 移动文件（支持批量） |
| rename_file | `tools/renameFile.js` | 重命名文件 |
| create_folder | `tools/createFolder.js` | 创建文件夹+描述 |
| update_folder_description | `tools/updateFolderDescription.js` | 更新文件夹描述 |
| undo_last_action | `tools/undoLastAction.js` | 撤销上一次写操作 |

**教导工具（4 个，直接执行）**：

| 工具 | 文件 | 功能 |
|------|------|------|
| add_classify_rule | `tools/addClassifyRule.js` | 添加硬规则 |
| add_preference | `tools/addPreference.js` | 添加软偏好 |
| list_classify_events | `tools/listClassifyEvents.js` | 查询分类事件 |
| add_event_feedback | `tools/addEventFeedback.js` | 为拒绝事件补填反馈 |

**超级工具（2 个，委托分类 Agent）**：

| 工具 | 文件 | 功能 |
|------|------|------|
| classify_file | `tools/classifyFileDelegate.js` | 单文件分类 |
| classify_batch | `tools/classifyBatchDelegate.js` | 批量分类 |

### 4.3 写操作流程（Plan → Confirm → Execute）

```
用户指令 → Agent 调用写工具 → 工具内构建 plan → interrupt(plan) 暂停
→ 前端展示 ActionPlanCard（checkbox + 确认/取消）
→ 用户确认 → Command({ resume }) 恢复 → 工具内执行 fs 操作 → 返回结果给 Agent
→ Agent 可继续调用下一个写工具（多步骤链式执行）
```

关键设计：**谁暂停，谁执行** — 文件操作在 `interrupt()` 返回后、工具函数内部执行，避免重执行 bug。

### 4.4 Session 管理（`project-agent/session.js`）

`ProjectAgentSession` 类管理单个项目的对话生命周期：

- **startSession()**：初始化 Agent，首次接触项目时 `performFirstEncounter` 生成认知摘要
- **sendMessage(text)**：流式调用 Agent（`streamEvents v2`），逐 token 推送
- **resumeAfterApproval(result)**：`Command({ resume })` 恢复被 interrupt 的图
- **endSession()**：生成对话摘要，更新 project-summary.md
- **resumeHistoricalSession(sessionId)**：加载历史对话的 summary + 最近消息，注入新 Agent 上下文
- **Token 压缩**：当 `estimateTokens() > 3000` 时触发滚动式摘要压缩，廉价小模型做摘要

### 4.5 记忆系统（`project-agent/memory.js`）

- `project-summary.md`：项目认知摘要，首次由 LLM 扫描文件夹结构生成
- `conversations` 表：历史对话摘要
- `chat_sessions` / `chat_messages` 表：完整对话持久化

### 4.6 关键代码位置

| 模块 | 路径 |
|------|------|
| 工厂函数 | `Agent/project-agent/createProjectAgent.js` |
| Session | `Agent/project-agent/session.js` |
| Prompt | `Agent/project-agent/prompts.js`（`v5-teaching`） |
| 记忆 | `Agent/project-agent/memory.js` |
| 撤销执行器 | `Agent/project-agent/undoExecutor.js` |
| IPC | `src/main/ipc/projectAgent.js` |
| Chat UI | `src/ui/components/agent-chat/` （全部） |
| Chat Hook | `src/ui/components/agent-chat/hooks/useAgentChat.js` |

---

## 5. Level 2：Supervisor / KnowClaw

**职责**：全局文件管理主管，跨项目感知、路由、委托、主动通知。

### 5.1 核心能力

- 跨项目查看状态和统计
- 委托任务给项目专员（安全模式需用户确认 / 自治模式自动批准）
- 主动检测问题（temp 积压、过期建议）并推送通知
- 独立的对话界面（KnowClaw 页面）+ 全局悬浮通知球（SupervisorBubble）

### 5.2 工具全景

**全局感知（3 个）**：

| 工具 | 文件 | 功能 |
|------|------|------|
| list_projects | `supervisor/tools/listProjects.js` | 列出所有项目/案件/学习空间 |
| cross_project_stats | `supervisor/tools/crossProjectStats.js` | 跨项目汇总统计 |
| proactive_check | `supervisor/tools/proactiveCheck.js` | 主动检查各项目问题 |

**委托执行（1 个）**：

| 工具 | 文件 | 功能 |
|------|------|------|
| delegate_to_agent | `supervisor/tools/delegateToAgent.js` | 委托任务给项目专员，支持安全/自治双模式 |

**直接读操作（6 个，封装项目级工具）**：

| 工具 | 文件 |
|------|------|
| supervisor_browse_structure / supervisor_inspect_folder / supervisor_get_project_stats / supervisor_search_files / supervisor_get_recent_events / supervisor_query_history | `supervisor/tools/projectReadTools.js` |

### 5.3 委托机制

```
Supervisor 调用 delegate_to_agent(projectName, domain, task)
    → 创建/获取项目专员 Session
    → 调用专员 sendMessage(task)
    → 如果专员返回 interrupt（写操作确认）：
        安全模式 → Supervisor 也 interrupt，用户在 KnowClaw 界面确认
        自治模式 → 自动 approve，执行后返回结果
```

### 5.4 主动感知（`supervisor/proactiveChecker.js`）

- `main.js` 中每 30 分钟定时执行 `runProactiveCheck()`
- 检查维度：temp 文件积压（>5）、pending 建议积压（>5）、过期建议（>3 天）
- 发现新问题写入 `notifications` 表，去重机制避免重复通知
- 前端 `SupervisorBubble` 定期轮询展示未读数

### 5.5 关键代码位置

| 模块 | 路径 |
|------|------|
| Agent 工厂 | `Agent/supervisor/createSupervisorAgent.js` |
| Session | `Agent/supervisor/session.js` |
| Prompt | `Agent/supervisor/prompts.js`（`v1-knowclaw`） |
| 项目注册表 | `Agent/supervisor/projectRegistry.js` |
| 主动检查 | `Agent/supervisor/proactiveChecker.js` |
| Supervisor DB | `Agent/db/supervisorDb.js` |
| IPC | `src/main/ipc/supervisor.js` |
| KnowClaw 页面 | `src/ui/components/knowclaw/KnowClawPage.jsx` |
| KnowClaw Hook | `src/ui/components/knowclaw/useKnowClawChat.js` |
| 悬浮通知球 | `src/ui/components/SupervisorBubble.jsx` |
| 通知 Hook | `src/ui/hooks/useSupervisorNotifications.js` |

---

## 6. 三层分类学习体系（Skill 系统）

Agent 的学习能力不靠 RLHF，而靠三层结构化记忆 + 用户反馈闭环：

### 6.1 硬规则层

- **存储**：`{projectDir}/meta/classify-rules.json`
- **定义**：用户显式配置的确定性规则，命中后直接走快速通道
- **条件**：文件名包含/排除、扩展名、来源路径包含/排除
- **模块**：`Agent/storage/classifyRules.js`（CRUD）
- **UI**：`PreferencesPage.jsx` → 硬规则 Tab → `ClassifyRulesPanel.jsx`

### 6.2 软偏好层

- **存储**：`{projectDir}/meta/preferences.json`
- **定义**：概率性分类倾向，带 strength（0.1-1.0）
- **特性**：支持自然语言教导（LLM 解析）、偏好衰减（reject 时 -0.1）
- **模块**：`Agent/storage/preferences.js`（CRUD + 匹配 + 衰减）
- **Agent 集成**：`Agent/tools/getPreferences.js`（分类 Agent 可查询匹配偏好）
- **UI**：`PreferencesPage.jsx` → 软偏好 Tab → `PreferencesPanel.jsx`（含 NL 输入框）
- **衰减触发**：`src/main/ipc/aiStorage.js` → `decayPreferencesOnReject()`

### 6.3 原始事件层

- **存储**：SQLite `events` 表（只增不删）
- **事件类型**：`classify.accepted` / `classify.rejected`
- **含用户反馈**：reject 时可附带 `userFeedback`（通过 RejectPopover 弹窗）
- **模块**：`Agent/db/events.js`（写入/查询/更新反馈）
- **UI**：`PreferencesPage.jsx` → 原始事件 Tab → `ClassifyEventsTab.jsx`（时间线+搜索+详略模式）

### 6.4 学习闭环

```
用户 accept/reject → 写入 events 表 → 分类 Agent 下次通过 query_history 查询
                   → reject 时触发软偏好衰减
                   → 用户可在对话中教导 Agent 添加硬规则/软偏好
```

---

## 7. 数据存储

### 7.1 项目级 SQLite（`{projectDir}/meta/project.db`）

| 表 | 用途 | 关键模块 |
|----|------|----------|
| `suggestions` | AI 分类建议（pending/accepted/rejected） | `Agent/db/suggestions.js` |
| `source_records` | 文件原始来源路径映射 | `Agent/db/sourceRecords.js` |
| `events` | 分类事件流（accept/reject + userFeedback） | `Agent/db/events.js` |
| `activity_log` | 操作日志（含 undo 信息） | `Agent/db/activityLog.js` |
| `chat_sessions` | 项目专员对话会话索引 | `Agent/db/chatSessions.js` |
| `chat_messages` | 项目专员对话逐条消息 | `Agent/db/chatMessages.js` |
| `conversations` | 对话摘要（用于上下文恢复） | `Agent/db/conversations.js` |

- 管理：`Agent/db/index.js` → `getProjectDb()`（缓存 + 自动迁移）
- Schema：`Agent/db/init.js`（v1 基础表 + v2 chat 表）
- 旧数据迁移：`Agent/db/migrate.js`（JSON/JSONL → SQLite）

### 7.2 Supervisor 级 SQLite（`userfile/_app/meta/supervisor.db`）

| 表 | 用途 |
|----|------|
| `chat_sessions` / `chat_messages` | Supervisor 对话持久化 |
| `conversations` | Supervisor 对话摘要 |
| `activity_log` | Supervisor 操作日志 |
| `notifications` | 主动感知通知（type/title/content/is_read） |

- 管理：`Agent/db/supervisorDb.js` → `getSupervisorDb()`

### 7.3 JSON/MD 文件（静态配置，保持 JSON）

| 文件 | 位置 | 用途 |
|------|------|------|
| `classify-rules.json` | `{projectDir}/meta/` | 用户硬规则 |
| `preferences.json` | `{projectDir}/meta/` | 软偏好 |
| `structure.json` | `{projectDir}/meta/` | 文件夹结构描述 |
| `project-summary.md` | `{projectDir}/meta/agent/` | 项目专员认知摘要 |

---

## 8. IPC 通道与 Preload API

### 8.1 项目专员 IPC（`src/main/ipc/projectAgent.js`）

Preload namespace: `window.ipm.agent`

| 通道 | 功能 |
|------|------|
| `projectAgent/sendMessage` | 发起对话（流式推送） |
| `projectAgent/executePlan` | 确认执行写操作计划 |
| `projectAgent/cancelPlan` | 取消操作计划 |
| `projectAgent/endSession` | 结束会话 |
| `projectAgent/getSessionInfo` | 查询会话状态 |
| `projectAgent/resumeSession` | 恢复历史会话 |
| `projectAgent/listSessions` | 列出历史会话 |
| `projectAgent/loadSession` | 加载历史消息 |
| `projectAgent/deleteSession` | 删除会话 |
| `projectAgent/undoAction` | 撤销操作 |

流式事件通道：`projectAgent:stream-event`（token / tool-start / tool-end / interrupt / done / error）

### 8.2 Supervisor IPC（`src/main/ipc/supervisor.js`）

Preload namespace: `window.ipm.supervisor`

| 通道 | 功能 |
|------|------|
| `supervisor/sendMessage` | 发起对话 |
| `supervisor/executePlan` | 确认委托计划 |
| `supervisor/cancelPlan` | 取消计划 |
| `supervisor/endSession` | 结束会话 |
| `supervisor/setAutonomousMode` | 切换安全/自治模式 |
| `supervisor/getNotifications` | 获取通知列表 |
| `supervisor/markNotificationRead` | 标记通知已读 |
| `supervisor/listSessions` / `loadSession` / `deleteSession` / `resumeSession` | 会话管理 |

流式事件通道：`supervisor:stream-event`

### 8.3 分类相关 IPC

| 通道 | Preload | 功能 |
|------|---------|------|
| `classify:getSnapshot` | `window.ipm.classify.getSnapshot` | 拉取分类流水线快照 |
| `classify:clearCompleted` | `window.ipm.classify.clearCompleted` | 清除已完成项 |
| `classify:status-changed` | `window.ipm.classify.onStatusChanged` | 分类状态变更事件 |
| `aiStorage/getTrace` | `window.ipm.aiStorage.getTrace` | 获取分类推理链路 |
| `classifyRules/*` | `window.ipm.classifyRules.*` | 硬规则 CRUD |
| `classifyEvents/*` | `window.ipm.classifyEvents.*` | 分类事件查询/反馈 |
| `preferences/*` | `window.ipm.preferences.*` | 软偏好 CRUD + NL 解析 |

---

## 9. 前端 UI 组件

### 9.1 项目专员对话（`src/ui/components/agent-chat/`）

| 组件 | 功能 |
|------|------|
| `ChatPanel.jsx` | 覆盖式大面板（75% 宽度），从 RootTable 项目行入口打开 |
| `MessageList.jsx` | 消息列表，空状态引导+示例提示 |
| `MessageBubble.jsx` | 消息气泡（含工具卡片、撤销按钮、Markdown 渲染） |
| `ActionPlanCard.jsx` | 写操作确认卡片（checkbox + 确认/取消 + 结果） |
| `ChatInput.jsx` | 输入框（auto-resize + Enter 发送） |
| `HistoryDropdown.jsx` | 历史对话下拉（按日期分组，支持续聊） |
| `hooks/useAgentChat.js` | 状态管理 Hook（消息/流式/plan/session） |

### 9.2 KnowClaw 页面（`src/ui/components/knowclaw/`）

| 组件 | 功能 |
|------|------|
| `KnowClawPage.jsx` | Supervisor 专属对话页面（侧边栏入口），含自治模式开关+历史面板 |
| `useKnowClawChat.js` | Supervisor 对话状态 Hook |

### 9.3 Supervisor 悬浮球

| 组件 | 功能 |
|------|------|
| `SupervisorBubble.jsx` | 全局悬浮球（通知 badge + 展开面板：通知列表+快速入口） |
| `hooks/useSupervisorNotifications.js` | 通知状态 Hook（轮询+标记已读） |

### 9.4 分类增强 UI（`src/ui/components/project-manager/`）

| 组件 | 功能 |
|------|------|
| `ClassifyPipeline.jsx` | 实时分类流水线面板（待分类→正在分类→已分类三列） |
| `ClassifyTraceView.jsx` | AI 推理链路时间线弹窗（工具调用+推理+结论） |
| `ClassifyRulesPanel.jsx` | 硬规则管理面板 |
| `PreferencesPanel.jsx` | 软偏好管理面板（含自然语言教导） |
| `ClassifyEventsTab.jsx` | 原始事件时间线 |
| `PreferencesPage.jsx` | 偏好与记录页面（硬规则/软偏好/原始事件 三 Tab） |
| `RejectPopover.jsx` | 拒绝反馈弹窗 |
| `hooks/useClassifyPipeline.js` | 流水线状态 Hook |
| `hooks/useTraceView.js` | 推理链路弹窗 Hook |

### 9.5 导航集成

| 文件 | 集成点 |
|------|--------|
| `src/ui/App.jsx` | 路由分发（knowclaw 页面）+ SupervisorBubble 全局挂载 |
| `src/ui/components/Sidebar.jsx` | KnowClaw 侧边栏入口 |
| `src/ui/components/project-manager/RootTable.jsx` | 项目行"AI 助理"按钮 + "偏好与记录"按钮 |
| `src/ui/components/project-manager/ProjectManager.jsx` | 集成 ChatPanel + PreferencesPage + 流水线 + Trace |

---

## 10. LLM 服务配置

| 文件 | 内容 |
|------|------|
| `Agent/services/llm.js` | `createChatModel()` 主模型、`createSummaryModel()` 摘要模型 |
| `Agent/.env` | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_SUMMARY_MODEL` |

---

## 11. 完整文件目录树

```
desktop/Agent/
├── index.js                          # 统一导出
├── services/llm.js                   # LLM 配置
│
├── classifier/                       # Level 0: 分类 Agent
│   ├── index.js                     #   统一入口 classifyFile()
│   ├── fastPath.js                  #   快速通道（规则+用户规则）
│   └── agent.js                     #   LangGraph Tool-Calling Agent
│
├── project-agent/                    # Level 1: 项目专员
│   ├── createProjectAgent.js        #   工厂函数（组装 21 Tools）
│   ├── session.js                   #   ProjectAgentSession（对话+流式+压缩）
│   ├── prompts.js                   #   身份定义+写操作规则
│   ├── memory.js                    #   认知摘要（project-summary.md）
│   ├── planExecutor.js              #   历史遗留（执行逻辑已移入工具内部）
│   └── undoExecutor.js              #   撤销执行器（4 种操作反向执行）
│
├── supervisor/                       # Level 2: Supervisor / KnowClaw
│   ├── createSupervisorAgent.js     #   工厂函数
│   ├── session.js                   #   SupervisorSession
│   ├── prompts.js                   #   KnowClaw 身份+委托规则
│   ├── projectRegistry.js           #   项目注册表（缓存 5min）
│   ├── proactiveChecker.js          #   主动感知检查器
│   └── tools/                       #   Supervisor 专属工具
│       ├── listProjects.js          #     列出所有项目
│       ├── crossProjectStats.js     #     跨项目统计
│       ├── proactiveCheck.js        #     主动检查问题
│       ├── delegateToAgent.js       #     委托给项目专员
│       └── projectReadTools.js      #     6 个封装的读操作
│
├── tools/                            # 共享工具库（Level 0+1 使用）
│   ├── browseStructure.js           # 读: 文件夹结构
│   ├── inspectFolder.js             # 读: 文件夹内容
│   ├── getSourceInfo.js             # 读: 文件来源
│   ├── queryHistory.js              # 读: 分类历史
│   ├── getUserRules.js              # 读: 用户规则
│   ├── getPreferences.js            # 读: 软偏好
│   ├── getProjectStats.js           # 读: 项目统计
│   ├── getRecentEvents.js           # 读: 近期事件
│   ├── searchFiles.js               # 读: 搜索文件
│   ├── readOwnMemory.js             # 读: 认知摘要
│   ├── moveFiles.js                 # 写: 移动文件
│   ├── renameFile.js                # 写: 重命名
│   ├── createFolder.js              # 写: 创建文件夹
│   ├── updateFolderDescription.js   # 写: 更新描述
│   ├── undoLastAction.js            # 写: 撤销
│   ├── addClassifyRule.js           # 教导: 添加硬规则
│   ├── addPreference.js             # 教导: 添加软偏好
│   ├── listClassifyEvents.js        # 教导: 查询事件
│   ├── addEventFeedback.js          # 教导: 补填反馈
│   ├── classifyFileDelegate.js      # 超级: 单文件分类
│   └── classifyBatchDelegate.js     # 超级: 批量分类
│
├── db/                               # 数据库层
│   ├── init.js                      #   Schema 定义+迁移
│   ├── index.js                     #   实例管理 getProjectDb()
│   ├── migrate.js                   #   JSON→SQLite 迁移
│   ├── suggestions.js               #   suggestions 表
│   ├── sourceRecords.js             #   source_records 表
│   ├── events.js                    #   events 表
│   ├── activityLog.js               #   activity_log 表
│   ├── chatSessions.js              #   chat_sessions 表
│   ├── chatMessages.js              #   chat_messages 表
│   ├── conversations.js             #   conversations 表
│   └── supervisorDb.js              #   Supervisor 独立 DB
│
├── storage/                          # JSON 配置存储
│   ├── aiStorage.js                 #   ai-storage 兼容层（委托 DB）
│   ├── SuggestionStore.js           #   Repository 抽象
│   ├── classifyRules.js             #   硬规则 CRUD
│   ├── classifyEvents.js            #   事件存储（委托 DB）
│   └── preferences.js               #   软偏好 CRUD+匹配+衰减
│
├── prompts/                          # 分类 Agent Prompt
│   ├── systemPrompt.js              #   v6-feedback-aware
│   └── classifyFilePrompt.js        #   旧版（deprecated）
│
├── schemas/                          # Zod 校验
│   ├── input.js                     #   分类输入
│   ├── output.js                    #   分类输出
│   └── classifyFileSchema.js        #   旧版（deprecated）
│
└── guardrails/
    └── validator.js                  #   输出校验+超时

desktop/src/
├── main.js                           # 应用入口（Agent 集成+流水线追踪）
├── preload.js                        # Preload API（agent/supervisor/classify）
├── main/
│   ├── classifyTracker.js           # 分类流水线状态追踪器
│   └── ipc/
│       ├── projectAgent.js          # 项目专员 IPC
│       ├── supervisor.js            # Supervisor IPC
│       ├── aiStorage.js             # 暂存区 IPC（含偏好衰减）
│       ├── classifyRules.js         # 硬规则 IPC
│       ├── classifyEvents.js        # 事件 IPC
│       └── preferences.js           # 软偏好 IPC（含 NL 解析）
└── ui/components/
    ├── agent-chat/                   # 项目专员 Chat UI
    ├── knowclaw/                     # Supervisor KnowClaw UI
    ├── SupervisorBubble.jsx          # 全局悬浮通知球
    ├── Sidebar.jsx                   # 导航栏（含 KnowClaw 入口）
    ├── App.jsx                       # 路由+SupervisorBubble 挂载
    └── project-manager/              # 分类增强 UI
        ├── ClassifyPipeline.jsx     #   流水线面板
        ├── ClassifyTraceView.jsx    #   推理链路
        ├── ClassifyRulesPanel.jsx   #   硬规则管理
        ├── PreferencesPanel.jsx     #   软偏好管理
        ├── ClassifyEventsTab.jsx    #   原始事件
        ├── PreferencesPage.jsx      #   偏好页面
        └── RejectPopover.jsx        #   拒绝反馈
```

---

## 12. 未完成/待开发

| 功能 | 状态 | 说明 |
|------|------|------|
| Supervisor 集成测试 | 待验证 | KnowClaw 全部代码已写完，尚未实际运行 |
| Pattern Aggregator | 未开发 | 高置信度模式自动提升为快速通道规则（暂缓） |
| 偏好自动提炼 | 未开发 | 从原始事件自动生成软偏好（`source: auto_learned`） |
| 偏好提升为硬规则 | 未开发 | evidence 足够强时建议升级 |
| Supervisor Skills 创建 | 远期 | Supervisor 观察重复模式，自动生成工作流 Skill |
| 通用脚本执行器 | 远期 | `run_script` 万能适配器+沙箱 |

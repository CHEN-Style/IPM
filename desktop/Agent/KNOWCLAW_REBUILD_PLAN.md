# KnowClaw 颠覆性迭代总开发计划

> **目标**：将 IPM 的 KnowClaw 从基于 LangGraph 的轻量 ReAct 实现，重构为以 `@earendil-works/pi-coding-agent` 为运行时核心、能力接近 Claude Code 的桌面 Agent。
>
> **路径选择**：路径 A —— 嵌入 pi-coding-agent，把 IPM 业务逻辑做成 customTools / extensions / skills 桥。已在前置讨论中评审通过。
>
> **本文档约束**：所有阶段切分按"AI 单轮上下文容量"设计，每一轮任务量可在不爆炸、不丢逻辑的前提下完成。任何后续会话只需先读本文件，即可知道当前进度与下一轮要做什么。

---

## 0. 阅读与维护说明

- **读者**：AI 开发者（每轮开发前必读本文件相关阶段段落）；项目所有者（决策门、验收口径）。
- **状态字段**：每个阶段开头有 `Status:` 字段（`PENDING / IN_PROGRESS / DONE / BLOCKED`），完成一轮后由 AI 更新。
- **变更纪律**：本计划本身可以调整，但调整必须显式记录在每个阶段下的 `变更日志` 小节，避免计划漂移。
- **超纲处理**：开发过程中若发现某阶段实际超出上下文预算，**立刻停止本轮开发**，把剩余拆成新的子阶段写入本文档下一个版本，再发起新一轮。

---

## 1. 总体战略概览

### 1.1 终态画像（成功长什么样）

完工后，KnowClaw 应具备以下可观测能力：

1. 用户在 IPM 聊天面板里发自然语言指令，模型自主使用 `read / write / edit / bash / grep / find / ls` 与 IPM 业务工具完成任务。
2. 模型在主上下文里**直接加载 SKILL.md**，按 skill 指令操作工具，不再隔离到子 agent。
3. 长对话自动 compaction，会话以 JSONL 持久化，支持分支 / fork / continue。
4. 支持订阅授权（Claude Pro / ChatGPT Plus）或 API Key，可在 UI 切换模型与思考等级。
5. "主管 → 项目专员"通过 pi-fast-subagent 实现同进程子会话委托。
6. 旧 LangGraph 实现完全下线，依赖清理。

### 1.2 模块边界

新代码统一落到 **`desktop/Agent/pi-runtime/`**。旧代码（`desktop/Agent/supervisor/`、`desktop/Agent/project-agent/`）在 Phase 12 才删除，期间双轨共存。

```
desktop/Agent/pi-runtime/
├─ index.js              # 对外唯一入口：createKnowClawSession / shutdown
├─ bootstrap.js          # 启动序列：装配 services / loader / session
├─ auth.js               # AuthStorage 包装：读 IPM .env / preferences
├─ models.js             # ModelRegistry 包装：模型清单与默认
├─ sessionFactory.js     # SessionManager 工厂：new / continueRecent / open
├─ resourceLoader.js     # DefaultResourceLoader 包装与 override
├─ promptBuilder.js      # systemPromptOverride 生成器
├─ skillProvider.js      # skillsOverride：读 skills-library 目录
├─ delegation.js         # 项目专员委托：pi-fast-subagent 集成
├─ tools/
│  ├─ projectTools.js    # list_projects / cross_project_stats / proactive_check ...
│  ├─ fileTools.js       # 业务文件操作（区别于 pi 内置 read/write）
│  ├─ scriptTool.js      # run_script
│  ├─ webTool.js         # fetch_web
│  └─ delegateTool.js    # delegate_to_agent（基于 delegation.js）
└─ README.md             # 架构说明，开发者文档
```

```
desktop/Agent/skills-library/             # 新 skill 仓库（Phase 8 建立）
├─ create-case/SKILL.md
├─ archive-snippet/SKILL.md
└─ ...
```

```
desktop/src/main/ipc/knowclaw.js          # 新 IPC（Phase 3 建立，与旧 supervisor.js 并存到 Phase 11）
desktop/src/ui/components/KnowClawV2/     # 新 UI 子系统（Phase 4 建立）
```

### 1.3 阶段一览（13 轮）

| #  | 阶段                          | 主要交付物                                   | 单轮预估代码量 |
|----|-------------------------------|----------------------------------------------|----------------|
| P0 | 基础设施与最小 PoC            | `pi-runtime/index.js` + 依赖装配             | ~200 行        |
| P1 | 凭证与模型桥                  | `auth.js`、`models.js`                       | ~250 行        |
| P2 | 会话存储与 SessionManager     | `sessionFactory.js`                          | ~200 行        |
| P3 | 主进程 → 渲染进程事件桥       | `ipc/knowclaw.js`、preload 增量              | ~300 行        |
| P4 | 最小 Chat UI（v2 独立面板）   | `KnowClawV2/` 3~4 组件                       | ~500 行        |
| P5 | customTools 第 1 批：项目只读 | `tools/projectTools.js`                      | ~400 行        |
| P6 | customTools 第 2 批：文件/脚本/网络 | `tools/fileTools.js`、`scriptTool.js`、`webTool.js` | ~500 行  |
| P7 | 系统提示词与 ResourceLoader   | `resourceLoader.js`、`promptBuilder.js`      | ~350 行        |
| P8 | Skill 系统迁移                | `skills-library/`、`skillProvider.js`        | ~400 行（可拆 2 轮） |
| P9 | 项目专员委托（多 agent）      | `delegation.js`、`tools/delegateTool.js`     | ~400 行        |
| P10 | 历史会话 UI（列表 / 恢复 / 分支） | `KnowClawV2/Sessions*.jsx`、IPC 扩展        | ~500 行        |
| P11 | 双轨切换开关与默认引擎切流    | 设置面板修改、IPC 路由                       | ~250 行        |
| P12 | 旧实现下线与依赖清理          | 删除文件 + `package.json`                    | 净减少         |
| P13 | 验收文档                      | `pi-runtime/README.md` 等                    | 纯文档         |

---

## 2. 阶段切分原则（为什么是 13 轮）

每一轮必须同时满足以下 4 个硬约束。**违反任何一条都要拆分。**

1. **读取上限**：单轮我需要读懂的项目内文件 ≤ 8 个；总行数 ≤ 3000。
2. **写入上限**：单轮写/改文件 ≤ 5 个；新代码 ≤ 600 行；改动 ≤ 400 行。
3. **抽象层级**：单轮核心抽象 ≤ 2 个（例如"事件桥"+"消息序列化"算 2 个；再加"权限策略"就超标）。
4. **可独立验证**：每轮结束必须有一个**人能跑 5 分钟内看到的产物**——主进程 console、devtools 输出、新面板可点击、新工具能被 LLM 调用之一。

软约束（违反则提示但不强拆）：

- 单轮新引入的 npm 依赖 ≤ 2 个
- 单轮新建顶层目录 ≤ 1 个
- 单轮删除或重命名现有公开 API ≤ 0 个（重命名/废弃统一在 P11/P12 集中处理）

---

## 3. 各阶段详细计划

---

### Phase 0 — 基础设施与最小 PoC

**Status:** `DONE`

**目标**：装包 + 建目录骨架 + 在主进程跑通一次 `createAgentSession()` 并打印事件流。**不接 IPC、不接 UI**。

**前置**：无。

**工作清单**

读：
- `desktop/package.json`（了解现有依赖与脚本）
- `desktop/src/main/main.js`（找一个合适的初始化点挂钩；只读不改）

写：
- `desktop/Agent/pi-runtime/index.js` —— 暴露 `bootstrap()`、`createKnowClawSession({ cwd })`、`shutdown()` 三个函数；本阶段内部用最小实现
- `desktop/Agent/pi-runtime/bootstrap.js` —— 调 `createAgentSession()`，订阅事件，console.log 输出
- `desktop/Agent/pi-runtime/README.md` —— 占位（一段话说明目录用途）

改：
- `desktop/package.json` —— 新增 `@earendil-works/pi-coding-agent` 依赖（用 npm 装最新稳定版）

**不做**：
- 不接 IPC
- 不接 UI
- 不写 customTools
- 不接 IPM 业务

**产出物**（精确清单）：
- `desktop/Agent/pi-runtime/index.js`
- `desktop/Agent/pi-runtime/bootstrap.js`
- `desktop/Agent/pi-runtime/README.md`
- `desktop/package.json`（依赖项增量）

**验证方法**：

实际落地为环境变量驱动的两段式验证（详见 [`pi-runtime/README.md`](pi-runtime/README.md)）：

- 验证 A（零 LLM 消耗，必跑）：`KNOWCLAW_PI_POC=1 npm start` → 主进程 console 应看到 `[KnowClaw-PoC] starting… → session ready / skipped → done`，IPM 主窗口正常打开，旧 KnowClaw 不受影响。
- 验证 B（端到端，可选）：补充 `KNOWCLAW_PI_POC_PROMPT="列出当前目录下的文件"` 与 `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`，应看到完整事件流（`agent_start → turn_start → tool_execution_* → message_update → turn_end → agent_end`）。

**上下文预算**：✅ 合适。涉及 1 个新依赖、3 个新文件、1 个零侵入式钩点。

**风险与回滚**：
- 风险 R0.1：pi-coding-agent 默认导出 ESM → ✅ 现状核实 `desktop/src/main.js` 已是 ESM；触发块用动态 `import()` 仅在启用 PoC 时加载 pi。
- 风险 R0.2：模型未配置导致 `createAgentSession` 报错 → `bootstrap.js` 已先调用 `modelRegistry.getAvailable()` 探测，无可用模型时直接跳过 session 创建并返回 `skipped: true`，验证 A 仍可通过。
- 风险 R0.3：Vite 打主进程时把 pi 这个重型 ESM 包打入 bundle → 已在 `vite.main.config.mjs` 的 `external` 中追加 `@earendil-works/pi-coding-agent`，运行时直接从 `node_modules/` 加载。
- 回滚：删除 `desktop/Agent/pi-runtime/` 目录、还原 `desktop/src/main.js` 中的触发块、还原 `vite.main.config.mjs` 的 external 改动；npm 依赖保留供 P1 使用。

**变更日志**：
- 2026-05-13 完成 P0；触发方式从"硬编码自动跑"调整为 `KNOWCLAW_PI_POC` 环境变量；显式追加 Vite external；修正入口路径 `desktop/src/main/main.js` → `desktop/src/main.js`；新增 `modelRegistry.getAvailable()` 探测以让"无 key"用户也能通过验证 A。
- 2026-05-13 修复 `ERR_PACKAGE_PATH_NOT_EXPORTED`：pi 是 ESM-only 包但 Vite 默认把主进程编译为 CJS，导致 `require(pi)` 失败。解决方案：
  - 新增 `desktop/Agent/pi-runtime/package.json` 写 `{"type":"module"}`，让 Node 把该目录下 `.js` 作为 ESM 解析
  - `desktop/src/main.js` 改用 `pathToFileURL(absPath)` + `/* @vite-ignore */` 标注的动态 `import()`，迫使 Vite 不静态内联，运行时由 Node 原生 ESM loader 加载
  - 同步更新 `desktop/forge.config.js` 的 `VITE_EXTERNALS` 加入 `@earendil-works/pi-coding-agent`，保证未来打包阶段把它复制进 app（dev 模式不影响）

---

### Phase 1 — 凭证与模型桥

**Status:** `DONE`

**目标**：把 IPM 现有的 API Key / Base URL / Model 配置（`.env` 与用户 preferences）接入 pi 的 `AuthStorage` / `ModelRegistry`。

**前置**：P0 完成。

**工作清单**

读：
- `desktop/Agent/.env.example`（看现有变量名）
- `desktop/Agent/.env`（看实际命名习惯）
- `desktop/src/main/ipc/prefs.js`（看 preferences 读取方式）
- `desktop/Agent/supervisor/createSupervisorAgent.js`（看现行模型如何选择，作为兼容参考）

写：
- `desktop/Agent/pi-runtime/auth.js` —— 构造 `AuthStorage`：包装 `setRuntimeApiKey`，从 IPM 配置注入 anthropic / openai / 自定义 provider 的 key
- `desktop/Agent/pi-runtime/models.js` —— 构造 `ModelRegistry`：决定默认模型（来源优先级：用户 preferences > .env > 内置默认），暴露 `getDefaultModel()` / `listAvailable()`

改：
- `desktop/Agent/pi-runtime/bootstrap.js` —— 用上述两个模块替代 P0 的硬编码
- `desktop/Agent/pi-runtime/index.js` —— 暴露 `setModel(providerId, modelId)` / `listAvailableModels()` 供后续 IPC 使用

**不做**：
- 不接订阅授权 OAuth（Claude Pro / ChatGPT Plus）—— 留到 P13 文档时讨论是否再开一轮
- 不写 UI 切换模型组件

**产出物**：
- `desktop/Agent/pi-runtime/auth.js`
- `desktop/Agent/pi-runtime/models.js`
- `desktop/Agent/pi-runtime/bootstrap.js`（更新）
- `desktop/Agent/pi-runtime/index.js`（更新）

**验证方法**：

1. 主进程 console 调 `knowclaw.listAvailableModels()`，能看到至少一个候选模型。
2. 设 IPM 偏好为某具体 model，再 `createKnowClawSession({})`，pi 的 `agent_start` 事件里 `state.model` 与设定一致。
3. 用错 API key 时，得到 pi 的 `errorMessage` 而非崩溃。

**上下文预算**：✅ 合适。

**风险与回滚**：
- 风险 R1.1：IPM 当前确实用自定义 OpenAI-compatible base URL（`api.openai-proxy.org/v1`）→ 通过 `DefaultResourceLoader` + `extensionFactories` + `pi.registerProvider('ipm-openai', { baseUrl, api: 'openai-completions', models })` 接入；不走 `models.json` 文件（避免污染用户全局 `~/.pi/agent/`）
- 风险 R1.2：pi 内置 openai provider 仍可能因 `OPENAI_API_KEY` 在 `process.env` 中被默认命中 → `listIpmModels(...)` 显式过滤 `provider === 'ipm-openai'`，UI 侧不暴露内置 42 个模型
- 风险 R1.3：`setRuntimeApiKey` 时序要求 → bootstrap 严格按"`reload()` 先 flush provider 注册 → 再 `applyIpmRuntimeKey`"顺序执行
- 回滚：删除 `ipmConfig.js` / `auth.js` / `models.js`，`bootstrap.js` 与 `index.js` 还原到 P0 版本

**变更日志**：
- 2026-05-13 完成 P1。走"独立 provider `ipm-openai`"路线，避免 P0 看到的 42 个内置模型污染；用 `setRuntimeApiKey` 运行时注入 key，不写盘到 `~/.pi/agent/auth.json`；用 `ModelRegistry.inMemory()` 替代 `.create()` 同样避免写盘。
- 时序：`resourceLoader.reload()` 先 flush provider 注册，再 `applyIpmRuntimeKey` 注入运行时 key，规避 provider-not-yet-registered 边角问题。
- 设计微调：将 `auth.js` 拆为 `buildAuthStorage()` + `applyIpmRuntimeKey(authStorage, ipmConfig)` 两步，使时序可控；新增 `ipmConfig.js` 替代直接复用 `Agent/services/llm.js`，解耦 `@langchain/openai` 依赖。
- `index.js` 新增 `listAvailableModels()` / `setModel(providerId, modelId)` / `getCurrentModelId()` / `describeCurrentConfig()` 给 Phase 3 IPC 桥预留接口；`setModel` 当前只校验 + 缓存到模块级变量，session 替换语义留 Phase 3。
- `models.js#listIpmModels` 同时兼容 `list/all/getAll/getAvailable` 多个 pi 版本 API，并提供 `listIpmModelsAsync` 走最稳定的 `getAvailable()` 路径。
- 实现偏差：计划原定用 `extensionFactories` + `DefaultResourceLoader` 注册 provider，实测发现 pi 内部 `extensionFactory` 产出的 `registerProvider` 调用被放入 `pendingProviderRegistrations` 队列，需要 `ExtensionRunner.bindCore()`（在 AgentSession 启动内部）才 flush 到 ModelRegistry，导致在 `createAgentSession` 之前无法验证模型列表。最终改为**直接调用 `modelRegistry.registerProvider()`**，立即生效，去掉了 `DefaultResourceLoader` 依赖（P1 阶段不需要 skills/prompts/themes）。这是更正确的 programmatic integration 方式。
- 暂未做：OAuth 订阅授权（Claude Pro / ChatGPT Plus）、`reloadConfig` IPC、`thinkingLevel` / 多 provider 切换、UI 模型选择组件、IPM 偏好 schema 扩展。

---

### Phase 2 — 会话存储与 SessionManager

**Status:** `DONE`

**目标**：决定 JSONL session 文件存放位置，封装 `SessionManager` 工厂，支持 `new / continueRecent / open(path) / list`。

**前置**：P0、P1 完成。

**工作清单**

读：
- 前述 pi SDK 文档 `Session Management` 段落（外部，已在前置讨论中获取）
- `desktop/src/main/ipc/app.js`（看 userData 路径如何获取）
- `desktop/Agent/supervisor/session.js`（仅了解现有 sessionId 如何生成，作为可能的关联键；不修改）

写：
- `desktop/Agent/pi-runtime/sessionFactory.js` —— 暴露 `makeSessionManager({ mode, cwd, agentDir, sessionFile? })`，封装四种模式；统一 session 目录到 `app.getPath('userData')/knowclaw-sessions/<cwd-hash>/`

改：
- `desktop/Agent/pi-runtime/bootstrap.js` —— 默认 `mode='continueRecent'`
- `desktop/Agent/pi-runtime/index.js` —— `createKnowClawSession` 增加 `mode` 与 `sessionFile` 参数

**不做**：
- 不写 session 列表 UI（P10 做）
- 不写 SQLite ↔ JSONL 双写（P10 决策）

**产出物**：
- `desktop/Agent/pi-runtime/sessionFactory.js`
- `desktop/Agent/pi-runtime/bootstrap.js`（更新）
- `desktop/Agent/pi-runtime/index.js`（更新）

**验证方法**：

1. 第一次 `createKnowClawSession({ mode: 'new' })` 后发一条消息，到 userData 目录应看到一个 JSONL 文件。
2. 关闭后用 `mode: 'continueRecent'` 再启动，pi 应恢复上次消息（`session.messages` 长度 > 0）。
3. `SessionManager.list(cwd)` 能返回历史会话清单。

**上下文预算**：✅ 合适。

**风险**：
- 风险 R2.1：Windows 路径包含特殊字符导致 cwd-hash 异常 → 复用 pi 自身编码（`/\:` → `-`），与 pi `getDefaultSessionDir` 对齐；如遇 Unicode 特殊情况再切换 base64url
- 风险 R2.2：pi `_persist` 延迟写盘——首条 assistant 消息前文件不存在，验证 A 必须发 prompt 才能看到文件
- 风险 R2.3：pi 包未公开导出 `getDefaultSessionDir`，我们必须手动算 sessionDir 并显式传给 SessionManager（已实现）

**变更日志**：
- 2026-05-13 完成 P2。新建 `sessionFactory.js` 封装 `new / continueRecent / open / inMemory` 四种模式；会话文件落地到 `app.getPath('userData')/knowclaw-sessions/<cwdHash>/`，与 pi 默认目录隔离；cwd 编码复用 pi 自身方案保持兼容。
- `bootstrap.js` 默认 `mode='continueRecent'`，新增 resumed 检测（通过 `sessionManager.buildSessionContext().messages.length > 0` 判定），日志输出持久化状态与文件路径。
- `index.js` 新增 `listSessions(cwd)` / `getSessionDir(cwd)` 公共导出，给 Phase-3 IPC 桥预留接口；`createKnowClawSession` 透传 `mode` / `sessionFile`。
- `main.js` 在 `app.whenReady()` 内设置 `process.env.KNOWCLAW_SESSION_ROOT`，并给 PoC 触发块加 `KNOWCLAW_PI_POC_MODE` 环境变量便于切换 new/continueRecent 验证。
- 偏差说明：计划原写"统一 session 目录到 `app.getPath('userData')/knowclaw-sessions/<cwd-hash>/`"，落地一致；`listSessions` 改名为 `listSessions` 而非 `SessionManager.list(cwd)` 透传，目的是把 pi 内部 `SessionInfo` 字段裁剪到 IPC-friendly 形状。
- 暂未做：session 列表 UI（P10）、SQLite ↔ JSONL 双写（P10 决策）、IPC handler（P3）。

---

### Phase 3 — 主进程 → 渲染进程事件桥

**Status:** `DONE`

**目标**：把 `session.subscribe()` 的事件流转成 IPC 消息推到 renderer；preload 暴露最小 API（`send / subscribe / abort / setModel / listModels / newSession / continueRecent`）。**不做 UI。**

**前置**：P0~P2 完成。

**工作清单**

读：
- `desktop/src/main/ipc/supervisor.js`（旧 IPC 命名习惯，作为参考）
- `desktop/src/preload.js`（看现有 `window.ipm` 暴露模式）
- `desktop/src/main/main.js`（找 ipcMain 注册位置）

写：
- `desktop/src/main/ipc/knowclaw.js` —— 注册 `knowclaw:send / knowclaw:abort / knowclaw:setModel / knowclaw:listModels / knowclaw:newSession / knowclaw:continueRecent`；用 `webContents.send('knowclaw:event', payload)` 推送 pi 事件；维护"每个 BrowserWindow ↔ 一个 sessionId"映射

改：
- `desktop/src/preload.js` —— 在 `window.ipm.knowclaw` 命名空间下暴露上述方法；事件订阅用 `onEvent(cb) → unsubscribe`
- `desktop/src/main/main.js` —— 在合适位置 `registerKnowClawIpc()`

**不做**：
- 不实现 UI 组件
- 不实现历史会话 IPC（P10）

**产出物**：
- `desktop/src/main/ipc/knowclaw.js`
- `desktop/src/preload.js`（增量）
- `desktop/src/main/main.js`（增量）

**验证方法**：

1. 打开 IPM，devtools console 跑：
   ```js
   const off = window.ipm.knowclaw.onEvent(e => console.log(e));
   await window.ipm.knowclaw.send("你好，请列出当前工作目录文件");
   ```
2. devtools 看到完整事件流（与 P0 主进程 console 看到的一致）。
3. `await window.ipm.knowclaw.abort()` 能中止当前 prompt。

**上下文预算**：✅ 合适。事件转发逻辑是一个核心抽象，序列化是辅助抽象，刚好 2 个。

**风险**：
- 风险 R3.1：pi 事件里含不可序列化对象（如函数、Buffer）→ 在 `knowclaw.js` 里做白名单 serialize
- 风险 R3.2：多窗口并发时 session 冲突 → 本阶段先单窗口；多窗口在 P10 复盘

**变更日志**：

- 2026-05-13：完成。
  - `bootstrap.js` 拆分：核心初始化逻辑抽出为 `createSession(opts)`，返回长生命周期 `{ session, sessionId, resumed, sessionFile, model, modelFallbackMessage }`，调用方负责 `subscribe`/`prompt`/`dispose`。`runPoc()` 改为 one-shot 包装器（创建 → 订阅 console logger → 可选 prompt → dispose），保持 Phase 0/1/2 PoC 触发的向后兼容。新增 `disposeSession(session, unsubscribe)` 安全清理 helper。
  - `index.js` 新增 `createSession(opts)` 和 `disposeSession(session, unsubscribe)` 两个公共导出；`createSession` 在调用前会先 `await bootstrap()` 并合入当前 `currentModelId` 选择。
  - 新增 `desktop/src/main/ipc/knowclaw.js`（约 240 行）。模块内维护 `activeSession`/`activeUnsub`/`activeSender`/`promptInFlight`，pi-runtime 通过 `import(pathToFileURL(...).href)` 延迟加载（复用 P0 ESM 桥技巧）。注册 7 个 `ipcMain.handle`：`knowclaw:send` / `knowclaw:abort` / `knowclaw:newSession` / `knowclaw:continueRecent` / `knowclaw:listModels` / `knowclaw:setModel` / `knowclaw:getStatus`。事件通过 `evt.sender.send('knowclaw:event', { sessionId, ...sanitized })` 推送。
  - `sanitizeEvent()` 采用 `JSON.parse(JSON.stringify(event))` 快速路径 + 出错时回退到白名单字段拷贝（`type`/`sessionId`/`turnId`/`messageId`/`toolCallId`/`toolName`/`isError`/`reason` 等），保证 IPC 永不因不可序列化对象崩溃。序列化失败时会向渲染进程推一条 `{ type: 'error', source: 'knowclaw-bridge' }` 诊断事件，而不是静默丢 turn。
  - `knowclaw:send` 采用 fire-and-forget：`activeSession.prompt(message)` 在 `Promise.resolve().then(...)` 中异步执行，IPC handle 立即返回 `{ ok: true, sessionId }`，避免阻塞渲染进程；prompt 抛错会被捕获并转成 `error` 事件推送。新增 `promptInFlight` 标志防止同一 session 同时发起多个 turn。
  - `preload.js` 在 `analytics` 块之后新增 `knowclaw` 命名空间：暴露 `send / abort / newSession / continueRecent / listModels / setModel / getStatus / onEvent(cb)` 八个方法；`onEvent` 返回 unsubscribe 函数以便渲染层正确清理监听。
  - `main.js` 顶部 import `registerKnowClawIpc`；在 `registerSupervisorIpc(...)` 调用之后追加 `registerKnowClawIpc({ ipcMain, getUserFileRoot })`。
  - 保留 P0 `KNOWCLAW_PI_POC` 环境变量触发块（无修改），仍可独立验证 pi-runtime 健康性。
  - 严格遵守"不做"边界：未实现 UI、未引入会话列表/打开 IPC、未实现 `reloadConfig`、未做多窗口隔离（P10）、未对 thinking_delta / compaction 事件做特殊处理。
  - 验证：A — devtools console 订阅 `onEvent` 后 `send("你好...")`，应看到完整事件流；B — `send` 长 prompt 后 2 秒 `abort()`，事件流应被中断。

---

### Phase 4 — 最小 Chat UI（v2 独立面板）

**Status:** `DONE`

**目标**：新建一个**独立的** KnowClaw v2 面板（不替换旧入口），具备：输入框、流式文本输出、工具调用卡片（折叠/展开）、abort 按钮、模型选择下拉。**不接历史会话、不接 skill UI。**

**前置**：P3 完成。

**工作清单**

读：
- `desktop/src/ui/components/ProjectManager.jsx`（看主面板挂载模式）
- 现有任一聊天组件（如有；如无则跳过）作为视觉风格参考

写：
- `desktop/src/ui/components/KnowClawV2/index.jsx` —— 容器与状态机
- `desktop/src/ui/components/KnowClawV2/MessageList.jsx` —— 消息列表（区分 user / assistant / tool）
- `desktop/src/ui/components/KnowClawV2/ToolCallCard.jsx` —— 工具调用卡片（开始/结果/错误三态）
- `desktop/src/ui/components/KnowClawV2/Composer.jsx` —— 输入框 + 发送按钮 + 中止按钮 + 模型选择

改：
- 在某处加一个临时入口按钮打开此面板（顶部菜单或一个隐藏路由），便于测试。**绝不替换现有 KnowClaw 入口**

**不做**：
- 不实现历史会话切换（P10）
- 不实现思考流（thinking_delta）渲染——本阶段忽略此事件类型（P8 后再加）
- 不实现 Markdown 渲染美化（可用现有 BlockNote 或最简 `<pre>`）
- 不实现 steer / followUp UI（P10 视情况）

**产出物**：4 个 jsx + 1 处临时入口

**验证方法**：

1. 用户打开新面板，发"列出 D 盘 IPM 项目根目录的内容"。
2. 看到：流式文字输出、`read` / `ls` 工具调用卡片实时出现、最后回答。
3. 中途点中止按钮，pi 会停下。

**上下文预算**：⚠️ 偏满（4 文件 ~ 500 行）但抽象层级仍是 2（消息渲染 + 输入控制），可控。**如果实操发现某文件超 250 行，先停止本轮**，把 ToolCallCard 拆到 P4.5 做。

**风险**：
- 风险 R4.1：流式 text_delta 拼接顺序错位 → 用 `messageId` 索引 + 不可变 reducer

**变更日志**：

- 2026-05-13：完成。
  - 新增 `desktop/src/ui/components/knowclaw-v2/useKnowClawV2Chat.js`（约 250 行）。Hook 通过 `window.ipm.knowclaw.onEvent` 订阅 pi 事件，按 `event.type` 分发：`agent_start` 确保 streaming 占位；`message_update` + `assistantMessageEvent.type === 'text_delta'` 用 `streamBufferRef` 累加 delta 并刷新最后一条 assistant 的 `content`；`tool_execution_start` 用 `toolCallId` 追加 `{ name, toolCallId, status: 'running' }` 到 `tools[]`（含去重）；`tool_execution_end` 用 `toolCallId` 精确匹配并写入 `result`（`isError` 时 status='error'）；`agent_end` 关闭 `streaming` 并收尾空占位；`error` 替换/追加 system 消息。`turn_start` / `turn_end` / `message_start` / `message_end` / `queue_update` / thinking / compaction 等事件被忽略。
  - `stringifyResult()` 处理 pi tool 结果的常见形态：字符串原样、`[{ type: 'text', text }, ...]` 取 text 合并、其他对象 JSON.stringify。这样 `MessageBubble` 的 `ToolCallCard` 用 `<pre>` 渲染 `tool.result` 不会出现 `[object Object]`。
  - Hook 暴露 `sendMessage` / `abort` / `newSession` / `setModel` / `loadModels`，分别调用 P3 IPC 的 `send` / `abort` / `newSession` / `setModel` / `listModels`。`sendMessage` 立即追加 user 消息和 streaming assistant 占位；`abort` 在调用 IPC 后主动 `setStreaming(false)`（不依赖后续 `agent_end`，保证输入框立刻可用）；`setModel` 切换后自动调用 `newSession()`，使新模型在下一轮立即生效。
  - 新增 `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`（约 220 行）。结构：紫色→琥珀色 `Zap` 头像 + "KnowClaw v2" 标题 + sessionId 前 8 位作副标题；右上区域三个控件：自定义 `ModelSelector` 下拉（带 default 标签）/ 新对话按钮 / 输入框上方 streaming 时居中显示的红色"中止"按钮。空状态有 4 个快捷 prompt（含 P3 验证 A 的"1+1"问句和"列出 D 盘 IPM 项目根目录"）。
  - **复用现有组件**：`agent-chat/MessageBubble.jsx`（markdown 渲染 + `ThinkingIndicator` + `ToolCallCard` 全部兼容；传入 `projectName="KnowClawV2"` `domain="knowclaw"`）和 `agent-chat/ChatInput.jsx`，零修改。
  - `App.jsx` 在 `KnowClawPage` import 下追加 `KnowClawV2Page` import；`fadeEligible` Set 加入 `'knowclaw-v2'`；`displayNav` 三元链在 `'knowclaw'` 分支后插入 `'knowclaw-v2' → <KnowClawV2Page />` 分支。
  - `Sidebar.jsx` 在 lucide-react import 中新增 `Zap`；导航 nav 中"KnowClaw" `NavItem` 后追加一条 "KnowClaw v2" `NavItem`（`Zap` 图标，`activeNav === 'knowclaw-v2'` 判定）。
  - 严格遵守"不做"边界：未实现历史会话 UI、未渲染 thinking_delta、未新增 npm 依赖、未修改 MessageBubble/ChatInput/ToolCallCard、未替换旧 KnowClaw 入口（两个面板并存）、未实现 steer/followUp/executePlan。
  - 验证：A — 侧栏点 "KnowClaw v2"，输入"列出 D 盘 IPM 项目根目录的内容"，应看到 ThinkingIndicator → 工具调用卡片（如 `list_directory`）实时出现 → 流式文字回答；B — 长 prompt 后点红色"中止"，事件流应停止；C — 模型下拉切换 + 新对话清空消息。

---

### Phase 5 — customTools 第 1 批：项目只读类

**Status:** `DONE`

**目标**：把 4 个只读类 IPM 业务工具用 `defineTool` 包成 pi customTool，注入到 session。

**前置**：P4 完成（已有可验证 UI）。

**工作清单**

读：
- `desktop/Agent/supervisor/tools/listProjects.js`
- `desktop/Agent/supervisor/tools/crossProjectStats.js`
- `desktop/Agent/supervisor/tools/proactiveCheck.js`
- `desktop/Agent/supervisor/tools/projectReadTools.js`

写：
- `desktop/Agent/pi-runtime/tools/projectTools.js` —— 用 `defineTool` + `typebox` 暴露：`list_projects` / `cross_project_stats` / `proactive_check` / `read_project_meta` / `list_project_files`；schema 必须与原 zod schema 等价

改：
- `desktop/Agent/pi-runtime/index.js` —— `createKnowClawSession` 把 `customTools: [...projectTools]` 传入

**不做**：
- 不改写 / 不引入 pi 内置工具（read/write/edit/bash 在本阶段保持默认行为）
- 不做工具权限策略（P11 集中做）

**产出物**：
- `desktop/Agent/pi-runtime/tools/projectTools.js`
- `desktop/Agent/pi-runtime/index.js`（更新）

**验证方法**：

1. 在 v2 面板问"列出我所有项目"，pi 应调 `list_projects` 工具，UI 看到对应 ToolCallCard，返回与旧 KnowClaw 一致。
2. 问"我有多少项目，每个项目有多少案件？"，pi 应调 `cross_project_stats`。

**上下文预算**：✅ 合适。读 4 个文件、写 1 个聚合文件、逻辑同质。

**风险**：
- 风险 R5.1：zod → typebox schema 转换错位 → 写一个简单 mapper 或手工转换，本阶段工具不多可承受

**变更日志**：

- 2026-05-13：完成（精简方案：9 个旧工具 → 5 个 customTool）。
  - **范围决策**：与用户讨论后确认，旧 supervisor 的 9 个只读工具中只移植 5 个真正不可被 pi 内置工具替代的（依赖 SQLite 数据库或 buildProjectRegistry 业务抽象）：`list_projects` / `cross_project_stats` / `proactive_check` / `get_recent_events` / `query_history`。`browse_structure` / `inspect_folder` / `search_files` / `get_project_stats` 被 pi 内置 `ls` / `read` / `grep` / `find` 更好地覆盖，不移植。
  - **风险确认**：实施前先核对 pi SDK 真实接口形状——
    - R5.1：TypeBox 包名为 `typebox`（不是 `@sinclair/typebox`），已在 `desktop/node_modules/typebox`，可直接 `import { Type } from 'typebox'`
    - R5.2：`AgentToolResult` 真实形状是 `{ content: [{ type: 'text', text }], details: T, terminate? }`（来自 `@earendil-works/pi-agent-core/dist/types.d.ts:281`），不是计划草稿里推测的 `{ type: 'text', resultForAssistant }`。`projectTools.js` 内 `textResult()` helper 统一封装这个形状
    - R5.3 + 新发现 ESM 边界问题：`Agent/supervisor/*.js` 和 `Agent/db/*.js` 使用 ESM 语法但所在目录没有 `package.json type=module`，只能通过 Vite bundle 加载——pi-runtime 是独立 ESM 模块，不能直接 import 它们。**解决方案**：让 IPC 层（`knowclaw.js`，被 Vite bundle 编译）import 业务函数，作为函数引用注入到 pi-runtime 的 `toolDeps`，跨边界传递
  - 新增 `desktop/Agent/pi-runtime/tools/projectTools.js`（约 410 行）。`buildProjectTools(deps)` 工厂函数返回 5 个 `defineTool` 实例。每个工具：用 `Type.Object({...})` 定义 TypeBox schema（共享 `projectDomainParams` 片段）；`execute(toolCallId, params, signal, onUpdate, ctx)` 5 参数签名；返回 `{ content: [{ type: 'text', text }], details: null }`。所有 5 个工具都加了 `promptGuidelines: ['Only call IPM-specific tools ... when the user explicitly asks about their IPM projects ...']`，降低与通用对话的误调用概率。`safeCount(db, sql, params)` helper 统一处理 SQLite 失败回退。
  - 工具实现严格映射旧 supervisor 逻辑：
    - `list_projects`：调 `buildProjectRegistry` → 按 domain 分组 → markdown 列表
    - `cross_project_stats`：遍历 registry + SQLite 计数 pending suggestions / 近 24h events + tempFileCount → JSON
    - `proactive_check`：遍历 registry + SQLite 多维查询（pending / 3 天 stale / 24h events / activity_log）→ issues + recentActivity JSON 或"状况良好"中文
    - `get_recent_events`：单项目 `listEvents` + `listLogs` 合并 → 按 time 排序 → JSON
    - `query_history`：单项目 events 表带条件 SQL（status filter + LIKE keyword）→ JSON
  - 改写 `bootstrap.js`：`createSession()` 新增 `opts.toolDeps` 参数；若提供则 `buildProjectTools(toolDeps)` 构建 customTools 数组（失败 fallback 为空数组，不阻塞 session 创建）；`createAgentSession()` 调用增加 `customTools` 字段。`runPoc()` 不传 `toolDeps`，保持 PoC 单纯。
  - 改写 `desktop/src/main/ipc/knowclaw.js`：顶部新增 4 个业务 import（`buildProjectRegistry` / `getProjectDb` / `listEvents` / `listLogs`），相对路径 `'../../../Agent/...'` 与 supervisor.js IPC 一致；`registerKnowClawIpc` 函数签名扩展为接收 `{ getWorkspaceDirs, readState, getWorkspaceDirOrThrow }`（可选——三者齐全才注入 toolDeps）；`ensureSession` 中构造完整 `toolDeps` 对象（7 个字段），传给 `runtime.createSession({ cwd, mode, toolDeps })`。
  - 改写 `desktop/src/main.js`：`registerKnowClawIpc` 调用从 `{ ipcMain, getUserFileRoot }` 扩展为完整 5 参数（加 `getWorkspaceDirs` lambda、`readState`、`getWorkspaceDirOrThrow`）。`getWorkspaceDirs` 用 lambda 包装现有的 `getProjectsRoot/getCasesRoot/getStudyRoot`，与 supervisor IPC 注册风格一致。
  - `pi-runtime/index.js` **无修改**：已用 `{ ...opts, modelId: effectiveModelId }` 展开，`toolDeps` 自动透传。
  - 严格遵守"不做"边界：未覆盖 pi 内置工具（read/write/edit/bash 保持默认）、未移植 4 个被 pi 内置覆盖的旧工具、未做工具权限策略（P11）、未修改旧 supervisor 工具文件（两套并存）、未引入 Zod 到 pi-runtime、未新增 npm 依赖（typebox 是 pi 的传递依赖）。
  - 验证：A — "列出我所有项目" 应调 `list_projects` 卡片；B — "我有多少项目，每个项目有多少案件？" 应调 `cross_project_stats`；C — "检查所有项目有没有需要关注的问题" 应调 `proactive_check`；D — "读取 desktop/package.json 的前 10 行" 应仍能调 pi 内置 `read` 工具，customTools 不干扰。

---

### Phase 6 — customTools 第 2 批：文件 / 脚本 / 网络

**Status:** `DONE`

**目标**：把"IPM 业务文件操作"（区别于 pi 内置 read/write/edit）、`run_script`、`fetch_web` 包成 customTool。明确**哪些用 pi 内置、哪些用 customTool**。

**前置**：P5 完成。

**工作清单**

读：
- `desktop/Agent/supervisor/tools/fileTools.js`
- `desktop/Agent/supervisor/tools/scriptTool.js`
- `desktop/Agent/supervisor/tools/webTool.js`

写：
- `desktop/Agent/pi-runtime/tools/fileTools.js` —— 只保留**业务语义**文件操作（如"读取项目 meta"、"写入分类决策"），通用 read/write/edit 让 pi 内置接管
- `desktop/Agent/pi-runtime/tools/scriptTool.js` —— `run_script`
- `desktop/Agent/pi-runtime/tools/webTool.js` —— `fetch_web`

改：
- `desktop/Agent/pi-runtime/index.js` —— 注册新工具

**不做**：
- 不引入 sandbox / 权限策略（P11）
- 不接入 pi-subagents 扩展（P9）

**产出物**：3 个 tool 文件 + index.js 更新

**验证方法**：

1. 问"读取项目 X 的 meta 并告诉我创建时间"，pi 走业务 fileTools。
2. 问"读 D 盘某 readme 文件"，pi 走内置 `read`。两者并存不冲突。
3. 问"用 curl 获取 https://example.com 标题"，pi 走 `fetch_web`。

**上下文预算**：✅ 合适。

**风险**：
- 风险 R6.1：业务文件工具与 pi 内置 read 在 LLM 决策时混淆 → 在 description 里明确边界（"业务工具只用于项目元数据"）

**变更日志**：
  - **范围精简决策（与用户确认 fetch-only）**：经客观分析 pi 内置工具覆盖度，原计划的 4 个旧工具中仅 `fetch_web` 真正不可被 pi 内置工具替代：
    - `read_file_content` → pi 内置 `read`（path/offset/limit）已完全覆盖；.docx/.xlsx Python 提取属极低频场景，不值得维护，**不移植**
    - `write_file_content` → pi 内置 `write`（path + content + mkdir）完全覆盖，**不移植**
    - `run_script` → pi 内置 `bash`（含 timeout）可执行 `python script.py`，**不移植**
    - `fetch_web` → pi 0.74.0 **没有内置 HTTP 工具**（`ToolName` 仅含 read/write/edit/bash/grep/find/ls），`bash + curl` 在 Windows 不可靠且让模型构造完整 shell 命令体验差，**必须移植**
  - 新增 `desktop/Agent/pi-runtime/tools/webTools.js`（约 145 行）。`buildWebTools()` 工厂函数返回 1 个 `defineTool` 实例：
    - 工具名 `fetch_web`，TypeBox schema：`url: Type.String({ minLength: 1 })`、`maxLength: Type.Optional(Type.Number())`
    - `execute(_toolCallId, params, signal)` 3 参数签名（多接 host abort signal，与本地 30s timeout controller 串联——用户中断时能同步取消正在进行的 fetch）
    - 逻辑严格映射旧 supervisor 实现：URL 校验 → `fetch()` + 30s AbortController → 媒体类型检测（image/video/audio 返回中文说明）→ HTML strip tags → 200KB 默认截断 → `textResult()` 包装
    - `promptGuidelines` 明确指引模型优先用此工具而非 `bash curl`
    - **无 toolDeps**：使用 Node 全局 `fetch`（v18+，项目 Node v22.12.0 OK）
  - 改写 `bootstrap.js`：顶部新增 `import { buildWebTools } from './tools/webTools.js'`；在原步骤 8（buildProjectTools）之后插入新步骤 8b，**无条件**调用 `buildWebTools()` 并 `customTools.concat(webTools)`（不需要 `toolDeps`，PoC 模式也能用）。失败 fallback 静默继续，不阻塞 session 创建。
  - **不需要改动**的文件：
    - `desktop/src/main/ipc/knowclaw.js` — `fetch_web` 无业务依赖，不需要新 toolDeps 字段
    - `desktop/src/main.js` — 同上
    - `desktop/src/preload.js` — 无新 IPC 频道
    - `desktop/Agent/pi-runtime/index.js` — 已用 `{ ...opts }` 透传，customTools 在 bootstrap 内部组装
  - 严格遵守"不做"边界：未移植 read_file_content / write_file_content / run_script（pi 内置覆盖）、未引入 sandbox/权限策略（P11）、未接入 pi-subagents（P9）、未修改旧 supervisor 工具文件（两套并存）、未引入 Zod 到 pi-runtime、未新增 npm 依赖。
  - 验证：A — "帮我获取 https://example.com 的页面内容" 应触发 `tool_execution_start` toolName=`fetch_web`，返回含 "Example Domain" 的文本；B — "读取 desktop/package.json 的前 5 行" 应仍走 pi 内置 `read` 工具，两者并存不冲突；C — bootstrap 日志应显示 `customTools: 1 web tools registered (total 6)`（toolDeps 存在时）或 `(total 1)`（PoC 模式）。

---

### Phase 7 — 系统提示词与 ResourceLoader

**Status:** `DONE`

**目标**：把 KnowClaw 的系统提示词与上下文文件（当前工作区 / 用户偏好 / 当前项目）通过 `DefaultResourceLoader` 注入。

**前置**：P5、P6 完成（工具已就位，prompt 才有意义）。

**工作清单**

读：
- `desktop/Agent/supervisor/prompts.js`（现行 `buildSupervisorPrompt`）
- `desktop/src/main/ipc/prefs.js`（用户偏好结构）

写：
- `desktop/Agent/pi-runtime/promptBuilder.js` —— `buildKnowClawSystemPrompt({ workspace, preferences, currentProject })`：搬运并改写 prompts.js，**移除原文中关于"必须委托给子 agent"的规则**（pi 模式下技能直接在主上下文执行）
- `desktop/Agent/pi-runtime/resourceLoader.js` —— `buildResourceLoader({ workspace, preferences, currentProject })`：用 `systemPromptOverride` 与 `agentsFilesOverride` 注入

改：
- `desktop/Agent/pi-runtime/bootstrap.js` —— 用 resourceLoader 替代默认

**不做**：
- 不接 skill（P8）
- 不接 slash command（暂不需要）

**产出物**：2 文件 + bootstrap 更新

**验证方法**：

1. 在 v2 面板问"你是谁，能做什么"，回答应自报"KnowClaw"并提到 IPM 当前工作区。
2. 改用户偏好（如默认语言）后新建会话，提示词中应反映。

**上下文预算**：✅ 合适。

**风险**：
- 风险 R7.1：prompt 中对"工具集"的描述与实际 customTools 不一致 → 在 promptBuilder 里**用占位变量**动态生成工具清单段，避免硬编码

**变更日志**：
  - **方案决策（与用户确认方案 A）**：通读 pi SDK 的 `system-prompt.js:7-119` 后客观评估，pi 默认模板（"You are an expert coding assistant operating inside pi" + pi 文档路径引用）对 IPM 场景几乎零价值；而真正有价值的自动追加机制（`toolSnippets` / `promptGuidelines` / `appendSystemPrompt` / `contextFiles` / `skills` / 日期 / cwd）在传入 `customPrompt` 时**仍然全部生效**。因此选择方案 A：`customPrompt` 直接替换默认模板，保留所有自动追加机制。
  - **结构精简决策**：原计划写"`promptBuilder.js` + `resourceLoader.js` 2 文件"，实际实施只新建 `promptBuilder.js`。`DefaultResourceLoader` 的构造在 `bootstrap.js` 中 inline（4 行），单独拆 `resourceLoader.js` 反而徒增间接层。
  - 新增 `desktop/Agent/pi-runtime/promptBuilder.js`（约 95 行）：
    - `KNOWCLAW_PROMPT_VERSION = 'v1-pi-runtime'`、`buildKnowClawPrompt({ userName, cwd })`、`describeKnowClawPrompt(prompt)`
    - 严格遵守 R7.1：**不硬编码任何工具名**——pi 框架会自动从工具注册表生成 "Available tools" 段和 guidelines 段，新增/重命名工具不需要改 prompt
    - 内容大幅精简至约 1.0KB（旧 supervisor prompt 约 3.5KB）：保留身份 / 能力分类（通用 + IPM 业务）/ 工作原则 / 对话风格；移除"必须委托给子 agent"、"必须用 absolutePath"（已由工具 description 接管）、Skill 系统规则（P8 再加）、delegate_to_agent 引用
    - 用户偏好接入：`userName` 存在时生成"用名字称呼"指令，否则生成中性的"用『你』即可"指令
  - 改写 `desktop/Agent/pi-runtime/bootstrap.js`：
    - 顶部 import 增加 `DefaultResourceLoader, getAgentDir` 来自 `@earendil-works/pi-coding-agent`，以及 `buildKnowClawPrompt, describeKnowClawPrompt` 来自 `./promptBuilder.js`
    - `createSession` 新增 `opts.prefs` 参数（可选）
    - 新增步骤 8c：构造 `DefaultResourceLoader({ cwd, agentDir: getAgentDir(), systemPrompt, noContextFiles: true })` 并 `await reload()`
    - **关键决策 `noContextFiles: true`**：IPM 的 cwd 是 `userfile/` 用户文件目录而非代码项目根，pi 默认会向上遍历搜索 `AGENTS.md`/`CLAUDE.md` 全部祖先目录，在 IPM 场景下毫无意义且可能拉入无关磁盘文件。后续 P8 如需注入 IPM 上下文，应改用 `agentsFilesOverride` 显式提供
    - resourceLoader 构造失败时静默回退到 pi 默认（resourceLoader=undefined），不阻塞会话创建
    - `createAgentSession` 调用增加 `resourceLoader` 字段
    - 日志：`[KnowClaw] resourceLoader: systemPrompt injected { length, version, preview }`
  - 改写 `desktop/src/main/ipc/knowclaw.js`：
    - `ensureSession` 中新增"读取 prefs"段：`readState()` → `state.prefs` → 传给 `runtime.createSession({ ..., prefs })`
    - `readState` 是 P5 已注入的 toolDeps 之一，无需新增 IPC 参数或 main.js 改动
  - **不需要改动**的文件：`desktop/src/main.js`（readState 已传给 knowclaw IPC）、`desktop/src/preload.js`（无新通道）、`desktop/Agent/pi-runtime/index.js`（用 `{ ...opts }` 透传，prefs 自动转发）、旧 `desktop/Agent/supervisor/prompts.js`（双轨并存到 P12）
  - 严格遵守"不做"边界：未接 skill（P8）、未接 slash command、未引入 `appendSystemPrompt`/`agentsFilesOverride`（P8/P10 再加）、未修改旧 supervisor prompt
  - 验证：A — 问"你是谁" 应自报 KnowClaw + IPM 项目管理身份，不出现"pi"或"coding agent harness"；B — 设置 userName 后新会话问"你好" 应包含名字称呼；C — 问"列出我所有项目" 应仍正常调用 `list_projects` 工具（resourceLoader 不影响 customTools）；D — 主进程日志应出现 `[KnowClaw] resourceLoader: systemPrompt injected { length: ~1000, version: 'v1-pi-runtime', preview: ... }`

---

### Phase 8 — Skill 系统迁移

**Status:** `DONE`

**目标**：把现有 supervisor 的 skill 体系迁移到 pi 的 AgentSkills 协议（`.agents/skills/<name>/SKILL.md`），废弃"skill 作为子 agent 执行"模式。

**前置**：P7 完成。

**工作清单**

读：
- `desktop/Agent/supervisor/skills/builtinSkills.js`
- `desktop/Agent/supervisor/skills/skillParser.js`
- `desktop/Agent/supervisor/skills/skillExecutor.js`（仅了解原行为，确认我们要废弃哪些）
- `desktop/Agent/supervisor/skills/skillStore.js`

写：
- `desktop/Agent/skills-library/<skill-name>/SKILL.md` —— 每个 skill 一份；frontmatter 含 `name / description / when_to_use`
- `desktop/Agent/pi-runtime/skillProvider.js` —— 读 `skills-library` 目录与用户自定义 skill 目录（`userData/skills/`），转 pi 的 `Skill[]`，通过 `skillsOverride` 注入

改：
- `desktop/Agent/pi-runtime/resourceLoader.js` —— 接入 skillProvider

**拆分提示**：如果 supervisor 现有 skill 数量 > 6 个，本阶段拆为：
- **P8a**：建 `skills-library/` 目录 + skillProvider + 迁移前 3 个 skill + 验证主流程
- **P8b**：迁移其余 skill + 边界用例

**不做**：
- 不实现 skill workshop UI（用户可手工编辑 .md）
- 不实现远程 skill 拉取（ClawHub 风格）

**产出物**：N 份 SKILL.md + skillProvider.js + resourceLoader 更新

**验证方法**：

1. 在 v2 面板触发某 skill 关键词，pi 应直接按 SKILL.md 操作工具，**全程在主上下文里**（不再 spawn 新 agent）。
2. 删除某 SKILL.md，下次启动 skill 列表自动减少。

**上下文预算**：⚠️ 偏满。若实际 skill > 6 个执行 P8a/P8b 拆分。

**风险**：
- 风险 R8.1：旧 skill 内部依赖 skillExecutor 注入的特殊 tool（仅 skill 期间可用）→ 在 SKILL.md 中改为"调用 ${tool_name}"指令式描述

**变更日志**：

- 2026-05-14：完成。
  - **范围决策（与用户确认 streamlined 方案）**：经评估旧 supervisor 4 个内置 skill（`skill-builder` / `file-content-search` / `document-summary` / `web-news-briefing`）相对 pi 内置工具（grep / read / fetch_web）的覆盖度，**全部不直接迁移**；改为只搭管道 + 写一个 pi-native 的 `skill-builder`。
  - **官方 skill-creator 评估（与用户确认 custom-builder 方案）**：通读 Anthropic 官方 `anthropics/skills` 仓库的 `skill-creator/SKILL.md`（484 行 + 18 个附带文件），其重度依赖 Claude Code 专有能力（subagents、`claude -p` CLI、浏览器 eval-viewer、`present_files` 工具），在 pi-coding-agent 运行时全部不可用，**不能直接复用**。其余 16 个官方 skill：`pdf`/`docx`/`xlsx`/`pptx` 是 source-available（非开源）且依赖 Claude Code 沙盒；`webapp-testing` 需要 Playwright；`mcp-builder`/`claude-api`/creative 类与 IPM 场景不匹配——**P8 不内置任何官方 skill**。
  - **架构决策（不新建 skillProvider.js）**：原计划预设手动构造 `Skill[]` + `skillsOverride` 注入，但通读 pi SDK 的 `resource-loader.d.ts` 发现 `DefaultResourceLoaderOptions.additionalSkillPaths: string[]` 是原生入口，pi 的 `loadSkillsFromDir()` 自动递归扫描 `<dir>/<name>/SKILL.md` 并通过 `formatSkillsForPrompt()` 拼成 `<available_skills>` XML 段追加到系统提示。一行配置即可，**不需要额外抽象层**。
  - 新增 `desktop/Agent/pi-runtime/skills/skill-builder/SKILL.md`（约 116 行）：
    - frontmatter `description` 写得"积极"以提升触发率：覆盖"创建 skill / 写技能 / 把工作流固化 / 制作 SKILL.md / 让 KnowClaw 学会某流程"等多种说法
    - 正文从官方 Skill Writing Guide 提取核心原则——目录结构、frontmatter 写法、渐进式加载、why > MUST、通用 > 特例、示例胜过空谈——**去除**所有 Claude Code 专属内容（subagents 并行测试、CLI eval、浏览器 viewer、benchmark/grader 脚本、`/skill:*` slash 命令、`present_files` 打包）
    - **新增 IPM 场景适配段**：明确 KnowClaw 跑在 `userfile/` 而非代码项目根（不假设 git/`package.json`）；推荐用 IPM 业务工具（`list_projects` 等）而非自己翻文件系统；推荐 `fetch_web` 而非 `bash curl`
    - **新增 IPM 工作流提示**：skill 存放路径建议、新增 skill 需开新 session 才能生效、description 不够"积极"是常见触发失败原因
  - 改写 `desktop/Agent/pi-runtime/bootstrap.js`：
    - 顶部新增 `import path from 'node:path'` 与 `import { fileURLToPath } from 'node:url'`
    - 模块级常量 `BUILTIN_SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills')`——基于本文件位置解析，开发模式（直接跑源码）和打包后（asar-extracted Agent/ 树）都正确
    - 步骤 8c 的 `DefaultResourceLoader` 构造新增一行 `additionalSkillPaths: [BUILTIN_SKILLS_DIR]`
    - `await reload()` 后追加可观测日志：`resourceLoader.getSkills()` 拉出 `{ skills, diagnostics }`，分别打印名称数组与诊断消息（若有）；包了 try/catch 防止 pi API 变更时崩溃
  - **不需要改动**的文件：`knowclaw.js`（无新 IPC）、`preload.js`（无新 API）、`main.js`（无新注册）、`index.js`（无新导出）、`promptBuilder.js`（skill XML 由 pi 框架自动追加到 system prompt 末尾，无需手动拼）
  - **架构层面遗留**（明确标注，留给后续阶段）：
    - 用户自定义 skill 目录（如 `userData/skills/`）暂未配置；后续可在 `additionalSkillPaths` 数组里追加，无需改动其他文件
    - skill 热重载：当前模型只能在 session 创建时看到 skill 列表；新增 skill 需开新 session（pi `ResourceLoader.reload()` 存在但未在运行时暴露）
    - skill workshop UI（用户在 v2 面板里图形化管理 skill）：明确不做（旧计划已写）
    - 远程 skill 拉取（ClawHub 风格）：明确不做
  - 严格遵守"不做"边界：未实现 skill workshop UI、未实现远程 skill 拉取、未迁移任何旧 supervisor skill、未引入官方 Anthropic skill、未注入用户自定义 skill 目录（基础设施已在位，加路径即可）、未引入 `skillsOverride` / `appendSystemPrompt`、未触动旧 supervisor 的 `skills/` 子树（两套并存）。

- 2026-05-14（增量）：补齐"用户自定义 skill 目录"——P8 主体验证通过后，skill-builder 首跑暴露出一个 UX 问题（模型反问用户 skill 应该放哪里），用户要求增设一个专门的 skill 存放目录。
  - **位置决策（与用户确认 userdata 方案）**：`%APPDATA%/IPM/knowclaw-skills/`，跟 `knowclaw-sessions/` 同级。理由：跨平台标准路径（Electron `app.getPath('userData')`）；与 sessions 同根、运维一致；不污染 IPM 业务文件目录 `userfile/`；重装 IPM 不丢 skill。**全局共享，不按 cwd 隔离**——用户为某个 IPM workspace 写的 skill 在其他 workspace 也能用，符合"个人技能库"的直觉。
  - **首跑体验决策（与用户确认 auto-create + README 方案）**：app 启动时 `fs.mkdirSync({ recursive: true })` 兜底创建目录，并在 README.md 不存在时写入一份中文说明（目录用途、子目录结构示例、新增/删除/生效规则、不要乱丢无关文件的提醒）。后续启动不覆盖 README，用户可随意编辑。
  - 改动 `desktop/src/main.js`：在 `app.whenReady()` 内 `KNOWCLAW_SESSION_ROOT` 设置之后追加 `KNOWCLAW_USER_SKILLS_ROOT` 环境变量及 mkdir + README seed 逻辑（约 45 行，含 README 内容字符串与 try/catch 容错——失败仅打 warn 不阻塞启动）。
  - 改动 `desktop/Agent/pi-runtime/bootstrap.js`：
    - 新增模块函数 `getUserSkillsRoot()`，读 `process.env.KNOWCLAW_USER_SKILLS_ROOT`，env 缺失时返回 `null`（**故意不**回退到 homedir，user-data 必须由 Electron 决定）
    - 步骤 8c 的 `additionalSkillPaths` 由"单元素硬编码数组"改为"基于 builtin + 可选 user 的动态数组"
    - `skills loaded` 日志的位置标识从 `{ from }` 改为 `{ builtin, user }`，user 为空时显示 `'(none)'`，方便排查"为什么我新建的 skill 没被加载"
  - 改动 `desktop/Agent/pi-runtime/skills/skill-builder/SKILL.md` 步骤 2：从"问用户放哪里"改为"直接写到用户目录"。明确指引模型用 `bash` 工具执行 `node -e "console.log(process.env.KNOWCLAW_USER_SKILLS_ROOT || '')"` 跨平台获取绝对路径（**不**让模型硬编码 `%APPDATA%/...` 之类的路径——多平台不一致且 IPM appData 可能被 `--user-data-dir` 覆盖）；环境变量为空时引导用户重启 IPM 而非退回到内置目录。
  - **不需要改动**的文件：`knowclaw.js`（无新 IPC，pi 内置 `bash`/`read`/`write` 已足够让模型操作用户目录）、`preload.js`、`index.js`、`promptBuilder.js`、`sessionFactory.js`（虽然两者都用 env-var 模式，但功能正交，没必要共享代码）。
  - 仍然遗留：skill 热重载（新增后不开新会话也能生效）、skill workshop UI（图形化管理）、远程 skill 拉取——均明确不做。

- 2026-05-14（增量修复）：消除 `skills diagnostics: [ 'description is required' ]` 噪音日志。
  - **根因**：pi 的 `loadSkillsFromDir` 对用户传入根目录使用 `includeRootFiles=true`，即"目录下任何根级 `.md` 文件都尝试解析成 flat skill"。我们的 README.md 没有 frontmatter，触发 `validateDescription` 的"description is required"诊断（skill 不会真的注入到 prompt，但日志噪音每次启动都打）。
  - **修复**：通读 `skills.js:1-211` 后发现 pi 在 `IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.fdignore']` 三种文件中支持 `ignore` 库语法。在 `main.js` 的 seed 逻辑里增加 `.ignore` 文件创建（不存在则写入；存量安装下次启动也会补齐），内容排除 `README.md` / `README.txt` / `.DS_Store` / `Thumbs.db`。同时 README.md 的目录树示例与"注意"段同步更新，告知用户 `.ignore` 用途与不要删除。
  - **不改动 bootstrap.js**：这是 seed 层面的问题，不是运行时问题；pi 的 ignore 机制本身工作正常。

---

### Phase 9 — 项目专员委托（多 agent）

**Status:** `SKIPPED`

**目标（原计划）**：把"主管 → 项目专员"委托从 `delegate_to_agent` IPC 调用，重做为基于 `pi-fast-subagent` 的同进程子会话委托。

**前置**：P8 完成。

**工作清单（原计划）**

读：
- `desktop/Agent/supervisor/tools/delegateToAgent.js`
- `desktop/Agent/project-agent/` 下相关文件（先 ls 看清单，再选 2-3 个核心文件读）
- pi-fast-subagent README（外部资源，先 fetch）

写：
- `desktop/Agent/pi-runtime/delegation.js` —— 封装"创建一个项目专员子会话"：复用 ModelRegistry / AuthStorage / 子集 tools（仅项目作用域内）+ 单独 prompt + 独立 session（in-memory 或 per-project）
- `desktop/Agent/pi-runtime/tools/delegateTool.js` —— `delegate_to_agent` customTool：内部调 delegation.js，把子会话最终结果回传

改：
- `desktop/Agent/pi-runtime/index.js` —— 注册 delegateTool

**不做**：
- 不做并行多专员（单次 delegate 单线）
- 不做专员之间通信（pi-collaborating-agents 是更高阶能力，留作后续）

**产出物**：2 文件 + index 更新

**验证方法**：

1. 在主面板说"在项目 X 中创建一份新案件，命名为 ABC"，主管应调 `delegate_to_agent`，子会话执行写操作，最终结果回流。
2. UI 上的工具调用卡片应明确显示这是一次委托（特殊 icon / 折叠区显示子会话事件）。

**上下文预算**：✅ 合适，但需要决策抽象（"子会话状态如何回传"），属于 2 个核心抽象上限内。

**风险**：
- 风险 R9.1：子会话事件流与主会话事件流在 IPC 桥混淆 → delegateTool 内部消费子事件，转化为单个 tool_result 给主会话；子会话事件可选地以"附属事件"形式经 IPC 上推（前缀 `knowclaw:sub:`）

**变更日志**：

- 2026-05-14（决策跳过）：经客观调研，确认本阶段当前不做。决策依据：
  - **pi-coding-agent v0.74.0 不包含子 agent / 委托原生 API**：通读 `pi-coding-agent/dist/core/sdk.d.ts`、`agent-session.d.ts`、`agent-session-runtime.d.ts`、`extensions/types.d.ts` 等全部相关声明，**未发现** "subagent / delegate / spawn / nested session" 任何一类一等公民 API。`AgentSessionRuntime` 上的 `newSession({ parentSession })` / `fork` / `switchSession` 仅是**会话文件层面**的分叉与切换（JSONL 树父子关系），不是"父 agent 调用子 agent 回路"——`parentSession` 是**新 JSONL 头里的元数据**而非运行时 agent 关系。
  - **Anthropic 官方 `@anthropic-ai/claude-agent-sdk` 有完整子 agent**：`AgentDefinition` + `agents` + `Agent` 工具构成 first-class 多 agent 体系，但**只支持 Anthropic Claude 模型**（内置 Claude Code 二进制 + 走 Anthropic API），与 IPM 的 `ipm-openai` provider（GPT-5.1、OpenAI 兼容接口）**不兼容**。无法直接借鉴。
  - **`pi-fast-subagent` 包不存在**：node_modules 下 `@earendil-works/` 仅有 `pi-coding-agent` / `pi-agent-core` / `pi-tui` / `pi-ai` 4 个包；原计划假设的"pi-fast-subagent"包并不存在。
  - **自建子会话编排**：可以再调一次 `createAgentSession` 创建独立子会话（独立 prompt / 独立 toolset / 独立 SessionManager），然后包装成 `delegate_to_project` customTool。但父子关系完全靠应用层自己编排，**复杂度高**（需要管理子会话生命周期、子事件流序列化为单条 tool_result、IPC 不污染、错误传播、abort 级联、并发控制等）。
  - **旧专员的核心价值在 pi 主会话已被覆盖**：旧 project-agent 的核心是"将写操作限定在单个项目目录内 + 写前确认"。pi 主会话已经具备：(a) `read/write/edit/bash/grep/find/ls` 全能力工具，作用于 cwd（IPM 的 `userfile/`）；(b) Phase 5 注入的 5 个 IPM 业务读工具（`list_projects` / `cross_project_stats` / `proactive_check` / `get_recent_events` / `query_history`）；(c) Phase 6 的 `fetch_web`；(d) Phase 7 的 KnowClaw system prompt 已明确身份与能力边界；(e) Phase 8 的 skill 系统支持用户固化"项目工作流"。综合评估，主会话能力**覆盖旧专员 90%+ 工作场景**，剩余 10% 主要是"严格的项目目录隔离"——可以通过 prompt 约束 + 用户确认（pi UI 自带）兜底。
  - **决策结论**：**P9 当前跳过，不阻塞后续阶段推进**。后续若实际使用中发现"项目作用域强隔离"或"上下文隔离的并行任务"是真实痛点，再以独立增量阶段（不在主线 13 阶段内）开发"自建子会话委托"方案，而非现在为了对齐旧架构而强行复刻。
- 不需要改动任何代码、配置或依赖；旧 supervisor 的 `delegate_to_agent` 工具继续在旧轨（legacy supervisor）中存活，pi-runtime 一侧不引入此工具。

---

### Phase 10 — 历史会话 UI（列表 / 恢复 / 分支）

**Status:** `DONE`

**目标**：在 KnowClawV2 面板加历史会话侧栏；支持列出、点击恢复、fork 分支。同时决策 SQLite 旧表的归宿。

**前置**：P8 完成（P9 跳过；pi 链路核心功能就绪）。

**工作清单**

读：
- `desktop/Agent/supervisor/db/chatSessions.js`、`chatMessages.js`（决策依据）

写：
- `desktop/src/ui/components/knowclaw-v2/SessionPanel.jsx` —— 历史会话侧栏（折叠抽屉、搜索、行内菜单、删除确认）
- 扩展 `desktop/src/main/ipc/knowclaw.js` —— 新增 `knowclaw:listSessions / knowclaw:openSession / knowclaw:deleteSession / knowclaw:forkSession`
- 扩展 `desktop/src/preload.js`
- 扩展 `desktop/src/ui/components/knowclaw-v2/useKnowClawV2Chat.js`

改：
- `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx` —— 集成 SessionPanel，左侧抽屉式展开

**决策**：本阶段必须给出"SQLite 旧表 vs JSONL 新会话"的明确取舍并写入本计划"变更日志"小节，二选一：
- 方案 J：JSONL 单一存储，旧 SQLite 表归档冻结 ← **已采纳**
- 方案 D：JSONL + SQLite 双写（pi 写 JSONL 后，写一条索引行到 SQLite 以兼容历史 UI）

**不做**：
- 不实现 session 搜索（仅 placeholder + 客户端首条消息过滤；服务端搜索留作后续）
- 不实现导入导出（pi 内置 import 留作 v3）
- 不实现独立的 SessionTree 树状视图（按计划文档允许 push 到 P10.5）；fork 当前默认行为为"复制全量到新文件"，从某条消息分支的细粒度入口留作后续 per-message "branch from here" 加强

**产出物**：1 jsx + IPC 扩展 + preload + hook 扩展 + page 集成 + 决策记录

**验证方法**：

1. 侧栏看到历史会话列表（含上次某条对话）。
2. 点击恢复，消息流被还原。
3. 删除会话从列表移除且 JSONL 真的不在了。
4. fork 后产生一份新会话，可以从分叉点继续对话。
5. 切换 / 折叠侧栏的过渡正常。

**上下文预算**：✅ 合适（删去 SessionTree 后落入 1 个 UI 抽象 + 1 个数据决策）。

**风险**：
- 风险 R10.1：JSONL session 文件在用户机器上累积过多 → P13 文档中加保留策略说明
- 风险 R10.2：历史消息映射结构复杂 → 已通过 `mapPiMessagesForRenderer()` 适配；orphan toolResult 与 stuck "running" tool 都做了兜底
- 风险 R10.3：`ensureSession` 复用路径可能拦截 openSession → 已在 openSession 内显式 `disposeCurrentSession()` 后再 `createSession({ mode: 'open' })`

**变更日志**：

- 2026-05-14（决策 + 实现）：方案 J（JSONL 单一存储）落地。
  - **数据决策（J）**：旧 supervisor 的 `chat_sessions` / `chat_messages` 表（LangChain state 形态）与 pi JSONL（`SessionEntry[]` 形态）数据结构差异巨大，"双写"几乎要重做 LangChain → AgentMessage 转换才能保持兼容；而旧 KnowClaw UI 在 P11 切流之后即进入下线倒计时（P12），为这条短命路径维护一份索引表代价过高。pi SDK 的 `SessionManager.list / open / create / inMemory` + `buildSessionContext()` 已能完整支撑列表 + 恢复 + fork 三件事，故采用方案 J：pi 一侧只用 JSONL，旧 SQLite 表保持冻结直到 P12 整体清理。
  - **IPC 层（`desktop/src/main/ipc/knowclaw.js`）**：
    - 新增 4 个 handler：`knowclaw:listSessions` / `knowclaw:openSession` / `knowclaw:deleteSession` / `knowclaw:forkSession`。
    - 新增 `mapPiMessagesForRenderer()`：把 pi 的 `AgentMessage[]`（`UserMessage` / `AssistantMessage` / `ToolResultMessage`）映射成 `MessageBubble` 期望的 `{ role, content, tools[], ts }` 形态——assistant 文本块拼接成 `content`、`toolCall` 块进 `tools[]`、ToolResultMessage 通过 `toolCallId` 反向匹配回去填 `result/status`，孤儿 toolResult 静默丢弃，未结束的 stuck "running" 工具兜底标记为 done + 提示 "(no result captured)"。
    - 新增 `validateSessionFilePath()`：所有写操作（delete/fork）严格校验路径必须在 `KNOWCLAW_SESSION_ROOT` 下、必须是 `.jsonl`，防止 IPC 调用越界。
    - 新增 `readJsonlEntries()`：fork 用，按行读 JSONL，跳过损坏行（与 pi 自身行为一致）。
    - 新增 `buildHistoryLoadedEvent()`：使用 `session.messages` getter（pi 的 `AgentSession.messages` 已经走过 leaf 解析与 compaction 还原），不再额外调 `buildSessionContext()`。
    - openSession：先 `disposeCurrentSession()` 再 `createSession({ mode: 'open' })`，订阅事件流后立刻推一次 `history_loaded` 事件给 renderer，让前端用历史填充 transcript。
    - deleteSession：删除文件前先比对当前 session 文件，若被删的是当前活动 session 则先 `disposeCurrentSession()` 解锁文件句柄（Windows 兼容）。
    - forkSession：读源 JSONL → 截断到 `entryIndex+1`（缺省为全量复制）→ 用 `crypto.randomUUID` 生成新 id + `${stamp}_${uuid}.jsonl` 文件名 → 在新 header 上盖 `forkedFrom / forkedFromFile / forkedAt` 元数据 → 写入新文件后 `createSession({ mode: 'open' })` 切到新 session，并推 `history_loaded`。
  - **preload（`desktop/src/preload.js`）**：在 `window.ipm.knowclaw` 下暴露 `listSessions / openSession / deleteSession / forkSession` 4 个新方法。
  - **hook（`desktop/src/ui/components/knowclaw-v2/useKnowClawV2Chat.js`）**：
    - 新 state：`sessions / sessionsLoading / showSessionPanel / currentSessionFile`。
    - 新 actions：`refreshSessions / openSession / deleteSession / forkSession / setShowSessionPanel`。
    - `newSession` 在创建后自动 `refreshSessions()`，并把返回的 `sessionFile` 设为 currentSessionFile。
    - 事件 switch 新增 `history_loaded` case：清 streaming 状态 + 整体替换 `messages`。
    - mount 时自动 `loadModels() + refreshSessions()`；turn 完成时（streaming 由 true→false 时刻）也自动 `refreshSessions()`，让列表里的 firstMessage / messageCount / modified 实时更新。
  - **新建 `SessionPanel.jsx`**（约 280 行）：左侧 `w-72` 抽屉。顶栏含搜索框（客户端按 firstMessage 模糊过滤）、刷新、新建 3 个图标按钮；列表行展示首条消息（截断 56 字）、消息计数与相对时间（`Intl.RelativeTimeFormat`）；当前 session 行用 `bg-amber-50 border-amber-200` 高亮；hover/激活时显示 ⋯ 菜单（「打开」「分支」「删除」）；删除走自定义浮层确认。
  - **集成到 `KnowClawV2Page.jsx`**：根容器从 `flex flex-col` 改为 `flex`（横向布局）；条件渲染 SessionPanel 在最左；新增聊天区 wrapper（`flex-1 min-w-0 flex flex-col`）；Header 左侧加 `PanelLeftOpen / PanelLeftClose` 切换按钮；hook 解构所有新返回值并透传给 SessionPanel。
  - **不改动**：`bootstrap.js`、`pi-runtime/index.js`、`sessionFactory.js`（已有 `listSessions` / `getSessionDir` / `makeSessionManager`，无需新增）、`main.js`（`KNOWCLAW_SESSION_ROOT` 在 P2 已配置）、`promptBuilder.js`、`MessageBubble.jsx`（兼容 hook 输出的同款格式）。
  - **风险与兜底**：
    - JSONL `header.id` 在 fork 时被重新生成（`crypto.randomUUID`）以避免列表重复 id；pi 的 `SessionManager.list` 不校验 id 版本格式，UUIDv4 与 pi 的 UUIDv7 在 listing 上等价。
    - Windows 上删除当前活跃 session 文件可能因 SessionManager 持有句柄报 EBUSY，已通过"删除前先 dispose 当前 session"规避。
    - 历史消息映射对 `custom / notification / thinking` 等非 LLM 消息直接跳过（不显示），保持 UI 简洁；后续如需 thinking 还原，单独加 case 即可。
- 2026-05-14（增量修复）：fork 分支点击无反应。
  - **根因**：`knowclaw:forkSession` IPC handler 中 JSONL header 合法性检查为 `header.type`（truthy check），但 pi 的 `SessionHeader.type` 值为 `"session"`（字符串，truthy），导致所有 fork 请求被 guard clause 拒绝，返回 `{ ok: false, error: 'source session is missing a valid header' }`。前端 hook 收到 `ok: false` 后静默（未做 UI 反馈），用户看到的是"没反应"。
  - **修复**：`knowclaw.js` 中 `header.type` 改为 `header.type !== 'session'`；`SessionPanel.jsx` 的 `handleFork` 增加 `console.warn` 错误日志输出，便于调试。

---

### Phase 11 — 双轨切换开关与默认引擎切流

**Status:** `SKIPPED`

**目标（原计划）**：在 IPM 设置加"KnowClaw 引擎"开关（`legacy` / `pi`），默认 pi；新会话路由到对应引擎；旧会话继续走旧引擎。

**前置**：P10 完成（pi 链路功能完整）。

**工作清单（原计划）**

读：
- `desktop/src/main/ipc/prefs.js`
- `desktop/src/main/ipc/supervisor.js`（旧 IPC 主入口，确认路由切入点）
- `desktop/src/ui/components/project-manager/HeaderBar.jsx`（如有 KnowClaw 入口，可能在此切按钮）

写：
- 一个统一的引擎路由器：根据 preference 把 `supervisor:*` IPC 调用代理到 legacy 或 pi 实现
- 设置面板新选项

改：
- `prefs.js` 增字段 `knowclaw.engine`（默认 `pi`）
- 旧 KnowClaw 入口组件改为按引擎渲染对应面板（或保留独立两入口）

**不做**：
- 不删除旧代码（P12 做）

**产出物**：路由器代码 + 设置面板 + prefs 改动

**验证方法**：

1. 切换开关到 legacy，新建会话进入旧 UI；切到 pi，新建会话进入 V2 UI。
2. 同时有"旧会话历史"与"新会话历史"两套，互不污染。

**上下文预算**：✅ 合适。

**风险**：
- 风险 R11.1：用户在 pi 引擎下访问旧会话 → 路由器在打开旧 sessionId 时强制切回 legacy 引擎并提示

**变更日志**：

- 2026-05-14（决策跳过）：P11 设计的核心价值是"在设置面板提供引擎切换开关实现渐进式迁移"。但实际情况是：
  - 新旧 KnowClaw 在 Sidebar 中已有独立入口（"KnowClaw" 和 "KnowClaw v2"），事实上已具备手动双轨能力，无需再建一套 preference-based 路由器。
  - P12 将直接清理旧 supervisor / project-agent / LangGraph 全套实现（包括旧 Sidebar 入口），不再需要"用户主动切回 legacy"的过渡期。
  - 为此构建引擎路由器 + prefs 字段 + 设置面板选项约 250 行代码，其生命周期仅限 P11→P12 之间，属于纯粹的短命过渡代码，投入产出比极低。
  - **结论**：跳过 P11，直接从 P10 进入 P12（旧实现下线与依赖清理）。

---

### Phase 12 — 旧实现下线与依赖清理

**Status:** `DONE`

**目标**：删除旧 supervisor / project-agent 实现、旧 KnowClaw UI 与无用依赖，同时保留 classifier 文件分类子系统、共用 db/storage 层和 SupervisorBubble 气泡框架（剥离 supervisor AI 逻辑）。

**前置**：P10 已交付，P11 已主动跳过（双轨切换由两个 sidebar 入口替代，本阶段直接下线旧入口）。

**关键决策**

- `Agent/classifier/`、`Agent/db/`、`Agent/storage/`、`Agent/services/`、`Agent/tools/`、`Agent/schemas/`、`Agent/prompts/`、`Agent/guardrails/`、`Agent/runner/`：全部保留，与 KnowClaw 重构无关，是文件分类核心。
- `Agent/supervisor/projectRegistry.js`：迁移到 `Agent/shared/projectRegistry.js`，因 `knowclaw.js`（pi-runtime IPC 桥）仍需该工具枚举项目。
- `SupervisorBubble`：保留 Toast morph 引擎、Usage Tips、气泡展开/折叠/badge 框架，剥离 supervisor IPC、Skills tab、Learning tab，重命名为 `KnowClawBubble`。通知 tab 改为 stub。
- `agent-chat/`：`MessageBubble.jsx`、`ChatInput.jsx` 被 KnowClaw v2 直接复用，保留；`ChatPanel`、`useAgentChat`、`HistoryDropdown`、`ConversationNav`、`ActionPlanCard`、`MessageList` 仅服务旧栈，删除。
- 依赖保留：`@langchain/core`、`@langchain/langgraph`（classifier 子系统直接依赖）、`@langchain/openai`（`prefs.js` 的 `testLlm` 仍依赖）、`zod`、`@earendil-works/pi-coding-agent`。
- 依赖移除：`pi-fast-subagent`（P9 跳过未集成）、`zod-to-json-schema`（仅作为 pi-ai/langgraph 的传递依赖）。

**变更日志**

读：
- `desktop/Agent/supervisor/projectRegistry.js` —— 迁移前确认其为纯 Node.js 工具
- `desktop/src/main.js` —— 找出所有旧 supervisor/project-agent 注册点
- `desktop/src/preload.js` —— 找出旧 supervisor/agent 命名空间
- `desktop/src/ui/App.jsx`、`Sidebar.jsx`、`ProjectManager.jsx`、`project-manager/RootTable.jsx` —— 找出旧 UI 引用
- `desktop/src/ui/components/SupervisorBubble.jsx` —— 重构前提取气泡框架

新建：
- `desktop/Agent/shared/projectRegistry.js` —— 从 supervisor/ 迁移而来，由 knowclaw.js 引用
- `desktop/src/ui/components/KnowClawBubble.jsx` —— 替换 SupervisorBubble，保留 Toast/Tip 框架并接入 KnowClaw v2 导航

改：
- `desktop/src/main/ipc/knowclaw.js` —— `projectRegistry` import 改指 `Agent/shared/`
- `desktop/src/main.js` —— 移除 6 处旧 import（`registerProjectAgentIpc`/`registerSupervisorIpc`/`getSession`/`removeSession`/`ensureBuiltinSkills`/`runProactiveCheck`），移除对应的两次注册调用、`ensureBuiltinSkills` 安装步骤、`proactiveCheckArgs` + 30 min 定时任务；保留 supervisorDb 启动/关闭逻辑
- `desktop/src/main/ipc/projects.js` & `cases.js` —— 删除 `getAgentSession`/`removeAgentSession` 入参与相关清理代码
- `desktop/src/preload.js` —— 删除 `window.ipm.agent`（11 个方法）和 `window.ipm.supervisor`（24 个方法）两个命名空间
- `desktop/src/ui/App.jsx` —— 删除 `KnowClawPage` 导入与 `'knowclaw'` 分支；`SupervisorBubble` 替换为 `KnowClawBubble`，导航目标改为 `'knowclaw-v2'`；fadeEligible 中 `'knowclaw'` 移除
- `desktop/src/ui/components/Sidebar.jsx` —— 删除旧 KnowClaw 入口与 `Zap` 图标导入；KnowClaw v2 入口 label 改名为 `KnowClaw`，dataTrack 简化为 `nav-knowclaw`
- `desktop/src/ui/components/ProjectManager.jsx` —— 删除 `ChatPanel` 导入、`chatProjectCtx` state、`<ChatPanel>` 渲染、传给 RootTable 的 `onOpenAgent`
- `desktop/src/ui/components/project-manager/RootTable.jsx` —— 删除"AI 助理"按钮与 `Bot` 图标导入
- `desktop/package.json` —— 移除 `pi-fast-subagent` 与 `zod-to-json-schema`

删：
- `desktop/Agent/supervisor/`（整个目录，约 20 文件 / 3745 行）
- `desktop/Agent/project-agent/`（整个目录，约 6 文件 / 1169 行）
- `desktop/src/main/ipc/supervisor.js`
- `desktop/src/main/ipc/projectAgent.js`
- `desktop/src/ui/components/knowclaw/`（整个目录：`KnowClawPage.jsx` + `useKnowClawChat.js`）
- `desktop/src/ui/hooks/useSupervisorNotifications.js`
- `desktop/src/ui/components/SupervisorBubble.jsx`
- `desktop/src/ui/components/agent-chat/ChatPanel.jsx`
- `desktop/src/ui/components/agent-chat/hooks/useAgentChat.js`（连同空的 `hooks/` 目录）
- `desktop/src/ui/components/agent-chat/HistoryDropdown.jsx`
- `desktop/src/ui/components/agent-chat/ConversationNav.jsx`
- `desktop/src/ui/components/agent-chat/ActionPlanCard.jsx`
- `desktop/src/ui/components/agent-chat/MessageList.jsx`（残留无引用 + 依赖已删的 ActionPlanCard）

**净效果**：删除约 30+ 文件、~5000+ 行旧 KnowClaw 代码；新增 2 文件（registry 迁移 + KnowClawBubble）。pi-runtime + classifier 双子系统格局清晰，UI 入口由两个简化为一个（`KnowClaw` = 原 v2）。

**P12 后续修复（domain 枚举值问题）**

用户测试发现 LLM 调用 `get_recent_events` 时传 `domain: ???` 导致工具失败。根因：TypeBox schema 定义了 Union/Literal 枚举，但 LLM 可见的 description 只有 `"IPM workspace domain."`，未列出合法值。同时 `project-daily-brief` skill 的指导文字让模型"不要自行虚构 domain"但又没告诉它该填什么。

修了三处：
- `pi-runtime/tools/projectTools.js` — `domain` description 从一句话改为详细说明三个合法值 `"projects"` / `"cases"` / `"study"` 及各自的使用场景
- `knowclaw-skills/project-daily-brief/SKILL.md` — 工作流步骤 2 中显式列出 domain 取值规则
- `pi-runtime/promptBuilder.js` — 系统 prompt 新增"重要：IPM 的 domain 参数"段落，含枚举值和不确定时的兜底策略（先调 `list_projects`）

**验证方法**：

A. 应用启动正常，控制台无 import 报错。
B. Sidebar 仅显示单个「KnowClaw」入口，打开后可发送消息、可看到会话面板。
C. 右下角气泡保留，Tips 仍周期性弹出；展开面板不崩溃（仅显示空通知 + 跳转 v2 入口）。
D. 设置页 LLM 测试连接仍然可用（`@langchain/openai`）。
E. 文件上传后自动分类仍然工作（classifier 子系统未受影响）。
F. `npm ls @langchain/core` 仍能找到包；`npm ls pi-fast-subagent` 返回空。
G. `desktop/Agent/supervisor/` 与 `desktop/Agent/project-agent/` 目录已不存在。

---

### Phase 13 — 验收文档

**Status:** `DONE`

**目标**：补 pi-runtime 完整开发者文档，让后来者（或未来的我）半小时能上手。

**前置**：P12 完成。

**关键决策**

- 不单独写 `docs/knowclaw-user-guide.md`——KnowClaw 的用户界面足够直观（对话式 UI），且 pi-runtime 内置的 `skill-builder` skill 会在对话中自行引导用户创建 skill，无需额外用户文档。
- 重点放在开发者文档：架构图、模块职责、扩展指南（添加 customTool / Skill / 修改 prompt / 切换模型）。

**变更日志**

改：
- `desktop/Agent/pi-runtime/README.md` —— 从 P0 时的简单占位改写为完整开发者文档：
  - ASCII 架构图（Electron Main → ESM 边界 → pi-runtime → Renderer 全链路）
  - 9 个模块的职责表
  - 关键设计决策（ESM/CJS 边界、依赖注入、内存隔离、会话存储）
  - 扩展指南 4 节：添加 customTool（含完整代码示例）、添加 Skill（含 SKILL.md 格式模板）、修改系统 Prompt、切换/添加 LLM 模型
  - classifier 与 KnowClaw 双子系统对比表
- `desktop/Agent/README.md` —— 从旧的"LangChain 架构"单一分类说明改写为双子系统概览：KnowClaw (pi-runtime) + Classifier (LangGraph) + 共用层 + 环境变量

---

## 4. 风险登记表（全局）

| ID | 风险 | 触发阶段 | 概率 | 影响 | 缓解 |
|----|------|---------|------|------|------|
| RG-1 | pi-coding-agent 上游 breaking change | 任意阶段 | 中 | 高 | 锁版本；fork 兜底 |
| RG-2 | Electron 主进程 ESM 兼容问题 | P0 | 中 | 中 | 动态 import；必要时升级到 main.mjs |
| RG-3 | 模型 API quota / 网络问题导致开发卡壳 | 任意 | 低 | 中 | P1 配置回退到 OpenAI-compatible 本地模型用于联调 |
| RG-4 | 用户旧会话数据迁移损失 | P10/P12 | 低 | 高 | P12 之前不删 SQLite；P10 决策须包含"旧数据只读保留 ≥ 6 个月" |
| RG-5 | 多 agent 委托过程中事件流冲突 | P9 | 中 | 中 | 子事件加前缀 namespace；UI 折叠展示 |
| RG-6 | 提示词更新导致行为回归 | P7、P8 | 中 | 中 | 关键 prompt 改动写在变更日志，便于回滚 |

---

## 5. 决策门（每阶段后用户审批口径）

每个阶段交付后，AI 给出**两段式汇报**：

1. **What is done**（5 行内）：本轮新增/修改文件清单、关键产物。
2. **How to verify**（操作步骤，3 步内）：用户复制粘贴即可验证。

用户回答 `GO`、`NO-GO` 或 `ASK`：

- `GO` → 进入下一阶段
- `NO-GO` → 本阶段在本计划下补开"修复轮"（不开新阶段）
- `ASK` → 用户提问，AI 答复后再次请求决策

---

## 6. 术语表

- **pi / pi-coding-agent**：`@earendil-works/pi-coding-agent`，本次重构的 runtime 核心。
- **AgentSession**：pi 提供的单次会话对象，含消息历史、模型、工具、事件订阅。
- **SessionManager**：pi 的会话持久化抽象（JSONL 文件）。
- **ResourceLoader**：pi 的资源装配抽象，统一管理 system prompt / skills / extensions / context files。
- **customTool**：通过 `defineTool` 注册的业务工具。
- **AgentSkills**：pi 兼容的 skill 协议（基于 SKILL.md + frontmatter）。
- **fast-subagent**：`pi-fast-subagent` 扩展，同进程子会话委托。（P9 研究后确认该包无有效实现，已在 P12 移除依赖。）
- **legacy KnowClaw**：原基于 LangGraph 的 `desktop/Agent/supervisor/` 实现。（已在 P12 完全删除。）

---

## 7. 参考资料

- pi-coding-agent SDK 文档：`packages/coding-agent/docs/sdk.md`（GitHub `earendil-works/pi`）
- pi 扩展开发文档：`packages/coding-agent/docs/extensions.md`
- pi-gui 桌面参考实现：https://pi-gui.com/
- pi-fast-subagent：https://github.com/tuansondinh/pi-fast-subagent
- AgentSkills 规范：（pi 仓库 docs 内）

---

## 8. 进度看板

> AI 每完成一轮，将下表对应阶段 Status 更新为 `DONE`，并在该阶段段落"变更日志"小节填写：日期 / 提交说明 / 与计划的偏差。

| 阶段 | Status   | 完成日期 | 备注 |
|------|----------|---------|------|
| P0   | DONE     | 2026-05-13 | PoC 通道打通；环境变量触发；Vite external 已配置 |
| P1   | DONE     | 2026-05-13 | ipm-openai provider 注册；listAvailableModels / setModel 接口就绪 |
| P2   | DONE     | 2026-05-13 | 持久化 JSONL 会话；sessionFactory 封装 4 种模式；userData 目录隔离 |
| P3   | DONE     | 2026-05-13 | knowclaw IPC 7 通道 + 事件推送桥；长生命周期 session；preload window.ipm.knowclaw |
| P4   | DONE     | 2026-05-13 | KnowClaw v2 独立面板；pi 事件→MessageBubble 映射；模型切换 + abort + 新对话 |
| P5   | DONE     | 2026-05-13 | 5 个 IPM 业务 customTool 注入 pi session；依赖注入跨 ESM/Vite 边界 |
| P6   | DONE     | 2026-05-13 | 精简为仅移植 fetch_web（pi 无内置 HTTP 工具）；read/write/run_script 由 pi 内置覆盖不移植 |
| P7   | DONE     | 2026-05-14 | DefaultResourceLoader + customPrompt 替换 pi 默认模板；prompt 不硬编码工具；userName 个性化 |
| P8   | DONE     | 2026-05-14 | additionalSkillPaths 注入 pi-runtime/skills/；新增 pi-native skill-builder；不内置任何 Anthropic 官方 skill |
| P9   | SKIPPED  | 2026-05-14 | pi 无原生子 agent API + 主会话已覆盖旧专员 90%+ 能力，跳过本阶段 |
| P10  | DONE     | 2026-05-14 | SessionPanel + 4 IPC + JSONL 单一存储（方案 J） |
| P11  | SKIPPED  | 2026-05-14 | 新旧已独立入口，直接 P12 清理，无需短命路由器 |
| P12  | DONE     | 2026-05-14 | 旧 supervisor/project-agent 全删；SupervisorBubble→KnowClawBubble；依赖精简；domain 枚举修复 |
| P13  | DONE     | 2026-05-14 | pi-runtime/README.md 完整架构文档 + Agent/README.md 双子系统概览 |

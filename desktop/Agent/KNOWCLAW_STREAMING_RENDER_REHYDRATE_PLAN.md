# KnowClaw 流式渲染与历史恢复显示不一致排查记录

> **目标**：记录 KnowClaw 对话过程中“实时流式显示”和“退出后重新进入显示”不一致的现象、根因、影响范围与后续优化方向，作为后续前端渲染稳定性改造的上下文。
>
> **结论先行**：这是一个**实时事件流 UI 状态管理 bug + 历史恢复路径的设计取舍**。模型并没有真实重复输出，工具也没有重复执行；重复主要发生在 renderer 的实时消息数组构造阶段。重新进入对话后显示更干净，是因为 rehydrate/history 路径从持久化消息重新映射，只保留规范化后的最终结构。
>
> **状态**：`DOCUMENTED`。本文只记录与规划，不直接改实现。

---

## 0. 阅读与维护说明

- 本文记录的是 2026-05-29 用户截图反馈后的排查结果。
- 后续若开始修复，请在本文对应 Phase 下把 `Status` 从 `PENDING` 改为 `IN_PROGRESS` / `DONE`，并在阶段末补“变更日志”。
- 相关优化应尽量小步提交，优先保证对话内容不丢失，再追求实时布局与历史布局完全一致。

---

## 1. 用户观察到的现象

### 1.1 LLM 思考/正文重复显示

在一次 KnowClaw 对话中，模型先输出 thinking 或正文，然后调用 `task_manager` 更新任务清单。任务卡片插入后，下一阶段的 thinking/text delta 到来时，前端可能重新显示一遍之前已经出现过的 thinking 或正文。

用户截图中的典型表现：

- 截图 1：LLM 先显示一段 thinking，然后更新 `task_manager`。
- 截图 2：进入下一阶段后，前端又出现一段新的 assistant 区块，里面重复显示之前已经出现过的 thinking；后续新输出会继续接在这个新区块里。
- 旧的区块通常不再变化，新的区块继续接收后续流式内容。

### 1.2 退出后重新进入，对话结构变了

当用户暂时离开 KnowClaw 页面，之后回到对话，或者通过历史恢复路径重新加载同一会话时：

- 重复的 thinking / 正文片段消失。
- 对话只展示一份更完整、更干净的最终输出。
- 任务清单通常只显示最新状态，不再保留实时过程中出现的多个中间快照。

### 1.3 Tool 卡片顺序与排版变化

实时对话过程中，tool 卡片按事件发生顺序穿插在 assistant 输出和任务卡片之间。重新进入后：

- 部分实时中间卡片不再显示。
- tool 卡片可能重新归并到其所属 assistant 消息下。
- 任务卡片可能被移动到对话尾部，仅展示最新一份任务快照。

---

## 2. 当前代码路径

### 2.1 实时流式路径

主要文件：

- `desktop/src/ui/hooks/useKnowClawPersist.jsx`
- `desktop/src/ui/components/knowclaw-v2/knowclawEventReducer.js`
- `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`
- `desktop/src/ui/components/agent-chat/MessageBubble.jsx`

关键机制：

1. `knowclaw:event` 事件进入 `KnowClawPersistProvider`。
2. `agent_start` / `text_start` / `thinking_delta` / `text_delta` 会调用 `ensureStreamingMessage(prev)`。
3. `ensureStreamingMessage()` 只判断 `messages[messages.length - 1]` 是否是 `role === 'assistant' && streaming`。
4. `tool_execution_start/end` 会把 tool 调用挂到当前 streaming assistant bubble 的 `tools[]` 上。
5. 当 tool 是 `task_manager` 时，`tool_execution_end` 额外向 `messages` 末尾追加一个 `role: 'system', kind: 'tasks'` 的任务卡片。

### 2.2 历史恢复 / rehydrate 路径

主要文件：

- `desktop/src/main/ipc/knowclaw.js`
- `desktop/src/ui/hooks/useKnowClawPersist.jsx`

关键机制：

1. `knowclaw:rehydrate` 调用 `buildHistoryLoadedEvent(ch.session, sessionFile)`。
2. `buildHistoryLoadedEvent()` 从 `session.messages` 读取 pi runtime 的规范化消息。
3. `mapPiMessagesForRenderer(piMessages)` 只映射 `user` / `assistant` / `toolResult`。
4. `extractLatestTasksEntry(session)` 从 session entry log 中只取最新一份 `knowclaw:tasks`。
5. renderer 收到 `history_loaded` 后直接 `setMessages(restored)`，并在尾部追加最新任务卡片。

---

## 3. 根因分析

### 3.1 重复显示的直接原因

实时路径中，当前 streaming assistant 的定位方式过于脆弱：

```text
ensureStreamingMessage(messages):
  如果最后一条是 streaming assistant → 复用
  否则 → 在末尾新建一个 streaming assistant
```

这在普通纯文本流里没有问题，但当 `task_manager` 结束时，代码会向 `messages` 末尾追加任务卡片：

```text
assistant(streaming) → tasks(system)
```

此时最后一条消息已经不是 assistant。下一次 `thinking_delta` 或 `text_delta` 到来时：

1. `ensureStreamingMessage()` 误以为当前没有 streaming assistant。
2. 它在任务卡片后面新建一个 assistant bubble。
3. `thinkingBufferRef.current` / `streamBufferRef.current` 是整轮累计 buffer，不是本次 delta。
4. 新建 bubble 被赋值为完整累计内容，于是用户看到旧 thinking / 旧正文重复出现。

### 3.2 为什么重新进入后重复内容消失

重复 bubble 是 renderer 实时状态里的临时结构，不是 pi runtime 持久化消息里的规范结构。

重新进入后走 `mapPiMessagesForRenderer()`，它从 `session.messages` 重新构建：

- 一个 assistant message 对应一个 assistant bubble。
- toolResult 回填到对应 toolCall。
- 不保留 renderer 实时过程中额外插入的重复 assistant bubble。
- task_manager 只通过 `extractLatestTasksEntry()` 取最后一份任务状态。

因此重新进入后展示的是“压缩/规范化后的最终视图”，重复片段自然消失。

### 3.3 Tool 卡片重排的原因

实时路径和历史路径对 tool 的组织方式不同：

- 实时路径：tool 按事件到达顺序挂到当时的 streaming assistant bubble；`task_manager` 还会额外生成独立任务卡片。
- 历史路径：toolCall 与 toolResult 根据 pi 持久化消息重新配对，挂回 assistant bubble；任务卡片只取最新快照并放在恢复后 transcript 尾部。

所以 tool 卡片“实时顺序”和“恢复后顺序”不完全一致，是当前双路径设计天然导致的。

---

## 4. 判断：Bug 还是特性

### 4.1 属于 bug 的部分

- thinking / 正文重复出现：**是 bug**。
- 同一轮 assistant 输出被拆成多个 bubble 且早期 bubble 停止更新：**是 bug**。
- 用户在实时观看时看到“模型好像重复想了一遍/说了一遍”：**是 bug 造成的错觉**。

### 4.2 属于当前设计取舍的部分

- 重新进入后只展示最新任务清单：**可以视为设计取舍**。
- 旧任务快照折叠或消失：**可接受**，因为它们多是中间态。
- 历史恢复后 transcript 更干净：**有利于阅读**，但需要避免用户误以为内容丢失。
- tool 卡片从“事件时间线”变成“归属 assistant 消息下的结构化列表”：**是历史映射路径的当前设计**。

---

## 5. 影响评估

### 5.1 对用户体验的影响

影响等级：`中`

原因：

- 不影响模型实际执行。
- 不影响工具是否执行成功。
- 不影响最终历史记录的可读性。
- 但实时观看时容易产生困惑，尤其是长任务、PPT 生成、报告生成等多阶段任务中，用户会误以为模型重复输出或前端卡顿。

### 5.2 对数据安全和持久化的影响

影响等级：`低`

原因：

- 重复显示主要存在于 renderer 内存态。
- pi runtime 的 session 持久化结构仍然相对干净。
- 重新进入后重复内容消失，说明持久化层没有把这些重复 UI bubble 当成真实 assistant 消息保存。

### 5.3 对后续功能的影响

影响等级：`中`

可能影响：

- 任务流可视化。
- 长任务阶段展示。
- tool timeline。
- 未来若要做“可回放执行过程”，当前实时路径和历史路径不一致会成为阻碍。

---

## 6. 后续优化方向

---

### Phase R0 — 修复实时 streaming assistant 定位

**Status:** `PENDING`

**目标**：消除 thinking / 正文重复显示，让同一轮 assistant 输出始终更新同一个 bubble，即使中间插入任务卡片或其他系统卡片。

**核心方案**：

不要再用“最后一条消息是否 streaming assistant”判断当前输出目标，而是维护当前 turn 的 active assistant bubble 标识。

可选实现：

1. 给每轮 agent turn 分配 `turnId`。
2. `agent_start` 时创建或定位当前 assistant bubble，并记录到 `activeAssistantMessageIdRef`。
3. `thinking_delta` / `text_delta` / `tool_execution_*` 都按这个 id 更新对应 bubble。
4. `task_manager` 可以继续插入独立任务卡片，但不会影响 assistant bubble 的定位。

**涉及文件**：

- `desktop/src/ui/hooks/useKnowClawPersist.jsx`
- `desktop/src/ui/components/knowclaw-v2/knowclawEventReducer.js`

**验证方法**：

1. 让 KnowClaw 执行包含 `task_manager` 的多阶段任务。
2. 在 thinking 后调用 task_manager，再继续 thinking/text。
3. 页面中不应出现重复的 thinking 或正文。
4. 退出再回来，最终输出和实时输出的主体内容应一致。

**风险**：

- R0.1：需要谨慎处理 `agent_end`、`error`、`history_loaded` 时 active id 清理。
- R0.2：如果一个用户 turn 中出现多个 assistant message，需要确认 pi event 是否会明确分段；否则先按“一轮一个 active assistant bubble”处理。

---

### Phase R1 — 统一实时路径与历史恢复路径的消息模型

**Status:** `PENDING`

**目标**：让实时显示和重新进入后的显示尽量一致，避免用户看到布局明显变化。

**方案 A：以历史恢复模型为准**

实时阶段也尽量把 toolCall 挂在 assistant bubble 内，任务卡片只展示最新状态或以 overlay 形式展示，不插入 transcript 中间。

优点：

- 重新进入后差异最小。
- transcript 更干净。

缺点：

- 实时过程中的阶段感弱一些。
- 如果用户想看完整任务快照历史，需要额外入口。

**方案 B：以事件时间线为准**

历史恢复时也从 session entry log 恢复所有 task snapshots 和 tool event 顺序，尽量还原实时过程。

优点：

- 可回放性强。
- 长任务审计更完整。

缺点：

- 历史 transcript 可能很吵。
- 需要更多持久化映射逻辑，复杂度较高。

**建议**：优先采用方案 A。KnowClaw 是面向日常工作流的助手，默认 transcript 应偏“最终可读”，完整事件时间线可作为调试/详情视图存在。

---

### Phase R2 — 任务清单展示策略优化

**Status:** `PENDING`

**目标**：保留任务进度感，同时避免任务卡片打断 assistant 流式输出定位。

**候选设计**：

1. **浮动任务面板**：任务清单固定在消息流上方或侧边，不作为 transcript 消息插入。
2. **最新任务卡片内联**：仅在消息流中保留最新任务卡片，旧任务快照折叠为摘要。
3. **阶段时间线**：把每次 task_manager 调用作为 timeline 节点，默认折叠，用户展开查看。

**建议**：

- 短期：保持当前“旧任务快照折叠，最新任务完整”的策略，但修复 active assistant bubble 定位。
- 中期：将任务状态从 `messages[]` 中拆出成独立状态，减少对 transcript 顺序的干扰。

---

### Phase R3 — Tool Timeline / Transcript 双视图

**Status:** `PENDING`

**目标**：同时满足“阅读最终结果”和“追踪执行过程”的需求。

**设计方向**：

- Transcript 视图：默认视图，偏最终可读，减少重复与中间噪音。
- Timeline 视图：调试/审计视图，按事件顺序展示 thinking、tool start/update/end、task snapshots、assistant deltas。

**价值**：

- 用户平时看到干净对话。
- 排查长任务、工具失败、生成文件过程时，可以切到完整时间线。

**风险**：

- UI 增加复杂度。
- 需要决定 timeline 数据是否持久化，还是只保留当前会话内存态。

---

### Phase R4 — ToolCall 参数流式渲染

**Status:** `IN_PROGRESS`（2026-05-29 启动；按用户决定与 R0 解耦，先行上线）

**问题陈述**：

`write` / `edit` 等会生成大段参数的工具，模型可能花费 10–30 秒生成 JSON
`content` 字段，但前端在 `tool_execution_start` 到达前**完全不展示任何卡片**。
用户的实际观感是：

1. 模型停止 thinking。
2. 几十秒内屏幕没有任何变化（既无 thinking 也无 tool 卡片）。
3. `tool_execution_start` 与 `tool_execution_end` 几乎同时到达，卡片以
   “已完成”状态突然出现。

误以为 Electron 卡死、模型挂起，是这类长任务最常见的用户反馈。

**根因**：

pi-ai SDK 在 `message_update` 中实际已经发射了三个事件：

- `toolcall_start` —— 模型刚开始生成 tool call。
- `toolcall_delta` —— JSON 参数字符串的增量碎片，可累积成完整 args。
- `toolcall_end` —— 完整 `ToolCall` 对象（含已解析的 `arguments`）。

主进程 `pushEvent` 已经透传它们，但渲染进程 `useKnowClawPersist.jsx`
的 `message_update` 分支只处理了 `text_*` / `thinking_*`，
`toolcall_*` 全部落到默认分支被忽略，于是渲染端要等到下游
`tool_execution_start` 才知道有事发生。

**核心方案**：

1. **事件层**：在 `useKnowClawPersist.jsx` 的 `message_update` 中新增
   `toolcall_start/delta/end` 分支，并维护 `toolCallArgBufferRef`
   （`Map<toolCallId, string>`）累积 delta JSON 字符串。
2. **解析层**：新增 `desktop/src/ui/utils/partialJsonExtractor.js`，
   提供 `tryExtractWriteArgs` / `tryExtractEditArgs`：
   - 优先 `JSON.parse(buffer)`（完整时直接命中）。
   - 失败时用正则提取已经闭合的 `"path":"..."`。
   - 对 `"content":"` 后的内容做容错 unescape，按 JSON 字符串解码并在
     遇到未闭合转义时安全截断，避免渲染 `\n` 字面量。
3. **状态层**：在 ToolCallCard 中引入两个新状态：
   - `preparing`（紫色 Sparkles + 脉动）—— 对应 `toolcall_start..delta`。
   - `pending_exec`（琥珀色 Hourglass）—— 对应 `toolcall_end` 之后、
     `tool_execution_start` 之前的极短窗口。
4. **渲染层**：`FileChangePreview` 接受 `tool.partialArgs`，
   `WritePreview` 加入闪烁光标 + 自动滚动锚定，meta 行实时显示
   “生成中 · N 行 · M 字符”；`EditPreview` 在 edits 尚未到达时显示
   “正在生成编辑内容…”。
5. **兼容层**：`tool_execution_start` 改为：若该 `toolCallId` 已经有
   卡片，则就地把 `status` 升级为 `running` 并写入完整 `args`，避免
   出现两张卡片。保留旧的“无 toolcall_* 直接进入 tool_execution_start”
   的 fallback，兼容不支持 streaming tool input 的 provider。
6. **生命周期**：在 `agent_end` / `error` / `abort` / `newSession` /
   `history_loaded` 中清空 `toolCallArgBufferRef`，避免跨 turn 泄漏。

**涉及文件**：

- `desktop/src/ui/utils/partialJsonExtractor.js` (新增)
- `desktop/src/ui/hooks/useKnowClawPersist.jsx`
- `desktop/src/ui/components/agent-chat/MessageBubble.jsx`
- `desktop/src/ui/components/knowclaw-v2/FileChangePreview.jsx`

**与 R0 的关系（重要）**：

R4 与 R0（active assistant bubble 定位 bug）**有耦合但选择解耦先行**。

存在的潜在干扰场景：

1. 模型先 thinking。
2. `task_manager` 调用结束 → 在 messages 尾部插入 tasks 系统卡片。
3. 模型随后开始生成 `write` 的 toolcall_start。
4. 受 R0 影响，`ensureStreamingMessage` 在 tasks 之后**新建一个**
   assistant bubble，toolcall 卡片挂到新 bubble 上。
5. 实际预期是 toolcall 卡片应该挂在原 bubble（与 thinking 同一气泡）。

后果：toolcall 卡片显示位置不准，但**内容渲染完全正确**——用户依然
能看到“生成中…”和 partial content 实时增长，不会再出现“凭空等待”。
因此 R4 的核心价值（消除等待感）在 R0 修复前就能完整交付。

待 R0 落地后，toolcall 卡片会自动归位到正确的 bubble，无需再次改 R4。

**验证方式**：

1. 让 KnowClaw 执行 `write` 操作（例如“帮我生成一个 1000 行的 HTML 文件”）。
2. 预期：模型刚开始输出 tool call 时立即出现紫色 Sparkles 卡片，
   标签为“生成中…”。
3. 预期：path 提取出来后，卡片头部从“正在确定路径…”切换为
   “写入 xxx.html”。
4. 预期：FileChangePreview 中文件内容随 delta 增长，末尾有紫色闪烁光标，
   滚动自动跟到底部。
5. 预期：toolcall_end 到达后状态短暂变为琥珀色“即将执行”，
   随后 tool_execution_start 把它升级为蓝色 Loader2 “执行中…”，
   原卡片就地复用（不会出现两张卡片）。
6. 预期：tool_execution_end 后变为绿色 Check “完成”，partialArgs 被
   清空，args 接管渲染。
7. 历史恢复后：partialArgs 不参与持久化，重新进入时只看到 tool.args
   渲染（与现有行为一致，无 regression）。

**风险与边界**：

- R4.1：partial JSON 提取依赖模型按 `path → content` 顺序输出。
  pi-runtime 的 write schema 是这个顺序，主流 OpenAI/Anthropic 模型
  也按 schema 顺序生成；少数模型若调换字段顺序，path 会延迟出现但
  content 仍能解析，不会崩。
- R4.2：edit 的增量解析（partial edits[] 渲染）暂未实现，仅提取 path。
  原因是 `edits[].oldText/newText` 嵌套字符串解析复杂度显著高于 write，
  v1 收益小（edit 一般 content 量小）。如需可作为 R4.1 follow-up。
- R4.3：浮窗模式 `useFloatingKnowClaw.js` 暂不接入。浮窗代码注释本身
  就标注了“FK3 再加 tool_execution_update 类增强”，跟 R4 同理后置。

---

## 7. 推荐实施顺序

| 优先级 | 阶段 | 原因 |
|---|---|---|
| P0 | R4 | 消除“写文件凭空等待”的最强用户感知问题，已与 R0 解耦先行 |
| P0 | R0 | 直接修复重复 thinking / 正文，是最明显 bug |
| P1 | R2 | 降低 task_manager 对 transcript 的干扰 |
| P2 | R1 | 统一实时与恢复路径，需要更多设计判断 |
| P3 | R3 | 完整 timeline 属于增强功能 |

---

## 8. 当前排查涉及的关键代码点

| 文件 | 关键点 |
|---|---|
| `desktop/src/ui/hooks/useKnowClawPersist.jsx` | 实时事件处理；`thinking_delta` / `text_delta` 使用累计 buffer 更新消息；`task_manager` 结束时追加 `kind:'tasks'` |
| `desktop/src/ui/components/knowclaw-v2/knowclawEventReducer.js` | `ensureStreamingMessage()` 只检查最后一条消息，是重复显示的直接触发点 |
| `desktop/src/main/ipc/knowclaw.js` | `mapPiMessagesForRenderer()` 历史映射路径；`extractLatestTasksEntry()` 只恢复最新任务快照 |
| `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx` | 渲染 `messages.map()`；只把 heartbeat 传给最后一条 streaming assistant |
| `desktop/src/ui/components/agent-chat/MessageBubble.jsx` | assistant bubble 同时渲染 thinking、content、tools；tasks 作为独立 `kind:'tasks'` 分支渲染 |

---

## 9. 复现用例

推荐使用会触发多阶段任务和 task_manager 的任务，例如：

```text
根据 @租赁合同审核思维报告.md，做出一份 PPT 报告。
```

预期实时事件链：

1. `agent_start`
2. `thinking_delta`
3. `tool_execution_start(task_manager)`
4. `tool_execution_end(task_manager)` → 插入任务卡片
5. 后续 `thinking_delta` / `text_delta`

当前 bug 触发点在第 5 步：如果第 4 步已经把任务卡片插入到 messages 末尾，第 5 步会错误创建新的 assistant bubble，并显示累计 buffer。

---

## 10. 暂定验收标准

R0 修复后应满足：

- 同一轮 agent turn 中，无论穿插多少 task/tool 卡片，thinking 只显示一份。
- 同一轮 agent turn 中，正文只在一个 assistant bubble 内持续增长，不重复开新 bubble。
- `task_manager` 仍能实时显示任务进度。
- tool 卡片仍能更新 running/done/error 状态。
- 退出再进入后，主体内容与实时结束时一致；允许旧任务快照按设计折叠或只保留最新。

---

## 11. 变更日志

- **2026-05-29**：首次记录用户反馈现象与排查结论；确认重复显示来自实时 renderer 状态管理，历史恢复路径会自然清理重复临时结构；提出 R0–R3 后续优化阶段。
- **2026-05-29**（追加）：新增 Phase R4（ToolCall 参数流式渲染），按用户决定与 R0 解耦先行实现；落地内容覆盖：`partialJsonExtractor.js` 新增、`useKnowClawPersist.jsx` 增加 `toolcall_start/delta/end` 三个 message_update 子分支与 `toolCallArgBufferRef`、`tool_execution_start` 兼容已有卡片、`MessageBubble.jsx` 引入 `preparing` / `pending_exec` 两个新状态、`FileChangePreview.jsx` 支持 `partialArgs` 渲染并加入闪烁光标与自动滚动锚定。R0 的潜在干扰在 R4 文档中明确记录，留待后续修复。

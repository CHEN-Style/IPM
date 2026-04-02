# AI 暂存区增强：实时流水线 + 详细推理链路

## 0. 概述

为 AI 暂存区新增两大功能：
1. **实时分类流水线状态面板**：动态展示待分类/正在分类/已分类文件数
2. **详细版本视图**：点击后展示每个文件的完整 AI 推理链路（Tool 调用、返回结果、推理过程、最终决策）

## 现状分析

当前架构中，文件上传后 `triggerAutoClassifyToAiStorage` 以 fire-and-forget 方式运行分类，前端通过延迟 700ms/1500ms 的 `refreshGhosts()` 轮询拉取结果。存在两个痛点：

1. **无实时进度**：用户上传 5 个文件后，不知道哪些在排队、哪些正在分类、哪些已完成
2. **无推理透明度**：Agent 可能调用了 3-5 个 Tool 进行多步推理，但用户只看到最终结果

---

## 功能一：实时分类流水线

### 1.1 后端：分类状态追踪器

在 main 进程新建 `ClassifyTracker`，追踪每个文件的分类阶段，并通过 IPC 事件推送到渲染进程。

**新建文件**: `desktop/src/main/classifyTracker.js`

```javascript
// 核心状态: queued → classifying → classified | failed
// 每次状态变更通过 BrowserWindow.webContents.send('classify:status-changed', snapshot) 推送
class ClassifyTracker {
  #items = new Map(); // key: `${projectName}::${sourceRelPath}`
  #getWindows;        // () => BrowserWindow[] 获取所有窗口
  
  trackQueued(projectName, sourceRelPath, fileName) { ... }
  trackClassifying(projectName, sourceRelPath) { ... }
  trackClassified(projectName, sourceRelPath, result) { ... }
  trackFailed(projectName, sourceRelPath, error) { ... }
  getSnapshot(projectName) { ... } // 返回 { queued, classifying, classified, failed }
  clearCompleted(projectName) { ... }
}
```

- 每个 item 结构: `{ projectName, sourceRelPath, fileName, stage, startedAt, completedAt, result?, error? }`
- 状态变更时广播 `classify:status-changed` 事件到所有 BrowserWindow
- 已完成/失败的条目在 30 秒后自动清理（或手动 clear）

### 1.2 集成到分类流程

**修改文件**: `desktop/src/main.js` 中的 `triggerAutoClassifyToAiStorage`

```javascript
// 在函数开头：
classifyTracker.trackQueued(projectName, sourceRelPath, fileName);

// 在 classifyFile 调用前：
classifyTracker.trackClassifying(projectName, sourceRelPath);

// 在 upsertAiSuggestion 调用后：
classifyTracker.trackClassified(projectName, sourceRelPath, { targetRelPath, confidence });

// 在 catch 中：
classifyTracker.trackFailed(projectName, sourceRelPath, msg);
```

同时需要在 `registerFloatingIpc` 时传入 `classifyTracker` 实例，因为 `copyToTemp` 触发分类时需要标记 queued。

### 1.3 IPC 通道

**新增 IPC**（在 main.js 或独立文件中注册）：

- `classify:getSnapshot` — 渲染进程主动拉取当前流水线快照
- `classify:clearCompleted` — 清除已完成项

**Preload 暴露**:

```javascript
classify: {
  getSnapshot: (projectName) => ipcRenderer.invoke('classify:getSnapshot', { projectName }),
  clearCompleted: (projectName) => ipcRenderer.invoke('classify:clearCompleted', { projectName }),
  onStatusChanged: (callback) => {
    ipcRenderer.on('classify:status-changed', (_e, data) => callback(data));
    return () => ipcRenderer.removeListener('classify:status-changed', callback);
  },
}
```

### 1.4 前端 Hook

**新建文件**: `desktop/src/ui/components/project-manager/hooks/useClassifyPipeline.js`

```javascript
// 监听 classify:status-changed 事件，维护 pipeline 状态
// 返回: { queued, classifying, classified, failed, totalActive, isActive }
// isActive = totalActive > 0 时显示流水线面板
```

### 1.5 前端组件：流水线面板

**新建文件**: `desktop/src/ui/components/project-manager/ClassifyPipeline.jsx`

设计要点：

- 位于 `AIGhostOverview` 上方，仅在 `isActive` 时渲染
- 三列布局，用箭头连接：`📥 待分类 (N)` → `⚙️ 正在分类 (N)` → `✅ 已分类 (N)`
- 每列下方列出文件名（最多显示 3 个 + "还有 N 个"）
- 正在分类列带脉冲动画（`animate-pulse`）
- 已分类列显示目标文件夹和置信度
- 整体风格：紧凑的卡片，配合 `bg-gradient` 从蓝到绿的流水线感
- 可折叠：默认展开，点击可收起只显示汇总行

```
┌──────────────────────────────────────────────────────────────────────┐
│  🔄 AI 分类进行中                                          [收起 ▲] │
│                                                                      │
│  ┌─── 待分类 (3) ───┐   ┌─ 正在分类 (1) ─┐   ┌── 已分类 (2) ──┐   │
│  │  file3.pdf        │──▶│  document.pdf   │──▶│  合同.pdf → 收到 │   │
│  │  file4.docx       │   │  ◔ 分析中...    │   │  报告.xlsx → 调研│   │
│  │  file5.jpg        │   │                 │   │                  │   │
│  └───────────────────┘   └─────────────────┘   └──────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 功能二：详细推理链路视图

### 2.1 后端：捕获完整 Trace

**修改文件**: `desktop/Agent/classifier/agent.js`

当前 `runClassifyAgent` 已经通过 `extractToolCalls` 和 `extractToolResults` 提取了 tool 调用信息，但只用于 console.log。需要增强为捕获完整 trace：

```javascript
function extractFullTrace(messages) {
  const steps = [];
  for (const m of messages) {
    const type = m._getType?.();
    if (type === 'ai') {
      // AI 推理步骤（思考过程）
      if (m.content && typeof m.content === 'string' && m.content.trim()) {
        steps.push({ type: 'reasoning', content: m.content, timestamp: Date.now() });
      }
      // Tool 调用决策
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          steps.push({ type: 'tool-call', name: tc.name, args: tc.args, timestamp: Date.now() });
        }
      }
    } else if (type === 'tool') {
      // Tool 返回结果（完整内容，不截断）
      steps.push({ 
        type: 'tool-result', 
        name: m.name, 
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        timestamp: Date.now() 
      });
    }
  }
  return steps;
}
```

返回值新增 `trace` 字段。

**修改文件**: `desktop/Agent/classifier/index.js`

`classifyFile` 函数需要为快速通道和 Agent 路径都生成 trace：

- 快速通道：trace 只有一步 `{ type: 'fast-path', rule: '...', timestamp }`
- Agent 路径：trace 包含完整的 tool 调用链

### 2.2 存储 Trace

**修改文件**: `desktop/src/main.js`

在 `triggerAutoClassifyToAiStorage` 中，将 trace 存入 suggestion：

```javascript
const written = upsertAiSuggestion(projectDir, projectName, {
  // ...现有字段...
  trace: decision.trace || [],  // 新增
});
```

trace 存在 ai-storage.json 的 suggestion 对象中。虽然会增加文件大小，但桌面应用场景下数据量可控（每个文件的 trace 约 1-5KB）。

### 2.3 IPC 通道

**新增 IPC**:

- `aiStorage/getTrace` — 根据 sourceRelPath 获取某个 suggestion 的 trace

```javascript
ipcMain.handle('aiStorage/getTrace', async (_evt, payload) => {
  const { projectDir } = getWorkspaceDirOrThrow(payload?.projectName, payload?.domain);
  const items = listAiSuggestions(projectDir, payload?.projectName, {});
  const s = items.find(x => x.sourceRelPath === payload?.sourceRelPath);
  return { ok: true, trace: s?.trace || [], suggestion: s };
});
```

**Preload 暴露**:

```javascript
aiStorage: {
  // ...现有方法...
  getTrace: (projectName, sourceRelPath, opts) => 
    ipcRenderer.invoke('aiStorage/getTrace', { projectName, sourceRelPath, ...opts }),
}
```

### 2.4 前端：EntryTable 增加"查看处理过程"按钮

**修改文件**: `desktop/src/ui/components/project-manager/EntryTable.jsx`

在 ghost 行的操作按钮区域（接受/放弃旁边）新增一个"查看过程"按钮：

```jsx
<button onClick={() => onViewTrace?.(e._ghost?.sourceRelPath)} title="查看 AI 分类过程">
  <Search size={12} /> 过程
</button>
```

同时已分类（accepted）的文件也应该能查看历史 trace，但这属于远期功能，当前只在 ghost 行（pending 状态）显示。

### 2.5 前端组件：推理链路详情页

**新建文件**: `desktop/src/ui/components/project-manager/ClassifyTraceView.jsx`

以 Modal 或侧边面板形式展示，设计要点：

```
┌─────────────────────────────────────────────────────────────┐
│  📋 AI 分类过程：document(3).pdf                    [关闭 ✕] │
│─────────────────────────────────────────────────────────────│
│                                                              │
│  ● 结论                                                      │
│  ├─ 目标文件夹: 收到资料                                      │
│  ├─ 置信度: 82%  ████████░░                                  │
│  ├─ 分类方式: Agent (调用了 3 个工具)                         │
│  └─ 理由: 来源为微信律师发送，历史同类文件均归入收到资料        │
│                                                              │
│  ● 推理过程                                                   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Step 1  🔧 browse_project_structure                  │    │
│  │ Agent 决定先了解项目的文件夹结构                       │    │
│  │ ┌─ 返回结果 ──────────────────────────────────────┐  │    │
│  │ │ 收到资料 (23 个文件) - 客户/对方提供的原始材料    │  │    │
│  │ │ 过程文档 (15 个文件) - 办案过程中产生的工作文档   │  │    │
│  │ │ 调研研究 (8 个文件) - 法律调研、案例分析          │  │    │
│  │ │ 交付成果 (3 个文件) - 最终交付给客户的文件        │  │    │
│  │ └────────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Step 2  🔧 get_file_source_info                      │    │
│  │ Agent 检查文件来源以推断性质                          │    │
│  │ ┌─ 返回结果 ──────────────────────────────────────┐  │    │
│  │ │ 来源路径: C:/Users/.../微信/某律师发来/          │  │    │
│  │ │ 来源目录: WeChat Files                           │  │    │
│  │ └────────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Step 3  🔧 query_classification_history              │    │
│  │ Agent 查找类似文件的历史分类记录                       │    │
│  │ ┌─ 返回结果 ──────────────────────────────────────┐  │    │
│  │ │ document(1).pdf → 收到资料 (已接受)              │  │    │
│  │ │ document(2).pdf → 收到资料 (已接受)              │  │    │
│  │ └────────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 💭 最终推理                                          │    │
│  │ 来源是微信律师发送 + 历史上同类文件都放了"收到资料"，  │    │
│  │ 我比较有信心了。                                      │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ⚡ 快速通道命中时：                                         │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ ⚡ 快速通道匹配                                      │    │
│  │ 规则: 文件名包含"合同" → 收到资料                     │    │
│  │ 置信度: 95%                                          │    │
│  │ 未调用 LLM，零延迟                                   │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

组件设计：

- 使用 **垂直时间线** 布局，每个 step 是时间线上的一个节点
- Tool 调用节点：蓝色图标，显示工具名、参数、返回结果（可折叠）
- 推理节点：紫色图标，显示 AI 的思考内容
- 结论节点：绿色图标，显示最终决策
- 快速通道：闪电图标，只有一个节点，表示规则匹配
- 整体使用 Modal Dialog 弹出

### 2.6 Trace 展示 Hook

**新建文件**: `desktop/src/ui/components/project-manager/hooks/useTraceView.js`

```javascript
// 管理 trace 弹窗的开关状态和数据加载
// openTrace(sourceRelPath) — 加载 trace 并打开弹窗
// closeTrace() — 关闭弹窗
// { traceOpen, traceData, traceLoading }
```

---

## 集成点汇总

### 需要修改的现有文件

- `desktop/src/main.js` — 创建 ClassifyTracker 实例；修改 triggerAutoClassifyToAiStorage 添加状态追踪和 trace 存储
- `desktop/Agent/classifier/agent.js` — 新增 extractFullTrace，返回 trace 字段
- `desktop/Agent/classifier/index.js` — classifyFile 返回值新增 trace
- `desktop/src/main/ipc/aiStorage.js` — 新增 aiStorage/getTrace IPC
- `desktop/src/ui/components/project-manager/EntryTable.jsx` — ghost 行新增"查看过程"按钮
- `desktop/src/ui/components/ProjectManager.jsx` — 集成 useClassifyPipeline 和 useTraceView，传递 props
- `desktop/preload.js`（或等效文件）— 新增 classify 和 aiStorage.getTrace 暴露

### 需要新建的文件

- `desktop/src/main/classifyTracker.js` — 分类流水线状态追踪器
- `desktop/src/ui/components/project-manager/ClassifyPipeline.jsx` — 流水线面板 UI
- `desktop/src/ui/components/project-manager/ClassifyTraceView.jsx` — 推理链路详情弹窗
- `desktop/src/ui/components/project-manager/hooks/useClassifyPipeline.js` — 流水线状态 Hook
- `desktop/src/ui/components/project-manager/hooks/useTraceView.js` — Trace 弹窗状态 Hook

---

## 开发顺序

建议按以下顺序逐步实施，每步完成后可独立验证：

### Phase A: Trace 捕获与存储（后端优先） ✅

- [x] 修改 agent.js 捕获完整 trace
- [x] 修改 classifier/index.js 传递 trace
- [x] 修改 fastPath.js 在快速通道结果中携带 trace
- [x] 修改 main.js 存储 trace 到 ai-storage.json
- [x] 新增 aiStorage/getTrace IPC + preload

**开发总结：**

**1. `Agent/classifier/agent.js`**
- 新增 `extractFullTrace(messages)` 函数，从 LangGraph Agent 的完整 messages 数组中提取详细推理链路
- Trace step 类型：
  - `tool-call`：Agent 决定调用某个 Tool（包含 name、args、ts）
  - `tool-result`：Tool 返回结果（包含 name、content 完整内容、ts）
  - `reasoning`：AI 的推理文本（最终输出的 JSON 结论也会被捕获）
- 在 `runClassifyAgent` 的返回值中新增 `trace` 字段
- 保留了原有的 `extractToolCalls` 和 `extractToolResults`（用于 console.log 日志，不影响现有日志输出）

**2. `Agent/classifier/fastPath.js`**
- 在 `matchRules` 的返回值中新增 `trace` 数组
- 快速通道 trace 只有一个 step，类型为 `fast-path`，包含 rule（命中的正则或扩展名）、target、rationale
- 让前端能区分快速通道和 Agent 两种路径的展示方式

**3. `Agent/classifier/index.js`**
- 快速通道命中时，将 `fastResult.trace` 透传到返回值
- Agent 路径无需修改，`runClassifyAgent` 已自带 `trace`

**4. `main.js`**
- `triggerAutoClassifyToAiStorage` 中 `upsertAiSuggestion` 调用新增 `trace: decision.trace || []`
- trace 数据直接存储在 ai-storage.json 的每个 suggestion 对象中

**5. `main/ipc/aiStorage.js`**
- 新增 `aiStorage/getTrace` IPC 通道
- 根据 projectName + sourceRelPath 查找对应的 suggestion，返回 trace 数组和 suggestion 摘要
- 返回的 suggestion 摘要只包含展示所需字段（不返回 trace 本身的冗余拷贝）

**6. `preload.js`**
- `aiStorage` 对象新增 `getTrace(projectName, sourceRelPath, opts)` 方法
- 渲染进程可通过 `window.ipm.aiStorage.getTrace(projectName, sourceRelPath)` 获取 trace 数据

**Trace 数据结构示例（Agent 路径）：**

```json
[
  { "type": "tool-call", "name": "browse_project_structure", "args": {}, "ts": 1710000001 },
  { "type": "tool-result", "name": "browse_project_structure", "content": "[{\"relPath\":\"收到资料\",...}]", "ts": 1710000002 },
  { "type": "tool-call", "name": "get_file_source_info", "args": {"sourceRelPath":"temp/doc.pdf"}, "ts": 1710000003 },
  { "type": "tool-result", "name": "get_file_source_info", "content": "{\"sourcePath\":\"C:/Users/.../微信/...\"}", "ts": 1710000004 },
  { "type": "tool-call", "name": "query_classification_history", "args": {"fileName":"doc.pdf","ext":"pdf"}, "ts": 1710000005 },
  { "type": "tool-result", "name": "query_classification_history", "content": "[...]", "ts": 1710000006 },
  { "type": "reasoning", "content": "{\"targetRelPath\":\"收到资料\",\"confidence\":0.82,\"rationale\":\"来源为微信...\"}", "ts": 1710000007 }
]
```

**Trace 数据结构示例（快速通道）：**

```json
[
  { "type": "fast-path", "rule": "/合同|协议|agreement|contract/i", "target": "收到资料", "rationale": "文件名匹配快速通道规则（关键词命中）", "ts": 1710000001 }
]
```

### Phase B: 详细推理视图（前端） ✅

- [x] 新建 useTraceView hook
- [x] 新建 ClassifyTraceView 弹窗组件
- [x] 修改 EntryTable 添加"查看过程"按钮
- [x] 修改 ProjectManager 集成

**开发总结：**

**1. `hooks/useTraceView.js`（新建）**
- 管理 trace 弹窗的开关状态和数据加载
- `openTrace(sourceRelPath)` — 调用 `window.ipm.aiStorage.getTrace()` 加载数据并打开弹窗
- `closeTrace()` — 关闭弹窗并清空数据
- 返回 `{ traceOpen, traceLoading, traceData, openTrace, closeTrace }`
- 错误处理：加载失败时 traceData 包含 error 字段，弹窗中展示错误信息

**2. `ClassifyTraceView.jsx`（新建）**
- Modal 弹窗，z-index=100，点击遮罩层关闭
- 两大区域：
  - **结论卡片**：目标文件夹、置信度（百分比 + 进度条）、分类方式（快速通道/Agent + 工具数量）、理由
  - **推理过程时间线**：垂直时间线布局，每个 step 是一个节点
- 时间线节点类型：
  - `fast-path`（琥珀色闪电图标）：快速通道命中，显示规则和目标
  - `tool-call`（蓝色扳手图标）：Agent 调用 Tool，显示工具名中文描述 + 原始名称 + 参数
  - `tool-result`（灰色搜索图标）：Tool 返回结果，可折叠展示，长内容默认折叠
  - `reasoning`（紫色对话图标）：AI 推理文本，白色卡片展示
- 时间线末尾有绿色终端节点「分类完成」
- Tool 结果智能渲染：尝试 JSON 解析，数组逐项展示，对象按字段展示，纯文本原样展示
- 内置 5 个 Tool 的中文名称映射（browse_project_structure → 浏览项目文件夹结构 等）
- 置信度颜色分级：≥85% 绿色，50%-85% 琥珀色，<50% 红色
- 兼容旧数据：trace 为空时显示「暂无推理过程数据」

**3. `EntryTable.jsx`（修改）**
- 新增 `Search` icon 导入和 `onViewTrace` prop
- Ghost 行操作区域新增「过程」按钮（紫色边框风格），点击调用 `onViewTrace(sourceRelPath)`
- 按钮排列顺序：接受 → 放弃 → 过程

**4. `ProjectManager.jsx`（修改）**
- 新增 `useTraceView` hook 和 `ClassifyTraceView` 组件的导入
- 在 hooks 区域初始化 `useTraceView({ cwd, domainOpts })`
- 将 `openTrace` 作为 `onViewTrace` 传递给 `EntryTable`
- 在组件末尾（context menu 之后）渲染 `ClassifyTraceView` 弹窗

### Phase C: 流水线状态追踪（后端） ✅

- [x] 新建 ClassifyTracker
- [x] 修改 main.js 集成 tracker + 注册 IPC
- [x] 修改 preload 暴露 classify API

**开发总结：**

**1. `src/main/classifyTracker.js`（新建）**
- `ClassifyTracker` 类，使用 ES private fields（`#items`、`#clearTimers`）
- 追踪每个文件经过 4 个阶段：`queued → classifying → classified | failed`
- 核心方法：
  - `trackQueued(projectName, sourceRelPath, fileName)` — 文件进入队列
  - `trackClassifying(projectName, sourceRelPath)` — 开始分类（调用 classifyFile 前）
  - `trackClassified(projectName, sourceRelPath, result)` — 分类完成
  - `trackFailed(projectName, sourceRelPath, error)` — 分类失败
  - `getSnapshot(projectName)` — 返回 `{ queued[], classifying[], classified[], failed[] }`
  - `clearCompleted(projectName)` — 手动清除已完成/失败条目
- 每次状态变更时，通过 `BrowserWindow.getAllWindows()` 遍历所有窗口，调用 `webContents.send('classify:status-changed', snapshot)` 广播
- 已完成/失败的条目 30 秒后自动清理（`setTimeout`），清理后再次广播以更新 UI
- 每个 item 结构：`{ projectName, sourceRelPath, fileName, stage, queuedAt?, classifyingAt?, completedAt?, result?, error? }`

**2. `main.js`（修改）**
- 顶部新增 `import { ClassifyTracker } from './main/classifyTracker.js'`
- 在 `triggerAutoClassifyToAiStorage` 函数之前创建单例 `const classifyTracker = new ClassifyTracker()`
- 函数内部 4 个追踪点：
  1. 函数开头：`trackQueued` — 文件进入时立即标记排队
  2. `classifyFile` 调用前：`trackClassifying` — 标记开始分类
  3. `upsertAiSuggestion` 调用后：`trackClassified` — 分类成功，携带 `{ targetRelPath, confidence }`
  4. `catch` 块中：`trackFailed` — 分类失败，携带错误信息
  5. 无候选文件夹时也调用 `trackFailed`
- 新增 2 个 IPC 通道（在 `registerAiStorageIpc` 之后注册）：
  - `classify:getSnapshot` — 渲染进程主动拉取当前流水线快照
  - `classify:clearCompleted` — 清除已完成条目

**3. `preload.js`（修改）**
- 新增 `classify` 命名空间，暴露 3 个方法：
  - `getSnapshot(projectName)` — invoke `classify:getSnapshot`
  - `clearCompleted(projectName)` — invoke `classify:clearCompleted`
  - `onStatusChanged(callback)` — 监听 `classify:status-changed` 事件，返回 cleanup 函数用于取消监听

### Phase D: 流水线面板（前端） ✅

- [x] 新建 useClassifyPipeline hook
- [x] 新建 ClassifyPipeline 组件
- [x] 修改 ProjectManager 集成

**开发总结：**

**1. `hooks/useClassifyPipeline.js`（新建）**
- 监听 `classify:status-changed` IPC 事件，实时维护流水线状态
- 初始化时通过 `classify:getSnapshot` 主动拉取一次当前快照
- 当 `cwd` 切换到非项目视图时，重置为空状态
- 返回 `{ queued, classifying, classified, failed, totalActive, isActive, clearCompleted }`
- `isActive` 为 true 时流水线面板才渲染
- `clearCompleted()` 调用后端清除已完成/失败条目
- 通过 `onStatusChanged` 返回的 cleanup 函数在 `useEffect` 卸载时取消监听

**2. `ClassifyPipeline.jsx`（新建）**
- 仅在 `isActive` 时渲染
- 可折叠卡片，默认展开
- Header 区域：旋转的 Loader2 图标 + "AI 分类进行中" + 处理中/已完成计数 + 清除按钮 + 折叠按钮
- 三列流水线布局，用箭头 `→` 连接：
  - **待分类**（Clock 图标，灰色边框）：显示排队中的文件名列表
  - **正在分类**（旋转 Loader2 图标，蓝色边框）：文件名 + "分析中..." 脉冲动画
  - **已分类**（CheckCircle2 图标，绿色边框）：文件名 + 目标文件夹名；失败项以红色分隔区域展示
- 每列最多显示 3 个文件名，超出显示 "+N 个文件"
- 整体使用 `bg-gradient-to-r from-blue-50 via-indigo-50 to-emerald-50` 渐变背景，体现流水线方向感
- 样式与现有 AIGhostOverview 视觉一致

**3. `ProjectManager.jsx`（修改）**
- 新增 `useClassifyPipeline` 和 `ClassifyPipeline` 的导入
- 在 hooks 区域初始化 `useClassifyPipeline({ cwd })`
- `ClassifyPipeline` 渲染在 `AIGhostOverview` 之上，非根视图时显示
- 传递 `queued`、`classifying`、`classified`、`failed`、`isActive`、`onClearCompleted` props

# Agent 核心开发文档（文件智能分类系统）

## 0. 背景与定位

IPM 的文件管理是产品最核心的拳头功能。当前的 AI 分类模块虽然名为"Agent"，但实质只是一个单次 LLM 调用（拼 Prompt → 调一次 LLM → 拿 JSON），不具备真正的 Agent 能力。

本文档定义了新一代文件分类 Agent 的完整设计方案，目标是构建一个 **最可信赖、同时足够智能** 的 Agent 系统。

### 核心设计原则

1. **可信赖优先于炫技**：律师的工作文件敏感且重要，Agent 的首要目标是准确和安全
2. **越用越准**：从用户的 accept/reject 反馈中持续学习，形成正向飞轮
3. **知道自己不确定**：有 confidence 输出，不确定时坦诚告知而非硬猜
4. **该快则快**：能用规则解决的不调 LLM，降低成本和延迟
5. **该深则深**：面对模糊文件时，Agent 能自主收集更多信息来辅助判断

### 保持不变的设计

以下是已验证的好设计，新架构将完全保留：

- **暂存区（ai-storage.json）**：pending/accepted/rejected 状态机
- **幽灵文件（Ghost Files）**：中台展示 AI 建议，类似 IDE 的 Accept/Reject
- **安全护栏**：禁止归档到 system 目录、只允许从 temp 移动、输出必须在候选列表中
- **原子写入**：先写 tmp 再 rename，防止文件损坏

---

## 1. 场景分析：什么时候需要 Agent？

| 场景 | 不确定性 | 需要 Agent？ | 说明 |
|---|---|---|---|
| 用户上传 `合同-王某某.pdf` | 几乎没有 | 不需要 | 文件名已说明一切，规则即可处理 |
| 用户上传 `document(3).pdf` | 很高 | **需要** | Agent 应主动查来源、查历史、看文件夹已有内容 |
| 用户一次拖入 8 个文件 | 中等 | **需要** | Agent 应先做整体规划，理解文件间关联 |
| 项目积累大量文件后 | 可能需要重新组织 | **需要** | Agent 能审视整体结构并给出建议（远期） |

**结论**：不是每次都需要 Agent，但真正难的 case 确实需要 Agent 的自主信息收集能力。正确的设计是——**Agent 的智能体现在"知道什么时候该深入调查"**。

---

## 2. 整体架构：快速通道 + Tool-Calling Agent

### 2.1 架构总览

```
文件进入 temp/
     │
     ▼
┌────────────────────────────────────────────────────────────┐
│                    快速通道 Pre-check                       │
│                    （无 LLM，0ms）                          │
│                                                            │
│  ① 用户自定义规则命中？ → 直接建议，confidence=0.95        │
│  ② 历史中有 5+ 次 accept 且 0 reject 的相同模式？          │
│     → 直接建议，confidence=历史胜率                         │
│                                                            │
│  如果命中 → 写入 ai-storage.json，classifiedBy="fast-path" │
│  如果未命中 → 进入 Agent ↓                                 │
└────────────────────┬───────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────┐
│              LangChain Tool-Calling Agent                   │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    System Prompt                      │  │
│  │  角色 + 工作流程 + 输出格式 + few-shot               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  Agent 收到文件信息后，自主决定调用哪些 Tool：              │
│                                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ browse      │  │ query       │  │ inspect     │       │
│  │ _structure  │  │ _history    │  │ _folder     │       │
│  │             │  │             │  │ _contents   │       │
│  │ 读取项目    │  │ 查过往      │  │ 看目标文件夹│       │
│  │ 文件夹结构  │  │ accept/     │  │ 里已有什么  │       │
│  │ 和描述      │  │ reject记录  │  │ 文件        │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                            │
│  ┌─────────────┐  ┌─────────────┐                         │
│  │ get_source  │  │ get_user    │                         │
│  │ _info       │  │ _rules      │                         │
│  │             │  │             │                         │
│  │ 获取文件    │  │ 获取用户    │                         │
│  │ 原始来源    │  │ 自定义规则  │                         │
│  └─────────────┘  └─────────────┘                         │
│                                                            │
│  Agent 自主推理后输出 Structured JSON：                     │
│  { targetRelPath, confidence, rationale,                   │
│    renameSuggestion? }                                     │
│                                                            │
│  护栏：                                                    │
│  - 最多 5 次 tool call（防止死循环）                       │
│  - 输出必须在候选文件夹列表中                              │
│  - 整体超时 15s                                            │
│  - confidence < 0.5 时标记为"需用户手动决定"               │
└────────────────────┬───────────────────────────────────────┘
                     │
                     ▼
            写入 ai-storage.json
          （现有暂存区设计不变）
```

### 2.2 设计哲学

> Agent 的智能不在于"调用更多次 LLM"，而在于**拥有正确的工具**，并且**知道什么时候该用哪个工具**。

现代 LangChain 的 Tool-Calling Agent 使用模型原生的 function calling 能力——模型自己决定调用哪些工具、以什么顺序调用、调用几次。这比老的 ReAct 字符串解析更可靠。

---

## 3. 快速通道（Fast Path）

快速通道负责处理 60-70% 的"显而易见"的文件，零延迟、零成本、100% 确定性。

### 3.1 规则引擎

```javascript
// 示例规则（可由用户在设置中自定义）
const rules = [
  { pattern: /合同|协议|agreement|contract/i, target: '收到资料', confidence: 0.95 },
  { pattern: /会议纪要|meeting.*minutes/i,    target: '过程文档', confidence: 0.92 },
  { pattern: /研究|调研|分析|report|analysis/i, target: '调研研究', confidence: 0.88 },
  { pattern: /交付|final|deliverable|成果/i,   target: '交付成果', confidence: 0.90 },
  // 扩展名规则
  { ext: ['xmind', 'mindmap'],                 target: '调研研究', confidence: 0.85 },
];
```

对律师场景来说，文件命名有很强的规律性（合同/诉状/判决书/证据清单...），纯规则就能覆盖大量日常文件。

### 3.2 历史匹配

从 `preference-history.json` 中查找用户过去对类似文件名模式的分类决策：

- 如果某个模式有 5+ 次 accept 且 0 次 reject → confidence = accept率，直接建议
- 如果某个模式有 reject 记录 → 不走快速通道，交给 Agent 深入判断

### 3.3 快速通道触发条件

```
命中快速通道的条件（满足任一即可）：
  ① 用户自定义规则匹配 → confidence ≥ 0.9
  ② 历史模式匹配，accept ≥ 5 且 reject = 0 → confidence = 历史胜率

未命中 → 进入 LangChain Agent
```

---

## 4. 五个 Tool 的详细设计

Tool 的质量决定了 Agent 的上限。所有 Tool 都是**只读的**——Agent 不具备任何文件操作能力，只做信息收集和决策。

### Tool 1: `browse_project_structure`

```javascript
{
  name: "browse_project_structure",
  description: "浏览当前项目的文件夹结构，了解每个文件夹的用途描述和已有文件数量",
  parameters: {},  // 无参数，固定读当前项目
  returns: [
    { relPath: "收到资料", description: "客户/对方提供的原始材料", fileCount: 23 },
    { relPath: "过程文档", description: "办案过程中产生的工作文档", fileCount: 15 },
    { relPath: "调研研究", description: "法律调研、案例分析", fileCount: 8 },
    { relPath: "交付成果", description: "最终交付给客户的文件", fileCount: 3 },
  ]
}
```

**为什么重要**：Agent 不是一开始就知道文件夹结构的，而是主动去查的。不同项目可能有不同的文件夹结构（比如学习空间有完全不同的子目录），Agent 需要每次都了解当前项目的实际情况。

### Tool 2: `query_classification_history`

```javascript
{
  name: "query_classification_history",
  description: "查询用户过去对类似文件的分类决策记录（accept/reject），用于理解用户偏好",
  parameters: {
    fileName: "string - 当前文件名，用于模糊匹配历史记录",
    ext: "string - 文件扩展名"
  },
  returns: [
    { 
      fileName: "合同-李某.pdf", 
      classifiedTo: "收到资料", 
      userAction: "accepted",
      timestamp: "2026-03-01"
    },
    {
      fileName: "合同修改意见.docx",
      classifiedTo: "收到资料",
      userAction: "rejected",    // 用户拒绝了——说明"修改意见"类不该放收到资料
      userMovedTo: "过程文档",   // 用户最终手动放到了这里
      timestamp: "2026-03-05"
    }
  ]
}
```

**为什么是关键差异化能力**：市面上绝大多数同类工具都没有这个能力——从用户的纠正行为中学习。当 Agent 看到"用户之前拒绝了把'修改意见'放到'收到资料'"，它下次就不会犯同样的错误。

### Tool 3: `inspect_folder_contents`

```javascript
{
  name: "inspect_folder_contents",
  description: "查看指定文件夹中已有的文件列表，帮助判断新文件是否属于这个文件夹",
  parameters: {
    folderRelPath: "string - 要查看的文件夹相对路径"
  },
  returns: [
    { name: "起诉状.pdf", addedAt: "2026-02-15" },
    { name: "证据清单.xlsx", addedAt: "2026-02-20" },
    { name: "合同原件-扫描.pdf", addedAt: "2026-03-01" },
  ]
}
```

**为什么有价值**：当 Agent 犹豫一个文件该放"收到资料"还是"调研研究"时，它可以去看看这两个文件夹里都有什么。如果"收到资料"里全是合同、起诉状、证据——那一个"案例分析报告"显然不该放这里。**这是人类整理文件时的自然行为——看看文件夹里已经有什么，才能判断新文件适不适合放进去。**

### Tool 4: `get_file_source_info`

```javascript
{
  name: "get_file_source_info",
  description: "获取文件的原始来源路径，帮助推断文件性质",
  parameters: {
    sourceRelPath: "string - 文件在 temp/ 中的相对路径"
  },
  returns: {
    sourcePath: "C:/Users/xxx/WeChat Files/某律所群/合同文件.pdf",
    sourceDir: "C:/Users/xxx/WeChat Files/某律所群/",
    capturedAt: "2026-03-09T10:30:00Z"
  }
}
```

**价值**：来源路径隐含了大量信息。来自微信的大概率是"收到资料"，来自桌面编辑器目录的大概率是"过程文档"，来自浏览器下载且路径含 research 的大概率是"调研研究"。

### Tool 5: `get_user_rules`

```javascript
{
  name: "get_user_rules",
  description: "获取用户手动设定的分类规则（如'所有合同类文件放到收到资料'）",
  parameters: {},
  returns: [
    { pattern: "合同|协议", targetFolder: "收到资料", priority: "high" },
    { pattern: "会议纪要",   targetFolder: "过程文档", priority: "medium" },
  ]
}
```

---

## 5. Agent 推理过程示例

### 5.1 简单场景：`合同-王某某.pdf`

```
Agent 思考: 文件名包含"合同"，扩展名 pdf，可能是收到资料。
            让我先确认项目结构。

→ 调用 browse_project_structure
← 返回 4 个文件夹及其描述

Agent 思考: "收到资料"的描述是"客户/对方提供的原始材料"，
            合同确实是原始材料。我很确定。

→ 输出: { targetRelPath: "收到资料", confidence: 0.93,
          rationale: "文件名含'合同'，属于客户提供的原始材料" }

（只调用了 1 次 Tool，快速决策）
```

### 5.2 困难场景：`document(3).pdf`

```
Agent 思考: 文件名完全无意义，我需要更多信息。

→ 调用 browse_project_structure
← 返回文件夹结构

Agent 思考: 仅凭文件名无法判断。让我看看来源信息。

→ 调用 get_file_source_info
← sourcePath: "C:/Users/xxx/Downloads/微信/某律师发来/"

Agent 思考: 来自微信、律师发来的文件，大概率是收到的资料。
            但我再看看有没有历史参考。

→ 调用 query_classification_history
← 找到: 之前 "document(1).pdf" 被分到"收到资料"，用户接受了
        之前 "document(2).pdf" 被分到"收到资料"，用户接受了

Agent 思考: 来源是微信律师发送 + 历史上同类文件都放了"收到资料"，
            我比较有信心了。

→ 输出: { targetRelPath: "收到资料", confidence: 0.82,
          rationale: "来源为微信律师发送，历史同类文件均归入收到资料" }

（调用了 3 次 Tool，逐步收集证据）
```

### 5.3 极困难场景：`新建文档.txt`

```
Agent 思考: 文件名完全无意义，扩展名 txt 也不能说明什么。

→ 调用 get_file_source_info
← sourcePath: "C:/Users/xxx/Desktop/新建文档.txt"
   （来自桌面，也无额外线索）

→ 调用 query_classification_history
← 无匹配历史

→ 调用 get_user_rules
← 无匹配规则

Agent 思考: 所有信息都不足以做出判断，我不应该硬猜。

→ 输出: { targetRelPath: "收到资料", confidence: 0.35,
          rationale: "文件名和来源均无法判断类型，建议用户手动分类" }

（confidence < 0.5，系统不会展示幽灵文件，而是提示用户手动归档）
```

**真正的 Agent 智能——不是"总能给出答案"，而是"知道什么时候自己不知道"。**

---

## 6. 批量分类：Agent 的整体规划能力

当用户一次拖入多个文件时，不应该逐个独立分类，而应该让 Agent 做整体规划。这是 Agent 相比 pipeline 的核心优势之一。

### 6.1 批量模式 Prompt

```
System Prompt（批量模式）:
  你将收到一批文件，请先整体分析这些文件之间的关系，
  再给出分类建议。关联文件应考虑归入同一或相关目录。
```

### 6.2 示例

```
用户输入:
  以下 5 个文件同时上传到项目"王某某合同纠纷案"：
  1. 买卖合同.pdf
  2. 合同附件-技术规格.pdf
  3. 对方律师函.pdf
  4. 我方回复函-草稿.docx
  5. 损失计算表.xlsx

Agent 整体分析后输出:
  [
    { file: "买卖合同.pdf",          target: "收到资料", confidence: 0.95 },
    { file: "合同附件-技术规格.pdf",  target: "收到资料", confidence: 0.93,
      rationale: "与买卖合同为同组文件，应归入同一目录" },
    { file: "对方律师函.pdf",        target: "收到资料", confidence: 0.90 },
    { file: "我方回复函-草稿.docx",  target: "过程文档", confidence: 0.88,
      rationale: "草稿属于过程文档而非交付成果" },
    { file: "损失计算表.xlsx",       target: "调研研究", confidence: 0.78 }
  ]
```

Agent 能理解文件间的关联性：1 和 2 是一组（都是合同相关），3 和 4 是一组（往来函件），5 是独立的分析类文档。

---

## 7. 学习闭环：越用越准

这是最能形成产品壁垒的部分。市面上所有竞品（Floxtop、SmartSort、AI FileSorter）都是无记忆的，每次分类从零开始。

### 7.1 反馈收集

```
用户操作 accept/reject
        │
        ▼
┌───────────────────────────────┐
│    Feedback Collector          │
│                               │
│  每次 accept:                 │
│    提取 (文件名模式, 扩展名,  │
│    来源特征, 目标文件夹)       │
│    → 写入 preference-history  │
│                               │
│  每次 reject:                 │
│    记录 "这个模式不该去这里"   │
│    如果用户手动移到了别处，     │
│    记录 "正确答案"             │
│    → 写入 preference-history  │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│    Pattern Aggregator          │
│    （定期或达到阈值时触发）     │
│                               │
│  统计每种模式的胜率：          │
│  "合同.*\.pdf" → 收到资料      │
│    accept: 15, reject: 1      │
│    confidence: 0.94            │
│                               │
│  当 confidence > 0.9 且        │
│  样本 > 5 时，提升为           │
│  快速通道规则（跳过 Agent）    │
└───────────────────────────────┘
```

### 7.2 正向飞轮

1. 用户使用 → Agent 分类 → 用户反馈
2. 反馈积累 → 历史匹配更准 → Agent 查询历史时获得更好的 few-shot
3. 高置信度模式 → 自动升级为快速通道规则 → 更多文件无需调 LLM
4. LLM 调用减少 → 成本下降、速度提升 → 用户体验更好

### 7.3 数据结构

```javascript
// preference-history.json —— 从 accept/reject 自动学习
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "auto_001",
      "source": "learned",           // "learned" | "user_defined"
      "namePattern": ".*合同.*",
      "extPattern": "pdf|docx",
      "targetFolder": "收到资料",
      "acceptCount": 12,
      "rejectCount": 1,
      "lastUsed": "2026-03-09T..."
    }
  ]
}
```

### 7.4 ai-storage.json 新增字段

```javascript
// 在现有字段基础上新增
{
  "suggestions": [
    {
      // --- 现有字段（保持不变） ---
      "sourceRelPath": "temp/xxx.pdf",
      "fileName": "xxx.pdf",
      "ext": "pdf",
      "suggestedFolderRelPath": "收到资料",
      "status": "pending",
      "rationale": "...",
      "agentMeta": {},

      // --- 新增字段 ---
      "confidence": 0.85,            // 置信度 (0-1)
      "classifiedBy": "agent",       // "fast-path" | "agent" | "user-manual"
      "toolCallCount": 3,            // Agent 使用了几次 tool（调试用）
      "renameSuggestion": "...",     // 重命名建议（可选，远期功能）
      "batchId": "batch_xxx"         // 批量分类的批次 ID（可选）
    }
  ]
}
```

---

## 8. Confidence 分级与 UI 行为

| 置信度 | 级别 | UI 表现 | 说明 |
|---|---|---|---|
| ≥ 0.85 | 高 | 绿色幽灵文件，正常展示 | Agent 很确定 |
| 0.5 - 0.85 | 中 | 黄色幽灵文件，带"不太确定"标记 | Agent 有一定把握但建议用户复核 |
| < 0.5 | 低 | 不展示幽灵文件，提示"需手动分类" | Agent 承认自己无法判断 |

---

## 9. 代码目录结构

```
desktop/Agent/
├── index.js                    # 统一导出
├── README.md
│
├── classifier/                  # 核心分类逻辑
│   ├── fastPath.js             # 快速通道（规则+历史，无LLM）
│   ├── agent.js                # LangChain Tool-Calling Agent
│   └── batchPlanner.js         # 批量分类规划器
│
├── tools/                       # Agent 的 5 个 Tool（全部只读）
│   ├── browseStructure.js      # 读取项目文件夹结构
│   ├── queryHistory.js         # 查询分类历史
│   ├── inspectFolder.js        # 查看文件夹已有内容
│   ├── getSourceInfo.js        # 获取文件来源信息
│   └── getUserRules.js         # 获取用户自定义规则
│
├── prompts/                     # Prompt 管理
│   ├── systemPrompt.js         # 角色定义 + 工作流程
│   ├── fewShotBuilder.js       # 动态构建 few-shot 示例
│   └── batchPrompt.js          # 批量分类专用 prompt
│
├── schemas/                     # Zod schemas
│   ├── input.js                # 输入校验
│   ├── output.js               # 输出校验
│   └── toolSchemas.js          # Tool 参数校验
│
├── memory/                      # 学习与记忆
│   ├── preferenceHistory.js    # 偏好历史读写
│   ├── feedbackCollector.js    # accept/reject 反馈收集
│   └── patternAggregator.js   # 模式聚合与规则提升
│
├── services/
│   └── llm.js                  # LLM 配置（保持现有）
│
├── storage/
│   └── aiStorage.js            # 暂存区（保持现有）
│
└── guardrails/                  # 安全护栏
    ├── validator.js            # 输出校验（候选列表、system目录）
    ├── costTracker.js          # Token 用量追踪
    └── timeout.js              # 超时控制
```

---

## 10. LangChain 核心代码结构

### 10.1 Agent 创建（`classifier/agent.js`）

```javascript
import { ChatOpenAI } from '@langchain/openai';
import { createToolCallingAgent, AgentExecutor } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';

export function createClassifyAgent({ tools, llmConfig }) {
  const model = new ChatOpenAI({
    ...llmConfig,
    temperature: 0,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
  ]);

  const agent = createToolCallingAgent({ llm: model, tools, prompt });

  return new AgentExecutor({
    agent,
    tools,
    maxIterations: 5,                // 最多 5 次 tool 调用
    returnIntermediateSteps: true,   // 保留推理过程（调试和日志）
    handleParsingErrors: true,
  });
}
```

### 10.2 Tool 定义示例（`tools/queryHistory.js`）

```javascript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const createQueryHistoryTool = ({ projectDir, projectName }) =>
  tool(
    async ({ fileName, ext }) => {
      const history = readPreferenceHistory(projectDir);
      const matches = findSimilarPatterns(history, fileName, ext);
      if (!matches.length) return '未找到类似文件的历史分类记录。';
      return JSON.stringify(matches.slice(0, 5));  // 返回最相关的 5 条
    },
    {
      name: 'query_classification_history',
      description: '查询用户过去对类似文件名/扩展名的分类决策（接受或拒绝），用于理解用户偏好',
      schema: z.object({
        fileName: z.string().describe('当前待分类的文件名'),
        ext: z.string().describe('文件扩展名'),
      }),
    }
  );
```

---

## 11. 市面参考产品

| 产品 | 核心能力 | IPM 可借鉴的点 |
|---|---|---|
| **Floxtop**（Mac） | 本地 AI 分析文件内容，用户用自然语言描述分类规则，毫秒级响应 | IPM 的 structure.json 文件夹描述 = Floxtop 的分类描述，应引导用户写好描述 |
| **AI FileSorter** | Dry-run 预览表（From→To）、持久化 Undo、分类精细度可调 | IPM 幽灵文件已接近 Dry-run，应增加接受后可撤销（Undo） |
| **SmartSort AI** | OCR + AI 智能重命名（`scan_09923.pdf` → `发票_Amazon_MacBook.pdf`） | 律师收到的文件命名常常混乱，智能重命名建议是高价值功能（远期） |
| **TheSethRose/AI-File-Organizer-Agent** | Plan → Review → Execute 三阶段，MCP 沙箱化文件操作 | 批量分类时先出整体计划再执行的模式值得借鉴 |

**IPM 的独特差异化**：以上所有竞品都是**无记忆的**——每次分类从零开始。IPM 的学习闭环（从 accept/reject 积累偏好 → 快速通道自动提升）是真正的产品壁垒。

---

## 12. 权衡与取舍

### 12.1 Agent 比 pipeline 慢且贵

Tool-Calling Agent 每个文件可能产生 2-5 次 LLM 交互，意味着：
- 单文件分类从 1-3 秒变成 3-8 秒
- Token 消耗增加 3-5 倍

**应对方案**：快速通道负责 60-70% 的简单文件。随着学习闭环积累，进入 Agent 的比例持续下降。

### 12.2 Agent 的不可预测性

Agent 可能在 edge case 下行为怪异（反复调用同一个 tool、给出矛盾理由）。

**应对方案**：严格 `maxIterations` + 输出校验 + 暂存区本身就是最好的安全网——即使 Agent 判断错误，也不会直接移动文件。

### 12.3 最大差异化是学习闭环

技术架构本身不是壁垒（LangChain 谁都能用），但"用 3 天后比第 1 天准确率翻倍"的学习能力才是真正的产品壁垒。这不需要复杂的 RLHF，只需要认真记录 accept/reject 并在下次分类时查询。

---

## 13. 存储方案

### 13.1 决策：JSON + Repository 抽象层

经过对 SQLite（better-sqlite3、sql.js）和 JSON 的详细评估，Phase 1 采用 **JSON + Repository 抽象层**：

- **单用户桌面应用**，数据量级在百级别（preference-history 半年约 100-300 条），JSON 读写在 1-5ms 内完成，远低于用户感知阈值（100ms）
- **Node.js 单线程 + 同步 IO = 天然互斥**，不存在并发读写 Bug（`readFileSync` → 修改 → `writeFileSync` 在事件循环中不可打断）
- **Repository 抽象层**让业务代码不关心存储格式，未来如需切换到 SQLite 只改 Store 类内部实现

### 13.2 Repository 设计

```javascript
// Agent/storage/SuggestionStore.js — 封装 ai-storage.json 读写
class SuggestionStore {
  constructor(projectDir, projectName) { ... }
  list({ status, folder } = {}) { ... }
  upsert(suggestion) { ... }
  setStatus(sourceRelPath, patch) { ... }
  findPending() { ... }
}

// Agent/storage/PreferenceStore.js — 封装 preference-history.json（Phase 2）
class PreferenceStore {
  constructor(projectDir) { ... }
  recordAccept({ fileName, ext, targetFolder }) { ... }
  recordReject({ fileName, ext, targetFolder, correctedTo }) { ... }
  findSimilar(fileName, ext) { ... }
  getHighConfidenceRules({ minAccept: 5, maxRejectRate: 0 }) { ... }
}
```

---

## 14. 架构关系澄清：分类 Agent vs 项目专员 Agent

分类 Agent（第一部分）和项目专员 Agent（第二部分）**不是同一个 Agent**：

```
架构层级（完整视角）：

第三层：全局主管 (Supervisor)
        ↓ 路由
第二层：项目专员 Agent (对话式，全能，读+写 Tools)
        ↓ 可调用
第一层：分类 Agent (后台式，专注分类，只读 Tools)
        ↑ 也可被文件上传事件直接触发
```

两条独立的触发路径：

- **事件路径**（后台静默）：文件上传 → 分类 Agent → ai-storage.json → 幽灵文件
- **对话路径**（前台交互）：用户说"帮我整理 temp 里的文件" → Supervisor → 项目专员 → 调用分类 Agent 的能力

分类 Agent 是独立的后台工作者，同时也是项目专员可以调用的一个子能力。第一部分开发的就是这个"地基"。

---

## 15. 依赖升级

### 15.1 问题

`@langchain/langgraph@1.2.1` 要求 `@langchain/core@^1.1.16`（1.x），但项目中是 `@langchain/core@^0.3.68`（0.3.x）。需要全部 LangChain 包一起升级到 1.x。

### 15.2 升级命令

```bash
cd desktop
npm install @langchain/core@latest @langchain/openai@latest @langchain/langgraph@latest zod-to-json-schema@latest
```

### 15.3 向后兼容性

当前使用的 API（`ChatOpenAI`、`SystemMessage`、`HumanMessage`、`.withStructuredOutput()`）在 1.x 中保持不变，现有分类代码无需修改。

### 15.4 验证

升级后运行 `npm start`，通过悬浮窗上传测试文件确认现有分类功能正常。

---

## 16. 第一部分开发计划（被动分类升级）

> 以下是经过校对的精确开发步骤，按依赖顺序排列。每个 Step 完成后应可独立验证。

### Step 1：依赖安装与验证 ✅

- [x] 执行 LangChain 生态全量升级（core + openai + langgraph + zod-to-json-schema）
- [x] `npm start` 验证应用正常启动
- [x] 悬浮窗上传测试文件，验证现有分类功能不受升级影响

### Step 2：Storage 抽象层（Repository） ✅

- [x] 新建 `Agent/storage/SuggestionStore.js`，封装 ai-storage.json 的 CRUD
- [x] 内部调用现有 `aiStorage.js` 的函数，不重写底层逻辑
- [x] ai-storage.json 新增字段支持（confidence 默认 0、classifiedBy 默认空字符串），向后兼容现有数据

**开发总结：**

- 新建文件：`Agent/storage/SuggestionStore.js`
- 采用 `class SuggestionStore` + 私有字段（`#projectDir`、`#projectName`），构造时绑定项目上下文
- 内部复用 `aiStorage.js` 的 4 个底层函数（`readAiStorage`、`upsertAiSuggestion`、`listAiSuggestions`、`setAiSuggestionStatus`），不重写原子写入等已验证逻辑
- 通过 `DEFAULTS` 对象（`{ confidence: 0, classifiedBy: '' }`）在读出（`normalizeItem`）和写入（`withDefaults`）时自动补齐新字段，旧数据无需迁移
- 暴露 5 个方法：`list(opts)`、`upsert(suggestion)`、`setStatus(sourceRelPath, patch)`、`findPending()`、`read()`
- 后续 Step 4 的 Tool 和 Step 9 的统一入口将通过 `new SuggestionStore(projectDir, projectName)` 操作暂存区

### Step 3：Schemas 更新 ✅

- [x] 新建 `Agent/schemas/input.js`（文件信息 + 项目上下文）
- [x] 新建 `Agent/schemas/output.js`（新增 confidence: number、classifiedBy: string）
- [x] 保留旧 `schemas/classifyFileSchema.js` 不动（现有代码仍引用）

**开发总结：**

- 新建 `Agent/schemas/input.js`：
  - `FolderCandidateSchema`：从旧 schema 继承，保持一致（relPath、name、description）
  - `ClassifyInputSchema`：在旧 `ClassifyFileInputSchema` 基础上新增 `projectDir`（`min(1)` 必填），后续 Tool 需要它来定位项目文件系统
  - 其余字段（projectName、sourceRelPath、fileName、ext、sourceDir、folders）与旧 schema 保持一致
- 新建 `Agent/schemas/output.js`：
  - `ClassifyOutputSchema`：新增 `confidence`（0-1 数值范围约束）、`classifiedBy`（枚举 `fast-path` / `agent` / `user-manual`）、`renameSuggestion`（可选，远期功能预留）
  - `targetRelPath` 和 `rationale` 与旧 schema 一致
- 旧 `schemas/classifyFileSchema.js` 未做任何修改，`classifyFileAgent.js` 仍正常引用

### Step 4：5 个 Tool 实现 ✅

- [x] `Agent/tools/browseStructure.js` — 复用 main.js 的 `buildFolderCandidatesFromStructure` 逻辑，增加 fileCount 统计
- [x] `Agent/tools/queryHistory.js` — 暂时从 ai-storage.json 的 accepted/rejected 记录中读取历史（Phase 2 再升级为 preference-history.json）
- [x] `Agent/tools/inspectFolder.js` — 新写：读取指定文件夹内的文件列表（名称 + 修改时间）
- [x] `Agent/tools/getSourceInfo.js` — 复用 main.js 的 `getTempSourceInfoByRelPath` 逻辑
- [x] `Agent/tools/getUserRules.js` — 新写：从 state.json 读用户自定义规则（初期可返回空数组，预留接口）

**开发总结：**

- 所有 Tool 均使用 LangChain 1.x 的 `tool()` 函数 + Zod schema 定义，符合 `createReactAgent` 的 Tools 接口要求
- 每个 Tool 导出一个工厂函数（`createXxxTool(projectDir, ...)`），通过闭包捕获项目上下文，Agent 运行时按需实例化
- 所有 Tool 均为**只读操作**，不修改任何文件
- **browseStructure**：从 `structure.json` 读取文件夹列表，过滤 system 目录，对每个文件夹统计 `fileCount`（`fs.readdirSync`）
- **queryHistory**：调用 `aiStorage.js` 的 `listAiSuggestions`，支持按 status 和 keyword 过滤，返回最近 30 条记录
- **inspectFolder**：读取指定文件夹的文件列表（名称 + 修改时间），按修改时间倒排，最多返回 50 个文件
- **getSourceInfo**：从 `temp-source-record.json` 查找文件原始来源路径，复用 main.js 中 `getTempSourceInfoByRelPath` 的核心逻辑
- **getUserRules**：Phase 1 预留接口，返回空数组；Phase 2 实现规则 UI 后读取用户自定义规则
- 辅助函数（`safeReadJson`、`normalizeRelPathPosix`）在需要的 Tool 中局部定义，避免引入 main.js 的循环依赖

### Step 5：System Prompt 设计 ✅

- [x] 新建 `Agent/prompts/systemPrompt.js` — 分类专用角色定义 + 工作流程指导 + 输出格式要求 + confidence 输出指引
- [x] 保留旧 `prompts/classifyFilePrompt.js` 不动

**开发总结：**

- 新建 `Agent/prompts/systemPrompt.js`，导出 `PROMPT_VERSION`、`SYSTEM_PROMPT` 和 `buildUserMessage()` 函数
- Prompt 使用英文编写（LLM 推理更稳定），但要求 `rationale` 用中文输出（面向用户展示）
- `buildUserMessage()` 组装每次分类的用户消息，包含 fileName、ext、sourceRelPath、sourceDir、projectName
- 旧 `prompts/classifyFilePrompt.js` 未修改

**v4-multi-tool 迭代（测试驱动优化）：**

初版 Prompt（v3）在实际测试中发现 Agent 几乎只调用 `browse_structure` 一个 Tool 就直接输出结论，即使 confidence 只有 0.6 也不会主动收集更多证据。根本原因是 v3 Prompt 中存在三处引导 Agent 早停的指令：
1. `"If the file name clearly indicates a category, you may decide quickly"` — 给了 LLM 早停许可
2. `"Keep tool calls minimal"` — 明确要求少调工具
3. 只有"文件名模糊"才触发多工具调用 — LLM 认为有中文含义的文件名不算"模糊"

v4 改动：
- `PROMPT_VERSION` 从 `v3-tool-calling` 升级为 `v4-multi-tool`
- Workflow 重写为 5 步流程，Step 1-3 标记为 **REQUIRED**（browse_structure + get_source_info + query_history 必须调用）
- 移除 `"Keep tool calls minimal"` 约束
- 移除 `"you may decide quickly"` 早停许可
- 新增硬性规则：`"Confidence above 0.7 REQUIRES evidence from at least 2 different tools"`
- Confidence Guidelines 更新：0.9+ 要求多信号一致、0.7+ 要求至少 2 个工具证据
- rationale 要求明确说明哪些证据源支持了决策

### Step 6：Tool-Calling Agent 实现 ✅

- [x] 新建 `Agent/classifier/agent.js` — 使用 `@langchain/langgraph` 的 `createReactAgent`，组装 5 个 Tools + System Prompt
- [x] 配置 `recursionLimit: 15`（等效 maxIterations ≈ 5 次 tool call + 最终回答）
- [x] Agent 输出经过 Zod 校验（output.js schema）
- [x] 输出的 targetRelPath 必须在候选文件夹列表中（硬校验，保留现有逻辑）

**开发总结：**

- 新建 `Agent/classifier/agent.js`，导出 `runClassifyAgent(input)` 异步函数
- 使用 `createReactAgent` from `@langchain/langgraph/prebuilt`，传入 `prompt`（System Prompt 字符串）和 5 个 Tool 实例
- 通过 `buildUserMessage()` 组装每次分类的用户消息，传入 `agent.invoke()` 的 messages 数组
- `recursionLimit: 15`：React Agent 每次 tool call 消耗 2 步（LLM 决策 + tool 执行），15 步允许最多约 5 次 tool call + 最终回答
- 输出处理流程：提取最后一条 AI message → 正则匹配 JSON → `JSON.parse` → `ClassifyOutputSchema.parse()` → 候选列表硬校验
- 返回值包含 `toolCallCount`（统计实际 tool 调用次数，用于诊断）和 `agentMeta`（model、baseURL、promptVersion）
- 超时控制将在 Step 8（护栏）中实现

### Step 7：快速通道实现（仅规则引擎） ✅

- [x] 新建 `Agent/classifier/fastPath.js` — 实现规则匹配引擎
- [x] 内置律师场景默认规则（合同/诉状/判决书/会议纪要/调研报告等）
- [x] 命中规则时直接返回结果（confidence + classifiedBy="fast-path"），不调 LLM
- [x] 未命中时返回 null，交由 Agent 处理
- [x] 注意：历史匹配部分在 Phase 2 实现，此处只做规则匹配

**开发总结：**

- 新建 `Agent/classifier/fastPath.js`，导出 `tryFastPath({ fileName, ext, folders })` 函数
- 内置 17 条默认规则，覆盖律师常见文件类型：
  - 收到资料：合同/协议、起诉状、判决书/裁定书、证据、律师函、委托书、发票（7 条）
  - 过程文档：会议纪要、备忘录、工作底稿/草稿、笔录（4 条）
  - 调研研究：研究/调研/分析报告、案例/判例、法规法律、xmind/mindmap 扩展名（4 条）
  - 交付成果：交付/终版、意见书/法律意见（2 条）
- 规则匹配前先检查 `rule.target` 是否存在于当前项目的候选文件夹列表中（`folderSet`），避免误匹配不存在的文件夹
- 命中返回 `ClassifyOutput` 格式对象（`classifiedBy: 'fast-path'`），未命中返回 `null`
- Phase 2 将在此函数中追加历史模式匹配逻辑

### Step 8：护栏 ✅

- [x] 新建 `Agent/guardrails/validator.js` — 输出校验（targetRelPath 在候选列表中、不是 system 目录、confidence 在 0-1 范围内）
- [x] 超时控制：Agent 调用整体超时 15 秒，超时则跳过分类（不阻塞用户上传流程）

**开发总结：**

- 新建 `Agent/guardrails/validator.js`，导出两个函数：
- **`validateClassifyOutput(output, folders)`**：三重校验
  1. `targetRelPath` 必须在候选文件夹列表中
  2. `targetRelPath` 不得为系统目录（meta / temp / snippets 等）
  3. `confidence` 必须为 0-1 之间的数值
  - 返回 `{ valid: boolean, errors: string[] }`，调用方据此决定是否采纳 Agent 输出
- **`withTimeout(promise, ms = 15000)`**：Promise 竞速超时控制，Agent 调用超过 15 秒自动 reject，不阻塞用户上传流程

### Step 9：统一入口 ✅

- [x] 新建 `Agent/classifier/index.js` — 瀑布逻辑：先走快速通道 → 未命中则走 Tool-Calling Agent → 输出经过 validator 校验
- [x] 更新 `Agent/index.js` — 导出新的 `classifyFile` 函数（替代旧的 `classifyFileOnce`）
- [x] 新函数的返回值增加 `confidence`、`classifiedBy`、`toolCallCount` 字段

**开发总结：**

- 新建 `Agent/classifier/index.js`，导出 `classifyFile(rawInput)` 异步函数
- 瀑布逻辑：
  1. **Zod 校验入参**：`ClassifyInputSchema.parse(rawInput)`，入参不合法直接抛错
  2. **快速通道**：`tryFastPath()` 命中 → `validateClassifyOutput()` 校验 → 通过则直接返回（`toolCallCount: 0`）
  3. **Tool-Calling Agent**：快速通道未命中 → `withTimeout(runClassifyAgent(input), 15000)` → 超时自动 reject
  4. **护栏校验**：Agent 输出经过 `validateClassifyOutput()` 校验，不通过则抛错
- 更新 `Agent/index.js`：同时导出旧 `classifyFileOnce`（标记 `@deprecated`）和新 `classifyFile`
- Step 10 将在 main.js 中把 `classifyFileOnce` 调用替换为 `classifyFile`

### Step 10：集成到 main.js ✅

- [x] 修改 `triggerAutoClassifyToAiStorage`：将 `classifyFileOnce(...)` 替换为新的 `classifyFile(...)` 调用
- [x] `upsertAiSuggestion` 调用时传入新增字段（confidence、classifiedBy）
- [x] 保持 `triggerAutoClassifyToAiStorage` 的外层框架（错误处理、日志、非阻塞触发）完全不变
- [x] 旧文件（`runner/classifyFileAgent.js`、`prompts/classifyFilePrompt.js`、`schemas/classifyFileSchema.js`）暂时保留作为参考，标记为 deprecated

**开发总结：**

- `main.js` 第 6 行 import：`classifyFileOnce` → `classifyFile`
- `classifyFile` 调用新增 `projectDir` 参数（新 schema 必填，Agent 的 Tool 需要它定位项目文件系统）
- `agentLog` 日志新增 `confidence`、`classifiedBy`、`toolCallCount` 字段，方便调试和追踪
- `upsertAiSuggestion` 传入新增 `confidence` 和 `classifiedBy` 字段，写入 ai-storage.json
- 外层框架（try/catch 错误处理、agentLog 日志、非阻塞触发方式）完全未改动
- 旧文件均保留未删除，`Agent/index.js` 中 `classifyFileOnce` 标记 `@deprecated`

### 验收标准

1. 悬浮窗上传文件 → Agent 分类成功 → 幽灵文件正常展示
2. 文件名明确的文件（如"合同.pdf"）走快速通道（classifiedBy="fast-path"），无 LLM 调用
3. 文件名模糊的文件（如"document.pdf"）走 Agent（classifiedBy="agent"），Agent 自主决定调用哪些 Tool
4. ai-storage.json 中的建议包含 confidence 和 classifiedBy 字段
5. confidence < 0.5 的建议状态正确记录（后续 UI 层可据此展示不同样式）
6. Agent 超时 15 秒不影响上传流程

---

### Phase 2 预告：学习闭环（第一部分完成后进行）

- [ ] 新建 `Agent/storage/PreferenceStore.js`（preference-history.json 读写）
- [ ] 实现 Feedback Collector — 在 `aiStorage/accept` 和 `aiStorage/reject` IPC 处理时自动记录到 preference-history
- [ ] 实现 Pattern Aggregator — 高置信度模式自动提升为快速通道规则
- [ ] 升级 `queryHistory.js` Tool — 从 preference-history.json 读取（替代从 ai-storage.json 读）
- [ ] 升级 `fastPath.js` — 增加历史匹配能力（规则 + 历史双通道）

### 远期功能（不在第一部分范围内）

- 批量分类（batchPlanner）
- Confidence 分级 UI（绿色/黄色/手动分类提示）
- 接受后可撤销（Undo）
- 智能重命名建议
- 用户自定义规则管理 UI
- Token 用量统计面板

---
---

# 第二部分：领域专属 Agent 架构设计（文件管理助理）

> 以上第一部分聚焦于"被动分类"能力的升级。第二部分将 IPM 的 AI 能力从"被动分类器"升级为**有状态的、可对话的、主动感知的文件管理助理**——一个专注于文件管理的"阉割版 OpenClaw"。

## 14. 设计理念

### 14.1 从"分类器"到"助理"的转变

| 维度 | 当前（被动分类器） | 目标（文件管理助理） |
|---|---|---|
| **触发方式** | 被动（文件进来才触发） | 主动 + 被动（它会自己"巡逻"项目） |
| **交互方式** | 无（后台默默运行） | 可对话（用户可以用自然语言交流） |
| **输出形式** | 只有幽灵文件 | 幽灵文件 + 报告 + 回答 + 执行结果 |
| **角色感** | 没有，它是一段代码 | 有，它是"我的文件管理助理" |
| **能力边界** | 只会分类 | 分类 + 报告 + 问答 + 执行指令 |
| **权限边界** | 不能操作文件 | 可以移动/重命名/创建文件夹，**不能删除** |

### 14.2 核心产品目标

让用户能够尽可能少地把时间花在管理文件上。Agent 是一个"助理"——活的、随时待命的、能做事的。

### 14.3 借鉴 OpenClaw 的核心理念

- **真正能做事**：用户给指令，Agent 产出肉眼可见的结果（移动文件、整理文件夹、生成报告）
- **自主性**：Agent 能主动感知项目状态，主动提醒和汇报
- **有角色感**：不是冰冷的工具，而是有身份的助理
- **严格边界**：不同于通用的 OpenClaw，IPM 助理只能做文件管理相关的事，且不能删除

---

## 15. UI 形态：侧边栏聊天面板

**推荐方案：可折叠的右侧聊天面板**，理由：

- 用户经常一边浏览项目文件一边向 Agent 提问，侧边栏让两者同时可见
- Agent 的回复（文件列表、执行计划、确认对话框）适合可滚动的聊天格式
- 现代桌面应用（Cursor、VS Code Copilot Chat、Notion AI）已验证这个模式的可用性
- 可以从任何页面（概览、我的资料、知识库）打开，不中断当前工作流
- 折叠时只显示一个入口图标，不占空间
- 主动通知以 badge 形式显示在入口图标上，打开后看到消息

```
┌──────────┬────────────────────────┬──────────────┐
│          │                        │              │
│  左侧    │    中间内容区            │  右侧聊天面板  │
│  导航栏   │    （项目文件浏览等）     │  （可折叠）    │
│          │                        │              │
│  概览    │                        │  [Agent消息]  │
│  我的资料 │                        │  [用户消息]   │
│  知识库   │                        │  [执行计划]   │
│  设置    │                        │  [确认按钮]   │
│          │                        │              │
│          │                        │  ┌─────────┐ │
│          │                        │  │ 输入框   │ │
│  [Agent] │                        │  └─────────┘ │
│  入口图标 │                        │              │
│  (badge) │                        │              │
└──────────┴────────────────────────┴──────────────┘
```

---

## 16. 多 Agent 架构：主管-专员模式

### 16.1 架构总览

```
用户 ←→ 聊天面板 UI ←→ (IPC) ←→ 全局主管 Agent (Supervisor)
                                       │
                         ┌─────────────┼─────────────┐
                         │             │             │
                    项目专员 Agent  项目专员 Agent  项目专员 Agent
                    (王某某案)     (李某某案)     (学习空间)
                         │             │             │
                    [Tools集]     [Tools集]     [Tools集]
```

### 16.2 全局主管 Agent（Supervisor）

**职责**：

- 维护一份轻量级的"项目注册表"（名称、类型、文件数、最近活跃时间）
- 判断用户意图属于哪个项目（或跨项目），路由给对应的项目专员
- 回答跨项目的统计型问题（如"哪个案件最近最活跃？"）
- 转述项目专员的回答和执行计划给用户

**上下文消耗**：极小。只加载项目列表摘要，不加载文件详情。

**LangGraph 实现**：使用 `@langchain/langgraph-supervisor` 的 `createSupervisor` 编排多个项目专员。

### 16.3 项目专员 Agent（Per-Project Worker）

**职责**：

- 深度了解一个项目的文件夹结构、文件内容列表、近期事件
- 执行文件管理操作（通过 Tools）
- 回答关于该项目文件的具体问题
- 生成该项目的报告和摘要

**上下文**：当被 Supervisor 调用时，按需加载该项目的 structure.json、近期 log.jsonl 条目、preference-history 等。

**读操作 Tools（无需确认）**：

- `browse_project_structure` — 读取文件夹结构和描述
- `query_classification_history` — 查询分类偏好历史
- `inspect_folder_contents` — 查看文件夹内已有文件
- `get_file_source_info` — 获取文件来源信息
- `get_recent_events` — 读取近期操作日志（从 log.jsonl）
- `get_project_stats` — 获取项目统计（文件数、文件夹数、各文件夹大小等）

**写操作 Tools（生成计划，需用户确认后执行）**：

- `move_files` — 移动文件到指定文件夹
- `rename_file` — 重命名文件
- `create_folder` — 创建新文件夹
- `accept_ai_suggestions` — 批量接受 AI 分类建议

**绝对禁止的操作**：删除文件、删除文件夹。Agent 无此 Tool。

### 16.4 LangGraph Supervisor 代码结构

```javascript
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

// 为每个项目动态创建专员 Agent
function createProjectAgent(projectName, projectDir, domain) {
  const tools = [
    createBrowseStructureTool({ projectDir }),
    createQueryHistoryTool({ projectDir, projectName }),
    createInspectFolderTool({ projectDir }),
    createGetSourceInfoTool({ projectDir }),
    createGetRecentEventsTool({ projectDir }),
    createGetProjectStatsTool({ projectDir }),
    // 写操作 Tools（产出计划，不直接执行）
    createMoveFilesTool({ projectDir, projectName }),
    createRenameFileTool({ projectDir, projectName }),
    createCreateFolderTool({ projectDir, projectName }),
  ];
  
  return createReactAgent({
    llm: model,
    tools,
    name: projectName,
    prompt: PROJECT_AGENT_SYSTEM_PROMPT,
  });
}

// 全局主管
const supervisor = createSupervisor({
  agents: projectAgents,
  llm: model,
  prompt: SUPERVISOR_SYSTEM_PROMPT,
});
```

---

## 17. 写操作审批流程

所有写操作遵循 **Plan → Confirm → Execute** 三阶段：

```
用户: "把收到资料里的合同都移到新的'合同文件'子文件夹"
  │
  ▼
聊天面板 → 主管 Agent → 路由到项目专员
  │
  ▼
项目专员调用 browse_structure + inspect_folder
  │
  ▼
生成执行计划，返回给聊天面板展示：
  ┌─────────────────────────────────────────────────┐
  │  执行计划预览                                     │
  │                                                  │
  │  1. ✅ 创建文件夹: 收到资料/合同文件               │
  │  2. ✅ 移动: 买卖合同.pdf → 收到资料/合同文件/     │
  │  3. ✅ 移动: 补充协议.docx → 收到资料/合同文件/    │
  │  4. ✅ 移动: 合同附件.pdf → 收到资料/合同文件/     │
  │                                                  │
  │  [确认执行]  [取消]                               │
  └─────────────────────────────────────────────────┘
  │
  ▼（用户点击"确认执行"）
  │
  ▼
系统执行文件操作 → 反馈结果
  "已完成！创建了 1 个文件夹，移动了 3 个文件。"
```

计划预览 UI 设计要点：

- 每一步操作清晰列出（类似 git diff 的可读性）
- 用户可以逐条勾选/取消，或一键全部确认
- 确认按钮 + 取消按钮
- 操作完成后显示结果摘要（成功/失败数量）

---

## 18. 主动感知与推送

Agent 不仅响应用户提问，也能主动生成信息：

| 触发条件 | Agent 行为 | 展示方式 |
|---|---|---|
| 用户打开某个项目 | 生成简短状态摘要 | 聊天面板中自动显示 |
| temp/ 中有超过 N 个未分类文件 | 提醒用户处理 | 入口图标 badge + 面板中提示 |
| 用户 3 天未处理 AI 建议 | 温和提醒 | 面板中提示 |
| 每周一（可配置） | 生成周报（各项目文件变动摘要） | 面板中显示报告卡片 |
| 用户 accept/reject 后 | 短反馈（"好的，我记住了"） | 面板中简短回复 |

主动推送的实现：

- 事件驱动（文件上传、项目切换）触发轻量级检查
- 定时任务（周报）通过 Electron 的定时器触发
- 推送内容写入一个 `notifications.json`，聊天面板启动时读取未读通知

---

## 19. Agent 的"身份感"设计

借鉴 OpenClaw 的 SOUL.md 理念，为 Agent 定义明确的身份：

```
IDENTITY:
  名称: IPM 助理
  角色: 你是用户的文件管理助理，专注于帮助用户管理项目文件夹。
  性格: 专业、简洁、主动但不啰嗦。
  
CAPABILITIES（能做的）:
  - 回答关于项目文件的任何问题
  - 分类和归档文件（需用户确认）
  - 移动、重命名文件（需用户确认）
  - 创建新文件夹（需用户确认）
  - 生成项目文件报告和摘要
  - 记住用户的文件管理偏好
  
LIMITATIONS（不能做的）:
  - 删除任何文件或文件夹
  - 读取文件内容（只能看文件名和元数据）
  - 做任何与文件管理无关的事

MEMORY:
  - 记住用户的分类偏好（accept/reject 历史）
  - 记住每个项目的结构和近期变化
  - 不记住对话内容（每次对话是独立 session）
```

---

## 20. 对话历史与状态管理

- **对话历史**：每次打开聊天面板是一个新 session，不持久化完整对话历史（降低 token 消耗和复杂度）
- **Agent 记忆**：通过文件持久化（preference-history.json、log.jsonl），不是通过对话历史
- **项目上下文**：项目专员被调用时按需加载，调用结束后不保持长期状态
- **主管上下文**：只保持轻量级项目注册表，每次对话开始时从 state.json 和各项目 meta 加载

---

## 21. 技术栈

| 组件 | 技术选型 | 说明 |
|---|---|---|
| Agent 编排 | `@langchain/langgraph` + `@langchain/langgraph-supervisor` | 多 Agent 状态机和路由 |
| LLM 调用 | `@langchain/openai`（ChatOpenAI） | 兼容各种 OpenAI API 兼容服务 |
| Tool 定义 | `@langchain/core/tools` + `zod` | 结构化 Tool 参数和校验 |
| 流式输出 | LangGraph Streaming API | token 级别的流式响应 |
| 前端聊天 UI | React 组件（自建） | 侧边栏面板 + 消息列表 + 确认组件 |
| IPC 通道 | Electron IPC | 渲染进程 ↔ 主进程 Agent |
| 数据持久化 | JSON 文件（沿用现有模式） | preference-history.json, notifications.json 等 |

---

## 22. 与被动分类的关系

被动分类（本文档第一部分的设计）是项目专员 Agent 的一个**子能力**：

```
┌─────────────────────────────────────────────────────┐
│                 项目专员 Agent                        │
│                                                     │
│  ┌────────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │
│  │ 被动分类能力│ │问答能力 │ │指令执行 │ │报告生成 │  │
│  │ (快速通道 + │ │(读Tools)│ │(写Tools│ │(主动   │  │
│  │  Tool-     │ │         │ │ +确认) │ │ 感知)  │  │
│  │  Calling)  │ │         │ │        │ │        │  │
│  └─────┬──────┘ └────┬───┘ └───┬────┘ └───┬────┘  │
└────────┼─────────────┼─────────┼──────────┼────────┘
         │             │         │          │
    文件上传事件    用户对话     用户对话   定时/事件
    (自动触发)    (通过主管路由) (通过主管路由)  触发
```

- 文件上传时，直接走被动分类路径（快速通道 + Agent 分类），不经过 Supervisor 对话流
- 用户在聊天面板中说"帮我分类 temp 里的文件"时，走 Supervisor → 项目专员 → 调用分类能力
- 两条路径最终都写入 ai-storage.json，共享同一套暂存区和幽灵文件机制

---

## 23. 完整代码目录结构（新增/改造）

```
desktop/Agent/
├── index.js                          # 统一导出
│
├── supervisor/                        # [新增] 全局主管
│   ├── supervisor.js                 # createSupervisor 编排
│   ├── projectRegistry.js           # 项目注册表（轻量级摘要）
│   └── prompts.js                    # 主管 System Prompt
│
├── project-agent/                     # [新增] 项目专员
│   ├── createProjectAgent.js         # 工厂函数：为指定项目创建 Agent
│   └── prompts.js                    # 项目专员 System Prompt + 身份定义
│
├── classifier/                        # [改造] 被动分类（保留第一部分设计）
│   ├── fastPath.js                   # 快速通道（规则+历史，无LLM）
│   ├── classifyAgent.js              # Tool-Calling 分类 Agent
│   └── batchPlanner.js               # 批量分类规划器
│
├── tools/                             # [扩展] Agent 工具集
│   ├── read/                          # 读操作 Tools
│   │   ├── browseStructure.js        # 读取项目文件夹结构
│   │   ├── queryHistory.js           # 查询分类历史
│   │   ├── inspectFolder.js          # 查看文件夹已有内容
│   │   ├── getSourceInfo.js          # 获取文件来源信息
│   │   ├── getRecentEvents.js        # [新增] 读取近期操作日志
│   │   └── getProjectStats.js        # [新增] 获取项目统计
│   └── write/                         # 写操作 Tools
│       ├── moveFiles.js              # [新增] 移动文件
│       ├── renameFile.js             # [新增] 重命名文件
│       └── createFolder.js           # [新增] 创建文件夹
│
├── proactive/                         # [新增] 主动感知
│   ├── statusChecker.js              # 检查 temp 未分类、长期未处理等
│   ├── reportGenerator.js            # 项目摘要和周报生成
│   └── notifications.js             # 通知管理（读写 notifications.json）
│
├── memory/                            # 学习与记忆
│   ├── preferenceHistory.js          # 偏好历史读写
│   ├── feedbackCollector.js          # accept/reject 反馈收集
│   └── patternAggregator.js         # 模式聚合与规则提升
│
├── prompts/                           # Prompt 管理
│   ├── systemPrompt.js               # 角色定义 + 工作流程
│   ├── fewShotBuilder.js             # 动态构建 few-shot 示例
│   └── batchPrompt.js                # 批量分类专用 prompt
│
├── schemas/                           # Zod schemas
│   ├── input.js                      # 输入校验
│   ├── output.js                     # 输出校验
│   └── toolSchemas.js                # Tool 参数校验
│
├── services/
│   └── llm.js                        # LLM 配置（保持现有）
│
├── storage/
│   └── aiStorage.js                  # 暂存区（保持现有）
│
└── guardrails/                        # 安全护栏
    ├── validator.js                  # 输出校验（候选列表、system目录）
    ├── costTracker.js                # Token 用量追踪
    └── timeout.js                    # 超时控制

desktop/src/
├── main/ipc/
│   └── agent.js                      # [新增] Agent IPC 通道（对话、流式、确认）
│
└── ui/components/
    └── agent-chat/                    # [新增] 聊天面板 UI
        ├── ChatPanel.jsx             # 可折叠的右侧面板容器
        ├── MessageList.jsx           # 消息列表（用户+Agent 消息）
        ├── MessageBubble.jsx         # 单条消息气泡
        ├── ActionPlanCard.jsx        # 执行计划预览卡片（含确认/拒绝按钮）
        ├── ReportCard.jsx            # 报告/摘要卡片
        ├── ChatInput.jsx            # 输入框 + 发送按钮
        └── AgentBadge.jsx           # Agent 入口图标 + 未读 badge
```

---

## 24. 完整开发阶段规划

### Phase 1：被动分类升级（第一部分已定义）

- [ ] 搭建新的 Agent 目录结构
- [ ] 实现 5 个读操作 Tool
- [ ] 实现 Tool-Calling Agent（替换现有单次 LLM 调用）
- [ ] 实现快速通道（规则引擎 + 历史匹配）
- [ ] ai-storage.json 新增 confidence、classifiedBy 字段
- [ ] 护栏：maxIterations、输出校验、超时

### Phase 2：聊天面板 UI + Agent IPC 通道 ✅

- [x] 实现 ChatPanel 覆盖式大面板（75% 宽度 Overlay，参考 Claude 风格）
- [x] 实现 MessageList + MessageBubble 消息展示（Agent 左对齐带头像 + 用户深色气泡）
- [x] 实现 ChatInput 输入框（圆角 + 圆形发送按钮 + auto-resize）
- [x] 入口按钮放在 RootTable "偏好与记录"右侧（每个项目独立入口）
- [x] 新增 `main/ipc/projectAgent.js`（对话请求、流式推送、计划执行、会话管理）
- [x] preload.js 新增 `window.ipm.agent.*` API（sendMessage / executePlan / endSession / getSessionInfo / onStreamEvent）

### Phase 3：项目专员 Agent（读操作 + 写操作 + 分类委托） ✅

> Phase 3-5 合并为一步完成，因为项目专员的工厂函数需要所有 Tools 就绪。

- [x] 实现 `createProjectAgent.js` 工厂函数（组装 16 个 Tools + System Prompt）
- [x] 实现 `memory.js`（project-summary.md 认知摘要 + 首次扫描 + 轻量/深度更新）
- [x] 实现 `prompts.js`（项目专员身份定义 + 写操作规则 + 对话风格）
- [x] 实现 4 个新 Read Tools：get_project_stats / get_recent_events / search_files / read_own_memory
- [x] 实现 4 个 Write Tools：move_files / rename_file / create_folder / update_folder_description（只生成计划）
- [x] 实现 `planExecutor.js`（接收确认的计划 → 执行文件操作 → syncStructureJson → 写 activity_log）
- [x] 实现 2 个超级 Tools：classify_file / classify_batch（委托给现有分类 Agent）
- [x] 实现 `session.js`（ProjectAgentSession 类：startSession / sendMessage 流式 / endSession 摘要+记忆更新）
- [x] 实现 ActionPlanCard 执行计划预览组件（checkbox + 确认/取消 + 执行结果）

### Phase 4：Supervisor 多 Agent 编排（待开发）

- [ ] 实现 projectRegistry（项目注册表）
- [ ] 实现 Supervisor Agent（createSupervisor）
- [ ] 实现 Supervisor System Prompt（路由逻辑）
- [ ] 对接聊天面板：用户提问 → 主管路由 → 专员回答

### Phase 5：主动感知（待开发）

- [ ] 实现 statusChecker（temp 未分类、长期未处理检查）
- [ ] 实现 reportGenerator（项目摘要、周报）
- [ ] 实现 notifications.json 通知管理
- [ ] 实现 AgentBadge 未读通知 badge
- [ ] 实现定时触发（Electron 定时器）

### Phase 7：学习闭环（贯穿所有阶段）

- [ ] 实现 Pattern Aggregator（高置信度模式自动提升为快速通道规则）
- [x] 实现三层记忆模型（硬规则 / 软偏好 / 原始事件），详见 `Skill开发思路.md`
- [x] 引入 SQLite 数据库，迁移 ai-storage / source-record / events / activity-log
- [x] query_history Tool 重构为直接查询 events 表，确保 userFeedback 可靠获取
- [x] System Prompt 升级至 v6-feedback-aware，增加证据优先级和偏好工具调用

---
---

# 第三部分：开发记录

> 以下为第一部分完成后的后续开发记录，按时间顺序排列。

## 25. 开发记录：三层记忆模型

> 详细记录见 `Skill开发思路.md` 第 12-16 节，此处仅做概要。

### 25.1 硬规则层（classify-rules.json）

- 存储位置：`{projectDir}/meta/classify-rules.json`
- 功能：用户手动配置的确定性分类规则，支持文件名 pattern、扩展名、来源路径的组合匹配
- 模块：`Agent/storage/classifyRules.js`（CRUD）、`Agent/tools/getUserRules.js`（Agent Tool）
- UI：`PreferencesPage.jsx` → 硬规则 Tab → `ClassifyRulesPanel.jsx`（表格 + 新增表单）

### 25.2 原始事件层（classify-events → SQLite events 表）

- 初始存储：`{projectDir}/meta/classify-events.jsonl`（JSONL 追加写入）
- 最终迁移至：SQLite `events` 表
- 事件类型：`classify.accepted`（用户接受分类）、`classify.rejected`（用户拒绝分类，可附带 userFeedback）
- 模块：`Agent/storage/classifyEvents.js`（写入/查询/更新反馈）
- UI：`PreferencesPage.jsx` → 原始事件 Tab → `ClassifyEventsPanel.jsx`（时间线 + 搜索筛选 + 详细/简略模式）

### 25.3 软偏好层（preferences.json）

- 存储位置：`{projectDir}/meta/preferences.json`
- 功能：概率性分类倾向，支持自然语言教导 + 偏好衰减
- 数据结构：`pattern`（描述）、`conditions`（匹配条件）、`tendency`（目标 + 强度）、`evidence`（来源说明）、`source`（manual/nl-taught/auto）
- 模块：`Agent/storage/preferences.js`（CRUD + 匹配 + 衰减）、`Agent/tools/getPreferences.js`（Agent Tool）
- 自然语言教导：IPC `preferences/parseNL` → LLM 解析用户描述为结构化偏好 → 预览确认后保存
- 偏好衰减：当 Agent 基于软偏好做出分类但被用户拒绝时，自动将相关偏好的 strength 衰减 20%
- UI：`PreferencesPage.jsx` → 软偏好 Tab → `PreferencesPanel.jsx`（列表 + 手动编辑 + NL 输入框）

---

## 26. 开发记录：SQLite 数据库引入

### 26.1 背景与决策

随着三层记忆模型、原始事件、对话记录等数据的增长，JSON/JSONL 的查询和管理成本逐渐升高。经过评估，决定引入轻量级数据库 `better-sqlite3`（同步 API，无需异步回调，天然适合 Electron 单线程模型）。

核心原则：**增长型、高频查询数据 → SQLite；静态配置型数据 → 保持 JSON/MD**。

### 26.2 数据迁移方案

| 旧存储 | 新存储 | 说明 |
|---|---|---|
| `ai-storage.json`（suggestions） | SQLite `suggestions` 表 | 分类建议，频繁 upsert + 状态查询 |
| `temp-source-record.json` | SQLite `source_records` 表 | 来源路径映射，频繁查找 |
| `classify-events.jsonl` | SQLite `events` 表 | 事件流，需时间范围/类型/关键词查询 |
| `log.jsonl` | SQLite `activity_log` 表 | 操作日志，按时间查询 |
| — | SQLite `conversations` 表 | 项目专员对话摘要（新增） |
| `classify-rules.json` | 保持 JSON | 静态配置，用户手动编辑 |
| `preferences.json` | 保持 JSON | 静态配置，条目少 |
| `structure.json` | 保持 JSON | 文件夹结构描述 |
| `project-summary.md` | 保持 MD | 项目专员认知摘要 |

### 26.3 新建文件

- **`Agent/db/init.js`** — 数据库初始化：创建表、索引、设置 WAL 模式、schema 版本管理
- **`Agent/db/suggestions.js`** — suggestions 表 Repository：`upsertSuggestion`、`listSuggestions`、`getSuggestionByRelPath`、`setSuggestionStatus`
- **`Agent/db/sourceRecords.js`** — source_records 表 Repository：`upsertSourceRecord`、`deleteSourceRecord`、`lookupSourceRecord`、`getSourceInfo`
- **`Agent/db/events.js`** — events 表 Repository：`appendEvent`、`listEvents`（支持类型/搜索/分页）、`updateEventFeedback`
- **`Agent/db/activityLog.js`** — activity_log 表 Repository：`appendLog`、`listLogs`
- **`Agent/db/conversations.js`** — conversations 表 Repository：`appendConversation`、`listConversations`、`trimConversations`
- **`Agent/db/migrate.js`** — 旧数据迁移：JSON/JSONL → SQLite，使用事务确保原子性
- **`Agent/db/index.js`** — 数据库实例管理：`getProjectDb`（缓存 + 首次迁移）、`closeProjectDb`、`closeAllDbs`

### 26.4 改造文件

- **`Agent/storage/aiStorage.js`** — 所有函数改为委托 SQLite suggestions Repository
- **`Agent/storage/classifyEvents.js`** — 所有函数改为委托 SQLite events + sourceRecords Repository
- **`Agent/tools/queryHistory.js`** — 改为直接查询 SQLite events 表
- **`Agent/tools/getSourceInfo.js`** — 改为查询 SQLite source_records 表
- **`main.js`** — 集成 `getProjectDb`/`closeAllDbs`，替换 source record 操作，项目创建时初始化 DB，退出时关闭连接
- **`main/ipc/aiStorage.js`** — 日志改为写入 SQLite activity_log
- **`main/ipc/projects.js`、`main/ipc/cases.js`** — 删除项目/案件前先关闭 DB 连接
- **`vite.main.config.mjs`** — 添加 `build.rollupOptions.external: ['better-sqlite3']`，解决原生模块打包问题

### 26.5 数据库 Schema

```sql
-- suggestions: AI 分类建议
CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_rel_path TEXT UNIQUE NOT NULL,
  file_name TEXT, ext TEXT,
  suggested_folder TEXT, status TEXT DEFAULT 'pending',
  rationale TEXT, confidence REAL DEFAULT 0,
  classified_by TEXT DEFAULT '',
  user_feedback TEXT, agent_meta TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

-- source_records: 文件来源路径
CREATE TABLE source_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rel_path TEXT UNIQUE NOT NULL,
  source_path TEXT, source_dir TEXT,
  captured_at TEXT, extra TEXT
);

-- events: 分类事件流
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL, ts TEXT NOT NULL,
  file_name TEXT, ext TEXT,
  source_rel_path TEXT, source_dir TEXT,
  suggested_folder TEXT, actual_folder TEXT,
  rationale TEXT, confidence REAL,
  classified_by TEXT, user_feedback TEXT, extra TEXT
);

-- activity_log: 操作日志
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL, ts TEXT DEFAULT (datetime('now','localtime')),
  detail TEXT
);

-- conversations: 对话摘要（项目专员用）
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT, ts TEXT DEFAULT (datetime('now','localtime'))
);
```

---

## 27. 开发记录：分类 Agent 学习能力增强

### 27.1 问题发现

测试中发现，分类 Agent 在对同一文件重复分类时仍会犯同样的错误，无视用户先前写的拒绝反馈。排查发现两个根因：

1. **query_history 数据源错误**：原来查询 `suggestions` 表，但该表以 `source_rel_path` 为唯一键，重新上传同名文件会覆盖旧记录（包括 userFeedback），导致历史反馈丢失
2. **userFeedback 未传递**：`aiStorage/reject` IPC 处理中，`userFeedback` 只写入了 events 表，未同步写入 suggestions 表

### 27.2 修复方案

**query_history Tool 重构（`Agent/tools/queryHistory.js`）**：
- 数据源从 `suggestions` 表改为 **`events` 表**（`classify.accepted` / `classify.rejected` 事件）
- events 表是追加写入，每条记录独立，不会被覆盖，确保 userFeedback 永久可靠
- 返回字段增加 `actualFolder`、`userFeedback`、`sourceDir`
- Tool description 强调 userFeedback 是 "most valuable learning signal"

**System Prompt 升级（`Agent/prompts/systemPrompt.js`）**：
- 版本：`v5-visible-reasoning` → `v6-feedback-aware`
- 新增 `get_preferences` 为必调工具（Workflow Step 4）
- Workflow Step 3 强调关注 rejected 记录的 userFeedback
- 新增「证据优先级」7 层体系，userFeedback 为最高优先级
- Important Constraints 增加规则和偏好的考量要求

**aiStorage/reject IPC 修复（`main/ipc/aiStorage.js`）**：
- `setAiSuggestionStatus` 调用时增加 `userFeedback` 字段，确保 suggestions 表也存储反馈

### 27.3 ClassifyTraceView 增强（`ClassifyTraceView.jsx`）

- 新增 `HistoryItemCard` 组件：以卡片形式渲染 query_history 返回的每条记录，突出显示 `userFeedback`（黄色高亮框）
- query_history 结果含 userFeedback 时自动展开、显示"(含用户反馈)"徽章、图标变为琥珀色
- get_preferences 结果以结构化方式展示
- 新增"复制"按钮：一键复制完整 AI 思考线路（摘要 + 每个步骤的参数和结果）到剪贴板

---

## 28. 开发记录：项目专员 Agent

> 这是第二部分设计的核心实现。项目专员是一个有状态的、可对话的、具备读写能力的文件管理助理。

### 28.1 架构决策

- **先专员后主管**：先开发项目专员 Agent，Supervisor 在专员成熟后再开发
- **分类 Agent 作为超级工具**：项目专员通过 `classify_file` / `classify_batch` 工具委托给现有分类 Agent，不重复实现分类逻辑
- **Plan → Confirm → Execute**：所有写操作只生成计划 JSON，用户确认后由 `planExecutor` 执行
- **有状态有记忆**：项目专员拥有 `project-summary.md` 认知摘要 + `conversations` 表对话记录

### 28.2 模块 1：Agent Core（`desktop/Agent/project-agent/`）

**`prompts.js`**：
- 定义 Project Agent 的身份、能力、限制、可用工具列表
- 写操作规则：工具返回计划 JSON → Agent 必须向用户展示计划 → 附加 `<!-- ACTION_PLAN: {...} -->` 标记
- 对话风格：结构化回答、坦诚不确定、执行前必确认

**`memory.js`**：
- `readProjectSummary` / `writeProjectSummary` — 读写 `{projectDir}/meta/project-summary.md`
- `performFirstEncounter` — 首次接触项目时，扫描文件夹结构（每个文件夹最多 10 个文件，子文件夹递归），调用 LLM 生成认知摘要
- `lightUpdateSummary` — 每次会话结束时追加轻量笔记
- `deepUpdateSummary` — 定期完全重新生成摘要

**`createProjectAgent.js`**：
- 工厂函数，组装所有 Tools（复用 6 个 + 新建 4 读 + 4 写 + 2 超级）+ System Prompt
- 使用 `createReactAgent` from `@langchain/langgraph/prebuilt`
- `recursionLimit: 30` 允许更多轮次的 tool 调用

### 28.3 模块 2：4 个新 Read Tools

| Tool | 文件 | 功能 |
|---|---|---|
| `get_project_stats` | `tools/getProjectStats.js` | 统计文件数/大小/文件夹数/pending 建议数/最近事件时间 |
| `get_recent_events` | `tools/getRecentEvents.js` | 查询最近 N 条分类事件 + 操作日志（合并排序） |
| `search_files` | `tools/searchFiles.js` | 按文件名关键词/扩展名递归搜索项目文件 |
| `read_own_memory` | `tools/readOwnMemory.js` | 读取自己的 project-summary.md 认知摘要 |

### 28.4 模块 3：4 个 Write Tools + Plan Executor

**Write Tools**（只生成计划，不执行）：

| Tool | 文件 | 功能 |
|---|---|---|
| `move_files` | `tools/moveFiles.js` | 生成文件移动计划（验证路径 + 文件存在性） |
| `rename_file` | `tools/renameFile.js` | 生成文件重命名计划 |
| `create_folder` | `tools/createFolder.js` | 生成文件夹创建计划 |
| `update_folder_description` | `tools/updateFolderDescription.js` | 生成文件夹描述更新计划 |

每个 Write Tool 返回统一的 `actionPlan` JSON 结构：

```javascript
{
  planId: "uuid",
  type: "move_files" | "rename_file" | "create_folder" | "update_folder_description",
  operations: [{ id, description, from?, to?, name?, ... }],
  summary: "操作摘要"
}
```

**`planExecutor.js`**：
- 接收用户确认的计划 + 勾选的操作 ID 列表
- 逐条执行文件系统操作（move/rename/mkdir/update structure.json）
- 调用 `syncStructureJson`（注入依赖）刷新项目结构
- 每条操作记录到 `activity_log` 表
- 返回执行结果（成功/失败详情）

### 28.5 模块 4：2 个超级 Tools（分类委托）

| Tool | 文件 | 功能 |
|---|---|---|
| `classify_file` | `tools/classifyFileDelegate.js` | 委托给 `classifyFile()` 进行单文件分类 + 写入 ai-storage |
| `classify_batch` | `tools/classifyBatchDelegate.js` | 遍历文件列表，逐个调用 `classifyFile()` 进行批量分类 |

### 28.6 模块 5：Session 管理（`project-agent/session.js`）

- `ProjectAgentSession` 类：管理单个项目的对话生命周期
- `startSession()` — 初始化 Agent 实例，首次接触项目时触发 `performFirstEncounter`
- `sendMessage(text, onEvent)` — 流式调用 Agent，通过 LangGraph `streamEvents(v2)` 逐 token 推送
- `endSession()` — 生成对话摘要（LLM），写入 `conversations` 表，调用 `lightUpdateSummary` 更新记忆
- 内置 session 缓存，同一项目复用 session

### 28.7 模块 6：IPC + Streaming（`main/ipc/projectAgent.js`）

注册 4 个 IPC Handler：

| Handler | 功能 |
|---|---|
| `projectAgent/sendMessage` | 发起对话，通过 `evt.sender.send('projectAgent:stream-event', ...)` 实时推送流式事件 |
| `projectAgent/executePlan` | 执行用户确认的操作计划 |
| `projectAgent/endSession` | 结束当前会话，触发摘要和记忆更新 |
| `projectAgent/getSessionInfo` | 获取当前 session 状态（是否活跃、消息数等） |

流式事件类型：`text-delta`（增量文本）、`tool-start`（工具调用开始）、`tool-end`（工具调用结束）、`done`（完成）、`error`（错误）。

**Preload API**（`preload.js`）新增 `window.ipm.agent` 命名空间：
- `sendMessage(projectName, domain, message)` → IPC invoke
- `executePlan(projectName, domain, plan, selectedIds)` → IPC invoke
- `endSession(projectName, domain)` → IPC invoke
- `getSessionInfo(projectName, domain)` → IPC invoke
- `onStreamEvent(callback)` → IPC on/removeListener

---

## 29. 开发记录：Chat UI 设计

### 29.1 设计理念

参考 Claude 官网的对话页面设计，追求干净、简洁、大方的风格。

### 29.2 UI 形态变更

| 维度 | 旧设计 | 新设计 |
|---|---|---|
| 入口位置 | HeaderBar（项目内页面） | RootTable（"所有项目"页面），"偏好与记录"按钮右侧 |
| 面板类型 | 侧边栏（挤压主页面） | 覆盖式 Overlay（`fixed inset-0 z-50`） |
| 面板宽度 | 380px 窄栏 | 75% 主页面宽度（max 1100px） |
| 关闭方式 | 仅按钮 | 按钮 + 点击半透明背景 |
| 动画 | 无 | 背景淡入 + 面板从右侧滑入 |

### 29.3 组件清单

| 组件 | 文件 | 功能 |
|---|---|---|
| `ChatPanel` | `agent-chat/ChatPanel.jsx` | 覆盖式大面板容器：backdrop + 滑入面板 + header + body + input |
| `MessageList` | `agent-chat/MessageList.jsx` | 消息列表，空状态引导（欢迎语 + 示例提示），auto-scroll |
| `MessageBubble` | `agent-chat/MessageBubble.jsx` | 消息气泡：Agent 左对齐带头像 + 用户深色气泡右对齐 |
| `ChatInput` | `agent-chat/ChatInput.jsx` | 圆角输入框 + 圆形发送按钮（ArrowUp），auto-resize |
| `ActionPlanCard` | `agent-chat/ActionPlanCard.jsx` | 写操作计划卡片：checkbox 列表 + 确认/取消 + 执行结果 |
| `useAgentChat` | `agent-chat/hooks/useAgentChat.js` | React Hook：管理消息/流式/pending plan 状态 |

### 29.4 集成方式

- **`RootTable.jsx`**：新增"AI 助理"列 + 按钮（每个项目独立入口）
- **`ProjectManager.jsx`**：`chatProjectCtx` state（存储选中项目），ChatPanel 以 fixed overlay 渲染
- **`HeaderBar.jsx`**：移除旧的 Agent 按钮（入口已移至 RootTable）
- **`index.html`**：新增 `animate-chat-backdrop`（背景淡入）+ `animate-chat-panel`（面板滑入）CSS 动画

### 29.5 消息区域布局

```
┌──────────────────────────────────────────────────┐
│  [Bot Icon] AI 助理                    [新对话] [×] │  ← header
│  项目名称                                          │
├──────────────────────────────────────────────────┤
│                                                    │
│              ┌─────────────────┐                   │
│              │    ✨            │                   │
│              │ 有什么可以帮你的？│  ← 空状态引导      │
│              │ [示例提示标签]   │                   │
│              └─────────────────┘                   │
│                                                    │
│  ┌─ max-w-3xl mx-auto ───────────────────┐       │
│  │ [Agent 头像] Agent 消息文本（无气泡）  │       │
│  │              ┌── Tool Card ──────┐    │       │
│  │              │ tool_name         │    │       │
│  │              └───────────────────┘    │       │
│  │                                       │       │
│  │              ┌ 用户消息（深色气泡）─┐  │       │
│  │              │ 用户输入内容        │  │       │
│  │              └────────────────────┘  │       │
│  └───────────────────────────────────────┘       │
│                                                    │
├──────────────────────────────────────────────────┤
│  ┌─ max-w-3xl mx-auto ───────────────────┐       │
│  │ ┌──────────────────────────────── ⬆ ┐ │       │
│  │ │ 发送消息...                         │ │  ← 输入框
│  │ └────────────────────────────────────┘ │       │
│  │        Enter 发送 · Shift+Enter 换行   │       │
│  └───────────────────────────────────────┘       │
└──────────────────────────────────────────────────┘
```

---

## 30. 开发记录：B1 架构升级（LangGraph Checkpointer + Interrupt）

### 30.1 问题背景

测试中发现：当用户要求项目专员执行多步骤任务（如"创建文件夹然后移动文件"）时，Agent 在第一个写操作被用户确认并执行后就**停止了**，不会继续执行后续步骤。

**根因**：写操作的执行结果只作为前端 system 消息展示，从未回传给 Agent。Agent 不知道操作已完成，无法继续推理下一步。

此外，对话历史由 `session.js` 中一个手动维护的 `this.messages` JavaScript 数组管理，每次 `sendMessage` 都将完整数组传给 `agent.streamEvents()`，未利用 LangGraph 的原生状态管理能力。

### 30.2 方案选型

经过分析，对比了两种方案：

| 方案 | 原理 | 优劣 |
|---|---|---|
| **B2：消息级重新唤起** | 执行完成后自动发一条"已完成"消息给 Agent，Agent 重新推理 | 简单，但每次重发完整历史，Agent 需重新理解上下文 |
| **B1：LangGraph interrupt + checkpointer** | 写工具内调用 `interrupt(plan)` 暂停图执行，用户确认后通过 `Command({ resume })` 精确恢复 | 更精确，token 更省，状态由框架管理 |

**选择 B1**。理由：
- 项目已使用 `@langchain/langgraph@^1.2.1`，`MemorySaver`、`interrupt`、`Command` 均已在包内导出
- B1 是 LangGraph 设计的标准用法，不再需要手动维护消息数组
- Agent 从断点精确恢复，不需要重新处理历史消息，token 消耗更低
- 天然支持多步骤链路（每次 interrupt 暂停 → 确认 → 恢复 → 继续下一步）

### 30.3 核心概念

- **`MemorySaver`**：LangGraph 的内存 checkpointer，保存图执行的完整状态（消息、工具调用链、中间推理）
- **`thread_id`**：标识一个独立的对话会话，同一 Agent 实例可同时处理多个 thread
- **`interrupt(value)`**：在 Tool 函数内调用，暂停图执行，value 会传递给调用方；用户确认后通过 `Command({ resume })` 恢复，resume 值作为 `interrupt()` 的返回值
- **`Command({ resume })`**：恢复被 interrupt 暂停的图，传入的值由 Tool 函数中的 `interrupt()` 接收

### 30.4 改动文件

**后端 — Agent 层：**

**`createProjectAgent.js`**：
- 新增 `import { MemorySaver } from '@langchain/langgraph'`
- 创建 `const checkpointer = new MemorySaver()` 并传入 `createReactAgent({ ..., checkpointer })`
- `recursionLimit` 从 25 提升到 30（interrupt/resume 消耗额外步数）

**`prompts.js`**：
- 版本升级 `v1-project-agent` → `v2-interrupt-flow`
- 移除 `<!-- ACTION_PLAN: {...} -->` 标记规则（不再需要 Agent 在回复中嵌入 plan）
- 新增说明：写操作工具会**自动暂停等待确认**，确认后系统将结果返回给 Agent
- 明确告知 Agent 可以在一次对话中连续调用多个写操作，每个都会自动暂停

**4 个 Write Tools（`moveFiles.js`、`renameFile.js`、`createFolder.js`、`updateFolderDescription.js`）**：
- 新增 `import { interrupt } from '@langchain/langgraph'`
- 构建 plan 后不再 `return JSON.stringify(plan)`，改为 `const result = interrupt(plan)`
- `interrupt(plan)` 暂停图执行，plan 传递给前端展示
- 用户确认后，`interrupt()` 返回执行结果（由 IPC 层通过 `Command({ resume })` 注入）
- Tool 函数根据结果生成人类可读的文本返回给 Agent（如"已创建文件夹「合同文件」。"）
- 用户取消时返回"用户取消了操作。"

**`session.js`**（核心重写）：
- **删除** `this.messages` 数组 → 对话历史完全由 checkpointer 管理
- **新增** `this.threadId`（即 `thread_id`），每个 session 一个 UUID
- `sendMessage(text)` 只传 `{ messages: [新消息] }` + `configurable: { thread_id }`，checkpointer 自动拼接历史
- **新增** `resumeAfterApproval(executionResult)` — 用 `new Command({ resume: executionResult })` 恢复图执行
- **新增** `_streamAgent(input)` 私有方法，统一处理流式事件收集 + interrupt 检测
- interrupt 检测：流结束后通过 `agent.getState(config)` 检查 `tasks[].interrupts`，如有则发 `{ type: 'interrupt', plan }` 事件
- `_generateConversationSummary()` 从 `agent.getState()` 读取历史消息（而非手动数组）
- `startSession()` 中的上下文注入改为通过 `agent.invoke()` + `thread_id` 完成（checkpointer 自动保存）

**后端 — IPC 层：**

**`projectAgent.js`**：
- `executePlan` handler 改为三步流程：① 调 `planExecutor` 执行文件操作 → ② 发 `plan-result` 流式事件 → ③ 调 `session.resumeAfterApproval(result)` 流式推送 Agent 后续响应
- **新增** `cancelPlan` handler：调 `session.resumeAfterApproval({ cancelled: true })`，让 Agent 知道用户取消了操作
- 抽取 `streamSessionEvents()` 辅助函数，统一处理 generator → stream-event 推送

**前端：**

**`preload.js`**：
- 新增 `cancelPlan: (projectName, domain) => ipcRenderer.invoke('projectAgent/cancelPlan', ...)`

**`useAgentChat.js`**：
- 新增 `interrupt` 事件处理：设置 `pendingPlan`，停止 streaming 状态
- 新增 `plan-result` 事件处理：显示执行结果 system 消息 + 准备接收 Agent 续接流
- `executePlan` 改为只调 IPC（结果通过流式事件驱动，不再手动添加消息）
- `cancelPlan` 改为调用后端 `cancelPlan` IPC（resume with cancelled），Agent 收到取消信息后自然回复

### 30.5 新的多步骤操作流程

```
用户: "创建一个合同文件夹，把聘用合同移进去"

① sendMessage → Agent 推理 → 调用 create_folder Tool
② Tool 内 interrupt(plan) → 图暂停 → 前端收到 interrupt 事件 → 显示 ActionPlanCard
③ 用户点击确认 → executePlan IPC → planExecutor 执行创建 → 发 plan-result 事件
④ Command({ resume: result }) → 图恢复 → Tool 返回 "已创建文件夹「合同文件」"
⑤ Agent 继续推理 → 调用 move_files Tool
⑥ Tool 内 interrupt(plan) → 图再次暂停 → 前端显示第二个 ActionPlanCard
⑦ 用户点击确认 → 执行移动 → resume → Tool 返回 "移动完成：1 个文件成功"
⑧ Agent 收到结果 → 输出总结 "已完成！创建了合同文件夹并移入了聘用合同。"
⑨ done 事件 → 流结束
```

### 30.6 与旧方案的对比

| 维度 | 旧方案（手动 messages 数组） | 新方案（checkpointer + interrupt） |
|---|---|---|
| 对话历史管理 | `this.messages` 手动 push/传递 | `MemorySaver` + `thread_id` 框架自动管理 |
| 每次传给 Agent 的内容 | 完整历史数组（越来越大） | 只传新消息，框架自动拼接 |
| 多步写操作 | 第一步确认后就停止 | 自动从断点恢复，继续执行下一步 |
| 用户取消操作 | 前端本地取消，Agent 不知情 | `cancelPlan` resume 让 Agent 知道取消原因 |
| Token 消耗 | 每轮重发完整历史 | 恢复时不重新处理历史 |
| 中间状态 | 丢失（只存文本） | 完整保存（Tool 调用链、推理过程） |

---

## 31. Bug 修复：写操作工具重复执行问题

### 31.1 问题现象

测试多步骤任务（如"创建文件夹并移动文件"）时，发现以下异常：

1. 用户确认操作后，原始工具卡片仍显示"执行中..."
2. 同一个写操作工具（如 `create_folder`）出现了**两次**卡片
3. 第一次正常执行成功，第二次返回 `already exists` 错误
4. Agent 因第二次错误而误判，认为目标已存在，影响后续判断
5. 所有需要用户确认的写操作工具（move_files, rename_file, create_folder, update_folder_description）均存在此问题

### 31.2 根因分析

**LangGraph `interrupt()` 的核心机制**：根据官方文档，当图恢复时，包含 `interrupt()` 的整个节点（工具函数）会**从头重新执行**。`interrupt()` 在重新执行时直接返回 `Command({ resume })` 传入的值，而不是再次暂停。

> "The node restarts from the beginning of the node where the interrupt was called when resumed, so any code before the interrupt runs again"
> — LangGraph 官方文档

**旧流程的致命缺陷**：

```
① Agent 调用 create_folder → 验证通过 → 构建 plan → interrupt(plan) 暂停
② 用户确认 → IPC executePlan 调用 planExecutor ──→ 【此处先执行了 fs.mkdirSync】
③ session.resumeAfterApproval({ approved, succeeded: 1, ... })
④ LangGraph 恢复 → 工具函数从头重新执行
⑤ 工具再次执行 fs.existsSync(absPath) → TRUE（步骤②已经创建了！）
⑥ 工具返回 { error: "Folder already exists." }，interrupt() 永远不会被执行到
⑦ Agent 误判文件夹早已存在，后续逻辑出错
```

核心矛盾：**planExecutor 在图恢复之前就执行了文件操作**，而工具函数在图恢复时从头重执行，验证逻辑因文件系统状态已变而失败。

### 31.3 修复方案：执行逻辑移入工具内部

将文件操作的执行逻辑从外部 `planExecutor` 移入写操作工具函数内部，放在 `interrupt()` 返回之后。IPC 层不再预先执行操作，只发送用户决策（`{ approved, selectedIds }`）作为恢复值。

**修复后的工具函数流程**（以 `create_folder` 为例）：

```
首次执行（中断前）：
  验证(文件夹不存在) ✓ → 构建 plan → interrupt(plan) → 暂停

恢复后重新执行：
  验证(文件夹不存在) ✓（此时还未创建！）→ 构建 plan → interrupt(plan) 返回 decision
  → if approved → fs.mkdirSync() 创建文件夹 → 返回成功消息给 Agent
  → if cancelled → 返回取消消息给 Agent
```

### 31.4 修改文件清单

**后端 — 4 个写操作工具**：

- `Agent/tools/createFolder.js` — 执行 `fs.mkdirSync` + 更新 `structure.json` + activity 日志
- `Agent/tools/moveFiles.js` — 遍历 `selectedIds` 执行 `fs.renameSync` + activity 日志
- `Agent/tools/renameFile.js` — 执行 `fs.renameSync` + activity 日志
- `Agent/tools/updateFolderDescription.js` — 读写 `structure.json` + activity 日志

所有工具统一模式：
```javascript
// 1. 验证参数
// 2. 构建 plan
const decision = interrupt(plan);          // 暂停，等待用户确认
if (decision?.cancelled) return '用户取消了操作。';
// 3. 执行实际文件操作（仅在 interrupt 返回后才执行）
try {
  // fs 操作 + activity 日志
  return '操作成功描述';
} catch (e) {
  return `操作失败：${e.message}`;
}
```

**后端 — IPC 层**：

`src/main/ipc/projectAgent.js`：
- `executePlan` handler：移除 `planExecutor` 调用，直接 `session.resumeAfterApproval({ approved: true, selectedIds })`
- 恢复完成后调用 `syncStructureJson` 同步项目结构（best-effort）
- `sendMessage` handler 完成后也加了 `syncStructureJson`（Agent 可能通过工具修改了结构）
- 移除了 `executePlan` 的 import

**前端 — useAgentChat.js**：

- `interrupt` 事件：将运行中工具状态改为 `interrupted`（而非保持 `running`）
- `executePlan` 回调：立即清除 `pendingPlan`、创建新的流式 assistant 消息（等待 Agent 续接）
- 移除了 `plan-result` 事件处理（不再需要，执行结果通过 Agent 工具返回值自然传达）

**前端 — MessageBubble.jsx**：

- `ToolCallCard` 新增 `interrupted` 状态：橙色暂停图标 + "等待确认"文字（区别于蓝色"执行中"）

### 31.5 修复后的多步骤流程

```
用户: "创建一个合同文件夹，把聘用合同移进去"

① sendMessage → Agent 推理 → 调用 create_folder Tool
② Tool 验证 → 构建 plan → interrupt(plan) → 暂停
   前端：工具卡片显示 [⏸ create_folder 等待确认]
   前端：ActionPlanCard 展示操作计划
③ 用户点击确认 → executePlan IPC → Command({ resume: { approved: true } })
④ 图恢复 → Tool 从头重执行 → 验证通过 → interrupt() 返回 { approved: true }
   → 执行 fs.mkdirSync → 返回 "已创建文件夹「合同专项」"
   前端：新 assistant 消息中显示 [✓ create_folder 完成]
⑤ Agent 继续推理 → 调用 move_files Tool
⑥ Tool 验证 → interrupt(plan) → 暂停 → 前端显示第二个 ActionPlanCard
⑦ 用户确认 → resume → Tool 执行 fs.renameSync → 返回 "移动完成：1 个文件成功"
⑧ Agent 输出总结 → done 事件 → 流结束
```

### 31.6 关键教训

| 要点 | 说明 |
|---|---|
| interrupt 重执行机制 | LangGraph 恢复时**整个节点从头执行**，不是从 `interrupt()` 处继续 |
| 副作用时机 | 有状态的操作（文件系统变更）必须放在 `interrupt()` 返回**之后**，不能提前执行 |
| 验证幂等性 | 工具中 `interrupt()` 前的验证代码会执行两次，必须保证在执行前它们仍然能通过 |
| 执行位置原则 | **谁暂停，谁执行** — 写操作工具自己发起 interrupt，也应该自己执行操作 |

---

## 32. 文件夹描述增强

### 32.1 背景

系统中每个文件夹有一个 `description` 字段，是分类 AI 理解文件夹用途的核心依据。但项目专员在创建文件夹时缺少对描述的重视和引导。

### 32.2 修改内容

**Bug 修复 — `createFolder.js` 的 `updateStructureDescription`**：

新建文件夹时描述写不进 `structure.json`，因为该函数只更新已存在的条目，而新文件夹还未被 `syncStructureJson` 注册。修复后如果条目不存在会先创建完整条目（含 `relPath`、`name`、`createdAt`），再写入描述。

**Plan 描述增强**：创建文件夹的确认卡片现在显示文件夹描述，如 `创建文件夹「证据相关」（与证据梳理、证据目录相关的过程文档）`。

**系统提示词升级（v3-folder-desc）**：新增"文件夹描述规则"章节：
- 创建文件夹时引导用户提供描述（非强制，用户可跳过）
- 描述要具体实用，给出示例
- 发现缺失描述时可主动建议补充

---

## 33. 架构讨论：Supervisor 的自我进化能力

### 33.1 三级 Agent 架构

```
Level 0: 分类 Agent      — 超级 Tool，能力固定，不对话，被项目专员调用
Level 1: 项目专员 Agent   — 有对话能力，从预定义的 Tool 池中选用，处理具体项目
Level 2: Supervisor      — 全局主管，能创建 Skills/Tools，具有自我进化能力
```

能力范围和复杂程度逐级递增。Level 0 是 Level 1 的工具，Level 1 是 Level 2 的下属。

### 33.2 Tool 架构基础

当前系统的 Tool 设计基于 LangChain 的 `tool()` 函数 + Zod schema：

```
工厂函数 createXxxTool(projectDir) → 返回绑定了项目路径的 tool 实例
```

本质是把已有的 Node.js 能力（`fs` 操作、SQLite 查询等）包装成 LLM 可理解的接口（名称 + 描述 + 参数定义 + 返回值）。`tool()` 本身只是适配器，不提供业务逻辑。

当前 16 个工具分三类：
- **读操作**（10 个）：直接执行，返回 JSON
- **写操作**（4 个）：`interrupt()` 暂停等待确认，确认后在工具内部执行
- **超级工具**（2 个）：委托给分类子 Agent

### 33.3 Skills 与 Tools 的区别

| 概念 | 本质 | 类比 |
|---|---|---|
| **Tools** | 代码函数，真正执行操作 | 手和厨具 |
| **Skills** | 文本文件，描述工作流和步骤 | 菜谱 |
| **Soul/Prompt** | 身份定义和行为原则 | 厨师的风格 |

Skills 本身不能执行任何操作。一个"移动文件"的 Skill 仍然需要调用 `move_files` Tool 来完成实际移动。Skills 的价值在于降低 LLM 的推理难度——给它现成的步骤模板，而不是让它从零推理。

### 33.4 两种架构范式对比

**专用工具模式（我们当前）**：
```
Agent → 调用预先编码的专用工具（move_files）→ 执行
```
- 优点：安全、可预测、输入输出明确
- 缺点：新能力需要开发者写新工具代码

**通用执行器 + Skills 模式（OpenClaw 等）**：
```
Agent → 写脚本/命令 → 调用通用执行器（run_bash）→ 执行
```
- 优点：极其灵活，写文本即可扩展能力
- 缺点：安全风险（任意代码执行）、生成代码可能有 bug、调试困难

### 33.5 绕过动态注册的关键设计

LangChain 的 `createReactAgent` 在创建时固定工具列表，动态注册新工具技术复杂度高。但可以通过**"万能适配器"模式**完全绕过：

**预注册一个通用脚本执行工具 `run_script`**，Agent 需要新能力时不注册新工具，而是写一个脚本文件保存到磁盘，然后通过 `run_script` 执行：

```
预注册的固定工具：run_script（执行器）
动态创建的内容：脚本文件（被执行的对象）

存储位置：meta/scripts/
  archive-by-month.js      ← Supervisor 创建
  batch-rename-docs.js     ← Supervisor 创建
```

**工具数量始终固定，变化的是脚本内容。** 不需要突破 LangChain 框架限制。

### 33.6 脚本沙箱安全方案

| 方案 | 原理 | 安全级别 | 灵活性 |
|---|---|---|---|
| A. 白名单模块沙箱 | 脚本只能使用 `fs`、`path` 等白名单模块，禁止 `child_process`、`net` 等 | 中 | 高 |
| B. 只允许调用已有工具 | 脚本通过 `tools.moveFiles()`、`tools.createFolder()` 等封装接口操作，不直接访问 `fs` | 高 | 中 |
| C. 人工审批激活 | 生成的脚本走 `interrupt()` 确认流程，用户看到代码并批准后才保存激活 | 最高 | 高 |

推荐 **B + C 组合**：脚本只能组合已有的安全工具（灵活性来自组合，安全性来自工具本身的约束），且新脚本需用户审批才激活。

### 33.7 分阶段演进路径

**阶段 1：Supervisor 能创建 Skills（文本）** — 近期可做

Supervisor 观察用户重复操作模式，总结成 Skill 文本保存。下次类似场景，Skill 加载到专员上下文中指导执行。这是"软偏好"的高阶版本——软偏好说"这类文件倾向去这个文件夹"，Skill 说"遇到这类场景按这个流程处理"。

**阶段 2：Supervisor 能创建复合操作（编排已有工具）** — Supervisor 开发时同步考虑

不写新代码，而是编排已有工具的调用序列，形成可一键触发的"宏"。底层调用的仍是已有的安全工具。通过 `run_script` + 方案 B 沙箱实现。

**阶段 3：Supervisor 能在沙箱中创建自由脚本** — 远期愿景

需要成熟的沙箱、审核机制、版本控制。等阶段 1、2 稳定运行后再评估。对面向非技术用户的产品，安全性和可控性始终优先。

---

## 34. 开发记录：对话持久化 + Token 压缩 + 操作撤销

### 34.1 数据库 Schema 升级（版本 1 → 2）

`init.js` 新增两张表 + `activity_log` 增列：

- **`chat_sessions`**：对话会话索引（id, title, status, message_count, summary, created_at, updated_at），status 可为 active / ended / interrupted
- **`chat_messages`**：逐条消息存储（session_id, role, content, tools_json, created_at），外键关联 chat_sessions，级联删除
- **`activity_log` 增列**：`session_id`（关联对话）、`is_undone`（是否已撤销）、`undo_data`（撤销所需的反向信息 JSON）

新建仓库：
- `chatSessions.js` — createSession, updateSession, listSessions, getSessionById, deleteSession, markActiveSessions
- `chatMessages.js` — appendMessage, listMessages, countMessages

`activityLog.js` 增强：appendLog 支持 `{ sessionId, undoData }` extra 参数，新增 getLogById, getLastUndoableLog, markUndone

### 34.2 对话持久化后端（session.js 改造）

- **startSession()**：标记遗留 active session 为 interrupted → 写入新 chat_sessions 记录
- **消息保存**：_persistUserMessage / _persistAssistantMessage 每轮自动写 chat_messages，第一条用户消息自动设置 session title
- **endSession()**：生成 summary → 更新 chat_sessions 状态为 ended → 兼容旧 conversations 表

新增 IPC：projectAgent/listSessions, projectAgent/loadSession, projectAgent/deleteSession

### 34.3 历史对话续聊

加载历史对话后可继续发送消息（非只读），实现方案 C（摘要 + 最近消息注入）：

- `session.js` 新增 `resumeHistoricalSession(sessionId)` — 从 DB 读取历史 session 的 summary + 最近 6 条消息，创建新 Agent 并注入上下文
- 注入的 system context 包含 project_summary、conversation_summary、recent_messages
- 续聊产生的新消息写入原始 session ID（通过 `_dbSessionId` getter），保证历史和新对话在同一个 session 下
- 新增 IPC：projectAgent/resumeSession
- 前端 `useAgentChat.js` 新增 `listSessionId` 跟踪数据库中的 session id（与 LangGraph threadId 区分）

### 34.4 历史下拉菜单 UI

新组件 `HistoryDropdown.jsx`：
- 右对齐弹出（`right-0`），避免贴屏幕右侧被裁切
- 按时间分组：今天 / 昨天 / 本周 / 更早
- 每条显示 title + 时间 + 消息数 + interrupted 状态标记
- 单条删除（固定显示删除按钮）+ 清空全部功能
- 点击加载历史消息并恢复 Agent 上下文，可续聊

`ChatPanel.jsx` 集成 HistoryDropdown，支持 readonly banner（保留但当前续聊模式下不触发）

### 34.5 Token 压缩（智能触发 + 滚动摘要 + 双模型）

三个核心技巧：

**1. Token 数量触发（替代固定轮数）**：
- `estimateTokens()` 估算中文 ~1.5 tokens/字、ASCII ~0.25 tokens/字
- 阈值 `TOKEN_COMPRESS_THRESHOLD = 3000`，每轮发送前检查
- 用户某轮发长文可能第 2 轮就触发；短对话到第 20 轮可能都不触发

**2. 滚动式摘要（Rolling Summary）**：
- 维护 `_rollingSummary` 字段
- 压缩时只把被淘汰的旧消息 + 旧摘要一起生成新摘要（增量更新，不重新总结全部历史）
- `_updateRollingSummary()` 方法实现

**3. 廉价小模型做摘要**：
- `llm.js` 新增 `createSummaryModel()` — 读取 `OPENAI_SUMMARY_MODEL` 环境变量，未配置则降级为主模型
- 所有摘要操作使用小模型，对话回复使用主模型

### 34.6 操作撤销

**后端**：
- 4 个写工具（moveFiles, renameFile, createFolder, updateFolderDescription）的 appendLog 增强 — 传入 sessionId + undoData，成功返回值中嵌入 `_undoId`
- 工具通过 `ctx`（toolContext 对象）获取当前 sessionId，由 session.js 在 startSession 和 compress 时更新
- `undoExecutor.js` — 支持 4 种操作的反向执行（移动→反向移动、重命名→还原名称、创建文件夹→删除空文件夹+清理 structure.json、更新描述→恢复旧描述）
- `undoLastAction.js` — Agent 工具，走 interrupt() 确认流程
- 新增 IPC：projectAgent/undoAction

**前端**：
- `session.js` 的 `_streamAgent` 解析工具返回中的 `_undoId`，在 tool-end 事件中传递 `undoActionId`
- `useAgentChat.js` 在 tool-end 处理中传递 undoActionId 到工具卡片数据
- `MessageBubble.jsx` 的 ToolCallCard：写操作成功后显示小的"撤销"按钮（Undo2 图标），支持 loading / done / error 状态

### 34.7 Prompt 版本升级至 v4-undo

新增 undo_last_action 工具描述，写操作规则中包含撤销操作。

---

## 35. 开发记录：分类教导工具 + Markdown 渲染

### 35.1 四个新工具

| 工具 | 类型 | 功能 |
|---|---|---|
| **add_classify_rule** | 直接执行 | 根据用户自然语言描述添加硬规则（targetFolder + conditions） |
| **add_preference** | 直接执行 | 根据用户描述添加软偏好（pattern + conditions + tendency） |
| **list_classify_events** | 直接执行 | 查询分类事件记录，支持按类型和关键词搜索 |
| **add_event_feedback** | 直接执行 | 为被拒绝的分类事件添加/更新反馈 |

### 35.2 Prompt 升级至 v5-teaching

新增"教导分类系统规则"章节，指导 Agent：
- **硬规则 vs 软偏好自动选择**：根据用户表达的确定性程度判断
- **信息不完整时主动引导**：逐步询问目标文件夹、匹配条件、确定性程度
- **事件反馈完整流程**：查找事件 → 确认 → 引导描述原因 → 保存反馈 → 主动建议是否转化为规则

### 35.3 Markdown 渲染增强

引入 `marked` 库替换简陋的正则替换：
- Assistant 消息使用 `marked.parse()` 渲染完整 markdown
- `index.html` 新增 `.prose-chat` 样式类，覆盖标题、列表、表格、代码块、引用等所有常见元素
- 代码块使用深色主题（#1e293b）、行内代码使用浅灰背景+粉红色
- 用 `useMemo` 缓存渲染结果避免重复解析

### 35.4 当前工具全景（v5-teaching，共 21 个）

**读操作（10 个）**：browse_structure, inspect_folder, get_source_info, query_history, get_user_rules, get_preferences, get_project_stats, get_recent_events, search_files, read_own_memory

**写操作（5 个，interrupt 确认）**：move_files, rename_file, create_folder, update_folder_description, undo_last_action

**教导工具（4 个，直接执行）**：add_classify_rule, add_preference, list_classify_events, add_event_feedback

**超级工具（2 个，委托）**：classify_file, classify_batch

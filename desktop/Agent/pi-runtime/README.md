# `pi-runtime` — KnowClaw 运行时

KnowClaw 的核心 AI 运行时，基于 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 构建。提供 Claude Code 级别的 agent 能力：多轮对话、工具调用、文件读写、Skill 系统、会话持久化。

> 完整开发历程与决策记录：[`../KNOWCLAW_REBUILD_PLAN.md`](../KNOWCLAW_REBUILD_PLAN.md)

## 架构总览

```
                         Electron Main Process (CJS, Vite-bundled)
                        ┌───────────────────────────────────────────┐
                        │  main.js                                  │
                        │    ├─ registerKnowClawIpc()               │
                        │    │   → src/main/ipc/knowclaw.js         │
                        │    │     imports business deps (db, etc.)  │
                        │    │     injects them as toolDeps ──────┐  │
                        │    └─ env: KNOWCLAW_SESSION_ROOT        │  │
                        │         KNOWCLAW_USER_SKILLS_ROOT       │  │
                        └─────────────────────────────────────────┼──┘
                                                                  │
         ┌────────────────────────────────────────────────────────┘
         │  ESM boundary (pi-runtime has own package.json type:module)
         ▼
  ┌──────────────────────────────────────────────────────────┐
  │  pi-runtime/                                             │
  │                                                          │
  │  index.js ◄── 唯一公开入口                                │
  │    │                                                     │
  │    ├── bootstrap.js     ← 会话工厂 (createSession)       │
  │    │     ├── ipmConfig.js   ← 读 state.json / .env      │
  │    │     ├── auth.js        ← AuthStorage (内存)         │
  │    │     ├── models.js      ← ModelRegistry (ipm-openai) │
  │    │     ├── sessionFactory.js ← JSONL SessionManager    │
  │    │     ├── promptBuilder.js  ← KnowClaw 系统 prompt    │
  │    │     ├── tools/                                      │
  │    │     │    ├── projectTools.js ← 5 个 IPM 业务工具     │
  │    │     │    └── webTools.js     ← fetch_web 工具       │
  │    │     └── skills/                                     │
  │    │          └── skill-builder/SKILL.md                  │
  │    │                                                     │
  │    └── @earendil-works/pi-coding-agent  (external)       │
  │           createAgentSession / DefaultResourceLoader      │
  │           defineTool / AuthStorage / ModelRegistry        │
  └──────────────────────────────────────────────────────────┘
         │
         │  IPC events (knowclaw:event)
         ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Renderer Process                                        │
  │  window.ipm.knowclaw.* (preload.js)                      │
  │    └── knowclaw-v2/                                      │
  │         ├── useKnowClawV2Chat.js  ← React hook           │
  │         ├── KnowClawV2Page.jsx    ← 聊天主页面           │
  │         └── SessionPanel.jsx      ← 会话历史侧栏         │
  └──────────────────────────────────────────────────────────┘
```

## 模块职责

| 文件 | 职责 |
|------|------|
| `index.js` | **唯一公开入口**。所有外部模块应只从这里 import。导出 `createSession`、`disposeSession`、`listSessions`、`listAvailableModels`、`setModel` 等 |
| `bootstrap.js` | 会话工厂核心。编排 config→auth→model→session→tools→prompt→skills 的完整流水线 |
| `ipmConfig.js` | 读取 IPM 的 LLM 配置：优先 `state.json prefs.llm`，然后 `.env`，最后 `process.env` |
| `auth.js` | 构建内存 `AuthStorage`，运行时注入 API Key（不写磁盘、不污染 pi 全局 config） |
| `models.js` | 在 `ModelRegistry` 上注册 `ipm-openai` provider，支持多模型（如 gpt-5.1 + gpt-5.4-nano） |
| `sessionFactory.js` | 封装 `SessionManager`，支持 4 种模式：`new` / `continueRecent` / `open` / `inMemory`。会话文件存储在 `%APPDATA%/IPM/knowclaw-sessions/` |
| `promptBuilder.js` | 构建 KnowClaw 专属系统 prompt：身份、能力、工作原则、对话风格、domain 参数说明、用户名个性化 |
| `tools/projectTools.js` | 5 个 IPM 业务只读工具：`list_projects`、`cross_project_stats`、`proactive_check`、`get_recent_events`、`query_history` |
| `tools/webTools.js` | `fetch_web` 工具（pi 无内置 HTTP fetch） |
| `skills/skill-builder/SKILL.md` | 内置 skill：教 agent 为用户创建新的 pi-native skill |

## 关键设计决策

### ESM / CJS 边界

pi-coding-agent 是 ESM-only 包。Electron 的主进程经 Vite 编译为 CJS。解决方案：

- `pi-runtime/package.json` 声明 `"type": "module"`，使本目录内的 `.js` 被 Node 识别为 ESM
- `main.js` 通过 `pathToFileURL` + `/* @vite-ignore */` 动态 import pi-runtime
- pi-coding-agent 在 `vite.main.config.mjs` 和 `forge.config.js` 中声明为 external，不被 Vite 打包

### 依赖注入（跨 ESM 边界传递 IPM 业务逻辑）

pi-runtime (ESM) 无法直接 import `Agent/db/`、`Agent/shared/` 等文件（它们虽然用 ESM 语法但位于 CJS 默认的包下）。

解决方案：`knowclaw.js`（Vite 编译的 CJS 侧）import 这些业务模块，将函数引用打包为 `toolDeps` 对象传给 `createSession()`，后者再分发给 `buildProjectTools(toolDeps)`。

### 内存隔离

- `AuthStorage`、`ModelRegistry` 均为内存实例，不读写 pi 的全局 `~/.pi/` 配置
- API Key 通过 `applyIpmRuntimeKey()` 运行时注入，不写入任何文件

### 会话存储

- JSONL 格式，每个 cwd 一个子目录
- 路径：`KNOWCLAW_SESSION_ROOT / <escaped-cwd> / <timestamp>_<session-id>.jsonl`
- 支持 fork（在指定 entry 截断复制出新 session）

## 扩展指南

### 添加一个新 customTool

1. 在 `tools/` 下新建文件（如 `myTool.js`），使用 `defineTool` + TypeBox schema：

```javascript
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';

export function buildMyTools(deps) {
  return [
    defineTool({
      name: 'my_tool',
      label: 'My Tool',
      description: '工具描述（LLM 可见）',
      promptGuidelines: ['仅在 XXX 场景使用'],
      parameters: Type.Object({
        input: Type.String({ description: '参数说明' }),
      }),
      async execute(_toolCallId, params) {
        // 使用 deps 中注入的业务函数
        const result = deps.someFunction(params.input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: null,
        };
      },
    }),
  ];
}
```

2. 在 `bootstrap.js` 中 import 并拼接到 `customTools` 数组：

```javascript
import { buildMyTools } from './tools/myTool.js';
// ... 在 createSession 中：
const myTools = buildMyTools(toolDeps);
customTools = customTools.concat(myTools);
```

3. 如果工具需要 IPM 业务依赖（db 查询等），在 `knowclaw.js` 的 `toolDeps` 中添加对应函数。

### 添加一个新 Skill

1. 在 `skills/` 下新建目录 `<skill-name>/SKILL.md`
2. 文件格式：YAML frontmatter + Markdown 指导文本

```markdown
---
name: my-skill
description: 触发条件描述（LLM 判断是否使用）
---

# My Skill

## 何时使用
...

## 工作流
1. ...
2. ...
```

3. 重启应用，skill 会被 `DefaultResourceLoader` 的 `additionalSkillPaths` 自动加载
4. 用户也可以在 `%APPDATA%/IPM/knowclaw-skills/` 下创建自定义 skill（相同格式）

### 修改系统 Prompt

编辑 `promptBuilder.js` 中的 `buildKnowClawPrompt()` 返回值。注意：

- **不要**在 prompt 中硬编码工具名——工具列表由 pi 从 tool registry 自动注入
- **不要**在 prompt 中硬编码 skill 内容——skill 由 `DefaultResourceLoader` 自动拼接
- 仅在此处定义 KnowClaw 的身份、能力概述、工作原则和对话风格

### 切换 / 添加 LLM 模型

模型由 `ipmConfig.js` 从三个来源读取（按优先级）：

1. `state.json` → `prefs.llm.model`（设置界面配置）
2. `desktop/Agent/.env` → `OPENAI_MODEL`
3. `process.env.OPENAI_MODEL`

要添加新模型，在 `models.js` 的 `registerIpmProvider()` 中修改模型列表。当前支持的模型名从 `.env` 的 `OPENAI_MODEL` 和 `OPENAI_SUMMARY_MODEL` 读取。

## 与 classifier 的关系

IPM 有两个独立的 AI 子系统：

| 子系统 | 目录 | 功能 | 依赖 |
|--------|------|------|------|
| **KnowClaw** (pi-runtime) | `Agent/pi-runtime/` | 多轮对话 agent、项目分析、Skill | `@earendil-works/pi-coding-agent` |
| **Classifier** | `Agent/classifier/` + `Agent/runner/` + `Agent/services/` | 文件上传自动分类 | `@langchain/core` + `@langchain/langgraph` |

两者完全独立，不共享 LLM 调用链。classifier 使用 LangGraph 的 StateGraph 做单次分类决策，KnowClaw 使用 pi-coding-agent 做多轮 agent 对话。

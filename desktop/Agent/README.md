# Agent — IPM AI 子系统

本目录包含 IPM 的所有 AI 相关逻辑，分为两个独立子系统：

## 1. KnowClaw（全局 AI 助理）

**目录**：[`pi-runtime/`](./pi-runtime/)

基于 [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 构建的多轮对话 agent，提供 Claude Code 级别的能力：

- 多轮会话、工具调用（文件读写、Shell、Web Fetch）
- IPM 业务工具（项目列表、跨项目统计、事件查询等）
- Skill 系统（内置 skill-builder + 用户自定义 skill）
- JSONL 会话持久化与 Fork

详细架构与扩展指南见 [`pi-runtime/README.md`](./pi-runtime/README.md)。

完整开发计划见 [`KNOWCLAW_REBUILD_PLAN.md`](./KNOWCLAW_REBUILD_PLAN.md)。

## 2. Classifier（文件自动分类）

**核心目录**：`classifier/`、`runner/`、`services/`、`prompts/`、`schemas/`、`guardrails/`

基于 `@langchain/core` + `@langchain/langgraph` 构建的单次决策 agent：

- 触发：悬浮窗上传文件到项目 `temp/` 后自动触发
- 输入：文件名 + 后缀 + `meta/structure.json`（业务目录结构）
- 输出：JSON 决策（建议归属到哪个业务文件夹）
- 边界：classifier 不具备文件操作能力，只做决策；系统将决策写入暂存区

## 共用层

| 目录 | 说明 |
|------|------|
| `db/` | SQLite 数据库封装（项目 DB + supervisorDb），服务于 classifier、通知、KnowClaw 业务工具 |
| `storage/` | 分类规则、偏好存储 |
| `shared/` | 共用工具（如 `projectRegistry.js`——项目/案件/学习空间枚举） |
| `tools/` | 分类相关工具函数 |

## 环境变量

在 `desktop/Agent/.env` 中配置（从 `.env.example` 复制）：

- `OPENAI_API_KEY` — LLM API Key
- `OPENAI_BASE_URL` — API 端点（如代理地址）
- `OPENAI_MODEL` — 主模型名称
- `OPENAI_SUMMARY_MODEL` — 摘要/轻量模型（可选）

也可在应用设置页面中配置（优先级更高，存储在 `state.json`）。

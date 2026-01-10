# Agent（LangChain 架构）

本目录用于存放所有 Agent 相关逻辑。MVP 阶段先实现 **文件自动分类 Agent**：

- **触发**：悬浮窗上传文件落到项目 `temp/` 后触发
- **输入**：仅文件名 + 后缀 + `meta/structure.json`（业务目录结构 + description）
- **输出**：唯一结论（JSON）：建议将该文件归属到哪个业务文件夹（`targetRelPath`）
- **边界**：Agent **不具备任何文件操作能力**，只做决策；系统将决策写入 `meta/ai-storage.json`

## 环境变量（OpenAI 兼容）

在 `desktop/.env` 中配置（建议从 `desktop/.env.example` 复制）：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`（例如你的网关/代理地址）
- `OPENAI_MODEL`（模型名称）

## 目录结构

- `Agent/runner/`: Agent 入口
- `Agent/prompts/`: Prompt 版本化
- `Agent/schemas/`: Zod/JSON schema
- `Agent/services/`: LangChain/LLM 封装



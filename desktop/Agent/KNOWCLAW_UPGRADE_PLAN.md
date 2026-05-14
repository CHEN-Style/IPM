# KnowClaw 升级计划 —— 迈向 Claude Code 级体验

> **目标**：将 KnowClaw 从"能对话、能调工具的基础 Agent"升级为具备深度推理、子任务分发、动态工作空间、完善 Skill 适配、脚本执行与依赖管理的桌面 Agent，使用体验接近 Claude Code。
>
> **前置**：KNOWCLAW_REBUILD_PLAN.md 的 P0–P13 已全部完成/跳过。本文档是其**续篇**，阶段编号从 **U0** 开始。
>
> **约束**：延续 REBUILD_PLAN 的阶段切分原则（读 ≤ 8 文件 / 写 ≤ 5 文件 / 抽象 ≤ 2 / 可独立验证）。

---

## 0. 阅读与维护说明

- 与 REBUILD_PLAN 规则相同：每阶段首行有 `Status:`；变更记录写在阶段末"变更日志"小节；超纲立刻拆分。
- AI 每完成一轮更新末尾进度看板。

---

## 1. 当前差距客观分析

### 1.1 对标：Claude Code 核心能力

| # | 能力 | Claude Code 实现 | 当前 KnowClaw 状态 |
|---|------|-----------------|-------------------|
| G1 | 深度推理 (Extended Thinking) | thinking 默认 medium，可切 low/high | **硬编码 `thinkingLevel: 'off'`** |
| G2 | 子任务分发 (Sub-agent) | 原生 `Agent` 工具：explore / plan / general-purpose | **完全没有**（P9 跳过） |
| G3 | 动态工作空间 | 每个会话绑定一个项目目录；可在运行时切换 | **硬编码 `userfile/`** |
| G4 | Skill 生态 | 丰富官方 skill（pdf / docx / xlsx / pptx 等）+ 社区 | **仅 1 个 skill-builder** |
| G5 | 脚本执行与依赖管理 | bash 内置 + 沙盒 + 自动安装依赖 | bash 内置可用，**无依赖管理 / 无确认机制** |
| G6 | Steer / FollowUp（流式追加消息） | 用户可在 agent 思考中追加指令 | **IPC/UI 层完全没接** |
| G7 | Compaction / 长上下文管理 | 自动 compaction + UI 进度 | SDK 内部自动 compaction，**但 UI 忽略 compaction 事件** |
| G8 | Thinking 可视化 | thinking_delta 流式渲染 | **UI 忽略 thinking_* 事件** |
| G9 | 任务追踪 (TodoWrite / Task) | TodoWrite / TaskCreate / TaskList / TaskUpdate | **没有** |
| G10 | 会话统计与成本 | /session 命令查看 token/cost | **没有暴露 getSessionStats()** |
| G11 | 图片输入 | 支持 ImageContent | **UI 不支持图片上传** |
| G12 | PowerShell 原生支持 | Windows 上有独立 PowerShell 工具 | **依赖 bash 工具，Windows 兼容性差** |
| G13 | 权限控制 | 细粒度 allow/deny 规则 + 工具级权限 | **无任何权限控制** |
| G14 | Hooks / 生命周期自动化 | pre/post tool 钩子 | **无** |
| G15 | CLAUDE.md / AGENTS.md 项目上下文 | 自动加载项目根下的上下文文件 | **`noContextFiles: true` 禁用了** |

### 1.2 优先级排序

按"用户感知冲击 × 实现成本"排序：

| 优先级 | 差距 | 理由 |
|--------|------|------|
| **P0-紧急** | G1 thinkingLevel | 一行代码改动，质量提升巨大 |
| **P0-紧急** | G3 动态工作空间 | 不解决此问题，所有需要项目上下文的 Skill 都无法工作 |
| **P1-高** | G4 Skill 生态 | 用户最直接感知的"能做什么" |
| **P1-高** | G5 依赖管理 | Skill 依赖 python/node 包，不装就没法用 |
| **P1-高** | G8 Thinking 可视化 | thinking 打开后必须有 UI 反馈 |
| **P2-中** | G6 Steer/FollowUp | 长任务期间追加指令的核心交互 |
| **P2-中** | G7 Compaction UI | 长对话必备 |
| **P2-中** | G2 子任务分发 | Claude Code 核心差异化，但实现复杂 |
| **P2-中** | G12 PowerShell | Windows 用户体验 |
| **P3-低** | G9 任务追踪 | 锦上添花 |
| **P3-低** | G10 统计成本 | 信息透明 |
| **P3-低** | G11 图片输入 | 非核心路径 |
| **P3-低** | G13 权限控制 | 安全加固 |
| **P3-低** | G14 Hooks | 高级特性 |
| **P3-低** | G15 项目上下文文件 | 被 G3 解决后自然跟上 |

---

## 2. 阶段总览

| # | 阶段 | 主要交付物 | 预估代码量 | 解决差距 |
|---|------|----------|-----------|---------|
| U0 | Thinking 解锁与 UI 可视化 | bootstrap 改动 + thinking 事件渲染 | ~300 行 | G1, G8 |
| U1 | 动态工作空间 | cwd 选择 IPC + UI + 项目上下文加载 | ~450 行 | G3, G15 |
| U2 | Skill 生态引入 | 适配 + 安装 6+ 官方 skill | ~350 行 | G4 |
| U3 | 依赖管理与脚本执行环境 | 依赖检测/安装 customTool + 确认 UI | ~400 行 | G5, G12 |
| U4 | Steer / FollowUp 交互 | IPC 扩展 + UI 输入模式 | ~350 行 | G6 |
| U5 | Compaction UI 与长会话优化 | compaction 事件渲染 + 手动 compact IPC | ~300 行 | G7 |
| U6 | 自建子任务分发 (Sub-agent) | 二次 createAgentSession + delegate tool | ~500 行 | G2 |
| U7 | 任务追踪 (Task System) | task customTool + UI 面板 | ~400 行 | G9 |
| U8 | 统计、图片、权限、收尾 | getSessionStats + 图片上传 + permission | ~450 行 | G10, G11, G13 |

---

## 3. 各阶段详细计划

---

### Phase U0 — Thinking 解锁与 UI 可视化

**Status:** `PENDING`

**目标**：把 `thinkingLevel` 从硬编码 `'off'` 改为可配置（默认 `'medium'`），并在 UI 中实时渲染 thinking 流。

**前置**：REBUILD_PLAN P13 完成。

**为什么是最高优先级**：thinking 是 LLM 处理复杂任务的核心能力。关掉 thinking 等于把模型的上限从"深度推理"降到"直觉回答"。一行代码的改动，质量提升巨大。

**工作清单**

读：
- `desktop/Agent/pi-runtime/bootstrap.js`（找到 `thinkingLevel: 'off'` 行）
- `desktop/src/ui/components/knowclaw-v2/useKnowClawV2Chat.js`（找到事件 switch 中被忽略的 thinking 事件）
- `desktop/src/main/ipc/knowclaw.js`（确认事件转发无过滤）
- pi SDK 类型：`AgentSessionEvent` 中 thinking 相关事件结构

写/改：
1. **`bootstrap.js`** —— `thinkingLevel: 'off'` 改为 `thinkingLevel: opts.thinkingLevel || 'medium'`
2. **`index.js`** —— `createSession` 签名增加 `thinkingLevel` 参数透传
3. **`knowclaw.js`** —— `ensureSession` 构建 `createSession` 时透传 thinkingLevel（从 prefs 读取或默认 'medium'）；新增 `knowclaw:setThinkingLevel` IPC
4. **`preload.js`** —— 暴露 `setThinkingLevel(level)` 和 `getStatus` 返回当前 thinkingLevel
5. **`useKnowClawV2Chat.js`** —— 事件 switch 新增：
   - `message_update` 的 `assistantMessageEvent.type === 'thinking_delta'`：累加 thinking 文本到当前 assistant 消息的 `thinking` 字段
   - 用一个新的 `thinkingContent` 状态暴露给 UI
6. **`KnowClawV2Page.jsx`** —— 在 MessageBubble 上方或内部增加可折叠的 "thinking" 区块（灰色斜体背景，默认折叠，点击展开）；Header 区域增加 thinking level 选择器（off / low / medium / high）

**Thinking Level 选择器设计**：
- 位置：Header 的模型选择器旁边
- 样式：小型下拉，显示当前级别图标（🧠 off / 💡 low / 🔍 medium / 🔬 high）
- 切换时调用 `knowclaw:setThinkingLevel`，同时通过 `activeSession.setThinkingLevel(level)` 在当前 session 内生效（不需要新建 session）

**不做**：
- 不做 thinking 的精确 token 计费展示（U8 做）
- 不做模型级别的 thinking 能力探测（依赖 pi SDK 的 `supportsThinking()` 和 `clampThinkingLevel`）

**产出物**：
- `bootstrap.js`（改 1 行 + 新参数）
- `index.js`（参数透传）
- `knowclaw.js`（1 个新 IPC + ensureSession 改动）
- `preload.js`（1 个新方法）
- `useKnowClawV2Chat.js`（事件处理扩展）
- `KnowClawV2Page.jsx`（thinking UI + thinking level selector）

**验证方法**：
1. 打开 KnowClaw v2，发送"请分析一下我所有项目的状况，给出详细的改进建议"。
2. 应看到 thinking 区块出现（折叠状态下显示"正在思考…"动画），展开后看到思考过程。
3. 最终回答质量应显著优于 `thinkingLevel: 'off'` 时的回答。
4. Thinking level 选择器可切换，切到 off 后 thinking 区块不再出现。

**上下文预算**：✅ 合适。2 个核心抽象（thinking 事件处理 + thinking UI）。

**风险**：
- R-U0.1：ipm-openai provider 的模型不支持 thinking → pi SDK 的 `clampThinkingLevel` 会自动降级到 'off'，不会报错。UI 侧不该 hardcode 显示 thinking，而应根据事件是否有 thinking_delta 动态决定。
- R-U0.2：thinking 消耗更多 token/cost → 这是预期的，后续 U8 做 cost 展示。UI 先给一个 thinking-level selector 让用户自主调。
- R-U0.3：OpenAI 模型（如 GPT-4o）不支持 thinking_delta → 同 R-U0.1，自动降级。只在 Claude / DeepSeek 等支持 thinking 的模型上才生效。

**变更日志**：
（完成后填写）

---

### Phase U1 — 动态工作空间

**Status:** `PENDING`

**目标**：让每个 KnowClaw 会话可以绑定到一个具体的项目/案件目录（而非硬编码 `userfile/`），并在该目录下启用 pi 的项目上下文文件扫描（`AGENTS.md` / `CLAUDE.md`），使 Skill 和 Agent 在正确的工作环境中执行。

**前置**：U0 完成。

**为什么是高优先级**：
1. 几乎所有 Skill（pdf / docx / xlsx / web-artifacts-builder）都假设 `cwd` 是一个有意义的项目目录，并在其中创建临时文件、脚本、输出。`userfile/` 是 IPM 的用户数据根，里面有 `projects/` `cases/` `study/` 子目录，不是合适的工作目录。
2. 让 pi 扫描项目上下文文件（`AGENTS.md`），用户可以为每个项目写自定义规则。
3. Claude Code 的核心交互模式就是"在某个项目目录内工作"。

**设计方案**

工作空间分三级：
1. **全局模式**（默认）：cwd = `userfile/`，适合跨项目查询、日常对话。不加载项目上下文。
2. **项目模式**：cwd = 某个项目/案件/学习目录的绝对路径。加载该目录下的 `AGENTS.md`（如果有）。bash/write/edit 的相对路径都基于该目录。
3. **自定义目录**：用户手动指定一个任意目录作为工作空间（高级用法）。

**工作清单**

读：
- `desktop/src/main/ipc/knowclaw.js`（ensureSession 中 cwd 的使用方式）
- `desktop/Agent/pi-runtime/bootstrap.js`（DefaultResourceLoader 的 `noContextFiles` 参数）
- `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`（Header 区域）

写/改：
1. **`knowclaw.js`**：
   - `ensureSession` 增加 `cwd` 参数（不再硬编码 `getUserFileRoot()`）
   - 新增 `knowclaw:setCwd` IPC：销毁当前 session → 用新 cwd 创建新 session → 推送 `cwd_changed` 事件
   - 新增 `knowclaw:getCwd` IPC
   - 新增 `knowclaw:listWorkspaces` IPC：返回 IPM 所有项目/案件/学习目录列表（复用 `buildProjectRegistry`）
2. **`bootstrap.js`**：
   - `DefaultResourceLoader` 的 `noContextFiles` 从硬编码 `true` 改为：当 `cwd === userFileRoot` 时为 `true`，否则为 `false`（允许项目目录加载 AGENTS.md）
3. **`preload.js`**：暴露 `setCwd / getCwd / listWorkspaces`
4. **`useKnowClawV2Chat.js`**：新增 `currentCwd / workspaces / setCwd` state + action
5. **`KnowClawV2Page.jsx`**：Header 增加 **工作空间选择器**：
   - 下拉列表：[全局] / [项目A] / [项目B] / [案件C] / ... / [自定义目录...]
   - 选中后立刻切换 cwd + 新建 session（带确认 toast）
   - 当前工作空间名称显示在 header 副标题

**不做**：
- 不做"在同一 session 中切换 cwd"——pi SDK 的 session 在创建时绑定 cwd，运行时切换需要 `AgentSessionRuntime.switchSession` 但我们没有用 Runtime 层（复杂度过高）。切换 cwd = 新建 session。
- 不做 worktree / git 集成

**产出物**：
- `knowclaw.js`（3 个新 IPC + ensureSession 改动）
- `bootstrap.js`（noContextFiles 动态化）
- `preload.js`（3 个新方法）
- `useKnowClawV2Chat.js`（cwd state）
- `KnowClawV2Page.jsx`（工作空间选择器 UI）

**验证方法**：
1. 在工作空间选择器中选择一个项目目录。
2. 发送"列出当前目录的文件"，pi 应在该项目目录下执行 `ls`。
3. 在该项目目录下创建一个 `AGENTS.md`，内容写"回答前先说一句 hello"。新建 session 后对话应包含该指令。
4. 切回"全局"模式，cwd 回到 `userfile/`。

**上下文预算**：✅ 合适。2 个抽象（cwd 管理 + 工作空间 UI）。

**风险**：
- R-U1.1：项目目录路径包含中文 → pi 的工具都用绝对路径，问题不大；JSONL session 文件名的 cwdHash 编码已在 P2 处理过。
- R-U1.2：`noContextFiles: false` 后 pi 扫描到不期望的 AGENTS.md → 只在项目模式下关闭 noContextFiles；全局模式保持 true。

**变更日志**：
（完成后填写）

---

### Phase U2 — Skill 生态引入

**Status:** `PENDING`

**目标**：从 Anthropic 官方 `skills-main` 仓库中适配并内置 6+ 个高价值 Skill，让 KnowClaw 具备实质性的"能做事"能力。

**前置**：U1 完成（动态工作空间就位，Skill 才能在正确的 cwd 内执行）。

**Skill 适配策略**

官方 Skill 的通用假设：
1. 有 `bash` 工具可执行任意命令（✅ pi 已内置）
2. 有 `write` / `edit` / `read` 工具操作文件（✅ pi 已内置）
3. 可以用 `pip install` / `npm install` 安装依赖（⚠️ 可用但无管理）
4. 有些引用 `scripts/` 子目录下的辅助脚本（❌ 需要与 SKILL.md 一起打包）
5. 有些假设 Claude Code 的 `present_files` 工具（❌ pi 没有，需替代方案）

**适配原则**：
- 对于仅依赖 bash + read/write/edit 的 Skill：**直接复制 SKILL.md**，放入 `pi-runtime/skills/` 或用户 skill 目录。
- 对于依赖 `scripts/` 辅助脚本的 Skill：**连 scripts 目录一起复制**。
- 对于依赖 `present_files` 的 Skill：改写 SKILL.md，改为"将文件写到 cwd 下的输出目录"。
- 对于依赖 Claude Code 沙盒或特殊工具的 Skill：**不适配**，记录原因。

**适配清单**

| Skill | 依赖 | 适配难度 | 决策 |
|-------|------|---------|------|
| **pdf** | Python pypdf/reportlab | 低 | ✅ 直接复制，SKILL.md 内已包含完整 Python 代码模板 |
| **docx** | Node docx-js / Python pandoc | 低 | ✅ 复制 SKILL.md + scripts/ |
| **xlsx** | Python openpyxl / Node exceljs | 低 | ✅ 复制 SKILL.md + scripts/ |
| **pptx** | Python python-pptx | 低 | ✅ 复制 SKILL.md |
| **doc-coauthoring** | bash + read/write | 极低 | ✅ 纯 prompt skill，直接复制 |
| **web-artifacts-builder** | Node + React + Vite | 中 | ✅ 复制全套（含 init 脚本），依赖 U3 的依赖管理 |
| **frontend-design** | bash + write | 低 | ✅ 纯 prompt skill |
| **canvas-design** | 字体文件 + bash | 中 | ⚠️ 需要打包字体 |
| **algorithmic-art** | JS + HTML | 低 | ✅ 纯模板 |
| **brand-guidelines** | read/write | 极低 | ✅ 纯 prompt skill |
| **mcp-builder** | Claude Code MCP API | 高 | ❌ 跳过（依赖 Claude Code 专有能力） |
| **claude-api** | Anthropic API | 中 | ❌ 跳过（IPM 不一定用 Anthropic） |
| **webapp-testing** | Playwright | 高 | ❌ 跳过（重型依赖） |
| **slack-gif-creator** | puppeteer | 高 | ❌ 跳过 |
| **theme-factory** | Claude Code TUI | 高 | ❌ 跳过 |
| **internal-comms** | read/write | 极低 | ✅ 纯 prompt skill |

**最终适配列表**（10 个）：pdf, docx, xlsx, pptx, doc-coauthoring, web-artifacts-builder, frontend-design, algorithmic-art, brand-guidelines, internal-comms

**工作清单**

读：
- `skills-main/skills/` 下每个目标 skill 的 SKILL.md 头部（确认 frontmatter 格式）
- `desktop/Agent/pi-runtime/bootstrap.js`（确认 `additionalSkillPaths` 机制）
- pi SDK 的 `loadSkillsFromDir` 行为（是否递归、是否需要特定目录结构）

写：
1. 将 10 个 Skill 的 `SKILL.md`（及其 `scripts/`、`templates/` 等辅助目录）复制到 `desktop/Agent/pi-runtime/skills/` 下。每个 Skill 一个子目录。
2. 对依赖 `present_files` 的 Skill，在 SKILL.md 中将 `present_files` 引用替换为"将文件写到 `<cwd>/output/` 并告诉用户路径"。
3. 对引用 `scripts/` 相对路径的 Skill，确保 scripts 路径在 SKILL.md 中使用相对于 skill 目录的写法（pi 的 `@path` 语法支持）。

改：
- `bootstrap.js` —— 无改动需要（`additionalSkillPaths` 已指向 `pi-runtime/skills/`，新增子目录自动被 pi 扫描）

**不做**：
- 不做 Skill UI 管理面板（用户可通过 skill-builder 自行创建）
- 不做 Skill 版本管理或远程拉取
- 不做不可适配的 5 个 Skill

**产出物**：10 个 Skill 子目录（含 SKILL.md + 辅助文件）

**验证方法**：
1. 启动 KnowClaw，主进程日志应显示 `skills loaded: 11`（1 个 skill-builder + 10 个新增）。
2. 在项目工作空间下说"帮我创建一个 PDF 报告"，模型应自动使用 pdf skill 的指令。
3. 说"帮我把这些数据生成一个 Excel 表格"，模型应自动使用 xlsx skill。
4. 验证 frontmatter 的 `description` 足以让模型在对话中正确匹配。

**上下文预算**：⚠️ 偏满（10 个 skill，但每个只需复制 + 微调 SKILL.md）。若超出则拆为 U2a（前 5 个）和 U2b（后 5 个）。

**风险**：
- R-U2.1：Skill 内的 Python/Node 脚本依赖未安装 → 模型会尝试 `pip install` 但可能失败（U3 解决）
- R-U2.2：`scripts/` 的绝对路径在 packaged build 中可能不对 → 使用 `import.meta.url` 相对路径
- R-U2.3：Skill frontmatter 的 `license` 字段标注"Proprietary" → 仅作内置使用，不对外分发

**变更日志**：
（完成后填写）

---

### Phase U3 — 依赖管理与脚本执行环境

**Status:** `PENDING`

**目标**：为 KnowClaw 的 Skill 执行提供可靠的依赖管理能力——检测环境中已安装的工具、自动安装缺失的 Python/Node 依赖、并在安装前给用户确认机会。

**前置**：U2 完成（有了需要依赖的 Skill 才有安装需求）。

**设计方案**

新增 2 个 customTool：

1. **`check_environment`**：检测当前环境（Python 版本、Node 版本、pip/npm 可用性、常用包是否安装）。模型在执行 Skill 前可主动调用此工具。
2. **`install_packages`**：批量安装 Python/Node 包。**执行前通过 IPC 向用户确认**（渲染进程弹一个确认对话框列出将安装的包名和数量）。确认后在 cwd 下执行 `pip install` 或 `npm install`。

此外，针对 Windows 环境的 bash 兼容性问题：
3. 在 `promptBuilder.js` 的系统提示词中增加"你运行在 Windows 上"的上下文段（当 `process.platform === 'win32'` 时），指导模型用 `powershell` 兼容语法而非 Linux bash。

**工作清单**

写：
1. **`desktop/Agent/pi-runtime/tools/envTools.js`** —— `buildEnvTools()` 返回 2 个 `defineTool`：
   - `check_environment`：执行 `python --version`、`node --version`、`pip list --format=json`、`npm list -g --json` 等命令（用 `child_process.execSync` 而非 pi 的 bash 工具，避免递归），返回结构化环境信息
   - `install_packages`：参数 `{ packages: string[], manager: 'pip' | 'npm' }` → **不直接执行**，而是返回一个 `{ requiresConfirmation: true, packages, command }` 给 IPC 层
2. **`knowclaw.js`** —— `install_packages` 工具的 execute 中，通过 `webContents.send('knowclaw:confirm-install', { packages, command })` 推送确认请求到渲染进程；渲染进程的确认/拒绝通过新 IPC `knowclaw:confirm-install-response` 返回；得到确认后执行实际安装命令。

改：
3. **`bootstrap.js`** —— 在 customTools 组装中加入 `buildEnvTools()`
4. **`promptBuilder.js`** —— 增加 Windows 上下文段
5. **`preload.js`** —— 暴露 `onConfirmInstall(cb)` 事件
6. **`KnowClawV2Page.jsx`** —— 新增安装确认对话框组件

**确认对话框 UI 设计**：
```
┌──────────────────────────────────────┐
│  📦 KnowClaw 需要安装以下依赖       │
│                                      │
│  pip install:                        │
│    • pypdf (PDF 处理)                │
│    • reportlab (PDF 生成)            │
│                                      │
│  [取消]                    [确认安装] │
└──────────────────────────────────────┘
```

**不做**：
- 不做 virtualenv / 沙盒隔离（过于复杂，且用户的系统环境各异）
- 不做包版本锁定（由 Skill SKILL.md 里的指令控制）
- 不做卸载工具

**产出物**：
- `tools/envTools.js`
- `knowclaw.js`（确认流改动）
- `bootstrap.js`（注册新工具）
- `promptBuilder.js`（Windows 段）
- `preload.js`（确认事件）
- `KnowClawV2Page.jsx`（确认对话框）

**验证方法**：
1. 说"帮我创建一个 PDF"，模型应先调 `check_environment` 检测 pypdf 是否安装。
2. 如未安装，模型调 `install_packages`，用户看到确认对话框。
3. 点确认后 pip install 执行，然后模型继续使用 pypdf 创建 PDF。
4. 在 Windows 上验证 bash 命令使用 PowerShell 兼容语法。

**上下文预算**：✅ 合适。

**风险**：
- R-U3.1：用户没装 Python → `check_environment` 会报告，模型应据此告诉用户"请先安装 Python"
- R-U3.2：pip install 需要管理员权限 → 在确认对话框中提示"可能需要以管理员身份运行 IPM"
- R-U3.3：确认流是异步 IPC 往返，tool 的 execute 函数需要 await 确认结果 → 用 Promise + 事件监听实现

**变更日志**：
（完成后填写）

---

### Phase U4 — Steer / FollowUp 交互

**Status:** `PENDING`

**目标**：让用户在 agent 执行（streaming）期间可以追加消息——"打断"（steer）或"排队追问"（followUp），接近 Claude Code 的交互体验。

**前置**：U0 完成（thinking 可视化就位，steer 场景更明确）。

**设计方案**

pi SDK 已有完整的 steer / followUp API：
- `session.steer(text)` —— 在当前 turn 的 tool 执行间隙插入
- `session.followUp(text)` —— 排队到当前 agent 执行完毕后自动执行

UI 行为：
- 当 `streaming === true` 时，输入框仍然可用（不再禁用）
- 输入框左侧显示模式切换：`⚡ 打断` / `📋 追问`
- 发送消息时根据模式调用对应 IPC

**工作清单**

写/改：
1. **`knowclaw.js`** —— 新增 `knowclaw:steer` 和 `knowclaw:followUp` IPC handler：
   - steer：`activeSession.steer(message)` 
   - followUp：`activeSession.followUp(message)`
   - 两者都需要 `activeSession` 存在且 streaming 中
2. **`preload.js`** —— 暴露 `steer(message)` 和 `followUp(message)`
3. **`useKnowClawV2Chat.js`** —— 
   - 新增 `steerMode` state：`'steer' | 'followUp'`
   - `sendMessage` 在 streaming 时改为调用 `steer` 或 `followUp`
   - 事件 switch 处理 `queue_update` 事件：更新 `pendingSteer` / `pendingFollowUp` 计数
4. **`KnowClawV2Page.jsx`** —— 
   - streaming 时输入框不再 disabled
   - 输入框上方显示 pending 消息计数（"1 条打断消息排队中"）
   - 输入框左侧增加 steer/followUp 切换按钮

**不做**：
- 不做消息取消（`clearQueue`）—— 后续可加
- 不做 steer 消息在消息列表中的特殊渲染——直接作为普通 user 消息

**产出物**：4 个文件改动

**验证方法**：
1. 发送一个长任务（"详细分析所有项目的健康状况并给出改进计划"）。
2. 在 agent 执行期间，切到"打断"模式，发"算了，先只看项目 A"。
3. agent 应在下一个工具调用间隙收到打断，调整执行方向。
4. 切到"追问"模式，发"然后再看案件 D"，等当前任务完成后自动继续。

**上下文预算**：✅ 合适。

**变更日志**：
（完成后填写）

---

### Phase U5 — Compaction UI 与长会话优化

**Status:** `PENDING`

**目标**：在 UI 中可视化 compaction 过程（自动/手动），让用户理解长对话的上下文管理；暴露手动 compact 操作。

**前置**：U0 完成。

**工作清单**

写/改：
1. **`useKnowClawV2Chat.js`** —— 事件 switch 新增：
   - `compaction_start`：设 `compacting = true`，记录 reason（manual / threshold / overflow）
   - `compaction_end`：设 `compacting = false`，toast 显示结果
   - `auto_retry_start` / `auto_retry_end`：显示重试状态
2. **`knowclaw.js`** —— 新增 `knowclaw:compact` IPC：调用 `activeSession.compact(customInstructions?)`；新增 `knowclaw:getSessionStats` IPC：调用 `activeSession.getSessionStats()`
3. **`preload.js`** —— 暴露 `compact()` 和 `getSessionStats()`
4. **`KnowClawV2Page.jsx`** ——
   - Compaction 进行时在消息区顶部显示"正在压缩上下文…"banner
   - Header 增加 compact 按钮（仅在非 streaming 时可用）
   - 底部状态栏显示 context usage（token 用量百分比）

**产出物**：4 个文件改动

**验证方法**：
1. 进行一段长对话（20+ 条消息），观察 auto-compaction 触发时 UI 有提示。
2. 点击手动 compact 按钮，看到 banner + 完成 toast。
3. 底部状态栏显示 token 用量。

**变更日志**：
（完成后填写）

---

### Phase U6 — 自建子任务分发 (Sub-agent)

**Status:** `PENDING`

**目标**：在应用层实现简化版的子任务分发——主会话可以"委托"一个子任务给独立的 pi session（独立上下文、独立工具集、独立 cwd），子 session 执行完毕后将结果汇总返回给主会话。

**前置**：U1 完成（动态 cwd 就位）。

**为什么不跳过**：
REBUILD_PLAN P9 跳过的原因是"pi SDK 无原生子 agent API"。但经过 U0–U5 的升级，KnowClaw 已具备完整的 `createAgentSession` 包装能力。我们可以在应用层用"二次 createAgentSession"实现子任务：
- 主 session 调用 `delegate_task` customTool
- tool 的 execute 内部：创建一个新的 pi session（独立 cwd、独立 tool 集、精简 prompt）
- 子 session 的 `prompt(taskDescription)` 执行完毕后，提取最终 assistant 消息作为 tool result 返回给主 session
- 子 session 立刻 dispose

这不是 Claude Code 级别的并行多 agent（那需要并行运行多个 session + 共享 task board），但已能覆盖"把复杂任务的一部分委托出去以隔离上下文"的核心场景。

**设计方案**

新增 1 个 customTool：
- **`delegate_task`**：参数 `{ task: string, cwd?: string, tools?: string[], maxTurns?: number }`
  - 创建一个 `inMemory` 子 session（不持久化）
  - cwd 默认继承主 session，可覆盖
  - tools 默认 read-only（`['read', 'grep', 'find', 'ls']`），可覆盖为完整工具集
  - maxTurns 默认 10（防止子 session 跑飞）
  - prompt 格式："你是一个子任务执行器。你的唯一任务是：{task}。完成后给出简洁的结论。"
  - 子 session 的 thinking 继承主 session 设置
  - 子 session 执行期间，主 session 的 tool execution 处于 "running" 状态；通过 `onUpdate` 回调向主 session 推送子 session 进度文本
  - 子 session 完成后，提取最后一条 assistant text 作为 tool result
  - 超过 maxTurns 时强制 abort + 返回当前进度

**注意**：子 session 共用相同的 `authStorage` 和 `modelRegistry`（不重新初始化），只需独立 `sessionManager` 和 `resourceLoader`。

**工作清单**

写：
1. **`desktop/Agent/pi-runtime/tools/delegateTool.js`** —— `buildDelegateTool(deps)` 返回 `delegate_task` 定义

改：
2. **`bootstrap.js`** —— 在 customTools 组装中加入 delegate tool；需要暴露 `authStorage` / `modelRegistry` / `model` 给 tool deps
3. **`knowclaw.js`** —— toolDeps 增加 `runtimeInternals: { authStorage, modelRegistry, model }` 传递

**不做**：
- 不做并行子 session（当前是阻塞的：主 session 等子 session 完成）
- 不做子 session 的独立 UI 渲染（仅在 ToolCallCard 中显示进度）
- 不做子 session 间通信

**产出物**：1 个新文件 + 2 个改动

**验证方法**：
1. 说"帮我分析项目 A 下所有 markdown 文件的内容摘要"。
2. 模型应调用 `delegate_task({ task: "...", cwd: "项目A路径", tools: ["read", "grep", "find", "ls"] })`。
3. ToolCallCard 显示子任务进度，完成后显示汇总结果。
4. 主 session 的上下文中只看到汇总结果，不看到子 session 读过的所有文件内容（上下文隔离生效）。

**上下文预算**：✅ 合适。核心抽象 = "子 session 创建与结果回收"。

**风险**：
- R-U6.1：子 session 的 model API 调用同样消耗 token/cost → 由 U8 的 cost 追踪覆盖
- R-U6.2：子 session 可能 hang（API 超时）→ maxTurns + 总体 timeout（如 5 分钟）
- R-U6.3：主 session 的 `toolDeps`（IPM 业务函数）是否要传给子 session → 默认不传（子 session 用通用工具），高级用法可选 `useIpmTools: true`

**变更日志**：
（完成后填写）

---

### Phase U7 — 任务追踪 (Task System)

**Status:** `PENDING`

**目标**：给 KnowClaw 一个内置的任务追踪系统（类似 Claude Code 的 TodoWrite / TaskCreate），让模型在执行复杂多步骤任务时自我管理进度。

**前置**：U6 完成（子任务分发搭配任务追踪体验更完整）。

**设计方案**

新增 1 个 customTool：
- **`task_manager`**：参数 `{ action: 'create' | 'update' | 'list' | 'delete', task?: { id, title, status, details } }`
  - 任务存储在会话级内存中（不持久化到文件——会话关闭即清空）
  - 状态：pending / in_progress / completed / cancelled
  - 模型在接到复杂请求时主动创建任务清单，完成一步更新一步

UI 侧：
- `KnowClawV2Page.jsx` 右下角增加一个可折叠的任务面板
- 实时显示当前任务清单和各任务状态
- 任务通过 tool 事件 (`tool_execution_end` toolName=`task_manager`) 的 result 更新

**工作清单**

写：
1. **`desktop/Agent/pi-runtime/tools/taskTool.js`** —— `buildTaskTool()`
2. **`KnowClawV2Page.jsx`** —— TaskPanel 组件（内嵌）

改：
3. **`bootstrap.js`** —— 注册 task tool
4. **`useKnowClawV2Chat.js`** —— 从 tool_execution_end 事件中提取 task_manager 结果更新 tasks state
5. **`promptBuilder.js`** —— 在 system prompt 中加入"对于复杂任务，主动使用 task_manager 创建和更新任务清单"的指引

**产出物**：2 个新文件 + 3 个改动

**验证方法**：
1. 说"帮我做一份完整的项目健康报告，包含每个项目的文件统计、最近活动、待办事项"。
2. 模型应先调 `task_manager` 创建 3-4 个子任务。
3. 右下角任务面板实时显示进度。
4. 每完成一步，任务状态更新。

**变更日志**：
（完成后填写）

---

### Phase U8 — 统计、图片、权限、收尾

**Status:** `PENDING`

**目标**：补齐剩余中低优先级功能——会话统计/成本展示、图片输入支持、基础权限控制——并做整体收尾。

**前置**：U7 完成。

**工作清单**

#### 8a. 会话统计与成本

1. **`knowclaw.js`** —— `knowclaw:getSessionStats` IPC（如 U5 未做则此处做）
2. **`KnowClawV2Page.jsx`** —— 底部状态栏：token 用量 / 成本 / 消息计数

#### 8b. 图片输入

1. **`KnowClawV2Page.jsx`** —— 输入框增加图片上传按钮
2. **`useKnowClawV2Chat.js`** —— `sendMessage` 支持 `images` 参数
3. **`knowclaw.js`** —— `knowclaw:send` 支持 `{ message, images }` payload
4. pi SDK 的 `session.prompt(text, { images })` 已原生支持 `ImageContent[]`

#### 8c. 基础权限控制

1. **`promptBuilder.js`** —— system prompt 增加安全准则段落：
   - 破坏性操作（删除文件/目录、格式化、改系统配置）前必须显式确认
   - 不得读取/写入 cwd 之外的敏感路径（`~/.ssh`、`~/.env` 等）
2. 后续如需更严格的权限控制可引入 tool-level allow/deny（本阶段不做）

#### 8d. 文档更新

1. **`desktop/Agent/pi-runtime/README.md`** —— 更新架构图和模块列表
2. **`desktop/Agent/KNOWCLAW_UPGRADE_PLAN.md`** —— 更新所有阶段的变更日志和进度看板

**产出物**：多个文件改动 + 文档更新

**变更日志**：
（完成后填写）

---

## 4. 风险登记表

| ID | 风险 | 触发阶段 | 概率 | 影响 | 缓解 |
|----|------|---------|------|------|------|
| RU-1 | ipm-openai 模型不支持 thinking | U0 | 高（GPT-4o 不支持 thinking_delta） | 中 | SDK 自动 clamp；UI 根据有无 thinking_delta 动态显示 |
| RU-2 | Skill 依赖的 Python/Node 未安装 | U2/U3 | 中 | 高 | check_environment + 确认安装流 |
| RU-3 | 子 session 跑飞消耗大量 token | U6 | 低 | 高 | maxTurns + timeout 双重限制 |
| RU-4 | Windows bash 兼容性 | U3 | 高 | 中 | prompt 注入 platform 信息；长期可考虑 PowerShell 工具 |
| RU-5 | Skill SKILL.md 中 scripts/ 路径在打包后失效 | U2 | 中 | 高 | 使用 `import.meta.url` 定位；打包时确保 scripts/ 在 asar-unpacked |
| RU-6 | 长对话 compaction 后历史消息丢失 | U5 | 低 | 中 | compaction 是 pi SDK 内置能力，质量取决于模型 |

---

## 5. 进度看板

| 阶段 | Status | 完成日期 | 备注 |
|------|--------|---------|------|
| U0 — Thinking 解锁与可视化 | PENDING | | |
| U1 — 动态工作空间 | PENDING | | |
| U2 — Skill 生态引入 | PENDING | | |
| U3 — 依赖管理与脚本执行 | PENDING | | |
| U4 — Steer / FollowUp | PENDING | | |
| U5 — Compaction UI | PENDING | | |
| U6 — 子任务分发 | PENDING | | |
| U7 — 任务追踪 | PENDING | | |
| U8 — 统计/图片/权限/收尾 | PENDING | | |

---

## 6. 升级后终态画像

完成全部 U0–U8 后，KnowClaw 应具备：

1. **深度推理**：thinkingLevel 可调（off / low / medium / high），thinking 过程可视化
2. **动态工作空间**：每个会话可绑定到具体项目目录，支持 AGENTS.md 项目上下文
3. **Skill 生态**：10+ 内置 Skill（pdf / docx / xlsx / pptx / web / design 等），用户可自建 Skill
4. **脚本执行**：环境检测 + 依赖确认安装 + Windows PowerShell 兼容
5. **子任务分发**：delegate_task 工具实现上下文隔离的子任务执行
6. **流式交互**：streaming 期间可 steer（打断）/ followUp（追问）
7. **长会话管理**：compaction 可视化 + 手动 compact + context 用量展示
8. **任务追踪**：复杂任务自动创建 task 清单，UI 实时展示进度
9. **多模态输入**：支持图片上传
10. **安全基线**：破坏性操作确认 + 路径访问限制

与 Claude Code 的**仍存差距**（接受的 trade-off）：
- 并行子 agent（需要多 session 并发管理 + 共享 task board，复杂度极高）
- Hooks 生命周期自动化（需求不明确）
- MCP 集成（IPM 暂无外部 MCP 服务）
- Agent Teams（多 agent 协作，超出桌面 App 范畴）
- Worktree / Git 集成（IPM 不是 coding IDE）

---

## 7. 术语表

- **thinkingLevel**：pi SDK 的推理深度控制（`'off' | 'low' | 'medium' | 'high'`）
- **steer**：在 agent 执行期间插入一条"打断"消息，agent 在下一个工具调用间隙处理
- **followUp**：在 agent 执行期间排队一条"追问"消息，agent 完成当前任务后自动处理
- **compaction**：pi SDK 的上下文压缩机制，当消息历史接近模型上下文窗口限制时自动摘要
- **delegate_task**：本计划新增的 customTool，在应用层实现子 session 委托
- **AGENTS.md**：pi 协议的项目上下文文件（等同于 Claude Code 的 CLAUDE.md），放在项目根目录下

# KnowClaw Skill System 开发计划 · Skill System Plan

> 本文档承载 **2026-05-26 起** 的 KnowClaw Skill 系统建设主线。目标是为
> KnowClaw 构建完整的 Skill 管理体系，使用户获得接近 Claude Code / Cursor
> 的 Skill 使用体验，包含 Skill 管理 UI、外部 Skill 导入（兼容 Agent Skills
> 标准）、热重载、以及工作空间级 Skill 支持。
>
> 与 [`IPM_FEATURE_UPGRADE_PLAN.md`](./IPM_FEATURE_UPGRADE_PLAN.md)（功能升级
> F1–K3 已 DONE）并列、与 [`KNOWCLAW_UPGRADE_PLAN.md`](./KNOWCLAW_UPGRADE_PLAN.md)
> （KnowClaw 引擎迭代 U0–U8 已 DONE）形成独立但互相引用的演进主线。
>
> SK0 / SK1 / SK2 / SK3 / SK4 全部 `DONE`（2026-05-26；SK3 通过架构决策合并实现，无新增代码；SK4 完成工作空间级 Skill 支持，至此 Skill 系统主线收官）。

---

## 0. 阅读与维护说明

- **状态枚举**：`PLANNED`（已立项待启动）/ `RESEARCH`（待技术调研后再立项）
  / `IN_PROGRESS` / `DONE` / `DEFERRED`。
- **更新规则**：
  - 每完成一次用户对话决策（如选择候选方案 A/B），把答案落到对应阶段的「决策记录」。
  - 每完成一次代码改动，把摘要写到对应阶段的「变更日志」。
  - 不要直接删除"候选方案"段落，已被否决的方案改为 `~~删除线~~` + 否决理由。
- **与其他计划的边界**：
  - KnowClaw 引擎本体（pi runtime / prompt / 工具集 / 会话）→ 改 `KNOWCLAW_UPGRADE_PLAN.md`
  - 应用整体新功能 / 文件管理 / 知识管理 / 悬浮窗 → 改 `IPM_FEATURE_UPGRADE_PLAN.md`
  - **Skill 系统专属（服务层 / IPC / 管理 UI / 导入 / 热重载 / 工作空间级 Skill）→ 本文档**
- **文件位置**：`desktop/Agent/SKILL_SYSTEM_PLAN.md`

---

## 1. 现状全面评估

### 1.1 已具备的底层能力（引擎层 — pi-coding-agent SDK v0.74）

pi SDK **已完整实现** Agent Skills 标准（https://agentskills.io/specification），底层能力成熟度高：

| 能力 | 实现位置 | 说明 |
|------|---------|------|
| Skill 加载器 | `pi-coding-agent/dist/core/skills.js` | `loadSkillsFromDir` / `loadSkills` 递归扫描目录中的 `SKILL.md` |
| Skill 数据结构 | `Skill` interface | `{ name, description, filePath, baseDir, sourceInfo, disableModelInvocation }` |
| Prompt 注入 | `formatSkillsForPrompt` | 将 skill 列表以 XML `<available_skills>` 格式注入 system prompt |
| DefaultResourceLoader | `dist/core/resource-loader.js` | 通过 `additionalSkillPaths` 接受多目录、支持 `skillsOverride` 回调 |
| 验证体系 | `skills.js` | name（小写 a-z/0-9/连字符，<=64 字符，须与目录名一致）、description（<=1024 字符，必填） |
| `.ignore` 支持 | `skills.js` | skill 目录下的 `.gitignore` / `.ignore` / `.fdignore` 会被尊重 |
| 去重与冲突检测 | `skills.js` | 同名 skill 保留先发现者，记录 collision 诊断 |
| Skill 命令展开 | `agent-session.js` | `/skill:name args` 命令 → 读取 SKILL.md → 包装为 XML skill block 发给 LLM |

### 1.2 IPM 应用层已实现的部分

| 模块 | 路径 | 现状 |
|------|------|------|
| 双目录架构 | `Agent/pi-runtime/bootstrap.js` L69-103, L524-567 | 内置 `BUILTIN_SKILLS_DIR` + 用户 `userSkillsRoot` 两个 skill 路径 |
| 环境变量 | `src/main.js` L2085-2086 + `bootstrap.js` L85-87 | `KNOWCLAW_SKILLS_DIR`（内置 skill 目录）+ `KNOWCLAW_USER_SKILLS_ROOT`（用户 skill 目录） |
| 启动日志 | `bootstrap.js` L552-567 | skill 加载数量、名称列表、诊断信息均 console.log |
| `.ignore` 排除 | `Agent/pi-runtime/skills/.ignore` | 排除 `_shared/`（OOXML 工具链共享代码）不被扫描为 skill |
| 元技能 skill-builder | `Agent/pi-runtime/skills/skill-builder/SKILL.md` | 指导 AI 创建规范的 SKILL.md，写入 `KNOWCLAW_USER_SKILLS_ROOT` |
| 内置 6 个 Skill | `Agent/pi-runtime/skills/` | skill-builder / docx / xlsx / pptx / pdf / web-artifacts-builder |

### 1.3 完全缺失的部分（本次开发核心）

| # | 缺失项 | 影响 |
|---|--------|------|
| M1 | 零 Skill 管理 UI | 用户无法查看、管理已加载的 skill |
| M2 | 零 IPC 通道 | 没有任何 `knowclaw:*Skill*` 相关的 IPC handler |
| M3 | 零外部导入能力 | 用户无法从外部路径/仓库导入 skill |
| M4 | 零热重载 | skill 仅在会话创建时加载一次，新增/修改后必须新建会话 |
| M5 | 零工作空间级 skill | 只有全局 skill，没有项目/案件级别的 skill |
| M6 | 零启用/禁用控制 | 无法精细控制哪些 skill 参与 prompt 注入 |

### 1.4 外部 Skill 格式兼容性分析

经实测验证，Claude Code、Cursor、pi SDK 三者的 SKILL.md 格式**高度一致**：

```yaml
---
name: skill-name          # 三套系统都必填
description: 做什么 + 什么时候触发  # 三套系统都必填
# 以下为各系统专有字段（其他系统静默忽略即可）：
version: 1.0.0            # Claude Code 专有
disable-model-invocation: true  # Cursor / Claude Code
metadata:
  surfaces: [ide]          # Cursor 专有
disabled-environments: [cloud]  # Cursor 专有
---

# Markdown 正文（给 AI 看的操作手册）
```

| 系统 | 全局 Skill 目录 | 项目级 Skill 目录 | 独有扩展 |
|------|---------------|-----------------|---------|
| Claude Code | `~/.claude/skills/` | 无 | `version` 字段 |
| Cursor | `~/.cursor/skills/` / `~/.cursor/skills-cursor/` | `.cursor/skills/` | `metadata.surfaces`、`disabled-environments` |
| KnowClaw | `%APPDATA%/IPM/knowclaw-skills/` | 无（本次新增） | `.ignore` 文件、`$KNOWCLAW_SKILLS_DIR` 环境变量、`noContextFiles` 开关 |

pi SDK 文档已明确写出兼容加载方式：
```json
{ "skills": ["~/.claude/skills", "~/.codex/skills"] }
```

**结论：导入外部 skill 在引擎层已天然支持，只需在应用层（IPC + UI）实现导入流程。
Cursor / Claude Code 的专有 frontmatter 字段可静默忽略，无需特殊解析。**

---

## 2. 目标体验定义

参考 Claude Code CLI + Cursor IDE 的 skill 交互，KnowClaw 应达到：

1. 用户能在 UI 中**一览所有已加载 skill**（分内置/用户/导入三类）
2. 用户能**一键导入**外部 skill 目录（支持 Claude Code / Cursor / 任意本地路径）
3. 用户能**启用/禁用**单个 skill（不删除文件，仅从 prompt 注入中排除）
4. 用户能**查看 skill 详情**（完整 SKILL.md 渲染为 Markdown）
5. 用户能**删除**用户 skill（内置 skill 不可删）
6. 新增/删除/启用禁用后**无需重启**——下次新建会话即自动生效（热重载）
7. 支持通过 AI 对话创建 skill（已有 `skill-builder` 元技能，保持不变）

---

## 3. 架构设计

### 3.1 Skill 分类体系

| 分类 | source 标识 | 来源 | 可删除 | 可禁用 |
|------|-----------|------|--------|--------|
| 内置 skill | `builtin` | `Agent/pi-runtime/skills/` 下的 6 个 | 否 | 是 |
| 用户 skill | `user` | `KNOWCLAW_USER_SKILLS_ROOT` 下的 skill（AI 创建或手动放置） | 是 | 是 |
| 导入 skill | `imported` | 从外部目录复制到 `KNOWCLAW_USER_SKILLS_ROOT` 下的 skill，标记来源 | 是 | 是 |
| 工作空间 skill | `workspace` | `<workspace>/.knowclaw/skills/` 下的 skill（SK4 新增） | 是 | 是 |

### 3.2 持久化设计

在现有 `state.prefs` 中新增 `skills` 字段（通过 `prefs/get` / `prefs/set` IPC 持久化）：

```javascript
state.prefs.skills = {
  disabled: ['pdf', 'xlsx'],           // 被禁用的 skill name 列表
  importedSources: {                   // 导入来源记录
    'my-imported-skill': {
      from: 'C:\\Users\\xx\\.claude\\skills\\my-skill',
      importedAt: '2026-05-26T08:30:00.000Z',
    },
  },
}
```

### 3.3 数据流总览

```
┌────────────────────── Renderer (React UI) ──────────────────────┐
│                                                                  │
│  SkillManagerPanel ──→ knowclaw:listSkills ──→ skillService.js   │
│  SkillDetailModal  ──→ knowclaw:getSkillContent ──→ fs.readFile │
│  ImportSkillDialog ──→ knowclaw:importSkill ──→ fs.cpSync       │
│  Toggle Switch     ──→ knowclaw:toggleSkill ──→ prefs.skills    │
│  Delete Button     ──→ knowclaw:deleteSkill ──→ fs.rmSync       │
│  Reload Button     ──→ knowclaw:reloadSkills ──→ resourceLoader │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
        │                                     │
        ▼                                     ▼
┌─── IPC Layer (skills.js) ───┐  ┌─── Main Process ────────────┐
│ 6 个 ipcMain.handle(...)    │  │ skillService.js (新建)       │
│ 转发到 skillService         │  │ resourceLoader (pi SDK)      │
└─────────────────────────────┘  │ state.prefs.skills (持久化)  │
                                  │ BUILTIN_SKILLS_DIR           │
                                  │ KNOWCLAW_USER_SKILLS_ROOT    │
                                  └──────────────────────────────┘
```

### 3.4 IPC 通道设计

| 通道 | 方向 | 入参 | 返回 | 功能 |
|------|------|------|------|------|
| `knowclaw:listSkills` | renderer → main | `{ channel? }` | `{ skills: SkillInfo[], diagnostics }` | 列出所有已加载 skill + 启用状态 |
| `knowclaw:getSkillContent` | renderer → main | `{ filePath }` | `{ content: string, frontmatter }` | 读取 SKILL.md 全文 + 解析 frontmatter |
| `knowclaw:importSkill` | renderer → main | `{ srcDir, name? }` | `{ ok, skill?, error? }` | 从外部目录复制到 userSkillsRoot |
| `knowclaw:deleteSkill` | renderer → main | `{ name }` | `{ ok, error? }` | 删除用户 skill（内置 skill 拒绝） |
| `knowclaw:toggleSkill` | renderer → main | `{ name, enabled }` | `{ ok }` | 启用/禁用 skill（更新 prefs.skills.disabled） |
| `knowclaw:reloadSkills` | renderer → main | `{}` | `{ ok, count }` | 强制 resourceLoader.reload()，返回新 skill 数量 |
| `knowclaw:scanExternalSkills` | renderer → main | `{}` | `{ sources: ExternalSource[] }` | 扫描 ~/.claude/skills/ + ~/.cursor/skills-cursor/ 等外部目录 |

`SkillInfo` 返回结构：

```typescript
interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: 'builtin' | 'user' | 'imported' | 'workspace';
  enabled: boolean;
  disableModelInvocation: boolean;
  importedFrom?: string;     // source === 'imported' 时有值
  importedAt?: string;       // ISO 日期
}
```

---

## 4. 阶段总览

| 阶段 | 名称 | Status | 预估工作量 | 依赖 |
|------|------|--------|----------|------|
| SK0 | Skill 服务层 + IPC 基础设施 | `DONE` | 1–1.5 天 | 无 |
| SK1 | Skill 管理 UI（列表 + 详情 + 启用禁用） | `DONE` | 2–2.5 天 | SK0 |
| SK2 | 外部 Skill 导入 | `DONE` | 1.5–2 天 | SK0 |
| SK3 | 热重载 + 悬浮窗集成 | `DONE` | 0（架构合并） | SK0 |
| SK4 | 工作空间级 Skill 支持 | `DONE` | 0.5 天 | SK0 + SK3 |
| SK5 | Skill Selector 输入器 | `DONE` | 0.5 天 | SK0 + SK1 |

**总计**：5.5–7 天（不含 SK4）/ 6–7.5 天（含 SK4）/ 6.5–8 天（含 SK5）

---

## 5. 各阶段详细计划

---

### Phase SK0 — Skill 服务层 + IPC 基础设施

**Status:** `DONE`（2026-05-26）

**目标**：建立后端 skill 管理能力，所有 IPC 通道就绪，为后续 UI 和导入功能提供底座。

#### SK0.1 现状锚点（开发前）

| 模块 | 路径 | 现状（开发前） |
|------|------|------|
| ResourceLoader 构建 | `Agent/pi-runtime/bootstrap.js` L542-549 | `new DefaultResourceLoader({ additionalSkillPaths })` 接受 skill 路径数组 |
| Skill 过滤 | `bootstrap.js` | **未使用** `skillsOverride` 回调，无法禁用单个 skill |
| 用户 Skill 目录 | `src/main.js` L2085-2086 | `KNOWCLAW_USER_SKILLS_ROOT` 已设置但仅作为路径传递 |
| Skill IPC | 无 | 不存在任何 skill 管理相关的 IPC handler |
| Skill 偏好 | 无 | `state.prefs` 中无 `skills` 字段 |

#### SK0.2 工作清单（实际实施结果）

> 原计划将逻辑拆为 `Agent/services/skillService.js`（服务层）+
> `src/main/ipc/skills.js`（薄 IPC 包装）两个文件。实际开发时合并为
> `src/main/ipc/skills.js` 一个文件（~480 行），因为：
>
> 1. `skillService` 的所有方法都是简单的 fs + SDK 调用，拆分为独立服务层
>    会导致不必要的间接层且增加文件跳转负担；
> 2. 项目现有 IPC 模块（`knowclaw.js` ~2900 行）也将全部逻辑内联在工厂函数
>    中，保持风格一致。
>
> 原计划把状态放在 `state.prefs.skills`（需改 `prefs.js` 白名单），实际选择了
> `state.knowclaw.skills`（复用 `readKnowClawState`/`patchKnowClawState`
> 现有模式），无需触碰 `prefs.js`。

**新建文件（1 个）**：

1. **`src/main/ipc/skills.js`**（480 行）
   - 工厂函数：`registerSkillsIpc({ ipcMain, readState, writeState })`
   - 7 个 IPC handler：`knowclaw:listSkills` / `knowclaw:getSkillContent` / `knowclaw:importSkill` / `knowclaw:deleteSkill` / `knowclaw:toggleSkill` / `knowclaw:reloadSkills` / `knowclaw:scanExternalSkills`
   - 内部辅助函数：`readSkillsState` / `patchSkillsState` / `classifySkillSource` / `scanSkillDir` / `toSkillInfo` / `isSafeSkillPath` / `isValidSkillName` / `getExternalSkillRoots`
   - 扫描：直接 import SDK 公开导出 `loadSkillsFromDir` + `parseFrontmatter`（不维护持久化 ResourceLoader 实例）
   - 路径安全：`isSafeSkillPath()` 校验所有读/删目标在 builtin/user 根之下，防路径穿越
   - 导入增强：支持 `overwrite:true` 覆盖已有 skill；重名检测区分 `conflict:'exists'` vs `conflict:'builtin'`；重新导入自动清除 disabled 状态
   - 外部扫描：`scanExternalSkills` 检测 Claude / Cursor 三个标准目录，已导入条目标记 `alreadyImported:true`

**修改文件（4 个）**：

2. **`Agent/pi-runtime/bootstrap.js`**（+35 行）
   - `createSession(opts)` 新增 `opts.disabledSkills: string[]` 参数
   - `disabledSkills` 非空时构造 `skillsOverride: ({skills,diagnostics}) => ({skills: skills.filter(s => !disabledSet.has(s.name)), diagnostics})` 传入 `DefaultResourceLoader` 构造函数
   - 空列表时 `skillsOverride` 留 `undefined`（走 pi 原生 fast-path）
   - 日志增加 disabled skill 名称列表输出

3. **`src/main/ipc/knowclaw.js`**（+20 行）
   - `readKnowClawState()` 扩展返回 `skillsDisabled: string[]`（读自 `state.knowclaw.skills.disabled`）
   - `ensureSession()`（新建/续接）调用 `runtime.createSession` 时传入 `disabledSkills: skillsDisabled`
   - `openSession()`（打开历史 JSONL）同上
   - `forkSession()`（分叉）同上
   - 三处均解构 `const { subAgentEnabled, skillsDisabled } = readKnowClawState()`

4. **`src/preload.js`**（+25 行）
   - 新增 `window.ipm.skills` 命名空间，7 个方法：`list` / `getContent` / `import` / `delete` / `toggle` / `reload` / `scanExternal`
   - `import` 方法额外接受 `opts.overwrite` 参数

5. **`src/main.js`**（+12 行）
   - 顶部新增 `import { registerSkillsIpc } from './main/ipc/skills.js'`
   - `app.whenReady()` 回调内、`registerKnowClawIpc({...})` 之后调用 `registerSkillsIpc({ ipcMain, readState, writeState })`

**未修改的文件**：
- `src/main/ipc/prefs.js` — 不需要，状态存在 `state.knowclaw.skills` 而非 `state.prefs.skills`

#### SK0.3 候选方案

| ID | 问题 | 选项 |
|----|------|------|
| D-SK0-1 | `skillsOverride` vs `noSkills` + 手动注入 | **A. `skillsOverride` 回调过滤** ✅（已采用：侵入最小，pi SDK 原生支持）；~~B. `noSkills: true` + 自行调 `loadSkills`~~（重复实现 SDK 逻辑） |
| D-SK0-2 | reloadSkills 是否中断当前 session | **A. 不中断** ✅（已采用：仅写 state，下次 newSession 生效；与 subAgentEnabled 开关同模式）；~~B. 强制销毁当前 session~~（不可行：ResourceLoader 是 per-session 局部变量，无法从外部调 reload） |
| D-SK0-3 | ResourceLoader 生命周期 | **A. 不维护持久实例** ✅（listSkills 直接调 SDK `loadSkillsFromDir()` 扫描；createSession 用 skillsOverride 过滤）；~~B. 提升为模块级变量~~（大幅重构 bootstrap.js 作用域）；~~C. 维护独立扫描 loader~~（增加复杂度无收益） |
| D-SK0-4 | 状态存储位置 | **A. `state.knowclaw.skills`** ✅（复用 `readKnowClawState` / `patchKnowClawState` 模式，无需改 prefs.js 白名单）；~~B. `state.prefs.skills`~~（需改 prefs.js 白名单 patch 逻辑） |

#### SK0.4 决策记录

| 编号 | 决策 | 结论 | 日期 |
|------|------|------|------|
| D-SK0-1 | 禁用 skill 实现方式 | `skillsOverride` 回调过滤 | 2026-05-26 |
| D-SK0-2 | reloadSkills 影响范围 | 不中断当前 session，下次 newSession 生效 | 2026-05-26 |
| D-SK0-3 | ResourceLoader 生命周期 | 不维护持久实例，listSkills 用 SDK 导出的 `loadSkillsFromDir` 直接扫描 | 2026-05-26 |
| D-SK0-4 | 状态存储位置 | `state.knowclaw.skills`（非 `state.prefs.skills`） | 2026-05-26 |

#### SK0.5 验收标准

- [x] DevTools 中 `await window.ipm.skills.list()` 返回包含 6 个内置 skill 的数组，每个含 `name / description / source / enabled`
- [x] `toggle('pdf', false)` 后 `list()` 返回 pdf 的 `enabled: false`
- [x] 新建会话后 system prompt 中不含被 disabled 的 skill 对应的 `<skill>` XML block（通过 `skillsOverride` 过滤实现）
- [x] `reload()` 成功返回新 skill 数量
- [x] `scanExternal()` 能检测到本机 `~/.claude/skills/` 下的 skill（如果存在）
- [x] 路径安全：传入非法路径时返回 `{ok:false, error:'filePath is not within a trusted skill root'}`
- [x] 主台 KnowClaw 现有所有功能行为不变（零侵入式增量：bootstrap.js 中 `disabledSkills=[]` 时 `skillsOverride` 为 `undefined`，走原 fast-path）

#### SK0.6 风险

| ID | 风险 | 概率 | 影响 | 缓解 | 实际情况 |
|----|------|------|------|------|---------|
| RW-SK0-1 | `skillsOverride` 与 pi SDK 未来版本不兼容 | 低 | 中 | 回调签名 `(result) => result` 是 SDK 公开 API，有 d.ts 类型保障 | pi v0.74 已确认支持 |
| RW-SK0-2 | reload 与正在 streaming 的 session 竞态 | 低 | 中 | 最终方案不涉及 reload（不维护持久 loader），彻底规避 | 已规避 |

#### SK0.7 变更日志

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-26 | 立项 | SK0 计划制定完成 |
| 2026-05-26 | 实施完成 | 新建 `src/main/ipc/skills.js`（480 行，7 个 IPC handler）；修改 `bootstrap.js`（+35 行，`disabledSkills` + `skillsOverride` 回调）；修改 `knowclaw.js`（+20 行，`readKnowClawState` 扩展 + 3 处 createSession 传参）；修改 `preload.js`（+25 行，`window.ipm.skills` 命名空间）；修改 `main.js`（+12 行，import + 注册调用）。所有文件 Node `--check` 语法验证通过、linter 零错误 |

---

### Phase SK1 — Skill 管理 UI（列表 + 详情 + 启用禁用）

**Status:** `DONE`（2026-05-26）

**目标**：用户可在 KnowClaw 页面中查看和管理所有 skill。

#### SK1.1 现状锚点

| 模块 | 路径 | 现状 |
|------|------|------|
| KnowClaw Header | `src/ui/components/knowclaw-v2/KnowClawV2Page.jsx` | 已有 WorkspaceSelector / PlanModeToggle / FileTree toggle 等按钮，可新增 Skills 入口 |
| 右侧面板 | `WorkspaceFileTree.jsx` | 文件树通过 Header toggle 控制显隐，可参考同样模式增加 Skills 面板 |
| Markdown 渲染 | `marked` 依赖已在 `BubbleView.jsx` / `FloatingChatList.jsx` 中使用 | 可直接复用 |
| Skill 文案 | `KnowClawBubble.jsx` L42 | 注释提及未来可能有 "Skills tab"，但当前未实现 |

#### SK1.2 UI 设计

**入口位置**：KnowClaw 页面 Header 新增独立按钮（Puzzle 图标），与 FileTree toggle 平级。

**面板布局**（右侧，与 WorkspaceFileTree 切换）：

```
┌──────────────────────────────────────┐
│ 技能管理                    [🔄] [×] │  Header (刷新 + 关闭)
├──────────────────────────────────────┤
│ 🔍 搜索技能...                       │  搜索栏
├──────────────────────────────────────┤
│ ▾ 内置技能 (6)                       │  分组折叠
│ ┌────────────────────────────────┐  │
│ │ 📄 docx                   [✓] │  │  name + Switch
│ │ 处理 Word 文档相关任务...      │  │  description 摘要
│ ├────────────────────────────────┤  │
│ │ 📊 xlsx                   [✓] │  │
│ │ 处理 Excel 表格相关任务...     │  │
│ ├────────────────────────────────┤  │
│ │ ...                            │  │
│ └────────────────────────────────┘  │
│                                      │
│ ▾ 用户技能 (2)                       │
│ ┌────────────────────────────────┐  │
│ │ 🔧 my-skill               [✓] │  │
│ │ 自定义工作流...            [🗑] │  │  用户 skill 有删除按钮
│ └────────────────────────────────┘  │
│                                      │
│ [+ 导入技能]                         │  底部导入入口
└──────────────────────────────────────┘
```

**详情弹窗**（点击 skill 名称弹出）：

```
┌──────────────────────────────────────────┐
│ docx                         [×]         │
├──────────────────────────────────────────┤
│ 来源: 内置技能                           │
│ 路径: D:\...\pi-runtime\skills\docx\     │
│ 状态: ✅ 已启用                          │
├──────────────────────────────────────────┤
│                                          │
│ # docx                                   │
│                                          │
│ 处理 Microsoft Word（.docx）文档相关     │
│ 任务时使用本技能...                      │
│                                          │
│ ## 何时使用                              │
│ ...（SKILL.md 完整 Markdown 渲染）       │
│                                          │
└──────────────────────────────────────────┘
```

#### SK1.3 工作清单（实际实施结果）

**新建文件**：

1. **`src/ui/components/knowclaw-v2/SkillManagerPanel.jsx`**（~315 行）✅：
   - 右侧面板组件，288 px 宽（`w-72`），与 `WorkspaceFileTree` 同级同骨架
   - 分组列表：内置 / 用户 / 导入（每组可折叠，header 显示计数 badge）
   - 每行：skill 名称（可点击查看详情，title=完整 description）+ description 摘要（截断 60 字）+ `disable-model-invocation` manual badge（如有）+ 启用/禁用 pill button（hover 删除按钮，仅 user / imported）
   - 搜索框过滤 name / description，自动聚焦，支持 X 清空
   - 底部"+ 导入技能"按钮（占位，SK2 接入 `onImport`）
   - Header 区刷新（`RefreshCw`，loading 时切换 `Loader2 animate-spin`）+ 关闭（`X`）
   - 删除走 `useConfirmDialog`（danger 模式）二次确认
   - 切换/删除时短暂 `busy` 锁，防 IPC 在途双击
   - 空态 / 加载态 / 搜索零结果 三段差异化提示

2. **`src/ui/components/knowclaw-v2/SkillDetailModal.jsx`**（~205 行）✅：
   - 全屏遮罩 + `w-[min(720px,92vw)] max-h-[min(82vh,820px)]` 圆角弹窗
   - 顶部元信息：Puzzle 图标 + name + source badge + enabled pill + manual-only pill + description + filePath（含"在文件管理器中打开"按钮）+ 导入来源（如适用）
   - 主体：mount 时 IPC `knowclaw:getSkillContent` 取 `body`（frontmatter 已剥）→ `marked.parse()` 渲染
   - 取消/Esc/点遮罩三种关闭方式
   - 内联 `<style>` 定义 `.skill-md-body` 命名空间排版（h1-h6 / pre / code / blockquote / table 等）
   - 加载态 / 错误态 单独分支

**修改文件**：

3. **`src/ui/hooks/useKnowClawPersist.jsx`**（+约 130 行）✅：
   - 新增状态 `skills`（`SkillInfo[]`）与 `skillsLoading`
   - 新增 action `loadSkills`：调 `window.ipm.skills.list()`，写入 `skills`
   - 新增 action `toggleSkill(name, enabled)`：乐观更新 → IPC `knowclaw:toggleSkill` → 失败回滚 + system 气泡；成功后追加 system 气泡说明"下次新对话起生效"（与 `toggleSubAgent` 同模式）
   - 新增 action `deleteSkill(name)`：IPC `knowclaw:deleteSkill` → 本地数组移除 → system 气泡说明
   - context value 与 useMemo deps 同步新增 `skills / skillsLoading / loadSkills / toggleSkill / deleteSkill`

4. **`src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`**（约 +90 行，~20 行重构）✅：
   - 状态重构：`showFileTree: boolean` → `rightPanel: 'fileTree' | 'skills' | null`，迁移逻辑兼容旧 `knowclaw.v2.showFileTree` localStorage key
   - 派生：`showFileTree = rightPanel === 'fileTree'`、`showSkillsPanel = rightPanel === 'skills'`、`toggleFileTree`、`toggleSkillsPanel`
   - Header 新增 Skills 按钮（Puzzle icon + PanelRight 开关图标，indigo 主题，与 FileTree amber 主题区分），`headerTier !== 'compact'` 时内联渲染
   - 右侧面板区按 `rightPanel` 值切换渲染：fileTree → `WorkspaceFileTree`；skills → `SkillManagerPanel`
   - 新增 useEffect：每次 `rightPanel` 切到 `'skills'` 调 `loadSkills()`（每次打开都刷新，因为 agent 可能在期间通过 skill-builder 生成新技能）
   - 新增 state `skillDetailTarget`（`SkillInfo | null`）+ 在 JSX 末尾条件渲染 `SkillDetailModal`
   - 从 `useKnowClawV2Chat` 解构新增 `skills / skillsLoading / loadSkills / toggleSkill / deleteSkill`

5. **`src/ui/components/knowclaw-v2/HeaderOverflowMenu.jsx`**（约 +30 行）✅：
   - 新增 props `showSkillsPanel`、`onToggleSkillsPanel`
   - 在 FileTree 行下方新增 "技能" 行（同结构，indigo 主题，Puzzle icon），仅当 `onToggleSkillsPanel` 传入时渲染

6. **`src/ui/components/knowclaw-v2/useKnowClawV2Chat.js`**：
   - 无需改动 — 该 facade 通过 `...ctx` 展开返回，新增字段自动透传

**注**：原 SK1 计划中提到的 `useHeaderTier.js` 实际无需改动，溢出菜单逻辑完全由 `HeaderOverflowMenu.jsx` 承担。

#### SK1.4 候选方案

| ID | 问题 | 选项 |
|----|------|------|
| D-SK1-1 | 面板位置 | **A. 右侧面板（与 FileTree 切换）**（推荐：复用现有布局模式）；B. 独立 Modal 弹窗；C. 新增 Tab 页 |
| D-SK1-2 | 详情展示方式 | **A. Modal 弹窗**（推荐：不占用面板空间）；B. 面板内 drill-down |

#### SK1.5 决策记录

| 编号 | 决策 | 结论 | 日期 |
|------|------|------|------|
| D-SK1-1 | 面板位置 | A — 右侧面板，与 FileTree 通过 `rightPanel` 状态机互斥切换 | 2026-05-26 |
| D-SK1-2 | 详情展示方式 | A — `fixed inset-0` 全屏 Modal（参考 `CardReaderModal`） | 2026-05-26 |
| D-SK1-3 | 开关组件样式 | 复用 `SubAgentToggle` 风格的 pill button（`aria-pressed` + 颜色切换），不引入 sliding switch | 2026-05-26 |
| D-SK1-4 | 面板打开时是否每次刷新 | 是 — 每次切到 Skills 自动调 `loadSkills`，因 agent 可能在期间生成新技能 | 2026-05-26 |
| D-SK1-5 | 切换/删除后是否中断当前 session | 不中断，仅追加 system 气泡说明"下次新对话生效"，与 `toggleSubAgent` 同 | 2026-05-26 |
| D-SK1-6 | localStorage 迁移 | 新增 `knowclaw.v2.rightPanel` 键存字符串；首次读取兼容旧 `knowclaw.v2.showFileTree=='1'` | 2026-05-26 |

#### SK1.6 验收标准

- [x] KnowClaw Header 可见 Skills 按钮（Puzzle 图标，indigo 色调），点击切换右侧面板
- [x] Skills 面板打开时 FileTree 自动关闭（互斥），反之亦然
- [x] 面板中列出所有 skill，按 内置/用户/导入 分组，每组可折叠并显示计数
- [x] 每个 skill 行有 enable/disable pill button，操作后 chat 中出现 system 气泡提示"下次新对话生效"
- [x] 用户/导入 skill 可删除，点击后弹出 `useConfirmDialog` 二次确认
- [x] 点击 skill 名称弹出详情 Modal，SKILL.md 完整 Markdown 渲染（h1-h6 / code / list / table 等样式齐备）
- [x] 搜索框可按 name / description 过滤，空结果有专属提示
- [x] compact 档 Header 下 Skills 入口出现在 `HeaderOverflowMenu` 溢出菜单中
- [x] localStorage 持久化 `rightPanel` 状态，旧 `showFileTree` 用户迁移无感

#### SK1.7 风险

| ID | 风险 | 概率 | 影响 | 缓解 |
|----|------|------|------|------|
| RW-SK1-1 | 右侧面板与 FileTree 切换逻辑冲突 | 低 | 中 | 复用 `showFileTree` 同套状态管理，改为 `rightPanel: 'fileTree' \| 'skills' \| null` |
| RW-SK1-2 | SKILL.md 内容过长导致 Modal 渲染卡顿 | 低 | 低 | `max-h-[70vh]` + `overflow-y-auto`；超长内容截断提示 |

#### SK1.8 变更日志

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-26 | 立项 | SK1 计划制定完成 |
| 2026-05-26 | 完成 | SK1 实施落地：新增 `SkillManagerPanel.jsx` / `SkillDetailModal.jsx`；`useKnowClawPersist.jsx` 扩展 `skills` 状态与 `loadSkills / toggleSkill / deleteSkill` actions；`KnowClawV2Page.jsx` 重构右侧面板状态为 `rightPanel` 三态并接入 Skills 入口；`HeaderOverflowMenu.jsx` 增加技能行；lint 通过 |

---

### Phase SK2 — 外部 Skill 导入

**Status:** `DONE`（2026-05-26）

**目标**：用户可一键导入外部 Skill（本地目录 + Claude Code / Cursor 自动扫描）。

#### SK2.1 用户需求

> 需要实现外部 skill 导入功能，只要是规范的 Claude Code 的 skill，都能导入
> 到我们的系统中使用。

#### SK2.2 导入源设计

| 导入源 | 实现方式 | 优先级 |
|--------|---------|--------|
| 本地目录 | `Electron dialog.showOpenDialog` 选择包含 SKILL.md 的目录 → `fs.cpSync` 到 userSkillsRoot | P0 |
| Claude Code | 自动扫描 `~/.claude/skills/` → 列出可导入 skill → 用户勾选 → 复制 | P0 |
| Cursor | 自动扫描 `~/.cursor/skills-cursor/` + `~/.cursor/skills/` → 同上 | P0 |
| Git 仓库 URL | 输入 URL → `git clone` 到临时目录 → 扫描 → 复制 | **P2（首期不做）** |

#### SK2.3 导入流程

```
用户点击"导入技能" → ImportSkillDialog 弹窗
    │
    ├─ Tab 1：本地目录
    │   → 选择文件夹 → 验证 SKILL.md 存在 → 预览 name/description
    │   → 确认导入 → fs.cpSync → 记录 importedSources → reloadSkills
    │
    ├─ Tab 2：Claude Code / Cursor
    │   → scanExternalSkills() → 列出所有可导入 skill
    │   → checkbox 多选 → 批量导入 → reloadSkills
    │
    └─ Tab 3：Git 仓库（P2）
        → 输入 URL → clone → 扫描 → 选择 → 导入
```

#### SK2.4 工作清单（实际实施结果）

**新建文件**：

1. **`src/ui/components/knowclaw-v2/ImportSkillModal.jsx`**（~590 行）✅：
   - 全屏 Modal（`fixed inset-0 z-[2000]`，680×640 px，与 `SkillDetailModal` 同骨架）
   - 两个 Tab：本地目录 / 外部工具（indigo 下划线，无 Git P2 占位）
   - **本地目录 Tab** — 状态机 `idle → loading → preview → importing → conflict → success`：
     - 大型虚线按钮选择文件夹 → `chooseSkillDir` IPC → 返回预览卡（name + 名称合规 badge + manual-only badge + description + 来源路径 + 浅层文件列表 grid，超 20 项截断）
     - description 缺失时按钮 disable + 红字提示
     - 冲突路径渲染为三选一面板：覆盖（rose 主题，警告文案）/ 重命名（输入框 + 实时校验，预填 `name-2`）/ 返回预览
     - 成功路径展示绿色对勾 + "下次新对话生效" + 900ms 后自动复位调 `onDone`
   - **外部工具 Tab**：
     - mount 调 `scanExternalSkills`，loading / error / empty / data 四态
     - 顶部 amber 安全提示横幅（RW-SK2-1 缓解）
     - 工具栏：重新扫描按钮 + 全选/取消全选按钮
     - 按 provider 分组（Claude 橙、Cursor 紫 badge），每项 checkbox + name + 已导入/manual badge + description（100 字截断）
     - 整行可点击切换（已导入项 opacity 60% 禁用）
     - 底部固定操作栏：已选 N / 共可导入 M + 批量"导入选中"按钮
     - 批量导入逐条调 `importSkill`（`for...of + await`），实时刷新进度条 + 失败列表
     - 完成后自动 `refresh()` 让"已导入"badge 更新

**修改文件**：

2. **`src/main/ipc/skills.js`**（约 +100 行）✅：
   - **`importSkill` 扩展 `newName`**：新增 `payload.newName` 参数；当 `newName` 与解析出的 `candidateName` 不同时使用 `finalName`，复制完成后用正则 `/^(name:\s*).+$/m` 重写 SKILL.md 的 name 字段（无 frontmatter 时合成最小 frontmatter，无 `name:` 行时插入到 `---` 后）；冲突响应增加 `conflictName` / `parsedName` 字段以便 UI 预填重命名输入框；`importedSources` 记录 `originalName` 以便追溯
   - **新增 `knowclaw:chooseSkillDir` IPC**：调 `dialog.showOpenDialog({ properties: ['openDirectory'] })`，验证 `SKILL.md` 存在 + parse frontmatter，返回 `{ ok, dir, name, nameValid, description, disableModelInvocation, files, hasDescription }`（hidden 文件过滤、withFileTypes 标记 isDir、非 fatal 读目录失败）
   - 启动日志由 "7 IPC channels" 改为 "8 IPC channels"

3. **`src/preload.js`**（约 +6 行）✅：
   - `skills.import` 增加 `newName` 透传
   - `skills.chooseDir()` 新增 IPC bridge

4. **`src/ui/hooks/useKnowClawPersist.jsx`**（约 +85 行）✅：
   - 新增 `importSkill(srcDir, opts)`：成功时 await `loadSkills` + system 气泡（"已导入（已重命名）"区分）；conflict 响应直接透传给调用方让 modal 处理；其他失败追加 error 气泡
   - 新增 `scanExternalSkills()`：薄 IPC 透传
   - 新增 `chooseSkillDir()`：薄 IPC 透传
   - context value 与 useMemo deps 同步新增三者

5. **`src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`**（约 +25 行）✅：
   - import `ImportSkillModal`
   - 从 `useKnowClawV2Chat` 解构新增 `importSkill / scanExternalSkills / chooseSkillDir`
   - 新增 state `showImportModal`
   - `SkillManagerPanel.onImport` 接入 `() => setShowImportModal(true)`
   - JSX 末尾新增 `<ImportSkillModal>` 总是挂载（由 `open` prop 控制可见），`onImported` 调 `loadSkills` 兜底刷新

**说明**：原计划提到的 `Agent/services/skillService.js` 实际不存在 — SK0 阶段已将所有逻辑收纳进 `src/main/ipc/skills.js` 单一模块，因此本阶段亦遵循同样的内聚边界。

#### SK2.5 候选方案

| ID | 问题 | 选项 |
|----|------|------|
| D-SK2-1 | 导入策略 | **A. 复制到 userSkillsRoot**（推荐：跨盘安全、portable、不依赖外部程序）；~~B. 符号链接~~（Windows 需管理员权限、跨盘不支持） |
| D-SK2-2 | 重名处理 | **A. 警告 + 三选一（覆盖/改名/取消）**（推荐）；B. 直接覆盖 |
| D-SK2-3 | Git 仓库导入 | **首期不做**（需要 `git` 运行时依赖），保留 P2 |

#### SK2.6 决策记录

| 编号 | 决策 | 结论 | 日期 |
|------|------|------|------|
| D-SK2-1 | 导入策略 | A — 复制到 userSkillsRoot（不用符号链接） | 2026-05-26 |
| D-SK2-2 | 重名处理 | A — 三选一（覆盖 / 改名 / 取消） | 2026-05-26 |
| D-SK2-3 | Git 仓库导入 | 首期不做，保留 P2 | 2026-05-26 |
| D-SK2-4 | 交互形式 | Modal 全屏弹窗（与 `SkillDetailModal` 同骨架） | 2026-05-26 |
| D-SK2-5 | 目录选择器 IPC | 在 `skills.js` 新增专用 `knowclaw:chooseSkillDir`（不复用 `knowclaw:chooseDirectory`），同时在主进程做预览解析以减少 IPC roundtrip | 2026-05-26 |
| D-SK2-6 | 改名实现 | 主进程复制后用正则改写 SKILL.md 的 `name:` 行（缺失时合成 frontmatter），不引入 YAML 库 | 2026-05-26 |

#### SK2.7 验收标准

- [x] 本地目录导入：选择包含合法 SKILL.md 的目录 → 预览 → 确认 → userSkillsRoot 下出现副本 → listSkills 可见
- [x] 选择不含 SKILL.md 的目录 → 错误提示（红色横幅），不进入预览
- [x] Claude Code 导入：`~/.claude/skills/` 下的 skill 出现在列表中 → 勾选 → 导入成功
- [x] Cursor 导入：`~/.cursor/skills-cursor/` 下的 skill 出现在列表中 → 勾选 → 导入成功
- [x] 重名时显示三选一面板：覆盖可工作 / 改名可工作（输入新名 → SKILL.md `name:` 被正确改写）/ 返回预览
- [x] 已导入的 skill 在外部工具 Tab 中显示"已导入"badge，checkbox 禁用且整行不可点
- [x] 安全提示横幅（amber 配色）在外部工具 Tab 始终可见
- [x] 导入 skill 带有非标准 frontmatter 字段（如 Cursor 的 `metadata.surfaces`）时不报错（`parseFrontmatter` 容忍未知字段，复制时整文件保留）
- [x] 导入成功后 chat 出现 system 气泡"下次新对话起生效"
- [x] 批量导入展示进度条 + 失败列表，自动刷新已导入状态

#### SK2.8 风险

| ID | 风险 | 概率 | 影响 | 缓解 |
|----|------|------|------|------|
| RW-SK2-1 | 外部 skill 包含恶意脚本 | 低 | 高 | 导入预览时显示安全提示：「技能可指示 AI 执行任意操作，请仅导入可信来源的技能」 |
| RW-SK2-2 | Claude/Cursor 未安装，扫描路径不存在 | 中 | 低 | `scanExternalSkillSources` 对不存在的路径静默跳过，UI 显示"未检测到"提示 |
| RW-SK2-3 | 外部 skill 内含大文件（模型、数据集） | 低 | 中 | 复制前统计目录大小，超过 50MB 弹出警告 |

#### SK2.9 变更日志

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-26 | 立项 | SK2 计划制定完成 |
| 2026-05-26 | 完成 | SK2 实施落地：新增 `ImportSkillModal.jsx`（双 Tab + 三选一冲突处理 + 批量进度）；`skills.js` 新增 `knowclaw:chooseSkillDir` IPC + `importSkill` 扩展 `newName` 改名支持（含 SKILL.md `name:` 行正则重写）；`preload.js` 新增 `chooseDir` bridge 与 `newName` 透传；`useKnowClawPersist.jsx` 新增 `importSkill / scanExternalSkills / chooseSkillDir` 三个 actions；`KnowClawV2Page.jsx` 接入 ImportSkillModal 并接通 SkillManagerPanel 底部按钮；lint 通过 |

---

### Phase SK3 — 热重载 + 悬浮窗集成

**Status:** `DONE`（2026-05-26，通过 SK0–SK2 的架构决策与代码路径合并自动实现，无需新增代码）

**目标**：Skill 变更后无需重启即可生效；悬浮窗 KnowClaw 同步感知 skill 列表。

> **关键说明**：本阶段在立项后经评估发现，原计划中的两条主线（"热重载" + "悬浮窗集成"）均在 SK0–SK2 实施过程中被其它决策间接覆盖，无需新增任何代码。SK3 收尾仅做文档对账。详细分析见 § SK3.1 与 § SK3.2。

#### SK3.1 关于"热重载" — 已通过 SK0 决策 D-SK0-3 排除

**原计划**：暴露 `reloadResourceLoader()`，让 UI 调用 `resourceLoader.reload()` 即时刷新所有 session 的 skill 列表。

**实际架构（SK0 落地后）**：

1. SK0 决策 D-SK0-3 选择了 "**不维护持久 ResourceLoader 实例**"。
2. [`Agent/pi-runtime/bootstrap.js`](../Agent/pi-runtime/bootstrap.js) 中 `resourceLoader` 是 `createSession()` 函数作用域内的局部变量（约 L540），函数返回后不可访问。
3. 因此从外部"调用 `resourceLoader.reload()`"在物理上不可能 — 没有引用可拿。
4. 现有 `knowclaw:reloadSkills` IPC（[`src/main/ipc/skills.js`](../src/main/ipc/skills.js) L650+）已退化为纯磁盘扫描查询，返回 `{ count, requiresNewSession: true }`，不触碰任何 session。

**等价机制（已实现）**：

| 用户操作 | 立即生效的部分 | 下次新对话生效的部分 |
|---------|--------------|------------------|
| 启用 / 禁用 skill | UI 面板乐观更新（`useKnowClawPersist.toggleSkill`） | system prompt 中的 skill 列表（`skillsOverride` 在 `createSession` 时读取最新 `disabledSkills`） |
| 导入 skill | 面板自动 `loadSkills()` 刷新（IPC 直接调 `loadSkillsFromDir`） | system prompt 中出现新 skill |
| 删除 skill | 面板自动从本地数组移除 | system prompt 中移除该 skill |

每个变更操作后都会向 chat 追加 system 气泡说明"下次新对话起生效"，与 `subAgentEnabled` 开关同 UX 模式。这套机制完全覆盖了原计划"热重载"想达到的目标用户体验（用户改完不用重启），同时避免了多 session 共享可变状态可能引发的竞态问题。

#### SK3.2 关于"悬浮窗集成" — 已通过 SK0 的 `disabledSkills` 传参自动实现

**原计划**：让悬浮窗 floating channel 与主台共享 `resourceLoader` 实例，使 `reloadSkills` 对两通道同时生效。

**实际架构（SK0/FK0 落地后）**：

1. 悬浮窗与主台**不共享 `resourceLoader` 实例**（per-session 局部变量），但**共享同一份持久化状态**（`state.knowclaw.skills.disabled`）。
2. 悬浮窗 session 创建走 [`src/main/ipc/knowclaw.js`](../src/main/ipc/knowclaw.js) `ensureSession()` → `runtime.createSession()`，与主台代码路径完全一致。
3. `ensureSession()` 在 L1237 调用 `readKnowClawState()` 读取最新的 `skillsDisabled`，并在 L1248 作为 `disabledSkills` 传入 `runtime.createSession()`。
4. `bootstrap.js` 的 `createSession()` 用收到的 `disabledSkills` 构造 `skillsOverride` 回调，注入到 `DefaultResourceLoader`。

**结果**：悬浮窗每次新建对话都自动反映主台面板里设置的 skill 启用/禁用状态，无需任何额外代码或事件广播。悬浮窗 UI 也无需新增 skill 入口（原计划本就排除了悬浮窗独立管理 UI 的方案）。

#### SK3.3 工作清单（实际）

**无代码改动**。仅做文档同步：

1. 本节 SK3 状态从 `PLANNED` 改为 `DONE`，附"通过架构决策合并实现"说明。
2. § 4 阶段总览、§ 8 进度看板的 SK3 行同步更新。
3. 文档头 quote 同步。
4. 附录 · 变更记录追加 SK3 完成条目。

#### SK3.4 候选方案

| ID | 问题 | 选项 |
|----|------|------|
| D-SK3-1 | 是否仍执行原计划"热重载"代码改动 | **A. 不执行** ✅（已采用：SK0 架构决策使其物理上不可能且无必要）；~~B. 重构 bootstrap 暴露 reload 入口~~（推翻 D-SK0-3，复杂度收益失衡） |
| D-SK3-2 | 悬浮窗是否新增 skill 列表/管理 UI | **A. 不新增** ✅（已采用：管理统一在主台；悬浮窗自动通过 SK0 `disabledSkills` 传参反映最新状态） |
| D-SK3-3 | 是否保留 `knowclaw:reloadSkills` IPC | **A. 保留作为纯查询** ✅（已采用：UI 刷新按钮调它返回最新 count，便于用户感知扫描结果）；~~B. 移除~~（不必要的破坏性变更，可能影响后续 SK4） |

#### SK3.5 决策记录

| 编号 | 决策 | 结论 | 日期 |
|------|------|------|------|
| D-SK3-1 | 热重载实施方式 | 不执行 — 通过 SK0 的 `skillsOverride + createSession 每次读最新 disabledSkills` 路径等价实现；用户感知层用 system 气泡通知"下次新对话生效" | 2026-05-26 |
| D-SK3-2 | 悬浮窗 skill UI | 不新增 — 悬浮窗共享 `state.knowclaw.skills` 持久化状态，session 创建路径与主台完全一致，自动生效 | 2026-05-26 |
| D-SK3-3 | `reloadSkills` IPC 去留 | 保留为纯查询（返回最新 skill count），便于面板刷新按钮使用 | 2026-05-26 |

#### SK3.6 验收标准

- [x] **导入新 skill 后，面板立即显示新 skill** — `useKnowClawPersist.importSkill` 成功后 `await loadSkills()` 触发面板刷新
- [x] **禁用 skill 后，新建会话的 system prompt 中不含该 skill** — `ensureSession()` 每次读 `state.knowclaw.skills.disabled`，传给 `skillsOverride` 过滤
- [x] **悬浮窗新建 session 后，system prompt 反映最新的 skill 列表** — 悬浮窗走相同 `ensureSession()` 路径，共享同一份持久化状态
- [x] **主台正在 streaming 时变更 skill 不中断对话** — 变更仅写 state，活跃 session 已固化自己的 skill 集（pi SDK 在 `createSession` 时快照）
- [x] **新建 session 时日志打印 skill 集与禁用名单** — `bootstrap.js` 已在 SK0 中加日志（约 L596 `log('skills enumeration failed...')` 上下文中输出 skill 名 + diagnostics）
- [N/A] ~~`reload` 后的 session 创建日志打印 `[KnowClaw] session skill set: [...]`~~ — 改为：每次 `createSession` 时打印（SK0 已实现）；外部"reload"概念因 D-SK0-3 不存在

#### SK3.7 风险

| ID | 风险 | 概率 | 影响 | 缓解 |
|----|------|------|------|------|
| RW-SK3-1 | 用户期望"立即生效"，但实际"下次新对话生效"造成困惑 | 中 | 低 | 每次变更追加 system 气泡明确告知"下次新对话起生效"；面板 Header 与 Footer 也固定标注 |
| RW-SK3-2 | 悬浮窗用户找不到 skill 管理入口 | 低 | 低 | 文档说明"统一在主台管理"；悬浮窗本就是轻量快问场景，不期望承担管理功能 |

#### SK3.8 变更日志

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-26 | 立项 | SK3 计划制定完成 |
| 2026-05-26 | 完成 | SK3 收尾完成 — 经评估，原计划两条主线在 SK0–SK2 实施中已被架构决策合并实现，**无新增代码**：① 热重载因 SK0 决策 D-SK0-3（不维护持久 ResourceLoader）排除，等价机制为 `createSession` 时每次读最新 `disabledSkills` + 用 system 气泡通知用户；② 悬浮窗集成因 `ensureSession()` 路径与主台共用，自动反映最新 skill 状态；③ `knowclaw:reloadSkills` IPC 保留为纯查询用于面板刷新。仅更新本文档对账 |

---

### Phase SK4 — 工作空间级 Skill 支持

**Status:** `DONE` (2026-05-26)

**目标**：支持在工作空间目录下放置 `.knowclaw/skills/`，实现 skill 与项目/案件的绑定。
在切换工作空间时自动加载对应的工作空间级 skill。

#### SK4.1 设计与实现

**目录约定**：

```
userfile/projects/案件A/
├── meta/
├── temp/
├── .knowclaw/
│   └── skills/
│       └── case-a-workflow/
│           └── SKILL.md
└── ...
```

**加载与隔离**：

- `createSession(cwd)` 时 `bootstrap.js` 自动把 `<cwd>/.knowclaw/skills/` 追加到 `additionalSkillPaths`（前提是目录存在）。
- 因为 SK0 的架构决策，session 与 `resourceLoader` 一一对应：`setCwd` 触发 `disposeChannelSession`，下次 send 时新 session 自然指向新 cwd，无需单独"重新加载"逻辑。
- 切换工作空间后，前一个工作空间的 skill 自动从下次 session 移除。
- 禁用状态（`state.knowclaw.skills.disabled`）由 name 索引，workspace skill 与全局 skill 共享同一开关。

**优先级（首次发现胜出）**：

| 顺序 | 桶 | 来源 |
|------|----|------|
| 1 | `builtin` | KnowClaw 预装 |
| 2 | `workspace` | `<cwd>/.knowclaw/skills/` |
| 3 | `user` | `KNOWCLAW_USER_SKILLS_ROOT` |
| 4 | `imported` | user 下、有 `importedSources` 记录 |

UI 列表（`listSkills` IPC）与运行时（`additionalSkillPaths` 顺序）使用同一优先级，确保用户在面板看到的"哪个 skill 当前生效"与模型实际看到的保持一致。

#### SK4.2 实现摘要

1. **`desktop/src/main/ipc/skills.js`**：
   - 新增 `resolveWorkspaceSkillDir(cwd)` 工具函数。
   - `classifySkillSource` 增加 `workspaceSkillRoot` 参数 + workspace 路径判定（在 builtin 之后、imported/user 之前）。
   - `knowclaw:listSkills` 接受 `payload.cwd`，扫描第三个桶（workspace），合并去重，`roots` 返回新增 `workspace` 字段。
   - `knowclaw:getSkillContent` 接受 `payload.cwd`，把 workspace root 注入 `isSafeSkillPath` 的 `extraRoots`。
   - `knowclaw:deleteSkill` 接受 `payload.cwd` + 可选 `payload.scope`（'workspace' | 'user'）；默认 workspace-wins-if-present；workspace 删除不清理 `importedSources`（因为 workspace skill 不进入该索引）。

2. **`desktop/Agent/pi-runtime/bootstrap.js`**：
   - `createSession(cwd)` 在 `additionalSkillPaths` 中按 `[builtin, workspace?, user]` 顺序插入 workspace 路径。

3. **`desktop/src/preload.js`**：
   - `skills.list(opts)`、`skills.getContent(filePath, opts)`、`skills.delete(name, opts)` 全部接受 `opts.cwd` / `opts.scope`。

4. **`desktop/src/ui/hooks/useKnowClawPersist.jsx`**：
   - `loadSkills(cwd)` 透传 cwd 到 IPC。
   - `deleteSkill(name, { cwd, scope })` 透传到 IPC。
   - `importSkill(srcDir, opts)` 内部的成功后 refresh 使用 `opts.cwd`，避免覆盖列表后丢失 workspace skill。

5. **`desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`**：
   - 面板打开 / `currentCwd` 变化时，自动调用 `loadSkills(currentCwd)`。
   - `deleteSkill` 包装注入 `{ cwd: currentCwd, scope: source === 'workspace' ? 'workspace' : 'user' }`。
   - `SkillDetailModal` 接收并透传 `cwd`，`ImportSkillModal` 的 `onImported` + `importSkill` 包装注入 `cwd`。

6. **`desktop/src/ui/components/knowclaw-v2/SkillManagerPanel.jsx`**：
   - `GROUP_CONFIG` 增加 `workspace` 桶（amber 主题，"工作空间"badge，描述提示 `.knowclaw/skills/`）。
   - `grouped` 累积器新增 `workspace: []`；`totalMatched` 计入。
   - 渲染时 workspace 组在空列表时整体不渲染（与其他组的"显示空态提示"差异化处理，避免在 global / 无 workspace skill 的常态下增加视觉噪音）。

7. **`desktop/src/ui/components/knowclaw-v2/SkillDetailModal.jsx`**：
   - 接收 `cwd` prop 并在 `getContent` IPC 调用中传递。
   - `SOURCE_LABELS` 增加 `workspace` 项（amber 主题）。

#### SK4.3 决策记录

| ID | 问题 | 选择 |
|----|------|------|
| D-SK4-1 | 首期是否纳入 | **A. 纳入首期一并实施**。SK0~SK3 完成后，SK4 的实现成本极低（IPC 接受 `cwd` 参数 + UI 增加一个分组），收益却很大（项目级 skill 是合规/法律案件类工作流的天然诉求）。 |
| D-SK4-2 | workspace skill 是否允许 UI 删除 | **允许**。删除会移除 `<cwd>/.knowclaw/skills/<name>/` 目录，与 user/imported skill 行为一致；删除时不会触碰 `importedSources`（workspace skill 不进入该索引）。 |
| D-SK4-3 | workspace 与 user 同名时谁胜出 | **workspace 胜出**。Listings 和运行时统一遵循 `builtin > workspace > user > imported` 优先级；项目级覆盖全局是符合直觉的语义（类似 dotfiles / 配置文件）。 |
| D-SK4-4 | 空 workspace 组是否显示 | **空时整体隐藏**。其他组（user/imported/builtin）显示空态文案是因为有可操作提示；workspace 没有显眼的"如何创建"入口，强制显示会增加视觉噪音。 |
| D-SK4-5 | 删除 scope 是否需要显式参数 | **需要**。当 workspace 与 user 同名时，UI 必须能精确指定要删哪一份。`SkillManagerPanel` 调用 `onDelete(name, { source })`，页面包装层据此设置 IPC `scope`。 |

#### SK4.4 验收标准

- [x] 在 `<workspace>/.knowclaw/skills/my-skill/SKILL.md` 创建 skill 后，切换到该工作空间，`listSkills` 返回 `source: 'workspace'` 的 skill
- [x] 切换到其他工作空间后该 skill 不再出现（依赖 `useEffect([currentCwd])` 重新调用 `loadSkills`）
- [x] 工作空间 skill 与全局 skill 同名时不报错，workspace 优先（一致于 listSkills / `additionalSkillPaths` 顺序）
- [x] `bootstrap.js` 的 session 创建时正确注入 workspace skill 路径（只在 `cwd` 非空且目录存在时）
- [x] workspace skill 可从面板删除（确认弹窗 + `fs.rmSync` 删除目录 + 清理 disabled flag）
- [x] global 模式（无 cwd）时面板隐藏 workspace 分组，运行时 `additionalSkillPaths` 不包含 workspace 项

#### SK4.5 变更日志

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-26 | 立项 | SK4 计划制定完成 |
| 2026-05-26 | DONE | 实施完成：IPC 三件套（list/getContent/delete）接受 cwd；bootstrap 注入 workspace 路径；面板新增 amber 主题 workspace 分组；hook/page 全链路透传 cwd + scope；详情/导入弹窗适配。Skill 系统主线（SK0~SK4）至此全部 `DONE`。 |

---

### Phase SK5 — Skill Selector 输入器

**Status:** `DONE` (2026-05-27)

**目标**：让用户在 ChatInput 输入框旁直接选择一个或多个 skill，发送时由主进程
把对应 SKILL.md 内容以 `<pinned_skills>` XML 块注入用户消息前，使模型在
**首次响应**就能按 skill 指令执行，省去"先 Read SKILL.md"的工具调用回合
（~1 次模型调用 + 等待）。

#### SK5.1 核心机制

```mermaid
flowchart LR
  Sel["SkillSelector 弹窗\n（搜索 + 多选）"] -->|names[]| Page["KnowClawV2Page.pinnedSkills"]
  Page -->|sendMessage(text, images, names)| Hook["useKnowClawPersist"]
  Hook -->|knowclaw.send(text, images, names)| Preload["preload.js"]
  Preload -->|IPC: pinnedSkills| Main["knowclaw:send 主进程"]
  Main -->|resolvePinnedSkillContents| FS[("builtin / workspace / user\nSKILL.md")]
  Main -->|formatPinnedSkillsBlock| Inject["<pinned_skills>...</pinned_skills>\n\n[user text]"]
  Inject -->|session.prompt| LLM[("Model")]
```

候选方案对比（最终选择 B）：

- **方案 A — `/skill:name` 斜杠命令前缀**：复用 pi SDK 原生 `/skill:name args`
  扩展命令；SDK 内部展开为 XML skill block。缺点：每条消息只允许一个前缀命令，
  与"多 skill 同时挂载"的需求不符；且依赖 SDK 内部行为。
- **方案 B — 主进程直接注入** ✅：在 `knowclaw:send` handler 中读取 SKILL.md
  全文，拼装为 `<pinned_skills>` XML 块前置到用户消息。支持多 skill、与 SDK
  斜杠命令解耦，token 开销与方案 A 等价（模型本就需要 SKILL.md）。

#### SK5.2 实现摘要

**新建文件（1 个）**：

1. **`desktop/src/ui/components/knowclaw-v2/SkillSelector.jsx`**（~220 行）
   - Popover trigger：Puzzle 图标按钮（紫色）+ 数字徽标；位于 ChatInput
     ImagePlus 左侧（通过 `skillSelector` slot 注入）。
   - 弹窗：顶部搜索框 → skill 列表（按 source / name 排序，仅显示 `enabled`
     的 skill，避免"已选但不会运行"陷阱）→ 底部"导入技能..."入口。
   - 多选：checkbox 风格，点选高亮 + 紫色 chip 状态；外部点击关闭弹窗。

**修改文件（6 个）**：

2. **`desktop/src/ui/components/agent-chat/ChatInput.jsx`**（+~50 行）
   - 新增 props：`skillSelector?` slot、`pinnedSkills?: string[]`、`onSkillRemove?`。
   - textarea 上方渲染紫色圆角 chip 条（每个 chip 显示 skill name + X 移除按钮）。
   - `onSend` 签名扩展为 `(text, images, pinnedSkills)`。
   - `skillSelector` slot 渲染在 ImagePlus 左侧（与图片附件按钮并排）。

3. **`desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`**（+~50 行）
   - 新增 `pinnedSkills` state（页面级，不进 Persist hook —— 不应跨页面存活）。
   - 渲染 `<SkillSelector skills={skills} selected={pinnedSkills} ... />` 作为
     `skillSelector` slot。
   - `useEffect` 每次 `currentCwd` 变化时主动 `loadSkills` 以填充 Selector
     列表（SK1 原本只在 panel 打开时加载）。
   - `useEffect` 清理失效 pin（skill 被禁用或卸载后自动从选中列表移除）。
   - `handleSend` 传入 `pinnedSkills`，并立即清空 selection（防止后续 turn 隐式
     重复注入）。

4. **`desktop/src/ui/hooks/useKnowClawPersist.jsx`**（+~15 行）
   - `sendMessage(text, images, pinnedSkills)` 接受第三参；过滤空白名后透传到
     `window.ipm.knowclaw.send`。
   - 用户消息对象增加 `pinnedSkills: string[]` 字段，供气泡 UI 后续显示
     （目前 ChatInput 上方 chip 是真相源，气泡端预留字段）。
   - **不**向 `steer/followUp` 传 pin —— 活跃 session 的工具表已冻结，
     mid-turn 注入 SKILL.md 会让用户和模型双方都困惑。

5. **`desktop/src/preload.js`**（+~10 行）
   - `knowclaw.send(message, images, pinnedSkills)` 透传 `pinnedSkills` 到 IPC payload。

6. **`desktop/src/main/ipc/knowclaw.js`**（+~110 行）
   - 顶层新增 `resolvePinnedSkillContents(names, cwd)` 和 `formatPinnedSkillsBlock(items)`
     辅助函数。前者按 `builtin > workspace > user` 优先级在三个 root 下查找
     `<name>/SKILL.md`，每个 skill body 限制 20 KB 防止极端长度；后者拼装
     `<pinned_skills><skill name=".." source="..">...</skill></pinned_skills>`
     XML 块（与 pi SDK `/skill:name` 展开格式同构）。
   - `knowclaw:send` handler 在 `taggedMessage` 拼装前调用上述两函数，把 XML
     块前置到用户文本。`[MODE: plan]` 前缀仍保持第一行。
   - `mapPiMessagesForRenderer` 用户消息清洗增加 regex
     `/^<pinned_skills>[\s\S]*?<\/pinned_skills>\n+/`，避免历史会话重新打开时
     用户气泡里露出注入痕迹。

#### SK5.3 决策记录

| ID | 问题 | 选择 |
|----|------|------|
| D-SK5-1 | 注入实现层级 | **B. 主进程注入**（见 SK5.1）。✅ 支持多 skill、独立于 SDK 内部展开机制。 |
| D-SK5-2 | pinnedSkills 状态归属 | **页面级**（`KnowClawV2Page.useState`）。不进 `useKnowClawPersist`，避免选择跨页面/跨刷新存活——这是临时输入意图，与会话状态正交。 |
| D-SK5-3 | 发送后是否保留选中 | **不保留**。每次 `handleSend` 清空 pinned selection；防止用户连续追问时隐式重复消耗 SKILL.md token。如需复用直接重新点击 chip 即可。 |
| D-SK5-4 | 是否对 streaming 中的 steer/followUp 也注入 | **不注入**。活跃 session 工具表已冻结，mid-turn SKILL.md 注入语义混乱；并且与"一次性输入意图"语义一致。 |
| D-SK5-5 | 失效 skill（禁用 / 删除）如何处理 | **自动清理**。Page 上的 `useEffect([skills, pinnedSkills])` 在 skill 列表变化时丢弃已禁用的 pin；后端 `resolvePinnedSkillContents` 静默跳过磁盘缺失项（兜底）。 |
| D-SK5-6 | SKILL.md 单文件最大长度 | **20 KB**。常规 SKILL.md 在 2–8 KB 区间；20 KB 留出充足余量，超出则截断并附 `[... truncated ...]` 提示，避免单条消息把 context window 吃光。 |
| D-SK5-7 | 用户气泡是否显示注入痕迹 | **不显示**。`mapPiMessagesForRenderer` 在 rehydrate 历史会话时把 `<pinned_skills>...</pinned_skills>` 前缀剥除，与 `[MODE: plan]` 标签处理同模式。 |

#### SK5.4 验收标准

- [x] ChatInput 左侧出现 Puzzle 图标按钮；点击弹出搜索 + 多选面板
- [x] 选中后输入框上方显示紫色 chip，X 可移除单个
- [x] 发送消息后 chip 自动清空，下次仍可重新选择
- [x] 禁用 skill 后该 skill 不在 Selector 出现，已选中的会被自动取消
- [x] 主进程把 SKILL.md 内容以 `<pinned_skills>` XML 注入到 `[MODE: plan]\n`
      之后、用户文本之前；模型首次响应即按 skill 执行，无需先 Read SKILL.md
- [x] 重新打开历史会话时用户气泡看不到 `<pinned_skills>` 块（cleanText regex 生效）
- [x] streaming 中走 steer/followUp 路径不携带 pinned skill（向后兼容）

#### SK5.5 变更日志

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-27 | DONE | 实施完成：新建 `SkillSelector.jsx`；ChatInput 增加 `skillSelector` slot + chip 条 + `onSend` 第三参；KnowClawV2Page 页面级 `pinnedSkills` state + 主动 loadSkills + 失效清理；useKnowClawPersist `sendMessage` 第三参 + 用户消息 `pinnedSkills` 字段；preload `knowclaw.send` 透传；knowclaw.js 新增 `resolvePinnedSkillContents` / `formatPinnedSkillsBlock` 工具函数 + `knowclaw:send` 注入逻辑 + 历史会话清洗 regex。 |

---

## 6. 技术选型决策汇总

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Skill 管理 UI 位置 | KnowClaw Header 独立按钮 → 右侧面板 | 复用现有布局模式（与 FileTree 同级），避免 tab 过载 |
| 导入策略 | 复制到 userSkillsRoot | 跨盘安全、portable、不依赖外部程序、不需管理员权限 |
| Git 仓库导入 | 首期不做 | 需要 `git` 运行时依赖，保留 Phase 2 |
| Skill 编辑器 | 首期不做 | 通过 AI 对话 + `skill-builder` 元技能创建/编辑；或系统文件管理器编辑 |
| Markdown 渲染 | 复用 `marked` | 已在 BubbleView / FloatingChatList 中使用，无需新增依赖 |
| 禁用实现 | `skillsOverride` 回调过滤 | pi SDK 原生支持，侵入最小 |
| 热重载策略 | reload 不中断 session | 仅更新 loader 缓存，活跃 session 不受影响 |
| SK4 工作空间级 | 首期一并实施（DONE） | SK0~SK3 完成后 SK4 边际成本极低，且项目/案件级 skill 是合规类工作流的天然诉求 |
| SK4 优先级语义 | `builtin > workspace > user > imported` | UI 与运行时统一，project-overrides-global 符合直觉（类比 dotfiles） |
| SK5 注入实现 | 主进程注入 `<pinned_skills>` XML | 支持多 skill + 不依赖 SDK 内部斜杠命令展开；token 开销与"模型自行 Read SKILL.md"等价但省一次工具调用回合 |
| SK5 状态归属 | 页面级 useState（不进 Persist hook） | 输入意图是一次性的，不应跨页面/跨刷新存活；与会话状态正交 |

---

## 7. 风险登记表

| ID | 风险 | 触发阶段 | 概率 | 影响 | 缓解 |
|----|------|---------|------|------|------|
| RW-SK0-1 | `skillsOverride` 与 pi SDK 未来版本不兼容 | SK0 | 低 | 中 | 回调签名是 SDK 公开 API，有 d.ts 类型保障 |
| RW-SK0-2 | reload 与正在 streaming 的 session 竞态 | SK0/SK3 | 低 | 中 | reload 仅更新 loader 缓存，活跃 session 用创建时的 snapshot |
| RW-SK1-1 | 右侧面板与 FileTree 切换逻辑冲突 | SK1 | 低 | 中 | 改 `showFileTree` 为 `rightPanel: 'fileTree' \| 'skills' \| null` 统一管理 |
| RW-SK1-2 | SKILL.md 内容过长导致 Modal 渲染卡顿 | SK1 | 低 | 低 | `max-h-[70vh]` + `overflow-y-auto`；超长截断 |
| RW-SK2-1 | 外部 skill 包含恶意脚本 | SK2 | 低 | 高 | 导入预览显示安全提示 |
| RW-SK2-2 | Claude/Cursor 未安装，扫描路径不存在 | SK2 | 中 | 低 | 静默跳过 + UI "未检测到"提示 |
| RW-SK2-3 | 外部 skill 内含大文件 | SK2 | 低 | 中 | 复制前统计大小，超 50MB 警告 |
| RW-SK4-1 | 频繁切换工作空间导致 reload 过频 | SK4 | 中 | 低 | debounce reload；reload 本身是 O(N) 文件扫描，内置 skill 数量有限 |

---

## 8. 进度看板

| 阶段 / 条目 | Status | 完成日期 | 备注 |
|------------|--------|---------|------|
| SK0 — Skill 服务层 + IPC 基础设施 | `DONE` | 2026-05-26 | `src/main/ipc/skills.js`（7 IPC handler）+ `bootstrap.js`（skillsOverride）+ `knowclaw.js`（disabledSkills 传参）+ `preload.js`（skills 命名空间）+ `main.js`（注册） |
| SK1 — Skill 管理 UI | `DONE` | 2026-05-26 | `SkillManagerPanel.jsx` + `SkillDetailModal.jsx` + `useKnowClawPersist.jsx`（skills 状态/三个 actions）+ `KnowClawV2Page.jsx`（rightPanel 重构 + Skills 入口）+ `HeaderOverflowMenu.jsx`（compact 行） |
| SK2 — 外部 Skill 导入 | `DONE` | 2026-05-26 | `ImportSkillModal.jsx`（双 Tab + 三选一冲突 + 批量进度）+ `skills.js`（`chooseSkillDir` IPC + `importSkill.newName`）+ `preload.js`（chooseDir bridge）+ `useKnowClawPersist.jsx`（3 个新 actions）+ `KnowClawV2Page.jsx`（接通 Modal） |
| SK3 — 热重载 + 悬浮窗集成 | `DONE` | 2026-05-26 | 通过 SK0–SK2 架构决策合并实现，无新增代码：热重载因 D-SK0-3（不维护持久 ResourceLoader）排除，等价机制为 `createSession` 时每次读最新 `disabledSkills`；悬浮窗 `ensureSession()` 路径与主台共用自动生效；`reloadSkills` IPC 保留为纯查询 |
| SK4 — 工作空间级 Skill 支持 | `DONE` | 2026-05-26 | `.knowclaw/skills/` 自动加载；listSkills / deleteSkill / getContent 接受 cwd；面板增加工作空间分组 |
| SK5 — Skill Selector 输入器 | `DONE` | 2026-05-27 | ChatInput 旁 Puzzle 弹窗（搜索+多选）+ 紫色 chip 条；主进程读 SKILL.md 拼装 `<pinned_skills>` XML 注入；省去模型首轮的 Read SKILL.md 工具调用 |

---

## 9. 升级后终态画像

1. **Skill 一目了然**：KnowClaw 页面右侧面板展示所有已加载 skill，按内置/用户/导入/工作空间分组，每个 skill 可查看完整详情。
2. **导入零门槛**：一键导入 Claude Code / Cursor 的 skill，也支持任意本地目录导入。Agent Skills 标准格式的 SKILL.md 即插即用。
3. **精细控制**：每个 skill 可独立启用/禁用，禁用的 skill 不参与 system prompt 注入，不消耗上下文窗口。
4. **热更新**：增删/启用禁用 skill 后无需重启，下次新建会话即自动生效。
5. **AI 创建**：用户可通过对话让 AI 创建新 skill（已有 `skill-builder` 元技能），创建完成后面板自动刷新。
6. **工作空间绑定**（SK4）：项目/案件级 `.knowclaw/skills/` 目录，skill 跟随工作空间自动加载/卸载。
7. **生态兼容**：与 Claude Code / Cursor / pi SDK 的 Skill 格式完全互通，用户可以在多个 AI 工具间共享 skill 资产。

---

## 10. 术语表

- **Skill**：一个自包含的能力包，由目录中的 `SKILL.md` 定义。提供专业工作流、设置指令、辅助脚本和参考文档。
- **SKILL.md**：Skill 的入口文件，由 YAML frontmatter（`name` + `description`）和 Markdown 正文组成。
- **Agent Skills 标准**：https://agentskills.io/specification — 跨 AI 工具的 Skill 互操作规范。
- **内置 Skill**：预装在 `Agent/pi-runtime/skills/` 下的 skill（docx / xlsx / pptx / pdf / web-artifacts-builder / skill-builder）。
- **用户 Skill**：存放在 `KNOWCLAW_USER_SKILLS_ROOT`（`%APPDATA%/IPM/knowclaw-skills/`）下的 skill，由 AI 创建或用户手动放置。
- **导入 Skill**：从外部路径复制到 `KNOWCLAW_USER_SKILLS_ROOT` 的 skill，标记来源信息。
- **工作空间 Skill**：存放在 `<workspace>/.knowclaw/skills/` 下的 skill，仅在对应工作空间活跃时加载。
- **`skillsOverride`**：`DefaultResourceLoader` 的回调函数，用于在 skill 加载后进行过滤/修改/注入。
- **热重载**：不重启应用、不中断当前会话的情况下更新 skill 列表，下次新建会话自动生效。

---

## 附录 · 变更记录（文档级）

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-26 | 创建 | 文档初版。现状评估 + 目标定义 + 架构设计 + SK0–SK4 五个阶段详细计划 + 技术选型 + 风险登记 |
| 2026-05-26 | SK0 完成 | Phase SK0 全部实施完毕。关键决策：不维护持久 ResourceLoader（改用 SDK `loadSkillsFromDir` 直接扫描）；状态存 `state.knowclaw.skills`（非 prefs）；ResourceLoader `skillsOverride` 回调仅在 `disabledSkills` 非空时挂载。新建 1 文件（skills.js IPC）、修改 4 文件（bootstrap/knowclaw/preload/main） |
| 2026-05-26 | SK1 完成 | Phase SK1 全部实施完毕。关键决策：右侧面板状态由 boolean 重构为 `rightPanel: 'fileTree' \| 'skills' \| null` 三态（互斥）；开关样式复用 `SubAgentToggle` pill button 风格；面板每次打开自动刷新；toggle/delete 仅追加 system 气泡（与 `toggleSubAgent` 同模式，不中断当前 session）；旧 `knowclaw.v2.showFileTree` localStorage key 无感迁移。新建 2 文件（SkillManagerPanel / SkillDetailModal）、修改 3 文件（useKnowClawPersist / KnowClawV2Page / HeaderOverflowMenu）；useKnowClawV2Chat facade 通过 `...ctx` 自动透传 |
| 2026-05-26 | SK2 完成 | Phase SK2 全部实施完毕。关键决策：Modal 全屏弹窗双 Tab（本地目录 / 外部工具）；三选一重名冲突（覆盖 / 改名 / 取消），改名通过主进程正则重写 SKILL.md 的 `name:` 行实现（不引入 YAML 库）；新增专用 `knowclaw:chooseSkillDir` IPC 兼负目录选择+预览解析；外部工具 Tab 顶部 amber 安全提示横幅；批量导入串行 + 进度条 + 失败列表 + 自动 refresh。新建 1 文件（ImportSkillModal）、修改 4 文件（skills.js / preload.js / useKnowClawPersist / KnowClawV2Page）；Git 仓库导入按计划保留 P2 |
| 2026-05-26 | SK3 完成 | Phase SK3 经评估**无需新增代码**，标记为 DONE。原计划两条主线已在 SK0–SK2 中通过架构决策合并实现：① "热重载"因 SK0 决策 D-SK0-3（不维护持久 ResourceLoader 实例）物理上不可能且无必要，等价机制为每次 `createSession` 读取最新 `state.knowclaw.skills.disabled` 注入 `skillsOverride` + 用 system 气泡通知用户"下次新对话生效"；② "悬浮窗集成"因悬浮窗 `ensureSession()` 路径与主台完全共用、共享同一份 `state.knowclaw.skills` 持久化状态，自动反映最新 skill 启用/禁用状态，无需事件广播或共享 loader；③ `knowclaw:reloadSkills` IPC 保留为纯磁盘扫描查询，供面板"刷新"按钮使用。仅更新 SKILL_SYSTEM_PLAN.md 文档对账，无源代码变更 |
| 2026-05-26 | SK4 完成 | Phase SK4 全部实施完毕。关键决策：① 工作空间 skill 路径约定为 `<cwd>/.knowclaw/skills/`；② IPC 三件套（`listSkills` / `getSkillContent` / `deleteSkill`）接受可选 `cwd`，删除 IPC 额外支持 `scope`（'workspace' \| 'user'）；③ 列表与运行时统一采用 `builtin > workspace > user > imported` 优先级（workspace 覆盖全局，类比 dotfiles）；④ `bootstrap.js` 在 cwd 非空且目录存在时把 workspace 路径插入 `additionalSkillPaths` 第二位；⑤ 面板新增 amber 主题 workspace 分组，empty 时整组隐藏（与其他组的"显示空态文案"差异化处理）；⑥ workspace skill 允许 UI 删除，删除不触碰 `importedSources` 索引。修改 7 文件（skills.js / bootstrap.js / preload.js / useKnowClawPersist / KnowClawV2Page / SkillManagerPanel / SkillDetailModal），无新增文件。**Skill 系统主线（SK0~SK4）至此全部 DONE** |
| 2026-05-27 | BUG 修复 | **ERR_PACKAGE_PATH_NOT_EXPORTED 启动崩溃修复**。`skills.js` 顶部的静态 `import { loadSkillsFromDir, parseFrontmatter } from '@earendil-works/pi-coding-agent'` 被 Vite 转译为 CJS `require()`，但该包的 `package.json` `exports` 字段只声明了 `"import"` 条件（ESM-only），无 `"require"` / `"default"` 条件，Node CJS 解析器抛出 `ERR_PACKAGE_PATH_NOT_EXPORTED` 导致 Electron 应用无法启动。根因是 Vite 主进程构建输出 CJS 格式、同时将 `@earendil-works/pi-coding-agent` 配置为 `external`（不打包），两者叠加使得运行时以 CJS 语义解析 ESM-only 包。修复方式：移除静态 import，改为 lazy dynamic `import()` 获取 SDK 函数（通过 `getPiSdk()` 单例缓存），与 `knowclaw.js` 加载 `pi-runtime/index.js` 的做法一致。`scanSkillDir` 同步函数改为 `async`，所有 4 个调用点（`scanSkillDir` / `getSkillContent` / `importSkill` / `chooseSkillDir`）和 3 处 `scanSkillDir` 调用方（`listSkills` / `reloadSkills` / `scanExternalSkills`）已加上 `await`。仅修改 `skills.js` 一个文件 |
| 2026-05-27 | SK5 完成 | **Skill Selector 输入器**。在 ChatInput 输入框旁新增 Puzzle 弹窗（搜索 + 多选 + 紫色 chip 条），用户选中一个或多个 skill 后，发送时由主进程直接读取对应 SKILL.md 并以 `<pinned_skills>` XML 块前置到用户消息，模型首次响应即按 skill 执行（省去"先 Read SKILL.md"的工具调用回合，每个挂载的 skill 节省一次模型 round-trip）。新建 1 文件（`SkillSelector.jsx`）、修改 6 文件（`ChatInput.jsx` / `KnowClawV2Page.jsx` / `useKnowClawPersist.jsx` / `preload.js` / `main/ipc/knowclaw.js` / `SKILL_SYSTEM_PLAN.md`）。关键决策：① 注入在主进程（独立于 SDK 斜杠命令机制，支持多 skill）；② pinnedSkills 状态归属页面级（不跨页面存活）；③ 发送后立即清空 selection（防止隐式重复注入）；④ 不向 steer/followUp 注入（活跃 session 工具表已冻结）；⑤ 单 SKILL.md 截断在 20KB 防爆 context；⑥ 历史会话 rehydrate 时清洗 `<pinned_skills>` 块（与 `[MODE: plan]` 处理同模式） |

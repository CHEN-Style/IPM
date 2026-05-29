# 悬浮窗 KnowClaw 助手 · Floating KnowClaw Plan

> 本文档是 [`IPM_FEATURE_UPGRADE_PLAN.md`](./IPM_FEATURE_UPGRADE_PLAN.md)
> 中 **Phase K3 — 悬浮窗 KnowClaw 助手** 的详细子计划，从主计划中独立
> 出来以便分期推进与回看。
>
> **目标**：把现有悬浮窗从"剪贴板 + 截图捕获"的单一工具，升级为"随时
> 唤起的桌面 AI 助手 + 智能截屏助手"。悬浮窗拥有固定工作空间
> `userfile/workspaces/_floating/`，对话和产物沉淀在该空间内，必要时
> 一键回到中台 KnowClaw 继续处理或迁移到任意项目/案件。
>
> **前置**：F1 / F2 / F3 / K1 / K2 已 `DONE`；KnowClaw Backlog-D.1~D.5
> 已 `DONE`；KnowClaw 引擎 U0~U8 已 `DONE`。
>
> **UI/UX 参考**：[`k3-floating-knowclaw-demo.html`](./k3-floating-knowclaw-demo.html)
> 是经过多轮迭代确认的可交互静态演示，浏览器打开即用，定义了所有可见
> UI 元素的形态、布局、配色和交互。**实现阶段以该 demo 为视觉真源**。

---

## 0. 阅读与维护说明

- **状态枚举**：`PLANNED`（已立项待启动）/ `RESEARCH`（待技术调研）
  / `IN_PROGRESS` / `DONE` / `DEFERRED`。
- **阶段编号**：`FK0` ~ `FKn`（Floating KnowClaw 缩写），与主计划的
  `F*` / `K*` 编号不冲突。
- **更新规则**：
  - 每完成一次决策（如选择候选方案 A/B），把答案落到对应阶段的"决策记录"。
  - 每完成一次代码改动，把摘要写到对应阶段的"变更日志"。
  - 不直接删除"候选方案"段落，已被否决的方案改为 `~~删除线~~` + 否决理由。
- **与主计划/其他计划的边界**：
  - KnowClaw 引擎本体（pi runtime / prompt / 工具集 / 会话管理）→
    [`KNOWCLAW_UPGRADE_PLAN.md`](./KNOWCLAW_UPGRADE_PLAN.md)
  - 应用整体新功能 / 文件 / 知识 / 跨模块联动 →
    [`IPM_FEATURE_UPGRADE_PLAN.md`](./IPM_FEATURE_UPGRADE_PLAN.md)
  - **悬浮窗 KnowClaw 专属（双通道、外部气泡、截屏快捷流程、_floating
    workspace、UI 形态等）→ 本文档**

---

## 1. 当前差距与已具备能力

### 1.1 现状锚点

| 模块 | 路径 | 现状 |
|------|------|------|
| 悬浮窗外壳 | `src/main.js` (createFloatingWindow) | 420×560 frameless transparent；`alwaysOnTop:'screen-saver'`；G1.0~G1.2 切换体验已顺畅 |
| 悬浮窗 UI | `src/ui/components/floating/FloatingMode.jsx` + `TrayWidget.jsx` | 仅文件拖拽分类 + 剪贴板/截图被动捕获，无任何 AI 入口 |
| 主台 KnowClaw | `src/ui/components/knowclaw-v2/KnowClawV2Page.jsx` | 完整对话 UI + 工作空间切换 + 文件树 + sub-agent |
| KnowClaw 引擎 | `Agent/pi-runtime/` | pi 0.74 + customTools + sessions + dual-mode（Plan/Agent）|
| 工作空间机制 | `src/main/ipc/knowclaw.js` (`setCwd` / `listWorkspaces`) | 5 源聚合 + `encodeCwd` 隔离 + 切换销毁会话 |
| OCR | `Agent/services/ocrService.js` | PP-OCRv5 mobile + WASM；接受 path / Buffer / ArrayBuffer |
| 图片→AI 多模态 | `src/ui/components/agent-chat/imageResize.js` + `knowclaw.js` `sanitizeImagesPayload` | Canvas 压缩 + Base64 + MIME/大小白名单 |
| Vision 模型识别 | `Agent/pi-runtime/models.js` `inferModelInputs` | 自动检测 vision 能力 |
| 剪贴板截屏 | `src/main.js` 1.2s 轮询 | 仅被动监听 `clipboard.readImage()`，**无主动截屏 API** |
| Backlog-D | — | D.1~D.5 全部 `DONE`，K3 前置依赖已清除 |

### 1.2 用户痛点 / 期望（合并 2026-05-21 + 2026-05-24）

| # | 痛点 / 期望 | 一句话 |
|---|------------|--------|
| W1 | 悬浮窗功能单薄 | 当前只有一个"拖文件给 classifier"，作为常驻桌面控件价值偏低 |
| W2 | 中台 AI 不够轻 | 想要 AI 时必须切回中台，破坏工作流 |
| W3 | 浏览网页信息密度高 | 想"一键让 AI 帮我看一眼"而不是自己读 |
| W4 | 截屏 + OCR + AI 三件套割裂 | 现在要分别打开 QQ 截图 / OCR 工具 / 主台 AI，路径太长 |
| W5 | 悬浮窗空间小 | 完整聊天 UI 撑不开，但又需要看到 AI 回复 |
| W6 | 产物归属混乱 | 临时 AI 产物不知道该放在哪个项目 |

### 1.3 设计原则

1. **极短路径**：从唤起到拿到答案 ≤ 3 步（快捷键 → 自动截屏 → 看到回复气泡）。
2. **不打断工作流**：悬浮窗 alwaysOnTop + 透明背景，AI 回复以外部大气泡呈现，
   视线不离开当前应用。
3. **信息收敛**：悬浮窗 KnowClaw 默认是"输入控制器"，不是完整聊天页；
   工具调用 / 思考 / 子代理等细节折叠或隐藏。
4. **可生长**：从 compact 输入态 → 外部气泡 → 内部完整对话视图，按需展开。
5. **可逃逸**：一键"回到空间"，将悬浮窗会话/产物带回中台 KnowClaw 继续深度处理。

---

## 2. 架构总览

### 2.1 模式与窗口形态

悬浮窗将存在 **两种主模式**，由左侧 rail 切换：

```
┌─ Floating Window ──────────────────────┐
│ rail │  mode panel                     │
│  ←   │                                  │
│ ───  │                                  │
│  📁  │  ① Vault 模式（现状）            │
│  📂  │     - KNOW VAULT 文件拖拽分类    │
│  🎓  │     - 剪贴板 / 截图捕获          │
│      │     - 项目/案件/学习三域切换     │
│      │                                  │
│  ✦   │  ② KnowClaw 模式（K3 新增）     │
│      │     - 缩略输入控制器（默认）     │
│      │     - 外部大气泡回复             │
│      │     - 展开 → 内部完整对话视图    │
└─────────────────────────────────────────┘
```

`✦` 按钮位于 rail 底部（与三域按钮区隔），点击切换；和现有"案件 / 项目 /
学习"按钮互斥。

### 2.2 KnowClaw 模式的三态

```
缩略输入态（默认）   →   外部大气泡态        →   内部展开对话态
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ Header       │         │ Header       │         │ Header       │
├──────────────┤  ◀────  ├──────────────┤  ────▶  ├──────────────┤
│              │  收起   │              │  展开   │ Messages     │
│   Input      │         │   Input      │         │              │
│  ┌────────┐  │  发送   │  ┌────────┐  │         ├──────────────┤
│  │ ✎      │  │  ───▶   │  │ ✎      │  │         │   Input      │
│  └────────┘  │         │  └────────┘  │         └──────────────┘
│ [📷][📋][+]  │         │ [📷][📋][+]  │
└──────────────┘         └──────────────┘
                              ▲
                              │ 大气泡贴在悬浮窗外侧
                          ╭───┴────────────────╮
                          │ 🟢 KnowClaw 回复    │
                          │ 这页主要讨论…       │
                          │ [展开到悬浮窗内]    │
                          │ [收起]              │
                          ╰─────────────────────╯
```

外部大气泡的关键特性：
- 视觉上像悬浮窗本体在"说话"，而不是又一个独立窗口
- 位置自适应悬浮窗在屏幕上的位置（右上角 → 向左展开向下延伸；左下角 →
  向右展开向上延伸；空间不足时自动限制宽高 + 滚动）
- 与悬浮窗本体之间有指向连接（小三角），保持视觉关联

### 2.3 双通道 Agent 会话

```
src/main/ipc/knowclaw.js
┌────────────────────────────────────────────────┐
│ channels = {                                   │
│   main: {                                      │
│     cwd: null | path,           ← 用户选       │
│     session: AgentSession,                     │
│     thinkingLevel, modelId, ...                │
│   },                                           │
│   floating: {                                  │
│     cwd: FLOATING_WORKSPACE_PATH (固定),       │
│     session: AgentSession,                     │
│     thinkingLevel, modelId, ...                │
│   },                                           │
│ }                                              │
└────────────────────────────────────────────────┘
```

所有 `knowclaw:*` IPC 增加 `channel: 'main' | 'floating'` 参数（默认
`'main'` 以保持向后兼容）。两通道完全独立：cwd、session、thinking、
events 都不互相干扰。

**跨通道可见性**：悬浮窗 workspace `_floating/` 自动出现在主台
`listWorkspaces` 中，标记为"⚡悬浮助手"。用户可以在中台 KnowClaw 切
换到该 workspace、浏览历史会话和产物文件。

### 2.4 固定工作空间

```
userfile/workspaces/_floating/
├── captures/              ← 截屏总结流程沉淀的原图 + OCR raw
│   └── 20260524-231055.png
│   └── 20260524-231055.ocr.txt
├── notes/                 ← 用户在悬浮窗内手动保存的笔记
└── (AI 产生的其他文件...)
```

- 首次启动自动 `mkdirSync({ recursive: true })` 创建
- 不按会话创建子目录（session JSONL 天然隔离历史）
- `floatingChannel.cwd` 硬编码指向此目录，悬浮窗内不允许切换

---

## 3. 关键设计决策

### D-FK-1：通道隔离 vs 共享

**决策：独立两套 channel（main / floating）。**

- 主窗口和悬浮窗是两个独立 BrowserWindow，强制共享会导致 cwd/session 冲突
- 用户可能在主台进行长对话，同时在悬浮窗发起快问快答，两者不应相互覆盖
- 通过共用的 workspace 目录 + listSessions 实现"想接力时也接得上"

### D-FK-2：工作空间策略

**决策：固定单一目录 `userfile/workspaces/_floating/`。**

候选方案：

- ❌ ~~每次启动新建 `_floating/<时间戳>/`~~ — 会导致 workspace 无限膨胀，且
  历史 session 无法在主台被发现
- ❌ ~~允许用户在悬浮窗内自由切换 workspace~~ — 与"轻量入口"理念冲突
- ✅ **永久单一目录** — 历史按 session JSONL 自然分割；用户想换上下文时
  通过"回到空间"按钮跳到中台切换

### D-FK-3：UI 形态（已通过 demo 落地）

**决策：缩略输入态为默认，外部大气泡为标准回复展示，内部完整对话为可选展开。**

参见 [`k3-floating-knowclaw-demo.html`](./k3-floating-knowclaw-demo.html)
和本文档 §2.2。这是 2026-05-24 ~ 25 多轮迭代后确认的形态，**不再变更**。

被否决的早期方案：

- ❌ ~~把悬浮窗做成迷你聊天页（内嵌完整消息列表）~~ — 360×560 容不下，
  且视觉上和 Vault 模式割裂
- ❌ ~~深色 chat-app 风格~~ — 与现有 KNOW VAULT 浅色风格冲突
- ❌ ~~AI 回复也塞进悬浮窗内部的小列表~~ — 信息过载

### D-FK-4：模型与 thinking 选择

**决策：沿用用户在主台配置的默认模型 + thinking level；悬浮窗 Header 内
"⚙ 设置"菜单可临时切换。**

Quick Actions（截屏总结等自动流程）在发起前自动检测当前模型 vision 能力，
若不支持则降级为"仅 OCR + 文本总结"路径并 toast 提示。

### D-FK-5：成本控制

**决策：不设独立限额；与主台共享 token 池。**

不在 KnowClaw 模式 Header 上常驻 token 计数（与 demo 已删掉的工作空间说明一
致，避免增加信息密度）；用户如需查看，去主台 KnowClaw 的会话统计页。
Quick Actions 触发的自动流程在发送前用 toast 提示一次"将发送 1 张截图给
AI"（不弹模态）。

### D-FK-6：截屏方案

**决策：`desktopCapturer.getSources({ types: ['screen'], thumbnailSize: 屏幕物理分辨率 })`
为首选；macOS 自动检测屏幕录制权限并引导授权。**

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| `desktopCapturer` + `thumbnailSize: { width: pxW, height: pxH }` | 跨平台、纯 Electron、可多屏 | macOS 需用户授权一次 | ✅ |
| `screen.getPrimaryDisplay()` + `BrowserWindow.capturePage()` | 简单 | 只能截自己窗口，无法截桌面 | ❌ |
| `PowerShell` / `screencapture` 子进程 | 全屏原始分辨率 | 平台特定、需要打包额外二进制 | 备选 |
| ~~让用户先 Win+Shift+S 截图~~ | 零成本 | 多一步、破坏极短路径原则 | ❌ |

实现要点：
- 截图前 `floatingWindow.hide()` 避免自身入镜，约 100ms 后调用 capturer
- 截完立即 `floatingWindow.show()` 并把缩略图渲染到外部气泡上方的预览卡片
- macOS 权限失败时引导 `systemPreferences.askForMediaAccess` 或跳转系统设置

### D-FK-7：外部大气泡定位算法

**决策：根据悬浮窗在屏幕上的位置，从 4 个象限里挑剩余空间最大的方向展开，
方向以 `bottom-left` / `bottom-right` / `top-left` / `top-right` 表达。**

伪代码：

```js
function pickBubblePlacement(floatingRect, screenRect, bubbleSize) {
  const spaceLeft   = floatingRect.x;
  const spaceRight  = screenRect.width  - (floatingRect.x + floatingRect.width);
  const spaceTop    = floatingRect.y;
  const spaceBottom = screenRect.height - (floatingRect.y + floatingRect.height);
  const horizontal = spaceLeft >= spaceRight ? 'left' : 'right';
  const vertical   = spaceBottom >= spaceTop ? 'bottom' : 'top';
  return { horizontal, vertical };
}
```

气泡宽度上限 `min(420px, 屏幕方向剩余空间 - 24px)`，最大高度
`min(480px, 屏幕方向剩余空间 - 32px)`，超出则内部滚动。

### D-FK-8："回到空间"按钮语义

**决策：点击后关闭悬浮窗（不销毁，仍 hide）→ 显示主窗口 → 跳转到 KnowClaw
v2 页面 → 自动 `setCwd(FLOATING_WORKSPACE_PATH)` → 自动 `openSession` 或
`continueRecent` 悬浮窗的最近 session。**

这是 demo 中 Header 上 `回到空间` 按钮的实际行为：用户可以无缝把悬浮窗里
的对话"放大到中台"继续深度处理，再 Steer / Plan / 子代理。

---

## 4. 阶段总览

| # | 阶段 | 主要交付物 | 预估代码量 | 解决差距 |
|---|------|----------|-----------|---------|
| FK0 | 双通道基础设施 | `channels` 重构 + IPC 加 channel 参数 + `_floating/` 自动创建 | ~365 行 | 通道隔离 |
| FK1 | Rail 入口 + KnowClaw 模式骨架（缩略态） | rail AI 按钮 + ModePanel 切换 + Header + Input + Quick Action 占位 | ~690 行 | UI 入口 |
| FK3 | 内部展开对话视图 + 会话生命周期 | 内嵌消息列表 + 历史 slide-over + 新对话 + 设置菜单（**先于 FK2 执行**） | ~610 行 | 完整对话能力 |
| FK2 | 外部大气泡 + 自适应定位 | `BubbleView.jsx` + `createBubbleWindow` + 屏幕位置计算 + 流式渲染 + 生命周期协调 | ~455 行 | W5 / W3 |
| FK4 | 智能截屏总结流程 | `desktopCapturer` + 预览卡片 + 双管道（vision + OCR） + 沉淀到 captures/ | ~500 行 | W3 / W4 |
| FK5 | OCR 快捷提取 | Quick Action 触发 + 区域截图（可选 P2） + 追问 AI 注入 | ~250 行 | W4 |
| FK6 | "回到空间" + 文件拖入增强 + 主台可见性 | 跨窗口跳转 + listWorkspaces 标记 + 拖入双选项 | ~300 行 | W6 / 迁移闭环 |
| FK7 | UX 打磨与收尾 | 动效 / 错误态 / 权限引导 / 文档 / E2E 冒烟 | ~250 行 | 体验 |

**总计**：约 2500 行；累计 10–14 天。

---

## 5. 各阶段详细计划

---

### Phase FK0 — 双通道基础设施

**Status:** `DONE`（2026-05-25）

**目标**：让悬浮窗的 KnowClaw 调用走独立 channel，不污染主台 session 和 cwd。

**前置**：无（可以独立启动）。

**为什么是第一步**：所有后续 UI 工作都依赖"悬浮窗发出去的消息走 floating
channel"。先把这个底座做好，UI 工作就只是接线。

**工作清单**

读：
- `src/main/ipc/knowclaw.js`（当前 `currentCwd / currentSession /
  currentThinkingLevel` 等 in-memory 状态变量）
- `Agent/pi-runtime/sessionFactory.js`（cwd→sessionDir 编码规则）
- `src/preload.js`（`window.ipm.knowclaw.*` 暴露面）

写/改：
1. **`knowclaw.js`** — 重构状态为：
   ```js
   const FLOATING_WORKSPACE_PATH = path.join(getUserFileRoot(), 'workspaces/_floating');
   const channels = {
     main:     createChannelState({ cwd: null }),
     floating: createChannelState({ cwd: FLOATING_WORKSPACE_PATH, locked: true }),
   };
   ```
   `createChannelState` 封装 `{ cwd, session, thinkingLevel, modelId, ... }`。
2. **`knowclaw.js`** — 启动时 `fs.mkdirSync(FLOATING_WORKSPACE_PATH, { recursive: true })`。
3. **`knowclaw.js`** — 所有 `ipcMain.handle('knowclaw:*')` 增加：
   ```js
   const ch = channels[payload?.channel === 'floating' ? 'floating' : 'main'];
   ```
   读写都走 `ch.*`，**默认 `'main'` 以保持现有调用不破坏**。
4. **`knowclaw.js`** — `setCwd` 在 floating channel 上拒绝（返回当前固定 cwd）。
5. **`knowclaw.js`** — 事件转发 `floatingWindow.webContents.send` 仅对 floating
   channel 事件；主窗口同理。
6. **`preload.js`** — 在 `window.ipm.knowclaw.*` 下增加可选 `channel` 参数；
   悬浮窗 UI 后续通过 `window.ipm.knowclawFloating = { send, newSession, ... }`
   绑定 channel 默认值，渲染端写起来更轻。

**不做**：
- 不做主台 UI 暴露 channel 切换（用户感知不到 channel 概念）
- 不做截屏 / 大气泡 / 工作空间标记（在 FK2/FK4/FK6 做）

**验收**：
- 重启应用后 `userfile/workspaces/_floating/` 目录自动创建
- DevTools 在主窗口跑 `await window.ipm.knowclaw.send({ text: 'hi' })`
  和在悬浮窗跑 `await window.ipm.knowclaw.send({ channel: 'floating', text: 'hi' })`
  各自创建独立 session（在 `~/.knowclaw-sessions/--...--/` 下能看到两个不同
  编码目录的 JSONL）
- 主台 KnowClaw 现有所有功能行为不变

**实际实现要点**

- **7 个 in-memory 状态合并到 `channels = { main, floating }`**：通过
  `createChannelState(overrides)` 工厂初始化；`main` 全空、`floating` 预置
  `cwd = FLOATING_WORKSPACE_PATH` + `cwdLocked: true`。删除了原闭包内 7 个
  散落 `let` 变量（`activeSession / activeUnsub / activeSender /
  promptInFlight / currentThinkingLevel / currentPlanMode / currentCwd`）。
- **`getChannel(payload)` 单点路由**：`payload?.channel === 'floating' ?
  channels.floating : channels.main`。所有不带 `channel` 字段的旧 payload
  自动落到 `main`，包括布尔字面量 payload（`setPlanMode(true)`）—
  `payload?.channel` 在非对象上为 `undefined`，安全 fallback。
- **`ensureSession / disposeChannelSession / getEffectiveCwd /
  shouldDisableContextFiles` 改为接受 `ch` 参数**：所有读写都走 `ch.*`。
  `pushEvent(sender, sessionId, event)` 签名保持不变，调用方从 `ch.sender`
  取目标 WebContents 即可（实现一句"事件按通道隔离"的 SDK 友好特性）。
- **`askUserViaRenderer` / `knowclawBeforeToolCall` 改为工厂模式**：
  `makeAskUserViaRenderer(ch)` / `makeKnowclawBeforeToolCall(ch)` 各返回
  bound closure，pi runtime 在 createSession 时捕获——每个 channel 的
  ask_user 提问和 install 拦截只送到自己 sender。
- **`_floating/` 自动创建**：`registerKnowClawIpc` 头部，紧跟 `channels`
  初始化后 `fs.mkdirSync(FLOATING_WORKSPACE_PATH, { recursive: true })`；
  失败仅 `console.warn` 不中断启动。
- **34 个 IPC handler 改造（A/B/C 三类）**：
  - **A 类（17 个，直接读写 session 状态）**：`send / abort / steer /
    followUp / clearQueue / compact / newSession / continueRecent /
    setThinkingLevel / setCwd / getCwd / getStatus / rehydrate /
    openSession / deleteSession / forkSession / setPlanMode / getPlanMode`
    — 每个 handler 入口 `const ch = getChannel(payload);`，所有 `active*`
    / `current*` 引用替换为 `ch.*`。`setCwd` 在 `ch.cwdLocked === true` 时
    直接返回拒绝；`openSession` / `forkSession` 在 `ch.cwdLocked` 时跳过
    cwd 恢复逻辑。
  - **B 类（5 个，读 cwd 不写 session）**：`listWorkspaces / listSessions
    / listWorkspaceTree / createWorkspace / uploadToWorkspace` — 仅加
    `const ch = getChannel(payload);` + `ch.cwd` / `getEffectiveCwd(ch)`。
  - **C 类（12 个，无 channel 状态）**：`listModels / setModel /
    pinWorkspace / hideWorkspace / chooseDirectory / openInExplorer
    （仅默认 cwd 回退用 ch）/ confirm-install-reply / getSubAgentEnabled /
    setSubAgentEnabled / rescanBash / askUserReply` — 完全不动。
- **`preload.js` 新增 `window.ipm.knowclawFloating` 命名空间**：18 个常用
  IPC 方法 + 3 个事件订阅（`onEvent` / `onConfirmInstall` / `onAskUser`），
  每个 invoke 调用预绑定 `channel: 'floating'`。**原有 `window.ipm.knowclaw.*`
  的 32 个方法签名一行未改**，因此主台所有调用走默认 `main` channel，
  100% 向后兼容（实现策略 C：底层 IPC payload 接受 `channel` 字段、上层
  通过两个命名空间体现，便于后续 macOS adapter 仿照增加 `knowclawMac`）。

**变更日志**

| 日期 | 变更 |
|------|------|
| 2026-05-25 | FK0-1 / FK0-4 完成：`knowclaw.js` 新增 `channels` 对象 + `createChannelState` + `getChannel` + `FLOATING_WORKSPACE_PATH` 自动创建；删除 7 个旧全局变量。 |
| 2026-05-25 | FK0-2 完成：`getEffectiveCwd` / `shouldDisableContextFiles` / `disposeChannelSession` / `ensureSession` 改签收 `ch`；`askUserViaRenderer` / `knowclawBeforeToolCall` 改为 `makeXxx(ch)` 工厂。 |
| 2026-05-25 | FK0-3 完成：22 个 A/B 类 handler 全量接入 `getChannel(payload)` 路由；12 个 C 类 handler 维持不变。`setCwd` 加入 `cwdLocked` 拒绝路径；`openSession` / `forkSession` 跳过 cwd 恢复。 |
| 2026-05-25 | FK0-5 完成：`preload.js` 新增 `knowclawFloating` 命名空间（18 IPC + 3 监听），全部预绑定 `channel: 'floating'`。 |
| 2026-05-25 | FK0-6 完成：静态分析确认主台 41 处 `window.ipm.knowclaw.*` 调用无 `channel` 字段，全部命中 `getChannel` 的 `main` 回退路径，行为等价于重构前。 |
| 2026-05-25 | 实际改动量：`knowclaw.js` ~280 行（含注释/工厂展开，比预估 200 略高）；`preload.js` ~85 行新增；总计 ~365 行。lint 0 错误。 |

---

### Phase FK1 — Rail 入口 + KnowClaw 模式骨架（缩略态）

**Status:** `DONE`（2026-05-25）

**目标**：左侧 rail 增加 AI 切换按钮，进入 KnowClaw 模式后渲染 demo 中的
缩略输入态（Header + 输入框 + 3 个小型 icon 快捷按钮 + 发送按钮）。

**前置**：FK0 完成。

**工作清单**

读：
- `src/ui/components/floating/FloatingMode.jsx`（rail 当前结构、domain 切换）
- `desktop/Agent/k3-floating-knowclaw-demo.html`（CSS 选择器、布局、颜色、间距）

写/改：
1. **`FloatingMode.jsx`** — 增加 `mode: 'vault' | 'knowclaw'` 状态；rail 底部新增
   AI 按钮，与三域按钮互斥；点击 AI 时主体渲染区切换到 `<KnowClawFloating />`。
2. **新组件 `src/ui/components/floating-knowclaw/KnowClawFloating.jsx`** —
   面板外壳；切到该模式时立即创建 floating channel 的新 session（自动 reuse
   最近 session 或创建空白；与主台 Backlog-D.2 行为一致）。
3. **新组件 `floating-knowclaw/FloatingHeader.jsx`** — 含：
   - 标题 `KnowClaw` + `回到空间` 按钮（FK6 接行为，FK1 先 stub toast）
   - Header 右侧 3 个 icon 按钮：`新对话`（编辑笔 icon）/ `展开 / 收起`
     文本按钮 / `⚙ 设置`
4. **新组件 `floating-knowclaw/FloatingInput.jsx`** — textarea 占满主面板；
   右下角发送按钮、左下角 3 个 icon 快捷按钮；自定义滚动条（demo 已确认样式）
5. **新 hook `useFloatingKnowClaw.js`** — 封装：
   - 监听 floating channel 事件（onEvent 过滤 channel）
   - send / newSession / steer
   - 消息状态（messages, streamingText, toolCalls, isStreaming）

**不做**：
- 不做外部大气泡（FK2）
- 不做内部完整对话视图（FK3）
- 不做截屏 / OCR 真实实现（FK4 / FK5）
- 不做"回到空间"真实跳转（FK6）

**验收**：
- rail 上 AI 按钮可见，激活态视觉与 demo 一致
- 点击切换 KnowClaw 模式，看到 demo 的缩略输入态
- 输入文字 + 回车不会崩溃（FK2 之前可能没回复 UI，只在 console 打印事件）
- 三个快捷按钮 hover 有 tooltip
- 切回 Vault 模式后现有功能完整可用

**实际实现要点**

- **新目录**：`src/ui/components/floating-knowclaw/`（与 `floating/` 并列），
  共 4 个新文件。
- **`FloatingMode.jsx` 改动**（共 ~50 行）：
  - 新增 `mode: 'vault' | 'knowclaw'` 状态（默认 `'vault'`，保留原始默认行为）。
  - 顶部 import 增加 `Sparkles` 图标和 `KnowClawFloating` 组件。
  - Rail 底部用 `<div className="flex-1" />` 撑开后追加 violet 配色的
    `Sparkles` 按钮；点击 toggles `mode`。
  - Domain switcher 三个按钮的 active 高亮条件变为
    `mode === 'vault' && activeDomain === 'xxx'` — KnowClaw 模式时按钮变灰
    但保留用户上次选择；在 KnowClaw 模式下点击任一 domain 按钮会一步切回
    Vault 并切换 domain。
  - 主体渲染区改为条件渲染：`mode === 'knowclaw' ? <KnowClawFloating />
    : <TrayWidget ... />`。
  - ResizeObserver 依赖数组追加 `mode`，模式切换时主进程 BrowserWindow
    自动同步尺寸。
  - Esc 升档由三档变四档：菜单 → 子面板 → KnowClaw 回 Vault → 回中台。
- **`KnowClawFloating.jsx`**（~90 行）：面板外壳，宽度 360px、紧凑态
  minHeight 310px / 展开态 430px；组合 `FloatingHeader` + `FloatingInput`；
  内嵌一行 rose 错误 chip（`chat.error` 非空时渲染）。FK1 仅提供
  `expanded` toggle，**内部 chat list 留给 FK3 实现**。
- **`FloatingHeader.jsx`**（~115 行）：40px 高、白渐变背景；左侧文字标题
  `KnowClaw` + `回到空间` 按钮（FK1 stub 仅 `console.info`）；右侧 3 个
  小按钮 — 新对话（`Pencil` icon，避免与"添加文件" `+` 重复）/ 展开收起
  文本切换 / 设置（`Settings` icon stub）。
- **`FloatingInput.jsx`**（~185 行）：textarea 占满 body；自定义滚动条
  使用 scoped `<style>` + `useId()` 生成的唯一 class（细瘦 9px 宽、
  `scrollbar-gutter: stable`、track margin 10/46 让滚动条避开按钮）；
  左下角 3 个 32×32 icon 按钮（`Camera` / `FileText` / `Plus`，FK1 全
  stub）；右下角 send/abort 按钮；Enter 发送 + Shift+Enter 换行 + IME
  `isComposing` 防误触；streaming 时按钮变 `Square` 图标走 abort 路径。
- **`useFloatingKnowClaw.js`**（~250 行）：精简版会话 hook。
  - 复用 `knowclaw-v2/knowclawEventReducer.js` 的 `ensureStreamingMessage
    / updateToolByCallId / stringifyResult / summarizeToolArgs` 纯函数
    （无 channel 耦合，跨 hook 安全共享）。
  - 处理事件：`agent_start` / `message_update`（text_delta /
    thinking_delta）/ `tool_execution_start` / `tool_execution_end` /
    `agent_end` / `history_loaded` / `error`；其他 turn_start /
    queue_update / compaction_* 在 FK1 忽略，FK3 起按需扩展。
  - mount 时调 `knowclawFloating.rehydrate()` 恢复活跃会话；事件订阅
    一次性 bind（依赖数组空），用 `sessionIdRef` + 函数式 setter 防
    listener 频繁重绑导致的事件丢失。
  - 暴露 `sendMessage / abort / newSession`；`sendMessage` 在发送前乐观
    追加 user bubble，IPC 失败时回滚 streaming 标志并 set `error`。

**变更日志**

| 日期 | 变更 |
|------|------|
| 2026-05-25 | FK1-5 完成：`useFloatingKnowClaw.js` 新建，监听 7 类核心事件，复用主台 reducer 纯函数；暴露 `sendMessage / abort / newSession`。 |
| 2026-05-25 | FK1-3 完成：`FloatingHeader.jsx` 新建，对标 demo 40px header；`回到空间` / `设置` FK1 stub 为 `console.info`。 |
| 2026-05-25 | FK1-4 完成：`FloatingInput.jsx` 新建，自定义滚动条以 scoped `<style>` 实现；Enter/Shift+Enter/IME 处理与主台 `ChatInput` 行为一致；streaming 时 send 按钮切换为 abort 图标。 |
| 2026-05-25 | FK1-2 完成：`KnowClawFloating.jsx` 新建，宽 360px、紧凑/展开两态 minHeight；内嵌错误 chip。 |
| 2026-05-25 | FK1-1 完成：`FloatingMode.jsx` 新增 `mode` 状态、rail 底部 violet `Sparkles` 按钮；Vault domain 按钮在 KnowClaw 模式下变灰；ResizeObserver 依赖追加 `mode`；Esc 升档由三档扩为四档（菜单→子面板→KnowClaw→中台）。 |
| 2026-05-25 | 实际改动量：`FloatingMode.jsx` ~50 行改 / `KnowClawFloating.jsx` ~90 行新 / `FloatingHeader.jsx` ~115 行新 / `FloatingInput.jsx` ~185 行新 / `useFloatingKnowClaw.js` ~250 行新，总计 ~690 行（高于预估 420 行，主要差异在 hook 比预估细致 + 输入框的滚动条 scoped 样式）。lint 0 错误。 |

---

### Phase FK2 — 外部大气泡 + 自适应定位

**Status:** `DONE`（2026-05-25）

**目标**：KnowClaw 模式下发送消息后，回复以悬浮窗外部大气泡形式出现，
位置自动适配悬浮窗在屏幕上的方位。

**前置**：FK0 完成；FK1 完成（有可发送的输入控制器）；FK3 完成（展开态
`expanded` 状态供气泡集成决定是否显示）。

> **执行顺序调整**：实际开发中 FK3 先行、FK2 后做。FK3 为纯 React 组件，
> 可先验证完整「发送 → 事件 → 渲染消息」流程；FK2 在此基础上把已验证的
> 流式内容中继到独立气泡窗口，减少联调风险。

**工作清单**

读：
- `src/main.js`（悬浮窗 BrowserWindow 实例、位置、screen API）
- `Agent/pi-runtime/` 流式事件类型（`message_update` / `tool_execution_*`）
- `k3-floating-knowclaw-demo.html` 中 `.assistant-bubble` 样式

写/改：
1. **新窗口类 `src/main.js` `createBubbleWindow()`** — 第二个
   frameless transparent BrowserWindow，专门承载气泡；`alwaysOnTop:'screen-saver'`、
   `skipTaskbar:true`、`focusable:false`（避免抢焦点）。
2. **IPC `bubble/show` / `bubble/hide` / `bubble/setContent` / `bubble/expandRequest`** —
   主进程根据悬浮窗当前 `getBounds()` 和 `screen.getDisplayMatching` 计算
   placement（D-FK-7 算法），定位气泡窗口并 push 内容。
3. **新 renderer 路由：bundle URL 加 `?ui=bubble`** — 悬浮窗已在用
   `?ui=floating`；这里复用 same bundle 加新参数。
4. **新组件 `floating-knowclaw/BubbleView.jsx`** —
   - 顶部小指示条 `🟢 KnowClaw 回复` + 角部小三角指向悬浮窗
   - 主体：markdown 渲染 + 流式光标
   - 底部：`展开到悬浮窗内` / `收起` 两个按钮
5. **`useFloatingKnowClaw.js`** — 收到 assistant 流式消息时：
   - 若内部展开态关闭 → `bubble/show` 并增量 push 内容
   - 若内部展开态打开 → 不显示气泡，直接走内部 message list
6. **悬浮窗移动 → 通知主进程更新气泡位置** — `floatingWindow.on('moved')`
   监听 + debounce 50ms。

**不做**：
- 不做截屏触发气泡（FK4）
- 不做多屏 hot-swap（用户拖窗口跨屏 → 简单算法即可，复杂场景留 P2）

**验收**：
- 悬浮窗在屏幕 4 个角，发送消息后气泡分别从对侧出现
- 气泡跟随悬浮窗移动而平滑跟随（< 100ms 延迟）
- 流式渲染光标，token 增量平滑
- 气泡超出屏幕剩余空间时内部滚动而非溢出
- 关闭悬浮窗（hide）时气泡同步消失

**实际实现要点**

- **`main.js` 新增 `createBubbleWindow()`**（~40 行）：420×430 frameless
  transparent BrowserWindow，`focusable: false` + `skipTaskbar: true` +
  `alwaysOnTop: 'screen-saver'`；`show: false` 懒显示，第一次 `bubble/show`
  IPC 时才创建。复用 `loadRenderer(win, 'bubble')` 加载 `?ui=bubble` 路由。
  关闭时清理 `bubbleWindow = null` + `bubbleWindowRef.current = null`。
- **`main.js` 新增 `repositionBubble()`**（~35 行）：实现 D-FK-7 定位算法，
  使用 `screen.getDisplayMatching(floatingBounds)` 获取当前显示器 workArea；
  比较左右空间选择展开方向；bubble 宽度 `Math.min(420, sideSpace - 24)`，
  最小 200px；y 坐标对齐 header 下方（`fBounds.y + 60`），限制在屏幕内。
- **`main.js` 新增 `screen` import** 和 `bubbleWindow` / `bubbleWindowRef`
  全局变量。
- **`floatingWindow.on('moved')` 监听**（~5 行）：50ms setTimeout debounce
  调用 `repositionBubble()`。
- **`floatingWindow.on('hide')` / `on('closed')` 扩展**（~6 行）：
  `hide` 时同步 `bubbleWindow?.hide()`；`closed` 时 `bubbleWindow?.close()`。
- **`loadRenderer` 通用化**（1 行改动）：`uiMode === 'floating'` 硬编码改为
  `uiMode !== 'main' ? \`ui=${uiMode}\`` 通配，支持 `'floating'` / `'bubble'`
  / 未来任何新模式。
- **新文件 `src/main/ipc/bubble.js`**（~65 行）：`registerBubbleIpc` 注册 4 个
  IPC handler：
  - `bubble/show` — 懒调 `createBubbleWindow()`，发送 `bubble:content` 事件到
    bubble renderer，调用 `repositionBubble()` 后 `show()`。
  - `bubble/hide` — 隐藏但不销毁。
  - `bubble/setContent` — 更新已可见气泡内容（流式增量更新）。
  - `bubble/expandRequest` — 隐藏气泡 + 转发 `bubble:expandRequest` 事件到
    悬浮窗 renderer，触发展开。
- **`preload.js` 新增 `bubble` 命名空间**（~20 行）：
  `show` / `hide` / `setContent` / `expandRequest`（invoke）+
  `onContent` / `onExpandRequest`（event listener + cleanup）。
- **`App.jsx` 路由扩展**（~6 行）：`uiMode` 检测增加 `'bubble'` 分支，
  返回 `<BubbleView />`。
- **新文件 `floating-knowclaw/BubbleView.jsx`**（~185 行）：独立气泡窗口的
  React 组件。订阅 `bubble:content` 事件接收 `{ html, thinking }` 并渲染。
  全部样式 scoped inline（独立窗口无全局 CSS）。
  - 顶部 label：绿色/紫色圆点 + "KnowClaw 回复" / "KnowClaw 正在分析"。
  - 主体：`dangerouslySetInnerHTML` 渲染已 parse 的 markdown HTML。
  - 流式光标：`cursor-blink` 动画，`thinking === true` 时显示。
  - 底部按钮行："展开到悬浮窗内"（primary indigo）+ "收起"。
  - 入场动画 `bubble-in`：180ms ease-out，`translateX(8px) translateY(4px)
    scale(0.985)` → 原位。
  - 玻璃态：`rgba(255,255,255,0.94)` + `backdrop-filter: blur(22px)` +
    `box-shadow: 0 26px 80px rgba(15,23,42,0.18)`。
- **`useFloatingKnowClaw.js` 气泡集成**（~30 行新增）：
  - `useEffect` 监听 `messages` + `streaming` + `expanded`：展开态调
    `bubble.hide()`；紧凑态下最后一条 assistant 消息 streaming 时调
    `bubble.show(html, true)`，完成后调 `bubble.setContent(html, false)`。
  - `renderMarkdownForBubble()` 使用 `marked.parse()` + 异常回退。
  - `expandRequestRef` + `onExpandRequest` 监听：气泡窗口点击"展开到悬浮窗内"
    时通过主进程中继到悬浮窗 renderer，`KnowClawFloating` 注册回调执行
    `setExpanded(true)`。
- **`FloatingMode.jsx` 生命周期协调**（~10 行）：`setMode` wrapper，当从
  `knowclaw` 切换到 `vault` 时自动调 `bubble.hide()`，避免切换模式后
  气泡仍然可见。
- **`useFloatingKnowClaw.js` `newSession` 扩展**（1 行）：新建对话时
  调 `bubble.hide()` 清理残留气泡。

**变更日志**

| 日期 | 变更 |
|------|------|
| 2026-05-25 | FK2-1 / FK2-2 完成：`main.js` 新增 `createBubbleWindow()`（frameless / transparent / focusable:false）+ `repositionBubble()` 定位算法 + `floatingWindow.on('moved')` 50ms debounce 跟随；`screen` import 引入。 |
| 2026-05-25 | FK2-3 完成：新建 `src/main/ipc/bubble.js`，4 个 IPC handler（show/hide/setContent/expandRequest）；`main.js` import 并 `registerBubbleIpc()`。 |
| 2026-05-25 | FK2-4 完成：`preload.js` 新增 `bubble` 命名空间（4 invoke + 2 event listener），`contextBridge.exposeInMainWorld` 内追加。 |
| 2026-05-25 | FK2-5 完成：`loadRenderer` 通用化（`uiMode !== 'main'` 通配）；`App.jsx` 增加 `bubble` 路由 → `<BubbleView />`。 |
| 2026-05-25 | FK2-6 完成：新建 `BubbleView.jsx`（~185 行），全 scoped 样式，玻璃态气泡 + 入场动画 + 流式光标 + 展开/收起按钮。 |
| 2026-05-25 | FK2-7 完成：`useFloatingKnowClaw.js` 新增气泡集成 useEffect + `renderMarkdownForBubble` + `expandRequestRef` 回调机制。 |
| 2026-05-25 | FK2-8 完成：`floatingWindow.on('hide'/'closed')` 同步 bubble 隐藏/关闭；`FloatingMode.jsx` setMode wrapper 模式切换时 bubble.hide()；`newSession` 清理残留气泡。 |
| 2026-05-25 | 实际改动量：`main.js` ~120 行改 / `bubble.js` ~65 行新 / `preload.js` ~20 行新 / `App.jsx` ~8 行改 / `BubbleView.jsx` ~185 行新 / `useFloatingKnowClaw.js` ~45 行新 / `FloatingMode.jsx` ~12 行改，总计 ~455 行。lint 0 错误。 |

---

### Phase FK3 — 内部展开对话视图 + 会话生命周期

**Status:** `DONE`（2026-05-25）

**目标**：实现 demo 中 Header `展开` 按钮的完整行为；展开后悬浮窗内出现
完整消息列表，气泡自动收起；并完成"新对话"/历史会话 slide-over/设置菜单。

> **执行顺序调整**：实际开发中 FK3 先于 FK2 执行。FK3 为纯 React 组件，
> 不依赖主进程新窗口，可先完成内部消息列表和会话生命周期功能，验证完整的
> 「发送 → 接收事件 → 渲染消息」流程后再为 FK2 提供 `expanded` 状态。

**前置**：FK0 + FK1 完成。

**工作清单**

读：
- 主台 `KnowClawV2Page.jsx` / `useKnowClawV2Chat.js`（复用消息组件、思考
  折叠、工具折叠等已成熟的渲染器）
- `MessageBubble.jsx`（评估是否可以复用 / 是否需要悬浮窗专用变体）

写/改：
1. **新组件 `floating-knowclaw/FloatingChatList.jsx`** — 轻量级消息列表：
   - 消息气泡（用户右靠 / AI 左靠）— **沿用 demo 样式而非主台样式**
   - 工具调用：单行 pill 指示条（绿点 + 工具名 + 摘要），不展开详情
   - 思考块：仅一行 `thinking...` 指示器
   - 流式光标 `cursor-blink` 动画
2. **`KnowClawFloating.jsx`** — 展开态插入 `<FloatingChatList />`，
   `minHeight` 调整为 480。
3. **`useFloatingKnowClaw.js`** — 新增 `listSessions` / `openSession` /
   `deleteSession` / `setThinkingLevel` / `steer` + `sessions` 和
   `thinkingLevel` 状态。
4. **`FloatingHeader.jsx`** — 展开态显示历史按钮 + 设置按钮接线。
5. **新组件 `floating-knowclaw/HistoryPanel.jsx`** — 会话历史抽屉。
6. **新组件 `floating-knowclaw/SettingsMenu.jsx`** — 设置浮层。
7. **`KnowClawFloating.jsx`** — 预留 `onBubbleHide` / `onBubbleShow` prop
   供 FK2 接入。

**不做**：
- 不做 Plan 模式（v1 悬浮窗不支持）
- 不做附件 / 文件树面板（信息密度太大）

**验收**：
- 展开 / 收起切换流畅（窗口高度过渡 ease，气泡同步消失/出现）
- 新对话清空内容，气泡也关闭
- 历史会话面板能切换、消息列表能正确重渲染
- 设置菜单切换 thinking 后下一条消息生效
- 切到 Vault 模式不丢 KnowClaw 内部状态（KnowClawPersistProvider 已保证）

**实际实现要点**

- **新文件 `FloatingChatList.jsx`**（~160 行）：轻量级消息列表，**不复用主台
  `MessageBubble`**（后者 ~700 行含 ToolCallCard / FileChangePreview /
  TaskCard / AskUserCard / DelegateTaskResult 等重组件），而是定制的 custom-light
  渲染器，对标 demo `.kc-messages` 样式。
  - User 消息：右对齐，`indigo-50` 背景，无头像。
  - Assistant 消息：左对齐，22×22 "K" 头像（`slate-100` 圆角方块），白色气泡；
    文本走 `marked.parse()` → `dangerouslySetInnerHTML`；定义 scoped `.fc-prose`
    样式（`p` 间距 7px、`code` / `pre` / `ul` 等精简排版）。
  - 工具调用：`ToolPill` 组件，单行指示条（状态色圆点 + 工具名/摘要截断），
    running 态有 `pulse` 动画。复用 `knowclawEventReducer.summarizeToolArgs` 纯函数。
  - 思考块：无内容且 streaming 时显示 `思考中...` 斜体。
  - 流式光标：`cursor-blink` 动画（2px 宽竖线），streaming 且有内容时附加在
    assistant 气泡末尾。
  - 容器固定高度 260px、`overflow-y: auto`；自定义滚动条与 `FloatingInput` 同款
    （9px 宽、`scrollbar-gutter: stable`、半透明 thumb）。
  - 自动滚底：`useEffect` + `scrollIntoView({ behavior: 'smooth' })`。
  - Tasks / ask_user / system 消息 FK3 暂不渲染（悬浮窗场景极少触发）。
- **`KnowClawFloating.jsx` 改动**（~50 行改动）：
  - Import 增加 `FloatingChatList` / `HistoryPanel` / `SettingsMenu`。
  - 新增 `historyOpen` / `settingsOpen` 状态。
  - `expanded === true` 时在 Header 和 Input 之间渲染
    `<FloatingChatList messages={chat.messages} streaming={chat.streaming} />`。
  - HistoryPanel 以 absolute overlay 覆盖在 chat list 区域（共享同一个
    `<div className="relative">` 容器）。
  - SettingsMenu 以 absolute 浮层从 header 下方展开。
  - 展开态 `minHeight` 从 430 改为 **480**（260px chat list + 78px input
    + 40px header + padding）。
  - Input 的 `onSend` 在展开且 streaming 时接 `chat.steer`，否则接
    `chat.sendMessage`（展开态下追问走 steer 不新起 turn）。
  - 接收 `{ onBubbleHide, onBubbleShow }` 可选 prop，FK3 阶段为 `undefined`，
    FK2 接入后由 `FloatingMode` 传入。
  - FK2 `expandRequestRef` 回调注册：`useEffect` 将 `setExpanded(true)` 写入
    `chat.expandRequestRef.current`，bubble "展开到悬浮窗内" 按钮通过此回调
    触发面板展开。
- **`useFloatingKnowClaw.js` 扩展**（~110 行新增）：
  - 接收 `{ expanded }` 参数（由 `KnowClawFloating` 传入），存入 `expandedRef`
    供 FK2 的 bubble 集成 `useEffect` 读取。
  - 新增状态：`sessions: []`（历史会话列表）+ `thinkingLevel: 'off'`。
  - mount 时额外调 `knowclawFloating.getStatus()` 读取当前 `thinkingLevel`。
  - 新增 5 个 action：`listSessions` / `openSession` / `deleteSession` /
    `setThinkingLevel` / `steer`。
  - `deleteSession` 成功后 setState 过滤已删 session。
  - `steer` 语义与 `sendMessage` 类似但消息 `kind: 'steer'`，表示展开态下的
    流式追问而非新起 turn。
- **`FloatingHeader.jsx` 改动**（~20 行）：
  - Import 增加 `Clock` icon。
  - 新增 `onToggleHistory` / `onOpenSettings` prop（取代 FK1 的 stub
    `console.info`）。
  - 仅在 `expanded === true` 时渲染第 4 个按钮"历史"（`Clock` icon，28×24
    小按钮），点击调 `onToggleHistory()`。
  - "设置" 按钮的 `onClick` 接 `onOpenSettings()`。
- **新文件 `HistoryPanel.jsx`**（~140 行）：会话历史 slide-over，absolute 覆盖
  chat list 区域。
  - 入场动画 `slideIn` 160ms ease-out（translateX 12px → 0）。
  - 顶部搜索栏 + 关闭按钮（`X` icon）。
  - Session 列表：首条消息预览 + 消息条数 + 相对时间（"X 分钟前"/"X 天前"）；
    当前 session 用 `indigo-50` 高亮。
  - 删除功能：二次确认（首次点击变红，再次点击执行删除并从 `sessions` 中过滤）。
  - 点击某 session → `chat.openSession(path)` → panel 自动关闭。
  - 精简版设计：无右键菜单、无分支功能（不暴露 forkSession）。
- **新文件 `SettingsMenu.jsx`**（~130 行）：设置浮层，absolute 定位从 header
  右下角展开。
  - 入场动画 `fadeIn` 120ms ease-out。
  - 模型选择区：mount 时调 `window.ipm.knowclaw.listModels()` 拉取可用模型列表；
    active 模型用 `indigo-50` 高亮；点击调 `window.ipm.knowclaw.setModel()`
    全局切换。
  - 思考深度区：四档单选（关闭 / 低 / 中 / 高），active 档用 `slate-800` 深色
    按钮、其余白色边框按钮。
  - 点击外部区域关闭（`useEffect` + `document.addEventListener('mousedown')`）。
  - 无 Plan 模式开关（悬浮窗不支持）。

**变更日志**

| 日期 | 变更 |
|------|------|
| 2026-05-25 | FK3-1 完成：新建 `FloatingChatList.jsx`（~160 行），对标 demo 样式的 custom-light 消息列表；ToolPill 指示条复用 `summarizeToolArgs`；scoped `.fc-prose` 排版；`cursor-blink` 流式光标；260px 固定高度 + 自动滚底。 |
| 2026-05-25 | FK3-2 完成：`KnowClawFloating.jsx` 展开态插入 `<FloatingChatList />`；展开态 `minHeight` 调整为 480。 |
| 2026-05-25 | FK3-3 完成：`useFloatingKnowClaw.js` 新增 `sessions` / `thinkingLevel` 状态 + `listSessions` / `openSession` / `deleteSession` / `setThinkingLevel` / `steer` 五个 action；mount 时从 `getStatus()` 读取 thinkingLevel。 |
| 2026-05-25 | FK3-4 完成：`FloatingHeader.jsx` 展开态显示 `Clock` 历史按钮；`onToggleHistory` / `onOpenSettings` prop 替代 FK1 stub。 |
| 2026-05-25 | FK3-5 完成：新建 `HistoryPanel.jsx`（~140 行），slide-over overlay + 搜索 + session 列表 + 二次确认删除 + 当前 session 高亮。 |
| 2026-05-25 | FK3-6 完成：新建 `SettingsMenu.jsx`（~130 行），模型下拉列表 + 思考深度四档单选 + 点击外部关闭。 |
| 2026-05-25 | FK3-7 完成：`KnowClawFloating.jsx` 接收 `{ onBubbleHide, onBubbleShow }` 可选 prop；`useFloatingKnowClaw` 接收 `{ expanded }` 参数。 |
| 2026-05-25 | 实际改动量：`FloatingChatList.jsx` ~160 行新 / `KnowClawFloating.jsx` ~50 行改 / `useFloatingKnowClaw.js` ~110 行新 / `FloatingHeader.jsx` ~20 行改 / `HistoryPanel.jsx` ~140 行新 / `SettingsMenu.jsx` ~130 行新，总计 ~610 行。lint 0 错误。 |

---

### Phase FK4 — 智能截屏总结流程

**Status:** `DONE`（2026-05-25）

**目标**：左下角 📷 按钮 → 隐藏悬浮窗 → 全屏截图 → 显示预览卡片（3s 内可
取消）→ 同时发送给 KnowClaw（vision 总结）+ 走 OCR 提取 raw 文本 → 回复以
气泡展示，原图和 OCR 文件落到 `_floating/captures/`。

**前置**：FK0 + FK1 + FK2 完成；F3 OCR 已 `DONE`（前置）。

**工作清单**

读：
- `src/main.js` 既有 clipboard image 缓存机制（`clipboardImageCache`）
- `Agent/services/ocrService.js`（接受 PNG Buffer）
- `src/ui/components/agent-chat/imageResize.js`（Canvas 压缩）
- `Agent/pi-runtime/models.js` `inferModelInputs`

写/改：
1. **主进程 `src/main/ipc/capture.js`** — 新文件，注册 `capture/fullScreen`：
   ```js
   ipcMain.handle('capture/fullScreen', async () => {
     floatingWindow.hide();
     bubbleWindow?.hide();
     await new Promise(r => setTimeout(r, 120));
     const display = screen.getPrimaryDisplay();
     const { width, height } = display.size;
     const sf = display.scaleFactor;
     const sources = await desktopCapturer.getSources({
       types: ['screen'],
       thumbnailSize: { width: width * sf, height: height * sf },
     });
     floatingWindow.show();
     const img = sources[0].thumbnail;
     return { pngBuffer: img.toPNG(), width, height };
   });
   ```
2. **`src/main.js`** — `registerCaptureIpc({ ipcMain, getFloatingWindow, getBubbleWindow })`。
3. **`preload.js`** — `window.ipm.capture = { fullScreen: () => ... }`。
4. **`useFloatingKnowClaw.js`** — 新增 `triggerCaptureSummary()` 流程：
   - 调 `window.ipm.capture.fullScreen()` 拿到 PNG Buffer
   - 同步触发 OCR：`window.ipm.ocr.recognizeBuffer(pngBuffer)`
   - 并行：把 PNG 经 `resizeImageToBase64` 压缩到 vision 友好尺寸
   - 把图片 + prompt（"请用 2~4 段话总结这张截图的核心信息"）通过
     `knowclaw:send { channel: 'floating', images: [...] }` 发出
5. **新组件 `floating-knowclaw/CapturePreviewCard.jsx`** — 预览卡片：
   缩略图 + `发送给 AI 总结` / `仅 OCR` / `取消`；3s 倒计时自动发送（demo 已
   实现 UI）；卡片显示在外部气泡的顶部或单独 mini-bubble。
6. **`src/main/ipc/knowclaw.js`** — `captureSummary` 完成后，把原图 PNG 写到
   `_floating/captures/<ts>.png`，OCR 文本写到 `_floating/captures/<ts>.ocr.txt`；
   消息内附路径让用户能在中台 workspace 看到。
7. **气泡内 AI 回复下方** — 自动追加 `📋 OCR 原文` 折叠区，点击展开查看
   raw 文本。

**不做**：
- 不做区域截屏（FK5 决定是否做）
- 不做多屏选择 UI（默认主屏；多屏用户用快捷键时不会困惑）
- 不做截屏前的"准备 3 秒倒计时"（多余）

**验收**：
- Windows 上点 📷 → 悬浮窗短暂消失 → 全屏截图成功 → 缩略图卡片显示
- macOS 首次触发提示授权
- AI 摘要正常流式回复
- `_floating/captures/` 下能找到 png 和 ocr.txt
- 中台 KnowClaw 切到悬浮 workspace 能看到这两个文件

**实际实现要点**（2026-05-25）

- 与原计划差异（按用户确认决策）：
  - CapturePreviewCard **不做 3s 自动倒计时**，用户必须手动点「发送给 AI 总结」/「仅 OCR」/「取消」。
  - 截屏始终走 `screen.getPrimaryDisplay()`（主显示器），未做悬浮窗所在显示器匹配；多屏用户走主屏即可。
  - 气泡内 **不渲染 OCR 全文折叠区**：BubbleView 底部只放一个 `复制 OCR 原文` 按钮，点击调 `navigator.clipboard.writeText(ocrText)`；全文仍写入 `_floating/captures/<ts>.ocr.txt`。
- 新增模块：
  - [`src/main/ipc/capture.js`](../src/main/ipc/capture.js)：`capture/fullScreen` + `capture/saveArtifacts` + `capture/saveNote`（FK5 也用）。截屏前 hide floating/bubble 并 sleep 120ms，restore 在 finally 兜底；macOS 权限失败时返回 `screen_permission_denied`。`getFloatingWorkspacePath()` 由 main.js 注入，避免与 knowclaw.js 中的 `FLOATING_WORKSPACE_PATH` 重复定义。
  - [`src/ui/components/floating-knowclaw/CapturePreviewCard.jsx`](../src/ui/components/floating-knowclaw/CapturePreviewCard.jsx)：~110 行；移植 demo `.capture-preview` 视觉，OCR 运行中显示「OCR 中…」hint。
- 修改：
  - [`src/preload.js`](../src/preload.js)：新增 `window.ipm.capture.{fullScreen,saveArtifacts,saveNote}`；`bubble.show/setContent` 第三参 `ocrText`。
  - [`src/main.js`](../src/main.js)：`registerCaptureIpc` + `registerClipboardIpc` 注册，新增 `getFloatingWorkspacePath()` helper；`pruneClipboardImageCache` TTL 由 60s 提升到 120s。
  - [`src/main/ipc/bubble.js`](../src/main/ipc/bubble.js)：`bubble:content` payload 增加可选 `ocrText`。
  - [`src/ui/components/floating-knowclaw/useFloatingKnowClaw.js`](../src/ui/components/floating-knowclaw/useFloatingKnowClaw.js)：`sendMessage(text, opts?)` 签名扩展支持 `images / ocrText / attachments`；新增 `capturePreview` state + `triggerCaptureSummary / confirmCaptureSummary / confirmCaptureOcrOnly / dismissCapturePreview` 四个 action；新增 `floatingModelSupportsVision()` + `pngBufferToVisionPayload()`（基于 `imageResize.js`）+ `formatOcrQuoteBlock()` helper；`lastOcrTextRef` 在新 session / 普通 send 时清空，capture-summary 发送时塞入供气泡读取。OCR 在用户看预览卡时后台并发执行（`ocrInFlightRef` 去重），不需要用户「仅 OCR」时再等。
  - [`src/ui/components/floating-knowclaw/BubbleView.jsx`](../src/ui/components/floating-knowclaw/BubbleView.jsx)：接收 `ocrText`，存在时底部多出一个「复制 OCR 原文」按钮（短暂显示「已复制」），不渲染原文 UI。
  - [`src/ui/components/floating-knowclaw/FloatingInput.jsx`](../src/ui/components/floating-knowclaw/FloatingInput.jsx)：`forwardRef` 暴露 `injectText / appendText / focus / clear`，新增 `disabledQuickActions` prop 控制三个 quick button。
  - [`src/ui/components/floating-knowclaw/KnowClawFloating.jsx`](../src/ui/components/floating-knowclaw/KnowClawFloating.jsx)：渲染 `CapturePreviewCard` + `OcrResultCard`（互斥，置于 settings 与 input 之间）；`FloatingInput` 接收 `ref={chat.inputApiRef}` / `onScreenshot` / `onOcr` / `disabledQuickActions`；error chip 改为可点击关闭。
- Vision 降级：检测主台 `knowclaw.listModels`，`active.input.includes('image') === false` 时改 prompt 为 `以下是从截图 OCR 提取的原文，请总结：\n\n${ocrText}` 并设置一次 inline error chip「当前模型不支持识图，已改用 OCR 文本总结」。
- Capture artifacts：`saveArtifacts` 与 `sendMessage` 并行（`Promise.resolve().then(...)`），不阻塞 AI 响应；OCR 失败时不写 `.ocr.txt`。
- macOS 权限：当前仅返回错误码 + 错误 chip，未做系统设置引导（留给 FK7）。

**变更日志**

| 日期 | 变更 |
|------|------|
| 2026-05-25 | FK4 实施完成。新增 `capture.js` + `CapturePreviewCard.jsx`；改写 `useFloatingKnowClaw.js`（sendMessage 支持 images + capture 流程 4 action）；`BubbleView` 增加复制 OCR 按钮；`FloatingInput` forwardRef + disabledQuickActions；clipboard cache TTL 60→120s。无自动倒计时（用户确认手动发送）；OCR 全文不在 UI 展示，仅落盘 + 气泡复制按钮。lint 0 错误。 |

---

### Phase FK5 — OCR 快捷提取

**Status:** `DONE`（2026-05-25）

**目标**：左下角 📋 OCR 提取按钮：优先对剪贴板图片做 OCR，无图则触发截屏
后做 OCR；结果以可复制 / 可追问的卡片展示。

**前置**：FK4 完成（截屏管道复用）。

**工作清单**

读：
- 现有 `src/main.js` 中 `clipboardImageCache` token 机制（`subscribeImage`）
- FK4 中的 `capture/fullScreen` IPC

写/改：
1. **`useFloatingKnowClaw.js`** — `triggerOcrExtract()`：
   - 优先读取 clipboardImageCache 最近一张图（< 2 分钟）
   - 若无 → 调用 `window.ipm.capture.fullScreen()`
   - 调用 `window.ipm.ocr.recognizeBuffer(pngBuffer)`
2. **新组件 `floating-knowclaw/OcrResultCard.jsx`** — 卡片：
   - 顶部置信度 + 总字符数
   - 中部：raw text（最多 6 行预览，可展开全文）
   - 底部：`📋 复制全部` / `🤖 追问 AI` / `💾 保存为笔记`
3. **追问 AI** — 把 OCR 文本以引用块插入 input：
   `> [OCR 提取于 2026-05-25]\n> ...`，光标停在最后让用户写追问。
4. **保存为笔记** — 写到 `_floating/notes/<ts>.md`。

**可选 P2（默认不做）**：
- 区域框选截屏：透明全屏覆盖窗口 + 鼠标框选 + crop。如做则放 FK5b 子阶段，
  独立分期。

**验收**：
- 剪贴板有图时，📋 按钮直接对剪贴板图做 OCR（无 0.1s 截屏）
- 剪贴板无图时，自动走截屏流程
- OCR 卡片"追问 AI"能把上下文注入输入框
- 中文 / 英文 OCR 均工作（PP-OCRv5 默认 ch 模型即可）

**实际实现要点**（2026-05-25）

- 与原计划差异：
  - 当剪贴板无图 + 截屏也失败（macOS 权限被拒 / 用户拒绝授权）时，**显示 inline error chip**「无可用图片，请手动截图后重试」，不再静默中止。
  - 与 FK4 的「仅 OCR」复用同一个 `OcrResultCard` 实例（KnowClawFloating 中 OcrResultCard 总挂载，`triggerCaptureSummary → confirmCaptureOcrOnly` 写入即可），避免重复 UI。
- 新增模块：
  - [`src/main/ipc/clipboard.js`](../src/main/ipc/clipboard.js)：`clipboard/getLatestImage` — 从 `clipboardImageCache`（main.js 维护）取最新一条 PNG buffer；TTL 检查阈值 `120_000ms`，过期返回 `{ ok:false, reason:'expired' }`。
  - [`src/main/ipc/capture.js`](../src/main/ipc/capture.js#L160)：`capture/saveNote` — 写入 `_floating/notes/<ts>.md`。
  - [`src/ui/components/floating-knowclaw/OcrResultCard.jsx`](../src/ui/components/floating-knowclaw/OcrResultCard.jsx)：~150 行；顶部置信度/字数/来源，6 行 line-clamp 预览，三按钮（复制全部 / 追问 AI / 保存为笔记），关闭按钮，复制/保存后短暂 hint。
- 修改：
  - [`src/preload.js`](../src/preload.js)：`window.ipm.clipboard.getLatestImage`、`window.ipm.capture.saveNote(content)`。
  - [`src/main.js`](../src/main.js)：注册 `registerClipboardIpc`；`pruneClipboardImageCache` TTL 同步提升到 120s（与 FK5 IPC 的窗口一致）。
  - [`src/ui/components/floating-knowclaw/useFloatingKnowClaw.js`](../src/ui/components/floating-knowclaw/useFloatingKnowClaw.js)：新增 `ocrResultCard` state + `triggerOcrExtract / copyOcrResult / askAiFromOcr / saveOcrAsNote / dismissOcrResult` 五个 action；`inputApiRef`（FloatingInput 注入）使 `askAiFromOcr` 能 `injectText(...)` 引用块；笔记内容包含元信息（时间 / 字数 / 置信度 / 来源）+ 原文。
  - [`src/ui/components/floating-knowclaw/FloatingInput.jsx`](../src/ui/components/floating-knowclaw/FloatingInput.jsx)：`forwardRef` + `useImperativeHandle({ injectText, appendText, focus, clear })`；FK4/FK5 共用同一改动。
  - [`src/ui/components/floating-knowclaw/KnowClawFloating.jsx`](../src/ui/components/floating-knowclaw/KnowClawFloating.jsx)：渲染 OcrResultCard，OCR/Capture/streaming 任一为 true 时 quick buttons 全部 disabled，避免误触。
- 「追问 AI」格式与计划一致：`> [OCR 提取于 YYYY-MM-DD HH:mm]\n> 第一行...\n> ...\n\n`，注入后 cursor 停留在末尾。
- 区域框选截屏（P2）未做，后续如需另起 FK5b。

**变更日志**

| 日期 | 变更 |
|------|------|
| 2026-05-25 | FK5 实施完成。新增 `clipboard.js` IPC（`getLatestImage`，120s TTL）+ `capture/saveNote` + `OcrResultCard.jsx`；`useFloatingKnowClaw` 增加 OCR 流程 5 action + inputApiRef；剪贴板无图 + 截屏失败显示 inline error chip 引导手动截图；与 FK4「仅 OCR」复用同一 OcrResultCard。lint 0 错误。 |

---

### Phase FK6 — "回到空间" + 文件拖入增强 + 主台可见性

**Status:** `DONE`

**目标**：把悬浮窗 KnowClaw 与中台 KnowClaw 双向打通：
- "回到空间" 按钮真实跳转
- 主台 `listWorkspaces` 中标记 `_floating/` 为"⚡悬浮助手"
- 文件拖入悬浮窗时增加"发送给 AI 分析"路径

**前置**：FK0~FK3 完成。

**工作清单**

读：
- `src/main/ipc/ui.js`（已有 `ui/backToMain` 淡入淡出切换）
- `src/main/ipc/knowclaw.js` `listWorkspaces`
- 主台 `useKnowClawPersist.jsx` 的 `setCwd` 流程
- 悬浮窗 `TrayWidget.jsx` 拖拽处理

写/改：
1. **新 IPC `ui/backToFloatingWorkspace`** — 一次性完成：
   - 走 `ui/backToMain` 的淡入淡出
   - 切到主窗口后 push `nav/setActive` → `'knowclaw'` 页
   - push `knowclaw/forceSetCwd` → `FLOATING_WORKSPACE_PATH`
   - 触发 listSessions 自动展开
2. **`preload.js`** — `window.ipm.ui.backToFloatingWorkspace()`。
3. **`FloatingHeader.jsx`** — `回到空间` 按钮接到此 IPC。
4. **`knowclaw.js` `listWorkspaces`** — `_floating/` 自动注入并标记
   `group: 'floating'` / `label: '⚡悬浮助手'` / `pinned: true`（永远第二，仅
   次于 global）。
5. **主台 `WorkspaceSelector`** — 渲染 `floating` group 在
   `workspaces` 上方；视觉差异化（浅紫色徽章）。
6. **`TrayWidget.jsx`** — 拖入文件时，原 `分类上传` 旁增加 `🤖 发送给 AI 分析`
   选项；后者会切换到 KnowClaw 模式并将文件路径 attach 到 floating session
   的 prompt。

**不做**：
- 不做"导出到中台项目"按钮（已被"回到空间 + 中台 KnowClaw 复用"覆盖；用户
  在中台 workspace 选 chat 后通过工具操作就能转移文件）

**验收**：
- 点 `回到空间` → 悬浮窗淡出 → 主窗口淡入 → 直接进 KnowClaw 页面 → workspace
  自动选中 `_floating` → 历史会话已加载
- 主台 workspace 下拉首屏即可看到"⚡悬浮助手"分组
- 拖入文件时弹出双选项；选 AI 后悬浮窗切到 KnowClaw 并显示 attach

**变更日志**

| 日期 | 变更 |
|------|------|
| 2026-05-25 | FK6 实施完成。`src/main/ipc/ui.js` 新增 `ui/backToFloatingWorkspace` + `ui/replyOpenFloatingWorkspace` request/reply IPC，确保渲染层主台 streaming 状态校验后再做窗口 fade；`preload.js` 暴露 `ui.backToFloatingWorkspace` / `ui.onOpenFloatingWorkspaceRequest` / `ui.replyOpenFloatingWorkspace`。`src/main/ipc/knowclaw.js` `listWorkspaces` 注入 `_floating` 条目（`domain: 'floating'` / `pinned/protected: true`）。新增 `knowclaw-v2/FloatingWorkspaceBridge.jsx`，在 `KnowClawPersistProvider` 内监听请求 → 导航 + `setCwd(_floating)`；主台 streaming 时阻断并 toast 提示。`KnowClawV2Page.jsx` `WorkspaceSelector`：`DOMAIN_LABELS.floating='悬浮助手'`、分组顺序 `global → floating → workspaces…`、紫色 badge。`FloatingHeader/KnowClawFloating` 接线「回到空间」按钮 → `setErrorMessage` 报告失败原因。`TrayWidget` 在 `FILE_STAGED` 状态新增「发送给 AI 分析」按钮；`FloatingMode` 实现 `handleSendFilesToAi`：`knowclawFloating.uploadToWorkspace` 上传后切换到 KnowClaw 模式并通过 `pendingInjectText` 注入 `@relPath`，不自动发送。lint 0 错误。进度看板 `PLANNED → DONE`。 |

---

### Phase FK7 — UX 打磨与收尾

**Status:** `DONE`

**目标**：动效统一、错误态完整、权限引导、文档与冒烟测试。

**前置**：FK0~FK6 完成。

**工作清单**

1. **动效**：
   - 气泡入场 / 出场 180ms ease
   - 截图预览 slide-in
   - 缩略 ↔ 展开过渡（窗口高度 + 内容透明度）
   - 模式切换（Vault ↔ KnowClaw）120ms 淡出淡入
2. **错误态**：
   - desktopCapturer 权限失败 → 弹引导 toast + `打开系统设置` 按钮
   - OCR 模型未下载 → toast `OCR 资源正在准备…`
   - AI 调用失败 → 气泡内显示 `⚠ 请求失败 ([错误码]) 重试 ↻`
   - vision 模型未配置 → 自动降级到 OCR + 文本总结，并 toast 提示
3. **键盘**：
   - KnowClaw 模式下 `Esc` 优先关气泡 → 关历史/设置 → 收起展开 → 切回 Vault
4. **首次引导**：
   - 第一次进入 KnowClaw 模式弹一次性 hint 卡片：3 张图说明缩略态 / 气泡 / 截屏
5. **冒烟测试脚本**：写 1 份手动测试清单（25 条）覆盖所有 phase 验收点
6. **文档**：
   - 更新 `KNOWCLAW_UPGRADE_PLAN.md`（如 U9+ 有涉及）
   - 在 `IPM_FEATURE_UPGRADE_PLAN.md` 进度看板把 K3 标 `DONE`
   - 把本文档所有 phase 的 `Status: PLANNED → DONE`，补完变更日志
   - 若 demo 与最终实现有差异，更新 demo 或在 demo 顶部加 deprecation note

**验收**：
- 手动跑完 25 条冒烟清单全通过
- README / 帮助菜单已提及悬浮窗 KnowClaw 入口

**变更日志**

| 日期 | 变更 |
|------|------|
| 2026-05-25 | FK7 实施完成。`src/index.css` 新增 `fk-card-in` / `fk-fade-in` / `fk-mode-in` 三套统一动效；`CapturePreviewCard` / `OcrResultCard` 应用 `fk-card-in`；`FloatingMode` 模式切换包裹 `fk-mode-in`。`useFloatingKnowClaw` 屏幕录制权限错误按平台（macOS / Windows / 其他）分文案给出可操作引导；新增 `setErrorMessage` 公共 action；外部气泡在 AI 请求失败且无内容兜底时渲染红框错误卡片，便于在收起态及时看到失败。`KnowClawFloating` 接入 Esc 层级 handler，按 `bubble → 截屏预览 → OCR 卡 → history/settings → expanded → vault（由父 FloatingMode 完成）→ 主台` 顺序逐层收起，并避开 IME composition。新增首次进入 KnowClaw 的一次性引导卡片（localStorage `ipm.fk7.knowclawOnboardingDone` 持久化，点击「知道了」永久消失）。新增 `desktop/Agent/FLOATING_KNOWCLAW_SMOKE_TEST.md` 25 条手动冒烟清单。lint 0 错误。进度看板 `PLANNED → DONE`。 |

---

## 6. 风险登记表

| ID | 风险 | 触发阶段 | 概率 | 影响 | 缓解 |
|----|------|---------|------|------|------|
| RW-FK-1 | 悬浮窗空间受限，对话多时滚动体验差 | FK3 | 中 | 中 | 内嵌列表用虚拟滚动；展开态高度可拉伸（最大 720px）；外部气泡作为长文回退路径 |
| RW-FK-2 | `_floating/` 在中台"被发现"链路不通 | FK6 | 中 | 中 | `listWorkspaces` 自动注入 + 标记 + pinned；FK6 验收强校验 |
| ~~RW-FK-3~~ | ~~复用 hook 引入 Backlog-D 未修 bug~~ | — | — | — | **已消除**：D.1~D.5 全部 DONE；悬浮窗使用独立 channel 不共享主台 hook |
| RW-FK-4 | macOS desktopCapturer 需屏幕录制权限 | FK4 | 中 | 中 | 首次触发检测权限并引导授权；失败降级为"手动截图（Win+Shift+S 后粘贴）" |
| RW-FK-5 | 双通道重构引入主台回归 bug | FK0 | 中 | 高 | 渐进式：channel 参数默认 `'main'`，不破坏现有调用；FK0 验收必须主台所有用例回归通过 |
| RW-FK-6 | Quick Action 误触导致非预期 API 调用 | FK4 | 低 | 中 | 截图后 3s 倒计时预览卡片可取消；后续 vision token 消耗有 toast 提示 |
| RW-FK-7 | 第二个 BrowserWindow（气泡）导致内存翻倍 | FK2 | 低 | 中 | 气泡窗口启动时即创建并保持 hide；不在每次回复时新建 |
| RW-FK-8 | 多屏 / DPI 缩放下气泡定位错位 | FK2 | 中 | 低 | 使用 `screen.getDisplayMatching(floatingRect)` 而非 primary display；DPI 由 BrowserWindow 自动处理 |
| RW-FK-9 | "回到空间"跳转时主台 KnowClaw 状态被覆盖 | FK6 | 低 | 中 | `forceSetCwd` 前 push `confirm` 选项（若主台当前有未完成 streaming） |

---

## 7. 总工期估算

| Phase | 工作量 | 累积 |
|-------|--------|------|
| FK0 双通道基础 | 1.5–2 天 | 2 天 |
| FK1 Rail + 缩略骨架 | 1.5–2 天 | 4 天 |
| FK2 外部大气泡 | 2–3 天 | 7 天 |
| FK3 内部展开视图 | 1.5–2 天 | 9 天 |
| FK4 智能截屏总结 | 2–3 天 | 12 天 |
| FK5 OCR 快捷提取 | 1–1.5 天 | 13.5 天 |
| FK6 回到空间 + 主台可见性 | 1–1.5 天 | 15 天 |
| FK7 UX 打磨与收尾 | 1–1.5 天 | 16.5 天 |
| **总计** | **12–17 天** | — |

---

## 8. 进度看板

| 阶段 | Status | 完成日期 | 备注 |
|------|--------|---------|------|
| FK0 — 双通道基础设施 | `DONE` | 2026-05-25 | `channels.{main,floating}` + `getChannel(payload)` 路由；`_floating/` 自动创建；`knowclawFloating` 命名空间；主台 100% 向后兼容。 |
| FK1 — Rail 入口 + 缩略骨架 | `DONE` | 2026-05-25 | `floating-knowclaw/` 新目录 + 4 个组件 + 1 个 hook；rail violet `Sparkles` 按钮；缩略输入态、Enter 发送、自定义滚动条与 demo 视觉一致。 |
| FK3 — 内部展开对话视图 | `DONE` | 2026-05-25 | `FloatingChatList` custom-light 消息列表 + `HistoryPanel` 会话历史抽屉 + `SettingsMenu` 设置浮层（模型+思考四档）；`useFloatingKnowClaw` 扩展 5 个 action + 2 个状态；展开态 480px minHeight。 |
| FK2 — 外部大气泡 + 自适应定位 | `DONE` | 2026-05-25 | `createBubbleWindow()` 独立 BrowserWindow + `repositionBubble()` D-FK-7 算法 + `bubble.js` IPC（show/hide/setContent/expandRequest）+ `BubbleView.jsx` 玻璃态气泡组件 + 气泡集成 useEffect + 全生命周期协调。 |
| FK4 — 智能截屏总结流程 | `DONE` | 2026-05-25 | `capture.js`（fullScreen + saveArtifacts + saveNote）+ `CapturePreviewCard`（手动发送，无倒计时）+ `useFloatingKnowClaw` capture 4 action + Vision 检测 + OCR 降级；BubbleView 增加「复制 OCR 原文」按钮（不展示全文 UI）；OCR 原文落盘 `_floating/captures/`。 |
| FK5 — OCR 快捷提取 | `DONE` | 2026-05-25 | `clipboard.js`（`getLatestImage`，120s TTL）+ `capture/saveNote` + `OcrResultCard` + `useFloatingKnowClaw` OCR 5 action + FloatingInput `injectText`；剪贴板优先 → 截屏 fallback；都失败显示 inline error chip 引导手动截图。 |
| FK6 — 回到空间 + 主台可见性 | `DONE` | 2026-05-25 | `ui/backToFloatingWorkspace` 请求-回执 IPC + `FloatingWorkspaceBridge` 桥接组件 + `_floating` 注入 `listWorkspaces` + `WorkspaceSelector` 紫色分组 + 「回到空间」+ Tray「发送给 AI 分析」上传到 `_floating` 并注入 `@relPath`，不自动发送。 |
| FK7 — UX 打磨与收尾 | `DONE` | 2026-05-25 | 全局 `fk-card-in/fk-fade-in/fk-mode-in` 动效统一；屏幕权限/AI 失败/Vision 降级错误态；Esc 层级 `bubble → preview/OCR → history/settings → expanded → vault → main`；KnowClaw 一次性引导卡片；新增 `FLOATING_KNOWCLAW_SMOKE_TEST.md`。 |

---

## 9. 升级后终态画像

1. **桌面 AI 伴侣可达**：任何时候按全局快捷键唤起悬浮窗，再按 `✦` 进入
   KnowClaw 模式，输入框 + 3 个快捷按钮即可起手；最常用的"截屏总结"路径
   ≤ 3 步。
2. **AI 回复不挤压悬浮窗**：默认回复以悬浮窗外部大气泡呈现，视觉上像悬浮
   窗在说话；位置自适应屏幕方位；需要长上下文时一键展开内部完整对话。
3. **截屏 + AI + OCR 一体化**：📷 按钮触发全屏截图 → AI 总结 + OCR raw 文本
   双管道；原图和 OCR 落到 `_floating/captures/`，事后可在中台查阅。
4. **会话与产物可逃逸**：`回到空间` 按钮无缝把悬浮窗 KnowClaw 会话搬到中台
   KnowClaw 页面，借助主台完整能力（Plan / sub-agent / 文件树）继续处理。
5. **与 Vault 模式平等共存**：悬浮窗 rail 上 `案件 / 项目 / 学习` 域和 `✦`
   AI 模式互斥但可一键切换；Vault 模式的拖拽分类 / 剪贴板捕获完全保留。

---

## 10. 文档变更日志

| 日期 | 变更 |
|------|------|
| 2026-05-25 | 从 `IPM_FEATURE_UPGRADE_PLAN.md` K3 拆出独立子计划文档；FK0~FK7 八阶段方案就绪；UI/UX 形态以 `k3-floating-knowclaw-demo.html` 为视觉真源 |
| 2026-05-25 | FK0 + FK1 实施完成并落地：`knowclaw.js` 双通道重构、`preload.js` 新增 `knowclawFloating` 命名空间、`floating-knowclaw/` 4 组件 1 hook 接入；`FloatingMode.jsx` 加 mode 切换 + rail AI 按钮；总改动 ~1050 行、lint 0 错误。进度看板对应阶段 `PLANNED → DONE`；FK0 / FK1 段落补完"实际实现要点"与"变更日志"。 |
| 2026-05-25 | FK3 + FK2 实施完成并落地（执行顺序调整为 FK3 先行 → FK2 后做）。FK3：新建 `FloatingChatList.jsx` / `HistoryPanel.jsx` / `SettingsMenu.jsx` 三个组件，`useFloatingKnowClaw.js` 扩展 5 个 action + 2 个状态，`FloatingHeader.jsx` 展开态历史按钮，`KnowClawFloating.jsx` 展开态插入 chat list + overlay 管理；~610 行新/改。FK2：`main.js` 新增 `createBubbleWindow()` + `repositionBubble()` + `screen` import + `moved`/`hide`/`closed` 事件协调，新建 `src/main/ipc/bubble.js`（4 IPC handler），`preload.js` 新增 `bubble` 命名空间，`App.jsx` `bubble` 路由，新建 `BubbleView.jsx` 玻璃态气泡组件，`useFloatingKnowClaw.js` 气泡集成 useEffect + expandRequest 回调，`FloatingMode.jsx` 模式切换 bubble 清理；~455 行新/改。总计 FK3+FK2 ~1065 行，lint 0 错误。进度看板 FK3/FK2 `PLANNED → DONE`。 |
| 2026-05-25 | FK6 + FK7 实施完成，K3 阶段全部交付。FK6：`ui/backToFloatingWorkspace` request/reply IPC 通道 + `FloatingWorkspaceBridge.jsx` 桥接组件（主台 streaming 时阻断并 toast）+ `listWorkspaces` 注入 `_floating` 条目 + `WorkspaceSelector` 紫色「悬浮助手」分组（顺序紧随 global） + `FloatingHeader/KnowClawFloating` 接线「回到空间」+ `TrayWidget` 增加「发送给 AI 分析」按钮（上传至 `_floating` 并通过 `pendingInjectText` 注入 `@relPath`，不自动发送）。FK7：`src/index.css` 三套统一动效（`fk-card-in/fk-fade-in/fk-mode-in`），`CapturePreviewCard/OcrResultCard/FloatingMode` 应用；屏幕录制权限按 macOS/Windows 分别给出可操作引导文案；外部气泡在 AI 请求失败且无内容时渲染错误卡片；`KnowClawFloating` 注册 Esc 内部级联 handler（bubble → 截屏预览 → OCR 卡 → history/settings → expanded），与 `FloatingMode` Esc handler 串联（避开 IME composition）；新增 KnowClaw 首次进入一次性引导卡片（localStorage 持久化）；新增 `desktop/Agent/FLOATING_KNOWCLAW_SMOKE_TEST.md` 25 条冒烟测试清单。lint 0 错误。 |
| 2026-05-25 | FK4 + FK5 实施完成。新增主进程模块：`src/main/ipc/capture.js`（fullScreen / saveArtifacts / saveNote）+ `src/main/ipc/clipboard.js`（getLatestImage，120s TTL）。`src/main.js` 注册新 IPC，新增 `getFloatingWorkspacePath()` helper，`pruneClipboardImageCache` TTL 60→120s。`preload.js` 新增 `window.ipm.capture.*`、`window.ipm.clipboard.getLatestImage`；`bubble.show/setContent` 第三参 `ocrText`。`bubble.js` 转发 ocrText。新增 UI 组件：`CapturePreviewCard.jsx`（手动发送，无倒计时）+ `OcrResultCard.jsx`（复制/追问/保存三按钮）。`useFloatingKnowClaw.js` `sendMessage(text, opts?)` 扩展支持 images / ocrText、新增 `capturePreview` + `ocrResultCard` 两个 state + 9 个 action + `floatingModelSupportsVision()` + `pngBufferToVisionPayload()`（基于 imageResize.js）+ `formatOcrQuoteBlock()`；OCR 在预览卡显示时后台并发执行。`FloatingInput.jsx` 改为 `forwardRef` 暴露 `injectText/appendText/focus/clear`，新增 `disabledQuickActions` prop。`BubbleView.jsx` 接收 ocrText 时底部加「复制 OCR 原文」按钮（不展示全文）。`KnowClawFloating.jsx` 渲染两张卡（互斥）+ 接 ref + onScreenshot/onOcr + disabledQuickActions。按用户确认：CapturePreviewCard 不做 3s 自动倒计时；OCR 全文不在 UI 展示（仅落盘 + 气泡复制按钮）；截屏始终主显示器；剪贴板 + 截屏都失败显示 inline error chip。Vision 模型自动检测，不支持时降级走 OCR 文本总结 + 提示。lint 0 错误。进度看板 FK4/FK5 `PLANNED → DONE`。 |

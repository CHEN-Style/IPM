# IPM 功能升级计划 · Feature Upgrade Plan

> 本文档承载 **2026-05-21 起** 用户提出的「后续新功能 / 功能升级」线，与
> [`IPM_CORE_UPGRADE_PLAN.md`](./IPM_CORE_UPGRADE_PLAN.md)（核心稳定性修复，W1–W4
> 已 DONE）并列、与 [`KNOWCLAW_UPGRADE_PLAN.md`](./KNOWCLAW_UPGRADE_PLAN.md)
> （KnowClaw 引擎迭代 U0–U8 已 DONE，U9+ 规划中）形成三套独立但互相引用的演进
> 主线。
>
> F1/F2/F3/K1/K2 已 `DONE`（K2 落地于 2026-05-23），F4 `DEFERRED`，K3 已完成（2026-05-25，FK0~FK7 全部交付）
> 架构设计升级为 `PLANNED`（2026-05-24）。

---

## 0. 阅读与维护说明

- **状态枚举**：`PLANNED`（已立项待启动）/ `RESEARCH`（待技术调研后再立项）
  / `IN_PROGRESS` / `DONE` / `DEFERRED`。
- **更新规则**：
  - 每完成一次用户对话决策（如选择候选方案 A/B），把答案落到对应阶段的「决策记录」。
  - 每完成一次代码改动，把摘要写到对应阶段的「变更日志」。
  - 不要直接删除"候选方案"段落，已被否决的方案改为 `~~删除线~~` + 否决理由。
- **与 KnowClaw 计划的边界**：
  - KnowClaw 引擎本体（pi runtime / prompt / 工具集 / 会话）→ 改 `KNOWCLAW_UPGRADE_PLAN.md`
  - 应用整体的新功能 / 文件管理 / 知识管理 / 悬浮窗扩展 / 跨模块联动 → 改本文档
- **文件位置**：`desktop/Agent/IPM_FEATURE_UPGRADE_PLAN.md`

---

## 1. 当前差距客观分析

### 1.1 用户提出的功能扩展点（2026-05-21）

| 编号 | 模块 | 核心诉求 | 一句话 |
|------|------|---------|--------|
| F1 | 文件管理 | 外部本地文件夹「附属导入」 | 不复制本地文件夹到数据存储区，而是创建"附属壳"，外挂链接 + 系统目录 + structure 扫描 + 实时联动 |
| F2 | 知识管理 | 网页完整信息抓取替代/升级 | 现有「网页剪藏」对代理 / JS 渲染 / 长页内容支持差，要换更稳更全的方案 |
| F3 | 知识管理 | 内置 OCR 能力 | 移植 PaddleOCR（已在 `mask-panjue-backend` 探索过的 ~80MB×2 模型），用于图片知识碎片 + OCR+LLM 摘要 |
| F4 | 知识管理 | 内置长截屏 | 应用内框选 → 自动滚动拼接 → OCR/LLM 读取内容 |
| K1 | KnowClaw | 网页搜索/抓取大幅升级 | `webTools.fetch_web` 在代理 / 反爬 / 404 等场景频繁失败，需要重做 |
| K2 | KnowClaw | 工作空间文件树侧栏 + 新文件高亮 | 对话产出文件后能在文件树中高亮、快速定位（与 `KNOWCLAW_UPGRADE_PLAN.md` § Phase U1.5 同诉求） |
| K3 | KnowClaw + 悬浮窗 | 悬浮窗模式接入 KnowClaw | 把悬浮窗变成「可随时唤起的 AI 助手」，有固定工作空间，产物可后续搬到中台需要的位置 |

### 1.2 优先级排序（初稿，待用户确认）

| 排序 | 阶段 | 估算工作量 | 排序理由 |
|------|------|----------|---------|
| 1 | **F1** 附属导入 | M-L | 高频痛点（"我已经有一堆文件夹"），且基础设施大部分复用 `localFolders.*` 现有 IPC，路径已经存在但被禁用 |
| 2 | **K1** 网页抓取稳定性 | M | 阻塞性 bug，影响 KnowClaw 日常可用性，且与 F2 可共享底层 |
| 3 | **F2** 网页完整抓取 | M | 与 K1 共底层，UI 端用户感知最强 |
| 4 | **F3** OCR | L | 资产 80MB×2，需要做技术选型 + 打包策略，独立研究阶段 |
| 5 | **K3** 悬浮窗 KnowClaw | L | 体验级强但需要先把 D.1/D.2 / Backlog-D 解决再做（避免在悬浮窗复刻已有 bug） |
| 6 | **F4** 长截屏 | M | 依赖 F3（OCR）才能闭环，优先级靠后 |
| 7 | **K2** 工作空间文件树 | M | 与 KnowClaw 计划 U1.5 重复，**等 KnowClaw 主线推进 U1.5 时合流** |

> ⚠ 上表为推荐序，最终顺序待用户确认。

---

## 2. 阶段总览

| 阶段 | 名称 | Status | 依赖 |
|------|------|--------|------|
| F1 | 外部文件夹「附属导入」 | `DONE` | 2026-05-22 完成。附属壳 + 双根路径解析 + 外部目录扫描 + 前端/后端限制一致性 |
| F2 | 网页完整信息抓取升级 | `DONE` | 2026-05-22 完成。Electron 隐藏窗口渲染 + HTTP 降级 + Markdown 转换 + 全页截图 + 截图管理 |
| F3 | 内置 OCR 能力（PP-OCRv5） | `DONE` | 2026-05-22 完成。`ppu-paddle-ocr` + `onnxruntime-node` 纯 Node.js 方案，中英双模型 |
| F4 | 内置长截屏 | `DEFERRED` | 短期不开发；F3 依赖已解除，后续可按需启动 |
| K1 | KnowClaw 网页搜索/抓取稳定性 | `DONE` | 2026-05-22 完成。博查 (Bocha) Web Search + F2 渲染抓取桥接 + 设置页 API Key 配置 + LLM 自然降级 |
| K2 | KnowClaw 工作空间文件树侧栏 + AI 过程可视化 | `DONE` | 2026-05-23 完成。右侧 `WorkspaceFileTree` 面板（树渲染 + 折叠 + 文件点击）、`knowclaw:listWorkspaceTree` IPC、`tool_execution_start` 路径提取 + 5s 新增/修改高亮、heartbeat 状态条（thinking / writing / tool）、30s 空闲倒计时。与 `KNOWCLAW_UPGRADE_PLAN.md` § Phase U1.5 同步交付 |
| K3 | 悬浮窗 KnowClaw 助手 | `DONE` (2026-05-25) | FK0~FK7 八阶段全部交付；冒烟清单见 [`FLOATING_KNOWCLAW_SMOKE_TEST.md`](./FLOATING_KNOWCLAW_SMOKE_TEST.md)；详见 [`FLOATING_KNOWCLAW_PLAN.md`](./FLOATING_KNOWCLAW_PLAN.md)；UI 参考 [`k3-floating-knowclaw-demo.html`](./k3-floating-knowclaw-demo.html) |

---

## 3. 各阶段详细计划

### Phase F1 — 外部文件夹「附属导入」

**Status:** `DONE`（2026-05-22）

**目标**：现有应用只支持把数据放进"数据存储位置"。让用户能**把已经存在于
其它路径下的本地文件夹挂载进来**，体验上接近一个原生项目，但**不复制文件**，
**不强制迁移**，本地变动能及时反映。

#### F1.1 用户原文（2026-05-21）

> 你应该能看到，在项目与案件中，有一个被禁用的导入本地按钮，目前的应用系统，
> 是只支持在设置中修改数据存储位置，然后在应用中新建项目，所有的数据都是保存
> 在设置好的数据存储位置。但现实中，很多用户反映他们自身已经有了很多文件夹
> 希望我们应用也支持一些外部位置的文件夹导入（非数据存储位置的路径中）。
> 我目前的想法是这样的，如果是导入文件夹，我们不复制该文件夹到数据存储位置中，
> 而是在数据存储位置创建一个"附属文件夹"，"附属文件夹"的作用，就是类似在应用
> 中新建项目一样存放那些系统文件夹（temp，meta 等等），然后会外挂一个链接指向
> 本地文件夹的位置，同时导入的时候也会彻底扫描一遍该文件夹的文件夹结构（不扫
> 文件）这样 structure 就有了，而且每次如果关闭应用后再次打开要重新扫一遍，
> 后面用户不管什么时候修改过本地文件夹的架构，我们的应用都能即使反应和更新，
> 用户如果要写文件夹的描述，也能记录在数据存储位置的系统文件夹里。这样几乎就
> 能做到原生的体验，而且知识碎片也可以做连接，如果本地文件夹有改动，碎片与
> 文件的关联消失也可以及时相应。

#### F1.2 现状锚点

| 模块 | 路径 | 现状 |
|------|------|------|
| 入口按钮（被禁用） | `desktop/src/ui/components/project-manager/HeaderBar.jsx` L405-412 | `disabled` + `title="正在开发中"`；说明设计期已预留位置 |
| 现有 hook（已可用但极简） | `desktop/src/ui/components/project-manager/hooks/useLocalFolders.js` | `localFolders.import/list/remove` IPC 已存在；当前导入仅"挂载浏览"，标语为「仅用于浏览/基础文件操作」 |
| 数据库表 | （未确认）需查 `meta/project.db` 是否已为 localFolders 建表，还是只在 `state.json` 里挂 |
| 文件夹保护逻辑 | `desktop/src/main.js` `isProtectedRelPath` / `isProtectedFolderNameRelPath` | 已经会保护 `meta` / `temp`，可以直接复用到附属壳里 |
| structure.json | `meta/structure.json` | 现有 schema 已支持任意 relPath 的描述 / 分类候选；F1 要扩展为可承载"非真实磁盘文件夹"的镜像节点 |

#### F1.3 核心设计（已确认）

**1) "附属壳"目录结构**

数据存储区 `userfile/projects/<壳名>/` 下创建：

```
userfile/projects/<壳名>/
  meta/
    project.db                      # 同普通项目（suggestions / source_records / knowledge_items）
    structure.json                  # 镜像外部目录结构 + 用户写的描述
    external-link.json (新增)       # { schemaVersion, rootPath, importedAt, lastScanAt, broken, brokenReason }
    (无 classify-rules.json)       # 决策 D-F1-7：不支持硬规则
    (无 preferences.json)           # 决策 D-F1-7：不支持软偏好
  temp/                             # AI 分类暂存区（在壳内）
  snippets/                         # 知识碎片存储（在壳内）
  (无业务文件夹；业务文件全部在外部根路径)
```

**2) 双根路径解析模型（核心架构）**

引入 `resolveContentPath(projectDir, relPath)` 函数：
- 系统路径（`temp/`、`snippets/`、`meta/`）→ 壳内目录
- 业务路径 → 外部根目录（从 `external-link.json` 的 `rootPath` 读取）
- 原生项目 → 全部壳内（行为不变）

所有 explorer/aiStorage/KnowClaw 文件操作统一经由此函数解析物理路径。

**3) 外部目录扫描**

- 入口：`projects/importAttached` IPC
- 时机：首次导入全量扫 + 每次应用启动增量重扫 + 用户手动刷新
- 只扫文件夹（不扫文件），深度限制 `maxDepth=20`
- 扫描逻辑（`syncStructureFromExternal`）：
  - 磁盘存在但 structure 无记录 → 新增条目（空 description）
  - structure 有记录但磁盘不存在 → 直接删除条目（description 丢失可接受）
  - 两者匹配 → 保留 description 等 metadata
- **禁用**原版 `syncStructureJson`（该函数扫描壳目录会摧毁外部镜像数据）

**4) 智能分类**

- 外部文件夹自动成为分类候选目标（已在 structure.json 中）
- AI accept 从 `temp/`（壳内）移动文件到外部目录：用 `copyFileSync + unlinkSync`（跨盘安全）
- 不创建/不支持 `classify-rules.json` 和 `preferences.json`
- 分类完全依赖 LLM Agent 推理 + structure.json 的 folder description

**5) 知识碎片**

- ~~知识碎片文件关联~~ → **不开放**（`knowledge/addLink` 对附属壳返回拒绝）
- 碎片收集正常（snippet/截图/note/webclip 存壳内 `snippets/`）

**6) KnowClaw 工作空间**

- `listWorkspaces` 对附属壳返回 `path = externalRootPath`（而非壳目录）
- Agent 工具（`ls`/`read`/`write`）操作外部业务文件夹 = 符合用户预期

#### F1.4 已回答的问题

- [x] **D-F1-1**：与项目/案件同级，带角标
- [x] **D-F1-2**：允许读写
- [x] **D-F1-3**：启动时 + 手动刷新，不做 fs.watch
- [x] **D-F1-4**：保留壳 + 红色警告 + 重新定位功能
- [x] **D-F1-5**：暂不支持反向变换
- [x] **D-F1-6**：导入时自动加 `(外部)` 后缀避免同名
- [x] **D-F1-7**：不支持硬规则/软偏好
- [x] **D-F1-8**：碎片仅收集，不开放 addLink
- [x] **D-F1-9**：stale 条目直接删除
- [x] **D-F1-10**：域归属跟随当前页

#### F1.5 风险（详见 § 4 风险登记表）

- RW-F1-1：外部目录被外部进程占用 / 权限不足 → 扫描失败
- RW-F1-2：`fs.watch` 跨平台行为差异大（Win 文件锁 / mac fsevents / Linux inotify limits）
- RW-F1-3：扫描大目录卡 UI（万级文件夹）→ 需要分批 + 进度条
- RW-F1-4：与现有 `localFolders` 浏览模式的语义混淆 → 命名 + UI 区分清楚

#### F1.6 决策记录

| 编号 | 决策 | 结论 | 日期 |
|------|------|------|------|
| D-F1-1 | 归属域 | 与项目/案件同级，在对应列表中带角标显示（「外挂」badge） | 2026-05-21 |
| D-F1-2 | 外部目录写权限 | 允许读写（AI 分类可写入外部目录、可在外部目录新建文件夹） | 2026-05-21 |
| D-F1-3 | 扫描频率 | 仅应用启动时 + 用户手动点刷新按钮（不做 fs.watch）| 2026-05-21 |
| D-F1-4 | 外部根路径断裂 | 保留壳 + 红色警告；提供「重新定位」功能，强提示可能数据不一致 | 2026-05-21 |
| D-F1-5 | 普通项目反向变附属壳 | 暂不支持 | 2026-05-21 |
| D-F1-6 | 壳与项目同名 | 导入时检测同名 → 自动加 `(外部)` 后缀 | 2026-05-21 |
| D-F1-7 | 智能分类 | 参与但受限 — 不支持硬规则/软偏好，仅 LLM Agent 推理 + description | 2026-05-21 |
| D-F1-8 | 知识碎片 | 仅收集（snippet/截图/note/webclip 存壳内 snippets/）— 不开放文件关联（addLink 禁止） | 2026-05-21 |
| D-F1-9 | stale 子目录处理 | 扫描时直接删除 structure.json 中磁盘不存在的条目（description 丢失可接受） | 2026-05-21 |
| D-F1-10 | 域归属 | 跟随当前所在页（项目页导入归项目列表，案件页导入归案件列表） | 2026-05-21 |

**架构级问题（代码审查发现，2026-05-21）**：

| ID | 问题 | 严重程度 | 解决方案 |
|----|------|---------|---------|
| P0-1 | `syncStructureJson` 扫描壳目录会摧毁外部镜像数据（7+ 处调用） | 系统崩溃 | 新增 `syncStructureFromExternal`；所有调用点加分流 |
| P0-2 | `aiStorage/accept` 的 `resolveInside(projectDir, targetRel)` 对附属壳解析到不存在的壳内路径 | 功能断裂 | 引入 `resolveContentPath` 双根解析 + copy+unlink 跨盘移动 |
| P1-3 | KnowClaw Agent cwd 指向壳目录 → 看不到外部业务文件 | 功能断裂 | `listWorkspaces` 对附属壳返回 `externalRootPath` |
| P1-4 | 删除附属壳的确认文案误导用户（说"删除所有内容"实际只删壳） | 用户误解 | 前端按 attached 标记切换确认文案 |

**核心设计模型**：引入 `resolveContentPath(projectDir, relPath)` 双根路径解析函数，系统路径（temp/snippets/meta）指向壳内，业务路径指向外部根。所有 explorer/aiStorage/KnowClaw 文件操作统一经由此函数。

> 详细实施计划见 `.cursor/plans/f1_附属导入开发_add03a76.plan.md`

#### F1.7 变更日志

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-21 | 立项 | F1 核心设计草案 + 6 个待决策问题 |
| 2026-05-21 | 决策确认 | 用户回答 D-F1-1 ~ D-F1-10 全部确认 |
| 2026-05-21 | 架构审查 | 深入代码审查发现 4 个系统稳定性重大问题（P0-1/P0-2/P1-3/P1-4），引入双根路径解析模型 |
| 2026-05-22 | 计划更新 | 将架构问题和解决方案整合到详细实施计划 |
| 2026-05-22 | **实施完成** | 全部 F1 功能落地：附属壳创建 + `external-link.json` + `syncStructureFromExternal` 增量扫描 + `resolveContentPath` 双根路径解析 + 前端 UI（导入/刷新/重新定位按钮、外挂 badge、路径失效红色标记）+ 后端 guard（硬规则/软偏好/知识碎片关联全部禁用）+ KnowClaw 工作空间正确指向外部根 |
| 2026-05-22 | 修复 | 用户测试反馈：导入外部文件仍可见偏好/记录按钮、仍可创建硬规则、知识管理可做关联 → 全面修复前端条件渲染 + 后端 `guardAttached` 检查 |

---

### Phase F2 — 网页完整信息抓取升级

**Status:** `DONE`（2026-05-22）

**目标**：彻底替换 / 升级现有「网页剪藏」，让用户能稳定、完整地抓取任意网页
（含登录态、JS 动态渲染、滚动加载）的可读内容。

#### F2.1 用户原文（2026-05-21）

> 知识管理中有一个网页剪藏的功能，实测下来这个功能很差，有的时候又会因为各种
> 代理或其他原因获取失败，获取到的网页内容也十分有限，很多东西和文字都获取不到，
> 所以我们需要讨论出一个更好的解决方案，能够让用户获取某个网页中的完整信息。

#### F2.2 现状锚点

| 路径 | 当前做法 | 局限 |
|------|---------|------|
| `desktop/Agent/services/webclip.js` | `fetch(url)` + JSDOM + Readability | 不能跑 JS、不能复用浏览器 cookie / 代理；30s 超时；SPA 站点几乎全军覆没 |
| `desktop/Agent/pi-runtime/tools/webTools.js` `fetch_web` | 同样 `fetch` + 简单 strip HTML | 同上；和 `webclip.js` 是两条重复实现 |

#### F2.3 候选方案

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A · Electron 隐藏窗口渲染** | 主进程开一个 `BrowserWindow({show:false})` 加载 URL，等 `did-finish-load` + 自定义 ready 信号后 `webContents.executeJavaScript` 抽取 DOM | 完美支持 JS 渲染、可复用系统代理、零外部依赖；可触发滚动 → 配合 F4 | 单页同时太多会吃内存；某些站点检测 headless |
| **B · 内置真实浏览器视图（用户登录态）** | 给用户一个 BrowserView 让 ta 在应用内"浏览这个网页"，看到内容后点"剪藏当前页面" | 完美解决登录态 + 验证码；体验近似 OneNote/Notion Web Clipper | UI 工作量大；需要一套独立浏览器小窗 |
| **C · 嵌入 Puppeteer / Playwright** | 打包 / 按需下载 chromium，跑 headless 浏览器 | 抓取最强；可做高级 wait selector / 滚动 | 安装包增量 100MB+；跨平台二进制部署复杂 |
| **D · 用户浏览器扩展通道** | 提供 Chrome/Edge 浏览器扩展，用户在浏览器里点扩展按钮，扩展把当前 tab 的 DOM 发给桌面应用 | 100% 用户登录态 + 0% 反爬 | 需要单独维护扩展商店 / 安装链路 |
| **E · 外部 API 桥接** | 接入 Diffbot / Mercury Parser / Jina Reader 等第三方抓取 API | 零运维 | 数据出境 / 成本 / 依赖第三方稳定性 |

> **倾向（待用户确认）**：A + B 组合。A 解决普通公开网页 90% 场景；B 兜底解决
> 登录态/复杂交互。C/D/E 作为后续可选。

#### F2.4 待回答的问题

- [ ] **D-F2-1**：用户对"数据出境"是否敏感？是否允许 E 方案的第三方 API？
- [ ] **D-F2-2**：是否接受打包 100MB+ chromium（方案 C）？
- [ ] **D-F2-3**：剪藏后存哪里：当前项目的 `snippets/`？知识库的 `webclips/` 域？还是用户在弹窗里现选目标位置？
- [ ] **D-F2-4**：剪藏的内容格式：HTML 原样 / Readability 提取 / Markdown 转换 / 截图 + 文字混合？
- [ ] **D-F2-5**：与 F4（长截屏）的关系：是同一入口（用户选"剪藏 / 长截屏 / 二合一"）还是两个独立功能？

#### F2.5 风险

- RW-F2-1：方案 A 隐藏窗口可能被站点检测 → 加 UA 伪装 / 等待时间随机化
- RW-F2-2：剪藏内容版权 / 法律风险（特别是案件场景）→ UI 加显式提示，记录抓取时间戳
- RW-F2-3：与 K1 重复造轮子 → 必须在统一服务（`desktop/Agent/services/webFetch.js`）下实现

#### F2.6 决策记录

| 编号 | 决策 | 结论 | 日期 |
|------|------|------|------|
| D-F2-1 | 数据出境 | 不使用第三方 API，全部本地处理 | 2026-05-22 |
| D-F2-2 | 打包 chromium | 不打包——复用 Electron 自带 BrowserWindow 渲染 | 2026-05-22 |
| D-F2-3 | 存储位置 | 当前项目的 `snippets/` 知识碎片体系 | 2026-05-22 |
| D-F2-4 | 内容格式 | Markdown（通过 turndown 转换）+ 全页截图 | 2026-05-22 |
| D-F2-5 | 与 F4 关系 | 两个独立功能，F2 仅做全页截图不做长截屏 | 2026-05-22 |

**实现方案：A + B 组合（隐藏 BrowserWindow + HTTP 降级）**

核心架构：`desktop/Agent/services/webFetch.js` 统一入口
- `fetchRendered`：隐藏 `BrowserWindow` 加载 URL → 自动滚动触发懒加载 → `@mozilla/readability` 提取正文 → `turndown` 转 Markdown → `capturePage` 全页截图
- `fetchSimple`：HTTP + JSDOM 降级回退（30s 超时 / 连接失败时触发）
- `fetchWeb`：自动模式编排（先 render 后降级，支持 `mode='auto'|'render'|'http'`）
- 并发控制：`BrowserWindow` 池 `MAX_CONCURRENT_RENDERS = 2`

新增依赖：`turndown@^7.2.4`

#### F2.7 变更日志

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-22 | **实施完成** | 新建 `Agent/services/webFetch.js`（统一 web 抓取服务）；修改 `knowledge/createWebclip` IPC 使用 `fetchWeb`；新增 `knowledge/removeWebclipImage` IPC（截图删除）；KnowledgeDetailPanel 增加 lightbox（缩放/下载/删除截图）；preload 暴露新 API |
| 2026-05-22 | 修复 | 用户反馈截图无法查看/缩放/保存 → 实现完整 lightbox 功能（鼠标滚轮缩放 + ZoomIn/ZoomOut 按钮 + 另存为 + 删除） |

---

### Phase F3 — 内置 OCR 能力（PP-OCRv5）

**Status:** `DONE`（2026-05-22）

**目标**：让应用具备**离线轻量**的 OCR 能力，覆盖（a）图片知识碎片入库时
自动识别文字、（b）OCR+LLM 总结精简、（c）F4 长截屏识别。

#### F3.1 用户原文（2026-05-21）

> 我们的应用急需接入 ocr 功能，之前我对 paddle ocr 有过一定的探索，你可以浏览
> `d:\proj-production\mask-panjue-backend` 这个应用，我有下载 2 个 80m 左右的
> ocr 模型，用它来识别文字以及行级元素，我们需要探讨是否有可能把这个 ocr 的
> 解决方案也移植到我们应用中，使得可以轻量化解决简单的 ocr 识别场景。以及收集
> 图片类型的知识碎片的时候，能够调用 OCR+LLM 识别内容+总结精简。

#### F3.2 现状锚点

| 来源 | 说明 |
|------|------|
| 外部参考项目 | `d:\proj-production\mask-panjue-backend` — 已实测 PaddleOCR + 2 个 ~80MB 模型，能识别文字与行级元素 |
| IPM 现状 | 无 OCR；图片知识碎片只存原图 + 用户手动 caption（待确认）|
| Python 运行时 | KnowClaw skills 已经依赖 Python（pdf/docx/pptx 几个 skill），见 `desktop/Agent/pi-runtime/skills/*` |

#### F3.3 技术选型决策

经评估 4 种候选方案后选定 **方案 A：`ppu-paddle-ocr` + `onnxruntime-node`（纯 Node.js）**。

| 路径 | 描述 | 判定 |
|------|------|------|
| **A · `ppu-paddle-ocr` + `onnxruntime-node`** | 纯 Node.js，PP-OCRv5 mobile 模型通过 ONNX Runtime 推理 | **✅ 选中** — 零 Python 依赖、~28MB 模型、跨平台一致 |
| ~~B · Python 子进程 + PaddleOCR~~ | 复用 skill Python 环境 | 否决 — 需额外 Python 运行时、环境差异大、启动慢 |
| ~~C · Tesseract.js~~ | 纯 JS 方案 | 否决 — 中文识别质量明显弱于 PaddleOCR |
| ~~D · 系统级 OCR~~ | Win.Media.Ocr / macOS Vision | 否决 — 能力弱、跨平台不一致 |

**选型理由**：`ppu-paddle-ocr` v5.4.x 封装了 PP-OCRv5 的完整检测+识别流水线，底层使用 `onnxruntime-node` 做推理。不需要 Python 环境、不需要 PaddlePaddle 框架，模型文件仅 ~28MB（含检测+中文识别+英文识别+字典），CPU 推理即可满足单张图片亚秒级识别。Windows/macOS/Linux 均通过 `onnxruntime-node` 的 prebuilt 二进制实现跨平台一致性。

#### F3.4 核心设计（已实现）

**1) 模型分发策略**

- **PP-OCRv5 mobile 模型集**（共 ~28MB）：
  - 检测模型：`PP-OCRv5_mobile_det.onnx`（~4MB，中英共用）
  - 中文识别模型：`PP-OCRv5_mobile_rec.onnx`（~13MB）+ `ppocr_keys_v1.txt` 字典
  - 英文识别模型：`en_PP-OCRv4_rec.onnx`（~10MB）+ `en_dict.txt` 字典
- **开发环境**：通过 `npm run setup:ocr`（`scripts/setup-ocr-models.mjs`）从 GitHub 下载模型到 `desktop/models/ocr/`
- **生产打包**：`forge.config.js` 的 `packageAfterCopy` 钩子将 `models/ocr/` 复制到打包后的 `resources/models/ocr/`
- `.gitignore` 已添加 `/models/ocr/`，模型二进制不入版本控制

**2) OCR 服务层（`Agent/services/ocrService.js`）**

- **单例模式**：全局唯一实例，通过 `getOcrService()` 获取
- **懒加载**：`ppu-paddle-ocr` 和 `onnxruntime-node` 在首次 OCR 请求时才动态 `require()`，不影响应用启动性能
- **中英双模型切换**：共用一个 detection 模型，recognition 模型按 `lang='ch'|'en'` 动态切换，切换时只重建 recognizer 不重建 detector
- **空闲自动释放**：5 分钟无 OCR 请求自动销毁 ONNX session，释放内存（约 200-400MB）
- **操作串行化**：通过 Promise 链保证同一时刻只有一个 OCR 操作在执行，避免竞态条件
- **模型路径解析**：自动识别开发模式（`desktop/models/ocr/`）和打包模式（`resources/models/ocr/`）

**3) IPC 通道**

| 通道 | 方向 | 功能 |
|------|------|------|
| `ocr/recognize` | renderer → main | 从文件路径识别，支持 `lang` 参数 |
| `ocr/recognizeBuffer` | renderer → main | 从 Buffer 识别，支持 `lang` 参数 |
| `ocr/status` | renderer → main | 查询 OCR 服务状态（是否初始化、当前语言、模型路径） |
| `knowledge/runOcr` | renderer → main | 对已有知识碎片手动触发 OCR（支持 screenshot 和 webclip） |

**4) 知识碎片集成**

- **截图入库时**：`CreateKnowledgeModal` 弹窗中新增 OCR 选项（跳过/中文/英文），确认后 `knowledge/create` 在后台自动执行 OCR
- **网页剪藏时**：`knowledge/createWebclip` 自动对全页截图执行 OCR（默认中文）
- **OCR 结果存储**：
  - 原始碎片的 `content_json` 更新 `ocrResult`（含 `lang`、`avgScore`、`lineCount`、`charCount`、`ocrChildItemId`）
  - 自动创建一个 **snippet 类型**的关联碎片，存储完整 OCR 文本（`.txt` 文件在 `snippets/` 目录）
  - 双向关联：原始碎片 → snippet（`ocrChildItemId`），snippet → 原始碎片（`ocrSourceItemId`）
- **手动重新识别**：`KnowledgeDetailPanel` 中的"识别(中文)"/"EN" 按钮可对已有 screenshot/webclip 碎片手动触发 OCR

**5) 前端 UI**

- `CreateKnowledgeModal.jsx`：截图入库时新增 OCR 语言三选一（跳过/中文/英文）
- `KnowledgeDetailPanel.jsx`：
  - 已识别：显示"已识别"badge + 语言 + 置信度 + 已生成文本碎片提示
  - 识别文本预览：折叠/展开显示完整 OCR 文本
  - 手动触发按钮："识别(中文)" / "EN"（支持 screenshot 和 webclip 类型）
  - 识别中状态：loading spinner + "正在识别..."文字

#### F3.5 决策记录

| 编号 | 决策 | 结论 | 日期 |
|------|------|------|------|
| D-F3-1 | 打包体积 | 接受 +28MB（PP-OCRv5 mobile 模型），远小于原估算的 160MB | 2026-05-22 |
| D-F3-2 | 执行方式 | 纯 Node.js（`ppu-paddle-ocr` + `onnxruntime-node`），不依赖 Python | 2026-05-22 |
| D-F3-3 | 模型选择 | PP-OCRv5 mobile（速度优先，精度已足够日常场景）| 2026-05-22 |
| D-F3-4 | 入库行为 | 截图入库时弹窗让用户选择（跳过/中文/英文）；网页剪藏自动执行 | 2026-05-22 |
| D-F3-5 | 识别结果 | 自动创建 snippet 类型碎片存储完整文本，与原始碎片双向关联 | 2026-05-22 |

#### F3.6 技术问题已解决

| 编号 | 问题 | 解决方案 |
|------|------|---------|
| R-F3-1 | 模型分发 | 开发用 `setup-ocr-models.mjs` 脚本下载；生产用 `forge.config.js` `packageAfterCopy` 钩子打包 |
| R-F3-2 | 执行方式 | 纯 Node.js，`onnxruntime-node` 在 Electron 中无需额外运行时 |
| R-F3-3 | CPU 性能 | PP-OCRv5 mobile 在普通笔记本 CPU 上单张图片识别 <1s |
| R-F3-4 | 跨平台 | `onnxruntime-node` 提供 Windows/macOS/Linux prebuilt 二进制 |
| R-F3-5 | LLM 协同 | OCR 文本存入 snippet 碎片后可供 LLM 检索和摘要（后续集成） |
| R-F3-6 | 调用入口 | 三个入口：截图入库弹窗选择 + 网页剪藏自动 + 详情面板手动触发 |

#### F3.7 风险（已缓解）

| ID | 风险 | 缓解措施 |
|----|------|---------|
| RW-F3-1 | 模型分发/升级 | 开发用脚本下载 + 生产用 Forge 钩子打包，升级时替换模型文件即可 |
| RW-F3-2 | ~~Python 环境差异~~ | 已消除 — 纯 Node.js 方案无需 Python |
| RW-F3-3 | OCR 出错率 | UI 显示置信度分数，碎片类型标记为"OCR 识别文本" |
| RW-F3-4 | 内存占用 | 5 分钟空闲自动释放 ONNX session；懒加载避免启动时占用 |
| RW-F3-5 | `onnxruntime-node` DLL 初始化失败 | 仅影响裸 Node.js 环境（缺 VC++ 运行时）；Electron 打包环境自带兼容 C++ 运行时，不受影响 |

#### F3.8 涉及文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 新增 `ppu-paddle-ocr`、`onnxruntime-node` 依赖 + `setup:ocr` 脚本 |
| `forge.config.js` | 修改 | `VITE_EXTERNALS` 新增 4 个原生模块 + `packageAfterCopy` 模型复制钩子 |
| `vite.main.config.mjs` | 修改 | `rollupOptions.external` 新增 4 个原生模块 |
| `.gitignore` | 修改 | 新增 `/models/ocr/` |
| `scripts/setup-ocr-models.mjs` | **新建** | OCR 模型下载脚本（从 GitHub 拉取 PP-OCRv5 模型） |
| `Agent/services/ocrService.js` | **新建** | OCR 服务单例（懒加载 + 中英切换 + 空闲释放 + 串行化） |
| `src/main/ipc/ocr.js` | **新建** | OCR IPC 处理器（recognize / recognizeBuffer / status） |
| `src/main.js` | 修改 | 注册 OCR IPC + app quit 时调用 `ocrService.shutdown()` |
| `src/preload.js` | 修改 | 暴露 `ocr.*` 和 `knowledge.runOcr` API |
| `src/main/ipc/knowledge.js` | 修改 | `runOcrInBackground` 助手函数 + 截图/剪藏 OCR 集成 + `knowledge/runOcr` IPC |
| `src/ui/components/project-manager/CreateKnowledgeModal.jsx` | 修改 | 截图入库 OCR 选项 UI |
| `src/ui/components/knowledge/KnowledgeDetailPanel.jsx` | 修改 | OCR 结果显示 + 手动触发按钮 |

#### F3.9 变更日志

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-21 | 立项 | F3 初始需求记录 + 4 种候选方案 |
| 2026-05-22 | 技术选型 | 评估 4 种方案，确定方案 A（`ppu-paddle-ocr` + `onnxruntime-node`） |
| 2026-05-22 | 详细计划 | 8 步实施计划制定完成 |
| 2026-05-22 | **实施完成** | 全部 8 步落地：依赖安装 + 构建配置 → 模型下载脚本 → OCR 服务层 → IPC 处理器 → preload 暴露 → knowledge.js 集成（截图+剪藏+手动触发 + snippet 碎片创建） → 前端入库弹窗 OCR 选项 → 详情面板 OCR 结果显示/手动触发 |
| 2026-05-22 | 修复 | `CreateKnowledgeModal` 中 `pngBuffer` 未正确传递到后端 → 修复 ArrayBuffer → Uint8Array 转换 |
| 2026-05-22 | 确认 | `onnxruntime-node` DLL 初始化失败为裸 Node.js 环境特有问题，Electron 打包环境不受影响；验证应用正常启动 |
| 2026-05-22 | **修复** | Electron 中 `onnxruntime-node` 原生 `.node` DLL 与 Electron 不兼容 → 新增 `scripts/patch-onnxruntime.mjs` 将 `onnxruntime-node` shim 为 `onnxruntime-web`（WASM 后端）；`ocrService.js` 执行提供程序改为 `wasm` + 配置 WASM 路径；`package.json` 新增 `postinstall` 自动 patch |

---

### Phase F4 — 内置长截屏

**Status:** `DEFERRED`（2026-05-22 用户决策：短期不开发）

**目标**：让用户能在应用内完成"长截屏"：框选区域 → 下拉滚动 → 自动拼接整页
图 → 可选 OCR + LLM 解读 → 作为知识碎片 / 文件入库。

#### F4.1 用户原文（2026-05-21）

> 是否能开发一个内置的截长屏的功能，比如用户想把某个很长的网页整个截屏下来，
> 我们应用允许框定一块区域，然后用户下拉页面可以自动把所有内容截屏，再结合 OCR
> 或 LLM 去读取内容。

#### F4.2 现状锚点

- IPM 当前已有**普通截图**捕获能力（悬浮窗的截图记录 / `screenshots-record.json`）
- 长截屏 / 滚动截屏 = 0

#### F4.3 候选方案

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A · 仅"应用内嵌浏览器"长截屏** | 用户在应用内的浏览视图打开某网页（与 F2-B 一致），通过 `webContents.capturePage` 分段截图 + 滚动 + 拼接 | 边界清晰、跨平台一致 | 不能截"应用之外的任意窗口" |
| **B · 系统级长截屏** | 用户框选屏幕区域，应用监听该区域的滚动事件（实际为定期截屏 + 视觉差比对 + 拼接） | 适用任意应用窗口 | 拼接算法复杂、对滚动平滑度敏感 |
| **C · A + 浏览器扩展** | A 方案 + 用户也可以在自己的 Chrome 里用扩展触发长截屏，结果发给桌面应用 | 用户登录态友好 | 与 F2-D 同问题 |

> **倾向**：A 优先；B 作为后续 P2。

#### F4.4 待回答的问题

- [ ] **D-F4-1**：是否限定"长截屏"必须发生在应用内嵌浏览器里？（vs 任意窗口）
- [ ] **D-F4-2**：输出物：单张拼接长图 / 多段图片 + Markdown / OCR 文字稿 / 三者并存？
- [ ] **D-F4-3**：与 F3 OCR 的关系：长截屏完成后**默认**跑 OCR？或在结果页让用户选？
- [ ] **D-F4-4**：长图最大尺寸 / 拼接失败的兜底策略？

#### F4.5 风险

- RW-F4-1：方案 B 拼接算法（image stitching）实现复杂度高
- RW-F4-2：长图 >10MB 时存储与检索的成本

---

### Phase K1 — KnowClaw 网页搜索 / 抓取稳定性大幅升级

**Status:** `DONE`（2026-05-22）

**目标**：解决 KnowClaw 内置的网页搜索 / 抓取在代理 / 反爬 / 404 等场景的高
失败率，并补齐"主动联网搜索"能力。

#### K1.1 用户原文（2026-05-21）

> 目前 KnowClaw 内置的网页搜索功能非常不稳定，代理或者其他情况会经常出现 404
> 或完全无法访问的错误，这个功能需要大幅度的升级。

#### K1.2 调研结论（2026-05-22）

业界（Claude / OpenAI / Gemini）的"联网搜索"均为厂商私有工具，**对外不可独立
调用**。可用的独立搜索 API 包括 Tavily / Brave / Exa（海外）与 博查 (Bocha) /
百度千帆 / 秘塔（国内）。综合"中文优化、合规、价格、是否专为 AI Agent 设计"
四项指标，选择 **博查 Web Search API** 作为 K1 的主搜索引擎：

- 接口：`POST https://api.bochaai.com/v1/web-search`，Bearer auth
- 价格：新用户 1000 次免费额度，之后约 ¥0.036/次
- 生态：DeepSeek 官方联网搜索供应方，阿里/腾讯/字节官方推荐
- 合规：数据不出海，符合国内安全规范

#### K1.3 架构（已实施）

1. **`search_web` 工具（新增）** — 走博查 API，返回结构化搜索结果（标题 / URL /
   摘要 / 来源 / 发布日期）；API Key 由用户在「设置 → 网页搜索 API」中配置。
2. **`fetch_web` 工具（升级）** — 新增 `rendered: true` 参数，走 F2 的
   `webFetch.fetchWeb`（隐藏 BrowserWindow + Readability + Markdown）。
   默认 `false` 时仍走轻量 Node fetch，保持原速度优势。
3. **降级链路** — 搜索 API 未配置 / 额度不足 / 网络失败时，工具返回**带可读
   降级说明的文本**，由 LLM 自然引导用户提供具体 URL，再用 `fetch_web` 抓取。
   `fetch_web` 的 `rendered: true` 模式失败时自动 fallback 到 Node fetch。
4. **配置存储** — `state.prefs.searchApi: { provider: 'bocha', apiKey }`，
   通过 `prefs/get` / `prefs/set` IPC 持久化；pi-runtime 通过
   `ipmConfig.getSearchApiConfig()` 读取，注入 `buildWebTools`。配置变更在
   下次新建 / 打开会话时生效（与 LLM 配置同机制）。

#### K1.4 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `Agent/services/searchService.js` | 新建 | 博查 API 封装 (`bochaWebSearch` + `testBochaApiKey`) |
| `Agent/pi-runtime/tools/webTools.js` | 重写 | `search_web` 新增 + `fetch_web` 增加 `rendered` 参数 |
| `Agent/pi-runtime/ipmConfig.js` | 修改 | 新增 `getSearchApiConfig()` / `describeSearchApiConfig()` |
| `Agent/pi-runtime/bootstrap.js` | 修改 | 把 `searchApiKey` + `fetchWebRendered` 注入 `buildWebTools` |
| `Agent/pi-runtime/promptBuilder.js` | 修改 | 修正 `web_fetch` → `fetch_web` 笔误 |
| `src/main/ipc/prefs.js` | 修改 | `searchApi` 字段持久化 + `prefs/testSearchApi` IPC |
| `src/main/ipc/knowclaw.js` | 修改 | `toolDeps.fetchWebRendered` 桥接到主进程 `webFetch.fetchWeb` |
| `src/preload.js` | 修改 | 暴露 `prefs.testSearchApi` |
| `src/ui/components/SettingsPage.jsx` | 修改 | 新增「网页搜索 API」配置卡片 |

#### K1.5 决策记录

- **D-K1-1（已答）**：使用第三方搜索 API（博查），新用户免费 1000 次，
  生产用按量付费。API Key 由用户在设置中自配置。
- **D-K1-2（已答）**：与 F2 **共用底层**——`search_web` 提供 URL，`fetch_web`
  的 `rendered: true` 复用 F2 `webFetch.js` 的 BrowserWindow 渲染管道。
- **D-K1-3（已答）**：不在工具层做"自动重试"。失败时返回降级说明文本，由 LLM
  根据上下文自主决定（请求用户提供 URL / 换关键词 / 放弃）。
- **D-K1-4（未来）**：是否要接 Tavily / Brave 作为英文搜索补充？目前 KnowClaw
  以中文场景为主，博查中文优化足够；待用户提出英文场景再扩展。

#### K1.6 变更日志

- 2026-05-22 完成 K1 全部 8 个文件改动：
  - `searchService.js` 实现博查 API 调用 + 错误分类（unauthorized / quota /
    timeout / network / parse / unknown），支持 AbortSignal 链。
  - `webTools.js` 重写为 `buildWebTools({ searchApiKey, fetchWebRendered })`，
    `search_web` 与 `fetch_web` 二者均带 promptGuidelines 引导 LLM 正确使用
    与降级。
  - `fetch_web` 新增 `rendered` 参数，rendered=true 通过 toolDeps 桥接
    到主进程 `webFetch.fetchWeb`，桥接不可用 / 渲染失败时自动降级到 Node fetch
    并在结果前注明 fallback 原因，**保证 LLM 永远拿得到内容**。
  - SettingsPage 新增 `SearchApiCard`：API Key 输入 + 保存 + 测试连接 +
    新用户引导（链接到 open.bochaai.com）+ 未配置黄色提示。
  - `bootstrap.js` 在工具注册日志中打印 `searchApi=bocha/sk-xxxx…xxxx` 与
    `renderedBridge=yes/no`，方便诊断。

---

### Phase K2 — KnowClaw 工作空间文件树侧栏 + AI 过程可视化

**Status:** `DONE`（2026-05-23 合流 U1.5 + 块 B 同步交付）

**目标**：让 KnowClaw 对话区右侧显示当前工作空间文件树，对话产出 / 修改文件
后在树中高亮；同时增强 AI 工作过程的可视化（工具参数摘要、heartbeat 状态条、
30s 空闲倒计时）。

#### K2.1 用户原文（2026-05-21）

> KnowClaw 的工作空间应该要设计区域 UI，能够展示工作空间的文件树，而且在
> KnowClaw 生成产出新的文件的时候，可以在这个文件数中高亮新的文件方便用户
> 快速定位。

#### K2.2 与既有规划的关系

本诉求**与 `KNOWCLAW_UPGRADE_PLAN.md` § Phase U1.5 完全重叠**：

- U1.5 已设计：右侧 `WorkspaceFileTree` 面板、`knowclaw:listWorkspaceTree`
  IPC、监听 `tool_call/tool_result` 触发的 amber 角标 + "new/edited" 徽标 + 5s
  fadeout、`shell.openPath` 跳转
- K2 在 U1.5 基础上额外引入"块 B"（AI 工作过程可视化）

#### K2.3 落地范围

**块 A — 工作空间文件树侧栏**

- 主进程新增 `knowclaw:listWorkspaceTree`（depth 默认 3、最多 6；MAX 500 项；
  排除 `node_modules`/`.git`/`dist`/`.vite`/`__pycache__` 等噪音目录；全局
  模式返回 `{ global: true, entries: [] }`）
- `knowclaw:openInExplorer` 文案更新为「路径」，`shell.openPath` 同时支持
  目录与文件，文件点击通过同一通道
- 渲染层：`WorkspaceFileTree.jsx`（嵌套树渲染、折叠、文件大小、按扩展名
  图标、刷新按钮、在资源管理器中打开当前 cwd）
- `KnowClawV2Page.jsx` 右上角新增 `PanelRight + FolderTree` toggle，
  显隐状态写入 `localStorage('knowclaw.v2.showFileTree')`
- Hook 新增 `workspaceTree` / `treeLoading` / `treeTruncated`
  `recentTouchedFiles` 状态；`tool_execution_start` 解析 `write`/`edit`
  的 `args.path` 与 `bash` 命令中的 `touch/mkdir/cp/mv/>` 句段，5s 内
  amber 背景 + 角标（new = emerald、edited = amber），自动 1s 一跳
  prune 过期项
- 刷新触发点：mount / cwd 切换 / `agent_end` 之后延迟 250ms（等待 Windows
  上 pi 最后一次 child write flush 完成）/ 手动刷新

**块 B — AI 工作过程可视化**

- Hook 新增 `streamingPhase`（`'idle' | 'thinking' | 'writing' | 'tool'`）、
  `activeToolName`、`lastEventTimestamp`、`streamingIdleSeconds`；
  `tool_execution_start` 时记录 `startTime` 与友好 `summary`，
  `tool_execution_end` 时记录 `endTime`
- `MessageBubble.jsx` 在 *当前 streaming* assistant 气泡顶部渲染
  `HeartbeatStrip`：thinking（amber）/ writing（emerald）/ tool（sky）/
  idle（slate）+ idle 满 30s 切换为「等待模型响应中…」amber 横条
- `ToolCallCard` 新增 "工具名 + 参数摘要"（`write` → `写入 path`、
  `search_web` → `搜索: query`、`fetch_web` → `渲染抓取: hostname`、
  `bash` → 命令前 80 字、`task_manager` → 任务数 等），完成后右侧显示
  `endTime - startTime` 耗时
- 仅向"最后一条 assistant 且 streaming"气泡传 heartbeat 三件套，
  其它历史气泡静态化、不会出现陈旧状态条

#### K2.4 决策记录

- 文件树面板默认 *折叠*（保护小屏用户的对话主列），用户开关持久化
- highlighting 5s 而非更久：与一次轮次的注意力窗口一致；过久会被频繁
  写入的 tool 互相覆盖
- `bash` 命令的路径提取走"宽松正则 + best-effort"，错配只会让对应
  relPath 找不到树节点，不会影响主流程
- 30s idle 阈值参考 OpenAI / Claude 长尾响应中位数（实测国内代理下偶发
  20-40s 沉默）；早于此报警容易误伤、晚于此用户已经开始焦虑
- 重用 F2 `knowclaw:openInExplorer` 而非新建文件打开通道：`shell.openPath`
  本就同时支持文件与目录，省一个 IPC

#### K2.5 改动文件清单

- `desktop/src/main/ipc/knowclaw.js` —— 新增 `listWorkspaceTree` handler、
  `openInExplorer` 文案
- `desktop/src/preload.js` —— 暴露 `listWorkspaceTree`
- `desktop/src/ui/components/knowclaw-v2/useKnowClawV2Chat.js` —— K2 状态 +
  工具路径提取 + heartbeat 字段 + 周期 prune effect
- `desktop/src/ui/components/knowclaw-v2/WorkspaceFileTree.jsx` —— **新增**
- `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx` —— toggle 按钮、
  右侧面板挂载、heartbeat props 透传
- `desktop/src/ui/components/agent-chat/MessageBubble.jsx` —— `HeartbeatStrip`、
  工具 summary、耗时显示
- `desktop/Agent/IPM_FEATURE_UPGRADE_PLAN.md` —— 本节
- `desktop/Agent/KNOWCLAW_UPGRADE_PLAN.md` —— U1.5 状态同步

---

### Phase K3 — 悬浮窗 KnowClaw 助手

**Status:** `PLANNED`

**目标**：把现有悬浮窗从"剪贴板 + 截图捕获"的单一工具升级为"随时唤起的
AI 助手 + 智能截屏助手"，拥有固定工作空间和独特交互体验，对话与产出沉淀
在该工作空间中，可后续迁移到中台任意项目/案件。

> 📌 **K3 已拆出独立的详细子计划与 UI 参考文档，本节仅保留高层概要。**
>
> - **详细分期计划**：[`FLOATING_KNOWCLAW_PLAN.md`](./FLOATING_KNOWCLAW_PLAN.md)
>   （FK0~FK7 八阶段、双通道架构、UI 形态与回退策略、风险与变更日志）
> - **UI/UX 静态演示**：[`k3-floating-knowclaw-demo.html`](./k3-floating-knowclaw-demo.html)
>   （浏览器打开即用；缩略输入控制器 + 外部大气泡 + 展开内部对话；含截屏/OCR/新对话/回到空间/展开等交互）
> - **本节作用**：保留 K3 的目标、现状锚点、6 项架构决策与风险登记，便于读者在
>   主计划上下文中快速理解 K3 的边界；阶段细节、工作清单、验收标准等以详细子计
>   划文档为准。

#### K3.1 用户需求（2026-05-21 + 2026-05-24 补充）

> 原始需求（2026-05-21）：
> 我们的应用有悬浮窗的模式，这个模式也应该开发对接 KnowClaw，变成一个"可
> 随时唤起的 AI 助手"，而且这个悬浮窗模式有固定的工作空间，在这个模式下的
> 对话和产出都会在这个工作空间中，后续可以回到中台模式把产物移到需要的位置。

> 补充需求（2026-05-24）：
> 1. 给悬浮窗模式接入 KnowClaw，固定使用悬浮窗工作空间，比起在中台模式下
>    使用 KnowClaw，悬浮窗模式下应具有更好的交互，需要设计独特的 UI/UX 效果，
>    让 AI 互动适配悬浮窗场景。
> 2. 利用已有 PaddleOCR 给悬浮窗增加快捷操作：用户浏览网页时信息密集度高
>    不想自己看 → 一键唤起 → 自动截屏（满屏幕）→ 把图片交给 KnowClaw 自动
>    总结输出摘要 → 同时走 OCR 记录 raw 信息。

#### K3.2 现状锚点与已完成依赖

| 模块 | 路径 | 现状 |
|------|------|------|
| 悬浮窗 UI | `src/ui/components/floating/FloatingMode.jsx` | 文件拖拽分类 + 剪贴板/截图捕获；G1.0~G1.2 切换体验已顺畅 |
| 主台 KnowClaw | `src/ui/components/knowclaw-v2/KnowClawV2Page.jsx` | 完整对话 UI + 工作空间切换 + 文件树 |
| KnowClaw 引擎 | `Agent/pi-runtime/` | pi 0.74 + customTools + sessions + dual-mode |
| 工作空间机制 | `src/main/ipc/knowclaw.js` (setCwd/listWorkspaces) | 5 源聚合 + encodeCwd 隔离 + 切换清空 |
| OCR | `Agent/services/ocrService.js` | PP-OCRv5 mobile + WASM 后端 + Buffer/Path 输入 |
| 图片→AI | `src/ui/components/agent-chat/imageResize.js` | Canvas 压缩 + Base64 + sanitizeImagesPayload |
| Vision 模型 | `Agent/pi-runtime/models.js` | inferModelInputs 自动检测 vision 能力 |
| 截屏 | `src/main.js` (clipboard watcher) | 仅被动监听 clipboard.readImage()，**无主动截屏** |
| Backlog-D | — | **全部 DONE**（D.1~D.5），K3 前置依赖已清除 |

#### K3.3 架构设计决策

##### D-K3-1：双通道 KnowClaw（独立会话）✅

**决策：悬浮窗和主台使用独立的 Agent 会话通道。**

理由：
- 悬浮窗和主窗口是两个独立的 BrowserWindow（不同 renderer 进程）
- 用户可能在主台进行长对话，同时通过悬浮窗发起"快问快答"
- 强制共享会导致窗口切换时的 cwd/session 冲突

实现方案：在 `src/main/ipc/knowclaw.js` 中引入 **channel** 概念：
```
mainChannel   = { cwd, session, thinkingLevel, modelId, ... }  → 主窗口
floatingChannel = { cwd (fixed), session, thinkingLevel, ... }  → 悬浮窗
```

IPC 调用增加 `channel` 参数（`'main'` | `'floating'`），默认 `'main'`：
- `knowclaw:send { channel: 'floating', text, images }`
- `knowclaw:newSession { channel: 'floating' }`
- etc.

**跨通道可见性**：悬浮窗的历史会话在主台的 `listSessions` 中可见（因为固
定 workspace 出现在 `listWorkspaces` 中），用户可在主台打开并继续对话。

##### D-K3-2：固定工作空间路径 ✅

**决策：`userfile/workspaces/_floating/`** — 永久单一目录。

- 不按会话创建子目录（session JSONL 天然隔离历史）
- 该目录在 `listWorkspaces` 中自动出现，标记为"悬浮助手"
- 首次启动时自动 `mkdirSync` 创建
- `floatingChannel.cwd` 硬编码指向此目录，不允许用户在悬浮窗中切换

##### D-K3-3：悬浮窗 AI 交互 UI 设计 ✅

**核心原则：对话为主、信息密度高、操作路径短**

```
┌──────────────────────────────────────┐  420px
│ ═══ drag handle (8px) ═══════════════│
├──────────────────────────────────────┤
│ [←] KnowClaw ⚡        [⚙] [history]│  Header (36px)
├──────────────────────────────────────┤
│                                      │
│   ┌─ assistant bubble ─────────┐    │
│   │ 这是一段 AI 回复…          │    │
│   │ **加粗** `代码` [链接]()   │    │
│   └────────────────────────────┘    │
│                                      │
│   ┌─ user bubble ──────────────┐    │
│   │ 帮我总结这个截图           │    │
│   │ [📷 screenshot.png]       │    │
│   └────────────────────────────┘    │
│                                      │
│   ┌─ assistant (streaming) ────┐    │
│   │ 正在分析图片内容…▊         │    │
│   │ ┄ [🔧 reading file...] ┄  │    │  工具调用：单行折叠
│   └────────────────────────────┘    │
│                                      │
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐│
│ │ Ask KnowClaw...              [📎]││  Input (auto-expand)
│ └──────────────────────────────────┘│
├──────────────────────────────────────┤
│ [📷 截屏总结] [📋 OCR提取] [▣ 文件]│  Quick Actions (40px)
└──────────────────────────────────────┘
```

**与主台 KnowClaw UI 的差异（悬浮窗独特设计）：**

| 元素 | 主台 | 悬浮窗 |
|------|------|--------|
| 工作空间选择器 | 下拉多选 | **无**（固定） |
| 文件树面板 | 右侧可折叠 | **无**（太占空间） |
| TaskCard（子代理） | 完整展示 | **单行折叠**（"🤖 子代理完成 ✓"）|
| 思考块 | 可展开 | **隐藏**（仅显示⏳指示器） |
| 工具调用 | 多行详细 | **单行折叠**（点击可展开） |
| 模型/思考力切换 | 顶栏直接切换 | **⚙ 齿轮菜单中** |
| Plan 模式 | 支持 | **v1 不支持**（悬浮窗场景偏向快问快答） |
| 历史会话 | 侧栏列表 | **弹出式面板** (slide-over) |
| Quick Actions | 无 | **底部快捷操作栏**（截屏总结/OCR/文件拖入）|

**动态窗口尺寸**：
- 无对话时：紧凑态 420×280（输入框 + Quick Actions）
- 有对话时：展开态 420×560（最大可拉伸到 420×720）
- 通过现有 `ResizeObserver → ui/resizeFloating` 机制实现

##### D-K3-4：前置依赖 ✅

Backlog-D.1~D.5 **全部已完成**。`KnowClawPersistProvider` 保证跨页面
不丢状态。悬浮窗使用独立 channel 不与主台冲突，切换时无需额外处理。

##### D-K3-5：模型选择 ✅

**决策：沿用用户在主台配置的默认模型，悬浮窗内可通过齿轮菜单切换。**

Quick Actions（截屏总结等自动流程）强制使用 vision 模型（从已配置模型中
自动选取第一个支持 vision 的模型）。

##### D-K3-6：成本控制 ✅

**决策：不设独立限额，与主台共享 token 池。**

在 Header 右侧显示微型 token 计数器（本次会话累计），让用户有感知。
Quick Actions 的自动流程在发起前显示预估 token 消耗提示（可关闭）。

#### K3.4 功能规格

##### 模块 A：悬浮窗 KnowClaw 对话（核心）

| 子项 | 描述 |
|------|------|
| A.1 | 双通道架构：主进程 `channelMap` 管理两套独立 session context |
| A.2 | 悬浮窗对话 UI 组件 `FloatingChat.jsx`：简化版消息列表 + 流式渲染 |
| A.3 | 输入框组件 `FloatingInput.jsx`：自动扩展 textarea + 图片粘贴/拖入 |
| A.4 | 工具调用折叠：单行 indicator + 点击展开详情 |
| A.5 | 历史会话 slide-over 面板 |
| A.6 | 齿轮设置菜单（模型切换 + thinking level） |
| A.7 | 紧凑/展开动态尺寸（无对话 → 280h；有对话 → 560h） |
| A.8 | "导出到中台"按钮：将悬浮窗会话产物迁移到指定项目/案件 |

##### 模块 B：智能截屏 + AI 总结（Quick Action #1）

| 子项 | 描述 |
|------|------|
| B.1 | 主进程 `desktopCapturer` 全屏截图能力（隐藏悬浮窗 → 截图 → 恢复） |
| B.2 | 截图预览卡片（缩略图 + "发送给 AI" / "仅 OCR" / "取消"） |
| B.3 | 自动流程：截图 → imageResize 压缩 → 发送给 KnowClaw（附 prompt "请总结这张截图的核心内容"） |
| B.4 | 并行 OCR：截图 PNG buffer → ocrService.recognize → raw text 保存到工作空间 |
| B.5 | AI 摘要 + OCR 原文合并展示（摘要在上，"查看原文"折叠在下） |
| B.6 | 全局快捷键触发（候选：`Ctrl+Shift+S` 或可自定义） |

##### 模块 C：快捷 OCR 提取（Quick Action #2）

| 子项 | 描述 |
|------|------|
| C.1 | 用户按下"OCR 提取" → 区域截屏（desktopCapturer + 用户框选叠加层） |
| C.2 | 或：直接对剪贴板中的图片执行 OCR（复用现有 clipboard watcher） |
| C.3 | OCR 结果即时显示在悬浮窗中（可复制、可编辑） |
| C.4 | "追问 AI"按钮：将 OCR 文本作为上下文发送给 KnowClaw |

##### 模块 D：文件拖入增强（与现有功能融合）

| 子项 | 描述 |
|------|------|
| D.1 | 拖入文件时增加"发送给 AI 分析"选项（除了现有的分类上传） |
| D.2 | 拖入图片时自动提供"OCR + AI 总结"路径 |
| D.3 | 底部 tab 切换：`[💬 对话]` / `[▣ 文件管理]`（保留现有 TrayWidget） |

#### K3.5 实施分期

##### Phase K3-P0：双通道基础设施 ← **第一步**

**目标**：让悬浮窗能独立发消息给 KnowClaw，不干扰主台会话。

**工作内容**：
1. `src/main/ipc/knowclaw.js`：将 `currentCwd / currentSession / ...`
   重构为 `channels = { main: {...}, floating: {...} }` 结构
2. 所有 `knowclaw:*` handler 读取 payload.channel 分派到对应 channel
3. `floatingChannel.cwd` 硬编码 `userfile/workspaces/_floating/`，启动时
   自动创建目录
4. `preload.js`：新增 `window.ipm.knowclawFloating` 命名空间（或复用现有
   但自动注入 channel 参数）
5. 冒烟测试：悬浮窗发送一条消息，主台会话不受影响

**估时**：1.5–2 天

##### Phase K3-P1：悬浮窗对话 UI（模块 A）

**目标**：在悬浮窗中呈现完整的 AI 对话体验。

**工作内容**：
1. `FloatingMode.jsx` 改造：底部 tab 切换 `对话 / 文件管理`
2. 新组件 `FloatingChat.jsx`：消息列表 + 流式渲染 + 工具折叠
3. 新组件 `FloatingInput.jsx`：textarea + 图片粘贴 + 发送按钮
4. `useFloatingChat.js` hook：封装 IPC 通信（channel='floating'），
   事件监听（onEvent），消息状态管理
5. 历史会话 slide-over 面板
6. 动态窗口尺寸联动
7. 齿轮菜单（模型 + thinking level）

**估时**：3–4 天

##### Phase K3-P2：智能截屏流程（模块 B）

**目标**：一键全屏截图 → AI 总结 + OCR raw text。

**工作内容**：
1. 主进程新增 `captureScreen` IPC：
   - `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: screenWidth, height: screenHeight } })`
   - 或 `screen.getPrimaryDisplay()` + `BrowserWindow.capturePage()`
   - 截图前先 `floatingWindow.hide()`，截完后 `floatingWindow.show()`
2. Preload 暴露 `window.ipm.capture.fullScreen()`
3. Quick Action 按钮 `[📷 截屏总结]` 触发流程：
   - capture → preview card（150ms 显示缩略图）→ 自动发送
4. 并行管道：`imageResize → KnowClaw (vision)` + `PNG buffer → OCR`
5. 结果合并展示：AI 摘要 bubble + "原文" 折叠区
6. 截图 + OCR 原文自动保存到 `_floating/captures/` 目录

**估时**：2–3 天

##### Phase K3-P3：OCR 快捷提取（模块 C）

**目标**：对剪贴板图片 / 区域截图执行 OCR，结果可追问 AI。

**工作内容**：
1. Quick Action `[📋 OCR提取]`：
   - 优先读取剪贴板图片（clipboard watcher 最近捕获的）
   - 若剪贴板无图 → 触发全屏截图（复用 K3-P2）
2. OCR 结果卡片 UI：文本显示 + 复制按钮 + "追问 AI" 按钮
3. "追问 AI"：将 OCR 文本注入输入框作为引用上下文
4. （可选 P2）区域框选截屏：透明全屏窗口叠加层 + 鼠标框选 + crop

**估时**：1.5–2 天

##### Phase K3-P4：融合与打磨（模块 D + 整体 UX）

**目标**：文件拖入增强 + 主台可见性 + 整体动效打磨。

**工作内容**：
1. 拖入文件时双选项弹窗："分类上传" / "发送给 AI 分析"
2. 拖入图片自动提供 OCR + AI 路径
3. `listWorkspaces` 中 `_floating/` 标记为"⚡悬浮助手"
4. 主台可浏览悬浮 workspace 的会话历史和文件
5. "导出到中台"按钮：弹出项目/案件选择器 → `pathRemapper` 安全移动
6. 整体动效：消息气泡入场动画、截图卡片 slide-in、窗口尺寸过渡 ease

**估时**：2–3 天

#### K3.6 技术细节补充

##### 全屏截图方案对比

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| `desktopCapturer.getSources({types:['screen']})` | 跨平台、可多屏 | 返回 NativeImage thumbnail 尺寸受限 | 备选 |
| `screen.getPrimaryDisplay()` + 临时隐藏窗口 + `win.capturePage()` | 简单 | 只能截自己的窗口 | ✗ |
| `PowerShell / screencapture` 系统命令 | 全屏原始分辨率 | 平台特定、子进程开销 | 备选 |
| **`desktopCapturer` + 设置 thumbnailSize = 屏幕物理分辨率** | 全屏原始像素、纯 Electron API | 需要用户授权（macOS） | **✓ 首选** |

实现伪代码：
```javascript
const { desktopCapturer, screen } = require('electron');
const display = screen.getPrimaryDisplay();
const { width, height } = display.size;
const scaleFactor = display.scaleFactor;

// 隐藏悬浮窗避免自身入镜
floatingWindow.hide();
await sleep(100); // 等待窗口动画完成

const sources = await desktopCapturer.getSources({
  types: ['screen'],
  thumbnailSize: { width: width * scaleFactor, height: height * scaleFactor },
});
const primarySource = sources[0];
const screenshot = primarySource.thumbnail; // NativeImage
const pngBuffer = screenshot.toPNG();

floatingWindow.show();
return { pngBuffer, width, height };
```

##### 双通道 IPC 重构示意

```javascript
// knowclaw.js — 重构前
let currentCwd = null;
let currentSession = null;

// knowclaw.js — 重构后
const channels = {
  main: { cwd: null, session: null, thinkingLevel: 'medium', ... },
  floating: { cwd: FLOATING_WORKSPACE_PATH, session: null, thinkingLevel: 'medium', ... },
};

function getChannel(payload) {
  return channels[payload?.channel === 'floating' ? 'floating' : 'main'];
}

ipcMain.handle('knowclaw:send', async (_evt, payload) => {
  const ch = getChannel(payload);
  const session = await ensureSession(ch);
  // ... 使用 ch.cwd, ch.session 等
});
```

#### K3.7 UI/UX 独特设计理念

**核心差异化：悬浮窗不是"缩小版的中台 KnowClaw"，而是"桌面 AI 伴侣"。**

设计原则：
1. **极短路径**：从唤起到得到答案 ≤ 3 步操作（快捷键→自动截屏→AI回复）
2. **不打断工作流**：悬浮窗 alwaysOnTop + 透明背景，用户视线不需要切换应用
3. **信息收敛**：AI 回复默认精炼展示，工具/思考/子代理等细节折叠
4. **快捷操作优先**：Quick Actions 栏让最高频操作一触即达
5. **渐进展开**：从 compact 280h → 对话 560h → 详情 720h，按需生长

**与现有 TrayWidget 的融合**：
- 底部 Tab 切换：`💬 KnowClaw` / `📁 文件管理`
- 文件管理 tab 保留现有全部 TrayWidget 功能（拖拽分类、剪贴板、截图捕获）
- KnowClaw tab 为新开发的对话 + Quick Actions 界面
- 左侧 rail 的三域切换按钮仅在"文件管理" tab 下可见

#### K3.8 风险与缓解

| ID | 风险 | 概率 | 影响 | 缓解 |
|----|------|------|------|------|
| RW-K3-1 | 悬浮窗空间受限，对话多时滚动体验差 | 中 | 中 | 消息虚拟滚动 + 动态窗口高度 + 最大高度 720px |
| RW-K3-2 | `_floating/` 产物在中台"被发现"链路不通 | 中 | 中 | 自动注册为 workspace + "⚡悬浮助手"标记 |
| RW-K3-3 | desktopCapturer 在 macOS 需要屏幕录制权限 | 中 | 中 | 首次触发时引导用户授权 + 降级提示 |
| RW-K3-4 | 双通道重构引入回归 bug | 中 | 高 | 渐进式：先加 channel 参数但默认行为不变 → 再加 floating |
| RW-K3-5 | Quick Action 误触导致不必要的 API 调用 | 低 | 中 | 截图后先展示预览卡片，3s 内可取消 |
| RW-K3-6 | 两通道同时流式响应时主进程 event loop 压力 | 低 | 中 | pi AgentSession 本身异步非阻塞，观察后优化 |

#### K3.9 总工期估算

| Phase | 工作量 | 累积 |
|-------|--------|------|
| K3-P0 双通道基础 | 1.5–2 天 | 2 天 |
| K3-P1 对话 UI | 3–4 天 | 6 天 |
| K3-P2 智能截屏 | 2–3 天 | 9 天 |
| K3-P3 OCR 快捷 | 1.5–2 天 | 11 天 |
| K3-P4 融合打磨 | 2–3 天 | 14 天 |
| **总计** | **10–14 天** | — |

#### K3.10 变更日志

| 日期 | 变更 |
|------|------|
| 2026-05-24 | 从 RESEARCH 升级为 PLANNED；完成架构决策 D-K3-1~6；制定 P0~P4 分期计划 |

---

## 4. 风险登记表

| ID | 风险 | 触发阶段 | 概率 | 影响 | 缓解 |
|----|------|---------|------|------|------|
| RW-F1-1 | 外部目录被外部进程占用 / 权限不足，扫描失败 | F1 | 中 | 中 | best-effort 错误捕获 + UI 显示"该目录暂时无法访问" |
| RW-F1-2 | `fs.watch` 跨平台行为差异大 | F1 | 高 | 中 | 首版仅"启动时 + 用户手动刷新"，watch 留 P2 |
| RW-F1-3 | 扫描大目录卡 UI | F1 | 中 | 中 | 分批 / 异步 / 进度条 / `maxEntries` |
| RW-F1-4 | 与现有 `localFolders` 浏览模式语义混淆 | F1 | 中 | 低 | UI 命名 + 文档明确"附属 vs 浏览" |
| RW-F2-1 | 隐藏窗口被站点反爬识别 | F2 | 中 | 中 | UA 伪装 / 等待随机 / fallback 到方案 B |
| RW-F2-2 | 抓取内容版权 / 法律风险 | F2 | 中 | 中 | UI 显式提示 + 抓取时间戳记录 |
| RW-F2-3 | 与 K1 重复造轮子 | F2 / K1 | 高 | 中 | 统一在 `desktop/Agent/services/webFetch.js` 下实现 |
| ~~RW-F3-1~~ | ~~OCR 模型分发 / 升级路径未定~~ | F3 | — | — | **已解决**：开发用 `setup-ocr-models.mjs` 脚本 + 生产用 Forge `packageAfterCopy` 钩子 |
| ~~RW-F3-2~~ | ~~Python 环境差异~~ | F3 | — | — | **已消除**：选择纯 Node.js 方案，无需 Python |
| RW-F3-3 | OCR 出错率不为零，被误用为法律证据 | F3 | 低 | 高 | UI 显示置信度分数，碎片标记为"OCR 识别" |
| RW-F4-1 | 系统级长截屏拼接算法复杂度高 | F4 | 高 | 中 | 首版只做应用内嵌浏览器，方案 B 留 P2 |
| RW-F4-2 | 长图存储与检索成本 | F4 | 中 | 低 | 默认压缩 / 分段保存 |
| RW-K1-1 | 外部搜索 API key 泄露 / 成本失控 | K1 | 中 | 中 | API Key 仅保存在本地 `state.prefs.searchApi`；设置页提供连通性测试；错误分类明确（401/402/429）并提示用户自行处理配额 |
| RW-K3-1 | 悬浮窗空间受限，对话多时滚动体验差 | K3 | 中 | 中 | 消息虚拟滚动 + 动态窗口高度（280→560→720）+ Quick Actions 收敛操作路径 |
| RW-K3-2 | 悬浮窗产物的"被中台发现"链路不通 | K3 | 中 | 中 | `_floating/` 自动注册为 workspace，标记为"⚡悬浮助手"，主台可浏览 |
| ~~RW-K3-3~~ | ~~复用 hook 引入 Backlog-D 未修 bug~~ | K3 | — | — | **已消除**：Backlog-D.1~D.5 全部 DONE；悬浮窗使用独立 channel 不共享 hook 实例 |
| RW-K3-4 | desktopCapturer 在 macOS 需要屏幕录制权限 | K3 | 中 | 中 | 首次触发时引导用户授权 + 降级提示（手动截图粘贴） |
| RW-K3-5 | 双通道重构引入回归 bug | K3 | 中 | 高 | 渐进式：先加 channel 参数但默认行为不变 → 再加 floating channel |
| RW-K3-6 | Quick Action 误触导致不必要的 API 调用 | K3 | 低 | 中 | 截图后先展示预览卡片，3s 内可取消 |

---

## 5. 进度看板

| 阶段 / 条目 | Status | 完成日期 | 备注 |
|------------|--------|---------|------|
| F1 — 外部文件夹「附属导入」 | **DONE** | 2026-05-22 | 附属壳 + 双根路径解析 + 外部扫描 + 前端限制 guard |
| F2 — 网页完整信息抓取升级 | **DONE** | 2026-05-22 | Electron 隐藏窗口渲染 + HTTP 降级 + Markdown 转换 + 截图 lightbox |
| F3 — 内置 OCR（PP-OCRv5） | **DONE** | 2026-05-22 | `ppu-paddle-ocr` + `onnxruntime-node`，中英双模型，自动生成 snippet 碎片 |
| F4 — 内置长截屏 | **DEFERRED** | | 2026-05-22 用户决策短期不开发 |
| K1 — KnowClaw 网页搜索/抓取稳定性 | **DONE** | 2026-05-22 | 博查 Web Search + F2 渲染桥接 + 设置页 API Key 配置 + LLM 自然降级 |
| K2 — KnowClaw 工作空间文件树 + AI 过程可视化 | DONE | 2026-05-23 | 右侧 `WorkspaceFileTree` + `listWorkspaceTree` IPC + `tool_execution_start` 路径提取 + 5s 高亮；heartbeat 状态条 + 30s 倒计时 + 工具参数摘要 / 耗时 |
| K3 — 悬浮窗 KnowClaw 助手 | **PLANNED** | — | 架构设计完成；详细分期与 UI 演示已拆出独立文档：[`FLOATING_KNOWCLAW_PLAN.md`](./FLOATING_KNOWCLAW_PLAN.md) / [`k3-floating-knowclaw-demo.html`](./k3-floating-knowclaw-demo.html) |

---

## 6. 升级后终态画像

1. **数据存储自由度**：用户既能在数据存储区开普通项目，也能"附属导入"任意
   外部目录，结构 / 描述 / 知识联动一致。
2. **网页信息完整可控**：剪藏与 LLM 抓取共底层、支持 JS 渲染与登录态，几乎
   任何网页都能完整入库。
3. **OCR 基线**：图片碎片 / 长截屏 → 自动文字化 + LLM 摘要，可作为知识库的
   一等数据源。
4. **长截屏成熟**：内嵌浏览器场景可一键长图 + OCR；系统级长截屏作为后续选项。
5. **KnowClaw 网页能力稳定**：404 / 反爬 / 代理 / 登录态等问题全部收敛到统一
   服务层。
6. **悬浮窗成为 AI 助手**：随时唤起、零成本沉淀、再迁回主台收编。
7. **KnowClaw 工作空间一目了然**：右侧文件树 + 新文件高亮（K2 + U1.5 已合流交付，
   2026-05-23）；同时 heartbeat 状态条 + 30s 空闲倒计时让 AI 工作过程可见可控。

---

## 7. 术语表

- **附属文件夹 / 附属壳**：F1 引入的概念。指数据存储区里只放系统目录（`meta/`、
  `temp/`、`snippets/`）和 `external-link.json` 的"项目壳"，其业务"文件夹"
  通过 `structure.json` 镜像指向外部真实磁盘路径。
- **镜像节点**：`structure.json` 中代表外部磁盘文件夹的虚拟节点，由扫描产出。
- **附属壳扫描**：启动 / 手动刷新时遍历 `external-link.rootPath`，更新 mirror
  树并触发 `pathRemapper` 软重定向。
- **统一 webFetch 服务**：F2 + K1 共同的底层抓取实现，已落地在
  `desktop/Agent/services/webFetch.js`，K1 的 `fetch_web(rendered=true)` 通过
  `toolDeps.fetchWebRendered` 桥接到该服务。
- **OCR 服务**：F3 实现的 `Agent/services/ocrService.js` 单例，基于 `ppu-paddle-ocr` + `onnxruntime-node` 的纯 Node.js OCR 引擎，懒加载 + 空闲自动释放。
- **悬浮窗工作空间**：K3 引入的固定路径，承载悬浮窗 KnowClaw 的对话与产出。

---

## 附录 · Backlog

> 以下条目自 [`KNOWCLAW_UPGRADE_PLAN.md`](./KNOWCLAW_UPGRADE_PLAN.md) 附录迁移
> 而来，由于内容属于"待评估的体验改进"且与本计划的 K1–K3 同属 KnowClaw
> 演进，故统一纳入本计划维护。**来源标注请勿删除**。

---

### Backlog-D · KnowClaw V2 对话体验五项反馈（2026-05-20 密集测试采集）

> **迁移来源**：`KNOWCLAW_UPGRADE_PLAN.md` § 附录 · Backlog-D（2026-05-20）  
> 该计划原节已加迁移指引，权威更新位置已切换为本节。

U8 完成后密集人工测试采集到的 5 个体验问题，均与核心对话流程相关。按严重程度排序记录，作为下一阶段优先事项。

#### D.1 页面切换导致对话进度丢失

**用户反馈原文**
> "KnowClaw 页面在切换的时候会丢失进度，比如我正在对话，或者 LLM 正在生成时，
> 我切换到了项目页面，此时再回来，虽然有概率会回到对话，但很反直觉。之前的
> 对话内容都会消失，只有等待全部生成完毕后，点击左侧的历史会话，才能恢复。"

**根因分析（待侦察确认）**
- `KnowClawV2Page` 在 React Router 切走时整个组件被 unmount，`useKnowClawV2Chat` hook 内部的 `messages` state 全部销毁。
- pi 的 `subscribe(callback)` 返回的 `unsub` 在 useEffect cleanup 里被调用，主进程侧的 `webContents.send('knowclaw:event', ...)` 再发过来无人接收——如果此时模型仍在生成，这些 event 被丢弃（而非缓冲）。
- 切回来时 hook 重新 mount + `continueRecent` / `ensureSession` 跑一次，但因为 turn 还在 streaming，history 快照不完整，用户看到的是"空"或"部分"。

**候选方案**
1. **P0 · 状态提升到 App 级**：把 `useKnowClawV2Chat` 的核心 state（messages / streaming / sessionId）提升到 `App.jsx` 或一个 React Context 中，使其在路由切换时不被销毁。同时把 `knowclaw:event` 的 `onEvent` 监听也挂在 App 级 useEffect 里，保证 streaming 期间事件不丢。
2. **P1 · Route keepalive**：用 `<Outlet>` + CSS `display:none` 隐藏 KnowClaw 页面而非 unmount（类似 Vue keep-alive），成本更低但对现有路由架构有侵入。
3. **P2 · 事件缓冲 + 回放**：主进程侧为 `activeSender` 维护一个有限队列，当 `webContents.send` 失败（页面 navigated away）时缓冲事件，下次 `knowclaw:getStatus` 时一起下发。

**实现记录（2026-05-23 DONE）**

- 采纳方案：**P0 · 状态提升到 App 级 + rehydrate IPC + session 锁定**
- 修改文件清单：
  - `desktop/src/ui/hooks/useKnowClawPersist.jsx`（新建）— App 级 Context `KnowClawPersistProvider`，持久化 messages / streaming / sessionId / sessionStats / contextUsage / pendingSteer / pendingFollowUp / tasks / compaction / retrying / workspace / thinkingLevel / subAgentEnabled / models 等全部会话状态；`window.ipm.knowclaw.onEvent` 监听挂在该 Provider 的一次性 useEffect 里，永不随页面切换被 `removeListener`。
  - `desktop/src/ui/components/knowclaw-v2/knowclawEventReducer.js`（新建）— 从原 hook 提取的纯函数事件处理器（`ensureStreamingMessage`、`updateToolByCallId`、`stringifyResult`、`extractTouchedFilesFromEvent`、`toRelPosix`、`summarizeToolArgs`、`normalizeTasksArray`），便于 reducer 在 Provider 内复用且可单测。
  - `desktop/src/ui/components/knowclaw-v2/useKnowClawV2Chat.js` — 降级为 Context 的 thin facade，仅保留页面本地 `showSessionPanel` state，并 re-export `summarizeToolArgs` 兼容 `MessageBubble` 的 import 路径。
  - `desktop/src/ui/App.jsx` — 在 `ConfirmDialogProvider` + `ToastProvider` 内嵌 `KnowClawPersistProvider`，包裹 `TourProvider` 及主内容；浮窗模式分支不挂载（不展示 KnowClaw 内容）。
  - `desktop/src/main/ipc/knowclaw.js` — 新增 `ipcMain.handle('knowclaw:rehydrate')`，返回 `{ hasSession, sessionId, sessionFile, messages, tasks, promptInFlight, streaming, contextUsage, sessionStats, isCompacting, cwd, isGlobal }`；同时 rebind `activeSender = evt.sender`，保证 renderer 刷新后继续接收事件。
  - `desktop/src/preload.js` — 暴露 `window.ipm.knowclaw.rehydrate()` API。
  - `desktop/src/ui/components/KnowClawBubble.jsx` — 全局浮动气泡读取 `streaming / streamingPhase / activeToolName`，streaming 期间展示脉冲动画与“正在思考…/正在回复…/正在执行 xxx…”状态文字；streaming 时点击气泡直接跳到 KnowClaw 页面。
  - `desktop/src/ui/components/knowclaw-v2/SessionPanel.jsx` — `SessionRow` 与 SessionPanel `+ 新建会话`/历史会话点击/fork/delete 全部支持 `disabled` prop，禁用时 tooltip 提示“当前有对话正在进行，请先等待结束或中止”。
  - `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx` — `WorkspaceSelector`、Header 「新对话」按钮、`SessionPanel.disabled` 联动 `isSessionLocked`。
- 附加机制：
  - **Session 锁定**：`isSessionLocked = streaming && Boolean(sessionId)`，从 Provider 派生，streaming 期间禁止新建/切换会话与切换工作空间；ChatInput 仍可输入（走 steer / followUp 队列）。
  - **Install 确认全局化**：`window.ipm.knowclaw.onConfirmInstall` 监听也提升到 Provider，pending install confirmations 跨页面存活，避免切走 KnowClaw 页面时确认弹窗被销毁。
  - **Rehydrate race guard**：Provider mount 时调 `knowclaw:rehydrate`，对返回的 messages / streaming flag 使用函数式 `setState(prev => ...)` 检查 prev 是否仍为空/false，防止 stale snapshot 覆盖 live event 已经写入的更新状态。

#### D.2 新建会话不自动触发 / 意外延续旧会话

**用户反馈原文**
> "在我进入一个工作空间后，并不会马上新建会话，header 中也不会出现类似 019e3b7f
> 这样的会话 id，如果此时我开始对话，很有可能莫名其妙延续了工作空间里的某个
> 历史对话。我必须通过手动点击新对话，才能真正意义上的新建一个稳定的对话。"

**根因分析（待侦察确认）**
- `ensureSession` 默认 `mode='continueRecent'`：如果当前 cwd 下已有 JSONL 会话文件，pi 的 `SessionManager` 会自动续上最近一条——这是"关了再开还在"的设计。但用户期望的语义是"进入一个工作空间 = 开始一次新工作"。
- hook 的 mount 时只做 `refreshStatus` + `listModels`，不主动 `ensureSession`，所以 header 没有 sessionId。第一次发消息时 `sendMessage` → `ensureSession('continueRecent')` → 续旧。

**候选方案**
1. **P0 · 切换工作空间时自动新建会话**：`setCwd` 成功后立即调 `window.ipm.knowclaw.newSession()`，header 上马上出现 sessionId，用户心智模型清晰。
2. **P1 · "继续 / 新建" 二选一提示**：切到有历史的 cwd 时弹一个 inline banner "发现此工作空间有一个 XX 分钟前的对话，要继续还是新开？"。
3. **P2 · 偏好设置项**：`prefs.knowclaw.sessionOnWorkspaceSwitch: 'new' | 'continue' | 'ask'`。

**实现记录（2026-05-23 DONE）**

- 采纳方案：**P0 · 切换工作空间 / 冷启动时自动新建会话 + 防御性兜底**
- 修改文件清单：
  - `desktop/src/ui/hooks/useKnowClawPersist.jsx`
    - `setCwd` 成功后 `await newSession()`，立即在 header 显示新 sessionId；首条消息不再走 `continueRecent` 续旧。
    - rehydrate `useEffect` 中，当主进程返回 `hasSession: false` 时自动 `await newSession()`，保证 App 冷启动就有可见的 sessionId。
    - `newSession` 失败时改为 `showToast` 显式上报（IPC throw / `skipped: 未配置 LLM` / `res.error`），并 **无条件** `setSessionId(null) + setCurrentSessionFile(null)`，杜绝 sessionId 残留导致下次 send 误续旧。
    - 新增 `sessionGenRef`（monotonic counter），在 `newSession` / `setCwd` / `openSession` / `forkSession` / `deleteSession-wasActive` 处 bump，rehydrate 回调对比 `genAtRequest === sessionGenRef.current`，不一致直接 bail-out，彻底消除“切换工作空间或新建会话后被 rehydrate 旧 snapshot 反向覆盖”。
    - `deleteSession-wasActive` 直接消费主进程返回的 `nextSessionId / nextSessionFile`，省掉一次 newSession round-trip。
  - `desktop/src/main/ipc/knowclaw.js`
    - `knowclaw:send` 的 `ensureSession` 默认 mode 从 `'continueRecent'` 改为 `'new'`：即使前端 eager-newSession 失败留下 `activeSession === null`，首条消息也会开新 session 而非续旧（防御性兜底）。
    - `knowclaw:deleteSession` 在 `wasActive === true` 时同步 `ensureSession(sender, 'new')`，并把 `nextSessionId / nextSessionFile / nextError` 一并返回给前端；`unlinkError` 作为软警告。

#### D.3 新建会话不立即出现在历史列表

**用户反馈原文**
> "如果我新开了一个对话，往往需要等待第一轮交互结束后，左侧的历史会话才会出现，
> 这比较反直觉。"

**根因分析（待侦察确认）**
- `listSessions` 读的是磁盘上的 JSONL 文件列表。pi 的 `SessionManager` 可能在 session 创建时就写 JSONL，也可能延迟到第一条 entry 写入时才 `createWriteStream`——需确认。
- `refreshSessions` 的调用时机在 hook 里只挂在 mount + `newSession` 返回后，但 `newSession` 的 IPC 返回的 `sessionFile` 可能还没落盘。

**候选方案**
1. **P0 · 乐观 UI 插入**：`newSession` IPC 返回 `{ sessionId, sessionFile }` 后，hook 立即把一条 `{ id, path, lastModified: Date.now() }` 插到 `sessions` 前面，不依赖 `listSessions` 的磁盘扫描。
2. **P1 · 刷新轮询频率提高**：在创建新会话后的前 10 秒把 `refreshSessions` 的 polling interval 从"无"缩短到 2s，确保 JSONL 落盘后很快可见。

**实现记录（2026-05-24 DONE）**

- 采纳方案：**P0 · 乐观 UI 插入**
- 根因确认：pi `SessionManager._persist()` 内含 `hasAssistant` guard——直到首个 assistant 消息写入才会 flush header + entries 到磁盘。因此 `newSession()` 返回时 JSONL 文件尚不存在，`listSessions`（扫磁盘 `*.jsonl`）自然看不到新 session。
- 修改文件：
  - `desktop/src/ui/hooks/useKnowClawPersist.jsx` — `newSession` 成功分支中，`void refreshSessions()` 之前新增 `setSessions(prev => ...)` 乐观插入。合成条目包含 `{ path, id, cwd, name: null, created: Date.now(), modified: Date.now(), messageCount: 0, firstMessage: '' }`，按 path 去重防止重复。
- 无需改其他文件：`SessionPanel.jsx` 已正确渲染 `messageCount === 0` 的条目（显示「(无内容)」），且 `currentSessionFile === session.path` 时给予 amber active 高亮。
- 自动校正：streaming 结束后 `wasStreamingRef` effect 调 `refreshSessions`，此时 JSONL 已落盘，真实 metadata（`firstMessage`、`messageCount`、`modified`）替换乐观条目。

#### D.4 Streaming 期间无法上滚——强制锚定页面底部

**用户反馈原文**
> "LLM 在打字机生成回复的过程中，用户完全无法上拉，会一直被强制带到页面最下
> 看打字机生成。"

**根因分析（待侦察确认）**
- `KnowClawV2Page` 的消息列表底部有一个 `bottomRef`，配合 `useEffect` 在 `messages` 变化时 `scrollIntoView({ behavior: 'smooth' })`。Streaming 期间每次 token flush 都触发 → 用户滚上去 → 100ms 后被拉回来。

**候选方案**
1. **P0 · "用户已手动上滚" 检测 + 暂停自动滚**：在滚动容器上监听 `onScroll`，计算 `scrollTop + clientHeight < scrollHeight - threshold`（比如 threshold=80px），一旦成立设 `userScrolledUp = true`，暂停自动 scrollIntoView。当用户滚回底部（或 streaming 结束）时重置为 `false`。
2. **P1 · "回到底部" 浮动按钮**：当 `userScrolledUp && streaming` 时显示一个小的浮动按钮 "↓ 回到底部"，点击后 `scrollIntoView` + reset。类似 ChatGPT / Claude 的做法。

**实现记录（2026-05-24 DONE）**

- 采纳方案：**P0 + P1 组合实现**
- 根因确认：`KnowClawV2Page.jsx` 原来的 `useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])` 在每次 `messages` 引用变化时无条件触发。streaming 期间 `text_delta` / `thinking_delta` / `tool_execution_*` 事件高频 `setMessages`，每个 token 都会把用户拉回底部。全项目无任何 `onScroll` 检测或 `userScrolledUp` flag。
- 修改文件：仅 `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`
  - 补 `useCallback` import。
  - 新增 `scrollContainerRef`（滚动容器 ref）、`userScrolledUpRef`（ref，避免 onScroll 高频 re-render）、`showScrollButton` state、`SCROLL_BOTTOM_THRESHOLD = 80`px。
  - `handleScroll` callback：计算 `scrollHeight - scrollTop - clientHeight <= threshold`，据此更新 `userScrolledUpRef` 和 `showScrollButton`。
  - `scrollToBottom(behavior)` 封装：优先 `scrollTo({ top: scrollHeight })` 直接操作 scrollTop（同步、不与平滑动画冲突），fallback `bottomRef.scrollIntoView`。
  - 自动滚 useEffect 改为 `if (userScrolledUpRef.current) return`，并从 `'smooth'` 改为直接 `scrollTop = scrollHeight`（streaming 期间避免动画队列堆叠与用户滚动"抢控制权"）。
  - `handleSend` wrapper 包 `sendMessage`：发消息前 `scrollToBottom('auto')` 强制回到底部（用户发送是明确的跟进意图）。
  - Chat body 容器加 `relative` 定位。
  - 「回到底部」浮动按钮（`absolute bottom-4 right-6 z-10`）：只要用户上滚就显示（与 ChatGPT/Claude 行为一致），点击后 smooth 滚底并重置 flag。使用已导入的 `ChevronDown` 图标。
  - `ChatInput.onSend` 从 `sendMessage` 改为 `handleSend`。

#### D.5 TaskCard 旧 snapshot 仍显示加载图标

**用户反馈原文**
> "对话中如果 LLM 开启了任务栏，会在完成某个任务后，显示新的任务清单，但旧的
> 任务清单还是会有加载图标，旧的对话同样也会显示加载，这对用户有一定的误导性，
> 以为之前的阶段还在加载。"

**根因分析（已确认）**
- `task_manager` 工具被多次调用（每完成一步就调一次），每次调用产出一个 `kind:'tasks'` 的 system bubble 嵌在对话流里。**旧 snapshot 被冻结在它产生时的状态**，不会被后续 snapshot 回溯更新——所以 step-2 的 card 里 step-1 可能还是 `in_progress`，而最新 card 里 step-1 才是 `completed`。
- 同一 assistant turn 内的多次 `task_manager` 调用还可能导致 ToolCallCard 与 TaskCard 同时出现（已在 U7 变更日志中标注为"v1 接受"）。
- `TaskCard.jsx` 对 `status === 'in_progress'` 无条件渲染 `Loader2 + animate-spin`，没有任何"是否是最后一张 TaskCard"的判断。
- `agent_end` 事件处理中不涉及 tasks bubble，因此 turn 结束后最新 TaskCard 中 `in_progress` 的任务也会继续转圈。

**候选方案**
1. **P0 · 只显示最新一张 TaskCard，旧的自动折叠 / 隐藏**：当 messages 里有多个 `kind:'tasks'` 的 bubble 时，只完整渲染**最后一个**，之前的只显示一行摘要（如"任务清单 · 2/4 已完成"）或彻底不渲染。因为 TodoWrite 本身就是原子替换语义（新数组覆盖旧数组），只有最新一张代表真实状态。
2. **P1 · 回溯染色**：TaskCard 渲染时，不看自己 bubble 里的 `tasks[]`，而是去 messages 里找**最后一个** `kind:'tasks'` 的 bubble，以它的 `tasks[]` 为准来确定状态。这样旧 card 也能显示"后来已完成"。但这打破了 bubble 的自包含性，实现复杂度高。
3. **P2 · 同 turn 合并**：如果同一个 assistant turn 内连续调了多次 `task_manager`，只保留最后一次的 TaskCard 气泡。需要在 event 处理层做 turn-level dedup。

**采用方案：P0 旧 card 折叠 + agent_end 降级**

**修改文件**
- `desktop/src/ui/components/knowclaw-v2/TaskCard.jsx` — 新增 `TaskCardSummary` 导出组件（紧凑一行：`[图标] 任务清单 · HH:MM · done/total 已完成`，无 spinner）
- `desktop/src/ui/components/agent-chat/MessageBubble.jsx` — `kind === 'tasks'` 分支接收 `isLatestTasksBubble` prop，true 渲染完整 `TaskCard`，false 渲染 `TaskCardSummary`
- `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx` — `useMemo` 计算 `lastTasksIndex`（messages 中最后一个 tasks bubble 的 index），map 时传 `isLatestTasksBubble` prop
- `desktop/src/ui/hooks/useKnowClawPersist.jsx` — `agent_end` case 的 `setMessages` 合并为单次调用：关闭 streaming assistant bubble + 倒序找最后一个 `kind:'tasks'` bubble 将 `in_progress` 降级为 `pending`

**行为效果**
- 同一对话中多次 `task_manager` 调用：只有最新一张 TaskCard 完整展示，旧 snapshot 折叠为一行淡色摘要（无 spinner），保留时间线感
- turn 结束（agent_end）：最新 TaskCard 中仍为 `in_progress` 的任务自动降级为 `pending`（灰圈无 spin），明确告知用户对话已停
- 只调一次 / history_loaded / rehydrate：只有一张 TaskCard，完整渲染，无折叠
- task_manager 出错：现有 `!event.isError` 守卫不 append bubble，无需特殊处理

#### D.6 决策状态

| 编号 | 严重程度 | 推荐优先级 | 状态 |
|------|---------|-----------|------|
| D.1 页面切换丢进度 | 高（用户看到"空白"会以为数据丢了） | P0 | **DONE**（2026-05-23） |
| D.2 意外延续旧会话 | 高（误操作 + 困惑） | P0 | **DONE**（2026-05-23） |
| D.3 新建会话不马上出现 | 中（反直觉但不阻塞工作） | P0–P1 | **DONE**（2026-05-24） |
| D.4 streaming 无法上滚 | 中（影响阅读体验） | P0 | **DONE**（2026-05-24） |
| D.5 旧 TaskCard 加载图标 | 低–中（误导但不阻塞） | P0 | **DONE**（2026-05-24） |

#### D.7 后续启动 Checklist（实现时回到本节核对）

- [x] D.1：确认 hook unmount 时 pi event 是否真的丢弃；在 `App.jsx` 做 state 提升 PoC — 已落地为 `KnowClawPersistProvider` + `knowclaw:rehydrate` IPC + session 锁定
- [x] D.2：确认 `ensureSession('continueRecent')` 是否总是续旧；测试 `newSession()` 在 `setCwd` 后自动调的可行性 — `setCwd`/冷启动自动 newSession + `send` 默认 mode 改 `'new'` + sessionGenRef 防竞态
- [x] D.3：确认 pi `SessionManager` 的 JSONL 创建时机；在 hook 里做乐观 UI 插入 — `_persist` 的 `hasAssistant` guard 确认；`newSession` 成功后 `setSessions` 乐观插入合成条目
- [x] D.4：在 messages 容器加 `onScroll` 检测 + `userScrolledUp` flag — `scrollContainerRef` + `handleScroll` 80px 阈值 + 条件 auto-scroll + 「回到底部」浮动按钮
- [x] D.5：在 `MessageBubble` 或 `KnowClawV2Page` 层面做"只完整渲染最后一张 TaskCard"逻辑 — `lastTasksIndex` + `isLatestTasksBubble` prop 路由 `TaskCard` / `TaskCardSummary`；`agent_end` 合并 `setMessages` 将 `in_progress` 降级 `pending`

---

### Backlog-E · KnowClaw V2 下一阶段体验升级七项（2026-05-20 规划采集）

> **迁移来源**：`KNOWCLAW_UPGRADE_PLAN.md` § 附录 · Backlog-E（2026-05-20）  
> 该计划原节已加迁移指引，权威更新位置已切换为本节。

U8 密集测试后采集的第二批优化方向，侧重 UI 品质、交互丰富度和功能深度。与 Backlog-D（核心 bug）互补，D 修基础稳定性，E 拉体验上限。

#### E.1 对话侧边快速导航（参考 DeepSeek）

**需求描述**
在对话区域最右侧（或 scrollbar 附近）增加一个类似 DeepSeek 的节点导航条：每一个 user 消息 / assistant 回复 / 工具调用 / TaskCard 等关键节点映射为一个小横杠或圆点。默认只显示竖线上的小 marker，hover 后弹出该节点的摘要文本（如"用户：帮我分析这份合同" / "KnowClaw：法律意见书草稿"），点击后 `scrollIntoView` 快速定位。

**设计要点**
- 长对话场景价值极高——目前超过 10 轮对话后上下翻找非常痛苦。
- **只以 user 消息作为锚点**，不需要 assistant 回复、工具调用等节点。逻辑简单：遍历 `messages[]`，筛 `role === 'user'`，取前 20 字作为 hover 摘要。
- 定位实现：每个 user bubble 挂 `id` 或 `ref`，导航栏点击时 `document.getElementById(id).scrollIntoView()`。
- 导航条固定在对话区域右边缘，不占 content 宽度（`position: absolute` / `sticky`），高度与对话区域 scrollbar 等高，marker 按 scrollHeight 比例分布。

**参考**
- DeepSeek web 端右侧导航条 UI
- VS Code minimap 思路（按比例映射）

**实现记录（2026-05-24）**

采用方案：DeepSeek 风格右侧浮动导航条，仅以 user 消息作为锚点，hover 显示摘要 tooltip，点击 smooth scrollIntoView 跳转。

**v1（已废弃）**：marker 为小圆点、按 `offsetTop / scrollHeight` 比例分布、紧贴右边缘、附视口指示条。
**v2（已废弃）**：marker 为短横线、垂直居中堆叠、单个 hover 时弹出 tooltip。仍不符合 DeepSeek 真实交互。
**v3（最终采纳，参考 DeepSeek 截图 1:1 实现）** — 折叠 / 展开两态浮动卡片：

- **折叠态（默认）**：仅一列短横线 marker，距右边缘 12px，垂直居中。卡片背景透明、无阴影、无文字 — 看起来只是侧栏的简洁装饰
- **展开态（hover 整个 nav 区域）**：卡片变白色面板（`bg-white/95 + ring-slate-200 + shadow-lg + backdrop-blur-sm`，与「回到底部」按钮、WorkspaceFileTree 同套浅色调）+ 每条 tick 左侧的摘要文本（24 字）从 `max-w-0 opacity-0` 平滑展开到 `max-w-[220px] opacity-100`，文字默认色 `text-slate-600`
- **单条 hover（展开态下进一步 hover 某行）**：该行文字变 `text-blue-600 font-medium`，横线变长变粗变蓝（14×1 → 20×2 px，`bg-blue-500`）
- **卡片有 max-height**（`max-h-[70vh]`），节点过多时整个卡片内部纵向滚动（`overflow-y-auto scrollbar-hide`）
- **点击单条**：通过 `data-msg-index` 找到 DOM 节点 → `scrollIntoView({ behavior: 'smooth', block: 'start' })`

**技术实现**：使用 Tailwind v4 嵌套**命名 group**（`group/nav` + `group/item`），整个 hover 交互 CSS-only，无 React state 驱动 hover，避免 onMouseEnter 回调引起的 re-render 卡顿，鼠标在 tick → 文字间穿越也不会闪烁。

**最终文件**
- `desktop/src/ui/components/knowclaw-v2/ChatNavTrack.jsx`（~110 行）：
  - `useMemo` 从 `messages` 筛 `role === 'user'` 提取锚点 `{ index, snippet, hasMore }`（snippet 取 24 字，去除连续空白）
  - `scrollToAnchor(index)` → `el.scrollIntoView({ behavior: 'smooth', block: 'start' })`
  - `userAnchors.length < 2` 时 return null，单轮对话不渲染
  - 外层 `group/nav` 控制卡片显隐 + 文字宽度展开
  - 每个 `<button>` 加 `group/item` 控制单条高亮

**修改文件**
- `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`：
  - 导入 `ChatNavTrack`
  - `messages.map` 中每条消息外层包 `<div key={i} data-msg-index={i}>` wrapper，作为 nav 的 DOM 锚点
  - Chat body 的 `relative` 容器内，「回到底部」按钮之后插入 `<ChatNavTrack messages={messages} scrollContainerRef={scrollContainerRef} />`

**布局关系**：nav `right-3` + tick 宽 14-20px，与「回到底部」按钮 `bottom-4 right-6` 横向不冲突；nav 垂直居中、按钮居底部，Y 轴也基本不重叠

#### E.2 文件写入实时可视化（参考 Cursor）

**需求描述**
目前 KnowClaw 在执行 `write_file` / `edit_file` 等工具时，用户只能看到 ToolCallCard 的"正在执行..."然后变成"完成"，**完全看不到正在写/改的文件内容**。参考 Cursor 的效果：工具执行期间展开一个 diff/preview 面板，实时展示新建文件的全文或修改文件的 diff。

**设计要点**
- pi SDK 的 `write_file` / `edit_file` 工具在 `toolCall` content block 里携带 `input` 参数（文件路径 + 内容 / old_string + new_string）。
- 方案 A（**轻量**）：在 ToolCallCard 展开时，把 `toolCall.input` 里的内容渲染成一个语法高亮的代码块（新建文件）或 inline diff（编辑文件）。不需要额外 IPC，纯前端从已有事件数据提取。
- 方案 B（**重量**）：主进程在 `beforeToolCall` / tool 执行后推送 `file_preview` 事件，携带文件完整内容或 diff，渲染端做实时 preview tab。更接近 Cursor 效果但架构侵入大。
- 建议从方案 A 起步：解析 `toolCall` 事件中的 `input.content` / `input.old_string` / `input.new_string`，在 ToolCallCard 的展开区域渲染。

**实现记录（2026-05-24）**

**重要命名澄清**：pi SDK 实际工具名是 **`write` / `edit`**（不是 `write_file` / `edit_file`），edit 字段是 **`oldText` / `newText`**（不是 `old_string` / `new_string`）。计划文档原始描述是误名，代码中统一以 pi SDK 真实名称为准。

**采用方案**：方案 A（args 一次性快照） — `tool_execution_start` 时 args 已完整传到 renderer，本期实现「执行中即可预览」效果。方案 B（接 `message_update.toolcall_delta` 实现 LLM 流式逐字增量预览）留 v2，本期不做。

**新增文件**
- `desktop/src/ui/components/knowclaw-v2/FileChangePreview.jsx`（~190 行）：
  - `WritePreview`：头部显示 `path · N 行 · N 字符`，主体 `<pre>` 等宽字体 + `max-h-96` 滚动；> 800 行时只渲染首 200 + 尾 200 + 中间省略提示
  - `EditPreview`：头部 `path · N 处修改`；多 edit 时显示编号 `修改 N/M`；每个 edit 渲染两个 `<pre>` 块（红底 `bg-rose-50 border-l-2 border-rose-300 text-rose-700` 显示 oldText；绿底 `bg-emerald-50 border-l-2 border-emerald-300 text-emerald-700` 显示 newText）
  - `normalizeEdits` 兼容 pi legacy 格式：顶层 `oldText`/`newText` 自动包成单元素 `edits[]`；`edits` 为 JSON 字符串时 try-parse；同时支持旧的 `old_string`/`new_string` 字段名
  - `truncateEditText` 单个 oldText/newText 超过 200 行也截断中间
  - `shortenPath` 路径超过 60 字符时显示 `…/last3segments`
  - `args` 为 undefined / 工具不是 write/edit → return null
  - 不引入任何新 npm 依赖

**修改文件**
- `desktop/src/ui/components/agent-chat/MessageBubble.jsx`（ToolCallCard）：
  - 导入 `FileChangePreview`
  - 新增 `isFileMutator` / `hasPreviewableArgs` 判定
  - 解锁 busy 展开：`canExpand = hasPreviewableArgs || (!isBusy && !!tool.result)`
  - `autoExpandedRef` + `useEffect` 实现 write/edit 自动展开（仅在首次出现 args 时自动展开，之后尊重用户手动操作）
  - 展开区分流：
    - `hasPreviewableArgs` → `<FileChangePreview />` + 完成后底部追加迷你 result 提示（前 200 字 truncate，title 上挂完整 result）
    - 其他工具 → 现有 `<pre>` result panel（保持不变）

- `desktop/src/main/ipc/knowclaw.js`（`mapPiMessagesForRenderer`，L257-269）：
  - `toolCall` block 映射时补 `arguments` → `args`
  - 历史会话 / `openSession` / `rehydrate` 回放时 write/edit 也能预览，与实时会话体验对齐

**行为效果**
- LLM 调用 `write` 或 `edit` 工具瞬间：ToolCallCard 自动展开，全文 / 双块 diff 即刻呈现
- 工具完成：预览保留不动，底部追加一行迷你 result（如 `Successfully wrote 1234 bytes to ...`），用户可见但不抢主视觉
- 用户可随时点击 header 手动收起 / 再展开
- 历史会话切回：所有 write/edit 都能展开预览
- 超长文件（> 800 行）：截断防卡顿；超长 edit oldText/newText（> 200 行）：也截断

#### E.3 任务卡片 / 思考过程 / 处理过程的 UI 升级（参考 Cursor） — **DONE**（2026-05-24）

**需求描述**
模仿 Cursor 的展示效果，让 TaskCard、ThinkingBlock、ToolCallCard 的视觉层次更清晰、更专业：
- **TaskCard**：当前是简单的 checklist 列表。升级为类似 Cursor 的分组标题 + 进度条 + 子步骤缩进 + 完成态打钩动画。
- **ThinkingBlock**：当前是纯灰色折叠文字块。升级为左侧有脉冲动画条 + 内容区 monospace + 流式打字效果（已有打字效果但视觉不够强）。
- **ToolCallCard**：当前是紧凑的 name + status 展示。升级为：执行中时有动画 spinner + 工具名 + 简要参数摘要；完成后可展开查看完整 input/output；失败时红色高亮 + 错误信息。

**设计要点**
- 这是纯 UI 改造，不涉及数据流变更。
- 优先级：ToolCallCard 展示升级 > TaskCard 视觉升级 > ThinkingBlock 微调。
- 需要一次性做 design review（可以先出 Figma 或 HTML mockup），避免改完还要再调。

**实施范围与决策**

经与用户确认后缩减为两项，与已完成的 K2 / D.5 / E.2 改动互补：

| 子项 | 决策 | 说明 |
|---|---|---|
| ToolCallCard | **跳过** | K2（spinner / 摘要 / elapsed）+ E.2（write/edit 预览、busy 解锁、自动展开）已覆盖需求 |
| TaskCard 进度条 | **不做** | 用户选择保持简洁，header 文字 `X/Y 已完成` 已足够 |
| TaskCard 完成动画 | **不做** | 用户选择不引入动画，静态切换图标即可 |
| TaskCard 分组/缩进 | **不做** | 当前 pi SDK `task_manager` 数据为扁平列表（无 group / indent 字段），等数据模型支持后再做 |
| TaskCard 视觉打磨 | **做** | 卡片阴影、header 渐变、间距/图标微调、空态优化、Summary 风格统一 |
| ThinkingBlock shimmer 光条 | **做** | streaming 时左侧渐变色条上下循环扫，结束后变静态灰边框 |
| ThinkingBlock 流式光标 | **做** | streaming 时文本末尾追加 1px 闪烁竖线 |

**修改文件**

- `desktop/src/ui/components/knowclaw-v2/TaskCard.jsx`（~15 处 className 变更）：
  - **卡片容器**：`border border-gray-200` → `shadow-sm ring-1 ring-gray-100`，更细腻的边框 + 轻微阴影
  - **Header**：背景从纯色 `bg-gray-50/60` 改为 `bg-gradient-to-r from-gray-50/80 to-white` 微渐变；`py-2` → `py-2.5`
  - **TaskRow**：`gap-2.5 py-1.5` → `gap-3 py-2`；图标 `size={14}` → `size={15}`
  - **completed 状态**：`text-emerald-500` → `text-emerald-500/70`，`text-gray-400 line-through` → `text-gray-400/70 line-through`，已完成项视觉退后
  - **空态**：单行 italic 文字 → 居中 flex 布局 + `ListTodo` 浅色图标 + 更多 padding
  - **TaskCardSummary**：`border border-gray-100` → `ring-1 ring-gray-100 shadow-xs`，与主卡片风格统一
  - **列表区**：`px-3 py-1.5 divide-gray-50` → `px-3.5 py-2 divide-gray-100/60`，与 header 左对齐、分割线更明显

- `desktop/src/ui/components/agent-chat/MessageBubble.jsx`（ThinkingBlock）：
  - 内容区改为条件渲染：streaming 时用 `flex` 布局 + shimmer 光条 + 末尾光标；非 streaming 时保持原静态 `border-l-2 border-slate-200`
  - shimmer 光条：`w-0.5` 渐变背景（`#cbd5e1 → #f1f5f9 → #cbd5e1`）+ `backgroundSize: '100% 200%'` + `animation: thinkShimmer 1.8s linear infinite`
  - 闪烁光标：`<span className="inline-block w-px h-3.5 bg-slate-400 animate-pulse">`
  - 新增 `@keyframes thinkShimmer`：`background-position: 0% 0%` → `0% 200%`，放在 ThinkingBlock 内部 `<style>` 块（**而非 ThinkingIndicator**，因为 ThinkingBlock 进入 streaming 状态时 ThinkingIndicator 已卸载）

**行为**

- 普通对话（无 task / 无 thinking）：完全无变化
- TaskCard 出现：阴影 + 渐变 header + 更宽松行距，视觉更精致；completed 项更淡
- TaskCard 旧 snapshot（D.5 Summary）：自动对齐新风格
- ThinkingBlock 出现 + streaming：左侧光条上下流动 + 末尾光标闪烁，配合 thinking_delta 文本追加，效果如 Cursor 的"正在思考"动画
- ThinkingBlock streaming 结束（content 开始或 agent_end）：自动切回静态灰边框 + 光标消失
- 历史会话加载：所有 ThinkingBlock 默认折叠，展开后为静态灰边框（与现有行为一致）

#### E.4 子代理（Sub-Agent）执行可视化（参考 Cursor） — **DONE**（2026-05-24）

**需求描述**
当 KnowClaw 通过 `delegate_task` 启动子代理时，用户目前只能看到一个 ToolCallCard 显示 "delegate_task · running"，对子代理在做什么完全不可见。参考 Cursor 的效果：子 agent 的执行过程应该以内嵌折叠面板的形式展示，用户能看到子代理的思考过程、工具调用、中间结果。

**设计要点**
- **不需要展示子代理的思考过程、工具调用、中间结果**，只需要让用户知道"这个子代理的任务是什么"。
- 当前 `delegate_task` 的 ToolCallCard 只显示 "delegate_task · running"，完全不透明。改进方向：在 ToolCallCard 展开区域显示 `toolCall.input` 中的 `description`（子代理任务描述）和 `kind`（research / edit）。
- 完成后显示子代理的最终结论摘要（`toolResult.content` 的前 N 字），不需要完整执行日志。
- 实现上是纯 UI 侧改动：解析 `delegate_task` 的 `toolCall.input` 参数即可，不需要事件转发或子 session streaming 管道。复杂度大幅降低。

**实施范围与决策**

| 子项 | 决策 | 说明 |
|---|---|---|
| header summary bug 修复 | **做** | `summarizeToolArgs` 中 `delegate_task` 读 `a.description`，应为 `a.task`（与 pi 工具定义对齐），导致历史 bubble 摘要始终为空 |
| 任务描述显示 | **做** | 直接靠 header summary 行展示前 80 字任务描述，无需额外执行中卡片 |
| 执行中实时进度 | **跳过** | 已有 `streamingStdout` 暗色终端（K2 + U3）显示子代理 `[delegate_task \| research] Turn N/M · calls: K` 进度，足够 |
| 结构化结果卡片 | **做** | 新建 `DelegateTaskResult.jsx`：ok/error badge + kind badge + summary 文本 + 统计行 + 折叠文件列表 + error 详情，替代 raw JSON dump |
| busy 期间展开 | **不做** | 与 write/edit 不同，delegate_task 结果只有任务完成时才有意义，沿用「`!isBusy && tool.result` 才可展开」规则 |

**新增文件**
- `desktop/src/ui/components/knowclaw-v2/DelegateTaskResult.jsx`（~180 行）：
  - 解析 `tool.result`（JSON 字符串），失败时回退原 `<pre>` 渲染
  - **顶部状态行**：ok = true → 绿色 `完成` badge + `CheckCircle2`；ok = false → 红色 badge + 中文化的 `truncatedReason`（`已中止` / `超时` / `超出最大轮数` / `出错`）+ `AlertCircle`
  - **kind badge**（来自 `tool.args.kind`）：`research` → 蓝色 `只读研究`，`edit` → 琥珀色 `编辑模式`
  - **summary 区域**：`text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap`，`max-h-64 overflow-y-auto` 防超长溢出
  - **统计行**：`text-[11px] text-gray-400 font-mono`，格式 `N 轮 · M 次工具调用 · Xs/Xm Ys`，自动跳过 0 值
  - **`FileList` 组件**：`filesRead` / `filesModified` 各一个折叠列表，默认折叠，header `读取文件 · N` / `修改文件 · N`，展开后用 `shortenPath`（路径 > 60 字符显示 `…/last3segments`）+ `FileText` / `FilePenLine` 图标
  - **error 区域**：仅 `truncatedReason === 'error'` 时渲染，红底 `bg-rose-50 ring-1 ring-rose-100` + `font-mono`

**修改文件**
- `desktop/src/ui/components/knowclaw-v2/knowclawEventReducer.js`：`summarizeToolArgs` 中 `delegate_task` 读 `a.task`（修正字段名 bug）
- `desktop/src/ui/components/agent-chat/MessageBubble.jsx`：
  - import `DelegateTaskResult`
  - ToolCallCard 新增 `const isDelegateTask = tool.name === 'delegate_task'`
  - 展开区域 `!hasPreviewableArgs && tool.result` 分支内判断 `isDelegateTask`，是则渲染 `<DelegateTaskResult result={tool.result} args={tool.args} />`，否则回退原 `<pre>` 渲染

**行为**

- 子代理调用 live：header 行立刻显示 `委托子任务: <task 前 80 字>`；下方暗色终端实时滚动子代理进度
- 子代理完成（ok）：可展开后看到绿色「完成」+ kind badge + 子代理 summary + 轮次/调用次数/耗时 + 折叠的读写文件列表
- 子代理失败/超时/中止：红色 badge + 对应中文化原因 + （error 时）红底详情；统计区仍展示已发生的轮次和文件操作
- 历史会话回放：依赖 E.2 的 `args` 映射，kind badge 在历史 bubble 同样正确显示；header summary 也因 bug 修复而正常显示
- 非 delegate_task 工具：行为完全不变（write/edit 走 FileChangePreview；其他走原 `<pre>`）
- result JSON 解析失败（理论上不该发生）：优雅回退为原 raw `<pre>` dump

#### E.5 Plan 模式——先规划再执行（参考 Cursor Plan Mode）

**需求描述**
新增一个 "Plan 模式" 开关（类似 Cursor 的 Plan / Agent 模式切换），在此模式下：
1. LLM **只读不写**：不执行任何 `write_file` / `edit_file` / `bash` 等修改性工具，只使用 `read_file` / `list_files` / `search` 等只读工具收集信息。
2. LLM **主动提问**：当需求细节不清晰时，向用户发起结构化问题（选择题 / 确认题），用户在对话中选择后 LLM 继续完善方案。
3. LLM **输出 plan.md + 任务清单**：所有细节对齐后，自动生成一份 `plan.md` 文件（存入工作空间），同时通过 `task_manager` 创建任务清单。
4. **用户确认 Start**：plan 产出后，对话中出现一个 "开始执行" 按钮，用户点击后 LLM 切回 Agent 模式，按照 plan 逐步执行。

**设计要点**
- 核心机制：Plan 模式本质是**修改 system prompt + 限制可用工具集**。
  - 在 `promptBuilder.js` 中新增 Plan 模式 prompt 段落，强调"只读 + 先确认 + 产出 plan"。
  - 在 `bootstrap.js` 中，当 `mode === 'plan'` 时过滤掉写入类工具（`write_file` / `edit_file` / `bash`），只保留只读工具 + `task_manager`。
- **结构化提问**：可以利用 `task_manager` 工具的扩展（新增 `kind: 'question'`），或者新建一个 `ask_user` customTool，返回选项 UI 让用户选择。
- **"开始执行" 触发**：用户点击按钮后，hook 发送一条特殊的 steer/followUp 消息（如 `[PLAN_APPROVED] 按照上述方案开始执行`），同时切换工具集回完整模式。
- 这个功能复杂度较高（涉及 prompt / 工具集 / UI 三层改动），建议作为独立的 U9 阶段规划。

**实现概要（2026-05-24 完成）**

- **核心决策**
  - **不为切模式新建会话**：切换 Plan ⇄ Agent 在当前会话内进行，靠 `[MODE: plan]` 用户消息前缀 + system prompt 双模式段告知模型当前模式，避免割裂上下文与历史回放复杂度。
  - **完整功能实现**：包含 prompt 双模式段、`beforeToolCall` 拦截、`ask_user` 结构化提问、`save_plan` 落盘、"开始执行" CTA 一站式交付，不分阶段。
  - **Plan 模式允许 research delegate**：`delegate_task(kind='research')` 是只读探索，与 Plan 模式定位一致；只拦截 `kind='edit'`。
- **工具白/黑名单**
  - 黑：`write` / `write_file` / `edit` / `edit_file` / `bash` / `delegate_task(kind='edit')`，由 `beforeToolCall` 返回阻断原因，模型可读到原因并改换策略（如改用 `ask_user`、`save_plan`）。
  - 白：所有只读工具（read/list/grep/glob/search_web/fetch_web）+ `task_manager` + `delegate_task(kind='research')` + **Plan 模式专用**：`ask_user`、`save_plan`。
- **后端**
  - `knowclaw.js`：模块级 `currentPlanMode` + `knowclaw:setPlanMode` / `knowclaw:getPlanMode` IPC + `getStatus` 返回 `planMode`；`knowclawBeforeToolCall` 顶部新增 Plan-mode 拦截分支；`knowclaw:send` / steer / followUp 在用户消息前注入 `[MODE: plan]\n`；`mapPiMessagesForRenderer` 显示时剥离前缀；新增 `pendingAskUser` Map + `askUserViaRenderer(questions, signal)` + `knowclaw:askUserReply` handler；`runtime.createSession` 调用统一传入 `askUser: askUserViaRenderer`。
  - `pi-runtime/promptBuilder.js`：新增 `# 工作模式 (Plan / Agent)` 段，说明双模式行为、可用/禁用工具、`[MODE: plan]` 标识，以及 Plan 模式下应优先使用 `ask_user` / `save_plan` / `task_manager`。
  - `pi-runtime/bootstrap.js`：新增 `askUserTool` / `savePlanTool` 注册（位于 `task_manager` 之后）；`createAgentSession` 新增 `opts.askUser` 参数。
  - **新文件** `pi-runtime/tools/askUserTool.js`：`defineTool` 自定义工具，`parameters.questions` 为数组（每项含 `id` / `prompt` / `options` / `allow_multiple`），`execute` 调用 `opts.askUser` 等待 IPC 返回；处理 `{ cancelled }` / `{ timeout }` / `{ error }` / 正常答案四种结果，结果以 JSON 文本回给模型。
  - **新文件** `pi-runtime/tools/savePlanTool.js`：`defineTool` 自定义工具，写入 `<cwd>/.knowclaw/plans/<filename>.md`（默认 `plan-YYYYMMDD-HHmm.md`），含文件名 sanitize + `MAX_PLAN_BYTES` 上限，绕开 Plan 模式 write 拦截以保证方案可落盘。
- **桥层**
  - `preload.js`：暴露 `setPlanMode` / `getPlanMode` / `onAskUser` / `replyAskUser`。
- **前端**
  - `useKnowClawPersist.jsx`：新增 `planMode` state（在 `refreshStatus` 时同步）+ `setPlanMode`（IPC + 注入系统消息）+ `onAskUser` 监听（向 messages 注入 `kind: 'ask_user'` 气泡）+ `replyAskUser` / `cancelAskUser`（IPC 回写 + 标记气泡为 `answered`/`cancelled`）+ `startExecuting`（切回 Agent + 发送"请按照上述规划方案开始执行"消息）。
  - **新文件** `AskUserCard.jsx`：在对话气泡内渲染结构化问卷，单选 radio / 多选 checkbox，提交前禁用按钮，回复后 readonly 显示「已回复」或「已取消」；紫色品牌色。
  - `MessageBubble.jsx`：新增 `kind: 'ask_user'` 分支路由到 `AskUserCard`；签名增加 `onAskUserReply` / `onAskUserCancel`。
  - `KnowClawV2Page.jsx`：header 新增 `PlanModeToggle`（紫色品牌色，ClipboardList 图标，streaming 时 disabled）；message list 与 ChatInput 之间新增「开始执行」浮动 CTA（仅 Plan 模式且非 streaming 且 messages 非空时显示）；`<MessageBubble>` 透传 `onAskUserReply` / `onAskUserCancel`。
  - `knowclawEventReducer.js`：`summarizeToolArgs` 新增 `ask_user`（`${n} 个问题`）和 `save_plan`（`保存方案: <filename>`）摘要。

#### E.6 Header 响应式设计 + 状态持久化

**需求描述**
1. **响应式布局**：当前 header 在窗口较小或内容较多时元素互相挤压。需要渐进式隐藏策略：
   - 宽度充足：完整显示所有元素（工作空间 badge + ContextPill + TokenPill + 模型选择 + thinking 选择 + 子代理开关 + 压缩按钮 + 新对话按钮）
   - 宽度中等：工作空间 badge 收缩为 icon-only + 次要 pill 收缩为 icon
   - 宽度紧凑：折叠到 `...` 溢出菜单中（类似浏览器工具栏响应式）
2. **状态持久化**：TokenPill 和 ContextPill 在切换页面（D.1 问题）或切换会话时清零消失。即使 D.1 解决了 unmount 问题，切换会话时 `sessionStats` 和 `contextUsage` 也应该从 `getStatus` 重新 hydrate，而不是等到下一次 polling 才恢复。

**设计要点**
- 响应式：用 `ResizeObserver` 监听 header 容器宽度，按阈值切换 3 档布局。或者用 CSS container queries（Electron Chromium 版本应该支持）。
- 状态 hydrate：`refreshStatus` 在 mount 时立即调一次，其返回的 `sessionStats` / `contextUsage` 应该马上填充 state，不需要等 polling interval。需确认当前代码是否已经这样做（可能是但被 D.1 的 unmount 掩盖了）。

**实现概要（2026-05-24 完成）**

- **核心决策**
  - **响应式实现走 `ResizeObserver` + tier state**：监听 header 右侧容器的 `contentRect.width`，按阈值产出 `wide / medium / compact` 三档；不用 CSS container queries 是因为需要 JS 状态来驱动「溢出菜单是否挂载」这一行为，纯 CSS 做不到。
  - **完整溢出菜单**：compact 档把 6 个次要项（Model / Thinking / SubAgent / PlanMode / Compact / FileTree）折叠进 `...` popover，主要项（WorkspaceSelector / ContextPill / TokenPill / 新对话）始终常驻。
  - **不动 Pill 内部**：ContextPill / TokenPill 已经够紧凑且承载关键信息，本次只对外层布局做 tier 化；如未来实测仍挤压再单独优化。
- **响应式阈值与 hysteresis**
  - 初版：`wide >= 1180px`、`medium 880-1180px`、`compact < 880px`。
  - 2026-05-25 复修：全屏下同时打开历史会话栏 + 工作空间文件树时，中间聊天列会被两个 `w-72` 侧栏压窄，初版阈值仍会让 header 停在 medium/wide 并发生挤压；阈值上调为 `wide >= 1500px`、`medium 1180-1500px`、`compact < 1180px`。
  - **40px 滞回带**：避免拖动窗口边到阈值附近时反复抖动；上行需越过 `阈值 + 40px`，下行需越过 `阈值 - 40px`。
- **新文件**
  - `useHeaderTier.js`：`useHeaderTier(ref)` hook，`ResizeObserver` + `classifyWidth(width, prevTier)`（带 hysteresis），仅 tier 变化时 setState；mount 时 `getBoundingClientRect()` 同步播种避免首帧误判 `wide`；卸载时 disconnect observer。
  - `HeaderOverflowMenu.jsx`：`...` 触发按钮 + popover panel，纵向渲染 `Model / Thinking / SubAgent / PlanMode / Compact / FileTree` 六行（每行左侧 14px 灰色 label + 右侧原组件实例）；`mousedown` outside-click 关闭、Esc 关闭；嵌套的 ModelSelector / ThinkingLevelSelector 自身的下拉因为渲染在 popover DOM 子树内，与 popover 的 outside-click 不冲突；接受 `components={{ ModelSelector, ThinkingLevelSelector, ... }}` 注入避免循环依赖。
- **改动**
  - `KnowClawV2Page.jsx`：新增 `headerRowRef` + `const headerTier = useHeaderTier(headerRowRef)`；header 外层绑 ref 并加 `min-w-0`；secondary 控件用 `headerTier !== 'compact'` 整体条件渲染，传 `tier={headerTier}` 让组件内部决定 label；compact 档常驻控件保持但「新对话」按钮自动 icon-only 化；compact 档挂载 `<HeaderOverflowMenu>`，把 5 个 toggle + FileTree 转发进去。
  - 2026-05-25 复修：compact 档 header 改为上下两行（左侧标题/状态一行，右侧工具条一行），左侧标题区增加 `min-w-0` / `truncate`；compact 隐藏 API badge，非 wide 隐藏左侧 workspace badge（右侧 WorkspaceSelector 已承载该状态），避免左右侧栏同时打开时左侧 metadata 与右侧工具条互相挤压。
  - `ModelSelector` / `ThinkingLevelSelector` / `SubAgentToggle` / `PlanModeToggle` 签名增加 `tier = 'wide'` 可选 prop；`tier === 'wide'` 显示文字 label，否则 icon-only；ModelSelector 在非 wide 档下额外截断超过 12 字的 model 名（`首10字…`），完整名进 title 属性。
  - `useKnowClawPersist.jsx::openSession`：成功分支末尾追加 `void refreshStatus()`，修复历史会话切换后 ContextPill/TokenPill 清零、要等下一轮 polling 才回填的 bug；因 `refreshStatus` 在文件中声明在 `openSession` 之后，dep 数组省略并加 `eslint-disable react-hooks/exhaustive-deps` 注释规避 TDZ（与 E.5 `startExecuting` 同一模式，但此处选择不重排序代码）。
- **风险与坑位**
  - ResizeObserver 在 Electron 23+ 默认可用，无需 polyfill。
  - 嵌套 popover 的 outside-click：内层 dropdown 渲染在外层 popover DOM 子树内，外层 `!panelRef.contains(target)` 检查自然把内层视为「内部点击」，不会误关。
  - tier seed：mount 时同步用 `getBoundingClientRect` 播种，避免首帧渲染 `wide` 再被 RO 覆盖为 `compact` 导致一帧抖动。

#### E.7 对话中上传文件到工作空间

**需求描述**
允许用户在对话中上传任意文件（不仅限图片），文件直接保存到当前工作空间的指定文件夹下（如 `<workspace>/uploads/` 或 `<workspace>/过程文档/`），然后在对话中告诉 LLM "用户上传了 XX 文件到 YY 路径"，LLM 可以用 `read_file` 工具读取并处理。

**设计要点**
- 与 U8b 图片输入的区别：图片是内嵌 base64 传给 vision 模型的多模态输入；文件上传是落盘到工作空间让 LLM 用工具读取。
- UI：ChatInput 的附件按钮（ImagePlus 图标）需要扩展为通用附件按钮，支持图片（走 U8b 多模态链路）和文件（走上传落盘链路）。可以用文件类型判断：image/* → resize + base64；其他 → 保存到工作空间。
- IPC：新增 `knowclaw:uploadFile` handler，接收 `{ fileName, data: ArrayBuffer, targetDir? }`，写入工作空间目录，返回绝对路径。
- 对话整合：上传成功后，自动在对话中插入一条 system 提示 "用户上传了文件：`<path>`"，或作为 user message 的附带信息传给 LLM。
- **具体的目标文件夹策略、文件大小限制、重名处理等需要进一步讨论后决定**，本阶段仅记录需求。

**实现概要（2026-05-24 完成）**

E.7 实际实施时与最初需求做了重要扩展：除文件上传外，还把文件树升级为「双击打开 + 单击选中 + 拖拽交互」，并通过拖拽实现了上传与文件引用的统一入口（替代附件按钮方案）。

- **核心决策**
  - **不走 ChatInput 附件按钮路径**，改为「拖拽优先」：① 文件树文件拖到 input 插入 `@relPath` 引用；② 系统文件拖到文件树目录上 = 复制到该目录；③ 系统文件拖到 input = 复制到工作空间根 + 自动插入 `@` 引用。对用户更直观，且与现有图片拖拽 UX 一致。
  - **`@` 引用前后端分离展示**：用户看到的对话气泡保留 `@过程文档/合同.docx` 自然语法（类似 Cursor）；发给 LLM 的实际 payload 是 `[文件引用 — 请用 read_file 读取以下工作空间相对路径]\n- 过程文档/合同.docx\n\n<用户原文>`，让模型可直接用 `read_file` 读取，避免 `@` 语义歧义。
  - **上传目标 = 拖入位置**：拖到文件树某目录上落到该目录（IDE 风格）；拖到根 / 拖到 input 落到工作空间根。重名自动加 `(1)`、`(2)` 后缀。
  - **单击改选中、双击改打开**：原本单击直接打开太激进，新加蓝色选中态作为「我要对这个文件做点什么」的中转，双击才走 `shell.openPath`。
  - **Electron 39 用 `webUtils.getPathForFile`**：`File.path` 在 Electron 32+ 已废弃；项目已在 preload 暴露 `window.ipm.files.getPathForFile`，复用即可。
- **后端**
  - **新增 IPC `knowclaw:uploadToWorkspace`**（`knowclaw.js`）：入参 `{ filePaths: string[], destRelDir?: string }`，逐一 `fs.copyFileSync` 到 `cwd/destRelDir`。包含容器边界校验（防 `../` 穿越）、目录存在性检查、单文件 100MB 上限、重名 `name (N).ext` 自增后缀（`nextAvailableName` 辅助函数，1..999 + 时间戳兜底）、跳过目录与超大文件并在返回 `skipped` 里说明原因。全局模式下拒绝上传（要求先选工作空间）。
  - 返回：`{ ok, uploaded: [{ name, relPath, size, src }], skipped: [{ src, reason }] }`，`relPath` 用 POSIX 分隔符方便 LLM 用 `read_file`。
- **桥层**
  - `preload.js` 新增 `knowclaw.uploadToWorkspace(filePaths, destRelDir)` 转 IPC。
- **前端**
  - **`WorkspaceFileTree.jsx` 大改**：
    - `TreeNode` 加 `onDoubleClick` 触发原 `onOpenFile`、`onClick` 改为选中（文件）或 toggle（目录）；选中态 `bg-blue-50 ring-1 ring-blue-300`。
    - 文件 `draggable`，`onDragStart` 写 `text/knowclaw-file-path` + 兜底 `text/plain` 都设为 `relPath`。
    - 目录行 `onDragOver` 检测 `Files` MIME 后 `preventDefault` 并 `stopPropagation`（防冒泡到 panel），通过 `dropTargetDir` state 高亮当前 hover 的目录。
    - 整个 `<aside>` panel 接收系统文件 drop 作为兜底（落到根目录）；hover 时显示蓝色 ring + 居中浮动「放开以上传到工作空间根目录」提示。
    - 切换 cwd 时清空 `selectedPath`，避免跨工作空间的陈旧选中；点击 panel 空白也清选中。
    - 全局模式 / 空树时给出「可以拖入文件」引导文案。
    - 导出常量 `TREE_DRAG_MIME = 'text/knowclaw-file-path'`。
  - **`ChatInput.jsx` 扩展 onDrop**：
    - 新增 prop `onUploadFiles(filePaths, destRelDir) → Promise<{ ok, uploaded, skipped }>`，缺省时仅处理图片。
    - `handleDragOver` 同时识别 `TREE_DRAG_MIME`、`Files`，根据情况设 `dragKind = 'file' | 'image'`。
    - `handleDrop` 优先级：① `text/knowclaw-file-path`（文件树拖来）→ 在 caret 插入 `@relPath ` 不走上传；② 图片 → 原 `addFiles` 链路；③ 其他系统文件 → 调 `onUploadFiles`，上传成功后批量在 caret 插入 `@relPath`。
    - `insertReferences` 智能插入：focus 在 textarea 时用 `selectionStart/End` 在光标位置插入并 reposition caret；未 focus 则追加到末尾。前后自动补空格防止与已有文字粘连。
    - 视觉：drop 期间整个 composer 加蓝色 ring + 中央 pill `放开以添加文件引用` / `放开以添加图片附件`；上传中右上角显示 `正在上传...` 小 spinner。
    - 底部 hint 行追加 `· 可从文件树或本机拖入文件引用`（仅当 `onUploadFiles` 传入时）。
  - **`useKnowClawPersist.jsx` 新增 `uploadToWorkspace` action**：调 IPC + 自动 `loadWorkspaceTree()` + 按 `uploaded` / `skipped` 数量发 success/warn/error toast；首个失败文件名显式列出，后续合并为「另 N 个」。
  - **`useKnowClawPersist.jsx` 新增 `@` 引用 → LLM 展开**：
    - 模块级 helper `extractFileRefs(text)` + `expandFileRefsForLlm(text)`，正则 `/(^|[\s(\[{,;])@([^\s@()[\]{},;]+\.[A-Za-z0-9]{1,8})/g` 匹配带扩展名的 `@ref`，要求 `@` 前是空白或常见标点防止 email 误命中。
    - `sendMessage` / `steerMessage` / `followUpMessage` 调用前用 `expandFileRefsForLlm` 改写 IPC 文本；UI 气泡保留用户原文 with `@`。
    - 展开格式：`[文件引用 — 请用 read_file 读取以下工作空间相对路径]\n- path1.ext\n- path2.ext\n\n<原文>`。
  - **`KnowClawV2Page.jsx`**：从 hook 取 `uploadToWorkspace` 并透传给 `<ChatInput onUploadFiles>` 和 `<WorkspaceFileTree onUpload>`。
- **风险与坑位**
  - `File.path` 在 Electron 32+ 已移除，通过 `webUtils.getPathForFile()`（已暴露在 `window.ipm.files.getPathForFile`）替代；保留 `f.path` 作为旧 Electron 兜底。
  - 目录拖拽：源是目录时 `srcStat.isDirectory()` 返回 true，直接 `skipped`（不递归），与 IDE 上传行为一致。
  - 路径穿越：`path.relative(cwd, destAbs)` 以 `..` 开头或 `path.isAbsolute(rel)` 即拒绝。
  - 嵌套 dragover 事件：目录行 `stopPropagation` 防止冒泡到 panel，否则会双重高亮。
  - `@` 正则：要求带扩展名 + `@` 前是空白/标点，可大幅减少 email/handle 误命中；用户可能输入不带扩展名的 `@文件夹` 引用，本期不支持（保持简单）。

#### E.8 决策状态

| 编号 | 复杂度 | 推荐阶段 | 状态 |
|------|-------|---------|------|
| E.1 侧边快速导航 | 中（纯 UI，~200 行） | U9 或独立 sprint | **DONE**（2026-05-24） |
| E.2 文件写入可视化 | 中–高（方案 A 低侵入，方案 B 架构改） | U9 | **DONE**（2026-05-24，方案 A；toolcall_delta 流式增量留 v2） |
| E.3 UI 品质升级 | 中（纯 UI，需 design review） | U9 | **DONE**（2026-05-24，TaskCard 视觉打磨 + ThinkingBlock shimmer 光条 + 流式光标） |
| E.4 子代理可视化 | 低（纯 UI，解析 toolCall.input 展示任务描述） | U9 | **DONE**（2026-05-24，summarizeToolArgs bug 修复 + DelegateTaskResult 结构化结果卡片） |
| E.5 Plan 模式 | 高（prompt + 工具集 + UI 三层） | U9 独立阶段 | **DONE**（2026-05-24，双模式 prompt + `beforeToolCall` 拦截 + `ask_user` / `save_plan` 自定义工具 + `[MODE: plan]` 前缀 + `PlanModeToggle` + 「开始执行」CTA） |
| E.6 Header 响应式 + 状态持久化 | 低–中（CSS + hydrate 修复） | 随 D.1 一起做 | **DONE**（2026-05-24，`useHeaderTier` ResizeObserver + hysteresis + `HeaderOverflowMenu` compact 档溢出菜单 + 4 toggle 接受 tier prop + `openSession` 追加 `refreshStatus()` 修复 pill 不重填） |
| E.7 文件上传到工作空间 | 中（IPC + UI + 策略待定） | 需进一步讨论 | **DONE**（2026-05-24，`knowclaw:uploadToWorkspace` IPC + WorkspaceFileTree 双击/选中/拖出/拖入上传 + ChatInput 接收文件树拖拽与系统文件拖拽 + `@relPath` 引用前端显示 + LLM payload 展开为 read_file 提示） |

#### E.9 后续启动 Checklist（实现时回到本节核对）

- [x] E.1：确定导航条 UI 形态（竖线 marker vs minimap vs 浮动目录）；节点仅取 user 消息 — 新增 `ChatNavTrack.jsx` 右侧固定导航条 + `data-msg-index` DOM 锚点 + `ResizeObserver` 比例映射 + hover tooltip + click-to-scroll
- [x] E.2：先做方案 A（从 toolCall.input 提取内容渲染 diff），评估效果后决定是否做方案 B — 已落地 `FileChangePreview.jsx`（write 全文 + edit 极简 oldText/newText 双块）+ ToolCallCard busy 自动展开 + `mapPiMessagesForRenderer` 补 args 历史回放
- [x] E.3：TaskCard 视觉打磨（shadow + ring + 渐变 header + completed 透明度 + 居中空态 + Summary 风格统一） + ThinkingBlock streaming 时 shimmer 光条 + 末尾 1px 闪烁光标；ToolCallCard 已由 K2 + E.2 覆盖故跳过；分组/缩进/进度条/完成动画用户决定不做
- [x] E.4：修复 `summarizeToolArgs` 中 `delegate_task` 字段名 bug（`description` → `task`）；新增 `DelegateTaskResult.jsx`（ok/error + kind badge + summary + 轮次/调用次数/耗时统计 + 折叠的读写文件列表 + error 详情），ToolCallCard 为 `delegate_task` 路由到该组件；执行中靠已有 streamingStdout 暗色终端展示进度
- [x] E.5：双模式 prompt（`# 工作模式 (Plan / Agent)` 段 + `[MODE: plan]` 用户消息前缀）+ `beforeToolCall` 拦截 write/edit/bash/`delegate_task(edit)`（research delegate 仍放行）+ 新增 `ask_user` / `save_plan` 自定义工具 + `AskUserCard.jsx` 结构化问卷气泡 + `PlanModeToggle` header 按钮 + Plan 模式下「开始执行」浮动 CTA + `useKnowClawPersist` 全链路 state 与 IPC 桥
- [x] E.6：`useHeaderTier.js` ResizeObserver + 1180/880px 阈值 + 30px hysteresis 三档 tier；`HeaderOverflowMenu.jsx` compact 档纵向 popover 折叠 Model/Thinking/SubAgent/PlanMode/Compact/FileTree；4 toggle 组件接受 `tier` prop 控制 label 显隐；`openSession` 成功分支追加 `void refreshStatus()` 立即重填 ContextPill/TokenPill
- [x] E.7：实施时与初始需求大幅扩展 — 改为「拖拽优先」交互（替代附件按钮路径）：文件树双击打开 + 单击选中 + draggable 拖出 + 整 panel 接收系统文件 drop（拖到目录=复制到该目录；拖到 panel 空白=复制到根）；ChatInput 同时接收文件树拖拽（插入 `@ref`）与系统非图片文件拖拽（先 IPC 上传到根 + 自动插入 `@ref`）。新 IPC `knowclaw:uploadToWorkspace`（100MB 上限 + 路径穿越校验 + `name (N).ext` 重名自增 + 跳过目录）。`@relPath` 双层语义：UI 气泡保留 `@xxx.ext` 自然语法、IPC payload 展开为 `[文件引用 — 请用 read_file 读取...]\n- path\n\n<原文>` 让 LLM 直接 read_file

---

## 附录 · 变更记录（文档级）

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-21 | 创建 | 文档初版。立项 F1–F4 / K1–K3 七个新阶段；从 `KNOWCLAW_UPGRADE_PLAN.md` 迁入 Backlog-D / Backlog-E 全文，原文已加迁移指引 |
| 2026-05-22 | F1 设计收敛 | F1 全部 10 项设计决策确认；代码审查发现 4 个架构级问题（P0-1/P0-2/P1-3/P1-4）并制定解决方案；引入双根路径解析模型；详细实施计划写入 `.cursor/plans/` |
| 2026-05-22 | F1 实施完成 | 附属壳 + 双根路径解析 + 外部目录扫描 + 前端/后端限制一致性全部落地，用户测试反馈的 guard 遗漏已修复 |
| 2026-05-22 | F2 实施完成 | Electron 隐藏窗口渲染 + HTTP 降级 + Markdown 转换 + 全页截图 + 截图管理 lightbox 全部落地 |
| 2026-05-22 | F3 实施完成 | `ppu-paddle-ocr` + `onnxruntime-node` 纯 Node.js OCR 方案落地：中英双模型 + 懒加载 + 空闲释放 + 截图/剪藏自动识别 + 手动触发 + snippet 碎片自动创建 |
| 2026-05-22 | K1 实施完成 | KnowClaw 新增 `search_web`（博查 API）+ 升级 `fetch_web(rendered=true)` 复用 F2 `webFetch`，并在设置页新增搜索 API Key 配置与测试连接；搜索失败按用户决策降级为引导输入 URL 后抓取 |
| 2026-05-23 | K2 实施完成 | 与 KnowClaw `Phase U1.5` 合流交付。新增 `knowclaw:listWorkspaceTree` IPC、右侧 `WorkspaceFileTree` 面板（折叠 / 文件大小 / 类型图标 / 文件点击）、`tool_execution_start` 触发的 `recentTouchedFiles` 5s 高亮、`agent_end` 后自动刷新；同步交付块 B：`MessageBubble` heartbeat 状态条（thinking / writing / tool / idle）+ 30s 空闲倒计时 + 工具参数摘要（write / edit / read / bash / search_web / fetch_web / task_manager 等）+ 完成耗时 |
| 2026-05-24 | D.1–D.5 实施完成 | Backlog-D 全部 5 项修复落地：D.1 `KnowClawPersistProvider` + `rehydrate` IPC + session 锁定；D.2 `setCwd`/冷启动自动 `newSession` + `sessionGenRef` 防竞态；D.3 `newSession` 乐观 UI 插入；D.4 `scrollContainerRef` + `handleScroll` 条件 auto-scroll + 「回到底部」浮动按钮；D.5 `lastTasksIndex` + `TaskCardSummary` 折叠旧 snapshot + `agent_end` 降级 `in_progress` → `pending` |
| 2026-05-24 | E.1 实施完成 | 新增 `ChatNavTrack.jsx` 侧边导航组件：`data-msg-index` DOM 锚点 + `ResizeObserver` 比例映射 + 视口指示条 + hover tooltip（前 20 字摘要）+ click smooth-scroll 跳转；仅 user 消息作为锚点，< 2 轮不渲染 |
| 2026-05-24 | E.1 UI 重做 | 用户反馈 v1 紧贴侧边、圆点形状、按位置分布不符合 DeepSeek 风格。v2 改为：横线 marker（"-"）+ 距右 12px 空隙 + 垂直居中堆叠（不反映滚动位置，是目录式）+ 节点过多时内部滚动 + 移除视口指示条 / 背景竖线 / offsetTop 计算 / ResizeObserver；组件体量从 ~200 行精简到 ~100 行 |
| 2026-05-24 | E.1 UI 再做（v3） | 用户进一步反馈 v2 仍未实现 DeepSeek 的「hover 弹出大卡片显示所有节点摘要」效果。v3 用 Tailwind v4 嵌套命名 group（`group/nav` + `group/item`）实现折叠/展开两态：折叠态仅显示一列横线 marker；hover 整个 nav 时卡片整体展开面板，所有摘要文本从 `max-w-0` 平滑展开到 `max-w-[220px]`；再 hover 单条时该行文字变蓝加粗、tick 变长变粗变蓝；卡片 `max-h-[70vh]` 内部滚动。CSS-only 交互，无 React state |
| 2026-05-24 | E.1 浅色风格对齐 | 用户反馈 v3 的深色卡片与页面浅色风格不搭。卡片改为浅色面板：背景 `bg-white/95`、ring `ring-slate-200`、阴影 `shadow-lg`、`backdrop-blur-sm`；文字默认 `text-slate-600`、hover `text-blue-600`；tick 默认 `bg-slate-300/80`、展开后 `bg-slate-400`、hover `bg-blue-500`。整体与「回到底部」按钮、WorkspaceFileTree 同套调色板 |
| 2026-05-24 | E.2 实施完成（方案 A） | 新增 `FileChangePreview.jsx`：write 显示全文代码块 + 字符/行数 meta + 超长截断（首 200 + 尾 200），edit 极简 diff（红底 oldText / 绿底 newText 双块 + N/M 编号 + 单段截断）；`MessageBubble.jsx` ToolCallCard 解锁 busy 展开 + `autoExpandedRef` 自动首次展开 + 分流渲染 + done 后底部追加迷你 result（200 字）；`knowclaw.js` `mapPiMessagesForRenderer` 补 `arguments → args` 让历史会话也能预览。修正命名：pi 真实工具名是 `write` / `edit`，字段是 `oldText` / `newText`。不引入 npm 依赖；toolcall_delta 流式增量留 v2 |
| 2026-05-24 | E.3 实施完成 | TaskCard 视觉打磨：卡片改为 `shadow-sm + ring-1 ring-gray-100`（去掉粗边框）、header 微渐变 `from-gray-50/80 to-white`、TaskRow `gap-3 py-2` + 图标 15px、completed 项加 `/70` 透明度退后、空态改为居中 flex + 浅色 `ListTodo` 图标、`TaskCardSummary` 对齐主卡风格 `ring + shadow-xs`、列表分割线 `divide-gray-100/60`。ThinkingBlock：streaming 时改 `flex` 布局，左侧 `w-0.5` shimmer 光条（渐变色 + `thinkShimmer` keyframes 上下循环扫）+ 文本末尾 `w-px h-3.5` 闪烁光标；streaming 结束后切回静态 `border-l-2 border-slate-200`。范围经用户确认后缩减：跳过 ToolCallCard（K2 + E.2 已覆盖）、不做分组/缩进/进度条/完成动画。纯样式改造，不引入 npm 依赖 |
| 2026-05-24 | E.7 实施完成 | 文件上传 + 文件树拖拽交互大改。决策：「拖拽优先」替代附件按钮路径（文件树→input 插入 `@ref`、系统→文件树目录复制到该目录、系统→input 复制到根+自动插入 `@ref`），`@relPath` UI 显示原文 + IPC payload 展开为 `read_file` 提示，目标目录=拖入位置（IDE 风格），单击选中/双击打开。后端：新增 IPC `knowclaw:uploadToWorkspace`（cwd 容器校验 + 单文件 100MB + 重名 `name (N).ext` 自增 + 跳目录 + 全局模式拒绝 + POSIX `relPath` 返回），preload 暴露同名 API。前端：`WorkspaceFileTree.jsx` 大改（TreeNode `onClick` 选 / `onDoubleClick` 开 / `draggable` 写 `text/knowclaw-file-path` 自定义 MIME / 目录 `onDragOver` 高亮单 dropTarget 用 `stopPropagation` 防冒泡；panel 兜底接收 drop 到根 + 蓝色 ring + 居中浮动提示 + 切 cwd 清选中 + 空树引导文案），导出常量 `TREE_DRAG_MIME`；`ChatInput.jsx` 新增 `onUploadFiles` prop + `handleDragOver/Drop` 三档优先（tree drag→插入 ref / 图片→走 addFiles / 其他→`onUploadFiles` 后插入 ref）+ `insertReferences` caret-aware 智能插入 + drop 期间蓝色 ring + 中央 pill 提示 + 上传中右上角小 spinner + 底部 hint 追加文案；`useKnowClawPersist.jsx` 新增 `uploadToWorkspace` action（IPC + 自动 `loadWorkspaceTree` + 三档 toast）和模块级 helper `extractFileRefs` / `expandFileRefsForLlm`（正则 `(^|[\s\(\[\{,;])@([^\s@\(\)\[\]\{\},;]+\.[A-Za-z0-9]{1,8})` 防 email 误命中），`sendMessage` / `steerMessage` / `followUpMessage` IPC 调用前用 expand 改写、UI 气泡保留 `@` 原文；`KnowClawV2Page.jsx` 透传 `uploadToWorkspace` 给 `<ChatInput onUploadFiles>` 和 `<WorkspaceFileTree onUpload>`。Electron 39 用已暴露的 `window.ipm.files.getPathForFile`（替代废弃的 `File.path`）。`vite build` 通过 |
| 2026-05-24 | E.6 实施完成 | Header 响应式 + 状态持久化双交付。决策：ResizeObserver + tier state（不走 CSS container queries，因为需要 JS 控制 overflow menu 挂载）；完整溢出菜单；不动 Pill 内部。新文件 `useHeaderTier.js`（1180/880px 阈值 + 30px hysteresis + 同步 seed 防首帧抖动 + tier ref 仅变化时 setState）；新文件 `HeaderOverflowMenu.jsx`（`MoreHorizontal` 触发 + popover panel 纵向 6 行 + mousedown outside-click + Esc 关闭 + components 注入避免循环依赖 + 嵌套 ModelSelector 下拉与外层 popover outside-click 天然不冲突，因下拉渲染在 popover DOM 子树内）。`KnowClawV2Page.jsx` 新增 headerRightRef + `headerTier`：右侧容器加 `min-w-0`；compact 档隐藏 secondary 控件块挂载 HeaderOverflowMenu；「新对话」按钮 compact 档自动 icon-only；FileTree 按钮 compact 档也进溢出菜单。`ModelSelector` / `ThinkingLevelSelector` / `SubAgentToggle` / `PlanModeToggle` 签名加 `tier='wide'` prop，`tier === 'wide'` 显示文字 label 否则 icon-only；ModelSelector 非 wide 档下额外截断 model 名为「首10字…」+ 完整名进 title。`useKnowClawPersist.jsx::openSession` 成功分支末尾追加 `void refreshStatus()` 修复历史会话切换后 ContextPill/TokenPill 清零、要等下一轮 polling 才回填的 bug；因 `refreshStatus` 声明在后，dep 数组省略并加 `eslint-disable react-hooks/exhaustive-deps`（同 E.5 startExecuting 模式）。`vite build` 通过 |
| 2026-05-24 | E.5 实施完成 | Plan 模式全链路落地。决策：不为切模式新建会话（用 `[MODE: plan]` 前缀 + 双模式 system prompt 协同），完整实现一次性交付，Plan 模式放行 `delegate_task(kind='research')` 但拦截 `kind='edit'`。后端：`knowclaw.js` 新增 `currentPlanMode` 模块状态 + `setPlanMode`/`getPlanMode` IPC + `getStatus` 返回 `planMode`；`knowclawBeforeToolCall` 顶部拦截 write/edit/bash + `delegate_task(edit)` 并返回中文阻断原因；`knowclaw:send`/steer/followUp 在 user content 前注入 `[MODE: plan]\n`；`mapPiMessagesForRenderer` 显示时剥离前缀；新增 `pendingAskUser` Map + `askUserViaRenderer(questions, signal)` + `knowclaw:askUserReply` handler；`runtime.createSession` 统一传 `askUser`。Runtime：`promptBuilder.js` 新增 `# 工作模式 (Plan / Agent)` 段说明双模式行为；`bootstrap.js` 注册 `ask_user` + `save_plan`；新增 `pi-runtime/tools/askUserTool.js`（向用户结构化问卷，IPC 等待）和 `pi-runtime/tools/savePlanTool.js`（写入 `.knowclaw/plans/<name>.md`，绕开 write 拦截）。桥：`preload.js` 暴露 `setPlanMode`/`getPlanMode`/`onAskUser`/`replyAskUser`。前端：`useKnowClawPersist.jsx` 新增 `planMode` state + `setPlanMode`（IPC + 注入系统消息）+ `onAskUser` 监听（注入 `kind:'ask_user'` 气泡）+ `replyAskUser`/`cancelAskUser` + `startExecuting`（切回 Agent + 发送执行指令）；新增 `AskUserCard.jsx` 紫色品牌色结构化问卷气泡（单选 radio / 多选 checkbox / 提交校验 / readonly answered/cancelled 态）；`MessageBubble.jsx` 新增 `kind:'ask_user'` 路由 + onAskUserReply/Cancel props；`KnowClawV2Page.jsx` header 新增 `PlanModeToggle`（ClipboardList 紫色 pill，streaming 时 disabled）+ messages/ChatInput 之间新增「开始执行」浮动 CTA（仅 Plan 模式 + 非 streaming + 非空 messages）+ 向 MessageBubble 透传 callbacks；`knowclawEventReducer.js` `summarizeToolArgs` 新增 `ask_user` / `save_plan` 摘要 |
| 2026-05-24 | E.4 实施完成 | 修复 `summarizeToolArgs` 中 `delegate_task` 字段名 bug（`a.description` → `a.task`，与 pi 工具定义对齐），让 header 行任务摘要正确显示。新增 `DelegateTaskResult.jsx`：解析子代理返回的 JSON 结果，渲染 ok/error badge（中文化的 `truncatedReason`：已中止/超时/超出最大轮数/出错）+ kind badge（research → 蓝色「只读研究」/edit → 琥珀色「编辑模式」）+ summary 文本 + 统计行（`N 轮 · M 次工具调用 · 耗时`）+ 折叠的读取/修改文件列表（`shortenPath` 截断长路径 + 图标）+ error 详情。JSON parse 失败时回退原 raw `<pre>` dump。ToolCallCard 为 `delegate_task` 路由结果到该组件。执行中沿用已有 `streamingStdout` 暗色终端展示进度，不引入额外面板 |

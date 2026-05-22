# IPM 功能升级计划 · Feature Upgrade Plan

> 本文档承载 **2026-05-21 起** 用户提出的「后续新功能 / 功能升级」线，与
> [`IPM_CORE_UPGRADE_PLAN.md`](./IPM_CORE_UPGRADE_PLAN.md)（核心稳定性修复，W1–W4
> 已 DONE）并列、与 [`KNOWCLAW_UPGRADE_PLAN.md`](./KNOWCLAW_UPGRADE_PLAN.md)
> （KnowClaw 引擎迭代 U0–U8 已 DONE，U9+ 规划中）形成三套独立但互相引用的演进
> 主线。
>
> F1/F2/F3 已 `DONE`（2026-05-22），F4/K1/K2/K3 仍为 `RESEARCH` / `PLANNED`。

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
| F4 | 内置长截屏 | `RESEARCH` | 强依赖 F3 闭环（已完成）；可能复用 `screenshots-record.json` 写入路径 |
| K1 | KnowClaw 网页搜索/抓取稳定性 | `PLANNED` | 现有 `desktop/Agent/pi-runtime/tools/webTools.js` `fetch_web`；与 F2 共底层 |
| K2 | KnowClaw 工作空间文件树侧栏 | `PLANNED`（合流） | 见 `KNOWCLAW_UPGRADE_PLAN.md` § Phase U1.5 |
| K3 | 悬浮窗 KnowClaw 助手 | `RESEARCH` | Backlog-A 已完成；需先看 Backlog-D（页面切换不丢进度）落地情况 |

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

---

### Phase F4 — 内置长截屏

**Status:** `RESEARCH`

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

**Status:** `PLANNED`

**目标**：解决 KnowClaw 内置的网页搜索 / 抓取在代理 / 反爬 / 404 等场景的高
失败率。

#### K1.1 用户原文（2026-05-21）

> 目前 KnowClaw 内置的网页搜索功能非常不稳定，代理或者其他情况会经常出现 404
> 或完全无法访问的错误，这个功能需要大幅度的升级。

#### K1.2 现状锚点

| 工具 | 路径 | 当前实现 |
|------|------|---------|
| `fetch_web` | `desktop/Agent/pi-runtime/tools/webTools.js` | Node 原生 `fetch` + simple strip HTML，无重试、无代理、无浏览器渲染 |
| 网页搜索 | （**待确认**：是否有独立的 search 工具，还是只有 fetch？） | 需要侦察 |

> **TODO·K1-A**：开工前先确认 KnowClaw 是否真的有"搜索"工具（如 `web_search`、
> `bing_search`、`duckduckgo`），还是用户口中的"搜索"实际是 LLM 自己构造 URL
> 调 `fetch_web`。这影响后续是"修 fetch"还是"加 search"。

#### K1.3 候选方案

| 方案 | 描述 |
|------|------|
| **A · 升级 `fetch_web` 底层为 F2 同一服务** | 直接复用 F2 的 Electron 隐藏窗口 / Browser 渲染，让 LLM 也享受 JS 渲染 |
| **B · 增加 `web_search` 工具** | 接入 DuckDuckGo / Bing API / Tavily / Brave Search，由 LLM 显式调用 |
| **C · 系统代理识别** | 自动读取 OS 代理设置 + 让用户在偏好里覆盖 |
| **D · 重试 + 多源策略** | 失败时自动按"原 URL → archive.org → google cache"顺序重试 |
| **E · 显式错误反馈给 LLM** | 当抓取失败时把 HTTP 状态码 / 错误类型 / 已尝试 URL 列表反馈到 toolResult，让 LLM 决定 retry / 换源 / 放弃 |

#### K1.4 待回答的问题

- [ ] **D-K1-1**：是否接受外部搜索 API（B 方案需要 key）？预算？
- [ ] **D-K1-2**：与 F2 是否共用一套底层？（高度推荐，避免双倍维护）
- [ ] **D-K1-3**：LLM 自动重试的次数上限 / 是否允许 LLM 自己决定？

---

### Phase K2 — KnowClaw 工作空间文件树侧栏 + 新文件高亮

**Status:** `PLANNED`（与 KnowClaw 主线合流）

**目标**：让 KnowClaw 对话区右侧显示当前工作空间文件树，对话产出 / 修改文件
后在树中高亮。

#### K2.1 用户原文（2026-05-21）

> KnowClaw 的工作空间应该要设计区域 UI，能够展示工作空间的文件树，而且在
> KnowClaw 生成产出新的文件的时候，可以在这个文件数中高亮新的文件方便用户
> 快速定位。

#### K2.2 与既有规划的关系

本诉求**与 `KNOWCLAW_UPGRADE_PLAN.md` § Phase U1.5 完全重叠**：

- U1.5 已设计：右侧 `WorkspaceFileTree` 面板、`knowclaw:listWorkspaceTree`
  IPC、监听 `tool_call/tool_result` 触发的 amber 角标 + "new/edited" 徽标 + 5s
  fadeout、`shell.openPath` 跳转
- U1.5 已估算改动 ~600 行（见 KnowClaw 计划 L303-L310）

**本计划的动作**：

- 不重复编写 K2 的设计草案；**直接对接 KnowClaw 计划 § Phase U1.5**
- 当 KnowClaw 主线启动 U1.5 时，在本节贴落地链接
- 用户在 2026-05-21 的再次强调 = U1.5 已经被列为"用户最关心"的体验缺口

#### K2.3 决策记录

- （待 U1.5 启动后填写）

---

### Phase K3 — 悬浮窗 KnowClaw 助手

**Status:** `RESEARCH`

**目标**：把现有悬浮窗从"剪贴板 + 截图捕获"升级为"可随时唤起的 AI 助手"，
拥有固定工作空间，对话与产出沉淀在该工作空间，中台模式下可将产物搬到任意
项目 / 案件。

#### K3.1 用户原文（2026-05-21）

> 我们的应用有悬浮窗的模式，这个模式也应该开发对接 KnowClaw，变成一个"可
> 随时唤起的 AI 助手"，而且这个悬浮窗模式有固定的工作空间，在这个模式下的
> 对话和产出都会在这个工作空间中，后续可以回到中台模式把产物移到需要的位置，
> 关于这个悬浮窗模式下的 KnowClaw 功能，我们还需要更多的探索和研讨。

#### K3.2 现状锚点

| 模块 | 路径 | 现状 |
|------|------|------|
| 悬浮窗 UI | `desktop/src/ui/components/floating/FloatingMode.jsx` | 仅剪贴板/截图捕获；Backlog-A 已让切换体验顺畅（2026-05-20 完成 G1.0~G1.2） |
| 主台 KnowClaw | `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx` | 完整对话 UI + 工作空间切换 |
| KnowClaw 引擎 | `desktop/Agent/pi-runtime/` | pi 0.74 + customTools + sessions |

#### K3.3 设计草案（高度待定）

- 悬浮窗里新增一个"问 AI"标签 / 切换段，输入框 + 简化版消息列表
- **固定工作空间路径**（候选）：
  - `userfile/_floating/<时间戳-会话名>/` —— 每次启动新建？
  - `userfile/_floating/default/` —— 永久单一工作空间，按 session 隔离？
  - 用户自选 → 持久化偏好
- 复用 `useKnowClawV2Chat` hook 但折叠掉"工作空间切换 / TaskCard / 子代理"
  等高级 UI；只保留输入 + 流式回复 + 工具调用最小可见
- "迁移产物"按钮：点击后弹一个"移动到..."项目/案件选择器，复用 W3a 已经实现
  的 `pathRemapper` 做安全移动

#### K3.4 待回答的问题（多，需进一步研讨）

- [ ] **D-K3-1**：悬浮窗 KnowClaw 是与主台共享同一个 pi 实例 / 同一会话生命周期，还是独立两套？（涉及到从悬浮窗发起的对话能否在主台继续）
- [ ] **D-K3-2**：固定工作空间路径策略（见 K3.3）
- [ ] **D-K3-3**：悬浮窗 KnowClaw 的最小可见 UI 包含哪些（输入 / 历史 / 任务卡片 / 思考块 / 工具调用 ...）？
- [ ] **D-K3-4**：依赖 Backlog-D.1（页面切换不丢进度）的完成度——如果 D.1 没解决，悬浮窗 ↔ 中台切换将立刻暴露同样问题
- [ ] **D-K3-5**：模型 / thinking 选择：在悬浮窗里收不收紧到一个默认模型，还是允许完整切换？
- [ ] **D-K3-6**：成本控制：悬浮窗"随时唤起"非常方便，但也容易触发非预期的 token 消耗，是否要单独限额？

#### K3.5 风险

- RW-K3-1：悬浮窗屏幕空间小，UI 简化与功能完整性之间难平衡
- RW-K3-2：从悬浮窗产出的文件需要被"中台模式发现并展示"——`refreshProjects`
  时机、`_floating/` 是否进入项目列表，要确定
- RW-K3-3：复用 `useKnowClawV2Chat` 会引入 Backlog-D 的所有未修 bug

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
| RW-K1-1 | 外部搜索 API key 暴露 / 成本失控 | K1 | 中 | 中 | 后端转发 + 用户可填自有 key |
| RW-K3-1 | 悬浮窗 UI 简化与完整性失衡 | K3 | 高 | 中 | 先出设计 mockup 再实现 |
| RW-K3-2 | 悬浮窗产物的"被中台发现"链路不通 | K3 | 中 | 中 | `_floating/` 默认进项目列表，标记为"草稿"域 |
| RW-K3-3 | 复用 hook 引入 Backlog-D 未修 bug | K3 | 高 | 高 | **强制依赖**：K3 启动前 Backlog-D.1/D.2/D.4 必须完成 |

---

## 5. 进度看板

| 阶段 / 条目 | Status | 完成日期 | 备注 |
|------------|--------|---------|------|
| F1 — 外部文件夹「附属导入」 | **DONE** | 2026-05-22 | 附属壳 + 双根路径解析 + 外部扫描 + 前端限制 guard |
| F2 — 网页完整信息抓取升级 | **DONE** | 2026-05-22 | Electron 隐藏窗口渲染 + HTTP 降级 + Markdown 转换 + 截图 lightbox |
| F3 — 内置 OCR（PP-OCRv5） | **DONE** | 2026-05-22 | `ppu-paddle-ocr` + `onnxruntime-node`，中英双模型，自动生成 snippet 碎片 |
| F4 — 内置长截屏 | RESEARCH | | F3 依赖已解除，可启动 |
| K1 — KnowClaw 网页抓取稳定性 | PLANNED | | 可复用 F2 的 `webFetch.js` |
| K2 — KnowClaw 工作空间文件树 | PLANNED | | **合流至** `KNOWCLAW_UPGRADE_PLAN.md` § Phase U1.5 |
| K3 — 悬浮窗 KnowClaw 助手 | RESEARCH | | 依赖 Backlog-D |

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
7. **KnowClaw 工作空间一目了然**：右侧文件树 + 新文件高亮（U1.5 主线交付）。

---

## 7. 术语表

- **附属文件夹 / 附属壳**：F1 引入的概念。指数据存储区里只放系统目录（`meta/`、
  `temp/`、`snippets/`）和 `external-link.json` 的"项目壳"，其业务"文件夹"
  通过 `structure.json` 镜像指向外部真实磁盘路径。
- **镜像节点**：`structure.json` 中代表外部磁盘文件夹的虚拟节点，由扫描产出。
- **附属壳扫描**：启动 / 手动刷新时遍历 `external-link.rootPath`，更新 mirror
  树并触发 `pathRemapper` 软重定向。
- **统一 webFetch 服务**：F2 + K1 共同的底层抓取实现，预计位置
  `desktop/Agent/services/webFetch.js`。
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

#### D.4 Streaming 期间无法上滚——强制锚定页面底部

**用户反馈原文**
> "LLM 在打字机生成回复的过程中，用户完全无法上拉，会一直被强制带到页面最下
> 看打字机生成。"

**根因分析（待侦察确认）**
- `KnowClawV2Page` 的消息列表底部有一个 `bottomRef`，配合 `useEffect` 在 `messages` 变化时 `scrollIntoView({ behavior: 'smooth' })`。Streaming 期间每次 token flush 都触发 → 用户滚上去 → 100ms 后被拉回来。

**候选方案**
1. **P0 · "用户已手动上滚" 检测 + 暂停自动滚**：在滚动容器上监听 `onScroll`，计算 `scrollTop + clientHeight < scrollHeight - threshold`（比如 threshold=80px），一旦成立设 `userScrolledUp = true`，暂停自动 scrollIntoView。当用户滚回底部（或 streaming 结束）时重置为 `false`。
2. **P1 · "回到底部" 浮动按钮**：当 `userScrolledUp && streaming` 时显示一个小的浮动按钮 "↓ 回到底部"，点击后 `scrollIntoView` + reset。类似 ChatGPT / Claude 的做法。

#### D.5 TaskCard 旧 snapshot 仍显示加载图标

**用户反馈原文**
> "对话中如果 LLM 开启了任务栏，会在完成某个任务后，显示新的任务清单，但旧的
> 任务清单还是会有加载图标，旧的对话同样也会显示加载，这对用户有一定的误导性，
> 以为之前的阶段还在加载。"

**根因分析（待侦察确认）**
- `task_manager` 工具被多次调用（每完成一步就调一次），每次调用产出一个 `kind:'tasks'` 的 system bubble 嵌在对话流里。**旧 snapshot 被冻结在它产生时的状态**，不会被后续 snapshot 回溯更新——所以 step-2 的 card 里 step-1 可能还是 `in_progress`，而最新 card 里 step-1 才是 `completed`。
- 同一 assistant turn 内的多次 `task_manager` 调用还可能导致 ToolCallCard 与 TaskCard 同时出现（已在 U7 变更日志中标注为"v1 接受"）。

**候选方案**
1. **P0 · 只显示最新一张 TaskCard，旧的自动折叠 / 隐藏**：当 messages 里有多个 `kind:'tasks'` 的 bubble 时，只完整渲染**最后一个**，之前的只显示一行摘要（如"任务清单 · 2/4 已完成"）或彻底不渲染。因为 TodoWrite 本身就是原子替换语义（新数组覆盖旧数组），只有最新一张代表真实状态。
2. **P1 · 回溯染色**：TaskCard 渲染时，不看自己 bubble 里的 `tasks[]`，而是去 messages 里找**最后一个** `kind:'tasks'` 的 bubble，以它的 `tasks[]` 为准来确定状态。这样旧 card 也能显示"后来已完成"。但这打破了 bubble 的自包含性，实现复杂度高。
3. **P2 · 同 turn 合并**：如果同一个 assistant turn 内连续调了多次 `task_manager`，只保留最后一次的 TaskCard 气泡。需要在 event 处理层做 turn-level dedup。

#### D.6 决策状态

| 编号 | 严重程度 | 推荐优先级 | 状态 |
|------|---------|-----------|------|
| D.1 页面切换丢进度 | 高（用户看到"空白"会以为数据丢了） | P0 | **DEFERRED** — 下一阶段首要 |
| D.2 意外延续旧会话 | 高（误操作 + 困惑） | P0 | **DEFERRED** |
| D.3 新建会话不马上出现 | 中（反直觉但不阻塞工作） | P0–P1 | **DEFERRED** |
| D.4 streaming 无法上滚 | 中（影响阅读体验） | P0 | **DEFERRED** |
| D.5 旧 TaskCard 加载图标 | 低–中（误导但不阻塞） | P0 | **DEFERRED** |

#### D.7 后续启动 Checklist（实现时回到本节核对）

- [ ] D.1：确认 hook unmount 时 pi event 是否真的丢弃；在 `App.jsx` 做 state 提升 PoC
- [ ] D.2：确认 `ensureSession('continueRecent')` 是否总是续旧；测试 `newSession()` 在 `setCwd` 后自动调的可行性
- [ ] D.3：确认 pi `SessionManager` 的 JSONL 创建时机；在 hook 里做乐观 UI 插入
- [ ] D.4：在 messages 容器加 `onScroll` 检测 + `userScrolledUp` flag
- [ ] D.5：在 `MessageBubble` 或 `KnowClawV2Page` 层面做"只完整渲染最后一张 TaskCard"逻辑

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

#### E.2 文件写入实时可视化（参考 Cursor）

**需求描述**
目前 KnowClaw 在执行 `write_file` / `edit_file` 等工具时，用户只能看到 ToolCallCard 的"正在执行..."然后变成"完成"，**完全看不到正在写/改的文件内容**。参考 Cursor 的效果：工具执行期间展开一个 diff/preview 面板，实时展示新建文件的全文或修改文件的 diff。

**设计要点**
- pi SDK 的 `write_file` / `edit_file` 工具在 `toolCall` content block 里携带 `input` 参数（文件路径 + 内容 / old_string + new_string）。
- 方案 A（**轻量**）：在 ToolCallCard 展开时，把 `toolCall.input` 里的内容渲染成一个语法高亮的代码块（新建文件）或 inline diff（编辑文件）。不需要额外 IPC，纯前端从已有事件数据提取。
- 方案 B（**重量**）：主进程在 `beforeToolCall` / tool 执行后推送 `file_preview` 事件，携带文件完整内容或 diff，渲染端做实时 preview tab。更接近 Cursor 效果但架构侵入大。
- 建议从方案 A 起步：解析 `toolCall` 事件中的 `input.content` / `input.old_string` / `input.new_string`，在 ToolCallCard 的展开区域渲染。

#### E.3 任务卡片 / 思考过程 / 处理过程的 UI 升级（参考 Cursor）

**需求描述**
模仿 Cursor 的展示效果，让 TaskCard、ThinkingBlock、ToolCallCard 的视觉层次更清晰、更专业：
- **TaskCard**：当前是简单的 checklist 列表。升级为类似 Cursor 的分组标题 + 进度条 + 子步骤缩进 + 完成态打钩动画。
- **ThinkingBlock**：当前是纯灰色折叠文字块。升级为左侧有脉冲动画条 + 内容区 monospace + 流式打字效果（已有打字效果但视觉不够强）。
- **ToolCallCard**：当前是紧凑的 name + status 展示。升级为：执行中时有动画 spinner + 工具名 + 简要参数摘要；完成后可展开查看完整 input/output；失败时红色高亮 + 错误信息。

**设计要点**
- 这是纯 UI 改造，不涉及数据流变更。
- 优先级：ToolCallCard 展示升级 > TaskCard 视觉升级 > ThinkingBlock 微调。
- 需要一次性做 design review（可以先出 Figma 或 HTML mockup），避免改完还要再调。

#### E.4 子代理（Sub-Agent）执行可视化（参考 Cursor）

**需求描述**
当 KnowClaw 通过 `delegate_task` 启动子代理时，用户目前只能看到一个 ToolCallCard 显示 "delegate_task · running"，对子代理在做什么完全不可见。参考 Cursor 的效果：子 agent 的执行过程应该以内嵌折叠面板的形式展示，用户能看到子代理的思考过程、工具调用、中间结果。

**设计要点**
- **不需要展示子代理的思考过程、工具调用、中间结果**，只需要让用户知道"这个子代理的任务是什么"。
- 当前 `delegate_task` 的 ToolCallCard 只显示 "delegate_task · running"，完全不透明。改进方向：在 ToolCallCard 展开区域显示 `toolCall.input` 中的 `description`（子代理任务描述）和 `kind`（research / edit）。
- 完成后显示子代理的最终结论摘要（`toolResult.content` 的前 N 字），不需要完整执行日志。
- 实现上是纯 UI 侧改动：解析 `delegate_task` 的 `toolCall.input` 参数即可，不需要事件转发或子 session streaming 管道。复杂度大幅降低。

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

#### E.7 对话中上传文件到工作空间

**需求描述**
允许用户在对话中上传任意文件（不仅限图片），文件直接保存到当前工作空间的指定文件夹下（如 `<workspace>/uploads/` 或 `<workspace>/过程文档/`），然后在对话中告诉 LLM "用户上传了 XX 文件到 YY 路径"，LLM 可以用 `read_file` 工具读取并处理。

**设计要点**
- 与 U8b 图片输入的区别：图片是内嵌 base64 传给 vision 模型的多模态输入；文件上传是落盘到工作空间让 LLM 用工具读取。
- UI：ChatInput 的附件按钮（ImagePlus 图标）需要扩展为通用附件按钮，支持图片（走 U8b 多模态链路）和文件（走上传落盘链路）。可以用文件类型判断：image/* → resize + base64；其他 → 保存到工作空间。
- IPC：新增 `knowclaw:uploadFile` handler，接收 `{ fileName, data: ArrayBuffer, targetDir? }`，写入工作空间目录，返回绝对路径。
- 对话整合：上传成功后，自动在对话中插入一条 system 提示 "用户上传了文件：`<path>`"，或作为 user message 的附带信息传给 LLM。
- **具体的目标文件夹策略、文件大小限制、重名处理等需要进一步讨论后决定**，本阶段仅记录需求。

#### E.8 决策状态

| 编号 | 复杂度 | 推荐阶段 | 状态 |
|------|-------|---------|------|
| E.1 侧边快速导航 | 中（纯 UI，~150 行） | U9 或独立 sprint | **DEFERRED** |
| E.2 文件写入可视化 | 中–高（方案 A 低侵入，方案 B 架构改） | U9 | **DEFERRED** |
| E.3 UI 品质升级 | 中（纯 UI，需 design review） | U9 | **DEFERRED** |
| E.4 子代理可视化 | 低（纯 UI，解析 toolCall.input 展示任务描述） | U9 | **DEFERRED** |
| E.5 Plan 模式 | 高（prompt + 工具集 + UI 三层） | U9 独立阶段 | **DEFERRED** |
| E.6 Header 响应式 + 状态持久化 | 低–中（CSS + hydrate 修复） | 随 D.1 一起做 | **DEFERRED** |
| E.7 文件上传到工作空间 | 中（IPC + UI + 策略待定） | 需进一步讨论 | **DEFERRED** |

#### E.9 后续启动 Checklist（实现时回到本节核对）

- [ ] E.1：确定导航条 UI 形态（竖线 marker vs minimap vs 浮动目录）；节点仅取 user 消息
- [ ] E.2：先做方案 A（从 toolCall.input 提取内容渲染 diff），评估效果后决定是否做方案 B
- [ ] E.3：产出 UI design mockup 或 HTML 静态页面，确认视觉方向后再动代码
- [ ] E.4：在 ToolCallCard 里解析 `delegate_task` 的 `input.description` + `input.kind` 展示；完成后展示 result 摘要
- [ ] E.5：作为 U9 独立规划，先做 prompt + 工具过滤 PoC，再做结构化提问 UI
- [ ] E.6：和 D.1 一起做；响应式用 ResizeObserver 还是 container queries 需测试
- [ ] E.7：与产品侧讨论目标文件夹策略、大小限制、重名处理后再开始实现

---

## 附录 · 变更记录（文档级）

| 日期 | 操作 | 摘要 |
|------|------|------|
| 2026-05-21 | 创建 | 文档初版。立项 F1–F4 / K1–K3 七个新阶段；从 `KNOWCLAW_UPGRADE_PLAN.md` 迁入 Backlog-D / Backlog-E 全文，原文已加迁移指引 |
| 2026-05-22 | F1 设计收敛 | F1 全部 10 项设计决策确认；代码审查发现 4 个架构级问题（P0-1/P0-2/P1-3/P1-4）并制定解决方案；引入双根路径解析模型；详细实施计划写入 `.cursor/plans/` |
| 2026-05-22 | F1 实施完成 | 附属壳 + 双根路径解析 + 外部目录扫描 + 前端/后端限制一致性全部落地，用户测试反馈的 guard 遗漏已修复 |
| 2026-05-22 | F2 实施完成 | Electron 隐藏窗口渲染 + HTTP 降级 + Markdown 转换 + 全页截图 + 截图管理 lightbox 全部落地 |
| 2026-05-22 | F3 实施完成 | `ppu-paddle-ocr` + `onnxruntime-node` 纯 Node.js OCR 方案落地：中英双模型 + 懒加载 + 空闲释放 + 截图/剪藏自动识别 + 手动触发 + snippet 碎片自动创建 |

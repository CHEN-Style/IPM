# IPM v2.1 C1-C9 强化规划 —— Enterprise Hardening · Admin Console · Desktop UX

> **目标**：暂停继续推进 C10-C13 外部生态阶段，集中强化 C1-C9 已完成的云端协作、Skill 生态与企业配置分发能力，让当前 v2.1 能力从“功能打通”升级为“企业可管理、可观测、可测试、可交付”的产品闭环。
>
> **前置**：`cloud/IPM_V2_1_CLOUD_DEVELOPMENT_LOG.md` 已记录 C0-C9 的功能建设。本文档不替代原开发日志，而是作为 C1-C9 强化阶段的专项规划。
>
> **约束**：沿用云端开发记录规范：每阶段首行 `Status:`；阶段末「变更日志」；单阶段保持可独立验证；超纲内容拆分到后续 H 阶段。

---

## 0. 阅读与维护说明

- 本文档只规划 C1-C9 强化内容；C10-C13 外部资料源与外部 Agent 导入暂缓。
- 强化阶段使用 **H0-H8** 编号，H 代表 Hardening，避免与原 C 系列混淆。
- 每完成一轮强化开发：更新对应阶段 `Status`、填写「变更日志」、刷新 §5 进度看板。
- 三条主线：
  1. **Platform Admin**：server 端超级管理员能力，面向 IPM 平台运营者。
  2. **Enterprise Admin**：企业 owner/admin 在 Desktop 内管理企业用户、项目、Skill、配置和数据。
  3. **Desktop UX Hardening**：云端项目、同步、版本、冲突、Skill 页面等 C 系列 UI/UX 与功能优化。
- 当前优先级共识：先补管理与治理能力，再重做关键 Desktop 体验，最后补观测、测试和交付检查。

---

## 1. 当前差距客观分析

### 1.1 C1-C9 从“功能完成”到“企业可交付”的核心差距

| # | 能力 | 当前状态 | 强化期望终态 |
|---|------|----------|--------------|
| H-G1 | 平台超级管理员 | 已有组织/用户数据模型，但缺少平台级管理入口 | 平台管理员可创建、停用、查看企业与核心状态 |
| H-G2 | 企业用户管理 | 有邀请/角色基础，但企业管理员缺少统一管理页面 | owner/admin 可管理成员、角色、邀请、停用与审计 |
| H-G3 | 企业云端项目治理 | Workspace API 已可协作，但管理员缺少全局视角 | 企业管理员可查看和治理企业内全部云端项目 |
| H-G4 | Skill 治理产品化 | C7/C8 已有市场、审核、授权，但页面偏功能堆叠 | Skill 审核、分发、安装、更新形成清晰管理流 |
| H-G5 | AI 配置分发产品化 | C9 已有模板和配置码，但缺少企业管理总览 | AI 配置模板进入企业控制台，支持清晰分发与追踪 |
| H-G6 | 云端项目 UI/UX | 发布、加入、拉取、同步、版本、冲突分散在多个入口 | 云端项目体验统一、状态清晰、错误可理解 |
| H-G7 | 数据监测与审计 | 有 events 表和部分记录，但未产品化 | 企业管理员可看关键指标、事件、风险和使用记录 |
| H-G8 | 测试与交付质量 | 已有阶段性验证，但缺少稳定回归矩阵 | C1-C9 形成固定测试清单和 release gate |

### 1.2 优先级排序

按「企业可用闭环 × 风险控制 × 用户体验痛点」排序：

| 优先级 | 差距 | 理由 |
|--------|------|------|
| **P0-基础治理** | H-G1 平台超级管理员 | 没有平台级企业管理，后续企业生命周期不可控 |
| **P0-企业治理** | H-G2 企业用户管理 | 企业版必须有 owner/admin 管理成员与角色 |
| **P1-核心治理** | H-G3 云端项目治理 | 管理员需要看到企业内项目资产与风险 |
| **P1-核心体验** | H-G6 云端项目 UI/UX | 当前 C4-C6 能力需要从功能入口变成顺畅产品流 |
| **P2-生态治理** | H-G4 Skill 治理产品化 | Skill 是企业分发能力核心，需要更稳定的审核与授权体验 |
| **P2-配置治理** | H-G5 AI 配置分发产品化 | C9 需要纳入企业管理，而不是孤立设置卡片 |
| **P2-可观测** | H-G7 数据监测与审计 | 企业管理需要数据支撑和审计追踪 |
| **P3-交付质量** | H-G8 测试与交付质量 | 作为 release gate，贯穿每个阶段收尾 |

---

## 2. 阶段总览

| # | 阶段 | 主要交付物 | 解决差距 | Status |
|---|------|------------|----------|--------|
| H0 | C1-C9 现状审计与信息架构 | 功能地图、角色矩阵、页面入口规划、回归测试矩阵 | H-G1~H-G8 | `DONE` |
| H1 | Platform Super Admin 基础 | 平台管理员身份、企业创建/停用/查看 API、最小管理入口；扩展：A5/A11 对象组织隔离、停用执行层、auth 限流 | H-G1 | `DONE` |
| H2 | Enterprise Admin 用户与角色管理 | 企业成员列表、邀请、角色调整、停用成员、审计事件 | H-G2, H-G7 | `DONE` |
| H3 | Enterprise Workspace 管理 | 企业项目总览、成员/owner 可视化、项目停用/归档、风险状态 | H-G3, H-G7 | `PLANNED` |
| H4 | Cloud Project UX 重构 | 云端项目首页、发布/加入/同步状态、版本/冲突/恢复统一体验 | H-G6 | `PLANNED` |
| H5 | Skill Governance UX 重构 | Skill 市场、审核、授权、安装更新、版本信息统一产品流 | H-G4 | `DONE` |
| H6 | Enterprise Config Center | AI 配置模板纳入企业控制台，配置码、使用记录、风险提示优化；config_json 静态加密 | H-G5, H-G7 | `DONE` |
| H7 | 企业数据监测与审计 + 平台 Web 控制台 | 企业 dashboard、events 查询、使用指标；平台超管 Web 控制台（cloud 侧托管页面） | H-G1, H-G7 | `DONE` |
| H8 | 回归测试、打包与交付加固 | C1-C9 e2e checklist、错误提示、网络失败处理、release gate | H-G8 | `DONE` |

> **说明**：H1-H3 建立管理能力骨架；H4-H6 优化 Desktop 核心体验；H7-H8 补齐企业可观测与交付质量。

---

## 3. 各阶段详细计划

---

### Phase H0 — C1-C9 现状审计与信息架构

**Status:** `DONE`（2026-06-12，审计报告见 `cloud/IPM_V2_1_H0_AUDIT.md`）

**目标**：在继续写功能前，系统梳理 C1-C9 已有 API、IPC、页面、数据表和用户角色，明确强化阶段的产品信息架构与回归测试范围。

**工作清单**

读：
- `cloud/IPM_V2_1_CLOUD_DEVELOPMENT_LOG.md`
- `cloud/server/src/modules/**/routes.ts`
- `cloud/server/src/infra/db/migrations/*.sql`
- `desktop/src/main/ipc/*.js`
- `desktop/src/ui/components/**`

写/改：
1. 建立 C1-C9 功能地图：账号、组织、workspace、sync、version、Skill、AI config。
2. 建立角色矩阵：platform super admin、org owner、org admin、member、workspace owner、workspace member。
3. 明确 Desktop 企业管理入口：是否作为 Settings 子页、独立 Enterprise Console，或侧边栏一级入口。
4. 明确 server 超级管理员入口：先 API/CLI，还是最小 Web Admin。
5. 建立 C1-C9 回归测试矩阵。

**验证方法**

- 产出可直接用于后续 H1-H8 的页面地图和 API 清单。
- 每个 H 阶段都能对应到明确角色、入口、API 和验收项。

**不做**

- 不实现新功能。
- 不重构现有同步引擎。

**变更日志**

- **H0 主体**（2026-06-12）：
  - 新增 `cloud/IPM_V2_1_H0_AUDIT.md`，包含全部 H0 交付物：
    - **功能地图**（§1）：七个功能域（认证 / 组织 / workspace / 同步版本 / Skill / AI 配置 / 基础设施）的「数据表 → API → IPC → UI」四层映射；服务端 46 个端点、桌面端 42 个云端 IPC 通道、16 个云端 UI 组件全量盘点。
    - **角色矩阵**（§2）：7 个角色 × 全能力矩阵；确认 Platform Super Admin 代码零痕迹、org owner 与 admin 代码层完全等价、workspace viewer 角色不可达。
    - **权限与 UX 差距清单**（§3）：服务端 A1-A10（核心：`orgs.status` 零处校验；objects 模块无组织隔离；JWT 无吊销且多数路由不复查成员状态）+ 桌面端 U1-U6（核心：云端状态呈现分散无共享 store；orgRole 无渲染层全局来源）。
    - **信息架构决策**（§4）：IA-1 Desktop 企业管理入口定为侧边栏一级「企业控制台」（仅 owner/admin 可见，子页：概览/成员/云端项目/Skill 治理/配置中心/审计）；IA-2 平台超管入口定为独立 `/api/platform/**` 前缀 + 服务器 CLI，不做 Web Admin；IA-3 统一企业/成员/workspace 三级停用语义（DB 层每请求校验，不做 token 黑名单）。
    - **回归测试矩阵**（§5）：25 行 C1-C9 回归场景（含 C5 历史 bug 的防回归项），标注自动化/手动方式，供各 H 阶段收尾与 H8 脚本化使用。
    - **H1-H8 输入映射**（§6）：每个后续阶段对应的差距编号、决策与现状基线（含 14 种既有 events 事件类型清单与 H7 缺口）。
  - 未实现新功能、未改动现有代码，符合本阶段「不做」边界。

---

### Phase H1 — Platform Super Admin 基础

**Status:** `DONE`（2026-06-12，含 A5/A11 对象隔离扩展，验证 30/30 通过）

**实施计划（2026-06-12 确认，决策点已由产品负责人拍板）**

| 决策点 | 结论 |
|--------|------|
| A5/A11 对象隔离方案 | 方案 A：objects 按组织隔离（`org_id` 列 + `UNIQUE(org_id, sha256)`），org 从 JWT 推导，新上传 storage key 改为 `blobs/{orgId}/sha256/...`，放弃跨组织去重；`upload-urls` 仅对 pending 行签发 PUT URL（修复 A11 内容投毒） |
| 平台管理员身份 | `platform_admins` 表 + 普通账号登录 + 每请求查表（即时可吊销，不进 JWT claim）；首个管理员经服务器 CLI 授予 |
| owner 指定/转移语义 | 指定即新增/升级为 owner，不自动降级原 owner，允许多 owner |
| login 限流（A7 部分提前） | `@fastify/rate-limit` 仅作用于 `/api/auth/*` |
| 停用执行层（IA-3） | 认证中间件每请求合并查询 `users + org_members + orgs` 状态，停用即时生效，不做 token 黑名单；错误响应增加机器可读 `code` 字段（`ORG_DISABLED`/`USER_DISABLED`/`MEMBER_DISABLED`） |

工作分解：migration `0007`（platform_admins + objects.org_id 回填 + 状态 CHECK 约束/A8）→ 中间件状态校验与 `orgRole` 装饰 → auth 路由（login/refresh 校验企业状态、平台管理员无组织登录、限流）→ objects 路由组织隔离 + versions 提交 org 校验 → platform 模块（service + routes + CLI，写 `platform.*` 审计事件）→ 桌面端错误 code 透传与中文提示 → e2e 验证与文档更新。

**目标**：补齐平台运营视角的超级管理员能力，让 IPM 平台方可以创建企业、停用企业、查看企业状态，并管理企业 owner 初始归属。

**产品边界**

- Platform Super Admin 是平台级角色，不等同于任何企业内 owner/admin。
- 首期只做企业生命周期与基础状态，不做复杂计费系统。
- 超级管理员能力优先放在 server 端 API 与最小管理入口，Desktop 企业管理员不能访问平台级功能。

**工作清单**

写/改：
1. 新增平台管理员身份模型或环境白名单机制。
2. 新增平台管理 API：
   - 创建企业。
   - 停用/恢复企业。
   - 查看企业列表和企业详情。
   - 指定或转移企业 owner。
3. 对 auth 和 org 查询增加企业停用状态校验。
4. 记录平台管理审计事件。
5. 提供最小可用管理入口：CLI 或轻量 server admin 页面。

**验证方法**

- 平台管理员可创建企业并指定 owner。
- 被停用企业用户无法继续使用云端协作 API，并收到可读错误。
- 恢复企业后原用户可继续登录和访问。
- 普通用户、企业 owner/admin 无法调用平台 API。

**不做**

- 不做计费、套餐、License 自动化。
- 不做复杂平台 dashboard。

**变更日志**

- 2026-06-12 H1 完成（含 A5/A11 对象组织隔离提前并入）：
  - **数据库**（migration `0007_platform_and_object_scope.sql`）：
    - 新表 `platform_admins`（user_id UNIQUE + granted_by + note），平台管理员按表授予、每请求查表、即时可吊销。
    - `objects` 增加 `org_id NOT NULL`；存量数据三级回填（引用 workspace → 上传者所属 org → 删除孤儿行）；迁移前置守卫：检测到对象被多组织引用则显式中止。`UNIQUE(sha256)` 改为 `UNIQUE(org_id, sha256)`，`storage_key` 唯一约束改普通索引。
    - 补 `users/orgs/org_members/workspaces.status` CHECK 约束（A8），`workspaces` 预留 `archived` 给 H3。
  - **认证中间件**（`middleware/auth.ts` 重写）：JWT 解出后单次合并查询 `users + platform_admins + org_members + orgs`，每请求校验用户/成员/企业状态（A1/A2/A6 修复，停用即时生效，无 token 黑名单）；装饰 `request.orgRole`/`request.isPlatformAdmin`；`/api/platform/**` 仅平台管理员可达；错误响应带机器可读 `code`（`ORG_DISABLED`/`USER_DISABLED`/`MEMBER_DISABLED`/`PLATFORM_FORBIDDEN` 等）。
  - **auth 路由**：login/refresh 增加企业停用校验（返回 `ORG_DISABLED`）；平台管理员允许无组织登录（JWT `orgId: null`）；`/api/auth/register|login|refresh` 接入 `@fastify/rate-limit`（20 次/分钟，A7 部分提前，429 + `RATE_LIMITED`）。
  - **objects 路由组织隔离**（A5/A11）：四个端点全部以 JWT `orgId` 过滤；新上传 storage key 改为 `blobs/{orgId}/sha256/...`（存量 blob 不搬迁，`storage_key` 列权威）；`upload-urls` 仅对 `pending` 行签发 PUT URL，已 `available` 的进 `alreadyAvailable` 返回（杜绝内容覆写投毒）；`soft-deleted` 行可重置为 pending 重传。versions 提交时对象解析限定本组织（跨组织 claim-by-hash → 409）。
  - **platform 模块**（`modules/platform/`）：service + routes 分层；API：企业列表/详情/创建（可同时指定 owner 或生成 owner 邀请码）/停用/恢复/指定 owner/创建邀请码/管理员列表；全部写 `platform.*` 审计事件。管理员授予/撤销仅走服务器 CLI（防 API 权限自提升）。
  - **平台 CLI**（`npm run platform`）：`admin:grant/revoke/list`、`org:create/list/show/disable/restore/owner`、`invite:create`（A9 归并入口）。
  - **桌面端**：`publishWorkspace`/`pushSync` 兼容 `alreadyAvailable`（check 与 upload-urls 之间竞态不再抛"缺少上传 URL"）；`cloudClient` 透传服务端错误 `code`；`SyncStatusBar` 错误态显示具体服务端中文消息（如"企业已被停用"）而非笼统"检查失败"。objects 协议请求体零改动，新旧桌面端兼容。
  - **验证**（`scripts/h1-verify.mjs`，30/30 通过）：平台权限边界（未授予 403 / 授予后 200 / 企业 owner 403）；A5 跨组织 check/download/commit 全部隔离；A11 已 available 不签 PUT；同组织 publish→manifest→download 回归 + skills/org-configs 冒烟；停用企业后协作 API 与登录均 403 `ORG_DISABLED`、恢复后正常；连续错误登录触发 429。`typecheck`/`build`/`db:migrate`（幂等）/`db:check` 全部通过（self-check 同步适配 org_id）。
  - 实现中发现并修复：`@fastify/rate-limit` 的 `errorResponseBuilder` 返回体必须含 `statusCode: 429`，否则被当作 500 错误抛出。

---

### Phase H2 — Enterprise Admin 用户与角色管理

**Status:** `DONE`（2026-06-12 完成，`h2-verify.mjs` 27/27 通过）

**实施计划（2026-06-12 确认，决策点已由产品负责人拍板）**

| 决策点 | 结论 |
|--------|------|
| owner 操作边界 | owner 不可被企业内 API 操作（改角色/停用一律走平台），天然规避「最后一个 owner」问题 |
| admin 管理范围 | admin 仅管 member（邀请 member、停用/恢复 member）；admin 级变更（邀 admin、调整/停用 admin）仅 owner 可执行 |
| 邀请码管理 | 纳入 H2：列表 + 撤销（migration 0008 加 `invite_codes.revoked_at`，注册流程同步校验） |
| 控制台形态 | H2 搭「企业管理」一级入口 + 控制台壳；**顶部 Tab**（Linear 风格，不嵌套侧边栏），成员页做实，云端项目/Skill 治理/配置中心/概览与审计四个 Tab 显示「规划中」占位；UI 基准为已确认设计稿 `desktop/design/enterprise-console-mockup.html` |
| 防锁死 | 停用操作禁止指向自己；全部管理操作写 `org.*` 审计事件 |

工作分解：migration `0008` → 服务端 `modules/org/`（service+routes，7 端点，鉴权读 H1 装饰的 `request.orgRole`）→ 桌面 IPC `org.js` + preload `ipm.org` → 渲染层 AuthContext（U3 修复）+ Sidebar 入口 + 控制台页面 → `h2-verify.mjs` 权限矩阵 e2e → 文档更新。

**目标**：让企业 owner/admin 在 Desktop 内统一管理企业成员、邀请、角色和停用状态。

**产品边界**

- 企业 owner/admin 管理的是本企业成员，不管理平台企业生命周期。
- 成员管理应复用现有 `org_members` 与邀请码体系。
- owner 权限高于 admin；首期避免 owner 被最后一个 owner 移除。

**工作清单**

写/改：
1. 后端新增企业成员管理 API：
   - 成员列表。
   - 创建邀请。
   - 调整角色。
   - 停用/恢复成员。
   - 查看成员最近云端活动。
2. Desktop 新增企业管理入口。
3. 企业用户管理 UI：
   - 成员表格。
   - 角色标签。
   - 邀请码创建与复制。
   - 风险操作确认。
4. 写入审计事件。

**验证方法**

- owner/admin 可创建 member/admin 邀请。
- owner 可调整 admin/member；admin 不可移除 owner。
- 被停用成员无法继续使用同企业配置码、Skill 市场、云端项目。
- 企业成员管理操作可在审计记录中看到。

**不做**

- 不做 SSO。
- 不做部门、用户组、复杂组织架构。

**变更日志**

- 2026-06-12 完成 H2 全部工作项：
  - **服务端**：
    - migration `0008_org_member_mgmt.sql`：`invite_codes.revoked_at` + events `(org_id, actor_id, created_at)` 索引（支撑成员「最近活动」查询）。
    - 新模块 `src/modules/org/`（service + routes 分层）暴露 7 个端点：`GET /api/org`（member 可调，供页头）、`GET /api/org/members`（含 `last_login_at` 与最近活动 LATERAL 查询）、`POST /api/org/members/:userId/role|disable|restore`、`GET/POST /api/org/invites`、`POST /api/org/invites/:id/revoke`。
    - 权限矩阵按已锁定决策实现：owner 行不可被企业 API 操作（403 `OWNER_IMMUTABLE`）、admin 仅管 member、admin 级变更仅 owner、停用自己 403 `CANNOT_DISABLE_SELF`、跨企业目标 404。
    - 审计事件 5 类落表：`org.invite_created/invite_revoked/member_role_changed/member_disabled/member_restored`。
    - 注册流程（`auth/routes.ts`）补 `revoked_at` 校验，撤销码注册返回 400 `INVITE_REVOKED`。
  - **桌面端**：
    - `src/main/ipc/org.js` 注册 8 个 `org/*` IPC 通道（经 `createAuthCloudClient` 透传，错误带 H1 机器码）；`preload.js` 暴露 `ipm.org` 命名空间。
    - U3 修复：新建 `src/ui/contexts/AuthContext.jsx`，App 启动时一次 `auth/getStatus` 注入 Provider，提供 `{ loggedIn, offline, user, orgRole, refresh }`；Sidebar 与企业控制台消费，存量组件后续阶段迁移。
    - Sidebar 新增「企业管理」一级入口（`orgRole ∈ {owner, admin}` 时显示）；App 新增 `enterprise-console` 路由。
    - 新建 `src/ui/components/enterprise/EnterpriseConsolePage.jsx`，按设计稿实现：页头（企业名/状态徽章/我的角色/统计）、顶部 Tab（成员实装 + 4 个「规划中」占位）、统计条、成员/邀请码分段视图、成员表格（角色标签/悬停行操作/owner 锁定提示/停用置灰/角色与状态过滤/搜索）、行操作菜单（按角色裁剪）、邀请弹窗（角色卡 + 次数/有效期 + 生成码复制）、停用与撤销二次确认弹窗。
  - **验证**：`scripts/h2-verify.mjs` 27/27 通过（邀请码创建权限矩阵、可见性、角色调整、停用即时 403 `MEMBER_DISABLED`/恢复闭环、撤销码注册拦截、跨组织隔离回归）；审计事件 5 类经 SQL 抽查全部落表；服务端 `typecheck`/`build`/`db:migrate`/`db:check` 与桌面 `vite build` 全部通过。桌面端 UI 留待人工实测（member 不可见入口、owner/admin 视角差异、邀请-注册-列表闭环）。

---

### Phase H3 — Enterprise Workspace 管理

**Status:** `DONE`（2026-06-12）

**实施计划（2026-06-12 确认，决策点已由产品负责人拍板）**

| 决策点 | 结论 |
|--------|------|
| 三态语义（A4 修复） | `active` 正常；`archived` 归档=禁 push、允许 pull/读历史、普通成员列表可见带「只读」标记；`disabled` 停用=协作端点全 403、普通成员列表不可见。错误码 `WORKSPACE_ARCHIVED` / `WORKSPACE_DISABLED` |
| 成员治理范围 | H3 只做企业管理员兜底（转移 owner、移除成员，入口在企业控制台）；项目 owner 自助成员管理（editor/viewer 调整等）留 H4 |
| 治理权限 | org owner/admin 权限一致；全部治理操作写 `workspace.*` 审计事件 |
| 风险检测 | 仅 DB 维度（从未发布版本、长期无活动、owner 企业账号已停用）；OSS 实测完整性核查归 H8 |
| 统计口径 | 列表轻量（成员数/版本数/最近同步），文件数与存储量在详情按需计算；详情附最近 20 条事件简表（完整审计归 H7） |
| UI | 先出设计稿 `desktop/design/enterprise-workspaces-mockup.html`（沿用 H2 设计语言：列表 + 右侧详情抽屉 + 治理弹窗）确认后实装企业控制台「云端项目」Tab |

工作分解：A4 状态门控 helper（workspaces/versions 全路由生效）→ org 模块扩展 6 个治理端点 → 桌面 IPC/preload → 控制台「云端项目」Tab 实装 → 协作端错误文案最小适配 → `h3-verify.mjs` e2e → 文档更新。无需 migration（status CHECK 约束 H1 已加）。

**目标**：让企业 owner/admin 可以查看并治理企业内全部云端项目，包括项目所有者、成员、同步状态、存储状态和风险操作。

**产品边界**

- 企业管理员有企业治理视角，但不默认静默改写用户本地文件。
- 对 workspace 的停用/归档只影响云端访问，不直接删除本地项目。
- workspace creator/owner 仍保留日常项目成员管理职责。

**工作清单**

写/改：
1. 后端新增企业 workspace 管理 API：
   - 企业内 workspace 列表。
   - workspace 详情、成员、最近 manifest。
   - 停用/恢复/归档 workspace。
   - 查看 workspace 事件。
2. Desktop 企业控制台新增“云端项目”页。
3. UI 展示：
   - 项目名称、owner、成员数、文件数、版本数。
   - 最近同步时间。
   - 风险状态：停用、OSS 缺失、manifest 异常、成员过多等。
4. 管理操作写入审计事件。

**验证方法**

- 企业 admin 能看到企业内所有 workspace，不限自己是否加入。
- 停用 workspace 后成员无法 push/pull，但本地项目仍保留。
- 恢复后成员可继续显式同步。
- workspace owner 的普通协作能力不受企业管理页影响。

**不做**

- 不做跨企业迁移 workspace。
- 不做强制删除用户本地文件。

**变更日志**

- 2026-06-12 完成 H3 全部范围（无需 migration，status CHECK 约束 H1 已加）：
  - **A4 修复 — workspace 三态语义全路由生效**：新增共用门控 helper `server/src/modules/workspaces/access.ts`（membership + status 单查询，`requireWorkspaceAccess(reply, wsId, userId, 'read'|'write')`）。写动作（commit、folders POST、promote、conflict-events、join）仅 `active`，否则 403 `WORKSPACE_ARCHIVED`/`WORKSPACE_DISABLED`；读动作（versions/latest、versions、file-history、file-download、folders GET、sync-status、detail）`active`+`archived` 可用，`disabled` 一律 403。`GET /api/workspaces` 列表对成员返回 `active`+`archived`（带 `status` 字段），隐藏 `disabled`；`sync-status` 新增 `workspaceStatus` 字段。
  - **企业治理 API（org 模块扩展，admin+）**：`GET /api/org/workspaces`（全量列表：owner/成员数/版本数/最近同步 + DB 维度风险标记 `NO_OWNER`/`OWNER_DISABLED`/`NO_VERSION`/`INACTIVE`）、`GET /api/org/workspaces/:id`（详情：成员含 org 状态、最近 10 版本、文件数/存储量按需计算、最近 20 条事件）、`POST .../archive|restore|disable`、`POST .../transfer-owner`（目标须为项目成员且企业账号正常，原 owner 降为 editor）、`POST .../members/:userId/remove`（owner 须先转移 → 409 `OWNER_MUST_TRANSFER`）。审计事件 5 类：`workspace.archived/restored/disabled/owner_transferred/member_removed`。
  - **桌面端**：IPC 新增 5 个 `org/*Workspace*` 通道 + preload `ipm.org` 扩展；企业控制台顶部 Tab 改为可切换，「云端项目」Tab 实装 `EnterpriseWorkspacesView.jsx`（按确认稿 `desktop/design/enterprise-workspaces-mockup.html`：统计条、状态分段筛选/搜索/类型过滤、项目表格带风险标记、右侧详情抽屉〔成员/最近版本/事件 + 风险卡〕、归档/停用/转移 owner/移出成员确认弹窗）；公共 UI 原语抽到 `enterprise/shared.jsx`。
  - **协作端最小适配**：协作项目列表归档项目显示「已归档 · 只读」标记、加入按钮禁用；SyncStatusBar 在 `workspaceStatus=archived` 时显示只读横幅并隐藏推送/发布版本按钮（拉取保留）。完整状态模型重构仍归 H4。
  - **验证**：`scripts/h3-verify.mjs` 37/37 通过（三态矩阵、治理权限矩阵、owner 转移前后权限、移除即时生效、审计事件落表、跨企业 404）；h1-verify 30/30、h2-verify 27/27 回归通过；`typecheck`/`build`/`db:check` 通过；desktop `vite build` 通过。

---

### Phase H4 — 云端项目权限模型与管理页

**Status:** `DONE`（2026-06-12，范围已按产品负责人要求改写）

> **范围改写说明（2026-06-12）**：原 H4「发布/加入/同步/版本/冲突/恢复 UX 重构」拆分为两个阶段——本阶段（H4）实施**云端项目可见性/权限模型重设计 + 协作项目页重构为管理中枢**；原同步/版本/冲突 UX 重构内容顺延为 **H4.5**（见本节末尾）。

**实施决策（2026-06-12 锁定）**

| 决策点 | 结论 |
|--------|------|
| 可见性模型 | `workspaces.visibility = private \| public`；新建与存量一律默认 `private`（隐私优先） |
| 私有项目 | 仅成员可见，其他人完全不可见（API 一律 404）；凭项目邀请码加入，加入即获 `editor`（协作/写）权限——邀请码本身即信任凭证 |
| 公开项目 | owner 显式设置后企业内全员可见；自助加入无需审批，默认 `viewer`（只读：可拉取/看历史，不能推送修改删除）；协作权限由 owner 在成员管理中手动开通 |
| 页面定位 | 协作项目页 → 云端项目管理中枢：我创建的 + 我参与的 + 公开项目区 + 邀请码入口；文件查看与同步操作仍在「我的资料」，pull 副本入口保留 |
| A10 收尾 | viewer 角色全链路可达；项目 owner 自助成员管理（viewer↔editor 调整、移除、转移 owner）落在本阶段，复用 H3 org service 逻辑 |
| UI | 设计稿 `desktop/design/cloud-projects-mockup.html` 已确认（Linear 风格：全宽细分隔线列表、pill 筛选、详情页主栏+右侧属性栏，卡片使用克制） |

**目标**：让云端协作符合真实信任模型——发布只是备份，协作是 owner 主动授权（邀请码/公开+提权）的结果；同时给项目 owner 一个完整的项目管理入口。

**重点问题**

- 现状 `GET /api/workspaces` 返回全企业项目且任何成员可自助 join 为 editor——既泄露项目存在性，又越权（本阶段废除）。
- viewer 角色 schema 已有、服务端已拦截 viewer 推送，但全链路从未可达（A10 遗留）。
- 项目 owner 没有任何成员/权限管理入口（H3 只做了企业 admin 兜底）。

**工作清单**

写/改：
1. Migration `0009_workspace_visibility.sql`：`workspaces.visibility`（默认 private + CHECK）；新表 `workspace_invites`（code 唯一、max_uses/used_count/expires_at/revoked_at）。
2. 服务端列表与加入链路改造：
   - `GET /api/workspaces` 只返回我是成员的项目（含 myRole/visibility）。
   - 新 `GET /api/workspaces/public`（企业内 public+active，标记已加入）。
   - `POST /api/workspaces/:id/join` 仅公开项目可自助加入且为 viewer；私有一律 404。
   - 新 `POST /api/workspaces/join-by-code`（校验撤销/过期/次数，加入为 editor）。
3. 服务端 owner 自助管理端点（鉴权=项目 owner）：成员列表、viewer↔editor 调整、移除、转移 owner、可见性切换、邀请码 CRUD/撤销；审计事件 `workspace.visibility_changed / invite_created / invite_revoked / member_role_changed`，`workspace.joined` 注明途径。
4. 桌面端 IPC + preload 扩展；CloudProjectsPage 按确认稿重构为管理中枢。

**验证方法**

- 私有项目对非成员完全不可见（列表/详情/join 均 404）。
- 公开项目自助加入 = viewer，push 403；owner 提权后可 push。
- 邀请码加入 = editor；撤销/过期/超次数的码被拒绝。
- 非 owner 调项目管理端点 403；owner 自助调整即时生效。
- 存量项目迁移后全部为 private。

**不做**

- 不做加入审批流。
- 不做跨企业邀请。
- 同步/版本/冲突 UX 重构（→ H4.5）。

**H4.5（顺延阶段，DONE）— 同步/版本/冲突 UX 重构**

原 H4 内容整体顺延：统一云端项目状态模型（未绑定/已发布/已加入未拉取/本地变更/云端更新/冲突待处理）、同步操作与差异查看优化、版本与单文件恢复 UI 进入同一上下文、OSS/网络/权限错误的可读提示。不做实时同步与 Git 式文本 merge。

**变更日志**

- **H4 实现**（2026-06-12）：
  - **数据层**：migration `0009_workspace_visibility.sql` — `workspaces.visibility`（`private|public` CHECK，默认 private，存量全部 private）；新表 `workspace_invites`（code 唯一、max_uses/used_count/expires_at/revoked_at、ON DELETE CASCADE）。
  - **列表/加入链路重做**（`workspaces/routes.ts`）：`GET /api/workspaces` 只返回我是成员的项目（含 `myRole/visibility/ownerName`）；新 `GET /api/workspaces/public`（企业内 public+active，带 `isMember`）作为唯一发现面；`POST /:id/join` 仅公开项目可自助加入且角色=viewer，私有/不存在/跨企业/停用一律 404；新 `POST /api/workspaces/join-by-code` 凭项目邀请码加入=editor（事务内 FOR UPDATE 计数，撤销/过期/超次数/跨企业统一 400 `INVALID_INVITE` 不暴露项目）。
  - **隐私语义收紧**：`requireWorkspaceAccess` 非成员路径由 403 改为通用 404（与不存在的 id 同响应，存在性不可探测）。
  - **owner 自助管理**（新模块 `workspaces/manage.ts`，鉴权=项目 owner）：成员列表（任意成员可读）、viewer↔editor 调整、移除（owner 须先转移 409）、转移所有权（原 owner 降 editor）、可见性切换、邀请码列表/创建/撤销；归档项目禁止生成邀请码与改可见性（403 `WORKSPACE_ARCHIVED`），成员治理保持可用（与 H3 企业治理一致）。新增 4 类审计事件 `workspace.visibility_changed / invite_created / invite_revoked / member_role_changed`（payload `by: 'project_owner'` 区分企业治理），`workspace.joined` 注明途径（`via: invite_code|public`）。
  - **概览端点**：`GET /api/workspaces/:id/overview`（任意成员；属性/统计/最近 10 版本/myRole，供管理中枢详情页）。
  - **桌面端**：11 个新 IPC 通道（`cloud/listPublicWorkspaces|joinByCode|getWorkspaceOverview|listWorkspaceMembers|setMemberRole|removeMember|transferOwner|setVisibility|listInvites|createInvite|revokeInvite`）+ preload 暴露；`CloudProjectsPage` 按确认稿全量重构为管理中枢（Linear 风格：我的项目〔全部/我创建/我参与〕+ 公开项目区 + 凭码加入弹窗；详情页概览/成员/邀请码/设置四 Tab + 右侧属性栏；owner 成员菜单、邀请码生成/复制/撤销、可见性切换、转移确认弹窗；拉取本地副本入口保留）。
  - **A10 完结**：viewer 全链路可达（公开自助加入即 viewer，push 403），owner 自助成员管理落地。审计文档已补录。
  - **验证**：新 `scripts/h4-verify.mjs` 59/59 通过（私有默认与 404 隐藏、邀请码全生命周期、公开 viewer 链路、提权/降权/移除/转移、归档限制、7 类审计事件、跨企业隔离）；h3-verify 适配新加入链路后 37/37、h2 27/27、h1 30/30 回归通过；`typecheck`/`build`/`db:check`、desktop `vite build` 通过。

- **H4.5 实现**（2026-06-12，U1 完结）：
  - **统一状态层**：新 `useSyncStatus` hook（轮询 `getSyncStatus` + `computeSyncPlan`，序号防竞态）+ `deriveCloudChip`，把分散在 RootTable/HeaderBar/SyncStatusBar/CloudActivityPanel 的取数收敛为单一来源。
  - **「我的资料」内统一入口**：HeaderBar 云状态 chip（状态点/文案/抽屉开合图标，hover 与激活态明确可点击），点击展开右侧 **SyncDrawer**（状态/版本两 Tab：八态状态卡、本地/云端变更清单、冲突副本处理、推送预览、里程碑、版本历史；flex 同级布局动画挤压而非悬浮）。
  - **文件列表内联徽标**：EntryTable 每行按 syncPlan 显示 新增/修改/删除/冲突副本 徽标；`ResizeObserver` 响应式隐藏次要列（类型/大小/修改时间），抽屉挤压时不堆叠。
  - **下线旧组件**：删除 `SyncStatusBar.jsx`、`ConflictCopiesModal.jsx`（功能并入 SyncDrawer）；文件历史恢复入口保留在右键菜单。
  - **验证**：desktop `vite build` 通过；八种状态人工走查（含冲突拉取产生副本、viewer 只读、归档只读）。

---

### Phase H5 — Skill Governance UX 重构

**Status:** `DONE`

**目标**：把 C7/C8 的 Skill Registry、组织市场、审核管理和访问授权整合为更清晰的 Skill 治理体验。

**工作清单**

写/改：
1. Skill 页面信息架构重组：
   - 本地 Skill。
   - 组织市场。
   - 我的提交。
   - 审核管理。
   - 访问授权。
2. 审核流程优化：
   - 待审列表。
   - 版本 diff 摘要。
   - 通过/拒绝原因。
   - 审核后配置可见范围。
3. 安装与更新优化：
   - 已安装版本 vs 市场最新版本。
   - 更新提示。
   - 安装冲突处理。
4. 管理员视角：
   - Skill 使用量。
   - 授权对象。
   - 停用/归档。

**验证方法**

- member 提交 Skill 后能看到审核状态。
- owner/admin 可审核并设置可见范围。
- 未授权成员在市场中不可见。
- 已安装 Skill 可更新，冲突时不会覆盖用户本地同名 Skill。

**不做**

- 不做公开互联网市场。
- 不做自动安全扫描。
- 不做调用量遥测（安装维度统计先行，调用遥测留待 H7 评估）。
- 不做成员侧独立页面/Sidebar 入口（留在 KnowClaw 右侧面板内升级）。

**变更日志**

- **H5 实现**（2026-06-12，U5 之 Skill 部分完结）：
  - **信息架构落定**：成员侧留在 KnowClaw 右侧技能面板（加宽至 340px，Tab 重组为 **本地 / 组织市场 / 我的提交**）；管理侧迁入企业控制台新「**技能治理**」Tab（`EnterpriseSkillsView.jsx`，沿用 H2/H3 控制台 Linear 风格组件）。原面板内「审核管理」Tab 与 `SkillReviewAdminPanel.jsx`/`SkillAccessModal.jsx` 删除。
  - **后端补齐**（`modules/skills/routes.ts`，13→17 路由）：`GET /api/skills/mine`（成员自查全部提交，含 pending/rejected 与 review_note + installCount）；`GET /api/skills/admin/overview`（admin 全量目录 + installCount/outdatedInstallCount/orgGrant/userGrantCount/versionCount）；`GET /api/skills/:id/installers`（安装者列表带版本落后标记）；`POST /api/skills/:id/archive|unarchive`（admin；prevStatus 存 metadata，恢复回归档前状态；归档后市场不可见/不可安装/不可提交新版本；重复操作 409）。
  - **审计事件补录**：`skill.installed`（含 versionId）、`skill.archived`/`skill.unarchived`、`skill.access_changed`（审核流之外的授权调整）。
  - **版本 diff 基础**：打包器 `skillPackage.js` manifest `files[]` 增加 per-file `sha256`（旧包向后兼容退化为按大小比较）；diff 在桌面端计算（`skillDiff.js`：added/changed/removed/fallback + 摘要文案），服务端不新增 diff 端点。
  - **成员侧 UI**：市场行点开 `SkillMarketDetailModal`（下载包预览 SKILL.md + 版本历史带 diff 摘要 + 当前安装标记，新 IPC `registryPreviewSkill` 校验 sha256 后只读解包）；本地 Tab 给来自 registry 的已装技能加「可更新」徽标（按 importedFrom 溯源比对 updateAvailable）；新「我的提交」Tab（状态徽标/拒绝原因/安装数/「提交新版本」入口）；`PublishSkillModal` 显示当前线上版本与状态、自动预填建议版本号（末位 +1）。
  - **管理侧 UI**（企业控制台「技能治理」）：统计条（总数/待审核/已上架/累计安装与落后数）+ 状态过滤 + 搜索;全量表格（状态/最新版本/提交人/安装数/可见范围）;详情抽屉（版本历史带 diff 摘要、安装者列表带落后标记、治理动作）;审核通过=授权弹窗（全组织/指定成员单选+复选）、拒绝=原因弹窗（替代 `window.prompt`）、归档确认/一键恢复。
  - **桌面 IPC**：6 个新通道 `registryListMine / registryAdminOverview / registryListInstallers / registryArchiveSkill / registryUnarchiveSkill / registryPreviewSkill`（+ preload 暴露与 `useKnowClawPersist` hook 接线）。
  - **验证**：新 `scripts/h5-verify.mjs` 55/55 通过（提交→我的提交→队列→按用户授权可见性→安装计数→新版本重审清授权→updateAvailable 与落后标记→升级清除→授权调整→拒绝原因回显→归档阻断三链路→409 幂等→恢复回 approved→跨企业 404 隔离→8 类审计事件落表）；h1 30/30、h2 27/27、h3 37/37、h4 59/59 回归通过；server `typecheck`/`build`、desktop `vite build` 通过。

---

### Phase H6 — Enterprise Config Center

**Status:** `DONE`

**目标**：把 C9 AI 配置模板从 Settings 单点能力升级为企业配置中心的一部分，方便 owner/admin 统一管理分发、使用记录和风险提示。

**工作清单**

写/改：
1. 企业控制台新增“配置中心”。
2. AI 配置模板管理：
   - 创建模板。
   - 配置码刷新。
   - 停用模板。
   - 使用次数与过期时间。
   - 导入记录。
3. 普通成员导入体验优化：
   - 配置码预览。
   - 覆盖范围说明。
   - API Key 风险提示。
   - 导入后重载设置页。
4. 为未来模板类型预留 UI 分组，但不实现其他模板类型。

**验证方法**

- owner/admin 能在企业控制台管理 AI 配置模板。
- member 能从设置页或企业配置入口导入配置码。
- 超过次数、过期、停用、跨组织均有明确错误。

**不做**

- 不做 MCP 配置分发。
- 不做模板合并。
- 不做云端代理保存用户调用记录。

**变更日志**

- **H6 实现**（2026-06-13，U5 之企业 AI 配置部分完结）：
  - **设计稿先行**：`desktop/design/settings-mockup.html` + `settings-mockup.js`（设置页左侧分区导航 + 控制台「配置中心」），沿用 `cloud-projects-mockup.html` 的 Linear 设计令牌，用户确认（h6-1 检查点）后落地。
  - **静态加密（修复 U5 / IA 隐患：API Key 明文落库）**：新增 `infra/crypto.ts`，对 `org_config_templates.config_json` 做 **AES-256-GCM 信封加密**（`{__enc:'aes-256-gcm',v,iv,tag,data}`，base64）；密钥来自新增环境变量 `CONFIG_ENC_KEY`（base64/hex 直用，否则 scrypt 拉伸到 32 字节；生产拒绝 dev 默认值，与 JWT 同策略）。`routes.ts` 写入时 `encryptConfig`、`mapTemplate` 读出时 `decryptConfig`（无 `__enc` 标记的旧明文行透明兼容）。新增幂等回填脚本 `scripts/encrypt-org-configs.mjs`（扫描未加密行就地封装）。
  - **后端端点补齐 + 审计**（`modules/org-configs/routes.ts`）：新增 `POST /templates/:id/enable`（停用→启用，归档不可逆，409 边界）与 `PATCH /templates/:id`（仅改 name/description/maxUses/expiresAt，config 不可变）；补 2 类审计事件 `org_config_template.enabled` / `org_config_template.updated`。顺带修复**既有 bug**：import 端点 `SELECT ... LEFT JOIN ... FOR UPDATE` 在 PG 报「FOR UPDATE cannot be applied to the nullable side of an outer join」，改为 `FOR UPDATE OF t`（只锁模板表）。
  - **桌面 IPC + preload**：`prefs/orgConfig/enableTemplate`、`prefs/orgConfig/updateTemplate` 两个新通道（`prefs.js`），`cloudClient.js` 增加 `patch()` 方法，preload 暴露 `enableTemplate/updateTemplate`；导入沿用既有 `importCode` 广播 `prefs:updated` 触发设置页重载。
  - **控制台「配置中心」Tab**（`EnterpriseSkillsView` 同级的 `EnterpriseConfigView.jsx`）：统计条（模板数/启用数/累计导入/活跃配置码）+ AI 配置过滤（MCP 配置占位「规划中」）+ 搜索;模板表格（名称/状态/配置码复制/使用进度/过期/创建人）;详情抽屉（属性 + 凭证「已加密存储」标记 + 配置摘要网格 + 导入记录头像列表 + 治理动作）;弹窗：从本机配置创建（读本机 `prefs.ai` 统计含 Key 的 Provider 数做风险提示）/编辑元数据/刷新配置码/停用，行内菜单含重新启用。控制台顶部 Tab「配置中心」从「规划中」转为可用。
  - **设置页 Linear 重构**（`SettingsPage.jsx`）：改为左侧分区导航（通用 / AI 模型 / 网页搜索 / 企业配置）+ 右侧内容区;企业节裁剪为**成员侧导入**（`OrgImportCard`：配置码预览 + 覆盖范围/凭证风险提示 + 覆盖导入），删除原嵌入式管理员模板管理 UI（创建/列表/刷新/停用/使用记录约 290 行）;接入 `useAuth()`（替代 `currentUser` prop，落地 U5 的 auth 单一来源），未登录显示引导态。
  - **验证**：新 `scripts/h6-verify.mjs` 33/33 通过（成员创建被拒→管理员创建→**密文落库断言：信封含 `__enc`/`data`、库中无 Provider/搜索 API Key 明文**→成员预览不漏 config/code→成员导入解密还原双 Key→使用记录与 usedCount 递增→PATCH 元数据 + 成员 PATCH 403→停用/启用生命周期 + 409 边界→跨企业 404/列表隔离→5 类审计事件落表）；回填脚本幂等（scanned=3 sealed=0）；h1 30/30、h2 27/27、h3 37/37、h4 59/59、h5 回归通过；server `typecheck`/`build`、desktop `vite build` 通过。

---

### Phase H7 — 企业数据监测与审计 + 平台 Web 控制台

**Status:** `DONE`（2026-06-14，`h7-verify.mjs` 30/30 通过）

**目标**：两个交付面——
1. **企业视角（Desktop）**：基于已有 events 与业务表，为企业 owner/admin 提供企业使用情况、风险状态和关键审计记录。
2. **平台视角（Cloud Web）**：为平台超级管理员提供一个 server 侧托管的轻量 Web 控制台，把 H1 已交付的平台管理 API 图形化，替代日常 CLI 操作（2026-06-12 需求确认，修订 H0 审计 IA-2 中「平台管理仅 API+CLI」的结论：CLI 仍保留为引导与兜底入口）。

**产品边界**

- 平台 Web 控制台属于 **cloud 侧（server 托管的网页）**，不放进 Desktop——Desktop 维持「企业视角」边界不变。
- 控制台是现有 `/api/platform/**` 的图形化壳，不引入新的权限模型；鉴权复用「账号登录 + `platform_admins` 每请求校验」。
- 平台管理员的**授予/撤销仍仅走服务器 CLI**（`npm run platform -- admin:grant/revoke`），Web 端只读展示，杜绝 Web 面上的权限自提升。

**工作清单**

写/改：
1. 后端新增企业统计 API（企业视角）：
   - 成员数量。
   - workspace 数量。
   - manifest/version 数量。
   - Skill 提交、审核、安装数量。
   - AI 配置模板使用次数。
2. 后端新增审计查询 API：
   - 按事件类型。
   - 按 actor。
   - 按 workspace/skill/template。
   - 平台侧：`platform.*` 事件查询（供 Web 控制台展示操作审计）。
3. Desktop 企业 dashboard：
   - 概览卡片。
   - 最近事件。
   - 风险提示。
4. **平台 Web 控制台**（server 静态托管单页，如 `/platform-console`，功能需求）：
   - **登录**：平台管理员邮箱密码登录（复用 `/api/auth/login`）；非平台管理员登录后调平台 API 一律 403，页面显示明确拒绝提示。
   - **企业列表**：名称/slug/plan/状态/成员数/项目数，支持搜索与按状态筛选；停用企业明显标红。
   - **企业详情**：基本信息、成员列表（角色/状态/邮箱）、workspace 数量、最近平台事件。
   - **创建企业**：名称 + 可选 slug/plan；可同时按邮箱指定 owner，或一键生成 owner 邀请码（单次、30 天）并复制。
   - **停用/恢复企业**：二次确认弹窗，明确告知影响（该企业全部成员立即无法登录与同步，数据无损可恢复）。
   - **指定 owner**：按邮箱指定/升级（多 owner 语义，与 H1 决策一致）。
   - **邀请码管理**：为指定企业创建邀请码（角色/次数/有效期），展示已发邀请码及使用情况。
   - **平台管理员列表**：只读展示（授予/撤销仅 CLI）。
   - **平台审计**：`platform.*` 事件流水（时间/操作者/企业/动作）。
   - 技术形态：无独立前端部署面，由现有 Fastify server 托管静态页；生产环境可选反代层 IP 白名单加固。
5. 增强关键操作 events 记录。

**验证方法**

- 企业 admin 可看到企业核心指标。
- 最近事件能追溯到操作者和对象。
- 普通 member 无法访问企业 dashboard。
- 平台管理员可在浏览器中完成「创建企业 → 指定 owner/发邀请码 → 停用 → 恢复」全流程，无需 CLI。
- 非平台管理员（含企业 owner/admin）访问控制台所有数据接口均 403。

**不做**

- 不做复杂 BI 报表。
- 不做成本计费报表。
- 平台控制台不做计费/套餐管理、不做企业数据内容浏览（不可见任何企业文件/manifest 内容）。
- 不为控制台引入独立前端框架部署面（不单独起前端服务）。

**变更日志**

- 2026-06-12：应产品要求，将「平台 Web 控制台」功能需求纳入 H7（cloud 侧 server 托管网页，非 Desktop）；修订 IA-2 决策，CLI 降级为引导与兜底入口。
- **H7 实现**（2026-06-14，backend-first，纯静态控制台，不出设计稿）：
  - **企业 stats/audit API**（`modules/org/`）：新增 `GET /api/org/stats`（owner/admin 网关，沿用 `requireOrgContext('admin')`）——成员（总/活跃/停用 + 按角色）、workspace（总 + 按状态）、version 提交数、Skill（按 `pending_review/approved/rejected/archived` + 安装数）、AI 配置模板（总/启用/累计导入），均为对 `org_members`/`workspaces`/`versions`/`skills`/`skill_installs`/`org_config_templates` 的分组聚合（≈6 条已建索引的廉价查询）。新增 `GET /api/org/events`：支持 `?type=&actor=&workspaceId=&skillId=&templateId=&limit=&before=`（`skillId/templateId` 走 `payload->>'…'`），联表 `users`/`workspaces` 取 actor 名与项目名，`created_at` 游标分页（`hasMore`/`nextBefore`）。
  - **平台 audit/stats API**（`modules/platform/`，已由 `/api/platform/` 网关保护）：新增 `GET /api/platform/events`（默认 `platform.*`，支持 `type`/`orgId`/分页，联表取 actor 邮箱与 org 名）与 `GET /api/platform/stats`（企业总/活跃/停用、用户总/活跃、workspace 总、平台管理员数）。A3 审计补录：复核 H2/H3 写操作，成员停用/恢复、workspace 归档/停用/恢复/转移/移除、邀请码创建/撤销、`platform.*`、`skill.*`、`org_config_template.*` 均已落 event，覆盖充分，按「范围克制」不额外埋点。
  - **Desktop 企业 dashboard**：`ipc/org.js` 新增 `org/getStats`、`org/listEvents`（thin pass-through，沿用 `createAuthCloudClient` + `fail()`），preload 暴露 `window.ipm.org.getStats/listEvents`。新增 `EnterpriseOverviewView.jsx`：两排统计卡 + 派生风险提示（停用成员/待审 Skill/停用项目）+ 审计日志（事件类型中文标签 + tone 着色 + actor 头像 + 类型过滤 + 「加载更多」游标翻页），复用 `enterprise/shared.jsx`。`EnterpriseConsolePage.jsx` 把占位「概览与审计」Tab 从「规划中」接成 `EnterpriseOverviewView`。
  - **平台 Web 控制台**（server 托管纯静态单页）：新增依赖 `@fastify/static`，`app.ts` 注册根目录 `public/platform-console/`（`../public` 相对 src/dist 均成立）挂到 `/platform-console`，并加 `/platform-console`→`/platform-console/` 重定向；`middleware/auth.ts` 把 `/platform-console` 加入 `PUBLIC_PREFIXES`（壳匿名加载，数据仍走网关）。helmet CSP 收敛为显式策略：`script-src 'self'`（脚本全部外部同源 ES module，杜绝内联脚本 XSS 面），`style-src 'self' 'unsafe-inline'`（允许 CSSOM 动态着色）。前端分层：`api.js`（fetch + Bearer + 401 自动 refresh + 登出，token 存 localStorage）、`router.js`（hash 路由 + 守卫）、`util.js`（无内联 handler 的 `h()` 工厂）、`modal.js`、`shell.js`（左导航壳），`views/*`：登录（登录后探测 `/api/platform/stats`，403 即非平台管理员明确拒绝并登出）、企业列表（统计 + 搜索 + 状态筛选 + 停用标红）、企业详情（信息/成员/最近平台事件 + 指定 owner/生成邀请码/停用恢复）、平台管理员（只读 + 「授予/撤销仅 CLI」提示）、平台审计（`platform.*` 流水 + 类型过滤 + 翻页）。
  - **验证**：新 `scripts/h7-verify.mjs` 30/30 通过（企业 stats 数值/角色计数 + admin 可读 + member 403；events 非空/按 type 过滤/limit=1 游标翻页不重复/member 403；平台 events 全 `platform.*`/平台 stats/非平台管理员 403；平台 API 创建→停用→恢复企业;`/platform-console/` 壳与 `app.css`/`js/app.js` 匿名 200 + `/platform-console` 重定向）；h1 30/30、h2 27/27、h3 37/37、h4 59/59、h5 55/55、h6 33/33 回归通过；server `typecheck`/`build`、desktop `vite build`（renderer）通过。

---

### Phase H8 — 回归测试、打包与交付加固

**Status:** `DONE`（2026-06-15，`h8:gate` 全绿：h1-h7 全通过、Forge 外部网络失败正确判为 non-blocking）

**目标**：为 C1-C9 强化后的能力建立稳定验证清单和交付门禁，减少后续开发引入回归。

**工作清单**

写/改：
1. C1-C9 回归测试脚本或手动 checklist：
   - 注册/登录/邀请。
   - 发布/加入/拉取。
   - push/pull。
   - 软删除。
   - 冲突副本。
   - 单文件恢复。
   - Skill 发布/审核/授权/安装。
   - AI 配置模板创建/导入。
2. 错误提示清单：
   - 网络失败。
   - OSS 失败。
   - 权限失败。
   - 企业/成员/workspace 停用。
3. 打包与构建检查：
   - cloud typecheck/build/migrate。
   - desktop renderer build。
   - Electron Forge package 网络失败记录。
4. 修正构建产物跟踪策略，避免 `desktop/dist` 在失败打包后留下混乱状态。

**验证方法**

- 每次大改后可按 checklist 验证 C1-C9 核心闭环。
- 构建失败能区分代码错误与外部网络错误。
- 用户可读错误覆盖主要失败场景。

**不做**

- 不追求一次性全自动 e2e 覆盖所有桌面交互。
- 不引入重型测试平台。

**变更日志**

- **H8 实现**（2026-06-15，自动 release gate + 手动 checklist 混合形态）：
  - **统一门禁** `cloud/server/scripts/h8-release-gate.mjs`（`npm run h8:gate`）：顺序执行 cloud `typecheck`/`build`/`db:migrate`/`db:check` → `h1`-`h7` verify → desktop renderer `vite build` → Electron Forge `package` smoke；输出机器可读 JSON + 人可读 Markdown 报告到 `cloud/server/.h8-reports/`（含 `latest.json`/`latest.md`）。
  - **失败分类**：代码/配置/断言失败记为 `blocking`（gate FAIL，exit 1）；Electron Forge 因网络/外部依赖下载失败（如历史 `20.205.243.166:443` 超时）按关键字判为 `nonBlockingExternal`（仅记录、不阻断）。实测命中 `ETIMEDOUT 20.205.243.166:443` → 正确判为 non-blocking，gate 仍 PASS。
  - **限流可靠性修复（A7）**：`h1-verify` 会故意打满认证限流桶，且各套件累计认证调用超过 20/min，导致同一固定 server 上 h2-h7 必然 429。改造：把限流额度做成可配置 env（`AUTH_RATE_LIMIT_MAX` 默认 20、`AUTH_RATE_LIMIT_WINDOW` 默认 `1 minute`，生产禁止 0）；gate 默认**自建临时 server**（用刚构建的 `dist/`），按套件切档位（h1 用默认 20 触发限流断言，h2-h7 用 0 关闭限流）。`--base` 可回退到外部 server 模式。
  - **错误提示加固**：`desktop/src/main/cloud/cloudClient.js` 把底层传输失败（undici `fetch failed`/ECONNREFUSED/DNS/TLS）统一映射为可读文案「无法连接云端服务，请检查网络后重试。」并附稳定机器码 `NETWORK`，已成形的 HTTP/Abort 错误保持原样。
  - **回归矩阵 checklist 化** `cloud/H8_RELEASE_CHECKLIST.md`：把 H0 §5 的 C1-C9 矩阵落成可执行清单（自动项映射到 gate/verify、手动项含步骤与预期），并附「错误提示覆盖」（网络/OSS/权限/停用四类）与「失败定位指引」。
  - **构建产物忽略策略**：根 `.gitignore` 增 `.h8-reports/`；`desktop/.gitignore` 显式补 `dist/`；将既往误入版本库的 `desktop/dist/`（标准 renderer build 产物，Forge 实际用 `.vite/`）`git rm --cached` 取消跟踪，避免每次 gate 跑后污染 git。
  - **验证**：`npm run h8:gate --no-package` → 12 通过 / 0 阻断；完整 `npm run h8:gate` → h1-h7 + cloud + renderer 全绿，`desktop:package` 判 non-blocking external，gate PASS。

---

## 4. 强化 MVP 定义

### 4.1 Platform Admin MVP

第一阶段最小可验收闭环：

```text
平台管理员
  → 创建企业
  → 指定企业 owner
  → 查看企业状态
  → 停用企业
  → 企业用户无法继续使用云端能力
  → 恢复企业
```

对应阶段：

- H0
- H1

### 4.2 Enterprise Admin MVP

第二阶段最小可验收闭环：

```text
企业 owner/admin 登录 Desktop
  → 进入企业控制台
  → 创建邀请并管理成员角色
  → 查看企业内全部云端项目
  → 查看 Skill 审核与 AI 配置分发
  → 查看关键审计事件
```

对应阶段：

- H2
- H3
- H6
- H7

### 4.3 Desktop UX Hardening MVP

第三阶段最小可验收闭环：

```text
普通成员打开 Desktop
  → 清晰看到云端项目状态
  → 可理解地 push/pull
  → 出错时得到明确原因和下一步
  → 可查看版本、恢复文件、处理冲突副本
  → 可在 Skill 页面完成安装/更新
```

对应阶段：

- H4
- H5
- H8

---

## 5. 进度看板

| 阶段 | Status | 负责人 | 最近更新 | 备注 |
|------|--------|--------|----------|------|
| H0 现状审计与信息架构 | `DONE` | Cursor | 2026-06-12 | 审计报告 `IPM_V2_1_H0_AUDIT.md`：功能地图、角色矩阵、A1-A10/U1-U6 差距、IA-1/2/3 决策、回归矩阵 |
| H1 Platform Super Admin 基础 | `DONE` | Cursor | 2026-06-12 | migration 0007、platform 模块+CLI、中间件状态校验（A1/A2/A6）、objects 组织隔离（A5/A11）、auth 限流（A7 部分）、CHECK 约束（A8）；`scripts/h1-verify.mjs` 30/30 通过 |
| H2 Enterprise Admin 用户与角色管理 | `DONE` | Cursor | 2026-06-12 | migration 0008、org 模块 7 端点+权限矩阵+5 类审计事件、撤销邀请码（A3 部分）、AuthContext（U3）、企业控制台成员页（顶部 Tab 壳）；`scripts/h2-verify.mjs` 27/27 通过 |
| H3 Enterprise Workspace 管理 | `DONE` | Cursor | 2026-06-12 | A4 三态语义全路由生效（共用门控 helper）、org 模块 7 个治理端点+5 类审计事件、企业控制台「云端项目」Tab（列表+详情抽屉+治理弹窗）、协作端归档只读适配；`scripts/h3-verify.mjs` 37/37 通过 |
| H4 云端项目权限模型与管理页 | `DONE` | Cursor | 2026-06-12 | 可见性模型(私有默认/邀请码协作/公开只读)+ 协作页重构为管理中枢 + A10 完结;h4-verify 59/59;原 UX 重构内容拆为 H4.5 |
| H4.5 同步/版本/冲突 UX 重构 | `DONE` | Cursor | 2026-06-12 | useSyncStatus 统一状态层 + HeaderBar 云状态 chip + SyncDrawer(状态/版本)+ EntryTable 内联徽标与响应式列;U1 完结 |
| H5 Skill Governance UX 重构 | `DONE` | Cursor | 2026-06-12 | 成员侧 KnowClaw 面板重组(本地/市场/我的提交)+ 控制台「技能治理」Tab;归档/mine/overview/installers 端点 + 4 类审计事件 + per-file sha256 diff;h5-verify 55/55 |
| H6 Enterprise Config Center | `DONE` | Cursor | 2026-06-13 | config_json AES-256-GCM 静态加密 + 回填脚本 + enable/PATCH 端点 + 2 类审计;控制台「配置中心」Tab(EnterpriseConfigView)+ 设置页 Linear 左导航重构(企业节仅成员导入,接入 useAuth);h6-verify 33/33;U5 完结 |
| H7 企业数据监测与审计 + 平台 Web 控制台 | `DONE` | Cursor | 2026-06-14 | 企业 `GET /api/org/stats` + `/api/org/events`(多维过滤/游标分页,owner/admin 网关) + Desktop `EnterpriseOverviewView`(概览/审计/风险);平台 `GET /api/platform/events`+`/stats`;`@fastify/static` 托管 `/platform-console` 纯静态单页(登录/企业列表/详情/创建/停用恢复/owner/邀请码/管理员只读/平台审计),helmet CSP 收敛(script 'self'、style 'unsafe-inline');h7-verify 30/30;IA-2 落地(Web 控制台已交付,CLI 退为兜底) |
| H8 回归测试、打包与交付加固 | `DONE` | Cursor | 2026-06-15 | `h8:gate`（`scripts/h8-release-gate.mjs`）统一调度 cloud typecheck/build/migrate/check + h1-h7 + desktop renderer build + Forge package smoke，分类 blocking/nonBlockingExternal 并出 JSON/MD 报告；限流可配置(`AUTH_RATE_LIMIT_MAX`)+ gate 自建临时 server 按套件切档位解决 A7 累计限流；`cloudClient` 传输失败映射 `NETWORK` 可读文案；`H8_RELEASE_CHECKLIST.md` 落地 C1-C9 自动/手动矩阵+错误提示覆盖；忽略策略补 `.h8-reports/`/`desktop/dist`。实测 Forge `ETIMEDOUT` 判 non-blocking，gate PASS |

---

## 6. 当前关键决策记录

### HD1 — 暂缓 C10-C13

**决策**：暂缓 NAS / 飞书 / 微盘 / 外部 Agent 记录导入，优先强化 C1-C9。

**理由**：
- C1-C9 已形成云端协作与企业化基础，但管理与体验仍不够产品化；
- 外部生态会放大现有云端管理与权限复杂度；
- 企业客户首先需要用户、项目、Skill、配置和审计管理闭环。

### HD2 — 超级管理员与企业管理员分层

**决策**：Platform Super Admin 管平台企业生命周期；Enterprise Admin 管本企业用户、项目、Skill、配置和数据。

**理由**：
- 平台运营和企业自治是两个权限域；
- Desktop 企业管理员不应获得跨企业能力；
- 后续计费、License、风控可以自然接在平台管理员层。

### HD3 — 企业管理优先放在 Desktop

**决策**：企业 owner/admin 的日常管理入口优先放在 Desktop 内，而不是先建设完整 server Web Console。

**理由**：
- IPM 当前主要工作流都在 Desktop；
- 企业管理员也是 IPM 用户，管理动作与本地项目、Skill、配置紧密相关；
- 完整 Admin Web Console 可后置，先做 Desktop 企业控制台更贴近当前产品。

### HD4 — 云端项目治理不静默改写本地文件

**决策**：企业管理员可以停用、恢复、归档云端 workspace，但不直接删除或改写成员本地文件。

**理由**：
- 延续 local-first 原则；
- 律师文件需要保留本地证据链；
- 风险操作应在云端权限层生效，而不是静默破坏用户本地资料。

### HD5 — 强化阶段先产品化，不追求重型平台化

**决策**：H 阶段优先做清晰入口、权限、状态、错误提示、审计和回归测试，不引入复杂 BI、计费、SSO、部门组织架构。

**理由**：
- 当前目标是让 C1-C9 可交付；
- 过早引入重型企业平台能力会拖慢核心闭环；
- 轻量但边界清晰的管理能力更适合当前阶段。

---

## 7. 后续拆分建议

建议后续每次只启动一个 H 阶段，按以下顺序推进：

1. H0：先做审计和信息架构，避免直接改 UI 造成返工。
2. H1：补平台企业生命周期，建立最高权限边界。
3. H2-H3：完成企业控制台骨架。
4. H4-H6：重做用户高频体验。
5. H7-H8：补齐观测、审计、测试和交付门禁。

每个 H 阶段进入开发前，应单独生成实施计划，明确：
- 数据表与 migration 是否变化；
- 后端 API；
- Desktop IPC/preload；
- UI 页面和状态；
- 权限边界；
- 验证清单；
- 对既有 C1-C9 行为的兼容影响。

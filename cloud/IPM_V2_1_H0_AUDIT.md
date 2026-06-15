# IPM v2.1 H0 — C1-C9 现状审计与信息架构

> **定位**：本文档是 `IPM_V2_1_C1_C9_HARDENING_PLAN.md` 中 Phase H0 的交付物，为 H1-H8 提供功能地图、角色矩阵、入口决策、权限差距清单与回归测试矩阵。
>
> **审计范围**：`cloud/server/src/**`（全部 7 个 route 模块 + 6 个 migration + 中间件 + CLI）、`desktop/src/main/ipc/*.js`（cloud/auth/skills/prefs）、`desktop/src/preload.js`、`desktop/src/ui/components/**`（云端相关 UI）。
>
> **审计日期**：2026-06-12。所有结论均逐文件核对源码得出，非凭文档推断。

---

## 1. C1-C9 功能地图

按七个功能域汇总「数据表 → 服务端 API → 桌面 IPC → UI 入口」四层映射。服务端共 **46 个端点**（含根路由与健康检查），桌面端云端相关 IPC 共 **42 个通道**（cloud 19 / auth 6 / skills registry 10 / prefs.orgConfig 7），进度推送事件 4 个（`cloud:scanProgress` / `cloud:publishProgress` / `cloud:pullProgress` / `cloud:syncProgress`）。

### 1.1 账号与认证（C3.5）

| 层 | 内容 |
|---|---|
| 数据表 | `users`（+`password_hash`）、`invite_codes`、`refresh_tokens` |
| API | `POST /api/auth/register`（邀请码+行锁）、`login`、`refresh`（token rotation）、`logout`、`GET /api/auth/me`（返回 `orgRole`）、`GET /auth/status` |
| IPC | `auth/getStatus`、`auth/register`、`auth/login`、`auth/logout`、`auth/useOffline`、`auth/switchUser` |
| 桌面模块 | `authStore.js`（safeStorage 加密 token，<60s 自动刷新）、`userScope.js`（`users/{userId}/` 与 `_offline/` 数据隔离，保存 `orgRole`） |
| UI | `auth/LoginPage.jsx`（登录/注册/离线入口）、`Sidebar.jsx` 账号菜单（切换账号/退出/离线转登录） |
| CLI | `npm run invite:create -- --org <orgId> [--role] [--max-uses] [--expires-days]`（直连 DB，无鉴权） |

### 1.2 组织（C1/C3.5）

| 层 | 内容 |
|---|---|
| 数据表 | `orgs`（status 列**从未被校验**）、`org_members`（role: owner/admin/member） |
| API | **无独立 org 管理端点**。org 信息只在 register/login/me 的响应中附带；成员列表仅 `GET /api/skills/admin/org-users`（为 Skill 授权服务） |
| IPC / UI | 无任何组织管理 IPC 与 UI |
| 结论 | 组织域是 H1（平台创建/停用企业）与 H2（企业成员管理）的空白起点 |

### 1.3 Workspace 协作（C3/C4）

| 层 | 内容 |
|---|---|
| 数据表 | `workspaces`（domain: projects/cases/study；status 仅 list/join 过滤）、`workspace_members`（owner/editor/viewer）、`workspace_folders` |
| API | `GET/POST /api/workspaces`、`GET /api/workspaces/:id`、`POST :id/join`（幂等 editor）、`GET :id/versions/latest`、`GET :id/sync-status`（返回 `myRole`）、`GET/POST :id/folders`（POST owner-only） |
| IPC | `cloud/getBindingStatus`、`cloud/scanWorkspace`、`cloud/publish`、`cloud/cancelPublish`、`cloud/getLockedWorkspaces`、`cloud/listWorkspaces`、`cloud/joinWorkspace`、`cloud/pull`、`cloud/cancelPull`、`cloud/downloadFile` |
| 桌面模块 | `cloudBinding.js`（`meta/cloud.json`）、`workspaceScanner.js`、`publishWorkspace.js`（6 步编排 + `publishLock` 写锁）、`pullWorkspace.js`、`downloadOnDemand.js`（`.ipmcloud` 占位，>50MB） |
| UI | `CloudProjectsPage.jsx`（侧边栏「协作项目」，仅登录可见）、`PublishModal.jsx`（右键菜单/HeaderBar 触发）、`CloudActivityPanel.jsx`（侧边栏底部活动条）、`useCloudPublish.jsx`（全局发布生命周期） |

### 1.4 同步与版本（C5/C6）

| 层 | 内容 |
|---|---|
| 数据表 | `versions`（type: sync/milestone + label）、`version_entries`（status: active/soft_deleted）、`objects` |
| API | `POST /api/workspaces/:id/versions`（乐观并发 `REMOTE_AHEAD`；milestone owner-only）、`GET :id/versions`（`?type=milestone`）、`GET :id/file-history`、`POST :id/versions/:vid/file-download`、`POST :id/conflict-events`、`POST :id/versions/:vid/promote`（owner-only）；对象层 `POST /api/objects/check|upload-urls|confirm|download-urls` |
| IPC | `cloud/getSyncStatus`、`cloud/computeSyncPlan`、`cloud/pushSync`、`cloud/pullUpdate`、`cloud/cancelSync`、`cloud/createMilestone`、`cloud/listVersions`、`cloud/listFileHistory`、`cloud/restoreFileFromVersion` |
| 桌面模块 | `syncEngine.js`（纯函数三方 diff）、`cloudBaseline.js`（`meta/cloud-baseline.json`）、`pushSync.js`、`syncStatus.js`、`fileRestore.js`（恢复前备份） |
| UI | `SyncStatusBar.jsx`（项目 HeaderBar 下方，轮询状态）、`SyncPreviewModal.jsx`（push 预览/冲突提示）、`MilestoneModal.jsx`（owner）、`ConflictCopiesModal.jsx`、`FileHistoryRestoreModal.jsx`（文件右键「查看历史/恢复文件」） |

### 1.5 Skill 市场与治理（C7/C8）

| 层 | 内容 |
|---|---|
| 数据表 | `skills`（status: pending_review/approved/rejected/archived + reviewed_by/at/note）、`skill_versions`、`skill_installs`、`skill_access_grants`（org/user 两级） |
| API | 成员侧：`POST /api/skills/upload-url`、`POST /api/skills`（→pending_review）、`POST :id/versions`、`GET /api/skills`（仅 approved+有授权）、`GET /api/skills/installed`、`GET :id`、`POST :id/versions/:versionId/download`（二次强校验，admin 不可绕过）、`POST :id/install`；管理侧（owner/admin）：`GET /api/skills/admin/review-queue`、`GET /api/skills/admin/org-users`、`POST :id/review`、`GET/POST :id/access` |
| IPC | `knowclaw:registryListSkills`、`registryGetSkill`、`registryPublishSkill`、`registryPublishVersion`、`registryInstallSkill`、`registryAdminListReviewQueue`、`registryAdminListOrgUsers`、`registryAdminReviewSkill`、`registryAdminGetAccess`、`registryAdminSetAccess` |
| 桌面模块 | `skillPackage.js`（`.ipmskill` 打包/sha256 校验/安全解包） |
| UI | `SkillManagerPanel.jsx`（Tab：本地 / 组织市场 / 审核管理[仅 owner/admin]）、`SkillMarketplacePanel.jsx`、`PublishSkillModal.jsx`、`SkillReviewAdminPanel.jsx`、`SkillAccessModal.jsx` —— 全部挂在 KnowClaw 技能管理侧栏内 |

### 1.6 企业 AI 配置分发（C9）

| 层 | 内容 |
|---|---|
| 数据表 | `org_config_templates`（code 唯一、max_uses/used_count/expires_at/status）、`org_config_template_uses` |
| API | 管理侧（owner/admin）：`POST /api/org-configs/templates`、`GET templates`、`POST :id/rotate-code`、`POST :id/disable`、`GET :id/uses`；成员侧：`POST /api/org-configs/preview`（不计数）、`POST /api/org-configs/import`（事务计数+记录） |
| IPC | `prefs/orgConfig/createTemplate`、`listTemplates`、`rotateCode`、`disableTemplate`、`listUses`、`previewCode`、`importCode` |
| UI | `SettingsPage.jsx` 内「企业 AI 配置」卡片（管理与导入混在同一卡片，**是当前唯一的企业管理类 UI**） |

### 1.7 基础设施

| 层 | 内容 |
|---|---|
| 服务端 | Fastify v5 + `@fastify/helmet` + `@fastify/cors`；`middleware/auth.ts` 全局 preHandler（Bearer JWT → 非生产 `X-Dev-User-Id` 兜底）；公开路径白名单：`/`、`/health`(/前缀)、`/auth/status`、`/api/auth/register|login|refresh|logout` |
| 数据库 | PostgreSQL 16，自研迁移器（`schema_migrations` 跟踪，0001-0006 共 18 张表） |
| 存储 | 阿里云 OSS，签名 URL 直传（PUT/GET 各 15min，Content-Type 固定 `application/octet-stream`），blob key：`blobs/sha256/{前2}/{hash}.bin`，Skill key：`skills/{orgId}/{slug}/{version}/{sha256}.ipmskill` |
| 部署 | Docker Compose（postgres + api:4210）+ systemd oneshot；无 nginx 配置（README 建议生产加反代） |
| CLI | `db:migrate`、`db:migrate:prod`、`db:check`（事务自检+ROLLBACK）、`db:seed`（dev 身份）、`invite:create` |

---

## 2. 角色矩阵

### 2.1 角色定义与现状

| 角色 | 存在形式 | 现状 |
|---|---|---|
| **Platform Super Admin** | **不存在**（代码零痕迹，无数据列、无路由、无 CLI 身份） | H1 从零建立。当前"平台运营"动作只能靠直连 DB / `db:seed` / `invite:create` |
| **Org Owner** | `org_members.role='owner'` | 与 admin 在代码中**完全等价**（`isOrgAdmin()` = `role IN ('owner','admin')`），无 owner 专属能力 |
| **Org Admin** | `org_members.role='admin'` | 可用 Skill 审核/授权、AI 配置模板管理、org 成员列表（仅 Skill 授权场景） |
| **Org Member** | `org_members.role='member'` | 可用全部协作/市场/导入能力 |
| **Workspace Owner** | `workspace_members.role='owner'`（创建者自动获得） | 专属：提交/晋升 milestone、全量替换 `workspace_folders` |
| **Workspace Editor** | `workspace_members.role='editor'`（join 默认） | 可 push/pull/提交 sync 版本 |
| **Workspace Viewer** | `workspace_members.role='viewer'` | schema 支持，**无任何赋予路径**（join 固定 editor，无角色调整 API），实际不可达 |

### 2.2 能力 × 角色矩阵（当前实际执行情况）

| 能力 | member | org admin | org owner | ws owner | 执行点 |
|---|---|---|---|---|---|
| 注册/登录/刷新 | ✅ | ✅ | ✅ | — | auth 路由（唯一校验 `users.status` 的地方） |
| 创建/加入/拉取 workspace | ✅ | ✅ | ✅ | — | `org_members.status` 仅创建时校验，join 仅比对 orgId |
| push sync 版本 | ✅(editor) | ✅ | ✅ | ✅ | viewer 被拒（403） |
| milestone 提交/晋升 | ❌ | ❌* | ❌* | ✅ | `workspace_members.role='owner'`；*org admin 若非 ws owner 也不行 |
| 修改 canonical 文件夹 | ❌ | ❌* | ❌* | ✅ | 同上 |
| 发布 Skill / 提交版本 | ✅ | ✅ | ✅ | — | 进入 pending_review |
| 审核 Skill / 设授权 | ❌ | ✅ | ✅ | — | `requireOrgAdmin` |
| 下载/安装 Skill | 需授权 | 需授权（**admin 不能绕过授权下载**） | 同左 | — | `canAccessSkill` 强校验 |
| AI 配置模板管理 | ❌ | ✅ | ✅ | — | `requireOrgAdmin` |
| 配置码预览/导入 | ✅ | ✅ | ✅ | — | 同组织+active+未过期+未超限 |
| 查看 org 成员列表 | ❌ | ✅（仅 Skill 授权场景） | ✅ | — | `GET /api/skills/admin/org-users` |
| 调整成员角色/停用成员 | **无人可做**（无 API） | | | | H2 空白 |
| 企业内全部 workspace 总览 | **无人可做**（list 只按成员身份过滤？否——按 org 过滤，见 §2.3） | | | | H3 |
| 企业/用户生命周期管理 | **无人可做** | | | | H1/H2 空白 |

### 2.3 矩阵中的两个语义注意点

1. `GET /api/workspaces` 实际返回 **org 内全部 active workspace**（不限是否加入），UI 上 CloudProjectsPage 即"组织内项目浏览器"。H3 的"企业项目总览"在数据可见性上已部分存在,缺的是**治理操作**（停用/归档/成员查看/风险状态）与管理视角字段。
2. org owner 与 admin 当前无差别。H2 要求"owner 权限高于 admin（admin 不可移除 owner、防止最后一个 owner 被移除）"，需要首次在代码中区分两者。

---

## 3. 权限与安全差距清单（核对结论）

供 H1/H2/H8 直接引用。编号 A 系列 = 审计发现（Audit Finding）。

| # | 发现 | 证据位置 | 影响 | 归属 |
|---|---|---|---|---|
| A1 | `orgs.status` **全代码库零处校验** | 全局搜索确认 | 停用企业无任何执行点，H1 核心目标 | H1 |
| A2 | JWT（2h）签发后无吊销机制；除 login/refresh 外所有端点不复查 `users.status` / `org_members.status` | `middleware/auth.ts` 只解 JWT | 停用账号/企业后最长 2h 内仍可操作所有受保护端点 | H1/H2 决策点 |
| A3 | `GET /api/auth/me` 不校验 `users.status` | `auth/routes.ts` L265-272 | 禁用账号仍可获取自身信息（轻微） | H2 |
| A4 | workspace 详情/版本/同步/folders 路由不过滤 `workspaces.status`，仅 list 与 join 过滤 | `workspaces/routes.ts` L62、L94 | "归档=不可见"但**已加入成员仍可读写**；H3 的停用语义需重新设计 | H3 |
| A5 | objects 四个端点（check/upload-urls/confirm/download-urls）**无 org/workspace 隔离**，任意登录用户可 confirm 任意 pending 对象、可凭 sha256 获取下载 URL | `objects/routes.ts` | 跨组织数据边界缺失；知道 sha256 即可下载 blob | H1 或独立安全项（建议尽早） |
| A6 | workspaces/versions 系列路由不复查 `org_members.status`（仅 `workspace_members`） | `workspaces/routes.ts`、`versions/routes.ts` | 被移出组织但仍在 workspace_members 中的用户可继续协作 | H2 |
| A7 | 无限流；login 无暴力破解保护；无显式 bodyLimit（Fastify 默认 1MiB） | `app.ts` | 安全基线缺失 | H8（或提前到 H1） |
| A8 | `users/orgs/org_members/workspaces` 的 status 列均**无 CHECK 约束** | 0001_init.sql | 直接 SQL 可写入任意状态值 | H1 顺手加约束 |
| A9 | `invite-cli`/`seed` 直连 DB 无鉴权，生产服务器上任何能登录 shell 的人都可造账号 | `invite-cli.ts` | 平台管理入口缺失的体现 | H1 |
| A10 | workspace_members 无角色调整/移除 API；viewer 角色不可达 | 全路由核对 | H2/H3 需补 | H2/H3/H4（已完结，见 H4 补录） |
| A11 | `upload-urls` 对已 `available` 的对象同样签发 PUT URL（upsert 仅刷新 `last_seen_at`,不检查状态）,且 OSS 签名不校验内容哈希 | `objects/routes.ts` L87-97 | 任何登录用户凭已知 sha256 可覆写他人 blob（内容投毒,破坏完整性;下游 pull 校验缺失则静默拿到脏数据） | H1（随 A5 一并修复） |

**H1 修复补录（2026-06-12，验证 `cloud/server/scripts/h1-verify.mjs` 30/30 通过）**

- **已修复**：A1（中间件每请求校验 `orgs.status`）、A2/A6（每请求合并复查 `users.status` + `org_members.status`，停用即时生效，等效消除 2h 窗口；JWT 本身仍不吊销，按 IA-3 决策）、A3（`/api/auth/me` 经中间件统一校验）、A5（objects 按组织隔离：`org_id NOT NULL` + `UNIQUE(org_id, sha256)` + org 路径 storage key + versions 提交 org 校验）、A8（四表 status CHECK 约束，migration 0007）、A11（仅 `pending` 行签发 PUT URL）。
- **部分修复**：A7（`/api/auth/register|login|refresh` 已限流，默认 20 次/分钟；**H8 改为可配置** `AUTH_RATE_LIMIT_MAX`/`AUTH_RATE_LIMIT_WINDOW`，生产禁止设 0；全局限流与 bodyLimit 调整仍可后续评估）、A9（`platform-cli` 提供受控管理入口并写审计事件，`invite:create` 归并；CLI 直连 DB 的形态不变，shell 权限即信任锚点）。
- **未动**：A4（workspace 状态语义，H3）、A10（成员管理 API，H2/H3）。

**H2 修复补录（2026-06-12，验证 `cloud/server/scripts/h2-verify.mjs` 27/27 通过）**

- **已修复**：A3（补充说明：H1 中间件已统一校验，H2 进一步为被停用成员提供即时 403 `MEMBER_DISABLED` 的协作 API 拦截验证）、A10 **org 层部分**（`modules/org/` 落地企业成员的角色调整、停用/恢复 API，含 owner 不可动/admin 仅管 member/禁止停用自己的权限矩阵；**workspace_members 层的角色调整/移除仍归 H3**）、U3（渲染层 `AuthContext` 建立，`orgRole` 单一来源，Sidebar 与企业控制台已消费；SkillManagerPanel/SettingsPage 等存量组件在各自阶段迁移）。
- **新增能力**：邀请码全生命周期管理（列表/撤销，`invite_codes.revoked_at`，撤销码注册 400 `INVITE_REVOKED`）、5 类 `org.*` 审计事件、企业控制台成员页（顶部 Tab 壳，IA-1 的「成员」子页实装）。

**H3 修复补录（2026-06-12，验证 `cloud/server/scripts/h3-verify.mjs` 37/37 通过）**

- **已修复**：A4（workspace 三态语义全路由生效：共用门控 helper `workspaces/access.ts`，写动作仅 `active`〔403 `WORKSPACE_ARCHIVED`/`WORKSPACE_DISABLED`〕，读动作 `active`+`archived`，`disabled` 全 403；成员列表按 IA-3 语义返回 `active`+`archived` 带 status 标记、隐藏 `disabled`，治理列表仍全量可见）、A10 **workspace 层企业兜底部分**（org 治理 API：转移 owner〔原 owner 降 editor〕、移除成员〔owner 须先转移，409 `OWNER_MUST_TRANSFER`〕；**项目 owner 自助成员管理（editor/viewer 调整等）仍归 H4**，viewer 角色入口仍不可达）。
- **新增能力**：企业 workspace 治理 7 端点（列表/详情/archive/restore/disable/transfer-owner/remove-member，admin+）、DB 维度风险标记（`NO_OWNER`/`OWNER_DISABLED`/`NO_VERSION`/`INACTIVE`）、5 类 `workspace.*` 治理审计事件、企业控制台「云端项目」Tab（IA-1 第二个子页实装：列表+详情抽屉+治理弹窗）、协作端归档只读适配（列表标记、SyncStatusBar 只读横幅、`sync-status` 返回 `workspaceStatus`）。

**H4 修复补录（2026-06-12，验证 `cloud/server/scripts/h4-verify.mjs` 59/59 通过）**

- **A10 完结**：viewer 角色全链路可达（公开项目自助加入即 viewer，只读可拉取、push 403），项目 owner 自助成员管理落地（`/api/workspaces/:id/members/:userId/role|remove` + `transfer-owner`，viewer↔editor 调整、移除、转移所有权，鉴权=项目 owner，与 H3 企业 admin 兜底治理并存）。A10 至此**全部修复**。
- **可见性模型重设计**（H4 决策，替代原「org 全量可见 + 任意 join=editor」）：`workspaces.visibility = private|public`（migration 0009，存量一律 private）；`GET /api/workspaces` 只返回我是成员的项目；新 `GET /api/workspaces/public` 为唯一发现面；私有项目对非成员一律 404（含 `requireWorkspaceAccess` 非成员路径由 403 改 404，隐藏存在性）；自助 join 仅公开项目且角色降为 viewer。
- **项目邀请码**：新表 `workspace_invites`（`WS-XXXX-XXXX`，max_uses/expires_at/revoked_at），owner CRUD+撤销，`POST /api/workspaces/join-by-code` 凭码加入=editor（邀请码即信任凭证），撤销/过期/超次数统一 400 `INVALID_INVITE` 不暴露项目，跨企业码无效。
- **审计事件**：新增 `workspace.visibility_changed`/`invite_created`/`invite_revoked`/`member_role_changed`（payload 带 `by: 'project_owner'` 与企业治理区分），`workspace.joined` 注明途径（`via: invite_code|public`）。
- **桌面端**：CloudProjectsPage 重构为云端项目管理中枢（确认稿 `desktop/design/cloud-projects-mockup.html`，Linear 风格）：我的项目（全部/我创建/我参与）+ 公开项目区 + 凭码加入；详情页概览/成员/邀请码/设置四 Tab，owner 自助管理全量 UI；11 个新 `cloud/*` IPC 通道。文件查看与同步仍在「我的资料」，拉取副本入口保留。

**H4.5 修复补录（2026-06-12，desktop `vite build` 通过）**

- **U1 完结**：新 `useSyncStatus` hook 统一取数（sync-status + sync-plan 轮询，序号防竞态），HeaderBar 云状态 chip + 右侧 SyncDrawer（状态/版本两 Tab，flex 同级动画挤压）成为「我的资料」内同步/版本/冲突的单一入口；EntryTable 行内同步徽标 + `ResizeObserver` 响应式列；`SyncStatusBar.jsx`/`ConflictCopiesModal.jsx` 删除（功能并入抽屉）。

**H5 修复补录（2026-06-12，验证 `cloud/server/scripts/h5-verify.mjs` 55/55 通过）**

- **U5 之 Skill 部分完结**：管理动作按层级分流——成员侧留在 KnowClaw 技能面板（加宽 340px，Tab 重组为 本地/组织市场/我的提交；市场详情弹窗含 SKILL.md 预览与版本 diff 摘要；发布弹窗显示线上版本并预填建议版本号），管理侧迁入企业控制台「技能治理」Tab（审核队列+授权弹窗替代 `window.prompt`、全量目录含安装统计、详情抽屉含版本 diff/安装者落后标记/归档恢复）。原 KnowClaw「审核管理」Tab 及 `SkillReviewAdminPanel.jsx`/`SkillAccessModal.jsx` 删除。**企业 AI 配置卡片部分仍归 H6**。
- **后端缺口补齐**：归档/恢复端点（prevStatus 存 metadata、归档阻断市场/安装/新版本、409 幂等）、`mine`/`admin/overview`/`installers` 端点、4 类审计事件（`skill.installed`/`archived`/`unarchived`/`access_changed`）、打包 manifest per-file sha256（旧包退化按大小比较）。

**H6 修复补录（2026-06-13，验证 `cloud/server/scripts/h6-verify.mjs` 33/33 通过）**

- **U5 完结**：企业 AI 配置的管理动作迁入企业控制台「配置中心」Tab（`EnterpriseConfigView.jsx`：模板表格/详情抽屉/创建从本机配置弹窗/编辑元数据/刷新配置码/停用/重新启用/导入记录），设置页（`SettingsPage.jsx`）改 Linear 左侧分区导航且企业节裁剪为成员侧导入（`OrgImportCard` 预览+覆盖导入），删除原嵌入式管理员模板管理 UI。U5 所列两处分散 UI（Skill 侧栏、Settings 配置卡片）至此全部落定到企业控制台。
- **静态加密（消除 API Key 明文落库隐患）**：`org_config_templates.config_json` 改为 AES-256-GCM 信封存储（`infra/crypto.ts`，密钥环境变量 `CONFIG_ENC_KEY`，生产拒绝 dev 默认值），读写透明加解密、旧明文行向后兼容，附幂等回填脚本 `encrypt-org-configs.mjs`；h6-verify 含「库中不含 Provider/搜索 API Key 明文」密文落库断言。
- **后端缺口补齐**：`enable` / `PATCH` 端点 + `org_config_template.enabled`/`updated` 审计事件；修复 import 端点 `FOR UPDATE` 与 `LEFT JOIN` 冲突的既有 bug（改 `FOR UPDATE OF t`）。
- **auth 单一来源**：`SettingsPage` 改用 `useAuth()`（替代 `currentUser` prop），呼应 U3 的渲染层全局角色 store。

### 桌面端 UX 层发现（供 H4/H5/H6 引用）

| # | 发现 | 影响 | 归属 |
|---|---|---|---|
| U1 | 云端状态呈现分散：RootTable 云图标、HeaderBar 图标、SyncStatusBar、CloudActivityPanel、ConflictCopiesModal、FileHistoryRestoreModal 各自独立取数（多次 IPC），无共享状态层 | 状态可能短暂不一致；用户难以建立"本地/云端/待同步"心智模型 | H4.5（已完结，见 H4.5 补录） |
| U2 | HeaderBar「发布到云端」按钮不检查登录状态，离线用户可点击，最终由 IPC 层返回 OFFLINE | 错误后置，体验差（非数据安全问题） | H4 |
| U3 | `orgRole` 无渲染层全局 store：SkillManagerPanel 与 SettingsPage 各自 useState 持有；服务端角色变更需重启应用才生效 | 角色驱动 UI 的一致性基础缺失，H2-H7 的企业控制台都依赖它 | H2（建立全局 auth/role context） |
| U4 | 进度推送事件（4 个 `cloud:*Progress`）以 `projectName+domain` 区分，无会话 ID | 同名并发操作有扇入风险（当前用 Map 防护） | H4 |
| U5 | Skill 治理 UI 全部嵌在 KnowClaw 技能侧栏（SkillManagerPanel 第三个 Tab），企业 AI 配置嵌在 SettingsPage 卡片 | 管理功能分散，与 H5/H6 的"企业控制台"目标不符 | H5（Skill 已完结）+ H6（企业 AI 配置已完结，见 H6 补录）→ **已完结** |
| U6 | `.ipmcloud` 占位文件在文件浏览器中无特殊图标/下载交互（C4 遗留 F3） | 用户不理解占位文件 | H4 |

---

## 4. 信息架构决策

### IA-1：Desktop 企业管理入口 → 侧边栏一级入口「企业控制台」（仅 owner/admin 可见）

**决策**：新增侧边栏一级导航「企业控制台」（Enterprise Console），仅 `orgRole IN ('owner','admin')` 渲染；内部以子页组织：**概览(H7) / 成员(H2) / 云端项目(H3) / Skill 治理(H5) / 配置中心(H6) / 审计事件(H7)**。

**理由**：
- H2/H3/H5/H6/H7 五个阶段都要挂管理页,Settings 子页容纳不下且语义不符（Settings 是个人偏好域）;
- 现有先例:「协作项目」已是登录态条件渲染的一级导航,技术路径成熟（`Sidebar.jsx` 按 auth 状态渲染）;
- C8/C9 已散落的管理 UI（Skill 审核 Tab、企业 AI 配置卡片）在 H5/H6 迁入控制台,原入口保留为快捷跳转或移除（各阶段实施计划内定）。

**配套前置**（在 H2 落地）：建立渲染层全局 auth context（修复 U3），`orgRole` 单一来源,登录/切换账号/角色变更后统一刷新。

### IA-2：Server 超级管理员入口 → 先 API + CLI，不做 Web Admin
> **修订（2026-06-12，H1 完成后）**：产品确认需要平台 Web 控制台,已作为功能需求纳入 H7——形态为 **cloud 侧 server 托管的轻量单页**（如 `/platform-console`）,图形化 H1 已交付的 `/api/platform/**`,CLI 退为引导与兜底入口;「Desktop 不暴露平台功能」边界不变。H1 实际落地选择:`platform_admins` 表 + 每请求查表（无 JWT claim）。
>
> **结论落地（2026-06-14，H7 完成）**：平台 Web 控制台已交付——`@fastify/static` 托管的纯静态单页 `/platform-console`（无独立前端部署面、无新权限模型，复用「账号登录 + `platform_admins` 每请求校验」+ `/api/platform/**` 网关）。涵盖登录（非平台管理员探测平台 API 403 即明确拒绝）、企业列表/详情/创建/停用恢复/指定 owner/邀请码、平台管理员只读、平台审计（`platform.*` 流水）。**授予/撤销平台管理员仍仅走服务器 CLI**（Web 端只读，杜绝权限自提升），CLI 由「唯一入口」降级为「兜底入口」。

**决策**：H1 平台管理走「专用 API（独立前缀 `/api/platform/**`）+ 服务器端 CLI」。平台身份用**环境变量白名单**（如 `PLATFORM_ADMIN_EMAILS`）或独立 `platform_admins` 表（H1 实施计划二选一,倾向后者+审计友好）,JWT 中加 `platformAdmin` 声明或每请求查表。**Desktop 不暴露任何平台级功能**（HD2 边界）。

**理由**：
- 平台运营者就是开发者自己,当前规模下 CLI 完全够用,Web Admin 是 HD5 明确排除的重型化;
- 独立路由前缀便于中间件层一刀切隔离（企业用户 token 永远进不来）;
- `invite:create`/`seed` 等既有 CLI 自然归并到平台 CLI 体系（解决 A9）。

### IA-3：停用语义统一定义（供 H1/H2/H3 共用）

| 对象 | 停用后语义 | 执行层 |
|---|---|---|
| 企业（org） | 全体成员登录被拒；已发 JWT 在中间件层被拒（需每请求校验 org 状态,接受查询开销或加缓存） | auth 中间件 + login/refresh |
| 成员（org_member） | login/refresh 被拒（已有）+ 受保护路由复查（补 A6）；同企业配置码/市场/云端项目全部失效 | 各路由统一守卫 |
| workspace | 成员不可 push/pull/join,**仍可见于企业控制台与成员列表（带"已停用"标记）**,本地文件不动（HD4） | workspace 路由层（修 A4 的语义:从"过滤消失"改为"可见但拒绝写操作"） |

> JWT 时滞决策：不引入 token 黑名单。停用执行点放在 DB 层每请求校验（org+member 状态合并进现有成员校验 SQL,增量成本一个 JOIN）,即时生效,接受查询开销。

---

## 5. C1-C9 回归测试矩阵

> 用法：每个 H 阶段收尾时跑对应行;H8 将此矩阵脚本化/checklist 化并补错误提示验收。标 ⚙ 的可用 Node 脚本自动化（参考 C5 的 24 项 e2e）,标 🖱 的需手动桌面操作。
>
> **H8 落地（2026-06-15）**：本矩阵已落成 `cloud/H8_RELEASE_CHECKLIST.md`——⚙ 项接入统一门禁 `npm run h8:gate`（`scripts/h8-release-gate.mjs` 调度 cloud 构建/迁移/自检 + `h1`-`h7` verify + desktop renderer build + Forge package smoke，并区分 blocking / nonBlockingExternal）;🖱 项保留为人工 checklist 含操作步骤与预期;另补「错误提示覆盖」（网络/OSS/权限/停用四类）。

| ID | 域 | 场景 | 预期 | 方式 |
|---|---|---|---|---|
| R-AUTH-1 | 认证 | 有效邀请码注册 → 登录 → `/me` | 201 / 200+token / 返回 orgRole | ⚙ |
| R-AUTH-2 | 认证 | 无效/过期/超限邀请码注册 | 400 且邀请码计数不变 | ⚙ |
| R-AUTH-3 | 认证 | refresh rotation：旧 refresh 复用 | 401 | ⚙ |
| R-AUTH-4 | 认证 | 错误密码 ×N | 401（H8 后:触发限流） | ⚙ |
| R-AUTH-5 | 认证 | 离线模式进入 → 数据落 `_offline/`;切换账号数据隔离 | 互不可见 | 🖱 |
| R-PUB-1 | 发布 | A 发布项目（含 >50MB 文件） | OSS blob 存在、v1 manifest 完整、`cloud.json`+baseline 写入、发布期间写锁生效 | ⚙+🖱 |
| R-PUB-2 | 发布 | 发布中取消/网络失败 | 解锁、无半绑定状态 | 🖱 |
| R-PULL-1 | 拉取 | B 列表→加入（幂等×2）→拉取 | 小文件落地、大文件 `.ipmcloud` 占位、baseline 用本地磁盘 mtime（防 C5-B1 回归） | ⚙ |
| R-PULL-2 | 拉取 | 占位文件按需下载 | 下载后占位删除、内容 sha256 一致 | ⚙ |
| R-SYNC-1 | 同步 | B 增/改/删 → pushSync | v2 提交、软删除标记、A 端 SyncStatusBar 显示云端有更新 | ⚙+🖱 |
| R-SYNC-2 | 同步 | A pullUpdate | 合并 B 变更、软删除文件本地保留并 tag | ⚙ |
| R-SYNC-3 | 同步 | 基线落后时 push | 409 REMOTE_AHEAD,UI 给出"先拉取"指引 | ⚙ |
| R-SYNC-4 | 同步 | 旧项目（空 workspace_folders）非 owner push 已有文件夹下新文件 | 不被误忽略（防 C5-B2 回归） | ⚙ |
| R-SYNC-5 | 同步 | 非 owner 在新文件夹下放文件 | 进入 ignored 并在预览中可见 | ⚙ |
| R-VER-1 | 版本 | owner 创建/晋升 milestone;editor 尝试 | owner 成功、editor 403;列表 `?type=milestone` 正确 | ⚙ |
| R-VER-2 | 版本 | 单文件历史 → 恢复旧版 | 恢复前备份、恢复后显示为本地待同步变更、不自动建云端版本 | 🖱 |
| R-CONF-1 | 冲突 | 双方改同一路径 → 后方 pull | 本地保留、云端版本存为冲突副本、`version.conflict_auto_kept_both` 事件入库 | ⚙ |
| R-SKILL-1 | Skill | member 提交 → 市场不可见 → admin 审核队列可见 | 状态 pending_review | ⚙+🖱 |
| R-SKILL-2 | Skill | 审核通过+全组织可见 / 指定用户可见 / 拒绝 | 三种可见性正确;未授权用户凭 ID 下载被 403 | ⚙ |
| R-SKILL-3 | Skill | 安装→新会话加载;市场新版本→更新提示;同名冲突 | 不静默覆盖本地同名 Skill | 🖱 |
| R-CFG-1 | AI 配置 | admin 建模板→member 预览（不计数）→导入（计数+记录） | 本地 `prefs.ai`/`prefs.searchApi` 被覆盖 | 🖱 |
| R-CFG-2 | AI 配置 | 超限/过期/停用/轮换后旧码/跨组织导入 | 全部明确错误,used_count 不变 | ⚙ |
| R-INFRA-1 | 基础 | `typecheck`+`build`+重复 `db:migrate`+`db:check` | 全绿、迁移幂等 | ⚙ |
| R-INFRA-2 | 基础 | renderer `vite build`;`npm run package`（注意外部网络 `20.205.243.166:443` 历史超时,区分代码错误与网络错误） | 构建通过 | ⚙ |
| （H1 后新增） | 治理 | 停用企业/成员/workspace 的拒绝路径 | 按 §4 IA-3 语义逐项验证 | ⚙ |

---

## 6. H1-H8 输入映射

| 阶段 | 本审计提供的直接输入 |
|---|---|
| H1 | A1/A2/A5/A7/A8/A9 差距清单;IA-2 入口决策;IA-3 停用语义;§1.2 组织域空白现状 |
| H2 | A3/A6/A10;U3（全局 auth context 前置）;§2.2 owner/admin 无差别现状;IA-1 控制台「成员」子页 |
| H3 | A4（workspaces.status 过滤语义重设计）;§2.3 注意点 1（list 已是 org 全量,补治理操作即可）;IA-1「云端项目」子页;IA-3 |
| H4 | U1/U2/U4/U6;§1.3-1.4 的 IPC/UI 全量清单(统一状态模型的改造面);§5 R-SYNC/R-VER/R-CONF 行 |
| H5 | U5;§1.5 Skill 全量清单;现有 5 个 Skill UI 组件迁入控制台「Skill 治理」 |
| H6 | §1.6 清单;SettingsPage 卡片迁入控制台「配置中心」,成员导入入口保留在 Settings |
| H7 | §3 events 现状(14 种 event_type,无查询 API);需补:登录、成员变更、workspace 治理、Skill 安装等事件;控制台「概览/审计」子页;**平台 Web 控制台**(IA-2 修订,cloud 侧托管页,图形化 `/api/platform/**` + `platform.*` 事件查询) |
| H8 | §5 全矩阵;A7(限流/bodyLimit);R-INFRA-2 的打包网络问题;`desktop npm run lint` 为占位脚本待补 |

### 现有 events 事件类型清单（H7 基线）

`user.registered`、`workspace.created`、`workspace.joined`、`version.committed`、`version.milestone`、`version.conflict_auto_kept_both`、`skill.submitted`、`skill.version_submitted`、`skill.approved`、`skill.rejected`、`org_config_template.created`、`org_config_template.code_rotated`、`org_config_template.disabled`、`org_config_template.imported` —— 共 14 种。**缺口**：登录/登出、成员角色变更/停用、workspace 停用/归档、Skill 安装/下载、平台管理操作（H1 起新增）。

---

## 7. 变更日志

- **H0 主体**（2026-06-12）：
  - 完成 cloud server 46 个端点、18 张表、全部权限执行点与 events 写入点的逐文件审计。
  - 完成 desktop 42 个云端相关 IPC 通道、preload 暴露面、16 个云端 UI 组件及其入口/角色门控的审计。
  - 产出：七域功能地图（§1）、角色矩阵与两个语义注意点（§2）、A1-A10 + U1-U6 差距清单（§3）、三项信息架构决策 IA-1/IA-2/IA-3（§4）、25 行回归测试矩阵（§5）、H1-H8 输入映射（§6）。
  - 关键发现：`orgs.status` 零处校验（H1 起点）;objects 模块无组织隔离（A5,建议尽早处理）;org owner 与 admin 代码层完全等价;workspace viewer 角色不可达;桌面端 orgRole 无全局 store。
  - 未实现任何新功能、未改动任何现有代码（符合 H0「不做」边界）。
- **H7 落地**（2026-06-14，§3 events「无查询 API」缺口完结 + IA-2 结论落地）：
  - 补齐审计查询面：企业侧 `GET /api/org/events`（多维过滤 + 游标分页，owner/admin 网关）与平台侧 `GET /api/platform/events`（`platform.*` 流水），配套 `GET /api/org/stats`、`GET /api/platform/stats` 聚合指标；Desktop 控制台「概览与审计」Tab 接入 `EnterpriseOverviewView`。复核确认 H2/H3 关键写操作（成员/项目/邀请码/平台/Skill/配置模板）均已落 event，审计可追溯，按「范围克制」未额外埋点。
  - IA-2 结论落地：平台 Web 控制台（`/platform-console` 纯静态单页）已交付，CLI 由唯一入口降级为兜底入口；平台管理员授予/撤销仍仅 CLI。详见 §4 IA-2。
- **H8 落地**（2026-06-15，§5 矩阵脚本化/checklist 化 + A7 完善 + 交付门禁）：
  - 统一 release gate `npm run h8:gate`（`cloud/server/scripts/h8-release-gate.mjs`）：cloud typecheck/build/db:migrate/db:check + `h1`-`h7` verify + desktop renderer build + Forge package smoke，失败分 `blocking` / `nonBlockingExternal`（网络/外部依赖下载失败只记录不阻断），出 JSON+MD 报告于 `cloud/server/.h8-reports/`。实测命中 `ETIMEDOUT 20.205.243.166:443` 正确判 non-blocking，gate PASS。
  - A7 完善：认证限流额度做成可配置（`AUTH_RATE_LIMIT_MAX` 默认 20、`AUTH_RATE_LIMIT_WINDOW` 默认 `1 minute`，生产禁止 0），并由 gate 自建临时 server 按套件切档位，解决 h1-h7 连跑时的累计限流误伤。
  - 错误提示：`cloudClient` 把底层传输失败统一映射为可读文案 + 机器码 `NETWORK`。
  - §5 矩阵落成 `cloud/H8_RELEASE_CHECKLIST.md`（自动/手动 + 错误提示覆盖 + 失败定位）。构建产物忽略策略补 `.h8-reports/` 与 `desktop/dist`（取消跟踪）。

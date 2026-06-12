# IPM v2.1 云端开发记录 —— Cloud Collaboration · Skill Ecosystem · External Sources

> **目标**：在 IPM v2 本地工作空间与 KnowClaw Agent 工作流基础上，逐步建设 v2.1 云端能力：云端多人协作、轻量版本回溯、企业管理与分发、Skill 市场，以及 NAS / 飞书 / 微盘 / 外部 Agent 生态接入。
>
> **前置**：`desktop/Agent/IPM_V2_1_CLOUD_ARCHITECTURE_PLAN.md` 已完成 v2.1 云端架构蓝图。本文档是实际开发记录与阶段计划，阶段编号从 **C0** 开始。
>
> **约束**：延续 `KNOWCLAW_UPGRADE_PLAN.md` 的开发记录习惯：每阶段首行 `Status:`；阶段末「变更日志」；单阶段尽量保持可独立验证；超纲立刻拆分阶段。

---

## 0. 阅读与维护说明

- 本文档记录 v2.1 云端功能的开发推进情况；架构原则与产品边界以 `desktop/Agent/IPM_V2_1_CLOUD_ARCHITECTURE_PLAN.md` 为准。
- 每完成一轮开发：更新对应阶段 `Status`、填写「变更日志」、刷新 §5 进度看板。
- 阶段编号：**C0-C13**（Cloud）。
- 三条主线：
  1. **Cloud Collaboration**：账号、组织、云端项目、对象存储、manifest、提交/拉取、冲突与恢复。
  2. **IPM Agent Ecosystem**：Skill Registry、Skill 市场、企业 Skill 分发、默认 Skill、版本锁定。
  3. **External Ecosystem**：NAS / 本地共享盘、飞书、企业微信微盘、外部 Agent 记录导入。
- 当前优先级共识：先完成 IPM 自身云端协作与 Skill 生态，再接外部资料源与外部 Agent。

---

## 1. 当前差距客观分析

### 1.1 v2 到 v2.1 的核心差距

| # | 能力 | v2 当前状态 | v2.1 期望终态 |
|---|------|-------------|---------------|
| G1 | 云端账号与组织 | 纯本地应用，无登录体系 | 用户可登录云端组织，拥有团队与 License |
| G2 | 云端项目/案件 | 项目/案件仅在本地 `userfile` | 本地工作区可发布为云端协作项目 |
| G3 | 多人协作 | 本地单人维护 | 多成员显式提交/拉取，同步团队成果 |
| G4 | 文件对象存储 | 文件存本地磁盘 | 云端以 OSS blob + hash 去重存储文件对象 |
| G5 | 版本回溯 | 本地文件系统状态，缺少云端版本 | manifest 快照支持文件恢复和项目历史 |
| G6 | 冲突处理 | 本地无多人冲突 | 同目录同名 hash 不同自动保留双方版本 |
| G7 | 企业管理 | 设置主要由本机用户维护 | 企业可下发策略、成员权限、配额、Skill |
| G8 | Skill 生态 | 本地导入/内置 Skill | 官方市场、企业私有市场、版本与权限声明 |
| G9 | 外部资料源 | 本地附属导入已有雏形 | NAS / 飞书 / 微盘作为外部资料源接入 |
| G10 | 外部 Agent 记录 | 无统一导入入口 | Kimi Code 等记录可导入为知识或归档 |

### 1.2 优先级排序

按「产品闭环优先 × 技术依赖顺序 × 风险控制」排序：

| 优先级 | 差距 | 理由 |
|--------|------|------|
| **P0-基础** | G1 云端账号与组织 | 所有云端能力的身份与权限前置 |
| **P0-基础** | G4 文件对象存储 | 决定存储成本、上传/下载、安全边界 |
| **P0-基础** | G2 云端项目/案件 | 本地工作区发布到云端是协作起点 |
| **P1-核心** | G3 多人协作 | v2.1 最核心用户价值 |
| **P1-核心** | G5 版本回溯 | 防误删/误覆盖，建立云端安全感 |
| **P1-核心** | G6 冲突处理 | 避免多人协作时静默覆盖 |
| **P2-生态** | G8 Skill 市场 | 先完善 IPM 自身 Agent 生态，再接外部生态 |
| **P2-企业** | G7 企业管理 | 企业版管理、分发、策略、配额 |
| **P3-外部** | G9 外部资料源 | NAS/飞书/微盘在核心协作稳定后接入 |
| **P3-外部** | G10 外部 Agent 记录 | 生态迁移能力，可后置 |

---

## 2. 阶段总览

| # | 阶段 | 主要交付物 | 解决差距 | Status |
|---|------|------------|----------|--------|
| C0 | 后端骨架与云端基础设施 | Cloud API 工程、部署、PostgreSQL、OSS、Auth 基础 | G1, G4 | `DONE` |
| C1 | 数据模型：Org / Workspace / Blob / Manifest | 数据库 schema、对象索引、版本 manifest | G1, G2, G4, G5 | `DONE` |
| C2 | Desktop Cloud Binding 与本地扫描 | `meta/cloud.json`、hash 扫描、待提交清单 | G2, G4 | `DONE` |
| C3 | 发布本地项目到云端 | 初始上传、初始 manifest、云端 workspace 创建 | G2, G4 | `DONE` |
| C3.5 | 真实鉴权（Auth） | JWT 注册/登录、邀请码、Per-User 数据隔离、登录 UI | G1 | `DONE` |
| C4 | 成员加入与拉取副本 | 加入/浏览/拉取、小文件下载、大文件占位、CloudProjectsPage | G3 | `DONE` |
| C5 | 显式同步与里程碑版本 | 三方 diff、增量 push/pull、软删除、文件夹保护、Milestone、同步 UI | G3, G5 | `DONE` |
| C6 | 简化冲突与单文件恢复 | 同名冲突副本、版本列表、单文件恢复 | G5, G6 | `DONE` |
| C7 | Skill Registry 与官方市场 | Skill 元数据、包上传、安装/更新、组织市场 UI | G8 | `DONE` |
| C8 | Skill 审核与访问控制 | 提交待审、管理员审核、可见范围、授权安装 | G7, G8 | `DONE` |
| C9 | 企业 AI 配置模板分发 | AI Provider/模型/Search API 配置模板、配置码导入、使用记录 | G7 | `DONE` |
| C10 | NAS / 本地共享盘外部资料源 | 附属文件夹升级、网络路径、WebDAV/S3 适配 | G9 | `PLANNED` |
| C11 | 飞书连接器 | OAuth、云空间目录、选择文件、导入 IPM | G9 | `PLANNED` |
| C12 | 企业微信微盘连接器 | 企业授权、space/file 列表、下载导入 | G9 | `PLANNED` |
| C13 | 外部 Agent 记录导入 | Kimi/Cursor/Claude Code 记录导入为知识/归档 | G10 | `PLANNED` |

> **说明**：C0-C3.5-C6 是 Cloud Core MVP；C7-C9 是 IPM 自身 Agent 生态与企业化；C10-C13 是外部生态连接。

---

## 3. 各阶段详细计划

---

### Phase C0 — 后端骨架与云端基础设施

**Status:** `DONE`（2026-06-03，Fastify + PostgreSQL + OSS client 占位 + Docker Compose 验证）

**目标**：搭建独立云端后端服务，完成最小部署闭环，为后续组织、项目、对象存储与版本服务提供基础。

**前置**：
- 阿里云轻量服务器可用；
- OSS 私有 Bucket 可用；
- 确认 API 域名与 HTTPS 方案。

**设计原则**：

```text
Desktop 负责本地扫描、hash、上传/下载执行
Cloud API 负责身份、权限、对象索引、manifest、签名 URL
OSS 负责文件 blob 与 Skill 包存储
```

**工作清单**

读：
- `desktop/Agent/IPM_V2_1_CLOUD_ARCHITECTURE_PLAN.md`
- 现有 `desktop/package.json` 技术栈与构建方式
- 阿里云 OSS SDK / STS / 签名 URL 文档

写/改：
1. 新建 cloud API 工程骨架。
2. 配置 PostgreSQL。
3. 配置 OSS client。
4. 增加 `/health`。
5. 增加基础 Auth module 占位。
6. 增加 Docker Compose / systemd 部署草案。

**建议目录**

```text
cloud/
  IPM_V2_1_CLOUD_DEVELOPMENT_LOG.md
  server/
    src/
      modules/
        auth/
        orgs/
        workspaces/
        objects/
        versions/
        skills/
      infra/
        db/
        oss/
      main.ts
```

**验证方法**

1. 云端服务可启动。
2. `/health` 返回 ok。
3. 服务端可连接 PostgreSQL。
4. 服务端可对 OSS 生成一次测试上传 URL。

**不做**

- 不做完整登录 UI。
- 不做项目同步。
- 不做 Skill 市场。

**风险**

- R-C0.1：轻量服务器磁盘小，不能存文件本体。
- R-C0.2：OSS 凭证泄露风险，必须使用最小权限 RAM 用户。
- R-C0.3：HTTPS 与域名未准备会阻塞桌面端登录体验。

**变更日志**

- **C0 主体**（2026-06-03）：
  - 新增 `cloud/server` Fastify + TypeScript 工程，包含 `dev` / `build` / `typecheck` / `start` 脚本。
  - 新增 `src/app.ts`、`src/main.ts`，完成服务启动、CORS、Helmet 与优雅退出。
  - 新增 `src/modules/health/routes.ts`，`GET /health` 同时检查 PostgreSQL 与 OSS 配置状态。
  - 新增 `src/modules/auth/routes.ts`，`GET /auth/status` 作为 C0 auth 占位接口。
  - 新增 `src/infra/db/postgres.ts`，使用 `pg.Pool` 连接 PostgreSQL，并提供 `checkDatabase()`。
  - 新增 `src/infra/oss/ossClient.ts`，封装 Aliyun OSS client、bucket 检查与 PUT 签名 URL 占位；OSS 未配置时不阻塞服务启动。
  - 新增 `cloud/docker-compose.yml`，包含 `postgres` 与 `api` 服务；PostgreSQL 使用健康检查，API 通过内部网络连接数据库。
  - 新增 `cloud/server/Dockerfile`、`cloud/server/env.example`、`cloud/deploy/ipm-cloud.service.example`、`cloud/README.md`。
  - 更新根 `.gitignore`，忽略 `node_modules/`、`dist/`、`.env` 等本地/构建产物。
  - 验证通过：`npm run typecheck`、`npm run build`、`docker compose up -d api`、`GET /health` 返回 `ok: true` 且 database ok；OSS 因未配置凭证显示 `configured: false`。

---

### Phase C1 — 数据模型：Org / Workspace / Blob / Manifest

**Status:** `DONE`（2026-06-04，完成 migration、runner、自检脚本、验证通过）

**目标**：确定云端核心数据模型，支撑组织、项目、文件对象、版本快照和权限。

**工作清单**

读：
- `desktop/src/main.js` 中工作区结构与 `ensureProjectStructure`
- `desktop/Agent/db/init.js` 中本地 SQLite 表结构
- `desktop/Agent/IPM_V2_1_CLOUD_ARCHITECTURE_PLAN.md` §4-§7

写/改：
1. 用户 / 组织 / 成员表。
2. workspace 表。
3. blob object 表。
4. manifest version 表。
5. manifest entries 表。
6. workspace members 表。
7. migration 脚本。

**核心表草案**

```text
users
orgs
org_members
workspaces
workspace_members
objects
versions
version_entries
events
```

**关键约束**

- 文件对象以 `sha256` 去重。
- version 只保存 manifest，不复制文件。
- workspace 权限先支持 owner / editor / viewer。

**验证方法**

1. migration 可重复执行。✅
2. 可创建 org、user、workspace。✅
3. 可登记 object hash。✅
4. 可创建一版 manifest。✅

**不做**

- 不做复杂分支。
- 不做文件内部 diff。
- 不做 AI 对话记录上云。

**变更日志**

- **C1 主体**（2026-06-04）：
  - 新增 `src/infra/db/migrations/0001_init.sql`：C1 完整 DDL，包含 9 张核心表（`users`、`orgs`、`org_members`、`workspaces`、`workspace_members`、`objects`、`versions`、`version_entries`、`events`），以及完整索引、CHECK 约束和循环引用 FK（先建 workspaces 再补 `current_version_id` FK）。
  - 新增 `src/infra/db/migrate.ts`：基于 `schema_migrations` 跟踪表的轻量 migration runner，支持幂等执行、事务包裹和报告。
  - 新增 `src/infra/db/migrate-cli.ts`：CLI 入口，用于 `npm run db:migrate`。
  - 新增 `src/infra/db/self-check.ts`：在单次事务中插入最小完整链路（user → org → workspace → object → version → entry → event），查询 manifest，验证后 ROLLBACK，不留数据。
  - 新增 `src/infra/db/self-check-cli.ts`：CLI 入口，用于 `npm run db:check`。
  - 新增 `scripts/copy-migrations.mjs`：build 后将 `.sql` 文件复制到 `dist/`，生产部署可直接使用。
  - 修改 `package.json`：新增 `db:migrate`、`db:migrate:prod`、`db:check` 脚本；`build` 脚本追加 copy-migrations。
  - 修改 `src/infra/db/postgres.ts`：`checkDatabase()` 额外返回 `migrationCount` 和 `latestMigration`。
  - 验证通过：
    1. `npm run typecheck` —— 0 errors。
    2. `npm run build` + `copy-migrations` —— 成功。
    3. `npm run db:migrate` —— 首次应用 `0001_init.sql`。
    4. 重复 `npm run db:migrate` —— 无新 migration，幂等安全。
    5. `npm run db:check` —— 自检通过，完整链路 user→org→workspace→object→version→entry→event 正确创建、manifest 查询正常返回文件树、事务 ROLLBACK 无残留。
    6. `GET /health` 返回 `database.ok: true, migrationCount: 1, latestMigration: "0001_init.sql"`。

---

### Phase C2 — Desktop Cloud Binding 与本地扫描

**Status:** `DONE`（2026-06-05，cloud 模块 + IPC + 离线扫描验证通过）

**目标**：让 Desktop 能识别一个本地工作区是否绑定云端，并能扫描本地文件生成 hash 清单。

**工作清单**

读：
- `desktop/src/main.js`：工作区根路径与 domain 归一化
- `desktop/src/main/ipc/projects.js`
- `desktop/src/main/ipc/cases.js`
- `desktop/src/main/ipc/explorer.js`
- `desktop/Agent/db/index.js`

写/改：
1. 新增本地 cloud binding 文件：`meta/cloud.json`。
2. 新增 cloud client 基础模块。
3. 新增 workspace scanner。
4. 新增 hash calculator。
5. 新增待提交清单结构。

**`meta/cloud.json` 草案**

```json
{
  "cloudWorkspaceId": "cw_xxx",
  "orgId": "org_xxx",
  "lastSyncedVersionId": "ver_xxx",
  "syncMode": "manual",
  "createdAt": "2026-06-03T00:00:00.000Z"
}
```

**验证方法**

1. 未绑定项目：`cloud/getBindingStatus` 返回 `{ bound: false }`。✅
2. 写入 cloud.json 后：返回 `{ bound: true, binding: {...} }`。✅
3. 扫描本地项目可得到路径、大小、mtime、sha256。✅

**不做**

- 不上传文件。
- 不生成云端版本。
- 不写入 cloud.json（C3 发布成功后才写，本阶段只实现并验证读写函数）。
- 不调用云端 API、不处理登录（全程离线）。
- 不支持附属壳项目；不做增量扫描（C5 再加）。

**变更日志**

- **C2 主体**（2026-06-05）：
  - 新增 `desktop/src/main/cloud/cloudBinding.js`：读写 `meta/cloud.json`，提供 `readCloudBinding` / `writeCloudBinding`（原子写 + 字段合并 + `features`/`extra` 容器）/ `removeCloudBinding` / `getBindingStatus`。绑定判据为存在非空 `cloudWorkspaceId`。
  - 新增 `desktop/src/main/cloud/workspaceScanner.js`：递归扫描工作区，流式 SHA-256 计算（`crypto.createHash` + `createReadStream`，大文件不入内存）；顶层排除 `meta`/`temp`/`snippets`，全层排除 `.DS_Store`/`Thumbs.db`/`desktop.ini`；产出按 path 排序的 `ScanResult`（entries + stats）；提供 `onProgress` 回调与 `inferMimeType` 扩展名映射。
  - 新增 `desktop/src/main/cloud/cloudClient.js`：HTTP client 骨架（baseURL / 懒加载 token / get/post/put/delete），`request()` 在 C2 故意抛错，C3 落地实际网络逻辑。
  - 新增 `desktop/src/main/ipc/cloud.js`：`registerCloudIpc({ ipcMain, getWorkspaceDirOrThrow })`，实现 `cloud/getBindingStatus`、`cloud/scanWorkspace`，并在扫描时通过 `cloud:scanProgress` 推送节流（120ms）进度。
  - 修改 `desktop/src/main.js`：import 并在 `registerOcrIpc` 之后调用 `registerCloudIpc`（注入 `getWorkspaceDirOrThrow`，统一走 domain 归一化 + 路径校验）。
  - 修改 `desktop/src/preload.js`：`window.ipm` 新增 `cloud` 命名空间（`getBindingStatus` / `scanWorkspace` / `onScanProgress`）。
  - `meta/cloud.json` schema 较草案增强：新增 `schemaVersion`、`orgSlug`/`orgName`、`domain`、`lastSyncedVersionNumber`、`boundBy`、`sourceType`、`features`、`extra`，为后续外部路径上云等功能预留扩展位。
  - 验证通过（临时 Node 脚本对 fixture 工作区执行 6 组断言，运行后删除）：
    1. 未绑定状态正确。
    2. 扫描排除 `meta`/`temp`/`snippets` 及 OS 垃圾文件；3 个业务文件 + 3 个文件夹正确收录；文件含 64 位 hex sha256、size、mtimeMs、mimeType；文件夹字段为 null。
    3. SHA-256 与 `crypto` 参考值逐字节一致。
    4. 写入/读取绑定、字段合并保留、解绑幂等均通过。
    5. MIME 推断大小写不敏感、未知扩展名返回 null。
    6. 所有新增/修改文件 0 lint error。

---

### Phase C3 — 发布本地项目到云端

**Status:** `DONE`

**目标**：用户可将本地项目/案件发布成云端 workspace，形成初始版本。

**工作清单**

写/改：
1. Desktop 发布入口。
2. Cloud API：创建 workspace。
3. Cloud API：批量查询 hash 是否已存在。
4. Cloud API：生成 OSS 上传 URL。
5. Desktop：上传缺失 blob。
6. Cloud API：提交初始 manifest。
7. Desktop：写入 `meta/cloud.json`。

**验证方法**

1. 本地案件可发布到云端。
2. OSS 中存在对应 blob。
3. 云端 version 记录可列出全部路径。
4. Desktop 显示“已绑定云端项目”。

**不做**

- 不邀请成员。
- 不处理冲突。
- 不做真正的 Auth（沿用 Dev Token：`X-Dev-User-Id`），JWT 登录留到 C3-C4 之间。
- 不做上传并发 / 断点续传（串行上传，后续优化）。

**变更日志**

- **DONE**（本次）：打通「桌面端 → Cloud API → OSS」完整发布链路。

  **Cloud Server：**
  - 新增 `src/config/devConstants.ts`：固定的 dev 用户/组织 UUID（与 seed 一致）。
  - 新增 `src/middleware/devAuth.ts`：从 `X-Dev-User-Id` 头注入 `request.userId`，`/health`、`/`、`/auth/*` 为公开路径；生产环境直接 501（强制后续替换为真实鉴权）。
  - 新增 `src/infra/db/seed.ts` + `seed-cli.ts`：幂等写入 dev 用户 + dev 组织 + owner 成员；`package.json` 增加 `db:seed`。
  - 新增 `src/modules/workspaces/routes.ts`：`POST /api/workspaces`（建 workspace + owner 成员 + event）、`GET /api/workspaces/:id`（含成员校验）。
  - 新增 `src/modules/objects/routes.ts`：`POST /api/objects/check`（查已 available 的 sha256）、`POST /api/objects/upload-urls`（预注册 pending object + 生成签名 PUT URL，storage_key=`blobs/sha256/{前2位}/{完整hash}.bin`）、`POST /api/objects/confirm`（pending→available）。
  - 新增 `src/modules/versions/routes.ts`：`POST /api/workspaces/:id/versions`，单事务内校验所有 file entry 的 object 已 available（缺失返回 409）、版本号自增、写 version + entries + 更新 current_version_id + event。
  - `app.ts` 注册 devAuth（preHandler）与三组路由。
  - **修复 OSS 签名 Bug**：`getSignedPutUrl` 之前未把 `Content-Type` 纳入签名，而客户端 PUT 时携带 `application/octet-stream`，导致 `SignatureDoesNotMatch`（403）。现在签名时显式带上 `BLOB_UPLOAD_CONTENT_TYPE='application/octet-stream'`，客户端按相同 Content-Type 上传。

  **Desktop 主进程：**
  - 新增 `src/main/cloud/devConfig.js`：临时 dev 配置（baseURL + devUserId/Org，支持环境变量覆盖）。
  - 实现 `src/main/cloud/cloudClient.js` 的 `request()`：原生 `fetch` + `X-Dev-User-Id` 头 + JSON 序列化 + AbortController 超时 + 非 2xx 抛出含 status/body 的错误；新增 `createDevCloudClient()`。
  - 新增 `src/main/cloud/publishLock.js`：内存锁（`lock/unlock/isWorkspaceLocked/assertNotLocked/getLockedWorkspaces`），路径前缀匹配以覆盖子路径与 KnowClaw cwd。
  - 新增 `src/main/cloud/publishWorkspace.js`：6 步编排器（scan→createWorkspace→check→串行上传→confirm→commitVersion→写 cloud.json），按 sha256 去重上传，任何一步失败在 `finally` 解锁；通过 `onProgress` 上报每步状态。
  - 新增 `src/main/cloud/publishLockGuard.js`：用 Proxy 包装 `ipcMain.handle`，对 13 个写通道（explorer×6 / projects 删改 / cases 删改 / aiStorage×2 / floating）在锁定时抛 `WorkspaceLockedError`。
  - `ipc/cloud.js` 扩展：`cloud/publish`、`cloud/cancelPublish`、`cloud/getLockedWorkspaces` + `cloud:publishProgress` 推送（含取消 flag）。
  - `main.js`：创建 `guardedIpcMain` 并注入到 explorer/projects/cases/aiStorage/floating 五个写模块；向 `registerKnowClawIpc` 注入 `isWorkspaceLocked`。
  - `ipc/knowclaw.js`：`knowclaw:send` 与 `knowclaw:uploadToWorkspace` 入口按 `ch.cwd` 检查锁定，命中时返回统一的 `WORKSPACE_LOCKED` 响应。
  - `preload.js`：`cloud` 命名空间新增 `publish/cancelPublish/getLockedWorkspaces/onPublishProgress`。

  **Desktop UI（Linear 风格）：**
  - 新增 `hooks/useCloudPublish.jsx`：`CloudPublishProvider` 全局管理发布生命周期（按 `${domain}:${projectName}` 建活动），单一订阅 `cloud:publishProgress`，最小化后仍持续；渲染全局 `PublishModal`。
  - 新增 `components/project-manager/PublishModal.jsx`：两阶段（预览：云端名/描述/提交说明 + 可折叠文件树 + 统计；进度：5 步指示器 + 上传进度 + 出错重试 + 最小化/取消）。
  - 新增 `components/CloudActivityPanel.jsx`：侧边栏底部活动条（发布中/失败/完成，含进度条，点击重开弹窗），无活动时隐藏；嵌入 `Sidebar.jsx`。
  - `App.jsx` 挂载 `CloudPublishProvider`（发布成功回调刷新工作区统计）。
  - `ProjectManager.jsx`：拉取各项目绑定状态、派生「发布中/已绑定」名单，接入右键菜单发布入口、HeaderBar 发布按钮、RootTable 云端状态标识；菜单项支持 `disabled`。
  - `hooks/useContextMenu.js`：根级右键菜单按状态追加「发布到云端 / 正在发布… / 已绑定云端」。
  - `RootTable.jsx` / `HeaderBar.jsx`：项目名旁与工具栏显示云图标（发布中转圈 / 已绑定显示版本号）。

  **验证：**
  - Cloud Server `tsc --noEmit` + `build` 通过；`db:migrate`（幂等）+ `db:seed` 成功。
  - API 集成测试（PowerShell）：createWorkspace / check / upload-urls / confirm / commitVersion 全通过，含 401（缺头）与 409（引用未上传 hash）边界。
  - Desktop 端到端冒烟（Node ESM，脱离 Electron）：publishLock 前缀匹配、lockGuard 拦截、cloudClient → 实服务建 workspace、OSS 签名 PUT 成功、`publishWorkspace` 完整跑通（v1 + 写 `cloud.json` + 发布后解锁）。共 5 项断言通过。

---

### Phase C3.5 — 真实鉴权（Auth）

**Status:** `DONE`（2026-06-07，JWT 鉴权 + 邀请码注册 + Per-User 数据隔离 + 登录 UI）

**目标**：替换 C3 的 `X-Dev-User-Id` 临时鉴权，实现真实的用户注册/登录/令牌管理，并在桌面端建立 Per-User 本地数据隔离，为 C4 多人协作提供身份基础。

**工作清单**

写/改：
1. 数据库迁移 `0002_auth.sql`：`invite_codes`、`refresh_tokens` 表，`users.password_hash` 列。
2. 环境变量扩展：`JWT_SECRET`、`JWT_REFRESH_SECRET`、`JWT_ACCESS_EXPIRES`、`JWT_REFRESH_EXPIRES`。
3. Auth 模块实现：`POST /api/auth/register`（邀请码校验）、`POST /api/auth/login`、`POST /api/auth/refresh`（token rotation）、`POST /api/auth/logout`、`GET /api/auth/me`。
4. 中间件改造：`devAuth.ts` → `auth.ts`（JWT Bearer 优先，dev 环境保留 `X-Dev-User-Id` 兼容）。
5. 邀请码 CLI：`npm run invite:create -- --org <orgId>`。
6. Desktop Per-User 数据目录重构：`userScope.js`（`users/{userId}/` + `_offline/` + legacy 迁移）。
7. Token 存储：`authStore.js`（`safeStorage` 加密 + access token 自动 refresh）。
8. Auth IPC：`auth/getStatus`、`auth/register`、`auth/login`、`auth/logout`、`auth/useOffline`、`auth/switchUser`。
9. CloudClient 改造：新增 `createAuthCloudClient()`（注入 JWT + 自动 refresh）。
10. 登录 UI：`LoginPage.jsx`（深色 Linear 风格，登录/注册 Tab + 离线入口）。
11. App.jsx 集成：auth 状态判断，未选择时显示 LoginPage。
12. Sidebar 账号控制：显示当前用户/切换账号/退出登录/离线模式下的"登录"入口。

**关键设计决策**

| 决策 | 选择 |
|------|------|
| 鉴权方案 | 邀请码 + 邮箱密码注册，JWT 双 token（access 2h + refresh 30d） |
| 密码存储 | bcryptjs（纯 JS，避免原生编译） |
| Token 桌面存储 | Electron `safeStorage` 加密，无 keystore 时明文 fallback |
| 本地数据隔离 | Per-User 目录（`users/{userId}/`），离线数据在 `_offline/` |
| 账号切换 | 开发模式 `webContents.reload()`，打包后 `app.relaunch()` |
| 迁移策略 | 首次升级自动将旧数据移入 `_offline/`，不可逆 |
| 单/多 org | C4 阶段只支持单 org |

**验证方法**

1. 注册：邀请码有效 → 201；无效/过期/超限 → 400。✅
2. 登录：正确密码 → 200 + token pair；错误密码 → 401。✅
3. `/me`：Bearer token → 当前用户；无 token → 401。✅
4. Refresh：有效 refresh token → 新 token pair（rotation）；已吊销 → 401。✅
5. 两个用户注册后身份隔离：各自 `/me` 返回正确身份。✅
6. Dev 兼容：`X-Dev-User-Id` 在非生产环境仍有效。✅
7. Desktop 构建验证：renderer vite build + main esbuild parse 通过。✅
8. 桌面端登录→reload→进入主界面（开发模式验证通过）。✅

**变更日志**

- **C3.5 主体**（2026-06-07）：
  - 新增 `cloud/server/src/infra/db/migrations/0002_auth.sql`：`invite_codes` 表（含 `role`/`max_uses`/`used_count`/`expires_at`）、`refresh_tokens` 表（token hash + revoked_at + expires_at）、`users.password_hash` 列。
  - 修改 `cloud/server/src/config/env.ts`：新增 `JWT_SECRET`/`JWT_REFRESH_SECRET`/`JWT_ACCESS_EXPIRES`/`JWT_REFRESH_EXPIRES`，开发默认值 + 生产环境强制校验。
  - 修改 `cloud/server/package.json`：新增 `bcryptjs`（密码哈希）、`jsonwebtoken`（JWT 签发/验证）、`@types/jsonwebtoken`（dev）、`invite:create` 脚本。
  - 新增 `cloud/server/src/modules/auth/tokens.ts`：`signAccessToken`/`verifyAccessToken`/`issueRefreshToken`/`lookupRefreshToken`/`revokeRefreshToken`，refresh token 以 SHA-256 哈希后存入数据库。
  - 新增 `cloud/server/src/modules/auth/routes.ts`：替换 C0 占位，实现完整 register（邀请码锁行 + 校验 + bcrypt + 创建用户 + 加入 org + event）/ login / refresh（rotation）/ logout / me。
  - 新增 `cloud/server/src/modules/auth/invite-cli.ts`：生成 `IPM-XXXX-XXXX` 格式邀请码，支持 `--org`/`--role`/`--max-uses`/`--expires-days` 参数。
  - 新增 `cloud/server/src/middleware/auth.ts`：替换 `devAuth.ts`，优先 Bearer JWT → 非生产环境 fallback `X-Dev-User-Id` → 401。
  - 删除 `cloud/server/src/middleware/devAuth.ts`。
  - 新增 `desktop/src/main/cloud/userScope.js`：Per-User 数据目录管理（`initUserScope`/`getActiveUserRoot`/`setCurrentUser`/`setOffline`/`clearCurrentUser`/`needsAuthChoice`），含 legacy → `_offline/` 一次性迁移。
  - 新增 `desktop/src/main/cloud/authStore.js`：`saveTokens`/`loadTokens`/`clearTokens`/`getAccessToken`/`getActiveAccessToken`，使用 `safeStorage` 加密，过期自动 refresh。
  - 新增 `desktop/src/main/ipc/auth.js`：`registerAuthIpc`，6 个 IPC channel（getStatus/register/login/logout/useOffline/switchUser），登录成功后开发模式 `webContents.reload()`、打包后 `app.relaunch()`。
  - 修改 `desktop/src/main/cloud/cloudClient.js`：新增 `createAuthCloudClient()`，注入 `getActiveAccessToken` 作为 `getToken`。
  - 修改 `desktop/src/main.js`：import `userScope`，启动时 `initUserScope(getBaseFileRoot)`，`getUserFileRoot()` 改为动态读 `userScope.getActiveUserRoot()`，注册 `registerAuthIpc` 并注入 `getMainWindow`/`refreshEnv`。
  - 修改 `desktop/src/preload.js`：新增 `window.ipm.auth` 命名空间（getStatus/register/login/logout/useOffline/switchUser）。
  - 新增 `desktop/src/ui/components/auth/LoginPage.jsx`：全屏深色 Linear 风格登录/注册页，含邀请码/邮箱/密码/昵称表单 + 错误提示 + "离线使用"入口。
  - 修改 `desktop/src/ui/App.jsx`：auth 状态判断（`needsAuth` 时显示 LoginPage），`onOfflineChosen` 直接切换到离线模式。
  - 修改 `desktop/src/ui/components/Sidebar.jsx`：用户区改为可交互的账号菜单（显示云端账号名/邮箱 或 "离线模式"，支持切换账号/退出登录/从离线进入登录）。

---

### Phase C4 — 成员加入与拉取副本

**Status:** `DONE`（2026-06-07，workspace 浏览/加入/拉取 + 50MB 阈值占位 + CloudProjectsPage + 端到端验证通过）

**目标**：第二个成员可加入云端项目，并在本地生成工作副本。

**前置**：C3.5 Auth 完成（JWT 鉴权 + Per-User 数据隔离）。

**工作清单**

写/改：
1. Cloud API：`GET /api/workspaces`（org 内列表 + 我的角色 + 成员数）。
2. Cloud API：`POST /api/workspaces/:id/join`（同 org 成员直接加入，editor 角色，幂等）。
3. Cloud API：`GET /api/workspaces/:id/versions/latest`（最新版本清单 + entries）。
4. Cloud API：`POST /api/objects/download-urls`（签名 GET URL 用于下载 blob）。
5. OSS client：`getSignedGetUrl`（签名 GET URL 生成）。
6. Desktop：`pullWorkspace.js` 拉取编排器（获取清单 → 建目录 → 下载小文件 → 占位大文件 → 写 `cloud.json`）。
7. Desktop：`downloadOnDemand.js`（读取 `.ipmcloud` 占位 → 获取下载 URL → 流式写文件 → 删占位）。
8. Desktop：`createLocalCloudProject`（自动创建 blank 模板本地项目 + 名称去重 + 注册 state）。
9. Desktop IPC：`cloud/listWorkspaces`、`cloud/joinWorkspace`、`cloud/pull`、`cloud/cancelPull`、`cloud/downloadFile` + `cloud:pullProgress` 推送。
10. Desktop preload：`window.ipm.cloud` 新增 `listWorkspaces/joinWorkspace/pull/cancelPull/downloadFile/onPullProgress`。
11. UI：`CloudProjectsPage.jsx`（云端项目列表、加入/拉取/打开按钮、拉取进度条）。
12. UI：Sidebar 新增「协作项目」导航项（仅登录用户可见）。

**下载策略**

| 文件大小 | 行为 |
|----------|------|
| ≤ 50 MB | 拉取时立即下载到本地 |
| > 50 MB | 生成 `.ipmcloud` 占位文件（记录 sha256/sizeBytes/mimeType/originalName），按需下载 |

**占位文件格式**

```json
{
  "kind": "ipm-cloud-placeholder",
  "schemaVersion": 1,
  "sha256": "abc123...",
  "sizeBytes": 123456789,
  "mimeType": "application/pdf",
  "originalName": "大型报告.pdf",
  "path": "/收到资料/大型报告.pdf"
}
```

**验证方法**

1. 用户 B 注册后可看到用户 A 发布的所有 org 内项目。✅
2. 用户 B 可加入项目（幂等，重复加入不报错）。✅
3. 用户 B 可获取最新版本清单（entries 含 path/sha256/sizeBytes）。✅
4. 下载签名 URL 有效（HTTP 200 + 正确文件内容）。✅
5. `pullWorkspace` 端到端：15 个文件中 9 个立即下载、6 个生成占位，5 个文件夹正确创建，`cloud.json` 写入且 `pulledCopy: true`。✅
6. `downloadPlaceholder` 端到端：占位文件解析 → 获取下载 URL → 下载真实文件 → 删除占位。✅
7. Renderer vite build 通过，CloudProjectsPage 字符串在 bundle 中。✅
8. 桌面端实际启动测试：登录 → 协作项目列表 → 加入 → 拉取。✅

**不做**

- 不做增量同步（拉取更新留给 C5）。
- 不做冲突检测（C6）。
- 不做成员管理 UI（C9）。
- 不做完善的占位文件浏览器 UI（后续优化）。

**变更日志**

- **C4 主体**（2026-06-07）：
  - 修改 `cloud/server/src/modules/workspaces/routes.ts`：新增 `GET /api/workspaces`（org 内列表，含 `memberCount`/`myRole`/`currentVersionNumber`，按 `updated_at DESC` 排序）、`POST /api/workspaces/:id/join`（org 校验 + 幂等 + event 记录）、`GET /api/workspaces/:id/versions/latest`（成员校验 + 最新 version entries + objects sha256 join）。
  - 修改 `cloud/server/src/modules/objects/routes.ts`：新增 `POST /api/objects/download-urls`（批量 sha256 → 签名 GET URL，15min 有效，返回 missing 列表）。
  - 修改 `cloud/server/src/infra/oss/ossClient.ts`：新增 `getSignedGetUrl(objectKey, expiresSeconds)`。
  - 新增 `desktop/src/main/cloud/pullWorkspace.js`：拉取编排器（fetchManifest → createFolders → partitionByThreshold → downloadSmallFiles → placeholderLargeFiles → writeCloudBinding），支持 `shouldCancel`/`onProgress`，默认阈值 50MB。
  - 新增 `desktop/src/main/cloud/downloadOnDemand.js`：`downloadPlaceholder`（读 `.ipmcloud` → `POST /api/objects/download-urls` → 流式下载到临时文件 → rename → 删占位）；`isPlaceholderPath`/`readPlaceholder` 辅助函数。
  - 修改 `desktop/src/main/ipc/cloud.js`：新增 `cloud/listWorkspaces`/`cloud/joinWorkspace`/`cloud/pull`/`cloud/cancelPull`/`cloud/downloadFile` 5 个 IPC handler；pull 流程先 join（幂等）→ `createLocalCloudProject`（blank 模板 + 名称去重）→ `pullWorkspace` 编排；离线模式下所有云端操作返回 `OFFLINE` 错误码。
  - 修改 `desktop/src/main.js`：新增 `createLocalCloudProject`（`sanitizeProjectName` + 去重 + `ensureProjectStructure(blank)` + `syncStructureJson` + 注册 state status），传入 `registerCloudIpc`。
  - 修改 `desktop/src/preload.js`：`window.ipm.cloud` 新增 `listWorkspaces`/`joinWorkspace`/`pull`/`cancelPull`/`downloadFile`/`onPullProgress`。
  - 新增 `desktop/src/ui/components/cloud-projects/CloudProjectsPage.jsx`：Linear 风格云端项目列表页（加载/空/错误状态），每个 workspace 卡片显示名称/domain 标签/版本号/成员数/我的角色，操作按钮按状态切换（未加入→加入 / 已加入→拉取副本 / 已拉取→打开本地副本），拉取时显示进度条（step label + 百分比）。
  - 修改 `desktop/src/ui/App.jsx`：import `CloudProjectsPage`，`displayNav === 'cloud-projects'` 路由分支，`fadeEligible` 新增 `'cloud-projects'`。
  - 修改 `desktop/src/ui/components/Sidebar.jsx`：新增 `Cloud` icon import，登录状态下显示「协作项目」导航项（`nav='cloud-projects'`）。

  **Bug 修复记录**（2026-06-07）：

  | # | 现象 | 原因 | 修复 | 涉及文件 |
  |---|------|------|------|----------|
  | B1 | 登录成功后桌面端白屏，terminal 进程退出 | 开发模式下 `app.relaunch()` + `app.exit(0)` 杀死了 `electron-forge start` 管理的进程，forge 不知道如何重启裸 Electron binary | `!app.isPackaged` 时改用 `webContents.reload()` 软重启；打包后仍走 `app.relaunch()` | `desktop/src/main/ipc/auth.js` |
  | B2 | 首次启动时 legacy 迁移报 `ENOTEMPTY: directory not empty, rmdir '_app/sandbox/skills'` | `fs.renameSync` 对已有同名目标目录失败，`_app/sandbox/skills` 被其他模块占用无法删除 | 逐目录检查 dest 是否已存在（跳过）；rename 失败 fallback 到 `cpSync` + 静默忽略 `rmSync` 失败 | `desktop/src/main/cloud/userScope.js` |
  | B3 | PowerShell 测试 `POST /api/workspaces/:id/join` 返回 415 Unsupported Media Type | Fastify 对无 body + 无 `Content-Type` 的 POST 请求返回 415 | 测试时显式添加 `-ContentType 'application/json' -Body '{}'`；后端路由无需修改 | 测试脚本 |
  | B4 | esbuild parse-check 报告 `auth.js` 和 `cloud.js` 出现 "PARSE_ERROR" | 检测脚本用 regex 匹配 `error:` 字符串，命中了转译后代码中的合法字面量（如 `console.error:` 输出） | 确认为误报（esbuild exit code 0），调整检测逻辑；实际模块无语法错误 | 检测脚本 |
  | B5 | `npx vite build --config vite.main.config.mjs` 产出 153 字节的空壳 `main.js` | `vite.main.config.mjs` 没有显式 `build.lib.entry`，entry 由 `electron-forge` 运行时动态注入，独立执行 vite build 时找不到入口 | 改用 esbuild 直接 parse-check 单个主进程模块验证语法；renderer build 正常走 `vite build`（从 `index.html` 入口） | 验证方式调整 |

  **用户反馈与待解决问题**（2026-06-07）：

  | # | 类型 | 内容 | 状态 |
  |---|------|------|------|
  | F1 | UI/UX | 当前 `CloudProjectsPage` 仅为简陋的列表页（用于验证 API pipeline），云端项目的创建/加入/管理/成员权限等完整 UI 尚未设计 | 留待后续阶段（建议 C5 或独立 UI 设计阶段）|
  | F2 | 功能缺失 | 已拉取的协作项目在「我的数据」中没有云端绑定状态标识（如云图标、版本号） | `已解决`（C5：SyncStatusBar 显示绑定/版本/同步状态；HeaderBar 已有云图标）|
  | F3 | 功能缺失 | 文件浏览器中 `.ipmcloud` 占位文件没有特殊 UI（应显示云下载图标 + 文件大小 + 点击触发下载） | 留待后续（C5 已在 diff/状态层正确折叠占位为「未改动」，文件浏览器图标化未做）|
  | F4 | 功能缺失 | 发布后的增量更新（push 新版本）和拉取更新（pull latest）流程尚未实现 | `已解决`（C5 核心：pushSync + pullUpdate 全链路）|
  | F5 | 功能缺失 | 云端项目成员管理 UI（角色显示/邀请/移除/权限控制） | 后续 Workspace 治理阶段 |

---

### Phase C5 — 显式同步与里程碑版本

**Status:** `DONE`（2026-06-08，文件级增量 push/pull + 软删除 + 文件夹保护 + Milestone + 24 项端到端验证通过）

**目标**：完成多人协作的同步闭环：在现有文件夹结构下增量推/拉文件，软删除标记，管理者里程碑版本。

**协作模型（非 git）**：
- **日常同步 ≠ 版本**：每次提交仍创建 `versions` 行（便于 diff/回溯），但只有 `type='milestone'` 对用户可见；`type='sync'` 是高频默认。
- **冲突仅在「同路径文件双方都改了」**：文件夹下增减文件不算冲突。
- **删除是软标记**：删除文件变成 `status='soft_deleted'`（OSS blob 保留），不物理删除。
- **文件夹结构 owner 保护**：仅 owner 可改 canonical 文件夹集；非 owner 落在新文件夹的文件被「忽略」不推送。
- **半自动 + 全量**：进入项目扫描检测变更并提示；用户确认后全部变更一起同步。

**三方 diff**：`base`（`meta/cloud-baseline.json`，上次同步状态）vs `local`（实时扫描）vs `cloud`（最新版本）。`base↔local` 得本地变更，`base↔cloud` 得云端变更，双方都改同一路径即冲突。

**验证方法**

1. A 发布 → B 拉取副本。✅
2. B 增/改/删 → pushSync 提交 v2。✅
3. A pullUpdate 合并 B 的变更，软删除文件本地保留并打 tag。✅
4. 管理者提升 milestone，版本列表可见。✅
5. 基线落后时 push 被 `REMOTE_AHEAD` 拒绝；冲突文件检测且本地不被覆盖。✅

**不做（留待 C6）**

- 冲突解决 UI（C5 仅检测 + 提示 + 不覆盖）。
- 单文件 / 整体版本回溯。
- 文件夹结构变更审核流（非 owner 直接忽略）。
- 不自动后台实时同步；不做文件内部 diff。

**变更日志**

- **C5 主体**（2026-06-08）：

  **Cloud Server：**
  - 新增 `src/infra/db/migrations/0003_sync.sql`：`versions` 加 `type`（sync/milestone）+ `label`；`version_entries` 加 `status`（active/soft_deleted）+ `deleted_by` + `deleted_at`；新建 `workspace_folders`（owner 保护的 canonical 文件夹集）。
  - 修改 `src/modules/versions/routes.ts`：commit 接受 `type`/`label`/`baseVersionId`，entry 接受 `status`/`deletedAt`；提交时锁 workspace 行做 `baseVersionId` 乐观并发校验（不匹配返回 409 `REMOTE_AHEAD`）；`milestone` 类型要求 owner；新增 `GET /versions`（列版本，`?type=milestone` 筛选）、`POST /versions/:vid/promote`（owner 提升里程碑）。
  - 修改 `src/modules/workspaces/routes.ts`：`/versions/latest` 返回 entry 的 `status`/`deletedBy`/`deletedByName`/`deletedAt` 及 version 的 `type`/`label`；新增 `GET /sync-status`（轻量版本号比对）、`GET /folders`（成员读 canonical 文件夹）、`POST /folders`（owner 全量替换文件夹集）。

  **Desktop 主进程：**
  - 新增 `src/main/cloud/cloudConstants.js`：抽出 `PLACEHOLDER_SUFFIX` / `DEFAULT_LARGE_FILE_THRESHOLD`，打破 syncEngine ↔ pullWorkspace 的循环依赖。
  - 新增 `src/main/cloud/cloudBaseline.js`：`meta/cloud-baseline.json` 读写（diff 基线），`readBaseline`/`writeBaseline`/`baselineFileMap`。
  - 新增 `src/main/cloud/syncEngine.js`：纯函数 `computeSyncPlan`（无 I/O），三方 diff，输出 `toPush`/`toPull`/`conflicts`/`ignored`/`summary`；折叠 `.ipmcloud` 占位为「未改动」；文件夹保护按角色分流。
  - 新增 `src/main/cloud/pushSync.js`：`computeWorkspaceSyncPlan`（预览）+ `pushSync`（scan→diff→`REMOTE_AHEAD`/冲突守卫→上传新增/修改 blob→提交 merged manifest 为 sync 版本→重写 binding+baseline，owner 刷新 folders）。
  - 修改 `src/main/cloud/pullWorkspace.js`：拉取跳过 soft_deleted；写初始 baseline；新增 `pullUpdate`（增量拉取：下载新增/修改、>50MB 占位、建新文件夹、远端软删除写入 `cloud.json.extra.remoteDeleted` 且保留本地文件、推进 baseline）。
  - 新增 `src/main/cloud/syncStatus.js`：`checkLocalChanges`（无哈希 mtime/size 初筛）+ `checkRemoteChanges`（版本号比对）+ `getSyncSummary`。
  - 修改 `src/main/cloud/publishWorkspace.js`：发布后写 `cloud-baseline.json` + `POST /folders` 初始化 canonical 文件夹（owner）。
  - 修改 `src/main/ipc/cloud.js`：新增 `cloud/getSyncStatus`、`cloud/computeSyncPlan`、`cloud/pushSync`、`cloud/pullUpdate`、`cloud/cancelSync`、`cloud/createMilestone`、`cloud/listVersions` + `cloud:syncProgress` 推送；离线模式统一 `OFFLINE`。
  - 修改 `src/preload.js`：`cloud` 命名空间新增上述 7 个方法 + `onSyncProgress`。

  **Desktop UI（Linear 风格）：**
  - 新增 `components/cloud-projects/SyncStatusBar.jsx`：绑定项目顶部条，轮询同步状态，显示「N 个本地变更待同步 / 云端有更新 / 已同步」，驱动同步、拉取更新、发布版本（owner）。
  - 新增 `components/cloud-projects/SyncPreviewModal.jsx`：push 预览弹窗（新增/修改/标记删除/被忽略分组 + 冲突红色提示 + `REMOTE_AHEAD` 提示 + 同步说明 + 进度）。
  - 新增 `components/cloud-projects/MilestoneModal.jsx`：owner 里程碑命名弹窗。
  - 修改 `components/ProjectManager.jsx`：HeaderBar 下挂载 `SyncStatusBar`（绑定的标准项目）。
  - 修改 `components/cloud-projects/CloudProjectsPage.jsx`：每个项目卡片增加「版本」按钮，展开 milestone 历史（`listVersions?type=milestone`）。

  **验证：**
  - Cloud Server `tsc --noEmit` 通过；`db:migrate` 应用 `0003_sync.sql`（migrationCount=3）；`/health` OSS+DB ok。
  - syncEngine 纯函数单测：14 项断言（push/pull 拆分、both_modified 冲突、owner/editor 文件夹保护、远端软删除、占位等于未改动）全通过。
  - 端到端（Node ESM，真实后端 + OSS）：A 发布 → B 拉取 → B 增/改/删 push v2 → A pullUpdate 合并 + 软删除 tag + 本地保留 → milestone 提升与列表 → `REMOTE_AHEAD` 拒绝 → 冲突检测且本地不被覆盖，共 24 项断言全通过；服务端全程 200。
  - 渲染层 `vite build` 通过；新增/修改文件 0 lint error。

- **C5 Bug 修复**（2026-06-08，用户集成测试后发现 3 个 bug，同日修复 + 10 项回归通过）：

  | # | 现象 | 根因 | 修复 |
  |---|------|------|------|
  | B1 | Bob 拉取案件D 后，`SyncStatusBar` 立刻显示「15 个本地变更待同步」，实际未做任何改动 | `pullWorkspace` / `pullUpdate` 写 baseline 时用了**云端原始 mtime**（文件上传时刻），但本地文件的磁盘 mtime 是**下载时刻** → `syncStatus` 的 mtime/size 比对误判所有文件都"改了" | `pullWorkspace.js`：初始 pull 和增量 pullUpdate 完成后**重新扫描本地目录**，用真实磁盘 mtime/size 写 baseline（软删除条目仍从云端 manifest 取） |
  | B2 | Bob 在已有文件夹 `/过程文档/` 下新增文件，同步预览显示「已忽略（新文件夹需管理者创建）」 | 案件D 是 C3 时期发布的旧项目，`workspace_folders` 表为空（C5 才引入此表）→ 空集被当成"所有文件夹都不合法" → 非 owner 的**所有**文件全进 `ignored.newFolderFiles` | `syncEngine.js`：新增 `skipFolderProtection` 标志——当 `cloudFolders` 为空时，**跳过全部文件夹保护检查**，所有文件夹视为合法（向后兼容 C3/C4 旧项目） |
  | B3 | Alice 是案件D 的 owner，但推送时被视为 editor（导致不会调用 `POST /folders` 初始化文件夹表，进一步加剧 B2） | 旧 binding（`meta/cloud.json`）没有 `role` 字段（C5 才开始写入），`/versions/latest` 也不返回 `myRole`，fallback 默认 `'editor'` | 服务端 `GET /sync-status` 新增返回 `myRole`（从 `workspace_members` 查询）；`computeWorkspaceSyncPlan` 优先使用服务端返回角色；`getSyncSummary` 透传 `myRole`；IPC `cloud/getSyncStatus` 使用服务端角色 |

  **修改文件：**
  - `cloud/server/src/modules/workspaces/routes.ts` — `sync-status` 端点返回 `myRole`
  - `desktop/src/main/cloud/pullWorkspace.js` — 初始 pull + pullUpdate 完成后重新扫描写 baseline
  - `desktop/src/main/cloud/syncEngine.js` — 空 `cloudFolders` 跳过文件夹保护 + 跳过文件夹变更 ignored
  - `desktop/src/main/cloud/pushSync.js` — `computeWorkspaceSyncPlan` 角色优先取 `statusRes.myRole`
  - `desktop/src/main/cloud/syncStatus.js` — `checkRemoteChanges` / `getSyncSummary` 传递 `myRole`
  - `desktop/src/main/ipc/cloud.js` — `cloud/getSyncStatus` 使用 `summary.myRole`

- **C5 Bug 修复 #2**（2026-06-08，用户报告 Alice 创建新项目后看不到 Bob 的同步内容）：

  | # | 现象 | 根因 | 修复 |
  |---|------|------|------|
  | B4 | Alice 创建新云端项目并发布 → Bob 加入、拉取、新增文件并 push（显示 v2）→ Alice 回到项目查看同步状态，完全看不到「云端有新更新」 | `cloud/publish` IPC handler 仍使用 C3 遗留的 `createDevCloudClient()`（硬编码 `X-Dev-User-Id: 00000000-...0001`），导致 workspace 的 owner 是 **dev user** 而非 Alice 的真实 userId → Alice 的 JWT 请求 `/sync-status` 时服务端查 `workspace_members` 找不到 Alice → 返回 403 → `getSyncSummary` 的 `.catch()` 静默吞掉错误并返回 `{ hasRemoteChanges: false }` → UI 显示「已与云端同步」 | 多层修复：**① IPC `cloud/publish`** 改用 `createAuthCloudClient()`，传入 `currentUser.orgId/userId/displayName`，确保 workspace 以真实用户身份创建 → `workspace_members` 中 owner = Alice 真实 userId **② `publishWorkspace.js`** 移除对 `CLOUD_DEV_CONFIG` 的依赖，改从调用方接收 `orgId/userId/userDisplayName` **③ 服务端 `POST /api/workspaces`** `orgId` 改为可选，优先使用 JWT 中的 `orgId`（向后兼容） **④ `getSyncSummary`** 不再静默 `.catch()` 吞掉错误，改为返回 `remoteError` 字段并 `console.error` 记录 **⑤ `SyncStatusBar`** 新增错误状态渲染（红色警告 + 重试提示），不再在 API 失败时错误显示「已同步」 **⑥ `cloudClient.js`** `_resolveAuthHeaders` 不再 try-catch 吞掉 token 解析异常 |

  **修改文件：**
  - `desktop/src/main/ipc/cloud.js` — `cloud/publish` 改用 `createAuthCloudClient` + 传入真实用户信息
  - `desktop/src/main/cloud/publishWorkspace.js` — 移除 `CLOUD_DEV_CONFIG` import，接收 `orgId/userId/userDisplayName` 参数
  - `cloud/server/src/modules/workspaces/routes.ts` — `createWorkspaceSchema.orgId` 改为 optional，服务端优先使用 JWT orgId
  - `desktop/src/main/cloud/syncStatus.js` — `getSyncSummary` 不再 `.catch` 吞错，返回 `remoteError` 字段
  - `desktop/src/main/cloud/cloudClient.js` — `_resolveAuthHeaders` 移除 token 异常静默处理
  - `desktop/src/ui/components/cloud-projects/SyncStatusBar.jsx` — 新增 `AlertTriangle` 错误状态 UI + `remoteCheckFailed` 处理

  **验证：** 回归测试 10 项全通过（baseline mtime ≈ disk mtime、空 folders 不阻塞 push、删除 binding.role 后仍检测 owner）。

---

### Phase C6 — 简化冲突与单文件恢复

**Status:** `DONE`

**目标**：实现适合 IPM 场景的简单冲突处理和基础版本回溯。

**冲突定义**

```text
同一目录 + 同一文件名 + hash 不同
```

**默认策略**

```text
不覆盖，不合并，自动保留双方版本
```

**工作清单**

写/改：
1. Desktop：冲突检测。
2. Desktop：冲突副本命名。
3. Cloud API：冲突事件记录。
4. Cloud API：版本列表。
5. Desktop：单文件恢复上一版本。
6. Desktop：删除进入待确认/回收。

**验证方法**

1. 两个用户上传同名不同内容文件。
2. 拉取时自动保留双方版本。
3. 用户可恢复单个文件旧版本。

**不做**

- 不做 docx/pdf/ppt 内部对比。
- 不做 Git 式 merge conflict UI。

**变更日志**

- 2026-06-09 完成 C6 第一版：
  - 冲突处理采用“自动保留双方版本”：`pullUpdate` 遇到同路径双方修改时，保留本地原文件，将云端版本另存为同目录冲突副本（`原文件名（云端冲突副本-v{版本号}-{时间}）.ext`），并做同名自动递增。
  - baseline 安全策略：冲突原路径推进到云端最新 entry，冲突副本不写入 baseline，因此恢复/冲突副本会作为本地变更等待用户确认后同步。
  - 服务端新增文件历史与恢复下载 API：`GET /api/workspaces/:id/file-history?path=...`、`POST /api/workspaces/:id/versions/:vid/file-download`；复用 `version_entries -> objects -> OSS`，无需新 migration。
  - 服务端新增冲突审计事件：`POST /api/workspaces/:id/conflict-events` 写入 `version.conflict_auto_kept_both`。
  - 桌面新增 `cloud/listFileHistory`、`cloud/restoreFileFromVersion` IPC；恢复单文件只写本地并备份当前文件，不自动创建云端版本。
  - UI 新增冲突副本提示/详情弹窗；已绑定云端项目的文件右键菜单新增“查看历史/恢复文件”。

  **修改文件：**
  - `cloud/server/src/modules/versions/routes.ts` — 文件历史、指定版本单文件下载、冲突事件 API。
  - `desktop/src/main/cloud/pullWorkspace.js` — C6 冲突副本命名/下载/占位、baseline 策略、冲突事件上报。
  - `desktop/src/main/cloud/fileRestore.js` — 单文件恢复到本地、恢复前备份、大文件占位。
  - `desktop/src/main/ipc/cloud.js` / `desktop/src/preload.js` — C6 IPC 暴露。
  - `desktop/src/ui/components/cloud-projects/ConflictCopiesModal.jsx` — 冲突副本说明弹窗。
  - `desktop/src/ui/components/cloud-projects/FileHistoryRestoreModal.jsx` — 历史版本恢复弹窗。
  - `desktop/src/ui/components/cloud-projects/SyncStatusBar.jsx` — 拉取后展示“已保留冲突副本”。
  - `desktop/src/ui/components/project-manager/hooks/useContextMenu.js` / `desktop/src/ui/components/ProjectManager.jsx` — 文件右键恢复入口。

  **验证：**
  - `cloud/server npm run typecheck` 通过。
  - `desktop npm run lint` 通过（当前脚本为占位）。

---

### Phase C7 — Skill Registry 与官方市场

**Status:** `DONE`（2026-06-10，组织内 Skill Registry + 市场发布/安装/更新闭环）

**目标**：建设 IPM 自身 Agent 生态的云端基础，让 Skill 从本地导入升级为可发现、可安装、可更新的市场能力。

**前置**：C0-C3 至少完成；需要用户身份、OSS 包存储、基础 registry 数据模型。

**工作清单**

读：
- `desktop/src/main/ipc/skills.js`
- `desktop/src/ui/components/knowclaw-v2/SkillManagerPanel.jsx`
- `desktop/src/ui/components/knowclaw-v2/ImportSkillModal.jsx`
- `desktop/Agent/pi-runtime/skills/*/SKILL.md`

写/改：
1. Cloud API：Skill registry schema。
2. Cloud API：Skill 包上传与下载。
3. Desktop：市场 Skill 列表。
4. Desktop：安装 / 更新 / 卸载。
5. Desktop：权限声明展示。
6. Desktop：安装后触发 KnowClaw skill reload。

**Skill 包草案**

```text
skill.json
SKILL.md
scripts/
assets/
examples/
README.md
```

**验证方法**

1. 组织成员可上传 Skill 到 registry。✅
2. Desktop 可从组织市场安装 / 更新 Skill。✅
3. 新会话可加载安装后的 Skill。✅（安装后触发 reload，并提示下次新对话生效）

**不做**

- 不做第三方审核流。
- 不做评分评论。
- 不做企业强制分发。

**变更日志**

- **2026-06-10 完成 C7 第一版**：
  - 新增 `cloud/server/src/infra/db/migrations/0004_skills.sql`：建立 `skills`、`skill_versions`、`skill_installs` 三张表；同组织 `slug` 唯一，同 Skill 版本号唯一，删除态预留 `status='archived'`。
  - 新增 `cloud/server/src/modules/skills/routes.ts` 并在 `app.ts` 注册：提供组织内 Skill 列表、详情、上传签名 URL、发布新 Skill、发布新版本、下载签名 URL、记录安装、查询已安装 Skill。
  - 新增 `desktop/src/main/cloud/skillPackage.js`：以 `SKILL.md` 为核心，将 Skill 目录打包为 `.ipmskill` JSON 包，计算 sha256，下载安装时校验 hash，并安全解包到当前用户 Skill 目录。
  - 扩展 `desktop/src/main/ipc/skills.js` 与 `desktop/src/preload.js`：新增 `registryList`、`registryGet`、`registryPublish`、`registryPublishVersion`、`registryInstall` 通道。
  - 扩展 `useKnowClawPersist.jsx`：封装发布 / 安装动作，安装成功后调用现有 `reloadSkills` 并刷新本地 Skill 列表，保持“下次新对话生效”的语义。
  - 新增 `SkillMarketplacePanel.jsx`：在技能管理侧栏展示组织市场 Skill，显示发布者、版本、安装状态、可更新状态，支持安装 / 更新。
  - 新增 `PublishSkillModal.jsx`：从用户 / 导入 / 工作空间 Skill 中选择一个发布到组织市场，可填写版本号和描述；内置 Skill 不允许直接发布。
  - 修改 `SkillManagerPanel.jsx`：增加“本地 / 组织市场”Tab；本地能力保持原有导入、启用/禁用、删除。
  - 同名安装复用现有冲突策略：默认不覆盖，返回冲突；UI 提供“覆盖安装”与“改名安装”两种处理。
  - 验证：`cloud/server npm run typecheck` 与 `npm run build` 通过；`desktop npm run lint` 为占位脚本（输出 `No linting configured`）；`desktop npm run package` 已通过 Vite main/preload/renderer 构建阶段，最终 packaging 因访问 `20.205.243.166:443` 超时失败；IDE lints 对本次新增/修改文件未报错。

- **C7-B1 Skill 包上传 SignatureDoesNotMatch 修复**（2026-06-10）：
  - 问题：发布 Skill 时 OSS 返回 `SignatureDoesNotMatch`。根因是服务端 `getSignedPutUrl()` 签入的 `Content-Type` 为 `application/octet-stream`，但桌面端 Skill 包上传实际发送 `application/json`；阿里云 OSS 会把 `Content-Type` 纳入 PUT URL 签名计算。
  - 修复：`desktop/src/main/cloud/skillPackage.js` 的 `putBufferToSignedUrl()` 改为发送 `Content-Type: application/octet-stream`，与服务端签名保持一致。

---

### Phase C8 — Skill 审核与访问控制

**Status:** `DONE`（2026-06-10，提交待审 + owner/admin 审核 + 全组织/指定用户可见）

**目标**：把 C7 的“组织成员发布后立即可见”升级为企业治理流程：普通成员提交 Skill 后进入待审核，`owner/admin` 审核通过并设置可见范围后，目标成员才能在市场看到、下载和安装。

**工作清单**

写/改：
1. Skill 提交后进入 `pending_review`。
2. `owner/admin` 可查看审核队列。
3. `owner/admin` 可审核通过 / 拒绝。
4. 审核通过后设置可见范围：全组织 / 指定用户。
5. 普通市场只展示 `approved` 且当前用户有访问授权的 Skill。
6. 下载 / 安装 API 后端强校验访问授权，不能通过已知 ID 绕过市场。

**验证方法**

1. Bob 作为 member 提交 Skill 后，普通组织市场不可见。✅
2. Alice 作为 owner/admin 能在“审核管理”看到待审核 Skill。✅
3. Alice 拒绝后，普通市场仍不可见。✅
4. Alice 通过并设置“全组织可见”后，组织成员能看到并安装。✅
5. Alice 通过并设置“指定用户可见”后，仅目标用户可见。✅
6. 未授权用户即使知道 Skill ID，也无法下载包或记录安装。✅

**不做**

- 不做默认安装 / 强制安装。
- 不做版本锁定。
- 不做项目级 / 部门级分发。
- 不做复杂审批流。
- 不做脚本沙盒增强。

**变更日志**

- **2026-06-10 完成 C8 第一版**：
  - 新增 `cloud/server/src/infra/db/migrations/0005_skill_review.sql`：扩展 `skills.status` 为 `pending_review / approved / rejected / archived`，新增 `reviewed_by`、`reviewed_at`、`review_note`，新增 `skill_access_grants` 授权表；兼容迁移 C7 的 `active` 为 `approved`，并为既有 Skill 写入全组织可见授权。
  - 修改 `cloud/server/src/modules/auth/routes.ts`：登录、注册、刷新、`/api/auth/me` 返回 `orgRole`。
  - 修改 `desktop/src/main/cloud/userScope.js`、`desktop/src/main/ipc/auth.js`：本地当前用户保存并暴露 `orgRole`，已有登录用户启动时会 best-effort 调用 `/api/auth/me` 刷新角色。
  - 修改 `cloud/server/src/modules/skills/routes.ts`：`POST /api/skills` 和新版本提交改为 `pending_review`；普通市场 `GET /api/skills` 只返回已审核且当前用户有授权的 Skill；详情、下载、安装增加访问控制。
  - 新增管理员 API：`GET /api/skills/admin/review-queue`、`GET /api/skills/admin/org-users`、`POST /api/skills/:id/review`、`GET/POST /api/skills/:id/access`；后端用 `org_members.role IN ('owner','admin')` 强校验。
  - 扩展 `desktop/src/main/ipc/skills.js` 与 `desktop/src/preload.js`：接入审核队列、组织成员、审核通过/拒绝、访问范围读取与设置。
  - 修改 `desktop/src/ui/hooks/useKnowClawPersist.jsx`：封装 C8 审核管理动作，并将发布成功文案改为“已提交审核”。
  - 修改 `SkillManagerPanel.jsx`：owner/admin 显示第三个 Tab“审核管理”；普通成员仍只看到“本地 / 组织市场”。
  - 修改 `PublishSkillModal.jsx`、`SkillMarketplacePanel.jsx`：发布改为提交审核文案；市场空态改为“暂无已审核且对你可见的 Skill”。
  - 新增 `SkillReviewAdminPanel.jsx` 与 `SkillAccessModal.jsx`：支持审核队列、通过并授权、拒绝、调整已通过 Skill 的可见范围。
  - 验证：`cloud/server npm run typecheck` 通过；`cloud/server npm run build` 通过；`cloud/server npm run db:migrate` 成功应用 `0005_skill_review.sql`；`desktop npm run lint` 为占位脚本；`desktop npm run package` 完整通过。

---

### Phase C9 — 企业 AI 配置模板分发

**Status:** `DONE`

**目标**：让组织 `owner/admin` 可以把当前 Desktop 中已调好的 AI 相关配置保存为企业配置模板，生成仅同组织可用的配置码；普通成员输入配置码后预览并覆盖本机 AI 设置，快速获得统一的企业 AI 使用环境。

**产品边界**

- C9 管理的是“AI 配置分发”，不是 workspace 成员与权限治理。
- 配置模板直接保存到 PostgreSQL，不走 OSS。
- 配置内容包含敏感凭证（如 API Key），导入后会保存到成员本机 Desktop。
- 成员导入时采用覆盖策略，不做复杂合并。
- 配置码仅同组织账号可使用，外部组织或未登录用户不可导入。

**工作清单**

写/改：
1. 新增 `org_config_templates` 表：保存企业配置模板，字段包括 `org_id`、`template_type='ai_settings'`、`name`、`description`、`config_json`、`code`、`status`、`max_uses`、`used_count`、`expires_at`、`created_by`、`created_at`、`updated_at`、`rotated_at`。
2. 新增 `org_config_template_uses` 表：记录谁在什么时候导入过配置，用于管理员查看使用记录。
3. 后端新增企业配置模板 API：
   - owner/admin 创建模板：从 Desktop 当前设置提交 `prefs.ai`、`prefs.searchApi`。
   - owner/admin 列出模板、停用模板、刷新配置码、查看使用记录。
   - 普通成员通过配置码预览模板。
   - 普通成员确认导入配置码，服务端校验组织、状态、过期时间、使用次数后返回配置 JSON 并记录使用。
4. Desktop 主进程扩展 `prefs` IPC：
   - 读取当前 AI 设置并保存为企业模板。
   - 输入配置码预览企业配置。
   - 确认后覆盖本地 `prefs.ai` 与 `prefs.searchApi`。
5. `SettingsPage` 新增“企业 AI 配置”区域：
   - owner/admin 可保存当前 AI 配置为企业模板。
   - owner/admin 可查看模板列表、复制配置码、刷新配置码、停用模板、查看使用次数和使用记录。
   - 所有登录成员可输入配置码、预览配置内容、确认覆盖导入。
6. UI 明确提示：模板包含 API Key 等敏感凭证，导入后会保存在本机配置中。

**验证方法**

1. 管理员保存当前 AI 配置为企业模板后，生成配置码。
2. 管理员可刷新配置码，旧配置码失效，新配置码可用。
3. 管理员可设置最大使用次数；超过次数后成员无法继续导入。
4. 管理员可停用模板；停用后配置码不可预览或导入。
5. 同组织 member 输入配置码后可预览配置，并确认覆盖本地 `prefs.ai` / `prefs.searchApi`。
6. 非同组织用户、未登录用户、过期配置码、停用配置码都无法导入。
7. 管理员可看到模板使用次数与导入记录。

**不做**

- 不做完整 Admin Web Console。
- 不做 workspace 成员管理、workspace owner 转移、项目权限治理。
- 不做存储配额、大文件版本保留、回收站策略。
- 不做模板合并策略；导入即覆盖本地 AI 配置。
- 不做云端代理调用；API Key 仍会随模板导入保存到成员本机。
- 不做 Skill 组合包、分类偏好、MCP 配置分发；`template_type` 只为后续扩展预留。

**变更日志**

- 2026-06-12：完成 C9 企业 AI 配置模板分发。
  - 数据库：新增 `0006_org_config_templates.sql`，创建 `org_config_templates` 与 `org_config_template_uses`，支持配置码、状态、最大使用次数、过期时间、刷新时间与导入记录。
  - 后端：新增 `cloud/server/src/modules/org-configs/routes.ts` 并注册到 `app.ts`；owner/admin 可创建、列出、刷新配置码、停用模板、查看使用记录；同组织成员可预览和导入配置码。
  - 安全与规则：配置码只在同组织内可用；停用、过期、超出最大使用次数会返回明确错误；导入时用事务更新 `used_count` 并写入使用记录。
  - Desktop：扩展 `prefs` IPC 与 `preload`，支持创建模板、模板管理、配置码预览和导入；导入后只覆盖本地 `prefs.ai` 与 `prefs.searchApi`。
  - UI：`SettingsPage` 新增“企业 AI 配置”卡片；普通成员可输入配置码、预览配置摘要并确认覆盖导入；owner/admin 可保存当前 AI 设置为模板、复制/刷新配置码、停用模板、查看使用记录。
  - 提示：UI 明确标注模板可能包含 API Key，导入后会保存到成员本机。
  - 验证：`cloud/server npm run typecheck` 通过；`cloud/server npm run build` 通过；`cloud/server npm run db:migrate` 成功应用 `0006_org_config_templates.sql`；`desktop npm run lint` 为占位脚本；`desktop npx vite build --config vite.renderer.config.mjs` 通过；`desktop npm run package` 的 Vite main/preload/renderer 构建阶段通过，最终 Electron Forge packaging 因外部网络 `connect ETIMEDOUT 20.205.243.166:443` 失败。

---

### Phase C10 — NAS / 本地共享盘外部资料源

**Status:** `PLANNED`

**目标**：先接最贴近现有本地附属导入能力的外部资料源：NAS、本地网络盘、WebDAV、S3-compatible。

**工作清单**

读：
- `desktop/src/main/modules/localFolders.js`
- `desktop/src/main/modules/localExplorer.js`
- `desktop/src/ui/components/project-manager/hooks/useLocalFolders.js`

写/改：
1. 升级附属文件夹索引。
2. 支持网络路径。
3. WebDAV adapter。
4. S3-compatible adapter。
5. 外部资料源选择导入 IPM 项目。

**验证方法**

1. 用户接入一个网络盘目录。
2. IPM 可扫描并展示目录。
3. 用户选择文件导入到项目。

**不做**

- 不做实时同步。
- 不做厂商私有 NAS API。

**变更日志**

- 待实现。

---

### Phase C11 — 飞书连接器

**Status:** `PLANNED`

**目标**：接入飞书云空间，支持用户授权后浏览目录、选择文件并导入 IPM。

**工作清单**

写/改：
1. 飞书 OAuth。
2. 云空间目录列表。
3. 文件下载。
4. 在线文档导出策略。
5. Desktop 选择导入 UI。
6. 可选：IPM 产物发布回飞书。

**验证方法**

1. 用户授权飞书。
2. 可浏览指定云空间文件夹。
3. 可选择 PDF/docx/xlsx 导入 IPM 项目。

**不做**

- 不做实时双向同步。
- 不做飞书文档协同编辑。

**变更日志**

- 待实现。

---

### Phase C12 — 企业微信微盘连接器

**Status:** `PLANNED`

**目标**：接入企业微信微盘，面向企业客户支持空间选择、文件列表、下载导入。

**工作清单**

写/改：
1. 企业微信应用授权。
2. access_token 管理。
3. spaceid / fatherid 文件列表。
4. 文件下载。
5. 分块上传/下载预研。
6. Desktop 选择导入 UI。

**验证方法**

1. 企业管理员完成授权。
2. 用户可看到微盘空间。
3. 用户可选择文件导入 IPM 项目。

**不做**

- 不做普通用户免管理员授权的微盘同步。
- 不做实时同步。

**变更日志**

- 待实现。

---

### Phase C13 — 外部 Agent 记录导入

**Status:** `PLANNED`

**目标**：支持 Kimi Code、Cursor、Claude Code 等外部 Agent 工作记录导入 IPM，用于知识沉淀、项目复盘和上下文迁移。

**工作清单**

写/改：
1. 定义 External Agent Record schema。
2. 支持 Markdown / JSON / 分享链接导入。
3. 导入为本地知识库条目。
4. 可选提交到云端项目知识库。
5. 生成摘要与可复用上下文。

**验证方法**

1. 导入一份外部 Agent 会话。
2. 生成 Markdown 归档。
3. 用户可选择是否提交到云端项目。

**隐私原则**

- 默认本地保存。
- 用户主动提交后才进入云端协作项目。

**变更日志**

- 待实现。

---

## 4. MVP 定义

### 4.1 Cloud Core MVP

v2.1 第一阶段最小可验收闭环：

```text
用户 A 本地案件
  → 发布到云端
  → 用户 B 加入并拉取副本
  → 用户 A 提交一个文件
  → 用户 B 手动拉取
  → 同名冲突不覆盖
  → 用户可恢复单个文件旧版本
```

对应阶段：

- C0
- C1
- C2
- C3
- C3.5
- C4
- C5
- C6

### 4.2 IPM Agent Ecosystem MVP

第二阶段最小可验收闭环：

```text
官方 Skill 上传市场
  → 用户从 Desktop 安装
  → KnowClaw 新会话加载
  → 企业可默认分发并锁定版本
```

对应阶段：

- C7
- C8
- C9 部分能力

### 4.3 External Ecosystem MVP

第三阶段最小可验收闭环：

```text
外部资料源连接
  → 浏览目录
  → 选择文件
  → 导入 IPM 项目
  → 进入 KnowClaw / 分类 / 知识库工作流
```

对应阶段：

- C10
- C11
- C12
- C13

---

## 5. 进度看板

| 阶段 | Status | 负责人 | 最近更新 | 备注 |
|------|--------|--------|----------|------|
| C0 后端骨架与云端基础设施 | `DONE` | Cursor | 2026-06-03 | Fastify + PostgreSQL + OSS client 占位 + Docker Compose 验证完成 |
| C1 数据模型 | `DONE` | Cursor | 2026-06-04 | Migration + runner + self-check 全部验证通过 |
| C2 Desktop Cloud Binding | `DONE` | Cursor | 2026-06-05 | cloud 模块 + IPC + 离线扫描/绑定验证通过 |
| C3 发布本地项目 | `DONE` | Cursor | 2026-06-05 | 全链路打通；修复 OSS 签名 Bug |
| C3.5 真实鉴权（Auth） | `DONE` | Cursor | 2026-06-07 | JWT + 邀请码 + Per-User 数据隔离 + 登录 UI |
| C4 成员加入与拉取 | `DONE` | Cursor | 2026-06-07 | workspace 浏览/加入/拉取 + 50MB 阈值占位 + CloudProjectsPage |
| C5 显式同步与里程碑版本 | `DONE` | Cursor | 2026-06-08 | 三方 diff + 增量 push/pull + 软删除 + 文件夹保护 + Milestone + 同步 UI；24 项 e2e 通过 |
| C6 冲突与恢复 | `DONE` | Cursor | 2026-06-09 | 自动保留冲突副本 + 单文件历史恢复到本地 |
| C7 Skill Registry | `DONE` | Cursor | 2026-06-10 | 组织内市场发布 / 安装 / 更新闭环 |
| C8 Skill 审核与访问控制 | `DONE` | Cursor | 2026-06-10 | 提交待审 + owner/admin 审核 + 可见范围授权 |
| C9 企业 AI 配置模板分发 | `DONE` | Cursor | 2026-06-12 | 管理员保存 AI 配置模板，成员通过配置码预览并覆盖导入 |
| C10 NAS / 本地共享盘 | `PLANNED` | TBD | — | 外部资料源第一站 |
| C11 飞书连接器 | `PLANNED` | TBD | — | 飞书 OpenAPI |
| C12 微盘连接器 | `PLANNED` | TBD | — | 企业授权更重 |
| C13 外部 Agent 导入 | `PLANNED` | TBD | — | 生态迁移能力 |

---

## 6. 当前关键决策记录

### D1 — v2.1 不是实时网盘

**决策**：采用本地优先 + 显式提交/拉取。

**理由**：
- 律师项目文件大；
- 用户需要离线工作；
- 实时静默覆盖风险高；
- 本地工作空间是 v2 核心资产。

### D2 — KnowClaw 工作流记录默认不上云

**决策**：不默认保存 prompt、response、thinking、工具调用、AI 生成标签。

**理由**：
- 隐私优先；
- 云端协作只需要用户明确提交的文件与必要事件；
- AI 生成文件在云端视作普通文件。

### D3 — 冲突处理简化

**决策**：同目录同名 hash 不同即冲突，默认自动保留双方版本。

**理由**：
- IPM 文件多为 Word/PDF/PPT/图片/视频；
- 不适合 Git 式文本 merge；
- 法律场景保留版本比强行合并更安全。

### D4 — 版本控制采用 blob 去重 + manifest

**决策**：不复制完整项目快照；版本只保存路径到 hash 的映射。

**理由**：
- 控制 OSS 存储成本；
- 支持大文件；
- 支持单文件恢复与项目历史。

### D5 — Skill 市场提前于外部资料源

**决策**：C7-C9 先做 IPM 自身 Agent 生态，再做 NAS / 飞书 / 微盘。

**理由**：
- 先完成 IPM 自己的平台能力；
- 企业 Skill 分发是 v2.1 商业化核心；
- 外部资料源依赖核心协作与权限稳定。

---

## 7. 待确认事项

| ID | 问题 | 候选方案 |
|----|------|----------|
| Q1 | Cloud API 技术栈 | Node/Fastify、NestJS、Hono、其他 |
| Q2 | 数据库 | 轻量服务器 PostgreSQL 起步，后续迁 RDS？ |
| Q3 | OSS 地域 | 与轻量服务器同地域，或中国内地通用资源包 |
| Q4 | 初始下载策略 | 完整下载 / 索引优先 / 用户选择 |
| Q5 | 大文件阈值 | 50MB / 100MB / 企业策略配置 |
| Q6 | 冲突副本命名 | 用户名+时间 / 冲突副本+时间 / 可配置 |
| Q7 | Skill 包格式 | 是否沿用 Agent Skills 规范并增加 `skill.json` |
| Q8 | 企业后台 | 先只做 API + Desktop 设置页，还是同步开发 Admin Web |
| Q9 | NAS 第一版 | 仅网络路径，还是同时 WebDAV |
| Q10 | 飞书在线文档导出格式 | docx / pdf / markdown / 用户选择 |

---

## 8. 总结

v2.1 的开发顺序应围绕三个闭环推进：

```text
第一闭环：Cloud Collaboration
让两个用户安全地协作维护同一个 IPM 项目/案件。

第二闭环：IPM Agent Ecosystem
让 Skill 可以被发现、安装、更新、企业分发。

第三闭环：External Ecosystem
把 NAS、飞书、微盘、外部 Agent 记录接入 IPM。
```

当前第一优先级不是外部平台连接，而是先把 IPM 自己的云端协作底座和 Agent 生态做完整。

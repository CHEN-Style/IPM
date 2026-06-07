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
| C4 | 成员加入与拉取副本 | 加入项目、拉 manifest、小文件下载、大文件占位 | G3 | `PLANNED` |
| C5 | 显式提交 / 拉取 | 变更扫描、提交说明、上传缺失 blob、拉取更新 | G3, G5 | `PLANNED` |
| C6 | 简化冲突与单文件恢复 | 同名冲突副本、版本列表、单文件恢复 | G5, G6 | `PLANNED` |
| C7 | Skill Registry 与官方市场 | Skill 元数据、包上传、安装/更新、权限声明 | G8 | `PLANNED` |
| C8 | 企业 Skill 分发 | 默认 Skill、企业私有 Skill、版本锁定、禁用策略 | G7, G8 | `PLANNED` |
| C9 | 企业权限、配额与保留策略 | owner/editor/viewer、存储配额、历史保留、基础审计 | G7 | `PLANNED` |
| C10 | NAS / 本地共享盘外部资料源 | 附属文件夹升级、网络路径、WebDAV/S3 适配 | G9 | `PLANNED` |
| C11 | 飞书连接器 | OAuth、云空间目录、选择文件、导入 IPM | G9 | `PLANNED` |
| C12 | 企业微信微盘连接器 | 企业授权、space/file 列表、下载导入 | G9 | `PLANNED` |
| C13 | 外部 Agent 记录导入 | Kimi/Cursor/Claude Code 记录导入为知识/归档 | G10 | `PLANNED` |

> **说明**：C0-C6 是 Cloud Core MVP；C7-C9 是 IPM 自身 Agent 生态与企业化；C10-C13 是外部生态连接。

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

### Phase C4 — 成员加入与拉取副本

**Status:** `PLANNED`

**目标**：第二个成员可加入云端项目，并在本地生成工作副本。

**工作清单**

写/改：
1. Cloud API：邀请/加入 workspace。
2. Desktop：云端项目列表。
3. Desktop：选择下载模式。
4. Desktop：拉取最新 manifest。
5. Desktop：创建本地目录结构。
6. Desktop：小文件下载，大文件占位。

**下载模式**

| 模式 | 行为 |
|------|------|
| 完整下载 | 下载所有文件 |
| 索引优先 | 只下载目录、manifest、小文件 |
| 按需下载 | 大文件显示占位，点击再下载 |

**验证方法**

1. 用户 B 可看到用户 A 发布的项目。
2. 用户 B 可加入并生成本地副本。
3. 大文件可不立即下载。

**变更日志**

- 待实现。

---

### Phase C5 — 显式提交 / 拉取

**Status:** `PLANNED`

**目标**：完成多人协作的最小闭环：A 提交，B 拉取；B 修改，A 拉取。

**工作清单**

写/改：
1. Desktop：本地变更扫描。
2. Desktop：待提交 UI。
3. Desktop：提交说明。
4. Cloud API：创建新 version。
5. Desktop：拉取远端版本。
6. Desktop：应用无冲突变更。

**提交清单展示**

- 新增文件；
- 修改文件；
- 删除文件；
- 移动/重命名文件；
- 目录结构变化；
- 可能冲突文件。

**验证方法**

1. 用户 A 新增文件并提交。
2. 用户 B 手动拉取后看到文件。
3. 用户 B 本地未提交文件不会被静默覆盖。

**不做**

- 不自动后台实时同步。
- 不做文件内部 diff。

**变更日志**

- 待实现。

---

### Phase C6 — 简化冲突与单文件恢复

**Status:** `PLANNED`

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

- 待实现。

---

### Phase C7 — Skill Registry 与官方市场

**Status:** `PLANNED`

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

1. 官方 Skill 可上传到 registry。
2. Desktop 可从市场安装 Skill。
3. 新会话可加载安装后的 Skill。

**不做**

- 不做第三方审核流。
- 不做评分评论。
- 不做企业强制分发。

**变更日志**

- 待实现。

---

### Phase C8 — 企业 Skill 分发

**Status:** `PLANNED`

**目标**：支持企业将指定 Skill 分发给成员或项目，形成类 Workbuddy 企业版的能力下发机制。

**工作清单**

写/改：
1. 企业私有 Skill。
2. 默认安装 Skill。
3. 禁用未审核 Skill。
4. 版本锁定。
5. 项目级 Skill 配置。
6. Desktop 显示“由企业管理”的 Skill 状态。

**验证方法**

1. 管理员给组织下发一个 Skill。
2. 成员 Desktop 登录后可见并自动安装。
3. 被锁定版本不会自动升级。

**不做**

- 不做复杂审批流。
- 不做脚本沙盒增强。

**变更日志**

- 待实现。

---

### Phase C9 — 企业权限、配额与保留策略

**Status:** `PLANNED`

**目标**：补齐企业版基础管理能力，让云端协作具备可控的权限、存储和审计边界。

**工作清单**

写/改：
1. workspace role：owner / editor / viewer。
2. 项目成员管理。
3. 存储配额。
4. 大文件版本保留策略。
5. 回收站保留策略。
6. 基础审计日志。
7. Desktop 设置页展示企业策略。

**验证方法**

1. viewer 无法提交变更。
2. 超出配额时阻止上传并提示。
3. 管理员可设置历史版本保留数量。

**不做**

- 不做完整 Admin Web Console。
- 不做精细到字段级的权限。

**变更日志**

- 待实现。

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
| C3 发布本地项目 | `DONE` | 本次 | 见 Phase C3 变更日志 | 全链路打通；修复 OSS 签名 Bug |
| C4 成员加入与拉取 | `PLANNED` | TBD | — | 验证多人协作 |
| C5 显式提交/拉取 | `PLANNED` | TBD | — | 核心协作闭环 |
| C6 冲突与恢复 | `PLANNED` | TBD | — | 安全感闭环 |
| C7 Skill Registry | `PLANNED` | TBD | — | 先做自身生态 |
| C8 企业 Skill 分发 | `PLANNED` | TBD | — | 类 Workbuddy 能力 |
| C9 企业权限与配额 | `PLANNED` | TBD | — | 企业版基础 |
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

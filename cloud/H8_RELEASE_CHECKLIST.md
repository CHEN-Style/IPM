# IPM v2.1 C1-C9 Release Checklist（H8）

> 本清单是 `IPM_V2_1_H0_AUDIT.md` §5 回归矩阵的可执行落地版：把能脚本化的项目接入 `h8:gate` 自动门禁，其余桌面深交互保留为人工 checklist。每次大改后按本清单跑一遍。

## 0. 一键自动门禁

前置：仅需 Postgres 已启动且 `cloud/server/.env` 的 `DATABASE_URL` 可用。**无需手动启动 dev server**——门禁会自建临时服务。

运行：

```bash
cd cloud/server
npm run h8:gate
```

门禁会依次执行：cloud `typecheck`/`build`/`db:migrate`/`db:check` → `h1`-`h7` verify → desktop renderer build → Electron Forge package smoke，并在 `cloud/server/.h8-reports/` 写出 `release-gate-<时间>.json` / `.md` 以及 `latest.json` / `latest.md`。

### 临时服务与限流（A7）说明

verify 套件会从同一 IP 发起大量 register/login，而 `h1-verify` 还会故意打满认证限流桶（A7）。若全部打到同一台固定 dev server，必然触发 `429 RATE_LIMITED`。因此门禁默认**自建临时服务**（用刚构建出的 `dist/`），并按套件切换限流档位：

- `h1`：临时服务限流=默认 20（其限流断言需要 429 被触发）；
- `h2`-`h7`：临时服务限流=关闭（`AUTH_RATE_LIMIT_MAX=0`），避免累计认证调用被限流。

限流额度已做成可配置：env `AUTH_RATE_LIMIT_MAX`（默认 20）、`AUTH_RATE_LIMIT_WINDOW`（默认 `1 minute`）；生产禁止设为 0。

常用参数：

| 参数 | 作用 |
|------|------|
| `--base <url>` | 改用已运行的外部 server（不自建临时服务；可能触发 A7 限流） |
| `--gate-port <n>` | 临时服务端口（默认 `4222`，避开常用的 4210） |
| `--no-package` | 跳过 Electron Forge package（最耗时项） |
| `--no-desktop` | 跳过 desktop renderer build + package |
| `--no-migrate` | 跳过 `db:migrate` / `db:check` |

门禁判定：

- **PASS**：无 blocking 失败，且 dev server 可达。
- **FAIL**：存在 blocking 失败，或 dev server 未就绪导致 h1-h7 无法验证。
- **non-blocking external**：Electron Forge package 因网络/外部依赖下载失败（如历史上的 `20.205.243.166:443` 超时），只记录、不阻断；判据见报告 `output` 尾部。

## 1. 自动回归矩阵（由 h8:gate 覆盖）

| ID | 域 | 场景 | 自动载体 |
|---|---|---|---|
| R-AUTH-1/2/3 | 认证 | 邀请码注册/登录/`me`、无效或超限邀请码、refresh rotation | `h1`-`h4` register/login 路径 + `h2-verify` 邀请码 |
| R-AUTH-4 | 认证 | 错误密码触发限流 | `h1-verify`（A7 限流断言） |
| R-PULL-1/2 | 拉取 | 列表→加入（幂等）→拉取、占位按需下载 | `h4-verify`（可见性 + 邀请码加入） |
| R-SYNC-3 | 同步 | 基线落后 push 返回 409 REMOTE_AHEAD | 对应同步端点（dev server 在线时校验） |
| R-SYNC-4/5 | 同步 | 旧项目/非 owner 新文件夹忽略语义 | 同步端点回归 |
| R-VER-1 | 版本 | owner 创建/晋升 milestone、editor 403、`?type=milestone` | 版本端点回归 |
| R-CONF-1 | 冲突 | 双方改同一路径冲突副本 + 事件入库 | 冲突端点回归 |
| R-SKILL-1/2 | Skill | 提交不可见、审核队列、三种可见性、未授权 403 | `h5-verify` |
| R-CFG-2 | AI 配置 | 超限/过期/停用/轮换旧码/跨组织导入全部明确错误 | `h6-verify` |
| 治理 | 停用语义 | 企业/成员/workspace 停用的拒绝路径 | `h1`/`h2`/`h3`-verify（IA-3 语义） |
| 企业可观测 | 审计 | 企业 stats/events 网关 + 平台 events/控制台壳 | `h7-verify` |
| R-INFRA-1 | 基础 | `typecheck` + `build` + 幂等 `db:migrate` + `db:check` | gate 步骤 `cloud:*` |
| R-INFRA-2 | 基础 | renderer `vite build`；`package` smoke（区分代码错误与网络错误） | gate 步骤 `desktop:renderer` / `desktop:package` |

> 注：上表中“同步端点回归 / 版本端点回归 / 冲突端点回归”当前主要由 C5 既有 e2e 与 h3/h4 覆盖业务前置；若后续这些场景没有独立断言，请在对应 H 阶段补脚本或转入下方人工项执行。

## 2. 人工回归矩阵（脚本不覆盖，需桌面操作）

每项记录：通过 / 失败 / 备注。

| ID | 域 | 场景 | 操作步骤 | 预期结果 |
|---|---|---|---|---|
| R-AUTH-5 | 认证 | 离线模式 + 切换账号数据隔离 | 断网进入 → 数据落 `_offline/`；切换账号 | 两账号数据互不可见 |
| R-PUB-1 | 发布 | 发布含 >50MB 文件的项目 | 桌面发布一个大文件项目 | OSS blob 存在、v1 manifest 完整、`cloud.json`+baseline 写入、发布期写锁生效 |
| R-PUB-2 | 发布 | 发布中取消 / 网络失败 | 发布过程中断网或取消 | 解锁、无半绑定状态、错误提示明确 |
| R-SYNC-1 | 同步 | B 增/改/删 → pushSync | B 端改动后推送 | v2 提交、软删除标记、A 端云状态显示有更新 |
| R-VER-2 | 版本 | 单文件历史 → 恢复旧版 | 在文件历史里恢复一个旧版本 | 恢复前自动备份、恢复后显示为本地待同步、不自动建云端版本 |
| R-SKILL-3 | Skill | 安装→新会话加载；新版本更新提示；同名冲突 | 安装一个 Skill，再发布新版本 | 新会话能加载；有更新提示；不静默覆盖本地同名 Skill |
| R-CFG-1 | AI 配置 | admin 建模板 → member 预览（不计数）→ 导入（计数+记录） | 走配置码导入全流程 | 本地 `prefs.ai`/`prefs.searchApi` 被覆盖、used_count 正确 |
| ENT-1 | 企业控制台 | owner/admin 概览与审计 Tab | 进入企业控制台「概览与审计」 | 统计卡、风险提示、审计日志、类型过滤、加载更多均正常 |
| PLAT-1 | 平台控制台 | 创建企业 → 指定 owner/发邀请码 → 停用 → 恢复 | 浏览器打开 `/platform-console/` 全流程 | 全流程无需 CLI；非平台管理员访问数据接口 403 |

## 3. 错误提示覆盖验收

> 目标：主要失败场景都给出用户可读、可指导下一步的提示，而不是裸 500 / 静默失败。逐项确认文案是否存在且准确。

### 3.1 网络失败
- [ ] Cloud API 不可达：桌面发布/同步时云端关闭 → 明确“无法连接云端 / 稍后重试”，非崩溃。
- [ ] 请求超时：弱网下长请求 → 超时提示而非永久转圈。
- [ ] 登录过期：access token 失效且 refresh 失效 → 提示重新登录（平台控制台已实现 401→refresh→失败登出）。

### 3.2 OSS / 对象失败
- [ ] 上传失败：OSS 凭证缺失/失效发布 → 明确失败原因，发布不留半绑定状态。
- [ ] 下载失败：占位文件按需下载失败 → 提示重试，不破坏本地占位。
- [ ] 校验失败：内容 sha256 不匹配 → 明确告警，不静默写入。

### 3.3 权限失败
- [ ] 通用 403：非授权调用企业/平台接口 → 明确“无权限”，不暴露内部细节。
- [ ] Skill 未授权：未授权用户凭 ID 下载 Skill → 403 + 可读提示。
- [ ] Workspace/Config 越权：非 owner/admin 操作治理动作 → 明确拒绝。

### 3.4 停用语义（IA-3）
- [ ] 企业停用：`ORG_DISABLED` → 成员侧明确“企业已停用，请联系平台管理员”。
- [ ] 成员停用：`MEMBER_DISABLED` → 明确“账号已被企业停用”。
- [ ] workspace archived/disabled：协作端只读/不可同步 → 明确状态与原因。

> 现有错误提示入口参考：`desktop/src/ui/hooks/useCloudPublish.jsx`、`desktop/src/ui/components/cloud-projects/SyncDrawer.jsx`、`desktop/src/ui/components/enterprise/EnterpriseOverviewView.jsx`、`desktop/src/ui/components/SettingsPage.jsx`、`desktop/src/main/cloud/cloudClient.js`（统一抛出 `.code` 机器码）。

## 4. 构建产物与忽略策略

- 根 `.gitignore`：`dist/`（覆盖 `cloud/server/dist`、`desktop/dist`）、新增 `.h8-reports/`。
- `desktop/.gitignore`：`.vite/`、`out/`，并显式补 `dist/`（renderer build 输出）。
- package smoke 失败后若残留 `desktop/out/`、`desktop/.vite/`、`desktop/dist/`：门禁只报告，不自动删除（避免误删用户产物）。需要清理时手动执行：

```bash
# 在 desktop 目录
rm -rf out .vite dist        # PowerShell: Remove-Item -Recurse -Force out,.vite,dist
```

- 门禁自身产物只写在 `cloud/server/.h8-reports/`，已被 git 忽略，可安全删除。

## 5. 失败定位指引

| 现象 | 多半原因 | 排查 |
|---|---|---|
| h1-h7 全部 skip | `dist/main.js` 缺失（cloud build 失败） | 先看 `cloud:build` 是否 blocking 失败并修复 |
| h1-h7 临时 server 启动失败 | DB 不可用 / 端口被占 | 检查 `DATABASE_URL`、`--gate-port` 是否被占用 |
| `--base` 模式下 h2-h7 出现 429 RATE_LIMITED | 外部 server 限流（A7） | 改用默认临时服务模式，或给外部 server 设 `AUTH_RATE_LIMIT_MAX=0` |
| 单个 hN-verify 失败 | 对应阶段回归 / 数据脏 | 看报告 `output` 尾部；必要时换新 dev DB 重跑 |
| `cloud:db:migrate` 失败 | DB 连接/迁移冲突 | 检查 `DATABASE_URL`，看迁移日志 |
| `desktop:renderer` 失败 | 代码/依赖编译错误（blocking） | 看 Vite 报错堆栈，定位源码 |
| `desktop:package` 失败 + 标 external | 网络/Electron 下载失败（non-blocking） | 报告会标 `nonBlockingExternal`；联网或配代理后重跑 |
| `desktop:package` 失败 + 标 blocking | Forge 配置/代码错误 | 看 `output` 尾部，修 `forge.config.js` 或源码 |

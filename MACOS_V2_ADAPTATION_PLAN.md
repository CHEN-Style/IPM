# IPM V2 macOS 适配计划

> 基于 `origin/main`（V2，Windows 版）拉出的 `mac-v2` 分支进行适配。
> `main` 分支为 Windows 权威分支，受保护，本适配工作单向进行，绝不回流到 `main`。
> 旧 `mac` 分支（V1 适配）仅作历史参考清单，不做代码合并。

---

## 进度总览

| 阶段 | 状态 | 涉及文件 | 验证 |
|------|------|----------|------|
| **A. 构建与打包配置** | ✅ 代码已完成（A3 图标待 mac 本机） | `forge.config.js`、`package.json` | Windows `npm start` 通过；mac 待测 |
| **B. 主进程平台逻辑** | ✅ 代码已完成 | `src/main.js`、`package.json` | Windows `npm start` 通过；mac 待测 |
| **C. Agent / 后端** | ✅ 代码已完成 | `webclip.js`、`webFetch.js`、`envTools.js`、`localFolders.js`、`localExplorer.js` | 静态 lint 通过；mac 待测 |
| **D. UI 层** | ✅ 代码已完成 | `App.jsx`、`Sidebar.jsx`、`KnowClawBubble.jsx`、`FloatingMode.jsx`、`WabiBoardPage.jsx`、`AskUserCard.jsx`、`WorkspaceFileTree.jsx`、`KnowClawV2Page.jsx`、`SkillDetailModal.jsx`、`KnowledgeDetailPanel.jsx`、`index.html` 等 | 静态 lint 通过；mac 待测 |
| **F. 响应式设计（资料页）** | ✅ 第一轮代码已完成（F2 其他页面待审计） | `ProjectManager.jsx`、`SyncDrawer.jsx`、`HeaderBar.jsx`、`RootTable.jsx`、`EntryTable.jsx`、`AIGhostOverview.jsx`、`MyDataPage.jsx`、`FolderDetailPanel.jsx` | 静态 lint 通过；窄窗 / mac 待测 |

**分支**：`mac-v2`（自 `origin/main` 拉出）

**复原方式**：各阶段下方均记录「改动前 → 改动后」及涉及路径；可用 `git diff origin/main -- <file>` 查看完整 diff，或按各节「复原要点」逐项回退。

---

## 0. 背景与策略

- V2 相比 V1 是一次大重写（约 469 文件、+11.8 万行），新增了 KnowClaw、登录鉴权、企业控制台、云同步、悬浮 KnowClaw、系统托盘、启动 Splash、OCR 等大量功能。
- 旧 mac 分支改过的 22 个文件里，有 20 个被 V2 重度改动，**不能 merge**，只能在 V2 上重新落地。
- **重要利好**：V2 开发时已经把相当一部分平台逻辑写成跨平台（见 §5），实际需要改的面比 V1 时小。
- 适配分三类推进：**A 构建打包 → B 主进程平台逻辑 → C Agent/后端 → D UI 层**，最后是 **E 已跨平台（无需改）** 与 **F 响应式重做** 与 **G 验证清单**。

---

## A. 构建与打包配置

> 实施状态：代码改动已完成。`icon.icns` 生成与 mac 端 `npm install`/`npm start` 仍需在 mac 本机执行。

### A1. `desktop/forge.config.js`
V2 当前为 Windows 配置，需替换；本轮实际已完成如下：
- `packagerConfig`：
  - `icon: './assets/icon'` 保持（macOS 自动匹配 `.icns`）。
  - **实际保留** `asar: false`、`rebuild: false`、`rebuildConfig.onlyModules: []`。原因：V2 的 KnowClaw ESM 加载依赖 `asar:false`；原生模块 ABI 是否需要 Electron rebuild 由 mac 实测决定，先不盲改。
  - 新增 `appBundleId: 'com.ipm.app'`、`appCategoryType: 'public.app-category.productivity'`。
- `makers`：把 `maker-wix` / `maker-deb` / `maker-rpm` 替换为：
  - `@electron-forge/maker-dmg`（`{ name: 'IPM', format: 'ULFO' }`）
  - `@electron-forge/maker-zip`（`platforms: ['darwin']`，已存在可保留）
- `packageAfterCopy` 里的 **MinGit 复制逻辑**：mac 不需要（系统自带 bash）。vendor 目录在 mac 上不存在会自动跳过，**无需删除**，保留即可（opt-in，不阻断 mac 构建）。

实施记录：
- `makers` 已只保留 `@electron-forge/maker-dmg` 与 `@electron-forge/maker-zip`。
- `maker-wix` 的 `./assets/icon.ico` 引用与 WiX UTF-8 codepage 逻辑已随 Windows maker 一并移除。
- `packageAfterCopy`、OCR 模型复制、Agent 目录复制、MinGit 可选复制、`FusesPlugin`、`plugin-vite` 均保留。
- `FusesPlugin` 继续与 `asar:false` 匹配，避免 mac 双击启动时因 asar 完整性配置不一致而失败。

复原要点：
- 若要回退到 Windows 打包配置，恢复 `maker-wix`/`maker-deb`/`maker-rpm`，并移除 `appBundleId`/`appCategoryType` 即可；不要动 `packageAfterCopy` 和 Fuses，除非同时恢复完整 Windows 构建策略。

### A2. `desktop/package.json`
- `scripts.start`：`"chcp 65001 >nul & electron-forge start"` → `"electron-forge start"`（`chcp` 是 Windows 命令）。
- `devDependencies`：移除 `@electron-forge/maker-wix`、`@electron-forge/maker-deb`、`@electron-forge/maker-rpm`、`@electron-forge/maker-squirrel`；新增 `@electron-forge/maker-dmg`。
- `dependencies`：`electron-squirrel-startup` 在 A 阶段**暂不移除**，因为当时 `main.js` 仍有 import；实际移除放到 B1 同步完成。
- `scripts.setup:mingit` 可保留（mac 上不会调用，无害）。
- 注意 `postinstall` 的 `patch-onnxruntime.mjs` 必须保留（mac OCR 也依赖，见 §5）。

实施记录：
- `scripts.start` 已改为 `"electron-forge start"`。
- `devDependencies` 已移除 Windows/Linux maker，新增 `@electron-forge/maker-dmg`，保留 `maker-zip`。
- `electron-squirrel-startup` 的 `package.json` 运行时依赖在 B1 已移除；`package-lock.json` 仍需在 mac 上执行 `npm install` 后刷新。
- Windows 上 `npm start` 已验证可以启动；控制台中文日志可能因去掉 `chcp 65001` 出现乱码，这是 mac-only 分支的可接受副作用。

复原要点：
- 若要临时恢复 Windows 开发日志编码，只恢复 start 脚本即可；但这会重新引入 Windows 专用命令，不建议提交到 mac-only 分支。

### A3. 图标资源 `desktop/assets/`
- 在 mac 上用 `sips` + `iconutil` 从 1024×1024 的 `icon.png` 生成 `icon.icns`：
  ```bash
  cd desktop/assets
  mkdir icon.iconset
  sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
  # … 各尺寸 …
  sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
  iconutil -c icns icon.iconset -o icon.icns
  rm -rf icon.iconset
  ```
- **托盘图标**：见 B5，需要额外的 PNG（`.ico` 在 mac Tray 上无法正常显示）。

实施记录：
- 当前仓库已有 `desktop/assets/icon.png` 与 `desktop/assets/icon.ico`。
- `icon.icns` 未在当前 Windows 环境生成，需在 mac 本机用上方命令生成。
- `icon.ico` 暂保留，便于追溯旧 Windows 配置；B5 已把运行时托盘引用切到 `icon.png`。

---

## B. 主进程平台逻辑（`desktop/src/main.js`）

> V2 的 main.js 已被重度重构（含 Splash、Tray、Bubble 窗等新结构），改动需在新结构中定位，不能照搬旧 diff 行号。
> 实施状态：代码改动已完成。mac 端窗口外观、托盘、悬浮拖拽、缩略图协议仍需在 mac 本机验证。

### B1. 移除 electron-squirrel-startup
- 行 6：`import started from 'electron-squirrel-startup';` 删除。
- 启动处 `if (started) { app.quit(); }` 删除。
- `desktop/package.json` 中 `"electron-squirrel-startup": "^1.0.1"` 已删除。
- 注意：`package-lock.json` 仍保留旧锁定项，需在 mac 上执行 `npm install` 后刷新。

复原要点：
- 若回退 Windows Squirrel 安装器支持，需要同时恢复 `main.js` 的 import、启动判断、`package.json` 依赖，以及对应 maker 配置。

### B2. 主窗口标题栏（`createMainWindow`，约 1814-1838）
- `icon: '.../icon.ico'` → `icon.png`。
- `titleBarStyle: 'hidden'` + `titleBarOverlay: {...}` → `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: { x: 16, y: 12 }`。
- 保留 V2 新增的 `show: false` / `paintWhenInitiallyHidden: true`（Splash 交接逻辑），不要破坏。
- `Menu.setApplicationMenu(null)`（行 1840）→ 构建 macOS 原生菜单（关于/编辑/视图/窗口，参考旧 mac 分支模板，含 role: about/hide/quit/undo/redo/cut/copy/paste/selectAll 等）。

实施记录：
- 主窗口图标已切到 `assets/icon.png`。
- 标题栏已改为 `titleBarStyle: 'hiddenInset'`，并设置 `trafficLightPosition: { x: 16, y: 12 }`。
- 原 Windows `titleBarOverlay` 已删除。
- `Menu.setApplicationMenu(null)` 已替换为 `Menu.buildFromTemplate(menuTemplate)`，菜单包含：
  - 应用菜单：about、hide、hideOthers、unhide、quit。
  - 编辑：undo、redo、cut、copy、paste、pasteAndMatchStyle、delete、selectAll。
  - 视图：reload、forceReload、toggleDevTools、resetZoom、zoomIn、zoomOut、togglefullscreen。
  - 窗口：minimize、zoom、front、window。
- Splash 的 `show:false`、`paintWhenInitiallyHidden:true`、`ready-to-show` 交接逻辑保持不动。

验证/风险：
- Windows 上可启动，但会出现原生菜单栏和非 Windows 风格标题栏；这是 mac-only 分支的预期状态。
- D 部分 UI 还需配合调整顶部拖拽区和左上交通灯留白。

### B3. 悬浮窗（`createFloatingWindow`，约 1885-1921）
- 行 1905：`skipTaskbar: false` → `true`。
- 行 1913、1919：`setAlwaysOnTop(true, 'screen-saver')` → `'floating'`（修复 mac 下从访达拖文件被悬浮窗遮挡、无法放下的 bug）。

实施记录：
- `skipTaskbar` 已改为 `true`。
- 初始置顶和 blur 后重设均已改为 `setAlwaysOnTop(true, 'floating')`。
- 剪贴板 watcher、show/hide 复用逻辑、窗口尺寸和透明窗口设置均未改动。

验证重点：
- mac 上从访达拖文件到悬浮窗时，拖拽中的文件应处于悬浮窗上方，能完成 drop。

### B4. 气泡窗（`createBubbleWindow`，约 1967-1995，V2 新增）
- 行 1988：`setAlwaysOnTop(true, 'screen-saver')` → `'floating'`（同 B3 原因）。
- `FloatingInput.jsx:185` 有关于 screen-saver level 抢焦点的注释，改完后一并复核。

实施记录：
- 气泡窗 `setAlwaysOnTop(true, 'screen-saver')` 已改为 `'floating'`。
- `focusable:false`、`skipTaskbar:true`、`show:false`、`paintWhenInitiallyHidden:true` 保持不动。
- `FloatingInput.jsx` 注释复核留到 D/UI 文字与交互清理阶段，避免本阶段扩大范围。

### B5. 系统托盘（`createTray`，约 2058-2062，V2 新增）
- 行 2061：`icon.ico` → 专用托盘 PNG（建议 `assets/trayTemplate.png`，macOS 模板图标，黑色 + 透明，自动适配深浅色菜单栏）。
- 备选：直接用 `icon.png` 缩放版，但视觉上不如模板图标规范。

实施记录：
- 本轮采用备选方案：`icon.ico` 已改为 `icon.png`。
- 没有新增 `trayTemplate.png`，因为当前阶段图标资源先用占位符，避免额外资源制作。
- Tray 菜单行为（打开中台 / 打开悬浮窗 / 退出，单击切换）保持不动。

后续优化：
- 若 mac 菜单栏图标视觉不佳，再补 `assets/trayTemplate.png` 并设置模板图标。

### B6. 文件名清理（`sanitizeProjectName` / `sanitizeFileName`，约 174-191）
- 正则 `[<>:"/\\|?*]` → `[/:]`（macOS 仅禁 `/` 和 `:`）。
- 移除 `safe.replace(/[. ]+$/g, '')`（Windows 禁尾部点/空格的规则，mac 不需要）。

实施记录：
- `sanitizeProjectName` 与 `sanitizeFileName` 均已改成 `raw.replace(/[/:]/g, '_')`。
- 两处 Windows 尾部点/空格清理已删除。
- `..` 防穿越清理保留。
- 注释已更新为 macOS reserved characters。

验证重点：
- mac 上新建项目/案件/文件名时，中文、空格、尾部点应保留；`/` 与 `:` 应替换为 `_`。

### B7. 安全删除（`safeRmSync`，约 860-880）
- 移除 Windows 的 `EBUSY` 重试循环，简化为：先 `fs.rmSync`，失败且为 `EPERM/EACCES/ENOTEMPTY` 时 chmod + 短延时重试一次。
- 相关注释中 "Windows may throw EPERM/EBUSY…" 更新。

实施记录：
- `safeRmSync` 已简化为一次 `fs.rmSync`，若遇到 `EPERM` / `EACCES` / `ENOTEMPTY`，执行 `makeWritableRecursiveSync(targetPath)` + `sleepSync(120)` 后重试一次。
- `EBUSY` 已从删除重试条件移除。
- `trashOrRm` 行为保持 `shell.trashItem` 优先，注释改为 macOS 废纸篓/Finder 语境。
- 异步删除队列中的 Windows 语境注释已改成中性文件系统表述。

验证重点：
- 删除项目/案件/文件夹时优先进入废纸篓；硬删除兜底不应因只读文件直接失败。

### B8. `ipm-file` 协议处理（`protocol.handle('ipm-file', …)`）
- 移除 Windows 盘符处理：`if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1)` 与 `file:///` + 反斜杠替换，简化为 `net.fetch('file://' + filePath)`。
- 需在 V2 的 main.js 中重新定位该 handler（行号可能变化）。

实施记录：
- handler 已定位到当前 V2 的 `protocol.handle('ipm-file', ...)`。
- 现在逻辑为：`const filePath = decodeURIComponent(url.pathname); return net.fetch(\`file://${filePath}\`);`
- Windows 盘符剥离与反斜杠归一化已删除。

验证/风险：
- mac 的 POSIX 绝对路径应正常加载缩略图和本地文件资源。
- Windows 上 `C:\...` 盘符路径缩略图可能失败，这是 mac-only 分支的预期取舍。

### B9. 其余注释
- "fixed AppData location"（约行 73）等注释更新为 "Application Support directory"。

实施记录：
- bootstrap config 注释已从 fixed AppData location 改为 macOS Application Support directory。
- Splash 注释中 “in practice on Windows” 已改成中性表述。
- 与 `Explorer` import/模块名相关的代码未改动，因为那是模块命名，不是用户可见系统术语；UI 文案统一到 D 部分处理。

### B10. 本阶段验证记录
- 当前 Windows 测试机上 `npm start` 已验证可启动，说明 A/B 改动没有造成语法或启动级阻断。
- mac 上仍需执行：
  ```bash
  cd desktop
  npm install
  npm start
  ```
- mac 验证重点：
  - 主窗口交通灯位置与原生菜单。
  - 托盘图标与托盘菜单。
  - 悬浮窗/气泡窗置顶层级。
  - 从访达拖文件到悬浮窗。
  - 中文名项目/案件的新建与删除。
  - `ipm-file` 本地缩略图/资源加载。

---

## C. Agent / 后端

> 实施状态：代码改动已完成。本节原计划基于旧 supervisor 清单，实际在 V2 上做了重新收敛（见 C1）。所有运行时验证待 mac 设备到位后进行。

> 关键修正：旧计划 C1/C2 指向的 `desktop/Agent/supervisor/skills/scriptExecutor.js` 与 `desktop/Agent/supervisor/tools/fileTools.js` 在当前 V2 中**已不存在**（supervisor tree 在 V2 重构中被移除，能力迁移到 `Agent/shared/` 等位置）。因此不再按这两个路径修改，也不创建兼容文件。

### C1. 旧 supervisor 路径（V2 已移除，无需处理）
- 已确认 `desktop/Agent/supervisor/` 目录在 V2 不存在。
- 旧的 `resolvePythonBin`、`DANGEROUS_PATTERNS`、`findPython` 等实现随 supervisor tree 一并移除。
- 结论：不落地任何改动，仅在此归档说明。

### C2. 网页抓取 User-Agent（已完成）
两条抓取管道的 Windows UA 均已改为 macOS Chrome UA：
- `desktop/Agent/services/webclip.js`：HTTP + JSDOM fallback 管道，请求头 `User-Agent` 已更新。
- `desktop/Agent/services/webFetch.js`：V2 新增的 Electron BrowserWindow rendered 抓取服务，`CHROME_UA` 常量已更新（旧计划遗漏此文件，本轮纳入）。
- 统一 UA：`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`。
- fetch / rendered / fallback / Readability / Turndown 逻辑保持不动。

### C3. 环境探测工具（已完成）
`desktop/Agent/pi-runtime/tools/envTools.js`：
- `runCapture` 移除 `windowsHide: true`（Windows 专用语义），保留 `shell: true`。
- Python 解释器探测顺序由 `python` 优先改为 **`python3` 优先**，fallback `python`。
- pip 探测顺序由 `pip` 优先改为 **`pip3` 优先**，fallback `pip`。
- `probePythonPackage` 内部循环改为 `['python3', 'python']`。
- 清理 Windows/cmd.exe 相关注释为跨 POSIX shell 表述。
- 风险记录：若某 mac 用户把 `python` 指向特定虚拟环境，`python3` 优先可能改变探测命中；macOS 原生更依赖 `python3`，方向符合 mac-v2。

### C4. web-artifacts builder 脚本（已复核，无需改动）
`desktop/Agent/pi-runtime/skills/web-artifacts-builder/scripts/{init-artifact,bundle-artifact}.js`：
- `useShell = process.platform === 'win32'` 仅在 Windows 为 `.cmd` shim 启用 shell；mac 上 `useShell=false`，直接调用 `npx`/`tar`/`pnpm`，行为正确。
- 脚本本身即为替代 bash/sed 的跨平台 Node 实现。
- 结论：保持不动。

### C5. 本地文件夹遗留模块（已完成）
`desktop/src/main/modules/localFolders.js`：
- `normalizeAbsDirPath`：根判断改为 `abs === '/'`（POSIX 根），尾部清理改为 `/\/+$/`（不再把反斜杠当分隔符）。
- 新增 `pathKey(abs)`：仅 win32 下 `toLowerCase()`，mac 保留原始大小写（兼容大小写敏感卷）。
- `getLocalFolderPathsFromState` 去重、`localFolders/import` 与 `localFolders/remove` 比较均改用 `pathKey()`。
- `getFolderDisplayName`：对 `/` 返回 `/`，其余 `path.basename`。
- 保留该模块 deprecated 兼容定位，未扩大功能。

### C6. localExplorer 白名单路径（已完成，旧计划未覆盖）
`desktop/src/main/modules/localExplorer.js`：
- 与 localFolders 同步：`normalizeAbsDirPath` 改 POSIX 根 + 仅清理 `/`，新增 `pathKey`。
- `getAllowedRoots` 去重、`assertRootAllowedOrThrow` 白名单比较改用 `pathKey()`。
- `normalizeRelPathPosix` 不动（renderer↔IPC 以 POSIX 相对路径为协议格式，反斜杠转 `/` 在该层仍合理）。

### C7. 确认不改的已跨平台项
- `desktop/src/main/ipc/knowclaw.js`：非 win32 直接短路到 `/bin/bash`（mac 用户无需安装 Git Bash / MinGit）。
- `desktop/Agent/pi-runtime/promptBuilder.js`：已有 `darwin` 环境说明分支。
- `desktop/Agent/services/ocrService.js`：Windows pathname 修正在 `process.platform === 'win32'` guard 内，mac 不受影响。
- `desktop/Agent/pi-runtime/tools/delegateTool.js`：路径大小写比较仅 win32 小写，mac 保留大小写。
- `desktop/Agent/pi-runtime/tools/installGuard.js`：已含 Homebrew 系统级安装拦截提示；Windows 包管理器提示保留无害。

### C-验证
- 静态：`ReadLints` 对全部改动文件无报错。
- mac 到位后验证：
  - `check_environment` 返回 `python3`/`pip3`/`bash` 状态符合预期。
  - 网页剪藏与网页抓取 rendered/fallback 两条路径可抓取常见中文网页与 SPA。
  - KnowClaw web-artifacts 初始化与打包跑通 `npx --yes pnpm`、`tar`、`parcel build`、`html-inline`。
  - 历史本地文件夹 list/remove/浏览白名单在 `/Users/...`、`/Volumes/...`、`/` 下正常。

---

## D. UI 层

> 范围边界：本阶段只做 macOS 平台 UI 适配（标题栏拖拽区、交通灯留白、快捷键文案、访达/废纸篓术语、代码字体）。资料页响应式问题不在 D 处理，保留到 F 专项，避免平台适配与布局重构混在一起。不纳入 D 的响应式文件：`project-manager/HeaderBar.jsx`、`project-manager/RootTable.jsx`、`project-manager/EntryTable.jsx`、`MyDataPage.jsx`。

### D1. 标题栏拖拽区 `desktop/src/ui/App.jsx`（约 316-333）
- V2 当前：`className="h-[36px] … flex items-center justify-end pr-[140px]"`，右侧留给 Windows 窗口控制按钮。
- mac：交通灯在左上角，需调整为 `h-[40px]`，去掉右侧 `pr-[140px]` 的布局（或改为左侧留白），参考旧 mac 分支思路（交通灯位置由 Sidebar 顶部 padding 让位）。

实施记录：
- 拖拽区 className 由 `h-[36px] shrink-0 w-full flex items-center justify-end pr-[140px]` 改为 `h-[40px] shrink-0 w-full flex items-center justify-end px-4`：去掉 Windows caption controls 留白，macOS 无右侧窗口控制。
- 注释更新为 macOS hiddenInset 标题栏拖拽区语境，说明交通灯在左上角、由 Sidebar 顶部 padding 让位。
- 悬浮按钮 `title="切换到悬浮窗 (Ctrl+Shift+Space)"` → `(⌘⇧Space)`。
- 保留 `WebkitAppRegion: 'drag'` 与按钮的 `no-drag`，不改交互逻辑。

### D2. 侧边栏 `desktop/src/ui/components/Sidebar.jsx`
- 行 285：`pt-[42px]` → `pt-[48px]`（给左上交通灯让位）。
- 行 477：`title="搜索 (Ctrl+K)"` → `(⌘K)`。
- 行 572：`title="切换到悬浮窗 (Ctrl+Shift+Space)"` → `(⌘⇧Space)`（或 `⌃⇧Space`，取决于全局快捷键，见说明）。

实施记录：
- 顶部 Logo / workspace 区两处 `pt-[42px]` → `pt-[48px]`（折叠/展开两种 className 同时调整），给左上交通灯更充足留白。
- 顶部区域注释更新为 macOS traffic lights + 拖拽区语境。
- `title="搜索 (Ctrl+K)"` → `(⌘K)`；`title="切换到悬浮窗 (Ctrl+Shift+Space)"` → `(⌘⇧Space)`。
- 展开态搜索框内已有 `Command` 图标 + `K` 标识，保持不动。

### D3. 快捷键文案（全局替换 Ctrl→⌘/⇧⌘）
- `desktop/src/ui/App.jsx:332`：`(Ctrl+Shift+Space)`。
- `desktop/src/ui/components/KnowClawBubble.jsx:22`：`💡 Ctrl+K …` → `⌘K`。
- `desktop/src/ui/components/knowledge/WabiBoardPage.jsx`：行 364 `Ctrl + A`、373 `Ctrl + L`、418 `Ctrl + Z / Ctrl + Shift + Z`、1348 `(Ctrl+Z)`、1364 `(Ctrl+Shift+Z)`。
- `desktop/src/ui/components/floating/FloatingMode.jsx:365`：`(Esc / Ctrl+Shift+Space)`。
- **注意**：全局快捷键主进程注册的是 `CommandOrControl+Shift+Space`（main.js:2612），在 mac 上即 `⌘⇧Space`。文案需与之一致。请逐一确认每个快捷键对应键位后再改文案，避免文案与实际不符。

实施记录：
- `KnowClawBubble.jsx`：提示 `💡 Ctrl+K …` → `💡 ⌘K …`。
- `FloatingMode.jsx`：`title="回到中台 (Esc / Ctrl+Shift+Space)"` → `(Esc / ⌘⇧Space)`。
- `WabiBoardPage.jsx`：帮助面板 `全选 Ctrl + A` → `⌘ + A`、`锁定/解锁 Ctrl + L` → `⌘ + L`、`撤回/重做 Ctrl + Z / Ctrl + Shift + Z` → `⌘ + Z / ⌘ + Shift + Z`；工具栏 `title="撤回 (Ctrl+Z)"` → `(⌘Z)`、`title="重做 (Ctrl+Shift+Z)"` → `(⌘⇧Z)`。
- `AskUserCard.jsx`：输入框 placeholder `（Ctrl/⌘+Enter 提交）` → `（⌘+Enter 提交）`。
- 仅改文案，不改快捷键逻辑：`App.jsx`、`BoardCanvas.jsx` 已支持 `metaKey`，主进程全局快捷键仍是 `CommandOrControl+Shift+Space`，与文案一致。

### D4. "资源管理器" / "回收站" 术语
- `desktop/src/ui/components/knowclaw-v2/WorkspaceFileTree.jsx`：行 31 注释、557、585、588 "在资源管理器中打开"。
- `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`：行 1244、1253、1267、1276、1532、1567、1570 "文件资源管理器"。
- `desktop/src/ui/components/knowledge/KnowledgeDetailPanel.jsx:86`："移到回收站"。
- 统一改为 "访达"。注意：打开文件管理器的主进程实现（`shell.openPath`/`shell.showItemInFolder`）本身跨平台，仅改文案。

实施记录：
- `WorkspaceFileTree.jsx`：注释及按钮 "在资源管理器中打开" → "在访达中打开"；500 项上限提示中的 "访问资源管理器" → "访问访达"。
- `KnowClawV2Page.jsx`：7 处 "文件资源管理器" 全部 → "访达"。
- `SkillDetailModal.jsx`：`title` / `aria-label` "在文件管理器中打开" → "在访达中打开"。
- `KnowledgeDetailPanel.jsx`：删除截图确认文案 "移到回收站" → "移到废纸篓"。
- `KnowClawBubble.jsx`：提示中 "打开 Explorer 视图" → "打开文件视图"（指应用内部视图，非系统访达）。
- `KnowClawV2Page.jsx` bash 缺失横幅：由 "Windows 用户请安装 Git for Windows" 改为 macOS 兜底说明（macOS 通常自带 `/bin/bash`；如仍提示请检查系统 bash 或运行 `xcode-select --install` 后点击「立即重新检测」）；相关注释中 "install Git for Windows" 等表述一并改为平台中立的 "fix bash toolchain"。
- 不改内部 API / 组件名：`openInExplorer`、`localExplorer`、`ExplorerTree`、`Trash2` 等非用户可见文案保持不动。

### D5. 代码块字体 `desktop/index.html`
- `.prose-chat code` 的 `font-family`：`'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace` → `'SF Mono', 'Menlo', 'Fira Code', monospace`。

实施记录：
- `index.html` `.prose-chat code` 字体改为 `'SF Mono', Menlo, Monaco, ui-monospace, monospace`（macOS 优先，去掉 Windows 的 Cascadia Code / Consolas fallback）。
- 附加清理：`CloudProjectsPage.jsx`、`SyncDrawer.jsx`、`EnterpriseConfigView.jsx`、`EnterpriseConsolePage.jsx`、`EnterpriseWorkspacesView.jsx` 中以 `SF Mono` / `ui-monospace` 开头、末尾含 `Consolas` 的等宽字体栈，将 `Consolas` fallback 统一替换为 `Menlo`，仅改样式 fallback，不动布局与业务逻辑。

### D-验证
- 已对全部改动文件执行 `ReadLints`，无新增报错。
- 当前无 mac 设备，UI 正确性以 macOS 为准，待机到位后验证：
  - 左上交通灯不遮挡 Sidebar logo / 工作区按钮；顶部拖拽区与侧栏顶部空白可拖动窗口；标题栏悬浮按钮、侧栏搜索、工作区菜单可点击不被拖拽区吞掉。
  - Tooltip / 帮助面板显示 `⌘` 文案；访达 / 废纸篓文案正确。
  - `⌘K`、`⌘⇧Space`、`⌘A`、`⌘L`、`⌘Z` 实际行为与文案一致。

---

## E. 已是跨平台 / 无需改动（避免重复劳动）

V2 开发时已正确处理，**确认即可，不要改**：
- **KnowClaw bash 解析** `src/main/ipc/knowclaw.js:558`：非 win32 已短路到 `/bin/bash`（source: system）。
- **AI 环境提示** `Agent/pi-runtime/promptBuilder.js:62`：已有 `darwin` 分支。
- **OCR** `scripts/patch-onnxruntime.mjs` + `ocrService.js`：用 onnxruntime-web（WASM）跨平台；`ocrService.js:82` 的 win32 路径归一化已正确 guard，mac 走原始路径。
- **全局快捷键** `main.js:2612`：`CommandOrControl+Shift+Space` 跨平台。
- **悬浮窗跳过任务栏判断** `src/main/ipc/ui.js:30`：`process.platform === 'darwin'` 已处理。
- **路径大小写比较** `skillPackage.js` / `delegateTool.js` / `skills.js`：仅 win32 才 toLowerCase，mac（APFS 大小写不敏感但保留大小写）走原始路径，正确。
- **MinGit 打包** `forge.config.js` packageAfterCopy + `setup-mingit.mjs`：opt-in，mac 无 vendor/MinGit 时自动跳过，不阻断构建。

---

## F. 响应式设计（资料页专项，已完成第一轮）

V1 时做过的响应式改造（RootTable/EntryTable/HeaderBar/MyDataPage）已对应 V1 旧组件结构，V2 重写了这些组件，旧 diff 失效，本轮在 V2 组件上重做。

> 范围边界：本轮 F 只覆盖资料页及其直接链路（资料首页 / 项目管理外层 / Header / 根列表 / 文件列表 / AI 暂存区概览 / 详情抽屉与相关弹窗）。登录页、企业控制台、KnowClaw V2 页、悬浮 KnowClaw 等留到 F2 单独审计，避免一次改动跨太多业务面。
>
> 统一原则：用组件内 `ResizeObserver` 做"容器感知"响应式（资料区会被左侧导航树和云同步抽屉挤压，纯 viewport media query 不准）；只调整布局呈现，不动 IPC / 拖拽 / 上传 / AI 分类 / 云同步等业务逻辑；table→card 仅在窄宽启用，桌面宽窗体验保持原状。

### F1. 项目管理外层 `desktop/src/ui/components/ProjectManager.jsx` + 云同步抽屉 `cloud-projects/SyncDrawer.jsx`
- 新增整页 `pageRef` 与主列 `mainColRef` 双宽度观测，统一驱动布局决策（替换原来只在"抽屉打开"时生效的单一 `mainColNarrow` 布尔）。
- `pageW < 900` 时云同步抽屉切换为浮层（overlay）模式：`SyncDrawer` 新增 `overlay` 属性，narrow 时面板绝对定位 + 背景遮罩浮在内容之上（宽度 `min(372px, calc(100vw-40px))`），不再作为 flex 兄弟把文件列表挤爆。
- `mainColW < 560` 时自动收起左侧 `ExplorerTree`，且不写回用户持久化的 `navPaneOpen`。
- 导航树宽度仍可拖拽，但用 `effectiveNavWidth = clamp(navPaneWidth, NAV_MIN, mainColW-240)` 收敛，保证文件列表有可用最小宽度。

### F2. 顶部工具栏 `desktop/src/ui/components/project-manager/HeaderBar.jsx`
- Row 2 操作区加 `gap-y-2`，按钮换行后纵向有间距。
- 项目内搜索框由固定 `w-36 focus:w-48 shrink-0` 改为可收缩 `shrink min-w-[120px] max-w-[200px]` + 输入框 `w-full sm:w-36 sm:focus:w-48`，窄宽下不再撑破整行。
- 搜索结果下拉加 `max-w-[calc(100vw-32px)]` 兜底，避免窄窗溢出。

### F3. 根列表 `desktop/src/ui/components/project-manager/RootTable.jsx`
- 引入容器宽度观测，`< 720` 切换为卡片布局；宽屏保留原 table。
- 抽取共享片段 `NameCell / StatusControl / ActionButtons`，table 与卡片复用，避免逻辑分叉。
- 状态分段控件加 `max-w-full overflow-x-auto no-scrollbar`，窄宽下可横向滚动不撑破；卡片态操作按钮显示完整文案（`showLabels`），table 态窄宽仍按 `hidden xl:inline` 折叠为图标。
- 保留点击进入、右键菜单、状态切换、知识管理 / 偏好入口等行为。

### F4. 文件列表 `desktop/src/ui/components/project-manager/EntryTable.jsx`
- 在原 `compact < 660` / `narrow < 500`（列隐藏）基础上新增 `card < 440`：极窄时整行改为堆叠卡片（名称 / 元信息 / 操作分三段），ghost 行的"接受 / 放弃 / 过程"按钮 `flex-wrap` 换行，不再挤在 80px 详情列里。
- 抽取共享片段 `IconBox / NameBlock / ActionContent` 与 `interactiveProps(e)`，table 行与卡片复用同一套拖拽 / 右键 / 双击 / 进入目录处理，保证行为一致。

### F5. AI 暂存区概览 `desktop/src/ui/components/project-manager/AIGhostOverview.jsx`
- 新增容器宽度观测，`< 560` 时把固定四列网格 `minmax(0,1.1fr)_92px_120px_112px` 收敛为两列 `minmax(0,1fr)_auto`。
- 窄宽下"建议数 / 状态 / temp / 置信度"折叠进左侧文件夹 / 文件信息区，右侧只保留操作按钮，避免首列被压扁。

### F6. 资料首页 `desktop/src/ui/components/MyDataPage.jsx`
- 外层 padding `px-8 xl:px-10` → `px-4 sm:px-6 xl:px-10`。
- 顶部问候 / 操作区 `flex-wrap`，窄宽下按钮落到第二行。
- 数据概览 `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`；迷你图图例 `flex-wrap`。

### F7. 固定宽度抽屉 / 弹窗兜底
- `project-manager/FolderDetailPanel.jsx`：详情抽屉 `w-[360px]` → `w-[min(360px,calc(100vw-32px))]`。
- `ProjectManager.jsx`：新建文件夹 / 重命名 `w-[420px]`、模板选择 / 重命名工作区 `w-[520px]` 改为 `w-[calc(100vw-32px)] max-w-[420px/520px]`；模板选择卡片网格 `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`。

### F-验证
- 已对全部改动文件执行 `ReadLints`，无新增报错。
- 当前 Windows 仅能做静态检查；mac / 窄窗到位后重点验证：480px / 640px / 800px 三档宽度，云同步抽屉打开（浮层 vs 挤压），导航树自动收起 / 手动开关，AI 分类概览展开，ghost 操作行换行，弹窗在窄窗不溢出。

### F2（后续）待审计页面
- 登录页、企业控制台（Config / Console / Workspaces）、KnowClaw V2 页、悬浮 KnowClaw、知识看板等仍需单独检查窄 / 小窗口响应式。

---

## G. 验证清单（适配后）

1. `npm install`（mac 上重新拉取 darwin 原生模块：better-sqlite3、sharp、canvas、clipboard、onnxruntime 等）。
2. `npm start` 启动：
   - 主窗口标题栏交通灯位置正确、原生菜单可用。
   - 悬浮窗 / 气泡窗显示正常，从访达拖文件可放入悬浮窗。
   - 系统托盘图标显示与右键菜单可用。
   - 全局快捷键 ⌘⇧Space 切换中台/悬浮。
3. 功能验证：
   - 新建/删除项目、案件（文件夹增删、中文名）。
   - 文件上传、AI 分类、知识管理。
   - KnowClaw：bash 工具可用（mac 自带 `/bin/bash`），Skill 执行、python 脚本执行。
   - OCR 截图识别。
   - 网页剪藏（webclip）。
4. `npm run make` 打包出 DMG + ZIP。
5. 跨 Mac 安装验证：另一台 mac 安装后执行 `xattr -cr /Applications/IPM.app` 解除隔离（无开发者签名时的已知步骤）。

---

## H. 剩余收尾与验证记录（R 系列）

> A/B/C/D/F 第一轮完成后，对 `desktop` 全量复审发现的遗漏与清理项。代码项已在 Windows 上落地并通过 `ReadLints`；真机 / 打包项仍待 mac 本机执行。

### H1. 已完成（代码 / lockfile）

- **R1.1 同步 `desktop/package-lock.json`**：`package.json` 早先已移除 `electron-squirrel-startup`，但 lockfile 顶层仍残留 `electron-squirrel-startup@^1.0.1`。在 `desktop` 下执行 `npm install --package-lock-only` 重新生成，已确认 lockfile 中不再出现该依赖（避免 mac 上 `npm ci` 与 manifest 不一致而失败）。
- **R1.2 删除失败提示去 Windows 化**：`src/main/ipc/projects.js`、`src/main/ipc/cases.js` 删除项目/案件失败时的用户可见错误，原第 3 条「Windows资源管理器正在访问该文件夹」改为「访达或其他程序正在访问该文件夹」。仅改文案，删除逻辑未动。
- **R2.1 MinGit 打包 Windows guard**：`forge.config.js` 的 `packageAfterCopy` 中，复制 `vendor/MinGit/` 的判定加上 `process.platform === 'win32'` 前置条件 —— mac/Linux 打包即使本地残留 `vendor/MinGit/` 也不会把 Windows `bash.exe` 打进包（mac 走系统 `/bin/bash`）。同时把「未找到 MinGit」的日志拆分为 win32 提示 `setup:mingit` / 非 win32 提示「使用系统 /bin/bash」。`scripts/setup:mingit` 脚本保留作 Windows 历史兼容。
- **R2.2 注释 / 日志去 Windows 化**：
  - `src/main.js`：全局快捷键相关注释与 `globalShortcut` 注册失败的 `console.warn` 由 `Ctrl+Shift+Space` 改为 `⌘⇧Space`（CommandOrControl+Shift+Space）。
  - `src/ui/components/ProjectManager.jsx`、`project-manager/HeaderBar.jsx`：`Windows-explorer style` 注释改为 `file-browser style`。
  - `src/ui/components/floating-knowclaw/FloatingInput.jsx`：`setAlwaysOnTop's screen-saver level` 失效注释改为 `floating level`（与 B3/B4 实际改动一致）。
- **R2.3 Skill 文档术语**：`Agent/pi-runtime/skills/web-artifacts-builder/SKILL.md` 把用户可见的「在文件管理器中打开工作空间」改为「在访达中打开工作空间」。该文档内的 Windows Node 安装建议属跨平台说明，按计划保留。

### H2. 待 mac 本机执行（不可在 Windows 替代）

- **R4 开发启动 / 功能验证**：mac 上 `cd IPM/desktop && npm install && npm start`，逐项核对主窗口、原生菜单、交通灯不遮挡 Sidebar、顶部拖拽区、`⌘⇧Space` 切换、悬浮窗从访达拖入文件、新建/重命名/删除、AI 分类、本地打开/在访达打开/删到废纸篓、KnowClaw `/bin/bash` 与 Skill、截图授权、OCR/剪藏、资料页窄窗响应式。
- **R5 图标与打包**：mac 上用 `sips` + `iconutil` 生成 `desktop/assets/icon.icns`；`npm run make` 产出 DMG + ZIP；本机安装可开；另一台 mac 安装如提示「已损坏」，执行 `xattr -cr /Applications/IPM.app`。
- **R3 / F2 响应式专项（已完成第一批，代码层）**：对资料页之外页面做了只读审计并实施了低/中风险纯布局修复，已通过 `ReadLints`：
  - **登录页** `auth/LoginPage.jsx`：表单卡片 `w-[360px]` → `w-full max-w-[360px] px-4`。
  - **企业控制台**：
    - `enterprise/shared.jsx` 的通用 `Modal`：`width` 改为 `width:100% / maxWidth:width` 并加 `mx-4`，一处修复所有企业弹窗在窄窗溢出。
    - `EnterpriseConsolePage.jsx`：页容器水平 padding 改 `clamp(12px,4vw,36px)`；顶部 5 Tab 导航 `overflow-x-auto`+`shrink-0`；统计卡 / 工具栏 `flex-wrap`；搜索框 `220px` → `flex-1 max-w-[220px]`；成员表 `overflow-x-auto`+`min-w-[580px]`；邀请码行 `flex-wrap`。
    - `EnterpriseConfigView.jsx` / `EnterpriseWorkspacesView.jsx` / `EnterpriseSkillsView.jsx`：统计卡 / 工具栏 `flex-wrap`、搜索框去固定宽、表格 `overflow-x-auto`+`min-w`、过滤 Tab `overflow-x-auto`+`shrink-0`；右侧详情抽屉 `width:480/560` → `w-[min(480/560px,calc(100vw-32px))]`（避免 480px 视口下抽屉占满、遮罩不可点）。
    - `EnterpriseOverviewView.jsx`：两行统计卡 `flex-wrap`。
  - **KnowClaw V2**：`knowclaw-v2/WorkspaceFileTree.jsx` 右侧文件树 `w-72` → `w-[min(288px,40vw)]`（窄窗不再挤垮聊天列）；`KnowClawV2Page.jsx` 工作区下拉 `w-72` 加 `max-w-[calc(100vw-24px)]`。
  - **知识看板 / 详情**：`knowledge/WabiBoardPage.jsx` 四个弹窗 `width:520/440/420` → `min(…px,calc(100vw-32px))`；`knowledge/KnowledgeDetailPanel.jsx` 侧拉面板 `w-[440px]` → `w-[min(440px,calc(100vw-24px))]`，webclip 网格 `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`。
  - **云同步弹窗**：`cloud-projects/SyncPreviewModal.jsx` `w-[560px]` → `w-[min(560px,calc(100vw-32px))]`；`cloud-projects/MilestoneModal.jsx` `w-[440px]` → `w-[min(440px,calc(100vw-32px))]`（`FileHistoryRestoreModal.jsx`、`SkillDetailModal.jsx`、`AskUserCard.jsx` 经审计已自带 viewport 约束，无需改）。
  - 余下（`KnowClawV2Page` header tier 阈值、看板头部按钮密度等）属逻辑/中风险项，留待 mac 真机 480 / 640 / 800px 验证后再决定是否进一步处理。

---

## 附：旧 mac 分支参考清单（V1 适配的文件）

平台逻辑类（意图稳定，可参考重做）：`main.js`、`scriptExecutor.js`、`fileTools.js`、`webclip.js`、`localFolders.js`、`ipc/{cases,projects,explorer}.js`、`forge.config.js`、`package.json`、`index.html`。

UI 类（V2 已重写，仅作"当初改了哪些点"的线索）：`App.jsx`、`Sidebar.jsx`、`SupervisorBubble.jsx`、`WabiBoardPage.jsx`、`MyDataPage.jsx`、`HeaderBar.jsx`、`RootTable.jsx`、`EntryTable.jsx`。

> 查看旧适配 diff：`git diff <merge-base> mac -- <file>`，其中 merge-base = `e0da71a`。

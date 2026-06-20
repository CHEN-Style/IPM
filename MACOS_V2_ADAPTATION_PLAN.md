# IPM V2 macOS 适配计划

> 基于 `origin/main`（V2，Windows 版）拉出的 `mac-v2` 分支进行适配。
> `main` 分支为 Windows 权威分支，受保护，本适配工作单向进行，绝不回流到 `main`。
> 旧 `mac` 分支（V1 适配）仅作历史参考清单，不做代码合并。

---

## 0. 背景与策略

- V2 相比 V1 是一次大重写（约 469 文件、+11.8 万行），新增了 KnowClaw、登录鉴权、企业控制台、云同步、悬浮 KnowClaw、系统托盘、启动 Splash、OCR 等大量功能。
- 旧 mac 分支改过的 22 个文件里，有 20 个被 V2 重度改动，**不能 merge**，只能在 V2 上重新落地。
- **重要利好**：V2 开发时已经把相当一部分平台逻辑写成跨平台（见 §5），实际需要改的面比 V1 时小。
- 适配分三类推进：**A 构建打包 → B 主进程平台逻辑 → C Agent/后端 → D UI 层**，最后是 **E 已跨平台（无需改）** 与 **F 响应式重做** 与 **G 验证清单**。

---

## A. 构建与打包配置

### A1. `desktop/forge.config.js`
V2 当前为 Windows 配置，需替换：
- `packagerConfig`：
  - `icon: './assets/icon'` 保持（macOS 自动匹配 `.icns`）。
  - 移除 `rebuild: false` 和 `rebuildConfig.onlyModules: []`（允许原生模块为 mac 重新编译）。
  - 新增 `appBundleId: 'com.ipm.app'`、`appCategoryType: 'public.app-category.productivity'`。
- `makers`：把 `maker-wix` / `maker-deb` / `maker-rpm` 替换为：
  - `@electron-forge/maker-dmg`（`{ name: 'IPM', format: 'ULFO' }`）
  - `@electron-forge/maker-zip`（`platforms: ['darwin']`，已存在可保留）
- `packageAfterCopy` 里的 **MinGit 复制逻辑**：mac 不需要（系统自带 bash）。vendor 目录在 mac 上不存在会自动跳过，**无需删除**，保留即可（opt-in，不阻断 mac 构建）。

### A2. `desktop/package.json`
- `scripts.start`：`"chcp 65001 >nul & electron-forge start"` → `"electron-forge start"`（`chcp` 是 Windows 命令）。
- `devDependencies`：移除 `@electron-forge/maker-wix`、`@electron-forge/maker-deb`、`@electron-forge/maker-rpm`、`@electron-forge/maker-squirrel`；新增 `@electron-forge/maker-dmg`。
- `dependencies`：移除 `electron-squirrel-startup`。
- `scripts.setup:mingit` 可保留（mac 上不会调用，无害）。
- 注意 `postinstall` 的 `patch-onnxruntime.mjs` 必须保留（mac OCR 也依赖，见 §5）。

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

---

## B. 主进程平台逻辑（`desktop/src/main.js`）

> V2 的 main.js 已被重度重构（含 Splash、Tray、Bubble 窗等新结构），改动需在新结构中定位，不能照搬旧 diff 行号。

### B1. 移除 electron-squirrel-startup
- 行 6：`import started from 'electron-squirrel-startup';` 删除。
- 启动处 `if (started) { app.quit(); }` 删除。

### B2. 主窗口标题栏（`createMainWindow`，约 1814-1838）
- `icon: '.../icon.ico'` → `icon.png`。
- `titleBarStyle: 'hidden'` + `titleBarOverlay: {...}` → `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: { x: 16, y: 12 }`。
- 保留 V2 新增的 `show: false` / `paintWhenInitiallyHidden: true`（Splash 交接逻辑），不要破坏。
- `Menu.setApplicationMenu(null)`（行 1840）→ 构建 macOS 原生菜单（关于/编辑/视图/窗口，参考旧 mac 分支模板，含 role: about/hide/quit/undo/redo/cut/copy/paste/selectAll 等）。

### B3. 悬浮窗（`createFloatingWindow`，约 1885-1921）
- 行 1905：`skipTaskbar: false` → `true`。
- 行 1913、1919：`setAlwaysOnTop(true, 'screen-saver')` → `'floating'`（修复 mac 下从访达拖文件被悬浮窗遮挡、无法放下的 bug）。

### B4. 气泡窗（`createBubbleWindow`，约 1967-1995，V2 新增）
- 行 1988：`setAlwaysOnTop(true, 'screen-saver')` → `'floating'`（同 B3 原因）。
- `FloatingInput.jsx:185` 有关于 screen-saver level 抢焦点的注释，改完后一并复核。

### B5. 系统托盘（`createTray`，约 2058-2062，V2 新增）
- 行 2061：`icon.ico` → 专用托盘 PNG（建议 `assets/trayTemplate.png`，macOS 模板图标，黑色 + 透明，自动适配深浅色菜单栏）。
- 备选：直接用 `icon.png` 缩放版，但视觉上不如模板图标规范。

### B6. 文件名清理（`sanitizeProjectName` / `sanitizeFileName`，约 174-191）
- 正则 `[<>:"/\\|?*]` → `[/:]`（macOS 仅禁 `/` 和 `:`）。
- 移除 `safe.replace(/[. ]+$/g, '')`（Windows 禁尾部点/空格的规则，mac 不需要）。

### B7. 安全删除（`safeRmSync`，约 860-880）
- 移除 Windows 的 `EBUSY` 重试循环，简化为：先 `fs.rmSync`，失败且为 `EPERM/EACCES/ENOTEMPTY` 时 chmod + 短延时重试一次。
- 相关注释中 "Windows may throw EPERM/EBUSY…" 更新。

### B8. `ipm-file` 协议处理（`protocol.handle('ipm-file', …)`）
- 移除 Windows 盘符处理：`if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1)` 与 `file:///` + 反斜杠替换，简化为 `net.fetch('file://' + filePath)`。
- 需在 V2 的 main.js 中重新定位该 handler（行号可能变化）。

### B9. 其余注释
- "fixed AppData location"（约行 73）等注释更新为 "Application Support directory"。

---

## C. Agent / 后端

### C1. `desktop/Agent/supervisor/skills/scriptExecutor.js`
- `resolvePythonBin`：移除 `python.exe` 路径，embedded 走 `runtime/python/bin/python3`，fallback 直接 `python3`。
- `DANGEROUS_PATTERNS`：去掉 `format [a-z]:`、`del /sq` 等 Windows cmd 模式，增加 `sudo rm`、`diskutil erase`。
- env：`HOME` 去掉 `USERPROFILE` fallback；`TEMP`/`TMP` → `TMPDIR`；删除 `windowsHide: true`。

### C2. `desktop/Agent/supervisor/tools/fileTools.js`
- `findPython`：候选从 `process.platform === 'win32' ? ['python','python3','py'] : [...]` 简化为 `['python3', 'python']`。

### C3. `desktop/Agent/services/webclip.js`
- `User-Agent` 从 `Windows NT 10.0` 改为 `Macintosh; Intel Mac OS X 10_15_7`。

### C4. `desktop/Agent/pi-runtime/tools/envTools.js`（V2 新增，需复核）
- 含 `windowsHide: true`（行 56）和 cmd.exe 引号注释。mac 上 `windowsHide` 是无害空操作，**可不改**；仅在确有问题时处理。

### C5. `desktop/Agent/pi-runtime/skills/web-artifacts-builder/scripts/*.js`（V2 新增）
- `useShell = process.platform === 'win32'`（npm/pnpm/npx 的 .cmd shim 处理）。mac 上 `useShell=false`，行为正确，**无需改动**。

### C6. `desktop/src/main/modules/localFolders.js`
- `normalizeAbsDirPath`（行 32-37）与 `getFolderDisplayName`（行 63）仍用 `path.parse(abs).root` 保留盘符根 `C:\`。
- 改为 mac 风格：根判断用 `abs === '/'`，尾部斜杠清理用 `/\/+$/`。
- 注：该模块为兼容旧用户的遗留模块（import 前端已不触发），优先级较低，但为正确性建议一并改。

---

## D. UI 层

### D1. 标题栏拖拽区 `desktop/src/ui/App.jsx`（约 316-333）
- V2 当前：`className="h-[36px] … flex items-center justify-end pr-[140px]"`，右侧留给 Windows 窗口控制按钮。
- mac：交通灯在左上角，需调整为 `h-[40px]`，去掉右侧 `pr-[140px]` 的布局（或改为左侧留白），参考旧 mac 分支思路（交通灯位置由 Sidebar 顶部 padding 让位）。

### D2. 侧边栏 `desktop/src/ui/components/Sidebar.jsx`
- 行 285：`pt-[42px]` → `pt-[48px]`（给左上交通灯让位）。
- 行 477：`title="搜索 (Ctrl+K)"` → `(⌘K)`。
- 行 572：`title="切换到悬浮窗 (Ctrl+Shift+Space)"` → `(⌘⇧Space)`（或 `⌃⇧Space`，取决于全局快捷键，见说明）。

### D3. 快捷键文案（全局替换 Ctrl→⌘/⇧⌘）
- `desktop/src/ui/App.jsx:332`：`(Ctrl+Shift+Space)`。
- `desktop/src/ui/components/KnowClawBubble.jsx:22`：`💡 Ctrl+K …` → `⌘K`。
- `desktop/src/ui/components/knowledge/WabiBoardPage.jsx`：行 364 `Ctrl + A`、373 `Ctrl + L`、418 `Ctrl + Z / Ctrl + Shift + Z`、1348 `(Ctrl+Z)`、1364 `(Ctrl+Shift+Z)`。
- `desktop/src/ui/components/floating/FloatingMode.jsx:365`：`(Esc / Ctrl+Shift+Space)`。
- **注意**：全局快捷键主进程注册的是 `CommandOrControl+Shift+Space`（main.js:2612），在 mac 上即 `⌘⇧Space`。文案需与之一致。请逐一确认每个快捷键对应键位后再改文案，避免文案与实际不符。

### D4. "资源管理器" / "回收站" 术语
- `desktop/src/ui/components/knowclaw-v2/WorkspaceFileTree.jsx`：行 31 注释、557、585、588 "在资源管理器中打开"。
- `desktop/src/ui/components/knowclaw-v2/KnowClawV2Page.jsx`：行 1244、1253、1267、1276、1532、1567、1570 "文件资源管理器"。
- `desktop/src/ui/components/knowledge/KnowledgeDetailPanel.jsx:86`："移到回收站"。
- 统一改为 "访达"。注意：打开文件管理器的主进程实现（`shell.openPath`/`shell.showItemInFolder`）本身跨平台，仅改文案。

### D5. 代码块字体 `desktop/index.html`
- `.prose-chat code` 的 `font-family`：`'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace` → `'SF Mono', 'Menlo', 'Fira Code', monospace`。

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

## F. 响应式设计（需在 V2 新组件上重做）

V1 时做过的响应式改造（RootTable/EntryTable/HeaderBar/MyDataPage）**已对应 V1 旧组件结构，V2 重写了这些组件，旧 diff 失效**。需要在 V2 跑起来后，重新评估以下页面在窄/小窗口下的表现并按需适配：
- 资料页列表（项目/案件/学习的根列表与文件列表）。
- 顶部工具栏（HeaderBar）的按钮在窄屏的换行/竖排问题。
- 新增页面：登录页、企业控制台、云同步、KnowClaw V2 页、悬浮 KnowClaw 等也需检查响应式。
- 此项建议放在最后，待平台功能跑通后专项处理。

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

## 附：旧 mac 分支参考清单（V1 适配的文件）

平台逻辑类（意图稳定，可参考重做）：`main.js`、`scriptExecutor.js`、`fileTools.js`、`webclip.js`、`localFolders.js`、`ipc/{cases,projects,explorer}.js`、`forge.config.js`、`package.json`、`index.html`。

UI 类（V2 已重写，仅作"当初改了哪些点"的线索）：`App.jsx`、`Sidebar.jsx`、`SupervisorBubble.jsx`、`WabiBoardPage.jsx`、`MyDataPage.jsx`、`HeaderBar.jsx`、`RootTable.jsx`、`EntryTable.jsx`。

> 查看旧适配 diff：`git diff <merge-base> mac -- <file>`，其中 merge-base = `e0da71a`。

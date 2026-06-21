---
name: web-artifacts-builder
description: 在当前工作空间中搭建一个完整的 React + TypeScript + Tailwind + shadcn/ui 前端项目，并把它打包成单文件 HTML 在浏览器里直接运行时使用本技能。适合：交互式数据看板、可点击的产品/方案演示、可视化报告、单页演示工具、需要状态管理或路由的复杂前端页面。当用户提到"做一个网页 / 做一个交互页面 / 做一个 React 应用 / 做一个 dashboard / 做一个 web 演示 / 做一个可点击的产品 demo / 把这个做成一个 HTML 单文件 / web app / 单页应用"时即触发。仅在需要 React + 多组件 + 状态管理 + shadcn/ui 时使用——简单的纯 HTML/JSX 单文件页面用基础工具直接写即可。Suite of tools for creating elaborate, multi-component web frontends using modern tech (React, TypeScript, Tailwind CSS, shadcn/ui), bundled into a single self-contained HTML artifact. Use for complex pages requiring state management, routing, or shadcn/ui components — not for simple single-file HTML/JSX.
---

# Web Artifacts Builder

在 KnowClaw 当前工作空间下搭建一个真正可运行的 React 前端项目，开发完毕后打包成 **单个 HTML 文件**（CSS / JS / 资源全部内联），用户双击即可在浏览器打开，也方便分享给他人。

## 工作流概览

1. 用 `init-artifact.js` 初始化前端项目（一次性）
2. 编辑生成的代码，开发界面与逻辑
3. 用 `bundle-artifact.js` 打包成 `bundle.html`
4. 把 `bundle.html` 路径告诉用户，让其打开/分发
5. （可选）用浏览器或截图工具自检

**Stack**: React 18 + TypeScript + Vite + Parcel（打包） + Tailwind CSS + shadcn/ui

## 0. 首次使用：环境与依赖

| 名称 | 要求 | 备注 |
|------|------|------|
| Node.js | ≥ 18 | 必装；用 `node --version` 检查 |
| npm | 跟 Node 一起 | 必装 |
| pnpm | 由 `npx pnpm` 即用 | **不再要求全局 pnpm**，无需管理员权限 |
| `tar` | 可用 | Win10+/macOS/Linux 自带，无需额外安装 |

如果用户是 Windows，且没装 Node，引导其先到 [https://nodejs.org/](https://nodejs.org/) 下载 LTS 安装包。

## 设计与风格指南

非常重要：避免常见的 "AI slop" 风格——过度居中布局、紫色渐变、统一的圆角、Inter 字体。多用对比强烈的色彩、左对齐文本、有节奏感的留白。

## Quick Start

### Step 1: 初始化项目

跨平台 Node 实现（推荐，Windows 必用）：

```bash
node "$KNOWCLAW_SKILLS_DIR/web-artifacts-builder/scripts/init-artifact.js" my-app
cd my-app
```

类 Unix 用户也可以用原始 bash 版（功能等价）：

```bash
bash "$KNOWCLAW_SKILLS_DIR/web-artifacts-builder/scripts/init-artifact.sh" my-app
cd my-app
```

执行完会得到一个完全配置好的项目：

- React + TypeScript（基于 Vite）
- Tailwind CSS 3.4.1 + shadcn/ui 主题变量
- 路径别名 `@/`
- 40+ shadcn/ui 组件已经预装
- 全部 Radix UI 依赖
- Parcel 打包配置（.parcelrc）
- Node 18+ 兼容（自动选 Vite 版本）

项目目录就在 **当前工作空间** 下（即 cwd/<my-app>/）。

### Step 2: 开发界面

直接编辑生成的文件。常见入口：

- `src/App.tsx` — 根组件
- `src/components/` — 自定义组件
- `src/components/ui/` — shadcn 组件（已预装，按需 import）
- `src/index.css` — 全局样式与 CSS 变量

预览（开发服务器）：

```bash
npx pnpm dev
```

### Step 3: 打包成单文件 HTML

```bash
node "$KNOWCLAW_SKILLS_DIR/web-artifacts-builder/scripts/bundle-artifact.js"
```

类 Unix 也可用：

```bash
bash "$KNOWCLAW_SKILLS_DIR/web-artifacts-builder/scripts/bundle-artifact.sh"
```

产出：`bundle.html`——所有 JS、CSS、依赖都内联进同一个文件。**双击即可在浏览器打开，也可以发给任何人**。

要求：项目根有 `index.html`（init 脚本已自动创建）。

### Step 4: 交付给用户

把 `<工作空间>/<my-app>/bundle.html` 的绝对路径告诉用户，引导其用浏览器打开。如果用户希望直接看到效果，调用 KnowClaw 的"在访达中打开工作空间"按钮（标题栏右侧那个外部链接图标）。

### Step 5: 测试 / 可视化（可选）

如果用户没主动要求，**不必预先测试**——增加延迟而无明显价值。需要测试时再用浏览器自动化工具（Playwright / Puppeteer）截图回看。

## 路径与脚本说明

- 内置脚本：`$KNOWCLAW_SKILLS_DIR/web-artifacts-builder/scripts/`
  - `init-artifact.js` / `init-artifact.sh` — 初始化项目（功能等价，前者跨平台）
  - `bundle-artifact.js` / `bundle-artifact.sh` — 打包单文件 HTML（同上）
  - `shadcn-components.tar.gz` — 预打包的 shadcn/ui 组件源（init 脚本会自动解压到 `src/`）
- 工作产物：均落在 **当前工作空间** 下的 `<project-name>/` 子目录里

## 常见问题

- **pnpm 报权限错**：脚本默认走 `npx pnpm` 不需要全局安装；若仍失败，请先 `npm install pnpm` 安装到 cwd 项目里。
- **Vite 版本不兼容**：脚本会自动根据 Node 主版本选 Vite（Node 20+ 用 latest，Node 18 用 5.4.11）。
- **`tar` 找不到**：Windows 10 1803+ 自带；老版本请用 7-Zip CLI 替代或升级系统。
- **bundle.html 体积太大**：内联了所有资源属正常；若超过 10 MB，考虑剔除未用的 shadcn 组件、压缩图片或改用外链 CDN。

## Reference

- shadcn/ui 组件文档：[https://ui.shadcn.com/docs/components](https://ui.shadcn.com/docs/components)
- Tailwind CSS：[https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- Vite：[https://vitejs.dev](https://vitejs.dev)
- Parcel：[https://parceljs.org](https://parceljs.org)

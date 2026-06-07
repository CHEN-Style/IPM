# 麦当劳法务诉讼 AI 演示数据包

本目录用于技术交流前准备演示数据，目标是：

- 在 IPM 中新建一个演示案件；
- 一键生成“诉讼案件模拟文件夹结构 + 完备描述”；
- 一键生成批量测试文件（文件名有序、格式真实、内容占位）；
- 现场上传测试文件后，自动分类能稳定落入正确业务目录。

---

## 目录说明

- `scripts/prepare-mcd-legal-demo.mjs`
  - 主脚本（Node）
  - 生成目录结构模板、测试文件、期望结果清单
  - 可选：直接把结构和描述应用到你已创建的案件目录

- `generated/`（运行脚本后生成）
  - `demo-case-structure.json`：演示案件文件夹结构+描述模板
  - `expected-mapping.csv`：每个测试文件的期望归档目录
  - `upload-ready/all-files/`：演示时直接批量上传的文件（固定 15 个）
  - `upload-ready/by-expected/`：按期望归类分组（用于核对）

---

## 快速使用

### 1) 在系统里手动新建一个案件

建议案件名：`麦当劳诉讼AI演示案`

### 2) 运行脚本生成演示数据（必须）

在仓库根目录执行：

```bash
node test-dir/scripts/prepare-mcd-legal-demo.mjs
```

### 3) 把结构描述应用到该案件（推荐）

如果你的案件目录是：
`D:/proj-production/IPM/desktop/userfile/cases/麦当劳诉讼AI演示案`

执行：

```bash
node test-dir/scripts/prepare-mcd-legal-demo.mjs --case-dir "D:/proj-production/IPM/desktop/userfile/cases/麦当劳诉讼AI演示案"
```

脚本会自动：
- 创建诉讼演示子目录；
- 更新 `meta/structure.json` 中对应目录描述。

### 4) 演示时上传测试文件

上传目录：

- `test-dir/generated/upload-ready/all-files`

建议使用系统里的“上传并 AI 分类”入口（AI 分类按钮），避免普通上传路径不触发自动分类。

---

## 设计原则（保证分类稳定）

- 测试文件总量固定为 15 个，便于现场快速演示。
- 其中 6-7 个为规范命名，其余为“稍微规范但真实有人味”的命名。
- 文件名显式包含分类关键词（如 `发票`、`会议纪要`、`调研报告`、`法律意见书`、`终版` 等）。
- 覆盖 4 大业务目录：
  - `收到资料`
  - `过程文档`
  - `调研研究`
  - `交付成果`

---

## 验收建议

- 上传后，在 AI 暂存区逐批核对建议目录；
- 用 `expected-mapping.csv` 对照抽样检查；
- 演示时重点展示：
  - 批量上传 -> 自动建议；
  - 一键接受/拒绝；
  - 反馈闭环（偏好与事件记录）。

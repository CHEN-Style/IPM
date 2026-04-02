import { createSkill, listSkills } from './skillStore.js';

const log = (msg) => console.log(`[IPM][BuiltinSkills] ${msg}`);

const BUILTIN_SKILLS = [
  {
    name: 'skill-builder',
    description: '通过自然语言对话帮助用户构建新的 Skill——分析需求、设计工作流、生成脚本、创建完整 Skill 包',
    permissions: ['read_file_content', 'write_file_content', 'run_script', 'fetch_web'],
    maturity: 'stable',
    instructions: `## 身份

你是 Skill 构建专家。你的任务是通过与用户的对话，把用户描述的工作流需求转化为一个完整的、可复用的 Skill 包。

## Skill 格式规范

每个 Skill 是一个目录，结构如下：

\`\`\`
skill-name/
├── SKILL.md           # 核心定义：frontmatter（元信息）+ 指令正文
├── references/        # 可选：模板、示例、参考文档
│   └── ...
└── scripts/           # 可选：附带的可执行脚本
    └── ...
\`\`\`

### SKILL.md 格式

\`\`\`markdown
---
name: skill-name
description: 简短描述
version: 1.0.0
permissions:
  - read_file_content
  - write_file_content
  - run_script
  - fetch_web
maturity: draft
inputs:
  - name: paramName
    type: string
    description: 参数描述
---

（下面是指令正文，用 markdown 编写）

## 目标
描述这个 Skill 要完成什么

## 执行步骤
1. 第一步...
2. 第二步...

## 注意事项
- 注意点...
\`\`\`

### 可用权限说明
- **read_file_content**: 读取任意路径的文件内容（文本文件返回全文，二进制返回元信息）
- **write_file_content**: 写入或追加文件内容，自动创建父目录
- **run_script**: 执行 Python 脚本（内联代码或脚本文件），在沙箱 workspace 中运行，有超时保护
- **fetch_web**: 获取网页内容，自动去除 HTML 标签，返回纯文本

## 构建流程

### 第一步：需求分析
1. 仔细理解用户描述的工作流
2. 确认关键问题：
   - 输入是什么？（文件路径、URL、文本...）
   - 输出是什么？（报告、文件、通知...）
   - 涉及哪些操作？（读文件、运行脚本、访问网络...）
   - 是否有多个步骤？步骤间的依赖关系？
3. 如果需求不清晰，向用户追问

### 第二步：设计 Skill
1. 确定所需权限（只申请必要的权限，遵循最小权限原则）
2. 定义输入参数
3. 规划执行步骤
4. 决定是否需要附带脚本：
   - 简单的文件读写、网络请求 → 不需要脚本，直接用工具
   - 复杂的数据处理、批量操作、特定算法 → 编写 Python 脚本

### 第三步：实现
1. 使用 create_skill 创建 Skill，传入：
   - name（英文短横线命名，如 contract-review）
   - description（中文简述）
   - permissions（最小必要权限）
   - instructions（详细的指令正文）
   - maturity 设为 draft
2. 如果需要脚本，使用 save_skill_script 保存到 Skill 的 scripts/ 目录
3. 如果需要参考资料模板，使用 write_file_content 写入 references/

### 第四步：验证
1. 使用 get_skill_detail 检查创建的 Skill 是否完整
2. 向用户展示 Skill 的完整定义，确认是否符合预期
3. 建议用户先在 draft 模式下测试运行

## 指令编写最佳实践

- **指令要具体**：不要写"分析文件"，要写"使用 read_file_content 读取文件内容，从中提取..."
- **明确引用工具**：在步骤中直接写出要使用的工具名（read_file_content, write_file_content, run_script, fetch_web）
- **脚本引用格式**：如果 Skill 附带脚本，在指令中写 \`scripts/xxx.py\`，执行时系统会自动解析为绝对路径
- **错误处理**：在注意事项中写明异常场景的处理方式
- **输出格式**：明确指定最终输出的格式（纯文本、JSON、markdown 等）

## 脚本编写规范

- 语言：Python 3
- 输入：通过 sys.argv 命令行参数传入
- 输出：通过 stdout 打印（建议用 json.dumps 输出结构化结果）
- 错误：通过 stderr 或 exit code 报告
- 依赖：只使用 Python 标准库，如需第三方库在脚本开头注明

## 注意事项
- 新创建的 Skill 默认为 draft 状态，用户测试满意后可通过 update_skill 标记为 stable
- 每个 Skill 应该是自包含的——拷贝整个目录就能迁移
- Skill 名称使用英文 kebab-case（如 contract-review, data-cleaner）
- 始终使用中文与用户交流`,
  },
  {
    name: 'file-content-search',
    description: '在工作空间内搜索文件内容，支持关键词和正则表达式匹配',
    permissions: ['read_file_content', 'run_script'],
    maturity: 'stable',
    instructions: `## 目标
在指定目录中搜索文件内容，返回匹配的文件和行号。

## 重要：任务上下文
你接收到的用户消息包含了完整的任务描述——包括搜索目录、关键词等。直接从中提取参数，无需反问。

## 执行步骤

1. 从任务描述中提取：搜索目录路径、搜索关键词/正则表达式
2. 使用 run_script 工具执行 scripts/search.py，传入目录和关键词参数
3. 将结果整理成结构化格式返回

## 注意事项
- 跳过二进制文件（图片、视频、压缩包等）
- 跳过超过 10MB 的大文件
- 默认递归搜索子目录
- 结果按文件分组，显示匹配行号和上下文`,
    scripts: {
      'search.py': `import os
import sys
import re
import json

def search_files(directory, pattern, is_regex=False, max_file_size=10*1024*1024):
    results = []
    binary_exts = {'.png','.jpg','.jpeg','.gif','.bmp','.ico','.webp','.mp3','.mp4','.avi','.mov','.zip','.rar','.7z','.tar','.gz','.exe','.dll','.db','.sqlite'}

    if is_regex:
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            print(json.dumps({"error": f"Invalid regex: {e}"}))
            return
    else:
        regex = re.compile(re.escape(pattern), re.IGNORECASE)

    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__', '.git')]
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in binary_exts:
                continue
            fpath = os.path.join(root, fname)
            try:
                if os.path.getsize(fpath) > max_file_size:
                    continue
                with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
                matches = []
                for i, line in enumerate(lines, 1):
                    if regex.search(line):
                        matches.append({"line": i, "content": line.rstrip()[:200]})
                if matches:
                    results.append({"file": os.path.relpath(fpath, directory), "matches": matches[:20]})
            except (PermissionError, OSError):
                continue

    print(json.dumps({"total_files_matched": len(results), "results": results[:50]}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: search.py <directory> <pattern> [--regex]"}))
        sys.exit(1)
    directory = sys.argv[1]
    pattern = sys.argv[2]
    is_regex = '--regex' in sys.argv
    search_files(directory, pattern, is_regex)
`,
    },
  },
  {
    name: 'document-summary',
    description: '读取文档文件并生成内容摘要',
    permissions: ['read_file_content'],
    maturity: 'stable',
    instructions: `## 目标
读取文档文件，理解内容后生成结构化摘要。

## 重要：任务上下文
你接收到的用户消息包含了完整的任务描述——包括文件路径、用户需求等所有必要信息。
请直接从消息中提取所需的文件路径和要求，**不要**反过来向用户索要信息。

## 执行步骤

1. 从任务描述中提取目标文件的路径
2. 使用 read_file_content 工具读取该文件
3. 分析文件内容，识别：
   - 文档类型（合同、报告、笔记、代码等）
   - 主要内容和关键信息
   - 重要的数字、日期、人名
4. 根据用户的要求生成结构化摘要，默认包括：
   - 一句话概述
   - 关键要点（3-5条）
   - 重要细节

## 注意事项
- 如果文件过大（超过 512KB），只读取前 500 行
- 对于代码文件，重点分析架构和主要功能
- 摘要使用中文
- 如果任务描述中包含额外要求（如"提取关键条款""分析风险点"），优先满足这些要求`,
  },
  {
    name: 'web-news-briefing',
    description: '爬取指定 URL 的网页内容并汇总要点',
    permissions: ['fetch_web'],
    maturity: 'draft',
    instructions: `## 目标
访问 URL，抓取网页内容，提取并汇总关键信息。

## 重要：任务上下文
你接收到的用户消息包含了完整的任务描述——包括目标 URL 和汇总要求。直接从中提取参数，无需反问。

## 执行步骤

1. 从任务描述中提取目标 URL
2. 使用 fetch_web 获取网页内容
3. 分析返回的文本内容，提取：
   - 页面标题
   - 主要内容段落
   - 关键信息点
4. 生成简洁的中文汇总：
   - 来源和标题
   - 3-5 条要点
   - 关键数据或引用

## 注意事项
- 如果 URL 无法访问，说明原因
- 自动过滤广告和导航等非核心内容
- 汇总应该比原文精简 80% 以上
- 保留原文中的重要数据和引用`,
  },
];

/**
 * Install builtin skills if they don't already exist.
 * Called once at app startup.
 */
export function ensureBuiltinSkills(sandboxRoot) {
  try {
    const existing = listSkills(sandboxRoot);
    const existingNames = new Set(existing.map((s) => s.dirName));

    let installed = 0;
    for (const def of BUILTIN_SKILLS) {
      const dirName = def.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

      if (existingNames.has(dirName)) continue;

      try {
        createSkill(sandboxRoot, def);
        installed++;
        log(`Installed builtin skill: ${def.name}`);
      } catch (e) {
        log(`Failed to install builtin skill "${def.name}": ${e.message}`);
      }
    }

    if (installed > 0) {
      log(`${installed} builtin skill(s) installed`);
    }
  } catch (e) {
    log(`ensureBuiltinSkills failed: ${e.message}`);
  }
}

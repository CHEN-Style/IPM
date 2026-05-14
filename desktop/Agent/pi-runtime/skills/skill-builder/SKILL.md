---
name: skill-builder
description: 创建、编辑、改进 SKILL.md 技能文件。当用户希望"创建一个 skill / 写一个技能 / 把当前工作流固化下来 / 制作 SKILL.md / 让 KnowClaw 学会某个新流程"，或想把一段已经手工演练过的多步骤流程沉淀成可复用技能时使用。即使用户没有明确说"skill"二字，只要意图是让 AI 在未来遇到类似任务时自动按既定步骤执行，也应该使用本技能。
---

# Skill Builder

一个用来创建、编辑、改进 KnowClaw / pi 技能（Skill）的元技能。

读到这份 SKILL.md 时，先不要急着写任何文件。先用对话搞清楚用户到底想让这个 skill 干什么、什么时候触发、需要哪些参考资料；再动笔。

---

## 1. 什么是 Skill

Skill = 一个目录，目录里至少有一个 `SKILL.md`。`SKILL.md` 由两部分组成：

- **YAML frontmatter**：描述自己——`name`、`description`
- **Markdown 正文**：写给"未来的自己"看的指令、原则、示例

KnowClaw 启动时会扫描配置好的 skill 目录。每个 skill 的 `name + description` 会自动注入到系统提示中。当用户的请求与某个 skill 的 description 匹配时，模型会用 `read` 工具读取那个 `SKILL.md`，然后按里面的指令在主会话里继续工作。

**关键点**：skill 不是"子 agent"，不是"独立沙盒"。它就是动态加载的指令集，在当前对话上下文里执行，可以使用此刻所有可用的工具（read / write / edit / bash / grep / find / ls / fetch_web / list_projects 等）。

## 2. 何时使用本技能

- 用户说"帮我创建一个 skill / 写一个技能"
- 用户说"把刚才这个流程保存下来，以后遇到同样的事情自动跑"
- 用户说"我想让 KnowClaw 学会做 X"
- 用户已有一个 SKILL.md 草稿，想让你帮忙打磨
- 用户想给一个现有 skill 增改步骤

## 3. 工作流

### 步骤 1：弄清意图（Capture Intent）

先问清楚：

1. 这个 skill 应该让 KnowClaw 做什么？（一句话描述）
2. 什么时候应该触发？（用户会用什么样的话来描述这类任务）
3. 输入是什么？输出是什么？
4. 有没有典型的成功示例 / 失败示例？

如果当前对话中已经有用户演练过的流程（"把刚才这个保存下来"），先从历史中提取：用了哪些工具、按什么顺序、用户中途纠正过什么、输入输出长什么样。然后跟用户确认你提取的是不是对的，再继续。

不要在意图还很模糊的时候就动手写。模糊的 SKILL.md 会让未来的模型摸不着头脑。

### 步骤 2：确定 skill 存放位置

**用户创建的 skill 一律写到 IPM 的用户技能目录**，路径由环境变量 `KNOWCLAW_USER_SKILLS_ROOT` 提供。**不要**问用户放哪里，也**不要**让用户自己拷贝粘贴文件。直接写过去。

获取这个目录的绝对路径（跨平台通用，请使用 `bash` 工具执行）：

```bash
node -e "console.log(process.env.KNOWCLAW_USER_SKILLS_ROOT || '')"
```

在 Windows 上路径通常是 `%APPDATA%\IPM\knowclaw-skills\`，macOS 上是 `~/Library/Application Support/IPM/knowclaw-skills/`，Linux 上是 `~/.config/IPM/knowclaw-skills/`。但**不要硬编码这些路径**——一律以上面 `node -e` 命令拿到的实际值为准。

最终目录结构应该是：

```
<KNOWCLAW_USER_SKILLS_ROOT>/
└── <skill-name>/
    └── SKILL.md
```

如果环境变量为空（极少见，比如 PoC 模式），告诉用户"当前会话没配置用户技能目录，请重启 IPM 后重试"，**不要**退回去写到内置目录 `desktop/Agent/pi-runtime/skills/`（那里只给 KnowClaw 自带 skill 用）。

### 步骤 3：写 frontmatter

```yaml
---
name: my-skill-name
description: <一句话说清楚做什么 + 一句话说清楚什么时候触发>
---
```

**关于 `name`**：
- 全小写、用 `-` 连接
- 与目录名一致
- 全局唯一（同目录下不能有同名 skill）

**关于 `description`** —— 这是**最重要**的字段，它决定了模型会不会主动调用这个 skill：
- 既要描述"做什么"，也要描述"什么时候用"
- 写得稍微"积极"一些。模型有"宁可不触发"的倾向，所以 description 里直接列出几个典型触发话术能显著提升触发率
- 不要只写"创建图表"，要写"创建图表。当用户提到看板 / 数据可视化 / 趋势图，或想看任何形式的数据展示时使用，即使没明说'图表'二字也应使用"
- 长度建议 1~3 句，可以包含中英文同义词以覆盖更多表达

### 步骤 4：写正文

正文是给未来的模型看的指令。结构建议：

```
# Skill Name

## 何时使用
（再次强调触发场景，可以更细致）

## 工作流 / 步骤
（按顺序写，能用例子就用例子）

## 注意事项 / 常见陷阱
（解释 why，不只是 what）

## 示例
（input → output 对，越具体越好）
```

### 步骤 5：附属资源（按需）

`SKILL.md` 同目录下可以放：

- `scripts/` —— 可执行脚本，重复性强、需要确定性结果的任务（比如批量重命名）
- `references/` —— 参考资料，模型按需读取（比如 API 文档、长格式说明）
- `assets/` —— 输出物模板（比如 docx 模板、图标、字体）

附属资源**不会**自动加载到上下文，模型按需用 `read` 工具读取。这就是"渐进式加载"——`SKILL.md` 本身保持轻量（建议 < 500 行），重内容外置。

如果一个 skill 的指令超过 500 行，应该拆分成"主入口 + references/"结构，正文里写清楚什么时候去读哪个 reference。

## 4. 写作原则

### 解释 why，少用 MUST

今天的模型很聪明，给它讲清楚"为什么这样做"比反复用 ALWAYS / MUST 堆砌规则更有效。当你发现自己在写一连串大写的禁令时，停一下，想想能不能换成"这样做是因为……"的解释。

### 通用 > 特例

我们写 skill 是希望它被用上千次、万次、面对各种没预想到的场景。如果指令太贴着某个具体例子写，换个稍微不同的输入就坏掉。多用抽象描述 + 几个有代表性的示例，少写"如果输入是 X 就输出 Y"的硬规则。

### 示例胜过空谈

一个具体的 input → output 例子顶得上五段抽象指南。

### 简洁

写完后，重读一遍，删掉不出力的话。模型上下文不是免费的。

## 5. 创建完成后

把 skill 创建好之后，告诉用户：

1. **目录路径**（让用户能找到）
2. **重启提示**：当前 KnowClaw session 已经把 skill 列表加载进 system prompt，新增的 skill **要等下一次 session 创建**（开新会话或重启 IPM）才能被模型看到
3. **测试建议**：让用户开新会话用一句他们预想的触发话术试一下，如果模型没触发，多半是 description 不够"积极"，可以回来调

## 6. IPM 上下文里的额外建议

KnowClaw 跑在 IPM（Intelligent Project Manager）里，工作目录是用户的 `userfile/`，不是代码项目根。所以：

- 写 skill 时不要假设有 git 仓库
- 不要假设有 `package.json` / `node_modules`
- 涉及"项目"概念时优先用 IPM 业务工具（`list_projects` / `cross_project_stats` / `proactive_check` / `get_recent_events` / `query_history`），不要让模型自己去文件系统翻
- 涉及"读取网页"时优先用 `fetch_web`，不要让模型用 `bash curl`
- 涉及"读用户文件"时用 pi 内置 `read`，路径相对于当前工作目录或绝对路径都可以

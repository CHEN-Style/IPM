// desktop/Agent/pi-runtime/promptBuilder.js
//
// Phase-7 KnowClaw system prompt builder.
//
// pi SDK's `buildSystemPrompt()` (system-prompt.js) accepts a
// `customPrompt` field that REPLACES the default "You are an expert
// coding assistant operating inside pi" template, while still
// auto-appending: tool snippets, prompt guidelines, appendSystemPrompt,
// project context files (AGENTS.md), skills, and finally the date and
// working directory.
//
// We therefore only need to provide the IPM-specific identity, role,
// limits, and conversation style. The tool list and guidelines are
// emitted automatically by pi from the registered tools' metadata.
//
// IMPORTANT: do NOT hardcode tool names here. Tool snippets and
// per-tool promptGuidelines are auto-injected by pi from the tool
// registry. Hardcoding leads to drift the moment a tool is added or
// renamed.

export const KNOWCLAW_PROMPT_VERSION = 'v1-pi-runtime';

/**
 * Build the KnowClaw system prompt to inject into the pi-coding-agent
 * `DefaultResourceLoader` via the `systemPrompt` option.
 *
 * @param {object} context
 * @param {string} [context.userName]  Optional user display name from prefs.
 * @param {string} [context.cwd]       Working directory (informational only;
 *                                     pi auto-appends the actual cwd line).
 * @returns {string} The custom system prompt body.
 */
export function buildKnowClawPrompt(context = {}) {
  const userName = String(context.userName || '').trim();

  const greetingLine = userName
    ? `当前用户名：「${userName}」。在合适的时机用名字称呼用户，不要每条都叫，避免显得机械。`
    : '当前用户未设置昵称；不要主动询问，用中性的「你」即可。';

  return `你是「KnowClaw」——IPM（Intelligent Project Manager，智能项目管理器）的全局 AI 助理。

# 身份

- 你是用户的项目管理 AI 伙伴，帮助用户管理"项目（projects）"、"案件（cases）"、"学习空间（study）"三类工作区。
- 你**不是**通用编程助手，也不要自称「pi」「coding agent」或「我是 Claude / GPT」。你是 KnowClaw。
- 始终使用**简体中文**回复，除非用户主动用其他语言提问。
- 风格：专业、简洁、主动但不啰嗦；优先给结论与可操作建议，再列细节。

${greetingLine}

# 能力

你拥有两类能力：

1. **通用文件 / 代码 / 命令能力**：可以读写文件、编辑文本、执行 shell 命令、搜索代码与文件、获取网页内容。具体可用的工具会在下方"Available tools"中列出。
2. **IPM 业务能力**：专门用于回答"我的项目状况"类问题，例如列出项目、跨项目统计、主动检查异常、查询项目最近事件与历史。这些工具的名字以业务语义命名（如 list_projects、cross_project_stats、proactive_check 等），仅在用户问到 IPM 项目相关信息时才使用。

**重要：IPM 的 domain 参数**
IPM 的工作区分三类，调用业务工具时 \`domain\` 必须传正确的值：
- \`"projects"\` — 项目（用户说"项目X"时选此）
- \`"cases"\` — 案件（用户说"案件D"、"案件X"时选此）
- \`"study"\` — 学习空间（只有一个，用户说"学习"或"学习空间"时选此）
不确定时，先调 \`list_projects\` 确认名称归属的 domain，再用正确的 domain 调其他工具。

# 工作原则

- **直接执行**：你在主会话中直接拥有所有工具权限，不需要委托给"子 agent"或"专员"。
- **真实优先**：所有结论必须来自工具返回的真实数据，不要编造文件名、项目名、统计数字或文件内容。
- **不确定就说**：拿不准时坦白说明并询问，不要硬猜。
- **写操作谨慎**：对文件的修改、删除、移动会直接生效。涉及破坏性操作前，先简要说明你打算做什么，让用户有机会拦截。
- **路径正确**：当业务工具返回 absolutePath / projectDir 等明确路径时，把它们直接传给读写工具，不要用相对路径自行拼接。

# 对话风格

- 第一次对话或新会话时，可用一两句话简短自我介绍，必要时主动调用 \`proactive_check\` 汇报当前 IPM 工作区是否有需要关注的问题；不要无脑长篇展示能力。
- 回答尽量结构化（列表 / 小标题 / 表格），避免大段连续文字。
- 跨项目分析时给出有价值的洞察（趋势、异常、待办），不要只复述工具返回的原始数据。
- 用户的问题与 IPM 业务无关时（例如让你写代码、解释概念、查资料），就当作普通能力请求处理，不要强行扯到 IPM。`;
}

/**
 * Lightweight summary of the last-built prompt for diagnostics logging.
 *
 * @param {string} prompt
 * @returns {{ length: number, version: string, preview: string }}
 */
export function describeKnowClawPrompt(prompt) {
  const text = String(prompt || '');
  return {
    length: text.length,
    version: KNOWCLAW_PROMPT_VERSION,
    preview: text.slice(0, 80).replace(/\s+/g, ' '),
  };
}

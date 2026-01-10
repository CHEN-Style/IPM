export const PROMPT_VERSION = 'v1';

export const systemPrompt = `你是一个“文件夹自动归档”助手。
你只能依据：文件名、后缀、以及每个候选文件夹的 description 来判断归属。
你不能读取或假设文件内容。
你的输出必须是严格 JSON，且只能给出唯一结论 targetRelPath（不要输出候选列表）。`;

export const userPrompt = ({ fileName, ext, folders }) => {
  return `请根据文件名与后缀，选择最合适的文件夹 relPath。

文件：
- fileName: ${JSON.stringify(fileName)}
- ext: ${JSON.stringify(ext || '')}

候选文件夹（业务目录）：
${JSON.stringify(folders, null, 2)}

要求：
- 只输出 JSON
- 必须包含 targetRelPath（必须是上面候选 folders 里的某一个 relPath）
- 可以包含 rationale（简短一句话）`;
};



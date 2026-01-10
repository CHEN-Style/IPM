import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ClassifyFileInputSchema, ClassifyFileOutputSchema } from '../schemas/classifyFileSchema.js';
import { PROMPT_VERSION, systemPrompt, userPrompt } from '../prompts/classifyFilePrompt.js';
import { createChatModel, getOpenAIConfig } from '../services/llm.js';

export async function classifyFileOnce(input) {
  const parsed = ClassifyFileInputSchema.parse(input);
  const model = createChatModel();

  // IMPORTANT: do NOT use PromptTemplate/ChatPromptTemplate here.
  // The JSON candidate list contains `{}` which PromptTemplate treats as variables.
  // We send raw messages directly to avoid template interpolation errors.
  const out = await model
    .withStructuredOutput(ClassifyFileOutputSchema)
    .invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt({ fileName: parsed.fileName, ext: parsed.ext, folders: parsed.folders })),
    ]);

  // Ensure targetRelPath is one of candidates (hard guard)
  const allowed = new Set(parsed.folders.map((f) => f.relPath));
  if (!allowed.has(out.targetRelPath)) {
    throw new Error(`Agent 输出的 targetRelPath 不在候选列表中：${out.targetRelPath}`);
  }

  const { model: modelName, baseURL } = getOpenAIConfig();
  return {
    ...out,
    agentMeta: {
      provider: 'openai-compatible',
      model: modelName,
      baseURL,
      promptVersion: PROMPT_VERSION,
    },
  };
}



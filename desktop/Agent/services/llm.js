import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { ChatOpenAI } from '@langchain/openai';

// Load env from common locations (dev + packaged flexibility).
// We DO NOT log secrets; only validate presence.
const tryLoadEnvFile = (p) => {
  try {
    if (!p) return;
    if (!fs.existsSync(p)) return;
    dotenv.config({ path: p, override: false });
  } catch {
    // ignore
  }
};

const cwd = process.cwd();
tryLoadEnvFile(path.resolve(cwd, '.env'));
tryLoadEnvFile(path.resolve(cwd, 'Agent', '.env'));
// If app was started from repo root, also try desktop/.env
tryLoadEnvFile(path.resolve(cwd, 'desktop', '.env'));
tryLoadEnvFile(path.resolve(cwd, 'desktop', 'Agent', '.env'));

export function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseURL = process.env.OPENAI_BASE_URL || '';
  const model = process.env.OPENAI_MODEL || '';
  if (!apiKey) throw new Error('缺少环境变量 OPENAI_API_KEY');
  if (!baseURL) throw new Error('缺少环境变量 OPENAI_BASE_URL');
  if (!model) throw new Error('缺少环境变量 OPENAI_MODEL');
  return { apiKey, baseURL, model };
}

export function createChatModel() {
  const { apiKey, baseURL, model } = getOpenAIConfig();
  // MVP: deterministic output, no tuning surface exposed in UI
  return new ChatOpenAI({
    apiKey,
    model,
    temperature: 0,
    configuration: { baseURL },
  });
}



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

let _userDataEnvLoaded = false;

function tryReadStateConfig() {
  const statePath = process.env.IPM_STATE_PATH || '';
  if (!statePath) return null;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const llm = state?.prefs?.llm;
    if (llm?.apiKey && llm?.baseURL && llm?.model) {
      return {
        apiKey: llm.apiKey,
        baseURL: llm.baseURL,
        model: llm.model,
        summaryModel: llm.summaryModel || '',
      };
    }
  } catch { /* fallback to env */ }
  return null;
}

export function getOpenAIConfig() {
  // 1. Prefer config from settings UI (state.json)
  const fromState = tryReadStateConfig();
  if (fromState) return fromState;

  // 2. Fallback: load .env from userData (packaged app)
  if (!_userDataEnvLoaded && process.env.IPM_USER_DATA) {
    tryLoadEnvFile(path.join(process.env.IPM_USER_DATA, '.env'));
    tryLoadEnvFile(path.join(process.env.IPM_USER_DATA, 'IPM', '.env'));
    _userDataEnvLoaded = true;
  }

  // 3. Fallback: process.env (dev mode .env files)
  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseURL = process.env.OPENAI_BASE_URL || '';
  const model = process.env.OPENAI_MODEL || '';
  if (!apiKey) throw new Error('请在「偏好设置」中配置 AI 模型的 API Key');
  if (!baseURL) throw new Error('请在「偏好设置」中配置 AI 模型的 API 地址');
  if (!model) throw new Error('请在「偏好设置」中配置 AI 模型名称');
  return { apiKey, baseURL, model };
}

export function createChatModel() {
  const { apiKey, baseURL, model } = getOpenAIConfig();
  return new ChatOpenAI({
    apiKey,
    model,
    temperature: 0,
    configuration: { baseURL },
  });
}

/**
 * Cheap / fast model for background tasks like summarization.
 * Falls back to main model if OPENAI_SUMMARY_MODEL is not set.
 */
export function createSummaryModel() {
  const config = getOpenAIConfig();
  const summaryModel = config.summaryModel || process.env.OPENAI_SUMMARY_MODEL || config.model;
  return new ChatOpenAI({
    apiKey: config.apiKey,
    model: summaryModel,
    temperature: 0,
    configuration: { baseURL: config.baseURL },
  });
}



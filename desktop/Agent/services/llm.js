import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { ChatOpenAI } from '@langchain/openai';

import {
  getAiSettings,
  getRoleConfig,
  describeProvider,
  defaultBaseUrlFor,
} from './aiConfig.js';
import { createChatModelForProvider } from './modelProviders.js';

// 加载 .env（保留旧行为，方便开发环境通过 .env 覆盖 IPM 配置）。
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
tryLoadEnvFile(path.resolve(cwd, 'desktop', '.env'));
tryLoadEnvFile(path.resolve(cwd, 'desktop', 'Agent', '.env'));

let _userDataEnvLoaded = false;

/**
 * 在缺少 state 配置时，从环境变量合成一个 OpenAI 兼容 provider。
 * 仅用于开发模式 / CI / 自动化测试。
 */
function buildEnvProvider() {
  if (!_userDataEnvLoaded && process.env.IPM_USER_DATA) {
    tryLoadEnvFile(path.join(process.env.IPM_USER_DATA, '.env'));
    tryLoadEnvFile(path.join(process.env.IPM_USER_DATA, 'IPM', '.env'));
    _userDataEnvLoaded = true;
  }
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const baseURL = String(process.env.OPENAI_BASE_URL || '').trim();
  const model = String(process.env.OPENAI_MODEL || '').trim();
  const summaryModel = String(process.env.OPENAI_SUMMARY_MODEL || '').trim();
  if (!apiKey || !baseURL || !model) return null;
  return {
    provider: {
      id: 'env-openai',
      name: 'env OPENAI_*',
      type: 'openai-compatible',
      baseURL,
      apiKey,
      apiMode: String(process.env.OPENAI_API_MODE || 'responses').toLowerCase() === 'chat' ? 'chat' : 'responses',
      modelsCache: { fetchedAt: '', models: [{ id: model, name: model }] },
    },
    model,
    summaryModel: summaryModel || model,
  };
}

/**
 * 找到指定角色对应的 { provider, model } 配置。
 * 优先级：state.prefs.ai → 环境变量。
 *
 * @param {'classification' | 'summary' | 'preferenceParsing' | 'knowclaw'} role
 * @returns {{provider: object, model: string}}
 */
export function resolveLegacyRoleConfig(role) {
  const settings = getAiSettings();
  const fromState = getRoleConfig(settings, role);
  if (fromState) return fromState;

  const fallback = buildEnvProvider();
  if (fallback) {
    return {
      provider: fallback.provider,
      model: role === 'summary' ? fallback.summaryModel : fallback.model,
    };
  }
  // 给出明确的错误消息，引导用户进入设置页配置。
  const roleLabel = ({
    classification: '文件分类',
    summary: '网页摘要',
    preferenceParsing: '偏好解析',
    knowclaw: 'KnowClaw',
  })[role] || role;
  throw new Error(`请先在「偏好设置 → AI 模型配置」中给"${roleLabel}"分配一个模型`);
}

/**
 * 旧接口：返回扁平的 OpenAI 配置形态，仅 OpenAI 兼容 / 官方类型支持。
 * 主要供尚未迁移到 role-aware 接口的调用方（例如生成 agentMeta 时显示
 * 当前模型）使用。
 *
 * @param {'classification' | 'summary' | 'preferenceParsing' | 'knowclaw'} [role='classification']
 * @returns {{ apiKey: string, baseURL: string, model: string, summaryModel: string }}
 */
export function getOpenAIConfig(role = 'classification') {
  const { provider, model } = resolveLegacyRoleConfig(role);
  const type = String(provider?.type || '').toLowerCase();
  if (type && type !== 'openai' && type !== 'openai-compatible') {
    // 调用 getOpenAIConfig 的旧代码假定是 OpenAI 兼容；如果用户把这个角色
    // 分配给了 Anthropic / Gemini，旧调用方式无法生效。这里抛错好过把
    // 错误的字段悄悄写进 agentMeta。
    throw new Error(`角色 ${role} 被分配给了非 OpenAI 兼容 Provider (${type})，请使用 createChatModel(role)`);
  }
  return {
    apiKey: String(provider?.apiKey || ''),
    baseURL: String(provider?.baseURL || defaultBaseUrlFor(type || 'openai-compatible')),
    model,
    summaryModel: model,
  };
}

/**
 * 按角色构造一个 LangChain BaseChatModel。
 * @param {'classification' | 'summary' | 'preferenceParsing' | 'knowclaw'} [role='classification']
 * @param {object} [opts]
 */
export async function createChatModel(role = 'classification', opts = {}) {
  const { provider, model } = resolveLegacyRoleConfig(role);
  return createChatModelForProvider(provider, model, opts);
}

/**
 * Summary 角色的快捷工厂，等价于 createChatModel('summary')。
 * @param {object} [opts]
 */
export async function createSummaryModel(opts = {}) {
  return createChatModel('summary', opts);
}

/**
 * 调试用：返回当前角色配置的脱敏快照。
 * @param {string} role
 */
export function describeRoleConfig(role) {
  try {
    const { provider, model } = resolveLegacyRoleConfig(role);
    return { provider: describeProvider(provider), model };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

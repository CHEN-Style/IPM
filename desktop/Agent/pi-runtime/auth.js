// desktop/Agent/pi-runtime/auth.js
//
// AuthStorage adapter for IPM.
//
// Design choices:
//   - We create the default `AuthStorage` instance (which points to
//     `~/.pi/agent/auth.json`) but we *never* call any persistence method
//     on it. The only mutation we perform is `setRuntimeApiKey(...)`,
//     which is in-memory only. As a result, running IPM does not write
//     credentials to the user's global pi config directory.
//   - 多 Provider 升级后，每个用户配置的 Provider 都会获得一个 pi 端的
//     provider id（形如 `ipm-openai-<providerId>`，详见 models.js 中的
//     piProviderIdForKnowClaw）。同一个 AuthStorage 可以持有多个 runtime
//     key，互不影响。
//   - 保留 `IPM_PROVIDER_ID` 常量作为"未配置任何 Provider 时的退路"，
//     主要给老代码路径（例如某些诊断 IPC）使用；新代码应通过 ipmConfig
//     中暴露的 piProviderId 字段拿到具体 id。

import { AuthStorage } from '@earendil-works/pi-coding-agent';

export const IPM_PROVIDER_ID = 'ipm-openai';

/**
 * Build a fresh AuthStorage. Does not write to disk.
 * @returns {ReturnType<typeof AuthStorage.create>}
 */
export function buildAuthStorage() {
  return AuthStorage.create();
}

/**
 * 把单个 KnowClaw provider 配置的 API Key 注入到 AuthStorage。
 * 多个 provider 时分别调用即可。
 *
 * @param {ReturnType<typeof AuthStorage.create>} authStorage
 * @param {{piProviderId: string, apiKey: string} | null} ipmConfig
 * @returns {boolean}
 */
export function applyIpmRuntimeKey(authStorage, ipmConfig) {
  if (!authStorage || !ipmConfig || !ipmConfig.apiKey) return false;
  const providerId = ipmConfig.piProviderId || IPM_PROVIDER_ID;
  try {
    authStorage.setRuntimeApiKey(providerId, ipmConfig.apiKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * 批量注入多个 KnowClaw provider 配置的 API Key。
 *
 * @param {ReturnType<typeof AuthStorage.create>} authStorage
 * @param {Array<{piProviderId: string, apiKey: string}>} configs
 * @returns {number} 成功注入的数量
 */
export function applyIpmRuntimeKeys(authStorage, configs) {
  if (!authStorage || !Array.isArray(configs)) return 0;
  let count = 0;
  for (const cfg of configs) {
    if (applyIpmRuntimeKey(authStorage, cfg)) count += 1;
  }
  return count;
}

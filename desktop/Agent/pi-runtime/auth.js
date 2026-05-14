// desktop/Agent/pi-runtime/auth.js
//
// AuthStorage adapter for IPM.
//
// Design choices (see KNOWCLAW_REBUILD_PLAN.md, Phase 1):
//   - We create the default `AuthStorage` instance (which points to
//     `~/.pi/agent/auth.json`) but we *never* call any persistence method
//     on it. The only mutation we perform is `setRuntimeApiKey(...)`,
//     which is in-memory only. As a result, running IPM does not write
//     credentials to the user's global pi config directory.
//   - The IPM API key is bound to a dedicated provider id `ipm-openai`
//     (registered by `models.js`), not to pi's built-in `openai`. This
//     keeps our config isolated from any pi defaults and from the user's
//     possible other pi installations.
//   - Key injection is deliberately separated from `buildAuthStorage()`
//     so the caller can run `resourceLoader.reload()` (which flushes the
//     `pi.registerProvider('ipm-openai', ...)` queue) *before* the key is
//     attached. This avoids any provider-not-yet-registered edge case.

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
 * Inject the IPM API key as a runtime override for the `ipm-openai`
 * provider. Must be called after `resourceLoader.reload()` has flushed
 * the corresponding `pi.registerProvider()` queue.
 *
 * Returns true when a key was applied, false otherwise.
 *
 * @param {ReturnType<typeof AuthStorage.create>} authStorage
 * @param {import('./ipmConfig.js').IpmLlmConfig | null} ipmConfig
 * @returns {boolean}
 */
export function applyIpmRuntimeKey(authStorage, ipmConfig) {
  if (!authStorage || !ipmConfig || !ipmConfig.apiKey) return false;
  try {
    authStorage.setRuntimeApiKey(IPM_PROVIDER_ID, ipmConfig.apiKey);
    return true;
  } catch {
    return false;
  }
}

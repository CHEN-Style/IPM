// Cloud API client.
//
// A thin HTTP wrapper over the IPM Cloud API used by the publish flow (C3) and
// later cloud phases. Uses Node's global `fetch` (available in Electron's main
// process). Auth in C3 is the dev-only `X-Dev-User-Id` header injected via
// `devUserId`; once real auth lands it switches to a lazy `getToken()` bearer.

import { CLOUD_DEV_CONFIG } from './devConfig.js';
import { getActiveAccessToken } from './authStore.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class CloudClient {
  constructor({ baseURL = '', getToken = null, devUserId = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.baseURL = String(baseURL || '').replace(/\/+$/, '');
    this.getToken = typeof getToken === 'function' ? getToken : null;
    this.devUserId = devUserId || null;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Whether the client has enough configuration to attempt requests.
   */
  isConfigured() {
    return Boolean(this.baseURL);
  }

  _buildUrl(reqPath) {
    const suffix = String(reqPath || '');
    return `${this.baseURL}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
  }

  async _resolveAuthHeaders() {
    const headers = {};
    if (this.devUserId) headers['X-Dev-User-Id'] = this.devUserId;
    if (this.getToken) {
      const token = await this.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Core JSON request. Serializes `body` to JSON, injects auth headers, applies
   * a timeout, and parses the JSON response. Non-2xx responses throw an Error
   * carrying `.status` and `.body`.
   */
  async request(method, reqPath, { body, headers = {}, signal } = {}) {
    if (!this.isConfigured()) throw new Error('CloudClient 未配置 baseURL');

    const authHeaders = await this._resolveAuthHeaders();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // Allow callers to pass their own abort signal in addition to the timeout.
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const res = await fetch(this._buildUrl(reqPath), {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (!res.ok) {
        const message =
          parsed && typeof parsed === 'object' && parsed.error
            ? parsed.error
            : `云端请求失败 (${res.status})`;
        const err = new Error(message);
        err.status = res.status;
        err.body = parsed;
        // H1: machine-readable error code (ORG_DISABLED / MEMBER_DISABLED /
        // RATE_LIMITED ...) so UI layers can branch without string matching.
        if (parsed && typeof parsed === 'object' && parsed.code) {
          err.code = parsed.code;
        }
        throw err;
      }

      return parsed;
    } catch (err) {
      if (err?.name === 'AbortError') {
        const e = new Error('云端请求超时或被取消');
        e.code = 'ABORTED';
        throw e;
      }
      // Already-shaped HTTP errors (from the !res.ok branch) carry a status or a
      // machine code — re-throw verbatim so UI branching keeps working.
      if (err && (err.status || err.code)) {
        throw err;
      }
      // Everything else here is a transport-level failure (server unreachable,
      // DNS, connection reset, TLS). Node's undici surfaces these as an opaque
      // "fetch failed", which is meaningless to users. Map to a friendly,
      // actionable message with a stable NETWORK code so callers can branch.
      const e = new Error('无法连接云端服务，请检查网络后重试。');
      e.code = 'NETWORK';
      e.cause = err;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async get(reqPath, opts = {}) {
    return this.request('GET', reqPath, opts);
  }

  async post(reqPath, body, opts = {}) {
    return this.request('POST', reqPath, { ...opts, body });
  }

  async put(reqPath, body, opts = {}) {
    return this.request('PUT', reqPath, { ...opts, body });
  }

  async patch(reqPath, body, opts = {}) {
    return this.request('PATCH', reqPath, { ...opts, body });
  }

  async delete(reqPath, opts = {}) {
    return this.request('DELETE', reqPath, opts);
  }
}

export function createCloudClient(opts = {}) {
  return new CloudClient(opts);
}

/**
 * Create a CloudClient pre-wired with the dev config (base URL + dev user id).
 */
export function createDevCloudClient(overrides = {}) {
  return new CloudClient({
    baseURL: CLOUD_DEV_CONFIG.baseURL,
    devUserId: CLOUD_DEV_CONFIG.devUserId,
    ...overrides,
  });
}

/**
 * Create a CloudClient that authenticates with the logged-in user's JWT.
 * `getToken` lazily resolves (and refreshes) the active user's access token.
 * Used by all real cloud operations once auth lands (C3.5+).
 */
export function createAuthCloudClient(overrides = {}) {
  return new CloudClient({
    baseURL: CLOUD_DEV_CONFIG.baseURL,
    getToken: getActiveAccessToken,
    ...overrides,
  });
}

// API layer: fetch wrapper with Bearer auth, 401 auto-refresh, and a thin
// session store backed by localStorage. The `/api/platform/**` surface is the
// stable contract; this file is the only place that talks HTTP.

const LS_ACCESS = 'ipm_pc_access';
const LS_REFRESH = 'ipm_pc_refresh';
const LS_USER = 'ipm_pc_user';

export const session = {
  get access() { return localStorage.getItem(LS_ACCESS) || ''; },
  get refresh() { return localStorage.getItem(LS_REFRESH) || ''; },
  get user() {
    try { return JSON.parse(localStorage.getItem(LS_USER) || 'null'); } catch { return null; }
  },
  set({ accessToken, refreshToken, user }) {
    if (accessToken) localStorage.setItem(LS_ACCESS, accessToken);
    if (refreshToken) localStorage.setItem(LS_REFRESH, refreshToken);
    if (user) localStorage.setItem(LS_USER, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_REFRESH);
    localStorage.removeItem(LS_USER);
  },
  get isLoggedIn() { return Boolean(this.access); },
};

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function rawRequest(method, path, body, accessToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  const txt = await res.text();
  if (txt) { try { parsed = JSON.parse(txt); } catch { parsed = txt; } }
  return { res, parsed };
}

async function tryRefresh() {
  const refreshToken = session.refresh;
  if (!refreshToken) return false;
  const { res, parsed } = await rawRequest('POST', '/api/auth/refresh', { refreshToken });
  if (res.ok && parsed?.ok) {
    session.set({ accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, user: parsed.user });
    return true;
  }
  return false;
}

/** Authenticated JSON request with one transparent refresh-on-401 retry. */
export async function api(method, path, body) {
  let { res, parsed } = await rawRequest(method, path, body, session.access);
  if (res.status === 401 && session.refresh) {
    if (await tryRefresh()) {
      ({ res, parsed } = await rawRequest(method, path, body, session.access));
    }
  }
  if (!res.ok) {
    const msg = parsed && typeof parsed === 'object' && parsed.error ? parsed.error : `请求失败 (${res.status})`;
    const code = parsed && typeof parsed === 'object' ? parsed.code : null;
    throw new ApiError(msg, res.status, code);
  }
  return parsed;
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body ?? {});

// ── Unauthenticated ────────────────────────────────────────────────
export async function login(email, password) {
  const { res, parsed } = await rawRequest('POST', '/api/auth/login', { email, password });
  if (!res.ok || !parsed?.ok) {
    throw new ApiError(parsed?.error || '登录失败', res.status, parsed?.code);
  }
  session.set({ accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, user: parsed.user });
  return parsed.user;
}

export async function logout() {
  const refreshToken = session.refresh;
  if (refreshToken) {
    await rawRequest('POST', '/api/auth/logout', { refreshToken }).catch(() => undefined);
  }
  session.clear();
}

export { ApiError };

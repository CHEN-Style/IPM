// C3.5: Authentication IPC.
//
// Bridges the renderer login/register/logout flow to the cloud auth API and
// the local per-user scope. On a successful login/register/logout/switch we
// relaunch the app so every data path + env var is re-resolved cleanly for the
// newly active user (the robust alternative to patching live state).

import { CloudClient } from '../cloud/cloudClient.js';
import { CLOUD_DEV_CONFIG } from '../cloud/devConfig.js';
import * as userScope from '../cloud/userScope.js';
import { saveTokens, loadTokens, clearTokens, getAccessToken } from '../cloud/authStore.js';

function publicClient() {
  return new CloudClient({ baseURL: CLOUD_DEV_CONFIG.baseURL });
}

export function registerAuthIpc({ ipcMain, app, getMainWindow, refreshEnv }) {
  // In dev mode (electron-forge start), app.relaunch() doesn't work because
  // the process is managed by forge/vite — it relaunches the raw Electron
  // binary instead of `electron-forge start`, causing a white screen. Use
  // webContents.reload() for dev; full relaunch for packaged builds.
  const scheduleRelaunch = () => {
    setTimeout(() => {
      if (!app.isPackaged) {
        const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (win && !win.isDestroyed()) {
          // Refresh cached env vars that downstream code reads from process.env,
          // since a soft reload won't re-run the app.whenReady() assignments.
          if (typeof refreshEnv === 'function') refreshEnv();
          win.webContents.reload();
          return;
        }
      }
      try {
        app.relaunch();
      } finally {
        app.exit(0);
      }
    }, 300);
  };

  ipcMain.handle('auth/getStatus', async () => {
    let current = userScope.getCurrentUser();
    if (current && current.userId) {
      try {
        const token = await getAccessToken(current.userId);
        if (token) {
          const fresh = await publicClient().get('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (fresh?.ok && fresh.user?.id) {
            current = userScope.setCurrentUser({
              userId: fresh.user.id,
              email: fresh.user.email,
              displayName: fresh.user.displayName,
              orgId: fresh.user.orgId,
              orgRole: fresh.user.orgRole || 'member',
            });
          }
        }
      } catch {
        // Best-effort role refresh. Existing local status is still usable.
      }
      return {
        ok: true,
        loggedIn: true,
        offline: false,
        needsAuth: false,
        user: {
          userId: current.userId,
          email: current.email,
          displayName: current.displayName,
          orgId: current.orgId,
          orgRole: current.orgRole || 'member',
        },
      };
    }
    if (current && current.offline) {
      return { ok: true, loggedIn: false, offline: true, needsAuth: false, user: null };
    }
    return { ok: true, loggedIn: false, offline: false, needsAuth: true, user: null };
  });

  ipcMain.handle('auth/register', async (_evt, params) => {
    const { inviteCode, email, password, displayName } = params || {};
    try {
      const client = publicClient();
      const res = await client.post('/api/auth/register', {
        inviteCode,
        email,
        password,
        displayName,
      });
      if (!res?.ok || !res.user?.id) {
        return { ok: false, error: res?.error || '注册失败' };
      }
      saveTokens(res.user.id, {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      userScope.setCurrentUser({
        userId: res.user.id,
        email: res.user.email,
        displayName: res.user.displayName,
        orgId: res.user.orgId,
        orgRole: res.user.orgRole || 'member',
      });
      scheduleRelaunch();
      return { ok: true, user: res.user };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('auth/login', async (_evt, params) => {
    const { email, password } = params || {};
    try {
      const client = publicClient();
      const res = await client.post('/api/auth/login', { email, password });
      if (!res?.ok || !res.user?.id) {
        return { ok: false, error: res?.error || '登录失败' };
      }
      saveTokens(res.user.id, {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      userScope.setCurrentUser({
        userId: res.user.id,
        email: res.user.email,
        displayName: res.user.displayName,
        orgId: res.user.orgId,
        orgRole: res.user.orgRole || 'member',
      });
      scheduleRelaunch();
      return { ok: true, user: res.user };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('auth/useOffline', async () => {
    // The boot scope is already `_offline` when no user is logged in, so this
    // only needs to persist the choice; no relaunch required.
    const wasLoggedIn = userScope.isLoggedIn();
    userScope.setOffline();
    if (wasLoggedIn) scheduleRelaunch();
    return { ok: true, relaunching: wasLoggedIn };
  });

  ipcMain.handle('auth/logout', async () => {
    const current = userScope.getCurrentUser();
    if (current && current.userId) {
      const tokens = loadTokens(current.userId);
      if (tokens?.refreshToken) {
        try {
          await publicClient().post('/api/auth/logout', { refreshToken: tokens.refreshToken });
        } catch {
          // best-effort revoke
        }
      }
      clearTokens(current.userId);
    }
    userScope.clearCurrentUser();
    scheduleRelaunch();
    return { ok: true };
  });

  // Switch account: drop the current selection and relaunch into the login
  // screen. The token of the previous user is kept so re-login is instant.
  ipcMain.handle('auth/switchUser', async () => {
    userScope.clearCurrentUser();
    scheduleRelaunch();
    return { ok: true };
  });
}

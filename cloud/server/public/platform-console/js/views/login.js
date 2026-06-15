// Login view. After auth, verifies the account is a platform admin by probing
// a gated endpoint; non-admins are rejected with a clear message.

import { h, clear, toast } from '../util.js';
import { login, get, logout } from '../api.js';
import { navigate } from '../router.js';

export function renderLogin() {
  const app = document.getElementById('app');
  clear(app);

  const errEl = h('div.form-error');
  const emailEl = h('input.txt', { type: 'email', placeholder: 'you@company.com', autocomplete: 'username' });
  const pwEl = h('input.txt', { type: 'password', placeholder: '••••••••', autocomplete: 'current-password' });
  const btn = h('button.btn.primary.block', { type: 'submit' }, ['登录控制台']);

  async function submit(e) {
    e.preventDefault();
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      await login(emailEl.value.trim(), pwEl.value);
      // Gate check: only platform admins may use this console.
      try {
        await get('/api/platform/stats');
      } catch (gateErr) {
        if (gateErr.status === 403) {
          await logout();
          throw new Error('该账号没有平台管理权限，无法访问控制台。');
        }
        throw gateErr;
      }
      toast('登录成功');
      navigate('#/orgs');
    } catch (err) {
      errEl.textContent = String(err?.message || err);
      btn.disabled = false;
      btn.textContent = '登录控制台';
    }
  }

  const form = h('form', { onsubmit: submit }, [
    h('label.field', {}, [h('span', { text: '邮箱' }), emailEl]),
    h('label.field', {}, [h('span', { text: '密码' }), pwEl]),
    errEl,
    btn,
  ]);

  const card = h('div.login-card', {}, [
    h('div.login-logo', { text: 'IPM' }),
    h('h1', { text: '平台控制台' }),
    h('p.sub', { text: '仅限 IPM 平台超级管理员访问。' }),
    form,
  ]);

  app.append(h('div.login-wrap', {}, [card]));
  emailEl.focus();
}

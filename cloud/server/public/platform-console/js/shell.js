// Authenticated shell: left sidebar nav + main content area.

import { h, clear } from './util.js';
import { session, logout } from './api.js';
import { navigate } from './router.js';

const NAV = [
  { key: 'orgs', label: '企业管理', hash: '#/orgs' },
  { key: 'admins', label: '平台管理员', hash: '#/admins' },
  { key: 'audit', label: '平台审计', hash: '#/audit' },
];

export function renderShell(activeKey, content) {
  const app = document.getElementById('app');
  clear(app);
  const user = session.user || {};

  const nav = NAV.map((n) =>
    h('div.nav-item', {
      class: n.key === activeKey ? 'active' : '',
      onclick: () => navigate(n.hash),
    }, [n.label]),
  );

  const sidebar = h('div.sidebar', {}, [
    h('div.brand', {}, [
      h('div.mark', { text: 'IPM' }),
      h('div', {}, [
        h('b', { text: '平台控制台' }),
        h('small', { text: '超级管理员' }),
      ]),
    ]),
    ...nav,
    h('div.sidebar-foot', {}, [
      h('div.who', {}, [
        document.createTextNode(user.displayName || user.email || '—'),
        h('small', { text: user.email || '' }),
      ]),
      h('button.btn.sm.block', {
        onclick: async () => { await logout(); navigate('#/login'); },
      }, ['退出登录']),
    ]),
  ]);

  const main = h('div.main', {}, [content]);
  app.append(h('div.shell', {}, [sidebar, main]));
}

/** Standard page scaffold inside the main area. */
export function page({ title, subtitle, actions, children }) {
  return h('div.page', {}, [
    h('div.page-head', {}, [
      h('div', {}, [
        h('h1', { text: title }),
        subtitle ? h('p', { text: subtitle }) : null,
      ]),
      actions ? h('div.head-actions', {}, actions) : null,
    ]),
    ...(Array.isArray(children) ? children : [children]),
  ]);
}

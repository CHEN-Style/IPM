// Platform admins: read-only list. Grant/revoke is intentionally CLI-only
// (requires server shell access) and surfaced here as guidance.

import { h, fmtDate, avatar } from '../util.js';
import { get } from '../api.js';
import { renderShell, page } from '../shell.js';

export async function renderAdmins() {
  let admins = [];
  try {
    const res = await get('/api/platform/admins');
    admins = res.admins || [];
  } catch (err) {
    renderShell('admins', page({ title: '平台管理员', children: [h('div.warnbox', { text: String(err?.message || err) })] }));
    return;
  }

  const rows = admins.map((a) =>
    h('tr', {}, [
      h('td', {}, [h('div.cell-user', {}, [
        avatar(a.displayName || a.email, a.userId),
        h('div.nm', {}, [h('b', { text: a.displayName || '—' }), h('small', { text: a.email })]),
      ])]),
      h('td', { text: a.note || '—' }),
      h('td', { text: fmtDate(a.createdAt) }),
    ]),
  );

  const content = page({
    title: '平台管理员',
    subtitle: '拥有平台控制台访问权限的账号。',
    children: [
      h('div.banner', {}, ['出于安全考虑，授予 / 撤销平台管理员仅可通过服务器命令行（platform CLI）执行，控制台不提供此操作。']),
      h('div.card', {}, [h('table', {}, [
        h('thead', {}, [h('tr', {}, [h('th', { text: '管理员' }), h('th', { text: '备注' }), h('th', { text: '授予时间' })])]),
        h('tbody', {}, rows.length ? rows : [h('tr', {}, [h('td', { colspan: '3' }, [h('div.empty', { text: '暂无平台管理员' })])])]),
      ])]),
    ],
  });
  renderShell('admins', content);
}

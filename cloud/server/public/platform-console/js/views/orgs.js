// Org list: global stats + searchable/filterable table + create-org modal.

import { h, clear, toast, copy, fmtDate } from '../util.js';
import { get, post } from '../api.js';
import { navigate, resolve } from '../router.js';
import { renderShell, page } from '../shell.js';
import { openModal } from '../modal.js';

function statusTag(status) {
  if (status === 'active') return h('span.tag.good', {}, [h('span.dot'), '正常']);
  if (status === 'disabled') return h('span.tag.danger', {}, [h('span.dot'), '已停用']);
  return h('span.tag', {}, [status]);
}

export async function renderOrgs() {
  renderShell('orgs', h('div.page', {}, [h('div.empty', { text: '加载中…' })]));

  let stats = null;
  let orgs = [];
  try {
    const [statsRes, orgsRes] = await Promise.all([
      get('/api/platform/stats').catch(() => null),
      get('/api/platform/orgs'),
    ]);
    stats = statsRes?.stats || null;
    orgs = orgsRes.orgs || [];
  } catch (err) {
    renderShell('orgs', page({ title: '企业管理', children: [h('div.warnbox', { text: String(err?.message || err) })] }));
    return;
  }

  let query = '';
  let statusFilter = 'all'; // all | active | disabled
  const tbody = h('tbody');

  function rows() {
    clear(tbody);
    const q = query.trim().toLowerCase();
    const filtered = orgs.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (q && !`${o.name} ${o.slug}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (filtered.length === 0) {
      tbody.append(h('tr', {}, [h('td', { colspan: '6' }, [h('div.empty', { text: '没有匹配的企业' })])]));
      return;
    }
    for (const o of filtered) {
      tbody.append(
        h('tr.clickable', { onclick: () => navigate(`#/orgs/${o.id}`) }, [
          h('td', {}, [h('div.row-strong', { text: o.name })]),
          h('td', {}, [h('span.mono', { text: o.slug })]),
          h('td', { text: o.plan }),
          h('td', {}, [statusTag(o.status)]),
          h('td', { text: String(o.memberCount) }),
          h('td', { text: String(o.workspaceCount) }),
        ]),
      );
    }
  }

  const searchInput = h('input', { placeholder: '搜索名称或 slug…', oninput: (e) => { query = e.target.value; rows(); } });
  const statusBtn = h('button.btn', {}, ['状态：全部']);
  statusBtn.addEventListener('click', () => {
    statusFilter = statusFilter === 'all' ? 'active' : statusFilter === 'active' ? 'disabled' : 'all';
    statusBtn.textContent = `状态：${statusFilter === 'all' ? '全部' : statusFilter === 'active' ? '正常' : '已停用'}`;
    rows();
  });

  const statRow = stats ? h('div.stat-row', {}, [
    statCard('企业总数', stats.orgs.total, `活跃 ${stats.orgs.active}`),
    statCard('已停用企业', stats.orgs.disabled),
    statCard('用户总数', stats.users.total, `活跃 ${stats.users.active}`),
    statCard('云端项目', stats.workspaces.total),
    statCard('平台管理员', stats.platformAdmins.total),
  ]) : null;

  const content = page({
    title: '企业管理',
    subtitle: '平台范围内的所有企业租户。',
    actions: [h('button.btn.primary', { onclick: () => openCreateOrg() }, ['+ 创建企业'])],
    children: [
      statRow,
      h('div.toolbar', {}, [
        h('div.search', {}, [searchInput]),
        statusBtn,
      ]),
      h('div.card', {}, [
        h('table', {}, [
          h('thead', {}, [h('tr', {}, [
            h('th', { text: '名称' }), h('th', { text: 'Slug' }), h('th', { text: '套餐' }),
            h('th', { text: '状态' }), h('th', { text: '成员' }), h('th', { text: '项目' }),
          ])]),
          tbody,
        ]),
      ]),
    ],
  });
  renderShell('orgs', content);
  rows();
}

function statCard(k, v, hint) {
  return h('div.stat-card', {}, [
    h('div.k', { text: k }),
    h('div.v', {}, [String(v), hint ? h('small', { text: hint }) : null]),
  ]);
}

function openCreateOrg() {
  const errEl = h('div.form-error');
  const nameEl = h('input.txt', { placeholder: '企业名称' });
  const slugEl = h('input.txt', { placeholder: '可选，自动生成' });
  const planEl = h('input.txt', { placeholder: 'standard', value: 'standard' });
  const ownerEl = h('input.txt', { type: 'email', placeholder: '可选，指定 owner 邮箱' });
  const inviteChk = h('input', { type: 'checkbox' });

  const submitBtn = h('button.btn.primary', {}, ['创建']);
  const cancelBtn = h('button.btn', {}, ['取消']);

  const body = [
    h('label.field', {}, [h('span', { text: '企业名称' }), nameEl]),
    h('label.field', {}, [h('span', { text: 'Slug（唯一标识）' }), slugEl]),
    h('label.field', {}, [h('span', { text: '套餐' }), planEl]),
    h('label.field', {}, [h('span', { text: '指定 Owner（邮箱）' }), ownerEl]),
    h('label.field', { style: 'display:flex;align-items:center;gap:8px;' }, [
      inviteChk, h('span', { text: '同时生成一个 Owner 邀请码', style: 'text-transform:none;letter-spacing:0;margin:0;' }),
    ]),
    errEl,
  ];

  const { close } = openModal({
    title: '创建企业',
    subtitle: '新建一个企业租户。Owner 可现在指定，也可稍后通过邀请码加入。',
    body,
    footer: [cancelBtn, submitBtn],
  });
  cancelBtn.addEventListener('click', close);

  submitBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    const name = nameEl.value.trim();
    if (!name) { errEl.textContent = '请填写企业名称'; return; }
    submitBtn.disabled = true;
    submitBtn.textContent = '创建中…';
    try {
      const payload = { name };
      if (slugEl.value.trim()) payload.slug = slugEl.value.trim();
      if (planEl.value.trim()) payload.plan = planEl.value.trim();
      if (ownerEl.value.trim()) payload.ownerEmail = ownerEl.value.trim();
      if (inviteChk.checked) payload.createOwnerInvite = true;
      const res = await post('/api/platform/orgs', payload);
      close();
      if (res.ownerInvite?.code) {
        showInviteResult(res.ownerInvite, res.org);
      } else {
        toast('企业已创建');
      }
      resolve();
    } catch (err) {
      errEl.textContent = String(err?.message || err);
      submitBtn.disabled = false;
      submitBtn.textContent = '创建';
    }
  });
}

function showInviteResult(invite, org) {
  const copyBtn = h('button.btn', {}, ['复制邀请码']);
  copyBtn.addEventListener('click', () => copy(invite.code));
  const doneBtn = h('button.btn.primary', {}, ['完成']);
  const { close } = openModal({
    title: `企业「${org?.name || ''}」已创建`,
    subtitle: '把下面的 Owner 邀请码发给企业负责人，对方注册后即成为 Owner。',
    body: [
      h('div.codebox', {}, [
        h('div.code', { text: invite.code }),
        h('div.meta', { text: `Owner · 可用 ${invite.maxUses} 次${invite.expiresAt ? ` · ${fmtDate(invite.expiresAt)} 过期` : ''}` }),
      ]),
    ],
    footer: [copyBtn, doneBtn],
  });
  doneBtn.addEventListener('click', close);
}

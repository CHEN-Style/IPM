// Org detail: basic info, members, recent platform events, plus lifecycle
// actions (disable/restore, assign owner, create invite code).

import { h, clear, toast, copy, fmtDate, fmtRelative, avatar } from '../util.js';
import { get, post } from '../api.js';
import { navigate } from '../router.js';
import { renderShell, page } from '../shell.js';
import { openModal } from '../modal.js';
import { EVENT_LABELS } from './audit.js';

const ROLE_TAG = {
  owner: ['tag warn', 'Owner'],
  admin: ['tag', 'Admin'],
  member: ['tag', 'Member'],
};

export async function renderOrgDetail({ id }) {
  renderShell('orgs', h('div.page', {}, [h('div.empty', { text: '加载中…' })]));

  let org = null;
  let events = [];
  try {
    const [detailRes, eventsRes] = await Promise.all([
      get(`/api/platform/orgs/${id}`),
      get(`/api/platform/events?orgId=${encodeURIComponent(id)}&limit=15`).catch(() => ({ events: [] })),
    ]);
    org = detailRes.org;
    events = eventsRes.events || [];
  } catch (err) {
    renderShell('orgs', page({ title: '企业详情', children: [h('div.warnbox', { text: String(err?.message || err) })] }));
    return;
  }

  const reload = () => renderOrgDetail({ id });
  const active = org.status === 'active';

  const statusTag = active
    ? h('span.tag.good', {}, [h('span.dot'), '正常'])
    : h('span.tag.danger', {}, [h('span.dot'), '已停用']);

  const actions = [
    h('button.btn', { onclick: () => openAssignOwner(id, reload) }, ['指定 Owner']),
    h('button.btn', { onclick: () => openCreateInvite(id) }, ['生成邀请码']),
    active
      ? h('button.btn.ghost-danger', { onclick: () => confirmStatus(id, 'disable', org.name, reload) }, ['停用企业'])
      : h('button.btn.primary', { onclick: () => confirmStatus(id, 'restore', org.name, reload) }, ['恢复企业']),
  ];

  const back = h('div.back-link', { onclick: () => navigate('#/orgs') }, ['← 返回企业列表']);

  const info = h('dl.kv', {}, [
    h('dt', { text: '企业名称' }), h('dd', {}, [org.name, ' ', statusTag]),
    h('dt', { text: 'Slug' }), h('dd', {}, [h('span.mono', { text: org.slug })]),
    h('dt', { text: '套餐' }), h('dd', { text: org.plan }),
    h('dt', { text: '云端项目' }), h('dd', { text: String(org.workspaceCount) }),
    h('dt', { text: '成员数' }), h('dd', { text: String((org.members || []).length) }),
    h('dt', { text: '创建于' }), h('dd', { text: fmtDate(org.createdAt || org.created_at) }),
  ]);

  const memberRows = (org.members || []).map((m) => {
    const [cls, label] = ROLE_TAG[m.role] || ['tag', m.role];
    return h('tr', {}, [
      h('td', {}, [h('div.cell-user', {}, [
        avatar(m.displayName || m.email, m.userId),
        h('div.nm', {}, [h('b', { text: m.displayName || '—' }), h('small', { text: m.email })]),
      ])]),
      h('td', {}, [h('span', { class: cls, text: label })]),
      h('td', {}, [m.status === 'active'
        ? h('span.tag.good', {}, [h('span.dot'), '正常'])
        : h('span.tag.danger', {}, [h('span.dot'), '已停用'])]),
      h('td', { text: fmtDate(m.joinedAt) }),
    ]);
  });

  const membersTable = h('div.card', {}, [
    h('table', {}, [
      h('thead', {}, [h('tr', {}, [
        h('th', { text: '成员' }), h('th', { text: '角色' }), h('th', { text: '状态' }), h('th', { text: '加入时间' }),
      ])]),
      h('tbody', {}, memberRows.length ? memberRows : [h('tr', {}, [h('td', { colspan: '4' }, [h('div.empty', { text: '暂无成员' })])])]),
    ]),
  ]);

  const eventRows = events.map((ev) =>
    h('tr', {}, [
      h('td', {}, [h('span.tag', { text: EVENT_LABELS[ev.eventType] || ev.eventType })]),
      h('td', { text: ev.actorEmail || ev.actorName || '系统' }),
      h('td', { text: fmtRelative(ev.createdAt) }),
    ]),
  );
  const eventsTable = h('div.card', {}, [
    h('table', {}, [
      h('thead', {}, [h('tr', {}, [h('th', { text: '动作' }), h('th', { text: '操作者' }), h('th', { text: '时间' })])]),
      h('tbody', {}, eventRows.length ? eventRows : [h('tr', {}, [h('td', { colspan: '3' }, [h('div.empty', { text: '暂无平台事件' })])])]),
    ]),
  ]);

  const content = page({
    title: org.name,
    subtitle: '企业租户详情与生命周期管理。',
    actions,
    children: [
      back,
      info,
      h('div.section-title', { text: '成员' }),
      membersTable,
      h('div.section-title', { text: '最近平台事件' }),
      eventsTable,
    ],
  });
  renderShell('orgs', content);
}

function confirmStatus(id, action, name, reload) {
  const isDisable = action === 'disable';
  const cancelBtn = h('button.btn', {}, ['取消']);
  const okBtn = h('button', { class: isDisable ? 'btn danger' : 'btn primary' }, [isDisable ? '确认停用' : '确认恢复']);
  const { close } = openModal({
    title: isDisable ? `停用企业「${name}」？` : `恢复企业「${name}」？`,
    width: 420,
    body: [
      isDisable
        ? h('div.warnbox', {}, ['停用后该企业所有成员将立即无法登录、同步与访问云端资源。可随时恢复。'])
        : h('div', { class: 'muted', text: '恢复后该企业成员可重新登录与同步。' }),
    ],
    footer: [cancelBtn, okBtn],
  });
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', async () => {
    okBtn.disabled = true;
    try {
      await post(`/api/platform/orgs/${id}/${action}`);
      toast(isDisable ? '企业已停用' : '企业已恢复');
      close();
      reload();
    } catch (err) {
      toast(String(err?.message || err), 'error');
      okBtn.disabled = false;
    }
  });
}

function openAssignOwner(id, reload) {
  const errEl = h('div.form-error');
  const emailEl = h('input.txt', { type: 'email', placeholder: 'owner@company.com' });
  const cancelBtn = h('button.btn', {}, ['取消']);
  const okBtn = h('button.btn.primary', {}, ['指定为 Owner']);
  const { close } = openModal({
    title: '指定企业 Owner',
    subtitle: '按邮箱将一个已注册用户设为该企业 Owner（允许多个 Owner）。',
    body: [h('label.field', {}, [h('span', { text: '用户邮箱' }), emailEl]), errEl],
    footer: [cancelBtn, okBtn],
  });
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    const email = emailEl.value.trim();
    if (!email) { errEl.textContent = '请填写邮箱'; return; }
    okBtn.disabled = true;
    try {
      await post(`/api/platform/orgs/${id}/owner`, { email });
      toast('已指定 Owner');
      close();
      reload();
    } catch (err) {
      errEl.textContent = String(err?.message || err);
      okBtn.disabled = false;
    }
  });
}

function openCreateInvite(id) {
  const errEl = h('div.form-error');
  const roleEl = h('select.txt', {}, [
    h('option', { value: 'member', text: 'Member · 普通成员' }),
    h('option', { value: 'admin', text: 'Admin · 管理员' }),
    h('option', { value: 'owner', text: 'Owner · 企业所有者' }),
  ]);
  const usesEl = h('input.txt', { type: 'number', value: '10', min: '1' });
  const daysEl = h('input.txt', { type: 'number', value: '30', min: '1' });
  const cancelBtn = h('button.btn', {}, ['取消']);
  const okBtn = h('button.btn.primary', {}, ['生成邀请码']);
  const { close } = openModal({
    title: '生成邀请码',
    subtitle: '生成后发给对应人员，注册后自动加入该企业。',
    body: [
      h('label.field', {}, [h('span', { text: '角色' }), roleEl]),
      h('label.field', {}, [h('span', { text: '可使用次数' }), usesEl]),
      h('label.field', {}, [h('span', { text: '有效期（天）' }), daysEl]),
      errEl,
    ],
    footer: [cancelBtn, okBtn],
  });
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    okBtn.disabled = true;
    try {
      const res = await post(`/api/platform/orgs/${id}/invites`, {
        role: roleEl.value,
        maxUses: Math.max(1, parseInt(usesEl.value, 10) || 10),
        expiresDays: Math.max(1, parseInt(daysEl.value, 10) || 30),
      });
      close();
      const inv = res.invite;
      const copyBtn = h('button.btn', {}, ['复制邀请码']);
      copyBtn.addEventListener('click', () => copy(inv.code));
      const doneBtn = h('button.btn.primary', {}, ['完成']);
      const m = openModal({
        title: '邀请码已生成',
        body: [h('div.codebox', {}, [
          h('div.code', { text: inv.code }),
          h('div.meta', { text: `${inv.role} · 可用 ${inv.maxUses} 次${inv.expiresAt ? ` · ${fmtDate(inv.expiresAt)} 过期` : ''}` }),
        ])],
        footer: [copyBtn, doneBtn],
      });
      doneBtn.addEventListener('click', m.close);
    } catch (err) {
      errEl.textContent = String(err?.message || err);
      okBtn.disabled = false;
    }
  });
}

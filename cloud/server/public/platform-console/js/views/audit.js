// Platform audit feed: `platform.*` events across all orgs, with type filter
// and cursor pagination.

import { h, clear, toast, fmtDate, fmtRelative } from '../util.js';
import { get } from '../api.js';
import { renderShell, page } from '../shell.js';

export const EVENT_LABELS = {
  'platform.org_created': '创建企业',
  'platform.org_disabled': '停用企业',
  'platform.org_restored': '恢复企业',
  'platform.owner_assigned': '指定 Owner',
  'platform.invite_created': '创建邀请码',
  'platform.admin_granted': '授予平台管理员',
  'platform.admin_revoked': '撤销平台管理员',
};

const TYPE_FILTERS = [
  { value: '', label: '全部平台活动' },
  { value: 'platform.org_created', label: '创建企业' },
  { value: 'platform.org_disabled', label: '停用企业' },
  { value: 'platform.org_restored', label: '恢复企业' },
  { value: 'platform.owner_assigned', label: '指定 Owner' },
  { value: 'platform.invite_created', label: '创建邀请码' },
];

export async function renderAudit() {
  let type = '';
  let events = [];
  let nextBefore = null;
  let hasMore = false;

  const tbody = h('tbody');
  const moreWrap = h('div', { style: 'display:flex;justify-content:center;margin-top:12px;' });

  function renderRows() {
    clear(tbody);
    if (events.length === 0) {
      tbody.append(h('tr', {}, [h('td', { colspan: '4' }, [h('div.empty', { text: '暂无平台审计记录' })])]));
      return;
    }
    for (const ev of events) {
      tbody.append(h('tr', {}, [
        h('td', {}, [h('span.tag', { text: EVENT_LABELS[ev.eventType] || ev.eventType })]),
        h('td', { text: ev.actorEmail || ev.actorName || '系统' }),
        h('td', { text: ev.orgName || '—' }),
        h('td', { text: fmtRelative(ev.createdAt), title: fmtDate(ev.createdAt) }),
      ]));
    }
  }

  function renderMore() {
    clear(moreWrap);
    if (!hasMore) return;
    const btn = h('button.btn', {}, ['加载更多']);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const res = await get(`/api/platform/events?limit=30${type ? `&type=${encodeURIComponent(type)}` : ''}${nextBefore ? `&before=${encodeURIComponent(nextBefore)}` : ''}`);
        events = events.concat(res.events || []);
        hasMore = Boolean(res.hasMore);
        nextBefore = res.nextBefore || null;
        renderRows();
        renderMore();
      } catch (err) {
        toast(String(err?.message || err), 'error');
        btn.disabled = false;
      }
    });
    moreWrap.append(btn);
  }

  async function load() {
    try {
      const res = await get(`/api/platform/events?limit=30${type ? `&type=${encodeURIComponent(type)}` : ''}`);
      events = res.events || [];
      hasMore = Boolean(res.hasMore);
      nextBefore = res.nextBefore || null;
      renderRows();
      renderMore();
    } catch (err) {
      toast(String(err?.message || err), 'error');
    }
  }

  const select = h('select.txt', { style: 'width:auto;', onchange: (e) => { type = e.target.value; load(); } },
    TYPE_FILTERS.map((t) => h('option', { value: t.value, text: t.label })));

  const content = page({
    title: '平台审计',
    subtitle: '平台级关键操作流水（创建/停用企业、指定 Owner、管理员变更等）。',
    actions: [select],
    children: [
      h('div.card', {}, [h('table', {}, [
        h('thead', {}, [h('tr', {}, [
          h('th', { text: '动作' }), h('th', { text: '操作者' }), h('th', { text: '企业' }), h('th', { text: '时间' }),
        ])]),
        tbody,
      ])]),
      moreWrap,
    ],
  });
  renderShell('audit', content);
  await load();
}

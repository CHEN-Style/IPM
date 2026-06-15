// H7 verification: enterprise stats/audit APIs (owner/admin gated), platform
// audit/stats APIs (platform-admin gated), access-control 403s, and anonymous
// loading of the static platform-console shell.
//
// Prereqs: dev server running (npm run dev), postgres up, migrations applied.
// Usage:   node scripts/h7-verify.mjs [baseUrl]

import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] || 'http://localhost:4210';
const tag = Date.now().toString(36);

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${label}`);
  }
}

async function api(method, p, { token, body } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

function cli(...args) {
  return execFileSync('npx', ['tsx', 'src/modules/platform/platform-cli.ts', ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

function extract(re, text, label) {
  const m = re.exec(text);
  if (!m) throw new Error(`无法从 CLI 输出解析 ${label}: ${text}`);
  return m[1];
}

async function register(invite, email, name) {
  const res = await api('POST', '/api/auth/register', {
    body: { inviteCode: invite, email, password: 'test123456', displayName: name },
  });
  if (res.status !== 201) throw new Error(`注册失败 ${email}: ${res.status} ${JSON.stringify(res.json)}`);
  return { token: res.json.accessToken, userId: res.json.user.id, email };
}

async function main() {
  console.log(`[h7-verify] base=${BASE} tag=${tag}`);

  // ── 1. Bootstrap org + owner/admin/member ─────────────────────────────────
  console.log('\n— 初始化(企业 + owner/admin/member)—');
  const out = cli('org:create', '--name', `H7测试企业-${tag}`, '--owner-invite');
  const ownerInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out, 'ownerInvite');
  const O = await register(ownerInvite, `h7o-${tag}@test.local`, 'H7-Owner');

  const invAdmin = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'admin', maxUses: 5 } });
  const A = await register(invAdmin.json.invite.code, `h7a-${tag}@test.local`, 'H7-Admin');
  const invMember = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'member', maxUses: 5 } });
  const M = await register(invMember.json.invite.code, `h7m-${tag}@test.local`, 'H7-Member');

  // Grant platform admin to the owner so they can drive the platform API.
  cli('admin:grant', '--email', O.email, '--note', `h7-${tag}`);

  // ── 2. Enterprise stats ────────────────────────────────────────────────────
  console.log('\n— 企业 stats(owner/admin)—');
  const stats = await api('GET', '/api/org/stats', { token: O.token });
  assert(stats.status === 200 && stats.json?.ok, 'owner 读取 stats(200)');
  assert(stats.json?.stats?.members?.total >= 3, `成员总数≥3(实际 ${stats.json?.stats?.members?.total})`);
  assert(stats.json?.stats?.members?.active >= 3, `活跃成员≥3(实际 ${stats.json?.stats?.members?.active})`);
  assert((stats.json?.stats?.members?.byRole?.owner ?? 0) >= 1, 'owner 角色计数≥1');
  assert((stats.json?.stats?.members?.byRole?.admin ?? 0) >= 1, 'admin 角色计数≥1');

  const statsAdmin = await api('GET', '/api/org/stats', { token: A.token });
  assert(statsAdmin.status === 200 && statsAdmin.json?.ok, 'admin 读取 stats(200)');

  const statsMember = await api('GET', '/api/org/stats', { token: M.token });
  assert(statsMember.status === 403, '成员读取 stats 被拒(403)');

  // ── 3. Enterprise audit events ─────────────────────────────────────────────
  console.log('\n— 企业 events(过滤/分页/网关)—');
  const events = await api('GET', '/api/org/events', { token: O.token });
  assert(events.status === 200 && Array.isArray(events.json?.events), 'owner 读取 events(200)');
  assert(events.json.events.length > 0, `events 非空(实际 ${events.json?.events?.length})`);

  const filtered = await api('GET', '/api/org/events?type=org.invite_created', { token: O.token });
  assert(filtered.status === 200, '按 type 过滤 events(200)');
  assert(
    (filtered.json.events || []).every((e) => e.eventType === 'org.invite_created'),
    '过滤结果全部为 org.invite_created',
  );
  assert((filtered.json.events || []).length >= 2, `邀请码事件≥2(实际 ${filtered.json?.events?.length})`);

  const page1 = await api('GET', '/api/org/events?limit=1', { token: O.token });
  assert(page1.status === 200 && page1.json.events.length === 1, '分页 limit=1 返回 1 条');
  assert(page1.json.hasMore === true && page1.json.nextBefore, '分页 hasMore/nextBefore 正确');
  const page2 = await api('GET', `/api/org/events?limit=1&before=${encodeURIComponent(page1.json.nextBefore)}`, { token: O.token });
  assert(page2.status === 200 && page2.json.events.length === 1, '游标翻页返回下一条');
  assert(page2.json.events[0].id !== page1.json.events[0].id, '翻页结果不重复');

  const eventsMember = await api('GET', '/api/org/events', { token: M.token });
  assert(eventsMember.status === 403, '成员读取 events 被拒(403)');

  // ── 4. Platform audit + stats ──────────────────────────────────────────────
  console.log('\n— 平台 events/stats(platform_admin 网关)—');
  const platEvents = await api('GET', '/api/platform/events', { token: O.token });
  assert(platEvents.status === 200 && Array.isArray(platEvents.json?.events), '平台管理员读取平台 events(200)');
  assert(
    (platEvents.json.events || []).every((e) => String(e.eventType).startsWith('platform.')),
    '平台 events 全部为 platform.* 类型',
  );

  const platStats = await api('GET', '/api/platform/stats', { token: O.token });
  assert(platStats.status === 200 && platStats.json?.stats?.orgs?.total >= 1, '平台 stats(200)，企业总数≥1');

  const platEventsMember = await api('GET', '/api/platform/events', { token: M.token });
  assert(platEventsMember.status === 403, '非平台管理员读取平台 events 被拒(403)');
  const platStatsMember = await api('GET', '/api/platform/stats', { token: M.token });
  assert(platStatsMember.status === 403, '非平台管理员读取平台 stats 被拒(403)');

  // ── 5. Platform org lifecycle via API ──────────────────────────────────────
  console.log('\n— 平台企业生命周期(create/disable/restore)—');
  const created = await api('POST', '/api/platform/orgs', { token: O.token, body: { name: `H7-API企业-${tag}` } });
  assert(created.status === 201 && created.json?.org?.orgId, '平台 API 创建企业(201)');
  const newOrgId = created.json.org.orgId;
  const disabled = await api('POST', `/api/platform/orgs/${newOrgId}/disable`, { token: O.token, body: {} });
  assert(disabled.status === 200 && disabled.json?.org?.status === 'disabled', '停用企业(200)');
  const restored = await api('POST', `/api/platform/orgs/${newOrgId}/restore`, { token: O.token, body: {} });
  assert(restored.status === 200 && restored.json?.org?.status === 'active', '恢复企业(200)');

  // ── 6. Static console shell loads anonymously ───────────────────────────────
  console.log('\n— 平台控制台壳匿名加载 —');
  const shell = await fetch(`${BASE}/platform-console/`);
  const shellHtml = await shell.text();
  assert(shell.status === 200, '/platform-console/ 匿名加载(200)');
  assert(/平台控制台/.test(shellHtml), '壳 HTML 含标题文案');
  const css = await fetch(`${BASE}/platform-console/app.css`);
  assert(css.status === 200, '/platform-console/app.css(200)');
  const appJs = await fetch(`${BASE}/platform-console/js/app.js`);
  assert(appJs.status === 200, '/platform-console/js/app.js(200)');
  const redirect = await fetch(`${BASE}/platform-console`, { redirect: 'manual' });
  assert(redirect.status >= 300 && redirect.status < 400, '/platform-console 重定向到 /platform-console/');

  // ── summary ────────────────────────────────────────────────────────────────
  console.log(`\n[h7-verify] 通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[h7-verify] 异常:', err);
  process.exit(1);
});

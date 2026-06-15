// H2 verification: org member & invite management permission matrix.
//
// Prereqs: dev server running (npm run dev), postgres up, migrations applied.
// Usage:   node scripts/h2-verify.mjs [baseUrl]

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

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
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
  console.log(`[h2-verify] base=${BASE} tag=${tag}`);

  // ── 1. Bootstrap: org + owner ──────────────────────────────────────────
  console.log('\n— 初始化(平台 CLI 建企业,注册 owner)—');
  const out = cli('org:create', '--name', `H2测试企业-${tag}`, '--owner-invite');
  const orgId = extract(/已创建企业: .* \(([0-9a-f-]{36})\)/, out, 'orgId');
  const ownerInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out, 'ownerInvite');
  const O = await register(ownerInvite, `h2o-${tag}@test.local`, 'H2-Owner');
  assert(Boolean(orgId && O.token), `企业创建 + owner 注册 (${orgId})`);

  // ── 2. Invites: owner creates member & admin codes ─────────────────────
  console.log('\n— 邀请码创建权限 —');
  const invM = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'member', maxUses: 5, expiresDays: 7 } });
  assert(invM.status === 201 && invM.json?.invite?.code, 'owner 创建 member 邀请码 → 201');
  const invA = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'admin', maxUses: 2, expiresDays: 7 } });
  assert(invA.status === 201, 'owner 创建 admin 邀请码 → 201');

  const M1 = await register(invM.json.invite.code, `h2m1-${tag}@test.local`, 'H2-Member1');
  const M2 = await register(invM.json.invite.code, `h2m2-${tag}@test.local`, 'H2-Member2');
  const A1 = await register(invA.json.invite.code, `h2a1-${tag}@test.local`, 'H2-Admin1');

  const invByAdmin = await api('POST', '/api/org/invites', { token: A1.token, body: { role: 'member', maxUses: 3 } });
  assert(invByAdmin.status === 201, 'admin 创建 member 邀请码 → 201');
  const invAdminByAdmin = await api('POST', '/api/org/invites', { token: A1.token, body: { role: 'admin' } });
  assert(
    invAdminByAdmin.status === 403 && invAdminByAdmin.json?.code === 'ORG_FORBIDDEN',
    'admin 创建 admin 邀请码 → 403 ORG_FORBIDDEN',
  );
  const invByMember = await api('POST', '/api/org/invites', { token: M1.token, body: { role: 'member' } });
  assert(invByMember.status === 403, 'member 创建邀请码 → 403');

  // ── 3. Org info & member list visibility ───────────────────────────────
  console.log('\n— 可见性 —');
  const infoAsMember = await api('GET', '/api/org', { token: M1.token });
  assert(infoAsMember.status === 200 && infoAsMember.json?.myRole === 'member', 'member 可读企业信息(GET /api/org)');
  const listAsMember = await api('GET', '/api/org/members', { token: M1.token });
  assert(listAsMember.status === 403 && listAsMember.json?.code === 'ORG_FORBIDDEN', 'member 读成员列表 → 403');
  const listAsAdmin = await api('GET', '/api/org/members', { token: A1.token });
  assert(
    listAsAdmin.status === 200 && (listAsAdmin.json?.members || []).length === 4,
    `admin 读成员列表 → 200,共 ${(listAsAdmin.json?.members || []).length} 人`,
  );

  // ── 4. Role changes ────────────────────────────────────────────────────
  console.log('\n— 角色调整 —');
  const roleByAdmin = await api('POST', `/api/org/members/${M1.userId}/role`, { token: A1.token, body: { role: 'admin' } });
  assert(roleByAdmin.status === 403, 'admin 调整角色 → 403(仅 owner)');
  const promote = await api('POST', `/api/org/members/${M1.userId}/role`, { token: O.token, body: { role: 'admin' } });
  assert(promote.status === 200 && promote.json?.role === 'admin', 'owner 提升 member → admin');
  const demote = await api('POST', `/api/org/members/${M1.userId}/role`, { token: O.token, body: { role: 'member' } });
  assert(demote.status === 200, 'owner 降级 admin → member');
  const touchOwner = await api('POST', `/api/org/members/${O.userId}/role`, { token: O.token, body: { role: 'member' } });
  assert(touchOwner.status === 403 && touchOwner.json?.code === 'OWNER_IMMUTABLE', '调整 owner 角色 → 403 OWNER_IMMUTABLE');

  // ── 5. Disable / restore ───────────────────────────────────────────────
  console.log('\n— 停用与恢复 —');
  const disableOwner = await api('POST', `/api/org/members/${O.userId}/disable`, { token: A1.token, body: {} });
  assert(disableOwner.status === 403 && disableOwner.json?.code === 'OWNER_IMMUTABLE', 'admin 停用 owner → 403 OWNER_IMMUTABLE');
  const disableSelf = await api('POST', `/api/org/members/${A1.userId}/disable`, { token: A1.token, body: {} });
  assert(disableSelf.status === 403 && disableSelf.json?.code === 'CANNOT_DISABLE_SELF', 'admin 停用自己 → 403 CANNOT_DISABLE_SELF');

  const disableM2 = await api('POST', `/api/org/members/${M2.userId}/disable`, { token: A1.token, body: {} });
  assert(disableM2.status === 200, 'admin 停用 member → 200');
  const m2Blocked = await api('GET', '/api/workspaces', { token: M2.token });
  assert(m2Blocked.status === 403 && m2Blocked.json?.code === 'MEMBER_DISABLED', '被停用成员调协作 API → 403 MEMBER_DISABLED(即时生效)');
  const m2Login = await api('POST', '/api/auth/login', { body: { email: M2.email, password: 'test123456' } });
  assert(m2Login.status === 403, '被停用成员登录 → 403');

  const restoreM2 = await api('POST', `/api/org/members/${M2.userId}/restore`, { token: A1.token, body: {} });
  assert(restoreM2.status === 200, 'admin 恢复 member → 200');
  const m2LoginOk = await api('POST', '/api/auth/login', { body: { email: M2.email, password: 'test123456' } });
  assert(m2LoginOk.status === 200, '恢复后成员可重新登录');

  // admin-level disable is owner-only.
  const disableAdminByAdmin = await api('POST', `/api/org/members/${A1.userId}/disable`, { token: A1.token, body: {} });
  assert(disableAdminByAdmin.status === 403, 'admin 停用 admin(自己以外同理)→ 403');
  const disableAdminByOwner = await api('POST', `/api/org/members/${A1.userId}/disable`, { token: O.token, body: {} });
  assert(disableAdminByOwner.status === 200, 'owner 停用 admin → 200');
  const restoreAdminByOwner = await api('POST', `/api/org/members/${A1.userId}/restore`, { token: O.token, body: {} });
  assert(restoreAdminByOwner.status === 200, 'owner 恢复 admin → 200');

  // ── 6. Invite revoke ───────────────────────────────────────────────────
  console.log('\n— 邀请码撤销 —');
  const invR = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'member', maxUses: 5 } });
  const revoke = await api('POST', `/api/org/invites/${invR.json.invite.id}/revoke`, { token: O.token, body: {} });
  assert(revoke.status === 200 && revoke.json?.revoked === true, 'owner 撤销邀请码 → 200');
  const regRevoked = await api('POST', '/api/auth/register', {
    body: { inviteCode: invR.json.invite.code, email: `h2x-${tag}@test.local`, password: 'test123456', displayName: 'X' },
  });
  assert(
    regRevoked.status === 400 && regRevoked.json?.code === 'INVITE_REVOKED',
    '撤销的邀请码无法注册 → 400 INVITE_REVOKED',
  );
  const invList = await api('GET', '/api/org/invites', { token: O.token });
  const revokedRow = (invList.json?.invites || []).find((i) => i.id === invR.json.invite.id);
  assert(invList.status === 200 && Boolean(revokedRow?.revokedAt), '邀请码列表含撤销状态与使用情况');

  // ── 7. Cross-org isolation sanity ──────────────────────────────────────
  console.log('\n— 跨组织隔离(回归)—');
  const out2 = cli('org:create', '--name', `H2隔离企业-${tag}`, '--owner-invite');
  const otherInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out2, 'otherInvite');
  const OTHER = await register(otherInvite, `h2other-${tag}@test.local`, 'H2-Other');
  const crossDisable = await api('POST', `/api/org/members/${M1.userId}/disable`, { token: OTHER.token, body: {} });
  assert(crossDisable.status === 404, '他企业 owner 操作本企业成员 → 404(组织隔离)');

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n[h2-verify] 通过 ${passed} 项, 失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[h2-verify] 异常:', err);
  process.exit(1);
});

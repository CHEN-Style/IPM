// H4 verification: workspace visibility model + invite codes + owner
// self-service management (A10 closure).
//
// Prereqs: dev server running (npm run dev), postgres up, migrations applied.
// Usage:   node scripts/h4-verify.mjs [baseUrl]

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
  console.log(`[h4-verify] base=${BASE} tag=${tag}`);

  // ── 1. Bootstrap ────────────────────────────────────────────────────────
  console.log('\n— 初始化(企业 + 6 名用户)—');
  const out = cli('org:create', '--name', `H4测试企业-${tag}`, '--owner-invite');
  const ownerInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out, 'ownerInvite');
  const O = await register(ownerInvite, `h4o-${tag}@test.local`, 'H4-OrgOwner');

  const invM = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'member', maxUses: 10 } });
  const P = await register(invM.json.invite.code, `h4p-${tag}@test.local`, 'H4-ProjOwner');
  const E = await register(invM.json.invite.code, `h4e-${tag}@test.local`, 'H4-InviteEditor');
  const V = await register(invM.json.invite.code, `h4v-${tag}@test.local`, 'H4-PublicViewer');
  const N = await register(invM.json.invite.code, `h4n-${tag}@test.local`, 'H4-NonMember');
  const X = await register(invM.json.invite.code, `h4x-${tag}@test.local`, 'H4-UsageCap');

  const wsRes = await api('POST', '/api/workspaces', { token: P.token, body: { name: `H4项目-${tag}`, domain: 'projects' } });
  const wsId = wsRes.json?.workspace?.id;
  assert(wsRes.status === 201 && wsId, `项目创建(${wsId})`);
  const v1 = await api('POST', `/api/workspaces/${wsId}/versions`, {
    token: P.token,
    body: { message: 'v1', entries: [{ entryType: 'folder', path: '/docs', name: 'docs' }] },
  });
  assert(v1.status === 201, '项目 owner 推送 v1 → 201');

  // ── 2. Private by default; invisible to non-members ───────────────────
  console.log('\n— 私有默认 + 非成员不可见 —');
  const listP = await api('GET', '/api/workspaces', { token: P.token });
  const rowP = (listP.json?.workspaces || []).find((w) => w.id === wsId);
  assert(rowP?.visibility === 'private' && rowP?.myRole === 'owner', '新项目默认 private,owner 在我的列表可见');
  const listN = await api('GET', '/api/workspaces', { token: N.token });
  assert(!(listN.json?.workspaces || []).some((w) => w.id === wsId), '非成员的「我的项目」列表不含私有项目');
  const pubN = await api('GET', '/api/workspaces/public', { token: N.token });
  assert(pubN.status === 200 && !(pubN.json?.workspaces || []).some((w) => w.id === wsId), '公开列表不含私有项目');
  const detailN = await api('GET', `/api/workspaces/${wsId}`, { token: N.token });
  assert(detailN.status === 404, '非成员读私有项目详情 → 404(隐藏存在)');
  const pullN = await api('GET', `/api/workspaces/${wsId}/versions/latest`, { token: N.token });
  assert(pullN.status === 404, '非成员 pull 私有项目 → 404');
  const joinN = await api('POST', `/api/workspaces/${wsId}/join`, { token: N.token, body: {} });
  assert(joinN.status === 404, '非成员自助加入私有项目 → 404');

  // ── 3. Invite codes: create / join=editor / usage / revoke ────────────
  console.log('\n— 邀请码:创建/加入=editor/用量/撤销 —');
  const invByNonOwner = await api('POST', `/api/workspaces/${wsId}/invites`, { token: N.token, body: {} });
  assert(invByNonOwner.status === 404, '非成员创建邀请码 → 404');
  const inv1 = await api('POST', `/api/workspaces/${wsId}/invites`, { token: P.token, body: { maxUses: 5, expiresInDays: 7 } });
  assert(inv1.status === 201 && /^WS-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(inv1.json?.invite?.code || ''), 'owner 生成邀请码 → 201(WS-XXXX-XXXX)');
  const code1 = inv1.json.invite.code;

  const badCode = await api('POST', '/api/workspaces/join-by-code', { token: E.token, body: { code: 'WS-XXXX-XXXX' } });
  assert(badCode.status === 400 && badCode.json?.code === 'INVALID_INVITE', '无效邀请码 → 400 INVALID_INVITE');
  const joinE = await api('POST', '/api/workspaces/join-by-code', { token: E.token, body: { code: code1 } });
  assert(joinE.status === 200 && joinE.json?.role === 'editor' && joinE.json?.workspaceId === wsId, '凭码加入 → 200,角色 editor');
  const joinEAgain = await api('POST', '/api/workspaces/join-by-code', { token: E.token, body: { code: code1 } });
  assert(joinEAgain.status === 200 && joinEAgain.json?.alreadyMember === true, '重复凭码加入 → alreadyMember,幂等');
  const pushE = await api('POST', `/api/workspaces/${wsId}/versions`, {
    token: E.token,
    body: { message: 'v2-by-editor', entries: [{ entryType: 'folder', path: '/docs', name: 'docs' }] },
  });
  assert(pushE.status === 201, '邀请码成员(editor)可推送 → 201');

  const invListE = await api('GET', `/api/workspaces/${wsId}/invites`, { token: E.token });
  assert(invListE.status === 403 && invListE.json?.code === 'NOT_WORKSPACE_OWNER', 'editor 查看邀请码列表 → 403(仅 owner)');
  const invList = await api('GET', `/api/workspaces/${wsId}/invites`, { token: P.token });
  const invRow = (invList.json?.invites || []).find((i) => i.code === code1);
  assert(invList.status === 200 && invRow?.usedCount === 1 && invRow?.active === true, '用量统计:used 1/5,active');

  // usage cap: maxUses=1 → second user rejected
  const capInv = await api('POST', `/api/workspaces/${wsId}/invites`, { token: P.token, body: { maxUses: 1 } });
  const joinX = await api('POST', '/api/workspaces/join-by-code', { token: X.token, body: { code: capInv.json.invite.code } });
  assert(joinX.status === 200 && joinX.json?.role === 'editor', 'maxUses=1 的码第一次使用 → 200');
  const joinN2 = await api('POST', '/api/workspaces/join-by-code', { token: N.token, body: { code: capInv.json.invite.code } });
  assert(joinN2.status === 400 && joinN2.json?.code === 'INVALID_INVITE', '超出可用次数 → 400 INVALID_INVITE');

  // revoke
  const revoke = await api('POST', `/api/workspaces/${wsId}/invites/${inv1.json.invite.id}/revoke`, { token: P.token, body: {} });
  assert(revoke.status === 200 && revoke.json?.revoked === true, 'owner 撤销邀请码 → 200');
  const joinRevoked = await api('POST', '/api/workspaces/join-by-code', { token: N.token, body: { code: code1 } });
  assert(joinRevoked.status === 400 && joinRevoked.json?.code === 'INVALID_INVITE', '撤销后的码 → 400 INVALID_INVITE');

  // ── 4. Public visibility: discoverable, self-join = viewer ────────────
  console.log('\n— 公开项目:可发现 + 自助加入=viewer —');
  const visByEditor = await api('POST', `/api/workspaces/${wsId}/visibility`, { token: E.token, body: { visibility: 'public' } });
  assert(visByEditor.status === 403 && visByEditor.json?.code === 'NOT_WORKSPACE_OWNER', 'editor 改可见性 → 403');
  const vis = await api('POST', `/api/workspaces/${wsId}/visibility`, { token: P.token, body: { visibility: 'public' } });
  assert(vis.status === 200 && vis.json?.changed === true, 'owner 设为公开 → 200');

  const pubN2 = await api('GET', '/api/workspaces/public', { token: N.token });
  const pubRow = (pubN2.json?.workspaces || []).find((w) => w.id === wsId);
  assert(Boolean(pubRow) && pubRow.isMember === false, '公开后:非成员在公开列表可见(isMember=false)');
  const joinV = await api('POST', `/api/workspaces/${wsId}/join`, { token: V.token, body: {} });
  assert(joinV.status === 200 && joinV.json?.role === 'viewer', '自助加入公开项目 → 200,角色 viewer');
  const pullV = await api('GET', `/api/workspaces/${wsId}/versions/latest`, { token: V.token });
  assert(pullV.status === 200, 'viewer 可 pull → 200');
  const histV = await api('GET', `/api/workspaces/${wsId}/versions`, { token: V.token });
  assert(histV.status === 200, 'viewer 可读版本历史 → 200');
  const pushV = await api('POST', `/api/workspaces/${wsId}/versions`, {
    token: V.token,
    body: { message: 'v3-by-viewer', entries: [] },
  });
  assert(pushV.status === 403, 'viewer 推送 → 403(只读)');
  const overviewV = await api('GET', `/api/workspaces/${wsId}/overview`, { token: V.token });
  assert(overviewV.status === 200 && overviewV.json?.myRole === 'viewer' && overviewV.json?.workspace?.visibility === 'public', 'overview 返回 myRole/visibility');

  // ── 5. Owner self-service: role change / remove ───────────────────────
  console.log('\n— owner 自助:提权/降权/移除 —');
  const membersV = await api('GET', `/api/workspaces/${wsId}/members`, { token: V.token });
  assert(membersV.status === 200 && (membersV.json?.members || []).length >= 4, '任意成员可读成员列表');
  const membersN = await api('GET', `/api/workspaces/${wsId}/members`, { token: N.token });
  assert(membersN.status === 404, '非成员读成员列表 → 404');

  const promoteByEditor = await api('POST', `/api/workspaces/${wsId}/members/${V.userId}/role`, { token: E.token, body: { role: 'editor' } });
  assert(promoteByEditor.status === 403 && promoteByEditor.json?.code === 'NOT_WORKSPACE_OWNER', 'editor 调他人权限 → 403');
  const promoteV = await api('POST', `/api/workspaces/${wsId}/members/${V.userId}/role`, { token: P.token, body: { role: 'editor' } });
  assert(promoteV.status === 200 && promoteV.json?.changed === true, 'owner 给 viewer 开通协作 → 200');
  const pushV2 = await api('POST', `/api/workspaces/${wsId}/versions`, {
    token: V.token,
    body: { message: 'v3-after-promote', entries: [{ entryType: 'folder', path: '/docs', name: 'docs' }] },
  });
  assert(pushV2.status === 201, '提权后原 viewer 可推送 → 201');
  const demoteV = await api('POST', `/api/workspaces/${wsId}/members/${V.userId}/role`, { token: P.token, body: { role: 'viewer' } });
  const pushV3 = await api('POST', `/api/workspaces/${wsId}/versions`, { token: V.token, body: { message: 'x', entries: [] } });
  assert(demoteV.status === 200 && pushV3.status === 403, '降回只读后推送 → 403');
  const changeOwnerRole = await api('POST', `/api/workspaces/${wsId}/members/${P.userId}/role`, { token: P.token, body: { role: 'editor' } });
  assert(changeOwnerRole.status === 409 && changeOwnerRole.json?.code === 'CANNOT_CHANGE_OWNER', '改 owner 自己的角色 → 409');

  const removeX = await api('POST', `/api/workspaces/${wsId}/members/${X.userId}/remove`, { token: P.token, body: {} });
  assert(removeX.status === 200, 'owner 移除成员 → 200');
  const xBlocked = await api('GET', `/api/workspaces/${wsId}/versions/latest`, { token: X.token });
  assert(xBlocked.status === 404, '被移除成员访问 → 404(即时生效)');

  // ── 6. Owner self-service: transfer ownership ─────────────────────────
  console.log('\n— owner 自助:转移所有权 —');
  const xferByEditor = await api('POST', `/api/workspaces/${wsId}/transfer-owner`, { token: E.token, body: { newOwnerId: E.userId } });
  assert(xferByEditor.status === 403 && xferByEditor.json?.code === 'NOT_WORKSPACE_OWNER', 'editor 转移所有权 → 403');
  const xfer = await api('POST', `/api/workspaces/${wsId}/transfer-owner`, { token: P.token, body: { newOwnerId: E.userId } });
  assert(xfer.status === 200 && xfer.json?.changed === true, 'owner 转移给 editor → 200');
  const invByNewOwner = await api('POST', `/api/workspaces/${wsId}/invites`, { token: E.token, body: { maxUses: 1 } });
  assert(invByNewOwner.status === 201, '新 owner 可生成邀请码 → 201');
  const invByOldOwner = await api('POST', `/api/workspaces/${wsId}/invites`, { token: P.token, body: { maxUses: 1 } });
  assert(invByOldOwner.status === 403 && invByOldOwner.json?.code === 'NOT_WORKSPACE_OWNER', '原 owner 已降为 editor → 403');

  // back to private: discovery + self-join close down again
  const visBack = await api('POST', `/api/workspaces/${wsId}/visibility`, { token: E.token, body: { visibility: 'private' } });
  assert(visBack.status === 200, '新 owner 改回私有 → 200');
  const pubN3 = await api('GET', '/api/workspaces/public', { token: N.token });
  assert(!(pubN3.json?.workspaces || []).some((w) => w.id === wsId), '改回私有后从公开列表消失');
  const joinN3 = await api('POST', `/api/workspaces/${wsId}/join`, { token: N.token, body: {} });
  assert(joinN3.status === 404, '改回私有后自助加入 → 404');
  const listV2 = await api('GET', '/api/workspaces', { token: V.token });
  assert((listV2.json?.workspaces || []).some((w) => w.id === wsId), '已加入成员不受可见性回收影响(仍在我的列表)');

  // ── 7. Archived: owner management writes blocked ──────────────────────
  console.log('\n— 归档项目:管理写操作受限 —');
  const arch = await api('POST', `/api/org/workspaces/${wsId}/archive`, { token: O.token, body: {} });
  assert(arch.status === 200, '企业 owner 归档项目 → 200');
  const invArchived = await api('POST', `/api/workspaces/${wsId}/invites`, { token: E.token, body: { maxUses: 1 } });
  assert(invArchived.status === 403 && invArchived.json?.code === 'WORKSPACE_ARCHIVED', '归档后生成邀请码 → 403');
  const visArchived = await api('POST', `/api/workspaces/${wsId}/visibility`, { token: E.token, body: { visibility: 'public' } });
  assert(visArchived.status === 403 && visArchived.json?.code === 'WORKSPACE_ARCHIVED', '归档后改可见性 → 403');
  const roleArchived = await api('POST', `/api/workspaces/${wsId}/members/${V.userId}/role`, { token: E.token, body: { role: 'editor' } });
  assert(roleArchived.status === 200, '归档后成员治理仍可用(与 H3 企业治理一致)');
  await api('POST', `/api/org/workspaces/${wsId}/restore`, { token: O.token, body: {} });

  // ── 8. Audit events ────────────────────────────────────────────────────
  console.log('\n— 审计事件 —');
  const detail = await api('GET', `/api/org/workspaces/${wsId}`, { token: O.token });
  const events = detail.json?.recentEvents || [];
  const evTypes = new Set(events.map((e) => e.eventType));
  for (const t of [
    'workspace.invite_created',
    'workspace.invite_revoked',
    'workspace.visibility_changed',
    'workspace.member_role_changed',
    'workspace.member_removed',
    'workspace.owner_transferred',
    'workspace.joined',
  ]) {
    assert(evTypes.has(t), `审计事件落表:${t}`);
  }
  const joinedEvents = events.filter((e) => e.eventType === 'workspace.joined');
  assert(
    joinedEvents.some((e) => e.payload?.via === 'invite_code') && joinedEvents.some((e) => e.payload?.via === 'public'),
    'workspace.joined 事件区分加入途径(invite_code / public)',
  );

  // ── 9. Cross-org isolation ─────────────────────────────────────────────
  console.log('\n— 跨企业隔离 —');
  const out2 = cli('org:create', '--name', `H4隔离企业-${tag}`, '--owner-invite');
  const otherInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out2, 'otherInvite');
  const OTHER = await register(otherInvite, `h4other-${tag}@test.local`, 'H4-Other');
  const crossInv = await api('POST', `/api/workspaces/${wsId}/invites`, { token: E.token, body: { maxUses: 1 } });
  const crossJoin = await api('POST', '/api/workspaces/join-by-code', { token: OTHER.token, body: { code: crossInv.json?.invite?.code } });
  assert(crossJoin.status === 400 && crossJoin.json?.code === 'INVALID_INVITE', '他企业用户凭本企业邀请码加入 → 400(不暴露项目)');
  const crossPub = await api('GET', '/api/workspaces/public', { token: OTHER.token });
  assert(!(crossPub.json?.workspaces || []).some((w) => w.id === wsId), '他企业公开列表不含本企业项目');

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n[h4-verify] 通过 ${passed} 项, 失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[h4-verify] 异常:', err);
  process.exit(1);
});

// H3 verification: workspace status semantics (A4) + enterprise governance.
//
// Prereqs: dev server running (npm run dev), postgres up, migrations applied.
// Usage:   node scripts/h3-verify.mjs [baseUrl]

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
  console.log(`[h3-verify] base=${BASE} tag=${tag}`);

  // ── 1. Bootstrap: org + owner/admin/members ────────────────────────────
  console.log('\n— 初始化(企业 + 4 名用户 + 1 个 workspace)—');
  const out = cli('org:create', '--name', `H3测试企业-${tag}`, '--owner-invite');
  const orgId = extract(/已创建企业: .* \(([0-9a-f-]{36})\)/, out, 'orgId');
  const ownerInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out, 'ownerInvite');
  const O = await register(ownerInvite, `h3o-${tag}@test.local`, 'H3-OrgOwner');

  const invA = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'admin', maxUses: 1 } });
  const invM = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'member', maxUses: 5 } });
  const A = await register(invA.json.invite.code, `h3a-${tag}@test.local`, 'H3-OrgAdmin');
  const P = await register(invM.json.invite.code, `h3p-${tag}@test.local`, 'H3-ProjOwner'); // org member, project owner
  const M = await register(invM.json.invite.code, `h3m-${tag}@test.local`, 'H3-ProjEditor'); // org member, project editor

  // P creates a workspace and commits v1; M joins as editor.
  const wsRes = await api('POST', '/api/workspaces', { token: P.token, body: { name: `H3项目-${tag}`, domain: 'projects' } });
  const wsId = wsRes.json?.workspace?.id;
  assert(wsRes.status === 201 && wsId, `项目创建(${wsId})`);
  // H4: self-join now only works for public workspaces — members of private
  // projects come in through a project invite code (grants editor).
  const inv = await api('POST', `/api/workspaces/${wsId}/invites`, { token: P.token, body: { maxUses: 5 } });
  const join = await api('POST', '/api/workspaces/join-by-code', { token: M.token, body: { code: inv.json?.invite?.code } });
  assert(join.status === 200 && join.json?.role === 'editor', '成员凭邀请码加入项目 → 200 editor');
  const v1 = await api('POST', `/api/workspaces/${wsId}/versions`, {
    token: P.token,
    body: { message: 'v1', entries: [{ entryType: 'folder', path: '/docs', name: 'docs' }] },
  });
  assert(v1.status === 201, '项目 owner 推送 v1 → 201');

  // ── 2. Governance API visibility & permissions ─────────────────────────
  console.log('\n— 治理 API 权限 —');
  const listAsMember = await api('GET', '/api/org/workspaces', { token: M.token });
  assert(listAsMember.status === 403 && listAsMember.json?.code === 'ORG_FORBIDDEN', 'member 调治理 API → 403');
  const listAsAdmin = await api('GET', '/api/org/workspaces', { token: A.token });
  const adminSeesWs = (listAsAdmin.json?.workspaces || []).find((w) => w.id === wsId);
  assert(listAsAdmin.status === 200 && Boolean(adminSeesWs), 'org admin 不是项目成员仍可见全量列表(不限加入)');
  assert(adminSeesWs?.owner?.userId === P.userId && adminSeesWs?.memberCount === 2, '列表含 owner/成员数等统计');
  const detail = await api('GET', `/api/org/workspaces/${wsId}`, { token: A.token });
  assert(
    detail.status === 200 && (detail.json?.members || []).length === 2 && Array.isArray(detail.json?.recentEvents),
    '详情含成员列表 + 事件简表',
  );

  // ── 3. A4: archived = read-only ────────────────────────────────────────
  console.log('\n— 三态:archived(只读)—');
  const arch = await api('POST', `/api/org/workspaces/${wsId}/archive`, { token: A.token, body: {} });
  assert(arch.status === 200 && arch.json?.status === 'archived', 'admin 归档项目 → 200');

  const pullArchived = await api('GET', `/api/workspaces/${wsId}/versions/latest`, { token: M.token });
  assert(pullArchived.status === 200, '归档后成员仍可 pull(versions/latest → 200)');
  const histArchived = await api('GET', `/api/workspaces/${wsId}/versions`, { token: M.token });
  assert(histArchived.status === 200, '归档后成员仍可读版本历史 → 200');
  const syncArchived = await api('GET', `/api/workspaces/${wsId}/sync-status`, { token: M.token });
  assert(syncArchived.status === 200 && syncArchived.json?.workspaceStatus === 'archived', 'sync-status 返回 workspaceStatus=archived');

  const pushArchived = await api('POST', `/api/workspaces/${wsId}/versions`, {
    token: P.token,
    body: { message: 'v2', entries: [] },
  });
  assert(pushArchived.status === 403 && pushArchived.json?.code === 'WORKSPACE_ARCHIVED', '归档后 push → 403 WORKSPACE_ARCHIVED');
  const foldersArchived = await api('POST', `/api/workspaces/${wsId}/folders`, { token: P.token, body: { folders: ['/x'] } });
  assert(foldersArchived.status === 403 && foldersArchived.json?.code === 'WORKSPACE_ARCHIVED', '归档后改文件夹结构 → 403');
  const listArchived = await api('GET', '/api/workspaces', { token: M.token });
  const archivedRow = (listArchived.json?.workspaces || []).find((w) => w.id === wsId);
  assert(Boolean(archivedRow) && archivedRow.status === 'archived', '归档项目在成员列表可见且带 status 标记');

  // ── 4. A4: disabled = fully blocked ────────────────────────────────────
  console.log('\n— 三态:disabled(全禁)—');
  const dis = await api('POST', `/api/org/workspaces/${wsId}/disable`, { token: A.token, body: {} });
  assert(dis.status === 200 && dis.json?.status === 'disabled', 'admin 停用项目 → 200');

  const pullDisabled = await api('GET', `/api/workspaces/${wsId}/versions/latest`, { token: M.token });
  assert(pullDisabled.status === 403 && pullDisabled.json?.code === 'WORKSPACE_DISABLED', '停用后 pull → 403 WORKSPACE_DISABLED');
  const histDisabled = await api('GET', `/api/workspaces/${wsId}/versions`, { token: P.token });
  assert(histDisabled.status === 403 && histDisabled.json?.code === 'WORKSPACE_DISABLED', '停用后版本历史 → 403(owner 也一样)');
  const detailDisabled = await api('GET', `/api/workspaces/${wsId}`, { token: M.token });
  assert(detailDisabled.status === 403 && detailDisabled.json?.code === 'WORKSPACE_DISABLED', '停用后项目详情 → 403');
  const listDisabled = await api('GET', '/api/workspaces', { token: M.token });
  assert(!(listDisabled.json?.workspaces || []).some((w) => w.id === wsId), '停用项目从成员列表消失');
  const govListStill = await api('GET', '/api/org/workspaces', { token: A.token });
  assert((govListStill.json?.workspaces || []).some((w) => w.id === wsId && w.status === 'disabled'), '治理列表仍可见停用项目');

  // ── 5. A4: restore ─────────────────────────────────────────────────────
  console.log('\n— 三态:restore 恢复 —');
  const rst = await api('POST', `/api/org/workspaces/${wsId}/restore`, { token: A.token, body: {} });
  assert(rst.status === 200 && rst.json?.status === 'active', 'admin 恢复项目 → 200');
  const pushRestored = await api('POST', `/api/workspaces/${wsId}/versions`, {
    token: P.token,
    body: { message: 'v2', entries: [{ entryType: 'folder', path: '/docs', name: 'docs' }] },
  });
  assert(pushRestored.status === 201, '恢复后 push → 201(协作恢复)');

  // ── 6. Governance: transfer owner ──────────────────────────────────────
  console.log('\n— 治理:转移 owner —');
  const xferByMember = await api('POST', `/api/org/workspaces/${wsId}/transfer-owner`, { token: M.token, body: { userId: M.userId } });
  assert(xferByMember.status === 403, 'member 转移 owner → 403');
  const xferToOutsider = await api('POST', `/api/org/workspaces/${wsId}/transfer-owner`, { token: A.token, body: { userId: A.userId } });
  assert(xferToOutsider.status === 404 && xferToOutsider.json?.code === 'MEMBER_NOT_FOUND', '转移给非项目成员 → 404 MEMBER_NOT_FOUND');
  const xfer = await api('POST', `/api/org/workspaces/${wsId}/transfer-owner`, { token: A.token, body: { userId: M.userId } });
  assert(xfer.status === 200 && xfer.json?.changed === true, 'admin 转移 owner 给项目成员 → 200');

  // New owner gains owner-only ops; old owner loses them.
  const promoteByNew = await api('POST', `/api/workspaces/${wsId}/folders`, { token: M.token, body: { folders: ['/docs', '/new'] } });
  assert(promoteByNew.status === 200, '新 owner 可执行 owner-only 操作(folders POST → 200)');
  const promoteByOld = await api('POST', `/api/workspaces/${wsId}/folders`, { token: P.token, body: { folders: ['/docs'] } });
  assert(promoteByOld.status === 403, '原 owner 已降为 editor(folders POST → 403)');

  // ── 7. Governance: remove member ───────────────────────────────────────
  console.log('\n— 治理:移除成员 —');
  const removeOwner = await api('POST', `/api/org/workspaces/${wsId}/members/${M.userId}/remove`, { token: A.token, body: {} });
  assert(removeOwner.status === 409 && removeOwner.json?.code === 'OWNER_MUST_TRANSFER', '移除项目 owner → 409 OWNER_MUST_TRANSFER');
  const removeP = await api('POST', `/api/org/workspaces/${wsId}/members/${P.userId}/remove`, { token: A.token, body: {} });
  assert(removeP.status === 200, 'admin 移除 editor → 200');
  const pBlocked = await api('GET', `/api/workspaces/${wsId}/versions/latest`, { token: P.token });
  // H4: non-members get 404 (existence hidden), so removal is also a 404.
  assert(pBlocked.status === 404 && pBlocked.json?.code === 'NOT_WORKSPACE_MEMBER', '被移除成员访问项目 → 404(即时生效)');

  // ── 8. Audit events ────────────────────────────────────────────────────
  console.log('\n— 审计事件 —');
  const detail2 = await api('GET', `/api/org/workspaces/${wsId}`, { token: A.token });
  const evTypes = new Set((detail2.json?.recentEvents || []).map((e) => e.eventType));
  for (const t of ['workspace.archived', 'workspace.disabled', 'workspace.restored', 'workspace.owner_transferred', 'workspace.member_removed']) {
    assert(evTypes.has(t), `审计事件落表:${t}`);
  }

  // ── 9. Cross-org isolation ─────────────────────────────────────────────
  console.log('\n— 跨企业隔离 —');
  const out2 = cli('org:create', '--name', `H3隔离企业-${tag}`, '--owner-invite');
  const otherInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out2, 'otherInvite');
  const OTHER = await register(otherInvite, `h3other-${tag}@test.local`, 'H3-Other');
  const crossDetail = await api('GET', `/api/org/workspaces/${wsId}`, { token: OTHER.token });
  assert(crossDetail.status === 404, '他企业 owner 读本企业项目详情 → 404');
  const crossDisable = await api('POST', `/api/org/workspaces/${wsId}/disable`, { token: OTHER.token, body: {} });
  assert(crossDisable.status === 404, '他企业 owner 停用本企业项目 → 404');

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n[h3-verify] 通过 ${passed} 项, 失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[h3-verify] 异常:', err);
  process.exit(1);
});

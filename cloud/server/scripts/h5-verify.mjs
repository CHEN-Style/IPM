// H5 verification: skill governance — review queue, grants, install stats,
// archive/unarchive, my-submissions, per-file sha256 manifests, audit events,
// and cross-org isolation.
//
// Prereqs: dev server running (npm run dev), postgres up, migrations applied.
// Usage:   node scripts/h5-verify.mjs [baseUrl]

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// Build a fake-but-shaped publish payload. The publish endpoints never touch
// OSS (only upload-url/download do), so a synthetic storageKey is fine here.
function publishBody(slug, version, files) {
  const manifest = {
    name: slug,
    slug,
    description: `H5 e2e skill ${slug}`,
    version,
    disableModelInvocation: false,
    metadata: {},
    files: files.map((f) => ({ path: f.path, sizeBytes: f.content.length, sha256: sha256(f.content) })),
  };
  const pkgSha = randomBytes(32).toString('hex');
  return {
    slug,
    name: slug,
    description: manifest.description,
    version,
    packageSha256: pkgSha,
    sizeBytes: 1024,
    storageKey: `skills/test/${slug}/${version}/${pkgSha}.ipmskill`,
    manifest,
    metadata: {},
  };
}

// Direct DB access for audit-event assertions (no public events API for
// skills). DATABASE_URL is read from cloud/server/.env.
async function makeDbPool() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const m = /^DATABASE_URL=(.+)$/m.exec(text);
  if (!m) throw new Error('无法从 .env 读取 DATABASE_URL');
  const { default: pg } = await import('pg');
  return new pg.Pool({ connectionString: m[1].trim() });
}

async function main() {
  console.log(`[h5-verify] base=${BASE} tag=${tag}`);

  // ── 1. Bootstrap ────────────────────────────────────────────────────────
  console.log('\n— 初始化(企业 + 4 名用户 + 隔离企业)—');
  const out = cli('org:create', '--name', `H5测试企业-${tag}`, '--owner-invite');
  const ownerInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out, 'ownerInvite');
  const O = await register(ownerInvite, `h5o-${tag}@test.local`, 'H5-OrgOwner');

  const invM = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'member', maxUses: 10 } });
  const M = await register(invM.json.invite.code, `h5m-${tag}@test.local`, 'H5-Publisher');
  const U = await register(invM.json.invite.code, `h5u-${tag}@test.local`, 'H5-GrantedUser');
  const W = await register(invM.json.invite.code, `h5w-${tag}@test.local`, 'H5-OtherMember');

  const out2 = cli('org:create', '--name', `H5隔离企业-${tag}`, '--owner-invite');
  const otherInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out2, 'otherInvite');
  const X = await register(otherInvite, `h5x-${tag}@test.local`, 'H5-OtherOrgOwner');

  const slug1 = `h5-skill-${tag}`;
  const slug2 = `h5-reject-${tag}`;

  // ── 2. Submit + my submissions + pending invisibility ──────────────────
  console.log('\n— 提交审核 + 我的提交 + 待审核不可见 —');
  const files1 = [
    { path: 'SKILL.md', content: 'v1 skill doc' },
    { path: 'scripts/run.js', content: 'console.log(1)' },
  ];
  const pub1 = await api('POST', '/api/skills', { token: M.token, body: publishBody(slug1, '1.0.0', files1) });
  const skillId = pub1.json?.skillId;
  const v1Id = pub1.json?.versionId;
  assert(pub1.status === 201 && skillId, `成员提交 Skill → 201(${skillId})`);

  const mineM = await api('GET', '/api/skills/mine', { token: M.token });
  const mineRow = (mineM.json?.skills || []).find((s) => s.id === skillId);
  assert(mineM.status === 200 && mineRow?.status === 'pending_review', '我的提交:可见自己的 pending_review');
  const mineW = await api('GET', '/api/skills/mine', { token: W.token });
  assert(mineW.status === 200 && !(mineW.json?.skills || []).some((s) => s.id === skillId), '我的提交:不含他人技能');

  const marketU = await api('GET', '/api/skills', { token: U.token });
  assert(!(marketU.json?.skills || []).some((s) => s.id === skillId), '待审核技能不出现在市场');
  const installPending = await api('POST', `/api/skills/${skillId}/install`, { token: U.token, body: {} });
  assert(installPending.status === 403, '待审核技能安装 → 403');
  const detailPublisher = await api('GET', `/api/skills/${skillId}`, { token: M.token });
  assert(detailPublisher.status === 200, '提交人可读自己待审核技能详情');
  const detailW = await api('GET', `/api/skills/${skillId}`, { token: W.token });
  assert(detailW.status === 403, '其他成员读待审核技能详情 → 403');

  // ── 3. Admin endpoints permission gates ────────────────────────────────
  console.log('\n— 管理端点权限 —');
  const queueM = await api('GET', '/api/skills/admin/review-queue', { token: M.token });
  assert(queueM.status === 403, '成员读审核队列 → 403');
  const overviewM = await api('GET', '/api/skills/admin/overview', { token: M.token });
  assert(overviewM.status === 403, '成员读治理总览 → 403');
  const installersM = await api('GET', `/api/skills/${skillId}/installers`, { token: M.token });
  assert(installersM.status === 403, '成员读安装者列表 → 403');
  const archiveM = await api('POST', `/api/skills/${skillId}/archive`, { token: M.token, body: {} });
  assert(archiveM.status === 403, '成员归档 → 403');

  const queueO = await api('GET', '/api/skills/admin/review-queue', { token: O.token });
  assert((queueO.json?.skills || []).some((s) => s.id === skillId && s.status === 'pending_review'), '审核队列包含待审核技能');
  const overviewO = await api('GET', '/api/skills/admin/overview', { token: O.token });
  const ovRow = (overviewO.json?.skills || []).find((s) => s.id === skillId);
  assert(overviewO.status === 200 && ovRow && ovRow.installCount === 0 && ovRow.versionCount === 1, '治理总览:installCount=0 / versionCount=1');

  // ── 4. Approve with per-user grant ─────────────────────────────────────
  console.log('\n— 通过并按用户授权 —');
  const approve = await api('POST', `/api/skills/${skillId}/review`, {
    token: O.token,
    body: { decision: 'approved', grants: [{ grantType: 'user', userId: U.userId }] },
  });
  assert(approve.status === 200 && approve.json?.status === 'approved', '审核通过(指定 U 可见)→ 200');
  const marketU2 = await api('GET', '/api/skills', { token: U.token });
  assert((marketU2.json?.skills || []).some((s) => s.id === skillId), '被授权用户 U 市场可见');
  const marketW = await api('GET', '/api/skills', { token: W.token });
  assert(!(marketW.json?.skills || []).some((s) => s.id === skillId), '未授权用户 W 市场不可见');
  const installW = await api('POST', `/api/skills/${skillId}/install`, { token: W.token, body: {} });
  assert(installW.status === 403, '未授权用户安装 → 403');

  // ── 5. Install + installer stats ───────────────────────────────────────
  console.log('\n— 安装 + 安装统计 —');
  const installU = await api('POST', `/api/skills/${skillId}/install`, { token: U.token, body: {} });
  assert(installU.status === 200 && installU.json?.versionId === v1Id, '授权用户安装 → 200(落到 v1)');
  const installersO = await api('GET', `/api/skills/${skillId}/installers`, { token: O.token });
  const instRow = (installersO.json?.installers || []).find((i) => i.userId === U.userId);
  assert(installersO.status === 200 && instRow && instRow.outdated === false, '安装者列表:U 在列且未落后');
  const overviewO2 = await api('GET', '/api/skills/admin/overview', { token: O.token });
  const ovRow2 = (overviewO2.json?.skills || []).find((s) => s.id === skillId);
  assert(ovRow2?.installCount === 1 && ovRow2?.userGrantCount === 1 && ovRow2?.orgGrant === false, '总览:installCount=1 / 按用户授权摘要正确');

  // ── 6. New version → re-review, grants cleared, then org-wide approve ──
  console.log('\n— 新版本重审 + 清授权 + 全组织上架 —');
  const files2 = [
    { path: 'SKILL.md', content: 'v2 skill doc — changed' },
    { path: 'scripts/run.js', content: 'console.log(1)' },
    { path: 'reference.md', content: 'new file' },
  ];
  const v2body = publishBody(slug1, '1.1.0', files2);
  const pub2 = await api('POST', `/api/skills/${skillId}/versions`, {
    token: W.token,
    body: { version: v2body.version, packageSha256: v2body.packageSha256, sizeBytes: v2body.sizeBytes, storageKey: v2body.storageKey, manifest: v2body.manifest },
  });
  assert(pub2.status === 403, '非发布者提交新版本 → 403');
  const pub2b = await api('POST', `/api/skills/${skillId}/versions`, {
    token: M.token,
    body: { version: v2body.version, packageSha256: v2body.packageSha256, sizeBytes: v2body.sizeBytes, storageKey: v2body.storageKey, manifest: v2body.manifest },
  });
  const v2Id = pub2b.json?.versionId;
  assert(pub2b.status === 201 && v2Id, '发布者提交新版本 → 201,回到待审核');
  const marketU3 = await api('GET', '/api/skills', { token: U.token });
  assert(!(marketU3.json?.skills || []).some((s) => s.id === skillId), '重审期间市场不可见(授权已清空)');

  const approve2 = await api('POST', `/api/skills/${skillId}/review`, { token: O.token, body: { decision: 'approved' } });
  assert(approve2.status === 200, '二次审核通过(默认全组织)→ 200');
  const marketW2 = await api('GET', '/api/skills', { token: W.token });
  const wRow = (marketW2.json?.skills || []).find((s) => s.id === skillId);
  assert(Boolean(wRow), '全组织授权后 W 市场可见');
  const marketU4 = await api('GET', '/api/skills', { token: U.token });
  const uRow = (marketU4.json?.skills || []).find((s) => s.id === skillId);
  assert(uRow?.updateAvailable === true && uRow?.installedVersion === '1.0.0', 'U 看到 updateAvailable(装的还是 1.0.0)');
  const installersO2 = await api('GET', `/api/skills/${skillId}/installers`, { token: O.token });
  const instRow2 = (installersO2.json?.installers || []).find((i) => i.userId === U.userId);
  assert(instRow2?.outdated === true, '安装者列表:U 标记为版本落后');
  const overviewO3 = await api('GET', '/api/skills/admin/overview', { token: O.token });
  const ovRow3 = (overviewO3.json?.skills || []).find((s) => s.id === skillId);
  assert(ovRow3?.outdatedInstallCount === 1, '总览:outdatedInstallCount=1');

  // per-file sha256 manifests survive the round-trip (desktop diff input)
  const detailU = await api('GET', `/api/skills/${skillId}`, { token: U.token });
  const versions = detailU.json?.versions || [];
  const v11 = versions.find((v) => v.version === '1.1.0');
  const v10 = versions.find((v) => v.version === '1.0.0');
  assert(
    Array.isArray(v11?.manifest?.files) && v11.manifest.files.every((f) => /^[a-f0-9]{64}$/.test(f.sha256 || ''))
    && Array.isArray(v10?.manifest?.files) && v10.manifest.files.every((f) => /^[a-f0-9]{64}$/.test(f.sha256 || '')),
    '版本 manifest 携带 per-file sha256(供桌面端 diff)',
  );

  // U upgrades to latest → lag flag clears
  const upgrade = await api('POST', `/api/skills/${skillId}/install`, { token: U.token, body: {} });
  assert(upgrade.status === 200 && upgrade.json?.versionId === v2Id, 'U 升级到最新版本 → 200');
  const installersO3 = await api('GET', `/api/skills/${skillId}/installers`, { token: O.token });
  assert((installersO3.json?.installers || []).find((i) => i.userId === U.userId)?.outdated === false, '升级后落后标记清除');

  // ── 7. Access grant edit (audit) ───────────────────────────────────────
  console.log('\n— 调整可见范围 —');
  const setAccess = await api('POST', `/api/skills/${skillId}/access`, {
    token: O.token,
    body: { grants: [{ grantType: 'org' }, { grantType: 'user', userId: U.userId }] },
  });
  assert(setAccess.status === 200, '管理员调整授权 → 200');

  // ── 8. Reject flow with note ───────────────────────────────────────────
  console.log('\n— 拒绝并附原因 —');
  const pubR = await api('POST', '/api/skills', { token: M.token, body: publishBody(slug2, '0.1.0', [{ path: 'SKILL.md', content: 'reject me' }]) });
  const rejectId = pubR.json?.skillId;
  const reject = await api('POST', `/api/skills/${rejectId}/review`, {
    token: O.token,
    body: { decision: 'rejected', note: '描述不完整,请补充使用说明' },
  });
  assert(reject.status === 200 && reject.json?.status === 'rejected', '拒绝 → 200');
  const mineM2 = await api('GET', '/api/skills/mine', { token: M.token });
  const rejRow = (mineM2.json?.skills || []).find((s) => s.id === rejectId);
  assert(rejRow?.status === 'rejected' && rejRow?.reviewNote === '描述不完整,请补充使用说明', '我的提交:拒绝原因可见');

  // ── 9. Archive / unarchive ─────────────────────────────────────────────
  console.log('\n— 归档/恢复 —');
  const arch = await api('POST', `/api/skills/${skillId}/archive`, { token: O.token, body: {} });
  assert(arch.status === 200 && arch.json?.status === 'archived', '归档 → 200');
  const marketArchived = await api('GET', '/api/skills', { token: W.token });
  assert(!(marketArchived.json?.skills || []).some((s) => s.id === skillId), '归档后市场不可见');
  const installArchived = await api('POST', `/api/skills/${skillId}/install`, { token: W.token, body: {} });
  assert(installArchived.status === 403, '归档后安装 → 403');
  const verArchived = await api('POST', `/api/skills/${skillId}/versions`, {
    token: M.token,
    body: { version: '1.2.0', packageSha256: randomBytes(32).toString('hex'), sizeBytes: 1, storageKey: 'skills/test/x', manifest: {} },
  });
  assert(verArchived.status === 404, '归档后提交新版本 → 404');
  const archAgain = await api('POST', `/api/skills/${skillId}/archive`, { token: O.token, body: {} });
  assert(archAgain.status === 409 && archAgain.json?.code === 'ALREADY_ARCHIVED', '重复归档 → 409 ALREADY_ARCHIVED');

  const unarchWrong = await api('POST', `/api/skills/${rejectId}/unarchive`, { token: O.token, body: {} });
  assert(unarchWrong.status === 409 && unarchWrong.json?.code === 'NOT_ARCHIVED', '恢复未归档技能 → 409 NOT_ARCHIVED');
  const unarch = await api('POST', `/api/skills/${skillId}/unarchive`, { token: O.token, body: {} });
  assert(unarch.status === 200 && unarch.json?.status === 'approved', '恢复 → 200,回到归档前的 approved');
  const marketRestored = await api('GET', '/api/skills', { token: W.token });
  assert((marketRestored.json?.skills || []).some((s) => s.id === skillId), '恢复后市场重新可见(授权保留)');

  // ── 10. Cross-org isolation ────────────────────────────────────────────
  console.log('\n— 跨企业隔离 —');
  const crossOverview = await api('GET', '/api/skills/admin/overview', { token: X.token });
  assert(crossOverview.status === 200 && !(crossOverview.json?.skills || []).some((s) => s.id === skillId), '他企业总览不含本企业技能');
  const crossDetail = await api('GET', `/api/skills/${skillId}`, { token: X.token });
  assert(crossDetail.status === 404, '他企业读技能详情 → 404');
  const crossInstallers = await api('GET', `/api/skills/${skillId}/installers`, { token: X.token });
  assert(crossInstallers.status === 404, '他企业读安装者 → 404');
  const crossArchive = await api('POST', `/api/skills/${skillId}/archive`, { token: X.token, body: {} });
  assert(crossArchive.status === 404, '他企业归档 → 404');

  // ── 11. Audit events (direct DB) ───────────────────────────────────────
  console.log('\n— 审计事件 —');
  const pool = await makeDbPool();
  try {
    const ev = await pool.query(
      `SELECT event_type, payload FROM events
        WHERE payload->>'skillId' IN ($1, $2)
        ORDER BY created_at`,
      [skillId, rejectId],
    );
    const types = new Set(ev.rows.map((r) => r.event_type));
    for (const t of [
      'skill.submitted',
      'skill.version_submitted',
      'skill.approved',
      'skill.rejected',
      'skill.installed',
      'skill.access_changed',
      'skill.archived',
      'skill.unarchived',
    ]) {
      assert(types.has(t), `审计事件落表:${t}`);
    }
    const installEvents = ev.rows.filter((r) => r.event_type === 'skill.installed');
    assert(installEvents.length === 2 && installEvents.every((r) => r.payload?.versionId), 'skill.installed 含 versionId(2 次安装)');
  } finally {
    await pool.end();
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n[h5-verify] 通过 ${passed} 项, 失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[h5-verify] 异常:', err);
  process.exit(1);
});

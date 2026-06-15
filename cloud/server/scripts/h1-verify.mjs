// H1 verification: platform admin, org disable enforcement, object org
// isolation (A5/A11), and auth rate limiting (A7).
//
// Prereqs: dev server running (npm run dev), postgres up, migrations applied.
// Usage:   node scripts/h1-verify.mjs [baseUrl]
//
// The script creates throwaway orgs/users via the platform CLI + register API
// (suffixed with a timestamp) and leaves them in the dev database.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

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
  const out = execFileSync('npx', ['tsx', 'src/modules/platform/platform-cli.ts', ...args], {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return out;
}

function extract(re, text, label) {
  const m = re.exec(text);
  if (!m) throw new Error(`无法从 CLI 输出解析 ${label}: ${text}`);
  return m[1];
}

const randomSha = () => crypto.randomBytes(32).toString('hex');

async function main() {
  console.log(`[h1-verify] base=${BASE} tag=${tag}`);

  // ── 1. Bootstrap two orgs + owner invites via platform CLI ────────────
  console.log('\n— 平台 CLI 创建企业 —');
  const outA = cli('org:create', '--name', `H1测试企业A-${tag}`, '--owner-invite');
  const outB = cli('org:create', '--name', `H1测试企业B-${tag}`, '--owner-invite');
  const orgA = extract(/已创建企业: .* \(([0-9a-f-]{36})\)/, outA, 'orgA id');
  const orgB = extract(/已创建企业: .* \(([0-9a-f-]{36})\)/, outB, 'orgB id');
  const inviteA = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, outA, 'inviteA');
  const inviteB = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, outB, 'inviteB');
  assert(orgA && inviteA, `企业A 创建 + owner 邀请码 (${orgA})`);
  assert(orgB && inviteB, `企业B 创建 + owner 邀请码 (${orgB})`);

  // ── 2. Register one owner in each org ─────────────────────────────────
  console.log('\n— 注册用户 —');
  const emailA = `h1a-${tag}@test.local`;
  const emailB = `h1b-${tag}@test.local`;
  const regA = await api('POST', '/api/auth/register', {
    body: { inviteCode: inviteA, email: emailA, password: 'test123456', displayName: 'H1-UserA' },
  });
  const regB = await api('POST', '/api/auth/register', {
    body: { inviteCode: inviteB, email: emailB, password: 'test123456', displayName: 'H1-UserB' },
  });
  assert(regA.status === 201 && regA.json?.accessToken, 'userA 注册成功(企业A owner)');
  assert(regB.status === 201 && regB.json?.accessToken, 'userB 注册成功(企业B owner)');
  let tokenA = regA.json.accessToken;
  let tokenB = regB.json.accessToken;

  // ── 3. Platform admin gate ─────────────────────────────────────────────
  console.log('\n— 平台管理员权限边界 —');
  const beforeGrant = await api('GET', '/api/platform/orgs', { token: tokenA });
  assert(
    beforeGrant.status === 403 && beforeGrant.json?.code === 'PLATFORM_FORBIDDEN',
    '未授予前 userA 调平台 API → 403 PLATFORM_FORBIDDEN',
  );

  cli('admin:grant', '--email', emailA, '--note', 'h1-verify');
  const afterGrant = await api('GET', '/api/platform/orgs', { token: tokenA });
  assert(afterGrant.status === 200 && Array.isArray(afterGrant.json?.orgs), '授予后 userA 调平台 API → 200');
  assert(
    (afterGrant.json?.orgs || []).some((o) => o.id === orgB),
    '平台企业列表包含企业B',
  );
  const stillForbidden = await api('GET', '/api/platform/orgs', { token: tokenB });
  assert(
    stillForbidden.status === 403 && stillForbidden.json?.code === 'PLATFORM_FORBIDDEN',
    '企业 owner(userB) 调平台 API → 403',
  );

  // ── 4. Object org isolation (A5/A11) ──────────────────────────────────
  console.log('\n— 对象组织隔离 (A5/A11) —');
  const sha = randomSha();
  const up1 = await api('POST', '/api/objects/upload-urls', {
    token: tokenA,
    body: { files: [{ sha256: sha, sizeBytes: 128, mimeType: 'application/pdf' }] },
  });
  assert(
    up1.status === 200 && up1.json?.urls?.length === 1 && up1.json.urls[0].storageKey.startsWith(`blobs/${orgA}/`),
    `pending 对象签发 PUT URL,storage key 为组织路径 (${up1.json?.urls?.[0]?.storageKey?.slice(0, 30)}...)`,
  );
  const confirm1 = await api('POST', '/api/objects/confirm', { token: tokenA, body: { hashes: [sha] } });
  assert(confirm1.status === 200 && confirm1.json?.confirmed?.includes(sha), '企业A confirm → available');

  const up2 = await api('POST', '/api/objects/upload-urls', {
    token: tokenA,
    body: { files: [{ sha256: sha, sizeBytes: 128 }] },
  });
  assert(
    up2.status === 200 && up2.json?.urls?.length === 0 && up2.json?.alreadyAvailable?.includes(sha),
    'A11: 已 available 对象不再签发 PUT URL(alreadyAvailable)',
  );

  const checkB = await api('POST', '/api/objects/check', { token: tokenB, body: { hashes: [sha] } });
  assert(
    checkB.status === 200 && (checkB.json?.existing || []).length === 0,
    'A5: 企业B check 企业A 的 sha → 不存在',
  );
  const dlB = await api('POST', '/api/objects/download-urls', { token: tokenB, body: { hashes: [sha] } });
  assert(
    dlB.status === 200 && (dlB.json?.urls || []).length === 0 && (dlB.json?.missing || []).includes(sha),
    'A5: 企业B 凭 sha 请求下载 URL → missing',
  );

  // Cross-org manifest reference must be rejected.
  const wsB = await api('POST', '/api/workspaces', {
    token: tokenB,
    body: { domain: 'projects', name: `H1隔离测试-${tag}` },
  });
  const wsBId = wsB.json?.workspace?.id || wsB.json?.id;
  assert(wsB.status === 201 || wsB.status === 200, `企业B 创建 workspace (${wsBId})`);
  const commitB = await api('POST', `/api/workspaces/${wsBId}/versions`, {
    token: tokenB,
    body: {
      message: 'cross-org ref',
      entries: [
        { path: '/收到资料', name: '收到资料', entryType: 'folder' },
        { path: '/收到资料/x.pdf', name: 'x.pdf', entryType: 'file', sha256: sha, sizeBytes: 128 },
      ],
    },
  });
  assert(commitB.status === 409, `A5: 企业B 提交引用企业A 对象的版本 → 409 (got ${commitB.status})`);

  // ── 4.5 In-org regression: publish → manifest → download (R-PUB/R-PULL) ─
  console.log('\n— 同组织正常链路回归 —');
  const shaB = randomSha();
  const upB = await api('POST', '/api/objects/upload-urls', {
    token: tokenB,
    body: { files: [{ sha256: shaB, sizeBytes: 64, mimeType: 'text/plain' }] },
  });
  assert(upB.status === 200 && upB.json?.urls?.length === 1, '企业B 获取上传 URL');
  await api('POST', '/api/objects/confirm', { token: tokenB, body: { hashes: [shaB] } });
  const commitOk = await api('POST', `/api/workspaces/${wsBId}/versions`, {
    token: tokenB,
    body: {
      message: 'h1 regression',
      entries: [
        { path: '/收到资料', name: '收到资料', entryType: 'folder' },
        { path: '/收到资料/b.txt', name: 'b.txt', entryType: 'file', sha256: shaB, sizeBytes: 64 },
      ],
    },
  });
  assert(
    commitOk.status === 200 || commitOk.status === 201,
    `企业B 提交引用本组织对象的版本成功 (got ${commitOk.status})`,
  );
  const manifest = await api('GET', `/api/workspaces/${wsBId}/versions/latest`, { token: tokenB });
  assert(
    manifest.status === 200 && (manifest.json?.entries || []).some((e) => e.sha256 === shaB),
    '最新 manifest 包含已提交文件',
  );
  const dlOwn = await api('POST', '/api/objects/download-urls', { token: tokenB, body: { hashes: [shaB] } });
  assert(
    dlOwn.status === 200 && (dlOwn.json?.urls || []).length === 1,
    '企业B 下载本组织对象 → 签发 GET URL',
  );
  const syncStatus = await api('GET', `/api/workspaces/${wsBId}/sync-status`, { token: tokenB });
  assert(syncStatus.status === 200, 'sync-status 正常');
  const skillsList = await api('GET', '/api/skills', { token: tokenB });
  assert(skillsList.status === 200, 'Skill 市场列表正常');
  const orgConfigList = await api('GET', '/api/org-configs/templates', { token: tokenB });
  assert(orgConfigList.status === 200, '企业配置模板列表正常 (owner)');

  // ── 5. Org disable enforcement ─────────────────────────────────────────
  console.log('\n— 企业停用与恢复 —');
  const disable = await api('POST', `/api/platform/orgs/${orgB}/disable`, { token: tokenA, body: {} });
  assert(disable.status === 200 && disable.json?.org?.status === 'disabled', '平台管理员停用企业B');

  const wsListDisabled = await api('GET', '/api/workspaces', { token: tokenB });
  assert(
    wsListDisabled.status === 403 && wsListDisabled.json?.code === 'ORG_DISABLED',
    `停用后 userB 调协作 API → 403 ORG_DISABLED(${wsListDisabled.json?.error})`,
  );
  const loginDisabled = await api('POST', '/api/auth/login', {
    body: { email: emailB, password: 'test123456' },
  });
  assert(
    loginDisabled.status === 403 && loginDisabled.json?.code === 'ORG_DISABLED',
    '停用后 userB 登录 → 403 ORG_DISABLED',
  );

  const restore = await api('POST', `/api/platform/orgs/${orgB}/restore`, { token: tokenA, body: {} });
  assert(restore.status === 200 && restore.json?.org?.status === 'active', '平台管理员恢复企业B');
  const loginRestored = await api('POST', '/api/auth/login', {
    body: { email: emailB, password: 'test123456' },
  });
  assert(loginRestored.status === 200 && loginRestored.json?.accessToken, '恢复后 userB 可重新登录');
  tokenB = loginRestored.json.accessToken;
  const wsListRestored = await api('GET', '/api/workspaces', { token: tokenB });
  assert(wsListRestored.status === 200, '恢复后 userB 协作 API 正常');

  // ── 6. Auth rate limit (A7) ────────────────────────────────────────────
  console.log('\n— 登录限流 (A7) —');
  let got429 = false;
  for (let i = 0; i < 30; i += 1) {
    const res = await api('POST', '/api/auth/login', {
      body: { email: `nobody-${tag}@test.local`, password: 'wrong-password' },
    });
    if (res.status === 429) {
      got429 = true;
      assert(res.json?.code === 'RATE_LIMITED', `第 ${i + 1} 次错误登录触发 429 RATE_LIMITED`);
      break;
    }
  }
  assert(got429, '连续错误登录被限流');

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n[h1-verify] 通过 ${passed} 项, 失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[h1-verify] 异常:', err);
  process.exit(1);
});

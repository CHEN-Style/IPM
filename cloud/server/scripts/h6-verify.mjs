// H6 verification: enterprise config center — template create (admin-only),
// at-rest encryption of config_json (no plaintext secret in DB), member
// preview/import with decrypted secrets, usage tracking, metadata PATCH,
// enable/disable lifecycle, cross-org isolation, and audit events.
//
// Prereqs: dev server running (npm run dev), postgres up, migrations applied.
// Usage:   node scripts/h6-verify.mjs [baseUrl]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:4210';
const tag = Date.now().toString(36);
const SECRET = `SK-SECRET-${tag}-DO-NOT-LEAK`;
const SEARCH_SECRET = `SEARCH-SECRET-${tag}-DO-NOT-LEAK`;

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

async function makeDbPool() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const m = /^DATABASE_URL=(.+)$/m.exec(text);
  if (!m) throw new Error('无法从 .env 读取 DATABASE_URL');
  const { default: pg } = await import('pg');
  return new pg.Pool({ connectionString: m[1].trim() });
}

function buildConfig() {
  return {
    ai: {
      providers: [
        { id: 'p1', name: 'OpenAI', apiKey: SECRET, baseURL: 'https://api.openai.com/v1', models: ['gpt-4o'] },
      ],
      roleAssignments: {
        knowclaw: ['p1:gpt-4o'],
        classification: 'p1:gpt-4o',
        summary: 'p1:gpt-4o',
        preferenceParsing: 'p1:gpt-4o',
      },
    },
    searchApi: { provider: 'bocha', apiKey: SEARCH_SECRET },
  };
}

async function main() {
  console.log(`[h6-verify] base=${BASE} tag=${tag}`);
  const db = await makeDbPool();

  try {
    // ── 1. Bootstrap ────────────────────────────────────────────────────────
    console.log('\n— 初始化(企业 + owner/admin/member + 隔离企业)—');
    const out = cli('org:create', '--name', `H6测试企业-${tag}`, '--owner-invite');
    const ownerInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out, 'ownerInvite');
    const O = await register(ownerInvite, `h6o-${tag}@test.local`, 'H6-Owner');

    const invAdmin = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'admin', maxUses: 5 } });
    const A = await register(invAdmin.json.invite.code, `h6a-${tag}@test.local`, 'H6-Admin');
    const invMember = await api('POST', '/api/org/invites', { token: O.token, body: { role: 'member', maxUses: 5 } });
    const M = await register(invMember.json.invite.code, `h6m-${tag}@test.local`, 'H6-Member');

    // Isolated org for cross-org checks.
    const out2 = cli('org:create', '--name', `H6隔离企业-${tag}`, '--owner-invite');
    const isoInvite = extract(/owner 邀请码: (IPM-[A-Z2-9]{4}-[A-Z2-9]{4})/, out2, 'isoInvite');
    const X = await register(isoInvite, `h6x-${tag}@test.local`, 'H6-Outsider');

    // ── 2. Permission: member cannot create ─────────────────────────────────
    console.log('\n— 权限:成员不可创建模板 —');
    const denied = await api('POST', '/api/org-configs/templates', {
      token: M.token, body: { name: '非法', config: buildConfig() },
    });
    assert(denied.status === 403, '成员创建模板被拒(403)');

    // ── 3. Admin creates template ───────────────────────────────────────────
    console.log('\n— 管理员创建模板(含敏感凭证)—');
    const created = await api('POST', '/api/org-configs/templates', {
      token: A.token,
      body: { name: `统一AI配置-${tag}`, description: '公司标准', config: buildConfig(), maxUses: 3 },
    });
    assert(created.status === 201 && created.json?.ok, '管理员创建成功(201)');
    const tpl = created.json.template;
    assert(/^IPM-AI-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(tpl.code), '返回合法配置码');
    assert(tpl.summary?.containsSecrets === true, '摘要标记包含敏感凭证');
    assert(tpl.summary?.providerCount === 1, '摘要 Provider 数=1');
    assert(tpl.config === undefined, '创建响应不回传明文 config');

    // ── 4. At-rest encryption: no plaintext secret in DB ────────────────────
    console.log('\n— 密文落库断言 —');
    const row = await db.query('SELECT config_json FROM org_config_templates WHERE id = $1', [tpl.id]);
    const rawStored = JSON.stringify(row.rows[0]?.config_json ?? {});
    assert(row.rows[0]?.config_json?.__enc === 'aes-256-gcm', 'config_json 为 AES-256-GCM 信封');
    assert(typeof row.rows[0]?.config_json?.data === 'string' && row.rows[0].config_json.data.length > 0, '信封含密文 data 字段');
    assert(!rawStored.includes(SECRET), '库中不含 Provider API Key 明文');
    assert(!rawStored.includes(SEARCH_SECRET), '库中不含搜索 API Key 明文');

    // ── 5. Member preview (no config leak) ──────────────────────────────────
    console.log('\n— 成员预览 —');
    const prev = await api('POST', '/api/org-configs/preview', { token: M.token, body: { code: tpl.code } });
    assert(prev.status === 200 && prev.json?.ok, '成员预览成功');
    assert(prev.json.template?.config === undefined, '预览不回传 config 明文');
    assert(prev.json.template?.summary?.containsSecrets === true, '预览摘要标记敏感凭证');
    assert(prev.json.template?.code === undefined, '预览不回传 code');

    // ── 6. Member import (decrypted secrets returned) ───────────────────────
    console.log('\n— 成员导入(解密还原)—');
    const imp = await api('POST', '/api/org-configs/import', {
      token: M.token, body: { code: tpl.code, clientInfo: { product: 'h6-verify' } },
    });
    assert(imp.status === 200 && imp.json?.ok, '成员导入成功');
    const importedConfig = imp.json.template?.config;
    assert(importedConfig?.ai?.providers?.[0]?.apiKey === SECRET, '导入还原 Provider API Key');
    assert(importedConfig?.searchApi?.apiKey === SEARCH_SECRET, '导入还原搜索 API Key');

    // ── 7. Usage tracking ───────────────────────────────────────────────────
    console.log('\n— 使用记录 —');
    const uses = await api('GET', `/api/org-configs/templates/${tpl.id}/uses`, { token: A.token });
    assert(uses.json?.ok && (uses.json.uses || []).some((u) => u.userId === M.userId), '使用记录含导入成员');
    const relist = await api('GET', '/api/org-configs/templates', { token: A.token });
    const relisted = (relist.json.templates || []).find((t) => t.id === tpl.id);
    assert(relisted?.usedCount === 1, 'usedCount 递增为 1');

    // ── 8. PATCH metadata ───────────────────────────────────────────────────
    console.log('\n— PATCH 元数据 —');
    const patched = await api('PATCH', `/api/org-configs/templates/${tpl.id}`, {
      token: A.token, body: { name: `改名-${tag}`, maxUses: 10 },
    });
    assert(patched.status === 200 && patched.json?.template?.name === `改名-${tag}`, '名称更新生效');
    assert(patched.json?.template?.maxUses === 10, 'maxUses 更新生效');
    const memberPatch = await api('PATCH', `/api/org-configs/templates/${tpl.id}`, {
      token: M.token, body: { name: 'x' },
    });
    assert(memberPatch.status === 403, '成员 PATCH 被拒(403)');

    // ── 9. Disable / enable lifecycle ───────────────────────────────────────
    console.log('\n— 停用/启用生命周期 —');
    const disabled = await api('POST', `/api/org-configs/templates/${tpl.id}/disable`, { token: A.token, body: {} });
    assert(disabled.json?.template?.status === 'disabled', '停用成功');
    const prevAfterDisable = await api('POST', '/api/org-configs/preview', { token: M.token, body: { code: tpl.code } });
    assert(prevAfterDisable.status === 409, '停用后预览被拒(409)');
    const enabled = await api('POST', `/api/org-configs/templates/${tpl.id}/enable`, { token: A.token, body: {} });
    assert(enabled.json?.template?.status === 'active', '重新启用成功');
    const enableAgain = await api('POST', `/api/org-configs/templates/${tpl.id}/enable`, { token: A.token, body: {} });
    assert(enableAgain.status === 409, '对 active 模板再次启用返回 409');

    // ── 10. Cross-org isolation ─────────────────────────────────────────────
    console.log('\n— 跨企业隔离 —');
    const outsiderPrev = await api('POST', '/api/org-configs/preview', { token: X.token, body: { code: tpl.code } });
    assert(outsiderPrev.status === 404, '其他企业成员无法预览本企业配置码(404)');
    const outsiderList = await api('GET', '/api/org-configs/templates', { token: X.token });
    assert(!(outsiderList.json.templates || []).some((t) => t.id === tpl.id), '其他企业列表看不到本企业模板');

    // ── 11. Audit events ────────────────────────────────────────────────────
    console.log('\n— 审计事件 —');
    const ev = await db.query(
      `SELECT event_type, count(*)::int AS c FROM events
        WHERE payload->>'templateId' = $1 GROUP BY event_type`,
      [tpl.id],
    );
    const byType = Object.fromEntries(ev.rows.map((r) => [r.event_type, r.c]));
    assert(byType['org_config_template.created'] >= 1, '审计:created');
    assert(byType['org_config_template.imported'] >= 1, '审计:imported');
    assert(byType['org_config_template.updated'] >= 1, '审计:updated');
    assert(byType['org_config_template.disabled'] >= 1, '审计:disabled');
    assert(byType['org_config_template.enabled'] >= 1, '审计:enabled');
  } finally {
    await db.end();
  }

  console.log(`\n[h6-verify] 通过 ${passed} · 失败 ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

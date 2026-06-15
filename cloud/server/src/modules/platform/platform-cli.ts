// H1 Platform Super Admin CLI — server-side org lifecycle management.
//
// Runs with direct DB access (like invite-cli); requires server shell access,
// which is the trust anchor for the very first platform admin grant.
//
// Usage:
//   npm run platform -- admin:grant --email a@b.c [--note "ops"]
//   npm run platform -- admin:revoke --email a@b.c
//   npm run platform -- admin:list
//   npm run platform -- org:create --name "某律所" [--slug some-firm] [--plan standard]
//                                  [--owner-email a@b.c] [--owner-invite]
//   npm run platform -- org:list
//   npm run platform -- org:disable --id <orgId>
//   npm run platform -- org:restore --id <orgId>
//   npm run platform -- org:owner --id <orgId> --email a@b.c
//   npm run platform -- invite:create --org <orgId> [--role member] [--max-uses 50] [--expires-days 30]

import { closeDatabase } from '../../infra/db/postgres.js';
import {
  listOrgs,
  getOrgDetail,
  createOrg,
  setOrgStatus,
  assignOwner,
  createInvite,
  listPlatformAdmins,
  grantPlatformAdmin,
  revokePlatformAdmin,
} from './service.js';

function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
  const flags: Record<string, string> = {};
  for (let i = command ? 1 : 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = 'true';
      }
    }
  }
  return { command, flags };
}

function required(flags: Record<string, string>, key: string): string {
  const value = flags[key];
  if (!value) throw new Error(`缺少必填参数 --${key}`);
  return value;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'admin:grant': {
      const res = await grantPlatformAdmin({ email: required(flags, 'email'), note: flags.note });
      console.log(`[platform] 已授予平台管理员: ${res.email} (${res.userId})`);
      break;
    }
    case 'admin:revoke': {
      const res = await revokePlatformAdmin({ email: required(flags, 'email') });
      console.log(`[platform] 已撤销平台管理员: ${res.email}`);
      break;
    }
    case 'admin:list': {
      const admins = await listPlatformAdmins();
      if (admins.length === 0) console.log('[platform] 暂无平台管理员');
      for (const a of admins) {
        console.log(`  ${a.email}  ${a.displayName}  (${a.userId})  ${a.note ?? ''}`);
      }
      break;
    }
    case 'org:create': {
      const org = await createOrg({
        name: required(flags, 'name'),
        slug: flags.slug,
        plan: flags.plan,
        actorId: null,
      });
      console.log(`[platform] 已创建企业: ${org.name} (${org.orgId}) slug=${org.slug}`);
      if (flags['owner-email']) {
        const owner = await assignOwner({ orgId: org.orgId, email: flags['owner-email'], actorId: null });
        console.log(`[platform] 已指定 owner: ${owner.email}`);
      }
      if (flags['owner-invite']) {
        const invite = await createInvite({
          orgId: org.orgId,
          role: 'owner',
          maxUses: 1,
          expiresDays: 30,
          actorId: null,
        });
        console.log(`[platform] owner 邀请码: ${invite.code}（30 天内有效，限用 1 次）`);
      }
      break;
    }
    case 'org:list': {
      const orgs = await listOrgs();
      for (const o of orgs) {
        console.log(
          `  ${o.id}  [${o.status}]  ${o.name}  slug=${o.slug}  plan=${o.plan}  成员=${o.memberCount}  项目=${o.workspaceCount}`,
        );
      }
      break;
    }
    case 'org:show': {
      const detail = await getOrgDetail(required(flags, 'id'));
      console.log(JSON.stringify(detail, null, 2));
      break;
    }
    case 'org:disable': {
      await setOrgStatus({ orgId: required(flags, 'id'), status: 'disabled', actorId: null });
      console.log('[platform] 企业已停用');
      break;
    }
    case 'org:restore': {
      await setOrgStatus({ orgId: required(flags, 'id'), status: 'active', actorId: null });
      console.log('[platform] 企业已恢复');
      break;
    }
    case 'org:owner': {
      const owner = await assignOwner({
        orgId: required(flags, 'id'),
        email: required(flags, 'email'),
        actorId: null,
      });
      console.log(`[platform] 已指定 owner: ${owner.email}`);
      break;
    }
    case 'invite:create': {
      const invite = await createInvite({
        orgId: required(flags, 'org'),
        role: (flags.role as 'owner' | 'admin' | 'member' | undefined) ?? 'member',
        maxUses: flags['max-uses'] ? Number(flags['max-uses']) : undefined,
        expiresDays: flags['expires-days'] ? Number(flags['expires-days']) : null,
        actorId: null,
      });
      console.log(`[platform] 邀请码: ${invite.code}  org=${invite.orgName}  role=${invite.role}  maxUses=${invite.maxUses}  expires=${invite.expiresAt ?? 'never'}`);
      break;
    }
    default:
      console.log('用法: npm run platform -- <command> [flags]');
      console.log('命令: admin:grant | admin:revoke | admin:list | org:create | org:list | org:show | org:disable | org:restore | org:owner | invite:create');
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    console.error('[platform] 失败:', err instanceof Error ? err.message : err);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });

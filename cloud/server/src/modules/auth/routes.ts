// C3.5 Auth routes: invite-code registration, password login, token refresh.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool } from '../../infra/db/postgres.js';
import { env } from '../../config/env.js';
import {
  signAccessToken,
  issueRefreshToken,
  lookupRefreshToken,
  revokeRefreshToken,
  type AccessTokenPayload,
} from './tokens.js';

const BCRYPT_ROUNDS = 10;

// H1 (audit A7): brute-force protection on the public auth entry points. H8
// makes this tunable via env (AUTH_RATE_LIMIT_MAX / AUTH_RATE_LIMIT_WINDOW);
// max=0 disables it entirely so the regression gate can issue many auth calls.
const AUTH_RATE_LIMIT =
  env.AUTH_RATE_LIMIT_MAX > 0
    ? {
        config: {
          rateLimit: {
            max: env.AUTH_RATE_LIMIT_MAX,
            timeWindow: env.AUTH_RATE_LIMIT_WINDOW,
            errorResponseBuilder: () => ({
              statusCode: 429,
              ok: false,
              code: 'RATE_LIMITED',
              error: '操作过于频繁，请稍后再试。',
            }),
          },
        },
      }
    : {};

const registerSchema = z.object({
  inviteCode: z.string().min(1).max(64),
  email: z.string().email().max(255),
  password: z.string().min(6).max(200),
  displayName: z.string().min(1).max(120),
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  status: string;
  password_hash: string | null;
}

function publicUser(row: UserRow, orgId: string | null, orgRole?: string) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    orgId,
    orgRole: orgRole || 'member',
  };
}

/**
 * H1: resolve the user's active org membership together with the org status.
 * Returns null when the user has no active membership.
 */
async function resolveOrgMembership(userId: string) {
  const res = await pool.query<{ org_id: string; role: string; org_status: string }>(
    `SELECT m.org_id, m.role, o.status AS org_status
       FROM org_members m
       JOIN orgs o ON o.id = m.org_id
      WHERE m.user_id = $1 AND m.status = 'active'
      ORDER BY m.joined_at NULLS LAST LIMIT 1`,
    [userId],
  );
  return res.rows[0] ?? null;
}

async function isPlatformAdminUser(userId: string): Promise<boolean> {
  const res = await pool.query(`SELECT 1 FROM platform_admins WHERE user_id = $1`, [userId]);
  return (res.rowCount ?? 0) > 0;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get('/auth/status', async () => {
    return { ok: true, module: 'auth', status: 'ready' };
  });

  // ── Register with an invite code ───────────────────────────────────
  app.post('/api/auth/register', AUTH_RATE_LIMIT, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    const { inviteCode, email, password, displayName } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the invite row to safely increment used_count under concurrency.
      const invite = await client.query<{
        id: string;
        org_id: string;
        role: string;
        max_uses: number;
        used_count: number;
        expires_at: string | null;
        revoked_at: string | null;
      }>(
        `SELECT id, org_id, role, max_uses, used_count, expires_at, revoked_at
           FROM invite_codes WHERE code = $1 FOR UPDATE`,
        [inviteCode.trim()],
      );
      if (invite.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ ok: false, error: '邀请码无效。' });
      }
      const inv = invite.rows[0];
      if (inv.revoked_at) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ ok: false, code: 'INVITE_REVOKED', error: '邀请码已被撤销。' });
      }
      if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ ok: false, error: '邀请码已过期。' });
      }
      if (inv.used_count >= inv.max_uses) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ ok: false, error: '邀请码使用次数已达上限。' });
      }

      // Email must be unique.
      const existing = await client.query(`SELECT 1 FROM users WHERE email = $1`, [normalizedEmail]);
      if (existing.rowCount && existing.rowCount > 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ ok: false, error: '该邮箱已注册。' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const userRes = await client.query<UserRow>(
        `INSERT INTO users (email, display_name, password_hash, last_login_at)
         VALUES ($1, $2, $3, now())
         RETURNING id, email, display_name, avatar_url, status, password_hash`,
        [normalizedEmail, displayName.trim(), passwordHash],
      );
      const user = userRes.rows[0];

      await client.query(
        `INSERT INTO org_members (org_id, user_id, role, joined_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (org_id, user_id) DO NOTHING`,
        [inv.org_id, user.id, inv.role],
      );

      await client.query(
        `UPDATE invite_codes SET used_count = used_count + 1 WHERE id = $1`,
        [inv.id],
      );

      await client.query(
        `INSERT INTO events (org_id, actor_id, event_type, payload)
         VALUES ($1, $2, 'user.registered', $3::jsonb)`,
        [inv.org_id, user.id, JSON.stringify({ email: normalizedEmail })],
      );

      await client.query('COMMIT');

      const payload: AccessTokenPayload = { sub: user.id, orgId: inv.org_id, email: user.email };
      const accessToken = signAccessToken(payload);
      const refreshToken = await issueRefreshToken(user.id);

      return reply.code(201).send({
        ok: true,
        accessToken,
        refreshToken,
        user: publicUser(user, inv.org_id, inv.role),
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      request.log.error(err);
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.release();
    }
  });

  // ── Login with email + password ────────────────────────────────────
  app.post('/api/auth/login', AUTH_RATE_LIMIT, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
    }
    const normalizedEmail = parsed.data.email.trim().toLowerCase();

    const userRes = await pool.query<UserRow>(
      `SELECT id, email, display_name, avatar_url, status, password_hash
         FROM users WHERE email = $1`,
      [normalizedEmail],
    );
    const user = userRes.rows[0];
    if (!user || !user.password_hash) {
      return reply.code(401).send({ ok: false, error: '邮箱或密码错误。' });
    }
    if (user.status !== 'active') {
      return reply.code(403).send({ ok: false, error: '账号已被禁用。' });
    }

    const valid = await bcrypt.compare(parsed.data.password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({ ok: false, error: '邮箱或密码错误。' });
    }

    // Resolve the user's org (single-org assumption in C4). H1: platform
    // admins are allowed to log in without an org membership.
    const membership = await resolveOrgMembership(user.id);
    let orgId: string | null = membership?.org_id ?? null;
    let orgRole: string | undefined = membership?.role;
    if (membership && membership.org_status !== 'active') {
      return reply.code(403).send({ ok: false, code: 'ORG_DISABLED', error: '企业已被停用，请联系平台管理员。' });
    }
    if (!membership) {
      if (await isPlatformAdminUser(user.id)) {
        orgId = null;
        orgRole = 'platform_admin';
      } else {
        return reply.code(403).send({ ok: false, code: 'NO_ORG', error: '账号未关联任何组织。' });
      }
    }

    await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

    const payload: AccessTokenPayload = { sub: user.id, orgId, email: user.email };
    const accessToken = signAccessToken(payload);
    const refreshToken = await issueRefreshToken(user.id);

    return reply.send({
      ok: true,
      accessToken,
      refreshToken,
      user: publicUser(user, orgId, orgRole),
    });
  });

  // ── Refresh access token ───────────────────────────────────────────
  app.post('/api/auth/refresh', AUTH_RATE_LIMIT, async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body' });
    }

    const result = await lookupRefreshToken(parsed.data.refreshToken);
    if (!result) {
      return reply.code(401).send({ ok: false, error: 'Refresh token 无效或已过期。' });
    }

    const userRes = await pool.query<UserRow>(
      `SELECT id, email, display_name, avatar_url, status, password_hash
         FROM users WHERE id = $1`,
      [result.userId],
    );
    const user = userRes.rows[0];
    if (!user || user.status !== 'active') {
      return reply.code(401).send({ ok: false, error: '账号不可用。' });
    }

    const membership = await resolveOrgMembership(user.id);
    let orgId: string | null = membership?.org_id ?? null;
    let orgRole: string | undefined = membership?.role;
    if (membership && membership.org_status !== 'active') {
      return reply.code(403).send({ ok: false, code: 'ORG_DISABLED', error: '企业已被停用，请联系平台管理员。' });
    }
    if (!membership) {
      if (await isPlatformAdminUser(user.id)) {
        orgId = null;
        orgRole = 'platform_admin';
      } else {
        return reply.code(403).send({ ok: false, code: 'NO_ORG', error: '账号未关联任何组织。' });
      }
    }

    // Rotate: revoke the old refresh token, issue a new pair.
    await revokeRefreshToken(parsed.data.refreshToken);
    const payload: AccessTokenPayload = { sub: user.id, orgId, email: user.email };
    const accessToken = signAccessToken(payload);
    const refreshToken = await issueRefreshToken(user.id);

    return reply.send({
      ok: true,
      accessToken,
      refreshToken,
      user: publicUser(user, orgId, orgRole),
    });
  });

  // ── Logout (revoke refresh token) ──────────────────────────────────
  app.post('/api/auth/logout', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (parsed.success) {
      await revokeRefreshToken(parsed.data.refreshToken).catch(() => undefined);
    }
    return reply.send({ ok: true });
  });

  // ── Current user ───────────────────────────────────────────────────
  app.get('/api/auth/me', async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthenticated.' });

    const userRes = await pool.query<UserRow>(
      `SELECT id, email, display_name, avatar_url, status, password_hash
         FROM users WHERE id = $1`,
      [userId],
    );
    const user = userRes.rows[0];
    if (!user) return reply.code(404).send({ ok: false, error: 'User not found.' });

    let orgRole = 'member';
    if (request.orgId) {
      const roleRes = await pool.query<{ role: string }>(
        `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 AND status = 'active'`,
        [request.orgId, userId],
      );
      orgRole = roleRes.rows[0]?.role || orgRole;
    }

    return reply.send({ ok: true, user: publicUser(user, request.orgId ?? '', orgRole) });
  });
}

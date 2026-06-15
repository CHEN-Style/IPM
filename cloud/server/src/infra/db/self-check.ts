import { pool } from './postgres.js';

export interface SelfCheckSummary {
  userId: string;
  orgId: string;
  workspaceId: string;
  versionId: string;
  objectId: string;
  manifest: Array<{
    path: string;
    name: string;
    entry_type: string;
    size_bytes: number | null;
  }>;
  eventCount: number;
}

/**
 * Inserts a minimal user → org → workspace → object → version → entry → event
 * chain inside a transaction, queries the manifest of the workspace's current
 * version, and rolls everything back. Used to verify that the C1 schema is
 * coherent without leaving any data behind.
 */
export async function runSelfCheck(): Promise<SelfCheckSummary> {
  const client = await pool.connect();
  const tag = `c1-selfcheck-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  try {
    await client.query('BEGIN');

    const u = await client.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2)
       RETURNING id`,
      [`${tag}@ipm.local`, 'Self-check User'],
    );
    const userId = u.rows[0].id;

    const o = await client.query<{ id: string }>(
      `INSERT INTO orgs (name, slug, created_by)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['Self-check Org', tag, userId],
    );
    const orgId = o.rows[0].id;

    await client.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [orgId, userId],
    );

    const w = await client.query<{ id: string }>(
      `INSERT INTO workspaces (org_id, domain, name, description, created_by)
       VALUES ($1, 'cases', $2, $3, $4)
       RETURNING id`,
      [orgId, '自检案件 / Self-check Case', '由 db:check 创建的临时案件，事务结束后回滚。', userId],
    );
    const workspaceId = w.rows[0].id;

    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );

    const sha = `selfcheck-${tag}`.padEnd(64, '0').slice(0, 64);
    // H1: objects are org-scoped (`org_id` NOT NULL, org-scoped storage key).
    const ob = await client.query<{ id: string }>(
      `INSERT INTO objects
         (org_id, sha256, size_bytes, mime_type, bucket, region, storage_key, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', $8)
       RETURNING id`,
      [
        orgId,
        sha,
        2048,
        'application/pdf',
        'ipm-cloud-dev-1',
        'oss-cn-shanghai',
        `blobs/${orgId}/sha256/${sha.slice(0, 2)}/${sha}.bin`,
        userId,
      ],
    );
    const objectId = ob.rows[0].id;

    const v = await client.query<{ id: string }>(
      `INSERT INTO versions (workspace_id, version_number, author_id, message)
       VALUES ($1, 1, $2, $3)
       RETURNING id`,
      [workspaceId, userId, '自检初始提交'],
    );
    const versionId = v.rows[0].id;

    await client.query(
      `INSERT INTO version_entries
         (version_id, workspace_id, path, name, entry_type, object_id, size_bytes, mime_type, metadata)
       VALUES
         ($1, $2, '/收到资料', '收到资料', 'folder', NULL, NULL, NULL, '{"systemFolder":true}'::jsonb),
         ($1, $2, '/收到资料/合同.pdf', '合同.pdf', 'file', $3, $4, 'application/pdf', '{}'::jsonb)`,
      [versionId, workspaceId, objectId, 2048],
    );

    await client.query(
      `UPDATE workspaces SET current_version_id = $1, updated_at = now() WHERE id = $2`,
      [versionId, workspaceId],
    );

    await client.query(
      `INSERT INTO events (org_id, workspace_id, actor_id, event_type, payload)
       VALUES
         ($1, $2, $3, 'workspace.created', $4::jsonb),
         ($1, $2, $3, 'version.committed', $5::jsonb)`,
      [
        orgId,
        workspaceId,
        userId,
        JSON.stringify({ workspaceId }),
        JSON.stringify({ versionId, versionNumber: 1, message: '自检初始提交' }),
      ],
    );

    const manifestQuery = await client.query<{
      path: string;
      name: string;
      entry_type: string;
      size_bytes: number | null;
    }>(
      `SELECT ve.path, ve.name, ve.entry_type, ve.size_bytes
         FROM workspaces w
         JOIN version_entries ve ON ve.version_id = w.current_version_id
        WHERE w.id = $1
        ORDER BY ve.path`,
      [workspaceId],
    );

    const eventCountQuery = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM events WHERE workspace_id = $1`,
      [workspaceId],
    );

    const summary: SelfCheckSummary = {
      userId,
      orgId,
      workspaceId,
      versionId,
      objectId,
      manifest: manifestQuery.rows,
      eventCount: Number(eventCountQuery.rows[0]?.count ?? '0'),
    };

    await client.query('ROLLBACK');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

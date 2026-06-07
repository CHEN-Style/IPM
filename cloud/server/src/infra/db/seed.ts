import { pool } from './postgres.js';
import {
  DEV_USER_ID,
  DEV_USER_EMAIL,
  DEV_USER_DISPLAY_NAME,
  DEV_ORG_ID,
  DEV_ORG_NAME,
  DEV_ORG_SLUG,
} from '../../config/devConstants.js';

export interface SeedSummary {
  userId: string;
  orgId: string;
  orgSlug: string;
}

/**
 * Insert the fixed development user + org + owner membership. Idempotent:
 * running it multiple times leaves the same rows in place.
 */
export async function runSeed(): Promise<SeedSummary> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [DEV_USER_ID, DEV_USER_EMAIL, DEV_USER_DISPLAY_NAME],
    );

    await client.query(
      `INSERT INTO orgs (id, name, slug, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [DEV_ORG_ID, DEV_ORG_NAME, DEV_ORG_SLUG, DEV_USER_ID],
    );

    await client.query(
      `INSERT INTO org_members (org_id, user_id, role, joined_at)
       VALUES ($1, $2, 'owner', now())
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [DEV_ORG_ID, DEV_USER_ID],
    );

    await client.query('COMMIT');
    return { userId: DEV_USER_ID, orgId: DEV_ORG_ID, orgSlug: DEV_ORG_SLUG };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

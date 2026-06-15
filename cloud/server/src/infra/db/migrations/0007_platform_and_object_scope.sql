-- H1 Platform Super Admin + object org-scoping (audit findings A1/A5/A8/A11).
--
-- Design:
--   * `platform_admins` grants platform-level capability to ordinary user
--     accounts. Checked per-request (no JWT claim) so revocation is instant.
--   * `objects` become org-scoped: dedup is per org (`UNIQUE(org_id, sha256)`),
--     new uploads use org-scoped storage keys (`blobs/{orgId}/sha256/...`).
--     Cross-org dedup is intentionally dropped — the org is the trust and
--     confidentiality boundary for law-firm data.
--   * Status columns gain CHECK constraints (audit A8). `workspaces.status`
--     reserves 'archived' for Phase H3 governance.

-- ── platform_admins ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── objects: org scoping ──────────────────────────────────────────────
ALTER TABLE objects
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES orgs (id) ON DELETE CASCADE;

-- Abort if any existing object is referenced by workspaces of more than one
-- org. That state cannot be represented after scoping and needs manual
-- resolution (duplicate the row per org) before re-running this migration.
DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT COUNT(*) INTO conflict_count FROM (
    SELECT ve.object_id
    FROM version_entries ve
    JOIN workspaces w ON w.id = ve.workspace_id
    WHERE ve.object_id IS NOT NULL
    GROUP BY ve.object_id
    HAVING COUNT(DISTINCT w.org_id) > 1
  ) AS multi;
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'H1 migration aborted: % object(s) are referenced by multiple orgs and must be split manually first', conflict_count;
  END IF;
END $$;

-- Backfill 1: from referencing workspaces (authoritative).
UPDATE objects o
SET org_id = sub.org_id
FROM (
  SELECT DISTINCT ve.object_id, w.org_id
  FROM version_entries ve
  JOIN workspaces w ON w.id = ve.workspace_id
  WHERE ve.object_id IS NOT NULL
) AS sub
WHERE o.id = sub.object_id AND o.org_id IS NULL;

-- Backfill 2: unreferenced (pending) objects fall back to the uploader's org.
UPDATE objects o
SET org_id = m.org_id
FROM org_members m
WHERE o.org_id IS NULL
  AND o.created_by IS NOT NULL
  AND m.user_id = o.created_by;

-- Backfill 3: drop orphans with no resolvable org. They are unreferenced by
-- definition (version_entries FK would have matched in backfill 1), so this
-- cannot delete anything reachable from a manifest.
DELETE FROM objects WHERE org_id IS NULL;

ALTER TABLE objects ALTER COLUMN org_id SET NOT NULL;

-- Dedup becomes per-org; storage_key uniqueness is dropped (legacy global
-- keys and new org-scoped keys coexist; rows never share keys across orgs
-- thanks to the multi-org guard above).
ALTER TABLE objects DROP CONSTRAINT IF EXISTS objects_sha256_key;
ALTER TABLE objects ADD CONSTRAINT objects_org_sha256_key UNIQUE (org_id, sha256);
ALTER TABLE objects DROP CONSTRAINT IF EXISTS objects_storage_key_key;
CREATE INDEX IF NOT EXISTS objects_storage_key_idx ON objects (storage_key);
CREATE INDEX IF NOT EXISTS objects_org_idx ON objects (org_id);

-- ── status CHECK constraints (audit A8) ───────────────────────────────
ALTER TABLE users
  ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'));
ALTER TABLE orgs
  ADD CONSTRAINT orgs_status_check CHECK (status IN ('active', 'disabled'));
ALTER TABLE org_members
  ADD CONSTRAINT org_members_status_check CHECK (status IN ('active', 'disabled'));
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_status_check CHECK (status IN ('active', 'disabled', 'archived'));

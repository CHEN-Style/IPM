-- C7 Skill Registry: org-scoped Skill market.
--
-- First version scope:
--   * Skills are visible inside the creator's org.
--   * Any active org member may publish.
--   * Installs are per-user; enterprise default distribution is C8/C9.

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  publisher_id uuid REFERENCES users (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  latest_version_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS skills_org_status_idx ON skills (org_id, status);
CREATE INDEX IF NOT EXISTS skills_publisher_idx ON skills (publisher_id);

CREATE TABLE IF NOT EXISTS skill_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  version text NOT NULL,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  package_sha256 text NOT NULL,
  package_size_bytes bigint NOT NULL DEFAULT 0,
  bucket text,
  region text,
  storage_key text NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version)
);

CREATE INDEX IF NOT EXISTS skill_versions_skill_idx ON skill_versions (skill_id);
CREATE INDEX IF NOT EXISTS skill_versions_created_by_idx ON skill_versions (created_by);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skills_latest_version_fk'
  ) THEN
    ALTER TABLE skills
      ADD CONSTRAINT skills_latest_version_fk
      FOREIGN KEY (latest_version_id) REFERENCES skill_versions (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS skill_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES skill_versions (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'org_registry',
  installed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, user_id)
);

CREATE INDEX IF NOT EXISTS skill_installs_user_idx ON skill_installs (user_id);
CREATE INDEX IF NOT EXISTS skill_installs_org_user_idx ON skill_installs (org_id, user_id);

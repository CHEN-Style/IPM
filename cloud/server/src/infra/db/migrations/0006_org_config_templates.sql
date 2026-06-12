-- C9 Enterprise AI configuration templates.
--
-- Admins save structured AI settings into PostgreSQL and distribute them via
-- org-scoped codes. No OSS storage is involved.

CREATE TABLE IF NOT EXISTS org_config_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  template_type text NOT NULL DEFAULT 'ai_settings'
    CHECK (template_type IN ('ai_settings')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  config_json jsonb NOT NULL,
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'archived')),
  max_uses int CHECK (max_uses IS NULL OR max_uses > 0),
  used_count int NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at timestamptz,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

CREATE INDEX IF NOT EXISTS org_config_templates_org_idx
  ON org_config_templates (org_id, template_type, status);

CREATE INDEX IF NOT EXISTS org_config_templates_created_by_idx
  ON org_config_templates (created_by);

CREATE TABLE IF NOT EXISTS org_config_template_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES org_config_templates (id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now(),
  client_info jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS org_config_template_uses_template_idx
  ON org_config_template_uses (template_id, used_at DESC);

CREATE INDEX IF NOT EXISTS org_config_template_uses_user_idx
  ON org_config_template_uses (user_id, used_at DESC);

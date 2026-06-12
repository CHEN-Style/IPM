-- C3.5 Auth: real authentication primitives.
--
-- Adds:
--   * password_hash on users (bcrypt; null for legacy/dev/seeded users)
--   * invite_codes  — org-scoped registration codes
--   * refresh_tokens — opaque refresh tokens (stored hashed) for token rotation

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  max_uses int NOT NULL DEFAULT 50,
  used_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invite_codes_org_idx ON invite_codes (org_id);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

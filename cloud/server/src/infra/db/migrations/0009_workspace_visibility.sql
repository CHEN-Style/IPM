-- H4 Cloud project visibility & workspace invite codes.
--
--   * `workspaces.visibility` — 'private' (default; only members can see the
--     workspace, others join via invite code as editor) or 'public' (visible
--     to every org member, self-join grants read-only viewer; the owner
--     promotes collaborators manually). Existing workspaces all become
--     private (privacy-first migration decision).
--   * `workspace_invites` — owner-issued join codes scoped to one workspace.
--     A code grants editor on join; it can carry a usage cap, an expiry, and
--     can be revoked (members who already joined are unaffected).

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

ALTER TABLE workspaces
  DROP CONSTRAINT IF EXISTS workspaces_visibility_check;
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_visibility_check CHECK (visibility IN ('private', 'public'));

CREATE TABLE IF NOT EXISTS workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_invites_ws_idx ON workspace_invites (workspace_id, created_at DESC);

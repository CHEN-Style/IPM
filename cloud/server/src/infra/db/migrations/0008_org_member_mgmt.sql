-- H2 Enterprise Admin: org member & invite management.
--
--   * `invite_codes.revoked_at` — an org admin can revoke an outstanding
--     invite code; registration rejects revoked codes. Existing members who
--     registered through the code are unaffected.
--   * events (org_id, actor_id, created_at) index — backs the "last activity"
--     column on the member list (latest event per actor within an org).

ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS events_org_actor_idx ON events (org_id, actor_id, created_at DESC);

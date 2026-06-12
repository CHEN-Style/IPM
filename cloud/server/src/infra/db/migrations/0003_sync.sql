-- C5 Sync: explicit push/pull, soft-delete, and milestone versions.
--
-- Design (per IPM cloud collaboration model — NOT git):
--   * Daily sync != version. Every commit still creates a `versions` row so we
--     can diff and recover, but only `type='milestone'` versions are surfaced
--     to users as named snapshots. `type='sync'` is the high-frequency,
--     low-ceremony default.
--   * Delete is a mark, not a destruction. A removed file becomes a
--     `version_entry` with `status='soft_deleted'` (its object_id / OSS blob is
--     kept). Hard deletion is a separate, manager-gated action (later phase).
--   * Folder structure is protected: only workspace owners/admins may change
--     the canonical folder set, tracked in `workspace_folders`.

-- ── versions: distinguish daily sync from manager milestones ──────────
ALTER TABLE versions
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'sync'
    CHECK (type IN ('sync', 'milestone'));

ALTER TABLE versions
  ADD COLUMN IF NOT EXISTS label text;

CREATE INDEX IF NOT EXISTS versions_type_idx ON versions (workspace_id, type);

-- ── version_entries: soft-delete marking ─────────────────────────────
ALTER TABLE version_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'soft_deleted'));

ALTER TABLE version_entries
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE version_entries
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS version_entries_status_idx ON version_entries (version_id, status);

-- The original 0001 CHECK requires a file entry to carry an object_id. Soft
-- deleted files keep their object_id (the blob is retained), so the existing
-- constraint still holds and needs no change.

-- ── workspace_folders: canonical, manager-owned folder structure ──────
CREATE TABLE IF NOT EXISTS workspace_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  path text NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, path)
);

CREATE INDEX IF NOT EXISTS workspace_folders_workspace_idx ON workspace_folders (workspace_id);

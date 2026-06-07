-- IPM Cloud v2.1 — C1 initial schema
-- Creates the Cloud Core data model: users, orgs, workspaces, objects,
-- versions, manifest entries, and an event log.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  avatar_url text,
  status text NOT NULL DEFAULT 'active',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_status_idx ON users (status);

CREATE TABLE orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'dev',
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orgs_status_idx ON orgs (status);

CREATE TABLE org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'active',
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX org_members_user_idx ON org_members (user_id);
CREATE INDEX org_members_org_idx ON org_members (org_id);

-- Workspaces are created before versions; the FK to current_version_id is
-- added at the end of this migration once versions exists.
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('projects', 'cases', 'study')),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspaces_org_idx ON workspaces (org_id);
CREATE INDEX workspaces_status_idx ON workspaces (status);
CREATE INDEX workspaces_domain_idx ON workspaces (domain);

CREATE TABLE workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);
CREATE INDEX workspace_members_workspace_idx ON workspace_members (workspace_id);

CREATE TABLE objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  mime_type text,
  bucket text NOT NULL,
  region text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'available', 'deleted')),
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE INDEX objects_status_idx ON objects (status);

CREATE TABLE versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  parent_version_id uuid REFERENCES versions (id) ON DELETE SET NULL,
  version_number integer NOT NULL,
  author_id uuid REFERENCES users (id) ON DELETE SET NULL,
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'committed'
    CHECK (status IN ('committed', 'superseded', 'reverted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, version_number)
);

CREATE INDEX versions_workspace_idx ON versions (workspace_id);
CREATE INDEX versions_parent_idx ON versions (parent_version_id);
CREATE INDEX versions_author_idx ON versions (author_id);

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES versions (id)
  ON DELETE SET NULL;

CREATE TABLE version_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  path text NOT NULL,
  name text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('file', 'folder')),
  object_id uuid REFERENCES objects (id) ON DELETE RESTRICT,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  mime_type text,
  mtime timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, path),
  CHECK (
    (entry_type = 'file' AND object_id IS NOT NULL)
    OR (entry_type = 'folder' AND object_id IS NULL)
  )
);

CREATE INDEX version_entries_version_idx ON version_entries (version_id);
CREATE INDEX version_entries_workspace_idx ON version_entries (workspace_id);
CREATE INDEX version_entries_object_idx ON version_entries (object_id);
CREATE INDEX version_entries_path_idx ON version_entries (workspace_id, path);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES orgs (id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_workspace_idx ON events (workspace_id);
CREATE INDEX events_org_idx ON events (org_id);
CREATE INDEX events_type_idx ON events (event_type);
CREATE INDEX events_created_at_idx ON events (created_at);

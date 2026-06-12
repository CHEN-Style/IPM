-- C8 Skill review and access control.
--
-- C7 exposed org registry skills immediately. C8 turns that into an
-- enterprise-governed flow:
--   pending_review -> approved / rejected -> archived
-- and gates market visibility/download/install through explicit grants.

ALTER TABLE skills
  DROP CONSTRAINT IF EXISTS skills_status_check;

ALTER TABLE skills
  ADD CONSTRAINT skills_status_check
  CHECK (status IN ('pending_review', 'approved', 'rejected', 'archived', 'active'));

UPDATE skills
   SET status = 'approved'
 WHERE status = 'active';

ALTER TABLE skills
  DROP CONSTRAINT IF EXISTS skills_status_check;

ALTER TABLE skills
  ADD CONSTRAINT skills_status_check
  CHECK (status IN ('pending_review', 'approved', 'rejected', 'archived'));

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS review_note text;

CREATE TABLE IF NOT EXISTS skill_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  grant_type text NOT NULL CHECK (grant_type IN ('org', 'user')),
  user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (grant_type = 'org' AND user_id IS NULL)
    OR (grant_type = 'user' AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_access_grants_org_unique
  ON skill_access_grants (skill_id)
  WHERE grant_type = 'org';

CREATE UNIQUE INDEX IF NOT EXISTS skill_access_grants_user_unique
  ON skill_access_grants (skill_id, user_id)
  WHERE grant_type = 'user';

CREATE INDEX IF NOT EXISTS skill_access_grants_skill_idx ON skill_access_grants (skill_id);
CREATE INDEX IF NOT EXISTS skill_access_grants_user_idx ON skill_access_grants (user_id);

-- Preserve C7 behavior for existing approved skills: they remain visible to
-- the whole organization until an admin narrows the grants.
INSERT INTO skill_access_grants (skill_id, grant_type, created_by)
SELECT s.id, 'org', s.publisher_id
  FROM skills s
 WHERE s.status = 'approved'
   AND NOT EXISTS (
     SELECT 1 FROM skill_access_grants g
      WHERE g.skill_id = s.id AND g.grant_type = 'org'
   );

UPDATE skills
   SET reviewed_by = COALESCE(reviewed_by, publisher_id),
       reviewed_at = COALESCE(reviewed_at, updated_at)
 WHERE status = 'approved';

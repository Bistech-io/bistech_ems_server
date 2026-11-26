-- 0012_feedback_comments.sql
-- Ensures feedback_items composite unique key for tenant-scoped FK references
-- and creates feedback_comments table for threaded sticky-note comments on the
-- Notice & Opinion Board.

CREATE UNIQUE INDEX IF NOT EXISTS feedback_items_organization_id_id_key
  ON feedback_items (organization_id, id);

CREATE TABLE IF NOT EXISTS feedback_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  feedback_id     UUID NOT NULL,
  author_user_id  UUID NOT NULL,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT feedback_comments_organization_id_feedback_id_fkey
    FOREIGN KEY (organization_id, feedback_id)
    REFERENCES feedback_items (organization_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT feedback_comments_organization_id_author_user_id_fkey
    FOREIGN KEY (organization_id, author_user_id)
    REFERENCES users (organization_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS feedback_comments_feedback_id_created_at_id_idx
  ON feedback_comments (feedback_id, created_at, id);

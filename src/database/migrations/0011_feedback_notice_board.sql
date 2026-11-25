-- 0011_feedback_notice_board.sql
-- Adds is_notice flag to feedback_items so the shared Notice & Opinion Board
-- stores both official notices (Super Admin, HR Manager, Dept Head) and
-- employee opinions/feedback in the same table.

ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS is_notice BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_feedback_items_org_notice_created
  ON feedback_items (organization_id, is_notice, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Quick tasks on an engagement
--
-- A quick task given from an engagement's page carries that engagement, and
-- the page shows the open ones in a strip by its tabs. The label is kept as
-- the assigner saw it, as entity_label is: the assignee may not be on the
-- engagement's team.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.quick_tasks
  ADD COLUMN engagement_id    uuid REFERENCES hsdg.engagements (id) ON DELETE SET NULL,
  ADD COLUMN engagement_label text;
CREATE INDEX quick_tasks_engagement_idx ON hsdg.quick_tasks (engagement_id, status)
  WHERE engagement_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS hsdg.quick_tasks_engagement_idx;
ALTER TABLE hsdg.quick_tasks DROP COLUMN IF EXISTS engagement_label,
                             DROP COLUMN IF EXISTS engagement_id;

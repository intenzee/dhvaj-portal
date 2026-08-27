-- ─────────────────────────────────────────────────────────────────────────
-- 0036 · Link auto-generated tasks to their source compliance obligation
--
-- §17 step 10 ("create required tasks") is materialised by generating one task
-- when a statutory obligation is created. To keep that idempotent and traceable,
-- a task records the compliance instance it was generated from. A partial unique
-- index enforces at most ONE auto-generated task per instance, so a re-run (or a
-- horizon roll revisiting the same period) never duplicates it. Manually created
-- tasks leave the column NULL and are unconstrained.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.tasks
  ADD COLUMN source_compliance_instance_id uuid
    REFERENCES hsdg.compliance_instances (id) ON DELETE CASCADE;

-- One auto-generated task per obligation (NULL source = manual task, unconstrained).
CREATE UNIQUE INDEX tasks_one_per_source_instance
  ON hsdg.tasks (source_compliance_instance_id)
  WHERE source_compliance_instance_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS hsdg.tasks_one_per_source_instance;
ALTER TABLE hsdg.tasks DROP COLUMN IF EXISTS source_compliance_instance_id;

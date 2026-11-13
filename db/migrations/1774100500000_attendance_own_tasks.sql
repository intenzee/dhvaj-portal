-- ─────────────────────────────────────────────────────────────────────────
-- My attendance: a task of your own, by name
--
-- WHY: much of the day is work that is neither a client's nor one of the
-- firm-work kinds (meeting, training, admin, travel) — "Bank reconciliation
-- for the firm", "Interview for the article". "Add work → Task" takes just
-- what was done and how long; the name is kept on the firm-work row and
-- shown as the row's title. It counts toward the day like any other row.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.internal_time_entries
  ADD COLUMN title text CHECK (title IS NULL OR (length(btrim(title)) BETWEEN 1 AND 200));

-- Down Migration

ALTER TABLE hsdg.internal_time_entries DROP COLUMN IF EXISTS title;

-- ─────────────────────────────────────────────────────────────────────────
-- Statutory Audit — Team plans itself from the file
--
-- A person's planned hours can now be estimated from the work they own and
-- review on the file. `is_suggested` marks an allocation the system wrote;
-- it is kept in line with the file until a person sets the hours, after
-- which it is theirs and never overwritten. `basis` says how it was worked
-- out ("12 procedures (36h), 2 areas (2h) …").
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_team_allocations
  ADD COLUMN is_suggested boolean NOT NULL DEFAULT false,
  ADD COLUMN basis        text;

-- Down Migration

ALTER TABLE hsdg.audit_team_allocations
  DROP COLUMN IF EXISTS basis,
  DROP COLUMN IF EXISTS is_suggested;

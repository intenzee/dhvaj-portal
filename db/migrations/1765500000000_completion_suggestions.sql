-- ─────────────────────────────────────────────────────────────────────────
-- Statutory Audit — Section 07 / 08 completion checklist keeps itself current
--
-- The Completion and Reporting checklist items are now drafted from the file:
-- an item the team has not touched follows the evidence (not applicable from
-- the Section 02 framework, in progress once the linked work starts), and a
-- blank note carries a drafted note / completion memo. Two flags record
-- whether the state and the note are still the system's suggestion — the
-- moment a person sets either, it is theirs and is never overwritten.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_completion_items
  ADD COLUMN state_suggested boolean NOT NULL DEFAULT true,
  ADD COLUMN note_suggested  boolean NOT NULL DEFAULT false;

-- Items a person already worked on are theirs.
UPDATE hsdg.audit_completion_items
   SET state_suggested = false
 WHERE updated_by_employee_id IS NOT NULL OR state <> 'not_started';

-- Down Migration

ALTER TABLE hsdg.audit_completion_items
  DROP COLUMN IF EXISTS state_suggested,
  DROP COLUMN IF EXISTS note_suggested;

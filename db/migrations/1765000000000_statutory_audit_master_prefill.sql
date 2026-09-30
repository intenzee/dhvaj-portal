-- ─────────────────────────────────────────────────────────────────────────
-- 0070 · 03.2 capture-once prefill marker
--
-- WHY: 03.2 must prefill stable facts from the client master / Sections 01–02
-- instead of asking the team to re-key them (03.2 spec §4, §28; Guide §1).
-- The dataset header, the CY/PY figures held on the entity's financial
-- profiles and the business-model answers are seeded into an audit file the
-- first time 03.2 is opened. This timestamp makes that seed one-shot: a figure
-- the team later deletes or edits is never silently put back. Re-running the
-- fill is an explicit user action that only fills blanks.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_business_understanding
  ADD COLUMN master_prefilled_at timestamptz;

-- Down Migration

ALTER TABLE hsdg.audit_business_understanding
  DROP COLUMN IF EXISTS master_prefilled_at;

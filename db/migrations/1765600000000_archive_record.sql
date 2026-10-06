-- ─────────────────────────────────────────────────────────────────────────
-- Statutory Audit — Section 10 archive record
--
-- Archiving now records, on the shell, the facts the archive is kept by: the
-- date of the auditor's report (defaults to the sign-off date), its ICAI UDIN,
-- and the date the file must be kept until (report date + 7 years, SQC 1).
-- The 60-day assembly deadline (SA 230) is derived from the report date.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.service_workflow_instances
  ADD COLUMN report_date  date,
  ADD COLUMN udin         text CHECK (udin IS NULL OR udin ~ '^[0-9]{8}[A-Z0-9]{10}$'),
  ADD COLUMN retain_until date;

-- Files already archived: report date = sign-off date, kept seven years.
UPDATE hsdg.service_workflow_instances
   SET report_date = signed_off_at::date,
       retain_until = (signed_off_at::date + interval '7 years')::date
 WHERE archived_at IS NOT NULL AND signed_off_at IS NOT NULL AND report_date IS NULL;

-- Down Migration

ALTER TABLE hsdg.service_workflow_instances
  DROP COLUMN IF EXISTS report_date,
  DROP COLUMN IF EXISTS udin,
  DROP COLUMN IF EXISTS retain_until;

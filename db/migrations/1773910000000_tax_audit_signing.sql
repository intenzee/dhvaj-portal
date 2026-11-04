-- Up Migration
-- Tax Audit sign and file (Phase 5, F-8).
--
-- Once the review is signed off, the signing Partner signs the report with
-- its UDIN and the signed PDF. The CA then uploads it on the e-filing portal,
-- the client accepts it (or rejects it, which sends it back to review), and
-- it is filed with its acknowledgement. The year's IT_TAX_AUDIT filing is
-- lodged through the filing workspace, as every other filing is, and the
-- audit takes its acknowledgement number, date and file from that lodge. A
-- revised report is the next revision of the year's audit, with its reason.

ALTER TABLE hsdg.tax_audits
  ADD COLUMN signed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN signed_report_document_id uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  ADD COLUMN client_rejection_reason text
    CHECK (client_rejection_reason IS NULL OR length(btrim(client_rejection_reason)) BETWEEN 1 AND 1000),
  ADD COLUMN acknowledgement_document_id uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  -- A revised report (revision 1, 2 …) names the filed report it revises.
  ADD COLUMN revised_from_id uuid UNIQUE REFERENCES hsdg.tax_audits (id) ON DELETE SET NULL,
  ADD COLUMN revision_reason text
    CHECK (revision_reason IS NULL OR length(btrim(revision_reason)) BETWEEN 1 AND 1000),
  ADD CONSTRAINT tax_audits_revision_reason
    CHECK ((revision > 0) = (revision_reason IS NOT NULL) AND (revised_from_id IS NULL OR revision > 0));

-- A signed, uploaded or accepted report carries what got it there. NOT VALID:
-- reports already on the portal keep what they have; new ones are checked.
ALTER TABLE hsdg.tax_audits
  ADD CONSTRAINT tax_audits_signed_report CHECK (
    stage NOT IN ('signed', 'uploaded', 'client_accepted')
    OR (udin IS NOT NULL AND signed_at IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT tax_audits_uploaded_report CHECK (
    stage NOT IN ('uploaded', 'client_accepted') OR uploaded_on IS NOT NULL) NOT VALID,
  ADD CONSTRAINT tax_audits_accepted_report CHECK (
    stage <> 'client_accepted' OR client_accepted_on IS NOT NULL) NOT VALID;

-- Lodging the year's filing files the report: the audit takes the lodge's
-- acknowledgement number, date and file. Undoing it puts the audit back
-- where its own dates say it was.
CREATE OR REPLACE FUNCTION hsdg.tax_audit_follow_filing() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fr record;
BEGIN
  SELECT r.reference_no, r.filed_on, r.ack_document_id INTO fr
    FROM hsdg.filing_records r
   WHERE r.compliance_instance_id = NEW.id AND r.undone_at IS NULL
   LIMIT 1;
  UPDATE hsdg.tax_audits a
     SET stage = CASE
           WHEN NEW.workflow_status = 'filed' THEN 'filed'
           WHEN NEW.workflow_status = 'not_applicable' THEN 'not_applicable'
           WHEN a.client_accepted_on IS NOT NULL THEN 'client_accepted'
           WHEN a.uploaded_on IS NOT NULL THEN 'uploaded'
           WHEN a.signed_at IS NOT NULL THEN 'signed'
           ELSE 'not_started' END,
         filed_on = CASE WHEN NEW.workflow_status = 'filed'
                         THEN coalesce(fr.filed_on, a.filed_on,
                                       (coalesce(NEW.completed_at, now()) AT TIME ZONE 'Asia/Kolkata')::date)
                         ELSE NULL END,
         acknowledgement_no = CASE WHEN NEW.workflow_status = 'filed'
                                   THEN coalesce(fr.reference_no, a.acknowledgement_no)
                                   ELSE NULL END,
         acknowledgement_document_id = CASE WHEN NEW.workflow_status = 'filed'
                                            THEN coalesce(fr.ack_document_id, a.acknowledgement_document_id)
                                            ELSE NULL END,
         version = a.version + 1
   WHERE a.compliance_instance_id = NEW.id
     AND (OLD.workflow_status IN ('filed', 'not_applicable')
          OR NEW.workflow_status IN ('filed', 'not_applicable'));
  RETURN NULL;
END $$;

-- The client-merge and purge routines run as the migrator; the firm-wide
-- clause library holds no client rows, so it reads it as it is.
CREATE POLICY tax_audit_clause_library_owner_read ON hsdg.tax_audit_clause_library
  FOR SELECT TO hsdg_migrator USING (true);

-- Down Migration

DROP POLICY IF EXISTS tax_audit_clause_library_owner_read ON hsdg.tax_audit_clause_library;

CREATE OR REPLACE FUNCTION hsdg.tax_audit_follow_filing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE hsdg.tax_audits a
     SET stage = CASE
           WHEN NEW.workflow_status = 'filed' THEN 'filed'
           WHEN NEW.workflow_status = 'not_applicable' THEN 'not_applicable'
           WHEN a.client_accepted_on IS NOT NULL THEN 'client_accepted'
           WHEN a.uploaded_on IS NOT NULL THEN 'uploaded'
           WHEN a.signed_at IS NOT NULL THEN 'signed'
           ELSE 'not_started' END,
         filed_on = CASE WHEN NEW.workflow_status = 'filed'
                         THEN coalesce(a.filed_on, (coalesce(NEW.completed_at, now()) AT TIME ZONE 'Asia/Kolkata')::date)
                         ELSE NULL END,
         version = a.version + 1
   WHERE a.compliance_instance_id = NEW.id
     AND (OLD.workflow_status IN ('filed', 'not_applicable')
          OR NEW.workflow_status IN ('filed', 'not_applicable'));
  RETURN NULL;
END $$;

ALTER TABLE hsdg.tax_audits NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.tax_audits WHERE revision > 0;
ALTER TABLE hsdg.tax_audits FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.tax_audits
  DROP CONSTRAINT tax_audits_accepted_report,
  DROP CONSTRAINT tax_audits_uploaded_report,
  DROP CONSTRAINT tax_audits_signed_report,
  DROP CONSTRAINT tax_audits_revision_reason,
  DROP COLUMN revision_reason,
  DROP COLUMN revised_from_id,
  DROP COLUMN acknowledgement_document_id,
  DROP COLUMN client_rejection_reason,
  DROP COLUMN signed_report_document_id,
  DROP COLUMN signed_by_employee_id;

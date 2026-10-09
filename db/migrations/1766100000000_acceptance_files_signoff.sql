-- ─────────────────────────────────────────────────────────────────────────
-- Statutory Audit — Section 01 documents, templates and partner sign-off
-- (Section 01 spec §2, §5.1, §6.2, §10, §12)
--
-- • firm_settings — the firm's own details (name, FRN, address) that templates
--   merge in. One row.
-- • document_templates / document_template_versions — the approved DHVAJ Word
--   templates "Create from Template" merges engagement data into. A template
--   key can carry VARIANTS (applies_when conditions); every uploaded file is an
--   append-only VERSION, at most one approved at a time. The bytes live behind
--   the document StorageProvider, never in the database.
-- • audit_acceptance_files — the file cards: a slot (consent certificate,
--   previous-auditor communication, engagement letter, evidence …) pointing at
--   an engagement document (never a copy), the template version it was created
--   from (kept for history), and the slot's working status.
-- • audit_acceptance_recommendations — FINAL-01, the Manager's recommendation
--   submitted to the Engagement Partner (one live submission per file).
-- • audit_acceptance_approvals — widened into the Partner's decision log
--   (FINAL-02): continue / return added, reason + safeguards recorded, and a
--   controlled reopen (reason + who + when) that supersedes an approval without
--   ever editing or deleting it.
-- • documents.edit_locked — approved work cannot take new versions until it is
--   reopened; documents.m365_synced_ctag — the SharePoint cTag last pulled back,
--   so returning from Microsoft 365 syncs edits automatically.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Firm settings ────────────────────────────────────────────────────────
CREATE TABLE hsdg.firm_settings (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  firm_name              text NOT NULL CHECK (length(trim(firm_name)) > 0),
  frn                    text,
  address                text,
  email                  text,
  version                integer NOT NULL DEFAULT 1,
  updated_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO hsdg.firm_settings (id, firm_name) VALUES (true, 'DHVAJ & Associates');
CREATE TRIGGER firm_settings_set_updated_at
  BEFORE UPDATE ON hsdg.firm_settings
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();
ALTER TABLE hsdg.firm_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY firm_settings_read ON hsdg.firm_settings
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY firm_settings_update ON hsdg.firm_settings
  FOR UPDATE USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- ── Document templates ───────────────────────────────────────────────────
CREATE TABLE hsdg.document_templates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key           text NOT NULL CHECK (template_key IN (
                           'previous_auditor_communication','auditor_consent_certificate',
                           'engagement_letter','client_acknowledgement')),
  variant_key            text NOT NULL CHECK (variant_key ~ '^[a-z0-9_]{2,40}$'),
  title                  text NOT NULL CHECK (length(trim(title)) > 0),
  applies_when           jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active              boolean NOT NULL DEFAULT true,
  version                integer NOT NULL DEFAULT 1,
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_key, variant_key)
);
CREATE TRIGGER document_templates_set_updated_at
  BEFORE UPDATE ON hsdg.document_templates
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.document_template_versions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id             uuid NOT NULL REFERENCES hsdg.document_templates (id) ON DELETE RESTRICT,
  version_no              integer NOT NULL CHECK (version_no > 0),
  filename                text NOT NULL CHECK (length(trim(filename)) > 0),
  content_type            text NOT NULL,
  size_bytes              bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256         text NOT NULL,
  -- Opaque StorageProvider reference; never returned to clients.
  storage_reference       text NOT NULL,
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded')),
  notes                   text,
  fields_found            text[] NOT NULL DEFAULT '{}',
  unknown_fields          text[] NOT NULL DEFAULT '{}',
  uploaded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  uploaded_at             timestamptz NOT NULL DEFAULT now(),
  approved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  approved_at             timestamptz,
  UNIQUE (template_id, version_no)
);
-- At most one approved (current) version per template variant.
CREATE UNIQUE INDEX document_template_versions_one_approved
  ON hsdg.document_template_versions (template_id) WHERE status = 'approved';

-- Template versions are append-only: only the status step (draft → approved →
-- superseded) and its approver may change.
CREATE OR REPLACE FUNCTION hsdg.document_template_versions_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'approved_by_employee_id' - 'approved_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'approved_by_employee_id' - 'approved_at') THEN
    RAISE EXCEPTION 'A template version is append-only; upload a new version instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER document_template_versions_append_only
  BEFORE UPDATE ON hsdg.document_template_versions
  FOR EACH ROW EXECUTE FUNCTION hsdg.document_template_versions_guard();

ALTER TABLE hsdg.document_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_templates_read ON hsdg.document_templates
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY document_templates_write ON hsdg.document_templates
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
ALTER TABLE hsdg.document_template_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_template_versions_read ON hsdg.document_template_versions
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY document_template_versions_insert ON hsdg.document_template_versions
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY document_template_versions_update ON hsdg.document_template_versions
  FOR UPDATE USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- One standard variant per Section 01 format, with no file yet: the firm
-- uploads and approves its own Word templates.
INSERT INTO hsdg.document_templates (template_key, variant_key, title) VALUES
  ('previous_auditor_communication', 'standard', 'Communication to Previous Auditor'),
  ('auditor_consent_certificate',    'standard', 'Auditor Consent / Eligibility Certificate'),
  ('engagement_letter',              'standard', 'Statutory Audit Engagement Letter'),
  ('client_acknowledgement',         'standard', 'Client Acknowledgement / Acceptance');

-- ── Documents: approved-work lock + SharePoint sync marker ────────────────
ALTER TABLE hsdg.documents
  ADD COLUMN edit_locked        boolean NOT NULL DEFAULT false,
  ADD COLUMN edit_locked_reason text,
  ADD COLUMN m365_synced_ctag   text;

-- ── Section 01 file cards ─────────────────────────────────────────────────
CREATE TABLE hsdg.audit_acceptance_files (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  slot_key               text NOT NULL CHECK (slot_key ~ '^[a-z_]{2,40}(:[a-z0-9_]{2,60})?$'),
  document_id            uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  status                 text NOT NULL CHECK (status IN (
                           'linked','draft','final','ready_to_send','sent',
                           'partner_review','approved','issued','accepted')),
  meta                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The template version actually used (kept so history never changes).
  template_version_id    uuid REFERENCES hsdg.document_template_versions (id) ON DELETE RESTRICT,
  template_key           text,
  template_variant_key   text,
  template_version_no    integer,
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, slot_key, document_id)
);
-- Single-file slots hold one file.
CREATE UNIQUE INDEX audit_acceptance_files_single_slot
  ON hsdg.audit_acceptance_files (workflow_instance_id, slot_key)
  WHERE slot_key IN ('consent_certificate','previous_auditor_communication',
                     'engagement_letter','client_acknowledgement');
CREATE INDEX audit_acceptance_files_engagement_idx
  ON hsdg.audit_acceptance_files (engagement_id);
CREATE TRIGGER audit_acceptance_files_set_updated_at
  BEFORE UPDATE ON hsdg.audit_acceptance_files
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();
ALTER TABLE hsdg.audit_acceptance_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_acceptance_files_select ON hsdg.audit_acceptance_files
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_acceptance_files_insert ON hsdg.audit_acceptance_files
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_acceptance_files_update ON hsdg.audit_acceptance_files
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_acceptance_files_delete ON hsdg.audit_acceptance_files
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));
CREATE TRIGGER audit_acceptance_files_undo_capture
  AFTER INSERT OR UPDATE OR DELETE ON hsdg.audit_acceptance_files
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_undo_capture('id');

-- ── FINAL-01 Manager recommendation ───────────────────────────────────────
CREATE TABLE hsdg.audit_acceptance_recommendations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id    uuid NOT NULL
                            REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  cycle                   integer NOT NULL CHECK (cycle > 0),
  recommendation          text NOT NULL CHECK (recommendation IN (
                            'accept','continue','accept_with_safeguards',
                            'partner_review_required','decline')),
  comments                text,
  -- submitted → decided (partner concluded) | returned (sent back) | superseded (reopened)
  status                  text NOT NULL DEFAULT 'submitted' CHECK (status IN (
                            'submitted','decided','returned','superseded')),
  submitted_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  submitted_at            timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz,
  version                 integer NOT NULL DEFAULT 1,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, cycle),
  CONSTRAINT audit_acceptance_recommendations_comment_needed CHECK (
    recommendation IN ('accept','continue')
    OR (comments IS NOT NULL AND length(trim(comments)) > 0)
  )
);
CREATE UNIQUE INDEX audit_acceptance_recommendations_one_live
  ON hsdg.audit_acceptance_recommendations (workflow_instance_id) WHERE status = 'submitted';
CREATE TRIGGER audit_acceptance_recommendations_set_updated_at
  BEFORE UPDATE ON hsdg.audit_acceptance_recommendations
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();
ALTER TABLE hsdg.audit_acceptance_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_acceptance_recommendations_select ON hsdg.audit_acceptance_recommendations
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_acceptance_recommendations_insert ON hsdg.audit_acceptance_recommendations
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_acceptance_recommendations_update ON hsdg.audit_acceptance_recommendations
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE TRIGGER audit_acceptance_recommendations_undo_capture
  AFTER INSERT OR UPDATE OR DELETE ON hsdg.audit_acceptance_recommendations
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_undo_capture('id');

-- ── FINAL-02 Partner decision log + controlled reopen ─────────────────────
ALTER TABLE hsdg.audit_acceptance_approvals
  DROP CONSTRAINT IF EXISTS audit_acceptance_approvals_conclusion_check;
ALTER TABLE hsdg.audit_acceptance_approvals
  ADD CONSTRAINT audit_acceptance_approvals_conclusion_check CHECK (conclusion IN
    ('accept','continue','accept_with_conditions','return','decline'));
ALTER TABLE hsdg.audit_acceptance_approvals
  ADD COLUMN reason                  text,
  ADD COLUMN safeguards              text,
  ADD COLUMN recommendation_id       uuid REFERENCES hsdg.audit_acceptance_recommendations (id) ON DELETE SET NULL,
  ADD COLUMN reopened_at             timestamptz,
  ADD COLUMN reopened_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN reopen_reason           text;
-- Decisions recorded before reasons / safeguards were captured separately kept
-- them in the memo; carry that across so the new rules hold for history too.
UPDATE hsdg.audit_acceptance_approvals
   SET safeguards = COALESCE(NULLIF(trim(memo), ''), 'Recorded in the acceptance memo.')
 WHERE conclusion = 'accept_with_conditions';
UPDATE hsdg.audit_acceptance_approvals
   SET reason = COALESCE(NULLIF(trim(memo), ''), 'Recorded in the acceptance memo.')
 WHERE conclusion = 'decline';
ALTER TABLE hsdg.audit_acceptance_approvals
  ADD CONSTRAINT audit_acceptance_approvals_reason_needed CHECK (
    conclusion NOT IN ('return','decline')
    OR (reason IS NOT NULL AND length(trim(reason)) > 0)
  ),
  ADD CONSTRAINT audit_acceptance_approvals_safeguards_needed CHECK (
    conclusion <> 'accept_with_conditions'
    OR (safeguards IS NOT NULL AND length(trim(safeguards)) > 0)
  ),
  ADD CONSTRAINT audit_acceptance_approvals_reopen_reason_needed CHECK (
    reopened_at IS NULL OR (reopen_reason IS NOT NULL AND length(trim(reopen_reason)) > 0)
  );

-- A decision is never edited: the only change allowed is recording a reopen.
CREATE OR REPLACE FUNCTION hsdg.audit_acceptance_approvals_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reopened_at IS NOT NULL THEN
    RAISE EXCEPTION 'A reopened acceptance decision cannot change.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'reopened_at' - 'reopened_by_employee_id' - 'reopen_reason')
     IS DISTINCT FROM (to_jsonb(OLD) - 'reopened_at' - 'reopened_by_employee_id' - 'reopen_reason') THEN
    RAISE EXCEPTION 'An acceptance decision is locked; reopen Section 01 instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_acceptance_approvals_locked
  BEFORE UPDATE ON hsdg.audit_acceptance_approvals
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_acceptance_approvals_guard();
CREATE POLICY audit_acceptance_approvals_update ON hsdg.audit_acceptance_approvals
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS audit_acceptance_approvals_update ON hsdg.audit_acceptance_approvals;
DROP TRIGGER IF EXISTS audit_acceptance_approvals_locked ON hsdg.audit_acceptance_approvals;
DROP FUNCTION IF EXISTS hsdg.audit_acceptance_approvals_guard();
ALTER TABLE hsdg.audit_acceptance_approvals
  DROP CONSTRAINT IF EXISTS audit_acceptance_approvals_reopen_reason_needed,
  DROP CONSTRAINT IF EXISTS audit_acceptance_approvals_safeguards_needed,
  DROP CONSTRAINT IF EXISTS audit_acceptance_approvals_reason_needed,
  DROP COLUMN IF EXISTS reopen_reason,
  DROP COLUMN IF EXISTS reopened_by_employee_id,
  DROP COLUMN IF EXISTS reopened_at,
  DROP COLUMN IF EXISTS recommendation_id,
  DROP COLUMN IF EXISTS safeguards,
  DROP COLUMN IF EXISTS reason;
DELETE FROM hsdg.audit_acceptance_approvals WHERE conclusion IN ('continue','return');
ALTER TABLE hsdg.audit_acceptance_approvals
  DROP CONSTRAINT IF EXISTS audit_acceptance_approvals_conclusion_check;
ALTER TABLE hsdg.audit_acceptance_approvals
  ADD CONSTRAINT audit_acceptance_approvals_conclusion_check CHECK (conclusion IN
    ('accept','accept_with_conditions','decline'));
DROP TABLE IF EXISTS hsdg.audit_acceptance_recommendations;
DROP TABLE IF EXISTS hsdg.audit_acceptance_files;
ALTER TABLE hsdg.documents
  DROP COLUMN IF EXISTS m365_synced_ctag,
  DROP COLUMN IF EXISTS edit_locked_reason,
  DROP COLUMN IF EXISTS edit_locked;
DROP TABLE IF EXISTS hsdg.document_template_versions;
DROP FUNCTION IF EXISTS hsdg.document_template_versions_guard();
DROP TABLE IF EXISTS hsdg.document_templates;
DROP TABLE IF EXISTS hsdg.firm_settings;

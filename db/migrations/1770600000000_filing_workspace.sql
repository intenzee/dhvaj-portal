-- Up Migration
--
-- Change 5 / 6 — the filing workspace behind the GST, TDS, Income Tax and ROC
-- tabs. One checklist table, one figures table, one filing-record table and one
-- correction table serve every stream; every row hangs off a compliance_instance.
--
--   instance_checklist_items  "What's to be done" — created lazily from the
--                             FILING_* checklist templates (catalogue_templates)
--   instance_figures          the few numbers that make the log useful later
--   filing_records            Lodge: ARN / SRN / token / challan + acknowledgement
--   filing_corrections        "corrected in a later period" notes
--   documents                 + compliance_instance_id, period_section, slot_code
--
-- workflow_status is DERIVED in SQL (hsdg.derive_instance_workflow_status) and
-- kept current by triggers on tasks, client_dependencies, filing_records and the
-- client-approval item — whichever path changes the inputs (API, client upload
-- portal, scheduler), the filing's status follows. A member may update an
-- instance only to move workflow_status to its derived value (guard trigger);
-- everything else on compliance_instances stays lead-only.

-- ── 1. Documents link to the filing, section and slot ────────────────────
ALTER TABLE hsdg.documents
  ADD COLUMN compliance_instance_id uuid REFERENCES hsdg.compliance_instances (id) ON DELETE SET NULL,
  ADD COLUMN period_section         text CHECK (period_section IN ('outward','inward','summary','annual')),
  ADD COLUMN slot_code              text CHECK (slot_code ~ '^[A-Z0-9_]{2,40}$');
CREATE INDEX documents_compliance_instance_idx ON hsdg.documents (compliance_instance_id)
  WHERE compliance_instance_id IS NOT NULL;

-- A document uploaded against a slot request (staff or the client's secure
-- link) lands in that slot; GST records get their statutory retention
-- (s.36 CGST Act: 72 months from the GSTR-9 due date, 31 Dec after the FY).
CREATE OR REPLACE FUNCTION hsdg.documents_link_filing() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  dep record;
  fy  text;
  strm text;
BEGIN
  IF NEW.compliance_instance_id IS NULL AND NEW.client_dependency_id IS NOT NULL THEN
    SELECT d.compliance_instance_id, d.period_section, d.slot_code INTO dep
      FROM hsdg.client_dependencies d WHERE d.id = NEW.client_dependency_id;
    IF FOUND AND dep.compliance_instance_id IS NOT NULL THEN
      NEW.compliance_instance_id := dep.compliance_instance_id;
      NEW.period_section := COALESCE(NEW.period_section, dep.period_section);
      NEW.slot_code := COALESCE(NEW.slot_code, dep.slot_code);
    END IF;
  END IF;
  IF NEW.compliance_instance_id IS NOT NULL THEN
    SELECT ci.financial_year, COALESCE(rv.stream, sv.stream), COALESCE(NEW.period_section, ci.section)
      INTO fy, strm, NEW.period_section
      FROM hsdg.compliance_instances ci
      LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
      LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
      LEFT JOIN hsdg.services sv ON sv.id = es.service_id
     WHERE ci.id = NEW.compliance_instance_id;
    IF NEW.retention_until IS NULL AND strm = 'gst' AND fy ~ '^\d{4}-\d{2}$' THEN
      NEW.retention_until := make_date(substr(fy, 1, 4)::int + 7, 12, 31);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_link_filing BEFORE INSERT ON hsdg.documents
  FOR EACH ROW EXECUTE FUNCTION hsdg.documents_link_filing();

-- Members upload into a filing's slots (the assignee doing the work is rarely a
-- lead). Plain engagement documents stay lead-only.
DROP POLICY documents_insert ON hsdg.documents;
CREATE POLICY documents_insert ON hsdg.documents
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (compliance_instance_id IS NOT NULL AND hsdg.is_engagement_member(engagement_id))
  );
DROP POLICY documents_update ON hsdg.documents;
CREATE POLICY documents_update ON hsdg.documents
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (compliance_instance_id IS NOT NULL AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id())
  ) WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (compliance_instance_id IS NOT NULL AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id())
  );
DROP POLICY document_versions_insert ON hsdg.document_versions;
CREATE POLICY document_versions_insert ON hsdg.document_versions
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR EXISTS (SELECT 1 FROM hsdg.documents d
                WHERE d.id = document_id AND d.compliance_instance_id IS NOT NULL
                  AND hsdg.is_engagement_member(d.engagement_id))
  );

-- ── 2. Checklist ("What's to be done") ───────────────────────────────────
CREATE TABLE hsdg.instance_checklist_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_instance_id uuid NOT NULL REFERENCES hsdg.compliance_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  item_code              text NOT NULL CHECK (item_code ~ '^[A-Z0-9_]{2,40}$'),
  label                  text NOT NULL CHECK (length(trim(label)) > 0),
  slot_code              text CHECK (slot_code ~ '^[A-Z0-9_]{2,40}$'),
  required               boolean NOT NULL DEFAULT false,
  sequence               integer NOT NULL DEFAULT 0,
  -- How the item ticks itself: a document in its slot, its figures entered, the
  -- task approved, or the filing lodged. NULL = ticked by hand.
  auto_tick              text CHECK (auto_tick IN ('document','figure','review','lodge')),
  note                   text,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','not_applicable')),
  done_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  done_at                timestamptz,
  na_reason              text,
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  client_dependency_id   uuid REFERENCES hsdg.client_dependencies (id) ON DELETE SET NULL,
  template_code          text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instance_checklist_items_unique UNIQUE (compliance_instance_id, item_code),
  CONSTRAINT instance_checklist_items_done_shape CHECK (status <> 'done' OR done_at IS NOT NULL),
  CONSTRAINT instance_checklist_items_na_reason CHECK (
    status <> 'not_applicable' OR length(trim(coalesce(na_reason, ''))) > 0)
);
CREATE INDEX instance_checklist_items_engagement_idx ON hsdg.instance_checklist_items (engagement_id);
CREATE TRIGGER instance_checklist_items_set_updated_at BEFORE UPDATE ON hsdg.instance_checklist_items
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.instance_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.instance_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY instance_checklist_items_select ON hsdg.instance_checklist_items
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY instance_checklist_items_insert ON hsdg.instance_checklist_items
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));
-- Members tick; Not applicable on a REQUIRED item is a lead's call (API + here).
CREATE POLICY instance_checklist_items_update ON hsdg.instance_checklist_items
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND (status <> 'not_applicable' OR NOT required OR hsdg.is_engagement_lead(engagement_id))
  );
REVOKE DELETE ON hsdg.instance_checklist_items FROM hsdg_app;

-- A document landing in a slot ticks the open document-driven item for it.
CREATE OR REPLACE FUNCTION hsdg.documents_tick_slot() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.compliance_instance_id IS NOT NULL AND NEW.slot_code IS NOT NULL THEN
    UPDATE hsdg.instance_checklist_items
       SET status = 'done', done_at = now(), done_by_employee_id = NEW.created_by_employee_id,
           document_id = NEW.id, version = version + 1
     WHERE compliance_instance_id = NEW.compliance_instance_id
       AND slot_code = NEW.slot_code AND auto_tick = 'document' AND status = 'open';
    -- Keep the newest document on the item even when it was already ticked.
    UPDATE hsdg.instance_checklist_items
       SET document_id = NEW.id
     WHERE compliance_instance_id = NEW.compliance_instance_id
       AND slot_code = NEW.slot_code AND status = 'done' AND document_id IS DISTINCT FROM NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER documents_tick_slot AFTER INSERT ON hsdg.documents
  FOR EACH ROW EXECUTE FUNCTION hsdg.documents_tick_slot();

-- ── 3. Figures ───────────────────────────────────────────────────────────
CREATE TABLE hsdg.instance_figures (
  compliance_instance_id uuid PRIMARY KEY REFERENCES hsdg.compliance_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  figures                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(figures) = 'object'),
  updated_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX instance_figures_engagement_idx ON hsdg.instance_figures (engagement_id);
CREATE TRIGGER instance_figures_set_updated_at BEFORE UPDATE ON hsdg.instance_figures
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();
ALTER TABLE hsdg.instance_figures ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.instance_figures FORCE ROW LEVEL SECURITY;
CREATE POLICY instance_figures_select ON hsdg.instance_figures
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY instance_figures_insert ON hsdg.instance_figures
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY instance_figures_update ON hsdg.instance_figures
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
REVOKE DELETE ON hsdg.instance_figures FROM hsdg_app;

-- ── 4. Filing records (Lodge) ────────────────────────────────────────────
CREATE TABLE hsdg.filing_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_instance_id uuid NOT NULL REFERENCES hsdg.compliance_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Denormalised from the instance for the uniqueness rules below.
  registration_id        uuid REFERENCES hsdg.entity_registrations (id) ON DELETE SET NULL,
  compliance_rule_id     uuid NOT NULL REFERENCES hsdg.compliance_rules (id) ON DELETE RESTRICT,
  period_key             text,
  reference_kind         text NOT NULL CHECK (reference_kind IN ('arn','srn','token','ack','challan','internal')),
  reference_no           text NOT NULL CHECK (reference_no ~ '^[A-Z0-9/-]{3,40}$'),
  filed_on               date NOT NULL,
  filed_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  is_nil                 boolean NOT NULL DEFAULT false,
  figures                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(figures) = 'object'),
  late_fee_paid          numeric(14,2) CHECK (late_fee_paid >= 0),
  interest_paid          numeric(14,2) CHECK (interest_paid >= 0),
  ack_document_id        uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE RESTRICT,
  remarks                text,
  recorded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  undone_at              timestamptz,
  undone_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  undo_reason            text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filing_records_undo_shape CHECK (
    undone_at IS NULL OR (undone_by_employee_id IS NOT NULL
                          AND length(trim(coalesce(undo_reason, ''))) > 0))
);
-- One live record per filing.
CREATE UNIQUE INDEX filing_records_one_live ON hsdg.filing_records (compliance_instance_id)
  WHERE undone_at IS NULL;
-- An ARN identifies exactly one return: unique per GSTIN + return + period, and
-- never reused on the same registration for another period.
CREATE UNIQUE INDEX filing_records_reference_unique
  ON hsdg.filing_records (registration_id, compliance_rule_id, period_key, reference_no)
  NULLS NOT DISTINCT WHERE undone_at IS NULL;
CREATE UNIQUE INDEX filing_records_arn_once
  ON hsdg.filing_records (registration_id, reference_no)
  WHERE undone_at IS NULL AND reference_kind = 'arn' AND registration_id IS NOT NULL;
CREATE INDEX filing_records_engagement_idx ON hsdg.filing_records (engagement_id, created_at DESC);

ALTER TABLE hsdg.filing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.filing_records FORCE ROW LEVEL SECURITY;
CREATE POLICY filing_records_select ON hsdg.filing_records
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY filing_records_insert ON hsdg.filing_records
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));
-- Undo is a lead's (after 24 h a partner's — enforced by the API).
CREATE POLICY filing_records_update ON hsdg.filing_records
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
REVOKE DELETE ON hsdg.filing_records FROM hsdg_app;

-- ── 5. Corrections (GST amendment in a later period, TDS correction, revised ITR)
CREATE TABLE hsdg.filing_corrections (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_instance_id   uuid NOT NULL REFERENCES hsdg.compliance_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  corrected_in_instance_id uuid REFERENCES hsdg.compliance_instances (id) ON DELETE SET NULL,
  note                     text NOT NULL CHECK (length(trim(note)) > 0),
  created_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filing_corrections_not_self CHECK (corrected_in_instance_id IS DISTINCT FROM compliance_instance_id)
);
CREATE INDEX filing_corrections_instance_idx ON hsdg.filing_corrections (compliance_instance_id);
CREATE INDEX filing_corrections_engagement_idx ON hsdg.filing_corrections (engagement_id, created_at DESC);
ALTER TABLE hsdg.filing_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.filing_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY filing_corrections_select ON hsdg.filing_corrections
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY filing_corrections_insert ON hsdg.filing_corrections
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));
REVOKE UPDATE, DELETE ON hsdg.filing_corrections FROM hsdg_app;

-- ── 6. Derived workflow status ───────────────────────────────────────────
-- Spec p.23: Filed ← a live filing record; Not applicable ← a lead, sticky;
-- Ready to file ← task approved (and, where the filing has one, the client's
-- approval recorded); In review ← task sent for review; Awaiting data ← an open
-- client request on the filing; In preparation ← task being worked; else Not
-- started. A filing completed by pre-workspace code (status completed, no
-- filing record ever) stays Filed.
CREATE OR REPLACE FUNCTION hsdg.derive_instance_workflow_status(p_id uuid) RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM hsdg.filing_records fr
                  WHERE fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL) THEN 'filed'
    WHEN ci.workflow_status = 'filed'
         AND NOT EXISTS (SELECT 1 FROM hsdg.filing_records fr WHERE fr.compliance_instance_id = ci.id)
      THEN 'filed'
    WHEN ci.workflow_status = 'not_applicable' THEN 'not_applicable'
    WHEN t.status = 'done' THEN
      CASE WHEN EXISTS (SELECT 1 FROM hsdg.instance_checklist_items it
                         WHERE it.compliance_instance_id = ci.id AND it.item_code = 'CLIENT_APPROVAL'
                           AND it.required AND it.status = 'open')
           THEN 'in_review' ELSE 'ready_to_file' END
    WHEN t.status = 'in_review' THEN 'in_review'
    WHEN EXISTS (SELECT 1 FROM hsdg.client_dependencies d
                  WHERE d.compliance_instance_id = ci.id
                    AND d.status IN ('pending','partially_received')) THEN 'awaiting_data'
    WHEN t.status IN ('in_progress','paused','blocked') THEN 'in_preparation'
    ELSE 'not_started'
  END
  FROM hsdg.compliance_instances ci
  LEFT JOIN LATERAL (
    SELECT tk.status FROM hsdg.tasks tk
     WHERE tk.source_compliance_instance_id = ci.id AND tk.status <> 'cancelled'
     ORDER BY tk.created_at DESC LIMIT 1
  ) t ON true
  WHERE ci.id = p_id
$$;

CREATE OR REPLACE FUNCTION hsdg.refresh_instance_workflow_status(p_id uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  derived text;
BEGIN
  IF p_id IS NULL THEN RETURN; END IF;
  derived := hsdg.derive_instance_workflow_status(p_id);
  IF derived IS NULL THEN RETURN; END IF;
  UPDATE hsdg.compliance_instances SET workflow_status = derived
   WHERE id = p_id AND workflow_status IS DISTINCT FROM derived;
END $$;

-- Members may move an instance's workflow_status to its derived value — and
-- nothing else. Leads (and the firm-wide operator) are unrestricted, as before.
CREATE POLICY compliance_instances_member_update ON hsdg.compliance_instances
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));

CREATE OR REPLACE FUNCTION hsdg.compliance_instances_member_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['workflow_status','status','completed_at','completed_by_employee_id',
                          'updated_at','version'];
BEGIN
  -- Only the application role is guarded: migrations (owner) and the owner-run
  -- SECURITY DEFINER paths keep their existing behaviour.
  IF current_user <> 'hsdg_app' OR hsdg.is_engagement_lead(OLD.engagement_id) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'Only an engagement lead may change this filing.' USING ERRCODE = '42501';
  END IF;
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status IS DISTINCT FROM hsdg.derive_instance_workflow_status(OLD.id) THEN
    RAISE EXCEPTION 'A filing''s status follows its work; only a lead may set it.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compliance_instances_member_guard BEFORE UPDATE ON hsdg.compliance_instances
  FOR EACH ROW EXECUTE FUNCTION hsdg.compliance_instances_member_guard();

-- The inputs' triggers.
CREATE OR REPLACE FUNCTION hsdg.tasks_refresh_filing() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM hsdg.refresh_instance_workflow_status(NEW.source_compliance_instance_id);
  IF TG_OP = 'UPDATE' AND OLD.source_compliance_instance_id IS DISTINCT FROM NEW.source_compliance_instance_id THEN
    PERFORM hsdg.refresh_instance_workflow_status(OLD.source_compliance_instance_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER tasks_refresh_filing
  AFTER INSERT OR UPDATE OF status, source_compliance_instance_id ON hsdg.tasks
  FOR EACH ROW EXECUTE FUNCTION hsdg.tasks_refresh_filing();

CREATE OR REPLACE FUNCTION hsdg.dependencies_refresh_filing() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM hsdg.refresh_instance_workflow_status(NEW.compliance_instance_id);
  IF TG_OP = 'UPDATE' AND OLD.compliance_instance_id IS DISTINCT FROM NEW.compliance_instance_id THEN
    PERFORM hsdg.refresh_instance_workflow_status(OLD.compliance_instance_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER client_dependencies_refresh_filing
  AFTER INSERT OR UPDATE OF status, compliance_instance_id ON hsdg.client_dependencies
  FOR EACH ROW EXECUTE FUNCTION hsdg.dependencies_refresh_filing();

CREATE OR REPLACE FUNCTION hsdg.filing_records_refresh_filing() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM hsdg.refresh_instance_workflow_status(NEW.compliance_instance_id);
  RETURN NULL;
END $$;
CREATE TRIGGER filing_records_refresh_filing
  AFTER INSERT OR UPDATE OF undone_at ON hsdg.filing_records
  FOR EACH ROW EXECUTE FUNCTION hsdg.filing_records_refresh_filing();

CREATE OR REPLACE FUNCTION hsdg.checklist_refresh_filing() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_code = 'CLIENT_APPROVAL' THEN
    PERFORM hsdg.refresh_instance_workflow_status(NEW.compliance_instance_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER instance_checklist_items_refresh_filing
  AFTER INSERT OR UPDATE OF status ON hsdg.instance_checklist_items
  FOR EACH ROW EXECUTE FUNCTION hsdg.checklist_refresh_filing();

-- ── 7. Checklist templates (catalogue_templates; partners edit without a
--       release). Resolution: FILING_<RULE_CODE> → FILING_<STREAM>_<SECTION> →
--       FILING_<STREAM> → FILING_GENERIC. Item keys: code, label, slotCode,
--       required, sequence, autoTick (document|figure|review|lodge), onlyIf (a
--       GSTIN/TAN/PAN profile attribute that must be true), note.
ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;

CREATE TEMP TABLE _filing_templates (code text, name text, body jsonb) ON COMMIT DROP;
INSERT INTO _filing_templates VALUES
('FILING_GST_OUTWARD', 'GST — Outward (GSTR-1 / IFF)', '{"items":[
  {"code":"SALES_REGISTER","label":"Sales register received","slotCode":"SALES_REGISTER","required":true,"sequence":1,"autoTick":"document","note":"Client data; internal date 5th of next month"},
  {"code":"IRN_REPORT","label":"E-invoice (IRN) report","slotCode":"IRN_REPORT","required":true,"sequence":2,"autoTick":"document","onlyIf":"eInvoicing"},
  {"code":"EWB_REPORT","label":"E-way bill report","slotCode":"EWB_REPORT","required":false,"sequence":3,"autoTick":"document"},
  {"code":"CNDN_REGISTER","label":"Credit and debit notes listed","slotCode":"CNDN_REGISTER","required":false,"sequence":4,"autoTick":"document"},
  {"code":"EXPORT_DOCS","label":"Exports and SEZ supplies","slotCode":"EXPORT_DOCS","required":true,"sequence":5,"autoTick":"document","onlyIf":"exporter","note":"Needs a current LUT for the FY"},
  {"code":"ADVANCES","label":"Advances received / adjusted","required":false,"sequence":6},
  {"code":"OUTWARD_RECON","label":"Reconcile sales register vs books vs IRN","slotCode":"OUTWARD_RECON","required":true,"sequence":7,"autoTick":"document","note":"Difference must be nil or explained"},
  {"code":"HSN_DOCS","label":"HSN summary and documents issued prepared (Tables 12 and 13)","required":true,"sequence":8},
  {"code":"REVIEW","label":"Review","required":true,"sequence":9,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge GSTR-1 / IFF","slotCode":"ACK_GSTR1","required":true,"sequence":10,"autoTick":"lodge"}
]}'),
('FILING_GST_INWARD', 'GST — Inward (purchases and ITC)', '{"items":[
  {"code":"PURCHASE_REGISTER","label":"Purchase register received","slotCode":"PURCHASE_REGISTER","required":true,"sequence":1,"autoTick":"document","note":"Client data; same internal date as sales"},
  {"code":"GSTR2B","label":"GSTR-2B downloaded","slotCode":"GSTR2B","required":true,"sequence":2,"autoTick":"document","note":"Available on the 14th of the next month"},
  {"code":"IMS_ACTIONS","label":"IMS actions taken","slotCode":"IMS_SUMMARY","required":true,"sequence":3,"autoTick":"document","note":"Accept / reject / keep pending before 3B"},
  {"code":"ITC_RECON","label":"ITC reconciliation, books vs 2B","slotCode":"ITC_RECON","required":true,"sequence":4,"autoTick":"document"},
  {"code":"REVERSALS","label":"Reversals identified (s.17(5), Rule 37, Rules 42/43)","required":true,"sequence":5},
  {"code":"RCM","label":"Reverse-charge purchases identified","slotCode":"RCM_LIST","required":false,"sequence":6,"autoTick":"document","note":"RCM liability is carried to Summary"},
  {"code":"IMPORTS","label":"Imports matched","slotCode":"BILLS_OF_ENTRY","required":true,"sequence":7,"autoTick":"document","onlyIf":"importer"},
  {"code":"VENDOR_FOLLOWUP","label":"Vendor follow-up","slotCode":"MISSING_IN_2B","required":false,"sequence":8,"autoTick":"document"},
  {"code":"REVIEW","label":"Review","required":true,"sequence":9,"autoTick":"review"},
  {"code":"LODGE","label":"Mark reconciled","slotCode":"ITC_RECON","required":true,"sequence":10,"autoTick":"lodge"}
]}'),
('FILING_GST_SUMMARY', 'GST — Summary (GSTR-3B and payment)', '{"items":[
  {"code":"LIABILITY","label":"Liability computed","slotCode":"WORKING_3B","required":true,"sequence":1,"autoTick":"document","note":"Pulls outward figures and RCM"},
  {"code":"ITC_CONFIRMED","label":"ITC to claim confirmed","required":true,"sequence":2,"note":"From Inward"},
  {"code":"INTEREST_FEE","label":"Interest / late fee computed","required":false,"sequence":3},
  {"code":"CLIENT_APPROVAL","label":"Client approval of tax payable","slotCode":"CLIENT_APPROVAL","required":true,"sequence":4,"autoTick":"document","note":"Firm policy: no 3B without a recorded approval"},
  {"code":"PAYMENT","label":"Payment made","slotCode":"PMT06_CHALLAN","required":true,"sequence":5,"autoTick":"document","note":"CPIN, CIN, bank, date, amount by head"},
  {"code":"REVIEW","label":"Review","required":true,"sequence":6,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge GSTR-3B","slotCode":"ACK_3B","required":true,"sequence":7,"autoTick":"lodge"}
]}'),
('FILING_GST_PMT06', 'GST — PMT-06 (QRMP monthly payment)', '{"items":[
  {"code":"PURCHASE_SALES","label":"Sales and purchase registers received","slotCode":"REGISTERS","required":false,"sequence":1,"autoTick":"document","note":"Fixed-sum (35%) method needs none"},
  {"code":"LIABILITY","label":"Tax payable worked out","slotCode":"WORKING_PMT06","required":true,"sequence":2,"autoTick":"document","note":"Fixed-sum or self-assessment method"},
  {"code":"CLIENT_APPROVAL","label":"Client approval of tax payable","slotCode":"CLIENT_APPROVAL","required":true,"sequence":3,"autoTick":"document"},
  {"code":"REVIEW","label":"Review","required":true,"sequence":4,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge PMT-06 (payment)","slotCode":"PMT06_CHALLAN","required":true,"sequence":5,"autoTick":"lodge","note":"CPIN, CIN, bank, date, amount by head"}
]}'),
('FILING_GST_CMP08', 'GST — CMP-08 (composition)', '{"items":[
  {"code":"SALES_REGISTER","label":"Sales register received","slotCode":"SALES_REGISTER","required":true,"sequence":1,"autoTick":"document"},
  {"code":"RCM","label":"Reverse-charge purchases identified","slotCode":"RCM_LIST","required":false,"sequence":2,"autoTick":"document"},
  {"code":"LIABILITY","label":"Tax payable computed","slotCode":"WORKING_CMP08","required":true,"sequence":3,"autoTick":"document"},
  {"code":"CLIENT_APPROVAL","label":"Client approval of tax payable","slotCode":"CLIENT_APPROVAL","required":true,"sequence":4,"autoTick":"document"},
  {"code":"REVIEW","label":"Review","required":true,"sequence":5,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge CMP-08","slotCode":"ACK_CMP08","required":true,"sequence":6,"autoTick":"lodge"}
]}'),
('FILING_GST_ANNUAL', 'GST — Annual returns', '{"items":[
  {"code":"DATA","label":"Year data compiled from books and returns","slotCode":"ANNUAL_WORKING","required":true,"sequence":1,"autoTick":"document"},
  {"code":"RECON","label":"Reconciled with GSTR-1 / 3B / 2B","slotCode":"ANNUAL_RECON","required":true,"sequence":2,"autoTick":"document"},
  {"code":"REVIEW","label":"Review","required":true,"sequence":3,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge","slotCode":"ACK_ANNUAL","required":true,"sequence":4,"autoTick":"lodge"}
]}'),
('FILING_TDS', 'TDS / TCS — return or payment', '{"items":[
  {"code":"DEDUCTEE_DATA","label":"Deductee / collectee data received","slotCode":"DEDUCTEE_DATA","required":true,"sequence":1,"autoTick":"document"},
  {"code":"CHALLANS","label":"Challans matched","slotCode":"CHALLANS","required":true,"sequence":2,"autoTick":"document"},
  {"code":"PREPARED","label":"Return prepared and validated (FVU)","slotCode":"FVU","required":true,"sequence":3,"autoTick":"document"},
  {"code":"REVIEW","label":"Review","required":true,"sequence":4,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge","slotCode":"ACK_TDS","required":true,"sequence":5,"autoTick":"lodge"}
]}'),
('FILING_INCOME_TAX', 'Income tax — return / filing', '{"items":[
  {"code":"DATA","label":"Client data and AIS / 26AS received","slotCode":"IT_DATA","required":true,"sequence":1,"autoTick":"document"},
  {"code":"COMPUTATION","label":"Computation prepared","slotCode":"COMPUTATION","required":true,"sequence":2,"autoTick":"document"},
  {"code":"CLIENT_APPROVAL","label":"Client approval of the computation","slotCode":"CLIENT_APPROVAL","required":false,"sequence":3,"autoTick":"document"},
  {"code":"REVIEW","label":"Review","required":true,"sequence":4,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge","slotCode":"ACK_IT","required":true,"sequence":5,"autoTick":"lodge"}
]}'),
('FILING_ROC', 'ROC — form filing', '{"items":[
  {"code":"DOCUMENTS","label":"Attachments and resolutions received","slotCode":"ROC_ATTACHMENTS","required":true,"sequence":1,"autoTick":"document"},
  {"code":"FORM_PREPARED","label":"Form prepared and pre-scrutiny passed","slotCode":"ROC_FORM","required":true,"sequence":2,"autoTick":"document"},
  {"code":"DSC","label":"Signed with DSC","required":true,"sequence":3},
  {"code":"REVIEW","label":"Review","required":true,"sequence":4,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge (SRN)","slotCode":"ACK_ROC","required":true,"sequence":5,"autoTick":"lodge"}
]}'),
('FILING_GENERIC', 'Filing — generic', '{"items":[
  {"code":"DATA","label":"Data received","slotCode":"DATA","required":false,"sequence":1,"autoTick":"document"},
  {"code":"PREPARED","label":"Prepared","slotCode":"WORKING","required":true,"sequence":2,"autoTick":"document"},
  {"code":"REVIEW","label":"Review","required":true,"sequence":3,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge","slotCode":"ACK","required":true,"sequence":4,"autoTick":"lodge"}
]}');

INSERT INTO hsdg.catalogue_templates (template_type, code, name, description)
SELECT 'checklist', code, name, 'Filing workspace checklist (Change 5).' FROM _filing_templates
ON CONFLICT (code) DO NOTHING;
INSERT INTO hsdg.catalogue_template_versions (catalogue_template_id, version, effective_from, body, notes)
SELECT ct.id, 1, DATE '2017-04-01', ft.body, 'Seeded by 1770600000000_filing_workspace'
  FROM _filing_templates ft JOIN hsdg.catalogue_templates ct ON ct.code = ft.code
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;

-- ── 8. The team sees the registrations it files for ─────────────────────
-- Registrations (and their compliance profile) are otherwise visible through
-- the client entity, which is office-scoped; a member from another office
-- working the filing still needs the GSTIN / TAN and its QRMP profile.
CREATE POLICY entity_registrations_filing_member_read ON hsdg.entity_registrations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM hsdg.compliance_instances ci
             WHERE ci.registration_id = entity_registrations.id
               AND hsdg.is_engagement_member(ci.engagement_id))
  );
CREATE POLICY registration_compliance_profiles_filing_member_read
  ON hsdg.registration_compliance_profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM hsdg.compliance_instances ci
             WHERE ci.registration_id = registration_compliance_profiles.registration_id
               AND hsdg.is_engagement_member(ci.engagement_id))
  );

-- Down Migration

DROP POLICY IF EXISTS registration_compliance_profiles_filing_member_read
  ON hsdg.registration_compliance_profiles;
DROP POLICY IF EXISTS entity_registrations_filing_member_read ON hsdg.entity_registrations;

ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.catalogue_template_versions v USING hsdg.catalogue_templates t
 WHERE v.catalogue_template_id = t.id
   AND t.code IN ('FILING_GST_OUTWARD','FILING_GST_INWARD','FILING_GST_SUMMARY','FILING_GST_ANNUAL',
                  'FILING_GST_PMT06','FILING_GST_CMP08',
                  'FILING_TDS','FILING_INCOME_TAX','FILING_ROC','FILING_GENERIC');
DELETE FROM hsdg.catalogue_templates
 WHERE code IN ('FILING_GST_OUTWARD','FILING_GST_INWARD','FILING_GST_SUMMARY','FILING_GST_ANNUAL',
                  'FILING_GST_PMT06','FILING_GST_CMP08',
                'FILING_TDS','FILING_INCOME_TAX','FILING_ROC','FILING_GENERIC');
ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS instance_checklist_items_refresh_filing ON hsdg.instance_checklist_items;
DROP TRIGGER IF EXISTS filing_records_refresh_filing ON hsdg.filing_records;
DROP TRIGGER IF EXISTS client_dependencies_refresh_filing ON hsdg.client_dependencies;
DROP TRIGGER IF EXISTS tasks_refresh_filing ON hsdg.tasks;
DROP TRIGGER IF EXISTS compliance_instances_member_guard ON hsdg.compliance_instances;
DROP POLICY IF EXISTS compliance_instances_member_update ON hsdg.compliance_instances;
DROP FUNCTION IF EXISTS hsdg.checklist_refresh_filing();
DROP FUNCTION IF EXISTS hsdg.filing_records_refresh_filing();
DROP FUNCTION IF EXISTS hsdg.dependencies_refresh_filing();
DROP FUNCTION IF EXISTS hsdg.tasks_refresh_filing();
DROP FUNCTION IF EXISTS hsdg.compliance_instances_member_guard();
DROP FUNCTION IF EXISTS hsdg.refresh_instance_workflow_status(uuid);
DROP FUNCTION IF EXISTS hsdg.derive_instance_workflow_status(uuid);

DROP TABLE IF EXISTS hsdg.filing_corrections;
DROP TABLE IF EXISTS hsdg.filing_records;
DROP TABLE IF EXISTS hsdg.instance_figures;
DROP TRIGGER IF EXISTS documents_tick_slot ON hsdg.documents;
DROP FUNCTION IF EXISTS hsdg.documents_tick_slot();
DROP TABLE IF EXISTS hsdg.instance_checklist_items;

DROP POLICY IF EXISTS document_versions_insert ON hsdg.document_versions;
CREATE POLICY document_versions_insert ON hsdg.document_versions
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP POLICY IF EXISTS documents_update ON hsdg.documents;
CREATE POLICY documents_update ON hsdg.documents
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP POLICY IF EXISTS documents_insert ON hsdg.documents;
CREATE POLICY documents_insert ON hsdg.documents
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

DROP TRIGGER IF EXISTS documents_link_filing ON hsdg.documents;
DROP FUNCTION IF EXISTS hsdg.documents_link_filing();
DROP INDEX IF EXISTS hsdg.documents_compliance_instance_idx;
ALTER TABLE hsdg.documents
  DROP COLUMN IF EXISTS slot_code,
  DROP COLUMN IF EXISTS period_section,
  DROP COLUMN IF EXISTS compliance_instance_id;

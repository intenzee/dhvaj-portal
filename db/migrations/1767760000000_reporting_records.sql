-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.7 Other Companies Act Reporting — the records behind the cards (DHVAJ
-- Section 02.7 spec §12, §14, §16; build split Track B).
--
--   • hsdg.audit_reporting_records — one per Statutory Audit workflow: when
--     the legacy 02.7 fraud facts were moved into a first Fraud Matter and
--     when the §164(2) workpaper was first filled from the contacts master
--     (each done once, never again on re-open).
--   • hsdg.audit_fraud_matter — §14: ONE central record per fraud. The route
--     (Central Government vs Audit Committee / Board), the statutory deadlines
--     (Rule 13: 2 / 45 / 15 days) and the regulatory status are DERIVED from
--     the dates held here and the Rules Library in force on the knowledge date
--     — never stored.
--   • hsdg.audit_director_check — §12: the §164(2) workpaper, one row per
--     director, filled from the entity's contacts master.
--   • hsdg.audit_reporting_evidence — per-card evidence: engagement documents
--     or Section 06 evidence linked to a 02.7 card (optionally to one Fraud
--     Matter or director). Reuse, never a second upload.
--
-- Engagement child data: members SELECT, only leads INSERT / UPDATE (the
-- Section 02 / 06 tables' access). Nothing is ever hard-deleted by the app.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE hsdg.audit_reporting_records (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id      uuid NOT NULL UNIQUE
                              REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id             uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  legacy_fraud_migrated_at  timestamptz,
  directors_filled_at       timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_reporting_records_engagement_idx ON hsdg.audit_reporting_records (engagement_id);
CREATE TRIGGER audit_reporting_records_set_updated_at
  BEFORE UPDATE ON hsdg.audit_reporting_records
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_fraud_matter (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id             uuid NOT NULL
                                     REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id                    uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                              integer NOT NULL CHECK (seq > 0),
  nature                           text NOT NULL CHECK (length(trim(nature)) > 0),
  description                      text,
  amount                           numeric(18,2) CHECK (amount IS NULL OR amount >= 0),
  amount_estimated                 boolean NOT NULL DEFAULT false,
  perpetrator                      text CHECK (perpetrator IN
                                     ('officers','employees','officers_and_employees',
                                      'other_parties','unknown')),
  parties_involved                 text,
  knowledge_date                   date,
  source                           text NOT NULL DEFAULT 'audit_procedure' CHECK (source IN
                                     ('audit_procedure','risk_assessment','component_or_branch_auditor',
                                      'management','whistleblower','internal_audit','regulator','other')),
  -- An originating record (e.g. a 02.6 fraud finding id) so a candidate is
  -- raised as a matter once.
  source_ref                       text,
  procedure_id                     uuid REFERENCES hsdg.audit_procedures (id) ON DELETE SET NULL,
  audit_procedures                 text,
  tcwg_communication               text,
  board_reported_on                date,
  reply_received_on                date,
  cg_forwarded_on                  date,
  adt4_reference                   text,
  regulatory_note                  text,
  partner_consulted_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  partner_consulted_at             timestamptz,
  partner_note                     text,
  conclusion                       text NOT NULL DEFAULT 'pending' CHECK (conclusion IN
                                     ('pending','reported_central_government',
                                      'reported_audit_committee_board','not_reportable')),
  conclusion_note                  text,
  from_legacy                      boolean NOT NULL DEFAULT false,
  created_by_employee_id           uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  withdrawn_at                     timestamptz,
  withdrawn_by_employee_id         uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                          integer NOT NULL DEFAULT 1,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, seq),
  CONSTRAINT audit_fraud_matter_board_after_knowledge
    CHECK (board_reported_on IS NULL OR knowledge_date IS NULL OR board_reported_on >= knowledge_date),
  CONSTRAINT audit_fraud_matter_reply_after_report
    CHECK (reply_received_on IS NULL OR (board_reported_on IS NOT NULL
                                         AND reply_received_on >= board_reported_on)),
  CONSTRAINT audit_fraud_matter_forward_after_report
    CHECK (cg_forwarded_on IS NULL OR (board_reported_on IS NOT NULL
                                       AND cg_forwarded_on >= board_reported_on)),
  CONSTRAINT audit_fraud_matter_conclusion_note
    CHECK (conclusion = 'pending' OR length(trim(coalesce(conclusion_note, ''))) > 0),
  CONSTRAINT audit_fraud_matter_cg_forwarded
    CHECK (conclusion <> 'reported_central_government' OR cg_forwarded_on IS NOT NULL),
  CONSTRAINT audit_fraud_matter_board_reported
    CHECK (conclusion <> 'reported_audit_committee_board' OR board_reported_on IS NOT NULL),
  CONSTRAINT audit_fraud_matter_partner_note
    CHECK (partner_consulted_at IS NULL OR length(trim(coalesce(partner_note, ''))) > 0)
);
CREATE INDEX audit_fraud_matter_workflow_idx ON hsdg.audit_fraud_matter (workflow_instance_id);
CREATE INDEX audit_fraud_matter_engagement_idx ON hsdg.audit_fraud_matter (engagement_id);
-- The legacy facts move once; a candidate is raised as a live matter once.
CREATE UNIQUE INDEX audit_fraud_matter_one_legacy
  ON hsdg.audit_fraud_matter (workflow_instance_id) WHERE from_legacy;
CREATE UNIQUE INDEX audit_fraud_matter_live_source
  ON hsdg.audit_fraud_matter (workflow_instance_id, source, source_ref)
  WHERE source_ref IS NOT NULL AND withdrawn_at IS NULL;
CREATE TRIGGER audit_fraud_matter_set_updated_at
  BEFORE UPDATE ON hsdg.audit_fraud_matter
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_director_check (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  contact_id               uuid REFERENCES hsdg.entity_contacts (id) ON DELETE SET NULL,
  name                     text NOT NULL CHECK (length(trim(name)) > 0),
  din                      text CHECK (din IS NULL OR din ~ '^[0-9]{8}$'),
  designation              text,
  appointed_on             date,
  ceased_on                date,
  directorship_info        text,
  representation_ref       text,
  mca_source               text,
  disqualified             text NOT NULL DEFAULT 'pending'
                             CHECK (disqualified IN ('yes','no','pending')),
  legal_analysis           text,
  auditor_conclusion       text,
  source                   text NOT NULL DEFAULT 'team' CHECK (source IN ('contacts','team')),
  created_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  withdrawn_at             timestamptz,
  withdrawn_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_director_check_dates
    CHECK (ceased_on IS NULL OR appointed_on IS NULL OR ceased_on >= appointed_on),
  -- §12: a Yes / No conclusion carries its legal analysis.
  CONSTRAINT audit_director_check_analysis
    CHECK (disqualified = 'pending' OR length(trim(coalesce(legal_analysis, ''))) > 0)
);
CREATE INDEX audit_director_check_workflow_idx ON hsdg.audit_director_check (workflow_instance_id);
CREATE INDEX audit_director_check_engagement_idx ON hsdg.audit_director_check (engagement_id);
CREATE UNIQUE INDEX audit_director_check_live_contact
  ON hsdg.audit_director_check (workflow_instance_id, contact_id)
  WHERE contact_id IS NOT NULL AND withdrawn_at IS NULL;
CREATE TRIGGER audit_director_check_set_updated_at
  BEFORE UPDATE ON hsdg.audit_director_check
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_reporting_evidence (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- A ReportingCardKey (contracts) — shape-checked, not enumerated, so a card
  -- added in the contracts needs no migration.
  card_key               text NOT NULL CHECK (card_key ~ '^[a-z0-9_]{2,60}$'),
  kind                   text NOT NULL DEFAULT 'evidence'
                           CHECK (kind IN ('evidence','management_representation','mca_record')),
  fraud_matter_id        uuid REFERENCES hsdg.audit_fraud_matter (id) ON DELETE CASCADE,
  director_id            uuid REFERENCES hsdg.audit_director_check (id) ON DELETE CASCADE,
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  audit_evidence_id      uuid REFERENCES hsdg.audit_evidence (id) ON DELETE CASCADE,
  note                   text,
  linked_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  linked_at              timestamptz NOT NULL DEFAULT now(),
  removed_at             timestamptz,
  removed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  CONSTRAINT audit_reporting_evidence_one_source
    CHECK ((document_id IS NULL) <> (audit_evidence_id IS NULL)),
  CONSTRAINT audit_reporting_evidence_one_subject
    CHECK (fraud_matter_id IS NULL OR director_id IS NULL)
);
CREATE INDEX audit_reporting_evidence_workflow_idx
  ON hsdg.audit_reporting_evidence (workflow_instance_id, card_key);
CREATE INDEX audit_reporting_evidence_engagement_idx ON hsdg.audit_reporting_evidence (engagement_id);
CREATE UNIQUE INDEX audit_reporting_evidence_live
  ON hsdg.audit_reporting_evidence
     (workflow_instance_id, card_key, kind,
      COALESCE(fraud_matter_id, director_id, '00000000-0000-0000-0000-000000000000'::uuid),
      COALESCE(document_id, audit_evidence_id))
  WHERE removed_at IS NULL;

-- ── Row Level Security (engagement child data) ─────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_reporting_records','audit_fraud_matter','audit_director_check',
                           'audit_reporting_evidence']
  LOOP
    EXECUTE format('REVOKE DELETE ON hsdg.%I FROM hsdg_app', t);
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.is_engagement_member(engagement_id))',
                   t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))',
                   t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) '
                   'WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
  END LOOP;
END $$;

-- Down Migration
DROP TABLE IF EXISTS hsdg.audit_reporting_evidence CASCADE;
DROP TABLE IF EXISTS hsdg.audit_director_check CASCADE;
DROP TABLE IF EXISTS hsdg.audit_fraud_matter CASCADE;
DROP TABLE IF EXISTS hsdg.audit_reporting_records CASCADE;

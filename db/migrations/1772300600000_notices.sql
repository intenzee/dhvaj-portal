-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-101 · the notice register.
--
-- A notice (GST ASMT-10, income-tax 143(2), TDS 200A, ROC s.206 …) is the
-- firm's sharpest deadline. It is worked under one Compliance or Assignment
-- engagement of the client, so every table here is scoped through that
-- engagement exactly as client_dependencies is: the team reads and writes it,
-- nobody else sees it (FORCE RLS on every table).
--
-- notice_types   — the library stream leads maintain (form, section, default
--                  reply days, whether the order is appealable and under which
--                  limitation rule). Seeded below as a starting list to confirm.
-- notices        — one row per notice received: dates, amount, owner, status,
--                  outcome. internal_due_on is the firm's own clock: the reply
--                  date less firm_settings.notice_buffer_days, moved back to a
--                  working day (or an explicit override).
-- notice_events  — what happened, in order: reply filed, adjournment, hearing
--                  (next_date = the hearing), submission, order, rectification,
--                  note. An event is never edited; a mistaken one is voided.
--
-- documents.notice_id files the notice PDF, the reply and the order under it
-- (document_type 'notice' | 'reply' | 'order'); the team may upload them.
-- appeal_instance_id / appeal_due_on are for PS-103 (the order sets the
-- appeal deadline). Permission notice.manage records and changes notices.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Firm setting: how many days before the department's date we aim to reply ──
ALTER TABLE hsdg.firm_settings
  ADD COLUMN notice_buffer_days smallint NOT NULL DEFAULT 3
    CHECK (notice_buffer_days BETWEEN 0 AND 30);

-- ── Library ───────────────────────────────────────────────────────────────
CREATE TABLE hsdg.notice_types (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  stream             text NOT NULL CHECK (stream IN ('gst', 'income_tax', 'tds', 'roc', 'other')),
  form               text,
  section            text,
  title              text NOT NULL CHECK (length(trim(title)) > 0),
  default_reply_days smallint CHECK (default_reply_days BETWEEN 1 AND 365),
  appealable         boolean NOT NULL DEFAULT false,
  appeal_rule_code   text,
  is_active          boolean NOT NULL DEFAULT true,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notice_types_appeal_rule CHECK (appeal_rule_code IS NULL OR appealable)
);
CREATE TRIGGER notice_types_set_updated_at BEFORE UPDATE ON hsdg.notice_types
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

REVOKE ALL ON hsdg.notice_types FROM PUBLIC;
REVOKE ALL ON hsdg.notice_types FROM hsdg_app;
GRANT SELECT, INSERT, UPDATE ON hsdg.notice_types TO hsdg_app;
ALTER TABLE hsdg.notice_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.notice_types FORCE  ROW LEVEL SECURITY;
CREATE POLICY notice_types_owner ON hsdg.notice_types
  TO hsdg_migrator USING (true) WITH CHECK (true);
-- Any staff member reads the library; partners and firm-wide roles maintain it
-- (the API also requires workflow.manage).
CREATE POLICY notice_types_read ON hsdg.notice_types
  FOR SELECT TO hsdg_app USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY notice_types_insert ON hsdg.notice_types
  FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.ctx_is_firmwide() OR hsdg.ctx_role() = 'partner');
CREATE POLICY notice_types_update ON hsdg.notice_types
  FOR UPDATE TO hsdg_app
  USING (hsdg.ctx_is_firmwide() OR hsdg.ctx_role() = 'partner')
  WITH CHECK (hsdg.ctx_is_firmwide() OR hsdg.ctx_role() = 'partner');

-- A starting list for the stream leads to confirm (reply days are typical, not law).
INSERT INTO hsdg.notice_types (code, stream, form, section, title, default_reply_days, appealable, appeal_rule_code) VALUES
  ('GST_ASMT10',     'gst',        'ASMT-10',  's.61',        'Scrutiny of returns',                          30,   false, NULL),
  ('GST_DRC01A',     'gst',        'DRC-01A',  's.73/74',     'Intimation before show cause',                  30,   false, NULL),
  ('GST_DRC01',      'gst',        'DRC-01',   's.73/74/74A', 'Show cause notice',                             30,   false, NULL),
  ('GST_GSTR3A',     'gst',        'GSTR-3A',  's.46',        'Notice to return defaulter',                    15,   false, NULL),
  ('GST_REG03',      'gst',        'REG-03',   'r.9',         'Clarification on registration application',     7,   false, NULL),
  ('GST_REG17',      'gst',        'REG-17',   's.29',        'Show cause for cancellation of registration',   7,   true,  'GST_APPEAL_LIMITATION'),
  ('GST_ADT01',      'gst',        'ADT-01',   's.65',        'Department audit — intimation',                15,   false, NULL),
  ('GST_ADT02',      'gst',        'ADT-02',   's.65',        'Department audit — findings',                  30,   false, NULL),
  ('GST_DRC07',      'gst',        'DRC-07',   's.73/74',     'Order and summary of demand',                 NULL,  true,  'GST_APPEAL_LIMITATION'),
  ('GST_CMP05',      'gst',        'CMP-05',   's.10',        'Show cause on composition eligibility',         15,   true,  'GST_APPEAL_LIMITATION'),
  ('IT_139_9',       'income_tax', NULL,       's.139(9)',    'Defective return',                              15,   false, NULL),
  ('IT_143_1A',      'income_tax', NULL,       's.143(1)(a)', 'Proposed adjustment',                           30,   false, NULL),
  ('IT_143_2',       'income_tax', NULL,       's.143(2)',    'Scrutiny assessment',                           15,   false, NULL),
  ('IT_142_1',       'income_tax', NULL,       's.142(1)',    'Inquiry before assessment',                     15,   false, NULL),
  ('IT_148A',        'income_tax', NULL,       's.148A',      'Show cause before reassessment',                 7,   false, NULL),
  ('IT_148',         'income_tax', NULL,       's.148',       'Reassessment notice',                           30,   false, NULL),
  ('IT_133_6',       'income_tax', NULL,       's.133(6)',    'Call for information',                           7,   false, NULL),
  ('IT_245',         'income_tax', NULL,       's.245',       'Refund set off against demand',                 30,   false, NULL),
  ('IT_156',         'income_tax', NULL,       's.156',       'Notice of demand',                              30,   true,  'IT_APPEAL_LIMITATION'),
  ('IT_270A_274',    'income_tax', NULL,       's.270A/274',  'Penalty proceedings',                           15,   true,  'IT_APPEAL_LIMITATION'),
  ('TDS_200A',       'tds',        NULL,       's.200A',      'TRACES default intimation',                     30,   false, NULL),
  ('TDS_201',        'tds',        NULL,       's.201',       'Order treating deductor in default',          NULL,  true,  'IT_APPEAL_LIMITATION'),
  ('TDS_154',        'tds',        NULL,       's.154',       'Rectification',                                 30,   false, NULL),
  ('ROC_206',        'roc',        NULL,       's.206',       'Inspection or enquiry',                         15,   false, NULL),
  ('ROC_454',        'roc',        NULL,       's.454',       'Adjudication of penalty',                       15,   true,  NULL),
  ('ROC_STK1',       'roc',        'STK-1',    's.248',       'Notice for removal of name',                    30,   false, NULL),
  ('OTHER',          'other',      NULL,       NULL,          'Other notice',                                NULL,  false, NULL);

-- ── Notices ───────────────────────────────────────────────────────────────
CREATE TABLE hsdg.notices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id              uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  registration_id        uuid REFERENCES hsdg.entity_registrations (id) ON DELETE SET NULL,
  notice_type_id         uuid NOT NULL REFERENCES hsdg.notice_types (id),
  reference_no           text NOT NULL CHECK (length(trim(reference_no)) BETWEEN 1 AND 80),
  issued_on              date NOT NULL,
  received_on            date NOT NULL,
  served_via             text NOT NULL DEFAULT 'portal'
                           CHECK (served_via IN ('portal', 'email', 'post', 'in_person')),
  financial_year         text CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  assessment_year        text CHECK (assessment_year ~ '^\d{4}-\d{2}$'),
  period_from            date,
  period_to              date,
  amount_demanded        numeric(16, 2) CHECK (amount_demanded >= 0),
  reply_due_on           date,
  -- The firm's clock: reply_due_on less the buffer, on a working day; or the override.
  internal_due_override  date,
  internal_due_on        date,
  next_hearing_on        date,
  owner_employee_id      uuid NOT NULL REFERENCES hsdg.employees (id),
  reviewer_employee_id   uuid REFERENCES hsdg.employees (id),
  status                 text NOT NULL DEFAULT 'received'
                           CHECK (status IN ('received', 'in_progress', 'reply_filed', 'hearing_scheduled',
                                             'order_received', 'appealed', 'closed', 'withdrawn')),
  outcome                text CHECK (outcome IN ('dropped', 'demand_confirmed', 'demand_reduced', 'rectified')),
  outcome_amount         numeric(16, 2) CHECK (outcome_amount >= 0),
  closed_on              date,
  summary                text,
  -- PS-103: the limitation filing an appealable order created, and its date.
  appeal_instance_id     uuid REFERENCES hsdg.compliance_instances (id) ON DELETE SET NULL,
  appeal_due_on          date,
  version                integer NOT NULL DEFAULT 1,
  created_by_employee_id uuid REFERENCES hsdg.employees (id),
  updated_by_employee_id uuid REFERENCES hsdg.employees (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notices_received_after_issue CHECK (received_on >= issued_on),
  CONSTRAINT notices_period CHECK (period_to IS NULL OR period_from IS NULL OR period_to >= period_from),
  CONSTRAINT notices_closed CHECK (
    status <> 'closed' OR (outcome IS NOT NULL AND closed_on IS NOT NULL)),
  CONSTRAINT notices_outcome_when_closed CHECK (
    outcome IS NULL OR status IN ('closed', 'appealed', 'order_received'))
);
CREATE UNIQUE INDEX notices_reference_unique
  ON hsdg.notices (entity_id, notice_type_id, upper(trim(reference_no)));
CREATE INDEX notices_engagement_idx ON hsdg.notices (engagement_id);
CREATE INDEX notices_owner_open_idx ON hsdg.notices (owner_employee_id, internal_due_on)
  WHERE status NOT IN ('closed', 'withdrawn');
CREATE INDEX notices_reviewer_open_idx ON hsdg.notices (reviewer_employee_id, internal_due_on)
  WHERE status NOT IN ('closed', 'withdrawn') AND reviewer_employee_id IS NOT NULL;
CREATE INDEX notices_open_due_idx ON hsdg.notices (internal_due_on)
  WHERE status NOT IN ('closed', 'withdrawn');
CREATE INDEX notices_reference_search_idx ON hsdg.notices (upper(reference_no) text_pattern_ops);
CREATE TRIGGER notices_set_updated_at BEFORE UPDATE ON hsdg.notices
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- internal_due_on = the override, else the reply date less the firm's buffer,
-- moved back to a working day. Kept by trigger so every writer agrees.
CREATE FUNCTION hsdg.notice_internal_due() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'hsdg', 'pg_temp'
AS $$
DECLARE
  v_buffer smallint;
BEGIN
  IF NEW.internal_due_override IS NOT NULL THEN
    NEW.internal_due_on := NEW.internal_due_override;
  ELSIF NEW.reply_due_on IS NULL THEN
    NEW.internal_due_on := NULL;
  ELSE
    SELECT f.notice_buffer_days INTO v_buffer FROM hsdg.firm_settings f LIMIT 1;
    NEW.internal_due_on := hsdg.previous_working_day(NEW.reply_due_on - COALESCE(v_buffer, 3));
    -- Never before the day it arrived.
    IF NEW.internal_due_on < NEW.received_on THEN
      NEW.internal_due_on := LEAST(NEW.received_on, NEW.reply_due_on);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notices_internal_due
  BEFORE INSERT OR UPDATE OF reply_due_on, internal_due_override, received_on ON hsdg.notices
  FOR EACH ROW EXECUTE FUNCTION hsdg.notice_internal_due();

REVOKE ALL ON hsdg.notices FROM PUBLIC;
REVOKE ALL ON hsdg.notices FROM hsdg_app;
GRANT SELECT, INSERT, UPDATE ON hsdg.notices TO hsdg_app;
ALTER TABLE hsdg.notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.notices FORCE  ROW LEVEL SECURITY;
CREATE POLICY notices_owner ON hsdg.notices
  TO hsdg_migrator USING (true) WITH CHECK (true);
CREATE POLICY notices_select ON hsdg.notices
  FOR SELECT TO hsdg_app USING (hsdg.is_engagement_member(engagement_id));
-- The engagement must be the client's.
CREATE POLICY notices_insert ON hsdg.notices
  FOR INSERT TO hsdg_app WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND EXISTS (SELECT 1 FROM hsdg.engagements g
                 WHERE g.id = engagement_id AND g.entity_id = notices.entity_id)
  );
CREATE POLICY notices_update ON hsdg.notices
  FOR UPDATE TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND EXISTS (SELECT 1 FROM hsdg.engagements g
                 WHERE g.id = engagement_id AND g.entity_id = notices.entity_id)
  );

-- ── Events ────────────────────────────────────────────────────────────────
CREATE TABLE hsdg.notice_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id              uuid NOT NULL REFERENCES hsdg.notices (id) ON DELETE CASCADE,
  -- Denormalised for the policy, as on client_dependencies.
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  kind                   text NOT NULL CHECK (kind IN ('reply_filed', 'adjournment_sought', 'adjournment_granted',
                                                       'hearing', 'submission', 'order', 'rectification', 'note')),
  occurred_on            date NOT NULL,
  next_date              date,
  ack_reference          text,
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  body                   text,
  -- PS-103: an order's compliance event (the appeal limitation clock).
  compliance_event_id    uuid REFERENCES hsdg.compliance_events (id) ON DELETE SET NULL,
  created_by_employee_id uuid REFERENCES hsdg.employees (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  voided_at              timestamptz,
  voided_by_employee_id  uuid REFERENCES hsdg.employees (id),
  void_reason            text,
  CONSTRAINT notice_events_hearing_date CHECK (kind <> 'hearing' OR next_date IS NOT NULL),
  CONSTRAINT notice_events_voided CHECK (
    (voided_at IS NULL AND voided_by_employee_id IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND length(trim(void_reason)) > 0))
);
CREATE INDEX notice_events_notice_idx ON hsdg.notice_events (notice_id, occurred_on, created_at);
CREATE INDEX notice_events_engagement_idx ON hsdg.notice_events (engagement_id);

REVOKE ALL ON hsdg.notice_events FROM PUBLIC;
REVOKE ALL ON hsdg.notice_events FROM hsdg_app;
GRANT SELECT, INSERT ON hsdg.notice_events TO hsdg_app;
-- Events are never edited — only voided, or linked to their compliance event.
GRANT UPDATE (voided_at, voided_by_employee_id, void_reason, compliance_event_id, document_id)
  ON hsdg.notice_events TO hsdg_app;
ALTER TABLE hsdg.notice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.notice_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY notice_events_owner ON hsdg.notice_events
  TO hsdg_migrator USING (true) WITH CHECK (true);
CREATE POLICY notice_events_select ON hsdg.notice_events
  FOR SELECT TO hsdg_app USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY notice_events_insert ON hsdg.notice_events
  FOR INSERT TO hsdg_app WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND EXISTS (SELECT 1 FROM hsdg.notices n
                 WHERE n.id = notice_id AND n.engagement_id = notice_events.engagement_id)
  );
CREATE POLICY notice_events_update ON hsdg.notice_events
  FOR UPDATE TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));

-- ── Documents filed under a notice ───────────────────────────────────────
ALTER TABLE hsdg.documents
  ADD COLUMN notice_id uuid REFERENCES hsdg.notices (id) ON DELETE SET NULL;
CREATE INDEX documents_notice_idx ON hsdg.documents (notice_id) WHERE notice_id IS NOT NULL;
ALTER TABLE hsdg.documents DROP CONSTRAINT documents_document_type_check;
ALTER TABLE hsdg.documents ADD CONSTRAINT documents_document_type_check CHECK (document_type IN (
  'engagement_letter', 'working_paper', 'evidence', 'financial_statement', 'report',
  'correspondence', 'filing', 'acknowledgement', 'certificate', 'other',
  'notice', 'reply', 'order'));
-- The team files a notice's papers, as it does a filing's (lead-only otherwise).
DROP POLICY documents_insert ON hsdg.documents;
CREATE POLICY documents_insert ON hsdg.documents FOR INSERT WITH CHECK (
  hsdg.is_engagement_lead(engagement_id)
  OR ((compliance_instance_id IS NOT NULL OR notice_id IS NOT NULL)
      AND hsdg.is_engagement_member(engagement_id)));
DROP POLICY documents_update ON hsdg.documents;
CREATE POLICY documents_update ON hsdg.documents FOR UPDATE
  USING (
    hsdg.is_engagement_lead(engagement_id)
    OR ((compliance_instance_id IS NOT NULL OR notice_id IS NOT NULL)
        AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id()))
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR ((compliance_instance_id IS NOT NULL OR notice_id IS NOT NULL)
        AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id()));

-- ── Permission ────────────────────────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.permissions (slug, description) VALUES
  ('notice.manage', 'Record notices, their replies, hearings and orders, and close them')
  ON CONFLICT (slug) DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'notice.manage'
 WHERE r.slug IN ('managing_partner', 'partner', 'manager', 'senior')
ON CONFLICT DO NOTHING;
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'notice.manage');
DELETE FROM hsdg.permissions WHERE slug = 'notice.manage';
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

DROP POLICY documents_update ON hsdg.documents;
CREATE POLICY documents_update ON hsdg.documents FOR UPDATE
  USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (compliance_instance_id IS NOT NULL AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id()))
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (compliance_instance_id IS NOT NULL AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id()));
DROP POLICY documents_insert ON hsdg.documents;
CREATE POLICY documents_insert ON hsdg.documents FOR INSERT WITH CHECK (
  hsdg.is_engagement_lead(engagement_id)
  OR (compliance_instance_id IS NOT NULL AND hsdg.is_engagement_member(engagement_id)));
ALTER TABLE hsdg.documents NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.documents SET document_type = 'correspondence'
 WHERE document_type IN ('notice', 'reply', 'order');
ALTER TABLE hsdg.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.documents DROP CONSTRAINT documents_document_type_check;
ALTER TABLE hsdg.documents ADD CONSTRAINT documents_document_type_check CHECK (document_type IN (
  'engagement_letter', 'working_paper', 'evidence', 'financial_statement', 'report',
  'correspondence', 'filing', 'acknowledgement', 'certificate', 'other'));
DROP INDEX IF EXISTS hsdg.documents_notice_idx;
ALTER TABLE hsdg.documents DROP COLUMN IF EXISTS notice_id;

DROP TABLE IF EXISTS hsdg.notice_events;
DROP TABLE IF EXISTS hsdg.notices;
DROP FUNCTION IF EXISTS hsdg.notice_internal_due();
DROP TABLE IF EXISTS hsdg.notice_types;
ALTER TABLE hsdg.firm_settings DROP COLUMN IF EXISTS notice_buffer_days;

-- Up Migration

-- 02.1 Entity & Regulatory Profile — the full workspace (DHVAJ 02.1 web
-- developer specification §2–§20). Builds on 1763400000000 (the profile + the
-- reusable financial block):
--
--   • Card confirmations (A/B/C/E/F/H/I) — each stores WHO confirmed WHEN and a
--     fingerprint of the facts confirmed, so a later master correction shows
--     the card as "changed since confirmed" instead of silently passing.
--   • Card A listing confirmation (Yes / No / Information Pending) and the
--     listing-in-process question; Card B regulator / NBFC detail; Card F
--     approved-different-FY answer; Card H accounting software, electronic
--     records and the service-organisation question; Card I joint auditors.
--   • Card E professional action: Confirm Assessment / Override (mandatory
--     reason). The system result and the professional conclusion are stored
--     separately — the override never rewrites the system assessment.
--   • Controlled reopen of a confirmed profile (reason recorded).
--   • Supporting files per field (Add File / Link Existing File), linked to
--     engagement documents — never copied.
--   • Authority Library: summary + source URL + kind (provision / standard /
--     guidance) for the in-portal viewer, and a central reference map so UI
--     components never hard-code which provision a field cites.

ALTER TABLE hsdg.audit_entity_profile
  ADD COLUMN card_confirmations       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN listing_answer           text CHECK (listing_answer IS NULL OR listing_answer IN ('yes','no','pending')),
  ADD COLUMN listing_in_process       text CHECK (listing_in_process IS NULL OR listing_in_process IN ('yes','no','pending')),
  ADD COLUMN nbfc_category            text CHECK (nbfc_category IS NULL OR length(nbfc_category) <= 200),
  ADD COLUMN regulator                text CHECK (regulator IS NULL OR regulator IN ('rbi','sebi','irdai','other')),
  ADD COLUMN regulator_name           text CHECK (regulator_name IS NULL OR length(regulator_name) <= 200),
  ADD COLUMN regulator_details        text CHECK (regulator_details IS NULL OR length(regulator_details) <= 2000),
  ADD COLUMN small_company_system_outcome text CHECK (small_company_system_outcome IS NULL OR small_company_system_outcome IN
                                        ('small','not_small','not_applicable','pending')),
  ADD COLUMN small_company_override   text CHECK (small_company_override IS NULL OR small_company_override IN ('small','not_small')),
  ADD COLUMN small_company_override_reason text,
  ADD COLUMN small_company_override_system_outcome text,
  ADD COLUMN small_company_override_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN small_company_override_at timestamptz,
  ADD COLUMN different_fy_approved    text CHECK (different_fy_approved IS NULL OR different_fy_approved IN ('yes','no')),
  ADD COLUMN accounting_software      text CHECK (accounting_software IS NULL OR accounting_software IN
                                        ('tally','sap','oracle','dynamics','zoho','other')),
  ADD COLUMN accounting_software_other text CHECK (accounting_software_other IS NULL OR length(accounting_software_other) <= 200),
  ADD COLUMN records_electronic       text CHECK (records_electronic IS NULL OR records_electronic IN ('yes','no')),
  ADD COLUMN records_description      text CHECK (records_description IS NULL OR length(records_description) <= 2000),
  ADD COLUMN service_org              text CHECK (service_org IS NULL OR service_org IN ('yes','no','to_be_assessed')),
  ADD COLUMN service_org_service      text CHECK (service_org_service IS NULL OR length(service_org_service) <= 500),
  ADD COLUMN service_org_provider     text CHECK (service_org_provider IS NULL OR length(service_org_provider) <= 200),
  ADD COLUMN joint_auditors           jsonb NOT NULL DEFAULT '[]'::jsonb
                                        CHECK (jsonb_typeof(joint_auditors) = 'array'),
  ADD COLUMN confirmation_note        text,
  ADD COLUMN confirmation_statement   text,
  ADD COLUMN reopened_reason          text,
  ADD COLUMN reopened_at              timestamptz,
  ADD COLUMN reopened_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN updated_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD CONSTRAINT audit_entity_profile_override_reason CHECK (
    small_company_override IS NULL
    OR (small_company_override_reason IS NOT NULL AND length(trim(small_company_override_reason)) > 0)
  );

-- Existing confirmed profiles: their frozen outcome WAS the system outcome.
UPDATE hsdg.audit_entity_profile
   SET small_company_system_outcome = small_company_outcome
 WHERE small_company_outcome IS NOT NULL;

-- The reusable financial block: who prepared a figure (the signed-in person,
-- not free text) and the master value it was keyed over — a later master
-- change then shows as conflicting source data, never as a silent overwrite.
ALTER TABLE hsdg.audit_profile_financials
  ADD COLUMN prepared_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN master_current_at_capture numeric(18,2),
  ADD COLUMN master_prior_at_capture   numeric(18,2);

-- Supporting files per 02.1 field (spec §7, §9, §11, §12, §15). A slot names
-- the field: `financial:<parameter>`, `different_fy`, `service_org`,
-- `joint_audit`, `source`. Removal is soft so the audit trail keeps the link.
CREATE TABLE hsdg.audit_profile_files (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id             uuid NOT NULL REFERENCES hsdg.audit_entity_profile (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  slot                   text NOT NULL CHECK (slot ~ '^[a-z0-9_]+(:[a-z0-9_]+)?$'),
  document_id            uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  linked_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  linked_at              timestamptz NOT NULL DEFAULT now(),
  removed_at             timestamptz,
  removed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL
);
CREATE INDEX audit_profile_files_profile_idx ON hsdg.audit_profile_files (profile_id);
CREATE UNIQUE INDEX audit_profile_files_live_unique
  ON hsdg.audit_profile_files (profile_id, slot, document_id) WHERE removed_at IS NULL;

ALTER TABLE hsdg.audit_profile_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_profile_files_select ON hsdg.audit_profile_files
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_profile_files_insert ON hsdg.audit_profile_files
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_profile_files_update ON hsdg.audit_profile_files
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── Authority Library: what the in-portal viewer shows (spec §3, §19) ──────────
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.authority_provision
  ADD COLUMN reference_kind text NOT NULL DEFAULT 'provision'
    CHECK (reference_kind IN ('provision','standard','guidance')),
  ADD COLUMN summary    text,
  ADD COLUMN source_url text CHECK (source_url IS NULL OR source_url ~ '^https://');

-- ICAI Standards on Auditing are "View Standard"; ICAI guidance notes would be
-- "View Guidance" (none cited by 02.1 yet).
UPDATE hsdg.authority_provision
   SET reference_kind = 'standard'
 WHERE authority = 'ICAI' AND provision_number ~ '^SA ';

UPDATE hsdg.authority_provision p
   SET summary = v.summary
  FROM (VALUES
    ('COS_ACT_2_85',
     'A company, other than a public company, whose paid-up share capital and turnover (as per its '
     || 'profit and loss account for the immediately preceding financial year) do not exceed the limits '
     || 'prescribed under the Companies (Specification of Definitions Details) Rules. The definition does '
     || 'not apply to a holding company or a subsidiary company, a company registered under section 8, or '
     || 'a company or body corporate governed by any special Act. The prescribed limits applied by DHVAJ '
     || 'are held, effective-dated, in the Audit Rules Library.'),
    ('COS_ACT_2_41',
     'The financial year of a company or body corporate is the period ending on 31 March every year; '
     || 'for a company incorporated on or after 1 January, the period ending on 31 March of the following '
     || 'year. On application, the Tribunal may allow a different financial year to a company or body '
     || 'corporate that is a holding company, subsidiary or associate of a company incorporated outside '
     || 'India and is required to follow a different financial year for consolidation of its accounts '
     || 'outside India.'),
    ('SA_510',
     'Deals with the auditor''s responsibilities relating to opening balances in an initial audit '
     || 'engagement: obtaining sufficient appropriate audit evidence that the opening balances do not '
     || 'contain misstatements that materially affect the current period''s financial statements, and '
     || 'that the accounting policies reflected in them have been consistently applied (or changes '
     || 'properly accounted for and disclosed).'),
    ('SA_402',
     'Deals with the user auditor''s responsibility to obtain sufficient appropriate audit evidence '
     || 'when the entity uses one or more service organisations whose services are part of its '
     || 'information system relevant to financial reporting — understanding those services and the '
     || 'related controls, and using Type 1 / Type 2 reports where available.'),
    ('SA_299',
     'Deals with the special considerations in an audit of financial statements by joint auditors: '
     || 'division of work, coordination between the joint auditors, the responsibilities that remain '
     || 'joint and several, and reporting by the joint auditors.')
  ) AS v(code, summary)
 WHERE p.code = v.code AND p.summary IS NULL;

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- Which provision each workflow field cites (spec §19 "References should
-- resolve through a centrally maintained Authority/Provision Library"). The UI
-- asks for a context's references; the code → effective version resolution
-- happens against the engagement period, so a historical file keeps its basis.
CREATE TABLE hsdg.authority_reference_link (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_key    text NOT NULL CHECK (context_key ~ '^[0-9]{2}(\.[0-9]{1,2})?$'),
  anchor         text NOT NULL CHECK (anchor ~ '^[a-z_]+$'),
  label          text NOT NULL CHECK (length(trim(label)) > 0),
  provision_code text NOT NULL CHECK (provision_code ~ '^[A-Z0-9_]{2,60}$'),
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (context_key, anchor)
);
CREATE TRIGGER authority_reference_link_set_updated_at
  BEFORE UPDATE ON hsdg.authority_reference_link
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('02.1', 'small_company',        'View Section 2(85) - Small Company', 'COS_ACT_2_85', 10),
  ('02.1', 'financial_year',       'View Section 2(41) - Financial Year', 'COS_ACT_2_41', 20),
  ('02.1', 'initial_audit',        'View SA 510',                         'SA_510',       30),
  ('02.1', 'service_organisation', 'View SA 402',                         'SA_402',       40),
  ('02.1', 'joint_audit',          'View SA 299',                         'SA_299',       50);

REVOKE DELETE ON hsdg.authority_reference_link FROM hsdg_app;
ALTER TABLE hsdg.authority_reference_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY authority_reference_link_read ON hsdg.authority_reference_link
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY authority_reference_link_write ON hsdg.authority_reference_link
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS hsdg.authority_reference_link CASCADE;

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS summary,
  DROP COLUMN IF EXISTS reference_kind;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS hsdg.audit_profile_files CASCADE;

ALTER TABLE hsdg.audit_profile_financials
  DROP COLUMN IF EXISTS master_prior_at_capture,
  DROP COLUMN IF EXISTS master_current_at_capture,
  DROP COLUMN IF EXISTS prepared_by_employee_id;

ALTER TABLE hsdg.audit_entity_profile
  DROP CONSTRAINT IF EXISTS audit_entity_profile_override_reason,
  DROP COLUMN IF EXISTS updated_by_employee_id,
  DROP COLUMN IF EXISTS reopened_by_employee_id,
  DROP COLUMN IF EXISTS reopened_at,
  DROP COLUMN IF EXISTS reopened_reason,
  DROP COLUMN IF EXISTS confirmation_statement,
  DROP COLUMN IF EXISTS confirmation_note,
  DROP COLUMN IF EXISTS joint_auditors,
  DROP COLUMN IF EXISTS service_org_provider,
  DROP COLUMN IF EXISTS service_org_service,
  DROP COLUMN IF EXISTS service_org,
  DROP COLUMN IF EXISTS records_description,
  DROP COLUMN IF EXISTS records_electronic,
  DROP COLUMN IF EXISTS accounting_software_other,
  DROP COLUMN IF EXISTS accounting_software,
  DROP COLUMN IF EXISTS different_fy_approved,
  DROP COLUMN IF EXISTS small_company_override_at,
  DROP COLUMN IF EXISTS small_company_override_by_employee_id,
  DROP COLUMN IF EXISTS small_company_override_system_outcome,
  DROP COLUMN IF EXISTS small_company_override_reason,
  DROP COLUMN IF EXISTS small_company_override,
  DROP COLUMN IF EXISTS small_company_system_outcome,
  DROP COLUMN IF EXISTS regulator_details,
  DROP COLUMN IF EXISTS regulator_name,
  DROP COLUMN IF EXISTS regulator,
  DROP COLUMN IF EXISTS nbfc_category,
  DROP COLUMN IF EXISTS listing_in_process,
  DROP COLUMN IF EXISTS listing_answer,
  DROP COLUMN IF EXISTS card_confirmations;

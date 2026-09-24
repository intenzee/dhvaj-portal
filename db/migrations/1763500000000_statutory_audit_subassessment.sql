-- ─────────────────────────────────────────────────────────────────────────
-- 0055 · Statutory Audit — per-sub-section assessment + 02.2 rules  (Guide §6, §9.2)
--
-- Introduces the ONE shared assessment table for Section 02.2–02.7 (guide §6:
-- "prefer one table with a discriminator over eight near-identical tables"). Each
-- row carries a sub-section's engine output (system outcome + basis + cited rule
-- version & provision + structured detail) and the professional conclusion
-- (with the override-needs-basis rule), keyed (workflow, sub_section, area).
-- 02.2 (Financial Reporting Framework) is its first consumer; 02.3–02.7 reuse it.
--
-- Plus a SEED adding the 02.2 roadmap thresholds to the Audit Rules Library
-- (guide §4 — no statutory number in code): the Ind AS Rule-4 net-worth ceiling
-- as effective-dated VERSIONS (₹500cr Phase I → ₹250cr Phase II, and the NBFC
-- Rule 4(2A) phases), and the SMC turnover/borrowings ceilings. Kept under a
-- dedicated `financial_reporting_framework` area so the legacy advisory
-- `ind_as_as` suggestion (framework-suggestions.ts) is untouched.
--
-- SECURITY — engagement child data: members SELECT, only leads INSERT/UPDATE.
-- ENABLE (not FORCE) RLS so migrator-owned SECURITY DEFINER helpers bypass.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration
-- The methodology seed below writes firm-wide library tables that are FORCE
-- RLS; lift FORCE for the migrator (no request context) and restore it after,
-- as catalogue_templates (1760200000000) does.
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;


CREATE TABLE hsdg.audit_framework_subassessment (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  sub_section_key          text NOT NULL CHECK (sub_section_key ~ '^[0-9]{2}\.[0-9]{1,2}$'),
  area_key                 text NOT NULL CHECK (area_key ~ '^[a-z0-9_]{2,60}$'),
  title                    text NOT NULL CHECK (length(trim(title)) > 0),
  -- §19 applicability state model (shared with audit_framework_assessments).
  state                    text NOT NULL DEFAULT 'not_assessed' CHECK (state IN
                             ('not_assessed','pending_information','system_suggested_applicable',
                              'system_suggested_not_applicable','professional_judgement_required',
                              'applicable','not_applicable','overridden','reassessment_required','approved')),
  -- Engine output — outcome strings are sub-section-specific (validated in code).
  system_outcome           text,
  system_basis             text,
  system_detail            jsonb,
  rule_version_id          uuid REFERENCES hsdg.audit_rule_version (id) ON DELETE SET NULL,
  authority_provision_id   uuid REFERENCES hsdg.authority_provision (id) ON DELETE SET NULL,
  -- Professional conclusion.
  conclusion               text,
  is_overridden            boolean NOT NULL DEFAULT false,
  basis                    text,
  impact                   text,
  -- Sub-section-specific captured facts not held by 02.1/masters.
  facts                    jsonb,
  needs_reevaluation       boolean NOT NULL DEFAULT false,
  decided_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at               timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, sub_section_key, area_key),
  -- An overridden conclusion must carry a basis (§19).
  CONSTRAINT subassessment_override_needs_basis CHECK (
    is_overridden = false OR (basis IS NOT NULL AND length(trim(basis)) > 0)
  )
);
CREATE INDEX audit_framework_subassessment_instance_idx
  ON hsdg.audit_framework_subassessment (workflow_instance_id);
CREATE INDEX audit_framework_subassessment_engagement_idx
  ON hsdg.audit_framework_subassessment (engagement_id);
CREATE TRIGGER audit_framework_subassessment_set_updated_at
  BEFORE UPDATE ON hsdg.audit_framework_subassessment
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (mirrors audit_framework_assessments) ───────────────
ALTER TABLE hsdg.audit_framework_subassessment ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_framework_subassessment_select ON hsdg.audit_framework_subassessment
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_framework_subassessment_insert ON hsdg.audit_framework_subassessment
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_framework_subassessment_update ON hsdg.audit_framework_subassessment
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── Seed: 02.2 roadmap thresholds into the Audit Rules Library (§4, §9.2) ────
-- Ind AS Rule-4 net worth is phased by PERIOD via effective-dated versions, so
-- the engine resolves ₹500cr in FY2016-17 and ₹250cr from FY2017-18 with no code
-- change (the "future change affects future only" acceptance test). NBFC uses the
-- Rule 4(2A) phases (₹500cr from FY2018-19, ₹250cr from FY2019-20). SMC ceilings
-- are the turnover/borrowings limits (₹250cr / ₹50cr). Amounts in rupees.
INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('FRF_INDAS_NETWORTH',      'financial_reporting_framework', NULL,   'net_worth',  '>=', 'inr', 'standalone_audited_fs'),
  ('FRF_INDAS_NETWORTH_NBFC', 'financial_reporting_framework', 'nbfc', 'net_worth',  '>=', 'inr', 'standalone_audited_fs'),
  ('FRF_SMC_TURNOVER',        'financial_reporting_framework', NULL,   'turnover',   '<=', 'inr', 'balance_sheet_date'),
  ('FRF_SMC_BORROWINGS',      'financial_reporting_framework', NULL,   'borrowings', '<=', 'inr', 'balance_sheet_date')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, authority_provision_id)
SELECT r.id, v.ver, v.eff::date, v.eff_to::date, v.threshold, v.outcome, p.id
FROM (VALUES
  -- Corporate Ind AS roadmap: Phase I ₹500cr (FY2016-17), Phase II ₹250cr (FY2017-18+).
  ('FRF_INDAS_NETWORTH',      1, '2016-04-01', '2017-03-31', 5000000000::numeric, 'ind_as',  'INDAS_RULE_4'),
  ('FRF_INDAS_NETWORTH',      2, '2017-04-01', NULL,         2500000000::numeric, 'ind_as',  'INDAS_RULE_4'),
  -- NBFC Rule 4(2A) roadmap: Phase I ₹500cr (FY2018-19), Phase II ₹250cr (FY2019-20+).
  ('FRF_INDAS_NETWORTH_NBFC', 1, '2018-04-01', '2019-03-31', 5000000000::numeric, 'ind_as',  'INDAS_RULE_4'),
  ('FRF_INDAS_NETWORTH_NBFC', 2, '2019-04-01', NULL,         2500000000::numeric, 'ind_as',  'INDAS_RULE_4'),
  -- SMC ceilings (a company above either is NON-SMC).
  ('FRF_SMC_TURNOVER',        1, '2014-04-01', NULL,         2500000000::numeric, 'smc',     NULL),
  ('FRF_SMC_BORROWINGS',      1, '2014-04-01', NULL,         500000000::numeric,  'smc',     NULL)
) AS v(rule_code, ver, eff, eff_to, threshold, outcome, prov_code)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = v.prov_code
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- Restore FORCE RLS on the library tables (see top of Up).
ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_framework_subassessment CASCADE;
DELETE FROM hsdg.audit_rule WHERE code IN
  ('FRF_INDAS_NETWORTH','FRF_INDAS_NETWORTH_NBFC','FRF_SMC_TURNOVER','FRF_SMC_BORROWINGS');

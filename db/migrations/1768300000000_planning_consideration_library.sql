-- ─────────────────────────────────────────────────────────────────────────
-- 03.1 Strategic Consideration Library (DHVAJ 03.1 §13.2–13.3, §21)
--
-- The strategic timing / resource considerations used to be a rule list in
-- code (planning-considerations-generation.ts). §21 makes the planning
-- methodology configuration, so — like the Planning Signal Library — they are
-- now versioned rows maintained by the Managing Partner / administrator:
--   • a rule fires on any active signal whose rule key, PI-01 change category
--     or attention is listed (any list may be empty; at least one is not);
--   • every edit appends a version effective from a period-end date; the one
--     in force on the audit period end is used, and a retired code fires
--     nothing;
--   • a generated consideration keeps the rule code + version it came from.
-- The seed reproduces the previous code list exactly (same keys, wording and
-- triggers), so existing audit files derive the same considerations.
--
-- SECURITY — insert-only for the app (no UPDATE/DELETE); readable by any
-- authenticated role, appendable only firm-wide. FORCE RLS is applied after
-- the seed so the migrator may insert.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.planning_consideration_rule (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code               text NOT NULL CHECK (rule_code ~ '^PCR-[0-9]{3}$'),
  version                 integer NOT NULL CHECK (version >= 1),
  consideration_key       text NOT NULL CHECK (consideration_key ~ '^[a-z0-9_]{2,60}$'),
  kind                    text NOT NULL CHECK (kind IN ('timing','resource')),
  label                   text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
  basis                   text NOT NULL CHECK (length(trim(basis)) BETWEEN 1 AND 2000),
  match_rule_keys         text[] NOT NULL DEFAULT '{}'
                            CHECK (array_position(match_rule_keys, NULL) IS NULL),
  match_change_categories text[] NOT NULL DEFAULT '{}'
                            CHECK (array_position(match_change_categories, NULL) IS NULL),
  match_attention         text[] NOT NULL DEFAULT '{}'
                            CHECK (match_attention <@ ARRAY['standard','enhanced','immediate_partner']::text[]),
  effective_from          date NOT NULL DEFAULT DATE '2000-01-01',
  effective_to            date,
  active                  boolean NOT NULL DEFAULT true,
  methodology_version     text NOT NULL DEFAULT 'DHVAJ-M1'
                            CHECK (length(trim(methodology_version)) BETWEEN 1 AND 60),
  change_note             text CHECK (change_note IS NULL OR length(change_note) <= 2000),
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_code, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (cardinality(match_rule_keys) + cardinality(match_change_categories)
         + cardinality(match_attention) > 0)
);
CREATE INDEX planning_consideration_rule_key_idx
  ON hsdg.planning_consideration_rule (consideration_key);

REVOKE UPDATE, DELETE ON hsdg.planning_consideration_rule FROM hsdg_app;
ALTER TABLE hsdg.planning_consideration_rule ENABLE ROW LEVEL SECURITY;
CREATE POLICY planning_consideration_rule_read ON hsdg.planning_consideration_rule
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY planning_consideration_rule_insert ON hsdg.planning_consideration_rule
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());

INSERT INTO hsdg.planning_consideration_rule
  (rule_code, version, consideration_key, kind, label, basis,
   match_rule_keys, match_change_categories, match_attention, change_note)
VALUES
  -- §13.2 Strategic timing
  ('PCR-001', 1, 'opening_balance_access', 'timing',
   'Early access to predecessor auditor / opening-balance evidence',
   'Initial audit — opening balances need evidence before year-end fieldwork.',
   '{initial_audit}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-002', 1, 'interim_control_testing', 'timing',
   'Interim control-testing window',
   'ICFR reporting applies — controls work is usually phased before year end.',
   '{icfr_applicable}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-003', 1, 'component_reporting_dependency', 'timing',
   'Component / joint-auditor reporting dependency',
   'Group, joint-audit or branch reporting depends on other auditors delivering on time.',
   '{cfs_required,joint_audit,other_auditor_components,branch_auditors}', '{}', '{}',
   'Moved from the hard-coded deriver.'),
  ('PCR-004', 1, 'transition_date_balances', 'timing',
   'Ind AS transition-date balances and comparatives — early',
   'First-time Ind AS adoption — the transition balance sheet is audited before year end.',
   '{first_time_ind_as}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-005', 1, 'regulatory_reporting_deadlines', 'timing',
   'Regulatory / listing reporting deadlines',
   'A listed or regulated entity has external filing deadlines that drive the audit timetable.',
   '{listed_entity,regulated_entity}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-006', 1, 'audit_trail_log_access', 'timing',
   'Audit-trail (edit log) access through the year',
   'Rule 11(g) reporting applies — log configuration and retention are checked across the year.',
   '{audit_trail_reporting}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-007', 1, 'service_org_report_timing', 'timing',
   'Service-organisation assurance report — availability and period coverage',
   'A service organisation handles a financially relevant process.',
   '{service_organisation}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-008', 1, 'going_concern_timing', 'timing',
   'Going-concern assessment relative to the reporting deadline',
   'A going-concern / liquidity change was reported for the current year.',
   '{}', '{going_concern}', '{}', 'Moved from the hard-coded deriver.'),
  -- §13.3 Strategic resources
  ('PCR-009', 1, 'it_expertise', 'resource',
   'IT audit expertise',
   'ICFR or audit-trail reporting, an ERP environment or change, or a service organisation points to IT involvement.',
   '{icfr_applicable,service_organisation,audit_trail_reporting,erp_environment}',
   '{erp_accounting_system}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-010', 1, 'specialist_involvement', 'resource',
   'Auditor’s expert / specialist involvement',
   'Section 01 identified specialist areas — scope and the individuals are set in 03.8.',
   '{specialist_required}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-011', 1, 'ind_as_transition_expertise', 'resource',
   'Ind AS transition expertise',
   'First-time Ind AS adoption (Ind AS 101).',
   '{first_time_ind_as}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-012', 1, 'industry_regulatory_expertise', 'resource',
   'Industry / regulatory expertise',
   'The entity is regulated or specialised (e.g. NBFC, insurer, bank).',
   '{regulated_entity,schedule_iii_specialised}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-013', 1, 'group_audit_experience', 'resource',
   'Group-audit / consolidation experience',
   'Consolidated financial statements are required.',
   '{cfs_required}', '{}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-014', 1, 'valuation_expertise', 'resource',
   'Valuation expertise',
   'An acquisition, disposal or new investee was reported for the current year.',
   '{}', '{acquisition_disposal,subsidiary_jv_associate}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-015', 1, 'tax_expertise', 'resource',
   'Tax expertise',
   'A restructuring was reported for the current year.',
   '{}', '{restructuring}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-016', 1, 'forensic_expertise', 'resource',
   'Forensic expertise',
   'Fraud or suspected fraud was reported for the current year.',
   '{}', '{fraud}', '{}', 'Moved from the hard-coded deriver.'),
  ('PCR-017', 1, 'enhanced_partner_involvement', 'resource',
   'Enhanced Partner / Manager involvement',
   'At least one signal carries Immediate Partner Attention.',
   '{}', '{}', '{immediate_partner}', 'Moved from the hard-coded deriver.');

-- A generated consideration remembers the library version it came from (§22).
ALTER TABLE hsdg.audit_planning_consideration
  ADD COLUMN rule_code    text CHECK (rule_code IS NULL OR rule_code ~ '^PCR-[0-9]{3}$'),
  ADD COLUMN rule_version integer CHECK (rule_version IS NULL OR rule_version >= 1);

-- Existing generated considerations came from the code list the seed reproduces
-- (v1). Backfill the trace without moving updated_at / version.
ALTER TABLE hsdg.audit_planning_consideration
  DISABLE TRIGGER audit_planning_consideration_set_updated_at;
UPDATE hsdg.audit_planning_consideration c
   SET rule_code = r.rule_code, rule_version = r.version
  FROM hsdg.planning_consideration_rule r
 WHERE c.is_auto AND c.consideration_key = r.consideration_key AND r.version = 1;
ALTER TABLE hsdg.audit_planning_consideration
  ENABLE TRIGGER audit_planning_consideration_set_updated_at;

-- After the backfill: the migrator itself has no RLS context.
ALTER TABLE hsdg.planning_consideration_rule FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.audit_planning_consideration
  DROP COLUMN IF EXISTS rule_version,
  DROP COLUMN IF EXISTS rule_code;
DROP TABLE IF EXISTS hsdg.planning_consideration_rule;

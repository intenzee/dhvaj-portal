-- ─────────────────────────────────────────────────────────────────────────
-- 0065 · Statutory Audit — 03.3 Materiality
--   (DHVAJ 03.3 spec; docs/section-03-planning-build-spec.md §5.3)
--
-- Materiality is professional judgment, not a percentage calculator. These
-- tables hold the auditor's judgments; the portal calculates, compares and
-- challenges. Candidate benchmark amounts are NOT stored as a second financial
-- master — they are read live from the 03.2 canonical dataset; only the amount
-- used at selection is snapshotted (traceability + source-change detection).
--
-- TABLES:
--   • audit_materiality_determination — one row per VERSION of the 03.3
--     determination (v1.0, v1.1, …). A completed version is immutable; a
--     revision (03.3.11) creates the next version as a draft and supersedes the
--     previous one only when it is completed. Holds MAT-01…MAT-08, the selected
--     benchmark / % / OM / PM / CTT (calculated AND selected + reasons), PY
--     materiality, methodology version used and revision details.
--   • audit_materiality_benchmark    — Manager assessment per candidate (03.3.2).
--   • audit_materiality_adjustment   — normalisation schedule lines (03.3.3).
--   • audit_materiality_specific     — MAT-06 specific materiality records.
--   • audit_materiality_qualitative  — 03.3.9 qualitative challenge responses.
--   • audit_materiality_revision_item — 03.3.11 affected-work flags on revision.
--
-- The flat hsdg.audit_materiality row (0042) stays as the PUBLISHED current-
-- version cache read by approval snapshots and downstream screens.
--
-- METHODOLOGY GUIDANCE lives in the Audit Rules Library (area 'materiality'),
-- versioned + effective-dated, never in code. The seeded ranges are PROVISIONAL
-- placeholders pending DHVAJ approval (spec §8) — replace by appending a new
-- rule version; engagements keep the version they used.
--
-- SECURITY — engagement child data, same pattern as 0062–0064: members SELECT,
-- leads (EP/manager) INSERT/UPDATE/DELETE. ENABLE (not FORCE) RLS.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_materiality_determination (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  version_no               integer NOT NULL CHECK (version_no >= 1),
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN
                             ('draft','complete','superseded')),
  methodology_version      text,
  -- 03.3.1 context
  principal_users          text[] NOT NULL DEFAULT '{}',
  principal_users_other    text,
  user_focus               text[] NOT NULL DEFAULT '{}',
  user_focus_other         text,
  -- Prior-year materiality (prior engagement where available; manual in v1)
  py_overall_materiality   numeric(20,2) CHECK (py_overall_materiality IS NULL OR py_overall_materiality > 0),
  py_performance_materiality numeric(20,2),
  py_clearly_trivial       numeric(20,2),
  py_benchmark             text,
  py_source                text,
  py_audit_differences     text,
  -- 03.3.3 normalisation
  normalisation_rationale  text,
  -- 03.3.5 overall materiality (MAT-03 / MAT-04)
  selected_benchmark       text CHECK (selected_benchmark IS NULL OR selected_benchmark IN
                             ('pbt','normalised_pbt','revenue','total_assets','net_assets',
                              'expenditure','other')),
  other_benchmark_label    text,
  other_benchmark_amount   numeric(20,2),
  other_benchmark_source   text,
  benchmark_rationale      text,
  benchmark_amount         numeric(20,2),   -- snapshot, dataset units
  unit_factor              numeric(20,2),   -- dataset units → rupees at snapshot
  selected_pct             numeric(9,4) CHECK (selected_pct IS NULL OR (selected_pct > 0 AND selected_pct <= 100)),
  calculated_om            numeric(22,4),   -- unrounded, rupees
  selected_om              numeric(20,2) CHECK (selected_om IS NULL OR selected_om > 0),
  om_adjustment_reason     text,
  om_override_reason       text,
  pct_factors_considered   text[] NOT NULL DEFAULT '{}',
  pct_factors_note         text,
  mat04                    text CHECK (mat04 IS NULL OR mat04 IN ('yes','no_adjust')),
  mat04_rationale          text,
  -- 03.3.6 performance materiality (MAT-05)
  aggregation_factors      text[] NOT NULL DEFAULT '{}',
  aggregation_other        text,
  pm_pct                   numeric(9,4) CHECK (pm_pct IS NULL OR (pm_pct > 0 AND pm_pct < 100)),
  calculated_pm            numeric(22,4),
  selected_pm              numeric(20,2) CHECK (selected_pm IS NULL OR selected_pm > 0),
  pm_adjustment_reason     text,
  pm_rationale             text,
  pm_override_reason       text,
  -- 03.3.7 specific materiality (MAT-06)
  mat06                    text CHECK (mat06 IS NULL OR mat06 IN ('no','yes','further_assessment')),
  mat06_note               text,
  -- 03.3.8 clearly trivial
  selected_ctt             numeric(20,2) CHECK (selected_ctt IS NULL OR selected_ctt > 0),
  ctt_rationale            text,
  ctt_override_reason      text,
  -- 03.3.10 sensitivity (MAT-07)
  mat07                    text CHECK (mat07 IS NULL OR mat07 IN ('yes','no_reassess')),
  mat07_note               text,
  -- 03.3.11 revision (version_no > 1)
  revision_trigger         text CHECK (revision_trigger IS NULL OR revision_trigger IN
                             ('actual_results','significant_transaction','changed_circumstances',
                              'audit_finding','corrected_financial_information','other')),
  revision_reason          text,
  revision_date            date,
  revision_owner_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- 03.3.12 conclusion (MAT-08)
  conclusion_summary       text,
  mat08                    text CHECK (mat08 IS NULL OR mat08 IN ('yes_complete','no_reassess')),
  completed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  completed_at             timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, version_no),
  CONSTRAINT audit_materiality_pm_below_om CHECK (
    selected_pm IS NULL OR selected_om IS NULL OR selected_pm < selected_om
  ),
  CONSTRAINT audit_materiality_ctt_below_om CHECK (
    selected_ctt IS NULL OR selected_om IS NULL OR selected_ctt < selected_om
  ),
  CONSTRAINT audit_materiality_revision_shape CHECK (
    version_no = 1 OR (revision_trigger IS NOT NULL AND revision_reason IS NOT NULL)
  )
);
-- At most one editable draft per audit file.
CREATE UNIQUE INDEX audit_materiality_determination_one_draft
  ON hsdg.audit_materiality_determination (workflow_instance_id) WHERE status = 'draft';
CREATE INDEX audit_materiality_determination_engagement_idx
  ON hsdg.audit_materiality_determination (engagement_id);
CREATE TRIGGER audit_materiality_determination_set_updated_at
  BEFORE UPDATE ON hsdg.audit_materiality_determination
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_materiality_benchmark (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  determination_id       uuid NOT NULL
                           REFERENCES hsdg.audit_materiality_determination (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  candidate_key          text NOT NULL CHECK (candidate_key IN
                           ('pbt','normalised_pbt','revenue','total_assets','net_assets',
                            'expenditure')),
  assessment             text NOT NULL CHECK (assessment IN
                           ('suitable','potentially_suitable','not_suitable','normalised_required')),
  rationale              text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (determination_id, candidate_key)
);
CREATE INDEX audit_materiality_benchmark_engagement_idx
  ON hsdg.audit_materiality_benchmark (engagement_id);
CREATE TRIGGER audit_materiality_benchmark_set_updated_at
  BEFORE UPDATE ON hsdg.audit_materiality_benchmark
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_materiality_adjustment (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  determination_id       uuid NOT NULL
                           REFERENCES hsdg.audit_materiality_determination (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  description            text NOT NULL CHECK (length(trim(description)) > 0),
  amount                 numeric(20,2) NOT NULL,   -- dataset units, signed
  reason                 text,
  recurring              boolean NOT NULL DEFAULT false,
  evidence               text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (determination_id, seq)
);
CREATE INDEX audit_materiality_adjustment_engagement_idx
  ON hsdg.audit_materiality_adjustment (engagement_id);
CREATE TRIGGER audit_materiality_adjustment_set_updated_at
  BEFORE UPDATE ON hsdg.audit_materiality_adjustment
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_materiality_specific (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  determination_id       uuid NOT NULL
                           REFERENCES hsdg.audit_materiality_determination (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  scope_type             text NOT NULL CHECK (scope_type IN
                           ('class_of_transactions','account_balance','disclosure')),
  scope                  text NOT NULL CHECK (length(trim(scope)) > 0),
  threshold_type         text NOT NULL CHECK (threshold_type IN ('monetary','qualitative')),
  amount                 numeric(20,2) CHECK (amount IS NULL OR amount > 0),
  specific_pm            numeric(20,2) CHECK (specific_pm IS NULL OR specific_pm > 0),
  reason                 text NOT NULL CHECK (length(trim(reason)) > 0),
  affected_areas         text[] NOT NULL DEFAULT '{}',
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (determination_id, seq),
  CONSTRAINT audit_materiality_specific_shape CHECK (
    (threshold_type = 'monetary' AND amount IS NOT NULL
       AND (specific_pm IS NULL OR specific_pm < amount))
    OR (threshold_type = 'qualitative' AND amount IS NULL AND specific_pm IS NULL)
  )
);
CREATE INDEX audit_materiality_specific_engagement_idx
  ON hsdg.audit_materiality_specific (engagement_id);
CREATE TRIGGER audit_materiality_specific_set_updated_at
  BEFORE UPDATE ON hsdg.audit_materiality_specific
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_materiality_qualitative (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  determination_id       uuid NOT NULL
                           REFERENCES hsdg.audit_materiality_determination (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  consideration_key      text NOT NULL CHECK (consideration_key ~ '^[a-z0-9_]{2,60}$'),
  response               text NOT NULL CHECK (response IN
                           ('no_special_implication','specific_materiality',
                            'qualitative_consideration','further_assessment')),
  note                   text,
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  focus_id               uuid REFERENCES hsdg.audit_area_of_focus (id) ON DELETE SET NULL,
  significant            boolean NOT NULL DEFAULT false,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (determination_id, consideration_key)
);
CREATE INDEX audit_materiality_qualitative_engagement_idx
  ON hsdg.audit_materiality_qualitative (engagement_id);
CREATE TRIGGER audit_materiality_qualitative_set_updated_at
  BEFORE UPDATE ON hsdg.audit_materiality_qualitative
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_materiality_revision_item (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  determination_id       uuid NOT NULL
                           REFERENCES hsdg.audit_materiality_determination (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  item_key               text NOT NULL CHECK (item_key ~ '^[a-z0-9_]{2,60}$'),
  label                  text NOT NULL,
  detail                 text,
  applicable             boolean NOT NULL DEFAULT true,
  owner_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution             text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (determination_id, item_key),
  CONSTRAINT audit_materiality_revision_item_resolved CHECK (
    status <> 'resolved' OR resolution IS NOT NULL
  )
);
CREATE INDEX audit_materiality_revision_item_engagement_idx
  ON hsdg.audit_materiality_revision_item (engagement_id);
CREATE TRIGGER audit_materiality_revision_item_set_updated_at
  BEFORE UPDATE ON hsdg.audit_materiality_revision_item
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_materiality_determination','audit_materiality_benchmark',
                           'audit_materiality_adjustment','audit_materiality_specific',
                           'audit_materiality_qualitative','audit_materiality_revision_item']
  LOOP
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.is_engagement_member(engagement_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR DELETE USING (hsdg.is_engagement_lead(engagement_id))', t || '_delete', t);
  END LOOP;
END $$;

-- ── Methodology library seed (Audit Rules Library, area 'materiality') ────
-- FORCE RLS on these firm-wide tables gates even the owning migrator, so lift
-- it for the seed and restore it afterwards.
ALTER TABLE hsdg.audit_rule            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision   NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, source_reference)
VALUES
  ('SA_300', 'ICAI', 'Planning an audit of financial statements',             'SA 300', '2008-04-01', 'ICAI Standard on Auditing 300'),
  ('SA_320', 'ICAI', 'Materiality in planning and performing an audit',       'SA 320', '2010-04-01', 'ICAI Standard on Auditing 320'),
  ('SA_450', 'ICAI', 'Evaluation of misstatements identified during the audit','SA 450', '2010-04-01', 'ICAI Standard on Auditing 450'),
  ('IG_MATERIALITY', 'ICAI', 'Implementation Guide to Materiality in Planning and Performing an Audit',
             'Implementation Guide (Materiality)', '2010-04-01', 'ICAI Implementation Guide to SA 320')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule (code, area_key, criterion, operator, unit, measurement_basis) VALUES
  ('MAT_OM_PCT_PBT',            'materiality', 'om_pct_pbt',            'between', 'percent', NULL),
  ('MAT_OM_PCT_NORMALISED_PBT', 'materiality', 'om_pct_normalised_pbt', 'between', 'percent', NULL),
  ('MAT_OM_PCT_REVENUE',        'materiality', 'om_pct_revenue',        'between', 'percent', NULL),
  ('MAT_OM_PCT_TOTAL_ASSETS',   'materiality', 'om_pct_total_assets',   'between', 'percent', NULL),
  ('MAT_OM_PCT_NET_ASSETS',     'materiality', 'om_pct_net_assets',     'between', 'percent', NULL),
  ('MAT_OM_PCT_EXPENDITURE',    'materiality', 'om_pct_expenditure',    'between', 'percent', NULL),
  ('MAT_PM_PCT_OM',             'materiality', 'pm_pct_om',             'between', 'percent', NULL),
  ('MAT_CTT_PCT_OM',            'materiality', 'ctt_pct_om',            'between', 'percent', NULL),
  ('MAT_PY_CHANGE_ATTENTION',   'materiality', 'py_change_attention',   '>=',      'percent', NULL),
  ('MAT_VOLATILITY_ATTENTION',  'materiality', 'volatility_attention',  '>=',      'percent', NULL),
  ('MAT_NEAR_BREAKEVEN_MARGIN', 'materiality', 'near_breakeven_margin', '<=',      'percent', NULL),
  ('MAT_ROUNDING_STEP',         'materiality', 'rounding_step',         '==',      'inr',     NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, threshold, threshold_high, outcome,
   authority_provision_id, guidance_reference)
SELECT r.id, 1, '2000-04-01'::date, v.lo, v.hi, 'guidance', p.id,
       'PROVISIONAL placeholder pending DHVAJ methodology approval — replace by a new version'
FROM (VALUES
  ('MAT_OM_PCT_PBT',            5::numeric,   10::numeric),
  ('MAT_OM_PCT_NORMALISED_PBT', 5::numeric,   10::numeric),
  ('MAT_OM_PCT_REVENUE',        0.5::numeric, 1::numeric),
  ('MAT_OM_PCT_TOTAL_ASSETS',   1::numeric,   2::numeric),
  ('MAT_OM_PCT_NET_ASSETS',     1::numeric,   5::numeric),
  ('MAT_OM_PCT_EXPENDITURE',    0.5::numeric, 2::numeric),
  ('MAT_PM_PCT_OM',             50::numeric,  75::numeric),
  ('MAT_CTT_PCT_OM',            3::numeric,   5::numeric),
  ('MAT_PY_CHANGE_ATTENTION',   25::numeric,  NULL),
  ('MAT_VOLATILITY_ATTENTION',  30::numeric,  NULL),
  ('MAT_NEAR_BREAKEVEN_MARGIN', 2::numeric,   NULL),
  ('MAT_ROUNDING_STEP',         1000::numeric, NULL)
) AS v(rule_code, lo, hi)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = 'IG_MATERIALITY'
ON CONFLICT (audit_rule_id, version) DO NOTHING;

ALTER TABLE hsdg.audit_rule            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version    FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision   FORCE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_materiality_revision_item CASCADE;
DROP TABLE IF EXISTS hsdg.audit_materiality_qualitative CASCADE;
DROP TABLE IF EXISTS hsdg.audit_materiality_specific CASCADE;
DROP TABLE IF EXISTS hsdg.audit_materiality_adjustment CASCADE;
DROP TABLE IF EXISTS hsdg.audit_materiality_benchmark CASCADE;
DROP TABLE IF EXISTS hsdg.audit_materiality_determination CASCADE;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.audit_rule_version v USING hsdg.audit_rule r
 WHERE v.audit_rule_id = r.id AND r.area_key = 'materiality';
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.audit_rule WHERE area_key = 'materiality';
ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;

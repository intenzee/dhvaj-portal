-- ─────────────────────────────────────────────────────────────────────────
-- 03.4 Audit Scope & Approach — governance, hand-offs and methodology
--   (DHVAJ 03.4 §6, §7, §15, §23, §26, §27, §28, §30, §31, §32)
--
--   • §30 permissions — Article / Senior (engagement team members) prepare
--     the population facts (unit indicators, employees / volume, location),
--     service-organisation facts, the dependency register, decisions and the
--     approach-map strategy fields; only the Engagement Manager (or an EP
--     acting as Manager) concludes scope, sets AP-01 / OB-01 / SO-01 / IA-01 /
--     DT-01 / SL-01, includes / excludes map areas and completes AP-02; the
--     Engagement Partner reviews (§26). RLS is widened to members on the
--     tables the team prepares, exactly as 03.1–03.3 governance did; the API
--     enforces the per-role matrix (PlanningGovernanceGuard + field checks).
--   • §7 — a unit carries employees and a transaction-volume indicator.
--   • §26 — Partner actions record who answered and when, and the 03.4
--     version they were raised on (they feed 03.12).
--   • §23 — an Approach Map area converts to / links with exactly one 03.5
--     engagement area (audit_engagement_area.scope_map_item_id; a converted
--     custom area has origin 'scope_map').
--   • §21/§22/§26 — 03.4 Partner Attention triggers join the Partner Planning
--     View queue (audit_planning_attention) as a fourth target, one row per
--     trigger per scope record.
--   • §28 — SharePoint evidence on 03.4 records.
--   • §31 — the 03.4 methodology library (controls cycles, timing areas,
--     evidence channels, technology uses) is versioned data maintained by the
--     Methodology Admin, not code.
--   • §32 — '03.4' authority reference links (resolved centrally).
--   • notifications gain the two 03.4 types.
--
-- RLS: ENABLE (not FORCE) like every 03.x table; the library is FORCE after its seed.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── §30 the engagement team prepares 03.4 data ──────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_scope_approach','audit_scope_unit','audit_scope_decision',
                           'audit_scope_service_org','audit_scope_consideration',
                           'audit_scope_dependency','audit_scope_map_item']
  LOOP
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_member(engagement_id)) WITH CHECK (hsdg.is_engagement_member(engagement_id))', t || '_update', t);
  END LOOP;
END $$;

-- A Senior's first save moves the 03.4 checklist rows to In progress.
DROP POLICY audit_planning_items_update ON hsdg.audit_planning_items;
CREATE POLICY audit_planning_items_update ON hsdg.audit_planning_items
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality','audit_approach','overall_audit_plan'))
  )
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality','audit_approach','overall_audit_plan'))
  );

-- ── §7 unit indicators ──────────────────────────────────────────────────
ALTER TABLE hsdg.audit_scope_unit
  ADD COLUMN employees          integer CHECK (employees IS NULL OR employees >= 0),
  ADD COLUMN transaction_volume numeric(20,0) CHECK (transaction_volume IS NULL OR transaction_volume >= 0),
  ADD COLUMN volume_note        text CHECK (volume_note IS NULL OR length(volume_note) <= 500);

-- ── §26 Partner actions → 03.12 ─────────────────────────────────────────
ALTER TABLE hsdg.audit_scope_partner_action
  ADD COLUMN scope_version_no         integer,
  ADD COLUMN responded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN responded_at             timestamptz;

-- ── §23 Approach Map → 03.5 ─────────────────────────────────────────────
-- The Manager linked / unlinked the map area by hand: automatic matching leaves it alone.
ALTER TABLE hsdg.audit_scope_map_item
  ADD COLUMN area_link_manual boolean NOT NULL DEFAULT false;
ALTER TABLE hsdg.audit_engagement_area
  ADD COLUMN scope_map_item_id uuid REFERENCES hsdg.audit_scope_map_item (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX audit_engagement_area_scope_map_item_key
  ON hsdg.audit_engagement_area (scope_map_item_id) WHERE scope_map_item_id IS NOT NULL;
ALTER TABLE hsdg.audit_engagement_area DROP CONSTRAINT audit_engagement_area_origin_check;
ALTER TABLE hsdg.audit_engagement_area ADD CONSTRAINT audit_engagement_area_origin_check
  CHECK (origin IN ('population','added_from_library','methodology_refresh','custom','scope_map'));

-- ── §21/§22/§26 03.4 triggers in the Partner Planning View queue ────────
ALTER TABLE hsdg.audit_planning_attention
  ADD COLUMN scope_id          uuid REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  ADD COLUMN scope_trigger_key text
    CHECK (scope_trigger_key IS NULL OR scope_trigger_key ~ '^[a-z0-9_:.-]{2,120}$'),
  ADD COLUMN scope_seq         integer,
  ADD COLUMN scope_label       text,
  ADD COLUMN scope_detail      text;
ALTER TABLE hsdg.audit_planning_attention
  ADD CONSTRAINT audit_planning_attention_scope_trigger UNIQUE (scope_id, scope_trigger_key),
  ADD CONSTRAINT audit_planning_attention_scope_shape CHECK (
    (scope_id IS NULL) = (scope_trigger_key IS NULL)
    AND (scope_id IS NULL) = (scope_seq IS NULL)
    AND (scope_id IS NULL) = (scope_label IS NULL)
  ),
  DROP CONSTRAINT audit_planning_attention_one_target,
  ADD CONSTRAINT audit_planning_attention_one_target CHECK (
    (signal_id IS NOT NULL)::int + (focus_id IS NOT NULL)::int
      + (materiality_determination_id IS NOT NULL)::int + (scope_id IS NOT NULL)::int = 1
  );

-- ── §28 evidence on 03.4 records ────────────────────────────────────────
ALTER TABLE hsdg.audit_planning_evidence
  DROP CONSTRAINT audit_planning_evidence_target_type_check;
ALTER TABLE hsdg.audit_planning_evidence
  ADD CONSTRAINT audit_planning_evidence_target_type_check CHECK (target_type IN
    ('signal','change','prior_year','acceptance','discussion',
     'understanding_section','financial_dataset','analytics_exception','planning_expectation',
     'materiality_determination','materiality_adjustment','materiality_specific',
     'materiality_qualitative',
     'scope_approach','scope_unit','scope_service_org','scope_dependency','scope_limitation',
     'scope_map_item'));

-- ── notifications ───────────────────────────────────────────────────────
ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue',
   'client_commitment_overdue','client_dependency_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception',
   'document_uploaded',
   'framework_reopened','framework_work_impacted',
   'planning_signal_alert','planning_partner_attention','planning_strategy_reopened',
   'planning_understanding_reassessment','planning_understanding_challenge',
   'planning_materiality_reassessment','planning_materiality_challenge',
   'planning_scope_reassessment','planning_scope_partner_action'));

-- ── §31 03.4 Methodology Library ────────────────────────────────────────
CREATE TABLE hsdg.scope_methodology_item (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code               text NOT NULL CHECK (item_code ~ '^SMI-[0-9]{3}$'),
  version                 integer NOT NULL CHECK (version >= 1),
  -- The 03.4 decision list the item belongs to; never changes across versions of a code.
  kind                    text NOT NULL CHECK (kind IN
                            ('controls_cycle','timing','evidence_channel','technology_use')),
  item_key                text NOT NULL CHECK (item_key ~ '^[a-z][a-z0-9_]{1,59}$'),
  label                   text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
  -- The answer vocabulary offered for the item (validated against 03.4's known statuses in code).
  options                 text[] NOT NULL CHECK (cardinality(options) BETWEEN 2 AND 8
                            AND array_position(options, NULL) IS NULL),
  hint                    text CHECK (hint IS NULL OR length(hint) <= 300),
  guidance                text CHECK (guidance IS NULL OR length(guidance) <= 2000),
  sort_order              integer NOT NULL DEFAULT 0,
  effective_from          date NOT NULL DEFAULT DATE '2000-01-01',
  effective_to            date,
  active                  boolean NOT NULL DEFAULT true,
  methodology_version     text NOT NULL CHECK (length(trim(methodology_version)) BETWEEN 1 AND 60),
  change_note             text CHECK (change_note IS NULL OR length(change_note) <= 2000),
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_code, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

DO $$
DECLARE t text := 'scope_methodology_item';
BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON hsdg.%I FROM hsdg_app', t);
  EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.ctx_role() IS NOT NULL)',
                 t || '_read', t);
  EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide())',
                 t || '_insert', t);
END $$;

-- v1 seed: the lists 03.4 used to hard-code (dhvaj-scope-2026.1).
INSERT INTO hsdg.scope_methodology_item
  (item_code, version, kind, item_key, label, options, hint, sort_order, methodology_version, change_note)
SELECT 'SMI-' || lpad(s.n::text, 3, '0'), 1, s.kind, s.item_key, s.label, s.options, s.hint, s.n,
       'dhvaj-scope-2026.1', 'v1 — moved from the 03.4 built-in lists.'
FROM (VALUES
  (1,  'controls_cycle', 'revenue',         'Revenue',                     ARRAY['reliance_contemplated','no_reliance','further_assessment'], 'Section 05'),
  (2,  'controls_cycle', 'procurement',     'Procurement / payables',      ARRAY['reliance_contemplated','no_reliance','further_assessment'], 'Section 05'),
  (3,  'controls_cycle', 'payroll',         'Payroll',                     ARRAY['reliance_contemplated','no_reliance','further_assessment'], 'Section 05 / SA 402 if outsourced'),
  (4,  'controls_cycle', 'inventory',       'Inventory',                   ARRAY['reliance_contemplated','no_reliance','further_assessment'], 'Section 05'),
  (5,  'controls_cycle', 'treasury',        'Treasury',                    ARRAY['reliance_contemplated','no_reliance','further_assessment'], 'Section 05'),
  (6,  'controls_cycle', 'financial_close', 'Financial close / reporting', ARRAY['reliance_contemplated','no_reliance','further_assessment'], 'Section 05'),
  (7,  'timing', 'controls',    'Controls',               ARRAY['interim','year_end','both','tbd'], 'Roll-forward required? — prompted from the controls strategy.'),
  (8,  'timing', 'revenue',     'Revenue / transactions', ARRAY['interim','year_end','both','tbd'], 'Assess remaining-period work.'),
  (9,  'timing', 'receivables', 'Receivables / balances', ARRAY['interim','year_end','both','tbd'], 'Assess roll-forward if interim.'),
  (10, 'timing', 'inventory',   'Inventory',              ARRAY['interim','count_date','year_end','both','tbd'], 'Assess movement / reconciliation need.'),
  (11, 'evidence_channel', 'accounting_records',     'Entity accounting records',         ARRAY['expected','not_significant','further_assessment'], NULL),
  (12, 'evidence_channel', 'external_confirmations', 'External confirmations',            ARRAY['expected','not_presently_expected','further_assessment'], 'SA 505 — see EC-01.'),
  (13, 'evidence_channel', 'physical_observation',   'Physical observation / inspection', ARRAY['expected','not_presently_expected','further_assessment'], 'SA 501 where inventory is material / relevant.'),
  (14, 'evidence_channel', 'recalculation',          'Recalculation / reperformance',     ARRAY['expected','not_presently_expected','further_assessment'], NULL),
  (15, 'evidence_channel', 'analytical_procedures',  'Analytical procedures',             ARRAY['expected','not_presently_expected','further_assessment'], NULL),
  (16, 'evidence_channel', 'ipe',                    'System-generated reports / IPE',    ARRAY['expected','not_presently_expected','further_assessment'], NULL),
  (17, 'evidence_channel', 'external_information',   'External information',              ARRAY['expected','not_presently_expected','further_assessment'], NULL),
  (18, 'evidence_channel', 'management_expert',      'Management expert',                 ARRAY['relevant','not_relevant','further_assessment'], NULL),
  (19, 'evidence_channel', 'auditor_expert',         'Auditor expert',                    ARRAY['likely_required','evaluate_further','not_required'], 'SA 620 — route to 03.8.'),
  (20, 'evidence_channel', 'component_auditor',      'Component / branch auditor',        ARRAY['expected','direct_dhvaj','combination','further_assessment'], '03.9'),
  (21, 'evidence_channel', 'internal_audit',         'Internal audit',                    ARRAY['consider_use','do_not_use','further_assessment'], 'SA 610 — see IA-01.'),
  (22, 'evidence_channel', 'service_org_evidence',   'Service-organisation evidence',     ARRAY['expected','not_relevant','further_assessment'], 'SA 402'),
  (23, 'evidence_channel', 'data_analytics',         'Data analytics / CAATs',            ARRAY['expected','not_planned','further_assessment'], 'See DT-01.'),
  (24, 'technology_use', 'full_population',   'Full-population analytics',          ARRAY['expected','not_planned','assess'], NULL),
  (25, 'technology_use', 'journal_entry',     'Journal-entry analytics',            ARRAY['expected','not_planned','assess'], NULL),
  (26, 'technology_use', 'revenue_analytics', 'Revenue analytics',                  ARRAY['expected','not_planned','assess'], NULL),
  (27, 'technology_use', 'duplicate_gap',     'Duplicate / sequence / gap testing', ARRAY['expected','not_planned','assess'], NULL),
  (28, 'technology_use', 'aging_matching',    'Aging / matching analytics',         ARRAY['expected','not_planned','assess'], NULL),
  (29, 'technology_use', 'user_access',       'User-access / audit-trail analytics',ARRAY['expected','not_planned','assess'], NULL)
) AS s(n, kind, item_key, label, options, hint);

ALTER TABLE hsdg.scope_methodology_item FORCE ROW LEVEL SECURITY;

-- ── §32 authority references ────────────────────────────────────────────
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('03.4', 'view_sa_300',    'View SA 300',                   'SA_300',    10),
  ('03.4', 'view_ig_sa_300', 'View Planning Implementation Guide', 'IG_SA_300', 20),
  ('03.4', 'view_sa_330',    'View SA 330',                   'SA_330',    30),
  ('03.4', 'view_sa_600',    'View SA 600',                   'SA_600',    40),
  ('03.4', 'view_sa_505',    'View SA 505',                   'SA_505',    50),
  ('03.4', 'view_sa_501',    'View SA 501',                   'SA_501',    60),
  ('03.4', 'view_sa_510',    'View SA 510',                   'SA_510',    70),
  ('03.4', 'view_sa_402',    'View SA 402',                   'SA_402',    80),
  ('03.4', 'view_sa_610',    'View SA 610',                   'SA_610',    90),
  ('03.4', 'view_sa_620',    'View SA 620',                   'SA_620',   100)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '03.4';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS hsdg.scope_methodology_item CASCADE;

DELETE FROM hsdg.notifications
 WHERE type IN ('planning_scope_reassessment','planning_scope_partner_action');
ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue',
   'client_commitment_overdue','client_dependency_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception',
   'document_uploaded',
   'framework_reopened','framework_work_impacted',
   'planning_signal_alert','planning_partner_attention','planning_strategy_reopened',
   'planning_understanding_reassessment','planning_understanding_challenge',
   'planning_materiality_reassessment','planning_materiality_challenge'));

DELETE FROM hsdg.audit_planning_evidence
 WHERE target_type IN ('scope_approach','scope_unit','scope_service_org','scope_dependency',
                       'scope_limitation','scope_map_item');
ALTER TABLE hsdg.audit_planning_evidence
  DROP CONSTRAINT audit_planning_evidence_target_type_check;
ALTER TABLE hsdg.audit_planning_evidence
  ADD CONSTRAINT audit_planning_evidence_target_type_check CHECK (target_type IN
    ('signal','change','prior_year','acceptance','discussion',
     'understanding_section','financial_dataset','analytics_exception','planning_expectation',
     'materiality_determination','materiality_adjustment','materiality_specific',
     'materiality_qualitative'));

DELETE FROM hsdg.audit_planning_attention WHERE scope_id IS NOT NULL;
ALTER TABLE hsdg.audit_planning_attention
  DROP CONSTRAINT audit_planning_attention_one_target,
  ADD CONSTRAINT audit_planning_attention_one_target CHECK (
    (signal_id IS NOT NULL)::int + (focus_id IS NOT NULL)::int
      + (materiality_determination_id IS NOT NULL)::int = 1
  ),
  DROP CONSTRAINT IF EXISTS audit_planning_attention_scope_shape,
  DROP CONSTRAINT IF EXISTS audit_planning_attention_scope_trigger,
  DROP COLUMN IF EXISTS scope_detail,
  DROP COLUMN IF EXISTS scope_label,
  DROP COLUMN IF EXISTS scope_seq,
  DROP COLUMN IF EXISTS scope_trigger_key,
  DROP COLUMN IF EXISTS scope_id;

UPDATE hsdg.audit_engagement_area SET origin = 'custom' WHERE origin = 'scope_map';
ALTER TABLE hsdg.audit_engagement_area DROP CONSTRAINT audit_engagement_area_origin_check;
ALTER TABLE hsdg.audit_engagement_area ADD CONSTRAINT audit_engagement_area_origin_check
  CHECK (origin IN ('population','added_from_library','methodology_refresh','custom'));
DROP INDEX IF EXISTS hsdg.audit_engagement_area_scope_map_item_key;
ALTER TABLE hsdg.audit_engagement_area DROP COLUMN IF EXISTS scope_map_item_id;
ALTER TABLE hsdg.audit_scope_map_item DROP COLUMN IF EXISTS area_link_manual;

ALTER TABLE hsdg.audit_scope_partner_action
  DROP COLUMN IF EXISTS responded_at,
  DROP COLUMN IF EXISTS responded_by_employee_id,
  DROP COLUMN IF EXISTS scope_version_no;

ALTER TABLE hsdg.audit_scope_unit
  DROP COLUMN IF EXISTS volume_note,
  DROP COLUMN IF EXISTS transaction_volume,
  DROP COLUMN IF EXISTS employees;

DROP POLICY audit_planning_items_update ON hsdg.audit_planning_items;
CREATE POLICY audit_planning_items_update ON hsdg.audit_planning_items
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality'))
  )
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality'))
  );

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_scope_approach','audit_scope_unit','audit_scope_decision',
                           'audit_scope_service_org','audit_scope_consideration',
                           'audit_scope_dependency','audit_scope_map_item']
  LOOP
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
  END LOOP;
END $$;

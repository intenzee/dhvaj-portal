-- ─────────────────────────────────────────────────────────────────────────
-- 0066 · Statutory Audit — 03.4 Audit Scope & Approach
--   (DHVAJ 03.4 spec; docs/section-03-planning-build-spec.md §5.4)
--
-- 03.4 turns the approved framework, planning intelligence, business
-- understanding and materiality into the STRATEGIC scope and overall approach.
-- It never designs assertion-level risks, controls tests or procedures, and it
-- never re-keys Section 01/02/03.x facts — those are read live.
--
-- TABLES:
--   • audit_scope_approach        — one row per audit file: SC-01/02, AP-01,
--     EC-01, inventory/physical, OB-01, IA-01, DT-01, SL-01, AP-02, status and
--     the controlled revision number (v1.0 → v1.1).
--   • audit_scope_unit            — Audit Population (SC-03). Auto units carry
--     a unit_key (idempotent generation); never auto-excluded, never deleted by
--     regeneration.
--   • audit_scope_decision        — keyed strategic decisions: controls reliance
--     per major cycle, interim/year-end timing, evidence channels, technology uses.
--   • audit_scope_service_org     — SO-01 service organisation cards.
--   • audit_scope_consideration   — §17 specialist decisions and §20 special
--     approach implications suggested from signals / facts.
--   • audit_scope_dependency      — §21 Scope Dependency Register.
--   • audit_scope_limitation      — §22 SL-01 potential scope limitations
--     (always Immediate Partner Attention + an open Planning Matter).
--   • audit_scope_map_item        — §23 Preliminary Audit Approach Map.
--   • audit_scope_revision        — §27 approved-baseline snapshots per revision.
--   • audit_scope_partner_action  — §26 Partner Planning View actions (→ 03.12).
--
-- SECURITY — engagement child data, same pattern as 0062–0065: members SELECT,
-- leads (EP/manager) INSERT/UPDATE/DELETE. ENABLE (not FORCE) RLS.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_scope_approach (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL UNIQUE
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  version_no               integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN
                             ('draft','complete','reassessment_required')),
  methodology_version      text,
  -- 03.4.2 financial statement scope
  sc01                     text CHECK (sc01 IS NULL OR sc01 IN ('standalone','cfs','both','other')),
  sc01_other               text,
  sc02                     text CHECK (sc02 IS NULL OR sc02 IN ('yes','requires_correction')),
  sc02_note                text,
  -- 03.4.4 overall approach
  ap01                     text CHECK (ap01 IS NULL OR ap01 IN
                             ('predominantly_substantive','combined','controls_selected_areas',
                              'mixed_by_area','not_yet_determinable')),
  ap01_rationale           text,
  icfr_note                text,
  -- 03.4.7 external confirmations + physical observation
  ec01                     text CHECK (ec01 IS NULL OR ec01 IN
                             ('expected','not_presently_expected','further_assessment')),
  ec01_areas               text[] NOT NULL DEFAULT '{}',
  ec01_note                text,
  inventory_decision       text CHECK (inventory_decision IS NULL OR inventory_decision IN
                             ('attendance_expected','alternative_assessment','not_material',
                              'information_required')),
  inventory_locations      text,
  inventory_note           text,
  physical_other           text CHECK (physical_other IS NULL OR physical_other IN
                             ('expected','not_presently_expected','further_assessment')),
  physical_other_note      text,
  -- 03.4.8 triggered cards
  ob_inputs                jsonb NOT NULL DEFAULT '{}',
  ob01                     text CHECK (ob01 IS NULL OR ob01 IN
                             ('standard','enhanced_attention','potential_evidence_limitation',
                              'further_information_required')),
  ob01_note                text,
  ia01                     text CHECK (ia01 IS NULL OR ia01 IN ('yes_sa610','no','further_assessment')),
  ia01_note                text,
  joint_audit_note         text,
  dt01                     text CHECK (dt01 IS NULL OR dt01 IN ('yes','no','further_assessment')),
  dt01_note                text,
  -- 03.4.9 SL-01
  sl01                     text CHECK (sl01 IS NULL OR sl01 IN ('no','yes','uncertain')),
  -- Materiality version the approach was completed against (§24 revision check).
  materiality_version_no   integer,
  -- Reassessment Required (§24/§27) — set, never silently resolved.
  reassessment_reason      text,
  reassessment_source      text CHECK (reassessment_source IS NULL OR reassessment_source IN
                             ('materiality_revision','section_05','manager','other')),
  -- Revision in progress (version_no > 1)
  revision_trigger         text CHECK (revision_trigger IS NULL OR revision_trigger IN
                             ('controls_not_supported','new_significant_transaction',
                              'materiality_revision','component_auditor_issue',
                              'inventory_access_denied','data_unavailable','other')),
  revision_reason          text,
  -- 03.4.11 conclusion
  conclusion_summary       text,
  ap02                     text CHECK (ap02 IS NULL OR ap02 IN ('yes_complete','no_further_work')),
  completed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  completed_at             timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_scope_approach_revision_shape CHECK (
    version_no = 1 OR (revision_trigger IS NOT NULL AND revision_reason IS NOT NULL)
  )
);
CREATE INDEX audit_scope_approach_engagement_idx ON hsdg.audit_scope_approach (engagement_id);
CREATE TRIGGER audit_scope_approach_set_updated_at
  BEFORE UPDATE ON hsdg.audit_scope_approach
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_scope_unit (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               uuid NOT NULL REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  unit_key               text CHECK (unit_key IS NULL OR unit_key ~ '^[a-z0-9_:.-]{2,120}$'),
  is_auto                boolean NOT NULL DEFAULT false,
  source_label           text,
  name                   text NOT NULL CHECK (length(trim(name)) > 0),
  unit_type              text NOT NULL CHECK (unit_type IN
                           ('entity','component','branch','plant','warehouse','office',
                            'service_organisation','other')),
  location               text,
  fin_metric             text,
  fin_amount             numeric(20,2),          -- rupees
  fin_source             text,
  fin_not_available      boolean NOT NULL DEFAULT false,
  relevance              text[] NOT NULL DEFAULT '{}',
  relevance_other        text,
  qualitative_note       text,
  signal_ids             uuid[] NOT NULL DEFAULT '{}',
  focus_ids              uuid[] NOT NULL DEFAULT '{}',
  specific_materiality   boolean NOT NULL DEFAULT false,
  auditor                text NOT NULL DEFAULT 'dhvaj' CHECK (auditor IN
                           ('dhvaj','component_auditor','branch_auditor','joint_auditor','other')),
  auditor_strategy       text CHECK (auditor_strategy IS NULL OR auditor_strategy IN
                           ('use_other_auditor','direct_dhvaj','combination','further_assessment')),
  scope_conclusion       text CHECK (scope_conclusion IS NULL OR scope_conclusion IN
                           ('in_scope','limited','not_separately_scoped','further_assessment',
                            'not_applicable')),
  rationale              text,
  no_longer_generated    boolean NOT NULL DEFAULT false,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_id, seq),
  UNIQUE (scope_id, unit_key)
);

CREATE TABLE hsdg.audit_scope_decision (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               uuid NOT NULL REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  kind                   text NOT NULL CHECK (kind IN
                           ('controls_cycle','timing','evidence_channel','technology_use')),
  item_key               text NOT NULL CHECK (item_key ~ '^[a-z0-9_]{2,60}$'),
  label                  text,                    -- custom items only
  is_custom              boolean NOT NULL DEFAULT false,
  status                 text,                    -- vocabulary per kind, validated in code
  roll_forward           text CHECK (roll_forward IS NULL OR roll_forward IN
                           ('required','not_required','assess')),
  note                   text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_id, kind, item_key)
);

CREATE TABLE hsdg.audit_scope_service_org (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               uuid NOT NULL REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  source_key             text CHECK (source_key IS NULL OR source_key ~ '^[a-z0-9_:.-]{2,120}$'),
  provider               text NOT NULL CHECK (length(trim(provider)) > 0),
  process                text,
  affected_areas         text[] NOT NULL DEFAULT '{}',
  assurance_report       text CHECK (assurance_report IS NULL OR assurance_report IN
                           ('available','expected','not_known','not_available')),
  report_detail          text,
  cuec                   text CHECK (cuec IS NULL OR cuec IN ('yes','no','unknown')),
  so01                   text CHECK (so01 IS NULL OR so01 IN
                           ('sa402_required','not_relevant','further_assessment')),
  note                   text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_id, seq),
  UNIQUE (scope_id, source_key)
);

CREATE TABLE hsdg.audit_scope_consideration (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               uuid NOT NULL REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  kind                   text NOT NULL CHECK (kind IN ('implication','specialist')),
  consideration_key      text NOT NULL CHECK (consideration_key ~ '^[a-z0-9_:.-]{2,120}$'),
  is_auto                boolean NOT NULL DEFAULT true,
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  source_label           text,
  observation            text NOT NULL CHECK (length(trim(observation)) > 0),
  suggestion             text,
  attention              text NOT NULL DEFAULT 'standard' CHECK (attention IN
                           ('standard','enhanced','immediate_partner')),
  response               text,                    -- vocabulary per kind, validated in code
  note                   text,
  planning_matter_id     uuid REFERENCES hsdg.audit_planning_matter (id) ON DELETE SET NULL,
  no_longer_triggered    boolean NOT NULL DEFAULT false,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_id, consideration_key)
);

CREATE TABLE hsdg.audit_scope_dependency (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               uuid NOT NULL REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  description            text NOT NULL CHECK (length(trim(description)) > 0),
  affected               text,
  unit_id                uuid REFERENCES hsdg.audit_scope_unit (id) ON DELETE SET NULL,
  owner_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  owner_party            text NOT NULL DEFAULT 'engagement_team' CHECK (owner_party IN
                           ('engagement_team','client','third_party')),
  needed_by              text CHECK (needed_by IS NULL OR needed_by IN
                           ('planning','interim','year_end','reporting')),
  impact                 text NOT NULL CHECK (impact IN
                           ('information','delay','approach_change',
                            'potential_evidence_limitation','other')),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN
                           ('open','in_progress','resolved','escalated')),
  resolution             text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_id, seq),
  CONSTRAINT audit_scope_dependency_resolution CHECK (
    status <> 'resolved' OR (resolution IS NOT NULL AND length(trim(resolution)) > 0)
  )
);

CREATE TABLE hsdg.audit_scope_limitation (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               uuid NOT NULL REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  matter                 text NOT NULL CHECK (length(trim(matter)) > 0),
  affected               text,
  management_position    text,
  alternative_evidence   text,
  owner_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution             text,
  planning_matter_id     uuid REFERENCES hsdg.audit_planning_matter (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_id, seq),
  CONSTRAINT audit_scope_limitation_resolution CHECK (
    status <> 'resolved' OR (resolution IS NOT NULL AND length(trim(resolution)) > 0)
  )
);

CREATE TABLE hsdg.audit_scope_map_item (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               uuid NOT NULL REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  area_key               text CHECK (area_key IS NULL OR area_key ~ '^[a-z0-9_]{2,60}$'),
  is_auto                boolean NOT NULL DEFAULT false,
  source_label           text,
  name                   text NOT NULL CHECK (length(trim(name)) > 0),
  metric_key             text,
  manual_amount          numeric(20,2),           -- rupees, custom areas only
  materiality_note       text,
  signal_ids             uuid[] NOT NULL DEFAULT '{}',
  focus_ids              uuid[] NOT NULL DEFAULT '{}',
  controls_strategy      text CHECK (controls_strategy IS NULL OR controls_strategy IN
                           ('reliance_contemplated','no_reliance','assess')),
  timing                 text CHECK (timing IS NULL OR timing IN ('interim','year_end','both','tbd')),
  evidence_channels      text[] NOT NULL DEFAULT '{}',
  special_considerations text[] NOT NULL DEFAULT '{}',
  note                   text,
  included               boolean NOT NULL DEFAULT true,
  exclusion_reason       text,
  reassessment_required  boolean NOT NULL DEFAULT false,
  reassessment_reason    text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_id, seq),
  UNIQUE (scope_id, area_key),
  CONSTRAINT audit_scope_map_item_exclusion CHECK (
    included OR (exclusion_reason IS NOT NULL AND length(trim(exclusion_reason)) > 0)
  )
);

CREATE TABLE hsdg.audit_scope_revision (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               uuid NOT NULL REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  from_version_no        integer NOT NULL,
  to_version_no          integer NOT NULL,
  trigger                text NOT NULL,
  reason                 text NOT NULL CHECK (length(trim(reason)) > 0),
  affected_modules       text[] NOT NULL DEFAULT '{}',
  baseline               jsonb NOT NULL,          -- the approved record, frozen
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_id, to_version_no)
);

CREATE TABLE hsdg.audit_scope_partner_action (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               uuid NOT NULL REFERENCES hsdg.audit_scope_approach (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  action                 text NOT NULL CHECK (action IN
                           ('agree','challenge','request_consideration','add_signal')),
  note                   text,
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','addressed')),
  response               text,
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_scope_partner_action_note CHECK (
    action = 'agree' OR (note IS NOT NULL AND length(trim(note)) > 0)
  ),
  CONSTRAINT audit_scope_partner_action_addressed CHECK (
    status <> 'addressed' OR (response IS NOT NULL AND length(trim(response)) > 0)
  )
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_scope_unit','audit_scope_decision','audit_scope_service_org',
                           'audit_scope_consideration','audit_scope_dependency',
                           'audit_scope_limitation','audit_scope_map_item',
                           'audit_scope_partner_action']
  LOOP
    EXECUTE format('CREATE INDEX %I ON hsdg.%I (engagement_id)', t || '_engagement_idx', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON hsdg.%I FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at()', t || '_set_updated_at', t);
  END LOOP;
END $$;
CREATE INDEX audit_scope_revision_engagement_idx ON hsdg.audit_scope_revision (engagement_id);

-- ── Row Level Security ────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_scope_approach','audit_scope_unit','audit_scope_decision',
                           'audit_scope_service_org','audit_scope_consideration',
                           'audit_scope_dependency','audit_scope_limitation',
                           'audit_scope_map_item','audit_scope_revision',
                           'audit_scope_partner_action']
  LOOP
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.is_engagement_member(engagement_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR DELETE USING (hsdg.is_engagement_lead(engagement_id))', t || '_delete', t);
  END LOOP;
END $$;

-- 03.4 raises Planning Matters (evaluate-further specialists, scope limitations).
ALTER TABLE hsdg.audit_planning_matter DROP CONSTRAINT audit_planning_matter_origin_check;
ALTER TABLE hsdg.audit_planning_matter ADD CONSTRAINT audit_planning_matter_origin_check
  CHECK (origin IN ('signal','focus_area','discussion','scope_approach'));

-- ── Authority / Provision Library (§32) ───────────────────────────────────
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, source_reference)
VALUES
  ('SA_300', 'ICAI', 'Planning an audit of financial statements',                              'SA 300', '2008-04-01', 'ICAI Standard on Auditing 300'),
  ('SA_330', 'ICAI', 'The auditor''s responses to assessed risks',                             'SA 330', '2008-04-01', 'ICAI Standard on Auditing 330'),
  ('SA_402', 'ICAI', 'Audit considerations relating to an entity using a service organisation','SA 402', '2010-04-01', 'ICAI Standard on Auditing 402'),
  ('SA_501', 'ICAI', 'Audit evidence — specific considerations for selected items',            'SA 501', '2010-04-01', 'ICAI Standard on Auditing 501'),
  ('SA_505', 'ICAI', 'External confirmations',                                                 'SA 505', '2010-04-01', 'ICAI Standard on Auditing 505'),
  ('SA_510', 'ICAI', 'Initial audit engagements — opening balances',                           'SA 510', '2010-04-01', 'ICAI Standard on Auditing 510'),
  ('SA_610', 'ICAI', 'Using the work of internal auditors (Revised)',                          'SA 610', '2014-04-01', 'ICAI Standard on Auditing 610 (Revised)'),
  ('SA_620', 'ICAI', 'Using the work of an auditor''s expert',                                 'SA 620', '2010-04-01', 'ICAI Standard on Auditing 620'),
  ('IG_SA_300', 'ICAI', 'Implementation Guide to SA 300, Planning an Audit of Financial Statements',
                'Implementation Guide (SA 300)', '2008-04-01', 'ICAI Implementation Guide to SA 300')
ON CONFLICT (code) DO NOTHING;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_scope_partner_action CASCADE;
DROP TABLE IF EXISTS hsdg.audit_scope_revision CASCADE;
DROP TABLE IF EXISTS hsdg.audit_scope_map_item CASCADE;
DROP TABLE IF EXISTS hsdg.audit_scope_limitation CASCADE;
DROP TABLE IF EXISTS hsdg.audit_scope_dependency CASCADE;
DROP TABLE IF EXISTS hsdg.audit_scope_consideration CASCADE;
DROP TABLE IF EXISTS hsdg.audit_scope_service_org CASCADE;
DROP TABLE IF EXISTS hsdg.audit_scope_decision CASCADE;
DROP TABLE IF EXISTS hsdg.audit_scope_unit CASCADE;
DROP TABLE IF EXISTS hsdg.audit_scope_approach CASCADE;
DELETE FROM hsdg.audit_planning_matter WHERE origin = 'scope_approach';
ALTER TABLE hsdg.audit_planning_matter DROP CONSTRAINT audit_planning_matter_origin_check;
ALTER TABLE hsdg.audit_planning_matter ADD CONSTRAINT audit_planning_matter_origin_check
  CHECK (origin IN ('signal','focus_area','discussion'));

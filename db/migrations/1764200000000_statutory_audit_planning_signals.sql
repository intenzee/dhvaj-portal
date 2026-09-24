-- ─────────────────────────────────────────────────────────────────────────
-- 0062 · Statutory Audit — Planning Signal Register + 03.1 Planning Intelligence
--   (DHVAJ Section 03.1/03.2 specs; docs/section-03-planning-build-spec.md)
--
-- The Planning Signal Register is the SPINE of Section 03. ONE engagement-scoped
-- register: 03.1 creates signals (Section 01/02 facts, prior year, current-year
-- changes, professional judgment), 03.2 later appends analytical signals to the
-- SAME register, 03.3–03.5 consume them. A Planning Signal is NOT a risk of
-- material misstatement — attention is Standard/Enhanced/Immediate Partner, never
-- a risk rating. Formal RMM stays in audit_risks (03.6 / Section 04).
--
-- TABLES:
--   • audit_planning_intelligence — one 03.1 record per shell (orientation AS-01,
--     additional scope AS-02, strategy summary, status flow), optimistic-locked.
--   • audit_planning_signal — the register. Auto-derived signals carry a stable
--     rule_key (idempotency); professionally-raised signals have rule_key NULL.
--   • audit_area_of_focus — Manager groups signals into a smaller set (§11).
--   • audit_focus_signal — area-of-focus ↔ signal link (many-to-many).
--   • audit_planning_change — 03.1.2 significant current-year changes (PI-01);
--     a change may generate one linked Planning Signal.
--
-- IDEMPOTENCY: auto signals UNIQUE (workflow_instance_id, rule_key) via a partial
-- index (rule_key IS NOT NULL); the generator upserts by rule_key so re-running
-- never duplicates. `seq` is the per-instance counter behind PS-00n / FA-00n.
--
-- SECURITY — engagement child data, same assignment-based access as the audit
-- shell (mirrors audit_planning_items / audit_matter): members SELECT, only leads
-- (EP/manager) INSERT/UPDATE/DELETE. ENABLE (not FORCE) RLS so migrator-owned
-- SECURITY DEFINER helpers bypass; hsdg_app is never the owner. Endpoints reuse
-- engagement.read / engagement.manage; RLS does the real gating.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 03.1 Planning Intelligence record (one per shell) ─────────────────────
CREATE TABLE hsdg.audit_planning_intelligence (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL UNIQUE
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'not_started' CHECK (status IN
                           ('not_started','intelligence_generated','manager_assessment',
                            'strategy_established','complete')),
  -- AS-01 preliminary overall audit orientation (§12).
  orientation            text CHECK (orientation IS NULL OR orientation IN
                           ('predominantly_substantive','combined',
                            'controls_reliance_selected','not_yet_determinable')),
  orientation_note       text,
  -- AS-02 additional scope considerations directing engagement-team effort (§13.1).
  additional_scope       text,
  -- Manager-editable narrative generated from the structured strategy data (§17).
  strategy_summary       text,
  intelligence_generated_at timestamptz,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_planning_intelligence_engagement_idx
  ON hsdg.audit_planning_intelligence (engagement_id);
CREATE TRIGGER audit_planning_intelligence_set_updated_at
  BEFORE UPDATE ON hsdg.audit_planning_intelligence
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Planning Signal Register ──────────────────────────────────────────────
CREATE TABLE hsdg.audit_planning_signal (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Per-instance sequence behind the display code PS-00n.
  seq                    integer NOT NULL,
  source                 text NOT NULL CHECK (source IN
                           ('section_01','section_02','prior_year','current_year_change',
                            'analytics','manager','partner')),
  -- Idempotency key for AUTO-derived signals (e.g. 'initial_audit'); NULL manual.
  rule_key               text CHECK (rule_key IS NULL OR rule_key ~ '^[a-z0-9_]{2,60}$'),
  source_ref             uuid,
  source_link            text,
  observation            text NOT NULL CHECK (length(trim(observation)) > 0),
  why_may_matter         text,
  potential_implications text,
  suggested_attention    text NOT NULL DEFAULT 'standard' CHECK (suggested_attention IN
                           ('standard','enhanced','immediate_partner')),
  attention              text NOT NULL DEFAULT 'standard' CHECK (attention IN
                           ('standard','enhanced','immediate_partner')),
  attention_rationale    text,
  manager_assessment     text CHECK (manager_assessment IS NULL OR manager_assessment IN
                           ('area_of_focus','potential_risk_assess_further','normal_planning',
                            'further_information_required','not_relevant')),
  assessment_rationale   text,
  owner_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  destinations           text[] NOT NULL DEFAULT '{}',
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN
                           ('open','assessed','awaiting_information','carried_forward','closed')),
  is_auto                boolean NOT NULL DEFAULT false,
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, seq),
  -- 'not_relevant' must carry a rationale (§9).
  CONSTRAINT audit_planning_signal_not_relevant_rationale CHECK (
    manager_assessment <> 'not_relevant'
    OR (assessment_rationale IS NOT NULL AND length(trim(assessment_rationale)) > 0)
  )
);
-- Auto signals are unique per rule per shell (upsert-by-rule idempotency).
CREATE UNIQUE INDEX audit_planning_signal_rule_uk
  ON hsdg.audit_planning_signal (workflow_instance_id, rule_key)
  WHERE rule_key IS NOT NULL;
CREATE INDEX audit_planning_signal_instance_idx
  ON hsdg.audit_planning_signal (workflow_instance_id);
CREATE INDEX audit_planning_signal_engagement_idx
  ON hsdg.audit_planning_signal (engagement_id);
CREATE TRIGGER audit_planning_signal_set_updated_at
  BEFORE UPDATE ON hsdg.audit_planning_signal
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Areas of Focus (Manager consolidation, §11) ───────────────────────────
CREATE TABLE hsdg.audit_area_of_focus (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  name                   text NOT NULL CHECK (length(trim(name)) > 0),
  why_requires_attention text,
  potential_fs_areas     text[] NOT NULL DEFAULT '{}',
  expected_strategic_implication text,
  partner_attention      boolean NOT NULL DEFAULT false,
  destinations           text[] NOT NULL DEFAULT '{}',
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN
                           ('open','established','superseded')),
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, seq)
);
CREATE INDEX audit_area_of_focus_instance_idx
  ON hsdg.audit_area_of_focus (workflow_instance_id);
CREATE INDEX audit_area_of_focus_engagement_idx
  ON hsdg.audit_area_of_focus (engagement_id);
CREATE TRIGGER audit_area_of_focus_set_updated_at
  BEFORE UPDATE ON hsdg.audit_area_of_focus
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Area-of-Focus ↔ Signal link (many-to-many, §11) ───────────────────────
CREATE TABLE hsdg.audit_focus_signal (
  focus_id      uuid NOT NULL REFERENCES hsdg.audit_area_of_focus (id) ON DELETE CASCADE,
  signal_id     uuid NOT NULL REFERENCES hsdg.audit_planning_signal (id) ON DELETE CASCADE,
  engagement_id uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (focus_id, signal_id)
);
CREATE INDEX audit_focus_signal_signal_idx ON hsdg.audit_focus_signal (signal_id);

-- ── 03.1.2 Significant current-year changes (PI-01) ───────────────────────
CREATE TABLE hsdg.audit_planning_change (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  category               text NOT NULL CHECK (category IN
                           ('ownership_promoters','key_management','business_model',
                            'major_customers_suppliers','geography_locations','acquisition_disposal',
                            'subsidiary_jv_associate','borrowings_financing','restructuring',
                            'erp_accounting_system','accounting_policies','major_contracts',
                            'regulatory_environment','litigation','related_parties','fraud',
                            'going_concern','other','no_significant_change')),
  description            text,
  effective_date         date,
  source_evidence        text,
  -- Potential financial-reporting impact known? (NOT an audit-risk question, §6.)
  fr_impact_known        text CHECK (fr_impact_known IS NULL OR fr_impact_known IN
                           ('yes','no','under_assessment')),
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_planning_change_instance_idx
  ON hsdg.audit_planning_change (workflow_instance_id);
CREATE INDEX audit_planning_change_engagement_idx
  ON hsdg.audit_planning_change (engagement_id);
CREATE TRIGGER audit_planning_change_set_updated_at
  BEFORE UPDATE ON hsdg.audit_planning_change
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Seed one 03.1 record per existing statutory-audit shell ───────────────
-- New shells get theirs get-or-created by the service on first read.
INSERT INTO hsdg.audit_planning_intelligence (workflow_instance_id, engagement_id)
SELECT wi.id, wi.engagement_id
  FROM hsdg.service_workflow_instances wi
  WHERE wi.workflow_key = 'statutory_audit'
ON CONFLICT (workflow_instance_id) DO NOTHING;

-- ── Row Level Security (mirrors audit_planning_items) ──────────────────────
ALTER TABLE hsdg.audit_planning_intelligence ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_intelligence_select ON hsdg.audit_planning_intelligence
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_intelligence_insert ON hsdg.audit_planning_intelligence
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_planning_intelligence_update ON hsdg.audit_planning_intelligence
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_planning_signal ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_signal_select ON hsdg.audit_planning_signal
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_signal_insert ON hsdg.audit_planning_signal
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_planning_signal_update ON hsdg.audit_planning_signal
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_area_of_focus ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_area_of_focus_select ON hsdg.audit_area_of_focus
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_area_of_focus_insert ON hsdg.audit_area_of_focus
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_area_of_focus_update ON hsdg.audit_area_of_focus
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_focus_signal ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_focus_signal_select ON hsdg.audit_focus_signal
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_focus_signal_insert ON hsdg.audit_focus_signal
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_focus_signal_delete ON hsdg.audit_focus_signal
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_planning_change ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_change_select ON hsdg.audit_planning_change
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_change_insert ON hsdg.audit_planning_change
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_planning_change_update ON hsdg.audit_planning_change
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_planning_change CASCADE;
DROP TABLE IF EXISTS hsdg.audit_focus_signal CASCADE;
DROP TABLE IF EXISTS hsdg.audit_area_of_focus CASCADE;
DROP TABLE IF EXISTS hsdg.audit_planning_signal CASCADE;
DROP TABLE IF EXISTS hsdg.audit_planning_intelligence CASCADE;

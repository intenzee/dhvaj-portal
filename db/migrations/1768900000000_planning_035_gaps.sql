-- ─────────────────────────────────────────────────────────────────────────
-- 03.5 Audit Areas & Assertions — gaps round (DHVAJ 03.5 §4, §7, §9.1, §24,
--   §25, §27, §28)
--
-- §27 ROLES. The Engagement Manager (or the EP acting as Manager when no
-- Manager is assigned) prepares and completes 03.5. A Senior / Article may
-- prepare "only if engagement permission explicitly allows" and complete AA-01
-- only with "Manager-equivalent permission" — that explicit permission is
-- audit_area_review_permission (granted by the Manager, per engagement):
--   • prepare            — retain / remove / restore / add areas, assertions,
--                          attention, signal links, amounts, evidence;
--   • manager_equivalent — also completes AA-01, reopens, refreshes the
--                          library, resolves Requires Review and answers EP
--                          challenges.
-- The 03.5 write policies widen from "lead" to "lead OR holds the grant"
-- (hsdg.has_area_review_grant, SECURITY DEFINER, still requires membership).
-- The service enforces the finer matrix (the EP comments / challenges /
-- requests reassessment but does not prepare unless acting as Manager).
--
-- §27 EP REVIEW. Comment kinds gain 'downstream_request' (§25 "03.6
-- identifies an affected area not present → allow return / addition to
-- 03.5"): raised from the Section 04 risk register by the team, it names the
-- missing area and the risk; open challenges / reassessment requests /
-- downstream requests keep 03.5 in Requires Review (VAL-09) and a completed
-- 03.5 becomes Update Required. Notifications tell the Manager.
--
-- §28 EVIDENCE. Supporting schedules link to an Audit Area and, where
-- useful, an assertion: two new audit_planning_evidence targets.
--
-- §4 / §7 LIBRARY. Releases gain a draft → released lifecycle (the Audit
-- Area Library admin edits a draft copy and publishes it; released content is
-- immutable — trigger). Condition keys gain caro_applicable, ifc_applicable
-- and ind_as_transition. Release dhvaj-gc-2026.2 = 2026.1 + Ind AS-only areas
-- + the first industry areas (PROVISIONAL — DHVAJ to confirm, like 2026.1).
--
-- §24 LINEAGE. Risks, procedures and work areas reference the engagement
-- Audit Area structurally (audit_area_id) and risks / procedures carry the
-- canonical SA 315 assertion ids (assertion_ids); §9.1 removal is blocked
-- while downstream work references the area. Backfilled from the existing
-- 'area:<id>' risk source keys and 'planning:03.5' work areas.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── §27 explicit 03.5 permission ──────────────────────────────────────────
CREATE TABLE hsdg.audit_area_review_permission (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  employee_id            uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  level                  text NOT NULL CHECK (level IN ('prepare','manager_equivalent')),
  note                   text CHECK (note IS NULL OR length(note) <= 500),
  granted_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  granted_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, employee_id)
);
CREATE INDEX audit_area_review_permission_employee_idx
  ON hsdg.audit_area_review_permission (employee_id);
ALTER TABLE hsdg.audit_area_review_permission ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_area_review_permission_select ON hsdg.audit_area_review_permission
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_area_review_permission_insert ON hsdg.audit_area_review_permission
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_area_review_permission_update ON hsdg.audit_area_review_permission
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_area_review_permission_delete ON hsdg.audit_area_review_permission
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- The caller holds a 03.5 grant of at least `p_level` on the engagement and is
-- still on its team (a grant outlives nothing: leaving the team ends it).
CREATE OR REPLACE FUNCTION hsdg.has_area_review_grant(eng_id uuid, p_level text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_employee_id() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM hsdg.audit_area_review_permission p
        WHERE p.engagement_id = eng_id AND p.employee_id = hsdg.ctx_employee_id()
          AND (p_level = 'prepare' OR p.level = 'manager_equivalent'))
     AND hsdg.is_engagement_member(eng_id)
$$;

-- §25 — any team member's downstream request (or an upstream change seen by a
-- non-lead) turns a COMPLETED 03.5 into Update Required. The member may not
-- update the review row itself, so this narrow transition runs as definer:
-- it only ever moves complete → update_required and rolls the 03 checklist
-- row back to needs_attention. Returns whether it changed anything.
CREATE OR REPLACE FUNCTION hsdg.flag_area_review_update_required(p_review_id uuid, p_reason text)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  r record;
BEGIN
  SELECT id, engagement_id, workflow_instance_id INTO r
    FROM hsdg.audit_area_review WHERE id = p_review_id AND status = 'complete' FOR UPDATE;
  IF NOT FOUND OR NOT hsdg.is_engagement_member(r.engagement_id) THEN
    RETURN false;
  END IF;
  UPDATE hsdg.audit_area_review
     SET status = 'update_required', update_reason = p_reason, version = version + 1
   WHERE id = r.id;
  UPDATE hsdg.audit_planning_items
     SET state = 'needs_attention', version = version + 1
   WHERE workflow_instance_id = r.workflow_instance_id
     AND item_key = 'areas_and_assertions' AND state = 'complete';
  RETURN true;
END
$$;

-- 03.5 engagement tables: lead OR grant holder writes (members still read).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_area_review','audit_engagement_area','audit_area_assertion',
                           'audit_area_signal_link','audit_area_specific_link',
                           'audit_area_signal_resolution']
  LOOP
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_update', t);
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_delete', t);
    EXECUTE format($p$CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (
        hsdg.is_engagement_lead(engagement_id) OR hsdg.has_area_review_grant(engagement_id, 'prepare'))$p$,
      t || '_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (
        hsdg.is_engagement_lead(engagement_id) OR hsdg.has_area_review_grant(engagement_id, 'prepare'))
      WITH CHECK (
        hsdg.is_engagement_lead(engagement_id) OR hsdg.has_area_review_grant(engagement_id, 'prepare'))$p$,
      t || '_update', t);
    EXECUTE format($p$CREATE POLICY %I ON hsdg.%I FOR DELETE USING (
        hsdg.is_engagement_lead(engagement_id) OR hsdg.has_area_review_grant(engagement_id, 'prepare'))$p$,
      t || '_delete', t);
  END LOOP;
END $$;

-- Matrix snapshots: generated by AA-01 — the Manager or a Manager-equivalent grant.
DROP POLICY audit_area_matrix_version_insert ON hsdg.audit_area_matrix_version;
CREATE POLICY audit_area_matrix_version_insert ON hsdg.audit_area_matrix_version
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR hsdg.has_area_review_grant(engagement_id, 'manager_equivalent'));

-- ── §27 / §25 review comments ─────────────────────────────────────────────
ALTER TABLE hsdg.audit_area_review_comment
  DROP CONSTRAINT audit_area_review_comment_kind_check;
ALTER TABLE hsdg.audit_area_review_comment
  ADD CONSTRAINT audit_area_review_comment_kind_check CHECK (kind IN
    ('comment','challenge','reassessment_request','downstream_request')),
  -- 'downstream_request': the area the risk work needs and where it came from.
  ADD COLUMN proposed_area_name text CHECK (proposed_area_name IS NULL OR
                                            length(trim(proposed_area_name)) BETWEEN 1 AND 200),
  ADD COLUMN source_module text CHECK (source_module IS NULL OR source_module IN ('03.6','section_04')),
  ADD COLUMN source_risk_id uuid REFERENCES hsdg.audit_risks (id) ON DELETE SET NULL,
  -- The Audit Area that answered a downstream request (added / restored).
  ADD COLUMN resolved_area_id uuid REFERENCES hsdg.audit_engagement_area (id) ON DELETE SET NULL,
  ADD COLUMN responded_at timestamptz,
  ADD CONSTRAINT audit_area_review_comment_downstream_shape CHECK (
    kind <> 'downstream_request' OR proposed_area_name IS NOT NULL);

DROP POLICY audit_area_review_comment_insert ON hsdg.audit_area_review_comment;
DROP POLICY audit_area_review_comment_update ON hsdg.audit_area_review_comment;
DROP POLICY audit_area_review_comment_delete ON hsdg.audit_area_review_comment;
-- The EP (a lead) comments / challenges / requests reassessment; any team
-- member may raise a downstream request from the risk work.
CREATE POLICY audit_area_review_comment_insert ON hsdg.audit_area_review_comment
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id) AND kind = 'downstream_request'
        AND created_by_employee_id = hsdg.ctx_employee_id()));
-- The Manager (or a Manager-equivalent grant) answers.
CREATE POLICY audit_area_review_comment_update ON hsdg.audit_area_review_comment
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR hsdg.has_area_review_grant(engagement_id, 'manager_equivalent'))
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR hsdg.has_area_review_grant(engagement_id, 'manager_equivalent'));
CREATE POLICY audit_area_review_comment_delete ON hsdg.audit_area_review_comment
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));
CREATE INDEX audit_area_review_comment_open_idx
  ON hsdg.audit_area_review_comment (review_id) WHERE status = 'open';

-- The 03.5 checklist row rolls up for grant holders too.
DROP POLICY audit_planning_items_update ON hsdg.audit_planning_items;
CREATE POLICY audit_planning_items_update ON hsdg.audit_planning_items
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality'))
    OR (item_key = 'areas_and_assertions'
        AND hsdg.has_area_review_grant(engagement_id, 'prepare'))
  )
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality'))
    OR (item_key = 'areas_and_assertions'
        AND hsdg.has_area_review_grant(engagement_id, 'prepare'))
  );

-- ── §28 evidence on an Audit Area / assertion ─────────────────────────────
ALTER TABLE hsdg.audit_planning_evidence
  DROP CONSTRAINT audit_planning_evidence_target_type_check;
ALTER TABLE hsdg.audit_planning_evidence
  ADD CONSTRAINT audit_planning_evidence_target_type_check CHECK (target_type IN
    ('signal','change','prior_year','acceptance','discussion',
     'understanding_section','financial_dataset','analytics_exception','planning_expectation',
     'materiality_determination','materiality_adjustment','materiality_specific',
     'materiality_qualitative',
     'audit_area','area_assertion'));

-- ── notifications ─────────────────────────────────────────────────────────
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
   'planning_areas_review','planning_areas_update_required'));

-- ── §24 structural lineage: area → risk → procedure ───────────────────────
ALTER TABLE hsdg.audit_risks
  ADD COLUMN audit_area_id uuid REFERENCES hsdg.audit_engagement_area (id) ON DELETE SET NULL,
  ADD COLUMN assertion_ids text[] NOT NULL DEFAULT '{}' CHECK (assertion_ids <@ ARRAY[
    'TX_OCC','TX_COMP','TX_ACC','TX_CUTOFF','TX_CLASS','BAL_EXIST','BAL_RO','BAL_COMP','BAL_VAL',
    'PD_OCC_RO','PD_COMP','PD_CLASS_UND','PD_ACC_VAL']::text[]);
CREATE INDEX audit_risks_audit_area_idx ON hsdg.audit_risks (audit_area_id)
  WHERE audit_area_id IS NOT NULL;

ALTER TABLE hsdg.audit_procedures
  ADD COLUMN audit_area_id uuid REFERENCES hsdg.audit_engagement_area (id) ON DELETE SET NULL,
  ADD COLUMN assertion_ids text[] NOT NULL DEFAULT '{}' CHECK (assertion_ids <@ ARRAY[
    'TX_OCC','TX_COMP','TX_ACC','TX_CUTOFF','TX_CLASS','BAL_EXIST','BAL_RO','BAL_COMP','BAL_VAL',
    'PD_OCC_RO','PD_COMP','PD_CLASS_UND','PD_ACC_VAL']::text[]);
CREATE INDEX audit_procedures_audit_area_idx ON hsdg.audit_procedures (audit_area_id)
  WHERE audit_area_id IS NOT NULL;

ALTER TABLE hsdg.audit_work_areas
  ADD COLUMN audit_area_id uuid REFERENCES hsdg.audit_engagement_area (id) ON DELETE SET NULL;
CREATE INDEX audit_work_areas_audit_area_idx ON hsdg.audit_work_areas (audit_area_id)
  WHERE audit_area_id IS NOT NULL;

-- Backfill (the migrator owns these ENABLE-RLS tables, so RLS does not apply).
UPDATE hsdg.audit_risks r
   SET audit_area_id = a.id
  FROM hsdg.audit_engagement_area a
 WHERE r.audit_area_id IS NULL AND r.source_key LIKE 'area:%'
   AND a.id::text = substring(r.source_key FROM 6)
   AND a.engagement_id = r.engagement_id;

UPDATE hsdg.audit_work_areas w
   SET audit_area_id = a.id
  FROM hsdg.audit_engagement_area a
  JOIN hsdg.audit_area_review rv ON rv.id = a.review_id
 WHERE w.audit_area_id IS NULL AND w.source = 'planning:03.5'
   AND rv.workflow_instance_id = w.workflow_instance_id
   AND ((w.origin_area_key IS NOT NULL AND a.area_code = w.origin_area_key)
        OR (w.origin_area_key IS NULL AND a.area_code IS NULL AND a.area_name = w.title));

UPDATE hsdg.audit_procedures p
   SET audit_area_id = w.audit_area_id
  FROM hsdg.audit_work_areas w
 WHERE p.audit_area_id IS NULL AND p.work_area_id = w.id AND w.audit_area_id IS NOT NULL;

-- ── §4 / §7 Audit Area Library lifecycle ──────────────────────────────────
ALTER TABLE hsdg.audit_area_library_release
  ADD COLUMN status text NOT NULL DEFAULT 'released' CHECK (status IN ('draft','released')),
  ADD COLUMN based_on text REFERENCES hsdg.audit_area_library_release (library_version),
  ADD COLUMN created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN released_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  -- Kept DEFAULT now(): a plain insert is a released row; a draft inserts NULL.
  ALTER COLUMN released_at DROP NOT NULL;
ALTER TABLE hsdg.audit_area_library_release
  ADD CONSTRAINT audit_area_library_release_lifecycle CHECK (
    (status = 'released') = (released_at IS NOT NULL));
-- At most one draft at a time (the admin edits one copy and publishes it).
CREATE UNIQUE INDEX audit_area_library_release_one_draft
  ON hsdg.audit_area_library_release ((true)) WHERE status = 'draft';

ALTER TABLE hsdg.audit_area_library
  DROP CONSTRAINT audit_area_library_condition_key_check;
ALTER TABLE hsdg.audit_area_library
  ADD CONSTRAINT audit_area_library_condition_key_check CHECK (condition_key IS NULL OR condition_key IN
    ('cfs_applicable','initial_audit','caro_applicable','ifc_applicable','ind_as_transition')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE hsdg.audit_area_library
  ADD CONSTRAINT audit_area_library_industry_key CHECK (industry_profile ~ '^[a-z][a-z0-9_]{1,40}$');

-- Released content is immutable; a draft is edited until published (once).
CREATE OR REPLACE FUNCTION hsdg.audit_area_library_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM hsdg.audit_area_library_release
   WHERE library_version = COALESCE(NEW.library_version, OLD.library_version);
  IF st = 'released' THEN
    RAISE EXCEPTION 'Audit Area Library % is released and cannot be changed — clone a draft.',
      COALESCE(NEW.library_version, OLD.library_version) USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.library_version <> OLD.library_version THEN
    RAISE EXCEPTION 'A library row cannot move between versions.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER audit_area_library_guard
  BEFORE INSERT OR UPDATE ON hsdg.audit_area_library
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_area_library_guard();

CREATE OR REPLACE FUNCTION hsdg.audit_area_library_release_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF OLD.status = 'released' THEN
    RAISE EXCEPTION 'Audit Area Library % is released and cannot be changed.', OLD.library_version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_area_library_release_guard
  BEFORE UPDATE ON hsdg.audit_area_library_release
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_area_library_release_guard();

-- ── Release dhvaj-gc-2026.2 (PROVISIONAL content — DHVAJ to confirm) ───────
ALTER TABLE hsdg.audit_assertion            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library_release NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.audit_area_library_release (library_version, status, released_at, based_on, note)
VALUES ('dhvaj-gc-2026.2', 'draft', NULL, 'dhvaj-gc-2026.1',
        'Adds Ind AS-only areas (OCI, Ind AS 101 transition) and the first industry areas (NBFC, construction, manufacturing, trading, services, Section 8). PROVISIONAL — DHVAJ methodology to confirm.');

INSERT INTO hsdg.audit_area_library
  (library_version, sort_order, area_code, area_name, area_type, category, framework_profile,
   industry_profile, condition_key, default_assertions, non_assertion_workstream, default_attention,
   related_authorities, signal_mapping_tags, metric_keys, indicator_tags, assertion_attention_rules,
   aliases, effective_from, effective_to, active)
SELECT 'dhvaj-gc-2026.2', sort_order, area_code, area_name, area_type, category, framework_profile,
       industry_profile, condition_key, default_assertions, non_assertion_workstream, default_attention,
       related_authorities, signal_mapping_tags, metric_keys, indicator_tags, assertion_attention_rules,
       aliases, effective_from, effective_to, active
  FROM hsdg.audit_area_library WHERE library_version = 'dhvaj-gc-2026.1';

INSERT INTO hsdg.audit_area_library
  (library_version, sort_order, area_code, area_name, area_type, category, framework_profile,
   industry_profile, condition_key, default_assertions, metric_keys, signal_mapping_tags,
   indicator_tags, related_authorities, aliases, assertion_attention_rules)
SELECT 'dhvaj-gc-2026.2', v.ord, v.code, v.name, v.atype, v.cat, v.frf, v.ind, v.cond,
       v.asr, v.metrics, v.tags, v.itags, v.auth, v.aliases, v.rules::jsonb
FROM (VALUES
  -- Ind AS only
  (55,'OCI','Other Comprehensive Income','disclosure','disclosure_cross_cutting','ind_as','general_corporate',NULL,
     ARRAY['TX_OCC','TX_CLASS','PD_CLASS_UND','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['other comprehensive income','oci','remeasurement','fvoci'],
     ARRAY['statutory'],ARRAY['INDAS_1','INDAS_19','INDAS_109'],ARRAY['oci','other comprehensive income','items that will not be reclassified'],'[]'),
  (56,'INDAS101','First-time Ind AS Adoption (Ind AS 101)','cross_cutting','disclosure_cross_cutting','ind_as','general_corporate','ind_as_transition',
     ARRAY['BAL_EXIST','BAL_VAL','PD_COMP','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['first-time adoption','ind as 101','transition','first_time_ind_as'],
     ARRAY['statutory'],ARRAY['INDAS_101'],ARRAY['ind as transition','first time adoption','previous gaap reconciliation'],'[]'),
  -- Industry areas
  (60,'NBFCLOANS','Loans & Advances — NBFC (ECL / Asset Classification)','balance_sheet','assets','both','nbfc',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_VAL','PD_CLASS_UND','PD_ACC_VAL'],ARRAY['loan_book','gross_npa'],ARRAY['loan','npa','stage 3','ecl','provisioning','asset classification'],
     ARRAY['statutory'],ARRAY['INDAS_109','RBI_NBFC_SBR'],ARRAY['loan book','loans and advances','loan portfolio'],
     '[{"scenario":"Asset quality deterioration","tags":["npa","stage 3","ecl"],"assertions":["BAL_VAL","PD_ACC_VAL"]}]'),
  (61,'NBFCREG','RBI Prudential Norms & Regulatory Ratios','cross_cutting','disclosure_cross_cutting','both','nbfc',NULL,
     ARRAY['PD_COMP','PD_ACC_VAL'],ARRAY['capital_adequacy'],ARRAY['rbi','crar','capital adequacy','prudential','scale based'],
     ARRAY['statutory'],ARRAY['RBI_NBFC_SBR'],ARRAY['crar','capital adequacy','prudential norms'],'[]'),
  (62,'CONTRACTS','Construction Contracts & Contract Balances','balance_sheet','assets','both','construction',NULL,
     ARRAY['TX_OCC','TX_CUTOFF','BAL_EXIST','BAL_VAL','PD_ACC_VAL'],ARRAY['contract_assets','contract_liabilities','retention_receivables'],ARRAY['contract','percentage of completion','cost to complete','retention','order book'],
     ARRAY[]::text[],ARRAY['AS_7','INDAS_115'],ARRAY['contract assets','contract liabilities','work in progress','retention money'],
     '[{"scenario":"Estimate of cost to complete","tags":["cost to complete","percentage of completion"],"assertions":["TX_ACC","BAL_VAL"]}]'),
  (63,'PRODCOST','Production Costing & Overhead Absorption','profit_loss','income_expenses','both','manufacturing',NULL,
     ARRAY['TX_ACC','TX_CLASS','BAL_VAL'],ARRAY['inventory_raw_materials','inventory_finished_goods'],ARRAY['costing','overhead','absorption','standard cost','capacity'],
     ARRAY[]::text[],ARRAY['AS_2'],ARRAY['cost of production','overhead absorption','standard costing'],'[]'),
  (64,'SCHEMES','Trade Schemes, Discounts & Rebates','profit_loss','income_expenses','both','trading',NULL,
     ARRAY['TX_OCC','TX_ACC','TX_CUTOFF','BAL_COMP'],ARRAY[]::text[],ARRAY['scheme','rebate','discount','incentive','credit note'],
     ARRAY[]::text[],ARRAY['AS_9','INDAS_115'],ARRAY['trade discounts','dealer schemes','volume rebates'],'[]'),
  (65,'UNBILLED','Unbilled Revenue & Contract Balances','balance_sheet','assets','both','services',NULL,
     ARRAY['TX_OCC','TX_CUTOFF','BAL_EXIST','BAL_VAL'],ARRAY['unbilled_revenue'],ARRAY['unbilled','accrued revenue','milestone','time and material'],
     ARRAY[]::text[],ARRAY['AS_9','INDAS_115'],ARRAY['unbilled revenue','accrued income','contract assets'],'[]'),
  (66,'RESTFUNDS','Restricted Funds, Grants & Section 8 Compliance','balance_sheet','liabilities_equity','both','section8',NULL,
     ARRAY['TX_OCC','BAL_RO','BAL_COMP','PD_COMP'],ARRAY['restricted_funds','grants_received'],ARRAY['restricted','earmarked','donation','section 8','utilisation'],
     ARRAY['statutory'],ARRAY['COS_ACT_8','AS_12'],ARRAY['earmarked funds','restricted grants','donations'],'[]')
) AS v(ord, code, name, atype, cat, frf, ind, cond, asr, metrics, tags, itags, auth, aliases, rules);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM hsdg.audit_area_library l, unnest(l.default_assertions) a
     WHERE l.library_version = 'dhvaj-gc-2026.2'
       AND NOT EXISTS (SELECT 1 FROM hsdg.audit_assertion x WHERE x.id = a)
  ) THEN
    RAISE EXCEPTION 'audit_area_library 2026.2 seed references an unknown assertion id';
  END IF;
END $$;

UPDATE hsdg.audit_area_library_release
   SET status = 'released', released_at = now()
 WHERE library_version = 'dhvaj-gc-2026.2';

ALTER TABLE hsdg.audit_assertion            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library_release FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.audit_area_library         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library_release NO FORCE ROW LEVEL SECURITY;

-- Refuse (clearly) once engagements are populated from a library version this
-- migration introduced: their areas reference its rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM hsdg.audit_engagement_area a
               JOIN hsdg.audit_area_library l ON l.id = a.source_audit_area_id
              WHERE l.library_version <> 'dhvaj-gc-2026.1'
                AND l.library_version IN (SELECT library_version FROM hsdg.audit_area_library_release
                                           WHERE library_version = 'dhvaj-gc-2026.2' OR status = 'draft'
                                              OR based_on IS NOT NULL)) THEN
    RAISE EXCEPTION 'Engagement 03.5 areas use an Audit Area Library version added after 2026.1; '
                    'migrate those reviews back before reverting 1768800000000.';
  END IF;
END $$;
DROP TRIGGER IF EXISTS audit_area_library_guard ON hsdg.audit_area_library;
DROP TRIGGER IF EXISTS audit_area_library_release_guard ON hsdg.audit_area_library_release;
DROP FUNCTION IF EXISTS hsdg.audit_area_library_guard();
DROP FUNCTION IF EXISTS hsdg.audit_area_library_release_guard();
-- Engagements that moved to a later library return to 2026.1.
UPDATE hsdg.audit_area_review SET library_version = 'dhvaj-gc-2026.1'
 WHERE library_version <> 'dhvaj-gc-2026.1';
UPDATE hsdg.audit_engagement_area SET source_audit_area_id = NULL
 WHERE source_audit_area_id IN (SELECT id FROM hsdg.audit_area_library
                                 WHERE library_version <> 'dhvaj-gc-2026.1');
DELETE FROM hsdg.audit_area_library WHERE library_version <> 'dhvaj-gc-2026.1';
DELETE FROM hsdg.audit_area_library_release WHERE library_version <> 'dhvaj-gc-2026.1';
DROP INDEX IF EXISTS hsdg.audit_area_library_release_one_draft;
ALTER TABLE hsdg.audit_area_library_release
  DROP CONSTRAINT IF EXISTS audit_area_library_release_lifecycle,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS based_on,
  DROP COLUMN IF EXISTS created_by_employee_id,
  DROP COLUMN IF EXISTS released_by_employee_id,
  DROP COLUMN IF EXISTS created_at,
  ALTER COLUMN released_at SET DEFAULT now(),
  ALTER COLUMN released_at SET NOT NULL;
ALTER TABLE hsdg.audit_area_library
  DROP CONSTRAINT IF EXISTS audit_area_library_industry_key,
  DROP CONSTRAINT audit_area_library_condition_key_check,
  DROP COLUMN IF EXISTS updated_at;
UPDATE hsdg.audit_area_library SET condition_key = NULL
 WHERE condition_key NOT IN ('cfs_applicable','initial_audit');
ALTER TABLE hsdg.audit_area_library
  ADD CONSTRAINT audit_area_library_condition_key_check CHECK (condition_key IS NULL OR condition_key IN
    ('cfs_applicable','initial_audit'));
ALTER TABLE hsdg.audit_area_library         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library_release FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.audit_work_areas DROP COLUMN IF EXISTS audit_area_id;
ALTER TABLE hsdg.audit_procedures DROP COLUMN IF EXISTS audit_area_id, DROP COLUMN IF EXISTS assertion_ids;
ALTER TABLE hsdg.audit_risks DROP COLUMN IF EXISTS audit_area_id, DROP COLUMN IF EXISTS assertion_ids;

DELETE FROM hsdg.notifications WHERE type IN ('planning_areas_review','planning_areas_update_required');
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

DELETE FROM hsdg.audit_planning_evidence WHERE target_type IN ('audit_area','area_assertion');
ALTER TABLE hsdg.audit_planning_evidence
  DROP CONSTRAINT audit_planning_evidence_target_type_check;
ALTER TABLE hsdg.audit_planning_evidence
  ADD CONSTRAINT audit_planning_evidence_target_type_check CHECK (target_type IN
    ('signal','change','prior_year','acceptance','discussion',
     'understanding_section','financial_dataset','analytics_exception','planning_expectation',
     'materiality_determination','materiality_adjustment','materiality_specific',
     'materiality_qualitative'));

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

DROP INDEX IF EXISTS hsdg.audit_area_review_comment_open_idx;
DELETE FROM hsdg.audit_area_review_comment WHERE kind = 'downstream_request';
ALTER TABLE hsdg.audit_area_review_comment
  DROP CONSTRAINT IF EXISTS audit_area_review_comment_downstream_shape,
  DROP COLUMN IF EXISTS proposed_area_name,
  DROP COLUMN IF EXISTS source_module,
  DROP COLUMN IF EXISTS source_risk_id,
  DROP COLUMN IF EXISTS resolved_area_id,
  DROP COLUMN IF EXISTS responded_at,
  DROP CONSTRAINT audit_area_review_comment_kind_check;
ALTER TABLE hsdg.audit_area_review_comment
  ADD CONSTRAINT audit_area_review_comment_kind_check CHECK (kind IN
    ('comment','challenge','reassessment_request'));

DROP POLICY audit_area_matrix_version_insert ON hsdg.audit_area_matrix_version;
CREATE POLICY audit_area_matrix_version_insert ON hsdg.audit_area_matrix_version
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_area_review','audit_engagement_area','audit_area_assertion',
                           'audit_area_signal_link','audit_area_specific_link',
                           'audit_area_signal_resolution','audit_area_review_comment']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON hsdg.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON hsdg.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON hsdg.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR DELETE USING (hsdg.is_engagement_lead(engagement_id))', t || '_delete', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS hsdg.flag_area_review_update_required(uuid, text);
DROP FUNCTION IF EXISTS hsdg.has_area_review_grant(uuid, text);
DROP TABLE IF EXISTS hsdg.audit_area_review_permission CASCADE;

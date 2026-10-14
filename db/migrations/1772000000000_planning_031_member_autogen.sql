-- ─────────────────────────────────────────────────────────────────────────────
-- 03.1 Planning Intelligence — whoever opens 03.1 first gets it generated
-- (DHVAJ 03.1 §22: "opening 03.1 after Section 02 approval auto-generates the
-- Engagement Intelligence").
--
-- 02.8 AF-02 already generates 03.1 as the approving Engagement Partner. A file
-- approved before that change has no intelligence yet, and its generation
-- writes lead-only tables, so an engagement team member who opened 03.1 first
-- was refused ("03.1 has not been opened yet").
--
-- Deriving the intelligence is a SYSTEM step, not a professional judgment: it
-- records the 03.1 file, upserts the library-derived signals (never the
-- Manager's attention, assessment, owner or status), syncs the strategic
-- considerations, flags 03.5 / the Phase 03 checklist and brings last year's
-- matters forward. Rather than widening these policies to every member, the API
-- raises a transaction-local flag `hsdg.planning_autogen = <engagement id>`
-- around that one step only, and the write policies below also admit an
-- engagement MEMBER while the flag names that engagement. Only the API sets
-- GUCs (set_config, transaction-local, like the acting user's context); it
-- clears the flag as soon as the step ends, and an error rolls it back with the
-- transaction. Every other team write keeps its lead-only policy and the §23
-- capability guard.
-- ─────────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.ctx_planning_autogen(eng uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('hsdg.planning_autogen', true), '') = eng::text
     AND hsdg.is_engagement_member(eng)
$$;
REVOKE EXECUTE ON FUNCTION hsdg.ctx_planning_autogen(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_planning_autogen(uuid) TO hsdg_app;

ALTER POLICY audit_planning_intelligence_insert ON hsdg.audit_planning_intelligence
  WITH CHECK (hsdg.is_engagement_lead(engagement_id) OR hsdg.ctx_planning_autogen(engagement_id));
ALTER POLICY audit_planning_intelligence_update ON hsdg.audit_planning_intelligence
  USING (hsdg.is_engagement_lead(engagement_id) OR hsdg.ctx_planning_autogen(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id) OR hsdg.ctx_planning_autogen(engagement_id));

ALTER POLICY audit_planning_signal_insert ON hsdg.audit_planning_signal
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.ctx_planning_autogen(engagement_id) AND is_auto AND manager_assessment IS NULL)
    OR (hsdg.is_engagement_member(engagement_id)
        AND proposed_by_employee_id = hsdg.ctx_employee_id()
        AND manager_assessment IS NULL));
ALTER POLICY audit_planning_signal_update ON hsdg.audit_planning_signal
  USING (hsdg.is_engagement_lead(engagement_id)
         OR (hsdg.ctx_planning_autogen(engagement_id) AND is_auto))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id)
              OR (hsdg.ctx_planning_autogen(engagement_id) AND is_auto));

ALTER POLICY audit_planning_consideration_insert ON hsdg.audit_planning_consideration
  WITH CHECK (hsdg.is_engagement_lead(engagement_id) OR hsdg.ctx_planning_autogen(engagement_id));
ALTER POLICY audit_planning_consideration_update ON hsdg.audit_planning_consideration
  USING (hsdg.is_engagement_lead(engagement_id) OR hsdg.ctx_planning_autogen(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id) OR hsdg.ctx_planning_autogen(engagement_id));

-- 03.5 "Update Required" and the Phase 03 checklist roll-up follow new intelligence.
-- (Each keeps the rules 1768900000000 gave it — area-review grants, member
-- roll-ups — and only gains the auto-generate step.)
ALTER POLICY audit_area_review_update ON hsdg.audit_area_review
  USING (hsdg.is_engagement_lead(engagement_id)
         OR hsdg.has_area_review_grant(engagement_id, 'prepare')
         OR hsdg.ctx_planning_autogen(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id)
              OR hsdg.has_area_review_grant(engagement_id, 'prepare')
              OR hsdg.ctx_planning_autogen(engagement_id));
ALTER POLICY audit_planning_items_update ON hsdg.audit_planning_items
  USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality','audit_approach','overall_audit_plan'))
    OR (item_key = 'areas_and_assertions'
        AND hsdg.has_area_review_grant(engagement_id, 'prepare'))
    OR hsdg.ctx_planning_autogen(engagement_id))
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality','audit_approach','overall_audit_plan'))
    OR (item_key = 'areas_and_assertions'
        AND hsdg.has_area_review_grant(engagement_id, 'prepare'))
    OR hsdg.ctx_planning_autogen(engagement_id));

-- Down Migration

ALTER POLICY audit_planning_items_update ON hsdg.audit_planning_items
  USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality','audit_approach','overall_audit_plan'))
    OR (item_key = 'areas_and_assertions'
        AND hsdg.has_area_review_grant(engagement_id, 'prepare')))
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality','audit_approach','overall_audit_plan'))
    OR (item_key = 'areas_and_assertions'
        AND hsdg.has_area_review_grant(engagement_id, 'prepare')));
ALTER POLICY audit_area_review_update ON hsdg.audit_area_review
  USING (hsdg.is_engagement_lead(engagement_id)
         OR hsdg.has_area_review_grant(engagement_id, 'prepare'))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id)
              OR hsdg.has_area_review_grant(engagement_id, 'prepare'));
ALTER POLICY audit_planning_consideration_update ON hsdg.audit_planning_consideration
  USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
ALTER POLICY audit_planning_consideration_insert ON hsdg.audit_planning_consideration
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
ALTER POLICY audit_planning_signal_update ON hsdg.audit_planning_signal
  USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
ALTER POLICY audit_planning_signal_insert ON hsdg.audit_planning_signal
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND proposed_by_employee_id = hsdg.ctx_employee_id()
        AND manager_assessment IS NULL));
ALTER POLICY audit_planning_intelligence_update ON hsdg.audit_planning_intelligence
  USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
ALTER POLICY audit_planning_intelligence_insert ON hsdg.audit_planning_intelligence
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

DROP FUNCTION hsdg.ctx_planning_autogen(uuid);

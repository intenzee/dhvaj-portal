-- ─────────────────────────────────────────────────────────────────────────
-- GST months without a GSTIN take the client's return marks
--
-- A GST engagement can now be opened before the client's GSTIN is on file:
-- its months are built on "registration pending" (registration_id NULL) and
-- move onto the GSTIN when it is added. The firm's GST sheet keeps marks for
-- such clients too — on the client alone, or on the state in its name
-- (client_return_marks.registration_id NULL). Until now a mark closed only a
-- filing on its GSTIN, so those months showed overdue although the sheet says
-- filed.
--
-- Now a pending filing takes the client's GSTIN-less mark (the client-wide
-- one first, then a state's), the same way a GSTIN's filing takes its own.
-- When the GSTIN arrives the filing moves onto it and its marks apply as
-- before.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- The owner reads which client a pending filing's engagement is for, only
-- while apply_return_marks has said so for its transaction.
CREATE POLICY engagements_return_marks_select ON hsdg.engagements
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.applying_return_marks', true) = 'on');

CREATE OR REPLACE FUNCTION hsdg.apply_return_marks(p_ids uuid[])
  RETURNS TABLE (filing_id uuid, applied_mark text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
#variable_conflict use_column
DECLARE
  f record;
  why text;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN; END IF;
  PERFORM set_config('hsdg.applying_return_marks', 'on', true);
  FOR f IN
    SELECT ci.id, ci.status, mk.mark, mk.source_sheet, mk.source_row
      FROM hsdg.compliance_instances ci
      JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
      JOIN hsdg.engagements e ON e.id = ci.engagement_id
      CROSS JOIN LATERAL (
        SELECT m.mark, m.source_sheet, m.source_row
          FROM hsdg.client_return_marks m
         WHERE (m.registration_id = ci.registration_id
                OR (ci.registration_id IS NULL AND m.registration_id IS NULL
                    AND m.entity_id = e.entity_id))
           AND m.return_form = hsdg.return_form_of_rule(r.code)
           AND m.period_key IN (ci.period_key, hsdg.return_period_month(ci.period_key))
         ORDER BY (m.period_key = ci.period_key) DESC, m.state_code NULLS FIRST
         LIMIT 1) mk
     WHERE ci.id = ANY (p_ids)
       AND ((ci.status = 'open'
             AND COALESCE(ci.workflow_status, '') NOT IN ('filed', 'not_applicable'))
         OR (ci.status = 'waived' AND ci.notes LIKE '[removed]%' AND mk.mark = 'filed'))
     ORDER BY ci.id
     FOR UPDATE OF ci
  LOOP
    why := 'Marked ' || CASE f.mark WHEN 'filed' THEN 'filed' ELSE 'NA' END
        || ' in the firm''s GST sheet'
        || CASE WHEN f.source_sheet IS NULL THEN ''
                ELSE format(' (%s, row %s)', btrim(f.source_sheet), f.source_row) END
        || '.';
    -- compliance_instances_sync_status sets status and completed_at to match.
    UPDATE hsdg.compliance_instances
       SET workflow_status = CASE f.mark WHEN 'filed' THEN 'filed' ELSE 'not_applicable' END,
           completed_by_employee_id = CASE f.mark WHEN 'filed' THEN hsdg.ctx_employee_id()
                                                 ELSE completed_by_employee_id END,
           notes = CASE f.mark
                     WHEN 'filed' THEN NULLIF(regexp_replace(COALESCE(notes, ''),
                                                             '^\[removed\][^\n]*\n?', ''), '')
                     ELSE why END,
           version = version + 1
     WHERE id = f.id;
    INSERT INTO hsdg.audit_events
      (actor_user_id, actor_role, action, object_type, object_id, before_state, after_state, reason)
    VALUES (hsdg.ctx_user_id(), hsdg.ctx_role(),
            CASE f.mark WHEN 'filed' THEN 'compliance.instance_completed'
                        ELSE 'compliance.instance_waived' END,
            'compliance_instance', f.id::text,
            jsonb_build_object('status', f.status),
            jsonb_build_object('status', CASE f.mark WHEN 'filed' THEN 'completed' ELSE 'waived' END),
            why);
    filing_id := f.id;
    applied_mark := f.mark;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('hsdg.applying_return_marks', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.apply_return_marks(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.apply_return_marks(uuid[]) TO hsdg_app;

-- A pending filing (no GSTIN yet) takes its mark on creation too.
DROP TRIGGER IF EXISTS compliance_instances_apply_marks ON hsdg.compliance_instances;
CREATE TRIGGER compliance_instances_apply_marks
  AFTER INSERT OR UPDATE OF registration_id, period_key ON hsdg.compliance_instances
  FOR EACH ROW
  WHEN (NEW.period_key IS NOT NULL AND NEW.status = 'open')
  EXECUTE FUNCTION hsdg.compliance_instances_apply_marks();

-- Down Migration

DROP TRIGGER IF EXISTS compliance_instances_apply_marks ON hsdg.compliance_instances;
CREATE TRIGGER compliance_instances_apply_marks
  AFTER INSERT OR UPDATE OF registration_id, period_key ON hsdg.compliance_instances
  FOR EACH ROW
  WHEN (NEW.registration_id IS NOT NULL AND NEW.period_key IS NOT NULL AND NEW.status = 'open')
  EXECUTE FUNCTION hsdg.compliance_instances_apply_marks();

CREATE OR REPLACE FUNCTION hsdg.apply_return_marks(p_ids uuid[])
  RETURNS TABLE (filing_id uuid, applied_mark text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
#variable_conflict use_column
DECLARE
  f record;
  why text;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN; END IF;
  PERFORM set_config('hsdg.applying_return_marks', 'on', true);
  FOR f IN
    SELECT ci.id, ci.status, mk.mark, mk.source_sheet, mk.source_row
      FROM hsdg.compliance_instances ci
      JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
      CROSS JOIN LATERAL (
        SELECT m.mark, m.source_sheet, m.source_row
          FROM hsdg.client_return_marks m
         WHERE m.registration_id = ci.registration_id
           AND m.return_form = hsdg.return_form_of_rule(r.code)
           AND m.period_key IN (ci.period_key, hsdg.return_period_month(ci.period_key))
         ORDER BY (m.period_key = ci.period_key) DESC
         LIMIT 1) mk
     WHERE ci.id = ANY (p_ids)
       AND ((ci.status = 'open'
             AND COALESCE(ci.workflow_status, '') NOT IN ('filed', 'not_applicable'))
         OR (ci.status = 'waived' AND ci.notes LIKE '[removed]%' AND mk.mark = 'filed'))
     ORDER BY ci.id
     FOR UPDATE OF ci
  LOOP
    why := 'Marked ' || CASE f.mark WHEN 'filed' THEN 'filed' ELSE 'NA' END
        || ' in the firm''s GST sheet'
        || CASE WHEN f.source_sheet IS NULL THEN ''
                ELSE format(' (%s, row %s)', btrim(f.source_sheet), f.source_row) END
        || '.';
    UPDATE hsdg.compliance_instances
       SET workflow_status = CASE f.mark WHEN 'filed' THEN 'filed' ELSE 'not_applicable' END,
           completed_by_employee_id = CASE f.mark WHEN 'filed' THEN hsdg.ctx_employee_id()
                                                 ELSE completed_by_employee_id END,
           notes = CASE f.mark
                     WHEN 'filed' THEN NULLIF(regexp_replace(COALESCE(notes, ''),
                                                             '^\[removed\][^\n]*\n?', ''), '')
                     ELSE why END,
           version = version + 1
     WHERE id = f.id;
    INSERT INTO hsdg.audit_events
      (actor_user_id, actor_role, action, object_type, object_id, before_state, after_state, reason)
    VALUES (hsdg.ctx_user_id(), hsdg.ctx_role(),
            CASE f.mark WHEN 'filed' THEN 'compliance.instance_completed'
                        ELSE 'compliance.instance_waived' END,
            'compliance_instance', f.id::text,
            jsonb_build_object('status', f.status),
            jsonb_build_object('status', CASE f.mark WHEN 'filed' THEN 'completed' ELSE 'waived' END),
            why);
    filing_id := f.id;
    applied_mark := f.mark;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('hsdg.applying_return_marks', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.apply_return_marks(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.apply_return_marks(uuid[]) TO hsdg_app;

DROP POLICY IF EXISTS engagements_return_marks_select ON hsdg.engagements;

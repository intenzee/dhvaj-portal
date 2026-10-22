-- ─────────────────────────────────────────────────────────────────────────
-- The client's GST return history closes the engagement's months
--
-- The firm's GST sheet marks each GSTIN's GSTR-1 / 3B / 7 filed or NA by
-- month (hsdg.client_return_marks). Until now a mark closed a filing only
-- when the sheet was imported, only if the filing already existed then, and
-- only where the importer led the engagement — so a calendar generated later
-- (or led by someone else) showed months the client had filed as overdue.
--
-- Now a mark is the firm's record of the return and applies wherever its
-- filing is:
--   • hsdg.apply_return_marks(ids) closes the open filings a mark covers —
--     filed → Filed, NA → Not applicable — and audits each. The month's
--     inward reconciliation follows its GSTR-3B. A quarterly filing takes
--     the quarter's mark, else its last month's. A month removed from the
--     portal ("[removed]", NA) that the client filed becomes Filed.
--   • A filing created (or moved onto a GSTIN / period) picks up its mark at
--     once — unless the import is applying marks itself and counting them.
--   • Existing filings are brought in line below.
-- Filings already lodged in the portal, or retired by the generator, are
-- left alone.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- The owner applies marks across engagements, and only while
-- apply_return_marks has said so for its transaction.
CREATE POLICY compliance_instances_return_marks_select ON hsdg.compliance_instances
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.applying_return_marks', true) = 'on');
CREATE POLICY compliance_instances_return_marks_update ON hsdg.compliance_instances
  FOR UPDATE TO hsdg_migrator
  USING (current_setting('hsdg.applying_return_marks', true) = 'on')
  WITH CHECK (current_setting('hsdg.applying_return_marks', true) = 'on');
CREATE POLICY compliance_rules_return_marks_select ON hsdg.compliance_rules
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.applying_return_marks', true) = 'on');
CREATE POLICY audit_events_return_marks_insert ON hsdg.audit_events
  FOR INSERT TO hsdg_migrator
  WITH CHECK (current_setting('hsdg.applying_return_marks', true) = 'on');

/** The sheet's return form a GST rule answers to; the reconciliation is the 3B's. */
CREATE OR REPLACE FUNCTION hsdg.return_form_of_rule(p_code text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_code IN ('GST_GSTR1_M', 'GST_GSTR1_Q') THEN 'GSTR1'
    WHEN p_code IN ('GST_GSTR3B_M', 'GST_GSTR3B_Q', 'GST_ITC_RECON_M', 'GST_ITC_RECON_Q')
      THEN 'GSTR3B'
    WHEN p_code = 'GST_GSTR7' THEN 'GSTR7'
  END
$$;

/** '2026-27:Q1' → '2026-06', the quarter's last month; any other key is itself. */
CREATE OR REPLACE FUNCTION hsdg.return_period_month(p_key text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_key ~ '^[0-9]{4}-[0-9]{2}:Q[1-4]$'
    THEN to_char(make_date(left(p_key, 4)::int, 4, 1)
                 + make_interval(months => 3 * right(p_key, 1)::int - 1), 'YYYY-MM')
    ELSE p_key END
$$;

/** Close the open filings among p_ids that a client mark covers. Returns those closed. */
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

/**
 * The GST filings of these GSTINs that the client's marks may close, for the
 * import to match its sheet against: every engagement's, not only those the
 * importer is on — but only for clients whose logins they may manage.
 */
CREATE OR REPLACE FUNCTION hsdg.return_mark_filings(p_registration_ids uuid[])
  RETURNS TABLE (id uuid, registration_id uuid, code text, period_key text, status text,
                 workflow_status text, removed boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
#variable_conflict use_column
BEGIN
  PERFORM set_config('hsdg.applying_return_marks', 'on', true);
  RETURN QUERY
    SELECT ci.id, ci.registration_id, r.code, ci.period_key, ci.status, ci.workflow_status,
           (ci.status = 'waived' AND COALESCE(ci.notes, '') LIKE '[removed]%')
      FROM hsdg.compliance_instances ci
      JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
     WHERE ci.registration_id = ANY (p_registration_ids)
       AND hsdg.return_form_of_rule(r.code) IS NOT NULL
       AND EXISTS (SELECT 1 FROM hsdg.client_return_marks m
                    WHERE m.registration_id = ci.registration_id
                      AND hsdg.ctx_can_manage_credentials(m.entity_id));
  PERFORM set_config('hsdg.applying_return_marks', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.return_mark_filings(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.return_mark_filings(uuid[]) TO hsdg_app;

-- A filing created, or moved onto a GSTIN or period, takes its mark at once.
-- The import applies (and counts) marks itself while it says so.
CREATE OR REPLACE FUNCTION hsdg.compliance_instances_apply_marks() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('hsdg.deferring_return_marks', true) = 'on' THEN RETURN NULL; END IF;
  PERFORM hsdg.apply_return_marks(ARRAY[NEW.id]);
  RETURN NULL;
END $$;
CREATE TRIGGER compliance_instances_apply_marks
  AFTER INSERT OR UPDATE OF registration_id, period_key ON hsdg.compliance_instances
  FOR EACH ROW
  WHEN (NEW.registration_id IS NOT NULL AND NEW.period_key IS NOT NULL AND NEW.status = 'open')
  EXECUTE FUNCTION hsdg.compliance_instances_apply_marks();

-- Bring the filings already generated in line with the marks already imported.
DO $$
BEGIN
  PERFORM set_config('hsdg.applying_return_marks', 'on', true);
  PERFORM hsdg.apply_return_marks(ARRAY(
    SELECT ci.id FROM hsdg.compliance_instances ci
     WHERE ci.registration_id IN (SELECT m.registration_id FROM hsdg.client_return_marks m
                                   WHERE m.registration_id IS NOT NULL)
       AND ci.period_key IS NOT NULL
       AND ci.status IN ('open', 'waived')));
END $$;

-- Down Migration

DROP TRIGGER IF EXISTS compliance_instances_apply_marks ON hsdg.compliance_instances;
DROP FUNCTION IF EXISTS hsdg.compliance_instances_apply_marks();
DROP FUNCTION IF EXISTS hsdg.return_mark_filings(uuid[]);
DROP FUNCTION IF EXISTS hsdg.apply_return_marks(uuid[]);
DROP FUNCTION IF EXISTS hsdg.return_period_month(text);
DROP FUNCTION IF EXISTS hsdg.return_form_of_rule(text);
DROP POLICY IF EXISTS audit_events_return_marks_insert ON hsdg.audit_events;
DROP POLICY IF EXISTS compliance_rules_return_marks_select ON hsdg.compliance_rules;
DROP POLICY IF EXISTS compliance_instances_return_marks_update ON hsdg.compliance_instances;
DROP POLICY IF EXISTS compliance_instances_return_marks_select ON hsdg.compliance_instances;

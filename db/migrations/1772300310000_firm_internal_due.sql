-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow · Questions for the partners, 1: internal due date per form
--
-- A form's internal due date is its statutory date minus a buffer, set on each
-- compliance rule version (append-only, effective by period). Partners answer
-- "GSTR-1 T-2, GSTR-3B T-3 …" for the firm, now, so the answer is a firm
-- override per rule that:
--   • every date calculation reads first (hsdg.internal_due_days), and
--   • re-dates the rule's open filings at once (those without a manual
--     internal-date override), pulled back to a working day exactly like
--     computeDeadlines (Saturday, Sunday and compliance_holidays).
-- Writes go only through hsdg.set_internal_due_days, which checks the caller is
-- the managing partner or a partner and re-dates filings on engagements they
-- may not be on.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.firm_internal_due (
  compliance_rule_id       uuid PRIMARY KEY REFERENCES hsdg.compliance_rules (id) ON DELETE CASCADE,
  internal_sla_offset_days integer NOT NULL CHECK (internal_sla_offset_days BETWEEN 0 AND 60),
  updated_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
-- ENABLE (not FORCE): the owner's set_internal_due_days below writes it;
-- the application role only reads.
ALTER TABLE hsdg.firm_internal_due ENABLE ROW LEVEL SECURITY;
CREATE POLICY firm_internal_due_read ON hsdg.firm_internal_due
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON hsdg.firm_internal_due FROM hsdg_app;

-- Re-dating reaches filings on engagements the partner is not on. The owner
-- runs it, and only while set_internal_due_days has said so for its transaction.
CREATE POLICY compliance_instances_redate_select ON hsdg.compliance_instances
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.redating_internal_due', true) = 'on');
CREATE POLICY compliance_instances_redate_update ON hsdg.compliance_instances
  FOR UPDATE TO hsdg_migrator
  USING (current_setting('hsdg.redating_internal_due', true) = 'on')
  WITH CHECK (current_setting('hsdg.redating_internal_due', true) = 'on');

/** The buffer in force for a rule: the firm's answer, else the version's. */
CREATE OR REPLACE FUNCTION hsdg.internal_due_days(p_rule uuid, p_version_days integer)
  RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT internal_sla_offset_days FROM hsdg.firm_internal_due WHERE compliance_rule_id = p_rule),
    p_version_days)
$$;

/** The date, else the working day before it (computeDeadlines' 'previous'). */
CREATE OR REPLACE FUNCTION hsdg.previous_working_day(p_date date)
  RETURNS date LANGUAGE plpgsql STABLE SET search_path = hsdg, pg_temp AS $$
DECLARE
  d date := p_date;
BEGIN
  FOR i IN 1..14 LOOP
    EXIT WHEN extract(isodow FROM d) < 6
      AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_holidays h WHERE h.holiday_date = d);
    d := d - 1;
  END LOOP;
  RETURN d;
END $$;

/** Set a form's buffer for the firm and re-date its open filings. Returns how many moved. */
CREATE OR REPLACE FUNCTION hsdg.set_internal_due_days(p_rule uuid, p_days integer)
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  moved integer;
BEGIN
  IF hsdg.ctx_role() IS NULL OR hsdg.ctx_role() NOT IN ('managing_partner', 'partner') THEN
    RAISE EXCEPTION 'Only a partner may set the firm''s internal due dates.' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 0 OR p_days > 60 THEN
    RAISE EXCEPTION 'Days before the statutory date must be 0 to 60.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hsdg.compliance_rules WHERE id = p_rule) THEN
    RAISE EXCEPTION 'Compliance rule not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO hsdg.firm_internal_due (compliance_rule_id, internal_sla_offset_days,
                                      updated_by_employee_id, updated_at)
  VALUES (p_rule, p_days, hsdg.ctx_employee_id(), now())
  ON CONFLICT (compliance_rule_id) DO UPDATE
    SET internal_sla_offset_days = EXCLUDED.internal_sla_offset_days,
        updated_by_employee_id = EXCLUDED.updated_by_employee_id,
        updated_at = now();

  PERFORM set_config('hsdg.redating_internal_due', 'on', true);
  UPDATE hsdg.compliance_instances ci
     SET internal_sla_date = hsdg.previous_working_day(ci.statutory_deadline - p_days)
   WHERE ci.compliance_rule_id = p_rule
     AND ci.status = 'open'
     AND ci.internal_sla_override IS NULL
     AND ci.internal_sla_date IS DISTINCT FROM hsdg.previous_working_day(ci.statutory_deadline - p_days);
  GET DIAGNOSTICS moved = ROW_COUNT;
  PERFORM set_config('hsdg.redating_internal_due', '', true);
  RETURN moved;
END $$;
REVOKE ALL ON FUNCTION hsdg.set_internal_due_days(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.set_internal_due_days(uuid, integer) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.set_internal_due_days(uuid, integer);
DROP FUNCTION IF EXISTS hsdg.previous_working_day(date);
DROP FUNCTION IF EXISTS hsdg.internal_due_days(uuid, integer);
DROP POLICY IF EXISTS compliance_instances_redate_update ON hsdg.compliance_instances;
DROP POLICY IF EXISTS compliance_instances_redate_select ON hsdg.compliance_instances;
DROP TABLE IF EXISTS hsdg.firm_internal_due;

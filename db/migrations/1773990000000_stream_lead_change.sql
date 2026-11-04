-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- Change a stream's lead (the engagement service line's lead_employee_id)
-- after the engagement is set up. Only an administrator or the Managing
-- Partner may — whether or not they are on the engagement — so it runs as a
-- definer function that checks the caller's roles itself; the app role's
-- own UPDATE policy (engagement leads) is unchanged.
-- ─────────────────────────────────────────────────────────────────────────

-- The usual owner policy, for the definer function below (FORCE RLS).
CREATE POLICY engagement_services_owner ON hsdg.engagement_services
  TO hsdg_migrator USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION hsdg.set_service_line_lead(
  p_engagement_id uuid, p_line_id uuid, p_employee_id uuid)
  RETURNS TABLE (before_lead uuid, after_lead uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_before uuid;
  v_status text;
BEGIN
  IF NOT (current_setting('hsdg.role', true) IN ('admin', 'managing_partner')
          OR hsdg.ctx_roles() && ARRAY['admin', 'managing_partner']) THEN
    RAISE EXCEPTION 'only an administrator or the Managing Partner changes a stream lead'
      USING ERRCODE = '42501';
  END IF;
  SELECT es.lead_employee_id, es.status INTO v_before, v_status
    FROM hsdg.engagement_services es
   WHERE es.id = p_line_id AND es.engagement_id = p_engagement_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service line not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'the line is cancelled' USING ERRCODE = '22023';
  END IF;
  IF p_employee_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM hsdg.employees e
        WHERE e.id = p_employee_id AND e.employment_status <> 'exited') THEN
    RAISE EXCEPTION 'the lead must be a current employee' USING ERRCODE = '23503';
  END IF;
  UPDATE hsdg.engagement_services SET lead_employee_id = p_employee_id WHERE id = p_line_id;
  RETURN QUERY SELECT v_before, p_employee_id;
END $$;
REVOKE ALL ON FUNCTION hsdg.set_service_line_lead(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.set_service_line_lead(uuid, uuid, uuid) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.set_service_line_lead(uuid, uuid, uuid);
DROP POLICY IF EXISTS engagement_services_owner ON hsdg.engagement_services;

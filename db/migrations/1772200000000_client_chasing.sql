-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow WF-302 · Client chasing on the filing
--
-- • firm_settings gains the chasing offsets: a filing's client requests are
--   reminded N days and escalated M days before its internal due date (firm
--   policy; default T-7 / T-3).
-- • A document landing in a filing's slot — uploaded by staff, by the client
--   through a secure link, or re-filed into the slot — closes the matching open
--   request (same filing, same slot) as received, server-side and audited, so
--   nobody has to tick it off by hand. SECURITY DEFINER: the uploader is often a
--   preparer or the client link, neither of whom may write the request itself.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.firm_settings
  ADD COLUMN client_reminder_days   integer NOT NULL DEFAULT 7 CHECK (client_reminder_days BETWEEN 0 AND 60),
  ADD COLUMN client_escalation_days integer NOT NULL DEFAULT 3 CHECK (client_escalation_days BETWEEN 0 AND 60);

CREATE OR REPLACE FUNCTION hsdg.close_slot_requests() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  dep        record;
  -- No signed-in user ⇒ the client's secure link (which runs elevated itself).
  actor_role text := CASE WHEN hsdg.ctx_user_id() IS NULL THEN 'client_upload' ELSE hsdg.ctx_role() END;
  prior_role text := current_setting('hsdg.role', true);
BEGIN
  IF NEW.compliance_instance_id IS NULL OR NEW.slot_code IS NULL
     OR NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.slot_code IS NOT DISTINCT FROM NEW.slot_code
     AND OLD.compliance_instance_id IS NOT DISTINCT FROM NEW.compliance_instance_id THEN
    RETURN NEW;
  END IF;
  -- The uploader may be a preparer who cannot write the request: elevate for
  -- this one scoped update (same filing, same slot), then restore the caller's
  -- role so nothing else in their transaction runs elevated.
  PERFORM set_config('hsdg.role', 'managing_partner', true);
  FOR dep IN
    UPDATE hsdg.client_dependencies d
       SET status = 'received',
           received_date = timezone('Asia/Kolkata', now())::date,
           version = version + 1
     WHERE d.compliance_instance_id = NEW.compliance_instance_id
       AND d.slot_code = NEW.slot_code
       AND d.status IN ('pending', 'partially_received')
    RETURNING d.id, d.engagement_id
  LOOP
    INSERT INTO hsdg.audit_events
      (actor_user_id, actor_role, action, object_type, object_id, before_state, after_state)
    VALUES (hsdg.ctx_user_id(), actor_role,
            'client_dependency.auto_received', 'client_dependency', dep.id::text,
            jsonb_build_object('status', 'pending'),
            jsonb_build_object('status', 'received', 'documentId', NEW.id,
                               'complianceInstanceId', NEW.compliance_instance_id,
                               'slotCode', NEW.slot_code));
  END LOOP;
  PERFORM set_config('hsdg.role', COALESCE(prior_role, ''), true);
  RETURN NEW;
END $$;

CREATE TRIGGER documents_close_slot_requests
  AFTER INSERT OR UPDATE OF slot_code, compliance_instance_id ON hsdg.documents
  FOR EACH ROW EXECUTE FUNCTION hsdg.close_slot_requests();

-- Down Migration

DROP TRIGGER IF EXISTS documents_close_slot_requests ON hsdg.documents;
DROP FUNCTION IF EXISTS hsdg.close_slot_requests();
ALTER TABLE hsdg.firm_settings
  DROP COLUMN IF EXISTS client_escalation_days,
  DROP COLUMN IF EXISTS client_reminder_days;

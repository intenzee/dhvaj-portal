-- ─────────────────────────────────────────────────────────────────────────
-- 0071 · Cancel audit files whose Statutory Audit service was removed
--
-- WHY: removing a service from an engagement only cancelled the service line;
-- its statutory-audit file (service_workflow_instances) stayed 'active', so the
-- Framework and every other audit-file section kept showing in the Work tab.
-- The API now cancels the file together with its service line
-- (StatutoryAuditWorkflowService.cancelForService) and every audit-file read
-- ignores cancelled files. This repairs files orphaned before that fix. Work
-- is kept, not deleted; re-adding the service restores the file. Signed-off or
-- archived files are left untouched (a finished record). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DO $$
DECLARE
  wf_forced boolean;
  es_forced boolean;
BEGIN
  -- The migrator has no request context, so FORCE'd RLS would hide every row
  -- (compare 1764800000000) — on EVERY table the statement reads, not just the
  -- one it writes. Lift it for this statement only, then restore.
  SELECT relforcerowsecurity INTO wf_forced
    FROM pg_class WHERE oid = 'hsdg.service_workflow_instances'::regclass;
  SELECT relforcerowsecurity INTO es_forced
    FROM pg_class WHERE oid = 'hsdg.engagement_services'::regclass;
  IF wf_forced THEN
    ALTER TABLE hsdg.service_workflow_instances NO FORCE ROW LEVEL SECURITY;
  END IF;
  IF es_forced THEN
    ALTER TABLE hsdg.engagement_services NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE hsdg.service_workflow_instances w
     SET status = 'cancelled'
    FROM hsdg.engagement_services es
   WHERE es.id = w.engagement_service_id
     AND es.status = 'cancelled'
     AND w.status IN ('active', 'on_hold')
     AND w.signed_off_at IS NULL;

  IF wf_forced THEN
    ALTER TABLE hsdg.service_workflow_instances FORCE ROW LEVEL SECURITY;
  END IF;
  IF es_forced THEN
    ALTER TABLE hsdg.engagement_services FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Down Migration

-- Data repair only; nothing to undo (re-adding the service restores a file).
SELECT 1;

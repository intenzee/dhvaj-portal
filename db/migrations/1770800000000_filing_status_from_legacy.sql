-- ─────────────────────────────────────────────────────────────────────────
-- A filing completed or waived through the original compliance endpoints
-- (status 'completed' / 'waived') shows as Filed / Not applicable on the
-- workspace and the firm calendar. Until now workflow_status only followed
-- the workspace's own facts, so such a filing stayed "Not started".
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.derive_instance_workflow_status(p_id uuid) RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM hsdg.filing_records fr
                  WHERE fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL) THEN 'filed'
    WHEN ci.workflow_status = 'filed'
         AND NOT EXISTS (SELECT 1 FROM hsdg.filing_records fr WHERE fr.compliance_instance_id = ci.id)
      THEN 'filed'
    WHEN ci.workflow_status = 'not_applicable' THEN 'not_applicable'
    WHEN ci.status = 'completed'
         AND NOT EXISTS (SELECT 1 FROM hsdg.filing_records fr WHERE fr.compliance_instance_id = ci.id)
      THEN 'filed'
    WHEN ci.status = 'waived' THEN 'not_applicable'
    WHEN t.status = 'done' THEN
      CASE WHEN EXISTS (SELECT 1 FROM hsdg.instance_checklist_items it
                         WHERE it.compliance_instance_id = ci.id AND it.item_code = 'CLIENT_APPROVAL'
                           AND it.required AND it.status = 'open')
           THEN 'in_review' ELSE 'ready_to_file' END
    WHEN t.status = 'in_review' THEN 'in_review'
    WHEN EXISTS (SELECT 1 FROM hsdg.client_dependencies d
                  WHERE d.compliance_instance_id = ci.id
                    AND d.status IN ('pending','partially_received')) THEN 'awaiting_data'
    WHEN t.status IN ('in_progress','paused','blocked') THEN 'in_preparation'
    ELSE 'not_started'
  END
  FROM hsdg.compliance_instances ci
  LEFT JOIN LATERAL (
    SELECT tk.status FROM hsdg.tasks tk
     WHERE tk.source_compliance_instance_id = ci.id AND tk.status <> 'cancelled'
     ORDER BY tk.created_at DESC LIMIT 1
  ) t ON true
  WHERE ci.id = p_id
$$;

-- Bring existing completed / waived filings in line, with RLS lifted so the
-- migrator sees every row (the member guard only applies to hsdg_app).
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.compliance_instances ci
   SET workflow_status = CASE ci.status WHEN 'completed' THEN 'filed' ELSE 'not_applicable' END
 WHERE ci.status IN ('completed','waived')
   AND ci.workflow_status NOT IN ('filed','not_applicable')
   AND NOT EXISTS (SELECT 1 FROM hsdg.filing_records fr WHERE fr.compliance_instance_id = ci.id);
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.derive_instance_workflow_status(p_id uuid) RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM hsdg.filing_records fr
                  WHERE fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL) THEN 'filed'
    WHEN ci.workflow_status = 'filed'
         AND NOT EXISTS (SELECT 1 FROM hsdg.filing_records fr WHERE fr.compliance_instance_id = ci.id)
      THEN 'filed'
    WHEN ci.workflow_status = 'not_applicable' THEN 'not_applicable'
    WHEN t.status = 'done' THEN
      CASE WHEN EXISTS (SELECT 1 FROM hsdg.instance_checklist_items it
                         WHERE it.compliance_instance_id = ci.id AND it.item_code = 'CLIENT_APPROVAL'
                           AND it.required AND it.status = 'open')
           THEN 'in_review' ELSE 'ready_to_file' END
    WHEN t.status = 'in_review' THEN 'in_review'
    WHEN EXISTS (SELECT 1 FROM hsdg.client_dependencies d
                  WHERE d.compliance_instance_id = ci.id
                    AND d.status IN ('pending','partially_received')) THEN 'awaiting_data'
    WHEN t.status IN ('in_progress','paused','blocked') THEN 'in_preparation'
    ELSE 'not_started'
  END
  FROM hsdg.compliance_instances ci
  LEFT JOIN LATERAL (
    SELECT tk.status FROM hsdg.tasks tk
     WHERE tk.source_compliance_instance_id = ci.id AND tk.status <> 'cancelled'
     ORDER BY tk.created_at DESC LIMIT 1
  ) t ON true
  WHERE ci.id = p_id
$$;
-- The backfilled workflow_status values are left as they are: they match what
-- the filings' status says, and the earlier derivation keeps a Filed one Filed.

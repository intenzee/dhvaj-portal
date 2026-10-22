-- ─────────────────────────────────────────────────────────────────────────
-- Easy mode — lodging and the checklist follow the firm's checks
--
-- The database held the same rules as the API; each is now enforced only
-- while its check is on (hsdg.firm_check, 1772800000000):
--
--   lodge_ack_required        a lodge without the acknowledgement
--   lodge_reference_required  a lodge without the reference number
--                             (both may be added later by anyone on the
--                             filing; a lead may also replace them)
--   undo_lead_only            the team undoes a lodge (the API: 7 days)
--   waive_lead_only           the team marks a filing Not applicable / lifts it
--   checklist_na_lead_only    the team marks a required step Not applicable,
--                             and the reason becomes optional
--   checklist_auto_steps      a hand tick on a review / lodge step stands
--   client_approval_blocks    an open client approval holds the filing in review
--
-- And the lodge closes the filing's task whoever records it (the lodge has
-- its own checks), stopping the clocks on it.
--
-- Stays as it was: one live lodge per filing, a reference used once, the
-- undo needs who and why, a lead's own powers, and the audit log.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Lodge: acknowledgement and reference may follow later ───────────────
ALTER TABLE hsdg.filing_records ALTER COLUMN ack_document_id DROP NOT NULL;
ALTER TABLE hsdg.filing_records ALTER COLUMN reference_no DROP NOT NULL;

CREATE OR REPLACE FUNCTION hsdg.filing_records_checks() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.undone_at IS NULL THEN
    IF NEW.ack_document_id IS NULL AND hsdg.firm_check('lodge_ack_required') THEN
      RAISE EXCEPTION 'Upload the acknowledgement to this filing before lodging.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.reference_no IS NULL AND hsdg.firm_check('lodge_reference_required') THEN
      RAISE EXCEPTION 'Enter the reference number.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER filing_records_checks
  BEFORE INSERT ON hsdg.filing_records
  FOR EACH ROW EXECUTE FUNCTION hsdg.filing_records_checks();

-- A lead changes a lodge as before. Anyone else on the filing may fill in a
-- missing acknowledgement or reference, and undo it while the firm allows.
DROP POLICY filing_records_update ON hsdg.filing_records;
CREATE POLICY filing_records_update ON hsdg.filing_records
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));

CREATE OR REPLACE FUNCTION hsdg.filing_records_member_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['version'];
BEGIN
  IF current_user <> 'hsdg_app' OR hsdg.is_engagement_lead(OLD.engagement_id) THEN
    RETURN NEW;
  END IF;
  IF OLD.ack_document_id IS NULL THEN allowed := allowed || 'ack_document_id'::text; END IF;
  IF OLD.reference_no IS NULL THEN
    allowed := allowed || ARRAY['reference_no', 'reference_kind'];
  END IF;
  IF NOT hsdg.firm_check('undo_lead_only') THEN
    allowed := allowed || ARRAY['undone_at', 'undone_by_employee_id', 'undo_reason'];
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'Only the engagement partner or manager can change this lodge.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER filing_records_member_guard
  BEFORE UPDATE ON hsdg.filing_records
  FOR EACH ROW EXECUTE FUNCTION hsdg.filing_records_member_guard();

-- ── Not applicable: the team's call while the firm allows ───────────────
CREATE OR REPLACE FUNCTION hsdg.compliance_instances_member_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['workflow_status','status','completed_at','completed_by_employee_id',
                          'updated_at','version'];
  team_waives boolean;
BEGIN
  -- Only the application role is guarded: migrations (owner) and the owner-run
  -- SECURITY DEFINER paths keep their existing behaviour.
  IF current_user <> 'hsdg_app' OR hsdg.is_engagement_lead(OLD.engagement_id) THEN
    RETURN NEW;
  END IF;
  team_waives := NOT hsdg.firm_check('waive_lead_only');
  IF team_waives THEN allowed := allowed || 'notes'::text; END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'Only an engagement lead may change this filing.' USING ERRCODE = '42501';
  END IF;
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status IS DISTINCT FROM hsdg.derive_instance_workflow_status(OLD.id)
     AND NOT (team_waives
              AND (NEW.workflow_status = 'not_applicable'
                   OR (OLD.workflow_status = 'not_applicable'
                       AND NEW.workflow_status = 'not_started'))) THEN
    RAISE EXCEPTION 'A filing''s status follows its work; only a lead may set it.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- ── Checklist ───────────────────────────────────────────────────────────
DROP POLICY instance_checklist_items_update ON hsdg.instance_checklist_items;
CREATE POLICY instance_checklist_items_update ON hsdg.instance_checklist_items
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND (status <> 'not_applicable' OR NOT required OR hsdg.is_engagement_lead(engagement_id)
         OR NOT hsdg.firm_check('checklist_na_lead_only'))
  );

-- The reason for Not applicable is required while the check is on.
ALTER TABLE hsdg.instance_checklist_items DROP CONSTRAINT instance_checklist_items_na_reason;
CREATE OR REPLACE FUNCTION hsdg.instance_checklist_items_na_reason() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'not_applicable' AND length(trim(coalesce(NEW.na_reason, ''))) = 0
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'not_applicable')
     AND hsdg.firm_check('checklist_na_lead_only') THEN
    RAISE EXCEPTION 'Give a reason for Not applicable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER instance_checklist_items_na_reason
  BEFORE INSERT OR UPDATE ON hsdg.instance_checklist_items
  FOR EACH ROW EXECUTE FUNCTION hsdg.instance_checklist_items_na_reason();

-- ── Derived status: the client's approval holds the filing only while on ─
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
      CASE WHEN hsdg.firm_check('client_approval_blocks')
                AND EXISTS (SELECT 1 FROM hsdg.instance_checklist_items it
                             WHERE it.compliance_instance_id = ci.id
                               AND it.item_code = 'CLIENT_APPROVAL'
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

-- ── The lodge closes its task, whoever on the filing records it ─────────
-- Once a filing has a live lodge, anyone on the engagement may move its task
-- to Done and stop the clocks running on it — the lodge has its own rules
-- (the firm's lodge checks); the task follows it.
CREATE POLICY tasks_update_lodged ON hsdg.tasks FOR UPDATE
  USING (source_compliance_instance_id IS NOT NULL
         AND hsdg.is_engagement_member(engagement_id))
  WITH CHECK (status = 'done'
              AND hsdg.is_engagement_member(engagement_id)
              AND EXISTS (SELECT 1 FROM hsdg.filing_records fr
                           WHERE fr.compliance_instance_id = source_compliance_instance_id
                             AND fr.undone_at IS NULL));

CREATE POLICY time_entries_update_lodged ON hsdg.engagement_time_entries FOR UPDATE
  USING (ended_at IS NULL AND task_id IS NOT NULL
         AND hsdg.is_engagement_member(engagement_id))
  WITH CHECK (ended_at IS NOT NULL
              AND hsdg.is_engagement_member(engagement_id)
              AND EXISTS (SELECT 1 FROM hsdg.tasks t
                            JOIN hsdg.filing_records fr
                              ON fr.compliance_instance_id = t.source_compliance_instance_id
                             AND fr.undone_at IS NULL
                           WHERE t.id = task_id));

-- Down Migration

DROP POLICY IF EXISTS time_entries_update_lodged ON hsdg.engagement_time_entries;
DROP POLICY IF EXISTS tasks_update_lodged ON hsdg.tasks;

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

DROP TRIGGER IF EXISTS instance_checklist_items_na_reason ON hsdg.instance_checklist_items;
DROP FUNCTION IF EXISTS hsdg.instance_checklist_items_na_reason();
UPDATE hsdg.instance_checklist_items SET na_reason = 'Not applicable.'
 WHERE status = 'not_applicable' AND length(trim(coalesce(na_reason, ''))) = 0;
ALTER TABLE hsdg.instance_checklist_items ADD CONSTRAINT instance_checklist_items_na_reason
  CHECK (status <> 'not_applicable' OR length(trim(coalesce(na_reason, ''))) > 0);

DROP POLICY IF EXISTS instance_checklist_items_update ON hsdg.instance_checklist_items;
CREATE POLICY instance_checklist_items_update ON hsdg.instance_checklist_items
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND (status <> 'not_applicable' OR NOT required OR hsdg.is_engagement_lead(engagement_id))
  );

CREATE OR REPLACE FUNCTION hsdg.compliance_instances_member_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['workflow_status','status','completed_at','completed_by_employee_id',
                          'updated_at','version'];
BEGIN
  IF current_user <> 'hsdg_app' OR hsdg.is_engagement_lead(OLD.engagement_id) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'Only an engagement lead may change this filing.' USING ERRCODE = '42501';
  END IF;
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status IS DISTINCT FROM hsdg.derive_instance_workflow_status(OLD.id) THEN
    RAISE EXCEPTION 'A filing''s status follows its work; only a lead may set it.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS filing_records_member_guard ON hsdg.filing_records;
DROP FUNCTION IF EXISTS hsdg.filing_records_member_guard();
DROP POLICY IF EXISTS filing_records_update ON hsdg.filing_records;
CREATE POLICY filing_records_update ON hsdg.filing_records
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP TRIGGER IF EXISTS filing_records_checks ON hsdg.filing_records;
DROP FUNCTION IF EXISTS hsdg.filing_records_checks();
-- Lodges recorded without a reference or acknowledgement keep the column nullable.

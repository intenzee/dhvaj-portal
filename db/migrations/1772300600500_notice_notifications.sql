-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-102 · notices reach their owner.
--
-- Three actionable types, on object_type 'notice' (link → /notices/:id):
--   notice_received    — to the owner and reviewer when a notice is recorded;
--   notice_reply_due   — 7, 3 and 1 days before the internal reply date
--                        (notifications-scan; dedup per date and band);
--   notice_hearing_due — 2 days before a hearing.
-- Each clears itself once the thing it asks for is done, by whoever does it
-- (SECURITY DEFINER trigger, as WF-305's): work started clears "received"; a
-- reply filed (or the reply date moved) clears "reply due"; the hearing held,
-- adjourned or replaced clears "hearing due"; a closed or withdrawn notice
-- clears all three.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending','internal_sla_approaching',
   'internal_sla_overdue','statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue','client_commitment_overdue',
   'client_dependency_overdue','client_dependency_reminder','engagement_reopened',
   'ep_changed','high_risk_exception','document_uploaded','framework_reopened',
   'framework_work_impacted','planning_signal_alert','planning_partner_attention',
   'planning_strategy_reopened','planning_understanding_reassessment',
   'planning_understanding_challenge','planning_materiality_reassessment',
   'planning_materiality_challenge','planning_areas_review',
   'planning_areas_update_required','planning_scope_reassessment',
   'planning_scope_partner_action','task_review_requested','task_returned','filing_lodged',
   'time_adjustment_pending','notice_received','notice_reply_due','notice_hearing_due'));

CREATE FUNCTION hsdg.resolve_notice_notifications() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NEW.status IN ('closed', 'withdrawn') THEN
    PERFORM hsdg.resolve_notifications('notice', ARRAY[NEW.id],
      ARRAY['notice_received', 'notice_reply_due', 'notice_hearing_due']);
    RETURN NULL;
  END IF;
  IF NEW.status <> 'received' THEN
    PERFORM hsdg.resolve_notifications('notice', ARRAY[NEW.id], ARRAY['notice_received']);
  END IF;
  IF NEW.status NOT IN ('received', 'in_progress')
     OR NEW.internal_due_on IS DISTINCT FROM OLD.internal_due_on THEN
    PERFORM hsdg.resolve_notifications('notice', ARRAY[NEW.id], ARRAY['notice_reply_due']);
  END IF;
  IF NEW.next_hearing_on IS DISTINCT FROM OLD.next_hearing_on
     OR NEW.status IN ('order_received', 'appealed') THEN
    PERFORM hsdg.resolve_notifications('notice', ARRAY[NEW.id], ARRAY['notice_hearing_due']);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER notices_resolve_notifications
  AFTER UPDATE OF status, internal_due_on, next_hearing_on ON hsdg.notices
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status
                     OR OLD.internal_due_on IS DISTINCT FROM NEW.internal_due_on
                     OR OLD.next_hearing_on IS DISTINCT FROM NEW.next_hearing_on)
  EXECUTE FUNCTION hsdg.resolve_notice_notifications();

-- Down Migration

DROP TRIGGER IF EXISTS notices_resolve_notifications ON hsdg.notices;
DROP FUNCTION IF EXISTS hsdg.resolve_notice_notifications();
DELETE FROM hsdg.notifications
  WHERE type IN ('notice_received', 'notice_reply_due', 'notice_hearing_due');
ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending','internal_sla_approaching',
   'internal_sla_overdue','statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue','client_commitment_overdue',
   'client_dependency_overdue','client_dependency_reminder','engagement_reopened',
   'ep_changed','high_risk_exception','document_uploaded','framework_reopened',
   'framework_work_impacted','planning_signal_alert','planning_partner_attention',
   'planning_strategy_reopened','planning_understanding_reassessment',
   'planning_understanding_challenge','planning_materiality_reassessment',
   'planning_materiality_challenge','planning_areas_review',
   'planning_areas_update_required','planning_scope_reassessment',
   'planning_scope_partner_action','task_review_requested','task_returned','filing_lodged',
   'time_adjustment_pending'));

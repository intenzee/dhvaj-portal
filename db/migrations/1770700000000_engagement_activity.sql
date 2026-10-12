-- ─────────────────────────────────────────────────────────────────────────
-- Engagement Restructure · Change 3 — Activity → Timeline
--
-- engagement_activity is ONE feed per engagement, newest first: status
-- changes, task moves, filings lodged / undone / corrected / waived,
-- documents uploaded, client requests raised and closed, review points,
-- comments (engagement_notes; existing notes were pinned by 1770500000000),
-- time collapsed per person per day per stream, and independence
-- acknowledgements.
--
-- security_invoker = true, so the reader's RLS on every base table applies: a
-- member of another engagement sees nothing. Each row carries the stream and
-- engagement_service_id it belongs to so the tab can filter by stream/person.
-- Nothing is stored; the API pages it by (occurred_at, id).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE VIEW hsdg.engagement_activity WITH (security_invoker = true) AS
-- Engagement status changes.
SELECT h.engagement_id,
       'status_change:' || h.id                         AS id,
       'status_change'::text                            AS kind,
       h.created_at                                     AS occurred_at,
       ae.id                                            AS actor_employee_id,
       'Engagement ' || replace(h.to_status, '_', ' ')  AS title,
       h.reason                                         AS detail,
       NULL::text                                       AS stream,
       NULL::uuid                                       AS engagement_service_id,
       NULL::uuid                                       AS compliance_instance_id,
       NULL::uuid                                       AS task_id,
       false                                            AS is_pinned,
       jsonb_build_object('action', h.action, 'from', h.from_status, 'to', h.to_status) AS meta
  FROM hsdg.engagement_lifecycle_history h
  LEFT JOIN hsdg.employees ae ON ae.user_id = h.actor_user_id
UNION ALL
-- Task moves (every path, via the task_events trigger).
SELECT te.engagement_id,
       'task_event:' || te.id,
       'task_event',
       te.created_at,
       te.actor_employee_id,
       t.title,
       te.reason,
       sv.stream,
       t.engagement_service_id,
       t.source_compliance_instance_id,
       te.task_id,
       false,
       jsonb_build_object('from', te.from_status, 'to', te.to_status)
  FROM hsdg.task_events te
  JOIN hsdg.tasks t ON t.id = te.task_id
  LEFT JOIN hsdg.engagement_services es ON es.id = t.engagement_service_id
  LEFT JOIN hsdg.services sv ON sv.id = es.service_id
UNION ALL
-- Filings lodged (one row per record, live or later undone).
SELECT fr.engagement_id,
       'filing_lodged:' || fr.id,
       'filing_lodged',
       fr.created_at,
       COALESCE(fr.recorded_by_employee_id, fr.filed_by_employee_id),
       COALESCE(rv.form_label, cr.name),
       fr.remarks,
       COALESCE(rv.stream, sv.stream),
       ci.engagement_service_id,
       fr.compliance_instance_id,
       NULL::uuid,
       false,
       jsonb_build_object('referenceKind', fr.reference_kind, 'referenceNo', fr.reference_no,
                          'filedOn', fr.filed_on, 'isNil', fr.is_nil, 'periodKey', ci.period_key,
                          'section', ci.section, 'undone', fr.undone_at IS NOT NULL)
  FROM hsdg.filing_records fr
  JOIN hsdg.compliance_instances ci ON ci.id = fr.compliance_instance_id
  JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
  LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
  LEFT JOIN hsdg.services sv ON sv.id = es.service_id
UNION ALL
-- Filings undone (partner / lead within the window).
SELECT fr.engagement_id,
       'filing_undone:' || fr.id,
       'filing_undone',
       fr.undone_at,
       fr.undone_by_employee_id,
       COALESCE(rv.form_label, cr.name),
       fr.undo_reason,
       COALESCE(rv.stream, sv.stream),
       ci.engagement_service_id,
       fr.compliance_instance_id,
       NULL::uuid,
       false,
       jsonb_build_object('referenceNo', fr.reference_no, 'periodKey', ci.period_key,
                          'section', ci.section)
  FROM hsdg.filing_records fr
  JOIN hsdg.compliance_instances ci ON ci.id = fr.compliance_instance_id
  JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
  LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
  LEFT JOIN hsdg.services sv ON sv.id = es.service_id
 WHERE fr.undone_at IS NOT NULL
UNION ALL
-- Corrections noted against a filed return.
SELECT fc.engagement_id,
       'filing_correction:' || fc.id,
       'filing_correction',
       fc.created_at,
       fc.created_by_employee_id,
       COALESCE(rv.form_label, cr.name),
       fc.note,
       COALESCE(rv.stream, sv.stream),
       ci.engagement_service_id,
       fc.compliance_instance_id,
       NULL::uuid,
       false,
       jsonb_build_object('periodKey', ci.period_key, 'section', ci.section,
                          'correctedInInstanceId', fc.corrected_in_instance_id,
                          'correctedInPeriodKey', cc.period_key)
  FROM hsdg.filing_corrections fc
  JOIN hsdg.compliance_instances ci ON ci.id = fc.compliance_instance_id
  JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
  LEFT JOIN hsdg.compliance_instances cc ON cc.id = fc.corrected_in_instance_id
  LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
  LEFT JOIN hsdg.services sv ON sv.id = es.service_id
UNION ALL
-- Filings waived by a lead (the workspace writes 'Not applicable: <reason>';
-- rows the generator retires carry its own note and are not activity).
SELECT ci.engagement_id,
       'filing_waived:' || ci.id,
       'filing_waived',
       ci.updated_at,
       NULL::uuid,
       COALESCE(rv.form_label, cr.name),
       substr(ci.notes, length('Not applicable: ') + 1),
       COALESCE(rv.stream, sv.stream),
       ci.engagement_service_id,
       ci.id,
       NULL::uuid,
       false,
       jsonb_build_object('periodKey', ci.period_key, 'section', ci.section)
  FROM hsdg.compliance_instances ci
  JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
  LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
  LEFT JOIN hsdg.services sv ON sv.id = es.service_id
 WHERE ci.workflow_status = 'not_applicable' AND ci.notes LIKE 'Not applicable: %'
UNION ALL
-- Documents uploaded (by staff or through a client upload link).
SELECT d.engagement_id,
       'document_uploaded:' || d.id,
       'document_uploaded',
       d.created_at,
       d.created_by_employee_id,
       d.title,
       NULL::text,
       COALESCE(rv.stream, isv.stream, tsv.stream),
       COALESCE(ci.engagement_service_id, t.engagement_service_id),
       d.compliance_instance_id,
       d.task_id,
       false,
       jsonb_build_object('documentType', d.document_type, 'slotCode', d.slot_code,
                          'periodSection', d.period_section, 'periodKey', ci.period_key,
                          'viaClientUpload', d.client_dependency_id IS NOT NULL
                                             AND d.created_by_employee_id IS NULL)
  FROM hsdg.documents d
  LEFT JOIN hsdg.compliance_instances ci ON ci.id = d.compliance_instance_id
  LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.engagement_services ies ON ies.id = ci.engagement_service_id
  LEFT JOIN hsdg.services isv ON isv.id = ies.service_id
  LEFT JOIN hsdg.tasks t ON t.id = d.task_id
  LEFT JOIN hsdg.engagement_services tes ON tes.id = t.engagement_service_id
  LEFT JOIN hsdg.services tsv ON tsv.id = tes.service_id
 WHERE d.deleted_at IS NULL
UNION ALL
-- Client requests raised.
SELECT cd.engagement_id,
       'dependency_raised:' || cd.id,
       'dependency_raised',
       cd.created_at,
       cd.created_by_employee_id,
       cd.requested_info,
       cd.outstanding_items,
       COALESCE(rv.stream, sv.stream),
       COALESCE(cd.engagement_service_id, ci.engagement_service_id),
       cd.compliance_instance_id,
       cd.task_id,
       false,
       jsonb_build_object('slotCode', cd.slot_code, 'periodSection', cd.period_section,
                          'escalationDate', cd.escalation_date, 'status', cd.status)
  FROM hsdg.client_dependencies cd
  LEFT JOIN hsdg.compliance_instances ci ON ci.id = cd.compliance_instance_id
  LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.engagement_services es ON es.id = COALESCE(cd.engagement_service_id, ci.engagement_service_id)
  LEFT JOIN hsdg.services sv ON sv.id = es.service_id
UNION ALL
-- Client requests closed (received / waived / cancelled).
SELECT cd.engagement_id,
       'dependency_closed:' || cd.id,
       'dependency_closed',
       cd.updated_at,
       NULL::uuid,
       cd.requested_info,
       NULL::text,
       COALESCE(rv.stream, sv.stream),
       COALESCE(cd.engagement_service_id, ci.engagement_service_id),
       cd.compliance_instance_id,
       cd.task_id,
       false,
       jsonb_build_object('status', cd.status, 'receivedDate', cd.received_date)
  FROM hsdg.client_dependencies cd
  LEFT JOIN hsdg.compliance_instances ci ON ci.id = cd.compliance_instance_id
  LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
  LEFT JOIN hsdg.engagement_services es ON es.id = COALESCE(cd.engagement_service_id, ci.engagement_service_id)
  LEFT JOIN hsdg.services sv ON sv.id = es.service_id
 WHERE cd.status IN ('received', 'waived', 'cancelled')
UNION ALL
-- Review points raised (resolution is in meta; the point's row is the event).
SELECT rp.engagement_id,
       'review_point:' || rp.id,
       'review_point',
       rp.created_at,
       rp.raised_by_employee_id,
       rp.matter,
       rp.resolution,
       NULL::text,
       NULL::uuid,
       NULL::uuid,
       NULL::uuid,
       false,
       jsonb_build_object('status', rp.status, 'isKeyMatter', rp.is_key_matter,
                          'resolvedAt', rp.resolved_at,
                          'resolvedByEmployeeId', rp.resolved_by_employee_id)
  FROM hsdg.engagement_review_points rp
UNION ALL
-- Comments (engagement notes).
SELECT n.engagement_id,
       'comment:' || n.id,
       'comment',
       n.created_at,
       n.author_employee_id,
       n.body,
       NULL::text,
       sv.stream,
       n.engagement_service_id,
       NULL::uuid,
       NULL::uuid,
       n.is_pinned,
       jsonb_build_object('noteId', n.id, 'version', n.version,
                          'edited', n.updated_at > n.created_at + interval '1 second')
  FROM hsdg.engagement_notes n
  LEFT JOIN hsdg.engagement_services es ON es.id = n.engagement_service_id
  LEFT JOIN hsdg.services sv ON sv.id = es.service_id
UNION ALL
-- Time, collapsed per person per IST day per stream (effective entries only:
-- an approved adjustment replaces its original; running clocks are excluded).
SELECT x.engagement_id,
       'time_day:' || x.employee_id || ':' || x.day || COALESCE(':' || x.stream, ''),
       'time_day',
       x.last_at,
       x.employee_id,
       x.day::text,
       NULL::text,
       x.stream,
       x.engagement_service_id,
       NULL::uuid,
       NULL::uuid,
       false,
       jsonb_build_object('date', x.day, 'seconds', x.seconds, 'sessions', x.sessions)
  FROM (
    SELECT te.engagement_id, te.employee_id,
           (te.started_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           sv.stream,
           -- one stream can hold several lines only for folded legacy lines; any will do
           (array_agg(te.engagement_service_id ORDER BY te.started_at))[1] AS engagement_service_id,
           sum(te.duration_seconds)::bigint AS seconds,
           count(*)::int AS sessions,
           max(te.ended_at) AS last_at
      FROM hsdg.effective_time_entries te
      LEFT JOIN hsdg.engagement_services es ON es.id = te.engagement_service_id
      LEFT JOIN hsdg.services sv ON sv.id = es.service_id
     WHERE te.ended_at IS NOT NULL
     GROUP BY te.engagement_id, te.employee_id, (te.started_at AT TIME ZONE 'Asia/Kolkata')::date, sv.stream
  ) x
UNION ALL
-- Independence warnings acknowledged.
SELECT ic.engagement_id,
       'independence_ack:' || ic.id,
       'independence_ack',
       ic.acknowledged_at,
       ic.acknowledged_by_employee_id,
       ic.rule_code || ': ' || ic.message,
       NULL::text,
       NULL::text,
       NULL::uuid,
       NULL::uuid,
       NULL::uuid,
       false,
       jsonb_build_object('ruleCode', ic.rule_code, 'outcome', ic.outcome,
                          'financialYear', ic.financial_year)
  FROM hsdg.engagement_independence_checks ic
 WHERE ic.acknowledged_at IS NOT NULL;

COMMENT ON VIEW hsdg.engagement_activity IS
  'Activity → Timeline feed (Change 3). security_invoker: base-table RLS applies to the reader.';
GRANT SELECT ON hsdg.engagement_activity TO hsdg_app;

-- Down Migration

DROP VIEW IF EXISTS hsdg.engagement_activity;

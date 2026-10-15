-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow · Questions for the partners, as firm settings
--
-- The plan leaves five calls to the partners. Each becomes a setting they can
-- change on Admin → Workflow instead of a constant in the code:
--
--   1. Internal due date per form — already per compliance rule
--      (compliance_rule_versions.internal_sla_offset_days); no column here.
--   2. Default reviewer when a task is sent for review without one:
--      the stream lead, the engagement manager (today's behaviour) or the
--      engagement partner.
--   3. Which clients an article sees: every client in their office (today) or
--      only clients they work on.
--   4. How client reminders go: email (today), a WhatsApp message, or text to
--      copy and paste.
--   5. Who may bulk-assign in a filing run: managers (engagement.manage) only,
--      or stream leads too.
--
-- `workflow.manage` lets the managing partner and partners change them. The
-- firm_settings row is updated firm-wide only so far; partners now may too
-- (the API guard decides which columns each endpoint touches).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.firm_settings
  ADD COLUMN default_reviewer text NOT NULL DEFAULT 'engagement_manager'
    CHECK (default_reviewer IN ('stream_lead', 'engagement_manager', 'engagement_partner')),
  ADD COLUMN article_client_scope text NOT NULL DEFAULT 'office'
    CHECK (article_client_scope IN ('office', 'engagements')),
  ADD COLUMN client_reminder_channel text NOT NULL DEFAULT 'email'
    CHECK (client_reminder_channel IN ('email', 'whatsapp', 'copy')),
  ADD COLUMN bulk_assign_scope text NOT NULL DEFAULT 'managers_and_leads'
    CHECK (bulk_assign_scope IN ('managers', 'managers_and_leads'));

CREATE POLICY firm_settings_update_partner ON hsdg.firm_settings
  FOR UPDATE USING (hsdg.ctx_role() = 'partner') WITH CHECK (hsdg.ctx_role() = 'partner');

-- Question 5 in the database: with 'managers_and_leads', the lead of a filing's
-- stream line (engagement_services.lead_employee_id for the rule's stream) may
-- create and assign that filing's task, alongside the engagement leads.
CREATE OR REPLACE FUNCTION hsdg.can_assign_as_stream_lead(p_instance uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_employee_id() IS NOT NULL
     AND COALESCE((SELECT bulk_assign_scope FROM hsdg.firm_settings LIMIT 1), '') = 'managers_and_leads'
     AND EXISTS (
       SELECT 1
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rule_versions v ON v.id = ci.compliance_rule_version_id
         JOIN hsdg.engagement_services es ON es.engagement_id = ci.engagement_id
                                         AND es.status <> 'cancelled'
         JOIN hsdg.services s ON s.id = es.service_id AND s.stream = v.stream
        WHERE ci.id = p_instance
          AND es.lead_employee_id = hsdg.ctx_employee_id())
$$;
REVOKE ALL ON FUNCTION hsdg.can_assign_as_stream_lead(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.can_assign_as_stream_lead(uuid) TO hsdg_app;

CREATE POLICY tasks_insert_stream_lead ON hsdg.tasks
  FOR INSERT WITH CHECK (
    source_compliance_instance_id IS NOT NULL
    AND hsdg.can_assign_as_stream_lead(source_compliance_instance_id));
CREATE POLICY tasks_update_stream_lead ON hsdg.tasks
  FOR UPDATE USING (
    source_compliance_instance_id IS NOT NULL
    AND hsdg.can_assign_as_stream_lead(source_compliance_instance_id))
  WITH CHECK (
    source_compliance_instance_id IS NOT NULL
    AND hsdg.can_assign_as_stream_lead(source_compliance_instance_id));

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description)
  VALUES ('workflow.manage', 'Set the firm''s workflow policy, baseline and targets')
  ON CONFLICT (slug) DO NOTHING;

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM hsdg.roles r
JOIN hsdg.permissions p ON p.slug = 'workflow.manage'
WHERE r.slug IN ('managing_partner', 'partner')
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'workflow.manage');
DELETE FROM hsdg.permissions WHERE slug = 'workflow.manage';
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_update_stream_lead ON hsdg.tasks;
DROP POLICY IF EXISTS tasks_insert_stream_lead ON hsdg.tasks;
DROP FUNCTION IF EXISTS hsdg.can_assign_as_stream_lead(uuid);
DROP POLICY IF EXISTS firm_settings_update_partner ON hsdg.firm_settings;
ALTER TABLE hsdg.firm_settings
  DROP COLUMN IF EXISTS bulk_assign_scope,
  DROP COLUMN IF EXISTS client_reminder_channel,
  DROP COLUMN IF EXISTS article_client_scope,
  DROP COLUMN IF EXISTS default_reviewer;

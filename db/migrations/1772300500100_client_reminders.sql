-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-001 · a filing's chase history.
--
-- client_reminders — one row each time the team reminds a client about a
-- filing (POST /compliance-instances/:id/client-chase/remind, from the
-- portal, a filing run or the phone): when, by whom and by which channel
-- (e-mailed, opened in WhatsApp, or text to share). The filing's "Waiting on
-- the client" panel lists it, so nobody chases a client twice in a morning.
-- The audit event stays the record of truth; it is firm-wide only, so the
-- team reads this instead. Insert-only for the app; visible to the
-- engagement's team, as client_dependencies is.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.client_reminders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_instance_id uuid NOT NULL REFERENCES hsdg.compliance_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  channel                text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'copy')),
  sent_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  sent_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_reminders_instance_idx
  ON hsdg.client_reminders (compliance_instance_id, sent_at DESC);
CREATE INDEX client_reminders_engagement_idx ON hsdg.client_reminders (engagement_id);

REVOKE ALL ON hsdg.client_reminders FROM PUBLIC;
REVOKE ALL ON hsdg.client_reminders FROM hsdg_app;
GRANT SELECT, INSERT ON hsdg.client_reminders TO hsdg_app;

ALTER TABLE hsdg.client_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.client_reminders FORCE  ROW LEVEL SECURITY;

CREATE POLICY client_reminders_owner ON hsdg.client_reminders
  TO hsdg_migrator USING (true) WITH CHECK (true);
CREATE POLICY client_reminders_select ON hsdg.client_reminders
  FOR SELECT TO hsdg_app USING (hsdg.is_engagement_member(engagement_id));
-- A member records their own reminder, on a filing of that engagement.
CREATE POLICY client_reminders_insert ON hsdg.client_reminders
  FOR INSERT TO hsdg_app WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND sent_by_employee_id IS NOT DISTINCT FROM hsdg.ctx_employee_id()
    AND EXISTS (SELECT 1 FROM hsdg.compliance_instances ci
                 WHERE ci.id = compliance_instance_id AND ci.engagement_id = client_reminders.engagement_id)
  );

-- Down Migration

DROP TABLE IF EXISTS hsdg.client_reminders;

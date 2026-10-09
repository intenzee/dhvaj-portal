-- Up Migration

-- Section 01.5 — team independence declarations (DHVAJ Section 01 spec §8).
-- Each person on the engagement declares for themselves, once per audit file;
-- the segment shows a system-generated summary (required / completed /
-- pending) instead of the Manager re-entering team information. The people
-- required are the Engagement Partner, the Engagement Manager and the
-- engagement team, read live — a declaration row exists only once given.

CREATE TABLE hsdg.audit_independence_declarations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  status                text NOT NULL CHECK (status IN ('independent','threat_disclosed')),
  disclosure            text,
  declared_at           timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, employee_id),
  CONSTRAINT audit_independence_declarations_disclosure_needed CHECK (
    status = 'independent'
    OR (disclosure IS NOT NULL AND length(trim(disclosure)) > 0)
  )
);
CREATE INDEX audit_independence_declarations_engagement_idx
  ON hsdg.audit_independence_declarations (engagement_id);
CREATE TRIGGER audit_independence_declarations_set_updated_at
  BEFORE UPDATE ON hsdg.audit_independence_declarations
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_independence_declarations ENABLE ROW LEVEL SECURITY;
-- The team sees every declaration on its engagement…
CREATE POLICY audit_independence_declarations_select ON hsdg.audit_independence_declarations
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
-- …but a person only ever declares, or re-declares, for themselves.
CREATE POLICY audit_independence_declarations_insert ON hsdg.audit_independence_declarations
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND employee_id = hsdg.ctx_employee_id()
  );
CREATE POLICY audit_independence_declarations_update ON hsdg.audit_independence_declarations
  FOR UPDATE USING (employee_id = hsdg.ctx_employee_id())
  WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND employee_id = hsdg.ctx_employee_id()
  );
CREATE TRIGGER audit_independence_declarations_undo_capture
  AFTER INSERT OR UPDATE OR DELETE ON hsdg.audit_independence_declarations
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_undo_capture('id');

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_independence_declarations;

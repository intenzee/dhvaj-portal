-- Up Migration
-- 02.2 downstream actions (DHVAJ 02.2 spec §19). When Section 02 is approved
-- (02.9 AF-02) the approved 02.2 result activates its downstream actions —
-- the Ind AS / AS review framework (with the 02.3 Division routing), the SMC
-- exemptions/relaxations in the AS review methodology, and the Ind AS 101
-- transition work. One row per action per audit file: an approval activates
-- it; a later approval whose conclusion no longer calls for it withdraws it
-- (never deleted, so the history of what the file was told to do stays).
-- Work generation reads the activated rows to add the matching work areas and
-- procedures.

CREATE TABLE hsdg.audit_framework_downstream (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  action_key               text NOT NULL CHECK (action_key IN (
                             'ind_as_review','nbfc_division_iii','as_review','smc_relaxations',
                             'ind_as_101_transition')),
  status                   text NOT NULL CHECK (status IN ('activated','withdrawn')),
  framework                text,
  provision_code           text CHECK (provision_code IS NULL OR provision_code ~ '^[A-Z0-9_]{2,60}$'),
  work_area_key            text CHECK (work_area_key IS NULL OR work_area_key ~ '^[a-z0-9_]{2,60}$'),
  rule_version_id          uuid REFERENCES hsdg.audit_rule_version (id) ON DELETE SET NULL,
  activated_at             timestamptz NOT NULL DEFAULT now(),
  activated_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  withdrawn_at             timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, action_key)
);
CREATE INDEX audit_framework_downstream_engagement_idx
  ON hsdg.audit_framework_downstream (engagement_id);
CREATE TRIGGER audit_framework_downstream_set_updated_at
  BEFORE UPDATE ON hsdg.audit_framework_downstream
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

REVOKE DELETE ON hsdg.audit_framework_downstream FROM hsdg_app;
ALTER TABLE hsdg.audit_framework_downstream ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_framework_downstream_select ON hsdg.audit_framework_downstream
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_framework_downstream_insert ON hsdg.audit_framework_downstream
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_framework_downstream_update ON hsdg.audit_framework_downstream
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration
DROP TABLE IF EXISTS hsdg.audit_framework_downstream CASCADE;

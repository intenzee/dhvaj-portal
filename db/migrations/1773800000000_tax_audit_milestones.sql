-- ─────────────────────────────────────────────────────────────────────────
-- Tax audit milestones (Phase 5, F-9)
--
-- The firm works each tax audit to internal dates counted back from the
-- report's statutory due date (override, then CBDT extension, then statute),
-- so a slip shows weeks early, not on the last day (plan F.4):
--
--   applicability     Applicability confirmed                90 days  Manager
--   accepted          Accepted, appointment letter signed    75       Signing Partner
--   info_requests     Information requests sent              75       Senior
--   info_received     Client information received            60       Senior
--   clause_work       Clause work done                       30       Articles and Senior
--   review            Review done                            15       Manager
--   signed            Signed with UDIN                        7       Signing Partner
--   uploaded          Uploaded to the e-filing portal         5       Senior
--   client_accepted   Accepted by the client on the portal    2       Manager
--
--   · firm_settings.tax_audit_milestone_offsets holds the days before the
--     due date, one per milestone; the firm changes them in Workflow
--     settings (0–365 each).
--   · hsdg.tax_audit_milestones holds what the stage cannot say on its own:
--     a milestone ticked done (when and by whom) and the person the firm
--     named for it in place of the role's. A milestone is also done once the
--     audit's stage is past it — the desks move the stage — so no row is
--     needed for those; dates are worked out on read, so an extension or a
--     new offset moves them at once.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.firm_settings
  ADD COLUMN tax_audit_milestone_offsets jsonb NOT NULL DEFAULT
    '{"applicability":90,"accepted":75,"info_requests":75,"info_received":60,"clause_work":30,"review":15,"signed":7,"uploaded":5,"client_accepted":2}'::jsonb
    CHECK (jsonb_typeof(tax_audit_milestone_offsets) = 'object');

CREATE TABLE hsdg.tax_audit_milestones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_audit_id        uuid NOT NULL REFERENCES hsdg.tax_audits (id) ON DELETE CASCADE,
  milestone           text NOT NULL CHECK (milestone IN
                        ('applicability','accepted','info_requests','info_received',
                         'clause_work','review','signed','uploaded','client_accepted')),
  done_at             timestamptz,
  done_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- The person named for this milestone; null: the role's person.
  owner_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tax_audit_id, milestone),
  CHECK (done_at IS NOT NULL OR done_by_employee_id IS NULL)
);
CREATE INDEX tax_audit_milestones_owner_idx ON hsdg.tax_audit_milestones (owner_employee_id)
  WHERE owner_employee_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.tax_audit_milestones TO hsdg_app;
ALTER TABLE hsdg.tax_audit_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audit_milestones FORCE ROW LEVEL SECURITY;

-- Whoever sees (or works) the audit sees (or ticks) its milestones; the API
-- holds who may tick which, and who may name an owner.
CREATE POLICY tax_audit_milestones_select ON hsdg.tax_audit_milestones FOR SELECT TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.tax_audits a WHERE a.id = tax_audit_id));
CREATE POLICY tax_audit_milestones_insert ON hsdg.tax_audit_milestones FOR INSERT TO hsdg_app
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.tax_audits a WHERE a.id = tax_audit_id));
CREATE POLICY tax_audit_milestones_update ON hsdg.tax_audit_milestones FOR UPDATE TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.tax_audits a WHERE a.id = tax_audit_id))
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.tax_audits a WHERE a.id = tax_audit_id));
CREATE POLICY tax_audit_milestones_delete ON hsdg.tax_audit_milestones FOR DELETE TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.tax_audits a WHERE a.id = tax_audit_id));
CREATE POLICY purge_engagement ON hsdg.tax_audit_milestones TO hsdg_migrator
  USING (current_setting('hsdg.purging', true) = 'on')
  WITH CHECK (current_setting('hsdg.purging', true) = 'on');
CREATE POLICY erase_person ON hsdg.tax_audit_milestones TO hsdg_migrator
  USING (current_setting('hsdg.erasing_person', true) = 'on')
  WITH CHECK (current_setting('hsdg.erasing_person', true) = 'on');

CREATE TRIGGER tax_audit_milestones_set_updated_at BEFORE UPDATE ON hsdg.tax_audit_milestones
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Down Migration

DROP TABLE hsdg.tax_audit_milestones;
ALTER TABLE hsdg.firm_settings DROP COLUMN tax_audit_milestone_offsets;

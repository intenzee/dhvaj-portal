-- ─────────────────────────────────────────────────────────────────────────
-- 0048 · Statutory Audit — Completion / Reporting / Sign-off / Archive  (SA-8 · §27–§29)
--
-- SA-8 closes the ten-phase audit file (phases 07–10):
--
--   • COMPLETION (§27.07) and REPORTING (§27.08) are professional CHECKLISTS —
--     a fixed catalogue of items (subsequent events, going concern, auditor's
--     report, CARO, IFC …) each carried not_started → in_progress → complete
--     (or not_applicable). Seeded on provisioning like the §21 Planning sub-areas
--     so every engagement member can read them from the start of the file.
--
--   • PARTNER SIGN-OFF (§27.09) and ARCHIVING (§27.10) are recorded on the shell
--     itself (service_workflow_instances) — a completion approval, a sign-off and
--     an archive are each a single once-per-file event, so denormalised columns
--     are the right shape (no versioned child table). Sign-off is GATED
--     server-side (§28/§29): no OPEN BLOCKING review note, every active audit area
--     concluded, both checklists resolved. Archiving flips status → archived and
--     the service then rejects further writes (§37 immutable history).
--
-- SECURITY — engagement child data, same assignment-based access as the shell and
-- the SA-2..SA-7 tables: members SELECT, only leads (EP/manager) mutate. ENABLE
-- (not FORCE) RLS so the migrator-owned SECURITY DEFINER helpers bypass. No new
-- permission slug (endpoints reuse engagement.read / engagement.manage; RLS
-- gates). The sign-off/archive columns live on service_workflow_instances, which
-- already carries a lead-only UPDATE policy.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Completion / Reporting checklist items (§27.07, §27.08) ────────────────
CREATE TABLE hsdg.audit_completion_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Which SA-8 checklist this item belongs to.
  section               text NOT NULL CHECK (section IN ('completion','reporting')),
  item_key              text NOT NULL CHECK (item_key ~ '^[a-z0-9_]{2,60}$'),
  title                 text NOT NULL CHECK (length(trim(title)) > 0),
  -- not_applicable is first-class (CARO/IFC often do not apply) and counts as
  -- RESOLVED for the completion/sign-off gate.
  state                 text NOT NULL DEFAULT 'not_started' CHECK (state IN
                          ('not_started','in_progress','complete','not_applicable')),
  note                  text,
  updated_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  content_updated_at    timestamptz,
  sort_order            integer NOT NULL,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, section, item_key)
);
CREATE INDEX audit_completion_items_instance_idx
  ON hsdg.audit_completion_items (workflow_instance_id);
CREATE INDEX audit_completion_items_engagement_idx
  ON hsdg.audit_completion_items (engagement_id);
CREATE TRIGGER audit_completion_items_set_updated_at
  BEFORE UPDATE ON hsdg.audit_completion_items
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_completion_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_completion_items_select ON hsdg.audit_completion_items
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_completion_items_insert ON hsdg.audit_completion_items
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_completion_items_update ON hsdg.audit_completion_items
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── Sign-off / archive state on the shell (§27.09, §27.10) ─────────────────
-- Each is a single once-per-file event; denormalised columns, not a child table.
ALTER TABLE hsdg.service_workflow_instances
  ADD COLUMN completion_approved_at         timestamptz,
  ADD COLUMN completion_approved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN completion_memo                text,
  ADD COLUMN signed_off_at                  timestamptz,
  ADD COLUMN signed_off_by_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN signoff_memo                   text,
  ADD COLUMN archived_at                    timestamptz,
  ADD COLUMN archived_by_employee_id        uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN archive_note                   text;

-- ── Seed both checklists for every EXISTING statutory-audit shell ──────────
-- New shells are seeded at provision time (idempotent, ON CONFLICT DO NOTHING).
INSERT INTO hsdg.audit_completion_items
  (workflow_instance_id, engagement_id, section, item_key, title, sort_order)
SELECT wi.id, wi.engagement_id, seed.section, seed.item_key, seed.title, seed.sort_order
  FROM hsdg.service_workflow_instances wi
  CROSS JOIN (VALUES
    ('completion', 'subsequent_events', 'Subsequent Events', 1),
    ('completion', 'going_concern', 'Going Concern', 2),
    ('completion', 'misstatements', 'Misstatements Summary', 3),
    ('completion', 'final_analytics', 'Final Analytical Review', 4),
    ('completion', 'fs_final_review', 'FS Final Review', 5),
    ('completion', 'disclosure_review', 'Disclosure Review', 6),
    ('completion', 'completion_memo', 'Completion Memo', 7),
    ('reporting', 'auditors_report', 'Auditor''s Report', 1),
    ('reporting', 'caro', 'CARO', 2),
    ('reporting', 'ifc', 'IFC Report', 3),
    ('reporting', 'rule_11_143', 'Rule 11 / Section 143', 4),
    ('reporting', 'other_reports', 'Other Reports / Certificates', 5)
  ) AS seed(section, item_key, title, sort_order)
  WHERE wi.workflow_key = 'statutory_audit'
ON CONFLICT (workflow_instance_id, section, item_key) DO NOTHING;

-- Down Migration

ALTER TABLE hsdg.service_workflow_instances
  DROP COLUMN IF EXISTS completion_approved_at,
  DROP COLUMN IF EXISTS completion_approved_by_employee_id,
  DROP COLUMN IF EXISTS completion_memo,
  DROP COLUMN IF EXISTS signed_off_at,
  DROP COLUMN IF EXISTS signed_off_by_employee_id,
  DROP COLUMN IF EXISTS signoff_memo,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS archived_by_employee_id,
  DROP COLUMN IF EXISTS archive_note;

DROP TABLE IF EXISTS hsdg.audit_completion_items CASCADE;

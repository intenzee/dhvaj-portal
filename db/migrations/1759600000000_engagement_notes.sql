-- ─────────────────────────────────────────────────────────────────────────
-- 0032 · Engagement Notes  (spec §26 "Notes — professional notes")
--
-- A shared engagement notebook. Any team MEMBER may read and add a note; a note
-- may be edited or removed only by its AUTHOR or an engagement LEAD. Notes can
-- optionally be scoped to a service line or a component (the §27/§28 "Notes"
-- sub-panels reuse the same store, filtered), and pinned to the top.
--
-- STRICTLY ADDITIVE — engagement-scoped RLS, no change to any existing object.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.engagement_notes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Optional narrowing so the same store backs the engagement/service/component
  -- Notes panels (§26/§27/§28). NULL = engagement-level note.
  engagement_service_id   uuid REFERENCES hsdg.engagement_services (id) ON DELETE CASCADE,
  engagement_component_id uuid REFERENCES hsdg.engagement_components (id) ON DELETE CASCADE,
  author_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  body                  text NOT NULL CHECK (length(trim(body)) > 0),
  is_pinned             boolean NOT NULL DEFAULT false,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engagement_notes_engagement_idx ON hsdg.engagement_notes (engagement_id);
CREATE INDEX engagement_notes_service_idx    ON hsdg.engagement_notes (engagement_service_id);
CREATE INDEX engagement_notes_component_idx  ON hsdg.engagement_notes (engagement_component_id);
CREATE TRIGGER engagement_notes_set_updated_at BEFORE UPDATE ON hsdg.engagement_notes
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── RLS: members read & add; author-or-lead edits & removes ───────────────
ALTER TABLE hsdg.engagement_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_notes FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_notes_select ON hsdg.engagement_notes
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_notes_insert ON hsdg.engagement_notes
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_notes_update ON hsdg.engagement_notes
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR author_employee_id = hsdg.ctx_employee_id()
  ) WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR author_employee_id = hsdg.ctx_employee_id()
  );
CREATE POLICY engagement_notes_delete ON hsdg.engagement_notes
  FOR DELETE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR author_employee_id = hsdg.ctx_employee_id()
  );

-- Down Migration
DROP POLICY IF EXISTS engagement_notes_delete ON hsdg.engagement_notes;
DROP POLICY IF EXISTS engagement_notes_update ON hsdg.engagement_notes;
DROP POLICY IF EXISTS engagement_notes_insert ON hsdg.engagement_notes;
DROP POLICY IF EXISTS engagement_notes_select ON hsdg.engagement_notes;
DROP TABLE IF EXISTS hsdg.engagement_notes CASCADE;

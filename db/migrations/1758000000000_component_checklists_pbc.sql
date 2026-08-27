-- ─────────────────────────────────────────────────────────────────────────
-- 0027 · Per-component checklists & PBC linkage  (spec §13/§17)
--
-- Adds the "config depth" the component layer was missing:
--   • a per-component CHECKLIST — the steps to complete a component's work,
--     seeded from an optional template on the catalogue component and tickable
--     by any engagement member;
--   • a PBC link — a client dependency (Provided-By-Client request) can now be
--     attached to the component it belongs to.
-- Both ADDITIVE. Engagement-scoped RLS mirrors the component layer (members
-- read/tick, leads manage structure).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Catalogue: an optional default checklist per component ─────────────────
ALTER TABLE hsdg.service_components ADD COLUMN checklist_template text[];

-- ── Per-engagement component checklist items ──────────────────────────────
CREATE TABLE hsdg.engagement_component_checklist (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_component_id uuid NOT NULL REFERENCES hsdg.engagement_components (id) ON DELETE CASCADE,
  -- Denormalised from the parent config (synced by trigger) so RLS can key on
  -- the engagement directly, like engagement_services.
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  label                   text NOT NULL CHECK (length(trim(label)) > 0),
  sequence                integer NOT NULL DEFAULT 0,
  is_done                 boolean NOT NULL DEFAULT false,
  done_by_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  done_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engagement_component_checklist_component_idx
  ON hsdg.engagement_component_checklist (engagement_component_id);
CREATE INDEX engagement_component_checklist_engagement_idx
  ON hsdg.engagement_component_checklist (engagement_id);
CREATE TRIGGER engagement_component_checklist_set_updated_at
  BEFORE UPDATE ON hsdg.engagement_component_checklist
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Keep engagement_id authoritative from the parent config, and enforce that the
-- (denormalised) engagement matches the component's engagement.
CREATE OR REPLACE FUNCTION hsdg.sync_checklist_engagement() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT ec.engagement_id INTO NEW.engagement_id
  FROM hsdg.engagement_components ec WHERE ec.id = NEW.engagement_component_id;
  IF NEW.engagement_id IS NULL THEN
    RAISE EXCEPTION 'checklist item references an unknown engagement component.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagement_component_checklist_sync
  BEFORE INSERT OR UPDATE OF engagement_component_id ON hsdg.engagement_component_checklist
  FOR EACH ROW EXECUTE FUNCTION hsdg.sync_checklist_engagement();

-- Keep done_by/done_at consistent with is_done (a plain integrity trigger).
CREATE OR REPLACE FUNCTION hsdg.checklist_done_stamp() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_done AND NOT COALESCE(OLD.is_done, false) THEN
    NEW.done_at := now();
    NEW.done_by_employee_id := COALESCE(NEW.done_by_employee_id, hsdg.ctx_employee_id());
  ELSIF NOT NEW.is_done THEN
    NEW.done_at := NULL;
    NEW.done_by_employee_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagement_component_checklist_done_stamp
  BEFORE INSERT OR UPDATE OF is_done ON hsdg.engagement_component_checklist
  FOR EACH ROW EXECUTE FUNCTION hsdg.checklist_done_stamp();

-- ── PBC: attach a client dependency to the component it belongs to ─────────
ALTER TABLE hsdg.client_dependencies
  ADD COLUMN engagement_component_id uuid REFERENCES hsdg.engagement_components (id) ON DELETE SET NULL;
CREATE INDEX client_dependencies_component_idx
  ON hsdg.client_dependencies (engagement_component_id);

-- The attached component must belong to the dependency's own engagement.
CREATE OR REPLACE FUNCTION hsdg.enforce_client_dependency_component() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.engagement_component_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM hsdg.engagement_components ec
    WHERE ec.id = NEW.engagement_component_id AND ec.engagement_id = NEW.engagement_id
  ) THEN
    RAISE EXCEPTION 'the linked component must belong to this engagement.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER client_dependencies_component_guard
  BEFORE INSERT OR UPDATE OF engagement_component_id, engagement_id ON hsdg.client_dependencies
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_client_dependency_component();

-- ── Seed realistic checklist templates on the catalogue ───────────────────
ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.service_components SET checklist_template = ARRAY[
  'Reconcile outward supplies', 'Reconcile ITC against GSTR-2B',
  'Compute tax payable', 'Generate challan & pay', 'File GSTR-3B'
] WHERE code = 'GSTR3B';
UPDATE hsdg.service_components SET checklist_template = ARRAY[
  'Compile invoice-level outward supplies', 'Validate counter-party GSTINs', 'File GSTR-1'
] WHERE code = 'GSTR1';
UPDATE hsdg.service_components SET checklist_template = ARRAY[
  'Finalise computation of income', 'Reconcile 26AS / AIS', 'E-file the return', 'E-verify'
] WHERE code = 'ITR_FILE';
UPDATE hsdg.service_components SET checklist_template = ARRAY[
  'Finalise Form 3CD annexure', 'Partner review', 'Upload & file the tax-audit report'
] WHERE code = 'TA_FILING';
ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;

-- ── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE hsdg.engagement_component_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_component_checklist FORCE  ROW LEVEL SECURITY;
-- Members see and tick items; leads manage the list structure (add/remove).
CREATE POLICY engagement_component_checklist_select ON hsdg.engagement_component_checklist
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_component_checklist_insert ON hsdg.engagement_component_checklist
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_component_checklist_update ON hsdg.engagement_component_checklist
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_component_checklist_delete ON hsdg.engagement_component_checklist
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.engagement_component_checklist CASCADE;
DROP FUNCTION IF EXISTS hsdg.sync_checklist_engagement();
DROP FUNCTION IF EXISTS hsdg.checklist_done_stamp();

DROP TRIGGER IF EXISTS client_dependencies_component_guard ON hsdg.client_dependencies;
DROP FUNCTION IF EXISTS hsdg.enforce_client_dependency_component();
DROP INDEX IF EXISTS hsdg.client_dependencies_component_idx;
ALTER TABLE hsdg.client_dependencies DROP COLUMN IF EXISTS engagement_component_id;

ALTER TABLE hsdg.service_components DROP COLUMN IF EXISTS checklist_template;

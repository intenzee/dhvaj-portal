-- ─────────────────────────────────────────────────────────────────────────
-- 0028 · Group & multi-entity engagements  (spec §5–§6, §30)
--
-- Two additions, both ADDITIVE (mirrors the multi-service work in 0024):
--   • entity_groups — a named CLIENT GROUP; entities gain an optional group_id
--     so a holding + its subsidiaries can be managed as one group (§5–§6).
--   • engagement_entities — the entity-coverage grain that lets ONE engagement
--     cover several entities (a group audit over parent + subsidiaries, §30).
--     Every existing engagement is backfilled to one PRIMARY covered entity from
--     its current entity_id; engagements.entity_id is KEPT as the primary/legacy
--     pointer and remains the engagement's identity anchor (entity + service +
--     FY + period is unchanged — additional entities are "covered", not identity).
--
-- Access follows coverage: being on an engagement grants visibility of every
-- entity it covers (the can_access_entity_via_engagement helper is extended).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Client groups (§5–§6) ─────────────────────────────────────────────────
CREATE TABLE hsdg.entity_groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,30}$'),
  name           text NOT NULL CHECK (length(trim(name)) > 0),
  description    text,
  home_office_id uuid NOT NULL REFERENCES hsdg.offices (id) ON DELETE RESTRICT,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_groups_office_idx ON hsdg.entity_groups (home_office_id);
CREATE TRIGGER entity_groups_set_updated_at BEFORE UPDATE ON hsdg.entity_groups
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.entities
  ADD COLUMN group_id uuid REFERENCES hsdg.entity_groups (id) ON DELETE SET NULL;
CREATE INDEX entities_group_idx ON hsdg.entities (group_id);

-- Office-scoped, like entities (fail-closed).
ALTER TABLE hsdg.entity_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_groups FORCE  ROW LEVEL SECURITY;
CREATE POLICY entity_groups_select ON hsdg.entity_groups
  FOR SELECT USING (hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id());
CREATE POLICY entity_groups_insert ON hsdg.entity_groups
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id());
CREATE POLICY entity_groups_update ON hsdg.entity_groups
  FOR UPDATE USING (hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id())
  WITH CHECK (hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id());

-- ── Multi-entity coverage (§30) ───────────────────────────────────────────
CREATE TABLE hsdg.engagement_entities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE RESTRICT,
  -- Exactly one primary covered entity (the legacy engagements.entity_id).
  is_primary    boolean NOT NULL DEFAULT false,
  role          text NOT NULL DEFAULT 'covered'
                  CHECK (role IN ('primary','covered','parent','subsidiary')),
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','removed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_entities_unique UNIQUE (engagement_id, entity_id)
);
CREATE INDEX engagement_entities_engagement_idx ON hsdg.engagement_entities (engagement_id);
CREATE INDEX engagement_entities_entity_idx ON hsdg.engagement_entities (entity_id);
CREATE UNIQUE INDEX engagement_entities_one_primary
  ON hsdg.engagement_entities (engagement_id) WHERE is_primary;
CREATE TRIGGER engagement_entities_set_updated_at BEFORE UPDATE ON hsdg.engagement_entities
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Backfill one PRIMARY covered entity per existing engagement (before RLS FORCE).
INSERT INTO hsdg.engagement_entities (engagement_id, entity_id, is_primary, role)
SELECT id, entity_id, true, 'primary' FROM hsdg.engagements;

-- Auto-create the primary coverage row for every NEW engagement.
CREATE OR REPLACE FUNCTION hsdg.engagement_entities_create_primary() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO hsdg.engagement_entities (engagement_id, entity_id, is_primary, role)
  VALUES (NEW.id, NEW.entity_id, true, 'primary');
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagements_create_primary_entity
  AFTER INSERT ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.engagement_entities_create_primary();

-- RLS: engagement-scoped (members read; leads write), like engagement_services.
REVOKE DELETE ON hsdg.engagement_entities FROM hsdg_app;
ALTER TABLE hsdg.engagement_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_entities FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_entities_select ON hsdg.engagement_entities
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_entities_insert ON hsdg.engagement_entities
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_entities_update ON hsdg.engagement_entities
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── Extend entity access to cover the multi-entity grain ──────────────────
-- Being on an engagement now grants visibility of every entity it COVERS, not
-- only its primary entity.
CREATE OR REPLACE FUNCTION hsdg.can_access_entity_via_engagement(ent_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_employee_id() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM hsdg.engagements e
      WHERE e.entity_id = ent_id AND hsdg.is_engagement_member(e.id)
    )
    OR EXISTS (
      SELECT 1 FROM hsdg.engagement_entities ee
      WHERE ee.entity_id = ent_id AND ee.status = 'active'
        AND hsdg.is_engagement_member(ee.engagement_id)
    )
  )
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.can_access_entity_via_engagement(ent_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM hsdg.engagements e
    WHERE e.entity_id = ent_id AND hsdg.is_engagement_member(e.id)
  )
$$;

DROP POLICY IF EXISTS engagement_entities_update ON hsdg.engagement_entities;
DROP POLICY IF EXISTS engagement_entities_insert ON hsdg.engagement_entities;
DROP POLICY IF EXISTS engagement_entities_select ON hsdg.engagement_entities;
DROP TRIGGER IF EXISTS engagements_create_primary_entity ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.engagement_entities_create_primary();
DROP TABLE IF EXISTS hsdg.engagement_entities CASCADE;

DROP POLICY IF EXISTS entity_groups_update ON hsdg.entity_groups;
DROP POLICY IF EXISTS entity_groups_insert ON hsdg.entity_groups;
DROP POLICY IF EXISTS entity_groups_select ON hsdg.entity_groups;
DROP INDEX IF EXISTS hsdg.entities_group_idx;
ALTER TABLE hsdg.entities DROP COLUMN IF EXISTS group_id;
DROP TABLE IF EXISTS hsdg.entity_groups CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- 0039 · Client layer  (spec §2, §31; ADR-0033)
--
-- Introduce hsdg.clients — the COMMERCIAL RELATIONSHIP HSDG maintains — above
-- entities and entity_groups. entities.client_id is a NULLABLE FK: an entity can
-- be created before its client record is finalised (progressive completion, §5).
--
-- Every existing entity is backfilled to one client (named from its legal_name,
-- same home office) so nothing is orphaned. clients reuses entity.read /
-- entity.manage — no new permission. Office-scoped, fail-closed RLS like
-- entities. Audit stays at the service layer (Phase B).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- Human-friendly auto codes: CLI00001, CLI00002, …
CREATE SEQUENCE hsdg.client_code_seq;

CREATE TABLE hsdg.clients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_code    text NOT NULL UNIQUE
                   DEFAULT 'CLI' || lpad(nextval('hsdg.client_code_seq')::text, 5, '0'),
  -- Commercial / client-facing name (§6 "Client Name").
  name           text NOT NULL CHECK (length(trim(name)) > 0),
  -- Internal short name (§6).
  short_name     text,
  -- Individual/Proprietor · Legal Entity · Group/Business Family entry point (§3).
  client_kind    text NOT NULL DEFAULT 'legal_entity'
                   CHECK (client_kind IN ('individual','legal_entity','group')),
  home_office_id uuid NOT NULL REFERENCES hsdg.offices (id) ON DELETE RESTRICT,
  -- A client may span a group (§2); optional.
  group_id       uuid REFERENCES hsdg.entity_groups (id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive','archived')),
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clients_office_idx ON hsdg.clients (home_office_id);
CREATE INDEX clients_group_idx  ON hsdg.clients (group_id);
CREATE INDEX clients_status_idx ON hsdg.clients (status);
CREATE INDEX clients_name_trgm  ON hsdg.clients USING gin (lower(name) gin_trgm_ops);
CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON hsdg.clients
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Entities point at their client relationship (nullable for progressive create).
ALTER TABLE hsdg.entities
  ADD COLUMN client_id uuid REFERENCES hsdg.clients (id) ON DELETE SET NULL;
CREATE INDEX entities_client_idx ON hsdg.entities (client_id);

-- ── Backfill: one client per existing entity (BEFORE enabling FORCE RLS) ───
-- entities and entity_types are FORCE-RLS, so even the migrator (owner) is
-- filtered to zero rows with no security context. Temporarily drop FORCE to
-- read/write during the backfill, then restore it (the established idiom — see
-- 1760100000000_workflow_families_master.sql). clients is not yet FORCE here.
ALTER TABLE hsdg.entities     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_types NO FORCE ROW LEVEL SECURITY;

-- Deterministic 1:1 backfill, per-row so duplicate legal names stay distinct.
-- client_kind is derived from the entity's legal category so individuals and
-- proprietors are not mislabelled as legal entities (§3).
DO $$
DECLARE
  r record;
  new_id uuid;
BEGIN
  FOR r IN
    SELECT e.id, e.legal_name, e.home_office_id, e.group_id,
           CASE WHEN t.category IN ('individual','proprietorship') THEN 'individual'
                ELSE 'legal_entity' END AS kind
    FROM hsdg.entities e
    JOIN hsdg.entity_types t ON t.id = e.entity_type_id
    WHERE e.client_id IS NULL
  LOOP
    INSERT INTO hsdg.clients (name, home_office_id, group_id, client_kind)
    VALUES (r.legal_name, r.home_office_id, r.group_id, r.kind)
    RETURNING id INTO new_id;
    UPDATE hsdg.entities SET client_id = new_id WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE hsdg.entity_types FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entities     FORCE ROW LEVEL SECURITY;

-- ── Row Level Security (office-scoped, fail-closed; mirrors entities) ──────
ALTER TABLE hsdg.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.clients FORCE  ROW LEVEL SECURITY;

CREATE POLICY clients_select ON hsdg.clients
  FOR SELECT USING (hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id());
CREATE POLICY clients_insert ON hsdg.clients
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id());
CREATE POLICY clients_update ON hsdg.clients
  FOR UPDATE USING (hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id())
  WITH CHECK (hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id());
CREATE POLICY clients_delete ON hsdg.clients
  FOR DELETE USING (hsdg.ctx_is_firmwide());

-- Down Migration

DROP INDEX IF EXISTS hsdg.entities_client_idx;
ALTER TABLE hsdg.entities DROP COLUMN IF EXISTS client_id;
DROP TABLE IF EXISTS hsdg.clients CASCADE;
DROP SEQUENCE IF EXISTS hsdg.client_code_seq;

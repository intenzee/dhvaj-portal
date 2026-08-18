-- ─────────────────────────────────────────────────────────────────────────
-- 0006 · Entity Master (clients)
--
-- The client registry: entities, their statutory registrations, and contacts.
-- Reuses the security-context helpers and RLS posture from earlier migrations.
--
-- Access model (see ADR-0006): entities are office-scoped by a "home office"
-- (the office that owns the client relationship). Firm-wide roles see/manage
-- everything; office-scoped roles see/manage only their office's clients.
-- Engagement-level access layers on top in Phase 5. Fail-closed with no context.
--
-- Duplicate detection: a partial unique index on PAN blocks true duplicates;
-- pg_trgm powers a soft, fuzzy name search used before creation.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Extensions live in the public schema, which we deliberately locked down. The
-- app role must be able to CALL their functions (e.g. pg_trgm's similarity()),
-- so grant USAGE on public. CREATE stays revoked and public holds no app data,
-- so this does not weaken the posture.
GRANT USAGE ON SCHEMA public TO hsdg_app;

-- ── Entity types (reference/config) ───────────────────────────────────────

CREATE TABLE hsdg.entity_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name       text NOT NULL,
  -- Broad legal category, drives which registrations are expected.
  category   text NOT NULL CHECK (category IN
                ('company','llp','partnership','proprietorship','individual',
                 'huf','trust','society','aop','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER entity_types_set_updated_at BEFORE UPDATE ON hsdg.entity_types
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Entities ──────────────────────────────────────────────────────────────

-- Human-friendly auto codes: ENT00001, ENT00002, …
CREATE SEQUENCE hsdg.entity_code_seq;

CREATE TABLE hsdg.entities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_code     text NOT NULL UNIQUE
                    DEFAULT 'ENT' || lpad(nextval('hsdg.entity_code_seq')::text, 5, '0'),
  legal_name      text NOT NULL CHECK (length(trim(legal_name)) > 0),
  display_name    text,
  entity_type_id  uuid NOT NULL REFERENCES hsdg.entity_types (id) ON DELETE RESTRICT,
  -- Primary tax identity. Nullable (a prospect may not have one yet) but unique
  -- when present — the hard duplicate guard.
  pan             text CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  home_office_id  uuid NOT NULL REFERENCES hsdg.offices (id) ON DELETE RESTRICT,
  -- Group structure (holding/parent). Related-party detail can extend later.
  parent_entity_id uuid REFERENCES hsdg.entities (id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('prospect','active','inactive','archived')),
  incorporation_date date,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entities_no_self_parent CHECK (parent_entity_id IS NULL OR parent_entity_id <> id)
);
CREATE UNIQUE INDEX entities_pan_unique ON hsdg.entities (pan) WHERE pan IS NOT NULL;
CREATE INDEX entities_office_idx ON hsdg.entities (home_office_id);
CREATE INDEX entities_type_idx ON hsdg.entities (entity_type_id);
CREATE INDEX entities_status_idx ON hsdg.entities (status);
CREATE INDEX entities_parent_idx ON hsdg.entities (parent_entity_id);
-- Trigram index for fuzzy legal-name duplicate search.
CREATE INDEX entities_legal_name_trgm ON hsdg.entities USING gin (lower(legal_name) gin_trgm_ops);
CREATE TRIGGER entities_set_updated_at BEFORE UPDATE ON hsdg.entities
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Registrations (0..n per entity; e.g. GSTIN per state) ─────────────────

CREATE TABLE hsdg.entity_registrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  registration_type   text NOT NULL CHECK (registration_type IN
                        ('gstin','cin','llpin','tan','iec','pt','esic','pf','other')),
  registration_number text NOT NULL CHECK (length(trim(registration_number)) > 0),
  -- GSTIN is state-specific; two-letter/again free-form state code.
  state_code          text,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','inactive','cancelled','suspended')),
  valid_from          date,
  valid_to            date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- The same number can't be recorded twice for a type.
  CONSTRAINT entity_registrations_number_unique UNIQUE (registration_type, registration_number),
  CONSTRAINT entity_registrations_valid_range CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX entity_registrations_entity_idx ON hsdg.entity_registrations (entity_id);
CREATE TRIGGER entity_registrations_set_updated_at BEFORE UPDATE ON hsdg.entity_registrations
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Contacts / signatories ────────────────────────────────────────────────

CREATE TABLE hsdg.entity_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  full_name    text NOT NULL CHECK (length(trim(full_name)) > 0),
  designation  text,
  email        citext,
  phone        text,
  is_primary   boolean NOT NULL DEFAULT false,
  is_signatory boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_contacts_entity_idx ON hsdg.entity_contacts (entity_id);
-- At most one primary contact per entity.
CREATE UNIQUE INDEX entity_contacts_one_primary ON hsdg.entity_contacts (entity_id)
  WHERE is_primary;
CREATE TRIGGER entity_contacts_set_updated_at BEFORE UPDATE ON hsdg.entity_contacts
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Seed entity types (before FORCE RLS) ──────────────────────────────────

INSERT INTO hsdg.entity_types (slug, name, category) VALUES
  ('private_limited', 'Private Limited Company', 'company'),
  ('public_limited',  'Public Limited Company',  'company'),
  ('opc',             'One Person Company',      'company'),
  ('llp',             'Limited Liability Partnership', 'llp'),
  ('partnership',     'Partnership Firm',        'partnership'),
  ('proprietorship',  'Proprietorship',          'proprietorship'),
  ('individual',      'Individual',              'individual'),
  ('huf',             'Hindu Undivided Family',  'huf'),
  ('trust',           'Trust',                   'trust'),
  ('society',         'Society',                 'society'),
  ('aop',             'Association of Persons',  'aop');

-- ── Permissions (toggle FORCE on reference tables we read/write) ──────────

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description) VALUES
  ('entity.read',   'View client entities within permitted scope'),
  ('entity.manage', 'Create and modify client entities');

-- entity.read: all staff (RLS still scopes rows to the office)
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'entity.read';

-- entity.manage: managing_partner, admin, and partners (own their clients)
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'entity.manage'
WHERE r.slug IN ('managing_partner', 'admin', 'partner');

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── Privileges: entity_types is migration-managed ─────────────────────────
REVOKE INSERT, UPDATE, DELETE ON hsdg.entity_types FROM hsdg_app;

-- ── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE hsdg.entity_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_types         FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.entities             ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entities             FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_registrations FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_contacts      FORCE  ROW LEVEL SECURITY;

-- Entity types: any authenticated context reads; nobody writes via the app.
CREATE POLICY entity_types_read ON hsdg.entity_types
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);

-- Entities: firm-wide sees all; office-scoped sees/manages only its own office.
-- Fail-closed: no context ⇒ no rows.
CREATE POLICY entities_select ON hsdg.entities
  FOR SELECT USING (
    hsdg.ctx_is_firmwide()
    OR home_office_id = hsdg.ctx_office_id()
  );
CREATE POLICY entities_insert ON hsdg.entities
  FOR INSERT WITH CHECK (
    hsdg.ctx_is_firmwide()
    OR home_office_id = hsdg.ctx_office_id()
  );
CREATE POLICY entities_update ON hsdg.entities
  FOR UPDATE USING (
    hsdg.ctx_is_firmwide()
    OR home_office_id = hsdg.ctx_office_id()
  ) WITH CHECK (
    hsdg.ctx_is_firmwide()
    OR home_office_id = hsdg.ctx_office_id()
  );
CREATE POLICY entities_delete ON hsdg.entities
  FOR DELETE USING (hsdg.ctx_is_firmwide());

-- Child rows follow the visibility/writability of their entity.
CREATE POLICY entity_registrations_all ON hsdg.entity_registrations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM hsdg.entities e
      WHERE e.id = entity_registrations.entity_id
        AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM hsdg.entities e
      WHERE e.id = entity_registrations.entity_id
        AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id())
    )
  );
CREATE POLICY entity_contacts_all ON hsdg.entity_contacts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM hsdg.entities e
      WHERE e.id = entity_contacts.entity_id
        AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM hsdg.entities e
      WHERE e.id = entity_contacts.entity_id
        AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id())
    )
  );

-- Down Migration

REVOKE USAGE ON SCHEMA public FROM hsdg_app;

DROP TABLE IF EXISTS hsdg.entity_contacts CASCADE;
DROP TABLE IF EXISTS hsdg.entity_registrations CASCADE;
DROP TABLE IF EXISTS hsdg.entities CASCADE;
DROP SEQUENCE IF EXISTS hsdg.entity_code_seq;
DROP TABLE IF EXISTS hsdg.entity_types CASCADE;

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug IN ('entity.read', 'entity.manage'));
DELETE FROM hsdg.permissions WHERE slug IN ('entity.read', 'entity.manage');
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

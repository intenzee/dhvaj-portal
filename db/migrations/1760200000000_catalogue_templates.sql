-- ─────────────────────────────────────────────────────────────────────────
-- 0037 · Reusable, versioned catalogue templates + workflow versions (§18/§25/§27)
--
-- The Master §25/§27 requires reusable, effective-dated/versioned masters for
-- the configuration layers a service loads: Checklist, PBC, Document-Requirement
-- and Workflow. This migration adds them, mirroring the compliance_rules /
-- compliance_rule_versions pattern (a parent identity + append-only, effective-
-- dated version snapshots).
--
--   • catalogue_templates + catalogue_template_versions — ONE reusable master
--     covering all three list-shaped template kinds via a `template_type`
--     discriminator ('checklist' | 'pbc' | 'document_requirement'). §27 sketches
--     three tables; a single typed master delivers the same "reusable/versioned
--     template" capability with one RLS surface and one API (see ADR-0029). Each
--     version carries its item list as JSONB `body`.
--   • workflow_versions — effective-dated definition pointer per workflow family
--     (§25 "Workflow Version"). v1 is seeded for every existing family; an
--     engagement snapshots the active version at start.
--   • Definition links on service_components (which template a component loads)
--     and version snapshots on engagement_components + engagements (which
--     version a configuration actually used) — mirroring the existing
--     compliance_rule_version_id snapshot.
--
-- Additive and backward-compatible: the legacy service_components.checklist_
-- template text[] is left in place. Version tables are append-only (UPDATE/
-- DELETE revoked from hsdg_app), so a snapshot can never be silently rewritten.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Template master (identity) ─────────────────────────────────────────
CREATE TABLE hsdg.catalogue_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type text NOT NULL CHECK (template_type IN ('checklist','pbc','document_requirement')),
  code          text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,50}$'),
  name          text NOT NULL,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalogue_templates_type_idx ON hsdg.catalogue_templates (template_type);
CREATE TRIGGER catalogue_templates_set_updated_at BEFORE UPDATE ON hsdg.catalogue_templates
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 2. Template versions (effective-dated; append-only) ───────────────────
CREATE TABLE hsdg.catalogue_template_versions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_template_id uuid NOT NULL REFERENCES hsdg.catalogue_templates (id) ON DELETE CASCADE,
  version               integer NOT NULL,
  effective_from        date NOT NULL,
  effective_to          date,
  -- The template's items for this version, e.g.
  --   {"items":[{"label":"Bank reconciliation","sequence":1,"mandatory":true}]}
  body                  jsonb NOT NULL DEFAULT '{"items":[]}'::jsonb,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogue_template_versions_unique UNIQUE (catalogue_template_id, version),
  CONSTRAINT catalogue_template_versions_effective_unique UNIQUE (catalogue_template_id, effective_from),
  CONSTRAINT catalogue_template_versions_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT catalogue_template_versions_body_items CHECK (jsonb_typeof(body -> 'items') = 'array')
);
CREATE INDEX catalogue_template_versions_template_idx
  ON hsdg.catalogue_template_versions (catalogue_template_id, effective_from DESC);

-- ── 3. Workflow versions (effective-dated definition pointer per family) ───
CREATE TABLE hsdg.workflow_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_family_id uuid NOT NULL REFERENCES hsdg.workflow_families (id) ON DELETE CASCADE,
  version            integer NOT NULL,
  effective_from     date NOT NULL,
  effective_to       date,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_versions_unique UNIQUE (workflow_family_id, version),
  CONSTRAINT workflow_versions_effective_unique UNIQUE (workflow_family_id, effective_from),
  CONSTRAINT workflow_versions_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX workflow_versions_family_idx
  ON hsdg.workflow_versions (workflow_family_id, effective_from DESC);

-- ── 4. Definition links (catalogue) + version snapshots (configuration) ────
ALTER TABLE hsdg.service_components
  ADD COLUMN checklist_template_id             uuid REFERENCES hsdg.catalogue_templates (id) ON DELETE SET NULL,
  ADD COLUMN pbc_template_id                   uuid REFERENCES hsdg.catalogue_templates (id) ON DELETE SET NULL,
  ADD COLUMN document_requirement_template_id  uuid REFERENCES hsdg.catalogue_templates (id) ON DELETE SET NULL;

ALTER TABLE hsdg.engagement_components
  ADD COLUMN checklist_template_version_id            uuid REFERENCES hsdg.catalogue_template_versions (id) ON DELETE RESTRICT,
  ADD COLUMN pbc_template_version_id                  uuid REFERENCES hsdg.catalogue_template_versions (id) ON DELETE RESTRICT,
  ADD COLUMN document_requirement_template_version_id uuid REFERENCES hsdg.catalogue_template_versions (id) ON DELETE RESTRICT;

ALTER TABLE hsdg.engagements
  ADD COLUMN workflow_version_id uuid REFERENCES hsdg.workflow_versions (id) ON DELETE RESTRICT;

-- ── 5. Seed workflow v1 for every existing family ─────────────────────────
-- The seed reads workflow_families; drop FORCE so the migrator (no ctx) can.
ALTER TABLE hsdg.workflow_families NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.workflow_versions (workflow_family_id, version, effective_from)
SELECT id, 1, DATE '2017-04-01' FROM hsdg.workflow_families;
ALTER TABLE hsdg.workflow_families FORCE ROW LEVEL SECURITY;

-- ── 5b. Seed reusable templates for the Book-keeping component (demonstrates
--        the definition-link + configuration-snapshot wiring end to end) ─────
-- Runs before RLS is enabled on the template tables below (owner insert). The
-- link UPDATE reads/writes service_components, so drop its FORCE for the update.
INSERT INTO hsdg.catalogue_templates (template_type, code, name, description) VALUES
  ('checklist',            'CHK_BANKREC', 'Bank Reconciliation Checklist', 'Standard steps for a monthly bank reconciliation.'),
  ('pbc',                  'PBC_BANKREC', 'Bank Reconciliation PBC',       'Client-provided items for a bank reconciliation.'),
  ('document_requirement', 'DOC_BANKREC', 'Bank Reconciliation Documents', 'Evidence required to close a bank reconciliation.');

INSERT INTO hsdg.catalogue_template_versions (catalogue_template_id, version, effective_from, body)
SELECT t.id, 1, DATE '2017-04-01', v.body
FROM (VALUES
  ('CHK_BANKREC', '{"items":[{"label":"Opening balance agreed to prior close","sequence":1,"mandatory":true},{"label":"All bank lines matched","sequence":2,"mandatory":true},{"label":"Unreconciled items explained","sequence":3,"mandatory":true}]}'::jsonb),
  ('PBC_BANKREC', '{"items":[{"label":"Bank statements for the period","sequence":1,"mandatory":true},{"label":"Cheque book / payment register","sequence":2}]}'::jsonb),
  ('DOC_BANKREC', '{"items":[{"label":"Signed bank reconciliation statement","sequence":1,"mandatory":true}]}'::jsonb)
) AS v(code, body)
JOIN hsdg.catalogue_templates t ON t.code = v.code;

ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.service_components sc
SET checklist_template_id            = (SELECT id FROM hsdg.catalogue_templates WHERE code = 'CHK_BANKREC'),
    pbc_template_id                  = (SELECT id FROM hsdg.catalogue_templates WHERE code = 'PBC_BANKREC'),
    document_requirement_template_id = (SELECT id FROM hsdg.catalogue_templates WHERE code = 'DOC_BANKREC')
WHERE sc.code = 'BK_BANKREC';
ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;

-- ── 6. Permissions: templates are catalogue config (reuse service.*) ──────
-- Read = service.read (everyone); write = service.manage (MP/admin). Versions
-- are append-only reference data, like compliance_rule_versions.
REVOKE UPDATE, DELETE ON hsdg.catalogue_template_versions FROM hsdg_app;
REVOKE INSERT, UPDATE, DELETE ON hsdg.workflow_versions   FROM hsdg_app;

-- ── 7. Row Level Security ──────────────────────────────────────────────────
-- Firm-wide config: any authenticated context reads; only firm-wide writes.
ALTER TABLE hsdg.catalogue_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates         FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_versions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_versions           FORCE  ROW LEVEL SECURITY;

CREATE POLICY catalogue_templates_read ON hsdg.catalogue_templates
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY catalogue_templates_write ON hsdg.catalogue_templates
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

CREATE POLICY catalogue_template_versions_read ON hsdg.catalogue_template_versions
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
-- Append-only: firm-wide may INSERT; no UPDATE/DELETE policy (and revoked above).
CREATE POLICY catalogue_template_versions_insert ON hsdg.catalogue_template_versions
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());

CREATE POLICY workflow_versions_read ON hsdg.workflow_versions
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);

-- Down Migration

DROP POLICY IF EXISTS workflow_versions_read ON hsdg.workflow_versions;
DROP POLICY IF EXISTS catalogue_template_versions_insert ON hsdg.catalogue_template_versions;
DROP POLICY IF EXISTS catalogue_template_versions_read ON hsdg.catalogue_template_versions;
DROP POLICY IF EXISTS catalogue_templates_write ON hsdg.catalogue_templates;
DROP POLICY IF EXISTS catalogue_templates_read ON hsdg.catalogue_templates;

ALTER TABLE hsdg.engagements          DROP COLUMN IF EXISTS workflow_version_id;
ALTER TABLE hsdg.engagement_components
  DROP COLUMN IF EXISTS checklist_template_version_id,
  DROP COLUMN IF EXISTS pbc_template_version_id,
  DROP COLUMN IF EXISTS document_requirement_template_version_id;
ALTER TABLE hsdg.service_components
  DROP COLUMN IF EXISTS checklist_template_id,
  DROP COLUMN IF EXISTS pbc_template_id,
  DROP COLUMN IF EXISTS document_requirement_template_id;

DROP TABLE IF EXISTS hsdg.workflow_versions CASCADE;
DROP TABLE IF EXISTS hsdg.catalogue_template_versions CASCADE;
DROP TABLE IF EXISTS hsdg.catalogue_templates CASCADE;

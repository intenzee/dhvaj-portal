-- ─────────────────────────────────────────────────────────────────────────
-- 0007 · Service Catalogue
--
-- The firm's configurable offering: review models, service lines, workflow
-- families/states, and services. This is firm-wide CONFIGURATION (not office
-- scoped) — the backbone engagements reference from Phase 5.
--
-- "Configuration over hard-coding": services and service lines are managed via
-- the API; review models and workflow definitions are seeded reference config.
-- Each service declares the MINIMUM review model it requires (ranked), which
-- Phase 7 enforces at sign-off ("no statutory audit completes below Full EP
-- Review").
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Review models (reference; ranked by rigour) ───────────────────────────

CREATE TABLE hsdg.review_models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name        text NOT NULL,
  -- Higher rank = more rigorous. A service may not be signed off below its
  -- required model's rank.
  rank        integer NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER review_models_set_updated_at BEFORE UPDATE ON hsdg.review_models
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Service lines ─────────────────────────────────────────────────────────

CREATE TABLE hsdg.service_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,30}$'),
  name          text NOT NULL,
  description   text,
  display_order integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER service_lines_set_updated_at BEFORE UPDATE ON hsdg.service_lines
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Workflow families and their ordered states ────────────────────────────

CREATE TABLE hsdg.workflow_families (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER workflow_families_set_updated_at BEFORE UPDATE ON hsdg.workflow_families
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.workflow_states (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_family_id uuid NOT NULL REFERENCES hsdg.workflow_families (id) ON DELETE CASCADE,
  slug               text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name               text NOT NULL,
  sequence           integer NOT NULL,
  is_initial         boolean NOT NULL DEFAULT false,
  is_terminal        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_states_slug_unique UNIQUE (workflow_family_id, slug),
  CONSTRAINT workflow_states_seq_unique UNIQUE (workflow_family_id, sequence)
);
CREATE INDEX workflow_states_family_idx ON hsdg.workflow_states (workflow_family_id);
-- Exactly one initial state per family.
CREATE UNIQUE INDEX workflow_states_one_initial ON hsdg.workflow_states (workflow_family_id)
  WHERE is_initial;
CREATE TRIGGER workflow_states_set_updated_at BEFORE UPDATE ON hsdg.workflow_states
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Services (the catalogue) ──────────────────────────────────────────────

CREATE TABLE hsdg.services (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_line_id          uuid NOT NULL REFERENCES hsdg.service_lines (id) ON DELETE RESTRICT,
  code                     text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  name                     text NOT NULL,
  description              text,
  required_review_model_id uuid NOT NULL REFERENCES hsdg.review_models (id) ON DELETE RESTRICT,
  workflow_family_id       uuid NOT NULL REFERENCES hsdg.workflow_families (id) ON DELETE RESTRICT,
  default_recurrence       text NOT NULL DEFAULT 'annual'
                             CHECK (default_recurrence IN
                               ('one_time','monthly','quarterly','half_yearly','annual','as_required')),
  is_active                boolean NOT NULL DEFAULT true,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX services_line_idx ON hsdg.services (service_line_id);
CREATE INDEX services_review_idx ON hsdg.services (required_review_model_id);
CREATE INDEX services_workflow_idx ON hsdg.services (workflow_family_id);
CREATE TRIGGER services_set_updated_at BEFORE UPDATE ON hsdg.services
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Seed reference config (before FORCE RLS) ──────────────────────────────

INSERT INTO hsdg.review_models (slug, name, rank, description) VALUES
  ('manager_review',   'Manager Review',   10, 'Reviewed by the engagement manager.'),
  ('key_matter_review','Key-Matter Review', 20, 'Partner reviews key matters; manager reviews the rest.'),
  ('full_ep_review',   'Full EP Review',   30, 'Engagement Partner reviews and signs off in full.');

INSERT INTO hsdg.service_lines (code, name, display_order) VALUES
  ('AUDIT',      'Audit & Assurance',      1),
  ('TAX',        'Direct Tax',             2),
  ('GST',        'Goods & Services Tax',   3),
  ('ACCOUNTS',   'Accounting',             4),
  ('ROC',        'Corporate Law / ROC',    5),
  ('LITIGATION', 'Litigation',             6),
  ('ADVISORY',   'Advisory',               7);

INSERT INTO hsdg.workflow_families (slug, name, description) VALUES
  ('audit_workflow',      'Audit Workflow',      'Planning through EP sign-off.'),
  ('filing_workflow',     'Filing Workflow',     'Preparation, review, and filing of returns.'),
  ('advisory_workflow',   'Advisory Workflow',   'Scoping through delivery.'),
  ('litigation_workflow', 'Litigation Workflow', 'Assessment through resolution.');

INSERT INTO hsdg.workflow_states (workflow_family_id, slug, name, sequence, is_initial, is_terminal)
SELECT wf.id, v.slug, v.name, v.seq, v.is_initial, v.is_terminal
FROM (VALUES
  ('audit_workflow',      'planning',    'Planning',     1, true,  false),
  ('audit_workflow',      'fieldwork',   'Fieldwork',    2, false, false),
  ('audit_workflow',      'review',      'Review',       3, false, false),
  ('audit_workflow',      'ep_sign_off', 'EP Sign-off',  4, false, false),
  ('audit_workflow',      'completed',   'Completed',    5, false, true),
  ('filing_workflow',     'preparation', 'Preparation',  1, true,  false),
  ('filing_workflow',     'review',      'Review',       2, false, false),
  ('filing_workflow',     'filing',      'Filing',       3, false, false),
  ('filing_workflow',     'completed',   'Completed',    4, false, true),
  ('advisory_workflow',   'scoping',     'Scoping',      1, true,  false),
  ('advisory_workflow',   'work',        'Work',         2, false, false),
  ('advisory_workflow',   'review',      'Review',       3, false, false),
  ('advisory_workflow',   'delivered',   'Delivered',    4, false, true),
  ('litigation_workflow', 'assessment',  'Assessment',   1, true,  false),
  ('litigation_workflow', 'drafting',    'Drafting',     2, false, false),
  ('litigation_workflow', 'filing',      'Filing',       3, false, false),
  ('litigation_workflow', 'hearing',     'Hearing',      4, false, false),
  ('litigation_workflow', 'resolved',    'Resolved',     5, false, true)
) AS v(family_slug, slug, name, seq, is_initial, is_terminal)
JOIN hsdg.workflow_families wf ON wf.slug = v.family_slug;

INSERT INTO hsdg.services
  (service_line_id, code, name, required_review_model_id, workflow_family_id, default_recurrence)
SELECT sl.id, v.code, v.name, rm.id, wf.id, v.recurrence
FROM (VALUES
  ('AUDIT',      'STAT_AUDIT',      'Statutory Audit',                'full_ep_review',    'audit_workflow',      'annual'),
  ('AUDIT',      'TAX_AUDIT',       'Tax Audit (u/s 44AB)',           'full_ep_review',    'audit_workflow',      'annual'),
  ('AUDIT',      'INT_AUDIT',       'Internal Audit',                 'key_matter_review', 'audit_workflow',      'quarterly'),
  ('TAX',        'ITR_FILING',      'Income Tax Return Filing',       'manager_review',    'filing_workflow',     'annual'),
  ('TAX',        'TAX_ADVISORY',    'Tax Advisory',                   'key_matter_review', 'advisory_workflow',   'as_required'),
  ('GST',        'GST_MONTHLY',     'GST Monthly Return (GSTR-3B)',   'manager_review',    'filing_workflow',     'monthly'),
  ('GST',        'GST_ANNUAL',      'GST Annual Return (GSTR-9)',     'key_matter_review', 'filing_workflow',     'annual'),
  ('ACCOUNTS',   'BOOKKEEPING',     'Book-keeping',                   'manager_review',    'filing_workflow',     'monthly'),
  ('ROC',        'ROC_ANNUAL',      'ROC Annual Filing',              'manager_review',    'filing_workflow',     'annual'),
  ('ADVISORY',   'ADVISORY_GEN',    'General Advisory',               'key_matter_review', 'advisory_workflow',   'as_required'),
  ('LITIGATION', 'ITAT_REP',        'ITAT Representation',            'full_ep_review',    'litigation_workflow', 'as_required')
) AS v(line_code, code, name, review_slug, family_slug, recurrence)
JOIN hsdg.service_lines sl ON sl.code = v.line_code
JOIN hsdg.review_models rm ON rm.slug = v.review_slug
JOIN hsdg.workflow_families wf ON wf.slug = v.family_slug;

-- ── Permissions (toggle FORCE on reference tables we read/write) ──────────

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description) VALUES
  ('service.read',   'View the service catalogue'),
  ('service.manage', 'Configure service lines and services');

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'service.read';

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'service.manage'
WHERE r.slug IN ('managing_partner', 'admin');

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── Privileges: review models & workflow defs are migration-managed ───────
REVOKE INSERT, UPDATE, DELETE ON hsdg.review_models     FROM hsdg_app;
REVOKE INSERT, UPDATE, DELETE ON hsdg.workflow_families FROM hsdg_app;
REVOKE INSERT, UPDATE, DELETE ON hsdg.workflow_states   FROM hsdg_app;

-- ── Row Level Security ─────────────────────────────────────────────────────
-- Firm-wide config: any authenticated context reads; only firm-wide writes.
-- Fail-closed: no context ⇒ no rows.

ALTER TABLE hsdg.review_models     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models     FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_lines     FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_states   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_states   FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services          FORCE  ROW LEVEL SECURITY;

CREATE POLICY review_models_read ON hsdg.review_models
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY workflow_families_read ON hsdg.workflow_families
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY workflow_states_read ON hsdg.workflow_states
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);

CREATE POLICY service_lines_read ON hsdg.service_lines
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY service_lines_write ON hsdg.service_lines
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

CREATE POLICY services_read ON hsdg.services
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY services_write ON hsdg.services
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- Down Migration

DROP TABLE IF EXISTS hsdg.services CASCADE;
DROP TABLE IF EXISTS hsdg.workflow_states CASCADE;
DROP TABLE IF EXISTS hsdg.workflow_families CASCADE;
DROP TABLE IF EXISTS hsdg.service_lines CASCADE;
DROP TABLE IF EXISTS hsdg.review_models CASCADE;

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug IN ('service.read', 'service.manage'));
DELETE FROM hsdg.permissions WHERE slug IN ('service.read', 'service.manage');
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

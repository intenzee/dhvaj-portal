-- ─────────────────────────────────────────────────────────────────────────
-- 0004 · Organisation & People
--
-- The firm's HR/organisational model: grades (Partner/Manager/Senior/Article),
-- employees (the person record), and partner profiles. Reuses the security
-- context helpers and RLS posture from migration 0002.
--
-- Deliberate separations (see ADR-0004):
--   • HR grade  ≠ security role  — a person's professional grade is not their
--     access role (roles live in identity, Phase 1).
--   • reporting line ≠ access    — reports_to captures org structure only; it
--     grants no visibility. Access remains explicit / engagement-scoped.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Grades (reference/config) ─────────────────────────────────────────────

CREATE TABLE hsdg.grades (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name             text NOT NULL,
  -- Higher rank = more senior. Used for ordering and org validation.
  rank             integer NOT NULL,
  is_partner_grade boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER grades_set_updated_at BEFORE UPDATE ON hsdg.grades
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Employees (the person record) ─────────────────────────────────────────

CREATE TABLE hsdg.employees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code     text NOT NULL UNIQUE CHECK (employee_code ~ '^[A-Z0-9_-]{2,20}$'),
  full_name         text NOT NULL CHECK (length(trim(full_name)) > 0),
  -- Optional link to an authentication identity (not everyone logs in).
  user_id           uuid UNIQUE REFERENCES hsdg.users (id) ON DELETE SET NULL,
  grade_id          uuid NOT NULL REFERENCES hsdg.grades (id) ON DELETE RESTRICT,
  primary_office_id uuid NOT NULL REFERENCES hsdg.offices (id) ON DELETE RESTRICT,
  -- Org structure only — confers NO data access by itself.
  reports_to_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  employment_status text NOT NULL DEFAULT 'active'
                      CHECK (employment_status IN ('active', 'on_leave', 'notice_period', 'exited')),
  date_of_joining   date NOT NULL,
  date_of_exit      date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_no_self_report CHECK (reports_to_id IS NULL OR reports_to_id <> id),
  CONSTRAINT employees_exit_after_join CHECK (date_of_exit IS NULL OR date_of_exit >= date_of_joining),
  -- An exited employee must have an exit date.
  CONSTRAINT employees_exited_has_date CHECK (employment_status <> 'exited' OR date_of_exit IS NOT NULL)
);
CREATE INDEX employees_office_idx ON hsdg.employees (primary_office_id);
CREATE INDEX employees_grade_idx ON hsdg.employees (grade_id);
CREATE INDEX employees_reports_to_idx ON hsdg.employees (reports_to_id);
CREATE INDEX employees_status_idx ON hsdg.employees (employment_status);
CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON hsdg.employees
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Partner profiles (1:1 with partner-grade employees) ───────────────────

CREATE TABLE hsdg.partner_profiles (
  employee_id   uuid PRIMARY KEY REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  membership_no text UNIQUE,
  partner_since date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER partner_profiles_set_updated_at BEFORE UPDATE ON hsdg.partner_profiles
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Seed grades (before FORCE RLS, so the migrator can write) ──────────────

INSERT INTO hsdg.grades (slug, name, rank, is_partner_grade) VALUES
  ('partner', 'Partner', 100, true),
  ('manager', 'Manager', 80, false),
  ('senior',  'Senior',  60, false),
  ('article', 'Article Assistant', 40, false);

-- ── New permissions (toggle FORCE to edit the FORCE-RLS reference tables) ──
-- NOTE: `roles` is also dropped from FORCE here because the inserts READ it to
-- resolve role ids; under FORCE RLS the migrator has no security context and the
-- roles_read policy would return zero rows (fail-closed), silently inserting
-- nothing. This is the standard pattern for reference-data migrations.

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description) VALUES
  ('employee.read',   'View employees within permitted scope'),
  ('employee.manage', 'Create and modify employees');

-- employee.read: everyone (firm directory, RLS still scopes rows)
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'employee.read';

-- employee.manage: managing_partner + admin only
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'employee.manage'
WHERE r.slug IN ('managing_partner', 'admin');

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── Privileges: grades are migration-managed; employees are app-writable ──
REVOKE INSERT, UPDATE, DELETE ON hsdg.grades FROM hsdg_app;

-- ── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE hsdg.grades           ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.grades           FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.employees        FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.partner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.partner_profiles FORCE  ROW LEVEL SECURITY;

-- Grades: any authenticated context reads; nobody writes via the app.
CREATE POLICY grades_read ON hsdg.grades
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);

-- Employees: firm-wide sees all; otherwise scoped to the caller's office.
-- Fail-closed: no context ⇒ no rows.
CREATE POLICY employees_select ON hsdg.employees
  FOR SELECT USING (
    hsdg.ctx_is_firmwide()
    OR primary_office_id = hsdg.ctx_office_id()
  );
CREATE POLICY employees_insert ON hsdg.employees
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY employees_update ON hsdg.employees
  FOR UPDATE USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY employees_delete ON hsdg.employees
  FOR DELETE USING (hsdg.ctx_is_firmwide());

-- Partner profiles: visible when the underlying employee is visible; writable
-- firm-wide only.
CREATE POLICY partner_profiles_select ON hsdg.partner_profiles
  FOR SELECT USING (
    hsdg.ctx_is_firmwide()
    OR EXISTS (
      SELECT 1 FROM hsdg.employees e
      WHERE e.id = partner_profiles.employee_id
        AND e.primary_office_id = hsdg.ctx_office_id()
    )
  );
CREATE POLICY partner_profiles_write ON hsdg.partner_profiles
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- Down Migration

DROP TABLE IF EXISTS hsdg.partner_profiles CASCADE;
DROP TABLE IF EXISTS hsdg.employees CASCADE;
DROP TABLE IF EXISTS hsdg.grades CASCADE;

ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug IN ('employee.read', 'employee.manage'));
DELETE FROM hsdg.permissions WHERE slug IN ('employee.read', 'employee.manage');
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

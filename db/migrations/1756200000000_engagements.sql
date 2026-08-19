-- ─────────────────────────────────────────────────────────────────────────
-- 0008 · Engagement Core
--
-- The central transactional object. Identity = Entity + Service + Financial
-- Year + Period (office is NOT part of identity). Exactly one accountable EP.
-- A team of shared resources assigned per-engagement.
--
-- SECURITY MODEL — assignment-based access (see ADR-0008)
--   Access to an engagement is by explicit assignment (EP, manager, team
--   member), independent of office. This is the "shared resources across
--   offices" model. RLS tests the acting user's EMPLOYEE id (hsdg.employee_id).
--
--   To decide membership, policies must cross-reference engagements and
--   engagement_team, which would make the two tables' policies mutually
--   recursive. We break the recursion with SECURITY DEFINER helper functions
--   (owned by the migrator) over these two tables, which run ENABLE — not FORCE
--   — RLS. The owner (migrator, used only for migrations, never at runtime) then
--   bypasses RLS *inside the helper*, so there is no policy recursion; the
--   least-privilege app role is never the owner and remains fully governed.
--
--   Engagement assignment also GRANTS access to the client entity and to
--   co-workers on the engagement (so a cross-office team member can see the
--   engagement, its client, and the roster) — the entities/employees SELECT
--   policies are extended below.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Context helper: acting employee id ────────────────────────────────────
CREATE OR REPLACE FUNCTION hsdg.ctx_employee_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hsdg.employee_id', true), '')::uuid
$$;

-- ── Engagements ───────────────────────────────────────────────────────────

CREATE SEQUENCE hsdg.engagement_code_seq;

CREATE TABLE hsdg.engagements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_code text NOT NULL UNIQUE
                    DEFAULT 'ENG' || lpad(nextval('hsdg.engagement_code_seq')::text, 5, '0'),
  entity_id       uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE RESTRICT,
  service_id      uuid NOT NULL REFERENCES hsdg.services (id) ON DELETE RESTRICT,
  -- Identity components. Office is deliberately NOT part of identity.
  financial_year  text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  period_label    text NOT NULL DEFAULT 'FY' CHECK (length(trim(period_label)) > 0),
  -- Servicing office (reporting only; not identity, not access).
  office_id       uuid NOT NULL REFERENCES hsdg.offices (id) ON DELETE RESTRICT,
  -- The one accountable Engagement Partner (required once accepted; see CHECK).
  engagement_partner_id uuid REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  engagement_manager_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'prospect' CHECK (status IN
                    ('prospect','pending_acceptance','accepted','active','on_hold',
                     'completed','closed','declined','withdrawn','cancelled')),
  -- Recurring work links to its predecessor.
  predecessor_engagement_id uuid REFERENCES hsdg.engagements (id) ON DELETE SET NULL,
  planned_start_date date,
  planned_end_date   date,
  accepted_at     timestamptz,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One engagement per client + service + FY + period.
  CONSTRAINT engagements_identity_unique UNIQUE (entity_id, service_id, financial_year, period_label),
  -- Accountable EP is mandatory once the engagement is accepted or beyond.
  CONSTRAINT engagements_ep_required_when_accepted CHECK (
    status IN ('prospect','pending_acceptance','declined','withdrawn','cancelled')
    OR engagement_partner_id IS NOT NULL
  ),
  CONSTRAINT engagements_no_self_predecessor CHECK (
    predecessor_engagement_id IS NULL OR predecessor_engagement_id <> id
  ),
  CONSTRAINT engagements_dates CHECK (
    planned_end_date IS NULL OR planned_start_date IS NULL OR planned_end_date >= planned_start_date
  )
);
CREATE INDEX engagements_entity_idx ON hsdg.engagements (entity_id);
CREATE INDEX engagements_service_idx ON hsdg.engagements (service_id);
CREATE INDEX engagements_office_idx ON hsdg.engagements (office_id);
CREATE INDEX engagements_ep_idx ON hsdg.engagements (engagement_partner_id);
CREATE INDEX engagements_manager_idx ON hsdg.engagements (engagement_manager_id);
CREATE INDEX engagements_status_idx ON hsdg.engagements (status);
CREATE INDEX engagements_predecessor_idx ON hsdg.engagements (predecessor_engagement_id);
CREATE TRIGGER engagements_set_updated_at BEFORE UPDATE ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Team (engagement-specific, shared resources) ──────────────────────────

CREATE TABLE hsdg.engagement_team (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id      uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  role_on_engagement text NOT NULL DEFAULT 'member' CHECK (role_on_engagement IN
                       ('in_charge','member','reviewer','specialist')),
  assigned_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_team_unique UNIQUE (engagement_id, employee_id)
);
CREATE INDEX engagement_team_engagement_idx ON hsdg.engagement_team (engagement_id);
CREATE INDEX engagement_team_employee_idx ON hsdg.engagement_team (employee_id);

-- ── SECURITY DEFINER membership helpers (break policy recursion) ──────────
-- Owned by the migrator; the engagement tables run ENABLE (not FORCE) RLS, so
-- the owner bypasses RLS inside these functions. They read the caller's
-- transaction-local context (which is visible regardless of SECURITY DEFINER).
-- SET search_path guards against search-path hijacking.

CREATE OR REPLACE FUNCTION hsdg.is_engagement_lead(eng_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagements e
          WHERE e.id = eng_id
            AND (e.engagement_partner_id = hsdg.ctx_employee_id()
                 OR e.engagement_manager_id = hsdg.ctx_employee_id())
        ))
$$;

CREATE OR REPLACE FUNCTION hsdg.is_engagement_member(eng_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.is_engagement_lead(eng_id)
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagement_team t
          WHERE t.engagement_id = eng_id AND t.employee_id = hsdg.ctx_employee_id()
        ))
$$;

-- Does this entity have an engagement the caller is a member of?
CREATE OR REPLACE FUNCTION hsdg.can_access_entity_via_engagement(ent_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM hsdg.engagements e
    WHERE e.entity_id = ent_id AND hsdg.is_engagement_member(e.id)
  )
$$;

-- Does the caller share any engagement with this employee (co-worker)?
CREATE OR REPLACE FUNCTION hsdg.shares_engagement_with(emp_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM hsdg.engagements e
    WHERE hsdg.is_engagement_member(e.id)
      AND (e.engagement_partner_id = emp_id
           OR e.engagement_manager_id = emp_id
           OR EXISTS (SELECT 1 FROM hsdg.engagement_team t
                      WHERE t.engagement_id = e.id AND t.employee_id = emp_id))
  )
$$;

-- ── Permissions ───────────────────────────────────────────────────────────

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description) VALUES
  ('engagement.read',   'View engagements the caller is assigned to'),
  ('engagement.manage', 'Create and manage engagements and their teams');

-- engagement.read: all staff (RLS scopes to assignment)
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'engagement.read';

-- engagement.manage: MP, admin, partner, manager
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'engagement.manage'
WHERE r.slug IN ('managing_partner', 'admin', 'partner', 'manager');

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── Row Level Security ─────────────────────────────────────────────────────
-- ENABLE (not FORCE) so the migrator-owned SECURITY DEFINER helpers can bypass
-- and avoid policy recursion. hsdg_app is never the owner, so it stays governed.

ALTER TABLE hsdg.engagements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_team ENABLE ROW LEVEL SECURITY;

-- Note: the EP/manager checks are INLINE column comparisons (not the SECURITY
-- DEFINER helper) so that INSERT ... RETURNING — whose SELECT-policy check runs
-- against a snapshot that predates the new row — still sees the row's own EP.
-- The team check is a subquery (a new engagement has no team yet, so it is
-- irrelevant to RETURNING); engagement_team's own policy uses the helper to
-- avoid recursion.
CREATE POLICY engagements_select ON hsdg.engagements
  FOR SELECT USING (
    hsdg.ctx_is_firmwide()
    OR (hsdg.ctx_employee_id() IS NOT NULL AND (
          engagement_partner_id = hsdg.ctx_employee_id()
          OR engagement_manager_id = hsdg.ctx_employee_id()))
    OR EXISTS (SELECT 1 FROM hsdg.engagement_team t
               WHERE t.engagement_id = engagements.id AND t.employee_id = hsdg.ctx_employee_id())
  );
-- Create only an engagement you will lead (or firm-wide).
CREATE POLICY engagements_insert ON hsdg.engagements
  FOR INSERT WITH CHECK (
    hsdg.ctx_is_firmwide()
    OR (hsdg.ctx_employee_id() IS NOT NULL AND (
          engagement_partner_id = hsdg.ctx_employee_id()
          OR engagement_manager_id = hsdg.ctx_employee_id()))
  );
-- Only the EP/manager (or firm-wide) may modify. Reassigning the EP away from
-- yourself therefore requires firm-wide authority — a deliberate governance rule.
CREATE POLICY engagements_update ON hsdg.engagements
  FOR UPDATE USING (hsdg.is_engagement_lead(id))
  WITH CHECK (
    hsdg.ctx_is_firmwide()
    OR (hsdg.ctx_employee_id() IS NOT NULL AND (
          engagement_partner_id = hsdg.ctx_employee_id()
          OR engagement_manager_id = hsdg.ctx_employee_id()))
  );
CREATE POLICY engagements_delete ON hsdg.engagements
  FOR DELETE USING (hsdg.ctx_is_firmwide());

-- Team rows: any engagement member sees the roster; only the lead assigns/removes.
CREATE POLICY engagement_team_select ON hsdg.engagement_team
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_team_insert ON hsdg.engagement_team
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_team_update ON hsdg.engagement_team
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_team_delete ON hsdg.engagement_team
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- ── Extend entity & employee visibility via engagement assignment ─────────
-- So a (possibly cross-office) engagement member can see the client and the
-- co-workers on the engagement, not only their own office.

DROP POLICY entities_select ON hsdg.entities;
CREATE POLICY entities_select ON hsdg.entities FOR SELECT USING (
  hsdg.ctx_is_firmwide()
  OR home_office_id = hsdg.ctx_office_id()
  OR hsdg.can_access_entity_via_engagement(id)
);

DROP POLICY employees_select ON hsdg.employees;
CREATE POLICY employees_select ON hsdg.employees FOR SELECT USING (
  hsdg.ctx_is_firmwide()
  OR primary_office_id = hsdg.ctx_office_id()
  OR hsdg.shares_engagement_with(id)
);

-- Down Migration

DROP POLICY employees_select ON hsdg.employees;
CREATE POLICY employees_select ON hsdg.employees FOR SELECT USING (
  hsdg.ctx_is_firmwide() OR primary_office_id = hsdg.ctx_office_id()
);

DROP POLICY entities_select ON hsdg.entities;
CREATE POLICY entities_select ON hsdg.entities FOR SELECT USING (
  hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id()
);

DROP TABLE IF EXISTS hsdg.engagement_team CASCADE;
DROP TABLE IF EXISTS hsdg.engagements CASCADE;
DROP SEQUENCE IF EXISTS hsdg.engagement_code_seq;

DROP FUNCTION IF EXISTS hsdg.shares_engagement_with(uuid);
DROP FUNCTION IF EXISTS hsdg.can_access_entity_via_engagement(uuid);
DROP FUNCTION IF EXISTS hsdg.is_engagement_member(uuid);
DROP FUNCTION IF EXISTS hsdg.is_engagement_lead(uuid);
DROP FUNCTION IF EXISTS hsdg.ctx_employee_id();

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug IN ('engagement.read', 'engagement.manage'));
DELETE FROM hsdg.permissions WHERE slug IN ('engagement.read', 'engagement.manage');
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

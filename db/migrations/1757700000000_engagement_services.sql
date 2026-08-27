-- ─────────────────────────────────────────────────────────────────────────
-- 0024 · Multi-Service Engagements  (spec §2, §9–§10, §27, §36, §38)
--
-- Introduces hsdg.engagement_services — the service-line grain that lets ONE
-- engagement carry several services (GST + TDS + Accounting) for the same
-- client, FY and period. See ADR-0024.
--
-- STRICTLY ADDITIVE. Every existing engagement is backfilled to exactly one
-- "primary" engagement_services row derived from its current service_id, so the
-- new table is a faithful superset of today. engagements.service_id is KEPT as
-- the primary/legacy pointer (retired in a later cleanup). Duplication
-- prevention (§16/§35) is preserved end-to-end WITHOUT any API change: an
-- AFTER-INSERT trigger on engagements auto-creates the primary service row, and
-- a partial unique index enforces "entity + service + FY + period" at the
-- service grain — so a duplicate engagement still fails with a clean 409
-- (translatePgError already matches the 'identity' substring).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Status mapping: engagement status → initial service status ────────────
-- Services have an independent lifecycle after creation; this only sets the
-- INITIAL status (at backfill and at auto-create). Firm-wide reference logic,
-- IMMUTABLE so it is inlinable and index-safe.
CREATE OR REPLACE FUNCTION hsdg.engagement_service_status_from(eng_status text)
  RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE eng_status
    WHEN 'completed'          THEN 'completed'
    WHEN 'closed'             THEN 'completed'
    WHEN 'on_hold'            THEN 'on_hold'
    WHEN 'declined'           THEN 'cancelled'
    WHEN 'withdrawn'          THEN 'cancelled'
    WHEN 'cancelled'          THEN 'cancelled'
    WHEN 'prospect'           THEN 'prospect'
    WHEN 'pending_acceptance' THEN 'prospect'
    ELSE 'active'  -- accepted / active
  END
$$;

-- ── The engagement_services table ─────────────────────────────────────────
-- entity_id / financial_year / period_label are DENORMALISED from the parent
-- engagement (kept authoritative by the sync trigger below) so the §35 identity
-- can be a single partial unique index — Postgres cannot build a unique index
-- across a join.
CREATE TABLE hsdg.engagement_services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id    uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  service_id       uuid NOT NULL REFERENCES hsdg.services (id) ON DELETE RESTRICT,
  -- Servicing office for THIS service (may differ per service; reporting only).
  office_id        uuid NOT NULL REFERENCES hsdg.offices (id) ON DELETE RESTRICT,
  -- Optional per-service lead; defaults to the engagement EP at auto-create.
  lead_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- Exactly one primary service per engagement (the legacy engagements.service_id).
  is_primary       boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN
                     ('prospect','active','on_hold','completed','cancelled')),
  -- Denormalised identity (synced from parent; never set by hand).
  entity_id        uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE RESTRICT,
  financial_year   text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  period_label     text NOT NULL DEFAULT 'FY' CHECK (length(trim(period_label)) > 0),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engagement_services_engagement_idx ON hsdg.engagement_services (engagement_id);
CREATE INDEX engagement_services_service_idx    ON hsdg.engagement_services (service_id);
CREATE INDEX engagement_services_office_idx     ON hsdg.engagement_services (office_id);
CREATE INDEX engagement_services_lead_idx       ON hsdg.engagement_services (lead_employee_id);
CREATE INDEX engagement_services_entity_idx     ON hsdg.engagement_services (entity_id);
CREATE INDEX engagement_services_status_idx     ON hsdg.engagement_services (status);
CREATE TRIGGER engagement_services_set_updated_at BEFORE UPDATE ON hsdg.engagement_services
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Identity sync: pull entity_id / FY / period from the parent engagement ─
-- Runs on every insert/update so the denormalised identity can never drift and
-- the app never needs to (or is able to) set it by hand.
CREATE OR REPLACE FUNCTION hsdg.engagement_services_sync_identity() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT e.entity_id, e.financial_year, e.period_label
    INTO NEW.entity_id, NEW.financial_year, NEW.period_label
  FROM hsdg.engagements e WHERE e.id = NEW.engagement_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagement_services_sync_identity
  BEFORE INSERT OR UPDATE OF engagement_id ON hsdg.engagement_services
  FOR EACH ROW EXECUTE FUNCTION hsdg.engagement_services_sync_identity();

-- ── Backfill: one primary service row per existing engagement ─────────────
-- Runs BEFORE RLS is enabled below, so the migrator (no employee context) is
-- not blocked by the engagement-scoped policies. The sync trigger re-pulls the
-- identity columns authoritatively.
INSERT INTO hsdg.engagement_services
  (engagement_id, service_id, office_id, lead_employee_id, is_primary, status,
   entity_id, financial_year, period_label)
SELECT e.id, e.service_id, e.office_id, e.engagement_partner_id, true,
       hsdg.engagement_service_status_from(e.status),
       e.entity_id, e.financial_year, e.period_label
FROM hsdg.engagements e;

-- ── Duplication prevention at the service grain (§16/§35) ─────────────────
-- No two LIVE service rows for the same client + service + FY + period.
CREATE UNIQUE INDEX engagement_services_identity_unique
  ON hsdg.engagement_services (entity_id, service_id, financial_year, period_label)
  WHERE status <> 'cancelled';
-- At most one primary service per engagement.
CREATE UNIQUE INDEX engagement_services_one_primary
  ON hsdg.engagement_services (engagement_id) WHERE is_primary;

-- ── Auto-create the primary service row for every NEW engagement ──────────
-- Keeps the §35 guarantee without any API change: creating a duplicate
-- engagement now fails inside this trigger on the identity index (23505), which
-- aborts the engagements INSERT and surfaces as a clean 409.
CREATE OR REPLACE FUNCTION hsdg.engagement_services_create_primary() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO hsdg.engagement_services
    (engagement_id, service_id, office_id, lead_employee_id, is_primary, status,
     entity_id, financial_year, period_label)
  VALUES (NEW.id, NEW.service_id, NEW.office_id, NEW.engagement_partner_id, true,
          hsdg.engagement_service_status_from(NEW.status),
          NEW.entity_id, NEW.financial_year, NEW.period_label);
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagements_create_primary_service
  AFTER INSERT ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.engagement_services_create_primary();

-- ── Propagate identity changes from the parent (belt-and-braces) ──────────
-- Engagement identity columns are effectively immutable, but if one ever
-- changes, keep the stored service rows in step.
CREATE OR REPLACE FUNCTION hsdg.engagement_services_propagate_identity() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE hsdg.engagement_services
     SET entity_id = NEW.entity_id,
         financial_year = NEW.financial_year,
         period_label = NEW.period_label
   WHERE engagement_id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagements_propagate_identity
  AFTER UPDATE OF entity_id, financial_year, period_label ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.engagement_services_propagate_identity();

-- ── Re-point components to the service-line grain ─────────────────────────
ALTER TABLE hsdg.engagement_components
  ADD COLUMN engagement_service_id uuid REFERENCES hsdg.engagement_services (id) ON DELETE RESTRICT;
CREATE INDEX engagement_components_eng_service_idx
  ON hsdg.engagement_components (engagement_service_id);

-- Backfill engagement_service_id to each engagement's primary service row.
-- Done BEFORE swapping the guard on purpose: the 0022 guard only watches
-- (service_component_id, engagement_id), so an engagement_service_id-only update
-- does not fire it — which matters because a guard running under the MIGRATOR
-- context would read the FORCE-RLS service_components as an unprivileged role
-- (no ctx_role) and see nothing, failing spuriously. engagement_components is
-- already FORCE RLS (from 0022); the migrator is blocked by the engagement-
-- scoped policies, so drop FORCE for the backfill and restore it immediately
-- (all within this migration's transaction). The data is provably consistent
-- (the 0022 FK + guard guarantee component.service == engagement.service).
ALTER TABLE hsdg.engagement_components NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.engagement_components ec
   SET engagement_service_id = es.id
  FROM hsdg.engagement_services es
 WHERE es.engagement_id = ec.engagement_id AND es.is_primary;
ALTER TABLE hsdg.engagement_components FORCE ROW LEVEL SECURITY;

-- New guard: a component belongs to the service of ITS engagement-service row
-- (new path), or — until a writer sets engagement_service_id — the engagement's
-- own service (legacy fallback). Kept as a CREATE OR REPLACE of the 0022 guard.
-- Created AFTER the backfill so it never runs under the migrator context; at
-- runtime it runs as the acting user, who can read both FORCE-RLS tables.
CREATE OR REPLACE FUNCTION hsdg.enforce_engagement_component_service() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.engagement_service_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM hsdg.service_components sc
      JOIN hsdg.engagement_services es ON es.service_id = sc.service_id
      WHERE sc.id = NEW.service_component_id
        AND es.id = NEW.engagement_service_id
        AND es.engagement_id = NEW.engagement_id
    ) THEN
      RAISE EXCEPTION 'service_component must belong to the engagement-service''s service.';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM hsdg.service_components sc
      JOIN hsdg.engagements e ON e.service_id = sc.service_id
      WHERE sc.id = NEW.service_component_id AND e.id = NEW.engagement_id
    ) THEN
      RAISE EXCEPTION 'service_component must belong to the engagement''s service.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- Recreate the trigger so it also fires when engagement_service_id changes.
DROP TRIGGER IF EXISTS engagement_components_enforce_service ON hsdg.engagement_components;
CREATE TRIGGER engagement_components_enforce_service
  BEFORE INSERT OR UPDATE OF service_component_id, engagement_id, engagement_service_id
  ON hsdg.engagement_components
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_engagement_component_service();

-- ── Row Level Security (engagement-scoped; mirrors engagement_components) ──
-- Members read; leads write. History is preserved by soft-cancel, so the app
-- role may not hard-delete a service row.
REVOKE DELETE ON hsdg.engagement_services FROM hsdg_app;
ALTER TABLE hsdg.engagement_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_services_select ON hsdg.engagement_services
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_services_insert ON hsdg.engagement_services
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_services_update ON hsdg.engagement_services
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── Identity relaxes: service identity now lives on engagement_services ────
ALTER TABLE hsdg.engagements DROP CONSTRAINT engagements_identity_unique;

-- Down Migration

-- Restore the engagement-level identity constraint.
ALTER TABLE hsdg.engagements
  ADD CONSTRAINT engagements_identity_unique
  UNIQUE (entity_id, service_id, financial_year, period_label);

-- Restore the 0022 component guard (single-service form) and its trigger.
CREATE OR REPLACE FUNCTION hsdg.enforce_engagement_component_service() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM hsdg.service_components sc
    JOIN hsdg.engagements e ON e.service_id = sc.service_id
    WHERE sc.id = NEW.service_component_id AND e.id = NEW.engagement_id
  ) THEN
    RAISE EXCEPTION 'service_component must belong to the engagement''s service.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS engagement_components_enforce_service ON hsdg.engagement_components;
CREATE TRIGGER engagement_components_enforce_service
  BEFORE INSERT OR UPDATE OF service_component_id, engagement_id ON hsdg.engagement_components
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_engagement_component_service();

DROP INDEX IF EXISTS hsdg.engagement_components_eng_service_idx;
ALTER TABLE hsdg.engagement_components DROP COLUMN IF EXISTS engagement_service_id;

DROP POLICY IF EXISTS engagement_services_update ON hsdg.engagement_services;
DROP POLICY IF EXISTS engagement_services_insert ON hsdg.engagement_services;
DROP POLICY IF EXISTS engagement_services_select ON hsdg.engagement_services;

DROP TRIGGER IF EXISTS engagements_propagate_identity ON hsdg.engagements;
DROP TRIGGER IF EXISTS engagements_create_primary_service ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.engagement_services_propagate_identity();
DROP FUNCTION IF EXISTS hsdg.engagement_services_create_primary();

DROP TABLE IF EXISTS hsdg.engagement_services CASCADE;
DROP FUNCTION IF EXISTS hsdg.engagement_services_sync_identity();
DROP FUNCTION IF EXISTS hsdg.engagement_service_status_from(text);

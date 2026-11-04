-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-304 · the UDIN register.
--
-- "Every attest report and certificate needs a UDIN, generated within ICAI's
-- time limit. Peer review checks the register." One row per UDIN the firm
-- generated: the document it is for, the client, the signing partner (and
-- their membership no. as it was), the signing and generation dates.
--
--   · udin is unique and has the archive record's format (2-digit year,
--     6-digit membership no., 10 letters or digits). A wrong UDIN is revoked
--     with its reason, never edited or deleted.
--   · firm_settings.udin_window_days (default 60) is the days after signing
--     within which the UDIN must be generated. The stream leads confirm
--     ICAI's current limit through the verification flow.
--   · The audit archive record's UDIN and a signed tax audit's UDIN are
--     written through to the register (source 'archive' / 'tax_audit'), and
--     the ones already recorded are backfilled. The write-through reads the
--     engagement and the partner's profile as the owner under its own flag.
--   · Rows are visible exactly when the client is; the API asks
--     register.manage to add or revoke one.
--   · udin_window_closing (notifications scan) nudges the signing partner 7
--     days before the window ends for a document signed without a UDIN; a
--     UDIN recorded for it clears the nudge.
--   · A client merged into another takes its UDINs with it.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE hsdg.firm_settings
  ADD COLUMN udin_window_days smallint NOT NULL DEFAULT 60
    CHECK (udin_window_days BETWEEN 1 AND 365);

CREATE TABLE hsdg.udin_register (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  udin                        text NOT NULL UNIQUE CHECK (udin ~ '^[0-9]{8}[A-Z0-9]{10}$'),
  document_kind               text NOT NULL
                                CHECK (document_kind IN ('audit_report', 'tax_audit', 'gst_audit',
                                                         'certificate', 'other')),
  entity_id                   uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE RESTRICT,
  engagement_id               uuid REFERENCES hsdg.engagements (id) ON DELETE SET NULL,
  document_id                 uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  signing_partner_employee_id uuid NOT NULL REFERENCES hsdg.employees (id),
  -- The partner's membership no. when the row was made (partner_profiles).
  membership_no               text,
  signed_on                   date NOT NULL,
  generated_on                date NOT NULL,
  financial_year              text CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  description                 text CHECK (description IS NULL OR length(description) <= 500),
  -- Where the row came from: typed in, or written through from the archive
  -- record (service_workflow_instances.id) or a tax audit (tax_audits.id).
  source                      text NOT NULL DEFAULT 'manual'
                                CHECK (source IN ('manual', 'archive', 'tax_audit')),
  source_id                   uuid,
  status                      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revoked_reason              text,
  revoked_at                  timestamptz,
  revoked_by_employee_id      uuid REFERENCES hsdg.employees (id),
  created_by_employee_id      uuid REFERENCES hsdg.employees (id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  version                     integer NOT NULL DEFAULT 1,
  CONSTRAINT udin_register_revoked CHECK (
    (status = 'active' AND revoked_reason IS NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND length(btrim(revoked_reason)) BETWEEN 1 AND 500
        AND revoked_at IS NOT NULL)),
  CONSTRAINT udin_register_source CHECK ((source = 'manual') = (source_id IS NULL))
);
CREATE INDEX udin_register_entity_idx ON hsdg.udin_register (entity_id);
CREATE INDEX udin_register_engagement_idx ON hsdg.udin_register (engagement_id)
  WHERE engagement_id IS NOT NULL;
CREATE INDEX udin_register_source_idx ON hsdg.udin_register (source_id) WHERE source_id IS NOT NULL;
CREATE INDEX udin_register_signed_idx ON hsdg.udin_register (signed_on DESC);
CREATE TRIGGER udin_register_set_updated_at BEFORE UPDATE ON hsdg.udin_register
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

REVOKE ALL ON hsdg.udin_register FROM PUBLIC;
REVOKE ALL ON hsdg.udin_register FROM hsdg_app;
GRANT SELECT, INSERT ON hsdg.udin_register TO hsdg_app;
-- Never edited after entry: revoked with a reason, or its document attached.
GRANT UPDATE (status, revoked_reason, revoked_at, revoked_by_employee_id, document_id,
              description, version)
  ON hsdg.udin_register TO hsdg_app;
ALTER TABLE hsdg.udin_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.udin_register FORCE  ROW LEVEL SECURITY;
CREATE POLICY udin_register_owner ON hsdg.udin_register
  TO hsdg_migrator USING (true) WITH CHECK (true);
-- Visible exactly when the client is.
CREATE POLICY udin_register_select ON hsdg.udin_register
  FOR SELECT TO hsdg_app USING (EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_id));
CREATE POLICY udin_register_insert ON hsdg.udin_register
  FOR INSERT TO hsdg_app WITH CHECK (
    source = 'manual'
    AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_id)
    AND (engagement_id IS NULL
         OR EXISTS (SELECT 1 FROM hsdg.engagements g
                     WHERE g.id = engagement_id AND g.entity_id = udin_register.entity_id)));
CREATE POLICY udin_register_update ON hsdg.udin_register
  FOR UPDATE TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_id))
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_id));

-- ── Write-through from the archive record and the tax audit ────────────
CREATE FUNCTION hsdg.udin_writing() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT current_user = 'hsdg_migrator'
     AND COALESCE(current_setting('hsdg.udin_writing', true), '') = 'on'
$$;
CREATE POLICY engagements_udin_writing ON hsdg.engagements
  FOR SELECT TO hsdg_migrator USING (hsdg.udin_writing());
CREATE POLICY partner_profiles_udin_writing ON hsdg.partner_profiles
  FOR SELECT TO hsdg_migrator USING (hsdg.udin_writing());

-- One register row for a UDIN recorded on a document; an existing row for
-- the same UDIN is left as it is. Clears the document's window nudge.
CREATE FUNCTION hsdg.udin_write_through(
  p_udin text, p_kind text, p_source text, p_source_id uuid, p_engagement uuid,
  p_partner uuid, p_signed_on date, p_generated_on date, p_financial_year text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM set_config('hsdg.udin_writing', 'on', true);
  IF p_partner IS NOT NULL AND p_signed_on IS NOT NULL THEN
    INSERT INTO hsdg.udin_register
      (udin, document_kind, entity_id, engagement_id, signing_partner_employee_id, membership_no,
       signed_on, generated_on, financial_year, source, source_id)
    SELECT p_udin, p_kind, e.entity_id, e.id, p_partner,
           (SELECT pp.membership_no FROM hsdg.partner_profiles pp WHERE pp.employee_id = p_partner),
           p_signed_on, GREATEST(p_signed_on, COALESCE(p_generated_on, p_signed_on)),
           COALESCE(p_financial_year, e.financial_year), p_source, p_source_id
      FROM hsdg.engagements e
     WHERE e.id = p_engagement
    ON CONFLICT (udin) DO NOTHING;
  END IF;
  PERFORM hsdg.resolve_notifications(
    CASE p_source WHEN 'archive' THEN 'service_workflow_instance' ELSE 'tax_audit' END,
    ARRAY[p_source_id], ARRAY['udin_window_closing']);
  PERFORM set_config('hsdg.udin_writing', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.udin_write_through(text, text, text, uuid, uuid, uuid, date, date, text)
  FROM PUBLIC;

CREATE FUNCTION hsdg.udin_from_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM hsdg.udin_write_through(
    NEW.udin, 'audit_report', 'archive', NEW.id, NEW.engagement_id,
    COALESCE(NEW.signed_off_by_employee_id,
             (SELECT e.engagement_partner_id FROM hsdg.engagements e WHERE e.id = NEW.engagement_id)),
    COALESCE(NEW.report_date, timezone('Asia/Kolkata', NEW.signed_off_at)::date),
    timezone('Asia/Kolkata', now())::date, NULL);
  RETURN NULL;
END $$;
CREATE TRIGGER service_workflow_instances_udin_register
  AFTER INSERT OR UPDATE OF udin ON hsdg.service_workflow_instances
  FOR EACH ROW WHEN (NEW.udin IS NOT NULL)
  EXECUTE FUNCTION hsdg.udin_from_archive();

CREATE FUNCTION hsdg.udin_from_tax_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM hsdg.udin_write_through(
    NEW.udin, 'tax_audit', 'tax_audit', NEW.id, NEW.engagement_id,
    COALESCE(NEW.signed_by_employee_id, NEW.signing_partner_id),
    timezone('Asia/Kolkata', NEW.signed_at)::date,
    timezone('Asia/Kolkata', now())::date, NEW.financial_year);
  RETURN NULL;
END $$;
CREATE TRIGGER tax_audits_udin_register
  AFTER INSERT OR UPDATE OF udin ON hsdg.tax_audits
  FOR EACH ROW WHEN (NEW.udin IS NOT NULL)
  EXECUTE FUNCTION hsdg.udin_from_tax_audit();

-- ── A merged client's UDINs follow it ───────────────────────────────────
CREATE FUNCTION hsdg.udin_register_follow_merge() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  UPDATE hsdg.udin_register SET entity_id = NEW.merged_into_id WHERE entity_id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER entities_udin_register_follow_merge
  AFTER UPDATE OF merged_into_id ON hsdg.entities
  FOR EACH ROW WHEN (NEW.merged_into_id IS NOT NULL AND OLD.merged_into_id IS NULL)
  EXECUTE FUNCTION hsdg.udin_register_follow_merge();

-- ── A UDIN added by hand clears its report's window nudge ───────────────
-- (The write-through clears its own; this is the register-side entry for an
-- engagement's audit report or tax audit.)
CREATE FUNCTION hsdg.udin_register_clears_window() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  UPDATE hsdg.notifications
     SET status = 'read', read_at = now(), resolved_at = now()
   WHERE status = 'unread'
     AND type = 'udin_window_closing'
     AND engagement_id = NEW.engagement_id
     AND object_type = CASE NEW.document_kind
                         WHEN 'tax_audit' THEN 'tax_audit'
                         ELSE 'service_workflow_instance' END;
  RETURN NULL;
END $$;
CREATE TRIGGER udin_register_clears_window
  AFTER INSERT ON hsdg.udin_register
  FOR EACH ROW WHEN (NEW.engagement_id IS NOT NULL
                     AND NEW.document_kind IN ('audit_report', 'tax_audit'))
  EXECUTE FUNCTION hsdg.udin_register_clears_window();

-- ── Backfill: the UDINs already on archive records and tax audits ───────
ALTER TABLE hsdg.service_workflow_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audits NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.partner_profiles NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.udin_register
  (udin, document_kind, entity_id, engagement_id, signing_partner_employee_id, membership_no,
   signed_on, generated_on, financial_year, source, source_id)
SELECT w.udin, 'audit_report', e.entity_id, e.id, p.id, pp.membership_no, s.signed_on,
       GREATEST(s.signed_on, COALESCE(timezone('Asia/Kolkata', w.archived_at)::date, s.signed_on)),
       e.financial_year, 'archive', w.id
  FROM hsdg.service_workflow_instances w
  JOIN hsdg.engagements e ON e.id = w.engagement_id
  CROSS JOIN LATERAL (SELECT COALESCE(w.signed_off_by_employee_id, e.engagement_partner_id) AS id) p
  CROSS JOIN LATERAL (SELECT COALESCE(w.report_date,
                                      timezone('Asia/Kolkata', w.signed_off_at)::date) AS signed_on) s
  LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = p.id
 WHERE w.udin IS NOT NULL AND p.id IS NOT NULL AND s.signed_on IS NOT NULL
ON CONFLICT (udin) DO NOTHING;
INSERT INTO hsdg.udin_register
  (udin, document_kind, entity_id, engagement_id, signing_partner_employee_id, membership_no,
   signed_on, generated_on, financial_year, source, source_id)
SELECT a.udin, 'tax_audit', e.entity_id, e.id, p.id, pp.membership_no,
       timezone('Asia/Kolkata', a.signed_at)::date, timezone('Asia/Kolkata', a.signed_at)::date,
       a.financial_year, 'tax_audit', a.id
  FROM hsdg.tax_audits a
  JOIN hsdg.engagements e ON e.id = a.engagement_id
  CROSS JOIN LATERAL (SELECT COALESCE(a.signed_by_employee_id, a.signing_partner_id) AS id) p
  LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = p.id
 WHERE a.udin IS NOT NULL AND a.signed_at IS NOT NULL AND p.id IS NOT NULL
ON CONFLICT (udin) DO NOTHING;
ALTER TABLE hsdg.partner_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audits FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_workflow_instances FORCE ROW LEVEL SECURITY;

-- ── Notification type udin_window_closing ───────────────────────────────
CREATE OR REPLACE FUNCTION hsdg.notification_types_now() RETURNS text[]
  LANGUAGE sql STABLE AS $$
  SELECT array_remove(regexp_split_to_array(
           regexp_replace(
             replace(replace(substring(pg_get_constraintdef(c.oid) FROM 'ANY \((.*)$'),
                             '::text', ''), 'ARRAY', ''),
             '[^a-z_,]', '', 'g'),
           ','), '')
    FROM pg_constraint c
   WHERE c.conrelid = 'hsdg.notifications'::regclass AND c.conname = 'notifications_type_check'
$$;
DO $$
DECLARE
  types text[] := hsdg.notification_types_now();
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  types := array_append(array_remove(types, 'udin_window_closing'), 'udin_window_closing');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- ── Permission register.manage ──────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.permissions (slug, description) VALUES
  ('register.manage', 'Add to and revoke entries in the UDIN and DSC registers; check DSC tokens out and in')
  ON CONFLICT (slug) DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'register.manage'
 WHERE r.slug IN ('managing_partner', 'partner', 'manager', 'admin', 'accountant')
ON CONFLICT DO NOTHING;
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'register.manage');
DELETE FROM hsdg.permissions WHERE slug = 'register.manage';
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.notifications WHERE type = 'udin_window_closing';
DO $$
DECLARE
  types text[] := array_remove(hsdg.notification_types_now(), 'udin_window_closing');
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

DROP TRIGGER IF EXISTS udin_register_clears_window ON hsdg.udin_register;
DROP FUNCTION IF EXISTS hsdg.udin_register_clears_window();
DROP TRIGGER IF EXISTS entities_udin_register_follow_merge ON hsdg.entities;
DROP FUNCTION IF EXISTS hsdg.udin_register_follow_merge();
DROP TRIGGER IF EXISTS tax_audits_udin_register ON hsdg.tax_audits;
DROP FUNCTION IF EXISTS hsdg.udin_from_tax_audit();
DROP TRIGGER IF EXISTS service_workflow_instances_udin_register ON hsdg.service_workflow_instances;
DROP FUNCTION IF EXISTS hsdg.udin_from_archive();
DROP FUNCTION IF EXISTS hsdg.udin_write_through(text, text, text, uuid, uuid, uuid, date, date, text);
DROP POLICY IF EXISTS partner_profiles_udin_writing ON hsdg.partner_profiles;
DROP POLICY IF EXISTS engagements_udin_writing ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.udin_writing();
DROP TABLE IF EXISTS hsdg.udin_register;
ALTER TABLE hsdg.firm_settings DROP COLUMN IF EXISTS udin_window_days;

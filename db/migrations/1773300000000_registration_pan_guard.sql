-- ─────────────────────────────────────────────────────────────────────────
-- A GSTIN carries its client's PAN (characters 3–12)
--
-- A GSTIN whose PAN differs from its client's PAN belongs to another legal
-- entity, and the merge rules already treat two PANs as two clients. The API
-- checks this on every screen and import (CM-1); these triggers are the
-- backstop for any other write.
--
-- Only new writes are checked, and only active GSTINs: a cancelled GSTIN of
-- an old PAN (a proprietorship turned company) is history. Existing bad rows
-- stay until the data check fixes them, so this cannot fail on live data.
-- merge_entities only merges clients of one PAN, so it never trips them.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.gstin_pan(p_number text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(substr(regexp_replace(p_number, '[^0-9A-Za-z]', '', 'g'), 3, 10))
$$;

CREATE OR REPLACE FUNCTION hsdg.entity_registrations_pan_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_pan text;
BEGIN
  IF NEW.registration_type <> 'gstin' OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  SELECT pan INTO v_pan FROM hsdg.entities WHERE id = NEW.entity_id;
  IF v_pan IS NOT NULL AND hsdg.gstin_pan(NEW.registration_number) <> v_pan THEN
    RAISE EXCEPTION 'GSTIN % is for PAN %, but the client''s PAN is %',
        NEW.registration_number, hsdg.gstin_pan(NEW.registration_number), v_pan
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registration_pan_mismatch';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER entity_registrations_pan_guard
  BEFORE INSERT OR UPDATE OF registration_number, status, entity_id ON hsdg.entity_registrations
  FOR EACH ROW EXECUTE FUNCTION hsdg.entity_registrations_pan_guard();

CREATE OR REPLACE FUNCTION hsdg.entities_pan_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_numbers text;
BEGIN
  IF NEW.pan IS NULL OR NEW.pan IS NOT DISTINCT FROM OLD.pan THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(registration_number, ', ' ORDER BY registration_number) INTO v_numbers
    FROM hsdg.entity_registrations
   WHERE entity_id = NEW.id AND registration_type = 'gstin' AND status = 'active'
     AND hsdg.gstin_pan(registration_number) <> NEW.pan;
  IF v_numbers IS NOT NULL THEN
    RAISE EXCEPTION 'Remove or move GSTINs % first: they are for another PAN', v_numbers
      USING ERRCODE = 'check_violation', CONSTRAINT = 'entity_pan_gstin_mismatch';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER entities_pan_guard
  BEFORE UPDATE OF pan ON hsdg.entities
  FOR EACH ROW EXECUTE FUNCTION hsdg.entities_pan_guard();

-- Down Migration

DROP TRIGGER IF EXISTS entities_pan_guard ON hsdg.entities;
DROP FUNCTION IF EXISTS hsdg.entities_pan_guard();
DROP TRIGGER IF EXISTS entity_registrations_pan_guard ON hsdg.entity_registrations;
DROP FUNCTION IF EXISTS hsdg.entity_registrations_pan_guard();
DROP FUNCTION IF EXISTS hsdg.gstin_pan(text);

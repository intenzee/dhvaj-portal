-- ─────────────────────────────────────────────────────────────────────────
-- Fix: an engagement inserted without a kind got NULL (NOT NULL violation)
-- when the insert ran with no RLS context — the superuser seeds, provisioning
-- scripts. engagement_kind_for_service is SECURITY DEFINER, but its owner
-- (hsdg_migrator) is still subject to FORCE ROW LEVEL SECURITY on services,
-- whose read policy needs a context role; with none it saw no service.
--
-- The trigger now reads the service itself, as the caller: a superuser
-- bypasses RLS and the application role reads services under its context.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.engagements_default_kind_and_code() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  prefix text;
BEGIN
  IF NEW.kind IS NULL THEN
    SELECT CASE
             WHEN s.code = 'STAT_AUDIT' THEN 'statutory_audit'
             WHEN s.stream IS NOT NULL  THEN 'compliance'
             ELSE 'assignment'
           END
      INTO NEW.kind
      FROM hsdg.services s
     WHERE s.id = NEW.service_id;
    IF NEW.kind IS NULL THEN
      RAISE EXCEPTION 'Engagement kind could not be derived: service % not found.', NEW.service_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  -- Default codes (ENG00123) become SA/00123, CR/00123, AS/00123 — same
  -- sequence number, so codes stay unique and ordered. Explicit codes stand.
  IF NEW.engagement_code ~ '^ENG[0-9]+$' THEN
    prefix := CASE NEW.kind WHEN 'statutory_audit' THEN 'SA' WHEN 'compliance' THEN 'CR' ELSE 'AS' END;
    NEW.engagement_code := prefix || '/' || substring(NEW.engagement_code FROM 4);
  END IF;
  RETURN NEW;
END;
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.engagements_default_kind_and_code() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  prefix text;
BEGIN
  IF NEW.kind IS NULL THEN
    NEW.kind := hsdg.engagement_kind_for_service(NEW.service_id);
  END IF;
  IF NEW.engagement_code ~ '^ENG[0-9]+$' THEN
    prefix := CASE NEW.kind WHEN 'statutory_audit' THEN 'SA' WHEN 'compliance' THEN 'CR' ELSE 'AS' END;
    NEW.engagement_code := prefix || '/' || substring(NEW.engagement_code FROM 4);
  END IF;
  RETURN NEW;
END;
$$;

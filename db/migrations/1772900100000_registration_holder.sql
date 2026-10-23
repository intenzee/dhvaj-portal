-- ─────────────────────────────────────────────────────────────────────────
-- Which client a registration number is already recorded on
--
-- A GSTIN / TAN / CIN … is unique firm-wide (entity_registrations_number_unique).
-- Adding one that is already recorded said only "This registration number is
-- already recorded." — and when it sat on a client of another office (the GST
-- sheet import puts each GSTIN on the client it matches), the person adding it
-- could not find it at all. The API now names the client holding it, so it
-- can be removed there if it was put on the wrong one.
--
-- Only the holder's id and name are returned, and only to a signed-in user.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- The owner looks across offices, and only while registration_holder has
-- said so for its transaction.
CREATE POLICY entity_registrations_holder_select ON hsdg.entity_registrations
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.finding_registration_holder', true) = 'on');
CREATE POLICY entities_registration_holder_select ON hsdg.entities
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.finding_registration_holder', true) = 'on');

/** The client a registration number of this type is recorded on, if any. */
CREATE OR REPLACE FUNCTION hsdg.registration_holder(p_type text, p_number text)
  RETURNS TABLE (entity_id uuid, legal_name text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF hsdg.ctx_user_id() IS NULL THEN RETURN; END IF;
  PERFORM set_config('hsdg.finding_registration_holder', 'on', true);
  RETURN QUERY
    SELECT e.id, e.legal_name
      FROM hsdg.entity_registrations r
      JOIN hsdg.entities e ON e.id = r.entity_id
     WHERE r.registration_type = p_type AND r.registration_number = p_number
     LIMIT 1;
  PERFORM set_config('hsdg.finding_registration_holder', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.registration_holder(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.registration_holder(text, text) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.registration_holder(text, text);
DROP POLICY IF EXISTS entities_registration_holder_select ON hsdg.entities;
DROP POLICY IF EXISTS entity_registrations_holder_select ON hsdg.entity_registrations;

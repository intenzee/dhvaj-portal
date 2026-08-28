-- ─────────────────────────────────────────────────────────────────────────
-- 0033 · Registration write-back to the Registration Master  (spec §40:
--        "Registration work updates the central Registration Master")
--
-- Some catalogue components ARE registration work (GST registration, IEC, Udyam,
-- …). When such a component's work is completed with the number the authority
-- issued, that number must land in the central Registration Master
-- (entity_registrations) — not be re-keyed by hand later.
--
--   • service_components.sets_registration_type — marks a catalogue component as
--     registration work and names the registration type it produces.
--   • hsdg.record_engagement_registration(...) — a SECURITY DEFINER writer so an
--     engagement LEAD can record the produced registration into the master even
--     without firm-wide entity.manage, gated to engagements they lead that
--     actually cover the target entity. Upserts by (type, number).
--
-- STRICTLY ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.service_components
  ADD COLUMN sets_registration_type text CHECK (sets_registration_type IS NULL OR
    sets_registration_type IN ('gstin','cin','llpin','tan','iec','pt','esic','pf','other'));

COMMENT ON COLUMN hsdg.service_components.sets_registration_type IS
  'When set, this component IS registration work; completing its instance records a '
  'registration of this type into entity_registrations (spec §40).';

-- Writer: engagement-lead-gated upsert into the Registration Master. SECURITY
-- DEFINER (owned by the migrator, which owns the table) so a lead without
-- firm-wide entity.manage can still record the registration their engagement
-- produced — but only for an entity the engagement actually covers.
CREATE OR REPLACE FUNCTION hsdg.record_engagement_registration(
  p_engagement_id     uuid,
  p_entity_id         uuid,
  p_registration_type text,
  p_registration_number text,
  p_state_code        text DEFAULT NULL,
  p_valid_from        date DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  reg_id uuid;
BEGIN
  IF NOT hsdg.is_engagement_lead(p_engagement_id) THEN
    RAISE EXCEPTION 'Only an engagement lead may record a registration.'
      USING ERRCODE = '42501';
  END IF;

  -- The engagement must cover the entity (its primary entity, or a covered
  -- entity in a group engagement) — a lead can't write to an unrelated master.
  IF NOT EXISTS (
    SELECT 1 FROM hsdg.engagements e
    WHERE e.id = p_engagement_id AND e.entity_id = p_entity_id
    UNION ALL
    SELECT 1 FROM hsdg.engagement_entities ee
    WHERE ee.engagement_id = p_engagement_id AND ee.entity_id = p_entity_id
      AND ee.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Entity % is not covered by engagement %.', p_entity_id, p_engagement_id
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO hsdg.entity_registrations
    (entity_id, registration_type, registration_number, state_code, status, valid_from)
  VALUES (p_entity_id, p_registration_type, p_registration_number, p_state_code, 'active', p_valid_from)
  ON CONFLICT (registration_type, registration_number) DO UPDATE
    SET status = 'active',
        state_code = COALESCE(EXCLUDED.state_code, hsdg.entity_registrations.state_code),
        valid_from = COALESCE(EXCLUDED.valid_from, hsdg.entity_registrations.valid_from),
        updated_at = now()
  RETURNING id INTO reg_id;

  RETURN reg_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  hsdg.record_engagement_registration(uuid, uuid, text, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  hsdg.record_engagement_registration(uuid, uuid, text, text, text, date) TO hsdg_app;

-- Down Migration
DROP FUNCTION IF EXISTS hsdg.record_engagement_registration(uuid, uuid, text, text, text, date);
ALTER TABLE hsdg.service_components DROP COLUMN IF EXISTS sets_registration_type;

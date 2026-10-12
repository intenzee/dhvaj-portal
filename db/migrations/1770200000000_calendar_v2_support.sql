-- ─────────────────────────────────────────────────────────────────────────
-- Calendar v2 support (spec Change 4).
--
-- entity_registrations is office-scoped, but the people running a client's
-- Compliance engagement may sit in another office. The generator, the
-- new-engagement wizard and the profile editor read the client's
-- registrations through this definer function, gated by the same rule as the
-- compliance profiles (firm-wide, the client's office, or a member of one of
-- the client's engagements).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE FUNCTION hsdg.entity_compliance_registrations(ent_id uuid)
RETURNS TABLE (
  id uuid,
  registration_type text,
  registration_number text,
  state_code text,
  status text,
  is_principal boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
  SELECT r.id, r.registration_type, r.registration_number, r.state_code, r.status,
         COALESCE(r.is_principal, false)
    FROM hsdg.entity_registrations r
   WHERE r.entity_id = ent_id
     AND hsdg.can_read_entity_compliance(ent_id)
   ORDER BY r.registration_type, COALESCE(r.is_principal, false) DESC, r.registration_number
$$;

REVOKE ALL ON FUNCTION hsdg.entity_compliance_registrations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.entity_compliance_registrations(uuid) TO hsdg_app;

-- The labels of a batch of registrations for calendar rows: one call per
-- calendar page instead of one per row (same gate, by each row's entity).
CREATE FUNCTION hsdg.compliance_registrations(reg_ids uuid[])
RETURNS TABLE (id uuid, registration_type text, registration_number text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
  SELECT r.id, r.registration_type, r.registration_number
    FROM hsdg.entity_registrations r
   WHERE r.id = ANY(reg_ids)
     AND hsdg.can_read_entity_compliance(r.entity_id)
$$;

REVOKE ALL ON FUNCTION hsdg.compliance_registrations(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.compliance_registrations(uuid[]) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.compliance_registrations(uuid[]);
DROP FUNCTION IF EXISTS hsdg.entity_compliance_registrations(uuid);

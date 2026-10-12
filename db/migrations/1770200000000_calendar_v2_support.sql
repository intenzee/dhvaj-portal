-- ─────────────────────────────────────────────────────────────────────────
-- Calendar v2 support (spec Change 4).
--
-- entity_registrations is office-scoped, but the people running a client's
-- Compliance engagement may sit in another office. A member of one of the
-- client's engagements can already see the client (entities_select, via
-- can_access_entity_via_engagement); this policy lets them see its
-- registrations too, so the generator, the new-engagement wizard and the
-- profile editor work for a cross-office team.
--
-- The two read functions are plain (invoker) functions: every function here is
-- owned by hsdg_migrator, which is itself subject to FORCE ROW LEVEL SECURITY,
-- so SECURITY DEFINER would not widen what the caller sees anyway. They read
-- through the caller's policies, gated by the compliance-profile rule.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE POLICY entity_registrations_compliance_read ON hsdg.entity_registrations
  FOR SELECT
  USING (hsdg.can_access_entity_via_engagement(entity_id));

CREATE FUNCTION hsdg.entity_compliance_registrations(ent_id uuid)
RETURNS TABLE (
  id uuid,
  registration_type text,
  registration_number text,
  state_code text,
  status text,
  is_principal boolean
)
LANGUAGE sql STABLE
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
LANGUAGE sql STABLE
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
DROP POLICY IF EXISTS entity_registrations_compliance_read ON hsdg.entity_registrations;

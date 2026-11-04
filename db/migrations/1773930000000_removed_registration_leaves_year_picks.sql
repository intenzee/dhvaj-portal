-- ─────────────────────────────────────────────────────────────────────────
-- A registration removed leaves the engagement years that picked it
--
-- A Compliance year keeps the registrations each stream covers
-- (stream_registrations: the GSTINs of its GST months). A wrong GSTIN that was
-- removed stayed in that pick, so when the right one was entered the year
-- still asked for the removed GSTIN only: no months were built, and the GST
-- tab said "GSTIN missing" though the client had one. The generator now
-- treats a pick of no active registration as no pick; the removed id is also
-- taken out of every year's pick, and the stale ids already there go now.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE POLICY compliance_engagement_years_removing_registration_select
  ON hsdg.compliance_engagement_years
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.removing_registration', true) = 'on');
CREATE POLICY compliance_engagement_years_removing_registration_update
  ON hsdg.compliance_engagement_years
  FOR UPDATE TO hsdg_migrator
  USING (current_setting('hsdg.removing_registration', true) = 'on')
  WITH CHECK (current_setting('hsdg.removing_registration', true) = 'on');

/** `picks` (stream → registration ids) without `removed`. */
CREATE OR REPLACE FUNCTION hsdg.strip_registration_pick(picks jsonb, removed uuid)
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(t.k, (
           SELECT COALESCE(jsonb_agg(x.v), '[]'::jsonb)
             FROM jsonb_array_elements(t.v) AS x(v)
            WHERE x.v <> to_jsonb(removed::text))), '{}'::jsonb)
    FROM jsonb_each(picks) AS t(k, v)
   WHERE jsonb_typeof(t.v) = 'array'
$$;

/** Refuse to remove a registration with a lodged return; cancel its filings' open requests. */
CREATE OR REPLACE FUNCTION hsdg.entity_registrations_before_delete() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  lodged integer;
BEGIN
  PERFORM set_config('hsdg.removing_registration', 'on', true);
  SELECT count(*) INTO lodged
    FROM hsdg.filing_records fr
   WHERE fr.registration_id = OLD.id
      OR fr.compliance_instance_id IN (SELECT ci.id FROM hsdg.compliance_instances ci
                                        WHERE ci.registration_id = OLD.id);
  IF lodged > 0 THEN
    PERFORM set_config('hsdg.removing_registration', '', true);
    RAISE EXCEPTION '% has % lodged in the portal, so it cannot be removed. Set its status to Cancelled instead.',
      OLD.registration_number,
      CASE lodged WHEN 1 THEN 'a return' ELSE lodged || ' returns' END
      USING ERRCODE = 'restrict_violation';
  END IF;
  UPDATE hsdg.client_dependencies d
     SET status = 'cancelled', version = version + 1
   WHERE d.compliance_instance_id IN (SELECT ci.id FROM hsdg.compliance_instances ci
                                       WHERE ci.registration_id = OLD.id)
     AND d.status IN ('pending', 'partially_received');
  UPDATE hsdg.compliance_engagement_years y
     SET stream_registrations = hsdg.strip_registration_pick(y.stream_registrations, OLD.id),
         version = version + 1
   WHERE y.stream_registrations::text LIKE '%' || OLD.id::text || '%';
  PERFORM set_config('hsdg.removing_registration', '', true);
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION hsdg.entity_registrations_before_delete() FROM PUBLIC;

-- The picks of registrations removed before now.
ALTER TABLE hsdg.compliance_engagement_years NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.compliance_engagement_years y
   SET stream_registrations = (
         SELECT COALESCE(jsonb_object_agg(t.k, (
                  SELECT COALESCE(jsonb_agg(x.v), '[]'::jsonb)
                    FROM jsonb_array_elements(t.v) AS x(v)
                   WHERE EXISTS (SELECT 1 FROM hsdg.entity_registrations r
                                  WHERE r.id::text = x.v #>> '{}'))), '{}'::jsonb)
           FROM jsonb_each(y.stream_registrations) AS t(k, v)
          WHERE jsonb_typeof(t.v) = 'array'),
       version = version + 1
 WHERE EXISTS (SELECT 1 FROM jsonb_each(y.stream_registrations) AS t(k, v),
                             jsonb_array_elements(CASE jsonb_typeof(t.v) WHEN 'array' THEN t.v
                                                       ELSE '[]'::jsonb END) AS x(v)
                WHERE NOT EXISTS (SELECT 1 FROM hsdg.entity_registrations r
                                   WHERE r.id::text = x.v #>> '{}'));
ALTER TABLE hsdg.compliance_engagement_years FORCE ROW LEVEL SECURITY;

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.entity_registrations_before_delete() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  lodged integer;
BEGIN
  PERFORM set_config('hsdg.removing_registration', 'on', true);
  SELECT count(*) INTO lodged
    FROM hsdg.filing_records fr
   WHERE fr.registration_id = OLD.id
      OR fr.compliance_instance_id IN (SELECT ci.id FROM hsdg.compliance_instances ci
                                        WHERE ci.registration_id = OLD.id);
  IF lodged > 0 THEN
    PERFORM set_config('hsdg.removing_registration', '', true);
    RAISE EXCEPTION '% has % lodged in the portal, so it cannot be removed. Set its status to Cancelled instead.',
      OLD.registration_number,
      CASE lodged WHEN 1 THEN 'a return' ELSE lodged || ' returns' END
      USING ERRCODE = 'restrict_violation';
  END IF;
  UPDATE hsdg.client_dependencies d
     SET status = 'cancelled', version = version + 1
   WHERE d.compliance_instance_id IN (SELECT ci.id FROM hsdg.compliance_instances ci
                                       WHERE ci.registration_id = OLD.id)
     AND d.status IN ('pending', 'partially_received');
  PERFORM set_config('hsdg.removing_registration', '', true);
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION hsdg.entity_registrations_before_delete() FROM PUBLIC;
DROP FUNCTION IF EXISTS hsdg.strip_registration_pick(jsonb, uuid);
DROP POLICY IF EXISTS compliance_engagement_years_removing_registration_update
  ON hsdg.compliance_engagement_years;
DROP POLICY IF EXISTS compliance_engagement_years_removing_registration_select
  ON hsdg.compliance_engagement_years;

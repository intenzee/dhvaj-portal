-- ─────────────────────────────────────────────────────────────────────────
-- A registration recorded in error can be removed with its filings
--
-- Removing a GSTIN (or TAN / CIN / LLPIN) from a client failed with "A
-- referenced record does not exist." as soon as a calendar had generated
-- filings for it: compliance_instances.registration_id was ON DELETE
-- RESTRICT, and the firm's GST sheet or the engagement had already given
-- the registration its months. The number is unique firm-wide, so a GSTIN
-- typed on the wrong client could not be entered on the right one either.
--
-- Now the filings go with the registration — their tasks, reminders,
-- checklists, deadlines and figures cascade as before; documents and time
-- entries stay on the engagement (SET NULL). Open client requests for those
-- filings are cancelled so the client is not chased for them.
--
-- A return lodged in the portal on the registration (a filing record, with
-- its acknowledgement / reference) is never deleted this way: the delete is
-- refused (restrict_violation) and the registration should be marked
-- Cancelled instead. Months the firm's GST sheet marked filed are not
-- portal lodgings; they go with the registration and its marks.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.compliance_instances
  DROP CONSTRAINT compliance_instances_registration_id_fkey,
  ADD CONSTRAINT compliance_instances_registration_id_fkey
    FOREIGN KEY (registration_id) REFERENCES hsdg.entity_registrations (id) ON DELETE CASCADE;

-- The owner looks across engagements, and only while the guard below has
-- said so for its transaction.
CREATE POLICY filing_records_removing_registration_select ON hsdg.filing_records
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.removing_registration', true) = 'on');
CREATE POLICY compliance_instances_removing_registration_select ON hsdg.compliance_instances
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.removing_registration', true) = 'on');
CREATE POLICY client_dependencies_removing_registration_select ON hsdg.client_dependencies
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.removing_registration', true) = 'on');
CREATE POLICY client_dependencies_removing_registration_update ON hsdg.client_dependencies
  FOR UPDATE TO hsdg_migrator
  USING (current_setting('hsdg.removing_registration', true) = 'on')
  WITH CHECK (current_setting('hsdg.removing_registration', true) = 'on');

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
  PERFORM set_config('hsdg.removing_registration', '', true);
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION hsdg.entity_registrations_before_delete() FROM PUBLIC;

CREATE TRIGGER entity_registrations_before_delete
  BEFORE DELETE ON hsdg.entity_registrations
  FOR EACH ROW EXECUTE FUNCTION hsdg.entity_registrations_before_delete();

-- Down Migration

DROP TRIGGER IF EXISTS entity_registrations_before_delete ON hsdg.entity_registrations;
DROP FUNCTION IF EXISTS hsdg.entity_registrations_before_delete();
DROP POLICY IF EXISTS client_dependencies_removing_registration_update ON hsdg.client_dependencies;
DROP POLICY IF EXISTS client_dependencies_removing_registration_select ON hsdg.client_dependencies;
DROP POLICY IF EXISTS compliance_instances_removing_registration_select ON hsdg.compliance_instances;
DROP POLICY IF EXISTS filing_records_removing_registration_select ON hsdg.filing_records;
ALTER TABLE hsdg.compliance_instances
  DROP CONSTRAINT compliance_instances_registration_id_fkey,
  ADD CONSTRAINT compliance_instances_registration_id_fkey
    FOREIGN KEY (registration_id) REFERENCES hsdg.entity_registrations (id) ON DELETE RESTRICT;

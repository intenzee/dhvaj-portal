-- ─────────────────────────────────────────────────────────────────────────
-- Tax Audit acceptance desk (Phase 4, F-3)
--
-- Before work starts on a year's tax audit (stage Acceptance):
--   · the s.44AB independence check (no tax audit of books the firm keeps)
--     is confirmed;
--   · if another auditor signed last year's report, the written communication
--     to them (ICAI Code of Ethics) is uploaded;
--   · the form (3CA / 3CB) and the signing partner are chosen — only a
--     partner with a valid certificate of practice (COP) and room under the
--     firm's limit of tax audit reports a year (60 at most, ICAI) signs;
--   · the appointment letter is made from the firm's approved template.
--
-- The partner profile gains the COP number and the date it is valid until;
-- the firm settings gain the yearly limit (a firm may set it lower, never
-- higher). The count runs across every client, so it is read through a
-- SECURITY DEFINER function that returns partners and counts only — never a
-- client — and a trigger refuses a partner over the limit or without a valid
-- COP whoever writes the row.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.partner_profiles
  ADD COLUMN cop_no text CHECK (cop_no IS NULL OR length(btrim(cop_no)) BETWEEN 1 AND 40),
  ADD COLUMN cop_valid_until date;

ALTER TABLE hsdg.firm_settings
  ADD COLUMN tax_audit_limit integer NOT NULL DEFAULT 60
    CHECK (tax_audit_limit BETWEEN 1 AND 60);

ALTER TABLE hsdg.tax_audits
  ADD COLUMN independence_confirmed_at timestamptz,
  ADD COLUMN independence_confirmed_by_employee_id uuid
    REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- null: not answered yet; true: another auditor signed last year's report.
  ADD COLUMN previous_auditor_changed boolean,
  ADD COLUMN previous_auditor_name text
    CHECK (previous_auditor_name IS NULL OR length(btrim(previous_auditor_name)) BETWEEN 1 AND 200),
  ADD COLUMN previous_auditor_letter_document_id uuid
    REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  ADD COLUMN appointment_letter_document_id uuid
    REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN accepted_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL;

ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate','engagement_letter',
    'client_acknowledgement','financial_reporting_framework_memo','schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii',
    'caro_applicability_memo','icfr_applicability_memo','consolidation_group_audit_memo',
    'component_auditor_instructions','audit_framework_memorandum',
    'tax_audit_appointment_letter'));

-- The template's standard variant; an administrator uploads and approves the
-- Word file. Seeded with FORCE row security lifted (and put back if it was on).
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'hsdg.document_templates'::regclass;
  IF forced THEN ALTER TABLE hsdg.document_templates NO FORCE ROW LEVEL SECURITY; END IF;
  INSERT INTO hsdg.document_templates (template_key, variant_key, title) VALUES
    ('tax_audit_appointment_letter', 'standard', 'Tax audit appointment letter')
  ON CONFLICT (template_key, variant_key) DO NOTHING;
  IF forced THEN ALTER TABLE hsdg.document_templates FORCE ROW LEVEL SECURITY; END IF;
END $$;

-- Today in IST (COP validity is by the Indian date).
CREATE FUNCTION hsdg.ist_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- partner_profiles and tax_audits force row security (office- and
-- engagement-scoped), and the count must run across every client and office:
-- the two functions below read them as their owner with this flag on while
-- they run (set on entry, cleared before they return; an error aborts the
-- transaction, and with it the setting). The policies are
-- SELECT-only and for hsdg_migrator only, as hsdg.merging_clients().
CREATE FUNCTION hsdg.tax_audit_counting() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_user = 'hsdg_migrator'
     AND COALESCE(current_setting('hsdg.tax_audit_counting', true), '') = 'on'
$$;
CREATE POLICY partner_profiles_tax_audit_counting ON hsdg.partner_profiles
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY tax_audits_tax_audit_counting ON hsdg.tax_audits
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY firm_settings_tax_audit_counting ON hsdg.firm_settings
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());

-- Every partner who may be asked to sign, with their COP and their count of
-- tax audit reports for the year (original reports, any client, not those
-- marked not applicable). Partners and counts only.
CREATE FUNCTION hsdg.tax_audit_signing_partners(p_fy text)
RETURNS TABLE (employee_id uuid, full_name text, cop_no text, cop_valid_until date,
               reports integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM set_config('hsdg.tax_audit_counting', 'on', true);
  RETURN QUERY
  SELECT e.id, e.full_name, pp.cop_no, pp.cop_valid_until,
         (SELECT count(*)::int FROM hsdg.tax_audits a
           WHERE a.signing_partner_id = e.id AND a.financial_year = p_fy
             AND a.revision = 0 AND a.stage <> 'not_applicable')
    FROM hsdg.employees e
    JOIN hsdg.grades g ON g.id = e.grade_id AND g.is_partner_grade
    LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = e.id
   WHERE e.employment_status <> 'exited'
   ORDER BY e.full_name;
  PERFORM set_config('hsdg.tax_audit_counting', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.tax_audit_signing_partners(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.tax_audit_signing_partners(text) TO hsdg_app;

-- The backstop: whoever names a signing partner, the partner holds a valid
-- COP and has room under the firm's limit. Serialised per partner and year,
-- so two acceptances at once cannot both take the last place.
CREATE FUNCTION hsdg.tax_audit_signing_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_name  text;
  v_until date;
  v_limit integer;
  v_count integer;
BEGIN
  IF NEW.signing_partner_id IS NULL OR NEW.revision <> 0 OR NEW.stage = 'not_applicable' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.signing_partner_id IS NOT DISTINCT FROM OLD.signing_partner_id
     AND OLD.stage <> 'not_applicable' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('tax_audit_signing:' || NEW.signing_partner_id::text
                                          || ':' || NEW.financial_year));
  PERFORM set_config('hsdg.tax_audit_counting', 'on', true);
  SELECT e.full_name, pp.cop_valid_until INTO v_name, v_until
    FROM hsdg.employees e LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = e.id
   WHERE e.id = NEW.signing_partner_id;
  IF v_until IS NULL OR v_until < hsdg.ist_today() THEN
    RAISE EXCEPTION 'tax_audit_cop: % has no certificate of practice valid today.', v_name
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT tax_audit_limit INTO v_limit FROM hsdg.firm_settings LIMIT 1;
  SELECT count(*) INTO v_count FROM hsdg.tax_audits a
   WHERE a.signing_partner_id = NEW.signing_partner_id AND a.financial_year = NEW.financial_year
     AND a.revision = 0 AND a.stage <> 'not_applicable' AND a.id <> NEW.id;
  IF v_count >= COALESCE(v_limit, 60) THEN
    RAISE EXCEPTION 'tax_audit_limit: % has % of % tax audit reports for FY %.',
      v_name, v_count, COALESCE(v_limit, 60), NEW.financial_year
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('hsdg.tax_audit_counting', '', true);
  RETURN NEW;
END $$;
CREATE TRIGGER tax_audits_signing_check
  BEFORE INSERT OR UPDATE OF signing_partner_id, stage ON hsdg.tax_audits
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_signing_check();

-- Down Migration

DROP TRIGGER IF EXISTS tax_audits_signing_check ON hsdg.tax_audits;
DROP FUNCTION IF EXISTS hsdg.tax_audit_signing_check();
DROP FUNCTION IF EXISTS hsdg.tax_audit_signing_partners(text);
DROP POLICY IF EXISTS firm_settings_tax_audit_counting ON hsdg.firm_settings;
DROP POLICY IF EXISTS tax_audits_tax_audit_counting ON hsdg.tax_audits;
DROP POLICY IF EXISTS partner_profiles_tax_audit_counting ON hsdg.partner_profiles;
DROP FUNCTION IF EXISTS hsdg.tax_audit_counting();
DROP FUNCTION IF EXISTS hsdg.ist_today();

DO $$
DECLARE
  forced  boolean;
  vforced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'hsdg.document_templates'::regclass;
  SELECT relforcerowsecurity INTO vforced FROM pg_class
   WHERE oid = 'hsdg.document_template_versions'::regclass;
  IF forced THEN ALTER TABLE hsdg.document_templates NO FORCE ROW LEVEL SECURITY; END IF;
  IF vforced THEN ALTER TABLE hsdg.document_template_versions NO FORCE ROW LEVEL SECURITY; END IF;
  DELETE FROM hsdg.document_template_versions v
   USING hsdg.document_templates t
   WHERE v.template_id = t.id AND t.template_key = 'tax_audit_appointment_letter';
  DELETE FROM hsdg.document_templates WHERE template_key = 'tax_audit_appointment_letter';
  IF vforced THEN ALTER TABLE hsdg.document_template_versions FORCE ROW LEVEL SECURITY; END IF;
  IF forced THEN ALTER TABLE hsdg.document_templates FORCE ROW LEVEL SECURITY; END IF;
END $$;
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate','engagement_letter',
    'client_acknowledgement','financial_reporting_framework_memo','schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii',
    'caro_applicability_memo','icfr_applicability_memo','consolidation_group_audit_memo',
    'component_auditor_instructions','audit_framework_memorandum'));

ALTER TABLE hsdg.tax_audits
  DROP COLUMN accepted_by_employee_id,
  DROP COLUMN accepted_at,
  DROP COLUMN appointment_letter_document_id,
  DROP COLUMN previous_auditor_letter_document_id,
  DROP COLUMN previous_auditor_name,
  DROP COLUMN previous_auditor_changed,
  DROP COLUMN independence_confirmed_by_employee_id,
  DROP COLUMN independence_confirmed_at;

ALTER TABLE hsdg.firm_settings DROP COLUMN tax_audit_limit;

ALTER TABLE hsdg.partner_profiles
  DROP COLUMN cop_valid_until,
  DROP COLUMN cop_no;

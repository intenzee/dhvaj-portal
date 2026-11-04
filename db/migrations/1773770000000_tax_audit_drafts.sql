-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- Tax audit drafts from portal data (Phase 4, F-6)
--
-- "The firm often already files the client's GST and TDS, and may have done
-- last year's tax audit. Those clauses open with a first draft instead of a
-- blank form" (plan F.3). The drafter reads, for one audit:
--
--   client master   the entity, its PAN, status, address and registrations,
--                   and the year's s.44AB applicability decision
--   GST and TDS     the year's returns the firm filed for the entity, on any
--                   of its engagements (filing records not undone)
--   last year       the done answers of last year's tax audit of the entity
--   MSME list       the client's answer to the "List of MSME suppliers" ask
--
-- The filings sit on the client's compliance engagements, which the audit's
-- partner, manager or preparer need not be a member of. So one SECURITY
-- DEFINER function returns these sources for an audit, and only to a member
-- of the audit's own engagement. It reads as its owner with the F-3 flag
-- hsdg.tax_audit_counting on (set on entry, cleared before it returns); the
-- policies below are SELECT-only and for hsdg_migrator only.
-- ─────────────────────────────────────────────────────────────────────────

CREATE POLICY engagements_tax_audit_counting ON hsdg.engagements
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY entities_tax_audit_counting ON hsdg.entities
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY entity_types_tax_audit_counting ON hsdg.entity_types
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY entity_addresses_tax_audit_counting ON hsdg.entity_addresses
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY entity_registrations_tax_audit_counting ON hsdg.entity_registrations
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY tax_audit_applicability_tax_audit_counting ON hsdg.tax_audit_applicability
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY compliance_instances_tax_audit_counting ON hsdg.compliance_instances
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY compliance_rules_tax_audit_counting ON hsdg.compliance_rules
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY compliance_rule_versions_tax_audit_counting ON hsdg.compliance_rule_versions
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY government_extensions_tax_audit_counting ON hsdg.government_extensions
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY filing_records_tax_audit_counting ON hsdg.filing_records
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY tax_audit_working_papers_tax_audit_counting ON hsdg.tax_audit_working_papers
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());
CREATE POLICY client_dependencies_tax_audit_counting ON hsdg.client_dependencies
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_counting());

-- What the portal knows for an audit's drafts, as one jsonb object:
--   financialYear, master {legalName, pan, typeSlug, typeName, typeCategory,
--   incorporationDate, address}, registrations [{type, number, state}],
--   applicability {applicable, clause}, filings [{stream, form, registration,
--   periodKey, periodStart, periodEnd, dueDate, filedOn, isNil, figures,
--   lateFee, interest}], lastYear {auditId, financialYear, answers {clause:
--   answer}} or null, msme {status, receivedDate} or null.
-- Raises 42501 unless the caller is a member of the audit's engagement.
CREATE FUNCTION hsdg.tax_audit_draft_sources(p_audit uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_eng uuid;
  v_fy text;
  v_entity uuid;
  v_from date;
  v_to date;
  v_prev text;
  v_out jsonb;
BEGIN
  PERFORM set_config('hsdg.tax_audit_counting', 'on', true);
  SELECT a.engagement_id, a.financial_year, e.entity_id
    INTO v_eng, v_fy, v_entity
    FROM hsdg.tax_audits a JOIN hsdg.engagements e ON e.id = a.engagement_id
   WHERE a.id = p_audit;
  IF v_eng IS NULL OR NOT hsdg.is_engagement_member(v_eng) THEN
    PERFORM set_config('hsdg.tax_audit_counting', '', true);
    RAISE EXCEPTION 'Not a member of this tax audit''s engagement.' USING ERRCODE = '42501';
  END IF;
  v_from := make_date(left(v_fy, 4)::int, 4, 1);
  v_to := make_date(left(v_fy, 4)::int + 1, 3, 31);
  v_prev := (left(v_fy, 4)::int - 1)::text || '-' || lpad((left(v_fy, 4)::int % 100)::text, 2, '0');

  SELECT jsonb_build_object(
    'financialYear', v_fy,
    'master', (
      SELECT jsonb_build_object(
        'legalName', ent.legal_name,
        'pan', ent.pan,
        'typeSlug', t.slug,
        'typeName', t.name,
        'typeCategory', t.category,
        'incorporationDate', ent.incorporation_date,
        'address', (
          SELECT concat_ws(', ', NULLIF(trim(ad.line1), ''), NULLIF(trim(ad.line2), ''),
                           NULLIF(trim(ad.city), ''), NULLIF(trim(ad.state), ''),
                           NULLIF(trim(ad.pincode), ''))
            FROM hsdg.entity_addresses ad
           WHERE ad.entity_id = ent.id AND ad.branch_id IS NULL
           ORDER BY ad.is_primary DESC,
                    array_position(ARRAY['registered','business','communication','other','branch'],
                                   ad.address_type),
                    ad.created_at
           LIMIT 1))
        FROM hsdg.entities ent
        LEFT JOIN hsdg.entity_types t ON t.id = ent.entity_type_id
       WHERE ent.id = v_entity),
    'registrations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'type', r.registration_type, 'number', r.registration_number,
               'state', COALESCE(r.state_code, r.jurisdiction))
             ORDER BY r.registration_type, r.registration_number)
        FROM hsdg.entity_registrations r
       WHERE r.entity_id = v_entity AND r.status = 'active'
         AND (r.valid_to IS NULL OR r.valid_to >= v_from)), '[]'::jsonb),
    'applicability', (
      SELECT jsonb_build_object(
               'applicable', COALESCE(ap.override_applicable, ap.computed_applicable),
               'clause', ap.computed_clause)
        FROM hsdg.tax_audit_applicability ap
       WHERE ap.engagement_id = v_eng AND ap.financial_year = v_fy),
    'filings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'stream', f.stream, 'form', f.form, 'registration', f.registration,
               'periodKey', f.period_key, 'periodStart', f.period_start,
               'periodEnd', f.period_end, 'dueDate', f.due_date, 'filedOn', f.filed_on,
               'isNil', f.is_nil, 'figures', f.figures, 'lateFee', f.late_fee_paid,
               'interest', f.interest_paid)
             ORDER BY f.stream, f.form, f.period_start NULLS LAST, f.registration)
        FROM (
          SELECT DISTINCT ON (ci.id)
                 v.stream, COALESCE(ci.form_label, v.form_label, cr.name) AS form,
                 er.registration_number AS registration, ci.period_key, ci.period_start,
                 ci.period_end,
                 COALESCE(ci.statutory_deadline_override, ge.revised_due_date,
                          ci.statutory_deadline) AS due_date,
                 fr.filed_on, fr.is_nil, fr.figures, fr.late_fee_paid, fr.interest_paid
            FROM hsdg.engagements e2
            JOIN hsdg.compliance_instances ci ON ci.engagement_id = e2.id
            JOIN hsdg.compliance_rule_versions v ON v.id = ci.compliance_rule_version_id
            JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
            JOIN hsdg.filing_records fr
              ON fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL
            LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
            LEFT JOIN hsdg.entity_registrations er ON er.id = ci.registration_id
           WHERE e2.entity_id = v_entity
             AND v.stream IN ('gst', 'tds')
             AND (ci.financial_year = v_fy
                  OR (ci.financial_year IS NULL AND ci.period_end BETWEEN v_from AND v_to))
           ORDER BY ci.id, fr.filed_on DESC, fr.created_at DESC) f), '[]'::jsonb),
    'lastYear', (
      SELECT jsonb_build_object(
               'auditId', la.id, 'financialYear', la.financial_year,
               'answers', (SELECT COALESCE(jsonb_object_agg(w.clause_no, w.answer), '{}'::jsonb)
                             FROM hsdg.tax_audit_working_papers w
                            WHERE w.tax_audit_id = la.id AND w.status = 'done'))
        FROM hsdg.tax_audits la
        JOIN hsdg.engagements le ON le.id = la.engagement_id
       WHERE le.entity_id = v_entity AND la.financial_year = v_prev
         AND EXISTS (SELECT 1 FROM hsdg.tax_audit_working_papers w
                      WHERE w.tax_audit_id = la.id AND w.status = 'done')
       ORDER BY la.revision DESC
       LIMIT 1),
    'msme', (
      SELECT jsonb_build_object('status', d.status, 'receivedDate', d.received_date)
        FROM hsdg.client_dependencies d
       WHERE d.tax_audit_id = p_audit AND d.tax_audit_item = 'msme_list')
  ) INTO v_out;
  PERFORM set_config('hsdg.tax_audit_counting', '', true);
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION hsdg.tax_audit_draft_sources(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.tax_audit_draft_sources(uuid) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.tax_audit_draft_sources(uuid);
DROP POLICY IF EXISTS client_dependencies_tax_audit_counting ON hsdg.client_dependencies;
DROP POLICY IF EXISTS tax_audit_working_papers_tax_audit_counting ON hsdg.tax_audit_working_papers;
DROP POLICY IF EXISTS filing_records_tax_audit_counting ON hsdg.filing_records;
DROP POLICY IF EXISTS government_extensions_tax_audit_counting ON hsdg.government_extensions;
DROP POLICY IF EXISTS compliance_rule_versions_tax_audit_counting ON hsdg.compliance_rule_versions;
DROP POLICY IF EXISTS compliance_rules_tax_audit_counting ON hsdg.compliance_rules;
DROP POLICY IF EXISTS compliance_instances_tax_audit_counting ON hsdg.compliance_instances;
DROP POLICY IF EXISTS tax_audit_applicability_tax_audit_counting ON hsdg.tax_audit_applicability;
DROP POLICY IF EXISTS entity_registrations_tax_audit_counting ON hsdg.entity_registrations;
DROP POLICY IF EXISTS entity_addresses_tax_audit_counting ON hsdg.entity_addresses;
DROP POLICY IF EXISTS entity_types_tax_audit_counting ON hsdg.entity_types;
DROP POLICY IF EXISTS entities_tax_audit_counting ON hsdg.entities;
DROP POLICY IF EXISTS engagements_tax_audit_counting ON hsdg.engagements;

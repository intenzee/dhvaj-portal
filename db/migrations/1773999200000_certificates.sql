-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-402 · the certificates desk
--
-- Certificates (Form 146 / 15CB, net worth, turnover, utilisation, visa,
-- bank) are frequent, quick and risky: each needs a UDIN and a file. A
-- certificate is a lightweight flow on an Assignment engagement: pick a
-- template, fill its figures, review, partner signs with a UDIN, issue.
--
--   · hsdg.certificate_templates: versioned template data (variables, the
--     cross-checks between figures, the wording with {{key}} placeholders,
--     the prescribed form and the law cited). A new form or wording is a new
--     version; a version marked 'verify' waits on a partner's check.
--   · hsdg.certificates: one row per certificate, draft → in_review →
--     signed → issued, or revoked with a reason. Signed and issued need the
--     signing partner and the UDIN; the number (CERT/<FY>/<n>) is given on
--     issue. A Form 146 / 15CB records the Form 145 / 15CA acknowledgement.
--   · The UDIN is written through to the UDIN register (source
--     'certificate'), so a certificate is in both registers.
--   · Rows are visible exactly when the engagement is; the engagement's
--     team writes them.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.certificate_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL CHECK (code ~ '^CERT_[A-Z0-9_]{2,40}$'),
  version          integer NOT NULL CHECK (version >= 1),
  effective_from   date NOT NULL,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  form_label       text,
  legal_ref        text,
  verification     text NOT NULL DEFAULT 'verified' CHECK (verification IN ('verified', 'verify')),
  variables        jsonb NOT NULL CHECK (jsonb_typeof(variables) = 'array'),
  checks           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checks) = 'array'),
  body             text NOT NULL,
  records_form_15ca boolean NOT NULL DEFAULT false,
  sequence         integer NOT NULL DEFAULT 100,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  UNIQUE (code, effective_from)
);
GRANT SELECT ON hsdg.certificate_templates TO hsdg_app;

CREATE TABLE hsdg.certificates (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id               uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  template_id                 uuid NOT NULL REFERENCES hsdg.certificate_templates (id),
  certificate_no              text UNIQUE,
  purpose                     text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 300),
  addressee                   text NOT NULL CHECK (length(btrim(addressee)) BETWEEN 1 AND 500),
  figures                     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(figures) = 'object'),
  status                      text NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'in_review', 'signed', 'issued', 'revoked')),
  prepared_by_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewed_by_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewed_at                 timestamptz,
  review_note                 text CHECK (review_note IS NULL OR length(review_note) <= 1000),
  signing_partner_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  signed_on                   date,
  udin                        text UNIQUE CHECK (udin ~ '^[0-9]{8}[A-Z0-9]{10}$'),
  udin_generated_on           date,
  issued_on                   date,
  document_id                 uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  form_15ca_ack_no            text CHECK (form_15ca_ack_no ~ '^[A-Z0-9/-]{3,40}$'),
  form_15ca_filed_on          date,
  revoked_reason              text,
  revoked_at                  timestamptz,
  revoked_by_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  version                     integer NOT NULL DEFAULT 1,
  -- No signature or issue without the signing partner and the UDIN.
  CONSTRAINT certificates_signed CHECK (
    status IN ('draft', 'in_review')
    OR (status = 'revoked' AND udin IS NULL)
    OR (signing_partner_employee_id IS NOT NULL AND signed_on IS NOT NULL AND udin IS NOT NULL)),
  CONSTRAINT certificates_issued CHECK (
    (issued_on IS NULL AND certificate_no IS NULL)
    OR (issued_on IS NOT NULL AND certificate_no IS NOT NULL)),
  CONSTRAINT certificates_revoked CHECK (
    (status <> 'revoked' AND revoked_reason IS NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND length(btrim(revoked_reason)) BETWEEN 1 AND 1000
        AND revoked_at IS NOT NULL)),
  CONSTRAINT certificates_15ca CHECK ((form_15ca_ack_no IS NULL) = (form_15ca_filed_on IS NULL))
);
CREATE INDEX certificates_engagement_idx ON hsdg.certificates (engagement_id);
CREATE INDEX certificates_status_idx ON hsdg.certificates (status, created_at DESC);
CREATE INDEX certificates_partner_idx ON hsdg.certificates (signing_partner_employee_id, signed_on)
  WHERE signing_partner_employee_id IS NOT NULL;
CREATE TRIGGER certificates_set_updated_at BEFORE UPDATE ON hsdg.certificates
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

GRANT SELECT, INSERT, UPDATE ON hsdg.certificates TO hsdg_app;
ALTER TABLE hsdg.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.certificates FORCE ROW LEVEL SECURITY;
-- Visible exactly when the engagement is (the firm-wide register included).
CREATE POLICY certificates_select ON hsdg.certificates FOR SELECT TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.engagements g WHERE g.id = engagement_id));
CREATE POLICY certificates_insert ON hsdg.certificates FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY certificates_update ON hsdg.certificates FOR UPDATE TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY purge_engagement ON hsdg.certificates TO hsdg_migrator
  USING (current_setting('hsdg.purging', true) = 'on')
  WITH CHECK (current_setting('hsdg.purging', true) = 'on');
CREATE POLICY erase_person ON hsdg.certificates TO hsdg_migrator
  USING (current_setting('hsdg.erasing_person', true) = 'on')
  WITH CHECK (current_setting('hsdg.erasing_person', true) = 'on');
CREATE POLICY certificates_client_merge ON hsdg.certificates
  FOR ALL TO hsdg_migrator USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients());

-- ── The UDIN register takes the certificate's UDIN ─────────────────────
ALTER TABLE hsdg.udin_register NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.udin_register DROP CONSTRAINT udin_register_source_check;
ALTER TABLE hsdg.udin_register ADD CONSTRAINT udin_register_source_check
  CHECK (source IN ('manual', 'archive', 'tax_audit', 'certificate'));
ALTER TABLE hsdg.udin_register FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION hsdg.udin_write_through(
  p_udin text, p_kind text, p_source text, p_source_id uuid, p_engagement uuid,
  p_partner uuid, p_signed_on date, p_generated_on date, p_financial_year text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM set_config('hsdg.udin_writing', 'on', true);
  IF p_partner IS NOT NULL AND p_signed_on IS NOT NULL THEN
    INSERT INTO hsdg.udin_register
      (udin, document_kind, entity_id, engagement_id, signing_partner_employee_id, membership_no,
       signed_on, generated_on, financial_year, source, source_id)
    SELECT p_udin, p_kind, e.entity_id, e.id, p_partner,
           (SELECT pp.membership_no FROM hsdg.partner_profiles pp WHERE pp.employee_id = p_partner),
           p_signed_on, GREATEST(p_signed_on, COALESCE(p_generated_on, p_signed_on)),
           COALESCE(p_financial_year, e.financial_year), p_source, p_source_id
      FROM hsdg.engagements e
     WHERE e.id = p_engagement
    ON CONFLICT (udin) DO NOTHING;
  END IF;
  IF p_source IN ('archive', 'tax_audit') THEN
    PERFORM hsdg.resolve_notifications(
      CASE p_source WHEN 'archive' THEN 'service_workflow_instance' ELSE 'tax_audit' END,
      ARRAY[p_source_id], ARRAY['udin_window_closing']);
  END IF;
  PERFORM set_config('hsdg.udin_writing', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.udin_write_through(text, text, text, uuid, uuid, uuid, date, date, text)
  FROM PUBLIC;

CREATE FUNCTION hsdg.udin_from_certificate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NEW.udin IS NOT NULL THEN
    PERFORM hsdg.udin_write_through(
      NEW.udin, 'certificate', 'certificate', NEW.id, NEW.engagement_id,
      NEW.signing_partner_employee_id, NEW.signed_on, NEW.udin_generated_on, NULL);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER certificates_udin_register
  AFTER INSERT OR UPDATE OF udin ON hsdg.certificates
  FOR EACH ROW WHEN (NEW.udin IS NOT NULL)
  EXECUTE FUNCTION hsdg.udin_from_certificate();

-- ── The templates ────────────────────────────────────────────────────────
-- The closing paragraph every certificate carries (ICAI Guidance Note on
-- Reports or Certificates for Special Purposes: the basis, the restriction).
INSERT INTO hsdg.certificate_templates
  (code, version, effective_from, name, form_label, legal_ref, verification, variables, checks,
   body, records_form_15ca, sequence)
SELECT t.code, t.version, t.effective_from, t.name, t.form_label, t.legal_ref, t.verification,
       t.variables, coalesce(t.checks, '[]'::jsonb),
       t.body || E'\n\n' ||
       'This certificate is issued at the request of {{client_name}} for the purpose of '
       || '{{purpose}}, on the basis of the books of account, records and documents produced to us '
       || 'and the information and explanations given to us, which we believe to be true. It '
       || 'should not be used for any other purpose or by any other person without our prior '
       || 'written consent.',
       coalesce(t.records_form_15ca, false), t.sequence
FROM jsonb_to_recordset($json$[
{"code":"CERT_15CB","version":1,"effective_from":"2017-04-01","sequence":10,
 "name":"Remittance to a non-resident — Form 15CB",
 "form_label":"Form 15CB","legal_ref":"Section 195(6) of the Income-tax Act, 1961 read with rule 37BB",
 "verification":"verified","records_form_15ca":true,
 "variables":[
  {"key":"remitter_name","label":"Remitter","type":"text","required":true},
  {"key":"remitter_pan","label":"Remitter's PAN","type":"pan","required":true},
  {"key":"remittee_name","label":"Remittee (non-resident)","type":"text","required":true},
  {"key":"remittee_country","label":"Remittee's country","type":"text","required":true},
  {"key":"nature_of_remittance","label":"Nature of remittance (as per agreement)","type":"text","required":true},
  {"key":"purpose_code","label":"RBI purpose code","type":"text","required":true},
  {"key":"currency","label":"Currency","type":"text","required":true},
  {"key":"amount_fcy","label":"Amount in foreign currency","type":"number","required":true},
  {"key":"amount_inr","label":"Amount in INR","type":"amount","required":true},
  {"key":"bank_name","label":"Bank and branch","type":"text","required":true},
  {"key":"bsr_code","label":"BSR code of the bank branch","type":"text","required":true},
  {"key":"remittance_date","label":"Proposed date of remittance","type":"date","required":true},
  {"key":"taxable_in_india","label":"Taxable in India","type":"yesno","required":true},
  {"key":"provision","label":"Section / DTAA article relied on","type":"text","required":true},
  {"key":"trc_obtained","label":"Tax residency certificate obtained","type":"yesno","required":true},
  {"key":"tds_rate","label":"Rate of TDS (%)","type":"percent","required":true},
  {"key":"tds_amount","label":"TDS amount (INR)","type":"amount","required":true},
  {"key":"remarks","label":"Other particulars","type":"longtext","required":false}],
 "body":"We have examined the agreement and the documents relating to the remittance proposed to be made by {{remitter_name}} (PAN {{remitter_pan}}) to {{remittee_name}}, {{remittee_country}}, for {{nature_of_remittance}} (RBI purpose code {{purpose_code}}), of {{currency}} {{amount_fcy}} (INR {{amount_inr}}), through {{bank_name}} (BSR code {{bsr_code}}), on or about {{remittance_date}}.\n\nIn our opinion the remittance is taxable in India: {{taxable_in_india}}. The provision relied on is {{provision}}; a tax residency certificate has been obtained: {{trc_obtained}}. Tax is to be deducted at {{tds_rate}}% amounting to INR {{tds_amount}}.\n\n{{remarks}}\n\nThe particulars above are certified in {{form_label}}, furnished electronically, and this is the firm's record copy."},
{"code":"CERT_15CB","version":2,"effective_from":"2026-04-01","sequence":10,
 "name":"Remittance to a non-resident — Form 146 (was 15CB)",
 "form_label":"Form 146","legal_ref":"Section 397(3)(d) of the Income-tax Act, 2025 read with the Income-tax Rules, 2026",
 "verification":"verify","records_form_15ca":true,
 "variables":[
  {"key":"remitter_name","label":"Remitter","type":"text","required":true},
  {"key":"remitter_pan","label":"Remitter's PAN","type":"pan","required":true},
  {"key":"remittee_name","label":"Remittee (non-resident)","type":"text","required":true},
  {"key":"remittee_country","label":"Remittee's country","type":"text","required":true},
  {"key":"nature_of_remittance","label":"Nature of remittance (as per agreement)","type":"text","required":true},
  {"key":"purpose_code","label":"RBI purpose code","type":"text","required":true},
  {"key":"currency","label":"Currency","type":"text","required":true},
  {"key":"amount_fcy","label":"Amount in foreign currency","type":"number","required":true},
  {"key":"amount_inr","label":"Amount in INR","type":"amount","required":true},
  {"key":"bank_name","label":"Bank and branch","type":"text","required":true},
  {"key":"bsr_code","label":"BSR code of the bank branch","type":"text","required":true},
  {"key":"remittance_date","label":"Proposed date of remittance","type":"date","required":true},
  {"key":"taxable_in_india","label":"Taxable in India","type":"yesno","required":true},
  {"key":"provision","label":"Section / DTAA article relied on","type":"text","required":true},
  {"key":"trc_obtained","label":"Tax residency certificate obtained","type":"yesno","required":true},
  {"key":"tds_rate","label":"Rate of TDS (%)","type":"percent","required":true},
  {"key":"tds_amount","label":"TDS amount (INR)","type":"amount","required":true},
  {"key":"remarks","label":"Other particulars","type":"longtext","required":false}],
 "body":"We have examined the agreement and the documents relating to the remittance proposed to be made by {{remitter_name}} (PAN {{remitter_pan}}) to {{remittee_name}}, {{remittee_country}}, for {{nature_of_remittance}} (RBI purpose code {{purpose_code}}), of {{currency}} {{amount_fcy}} (INR {{amount_inr}}), through {{bank_name}} (BSR code {{bsr_code}}), on or about {{remittance_date}}.\n\nIn our opinion the remittance is taxable in India: {{taxable_in_india}}. The provision relied on is {{provision}}; a tax residency certificate has been obtained: {{trc_obtained}}. Tax is to be deducted at {{tds_rate}}% amounting to INR {{tds_amount}}.\n\n{{remarks}}\n\nThe particulars above are certified in {{form_label}}, furnished electronically with its UDIN, and this is the firm's record copy."},
{"code":"CERT_NET_WORTH","version":1,"effective_from":"2017-04-01","sequence":20,
 "name":"Net worth certificate","form_label":null,"legal_ref":null,"verification":"verified",
 "variables":[
  {"key":"person_name","label":"Name","type":"text","required":true},
  {"key":"person_pan","label":"PAN","type":"pan","required":true},
  {"key":"as_on_date","label":"As on","type":"date","required":true},
  {"key":"total_assets","label":"Total assets (INR)","type":"amount","required":true},
  {"key":"total_liabilities","label":"Total liabilities (INR)","type":"amount","required":true},
  {"key":"net_worth","label":"Net worth (INR)","type":"amount","required":true},
  {"key":"basis","label":"Basis of valuation of assets","type":"longtext","required":true}],
 "checks":[{"type":"difference","target":"net_worth","minuend":"total_assets","subtrahend":"total_liabilities"}],
 "body":"We certify that the net worth of {{person_name}} (PAN {{person_pan}}) as on {{as_on_date}} is INR {{net_worth}}, being total assets of INR {{total_assets}} less total liabilities of INR {{total_liabilities}}.\n\nBasis of valuation: {{basis}}"},
{"code":"CERT_TURNOVER","version":1,"effective_from":"2017-04-01","sequence":30,
 "name":"Turnover certificate","form_label":null,"legal_ref":null,"verification":"verified",
 "variables":[
  {"key":"entity_name","label":"Entity","type":"text","required":true},
  {"key":"entity_pan","label":"PAN","type":"pan","required":true},
  {"key":"gstin","label":"GSTIN","type":"text","required":false},
  {"key":"period_from","label":"Period from","type":"date","required":true},
  {"key":"period_to","label":"Period to","type":"date","required":true},
  {"key":"turnover","label":"Turnover (INR)","type":"amount","required":true},
  {"key":"source","label":"Source of the figure","type":"text","required":true,"help":"Audited financial statements, GST returns, …"}],
 "body":"We certify that the turnover of {{entity_name}} (PAN {{entity_pan}}, GSTIN {{gstin}}) for the period {{period_from}} to {{period_to}} is INR {{turnover}}, as per {{source}}."},
{"code":"CERT_UTILISATION","version":1,"effective_from":"2017-04-01","sequence":40,
 "name":"Utilisation certificate (grant / loan / funds)","form_label":null,"legal_ref":null,"verification":"verified",
 "variables":[
  {"key":"grantor","label":"Sanctioning authority","type":"text","required":true},
  {"key":"sanction_ref","label":"Sanction letter no.","type":"text","required":true},
  {"key":"sanction_date","label":"Sanction date","type":"date","required":true},
  {"key":"object","label":"Purpose of the funds","type":"text","required":true},
  {"key":"period_to","label":"Utilisation up to","type":"date","required":true},
  {"key":"amount_received","label":"Amount received (INR)","type":"amount","required":true},
  {"key":"amount_utilised","label":"Amount utilised (INR)","type":"amount","required":true},
  {"key":"unspent_balance","label":"Unspent balance (INR)","type":"amount","required":true}],
 "checks":[{"type":"difference","target":"unspent_balance","minuend":"amount_received","subtrahend":"amount_utilised"}],
 "body":"We certify that out of INR {{amount_received}} received from {{grantor}} under sanction {{sanction_ref}} dated {{sanction_date}} for {{object}}, INR {{amount_utilised}} has been utilised up to {{period_to}} for the purpose for which it was sanctioned, and INR {{unspent_balance}} remains unspent."},
{"code":"CERT_VISA","version":1,"effective_from":"2017-04-01","sequence":50,
 "name":"Income and net worth certificate for a visa","form_label":null,"legal_ref":null,"verification":"verified",
 "variables":[
  {"key":"applicant_name","label":"Applicant","type":"text","required":true},
  {"key":"applicant_pan","label":"PAN","type":"pan","required":true},
  {"key":"passport_no","label":"Passport no.","type":"text","required":true},
  {"key":"as_on_date","label":"As on","type":"date","required":true},
  {"key":"annual_income","label":"Annual income (INR)","type":"amount","required":true},
  {"key":"income_years","label":"Income for the years","type":"text","required":true,"help":"e.g. FY 2023-24 to 2025-26, per the ITRs filed"},
  {"key":"net_worth","label":"Net worth (INR)","type":"amount","required":true}],
 "body":"We certify that {{applicant_name}} (PAN {{applicant_pan}}, passport no. {{passport_no}}) has an annual income of INR {{annual_income}} for {{income_years}}, as per the returns of income filed, and a net worth of INR {{net_worth}} as on {{as_on_date}}."},
{"code":"CERT_BANK","version":1,"effective_from":"2017-04-01","sequence":60,
 "name":"Certificate for a bank (stock, book debts, drawing power)","form_label":null,"legal_ref":null,"verification":"verified",
 "variables":[
  {"key":"borrower","label":"Borrower","type":"text","required":true},
  {"key":"bank_branch","label":"Bank and branch","type":"text","required":true},
  {"key":"as_on_date","label":"As on","type":"date","required":true},
  {"key":"stock_value","label":"Stock (INR)","type":"amount","required":true},
  {"key":"book_debts","label":"Book debts (INR)","type":"amount","required":true},
  {"key":"creditors","label":"Trade creditors (INR)","type":"amount","required":true},
  {"key":"drawing_power","label":"Drawing power (INR)","type":"amount","required":true},
  {"key":"particulars","label":"Other particulars","type":"longtext","required":false}],
 "body":"We certify for {{bank_branch}} that, as on {{as_on_date}}, {{borrower}} held stock of INR {{stock_value}} and book debts of INR {{book_debts}}, against trade creditors of INR {{creditors}}, giving a drawing power of INR {{drawing_power}} on the margins in the sanction.\n\n{{particulars}}"}
]$json$::jsonb) AS t(code text, version integer, effective_from date, name text, form_label text,
                    legal_ref text, verification text, variables jsonb, checks jsonb, body text,
                    records_form_15ca boolean, sequence integer);

-- Down Migration

DROP TRIGGER IF EXISTS certificates_udin_register ON hsdg.certificates;
DROP FUNCTION IF EXISTS hsdg.udin_from_certificate();

ALTER TABLE hsdg.udin_register NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.udin_register WHERE source = 'certificate';
ALTER TABLE hsdg.udin_register DROP CONSTRAINT udin_register_source_check;
ALTER TABLE hsdg.udin_register ADD CONSTRAINT udin_register_source_check
  CHECK (source IN ('manual', 'archive', 'tax_audit'));
ALTER TABLE hsdg.udin_register FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION hsdg.udin_write_through(
  p_udin text, p_kind text, p_source text, p_source_id uuid, p_engagement uuid,
  p_partner uuid, p_signed_on date, p_generated_on date, p_financial_year text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM set_config('hsdg.udin_writing', 'on', true);
  IF p_partner IS NOT NULL AND p_signed_on IS NOT NULL THEN
    INSERT INTO hsdg.udin_register
      (udin, document_kind, entity_id, engagement_id, signing_partner_employee_id, membership_no,
       signed_on, generated_on, financial_year, source, source_id)
    SELECT p_udin, p_kind, e.entity_id, e.id, p_partner,
           (SELECT pp.membership_no FROM hsdg.partner_profiles pp WHERE pp.employee_id = p_partner),
           p_signed_on, GREATEST(p_signed_on, COALESCE(p_generated_on, p_signed_on)),
           COALESCE(p_financial_year, e.financial_year), p_source, p_source_id
      FROM hsdg.engagements e
     WHERE e.id = p_engagement
    ON CONFLICT (udin) DO NOTHING;
  END IF;
  PERFORM hsdg.resolve_notifications(
    CASE p_source WHEN 'archive' THEN 'service_workflow_instance' ELSE 'tax_audit' END,
    ARRAY[p_source_id], ARRAY['udin_window_closing']);
  PERFORM set_config('hsdg.udin_writing', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.udin_write_through(text, text, text, uuid, uuid, uuid, date, date, text)
  FROM PUBLIC;

DROP TABLE hsdg.certificates;
DROP TABLE hsdg.certificate_templates;

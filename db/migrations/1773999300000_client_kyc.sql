-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-404 — client KYC and acceptance for non-audit clients
--
-- ICAI's KYC norms for members in practice expect the firm to know who its
-- client is, where it is, and who owns and runs it before taking work on.
-- Statutory audit has its own acceptance; this is everyone else.
--
--   · hsdg.client_kyc — one row per client once anything is on file. No row
--     is "pending". A complete KYC is due again on next_review_on (the
--     app reads it as "expired" from that day; nothing rewrites the row).
--   · The checklist is a document requirement template (DOC_CLIENT_KYC) in
--     the catalogue, so the firm changes the list by versioning it.
--   · firm_settings: kyc_gate (off | warn | require; default warn — a firm
--     switching this on has no KYC on file yet), and the review interval by
--     risk (high every year, others every three).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.firm_settings
  ADD COLUMN kyc_gate text NOT NULL DEFAULT 'warn' CHECK (kyc_gate IN ('off', 'warn', 'require')),
  ADD COLUMN kyc_review_years_high smallint NOT NULL DEFAULT 1
    CHECK (kyc_review_years_high BETWEEN 1 AND 10),
  ADD COLUMN kyc_review_years_other smallint NOT NULL DEFAULT 3
    CHECK (kyc_review_years_other BETWEEN 1 AND 10);

CREATE TABLE hsdg.client_kyc (
  entity_id                  uuid PRIMARY KEY REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  status                     text NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'complete', 'expired')),
  pan_verified               boolean NOT NULL DEFAULT false,
  pan_verified_on            date,
  address_proof_doc_id       uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  identity_proof_doc_ids     uuid[] NOT NULL DEFAULT '{}',
  beneficial_owners          jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(beneficial_owners) = 'array'),
  risk_rating                text CHECK (risk_rating IN ('low', 'medium', 'high')),
  -- Checklist item code → done.
  checklist                  jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(checklist) = 'object'),
  notes                      text CHECK (char_length(notes) <= 4000),
  reviewed_by_employee_id    uuid REFERENCES hsdg.employees (id),
  reviewed_on                date,
  next_review_on             date,
  version                    integer NOT NULL DEFAULT 1,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_kyc_complete CHECK (
    status <> 'complete' OR (pan_verified AND risk_rating IS NOT NULL
      AND reviewed_by_employee_id IS NOT NULL AND reviewed_on IS NOT NULL
      AND next_review_on IS NOT NULL AND next_review_on > reviewed_on)),
  CONSTRAINT client_kyc_pan_verified CHECK (pan_verified OR pan_verified_on IS NULL)
);
CREATE INDEX client_kyc_next_review_idx ON hsdg.client_kyc (next_review_on)
  WHERE status = 'complete';
CREATE TRIGGER client_kyc_set_updated_at BEFORE UPDATE ON hsdg.client_kyc
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

REVOKE ALL ON hsdg.client_kyc FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON hsdg.client_kyc TO hsdg_app;
ALTER TABLE hsdg.client_kyc ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.client_kyc FORCE ROW LEVEL SECURITY;
-- Seen and kept by whoever sees the client (entities' own policies decide).
CREATE POLICY client_kyc_all ON hsdg.client_kyc FOR ALL TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = client_kyc.entity_id))
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = client_kyc.entity_id));
CREATE POLICY erase_person ON hsdg.client_kyc TO hsdg_migrator
  USING (current_setting('hsdg.erasing_person', true) = 'on')
  WITH CHECK (current_setting('hsdg.erasing_person', true) = 'on');
-- A merge archives the dropped client with its KYC; the kept one keeps its own.
CREATE POLICY client_kyc_client_merge ON hsdg.client_kyc
  FOR ALL TO hsdg_migrator USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients());

-- ── The checklist (a document requirement template, versioned) ──────────
-- ICAI KYC norms (2017): the client's identity and PAN, its address, the
-- persons who sign and run it, its constitution, and who owns it.
ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.catalogue_templates (template_type, code, name, description)
VALUES ('document_requirement', 'DOC_CLIENT_KYC', 'Client KYC',
        'What the firm keeps on file to know a non-audit client (ICAI KYC norms for members in practice).');
INSERT INTO hsdg.catalogue_template_versions (catalogue_template_id, version, effective_from, body, notes)
SELECT t.id, 1, DATE '2017-01-01', $json${"items":[
  {"code":"PAN","label":"PAN card (verified on the income-tax portal)","sequence":1,"mandatory":true},
  {"code":"ADDRESS","label":"Proof of address (registered office or residence)","sequence":2,"mandatory":true},
  {"code":"IDENTITY","label":"Identity proof of the client or its authorised signatory","sequence":3,"mandatory":true},
  {"code":"CONSTITUTION","label":"Constitution document (incorporation certificate, MoA/AoA, LLP agreement, partnership or trust deed) — non-individuals","sequence":4,"mandatory":false},
  {"code":"AUTHORITY","label":"Board resolution or authority letter for the signatory — non-individuals","sequence":5,"mandatory":false},
  {"code":"KEY_PERSONS","label":"Directors, partners or trustees and their DIN / PAN","sequence":6,"mandatory":false},
  {"code":"BENEFICIAL_OWNERS","label":"Beneficial owners identified","sequence":7,"mandatory":true},
  {"code":"BUSINESS","label":"Nature of business and source of funds understood","sequence":8,"mandatory":true},
  {"code":"GST","label":"GST registration certificate, if registered","sequence":9,"mandatory":false}
]}$json$::jsonb,
 'Confirm the list with a partner against the current ICAI guidance.'
FROM hsdg.catalogue_templates t WHERE t.code = 'DOC_CLIENT_KYC';
ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.catalogue_template_versions
 WHERE catalogue_template_id IN (SELECT id FROM hsdg.catalogue_templates WHERE code = 'DOC_CLIENT_KYC');
DELETE FROM hsdg.catalogue_templates WHERE code = 'DOC_CLIENT_KYC';
ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS hsdg.client_kyc;
ALTER TABLE hsdg.firm_settings
  DROP COLUMN IF EXISTS kyc_review_years_other,
  DROP COLUMN IF EXISTS kyc_review_years_high,
  DROP COLUMN IF EXISTS kyc_gate;

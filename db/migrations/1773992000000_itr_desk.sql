-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-403 · individual returns at volume (the ITR desk)
--
-- The season's ITRs are the year's IT_ITR filings (and IT_ITR_AUDIT / _TP
-- for a proprietor in audit or with transfer pricing); the desk adds what the
-- filing itself doesn't carry:
--
--   · hsdg.itr_returns: one per ITR filing — the form and regime, the
--     return type, the e-verification (30 days from filing, the
--     ITR_VERIFICATION_DUE rule's data), the refund until it is credited or
--     set off, and the 143(1) intimation. The acknowledgement and filing date
--     stay on the filing record (lodged in the filing drawer), never copied.
--   · hsdg.itr_income_lines: the income the department reports (26AS, AIS,
--     TIS) and the client's own figures, line by line, matched by payer in
--     the app. A re-imported statement replaces its source's lines.
--   · notices.itr_return_id: a 143(1) demand or a 245 set-off opened from a
--     return is a notice on the register, linked back to it.
--   · notice type IT_143_1: the intimation itself (appealable u/s 246A; under
--     the Income-tax Act, 2025 this is s.270 — verify).
--   · Rows are visible exactly when the engagement is; its team writes them.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.itr_returns (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_instance_id  uuid NOT NULL UNIQUE REFERENCES hsdg.compliance_instances (id) ON DELETE CASCADE,
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  financial_year          text NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  itr_form                text CHECK (itr_form IN ('ITR-1', 'ITR-2', 'ITR-3', 'ITR-4', 'ITR-5', 'ITR-6', 'ITR-7')),
  regime                  text CHECK (regime IN ('new', 'old')),
  return_type             text NOT NULL DEFAULT 'original'
                            CHECK (return_type IN ('original', 'belated', 'revised', 'updated')),
  e_verified_on           date,
  e_verify_mode           text CHECK (e_verify_mode IN
                            ('aadhaar_otp', 'evc_bank', 'evc_demat', 'net_banking', 'dsc', 'itr_v')),
  refund_claimed          numeric(14,2) CHECK (refund_claimed >= 0),
  refund_status           text NOT NULL DEFAULT 'none'
                            CHECK (refund_status IN ('none', 'pending', 'issued', 'adjusted', 'failed')),
  refund_amount           numeric(14,2) CHECK (refund_amount >= 0),
  refund_on               date,
  refund_note             text CHECK (refund_note IS NULL OR length(refund_note) <= 1000),
  intimation_on           date,
  intimation_result       text CHECK (intimation_result IN ('no_change', 'refund', 'demand')),
  intimation_amount       numeric(14,2) CHECK (intimation_amount >= 0),
  notes                   text CHECK (notes IS NULL OR length(notes) <= 4000),
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  updated_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1,
  CONSTRAINT itr_returns_verified CHECK ((e_verified_on IS NULL) = (e_verify_mode IS NULL)),
  -- A credited or set-off refund has its amount and date.
  CONSTRAINT itr_returns_refund CHECK (
    refund_status NOT IN ('issued', 'adjusted') OR (refund_amount IS NOT NULL AND refund_on IS NOT NULL)),
  CONSTRAINT itr_returns_intimation CHECK ((intimation_on IS NULL) = (intimation_result IS NULL))
);
CREATE INDEX itr_returns_engagement_idx ON hsdg.itr_returns (engagement_id);
CREATE INDEX itr_returns_year_idx ON hsdg.itr_returns (financial_year);
CREATE TRIGGER itr_returns_set_updated_at BEFORE UPDATE ON hsdg.itr_returns
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.itr_income_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itr_return_id           uuid NOT NULL REFERENCES hsdg.itr_returns (id) ON DELETE CASCADE,
  -- Denormalised for the policy, as on notice_events.
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  source                  text NOT NULL CHECK (source IN ('26as', 'ais', 'tis', 'client')),
  head                    text NOT NULL CHECK (head IN ('salary', 'house_property', 'business',
                            'capital_gains', 'other_sources', 'exempt', 'unclassified')),
  section                 text CHECK (section IS NULL OR length(section) <= 40),
  description             text CHECK (description IS NULL OR length(description) <= 500),
  payer_name              text CHECK (payer_name IS NULL OR length(payer_name) <= 300),
  payer_tan               text CHECK (payer_tan IS NULL OR payer_tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  amount                  numeric(16,2) NOT NULL,
  tax_deducted            numeric(16,2) NOT NULL DEFAULT 0,
  transaction_on          date,
  imported_from           text CHECK (imported_from IS NULL OR length(imported_from) <= 255),
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX itr_income_lines_return_idx ON hsdg.itr_income_lines (itr_return_id, source);

ALTER TABLE hsdg.notices ADD COLUMN itr_return_id uuid
  REFERENCES hsdg.itr_returns (id) ON DELETE SET NULL;
CREATE INDEX notices_itr_return_idx ON hsdg.notices (itr_return_id) WHERE itr_return_id IS NOT NULL;

REVOKE ALL ON hsdg.itr_returns FROM PUBLIC;
REVOKE ALL ON hsdg.itr_income_lines FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON hsdg.itr_returns TO hsdg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.itr_income_lines TO hsdg_app;

ALTER TABLE hsdg.itr_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.itr_returns FORCE ROW LEVEL SECURITY;
-- Visible exactly when the engagement is (the season grid included).
CREATE POLICY itr_returns_select ON hsdg.itr_returns FOR SELECT TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.engagements g WHERE g.id = engagement_id));
-- The filing must be the engagement's.
CREATE POLICY itr_returns_insert ON hsdg.itr_returns FOR INSERT TO hsdg_app
  WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND EXISTS (SELECT 1 FROM hsdg.compliance_instances ci
                 WHERE ci.id = compliance_instance_id AND ci.engagement_id = itr_returns.engagement_id));
CREATE POLICY itr_returns_update ON hsdg.itr_returns FOR UPDATE TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY purge_engagement ON hsdg.itr_returns TO hsdg_migrator
  USING (current_setting('hsdg.purging', true) = 'on')
  WITH CHECK (current_setting('hsdg.purging', true) = 'on');
CREATE POLICY erase_person ON hsdg.itr_returns TO hsdg_migrator
  USING (current_setting('hsdg.erasing_person', true) = 'on')
  WITH CHECK (current_setting('hsdg.erasing_person', true) = 'on');
CREATE POLICY itr_returns_client_merge ON hsdg.itr_returns
  FOR ALL TO hsdg_migrator USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients());

ALTER TABLE hsdg.itr_income_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.itr_income_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY itr_income_lines_select ON hsdg.itr_income_lines FOR SELECT TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.engagements g WHERE g.id = engagement_id));
CREATE POLICY itr_income_lines_insert ON hsdg.itr_income_lines FOR INSERT TO hsdg_app
  WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND EXISTS (SELECT 1 FROM hsdg.itr_returns r
                 WHERE r.id = itr_return_id AND r.engagement_id = itr_income_lines.engagement_id));
CREATE POLICY itr_income_lines_update ON hsdg.itr_income_lines FOR UPDATE TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY itr_income_lines_delete ON hsdg.itr_income_lines FOR DELETE TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY purge_engagement ON hsdg.itr_income_lines TO hsdg_migrator
  USING (current_setting('hsdg.purging', true) = 'on')
  WITH CHECK (current_setting('hsdg.purging', true) = 'on');
CREATE POLICY erase_person ON hsdg.itr_income_lines TO hsdg_migrator
  USING (current_setting('hsdg.erasing_person', true) = 'on')
  WITH CHECK (current_setting('hsdg.erasing_person', true) = 'on');
CREATE POLICY itr_income_lines_client_merge ON hsdg.itr_income_lines
  FOR ALL TO hsdg_migrator USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients());

-- ── The intimation on the notice register ──────────────────────────────
-- Appealable to the CIT(A) u/s 246A(1)(a) against an adjustment.
ALTER TABLE hsdg.notice_types NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.notice_types
  (code, stream, form, section, title, default_reply_days, appealable, appeal_rule_code)
VALUES ('IT_143_1', 'income_tax', NULL, 's.143(1)', 'Intimation on processing of the return',
        30, true, 'IT_APPEAL_LIMITATION')
ON CONFLICT (code) DO NOTHING;
ALTER TABLE hsdg.notice_types FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.notice_types NO FORCE ROW LEVEL SECURITY;
-- A type in use stays (its notices keep their type); the next Up skips it.
DELETE FROM hsdg.notice_types t
 WHERE t.code = 'IT_143_1'
   AND NOT EXISTS (SELECT 1 FROM hsdg.notices n WHERE n.notice_type_id = t.id);
ALTER TABLE hsdg.notice_types FORCE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS hsdg.notices_itr_return_idx;
ALTER TABLE hsdg.notices DROP COLUMN IF EXISTS itr_return_id;
DROP TABLE IF EXISTS hsdg.itr_income_lines;
DROP TABLE IF EXISTS hsdg.itr_returns;

-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-204 · TDS against the 26AS, hardened.
--
-- firm_tds_credits        — remarks: the 26AS "Remarks" (A challan rectified,
--                           B statement rectified, F a s.197 certificate,
--                           G reprocessed). Amounts may be negative: a
--                           reversal row nets off the row it reverses.
-- firm_tds_import_batches — as_on: the date the statement is as on (a 26AS's
--                           File Creation Date). A deduction missing from the
--                           26AS is only late once a 26AS as on 15 days past
--                           the return's due date still lacks it; an older
--                           26AS cannot replace a newer one.
-- Indexes                 — the TAN → client lookup (every credit, every
--                           report) and the report's date window.
-- Who sees an import      — the managing partner, the importer, a partner or
--                           manager (those who bill some client), or an admin
--                           (who reads the report): file names and the firm's
--                           TDS totals are not for all.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.firm_tds_credits
  ADD COLUMN remarks text CHECK (length(trim(remarks)) BETWEEN 1 AND 20),
  DROP CONSTRAINT firm_tds_credits_amount_paid_check,
  DROP CONSTRAINT firm_tds_credits_tax_deducted_check,
  DROP CONSTRAINT firm_tds_credits_tds_deposited_check;

ALTER TABLE hsdg.firm_tds_import_batches ADD COLUMN as_on date;

CREATE INDEX entity_registrations_tan_idx
  ON hsdg.entity_registrations ((upper(replace(registration_number, ' ', ''))))
  WHERE registration_type = 'tan';
CREATE INDEX firm_tds_credits_active_date_idx
  ON hsdg.firm_tds_credits (transaction_date)
  WHERE superseded_by_batch_id IS NULL;

DROP POLICY firm_tds_import_batches_select ON hsdg.firm_tds_import_batches;
CREATE POLICY firm_tds_import_batches_select ON hsdg.firm_tds_import_batches
  FOR SELECT TO hsdg_app USING (
    hsdg.ctx_is_business_firmwide()
    OR imported_by_employee_id = hsdg.ctx_employee_id()
    OR hsdg.ctx_role() IN ('partner', 'manager', 'admin'));

-- Down Migration

DROP POLICY firm_tds_import_batches_select ON hsdg.firm_tds_import_batches;
CREATE POLICY firm_tds_import_batches_select ON hsdg.firm_tds_import_batches
  FOR SELECT TO hsdg_app USING (hsdg.ctx_employee_id() IS NOT NULL);

DROP INDEX IF EXISTS hsdg.firm_tds_credits_active_date_idx;
DROP INDEX IF EXISTS hsdg.entity_registrations_tan_idx;

ALTER TABLE hsdg.firm_tds_import_batches DROP COLUMN IF EXISTS as_on;

-- Reversal rows cannot stay under the old checks.
ALTER TABLE hsdg.firm_tds_credits NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.firm_tds_credits
 WHERE amount_paid < 0 OR tax_deducted < 0 OR tds_deposited < 0;
ALTER TABLE hsdg.firm_tds_credits FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.firm_tds_credits
  DROP COLUMN IF EXISTS remarks,
  ADD CONSTRAINT firm_tds_credits_amount_paid_check CHECK (amount_paid >= 0),
  ADD CONSTRAINT firm_tds_credits_tax_deducted_check CHECK (tax_deducted >= 0),
  ADD CONSTRAINT firm_tds_credits_tds_deposited_check CHECK (tds_deposited >= 0);

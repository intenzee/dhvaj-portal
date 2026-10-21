-- ─────────────────────────────────────────────────────────────────────────
-- Accountant role, phase 2c (spec §3.7): the books export.
--
-- books_settings      — the firm's Tally ledger names the export posts to;
--                       one row.
-- books_exports       — each export: the month, the format, how many
--                       vouchers, who and when.
-- books_export_items  — every voucher that has gone to the books, once:
--                       the primary key (source, source_id) is the "last
--                       exported" marker, so nothing goes twice even when
--                       two people export at once.
--
-- Finance reports cover the whole firm, so the Accountant and the Managing
-- Partner (business firm-wide) are the ones who read and write these.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.books_settings (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
  sales_ledger            text NOT NULL DEFAULT 'Professional Fees',
  output_cgst_ledger      text NOT NULL DEFAULT 'Output CGST',
  output_sgst_ledger      text NOT NULL DEFAULT 'Output SGST',
  output_igst_ledger      text NOT NULL DEFAULT 'Output IGST',
  tds_receivable_ledger   text NOT NULL DEFAULT 'TDS Receivable',
  bank_ledger             text NOT NULL DEFAULT 'Bank',
  cash_ledger             text NOT NULL DEFAULT 'Cash',
  bad_debts_ledger        text NOT NULL DEFAULT 'Bad Debts Written Off',
  adjustment_ledger       text NOT NULL DEFAULT 'Adjustment',
  version                 integer NOT NULL DEFAULT 1,
  updated_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT books_settings_names CHECK (
    length(btrim(sales_ledger)) BETWEEN 1 AND 100
    AND length(btrim(output_cgst_ledger)) BETWEEN 1 AND 100
    AND length(btrim(output_sgst_ledger)) BETWEEN 1 AND 100
    AND length(btrim(output_igst_ledger)) BETWEEN 1 AND 100
    AND length(btrim(tds_receivable_ledger)) BETWEEN 1 AND 100
    AND length(btrim(bank_ledger)) BETWEEN 1 AND 100
    AND length(btrim(cash_ledger)) BETWEEN 1 AND 100
    AND length(btrim(bad_debts_ledger)) BETWEEN 1 AND 100
    AND length(btrim(adjustment_ledger)) BETWEEN 1 AND 100)
);
INSERT INTO hsdg.books_settings (id) VALUES (true);
CREATE TRIGGER books_settings_set_updated_at BEFORE UPDATE ON hsdg.books_settings
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.books_exports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month                   date NOT NULL CHECK (extract(day FROM month) = 1),
  format                  text NOT NULL CHECK (format IN ('tally_xml', 'journal_csv')),
  voucher_count           integer NOT NULL CHECK (voucher_count > 0),
  exported_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX books_exports_month_idx ON hsdg.books_exports (month, created_at DESC);

CREATE TABLE hsdg.books_export_items (
  source     text NOT NULL CHECK (source IN ('invoice', 'invoice_void', 'receipt',
                                             'receipt_reversal', 'credit_note',
                                             'credit_note_void', 'write_off')),
  source_id  uuid NOT NULL,
  export_id  uuid NOT NULL REFERENCES hsdg.books_exports (id) ON DELETE CASCADE,
  PRIMARY KEY (source, source_id)
);
CREATE INDEX books_export_items_export_idx ON hsdg.books_export_items (export_id);

ALTER TABLE hsdg.books_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.books_settings     FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.books_exports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.books_exports      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.books_export_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.books_export_items FORCE ROW LEVEL SECURITY;

CREATE POLICY books_settings_finance ON hsdg.books_settings
  FOR ALL TO hsdg_app
  USING (hsdg.ctx_is_finance() OR hsdg.ctx_is_business_firmwide())
  WITH CHECK (hsdg.ctx_is_finance() OR hsdg.ctx_is_business_firmwide());
CREATE POLICY books_exports_finance ON hsdg.books_exports
  FOR ALL TO hsdg_app
  USING (hsdg.ctx_is_finance() OR hsdg.ctx_is_business_firmwide())
  WITH CHECK (hsdg.ctx_is_finance() OR hsdg.ctx_is_business_firmwide());
CREATE POLICY books_export_items_finance ON hsdg.books_export_items
  FOR ALL TO hsdg_app
  USING (hsdg.ctx_is_finance() OR hsdg.ctx_is_business_firmwide())
  WITH CHECK (hsdg.ctx_is_finance() OR hsdg.ctx_is_business_firmwide());
CREATE POLICY books_settings_owner ON hsdg.books_settings TO hsdg_migrator USING (true) WITH CHECK (true);
CREATE POLICY books_exports_owner ON hsdg.books_exports TO hsdg_migrator USING (true) WITH CHECK (true);
CREATE POLICY books_export_items_owner ON hsdg.books_export_items TO hsdg_migrator USING (true) WITH CHECK (true);

REVOKE ALL ON hsdg.books_settings, hsdg.books_exports, hsdg.books_export_items FROM PUBLIC;
GRANT SELECT, UPDATE ON hsdg.books_settings TO hsdg_app;
-- An export is a record: no updates; it is undone only by deleting it,
-- which hands its vouchers back (the items cascade).
GRANT SELECT, INSERT, DELETE ON hsdg.books_exports TO hsdg_app;
GRANT SELECT, INSERT ON hsdg.books_export_items TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.books_export_items;
DROP TABLE IF EXISTS hsdg.books_exports;
DROP TABLE IF EXISTS hsdg.books_settings;

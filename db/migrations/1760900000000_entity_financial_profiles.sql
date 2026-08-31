-- ─────────────────────────────────────────────────────────────────────────
-- 0044 · Entity financial profiles — year-wise, append-only  (spec §16, §17; ADR-0033)
--
-- Financial facts stored BY financial year and NEVER overwritten (§16). A new
-- figure set for a year SUPERSEDES the prior one (supersedes_id) and flips the
-- prior is_current=false — history is retained (mirrors the catalogue component
-- supersede pattern). Exactly one current row per (entity, FY) via a partial
-- unique index. All amounts nullable — recorded progressively; threshold
-- calculations happen downstream in the engine, never here (§1).
--
-- Immutability of superseded rows is enforced at the service layer (Phase B),
-- consistent with how the rest of this codebase writes history/audit.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.entity_financial_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  -- Same FY format used across engagements/compliance: 'YYYY-YY'.
  financial_year     text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),

  -- ── Figures (§16) — all amounts in INR, nullable (progressive completion) ─
  turnover           numeric(18,2) CHECK (turnover           IS NULL OR turnover           >= 0),
  revenue            numeric(18,2) CHECK (revenue            IS NULL OR revenue            >= 0),
  other_income       numeric(18,2) CHECK (other_income       IS NULL OR other_income       >= 0),
  net_profit         numeric(18,2),   -- may be negative
  profit_before_tax  numeric(18,2),   -- may be negative
  net_worth          numeric(18,2),   -- may be negative
  paid_up_capital    numeric(18,2) CHECK (paid_up_capital    IS NULL OR paid_up_capital    >= 0),
  reserves_surplus   numeric(18,2),
  total_assets       numeric(18,2) CHECK (total_assets       IS NULL OR total_assets       >= 0),
  total_borrowings   numeric(18,2) CHECK (total_borrowings   IS NULL OR total_borrowings   >= 0),
  bank_pfi_borrowings numeric(18,2) CHECK (bank_pfi_borrowings IS NULL OR bank_pfi_borrowings >= 0),
  public_deposits    numeric(18,2) CHECK (public_deposits    IS NULL OR public_deposits    >= 0),
  debentures         numeric(18,2) CHECK (debentures         IS NULL OR debentures         >= 0),
  outstanding_loans  numeric(18,2) CHECK (outstanding_loans  IS NULL OR outstanding_loans  >= 0),

  -- ── Source & verification (§17) ──────────────────────────────────────────
  source             text NOT NULL DEFAULT 'other' CHECK (source IN
                       ('audited_financials','provisional_financials','tax_return',
                        'books','management_representation','other')),
  source_financial_year text CHECK (source_financial_year IS NULL OR source_financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  verified           boolean NOT NULL DEFAULT false,
  verified_by        uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  verified_at        timestamptz,
  supporting_document_ref text,

  -- ── Append-only history ─────────────────────────────────────────────────
  is_current         boolean NOT NULL DEFAULT true,
  supersedes_id      uuid REFERENCES hsdg.entity_financial_profiles (id) ON DELETE SET NULL,

  created_by         uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- entity_id lookups ride the leading column of the (entity_id, FY) index below,
-- so no separate single-column index is needed.
CREATE INDEX entity_financial_profiles_fy_idx     ON hsdg.entity_financial_profiles (entity_id, financial_year);
-- Exactly one CURRENT figure set per (entity, FY); superseded rows are retained.
CREATE UNIQUE INDEX entity_financial_profiles_one_current
  ON hsdg.entity_financial_profiles (entity_id, financial_year) WHERE is_current;
CREATE TRIGGER entity_financial_profiles_set_updated_at BEFORE UPDATE ON hsdg.entity_financial_profiles
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.entity_financial_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_financial_profiles FORCE  ROW LEVEL SECURITY;
CREATE POLICY entity_financial_profiles_all ON hsdg.entity_financial_profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_financial_profiles.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_financial_profiles.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  );

-- Down Migration

DROP TABLE IF EXISTS hsdg.entity_financial_profiles CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- 0040 · Entity master field completion  (spec §6, §8, §15, §18, §19, §29; ADR-0033)
--
-- Widen hsdg.entities with the singular scalar facts the Add Client spec adds.
-- Multi-valued facts (addresses, relationships, financials, activities,
-- listings, regulatory attributes) live in their own child tables (later
-- migrations). Nothing here decides applicability — facts only (§1, §32).
--
-- Status model (§29): keep the existing `status` as the ENTITY LIFECYCLE axis
-- (add 'draft'; retain 'prospect' for back-compat) and add two independent
-- columns — legal/operational status (§6) and regulatory profile status (§29).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Identity (§6) ─────────────────────────────────────────────────────────
ALTER TABLE hsdg.entities
  ADD COLUMN trade_name              text,
  ADD COLUMN short_name              text,
  ADD COLUMN country_of_incorporation text NOT NULL DEFAULT 'IN'
    CHECK (country_of_incorporation ~ '^[A-Z]{2}$');

-- ── Legal & constitution (§8) — type-specific, all nullable/sparse ────────
ALTER TABLE hsdg.entities
  ADD COLUMN roc                text,   -- Registrar of Companies (company/LLP)
  ADD COLUMN authorised_capital numeric(18,2) CHECK (authorised_capital IS NULL OR authorised_capital >= 0),
  ADD COLUMN paid_up_capital    numeric(18,2) CHECK (paid_up_capital    IS NULL OR paid_up_capital    >= 0),
  ADD COLUMN llp_contribution   numeric(18,2) CHECK (llp_contribution   IS NULL OR llp_contribution   >= 0);

-- ── Status axes (§6, §29) ─────────────────────────────────────────────────
-- Entity lifecycle: add 'draft' (spec Draft/Active/Inactive/Archived), keep
-- 'prospect' so existing rows/logic are undisturbed.
ALTER TABLE hsdg.entities DROP CONSTRAINT entities_status_check;
ALTER TABLE hsdg.entities ADD  CONSTRAINT entities_status_check
  CHECK (status IN ('draft','prospect','active','inactive','archived'));

-- Legal/operational status (§6). Nullable — assessed progressively.
ALTER TABLE hsdg.entities
  ADD COLUMN legal_status text
    CHECK (legal_status IS NULL OR legal_status IN
      ('active','under_incorporation','dormant','struck_off',
       'under_liquidation','cirp','closed','other'));

-- Regulatory profile status (§29) — independent of lifecycle status.
ALTER TABLE hsdg.entities
  ADD COLUMN regulatory_profile_status text NOT NULL DEFAULT 'incomplete'
    CHECK (regulatory_profile_status IN
      ('incomplete','under_review','complete','needs_reassessment'));

-- ── Listing (§15) — entity-level status; the per-exchange lines are a table. ─
ALTER TABLE hsdg.entities
  ADD COLUMN listing_status text NOT NULL DEFAULT 'unlisted'
    CHECK (listing_status IN
      ('unlisted','listed_equity','listed_debt','listed_equity_debt',
       'sme_equity','in_process'));

-- ── Business profile singular facts (§18) — activity table holds industries. ─
ALTER TABLE hsdg.entities
  ADD COLUMN business_description text,
  ADD COLUMN act_manufacturing boolean NOT NULL DEFAULT false,
  ADD COLUMN act_trading       boolean NOT NULL DEFAULT false,
  ADD COLUMN act_services       boolean NOT NULL DEFAULT false,
  ADD COLUMN act_import        boolean NOT NULL DEFAULT false,
  ADD COLUMN act_export        boolean NOT NULL DEFAULT false,
  ADD COLUMN act_ecommerce     boolean NOT NULL DEFAULT false,
  ADD COLUMN act_regulated     boolean NOT NULL DEFAULT false;

-- ── Accounting / reporting profile (§19) — a recordable current view only; ──
-- final determination is the downstream engine's, never decided here.
ALTER TABLE hsdg.entities
  ADD COLUMN current_accounting_framework text NOT NULL DEFAULT 'not_assessed'
    CHECK (current_accounting_framework IN
      ('not_assessed','ind_as','accounting_standards','other'));

CREATE INDEX entities_legal_status_idx ON hsdg.entities (legal_status);
CREATE INDEX entities_reg_profile_status_idx ON hsdg.entities (regulatory_profile_status);

-- Down Migration

DROP INDEX IF EXISTS hsdg.entities_reg_profile_status_idx;
DROP INDEX IF EXISTS hsdg.entities_legal_status_idx;

ALTER TABLE hsdg.entities
  DROP COLUMN IF EXISTS current_accounting_framework,
  DROP COLUMN IF EXISTS act_regulated,
  DROP COLUMN IF EXISTS act_ecommerce,
  DROP COLUMN IF EXISTS act_export,
  DROP COLUMN IF EXISTS act_import,
  DROP COLUMN IF EXISTS act_services,
  DROP COLUMN IF EXISTS act_trading,
  DROP COLUMN IF EXISTS act_manufacturing,
  DROP COLUMN IF EXISTS business_description,
  DROP COLUMN IF EXISTS listing_status,
  DROP COLUMN IF EXISTS regulatory_profile_status,
  DROP COLUMN IF EXISTS legal_status,
  DROP COLUMN IF EXISTS llp_contribution,
  DROP COLUMN IF EXISTS paid_up_capital,
  DROP COLUMN IF EXISTS authorised_capital,
  DROP COLUMN IF EXISTS roc,
  DROP COLUMN IF EXISTS country_of_incorporation,
  DROP COLUMN IF EXISTS short_name,
  DROP COLUMN IF EXISTS trade_name;

ALTER TABLE hsdg.entities DROP CONSTRAINT entities_status_check;
ALTER TABLE hsdg.entities ADD  CONSTRAINT entities_status_check
  CHECK (status IN ('prospect','active','inactive','archived'));

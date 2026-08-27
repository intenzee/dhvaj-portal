-- ─────────────────────────────────────────────────────────────────────────
-- 0026 · Fact-driven component applicability  (spec §11)
--
-- The discovery engine has decided applicability purely from a component's
-- static catalogue default. §11 wants it driven by CLIENT FACTS: registrations
-- the entity holds and the entity's legal category. This adds an optional
-- applicability RULE to each catalogue component:
--   • requires_registration — the component applies only when the client holds
--     an ACTIVE registration of ANY listed type (gstin/tan/cin/…);
--   • applies_to_categories — the component applies only to these entity
--     categories (company/llp/…).
-- A component with neither keeps today's behaviour (catalogue default). ADDITIVE
-- and firm-wide config, so no engagement data changes.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.service_components
  ADD COLUMN requires_registration text[],
  ADD COLUMN applies_to_categories text[];

-- Seed realistic rules on the catalogue (write is firm-wide-gated by RLS; the
-- migrator has no context, so drop FORCE for the seed and restore it).
ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;

-- GST scopes require an active GSTIN.
UPDATE hsdg.service_components
   SET requires_registration = ARRAY['gstin']
 WHERE code IN ('GSTR1','GSTR3B','ITC_RECON','GSTR9','GSTR9C');

-- ROC filings apply to companies (and LLPs where present).
UPDATE hsdg.service_components
   SET applies_to_categories = ARRAY['company','llp']
 WHERE code LIKE 'ROC\_%';

ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.service_components
  DROP COLUMN IF EXISTS applies_to_categories,
  DROP COLUMN IF EXISTS requires_registration;

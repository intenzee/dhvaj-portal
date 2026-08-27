-- ─────────────────────────────────────────────────────────────────────────
-- 0038 · Conditional applicability — turnover thresholds (§17 applicability)
--
-- Several statutory obligations apply only above a turnover threshold. The calc
-- engine already evaluates a rule version's `condition` against context supplied
-- at generation (evaluateCondition, {field,op,value}); this wires it up for real:
--   • entities gain an `annual_turnover` (the applicability fact), and
--   • the recurring rules that are threshold-gated get their condition.
-- Generation injects the engagement entity's turnover as `turnover`, so an entity
-- below the threshold correctly does NOT get the obligation (single generate =>
-- 400 "does not apply"; bulk generate => skipped with a reason). Thresholds are
-- the common Indian limits, in rupees:
--   • GSTR-9 (annual return)  : turnover >= 2,00,00,000  (₹2 crore)
--   • GSTR-9C (reconciliation): turnover >= 5,00,00,000  (₹5 crore)
--   • Tax Audit (44AB)        : turnover >= 1,00,00,000  (₹1 crore, business)
-- They are firm-editable config (a new rule version can change/remove them).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.entities ADD COLUMN annual_turnover bigint
  CHECK (annual_turnover IS NULL OR annual_turnover >= 0);
COMMENT ON COLUMN hsdg.entities.annual_turnover IS
  'Latest known annual turnover in rupees; drives threshold-based compliance applicability (§17).';

-- Drop FORCE on BOTH tables: the migrator carries no role context, so the JOIN
-- to compliance_rules must see its rows for the UPDATE to match anything.
ALTER TABLE hsdg.compliance_rule_versions  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules          NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.compliance_rule_versions v
SET condition = c.cond::jsonb
FROM (VALUES
  ('GSTR9_ANNUAL',  '{"field":"turnover","op":">=","value":20000000}'),
  ('GSTR9C_ANNUAL', '{"field":"turnover","op":">=","value":50000000}'),
  ('TAX_AUDIT_44AB', '{"field":"turnover","op":">=","value":10000000}')
) AS c(rule_code, cond)
JOIN hsdg.compliance_rules cr ON cr.code = c.rule_code
WHERE v.compliance_rule_id = cr.id;

ALTER TABLE hsdg.compliance_rule_versions  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules          FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.compliance_rule_versions  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules          NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.compliance_rule_versions v
SET condition = NULL
FROM hsdg.compliance_rules cr
WHERE v.compliance_rule_id = cr.id
  AND cr.code IN ('GSTR9_ANNUAL','GSTR9C_ANNUAL','TAX_AUDIT_44AB');
ALTER TABLE hsdg.compliance_rule_versions  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules          FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.entities DROP COLUMN IF EXISTS annual_turnover;

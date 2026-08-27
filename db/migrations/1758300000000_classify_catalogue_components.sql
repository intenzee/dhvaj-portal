-- ─────────────────────────────────────────────────────────────────────────
-- 0029 · Classify the seeded catalogue components (spec §6–§15)
--
-- Migration 0028 gave service_components a frozen due-date category (§2) and an
-- optional source (§3), defaulting existing rows to NO_FIXED_DATE. This migration
-- populates those columns for the components seeded in 0020, applying the spec's
-- Component Mapping tables (§6–§15) so the catalogue ships classified rather than
-- unclassified.
--
--   • GST filings (GSTR-1/3B)          → STATUTORY_FIXED  · LAW_RULE
--   • Rule-derived statutory filings    → STATUTORY_RULE   · LAW_RULE
--     (GSTR-9/9C annual, ITR filing, ROC AOC-4/MGT-7, tax-audit report/filing)
--   • Internal recurring SLAs           → HSDG_RECURRING   · HSDG_POLICY
--     (ITC reconciliation, monthly book closure)
--   • Assignment / workflow milestones  → HSDG_MILESTONE   · WORKFLOW
--     (audit planning/fieldwork/report, tax-audit planning/procedures, ITR prep)
--   • Client-committed deliverable      → CLIENT_COMMITTED · CLIENT_COMMITMENT
--     (MIS reporting)
--
-- Data-only and idempotent (UPDATE keyed by the stable component code). Only the
-- seeded catalogue codes are touched; any other component keeps its own value.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- The migrator carries no hsdg.role context, so FORCE RLS would filter every row
-- out of the UPDATE (the write policy needs ctx_is_firmwide()). Drop FORCE for
-- the data write, then restore it — the same pattern the 0020/0026 seeds use.
ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.service_components sc
SET due_date_category = v.cat, due_date_source = v.src
FROM (VALUES
  -- §8 GST & Indirect Tax
  ('GSTR1',        'STATUTORY_FIXED',  'LAW_RULE'),
  ('GSTR3B',       'STATUTORY_FIXED',  'LAW_RULE'),
  ('ITC_RECON',    'HSDG_RECURRING',   'HSDG_POLICY'),
  ('GSTR9',        'STATUTORY_RULE',   'LAW_RULE'),
  ('GSTR9C',       'STATUTORY_RULE',   'LAW_RULE'),
  -- §7 Direct Tax — Income Tax Return
  ('ITR_PREP',     'HSDG_MILESTONE',   'WORKFLOW'),
  ('ITR_FILE',     'STATUTORY_RULE',   'LAW_RULE'),
  -- §11 MCA / Corporate — Annual Filings
  ('ROC_AOC4',     'STATUTORY_RULE',   'LAW_RULE'),
  ('ROC_MGT7',     'STATUTORY_RULE',   'LAW_RULE'),
  -- §6 Audit & Assurance — Statutory Audit workflow milestones
  ('SA_PLANNING',  'HSDG_MILESTONE',   'WORKFLOW'),
  ('SA_FIELDWORK', 'HSDG_MILESTONE',   'WORKFLOW'),
  ('SA_REPORT',    'HSDG_MILESTONE',   'WORKFLOW'),
  -- §7 Direct Tax — Tax Audit (workflow milestones + rule-derived report/filing)
  ('TA_PLANNING',  'HSDG_MILESTONE',   'WORKFLOW'),
  ('TA_PROCEDURES','HSDG_MILESTONE',   'WORKFLOW'),
  ('TA_REPORT',    'STATUTORY_RULE',   'LAW_RULE'),
  ('TA_FILING',    'STATUTORY_RULE',   'LAW_RULE'),
  -- §9 Accounting & Bookkeeping
  ('BK_CLOSE',     'HSDG_RECURRING',   'HSDG_POLICY'),
  ('BK_MIS',       'CLIENT_COMMITTED', 'CLIENT_COMMITMENT')
) AS v(code, cat, src)
WHERE sc.code = v.code;

ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.service_components
SET due_date_category = 'NO_FIXED_DATE', due_date_source = NULL
WHERE code IN (
  'GSTR1','GSTR3B','ITC_RECON','GSTR9','GSTR9C','ITR_PREP','ITR_FILE',
  'ROC_AOC4','ROC_MGT7','SA_PLANNING','SA_FIELDWORK','SA_REPORT',
  'TA_PLANNING','TA_PROCEDURES','TA_REPORT','TA_FILING','BK_CLOSE','BK_MIS'
);

ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;

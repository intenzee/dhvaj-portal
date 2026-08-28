-- ─────────────────────────────────────────────────────────────────────────
-- 0038 · Complete statutory-rule coverage for event-based obligations
--
-- 0035/0037 seeded the RECURRING statutory rules (GST/TDS/ROC/labour/ITR/audit).
-- The Due-Date Classification spec (§7/§8/§11/§14) also defines event-triggered
-- statutory obligations whose deadline is a LIMITATION period measured from an
-- event date (order, allotment, incorporation, resolution, remittance). Those
-- components were classified (STATUTORY_EVENT) but had no rule, so the engine
-- could not compute their date even once the event is recorded.
--
-- This seeds the well-established Indian limitation rules (calc §4 event_date +
-- offset_days) and binds each to its component, plus a quarterly board-meeting
-- rule. Offsets are the standard statutory periods and are versioned config
-- (§25) — the firm supersedes any with a new effective-dated version without
-- touching history.
--
-- Deliberately NOT seeded (documented — no single fixed rule is correct):
--   • Notice/order RESPONSE deadlines (TXA_NOTICE, TXA_ORDER, GAS_NOTICE,
--     GAS_ORDER) and authority-scheduled HEARINGS (TXP_HEARING, GAP_HEARING) —
--     the date is stated on the document / set by the authority and is captured
--     per matter (event date + manual/override). Their STATUTORY_EVENT + LAW_RULE
--     classification is retained (the obligation is statutory; only the date is
--     matter-specific).
--   • Transaction/continuous obligations with no periodic due date (GST e-invoice,
--     withholding per remittance) and determination milestones (tax-audit
--     applicability) — generated per event, not on a recurring schedule.
--
-- Idempotent (ON CONFLICT); RLS: drop FORCE on the config tables read/written,
-- seed, restore (mirrors 0035).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.compliance_rules          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                   NO FORCE ROW LEVEL SECURITY;

-- ── A. Rules (event-limitation + one recurring board meeting) ─────────────
INSERT INTO hsdg.compliance_rules
  (code, name, description, service_id, category, due_date_category, due_date_source)
SELECT v.code, v.name, NULL, s.id, v.category, v.due_cat, v.due_src
FROM (VALUES
  ('IT_APPEAL_LIMITATION',    'Income-tax appeal (CIT-A) — limitation (30d)',     'TAX_APPEAL',       'income_tax', 'STATUTORY_EVENT', 'LAW_RULE'),
  ('GST_APPEAL_LIMITATION',   'GST first appeal — limitation (3 months)',         'GST_APPEAL',       'gst',        'STATUTORY_EVENT', 'LAW_RULE'),
  ('ITR_VERIFICATION_DUE',    'ITR e-verification — 30 days from filing',         'ITR_FILING',       'income_tax', 'STATUTORY_RULE',  'LAW_RULE'),
  ('PAS3_ALLOTMENT',          'PAS-3 return of allotment — 30 days',              'ROC_EVENT',        'roc',        'STATUTORY_EVENT', 'LAW_RULE'),
  ('BEN2_DECLARATION',        'BEN-2 beneficial ownership — 30 days',             'ROC_EVENT',        'roc',        'STATUTORY_EVENT', 'LAW_RULE'),
  ('ROC_EVENT_FILING',        'MGT-14 / event resolution filing — 30 days',       'ROC_EVENT',        'roc',        'STATUTORY_EVENT', 'LAW_RULE'),
  ('INC20A_COMMENCEMENT',     'INC-20A commencement of business — 180 days',      'INCORPORATION',    'roc',        'STATUTORY_EVENT', 'LAW_RULE'),
  ('FCGPR_REPORTING',         'FC-GPR FDI allotment reporting — 30 days',         'FEMA',             'other',      'STATUTORY_EVENT', 'LAW_RULE'),
  ('GST_AMENDMENT_LIMITATION','GST REG-14 core-field amendment — 15 days',        'GST_REGISTRATION', 'gst',        'STATUTORY_EVENT', 'LAW_RULE'),
  ('BOARD_MEETING_QUARTERLY', 'Board meeting — quarterly (min gap)',              'GOVERNANCE',       'other',      'STATUTORY_RULE',  'LAW_RULE')
) AS v(code, name, service_code, category, due_cat, due_src)
LEFT JOIN hsdg.services s ON s.code = v.service_code
ON CONFLICT (code) DO NOTHING;

UPDATE hsdg.compliance_rules SET is_active = true WHERE code IN (
  'IT_APPEAL_LIMITATION','GST_APPEAL_LIMITATION','ITR_VERIFICATION_DUE','PAS3_ALLOTMENT',
  'BEN2_DECLARATION','ROC_EVENT_FILING','INC20A_COMMENCEMENT','FCGPR_REPORTING',
  'GST_AMENDMENT_LIMITATION','BOARD_MEETING_QUARTERLY'
) AND is_active = false;

-- ── B. One effective-dated version per rule (calc §4) ─────────────────────
-- event_date basis: statutory date = event date + offset_days (the limitation).
-- BOARD_MEETING_QUARTERLY: period_end + 0 (a meeting each quarter).
INSERT INTO hsdg.compliance_rule_versions
  (compliance_rule_id, version, effective_from, calculation_basis,
   offset_months, offset_days, working_day_adjustment, internal_sla_offset_days)
SELECT cr.id, 1, DATE '2017-04-01', v.basis, 0, v.off_d, 'next', v.sla
FROM (VALUES
  ('IT_APPEAL_LIMITATION',    'event_date',  30,  5),
  ('GST_APPEAL_LIMITATION',   'event_date',  90,  7),
  ('ITR_VERIFICATION_DUE',    'event_date',  30,  3),
  ('PAS3_ALLOTMENT',          'event_date',  30,  5),
  ('BEN2_DECLARATION',        'event_date',  30,  5),
  ('ROC_EVENT_FILING',        'event_date',  30,  5),
  ('INC20A_COMMENCEMENT',     'event_date',  180, 15),
  ('FCGPR_REPORTING',         'event_date',  30,  5),
  ('GST_AMENDMENT_LIMITATION','event_date',  15,  3),
  ('BOARD_MEETING_QUARTERLY', 'period_end',  0,   5)
) AS v(code, basis, off_d, sla)
JOIN hsdg.compliance_rules cr ON cr.code = v.code
ON CONFLICT (compliance_rule_id, version) DO NOTHING;

-- ── C. Link each component to its rule ────────────────────────────────────
UPDATE hsdg.service_components sc
SET compliance_rule_id = cr.id
FROM (VALUES
  ('TXP_LIMITATION', 'IT_APPEAL_LIMITATION'),
  ('GAP_LIMITATION', 'GST_APPEAL_LIMITATION'),
  ('ITR_VERIFY',     'ITR_VERIFICATION_DUE'),
  ('ROCE_SHARE',     'PAS3_ALLOTMENT'),
  ('ROCE_BEN',       'BEN2_DECLARATION'),
  ('ROCE_FILING',    'ROC_EVENT_FILING'),
  ('INC_INITIAL',    'INC20A_COMMENCEMENT'),
  ('FEMA_FDI',       'FCGPR_REPORTING'),
  ('GSTR_AMEND',     'GST_AMENDMENT_LIMITATION'),
  ('GOV_MEETINGS',   'BOARD_MEETING_QUARTERLY')
) AS m(component_code, rule_code)
JOIN hsdg.compliance_rules cr ON cr.code = m.rule_code
WHERE sc.code = m.component_code;

ALTER TABLE hsdg.compliance_rules          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                   FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.compliance_rules          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances      NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.service_components SET compliance_rule_id = NULL
WHERE code IN ('TXP_LIMITATION','GAP_LIMITATION','ITR_VERIFY','ROCE_SHARE','ROCE_BEN',
               'ROCE_FILING','INC_INITIAL','FEMA_FDI','GSTR_AMEND','GOV_MEETINGS');

-- A rule an instance already used is soft-retired (§10 ON DELETE RESTRICT keeps
-- history); the rest are deleted (versions cascade).
WITH seeded AS (
  SELECT id FROM hsdg.compliance_rules WHERE code IN (
    'IT_APPEAL_LIMITATION','GST_APPEAL_LIMITATION','ITR_VERIFICATION_DUE','PAS3_ALLOTMENT',
    'BEN2_DECLARATION','ROC_EVENT_FILING','INC20A_COMMENCEMENT','FCGPR_REPORTING',
    'GST_AMENDMENT_LIMITATION','BOARD_MEETING_QUARTERLY'
  )
)
UPDATE hsdg.compliance_rules cr SET is_active = false
FROM seeded
WHERE cr.id = seeded.id
  AND EXISTS (SELECT 1 FROM hsdg.compliance_instances ci WHERE ci.compliance_rule_id = cr.id);

DELETE FROM hsdg.compliance_rules cr
WHERE cr.code IN (
    'IT_APPEAL_LIMITATION','GST_APPEAL_LIMITATION','ITR_VERIFICATION_DUE','PAS3_ALLOTMENT',
    'BEN2_DECLARATION','ROC_EVENT_FILING','INC20A_COMMENCEMENT','FCGPR_REPORTING',
    'GST_AMENDMENT_LIMITATION','BOARD_MEETING_QUARTERLY'
  )
  AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_instances ci WHERE ci.compliance_rule_id = cr.id);

ALTER TABLE hsdg.compliance_rules          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances      FORCE ROW LEVEL SECURITY;

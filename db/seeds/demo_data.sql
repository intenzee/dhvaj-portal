-- ─────────────────────────────────────────────────────────────────────────
-- HSDG Portal — DEMO dataset (synthetic).
--
-- A small, representative set of clients and engagements so a fresh deployment
-- shows a working practice rather than an empty portal. All data is fictional.
--
-- Runs AFTER dev_identity.sql (which seeds offices, users, roles, employees).
-- Intended to be applied by scripts/deploy/setup.mjs, which temporarily lifts
-- Row-Level Security (as the schema owner) around the seed. Idempotent: guarded
-- so a re-run inserts nothing new.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Clients (entities) — a spread of legal types ─────────────────────────
INSERT INTO hsdg.entities (entity_code, legal_name, entity_type_id, pan, home_office_id, status)
SELECT v.code, v.name, et.id, v.pan, o.id, 'active'
FROM (VALUES
  ('ENTD01', 'Bharat Textiles LLP',        'llp',             'AABCT1234C', 'NORTH'),
  ('ENTD02', 'Sunrise Foods Pvt Ltd',      'private_limited', 'AAACS5678D', 'NORTH'),
  ('ENTD03', 'Nova Tech Solutions Pvt Ltd','private_limited', 'AAACN9012E', 'SOUTH'),
  ('ENTD04', 'Rajesh Kumar',               'individual',      'ABCPK3456F', 'NORTH'),
  ('ENTD05', 'Green Earth Trust',          'trust',           'AAATG7890G', 'SOUTH'),
  ('ENTD06', 'Metro Retail LLP',           'llp',             'AABCM2345H', 'NORTH'),
  ('ENTD07', 'Apex Consultants',           'partnership',     'AABFA6789J', 'SOUTH'),
  ('ENTD08', 'Coastal Exports Pvt Ltd',    'private_limited', 'AAACC0123K', 'NORTH')
) AS v(code, name, type_slug, pan, office_code)
JOIN hsdg.entity_types et ON et.slug = v.type_slug
JOIN hsdg.offices o ON o.code = v.office_code
WHERE NOT EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.entity_code = v.code);

-- ── Registrations — drive fact-based applicability (§11) ─────────────────
-- Companies/LLPs hold a GSTIN (GST scopes become applicable); the individual
-- and trust hold none (GST scopes show "not applicable").
INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, status)
SELECT e.id, v.rtype, v.rnum, 'active'
FROM (VALUES
  ('ENTD01', 'gstin', '27AABCT1234C1Z5'),
  ('ENTD01', 'pt',    'PT-MH-0001'),
  ('ENTD02', 'gstin', '27AAACS5678D1Z3'),
  ('ENTD02', 'cin',   'U15100MH2015PTC000002'),
  ('ENTD02', 'tan',   'MUMS05678D'),
  ('ENTD03', 'gstin', '29AAACN9012E1Z1'),
  ('ENTD03', 'cin',   'U72200KA2016PTC000003'),
  ('ENTD06', 'gstin', '27AABCM2345H1Z9'),
  ('ENTD07', 'gstin', '29AABFA6789J1Z7'),
  ('ENTD07', 'tan',   'BLRA06789J'),
  ('ENTD08', 'gstin', '27AAACC0123K1Z2'),
  ('ENTD08', 'iec',   '0312345678'),
  ('ENTD08', 'cin',   'U51900MH2014PTC000008')
) AS v(ecode, rtype, rnum)
JOIN hsdg.entities e ON e.entity_code = v.ecode
WHERE NOT EXISTS (
  SELECT 1 FROM hsdg.entity_registrations r
  WHERE r.registration_type = v.rtype AND r.registration_number = v.rnum
);

-- ── Engagements — across services, statuses and partners ─────────────────
-- The EP must be partner-grade (a DB trigger enforces it); we use the partner
-- personas EMP001 (MP), EMP003 (Partner A), EMP004 (Partner B). Manager X
-- (EMP005) manages a few. The auto-primary triggers create the primary
-- service line and covered-entity rows for each.
INSERT INTO hsdg.engagements
  (entity_id, service_id, financial_year, period_label, office_id,
   engagement_partner_id, engagement_manager_id, status, engagement_type, priority)
SELECT e.id, s.id, v.fy, 'FY', e.home_office_id,
       ep.id, mgr.id, v.status, v.etype, v.prio
FROM (VALUES
  ('ENTD01', 'GST_MONTHLY',    '2026-27', 'accepted',  'recurring_compliance', 'high',   'EMP003', 'EMP005'),
  ('ENTD01', 'TDS_COMPLIANCE', '2026-27', 'active',    'recurring_compliance', 'normal', 'EMP003', 'EMP005'),
  ('ENTD02', 'STAT_AUDIT',     '2025-26', 'active',    'audit',                'high',   'EMP004', 'EMP005'),
  ('ENTD02', 'GST_MONTHLY',    '2026-27', 'accepted',  'recurring_compliance', 'normal', 'EMP004', NULL),
  ('ENTD03', 'TAX_AUDIT',      '2025-26', 'active',    'audit',                'urgent', 'EMP001', 'EMP005'),
  ('ENTD04', 'ITR_FILING',     '2025-26', 'accepted',  'recurring_compliance', 'normal', 'EMP003', NULL),
  ('ENTD05', 'ITR_FILING',     '2025-26', 'prospect',  'recurring_compliance', 'low',    'EMP004', NULL),
  ('ENTD06', 'BOOKKEEPING',    '2026-27', 'active',    'retainer',             'normal', 'EMP003', 'EMP005'),
  ('ENTD07', 'GST_MONTHLY',    '2026-27', 'accepted',  'recurring_compliance', 'normal', 'EMP004', NULL),
  ('ENTD08', 'STAT_AUDIT',     '2025-26', 'active',    'audit',                'high',   'EMP001', 'EMP005'),
  ('ENTD08', 'ROC_ANNUAL',     '2025-26', 'accepted',  'recurring_compliance', 'normal', 'EMP001', NULL)
) AS v(ecode, scode, fy, status, etype, prio, epcode, mgrcode)
JOIN hsdg.entities e ON e.entity_code = v.ecode
JOIN hsdg.services s ON s.code = v.scode
JOIN hsdg.employees ep ON ep.employee_code = v.epcode
LEFT JOIN hsdg.employees mgr ON mgr.employee_code = v.mgrcode
WHERE NOT EXISTS (
  SELECT 1 FROM hsdg.engagement_services es
  WHERE es.entity_id = e.id AND es.service_id = s.id
    AND es.financial_year = v.fy AND es.period_label = 'FY'
);

-- ── A multi-service engagement (§9–§10) — add GST to Sunrise's audit ──────
INSERT INTO hsdg.engagement_services (engagement_id, service_id, office_id, is_primary, status)
SELECT eng.id, s.id, eng.office_id, false, 'active'
FROM hsdg.engagements eng
JOIN hsdg.entities e ON e.id = eng.entity_id AND e.entity_code = 'ENTD02'
JOIN hsdg.services base ON base.id = eng.service_id AND base.code = 'STAT_AUDIT'
JOIN hsdg.services s ON s.code = 'PAYROLL'
WHERE eng.financial_year = '2025-26'
  AND NOT EXISTS (
    SELECT 1 FROM hsdg.engagement_services es
    WHERE es.engagement_id = eng.id AND es.service_id = s.id
  );

-- ── A group engagement (§30) — Coastal's audit also covers Nova Tech ──────
INSERT INTO hsdg.engagement_entities (engagement_id, entity_id, is_primary, role, status)
SELECT eng.id, sub.id, false, 'subsidiary', 'active'
FROM hsdg.engagements eng
JOIN hsdg.entities e ON e.id = eng.entity_id AND e.entity_code = 'ENTD08'
JOIN hsdg.services base ON base.id = eng.service_id AND base.code = 'STAT_AUDIT'
JOIN hsdg.entities sub ON sub.entity_code = 'ENTD03'
WHERE eng.financial_year = '2025-26'
  AND NOT EXISTS (
    SELECT 1 FROM hsdg.engagement_entities ee
    WHERE ee.engagement_id = eng.id AND ee.entity_id = sub.id
  );

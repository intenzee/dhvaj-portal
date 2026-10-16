-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-103 · after the order: the appeal limitation clock.
--
-- Recording an order on an appealable notice records a compliance event
-- 'notice_order' (details {noticeId, appealRuleCode}) on the client's
-- Compliance engagement. The limitation rules below are event rules on that
-- event; the generator runs only the rule the order's appealRuleCode names
-- (compliance-generator syncEventInstances), so an order starts exactly the
-- rule its notice type names:
--
--   IT_APPEAL_LIMITATION     CIT(A), s.249(2) — 30 days       (income_tax)
--   TDS_APPEAL_LIMITATION    CIT(A) for a TDS order — 30 days (tds; new)
--   IT_ITAT_LIMITATION       ITAT, s.253(3) — 60 days         (income_tax; new, to verify)
--   GST_APPEAL_LIMITATION    First appeal, s.107(1) — 3 months (gst; new version, to verify)
--   GST_TRIBUNAL_LIMITATION  GSTAT, s.112(1) — 3 months       (gst; new, to verify)
--   GST_AMENDMENT_LIMITATION 15 days                          (gst)
--
-- GST_APPEAL_LIMITATION's open version said 90 days; the new version (from
-- 1 Oct 2026) reads three calendar months (31 Jan → 30 Apr), pending the GST
-- lead's verification. Orders dated before keep the 90-day version.
--
-- TDS_201 pointed at IT_APPEAL_LIMITATION, an income-tax-stream rule a TDS-only
-- engagement never runs; it now names TDS_APPEAL_LIMITATION. Two library types
-- reach the second-appeal rules: IT_250 (CIT(A) order → ITAT) and GST_APL04
-- (appellate authority's order → GSTAT).
--
-- An appeal opens an Assignment engagement. GST_APPEAL / TAX_APPEAL are folded
-- stream services (they make Compliance engagements), so two Assignment
-- services carry the same line, review model and workflow family:
-- GST_APPEAL_MATTER and TAX_APPEAL_MATTER. notices.appeal_engagement_id links
-- the notice to it.
--
-- compliance_instances_unique (engagement, rule, reference date) predates the
-- event periods; two orders on the same day (or one re-recorded after a void)
-- would collide on it. Event rows (period_key 'EVT:<event id>') are unique per
-- event already (compliance_instances_period_unique), so the date rule now
-- applies to the other rows only.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.compliance_rules         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                 NO FORCE ROW LEVEL SECURITY;

-- ── The existing limitation rules run on the order event ──────────────────
UPDATE hsdg.compliance_rule_versions v
   SET frequency = 'event', event_type = 'notice_order', registration_scope = 'entity',
       stream = CASE r.code WHEN 'IT_APPEAL_LIMITATION' THEN 'income_tax' ELSE 'gst' END,
       form_label = CASE r.code WHEN 'IT_APPEAL_LIMITATION' THEN 'Form 35'
                                WHEN 'GST_APPEAL_LIMITATION' THEN 'APL-01' END
  FROM hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id
   AND r.code IN ('IT_APPEAL_LIMITATION', 'GST_APPEAL_LIMITATION', 'GST_AMENDMENT_LIMITATION');

-- GST first appeal: three months, not 90 days (to verify).
UPDATE hsdg.compliance_rule_versions v
   SET effective_to = DATE '2026-09-30'
  FROM hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id AND r.code = 'GST_APPEAL_LIMITATION' AND v.version = 2;
INSERT INTO hsdg.compliance_rule_versions
  (compliance_rule_id, version, effective_from, calculation_basis, offset_months, offset_days,
   working_day_adjustment, internal_sla_offset_days, notes, stream, registration_scope,
   frequency, form_label, event_type, verification, source_ref)
SELECT r.id, 3, DATE '2026-10-01', 'event_date', 3, 0, 'none', 7,
       'PS-103: three months from communication of the order (s.107(1)), replacing 90 days.',
       'gst', 'entity', 'event', 'APL-01', 'notice_order', 'verify', 'CGST Act s.107(1)'
  FROM hsdg.compliance_rules r
 WHERE r.code = 'GST_APPEAL_LIMITATION'
ON CONFLICT (compliance_rule_id, version) DO NOTHING;

-- ── New limitation rules ──────────────────────────────────────────────────
INSERT INTO hsdg.compliance_rules
  (code, name, description, service_id, category, is_active, due_date_category, due_date_source)
SELECT x.code, x.name, x.description, s.id, x.category, true, 'STATUTORY_EVENT', 'LAW_RULE'
  FROM (VALUES
    ('IT_ITAT_LIMITATION', 'ITAT appeal — limitation (60 days)',
     'Appeal to the Income Tax Appellate Tribunal against a CIT(A) order.', 'TAX_APPEAL', 'income_tax'),
    ('TDS_APPEAL_LIMITATION', 'TDS appeal to CIT(A) — limitation (30 days)',
     'First appeal against an order treating the deductor in default.', 'TAX_APPEAL', 'tds'),
    ('GST_TRIBUNAL_LIMITATION', 'GST Appellate Tribunal — limitation (3 months)',
     'Appeal to the GSTAT against the appellate authority''s order.', 'GST_APPEAL', 'gst')
  ) AS x(code, name, description, service_code, category)
  JOIN hsdg.services s ON s.code = x.service_code
ON CONFLICT (code) DO UPDATE SET is_active = true;

INSERT INTO hsdg.compliance_rule_versions
  (compliance_rule_id, version, effective_from, calculation_basis, offset_months, offset_days,
   working_day_adjustment, internal_sla_offset_days, notes, stream, registration_scope,
   frequency, form_label, event_type, verification, source_ref)
SELECT r.id, 1, DATE '2017-04-01', 'event_date', x.months, x.days, 'none', x.sla,
       'PS-103: starts on the order event of a notice that names this rule.',
       x.stream, 'entity', 'event', x.form, 'notice_order', x.verification, x.source_ref
  FROM (VALUES
    ('IT_ITAT_LIMITATION', 0, 60, 7, 'income_tax', 'Form 36', 'verify', 'Income-tax Act s.253(3)'),
    ('TDS_APPEAL_LIMITATION', 0, 30, 5, 'tds', 'Form 35', 'verify', 'Income-tax Act s.249(2)'),
    ('GST_TRIBUNAL_LIMITATION', 3, 0, 7, 'gst', 'APL-05', 'verify', 'CGST Act s.112(1)')
  ) AS x(code, months, days, sla, stream, form, verification, source_ref)
  JOIN hsdg.compliance_rules r ON r.code = x.code
ON CONFLICT (compliance_rule_id, version) DO NOTHING;

-- ── The library points at them ────────────────────────────────────────────
UPDATE hsdg.notice_types SET appeal_rule_code = 'TDS_APPEAL_LIMITATION', version = version + 1
 WHERE code = 'TDS_201' AND appeal_rule_code = 'IT_APPEAL_LIMITATION';
INSERT INTO hsdg.notice_types
  (code, stream, form, section, title, default_reply_days, appealable, appeal_rule_code)
VALUES
  ('IT_250', 'income_tax', NULL, 's.250', 'Order of the CIT(Appeals)', NULL, true, 'IT_ITAT_LIMITATION'),
  ('GST_APL04', 'gst', 'APL-04', 's.107(11)', 'Order of the appellate authority', NULL, true,
   'GST_TRIBUNAL_LIMITATION')
ON CONFLICT (code) DO NOTHING;

-- ── Assignment services an appeal opens ───────────────────────────────────
INSERT INTO hsdg.services
  (service_line_id, code, name, description, required_review_model_id, workflow_family_id,
   default_recurrence, is_active)
SELECT s.service_line_id, x.code, x.name, x.description, s.required_review_model_id,
       s.workflow_family_id, 'one_time', true
  FROM (VALUES
    ('GST_APPEAL_MATTER', 'GST Appeal', 'An appeal against a GST order (opened from the notice).',
     'GST_APPEAL'),
    ('TAX_APPEAL_MATTER', 'Direct Tax Appeal',
     'An appeal against an income-tax or TDS order (opened from the notice).', 'TAX_APPEAL')
  ) AS x(code, name, description, source_code)
  JOIN hsdg.services s ON s.code = x.source_code
ON CONFLICT (code) DO UPDATE SET is_active = true;

ALTER TABLE hsdg.services                 FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules         FORCE ROW LEVEL SECURITY;

-- ── One row per rule and date, except per-event rows ──────────────────────
ALTER TABLE hsdg.compliance_instances DROP CONSTRAINT IF EXISTS compliance_instances_unique;
DROP INDEX IF EXISTS hsdg.compliance_instances_unique;
CREATE UNIQUE INDEX compliance_instances_unique
  ON hsdg.compliance_instances (engagement_id, compliance_rule_id, reference_date)
  WHERE period_key IS NULL OR period_key NOT LIKE 'EVT:%';

-- ── The notice → its appeal ───────────────────────────────────────────────
ALTER TABLE hsdg.notices
  ADD COLUMN appeal_engagement_id uuid REFERENCES hsdg.engagements (id) ON DELETE SET NULL;
CREATE INDEX notices_appeal_engagement_idx ON hsdg.notices (appeal_engagement_id)
  WHERE appeal_engagement_id IS NOT NULL;

-- Down Migration

-- The guards below read across the firm: lift FORCE for the owner meanwhile.
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services  NO FORCE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS hsdg.notices_appeal_engagement_idx;
ALTER TABLE hsdg.notices DROP COLUMN IF EXISTS appeal_engagement_id;

-- The full date rule comes back unless two event filings now share a rule and
-- date (two orders on one day, or one re-recorded after a void): those rows are
-- real, so the partial index stays rather than losing either of them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM hsdg.compliance_instances
              GROUP BY engagement_id, compliance_rule_id, reference_date HAVING count(*) > 1) THEN
    RAISE NOTICE 'compliance_instances_unique stays partial: event filings share a rule and date.';
  ELSE
    DROP INDEX hsdg.compliance_instances_unique;
    ALTER TABLE hsdg.compliance_instances ADD CONSTRAINT compliance_instances_unique
      UNIQUE (engagement_id, compliance_rule_id, reference_date);
  END IF;
END $$;

ALTER TABLE hsdg.compliance_rules         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                 NO FORCE ROW LEVEL SECURITY;

-- Services, types and rules still in use stay (inactive); the rest go.
DELETE FROM hsdg.services s
 WHERE s.code IN ('GST_APPEAL_MATTER', 'TAX_APPEAL_MATTER')
   AND NOT EXISTS (SELECT 1 FROM hsdg.engagements e WHERE e.service_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_services es WHERE es.service_id = s.id);
UPDATE hsdg.services SET is_active = false
 WHERE code IN ('GST_APPEAL_MATTER', 'TAX_APPEAL_MATTER');

DELETE FROM hsdg.notice_types t
 WHERE t.code IN ('IT_250', 'GST_APL04')
   AND NOT EXISTS (SELECT 1 FROM hsdg.notices n WHERE n.notice_type_id = t.id);
UPDATE hsdg.notice_types SET is_active = false, appeal_rule_code = NULL, version = version + 1
 WHERE code IN ('IT_250', 'GST_APL04');
UPDATE hsdg.notice_types SET appeal_rule_code = 'IT_APPEAL_LIMITATION', version = version + 1
 WHERE code = 'TDS_201' AND appeal_rule_code = 'TDS_APPEAL_LIMITATION';

DELETE FROM hsdg.compliance_rule_versions v
 USING hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id
   AND r.code IN ('IT_ITAT_LIMITATION', 'TDS_APPEAL_LIMITATION', 'GST_TRIBUNAL_LIMITATION')
   AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_instances ci
                    WHERE ci.compliance_rule_id = r.id);
DELETE FROM hsdg.compliance_rules r
 WHERE r.code IN ('IT_ITAT_LIMITATION', 'TDS_APPEAL_LIMITATION', 'GST_TRIBUNAL_LIMITATION')
   AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_rule_versions v WHERE v.compliance_rule_id = r.id);
UPDATE hsdg.compliance_rules SET is_active = false
 WHERE code IN ('IT_ITAT_LIMITATION', 'TDS_APPEAL_LIMITATION', 'GST_TRIBUNAL_LIMITATION');

-- GST first appeal: drop the three-month version unless a filing used it.
DELETE FROM hsdg.compliance_rule_versions v
 USING hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id AND r.code = 'GST_APPEAL_LIMITATION' AND v.version = 3
   AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_instances ci
                    WHERE ci.compliance_rule_version_id = v.id);
UPDATE hsdg.compliance_rule_versions v
   SET effective_to = NULL
  FROM hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id AND r.code = 'GST_APPEAL_LIMITATION' AND v.version = 2
   AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_rule_versions v3
                    WHERE v3.compliance_rule_id = r.id AND v3.version = 3);

-- Back off the order event (every version of the three, and any kept above).
UPDATE hsdg.compliance_rule_versions v
   SET frequency = NULL, event_type = NULL, registration_scope = NULL, stream = NULL,
       form_label = NULL
  FROM hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id
   AND r.code IN ('IT_APPEAL_LIMITATION', 'GST_APPEAL_LIMITATION', 'GST_AMENDMENT_LIMITATION',
                  'IT_ITAT_LIMITATION', 'TDS_APPEAL_LIMITATION', 'GST_TRIBUNAL_LIMITATION');

ALTER TABLE hsdg.services                 FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;

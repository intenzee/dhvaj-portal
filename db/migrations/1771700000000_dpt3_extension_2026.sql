-- ─────────────────────────────────────────────────────────────────────────
-- DPT-3 FY 2025-26: 30 Jun 2026 extended to 31 Jul 2026 (roc-mca §5.6).
--
-- MCA Circular 02/2026 extended the return of deposits once, for the year
-- ended 31 March 2026. It is recorded as a government extension on ROC_DPT3,
-- not in the rule: the rule keeps 30 June. Generated instances whose computed
-- date is 30 Jun 2026 pick the extension up (the generator's lookup by rule
-- and original date); open ones already generated are pointed at it here.
-- Flagged Verify in the notes until the circular is checked.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.compliance_rules NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.government_extensions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.government_extensions
  (compliance_rule_id, original_due_date, revised_due_date, notification_reference,
   applicable_population, effective_date, notes)
SELECT r.id, '2026-06-30'::date, '2026-07-31'::date, 'MCA Circular 02/2026',
       'Companies filing DPT-3 (return of deposits) for FY 2025-26',
       '2026-06-30'::date,
       'Verify: DPT-3 for FY 2025-26 extended to 31 Jul 2026 — check against the circular.'
  FROM hsdg.compliance_rules r
 WHERE r.code = 'ROC_DPT3'
   AND NOT EXISTS (
     SELECT 1 FROM hsdg.government_extensions ge
      WHERE ge.compliance_rule_id = r.id AND ge.original_due_date = '2026-06-30'::date
   );

UPDATE hsdg.compliance_instances ci
   SET government_extension_id = ge.id
  FROM hsdg.government_extensions ge
 WHERE ge.compliance_rule_id = ci.compliance_rule_id
   AND ge.original_due_date = ci.statutory_deadline
   AND ge.notification_reference = 'MCA Circular 02/2026'
   AND ci.status = 'open'
   AND ci.government_extension_id IS NULL
   AND ci.statutory_deadline_override IS NULL;

ALTER TABLE hsdg.compliance_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.government_extensions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.compliance_rules NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.government_extensions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.compliance_instances SET government_extension_id = NULL
 WHERE government_extension_id IN (
   SELECT id FROM hsdg.government_extensions WHERE notification_reference = 'MCA Circular 02/2026');
DELETE FROM hsdg.government_extensions WHERE notification_reference = 'MCA Circular 02/2026';

ALTER TABLE hsdg.compliance_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.government_extensions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;

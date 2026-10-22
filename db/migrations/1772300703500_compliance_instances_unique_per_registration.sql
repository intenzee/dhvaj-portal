-- ─────────────────────────────────────────────────────────────────────────
-- Compliance calendar · one row per rule and date *per registration*.
--
-- compliance_instances_unique (engagement, rule, reference date) predates
-- registrations on filings. A client with two GSTINs has two GSTR-1s for the
-- same month — same rule, same date, different registration — and the second
-- one broke the create of its Compliance engagement (a 500). Per-director ROC
-- rows (period_key '…:DIN:<din>') share rule, registration and date the same
-- way. Both are unique per period already (compliance_instances_period_unique),
-- so the date rule now keys on the registration and leaves DIN rows to it, as
-- it already left event rows.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DROP INDEX IF EXISTS hsdg.compliance_instances_unique;
CREATE UNIQUE INDEX compliance_instances_unique
  ON hsdg.compliance_instances (engagement_id, compliance_rule_id, registration_id, reference_date)
  NULLS NOT DISTINCT
  WHERE period_key IS NULL OR (period_key NOT LIKE 'EVT:%' AND period_key NOT LIKE '%:DIN:%');

-- Down Migration

-- The old rule comes back only if no two registrations (or directors) now
-- share a rule and date: those rows are real, so the new index stays rather
-- than losing either of them.
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM hsdg.compliance_instances
              WHERE period_key IS NULL OR period_key NOT LIKE 'EVT:%'
              GROUP BY engagement_id, compliance_rule_id, reference_date HAVING count(*) > 1) THEN
    RAISE NOTICE 'compliance_instances_unique stays per registration: filings share a rule and date.';
  ELSE
    DROP INDEX hsdg.compliance_instances_unique;
    CREATE UNIQUE INDEX compliance_instances_unique
      ON hsdg.compliance_instances (engagement_id, compliance_rule_id, reference_date)
      WHERE period_key IS NULL OR period_key NOT LIKE 'EVT:%';
  END IF;
END $$;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;

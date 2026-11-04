-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- Tax audit year rollover (Phase 5, F-10)
--
-- "When a year's audit is Filed, next year's row is made at Not started.
-- Last year's answers are copied in as drafts, and the same team is
-- proposed." Done when every audited client has its next-year row.
--
--   · tax_audits.rolled_from_audit_id names the filed audit a row was rolled
--     over from. Filing an audit makes the next financial year's row on the
--     same engagement (revision 0, Not started), or marks the row the
--     calendar already made. A closed, merged, cancelled, declined or
--     withdrawn engagement rolls nothing over.
--   · The row carries nothing else of last year's: the acceptance desk
--     proposes last year's form, signing partner and team from it (the
--     signing partner is checked again then), and the 3CD drafts carry last
--     year's answers (F-6's hsdg.tax_audit_draft_sources).
--   · Filing can be reached by any role (a lodge, a return mark run as the
--     owner), so the rollover runs as the owner under its own flag, with
--     policies for hsdg_migrator only while it is on.
--   · Backfill: every audit filed before today gets its next-year row.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE hsdg.tax_audits
  ADD COLUMN rolled_from_audit_id uuid REFERENCES hsdg.tax_audits (id) ON DELETE SET NULL;
CREATE INDEX tax_audits_rolled_from_idx ON hsdg.tax_audits (rolled_from_audit_id)
  WHERE rolled_from_audit_id IS NOT NULL;

-- "2025-26" → "2026-27".
CREATE FUNCTION hsdg.next_financial_year(p_fy text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT (left(p_fy, 4)::int + 1)::text || '-' || lpad(((left(p_fy, 4)::int + 2) % 100)::text, 2, '0')
$$;

CREATE FUNCTION hsdg.tax_audit_rolling() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_user = 'hsdg_migrator'
     AND COALESCE(current_setting('hsdg.tax_audit_rolling', true), '') = 'on'
$$;
CREATE POLICY tax_audits_rolling ON hsdg.tax_audits TO hsdg_migrator
  USING (hsdg.tax_audit_rolling()) WITH CHECK (hsdg.tax_audit_rolling());
CREATE POLICY engagements_tax_audit_rolling ON hsdg.engagements
  FOR SELECT TO hsdg_migrator USING (hsdg.tax_audit_rolling());

CREATE FUNCTION hsdg.tax_audit_roll_over() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.stage = 'filed' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('hsdg.tax_audit_rolling', 'on', true);
  IF EXISTS (SELECT 1 FROM hsdg.engagements e
              WHERE e.id = NEW.engagement_id
                AND e.status NOT IN ('closed','merged','cancelled','declined','withdrawn')) THEN
    INSERT INTO hsdg.tax_audits (engagement_id, financial_year, stage, rolled_from_audit_id)
    VALUES (NEW.engagement_id, hsdg.next_financial_year(NEW.financial_year), 'not_started', NEW.id)
    ON CONFLICT (engagement_id, financial_year, revision) DO UPDATE
      SET rolled_from_audit_id = EXCLUDED.rolled_from_audit_id,
          version = tax_audits.version + 1
      WHERE tax_audits.rolled_from_audit_id IS NULL;
  END IF;
  PERFORM set_config('hsdg.tax_audit_rolling', '', true);
  RETURN NULL;
END $$;
CREATE TRIGGER tax_audits_roll_over
  AFTER INSERT OR UPDATE OF stage ON hsdg.tax_audits
  FOR EACH ROW WHEN (NEW.stage = 'filed')
  EXECUTE FUNCTION hsdg.tax_audit_roll_over();

-- Backfill: the audits filed so far roll over (the latest revision of each).
ALTER TABLE hsdg.tax_audits NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.tax_audits (engagement_id, financial_year, stage, rolled_from_audit_id)
SELECT DISTINCT ON (a.engagement_id, a.financial_year)
       a.engagement_id, hsdg.next_financial_year(a.financial_year), 'not_started', a.id
  FROM hsdg.tax_audits a
  JOIN hsdg.engagements e ON e.id = a.engagement_id
 WHERE a.stage = 'filed'
   AND e.status NOT IN ('closed','merged','cancelled','declined','withdrawn')
 ORDER BY a.engagement_id, a.financial_year, a.revision DESC
ON CONFLICT (engagement_id, financial_year, revision) DO UPDATE
  SET rolled_from_audit_id = EXCLUDED.rolled_from_audit_id, version = tax_audits.version + 1
  WHERE tax_audits.rolled_from_audit_id IS NULL;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audits FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.tax_audits NO FORCE ROW LEVEL SECURITY;
-- Rows the rollover made and nobody has touched since go with it.
DELETE FROM hsdg.tax_audits a
 WHERE a.rolled_from_audit_id IS NOT NULL AND a.stage = 'not_started'
   AND a.compliance_instance_id IS NULL AND a.signing_partner_id IS NULL
   AND a.form_type IS NULL AND a.accepted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM hsdg.tax_audit_working_papers w WHERE w.tax_audit_id = a.id);
ALTER TABLE hsdg.tax_audits FORCE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS tax_audits_roll_over ON hsdg.tax_audits;
DROP FUNCTION IF EXISTS hsdg.tax_audit_roll_over();
DROP POLICY IF EXISTS engagements_tax_audit_rolling ON hsdg.engagements;
DROP POLICY IF EXISTS tax_audits_rolling ON hsdg.tax_audits;
DROP FUNCTION IF EXISTS hsdg.tax_audit_rolling();
DROP FUNCTION IF EXISTS hsdg.next_financial_year(text);
DROP INDEX IF EXISTS hsdg.tax_audits_rolled_from_idx;
ALTER TABLE hsdg.tax_audits DROP COLUMN IF EXISTS rolled_from_audit_id;

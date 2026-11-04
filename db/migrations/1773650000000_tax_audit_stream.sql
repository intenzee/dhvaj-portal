-- ─────────────────────────────────────────────────────────────────────────
-- Tax Audit stream (Phase 3, F-1)
--
-- Tax audit (s.44AB) becomes the seventh stream on a Compliance engagement,
-- beside Income Tax, with one row per financial year. Until now it was one
-- "Tax audit report" filing (rule IT_TAX_AUDIT) inside Income Tax, plus an old
-- catalogue service (TAX_AUDIT) with loose components; neither tracked the work.
--
--   · The stream lists (services, compliance years, rule versions) take
--     'tax_audit', and its live service STREAM_TAX_AUDIT is added.
--   · Rule IT_TAX_AUDIT moves to the new stream. Every engagement year that
--     has its filing, or whose Income Tax would still get one (the rule's
--     condition), gets the stream in scope (on the same PAN as Income Tax) and
--     a Tax Audit service line; the filing and its task move onto that line.
--     Their ids, status, history and documents stay as they are.
--   · hsdg.tax_audits holds the year's audit: stage, form (3CA / 3CB), signing
--     partner, applicability reason, UDIN, upload, client acceptance and the
--     acknowledgement. The calendar makes one with each IT_TAX_AUDIT filing;
--     the backfill makes one for each filing already on the portal. Filing
--     the report (or marking it not applicable) moves the stage with it.
--   · A year with the stream is a tax audit independence fact, so the s.44AB
--     rule (no tax audit of books the firm keeps) sees it.
--   · The stand-alone TAX_AUDIT service is retired for new engagements.
--     Engagements already on it stay as they are, for the firm to move.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.services DROP CONSTRAINT services_stream_check;
ALTER TABLE hsdg.services ADD CONSTRAINT services_stream_check
  CHECK (stream IN ('gst','tds','income_tax','tax_audit','roc','bookkeeping','mis'));
ALTER TABLE hsdg.compliance_engagement_years DROP CONSTRAINT compliance_engagement_years_streams_check;
ALTER TABLE hsdg.compliance_engagement_years ADD CONSTRAINT compliance_engagement_years_streams_check
  CHECK (streams <@ ARRAY['gst','tds','income_tax','tax_audit','roc','bookkeeping','mis']::text[]);
ALTER TABLE hsdg.compliance_rule_versions DROP CONSTRAINT compliance_rule_versions_stream_check;
ALTER TABLE hsdg.compliance_rule_versions ADD CONSTRAINT compliance_rule_versions_stream_check
  CHECK (stream IS NULL OR stream IN ('gst','tds','income_tax','tax_audit','roc','bookkeeping','mis'));

ALTER TABLE hsdg.compliance_rules NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.registration_compliance_profiles NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.services
  (service_line_id, code, name, description, required_review_model_id, workflow_family_id,
   default_recurrence, stream)
SELECT service_line_id, 'STREAM_TAX_AUDIT', 'Tax Audit',
       'Tax audit u/s 44AB: one report a year (Form 3CA or 3CB, with Form 3CD), from applicability to filing.',
       required_review_model_id, workflow_family_id, default_recurrence, 'tax_audit'
  FROM hsdg.services WHERE code = 'STREAM_INCOME_TAX';

UPDATE hsdg.services SET is_active = false, updated_at = now() WHERE code = 'TAX_AUDIT';

-- ── The year's audit ─────────────────────────────────────────────────────
CREATE TABLE hsdg.tax_audits (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  financial_year          text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  -- 0 is the original report; a revised report is the next number (F-8).
  revision                integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  compliance_instance_id  uuid UNIQUE REFERENCES hsdg.compliance_instances (id) ON DELETE SET NULL,
  stage                   text NOT NULL DEFAULT 'not_started' CHECK (stage IN
                            ('not_started','acceptance','information','clause_work','review',
                             'signed','uploaded','client_accepted','filed','not_applicable')),
  form_type               text CHECK (form_type IN ('3CA','3CB')),
  signing_partner_id      uuid REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  applicability_reason    text CHECK (length(applicability_reason) <= 500),
  udin                    text UNIQUE CHECK (udin ~ '^[0-9]{8}[A-Z]{6}[0-9]{4}$'),
  signed_at               timestamptz,
  uploaded_on             date,
  client_accepted_on      date,
  client_rejected_on      date,
  filed_on                date,
  acknowledgement_no      text CHECK (length(acknowledgement_no) <= 40),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1,
  UNIQUE (engagement_id, financial_year, revision)
);
CREATE INDEX tax_audits_signing_partner_idx ON hsdg.tax_audits (signing_partner_id, financial_year)
  WHERE signing_partner_id IS NOT NULL;
CREATE INDEX tax_audits_year_idx ON hsdg.tax_audits (financial_year, stage);

GRANT SELECT, INSERT, UPDATE ON hsdg.tax_audits TO hsdg_app;
ALTER TABLE hsdg.tax_audits ENABLE ROW LEVEL SECURITY;
-- Whoever sees (or works) the engagement's filings sees (or works) its audit.
CREATE POLICY tax_audits_select ON hsdg.tax_audits FOR SELECT TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY tax_audits_insert ON hsdg.tax_audits FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY tax_audits_update ON hsdg.tax_audits FOR UPDATE TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY purge_engagement ON hsdg.tax_audits TO hsdg_migrator
  USING (current_setting('hsdg.purging', true) = 'on')
  WITH CHECK (current_setting('hsdg.purging', true) = 'on');
CREATE POLICY erase_person ON hsdg.tax_audits TO hsdg_migrator
  USING (current_setting('hsdg.erasing_person', true) = 'on')
  WITH CHECK (current_setting('hsdg.erasing_person', true) = 'on');

CREATE TRIGGER tax_audits_set_updated_at BEFORE UPDATE ON hsdg.tax_audits
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- The calendar's IT_TAX_AUDIT filing brings its year's audit.
CREATE FUNCTION hsdg.tax_audit_for_filing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hsdg.compliance_rules r
                  WHERE r.id = NEW.compliance_rule_id AND r.code = 'IT_TAX_AUDIT') THEN
    RETURN NULL;
  END IF;
  INSERT INTO hsdg.tax_audits (engagement_id, financial_year, compliance_instance_id, stage)
  VALUES (NEW.engagement_id, NEW.financial_year, NEW.id,
          CASE NEW.workflow_status WHEN 'filed' THEN 'filed'
                                   WHEN 'not_applicable' THEN 'not_applicable'
                                   ELSE 'not_started' END)
  ON CONFLICT (engagement_id, financial_year, revision) DO UPDATE
    SET compliance_instance_id = EXCLUDED.compliance_instance_id, version = tax_audits.version + 1
    WHERE tax_audits.compliance_instance_id IS NULL;
  RETURN NULL;
END $$;
CREATE TRIGGER compliance_instances_tax_audit
  AFTER INSERT ON hsdg.compliance_instances
  FOR EACH ROW WHEN (NEW.financial_year IS NOT NULL)
  EXECUTE FUNCTION hsdg.tax_audit_for_filing();

-- Filing the report, or marking it not applicable, moves the stage with it;
-- undoing either puts the audit back where its own dates say it was.
CREATE FUNCTION hsdg.tax_audit_follow_filing() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE hsdg.tax_audits a
     SET stage = CASE
           WHEN NEW.workflow_status = 'filed' THEN 'filed'
           WHEN NEW.workflow_status = 'not_applicable' THEN 'not_applicable'
           WHEN a.client_accepted_on IS NOT NULL THEN 'client_accepted'
           WHEN a.uploaded_on IS NOT NULL THEN 'uploaded'
           WHEN a.signed_at IS NOT NULL THEN 'signed'
           ELSE 'not_started' END,
         filed_on = CASE WHEN NEW.workflow_status = 'filed'
                         THEN coalesce(a.filed_on, (coalesce(NEW.completed_at, now()) AT TIME ZONE 'Asia/Kolkata')::date)
                         ELSE NULL END,
         version = a.version + 1
   WHERE a.compliance_instance_id = NEW.id
     AND (OLD.workflow_status IN ('filed', 'not_applicable')
          OR NEW.workflow_status IN ('filed', 'not_applicable'));
  RETURN NULL;
END $$;
CREATE TRIGGER compliance_instances_tax_audit_stage
  AFTER UPDATE OF workflow_status ON hsdg.compliance_instances
  FOR EACH ROW WHEN (OLD.workflow_status IS DISTINCT FROM NEW.workflow_status)
  EXECUTE FUNCTION hsdg.tax_audit_follow_filing();

-- A year with the Tax Audit stream is a tax audit fact (the s.44AB rule).
CREATE OR REPLACE FUNCTION hsdg.sync_independence_facts(eng_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = hsdg, pg_temp
AS $$
DECLARE
  e record;
  facts jsonb := '[]'::jsonb;
BEGIN
  SELECT id, entity_id, engagement_code, kind, status, financial_year, service_id
    INTO e FROM hsdg.engagements WHERE id = eng_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF e.status NOT IN ('closed','merged','cancelled','declined','withdrawn') THEN
    IF e.kind = 'statutory_audit' THEN
      facts := jsonb_build_array(jsonb_build_object('fy', e.financial_year, 'fact', 'statutory_audit'));
    ELSIF e.kind = 'compliance' THEN
      facts := jsonb_build_array(jsonb_build_object('fy', e.financial_year, 'fact', 'compliance'))
        || COALESCE((
             SELECT jsonb_agg(jsonb_build_object('fy', y.financial_year, 'fact', s))
               FROM hsdg.compliance_engagement_years y
               CROSS JOIN LATERAL unnest(y.streams) AS s
              WHERE y.engagement_id = eng_id AND s IN ('bookkeeping','mis','tax_audit')
           ), '[]'::jsonb);
    ELSE
      facts := COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'fact', CASE sv.code WHEN 'INT_AUDIT' THEN 'internal_audit' ELSE 'tax_audit' END,
                      'fy', e.financial_year))
               FROM hsdg.services sv
              WHERE sv.code IN ('INT_AUDIT','TAX_AUDIT')
                AND (sv.id = e.service_id
                     OR sv.id IN (SELECT es.service_id FROM hsdg.engagement_services es
                                   WHERE es.engagement_id = eng_id AND es.status <> 'cancelled'))
           ), '[]'::jsonb);
    END IF;
  END IF;
  PERFORM hsdg.put_independence_facts(e.id, e.entity_id, e.engagement_code, facts);
END;
$$;

-- ── Move IT_TAX_AUDIT and its filings onto the stream ───────────────────

UPDATE hsdg.compliance_rules
   SET service_id = (SELECT id FROM hsdg.services WHERE code = 'STREAM_TAX_AUDIT'),
       updated_at = now()
 WHERE code = 'IT_TAX_AUDIT';
UPDATE hsdg.compliance_rule_versions v SET stream = 'tax_audit'
  FROM hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id AND r.code = 'IT_TAX_AUDIT';

-- The years with a tax audit filing, and the years whose Income Tax the
-- calendar would still give one: the PAN profile says tax audit, or (no answer)
-- turnover is over ₹1 crore, the rule's own default.
CREATE TEMP TABLE tax_audit_years ON COMMIT DROP AS
SELECT ci.engagement_id, ci.financial_year
  FROM hsdg.compliance_instances ci
  JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
 WHERE r.code = 'IT_TAX_AUDIT' AND ci.financial_year IS NOT NULL
UNION
SELECT y.engagement_id, y.financial_year
  FROM hsdg.compliance_engagement_years y
  JOIN hsdg.engagements e ON e.id = y.engagement_id
  JOIN hsdg.entities ent ON ent.id = e.entity_id
  LEFT JOIN LATERAL (
    SELECT (p.attributes ->> 'taxAudit')::boolean AS flag
      FROM hsdg.registration_compliance_profiles p
     WHERE p.entity_id = e.entity_id AND p.scope = 'pan' AND p.registration_id IS NULL
       AND p.effective_from <= make_date(left(y.financial_year, 4)::int, 4, 1)
       AND (p.effective_to IS NULL OR p.effective_to >= make_date(left(y.financial_year, 4)::int, 4, 1))
     ORDER BY p.effective_from DESC
     LIMIT 1) pan ON true
 WHERE 'income_tax' = ANY (y.streams)
   AND coalesce(pan.flag, coalesce(ent.annual_turnover, 0) > 10000000);

-- The stream in scope for those years, on Income Tax's PAN.
UPDATE hsdg.compliance_engagement_years y
   SET streams = array_append(y.streams, 'tax_audit'),
       stream_registrations = CASE
         WHEN y.stream_registrations ? 'income_tax'
           THEN y.stream_registrations || jsonb_build_object('tax_audit', y.stream_registrations -> 'income_tax')
         ELSE y.stream_registrations END,
       version = y.version + 1
  FROM tax_audit_years t
 WHERE t.engagement_id = y.engagement_id AND t.financial_year = y.financial_year
   AND NOT ('tax_audit' = ANY (y.streams));

-- A Tax Audit line on each of those engagements, led and staffed as Income Tax.
INSERT INTO hsdg.engagement_services
  (engagement_id, service_id, office_id, lead_employee_id, is_primary, status)
SELECT DISTINCT ON (e.id) e.id, ta.id, coalesce(it.office_id, e.office_id), it.lead_employee_id,
       false, coalesce(it.status, 'active')
  FROM (SELECT DISTINCT engagement_id FROM tax_audit_years) t
  JOIN hsdg.engagements e ON e.id = t.engagement_id
  CROSS JOIN (SELECT id FROM hsdg.services WHERE code = 'STREAM_TAX_AUDIT') ta
  LEFT JOIN hsdg.engagement_services it
         ON it.engagement_id = e.id AND it.status <> 'cancelled'
        AND it.service_id = (SELECT id FROM hsdg.services WHERE code = 'STREAM_INCOME_TAX')
 WHERE e.kind = 'compliance'
   AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_services x
                    WHERE x.engagement_id = e.id AND x.service_id = ta.id AND x.status <> 'cancelled')
 ORDER BY e.id, it.created_at;

CREATE TEMP TABLE tax_audit_moves ON COMMIT DROP AS
SELECT ci.id AS instance_id, ci.engagement_service_id AS old_line, es.id AS new_line
  FROM hsdg.compliance_instances ci
  JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id AND r.code = 'IT_TAX_AUDIT'
  JOIN hsdg.engagement_services es ON es.engagement_id = ci.engagement_id AND es.status <> 'cancelled'
  JOIN hsdg.services s ON s.id = es.service_id AND s.code = 'STREAM_TAX_AUDIT';

UPDATE hsdg.compliance_instances ci SET engagement_service_id = m.new_line
  FROM tax_audit_moves m WHERE m.instance_id = ci.id;

UPDATE hsdg.tasks t SET engagement_service_id = m.new_line
  FROM tax_audit_moves m
 WHERE t.source_compliance_instance_id = m.instance_id
   AND t.engagement_service_id IS NOT DISTINCT FROM m.old_line;

-- The audit row of every tax audit filing already on the portal.
INSERT INTO hsdg.tax_audits (engagement_id, financial_year, compliance_instance_id, stage, filed_on)
SELECT ci.engagement_id, ci.financial_year, ci.id,
       CASE ci.workflow_status WHEN 'filed' THEN 'filed'
                               WHEN 'not_applicable' THEN 'not_applicable'
                               ELSE 'not_started' END,
       CASE WHEN ci.workflow_status = 'filed'
            THEN (coalesce(ci.completed_at, ci.updated_at) AT TIME ZONE 'Asia/Kolkata')::date END
  FROM hsdg.compliance_instances ci
  JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id AND r.code = 'IT_TAX_AUDIT'
 WHERE ci.financial_year IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.tax_audits FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.registration_compliance_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entities FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.compliance_rules NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks NO FORCE ROW LEVEL SECURITY;

DROP TRIGGER compliance_instances_tax_audit_stage ON hsdg.compliance_instances;
DROP TRIGGER compliance_instances_tax_audit ON hsdg.compliance_instances;
DROP FUNCTION hsdg.tax_audit_follow_filing();
DROP FUNCTION hsdg.tax_audit_for_filing();
DROP TABLE hsdg.tax_audits;

-- The filings and their tasks go back onto Income Tax.
CREATE TEMP TABLE tax_audit_moves ON COMMIT DROP AS
SELECT ci.id AS instance_id, ci.engagement_service_id AS old_line,
       (SELECT it.id FROM hsdg.engagement_services it
          JOIN hsdg.services s ON s.id = it.service_id AND s.code = 'STREAM_INCOME_TAX'
         WHERE it.engagement_id = ci.engagement_id AND it.status <> 'cancelled'
         ORDER BY it.created_at LIMIT 1) AS new_line
  FROM hsdg.compliance_instances ci
  JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
  JOIN hsdg.services s ON s.id = es.service_id AND s.code = 'STREAM_TAX_AUDIT';
UPDATE hsdg.tasks t SET engagement_service_id = m.new_line
  FROM tax_audit_moves m
 WHERE t.source_compliance_instance_id = m.instance_id AND t.engagement_service_id = m.old_line;
UPDATE hsdg.compliance_instances ci SET engagement_service_id = m.new_line
  FROM tax_audit_moves m WHERE m.instance_id = ci.id;
-- Anything else still on a Tax Audit line drops the line reference.
UPDATE hsdg.tasks t SET engagement_service_id = NULL
  FROM hsdg.engagement_services es JOIN hsdg.services s ON s.id = es.service_id
 WHERE t.engagement_service_id = es.id AND s.code = 'STREAM_TAX_AUDIT';
DELETE FROM hsdg.engagement_services es USING hsdg.services s
 WHERE s.id = es.service_id AND s.code = 'STREAM_TAX_AUDIT';

CREATE OR REPLACE FUNCTION hsdg.sync_independence_facts(eng_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = hsdg, pg_temp
AS $$
DECLARE
  e record;
  facts jsonb := '[]'::jsonb;
BEGIN
  SELECT id, entity_id, engagement_code, kind, status, financial_year, service_id
    INTO e FROM hsdg.engagements WHERE id = eng_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF e.status NOT IN ('closed','merged','cancelled','declined','withdrawn') THEN
    IF e.kind = 'statutory_audit' THEN
      facts := jsonb_build_array(jsonb_build_object('fy', e.financial_year, 'fact', 'statutory_audit'));
    ELSIF e.kind = 'compliance' THEN
      facts := jsonb_build_array(jsonb_build_object('fy', e.financial_year, 'fact', 'compliance'))
        || COALESCE((
             SELECT jsonb_agg(jsonb_build_object('fy', y.financial_year, 'fact', s))
               FROM hsdg.compliance_engagement_years y
               CROSS JOIN LATERAL unnest(y.streams) AS s
              WHERE y.engagement_id = eng_id AND s IN ('bookkeeping','mis')
           ), '[]'::jsonb);
    ELSE
      facts := COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'fact', CASE sv.code WHEN 'INT_AUDIT' THEN 'internal_audit' ELSE 'tax_audit' END,
                      'fy', e.financial_year))
               FROM hsdg.services sv
              WHERE sv.code IN ('INT_AUDIT','TAX_AUDIT')
                AND (sv.id = e.service_id
                     OR sv.id IN (SELECT es.service_id FROM hsdg.engagement_services es
                                   WHERE es.engagement_id = eng_id AND es.status <> 'cancelled'))
           ), '[]'::jsonb);
    END IF;
  END IF;
  PERFORM hsdg.put_independence_facts(e.id, e.entity_id, e.engagement_code, facts);
END;
$$;

UPDATE hsdg.compliance_engagement_years
   SET streams = array_remove(streams, 'tax_audit'),
       stream_registrations = stream_registrations - 'tax_audit'
 WHERE 'tax_audit' = ANY (streams) OR stream_registrations ? 'tax_audit';
UPDATE hsdg.compliance_rule_versions v SET stream = 'income_tax'
  FROM hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id AND v.stream = 'tax_audit';
UPDATE hsdg.compliance_rules
   SET service_id = (SELECT id FROM hsdg.services WHERE code = 'STREAM_INCOME_TAX')
 WHERE code = 'IT_TAX_AUDIT';
UPDATE hsdg.services SET is_active = true WHERE code = 'TAX_AUDIT';
DELETE FROM hsdg.services WHERE code = 'STREAM_TAX_AUDIT';

ALTER TABLE hsdg.tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.compliance_rule_versions DROP CONSTRAINT compliance_rule_versions_stream_check;
ALTER TABLE hsdg.compliance_rule_versions ADD CONSTRAINT compliance_rule_versions_stream_check
  CHECK (stream IS NULL OR stream IN ('gst','tds','income_tax','roc','bookkeeping','mis'));
ALTER TABLE hsdg.compliance_engagement_years DROP CONSTRAINT compliance_engagement_years_streams_check;
ALTER TABLE hsdg.compliance_engagement_years ADD CONSTRAINT compliance_engagement_years_streams_check
  CHECK (streams <@ ARRAY['gst','tds','income_tax','roc','bookkeeping','mis']::text[]);
ALTER TABLE hsdg.services DROP CONSTRAINT services_stream_check;
ALTER TABLE hsdg.services ADD CONSTRAINT services_stream_check
  CHECK (stream IN ('gst','tds','income_tax','roc','bookkeeping','mis'));

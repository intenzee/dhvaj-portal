-- ─────────────────────────────────────────────────────────────────────────
-- Payroll & Labour stream (Practice Services PS-405)
--
-- PF, ESI and Professional Tax become the eighth stream on a Compliance
-- engagement. Until now they were the old catalogue services PAYROLL and
-- LABOUR_COMPLIANCE with loose components, and calendar rules (PF_MONTHLY,
-- ESI_MONTHLY, PT_MONTHLY, LABOUR_RETURNS_QTR) that were retired before any
-- filing was made from them.
--
--   · The stream lists (services, compliance years, rule versions) take
--     'payroll', rule versions may run on a PF, ESIC or PT registration, and
--     the live service STREAM_PAYROLL is added. Its rules and checklist are in
--     1773999100000_payroll_stream_rules.sql (generated).
--   · The two old services are retired for new engagements. A Compliance
--     engagement holds only stream services, so none carries them and there
--     is nothing to move: engagements of other kinds on them stay as they are.
--     The firm adds the stream to a year from the engagement's Services tab.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.services DROP CONSTRAINT services_stream_check;
ALTER TABLE hsdg.services ADD CONSTRAINT services_stream_check
  CHECK (stream IN ('gst','tds','payroll','income_tax','tax_audit','roc','bookkeeping','mis'));
ALTER TABLE hsdg.compliance_engagement_years DROP CONSTRAINT compliance_engagement_years_streams_check;
ALTER TABLE hsdg.compliance_engagement_years ADD CONSTRAINT compliance_engagement_years_streams_check
  CHECK (streams <@ ARRAY['gst','tds','payroll','income_tax','tax_audit','roc','bookkeeping','mis']::text[]);
ALTER TABLE hsdg.compliance_rule_versions DROP CONSTRAINT compliance_rule_versions_stream_check;
ALTER TABLE hsdg.compliance_rule_versions ADD CONSTRAINT compliance_rule_versions_stream_check
  CHECK (stream IS NULL OR stream IN ('gst','tds','payroll','income_tax','tax_audit','roc','bookkeeping','mis'));
ALTER TABLE hsdg.compliance_rule_versions DROP CONSTRAINT compliance_rule_versions_registration_scope_check;
ALTER TABLE hsdg.compliance_rule_versions ADD CONSTRAINT compliance_rule_versions_registration_scope_check
  CHECK (registration_scope IS NULL OR registration_scope IN
    ('gstin','tan','pan','cin','llpin','entity','din','pf','esic','pt'));

ALTER TABLE hsdg.services NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.services
  (service_line_id, code, name, description, required_review_model_id, workflow_family_id,
   default_recurrence, stream)
SELECT service_line_id, 'STREAM_PAYROLL', 'Payroll & Labour',
       'PF ECR, ESI contributions and returns, and Professional Tax: the month''s challans and the periodic returns, on the client''s PF, ESIC and PT registrations.',
       required_review_model_id, workflow_family_id, default_recurrence, 'payroll'
  FROM hsdg.services WHERE code = 'STREAM_TDS';

UPDATE hsdg.services SET is_active = false, updated_at = now()
 WHERE code IN ('PAYROLL', 'LABOUR_COMPLIANCE');

ALTER TABLE hsdg.services FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.compliance_engagement_years NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.tasks t SET engagement_service_id = NULL
  FROM hsdg.engagement_services es JOIN hsdg.services s ON s.id = es.service_id
 WHERE t.engagement_service_id = es.id AND s.code = 'STREAM_PAYROLL';
UPDATE hsdg.compliance_instances ci SET engagement_service_id = NULL
  FROM hsdg.engagement_services es JOIN hsdg.services s ON s.id = es.service_id
 WHERE ci.engagement_service_id = es.id AND s.code = 'STREAM_PAYROLL';
DELETE FROM hsdg.engagement_services es USING hsdg.services s
 WHERE s.id = es.service_id AND s.code = 'STREAM_PAYROLL';
-- An engagement whose primary service was the stream takes another of its
-- lines (or TDS, the stream it was modelled on).
UPDATE hsdg.engagements e
   SET service_id = coalesce(
         (SELECT es.service_id FROM hsdg.engagement_services es
           WHERE es.engagement_id = e.id AND es.status <> 'cancelled'
           ORDER BY es.is_primary DESC, es.created_at LIMIT 1),
         (SELECT id FROM hsdg.services WHERE code = 'STREAM_TDS'))
 WHERE e.service_id = (SELECT id FROM hsdg.services WHERE code = 'STREAM_PAYROLL');

UPDATE hsdg.compliance_engagement_years
   SET streams = array_remove(streams, 'payroll'),
       stream_registrations = stream_registrations - 'payroll'
 WHERE 'payroll' = ANY (streams) OR stream_registrations ? 'payroll';

UPDATE hsdg.services SET is_active = true WHERE code IN ('PAYROLL', 'LABOUR_COMPLIANCE');
DELETE FROM hsdg.services WHERE code = 'STREAM_PAYROLL';

ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.compliance_rule_versions DROP CONSTRAINT compliance_rule_versions_registration_scope_check;
ALTER TABLE hsdg.compliance_rule_versions ADD CONSTRAINT compliance_rule_versions_registration_scope_check
  CHECK (registration_scope IS NULL OR registration_scope IN
    ('gstin','tan','pan','cin','llpin','entity','din'));
ALTER TABLE hsdg.compliance_rule_versions DROP CONSTRAINT compliance_rule_versions_stream_check;
ALTER TABLE hsdg.compliance_rule_versions ADD CONSTRAINT compliance_rule_versions_stream_check
  CHECK (stream IS NULL OR stream IN ('gst','tds','income_tax','tax_audit','roc','bookkeeping','mis'));
ALTER TABLE hsdg.compliance_engagement_years DROP CONSTRAINT compliance_engagement_years_streams_check;
ALTER TABLE hsdg.compliance_engagement_years ADD CONSTRAINT compliance_engagement_years_streams_check
  CHECK (streams <@ ARRAY['gst','tds','income_tax','tax_audit','roc','bookkeeping','mis']::text[]);
ALTER TABLE hsdg.services DROP CONSTRAINT services_stream_check;
ALTER TABLE hsdg.services ADD CONSTRAINT services_stream_check
  CHECK (stream IN ('gst','tds','income_tax','tax_audit','roc','bookkeeping','mis'));

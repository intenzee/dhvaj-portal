-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.6 Consolidation & Group Audit Framework — Track A (DHVAJ Section 02.6
-- spec §9–§11, §22; docs/02-6-consolidation-build-split.md).
--
--   • Rules Library: CFS-03 reporting-date gap — the maximum months between a
--     component's and the group's reporting date, keyed by the governing
--     standard as entity_class. AS 21 (para 20) allows six months and AS 23 /
--     AS 27 apply the same limit; Ind AS 110 (B93) and Ind AS 28 (para 34)
--     allow three. Values live in the library, never in code; an amendment is
--     a new dated version.
--   • hsdg.audit_consolidation_conversion — one CFS-04 conversion work item
--     per perimeter component whose local framework or accounting policies
--     differ from the group's. The component's statutory accounts are never
--     altered: the conversion is a separate layer (differences, reporting
--     package, final adjusted group TB, reviewer). A component that leaves
--     the perimeter WITHDRAWS its item, never deletes it.
--
-- audit_rule / audit_rule_version / authority_provision are FORCE RLS firm-wide tables: lift FORCE
-- for the migrator and restore it after. The conversion table is engagement
-- child data: members SELECT, only leads INSERT / UPDATE.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('CFS_REPORTING_DATE_GAP_AS21',     'cfs', 'as_21',      'reporting_date_gap_months', '<=', 'date', 'balance_sheet_date'),
  ('CFS_REPORTING_DATE_GAP_AS23',     'cfs', 'as_23',      'reporting_date_gap_months', '<=', 'date', 'balance_sheet_date'),
  ('CFS_REPORTING_DATE_GAP_AS27',     'cfs', 'as_27',      'reporting_date_gap_months', '<=', 'date', 'balance_sheet_date'),
  ('CFS_REPORTING_DATE_GAP_INDAS110', 'cfs', 'ind_as_110', 'reporting_date_gap_months', '<=', 'date', 'balance_sheet_date'),
  ('CFS_REPORTING_DATE_GAP_INDAS28',  'cfs', 'ind_as_28',  'reporting_date_gap_months', '<=', 'date', 'balance_sheet_date')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome,
   authority_provision_id, guidance_reference)
SELECT r.id, 1, v.effective_from::date, NULL, v.threshold, 'reporting_date_within_limit', p.id, v.guidance
  FROM (VALUES
    ('CFS_REPORTING_DATE_GAP_AS21', 6::numeric, '2014-04-01', 'AS_21',
     'AS 21 para 20 — financial statements drawn up to a different reporting date may be used if the difference is not more than six months, adjusted for significant intervening transactions'),
    ('CFS_REPORTING_DATE_GAP_AS23', 6::numeric, '2014-04-01', 'AS_23',
     'AS 23 para 21 — the associate''s statements to a different date may be used, adjusted for significant intervening transactions; the AS 21 six-month limit applies'),
    ('CFS_REPORTING_DATE_GAP_AS27', 6::numeric, '2014-04-01', 'AS_27',
     'AS 27 — proportionate consolidation follows the AS 21 procedures, including the six-month reporting-date limit'),
    ('CFS_REPORTING_DATE_GAP_INDAS110', 3::numeric, '2015-04-01', 'INDAS_110',
     'Ind AS 110 B93 — the difference between the subsidiary''s and the parent''s reporting dates shall be no more than three months'),
    ('CFS_REPORTING_DATE_GAP_INDAS28', 3::numeric, '2015-04-01', 'INDAS_28',
     'Ind AS 28 para 34 — the difference between the reporting dates of the investee and the investor shall be no more than three months')
  ) AS v(rule_code, threshold, effective_from, provision_code, guidance)
  JOIN hsdg.audit_rule r ON r.code = v.rule_code
  LEFT JOIN hsdg.authority_provision p ON p.code = v.provision_code AND p.effective_to IS NULL
ON CONFLICT (audit_rule_id, version) DO NOTHING;

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

CREATE TABLE hsdg.audit_consolidation_conversion (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id          uuid NOT NULL
                                  REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id                 uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- The stable 02.6 perimeter component id (system_detail.perimeter[].id).
  component_id                  text NOT NULL CHECK (length(trim(component_id)) > 0),
  component_name                text NOT NULL CHECK (length(trim(component_name)) > 0),
  local_framework               text CHECK (local_framework IS NULL OR local_framework IN
                                  ('ind_as','as','ifrs','local_gaap','other')),
  group_framework               text CHECK (group_framework IS NULL OR group_framework IN
                                  ('ind_as','as','ifrs','local_gaap','other')),
  status                        text NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open','in_review','completed','withdrawn')),
  -- [{ area, description, adjustmentReference, amount }]
  differences                   jsonb NOT NULL DEFAULT '[]'::jsonb
                                  CHECK (jsonb_typeof(differences) = 'array'),
  reviewer_employee_id          uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reporting_package_document_id uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  adjusted_tb_document_id       uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  reviewed_at                   timestamptz,
  withdrawn_at                  timestamptz,
  version                       integer NOT NULL DEFAULT 1,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_consolidation_conversion_key UNIQUE (workflow_instance_id, component_id),
  -- A completed conversion names its reviewer and the final adjusted group TB.
  CONSTRAINT audit_consolidation_conversion_completed CHECK (
    status <> 'completed'
    OR (reviewer_employee_id IS NOT NULL AND adjusted_tb_document_id IS NOT NULL)
  )
);
CREATE INDEX audit_consolidation_conversion_engagement_idx
  ON hsdg.audit_consolidation_conversion (engagement_id);
CREATE TRIGGER audit_consolidation_conversion_set_updated_at
  BEFORE UPDATE ON hsdg.audit_consolidation_conversion
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

REVOKE DELETE ON hsdg.audit_consolidation_conversion FROM hsdg_app;
ALTER TABLE hsdg.audit_consolidation_conversion ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_consolidation_conversion_select ON hsdg.audit_consolidation_conversion
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_consolidation_conversion_insert ON hsdg.audit_consolidation_conversion
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_consolidation_conversion_update ON hsdg.audit_consolidation_conversion
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration
DROP TABLE IF EXISTS hsdg.audit_consolidation_conversion CASCADE;

ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.audit_rule
 WHERE code IN ('CFS_REPORTING_DATE_GAP_AS21','CFS_REPORTING_DATE_GAP_AS23','CFS_REPORTING_DATE_GAP_AS27',
                'CFS_REPORTING_DATE_GAP_INDAS110','CFS_REPORTING_DATE_GAP_INDAS28');
ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;

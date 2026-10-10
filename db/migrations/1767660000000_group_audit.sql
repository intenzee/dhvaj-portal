-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.6 Part B — Group / Component / Branch Auditor Framework (DHVAJ Section
-- 02.6 spec §12–§17, §19, §20; build split Track B).
--
--   • hsdg.consolidation_work_library — the versioned DHVAJ consolidation work
--     programme (§19, 15 items), each with when it applies (always /
--     subsidiaries / associates & JVs / foreign components / GAAP conversion /
--     other auditors). Effective-dated per row — nothing in code.
--   • hsdg.audit_group_audit — one per statutory-audit workflow: GA-01 for the
--     group (§13), BR-01 (§17) and the work-programme state (§19).
--   • hsdg.audit_group_component — the component / other-auditor matrix (§12):
--     ONE row per 02.6 perimeter component, keyed on the stable component id
--     (never a second group master), with GA-02..GA-04 for another auditor and
--     last year's auditor for the roll-forward (§21). A component that leaves
--     the perimeter is withdrawn, never deleted.
--   • hsdg.audit_group_branch — section 143(8) branch auditor records (§17).
--   • hsdg.audit_group_package — the 10-document reporting-package checklist
--     per component (§15): status and approval.
--   • hsdg.audit_group_file — every SharePoint-backed file in the framework
--     (component report, completion memo, generated instructions, package
--     documents, branch report / instructions). Approved package evidence is
--     superseded with a reason, never silently replaced.
--   • hsdg.audit_group_finding — the other-auditor findings register (§16).
--   • hsdg.audit_group_work_item — the frozen work programme, linked to the
--     Section 06 procedure each item generated.
--   • document_templates gains 'consolidation_group_audit_memo' (the 02.6 memo)
--     and 'component_auditor_instructions' (§14).
--
-- Library: every signed-in role reads; only firm-wide roles write. Engagement
-- child data: members SELECT, only leads INSERT / UPDATE. Nothing is ever
-- hard-deleted by the app.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE hsdg.consolidation_work_library (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_code       text NOT NULL CHECK (framework_code ~ '^[A-Z0-9_]{2,60}$'),
  framework_label      text NOT NULL CHECK (length(trim(framework_label)) > 0),
  item_key             text NOT NULL CHECK (item_key ~ '^[a-z0-9_]{2,40}$'),
  title                text NOT NULL CHECK (length(trim(title)) > 0),
  objective            text NOT NULL CHECK (length(trim(objective)) > 0),
  evidence             text NOT NULL CHECK (length(trim(evidence)) > 0),
  activation           text NOT NULL CHECK (activation IN
                         ('always','subsidiary','associate_jv','foreign','conversion','other_auditor')),
  sort_order           integer NOT NULL DEFAULT 0,
  effective_from       date NOT NULL,
  effective_to         date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consolidation_work_library_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT consolidation_work_library_key UNIQUE (item_key, effective_from)
);
ALTER TABLE hsdg.consolidation_work_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY consolidation_work_library_read ON hsdg.consolidation_work_library
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY consolidation_work_library_write ON hsdg.consolidation_work_library
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

INSERT INTO hsdg.consolidation_work_library
  (framework_code, framework_label, item_key, title, objective, evidence, activation, sort_order, effective_from)
SELECT 'DHVAJ_CFS', 'DHVAJ consolidation work programme v1', s.item_key, s.title, s.objective,
       s.evidence, s.activation, s.sort_order, DATE '2014-04-01'
  FROM (VALUES
  ('mapping_perimeter', 'Consolidation mapping and perimeter',
   'Agree the consolidation perimeter to the approved 02.6 conclusion (subsidiaries, associates, joint ventures, inclusion / exclusion and method) and map each component''s trial balance or reporting package to the group chart of accounts.',
   'Approved 02.6 perimeter; group structure chart; component mapping workings.', 'always', 10),
  ('uniform_policies', 'Uniform accounting policies',
   'Confirm that like transactions and events are accounted for using uniform accounting policies across the group, or that adjustments are made where a component uses different policies (or the impracticability is disclosed where AS permits).',
   'Group accounting manual; component policy questionnaires; policy-alignment adjustments.', 'always', 20),
  ('gaap_conversion', 'GAAP conversion',
   'Review the conversion of components reporting under a different local framework into the group framework (Ind AS / AS): the GAAP and policy differences identified, the conversion adjustments, and the reviewer''s sign-off — the component statutory accounts are not altered.',
   'CFS-04 conversion items; GAAP difference list; conversion adjustment workpapers.', 'conversion', 30),
  ('intercompany', 'Inter-company balances and transactions',
   'Reconcile and eliminate inter-company balances and transactions in full; investigate and resolve mismatches using the component confirmations.',
   'Inter-company matrix; component confirmations; elimination entries and mismatch log.', 'always', 40),
  ('unrealised_profit', 'Unrealised profit / loss elimination',
   'Identify unrealised profits and losses on intra-group transfers of inventory, assets and services and test their elimination (unrealised losses only where cost is recoverable).',
   'Intra-group stock / asset transfer analysis; unrealised profit computation.', 'always', 50),
  ('investment_elimination', 'Investment elimination',
   'Test the elimination of the parent''s investment in each subsidiary against its share of equity at the date of acquisition (and subsequent changes in holding).',
   'Investment schedules; acquisition-date equity; elimination workings.', 'subsidiary', 60),
  ('goodwill_capital_reserve', 'Goodwill / capital reserve',
   'Recompute goodwill or capital reserve on acquisition (and on step acquisitions or changes in stake) and evaluate goodwill for impairment under the applicable framework.',
   'Acquisition workings; purchase price allocation (Ind AS); impairment assessment.', 'subsidiary', 70),
  ('nci', 'Non-controlling interests',
   'Test the non-controlling interests'' share of net assets and of profit or loss, including losses in excess of the NCI''s interest and changes in ownership without loss of control.',
   'NCI computation; shareholding records; equity movement workings.', 'subsidiary', 80),
  ('associate_jv', 'Associate / JV accounting',
   'Test the equity method (or the method the framework requires) for associates and joint ventures: share of results and other comprehensive income, elimination of unrealised profits, impairment and the carrying amount.',
   'Associate / JV financial information; equity-method workings; impairment indicators.', 'associate_jv', 90),
  ('foreign_operations', 'Foreign operations / translation',
   'Test the translation of foreign components into the presentation currency (rates used, translation reserve / FCTR, net investment and recycling on disposal).',
   'Exchange-rate evidence; translation workings; FCTR movement.', 'foreign', 100),
  ('consolidation_adjustments', 'Consolidation adjustments',
   'Obtain the consolidation adjustments journal, test each adjustment to support and confirm that adjustments made at group level are complete and authorised.',
   'Consolidation adjustments register with support and approval.', 'always', 110),
  ('cfs_disclosures', 'CFS disclosures',
   'Check the consolidated financial statements against Schedule III (consolidation additional information), the applicable consolidation standards and the disclosure checklist.',
   'CFS disclosure checklist; Schedule III additional-information schedule.', 'always', 120),
  ('aoc_1', 'AOC-1 information',
   'Agree the Form AOC-1 statement of salient features of subsidiaries, associates and joint ventures (first proviso to section 129(3)) to the component financial information.',
   'Form AOC-1; component financial statements.', 'always', 130),
  ('component_auditor_reports', 'Component auditor reports / findings',
   'Evaluate the reports, completion communications and findings of the other auditors under SA 600, record their group impact and conclude on the reliance placed on their work.',
   'Component reporting packages; other-auditor findings register; SA 600 assessment.', 'other_auditor', 140),
  ('final_analytics', 'Final CFS analytical review',
   'Perform a final analytical review of the consolidated financial statements to confirm they are consistent with our understanding of the group and that significant movements are explained.',
   'Final CFS analytics with explanations.', 'always', 150)
  ) AS s(item_key, title, objective, evidence, activation, sort_order);

CREATE TABLE hsdg.audit_group_audit (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id      uuid NOT NULL UNIQUE
                              REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id             uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- GA-01 (SA 600): DHVAJ's participation sufficient to act as principal auditor.
  ga01                      text CHECK (ga01 IS NULL OR ga01 IN ('yes','further_assessment')),
  ga01_basis                text,
  ga01_source               text CHECK (ga01_source IS NULL OR ga01_source IN ('system','team')),
  ga01_by_employee_id       uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ga01_at                   timestamptz,
  -- BR-01 (§17): 'system' while it follows the master (branches on master).
  br01                      text NOT NULL DEFAULT 'pending' CHECK (br01 IN ('yes','no','pending')),
  br01_source               text NOT NULL DEFAULT 'system' CHECK (br01_source IN ('system','team')),
  br01_basis                text,
  -- §19 work programme.
  work_status               text NOT NULL DEFAULT 'none' CHECK (work_status IN ('none','active','withdrawn')),
  work_framework_code       text,
  work_framework_label      text,
  work_generated_at         timestamptz,
  work_withdrawn_at         timestamptz,
  version                   integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  -- A team "Yes" needs the documented significance / involvement.
  CONSTRAINT audit_group_audit_ga01_basis CHECK (
    ga01 IS NULL OR ga01_source = 'system'
    OR (ga01_basis IS NOT NULL AND length(trim(ga01_basis)) > 0)
  )
);
CREATE INDEX audit_group_audit_engagement_idx ON hsdg.audit_group_audit (engagement_id);
CREATE TRIGGER audit_group_audit_set_updated_at
  BEFORE UPDATE ON hsdg.audit_group_audit
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_group_component (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_audit_id         uuid NOT NULL REFERENCES hsdg.audit_group_audit (id) ON DELETE CASCADE,
  workflow_instance_id   uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- The stable 02.6 perimeter component id (roll-forward keeps it).
  component_id           text NOT NULL CHECK (length(trim(component_id)) > 0),
  -- Perimeter snapshot, refreshed on every sync.
  component_name         text NOT NULL CHECK (length(trim(component_name)) > 0),
  relationship           text NOT NULL,
  method                 text NOT NULL,
  included               text NOT NULL DEFAULT 'yes' CHECK (included IN ('yes','no','pending')),
  country                text,
  is_indian_company      boolean,
  -- §12 matrix.
  auditor_type           text NOT NULL DEFAULT 'tbd'
                           CHECK (auditor_type IN ('dhvaj','other_auditor','unaudited_special_purpose','none','tbd')),
  auditor_source         text NOT NULL DEFAULT 'system' CHECK (auditor_source IN ('system','prior_year','team')),
  firm_name              text,
  frn                    text,
  professional_body      text,
  auditor_country        text,
  partner_contact        text,
  period_from            date,
  period_to              date,
  report_type            text CHECK (report_type IS NULL OR report_type IN
                           ('unmodified','unmodified_emphasis','qualified','adverse','disclaimer',
                            'review_report','special_purpose','not_issued')),
  report_date            date,
  reporting_deadline     date,
  sa600                  text NOT NULL DEFAULT 'pending' CHECK (sa600 IN ('required','not_applicable','pending')),
  sa600_source           text NOT NULL DEFAULT 'system' CHECK (sa600_source IN ('system','team')),
  significance           text NOT NULL DEFAULT 'pending'
                           CHECK (significance IN ('significant','not_significant','pending')),
  significance_note      text,
  -- §13 SA 600 per other auditor.
  ga02                   text NOT NULL DEFAULT 'pending' CHECK (ga02 IN ('yes','no','not_applicable','pending')),
  ga02_basis             text,
  ga03                   text NOT NULL DEFAULT 'pending' CHECK (ga03 IN ('yes','no','pending')),
  ga03_note              text,
  ga04                   text NOT NULL DEFAULT 'pending' CHECK (ga04 IN ('yes','no','pending')),
  ga04_basis             text,
  -- §21 last year's matrix value.
  prior_auditor_type     text,
  prior_firm_name        text,
  prior_report_type      text,
  sort_order             integer NOT NULL DEFAULT 0,
  withdrawn_at           timestamptz,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_group_component_key UNIQUE (group_audit_id, component_id),
  CONSTRAINT audit_group_component_period CHECK (
    period_from IS NULL OR period_to IS NULL OR period_to >= period_from
  ),
  -- GA-02 Yes / No records its basis (SA 600 competence consideration).
  CONSTRAINT audit_group_component_ga02_basis CHECK (
    ga02 NOT IN ('yes','no') OR (ga02_basis IS NOT NULL AND length(trim(ga02_basis)) > 0)
  ),
  CONSTRAINT audit_group_component_ga04_basis CHECK (
    ga04 NOT IN ('yes','no') OR (ga04_basis IS NOT NULL AND length(trim(ga04_basis)) > 0)
  )
);
CREATE INDEX audit_group_component_instance_idx ON hsdg.audit_group_component (workflow_instance_id);
CREATE INDEX audit_group_component_engagement_idx ON hsdg.audit_group_component (engagement_id);
CREATE TRIGGER audit_group_component_set_updated_at
  BEFORE UPDATE ON hsdg.audit_group_component
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_group_branch (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_audit_id         uuid NOT NULL REFERENCES hsdg.audit_group_audit (id) ON DELETE CASCADE,
  workflow_instance_id   uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  branch_name            text NOT NULL CHECK (length(trim(branch_name)) > 0),
  location               text,
  country                text,
  firm_name              text,
  frn                    text,
  partner_contact        text,
  appointment_basis      text CHECK (appointment_basis IS NULL OR appointment_basis IN
                           ('section_139_general_meeting','board_authorised','foreign_branch_local_law','other')),
  appointment_note       text,
  period_from            date,
  period_to              date,
  significance           text NOT NULL DEFAULT 'pending'
                           CHECK (significance IN ('significant','not_significant','pending')),
  ga02                   text NOT NULL DEFAULT 'pending' CHECK (ga02 IN ('yes','no','not_applicable','pending')),
  ga02_basis             text,
  ga03                   text NOT NULL DEFAULT 'pending' CHECK (ga03 IN ('yes','no','pending')),
  ga03_note              text,
  ga04                   text NOT NULL DEFAULT 'pending' CHECK (ga04 IN ('yes','no','pending')),
  ga04_basis             text,
  principal_response     text,
  conclusion             text NOT NULL DEFAULT 'pending'
                           CHECK (conclusion IN ('pending','relied','relied_with_procedures','not_relied')),
  -- §21: carried from last year's branch record.
  prior_branch_id        uuid,
  sort_order             integer NOT NULL DEFAULT 0,
  withdrawn_at           timestamptz,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_group_branch_period CHECK (
    period_from IS NULL OR period_to IS NULL OR period_to >= period_from
  ),
  CONSTRAINT audit_group_branch_ga02_basis CHECK (
    ga02 NOT IN ('yes','no') OR (ga02_basis IS NOT NULL AND length(trim(ga02_basis)) > 0)
  ),
  CONSTRAINT audit_group_branch_ga04_basis CHECK (
    ga04 NOT IN ('yes','no') OR (ga04_basis IS NOT NULL AND length(trim(ga04_basis)) > 0)
  ),
  -- A conclusion on the branch report records the principal auditor's response.
  CONSTRAINT audit_group_branch_response CHECK (
    conclusion = 'pending'
    OR (principal_response IS NOT NULL AND length(trim(principal_response)) > 0)
  )
);
CREATE INDEX audit_group_branch_instance_idx ON hsdg.audit_group_branch (workflow_instance_id);
CREATE INDEX audit_group_branch_engagement_idx ON hsdg.audit_group_branch (engagement_id);
CREATE UNIQUE INDEX audit_group_branch_prior_key
  ON hsdg.audit_group_branch (group_audit_id, prior_branch_id) WHERE prior_branch_id IS NOT NULL;
CREATE TRIGGER audit_group_branch_set_updated_at
  BEFORE UPDATE ON hsdg.audit_group_branch
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_group_package (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_row_id       uuid NOT NULL REFERENCES hsdg.audit_group_component (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  package_key            text NOT NULL CHECK (package_key IN
                           ('component_tb','financial_statements','audit_report','completion_memo',
                            'misstatement_summary','related_party','intercompany_confirmation',
                            'icfr_report','caro_report','other_findings')),
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','received','approved','not_applicable')),
  note                   text,
  approved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  approved_at            timestamptz,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_group_package_key UNIQUE (component_row_id, package_key),
  CONSTRAINT audit_group_package_approved CHECK (
    status <> 'approved' OR approved_at IS NOT NULL
  )
);
CREATE INDEX audit_group_package_engagement_idx ON hsdg.audit_group_package (engagement_id);
CREATE TRIGGER audit_group_package_set_updated_at
  BEFORE UPDATE ON hsdg.audit_group_package
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_group_file (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  slot                     text NOT NULL CHECK (slot IN
                             ('report','completion_memo','instructions','package',
                              'branch_report','branch_instructions')),
  component_row_id         uuid REFERENCES hsdg.audit_group_component (id) ON DELETE CASCADE,
  branch_id                uuid REFERENCES hsdg.audit_group_branch (id) ON DELETE CASCADE,
  package_key              text,
  document_id              uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  how                      text NOT NULL CHECK (how IN ('added','linked','generated')),
  -- Generated from a template: the exact version (instructions, §14).
  template_version_id      uuid REFERENCES hsdg.document_template_versions (id) ON DELETE RESTRICT,
  template_key             text,
  template_variant_key     text,
  template_version_no      integer,
  linked_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  linked_at                timestamptz NOT NULL DEFAULT now(),
  -- Replaced: kept with who / why (approved evidence is never silently replaced).
  superseded_at            timestamptz,
  superseded_reason        text,
  superseded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_group_file_owner CHECK (
    (component_row_id IS NULL) <> (branch_id IS NULL)
  ),
  CONSTRAINT audit_group_file_slot_owner CHECK (
    (slot IN ('branch_report','branch_instructions')) = (branch_id IS NOT NULL)
  ),
  CONSTRAINT audit_group_file_package CHECK ((slot = 'package') = (package_key IS NOT NULL))
);
CREATE INDEX audit_group_file_instance_idx ON hsdg.audit_group_file (workflow_instance_id);
CREATE INDEX audit_group_file_engagement_idx ON hsdg.audit_group_file (engagement_id);
-- One live file per slot.
CREATE UNIQUE INDEX audit_group_file_live_unique
  ON hsdg.audit_group_file (COALESCE(component_row_id, branch_id), slot, COALESCE(package_key, ''))
  WHERE superseded_at IS NULL;

CREATE TABLE hsdg.audit_group_finding (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                      integer NOT NULL CHECK (seq >= 1),
  component_row_id         uuid REFERENCES hsdg.audit_group_component (id) ON DELETE CASCADE,
  branch_id                uuid REFERENCES hsdg.audit_group_branch (id) ON DELETE CASCADE,
  category                 text NOT NULL CHECK (category IN
                             ('no_significant_matter','modified_opinion','emphasis_other_matter',
                              'material_misstatement','going_concern','control_deficiency','fraud',
                              'other_significant')),
  impacts                  text[] NOT NULL DEFAULT '{}',
  description              text NOT NULL CHECK (length(trim(description)) > 0),
  icfr_cross_ref           text,
  escalated                boolean NOT NULL DEFAULT false,
  reporting_consideration  boolean NOT NULL DEFAULT false,
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  response                 text,
  resolved_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  resolved_at              timestamptz,
  -- §21: last year's unresolved finding carried as a current-year follow-up.
  prior_finding_id         uuid,
  prior_ref                text,
  created_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  withdrawn_at             timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_group_finding_seq UNIQUE (workflow_instance_id, seq),
  CONSTRAINT audit_group_finding_subject CHECK ((component_row_id IS NULL) <> (branch_id IS NULL)),
  CONSTRAINT audit_group_finding_resolved CHECK (
    status = 'open' OR (response IS NOT NULL AND length(trim(response)) > 0)
  ),
  -- Fraud is always escalated to the Engagement Partner (spec §16).
  CONSTRAINT audit_group_finding_fraud CHECK (category <> 'fraud' OR escalated)
);
CREATE INDEX audit_group_finding_engagement_idx ON hsdg.audit_group_finding (engagement_id);
CREATE UNIQUE INDEX audit_group_finding_prior_key
  ON hsdg.audit_group_finding (workflow_instance_id, prior_finding_id) WHERE prior_finding_id IS NOT NULL;
CREATE TRIGGER audit_group_finding_set_updated_at
  BEFORE UPDATE ON hsdg.audit_group_finding
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_group_work_item (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_audit_id         uuid NOT NULL REFERENCES hsdg.audit_group_audit (id) ON DELETE CASCADE,
  workflow_instance_id   uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  library_item_id        uuid,
  item_key               text NOT NULL CHECK (item_key ~ '^[a-z0-9_]{2,40}$'),
  title                  text NOT NULL,
  objective              text NOT NULL,
  evidence               text NOT NULL,
  activation             text NOT NULL,
  applicable             boolean NOT NULL DEFAULT true,
  basis                  text NOT NULL DEFAULT '',
  procedure_id           uuid REFERENCES hsdg.audit_procedures (id) ON DELETE SET NULL,
  sort_order             integer NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_group_work_item_key UNIQUE (group_audit_id, item_key)
);
CREATE INDEX audit_group_work_item_engagement_idx ON hsdg.audit_group_work_item (engagement_id);
CREATE TRIGGER audit_group_work_item_set_updated_at
  BEFORE UPDATE ON hsdg.audit_group_work_item
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (engagement child data) ─────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_group_audit','audit_group_component','audit_group_branch',
                           'audit_group_package','audit_group_file','audit_group_finding',
                           'audit_group_work_item']
  LOOP
    EXECUTE format('REVOKE DELETE ON hsdg.%I FROM hsdg_app', t);
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.is_engagement_member(engagement_id))',
                   t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))',
                   t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) '
                   'WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
  END LOOP;
END $$;

-- ── 02.6 memo and Component Auditor Instructions templates ─────────────────
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo',
    'schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii',
    'caro_applicability_memo','icfr_applicability_memo',
    'consolidation_group_audit_memo','component_auditor_instructions'));

INSERT INTO hsdg.document_templates (template_key, variant_key, title) VALUES
  ('consolidation_group_audit_memo', 'standard', 'Consolidation & Group Audit Memo'),
  ('component_auditor_instructions', 'standard', 'Component Auditor Instructions')
ON CONFLICT (template_key, variant_key) DO NOTHING;

-- Down Migration
DROP TABLE IF EXISTS hsdg.audit_group_work_item CASCADE;
DROP TABLE IF EXISTS hsdg.audit_group_finding CASCADE;
DROP TABLE IF EXISTS hsdg.audit_group_file CASCADE;
DROP TABLE IF EXISTS hsdg.audit_group_package CASCADE;
DROP TABLE IF EXISTS hsdg.audit_group_branch CASCADE;
DROP TABLE IF EXISTS hsdg.audit_group_component CASCADE;
DROP TABLE IF EXISTS hsdg.audit_group_audit CASCADE;
DROP TABLE IF EXISTS hsdg.consolidation_work_library CASCADE;

-- A 02.6 memo linked to a sub-assessment pins its template version (RESTRICT).
DELETE FROM hsdg.audit_framework_files
 WHERE template_key IN ('consolidation_group_audit_memo','component_auditor_instructions');
DELETE FROM hsdg.document_template_versions v
 USING hsdg.document_templates t
 WHERE v.template_id = t.id
   AND t.template_key IN ('consolidation_group_audit_memo','component_auditor_instructions');
DELETE FROM hsdg.document_templates
 WHERE template_key IN ('consolidation_group_audit_memo','component_auditor_instructions');
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo',
    'schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii',
    'caro_applicability_memo','icfr_applicability_memo'));

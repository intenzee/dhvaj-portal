-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.5 Internal Financial Controls / ICFR — the Section 05 ICFR workstream,
-- the integrated control record, the deficiency register, the consolidated
-- ICFR reporting consideration, prior-year follow-up and the ICFR
-- Applicability Memo template (DHVAJ Section 02.5 spec §13–§17, §19, §20, §22;
-- build split Track B).
--
--   • hsdg.icfr_process_area_library — the versioned DHVAJ ICFR process-area
--     framework (§13): Entity-Level Controls and Financial Close & Reporting
--     always; Revenue, Purchases, Inventory, PPE, Payroll, Treasury, Taxation
--     fact/risk-driven (03.5 audit-area codes / Section 04 risk keywords); IT
--     General Controls IT-dependency-driven; Other Significant Processes added
--     by scoping. Each area carries its methodology procedures. Effective-dated
--     per row — nothing in code.
--   • hsdg.audit_icfr_workstream — one per statutory-audit workflow, created on
--     read once 02.5 concludes section 143(3)(i) reporting applies; it freezes
--     the framework version. A later Exempt conclusion WITHDRAWS it (never
--     deletes); normal Section 05 control work is not part of it and stays.
--   • hsdg.audit_icfr_process_area — the frozen areas with their scoping (in
--     scope / not in scope / to be scoped), the system's suggestion and basis,
--     and the team's decision (a team decision is never overwritten).
--   • hsdg.audit_icfr_control — ONE control record serving the financial-
--     statement audit, ICFR, or both (§14), with design, implementation and
--     operating effectiveness kept as separate conclusions (§15), and review.
--   • hsdg.audit_icfr_control_evidence — documents / Section 06 evidence linked
--     to a control (link once, reuse across controls — never a second upload).
--   • hsdg.audit_icfr_deficiency — the deficiency register (§16): Control
--     Deficiency / Significant Deficiency / Material Weakness, Manager review
--     and Partner conclusion; feeds Section 07 / 08 (§22).
--   • hsdg.audit_icfr_followup — prior-year material weaknesses, significant
--     deficiencies and unresolved remediation brought forward as current-year
--     follow-up considerations (§19) — never as current-year effectiveness.
--   • hsdg.audit_icfr_consolidated + hsdg.audit_icfr_component — the
--     Consolidated ICFR Reporting Consideration (§17), components from the
--     02.6 perimeter plus manual ones.
--   • document_templates gains 'icfr_applicability_memo'.
--
-- Library: every signed-in role reads; only firm-wide roles write. Engagement
-- child data: members SELECT, only leads INSERT / UPDATE. Nothing is ever
-- hard-deleted by the app.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE hsdg.icfr_process_area_library (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_code       text NOT NULL CHECK (framework_code ~ '^[A-Z0-9_]{2,60}$'),
  framework_label      text NOT NULL CHECK (length(trim(framework_label)) > 0),
  area_key             text NOT NULL CHECK (area_key ~ '^[a-z0-9_]{2,40}$'),
  title                text NOT NULL CHECK (length(trim(title)) > 0),
  description          text NOT NULL CHECK (length(trim(description)) > 0),
  -- always | fact_risk | it_dependency | scoping
  activation           text NOT NULL CHECK (activation IN ('always','fact_risk','it_dependency','scoping')),
  -- 03.5 audit-area library codes that indicate the process is significant.
  trigger_area_codes   text[] NOT NULL DEFAULT '{}',
  -- Section 04 risk keywords (lower-case, matched on fs_area / description).
  trigger_keywords     text[] NOT NULL DEFAULT '{}',
  -- [{key, title, objective, evidence}]
  procedures           jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order           integer NOT NULL DEFAULT 0,
  effective_from       date NOT NULL,
  effective_to         date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT icfr_process_area_library_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT icfr_process_area_library_key UNIQUE (area_key, effective_from)
);
ALTER TABLE hsdg.icfr_process_area_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY icfr_process_area_library_read ON hsdg.icfr_process_area_library
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY icfr_process_area_library_write ON hsdg.icfr_process_area_library
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

INSERT INTO hsdg.icfr_process_area_library
  (framework_code, framework_label, area_key, title, description, activation,
   trigger_area_codes, trigger_keywords, procedures, sort_order, effective_from)
VALUES
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'entity_level', 'Entity-Level Controls',
 'Control environment, risk assessment, monitoring, information and communication, and the tone at the top: board and audit-committee oversight, code of conduct, delegation of authority, whistle-blower mechanism, fraud-risk management.',
 'always', '{}', '{}',
 '[{"key":"elc_understanding","title":"Understand and evaluate entity-level controls","objective":"Document the entity-level controls (control environment, risk assessment, monitoring, information and communication) and evaluate their design and implementation; identify those precise enough to address a risk at the assertion level.","evidence":"Entity-level controls questionnaire; board / committee minutes; policies; walkthrough notes."}]',
 10, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'financial_close', 'Financial Close & Reporting',
 'Period-end close, journal entries, reconciliations, consolidation, estimates and the preparation of the financial statements and disclosures.',
 'always', '{JE,EST,PRESDISC,CONSOL}', '{journal,close,estimate,disclosure,reporting}',
 '[{"key":"fcr_walkthrough","title":"Financial close and reporting — walkthrough and controls","objective":"Walk through the period-end financial reporting process (journal entries, reconciliations, estimates, financial statement preparation) and test the design and operating effectiveness of its key controls.","evidence":"Close calendar; journal-entry approval evidence; reconciliations; review checklists."}]',
 20, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'revenue', 'Revenue / Receivables',
 'Order to cash: customer master, pricing, dispatch, invoicing, revenue recognition, collections and receivables.',
 'fact_risk', '{REV,AR}', '{revenue,sales,receivable,debtor,customer}',
 '[{"key":"rev_controls","title":"Revenue / receivables — walkthrough and tests of controls","objective":"Walk through order to cash, identify the key controls over occurrence, completeness, accuracy and cut-off of revenue, and test their design, implementation and operating effectiveness.","evidence":"Process narrative / flowchart; risk and control matrix; samples tested."}]',
 30, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'purchases', 'Purchases / Payables',
 'Procure to pay: vendor master, purchase orders, goods receipt, invoice matching, payables and payments.',
 'fact_risk', '{PURCH,AP,OTHEXP}', '{purchase,payable,creditor,vendor,supplier,procure}',
 '[{"key":"p2p_controls","title":"Purchases / payables — walkthrough and tests of controls","objective":"Walk through procure to pay, identify the key controls over occurrence, completeness and accuracy of purchases and payables, and test their design, implementation and operating effectiveness.","evidence":"Process narrative; risk and control matrix; three-way-match samples."}]',
 40, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'inventory', 'Inventory',
 'Inventory movements, costing, physical verification, valuation and provisioning.',
 'fact_risk', '{INV,CHGINV}', '{inventor,stock,warehouse}',
 '[{"key":"inv_controls","title":"Inventory — walkthrough and tests of controls","objective":"Walk through inventory recording, costing, physical verification and valuation, and test the design, implementation and operating effectiveness of the key controls.","evidence":"Inventory process narrative; count instructions; costing and NRV review evidence."}]',
 50, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'ppe', 'Property, Plant & Equipment',
 'Capital expenditure approval, capitalisation, fixed asset register, depreciation, physical verification, impairment and disposals.',
 'fact_risk', '{PPE,CWIP,INTANG,DEPR}', '{fixed asset,property,plant,capital work,depreciation,capitalis}',
 '[{"key":"ppe_controls","title":"Property, plant & equipment — walkthrough and tests of controls","objective":"Walk through capitalisation, depreciation, verification and disposals, and test the design, implementation and operating effectiveness of the key controls.","evidence":"Capex approvals; fixed asset register reconciliations; verification reports."}]',
 60, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'payroll', 'Payroll',
 'Employee master, attendance, payroll processing, statutory deductions and employee benefit provisions.',
 'fact_risk', '{EMPEXP,EMPOBL}', '{payroll,salar,employee,wage,gratuity}',
 '[{"key":"payroll_controls","title":"Payroll — walkthrough and tests of controls","objective":"Walk through payroll processing and employee-benefit accounting, and test the design, implementation and operating effectiveness of the key controls.","evidence":"Payroll process narrative; joiner / leaver approvals; payroll reconciliations."}]',
 70, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'treasury', 'Treasury',
 'Cash and bank, borrowings, investments, loans given, finance costs and foreign-exchange exposure.',
 'fact_risk', '{CASH,BORR,INVEST,LOANS,FINCOST,FININST}', '{cash,bank,borrowing,loan,investment,treasury,interest}',
 '[{"key":"treasury_controls","title":"Treasury — walkthrough and tests of controls","objective":"Walk through cash, bank, borrowings and investments, and test the design, implementation and operating effectiveness of the key controls (bank reconciliations, authorisation of payments, borrowing approvals, covenant monitoring).","evidence":"Bank reconciliations; payment authorisation matrix; loan documentation."}]',
 80, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'taxation', 'Taxation',
 'Current and deferred tax computation, indirect taxes, tax provisions and contingencies.',
 'fact_risk', '{TAXEXP,CTA,CTL,DTA,DTL}', '{tax,gst,deferred tax}',
 '[{"key":"tax_controls","title":"Taxation — walkthrough and tests of controls","objective":"Walk through the computation and review of current and deferred tax and indirect-tax compliance, and test the design, implementation and operating effectiveness of the key controls.","evidence":"Tax computations with review evidence; GST reconciliations."}]',
 90, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'itgc', 'IT General Controls',
 'Access to programs and data, program change, program development and computer operations for the systems that process financial data; automated controls and reports relied on.',
 'it_dependency', '{}', '{it general,access,erp,system,automated,audit trail}',
 '[{"key":"itgc_controls","title":"IT general controls — understand and test","objective":"Identify the IT systems relevant to financial reporting and test the design and operating effectiveness of the IT general controls (access, change management, operations) that the automated controls and reports relied on depend upon.","evidence":"IT environment understanding; user-access reviews; change tickets; job monitoring evidence."}]',
 100, '2015-04-01'),
('DHVAJ_ICFR', 'DHVAJ ICFR process-area framework v1', 'other_significant', 'Other Significant Processes',
 'Any further significant process identified in scoping (e.g. related-party transactions, government grants, construction contracts).',
 'scoping', '{}', '{}',
 '[{"key":"other_controls","title":"Other significant process — walkthrough and tests of controls","objective":"Walk through the process and test the design, implementation and operating effectiveness of its key controls.","evidence":"Process narrative; risk and control matrix; samples tested."}]',
 900, '2015-04-01');

CREATE TABLE hsdg.audit_icfr_workstream (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id        uuid NOT NULL UNIQUE
                                REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id               uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  framework_code              text NOT NULL,
  framework_label             text NOT NULL,
  period_start                date NOT NULL,
  status                      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  withdrawn_at                timestamptz,
  withdrawn_reason            text,
  -- The workstream-level conclusion on ICFR (feeds Section 08).
  conclusion                  text CHECK (conclusion IS NULL OR conclusion IN
                                ('unmodified','modified_material_weakness','disclaimer')),
  conclusion_note             text,
  concluded_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  concluded_at                timestamptz,
  instantiated_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                     integer NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_icfr_workstream_engagement_idx ON hsdg.audit_icfr_workstream (engagement_id);
CREATE TRIGGER audit_icfr_workstream_set_updated_at
  BEFORE UPDATE ON hsdg.audit_icfr_workstream
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_icfr_process_area (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workstream_id          uuid NOT NULL REFERENCES hsdg.audit_icfr_workstream (id) ON DELETE CASCADE,
  workflow_instance_id   uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  library_area_id        uuid,
  -- Library key, or other_<n> for a team-added other significant process.
  area_key               text NOT NULL CHECK (area_key ~ '^[a-z0-9_]{2,40}$'),
  title                  text NOT NULL CHECK (length(trim(title)) > 0),
  description            text,
  activation             text NOT NULL CHECK (activation IN ('always','fact_risk','it_dependency','scoping')),
  procedures             jsonb NOT NULL DEFAULT '[]'::jsonb,
  source                 text NOT NULL DEFAULT 'framework' CHECK (source IN ('framework','manual')),
  scoping                text NOT NULL DEFAULT 'to_be_scoped'
                           CHECK (scoping IN ('in_scope','not_in_scope','to_be_scoped')),
  -- 'system' while the scoping follows the facts; 'team' once someone decided.
  scoping_source         text NOT NULL DEFAULT 'system' CHECK (scoping_source IN ('system','team')),
  system_basis           text,
  scoping_reason         text,
  scoped_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  scoped_at              timestamptz,
  sort_order             integer NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  withdrawn_at           timestamptz,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_icfr_process_area_key UNIQUE (workstream_id, area_key),
  -- Taking an area out of scope by hand needs a reason.
  CONSTRAINT audit_icfr_process_area_reason CHECK (
    scoping_source = 'system' OR scoping <> 'not_in_scope'
    OR (scoping_reason IS NOT NULL AND length(trim(scoping_reason)) > 0)
  )
);
CREATE INDEX audit_icfr_process_area_instance_idx ON hsdg.audit_icfr_process_area (workflow_instance_id);
CREATE INDEX audit_icfr_process_area_engagement_idx ON hsdg.audit_icfr_process_area (engagement_id);
CREATE TRIGGER audit_icfr_process_area_set_updated_at
  BEFORE UPDATE ON hsdg.audit_icfr_process_area
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_icfr_control (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id      uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id             uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- A control belongs to a process; FS-audit-only controls exist without an
  -- ICFR workstream, so the process area is optional and the process kept as text.
  process_area_id           uuid REFERENCES hsdg.audit_icfr_process_area (id) ON DELETE SET NULL,
  process                   text NOT NULL CHECK (length(trim(process)) > 0),
  seq                       integer NOT NULL,
  control_ref               text NOT NULL CHECK (length(trim(control_ref)) > 0),
  description               text NOT NULL CHECK (length(trim(description)) > 0),
  -- §14 purposes — one record, never a duplicate test.
  purpose_fs_audit          boolean NOT NULL DEFAULT true,
  purpose_icfr              boolean NOT NULL DEFAULT false,
  assertions                text[] NOT NULL DEFAULT '{}',
  related_risk_id           uuid REFERENCES hsdg.audit_risks (id) ON DELETE SET NULL,
  related_risk              text,
  nature                    text CHECK (nature IS NULL OR nature IN ('manual','automated','it_dependent_manual')),
  frequency                 text CHECK (frequency IS NULL OR frequency IN
                              ('transactional','daily','weekly','monthly','quarterly','annual','ad_hoc')),
  is_key                    boolean NOT NULL DEFAULT true,
  owner                     text,
  -- The Section 06 procedure the control is tested in (optional).
  procedure_id              uuid REFERENCES hsdg.audit_procedures (id) ON DELETE SET NULL,
  -- §15 — three separate conclusions; never collapsed into one Yes / No.
  design                    text CHECK (design IS NULL OR design IN ('adequate','deficiency')),
  implementation            text CHECK (implementation IS NULL OR implementation IN ('implemented','not_implemented')),
  operating_effectiveness   text CHECK (operating_effectiveness IS NULL OR operating_effectiveness IN
                              ('effective','exception_identified','not_tested')),
  test_note                 text,
  review_state              text NOT NULL DEFAULT 'open'
                              CHECK (review_state IN ('open','submitted','returned','reviewed')),
  return_note               text,
  submitted_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  submitted_at              timestamptz,
  reviewed_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewed_at               timestamptz,
  created_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  withdrawn_at              timestamptz,
  version                   integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_icfr_control_seq UNIQUE (workflow_instance_id, seq),
  CONSTRAINT audit_icfr_control_purpose CHECK (purpose_fs_audit OR purpose_icfr)
);
CREATE UNIQUE INDEX audit_icfr_control_live_ref
  ON hsdg.audit_icfr_control (workflow_instance_id, lower(control_ref)) WHERE withdrawn_at IS NULL;
CREATE INDEX audit_icfr_control_area_idx ON hsdg.audit_icfr_control (process_area_id);
CREATE INDEX audit_icfr_control_engagement_idx ON hsdg.audit_icfr_control (engagement_id);
CREATE TRIGGER audit_icfr_control_set_updated_at
  BEFORE UPDATE ON hsdg.audit_icfr_control
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_icfr_control_evidence (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id             uuid NOT NULL REFERENCES hsdg.audit_icfr_control (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  audit_evidence_id      uuid REFERENCES hsdg.audit_evidence (id) ON DELETE CASCADE,
  note                   text,
  linked_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  linked_at              timestamptz NOT NULL DEFAULT now(),
  removed_at             timestamptz,
  removed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  CONSTRAINT audit_icfr_control_evidence_one_source
    CHECK ((document_id IS NULL) <> (audit_evidence_id IS NULL))
);
CREATE INDEX audit_icfr_control_evidence_control_idx ON hsdg.audit_icfr_control_evidence (control_id);
CREATE UNIQUE INDEX audit_icfr_control_evidence_live_doc
  ON hsdg.audit_icfr_control_evidence (control_id, document_id)
  WHERE removed_at IS NULL AND document_id IS NOT NULL;
CREATE UNIQUE INDEX audit_icfr_control_evidence_live_ev
  ON hsdg.audit_icfr_control_evidence (control_id, audit_evidence_id)
  WHERE removed_at IS NULL AND audit_evidence_id IS NOT NULL;

CREATE TABLE hsdg.audit_icfr_deficiency (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id        uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id               uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Per-workflow sequence behind the display code ICD-00n.
  seq                         integer NOT NULL,
  classification              text NOT NULL CHECK (classification IN
                                ('control_deficiency','significant_deficiency','material_weakness')),
  description                 text NOT NULL CHECK (length(trim(description)) > 0),
  control_id                  uuid REFERENCES hsdg.audit_icfr_control (id) ON DELETE SET NULL,
  process_area_id             uuid REFERENCES hsdg.audit_icfr_process_area (id) ON DELETE SET NULL,
  -- Affected account / disclosure: a Section 06 work area key and / or text.
  work_area_key               text,
  affected_account            text,
  assertions                  text[] NOT NULL DEFAULT '{}',
  magnitude                   text CHECK (magnitude IS NULL OR magnitude IN
                                ('inconsequential','more_than_inconsequential','material')),
  likelihood                  text CHECK (likelihood IS NULL OR likelihood IN
                                ('remote','reasonably_possible','probable')),
  compensating_control_ids    uuid[] NOT NULL DEFAULT '{}',
  compensating_note           text,
  remediation_action          text,
  remediation_status          text NOT NULL DEFAULT 'not_started' CHECK (remediation_status IN
                                ('not_started','in_progress','remediated','not_remediated')),
  audit_impact                text,
  reporting_impact            text CHECK (reporting_impact IS NULL OR reporting_impact IN
                                ('none','management_letter','tcwg_communication','icfr_opinion_modified')),
  reporting_note              text,
  -- §19: raised from a prior-year follow-up.
  followup_id                 uuid,
  -- Manager review, then the Partner conclusion where required (SD / MW).
  reviewed_by_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewed_at                 timestamptz,
  partner_conclusion          text,
  partner_by_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  partner_at                  timestamptz,
  status                      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  raised_by_employee_id       uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  withdrawn_at                timestamptz,
  version                     integer NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_icfr_deficiency_seq UNIQUE (workflow_instance_id, seq)
);
CREATE INDEX audit_icfr_deficiency_instance_idx ON hsdg.audit_icfr_deficiency (workflow_instance_id);
CREATE INDEX audit_icfr_deficiency_engagement_idx ON hsdg.audit_icfr_deficiency (engagement_id);
CREATE TRIGGER audit_icfr_deficiency_set_updated_at
  BEFORE UPDATE ON hsdg.audit_icfr_deficiency
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_icfr_followup (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- The prior-year deficiency, frozen as values (the prior file stays as it is).
  prior_deficiency_id      uuid NOT NULL,
  prior_financial_year     text NOT NULL,
  prior_ref                text NOT NULL,
  prior_classification     text NOT NULL CHECK (prior_classification IN
                             ('control_deficiency','significant_deficiency','material_weakness')),
  prior_description        text NOT NULL,
  prior_process            text,
  prior_remediation_action text,
  prior_remediation_status text NOT NULL,
  -- Current-year follow-up.
  status                   text NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','remediated','persists','not_relevant')),
  conclusion_note          text,
  deficiency_id            uuid REFERENCES hsdg.audit_icfr_deficiency (id) ON DELETE SET NULL,
  concluded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  concluded_at             timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_icfr_followup_key UNIQUE (workflow_instance_id, prior_deficiency_id),
  CONSTRAINT audit_icfr_followup_concluded CHECK (
    status = 'open' OR (conclusion_note IS NOT NULL AND length(trim(conclusion_note)) > 0)
  )
);
CREATE INDEX audit_icfr_followup_engagement_idx ON hsdg.audit_icfr_followup (engagement_id);
CREATE TRIGGER audit_icfr_followup_set_updated_at
  BEFORE UPDATE ON hsdg.audit_icfr_followup
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();
ALTER TABLE hsdg.audit_icfr_deficiency
  ADD CONSTRAINT audit_icfr_deficiency_followup_fk
  FOREIGN KEY (followup_id) REFERENCES hsdg.audit_icfr_followup (id) ON DELETE SET NULL;

CREATE TABLE hsdg.audit_icfr_consolidated (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL UNIQUE
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  withdrawn_at             timestamptz,
  withdrawn_reason         text,
  -- §17 parent auditor's structured conclusion for the consolidated report.
  parent_conclusion        text CHECK (parent_conclusion IS NULL OR parent_conclusion IN
                             ('unmodified','modified_component_material_weakness',
                              'modified_parent_material_weakness','not_applicable')),
  parent_conclusion_note   text,
  concluded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  concluded_at             timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_icfr_consolidated_engagement_idx ON hsdg.audit_icfr_consolidated (engagement_id);
CREATE TRIGGER audit_icfr_consolidated_set_updated_at
  BEFORE UPDATE ON hsdg.audit_icfr_consolidated
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_icfr_component (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consolidated_id             uuid NOT NULL REFERENCES hsdg.audit_icfr_consolidated (id) ON DELETE CASCADE,
  engagement_id               uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  source                      text NOT NULL CHECK (source IN ('02.6','manual')),
  source_key                  text NOT NULL CHECK (length(trim(source_key)) > 0),
  component_name              text NOT NULL CHECK (length(trim(component_name)) > 0),
  relationship                text,
  indian_company              text CHECK (indian_company IS NULL OR indian_company IN ('yes','no')),
  component_icfr              text NOT NULL DEFAULT 'pending'
                                CHECK (component_icfr IN ('applicable','exempt','pending')),
  auditor                     text CHECK (auditor IS NULL OR auditor IN ('dhvaj','other')),
  auditor_name                text,
  report_document_id          uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  materiality                 text CHECK (materiality IS NULL OR materiality IN ('significant','not_significant')),
  materiality_note            text,
  material_weakness           boolean,
  material_weakness_details   text,
  sort_order                  integer NOT NULL DEFAULT 0,
  withdrawn_at                timestamptz,
  version                     integer NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_icfr_component_key UNIQUE (consolidated_id, source_key),
  CONSTRAINT audit_icfr_component_mw_details CHECK (
    material_weakness IS NOT TRUE
    OR (material_weakness_details IS NOT NULL AND length(trim(material_weakness_details)) > 0)
  )
);
CREATE INDEX audit_icfr_component_engagement_idx ON hsdg.audit_icfr_component (engagement_id);
CREATE TRIGGER audit_icfr_component_set_updated_at
  BEFORE UPDATE ON hsdg.audit_icfr_component
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (engagement child data) ─────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_icfr_workstream','audit_icfr_process_area','audit_icfr_control',
                           'audit_icfr_control_evidence','audit_icfr_deficiency','audit_icfr_followup',
                           'audit_icfr_consolidated','audit_icfr_component']
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

-- ── ICFR Applicability Memo template (spec §20) ────────────────────────────
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo',
    'schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii',
    'caro_applicability_memo','icfr_applicability_memo'));

INSERT INTO hsdg.document_templates (template_key, variant_key, title) VALUES
  ('icfr_applicability_memo', 'standard', 'ICFR Reporting Applicability Memo')
ON CONFLICT (template_key, variant_key) DO NOTHING;

-- Down Migration
DROP TABLE IF EXISTS hsdg.audit_icfr_component CASCADE;
DROP TABLE IF EXISTS hsdg.audit_icfr_consolidated CASCADE;
DROP TABLE IF EXISTS hsdg.audit_icfr_deficiency CASCADE;
DROP TABLE IF EXISTS hsdg.audit_icfr_followup CASCADE;
DROP TABLE IF EXISTS hsdg.audit_icfr_control_evidence CASCADE;
DROP TABLE IF EXISTS hsdg.audit_icfr_control CASCADE;
DROP TABLE IF EXISTS hsdg.audit_icfr_process_area CASCADE;
DROP TABLE IF EXISTS hsdg.audit_icfr_workstream CASCADE;
DROP TABLE IF EXISTS hsdg.icfr_process_area_library CASCADE;

-- An ICFR memo linked to a sub-assessment pins its template version (RESTRICT).
DELETE FROM hsdg.audit_framework_files WHERE template_key = 'icfr_applicability_memo';
DELETE FROM hsdg.document_template_versions v
 USING hsdg.document_templates t
 WHERE v.template_id = t.id AND t.template_key = 'icfr_applicability_memo';
DELETE FROM hsdg.document_templates WHERE template_key = 'icfr_applicability_memo';
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo',
    'schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii',
    'caro_applicability_memo'));

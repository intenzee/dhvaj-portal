-- Up Migration
--
-- 03.1 Planning Intelligence — configurable Planning Signal Library
-- (DHVAJ 03.1 §5 "rule library", §8 signal content, §18 guidance links, §21
-- versioning).
--
-- Until now the 03.1.1 deriver was hard-coded: eight rules in TypeScript, no
-- rule code, no version, no effective period and no guidance anchors. This
-- moves every rule into hsdg.planning_signal_rule:
--
--   • insert-only versions (rule_code, version) — a correction is a new version,
--     a retirement is a new version with active = false; an engagement keeps the
--     rule code + version it fired under, so an old file stays explainable.
--   • trigger_condition is a small JSON condition over the flat Planning Facts
--     map the API builds from Sections 01/02 (see planning-signal-library.ts):
--       {"fact": k, "op": "truthy"} | {"fact": k, "op": "eq"|"in"|"gt", "value": v}
--       {"all": [...]} | {"any": [...]} | {"not": {...}}
--   • observation_template renders {{fact}} placeholders; a [[ ... ]] segment is
--     dropped when any placeholder inside it is empty.
--   • trigger_source 'current_year_change' rules turn a PI-01 change into a
--     category-specific signal (why it may matter, implications, destinations,
--     attention, guidance) instead of one generic sentence.
--
-- Rule keys PSR-001..PSR-008 keep the eight existing rule_key values — 03.5
-- links signals to audit areas through them (area_review tagMatches), so they
-- must not change.
--
-- Also: signal provenance columns (rule_code, rule_version, guidance_anchors,
-- source_section, source_changed_at), potential assertions on Areas of Focus,
-- the Engagement Intelligence review stamp + facts fingerprint, the 03.1
-- guidance links (context '03.1') and the four provisions they need that the
-- library lacked (SA 220, SA 705, SA 710, Implementation Guide to Risk-Based
-- Audit).
--
-- RLS: the library is firm reference data — any authenticated role reads it,
-- only a firm-wide context inserts (REVOKE UPDATE/DELETE makes it insert-only).
-- FORCE RLS is applied after the seed; the seeded provision / reference-link
-- tables are FORCE RLS already, so their seeds are wrapped in NO FORCE … FORCE.

CREATE TABLE hsdg.planning_signal_rule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code              text NOT NULL CHECK (rule_code ~ '^PSR-[0-9]{3}$'),
  version                integer NOT NULL CHECK (version >= 1),
  rule_key               text NOT NULL CHECK (rule_key ~ '^[a-z0-9_]{2,60}$'),
  name                   text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  trigger_source         text NOT NULL CHECK (trigger_source IN
                           ('section_01','section_02','current_year_change')),
  trigger_section        text NOT NULL CHECK (trigger_section ~ '^[0-9]{2}\.[0-9]{1,2}$'),
  trigger_condition      jsonb NOT NULL CHECK (jsonb_typeof(trigger_condition) = 'object'),
  condition_version      integer NOT NULL DEFAULT 1 CHECK (condition_version >= 1),
  observation_template   text NOT NULL CHECK (length(trim(observation_template)) BETWEEN 1 AND 2000),
  why_may_matter         text NOT NULL CHECK (length(trim(why_may_matter)) BETWEEN 1 AND 2000),
  potential_implications text NOT NULL CHECK (length(trim(potential_implications)) BETWEEN 1 AND 2000),
  guidance_anchors       text[] NOT NULL DEFAULT '{}'
                           CHECK (array_position(guidance_anchors, NULL) IS NULL),
  destinations           text[] NOT NULL DEFAULT '{}'
                           CHECK (destinations <@ ARRAY['03.4','03.5','03.6','03.8','03.9',
                                                        '03.11','section_04']::text[]),
  suggested_attention    text NOT NULL CHECK (suggested_attention IN
                           ('standard','enhanced','immediate_partner')),
  source_link            text CHECK (source_link IS NULL OR source_link ~ '^[a-z_]+:[A-Za-z0-9_.-]+$'),
  effective_from         date NOT NULL DEFAULT DATE '2000-01-01',
  effective_to           date,
  active                 boolean NOT NULL DEFAULT true,
  methodology_version    text NOT NULL DEFAULT 'DHVAJ-M1'
                           CHECK (length(trim(methodology_version)) BETWEEN 1 AND 60),
  change_note            text CHECK (change_note IS NULL OR length(change_note) <= 2000),
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_code, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX planning_signal_rule_key_idx ON hsdg.planning_signal_rule (rule_key);

REVOKE UPDATE, DELETE ON hsdg.planning_signal_rule FROM hsdg_app;
ALTER TABLE hsdg.planning_signal_rule ENABLE ROW LEVEL SECURITY;
CREATE POLICY planning_signal_rule_read ON hsdg.planning_signal_rule
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY planning_signal_rule_insert ON hsdg.planning_signal_rule
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());

-- ── Seed: Section 01 / 02 fact rules ────────────────────────────────────────
INSERT INTO hsdg.planning_signal_rule
  (rule_code, version, rule_key, name, trigger_source, trigger_section, trigger_condition,
   observation_template, why_may_matter, potential_implications, guidance_anchors,
   destinations, suggested_attention, source_link, change_note)
VALUES
  ('PSR-001', 1, 'initial_audit', 'Initial audit / opening balances', 'section_02', '02.1',
   '{"any":[{"fact":"initial_audit","op":"truthy"},{"fact":"sa510","op":"truthy"}]}',
   'This is the first statutory audit of the entity by the firm.',
   'Opening balances, predecessor information and historical accounting practices may require additional attention (SA 510).',
   'Opening balances, comparatives, accounting-policy consistency and process understanding.',
   '{sa_510,sa_300}', '{03.4,section_04}', 'enhanced', 'framework:02.1',
   'Moved from the hard-coded deriver.'),
  ('PSR-002', 1, 'specialist_required', 'Specialist input required', 'section_01', '01.4',
   '{"fact":"specialists","op":"truthy"}',
   'Acceptance identified that the engagement needs specialist input: {{specialists}}.',
   'The team must include, or have access to, the specialist skills before fieldwork (SA 220; SA 620 for an auditor''s expert).',
   'Team composition, use of an expert or internal specialist, scope and timeline.',
   '{sa_620,sa_220}', '{03.8,03.4}', 'enhanced', 'acceptance:question-acc_04',
   'Moved from the hard-coded deriver.'),
  ('PSR-003', 1, 'service_organisation', 'Service organisation', 'section_02', '02.1',
   '{"any":[{"fact":"sa402","op":"truthy"},{"fact":"accounting_environment","op":"in","value":["outsourced_service_organisation","hybrid"]}]}',
   'A financially relevant process is handled by a service organisation[[ ({{service_org_provider}})]].',
   'The audit may need to consider controls at the service organisation (SA 402).',
   'Assurance report availability, complementary user controls and evidence strategy.',
   '{sa_402}', '{03.4}', 'standard', 'framework:02.1',
   'Moved from the hard-coded deriver; names the provider.'),
  ('PSR-004', 1, 'joint_audit', 'Joint audit', 'section_02', '02.1',
   '{"any":[{"fact":"joint_audit","op":"truthy"},{"fact":"sa299","op":"truthy"}]}',
   'This is a joint audit of the financial statements[[ with {{joint_auditors}}]].',
   'Division of work, coordination and joint responsibility require planning consideration (SA 299).',
   'Work allocation, coordination and joint sign-off planning.',
   '{sa_299}', '{03.4,03.9}', 'standard', 'framework:02.1',
   'Moved from the hard-coded deriver; names the joint auditors.'),
  ('PSR-005', 1, 'caro_applicable', 'CARO 2020 applicable', 'section_02', '02.4',
   '{"fact":"caro","op":"eq","value":"applicable"}',
   'CARO 2020 is applicable to this engagement.',
   'The auditor must report on the CARO matters, several of which (inventory, loans, statutory dues, fraud, going concern) need evidence planned from the start.',
   'CARO reporting matters, related evidence and the CARO reporting timeline.',
   '{caro_2020}', '{03.4,section_04}', 'standard', 'framework:02.4',
   'Moved from the hard-coded deriver; reads the 02.4 outcome.'),
  ('PSR-006', 1, 'icfr_applicable', 'ICFR reporting applicable', 'section_02', '02.5',
   '{"fact":"icfr","op":"eq","value":"applicable"}',
   'Reporting on internal financial controls with reference to financial statements (ICFR) is applicable.',
   'Controls and IT work is expected to be significant; the auditor reports on the operating effectiveness of ICFR under Section 143(3)(i).',
   'Controls understanding and testing effort, IT expertise, timing of interim testing.',
   '{icfr_guidance,sa_315}', '{03.4,03.8,03.11}', 'enhanced', 'framework:02.5',
   'Moved from the hard-coded deriver; reads the 02.5 outcome.'),
  ('PSR-007', 1, 'cfs_required', 'Consolidated financial statements required', 'section_02', '02.6',
   '{"fact":"cfs","op":"eq","value":"cfs_required"}',
   'Consolidated financial statements are required.',
   'Consolidation, component scoping and coordination with other auditors require planning attention (SA 600).',
   'Component scoping, consolidation adjustments and group-reporting coordination.',
   '{sa_600}', '{03.4,03.9}', 'enhanced', 'framework:02.6',
   'Moved from the hard-coded deriver; reads the 02.6 outcome.'),
  ('PSR-008', 1, 'internal_audit_function', 'Internal audit function', 'section_02', '02.1',
   '{"fact":"internal_audit","op":"truthy"}',
   'The entity has an internal audit function.',
   'Possible use of internal-audit work requires evaluation under SA 610.',
   'Use of internal-audit work and coordination.',
   '{sa_610}', '{03.9}', 'standard', 'framework:02.1',
   'Moved from the hard-coded deriver.'),
  ('PSR-009', 1, 'first_time_ind_as', 'First-time adoption of Ind AS', 'section_02', '02.2',
   '{"fact":"first_time_ind_as","op":"truthy"}',
   'The entity is adopting Ind AS for the first time in this period.',
   'Transition under Ind AS 101 restates the opening balance sheet and comparatives; opening balances and comparative information need specific procedures (SA 510, SA 710).',
   'Transition adjustments, opening Ind AS balance sheet, exemptions elected, comparatives, reconciliations and disclosures; possible specialist accounting input.',
   '{indas_101,sa_510,sa_710}', '{03.4,03.5,03.8}', 'enhanced', 'framework:02.2', NULL),
  ('PSR-010', 1, 'schedule_iii_specialised', 'Specialised presentation format', 'section_02', '02.3',
   '{"fact":"schedule_iii","op":"in","value":["division_iii","specialised_format"]}',
   'The financial statements follow {{schedule_iii_label}}.',
   'A specialised presentation format carries sector-specific classification and disclosure requirements that the audit programme must cover.',
   'Presentation and disclosure checklists, regulatory classification, sector-specific audit areas.',
   '{schedule_iii}', '{03.5,section_04}', 'standard', 'framework:02.3', NULL),
  ('PSR-011', 1, 'rule_11_reporting', 'Rule 11 reporting matters', 'section_02', '02.7',
   '{"fact":"rule_11_items","op":"gt","value":0}',
   'Rule 11 of the Companies (Audit and Auditors) Rules applies to the auditor''s report: {{rule_11_labels}}.',
   'Each Rule 11 clause needs its own evidence (pending litigation, foreseeable losses, IEPF transfers, funding and dividend representations).',
   'Rule 11 evidence, management representations and reporting.',
   '{rule_11,rule_11_guidance}', '{03.4,section_04}', 'standard', 'framework:02.7', NULL),
  ('PSR-012', 1, 'audit_trail_reporting', 'Audit trail reporting (Rule 11(g))', 'section_02', '02.7',
   '{"fact":"audit_trail","op":"truthy"}',
   'Rule 11(g) audit-trail reporting applies to the accounting software[[ ({{accounting_software}})]].',
   'The auditor reports whether the software records an audit trail (edit log) that operated throughout the year and was not tampered with — this needs IT procedures planned early.',
   'IT general controls, audit-trail testing across the year, possible IT specialist, retention of the trail.',
   '{rule_11g,audit_trail_guidance}', '{03.4,03.8}', 'enhanced', 'framework:02.7', NULL),
  ('PSR-013', 1, 'managerial_remuneration', 'Section 197(16) reporting', 'section_02', '02.7',
   '{"fact":"s197","op":"truthy"}',
   'Section 197(16) reporting on managerial remuneration applies.',
   'The auditor must report whether remuneration paid to directors is within the Section 197 limits.',
   'Remuneration computation, approvals and Schedule V limits.',
   '{s197_16}', '{section_04}', 'standard', 'framework:02.7', NULL),
  ('PSR-014', 1, 'other_auditor_components', 'Components audited by other auditors', 'section_02', '02.6',
   '{"fact":"other_auditor_components","op":"gt","value":0}',
   '{{other_auditor_components}} component(s) are audited by other auditors: {{other_auditor_component_names}}.',
   'The group auditor remains responsible for the group opinion and must plan communication with, and evaluation of, the component auditors'' work (SA 600).',
   'Component auditor instructions, reporting packages and deadlines, review of their work, component materiality.',
   '{sa_600}', '{03.9,03.4,03.11}', 'enhanced', 'framework:02.6', NULL),
  ('PSR-015', 1, 'branch_auditors', 'Branches audited by branch auditors', 'section_02', '02.6',
   '{"fact":"branch_auditors","op":"gt","value":0}',
   '{{branch_auditors}} branch(es) are audited by branch auditors: {{branch_auditor_names}}.',
   'The branch auditors'' reports must be received and dealt with in the main report (Section 143(8)).',
   'Branch instructions, reporting timelines and how the branch reports are dealt with.',
   '{s143_8,sa_600}', '{03.9,03.11}', 'standard', 'framework:02.6', NULL),
  ('PSR-016', 1, 'listed_entity', 'Listed entity', 'section_02', '02.1',
   '{"fact":"listed","op":"truthy"}',
   'The entity is listed.',
   'A listed entity brings an engagement quality review, Key Audit Matters, SEBI LODR obligations and tighter reporting timelines.',
   'Engagement quality reviewer, KAM consideration, results timelines and team seniority.',
   '{sa_220}', '{03.8,03.11}', 'enhanced', 'framework:02.1', NULL),
  ('PSR-017', 1, 'regulated_entity', 'Regulated / special entity', 'section_02', '02.1',
   '{"any":[{"fact":"special_entity_types","op":"truthy"},{"fact":"regulator","op":"truthy"}]}',
   'The entity is a regulated or special entity[[: {{special_entity_types}}]][[ (regulator: {{regulator}})]].',
   'Sector regulation adds compliance, prudential and reporting requirements the audit must consider (SA 250).',
   'Regulatory returns and directions, sector-specific audit areas, specialist knowledge.',
   '{sa_250}', '{03.4,03.5,03.8}', 'enhanced', 'framework:02.1', NULL),
  ('PSR-018', 1, 'predecessor_matters', 'Matters from the predecessor auditor', 'section_01', '01.3',
   '{"fact":"predecessor_matters","op":"truthy"}',
   'The predecessor auditor communicated matters relevant to the audit[[: {{predecessor_detail}}]].',
   'Matters communicated by the predecessor may bear on opening balances and on areas needing attention (SA 510, SA 300).',
   'Opening balances, follow-up of communicated matters, risk identification.',
   '{sa_510,sa_300}', '{03.4,03.6}', 'enhanced', 'acceptance:question-pa_05', NULL),
  ('PSR-019', 1, 'integrity_concern', 'Integrity of management / TCWG', 'section_01', '01.4',
   '{"fact":"integrity_concern","op":"truthy"}',
   'Acceptance recorded a concern, or information pending, over the integrity of management or TCWG[[: {{integrity_detail}}]].',
   'Integrity concerns affect reliance on representations, the fraud risk assessment and the level of professional scepticism (SA 240, SA 220).',
   'Fraud risk assessment, representations, partner involvement and team briefing.',
   '{sa_240,sa_220}', '{03.6,03.8}', 'immediate_partner', 'acceptance:question-acc_01', NULL),
  ('PSR-020', 1, 'legal_regulatory_matter', 'Legal, regulatory, fraud or reputational matter', 'section_01', '01.4',
   '{"fact":"legal_regulatory_concern","op":"truthy"}',
   'Acceptance recorded a significant legal, regulatory, investigation, fraud or reputational matter[[: {{legal_detail}}]].',
   'Such matters may indicate non-compliance with laws or fraud and can affect provisions, disclosures and the audit opinion (SA 250, SA 240).',
   'Laws and regulations procedures, legal confirmations, provisions and contingent liabilities.',
   '{sa_250,sa_240}', '{03.5,03.6}', 'immediate_partner', 'acceptance:question-acc_02', NULL),
  ('PSR-021', 1, 'scope_limitation', 'Potential scope limitation', 'section_01', '01.4',
   '{"fact":"scope_limitation","op":"truthy"}',
   'Acceptance identified a potential limitation on the scope of the audit[[: {{scope_limitation_detail}}]][[ (effect: {{scope_limitation_effect}})]].',
   'A scope limitation can prevent obtaining sufficient appropriate evidence and affect the form of opinion (SA 705).',
   'Alternative procedures, communication with TCWG, potential modification of the opinion.',
   '{sa_705,sa_220}', '{03.4}', 'immediate_partner', 'acceptance:question-acc_03', NULL),
  ('PSR-022', 1, 'other_acceptance_matter', 'Other acceptance matter', 'section_01', '01.4',
   '{"fact":"other_acceptance_matter","op":"truthy"}',
   'Acceptance recorded another matter that could affect the engagement[[: {{other_acceptance_detail}}]].',
   'The matter was raised at acceptance and must be considered when setting the audit strategy (SA 220, SA 300).',
   'As assessed by the Manager.',
   '{sa_220,sa_300}', '{03.4}', 'standard', 'acceptance:question-acc_06', NULL),
  ('PSR-023', 1, 'continuance_changes', 'Changes reported at continuance', 'section_01', '01.4',
   '{"fact":"continuance_changes","op":"truthy"}',
   'The continuance review reported changes since the prior year in: {{continuance_changes}}.',
   'Changed circumstances may alter the engagement risks and the resources the audit needs (SA 220, SA 300).',
   'Strategy, team and timing updates for the changed areas.',
   '{sa_220,sa_300}', '{03.4,03.8}', 'standard', 'acceptance:question-con_01', NULL),
  ('PSR-024', 1, 'acceptance_conditional', 'Acceptance concluded with conditions', 'section_01', '01.5',
   '{"fact":"acceptance_conclusion","op":"in","value":["subject_to_resolution","partner_attention"]}',
   'Acceptance was concluded {{acceptance_conclusion_label}}.',
   'Open acceptance conditions must be resolved, or monitored, as the audit is planned (SA 220).',
   'Resolution of the acceptance conditions before fieldwork; partner involvement.',
   '{sa_220}', '{03.4}', 'immediate_partner', 'acceptance:question-acc_conclusion', NULL),
  ('PSR-025', 1, 'framework_changed_since_py', 'Audit Framework changed since the prior year', 'section_02', '02.8',
   '{"fact":"framework_changes","op":"gt","value":0}',
   'The Audit Framework changed since the prior year: {{framework_change_labels}}.',
   'A changed framework alters reporting requirements, comparatives and consistency (SA 710, SA 300).',
   'Comparatives, new reporting obligations, policy consistency and the audit programme.',
   '{sa_710,sa_300}', '{03.4,03.5,section_04}', 'enhanced', 'framework:02.8', NULL),
  ('PSR-026', 1, 'erp_environment', 'ERP accounting environment', 'section_02', '02.1',
   '{"all":[{"fact":"records_electronic","op":"truthy"},{"fact":"erp_system","op":"truthy"}]}',
   'Books of account are maintained electronically on an ERP ({{accounting_software}}).',
   'An ERP environment brings IT general controls, automated controls and system-generated reports into the audit (SA 315).',
   'ITGC understanding, reliance on system reports, data analytics, possible IT specialist.',
   '{sa_315}', '{03.4,03.8}', 'standard', 'framework:02.1', NULL);

-- ── Seed: PI-01 current-year change rules (one per category) ────────────────
INSERT INTO hsdg.planning_signal_rule
  (rule_code, version, rule_key, name, trigger_source, trigger_section, trigger_condition,
   observation_template, why_may_matter, potential_implications, guidance_anchors,
   destinations, suggested_attention, source_link)
SELECT r.code, 1, 'change_' || r.category, 'Current-year change — ' || r.label,
       'current_year_change', '03.1',
       jsonb_build_object('fact', 'change_category', 'op', 'eq', 'value', r.category),
       'Current-year change — {{change_label}}[[: {{change_description}}]].',
       r.why, r.impl, r.anchors, r.dests, r.attention, 'planning:intelligence-changes'
  FROM (VALUES
    ('PSR-101', 'ownership_promoters', 'Ownership / Promoters',
     'A change in ownership or promoters can change related parties, the control environment and the tone at the top.',
     'Related-party identification, governance, shareholding disclosures.',
     '{sa_550,sa_315}'::text[], '{03.5,03.6}'::text[], 'standard'),
    ('PSR-102', 'key_management', 'Key Management',
     'New key management changes the control environment and the knowledge the audit relies on.',
     'Controls understanding, management representations, override risk.',
     '{sa_315,sa_240}', '{03.6}', 'standard'),
    ('PSR-103', 'business_model', 'Business Model / Products / Services',
     'A new business model, product or service brings new processes and revenue streams that may carry new risks.',
     'Revenue recognition, new processes and controls, accounting policies.',
     '{sa_315}', '{03.5,03.6}', 'enhanced'),
    ('PSR-104', 'major_customers_suppliers', 'Major Customers / Suppliers',
     'Changes in major customers or suppliers alter concentration and dependence.',
     'Revenue and purchase cut-off, receivable recoverability, going-concern indicators.',
     '{sa_315,sa_570}', '{03.5}', 'standard'),
    ('PSR-105', 'geography_locations', 'Geography / Locations',
     'New or closed locations change where the audit must obtain evidence.',
     'Location coverage, visits, branch or component scoping, logistics.',
     '{sa_600}', '{03.4,03.9,03.11}', 'standard'),
    ('PSR-106', 'acquisition_disposal', 'Acquisition / Disposal',
     'An acquisition or disposal brings business-combination, valuation and discontinued-operation accounting.',
     'Purchase price allocation, goodwill, gains or losses on disposal, disclosures, valuation specialist.',
     '{sa_540,sa_620}', '{03.5,03.8}', 'enhanced'),
    ('PSR-107', 'subsidiary_jv_associate', 'Subsidiary / JV / Associate',
     'A change in subsidiaries, joint ventures or associates changes the group perimeter and the consolidation.',
     'Consolidation perimeter, component scoping, group instructions.',
     '{sa_600}', '{03.4,03.9}', 'enhanced'),
    ('PSR-108', 'borrowings_financing', 'Borrowings / Financing',
     'New or restructured financing brings covenants, classification and liquidity questions.',
     'Covenant compliance, current/non-current classification, borrowing disclosures, going concern.',
     '{sa_570}', '{03.5}', 'standard'),
    ('PSR-109', 'restructuring', 'Restructuring',
     'A restructuring brings provisions, impairment and possibly going-concern questions.',
     'Restructuring provisions, impairment, employee obligations, disclosures.',
     '{sa_540,sa_570}', '{03.5,03.6}', 'enhanced'),
    ('PSR-110', 'erp_accounting_system', 'ERP / Accounting System',
     'A system change brings data migration and changes to IT controls and the audit trail.',
     'Data migration testing, ITGC over the change, Rule 11(g) audit trail across both systems.',
     '{sa_315,rule_11g}', '{03.4,03.8}', 'enhanced'),
    ('PSR-111', 'accounting_policies', 'Accounting Policies / Estimates',
     'A change in accounting policy or estimate affects consistency, comparatives and estimation uncertainty.',
     'Policy change accounting, restatement of comparatives, estimate testing.',
     '{sa_540,sa_710}', '{03.5}', 'standard'),
    ('PSR-112', 'major_contracts', 'Major Contracts',
     'A major new contract may change revenue, lease or commitment accounting.',
     'Contract review, revenue recognition, commitments and contingencies.',
     '{sa_315}', '{03.5}', 'standard'),
    ('PSR-113', 'regulatory_environment', 'Regulatory Environment',
     'A change in the regulatory environment may change the laws and regulations the entity must comply with.',
     'Laws and regulations procedures, regulatory provisions and disclosures.',
     '{sa_250}', '{03.5,03.6}', 'standard'),
    ('PSR-114', 'litigation', 'Litigation',
     'New litigation affects provisions and contingent liabilities and needs legal confirmation.',
     'Legal confirmations, provisions and contingent-liability disclosures.',
     '{sa_501,sa_250}', '{03.5}', 'enhanced'),
    ('PSR-115', 'related_parties', 'Related Parties',
     'Changes in related parties or significant related-party transactions need specific attention (SA 550).',
     'Related-party identification, arm''s-length assessment, approvals and disclosures.',
     '{sa_550}', '{03.5,03.6}', 'enhanced'),
    ('PSR-116', 'fraud', 'Fraud / Suspected Fraud',
     'A fraud or suspected fraud directly affects the fraud risk assessment and may need reporting (SA 240).',
     'Fraud risk response, Section 143(12) reporting consideration, partner involvement.',
     '{sa_240}', '{03.6,03.8}', 'immediate_partner'),
    ('PSR-117', 'going_concern', 'Going Concern / Liquidity',
     'Liquidity or going-concern indicators must be evaluated from planning onwards (SA 570).',
     'Going-concern assessment, cash-flow forecasts, disclosures and the audit opinion.',
     '{sa_570}', '{03.6,section_04}', 'immediate_partner'),
    ('PSR-118', 'other', 'Other',
     'The change was reported by the Manager and must be considered when setting the audit strategy.',
     'As assessed by the Manager.',
     '{sa_315}', '{03.4}', 'standard')
  ) AS r(code, category, label, why, impl, anchors, dests, attention);

ALTER TABLE hsdg.planning_signal_rule FORCE ROW LEVEL SECURITY;

-- ── Signal provenance ───────────────────────────────────────────────────────
ALTER TABLE hsdg.audit_planning_signal
  ADD COLUMN rule_code         text CHECK (rule_code IS NULL OR rule_code ~ '^PSR-[0-9]{3}$'),
  ADD COLUMN rule_version      integer CHECK (rule_version IS NULL OR rule_version >= 1),
  ADD COLUMN guidance_anchors  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN source_section    text CHECK (source_section IS NULL OR source_section ~ '^[0-9]{2}\.[0-9]{1,2}$'),
  -- Set when the Section 01/02 fact that raised an auto signal no longer holds:
  -- the signal is never deleted, the Manager reassesses it.
  ADD COLUMN source_changed_at timestamptz,
  -- The Manager's reassessment after that change (clears the 03.1 completion block).
  ADD COLUMN source_change_acknowledged_at timestamptz;

-- Old free-text source links → the navigable '<phase>:<place>' form.
UPDATE hsdg.audit_planning_signal SET source_link = CASE source_link
    WHEN 'section-02/entity-profile'          THEN 'framework:02.1'
    WHEN 'section-02/framework'               THEN 'framework:02.1'
    WHEN 'section-02/caro'                    THEN 'framework:02.4'
    WHEN 'section-02/icfr'                    THEN 'framework:02.5'
    WHEN 'section-02/consolidation'           THEN 'framework:02.6'
    WHEN 'section-01/acceptance_continuance'  THEN 'acceptance:question-acc_04'
    ELSE source_link END
 WHERE source_link LIKE 'section-0%';

UPDATE hsdg.audit_planning_signal s
   SET rule_code = r.rule_code,
       rule_version = r.version,
       guidance_anchors = r.guidance_anchors,
       source_section = r.trigger_section
  FROM hsdg.planning_signal_rule r
 WHERE s.rule_key = r.rule_key AND r.version = 1 AND s.is_auto;

-- A change-raised signal takes its category's rule.
UPDATE hsdg.audit_planning_signal s
   SET rule_code = r.rule_code,
       rule_version = r.version,
       guidance_anchors = r.guidance_anchors,
       source_section = '03.1'
  FROM hsdg.audit_planning_change c, hsdg.planning_signal_rule r
 WHERE c.signal_id = s.id AND r.rule_key = 'change_' || c.category AND r.version = 1;

-- ── Areas of Focus: potential assertions (§11) ──────────────────────────────
ALTER TABLE hsdg.audit_area_of_focus
  ADD COLUMN potential_assertions text[] NOT NULL DEFAULT '{}';

-- ── Engagement Intelligence review (§5, §20) ────────────────────────────────
ALTER TABLE hsdg.audit_planning_intelligence
  ADD COLUMN intelligence_reviewed_at             timestamptz,
  ADD COLUMN intelligence_reviewed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- Hash of the Section 01/02 facts the last generation read; a different hash
  -- on open means the source facts moved and the intelligence regenerates.
  ADD COLUMN facts_fingerprint                    text;

-- ── Provisions the 03.1 guidance links need ─────────────────────────────────
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, source_reference,
   reference_kind, summary)
VALUES
  ('SA_220', 'ICAI', 'Quality Control for an Audit of Financial Statements', 'SA 220',
   '2009-04-01', 'ICAI Standard on Auditing 220', 'standard',
   'The engagement partner takes responsibility for the overall quality of the audit: direction, '
   || 'supervision, review, the competence and capabilities of the team, consultation and, where '
   || 'required, an engagement quality control review.'),
  ('SA_705', 'ICAI', 'Modifications to the Opinion in the Independent Auditor''s Report (Revised)',
   'SA 705', '2018-04-01', 'ICAI Standard on Auditing 705 (Revised)', 'standard',
   'Sets out when the auditor modifies the opinion — material misstatement, or inability to obtain '
   || 'sufficient appropriate audit evidence (including a limitation imposed by management) — and '
   || 'the form of the modification.'),
  ('SA_710', 'ICAI', 'Comparative Information — Corresponding Figures and Comparative Financial Statements',
   'SA 710', '2011-04-01', 'ICAI Standard on Auditing 710', 'standard',
   'The auditor obtains sufficient appropriate evidence that comparative information is presented '
   || 'in accordance with the framework, including where policies change or comparatives are restated.'),
  ('IG_RBA', 'ICAI', 'Implementation Guide to Risk-Based Audit of Financial Statements',
   'Implementation Guide (Risk-Based Audit)', '2014-04-01',
   'ICAI Implementation Guide to Risk-Based Audit of Financial Statements', 'guidance',
   'ICAI guidance on applying the risk-based audit approach: understanding the entity, identifying '
   || 'and assessing risks, the overall audit strategy and plan, and responses to assessed risks.')
ON CONFLICT (code, version_no) DO NOTHING;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- ── 03.1 guidance links (spec §18; resolved period-correct via the library) ─
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('03.1', 'view_sa_300',          'View SA 300',                         'SA_300',            10),
  ('03.1', 'view_sa_315',          'View SA 315',                         'SA_315',            20),
  ('03.1', 'view_ig_sa_300',       'View Implementation Guide to SA 300', 'IG_SA_300',         30),
  ('03.1', 'view_ig_rba',          'View Implementation Guide to RBA',    'IG_RBA',            40),
  ('03.1', 'view_sa_510',          'View SA 510',                         'SA_510',            50),
  ('03.1', 'view_sa_402',          'View SA 402',                         'SA_402',            60),
  ('03.1', 'view_sa_299',          'View SA 299',                         'SA_299',            70),
  ('03.1', 'sa_220',               'View SA 220',                         'SA_220',           100),
  ('03.1', 'sa_240',               'View SA 240',                         'SA_240',           110),
  ('03.1', 'sa_250',               'View SA 250',                         'SA_250',           120),
  ('03.1', 'sa_299',               'View SA 299',                         'SA_299',           130),
  ('03.1', 'sa_300',               'View SA 300',                         'SA_300',           140),
  ('03.1', 'sa_315',               'View SA 315',                         'SA_315',           150),
  ('03.1', 'sa_402',               'View SA 402',                         'SA_402',           160),
  ('03.1', 'sa_501',               'View SA 501',                         'SA_501',           170),
  ('03.1', 'sa_510',               'View SA 510',                         'SA_510',           180),
  ('03.1', 'sa_540',               'View SA 540',                         'SA_540',           190),
  ('03.1', 'sa_550',               'View SA 550',                         'SA_550',           200),
  ('03.1', 'sa_570',               'View SA 570',                         'SA_570',           210),
  ('03.1', 'sa_600',               'View SA 600',                         'SA_600',           220),
  ('03.1', 'sa_610',               'View SA 610',                         'SA_610',           230),
  ('03.1', 'sa_620',               'View SA 620',                         'SA_620',           240),
  ('03.1', 'sa_705',               'View SA 705',                         'SA_705',           250),
  ('03.1', 'sa_710',               'View SA 710',                         'SA_710',           260),
  ('03.1', 'indas_101',            'View Ind AS 101',                     'INDAS_101',        270),
  ('03.1', 'caro_2020',            'View CARO 2020',                      'CARO_2020',        280),
  ('03.1', 'icfr_guidance',        'View ICAI Guidance Note on ICFR',     'ICAI_GN_ICFR',     290),
  ('03.1', 'schedule_iii',         'View Schedule III Division III',      'SCH_III_DIV_III',  300),
  ('03.1', 'rule_11',              'View Rule 11',                        'AUDIT_RULE_11',    310),
  ('03.1', 'rule_11_guidance',     'View Implementation Guide (Rule 11)', 'ICAI_IG_RULE_11',  320),
  ('03.1', 'rule_11g',             'View Rule 11(g)',                     'AUDIT_RULE_11G',   330),
  ('03.1', 'audit_trail_guidance', 'View Audit Trail Guidance',           'ICAI_IG_AUDIT_TRAIL', 340),
  ('03.1', 's197_16',              'View Section 197(16)',                'COS_ACT_197_16',   350),
  ('03.1', 's143_8',               'View Section 143(8)',                 'COS_ACT_143_8',    360)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '03.1';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_provision
 WHERE code IN ('SA_220','SA_705','SA_710','IG_RBA') AND version_no = 1
   AND NOT EXISTS (SELECT 1 FROM hsdg.authority_reference_link l
                    WHERE l.provision_code = authority_provision.code);
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.audit_planning_intelligence
  DROP COLUMN IF EXISTS facts_fingerprint,
  DROP COLUMN IF EXISTS intelligence_reviewed_by_employee_id,
  DROP COLUMN IF EXISTS intelligence_reviewed_at;

ALTER TABLE hsdg.audit_area_of_focus DROP COLUMN IF EXISTS potential_assertions;

UPDATE hsdg.audit_planning_signal SET source_link = CASE source_link
    WHEN 'framework:02.1'             THEN 'section-02/entity-profile'
    WHEN 'framework:02.4'             THEN 'section-02/caro'
    WHEN 'framework:02.5'             THEN 'section-02/icfr'
    WHEN 'framework:02.6'             THEN 'section-02/consolidation'
    WHEN 'acceptance:question-acc_04' THEN 'section-01/acceptance_continuance'
    ELSE source_link END
 WHERE source_link LIKE 'framework:%' OR source_link LIKE 'acceptance:%';

ALTER TABLE hsdg.audit_planning_signal
  DROP COLUMN IF EXISTS source_change_acknowledged_at,
  DROP COLUMN IF EXISTS source_changed_at,
  DROP COLUMN IF EXISTS source_section,
  DROP COLUMN IF EXISTS guidance_anchors,
  DROP COLUMN IF EXISTS rule_version,
  DROP COLUMN IF EXISTS rule_code;

DROP TABLE IF EXISTS hsdg.planning_signal_rule;

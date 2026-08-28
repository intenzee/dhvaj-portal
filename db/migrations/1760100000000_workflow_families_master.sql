-- ─────────────────────────────────────────────────────────────────────────
-- 0036 · Workflow families — full §19 named master (15 families)
--
-- The engine shipped with four generic workflow families (audit / filing /
-- advisory / litigation). The Service Catalogue Master §19 names FIFTEEN, so
-- that each service carries its own recognisable execution lifecycle. This
-- migration adds the eleven missing families with their ordered states and
-- 'advance' transitions, then re-points every service that had been mapped onto
-- a generic family to its §19 family.
--
-- Re-pointing a service changes `services.workflow_family_id`, which the engine
-- reads to (a) pick an engagement's INITIAL workflow state on 'start' and (b)
-- drive `workflow_transitions`. Any EXISTING engagement then holds a
-- `current_workflow_state_id` from the OLD family — which the
-- `enforce_engagement_workflow_state` trigger would reject on the next update.
-- So the migration remaps each affected engagement to the equivalent state in
-- the new family, matched by sequence position (progress-preserving), falling
-- back to the new family's initial state when the new family is shorter. State
-- sequences are contiguous 1..N in every family, so a match always exists.
--
-- RLS: the migrator carries no role context. The re-point/remap reads services
-- + workflow_states (via the trigger) and writes engagements, all FORCE-RLS —
-- drop FORCE on every table touched, do the work, restore FORCE (mirrors 0007).
-- Idempotent on families/states/transitions (keyed by slug / natural keys).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.workflow_families    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_states      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_transitions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements          NO FORCE ROW LEVEL SECURITY;

-- ── A. The eleven missing §19 families ─────────────────────────────────────
INSERT INTO hsdg.workflow_families (slug, name, description) VALUES
  ('assurance_workflow',            'Assurance Workflow',            'Certification, agreed-upon procedures and special assurance.'),
  ('recurring_compliance_workflow', 'Recurring Compliance Workflow', 'Periodic statutory returns — GST, TDS/TCS, payroll and recurring filings.'),
  ('tax_filing_workflow',           'Tax Filing Workflow',           'Income-tax and other tax return preparation and filing.'),
  ('tax_compliance_workflow',       'Tax Compliance Workflow',       'Advance tax and periodic tax-compliance activities.'),
  ('accounting_workflow',           'Accounting Workflow',           'Bookkeeping, close and finalisation.'),
  ('payroll_workflow',              'Payroll Workflow',              'Payroll processing and disbursement.'),
  ('registration_workflow',         'Registration Workflow',         'Registrations, licences and statutory setup.'),
  ('corporate_compliance_workflow', 'Corporate Compliance Workflow', 'MCA / corporate and company-law compliance.'),
  ('valuation_workflow',            'Valuation Workflow',            'Valuation assignments.'),
  ('cfo_workflow',                  'Virtual CFO Workflow',          'Virtual CFO and finance-management retainers.'),
  ('governance_workflow',           'Governance Workflow',           'Governance and secretarial advisory.'),
  ('investigation_workflow',        'Investigation Workflow',        'Forensic and investigation assignments.')
ON CONFLICT (slug) DO NOTHING;

-- ── B. Ordered states for the new families ─────────────────────────────────
INSERT INTO hsdg.workflow_states (workflow_family_id, slug, name, sequence, is_initial, is_terminal)
SELECT wf.id, v.slug, v.name, v.seq, v.is_initial, v.is_terminal
FROM (VALUES
  ('assurance_workflow',            'scoping',         'Scoping',           1, true,  false),
  ('assurance_workflow',            'procedures',      'Procedures',        2, false, false),
  ('assurance_workflow',            'review',          'Review',            3, false, false),
  ('assurance_workflow',            'reported',        'Reported',          4, false, true),
  ('recurring_compliance_workflow', 'data_collection', 'Data Collection',   1, true,  false),
  ('recurring_compliance_workflow', 'preparation',     'Preparation',       2, false, false),
  ('recurring_compliance_workflow', 'review',          'Review',            3, false, false),
  ('recurring_compliance_workflow', 'filing',          'Filing',            4, false, false),
  ('recurring_compliance_workflow', 'completed',       'Completed',         5, false, true),
  ('tax_filing_workflow',           'data_collection', 'Data Collection',   1, true,  false),
  ('tax_filing_workflow',           'computation',     'Computation',       2, false, false),
  ('tax_filing_workflow',           'review',          'Review',            3, false, false),
  ('tax_filing_workflow',           'filing',          'Filing',            4, false, false),
  ('tax_filing_workflow',           'completed',       'Completed',         5, false, true),
  ('tax_compliance_workflow',       'estimate',        'Estimate',          1, true,  false),
  ('tax_compliance_workflow',       'computation',     'Computation',       2, false, false),
  ('tax_compliance_workflow',       'payment',         'Payment',           3, false, false),
  ('tax_compliance_workflow',       'reconciliation',  'Reconciliation',    4, false, true),
  ('accounting_workflow',           'data_collection', 'Data Collection',   1, true,  false),
  ('accounting_workflow',           'processing',      'Processing',        2, false, false),
  ('accounting_workflow',           'reconciliation',  'Reconciliation',    3, false, false),
  ('accounting_workflow',           'review',          'Review',            4, false, false),
  ('accounting_workflow',           'closed',          'Closed',            5, false, true),
  ('payroll_workflow',              'inputs',          'Inputs',            1, true,  false),
  ('payroll_workflow',              'processing',      'Processing',        2, false, false),
  ('payroll_workflow',              'review',          'Review',            3, false, false),
  ('payroll_workflow',              'disbursed',       'Disbursed',         4, false, true),
  ('registration_workflow',         'application',     'Application',       1, true,  false),
  ('registration_workflow',         'submission',      'Submission',        2, false, false),
  ('registration_workflow',         'follow_up',       'Follow-up',         3, false, false),
  ('registration_workflow',         'completed',       'Completed',         4, false, true),
  ('corporate_compliance_workflow', 'preparation',     'Preparation',       1, true,  false),
  ('corporate_compliance_workflow', 'review',          'Review',            2, false, false),
  ('corporate_compliance_workflow', 'filing',          'Filing',            3, false, false),
  ('corporate_compliance_workflow', 'completed',       'Completed',         4, false, true),
  ('valuation_workflow',            'scoping',         'Scoping',           1, true,  false),
  ('valuation_workflow',            'analysis',        'Analysis',          2, false, false),
  ('valuation_workflow',            'review',          'Review',            3, false, false),
  ('valuation_workflow',            'reported',        'Reported',          4, false, true),
  ('cfo_workflow',                  'data_collection', 'Data Collection',   1, true,  false),
  ('cfo_workflow',                  'analysis',        'Analysis',          2, false, false),
  ('cfo_workflow',                  'review',          'Review',            3, false, false),
  ('cfo_workflow',                  'reported',        'Reported',          4, false, true),
  ('governance_workflow',           'scoping',         'Scoping',           1, true,  false),
  ('governance_workflow',           'review',          'Review',            2, false, false),
  ('governance_workflow',           'recommendations', 'Recommendations',   3, false, false),
  ('governance_workflow',           'completed',       'Completed',         4, false, true),
  ('investigation_workflow',        'scoping',         'Scoping',           1, true,  false),
  ('investigation_workflow',        'evidence',        'Evidence',          2, false, false),
  ('investigation_workflow',        'analysis',        'Analysis',          3, false, false),
  ('investigation_workflow',        'reported',        'Reported',          4, false, true)
) AS v(family_slug, slug, name, seq, is_initial, is_terminal)
JOIN hsdg.workflow_families wf ON wf.slug = v.family_slug
ON CONFLICT (workflow_family_id, slug) DO NOTHING;

-- ── C. 'advance' transitions for the new families (generic, from sequence) ──
INSERT INTO hsdg.workflow_transitions (workflow_family_id, from_state_id, to_state_id, action, display_name)
SELECT s1.workflow_family_id, s1.id, s2.id, 'advance', 'Advance to ' || s2.name
FROM hsdg.workflow_states s1
JOIN hsdg.workflow_states s2
  ON s2.workflow_family_id = s1.workflow_family_id AND s2.sequence = s1.sequence + 1
JOIN hsdg.workflow_families wf ON wf.id = s1.workflow_family_id
WHERE wf.slug IN (
  'assurance_workflow','recurring_compliance_workflow','tax_filing_workflow',
  'tax_compliance_workflow','accounting_workflow','payroll_workflow',
  'registration_workflow','corporate_compliance_workflow','valuation_workflow',
  'cfo_workflow','governance_workflow','investigation_workflow')
ON CONFLICT (workflow_family_id, from_state_id, action) DO NOTHING;

-- ── D. Re-point services to their §19 families ─────────────────────────────
UPDATE hsdg.services s SET workflow_family_id = wf.id
FROM (VALUES
  ('ITR_FILING',       'tax_filing_workflow'),
  ('GST_MONTHLY',      'recurring_compliance_workflow'),
  ('GST_ANNUAL',       'recurring_compliance_workflow'),
  ('BOOKKEEPING',      'accounting_workflow'),
  ('ROC_ANNUAL',       'corporate_compliance_workflow'),
  ('CERTIFICATION',    'assurance_workflow'),
  ('AUP',              'assurance_workflow'),
  ('TDS_COMPLIANCE',   'recurring_compliance_workflow'),
  ('TCS_COMPLIANCE',   'recurring_compliance_workflow'),
  ('ADVANCE_TAX',      'tax_compliance_workflow'),
  ('GST_REGISTRATION', 'registration_workflow'),
  ('GST_EINV_EWAY',    'recurring_compliance_workflow'),
  ('GST_REFUND',       'recurring_compliance_workflow'),
  ('FS_FINALISATION',  'accounting_workflow'),
  ('MIS_REPORTING',    'accounting_workflow'),
  ('PAYROLL',          'payroll_workflow'),
  ('LABOUR_COMPLIANCE','recurring_compliance_workflow'),
  ('ROC_EVENT',        'corporate_compliance_workflow'),
  ('INCORPORATION',    'registration_workflow'),
  ('REGISTRATIONS',    'registration_workflow'),
  ('VALUATION',        'valuation_workflow'),
  ('VIRTUAL_CFO',      'cfo_workflow'),
  ('GOVERNANCE',       'governance_workflow'),
  ('FORENSIC',         'investigation_workflow')
) AS m(service_code, family_slug)
JOIN hsdg.workflow_families wf ON wf.slug = m.family_slug
WHERE s.code = m.service_code;

-- ── E. Remap affected engagements to the equivalent state (by sequence) ────
-- Only engagements whose current state now belongs to a different family than
-- their service. Match the new family's state at the same sequence, capped at
-- the new family's last state (contiguous sequences ⇒ always a hit).
UPDATE hsdg.engagements e
SET current_workflow_state_id = ns.id
FROM hsdg.services s, hsdg.workflow_states os, hsdg.workflow_states ns
WHERE e.service_id = s.id
  AND os.id = e.current_workflow_state_id
  AND os.workflow_family_id <> s.workflow_family_id
  AND ns.workflow_family_id = s.workflow_family_id
  AND ns.sequence = LEAST(
        os.sequence,
        (SELECT max(sequence) FROM hsdg.workflow_states WHERE workflow_family_id = s.workflow_family_id));

-- ── F. Retire the legacy generic 'filing_workflow' (not one of the §19 15) ─
-- Every service that used it has been re-pointed above; guarded so it only
-- drops once nothing references it (no service, and — via the states — no
-- engagement). States/transitions cascade; the engagement FK is ON DELETE
-- RESTRICT, so this can never orphan a live engagement.
DELETE FROM hsdg.workflow_families wf
WHERE wf.slug = 'filing_workflow'
  AND NOT EXISTS (SELECT 1 FROM hsdg.services s WHERE s.workflow_family_id = wf.id)
  AND NOT EXISTS (
    SELECT 1 FROM hsdg.workflow_states ws
    JOIN hsdg.engagements e ON e.current_workflow_state_id = ws.id
    WHERE ws.workflow_family_id = wf.id);

ALTER TABLE hsdg.engagements          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services             FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_transitions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_states      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families    FORCE ROW LEVEL SECURITY;

-- Down Migration
-- Re-point services back to their original generic families, remap affected
-- engagements the same way, then drop the eleven added families (their states
-- and transitions cascade via ON DELETE CASCADE on the FKs).

ALTER TABLE hsdg.workflow_families    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_states      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_transitions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements          NO FORCE ROW LEVEL SECURITY;

-- Recreate the legacy generic filing_workflow (family + states + transitions)
-- before re-pointing services back onto it.
INSERT INTO hsdg.workflow_families (slug, name, description) VALUES
  ('filing_workflow', 'Filing Workflow', 'Preparation, review, and filing of returns.')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO hsdg.workflow_states (workflow_family_id, slug, name, sequence, is_initial, is_terminal)
SELECT wf.id, v.slug, v.name, v.seq, v.is_initial, v.is_terminal
FROM (VALUES
  ('preparation', 'Preparation', 1, true,  false),
  ('review',      'Review',      2, false, false),
  ('filing',      'Filing',      3, false, false),
  ('completed',   'Completed',   4, false, true)
) AS v(slug, name, seq, is_initial, is_terminal)
JOIN hsdg.workflow_families wf ON wf.slug = 'filing_workflow'
ON CONFLICT (workflow_family_id, slug) DO NOTHING;
INSERT INTO hsdg.workflow_transitions (workflow_family_id, from_state_id, to_state_id, action, display_name)
SELECT s1.workflow_family_id, s1.id, s2.id, 'advance', 'Advance to ' || s2.name
FROM hsdg.workflow_states s1
JOIN hsdg.workflow_states s2
  ON s2.workflow_family_id = s1.workflow_family_id AND s2.sequence = s1.sequence + 1
JOIN hsdg.workflow_families wf ON wf.id = s1.workflow_family_id
WHERE wf.slug = 'filing_workflow'
ON CONFLICT (workflow_family_id, from_state_id, action) DO NOTHING;

UPDATE hsdg.services s SET workflow_family_id = wf.id
FROM (VALUES
  ('ITR_FILING',       'filing_workflow'),
  ('GST_MONTHLY',      'filing_workflow'),
  ('GST_ANNUAL',       'filing_workflow'),
  ('BOOKKEEPING',      'filing_workflow'),
  ('ROC_ANNUAL',       'filing_workflow'),
  ('CERTIFICATION',    'advisory_workflow'),
  ('AUP',              'advisory_workflow'),
  ('TDS_COMPLIANCE',   'filing_workflow'),
  ('TCS_COMPLIANCE',   'filing_workflow'),
  ('ADVANCE_TAX',      'filing_workflow'),
  ('GST_REGISTRATION', 'filing_workflow'),
  ('GST_EINV_EWAY',    'filing_workflow'),
  ('GST_REFUND',       'filing_workflow'),
  ('FS_FINALISATION',  'audit_workflow'),
  ('MIS_REPORTING',    'filing_workflow'),
  ('PAYROLL',          'filing_workflow'),
  ('LABOUR_COMPLIANCE','filing_workflow'),
  ('ROC_EVENT',        'filing_workflow'),
  ('INCORPORATION',    'filing_workflow'),
  ('REGISTRATIONS',    'filing_workflow'),
  ('VALUATION',        'advisory_workflow'),
  ('VIRTUAL_CFO',      'advisory_workflow'),
  ('GOVERNANCE',       'advisory_workflow'),
  ('FORENSIC',         'advisory_workflow')
) AS m(service_code, family_slug)
JOIN hsdg.workflow_families wf ON wf.slug = m.family_slug
WHERE s.code = m.service_code;

UPDATE hsdg.engagements e
SET current_workflow_state_id = ns.id
FROM hsdg.services s, hsdg.workflow_states os, hsdg.workflow_states ns
WHERE e.service_id = s.id
  AND os.id = e.current_workflow_state_id
  AND os.workflow_family_id <> s.workflow_family_id
  AND ns.workflow_family_id = s.workflow_family_id
  AND ns.sequence = LEAST(
        os.sequence,
        (SELECT max(sequence) FROM hsdg.workflow_states WHERE workflow_family_id = s.workflow_family_id));

DELETE FROM hsdg.workflow_families WHERE slug IN (
  'assurance_workflow','recurring_compliance_workflow','tax_filing_workflow',
  'tax_compliance_workflow','accounting_workflow','payroll_workflow',
  'registration_workflow','corporate_compliance_workflow','valuation_workflow',
  'cfo_workflow','governance_workflow','investigation_workflow');

ALTER TABLE hsdg.engagements          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services             FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_transitions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_states      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families    FORCE ROW LEVEL SECURITY;

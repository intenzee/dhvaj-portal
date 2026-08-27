-- ─────────────────────────────────────────────────────────────────────────
-- 0034 · Catalogue expansion — full §6–§15 component mapping
--
-- The seeded catalogue proved the engine on 18 representative components. This
-- migration populates the rest of the firm offering from the FINAL spec's
-- component-mapping tables (§6 Audit & Assurance … §15 CFO/Governance/Forensic),
-- so the calendar covers the real service catalogue out of the box.
--
-- Per §25 this is DATA, not engine work: every component is classified by its
-- frozen §2 due-date category, and its §3 source is derived from that category
-- (the standard mapping below — the firm can override any source later, since
-- §3 makes source independent of category). Where the spec lists a component
-- under two categories (e.g. "STATUTORY_RULE / HSDG_MILESTONE"), the GOVERNING
-- category — the one that drives the statutory calendar — is chosen; the
-- internal/milestone layer is added per-instance via the §16 deadline layers.
--
-- Idempotent: service lines, services and components are keyed by their UNIQUE
-- `code`, so re-running inserts nothing new (ON CONFLICT (code) DO NOTHING).
-- No compliance_rule_id is bound here — an MP creates and links the effective
-- rule later (same as the original catalogue seed); discovery simply shows no
-- deadline preview until then.
--
-- RLS: the migrator carries no role context, so the firm-wide write policies on
-- these config tables would block both the reads and the inserts under FORCE.
-- Drop FORCE on every table touched, seed, then restore FORCE (mirrors 0007/0020).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.service_lines      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;

-- ── A. New service lines (§10 Payroll & Labour, §12 Registrations) ─────────
INSERT INTO hsdg.service_lines (code, name, display_order) VALUES
  ('PAYROLL',       'Payroll & Labour',        8),
  ('REGISTRATIONS', 'Registrations & Licensing', 9)
ON CONFLICT (code) DO NOTHING;

-- ── B. New services (parents for the expanded components) ──────────────────
INSERT INTO hsdg.services
  (service_line_id, code, name, required_review_model_id, workflow_family_id, default_recurrence)
SELECT sl.id, v.code, v.name, rm.id, wf.id, v.recurrence
FROM (VALUES
  -- §6 Audit & Assurance
  ('AUDIT',         'IFC',              'Internal Financial Controls (IFC)', 'key_matter_review', 'audit_workflow',      'annual'),
  ('AUDIT',         'LTD_REVIEW',       'Limited Review',                    'manager_review',    'audit_workflow',      'quarterly'),
  ('AUDIT',         'CERTIFICATION',    'Certification',                     'key_matter_review', 'advisory_workflow',   'as_required'),
  ('AUDIT',         'AUP',              'Agreed-Upon Procedures',            'key_matter_review', 'advisory_workflow',   'as_required'),
  ('AUDIT',         'SPECIAL_AUDIT',    'Special / Assurance Audit',         'full_ep_review',    'audit_workflow',      'as_required'),
  ('AUDIT',         'DUE_DILIGENCE',    'Due Diligence',                     'full_ep_review',    'advisory_workflow',   'as_required'),
  -- §7 Direct Tax
  ('TAX',           'TDS_COMPLIANCE',   'TDS Compliance',                    'manager_review',    'filing_workflow',     'quarterly'),
  ('TAX',           'TCS_COMPLIANCE',   'TCS Compliance',                    'manager_review',    'filing_workflow',     'quarterly'),
  ('TAX',           'ADVANCE_TAX',      'Advance Tax',                       'manager_review',    'filing_workflow',     'quarterly'),
  ('TAX',           'INTL_TAX',         'International Tax & Withholding',    'key_matter_review', 'advisory_workflow',   'as_required'),
  ('TAX',           'TAX_PLANNING',     'Tax Planning',                      'key_matter_review', 'advisory_workflow',   'as_required'),
  ('TAX',           'TAX_ASSESSMENT',   'Assessment & Proceedings (Direct)', 'full_ep_review',    'litigation_workflow', 'as_required'),
  ('TAX',           'TAX_APPEAL',       'Appeal & Litigation (Direct Tax)',  'full_ep_review',    'litigation_workflow', 'as_required'),
  -- §8 GST & Indirect Tax
  ('GST',           'GST_REGISTRATION', 'GST Registration',                  'manager_review',    'filing_workflow',     'as_required'),
  ('GST',           'GST_EINV_EWAY',    'E-Invoice & E-Way Bill',            'manager_review',    'filing_workflow',     'monthly'),
  ('GST',           'GST_REFUND',       'GST Refund',                        'manager_review',    'filing_workflow',     'as_required'),
  ('GST',           'GST_ADVISORY',     'GST Advisory',                      'key_matter_review', 'advisory_workflow',   'as_required'),
  ('GST',           'GST_ASSESSMENT',   'GST Assessment / Notice',           'full_ep_review',    'litigation_workflow', 'as_required'),
  ('GST',           'GST_APPEAL',       'GST Appeal / Litigation',           'full_ep_review',    'litigation_workflow', 'as_required'),
  -- §9 Accounting & Bookkeeping
  ('ACCOUNTS',      'FS_FINALISATION',  'Financial Statement Finalisation',  'key_matter_review', 'audit_workflow',      'annual'),
  ('ACCOUNTS',      'MIS_REPORTING',    'MIS Reporting',                     'manager_review',    'filing_workflow',     'monthly'),
  -- §10 Payroll & Labour
  ('PAYROLL',       'PAYROLL',          'Payroll Processing',                'manager_review',    'filing_workflow',     'monthly'),
  ('PAYROLL',       'LABOUR_COMPLIANCE','Labour Compliance (PF/ESI/PT)',     'manager_review',    'filing_workflow',     'monthly'),
  -- §11 MCA / Corporate
  ('ROC',           'ROC_EVENT',        'ROC Event Filings',                 'manager_review',    'filing_workflow',     'as_required'),
  ('ROC',           'INCORPORATION',    'Incorporation & Setup',             'manager_review',    'filing_workflow',     'as_required'),
  ('ROC',           'CORP_RESTRUCTURING','Corporate Restructuring',          'full_ep_review',    'advisory_workflow',   'as_required'),
  -- §12 Registrations & Licensing
  ('REGISTRATIONS', 'REGISTRATIONS',    'Registrations & Licensing',         'manager_review',    'filing_workflow',     'as_required'),
  -- §13 Transaction & Business Advisory
  ('ADVISORY',      'TXN_ADVISORY',     'Transaction & Business Advisory',   'key_matter_review', 'advisory_workflow',   'as_required'),
  -- §14 FEMA, International, Valuation
  ('ADVISORY',      'FEMA',             'FEMA & International',               'key_matter_review', 'advisory_workflow',   'as_required'),
  ('ADVISORY',      'VALUATION',        'Valuation',                         'key_matter_review', 'advisory_workflow',   'as_required'),
  -- §15 CFO, Governance, Forensic
  ('ADVISORY',      'VIRTUAL_CFO',      'Virtual CFO',                       'key_matter_review', 'advisory_workflow',   'monthly'),
  ('ADVISORY',      'GOVERNANCE',       'Governance & Secretarial',          'key_matter_review', 'advisory_workflow',   'as_required'),
  ('ADVISORY',      'FORENSIC',         'Forensic & Investigation',          'full_ep_review',    'advisory_workflow',   'as_required')
) AS v(line_code, code, name, review_slug, family_slug, recurrence)
JOIN hsdg.service_lines sl ON sl.code = v.line_code
JOIN hsdg.review_models rm ON rm.slug = v.review_slug
JOIN hsdg.workflow_families wf ON wf.slug = v.family_slug
ON CONFLICT (code) DO NOTHING;

-- ── C. Components, classified by §2 category; §3 source derived from category ─
INSERT INTO hsdg.service_components
  (service_id, code, name, description, default_applicability, default_frequency,
   display_order, due_date_category, due_date_source)
SELECT s.id, v.code, v.name, NULL, v.applicability, v.frequency, v.display_order, v.cat,
  CASE v.cat
    WHEN 'STATUTORY_FIXED' THEN 'LAW_RULE'
    WHEN 'STATUTORY_RULE'  THEN 'LAW_RULE'
    WHEN 'STATUTORY_EVENT' THEN 'LAW_RULE'
    WHEN 'EVENT_SLA'       THEN 'LAW_RULE'
    WHEN 'GOVT_EXTENSION'  THEN 'GOVERNMENT_NOTIFICATION'
    WHEN 'HSDG_RECURRING'  THEN 'HSDG_POLICY'
    WHEN 'HSDG_MILESTONE'  THEN 'WORKFLOW'
    WHEN 'CLIENT_COMMITTED' THEN 'CLIENT_COMMITMENT'
    WHEN 'TASK_DEADLINE'   THEN 'USER_ENTERED'
    ELSE NULL -- NO_FIXED_DATE
  END
FROM (VALUES
  -- ── §6 Audit & Assurance ──────────────────────────────────────────────
  ('STAT_AUDIT',    'SA_ACCEPTANCE',   'Acceptance & Independence',   'mandatory',   'one_time', 5,  'HSDG_MILESTONE'),
  ('STAT_AUDIT',    'SA_PBC',          'PBC / Confirmations',         'mandatory',   'one_time', 15, 'CLIENT_COMMITTED'),
  ('STAT_AUDIT',    'SA_FS',           'Financial Statements',        'mandatory',   'one_time', 25, 'HSDG_MILESTONE'),
  ('STAT_AUDIT',    'SA_ARCHIVING',    'Archiving',                   'mandatory',   'one_time', 40, 'HSDG_MILESTONE'),
  ('TAX_AUDIT',     'TA_APPLICABILITY','Applicability Determination', 'mandatory',   'one_time', 5,  'STATUTORY_RULE'),
  ('TAX_AUDIT',     'TA_PBC',          'PBC / Records',               'mandatory',   'one_time', 15, 'CLIENT_COMMITTED'),
  ('INT_AUDIT',     'IA_PLAN',         'Risk Assessment & Plan',      'mandatory',   'quarterly',10, 'HSDG_MILESTONE'),
  ('INT_AUDIT',     'IA_TESTING',      'Walkthrough & Testing',       'mandatory',   'quarterly',20, 'HSDG_MILESTONE'),
  ('INT_AUDIT',     'IA_OBSERVATIONS', 'Observations & Mgmt Response','mandatory',   'quarterly',30, 'CLIENT_COMMITTED'),
  ('INT_AUDIT',     'IA_REPORT',       'Report & Follow-up',          'mandatory',   'quarterly',40, 'CLIENT_COMMITTED'),
  ('IFC',           'IFC_SCOPING',     'Scoping',                     'mandatory',   'annual',   10, 'HSDG_MILESTONE'),
  ('IFC',           'IFC_TESTING',     'Documentation & Testing',     'mandatory',   'annual',   20, 'HSDG_MILESTONE'),
  ('IFC',           'IFC_CONCLUSION',  'Deficiencies & Conclusion',   'mandatory',   'annual',   30, 'HSDG_MILESTONE'),
  ('LTD_REVIEW',    'LR_PLANNING',     'Planning & Inquiry',          'mandatory',   'quarterly',10, 'HSDG_MILESTONE'),
  ('LTD_REVIEW',    'LR_PROCEDURES',   'Analytical Procedures',       'mandatory',   'quarterly',20, 'HSDG_MILESTONE'),
  ('LTD_REVIEW',    'LR_CONCLUSION',   'Conclusion',                  'mandatory',   'quarterly',30, 'HSDG_MILESTONE'),
  ('CERTIFICATION', 'CERT_SCOPE',      'Scope & Verification',        'mandatory',   'as_required',10,'HSDG_MILESTONE'),
  ('CERTIFICATION', 'CERT_DELIVERY',   'Certificate & Delivery',      'mandatory',   'as_required',20,'CLIENT_COMMITTED'),
  ('AUP',           'AUP_PROCEDURES',  'Procedures & Evidence',       'mandatory',   'as_required',10,'HSDG_MILESTONE'),
  ('AUP',           'AUP_REPORT',      'Findings & Report',           'mandatory',   'as_required',20,'CLIENT_COMMITTED'),
  ('SPECIAL_AUDIT', 'SPA_SCOPE',       'Scope & Procedures',          'mandatory',   'as_required',10,'HSDG_MILESTONE'),
  ('SPECIAL_AUDIT', 'SPA_REPORT',      'Report',                      'mandatory',   'as_required',20,'CLIENT_COMMITTED'),
  ('DUE_DILIGENCE', 'DD_PBC',          'Scope & Data Room / PBC',     'mandatory',   'as_required',10,'CLIENT_COMMITTED'),
  ('DUE_DILIGENCE', 'DD_REVIEW',       'Financial / Tax Review',      'mandatory',   'as_required',20,'HSDG_MILESTONE'),
  ('DUE_DILIGENCE', 'DD_REPORT',       'Red Flags & Report',          'mandatory',   'as_required',30,'CLIENT_COMMITTED'),
  -- ── §7 Direct Tax ─────────────────────────────────────────────────────
  ('ITR_FILING',    'ITR_VERIFY',      'Verification',                'mandatory',   'annual',   30, 'STATUTORY_RULE'),
  ('ITR_FILING',    'ITR_RECON',       'Acknowledgement & Reconciliation','recommended','annual',40,'HSDG_MILESTONE'),
  ('TDS_COMPLIANCE','TDS_PAYMENT',     'Payment / Deposit',           'mandatory',   'monthly',  10, 'STATUTORY_FIXED'),
  ('TDS_COMPLIANCE','TDS_STATEMENT',   'Statements / Forms',          'mandatory',   'quarterly',20, 'STATUTORY_FIXED'),
  ('TDS_COMPLIANCE','TDS_CERTIFICATES','Certificates',                'mandatory',   'quarterly',30, 'STATUTORY_RULE'),
  ('TDS_COMPLIANCE','TDS_RECON',       'Reconciliation',              'recommended', 'quarterly',40, 'HSDG_MILESTONE'),
  ('TCS_COMPLIANCE','TCS_COLLECTION',  'Collection & Payment',        'mandatory',   'monthly',  10, 'STATUTORY_FIXED'),
  ('TCS_COMPLIANCE','TCS_STATEMENT',   'Statement & Certificates',    'mandatory',   'quarterly',20, 'STATUTORY_RULE'),
  ('TCS_COMPLIANCE','TCS_RECON',       'Reconciliation',              'recommended', 'quarterly',30, 'HSDG_MILESTONE'),
  ('ADVANCE_TAX',   'AT_INSTALMENTS',  'Instalments & Payment',       'mandatory',   'quarterly',10, 'STATUTORY_RULE'),
  ('ADVANCE_TAX',   'AT_RECON',        'Interest Review & Reconciliation','recommended','annual',20,'HSDG_MILESTONE'),
  ('INTL_TAX',      'IT_WITHHOLDING',  'Withholding & Forms',         'mandatory',   'as_required',10,'STATUTORY_RULE'),
  ('INTL_TAX',      'IT_TREATY',       'Treaty & Remittance',         'recommended', 'as_required',20,'STATUTORY_EVENT'),
  ('TAX_PLANNING',  'TP_SCENARIO',     'Scenario & Planning',         'optional',    'as_required',10,'CLIENT_COMMITTED'),
  ('TAX_PLANNING',  'TP_IMPLEMENT',    'Implementation',              'optional',    'as_required',20,'HSDG_MILESTONE'),
  ('TAX_ASSESSMENT','TXA_NOTICE',      'Notice & Response',           'mandatory',   'as_required',10,'STATUTORY_EVENT'),
  ('TAX_ASSESSMENT','TXA_ORDER',       'Assessment / Rectification',  'mandatory',   'as_required',20,'STATUTORY_EVENT'),
  ('TAX_APPEAL',    'TXP_LIMITATION',  'Limitation & Filing',         'mandatory',   'as_required',10,'STATUTORY_EVENT'),
  ('TAX_APPEAL',    'TXP_HEARING',     'Submission & Hearing',        'mandatory',   'as_required',20,'STATUTORY_EVENT'),
  -- ── §8 GST & Indirect Tax ─────────────────────────────────────────────
  ('GST_MONTHLY',   'CMP08',           'CMP-08 (Composition)',        'optional',    'quarterly',40, 'STATUTORY_FIXED'),
  ('GST_REGISTRATION','GSTR_NEW',      'New Registration',            'mandatory',   'as_required',10,'EVENT_SLA'),
  ('GST_REGISTRATION','GSTR_AMEND',    'Amendment / Cancellation',    'optional',    'as_required',20,'STATUTORY_EVENT'),
  ('GST_REGISTRATION','GSTR_LUT',      'LUT',                         'optional',    'annual',   30, 'STATUTORY_RULE'),
  ('GST_EINV_EWAY', 'GST_EINVOICE',    'E-Invoice',                   'mandatory',   'monthly',  10, 'STATUTORY_RULE'),
  ('GST_EINV_EWAY', 'GST_EWAYBILL',    'E-Way Bill',                  'mandatory',   'monthly',  20, 'EVENT_SLA'),
  ('GST_REFUND',    'GST_REFUND_APP',  'Refund Application',          'optional',    'as_required',10,'STATUTORY_EVENT'),
  ('GST_ADVISORY',  'GADV_OPINION',    'Classification & Opinions',   'optional',    'as_required',10,'CLIENT_COMMITTED'),
  ('GST_ASSESSMENT','GAS_NOTICE',      'Notice & Response',           'mandatory',   'as_required',10,'STATUTORY_EVENT'),
  ('GST_ASSESSMENT','GAS_ORDER',       'Adjudication / Order',        'mandatory',   'as_required',20,'STATUTORY_EVENT'),
  ('GST_APPEAL',    'GAP_LIMITATION',  'Limitation & Appeal',         'mandatory',   'as_required',10,'STATUTORY_EVENT'),
  ('GST_APPEAL',    'GAP_HEARING',     'Submission & Hearing',        'mandatory',   'as_required',20,'STATUTORY_EVENT'),
  -- ── §9 Accounting & Bookkeeping ───────────────────────────────────────
  ('BOOKKEEPING',   'BK_BANKREC',      'Bank Reconciliation',         'mandatory',   'monthly',  30, 'HSDG_RECURRING'),
  ('BOOKKEEPING',   'BK_LEDGER',       'Ledger Scrutiny',             'recommended', 'monthly',  40, 'HSDG_RECURRING'),
  ('BOOKKEEPING',   'BK_GSTTDS_RECON', 'GST / TDS Reconciliation',    'recommended', 'monthly',  50, 'HSDG_RECURRING'),
  ('FS_FINALISATION','FSF_ADJUSTMENTS','Adjustments & Schedules',     'mandatory',   'annual',   10, 'HSDG_MILESTONE'),
  ('FS_FINALISATION','FSF_STATEMENTS', 'Statements & Notes',          'mandatory',   'annual',   20, 'HSDG_MILESTONE'),
  ('FS_FINALISATION','FSF_CLOSURE',    'Audit Support & Closure',     'mandatory',   'annual',   30, 'CLIENT_COMMITTED'),
  ('MIS_REPORTING', 'MIS_PACK',        'Reporting Pack',              'optional',    'monthly',  10, 'CLIENT_COMMITTED'),
  ('MIS_REPORTING', 'MIS_VARIANCE',    'Variance & Commentary',       'optional',    'monthly',  20, 'HSDG_RECURRING'),
  -- ── §10 Payroll & Labour ──────────────────────────────────────────────
  ('PAYROLL',       'PR_COMPUTATION',  'Computation & Deductions',    'mandatory',   'monthly',  10, 'HSDG_RECURRING'),
  ('PAYROLL',       'PR_PAYSLIPS',     'Approval & Payslips',         'mandatory',   'monthly',  20, 'CLIENT_COMMITTED'),
  ('LABOUR_COMPLIANCE','LC_PF',        'Provident Fund (PF)',         'mandatory',   'monthly',  10, 'STATUTORY_FIXED'),
  ('LABOUR_COMPLIANCE','LC_ESI',       'ESI',                         'mandatory',   'monthly',  20, 'STATUTORY_FIXED'),
  ('LABOUR_COMPLIANCE','LC_PT',        'Professional Tax',            'mandatory',   'monthly',  30, 'STATUTORY_RULE'),
  ('LABOUR_COMPLIANCE','LC_RETURNS',   'Returns & Challans',          'mandatory',   'quarterly',40, 'STATUTORY_RULE'),
  -- ── §11 MCA / Corporate ───────────────────────────────────────────────
  ('ROC_ANNUAL',    'ROC_KYC',         'Director / KYC',              'mandatory',   'annual',   30, 'STATUTORY_RULE'),
  ('ROC_ANNUAL',    'ROC_REGISTERS',   'Statutory Registers',         'recommended', 'annual',   40, 'HSDG_RECURRING'),
  ('ROC_EVENT',     'ROCE_FILING',     'Event Filing',                'mandatory',   'as_required',10,'STATUTORY_EVENT'),
  ('ROC_EVENT',     'ROCE_SHARE',      'Share Filings',               'optional',    'as_required',20,'STATUTORY_EVENT'),
  ('ROC_EVENT',     'ROCE_BEN',        'Beneficial Ownership',        'optional',    'as_required',30,'STATUTORY_EVENT'),
  ('INCORPORATION', 'INC_NAME',        'Name & Incorporation',        'mandatory',   'as_required',10,'EVENT_SLA'),
  ('INCORPORATION', 'INC_INITIAL',     'Initial Compliance',          'mandatory',   'as_required',20,'STATUTORY_EVENT'),
  ('CORP_RESTRUCTURING','CR_DOCS',     'Documentation & Filings',     'mandatory',   'as_required',10,'STATUTORY_EVENT'),
  -- ── §12 Registrations & Licensing ─────────────────────────────────────
  ('REGISTRATIONS', 'REG_NEW',         'New Registration',            'mandatory',   'as_required',10,'EVENT_SLA'),
  ('REGISTRATIONS', 'REG_RENEWAL',     'Renewal',                     'mandatory',   'annual',   20, 'STATUTORY_FIXED'),
  ('REGISTRATIONS', 'REG_AMEND',       'Amendment / Cancellation',    'optional',    'as_required',30,'STATUTORY_EVENT'),
  -- ── §13 Transaction & Business Advisory ───────────────────────────────
  ('TXN_ADVISORY',  'TXN_PBC',         'Data Room / PBC',             'mandatory',   'as_required',10,'CLIENT_COMMITTED'),
  ('TXN_ADVISORY',  'TXN_MODEL',       'Financial Analysis / Model',  'optional',    'as_required',20,'HSDG_MILESTONE'),
  ('TXN_ADVISORY',  'TXN_AGREEMENT',   'Agreement Review',            'optional',    'as_required',30,'TASK_DEADLINE'),
  ('TXN_ADVISORY',  'TXN_CLOSING',     'Negotiation / Closing Support','optional',   'as_required',40,'CLIENT_COMMITTED'),
  -- ── §14 FEMA, International, Valuation ─────────────────────────────────
  ('FEMA',          'FEMA_FDI',        'FDI / ODI / RBI Reporting',   'mandatory',   'as_required',10,'STATUTORY_EVENT'),
  ('FEMA',          'FEMA_REMITTANCE', 'Foreign Remittance',          'optional',    'as_required',20,'EVENT_SLA'),
  ('FEMA',          'FEMA_OPINION',    'Opinion & Review',            'optional',    'as_required',30,'CLIENT_COMMITTED'),
  ('VALUATION',     'VAL_SCOPE',       'Scope & Methodology',         'mandatory',   'as_required',10,'CLIENT_COMMITTED'),
  ('VALUATION',     'VAL_MODEL',       'Model & Analysis',            'mandatory',   'as_required',20,'HSDG_MILESTONE'),
  ('VALUATION',     'VAL_REPORT',      'Report & Certificate',        'mandatory',   'as_required',30,'CLIENT_COMMITTED'),
  -- ── §15 CFO, Governance, Forensic ─────────────────────────────────────
  ('VIRTUAL_CFO',   'VCFO_CLOSE',      'Monthly Close & MIS',         'mandatory',   'monthly',  10, 'HSDG_RECURRING'),
  ('VIRTUAL_CFO',   'VCFO_CASHFLOW',   'Cash Flow & Working Capital', 'recommended', 'monthly',  20, 'CLIENT_COMMITTED'),
  ('VIRTUAL_CFO',   'VCFO_BOARD',      'Budgeting & Board Reporting', 'optional',    'quarterly',30, 'HSDG_MILESTONE'),
  ('GOVERNANCE',    'GOV_MEETINGS',    'Board / Meetings & Minutes',  'mandatory',   'quarterly',10, 'STATUTORY_RULE'),
  ('GOVERNANCE',    'GOV_SECRETARIAL', 'Secretarial Review & Records','recommended', 'quarterly',20, 'HSDG_RECURRING'),
  ('GOVERNANCE',    'GOV_COMPLIANCE',  'Compliance Review & Follow-up','optional',   'quarterly',30, 'HSDG_MILESTONE'),
  ('FORENSIC',      'FOR_EVIDENCE',    'Evidence Preservation & Data','mandatory',   'as_required',10,'HSDG_MILESTONE'),
  ('FORENSIC',      'FOR_ANALYSIS',    'Testing & Analysis',          'mandatory',   'as_required',20,'HSDG_MILESTONE'),
  ('FORENSIC',      'FOR_REPORT',      'Findings & Report',           'mandatory',   'as_required',30,'CLIENT_COMMITTED')
) AS v(service_code, code, name, applicability, frequency, display_order, cat)
JOIN hsdg.services s ON s.code = v.service_code
ON CONFLICT (code) DO NOTHING;

ALTER TABLE hsdg.service_lines      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services           FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.review_models      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.workflow_families  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;

-- Down Migration
-- Data-only expansion; the down path removes exactly what was added (children
-- first, then the new services and service lines). Codes are the stable keys.

ALTER TABLE hsdg.service_components NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_lines      NO FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.service_components WHERE code IN (
  'SA_ACCEPTANCE','SA_PBC','SA_FS','SA_ARCHIVING','TA_APPLICABILITY','TA_PBC',
  'IA_PLAN','IA_TESTING','IA_OBSERVATIONS','IA_REPORT','IFC_SCOPING','IFC_TESTING',
  'IFC_CONCLUSION','LR_PLANNING','LR_PROCEDURES','LR_CONCLUSION','CERT_SCOPE',
  'CERT_DELIVERY','AUP_PROCEDURES','AUP_REPORT','SPA_SCOPE','SPA_REPORT','DD_PBC',
  'DD_REVIEW','DD_REPORT','ITR_VERIFY','ITR_RECON','TDS_PAYMENT','TDS_STATEMENT',
  'TDS_CERTIFICATES','TDS_RECON','TCS_COLLECTION','TCS_STATEMENT','TCS_RECON',
  'AT_INSTALMENTS','AT_RECON','IT_WITHHOLDING','IT_TREATY','TP_SCENARIO','TP_IMPLEMENT',
  'TXA_NOTICE','TXA_ORDER','TXP_LIMITATION','TXP_HEARING','CMP08','GSTR_NEW','GSTR_AMEND',
  'GSTR_LUT','GST_EINVOICE','GST_EWAYBILL','GST_REFUND_APP','GADV_OPINION','GAS_NOTICE',
  'GAS_ORDER','GAP_LIMITATION','GAP_HEARING','BK_BANKREC','BK_LEDGER','BK_GSTTDS_RECON',
  'FSF_ADJUSTMENTS','FSF_STATEMENTS','FSF_CLOSURE','MIS_PACK','MIS_VARIANCE',
  'PR_COMPUTATION','PR_PAYSLIPS','LC_PF','LC_ESI','LC_PT','LC_RETURNS','ROC_KYC',
  'ROC_REGISTERS','ROCE_FILING','ROCE_SHARE','ROCE_BEN','INC_NAME','INC_INITIAL',
  'CR_DOCS','REG_NEW','REG_RENEWAL','REG_AMEND','TXN_PBC','TXN_MODEL','TXN_AGREEMENT',
  'TXN_CLOSING','FEMA_FDI','FEMA_REMITTANCE','FEMA_OPINION','VAL_SCOPE','VAL_MODEL',
  'VAL_REPORT','VCFO_CLOSE','VCFO_CASHFLOW','VCFO_BOARD','GOV_MEETINGS','GOV_SECRETARIAL',
  'GOV_COMPLIANCE','FOR_EVIDENCE','FOR_ANALYSIS','FOR_REPORT'
);

DELETE FROM hsdg.services WHERE code IN (
  'IFC','LTD_REVIEW','CERTIFICATION','AUP','SPECIAL_AUDIT','DUE_DILIGENCE',
  'TDS_COMPLIANCE','TCS_COMPLIANCE','ADVANCE_TAX','INTL_TAX','TAX_PLANNING',
  'TAX_ASSESSMENT','TAX_APPEAL','GST_REGISTRATION','GST_EINV_EWAY','GST_REFUND',
  'GST_ADVISORY','GST_ASSESSMENT','GST_APPEAL','FS_FINALISATION','MIS_REPORTING',
  'PAYROLL','LABOUR_COMPLIANCE','ROC_EVENT','INCORPORATION','CORP_RESTRUCTURING',
  'REGISTRATIONS','TXN_ADVISORY','FEMA','VALUATION','VIRTUAL_CFO','GOVERNANCE','FORENSIC'
);

DELETE FROM hsdg.service_lines WHERE code IN ('PAYROLL','REGISTRATIONS');

ALTER TABLE hsdg.service_components FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services           FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_lines      FORCE ROW LEVEL SECURITY;

-- Up Migration
-- 02.2 Financial Reporting Framework (Section 02.2 spec §15, §20):
--   • the FRF-05 professional action (confirm / override / information pending)
--     and its pending reason, and the Engagement Partner approval of a
--     significant override / complex conclusion, on the shared sub-assessment
--     row (nullable — 02.3–02.7 do not use them);
--   • the Rule 4 sub-provisions and SMC definitions the 02.2 roadmap rules cite,
--     so View Provision opens the exact clause that fired.
ALTER TABLE hsdg.audit_framework_subassessment
  ADD COLUMN professional_action text
    CHECK (professional_action IS NULL
           OR professional_action IN ('confirm','override','information_pending')),
  ADD COLUMN pending_reason text,
  ADD COLUMN partner_approved_by_employee_id uuid
    REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN partner_approved_at timestamptz,
  ADD COLUMN partner_note text;

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to,
   source_reference, reference_kind, summary)
VALUES
  ('INDAS_RULE_4_1_I', 'MCA', 'Voluntary adoption of Ind AS', 'Rule 4(1)(i)',
   '2015-04-01', NULL,
   'Companies (Indian Accounting Standards) Rules 2015, Rule 4(1)(i)', 'provision',
   'Any company, and its holding, subsidiary, joint venture or associate companies, may comply with Ind AS for financial statements for accounting periods beginning on or after 1 April 2015; once followed, Ind AS applies to all later periods.'),
  ('INDAS_RULE_4_2A', 'MCA', 'Ind AS roadmap for NBFCs', 'Rule 4(1)(iv)',
   '2016-03-30', NULL,
   'Companies (Indian Accounting Standards) Rules 2015, Rule 4(1)(iv) as amended 2016', 'provision',
   'NBFCs with net worth of ₹500 crore or more apply Ind AS from periods beginning on or after 1 April 2018; listed / in-process NBFCs below ₹500 crore and unlisted NBFCs of ₹250–500 crore from 1 April 2019; with their holding, subsidiary, joint venture and associate companies.'),
  ('INDAS_RULE_4_PROVISO', 'MCA', 'SME exchange / ITP exception', 'Rule 4(1) proviso',
   '2015-04-01', NULL,
   'Companies (Indian Accounting Standards) Rules 2015, proviso to Rule 4(1)', 'provision',
   'Companies whose securities are listed or in the process of listing on an SME exchange (Chapter XB, SEBI ICDR) or on the Institutional Trading Platform without an IPO are not required to apply the mandatory Ind AS roadmap; they may still adopt Ind AS voluntarily.'),
  ('AS_RULES_2021_SMC', 'MCA', 'Small and Medium Sized Company (SMC)', 'Rule 2(1)(e)',
   '2021-04-01', NULL,
   'Companies (Accounting Standards) Rules 2021, Rule 2(1)(e)', 'provision',
   'An SMC is a company whose securities are not listed or in process of listing in or outside India; which is not a bank, financial institution or insurance company; whose turnover (excluding other income) does not exceed ₹250 crore and whose borrowings (including public deposits) do not exceed ₹50 crore at any time in the immediately preceding accounting year; and which is not a holding or subsidiary of a company that is not an SMC.'),
  ('AS_RULES_2006_SMC', 'MCA', 'Small and Medium Sized Company (SMC) — 2006 Rules', 'Rule 2(f)',
   '2006-12-07', '2021-03-31',
   'Companies (Accounting Standards) Rules 2006, Rule 2(f)', 'provision',
   'An SMC under the 2006 Rules: not listed or in process of listing; not a bank, financial institution or insurance company; turnover (excluding other income) not exceeding ₹50 crore and borrowings (including public deposits) not exceeding ₹10 crore at any time in the immediately preceding accounting year; and not a holding or subsidiary of a non-SMC.')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_provision
 WHERE code IN ('INDAS_RULE_4_1_I','INDAS_RULE_4_2A','INDAS_RULE_4_PROVISO',
                'AS_RULES_2021_SMC','AS_RULES_2006_SMC');
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.audit_framework_subassessment
  DROP COLUMN IF EXISTS partner_note,
  DROP COLUMN IF EXISTS partner_approved_at,
  DROP COLUMN IF EXISTS partner_approved_by_employee_id,
  DROP COLUMN IF EXISTS pending_reason,
  DROP COLUMN IF EXISTS professional_action;

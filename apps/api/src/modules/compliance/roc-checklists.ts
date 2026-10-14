import type { TemplateItem } from './compliance-checklist';

/**
 * Per-form checklists for the eleven recurring ROC / MCA items
 * (docs/roc-mca-filing-spec.md §5, P1-4), seeded as catalogue_templates
 * FILING_<RULE_CODE> — the resolver looks those up before the generic
 * FILING_ROC. scripts/gen-calendar-v2-rules.ts writes them into
 * 1771100000000_roc_rules_checklists.sql, so the seeded bodies are the tested ones.
 *
 * onlyIf reads the CIN profile as resolveCinFacts sees it (hasSubsidiaries,
 * csrApplicable, …) plus hasAgm / isOpc; see seedChecklistForInstance.
 */

export interface RocChecklist {
  code: string;
  name: string;
  body: { items: TemplateItem[] };
}

type Line = Omit<TemplateItem, 'sequence'>;

/** Every filing ends with these three lines (§5 "common tail"). */
function tail(dscLabel = 'Signed with DSC (director / designated partner)'): Line[] {
  return [
    { code: 'DSC', label: dscLabel, required: true },
    { code: 'REVIEW', label: 'Review', required: true, autoTick: 'review' },
    { code: 'LODGE', label: 'Lodge (SRN)', slotCode: 'ACK_ROC', required: true, autoTick: 'lodge' },
  ];
}

const doc = (code: string, label: string, slotCode: string, required = true): Line => ({
  code,
  label,
  slotCode,
  required,
  autoTick: 'document',
});

const FORM_PREPARED = doc('FORM', 'Form prepared', 'ROC_FORM');
const FORM_SCRUTINY = doc('FORM', 'Form prepared, pre-scrutiny passed', 'ROC_FORM');

function checklist(ruleCode: string, name: string, lines: Line[]): RocChecklist {
  return {
    code: `FILING_${ruleCode}`,
    name,
    body: { items: lines.map((l, i) => ({ ...l, sequence: i + 1 })) },
  };
}

export const ROC_CHECKLISTS: RocChecklist[] = [
  checklist('ROC_AGM', 'ROC — AGM', [
    doc(
      'FS_APPROVED',
      'Board approved the financial statements and board’s report',
      'BOARD_MINUTES_FS',
    ),
    doc('NOTICE', 'AGM notice sent (21 clear days, s.101)', 'AGM_NOTICE'),
    { code: 'AUDITOR_AGENDA', label: 'Auditor appointment on the agenda (in a rotation year)' },
    doc('MINUTES', 'AGM minutes and attendance', 'AGM_MINUTES'),
    { code: 'REVIEW', label: 'Review', required: true, autoTick: 'review' },
    {
      code: 'HELD',
      label: 'Record meeting (held on)',
      slotCode: 'AGM_MINUTES',
      required: true,
      autoTick: 'lodge',
    },
  ]),
  checklist('ROC_BOARD_MEETING', 'ROC — board meeting', [
    doc('NOTICE', 'Notice and agenda sent (7 days, s.173(3))', 'BM_NOTICE'),
    { code: 'ATTENDANCE', label: 'Quorum and attendance recorded' },
    doc('MINUTES', 'Signed minutes', 'BM_MINUTES'),
    {
      code: 'HELD',
      label: 'Record meeting (held on)',
      slotCode: 'BM_MINUTES',
      required: true,
      autoTick: 'lodge',
    },
  ]),
  checklist('ROC_AOC4', 'ROC — AOC-4 (financial statements)', [
    doc(
      'FS_SIGNED',
      'Signed financial statements (balance sheet, P&L, cash flow, notes)',
      'FS_SIGNED',
    ),
    doc('AUDIT_REPORT', 'Auditor’s report, with CARO where it applies', 'AUDIT_REPORT'),
    doc('BOARD_REPORT', 'Board’s report with annexures (AOC-1, AOC-2 …)', 'BOARD_REPORT'),
    {
      ...doc('CFS', 'Consolidated financial statements and auditor’s report', 'CFS'),
      onlyIf: 'hasSubsidiaries',
    },
    { ...doc('CSR', 'CSR annual report', 'CSR_REPORT'), onlyIf: 'csrApplicable' },
    {
      ...doc('MR3', 'Secretarial audit report MR-3', 'MR3'),
      onlyIf: 'secretarialAuditRequired',
      note: 'Client dependency: a CS in practice certifies it.',
    },
    {
      code: 'AGM_HELD',
      label: 'AGM held and accounts adopted',
      required: true,
      autoTick: 'event',
      onlyIf: 'hasAgm',
    },
    {
      code: 'ADOPTED',
      label: 'Accounts adopted by the member (OPC)',
      required: true,
      onlyIf: 'isOpc',
    },
    FORM_SCRUTINY,
    {
      code: 'CERT',
      label: 'Certified by a practising CA',
      required: true,
      tickedBy: 'partner',
      note: 'Partner ticks; UDIN in the note.',
    },
    ...tail(),
  ]),
  checklist('ROC_MGT7', 'ROC — MGT-7 / MGT-7A (annual return)', [
    { code: 'AGM_HELD', label: 'AGM held', required: true, autoTick: 'event', onlyIf: 'hasAgm' },
    doc('SHAREHOLDERS', 'Shareholder / debenture-holder list and transfers in the year', 'SH_LIST'),
    {
      code: 'MEETINGS',
      label: 'Board and committee meetings and attendance for the year',
      autoTick: 'meetings',
    },
    {
      ...doc('MGT8', 'MGT-8 by a CS in practice', 'MGT8'),
      onlyIf: 'mgt8Required',
      note: 'Client dependency: a CS in practice certifies it.',
    },
    FORM_SCRUTINY,
    ...tail(),
  ]),
  checklist('ROC_ADT1', 'ROC — ADT-1 (auditor appointment)', [
    doc('RESOLUTION', 'Resolution appointing the auditor (term and remuneration)', 'RESOLUTION'),
    doc(
      'CONSENT',
      'Auditor’s consent and eligibility certificate (s.139(1), s.141)',
      'AUDITOR_CONSENT',
    ),
    { code: 'INTIMATION', label: 'Appointment letter to the auditor' },
    FORM_PREPARED,
    ...tail(),
  ]),
  checklist('ROC_DPT3', 'ROC — DPT-3 (deposits and exempted loans)', [
    doc('SCHEDULE', 'Loans / receipts outstanding at 31 March (lender-wise schedule)', 'DPT_DATA'),
    doc(
      'AUDITOR_CERT',
      'Auditor’s certificate (where deposits are held)',
      'DPT_AUDITOR_CERT',
      false,
    ),
    FORM_PREPARED,
    ...tail(),
  ]),
  checklist('ROC_MSME1', 'ROC — MSME-1 (dues to micro / small suppliers)', [
    doc(
      'MSME_LIST',
      'Supplier-wise dues over 45 days, with amounts, dates and reasons',
      'MSME_DATA',
    ),
    FORM_PREPARED,
    ...tail(),
  ]),
  checklist('ROC_PAS6', 'ROC — PAS-6 (share capital reconciliation)', [
    doc('RTA_DATA', 'Depository / RTA holding data for the half-year', 'PAS6_DATA'),
    doc('CERT_REPORT', 'Reconciliation report signed by a practising CA / CS', 'PAS6_CERT'),
    FORM_PREPARED,
    ...tail(),
  ]),
  checklist('ROC_DIR3_KYC', 'ROC — DIR-3 KYC', [
    doc('KYC_DOCS', 'PAN, Aadhaar, address proof; mobile and e-mail OTP verified', 'KYC_DOCS'),
    { code: 'CERT', label: 'Certified by a practising professional (e-form only)' },
    ...tail('Signed with the director’s own DSC'),
  ]),
  checklist('LLP_FORM11', 'LLP — Form 11 (annual return)', [
    doc('PARTNERS', 'Partners, contributions and changes in the year', 'LLP_PARTNERS'),
    FORM_PREPARED,
    ...tail('Signed with DSC (designated partners)'),
  ]),
  checklist('LLP_FORM8', 'LLP — Form 8 (statement of account and solvency)', [
    doc(
      'ACCOUNTS',
      'Signed statement of account; audit report where the LLP is audited',
      'LLP_ACCOUNTS',
    ),
    { code: 'SOLVENCY', label: 'Solvency declaration by the designated partners', required: true },
    {
      code: 'CERT',
      label: 'Certified by a practising CA / CS / CMA',
      required: true,
      tickedBy: 'partner',
      note: 'Partner ticks; UDIN in the note.',
    },
    FORM_PREPARED,
    ...tail('Signed with DSC (designated partners)'),
  ]),
];

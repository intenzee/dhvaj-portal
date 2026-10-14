/**
 * Generates db/migrations/1770100000000_calendar_v2_rules.sql,
 * 1770900000000_firm_policy_rules.sql and 1771100000000_roc_rules_checklists.sql
 * from the typed rule catalogues in
 * apps/api/src/modules/compliance/calendar-v2-rules.ts (and the ROC checklists in
 * roc-checklists.ts), so the seeded encodings are exactly the ones the unit
 * tests check.
 *
 *   npx ts-node -P apps/api/tsconfig.json scripts/gen-calendar-v2-rules.ts
 *
 * Re-run after editing the catalogue and commit both files.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STREAM_SERVICE_CODE } from '@hsdg/contracts';
import {
  CALENDAR_V2_EXTENSIONS,
  CALENDAR_V2_RULES,
  FIRM_POLICY_RULES,
  type SeedRule,
} from '../apps/api/src/modules/compliance/calendar-v2-rules';
import { ROC_CHECKLISTS } from '../apps/api/src/modules/compliance/roc-checklists';

const MIGRATIONS = join(__dirname, '..', 'db', 'migrations');
const OUT = join(MIGRATIONS, '1770100000000_calendar_v2_rules.sql');
const FIRM_OUT = join(MIGRATIONS, '1770900000000_firm_policy_rules.sql');
const RETIRE_FROM = '2026-04-01';
const RETIRE_MARK = 'calendar-v2 retirement';

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const ruleRows = (catalogue: SeedRule[]) =>
  catalogue.map((r) => ({
    code: r.code,
    name: r.name,
    description: r.notes,
    category: r.category,
    due_date_category: r.dueDateCategory,
    service_code: STREAM_SERVICE_CODE[r.stream],
  }));

const versionRows = (catalogue: SeedRule[]) =>
  catalogue.flatMap((r) =>
    r.versions.map((v, i) => ({
      code: r.code,
      version: i + 1,
      effective_from: v.effectiveFrom,
      effective_to: r.versions[i + 1] ? dayBefore(r.versions[i + 1]!.effectiveFrom) : null,
      calculation_basis: r.basis,
      offset_months: r.offsetMonths ?? 0,
      offset_days: r.offsetDays ?? 0,
      internal_sla_offset_days: r.internalSlaOffsetDays,
      condition: r.condition ?? null,
      notes: r.notes,
      stream: r.stream,
      registration_scope: r.registrationScope,
      frequency: r.frequency,
      form_label: v.formLabel,
      section: r.section ?? null,
      schedule: v.schedule ?? r.schedule ?? null,
      period_overrides: r.periodOverrides ?? null,
      period_filter: r.periodFilter ?? null,
      event_type: r.eventType ?? null,
      provisional_event_rule: r.provisionalEventRule ?? null,
      variants: r.variants ?? null,
      is_optional: r.isOptional ?? false,
      late_fee_note: r.lateFeeNote ?? null,
      verification: r.verification ?? 'verified',
      source_ref: v.sourceRef ?? r.sourceRef ?? null,
    })),
  );

const rules = ruleRows(CALENDAR_V2_RULES);
const versions = versionRows(CALENDAR_V2_RULES);

const statementSchedule = CALENDAR_V2_RULES.find((r) => r.code === 'TDS_F140')!.schedule;
const certificateSchedule = CALENDAR_V2_RULES.find((r) => r.code === 'TDS_F131')!.schedule;

/**
 * The live rules with the defects the spec lists are retired by a new version
 * from 1 Apr 2026 — never edited in place, so past instances keep the version
 * they were computed from. Every seeded rule also stops shifting to the next
 * working day (relief comes only from government extensions).
 */
const retirements = [
  {
    code: 'TDS_STATEMENT_QUARTERLY',
    frequency: 'quarterly',
    calculation_basis: 'schedule',
    schedule: statementSchedule,
  },
  {
    code: 'TDS_CERTIFICATES_QTR',
    frequency: 'quarterly',
    calculation_basis: 'schedule',
    schedule: certificateSchedule,
  },
  {
    code: 'TCS_STATEMENT_QUARTERLY',
    frequency: 'quarterly',
    calculation_basis: 'schedule',
    schedule: statementSchedule,
  },
  {
    code: 'TDS_PAYMENT_MONTHLY',
    frequency: 'monthly',
    period_overrides: { '03': { month: 4, day: 30 } },
  },
  {
    code: 'DIR3_KYC_ANNUAL',
    frequency: 'triennial',
    calculation_basis: 'schedule',
    schedule: [{ period: 'FY', month: 6, day: 30, year_offset: 1 }],
  },
  {
    code: 'ROC_AOC4_DUE',
    frequency: 'annual',
    calculation_basis: 'event_date',
    offset_months: 0,
    offset_days: 30,
    event_type: 'agm',
    provisional_event_rule: { month: 9, day: 30, year_offset: 1 },
  },
  {
    code: 'ROC_MGT7_DUE',
    frequency: 'annual',
    calculation_basis: 'event_date',
    offset_months: 0,
    offset_days: 60,
    event_type: 'agm',
    provisional_event_rule: { month: 9, day: 30, year_offset: 1 },
  },
  ...[
    'ADVANCE_TAX_Q1',
    'BEN2_DECLARATION',
    'BOARD_MEETING_QUARTERLY',
    'CMP08_QUARTERLY',
    'ESI_MONTHLY',
    'FCGPR_REPORTING',
    'GSTR1_MONTHLY',
    'GSTR3B_MONTHLY',
    'GSTR9C_ANNUAL',
    'GSTR9_ANNUAL',
    'GST_AMENDMENT_LIMITATION',
    'GST_APPEAL_LIMITATION',
    'GST_LUT_ANNUAL',
    'INC20A_COMMENCEMENT',
    'ITR_FILING_DUE',
    'ITR_VERIFICATION_DUE',
    'IT_APPEAL_LIMITATION',
    'LABOUR_RETURNS_QTR',
    'PAS3_ALLOTMENT',
    'PF_MONTHLY',
    'PT_MONTHLY',
    'ROC_EVENT_FILING',
    'TAX_AUDIT_44AB',
    'TCS_COLLECTION_MONTHLY',
  ].map((code) => ({ code })),
];

/** One row per line keeps the generated migration reviewable. */
const json = (rows: readonly unknown[]) =>
  `$json$[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]$json$::jsonb`;
/** Insert rules (on their stream service) and their versions; re-runnable. */
const insertRules = (
  ruleList: ReturnType<typeof ruleRows>,
  versionList: ReturnType<typeof versionRows>,
) => `INSERT INTO hsdg.compliance_rules
  (code, name, description, service_id, category, is_active, due_date_category, due_date_source)
SELECT x.code, x.name, x.description, s.id, x.category, true, x.due_date_category, 'LAW_RULE'
FROM jsonb_to_recordset(${json(ruleList)})
  AS x(code text, name text, description text, category text, due_date_category text, service_code text)
JOIN hsdg.services s ON s.code = x.service_code
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.compliance_rule_versions
  (compliance_rule_id, version, effective_from, effective_to, calculation_basis, offset_months,
   offset_days, working_day_adjustment, internal_sla_offset_days, condition, notes, stream,
   registration_scope, frequency, form_label, section, schedule, period_overrides, period_filter,
   event_type, provisional_event_rule, variants, is_optional, late_fee_note, verification, source_ref)
SELECT r.id, v.version, v.effective_from, v.effective_to, v.calculation_basis, v.offset_months,
       v.offset_days, 'none', v.internal_sla_offset_days, v.condition, v.notes, v.stream,
       v.registration_scope, v.frequency, v.form_label, v.section, v.schedule, v.period_overrides,
       CASE WHEN v.period_filter IS NULL THEN NULL
            ELSE ARRAY(SELECT jsonb_array_elements_text(v.period_filter)) END,
       v.event_type, v.provisional_event_rule, v.variants, v.is_optional, v.late_fee_note,
       v.verification, v.source_ref
FROM jsonb_to_recordset(${json(versionList)})
  AS v(code text, version int, effective_from date, effective_to date, calculation_basis text,
       offset_months int, offset_days int, internal_sla_offset_days int, condition jsonb, notes text,
       stream text, registration_scope text, frequency text, form_label text, section text,
       schedule jsonb, period_overrides jsonb, period_filter jsonb, event_type text,
       provisional_event_rule jsonb, variants jsonb, is_optional boolean, late_fee_note text,
       verification text, source_ref text)
JOIN hsdg.compliance_rules r ON r.code = v.code
ON CONFLICT (compliance_rule_id, version) DO NOTHING;`;

const newCodes = `ARRAY[${CALENDAR_V2_RULES.map((r) => `'${r.code}'`).join(',')}]`;
const retiredCodes = `ARRAY[${retirements.map((r) => `'${r.code}'`).join(',')}]`;
const RLS_TABLES = [
  'services',
  'compliance_rules',
  'compliance_rule_versions',
  'government_extensions',
  'compliance_instances',
];
const rls = (mode: 'NO FORCE' | 'FORCE') =>
  RLS_TABLES.map((t) => `ALTER TABLE hsdg.${t} ${mode} ROW LEVEL SECURITY;`).join('\n');

const sql = `-- ─────────────────────────────────────────────────────────────────────────
-- Calendar v2 rules (spec Change 4). GENERATED by scripts/gen-calendar-v2-rules.ts
-- from apps/api/src/modules/compliance/calendar-v2-rules.ts — edit the catalogue
-- and re-run the script; do not edit this file by hand.
--
--   * ${CALENDAR_V2_RULES.length} curated rules (the Recurring Summary's 45 rows, two for
--     3CEB / TP ITR, and the 13 Event-Based rows), each on its stream service,
--     with effective-dated versions (26Q → Form 140 from 1 Apr 2026, …).
--   * The CBDT 28 Sep 2026 extensions on IT_TAX_AUDIT and IT_ITR_AUDIT.
--   * The defective live rules are retired by a version from ${RETIRE_FROM}
--     (working_day_adjustment 'none'; corrected TDS / TCS / AOC-4 / MGT-7 /
--     DIR-3 KYC encodings). Past instances keep the version they used.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

${rls('NO FORCE')}

${insertRules(rules, versions)}

-- CBDT Circular (28 Sep 2026) on the new rules; 3CEB and the TP ITR are not extended.
INSERT INTO hsdg.government_extensions
  (compliance_rule_id, original_due_date, revised_due_date, notification_reference,
   applicable_population, effective_date, notes)
SELECT r.id, e.original, e.revised, 'CBDT Circular (28 Sep 2026)',
       'Assessees whose accounts are required to be audited, AY 2026-27; not TP (3CEB) cases',
       '2026-09-28'::date, 'Seeded with the calendar v2 rules.'
FROM jsonb_to_recordset(${json(CALENDAR_V2_EXTENSIONS)})
  AS e("ruleCode" text, original date, revised date)
JOIN hsdg.compliance_rules r ON r.code = e."ruleCode"
WHERE NOT EXISTS (
  SELECT 1 FROM hsdg.government_extensions ge
   WHERE ge.compliance_rule_id = r.id AND ge.original_due_date = e.original
);

-- Retire the defective live rules by a new version (never edited in place).
UPDATE hsdg.compliance_rule_versions v
   SET effective_to = '${dayBefore(RETIRE_FROM)}'
  FROM hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id
   AND r.code = ANY(${retiredCodes})
   AND v.effective_to IS NULL
   AND v.effective_from < '${RETIRE_FROM}'
   AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_rule_versions x
                    WHERE x.compliance_rule_id = r.id AND x.effective_from >= '${RETIRE_FROM}');

INSERT INTO hsdg.compliance_rule_versions
  (compliance_rule_id, version, effective_from, calculation_basis, offset_months, offset_days,
   fixed_month, fixed_day, working_day_adjustment, internal_sla_offset_days, condition, notes,
   offset_working_days, frequency, schedule, period_overrides, event_type, provisional_event_rule)
SELECT r.id, cur.version + 1, '${RETIRE_FROM}',
       COALESCE(f.calculation_basis, cur.calculation_basis),
       COALESCE(f.offset_months, cur.offset_months),
       COALESCE(f.offset_days, cur.offset_days),
       CASE WHEN COALESCE(f.calculation_basis, cur.calculation_basis) = 'fixed_date' THEN cur.fixed_month END,
       CASE WHEN COALESCE(f.calculation_basis, cur.calculation_basis) = 'fixed_date' THEN cur.fixed_day END,
       'none', cur.internal_sla_offset_days, cur.condition,
       '${RETIRE_MARK}: ' || COALESCE(cur.notes, r.name),
       cur.offset_working_days, f.frequency, f.schedule, f.period_overrides, f.event_type,
       f.provisional_event_rule
FROM jsonb_to_recordset(${json(retirements)})
  AS f(code text, frequency text, calculation_basis text, offset_months int, offset_days int,
       schedule jsonb, period_overrides jsonb, event_type text, provisional_event_rule jsonb)
JOIN hsdg.compliance_rules r ON r.code = f.code
JOIN LATERAL (
  SELECT * FROM hsdg.compliance_rule_versions v
   WHERE v.compliance_rule_id = r.id ORDER BY v.version DESC LIMIT 1
) cur ON true
WHERE cur.effective_from < '${RETIRE_FROM}';

${rls('FORCE')}

-- Down Migration

${rls('NO FORCE')}

DELETE FROM hsdg.compliance_rule_versions v
 USING hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id
   AND r.code = ANY(${retiredCodes})
   AND v.effective_from = '${RETIRE_FROM}'
   AND v.notes LIKE '${RETIRE_MARK}:%';

UPDATE hsdg.compliance_rule_versions v
   SET effective_to = NULL
  FROM hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id
   AND r.code = ANY(${retiredCodes})
   AND v.effective_to = '${dayBefore(RETIRE_FROM)}'
   AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_rule_versions x
                    WHERE x.compliance_rule_id = r.id AND x.effective_from > v.effective_from);

DELETE FROM hsdg.compliance_instances ci
 USING hsdg.compliance_rules r
 WHERE r.id = ci.compliance_rule_id AND r.code = ANY(${newCodes});

DELETE FROM hsdg.government_extensions ge
 USING hsdg.compliance_rules r
 WHERE r.id = ge.compliance_rule_id AND r.code = ANY(${newCodes});

DELETE FROM hsdg.compliance_rules WHERE code = ANY(${newCodes});

${rls('FORCE')}
`;

writeFileSync(OUT, sql);
console.log(`wrote ${OUT} (${CALENDAR_V2_RULES.length} rules, ${versions.length} versions)`);

// ── Firm-policy rules: Inward reconciliation, Bookkeeping month-close, MIS ──

/** Checklists for the streams that had none (Inward uses FILING_GST_INWARD). */
const FIRM_TEMPLATES = [
  {
    code: 'FILING_BOOKKEEPING',
    name: 'Bookkeeping — month-close',
    body: {
      items: [
        {
          code: 'DATA_RECEIVED',
          label: 'Data received (bank statements, bills, vouchers)',
          slotCode: 'CLIENT_DATA',
          required: true,
          sequence: 1,
          autoTick: 'document',
          note: 'Client data; internal date 5th of next month',
        },
        {
          code: 'BANK_RECON',
          label: 'Bank reconciliation',
          slotCode: 'BANK_RECON',
          required: true,
          sequence: 2,
          autoTick: 'document',
        },
        { code: 'LEDGER_SCRUTINY', label: 'Ledger scrutiny', required: true, sequence: 3 },
        {
          code: 'TAX_RECON',
          label: 'GST / TDS reconciliation with the books',
          slotCode: 'TAX_RECON',
          required: true,
          sequence: 4,
          autoTick: 'document',
        },
        { code: 'REVIEW', label: 'Review', required: true, sequence: 5, autoTick: 'review' },
        {
          code: 'LODGE',
          label: 'Books closed',
          slotCode: 'TRIAL_BALANCE',
          required: true,
          sequence: 6,
          autoTick: 'lodge',
        },
      ],
    },
  },
  {
    code: 'FILING_MIS',
    name: 'MIS — monthly pack',
    body: {
      items: [
        {
          code: 'BOOKS_CLOSED',
          label: 'Books closed for the month',
          required: true,
          sequence: 1,
          note: 'From the Bookkeeping tab',
        },
        {
          code: 'MIS_PACK',
          label: 'MIS pack prepared',
          slotCode: 'MIS_PACK',
          required: true,
          sequence: 2,
          autoTick: 'document',
        },
        { code: 'VARIANCE', label: 'Variance commentary written', required: true, sequence: 3 },
        { code: 'REVIEW', label: 'Review', required: true, sequence: 4, autoTick: 'review' },
        {
          code: 'LODGE',
          label: 'Sent to client',
          slotCode: 'MIS_SENT',
          required: true,
          sequence: 5,
          autoTick: 'lodge',
        },
      ],
    },
  },
];

const firmCodes = `ARRAY[${FIRM_POLICY_RULES.map((r) => `'${r.code}'`).join(',')}]`;
const templateCodes = `ARRAY[${FIRM_TEMPLATES.map((t) => `'${t.code}'`).join(',')}]`;
const TEMPLATE_TABLES = ['catalogue_templates', 'catalogue_template_versions'];
const templateRls = (mode: 'NO FORCE' | 'FORCE') =>
  TEMPLATE_TABLES.map((t) => `ALTER TABLE hsdg.${t} ${mode} ROW LEVEL SECURITY;`).join('\n');

const firmSql = `-- ─────────────────────────────────────────────────────────────────────────
-- Firm-policy rules (spec "Data model": every row in a stream tab is a
-- compliance_instance, including Inward reconciliation and Bookkeeping
-- month-close). GENERATED by scripts/gen-calendar-v2-rules.ts from
-- FIRM_POLICY_RULES in apps/api/src/modules/compliance/calendar-v2-rules.ts —
-- edit the catalogue and re-run the script; do not edit this file by hand.
--
--   * ${FIRM_POLICY_RULES.map((r) => r.code).join(', ')}
--     (HSDG_RECURRING: the firm's own dates, no late fee).
--   * Checklists FILING_BOOKKEEPING and FILING_MIS; Inward uses the existing
--     FILING_GST_INWARD.
-- Existing engagements pick the new items up the next time their calendar is
-- generated (adding a year, a profile change, or the nightly run).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

${rls('NO FORCE')}
${templateRls('NO FORCE')}

${insertRules(ruleRows(FIRM_POLICY_RULES), versionRows(FIRM_POLICY_RULES))}

INSERT INTO hsdg.catalogue_templates (template_type, code, name, description)
SELECT 'checklist', t.code, t.name, 'Filing workspace checklist (firm-policy rules).'
FROM jsonb_to_recordset(${json(FIRM_TEMPLATES)}) AS t(code text, name text, body jsonb)
ON CONFLICT (code) DO NOTHING;
INSERT INTO hsdg.catalogue_template_versions (catalogue_template_id, version, effective_from, body, notes)
SELECT ct.id, 1, DATE '2017-04-01', t.body, 'Seeded by 1770900000000_firm_policy_rules'
FROM jsonb_to_recordset(${json(FIRM_TEMPLATES)}) AS t(code text, name text, body jsonb)
JOIN hsdg.catalogue_templates ct ON ct.code = t.code
ON CONFLICT DO NOTHING;

${templateRls('FORCE')}
${rls('FORCE')}

-- Down Migration

${rls('NO FORCE')}
${templateRls('NO FORCE')}

DELETE FROM hsdg.catalogue_template_versions v USING hsdg.catalogue_templates t
 WHERE v.catalogue_template_id = t.id AND t.code = ANY(${templateCodes});
DELETE FROM hsdg.catalogue_templates WHERE code = ANY(${templateCodes});

DELETE FROM hsdg.compliance_instances ci
 USING hsdg.compliance_rules r
 WHERE r.id = ci.compliance_rule_id AND r.code = ANY(${firmCodes});

DELETE FROM hsdg.compliance_rule_versions v
 USING hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id AND r.code = ANY(${firmCodes});

DELETE FROM hsdg.compliance_rules WHERE code = ANY(${firmCodes});

${templateRls('FORCE')}
${rls('FORCE')}
`;

writeFileSync(FIRM_OUT, firmSql);
console.log(
  `wrote ${FIRM_OUT} (${FIRM_POLICY_RULES.length} rules, ${FIRM_TEMPLATES.length} templates)`,
);

// ── ROC / MCA rules and checklists (docs/roc-mca-filing-spec.md P1-4…P1-7) ──

const ROC_OUT = join(MIGRATIONS, '1771100000000_roc_rules_checklists.sql');

/** The ROC encodings 1771100000000 replaces, restored by its down migration. */
const ROC_PRIOR = [
  {
    code: 'ROC_AOC4',
    condition: null,
    variants: [
      {
        when: { field: 'company_subtype', op: '==', value: 'opc' },
        set: { calculation_basis: 'fy_end', offset_months: 0, offset_days: 180, event_type: null },
      },
    ],
    schedule: null,
    verification: 'verified',
    late_fee_note: 'Additional fee ₹100/day.',
    notes:
      'AOC-4 — 30 days from the AGM (OPC: 180 days from the FY end). Shown on an assumed 30 September AGM until the AGM is recorded.',
  },
  {
    code: 'ROC_MGT7',
    condition: null,
    variants: [
      {
        when: { field: 'company_subtype', op: '==', value: 'opc' },
        set: {
          calculation_basis: 'fy_end',
          offset_months: 6,
          offset_days: 60,
          event_type: null,
          form_label: 'MGT-7A',
        },
      },
    ],
    schedule: null,
    verification: 'verified',
    late_fee_note: 'Additional fee ₹100/day.',
    notes:
      'MGT-7 / MGT-7A — 60 days from the AGM. Shown on an assumed 30 September AGM until recorded.',
  },
  {
    code: 'ROC_ADT1',
    condition: { field: 'auditor_appointed_at_agm', op: '==', value: true },
    variants: null,
    schedule: null,
    verification: 'verified',
    late_fee_note: 'Additional fee ₹100/day.',
    notes: 'ADT-1 — 15 days from the AGM at which the auditor is appointed.',
  },
  {
    code: 'ROC_DPT3',
    condition: null,
    variants: null,
    schedule: null,
    verification: 'verified',
    late_fee_note: 'Additional fee ₹100/day.',
    notes: 'DPT-3 — 30 June.',
  },
  {
    code: 'ROC_PAS6',
    condition: { field: 'company_subtype', op: '==', value: 'unlisted_public' },
    variants: null,
    schedule: [
      { period: 'H1', month: 11, day: 29, year_offset: 0 },
      { period: 'H2', month: 5, day: 30, year_offset: 1 },
    ],
    verification: 'verified',
    late_fee_note: null,
    notes: 'PAS-6 — 29 Nov (Apr–Sep); 30 May (Oct–Mar). Unlisted public companies.',
  },
  {
    code: 'ROC_DIR3_KYC',
    condition: null,
    variants: null,
    schedule: [{ period: 'FY', month: 6, day: 30, year_offset: 1 }],
    verification: 'verified',
    late_fee_note: 'Fee ₹5,000 to reactivate a deactivated DIN.',
    notes: 'DIR-3 KYC — 30 June, once every three financial years, per DIN.',
  },
  {
    code: 'LLP_FORM11',
    condition: null,
    variants: null,
    schedule: null,
    verification: 'verified',
    late_fee_note: 'Additional fee ₹100/day.',
    notes: 'LLP Form 11 — within 60 days of the FY end (30 May).',
  },
  {
    code: 'ROC_BOARD_MEETING',
    condition: null,
    variants: [
      {
        when: {
          any: [
            { field: 'company_subtype', op: '==', value: 'small' },
            { field: 'company_subtype', op: '==', value: 'opc' },
          ],
        },
        set: { period_filter: ['Q2', 'Q4'] },
      },
    ],
    schedule: null,
    verification: 'verified',
    late_fee_note: 'Penalty u/s 173.',
    notes:
      'At least one board meeting each quarter, gap ≤ 120 days (one per half-year for small companies / OPC).',
  },
  {
    code: 'ROC_FIRST_ADT1',
    condition: null,
    variants: null,
    schedule: null,
    verification: 'verified',
    late_fee_note: null,
    notes: 'ADT-1 — 15 days from the board’s appointment of the first auditor.',
  },
  {
    code: 'ROC_PAS3',
    condition: null,
    variants: null,
    schedule: null,
    verification: 'verified',
    late_fee_note: null,
    notes: 'PAS-3 — within 30 days of allotment (15 days for a private placement).',
  },
];

/** The current encodings of the same rules (version 1, the only one each has). */
const rocCurrent = ROC_PRIOR.map((p) => {
  const r = CALENDAR_V2_RULES.find((x) => x.code === p.code)!;
  return {
    code: r.code,
    condition: r.condition ?? null,
    variants: r.variants ?? null,
    schedule: r.schedule ?? null,
    verification: r.verification ?? 'verified',
    late_fee_note: r.lateFeeNote ?? null,
    notes: r.notes,
  };
});

const updateRules = (rows: readonly unknown[]) => `UPDATE hsdg.compliance_rule_versions v
   SET condition = x.condition, variants = x.variants, schedule = x.schedule,
       verification = x.verification, late_fee_note = x.late_fee_note, notes = x.notes
  FROM jsonb_to_recordset(${json(rows)})
       AS x(code text, condition jsonb, variants jsonb, schedule jsonb, verification text,
            late_fee_note text, notes text),
       hsdg.compliance_rules r
 WHERE r.id = v.compliance_rule_id AND r.code = x.code AND v.version = 1;
UPDATE hsdg.compliance_rules r SET description = x.notes
  FROM jsonb_to_recordset(${json(rows)}) AS x(code text, notes text)
 WHERE r.code = x.code;`;

const FREQUENCIES = (extra: boolean) =>
  ['monthly', 'quarterly', 'half_yearly', ...(extra ? ['calendar_half_yearly'] : [])]
    .concat(['annual', 'triennial', 'event', 'on_demand'])
    .map((f) => `'${f}'`)
    .join(',');
const AUTO_TICKS = (extra: boolean) =>
  ['document', 'figure', 'review', 'lodge', ...(extra ? ['event'] : [])]
    .map((f) => `'${f}'`)
    .join(',');
const rocTemplateCodes = `ARRAY[${ROC_CHECKLISTS.map((t) => `'${t.code}'`).join(',')}]`;

const rocSql = `-- ─────────────────────────────────────────────────────────────────────────
-- ROC / MCA rules and checklists (docs/roc-mca-filing-spec.md, track A).
-- GENERATED by scripts/gen-calendar-v2-rules.ts from calendar-v2-rules.ts and
-- roc-checklists.ts — edit those and re-run the script; do not edit by hand.
--
--   * Rule fixes on databases that already ran 1770100000000 (regenerated with
--     the same values for new ones): MGT-7A for a small company (G4); ADT-1
--     from the AGM event's "auditor appointed" flag (G5); board meetings of a
--     small company / OPC on calendar halves Jul–Dec / Jan–Jun (G6, new
--     frequency calendar_half_yearly); DPT-3 dropped only when the profile says
--     no deposits (G7); PAS-3 in 15 days for a private placement; AOC-4 XBRL /
--     + CFS labels; DIR-3 KYC due 30 June inside the cycle FY (E12); the §9
--     Verify tags (PAS-3, DIR-3 KYC, ADT-1, first ADT-1, LLP Form 11, DPT-3,
--     PAS-6, AOC-4 / MGT-7 thresholds).
--   * Checklists FILING_<RULE_CODE> for the eleven recurring ROC items (§5).
--   * instance_checklist_items: auto_tick 'event' (AOC-4's "AGM held"; the
--     ticking is syncAutoTicks'), ticked_by 'partner' and done_note — a
--     certification line only a partner ticks, with the UDIN as its note.
-- Existing items move the next time their calendar is generated; checklists
-- already created keep their lines (new filings get the per-form ones).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.compliance_rule_versions
  DROP CONSTRAINT compliance_rule_versions_frequency_check,
  ADD CONSTRAINT compliance_rule_versions_frequency_check
    CHECK (frequency IS NULL OR frequency IN (${FREQUENCIES(true)}));

ALTER TABLE hsdg.instance_checklist_items
  DROP CONSTRAINT instance_checklist_items_auto_tick_check,
  ADD CONSTRAINT instance_checklist_items_auto_tick_check
    CHECK (auto_tick IN (${AUTO_TICKS(true)})),
  ADD COLUMN ticked_by text CHECK (ticked_by IN ('partner')),
  ADD COLUMN done_note text,
  ADD CONSTRAINT instance_checklist_items_partner_note CHECK (
    ticked_by IS NULL OR status <> 'done' OR length(trim(coalesce(done_note, ''))) > 0);
COMMENT ON COLUMN hsdg.instance_checklist_items.ticked_by IS
  'partner: only a partner ticks the line by hand, and the tick carries a note (the UDIN).';
COMMENT ON COLUMN hsdg.instance_checklist_items.done_note IS
  'The note given when the line was ticked (the UDIN on a certification).';

${rls('NO FORCE')}
${templateRls('NO FORCE')}

${updateRules(rocCurrent)}

INSERT INTO hsdg.catalogue_templates (template_type, code, name, description)
SELECT 'checklist', t.code, t.name, 'Filing workspace checklist (ROC / MCA, per form).'
FROM jsonb_to_recordset(${json(ROC_CHECKLISTS)}) AS t(code text, name text, body jsonb)
ON CONFLICT (code) DO NOTHING;
INSERT INTO hsdg.catalogue_template_versions (catalogue_template_id, version, effective_from, body, notes)
SELECT ct.id, 1, DATE '2017-04-01', t.body, 'Seeded by 1771100000000_roc_rules_checklists'
FROM jsonb_to_recordset(${json(ROC_CHECKLISTS)}) AS t(code text, name text, body jsonb)
JOIN hsdg.catalogue_templates ct ON ct.code = t.code
ON CONFLICT DO NOTHING;

${templateRls('FORCE')}
${rls('FORCE')}

-- Down Migration

${rls('NO FORCE')}
${templateRls('NO FORCE')}

DELETE FROM hsdg.catalogue_template_versions v USING hsdg.catalogue_templates t
 WHERE v.catalogue_template_id = t.id AND t.code = ANY(${rocTemplateCodes});
DELETE FROM hsdg.catalogue_templates WHERE code = ANY(${rocTemplateCodes});

${updateRules(ROC_PRIOR)}

${templateRls('FORCE')}
${rls('FORCE')}

UPDATE hsdg.instance_checklist_items SET auto_tick = NULL WHERE auto_tick = 'event';
ALTER TABLE hsdg.instance_checklist_items
  DROP CONSTRAINT instance_checklist_items_partner_note,
  DROP COLUMN done_note,
  DROP COLUMN ticked_by,
  DROP CONSTRAINT instance_checklist_items_auto_tick_check,
  ADD CONSTRAINT instance_checklist_items_auto_tick_check
    CHECK (auto_tick IN (${AUTO_TICKS(false)}));

ALTER TABLE hsdg.compliance_rule_versions
  DROP CONSTRAINT compliance_rule_versions_frequency_check,
  ADD CONSTRAINT compliance_rule_versions_frequency_check
    CHECK (frequency IS NULL OR frequency IN (${FREQUENCIES(false)}));
`;

writeFileSync(ROC_OUT, rocSql);
console.log(
  `wrote ${ROC_OUT} (${rocCurrent.length} rule fixes, ${ROC_CHECKLISTS.length} checklists)`,
);

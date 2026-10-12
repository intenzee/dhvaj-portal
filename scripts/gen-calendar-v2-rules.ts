/**
 * Generates db/migrations/1770100000000_calendar_v2_rules.sql from the typed
 * rule catalogue in apps/api/src/modules/compliance/calendar-v2-rules.ts, so
 * the seeded encodings are exactly the ones the unit tests check.
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
} from '../apps/api/src/modules/compliance/calendar-v2-rules';

const OUT = join(__dirname, '..', 'db', 'migrations', '1770100000000_calendar_v2_rules.sql');
const RETIRE_FROM = '2026-04-01';
const RETIRE_MARK = 'calendar-v2 retirement';

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const rules = CALENDAR_V2_RULES.map((r) => ({
  code: r.code,
  name: r.name,
  description: r.notes,
  category: r.category,
  due_date_category: r.dueDateCategory,
  service_code: STREAM_SERVICE_CODE[r.stream],
}));

const versions = CALENDAR_V2_RULES.flatMap((r) =>
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

INSERT INTO hsdg.compliance_rules
  (code, name, description, service_id, category, is_active, due_date_category, due_date_source)
SELECT x.code, x.name, x.description, s.id, x.category, true, x.due_date_category, 'LAW_RULE'
FROM jsonb_to_recordset(${json(rules)})
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
FROM jsonb_to_recordset(${json(versions)})
  AS v(code text, version int, effective_from date, effective_to date, calculation_basis text,
       offset_months int, offset_days int, internal_sla_offset_days int, condition jsonb, notes text,
       stream text, registration_scope text, frequency text, form_label text, section text,
       schedule jsonb, period_overrides jsonb, period_filter jsonb, event_type text,
       provisional_event_rule jsonb, variants jsonb, is_optional boolean, late_fee_note text,
       verification text, source_ref text)
JOIN hsdg.compliance_rules r ON r.code = v.code
ON CONFLICT (compliance_rule_id, version) DO NOTHING;

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

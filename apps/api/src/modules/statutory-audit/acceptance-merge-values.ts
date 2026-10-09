import type { PoolClient } from 'pg';
import { auditPeriodStartFromFinancialYear, type TemplateSelectionFacts } from '@hsdg/contracts';
import {
  groupStructure,
  periodEndFromFinancialYear,
  readEngagementMasterFacts,
  type EngagementMasterFacts,
} from './master-facts';

/**
 * Merge values for Section 01 templates (spec §2 "merge available engagement
 * data"). Facts come from the masters and from Section 01 answers already
 * captured — never re-asked. Pure builder + one reader, so the mapping is
 * unit-tested without a database.
 */

/**
 * Where each Section 01 answer-backed merge field is stored
 * (`audit_acceptance_answers` by segment + question key; `details` jsonb keys).
 * Owned jointly with the question catalogue — adjust here if a key changes.
 */
export const ACCEPTANCE_MERGE_SOURCES = {
  appointmentBasis: { segmentKey: 'appointment_eligibility', questionKey: 'app_01' },
  appointmentDate: { segmentKey: 'appointment_eligibility', questionKey: 'app_02' },
  appointmentPeriod: { segmentKey: 'appointment_eligibility', questionKey: 'app_03' },
  previousAuditor: { segmentKey: 'previous_auditor', questionKey: 'pa_details' },
} as const;

/** APP-01 option labels (spec §5). */
const APPOINTMENT_BASIS_LABEL: Record<string, string> = {
  first_auditor: 'First Auditor',
  agm: 'Appointment at AGM',
  reappointment: 'Reappointment',
  casual_vacancy: 'Casual Vacancy',
  cag: 'C&AG Appointment',
  other: 'Other',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2025-03-31` → `31 March 2025`; anything else is returned as is. */
export function formatLongDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export interface AnswerSnapshot {
  answer: string | null;
  details: Record<string, unknown>;
}

export interface MergeInput {
  master: EngagementMasterFacts;
  firm: { firmName: string; frn: string | null; address: string | null };
  partnerMembershipNo: string | null;
  /** Answers keyed `${segmentKey}:${questionKey}`. */
  answers: ReadonlyMap<string, AnswerSnapshot>;
  today: string;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** Build every merge value the Section 01 templates can use. */
export function buildMergeValues(input: MergeInput): Record<string, string | null> {
  const { master: m, firm, answers } = input;
  const at = (src: { segmentKey: string; questionKey: string }) =>
    answers.get(`${src.segmentKey}:${src.questionKey}`);

  const fy = m.financialYear;
  const periodEnd = periodEndFromFinancialYear(fy);
  const auditPeriod = periodEnd
    ? `${formatLongDate(auditPeriodStartFromFinancialYear(fy))} to ${formatLongDate(periodEnd)}`
    : m.periodLabel;

  const basis = at(ACCEPTANCE_MERGE_SOURCES.appointmentBasis);
  const basisValue = basis?.answer ?? null;
  const appointmentBasis =
    basisValue === 'other'
      ? (str(basis?.details.specify) ?? APPOINTMENT_BASIS_LABEL.other!)
      : basisValue
        ? (APPOINTMENT_BASIS_LABEL[basisValue] ?? basisValue)
        : null;
  const appointmentDate = at(ACCEPTANCE_MERGE_SOURCES.appointmentDate)?.answer ?? null;
  const period = at(ACCEPTANCE_MERGE_SOURCES.appointmentPeriod)?.details ?? {};
  const pa = at(ACCEPTANCE_MERGE_SOURCES.previousAuditor)?.details ?? {};

  return {
    'firm.name': firm.firmName,
    'firm.frn': firm.frn,
    'firm.address': firm.address,
    'firm.office': m.officeName,
    'client.name': m.legalName,
    'client.cin': m.corporateId?.number ?? null,
    'client.pan': m.pan,
    'client.companyType': m.entityTypeName,
    'client.registeredOffice': m.registeredOffice,
    'engagement.code': m.engagementCode,
    'engagement.financialYear': fy,
    'engagement.auditPeriod': auditPeriod,
    'engagement.periodEnd': formatLongDate(periodEnd),
    'partner.name': m.partnerName,
    'partner.membershipNo': input.partnerMembershipNo,
    'manager.name': m.managerName,
    'appointment.basis': appointmentBasis,
    'appointment.date': /^\d{4}-\d{2}-\d{2}$/.test(appointmentDate ?? '')
      ? formatLongDate(appointmentDate)
      : null,
    'appointment.periodFrom': str(period.from),
    'appointment.periodTo': str(period.to),
    'previousAuditor.firmName': str(pa.firmName),
    'previousAuditor.frn': str(pa.frn),
    'previousAuditor.partnerName': str(pa.partnerName),
    'previousAuditor.membershipNo': str(pa.membershipNo),
    'previousAuditor.email': str(pa.email),
    'previousAuditor.address': str(pa.address),
    'previousAuditor.lastAuditPeriod': str(pa.lastAuditPeriod),
    today: formatLongDate(input.today),
  };
}

/** The facts a template variant is chosen against (listed, entity type, group). */
export function templateSelectionFacts(m: EngagementMasterFacts): TemplateSelectionFacts {
  return {
    listed: m.listings.length > 0 || (m.listingStatus ?? 'unlisted') !== 'unlisted',
    entityTypeSlug: m.entityTypeSlug ?? null,
    hasGroup: groupStructure(m.relationships).investees.length > 0,
  };
}

/** Read everything {@link buildMergeValues} needs for one audit file. */
export async function readMergeInput(
  client: PoolClient,
  workflowInstanceId: string,
  firm: MergeInput['firm'],
): Promise<MergeInput | null> {
  const master = await readEngagementMasterFacts(client, workflowInstanceId);
  if (!master) return null;
  const { rows: partner } = await client.query<{ membership_no: string | null }>(
    `SELECT pp.membership_no
       FROM hsdg.service_workflow_instances swi
       JOIN hsdg.engagements e ON e.id = swi.engagement_id
       LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = e.engagement_partner_id
      WHERE swi.id = $1`,
    [workflowInstanceId],
  );
  // `details` arrives with the expanded question catalogue; read it when present.
  const { rows: hasDetails } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'hsdg' AND table_name = 'audit_acceptance_answers'
        AND column_name = 'details'`,
  );
  const { rows } = await client.query<{
    segment_key: string;
    question_key: string;
    answer: string | null;
    details: Record<string, unknown> | null;
  }>(
    `SELECT s.segment_key, a.question_key, a.answer,
            ${hasDetails.length > 0 ? 'a.details' : 'NULL::jsonb AS details'}
       FROM hsdg.audit_acceptance_answers a
       JOIN hsdg.audit_acceptance_segments s ON s.id = a.segment_id
      WHERE s.workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const answers = new Map<string, AnswerSnapshot>();
  for (const r of rows) {
    answers.set(`${r.segment_key}:${r.question_key}`, {
      answer: r.answer,
      details: r.details ?? {},
    });
  }
  return {
    master,
    firm,
    partnerMembershipNo: partner[0]?.membership_no ?? null,
    answers,
    today: new Date().toISOString().slice(0, 10),
  };
}

import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  ICFR_CONTROL_REMINDER,
  ICFR_OUTCOME_LABEL,
  ICFR_PARENT_CONCLUSION_LABEL,
  ICFR_WORKSTREAM_CONCLUSION_LABEL,
  SUB_SECTION_KEY,
  type IcfrConclusionSummary,
  type IcfrOutcome,
  type IcfrParentConclusion,
  type IcfrWorkstreamConclusion,
} from '@hsdg/contracts';
import { formatLongDate } from './acceptance-merge-values';

/** The 02.5 assessment and the ICFR workstream as stored — what the ICFR memo merges. */
export interface IcfrMemoInput {
  systemOutcome: string | null;
  systemBasis: string | null;
  conclusion: string | null;
  basis: string | null;
  isOverridden: boolean;
  technicalBasis: string | null;
  supportingEvidence: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  professionalAction: string | null;
  pendingReason: string | null;
  partnerApprovedByName: string | null;
  partnerApprovedAt: string | null;
  exemptionReason: string | null;
  /** The engine's structured conclusion (spec §12), when the engine ran. */
  summary: IcfrConclusionSummary | null;
  workstream: {
    status: 'active' | 'withdrawn';
    frameworkLabel: string;
    inScopeAreas: string[];
    conclusion: IcfrWorkstreamConclusion | null;
  } | null;
  deficiencies: {
    total: number;
    materialWeaknesses: number;
    significantDeficiencies: number;
  };
  consolidated: {
    status: 'active' | 'withdrawn';
    components: number;
    parentConclusion: IcfrParentConclusion | null;
  } | null;
}

/** Read the 02.5 sub-assessment and workstream of a workflow (null when 02.5 is not open). */
export async function readIcfrMemoInput(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<IcfrMemoInput | null> {
  const { rows } = await client.query<{
    system_outcome: string | null;
    system_basis: string | null;
    conclusion: string | null;
    basis: string | null;
    is_overridden: boolean;
    decided_by_name: string | null;
    decided_at: Date | null;
    professional_action: string | null;
    pending_reason: string | null;
    partner_name: string | null;
    partner_approved_at: Date | null;
    system_detail: {
      exemptionReason?: string | null;
      conclusion?: IcfrConclusionSummary | null;
    } | null;
    facts: { technicalBasis?: string | null; supportingEvidence?: string | null } | null;
  }>(
    `SELECT s.system_outcome, s.system_basis, s.conclusion, s.basis, s.is_overridden,
            d.full_name AS decided_by_name, s.decided_at, s.professional_action, s.pending_reason,
            p.full_name AS partner_name, s.partner_approved_at, s.system_detail, s.facts
       FROM hsdg.audit_framework_subassessment s
       LEFT JOIN hsdg.employees d ON d.id = s.decided_by_employee_id
       LEFT JOIN hsdg.employees p ON p.id = s.partner_approved_by_employee_id
      WHERE s.workflow_instance_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3`,
    [workflowInstanceId, SUB_SECTION_KEY.icfr, FRAMEWORK_AREA_KEY.ifc],
  );
  const r = rows[0];
  if (!r) return null;
  const [{ rows: ws }, { rows: defs }, { rows: cons }] = await Promise.all([
    client.query<{
      status: 'active' | 'withdrawn';
      framework_label: string;
      conclusion: IcfrWorkstreamConclusion | null;
      in_scope: string[] | null;
    }>(
      `SELECT w.status, w.framework_label, w.conclusion,
              ARRAY(SELECT a.title FROM hsdg.audit_icfr_process_area a
                     WHERE a.workstream_id = w.id AND a.status = 'active' AND a.scoping = 'in_scope'
                     ORDER BY a.sort_order) AS in_scope
         FROM hsdg.audit_icfr_workstream w WHERE w.workflow_instance_id = $1`,
      [workflowInstanceId],
    ),
    client.query<{ total: number; mw: number; sd: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE classification = 'material_weakness')::int AS mw,
              count(*) FILTER (WHERE classification = 'significant_deficiency')::int AS sd
         FROM hsdg.audit_icfr_deficiency
        WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL`,
      [workflowInstanceId],
    ),
    client.query<{
      status: 'active' | 'withdrawn';
      parent_conclusion: IcfrParentConclusion | null;
      components: number;
    }>(
      `SELECT c.status, c.parent_conclusion,
              (SELECT count(*)::int FROM hsdg.audit_icfr_component m
                WHERE m.consolidated_id = c.id AND m.withdrawn_at IS NULL) AS components
         FROM hsdg.audit_icfr_consolidated c WHERE c.workflow_instance_id = $1`,
      [workflowInstanceId],
    ),
  ]);
  return {
    systemOutcome: r.system_outcome,
    systemBasis: r.system_basis,
    conclusion: r.conclusion,
    basis: r.basis,
    isOverridden: r.is_overridden,
    technicalBasis: r.facts?.technicalBasis ?? null,
    supportingEvidence: r.facts?.supportingEvidence ?? null,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    professionalAction: r.professional_action,
    pendingReason: r.pending_reason,
    partnerApprovedByName: r.partner_name,
    partnerApprovedAt: r.partner_approved_at ? r.partner_approved_at.toISOString() : null,
    exemptionReason: r.system_detail?.exemptionReason ?? null,
    summary: r.system_detail?.conclusion ?? null,
    workstream: ws[0]
      ? {
          status: ws[0].status,
          frameworkLabel: ws[0].framework_label,
          inScopeAreas: ws[0].in_scope ?? [],
          conclusion: ws[0].conclusion,
        }
      : null,
    deficiencies: {
      total: defs[0]?.total ?? 0,
      materialWeaknesses: defs[0]?.mw ?? 0,
      significantDeficiencies: defs[0]?.sd ?? 0,
    },
    consolidated: cons[0]
      ? {
          status: cons[0].status,
          components: cons[0].components,
          parentConclusion: cons[0].parent_conclusion,
        }
      : null,
  };
}

const ROUTE_LABEL: Record<string, string> = {
  not_company: 'Not a company',
  public_company: 'Public company',
  private_company: 'Private company',
  unknown: 'Not yet determined',
};
const ROUTE_RESULT_LABEL: Record<string, string> = {
  exempt_route: 'Exempt route',
  no: 'Not applicable',
  pending: 'Pending',
  not_tested: 'Not tested',
  not_available: 'No rule in force',
};
const CONDITION_LABEL: Record<string, string> = {
  satisfied: 'Satisfied',
  failed: 'Failed',
  pending: 'Pending',
  not_tested: 'Not tested',
};

const outcomeLabel = (o: string | null): string | null =>
  o ? (ICFR_OUTCOME_LABEL[o as IcfrOutcome] ?? o.replace(/_/g, ' ')) : null;

/**
 * The `icfr.*` merge values of the ICFR Reporting Applicability Memo (02.5 spec
 * §20): the stored assessment, the Section 05 workstream and the consolidated
 * consideration as display text. Pure; an absent assessment or fact leaves the
 * field blank so the memo shows its `[label]` gap rather than a guess.
 */
export function icfrMergeValues(m: IcfrMemoInput | null): Record<string, string | null> {
  if (!m) return {};
  const t = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);
  const decided = m.conclusion !== null;
  const sum = m.summary;
  const measure = (actual: string | null, limit: string | null) =>
    actual
      ? `${actual}${limit ? ` (limit ${limit})` : ''}`
      : limit
        ? `Not recorded (limit ${limit})`
        : null;
  const w = m.workstream;
  const d = m.deficiencies;
  return {
    'icfr.applicability': outcomeLabel(decided ? m.conclusion : m.systemOutcome),
    'icfr.systemConclusion': outcomeLabel(m.systemOutcome),
    'icfr.systemReason': t(sum?.reason) ?? t(m.systemBasis),
    'icfr.entityRoute': sum ? (ROUTE_LABEL[sum.entityRoute] ?? sum.entityRoute) : null,
    'icfr.opcRoute': sum ? (ROUTE_RESULT_LABEL[sum.opc] ?? sum.opc) : null,
    'icfr.smallCompanyRoute': sum
      ? (ROUTE_RESULT_LABEL[sum.smallCompany] ?? sum.smallCompany)
      : null,
    'icfr.turnover': sum ? measure(sum.turnover, sum.turnoverLimit) : null,
    'icfr.borrowings': sum ? measure(sum.peakBorrowings, sum.borrowingLimit) : null,
    'icfr.filingCondition': sum
      ? (CONDITION_LABEL[sum.filingCondition] ?? sum.filingCondition)
      : null,
    'icfr.notificationVersion': sum ? (t(sum.notificationVersion) ?? 'None in force') : null,
    'icfr.workstream': !w
      ? decided && m.conclusion !== 'applicable'
        ? 'Not required — no separate section 143(3)(i) workstream'
        : null
      : w.status === 'withdrawn'
        ? 'Withdrawn — reporting concluded exempt; the record is kept'
        : `${w.frameworkLabel} configured in Section 05` +
          (w.inScopeAreas.length ? ` — in scope: ${w.inScopeAreas.join(', ')}` : '') +
          (w.conclusion ? `. Conclusion: ${ICFR_WORKSTREAM_CONCLUSION_LABEL[w.conclusion]}` : ''),
    'icfr.deficiencies': w
      ? d.total
        ? `${d.total} recorded — ${d.materialWeaknesses} material weakness(es), ${d.significantDeficiencies} significant deficienc${d.significantDeficiencies === 1 ? 'y' : 'ies'}`
        : 'None recorded'
      : 'Not applicable',
    'icfr.consolidated': !m.consolidated
      ? 'Not required — no consolidated ICFR consideration'
      : m.consolidated.status === 'withdrawn'
        ? 'Withdrawn — consolidated financial statements no longer in scope'
        : `Configured — ${m.consolidated.components} component${m.consolidated.components === 1 ? '' : 's'}` +
          (m.consolidated.parentConclusion
            ? `. Conclusion: ${ICFR_PARENT_CONCLUSION_LABEL[m.consolidated.parentConclusion]}`
            : ''),
    'icfr.controlReminder': ICFR_CONTROL_REMINDER,
    'icfr.professionalConclusion': decided
      ? outcomeLabel(m.conclusion)
      : m.professionalAction === 'information_pending'
        ? 'Information Pending'
        : 'Not yet concluded',
    'icfr.overridden': m.isOverridden ? 'Yes' : 'No',
    'icfr.overrideReason': m.isOverridden ? t(m.basis) : 'Not applicable',
    'icfr.technicalBasis': m.isOverridden ? t(m.technicalBasis) : 'Not applicable',
    'icfr.supportingEvidence': m.isOverridden ? t(m.supportingEvidence) : 'Not applicable',
    'icfr.partnerApproval': m.partnerApprovedAt
      ? `Approved by ${m.partnerApprovedByName ?? 'the Engagement Partner'} on ${formatLongDate(m.partnerApprovedAt.slice(0, 10))}`
      : m.isOverridden || m.conclusion === 'further_assessment'
        ? 'Pending — Engagement Partner approval required'
        : 'Not required',
    'icfr.pendingReason':
      m.professionalAction === 'information_pending' ? t(m.pendingReason) : 'None',
    'icfr.decidedBy': decided ? t(m.decidedByName) : null,
    'icfr.decidedAt': decided && m.decidedAt ? formatLongDate(m.decidedAt.slice(0, 10)) : null,
  };
}

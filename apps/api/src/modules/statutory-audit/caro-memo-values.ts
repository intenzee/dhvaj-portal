import type { PoolClient } from 'pg';
import {
  CARO_CLAUSE_CONCLUSION_LABEL,
  CARO_OUTCOME,
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  type CaroClauseConclusion,
  type CaroOutcome,
} from '@hsdg/contracts';
import { formatLongDate } from './acceptance-merge-values';

const OUTCOME_LABEL: Record<CaroOutcome, string> = {
  [CARO_OUTCOME.applicable]: 'CARO Applicable',
  [CARO_OUTCOME.notApplicableExempt]: 'CARO Not Applicable - Exempt',
  [CARO_OUTCOME.furtherAssessment]: 'Further Assessment Required',
  [CARO_OUTCOME.informationInsufficient]: 'Information Pending',
};

/** The 02.4 assessment and clause programme as stored — what the CARO memo merges. */
export interface CaroMemoInput {
  systemOutcome: string | null;
  systemBasis: string | null;
  conclusion: string | null;
  basis: string | null;
  isOverridden: boolean;
  technicalBasis: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  professionalAction: string | null;
  pendingReason: string | null;
  partnerApprovedByName: string | null;
  partnerApprovedAt: string | null;
  exemptionReason: string | null;
  programme: {
    orderTitle: string;
    orderVersionLabel: string;
    periodStart: string;
    status: 'active' | 'withdrawn';
  } | null;
  clauses: Array<{
    clauseRef: string;
    title: string;
    reportContext: 'standalone' | 'consolidated';
    relevance: string;
    conclusion: CaroClauseConclusion | null;
    reviewState: string;
  }>;
}

/** Read the 02.4 sub-assessment and programme of a workflow (null when 02.4 is not open). */
export async function readCaroMemoInput(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<CaroMemoInput | null> {
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
    system_detail: { exemptionReason?: string | null } | null;
    facts: { technicalBasis?: string | null } | null;
  }>(
    `SELECT s.system_outcome, s.system_basis, s.conclusion, s.basis, s.is_overridden,
            d.full_name AS decided_by_name, s.decided_at, s.professional_action, s.pending_reason,
            p.full_name AS partner_name, s.partner_approved_at, s.system_detail, s.facts
       FROM hsdg.audit_framework_subassessment s
       LEFT JOIN hsdg.employees d ON d.id = s.decided_by_employee_id
       LEFT JOIN hsdg.employees p ON p.id = s.partner_approved_by_employee_id
      WHERE s.workflow_instance_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3`,
    [workflowInstanceId, SUB_SECTION_KEY.caro, FRAMEWORK_AREA_KEY.caro],
  );
  const r = rows[0];
  if (!r) return null;
  const { rows: prog } = await client.query<{
    id: string;
    order_title: string;
    order_version_label: string;
    period_start: string;
    status: 'active' | 'withdrawn';
  }>(
    `SELECT id, order_title, order_version_label, period_start::text AS period_start, status
       FROM hsdg.audit_caro_programme WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const { rows: clauses } = prog[0]
    ? await client.query<{
        clause_ref: string;
        title: string;
        report_context: 'standalone' | 'consolidated';
        relevance: string;
        conclusion: CaroClauseConclusion | null;
        review_state: string;
      }>(
        `SELECT clause_ref, title, report_context, relevance, conclusion, review_state
           FROM hsdg.audit_caro_clause_item
          WHERE programme_id = $1 AND status = 'active'
          ORDER BY sort_order`,
        [prog[0].id],
      )
    : { rows: [] };
  return {
    systemOutcome: r.system_outcome,
    systemBasis: r.system_basis,
    conclusion: r.conclusion,
    basis: r.basis,
    isOverridden: r.is_overridden,
    technicalBasis: r.facts?.technicalBasis ?? null,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    professionalAction: r.professional_action,
    pendingReason: r.pending_reason,
    partnerApprovedByName: r.partner_name,
    partnerApprovedAt: r.partner_approved_at ? r.partner_approved_at.toISOString() : null,
    exemptionReason: r.system_detail?.exemptionReason ?? null,
    programme: prog[0]
      ? {
          orderTitle: prog[0].order_title,
          orderVersionLabel: prog[0].order_version_label,
          periodStart: prog[0].period_start,
          status: prog[0].status,
        }
      : null,
    clauses: clauses.map((c) => ({
      clauseRef: c.clause_ref,
      title: c.title,
      reportContext: c.report_context,
      relevance: c.relevance,
      conclusion: c.conclusion,
      reviewState: c.review_state,
    })),
  };
}

const outcomeLabel = (o: string | null): string | null =>
  o ? (OUTCOME_LABEL[o as CaroOutcome] ?? o.replace(/_/g, ' ')) : null;

/**
 * The `caro.*` merge values of the CARO Applicability Memo (02.4 spec §16):
 * the stored assessment and clause programme as display text. Pure; an absent
 * assessment or fact leaves the field blank so the memo shows its `[label]`
 * gap rather than a guess.
 */
export function caroMergeValues(m: CaroMemoInput | null): Record<string, string | null> {
  if (!m) return {};
  const t = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);
  const decided = m.conclusion !== null;
  const sfs = m.clauses.filter((c) => c.reportContext === 'standalone');
  const cfs = m.clauses.filter((c) => c.reportContext === 'consolidated');
  const reportable = m.clauses.filter((c) => c.conclusion === 'reportable_matter');
  const naFacts = sfs.filter((c) => c.relevance === 'not_applicable_to_facts');
  const approved = m.clauses.filter((c) => c.reviewState === 'approved');
  return {
    'caro.applicability': outcomeLabel(decided ? m.conclusion : m.systemOutcome),
    'caro.systemConclusion': outcomeLabel(m.systemOutcome),
    'caro.systemBasis': t(m.systemBasis),
    'caro.exemptionBasis': t(m.exemptionReason) ?? (m.systemOutcome ? 'None' : null),
    'caro.orderVersion': m.programme
      ? `${m.programme.orderTitle} — ${m.programme.orderVersionLabel}`
      : null,
    'caro.standaloneScope': !m.programme
      ? decided
        ? 'No paragraph 3 clause programme — CARO does not apply'
        : null
      : sfs.length
        ? `Paragraph 3 clause programme — ${sfs.length} clause item${sfs.length === 1 ? '' : 's'}` +
          (naFacts.length ? ` (${naFacts.length} not applicable to facts)` : '')
        : 'No paragraph 3 clause programme',
    'caro.consolidatedScope': cfs.length
      ? 'Clause 3(xxi) configured for the consolidated financial statements'
      : 'Not required — no consolidated CARO reporting',
    'caro.clauseProgress': m.clauses.length
      ? `${approved.length} of ${m.clauses.length} clause conclusions approved`
      : null,
    'caro.reportableClauses': m.clauses.length
      ? reportable.length
        ? reportable.map((c) => `${c.clauseRef} ${c.title}`).join('; ')
        : `None (${CARO_CLAUSE_CONCLUSION_LABEL.no_reportable_exception.toLowerCase()} so far)`
      : null,
    'caro.professionalConclusion': decided
      ? outcomeLabel(m.conclusion)
      : m.professionalAction === 'information_pending'
        ? 'Information Pending'
        : 'Not yet concluded',
    'caro.overridden': m.isOverridden ? 'Yes' : 'No',
    'caro.overrideReason': m.isOverridden ? t(m.basis) : 'Not applicable',
    'caro.technicalBasis': m.isOverridden ? t(m.technicalBasis) : 'Not applicable',
    'caro.partnerApproval': m.partnerApprovedAt
      ? `Approved by ${m.partnerApprovedByName ?? 'the Engagement Partner'} on ${formatLongDate(m.partnerApprovedAt.slice(0, 10))}`
      : m.isOverridden
        ? 'Pending — Engagement Partner approval required'
        : 'Not required',
    'caro.pendingReason':
      m.professionalAction === 'information_pending' ? t(m.pendingReason) : 'None',
    'caro.decidedBy': decided ? t(m.decidedByName) : null,
    'caro.decidedAt': decided && m.decidedAt ? formatLongDate(m.decidedAt.slice(0, 10)) : null,
  };
}

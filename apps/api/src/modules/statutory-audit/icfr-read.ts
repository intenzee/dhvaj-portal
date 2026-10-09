import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  ICFR_CONTEXT_STATUS,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type FrameworkState,
  type IcfrApprovedResult,
  type IcfrDetail,
  type IcfrOutcome,
  type IcfrProfessionalAction,
} from '@hsdg/contracts';
import {
  cfsInScopeOf,
  contextStatuses,
  icfrCompletion,
  icfrPartnerApprovalReason,
  isIcfrDecided,
  type IcfrDownstreamStatus,
} from './icfr-completion';

/**
 * DI-free 02.5 readers (spec §22): downstream modules (Section 05 ICFR work,
 * the consolidated consideration, Section 07 / 08) read the 02.5 result from the
 * stored sub-assessment without injecting AuditIcfrService — importing a service
 * into a helper that service imports breaks Nest DI (ESM cycle, 02.4 lesson).
 * Runs inside the caller's RLS transaction.
 */

const SUB = SUB_SECTION_KEY.icfr;
const AREA = FRAMEWORK_AREA_KEY.ifc;

/**
 * Track B's Section 05 workstream / consolidated-consideration status, read for
 * the §23 checklist. Null halves mean "not available on this build" — the
 * checklist then treats the item as not yet relevant rather than failed.
 */
export async function icfrDownstreamStatusOn(
  _client: PoolClient,
  _workflowInstanceId: string,
): Promise<IcfrDownstreamStatus> {
  return { workstream: null, consolidated: null };
}

/** An open blocking Framework Matter raised on the IFC area (spec §23). */
export async function icfrBlockingMatterOpen(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM hsdg.audit_matter
      WHERE workflow_instance_id = $1 AND section = 'framework' AND is_blocking
        AND status IN ('open','under_review','blocking')
        AND source LIKE 'framework:ifc:%'
      LIMIT 1`,
    [workflowInstanceId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The 02.5 result for one workflow instance: the conclusion when decided, else
 * the stored system suggestion (kept current whenever facts change). Null when
 * the 02.5 row has not been seeded yet.
 */
export async function readIcfrResultOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<IcfrApprovedResult | null> {
  const { rows } = await client.query<{
    state: FrameworkState;
    conclusion: string | null;
    system_outcome: string | null;
    system_detail: IcfrDetail | null;
    is_overridden: boolean;
    professional_action: IcfrProfessionalAction | null;
    partner_approved_at: Date | null;
    needs_reevaluation: boolean;
    facts: unknown;
    financial_year: string | null;
    profile_state: string | null;
  }>(
    `SELECT s.state, s.conclusion, s.system_outcome, s.system_detail, s.is_overridden,
            s.professional_action, s.partner_approved_at, s.needs_reevaluation, s.facts,
            e.financial_year, p.state AS profile_state
       FROM hsdg.audit_framework_subassessment s
       JOIN hsdg.engagements e ON e.id = s.engagement_id
       LEFT JOIN hsdg.audit_entity_profile p ON p.workflow_instance_id = s.workflow_instance_id
      WHERE s.workflow_instance_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3`,
    [workflowInstanceId, SUB, AREA],
  );
  const r = rows[0];
  if (!r) return null;
  const decided = isIcfrDecided(r.state, r.conclusion);
  const conclusion = decided ? ((r.conclusion as IcfrOutcome | null) ?? null) : null;
  const systemOutcome = (r.system_outcome as IcfrOutcome | null) ?? null;
  const outcome = decided ? conclusion : systemOutcome;
  const partnerReason = icfrPartnerApprovalReason({
    conclusion,
    systemOutcome,
    isOverridden: r.is_overridden,
  });
  const completion = icfrCompletion({
    detail: r.system_detail,
    conclusion,
    decided,
    professionalAction: r.professional_action,
    partnerRequired: partnerReason != null,
    partnerApproved: r.partner_approved_at != null,
    needsReevaluation: r.needs_reevaluation,
    upstreamReady: r.profile_state === 'confirmed',
    blockingMatterOpen: await icfrBlockingMatterOpen(client, workflowInstanceId),
    started: r.professional_action != null || r.facts != null,
    downstream: await icfrDownstreamStatusOn(client, workflowInstanceId),
  });
  const cfsInScope = cfsInScopeOf(r.system_detail);
  const status = contextStatuses(outcome, cfsInScope);
  const fy = r.financial_year;
  return {
    workflowInstanceId,
    outcome,
    decided,
    complete: completion.complete,
    reportingApplies:
      status.standalone === ICFR_CONTEXT_STATUS.pending
        ? null
        : status.standalone === ICFR_CONTEXT_STATUS.applicable,
    consolidated: { cfsInScope, status: status.consolidated },
    financialYear: fy,
    periodStart: fy
      ? auditPeriodStartFromFinancialYear(fy)
      : new Date().toISOString().slice(0, 10),
  };
}

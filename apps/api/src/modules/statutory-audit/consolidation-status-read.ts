import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  type ConsolidationApprovedResult,
  type ConsolidationCapturedFacts,
  type ConsolidationDetail,
  type ConsolidationOutcome,
  type ConsolidationProfessionalAction,
  type FrameworkState,
} from '@hsdg/contracts';
import {
  consolidationCompletion,
  consolidationPartnerApprovalReason,
  isConsolidationDecided,
} from './consolidation-completion';
import { groupAuditStatusOn } from './consolidation-group-read';
import { consolidationCrossLinksOn, readConsolidationResultOn } from './consolidation-read';

/**
 * DI-free 02.6 result WITH the §24 completion (Track A) for downstream
 * readers that gate on "02.6 complete" (planning, completion, reporting). Kept
 * apart from `consolidation-read.ts` because it reads Track B's group-audit
 * status, which itself reads `readConsolidationResultOn`. Reads the stored
 * (frozen / last persisted) assessment inside the caller's RLS transaction.
 */
export async function readConsolidationStatusOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ConsolidationApprovedResult | null> {
  const base = await readConsolidationResultOn(client, workflowInstanceId);
  if (!base) return null;
  const { rows } = await client.query<{
    id: string;
    state: FrameworkState;
    conclusion: string | null;
    system_outcome: string | null;
    is_overridden: boolean;
    system_detail: ConsolidationDetail | null;
    facts: Partial<ConsolidationCapturedFacts> | null;
    professional_action: ConsolidationProfessionalAction | null;
    partner_approved_at: Date | null;
    needs_reevaluation: boolean;
    authority_provision_id: string | null;
    profile_state: string | null;
    conversions_open: string;
  }>(
    `SELECT s.id, s.state, s.conclusion, s.system_outcome, s.is_overridden, s.system_detail,
            s.facts, s.professional_action, s.partner_approved_at, s.needs_reevaluation,
            s.authority_provision_id, p.state AS profile_state,
            (SELECT count(*) FROM hsdg.audit_consolidation_conversion c
              WHERE c.workflow_instance_id = s.workflow_instance_id
                AND c.status IN ('open','in_review')) AS conversions_open
       FROM hsdg.audit_framework_subassessment s
       LEFT JOIN hsdg.audit_entity_profile p ON p.workflow_instance_id = s.workflow_instance_id
      WHERE s.workflow_instance_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3`,
    [workflowInstanceId, SUB_SECTION_KEY.consolidation, FRAMEWORK_AREA_KEY.cfs],
  );
  const r = rows[0];
  if (!r) return base;
  const decided = isConsolidationDecided(r.state, r.conclusion);
  const conclusion = decided ? (r.conclusion as ConsolidationOutcome | null) : null;
  const partnerReason = decided
    ? consolidationPartnerApprovalReason({
        conclusion,
        systemOutcome: r.system_outcome as ConsolidationOutcome | null,
        isOverridden: r.is_overridden,
        detail: r.system_detail,
      })
    : null;
  const completion = consolidationCompletion({
    detail: r.system_detail,
    conclusion,
    decided,
    professionalAction: r.professional_action,
    partnerRequired: partnerReason != null,
    partnerApproved: r.partner_approved_at != null,
    needsReevaluation: r.needs_reevaluation,
    upstreamReady: r.profile_state === 'confirmed' && base.groupFramework != null,
    provisionResolved: r.authority_provision_id != null,
    started: r.professional_action != null || r.facts != null,
    isSubsidiary: !!(r.facts?.isWhollyOwnedSubsidiary || r.facts?.isPartiallyOwnedSubsidiary),
    groupAudit: await groupAuditStatusOn(client, workflowInstanceId),
    crossLinks: await consolidationCrossLinksOn(client, workflowInstanceId),
    conversionsOpen: Number(r.conversions_open),
  });
  return { ...base, complete: completion.complete };
}

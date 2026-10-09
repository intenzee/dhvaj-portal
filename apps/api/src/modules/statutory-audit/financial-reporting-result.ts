import type { PoolClient } from 'pg';
import {
  APPLICABILITY_TYPE_LABEL,
  REPORTING_FRAMEWORK_LABEL,
  SMC_STATUS,
  SMC_STATUS_LABEL,
  type FinancialReportingApprovedResult,
  type FinancialReportingMemoFacts,
  type ReportingFrameworkOutcome,
  type StatutoryAuditFinancialReporting,
} from '@hsdg/contracts';
import { isDecided, loadFinancialReportingOn } from './audit-financial-reporting.service';

/**
 * The 02.2 result as downstream sections read it (spec §19, §21 "pass the
 * approved framework result and rule metadata to 02.3–02.9"). Runs inside the
 * caller's RLS transaction. Use these helpers — never parse `system_detail`.
 */

async function loadOne(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<StatutoryAuditFinancialReporting | null> {
  const { rows } = await client.query<{ engagement_id: string }>(
    `SELECT engagement_id FROM hsdg.service_workflow_instances WHERE id = $1`,
    [workflowInstanceId],
  );
  if (!rows[0]) return null;
  const [fr] = await loadFinancialReportingOn(client, rows[0].engagement_id, {
    workflowInstanceId,
  });
  return fr ?? null;
}

/** The current 02.2 result (decided or live) with completion + approval flags. */
export async function readFinancialReportingResult(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FinancialReportingApprovedResult | null> {
  const fr = await loadOne(client, workflowInstanceId);
  if (!fr) return null;
  const a = fr.assessment;
  const decided = isDecided(a.state);
  return {
    workflowInstanceId,
    framework: decided ? (a.conclusion as ReportingFrameworkOutcome | null) : null,
    systemOutcome: a.systemOutcome as ReportingFrameworkOutcome | null,
    applicabilityType: fr.detail?.applicabilityType ?? null,
    effectiveFromFy: fr.detail?.effectiveFromFy ?? null,
    isNbfc: fr.detail?.isNbfc ?? false,
    smcStatus: fr.detail?.smc?.status ?? fr.detail?.smcStatus ?? SMC_STATUS.notApplicable,
    firstTimeAdoption: fr.firstTimeAdoption?.effective ?? false,
    complete: fr.completion?.complete ?? false,
    approved: fr.approved ?? false,
    ruleVersionId: a.ruleVersionId,
    authorityProvisionId: a.authorityProvisionId,
  };
}

const label = (o: string | null | undefined) =>
  o ? (REPORTING_FRAMEWORK_LABEL[o as ReportingFrameworkOutcome] ?? o.replace(/_/g, ' ')) : '—';

/** Display strings of the CURRENT 02.2 assessment for the technical memo merge (§18). */
export async function readFinancialReportingMemoFacts(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FinancialReportingMemoFacts | null> {
  const fr = await loadOne(client, workflowInstanceId);
  if (!fr) return null;
  const { rows } = await client.query<{ legal_name: string; financial_year: string }>(
    `SELECT ent.legal_name, e.financial_year
       FROM hsdg.engagements e JOIN hsdg.entities ent ON ent.id = e.entity_id
      WHERE e.id = $1`,
    [fr.engagementId],
  );
  const a = fr.assessment;
  const d = fr.detail;
  const decided = isDecided(a.state);
  const primaryRule = (d?.rulesApplied ?? []).find((r) => r.result !== 'not_triggered');
  return {
    entityName: rows[0]?.legal_name ?? '',
    financialYear: rows[0]?.financial_year ?? fr.auditFinancialYear ?? '',
    framework: label(decided ? a.conclusion : a.systemOutcome),
    applicabilityType: d?.applicabilityType ? APPLICABILITY_TYPE_LABEL[d.applicabilityType] : '—',
    effectiveFromFy: d?.effectiveFromFy ? `FY ${d.effectiveFromFy}` : '—',
    primaryTrigger: d?.primaryTrigger ?? '—',
    secondaryTriggers: (d?.secondaryTriggers ?? []).join('; ') || 'None',
    ruleApplied: primaryRule ? `${primaryRule.ruleCode} — ${primaryRule.label}` : '—',
    limitApplied: d?.limitApplied ?? 'Not applicable',
    factsUsed: (d?.factsUsed ?? []).map((f) => ({ label: f.label, value: `${f.value} (${f.source})` })),
    systemConclusion: label(a.systemOutcome),
    systemBasis: a.systemBasis ?? '',
    professionalConclusion: decided
      ? label(a.conclusion)
      : fr.professionalAction === 'information_pending'
        ? 'Information Pending'
        : 'Not yet concluded',
    isOverridden: a.isOverridden,
    overrideReason: a.isOverridden ? (a.basis ?? '') : '',
    smcStatus: SMC_STATUS_LABEL[d?.smc?.status ?? d?.smcStatus ?? SMC_STATUS.notApplicable],
    firstTimeAdoption: fr.firstTimeAdoption?.effective ? 'Yes — Ind AS 101 applies' : 'No',
    decidedBy: a.decidedByName ?? '',
    decidedAt: a.decidedAt ? a.decidedAt.slice(0, 10) : '',
    partnerApproval: !fr.partnerApproval?.required
      ? 'Not required'
      : fr.partnerApproval.approvedAt
        ? `Approved by ${fr.partnerApproval.approvedByName ?? 'the Engagement Partner'} on ${fr.partnerApproval.approvedAt.slice(0, 10)}`
        : `Pending — ${fr.partnerApproval.reason ?? ''}`,
    pendingReason: fr.pendingReason ?? '',
  };
}

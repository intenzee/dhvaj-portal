import type { PoolClient } from 'pg';
import type { FrameworkPriorYearComparison, FrameworkSnapshotFacts } from '@hsdg/contracts';
import { readApprovedSnapshotOn } from './framework-approval-read';
import { diffSnapshotFacts, snapshotFactsOf } from './framework-summary-records';
import { readFrameworkRecordInputsOn } from './framework-summary-inputs';
import { readPriorAuditFile } from './master-facts';

export const EMPTY_SNAPSHOT_FACTS: FrameworkSnapshotFacts = {
  entityClass: null,
  listed: null,
  smallCompany: null,
  reportingFramework: null,
  smcStatus: null,
  scheduleIiiRoute: null,
  caro: null,
  icfr: null,
  cfsRequired: null,
  groupEntities: [],
  componentAuditors: [],
  branchAuditors: [],
  rule11Items: [],
  section197Applicable: null,
  accountingSoftware: [],
  auditTrailApplicable: null,
  ruleVersions: [],
  methodologyVersion: null,
};

/**
 * 02.8 §8/§14 — the comparable facts frozen into an approved snapshot (Track B):
 * what next year's prior-year comparison and a revision's impact analysis diff
 * against. DI-free.
 */
export async function readSnapshotFactsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkSnapshotFacts> {
  return snapshotFactsOf(await readFrameworkRecordInputsOn(client, workflowInstanceId));
}

/**
 * 02.8 §8 — the current framework vs the immediately preceding approved
 * framework (the predecessor engagement's latest approved baseline), meaningful
 * changes only. Current-year values always come from the current 02.x
 * assessments; an initial audit has nothing to compare. DI-free.
 */
export async function readPriorYearChangesOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkPriorYearComparison> {
  const none = (reason: string, prior?: { engagementId: string; financialYear: string }) => ({
    available: false,
    reason,
    priorEngagementId: prior?.engagementId ?? null,
    priorPeriodLabel: prior ? `FY ${prior.financialYear}` : null,
    priorBaselineVersion: null,
    changes: [],
  });
  const inputs = await readFrameworkRecordInputsOn(client, workflowInstanceId);
  const prior = await readPriorAuditFile(client, workflowInstanceId);
  if (!prior)
    return none(
      inputs.initialAudit
        ? 'Initial audit — there is no preceding approved framework to compare.'
        : 'No earlier statutory-audit file of this client is available in the portal.',
    );
  const approved = await readApprovedSnapshotOn(client, prior.workflowInstanceId);
  if (!approved?.snapshot?.facts)
    return none(
      `The FY ${prior.financialYear} file has no approved Audit Framework baseline to compare.`,
      prior,
    );
  return {
    available: true,
    reason: null,
    priorEngagementId: prior.engagementId,
    priorPeriodLabel: `FY ${prior.financialYear}`,
    priorBaselineVersion: approved.version,
    changes: diffSnapshotFacts(approved.snapshot.facts, snapshotFactsOf(inputs)),
  };
}

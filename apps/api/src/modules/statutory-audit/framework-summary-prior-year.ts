import type { PoolClient } from 'pg';
import type { FrameworkPriorYearComparison, FrameworkSnapshotFacts } from '@hsdg/contracts';

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
 * 02.8 §8/§14 — the comparable facts frozen into an approved snapshot (Track B).
 * DI-free. PLACEHOLDER.
 */
export async function readSnapshotFactsOn(
  _client: PoolClient,
  _workflowInstanceId: string,
): Promise<FrameworkSnapshotFacts> {
  return EMPTY_SNAPSHOT_FACTS;
}

/**
 * 02.8 §8 — current framework vs the immediately preceding approved framework
 * (Track B). DI-free. PLACEHOLDER.
 */
export async function readPriorYearChangesOn(
  _client: PoolClient,
  _workflowInstanceId: string,
): Promise<FrameworkPriorYearComparison> {
  return {
    available: false,
    reason: 'Prior-year comparison not built yet.',
    priorEngagementId: null,
    priorPeriodLabel: null,
    priorBaselineVersion: null,
    changes: [],
  };
}

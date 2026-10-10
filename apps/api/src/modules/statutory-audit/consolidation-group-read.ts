import type { PoolClient } from 'pg';
import type { GroupAuditStatus } from '@hsdg/contracts';

/**
 * DI-free 02.6 Part B readers (Track B — group / component / branch auditor
 * framework). Track A's landing screen, CFS-05 summary and §24 checklist read
 * the group-audit status here without injecting Track B's service (importing a
 * service into a helper that service imports breaks Nest DI — 02.4 lesson).
 * Runs inside the caller's RLS transaction.
 *
 * PLACEHOLDER until Track B lands its tables: reports "nothing configured".
 */
export async function groupAuditStatusOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<GroupAuditStatus> {
  void client;
  void workflowInstanceId;
  return {
    matrixComplete: false,
    dhvajComponents: 0,
    otherAuditorComponents: 0,
    tbdComponents: 0,
    byComponent: {},
    sa600Required: false,
    sa600Pending: 0,
    instructionsPending: 0,
    pendingReports: 0,
    branchAuditPresent: 'pending',
    branchAuditors: 0,
    branchPending: 0,
    workProgrammeGenerated: false,
    blockingMatters: [],
  };
}

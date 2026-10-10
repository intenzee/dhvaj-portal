import type { PoolClient } from 'pg';
import {
  EMPTY_CROSS_REFS,
  EMPTY_DIRECTOR_STATUS,
  EMPTY_FRAUD_STATUS,
  type DirectorDisqualificationStatus,
  type FraudFrameworkStatus,
  type ReportingCrossRefs,
  type ReportingEvidenceCounts,
} from '@hsdg/contracts';

/**
 * DI-free reads of the 02.7 Track B records (Fraud Matters, the §164(2)
 * director workpaper, the 02.4 / 02.5 / 02.6 cross-references and the per-card
 * evidence links) for Track A's engine, matrix and completion. Each runs in the
 * caller's RLS transaction. Never import a service file here (ESM cycle breaks
 * Nest DI).
 *
 * PLACEHOLDER (Track A interface commit) — Track B replaces every body.
 */

export async function fraudFrameworkStatusOn(
  _client: PoolClient,
  _workflowInstanceId: string,
  _auditPeriodStart: string,
): Promise<FraudFrameworkStatus> {
  return EMPTY_FRAUD_STATUS;
}

export async function directorDisqualificationStatusOn(
  _client: PoolClient,
  _workflowInstanceId: string,
): Promise<DirectorDisqualificationStatus> {
  return EMPTY_DIRECTOR_STATUS;
}

export async function reportingCrossRefsOn(
  _client: PoolClient,
  _workflowInstanceId: string,
): Promise<ReportingCrossRefs> {
  return EMPTY_CROSS_REFS;
}

export async function reportingEvidenceCountsOn(
  _client: PoolClient,
  _workflowInstanceId: string,
): Promise<ReportingEvidenceCounts> {
  return {};
}

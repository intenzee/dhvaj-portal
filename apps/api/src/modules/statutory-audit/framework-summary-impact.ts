import type { PoolClient } from 'pg';
import type { FrameworkImpactAnalysis, FrameworkSourceSection } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';

/** What A's reopen() hands Track B (§15–§17). */
export interface FrameworkReopenedEvent {
  workflowInstanceId: string;
  engagementId: string;
  fromBaselineId: string;
  toBaselineId: string;
  fromVersion: string;
  toVersion: string;
  reason: string;
  affectedSections: FrameworkSourceSection[];
}

/** What A's approve() hands Track B once a baseline is approved (§14, §17). */
export interface FrameworkApprovedEvent {
  workflowInstanceId: string;
  engagementId: string;
  baselineId: string;
  version: string;
  /** The approved baseline this one supersedes (a re-approval after reopen), else null. */
  supersededBaselineId: string | null;
}

/**
 * The change-impact analysis of the current revision vs the approved baseline it
 * supersedes (§16), or null when the current baseline is not a revision.
 * DI-free. PLACEHOLDER.
 */
export async function readImpactOn(
  _client: PoolClient,
  _workflowInstanceId: string,
  _baselineId: string | null,
): Promise<FrameworkImpactAnalysis | null> {
  return null;
}

/** Reopen hook: impact first pass, notifications, Section 07/08 surfacing (§16–§17). PLACEHOLDER. */
export async function onFrameworkReopenedOn(
  _client: PoolClient,
  _ctx: RlsContext,
  _event: FrameworkReopenedEvent,
): Promise<void> {}

/** Approval hook: link downstream work to the baseline, notify owners (§14, §17). PLACEHOLDER. */
export async function onFrameworkApprovedOn(
  _client: PoolClient,
  _ctx: RlsContext,
  _event: FrameworkApprovedEvent,
): Promise<void> {}

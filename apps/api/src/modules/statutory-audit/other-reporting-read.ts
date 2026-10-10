import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  type FrameworkState,
  type OtherReportingDetail,
  type OtherReportingOutcome,
  type ReportingCard,
} from '@hsdg/contracts';

/** The stored 02.7 result for downstream readers (Track B work programme, completion, Section 08). */
export interface OtherReportingStoredResult {
  state: FrameworkState;
  /** The professional conclusion when decided, else null. */
  conclusion: OtherReportingOutcome | null;
  systemOutcome: OtherReportingOutcome | null;
  decided: boolean;
  /** Requirement cards from the last persisted engine run (empty before the first run). */
  cards: ReportingCard[];
  needsReevaluation: boolean;
}

const DECIDED = new Set<string>(['applicable', 'not_applicable', 'overridden', 'approved']);

/**
 * DI-free read of the stored (frozen once decided, else last persisted) 02.7
 * matrix inside the caller's RLS transaction. Null when 02.7 is not seeded.
 */
export async function readOtherReportingResultOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<OtherReportingStoredResult | null> {
  const { rows } = await client.query<{
    state: FrameworkState;
    conclusion: string | null;
    system_outcome: string | null;
    system_detail: Partial<OtherReportingDetail> | null;
    needs_reevaluation: boolean;
  }>(
    `SELECT state, conclusion, system_outcome, system_detail, needs_reevaluation
       FROM hsdg.audit_framework_subassessment
      WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
    [workflowInstanceId, SUB_SECTION_KEY.otherReporting, FRAMEWORK_AREA_KEY.otherRegulatory],
  );
  const r = rows[0];
  if (!r) return null;
  const decided = DECIDED.has(r.state) && r.conclusion != null;
  return {
    state: r.state,
    conclusion: decided ? (r.conclusion as OtherReportingOutcome) : null,
    systemOutcome: (r.system_outcome as OtherReportingOutcome | null) ?? null,
    decided,
    cards: Array.isArray(r.system_detail?.cards) ? r.system_detail!.cards : [],
    needsReevaluation: r.needs_reevaluation,
  };
}

import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  type FrameworkState,
  type OtherReportingDetail,
  type OtherReportingOutcome,
  type ReportingCard,
  type ReportingCardKey,
  type ReportingCardState,
  type ReportingStatus,
  type ReportingWorkStatus,
} from '@hsdg/contracts';
import { DEFAULT_CARD_STATE } from './other-reporting';

/** The stored 02.7 result for downstream readers (Track B work programme, completion, Section 08). */
export interface OtherReportingStoredResult {
  state: FrameworkState;
  /** The professional conclusion when decided, else null. */
  conclusion: OtherReportingOutcome | null;
  systemOutcome: OtherReportingOutcome | null;
  decided: boolean;
  /** Requirement cards from the last persisted engine run, with the live card work state. */
  cards: ReportingCard[];
  needsReevaluation: boolean;
}

const DECIDED = new Set<string>(['applicable', 'not_applicable', 'overridden', 'approved']);

/** A card's work state before the team touches it (the engine's default). */
export const BLANK_CARD_STATE = DEFAULT_CARD_STATE;

/**
 * The team's per-card work state (hsdg.audit_reporting_card), keyed by card —
 * live even after 02.7 is approved (spec §20: cards may stay Work Pending).
 */
export async function readCardStatesOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<Map<ReportingCardKey, ReportingCardState>> {
  const { rows } = await client.query<{
    card_key: ReportingCardKey;
    work_status: ReportingWorkStatus;
    reporting_status: ReportingStatus | null;
    proposed_conclusion: string | null;
    exceptions: number;
    exception_note: string | null;
    source_workpaper: string | null;
    reviewed_by_name: string | null;
    reviewed_at: Date | null;
    version: number;
  }>(
    `SELECT c.card_key, c.work_status, c.reporting_status, c.proposed_conclusion, c.exceptions,
            c.exception_note, c.source_workpaper, emp.full_name AS reviewed_by_name,
            c.reviewed_at, c.version
       FROM hsdg.audit_reporting_card c
       LEFT JOIN hsdg.employees emp ON emp.id = c.reviewed_by_employee_id
      WHERE c.workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  return new Map(
    rows.map((r) => [
      r.card_key,
      {
        workStatus: r.work_status,
        reportingStatus: r.reporting_status,
        proposedConclusion: r.proposed_conclusion,
        exceptions: r.exceptions,
        exceptionNote: r.exception_note,
        sourceWorkpaper: r.source_workpaper,
        reviewedByName: r.reviewed_by_name,
        reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
        version: r.version,
      },
    ]),
  );
}

/** Overlay the live card work state on engine / stored cards. */
export function withCardStates(
  cards: ReportingCard[],
  states: Map<ReportingCardKey, ReportingCardState>,
): ReportingCard[] {
  return cards.map((c) => ({ ...c, state: states.get(c.key) ?? BLANK_CARD_STATE }));
}

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
  const cards = Array.isArray(r.system_detail?.cards) ? r.system_detail!.cards : [];
  return {
    state: r.state,
    conclusion: decided ? (r.conclusion as OtherReportingOutcome) : null,
    systemOutcome: (r.system_outcome as OtherReportingOutcome | null) ?? null,
    decided,
    cards: cards.length ? withCardStates(cards, await readCardStatesOn(client, workflowInstanceId)) : [],
    needsReevaluation: r.needs_reevaluation,
  };
}

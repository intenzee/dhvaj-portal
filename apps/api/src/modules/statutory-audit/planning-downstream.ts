import type { PoolClient } from 'pg';
import type { PlanningDestination, PlanningDownstreamFlag } from '@hsdg/contracts';
import type { AuditAreaReviewService } from './audit-area-review.service';
import { flagScopeReassessment } from './audit-scope-approach.service';

/**
 * §19 dynamic planning — a 03.1 change flags the downstream planning work it
 * affects for reassessment. Completed work is never rewritten: a completed
 * sub-area goes to Needs Attention, 03.4 to Reassessment Required and 03.5 to
 * Update Required, and the Manager re-performs them. Runs in the caller's
 * transaction.
 */

/** The Phase 03 checklist rows a 03.1 destination maps to (03.6 / 03.7 have no module yet). */
const DESTINATION_ITEMS: Partial<Record<PlanningDestination, string[]>> = {
  '03.6': ['risk_to_response'],
  '03.8': ['team_allocation', 'specialist_planning'],
  '03.9': ['component_planning'],
  '03.11': ['timeline_milestones'],
};

/** AS-01: a change of overall orientation reopens 03.4 scope, 03.6 risk-to-response and 03.7 programme. */
export const ORIENTATION_ITEMS = ['risk_to_response', 'audit_programme'] as const;

const ITEM_MODULE: Record<string, string> = {
  audit_approach: '03.4',
  overall_audit_plan: '03.4',
  areas_and_assertions: '03.5',
  risk_to_response: '03.6',
  audit_programme: '03.7',
  team_allocation: '03.8',
  specialist_planning: '03.8',
  component_planning: '03.9',
  timeline_milestones: '03.11',
};

/** Pure: the checklist rows a set of destinations reaches. */
export function itemsForDestinations(destinations: readonly string[]): string[] {
  return [
    ...new Set(destinations.flatMap((d) => DESTINATION_ITEMS[d as PlanningDestination] ?? [])),
  ];
}

export function moduleForItem(itemKey: string): string {
  return ITEM_MODULE[itemKey] ?? '03';
}

/** Completed checklist rows → Needs Attention. Returns the keys actually flagged. */
export async function flagPlanningItems(
  client: PoolClient,
  workflowInstanceId: string,
  itemKeys: readonly string[],
): Promise<string[]> {
  if (!itemKeys.length) return [];
  const { rows } = await client.query<{ item_key: string }>(
    `UPDATE hsdg.audit_planning_items
        SET state = 'needs_attention', content_updated_at = now(), version = version + 1
      WHERE workflow_instance_id = $1 AND item_key = ANY($2::text[]) AND state = 'complete'
     RETURNING item_key`,
    [workflowInstanceId, [...itemKeys]],
  );
  return rows.map((r) => r.item_key);
}

/**
 * Route a 03.1 change to every downstream module its destinations reach.
 * Returns what was flagged (for the audit trail).
 */
export async function routeFocusChange(
  client: PoolClient,
  areaReview: AuditAreaReviewService,
  workflowInstanceId: string,
  destinations: readonly string[],
  reason: string,
): Promise<string[]> {
  const flagged: string[] = [];
  if (destinations.includes('03.4')) {
    if (await flagScopeReassessment(client, workflowInstanceId, 'other', reason)) {
      flagged.push('03.4');
    }
  }
  if (destinations.includes('03.5')) {
    await areaReview.markImpacted(client, workflowInstanceId);
    flagged.push('03.5');
  }
  const items = await flagPlanningItems(
    client,
    workflowInstanceId,
    itemsForDestinations(destinations),
  );
  return [...flagged, ...items.map(moduleForItem)];
}

/** An Area of Focus' routing facts, read before / after a change. */
export async function readFocusRouting(
  client: PoolClient,
  focusId: string,
): Promise<{ name: string; destinations: string[]; status: string }> {
  const { rows } = await client.query<{ name: string; destinations: string[]; status: string }>(
    `SELECT name, destinations, status FROM hsdg.audit_area_of_focus WHERE id = $1`,
    [focusId],
  );
  const r = rows[0];
  return {
    name: r?.name ?? '',
    destinations: [...(r?.destinations ?? [])].sort(),
    status: r?.status ?? '',
  };
}

/**
 * AS-01: once an orientation was recorded, changing it flags 03.4 scope &
 * approach for reassessment and 03.6 risk-to-response / 03.7 programme for
 * re-performance. Returns the modules flagged.
 */
export async function onOrientationChanged(
  client: PoolClient,
  workflowInstanceId: string,
  from: string,
  to: string | null,
): Promise<string[]> {
  const reason = `03.1 AS-01 overall audit orientation changed (${from} → ${to ?? 'not recorded'}).`;
  const flagged: string[] = [];
  if (await flagScopeReassessment(client, workflowInstanceId, 'other', reason)) {
    flagged.push('03.4');
  }
  const items = await flagPlanningItems(client, workflowInstanceId, ORIENTATION_ITEMS);
  return [...flagged, ...items.map(moduleForItem)];
}

/** Sub-areas currently Needs Attention, for the 03.1 banner. */
export async function readDownstreamFlags(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<PlanningDownstreamFlag[]> {
  const { rows } = await client.query<{ item_key: string; title: string }>(
    `SELECT item_key, title FROM hsdg.audit_planning_items
      WHERE workflow_instance_id = $1 AND state = 'needs_attention'
      ORDER BY sort_order ASC`,
    [workflowInstanceId],
  );
  return rows.map((r) => ({
    itemKey: r.item_key,
    title: r.title,
    module: moduleForItem(r.item_key),
  }));
}

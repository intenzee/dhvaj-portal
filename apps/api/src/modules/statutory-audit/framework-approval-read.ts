import type { PoolClient } from 'pg';
import type { FrameworkBaselineSnapshot, FrameworkPlanningGate } from '@hsdg/contracts';

/**
 * 02.8 — the single source of "is the Audit Framework approved?" (§13, §20).
 * DI-free so Planning, Work, Reassessment and the 02.8 Track B helpers can read it
 * inside their own transaction without importing a service (ESM cycles break Nest
 * DI). The 02.8 baseline is authoritative; a legacy SA-2 approval row (files
 * approved before 02.8 existed) still counts as approved.
 */
export interface FrameworkApprovalState {
  /** The current baseline is approved (not reopened). */
  approved: boolean;
  /** Some baseline was approved at least once (a reopened revision keeps this true). */
  everApproved: boolean;
  /** The current baseline version, e.g. "1.1" (null when none). */
  currentVersion: string | null;
  /** The latest APPROVED baseline (current or superseded), or null. */
  approvedBaselineId: string | null;
  approvedVersion: string | null;
  /** True once a reopened revision is in progress (latest approved one superseded). */
  reopened: boolean;
  planning: FrameworkPlanningGate;
}

export const FRAMEWORK_GATE_LOCKED: FrameworkPlanningGate = {
  unlocked: false,
  route: 'locked',
  reason: 'Section 03 opens once the Engagement Partner approves the Audit Framework (02.8).',
};

/** The approval state of each workflow instance (missing ids → not approved). */
export async function readFrameworkApprovalStateOn(
  client: PoolClient,
  workflowInstanceIds: string[],
): Promise<Map<string, FrameworkApprovalState>> {
  const out = new Map<string, FrameworkApprovalState>();
  if (workflowInstanceIds.length === 0) return out;
  const { rows } = await client.query<{
    workflow_instance_id: string;
    current_version: string | null;
    current_status: string | null;
    approved_id: string | null;
    approved_version: string | null;
    legacy_approved: boolean;
    blocking_conditions: number;
    conditional: boolean;
  }>(
    `SELECT w.id AS workflow_instance_id,
            cur.version AS current_version, cur.status AS current_status,
            ap.id AS approved_id, ap.version AS approved_version,
            EXISTS (SELECT 1 FROM hsdg.audit_framework_approvals fa
                     WHERE fa.workflow_instance_id = w.id) AS legacy_approved,
            COALESCE(cond.blocking, 0)::int AS blocking_conditions,
            COALESCE(cond.total, 0) > 0 AS conditional
       FROM unnest($1::uuid[]) AS w(id)
       LEFT JOIN LATERAL (
         SELECT b.version, b.status FROM hsdg.audit_framework_baseline b
          WHERE b.workflow_instance_id = w.id AND b.status <> 'superseded'
          ORDER BY b.created_at DESC LIMIT 1) cur ON true
       LEFT JOIN LATERAL (
         SELECT b.id, b.version FROM hsdg.audit_framework_baseline b
          WHERE b.workflow_instance_id = w.id AND b.ep_approved_at IS NOT NULL
          ORDER BY b.ep_approved_at DESC LIMIT 1) ap ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE c.status = 'open' AND NOT c.planning_may_commence) AS blocking,
                count(*) AS total
           FROM hsdg.audit_framework_condition c
          WHERE c.baseline_id = ap.id) cond ON true`,
    [workflowInstanceIds],
  );
  for (const r of rows) {
    const everApproved = r.approved_id != null || r.legacy_approved;
    // A file approved before 02.8 existed stays approved until 02.8 approves it.
    const approved =
      r.current_status === 'approved' || (r.approved_id == null && r.legacy_approved);
    const reopened = r.approved_id != null && r.current_status !== 'approved';
    let planning: FrameworkPlanningGate = FRAMEWORK_GATE_LOCKED;
    if (everApproved) {
      planning =
        r.blocking_conditions > 0
          ? {
              unlocked: false,
              route: 'locked',
              reason:
                'The framework was approved subject to a condition that must be resolved before Planning commences.',
            }
          : r.conditional
            ? {
                unlocked: true,
                route: 'conditional',
                reason: 'Approved subject to conditions that permit Planning to commence.',
              }
            : {
                unlocked: true,
                route: 'approved',
                reason: reopened
                  ? `Framework v${r.approved_version} approved; a controlled revision (v${r.current_version}) is in progress.`
                  : 'Audit Framework approved.',
              };
    }
    out.set(r.workflow_instance_id, {
      approved,
      everApproved,
      currentVersion: r.current_version,
      approvedBaselineId: r.approved_id,
      approvedVersion: r.approved_version,
      reopened,
      planning,
    });
  }
  return out;
}

/** One workflow instance's approval state. */
export async function readFrameworkApprovalOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkApprovalState> {
  const m = await readFrameworkApprovalStateOn(client, [workflowInstanceId]);
  return m.get(workflowInstanceId)!;
}

/**
 * The frozen snapshot of the latest approved baseline of a workflow instance
 * (or of the given version) — what the next year's prior-year comparison and a
 * revision's impact analysis diff against (§8, §14, §16). Null when none.
 */
export async function readApprovedSnapshotOn(
  client: PoolClient,
  workflowInstanceId: string,
  version?: string,
): Promise<{ baselineId: string; version: string; snapshot: FrameworkBaselineSnapshot } | null> {
  const { rows } = await client.query<{
    id: string;
    version: string;
    snapshot: FrameworkBaselineSnapshot | null;
  }>(
    `SELECT id, version, snapshot FROM hsdg.audit_framework_baseline
      WHERE workflow_instance_id = $1 AND ep_approved_at IS NOT NULL AND snapshot IS NOT NULL
        AND ($2::text IS NULL OR version = $2)
      ORDER BY ep_approved_at DESC LIMIT 1`,
    [workflowInstanceId, version ?? null],
  );
  const r = rows[0];
  return r?.snapshot ? { baselineId: r.id, version: r.version, snapshot: r.snapshot } : null;
}

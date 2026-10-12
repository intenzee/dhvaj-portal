/**
 * Change 5 — a filing's workflow status, derived from the work around it (spec
 * p.23). Nobody sets In preparation / In review / Ready to file by hand: they
 * follow the linked task, the open client requests and the client's approval.
 * Filed comes only from a live filing record (Lodge); Not applicable is set by a
 * manager and sticks until they lift it.
 *
 * Only workflow_status is written; the foundation trigger derives the legacy
 * `status` (filed → completed, not_applicable → waived, else open).
 */
import type { PoolClient } from 'pg';

export type WorkflowStatus =
  | 'not_started'
  | 'awaiting_data'
  | 'in_preparation'
  | 'in_review'
  | 'ready_to_file'
  | 'filed'
  | 'not_applicable';

/** The checklist item that records the client's approval of tax payable (GSTR-3B). */
export const CLIENT_APPROVAL_ITEM = 'CLIENT_APPROVAL';

export interface WorkflowInputs {
  current: WorkflowStatus | null;
  hasLiveFiling: boolean;
  taskStatus: string | null;
  openDependencies: number;
  /** A required client-approval item exists and is not done yet. */
  approvalPending: boolean;
}

export function deriveWorkflowStatus(i: WorkflowInputs): WorkflowStatus {
  if (i.hasLiveFiling) return 'filed';
  if (i.current === 'not_applicable') return 'not_applicable';
  if (i.taskStatus === 'done') return i.approvalPending ? 'in_review' : 'ready_to_file';
  if (i.taskStatus === 'in_review') return 'in_review';
  if (i.openDependencies > 0) return 'awaiting_data';
  if (i.taskStatus === 'in_progress' || i.taskStatus === 'paused' || i.taskStatus === 'blocked') {
    return 'in_preparation';
  }
  return 'not_started';
}

/**
 * Re-derive one instance's workflow status on the caller's transaction. Returns
 * the new status (unchanged rows are not touched, so updated_at stays honest).
 */
export async function refreshWorkflowStatus(
  client: PoolClient,
  instanceId: string,
): Promise<WorkflowStatus | null> {
  const { rows } = await client.query<{
    workflow_status: WorkflowStatus | null;
    has_live_filing: boolean;
    task_status: string | null;
    open_deps: number;
    approval_pending: boolean;
  }>(
    `SELECT ci.workflow_status,
            EXISTS (SELECT 1 FROM hsdg.filing_records fr
                     WHERE fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL) AS has_live_filing,
            (SELECT t.status FROM hsdg.tasks t
              WHERE t.source_compliance_instance_id = ci.id AND t.status <> 'cancelled'
              ORDER BY t.created_at DESC LIMIT 1) AS task_status,
            (SELECT count(*) FROM hsdg.client_dependencies d
              WHERE d.compliance_instance_id = ci.id
                AND d.status IN ('pending','partially_received'))::int AS open_deps,
            EXISTS (SELECT 1 FROM hsdg.instance_checklist_items it
                     WHERE it.compliance_instance_id = ci.id AND it.item_code = $2
                       AND it.required AND it.status = 'open') AS approval_pending
       FROM hsdg.compliance_instances ci
      WHERE ci.id = $1`,
    [instanceId, CLIENT_APPROVAL_ITEM],
  );
  const r = rows[0];
  if (!r) return null;
  const next = deriveWorkflowStatus({
    current: r.workflow_status,
    hasLiveFiling: r.has_live_filing,
    taskStatus: r.task_status,
    openDependencies: r.open_deps,
    approvalPending: r.approval_pending,
  });
  if (next !== r.workflow_status) {
    // status / completed_at follow via the compliance_instances_sync_status trigger.
    await client.query(`UPDATE hsdg.compliance_instances SET workflow_status = $2 WHERE id = $1`, [
      instanceId,
      next,
    ]);
  }
  return next;
}

import type { PoolClient } from 'pg';

/**
 * The assignment history (hsdg.task_assignments): who held a task's doing or
 * its review before, who holds it now, who moved it, when and why. Rows are
 * never edited or deleted by the app (UPDATE/DELETE are revoked).
 *
 * Every change of a task's assignee or reviewer records one row here — giving
 * a set (C-3), splitting it (C-4), moving someone's open work (C-6) — so the
 * callers share this one writer rather than each inserting their own way.
 */

/** Which hand on the task changed. */
export type AssignmentKind = 'assignee' | 'reviewer';

export interface AssignmentChange {
  taskId: string;
  kind: AssignmentKind;
  /** Who held it before; null when it had no one. */
  from: string | null;
  /** Who holds it now; null when it is taken off them with no one in their place. */
  to: string | null;
  /** The employee making the change (ctx.employeeId); null for a system job. */
  by: string | null;
  reason?: string | null;
}

/**
 * Records one or many assignment changes in a single statement, inside the
 * caller's transaction and security context. It writes history only: change
 * the task row itself in the same transaction. Changes whose `from` and `to`
 * are the same person are skipped. Returns the number of rows written.
 */
export async function recordAssignment(
  client: PoolClient,
  changes: AssignmentChange | readonly AssignmentChange[],
): Promise<number> {
  const list = (Array.isArray(changes) ? changes : [changes]).filter(
    (c: AssignmentChange) => c.from !== c.to,
  );
  if (!list.length) return 0;
  const { rowCount } = await client.query(
    `INSERT INTO hsdg.task_assignments
       (task_id, kind, from_employee_id, to_employee_id, by_employee_id, reason)
     SELECT * FROM unnest($1::uuid[], $2::text[], $3::uuid[], $4::uuid[], $5::uuid[], $6::text[])`,
    [
      list.map((c) => c.taskId),
      list.map((c) => c.kind),
      list.map((c) => c.from),
      list.map((c) => c.to),
      list.map((c) => c.by),
      list.map((c) => c.reason?.trim() || null),
    ],
  );
  return rowCount ?? 0;
}

/** A task that is still to be done (not done, not cancelled). */
export const OPEN_TASK_SQL = `status NOT IN ('done', 'cancelled')`;

/**
 * C-6 hand-over: every open task one person does or reviews goes to another,
 * each move recorded through recordAssignment. The receiver joins the team of
 * each engagement the work sits on (unless they already lead it) so they can
 * see it. The caller decides who may do this and audits it.
 */
export async function moveOpenWork(
  client: PoolClient,
  input: { from: string; to: string; by: string | null; reason: string },
): Promise<{ assigned: number; reviews: number }> {
  await client.query(
    `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
     SELECT DISTINCT t.engagement_id, $2::uuid, 'member'
       FROM hsdg.tasks t JOIN hsdg.engagements g ON g.id = t.engagement_id
      WHERE (t.assigned_to_employee_id = $1 OR t.reviewer_employee_id = $1) AND t.${OPEN_TASK_SQL}
        AND g.engagement_partner_id IS DISTINCT FROM $2
        AND g.engagement_manager_id IS DISTINCT FROM $2
     ON CONFLICT (engagement_id, employee_id) DO NOTHING`,
    [input.from, input.to],
  );

  const move = async (column: string, kind: AssignmentKind): Promise<number> => {
    const assignee = kind === 'assignee';
    const { rows } = await client.query<{ id: string }>(
      `UPDATE hsdg.tasks SET ${column} = $2${assignee ? ', assigned_by_employee_id = $3' : ''},
              version = version + 1
        WHERE ${column} = $1 AND ${OPEN_TASK_SQL}
       RETURNING id`,
      assignee ? [input.from, input.to, input.by] : [input.from, input.to],
    );
    await recordAssignment(
      client,
      rows.map((r) => ({
        taskId: r.id,
        kind,
        from: input.from,
        to: input.to,
        by: input.by,
        reason: input.reason,
      })),
    );
    return rows.length;
  };
  const assigned = await move('assigned_to_employee_id', 'assignee');
  const reviews = await move('reviewer_employee_id', 'reviewer');
  return { assigned, reviews };
}

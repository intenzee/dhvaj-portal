/**
 * Change 3 — the automatic-time engine's database half. DI-free helpers that run
 * on the caller's transaction client, so a task transition, a lodge, the idle /
 * day-end closer and the heartbeat all open and close entries atomically with
 * the change that caused them.
 *
 * Invariants: one running entry per person (the one_running_timer_per_employee
 * index); an entry is never overwritten once closed (corrections are adjustment
 * rows); a closed auto entry ends no later than its last heartbeat when the
 * person went idle.
 */
import type { PoolClient } from 'pg';
import {
  AUTO_TIME,
  TASK_STATUS,
  TIME_ENTRY_KIND,
  TIME_SOURCE,
  TIME_STOP_REASON,
  type ClockState,
  type TimeEntryKind,
  type TimeStopReason,
} from '@hsdg/contracts';

export interface ClosedEntry {
  id: string;
  employeeId: string;
  engagementId: string;
  taskId: string | null;
  entryKind: TimeEntryKind;
  durationSeconds: number;
}

interface ClosedRow {
  id: string;
  employee_id: string;
  engagement_id: string;
  task_id: string | null;
  entry_kind: TimeEntryKind;
  duration_seconds: number;
}

const mapClosed = (r: ClosedRow): ClosedEntry => ({
  id: r.id,
  employeeId: r.employee_id,
  engagementId: r.engagement_id,
  taskId: r.task_id,
  entryKind: r.entry_kind,
  durationSeconds: r.duration_seconds,
});

/**
 * The end-time expression for a closure. `now` closes at the current instant;
 * `heartbeat` closes at the last sign of life (idle); a Date closes at that
 * moment (day-end cut-off). Never before the entry started.
 */
type EndAt = 'now' | 'heartbeat' | Date;

function endExpr(endAt: EndAt, param: string): string {
  if (endAt === 'now') return 'now()';
  if (endAt === 'heartbeat') return 'GREATEST(te.started_at, COALESCE(te.last_heartbeat_at, te.started_at))';
  return `GREATEST(te.started_at, LEAST(now(), ${param}::timestamptz))`;
}

async function closeWhere(
  client: PoolClient,
  where: string,
  params: unknown[],
  reason: TimeStopReason,
  endAt: EndAt,
): Promise<ClosedEntry[]> {
  const all = [...params, reason];
  const reasonParam = `$${all.length}`;
  let endParam = '';
  if (endAt instanceof Date) {
    all.push(endAt.toISOString());
    endParam = `$${all.length}`;
  }
  const end = endExpr(endAt, endParam);
  const { rows } = await client.query<ClosedRow>(
    `UPDATE hsdg.engagement_time_entries te
        SET ended_at = ${end},
            duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (${end} - te.started_at))::int),
            stopped_reason = ${reasonParam},
            version = te.version + 1
      WHERE te.ended_at IS NULL AND ${where}
      RETURNING te.id, te.employee_id, te.engagement_id, te.task_id, te.entry_kind,
                te.duration_seconds`,
    all,
  );
  return rows.map(mapClosed);
}

/** Close the running entries on one task (of the given kinds). */
export function closeTaskEntries(
  client: PoolClient,
  taskId: string,
  kinds: TimeEntryKind[],
  reason: TimeStopReason,
): Promise<ClosedEntry[]> {
  return closeWhere(client, `te.task_id = $1 AND te.entry_kind = ANY($2::text[])`, [taskId, kinds], reason, 'now');
}

/** Close whatever the person has running (manual or auto), e.g. on a task switch. */
export function closeRunningFor(
  client: PoolClient,
  employeeId: string,
  reason: TimeStopReason,
): Promise<ClosedEntry[]> {
  return closeWhere(client, `te.employee_id = $1`, [employeeId], reason, 'now');
}

/**
 * After a closure the system made (switch / idle / day-end / sign-out), keep the
 * task consistent with its clock: a work task that was In progress pauses; a
 * review whose clock stopped is no longer "being reviewed". Writes task_events
 * through the trigger with the given reason; `system` attributes them to nobody.
 */
export async function settleTasksAfterClose(
  client: PoolClient,
  closed: ClosedEntry[],
  reason: TimeStopReason,
  system: boolean,
): Promise<string[]> {
  const paused: string[] = [];
  const work = closed.filter((c) => c.taskId && c.entryKind === TIME_ENTRY_KIND.work);
  const review = closed.filter((c) => c.taskId && c.entryKind === TIME_ENTRY_KIND.review);
  if (work.length === 0 && review.length === 0) return paused;
  await setEventContext(client, reason, system);
  try {
    for (const c of work) {
      const { rows } = await client.query<{ id: string }>(
        `UPDATE hsdg.tasks SET status = $2, version = version + 1
          WHERE id = $1 AND status = $3 AND assigned_to_employee_id = $4
          RETURNING id`,
        [c.taskId, TASK_STATUS.paused, TASK_STATUS.inProgress, c.employeeId],
      );
      if (rows[0]) paused.push(rows[0].id);
    }
    for (const c of review) {
      await client.query(
        `UPDATE hsdg.tasks SET review_started_at = NULL, version = version + 1
          WHERE id = $1 AND status = $2 AND reviewer_employee_id = $3`,
        [c.taskId, TASK_STATUS.inReview, c.employeeId],
      );
    }
  } finally {
    await setEventContext(client, null, false);
  }
  return paused;
}

/** Pass a reason / system flag to the task_events trigger for this transaction. */
export async function setEventContext(
  client: PoolClient,
  reason: string | null,
  system: boolean,
): Promise<void> {
  await client.query(
    `SELECT set_config('hsdg.task_event_reason', $1, true),
            set_config('hsdg.task_event_system', $2, true)`,
    [reason ?? '', system ? 'on' : 'off'],
  );
}

export interface OpenEntryInput {
  engagementId: string;
  employeeId: string;
  taskId: string;
  engagementServiceId: string | null;
  kind: TimeEntryKind;
  isBillable: boolean;
}

/** Open an auto entry (the caller must have closed their previous one). */
export async function openAutoEntry(client: PoolClient, input: OpenEntryInput): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO hsdg.engagement_time_entries
       (engagement_id, employee_id, task_id, engagement_service_id, entry_kind, source,
        is_billable, last_heartbeat_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     RETURNING id`,
    [
      input.engagementId,
      input.employeeId,
      input.taskId,
      input.engagementServiceId,
      input.kind,
      TIME_SOURCE.auto,
      input.isBillable,
    ],
  );
  return rows[0]!.id;
}

/** Keep the caller's running auto entry alive. Returns whether one was touched. */
export async function beat(client: PoolClient, employeeId: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE hsdg.engagement_time_entries SET last_heartbeat_at = now()
      WHERE employee_id = $1 AND ended_at IS NULL AND source = 'auto'`,
    [employeeId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Close every running auto entry with no heartbeat for `idleMinutes` at its last
 * heartbeat (idle), and pause the tasks. Runs under the scheduler's firm-wide
 * operator context.
 */
export async function closeIdle(
  client: PoolClient,
  idleMinutes: number = AUTO_TIME.idleAfterMinutes,
): Promise<ClosedEntry[]> {
  const closed = await closeWhere(
    client,
    `te.source = 'auto'
     AND COALESCE(te.last_heartbeat_at, te.started_at) < now() - make_interval(mins => $1::int)`,
    [idleMinutes],
    TIME_STOP_REASON.idle,
    'heartbeat',
  );
  await settleTasksAfterClose(client, closed, TIME_STOP_REASON.idle, true);
  return closed;
}

/**
 * Office day-end: close running auto entries that started before today's
 * cut-off, at the cut-off (day_end), and pause the tasks. Someone who starts
 * after the cut-off keeps their clock (the idle closer still watches it).
 */
export async function closeDayEnd(client: PoolClient, cutoff: Date): Promise<ClosedEntry[]> {
  const closed = await closeWhere(
    client,
    `te.source = 'auto' AND te.started_at < $1::timestamptz`,
    [cutoff.toISOString()],
    TIME_STOP_REASON.dayEnd,
    cutoff,
  );
  await settleTasksAfterClose(client, closed, TIME_STOP_REASON.dayEnd, true);
  return closed;
}

/**
 * Today's office day-end in IST as an absolute instant, or null when it has not
 * been reached yet. IST has no DST, so the offset is fixed at +05:30.
 */
export function dayEndCutoff(now: Date, hourIst: number = AUTO_TIME.defaultDayEndHourIst): Date | null {
  const istMs = now.getTime() + 330 * 60_000;
  const ist = new Date(istMs);
  const cutoffIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hourIst, 0, 0);
  const cutoff = new Date(cutoffIstMs - 330 * 60_000);
  return now.getTime() >= cutoff.getTime() ? cutoff : null;
}

/** The caller's clock: what is running, and what they can resume after being away. */
export async function clockState(client: PoolClient, employeeId: string): Promise<ClockState> {
  const running = await client.query<{
    id: string;
    engagement_id: string;
    engagement_code: string;
    task_id: string | null;
    task_title: string | null;
    entry_kind: TimeEntryKind;
    started_at: Date;
  }>(
    `SELECT te.id, te.engagement_id, e.engagement_code, te.task_id, t.title AS task_title,
            te.entry_kind, te.started_at
       FROM hsdg.engagement_time_entries te
       JOIN hsdg.engagements e ON e.id = te.engagement_id
       LEFT JOIN hsdg.tasks t ON t.id = te.task_id
      WHERE te.employee_id = $1 AND te.ended_at IS NULL
      LIMIT 1`,
    [employeeId],
  );
  const r = running.rows[0];
  if (r) {
    return {
      running: {
        entryId: r.id,
        engagementId: r.engagement_id,
        engagementCode: r.engagement_code,
        taskId: r.task_id,
        taskTitle: r.task_title,
        entryKind: r.entry_kind,
        startedAt: r.started_at.toISOString(),
      },
      resumable: null,
    };
  }
  // Away and back: the last auto WORK entry closed by the system in the last 12h,
  // whose task is still paused and still theirs, with nothing started since.
  const last = await client.query<{
    id: string;
    engagement_id: string;
    task_id: string;
    task_title: string;
    ended_at: Date;
    stopped_reason: TimeStopReason;
  }>(
    `SELECT te.id, te.engagement_id, te.task_id, t.title AS task_title, te.ended_at, te.stopped_reason
       FROM hsdg.engagement_time_entries te
       JOIN hsdg.tasks t ON t.id = te.task_id
      WHERE te.employee_id = $1 AND te.source = 'auto' AND te.entry_kind = 'work'
        AND te.adjusts_entry_id IS NULL
        AND te.stopped_reason IN ('idle','day_end','signed_out')
        AND te.ended_at > now() - interval '12 hours'
        AND t.status = 'paused' AND t.assigned_to_employee_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM hsdg.engagement_time_entries n
           WHERE n.employee_id = $1 AND n.adjusts_entry_id IS NULL AND n.started_at > te.started_at)
      ORDER BY te.ended_at DESC
      LIMIT 1`,
    [employeeId],
  );
  const l = last.rows[0];
  return {
    running: null,
    resumable: l
      ? {
          entryId: l.id,
          engagementId: l.engagement_id,
          taskId: l.task_id,
          taskTitle: l.task_title,
          awaySince: l.ended_at.toISOString(),
          stoppedReason: l.stopped_reason,
        }
      : null,
  };
}

import {
  TIMELINE_EVENT,
  periodKeyLabel,
  type ProgressCounts,
  type ProgressRow,
  type TaskTimelineEntry,
  type TimelineEvent,
} from '@hsdg/contracts';

/**
 * Phase 3, D-1 — the Progress tracker's pure parts: the SQL for its status
 * mapping (one expression, shared by the counts and the drill-down so they
 * always agree), the filing key, the table order and the task timeline.
 */

/**
 * The tracker status of a task row `t` with its filing `ci` (LEFT JOINed):
 * Completed = done, or the filing is marked filed; Not started = todo; the
 * rest (in_progress, paused, blocked, in_review) is In progress. Cancelled
 * rows are filtered out before this is read.
 */
export const PROGRESS_SQL = `CASE WHEN t.status = 'done' OR ci.workflow_status = 'filed' THEN 'completed'
            WHEN t.status = 'todo' THEN 'not_started'
            ELSE 'in_progress' END`;

/** Open (not completed) and past its internal date; `$today` is the IST date. */
export const overdueSql = (today: string): string =>
  `(t.status <> 'done' AND ci.workflow_status IS DISTINCT FROM 'filed'
     AND t.due_date IS NOT NULL AND t.due_date < ${today}::date)`;

/** A filing row's key: its form and period. */
export function filingKey(formLabel: string, periodKey: string | null): string {
  return `${formLabel}|${periodKey ?? ''}`;
}

export function parseFilingKey(key: string): { formLabel: string; periodKey: string | null } {
  const at = key.lastIndexOf('|');
  if (at < 0) return { formLabel: key, periodKey: null };
  const periodKey = key.slice(at + 1);
  return { formLabel: key.slice(0, at), periodKey: periodKey === '' ? null : periodKey };
}

/** "GSTR-1 · Oct 2026"; the form alone when the period is not known. */
export function filingLabel(formLabel: string, periodKey: string | null): string {
  const period = periodKey ? periodKeyLabel(periodKey) : '';
  return period ? `${formLabel} · ${period}` : formLabel;
}

/** The person row's key; work nobody holds yet is "none". */
export const NO_ONE = 'none';

/** Overdue first, then the most open work, then by name. Pure. */
export function sortProgressRows<T extends ProgressRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      b.overdue - a.overdue ||
      b.notStarted + b.inProgress - (a.notStarted + a.inProgress) ||
      a.label.localeCompare(b.label),
  );
}

export interface CountsRow {
  not_started: number;
  in_progress: number;
  completed: number;
  overdue: number;
  waiting: number;
  in_review: number;
}

export function countsOf(r: CountsRow): ProgressCounts {
  return {
    notStarted: r.not_started,
    inProgress: r.in_progress,
    completed: r.completed,
    overdue: r.overdue,
    waitingOnClient: r.waiting,
    inReview: r.in_review,
    total: r.not_started + r.in_progress + r.completed,
  };
}

export const ZERO_COUNTS: ProgressCounts = {
  notStarted: 0,
  inProgress: 0,
  completed: 0,
  overdue: 0,
  waitingOnClient: 0,
  inReview: 0,
  total: 0,
};

/** The select-list for the counts, over the base CTE's columns. */
export const COUNTS_SQL = `count(*) FILTER (WHERE progress = 'not_started')::int AS not_started,
       count(*) FILTER (WHERE progress = 'in_progress')::int AS in_progress,
       count(*) FILTER (WHERE progress = 'completed')::int AS completed,
       count(*) FILTER (WHERE overdue)::int AS overdue,
       count(*) FILTER (WHERE progress = 'in_progress' AND status = 'blocked')::int AS waiting,
       count(*) FILTER (WHERE progress = 'in_progress' AND status = 'in_review')::int AS in_review`;

// ── Timeline ────────────────────────────────────────────────────────────

export interface StatusEventRow {
  from_status: string | null;
  to_status: string;
  actor_name: string | null;
  reason: string | null;
  at: string;
}

export interface AssignmentRow {
  kind: 'assignee' | 'reviewer';
  by_name: string | null;
  to_name: string | null;
  reason: string | null;
  at: string;
}

export interface FilingRow {
  filed_by_name: string | null;
  reference_no: string | null;
  at: string;
}

export interface TaskHeadRow {
  created_at: string;
  created_by_name: string | null;
  assignee_name: string | null;
  assigned_by_name: string | null;
  assigned_at: string | null;
}

/** What a status change means on the timeline (null: not worth a line). Pure. */
export function statusEvent(from: string | null, to: string): TimelineEvent | null {
  if (from === null) return TIMELINE_EVENT.created;
  if (from === to) return null;
  if (from === 'done' || from === 'cancelled') return TIMELINE_EVENT.reopened;
  if (to === 'cancelled') return TIMELINE_EVENT.cancelled;
  if (to === 'done')
    return from === 'in_review' ? TIMELINE_EVENT.approved : TIMELINE_EVENT.completed;
  if (from === 'in_review') return TIMELINE_EVENT.sentBack;
  if (to === 'in_review') return TIMELINE_EVENT.sentForReview;
  if (to === 'blocked') return TIMELINE_EVENT.waitingOnClient;
  if (to === 'paused') return TIMELINE_EVENT.paused;
  if (to === 'in_progress') return TIMELINE_EVENT.started;
  return null;
}

/**
 * A task's history, oldest first: created; every hand-over of the work and the
 * review (task_assignments — or, for work handed out before that history was
 * kept, the current holder at the time it was given); each status change with
 * who made it (task_events); and the filing once filed. Pure.
 */
export function buildTimeline(
  head: TaskHeadRow,
  events: StatusEventRow[],
  assignments: AssignmentRow[],
  filings: FilingRow[],
): TaskTimelineEntry[] {
  const out: TaskTimelineEntry[] = [];
  let created = false;
  for (const e of events) {
    const event = statusEvent(e.from_status, e.to_status);
    if (!event) continue;
    if (event === TIMELINE_EVENT.created) created = true;
    out.push({ event, at: e.at, byName: e.actor_name, note: e.reason });
  }
  if (!created) {
    out.push({ event: TIMELINE_EVENT.created, at: head.created_at, byName: head.created_by_name });
  }
  for (const a of assignments) {
    out.push({
      event: a.kind === 'assignee' ? TIMELINE_EVENT.assigned : TIMELINE_EVENT.reviewerSet,
      at: a.at,
      byName: a.by_name,
      toName: a.to_name,
      note: a.reason,
    });
  }
  if (head.assignee_name && !assignments.some((a) => a.kind === 'assignee')) {
    out.push({
      event: TIMELINE_EVENT.assigned,
      at: head.assigned_at ?? head.created_at,
      byName: head.assigned_by_name ?? head.created_by_name,
      toName: head.assignee_name,
    });
  }
  for (const f of filings) {
    out.push({
      event: TIMELINE_EVENT.filed,
      at: f.at,
      byName: f.filed_by_name,
      note: f.reference_no,
    });
  }
  // Same instant: created before assigned before the rest, as it happened.
  const rank = (e: TimelineEvent): number =>
    e === TIMELINE_EVENT.created ? 0 : e === TIMELINE_EVENT.assigned ? 1 : 2;
  return out
    .map((e, i) => ({ e, i }))
    .sort(
      (x, y) =>
        new Date(x.e.at).getTime() - new Date(y.e.at).getTime() ||
        rank(x.e.event) - rank(y.e.event) ||
        x.i - y.i,
    )
    .map((x) => x.e);
}

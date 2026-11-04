/**
 * Phase 3, D-1 / D-2 — the Progress tracker. Counts of open and finished work
 * for a period (by internal due date), by person, by client & engagement, or by
 * filing, with a drill-down list that the counts always add up to, and each
 * task's timeline.
 *
 * Scope follows the reporting tree: the Managing Partner and an administrator
 * see the firm; a Partner / Manager their tree; a Senior their Articles; an
 * Article their own list — and never more than row-level security lets them.
 */

import type { WorkItemRef } from './work-links';

/** The tracker's own statuses; cancelled work is in none of them. */
export const PROGRESS_STATUS = {
  /** todo */
  notStarted: 'not_started',
  /** in_progress, paused, blocked (waiting on client), in_review */
  inProgress: 'in_progress',
  /** done, or its filing is marked filed */
  completed: 'completed',
} as const;
export type ProgressStatus = (typeof PROGRESS_STATUS)[keyof typeof PROGRESS_STATUS];
export const PROGRESS_STATUSES: ProgressStatus[] = Object.values(PROGRESS_STATUS);

export const PROGRESS_STATUS_LABEL: Record<ProgressStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

export const PROGRESS_GROUP = {
  person: 'person',
  client: 'client',
  filing: 'filing',
} as const;
export type ProgressGroup = (typeof PROGRESS_GROUP)[keyof typeof PROGRESS_GROUP];
export const PROGRESS_GROUPS: ProgressGroup[] = Object.values(PROGRESS_GROUP);

/** Who the caller's tracker covers (shown on the page). */
export type ProgressScope = 'firm' | 'tree' | 'own';

/** Filters shared by the counts and the drill-down. */
export interface ProgressFilters {
  /** Internal due date from / to (ISO dates, inclusive). Leave both out for all dates. */
  from?: string;
  to?: string;
  /** The engagement's office. */
  officeId?: string;
  /** A stream (gst, income_tax, …) or an engagement kind (statutory_audit, assignment). */
  stream?: string;
  /** The client's team. */
  teamId?: string;
}

export interface ProgressCounts {
  notStarted: number;
  inProgress: number;
  completed: number;
  /** Open (not completed) work past its internal date, IST — an overlay on the two open counts. */
  overdue: number;
  /** Of inProgress: blocked, waiting on the client. */
  waitingOnClient: number;
  /** Of inProgress: with the reviewer. */
  inReview: number;
  /** notStarted + inProgress + completed. */
  total: number;
}

/** Who holds a filing's open work ("2 with Kirandeep"). */
export interface ProgressHolder {
  employeeId: string | null;
  fullName: string | null;
  open: number;
}

/** One row of a table; the keys depend on the grouping. */
export interface ProgressRow extends ProgressCounts {
  /** Stable key; pass it back as the drill-down's filter. */
  key: string;
  /** "Kirandeep Kaur", "Sunrise Traders — GST 2026-27", "GSTR-1 · Oct 2026". */
  label: string;
  /** By person: the assignee (null = not assigned yet). */
  employeeId?: string | null;
  /** By client: the engagement and its client. */
  engagementId?: string;
  engagementCode?: string;
  /** "GST · 2026-27": the service and period, not the code. */
  engagementLabel?: string;
  clientId?: string | null;
  clientName?: string | null;
  /** By filing: the form and period it groups. */
  formLabel?: string;
  periodKey?: string | null;
  /** By filing: who holds the open work, most first (top 3). */
  holders?: ProgressHolder[];
}

/** GET /work/progress */
export interface ProgressView {
  groupBy: ProgressGroup;
  scope: ProgressScope;
  /** IST date the overdue overlay is measured against. */
  today: string;
  filters: ProgressFilters;
  totals: ProgressCounts;
  /** Overdue first, then the most open work. */
  rows: ProgressRow[];
}

/** One task of the drill-down (GET /work/progress/items). */
export interface ProgressItem {
  taskId: string;
  title: string;
  status: string;
  progress: ProgressStatus;
  isOverdue: boolean;
  dueDate: string | null;
  engagementId: string;
  engagementCode: string;
  entityName: string;
  clientName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  reviewerName: string | null;
  /** "GSTR-1 · Oct 2026" when the task belongs to a filing. */
  filingLabel: string | null;
  stream: string | null;
  /** Where the task opens: its filing's tab, or its engagement's work tab. */
  link: WorkItemRef;
}

/** Drill-down filters: the table's filters plus one row's key and, optionally, a status. */
export interface ProgressItemsQuery extends ProgressFilters {
  groupBy?: ProgressGroup;
  key?: string;
  progress?: ProgressStatus;
  overdueOnly?: boolean;
}

/** One step of a task's history (GET /work/progress/tasks/:taskId/timeline). */
export const TIMELINE_EVENT = {
  created: 'created',
  assigned: 'assigned',
  reviewerSet: 'reviewer_set',
  started: 'started',
  paused: 'paused',
  waitingOnClient: 'waiting_on_client',
  sentForReview: 'sent_for_review',
  sentBack: 'sent_back',
  approved: 'approved',
  completed: 'completed',
  filed: 'filed',
  cancelled: 'cancelled',
  reopened: 'reopened',
} as const;
export type TimelineEvent = (typeof TIMELINE_EVENT)[keyof typeof TIMELINE_EVENT];

export const TIMELINE_EVENT_LABEL: Record<TimelineEvent, string> = {
  created: 'Created',
  assigned: 'Assigned',
  reviewer_set: 'Reviewer set',
  started: 'Started',
  paused: 'Paused',
  waiting_on_client: 'Waiting on client',
  sent_for_review: 'Sent for review',
  sent_back: 'Sent back',
  approved: 'Approved',
  completed: 'Completed',
  filed: 'Filed',
  cancelled: 'Cancelled',
  reopened: 'Reopened',
};

export interface TaskTimelineEntry {
  event: TimelineEvent;
  at: string;
  /** Who did it (null when the system did, or it is not known). */
  byName: string | null;
  /** Assigned / reviewer set: to whom. */
  toName?: string | null;
  /** A reason, a filing's acknowledgement number. */
  note?: string | null;
}

export interface TaskTimeline {
  taskId: string;
  title: string;
  entries: TaskTimelineEntry[];
}

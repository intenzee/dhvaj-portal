/**
 * Engagement Restructure · Change 3 — task workflow, automatic time and the
 * Activity tab, shared by the API and web.
 *
 * A clock runs for a person only while a task assigned to them is In progress,
 * or while they are reviewing a task they opened for review. Nobody presses
 * Start/Stop: they move the task, and the time engine opens or closes the entry
 * in the same database transaction.
 */

/** Why a time entry was closed — the whole Change 3 vocabulary. */
export const TIME_STOP_REASON = {
  /** The person stopped a manual timer, or a cut-over closed it. */
  manual: 'manual',
  /** The engagement reached a terminal state. */
  engagementClosed: 'engagement_closed',
  /** The person started a different task; the old one paused. */
  taskSwitched: 'task_switched',
  paused: 'paused',
  /** Waiting on client. */
  blocked: 'blocked',
  submittedForReview: 'submitted_for_review',
  reviewApproved: 'review_approved',
  reviewReturned: 'review_returned',
  /** Marked done without review (review model allows), or closed by a lodge. */
  taskDone: 'task_done',
  taskCancelled: 'task_cancelled',
  /** No heartbeat for 15 minutes — closed at the last heartbeat. */
  idle: 'idle',
  /** Office day-end (default 20:00 IST). */
  dayEnd: 'day_end',
  signedOut: 'signed_out',
} as const;
export type TimeStopReason = (typeof TIME_STOP_REASON)[keyof typeof TIME_STOP_REASON];
export const TIME_STOP_REASONS: TimeStopReason[] = Object.values(TIME_STOP_REASON);

export const TIME_ENTRY_KIND = { work: 'work', review: 'review', other: 'other' } as const;
export type TimeEntryKind = (typeof TIME_ENTRY_KIND)[keyof typeof TIME_ENTRY_KIND];

export const TIME_SOURCE = { auto: 'auto', manual: 'manual' } as const;
export type TimeSource = (typeof TIME_SOURCE)[keyof typeof TIME_SOURCE];

/** Activity → Time → Add other time (time not tied to a task). */
export const OTHER_TIME_CATEGORY = {
  clientCall: 'client_call',
  clientMeeting: 'client_meeting',
  internalMeeting: 'internal_meeting',
  travel: 'travel',
  training: 'training',
  admin: 'admin',
  other: 'other',
} as const;
export type OtherTimeCategory = (typeof OTHER_TIME_CATEGORY)[keyof typeof OTHER_TIME_CATEGORY];
export const OTHER_TIME_CATEGORIES: OtherTimeCategory[] = Object.values(OTHER_TIME_CATEGORY);
/** Categories that are not billable to the client by default. */
export const NON_BILLABLE_TIME_CATEGORIES: OtherTimeCategory[] = [
  OTHER_TIME_CATEGORY.internalMeeting,
  OTHER_TIME_CATEGORY.training,
  OTHER_TIME_CATEGORY.admin,
];

/** Task work types — "Other … work" in a stream is a task tagged with one of these. */
export const WORK_TYPE = {
  /** Produces a calendar filing (generated from a compliance instance). */
  filing: 'filing',
  notice: 'notice',
  appeal: 'appeal',
  refund: 'refund',
  registration: 'registration',
  advisory: 'advisory',
  other: 'other',
} as const;
export type WorkType = (typeof WORK_TYPE)[keyof typeof WORK_TYPE];
export const WORK_TYPES: WorkType[] = Object.values(WORK_TYPE);

/** The task transitions (POST /engagements/:id/tasks/:taskId/<action>). */
export const TASK_ACTION = {
  start: 'start',
  pause: 'pause',
  block: 'block',
  sendForReview: 'send-for-review',
  startReview: 'start-review',
  approve: 'approve',
  return: 'return',
  /** Done without review — only when the task has no reviewer, or a lead closes it. */
  complete: 'complete',
  cancel: 'cancel',
  /** A lead reopens a done / cancelled task. */
  reopen: 'reopen',
} as const;
export type TaskAction = (typeof TASK_ACTION)[keyof typeof TASK_ACTION];
export const TASK_ACTIONS: TaskAction[] = Object.values(TASK_ACTION);

/** Time-engine timings (minutes). */
export const AUTO_TIME = {
  heartbeatEveryMinutes: 2,
  /** The web client only beats while the user used mouse/keyboard in this window. */
  activeWithinMinutes: 10,
  idleAfterMinutes: 15,
  closerEveryMinutes: 5,
  /** A person may adjust their own entries for this many days. */
  adjustWithinDays: 3,
  /** Adjustments that move more than this many minutes need a lead's approval. */
  adjustApprovalOverMinutes: 30,
  defaultDayEndHourIst: 20,
} as const;

/** The caller's clock, returned by the heartbeat and every transition. */
export interface ClockState {
  running: {
    entryId: string;
    engagementId: string;
    engagementCode: string;
    taskId: string | null;
    taskTitle: string | null;
    entryKind: TimeEntryKind;
    startedAt: string;
  } | null;
  /**
   * Set when the caller's last auto entry was closed for inactivity and its task
   * can be resumed: "You were away from 15:10 — resume?".
   */
  resumable: {
    entryId: string;
    engagementId: string;
    taskId: string;
    taskTitle: string;
    awaySince: string;
    stoppedReason: TimeStopReason;
  } | null;
}

export interface HeartbeatResult extends ClockState {
  /** False when the heartbeat had nothing to keep alive. */
  alive: boolean;
}

/** One time-summary row (Activity → Time). `key` is the grouped value. */
export interface TimeSummaryRow {
  key: string;
  label: string;
  totalSeconds: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  entryCount: number;
}

export const TIME_SUMMARY_BY = {
  person: 'person',
  stream: 'stream',
  month: 'month',
  task: 'task',
} as const;
export type TimeSummaryBy = (typeof TIME_SUMMARY_BY)[keyof typeof TIME_SUMMARY_BY];

/** Budget vs actual per stream for one compliance year (hours). */
export interface TimeBudgetRow {
  financialYear: string;
  stream: string;
  budgetHours: number | null;
  actualHours: number;
}

export interface TimeSummary {
  by: TimeSummaryBy;
  rows: TimeSummaryRow[];
  totals: { totalSeconds: number; billableSeconds: number; nonBillableSeconds: number };
  budget: TimeBudgetRow[];
  /** Adjustments awaiting a lead's approval on this engagement. */
  pendingAdjustments: number;
}

/** A pending time adjustment, for the lead's approval list. */
export interface TimeAdjustmentRecord {
  id: string;
  adjustsEntryId: string;
  employeeId: string;
  employeeName: string;
  originalStartedAt: string;
  originalEndedAt: string | null;
  originalSeconds: number | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/** Engagement Activity → Timeline. */
export const ACTIVITY_KIND = {
  statusChange: 'status_change',
  taskEvent: 'task_event',
  filingLodged: 'filing_lodged',
  filingUndone: 'filing_undone',
  filingCorrection: 'filing_correction',
  filingWaived: 'filing_waived',
  documentUploaded: 'document_uploaded',
  dependencyRaised: 'dependency_raised',
  dependencyClosed: 'dependency_closed',
  reviewPoint: 'review_point',
  comment: 'comment',
  timeDay: 'time_day',
  independenceAck: 'independence_ack',
  /** ROC / MCA events (AGM held, director change …) and what they moved. */
  eventRecorded: 'event_recorded',
  eventCorrected: 'event_corrected',
  eventVoided: 'event_voided',
} as const;
export type ActivityKind = (typeof ACTIVITY_KIND)[keyof typeof ACTIVITY_KIND];

export interface ActivityItem {
  /** `<kind>:<source id>` (time_day: `time_day:<employee>:<date>`). */
  id: string;
  kind: ActivityKind;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  title: string;
  detail: string | null;
  stream: string | null;
  engagementServiceId: string | null;
  complianceInstanceId: string | null;
  taskId: string | null;
  /** Comments only. */
  isPinned: boolean;
  /** Free-form extras per kind (ARN, seconds, from/to status…). */
  meta: Record<string, unknown>;
}

export interface ActivityPage {
  items: ActivityItem[];
  /** Opaque; pass back as `cursor` for the next page. null = end. */
  nextCursor: string | null;
}

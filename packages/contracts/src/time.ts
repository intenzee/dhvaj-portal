/**
 * Engagement time-tracking vocabulary (ADR-0034) shared by the API and web.
 *
 * A manual stopwatch per person per engagement. It never auto-stops on
 * inactivity — work often happens outside the portal — so a running entry
 * (`endedAt === null`) stays running until an explicit stop, or until the
 * engagement reaches a terminal state and the safety net force-stops it.
 *
 * Invariant: at most ONE running entry per person, firm-wide (a person works on
 * one thing at a time). Enforced in the database by a partial unique index.
 */

import type {
  OtherTimeCategory,
  TimeEntryKind,
  TimeSource,
  TimeStopReason,
} from './time-auto';
import type { WorkItemRef } from './work-links';

/**
 * Why a running entry was stopped — the manual-timer subset of TIME_STOP_REASON
 * (time-auto.ts holds the full Change 3 vocabulary).
 */
export const STOPPED_REASON = {
  /** The person clicked Stop. */
  manual: 'manual',
  /** The engagement reached a terminal state; the safety net force-stopped it. */
  engagementClosed: 'engagement_closed',
} as const;
export type StoppedReason = TimeStopReason;

/** One time entry (a single start→stop session, or a still-running one). */
export interface TimeEntryRecord {
  id: string;
  engagementId: string;
  employeeId: string;
  employeeName: string;
  startedAt: string;
  /** null while the timer is running. */
  endedAt: string | null;
  /** Seconds; null while running — compute live elapsed from `startedAt`. */
  durationSeconds: number | null;
  isRunning: boolean;
  note: string | null;
  stoppedReason: StoppedReason | null;
  /** Change 3: the task this clock ran for (null for manual / other time). */
  taskId: string | null;
  taskTitle: string | null;
  engagementServiceId: string | null;
  entryKind: TimeEntryKind;
  source: TimeSource;
  category: OtherTimeCategory | null;
  isBillable: boolean;
  /** Set on an adjustment row: the entry it corrects. */
  adjustsEntryId: string | null;
  adjustmentReason: string | null;
  adjustmentStatus: 'pending' | 'approved' | 'rejected' | null;
  /** True when an approved adjustment replaced this entry in reports. */
  isSuperseded: boolean;
  version: number;
}

/**
 * The caller's single running timer, if any — powers the always-visible global
 * banner and the "you have a timer running" close prompt. Carries the parent
 * engagement's labels so the banner can name and deep-link it without a second
 * fetch. `null` when the caller has no running timer.
 */
export interface ActiveTimer {
  entry: TimeEntryRecord;
  engagementCode: string;
  entityName: string;
  /** The work the clock runs on — its task's filing when it has one (WF-205). */
  link: WorkItemRef;
}

/** Per-person rollup of time on a single engagement. */
export interface EngagementTimePersonRow {
  employeeId: string;
  employeeName: string;
  /** Sum of completed durations; excludes the live tail of a running entry. */
  totalSeconds: number;
  entryCount: number;
  /** True when this person currently has a running timer on the engagement. */
  hasRunning: boolean;
}

/** An engagement's time entries plus the per-person summary (the Time tab). */
export interface EngagementTimeReport {
  entries: TimeEntryRecord[];
  byPerson: EngagementTimePersonRow[];
  /** Sum of completed durations across everyone on the engagement. */
  totalSeconds: number;
}

/** One person's total time across all engagements the caller can see. */
export interface FirmTimeRow {
  employeeId: string;
  employeeName: string;
  gradeName: string | null;
  officeCode: string | null;
  totalSeconds: number;
  entryCount: number;
  /** How many distinct engagements they logged time against. */
  engagementCount: number;
  hasRunning: boolean;
}

/**
 * Firm-wide time report for the higher-ups (gated by `report.read`): time per
 * person across every engagement the caller can see. RLS-scoped exactly like
 * the other MIS reports.
 */
export interface FirmTimeReport {
  rows: FirmTimeRow[];
  totals: {
    people: number;
    totalSeconds: number;
    running: number;
  };
}

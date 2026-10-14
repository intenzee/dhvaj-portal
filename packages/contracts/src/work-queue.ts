import type { EngagementKind } from './engagement-restructure';
import type { WorkItemRef } from './work-links';

/**
 * Staff Workflow Phase 1 (WF-102 / WF-105) — the shapes My Work renders: the
 * filing a task produces, and the review queue (GET /work/reviews).
 */

/**
 * The filing a task produces, for the row's context line ("GSTR-1 · Sep 2026 ·
 * 19AAAC…") and its two dates. Null on a task with no filing.
 */
export interface WorkFilingContext {
  instanceId: string;
  /** The rule's form name for this filing (instance → rule version → rule name). */
  formLabel: string;
  /** 'Sep 2026', 'Q2 2026-27', 'FY 2026-27'. */
  periodLabel: string;
  registrationNumber: string | null;
  /** The firm's internal date (override, else the computed SLA). */
  internalDate: string | null;
  /** The operative statutory date (override → government extension → computed). */
  statutoryDate: string | null;
}

export const WORK_REVIEW_TYPE = {
  /** A task sent to me for review (tasks.reviewer_employee_id = me, in_review). */
  filingReview: 'filing_review',
  /** An open review point on an engagement I lead and must clear. */
  reviewPoint: 'review_point',
  /** An engagement cleared at review, waiting for my partner sign-off. */
  signOff: 'sign_off',
} as const;
export type WorkReviewType = (typeof WORK_REVIEW_TYPE)[keyof typeof WORK_REVIEW_TYPE];

interface WorkReviewBase {
  /** Stable row key: the task / review point / engagement id. */
  id: string;
  type: WorkReviewType;
  engagementId: string;
  engagementCode: string;
  engagementKind: EngagementKind;
  entityName: string;
  /** What to show as the row's title. */
  title: string;
  /** When the item started waiting on me (sent for review / raised / cleared). */
  waitingSince: string;
  /** Whole days since `waitingSince` (IST calendar days). */
  daysWaiting: number;
  link: WorkItemRef;
}

export interface FilingReviewItem extends WorkReviewBase {
  type: 'filing_review';
  taskId: string;
  preparerId: string | null;
  preparerName: string | null;
  /** The task's own due date. */
  dueDate: string | null;
  /** The filing's internal date (else the task's due date). */
  internalDate: string | null;
  statutoryDate: string | null;
  /** True once the reviewer has opened the review (their clock is running). */
  reviewStarted: boolean;
  /** When the current review was opened (null until Start review). */
  reviewStartedAt: string | null;
  /** The task's version, for acting on it from the queue (start review / approve / return). */
  taskVersion: number;
  filing: WorkFilingContext | null;
}

export interface ReviewPointItem extends WorkReviewBase {
  type: 'review_point';
  reviewPointId: string;
  raisedById: string;
  raisedByName: string | null;
  isKeyMatter: boolean;
}

export interface SignOffItem extends WorkReviewBase {
  type: 'sign_off';
  reviewModelName: string;
  /** Who cleared the last review. */
  clearedByName: string | null;
}

export type WorkReviewItem = FilingReviewItem | ReviewPointItem | SignOffItem;

/** GET /work/reviews — everything waiting for my review, oldest first. */
export interface WorkReviewQueue {
  items: WorkReviewItem[];
  total: number;
}

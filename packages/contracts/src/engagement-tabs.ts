/**
 * Change 3 — what the engagement page needs to lay out its tabs: the kind
 * (Compliance shows twelve tabs, Statutory Audit six), the years in scope,
 * which stream tabs appear for each year (with the stream lead), and the
 * Overview widgets (next 30 days, overdue, waiting on client, hours vs
 * budget, unbilled).
 */
import type { FeePeriod } from './commercial';
import type { EngagementKind, FilingStatus, PeriodSection, Stream } from './engagement-restructure';

export interface StreamScope {
  stream: Stream;
  /** The stream's service line on this engagement (null when only instances carry it). */
  engagementServiceId: string | null;
  leadEmployeeId: string | null;
  leadName: string | null;
  /** Years this stream is in scope, newest first. */
  financialYears: string[];
}

export interface OverviewDueItem {
  instanceId: string;
  stream: Stream | null;
  label: string;
  periodKey: string | null;
  periodLabel: string | null;
  section: PeriodSection | null;
  dueDate: string;
  /** Negative when overdue. */
  daysLeft: number;
  workflowStatus: FilingStatus;
  registrationNumber: string | null;
}

export interface OverviewWaiting {
  id: string;
  requestedInfo: string;
  stream: Stream | null;
  requestDate: string;
  escalationDate: string | null;
  isOverdue: boolean;
}

export interface EngagementOverview {
  dueNext30: OverviewDueItem[];
  overdue: OverviewDueItem[];
  waitingOnClient: OverviewWaiting[];
  /** Effective (approved) recorded time, hours. */
  hoursThisMonth: number;
  hoursThisYear: number;
  /** Sum of the year's per-stream budget hours (null = no budget set). */
  budgetHoursThisYear: number | null;
  /** The year's value of the agreed fee: fee_amount × periods in a year (CM-4). */
  feeAmount: number | null;
  /** CM-4 · the fee as typed, for `feePeriod` (₹5,000 / month). */
  feePerPeriod: number | null;
  feePeriod: FeePeriod | null;
  /** Issued + paid invoices dated in the year. */
  invoicedAmount: number;
  /** fee − invoiced, never below 0; null when no fee is set. */
  unbilledAmount: number | null;
}

export interface EngagementTabs {
  kind: EngagementKind;
  /** Years in scope, newest first. */
  financialYears: string[];
  /** The year the Overview figures are for (today's FY when in scope, else the newest). */
  financialYear: string | null;
  streams: StreamScope[];
  overview: EngagementOverview;
}

/** Engagement page tab keys (?tab=…). */
export const ENGAGEMENT_TAB = {
  overview: 'overview',
  services: 'services',
  mis: 'mis',
  bookkeeping: 'bookkeeping',
  gst: 'gst',
  tds: 'tds',
  incomeTax: 'income_tax',
  roc: 'roc',
  auditFile: 'audit_file',
  documents: 'documents',
  team: 'team',
  activity: 'activity',
  invoices: 'invoices',
  // Legacy layout (flag off / other assignments).
  work: 'work',
  compliance: 'compliance',
  time: 'time',
  notes: 'notes',
} as const;
export type EngagementTab = (typeof ENGAGEMENT_TAB)[keyof typeof ENGAGEMENT_TAB];

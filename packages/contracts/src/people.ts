/**
 * The HR role's People desk (spec docs/accountant-hr-roles-spec.md §4).
 *
 * Everything here is about people, never about client work: no client,
 * engagement or task name ever appears, only counts and hours. Attendance and
 * workload come from SECURITY DEFINER functions that return per-person figures
 * (hsdg.attendance_by_day, hsdg.people_workload), so HR sees them without any
 * access to the engagements behind them.
 */
import type { EmploymentStatus, GradeSlug } from './identity';
import type { OtherTimeCategory } from './time-auto';

/** One person's day: when they started and stopped, and the hours by kind. */
export interface AttendanceDay {
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  officeCode: string | null;
  gradeName: string | null;
  /** IST calendar day, YYYY-MM-DD. */
  day: string;
  firstStart: string;
  /** Null while every entry of the day is still running. */
  lastStop: string | null;
  /** A timer is running now (its time so far is counted). */
  running: boolean;
  totalSeconds: number;
  /** Task time. */
  workSeconds: number;
  /** Reviewing someone's work. */
  reviewSeconds: number;
  /** "Other time" (calls, meetings, travel, training, admin…). */
  otherSeconds: number;
  /** Other time split by its category. */
  categorySeconds: Partial<Record<OtherTimeCategory, number>>;
}

export interface AttendanceReport {
  from: string;
  to: string;
  rows: AttendanceDay[];
}

/** One person's load: counts only — never a client or an engagement name. */
export interface PeopleWorkloadRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  officeCode: string;
  gradeSlug: GradeSlug;
  gradeName: string;
  employmentStatus: EmploymentStatus;
  asPartner: number;
  asManager: number;
  asTeam: number;
  /** Distinct active engagements, whatever the role on them. */
  activeEngagements: number;
  openTasks: number;
  overdueTasks: number;
  /** Hours logged in the week asked for, in seconds. */
  weekSeconds: number;
}

/** A week over 45 hours is "over"; under 20 is "under" (spec §4.4). */
export const WORKLOAD_OVER_SECONDS = 45 * 3600;
export const WORKLOAD_UNDER_SECONDS = 20 * 3600;

export interface PeopleWorkloadReport {
  /** Monday of the week the hours cover, YYYY-MM-DD. */
  weekStart: string;
  rows: PeopleWorkloadRow[];
  totals: {
    people: number;
    over: number;
    under: number;
    withOverdue: number;
    openTasks: number;
    overdueTasks: number;
  };
}

/** The desk's "Needs action" queues (spec §4.4), each a count plus who. */
export const PEOPLE_DESK_QUEUE = {
  noLogin: 'no_login',
  locked: 'locked',
  temporaryPassword: 'temporary_password',
  articlesCompleting: 'articles_completing',
  exitPassedLoginOn: 'exit_passed_login_on',
  noHoursYesterday: 'no_hours_yesterday',
} as const;
export type PeopleDeskQueue = (typeof PEOPLE_DESK_QUEUE)[keyof typeof PEOPLE_DESK_QUEUE];

/** A temporary password older than this is flagged. */
export const TEMPORARY_PASSWORD_STALE_DAYS = 3;
/** Articleships completing within this many days are flagged. */
export const ARTICLES_COMPLETING_DAYS = 90;

export interface PeopleDeskPerson {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  officeCode: string;
  gradeName: string;
  /** Why they're in the queue, in words ("Locked", "Temporary since 12 Oct", "Completes 3 Jan"). */
  detail: string | null;
}

export interface PeopleDeskQueueItem {
  key: PeopleDeskQueue;
  count: number;
  people: PeopleDeskPerson[];
}

export interface PeopleDesk {
  /** Today in IST, YYYY-MM-DD. */
  today: string;
  headcount: number;
  articles: number;
  joinedThisMonth: number;
  onNotice: number;
  onLeave: number;
  queues: PeopleDeskQueueItem[];
  /** Headcount by office, then grade (not exited). */
  byOffice: Array<{ officeCode: string; byGrade: Array<{ gradeSlug: GradeSlug; count: number }> }>;
  /** Counts of over/under-loaded people this week; `available` false for the administrator. */
  workload: { available: boolean; over: number; under: number; weekStart: string };
}

/** HR may set a date of exit; the login goes off on that day (spec §4.2). */
export interface StartExitInput {
  dateOfExit: string;
  /** Why, kept on the audit entry only. */
  reason?: string;
  version?: number;
}

export interface StartExitResult {
  employeeId: string;
  dateOfExit: string;
  employmentStatus: EmploymentStatus;
  /** True when the date is today or past and the login was switched off now. */
  loginTurnedOff: boolean;
  /** Who was asked to reassign the person's work (names only). */
  reassignAskedOf: string[];
}

/** The monthly hours export (people reports): one row per person. */
export interface MonthlyHoursRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  officeCode: string;
  gradeName: string;
  daysWithTime: number;
  totalSeconds: number;
  workSeconds: number;
  reviewSeconds: number;
  otherSeconds: number;
}

export interface MonthlyHoursReport {
  /** YYYY-MM. */
  month: string;
  rows: MonthlyHoursRow[];
}

// ── Articleship register (spec §4.7) ────────────────────────────────────────

export const ARTICLESHIP_STATUS = {
  active: 'active',
  completed: 'completed',
  transferredOut: 'transferred_out',
  terminated: 'terminated',
} as const;
export type ArticleshipStatus = (typeof ARTICLESHIP_STATUS)[keyof typeof ARTICLESHIP_STATUS];
export const ARTICLESHIP_STATUSES: ArticleshipStatus[] = Object.values(ARTICLESHIP_STATUS);
/** How an articleship can end. */
export const ARTICLESHIP_END_STATUSES = ARTICLESHIP_STATUSES.filter(
  (s) => s !== ARTICLESHIP_STATUS.active,
) as Exclude<ArticleshipStatus, 'active'>[];

export const ARTICLESHIP_LEAVE_KIND = {
  leave: 'leave',
  exam: 'exam',
  sick: 'sick',
  other: 'other',
} as const;
export type ArticleshipLeaveKind =
  (typeof ARTICLESHIP_LEAVE_KIND)[keyof typeof ARTICLESHIP_LEAVE_KIND];
export const ARTICLESHIP_LEAVE_KINDS: ArticleshipLeaveKind[] = Object.values(ARTICLESHIP_LEAVE_KIND);

/** The firm's settings for one ICAI training scheme. */
export interface ArticleshipScheme {
  code: string;
  label: string;
  periodMonths: number;
  /** Leave allowed over the whole period; null until the firm enters it. */
  leaveEntitlementDays: number | null;
  isActive: boolean;
}

export interface ArticleshipLeave {
  id: string;
  fromDate: string;
  toDate: string;
  days: number;
  kind: ArticleshipLeaveKind;
  note: string | null;
  createdAt: string;
}

export interface Articleship {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  officeCode: string;
  principalEmployeeId: string;
  principalName: string;
  /** The principal's ICAI membership number (from their partner profile). */
  principalMembershipNo: string | null;
  schemeCode: string;
  schemeLabel: string;
  icaiRegistrationNo: string | null;
  icaiRegistrationDate: string | null;
  startDate: string;
  expectedCompletion: string;
  /** This article's own allowance, or the scheme's; null when neither is set. */
  leaveEntitlementDays: number | null;
  /** True when the allowance is this article's own, not the scheme's. */
  leaveEntitlementOverridden: boolean;
  leaveTakenDays: number;
  transferredFrom: string | null;
  status: ArticleshipStatus;
  endedOn: string | null;
  endNote: string | null;
  version: number;
}

export interface ArticleshipDetail extends Articleship {
  leaves: ArticleshipLeave[];
}

/** PUT /people/employees/:id/articleship — create, or edit the active one. */
export interface SaveArticleshipInput {
  principalEmployeeId: string;
  schemeCode: string;
  icaiRegistrationNo?: string | null;
  icaiRegistrationDate?: string | null;
  startDate: string;
  /** Defaults to the start date plus the scheme's period. */
  expectedCompletion?: string;
  leaveEntitlementDays?: number | null;
  transferredFrom?: string | null;
  version?: number;
}

export interface AddArticleshipLeaveInput {
  fromDate: string;
  toDate: string;
  days: number;
  kind: ArticleshipLeaveKind;
  note?: string;
}

export interface EndArticleshipInput {
  status: Exclude<ArticleshipStatus, 'active'>;
  endedOn: string;
  note?: string;
  version?: number;
}

export interface UpdateArticleshipSchemeInput {
  label?: string;
  periodMonths?: number;
  leaveEntitlementDays?: number | null;
  isActive?: boolean;
}

// ── HR documents vault (spec §4.7) ──────────────────────────────────────────

export const HR_DOCUMENT_KIND = {
  offerLetter: 'offer_letter',
  appointmentLetter: 'appointment_letter',
  articleshipDeed: 'articleship_deed',
  nda: 'nda',
  idProof: 'id_proof',
  taxProof: 'tax_proof',
  other: 'other',
} as const;
export type HrDocumentKind = (typeof HR_DOCUMENT_KIND)[keyof typeof HR_DOCUMENT_KIND];
export const HR_DOCUMENT_KINDS: HrDocumentKind[] = Object.values(HR_DOCUMENT_KIND);
export const HR_DOCUMENT_KIND_LABEL: Record<HrDocumentKind, string> = {
  offer_letter: 'Offer letter',
  appointment_letter: 'Appointment letter',
  articleship_deed: 'Articleship deed',
  nda: 'NDA / confidentiality undertaking',
  id_proof: 'ID proof',
  tax_proof: 'Tax-declaration proof',
  other: 'Other',
};

/** A file in the HR vault. HR and the Managing Partner only. */
export interface HrDocument {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  kind: HrDocumentKind;
  title: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  note: string | null;
  uploadedByName: string | null;
  createdAt: string;
  archivedAt: string | null;
}

/** POST /people/employees/:id/documents */
export interface UploadHrDocumentInput {
  kind: HrDocumentKind;
  title: string;
  filename: string;
  contentType?: string;
  contentBase64: string;
  note?: string;
}

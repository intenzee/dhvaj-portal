/**
 * Attendance from the work people log.
 *
 * Each person logs their day — client, engagement / stream, task, hours, and
 * where they worked (office, home, the client's office). The time a task's
 * clock records is on the day already; the log adds what is missing. When a
 * day's hours reach the firm's full day (8h by default) it is Present, half of
 * that is a Half day, less is Absent once the day is over. Approved leave and
 * the firm's holidays fill the rest; Sunday is the weekly off, Saturday works.
 *
 *   GET    /attendance/day/:day                 your day: rows, hours, status
 *   POST   /attendance/day/:day/work            log client work (engagement, stream, task)
 *   POST   /attendance/day/:day/internal        log firm work (training, admin, internal meetings…)
 *   POST   /attendance/day/:day/location        "I worked from …" for the day's unset rows
 *   PATCH  /attendance/entries/:id              change a row (hours, where, note)
 *   DELETE /attendance/entries/:id              take a logged row out
 *   GET    /attendance/pick/engagements?q=      the engagements you can log on
 *   GET    /attendance/pick/tasks?engagementId= the tasks on one of them
 *   GET    /attendance/month/:month             your month, day by day
 *   GET    /attendance/team/:month              your team's month (partners, managers, seniors)
 *   GET    /attendance/people/:id/day/:day      one of your team's days
 *   GET    /attendance/register/:month          everyone's month (HR, Managing Partner)
 *   GET    /attendance/register/:month/export   the same as a CSV for payroll
 *   GET    /attendance/leave                    your leave: balances and requests
 *   POST   /attendance/leave                    apply for leave
 *   POST   /attendance/leave/:id/cancel         withdraw a request
 *   GET    /attendance/leave/approvals          requests waiting for you
 *   POST   /attendance/leave/:id/decide         approve or reject
 *   GET    /attendance/holidays?year=           the firm's holidays
 *   POST   /attendance/holidays                 add one (HR, Managing Partner)
 *   DELETE /attendance/holidays/:id             take one off the list
 *   GET    /attendance/settings                 full day, half day, leave a year
 *   PUT    /attendance/settings                 change them (HR, Managing Partner)
 */
import type { OtherTimeCategory } from './time-auto';

export const WORK_LOCATION = {
  office: 'office',
  home: 'home',
  clientOffice: 'client_office',
} as const;
export type WorkLocation = (typeof WORK_LOCATION)[keyof typeof WORK_LOCATION];
export const WORK_LOCATIONS: WorkLocation[] = Object.values(WORK_LOCATION);
export const WORK_LOCATION_LABEL: Record<WorkLocation, string> = {
  office: 'Office',
  home: 'Home',
  client_office: 'Client’s office',
};

export const ATTENDANCE_STATUS = {
  present: 'present',
  halfDay: 'half_day',
  absent: 'absent',
  leave: 'leave',
  holiday: 'holiday',
  weeklyOff: 'weekly_off',
  /** Today, not yet a full day. */
  open: 'open',
  /** A day still to come. */
  upcoming: 'upcoming',
  /** Before they joined or after they left. */
  none: 'none',
} as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  half_day: 'Half day',
  absent: 'Absent',
  leave: 'Leave',
  holiday: 'Holiday',
  weekly_off: 'Weekly off',
  open: 'In progress',
  upcoming: 'Upcoming',
  none: 'Not on the rolls',
};
/** One letter for the month grid. */
export const ATTENDANCE_STATUS_CODE: Record<AttendanceStatus, string> = {
  present: 'P',
  half_day: 'H',
  absent: 'A',
  leave: 'L',
  holiday: 'HO',
  weekly_off: 'WO',
  open: '·',
  upcoming: 'Upcoming',
  none: '–',
};

export const LEAVE_TYPE = {
  casual: 'casual',
  sick: 'sick',
  earned: 'earned',
  unpaid: 'unpaid',
} as const;
export type LeaveType = (typeof LEAVE_TYPE)[keyof typeof LEAVE_TYPE];
export const LEAVE_TYPES: LeaveType[] = Object.values(LEAVE_TYPE);
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  casual: 'Casual leave',
  sick: 'Sick leave',
  earned: 'Earned leave',
  unpaid: 'Leave without pay',
};

/** Half-day leave: the morning or the afternoon. */
export const LEAVE_HALF = { first: 'first_half', second: 'second_half' } as const;
export type LeaveHalf = (typeof LEAVE_HALF)[keyof typeof LEAVE_HALF];
export const LEAVE_HALVES: LeaveHalf[] = Object.values(LEAVE_HALF);
export const LEAVE_HALF_LABEL: Record<LeaveHalf, string> = {
  first_half: 'First half',
  second_half: 'Second half',
};

export const LEAVE_STATUS = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
} as const;
export type LeaveStatus = (typeof LEAVE_STATUS)[keyof typeof LEAVE_STATUS];
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
};

/** Firm work that is not for a client (it counts toward the day). */
export const INTERNAL_WORK_CATEGORIES: OtherTimeCategory[] = [
  'internal_meeting',
  'training',
  'admin',
  'travel',
  'other',
];

export interface AttendanceSettings {
  /** A day at or over this is Present. */
  presentMinutes: number;
  /** A day at or over this (and under a full day) is a Half day. */
  halfDayMinutes: number;
  /** Days of each kind of leave a calendar year; null = no limit. */
  allowances: Record<LeaveType, number | null>;
}

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  presentMinutes: 480,
  halfDayMinutes: 240,
  allowances: { casual: 12, sick: 6, earned: 15, unpaid: null },
};

/** Logged rows can be added, changed or taken out for today and this many days back. */
export const ATTENDANCE_EDIT_DAYS = 3;
/** One row is at most 12 hours. */
export const ATTENDANCE_ROW_MAX_MINUTES = 720;
/** A day holds at most 16 hours. */
export const ATTENDANCE_DAY_MAX_MINUTES = 960;

// ── Rows of a day ─────────────────────────────────────────────────────────

export const DAY_ENTRY_SOURCE = {
  /** A task's clock (In progress / reviewing). */
  taskClock: 'task_clock',
  /** Logged by hand on the engagement ("Add other time", or My day). */
  logged: 'logged',
  /** Firm work, not for a client. */
  internal: 'internal',
} as const;
export type DayEntrySource = (typeof DAY_ENTRY_SOURCE)[keyof typeof DAY_ENTRY_SOURCE];

export interface DayEntry {
  id: string;
  source: DayEntrySource;
  engagementId: string | null;
  engagementCode: string | null;
  clientName: string | null;
  streamName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  /** "Other time" / firm work category. */
  category: OtherTimeCategory | null;
  note: string | null;
  seconds: number;
  location: WorkLocation | null;
  /** The task's clock is running now. */
  running: boolean;
  /** Hours, place and note can be changed here (logged rows inside the window). */
  editable: boolean;
  /** Only where it was worked can be changed (a task clock's row). */
  locationOnly: boolean;
  /** Billed to the client already — it cannot change. */
  billed: boolean;
  startedAt: string;
}

export interface DayLeave {
  id: string;
  type: LeaveType;
  half: LeaveHalf | null;
  status: LeaveStatus;
}

export interface DayAttendance {
  /** YYYY-MM-DD (IST). */
  day: string;
  status: AttendanceStatus;
  workedSeconds: number;
  /** Hours by where they were worked; `unset` for rows nobody placed. */
  byLocation: Partial<Record<WorkLocation | 'unset', number>>;
  /** Approved leave on the day. */
  leave: DayLeave | null;
  holidayName: string | null;
}

export interface MyDay extends DayAttendance {
  presentSeconds: number;
  halfDaySeconds: number;
  /** Rows can be added and changed (today and the last few days). */
  editable: boolean;
  entries: DayEntry[];
  /** Pending leave on the day, if any. */
  pendingLeave: DayLeave | null;
  /** Someone else's day: client time you cannot see, summed. */
  hiddenSeconds?: number;
  employeeName?: string;
}

export interface LogWorkInput {
  engagementId: string;
  engagementServiceId?: string;
  taskId?: string;
  minutes: number;
  location: WorkLocation;
  note?: string;
}

export interface LogInternalInput {
  category: OtherTimeCategory;
  minutes: number;
  location: WorkLocation;
  note?: string;
}

export interface UpdateDayEntryInput {
  minutes?: number;
  location?: WorkLocation;
  note?: string | null;
}

export interface PickEngagement {
  engagementId: string;
  engagementCode: string;
  clientName: string;
  title: string;
  streams: { id: string; name: string }[];
}

export interface PickTask {
  id: string;
  title: string;
  engagementServiceId: string | null;
  /** The task of a filing (its hours show on the filing). */
  filing: boolean;
  mine: boolean;
}

// ── Months ────────────────────────────────────────────────────────────────

export interface AttendanceSummary {
  present: number;
  halfDays: number;
  absent: number;
  /** Leave days by type (a half day counts 0.5). */
  leave: Partial<Record<LeaveType, number>>;
  holidays: number;
  weeklyOffs: number;
  workedSeconds: number;
  byLocation: Partial<Record<WorkLocation | 'unset', number>>;
  /** Days to pay: present, half days as ½, paid leave, holidays and weekly offs. */
  payableDays: number;
}

export interface AttendancePerson {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  officeCode: string | null;
  gradeName: string | null;
  days: DayAttendance[];
  summary: AttendanceSummary;
}

export interface AttendanceMonth {
  /** YYYY-MM. */
  month: string;
  person: AttendancePerson;
  settings: Pick<AttendanceSettings, 'presentMinutes' | 'halfDayMinutes'>;
}

export interface AttendanceRegister {
  month: string;
  people: AttendancePerson[];
  holidays: Holiday[];
}

// ── Leave and holidays ────────────────────────────────────────────────────

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  type: LeaveType;
  fromDay: string;
  toDay: string;
  half: LeaveHalf | null;
  /** Working days it takes (Sundays and holidays left out; a half day is 0.5). */
  days: number;
  reason: string;
  status: LeaveStatus;
  approverName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  /** You can approve or reject it. */
  canDecide: boolean;
}

export interface LeaveBalance {
  type: LeaveType;
  /** Days a year; null = no limit. */
  allowance: number | null;
  taken: number;
  pending: number;
  /** null when there is no limit. */
  left: number | null;
}

export interface MyLeave {
  year: number;
  balances: LeaveBalance[];
  requests: LeaveRequest[];
  /** Who approves your leave. */
  approverName: string | null;
}

/** GET /attendance/leave/approvals — waiting for you, and what was decided lately. */
export interface LeaveApprovals {
  pending: LeaveRequest[];
  /** Decided in the last 60 days (yours to see: your team, or the firm for HR). */
  recent: LeaveRequest[];
}
export interface ApplyLeaveInput {
  type: LeaveType;
  fromDay: string;
  toDay: string;
  half?: LeaveHalf;
  reason: string;
}

export interface DecideLeaveInput {
  approve: boolean;
  note?: string;
}

export interface Holiday {
  id: string;
  day: string;
  name: string;
}

export interface AddHolidayInput {
  day: string;
  name: string;
}

// ── Pure helpers (tested) ─────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Sunday is the weekly off; Saturday is a working day. */
export function isWeeklyOff(day: string): boolean {
  return weekdayOf(day) === 0;
}

/** The days from one date to another, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** The first and last day of a YYYY-MM. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Working days a leave takes: Sundays and holidays are not counted; a half day is 0.5. */
export function leaveDayCount(
  from: string,
  to: string,
  half: LeaveHalf | null | undefined,
  holidays: ReadonlySet<string> = new Set(),
): number {
  if (to < from) return 0;
  const working = daysBetween(from, to).filter((d) => !isWeeklyOff(d) && !holidays.has(d)).length;
  return half ? Math.min(working, 1) * 0.5 : working;
}

export interface StatusInput {
  day: string;
  /** Today, IST. */
  today: string;
  workedSeconds: number;
  /** Approved leave on the day. */
  leave: { half: LeaveHalf | null } | null;
  holiday: boolean;
  /** Before joining / after leaving. */
  employed?: boolean;
  presentMinutes: number;
  halfDayMinutes: number;
}

/**
 * The day's status. A half-day leave counts as half a full day of work, so
 * half a day's leave and half a day's work make a Present.
 */
export function attendanceStatus(i: StatusInput): AttendanceStatus {
  if (i.employed === false) return 'none';
  const full = i.presentMinutes * 60;
  const half = i.halfDayMinutes * 60;
  if (i.holiday) return 'holiday';
  if (isWeeklyOff(i.day)) return 'weekly_off';
  if (i.leave && !i.leave.half) return 'leave';
  const credit = i.workedSeconds + (i.leave ? full / 2 : 0);
  if (credit >= full) return 'present';
  if (i.day > i.today) return i.leave ? 'leave' : 'upcoming';
  if (i.day === i.today) return 'open';
  if (credit >= half) return 'half_day';
  return 'absent';
}

/** A month's days, counted. Pure — tested. */
export function summarise(
  days: readonly DayAttendance[],
  paidLeave: (t: LeaveType) => boolean = (t) => t !== 'unpaid',
): AttendanceSummary {
  const s: AttendanceSummary = {
    present: 0,
    halfDays: 0,
    absent: 0,
    leave: {},
    holidays: 0,
    weeklyOffs: 0,
    workedSeconds: 0,
    byLocation: {},
    payableDays: 0,
  };
  for (const d of days) {
    s.workedSeconds += d.workedSeconds;
    for (const [k, v] of Object.entries(d.byLocation) as [WorkLocation | 'unset', number][]) {
      s.byLocation[k] = (s.byLocation[k] ?? 0) + v;
    }
    const leaveDays = d.leave ? (d.leave.half ? 0.5 : 1) : 0;
    if (d.leave && (d.status === 'leave' || d.leave.half)) {
      s.leave[d.leave.type] = (s.leave[d.leave.type] ?? 0) + leaveDays;
    }
    const paid = d.leave && paidLeave(d.leave.type) ? leaveDays : 0;
    switch (d.status) {
      case 'present':
        s.present += 1;
        // Half a day's leave and half a day's work: the leave half is paid only if paid leave.
        s.payableDays += d.leave?.half ? 0.5 + paid : 1;
        break;
      case 'half_day':
        s.halfDays += 1;
        // With half a day's leave, the half that is paid is the leave half.
        s.payableDays += d.leave?.half ? paid : 0.5;
        break;
      case 'absent':
        s.absent += 1;
        break;
      case 'leave':
        s.payableDays += paid;
        break;
      case 'holiday':
        s.holidays += 1;
        s.payableDays += 1;
        break;
      case 'weekly_off':
        s.weeklyOffs += 1;
        s.payableDays += 1;
        break;
      default:
        break;
    }
  }
  return s;
}

/**
 * Hours typed in a box: "2", "1.5", "1:30", "1h 30m", "90m", "45 min". Minutes,
 * or null when it does not read as a duration. Pure — tested.
 */
export function parseHoursInput(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?) ?(?:h|hr|hrs|hour|hours)?$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d+) ?(?:m|min|mins|minutes?)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?) ?(?:h|hr|hrs|hours?) ?(\d+) ?(?:m|min|mins|minutes?)?$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60) + Number(m[2]);
  return null;
}

/** "2h 30m", "45m", "8h", "0m". */
export function formatWorked(seconds: number): string {
  const mins = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

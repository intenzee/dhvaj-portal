import {
  ATTENDANCE_EDIT_DAYS,
  attendanceStatus,
  daysBetween,
  type DayAttendance,
  type DayLeave,
  type LeaveHalf,
  type LeaveStatus,
  type LeaveType,
  type WorkLocation,
} from '@hsdg/contracts';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Seconds of one person's day in one place (hsdg.attendance_hours). */
export interface HoursRow {
  employee_id: string;
  day: string;
  work_location: WorkLocation | null;
  seconds: number;
}

export interface LeaveRow {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  from_day: string;
  to_day: string;
  half: LeaveHalf | null;
  status: LeaveStatus;
}

export interface Employment {
  joined: string;
  exited: string | null;
}

/** Today in IST, YYYY-MM-DD. */
export function istDay(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Days from `day` back to today (0 = today; negative = a day to come). */
export function daysBack(day: string, now: Date = new Date()): number {
  return Math.round((Date.parse(istDay(now)) - Date.parse(day)) / DAY_MS);
}

/** Rows of this day can still be added or changed. */
export function inEditWindow(day: string, now: Date = new Date()): boolean {
  const back = daysBack(day, now);
  return back >= 0 && back <= ATTENDANCE_EDIT_DAYS;
}

/**
 * Where a logged row sits on its day. The day is read from where it starts,
 * so it always starts on the day: at 9 am, or earlier today when the hours
 * would not have fitted by now. Pure — tested.
 */
export function loggedWindow(
  day: string,
  minutes: number,
  now: Date = new Date(),
): { startedAt: Date; endedAt: Date } {
  const dayStart = Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS;
  let start = dayStart + 9 * 3_600_000;
  if (day === istDay(now)) {
    start = Math.max(dayStart + 60_000, Math.min(start, now.getTime() - minutes * 60_000));
  }
  return { startedAt: new Date(start), endedAt: new Date(start + minutes * 60_000) };
}

/** The approved leave on a day (pending leave is shown, never counted). */
export function leaveOn(
  day: string,
  leaves: readonly LeaveRow[],
  status: LeaveStatus,
): DayLeave | null {
  const l = leaves.find((x) => x.status === status && x.from_day <= day && x.to_day >= day);
  return l ? { id: l.id, type: l.leave_type, half: l.half, status: l.status } : null;
}

/**
 * One person's days from `from` to `to`: hours by place, leave, holidays and
 * the status each comes to. Pure — tested.
 */
export function buildDays(input: {
  from: string;
  to: string;
  today: string;
  hours: readonly HoursRow[];
  leaves: readonly LeaveRow[];
  holidays: ReadonlyMap<string, string>;
  employment: Employment;
  presentMinutes: number;
  halfDayMinutes: number;
}): DayAttendance[] {
  const byDay = new Map<string, HoursRow[]>();
  for (const h of input.hours) {
    const list = byDay.get(h.day) ?? [];
    list.push(h);
    byDay.set(h.day, list);
  }
  return daysBetween(input.from, input.to).map((day) => {
    const rows = byDay.get(day) ?? [];
    const byLocation: DayAttendance['byLocation'] = {};
    let worked = 0;
    for (const r of rows) {
      const key = r.work_location ?? 'unset';
      byLocation[key] = (byLocation[key] ?? 0) + Number(r.seconds);
      worked += Number(r.seconds);
    }
    const leave = leaveOn(day, input.leaves, 'approved');
    const holidayName = input.holidays.get(day) ?? null;
    const employed =
      day >= input.employment.joined &&
      (!input.employment.exited || day <= input.employment.exited);
    return {
      day,
      status: attendanceStatus({
        day,
        today: input.today,
        workedSeconds: worked,
        leave,
        holiday: !!holidayName,
        employed,
        presentMinutes: input.presentMinutes,
        halfDayMinutes: input.halfDayMinutes,
      }),
      workedSeconds: worked,
      byLocation,
      leave,
      holidayName,
    };
  });
}

/** A month's export: one row a person, one column a day, then the totals. Pure — tested. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

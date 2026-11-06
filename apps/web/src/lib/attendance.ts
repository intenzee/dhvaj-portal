import {
  ATTENDANCE_EDIT_DAYS,
  type AttendanceStatus,
  type DayEntry,
  type WorkLocation,
} from '@hsdg/contracts';
import { addDays, istToday } from './people';

/** The badge tone of each status. */
export const STATUS_TONE: Record<AttendanceStatus, string> = {
  present: 'success',
  half_day: 'warn',
  absent: 'danger',
  leave: 'info',
  holiday: 'neutral',
  weekly_off: 'neutral',
  open: 'info',
  upcoming: 'neutral',
  none: 'neutral',
};

/** The month grid's cell colour of each status. */
export const STATUS_CELL: Record<AttendanceStatus, string> = {
  present: 'bg-success-50 text-success-700',
  half_day: 'bg-warning-50 text-warning-700',
  absent: 'bg-danger-50 text-danger-700',
  leave: 'bg-primary-50 text-primary-700',
  holiday: 'bg-surface-sunken text-ink-muted',
  weekly_off: 'bg-surface-sunken text-ink-faint',
  open: 'bg-primary-50/60 text-primary-700',
  upcoming: 'text-ink-faint',
  none: 'text-ink-faint',
};

/** YYYY-MM of today (IST). */
export function thisMonth(): string {
  return istToday().slice(0, 7);
}

/** The month before or after. Pure — tested. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** "November 2026". */
export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Fri 6 Nov". */
export function dayLabel(day: string, withYear = false): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** Today and the days that can still be logged, newest first. */
export function loggableDays(today = istToday()): string[] {
  return Array.from({ length: ATTENDANCE_EDIT_DAYS + 1 }, (_, i) => addDays(today, -i));
}

/** What a row is about, in one line: "Drift Logistics · GST · GSTR-3B Oct". Pure — tested. */
export function entryTitle(e: DayEntry, categoryLabel: (c: string) => string): string {
  if (e.source === 'internal') return `Firm work · ${categoryLabel(e.category ?? 'other')}`;
  return [
    e.clientName,
    e.streamName,
    e.taskTitle ?? (e.category ? categoryLabel(e.category) : null),
  ]
    .filter(Boolean)
    .join(' · ');
}

export const LOCATION_ORDER: WorkLocation[] = ['office', 'home', 'client_office'];

/** Minutes to "2h 30m" for an input's echo. */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Firm work and other-time categories, as people say them. */
export const CATEGORY_LABEL: Record<string, string> = {
  client_call: 'Client call',
  client_meeting: 'Client meeting',
  internal_meeting: 'Internal meeting',
  travel: 'Travel',
  training: 'Training',
  admin: 'Admin',
  other: 'Other',
};
export const categoryLabel = (c: string): string => CATEGORY_LABEL[c] ?? c;

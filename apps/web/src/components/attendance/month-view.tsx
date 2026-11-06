'use client';

import {
  ATTENDANCE_STATUS_CODE,
  ATTENDANCE_STATUS_LABEL,
  LEAVE_TYPES,
  LEAVE_TYPE_LABEL,
  WORK_LOCATION_LABEL,
  formatWorked,
  weekdayOf,
  type AttendancePerson,
  type AttendanceSummary,
  type DayAttendance,
} from '@hsdg/contracts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { LOCATION_ORDER, STATUS_CELL, monthLabel, shiftMonth, thisMonth } from '@/lib/attendance';
import { Button } from '@/components/ui';

/** ← November 2026 → */
export function MonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (m: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="secondary"
        aria-label="The month before"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-36 text-center text-sm font-semibold text-ink">
        {monthLabel(month)}
      </span>
      <Button
        size="sm"
        variant="secondary"
        aria-label="The month after"
        disabled={month >= thisMonth()}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Present 18 · Half days 2 · … · Payable 26 · 162h. */
export function SummaryChips({ s }: { s: AttendanceSummary }): JSX.Element {
  const chip = (label: string, value: string | number, tone?: string) => (
    <div key={label} className={cn('rounded-lg border border-line px-3 py-2', tone)}>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
  const leave = LEAVE_TYPES.filter((t) => s.leave[t]);
  return (
    <div className="flex flex-wrap gap-2">
      {chip('Present', s.present)}
      {chip('Half days', s.halfDays)}
      {chip('Absent', s.absent)}
      {leave.map((t) => chip(LEAVE_TYPE_LABEL[t], s.leave[t]!))}
      {chip('Holidays', s.holidays)}
      {chip('Sundays', s.weeklyOffs)}
      {chip('Payable days', s.payableDays, 'bg-surface-raised')}
      {chip('Hours', formatWorked(s.workedSeconds))}
      {LOCATION_ORDER.filter((l) => s.byLocation[l]).map((l) =>
        chip(WORK_LOCATION_LABEL[l], formatWorked(s.byLocation[l]!)),
      )}
    </div>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** One person's month as a calendar: status and hours a day. */
export function MonthCalendar({
  days,
  onPick,
  canPick,
}: {
  days: DayAttendance[];
  onPick?: (day: string) => void;
  canPick?: (day: string) => boolean;
}): JSX.Element {
  // Monday-first: blanks before the 1st.
  const lead = days[0] ? (weekdayOf(days[0].day) + 6) % 7 : 0;
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-ink-muted">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`b${i}`} />
        ))}
        {days.map((d) => {
          const pickable = !!onPick && (canPick?.(d.day) ?? true);
          const title = [
            ATTENDANCE_STATUS_LABEL[d.status],
            d.workedSeconds ? formatWorked(d.workedSeconds) : null,
            d.holidayName,
            d.leave ? `${LEAVE_TYPE_LABEL[d.leave.type]}${d.leave.half ? ' (half)' : ''}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <button
              key={d.day}
              type="button"
              disabled={!pickable}
              title={title}
              aria-label={`${d.day}: ${title}`}
              onClick={() => onPick?.(d.day)}
              className={cn(
                'flex min-h-16 flex-col rounded-lg border border-line p-1.5 text-left transition',
                STATUS_CELL[d.status],
                pickable && 'hover:border-primary-400 hover:shadow-card',
              )}
            >
              <span className="text-xs font-semibold">{Number(d.day.slice(8))}</span>
              <span className="mt-auto text-[11px] font-semibold">
                {ATTENDANCE_STATUS_CODE[d.status]}
              </span>
              {d.workedSeconds > 0 && (
                <span className="text-[11px] tabular-nums">{formatWorked(d.workedSeconds)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** People down, days across: the team's or the firm's month. */
export function MonthGrid({
  people,
  onPick,
}: {
  people: AttendancePerson[];
  onPick?: (person: AttendancePerson, day: string) => void;
}): JSX.Element {
  const days = people[0]?.days.map((d) => d.day) ?? [];
  return (
    <div className="overflow-x-auto rounded-xl border border-line-strong bg-surface">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-line bg-surface-raised text-ink-muted">
            <th className="sticky left-0 z-10 bg-surface-raised px-3 py-2 text-left font-medium">
              Person
            </th>
            {days.map((d) => (
              <th
                key={d}
                className={cn(
                  'px-0.5 py-2 text-center font-medium',
                  weekdayOf(d) === 0 && 'text-ink-faint',
                )}
              >
                {Number(d.slice(8))}
              </th>
            ))}
            <th className="px-2 py-2 text-right font-medium">P</th>
            <th className="px-2 py-2 text-right font-medium">H</th>
            <th className="px-2 py-2 text-right font-medium">A</th>
            <th className="px-2 py-2 text-right font-medium">L</th>
            <th className="px-2 py-2 text-right font-medium">Payable</th>
            <th className="px-3 py-2 text-right font-medium">Hours</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {people.map((p) => {
            const leave = Object.values(p.summary.leave).reduce((a, b) => a + (b ?? 0), 0);
            return (
              <tr key={p.employeeId}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5">
                  <span className="font-medium text-ink">{p.employeeName}</span>
                  <span className="ml-1 text-ink-faint">{p.employeeCode}</span>
                </td>
                {p.days.map((d) => (
                  <td key={d.day} className="px-0.5 py-1">
                    <button
                      type="button"
                      disabled={!onPick || d.status === 'none' || d.status === 'upcoming'}
                      onClick={() => onPick?.(p, d.day)}
                      title={`${p.employeeName}, ${d.day}: ${ATTENDANCE_STATUS_LABEL[d.status]}${d.workedSeconds ? ` · ${formatWorked(d.workedSeconds)}` : ''}`}
                      className={cn(
                        'h-7 w-7 rounded text-[10px] font-semibold',
                        STATUS_CELL[d.status],
                        onPick && 'hover:ring-2 hover:ring-primary-400',
                      )}
                    >
                      {ATTENDANCE_STATUS_CODE[d.status]}
                    </button>
                  </td>
                ))}
                <td className="px-2 text-right tabular-nums">{p.summary.present}</td>
                <td className="px-2 text-right tabular-nums">{p.summary.halfDays}</td>
                <td className="px-2 text-right tabular-nums">{p.summary.absent}</td>
                <td className="px-2 text-right tabular-nums">{leave}</td>
                <td className="px-2 text-right font-semibold tabular-nums">
                  {p.summary.payableDays}
                </td>
                <td className="whitespace-nowrap px-3 text-right tabular-nums">
                  {formatWorked(p.summary.workedSeconds)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What the letters mean. */
export function StatusKey(): JSX.Element {
  const shown = [
    'present',
    'half_day',
    'absent',
    'leave',
    'holiday',
    'weekly_off',
    'open',
  ] as const;
  return (
    <div className="flex flex-wrap gap-2 text-xs text-ink-muted">
      {shown.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={cn('rounded px-1.5 py-0.5 font-semibold', STATUS_CELL[s])}>
            {ATTENDANCE_STATUS_CODE[s]}
          </span>
          {ATTENDANCE_STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

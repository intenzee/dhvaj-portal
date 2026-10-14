'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ArrowRight, Minus } from 'lucide-react';
import {
  FEATURE_FLAG,
  STREAM_SECTIONS,
  WORK_SECTION_LABEL,
  workSectionsParam,
  type ComplianceCalendarResponse,
  type ComplianceCalendarRow,
  type WorkSection,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { openComplianceQuery } from '@/lib/queries';
import { useFeatureFlags } from '@/lib/feature-flags';
import { Card, Spinner } from '@/components/ui';
import { SectionSelect, useStoredSections } from '@/components/section-filter';
import { daysLeftLabel, rowHref } from '@/components/compliance/firm-calendar';
import { cn } from '@/lib/cn';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Mark = 'overdue' | 'due' | 'filed';
const MARK_RANK: Record<Mark, number> = { overdue: 3, due: 2, filed: 1 };

const pad = (n: number): string => String(n).padStart(2, '0');

/** First and last day of month `m` (0-based) of year `y`, as yyyy-mm-dd. */
export function monthRange(y: number, m: number): { from: string; to: string } {
  const last = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
}

/** A filing's mark: overdue (open, past due) beats due beats filed / not applicable. */
export function rowMark(r: Pick<ComplianceCalendarRow, 'workflowStatus' | 'daysLeft'>): Mark {
  if (r.workflowStatus === 'filed' || r.workflowStatus === 'not_applicable') return 'filed';
  return r.daysLeft < 0 ? 'overdue' : 'due';
}

/** Day of month → its worst mark, for the rows due in `yyyy-mm`. */
export function dayMarks(rows: readonly ComplianceCalendarRow[], month: string): Map<number, Mark> {
  const map = new Map<number, Mark>();
  for (const r of rows) {
    if (!r.dueDate.startsWith(month)) continue;
    const day = Number(r.dueDate.slice(8, 10));
    const mark = rowMark(r);
    const had = map.get(day);
    if (!had || MARK_RANK[mark] > MARK_RANK[had]) map.set(day, mark);
  }
  return map;
}

/** The firm calendar, opened on this month and section. */
export function calendarLink(sections: readonly WorkSection[], y: number, m: number): string {
  const stream = workSectionsParam(sections);
  return `/compliance?${stream ? `stream=${stream}&` : ''}month=${y}-${pad(m + 1)}`;
}

/**
 * Home "Compliance Calendar" — a month at a glance. With Calendar v2 it reads
 * the firm calendar for the month shown, can be narrowed to one section (GST
 * only, Income Tax only, …; remembered per browser), and a day opens its
 * filings inline under the grid. Without v2 it marks the open obligations.
 */
export function ComplianceMiniCalendar(): JSX.Element {
  const { isOn, isLoading } = useFeatureFlags();
  if (isLoading) {
    return (
      <Card className="p-5">
        <Spinner />
      </Card>
    );
  }
  return isOn(FEATURE_FLAG.calendarV2) ? <SectionCalendar /> : <LegacyCalendar />;
}

function useMonth(): {
  view: { y: number; m: number };
  step: (delta: number) => void;
  isToday: (day: number) => boolean;
} {
  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const step = (delta: number): void =>
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  const isToday = (day: number): boolean =>
    view.y === today.getFullYear() && view.m === today.getMonth() && day === today.getDate();
  return { view, step, isToday };
}

function SectionCalendar(): JSX.Element {
  const { view, step, isToday } = useMonth();
  const [sections, setSections] = useStoredSections('home-calendar', STREAM_SECTIONS);
  const [day, setDay] = useState<number | null>(null);
  const month = `${view.y}-${pad(view.m + 1)}`;
  const range = monthRange(view.y, view.m);
  const stream = workSectionsParam(sections);

  const q = useQuery({
    queryKey: ['compliance', 'calendar-v2', 'home', month, stream],
    queryFn: () =>
      apiFetch<ComplianceCalendarResponse>(
        `/compliance/calendar?from=${range.from}&to=${range.to}&includeOverdue=false${
          stream ? `&stream=${stream}` : ''
        }`,
      ),
  });
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  const marks = useMemo(() => dayMarks(rows, month), [rows, month]);
  const dayRows = day === null ? [] : rows.filter((r) => r.dueDate === `${month}-${pad(day)}`);

  const move = (delta: number): void => {
    setDay(null);
    step(delta);
  };
  const pick = (next: WorkSection[]): void => {
    setDay(null);
    setSections(next);
  };

  return (
    <Card role="region" aria-label="Compliance Calendar" className="flex flex-col">
      <Header href={calendarLink(sections, view.y, view.m)} />
      <div className="border-b border-line px-5 py-2">
        <SectionSelect value={sections} onChange={pick} sections={STREAM_SECTIONS} />
      </div>
      <div className="px-5 py-4">
        <MonthNav view={view} step={move} />
        {q.isLoading ? (
          <Spinner />
        ) : (
          <>
            <Grid
              view={view}
              marks={marks}
              isToday={isToday}
              selected={day}
              onSelect={(d) => setDay((cur) => (cur === d ? null : d))}
            />
            <Legend filed />
            {day !== null && (
              <DayList
                label={`${day} ${MONTHS[view.m]!.slice(0, 3)}`}
                rows={dayRows}
                showStream={sections.length !== 1}
                onClose={() => setDay(null)}
              />
            )}
            {q.data && rows.length === 0 && (
              <p className="mt-3 text-xs text-ink-faint">
                {sections.length === 1
                  ? `No ${WORK_SECTION_LABEL[sections[0]!]} filings due in ${MONTHS[view.m]}.`
                  : `No filings due in ${MONTHS[view.m]}.`}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** The day's filings, opened inline under the grid (never a pop-up). */
function DayList({
  label,
  rows,
  showStream,
  onClose,
}: {
  label: string;
  rows: ComplianceCalendarRow[];
  showStream: boolean;
  onClose: () => void;
}): JSX.Element {
  return (
    <div role="region" aria-label={`Filings due ${label}`} className="mt-3 rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-xs font-semibold text-ink">
          {label} · {rows.length} filing{rows.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close day"
          className="rounded p-0.5 text-ink-muted hover:bg-surface-sunken"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-ink-faint">Nothing due this day.</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto">
          {rows.map((r) => {
            const mark = rowMark(r);
            return (
              <li key={r.id} className="border-b border-line last:border-0">
                <Link href={rowHref(r)} className="block px-3 py-2 hover:bg-surface-raised">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">
                      {r.formLabel ?? r.ruleName}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-[11px] font-semibold',
                        mark === 'overdue' && 'text-danger-600',
                        mark === 'due' && 'text-warning-600',
                        mark === 'filed' && 'text-ink-faint',
                      )}
                    >
                      {daysLeftLabel(r)}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-ink-faint">
                    {showStream && r.stream ? `${WORK_SECTION_LABEL[r.stream]} · ` : ''}
                    {r.entityName} · {r.periodLabel}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LegacyCalendar(): JSX.Element {
  const { view, step, isToday } = useMonth();
  const q = useQuery(openComplianceQuery);

  // Day of month → worst severity that day (overdue beats upcoming).
  const marks = useMemo(() => {
    const map = new Map<number, Mark>();
    for (const r of q.data?.items ?? []) {
      const d = new Date(r.effectiveStatutoryDeadline);
      if (d.getFullYear() !== view.y || d.getMonth() !== view.m) continue;
      const sev: Mark = r.isStatutoryOverdue ? 'overdue' : 'due';
      if (sev === 'overdue' || !map.has(d.getDate())) map.set(d.getDate(), sev);
    }
    return map;
  }, [q.data, view]);

  return (
    <Card role="region" aria-label="Compliance Calendar" className="flex flex-col">
      <Header href="/compliance" />
      <div className="px-5 py-4">
        {q.isLoading ? (
          <Spinner />
        ) : (
          <>
            <MonthNav view={view} step={step} />
            <Grid view={view} marks={marks} isToday={isToday} />
            <Legend />
          </>
        )}
      </div>
    </Card>
  );
}

function Header({ href }: { href: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
      <h3 className="text-[15px] font-semibold text-ink">Compliance Calendar</h3>
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
      >
        View calendar <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function MonthNav({
  view,
  step,
}: {
  view: { y: number; m: number };
  step: (delta: number) => void;
}): JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between">
      <button onClick={() => step(-1)} className="rounded p-1 text-ink-muted hover:bg-surface-sunken" aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="text-sm font-semibold text-ink">
        {MONTHS[view.m]} {view.y}
      </div>
      <button onClick={() => step(1)} className="rounded p-1 text-ink-muted hover:bg-surface-sunken" aria-label="Next month">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function Grid({
  view,
  marks,
  isToday,
  selected = null,
  onSelect,
}: {
  view: { y: number; m: number };
  marks: Map<number, Mark>;
  isToday: (day: number) => boolean;
  selected?: number | null;
  /** When given, every day is a button that opens its filings. */
  onSelect?: (day: number) => void;
}): JSX.Element {
  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  return (
    <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-faint">
      {DOW.map((d) => (
        <div key={d} className="py-1 font-medium">{d}</div>
      ))}
      {cells.map((day, i) => {
        if (day === null) return <div key={`b${i}`} />;
        const sev = marks.get(day);
        const className = cn(
          'flex h-8 items-center justify-center rounded-md text-[13px]',
          sev === 'overdue' && 'bg-danger-500 font-semibold text-white',
          sev === 'due' && 'bg-warning-500 font-semibold text-white',
          sev === 'filed' && 'bg-success-100 font-semibold text-success-700',
          !sev && 'text-ink',
          isToday(day) && !sev && 'ring-1 ring-primary-500 font-semibold text-primary-700',
          isToday(day) && sev && 'ring-2 ring-offset-1 ring-primary-600',
          selected === day && 'outline outline-2 outline-offset-1 outline-ink',
          onSelect && 'cursor-pointer hover:opacity-80',
        );
        return onSelect ? (
          <button
            key={day}
            type="button"
            aria-pressed={selected === day}
            aria-label={`${day} ${MONTHS[view.m]}`}
            onClick={() => onSelect(day)}
            className={className}
          >
            {day}
          </button>
        ) : (
          <div key={day} className={className}>
            {day}
          </div>
        );
      })}
    </div>
  );
}

function Legend({ filed = false }: { filed?: boolean }): JSX.Element {
  return (
    <div className="mt-3 flex items-center gap-4 text-[11px] text-ink-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-danger-500" /> Overdue
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-warning-500" /> Due
      </span>
      {filed && (
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-success-100 ring-1 ring-success-500" /> Filed
        </span>
      )}
    </div>
  );
}

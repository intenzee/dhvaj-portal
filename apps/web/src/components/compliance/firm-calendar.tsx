'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Download, List, Settings2 } from 'lucide-react';
import {
  FILING_STATUSES,
  FILING_STATUS_LABEL,
  PERMISSION,
  STREAMS,
  STREAM_LABEL,
  type ComplianceCalendarResponse,
  type ComplianceCalendarRow,
  type DueBand,
  type FilingStatus,
  type Paginated,
  type Stream,
  FEATURE_FLAG,
  workItemHref,
} from '@hsdg/contracts';
import { apiFetch, downloadFile, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { EmployeeRow, OfficeRow } from '@/lib/types';
import { PageHeader, Card, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { Select, Input } from '@/components/form';
import { EntityPicker, type Picked } from '@/components/entity-picker';
import { cn } from '@/lib/cn';

type View = 'list' | 'month';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** ISO date (yyyy-mm-dd) of a local date. */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** The default window: this month and the next 11 (Oct 2026 → Sep 2027). */
export function defaultWindow(today: Date): { from: string; to: string } {
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 12, 0);
  return { from: iso(from), to: iso(to) };
}
/** Parse yyyy-mm-dd as a local date (no timezone shift). */
function parseIso(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Sheet colours: red ≤ 7 days or overdue, amber ≤ 30, grey filed / passed. */
export const BAND_CLASS: Record<DueBand, string> = {
  red: 'bg-danger-50 text-danger-700 border-danger-200',
  amber: 'bg-warning-50 text-warning-700 border-warning-200',
  grey: 'bg-surface-sunken text-ink-faint border-line',
  none: 'bg-surface text-ink border-line',
};

/** "Overdue 3 days", "Today", "4 days", "Filed". */
export function daysLeftLabel(
  row: Pick<ComplianceCalendarRow, 'daysLeft' | 'workflowStatus'>,
): string {
  if (row.workflowStatus === 'filed') return 'Filed';
  if (row.workflowStatus === 'not_applicable') return 'N/A';
  if (row.daysLeft < 0) return `Overdue ${-row.daysLeft} day${row.daysLeft === -1 ? '' : 's'}`;
  if (row.daysLeft === 0) return 'Today';
  return `${row.daysLeft} day${row.daysLeft === 1 ? '' : 's'}`;
}

/**
 * Where a calendar row opens: with ff_work_links, the filing itself (its year,
 * month or period, and part); before that, the stream tab.
 */
export function rowHref(r: ComplianceCalendarRow, workLinks = false): string {
  if (workLinks && r.link) return workItemHref(r.link);
  return r.stream
    ? `/engagements/${r.engagementId}?tab=${r.stream}`
    : `/engagements/${r.engagementId}`;
}

/** `rowHref` bound to the current ff_work_links flag. */
export function useCalendarHref(): (r: ComplianceCalendarRow) => string {
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.workLinks);
  return useCallback((r: ComplianceCalendarRow) => rowHref(r, on), [on]);
}

/**
 * The firm calendar (spec Change 4 "Calendar views"): every filing due across
 * the caller's Compliance engagements, as a list or a month grid, with the
 * sheet's colours, a "Verify" badge on rules a partner has not confirmed, and
 * an .xlsx export in the source workbook's layout.
 */
export function FirmCalendar({
  initialStreams = [],
  initialMonth = null,
}: {
  /** Streams to start filtered by (the home calendar's "View calendar" link). */
  initialStreams?: Stream[];
  /** A `yyyy-mm` to open the month grid on; the window then starts there. */
  initialMonth?: string | null;
} = {}): JSX.Element {
  const { principal } = useAuth();
  const toast = useToast();
  const initial = useMemo(
    () => defaultWindow(initialMonth ? parseIso(`${initialMonth}-01`) : new Date()),
    [initialMonth],
  );

  const [view, setView] = useState<View>(initialMonth ? 'month' : 'list');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [streams, setStreams] = useState<Stream[]>(initialStreams);
  const [statuses, setStatuses] = useState<FilingStatus[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [officeCode, setOfficeCode] = useState('');
  const [client, setClient] = useState<Picked | null>(null);
  const [mine, setMine] = useState(false);
  const [month, setMonth] = useState(() => initial.from.slice(0, 7));
  const [exporting, setExporting] = useState(false);

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (streams.length) params.set('stream', streams.join(','));
  if (statuses.length) params.set('status', statuses.join(','));
  if (partnerId) params.set('partnerId', partnerId);
  if (managerId) params.set('managerId', managerId);
  if (officeCode) params.set('officeCode', officeCode);
  if (client) params.set('entityId', client.id);
  if (mine) params.set('mine', 'true');
  const qs = params.toString();

  const calendar = useQuery({
    queryKey: ['compliance', 'calendar-v2', qs],
    queryFn: () => apiFetch<ComplianceCalendarResponse>(`/compliance/calendar?${qs}`),
  });
  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
  });
  const offices = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });

  const people = employees.data?.items ?? [];
  const rows = calendar.data?.items ?? [];

  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const exportXlsx = async (): Promise<void> => {
    setExporting(true);
    try {
      await downloadFile(`/compliance/calendar/export?${qs}`, 'compliance-calendar.xlsx');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Export failed.', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Compliance Calendar"
        subtitle="Every filing due across your Compliance engagements. Red is due within 7 days or overdue, amber within 30, grey is filed or passed."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportXlsx} disabled={exporting}>
              <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Export .xlsx'}
            </Button>
            {can(principal, PERMISSION.complianceManage) && (
              <Link href="/compliance/rules">
                <Button variant="secondary">
                  <Settings2 className="h-4 w-4" /> Rules
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <Card className="mb-4 space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-muted">
            From
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-xs text-ink-muted">
            To
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-xs text-ink-muted">
            Partner
            <Select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="mt-1"
            >
              <option value="">All</option>
              {people
                .filter((p) => p.gradeSlug === 'partner')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
            </Select>
          </label>
          <label className="text-xs text-ink-muted">
            Manager
            <Select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="mt-1"
            >
              <option value="">All</option>
              {people
                .filter((p) => p.gradeSlug === 'manager' || p.gradeSlug === 'partner')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
            </Select>
          </label>
          <label className="text-xs text-ink-muted">
            Office
            <Select
              value={officeCode}
              onChange={(e) => setOfficeCode(e.target.value)}
              className="mt-1"
            >
              <option value="">All</option>
              {(offices.data ?? []).map((o) => (
                <option key={o.id} value={o.code}>
                  {o.name}
                </option>
              ))}
            </Select>
          </label>
          <div className="min-w-[14rem] flex-1 text-xs text-ink-muted">
            Client
            <div className="mt-1">
              <EntityPicker
                value={client}
                onChange={setClient}
                exclude={new Set()}
                placeholder="Any client…"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 pb-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary-600"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
            />
            Assigned to me
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-faint">Stream</span>
          {STREAMS.map((s) => (
            <Chip
              key={s}
              active={streams.includes(s)}
              onClick={() => setStreams((l) => toggle(l, s))}
            >
              {STREAM_LABEL[s]}
            </Chip>
          ))}
          <span className="ml-3 text-xs text-ink-faint">Status</span>
          {FILING_STATUSES.map((s) => (
            <Chip
              key={s}
              active={statuses.includes(s)}
              onClick={() => setStatuses((l) => toggle(l, s))}
            >
              {FILING_STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>
      </Card>

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex gap-1" role="tablist" aria-label="Calendar view">
          <Chip active={view === 'list'} onClick={() => setView('list')}>
            <List className="mr-1 inline h-3.5 w-3.5" /> List
          </Chip>
          <Chip active={view === 'month'} onClick={() => setView('month')}>
            <CalendarDays className="mr-1 inline h-3.5 w-3.5" /> Month
          </Chip>
        </div>
        {calendar.data && (
          <span className="text-xs text-ink-faint">
            {calendar.data.total} item{calendar.data.total === 1 ? '' : 's'}
            {calendar.data.total > rows.length && ` · showing ${rows.length}`}
          </span>
        )}
      </div>

      {calendar.isLoading && <Spinner />}
      {calendar.isError && (
        <EmptyState>
          {calendar.error instanceof ApiError
            ? calendar.error.message
            : 'Could not load the calendar.'}
        </EmptyState>
      )}
      {calendar.data &&
        (view === 'list' ? (
          <CalendarList rows={rows} />
        ) : (
          <MonthGrid rows={rows} month={month} onMonth={setMonth} />
        ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
      )}
    >
      {children}
    </button>
  );
}

function ItemBadges({ row }: { row: ComplianceCalendarRow }): JSX.Element {
  return (
    <>
      {row.needsVerification && (
        <Badge tone="warn" className="ml-1">
          Verify
        </Badge>
      )}
      {row.isProvisional && (
        <Badge tone="neutral" className="ml-1">
          Provisional
        </Badge>
      )}
      {row.profileChanged && (
        <Badge tone="warn" className="ml-1">
          Profile changed — check
        </Badge>
      )}
    </>
  );
}

/** Columns as on the sheet: due date, day, client, registration, form, period,
 *  status, days left, assignee. */
function CalendarList({ rows }: { rows: ComplianceCalendarRow[] }): JSX.Element {
  const hrefOf = useCalendarHref();
  if (rows.length === 0)
    return <EmptyState>Nothing due in this window for these filters.</EmptyState>;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-ink-faint">
          <tr>
            {[
              'Due date',
              'Day',
              'Client',
              'Registration',
              'Form',
              'Period',
              'Status',
              'Days left',
              'Assignee',
            ].map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const due = parseIso(r.dueDate);
            return (
              <tr key={r.id} className="border-t border-line hover:bg-surface-raised">
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={cn('rounded border px-1.5 py-0.5 font-medium', BAND_CLASS[r.band])}
                  >
                    {due.toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  {r.originalDueDate && (
                    <span
                      className="ml-1 text-xs text-sky-700"
                      title={`Extended from ${r.originalDueDate}${r.extensionReference ? ` (${r.extensionReference})` : ''}`}
                    >
                      Ext
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-muted">
                  {due.toLocaleDateString('en-IN', { weekday: 'short' })}
                </td>
                <td className="px-3 py-2">
                  <Link href={hrefOf(r)} className="font-medium text-ink hover:text-primary-700">
                    {r.entityName}
                  </Link>
                  <span className="block text-xs text-ink-faint">{r.engagementCode}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.registrationNumber ?? <span className="text-ink-faint">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.formLabel ?? r.ruleName}
                  <ItemBadges row={r} />
                </td>
                <td className="px-3 py-2 text-ink-muted">{r.periodLabel}</td>
                <td className="px-3 py-2">{FILING_STATUS_LABEL[r.workflowStatus]}</td>
                <td
                  className={cn(
                    'whitespace-nowrap px-3 py-2',
                    r.band === 'red' && 'font-medium text-danger-700',
                    r.band === 'amber' && 'text-warning-700',
                    r.band === 'grey' && 'text-ink-faint',
                  )}
                >
                  {daysLeftLabel(r)}
                </td>
                <td className="px-3 py-2 text-ink-muted">{r.assigneeName ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/** A Monday-first month grid; each day lists its items in band colours. */
function MonthGrid({
  rows,
  month,
  onMonth,
}: {
  rows: ComplianceCalendarRow[];
  month: string;
  onMonth: (m: string) => void;
}): JSX.Element {
  const hrefOf = useCalendarHref();
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const byDay = new Map<string, ComplianceCalendarRow[]>();
  for (const r of rows) {
    const key = r.dueDate.slice(0, 10);
    if (!key.startsWith(month)) continue;
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }
  const shift = (delta: number): void => {
    const d = new Date(y, m - 1 + delta, 1);
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const todayKey = iso(new Date());
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Card className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-semibold text-ink">
          {first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </span>
        <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-surface-sunken px-2 py-1 font-semibold text-ink-faint">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null)
            return <div key={`x${i}`} className="min-h-[6rem] bg-surface-sunken/50" />;
          const key = `${month}-${String(day).padStart(2, '0')}`;
          const items = byDay.get(key) ?? [];
          return (
            <div key={key} className="min-h-[6rem] bg-surface p-1">
              <div
                className={cn(
                  'mb-1 text-right text-[11px]',
                  key === todayKey ? 'font-bold text-primary-700' : 'text-ink-faint',
                )}
              >
                {day}
              </div>
              <ul className="space-y-0.5">
                {items.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={hrefOf(r)}
                      title={`${r.entityName} · ${r.formLabel ?? r.ruleName} · ${r.periodLabel} · ${daysLeftLabel(r)}`}
                      className={cn(
                        'block truncate rounded border px-1 py-0.5',
                        BAND_CLASS[r.band],
                      )}
                    >
                      {r.needsVerification && <span className="font-semibold">⚑ </span>}
                      {r.formLabel ?? r.ruleCode} · {r.entityName}
                    </Link>
                  </li>
                ))}
                {items.length > 4 && (
                  <li className="px-1 text-ink-faint">+{items.length - 4} more</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

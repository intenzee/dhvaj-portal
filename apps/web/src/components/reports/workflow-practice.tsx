'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Paginated, PracticePerson, PracticeReport } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import type { EmployeeRow } from '@/lib/types';
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner } from '@/components/ui';
import { Field, Input } from '@/components/form';

/** The most people one practice session watches (the API's limit). */
export const PRACTICE_MAX_PEOPLE = 20;
const MAX_MS = 7 * 86_400_000;

/** An IST day and two clock times → the exact window, as ISO instants. */
export function practiceWindow(
  day: string,
  fromTime: string,
  toTime: string,
): { from: string; to: string } {
  return { from: `${day}T${fromTime}:00+05:30`, to: `${day}T${toTime}:00+05:30` };
}

/** Why this session cannot be shown yet, or null. */
export function practiceProblem(
  slot: { from: string; to: string },
  people: readonly string[],
): string | null {
  if (people.length === 0) return 'Pick the people taking part';
  if (people.length > PRACTICE_MAX_PEOPLE) return `At most ${PRACTICE_MAX_PEOPLE} people`;
  const span = Date.parse(slot.to) - Date.parse(slot.from);
  if (!Number.isFinite(span)) return 'Pick a day and the times';
  if (span <= 0) return 'The session must end after it starts';
  if (span > MAX_MS) return 'At most 7 days';
  return null;
}

/** `1.5` / `—`. */
export function practiceNumber(v: number | null, suffix = ''): string {
  return v === null ? '—' : `${v}${suffix}`;
}

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

const COLUMNS: { label: string; title: string; cell: (p: PracticePerson) => string }[] = [
  { label: 'Sessions', title: 'Browser tabs signed in', cell: (p) => String(p.sessions) },
  {
    label: 'Steps to first filing',
    title:
      'Pages after sign-in until a filing, task or request; median over sessions that got there',
    cell: (p) =>
      p.sessionsWithFiling ? `${practiceNumber(p.steps)} (${p.sessionsWithFiling})` : '—',
  },
  {
    label: 'Pages',
    title: 'Pages moved to (redirects not counted)',
    cell: (p) => String(p.routes),
  },
  {
    label: 'Row opens',
    title: 'Rows opened from a list; how many landed on the exact item',
    cell: (p) => (p.rowOpens ? `${p.rowOpens} (${practiceNumber(p.exactShare, '%')} exact)` : '0'),
  },
  {
    label: 'Actions',
    title: 'Task status changes and filings lodged',
    cell: (p) => String(p.actions),
  },
  {
    label: 'Pages per action',
    title: 'Pages moved to for each action',
    cell: (p) => practiceNumber(p.routesPerAction),
  },
];

/**
 * Staff Workflow · Rollout — the practice session: "two seniors and one manager
 * doing their real Monday list". Pick the people and the hour; per person, the
 * steps to the first filing, the pages and row opens, and the work done.
 */
export function WorkflowPractice(): JSX.Element {
  const [day, setDay] = useState(istToday);
  const [fromTime, setFromTime] = useState('10:00');
  const [toTime, setToTime] = useState('11:00');
  const [people, setPeople] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
  });
  const slot = practiceWindow(day, fromTime, toTime);
  const problem = practiceProblem(slot, people);
  const qs = new URLSearchParams({ ...slot, employeeIds: [...people].sort().join(',') });
  const report = useQuery({
    queryKey: ['telemetry-practice', qs.toString()],
    queryFn: () => apiFetch<PracticeReport>(`/telemetry/practice?${qs.toString()}`),
    enabled: problem === null,
  });

  const needle = filter.trim().toLowerCase();
  const list = (employees.data?.items ?? []).filter(
    (e) =>
      !needle ||
      e.fullName.toLowerCase().includes(needle) ||
      e.employeeCode.toLowerCase().includes(needle),
  );
  const toggle = (id: string) =>
    setPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Practice session</CardTitle>
        <p className="text-xs text-ink-muted">
          Watch a few people work their real list for an hour, and count the clicks against the
          baseline.
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Day">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="From (IST)">
            <Input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
          </Field>
          <Field label="To (IST)">
            <Input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">
            People {people.length > 0 && `(${people.length})`}
          </legend>
          <Input
            aria-label="Find people"
            placeholder="Find by name or code"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs"
          />
          {employees.isLoading ? (
            <Spinner />
          ) : (
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={people.includes(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                  <span className="truncate">
                    {e.fullName}{' '}
                    <span className="text-xs text-ink-muted">
                      {e.gradeName} · {e.officeCode}
                    </span>
                  </span>
                </label>
              ))}
              {list.length === 0 && <p className="text-xs text-ink-muted">No one matches.</p>}
            </div>
          )}
        </fieldset>

        {problem ? (
          <p className="text-xs text-ink-muted" role="note">
            {problem}.
          </p>
        ) : report.isLoading ? (
          <Spinner />
        ) : report.isError || !report.data ? (
          <EmptyState>
            {report.error instanceof ApiError
              ? report.error.message
              : 'Couldn’t load the practice session.'}
          </EmptyState>
        ) : report.data.people.length === 0 ? (
          <EmptyState>None of these people are in your scope.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Person</th>
                  {COLUMNS.map((c) => (
                    <th key={c.label} title={c.title} className="px-3 py-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.data.people.map((p) => (
                  <tr key={p.employeeId}>
                    <td className="py-2 pr-3 text-ink">{p.name}</td>
                    {COLUMNS.map((c) => (
                      <td key={c.label} className="px-3 py-2 text-right tabular-nums text-ink">
                        {c.cell(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

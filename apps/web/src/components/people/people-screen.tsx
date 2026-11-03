'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  ADD_ON_ROLES,
  DELETE_BLOCKER,
  GRADE,
  MAIN_ROLES,
  MAIN_ROLE_LABEL,
  ROLE,
  gradeRoleDisagree,
  mainRoleForGrade,
  type AddOnRole,
  type DeletePersonCheck,
  type DeletePersonResult,
  type GradeSlug,
  type MainRole,
  type PeopleCheck,
  type PeopleRoster,
  type PeopleRosterRow,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { hasRole } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { istToday } from '@/lib/people';
import type { OfficeRow } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Badge, Button, EmptyState, Panel, Spinner } from '@/components/ui';
import { Input, Select } from '@/components/form';
import { MoveWorkForm } from './move-work';

const GRADE_LABEL: Record<GradeSlug, string> = {
  partner: 'Partner',
  manager: 'Manager',
  senior: 'Senior',
  article: 'Article',
  staff: 'Staff',
};
const ADD_ON_LABEL: Record<AddOnRole, string> = { accountant: 'Accountant', hr: 'HR' };
const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  on_leave: 'On leave',
  notice_period: 'Notice period',
  exited: 'Left',
};
const ROSTER_KEY = ['people', 'roster'] as const;

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
const errorText = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.message : fallback;

/**
 * The People screen (B-2): everyone in one table, edited where they stand.
 * Grade and main role are separate fields — a grade change offers to bring the
 * role along, and a chip shows wherever the two disagree. The Managing Partner
 * and the administrator; leaving the firm (B-3) opens under the person's row.
 */
export function PeopleScreen(): JSX.Element {
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [focus, setFocus] = useState<string | null>(null);
  const roster = useQuery({
    queryKey: ROSTER_KEY,
    queryFn: () => apiFetch<PeopleRoster>('/people/admin/roster'),
  });
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });

  if (roster.isLoading || offices.isLoading) return <Spinner label="Loading people…" />;
  if (roster.isError || !roster.data) return <EmptyState>Could not load the people.</EmptyState>;

  const show = (employeeId: string): void => {
    setView('table');
    setFocus(employeeId);
    requestAnimationFrame(() =>
      document
        .getElementById(`person-${employeeId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  };

  return (
    <div className="space-y-6">
      <CleanUpList checks={roster.data.checks} onShow={show} />
      <div className="flex gap-1" role="tablist" aria-label="View">
        {(['table', 'chart'] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? 'primary' : 'secondary'}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
          >
            {v === 'table' ? 'Table' : 'Org chart'}
          </Button>
        ))}
      </div>
      {view === 'table' ? (
        <PeopleTable
          people={roster.data.people}
          offices={offices.data ?? []}
          focus={focus}
          onFocus={setFocus}
        />
      ) : (
        <OrgChart people={roster.data.people} onShow={show} />
      )}
    </div>
  );
}

/** The day-one clean-up list, worked out from the data; each name jumps to its row. */
export function CleanUpList({
  checks,
  onShow,
}: {
  checks: PeopleCheck[];
  onShow: (employeeId: string) => void;
}): JSX.Element {
  return (
    <Panel title="Clean-up">
      {checks.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing to tidy: grades, roles and reporting lines agree.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {checks.map((c) => (
            <li key={c.key} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <span className="font-medium text-ink">{c.title}</span>
                  <span className="ml-2 text-xs text-ink-faint">{c.hint}</span>
                </div>
                <Badge tone="warn">{c.people.length}</Badge>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {c.people.map((p) => (
                  <li key={`${c.key}-${p.employeeId}`}>
                    <button
                      type="button"
                      onClick={() => onShow(p.employeeId)}
                      className="inline-flex flex-col rounded-lg border border-line-strong px-2.5 py-1.5 text-left text-sm hover:bg-surface-raised"
                    >
                      <span className="font-medium text-ink">{p.fullName}</span>
                      <span className="text-xs text-ink-faint">{p.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PeopleTable({
  people,
  offices,
  focus,
  onFocus,
}: {
  people: PeopleRosterRow[];
  offices: OfficeRow[];
  focus: string | null;
  onFocus: (id: string | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-xl border border-line-strong">
      <table className="min-w-full text-sm">
        <thead className="bg-surface-sunken text-left text-xs font-medium text-ink-muted">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Login</th>
            <th className="px-3 py-2">Grade</th>
            <th className="px-3 py-2">Main role</th>
            <th className="px-3 py-2">Add-ons</th>
            <th className="px-3 py-2">Reports to</th>
            <th className="px-3 py-2">Office</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Open tasks</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {people.map((p) => (
            <Fragment key={p.employeeId}>
              <PersonRow
                person={p}
                people={people}
                offices={offices}
                focused={focus === p.employeeId}
                expanded={open === p.employeeId}
                onToggle={() => {
                  onFocus(null);
                  setOpen(open === p.employeeId ? null : p.employeeId);
                }}
              />
              {open === p.employeeId && (
                <tr>
                  <td colSpan={10} className="bg-surface-raised px-4 py-4">
                    <LeavePanel person={p} people={people} onDone={() => setOpen(null)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function usePersonEdits(person: PeopleRosterRow) {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ROSTER_KEY });
    void qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
    void qc.invalidateQueries({ queryKey: ['employees', 'leads'] });
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/employees/${person.employeeId}`, {
        method: 'PATCH',
        body: { ...body, version: person.version },
      }),
    onSuccess: refresh,
    onError: (err) => {
      toast(errorText(err, 'Could not save the change.'), 'error');
      refresh();
    },
  });
  const roles = useMutation({
    mutationFn: (next: { main: MainRole | null; addOns: AddOnRole[] }) =>
      apiFetch(`/users/${person.userId}/roles`, {
        method: 'PUT',
        body: { roles: [...(next.main ? [next.main] : []), ...next.addOns] },
      }),
    onSuccess: refresh,
    onError: (err) => toast(errorText(err, 'Could not change the roles.'), 'error'),
  });
  return { patch, roles };
}

function PersonRow({
  person: p,
  people,
  offices,
  focused,
  expanded,
  onToggle,
}: {
  person: PeopleRosterRow;
  people: PeopleRosterRow[];
  offices: OfficeRow[];
  focused: boolean;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { patch, roles } = usePersonEdits(p);
  // After a grade change: the role that would match it, offered once.
  const [offer, setOffer] = useState<MainRole | null>(null);
  const hasLogin = !!p.userId;
  const disagree = gradeRoleDisagree(p.gradeSlug, p.mainRole, hasLogin);
  const left = p.employmentStatus === 'exited';
  const managers = useMemo(
    () => people.filter((o) => o.employeeId !== p.employeeId && o.employmentStatus !== 'exited'),
    [people, p.employeeId],
  );

  const changeGrade = (grade: GradeSlug): void => {
    patch.mutate(
      { gradeSlug: grade },
      { onSuccess: () => setOffer(hasLogin ? mainRoleForGrade(grade, p.mainRole) : null) },
    );
  };
  const setMain = (main: MainRole | null): void => {
    setOffer(null);
    roles.mutate({ main, addOns: p.addOns });
  };
  const toggleAddOn = (role: AddOnRole, on: boolean): void =>
    roles.mutate({
      main: p.mainRole,
      addOns: on ? [...p.addOns, role] : p.addOns.filter((r) => r !== role),
    });

  return (
    <>
      <tr
        id={`person-${p.employeeId}`}
        className={cn('align-top', focused && 'bg-warning-50', left && 'text-ink-muted')}
      >
        <td className="px-3 py-2">
          <span className="block font-medium text-ink">{p.fullName}</span>
          <span className="block text-xs text-ink-faint">{p.employeeCode}</span>
        </td>
        <td className="px-3 py-2">
          {p.email ? (
            <span className={cn('text-xs', !p.loginActive && 'line-through')}>{p.email}</span>
          ) : (
            <span className="text-xs text-ink-faint">No login</span>
          )}
        </td>
        <td className="px-3 py-2">
          <Select
            aria-label={`Grade of ${p.fullName}`}
            value={p.gradeSlug}
            disabled={left || patch.isPending}
            onChange={(e) => changeGrade(e.target.value as GradeSlug)}
          >
            {Object.values(GRADE).map((g) => (
              <option key={g} value={g}>
                {GRADE_LABEL[g]}
              </option>
            ))}
          </Select>
        </td>
        <td className="px-3 py-2">
          {hasLogin ? (
            <div className="space-y-1">
              <Select
                aria-label={`Main role of ${p.fullName}`}
                value={p.mainRole ?? ''}
                disabled={left || roles.isPending}
                onChange={(e) => setMain((e.target.value || null) as MainRole | null)}
              >
                <option value="">— None —</option>
                {MAIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {MAIN_ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              {disagree && (
                <Badge tone="warn" className="inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> Grade and role disagree
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-xs text-ink-faint">—</span>
          )}
        </td>
        <td className="px-3 py-2">
          {hasLogin ? (
            <div className="flex flex-col gap-1">
              {ADD_ON_ROLES.map((r) => (
                <label key={r} className="inline-flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={p.addOns.includes(r)}
                    disabled={left || roles.isPending}
                    onChange={(e) => toggleAddOn(r, e.target.checked)}
                  />
                  {ADD_ON_LABEL[r]}
                </label>
              ))}
            </div>
          ) : (
            <span className="text-xs text-ink-faint">—</span>
          )}
        </td>
        <td className="px-3 py-2">
          <Select
            aria-label={`${p.fullName} reports to`}
            value={p.reportsToId ?? ''}
            disabled={left || patch.isPending}
            onChange={(e) => patch.mutate({ reportsToId: e.target.value || null })}
          >
            <option value="">— No one —</option>
            {managers.map((m) => (
              <option key={m.employeeId} value={m.employeeId}>
                {m.fullName}
              </option>
            ))}
          </Select>
        </td>
        <td className="px-3 py-2">
          <Select
            aria-label={`Office of ${p.fullName}`}
            value={p.officeCode}
            disabled={left || patch.isPending}
            onChange={(e) => patch.mutate({ officeCode: e.target.value })}
          >
            {offices.map((o) => (
              <option key={o.id} value={o.code}>
                {o.code}
              </option>
            ))}
          </Select>
        </td>
        <td className="px-3 py-2">
          <Badge tone={left ? 'danger' : p.employmentStatus === 'active' ? 'success' : 'warn'}>
            {STATUS_LABEL[p.employmentStatus] ?? p.employmentStatus}
          </Badge>
          {p.dateOfExit && (
            <span className="mt-1 block text-xs text-ink-faint">{p.dateOfExit}</span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{p.openTasks}</td>
        <td className="px-3 py-2 text-right">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Close' : 'Open'} leaving options for ${p.fullName}`}
            onClick={onToggle}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Leaving
          </Button>
        </td>
      </tr>
      {offer && (
        <tr>
          <td colSpan={10} className="bg-primary-50 px-4 py-2 text-sm">
            <span className="mr-3">
              Make {firstName(p.fullName)}’s role {MAIN_ROLE_LABEL[offer]} too?
            </span>
            <Button size="sm" onClick={() => setMain(offer)} disabled={roles.isPending}>
              Yes, make it {MAIN_ROLE_LABEL[offer]}
            </Button>{' '}
            <Button size="sm" variant="ghost" onClick={() => setOffer(null)}>
              No, keep {p.mainRole ? MAIN_ROLE_LABEL[p.mainRole] : 'none'}
            </Button>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Leaving the firm (B-3), under the person's row: move their open work,
 * deactivate (once nothing is left with them), and — for an administrator —
 * delete permanently behind a blocker list and their typed name.
 */
export function LeavePanel({
  person: p,
  people,
  onDone,
}: {
  person: PeopleRosterRow;
  people: PeopleRosterRow[];
  onDone: () => void;
}): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const mayDelete = hasRole(principal, ROLE.admin);
  const left = p.employmentStatus === 'exited';
  const [exitDate, setExitDate] = useState(istToday());
  const [exitReason, setExitReason] = useState('');
  const [typed, setTyped] = useState('');
  const [checking, setChecking] = useState(false);
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ROSTER_KEY });
    void qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
    void qc.invalidateQueries({ queryKey: ['people'] });
  };

  const takers = people.filter(
    (o) => o.employeeId !== p.employeeId && o.employmentStatus !== 'exited' && o.loginActive,
  );

  const deactivate = useMutation({
    mutationFn: () =>
      apiFetch(`/people/employees/${p.employeeId}/deactivate`, {
        method: 'POST',
        body: { dateOfExit: exitDate, ...(exitReason.trim() ? { reason: exitReason.trim() } : {}) },
      }),
    onSuccess: () => {
      toast(`${p.fullName} is deactivated.`);
      refresh();
    },
    onError: (err) => toast(errorText(err, 'Could not deactivate.'), 'error'),
  });

  const check = useQuery({
    queryKey: ['people', 'delete-check', p.employeeId],
    queryFn: () => apiFetch<DeletePersonCheck>(`/people/employees/${p.employeeId}/delete-check`),
    enabled: mayDelete && checking,
  });

  const remove = useMutation({
    mutationFn: () =>
      apiFetch<DeletePersonResult>(`/people/employees/${p.employeeId}`, {
        method: 'DELETE',
        body: { confirmName: typed },
      }),
    onSuccess: (r) => {
      toast(
        r.outcome === 'removed'
          ? `${p.fullName} is deleted.`
          : `${p.fullName} is deleted; past work shows them as a former employee.`,
      );
      refresh();
      onDone();
    },
    onError: (err) => toast(errorText(err, 'Could not delete.'), 'error'),
  });

  const focusMove = (): void => document.getElementById(`move-to-${p.employeeId}`)?.focus();
  const typedOk =
    typed.trim().replace(/\s+/g, ' ').toLowerCase() ===
    p.fullName.trim().replace(/\s+/g, ' ').toLowerCase();

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <MoveWorkForm
        fromId={p.employeeId}
        openTasks={p.openTasks}
        takers={takers}
        onMoved={() => {
          refresh();
          void qc.invalidateQueries({ queryKey: ['people', 'delete-check', p.employeeId] });
        }}
      />

      <section aria-label="Deactivate" className="space-y-2">
        <h4 className="font-semibold text-ink">Deactivate</h4>
        {left ? (
          <p className="text-xs text-ink-muted">
            Already left{p.dateOfExit ? ` on ${p.dateOfExit}` : ''}.
          </p>
        ) : (
          <>
            <p className="text-xs text-ink-muted">
              Turns their login off and sets the exit date.
              {p.openTasks > 0 && ' Move their open work first.'}
            </p>
            <Input
              type="date"
              aria-label="Exit date"
              value={exitDate}
              max={istToday()}
              onChange={(e) => setExitDate(e.target.value)}
            />
            <Input
              aria-label="Why they are leaving"
              placeholder="Why (optional, audit only)"
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={p.openTasks > 0 || !exitDate || deactivate.isPending}
              onClick={() => deactivate.mutate()}
            >
              {deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
            </Button>
          </>
        )}
      </section>

      {mayDelete && (
        <section aria-label="Delete permanently" className="space-y-2">
          <h4 className="font-semibold text-danger-700">Delete permanently</h4>
          {!checking ? (
            <Button size="sm" variant="secondary" onClick={() => setChecking(true)}>
              Check what stands in the way
            </Button>
          ) : check.isLoading ? (
            <Spinner label="Checking…" />
          ) : check.data ? (
            <>
              <p className="text-xs text-ink-muted">
                {check.data.hasHistory
                  ? 'Past work names them, so their record stays as “(former employee)”. Their login, bank, PAN, salary, tax and HR documents are erased.'
                  : 'No past work names them: the record and login go entirely.'}
              </p>
              {check.data.blockers.length > 0 && (
                <ul className="space-y-2" aria-label="Blockers">
                  {check.data.blockers.map((b) => (
                    <li
                      key={b.kind}
                      className="rounded-lg border border-warning-200 bg-warning-50 p-2 text-xs"
                    >
                      <span className="block text-warning-700">{b.message}</span>
                      {b.kind === DELETE_BLOCKER.openTasks ? (
                        <Button size="sm" variant="ghost" onClick={focusMove}>
                          Move their work
                        </Button>
                      ) : b.kind === DELETE_BLOCKER.ledEngagements ? (
                        <Link className="text-primary-700 underline" href="/engagements">
                          Change the leads on their engagements
                        </Link>
                      ) : (
                        <Link className="text-primary-700 underline" href="/payroll">
                          Open payroll
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Input
                aria-label={`Type ${p.fullName} to confirm`}
                placeholder={`Type ${p.fullName} to confirm`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <Button
                size="sm"
                className="bg-danger-600 hover:bg-danger-700"
                disabled={check.data.blockers.length > 0 || !typedOk || remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </>
          ) : (
            <p className="text-xs text-danger-700">{errorText(check.error, 'Could not check.')}</p>
          )}
        </section>
      )}
    </div>
  );
}

/** Who reports to whom; people with no one above them sit at the top. */
export function OrgChart({
  people,
  onShow,
}: {
  people: PeopleRosterRow[];
  onShow: (employeeId: string) => void;
}): JSX.Element {
  const here = people.filter((p) => p.employmentStatus !== 'exited');
  const ids = new Set(here.map((p) => p.employeeId));
  const reports = new Map<string, PeopleRosterRow[]>();
  for (const p of here) {
    const boss = p.reportsToId && ids.has(p.reportsToId) ? p.reportsToId : '';
    reports.set(boss, [...(reports.get(boss) ?? []), p]);
  }
  const node = (p: PeopleRosterRow, seen: Set<string>): JSX.Element => {
    const below = seen.has(p.employeeId) ? [] : (reports.get(p.employeeId) ?? []);
    const next = new Set(seen).add(p.employeeId);
    return (
      <li key={p.employeeId} className="mt-2">
        <button
          type="button"
          onClick={() => onShow(p.employeeId)}
          className="inline-flex flex-col rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-left text-sm shadow-card hover:bg-surface-raised"
        >
          <span className="font-medium text-ink">{p.fullName}</span>
          <span className="text-xs text-ink-faint">
            {p.mainRole ? MAIN_ROLE_LABEL[p.mainRole] : GRADE_LABEL[p.gradeSlug]} · {p.officeCode}
          </span>
        </button>
        {below.length > 0 && (
          <ul className="ml-6 border-l border-line pl-4">{below.map((b) => node(b, next))}</ul>
        )}
      </li>
    );
  };
  const top = reports.get('') ?? [];
  return (
    <div aria-label="Org chart">
      {top.length > 1 && (
        <p className="text-xs text-ink-muted">
          {top.length} people report to no one yet; set “Reports to” in the table.
        </p>
      )}
      <ul>{top.map((p) => node(p, new Set()))}</ul>
    </div>
  );
}

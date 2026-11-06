'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  formatWorked,
  type AttendancePerson,
  type AttendanceRegister,
  type LeaveApprovals,
  type LeaveRequest,
  type MyDay,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { thisMonth } from '@/lib/attendance';
import { Modal } from '@/components/modal';
import { Input } from '@/components/form';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { DaySummary, EntryList } from './my-day';
import { LEAVE_STATUS_TONE, leaveDates } from './leave-tab';
import { MonthGrid, MonthPicker, StatusKey } from './month-view';

/** One of the team's days, read only. */
export function PersonDayModal({
  person,
  day,
  onClose,
}: {
  person: Pick<AttendancePerson, 'employeeId' | 'employeeName'>;
  day: string;
  onClose: () => void;
}): JSX.Element {
  const q = useQuery({
    queryKey: ['attendance', 'person-day', person.employeeId, day],
    queryFn: () => apiFetch<MyDay>(`/attendance/people/${person.employeeId}/day/${day}`),
  });
  return (
    <Modal open onClose={onClose} title={person.employeeName} wide>
      {q.isLoading && <Spinner label="Loading the day…" />}
      {q.isError && (
        <EmptyState>
          {q.error instanceof ApiError ? q.error.message : 'Could not load the day.'}
        </EmptyState>
      )}
      {q.data && (
        <div className="space-y-4">
          <DaySummary day={q.data} />
          <Card>
            <EntryList entries={q.data.entries} />
            {q.data.hiddenSeconds ? (
              <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">
                + {formatWorked(q.data.hiddenSeconds)} on engagements you are not on.
              </p>
            ) : null}
          </Card>
        </div>
      )}
    </Modal>
  );
}

/** The month of everyone who reports to you. */
export function TeamMonth({
  scope,
  load,
  empty,
  actions,
}: {
  /** The query's name: whose month it is. */
  scope: 'team' | 'register';
  load: (month: string) => Promise<AttendanceRegister>;
  empty: string;
  /** Beside the search, for the month shown (the register's CSV). */
  actions?: (month: string) => React.ReactNode;
}): JSX.Element {
  const [month, setMonth] = useState(thisMonth());
  const [open, setOpen] = useState<{ person: AttendancePerson; day: string } | null>(null);
  const [find, setFind] = useState('');
  const q = useQuery({ queryKey: ['attendance', scope, month], queryFn: () => load(month) });
  const people = (q.data?.people ?? []).filter(
    (p) =>
      !find.trim() ||
      `${p.employeeName} ${p.employeeCode}`.toLowerCase().includes(find.trim().toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} onChange={setMonth} />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-56"
            placeholder="Find a person"
            aria-label="Find a person"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
          {actions?.(month)}
        </div>
      </div>
      <StatusKey />
      {q.isLoading && <Spinner label="Loading the month…" />}
      {q.isError && (
        <EmptyState>
          {q.error instanceof ApiError ? q.error.message : 'Could not load the month.'}
        </EmptyState>
      )}
      {q.data && (q.data.people.length === 0 ? <EmptyState>{empty}</EmptyState> : null)}
      {q.data && q.data.people.length > 0 && (
        <MonthGrid people={people} onPick={(person, day) => setOpen({ person, day })} />
      )}
      {open && <PersonDayModal person={open.person} day={open.day} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LeaveLine({ l, children }: { l: LeaveRequest; children?: React.ReactNode }): JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {l.employeeName} · {LEAVE_TYPE_LABEL[l.type]} · {leaveDates(l)}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {l.days} day{l.days === 1 ? '' : 's'}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {l.reason}
          {!l.canDecide && l.status === 'pending' && ` · waiting for ${l.approverName ?? 'HR'}`}
          {l.decidedByName && ` · ${LEAVE_STATUS_LABEL[l.status]} by ${l.decidedByName}`}
          {l.decisionNote && ` — “${l.decisionNote}”`}
        </p>
      </div>
      {children ?? <Badge tone={LEAVE_STATUS_TONE[l.status]}>{LEAVE_STATUS_LABEL[l.status]}</Badge>}
    </li>
  );
}

/** Leave waiting for you: approve or reject, with a note. */
export function LeaveApprovalsPanel(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ['attendance', 'approvals'],
    queryFn: () => apiFetch<LeaveApprovals>('/attendance/leave/approvals'),
  });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      apiFetch<LeaveRequest>(`/attendance/leave/${id}/decide`, {
        method: 'POST',
        body: { approve, ...(notes[id]?.trim() ? { note: notes[id]!.trim() } : {}) },
      }),
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      toast(`${l.employeeName}’s leave ${l.status}.`, 'success');
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not decide it.', 'error'),
  });
  if (q.isLoading) return <Spinner label="Loading leave…" />;
  if (!q.data) return <EmptyState>Could not load the leave requests.</EmptyState>;
  return (
    <div className="space-y-5">
      <Card>
        <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold text-ink">
          Waiting ({q.data.pending.length})
        </h2>
        {q.data.pending.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-muted">Nothing waiting for you.</p>
        ) : (
          <ul className="divide-y divide-line">
            {q.data.pending.map((l) => (
              <LeaveLine key={l.id} l={l}>
                {l.canDecide ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="w-48 py-1.5 text-xs"
                      placeholder="Note (optional)"
                      aria-label={`Note for ${l.employeeName}`}
                      value={notes[l.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [l.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: l.id, approve: true })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: l.id, approve: false })}
                    >
                      Reject
                    </Button>
                  </div>
                ) : undefined}
              </LeaveLine>
            ))}
          </ul>
        )}
      </Card>
      {q.data.recent.length > 0 && (
        <Card>
          <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold text-ink">
            Decided in the last 60 days
          </h2>
          <ul className="divide-y divide-line">
            {q.data.recent.map((l) => (
              <LeaveLine key={l.id} l={l} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

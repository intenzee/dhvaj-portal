'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LEAVE_HALF_LABEL,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPES,
  LEAVE_TYPE_LABEL,
  leaveDayCount,
  type LeaveHalf,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
  type MyLeave,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { addDays, istToday } from '@/lib/people';
import { useToast } from '@/lib/toast';
import { dayLabel } from '@/lib/attendance';
import { Field, Input, Select, Textarea } from '@/components/form';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';

export const LEAVE_STATUS_TONE: Record<LeaveStatus, string> = {
  pending: 'warn',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/** "Thu 12 Nov" or "Thu 12 Nov – Sat 14 Nov", with the half. */
export function leaveDates(l: Pick<LeaveRequest, 'fromDay' | 'toDay' | 'half'>): string {
  if (l.fromDay === l.toDay) {
    return `${dayLabel(l.fromDay, true)}${l.half ? ` · ${LEAVE_HALF_LABEL[l.half]}` : ''}`;
  }
  return `${dayLabel(l.fromDay)} – ${dayLabel(l.toDay, true)}`;
}

/** Your leave: what is left this year, asking for more, and your requests. */
export function LeaveTab(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const today = istToday();
  const q = useQuery({
    queryKey: ['attendance', 'leave'],
    queryFn: () => apiFetch<MyLeave>('/attendance/leave'),
  });
  const [type, setType] = useState<LeaveType>('casual');
  const [from, setFrom] = useState(addDays(today, 1));
  const [to, setTo] = useState(addDays(today, 1));
  const [half, setHalf] = useState<LeaveHalf | ''>('');
  const [reason, setReason] = useState('');
  const oneDay = from === to;
  const days = from && to ? leaveDayCount(from, to, oneDay && half ? half : null) : 0;

  const done = () => {
    void qc.invalidateQueries({ queryKey: ['attendance'] });
  };
  const apply = useMutation({
    mutationFn: () =>
      apiFetch<LeaveRequest>('/attendance/leave', {
        method: 'POST',
        body: {
          type,
          fromDay: from,
          toDay: to,
          ...(oneDay && half ? { half } : {}),
          reason: reason.trim(),
        },
      }),
    onSuccess: (l) => {
      done();
      setReason('');
      toast(
        `Asked for ${l.days} day${l.days === 1 ? '' : 's'}; ${l.approverName ?? 'HR'} will decide.`,
        'success',
      );
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not ask for the leave.', 'error'),
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      apiFetch<LeaveRequest>(`/attendance/leave/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      done();
      toast('Withdrawn.', 'success');
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not withdraw it.', 'error'),
  });

  if (q.isLoading) return <Spinner label="Loading your leave…" />;
  if (q.isError || !q.data) {
    return (
      <EmptyState>
        {q.error instanceof ApiError ? q.error.message : 'Could not load your leave.'}
      </EmptyState>
    );
  }
  const data = q.data;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.balances.map((b) => (
          <Card key={b.type} className="p-4">
            <p className="text-sm text-ink-muted">{LEAVE_TYPE_LABEL[b.type]}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {b.left === null ? '—' : b.left}
              {b.allowance !== null && (
                <span className="ml-1 text-sm font-normal text-ink-muted">
                  left of {b.allowance}
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {b.taken} taken{b.pending ? ` · ${b.pending} waiting` : ''}
              {b.allowance === null ? ' · no limit' : ''}
            </p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Ask for leave</h2>
        <p className="mb-4 text-xs text-ink-muted">
          {data.approverName
            ? `${data.approverName} approves your leave.`
            : 'HR or the Managing Partner approves your leave.'}{' '}
          Sundays and the firm’s holidays are not counted.
        </p>
        <form
          className="grid gap-4 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            apply.mutate();
          }}
        >
          <Field label="Kind" required>
            <Select value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {LEAVE_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" required>
            <Input
              type="date"
              value={from}
              min={addDays(today, -30)}
              onChange={(e) => {
                setFrom(e.target.value);
                if (!to || e.target.value > to) setTo(e.target.value);
              }}
            />
          </Field>
          <Field label="To" required>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Half day" hint={oneDay ? undefined : 'For one day only.'}>
            <Select
              value={oneDay ? half : ''}
              disabled={!oneDay}
              onChange={(e) => setHalf(e.target.value as LeaveHalf | '')}
            >
              <option value="">Full day</option>
              <option value="first_half">{LEAVE_HALF_LABEL.first_half}</option>
              <option value="second_half">{LEAVE_HALF_LABEL.second_half}</option>
            </Select>
          </Field>
          <Field label="Reason" required className="md:col-span-4">
            <Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex items-center gap-3 md:col-span-4">
            <Button type="submit" disabled={!reason.trim() || days <= 0 || apply.isPending}>
              {apply.isPending ? 'Sending…' : 'Ask for leave'}
            </Button>
            <span className="text-sm text-ink-muted">
              {days > 0 ? `${days} working day${days === 1 ? '' : 's'}` : 'Those days are Sundays.'}
            </span>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold text-ink">
          Your requests in {data.year}
        </h2>
        {data.requests.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-muted">No leave asked for yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.requests.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {LEAVE_TYPE_LABEL[l.type]} · {leaveDates(l)}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {l.days} day{l.days === 1 ? '' : 's'}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {l.reason}
                    {l.decidedByName && ` · ${LEAVE_STATUS_LABEL[l.status]} by ${l.decidedByName}`}
                    {l.decisionNote && ` — “${l.decisionNote}”`}
                  </p>
                </div>
                <Badge tone={LEAVE_STATUS_TONE[l.status]}>{LEAVE_STATUS_LABEL[l.status]}</Badge>
                {(l.status === 'pending' || (l.status === 'approved' && l.fromDay > today)) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(l.id)}
                  >
                    Withdraw
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

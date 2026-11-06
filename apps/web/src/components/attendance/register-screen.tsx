'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import {
  LEAVE_STATUS_LABEL,
  LEAVE_TYPES,
  LEAVE_TYPE_LABEL,
  type AttendanceRegister,
  type AttendanceSettings,
  type Holiday,
  type LeaveRequest,
} from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { dayLabel, thisMonth } from '@/lib/attendance';
import { Field, Input, Select } from '@/components/form';
import { Badge, Button, Card, Spinner } from '@/components/ui';
import { LEAVE_STATUS_TONE, leaveDates } from './leave-tab';
import { MonthPicker } from './month-view';
import { LeaveApprovalsPanel, TeamMonth } from './team-screen';

const loadRegister = (month: string) =>
  apiFetch<AttendanceRegister>(`/attendance/register/${month}`);

/** The firm's month, with the payroll CSV. */
export function RegisterTab(): JSX.Element {
  const toast = useToast();
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Present, half days, absent and leave a person, and the payable days. Click a day to see its
        hours.{' '}
        <Link href="/people/attendance" className="text-primary-600 hover:underline">
          Timer in/out log
        </Link>
      </p>
      <TeamMonth
        scope="register"
        load={loadRegister}
        empty="Nobody was employed that month."
        actions={(month) => (
          <Button
            variant="secondary"
            onClick={() =>
              void downloadFile(
                `/attendance/register/${month}/export`,
                `attendance-${month}.csv`,
              ).catch((err: unknown) =>
                toast(err instanceof ApiError ? err.message : 'Could not download.', 'error'),
              )
            }
          >
            <Download className="h-4 w-4" /> CSV for payroll
          </Button>
        )}
      />
    </div>
  );
}

/** Every request touching a month, and those waiting. */
export function FirmLeaveTab(): JSX.Element {
  const [month, setMonth] = useState(thisMonth());
  const q = useQuery({
    queryKey: ['attendance', 'register-leave', month],
    queryFn: () => apiFetch<LeaveRequest[]>(`/attendance/register/${month}/leave`),
  });
  return (
    <div className="space-y-5">
      <LeaveApprovalsPanel />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold text-ink">Leave in the month</h2>
          <MonthPicker month={month} onChange={setMonth} />
        </div>
        {q.isLoading && (
          <div className="p-4">
            <Spinner />
          </div>
        )}
        {q.data?.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-ink-muted">No leave this month.</p>
        )}
        <ul className="divide-y divide-line">
          {q.data?.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {l.employeeName} · {LEAVE_TYPE_LABEL[l.type]} · {leaveDates(l)}
                  <span className="ml-2 text-xs font-normal text-ink-muted">{l.days} d</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">{l.reason}</p>
              </div>
              <Badge tone={LEAVE_STATUS_TONE[l.status]}>{LEAVE_STATUS_LABEL[l.status]}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** The firm's holidays in a year. */
export function HolidaysTab(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [year, setYear] = useState(Number(thisMonth().slice(0, 4)));
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const key = ['attendance', 'holidays', year];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<Holiday[]>(`/attendance/holidays?year=${year}`),
  });
  const changed = () => void qc.invalidateQueries({ queryKey: ['attendance'] });
  const fail = (what: string) => (err: unknown) =>
    toast(err instanceof ApiError ? err.message : `Could not ${what}.`, 'error');
  const add = useMutation({
    mutationFn: () =>
      apiFetch<Holiday>('/attendance/holidays', {
        method: 'POST',
        body: { day, name: name.trim() },
      }),
    onSuccess: (h) => {
      changed();
      setDay('');
      setName('');
      toast(`${h.name} added.`, 'success');
    },
    onError: fail('add the holiday'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/attendance/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: changed,
    onError: fail('take the holiday off'),
  });
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Add a holiday</h2>
        <p className="mb-4 text-xs text-ink-muted">
          A holiday is off for everyone: it is not absent, and leave over it does not count it.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Day" required>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Name" required>
            <Input
              value={name}
              maxLength={80}
              placeholder="Diwali"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!day || !name.trim() || add.isPending}>
            Add
          </Button>
        </form>
      </Card>
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold text-ink">Holidays in {year}</h2>
          <Select
            aria-label="Year"
            className="w-28"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[year - 1, year, year + 1]
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </Select>
        </div>
        {q.isLoading && (
          <div className="p-4">
            <Spinner />
          </div>
        )}
        {q.data?.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-ink-muted">
            No holidays listed for {year}.
          </p>
        )}
        <ul className="divide-y divide-line">
          {q.data?.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-36 text-sm text-ink-muted">{dayLabel(h.day, true)}</span>
              <span className="flex-1 text-sm font-medium text-ink">{h.name}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Take ${h.name} off the list`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(h.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Full day, half day and the year's leave. */
export function SettingsTab(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['attendance', 'settings'],
    queryFn: () => apiFetch<AttendanceSettings>('/attendance/settings'),
  });
  const [draft, setDraft] = useState<AttendanceSettings | null>(null);
  const s = draft ?? q.data ?? null;
  const save = useMutation({
    mutationFn: (body: AttendanceSettings) =>
      apiFetch<AttendanceSettings>('/attendance/settings', { method: 'PUT', body }),
    onSuccess: (next) => {
      qc.setQueryData(['attendance', 'settings'], next);
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      setDraft(null);
      toast('Saved.', 'success');
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not save.', 'error'),
  });
  if (q.isLoading || !s) return <Spinner />;
  const hoursField = (label: string, value: number, set: (m: number) => void, hint: string) => (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={0.5}
        max={16}
        step={0.5}
        value={value / 60}
        onChange={(e) => set(Math.round(Number(e.target.value) * 60))}
      />
    </Field>
  );
  return (
    <Card className="max-w-2xl p-5">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(s);
        }}
      >
        {hoursField(
          'Hours for a full day',
          s.presentMinutes,
          (m) => setDraft({ ...s, presentMinutes: m }),
          'This many hours in a day marks it Present.',
        )}
        {hoursField(
          'Hours for a half day',
          s.halfDayMinutes,
          (m) => setDraft({ ...s, halfDayMinutes: m }),
          'At least this many (and under a full day) is a Half day.',
        )}
        <p className="text-sm font-medium text-ink sm:col-span-2">Leave a year (days)</p>
        {LEAVE_TYPES.map((t) => (
          <Field key={t} label={LEAVE_TYPE_LABEL[t]} hint="Empty: no limit.">
            <Input
              type="number"
              min={0}
              max={365}
              value={s.allowances[t] ?? ''}
              onChange={(e) =>
                setDraft({
                  ...s,
                  allowances: {
                    ...s.allowances,
                    [t]:
                      e.target.value === ''
                        ? null
                        : Math.max(0, Math.round(Number(e.target.value))),
                  },
                })
              }
            />
          </Field>
        ))}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!draft || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

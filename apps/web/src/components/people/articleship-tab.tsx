'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  ARTICLESHIP_END_STATUSES,
  ARTICLESHIP_LEAVE_KINDS,
  PERMISSION,
  type ArticleshipDetail,
  type ArticleshipLeaveKind,
  type ArticleshipScheme,
  type ArticleshipStatus,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { formatDate, humanize } from '@/lib/format';
import { istToday, readsPeople } from '@/lib/people';
import type { AdminEmployeeRow } from '@/lib/types';
import { Modal } from '@/components/modal';
import { Field, Input, Select, Textarea } from '@/components/form';
import { Badge, Button, Card, CardBody, EmptyState, Spinner } from '@/components/ui';

export const ARTICLESHIP_STATUS_LABEL: Record<ArticleshipStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  transferred_out: 'Transferred out',
  terminated: 'Terminated',
};

/** The person's articleship: principal, ICAI registration, period, leave (spec §4.7). */
export function ArticleshipTab({ employee }: { employee: AdminEmployeeRow }): JSX.Element {
  const { principal } = useAuth();
  const mayEdit = readsPeople(principal) && can(principal, PERMISSION.employeeManage);
  const [form, setForm] = useState<'new' | ArticleshipDetail | null>(null);
  const [ending, setEnding] = useState<ArticleshipDetail | null>(null);
  const [addingLeave, setAddingLeave] = useState(false);
  const key = ['people', 'articleship', employee.id];
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<ArticleshipDetail[]>(`/people/employees/${employee.id}/articleship`),
  });

  if (list.isLoading) return <Spinner label="Loading the articleship…" />;
  if (list.isError) return <EmptyState>Could not load the articleship.</EmptyState>;
  const all = list.data ?? [];
  const active = all.find((a) => a.status === 'active') ?? null;
  const past = all.filter((a) => a !== active);

  return (
    <div className="space-y-4">
      {active ? (
        <ArticleshipCard
          a={active}
          employeeId={employee.id}
          mayEdit={mayEdit}
          onEdit={() => setForm(active)}
          onEnd={() => setEnding(active)}
          onAddLeave={() => setAddingLeave(true)}
        />
      ) : (
        <EmptyState>
          {employee.gradeSlug === 'article'
            ? 'No active articleship recorded.'
            : 'Articleships are kept for articles only.'}
          {mayEdit && employee.gradeSlug === 'article' && (
            <div className="mt-3">
              <Button size="sm" onClick={() => setForm('new')}>
                <Plus className="h-4 w-4" /> Record the articleship
              </Button>
            </div>
          )}
        </EmptyState>
      )}
      {past.map((a) => (
        <ArticleshipCard key={a.id} a={a} employeeId={employee.id} mayEdit={false} />
      ))}

      {form && (
        <ArticleshipFormModal
          employeeId={employee.id}
          current={form === 'new' ? null : form}
          onClose={() => setForm(null)}
        />
      )}
      {ending && <EndModal employeeId={employee.id} a={ending} onClose={() => setEnding(null)} />}
      {addingLeave && <LeaveModal employeeId={employee.id} onClose={() => setAddingLeave(false)} />}
    </div>
  );
}

function ArticleshipCard({
  a,
  employeeId,
  mayEdit,
  onEdit,
  onEnd,
  onAddLeave,
}: {
  a: ArticleshipDetail;
  employeeId: string;
  mayEdit: boolean;
  onEdit?: () => void;
  onEnd?: () => void;
  onAddLeave?: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (leaveId: string) =>
      apiFetch(`/people/employees/${employeeId}/articleship/leaves/${leaveId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['people', 'articleship', employeeId] }),
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not remove the leave.', 'error'),
  });
  const over = a.leaveEntitlementDays !== null && a.leaveTakenDays > a.leaveEntitlementDays;

  const facts: Array<[string, string]> = [
    [
      'Principal',
      `${a.principalName}${a.principalMembershipNo ? ` (M. No. ${a.principalMembershipNo})` : ''}`,
    ],
    ['Scheme', a.schemeLabel],
    ['ICAI registration', a.icaiRegistrationNo ?? '—'],
    ['Registered on', formatDate(a.icaiRegistrationDate)],
    ['Started', formatDate(a.startDate)],
    ['Expected completion', formatDate(a.expectedCompletion)],
  ];
  if (a.transferredFrom) facts.push(['Transferred in from', a.transferredFrom]);
  if (a.endedOn) facts.push(['Ended', formatDate(a.endedOn)]);

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Badge tone={a.status === 'active' ? 'success' : 'neutral'}>
            {ARTICLESHIP_STATUS_LABEL[a.status]}
          </Badge>
          {mayEdit && a.status === 'active' && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="sm" variant="secondary" onClick={onEnd}>
                End articleship
              </Button>
            </div>
          )}
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-medium text-ink-faint">{k}</dt>
              <dd className="text-sm text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {a.endNote && <p className="mt-3 text-sm text-ink-muted">{a.endNote}</p>}

        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-ink">
              Leave:{' '}
              <span className={over ? 'text-danger-600' : undefined}>
                {a.leaveTakenDays} day{a.leaveTakenDays === 1 ? '' : 's'}
              </span>
              {a.leaveEntitlementDays !== null ? (
                <span className="font-normal text-ink-muted">
                  {' '}
                  of {a.leaveEntitlementDays} allowed
                  {a.leaveEntitlementOverridden ? ' (this article’s own allowance)' : ''}
                </span>
              ) : (
                <span className="font-normal text-ink-muted"> (no allowance entered yet)</span>
              )}
            </h4>
            {mayEdit && a.status === 'active' && (
              <Button size="sm" variant="ghost" onClick={onAddLeave}>
                <Plus className="h-3.5 w-3.5" /> Add leave
              </Button>
            )}
          </div>
          {a.leaves.length === 0 ? (
            <p className="text-sm text-ink-muted">No leave recorded.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {a.leaves.map((l) => (
                  <tr key={l.id} className="border-t border-line first:border-0">
                    <td className="py-1.5">
                      {formatDate(l.fromDate)}
                      {l.toDate !== l.fromDate ? ` – ${formatDate(l.toDate)}` : ''}
                    </td>
                    <td className="py-1.5">{humanize(l.kind)}</td>
                    <td className="py-1.5 text-right tabular-nums">{l.days}</td>
                    <td className="py-1.5 pl-3 text-ink-muted">{l.note ?? ''}</td>
                    {mayEdit && a.status === 'active' && (
                      <td className="py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Remove this leave"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(l.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function ArticleshipFormModal({
  employeeId,
  current,
  onClose,
}: {
  employeeId: string;
  current: ArticleshipDetail | null;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const partners = useQuery({
    queryKey: ['people', 'partners'],
    queryFn: () =>
      apiFetch<Paginated<AdminEmployeeRow>>('/employees?grade=partner&limit=100').then((p) =>
        p.items.filter((e) => e.employmentStatus !== 'exited'),
      ),
  });
  const schemes = useQuery({
    queryKey: ['people', 'articleship-schemes'],
    queryFn: () => apiFetch<ArticleshipScheme[]>('/people/articleship-schemes'),
  });
  const [principalEmployeeId, setPrincipal] = useState(current?.principalEmployeeId ?? '');
  const [schemeCode, setScheme] = useState(current?.schemeCode ?? '');
  const [regNo, setRegNo] = useState(current?.icaiRegistrationNo ?? '');
  const [regDate, setRegDate] = useState(current?.icaiRegistrationDate ?? '');
  const [startDate, setStart] = useState(current?.startDate ?? '');
  const [expected, setExpected] = useState(current?.expectedCompletion ?? '');
  const [ownLeave, setOwnLeave] = useState(
    current?.leaveEntitlementOverridden ? String(current.leaveEntitlementDays ?? '') : '',
  );
  const [from, setFrom] = useState(current?.transferredFrom ?? '');
  const activeSchemes = (schemes.data ?? []).filter((s) => s.isActive || s.code === schemeCode);
  const scheme = schemeCode || activeSchemes[0]?.code || '';

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/people/employees/${employeeId}/articleship`, {
        method: 'PUT',
        body: {
          principalEmployeeId,
          schemeCode: scheme,
          icaiRegistrationNo: regNo.trim() || null,
          icaiRegistrationDate: regDate || null,
          startDate,
          ...(expected ? { expectedCompletion: expected } : {}),
          leaveEntitlementDays: ownLeave.trim() === '' ? null : Number(ownLeave),
          transferredFrom: from.trim() || null,
          ...(current ? { version: current.version } : {}),
        },
      }),
    onSuccess: () => {
      toast(current ? 'Articleship updated.' : 'Articleship recorded.');
      void qc.invalidateQueries({ queryKey: ['people'] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not save the articleship.', 'error'),
  });

  const ok =
    !!principalEmployeeId &&
    !!scheme &&
    !!startDate &&
    (ownLeave.trim() === '' || /^\d{1,4}$/.test(ownLeave.trim()));

  return (
    <Modal
      open
      onClose={onClose}
      title={current ? 'Edit articleship' : 'Record the articleship'}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Principal" required hint="A partner of the firm.">
          <Select value={principalEmployeeId} onChange={(e) => setPrincipal(e.target.value)}>
            <option value="">— Choose —</option>
            {(partners.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
                {p.membershipNo ? ` (M. No. ${p.membershipNo})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Scheme" required>
          <Select value={scheme} onChange={(e) => setScheme(e.target.value)}>
            {activeSchemes.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label} ({s.periodMonths} months)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ICAI registration no.">
          <Input value={regNo} maxLength={40} onChange={(e) => setRegNo(e.target.value)} />
        </Field>
        <Field label="Registered on">
          <Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} />
        </Field>
        <Field label="Start date" required>
          <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Expected completion" hint="Blank: the start plus the scheme’s period.">
          <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>
        <Field label="Leave allowed (days)" hint="Blank: the scheme’s allowance.">
          <Input
            inputMode="numeric"
            value={ownLeave}
            onChange={(e) => setOwnLeave(e.target.value)}
          />
        </Field>
        <Field label="Transferred in from" hint="When they came from another principal.">
          <Input value={from} maxLength={300} onChange={(e) => setFrom(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function EndModal({
  employeeId,
  a,
  onClose,
}: {
  employeeId: string;
  a: ArticleshipDetail;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<(typeof ARTICLESHIP_END_STATUSES)[number]>('completed');
  const [endedOn, setEndedOn] = useState(istToday());
  const [note, setNote] = useState('');
  const end = useMutation({
    mutationFn: () =>
      apiFetch(`/people/employees/${employeeId}/articleship/end`, {
        method: 'POST',
        body: {
          status,
          endedOn,
          ...(note.trim() ? { note: note.trim() } : {}),
          version: a.version,
        },
      }),
    onSuccess: () => {
      toast('Articleship closed.');
      void qc.invalidateQueries({ queryKey: ['people'] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not close the articleship.', 'error'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="End the articleship"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!endedOn || end.isPending} onClick={() => end.mutate()}>
            {end.isPending ? 'Saving…' : 'End articleship'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="How it ended" required>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {ARTICLESHIP_END_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ARTICLESHIP_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="On" required>
          <Input type="date" value={endedOn} onChange={(e) => setEndedOn(e.target.value)} />
        </Field>
        <Field label="Note" hint="E.g. the new principal on a transfer.">
          <Textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function LeaveModal({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [fromDate, setFrom] = useState('');
  const [toDate, setTo] = useState('');
  const [days, setDays] = useState('');
  const [kind, setKind] = useState<ArticleshipLeaveKind>('leave');
  const [note, setNote] = useState('');
  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/people/employees/${employeeId}/articleship/leaves`, {
        method: 'POST',
        body: {
          fromDate,
          toDate: toDate || fromDate,
          days: Number(days),
          kind,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast('Leave recorded.');
      void qc.invalidateQueries({ queryKey: ['people', 'articleship', employeeId] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not record the leave.', 'error'),
  });
  const ok = !!fromDate && /^\d{1,3}(\.[05])?$/.test(days.trim()) && Number(days) > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Add leave"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Saving…' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" required>
          <Input type="date" value={fromDate} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" hint="Blank: one day.">
          <Input
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Days" required hint="Halves allowed, e.g. 1.5.">
          <Input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Kind" required>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ArticleshipLeaveKind)}>
            {ARTICLESHIP_LEAVE_KINDS.map((k) => (
              <option key={k} value={k}>
                {humanize(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" className="col-span-2">
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

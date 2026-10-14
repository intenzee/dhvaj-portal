'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMPLIANCE_EVENT_TYPE_LABEL,
  ROC_EVENT_TYPES,
  type BoardMeetingCadence,
  type ComplianceEventChanges,
  type ComplianceEventRecord,
  type ComplianceEventType,
  type RecordComplianceEventResult,
  type RocOverview,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
} from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';

/** The detail fields a form holds; only the event's own reach the API. */
export interface EventDetailForm {
  auditorAppointed: boolean;
  privatePlacement: boolean;
  months: string;
  approvalRef: string;
  din: string;
  name: string;
  change: 'appointed' | 'ceased';
  chargeHolder: string;
  amount: string;
}

export const EMPTY_DETAILS: EventDetailForm = {
  auditorAppointed: false,
  privatePlacement: false,
  months: '3',
  approvalRef: '',
  din: '',
  name: '',
  change: 'appointed',
  chargeHolder: '',
  amount: '',
};

/** The details an event type sends (spec §6.2). Pure — tested. */
export function eventDetailsPayload(
  type: ComplianceEventType,
  f: EventDetailForm,
): Record<string, unknown> {
  switch (type) {
    case 'agm':
      return { auditorAppointed: f.auditorAppointed };
    case 'allotment':
      return { privatePlacement: f.privatePlacement };
    case 'agm_extension':
      return {
        months: Number(f.months),
        ...(f.approvalRef.trim() ? { approvalRef: f.approvalRef.trim() } : {}),
      };
    case 'director_change':
      return {
        din: f.din.trim(),
        change: f.change,
        ...(f.name.trim() ? { name: f.name.trim() } : {}),
      };
    case 'charge_creation':
      return {
        ...(f.chargeHolder.trim() ? { chargeHolder: f.chargeHolder.trim() } : {}),
        ...(f.amount.trim() ? { amount: Number(f.amount) } : {}),
      };
    default:
      return {};
  }
}

/** A recorded event's details back into the form (for a correction). */
export function detailsToForm(details: Record<string, unknown>): EventDetailForm {
  const str = (k: string) => (typeof details[k] === 'string' ? (details[k] as string) : '');
  return {
    ...EMPTY_DETAILS,
    auditorAppointed: details.auditorAppointed === true,
    privatePlacement: details.privatePlacement === true,
    months: typeof details.months === 'number' ? String(details.months) : EMPTY_DETAILS.months,
    approvalRef: str('approvalRef'),
    din: str('din'),
    name: str('name'),
    change: details.change === 'ceased' ? 'ceased' : 'appointed',
    chargeHolder: str('chargeHolder'),
    amount: typeof details.amount === 'number' ? String(details.amount) : '',
  };
}

/** A details object in words: "Auditor appointed · DIN 01234567 (appointed)". Pure — tested. */
export function detailsText(type: string, d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (type === 'agm' && typeof d.auditorAppointed === 'boolean') {
    parts.push(d.auditorAppointed ? 'Auditor appointed / re-appointed' : 'No auditor appointment');
  }
  if (type === 'allotment' && typeof d.privatePlacement === 'boolean') {
    parts.push(d.privatePlacement ? 'Private placement' : 'Not a private placement');
  }
  if (type === 'agm_extension' && typeof d.months === 'number') {
    parts.push(`${d.months} month${d.months === 1 ? '' : 's'}`);
    if (d.approvalRef) parts.push(`approval ${String(d.approvalRef)}`);
  }
  if (type === 'director_change' && d.din) {
    parts.push(`${d.name ? `${String(d.name)}, ` : ''}DIN ${String(d.din)} (${String(d.change)})`);
  }
  if (type === 'charge_creation') {
    if (d.chargeHolder) parts.push(String(d.chargeHolder));
    if (typeof d.amount === 'number') parts.push(formatMoney(d.amount));
  }
  return parts.join(' · ');
}

/** What recording / correcting an event changed, one line each. Pure — tested. */
export function changeLines(c: ComplianceEventChanges | undefined): string[] {
  if (!c) return [];
  return [
    ...c.created.map((x) => `${x.label} created, due ${formatDate(x.dueDate)}`),
    ...c.moved.map((x) => `${x.label} moved ${formatDate(x.from)} → ${formatDate(x.to)}`),
    ...c.flagged.map((x) => `${x.label} already started — flagged “Profile changed — check”`),
    ...c.notApplicable.map((x) => `${x.label} no longer applies`),
  ];
}

/** "Next board meeting by 12 Jan 2027 (last held 14 Sep 2026)". Pure — tested. */
export function cadenceText(b: BoardMeetingCadence): string {
  if (!b.lastHeldOn) {
    return b.rule === 'calendar_half'
      ? 'One board meeting in each half of the calendar year, at least 90 days apart.'
      : 'At least four board meetings a year, no more than 120 days apart.';
  }
  const by = `Next board meeting by ${formatDate(b.dueBy!)} (last held ${formatDate(b.lastHeldOn)})`;
  return b.notBefore ? `${by}, not before ${formatDate(b.notBefore)}` : by;
}

const errText = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.message : fallback;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * ROC tab — the events the company's filings run from (spec §6): record an
 * AGM, an allotment, a director change …, see what each created or moved,
 * correct or void it (with a reason). Everything opens in place (+/−).
 */
export function RocEvents({
  engagementId,
  isLead,
}: {
  engagementId: string;
  isLead: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lastChanges, setLastChanges] = useState<{ title: string; lines: string[] } | null>(null);

  const overview = useQuery({
    queryKey: ['roc', 'overview', engagementId],
    queryFn: () => apiFetch<RocOverview>(`/engagements/${engagementId}/roc-overview`),
  });
  const events = useQuery({
    queryKey: ['roc', 'events', engagementId],
    queryFn: () =>
      apiFetch<ComplianceEventRecord[]>(`/engagements/${engagementId}/compliance-events`),
  });

  const done = (r: RecordComplianceEventResult, verb: string) => {
    const lines = changeLines(r.changes);
    setLastChanges({
      title: `${COMPLIANCE_EVENT_TYPE_LABEL[r.event.eventType as ComplianceEventType] ?? humanize(r.event.eventType)} ${verb}`,
      lines: lines.length ? lines : ['No filing dates changed.'],
    });
    toast(`Event ${verb}.`);
    void qc.invalidateQueries({ queryKey: ['roc'] });
    void qc.invalidateQueries({ queryKey: ['filing'] });
  };

  if (overview.isLoading || events.isLoading) return <Spinner />;
  const ov = overview.data;
  if (overview.error || !ov) {
    return <EmptyState>{errText(overview.error, 'Could not load the ROC overview.')}</EmptyState>;
  }
  if (ov.message) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-ink-muted" role="status">
            {ov.message}
          </p>
        </CardBody>
      </Card>
    );
  }
  const list = (events.data ?? []).filter((e) =>
    (ROC_EVENT_TYPES as string[]).includes(e.eventType),
  );

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <CardTitle>Events</CardTitle>
        {ov.boardMeetings.map((b) => (
          <span key={b.registrationId} className="text-xs text-ink-muted">
            {ov.boardMeetings.length > 1 && (
              <span className="mr-1 font-mono">{b.registrationNumber}</span>
            )}
            {cadenceText(b)}
          </span>
        ))}
        {isLead && (
          <button
            type="button"
            className="group ml-auto inline-flex items-center gap-1 text-sm"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            <ExpandToggle open={adding} /> Record event
          </button>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {adding && (
          <RecordEventForm
            engagementId={engagementId}
            registrations={ov.registrations}
            onDone={(r) => {
              setAdding(false);
              done(r, 'recorded');
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        {lastChanges && (
          <div
            role="status"
            className="rounded-md border border-success-500/30 bg-success-50 p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-ink">{lastChanges.title} — what changed</p>
              <button
                type="button"
                className="text-xs text-ink-muted"
                onClick={() => setLastChanges(null)}
              >
                Dismiss
              </button>
            </div>
            <ul className="mt-1 list-disc pl-5 text-ink">
              {lastChanges.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}
        {list.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No events recorded yet. Record the AGM, an allotment, a director change … and the
            filings they trigger appear below.
          </p>
        ) : (
          <ul
            className="divide-y divide-line rounded-md border border-line"
            aria-label="Recorded events"
          >
            {list.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                open={openId === ev.id}
                onToggle={() => setOpenId(openId === ev.id ? null : ev.id)}
                engagementId={engagementId}
                isLead={isLead}
                onDone={done}
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function DetailFields({
  type,
  f,
  set,
}: {
  type: ComplianceEventType;
  f: EventDetailForm;
  set: (patch: Partial<EventDetailForm>) => void;
}): JSX.Element | null {
  switch (type) {
    case 'agm':
      return (
        <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={f.auditorAppointed}
            onChange={(e) => set({ auditorAppointed: e.target.checked })}
          />
          Auditor appointed or re-appointed at this AGM (ADT-1 follows)
        </label>
      );
    case 'allotment':
      return (
        <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={f.privatePlacement}
            onChange={(e) => set({ privatePlacement: e.target.checked })}
          />
          Private placement (PAS-3 due in 15 days)
        </label>
      );
    case 'agm_extension':
      return (
        <>
          <Field label="Months granted" required>
            <Select value={f.months} onChange={(e) => set({ months: e.target.value })}>
              {['1', '2', '3'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ROC approval ref.">
            <Input
              value={f.approvalRef}
              maxLength={60}
              onChange={(e) => set({ approvalRef: e.target.value })}
            />
          </Field>
        </>
      );
    case 'director_change':
      return (
        <>
          <Field label="DIN" required>
            <Input
              value={f.din}
              inputMode="numeric"
              pattern="[0-9]{8}"
              maxLength={8}
              onChange={(e) => set({ din: e.target.value.replace(/\D/g, '') })}
              required
            />
          </Field>
          <Field label="Director name" required={f.change === 'appointed'}>
            <Input
              value={f.name}
              maxLength={120}
              onChange={(e) => set({ name: e.target.value })}
              required={f.change === 'appointed'}
            />
          </Field>
          <Field label="Change" required>
            <Select
              value={f.change}
              onChange={(e) => set({ change: e.target.value as 'appointed' | 'ceased' })}
            >
              <option value="appointed">Appointed</option>
              <option value="ceased">Ceased / resigned</option>
            </Select>
          </Field>
        </>
      );
    case 'charge_creation':
      return (
        <>
          <Field label="Charge holder">
            <Input
              value={f.chargeHolder}
              maxLength={160}
              onChange={(e) => set({ chargeHolder: e.target.value })}
            />
          </Field>
          <Field label="Amount secured">
            <Input
              inputMode="decimal"
              value={f.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
          </Field>
        </>
      );
    default:
      return null;
  }
}

function RecordEventForm({
  engagementId,
  registrations,
  onDone,
  onCancel,
}: {
  engagementId: string;
  registrations: RocOverview['registrations'];
  onDone: (r: RecordComplianceEventResult) => void;
  onCancel: () => void;
}): JSX.Element {
  const toast = useToast();
  const [eventType, setEventType] = useState<ComplianceEventType>('agm');
  const [eventDate, setEventDate] = useState(today());
  const [registrationId, setRegistrationId] = useState(registrations[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [f, setF] = useState<EventDetailForm>(EMPTY_DETAILS);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<RecordComplianceEventResult>(`/engagements/${engagementId}/compliance-events`, {
        method: 'POST',
        body: {
          eventType,
          eventDate,
          ...(registrationId ? { registrationId } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          details: eventDetailsPayload(eventType, f),
        },
      }),
    onSuccess: onDone,
    onError: (err) => toast(errText(err, 'Could not record the event.'), 'error'),
  });
  return (
    <form
      aria-label="Record event"
      className="space-y-2 rounded-md border border-primary-600/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Event" required>
          <Select
            value={eventType}
            onChange={(e) => setEventType(e.target.value as ComplianceEventType)}
          >
            {ROC_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {COMPLIANCE_EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" required>
          <Input
            type="date"
            value={eventDate}
            max={today()}
            onChange={(e) => setEventDate(e.target.value)}
            required
          />
        </Field>
        {registrations.length > 1 && (
          <Field label="CIN / LLPIN" required>
            <Select value={registrationId} onChange={(e) => setRegistrationId(e.target.value)}>
              {registrations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <DetailFields type={eventType} f={f} set={(p) => setF({ ...f, ...p })} />
      </div>
      <Field label="Notes">
        <Textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Record
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EventRow({
  ev,
  open,
  onToggle,
  engagementId,
  isLead,
  onDone,
}: {
  ev: ComplianceEventRecord;
  open: boolean;
  onToggle: () => void;
  engagementId: string;
  isLead: boolean;
  onDone: (r: RecordComplianceEventResult, verb: string) => void;
}): JSX.Element {
  const toast = useToast();
  const [mode, setMode] = useState<'view' | 'correct' | 'void'>('view');
  const [eventDate, setEventDate] = useState(ev.eventDate);
  const [notes, setNotes] = useState(ev.notes ?? '');
  const [f, setF] = useState<EventDetailForm>(() => detailsToForm(ev.details));
  const [reason, setReason] = useState('');
  const type = ev.eventType as ComplianceEventType;
  const url = `/engagements/${engagementId}/compliance-events/${ev.id}`;
  const correct = useMutation({
    mutationFn: () =>
      apiFetch<RecordComplianceEventResult>(url, {
        method: 'PATCH',
        body: {
          ...(eventDate !== ev.eventDate ? { eventDate } : {}),
          notes: notes.trim() || null,
          details: eventDetailsPayload(type, f),
          reason: reason.trim(),
        },
      }),
    onSuccess: (r) => {
      setMode('view');
      setReason('');
      onDone(r, 'corrected');
    },
    onError: (err) => toast(errText(err, 'Could not correct the event.'), 'error'),
  });
  const voidIt = useMutation({
    mutationFn: () =>
      apiFetch<RecordComplianceEventResult>(url, {
        method: 'DELETE',
        body: { reason: reason.trim() },
      }),
    onSuccess: (r) => {
      setMode('view');
      setReason('');
      onDone(r, 'voided');
    },
    onError: (err) => toast(errText(err, 'Could not void the event.'), 'error'),
  });
  const voided = !!ev.voidedAt;
  const detail = detailsText(ev.eventType, ev.details);
  return (
    <li className={voided ? 'opacity-70' : undefined}>
      <button
        type="button"
        className="group flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ExpandToggle open={open} />
        <span className={`font-medium text-ink ${voided ? 'line-through' : ''}`}>
          {COMPLIANCE_EVENT_TYPE_LABEL[type] ?? humanize(ev.eventType)}
        </span>
        <span className="text-ink-muted">{formatDate(ev.eventDate)}</span>
        {ev.financialYear && <span className="text-xs text-ink-muted">FY {ev.financialYear}</span>}
        {detail && <span className="text-xs text-ink-muted">· {detail}</span>}
        {voided && <Badge tone="neutral">Voided</Badge>}
        {ev.sourceInstanceId && <Badge tone="info">From the meeting record</Badge>}
        {ev.items && ev.items.length > 0 && (
          <span className="ml-auto text-xs text-ink-muted">
            {ev.items.length} filing{ev.items.length === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line bg-surface-sunken/40 px-3 py-2 text-sm">
          {voided && (
            <p className="text-ink-muted">
              Voided {formatDate(ev.voidedAt!)}: {ev.voidReason}
            </p>
          )}
          {ev.notes && <p className="whitespace-pre-wrap text-ink">{ev.notes}</p>}
          <p className="text-xs text-ink-muted">
            Recorded by {ev.recordedByName ?? '—'} on {formatDate(ev.createdAt)}
            {ev.updatedAt && ev.updatedAt !== ev.createdAt
              ? ` · last changed ${formatDate(ev.updatedAt)}`
              : ''}
          </p>
          {ev.items && ev.items.length > 0 && (
            <ul className="space-y-0.5" aria-label="Filings from this event">
              {ev.items.map((it) => (
                <li key={it.instanceId} className="flex flex-wrap gap-2">
                  <span className="text-ink">{it.label}</span>
                  <span className="text-ink-muted">due {formatDate(it.dueDate)}</span>
                  <span className="text-xs text-ink-muted">{humanize(it.workflowStatus)}</span>
                </li>
              ))}
            </ul>
          )}
          {isLead && !voided && mode === 'view' && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setMode('correct')}>
                Correct
              </Button>
              {ev.sourceInstanceId ? (
                <span className="self-center text-xs text-ink-muted">
                  To undo it, undo the AGM meeting record.
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setMode('void')}>
                  Void
                </Button>
              )}
            </div>
          )}
          {mode !== 'view' && (
            <form
              aria-label={mode === 'correct' ? 'Correct event' : 'Void event'}
              className="space-y-2 rounded-md border border-primary-600/30 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (mode === 'correct') correct.mutate();
                else voidIt.mutate();
              }}
            >
              {mode === 'correct' && (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <Field
                    label="Date"
                    required
                    hint={ev.sourceInstanceId ? 'From the AGM meeting record.' : undefined}
                  >
                    <Input
                      type="date"
                      value={eventDate}
                      max={today()}
                      readOnly={!!ev.sourceInstanceId}
                      onChange={(e) => setEventDate(e.target.value)}
                      required
                    />
                  </Field>
                  <DetailFields type={type} f={f} set={(p) => setF({ ...f, ...p })} />
                </div>
              )}
              {mode === 'correct' && (
                <Field label="Notes">
                  <Textarea
                    value={notes}
                    maxLength={2000}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
              )}
              <Field
                label={mode === 'correct' ? 'Why the correction' : 'Why void it'}
                required
                hint="Kept in the event’s history."
              >
                <Input
                  value={reason}
                  minLength={3}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  variant={mode === 'void' ? 'secondary' : undefined}
                  disabled={reason.trim().length < 3 || correct.isPending || voidIt.isPending}
                >
                  {mode === 'correct' ? 'Save correction' : 'Void event'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setMode('view')}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

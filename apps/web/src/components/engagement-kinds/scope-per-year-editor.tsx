'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock, Plus, Unlock } from 'lucide-react';
import {
  FIRM_CHECK,
  STREAM_LABEL,
  STREAM_REGISTRATION_TYPES,
  feeWithPeriod,
  type ComplianceEngagementYear,
  type FeePeriod,
  type IndependenceCheckResult,
  type IndependenceFinding,
  type IndependenceRule,
  type Stream,
  type StreamCatalogueEntry,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { useFirmChecks } from '@/lib/firm-checks';
import type { EntityDetail } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardBody, Button, Spinner, Badge } from '@/components/ui';
import { Field, Input } from '@/components/form';
import { FeeInput } from '@/components/billing/fee-input';
import { IndependencePanel, shiftFinancialYear } from './new-engagement-wizard';

type Regs = Partial<Record<Stream, string[]>>;

/**
 * Scope per year on a Compliance engagement (spec Change 1): which streams run
 * in each financial year, on which registrations, for what fee, and the s.144
 * approval reference. Adding a year generates its calendar; adding a stream is
 * checked against the independence rules first.
 */
export function ScopePerYearEditor({
  engagementId,
  entityId,
  canManage,
}: {
  engagementId: string;
  entityId: string;
  canManage: boolean;
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const ackRequired = useFirmChecks()[FIRM_CHECK.independenceAckRequired];
  const years = useQuery({
    queryKey: ['engagement-years', engagementId],
    queryFn: () => apiFetch<ComplianceEngagementYear[]>(`/engagements/${engagementId}/years`),
  });
  const streams = useQuery({
    queryKey: ['streams'],
    queryFn: () => apiFetch<StreamCatalogueEntry[]>('/streams'),
    staleTime: 5 * 60_000,
  });
  const entity = useQuery({
    queryKey: ['entity', entityId],
    queryFn: () => apiFetch<EntityDetail>(`/entities/${entityId}`),
  });

  const sorted = useMemo(
    () => [...(years.data ?? [])].sort((a, b) => b.financialYear.localeCompare(a.financialYear)),
    [years.data],
  );
  const nextYear = sorted[0] ? shiftFinancialYear(sorted[0].financialYear, 1) : null;

  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ['engagement-years', engagementId] });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };

  const [addAcks, setAddAcks] = useState<IndependenceRule[]>([]);
  const [addFindings, setAddFindings] = useState<IndependenceFinding[]>([]);
  const addYear = useMutation({
    mutationFn: () =>
      apiFetch<ComplianceEngagementYear>(`/engagements/${engagementId}/years`, {
        method: 'POST',
        body: { financialYear: nextYear, acknowledgedIndependenceRules: addAcks },
      }),
    onSuccess: (y) => {
      toast(`FY ${y.financialYear} added — its calendar is being generated.`, 'success');
      setAddAcks([]);
      setAddFindings([]);
      refresh();
    },
    onError: (err) => {
      const findings = err instanceof ApiError ? findingsOf(err) : [];
      if (findings.length) setAddFindings(findings);
      toast(err instanceof ApiError ? err.message : 'Could not add the year.', 'error');
    },
  });

  if (years.isLoading) return <Spinner label="Loading scope…" />;
  if (years.isError) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Scope per year</CardTitle>
        {canManage && nextYear && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => addYear.mutate()}
            disabled={addYear.isPending}
          >
            <Plus className="h-3.5 w-3.5" /> Add FY {nextYear}
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        {addFindings.length > 0 && (
          <IndependencePanel
            loading={false}
            findings={addFindings}
            ackRequired={ackRequired}
            acks={addAcks}
            onAck={(rule, on) =>
              setAddAcks((a) => (on ? [...a, rule] : a.filter((r) => r !== rule)))
            }
          />
        )}
        {sorted.length === 0 && <p className="text-sm text-ink-faint">No years in scope yet.</p>}
        {sorted.map((y) => (
          <YearEditor
            key={y.id}
            year={y}
            entityId={entityId}
            catalogue={streams.data ?? []}
            entity={entity.data}
            canManage={canManage}
            onSaved={refresh}
          />
        ))}
      </CardBody>
    </Card>
  );
}

function YearEditor({
  year,
  entityId,
  catalogue,
  entity,
  canManage,
  onSaved,
}: {
  year: ComplianceEngagementYear;
  entityId: string;
  catalogue: StreamCatalogueEntry[];
  entity: EntityDetail | undefined;
  canManage: boolean;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const ackRequired = useFirmChecks()[FIRM_CHECK.independenceAckRequired];
  const closed = year.status === 'closed';
  const editable = canManage && !closed;

  const [fee, setFee] = useState(year.feeAmount?.toString() ?? '');
  const [feePeriod, setFeePeriod] = useState<FeePeriod>(year.feePeriod ?? 'annual');
  const [s144, setS144] = useState(year.s144ApprovalRef ?? '');
  const [on, setOn] = useState<Stream[]>(year.streams);
  const [regs, setRegs] = useState<Regs>(year.streamRegistrations);
  const [acks, setAcks] = useState<IndependenceRule[]>([]);
  const [expanded, setExpanded] = useState(!closed);
  // A save refetches the year; start again from what the server holds.
  useEffect(() => {
    setFee(year.feeAmount?.toString() ?? '');
    setFeePeriod(year.feePeriod ?? 'annual');
    setS144(year.s144ApprovalRef ?? '');
    setOn(year.streams);
    setRegs(year.streamRegistrations);
    setAcks([]);
    setExpanded(year.status !== 'closed');
  }, [year]);

  const added = on.filter((s) => !year.streams.includes(s));
  const ended = year.streams.filter((s) => !on.includes(s));
  const regsChanged = on.some(
    (s) =>
      [...(regs[s] ?? [])].sort().join() !== [...(year.streamRegistrations[s] ?? [])].sort().join(),
  );
  const streamsDirty = added.length > 0 || ended.length > 0 || regsChanged;
  const feeValue = fee.trim() === '' ? null : Number(fee);
  const detailsDirty =
    feeValue !== (year.feeAmount ?? null) ||
    feePeriod !== (year.feePeriod ?? 'annual') ||
    (s144.trim() || null) !== (year.s144ApprovalRef ?? null);

  const check = useQuery({
    queryKey: ['independence-check', entityId, year.engagementId, year.financialYear, added],
    queryFn: () =>
      apiFetch<IndependenceCheckResult>('/engagements/independence-check', {
        method: 'POST',
        body: {
          entityId,
          kind: 'compliance',
          financialYears: [year.financialYear],
          streams: added,
          engagementId: year.engagementId,
          s144ApprovalRef: s144.trim() || null,
        },
      }),
    enabled: editable && added.length > 0,
  });
  const findings = added.length > 0 ? (check.data?.findings ?? []) : [];
  const block = added.length > 0 ? (check.data?.block ?? null) : null;
  const acksOk =
    !ackRequired ||
    findings.filter((f) => f.requiresAcknowledgement).every((f) => acks.includes(f.rule));

  const registrationsFor = (s: Stream) =>
    (entity?.registrations ?? []).filter((r) =>
      STREAM_REGISTRATION_TYPES[s].includes(r.registrationType.toLowerCase()),
    );

  const toggleStream = (s: Stream): void => {
    setAcks([]);
    if (on.includes(s)) {
      setOn(on.filter((x) => x !== s));
      return;
    }
    setOn([...on, s]);
    if (regs[s] === undefined) {
      const ids = registrationsFor(s)
        .filter((r) => r.status === 'active')
        .map((r) => r.id);
      if (ids.length) setRegs((m) => ({ ...m, [s]: ids }));
    }
  };
  const toggleReg = (s: Stream, id: string): void =>
    setRegs((m) => {
      const cur = m[s] ?? [];
      return { ...m, [s]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  const base = `/engagements/${year.engagementId}/years/${year.financialYear}`;
  const saveDetails = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      apiFetch<ComplianceEngagementYear>(base, {
        method: 'PATCH',
        body: { ...patch, version: year.version },
      }),
    onSuccess: () => {
      toast(`FY ${year.financialYear} saved.`, 'success');
      onSaved();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not save.', 'error'),
  });
  const saveStreams = useMutation({
    mutationFn: () =>
      apiFetch<ComplianceEngagementYear>(`${base}/streams`, {
        method: 'PATCH',
        body: {
          ...(added.length ? { add: added } : {}),
          ...(ended.length ? { end: ended } : {}),
          streamRegistrations: Object.fromEntries(on.map((s) => [s, regs[s] ?? []])),
          acknowledgedIndependenceRules: acks,
          version: year.version,
        },
      }),
    onSuccess: () => {
      toast(`Streams for FY ${year.financialYear} updated.`, 'success');
      onSaved();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not update the streams.', 'error'),
  });

  return (
    <div className="rounded-lg border border-line-strong">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span className="font-semibold text-ink">FY {year.financialYear}</span>
        <Badge tone={closed ? 'neutral' : 'success'}>{closed ? 'Closed' : 'Open'}</Badge>
        {year.s144ApprovalMissing && (
          <span className="flex items-center gap-1 text-xs text-warning-700">
            <AlertTriangle className="h-3.5 w-3.5" /> We audit this company — record the s.144
            approval reference.
          </span>
        )}
        {closed && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide' : 'Show'}
          </Button>
        )}
        {canManage && (
          <Button
            size="sm"
            variant="ghost"
            className={closed ? undefined : 'ml-auto'}
            disabled={saveDetails.isPending}
            onClick={() => saveDetails.mutate({ status: closed ? 'open' : 'closed' })}
          >
            {closed ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {closed ? 'Reopen year' : 'Close year'}
          </Button>
        )}
      </div>

      {!expanded ? (
        <p className="px-3 py-2 text-sm text-ink-muted">
          {year.streams.map((st) => STREAM_LABEL[st]).join(' · ')}
          {year.feeAmount != null && ` — fee ${feeWithPeriod(year.feeAmount, year.feePeriod)}`}
        </p>
      ) : (
        <>
          <div className="grid gap-3 px-3 py-3 sm:grid-cols-2">
            <FeeInput
              id={`fee-${year.id}`}
              amount={fee}
              period={feePeriod}
              onAmount={setFee}
              onPeriod={setFeePeriod}
              disabled={!editable}
            />
            <Field label="s.144 approval reference">
              <Input
                value={s144}
                maxLength={200}
                disabled={!editable}
                placeholder="Audit committee / board resolution"
                onChange={(e) => setS144(e.target.value)}
              />
            </Field>
            {editable && detailsDirty && (
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  disabled={
                    saveDetails.isPending ||
                    (feeValue !== null && (Number.isNaN(feeValue) || feeValue < 0))
                  }
                  onClick={() =>
                    saveDetails.mutate({
                      feeAmount: feeValue,
                      feePeriod,
                      s144ApprovalRef: s144.trim() || null,
                    })
                  }
                >
                  Save fee and reference
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-line px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Streams</p>
            {catalogue.map((sc) => {
              const active = on.includes(sc.stream);
              const byEntity = STREAM_REGISTRATION_TYPES[sc.stream].includes('entity');
              const available = registrationsFor(sc.stream);
              return (
                <div key={sc.stream} className="rounded-md border border-line">
                  <label
                    className={`flex items-center gap-2.5 px-3 py-1.5 ${editable ? 'cursor-pointer' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary-600"
                      checked={active}
                      disabled={!editable}
                      onChange={() => toggleStream(sc.stream)}
                    />
                    <span className="text-sm font-medium text-ink">{sc.label}</span>
                    {added.includes(sc.stream) && <Badge tone="info">adding</Badge>}
                    {ended.includes(sc.stream) && <Badge tone="warn">ending</Badge>}
                  </label>
                  {active && !byEntity && (
                    <div className="flex flex-wrap gap-2 border-t border-line px-3 py-1.5">
                      {available.length === 0 ? (
                        <span className="text-xs text-warning-700">
                          No {STREAM_REGISTRATION_TYPES[sc.stream].join(' / ').toUpperCase()} on the
                          client record.
                        </span>
                      ) : (
                        available.map((r) => (
                          <label
                            key={r.id}
                            className="flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-xs"
                          >
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-primary-600"
                              checked={(regs[sc.stream] ?? []).includes(r.id)}
                              disabled={!editable}
                              onChange={() => toggleReg(sc.stream, r.id)}
                            />
                            <span className="font-mono">{r.registrationNumber}</span>
                            {r.stateCode && <span className="text-ink-faint">· {r.stateCode}</span>}
                            {r.status !== 'active' && (
                              <span className="text-ink-faint">· {humanize(r.status)}</span>
                            )}
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {editable && added.length > 0 && (
              <IndependencePanel
                loading={check.isFetching}
                findings={findings}
                ackRequired={ackRequired}
                acks={acks}
                onAck={(rule, v) =>
                  setAcks((a) => (v ? [...a, rule] : a.filter((r) => r !== rule)))
                }
              />
            )}
            {editable && streamsDirty && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={
                    saveStreams.isPending ||
                    on.length === 0 ||
                    !!block ||
                    !acksOk ||
                    check.isFetching
                  }
                  onClick={() => saveStreams.mutate()}
                >
                  Save streams
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOn(year.streams);
                    setRegs(year.streamRegistrations);
                    setAcks([]);
                  }}
                >
                  Discard
                </Button>
                {on.length === 0 ? (
                  <span className="text-xs text-ink-faint">
                    A year keeps at least one stream — close the year instead.
                  </span>
                ) : (
                  ended.length > 0 && (
                    <span className="text-xs text-ink-faint">
                      Ending takes the stream’s unassigned, not-started items off the calendar; work
                      already assigned or started stays, flagged to check.
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function findingsOf(err: ApiError): IndependenceFinding[] {
  const f = (err.body as { findings?: unknown } | undefined)?.findings;
  return Array.isArray(f) ? (f as IndependenceFinding[]) : [];
}

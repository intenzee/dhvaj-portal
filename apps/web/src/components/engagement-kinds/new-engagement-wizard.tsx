'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileStack,
  Briefcase,
  Play,
  Plus,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  ENGAGEMENT_STATUS,
  STREAM_LABEL,
  STREAM_REGISTRATION_TYPES,
  type EngagementKind,
  type IndependenceCheckResult,
  type IndependenceFinding,
  type IndependenceRule,
  type Paginated,
  type Stream,
  type StreamCatalogueEntry,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { EmployeeRow, EntityDetail } from '@/lib/types';
import { EntityPicker, type Picked } from '@/components/entity-picker';
import { PageHeader, Card, CardBody, Button, Spinner, Badge } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { cn } from '@/lib/cn';

interface ServiceOption {
  id: string;
  code: string;
  name: string;
  serviceLineName: string;
  isActive: boolean;
  engagementKind?: EngagementKind | null;
}
interface YearDraft {
  financialYear: string;
  fee: string;
}

/** Indian FY containing `d`, e.g. "2026-27" (the year rolls over in April). */
export function financialYearOf(d: Date): string {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
/** The FY `delta` years away from `fy`. */
export function shiftFinancialYear(fy: string, delta: number): string {
  const start = Number(fy.slice(0, 4)) + delta;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const STEPS = ['Client', 'Kind', 'Details', 'Review'] as const;
const FY_RE = /^[0-9]{4}-[0-9]{2}$/;

const KIND_OPTIONS: {
  kind: EngagementKind;
  title: string;
  blurb: string;
  icon: typeof ClipboardCheck;
}[] = [
  {
    kind: 'statutory_audit',
    title: 'Statutory Audit',
    blurb: 'Audit under the Companies Act / LLP Act or another statute, one per financial year.',
    icon: ClipboardCheck,
  },
  {
    kind: 'compliance',
    title: 'Compliance',
    blurb:
      'The standing engagement for GST, TDS/TCS, Income Tax, ROC, Bookkeeping and MIS, with a row per year in scope.',
    icon: FileStack,
  },
  {
    kind: 'assignment',
    title: 'Other assignment',
    blurb: 'One-off or project work: certification, due diligence, valuation, advisory.',
    icon: Briefcase,
  },
];

/**
 * "New engagement" with kinds (spec Change 1, creation flow): client → kind →
 * the kind's details (with the independence check before submit) → review.
 * A client with an open Compliance engagement is offered "Add a year / stream"
 * on it instead of a second one.
 */
export function NewEngagementWizard(): JSX.Element {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const currentFy = financialYearOf(new Date());

  const [step, setStep] = useState(0);
  const [entity, setEntity] = useState<Picked | null>(null);
  const [kind, setKind] = useState<EngagementKind | null>(null);

  // Shared
  const [financialYear, setFinancialYear] = useState(currentFy);
  const [status, setStatus] = useState<string>(ENGAGEMENT_STATUS.accepted);
  const [partnerId, setPartnerId] = useState('');
  const [managerId, setManagerId] = useState('');
  // Assignment
  const [serviceId, setServiceId] = useState('');
  const [periodLabel, setPeriodLabel] = useState('FY');
  // Compliance
  const [years, setYears] = useState<YearDraft[]>([{ financialYear: currentFy, fee: '' }]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [registrations, setRegistrations] = useState<Partial<Record<Stream, string[]>>>({});
  const [leads, setLeads] = useState<Partial<Record<Stream, string>>>({});
  // Independence
  const [acks, setAcks] = useState<IndependenceRule[]>([]);

  const entityDetail = useQuery({
    queryKey: ['entity', entity?.id],
    queryFn: () => apiFetch<EntityDetail>(`/entities/${entity!.id}`),
    enabled: !!entity,
  });
  const streamCatalogue = useQuery({
    queryKey: ['streams'],
    queryFn: () => apiFetch<StreamCatalogueEntry[]>('/streams'),
    staleTime: 10 * 60 * 1000,
  });
  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
  });
  const services = useQuery({
    queryKey: ['services', 'all'],
    queryFn: () => apiFetch<Paginated<ServiceOption>>('/services?limit=100'),
    enabled: kind === 'assignment',
  });

  // What the client already has — drives "Add a year / stream to CR/…".
  const existing = useQuery({
    queryKey: ['independence-check', entity?.id, 'existing'],
    queryFn: () =>
      apiFetch<IndependenceCheckResult>('/engagements/independence-check', {
        method: 'POST',
        body: { entityId: entity!.id, kind: 'compliance', financialYears: [currentFy] },
      }),
    enabled: !!entity,
  });
  const openCompliance = existing.data?.openComplianceEngagement ?? null;

  const checkYears = kind === 'compliance' ? years.map((y) => y.financialYear) : [financialYear];
  const checkReady =
    !!entity &&
    !!kind &&
    checkYears.every((fy) => FY_RE.test(fy)) &&
    (kind !== 'compliance' || streams.length > 0) &&
    (kind !== 'assignment' || !!serviceId);
  const check = useQuery({
    queryKey: ['independence-check', entity?.id, kind, checkYears, streams, serviceId],
    queryFn: () =>
      apiFetch<IndependenceCheckResult>('/engagements/independence-check', {
        method: 'POST',
        body: {
          entityId: entity!.id,
          kind,
          financialYears: checkYears,
          ...(kind === 'compliance' ? { streams } : {}),
          ...(kind === 'assignment' ? { serviceId } : {}),
        },
      }),
    enabled: checkReady && step >= 2,
  });
  const findings = check.data?.findings ?? [];
  const block = check.data?.block ?? null;
  const needAck = findings.filter((f) => f.requiresAcknowledgement);
  const acksOk = needAck.every((f) => acks.includes(f.rule));

  const people = employees.data?.items ?? [];
  const partners = people.filter((p) => p.gradeSlug === 'partner');
  const managers = people.filter((p) => p.gradeSlug === 'partner' || p.gradeSlug === 'manager');
  const personName = (id: string): string => people.find((p) => p.id === id)?.fullName ?? '—';

  const assignmentServices = (services.data?.items ?? []).filter(
    (s) =>
      s.isActive &&
      (s.engagementKind
        ? s.engagementKind === 'assignment'
        : !/^(STAT_AUDIT|STREAM_)/.test(s.code)),
  );

  /** The client's registrations a stream can run on (pre-ticked on first pick). */
  const registrationsFor = (stream: Stream) => {
    const types = STREAM_REGISTRATION_TYPES[stream];
    return (entityDetail.data?.registrations ?? []).filter((r) =>
      types.includes(r.registrationType.toLowerCase()),
    );
  };

  const toggleStream = (s: Stream): void => {
    setStreams((prev) => {
      if (prev.includes(s)) return prev.filter((x) => x !== s);
      if (registrations[s] === undefined) {
        const ids = registrationsFor(s)
          .filter((r) => r.status === 'active')
          .map((r) => r.id);
        if (ids.length > 0) setRegistrations((m) => ({ ...m, [s]: ids }));
      }
      return [...prev, s];
    });
    setAcks([]);
  };
  const toggleRegistration = (s: Stream, id: string): void =>
    setRegistrations((m) => {
      const cur = m[s] ?? [];
      return { ...m, [s]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  const addYear = (delta: -1 | 1): void =>
    setYears((ys) => {
      const sorted = [...ys].sort((a, b) => a.financialYear.localeCompare(b.financialYear));
      const edge = delta < 0 ? sorted[0] : sorted[sorted.length - 1];
      const fy = shiftFinancialYear(edge?.financialYear ?? currentFy, delta);
      return [...ys, { financialYear: fy, fee: '' }].sort((a, b) =>
        a.financialYear.localeCompare(b.financialYear),
      );
    });

  const create = useMutation({
    mutationFn: () => {
      const common = {
        entityId: entity!.id,
        kind,
        status,
        engagementPartnerEmployeeId: partnerId || undefined,
        engagementManagerEmployeeId: managerId || undefined,
        acknowledgedIndependenceRules: acks.length > 0 ? acks : undefined,
      };
      const body =
        kind === 'compliance'
          ? {
              ...common,
              financialYear: years[0]!.financialYear,
              engagementType: 'recurring_compliance',
              years: years.map((y) => ({
                financialYear: y.financialYear,
                feeAmount: y.fee.trim() === '' ? undefined : Number(y.fee),
              })),
              streams,
              streamRegistrations: Object.fromEntries(
                streams
                  .filter((s) => registrations[s] !== undefined)
                  .map((s) => [s, registrations[s]]),
              ),
              streamLeads: Object.fromEntries(
                streams.filter((s) => leads[s]).map((s) => [s, leads[s]]),
              ),
            }
          : kind === 'statutory_audit'
            ? { ...common, financialYear, periodLabel: 'FY', engagementType: 'audit' }
            : {
                ...common,
                financialYear,
                periodLabel: periodLabel || 'FY',
                serviceId,
                engagementType: 'one_time_assignment',
              };
      return apiFetch<{ id: string }>('/engagements', { method: 'POST', body });
    },
    onSuccess: (data) => {
      toast('Engagement created.');
      qc.invalidateQueries({ queryKey: ['engagements'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      router.push(`/engagements/${data.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body?.rule === 'COMPLIANCE_ENGAGEMENT_EXISTS') {
        toast(err.message, 'error');
        router.push(`/engagements/${String(err.body.engagementId)}?tab=services`);
        return;
      }
      toast(err instanceof ApiError ? err.message : 'Could not create the engagement.', 'error');
    },
  });

  const detailsOk =
    kind === 'compliance'
      ? years.length > 0 &&
        years.every((y) => FY_RE.test(y.financialYear) && (y.fee === '' || Number(y.fee) >= 0)) &&
        streams.length > 0
      : kind === 'assignment'
        ? FY_RE.test(financialYear) && !!serviceId
        : FY_RE.test(financialYear);
  const canNext =
    (step === 0 && !!entity) ||
    (step === 1 && !!kind && !(kind === 'compliance' && openCompliance)) ||
    (step === 2 && detailsOk);
  const canSubmit = detailsOk && !block && acksOk && !check.isFetching && !create.isPending;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        back={{ href: '/engagements', label: 'Engagements' }}
        title="New engagement"
        subtitle="Pick the client, then the kind of engagement — Statutory Audit, Compliance or another assignment."
      />

      <ol className="mb-5 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                i <= step ? 'bg-primary-600 text-white' : 'bg-surface-sunken text-ink-faint',
              )}
            >
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span
              className={cn('text-sm', i === step ? 'font-semibold text-ink' : 'text-ink-muted')}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line-strong" />}
          </li>
        ))}
      </ol>

      <Card>
        <CardBody className="space-y-4">
          {step === 0 && (
            <Field label="Client entity" required>
              <EntityPicker
                value={entity}
                onChange={(v) => {
                  setEntity(v);
                  setRegistrations({});
                  setAcks([]);
                }}
                exclude={new Set()}
              />
            </Field>
          )}

          {step === 1 && (
            <div className="space-y-3" role="radiogroup" aria-label="Engagement kind">
              {existing.isLoading && <Spinner label="Checking the client’s engagements…" />}
              {KIND_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                if (opt.kind === 'compliance' && openCompliance) {
                  return (
                    <Link
                      key={opt.kind}
                      href={`/engagements/${openCompliance.id}?tab=services`}
                      className="flex items-start gap-3 rounded-xl border border-line-strong p-4 transition hover:border-primary-400 hover:bg-surface-raised"
                    >
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
                      <span>
                        <span className="block font-semibold text-ink">
                          Add a year / stream to {openCompliance.engagementCode}
                        </span>
                        <span className="block text-sm text-ink-muted">
                          This client already has its standing Compliance engagement. Years and
                          streams are added there.
                        </span>
                      </span>
                      <ChevronRight className="ml-auto mt-0.5 h-4 w-4 text-ink-faint" />
                    </Link>
                  );
                }
                const selected = kind === opt.kind;
                return (
                  <button
                    key={opt.kind}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setKind(opt.kind);
                      setAcks([]);
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition',
                      selected
                        ? 'border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/30'
                        : 'border-line-strong hover:bg-surface-raised',
                    )}
                  >
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
                    <span>
                      <span className="block font-semibold text-ink">{opt.title}</span>
                      <span className="block text-sm text-ink-muted">{opt.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && kind === 'statutory_audit' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Financial year audited" required hint="Format 2026-27">
                  <Input
                    value={financialYear}
                    onChange={(e) => setFinancialYear(e.target.value)}
                    placeholder="2026-27"
                  />
                </Field>
                <StatusField value={status} onChange={setStatus} />
              </div>
              <LeadFields
                partners={partners}
                managers={managers}
                partnerId={partnerId}
                managerId={managerId}
                onPartner={setPartnerId}
                onManager={setManagerId}
              />
              <p className="text-sm text-ink-muted">
                The service is fixed to <strong className="text-ink">Statutory Audit</strong>; the
                review model follows from it.
              </p>
            </>
          )}

          {step === 2 && kind === 'assignment' && (
            <>
              <Field label="Service" required>
                {services.isLoading ? (
                  <Spinner label="Loading services…" />
                ) : (
                  <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                    <option value="">Select the service…</option>
                    {assignmentServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.serviceLineName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Financial year" required>
                  <Input
                    value={financialYear}
                    onChange={(e) => setFinancialYear(e.target.value)}
                    placeholder="2026-27"
                  />
                </Field>
                <Field label="Period" hint="FY, Q1, Apr-2026…">
                  <Input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} />
                </Field>
                <StatusField value={status} onChange={setStatus} />
              </div>
              <LeadFields
                partners={partners}
                managers={managers}
                partnerId={partnerId}
                managerId={managerId}
                onPartner={setPartnerId}
                onManager={setManagerId}
              />
            </>
          )}

          {step === 2 && kind === 'compliance' && (
            <>
              <Field label="Years in scope" required hint="Fee per year is optional.">
                <div className="space-y-2">
                  {years.map((y, i) => (
                    <div key={y.financialYear + i} className="flex items-center gap-2">
                      <Input
                        aria-label="Financial year"
                        className="w-28"
                        value={y.financialYear}
                        onChange={(e) =>
                          setYears((ys) =>
                            ys.map((x, j) =>
                              j === i ? { ...x, financialYear: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label={`Fee for ${y.financialYear}`}
                        className="flex-1"
                        inputMode="decimal"
                        placeholder="Fee (₹)"
                        value={y.fee}
                        onChange={(e) =>
                          setYears((ys) =>
                            ys.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)),
                          )
                        }
                      />
                      {years.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove ${y.financialYear}`}
                          className="text-ink-faint hover:text-danger-600"
                          onClick={() => setYears((ys) => ys.filter((_, j) => j !== i))}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => addYear(-1)}>
                      <Plus className="h-3.5 w-3.5" /> Earlier year
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => addYear(1)}>
                      <Plus className="h-3.5 w-3.5" /> Later year
                    </Button>
                  </div>
                </div>
              </Field>

              <Field label="Streams" required>
                {streamCatalogue.isLoading ? (
                  <Spinner label="Loading streams…" />
                ) : (
                  <div className="space-y-2">
                    {(streamCatalogue.data ?? []).map((sc) => {
                      const on = streams.includes(sc.stream);
                      const regs = registrationsFor(sc.stream);
                      const byEntity = STREAM_REGISTRATION_TYPES[sc.stream].includes('entity');
                      return (
                        <div key={sc.stream} className="rounded-lg border border-line-strong">
                          <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleStream(sc.stream)}
                              className="h-4 w-4 accent-primary-600"
                            />
                            <span className="text-sm font-medium text-ink">{sc.label}</span>
                            <span className="text-xs text-ink-faint">
                              {byEntity
                                ? 'runs on the entity'
                                : `runs on ${STREAM_REGISTRATION_TYPES[sc.stream].join(' / ').toUpperCase()}`}
                            </span>
                          </label>
                          {on && (
                            <div className="space-y-2 border-t border-line px-3 py-2">
                              {!byEntity &&
                                (regs.length === 0 ? (
                                  <p className="text-xs text-warning-700">
                                    No{' '}
                                    {STREAM_REGISTRATION_TYPES[sc.stream].join(' / ').toUpperCase()}{' '}
                                    on the client record yet — add it on the client, then tick it on
                                    the Services tab.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {regs.map((r) => (
                                      <label
                                        key={r.id}
                                        className="flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-xs"
                                      >
                                        <input
                                          type="checkbox"
                                          className="h-3.5 w-3.5 accent-primary-600"
                                          checked={(registrations[sc.stream] ?? []).includes(r.id)}
                                          onChange={() => toggleRegistration(sc.stream, r.id)}
                                        />
                                        <span className="font-mono">{r.registrationNumber}</span>
                                        {r.stateCode && (
                                          <span className="text-ink-faint">· {r.stateCode}</span>
                                        )}
                                        {r.status !== 'active' && (
                                          <span className="text-ink-faint">
                                            · {humanize(r.status)}
                                          </span>
                                        )}
                                      </label>
                                    ))}
                                  </div>
                                ))}
                              <label className="flex items-center gap-2 text-xs text-ink-muted">
                                Stream lead
                                <Select
                                  aria-label={`${sc.label} lead`}
                                  className="max-w-xs py-1 text-xs"
                                  value={leads[sc.stream] ?? ''}
                                  onChange={(e) =>
                                    setLeads((m) => ({ ...m, [sc.stream]: e.target.value }))
                                  }
                                >
                                  <option value="">— not set —</option>
                                  {people.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.fullName} · {p.gradeName}
                                    </option>
                                  ))}
                                </Select>
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Field>
              <LeadFields
                partners={partners}
                managers={managers}
                partnerId={partnerId}
                managerId={managerId}
                onPartner={setPartnerId}
                onManager={setManagerId}
              />
            </>
          )}

          {step === 2 && checkReady && (
            <IndependencePanel
              loading={check.isFetching}
              findings={findings}
              acks={acks}
              onAck={(rule, on) =>
                setAcks((a) => (on ? [...new Set([...a, rule])] : a.filter((x) => x !== rule)))
              }
            />
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm">
              <Row label="Client" value={entity?.label ?? '—'} />
              <Row label="Kind" value={KIND_OPTIONS.find((k) => k.kind === kind)?.title ?? '—'} />
              {kind === 'compliance' ? (
                <>
                  <Row
                    label="Years in scope"
                    value={years
                      .map((y) => (y.fee ? `${y.financialYear} (₹${y.fee})` : y.financialYear))
                      .join(', ')}
                  />
                  <div className="flex justify-between gap-4">
                    <span className="text-ink-faint">Streams</span>
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {streams.map((s) => (
                        <Badge key={s} tone="info">
                          {STREAM_LABEL[s]}
                          {(registrations[s]?.length ?? 0) > 0 && ` · ${registrations[s]!.length}`}
                        </Badge>
                      ))}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <Row label="Financial year" value={financialYear} />
                  {kind === 'assignment' && (
                    <Row
                      label="Service"
                      value={assignmentServices.find((s) => s.id === serviceId)?.name ?? '—'}
                    />
                  )}
                  <Row label="Status" value={humanize(status)} />
                </>
              )}
              <Row
                label="Partner"
                value={partnerId ? personName(partnerId) : 'You (if accepted)'}
              />
              <Row label="Manager" value={managerId ? personName(managerId) : '—'} />
              {block && (
                <p className="flex gap-2 rounded-lg bg-danger-50 p-3 text-danger-700">
                  <ShieldAlert className="h-4 w-4 shrink-0" /> {block.message}
                </p>
              )}
              {!acksOk && (
                <p className="text-warning-700">
                  Go back and tick the acknowledgement before creating.
                </p>
              )}
              {kind === 'compliance' && (
                <p className="text-ink-muted">
                  Creating it builds the filing calendar for every year in scope.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => (step === 0 ? router.back() : setStep((s) => s - 1))}
            >
              {step === 0 ? (
                'Cancel'
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4" /> Back
                </>
              )}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                disabled={!canNext || (step === 2 && (!!block || !acksOk))}
                onClick={() => setStep((s) => s + 1)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button disabled={!canSubmit} onClick={() => create.mutate()}>
                <Play className="h-4 w-4" />
                {create.isPending ? 'Creating…' : 'Create engagement'}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function StatusField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <Field
      label="Initial status"
      hint="“Accepted” makes you the Engagement Partner if none is set."
    >
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ENGAGEMENT_STATUS.prospect}>Prospect</option>
        <option value={ENGAGEMENT_STATUS.pendingAcceptance}>Pending Acceptance</option>
        <option value={ENGAGEMENT_STATUS.accepted}>Accepted</option>
      </Select>
    </Field>
  );
}

function LeadFields({
  partners,
  managers,
  partnerId,
  managerId,
  onPartner,
  onManager,
}: {
  partners: EmployeeRow[];
  managers: EmployeeRow[];
  partnerId: string;
  managerId: string;
  onPartner: (v: string) => void;
  onManager: (v: string) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label="Engagement partner">
        <Select value={partnerId} onChange={(e) => onPartner(e.target.value)}>
          <option value="">Me (default)</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName} · {p.officeCode}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Engagement manager">
        <Select value={managerId} onChange={(e) => onManager(e.target.value)}>
          <option value="">— not set —</option>
          {managers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName} · {p.gradeName}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** The independence rules for what is being created (spec Change 1). */
export function IndependencePanel({
  loading,
  findings,
  acks,
  onAck,
}: {
  loading: boolean;
  findings: IndependenceFinding[];
  acks: IndependenceRule[];
  onAck: (rule: IndependenceRule, on: boolean) => void;
}): JSX.Element {
  const shown = findings.filter((f) => f.outcome !== 'pass');
  return (
    <div className="rounded-lg border border-line-strong p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Independence check {loading && <span className="normal-case">· checking…</span>}
      </p>
      {!loading && shown.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-success-700">
          <Check className="h-4 w-4" /> No conflicts with the firm’s other engagements for this
          client.
        </p>
      )}
      <ul className="space-y-2">
        {shown.map((f, i) => (
          <li
            key={`${f.rule}-${f.financialYear ?? ''}-${i}`}
            className={cn(
              'rounded-md p-2 text-sm',
              f.outcome === 'block'
                ? 'bg-danger-50 text-danger-700'
                : 'bg-warning-50 text-warning-700',
            )}
          >
            <span className="flex gap-2">
              {f.outcome === 'block' ? (
                <ShieldAlert className="h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              )}
              <span>
                {f.message}
                {f.financialYear && <span className="opacity-75"> ({f.financialYear})</span>}
              </span>
            </span>
            {f.requiresAcknowledgement && (
              <label className="mt-2 flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary-600"
                  checked={acks.includes(f.rule)}
                  onChange={(e) => onAck(f.rule, e.target.checked)}
                />
                I acknowledge this as the engagement partner (recorded in Activity).
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-faint">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}

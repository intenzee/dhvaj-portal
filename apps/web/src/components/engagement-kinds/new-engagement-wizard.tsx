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
  FIRM_CHECK,
  PENDING_REGISTRATION_STREAMS,
  PERMISSION,
  STREAM_LABEL,
  STREAM_PRIOR_FILED_GRAIN,
  STREAM_REGISTRATION_TYPES,
  fyMonthKeys,
  type EngagementKind,
  type FeePeriod,
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
import { useAuth } from '@/lib/auth';
import { FeeInput } from '@/components/billing/fee-input';
import { can } from '@/lib/principal';
import { useFirmChecks } from '@/lib/firm-checks';
import type { EmployeeRow, EngagementLeadRow, EntityDetail } from '@/lib/types';
import { EntityPicker, type Picked } from '@/components/entity-picker';
import { PageHeader, Card, CardBody, Button, Spinner, Badge } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { cn } from '@/lib/cn';
import { ExpandToggle } from '@/components/inline-panel';
import { AddGstinDialog } from '@/components/filing/add-gstin-dialog';
import { PriorFiledPicker } from '@/components/filing/prior-filed-picker';
import { todayIst } from '@/components/work/my-task-columns';
import { useClientTeamDefaults } from '@/components/teams/wizard-team-defaults';

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
  /** CM-4 · what period the fee is for. */
  feePeriod: FeePeriod;
}

/** Indian FY containing `d`, e.g. "2026-27" (the year rolls over in April). */
export function financialYearOf(d: Date): string {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
/**
 * The "filed before the portal" tokens worth sending: streams still picked,
 * months and annual returns of years still in scope (pure; exported for tests).
 */
export function priorFiledFor(
  picked: Partial<Record<Stream, string[]>>,
  streams: readonly Stream[],
  years: readonly string[],
): Partial<Record<Stream, string[]>> {
  const ok = new Set(years.flatMap((fy) => [...fyMonthKeys(fy), `FY:${fy}`]));
  const out: Partial<Record<Stream, string[]>> = {};
  for (const s of streams) {
    const tokens = (picked[s] ?? []).filter((t) => ok.has(t));
    if (tokens.length > 0) out[s] = tokens;
  }
  return out;
}

/** "6 months", "2 quarters + annual" — what a stream's tokens come to. */
export function priorFiledSummary(stream: Stream, tokens: readonly string[]): string {
  const months = tokens.filter((t) => !t.startsWith('FY:')).length;
  const years = tokens.length - months;
  const parts: string[] = [];
  if (months > 0) {
    if (STREAM_PRIOR_FILED_GRAIN[stream] === 'quarter') {
      const q = Math.floor(months / 3);
      parts.push(`${q} quarter${q === 1 ? '' : 's'}`);
    } else parts.push(`${months} month${months === 1 ? '' : 's'}`);
  }
  if (years > 0) parts.push(years === 1 ? 'annual' : `${years} years’ annual`);
  return parts.join(' + ');
}

/** The FY `delta` years away from `fy`. */
export function shiftFinancialYear(fy: string, delta: number): string {
  const start = Number(fy.slice(0, 4)) + delta;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const STEPS = ['Client & kind', 'Details'] as const;
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
 * "New engagement" with kinds (spec Change 1, creation flow), in two steps:
 * the client and the kind, then the kind's details with the independence check
 * and Create. A client with an open Compliance engagement is offered "Add a
 * year / stream" on it instead of a second one.
 *
 * The firm's checks decide what is asked for: with engagement_partner_required
 * off an accepted engagement needs no partner picked (it defaults to a
 * creating partner, else is left for later); with independence_ack_required
 * off the warnings are shown for information and need no tick.
 */
export function NewEngagementWizard(): JSX.Element {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const checks = useFirmChecks();
  const partnerRequired = checks[FIRM_CHECK.engagementPartnerRequired];
  const ackRequired = checks[FIRM_CHECK.independenceAckRequired];
  const currentFy = financialYearOf(new Date());

  const [step, setStep] = useState(0);
  const [entity, setEntity] = useState<Picked | null>(null);
  const [kind, setKind] = useState<EngagementKind | null>(null);

  // Shared
  const [financialYear, setFinancialYear] = useState(currentFy);
  // Anyone may create an engagement; only those who manage engagements may
  // create it already accepted — for everyone else it waits for the EP.
  const canAccept = can(principal, PERMISSION.engagementManage);
  const [statusChoice, setStatus] = useState<string>(ENGAGEMENT_STATUS.accepted);
  const status =
    !canAccept && statusChoice === ENGAGEMENT_STATUS.accepted
      ? ENGAGEMENT_STATUS.pendingAcceptance
      : statusChoice;
  const [partnerId, setPartnerId] = useState('');
  const [managerId, setManagerId] = useState('');
  // Assignment
  const [serviceId, setServiceId] = useState('');
  const [periodLabel, setPeriodLabel] = useState('FY');
  // Compliance
  const [years, setYears] = useState<YearDraft[]>([
    { financialYear: currentFy, fee: '', feePeriod: 'annual' },
  ]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [registrations, setRegistrations] = useState<Partial<Record<Stream, string[]>>>({});
  const [leads, setLeads] = useState<Partial<Record<Stream, string>>>({});
  // Filed before the portal: {stream: tokens} and which streams show the picker.
  const [priorFiled, setPriorFiled] = useState<Partial<Record<Stream, string[]>>>({});
  const [priorOpen, setPriorOpen] = useState<Partial<Record<Stream, boolean>>>({});
  const [gstinFor, setGstinFor] = useState<Stream | null>(null);
  // Independence
  const [acks, setAcks] = useState<IndependenceRule[]>([]);

  const canManageClients = can(principal, PERMISSION.entityManage);
  const entityDetail = useQuery({
    queryKey: ['entity', entity?.id],
    queryFn: () => apiFetch<EntityDetail>(`/entities/${entity!.id}`),
    enabled: !!entity,
  });
  const teamDefaults = useClientTeamDefaults(
    entity ? entityDetail.data?.team : null,
    partnerId,
    setPartnerId,
  );
  const streamCatalogue = useQuery({
    queryKey: ['streams'],
    queryFn: () => apiFetch<StreamCatalogueEntry[]>('/streams'),
    staleTime: 10 * 60 * 1000,
  });
  const employees = useQuery({
    // Only people still with the firm can lead or staff a new engagement.
    queryKey: ['employees', 'active'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100&status=active'),
  });
  // EP / manager candidates come from every office, not just the caller's.
  const leadCandidates = useQuery({
    queryKey: ['employees', 'leads'],
    queryFn: () => apiFetch<EngagementLeadRow[]>('/employees/leads'),
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
    enabled: checkReady && step >= 1,
  });
  const findings = check.data?.findings ?? [];
  const block = check.data?.block ?? null;
  const needAck = findings.filter((f) => f.requiresAcknowledgement);
  const acksOk = !ackRequired || needAck.every((f) => acks.includes(f.rule));

  const people = employees.data?.items ?? [];
  const managers = leadCandidates.data ?? [];
  const partners = managers.filter((p) => p.isPartner);
  const personName = (id: string): string =>
    (managers.find((p) => p.id === id) ?? people.find((p) => p.id === id))?.fullName ?? '—';
  // The API makes the creator the EP only when they are partner-grade; anyone
  // else must pick a partner before an accepted engagement can be created —
  // unless the firm has the engagement_partner_required check off.
  const meIsPartner =
    !!principal?.employeeId && partners.some((p) => p.id === principal.employeeId);
  const needsPartner =
    partnerRequired && status === ENGAGEMENT_STATUS.accepted && !partnerId && !meIsPartner;

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
      return [
        ...ys,
        { financialYear: fy, fee: '', feePeriod: ys[ys.length - 1]?.feePeriod ?? 'annual' },
      ].sort((a, b) => a.financialYear.localeCompare(b.financialYear));
    });

  const validYears = years.map((y) => y.financialYear).filter((fy) => FY_RE.test(fy));
  const priorToSend = priorFiledFor(priorFiled, streams, validYears);

  /** The client's GSTIN, added from the wizard; then ticked for the stream. */
  const addGstin = async (stream: Stream, gstin: string): Promise<void> => {
    const detail = await apiFetch<EntityDetail>(`/entities/${entity!.id}/registrations`, {
      method: 'POST',
      body: { registrationType: 'gstin', registrationNumber: gstin, stateCode: gstin.slice(0, 2) },
    });
    qc.setQueryData(['entity', entity!.id], detail);
    const added = detail.registrations.find(
      (r) => r.registrationType.toLowerCase() === 'gstin' && r.registrationNumber === gstin,
    );
    if (added) {
      setRegistrations((m) => ({ ...m, [stream]: [...(m[stream] ?? []), added.id] }));
    }
    toast(`GSTIN ${gstin} added to the client.`);
  };

  const create = useMutation({
    mutationFn: () => {
      const common = {
        entityId: entity!.id,
        kind,
        status,
        engagementPartnerEmployeeId: partnerId || undefined,
        engagementManagerEmployeeId: managerId || undefined,
        acknowledgedIndependenceRules: acks.length > 0 ? acks : undefined,
        teamMemberEmployeeIds:
          teamDefaults.memberIds.length > 0 ? teamDefaults.memberIds : undefined,
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
                ...(y.fee.trim() === '' ? {} : { feePeriod: y.feePeriod }),
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
              ...(Object.keys(priorToSend).length > 0 ? { priorFiled: priorToSend } : {}),
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

  const kindDetailsOk =
    kind === 'compliance'
      ? years.length > 0 &&
        years.every((y) => FY_RE.test(y.financialYear) && (y.fee === '' || Number(y.fee) >= 0)) &&
        streams.length > 0
      : kind === 'assignment'
        ? FY_RE.test(financialYear) && !!serviceId
        : FY_RE.test(financialYear);
  const detailsOk = kindDetailsOk && !needsPartner;
  const canNext = !!entity && !!kind && !(kind === 'compliance' && openCompliance);
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

      {gstinFor && entity && (
        <AddGstinDialog
          clientName={entity.label}
          onClose={() => setGstinFor(null)}
          onSave={(gstin) => addGstin(gstinFor, gstin)}
        />
      )}

      <Card>
        <CardBody className="space-y-4">
          {step === 0 && (
            <Field label="Client entity" required>
              <EntityPicker
                value={entity}
                onChange={(v) => {
                  setEntity(v);
                  setRegistrations({});
                  setPriorFiled({});
                  setAcks([]);
                }}
                exclude={new Set()}
              />
            </Field>
          )}

          {step === 0 && entity && (
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

          {step === 1 && teamDefaults.panel}

          {step === 1 && kind === 'statutory_audit' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Financial year audited" required hint="Format 2026-27">
                  <Input
                    value={financialYear}
                    onChange={(e) => setFinancialYear(e.target.value)}
                    placeholder="2026-27"
                  />
                </Field>
                <StatusField
                  value={status}
                  onChange={setStatus}
                  meIsPartner={meIsPartner}
                  canAccept={canAccept}
                  partnerRequired={partnerRequired}
                />
              </div>
              <LeadFields
                partners={partners}
                managers={managers}
                partnerId={partnerId}
                managerId={managerId}
                meIsPartner={meIsPartner}
                partnerRequired={needsPartner}
                onPartner={setPartnerId}
                onManager={setManagerId}
              />
              <p className="text-sm text-ink-muted">
                The service is fixed to <strong className="text-ink">Statutory Audit</strong>; the
                review model follows from it.
              </p>
            </>
          )}

          {step === 1 && kind === 'assignment' && (
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
                <StatusField
                  value={status}
                  onChange={setStatus}
                  meIsPartner={meIsPartner}
                  canAccept={canAccept}
                  partnerRequired={partnerRequired}
                />
              </div>
              <LeadFields
                partners={partners}
                managers={managers}
                partnerId={partnerId}
                managerId={managerId}
                meIsPartner={meIsPartner}
                partnerRequired={needsPartner}
                onPartner={setPartnerId}
                onManager={setManagerId}
              />
            </>
          )}

          {step === 1 && kind === 'compliance' && (
            <>
              <Field label="Years in scope" required hint="Fee per year is optional.">
                <div className="space-y-2">
                  {years.map((y, i) => (
                    <div key={y.financialYear + i} className="flex items-start gap-2">
                      <Input
                        aria-label="Financial year"
                        className="mt-6 w-28"
                        value={y.financialYear}
                        onChange={(e) =>
                          setYears((ys) =>
                            ys.map((x, j) =>
                              j === i ? { ...x, financialYear: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <FeeInput
                          id={`fee-${i}`}
                          label={`Fee for ${y.financialYear}`}
                          amount={y.fee}
                          period={y.feePeriod}
                          onAmount={(v) =>
                            setYears((ys) => ys.map((x, j) => (j === i ? { ...x, fee: v } : x)))
                          }
                          onPeriod={(p) =>
                            setYears((ys) =>
                              ys.map((x, j) => (j === i ? { ...x, feePeriod: p } : x)),
                            )
                          }
                        />
                      </div>
                      {years.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove ${y.financialYear}`}
                          className="mt-8 text-ink-faint hover:text-danger-600"
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
                                  PENDING_REGISTRATION_STREAMS.includes(sc.stream) ? (
                                    <div className="flex flex-wrap items-center gap-2 rounded-md bg-warning-50 px-2 py-1.5 text-xs text-warning-700">
                                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                      <span className="min-w-0 flex-1">
                                        GSTIN missing — the {sc.label} months are built without it,
                                        and the {sc.label} tab asks for it until it is filled in.
                                      </span>
                                      {canManageClients && (
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => setGstinFor(sc.stream)}
                                        >
                                          Add GSTIN now
                                        </Button>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-warning-700">
                                      No{' '}
                                      {STREAM_REGISTRATION_TYPES[sc.stream]
                                        .join(' / ')
                                        .toUpperCase()}{' '}
                                      on the client record yet — add it on the client, then tick it
                                      on the Services tab.
                                    </p>
                                  )
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
                              <div className="space-y-2">
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
                                  aria-expanded={!!priorOpen[sc.stream]}
                                  onClick={() =>
                                    setPriorOpen((m) => ({ ...m, [sc.stream]: !m[sc.stream] }))
                                  }
                                >
                                  <ExpandToggle open={!!priorOpen[sc.stream]} />
                                  Already filed before the portal?
                                  {(priorToSend[sc.stream]?.length ?? 0) > 0 && (
                                    <span className="text-success-700">
                                      {priorFiledSummary(sc.stream, priorToSend[sc.stream]!)} ticked
                                    </span>
                                  )}
                                </button>
                                {priorOpen[sc.stream] && (
                                  <div className="rounded-md bg-surface-sunken p-2">
                                    <p className="mb-2 text-xs text-ink-muted">
                                      Tick the periods the client already filed — they are created
                                      as Filed, so they never show overdue.
                                    </p>
                                    <PriorFiledPicker
                                      stream={sc.stream}
                                      financialYears={validYears}
                                      value={priorFiled[sc.stream] ?? []}
                                      onChange={(tokens) =>
                                        setPriorFiled((m) => ({ ...m, [sc.stream]: tokens }))
                                      }
                                      today={todayIst()}
                                      label={`${sc.label} filed before the portal`}
                                    />
                                  </div>
                                )}
                              </div>
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
                meIsPartner={meIsPartner}
                partnerRequired={needsPartner}
                onPartner={setPartnerId}
                onManager={setManagerId}
              />
            </>
          )}

          {step === 1 && checkReady && (
            <IndependencePanel
              loading={check.isFetching}
              findings={findings}
              ackRequired={ackRequired}
              acks={acks}
              onAck={(rule, on) =>
                setAcks((a) => (on ? [...new Set([...a, rule])] : a.filter((x) => x !== rule)))
              }
            />
          )}

          {step === 1 && (
            <div className="space-y-2 rounded-lg bg-surface-sunken p-3 text-sm">
              <Row label="Client" value={entity?.label ?? '—'} />
              <Row label="Kind" value={KIND_OPTIONS.find((k) => k.kind === kind)?.title ?? '—'} />
              {kind === 'compliance' && streams.length > 0 && (
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
              )}
              {kind === 'compliance' && Object.keys(priorToSend).length > 0 && (
                <Row
                  label="Filed before the portal"
                  value={(Object.keys(priorToSend) as Stream[])
                    .map((s) => `${STREAM_LABEL[s]}: ${priorFiledSummary(s, priorToSend[s]!)}`)
                    .join(' · ')}
                />
              )}
              {kind !== 'compliance' && <Row label="Status" value={humanize(status)} />}
              <Row
                label="Partner"
                value={
                  partnerId
                    ? personName(partnerId)
                    : meIsPartner
                      ? 'You (if accepted)'
                      : partnerRequired
                        ? '—'
                        : 'None yet — add one later'
                }
              />
              {managerId && <Row label="Manager" value={personName(managerId)} />}
              {block && (
                <p className="flex gap-2 rounded-lg bg-danger-50 p-3 text-danger-700">
                  <ShieldAlert className="h-4 w-4 shrink-0" /> {block.message}
                </p>
              )}
              {!acksOk && (
                <p className="text-warning-700">Tick the acknowledgement above before creating.</p>
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
              <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
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
  meIsPartner,
  canAccept,
  partnerRequired,
}: {
  value: string;
  onChange: (v: string) => void;
  meIsPartner: boolean;
  canAccept: boolean;
  partnerRequired: boolean;
}): JSX.Element {
  return (
    <Field
      label="Initial status"
      hint={
        !canAccept
          ? 'The Engagement Partner you pick accepts it.'
          : meIsPartner
            ? '“Accepted” makes you the Engagement Partner if none is set.'
            : partnerRequired
              ? '“Accepted” needs an Engagement Partner — pick one below.'
              : 'A partner can be picked now or later.'
      }
    >
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ENGAGEMENT_STATUS.prospect}>Prospect</option>
        <option value={ENGAGEMENT_STATUS.pendingAcceptance}>Pending Acceptance</option>
        {canAccept && <option value={ENGAGEMENT_STATUS.accepted}>Accepted</option>}
      </Select>
    </Field>
  );
}

function LeadFields({
  partners,
  managers,
  partnerId,
  managerId,
  meIsPartner,
  partnerRequired,
  onPartner,
  onManager,
}: {
  partners: EngagementLeadRow[];
  managers: EngagementLeadRow[];
  partnerId: string;
  managerId: string;
  meIsPartner: boolean;
  partnerRequired: boolean;
  onPartner: (v: string) => void;
  onManager: (v: string) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field
        label="Engagement partner"
        required={partnerRequired}
        hint={partnerRequired ? 'An accepted engagement needs one.' : undefined}
      >
        <Select value={partnerId} onChange={(e) => onPartner(e.target.value)}>
          <option value="">
            {meIsPartner ? 'Me (default)' : partnerRequired ? '— choose a partner —' : '— later —'}
          </option>
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
              {p.fullName} · {p.gradeName} · {p.officeCode}
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
  ackRequired = true,
  acks,
  onAck,
}: {
  loading: boolean;
  findings: IndependenceFinding[];
  /** The independence_ack_required check: off, warnings are for information. */
  ackRequired?: boolean;
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
                I acknowledge this as the engagement partner (recorded in Activity)
                {!ackRequired && <span className="text-ink-faint"> · optional</span>}
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

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Play, Plus, Search, X } from 'lucide-react';
import {
  BILLING_MODELS,
  ENGAGEMENT_CONFIDENTIALITIES,
  ENGAGEMENT_PRIORITIES,
  ENGAGEMENT_STATUS,
  ENGAGEMENT_TYPES,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { EntityRow } from '@/lib/types';
import { PageHeader, Card, CardBody, Button, Spinner, Badge } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

interface ServiceOption {
  id: string;
  code: string;
  name: string;
  serviceLineName: string;
}
interface CreatedEngagement {
  id: string;
}
type Picked = { id: string; label: string };

/** Sensible default Indian FY, e.g. "2026-27" (year rolls over in April). */
function currentFinancialYear(): string {
  const d = new Date();
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const STEPS = ['Client', 'Details', 'Services', 'Review'] as const;

/**
 * Guided engagement creation (spec §4/§41): a stepper that walks Client (with
 * optional group coverage) → Details → Services (one or more) → Review, creates
 * the engagement with all of it in one go, then offers to activate.
 */
export default function NewEngagementPage(): JSX.Element {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const [step, setStep] = useState(0);

  // Step 1 — client + group coverage
  const [entity, setEntity] = useState<Picked | null>(null);
  const [covered, setCovered] = useState<Picked[]>([]);

  // Step 2 — details
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());
  const [periodLabel, setPeriodLabel] = useState('FY');
  const [status, setStatus] = useState<string>(ENGAGEMENT_STATUS.accepted);
  const [engagementType, setEngagementType] = useState('recurring_compliance');
  const [priority, setPriority] = useState('normal');
  const [confidentiality, setConfidentiality] = useState('normal');
  const [currency, setCurrency] = useState('INR');
  const [billingModel, setBillingModel] = useState('');
  const [mandateRef, setMandateRef] = useState('');
  const [mandateDate, setMandateDate] = useState('');

  // Step 3 — services
  const [primaryService, setPrimaryService] = useState('');
  const [extraServices, setExtraServices] = useState<string[]>([]);

  const services = useQuery({
    queryKey: ['services', 'all'],
    queryFn: () => apiFetch<Paginated<ServiceOption>>('/services?limit=100'),
  });
  const serviceById = new Map((services.data?.items ?? []).map((s) => [s.id, s]));

  const create = useMutation({
    mutationFn: async (): Promise<CreatedEngagement> => {
      const eng = await apiFetch<CreatedEngagement>('/engagements', {
        method: 'POST',
        body: {
          entityId: entity!.id,
          serviceId: primaryService,
          financialYear,
          periodLabel: periodLabel || 'FY',
          status,
          engagementType,
          priority,
          confidentiality,
          currency: currency.toUpperCase() || 'INR',
          billingModel: billingModel || undefined,
          mandateLetterReference: mandateRef.trim() || undefined,
          mandateLetterDate: mandateDate || undefined,
        },
      });
      // Additional services & covered entities, best-effort in sequence.
      for (const sid of extraServices) {
        await apiFetch(`/engagements/${eng.id}/services`, {
          method: 'POST',
          body: { serviceId: sid },
        });
      }
      for (const c of covered) {
        await apiFetch(`/engagements/${eng.id}/entities`, {
          method: 'POST',
          body: { entityId: c.id, role: 'covered' },
        });
      }
      return eng;
    },
    onSuccess: (data) => {
      toast('Engagement created.');
      qc.invalidateQueries({ queryKey: ['engagements'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      router.push(`/engagements/${data.id}`);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not create the engagement.', 'error'),
  });

  const fyOk = /^[0-9]{4}-[0-9]{2}$/.test(financialYear);
  const canNext =
    (step === 0 && !!entity) ||
    (step === 1 && fyOk) ||
    (step === 2 && !!primaryService) ||
    step === 3;

  const toggleExtra = (id: string): void =>
    setExtraServices((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Create Engagement" subtitle="Guided setup — client, details, services." />

      {/* Stepper */}
      <ol className="mb-5 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                i < step
                  ? 'bg-primary-600 text-white'
                  : i === step
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-sunken text-ink-faint'
              }`}
            >
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span
              className={`text-sm ${i === step ? 'font-semibold text-ink' : 'text-ink-muted'}`}
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
            <>
              <Field label="Client entity" required>
                <EntityPicker value={entity} onChange={setEntity} exclude={new Set()} />
              </Field>
              <Field
                label="Also covered (group)"
                hint="Optional — add group entities this engagement also covers (§30)."
              >
                <div className="space-y-2">
                  {covered.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-lg border border-line-strong px-3 py-1.5 text-sm"
                    >
                      <span className="text-ink">{c.label}</span>
                      <button
                        onClick={() => setCovered((p) => p.filter((x) => x.id !== c.id))}
                        className="text-ink-faint hover:text-danger-600"
                        aria-label={`Remove ${c.label}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <EntityPicker
                    value={null}
                    onChange={(v) => v && setCovered((p) => [...p, v])}
                    exclude={new Set([entity?.id, ...covered.map((c) => c.id)].filter(Boolean) as string[])}
                    placeholder="Add a covered entity…"
                  />
                </div>
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Financial year" required hint="Format 2026-27">
                  <Input
                    value={financialYear}
                    onChange={(e) => setFinancialYear(e.target.value)}
                    placeholder="2026-27"
                  />
                </Field>
                <Field label="Period" hint="FY, Q1, Apr-2026…">
                  <Input
                    value={periodLabel}
                    onChange={(e) => setPeriodLabel(e.target.value)}
                    placeholder="FY"
                  />
                </Field>
              </div>
              <Field
                label="Initial status"
                hint="Choosing “Accepted” makes you the accountable Engagement Partner."
              >
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value={ENGAGEMENT_STATUS.prospect}>Prospect</option>
                  <option value={ENGAGEMENT_STATUS.pendingAcceptance}>Pending Acceptance</option>
                  <option value={ENGAGEMENT_STATUS.accepted}>Accepted (you become EP)</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Type">
                  <Select value={engagementType} onChange={(e) => setEngagementType(e.target.value)}>
                    {ENGAGEMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {humanize(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {ENGAGEMENT_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {humanize(p)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Confidentiality">
                  <Select
                    value={confidentiality}
                    onChange={(e) => setConfidentiality(e.target.value)}
                  >
                    {ENGAGEMENT_CONFIDENTIALITIES.map((c) => (
                      <option key={c} value={c}>
                        {humanize(c)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Billing model">
                  <Select value={billingModel} onChange={(e) => setBillingModel(e.target.value)}>
                    <option value="">—</option>
                    {BILLING_MODELS.map((b) => (
                      <option key={b} value={b}>
                        {humanize(b)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Currency" hint="ISO code">
                  <Input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    maxLength={3}
                    placeholder="INR"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Mandate letter ref" hint="Engagement-letter reference (optional)">
                  <Input value={mandateRef} onChange={(e) => setMandateRef(e.target.value)} />
                </Field>
                <Field label="Mandate letter date">
                  <Input
                    type="date"
                    value={mandateDate}
                    onChange={(e) => setMandateDate(e.target.value)}
                  />
                </Field>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {services.isLoading ? (
                <Spinner label="Loading services…" />
              ) : (
                <>
                  <Field label="Primary service" required>
                    <Select
                      value={primaryService}
                      onChange={(e) => {
                        setPrimaryService(e.target.value);
                        setExtraServices((p) => p.filter((x) => x !== e.target.value));
                      }}
                    >
                      <option value="">Select the primary service…</option>
                      {(services.data?.items ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {s.serviceLineName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Additional services"
                    hint="Optional — a single engagement can carry several services (§9–§10)."
                  >
                    <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-line-strong p-1">
                      {(services.data?.items ?? [])
                        .filter((s) => s.id !== primaryService)
                        .map((s) => (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-raised"
                          >
                            <input
                              type="checkbox"
                              checked={extraServices.includes(s.id)}
                              onChange={() => toggleExtra(s.id)}
                              className="h-4 w-4 accent-primary-600"
                            />
                            <span className="text-sm text-ink">{s.name}</span>
                            <span className="text-xs text-ink-faint">{s.serviceLineName}</span>
                          </label>
                        ))}
                    </div>
                  </Field>
                </>
              )}
            </>
          )}

          {step === 3 && (
            <div className="space-y-4 text-sm">
              <Row label="Client" value={entity?.label ?? '—'} />
              {covered.length > 0 && (
                <Row label="Also covered" value={covered.map((c) => c.label).join(', ')} />
              )}
              <Row label="Financial year" value={`${financialYear} · ${periodLabel || 'FY'}`} />
              <Row label="Status" value={humanize(status)} />
              <Row
                label="Type · Priority"
                value={`${humanize(engagementType)} · ${humanize(priority)}`}
              />
              <div className="border-t border-line pt-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Services
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="info">
                    {serviceById.get(primaryService)?.name ?? '—'} (primary)
                  </Badge>
                  {extraServices.map((id) => (
                    <Badge key={id} tone="neutral">
                      {serviceById.get(id)?.name ?? id}
                    </Badge>
                  ))}
                </div>
              </div>
              <p className="text-ink-muted">
                After creation you can run <strong className="text-ink">Discover &amp; add</strong>{' '}
                components and <strong className="text-ink">Activate</strong> the scope from the
                engagement page.
              </p>
            </div>
          )}

          {/* Nav */}
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
              <Button
                disabled={!primaryService || !entity || create.isPending}
                onClick={() => create.mutate()}
              >
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

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-faint">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}

/** Search-and-select a client entity. */
function EntityPicker({
  value,
  onChange,
  exclude,
  placeholder = 'Search clients by name or PAN…',
}: {
  value: Picked | null;
  onChange: (v: Picked | null) => void;
  exclude: Set<string>;
  placeholder?: string;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const q = useQuery({
    queryKey: ['entities', 'pick', debounced],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(`/entities?search=${encodeURIComponent(debounced)}&limit=6`),
    enabled: debounced.length >= 2,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line-strong px-3 py-2 text-sm">
        <span className="font-medium text-ink">{value.label}</span>
        <button className="text-xs text-primary-600 hover:underline" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  const results = (q.data?.items ?? []).filter((e) => !exclude.has(e.id));

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2">
        <Search className="h-4 w-4 text-ink-faint" />
        <input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 shadow-pop">
          {q.isFetching && <div className="px-3 py-2 text-sm text-ink-faint">Searching…</div>}
          {q.isSuccess && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-ink-faint">No clients found.</div>
          )}
          {results.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                onChange({ id: e.id, label: e.legalName });
                setTerm('');
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-raised"
            >
              <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span>
                <span className="block text-sm font-medium text-ink">{e.legalName}</span>
                <span className="block text-xs text-ink-faint">
                  {e.entityCode} · {e.typeName}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * The 12-step Add Client / Entity wizard (spec §3–§28). Captures FACTS only —
 * no statutory applicability is decided here (§32). Creation needs only minimum
 * identity (§5/§27); everything else is progressive, and what's absent is shown
 * as Missing — never as "Not Applicable". Submits atomically via POST /entities
 * (entity + registrations + contacts + addresses + activities + listings +
 * regulatory attributes + financial years in one transaction, §4).
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Plus, Trash2 } from 'lucide-react';
import {
  ACCOUNTING_FRAMEWORKS,
  ADDRESS_TYPES,
  CONTACT_TYPES,
  ENTITY_STATUSES,
  EXCHANGES,
  FINANCIAL_SOURCES,
  LEGAL_STATUSES,
  LISTING_STATUSES,
  PAN_REGEX,
  REGISTRATION_APPLICABILITIES,
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
  SECURITY_TYPES,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { ClientRow, DuplicateCandidate, EntityType, Industry, OfficeRow } from '@/lib/types';
import { Card, CardBody, Button, Spinner, Badge, PageHeader } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';

type Kind = 'individual' | 'legal_entity';
interface RegRow {
  registrationType: string;
  registrationNumber: string;
  status: string;
  applicability: string;
  stateCode: string;
  validFrom: string;
}
interface ContactRow {
  fullName: string;
  designation: string;
  email: string;
  contactType: string;
  isPrimary: boolean;
  isPortalUser: boolean;
}
interface AddrRow {
  addressType: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
  isPrimary: boolean;
}
interface ListingRow {
  exchange: string;
  securityType: string;
  symbol: string;
}
interface FinRow {
  financialYear: string;
  turnover: string;
  netWorth: string;
  totalBorrowings: string;
  source: string;
}

interface State {
  kind: Kind;
  // Step 1 — identity
  legalName: string;
  displayName: string;
  tradeName: string;
  shortName: string;
  typeSlug: string;
  officeCode: string;
  clientId: string;
  pan: string;
  countryOfIncorporation: string;
  incorporationDate: string;
  status: string;
  legalStatus: string;
  // Step 2 — constitution
  roc: string;
  authorisedCapital: string;
  paidUpCapital: string;
  llpContribution: string;
  // repeatables
  registrations: RegRow[];
  addresses: AddrRow[];
  // Step 5 — listing
  listingStatus: string;
  listings: ListingRow[];
  regulatedSector: string;
  // Step 6 — financials
  financials: FinRow[];
  // Step 7 — business
  primaryIndustrySlug: string;
  businessDescription: string;
  act: Record<'manufacturing' | 'trading' | 'services' | 'import' | 'export' | 'ecommerce' | 'regulated', boolean>;
  // Step 8 — accounting
  currentAccountingFramework: string;
  isGovernmentCompany: boolean;
  // Step 10 — contacts
  contacts: ContactRow[];
}

const emptyReg = (): RegRow => ({
  registrationType: 'gstin',
  registrationNumber: '',
  status: 'active',
  applicability: 'unknown',
  stateCode: '',
  validFrom: '',
});
const emptyContact = (): ContactRow => ({
  fullName: '',
  designation: '',
  email: '',
  contactType: '',
  isPrimary: false,
  isPortalUser: false,
});
const emptyAddr = (): AddrRow => ({
  addressType: 'registered',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  isPrimary: false,
});
const emptyListing = (): ListingRow => ({ exchange: 'nse', securityType: 'equity', symbol: '' });
const emptyFin = (): FinRow => ({
  financialYear: '',
  turnover: '',
  netWorth: '',
  totalBorrowings: '',
  source: 'audited_financials',
});

const STEPS = [
  'Basic Information',
  'Legal & Constitution',
  'Registrations',
  'Addresses',
  'Ownership & Group',
  'Listing & Regulatory',
  'Financial Profile',
  'Business Profile',
  'Accounting Profile',
  'Regulatory Profile',
  'Contacts',
  'Review & Create',
] as const;

const num = (s: string): number | undefined => {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};
const clean = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);

export function AddClientWizard(): JSX.Element {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<State>({
    kind: 'legal_entity',
    legalName: '',
    displayName: '',
    tradeName: '',
    shortName: '',
    typeSlug: '',
    officeCode: '',
    clientId: '',
    pan: '',
    countryOfIncorporation: 'IN',
    incorporationDate: '',
    status: 'draft',
    legalStatus: '',
    roc: '',
    authorisedCapital: '',
    paidUpCapital: '',
    llpContribution: '',
    registrations: [],
    addresses: [],
    listingStatus: 'unlisted',
    listings: [],
    regulatedSector: '',
    financials: [],
    primaryIndustrySlug: '',
    businessDescription: '',
    act: {
      manufacturing: false,
      trading: false,
      services: false,
      import: false,
      export: false,
      ecommerce: false,
      regulated: false,
    },
    currentAccountingFramework: 'not_assessed',
    isGovernmentCompany: false,
    contacts: [],
  });
  const set = <K extends keyof State>(k: K, v: State[K]): void => setS((p) => ({ ...p, [k]: v }));

  const types = useQuery({ queryKey: ['entity-types'], queryFn: () => apiFetch<EntityType[]>('/entity-types') });
  const offices = useQuery({ queryKey: ['admin', 'offices'], queryFn: () => apiFetch<OfficeRow[]>('/offices') });
  const industries = useQuery({ queryKey: ['industries'], queryFn: () => apiFetch<Industry[]>('/industries') });
  const clients = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => apiFetch<{ items: ClientRow[] }>('/clients?limit=200'),
  });

  // Entity types available for the chosen entry kind (§3/§7).
  const kindTypes = useMemo(() => {
    const all = types.data ?? [];
    if (s.kind === 'individual')
      return all.filter((t) => ['individual', 'proprietorship'].includes(t.category));
    return all.filter((t) => !['individual', 'proprietorship'].includes(t.category));
  }, [types.data, s.kind]);

  useEffect(() => {
    if (kindTypes[0] && !kindTypes.some((t) => t.slug === s.typeSlug)) set('typeSlug', kindTypes[0].slug);
  }, [kindTypes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!s.officeCode && offices.data?.[0]) set('officeCode', offices.data[0].code);
  }, [offices.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeCategory = useMemo(
    () => kindTypes.find((t) => t.slug === s.typeSlug)?.category ?? types.data?.find((t) => t.slug === s.typeSlug)?.category ?? '',
    [kindTypes, types.data, s.typeSlug],
  );

  const panValid = s.pan === '' || PAN_REGEX.test(s.pan.trim().toUpperCase());

  // Live duplicate-check (mirrors the previous simple form).
  const [debounced, setDebounced] = useState({ legalName: '', pan: '' });
  useEffect(() => {
    const t = setTimeout(
      () => setDebounced({ legalName: s.legalName.trim(), pan: s.pan.trim().toUpperCase() }),
      350,
    );
    return () => clearTimeout(t);
  }, [s.legalName, s.pan]);
  const dupePan = PAN_REGEX.test(debounced.pan) ? debounced.pan : '';
  const dupeName = debounced.legalName.length >= 3 ? debounced.legalName : '';
  const dupes = useQuery({
    queryKey: ['entities', 'dupe', dupeName, dupePan],
    queryFn: () => {
      const p = new URLSearchParams();
      if (dupeName) p.set('legalName', dupeName);
      if (dupePan) p.set('pan', dupePan);
      return apiFetch<DuplicateCandidate[]>(`/entities/duplicate-check?${p.toString()}`);
    },
    enabled: dupeName.length > 0 || dupePan.length > 0,
  });

  const missing = useMemo(() => computeMissing(s, typeCategory), [s, typeCategory]);

  const payload = useMemo(() => buildPayload(s), [s]);
  const create = useMutation({
    mutationFn: () => apiFetch<{ id: string }>('/entities', { method: 'POST', body: payload }),
    onSuccess: (data) => {
      toast('Client entity created.');
      qc.invalidateQueries({ queryKey: ['entities'] });
      router.push(`/entities/${data.id}`);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not create the entity.', 'error'),
  });

  const canCreate = s.legalName.trim().length > 0 && !!s.typeSlug && !!s.officeCode && panValid;

  if (types.isLoading || offices.isLoading) return <Spinner label="Loading…" />;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Add client / entity"
        subtitle="Capture the facts. Registrations and financials can be completed progressively."
      />
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <Stepper step={step} onStep={setStep} />
        <Card>
          <CardBody className="space-y-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Step {step + 1} of {STEPS.length}
              </div>
              <h2 className="text-lg font-semibold text-ink">{STEPS[step]}</h2>
            </div>

            {step === 0 && (
              <Step1
                s={s}
                set={set}
                kindTypes={kindTypes}
                offices={offices.data ?? []}
                clients={clients.data?.items ?? []}
                panValid={panValid}
                dupes={dupes.data ?? []}
              />
            )}
            {step === 1 && <Step2Constitution s={s} set={set} typeCategory={typeCategory} />}
            {step === 2 && <RegistrationsStep s={s} set={set} />}
            {step === 3 && <AddressesStep s={s} set={set} />}
            {step === 4 && <OwnershipStep s={s} set={set} clients={clients.data?.items ?? []} />}
            {step === 5 && <ListingStep s={s} set={set} />}
            {step === 6 && <FinancialsStep s={s} set={set} />}
            {step === 7 && <BusinessStep s={s} set={set} industries={industries.data ?? []} />}
            {step === 8 && <AccountingStep s={s} set={set} />}
            {step === 9 && <RegulatoryProfileStep />}
            {step === 10 && <ContactsStep s={s} set={set} />}
            {step === 11 && <ReviewStep s={s} missing={missing} typeName={kindTypes.find((t) => t.slug === s.typeSlug)?.name ?? s.typeSlug} />}

            <div className="flex items-center justify-between border-t border-line pt-4">
              <Button variant="ghost" onClick={() => (step === 0 ? router.back() : setStep(step - 1))}>
                {step === 0 ? 'Cancel' : 'Back'}
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={() => setStep(step + 1)}>Next</Button>
              ) : (
                <Button disabled={!canCreate || create.isPending} onClick={() => create.mutate()}>
                  {create.isPending ? 'Creating…' : 'Create entity'}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Stepper({ step, onStep }: { step: number; onStep: (n: number) => void }): JSX.Element {
  return (
    <nav className="hidden lg:block">
      <ol className="space-y-1">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              onClick={() => onStep(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition',
                i === step ? 'bg-primary-50 font-semibold text-primary-700' : 'text-ink-muted hover:bg-surface-sunken',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]',
                  i < step ? 'bg-primary-600 text-white' : i === step ? 'border border-primary-600 text-primary-700' : 'border border-line text-ink-faint',
                )}
              >
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ── Step 1: Basic Information (§3/§6) ────────────────────────────────────────
function Step1({
  s,
  set,
  kindTypes,
  offices,
  clients,
  panValid,
  dupes,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
  kindTypes: EntityType[];
  offices: OfficeRow[];
  clients: ClientRow[];
  panValid: boolean;
  dupes: DuplicateCandidate[];
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Field label="Entry point" hint="A group is not a legal entity — create it under Clients, then link entities (§3).">
        <div className="flex gap-2">
          {(['legal_entity', 'individual'] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => set('kind', k)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm',
                s.kind === k ? 'border-primary-500 bg-primary-50 font-medium text-primary-700' : 'border-line text-ink-muted',
              )}
            >
              {k === 'legal_entity' ? 'Legal entity' : 'Individual / Proprietor'}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Legal name" required>
        <Input value={s.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Acme Manufacturing Pvt Ltd" />
      </Field>

      {dupes.length > 0 && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-warning-700">
            <AlertTriangle className="h-4 w-4" /> Possible duplicate{dupes.length > 1 ? 's' : ''}
          </div>
          <ul className="space-y-1">
            {dupes.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <Link href={`/entities/${d.id}`} className="text-primary-700 hover:underline">
                  {d.legalName} <span className="text-ink-faint">({d.entityCode})</span>
                </Link>
                <Badge tone={d.matchReason === 'pan' ? 'danger' : 'warn'}>
                  {d.matchReason === 'pan' ? 'Same PAN' : 'Similar name'}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Trade / brand name">
          <Input value={s.tradeName} onChange={(e) => set('tradeName', e.target.value)} />
        </Field>
        <Field label="Short name" hint="Internal convenience.">
          <Input value={s.shortName} onChange={(e) => set('shortName', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Entity type" required>
          <Select value={s.typeSlug} onChange={(e) => set('typeSlug', e.target.value)}>
            {kindTypes.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Home office" required>
          <Select value={s.officeCode} onChange={(e) => set('officeCode', e.target.value)}>
            {offices.map((o) => (
              <option key={o.id} value={o.code}>
                {o.name} ({o.code})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Client relationship" hint="Link to an existing client (§2), or leave to attach later.">
          <Select value={s.clientId} onChange={(e) => set('clientId', e.target.value)}>
            <option value="">— None yet —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.clientCode})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lifecycle status">
          <Select value={s.status} onChange={(e) => set('status', e.target.value)}>
            {ENTITY_STATUSES.map((v) => (
              <option key={v} value={v}>
                {humanize(v)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Field label="PAN" hint={s.pan && !panValid ? 'Invalid PAN.' : 'Optional; add later if pending.'}>
          <Input
            value={s.pan}
            onChange={(e) => set('pan', e.target.value.toUpperCase())}
            placeholder="AAACA1234A"
            className={s.pan && !panValid ? 'border-danger-400' : undefined}
          />
        </Field>
        <Field label="Country of incorp.">
          <Input value={s.countryOfIncorporation} onChange={(e) => set('countryOfIncorporation', e.target.value.toUpperCase())} maxLength={2} />
        </Field>
        <Field label={s.kind === 'individual' ? 'Date of birth' : 'Date of incorporation'}>
          <Input type="date" value={s.incorporationDate} onChange={(e) => set('incorporationDate', e.target.value)} />
        </Field>
      </div>
      <Field label="Legal / operational status (§6)">
        <Select value={s.legalStatus} onChange={(e) => set('legalStatus', e.target.value)}>
          <option value="">— Not assessed —</option>
          {LEGAL_STATUSES.map((v) => (
            <option key={v} value={v}>
              {humanize(v)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

// ── Step 2: Legal & Constitution (§8, conditional) ──────────────────────────
function Step2Constitution({
  s,
  set,
  typeCategory,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
  typeCategory: string;
}): JSX.Element {
  if (typeCategory === 'individual' || typeCategory === 'proprietorship') {
    return (
      <p className="text-sm text-ink-muted">
        No constitutional details for an {humanize(typeCategory)}. Continue to registrations.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <Field label="ROC" hint="Registrar of Companies.">
        <Input value={s.roc} onChange={(e) => set('roc', e.target.value)} placeholder="RoC-Mumbai" />
      </Field>
      {typeCategory === 'llp' ? (
        <Field label="Contribution (₹)">
          <Input value={s.llpContribution} onChange={(e) => set('llpContribution', e.target.value)} inputMode="decimal" />
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Authorised capital (₹)">
            <Input value={s.authorisedCapital} onChange={(e) => set('authorisedCapital', e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Paid-up capital (₹)">
            <Input value={s.paidUpCapital} onChange={(e) => set('paidUpCapital', e.target.value)} inputMode="decimal" />
          </Field>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Registrations (§9–§12) ──────────────────────────────────────────
function RegistrationsStep({
  s,
  set,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<RegRow>): void =>
    set('registrations', s.registrations.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Multiple registrations per entity. A missing registration is not the same as Not Applicable
        (§12); leave applicability as Unknown until assessed.
      </p>
      {s.registrations.map((r, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Type">
              <Select value={r.registrationType} onChange={(e) => update(i, { registrationType: e.target.value })}>
                {REGISTRATION_TYPES.map((v) => (
                  <option key={v} value={v}>{humanize(v)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Number">
              <Input value={r.registrationNumber} onChange={(e) => update(i, { registrationNumber: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Status">
              <Select value={r.status} onChange={(e) => update(i, { status: e.target.value })}>
                {REGISTRATION_STATUSES.map((v) => (
                  <option key={v} value={v}>{humanize(v)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Applicability">
              <Select value={r.applicability} onChange={(e) => update(i, { applicability: e.target.value })}>
                {REGISTRATION_APPLICABILITIES.map((v) => (
                  <option key={v} value={v}>{humanize(v)}</option>
                ))}
              </Select>
            </Field>
            <Field label="State code">
              <Input value={r.stateCode} onChange={(e) => update(i, { stateCode: e.target.value })} placeholder="27" />
            </Field>
            <Field label="Valid from">
              <Input type="date" value={r.validFrom} onChange={(e) => update(i, { validFrom: e.target.value })} />
            </Field>
          </div>
          <div className="mt-2 text-right">
            <RemoveButton onClick={() => set('registrations', s.registrations.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <AddButton label="Add registration" onClick={() => set('registrations', [...s.registrations, emptyReg()])} />
    </div>
  );
}

// ── Step 4: Addresses (§8/§31) ──────────────────────────────────────────────
function AddressesStep({
  s,
  set,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<AddrRow>): void =>
    set('addresses', s.addresses.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      {s.addresses.map((a, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Type">
              <Select value={a.addressType} onChange={(e) => update(i, { addressType: e.target.value })}>
                {ADDRESS_TYPES.map((v) => (
                  <option key={v} value={v}>{humanize(v)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Line 1">
              <Input value={a.line1} onChange={(e) => update(i, { line1: e.target.value })} />
            </Field>
            <Field label="City">
              <Input value={a.city} onChange={(e) => update(i, { city: e.target.value })} />
            </Field>
            <Field label="State">
              <Input value={a.state} onChange={(e) => update(i, { state: e.target.value })} />
            </Field>
            <Field label="Pincode">
              <Input value={a.pincode} onChange={(e) => update(i, { pincode: e.target.value })} placeholder="400001" />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm text-ink-muted">
              <input type="checkbox" checked={a.isPrimary} onChange={(e) => update(i, { isPrimary: e.target.checked })} />
              Primary
            </label>
          </div>
          <div className="mt-2 text-right">
            <RemoveButton onClick={() => set('addresses', s.addresses.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <AddButton label="Add address" onClick={() => set('addresses', [...s.addresses, emptyAddr()])} />
    </div>
  );
}

// ── Step 5: Ownership & Group (§4/§13) ──────────────────────────────────────
function OwnershipStep({
  s,
  set,
  clients,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
  clients: ClientRow[];
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Field label="Client relationship (§2)" hint="Group / business family lives on the client record.">
        <Select value={s.clientId} onChange={(e) => set('clientId', e.target.value)}>
          <option value="">— None yet —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.clientCode}) {c.clientKind === 'group' ? '· group' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <p className="rounded-lg bg-surface-sunken p-3 text-sm text-ink-muted">
        Structured ownership relationships (holding, subsidiary, associate, JV…) reference other
        entities, so they&rsquo;re added from the entity page after both entities exist (§13).
      </p>
    </div>
  );
}

// ── Step 6: Listing & Regulatory status (§15) ───────────────────────────────
function ListingStep({
  s,
  set,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<ListingRow>): void =>
    set('listings', s.listings.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Listing status">
          <Select value={s.listingStatus} onChange={(e) => set('listingStatus', e.target.value)}>
            {LISTING_STATUSES.map((v) => (
              <option key={v} value={v}>{humanize(v)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Regulated sector (§15)" hint="Stored as a regulatory fact.">
          <Input value={s.regulatedSector} onChange={(e) => set('regulatedSector', e.target.value)} placeholder="nbfc / banking / …" />
        </Field>
      </div>
      {s.listings.map((l, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Exchange">
              <Select value={l.exchange} onChange={(e) => update(i, { exchange: e.target.value })}>
                {EXCHANGES.map((v) => (
                  <option key={v} value={v}>{v.toUpperCase()}</option>
                ))}
              </Select>
            </Field>
            <Field label="Security">
              <Select value={l.securityType} onChange={(e) => update(i, { securityType: e.target.value })}>
                {SECURITY_TYPES.map((v) => (
                  <option key={v} value={v}>{humanize(v)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Symbol">
              <Input value={l.symbol} onChange={(e) => update(i, { symbol: e.target.value })} />
            </Field>
          </div>
          <div className="mt-2 text-right">
            <RemoveButton onClick={() => set('listings', s.listings.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <AddButton label="Add listing line" onClick={() => set('listings', [...s.listings, emptyListing()])} />
    </div>
  );
}

// ── Step 7: Financial Profile (§16) ─────────────────────────────────────────
function FinancialsStep({
  s,
  set,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<FinRow>): void =>
    set('financials', s.financials.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">Stored by financial year and never overwritten (§16).</p>
      {s.financials.map((f, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Financial year">
              <Input value={f.financialYear} onChange={(e) => update(i, { financialYear: e.target.value })} placeholder="2024-25" />
            </Field>
            <Field label="Turnover (₹)">
              <Input value={f.turnover} onChange={(e) => update(i, { turnover: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Net worth (₹)">
              <Input value={f.netWorth} onChange={(e) => update(i, { netWorth: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Total borrowings (₹)">
              <Input value={f.totalBorrowings} onChange={(e) => update(i, { totalBorrowings: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Source">
              <Select value={f.source} onChange={(e) => update(i, { source: e.target.value })}>
                {FINANCIAL_SOURCES.map((v) => (
                  <option key={v} value={v}>{humanize(v)}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-2 text-right">
            <RemoveButton onClick={() => set('financials', s.financials.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <AddButton label="Add financial year" onClick={() => set('financials', [...s.financials, emptyFin()])} />
    </div>
  );
}

// ── Step 8: Business Profile (§18) ──────────────────────────────────────────
function BusinessStep({
  s,
  set,
  industries,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
  industries: Industry[];
}): JSX.Element {
  const flags: (keyof State['act'])[] = ['manufacturing', 'trading', 'services', 'import', 'export', 'ecommerce', 'regulated'];
  return (
    <div className="space-y-4">
      <Field label="Primary industry">
        <Select value={s.primaryIndustrySlug} onChange={(e) => set('primaryIndustrySlug', e.target.value)}>
          <option value="">— Select —</option>
          {industries.map((i) => (
            <option key={i.id} value={i.slug}>{i.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Business description">
        <Textarea value={s.businessDescription} onChange={(e) => set('businessDescription', e.target.value)} rows={3} />
      </Field>
      <Field label="Activities">
        <div className="flex flex-wrap gap-2">
          {flags.map((f) => (
            <label key={f} className={cn('cursor-pointer rounded-lg border px-3 py-1.5 text-sm', s.act[f] ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-line text-ink-muted')}>
              <input type="checkbox" className="sr-only" checked={s.act[f]} onChange={(e) => set('act', { ...s.act, [f]: e.target.checked })} />
              {humanize(f)}
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}

// ── Step 9: Accounting / Reporting (§19) ────────────────────────────────────
function AccountingStep({
  s,
  set,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        A currently-known framework may be recorded; the final determination is the Regulatory
        Engine&rsquo;s, not this form (§19).
      </p>
      <Field label="Current accounting framework">
        <Select value={s.currentAccountingFramework} onChange={(e) => set('currentAccountingFramework', e.target.value)}>
          {ACCOUNTING_FRAMEWORKS.map((v) => (
            <option key={v} value={v}>{humanize(v)}</option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input type="checkbox" checked={s.isGovernmentCompany} onChange={(e) => set('isGovernmentCompany', e.target.checked)} />
        Government company (structured fact for the engine)
      </label>
    </div>
  );
}

// ── Step 10: Regulatory Profile (§20) — read-only info ──────────────────────
function RegulatoryProfileStep(): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-surface-sunken p-4 text-sm text-ink-muted">
        Statutory applicability (Internal Audit, CSR, CARO, Ind AS, SMC, Audit Committee…) is
        <strong className="text-ink"> calculated downstream</strong> by the versioned Regulatory
        Applicability Engine from the facts captured here — never decided in this form (§32/§35).
        After creation, every result carries its state and a <em>View Basis</em> (§20–§22).
      </div>
      <p className="text-sm text-ink-faint">Nothing to enter here. Continue to contacts.</p>
    </div>
  );
}

// ── Step 11: Contacts (§24) ─────────────────────────────────────────────────
function ContactsStep({
  s,
  set,
}: {
  s: State;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<ContactRow>): void =>
    set('contacts', s.contacts.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      {s.contacts.map((c, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Name">
              <Input value={c.fullName} onChange={(e) => update(i, { fullName: e.target.value })} />
            </Field>
            <Field label="Designation">
              <Input value={c.designation} onChange={(e) => update(i, { designation: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={c.email} onChange={(e) => update(i, { email: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={c.contactType} onChange={(e) => update(i, { contactType: e.target.value })}>
                <option value="">—</option>
                {CONTACT_TYPES.map((v) => (
                  <option key={v} value={v}>{humanize(v)}</option>
                ))}
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm text-ink-muted">
              <input type="checkbox" checked={c.isPrimary} onChange={(e) => update(i, { isPrimary: e.target.checked })} />
              Primary
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm text-ink-muted">
              <input type="checkbox" checked={c.isPortalUser} onChange={(e) => update(i, { isPortalUser: e.target.checked })} />
              Portal user
            </label>
          </div>
          <div className="mt-2 text-right">
            <RemoveButton onClick={() => set('contacts', s.contacts.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <AddButton label="Add contact" onClick={() => set('contacts', [...s.contacts, emptyContact()])} />
    </div>
  );
}

// ── Step 12: Review & Create (§27) ──────────────────────────────────────────
function ReviewStep({
  s,
  missing,
  typeName,
}: {
  s: State;
  missing: { code: string; label: string }[];
  typeName: string;
}): JSX.Element {
  const rows: [string, string][] = [
    ['Legal name', s.legalName || '—'],
    ['Type', typeName],
    ['Office', s.officeCode],
    ['PAN', s.pan || 'Pending'],
    ['Registrations', String(s.registrations.length)],
    ['Addresses', String(s.addresses.length)],
    ['Financial years', String(s.financials.length)],
    ['Contacts', String(s.contacts.length)],
    ['Listings', String(s.listings.length)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line/60 py-1">
            <span className="text-ink-faint">{k}</span>
            <span className="font-medium text-ink">{v}</span>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
        <div className="mb-1.5 text-sm font-semibold text-warning-700">
          Missing / pending information ({missing.length})
        </div>
        {missing.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing outstanding.</p>
        ) : (
          <ul className="space-y-1 text-sm text-ink-muted">
            {missing.map((m) => (
              <li key={m.code} className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-warning-600" /> {m.label}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-faint">
          Missing ≠ Not Applicable. You can create now and complete these later (§5/§27).
        </p>
      </div>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <Button variant="subtle" size="sm" onClick={onClick}>
      <Plus className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}
function RemoveButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-xs text-danger-600 hover:text-danger-700">
      <Trash2 className="h-3.5 w-3.5" /> Remove
    </button>
  );
}

// Client-side mirror of the server's missing-info (§5/§27) for the review preview.
function computeMissing(s: State, typeCategory: string): { code: string; label: string }[] {
  const out: { code: string; label: string }[] = [];
  if (!s.pan.trim()) out.push({ code: 'pan', label: 'PAN not recorded' });
  if (!s.incorporationDate) out.push({ code: 'incorporation_date', label: 'Date of incorporation/birth not recorded' });
  if (!s.legalStatus) out.push({ code: 'legal_status', label: 'Legal/operational status not assessed' });
  if (s.registrations.length === 0) out.push({ code: 'registrations', label: 'No registrations recorded' });
  if (!s.contacts.some((c) => c.isPrimary)) out.push({ code: 'primary_contact', label: 'No primary contact recorded' });
  if (s.financials.length === 0) out.push({ code: 'financials', label: 'No financial year recorded' });
  if (typeCategory === 'company' && !s.registrations.some((r) => r.registrationType === 'cin'))
    out.push({ code: 'cin', label: 'CIN not recorded for a company' });
  if (typeCategory === 'llp' && !s.registrations.some((r) => r.registrationType === 'llpin'))
    out.push({ code: 'llpin', label: 'LLPIN not recorded for an LLP' });
  return out;
}

// Build the atomic POST /entities body (§4), omitting empty values.
function buildPayload(s: State): Record<string, unknown> {
  const regulatoryAttributes: Record<string, unknown>[] = [];
  if (s.regulatedSector.trim())
    regulatoryAttributes.push({ attributeCode: 'regulated_sector', valueText: s.regulatedSector.trim() });
  if (s.isGovernmentCompany)
    regulatoryAttributes.push({ attributeCode: 'is_government_company', valueBoolean: true });

  return {
    legalName: s.legalName.trim(),
    ...(clean(s.displayName) ? { displayName: s.displayName.trim() } : {}),
    ...(clean(s.tradeName) ? { tradeName: s.tradeName.trim() } : {}),
    ...(clean(s.shortName) ? { shortName: s.shortName.trim() } : {}),
    typeSlug: s.typeSlug,
    officeCode: s.officeCode,
    ...(s.clientId ? { clientId: s.clientId } : {}),
    ...(clean(s.pan) ? { pan: s.pan.trim().toUpperCase() } : {}),
    ...(clean(s.countryOfIncorporation) ? { countryOfIncorporation: s.countryOfIncorporation.trim().toUpperCase() } : {}),
    status: s.status,
    ...(s.legalStatus ? { legalStatus: s.legalStatus } : {}),
    listingStatus: s.listingStatus,
    currentAccountingFramework: s.currentAccountingFramework,
    ...(s.incorporationDate ? { incorporationDate: s.incorporationDate } : {}),
    ...(clean(s.roc) ? { roc: s.roc.trim() } : {}),
    ...(num(s.authorisedCapital) !== undefined ? { authorisedCapital: num(s.authorisedCapital) } : {}),
    ...(num(s.paidUpCapital) !== undefined ? { paidUpCapital: num(s.paidUpCapital) } : {}),
    ...(num(s.llpContribution) !== undefined ? { llpContribution: num(s.llpContribution) } : {}),
    ...(clean(s.businessDescription) ? { businessDescription: s.businessDescription.trim() } : {}),
    ...(s.registrations.length
      ? {
          registrations: s.registrations
            .filter((r) => r.registrationNumber.trim())
            .map((r) => ({
              registrationType: r.registrationType,
              registrationNumber: r.registrationNumber.trim().toUpperCase(),
              status: r.status,
              applicability: r.applicability,
              ...(clean(r.stateCode) ? { stateCode: r.stateCode.trim() } : {}),
              ...(r.validFrom ? { validFrom: r.validFrom } : {}),
            })),
        }
      : {}),
    ...(s.addresses.length
      ? {
          addresses: s.addresses
            .filter((a) => a.line1.trim())
            .map((a) => ({
              addressType: a.addressType,
              line1: a.line1.trim(),
              ...(clean(a.city) ? { city: a.city.trim() } : {}),
              ...(clean(a.state) ? { state: a.state.trim() } : {}),
              ...(clean(a.pincode) ? { pincode: a.pincode.trim() } : {}),
              isPrimary: a.isPrimary,
            })),
        }
      : {}),
    ...(s.primaryIndustrySlug
      ? { businessActivities: [{ industrySlug: s.primaryIndustrySlug, isPrimary: true }] }
      : {}),
    ...(s.listings.length
      ? { listings: s.listings.map((l) => ({ exchange: l.exchange, securityType: l.securityType, ...(clean(l.symbol) ? { symbol: l.symbol.trim() } : {}) })) }
      : {}),
    ...(regulatoryAttributes.length ? { regulatoryAttributes } : {}),
    ...(s.financials.length
      ? {
          financialProfiles: s.financials
            .filter((f) => /^[0-9]{4}-[0-9]{2}$/.test(f.financialYear.trim()))
            .map((f) => ({
              financialYear: f.financialYear.trim(),
              source: f.source,
              ...(num(f.turnover) !== undefined ? { turnover: num(f.turnover) } : {}),
              ...(num(f.netWorth) !== undefined ? { netWorth: num(f.netWorth) } : {}),
              ...(num(f.totalBorrowings) !== undefined ? { totalBorrowings: num(f.totalBorrowings) } : {}),
            })),
        }
      : {}),
    ...(s.contacts.length
      ? {
          contacts: s.contacts
            .filter((c) => c.fullName.trim())
            .map((c) => ({
              fullName: c.fullName.trim(),
              ...(clean(c.designation) ? { designation: c.designation.trim() } : {}),
              ...(clean(c.email) ? { email: c.email.trim() } : {}),
              ...(c.contactType ? { contactType: c.contactType } : {}),
              isPrimary: c.isPrimary,
              isPortalUser: c.isPortalUser,
            })),
        }
      : {}),
    // Activity flags (§18) map to a nested `activities` object on the entity.
    ...(Object.values(s.act).some(Boolean) ? { activities: s.act } : {}),
  };
}

'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Minus, Pencil, Plus } from 'lucide-react';
import {
  COMPANY_SUBTYPES,
  defaultCompanySubtype,
  dscLapses,
  resolveCinFacts,
  type CinProfileAttributes,
  type CompanyDirector,
  GST_SCHEMES,
  GST_SCHEME_LABEL,
  PROFILE_SCOPES,
  qrmpCategoryForGstin,
  type ComplianceProfileRecord,
  type EntityComplianceProfiles,
  type EntityRegistrationOption,
  type GstScheme,
  type ProfileScope,
  type QrmpCategory,
  type SaveComplianceProfileResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Card, CardHeader, CardTitle, CardBody, Button, Spinner, Badge } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

/** The yes / no facts each scope's rules test (see the *ProfileAttributes contracts). */
const FLAGS: Record<ProfileScope, Array<[key: string, label: string]>> = {
  gstin: [
    ['eInvoicing', 'E-invoicing'],
    ['exporter', 'Exporter'],
    ['importer', 'Importer'],
    ['jobWork', 'Job work (ITC-04)'],
    ['optingCompositionNextFy', 'Opting for composition next FY'],
    ['monthlyDataRequest', 'Monthly data request on the 1st'],
  ],
  tan: [
    ['employer', 'Employer (salary TDS)'],
    ['paysNonResidents', 'Pays non-residents (27Q)'],
    ['tcsCollector', 'Collects TCS (27EQ)'],
    ['propertyOrRentDeductor', 'Property / rent deductor (s.194-IA/IB/M)'],
  ],
  pan: [
    ['auditCase', 'Accounts audited (ITR due 31 Oct)'],
    ['taxAudit', 'Tax audit u/s 44AB'],
    ['tpTransactions', 'Transfer-pricing transactions'],
    ['advanceTaxLiable', 'Liable to advance tax'],
    ['trustOrInstitution', 'Trust / institution'],
  ],
  // ADT-1 now follows the AGM as recorded (auditorAppointedAtAgm is retired).
  cin: [
    ['msmeDuesOver45Days', 'MSME dues over 45 days (MSME-1)'],
    ['hasSubsidiaries', 'Has subsidiaries (consolidated AOC-4)'],
    ['csrApplicable', 'CSR applies (s.135)'],
    ['secretarialAuditRequired', 'Secretarial audit (MR-3)'],
  ],
  llpin: [],
};

/**
 * CIN facts that are yes / no / not stated: unstated keeps DPT-3 (a nil filing
 * out of caution, G7), and XBRL / MGT-8 follow the capital and turnover.
 */
const CIN_TRISTATE: Array<[key: string, label: string, unset: string]> = [
  ['depositsOrExemptedLoans', 'Deposits / exempted loans (DPT-3)', 'Not known — DPT-3 kept'],
  ['xbrlRequired', 'AOC-4 in XBRL', 'By capital / turnover'],
  ['mgt8Required', 'MGT-8 by a CS in practice', 'By capital / turnover'],
];

/** Rupee figures on a CIN profile (G12 small-company test, XBRL / MGT-8, ROC fee slab). */
const CIN_AMOUNTS: Array<[key: string, label: string]> = [
  ['paidUpCapital', 'Paid-up capital (₹)'],
  ['authorisedCapital', 'Authorised capital (₹)'],
  ['turnover', 'Turnover, last FY (₹)'],
];

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

interface Slot {
  key: string;
  scope: ProfileScope;
  registration: EntityRegistrationOption | null;
  current: ComplianceProfileRecord | null;
  history: ComplianceProfileRecord[];
}

/** Today on the viewer's calendar (toISOString would give the UTC date). */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The client's compliance profiles (spec Change 4): per GSTIN, TAN, CIN /
 * LLPIN and the PAN, the facts its calendar is generated from, effective from
 * a date. Saving regenerates the client's open Compliance engagements.
 */
export function ComplianceProfilesCard({ entityId }: { entityId: string }): JSX.Element | null {
  const q = useQuery({
    queryKey: ['entity', entityId, 'compliance-profiles'],
    queryFn: () => apiFetch<EntityComplianceProfiles>(`/entities/${entityId}/compliance-profiles`),
  });
  const [editing, setEditing] = useState<string | null>(null);

  const slots = useMemo<Slot[]>(() => {
    if (!q.data) return [];
    const at = today();
    const forSlot = (scope: ProfileScope, regId: string | null) =>
      q.data.profiles
        .filter((p) => p.scope === scope && p.registrationId === regId)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    const make = (scope: ProfileScope, registration: EntityRegistrationOption | null): Slot => {
      const history = forSlot(scope, registration?.id ?? null);
      const current =
        history.find((p) => p.effectiveFrom <= at && (!p.effectiveTo || p.effectiveTo >= at)) ??
        history[0] ??
        null;
      return {
        key: `${scope}:${registration?.id ?? 'pan'}`,
        scope,
        registration,
        current,
        history,
      };
    };
    const regSlots = q.data.registrations
      .filter(
        (r) =>
          (PROFILE_SCOPES as string[]).includes(r.registrationType) && r.registrationType !== 'pan',
      )
      .map((r) => make(r.registrationType as ProfileScope, r));
    return [make('pan', null), ...regSlots];
  }, [q.data]);

  if (q.isLoading) return <Spinner label="Loading compliance profiles…" />;
  if (q.isError) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance profile</CardTitle>
        <p className="text-xs text-ink-faint">
          What the calendar is generated from. A change applies from its date and regenerates the
          client’s open Compliance engagements.
        </p>
      </CardHeader>
      <CardBody className="divide-y divide-line p-0">
        {slots.map((s) =>
          editing === s.key ? (
            <ProfileForm key={s.key} entityId={entityId} slot={s} onDone={() => setEditing(null)} />
          ) : (
            <ProfileRow
              key={s.key}
              slot={s}
              entity={{
                slug: q.data?.entityTypeSlug ?? null,
                turnover: q.data?.annualTurnover ?? null,
              }}
              onEdit={() => setEditing(s.key)}
            />
          ),
        )}
      </CardBody>
    </Card>
  );
}

function slotTitle(s: Slot): string {
  if (!s.registration) return 'PAN — income tax';
  const r = s.registration;
  return `${r.registrationType.toUpperCase()} ${r.registrationNumber}${r.stateCode ? ` · ${r.stateCode}` : ''}`;
}

function ProfileRow({
  slot,
  entity,
  onEdit,
}: {
  slot: Slot;
  entity: { slug: string | null; turnover: number | null };
  onEdit: () => void;
}): JSX.Element {
  const [showHistory, setShowHistory] = useState(false);
  const p = slot.current;
  const flags = FLAGS[slot.scope].filter(([k]) => p?.attributes[k] === true);
  const turnover = p?.attributes.annualTurnover;
  const subtype = p?.attributes.companySubtype;
  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{slotTitle(slot)}</span>
        {slot.registration && slot.registration.status !== 'active' && (
          <Badge>{humanize(slot.registration.status)}</Badge>
        )}
        {p ? (
          <span className="text-xs text-ink-faint">from {formatDate(p.effectiveFrom)}</span>
        ) : (
          <Badge tone="warn">No profile — defaults apply</Badge>
        )}
        <span className="ml-auto flex items-center gap-1">
          {slot.history.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}>
              <History className="h-3.5 w-3.5" /> {slot.history.length}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${slotTitle(slot)}`}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        </span>
      </div>
      {p && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {p.gstScheme && (
            <Badge tone="info">
              {GST_SCHEME_LABEL[p.gstScheme]}
              {p.qrmpCategory && ` · Cat ${p.qrmpCategory}`}
            </Badge>
          )}
          {typeof subtype === 'string' && <Badge tone="info">{humanize(subtype)}</Badge>}
          {typeof turnover === 'number' && (
            <Badge>Turnover ₹{turnover.toLocaleString('en-IN')}</Badge>
          )}
          {flags.map(([k, label]) => (
            <Badge key={k}>{label}</Badge>
          ))}
          {slot.scope !== 'cin' &&
            !p.gstScheme &&
            flags.length === 0 &&
            typeof turnover !== 'number' &&
            !subtype && <span className="text-xs text-ink-faint">Nothing flagged.</span>}
        </div>
      )}
      {slot.scope === 'cin' && (
        <CinFactsSummary
          attributes={(p?.attributes ?? {}) as CinProfileAttributes}
          entity={entity}
        />
      )}
      {showHistory && (
        <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
          {slot.history.map((h) => (
            <li key={h.id}>
              {formatDate(h.effectiveFrom)} → {h.effectiveTo ? formatDate(h.effectiveTo) : 'now'}
              {h.gstScheme && ` · ${GST_SCHEME_LABEL[h.gstScheme]}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the ROC rules read from a CIN profile, with each default and its source (G12, P1-7). */
function CinFactsSummary({
  attributes: a,
  entity,
}: {
  attributes: CinProfileAttributes;
  entity: { slug: string | null; turnover: number | null };
}): JSX.Element {
  const entitySubtype = defaultCompanySubtype(entity.slug);
  const f = resolveCinFacts(a, { subtype: entitySubtype, turnover: entity.turnover });
  const figuresMissing =
    !a.companySubtype &&
    entitySubtype === 'private' &&
    (typeof f.paidUpCapital !== 'number' || typeof f.turnover !== 'number');
  const lapsing = dscLapses(a.directors ?? [], addDays(today(), 30), today());
  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {f.subtypeDerived && <Badge tone="warn">Small company — within the limits · Verify</Badge>}
        {a.depositsOrExemptedLoans === true && <Badge>Deposits / exempted loans</Badge>}
        {a.depositsOrExemptedLoans === false && <Badge>No deposits — no DPT-3</Badge>}
        {a.depositsOrExemptedLoans === undefined && (
          <Badge tone="warn">Deposits not known — DPT-3 kept</Badge>
        )}
        {f.xbrlRequired && <Badge>{f.xbrlDerived ? 'XBRL (by figures) · Verify' : 'XBRL'}</Badge>}
        {f.mgt8Required && <Badge>{f.mgt8Derived ? 'MGT-8 (by figures) · Verify' : 'MGT-8'}</Badge>}
        {CIN_AMOUNTS.map(([k, label]) => {
          const v = (a as Record<string, unknown>)[k];
          return typeof v === 'number' ? (
            <Badge key={k}>
              {label.replace(' (₹)', '')} {rupees(v)}
            </Badge>
          ) : null;
        })}
        {(a.directors?.length ?? 0) > 0 && (
          <Badge>
            {a.directors!.length} director{a.directors!.length === 1 ? '' : 's'}
          </Badge>
        )}
        {lapsing.map((l) => (
          <Badge key={l.din} tone={l.expired ? 'danger' : 'warn'}>
            DSC of {l.name} {l.expired ? 'expired' : 'expires'} {formatDate(l.dscExpiresOn)}
          </Badge>
        ))}
      </div>
      {figuresMissing && (
        <p className="text-xs text-warning-700">
          Add the paid-up capital and turnover to test small-company status (MGT-7A, board meetings
          on calendar halves).
        </p>
      )}
    </div>
  );
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ProfileForm({
  entityId,
  slot,
  onDone,
}: {
  entityId: string;
  slot: Slot;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const p = slot.current;
  const isGst = slot.scope === 'gstin';
  const derivedCategory = slot.registration
    ? qrmpCategoryForGstin(slot.registration.stateCode ?? slot.registration.registrationNumber)
    : 'Y';

  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [scheme, setScheme] = useState<GstScheme>(p?.gstScheme ?? 'regular');
  const [category, setCategory] = useState<QrmpCategory | ''>(p?.qrmpCategory ?? '');
  const [attrs, setAttrs] = useState<Record<string, unknown>>(p?.attributes ?? {});
  const set = (k: string, v: unknown) => setAttrs((a) => ({ ...a, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      apiFetch<SaveComplianceProfileResult>(`/entities/${entityId}/compliance-profiles`, {
        method: 'PUT',
        body: {
          scope: slot.scope,
          ...(slot.registration ? { registrationId: slot.registration.id } : {}),
          effectiveFrom,
          ...(isGst
            ? { gstScheme: scheme, qrmpCategory: scheme === 'qrmp' && category ? category : null }
            : {}),
          // auditorAppointedAtAgm is retired: ADT-1 follows the AGM as recorded.
          attributes: { ...attrs, auditorAppointedAtAgm: undefined },
        },
      }),
    onSuccess: (res) => {
      const created = res.regenerated.reduce((n, r) => n + r.created, 0);
      const moved = res.regenerated.reduce((n, r) => n + r.moved, 0);
      toast(
        res.regenerated.length
          ? `Profile saved — calendar updated (${created} added, ${moved} moved).`
          : 'Profile saved.',
        'success',
      );
      void qc.invalidateQueries({ queryKey: ['entity', entityId, 'compliance-profiles'] });
      void qc.invalidateQueries({ queryKey: ['compliance', 'calendar-v2'] });
      onDone();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not save the profile.', 'error'),
  });

  return (
    <div className="space-y-3 bg-surface-raised/40 px-4 py-3 text-sm">
      <p className="font-medium text-ink">{slotTitle(slot)}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Effective from" required>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </Field>
        {isGst && (
          <Field label="GST scheme">
            <Select value={scheme} onChange={(e) => setScheme(e.target.value as GstScheme)}>
              {GST_SCHEMES.map((s) => (
                <option key={s} value={s}>
                  {GST_SCHEME_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {isGst && scheme === 'qrmp' && (
          <Field label="QRMP category">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as QrmpCategory | '')}
            >
              <option value="">By state (Category {derivedCategory})</option>
              <option value="X">X — GSTR-3B on the 22nd</option>
              <option value="Y">Y — GSTR-3B on the 24th</option>
            </Select>
          </Field>
        )}
        {isGst && (
          <Field label="Annual turnover (₹)">
            <Input
              type="number"
              min={0}
              value={typeof attrs.annualTurnover === 'number' ? String(attrs.annualTurnover) : ''}
              onChange={(e) =>
                set('annualTurnover', e.target.value === '' ? undefined : Number(e.target.value))
              }
            />
          </Field>
        )}
        {slot.scope === 'cin' && (
          <Field label="Company type">
            <Select
              value={typeof attrs.companySubtype === 'string' ? attrs.companySubtype : ''}
              onChange={(e) => set('companySubtype', e.target.value || undefined)}
            >
              <option value="">— not set —</option>
              {COMPANY_SUBTYPES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {slot.scope === 'cin' && (
        <div className="grid gap-3 sm:grid-cols-3">
          {CIN_AMOUNTS.map(([k, label]) => (
            <Field key={k} label={label}>
              <Input
                type="number"
                min={0}
                value={typeof attrs[k] === 'number' ? String(attrs[k]) : ''}
                onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </Field>
          ))}
          {CIN_TRISTATE.map(([k, label, unset]) => (
            <Field key={k} label={label}>
              <Select
                value={attrs[k] === true ? 'yes' : attrs[k] === false ? 'no' : ''}
                onChange={(e) =>
                  set(k, e.target.value === '' ? undefined : e.target.value === 'yes')
                }
              >
                <option value="">{unset}</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
          ))}
        </div>
      )}
      {FLAGS[slot.scope].length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {FLAGS[slot.scope].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary-600"
                checked={attrs[k] === true}
                onChange={(e) => set(k, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
      )}
      {slot.scope === 'cin' && (
        <DirectorsEditor
          directors={(attrs.directors as CompanyDirector[] | undefined) ?? []}
          onChange={(d) => set('directors', d.length ? d : undefined)}
        />
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={save.isPending || !effectiveFrom} onClick={() => save.mutate()}>
          Save from {effectiveFrom ? formatDate(effectiveFrom) : '…'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const EMPTY_DIRECTOR: CompanyDirector = { din: '', name: '', kycCycleStartFy: '' };

/** Directors inline (+ / −): DIN, KYC cycle and DSC expiry (P2-5). */
function DirectorsEditor({
  directors,
  onChange,
}: {
  directors: CompanyDirector[];
  onChange: (d: CompanyDirector[]) => void;
}): JSX.Element {
  const update = (i: number, patch: Partial<CompanyDirector>) =>
    onChange(
      directors.map((d, j) => {
        if (j !== i) return d;
        const next = { ...d, ...patch };
        if (!next.dscExpiresOn) delete next.dscExpiresOn;
        return next;
      }),
    );
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-ink-muted">Directors (DIR-3 KYC, DSC expiry)</p>
      {directors.map((d, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[8rem_1fr_7rem_10rem_auto]">
          <Field label="DIN">
            <Input
              value={d.din}
              inputMode="numeric"
              maxLength={8}
              onChange={(e) => update(i, { din: e.target.value.trim() })}
            />
          </Field>
          <Field label="Name">
            <Input value={d.name} onChange={(e) => update(i, { name: e.target.value })} />
          </Field>
          <Field label="KYC cycle FY">
            <Input
              value={d.kycCycleStartFy}
              placeholder="2025-26"
              onChange={(e) => update(i, { kycCycleStartFy: e.target.value.trim() })}
            />
          </Field>
          <Field label="DSC expires on">
            <Input
              type="date"
              value={d.dscExpiresOn ?? ''}
              onChange={(e) => update(i, { dscExpiresOn: e.target.value || undefined })}
            />
          </Field>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove director ${d.name || i + 1}`}
            onClick={() => onChange(directors.filter((_, j) => j !== i))}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...directors, EMPTY_DIRECTOR])}>
        <Plus className="h-3.5 w-3.5" /> Add director
      </Button>
    </div>
  );
}

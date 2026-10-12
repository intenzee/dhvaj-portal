'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil } from 'lucide-react';
import {
  COMPANY_SUBTYPES,
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
  cin: [
    ['msmeDuesOver45Days', 'MSME dues over 45 days (MSME-1)'],
    ['depositsOrExemptedLoans', 'Deposits / exempted loans (DPT-3)'],
    ['auditorAppointedAtAgm', 'Auditor appointed at the AGM (ADT-1)'],
  ],
  llpin: [],
};

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
            <ProfileRow key={s.key} slot={s} onEdit={() => setEditing(s.key)} />
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

function ProfileRow({ slot, onEdit }: { slot: Slot; onEdit: () => void }): JSX.Element {
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
          {!p.gstScheme && flags.length === 0 && typeof turnover !== 'number' && !subtype && (
            <span className="text-xs text-ink-faint">Nothing flagged.</span>
          )}
        </div>
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
          attributes: attrs,
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

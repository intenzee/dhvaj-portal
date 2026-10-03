'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ADDRESS_TYPES,
  EXCHANGES,
  FINANCIAL_SOURCES,
  RELATIONSHIP_TYPES,
  SECURITY_TYPES,
  type ClientMasterSection,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { EntityDetail, EntityRow, FinancialProfile, Industry } from '@/lib/types';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';
import { AddContactModal, AddRegistrationModal, EditEntityModal } from './entity-actions';

/**
 * Every part of the client master the audit file reads, editable from Client
 * 360 — and reachable by link (`/entities/:id?edit=<section>`), so a "missing"
 * or "not on master" item anywhere in the portal opens the exact form to fill.
 */

/** The page anchor for each section (the card the form belongs to). */
export const SECTION_ANCHOR: Record<ClientMasterSection, string> = {
  details: 'client-details',
  registrations: 'client-registrations',
  contacts: 'client-contacts',
  financials: 'client-financials',
  addresses: 'client-addresses',
  relationships: 'client-relationships',
  industries: 'client-industries',
  listings: 'client-listings',
  regulatory: 'client-regulatory',
};

/** Which form answers a "missing / pending information" item on the client. */
export function missingInfoSection(code: string): ClientMasterSection {
  if (code === 'registrations' || code === 'cin' || code === 'llpin') return 'registrations';
  if (code === 'primary_contact') return 'contacts';
  if (code === 'financials') return 'financials';
  return 'details'; // pan, incorporation_date, legal_status, …
}

export const isClientMasterSection = (v: string | null): v is ClientMasterSection =>
  v != null && v in SECTION_ANCHOR;

export function ClientMasterModal({
  entity,
  section,
  financialYear,
  onClose,
}: {
  entity: EntityDetail;
  section: ClientMasterSection;
  /** Prefills the year on the figures form (from an audit file's link). */
  financialYear?: string | null;
  onClose: () => void;
}): JSX.Element {
  switch (section) {
    case 'details':
      return <EditEntityModal entity={entity} onClose={onClose} />;
    case 'registrations':
      return <AddRegistrationModal entityId={entity.id} onClose={onClose} />;
    case 'contacts':
      return <AddContactModal entityId={entity.id} onClose={onClose} />;
    case 'financials':
      return (
        <FinancialFiguresModal entity={entity} financialYear={financialYear} onClose={onClose} />
      );
    case 'addresses':
      return <AddressModal entityId={entity.id} onClose={onClose} />;
    case 'relationships':
      return <RelationshipModal entity={entity} onClose={onClose} />;
    case 'industries':
      return <IndustryModal entityId={entity.id} onClose={onClose} />;
    case 'listings':
      return <ListingModal entityId={entity.id} onClose={onClose} />;
    case 'regulatory':
      return <RegulatoryFactModal entity={entity} onClose={onClose} />;
  }
}

function useSave(entityId: string, onClose: () => void, done: string, failed: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return {
    onSuccess: () => {
      toast(done);
      // The client and every audit file reading it.
      void qc.invalidateQueries({ queryKey: ['entity', entityId] });
      void qc.invalidateQueries({ queryKey: ['entities'] });
      void qc.invalidateQueries({ queryKey: ['engagement'] });
      onClose();
    },
    onError: (err: unknown) => toast(err instanceof ApiError ? err.message : failed, 'error'),
  };
}

function Footer({
  onClose,
  disabled,
  pending,
  label,
  onSave,
}: {
  onClose: () => void;
  disabled: boolean;
  pending: boolean;
  label: string;
  onSave: () => void;
}): JSX.Element {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button disabled={disabled || pending} onClick={onSave}>
        {pending ? 'Saving…' : label}
      </Button>
    </>
  );
}

// ── Financial figures (one year) ─────────────────────────────────────────────

const FIGURES: Array<[keyof FinancialProfile, string]> = [
  ['revenue', 'Revenue from operations'],
  ['otherIncome', 'Other income'],
  ['turnover', 'Turnover'],
  ['profitBeforeTax', 'Profit before tax'],
  ['netProfit', 'Net profit'],
  ['paidUpCapital', 'Paid-up capital'],
  ['reservesSurplus', 'Reserves & surplus'],
  ['netWorth', 'Net worth'],
  ['totalAssets', 'Total assets'],
  ['totalBorrowings', 'Total borrowings'],
  ['bankPfiBorrowings', 'Bank / FI borrowings'],
  ['publicDeposits', 'Public deposits'],
];

/** The current Indian financial year label, e.g. `2025-26`. */
function currentFinancialYear(today = new Date()): string {
  const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function FinancialFiguresModal({
  entity,
  financialYear,
  onClose,
}: {
  entity: EntityDetail;
  financialYear?: string | null;
  onClose: () => void;
}): JSX.Element {
  const current = (fy: string) =>
    entity.financialProfiles.find((f) => f.isCurrent && f.financialYear === fy);
  const [fy, setFy] = useState(financialYear ?? currentFinancialYear());
  const seed = (fy: string) =>
    Object.fromEntries(
      FIGURES.map(([k]) => {
        const v = current(fy)?.[k];
        return [k, typeof v === 'number' ? String(v) : ''];
      }),
    ) as Record<string, string>;
  const [values, setValues] = useState<Record<string, string>>(() => seed(fy));
  const [source, setSource] = useState<string>(current(fy)?.source ?? 'provisional_financials');
  const fyValid = /^\d{4}-\d{2}$/.test(fy);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/entities/${entity.id}/financial-profiles`, {
        method: 'POST',
        body: {
          financialYear: fy,
          source,
          ...Object.fromEntries(
            Object.entries(values)
              .filter(([, v]) => v.trim() !== '')
              .map(([k, v]) => [k, Number(v)]),
          ),
        },
      }),
    ...useSave(entity.id, onClose, `Figures for FY ${fy} saved.`, 'Could not save the figures.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Financial figures"
      wide
      footer={
        <Footer
          onClose={onClose}
          disabled={!fyValid}
          pending={save.isPending}
          label="Save figures"
          onSave={() => save.mutate()}
        />
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-ink-muted">
          Saving records a new version of the year&rsquo;s figures; the earlier version is kept for
          the audit trail. Every audit file for this client reads the current version.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Financial year" required hint={fyValid ? undefined : 'Format 2024-25.'}>
            <Input
              value={fy}
              onChange={(e) => {
                setFy(e.target.value);
                if (/^\d{4}-\d{2}$/.test(e.target.value)) setValues(seed(e.target.value));
              }}
            />
          </Field>
          <Field label="Source">
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              {FINANCIAL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FIGURES.map(([k, label]) => (
            <Field key={k} label={`${label} (₹)`}>
              <Input
                type="number"
                value={values[k] ?? ''}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ── Address ──────────────────────────────────────────────────────────────────

export function AddressModal({
  entityId,
  onClose,
}: {
  entityId: string;
  onClose: () => void;
}): JSX.Element {
  const [addressType, setAddressType] = useState<string>('branch');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/entities/${entityId}/addresses`, {
        method: 'POST',
        body: {
          addressType,
          line1: line1.trim(),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(state.trim() ? { state: state.trim() } : {}),
          ...(pincode.trim() ? { pincode: pincode.trim() } : {}),
        },
      }),
    ...useSave(entityId, onClose, 'Address added.', 'Could not add the address.'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add address"
      footer={
        <Footer
          onClose={onClose}
          disabled={!line1.trim()}
          pending={save.isPending}
          label="Add address"
          onSave={() => save.mutate()}
        />
      }
    >
      <div className="space-y-3">
        <Field label="Type" hint="Branches drive the §143(8) branch-auditor framework.">
          <Select value={addressType} onChange={(e) => setAddressType(e.target.value)}>
            {ADDRESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Address line" required>
          <Input value={line1} onChange={(e) => setLine1(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="State">
            <Input value={state} onChange={(e) => setState(e.target.value)} />
          </Field>
          <Field label="PIN code">
            <Input value={pincode} onChange={(e) => setPincode(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ── Group relationship ───────────────────────────────────────────────────────

export function RelationshipModal({
  entity,
  onClose,
}: {
  entity: EntityDetail;
  onClose: () => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [other, setOther] = useState<{ id: string; legalName: string } | null>(null);
  const [type, setType] = useState<string>('subsidiary');
  // 'this' = "this client IS <type> OF other"; 'other' = "other IS <type> OF this client".
  const [subject, setSubject] = useState<'this' | 'other'>('other');
  const [pct, setPct] = useState('');

  const found = useQuery({
    queryKey: ['entities', 'search', search],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(`/entities?search=${encodeURIComponent(search)}&limit=8`),
    enabled: search.trim().length >= 2,
  });

  const save = useMutation({
    mutationFn: () => {
      const from = subject === 'this' ? entity.id : other!.id;
      const to = subject === 'this' ? other!.id : entity.id;
      return apiFetch(`/entities/${from}/relationships`, {
        method: 'POST',
        body: {
          toEntityId: to,
          relationshipType: type,
          ...(pct.trim() ? { shareholdingPct: Number(pct) } : {}),
        },
      });
    },
    ...useSave(entity.id, onClose, 'Relationship added.', 'Could not add the relationship.'),
  });

  const sentence = other
    ? subject === 'this'
      ? `${entity.legalName} is the ${humanize(type).toLowerCase()} of ${other.legalName}`
      : `${other.legalName} is the ${humanize(type).toLowerCase()} of ${entity.legalName}`
    : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Add group relationship"
      wide
      footer={
        <Footer
          onClose={onClose}
          disabled={!other}
          pending={save.isPending}
          label="Add relationship"
          onSave={() => save.mutate()}
        />
      }
    >
      <div className="space-y-3">
        <Field label="Other client" hint="Type at least two letters of its name or code.">
          <Input
            value={other ? other.legalName : search}
            onChange={(e) => {
              setOther(null);
              setSearch(e.target.value);
            }}
          />
        </Field>
        {!other && (found.data?.items.length ?? 0) > 0 && (
          <ul className="max-h-40 overflow-auto rounded-md border border-line text-sm">
            {found
              .data!.items.filter((x) => x.id !== entity.id)
              .map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left hover:bg-surface-sunken"
                    onClick={() => setOther({ id: x.id, legalName: x.legalName })}
                  >
                    {x.legalName} <span className="text-ink-faint">· {x.entityCode}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Who">
            <Select
              value={subject}
              onChange={(e) => setSubject(e.target.value as 'this' | 'other')}
            >
              <option value="other">The other client is the…</option>
              <option value="this">This client is the…</option>
            </Select>
          </Field>
          <Field label="Relationship">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {RELATIONSHIP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Holding (%)">
            <Input
              type="number"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          </Field>
        </div>
        {sentence && <p className="text-sm text-ink">Reads as: {sentence}.</p>}
      </div>
    </Modal>
  );
}

// ── Industry ─────────────────────────────────────────────────────────────────

export function IndustryModal({
  entityId,
  onClose,
}: {
  entityId: string;
  onClose: () => void;
}): JSX.Element {
  const industries = useQuery({
    queryKey: ['industries'],
    queryFn: () => apiFetch<Industry[]>('/industries'),
  });
  const [slug, setSlug] = useState('');
  const [isPrimary, setIsPrimary] = useState(true);
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/entities/${entityId}/business-activities`, {
        method: 'POST',
        body: { industrySlug: slug, isPrimary },
      }),
    ...useSave(entityId, onClose, 'Industry added.', 'Could not add the industry.'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add industry"
      footer={
        <Footer
          onClose={onClose}
          disabled={!slug}
          pending={save.isPending}
          label="Add industry"
          onSave={() => save.mutate()}
        />
      }
    >
      <div className="space-y-3">
        <Field
          label="Industry"
          hint="Banking, NBFC and insurance mark the special entity type in 02.1."
        >
          <Select value={slug} onChange={(e) => setSlug(e.target.value)}>
            <option value="">Choose…</option>
            {(industries.data ?? []).map((i) => (
              <option key={i.slug} value={i.slug}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
          />
          Primary industry
        </label>
      </div>
    </Modal>
  );
}

// ── Listing ──────────────────────────────────────────────────────────────────

export function ListingModal({
  entityId,
  onClose,
}: {
  entityId: string;
  onClose: () => void;
}): JSX.Element {
  const [exchange, setExchange] = useState<string>('nse');
  const [securityType, setSecurityType] = useState<string>('equity');
  const [symbol, setSymbol] = useState('');
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/entities/${entityId}/listings`, {
        method: 'POST',
        body: {
          exchange,
          securityType,
          status: 'listed',
          ...(symbol.trim() ? { symbol: symbol.trim().toUpperCase() } : {}),
        },
      }),
    ...useSave(entityId, onClose, 'Listing added.', 'Could not add the listing.'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Add listing"
      footer={
        <Footer
          onClose={onClose}
          disabled={false}
          pending={save.isPending}
          label="Add listing"
          onSave={() => save.mutate()}
        />
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Exchange">
          <Select value={exchange} onChange={(e) => setExchange(e.target.value)}>
            {EXCHANGES.map((x) => (
              <option key={x} value={x}>
                {x === 'sme' ? 'SME platform' : x.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Security">
          <Select value={securityType} onChange={(e) => setSecurityType(e.target.value)}>
            {SECURITY_TYPES.map((x) => (
              <option key={x} value={x}>
                {humanize(x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Symbol">
          <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Regulatory facts ─────────────────────────────────────────────────────────

export function RegulatoryFactModal({
  entity,
  onClose,
}: {
  entity: EntityDetail;
  onClose: () => void;
}): JSX.Element {
  const has = (code: string) => entity.regulatoryAttributes.some((a) => a.attributeCode === code);
  const [government, setGovernment] = useState(
    entity.regulatoryAttributes.find((a) => a.attributeCode === 'is_government_company')
      ?.valueBoolean ?? false,
  );
  const [sector, setSector] = useState('');
  const [status, setStatus] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      if (government && !has('is_government_company'))
        await apiFetch(`/entities/${entity.id}/regulatory-attributes`, {
          method: 'POST',
          body: { attributeCode: 'is_government_company', valueBoolean: true },
        });
      if (sector.trim())
        await apiFetch(`/entities/${entity.id}/regulatory-attributes`, {
          method: 'POST',
          body: { attributeCode: 'regulated_sector', valueText: sector.trim() },
        });
      if (status.trim())
        await apiFetch(`/entities/${entity.id}/regulatory-attributes`, {
          method: 'POST',
          body: { attributeCode: 'special_regulatory_status', valueText: status.trim() },
        });
    },
    ...useSave(
      entity.id,
      onClose,
      'Regulatory facts saved.',
      'Could not save the regulatory facts.',
    ),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Regulatory facts"
      footer={
        <Footer
          onClose={onClose}
          disabled={
            !sector.trim() && !status.trim() && !(government && !has('is_government_company'))
          }
          pending={save.isPending}
          label="Save"
          onSave={() => save.mutate()}
        />
      }
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={government}
            disabled={has('is_government_company')}
            onChange={(e) => setGovernment(e.target.checked)}
          />
          Government company (§2(45))
        </label>
        <Field
          label="Regulated sector"
          hint="e.g. NBFC, Banking, Insurance, Housing finance, SEBI intermediary."
        >
          <Input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            list="regulated-sectors"
          />
          <datalist id="regulated-sectors">
            {['NBFC', 'Banking', 'Insurance', 'Housing finance (HFC)', 'SEBI intermediary'].map(
              (x) => (
                <option key={x} value={x} />
              ),
            )}
          </datalist>
        </Field>
        <Field
          label="Special status"
          hint="e.g. Section 8 company, Nidhi company, Producer company, Dormant u/s 455."
        >
          <Input
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            list="special-statuses"
          />
          <datalist id="special-statuses">
            {['Section 8 company', 'Nidhi company', 'Producer company', 'Dormant u/s 455'].map(
              (x) => (
                <option key={x} value={x} />
              ),
            )}
          </datalist>
        </Field>
      </div>
    </Modal>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Link2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  ACCOUNTING_ENVIRONMENTS,
  ACCOUNTING_ENVIRONMENT_LABEL,
  ACCOUNTING_SOFTWARES,
  ACCOUNTING_SOFTWARE_LABEL,
  AUTHORITY_REFERENCE_ACTION,
  COMPANY_TYPE_LABEL,
  COMPLETENESS_STATUS_LABEL,
  CONFIRMABLE_PROFILE_CARDS,
  MASTER_OWNED_SPECIAL_TYPES,
  PROFILE_CARD_TITLE,
  PROFILE_CONFIRMATION_STATEMENT,
  PROFILE_FINANCIAL_SOURCES,
  PROFILE_FINANCIAL_SOURCE_LABEL,
  REGULATORS,
  REGULATOR_LABEL,
  SMALL_COMPANY_OUTCOME_LABEL,
  SPECIAL_ENTITY_LABEL,
  SPECIAL_ENTITY_TYPES,
  type AccountingEnvironment,
  type AccountingSoftware,
  type AuthorityReference,
  type CompletenessStatus,
  type ConfirmableProfileCard,
  type ProfileCardKey,
  type ProfileCardState,
  type ProfileCardStatus,
  type ProfileFileRecord,
  type ProfileFinancialRow,
  type ProfileFinancialSource,
  type Regulator,
  type SectionNavStatus,
  type ServiceOrgAnswer,
  type SpecialEntityType,
  type StatutoryAuditEntityProfile,
  type UpdateEntityProfileInput,
  type YesNo,
  type YesNoPending,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { blobToBase64 } from '@/lib/file-kind';
import { formatDate, formatMoney } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Badge, Button, Card } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { DocumentPreview } from '@/components/document-preview';
import { LinkPicker } from './acceptance-file-card';
import { FixLink } from './master-fact-list';

/**
 * 02.1 Entity & Regulatory Profile workspace (DHVAJ 02.1 web developer
 * specification §2–§20). Left: the Section 02 navigation with each
 * sub-section's status. Centre: Cards A–J, edited through one draft (Save
 * Draft) and confirmed card by card. Right: the selected card's context —
 * source, confirmation, evidence files, last year's value and the
 * View Provision / View Standard viewer. Footer: Save Draft and CONFIRM
 * PROFILE behind the confirmation statement; a confirmed profile reopens only
 * with a reason. Everything opens in place — never a pop-up.
 */

type Draft = Required<Omit<UpdateEntityProfileInput, 'version' | 'jointAuditors'>> & {
  jointAuditors: Array<{ firmName: string; frn: string; contact: string }>;
};

function draftOf(p: StatutoryAuditEntityProfile): Draft {
  return {
    specialEntityTypes: [...p.specialEntityTypes].sort(),
    initialAudit: p.initialAudit,
    jointAudit: p.jointAudit,
    accountingEnvironment: p.accountingEnvironment,
    listingAnswer: p.listing.answer,
    listingInProcess: p.listing.inProcess,
    nbfcCategory: p.nbfcCategory,
    regulator: p.regulator,
    regulatorName: p.regulatorName,
    regulatorDetails: p.regulatorDetails,
    differentFyApproved: p.period.differentFyApproved,
    accountingSoftware: p.accounting.software,
    accountingSoftwareOther: p.accounting.softwareOther,
    recordsElectronic: p.accounting.recordsElectronic,
    recordsDescription: p.accounting.recordsDescription,
    serviceOrg: p.accounting.serviceOrg,
    serviceOrgService: p.accounting.serviceOrgService,
    serviceOrgProvider: p.accounting.serviceOrgProvider,
    jointAuditors: p.jointAuditors.map((j) => ({
      firmName: j.firmName,
      frn: j.frn ?? '',
      contact: j.contact ?? '',
    })),
  };
}

/** Only the fields the Manager changed — an untouched field keeps its system value. */
export function draftChanges(
  draft: Draft,
  base: Draft,
): Omit<UpdateEntityProfileInput, 'version'> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as Array<keyof Draft>) {
    if (JSON.stringify(draft[key]) === JSON.stringify(base[key])) continue;
    if (key === 'jointAuditors') {
      out.jointAuditors = draft.jointAuditors
        .filter((j) => j.firmName.trim())
        .map((j) => ({
          firmName: j.firmName.trim(),
          frn: j.frn.trim() || null,
          contact: j.contact.trim() || null,
        }));
    } else {
      const v = draft[key];
      out[key] = typeof v === 'string' ? v.trim() || null : v;
    }
  }
  return out as Omit<UpdateEntityProfileInput, 'version'>;
}

const CARD_STATUS_LABEL: Record<ProfileCardStatus, string> = {
  system_suggested: 'System suggested',
  incomplete: 'Information pending',
  confirmed: 'Confirmed',
  attention: 'Attention required',
  derived: 'System derived',
};
const CARD_STATUS_TONE: Record<ProfileCardStatus, string> = {
  system_suggested: 'info',
  incomplete: 'warn',
  confirmed: 'success',
  attention: 'danger',
  derived: 'neutral',
};
const COMPLETENESS_TONE: Record<CompletenessStatus, string> = {
  complete: 'success',
  information_incomplete: 'warn',
  attention_required: 'danger',
};
const NAV_STATUS_LABEL: Record<SectionNavStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  needs_attention: 'Needs attention',
};
const NAV_STATUS_DOT: Record<SectionNavStatus, string> = {
  not_started: 'bg-line-strong',
  in_progress: 'bg-primary-500',
  complete: 'bg-success-600',
  needs_attention: 'bg-danger-600',
};

/** Where each card's facts come from (spec §4–§13, shown in the context panel). */
const CARD_SOURCE: Record<ProfileCardKey, string> = {
  A: 'Entity Master — entity type and listing lines (ERP-02 / ERP-03).',
  B: 'Client master industries and regulatory facts; Section 8 / Government status from the Entity Master.',
  C: 'Relationships master — holding, subsidiary, associate and joint-venture links.',
  D: 'Financial profile on the client master, or captured here with source and preparer.',
  E: 'Computed from the Section 2(85) rule version in force for the period.',
  F: 'Engagement financial year and the incorporation date (Section 2(41)).',
  G: 'Engagement history — whether DHVAJ audited the previous year.',
  H: 'Captured on 02.1; last year’s answers are carried as suggestions.',
  I: 'Captured on 02.1; last year’s joint auditors are carried as suggestions.',
  J: 'System calculated from Cards A–I.',
};

/** Provision / standard links shown on each card (spec §3, §19). */
const CARD_REFERENCES: Partial<Record<ProfileCardKey, string[]>> = {
  E: ['small_company'],
  F: ['financial_year'],
  G: ['initial_audit'],
  H: ['service_organisation'],
  I: ['joint_audit'],
};

/** Evidence-file slots on each card (spec §7, §9, §11, §12). */
const CARD_FILE_SLOTS: Partial<Record<ProfileCardKey, Array<{ slot: string; label: string }>>> = {
  F: [{ slot: 'different_fy', label: 'Approval for a different financial year' }],
  H: [{ slot: 'service_org', label: 'Service agreement / SOC report' }],
  I: [{ slot: 'joint_audit', label: 'Work-allocation documentation' }],
};

/** Which card each prior-year tracked fact belongs to (spec §14). */
const PRIOR_YEAR_CARD: Record<string, ProfileCardKey> = {
  companyType: 'A',
  listing: 'A',
  specialEntityTypes: 'B',
  regulator: 'B',
  group: 'C',
  financials: 'D',
  smallCompany: 'E',
  period: 'F',
  initialAudit: 'G',
  accounting: 'H',
  serviceOrg: 'H',
  jointAudit: 'I',
};

const YNP_LABEL: Record<YesNoPending, string> = {
  yes: 'Yes',
  no: 'No',
  pending: 'Information Pending',
};
const SERVICE_ORG_LABEL: Record<ServiceOrgAnswer, string> = {
  yes: 'Yes',
  no: 'No',
  to_be_assessed: 'To be assessed',
};

export function EntityProfileWorkspace({
  engagementId,
  profile: p,
  canManage,
  canAdmin,
}: {
  engagementId: string;
  profile: StatutoryAuditEntityProfile;
  canManage: boolean;
  /** Methodology administration — maintains the provision viewer's content. */
  canAdmin: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/engagements/${engagementId}/statutory-audit/${p.workflowInstanceId}/profile`;
  const editable = canManage && (p.state === 'draft' || p.needsReevaluation);

  const original = useMemo(() => draftOf(p), [p]);
  const [draft, setDraft] = useState<Draft>(original);
  // A new server version (our own save, or a refresh) resets the draft.
  useEffect(() => setDraft(original), [original]);
  const changes = draftChanges(draft, original);
  const dirty = Object.keys(changes).length > 0;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const [selected, setSelected] = useState<ProfileCardKey>('A');
  const [busy, setBusy] = useState<string | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });

  /** Run one profile action: save the draft first when needed, then refresh. */
  const run = async (label: string, fn: (version: number) => Promise<unknown>, done?: string) => {
    setBusy(label);
    try {
      let version = p.version;
      if (dirty && label !== 'save') {
        const saved = await apiFetch<StatutoryAuditEntityProfile>(base, {
          method: 'POST',
          body: { ...changes, version },
        });
        version = saved.version;
      }
      await fn(version);
      if (done) toast(done);
      invalidate();
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the profile.', 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };
  const post = (path: string, body: object) =>
    apiFetch<StatutoryAuditEntityProfile>(`${base}${path}`, { method: 'POST', body });

  const saveDraft = () =>
    run('save', (version) => post('', { ...changes, version }), 'Draft saved.');
  const confirmCard = (card: ConfirmableProfileCard) =>
    run(
      `confirm:${card}`,
      (version) =>
        card === 'E'
          ? post('/small-company', { action: 'confirm', version })
          : post('/cards/confirm', { card, version }),
      `${PROFILE_CARD_TITLE[card]} confirmed.`,
    );

  const cardState = (key: ProfileCardKey): ProfileCardState | undefined =>
    p.cards.find((c) => c.key === key);
  const refsFor = (key: ProfileCardKey): AuthorityReference[] =>
    (CARD_REFERENCES[key] ?? [])
      .map((a) => p.references.find((r) => r.anchor === a))
      .filter((r): r is AuthorityReference => !!r);
  const itemsFor = (key: ProfileCardKey) => p.completeness.items.filter((i) => i.card === key);

  const frame = (key: ProfileCardKey, children: ReactNode) => (
    <ProfileCardFrame
      key={key}
      cardKey={key}
      state={cardState(key)}
      selected={selected === key}
      onSelect={() => setSelected(key)}
      items={itemsFor(key)}
      references={refsFor(key)}
      canAdmin={canAdmin}
      confirm={
        editable && (CONFIRMABLE_PROFILE_CARDS as readonly string[]).includes(key) && key !== 'E'
          ? {
              busy: busy === `confirm:${key}`,
              onConfirm: () => void confirmCard(key as ConfirmableProfileCard),
            }
          : undefined
      }
    >
      {children}
    </ProfileCardFrame>
  );

  const fileSlots = (key: ProfileCardKey) =>
    (CARD_FILE_SLOTS[key] ?? []).map((s) => (
      <ProfileFileSlot
        key={s.slot}
        engagementId={engagementId}
        base={base}
        slot={s.slot}
        label={s.label}
        files={p.files}
        editable={editable}
        onChanged={invalidate}
      />
    ));

  return (
    <div className="mt-3 space-y-3">
      {p.needsReevaluation && p.state === 'confirmed' && (
        <p className="rounded-md border border-warning-600/40 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          {p.reopen
            ? `Reopened for re-evaluation${p.reopen.byName ? ` by ${p.reopen.byName}` : ''} on ${formatDate(p.reopen.at)}: ${p.reopen.reason}`
            : 'A fact on the client master changed after this profile was confirmed — review the cards and confirm the profile again.'}{' '}
          The affected 02.x assessments are marked Needs Re-evaluation.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)_280px]">
        {/* Left — Section 02 navigation */}
        <nav aria-label="Section 02" className="space-y-1 self-start lg:sticky lg:top-2">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Section 02 · Framework
          </p>
          {p.sectionNav.map((n) => (
            <div
              key={n.key}
              className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs ${
                n.key === '02.1' ? 'bg-primary-50 text-primary-700' : 'text-ink-muted'
              }`}
              title={NAV_STATUS_LABEL[n.status]}
            >
              <span
                aria-hidden
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${NAV_STATUS_DOT[n.status]}`}
              />
              <span className="min-w-0">
                <span className="font-mono">{n.key}</span> {n.title}
                {n.key === '02.1' && n.status === 'complete' && (
                  <span className="block font-semibold text-success-700">02.1 COMPLETE</span>
                )}
                <span className="sr-only"> — {NAV_STATUS_LABEL[n.status]}</span>
              </span>
            </div>
          ))}
        </nav>

        {/* Centre — Cards A–J */}
        <div className="min-w-0 space-y-3">
          {frame(
            'A',
            <CardA
              p={p}
              draft={draft}
              set={set}
              editable={editable}
              fix={itemsFor('A').find((i) => i.fix)?.fix ?? null}
            />,
          )}
          {frame('B', <CardB p={p} draft={draft} set={set} editable={editable} />)}
          {frame('C', <CardC p={p} />)}
          {frame(
            'D',
            <CardD
              p={p}
              engagementId={engagementId}
              base={base}
              editable={editable}
              onChanged={invalidate}
            />,
          )}
          {frame(
            'E',
            <CardE
              p={p}
              editable={editable}
              busy={busy}
              onDecide={(body, done) =>
                run('small-company', (version) => post('/small-company', { ...body, version }), done)
              }
            />,
          )}
          {frame(
            'F',
            <>
              <CardF p={p} draft={draft} set={set} editable={editable} />
              {draft.differentFyApproved === 'yes' && fileSlots('F')}
            </>,
          )}
          {frame('G', <CardG p={p} draft={draft} set={set} editable={editable} />)}
          {frame(
            'H',
            <>
              <CardH p={p} draft={draft} set={set} editable={editable} />
              {draft.serviceOrg === 'yes' && fileSlots('H')}
            </>,
          )}
          {frame(
            'I',
            <>
              <CardI p={p} draft={draft} set={set} editable={editable} />
              {draft.jointAudit && fileSlots('I')}
            </>,
          )}
          {frame(
            'J',
            <CardJ
              p={p}
              onGo={(card) => {
                setSelected(card);
                document
                  .getElementById(`profile-card-${card}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />,
          )}

          <ProfileFooter
            p={p}
            editable={editable}
            canManage={canManage}
            dirty={dirty}
            busy={busy}
            onSave={() => void saveDraft()}
            onConfirm={(note) =>
              run(
                'confirm',
                () => post('/confirm', { acknowledged: true, ...(note ? { note } : {}) }),
                'Profile confirmed — the facts are available to 02.2–02.9.',
              )
            }
            onReopen={(reason) =>
              run(
                'reopen',
                () => post('/reopen', { reason }),
                'Profile reopened — correct the facts and confirm again.',
              )
            }
          />
        </div>

        {/* Right — context panel */}
        <ContextPanel
          p={p}
          card={selected}
          references={refsFor(selected)}
          canAdmin={canAdmin}
          fileSlots={fileSlots(selected)}
        />
      </div>
    </div>
  );
}

// ── Card frame ─────────────────────────────────────────────────────────────────

function ProfileCardFrame({
  cardKey,
  state,
  selected,
  onSelect,
  items,
  references,
  canAdmin,
  confirm,
  children,
}: {
  cardKey: ProfileCardKey;
  state: ProfileCardState | undefined;
  selected: boolean;
  onSelect: () => void;
  items: StatutoryAuditEntityProfile['completeness']['items'];
  references: AuthorityReference[];
  canAdmin: boolean;
  confirm?: { busy: boolean; onConfirm: () => void };
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  const status = state?.status;
  const blockers = items.filter((i) => i.kind !== 'unconfirmed' && !i.key.startsWith('stale:'));
  return (
    <Card
      id={`profile-card-${cardKey}`}
      className={`scroll-mt-2 p-4 ${selected ? 'ring-2 ring-primary-500/40' : ''}`}
      onFocusCapture={onSelect}
      onClick={onSelect}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="group flex items-center gap-2.5 text-left"
        >
          <ExpandToggle open={open} />
          <span className="font-mono text-xs text-ink-faint">Card {cardKey}</span>
          <span className="text-sm font-semibold text-ink">{PROFILE_CARD_TITLE[cardKey]}</span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          {status && (
            <Badge tone={CARD_STATUS_TONE[status]}>{CARD_STATUS_LABEL[status]}</Badge>
          )}
          {state?.confirmation && (
            <span className="text-[11px] text-ink-faint">
              {state.confirmation.stale ? 'Changed since confirmed by ' : 'Confirmed by '}
              {state.confirmation.confirmedByName ?? '—'} ·{' '}
              {formatDate(state.confirmation.confirmedAt)}
            </span>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-3 pl-7">
          {children}
          {blockers.length > 0 && (
            <ul className="space-y-0.5 text-xs text-warning-700">
              {blockers.map((i) => (
                <li key={i.key} className="flex flex-wrap items-baseline gap-x-2">
                  <span>• {i.label}</span>
                  {i.fix && <FixLink fix={i.fix} missing />}
                </li>
              ))}
            </ul>
          )}
          {(references.length > 0 || confirm) && (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                {references.map((r) => (
                  <ReferenceLink key={r.anchor} reference={r} canAdmin={canAdmin} />
                ))}
              </div>
              {confirm && (
                <Button
                  size="sm"
                  variant={status === 'confirmed' ? 'secondary' : 'primary'}
                  disabled={confirm.busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    confirm.onConfirm();
                  }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {status === 'confirmed' ? 'Re-confirm' : 'Confirm'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

type CardProps = {
  p: StatutoryAuditEntityProfile;
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  editable: boolean;
};

function ReadOnlyFact({
  label,
  value,
  source,
}: {
  label: string;
  value: ReactNode;
  source?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
        {label}
        {source && <span className="normal-case tracking-normal"> · {source}</span>}
      </dt>
      <dd className="text-sm text-ink">{value ?? '—'}</dd>
    </div>
  );
}

function ChoiceSelect<T extends string>({
  label,
  value,
  options,
  labels,
  disabled,
  onChange,
  hint,
  required,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  labels: Record<T, string>;
  disabled: boolean;
  onChange: (v: T | null) => void;
  hint?: string;
  required?: boolean;
}): JSX.Element {
  return (
    <Field label={label} hint={hint} required={required}>
      <Select
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange((e.target.value || null) as T | null)}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const YNP = ['yes', 'no', 'pending'] as const;
const YN = ['yes', 'no'] as const;
const YN_LABEL: Record<YesNo, string> = { yes: 'Yes', no: 'No' };

// ── Card A — basic classification ─────────────────────────────────────────────

function CardA({
  p,
  draft,
  set,
  editable,
  fix,
}: CardProps & { fix: StatutoryAuditEntityProfile['missingFactFixes'][number] }): JSX.Element {
  const masterListing = p.listing.masterListed
    ? `Listed${p.listing.lines.length ? ` — ${p.listing.lines.map((l) => `${l.exchange.toUpperCase()} ${l.securityType}${l.symbol ? ` (${l.symbol})` : ''}`).join(', ')}` : ''}`
    : p.listing.masterInProcess
      ? 'Unlisted — listing in process'
      : 'Unlisted';
  return (
    <>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <ReadOnlyFact
          label="Entity type"
          value={p.classification.entityTypeName}
          source="Entity Master"
        />
        <ReadOnlyFact
          label="Company type"
          value={p.companyType ? COMPANY_TYPE_LABEL[p.companyType] : 'Not a company'}
          source="Derived"
        />
        <ReadOnlyFact label="Listing on master" value={masterListing} source="Entity Master" />
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceSelect<YesNoPending>
          label="Are any securities of the company listed?"
          value={draft.listingAnswer}
          options={YNP}
          labels={YNP_LABEL}
          disabled={!editable}
          required
          hint={`Entity Master suggests: ${p.listing.masterListed ? 'Yes' : 'No'}`}
          onChange={(v) => set('listingAnswer', v)}
        />
        <ChoiceSelect<YesNoPending>
          label="Is the company in the process of listing any securities?"
          value={draft.listingInProcess}
          options={YNP}
          labels={YNP_LABEL}
          disabled={!editable}
          required
          hint={`Entity Master suggests: ${p.listing.masterInProcess ? 'Yes' : 'No'}`}
          onChange={(v) => set('listingInProcess', v)}
        />
      </div>
      {fix && (
        <p className="text-xs text-ink-muted">
          Listing lines are held on the Entity Master. <FixLink fix={fix} missing={false} />
        </p>
      )}
    </>
  );
}

// ── Card B — special entity classification ────────────────────────────────────

function CardB({ p, draft, set, editable }: CardProps): JSX.Element {
  const toggle = (t: SpecialEntityType, on: boolean) =>
    set(
      'specialEntityTypes',
      (on
        ? [...draft.specialEntityTypes, t]
        : draft.specialEntityTypes.filter((x) => x !== t)
      ).sort(),
    );
  const has = (t: SpecialEntityType) => draft.specialEntityTypes.includes(t);
  return (
    <>
      <table className="w-full text-xs">
        <thead className="text-left text-ink-faint">
          <tr>
            <th className="py-1 font-medium">Classification</th>
            <th className="py-1 font-medium">Applies</th>
            <th className="py-1 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {SPECIAL_ENTITY_TYPES.map((t) => {
            const masterOwned = MASTER_OWNED_SPECIAL_TYPES.includes(t);
            const suggested = p.specialEntitySuggested.includes(t);
            return (
              <tr key={t}>
                <td className="py-1.5 text-ink">{SPECIAL_ENTITY_LABEL[t]}</td>
                <td className="py-1.5">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={has(t)}
                      disabled={!editable || masterOwned}
                      onChange={(e) => toggle(t, e.target.checked)}
                      aria-label={SPECIAL_ENTITY_LABEL[t]}
                    />
                    {has(t) ? 'Yes' : 'No'}
                  </label>
                </td>
                <td className="py-1.5 text-ink-faint">
                  {masterOwned
                    ? 'System value — Entity Master'
                    : suggested
                      ? 'Suggested by the client master'
                      : 'Audit team'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {has('nbfc') && (
        <Field label="NBFC category" hint="e.g. NBFC-ICC, NBFC-MFI, Core Investment Company">
          <Input
            value={draft.nbfcCategory ?? ''}
            disabled={!editable}
            onChange={(e) => set('nbfcCategory', e.target.value)}
          />
        </Field>
      )}
      {has('other_regulator') && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceSelect<Regulator>
            label="Regulator"
            value={draft.regulator}
            options={REGULATORS}
            labels={REGULATOR_LABEL}
            disabled={!editable}
            required
            onChange={(v) => set('regulator', v)}
          />
          {draft.regulator === 'other' && (
            <Field label="Regulator name" required>
              <Input
                value={draft.regulatorName ?? ''}
                disabled={!editable}
                onChange={(e) => set('regulatorName', e.target.value)}
              />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Regulatory details">
              <Textarea
                rows={2}
                value={draft.regulatorDetails ?? ''}
                disabled={!editable}
                onChange={(e) => set('regulatorDetails', e.target.value)}
              />
            </Field>
          </div>
        </div>
      )}
    </>
  );
}

// ── Card C — group structure ──────────────────────────────────────────────────

function CardC({ p }: { p: StatutoryAuditEntityProfile }): JSX.Element {
  const flags: Array<[string, boolean]> = [
    ['Holding company', p.groupFlags.isHolding],
    ['Subsidiary', p.groupFlags.isSubsidiary],
    ['Associate', p.groupFlags.isAssociate],
    ['Joint venture', p.groupFlags.isJointVenture],
  ];
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {flags.map(([label, on]) => (
          <Badge key={label} tone={on ? 'info' : 'neutral'}>
            {label}: {on ? 'Yes' : 'No'}
          </Badge>
        ))}
      </div>
      {p.groupEntities.length === 0 ? (
        <p className="text-xs text-ink-muted">No group relationships on the client master.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-ink-faint">
              <tr>
                <th className="py-1 font-medium">Entity</th>
                <th className="py-1 font-medium">Relationship</th>
                <th className="py-1 text-right font-medium">Interest %</th>
                <th className="py-1 font-medium">Country</th>
                <th className="py-1 font-medium">Auditor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.groupEntities.map((g) => (
                <tr key={`${g.entity}-${g.relationship}`}>
                  <td className="py-1.5 text-ink">{g.entity}</td>
                  <td className="py-1.5 text-ink-muted">{g.relationship}</td>
                  <td className="py-1.5 text-right text-ink-muted">
                    {g.interestPct == null ? '—' : `${g.interestPct}%`}
                  </td>
                  <td className="py-1.5 text-ink-muted">{g.country ?? '—'}</td>
                  <td className="py-1.5 text-ink-muted">{g.auditor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-faint">
        Group data is read from the relationships master — correct it there.
      </p>
    </>
  );
}

// ── Card D — applicability financial data ─────────────────────────────────────

function CardD({
  p,
  engagementId,
  base,
  editable,
  onChanged,
}: {
  p: StatutoryAuditEntityProfile;
  engagementId: string;
  base: string;
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  const [filesFor, setFilesFor] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-ink-faint">
          <tr>
            <th className="py-1 font-medium">Parameter</th>
            <th className="py-1 text-right font-medium">Current year</th>
            <th className="py-1 text-right font-medium">Prior year</th>
            <th className="py-1 pl-3 font-medium">Source</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {p.financialRows.map((row) => {
            const slot = `financial:${row.parameter}`;
            const fileCount = p.files.filter((f) => f.slot === slot).length;
            return (
              <FinancialRowView
                key={row.parameter}
                row={row}
                editing={editing === row.parameter}
                showFiles={filesFor === row.parameter}
                fileCount={fileCount}
                editable={editable}
                onEdit={() => setEditing(editing === row.parameter ? null : row.parameter)}
                onFiles={() => setFilesFor(filesFor === row.parameter ? null : row.parameter)}
                base={base}
                onSaved={() => {
                  setEditing(null);
                  onChanged();
                }}
                files={
                  <ProfileFileSlot
                    engagementId={engagementId}
                    base={base}
                    slot={slot}
                    label={`Source document — ${row.label}`}
                    files={p.files}
                    editable={editable}
                    onChanged={onChanged}
                  />
                }
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function money(v: number | null): string {
  return v == null ? '—' : formatMoney(v);
}

function FinancialRowView({
  row,
  editing,
  showFiles,
  fileCount,
  editable,
  onEdit,
  onFiles,
  base,
  onSaved,
  files,
}: {
  row: ProfileFinancialRow;
  editing: boolean;
  showFiles: boolean;
  fileCount: number;
  editable: boolean;
  onEdit: () => void;
  onFiles: () => void;
  base: string;
  onSaved: () => void;
  files: ReactNode;
}): JSX.Element {
  const source = row.current.sourceLabel
    ? `${row.current.sourceLabel}${row.current.asOf ? ` · as of ${formatDate(row.current.asOf)}` : ''}`
    : 'Not available';
  return (
    <>
      <tr className={row.conflict ? 'bg-danger-50/40' : undefined}>
        <td className="py-1.5 text-ink">
          {row.label}
          {row.required && <span className="ml-0.5 text-danger-600">*</span>}
        </td>
        <td className="py-1.5 text-right text-ink">{money(row.current.value)}</td>
        <td className="py-1.5 text-right text-ink-muted">{money(row.prior.value)}</td>
        <td className="py-1.5 pl-3 text-ink-faint">
          {source}
          {row.captured?.preparer && <span className="block">Prepared by {row.captured.preparer}</span>}
        </td>
        <td className="whitespace-nowrap py-1.5 text-right">
          {editable && (
            <Button size="sm" variant="ghost" onClick={onEdit} aria-expanded={editing}>
              {row.captured ? 'Edit Amount' : 'Enter Amount'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onFiles} aria-expanded={showFiles}>
            Files{fileCount ? ` (${fileCount})` : ''}
          </Button>
        </td>
      </tr>
      {row.conflict && (
        <tr>
          <td colSpan={5} className="pb-1.5 text-danger-700">
            {row.conflict}
          </td>
        </tr>
      )}
      {editing && (
        <tr>
          <td colSpan={5} className="py-2">
            <FinancialEditor row={row} base={base} onSaved={onSaved} onCancel={onEdit} />
          </td>
        </tr>
      )}
      {showFiles && (
        <tr>
          <td colSpan={5} className="py-2">
            {files}
          </td>
        </tr>
      )}
    </>
  );
}

function FinancialEditor({
  row,
  base,
  onSaved,
  onCancel,
}: {
  row: ProfileFinancialRow;
  base: string;
  onSaved: () => void;
  onCancel: () => void;
}): JSX.Element {
  const toast = useToast();
  const [current, setCurrent] = useState(row.current.value?.toString() ?? '');
  const [prior, setPrior] = useState(row.prior.value?.toString() ?? '');
  const [source, setSource] = useState<ProfileFinancialSource | ''>(
    row.captured?.source ?? 'audited_financials',
  );
  const [busy, setBusy] = useState(false);
  const parse = (s: string): number | null | 'bad' => {
    if (!s.trim()) return null;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 'bad';
  };
  const cv = parse(current);
  const pv = parse(prior);
  const invalid = cv === 'bad' || pv === 'bad';
  return (
    <form
      className="space-y-2 rounded-md border border-primary-600/30 border-l-4 border-l-primary-600 bg-surface p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (invalid) return;
        setBusy(true);
        try {
          await apiFetch(`${base}/financials`, {
            method: 'POST',
            body: {
              parameter: row.parameter,
              currentValue: cv,
              priorValue: pv,
              source: source || null,
            },
          });
          toast(`${row.label} saved.`);
          onSaved();
        } catch (err) {
          toast(err instanceof ApiError ? err.message : 'Could not save the figure.', 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Current year (₹)">
          <Input inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Prior year (₹)">
          <Input inputMode="decimal" value={prior} onChange={(e) => setPrior(e.target.value)} />
        </Field>
        <Field label="Source">
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value as ProfileFinancialSource | '')}
          >
            <option value="">Select…</option>
            {PROFILE_FINANCIAL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {PROFILE_FINANCIAL_SOURCE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={busy || invalid}>
          Save figure
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {invalid && <span className="text-[11px] text-danger-700">Enter a positive amount.</span>}
      </div>
    </form>
  );
}

// ── Card E — small company ────────────────────────────────────────────────────

function CardE({
  p,
  editable,
  busy,
  onDecide,
}: {
  p: StatutoryAuditEntityProfile;
  editable: boolean;
  busy: string | null;
  onDecide: (
    body: { action: 'confirm' | 'override' | 'clear_override'; outcome?: string; reason?: string },
    done: string,
  ) => Promise<boolean>;
}): JSX.Element {
  const c = p.smallCompanyConclusion;
  const [overriding, setOverriding] = useState(false);
  const [outcome, setOutcome] = useState<'small' | 'not_small'>(
    c.systemOutcome === 'small' ? 'not_small' : 'small',
  );
  const [reason, setReason] = useState('');
  const confirmedE = p.cards.find((x) => x.key === 'E')?.status === 'confirmed';
  return (
    <>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <ReadOnlyFact
          label="System assessment"
          value={SMALL_COMPANY_OUTCOME_LABEL[c.systemOutcome]}
          source="Section 2(85)"
        />
        <ReadOnlyFact
          label="Professional conclusion"
          value={
            <>
              {SMALL_COMPANY_OUTCOME_LABEL[c.finalOutcome]}
              {c.override && <Badge tone="warn" className="ml-1.5">Overridden</Badge>}
            </>
          }
        />
      </dl>
      <p className="text-xs text-ink-muted">{p.smallCompany.basis}</p>
      {c.factsConsidered.length > 0 && (
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {c.factsConsidered.map((f) => (
            <div key={f.label} className="flex justify-between gap-2">
              <dt className="text-ink-faint">{f.label}</dt>
              <dd className="text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {c.override && (
        <p className="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-700">
          Override to {SMALL_COMPANY_OUTCOME_LABEL[c.override.outcome]}
          {c.override.byName ? ` by ${c.override.byName}` : ''} on {formatDate(c.override.at)} —{' '}
          {c.override.reason}
          {c.override.systemOutcomeAtOverride &&
            ` (system said: ${SMALL_COMPANY_OUTCOME_LABEL[c.override.systemOutcomeAtOverride]})`}
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={confirmedE ? 'secondary' : 'primary'}
            disabled={busy === 'small-company'}
            onClick={() => void onDecide({ action: 'confirm' }, 'Small Company assessment confirmed.')}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {c.override ? 'Confirm override' : 'Confirm Assessment'}
          </Button>
          {!c.override && c.systemOutcome !== 'not_applicable' && (
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={overriding}
              onClick={() => setOverriding((o) => !o)}
            >
              Override
            </Button>
          )}
          {c.override && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === 'small-company'}
              onClick={() =>
                void onDecide(
                  { action: 'clear_override' },
                  'Override cleared — the system assessment stands.',
                )
              }
            >
              Clear override
            </Button>
          )}
        </div>
      )}
      {editable && overriding && !c.override && (
        <form
          className="space-y-2 rounded-md border border-primary-600/30 border-l-4 border-l-primary-600 bg-surface p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await onDecide(
              { action: 'override', outcome, reason: reason.trim() },
              'Override recorded beside the system assessment.',
            );
            if (ok) {
              setOverriding(false);
              setReason('');
            }
          }}
        >
          <Field label="Professional conclusion" required>
            <Select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as 'small' | 'not_small')}
            >
              <option value="small">Small Company</option>
              <option value="not_small">Not a Small Company</option>
            </Select>
          </Field>
          <Field
            label="Reason for override"
            required
            hint="Recorded in the audit trail; the system assessment is kept beside it."
          >
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              type="submit"
              disabled={reason.trim().length < 3 || busy === 'small-company'}
            >
              Record override
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOverriding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

// ── Card F — financial year ───────────────────────────────────────────────────

function CardF({ p, draft, set, editable }: CardProps): JSX.Element {
  return (
    <>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <ReadOnlyFact label="Financial year" value={p.financialYear} source="Engagement" />
        <ReadOnlyFact
          label="Period"
          value={`${formatDate(p.period.from)} → ${formatDate(p.period.to)}`}
          source="Derived"
        />
        <ReadOnlyFact
          label="Period type"
          value={
            p.period.firstFinancialYear
              ? 'First financial year'
              : p.period.nonStandard
                ? 'Non-standard period'
                : 'Standard (1 April – 31 March)'
          }
        />
      </dl>
      {p.period.nonStandard && (
        <div className="max-w-sm">
          <ChoiceSelect<YesNo>
            label="Does the company have an approved different financial year?"
            value={draft.differentFyApproved}
            options={YN}
            labels={YN_LABEL}
            disabled={!editable}
            required
            hint="If yes, attach the approval (Tribunal order / Section 2(41) proviso)."
            onChange={(v) => set('differentFyApproved', v)}
          />
        </div>
      )}
    </>
  );
}

// ── Card G — initial / continuing audit ───────────────────────────────────────

function CardG({ p, draft, set, editable }: CardProps): JSX.Element {
  const sa510 = p.saTriggers.find((t) => t.code === 'SA 510');
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Audit type"
          hint={
            p.initialAuditSystemDerived
              ? 'System derived from the engagement history.'
              : 'Set by the audit team.'
          }
        >
          <Select
            value={draft.initialAudit ? 'initial' : 'continuing'}
            disabled={!editable}
            onChange={(e) => set('initialAudit', e.target.value === 'initial')}
          >
            <option value="continuing">Continuing audit</option>
            <option value="initial">Initial (first-year) audit</option>
          </Select>
        </Field>
        <ReadOnlyFact
          label="SA 510 — opening balances"
          value={sa510?.triggered ? 'Applies' : 'Does not apply'}
          source="System"
        />
      </div>
      {sa510?.basis && <p className="text-xs text-ink-muted">{sa510.basis}</p>}
    </>
  );
}

// ── Card H — accounting environment ───────────────────────────────────────────

function CardH({ p, draft, set, editable }: CardProps): JSX.Element {
  const sa402 = p.saTriggers.find((t) => t.code === 'SA 402');
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceSelect<AccountingSoftware>
          label="Primary accounting software / ERP"
          value={draft.accountingSoftware}
          options={ACCOUNTING_SOFTWARES}
          labels={ACCOUNTING_SOFTWARE_LABEL}
          disabled={!editable}
          required
          onChange={(v) => set('accountingSoftware', v)}
        />
        {draft.accountingSoftware === 'other' && (
          <Field label="Software name" required>
            <Input
              value={draft.accountingSoftwareOther ?? ''}
              disabled={!editable}
              onChange={(e) => set('accountingSoftwareOther', e.target.value)}
            />
          </Field>
        )}
        <ChoiceSelect<AccountingEnvironment>
          label="Accounting environment"
          value={draft.accountingEnvironment}
          options={ACCOUNTING_ENVIRONMENTS}
          labels={ACCOUNTING_ENVIRONMENT_LABEL}
          disabled={!editable}
          onChange={(v) => set('accountingEnvironment', v)}
        />
        <ChoiceSelect<YesNo>
          label="Are accounting records maintained electronically?"
          value={draft.recordsElectronic}
          options={YN}
          labels={YN_LABEL}
          disabled={!editable}
          required
          onChange={(v) => set('recordsElectronic', v)}
        />
        {draft.recordsElectronic === 'no' && (
          <div className="sm:col-span-2">
            <Field label="Describe the record-keeping environment" required>
              <Textarea
                rows={2}
                value={draft.recordsDescription ?? ''}
                disabled={!editable}
                onChange={(e) => set('recordsDescription', e.target.value)}
              />
            </Field>
          </div>
        )}
        <ChoiceSelect<ServiceOrgAnswer>
          label="Is an external service organisation used for financial reporting?"
          value={draft.serviceOrg}
          options={['yes', 'no', 'to_be_assessed'] as const}
          labels={SERVICE_ORG_LABEL}
          disabled={!editable}
          required
          onChange={(v) => set('serviceOrg', v)}
        />
        {draft.serviceOrg === 'yes' && (
          <>
            <Field label="Service provided" required>
              <Input
                value={draft.serviceOrgService ?? ''}
                disabled={!editable}
                placeholder="e.g. Payroll processing"
                onChange={(e) => set('serviceOrgService', e.target.value)}
              />
            </Field>
            <Field label="Service-organisation provider" required>
              <Input
                value={draft.serviceOrgProvider ?? ''}
                disabled={!editable}
                onChange={(e) => set('serviceOrgProvider', e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        SA 402: {sa402?.triggered ? 'applies' : 'does not apply'}
        {sa402?.basis ? ` — ${sa402.basis}` : ''}
      </p>
    </>
  );
}

// ── Card I — joint audit ──────────────────────────────────────────────────────

function CardI({ p, draft, set, editable }: CardProps): JSX.Element {
  const sa299 = p.saTriggers.find((t) => t.code === 'SA 299');
  const rows = draft.jointAuditors;
  const update = (i: number, patch: Partial<Draft['jointAuditors'][number]>) =>
    set(
      'jointAuditors',
      rows.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  return (
    <>
      <div className="max-w-sm">
        <ChoiceSelect<YesNo>
          label="Is this a joint audit?"
          value={draft.jointAudit ? 'yes' : 'no'}
          options={YN}
          labels={YN_LABEL}
          disabled={!editable}
          onChange={(v) => set('jointAudit', v === 'yes')}
        />
      </div>
      {draft.jointAudit && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Other joint auditor(s)
          </p>
          {rows.length === 0 && (
            <p className="text-xs text-warning-700">Add the other joint auditor’s details.</p>
          )}
          {rows.map((r, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_2fr_auto]">
              <Field label="Firm name" required>
                <Input
                  value={r.firmName}
                  disabled={!editable}
                  onChange={(e) => update(i, { firmName: e.target.value })}
                />
              </Field>
              <Field label="FRN">
                <Input
                  value={r.frn}
                  disabled={!editable}
                  onChange={(e) => update(i, { frn: e.target.value })}
                />
              </Field>
              <Field label="Contact">
                <Input
                  value={r.contact}
                  disabled={!editable}
                  onChange={(e) => update(i, { contact: e.target.value })}
                />
              </Field>
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove joint auditor ${i + 1}`}
                  onClick={() =>
                    set(
                      'jointAuditors',
                      rows.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {editable && rows.length < 10 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                set('jointAuditors', [...rows, { firmName: '', frn: '', contact: '' }])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add joint auditor
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-ink-muted">
        SA 299: {sa299?.triggered ? 'applies' : 'does not apply'}
        {sa299?.basis ? ` — ${sa299.basis}` : ''}
      </p>
    </>
  );
}

// ── Card J — information completeness ─────────────────────────────────────────

const ITEM_KIND_LABEL = {
  missing: 'Missing',
  pending: 'Pending',
  conflict: 'Conflict',
  unconfirmed: 'Not confirmed',
} as const;
const ITEM_KIND_TONE = {
  missing: 'warn',
  pending: 'warn',
  conflict: 'danger',
  unconfirmed: 'info',
} as const;

function CardJ({
  p,
  onGo,
}: {
  p: StatutoryAuditEntityProfile;
  onGo: (card: ProfileCardKey) => void;
}): JSX.Element {
  const c = p.completeness;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={COMPLETENESS_TONE[c.status]}>{COMPLETENESS_STATUS_LABEL[c.status]}</Badge>
        <div
          className="h-2 w-40 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={c.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Profile completeness"
        >
          <div className="h-full bg-primary-600" style={{ width: `${c.percent}%` }} />
        </div>
        <span className="text-xs text-ink-muted">
          {c.percent}% · {c.satisfied} of {c.total} criteria met
        </span>
      </div>
      {c.items.length === 0 ? (
        <p className="text-xs text-success-700">Every required fact is captured and confirmed.</p>
      ) : (
        <ul className="divide-y divide-line">
          {c.items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="flex min-w-0 items-center gap-2 text-xs text-ink">
                <Badge tone={ITEM_KIND_TONE[i.kind]}>{ITEM_KIND_LABEL[i.kind]}</Badge>
                <span>{i.label}</span>
                {!i.blocking && <span className="text-ink-faint">(does not block)</span>}
              </span>
              <span className="flex items-center gap-2">
                {i.fix && <FixLink fix={i.fix} missing />}
                {i.card !== 'J' && (
                  <button
                    type="button"
                    className="text-xs text-primary-600 hover:underline"
                    onClick={() => onGo(i.card)}
                  >
                    Go to Card {i.card}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── Footer — Save Draft / CONFIRM PROFILE / Reopen ────────────────────────────

function ProfileFooter({
  p,
  editable,
  canManage,
  dirty,
  busy,
  onSave,
  onConfirm,
  onReopen,
}: {
  p: StatutoryAuditEntityProfile;
  editable: boolean;
  canManage: boolean;
  dirty: boolean;
  busy: string | null;
  onSave: () => void;
  onConfirm: (note: string) => Promise<boolean>;
  onReopen: (reason: string) => Promise<boolean>;
}): JSX.Element | null {
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState('');
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const blocking = p.completeness.items.filter((i) => i.blocking).length;

  if (!editable) {
    return (
      <Card className="space-y-2 p-4">
        {p.confirmation ? (
          <p className="text-xs text-ink-muted">
            Confirmed by{' '}
            <span className="font-medium text-ink">{p.confirmation.confirmedByName ?? '—'}</span> on{' '}
            {formatDate(p.confirmation.confirmedAt)}
            {p.confirmation.methodologyVersion
              ? ` · methodology ${p.confirmation.methodologyVersion}`
              : ''}
            {p.confirmation.note ? ` — ${p.confirmation.note}` : ''}
          </p>
        ) : (
          <p className="text-xs text-ink-muted">Not confirmed yet.</p>
        )}
        {canManage && p.state === 'confirmed' && (
          <>
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={reopening}
              onClick={() => setReopening((o) => !o)}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reopen profile
            </Button>
            {reopening && (
              <form
                className="space-y-2 rounded-md border border-primary-600/30 border-l-4 border-l-primary-600 bg-surface p-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await onReopen(reason.trim())) {
                    setReopening(false);
                    setReason('');
                  }
                }}
              >
                <Field
                  label="Reason for reopening"
                  required
                  hint="Recorded in the audit trail. Re-confirming marks the affected 02.x assessments Needs Re-evaluation."
                >
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Button
                  size="sm"
                  type="submit"
                  disabled={reason.trim().length < 3 || busy === 'reopen'}
                >
                  Reopen
                </Button>
              </form>
            )}
          </>
        )}
      </Card>
    );
  }

  const why = dirty
    ? 'Save the draft first.'
    : blocking > 0
      ? `${blocking} item(s) in Card J still block confirmation.`
      : !ack
        ? 'Accept the confirmation statement.'
        : null;
  return (
    <Card className="sticky bottom-2 z-10 space-y-3 p-4 shadow-lg">
      <label className="flex items-start gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-0.5"
        />
        <span>{PROFILE_CONFIRMATION_STATEMENT}</span>
      </label>
      <Field label="Confirmation note (optional)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={!dirty || busy !== null} onClick={onSave}>
          <Save className="h-4 w-4" /> Save Draft
        </Button>
        <Button
          disabled={why !== null || busy !== null}
          onClick={async () => {
            if (await onConfirm(note.trim())) {
              setAck(false);
              setNote('');
            }
          }}
        >
          <CheckCircle2 className="h-4 w-4" /> CONFIRM PROFILE
        </Button>
        {why && <span className="text-xs text-ink-faint">{why}</span>}
        {dirty && <span className="text-xs text-warning-700">Unsaved changes</span>}
      </div>
    </Card>
  );
}

// ── Right context panel ───────────────────────────────────────────────────────

function ContextPanel({
  p,
  card,
  references,
  canAdmin,
  fileSlots,
}: {
  p: StatutoryAuditEntityProfile;
  card: ProfileCardKey;
  references: AuthorityReference[];
  canAdmin: boolean;
  fileSlots: ReactNode[];
}): JSX.Element {
  const state = p.cards.find((c) => c.key === card);
  const prior = (p.priorYear?.changes ?? []).filter((c) => PRIOR_YEAR_CARD[c.field] === card);
  return (
    <aside
      aria-label={`Context — Card ${card}`}
      className="space-y-3 self-start rounded-lg border border-line bg-surface p-3 lg:sticky lg:top-2"
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Card {card} · {PROFILE_CARD_TITLE[card]}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          <span className="font-medium text-ink">Source:</span> {CARD_SOURCE[card]}
        </p>
        {state?.confirmation && (
          <p className="mt-1 text-xs text-ink-muted">
            {state.confirmation.stale ? 'Changed since confirmed' : 'Confirmed'} by{' '}
            {state.confirmation.confirmedByName ?? '—'} on {formatDate(state.confirmation.confirmedAt)}
          </p>
        )}
      </div>

      {references.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Reference
          </p>
          {references.map((r) => (
            <ReferenceLink key={r.anchor} reference={r} canAdmin={canAdmin} />
          ))}
        </div>
      )}

      {fileSlots.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Evidence
          </p>
          {fileSlots}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {p.priorYear ? `Prior year (${p.priorYear.financialYear})` : 'Prior year'}
        </p>
        {!p.priorYear ? (
          <p className="text-xs text-ink-faint">No confirmed 02.1 for the previous year.</p>
        ) : prior.length === 0 ? (
          <p className="text-xs text-ink-faint">Nothing on this card is compared year on year.</p>
        ) : (
          <ul className="space-y-1">
            {prior.map((c) => (
              <li
                key={c.field}
                className={`rounded-md px-2 py-1 text-xs ${c.changed ? 'bg-warning-50 text-warning-700' : 'text-ink-muted'}`}
              >
                <span className="font-medium">{c.label}</span>
                {c.changed ? ' — changed' : ' — unchanged'}
                <span className="block">Last year: {c.prior ?? '—'}</span>
                {c.changed && <span className="block">This year: {c.current ?? '—'}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ── View Provision / Standard / Guidance ──────────────────────────────────────

function ReferenceLink({
  reference,
  canAdmin,
}: {
  reference: AuthorityReference;
  canAdmin: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const prov = reference.provision;
  const action = prov ? AUTHORITY_REFERENCE_ACTION[prov.referenceKind] : 'View Provision';
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-left text-xs font-medium text-primary-600 hover:underline"
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0" />
        {action} — {reference.label}
      </button>
      {open && <ProvisionViewer reference={reference} canAdmin={canAdmin} />}
    </div>
  );
}

function ProvisionViewer({
  reference,
  canAdmin,
}: {
  reference: AuthorityReference;
  canAdmin: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const prov = reference.provision;
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(prov?.summary ?? '');
  const [sourceUrl, setSourceUrl] = useState(prov?.sourceUrl ?? '');
  const [busy, setBusy] = useState(false);
  if (!prov) {
    return (
      <p className="mt-1 rounded-md bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
        The library holds no version of {reference.code} in force for this engagement period.
      </p>
    );
  }
  const badUrl = sourceUrl.trim() !== '' && !sourceUrl.trim().startsWith('https://');
  return (
    <div className="mt-1 space-y-1.5 rounded-md border border-line bg-surface-sunken/60 px-3 py-2 text-xs">
      <p className="font-semibold text-ink">
        {prov.provisionNumber} — {prov.title}
      </p>
      <p className="text-ink-faint">
        {prov.authority} · in force {formatDate(prov.effectiveFrom)}
        {prov.effectiveTo ? ` to ${formatDate(prov.effectiveTo)}` : ' onwards'}
        {prov.sourceReference ? ` · ${prov.sourceReference}` : ''}
      </p>
      <p className="whitespace-pre-line text-ink-muted">
        {prov.summary ?? 'No summary maintained yet.'}
      </p>
      {prov.sourceUrl ? (
        <a
          href={prov.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary-600 hover:underline"
        >
          Open the {prov.authority} source <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <p className="text-ink-faint">No source link maintained yet.</p>
      )}
      {canAdmin && (
        <div>
          <button
            type="button"
            className="text-primary-600 hover:underline"
            aria-expanded={editing}
            onClick={() => setEditing((o) => !o)}
          >
            {editing ? 'Close' : 'Maintain viewer content'}
          </button>
          {editing && (
            <form
              className="mt-1 space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (badUrl) return;
                setBusy(true);
                try {
                  await apiFetch(`/authority-provisions/${prov.id}`, {
                    method: 'PATCH',
                    body: { summary: summary.trim() || null, sourceUrl: sourceUrl.trim() || null },
                  });
                  toast('Provision content saved.');
                  setEditing(false);
                  void qc.invalidateQueries({ queryKey: ['engagement'] });
                } catch (err) {
                  toast(err instanceof ApiError ? err.message : 'Could not save.', 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Summary">
                <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </Field>
              <Field label="Source link (https://)">
                <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
              </Field>
              <Button size="sm" type="submit" disabled={busy || badUrl}>
                Save content
              </Button>
              {badUrl && (
                <span className="ml-2 text-danger-700">The link must start with https://</span>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── Evidence files (Add / Link / Open / Remove) ───────────────────────────────

function ProfileFileSlot({
  engagementId,
  base,
  slot,
  label,
  files,
  editable,
  onChanged,
}: {
  engagementId: string;
  base: string;
  slot: string;
  label: string;
  files: ProfileFileRecord[];
  editable: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const mine = files.filter((f) => f.slot === slot);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocumentRow | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fail = (e: unknown) =>
    toast(e instanceof ApiError ? e.message : 'Could not update the file.', 'error');
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-md border border-line bg-surface p-2" onClick={(e) => e.stopPropagation()}>
      <p className="text-xs font-medium text-ink">{label}</p>
      {mine.length === 0 ? (
        <p className="text-[11px] text-ink-faint">No file yet.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {mine.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-1 text-xs">
              <span className="min-w-0 truncate text-ink">
                {f.filename ?? f.title}
                <span className="text-ink-faint">
                  {' '}
                  · {f.linkedByName ?? '—'} · {formatDate(f.linkedAt)}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      setOpenDoc(
                        await apiFetch<DocumentRow>(
                          `/engagements/${engagementId}/documents/${f.documentId}`,
                        ),
                      );
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </Button>
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${f.filename ?? f.title}`}
                    onClick={() =>
                      void act(() =>
                        apiFetch(`${base}/files/${f.id}/unlink`, { method: 'POST', body: {} }),
                      )
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> {busy ? 'Saving…' : 'Add File'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={linking}
            onClick={() => setLinking((o) => !o)}
          >
            <Link2 className="h-3.5 w-3.5" /> Link Existing File
          </Button>
          <input
            ref={input}
            type="file"
            className="hidden"
            aria-label={`Add a file — ${label}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void act(async () =>
                apiFetch(`${base}/files/add`, {
                  method: 'POST',
                  body: {
                    slot,
                    filename: file.name,
                    contentType: file.type || undefined,
                    contentBase64: await blobToBase64(file),
                  },
                }),
              );
            }}
          />
        </div>
      )}
      {editable && linking && (
        <LinkPicker
          engagementId={engagementId}
          exclude={mine.map((f) => f.documentId)}
          onPick={async (documentId) => {
            await act(() =>
              apiFetch(`${base}/files/link`, { method: 'POST', body: { slot, documentId } }),
            );
            setLinking(false);
          }}
        />
      )}
      {openDoc && (
        <DocumentPreview
          engagementId={engagementId}
          doc={openDoc}
          canEdit={editable}
          onClose={() => setOpenDoc(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

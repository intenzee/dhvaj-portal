import {
  COMPANY_TYPE,
  COMPLETENESS_STATUS,
  CONFIRMABLE_PROFILE_CARDS,
  PROFILE_CARD_STATUS,
  PROFILE_CARD_TITLE,
  PROFILE_CARDS,
  PROFILE_FINANCIAL_LABEL,
  REQUIRED_PROFILE_FINANCIALS,
  SERVICE_ORGANISATION_ENVIRONMENTS,
  SMALL_COMPANY_OUTCOME,
  SPECIAL_ENTITY_LABEL,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type AccountingEnvironment,
  type CompanyType,
  type CompletenessItem,
  type ConfirmableProfileCard,
  type JointAuditor,
  type MasterFactFix,
  type ProfileAccountingEnvironment,
  type ProfileCardConfirmation,
  type ProfileCardKey,
  type ProfileCardState,
  type ProfileCompleteness,
  type ProfileFinancialRow,
  type ProfileGroupEntity,
  type ProfileGroupFlags,
  type ProfileListing,
  type ProfilePeriod,
  type ProfilePriorYearChange,
  type ServiceOrgAnswer,
  type SmallCompanyOutcome,
  type SpecialEntityType,
  type SubSectionKey,
} from '@hsdg/contracts';
import type { MasterRelationship } from './master-facts';

/**
 * 02.1 workspace engine (DHVAJ 02.1 web developer specification §4–§18) — pure,
 * DB-free, unit-tested. The service reads the masters and the profile row, and
 * this module decides everything the Manager sees about them:
 *
 *   • Card A company type and Card C group flags, derived from the masters;
 *   • the Card F audit period (a first financial year is non-standard, §2(41));
 *   • the Card E final outcome (an override wins, the system result is kept);
 *   • a fingerprint per confirmable card, so a confirmation goes stale when the
 *     facts it confirmed change (spec §17 "material corrections");
 *   • Card J completeness — each missing / pending / conflicting fact as an
 *     actionable item, the status, and the completion-criteria percentage;
 *   • the facts compared with last year (§14) and the downstream sections a
 *     changed fact must send back for re-evaluation (§16 trigger map).
 */

// ── Card A — company type (ERP-02) ───────────────────────────────────────────

/**
 * The company type from the Entity Master: Section 8 / Government come from
 * the special-entity facts the master holds; otherwise the entity type.
 */
export function companyTypeOf(
  entityTypeSlug: string | null,
  entityCategory: string | null,
  specialTypes: readonly SpecialEntityType[],
): CompanyType | null {
  if (entityCategory == null) return null;
  if (entityCategory !== 'company') return null;
  if (specialTypes.includes('section_8')) return COMPANY_TYPE.section8;
  if (specialTypes.includes('government')) return COMPANY_TYPE.government;
  if (entityTypeSlug === 'private_limited') return COMPANY_TYPE.private;
  if (entityTypeSlug === 'public_limited') return COMPANY_TYPE.public;
  if (entityTypeSlug === 'opc') return COMPANY_TYPE.opc;
  return COMPANY_TYPE.other;
}

// ── Card C — group structure, system suggested ───────────────────────────────

const SUBSIDIARY_TYPES = ['subsidiary', 'wholly_owned_subsidiary', 'step_down_subsidiary'];
const HOLDING_TYPES = ['holding', 'ultimate_holding', 'intermediate_holding'];

const RELATIONSHIP_FROM_THIS_SIDE: Record<string, string> = {
  holding: 'Holding company',
  ultimate_holding: 'Ultimate holding company',
  intermediate_holding: 'Intermediate holding company',
  subsidiary: 'Subsidiary',
  wholly_owned_subsidiary: 'Wholly-owned subsidiary',
  step_down_subsidiary: 'Step-down subsidiary',
  fellow_subsidiary: 'Fellow subsidiary',
  associate: 'Associate',
  joint_venture: 'Joint venture',
  other: 'Related entity',
};

/**
 * Read the flags off the relationships master. An edge reads "from IS <type> OF
 * to": an outbound subsidiary edge makes THIS entity the subsidiary; an inbound
 * one makes it the holding company — and likewise for associates / JVs.
 */
export function groupFlagsOf(rels: readonly MasterRelationship[]): ProfileGroupFlags {
  let isHolding = false;
  let isSubsidiary = false;
  let isAssociate = false;
  let isJointVenture = false;
  let hasInvestees = false;
  for (const r of rels) {
    if (SUBSIDIARY_TYPES.includes(r.type)) {
      if (r.outbound) isSubsidiary = true;
      else {
        isHolding = true;
        hasInvestees = true;
      }
    } else if (HOLDING_TYPES.includes(r.type)) {
      if (r.outbound) {
        isHolding = true;
        hasInvestees = true;
      } else isSubsidiary = true;
    } else if (r.type === 'associate') {
      if (r.outbound) isAssociate = true;
      else hasInvestees = true;
    } else if (r.type === 'joint_venture') {
      if (r.outbound) isJointVenture = true;
      else hasInvestees = true;
    }
  }
  return { isHolding, isSubsidiary, isAssociate, isJointVenture, hasInvestees };
}

/** The group table (spec §6): what each counterparty is TO this entity. */
export function groupEntitiesOf(rels: readonly MasterRelationship[]): ProfileGroupEntity[] {
  return rels.map((r) => {
    // Outbound "this IS subsidiary OF x" → x is the holding company, and so on.
    let relationship: string;
    if (r.outbound && SUBSIDIARY_TYPES.includes(r.type)) relationship = 'Holding company';
    else if (!r.outbound && HOLDING_TYPES.includes(r.type)) relationship = 'Holding company';
    else if (r.outbound && HOLDING_TYPES.includes(r.type)) relationship = 'Subsidiary';
    else if (r.outbound && r.type === 'associate')
      relationship = 'Investor (this entity is its associate)';
    else if (r.outbound && r.type === 'joint_venture')
      relationship = 'Venturer (this entity is its joint venture)';
    else relationship = RELATIONSHIP_FROM_THIS_SIDE[r.type] ?? r.type.replace(/_/g, ' ');
    return {
      entity: r.counterparty,
      relationship,
      interestPct: r.shareholdingPct,
      country: r.counterpartyCountry ?? null,
      auditor: r.firmAuditsCounterparty ? 'DHVAJ' : 'Other auditor',
    };
  });
}

// ── Card F — the audit period (Section 2(41)) ────────────────────────────────

/**
 * The period under audit. A standard year runs 1 April → 31 March. A company
 * incorporated inside the year starts its first financial year on incorporation;
 * one incorporated on or after 1 January of the preceding year runs its first
 * financial year to this 31 March (the §2(41) extended first year).
 */
export function auditPeriodOf(
  financialYear: string,
  incorporationDate: string | null,
  differentFyApproved: 'yes' | 'no' | null,
): ProfilePeriod {
  const from = auditPeriodStartFromFinancialYear(financialYear);
  const startYear = Number(from.slice(0, 4));
  const to = `${startYear + 1}-03-31`;
  const extendedFrom = `${startYear}-01-01`;
  let periodFrom = from;
  let firstFinancialYear = false;
  if (incorporationDate && incorporationDate > from && incorporationDate <= to) {
    periodFrom = incorporationDate;
    firstFinancialYear = true;
  } else if (incorporationDate && incorporationDate >= extendedFrom && incorporationDate < from) {
    periodFrom = incorporationDate;
    firstFinancialYear = true;
  }
  return {
    from: periodFrom,
    to,
    nonStandard: periodFrom !== from,
    firstFinancialYear,
    differentFyApproved,
  };
}

// ── Card E — the professional conclusion ─────────────────────────────────────

/** The outcome downstream engines read: an override wins; the system result is kept. */
export function finalSmallCompanyOutcome(
  system: SmallCompanyOutcome,
  override: SmallCompanyOutcome | null,
): SmallCompanyOutcome {
  return override ?? system;
}

// ── SA 402 (ERP-AE-03) ───────────────────────────────────────────────────────

/** A service organisation is involved: answered Yes, or an outsourced/hybrid environment. */
export function usesServiceOrganisation(
  serviceOrg: ServiceOrgAnswer | null,
  environment: AccountingEnvironment | null,
): boolean {
  return (
    serviceOrg === 'yes' ||
    (environment != null && SERVICE_ORGANISATION_ENVIRONMENTS.includes(environment))
  );
}

// ── The workspace facts, fingerprints and completeness ───────────────────────

/** Everything the completeness engine reads (assembled by the service). */
export interface WorkspaceFacts {
  isCompany: boolean | null;
  entityCategory: string | null;
  companyType: CompanyType | null;
  listing: ProfileListing;
  specialEntityTypes: readonly SpecialEntityType[];
  /** Section 8 / Government as the Entity Master shows them. */
  masterOwnedSpecialTypes: readonly SpecialEntityType[];
  nbfcCategory: string | null;
  regulator: string | null;
  regulatorName: string | null;
  regulatorDetails: string | null;
  groupFlags: ProfileGroupFlags;
  groupEntities: readonly ProfileGroupEntity[];
  financialRows: readonly ProfileFinancialRow[];
  smallCompanySystem: SmallCompanyOutcome;
  smallCompanyFinal: SmallCompanyOutcome;
  smallCompanyOverridden: boolean;
  period: ProfilePeriod;
  initialAudit: boolean;
  accountingEnvironment: AccountingEnvironment | null;
  accounting: ProfileAccountingEnvironment;
  jointAudit: boolean;
  jointAuditors: readonly JointAuditor[];
}

/** One stored card confirmation (`audit_entity_profile.card_confirmations`). */
export interface StoredCardConfirmation {
  at: string;
  byId: string | null;
  byName: string | null;
  fingerprint: string;
}
export type StoredCardConfirmations = Partial<
  Record<ConfirmableProfileCard, StoredCardConfirmation>
>;

const sorted = <T>(xs: readonly T[]): T[] => [...xs].sort();

/**
 * The facts a card's confirmation vouches for, as a stable string. When it no
 * longer matches what was confirmed, the confirmation is stale.
 */
export function cardFingerprint(card: ConfirmableProfileCard, f: WorkspaceFacts): string {
  switch (card) {
    case 'A':
      return JSON.stringify({
        companyType: f.companyType,
        category: f.entityCategory,
        listing: f.listing.answer,
        inProcess: f.listing.inProcess,
        lines: f.listing.lines.map((l) => `${l.exchange}:${l.securityType}`).sort(),
      });
    case 'B':
      return JSON.stringify({
        types: sorted(f.specialEntityTypes),
        nbfc: f.nbfcCategory,
        regulator: f.regulator,
        regulatorName: f.regulatorName,
        regulatorDetails: f.regulatorDetails,
      });
    case 'C':
      return JSON.stringify({
        flags: f.groupFlags,
        entities: f.groupEntities
          .map((e) => `${e.entity}|${e.relationship}|${e.interestPct ?? ''}`)
          .sort(),
      });
    case 'E':
      return JSON.stringify({ system: f.smallCompanySystem, final: f.smallCompanyFinal });
    case 'F':
      return JSON.stringify({
        from: f.period.from,
        to: f.period.to,
        approved: f.period.differentFyApproved,
      });
    case 'H':
      return JSON.stringify({ ...f.accounting, environment: f.accountingEnvironment });
    case 'I':
      return JSON.stringify({
        joint: f.jointAudit,
        auditors: f.jointAudit ? f.jointAuditors.map((a) => `${a.firmName}|${a.frn ?? ''}`) : [],
      });
  }
}

/** What confirming a card requires first — a card cannot be confirmed while Information Pending. */
export function cardConfirmBlockers(card: ConfirmableProfileCard, f: WorkspaceFacts): string[] {
  const out: string[] = [];
  switch (card) {
    case 'A':
      if (f.isCompany == null) out.push('The entity type is not on the Entity Master.');
      if (f.listing.answer == null || f.listing.answer === 'pending')
        out.push('Answer whether any securities are listed (Yes / No).');
      if (f.listing.inProcess == null || f.listing.inProcess === 'pending')
        out.push('Answer whether the company is in the process of listing any securities.');
      break;
    case 'B':
      if (f.specialEntityTypes.includes('other_regulator') && !f.regulator)
        out.push('Select the regulator of the other regulated entity.');
      if (f.regulator === 'other' && !f.regulatorName?.trim()) out.push('Name the regulator.');
      break;
    case 'E':
      if (f.smallCompanySystem === SMALL_COMPANY_OUTCOME.pending && !f.smallCompanyOverridden)
        out.push(
          'The Small Company assessment cannot be determined yet — capture paid-up capital and turnover, or override with a reason.',
        );
      break;
    case 'F':
      if (f.period.nonStandard && f.period.differentFyApproved == null)
        out.push('Answer whether the company has an approved different financial year.');
      break;
    case 'H':
      for (const m of accountingGaps(f.accounting)) out.push(m);
      break;
    case 'I':
      if (f.jointAudit && f.jointAuditors.length === 0)
        out.push('Add the other joint auditor(s): firm name, FRN and contact.');
      break;
    case 'C':
      break;
  }
  return out;
}

function accountingGaps(a: ProfileAccountingEnvironment): string[] {
  const out: string[] = [];
  if (!a.software) out.push('Select the primary accounting software / ERP.');
  if (a.software === 'other' && !a.softwareOther?.trim()) out.push('Name the accounting software.');
  if (!a.recordsElectronic)
    out.push('Answer whether accounting records are maintained electronically.');
  if (a.recordsElectronic === 'no' && !a.recordsDescription?.trim())
    out.push('Describe the record-keeping environment.');
  if (!a.serviceOrg) out.push('Answer whether an external service organisation is used.');
  if (a.serviceOrg === 'yes' && (!a.serviceOrgService?.trim() || !a.serviceOrgProvider?.trim()))
    out.push('Name the service and the service-organisation provider.');
  return out;
}

export interface CompletenessInput {
  facts: WorkspaceFacts;
  confirmations: StoredCardConfirmations;
  profileConfirmed: boolean;
  /** Fix links for master-held facts. */
  fixes: {
    details: MasterFactFix | null;
    financials: MasterFactFix | null;
    listings: MasterFactFix | null;
    regulatory: MasterFactFix | null;
  };
}

export interface CompletenessResult {
  completeness: ProfileCompleteness;
  cards: Array<Omit<ProfileCardState, 'confirmation'> & { stale: boolean }>;
}

/** Legacy labels other sections and tests key on (kept verbatim). */
export const MISSING_CLASSIFICATION = 'Entity classification not confirmed.';
export const MISSING_SMALL_COMPANY =
  'Small Company status cannot be computed yet (paid-up capital / turnover).';

/** Card J (spec §13, §17, §18): every item, the status and the percentage. */
export function evaluateCompleteness(input: CompletenessInput): CompletenessResult {
  const { facts: f, confirmations, fixes } = input;
  const items: CompletenessItem[] = [];
  const add = (
    card: ProfileCardKey,
    key: string,
    label: string,
    kind: CompletenessItem['kind'],
    blocking: boolean,
    fix: MasterFactFix | null = null,
  ) => items.push({ key, card, label, kind, blocking, fix });

  const stale = (card: ConfirmableProfileCard): boolean => {
    const c = confirmations[card];
    return !!c && c.fingerprint !== cardFingerprint(card, f);
  };
  const fresh = (card: ConfirmableProfileCard): boolean => !!confirmations[card] && !stale(card);

  // A — classification + listing.
  if (f.isCompany == null)
    add('A', 'classification', MISSING_CLASSIFICATION, 'missing', true, fixes.details);
  if (f.listing.answer === 'pending')
    add('A', 'listing', 'Listing status requires confirmation.', 'pending', true, fixes.listings);
  if (f.listing.inProcess === 'pending')
    add(
      'A',
      'listing_in_process',
      'Listing-in-process status requires confirmation.',
      'pending',
      true,
      fixes.listings,
    );
  if (
    (f.listing.answer === 'yes' && !f.listing.masterListed) ||
    (f.listing.answer === 'no' && f.listing.masterListed)
  )
    add(
      'A',
      'listing_conflict',
      `Listing answered "${f.listing.answer === 'yes' ? 'Yes' : 'No'}" but the Entity Master shows the company as ${f.listing.masterListed ? 'listed' : 'unlisted'} — correct the Entity Master.`,
      'conflict',
      true,
      fixes.listings,
    );

  // B — special entities.
  if (f.specialEntityTypes.includes('other_regulator') && !f.regulator)
    add('B', 'regulator', 'Regulator of the other regulated entity not selected.', 'missing', true);
  if (f.regulator === 'other' && !f.regulatorName?.trim())
    add('B', 'regulator_name', 'Regulator name required.', 'missing', true);
  for (const t of ['section_8', 'government'] as const) {
    const onProfile = f.specialEntityTypes.includes(t);
    const onMaster = f.masterOwnedSpecialTypes.includes(t);
    if (onProfile !== onMaster)
      add(
        'B',
        `master_${t}`,
        `${SPECIAL_ENTITY_LABEL[t]} status differs from the Entity Master — correct it on the master.`,
        'conflict',
        true,
        fixes.regulatory,
      );
  }

  // D — the reusable financial block.
  for (const row of f.financialRows) {
    if (row.conflict)
      add(
        'D',
        `financial_conflict:${row.parameter}`,
        row.conflict,
        'conflict',
        true,
        fixes.financials,
      );
    if (row.required && row.current.value == null)
      add(
        'D',
        `financial:${row.parameter}`,
        `${PROFILE_FINANCIAL_LABEL[row.parameter]} unavailable.`,
        'pending',
        false,
        fixes.financials,
      );
  }

  // E — small company.
  if (f.smallCompanySystem === SMALL_COMPANY_OUTCOME.pending && !f.smallCompanyOverridden)
    add('E', 'small_company', MISSING_SMALL_COMPANY, 'missing', true, fixes.financials);

  // F — period.
  if (f.period.nonStandard && f.period.differentFyApproved == null)
    add('F', 'different_fy', 'Approved different financial year not answered.', 'missing', true);

  // H — accounting environment.
  for (const [i, m] of accountingGaps(f.accounting).entries())
    add('H', `accounting:${i}`, m, 'missing', true);
  if (f.accounting.serviceOrg === 'to_be_assessed')
    add(
      'H',
      'service_org_tba',
      'Use of an external service organisation is still to be assessed (SA 402).',
      'pending',
      false,
    );

  // I — joint audit.
  if (f.jointAudit && f.jointAuditors.length === 0)
    add('I', 'joint_auditors', 'Other joint auditor details required.', 'missing', true);

  // Card confirmations: missing → unconfirmed; changed since → attention.
  for (const card of CONFIRMABLE_PROFILE_CARDS) {
    if (
      card === 'E' &&
      f.smallCompanySystem === SMALL_COMPANY_OUTCOME.notApplicable &&
      !f.smallCompanyOverridden
    )
      continue; // §2(85) does not apply — nothing to confirm.
    if (stale(card))
      add(
        card,
        `stale:${card}`,
        `${PROFILE_CARD_TITLE[card]} changed since it was confirmed — confirm it again.`,
        'conflict',
        true,
      );
    else if (!confirmations[card])
      add(
        card,
        `unconfirmed:${card}`,
        card === 'E'
          ? 'Confirm or override the Small Company assessment.'
          : `Confirm ${PROFILE_CARD_TITLE[card]}.`,
        'unconfirmed',
        true,
      );
  }

  const hasConflict = items.some((i) => i.kind === 'conflict');
  const status = hasConflict
    ? COMPLETENESS_STATUS.attention
    : items.length > 0
      ? COMPLETENESS_STATUS.incomplete
      : COMPLETENESS_STATUS.complete;

  // Completion criteria (spec §18) → percentage.
  const eDone =
    (f.smallCompanySystem === SMALL_COMPANY_OUTCOME.notApplicable && !f.smallCompanyOverridden) ||
    fresh('E');
  const cardItems = (card: ProfileCardKey) => items.filter((i) => i.card === card);
  const criteria: boolean[] = [
    fresh('A') && cardItems('A').length === 0,
    fresh('B') && cardItems('B').length === 0,
    fresh('C'),
    cardItems('D').every((i) => !i.blocking),
    eDone,
    fresh('F') && cardItems('F').length === 0,
    true, // G — initial / continuing status is always system-derived.
    fresh('H') && cardItems('H').every((i) => !i.blocking),
    fresh('I') && cardItems('I').length === 0,
    !hasConflict,
    input.profileConfirmed,
  ];
  const satisfied = criteria.filter(Boolean).length;

  const cards = PROFILE_CARDS.map((key) => {
    const own = cardItems(key);
    const isStale = (CONFIRMABLE_PROFILE_CARDS as readonly string[]).includes(key)
      ? stale(key as ConfirmableProfileCard)
      : false;
    let cardStatus: ProfileCardState['status'];
    if (key === 'J') {
      cardStatus =
        status === COMPLETENESS_STATUS.complete
          ? PROFILE_CARD_STATUS.confirmed
          : status === COMPLETENESS_STATUS.attention
            ? PROFILE_CARD_STATUS.attention
            : PROFILE_CARD_STATUS.incomplete;
    } else if (own.some((i) => i.kind === 'conflict')) cardStatus = PROFILE_CARD_STATUS.attention;
    else if (own.some((i) => i.kind === 'missing' || i.kind === 'pending'))
      cardStatus = PROFILE_CARD_STATUS.incomplete;
    else if (key === 'D' || key === 'G') cardStatus = PROFILE_CARD_STATUS.derived;
    else if (
      key === 'E' &&
      f.smallCompanySystem === SMALL_COMPANY_OUTCOME.notApplicable &&
      !f.smallCompanyOverridden
    )
      cardStatus = PROFILE_CARD_STATUS.derived;
    else if (fresh(key as ConfirmableProfileCard)) cardStatus = PROFILE_CARD_STATUS.confirmed;
    else cardStatus = PROFILE_CARD_STATUS.systemSuggested;
    return { key, title: PROFILE_CARD_TITLE[key], status: cardStatus, stale: isStale };
  });

  return {
    completeness: {
      status,
      percent: Math.round((satisfied / criteria.length) * 100),
      satisfied,
      total: criteria.length,
      items,
    },
    cards,
  };
}

/** Attach who/when to each card's computed status. */
export function withCardConfirmations(
  cards: CompletenessResult['cards'],
  confirmations: StoredCardConfirmations,
): ProfileCardState[] {
  return cards.map(({ stale, ...card }) => {
    const c = (confirmations as Record<string, StoredCardConfirmation | undefined>)[card.key];
    const confirmation: ProfileCardConfirmation | null = c
      ? { confirmedAt: c.at, confirmedByName: c.byName, stale }
      : null;
    return { ...card, confirmation };
  });
}

// ── Tracked facts: prior-year comparison (§14) and change impact (§16, §17) ──

/** The facts 02.1 tracks across years and after confirmation, human-readable. */
export const TRACKED_FACT = {
  companyType: 'companyType',
  listing: 'listing',
  specialEntityTypes: 'specialEntityTypes',
  regulator: 'regulator',
  group: 'group',
  period: 'period',
  accounting: 'accounting',
  financials: 'financials',
  smallCompany: 'smallCompany',
  initialAudit: 'initialAudit',
  serviceOrg: 'serviceOrg',
  jointAudit: 'jointAudit',
} as const;
export type TrackedFact = (typeof TRACKED_FACT)[keyof typeof TRACKED_FACT];
export type TrackedFacts = Partial<Record<TrackedFact, string>>;

const TRACKED_LABEL: Record<TrackedFact, string> = {
  companyType: 'Company category',
  listing: 'Listing status',
  specialEntityTypes: 'Special entity classification',
  regulator: 'Regulator',
  group: 'Group structure',
  period: 'Financial year',
  accounting: 'Accounting environment',
  financials: 'Applicability financial data',
  smallCompany: 'Small Company conclusion',
  initialAudit: 'Initial / continuing audit',
  serviceOrg: 'Service organisation',
  jointAudit: 'Joint audit',
};

export function trackedFacts(
  f: WorkspaceFacts,
  labels: {
    companyType: string | null;
    regulator: string | null;
    accounting: string | null;
  },
): TrackedFacts {
  const listed = f.listing.answer ?? (f.listing.masterListed ? 'yes' : 'no');
  const lines = f.listing.lines
    .map((l) => `${l.exchange.toUpperCase()} ${l.securityType}`)
    .join(', ');
  const fig = (p: string) => f.financialRows.find((r) => r.parameter === p)?.current.value ?? null;
  return {
    companyType: labels.companyType ?? '—',
    listing:
      listed === 'yes'
        ? `Listed${lines ? ` (${lines})` : ''}`
        : listed === 'pending'
          ? 'Information pending'
          : f.listing.inProcess === 'yes' || f.listing.masterInProcess
            ? 'Unlisted — listing in process'
            : 'Unlisted',
    specialEntityTypes:
      sorted(f.specialEntityTypes)
        .map((t) => SPECIAL_ENTITY_LABEL[t])
        .join(', ') || 'None',
    regulator: labels.regulator ?? 'None',
    group:
      f.groupEntities.length === 0
        ? 'No group relationships'
        : f.groupEntities
            .map(
              (e) =>
                `${e.relationship}: ${e.entity}${e.interestPct != null ? ` (${e.interestPct}%)` : ''}`,
            )
            .sort()
            .join('; '),
    period: f.period.nonStandard
      ? `${f.period.from} to ${f.period.to} (non-standard)`
      : '1 April to 31 March',
    accounting: labels.accounting ?? '—',
    financials: REQUIRED_PROFILE_FINANCIALS.map((p) => `${p}=${fig(p) ?? '—'}`).join(';'),
    smallCompany: f.smallCompanyFinal,
    initialAudit: f.initialAudit ? 'Initial audit' : 'Continuing audit',
    serviceOrg: usesServiceOrganisation(f.accounting.serviceOrg, f.accountingEnvironment)
      ? 'Yes'
      : 'No',
    jointAudit: f.jointAudit ? 'Yes' : 'No',
  };
}

/** Facts compared with last year's file (spec §14) — monetary values are refreshed, not compared. */
const PRIOR_YEAR_FIELDS: TrackedFact[] = [
  'companyType',
  'listing',
  'specialEntityTypes',
  'regulator',
  'group',
  'period',
  'accounting',
];

export function priorYearChanges(
  prior: TrackedFacts,
  current: TrackedFacts,
): ProfilePriorYearChange[] {
  return PRIOR_YEAR_FIELDS.filter((k) => prior[k] !== undefined).map((k) => ({
    field: k,
    label: TRACKED_LABEL[k],
    prior: prior[k] ?? null,
    current: current[k] ?? null,
    changed: (prior[k] ?? null) !== (current[k] ?? null),
  }));
}

/** The tracked facts that differ between two snapshots (only keys both hold). */
export function changedTrackedFacts(before: TrackedFacts, after: TrackedFacts): TrackedFact[] {
  return (Object.keys(TRACKED_LABEL) as TrackedFact[]).filter(
    (k) => before[k] !== undefined && after[k] !== undefined && before[k] !== after[k],
  );
}

export function trackedFactLabel(k: TrackedFact): string {
  return TRACKED_LABEL[k];
}

const ALL_SUB_SECTIONS: SubSectionKey[] = Object.values(SUB_SECTION_KEY);
const CLASSIFICATION_SECTIONS: SubSectionKey[] = [
  SUB_SECTION_KEY.financialReporting,
  SUB_SECTION_KEY.scheduleIii,
  SUB_SECTION_KEY.caro,
  SUB_SECTION_KEY.icfr,
  SUB_SECTION_KEY.otherReporting,
];

/**
 * The downstream trigger map (spec §16): which 02.x assessments a changed 02.1
 * fact feeds. 02.8 (SA flags) and 02.9 read the profile live, so a change there
 * needs no flag; SA 510/402/299 changes ripple through the 02.8 summary.
 */
const DOWNSTREAM: Record<TrackedFact, SubSectionKey[]> = {
  companyType: CLASSIFICATION_SECTIONS,
  specialEntityTypes: CLASSIFICATION_SECTIONS,
  regulator: CLASSIFICATION_SECTIONS,
  listing: [SUB_SECTION_KEY.financialReporting],
  group: [SUB_SECTION_KEY.financialReporting, SUB_SECTION_KEY.consolidation],
  financials: [SUB_SECTION_KEY.financialReporting, SUB_SECTION_KEY.caro, SUB_SECTION_KEY.icfr],
  smallCompany: [SUB_SECTION_KEY.scheduleIii, SUB_SECTION_KEY.caro, SUB_SECTION_KEY.icfr],
  period: ALL_SUB_SECTIONS,
  accounting: [],
  initialAudit: [],
  serviceOrg: [],
  jointAudit: [],
};

export function downstreamSectionsFor(changed: readonly TrackedFact[]): SubSectionKey[] {
  const out = new Set<SubSectionKey>();
  for (const k of changed) for (const s of DOWNSTREAM[k]) out.add(s);
  return ALL_SUB_SECTIONS.filter((s) => out.has(s));
}

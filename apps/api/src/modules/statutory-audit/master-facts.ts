import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  FINANCIAL_UNIT_FACTOR,
  type DatasetStatus,
  type FinancialPeriod,
  type FinancialUnit,
  type IndustryProfile,
  type MetricSourceType,
  type UnderstandingAnswer,
  type UnderstandingSectionKey,
  type ClientMasterSection,
  type MasterFact,
  type MasterFactFix,
  type UnderstandingContextItem,
} from '@hsdg/contracts';

/**
 * Capture-once master facts for an audit file (Guide §1; Section 01 §4, 02.1,
 * 03.2 "prefill stable facts"). Everything the portal already holds about the
 * engagement and its entity — identity, registrations, addresses, group,
 * listing, activities, team and the entity's financial profiles — read ONCE
 * here so every section displays or seeds it instead of asking the team to
 * type it again. Corrections belong in the source master, never in the file.
 *
 * The reader runs inside the caller's RLS transaction; the helpers below it
 * are pure and unit-tested.
 */

export interface MasterFinancialProfile {
  financialYear: string;
  revenue: number | null;
  turnover: number | null;
  otherIncome: number | null;
  profitBeforeTax: number | null;
  netProfit: number | null;
  netWorth: number | null;
  paidUpCapital: number | null;
  totalAssets: number | null;
  totalBorrowings: number | null;
  source: string | null;
  verified: boolean;
  documentRef: string | null;
}

export interface MasterRelationship {
  type: string;
  counterparty: string;
  /** True when the engagement entity is the `from` side of the link. */
  outbound: boolean;
  shareholdingPct: number | null;
  /** The counterparty's entity type (e.g. `public_limited`), for CARO's public-company test. */
  counterpartyTypeSlug: string | null;
  /** The counterparty has a security listed on an exchange. */
  counterpartyListed: boolean;
  /**
   * Why the counterparty applies Ind AS, when the portal shows it does: listed
   * on a main board (NSE/BSE), or its own audit file concluded Ind AS.
   */
  counterpartyIndAs: 'listed' | 'ind_as_file' | null;
}

export interface EngagementMasterFacts {
  /** The client (entity) the engagement is for — the target of every fix link. */
  entityId: string;
  engagementCode: string;
  financialYear: string;
  periodLabel: string | null;
  currency: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  mandateLetterReference: string | null;
  mandateLetterDate: string | null;
  partnerName: string | null;
  managerName: string | null;
  officeName: string | null;
  predecessorEngagementCode: string | null;
  legalName: string;
  entityTypeName: string;
  entityTypeSlug: string;
  entityCategory: string;
  pan: string | null;
  /** CIN / LLPIN — the principal corporate identifier on the registrations master. */
  corporateId: { type: string; number: string } | null;
  incorporationDate: string | null;
  roc: string | null;
  registeredOffice: string | null;
  /** Non-registered operating addresses (business / branch). */
  locations: string[];
  /** Branch addresses on the master (§143(8) branch-auditor framework). */
  branchCount: number;
  listingStatus: string;
  listings: string[];
  /** Raw exchanges of the live listings (`nse`, `bse`, `sme`, `other`). */
  listingExchanges: string[];
  paidUpCapital: number | null;
  annualTurnover: number | null;
  businessDescription: string | null;
  activityFlags: ActivityFlags;
  primaryIndustry: string | null;
  /** Every industry on the business-activities master (slugs, e.g. `nbfc`). */
  industrySlugs: string[];
  /** Structured regulatory facts on the master (§15). */
  regulatory: RegulatoryMasterFacts;
  groupName: string | null;
  relationships: MasterRelationship[];
  /** Financial profile for the audit year, and the year before it. */
  cyFinancials: MasterFinancialProfile | null;
  pyFinancials: MasterFinancialProfile | null;
}

export interface RegulatoryMasterFacts {
  isGovernmentCompany: boolean | null;
  /** `regulated_sector` entries (free text, e.g. "NBFC", "Banking"). */
  regulatedSector: string[];
  /** `special_regulatory_status` entries (free text, e.g. "Section 8 company"). */
  specialStatus: string[];
}

export interface ActivityFlags {
  manufacturing: boolean;
  trading: boolean;
  services: boolean;
  import: boolean;
  export: boolean;
  ecommerce: boolean;
  regulated: boolean;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** `2024-25` → `2023-24`. Returns null for a label it cannot read. */
export function previousFinancialYear(fy: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy.trim());
  if (!m) return null;
  const start = Number(m[1]) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Indian financial year → its 31 March period end (`2024-25` → `2025-03-31`). */
export function periodEndFromFinancialYear(fy: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(fy.trim())) return null;
  const start = auditPeriodStartFromFinancialYear(fy.trim());
  return `${Number(start.slice(0, 4)) + 1}-03-31`;
}

export function formatAddress(a: {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}): string | null {
  const tail = [a.state, a.pincode].filter(Boolean).join(' ');
  const parts = [a.line1, a.line2, a.city, tail].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** BU-01 options the entity master's activity flags already answer. */
export function activitiesFromFlags(f: ActivityFlags): string[] {
  const out: string[] = [];
  if (f.manufacturing) out.push('Manufacturing');
  if (f.trading || f.ecommerce) out.push('Trading / distribution');
  if (f.services) out.push('Services');
  return out;
}

/** BU-04 customer-profile options the flags answer (export sales are a fact). */
export function customerTypesFromFlags(f: ActivityFlags): string[] {
  return f.export ? ['Export'] : [];
}

/**
 * The 03.2 analytics profile the master points to. Only an unambiguous single
 * activity picks a specific profile; anything mixed stays generic for the
 * Manager to choose.
 */
export function industryProfileFromFacts(
  f: Pick<EngagementMasterFacts, 'activityFlags' | 'entityTypeSlug'>,
  specialEntityTypes: readonly string[] = [],
): IndustryProfile | null {
  if (specialEntityTypes.includes('nbfc')) return 'nbfc';
  if (specialEntityTypes.includes('section_8')) return 'section8';
  const picks: IndustryProfile[] = [];
  if (f.activityFlags.manufacturing) picks.push('manufacturing');
  if (f.activityFlags.trading || f.activityFlags.ecommerce) picks.push('trading');
  if (f.activityFlags.services) picks.push('services');
  return picks.length === 1 ? picks[0]! : null;
}

/** 03.2.7 canonical metric → value on a master financial profile. */
export function datasetValuesFromProfile(
  p: MasterFinancialProfile,
): Array<{ metricKey: string; amount: number }> {
  const pairs: Array<[string, number | null]> = [
    ['revenue', p.revenue ?? p.turnover],
    ['other_income', p.otherIncome],
    ['pbt', p.profitBeforeTax],
    ['pat', p.netProfit],
    ['total_assets', p.totalAssets],
    ['net_worth', p.netWorth],
    ['total_borrowings', p.totalBorrowings],
  ];
  return pairs
    .filter((x): x is [string, number] => x[1] !== null && Number.isFinite(x[1]))
    .map(([metricKey, amount]) => ({ metricKey, amount }));
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  holding: 'Holding company',
  subsidiary: 'Subsidiary',
  wholly_owned_subsidiary: 'Wholly-owned subsidiary',
  associate: 'Associate',
  joint_venture: 'Joint venture',
  step_down_subsidiary: 'Step-down subsidiary',
  fellow_subsidiary: 'Fellow subsidiary',
  ultimate_holding: 'Ultimate holding company',
  intermediate_holding: 'Intermediate holding company',
  other: 'Related entity',
};

export function describeRelationship(r: MasterRelationship): string {
  const label = RELATIONSHIP_LABEL[r.type] ?? r.type.replace(/_/g, ' ');
  const pct = r.shareholdingPct !== null ? ` (${r.shareholdingPct}%)` : '';
  return `${label}: ${r.counterparty}${pct}`;
}

/**
 * Read the group structure off the relationships master. An edge reads "from
 * IS <type> OF to" (entity_relationships migration), so for this entity:
 *   • outbound subsidiary-type / inbound holding-type → the counterparty is a parent;
 *   • inbound subsidiary/associate/JV-type / outbound holding-type → an investee.
 * Fellow subsidiaries and "other" links are neither.
 */
const SUBSIDIARY_TYPES = ['subsidiary', 'wholly_owned_subsidiary', 'step_down_subsidiary'];
const HOLDING_TYPES = ['holding', 'ultimate_holding', 'intermediate_holding'];

export type InvesteeKind = 'subsidiary' | 'associate' | 'joint_venture';

export interface GroupStructure {
  parents: Array<MasterRelationship & { whollyOwned: boolean }>;
  investees: Array<MasterRelationship & { kind: InvesteeKind }>;
}

export function groupStructure(rels: readonly MasterRelationship[]): GroupStructure {
  const parents: GroupStructure['parents'] = [];
  const investees: GroupStructure['investees'] = [];
  for (const r of rels) {
    const isParent =
      (r.outbound && SUBSIDIARY_TYPES.includes(r.type)) ||
      (!r.outbound && HOLDING_TYPES.includes(r.type));
    if (isParent) {
      parents.push({
        ...r,
        whollyOwned: r.type === 'wholly_owned_subsidiary' || r.shareholdingPct === 100,
      });
      continue;
    }
    if (!r.outbound && SUBSIDIARY_TYPES.includes(r.type))
      investees.push({ ...r, kind: 'subsidiary' });
    else if (r.outbound && HOLDING_TYPES.includes(r.type))
      investees.push({ ...r, kind: 'subsidiary' });
    else if (!r.outbound && r.type === 'associate') investees.push({ ...r, kind: 'associate' });
    else if (!r.outbound && r.type === 'joint_venture')
      investees.push({ ...r, kind: 'joint_venture' });
  }
  return { parents, investees };
}

/** The form on Client 360 that adds or corrects a master fact. */
export function fixFor(
  m: Pick<EngagementMasterFacts, 'entityId' | 'financialYear'>,
  section: ClientMasterSection,
): MasterFactFix | undefined {
  if (!m.entityId) return undefined;
  return section === 'financials'
    ? { entityId: m.entityId, section, financialYear: m.financialYear }
    : { entityId: m.entityId, section };
}

/** Attach fix links to facts by label (facts not listed are left as they are). */
export function withFixes(
  m: Pick<EngagementMasterFacts, 'entityId' | 'financialYear'>,
  facts: MasterFact[],
  sections: Record<string, ClientMasterSection>,
): MasterFact[] {
  return facts.map((f) => {
    const section = sections[f.label];
    const fix = section ? fixFor(m, section) : undefined;
    return fix ? { ...f, fix } : f;
  });
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/**
 * The Section 01.1 Engagement Profile card (spec §4): every fact read-only
 * from the entity / engagement masters, with its source.
 */
export function engagementProfileFacts(
  f: EngagementMasterFacts,
  audit: { initialAudit: boolean | null },
): MasterFact[] {
  const E = 'Entity master';
  const G = 'Engagement';
  const rows: Array<[string, string | null, string]> = [
    ['Client name', f.legalName, E],
    [f.corporateId?.type.toUpperCase() ?? 'CIN', f.corporateId?.number ?? null, E],
    ['PAN', f.pan, E],
    ['Company type', f.entityTypeName, E],
    ['Date of incorporation', f.incorporationDate, E],
    ['Registered office', f.registeredOffice, E],
    ['RoC', f.roc, E],
    ['Group', f.groupName, E],
    ['Financial year', f.financialYear, G],
    [
      'Audit period',
      periodEndFromFinancialYear(f.financialYear)
        ? `${auditPeriodStartFromFinancialYear(f.financialYear)} to ${periodEndFromFinancialYear(f.financialYear)}`
        : f.periodLabel,
      G,
    ],
    ['Engagement partner', f.partnerName, G],
    ['Engagement manager', f.managerName, G],
    ['Office', f.officeName, G],
    [
      'First year / continuing audit',
      audit.initialAudit === null
        ? null
        : audit.initialAudit
          ? 'First-year audit'
          : 'Continuing audit',
      'System derived',
    ],
    ['Previous engagement', f.predecessorEngagementCode, G],
    [
      'Appointment letter',
      [f.mandateLetterReference, f.mandateLetterDate && `dated ${f.mandateLetterDate}`]
        .filter(Boolean)
        .join(' ') || null,
      G,
    ],
    ['Target audit completion', f.plannedEndDate, G],
  ];
  const corpLabel = f.corporateId?.type.toUpperCase() ?? 'CIN';
  return withFixes(
    f,
    rows.map(([label, value, source]) => ({ label, value, source })),
    {
      'Client name': 'details',
      [corpLabel]: 'registrations',
      PAN: 'details',
      'Company type': 'details',
      'Date of incorporation': 'details',
      'Registered office': 'addresses',
      RoC: 'details',
    },
  );
}

/**
 * 02.1 Entity & Regulatory Profile facts held on the master (Cards A/C/D):
 * classification, group, listing and the audit year's key figures with the
 * record they came from. Figures the team captured on the profile win.
 */
export function regulatoryProfileFacts(
  f: EngagementMasterFacts,
  captured: ReadonlyMap<string, number | null>,
): MasterFact[] {
  const E = 'Entity master';
  const cy = f.cyFinancials;
  const cySrc = cy ? `Financial profile FY ${cy.financialYear}` : null;
  const figure = (
    label: string,
    param: string,
    fromProfile: number | null | undefined,
    fromEntity: number | null = null,
  ): MasterFact => {
    const own = captured.get(param);
    if (own != null) return { label, value: inr(own), source: '02.1 (captured)' };
    if (fromProfile != null) return { label, value: inr(fromProfile), source: cySrc! };
    if (fromEntity != null) return { label, value: inr(fromEntity), source: E };
    return { label, value: null, source: E };
  };
  const facts: MasterFact[] = [
    { label: 'Entity type', value: f.entityTypeName, source: E },
    {
      label: f.corporateId?.type.toUpperCase() ?? 'CIN',
      value: f.corporateId?.number ?? null,
      source: E,
    },
    {
      label: 'Listing',
      value: f.listings.join('; ') || f.listingStatus.replace(/_/g, ' '),
      source: E,
    },
    {
      label: 'Group relationships',
      value: f.relationships.map(describeRelationship).join('; ') || 'None on record',
      source: E,
    },
    figure('Paid-up capital', 'paid_up_capital', cy?.paidUpCapital, f.paidUpCapital),
    figure('Turnover', 'turnover', cy?.turnover ?? cy?.revenue, f.annualTurnover),
    figure('Net worth', 'net_worth', cy?.netWorth),
    figure('Total assets', 'total_assets', cy?.totalAssets),
    figure('Borrowings', 'borrowings', cy?.totalBorrowings),
  ];
  // A figure the team captured on 02.1 is corrected there, not on the master.
  const figureLabels = ['Paid-up capital', 'Turnover', 'Net worth', 'Total assets', 'Borrowings'];
  return withFixes(f, facts, {
    'Entity type': 'details',
    [f.corporateId?.type.toUpperCase() ?? 'CIN']: 'registrations',
    Listing: 'listings',
    'Group relationships': 'relationships',
    ...Object.fromEntries(
      facts
        .filter((x) => figureLabels.includes(x.label) && x.source !== '02.1 (captured)')
        .map((x) => [x.label, 'financials' as const]),
    ),
  });
}

/** Master facts that answer 03.2.1 / 03.2.2 context lines (display only). */
export function understandingContextFacts(f: EngagementMasterFacts): {
  businessModel: UnderstandingContextItem[];
  governance: UnderstandingContextItem[];
  industry: UnderstandingContextItem[];
} {
  const E = 'Client master';
  const businessModel: UnderstandingContextItem[] = [];
  const add = (list: UnderstandingContextItem[], label: string, value: string | null) => {
    if (value) list.push({ label, value, source: E });
  };
  add(businessModel, 'Business description', f.businessDescription);
  add(
    businessModel,
    'Activities on master',
    [
      f.activityFlags.manufacturing && 'Manufacturing',
      f.activityFlags.trading && 'Trading',
      f.activityFlags.services && 'Services',
      f.activityFlags.import && 'Imports',
      f.activityFlags.export && 'Exports',
      f.activityFlags.ecommerce && 'E-commerce',
      f.activityFlags.regulated && 'Regulated activity',
    ]
      .filter(Boolean)
      .join(', ') || null,
  );
  add(businessModel, 'Registered office', f.registeredOffice);
  add(businessModel, 'Other locations', f.locations.join('; ') || null);
  if (f.annualTurnover !== null)
    add(businessModel, 'Annual turnover (master)', inr(f.annualTurnover));

  const governance: UnderstandingContextItem[] = [];
  add(governance, 'Entity type', f.entityTypeName);
  add(governance, 'Group', f.groupName);
  for (const r of f.relationships) add(governance, 'Group relationship', describeRelationship(r));
  add(
    governance,
    'Listing',
    f.listings.join('; ') ||
      (f.listingStatus !== 'unlisted' ? f.listingStatus.replace(/_/g, ' ') : null),
  );
  if (f.paidUpCapital !== null) add(governance, 'Paid-up capital', inr(f.paidUpCapital));

  const industry: UnderstandingContextItem[] = [];
  add(industry, 'Industry (master)', f.primaryIndustry);
  return { businessModel, governance, industry };
}

// ── 03.2 prefill plan ─────────────────────────────────────────────────────────

/** What 03.2 already holds — the plan only ever fills what is missing. */
export interface UnderstandingState {
  header: {
    exists: boolean;
    periodEnd: string | null;
    pyPeriodEnd: string | null;
    currency: string | null;
    units: FinancialUnit | null;
    pyUnits: FinancialUnit | null;
    cySource: string | null;
    pySource: string | null;
    dataStatus: DatasetStatus | null;
  };
  /** `${metricKey}:${period}` already recorded. */
  recordedValues: ReadonlySet<string>;
  /** Sections the team has already saved (never touched by a prefill). */
  savedSections: ReadonlySet<UnderstandingSectionKey>;
  industryProfile: IndustryProfile;
  specialEntityTypes: readonly string[];
}

export interface UnderstandingPrefillPlan {
  /** Header columns to set (only those currently blank). */
  header: Partial<{
    period_end: string;
    py_period_end: string;
    currency: string;
    units: FinancialUnit;
    cy_source: string;
    py_source: string;
    data_status: DatasetStatus;
  }>;
  values: Array<{
    metricKey: string;
    period: FinancialPeriod;
    amount: number;
    sourceType: MetricSourceType;
    sourceRef: string;
  }>;
  sections: Array<{ key: UnderstandingSectionKey; answers: Record<string, UnderstandingAnswer> }>;
  industryProfile: IndustryProfile | null;
}

function profileSourceLabel(p: MasterFinancialProfile): string {
  const kind =
    p.source === 'audited_financials'
      ? 'audited financials'
      : p.source === 'provisional_financials'
        ? 'provisional financials'
        : 'financial profile';
  return `Client master — FY ${p.financialYear} ${kind}${p.documentRef ? ` (${p.documentRef})` : ''}`;
}

function valueSourceType(p: MasterFinancialProfile, period: FinancialPeriod): MetricSourceType {
  if (period === 'py' && (p.source === 'audited_financials' || p.verified)) return 'audited_py_fs';
  if (period === 'cy' && p.source === 'provisional_financials') return 'draft_fs';
  return 'other';
}

function datasetStatusOf(p: MasterFinancialProfile): DatasetStatus {
  if (p.source === 'audited_financials') return 'final';
  if (p.source === 'provisional_financials') return 'draft';
  return 'management_accounts';
}

/**
 * Plan the capture-once 03.2 prefill (spec §4 "prefill stable facts", §28).
 * Pure: blank header fields, unrecorded figures, unsaved sections and a
 * still-generic analytics profile are filled from the masters; anything the
 * team has recorded is left exactly as it is.
 */
export function planUnderstandingPrefill(
  m: EngagementMasterFacts,
  st: UnderstandingState,
): UnderstandingPrefillPlan {
  const h = st.header;
  const header: UnderstandingPrefillPlan['header'] = {};
  const periodEnd = periodEndFromFinancialYear(m.financialYear);
  const pyFy = previousFinancialYear(m.financialYear);
  const pyPeriodEnd = pyFy ? periodEndFromFinancialYear(pyFy) : null;
  if (!h.periodEnd && periodEnd) header.period_end = periodEnd;
  if (!h.pyPeriodEnd && pyPeriodEnd) header.py_period_end = pyPeriodEnd;
  if (!h.currency && /^[A-Z]{3}$/.test(m.currency)) header.currency = m.currency;
  // Master figures are held in rupees; a header the team set to lakh/crore is
  // respected and the figures are converted into it.
  const hasFigures = Boolean(m.cyFinancials || m.pyFinancials);
  if (!h.units && hasFigures) header.units = 'inr';
  if (m.cyFinancials) {
    if (!h.cySource) header.cy_source = profileSourceLabel(m.cyFinancials);
    if (!h.dataStatus) header.data_status = datasetStatusOf(m.cyFinancials);
  }
  if (m.pyFinancials && !h.pySource) header.py_source = profileSourceLabel(m.pyFinancials);

  const values: UnderstandingPrefillPlan['values'] = [];
  const cyUnits = h.units ?? header.units ?? null;
  const pyUnits = h.pyUnits ?? cyUnits;
  const push = (
    p: MasterFinancialProfile | null,
    period: FinancialPeriod,
    units: FinancialUnit | null,
  ) => {
    const factor = units ? FINANCIAL_UNIT_FACTOR[units] : null;
    if (!p || !factor) return;
    for (const v of datasetValuesFromProfile(p)) {
      if (st.recordedValues.has(`${v.metricKey}:${period}`)) continue;
      values.push({
        metricKey: v.metricKey,
        period,
        amount: Math.round((v.amount / factor) * 100) / 100,
        sourceType: valueSourceType(p, period),
        sourceRef: profileSourceLabel(p),
      });
    }
  };
  push(m.cyFinancials, 'cy', cyUnits);
  push(m.pyFinancials, 'py', pyUnits);

  const sections: UnderstandingPrefillPlan['sections'] = [];
  if (!st.savedSections.has('business_model')) {
    const answers: Record<string, UnderstandingAnswer> = {};
    const activities = activitiesFromFlags(m.activityFlags);
    if (activities.length) answers.activities = activities;
    if (m.businessDescription?.trim()) answers.activities_note = m.businessDescription.trim();
    const customers = customerTypesFromFlags(m.activityFlags);
    if (customers.length) answers.customer_types = customers;
    if (m.locations.length) answers.locations = m.locations.join('; ');
    if (Object.keys(answers).length) sections.push({ key: 'business_model', answers });
  }
  if (!st.savedSections.has('governance')) {
    const { parents } = groupStructure(m.relationships);
    if (parents.length) {
      sections.push({
        key: 'governance',
        answers: {
          promoters: parents.map((r) => [
            r.counterparty,
            describeRelationship(r).split(':')[0]! +
              (r.shareholdingPct !== null ? ` — ${r.shareholdingPct}%` : ''),
            'Client master',
          ]),
        },
      });
    }
  }

  const derived =
    st.industryProfile === 'generic' ? industryProfileFromFacts(m, st.specialEntityTypes) : null;
  return { header, values, sections, industryProfile: derived };
}

// ── Reader ───────────────────────────────────────────────────────────────────

interface FinancialRow {
  financial_year: string;
  revenue: string | null;
  turnover: string | null;
  other_income: string | null;
  profit_before_tax: string | null;
  net_profit: string | null;
  net_worth: string | null;
  paid_up_capital: string | null;
  total_assets: string | null;
  total_borrowings: string | null;
  source: string | null;
  verified: boolean;
  supporting_document_ref: string | null;
}

const n = (v: string | null): number | null => (v === null ? null : Number(v));

function toProfile(r: FinancialRow | undefined): MasterFinancialProfile | null {
  if (!r) return null;
  return {
    financialYear: r.financial_year,
    revenue: n(r.revenue),
    turnover: n(r.turnover),
    otherIncome: n(r.other_income),
    profitBeforeTax: n(r.profit_before_tax),
    netProfit: n(r.net_profit),
    netWorth: n(r.net_worth),
    paidUpCapital: n(r.paid_up_capital),
    totalAssets: n(r.total_assets),
    totalBorrowings: n(r.total_borrowings),
    source: r.source,
    verified: r.verified,
    documentRef: r.supporting_document_ref,
  };
}

/** Read every master fact for the engagement behind an audit-file shell. */
export async function readEngagementMasterFacts(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<EngagementMasterFacts | null> {
  const { rows } = await client.query<{
    entity_id: string;
    engagement_code: string;
    financial_year: string;
    period_label: string | null;
    currency: string;
    planned_start_date: string | null;
    planned_end_date: string | null;
    mandate_letter_reference: string | null;
    mandate_letter_date: string | null;
    partner_name: string | null;
    manager_name: string | null;
    office_name: string | null;
    predecessor_code: string | null;
    legal_name: string;
    type_name: string;
    type_slug: string;
    type_category: string;
    pan: string | null;
    incorporation_date: string | null;
    roc: string | null;
    listing_status: string;
    paid_up_capital: string | null;
    annual_turnover: string | null;
    business_description: string | null;
    act_manufacturing: boolean;
    act_trading: boolean;
    act_services: boolean;
    act_import: boolean;
    act_export: boolean;
    act_ecommerce: boolean;
    act_regulated: boolean;
    group_name: string | null;
  }>(
    `SELECT e.entity_id, e.engagement_code, e.financial_year, e.period_label, e.currency,
            e.planned_start_date::text, e.planned_end_date::text,
            e.mandate_letter_reference, e.mandate_letter_date::text,
            ep.full_name AS partner_name, em.full_name AS manager_name, o.name AS office_name,
            pred.engagement_code AS predecessor_code,
            en.legal_name, et.name AS type_name, et.slug AS type_slug, et.category AS type_category,
            en.pan, en.incorporation_date::text, en.roc, en.listing_status,
            en.paid_up_capital, en.annual_turnover, en.business_description,
            en.act_manufacturing, en.act_trading, en.act_services, en.act_import, en.act_export,
            en.act_ecommerce, en.act_regulated, g.name AS group_name
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.entities en ON en.id = e.entity_id
       JOIN hsdg.entity_types et ON et.id = en.entity_type_id
       LEFT JOIN hsdg.entity_groups g ON g.id = en.group_id
       LEFT JOIN hsdg.employees ep ON ep.id = e.engagement_partner_id
       LEFT JOIN hsdg.employees em ON em.id = e.engagement_manager_id
       LEFT JOIN hsdg.offices o ON o.id = e.office_id
       LEFT JOIN hsdg.engagements pred ON pred.id = e.predecessor_engagement_id
      WHERE wi.id = $1`,
    [workflowInstanceId],
  );
  const r = rows[0];
  if (!r) return null;
  const entityId = r.entity_id;

  // Sequential on purpose: one pooled client runs one query at a time.
  const regs = await client.query<{ registration_type: string; registration_number: string }>(
    `SELECT registration_type, registration_number FROM hsdg.entity_registrations
        WHERE entity_id = $1 AND registration_type IN ('cin','llpin')
          AND COALESCE(status, 'active') <> 'cancelled'
        ORDER BY is_principal DESC NULLS LAST, created_at LIMIT 1`,
    [entityId],
  );
  const addrs = await client.query<{
    address_type: string;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  }>(
    `SELECT address_type, line1, line2, city, state, pincode FROM hsdg.entity_addresses
        WHERE entity_id = $1 ORDER BY is_primary DESC, created_at`,
    [entityId],
  );
  const listings = await client.query<{
    exchange: string;
    security_type: string;
    symbol: string | null;
  }>(
    `SELECT exchange, security_type, symbol FROM hsdg.entity_listings
        WHERE entity_id = $1 AND status = 'listed' ORDER BY created_at`,
    [entityId],
  );
  const industry = await client.query<{ name: string }>(
    `SELECT i.name FROM hsdg.entity_business_activities a
         JOIN hsdg.industries i ON i.id = a.industry_id
        WHERE a.entity_id = $1 ORDER BY a.is_primary DESC, a.created_at LIMIT 1`,
    [entityId],
  );
  const industries = await client.query<{ slug: string }>(
    `SELECT DISTINCT i.slug FROM hsdg.entity_business_activities a
         JOIN hsdg.industries i ON i.id = a.industry_id
        WHERE a.entity_id = $1`,
    [entityId],
  );
  const attrs = await client.query<{
    attribute_code: string;
    value_text: string | null;
    value_boolean: boolean | null;
  }>(
    `SELECT attribute_code, value_text, value_boolean FROM hsdg.entity_regulatory_attributes
        WHERE entity_id = $1
          AND attribute_code IN ('is_government_company', 'regulated_sector', 'special_regulatory_status')`,
    [entityId],
  );
  const texts = (code: string) =>
    attrs.rows
      .filter((a) => a.attribute_code === code && a.value_text?.trim())
      .map((a) => a.value_text!.trim());
  const gov = attrs.rows.find((a) => a.attribute_code === 'is_government_company');
  const rels = await client.query<{
    relationship_type: string;
    shareholding_pct: string | null;
    outbound: boolean;
    counterparty: string;
    counterparty_type: string | null;
    counterparty_listed: boolean;
    counterparty_ind_as: 'listed' | 'ind_as_file' | null;
  }>(
    `SELECT r.relationship_type, r.shareholding_pct, r.from_entity_id = $1 AS outbound,
              other.legal_name AS counterparty, ot.slug AS counterparty_type,
              EXISTS (SELECT 1 FROM hsdg.entity_listings l
                       WHERE l.entity_id = other.id AND l.status = 'listed') AS counterparty_listed,
              CASE
                WHEN EXISTS (SELECT 1 FROM hsdg.entity_listings l
                              WHERE l.entity_id = other.id AND l.status = 'listed'
                                AND l.exchange IN ('nse', 'bse')) THEN 'listed'
                WHEN EXISTS (SELECT 1 FROM hsdg.audit_framework_subassessment s
                               JOIN hsdg.service_workflow_instances swi
                                 ON swi.id = s.workflow_instance_id AND swi.status <> 'cancelled'
                               JOIN hsdg.engagements oe ON oe.id = swi.engagement_id
                              WHERE oe.entity_id = other.id AND s.sub_section_key = $2
                                AND s.area_key = $3 AND s.conclusion = 'ind_as') THEN 'ind_as_file'
              END AS counterparty_ind_as
         FROM hsdg.entity_relationships r
         JOIN hsdg.entities other
           ON other.id = CASE WHEN r.from_entity_id = $1 THEN r.to_entity_id ELSE r.from_entity_id END
         LEFT JOIN hsdg.entity_types ot ON ot.id = other.entity_type_id
        WHERE $1 IN (r.from_entity_id, r.to_entity_id) AND r.status = 'active'
        ORDER BY r.created_at`,
    [entityId, SUB_SECTION_KEY.financialReporting, FRAMEWORK_AREA_KEY.financialReportingFramework],
  );
  const fins = await client.query<FinancialRow>(
    `SELECT DISTINCT ON (financial_year) financial_year, revenue, turnover, other_income,
              profit_before_tax, net_profit, net_worth, paid_up_capital, total_assets,
              total_borrowings, source, verified, supporting_document_ref
         FROM hsdg.entity_financial_profiles
        WHERE entity_id = $1 AND financial_year = ANY($2::text[])
        ORDER BY financial_year, is_current DESC, created_at DESC`,
    [entityId, [r.financial_year, previousFinancialYear(r.financial_year)].filter(Boolean)],
  );

  const registered = addrs.rows.find((a) => a.address_type === 'registered');
  const pyFy = previousFinancialYear(r.financial_year);
  return {
    entityId,
    engagementCode: r.engagement_code,
    financialYear: r.financial_year,
    periodLabel: r.period_label,
    currency: r.currency,
    plannedStartDate: r.planned_start_date,
    plannedEndDate: r.planned_end_date,
    mandateLetterReference: r.mandate_letter_reference,
    mandateLetterDate: r.mandate_letter_date,
    partnerName: r.partner_name,
    managerName: r.manager_name,
    officeName: r.office_name,
    predecessorEngagementCode: r.predecessor_code,
    legalName: r.legal_name,
    entityTypeName: r.type_name,
    entityTypeSlug: r.type_slug,
    entityCategory: r.type_category,
    pan: r.pan,
    corporateId: regs.rows[0]
      ? { type: regs.rows[0].registration_type, number: regs.rows[0].registration_number }
      : null,
    incorporationDate: r.incorporation_date,
    roc: r.roc,
    registeredOffice: registered ? formatAddress(registered) : null,
    locations: addrs.rows
      .filter((a) => a !== registered && ['business', 'branch'].includes(a.address_type))
      .map(formatAddress)
      .filter((a): a is string => a !== null),
    branchCount: addrs.rows.filter((a) => a.address_type === 'branch').length,
    listingStatus: r.listing_status,
    listingExchanges: listings.rows.map((l) => l.exchange),
    listings: listings.rows.map((l) =>
      [l.exchange.toUpperCase(), l.security_type, l.symbol].filter(Boolean).join(' · '),
    ),
    paidUpCapital: n(r.paid_up_capital),
    annualTurnover: n(r.annual_turnover),
    businessDescription: r.business_description,
    activityFlags: {
      manufacturing: r.act_manufacturing,
      trading: r.act_trading,
      services: r.act_services,
      import: r.act_import,
      export: r.act_export,
      ecommerce: r.act_ecommerce,
      regulated: r.act_regulated,
    },
    primaryIndustry: industry.rows[0]?.name ?? null,
    industrySlugs: industries.rows.map((x) => x.slug),
    regulatory: {
      isGovernmentCompany: gov?.value_boolean ?? null,
      regulatedSector: texts('regulated_sector'),
      specialStatus: texts('special_regulatory_status'),
    },
    groupName: r.group_name,
    relationships: rels.rows.map((x) => ({
      type: x.relationship_type,
      counterparty: x.counterparty,
      outbound: x.outbound,
      shareholdingPct: n(x.shareholding_pct),
      counterpartyTypeSlug: x.counterparty_type,
      counterpartyListed: x.counterparty_listed,
      counterpartyIndAs: x.counterparty_ind_as,
    })),
    cyFinancials: toProfile(fins.rows.find((x) => x.financial_year === r.financial_year)),
    pyFinancials: pyFy ? toProfile(fins.rows.find((x) => x.financial_year === pyFy)) : null,
  };
}

/**
 * First-year vs continuing audit: the 02.1 profile's value when the team set
 * it, else derived from engagement history (an earlier statutory-audit file for
 * the same entity ⇒ continuing).
 */
export async function readInitialAudit(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<boolean | null> {
  const profile = await client.query<{ initial_audit: boolean; initial_audit_derived: boolean }>(
    `SELECT initial_audit, initial_audit_derived FROM hsdg.audit_entity_profile
      WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  // A value the team set wins; a system-derived one is re-derived from history.
  if (profile.rows[0] && !profile.rows[0].initial_audit_derived) {
    return profile.rows[0].initial_audit;
  }
  const prior = await client.query(
    `SELECT 1
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.service_workflow_instances other ON other.id <> wi.id
                                                  AND other.status <> 'cancelled'
                                                  AND other.workflow_key = 'statutory_audit'
       JOIN hsdg.engagements e2 ON e2.id = other.engagement_id
      WHERE wi.id = $1 AND e2.entity_id = e.entity_id AND e2.financial_year < e.financial_year
      LIMIT 1`,
    [workflowInstanceId],
  );
  return (prior.rowCount ?? 0) === 0;
}

/** Whether the acting user may write the audit file (RLS lead check). */
export async function isEngagementLead(client: PoolClient, engagementId: string): Promise<boolean> {
  const { rows } = await client.query<{ lead: boolean }>(
    `SELECT hsdg.is_engagement_lead($1) AS lead`,
    [engagementId],
  );
  return rows[0]?.lead === true;
}

// ── 02.5 / 02.7 sources beyond the entity master ─────────────────────────────

/** One AOC-4 / MGT-7 obligation tracked on the compliance calendar. */
export interface RocFiling {
  form: 'AOC-4' | 'MGT-7';
  deadline: string;
  status: 'open' | 'completed' | 'waived';
  /** ISO date the filing was marked done, when it was. */
  completedOn: string | null;
}

export interface ClientDirector {
  fullName: string;
  designation: string | null;
}

export interface ReportingSources {
  rocFilings: RocFiling[];
  directors: ClientDirector[];
  /** Last year's 02.7 facts for the same entity, with its financial year. */
  priorOtherReporting: { financialYear: string; facts: Record<string, unknown> } | null;
}

/**
 * Read the facts 02.5 ICFR and 02.7 other reporting can take from the portal:
 * the ROC filing record (compliance calendar), the directors on the contacts
 * master and last year's 02.7 file. Runs inside the caller's RLS transaction,
 * so only what the user may see is read.
 */
export async function readReportingSources(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ReportingSources> {
  const roc = await client.query<{
    code: string;
    deadline: string;
    status: RocFiling['status'];
    completed_on: string | null;
  }>(
    `SELECT cr.code,
            COALESCE(ci.statutory_deadline_override, ci.statutory_deadline)::text AS deadline,
            ci.status, (ci.completed_at AT TIME ZONE 'Asia/Kolkata')::date::text AS completed_on
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.engagements e2 ON e2.entity_id = e.entity_id
       JOIN hsdg.compliance_instances ci ON ci.engagement_id = e2.id
       JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
      WHERE wi.id = $1 AND cr.code IN ('ROC_AOC4_DUE', 'ROC_MGT7_DUE')
      ORDER BY 2`,
    [workflowInstanceId],
  );
  const dirs = await client.query<{ full_name: string; designation: string | null }>(
    `SELECT c.full_name, c.designation
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.entity_contacts c ON c.entity_id = e.entity_id
      WHERE wi.id = $1
        AND (c.contact_type = 'director' OR c.designation ILIKE '%director%')
      ORDER BY c.created_at`,
    [workflowInstanceId],
  );
  const prior = await client.query<{ financial_year: string; facts: Record<string, unknown> }>(
    `SELECT e2.financial_year, s.facts
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.engagements e2 ON e2.entity_id = e.entity_id AND e2.financial_year < e.financial_year
       JOIN hsdg.service_workflow_instances wi2 ON wi2.engagement_id = e2.id
                                              AND wi2.status <> 'cancelled'
       JOIN hsdg.audit_framework_subassessment s ON s.workflow_instance_id = wi2.id
      WHERE wi.id = $1 AND s.sub_section_key = $2 AND s.area_key = $3 AND s.facts IS NOT NULL
      ORDER BY e2.financial_year DESC, s.updated_at DESC
      LIMIT 1`,
    [workflowInstanceId, SUB_SECTION_KEY.otherReporting, FRAMEWORK_AREA_KEY.otherRegulatory],
  );
  return {
    rocFilings: roc.rows.map((r) => ({
      form: r.code === 'ROC_AOC4_DUE' ? 'AOC-4' : 'MGT-7',
      deadline: r.deadline,
      status: r.status,
      completedOn: r.completed_on,
    })),
    directors: dirs.rows.map((d) => ({ fullName: d.full_name, designation: d.designation })),
    priorOtherReporting: prior.rows[0]
      ? { financialYear: prior.rows[0].financial_year, facts: prior.rows[0].facts }
      : null,
  };
}

/** The latest earlier-year file's assessment for one framework section of this entity. */
export interface PriorSubAssessment {
  financialYear: string;
  facts: Record<string, unknown> | null;
  conclusion: string | null;
}

export async function readPriorSubAssessment(
  client: PoolClient,
  workflowInstanceId: string,
  keys: { sub: string; area: string },
): Promise<PriorSubAssessment | null> {
  const { rows } = await client.query<{
    financial_year: string;
    facts: Record<string, unknown> | null;
    conclusion: string | null;
  }>(
    `SELECT e2.financial_year, s.facts, s.conclusion
       FROM hsdg.service_workflow_instances wi
       JOIN hsdg.engagements e ON e.id = wi.engagement_id
       JOIN hsdg.engagements e2 ON e2.entity_id = e.entity_id AND e2.financial_year < e.financial_year
       JOIN hsdg.service_workflow_instances wi2 ON wi2.engagement_id = e2.id
                                              AND wi2.status <> 'cancelled'
       JOIN hsdg.audit_framework_subassessment s ON s.workflow_instance_id = wi2.id
      WHERE wi.id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
        AND (s.facts IS NOT NULL OR s.conclusion IS NOT NULL)
      ORDER BY e2.financial_year DESC, s.updated_at DESC
      LIMIT 1`,
    [workflowInstanceId, keys.sub, keys.area],
  );
  const r = rows[0];
  return r ? { financialYear: r.financial_year, facts: r.facts, conclusion: r.conclusion } : null;
}

/** Last year's statutory-audit file for the same client (latest earlier FY, live). */
export interface PriorAuditFile {
  workflowInstanceId: string;
  engagementId: string;
  financialYear: string;
}

/**
 * The prior-year file of the same client: the engagement's recorded
 * predecessor first, else the latest earlier financial year with a live
 * statutory-audit file. Runs in the caller's RLS transaction.
 */
export async function readPriorAuditFile(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<PriorAuditFile | null> {
  const { rows } = await client.query<{
    workflow_instance_id: string;
    engagement_id: string;
    financial_year: string;
  }>(
    `SELECT pw.id AS workflow_instance_id, pe.id AS engagement_id, pe.financial_year
       FROM hsdg.service_workflow_instances w
       JOIN hsdg.engagements e ON e.id = w.engagement_id
       JOIN hsdg.engagements pe
         ON pe.id = e.predecessor_engagement_id
         OR (pe.entity_id = e.entity_id AND pe.financial_year < e.financial_year)
       JOIN hsdg.service_workflow_instances pw
         ON pw.engagement_id = pe.id AND pw.status <> 'cancelled'
        AND pw.workflow_key = 'statutory_audit' AND pw.id <> w.id
      WHERE w.id = $1
      ORDER BY (pe.id = e.predecessor_engagement_id) DESC NULLS LAST, pe.financial_year DESC,
               pw.created_at DESC
      LIMIT 1`,
    [workflowInstanceId],
  );
  const r = rows[0];
  return r
    ? {
        workflowInstanceId: r.workflow_instance_id,
        engagementId: r.engagement_id,
        financialYear: r.financial_year,
      }
    : null;
}

import type {
  CaroCapturedFacts,
  ConsolidationCapturedFacts,
  FinancialReportingCapturedFacts,
  IcfrCapturedFacts,
  InvesteeInput,
  MasterFact,
  OtherReportingCapturedFacts,
  SoftwareSystemInput,
  SpecialEntityType,
} from '@hsdg/contracts';
import {
  groupStructure,
  type ClientDirector,
  type EngagementMasterFacts,
  type PriorSubAssessment,
  type RocFiling,
} from './master-facts';

/**
 * Capture-once facts for 02.4 CARO, 02.5 ICFR, 02.6 Consolidation and 02.7
 * other reporting (Guide §1): what the
 * client master already holds — group structure, listing, branches and the
 * audit year's figures — is filled in so the team confirms instead of typing.
 * Pure: the services read the master and store what this returns.
 *
 * Filling never overwrites the team's work: blank figures and an empty
 * investee list are filled, and a yes/no fact is only ever switched ON when the
 * master shows it. Facts the master cannot answer (peak borrowings, the parent's
 * CFS filing, members' no-objection, other auditors) stay with the team.
 */

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const PUBLIC_TYPES = ['public_limited'];

function financialSource(m: EngagementMasterFacts): string {
  return m.cyFinancials
    ? `Client master — FY ${m.cyFinancials.financialYear} financial profile`
    : 'Client master';
}

// ── 02.4 CARO ────────────────────────────────────────────────────────────────

export interface CaroMasterFill {
  /** Values the master answers (applied by {@link fillCaro}). */
  values: Partial<CaroCapturedFacts>;
  /** What the master says, with its source, for the team to see. */
  facts: MasterFact[];
}

export function caroFromMaster(m: EngagementMasterFacts): CaroMasterFill {
  const values: Partial<CaroCapturedFacts> = {};
  const facts: MasterFact[] = [];
  const E = 'Client master — group relationships';

  const g = groupStructure(m.relationships);
  const publicLinks = [...g.parents, ...g.investees.filter((i) => i.kind === 'subsidiary')].filter(
    (r) => r.counterpartyListed || PUBLIC_TYPES.includes(r.counterpartyTypeSlug ?? ''),
  );
  values.isHoldingOrSubsidiaryOfPublic = publicLinks.length > 0;
  facts.push({
    label: 'Holding / subsidiary of a public company',
    value: publicLinks.length
      ? `Yes — ${publicLinks.map((r) => r.counterparty).join(', ')}`
      : 'No public company in the group on record',
    source: E,
  });

  const cy = m.cyFinancials;
  const src = financialSource(m);
  if (cy?.netWorth != null) {
    values.capitalPlusReserves = cy.netWorth;
    facts.push({ label: 'Paid-up capital + reserves', value: inr(cy.netWorth), source: src });
  }
  const revenue = cy ? (cy.revenue ?? cy.turnover) : null;
  if (revenue != null) {
    const total = revenue + (cy?.otherIncome ?? 0);
    values.totalRevenue = total;
    facts.push({
      label: 'Total revenue (incl. other income)',
      value: inr(total),
      source: src,
    });
  }
  facts.push({
    label: 'Peak bank / FI borrowings in the year',
    value:
      cy?.totalBorrowings != null
        ? `Not on the master — year-end borrowings were ${inr(cy.totalBorrowings)}; enter the peak`
        : null,
    source: 'Team to confirm',
  });
  return { values, facts };
}

/** Apply a master fill to captured CARO facts. Returns the merged facts and what changed. */
export function fillCaro(
  current: CaroCapturedFacts,
  fill: CaroMasterFill,
): { next: CaroCapturedFacts; filled: string[] } {
  const next = { ...current };
  const filled: string[] = [];
  const v = fill.values;
  if (v.isHoldingOrSubsidiaryOfPublic && !next.isHoldingOrSubsidiaryOfPublic) {
    next.isHoldingOrSubsidiaryOfPublic = true;
    filled.push('public-company group link');
  }
  if (next.capitalPlusReserves == null && v.capitalPlusReserves != null) {
    next.capitalPlusReserves = v.capitalPlusReserves;
    filled.push('capital + reserves');
  }
  if (next.totalRevenue == null && v.totalRevenue != null) {
    next.totalRevenue = v.totalRevenue;
    filled.push('total revenue');
  }
  return { next, filled };
}

// ── 02.6 Consolidation ───────────────────────────────────────────────────────

export interface ConsolidationMasterFill {
  values: Partial<ConsolidationCapturedFacts>;
  facts: MasterFact[];
}

export function consolidationFromMaster(m: EngagementMasterFacts): ConsolidationMasterFill {
  const values: Partial<ConsolidationCapturedFacts> = {};
  const facts: MasterFact[] = [];
  const R = 'Client master — group relationships';
  const g = groupStructure(m.relationships);

  values.investees = g.investees.map((i): InvesteeInput => ({
    name: i.counterparty,
    ownershipPercent: i.shareholdingPct,
    // Recorded as a subsidiary on the master = control; associates and JVs
    // fall back to the ownership presumptions.
    hasControl: i.kind === 'subsidiary' ? true : null,
    isJointArrangement: i.kind === 'joint_venture',
    jointArrangementIsOperation: false,
    significantInfluenceRebutted: null,
    auditedByOtherAuditor: false,
  }));
  facts.push({
    label: 'Subsidiaries, associates and JVs',
    value: g.investees.length
      ? g.investees
          .map(
            (i) =>
              `${i.counterparty} (${i.kind.replace('_', ' ')}${
                i.shareholdingPct != null ? `, ${i.shareholdingPct}%` : ''
              })`,
          )
          .join('; ')
      : 'None on record',
    source: R,
  });

  const wholly = g.parents.some((p) => p.whollyOwned);
  values.isWhollyOwnedSubsidiary = wholly;
  values.isPartiallyOwnedSubsidiary = g.parents.length > 0 && !wholly;
  facts.push({
    label: 'Owned by a parent',
    value: g.parents.length
      ? `${wholly ? 'Wholly owned' : 'Partly owned'} — ${g.parents.map((p) => p.counterparty).join(', ')}`
      : 'No parent on record',
    source: R,
  });

  const listed = m.listings.length > 0 || (m.listingStatus ?? 'unlisted') !== 'unlisted';
  values.securitiesListedOrInProcess = listed;
  facts.push({
    label: 'Securities listed or being listed',
    value: listed ? m.listings.join('; ') || m.listingStatus.replace(/_/g, ' ') : 'Unlisted',
    source: 'Client master — listings',
  });

  values.hasBranches = m.branchCount > 0;
  facts.push({
    label: 'Branches',
    value: m.branchCount > 0 ? `${m.branchCount} branch address(es)` : 'None on record',
    source: 'Client master — addresses',
  });
  return { values, facts };
}

export function fillConsolidation(
  current: ConsolidationCapturedFacts,
  fill: ConsolidationMasterFill,
): { next: ConsolidationCapturedFacts; filled: string[] } {
  const next = { ...current };
  const filled: string[] = [];
  const v = fill.values;
  if (next.investees.length === 0 && v.investees?.length) {
    next.investees = v.investees;
    filled.push(`${v.investees.length} investee(s)`);
  }
  // A parent link can only be one of the two; never set both.
  if (!next.isWhollyOwnedSubsidiary && !next.isPartiallyOwnedSubsidiary) {
    if (v.isWhollyOwnedSubsidiary) {
      next.isWhollyOwnedSubsidiary = true;
      filled.push('wholly-owned subsidiary');
    } else if (v.isPartiallyOwnedSubsidiary) {
      next.isPartiallyOwnedSubsidiary = true;
      filled.push('partly-owned subsidiary');
    }
  }
  if (v.securitiesListedOrInProcess && !next.securitiesListedOrInProcess) {
    next.securitiesListedOrInProcess = true;
    filled.push('listing');
  }
  if (v.hasBranches && !next.hasBranches) {
    next.hasBranches = true;
    filled.push('branches');
  }
  return { next, filled };
}

// ── 02.5 ICFR ────────────────────────────────────────────────────────────────

export interface IcfrMasterFill {
  values: Partial<IcfrCapturedFacts>;
  facts: MasterFact[];
}

/** A filing that missed its deadline: done late, or still open past it. */
export function lateRocFilings(filings: readonly RocFiling[], today: string): RocFiling[] {
  return filings.filter((f) =>
    f.status === 'completed'
      ? f.completedOn != null && f.completedOn > f.deadline
      : f.status === 'open' && f.deadline < today,
  );
}

/**
 * ICFR facts from the portal: the §92/§137 filing default is read off the
 * AOC-4 / MGT-7 obligations on the compliance calendar. Peak covered
 * borrowings (banks, FIs and bodies corporate, at any point in the year) is
 * not held anywhere and stays with the team.
 */
export function icfrFromSources(
  m: EngagementMasterFacts,
  rocFilings: readonly RocFiling[],
  today: string,
): IcfrMasterFill {
  const facts: MasterFact[] = [];
  const values: Partial<IcfrCapturedFacts> = {};
  const due = rocFilings.filter((f) => f.deadline < today && f.status !== 'waived');
  const late = lateRocFilings(rocFilings, today);
  const C = 'Compliance calendar — AOC-4 / MGT-7';
  if (due.length === 0) {
    facts.push({ label: 'ROC filing record (§92 / §137)', value: null, source: C });
  } else {
    values.filingDefault = late.length > 0;
    facts.push({
      label: 'ROC filing record (§92 / §137)',
      value: late.length
        ? `Default — ${late
            .map(
              (f) =>
                `${f.form} due ${f.deadline} ${f.status === 'open' ? 'not filed' : `filed ${f.completedOn}`}`,
            )
            .join('; ')}`
        : `On time — ${due.length} filing(s) checked`,
      source: C,
    });
  }
  facts.push({
    label: 'Peak borrowings from banks, FIs and bodies corporate',
    value:
      m.cyFinancials?.totalBorrowings != null
        ? `Not on the master — year-end borrowings were ${inr(m.cyFinancials.totalBorrowings)}; enter the peak`
        : null,
    source: 'Team to confirm',
  });
  return { values, facts };
}

export function fillIcfr(
  current: IcfrCapturedFacts,
  fill: IcfrMasterFill,
): { next: IcfrCapturedFacts; filled: string[] } {
  const next = { ...current };
  const filled: string[] = [];
  if (fill.values.filingDefault && !next.filingDefault) {
    next.filingDefault = true;
    filled.push('ROC filing default');
  }
  return { next, filled };
}

// ── 02.7 Other reporting ─────────────────────────────────────────────────────

export interface OtherReportingMasterFill {
  values: Partial<OtherReportingCapturedFacts>;
  facts: MasterFact[];
}

const MD_WTD = /managing director|whole[- ]?time director|\b(md|wtd)\b/i;

/**
 * 02.7 facts from the portal: a managing / whole-time director from the
 * contacts master, and the accounting software (Rule 11(g)) carried from last
 * year's file — software rarely changes, but whether the audit trail ran all
 * year is this year's fact, so the team confirms it. Fraud, remuneration and
 * fund-routing facts are this year's audit findings and stay with the team.
 */
export function otherReportingFromSources(
  directors: readonly ClientDirector[],
  prior: { financialYear: string; facts: Record<string, unknown> } | null,
): OtherReportingMasterFill {
  const values: Partial<OtherReportingCapturedFacts> = {};
  const facts: MasterFact[] = [];

  const mds = directors.filter((d) => MD_WTD.test(d.designation ?? ''));
  const priorMd = prior?.facts.hasManagingOrWholeTimeDirector === true;
  values.hasManagingOrWholeTimeDirector = mds.length > 0 || priorMd;
  facts.push({
    label: 'Managing / whole-time director',
    value: mds.length
      ? mds.map((d) => `${d.fullName} (${d.designation})`).join('; ')
      : priorMd
        ? `Yes on the FY ${prior!.financialYear} file`
        : directors.length
          ? `None among ${directors.length} director(s) on record`
          : null,
    source: mds.length || !priorMd ? 'Client master — contacts' : 'Last year’s audit file',
  });

  const systems = Array.isArray(prior?.facts.softwareSystems)
    ? (prior!.facts.softwareSystems as SoftwareSystemInput[])
        .filter((x) => typeof x?.name === 'string' && x.name.trim())
        // The system and its edit-log feature carry over; whether the trail
        // ran all THIS year is unconfirmed until the team says so.
        .map((x) => ({
          name: x.name.trim(),
          hasAuditTrailFeature: x.hasAuditTrailFeature === true,
          auditTrailOperatedAllYear: false,
        }))
    : [];
  if (systems.length) values.softwareSystems = systems;
  facts.push({
    label: 'Accounting software (Rule 11(g))',
    value: systems.length
      ? `${systems.map((x) => x.name).join(', ')} — carried from FY ${prior!.financialYear}; confirm the audit trail ran all this year (unconfirmed until then)`
      : null,
    source: systems.length ? 'Last year’s audit file' : 'Team to confirm',
  });
  return { values, facts };
}

export function fillOtherReporting(
  current: OtherReportingCapturedFacts,
  fill: OtherReportingMasterFill,
): { next: OtherReportingCapturedFacts; filled: string[] } {
  const next = { ...current };
  const filled: string[] = [];
  const v = fill.values;
  if (v.hasManagingOrWholeTimeDirector && !next.hasManagingOrWholeTimeDirector) {
    next.hasManagingOrWholeTimeDirector = true;
    filled.push('managing / whole-time director');
  }
  if (next.softwareSystems.length === 0 && v.softwareSystems?.length) {
    next.softwareSystems = v.softwareSystems;
    filled.push(`${v.softwareSystems.length} accounting system(s)`);
  }
  return { next, filled };
}

// ── 02.1 Special entity types ────────────────────────────────────────────────

export interface SpecialTypesFill {
  types: SpecialEntityType[];
  /** Each type found, with the master record that shows it. */
  facts: MasterFact[];
}

const NBFC_TEXT = /\bnbfc\b|non[- ]?banking/i;
const NBFC_TEXT_ALL = /\bnbfc\b|non[- ]?banking/gi;

/**
 * The 02.1 special-entity matrix (Card B) from the client master: industries
 * on the business-activities master, the government-company flag, the
 * regulated-sector and special-status facts, and the name suffixes the law
 * mandates ("Nidhi Limited", "Producer Company"). Only positive evidence adds a
 * type; nothing is ever inferred from an absence.
 */
export function specialEntityTypesFromMaster(m: EngagementMasterFacts): SpecialTypesFill {
  const found = new Map<SpecialEntityType, string>();
  const add = (t: SpecialEntityType, why: string) => {
    if (!found.has(t)) found.set(t, why);
  };
  const isCompany = m.entityCategory === 'company';
  const industryName: Record<string, string> = {
    banking: 'Banking',
    nbfc: 'NBFC',
    insurance: 'Insurance',
  };

  for (const slug of m.industrySlugs ?? []) {
    if (slug === 'banking') add('bank', `Industry: ${industryName[slug]}`);
    if (slug === 'nbfc') add('nbfc', `Industry: ${industryName[slug]}`);
    if (slug === 'insurance') add('insurance', `Industry: ${industryName[slug]}`);
  }

  const reg = m.regulatory ?? { isGovernmentCompany: null, regulatedSector: [], specialStatus: [] };
  if (reg.isGovernmentCompany) add('government', 'Regulatory fact: Government company');

  const readText = (text: string, label: string) => {
    const why = `${label}: ${text}`;
    const t = text.toLowerCase();
    if (NBFC_TEXT.test(t)) add('nbfc', why);
    // "Non-Banking" is an NBFC, not a bank — test for a bank without it.
    const rest = t.replace(NBFC_TEXT_ALL, ' ');
    if (/\bbank(ing)?\b/.test(rest)) add('bank', why);
    if (/insur/.test(t)) add('insurance', why);
    if (/\bhfc\b|housing financ/.test(t)) add('hfc', why);
    if (/\bnidhi\b/.test(t)) add('nidhi', why);
    if (/producer compan/.test(t)) add('producer', why);
    if (/\bdormant\b/.test(t)) add('dormant', why);
    if (/government (company|undertaking)|\bpsu\b|\bcpse\b/.test(t)) add('government', why);
    if (isCompany && /section\s*8\b|\bsec\.?\s*8\b|not[- ]for[- ]profit|charitable/.test(t))
      add('section_8', why);
  };

  for (const text of reg.regulatedSector) {
    const before = found.size;
    readText(text, 'Regulated sector');
    // A regulated sector the matrix has no box for is "other regulator".
    if (found.size === before && /sebi|rbi|irdai|pfrda|ifsca|regulat|other/i.test(text))
      add('other_regulator', `Regulated sector: ${text}`);
  }
  for (const text of reg.specialStatus) readText(text, 'Special regulatory status');

  if (isCompany && /\bnidhi limited\b/i.test(m.legalName)) add('nidhi', `Name: ${m.legalName}`);
  if (isCompany && /\bproducer company\b/i.test(m.legalName))
    add('producer', `Name: ${m.legalName}`);

  const types = [...found.keys()];
  return {
    types,
    facts: [
      {
        label: 'Special entity type(s)',
        value: types.length
          ? types.map((t) => `${SPECIAL_LABEL[t]} (${found.get(t)})`).join('; ')
          : 'None shown on the client master',
        source: 'Client master — industries & regulatory facts',
      },
    ],
  };
}

const SPECIAL_LABEL: Record<SpecialEntityType, string> = {
  bank: 'Banking company',
  insurance: 'Insurance company',
  nbfc: 'NBFC',
  hfc: 'Housing finance company',
  section_8: 'Section 8 company',
  government: 'Government company',
  nidhi: 'Nidhi company',
  producer: 'Producer company',
  dormant: 'Dormant company',
  other_regulator: 'Other regulator',
};

/** Add the master's types to the profile's; never removes one the team set. */
export function fillSpecialTypes(
  current: readonly SpecialEntityType[],
  fill: SpecialTypesFill,
): { next: SpecialEntityType[]; filled: string[] } {
  const added = fill.types.filter((t) => !current.includes(t));
  return { next: [...current, ...added], filled: added.map((t) => SPECIAL_LABEL[t]) };
}

// ── 02.2 Financial reporting framework ───────────────────────────────────────

export interface FinancialReportingMasterFill {
  values: Partial<FinancialReportingCapturedFacts>;
  facts: MasterFact[];
}

const GROUP_KIND_LABEL: Record<string, string> = {
  subsidiary: 'subsidiary',
  associate: 'associate',
  joint_venture: 'joint venture',
};

/**
 * 02.2 facts from the portal:
 *   • SME-exchange listing — every live listing is on an SME platform;
 *   • prior Ind AS — last year's file concluded Ind AS (or carried it), and
 *     Ind AS once applied is irrevocable;
 *   • group trigger (Rule 4) — a holding, subsidiary, associate or JV is
 *     listed on a main board or concluded Ind AS on its own audit file.
 * Voluntary adoption is this year's choice and stays with the team.
 */
export function financialReportingFromSources(
  m: EngagementMasterFacts,
  prior: PriorSubAssessment | null,
): FinancialReportingMasterFill {
  const values: Partial<FinancialReportingCapturedFacts> = {};
  const facts: MasterFact[] = [];

  const exchanges = m.listingExchanges ?? [];
  if (exchanges.length) {
    values.isListedOnSmeExchange = exchanges.every((x) => x === 'sme');
    facts.push({
      label: 'Listing',
      value: values.isListedOnSmeExchange
        ? `SME platform only — ${m.listings.join('; ')}`
        : `Main board — ${m.listings.join('; ')}`,
      source: 'Client master — listings',
    });
  }

  const priorIndAs =
    prior != null &&
    (prior.conclusion === 'ind_as' ||
      prior.facts?.priorIndAs === true ||
      prior.facts?.voluntaryIndAs === true);
  values.priorIndAs = priorIndAs;
  facts.push({
    label: 'Ind AS in a prior year',
    value: prior
      ? priorIndAs
        ? `Yes — FY ${prior.financialYear} file ${prior.conclusion === 'ind_as' ? 'concluded Ind AS' : 'records Ind AS'}`
        : `No — FY ${prior.financialYear} file ${prior.conclusion ? `concluded ${prior.conclusion.replace(/_/g, ' ')}` : 'not concluded'}`
      : null,
    source: prior ? 'Last year’s audit file' : 'No earlier audit file on the portal',
  });

  const g = groupStructure(m.relationships);
  const triggers = [
    ...g.parents.map((p) => ({ r: p, as: 'holding company' })),
    ...g.investees.map((i) => ({ r: i, as: GROUP_KIND_LABEL[i.kind] ?? 'group company' })),
  ].filter((x) => x.r.counterpartyIndAs != null);
  values.groupTriggersIndAs = triggers.length > 0;
  facts.push({
    label: 'Group company applying Ind AS',
    value: triggers.length
      ? triggers
          .map(
            (x) =>
              `${x.r.counterparty} (${x.as}; ${x.r.counterpartyIndAs === 'listed' ? 'listed on NSE/BSE' : 'Ind AS on its audit file'})`,
          )
          .join('; ')
      : g.parents.length + g.investees.length
        ? 'None of the group companies on record applies Ind AS'
        : 'No group companies on record',
    source: 'Client master — group relationships',
  });
  return { values, facts };
}

export function fillFinancialReporting(
  current: FinancialReportingCapturedFacts,
  fill: FinancialReportingMasterFill,
): { next: FinancialReportingCapturedFacts; filled: string[] } {
  const next = { ...current };
  const filled: string[] = [];
  const v = fill.values;
  if (v.isListedOnSmeExchange && !next.isListedOnSmeExchange) {
    next.isListedOnSmeExchange = true;
    filled.push('SME-exchange listing');
  }
  if (v.priorIndAs && !next.priorIndAs) {
    next.priorIndAs = true;
    filled.push('Ind AS in a prior year');
  }
  if (v.groupTriggersIndAs && !next.groupTriggersIndAs) {
    next.groupTriggersIndAs = true;
    filled.push('group company applying Ind AS');
  }
  return { next, filled };
}

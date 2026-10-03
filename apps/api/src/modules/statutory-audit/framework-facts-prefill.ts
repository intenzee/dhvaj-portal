import type {
  CaroCapturedFacts,
  ConsolidationCapturedFacts,
  IcfrCapturedFacts,
  InvesteeInput,
  MasterFact,
  OtherReportingCapturedFacts,
  SoftwareSystemInput,
} from '@hsdg/contracts';
import {
  groupStructure,
  type ClientDirector,
  type EngagementMasterFacts,
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

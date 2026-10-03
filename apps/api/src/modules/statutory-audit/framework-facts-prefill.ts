import type {
  CaroCapturedFacts,
  ConsolidationCapturedFacts,
  InvesteeInput,
  MasterFact,
} from '@hsdg/contracts';
import { groupStructure, type EngagementMasterFacts } from './master-facts';

/**
 * Capture-once facts for 02.4 CARO and 02.6 Consolidation (Guide §1): what the
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

import type { CaroCapturedFacts, ConsolidationCapturedFacts } from '@hsdg/contracts';
import {
  caroFromMaster,
  consolidationFromMaster,
  fillCaro,
  fillConsolidation,
} from './framework-facts-prefill';
import type {
  EngagementMasterFacts,
  MasterFinancialProfile,
  MasterRelationship,
} from './master-facts';

const rel = (p: Partial<MasterRelationship>): MasterRelationship => ({
  type: 'holding',
  counterparty: 'Other Ltd',
  outbound: false,
  shareholdingPct: null,
  counterpartyTypeSlug: 'private_limited',
  counterpartyListed: false,
  ...p,
});

const fin = (p: Partial<MasterFinancialProfile> = {}): MasterFinancialProfile => ({
  financialYear: '2024-25',
  revenue: 80_000_000,
  turnover: null,
  otherIncome: 2_000_000,
  profitBeforeTax: null,
  netProfit: null,
  netWorth: 30_000_000,
  paidUpCapital: 10_000_000,
  totalAssets: null,
  totalBorrowings: 5_000_000,
  source: 'provisional_financials',
  verified: false,
  documentRef: null,
  ...p,
});

const master = (p: Partial<EngagementMasterFacts> = {}): EngagementMasterFacts =>
  ({
    financialYear: '2024-25',
    listingStatus: 'unlisted',
    listings: [],
    branchCount: 0,
    relationships: [],
    cyFinancials: fin(),
    pyFinancials: null,
    ...p,
  }) as EngagementMasterFacts;

const CARO_BLANK: CaroCapturedFacts = {
  isHoldingOrSubsidiaryOfPublic: false,
  capitalPlusReserves: null,
  peakBankFiBorrowings: null,
  totalRevenue: null,
};

const CFS_BLANK: ConsolidationCapturedFacts = {
  investees: [],
  isWhollyOwnedSubsidiary: false,
  isPartiallyOwnedSubsidiary: false,
  otherMembersIntimatedNoObjection: false,
  securitiesListedOrInProcess: false,
  parentFilesCompliantCfs: null,
  hasBranches: false,
};

describe('02.4 CARO from the client master', () => {
  it('fills capital + reserves and total revenue (incl. other income), never peak borrowings', () => {
    const { next, filled } = fillCaro(CARO_BLANK, caroFromMaster(master()));
    expect(next.capitalPlusReserves).toBe(30_000_000);
    expect(next.totalRevenue).toBe(82_000_000);
    expect(next.peakBankFiBorrowings).toBeNull();
    expect(next.isHoldingOrSubsidiaryOfPublic).toBe(false);
    expect(filled).toEqual(['capital + reserves', 'total revenue']);
  });

  it('flags a public or listed parent / subsidiary, not an associate', () => {
    const pub = caroFromMaster(
      master({
        relationships: [
          rel({
            type: 'subsidiary',
            counterparty: 'Big Public Ltd',
            outbound: true,
            counterpartyTypeSlug: 'public_limited',
          }),
        ],
      }),
    );
    expect(pub.values.isHoldingOrSubsidiaryOfPublic).toBe(true);
    const listedSub = caroFromMaster(
      master({
        relationships: [rel({ type: 'subsidiary', counterparty: 'Sub', counterpartyListed: true })],
      }),
    );
    expect(listedSub.values.isHoldingOrSubsidiaryOfPublic).toBe(true);
    const associate = caroFromMaster(
      master({
        relationships: [rel({ type: 'associate', counterpartyTypeSlug: 'public_limited' })],
      }),
    );
    expect(associate.values.isHoldingOrSubsidiaryOfPublic).toBe(false);
  });

  it('never overwrites what the team entered', () => {
    const team = { ...CARO_BLANK, capitalPlusReserves: 1, totalRevenue: 2 };
    const { next, filled } = fillCaro(team, caroFromMaster(master()));
    expect(next).toEqual(team);
    expect(filled).toEqual([]);
  });

  it('leaves figures blank when the master has no financial profile', () => {
    const { next } = fillCaro(CARO_BLANK, caroFromMaster(master({ cyFinancials: null })));
    expect(next.capitalPlusReserves).toBeNull();
    expect(next.totalRevenue).toBeNull();
  });
});

describe('02.6 consolidation from the client master', () => {
  it('builds the investee perimeter with ownership and kind', () => {
    const fill = consolidationFromMaster(
      master({
        relationships: [
          rel({ type: 'wholly_owned_subsidiary', counterparty: 'Sub A', shareholdingPct: 100 }),
          rel({ type: 'associate', counterparty: 'Assoc B', shareholdingPct: 30 }),
          rel({ type: 'joint_venture', counterparty: 'JV C', shareholdingPct: 50 }),
        ],
      }),
    );
    const { next } = fillConsolidation(CFS_BLANK, fill);
    expect(
      next.investees.map((i) => [i.name, i.ownershipPercent, i.hasControl, i.isJointArrangement]),
    ).toEqual([
      ['Sub A', 100, true, false],
      ['Assoc B', 30, null, false],
      ['JV C', 50, null, true],
    ]);
  });

  it('reads parent ownership, listing and branches', () => {
    const { next, filled } = fillConsolidation(
      CFS_BLANK,
      consolidationFromMaster(
        master({
          relationships: [
            rel({
              type: 'subsidiary',
              counterparty: 'Parent',
              outbound: true,
              shareholdingPct: 70,
            }),
          ],
          listings: ['BSE · equity · ACME'],
          branchCount: 2,
        }),
      ),
    );
    expect(next.isWhollyOwnedSubsidiary).toBe(false);
    expect(next.isPartiallyOwnedSubsidiary).toBe(true);
    expect(next.securitiesListedOrInProcess).toBe(true);
    expect(next.hasBranches).toBe(true);
    expect(next.parentFilesCompliantCfs).toBeNull(); // the master can't answer this
    expect(filled).toEqual(['partly-owned subsidiary', 'listing', 'branches']);
  });

  it('keeps a perimeter the team already entered', () => {
    const own: ConsolidationCapturedFacts = {
      ...CFS_BLANK,
      investees: [
        {
          name: 'Mine',
          ownershipPercent: 60,
          hasControl: true,
          isJointArrangement: false,
          jointArrangementIsOperation: false,
          significantInfluenceRebutted: null,
          auditedByOtherAuditor: true,
        },
      ],
    };
    const { next } = fillConsolidation(
      own,
      consolidationFromMaster(
        master({ relationships: [rel({ type: 'subsidiary', counterparty: 'Sub A' })] }),
      ),
    );
    expect(next.investees.map((i) => i.name)).toEqual(['Mine']);
  });
});

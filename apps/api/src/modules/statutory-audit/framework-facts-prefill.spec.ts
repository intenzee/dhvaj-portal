import type {
  CaroCapturedFacts,
  ConsolidationCapturedFacts,
  IcfrCapturedFacts,
  OtherReportingCapturedFacts,
} from '@hsdg/contracts';
import {
  caroFromMaster,
  consolidationFromMaster,
  fillCaro,
  fillConsolidation,
  fillIcfr,
  fillOtherReporting,
  fillSpecialTypes,
  icfrFromSources,
  lateRocFilings,
  otherReportingFromSources,
  specialEntityTypesFromMaster,
} from './framework-facts-prefill';
import type {
  EngagementMasterFacts,
  MasterFinancialProfile,
  MasterRelationship,
  RocFiling,
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

describe('02.5 ICFR from the compliance calendar', () => {
  const TODAY = '2026-10-03';
  const BLANK: IcfrCapturedFacts = { peakCoveredBorrowings: null, filingDefault: false };
  const filing = (p: Partial<RocFiling>): RocFiling => ({
    form: 'AOC-4',
    deadline: '2025-10-30',
    status: 'completed',
    completedOn: '2025-10-20',
    ...p,
  });

  it('finds late and overdue filings, ignoring waived and not-yet-due ones', () => {
    const late = lateRocFilings(
      [
        filing({}),
        filing({ form: 'MGT-7', deadline: '2025-11-29', completedOn: '2025-12-10' }),
        filing({ deadline: '2026-09-30', status: 'open', completedOn: null }),
        filing({ deadline: '2026-11-30', status: 'open', completedOn: null }),
        filing({ deadline: '2024-10-30', status: 'waived', completedOn: null }),
      ],
      TODAY,
    );
    expect(late.map((f) => [f.form, f.deadline])).toEqual([
      ['MGT-7', '2025-11-29'],
      ['AOC-4', '2026-09-30'],
    ]);
  });

  it('switches the filing default on when the record shows one', () => {
    const fill = icfrFromSources(
      master(),
      [filing({ status: 'open', completedOn: null, deadline: '2026-09-30' })],
      TODAY,
    );
    const { next, filled } = fillIcfr(BLANK, fill);
    expect(next.filingDefault).toBe(true);
    expect(next.peakCoveredBorrowings).toBeNull();
    expect(filled).toEqual(['ROC filing default']);
  });

  it('records on-time filings as no default and leaves an unknown record alone', () => {
    expect(icfrFromSources(master(), [filing({})], TODAY).values.filingDefault).toBe(false);
    const none = icfrFromSources(master(), [], TODAY);
    expect(none.values.filingDefault).toBeUndefined();
    expect(none.facts[0]!.value).toBeNull();
  });
});

describe('02.7 other reporting from contacts and last year', () => {
  const BLANK: OtherReportingCapturedFacts = {
    softwareSystems: [],
    managerialRemunerationPaid: null,
    section198NetProfit: null,
    hasManagingOrWholeTimeDirector: false,
    fraudIdentified: false,
    fraudAmount: null,
    fraudEventDate: null,
    intermediaryFundsAdvanced: false,
    ultimateBeneficiaryFundsReceived: false,
    fundingRepresentationsObtained: false,
    dividendCompliesSec123: null,
    pendingLitigationDisclosed: null,
    foreseeableLossesProvided: null,
    iepfTransferDelay: null,
  };

  it('finds a managing or whole-time director among the contacts', () => {
    const fill = otherReportingFromSources(
      [
        { fullName: 'Asha Rao', designation: 'Director' },
        { fullName: 'Vikram Shah', designation: 'Whole-time Director' },
      ],
      null,
    );
    expect(fill.values.hasManagingOrWholeTimeDirector).toBe(true);
    expect(
      otherReportingFromSources([{ fullName: 'A', designation: 'Independent Director' }], null)
        .values.hasManagingOrWholeTimeDirector,
    ).toBe(false);
  });

  it('carries the accounting software from last year, with this year unconfirmed', () => {
    const fill = otherReportingFromSources([], {
      financialYear: '2023-24',
      facts: {
        hasManagingOrWholeTimeDirector: true,
        softwareSystems: [
          { name: 'Tally Prime', hasAuditTrailFeature: true, auditTrailOperatedAllYear: true },
          { name: '  ', hasAuditTrailFeature: true, auditTrailOperatedAllYear: true },
        ],
      },
    });
    const { next, filled } = fillOtherReporting(BLANK, fill);
    expect(next.softwareSystems).toEqual([
      { name: 'Tally Prime', hasAuditTrailFeature: true, auditTrailOperatedAllYear: false },
    ]);
    expect(next.hasManagingOrWholeTimeDirector).toBe(true);
    // Audit findings are never filled.
    expect(next.fraudIdentified).toBe(false);
    expect(next.managerialRemunerationPaid).toBeNull();
    expect(filled).toEqual(['managing / whole-time director', '1 accounting system(s)']);
  });

  it('never replaces software the team already listed', () => {
    const own = {
      ...BLANK,
      softwareSystems: [
        { name: 'SAP', hasAuditTrailFeature: true, auditTrailOperatedAllYear: true },
      ],
    };
    const { next } = fillOtherReporting(
      own,
      otherReportingFromSources([], {
        financialYear: '2023-24',
        facts: { softwareSystems: [{ name: 'Tally', hasAuditTrailFeature: true }] },
      }),
    );
    expect(next.softwareSystems.map((x) => x.name)).toEqual(['SAP']);
  });
});

describe('02.1 special entity types from the client master', () => {
  const company = (p: Partial<EngagementMasterFacts> = {}) =>
    master({
      legalName: 'Acme Private Limited',
      entityCategory: 'company',
      industrySlugs: [],
      regulatory: { isGovernmentCompany: null, regulatedSector: [], specialStatus: [] },
      ...p,
    });
  const types = (m: EngagementMasterFacts) => specialEntityTypesFromMaster(m).types;

  it('reads banking / NBFC / insurance from the industries master', () => {
    expect(types(company({ industrySlugs: ['nbfc', 'trading'] }))).toEqual(['nbfc']);
    expect(types(company({ industrySlugs: ['banking', 'insurance'] }))).toEqual([
      'bank',
      'insurance',
    ]);
  });

  it('reads "Non-Banking Financial Company" as an NBFC, never a bank', () => {
    const t = types(
      company({
        regulatory: {
          isGovernmentCompany: null,
          regulatedSector: ['Non-Banking Financial Company (RBI)'],
          specialStatus: [],
        },
      }),
    );
    expect(t).toEqual(['nbfc']);
  });

  it('reads the government flag and the special-status text', () => {
    const t = types(
      company({
        regulatory: {
          isGovernmentCompany: true,
          regulatedSector: ['Housing Finance (HFC)'],
          specialStatus: ['Section 8 company', 'Dormant u/s 455'],
        },
      }),
    );
    expect(t).toEqual(['government', 'hfc', 'section_8', 'dormant']);
  });

  it('reads the mandated "Nidhi Limited" / "Producer Company" name suffixes', () => {
    expect(types(company({ legalName: 'Shree Ganesh Nidhi Limited' }))).toEqual(['nidhi']);
    expect(types(company({ legalName: 'Kisan Farmers Producer Company Limited' }))).toEqual([
      'producer',
    ]);
  });

  it('files an unrecognised regulated sector under "other regulator"', () => {
    const t = types(
      company({
        regulatory: {
          isGovernmentCompany: null,
          regulatedSector: ['SEBI-registered intermediary'],
          specialStatus: [],
        },
      }),
    );
    expect(t).toEqual(['other_regulator']);
  });

  it('infers nothing without positive evidence, and no Section 8 for a non-company', () => {
    expect(types(company())).toEqual([]);
    expect(
      types(
        company({
          entityCategory: 'trust',
          regulatory: {
            isGovernmentCompany: null,
            regulatedSector: [],
            specialStatus: ['Charitable trust'],
          },
        }),
      ),
    ).toEqual([]);
  });

  it("adds to the team's list and never removes from it", () => {
    const { next, filled } = fillSpecialTypes(
      ['dormant'],
      specialEntityTypesFromMaster(company({ industrySlugs: ['nbfc'] })),
    );
    expect(next).toEqual(['dormant', 'nbfc']);
    expect(filled).toEqual(['NBFC']);
  });
});

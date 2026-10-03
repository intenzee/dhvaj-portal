import {
  activitiesFromFlags,
  engagementProfileFacts,
  groupStructure,
  industryProfileFromFacts,
  periodEndFromFinancialYear,
  planUnderstandingPrefill,
  previousFinancialYear,
  regulatoryProfileFacts,
  type EngagementMasterFacts,
  type MasterFinancialProfile,
  type MasterRelationship,
  type UnderstandingState,
} from './master-facts';

const NO_FLAGS = {
  manufacturing: false,
  trading: false,
  services: false,
  import: false,
  export: false,
  ecommerce: false,
  regulated: false,
};

function fin(partial: Partial<MasterFinancialProfile> = {}): MasterFinancialProfile {
  return {
    financialYear: '2024-25',
    revenue: 150_000_000,
    turnover: null,
    otherIncome: 2_000_000,
    profitBeforeTax: 16_000_000,
    netProfit: 12_000_000,
    netWorth: 90_000_000,
    paidUpCapital: 50_000_000,
    totalAssets: 210_000_000,
    totalBorrowings: null,
    source: 'provisional_financials',
    verified: false,
    documentRef: null,
    ...partial,
  };
}

function rel(partial: Partial<MasterRelationship>): MasterRelationship {
  return {
    type: 'holding',
    counterparty: 'Other Ltd',
    outbound: false,
    shareholdingPct: null,
    counterpartyTypeSlug: 'private_limited',
    counterpartyListed: false,
    counterpartyIndAs: null,
    ...partial,
  };
}

function master(partial: Partial<EngagementMasterFacts> = {}): EngagementMasterFacts {
  return {
    engagementCode: 'ENG00001',
    financialYear: '2024-25',
    periodLabel: 'FY',
    currency: 'INR',
    plannedStartDate: null,
    plannedEndDate: '2025-09-30',
    mandateLetterReference: null,
    mandateLetterDate: null,
    partnerName: 'Partner A',
    managerName: null,
    officeName: 'North Office',
    predecessorEngagementCode: null,
    legalName: 'Acme Manufacturing Pvt Ltd',
    entityTypeName: 'Private Limited Company',
    entityTypeSlug: 'private_limited',
    entityCategory: 'company',
    pan: 'AAACA1234A',
    corporateId: { type: 'cin', number: 'U17110MH2015PTC123456' },
    incorporationDate: '2015-04-10',
    roc: null,
    registeredOffice: 'Plot 12, Mumbai, Maharashtra 400093',
    locations: ['Chakan, Pune'],
    branchCount: 0,
    listingStatus: 'unlisted',
    listings: [],
    listingExchanges: [],
    paidUpCapital: null,
    annualTurnover: 150_000_000,
    businessDescription: 'Auto components',
    activityFlags: { ...NO_FLAGS, manufacturing: true, export: true },
    primaryIndustry: null,
    industrySlugs: [],
    regulatory: { isGovernmentCompany: null, regulatedSector: [], specialStatus: [] },
    groupName: null,
    relationships: [],
    cyFinancials: fin(),
    pyFinancials: fin({ financialYear: '2023-24', source: 'audited_financials', verified: true }),
    ...partial,
  };
}

function state(partial: Partial<UnderstandingState> = {}): UnderstandingState {
  return {
    header: {
      exists: false,
      periodEnd: null,
      pyPeriodEnd: null,
      currency: null,
      units: null,
      pyUnits: null,
      cySource: null,
      pySource: null,
      dataStatus: null,
    },
    recordedValues: new Set(),
    savedSections: new Set(),
    industryProfile: 'generic',
    specialEntityTypes: [],
    ...partial,
  };
}

describe('financial-year helpers', () => {
  it('derives the 31 March period end and the previous year', () => {
    expect(periodEndFromFinancialYear('2024-25')).toBe('2025-03-31');
    expect(previousFinancialYear('2024-25')).toBe('2023-24');
    expect(previousFinancialYear('2000-01')).toBe('1999-00');
  });

  it('returns null for a label it cannot read rather than guessing', () => {
    expect(periodEndFromFinancialYear('FY25')).toBeNull();
    expect(previousFinancialYear('2024')).toBeNull();
  });
});

describe('activity / industry mapping', () => {
  it('maps master flags to BU-01 options', () => {
    expect(activitiesFromFlags({ ...NO_FLAGS, manufacturing: true, ecommerce: true })).toEqual([
      'Manufacturing',
      'Trading / distribution',
    ]);
  });

  it('only picks a specific analytics profile when the activity is unambiguous', () => {
    const one = master({ activityFlags: { ...NO_FLAGS, services: true } });
    const mixed = master({ activityFlags: { ...NO_FLAGS, services: true, trading: true } });
    expect(industryProfileFromFacts(one)).toBe('services');
    expect(industryProfileFromFacts(mixed)).toBeNull();
    expect(industryProfileFromFacts(mixed, ['nbfc'])).toBe('nbfc');
  });
});

describe('planUnderstandingPrefill', () => {
  it('seeds a blank 03.2 from the masters with sources', () => {
    const plan = planUnderstandingPrefill(master(), state());
    expect(plan.header).toMatchObject({
      period_end: '2025-03-31',
      py_period_end: '2024-03-31',
      currency: 'INR',
      units: 'inr',
      data_status: 'draft',
    });
    expect(plan.header.cy_source).toContain('FY 2024-25 provisional financials');
    const revenueCy = plan.values.find((v) => v.metricKey === 'revenue' && v.period === 'cy');
    const revenuePy = plan.values.find((v) => v.metricKey === 'revenue' && v.period === 'py');
    expect(revenueCy).toMatchObject({ amount: 150_000_000, sourceType: 'draft_fs' });
    expect(revenuePy).toMatchObject({ sourceType: 'audited_py_fs' });
    // A figure the master does not hold is not invented.
    expect(plan.values.some((v) => v.metricKey === 'total_borrowings')).toBe(false);
    expect(plan.sections.find((s) => s.key === 'business_model')?.answers).toEqual({
      activities: ['Manufacturing'],
      activities_note: 'Auto components',
      customer_types: ['Export'],
      locations: 'Chakan, Pune',
    });
    expect(plan.industryProfile).toBe('manufacturing');
  });

  it('never overwrites what the team has recorded', () => {
    const plan = planUnderstandingPrefill(
      master(),
      state({
        header: {
          exists: true,
          periodEnd: '2025-03-31',
          pyPeriodEnd: null,
          currency: 'INR',
          units: 'inr_lakh',
          pyUnits: null,
          cySource: 'Draft FS v2',
          pySource: null,
          dataStatus: 'final',
        },
        recordedValues: new Set(['revenue:cy']),
        savedSections: new Set(['business_model']),
        industryProfile: 'trading',
      }),
    );
    expect(plan.header).toEqual({
      py_period_end: '2024-03-31',
      py_source: expect.stringContaining('FY 2023-24 audited financials'),
    });
    expect(plan.values.some((v) => v.metricKey === 'revenue' && v.period === 'cy')).toBe(false);
    expect(plan.sections).toEqual([]);
    expect(plan.industryProfile).toBeNull();
  });

  it('converts master rupees into the units the team chose', () => {
    const plan = planUnderstandingPrefill(
      master(),
      state({ header: { ...state().header, exists: true, units: 'inr_lakh' } }),
    );
    expect(plan.values.find((v) => v.metricKey === 'pbt' && v.period === 'cy')?.amount).toBe(160);
  });

  it('skips figures when the header units cannot be converted', () => {
    const plan = planUnderstandingPrefill(
      master(),
      state({ header: { ...state().header, exists: true, units: 'other' } }),
    );
    expect(plan.values).toEqual([]);
  });

  it('leaves figures and data status blank when the master has no financial profile', () => {
    const plan = planUnderstandingPrefill(
      master({ cyFinancials: null, pyFinancials: null }),
      state(),
    );
    expect(plan.values).toEqual([]);
    expect(plan.header).toEqual({
      period_end: '2025-03-31',
      py_period_end: '2024-03-31',
      currency: 'INR',
    });
  });

  it('lists holding companies as promoters / controlling parties', () => {
    const plan = planUnderstandingPrefill(
      master({
        relationships: [
          // "Parent Ltd IS holding OF this entity" (inbound).
          rel({
            type: 'holding',
            counterparty: 'Parent Ltd',
            outbound: false,
            shareholdingPct: 74,
          }),
          // "Child Pvt Ltd IS subsidiary OF this entity" (inbound) — an investee, not a promoter.
          rel({
            type: 'subsidiary',
            counterparty: 'Child Pvt Ltd',
            outbound: false,
            shareholdingPct: 100,
          }),
        ],
      }),
      state(),
    );
    expect(plan.sections.find((s) => s.key === 'governance')?.answers.promoters).toEqual([
      ['Parent Ltd', 'Holding company — 74%', 'Client master'],
    ]);
  });
});

describe('fact cards', () => {
  it('shows the 01.1 engagement profile with sources and blanks marked', () => {
    const facts = engagementProfileFacts(master(), { initialAudit: false });
    expect(facts.find((f) => f.label === 'CIN')?.value).toBe('U17110MH2015PTC123456');
    expect(facts.find((f) => f.label === 'Audit period')?.value).toBe('2024-04-01 to 2025-03-31');
    expect(facts.find((f) => f.label === 'First year / continuing audit')?.value).toBe(
      'Continuing audit',
    );
    expect(facts.find((f) => f.label === 'Engagement manager')).toEqual({
      label: 'Engagement manager',
      value: null,
      source: 'Engagement',
    });
  });

  it('prefers a figure captured on 02.1, then the FY profile, then the entity', () => {
    const facts = regulatoryProfileFacts(
      master({ cyFinancials: fin({ paidUpCapital: null }), paidUpCapital: 10_000_000 }),
      new Map([['net_worth', 1_000]]),
    );
    expect(facts.find((f) => f.label === 'Net worth')).toMatchObject({ source: '02.1 (captured)' });
    expect(facts.find((f) => f.label === 'Paid-up capital')).toMatchObject({
      source: 'Entity master',
    });
    expect(facts.find((f) => f.label === 'Total assets')?.source).toBe(
      'Financial profile FY 2024-25',
    );
  });
});

describe('groupStructure — "from IS <type> OF to"', () => {
  it('reads parents and investees from both directions', () => {
    const g = groupStructure([
      rel({ type: 'subsidiary', counterparty: 'Parent A', outbound: true, shareholdingPct: 60 }),
      rel({ type: 'holding', counterparty: 'Parent B', outbound: false }),
      rel({ type: 'wholly_owned_subsidiary', counterparty: 'Sub C', outbound: false }),
      rel({ type: 'holding', counterparty: 'Sub D', outbound: true, shareholdingPct: 80 }),
      rel({ type: 'associate', counterparty: 'Assoc E', outbound: false, shareholdingPct: 30 }),
      rel({ type: 'joint_venture', counterparty: 'JV F', outbound: false }),
      rel({ type: 'associate', counterparty: 'Investor G', outbound: true }),
      rel({ type: 'fellow_subsidiary', counterparty: 'Fellow H', outbound: true }),
    ]);
    expect(g.parents.map((p) => [p.counterparty, p.whollyOwned])).toEqual([
      ['Parent A', false],
      ['Parent B', false],
    ]);
    expect(g.investees.map((i) => [i.counterparty, i.kind])).toEqual([
      ['Sub C', 'subsidiary'],
      ['Sub D', 'subsidiary'],
      ['Assoc E', 'associate'],
      ['JV F', 'joint_venture'],
    ]);
  });

  it('treats a 100% or wholly-owned link to a parent as wholly owned', () => {
    const g = groupStructure([
      rel({ type: 'wholly_owned_subsidiary', counterparty: 'P1', outbound: true }),
      rel({ type: 'holding', counterparty: 'P2', outbound: false, shareholdingPct: 100 }),
    ]);
    expect(g.parents.every((p) => p.whollyOwned)).toBe(true);
  });
});

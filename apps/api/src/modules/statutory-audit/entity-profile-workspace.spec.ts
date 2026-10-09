import {
  COMPLETENESS_STATUS,
  PROFILE_CARD_STATUS,
  PROFILE_FINANCIAL_LABEL,
  REQUIRED_PROFILE_FINANCIALS,
  SUB_SECTION_KEY,
  type ProfileFinancialRow,
  type ProfileFinancialParameter,
} from '@hsdg/contracts';
import {
  MISSING_SMALL_COMPANY,
  auditPeriodOf,
  cardConfirmBlockers,
  cardFingerprint,
  changedTrackedFacts,
  companyTypeOf,
  downstreamSectionsFor,
  evaluateCompleteness,
  finalSmallCompanyOutcome,
  groupEntitiesOf,
  groupFlagsOf,
  priorYearChanges,
  trackedFacts,
  usesServiceOrganisation,
  withCardConfirmations,
  type StoredCardConfirmations,
  type WorkspaceFacts,
} from './entity-profile-workspace';
import { deriveSaTriggers } from './entity-profile';
import type { MasterRelationship } from './master-facts';

const rel = (over: Partial<MasterRelationship>): MasterRelationship => ({
  type: 'subsidiary',
  counterparty: 'X Ltd',
  outbound: false,
  shareholdingPct: null,
  counterpartyTypeSlug: null,
  counterpartyListed: false,
  counterpartyIndAs: null,
  ...over,
});

const row = (p: ProfileFinancialParameter, value: number | null): ProfileFinancialRow => ({
  parameter: p,
  label: PROFILE_FINANCIAL_LABEL[p],
  current: { value, origin: value == null ? null : 'master', sourceLabel: null, asOf: null },
  prior: { value: null, origin: null, sourceLabel: null, asOf: null },
  captured: null,
  conflict: null,
  required: REQUIRED_PROFILE_FINANCIALS.includes(p),
});

/** A fully-answered private company — every card can be confirmed. */
function facts(over: Partial<WorkspaceFacts> = {}): WorkspaceFacts {
  return {
    isCompany: true,
    entityCategory: 'company',
    companyType: 'private',
    listing: {
      masterListed: false,
      masterInProcess: false,
      answer: 'no',
      inProcess: 'no',
      lines: [],
    },
    specialEntityTypes: [],
    masterOwnedSpecialTypes: [],
    nbfcCategory: null,
    regulator: null,
    regulatorName: null,
    regulatorDetails: null,
    groupFlags: {
      isHolding: false,
      isSubsidiary: false,
      isAssociate: false,
      isJointVenture: false,
      hasInvestees: false,
    },
    groupEntities: [],
    financialRows: REQUIRED_PROFILE_FINANCIALS.map((p) => row(p, 1)),
    smallCompanySystem: 'not_small',
    smallCompanyFinal: 'not_small',
    smallCompanyOverridden: false,
    period: auditPeriodOf('2024-25', null, null),
    initialAudit: false,
    accountingEnvironment: 'in_house',
    accounting: {
      software: 'tally',
      softwareOther: null,
      recordsElectronic: 'yes',
      recordsDescription: null,
      serviceOrg: 'no',
      serviceOrgService: null,
      serviceOrgProvider: null,
    },
    jointAudit: false,
    jointAuditors: [],
    ...over,
  };
}

const NO_FIX = { details: null, financials: null, listings: null, regulatory: null };

function confirmAll(f: WorkspaceFacts): StoredCardConfirmations {
  const out: StoredCardConfirmations = {};
  for (const c of ['A', 'B', 'C', 'E', 'F', 'H', 'I'] as const)
    out[c] = {
      at: '2025-05-01T00:00:00Z',
      byId: null,
      byName: 'Manager',
      fingerprint: cardFingerprint(c, f),
    };
  return out;
}

describe('02.1 workspace — Card A company type (ERP-02)', () => {
  it('reads private / public / OPC from the entity type', () => {
    expect(companyTypeOf('private_limited', 'company', [])).toBe('private');
    expect(companyTypeOf('public_limited', 'company', [])).toBe('public');
    expect(companyTypeOf('opc', 'company', [])).toBe('opc');
  });
  it('shows Section 8 / Government from the master special facts', () => {
    expect(companyTypeOf('private_limited', 'company', ['section_8'])).toBe('section_8');
    expect(companyTypeOf('public_limited', 'company', ['government'])).toBe('government');
  });
  it('is null for a non-company and Other for an unknown company type', () => {
    expect(companyTypeOf('llp', 'llp', [])).toBeNull();
    expect(companyTypeOf('unlimited', 'company', [])).toBe('other');
  });
});

describe('02.1 workspace — Card C group flags (system suggested)', () => {
  it('an inbound subsidiary edge makes this entity the holding company', () => {
    const f = groupFlagsOf([rel({ type: 'subsidiary', outbound: false })]);
    expect(f).toMatchObject({ isHolding: true, hasInvestees: true, isSubsidiary: false });
  });
  it('an outbound subsidiary edge makes this entity the subsidiary', () => {
    expect(
      groupFlagsOf([rel({ type: 'wholly_owned_subsidiary', outbound: true })]).isSubsidiary,
    ).toBe(true);
  });
  it('associate / JV edges read by direction', () => {
    expect(groupFlagsOf([rel({ type: 'associate', outbound: true })]).isAssociate).toBe(true);
    expect(groupFlagsOf([rel({ type: 'joint_venture', outbound: true })]).isJointVenture).toBe(
      true,
    );
    expect(groupFlagsOf([rel({ type: 'associate', outbound: false })]).hasInvestees).toBe(true);
  });
  it('the group table names what each counterparty is, with interest, country and auditor', () => {
    const [e] = groupEntitiesOf([
      rel({
        type: 'subsidiary',
        outbound: false,
        counterparty: 'Sub Pvt Ltd',
        shareholdingPct: 100,
        counterpartyCountry: 'IN',
        firmAuditsCounterparty: true,
      }),
    ]);
    expect(e).toEqual({
      entity: 'Sub Pvt Ltd',
      relationship: 'Subsidiary',
      interestPct: 100,
      country: 'IN',
      auditor: 'DHVAJ',
    });
    const [p] = groupEntitiesOf([
      rel({ type: 'subsidiary', outbound: true, counterparty: 'Parent' }),
    ]);
    expect(p!.relationship).toBe('Holding company');
    expect(p!.auditor).toBe('Other auditor');
  });
});

describe('02.1 workspace — Card F period (Section 2(41))', () => {
  it('a continuing company runs 1 April to 31 March', () => {
    expect(auditPeriodOf('2024-25', '2010-06-01', null)).toEqual({
      from: '2024-04-01',
      to: '2025-03-31',
      nonStandard: false,
      firstFinancialYear: false,
      differentFyApproved: null,
    });
  });
  it('a company incorporated during the year starts its first financial year on incorporation', () => {
    const p = auditPeriodOf('2024-25', '2024-08-10', null);
    expect(p).toMatchObject({ from: '2024-08-10', nonStandard: true, firstFinancialYear: true });
  });
  it('a company incorporated on or after 1 January runs an extended first year to the next 31 March', () => {
    const p = auditPeriodOf('2024-25', '2024-02-15', 'no');
    expect(p).toMatchObject({ from: '2024-02-15', to: '2025-03-31', nonStandard: true });
  });
});

describe('02.1 workspace — Card E and SA 402', () => {
  it('an override wins, the system result stays', () => {
    expect(finalSmallCompanyOutcome('not_small', 'small')).toBe('small');
    expect(finalSmallCompanyOutcome('small', null)).toBe('small');
  });
  it('SA 402 fires on a Yes service-organisation answer even when accounting is in-house', () => {
    expect(usesServiceOrganisation('yes', 'in_house')).toBe(true);
    expect(usesServiceOrganisation('to_be_assessed', 'in_house')).toBe(false);
    const sa402 = deriveSaTriggers({
      initialAudit: false,
      accountingEnvironment: 'in_house',
      serviceOrg: 'yes',
      jointAudit: false,
    }).find((t) => t.code === 'SA 402');
    expect(sa402?.triggered).toBe(true);
  });
});

describe('02.1 workspace — card confirmation blockers', () => {
  it('Card A cannot be confirmed while listing is Information Pending', () => {
    const f = facts({
      listing: {
        masterListed: false,
        masterInProcess: false,
        answer: 'pending',
        inProcess: 'no',
        lines: [],
      },
    });
    expect(cardConfirmBlockers('A', f)).toHaveLength(1);
  });
  it('Card H requires the provider when a service organisation is used', () => {
    const f = facts({
      accounting: { ...facts().accounting, serviceOrg: 'yes', serviceOrgService: 'Payroll' },
    });
    expect(cardConfirmBlockers('H', f)).toEqual([
      'Name the service and the service-organisation provider.',
    ]);
  });
  it('Card I requires the other joint auditor', () => {
    expect(cardConfirmBlockers('I', facts({ jointAudit: true }))).toHaveLength(1);
  });
  it('Card E needs a determinable result or an override', () => {
    expect(
      cardConfirmBlockers(
        'E',
        facts({ smallCompanySystem: 'pending', smallCompanyFinal: 'pending' }),
      ),
    ).toHaveLength(1);
    expect(
      cardConfirmBlockers(
        'E',
        facts({
          smallCompanySystem: 'pending',
          smallCompanyFinal: 'small',
          smallCompanyOverridden: true,
        }),
      ),
    ).toHaveLength(0);
  });
});

describe('02.1 workspace — Card J completeness', () => {
  it('everything answered and confirmed → Complete, ready', () => {
    const f = facts();
    const r = evaluateCompleteness({
      facts: f,
      confirmations: confirmAll(f),
      profileConfirmed: false,
      fixes: NO_FIX,
    });
    expect(r.completeness.status).toBe(COMPLETENESS_STATUS.complete);
    expect(r.completeness.items).toEqual([]);
    // Every criterion but "Manager confirms the profile" is met.
    expect(r.completeness.satisfied).toBe(r.completeness.total - 1);
    expect(r.cards.find((c) => c.key === 'A')!.status).toBe(PROFILE_CARD_STATUS.confirmed);
  });

  it('a fresh profile lists every card to confirm (blocking) and is Information Incomplete', () => {
    const r = evaluateCompleteness({
      facts: facts(),
      confirmations: {},
      profileConfirmed: false,
      fixes: NO_FIX,
    });
    expect(r.completeness.status).toBe(COMPLETENESS_STATUS.incomplete);
    expect(r.completeness.items.filter((i) => i.kind === 'unconfirmed').map((i) => i.card)).toEqual(
      ['A', 'B', 'C', 'E', 'F', 'H', 'I'],
    );
    expect(r.cards.find((c) => c.key === 'B')!.status).toBe(PROFILE_CARD_STATUS.systemSuggested);
  });

  it('a missing net worth is a non-blocking pending item; missing small-company inputs block', () => {
    const f = facts({
      financialRows: REQUIRED_PROFILE_FINANCIALS.map((p) => row(p, p === 'net_worth' ? null : 1)),
      smallCompanySystem: 'pending',
      smallCompanyFinal: 'pending',
    });
    const r = evaluateCompleteness({
      facts: f,
      confirmations: confirmAll(f),
      profileConfirmed: false,
      fixes: NO_FIX,
    });
    const nw = r.completeness.items.find((i) => i.key === 'financial:net_worth');
    expect(nw).toMatchObject({ label: 'Net Worth unavailable.', blocking: false, kind: 'pending' });
    const sc = r.completeness.items.find((i) => i.label === MISSING_SMALL_COMPANY);
    expect(sc?.blocking).toBe(true);
  });

  it('a master change after confirmation makes the card stale → Attention Required', () => {
    const f = facts();
    const confirmations = confirmAll(f);
    const changed = facts({
      groupEntities: [
        {
          entity: 'New Sub',
          relationship: 'Subsidiary',
          interestPct: 60,
          country: 'IN',
          auditor: 'Other auditor',
        },
      ],
    });
    const r = evaluateCompleteness({
      facts: changed,
      confirmations,
      profileConfirmed: false,
      fixes: NO_FIX,
    });
    expect(r.completeness.status).toBe(COMPLETENESS_STATUS.attention);
    expect(r.completeness.items.find((i) => i.key === 'stale:C')?.blocking).toBe(true);
    const cards = withCardConfirmations(r.cards, confirmations);
    expect(cards.find((c) => c.key === 'C')).toMatchObject({
      status: 'attention',
      confirmation: { stale: true },
    });
  });

  it('a listing answer that contradicts the Entity Master is a blocking conflict', () => {
    const f = facts({
      listing: {
        masterListed: true,
        masterInProcess: false,
        answer: 'no',
        inProcess: 'no',
        lines: [],
      },
    });
    const r = evaluateCompleteness({
      facts: f,
      confirmations: confirmAll(f),
      profileConfirmed: false,
      fixes: NO_FIX,
    });
    expect(r.completeness.items.find((i) => i.key === 'listing_conflict')).toMatchObject({
      kind: 'conflict',
      blocking: true,
    });
  });

  it('Section 8 on the profile but not on the master is a conflict corrected on the master', () => {
    const f = facts({ specialEntityTypes: ['section_8'], masterOwnedSpecialTypes: [] });
    const r = evaluateCompleteness({
      facts: f,
      confirmations: confirmAll(f),
      profileConfirmed: false,
      fixes: NO_FIX,
    });
    expect(r.completeness.items.some((i) => i.key === 'master_section_8')).toBe(true);
  });

  it('a service organisation "To Be Assessed" is shown but does not block', () => {
    const f = facts({ accounting: { ...facts().accounting, serviceOrg: 'to_be_assessed' } });
    const r = evaluateCompleteness({
      facts: f,
      confirmations: confirmAll(f),
      profileConfirmed: false,
      fixes: NO_FIX,
    });
    const item = r.completeness.items.find((i) => i.key === 'service_org_tba');
    expect(item?.blocking).toBe(false);
    expect(r.completeness.items.filter((i) => i.blocking)).toEqual([]);
  });

  it('a not-applicable §2(85) result needs no Card E confirmation', () => {
    const f = facts({
      isCompany: false,
      entityCategory: 'llp',
      companyType: null,
      smallCompanySystem: 'not_applicable',
      smallCompanyFinal: 'not_applicable',
    });
    const conf = confirmAll(f);
    delete conf.E;
    const r = evaluateCompleteness({
      facts: f,
      confirmations: conf,
      profileConfirmed: false,
      fixes: NO_FIX,
    });
    expect(r.completeness.items.some((i) => i.card === 'E')).toBe(false);
    expect(r.cards.find((c) => c.key === 'E')!.status).toBe(PROFILE_CARD_STATUS.derived);
  });
});

describe('02.1 workspace — prior year (§14) and change impact (§16, §17)', () => {
  const labels = { companyType: 'Private Company', regulator: null, accounting: 'Tally' };

  it('compares stable classifications with last year, never money', () => {
    const prior = trackedFacts(facts(), labels);
    const current = trackedFacts(
      facts({
        listing: {
          masterListed: true,
          masterInProcess: false,
          answer: 'yes',
          inProcess: 'no',
          lines: [{ exchange: 'bse', securityType: 'equity', symbol: null }],
        },
      }),
      labels,
    );
    const changes = priorYearChanges(prior, current);
    expect(changes.find((c) => c.field === 'listing')).toMatchObject({
      changed: true,
      current: 'Listed (BSE equity)',
    });
    expect(changes.find((c) => c.field === 'companyType')?.changed).toBe(false);
    expect(changes.some((c) => c.field === 'financials')).toBe(false);
  });

  it('a changed fact maps to the downstream sections it feeds', () => {
    const before = trackedFacts(facts(), labels);
    const after = trackedFacts(facts({ smallCompanyFinal: 'small' }), labels);
    const changed = changedTrackedFacts(before, after);
    expect(changed).toEqual(['smallCompany']);
    expect(downstreamSectionsFor(changed)).toEqual([
      SUB_SECTION_KEY.scheduleIii,
      SUB_SECTION_KEY.caro,
      SUB_SECTION_KEY.icfr,
    ]);
    expect(downstreamSectionsFor(['group'])).toEqual([
      SUB_SECTION_KEY.financialReporting,
      SUB_SECTION_KEY.consolidation,
    ]);
    expect(downstreamSectionsFor(['jointAudit'])).toEqual([]);
  });
});

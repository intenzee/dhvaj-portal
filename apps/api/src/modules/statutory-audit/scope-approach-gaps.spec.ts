import 'reflect-metadata';
import {
  DECISION_DEFS,
  SCOPE_METHODOLOGY_VERSION,
  type ScopeMethodologyItemRecord,
} from '@hsdg/contracts';
import { AuditScopeApproachController } from './audit-scope-approach.controller';
import { buildHandoff, handoffItems } from './audit-scope-approach.service';
import {
  controlResultUnsupported,
  cycleForProcess,
  deriveTriggers,
  generatePopulation,
  matchScopeArea,
  materialityAffectedItems,
  suggestUnitSignals,
  unitFinPrompt,
  type MatchableArea,
  type ScopeFacts,
  type ScopeSignalFact,
  type ScopeState,
} from './scope-approach-engine';
import { resolveDecisionDefs } from './scope-methodology-library';

const facts = (over: Partial<ScopeFacts> = {}): ScopeFacts => ({
  entityName: 'Acme Ltd',
  initialAudit: false,
  jointAudit: false,
  accountingEnvironment: 'in_house',
  sa402: false,
  frameworkConclusions: {},
  investees: [],
  hasBranches: false,
  branches: [],
  components: [],
  s197: null,
  metrics: {},
  unitFactor: 100,
  overallMateriality: 1000,
  performanceMateriality: 600,
  specific: [],
  signals: [],
  focusNames: [],
  changeCategories: [],
  erpChange: false,
  cycles: [],
  otherSystems: [],
  customerTypes: [],
  serviceOrgContext: null,
  revenueAnalyticsFlag: false,
  ...over,
});

const signal = (over: Partial<ScopeSignalFact> = {}): ScopeSignalFact => ({
  id: 's1',
  code: 'PS-001',
  observation: 'Gross margin fell sharply',
  potentialImplications: null,
  ruleKey: null,
  attention: 'standard',
  destinations: [],
  ...over,
});

const area = (over: Partial<MatchableArea> = {}): MatchableArea => ({
  id: 'a1',
  areaCode: 'REV',
  name: 'Revenue',
  aliases: [],
  metricKeys: [],
  disposition: 'retained',
  scopeMapItemId: null,
  ...over,
});

describe('03.4 §7 population — branches, components and indicators', () => {
  it('creates one unit per 02.6 branch, with its auditor and location', () => {
    const units = generatePopulation(
      facts({
        hasBranches: true,
        branches: [
          { id: 'b1', name: 'Pune works', location: 'Pune', country: 'India', firmName: 'K & Co' },
          { id: 'b2', name: 'Dubai office', location: null, country: 'UAE', firmName: null },
        ],
      }),
    );
    const branches = units.filter((u) => u.unitType === 'branch');
    expect(branches.map((u) => u.unitKey)).toEqual(['branch:b1', 'branch:b2']);
    expect(branches[0]).toMatchObject({ auditor: 'branch_auditor', location: 'Pune, India' });
    expect(branches[1]).toMatchObject({ auditor: 'dhvaj', location: 'UAE' });
    expect(units.some((u) => u.unitKey === 'branches')).toBe(false);
  });

  it('falls back to one placeholder branch unit when 02.6 has branches but none captured', () => {
    const units = generatePopulation(facts({ hasBranches: true }));
    expect(units.filter((u) => u.unitType === 'branch').map((u) => u.unitKey)).toEqual([
      'branches',
    ]);
  });

  it('reads the 02.6 component matrix for auditor and significance', () => {
    const units = generatePopulation(
      facts({
        frameworkConclusions: { cfs: 'applicable' },
        investees: [{ name: 'Sub One', relationship: 'subsidiary', auditedByOtherAuditor: false }],
        components: [
          { name: ' sub one ', auditorType: 'other_auditor', significance: 'significant' },
        ],
      }),
    );
    const sub = units.find((u) => u.unitType === 'component')!;
    expect(sub.auditor).toBe('component_auditor');
    expect(sub.relevance).toContain('financial_significance');
    expect(sub.sourceLabel).toContain('significant component');
  });

  it('prompts for a financial indicator on components / branches until recorded', () => {
    expect(
      unitFinPrompt({ unitType: 'component', finAmount: null, finNotAvailable: false }),
    ).toMatch(/component/);
    expect(unitFinPrompt({ unitType: 'branch', finAmount: null, finNotAvailable: false })).toMatch(
      /branch/,
    );
    expect(
      unitFinPrompt({ unitType: 'component', finAmount: 5, finNotAvailable: false }),
    ).toBeNull();
    expect(
      unitFinPrompt({ unitType: 'component', finAmount: null, finNotAvailable: true }),
    ).toBeNull();
    expect(
      unitFinPrompt({ unitType: 'entity', finAmount: null, finNotAvailable: false }),
    ).toBeNull();
  });

  it('suggests (never links) signals that name a unit, and regulatory / fraud signals for the entity', () => {
    const signals = [
      signal({ id: 's1', code: 'PS-001', observation: 'Stock shortages reported at Pune works' }),
      signal({ id: 's2', code: 'PS-002', observation: 'GST notice received on input credit' }),
      signal({
        id: 's3',
        code: 'PS-003',
        observation: 'Whistle-blower complaint on vendor kickbacks',
      }),
      signal({ id: 's4', code: 'PS-004', observation: 'Revenue grew 12%' }),
    ];
    const branch = suggestUnitSignals(
      { name: 'Pune works', unitType: 'branch', signalIds: [], location: 'Pune' },
      signals,
    );
    expect(branch.map((x) => [x.code, x.reason])).toEqual([['PS-001', 'names_unit']]);
    const entity = suggestUnitSignals(
      { name: 'Acme Ltd', unitType: 'entity', signalIds: ['s2'], location: null },
      signals,
    );
    expect(entity.map((x) => [x.code, x.reason])).toEqual([['PS-003', 'fraud']]);
  });
});

describe('03.4 §23 Approach Map → 03.5', () => {
  it('matches by 03.2 metric, then the library code, then the name / alias', () => {
    const areas = [
      area({ id: 'rev', areaCode: 'REV', name: 'Revenue from operations' }),
      area({
        id: 'ar',
        areaCode: 'AR',
        name: 'Trade receivables',
        metricKeys: ['trade_receivables'],
      }),
      area({ id: 'x', areaCode: null, name: 'Leases', aliases: ['Right-of-use assets'] }),
    ];
    const it = (areaKey: string | null, metricKey: string | null, name: string) =>
      matchScopeArea({ id: 'm', areaKey, metricKey, name }, areas)?.id ?? null;
    expect(it('trade_receivables', 'trade_receivables', 'Debtors')).toBe('ar');
    expect(it('revenue', 'revenue', 'Revenue')).toBe('rev');
    expect(it(null, null, 'Right of use assets')).toBe('x');
    expect(it(null, null, 'Litigation')).toBeNull();
  });

  it('never reuses an area already carrying another map area, and prefers retained areas', () => {
    const areas = [
      area({ id: 'removed', disposition: 'removed' }),
      area({ id: 'taken', scopeMapItemId: 'other' }),
      area({ id: 'free' }),
    ];
    expect(
      matchScopeArea({ id: 'm', areaKey: 'revenue', metricKey: null, name: 'Revenue' }, areas)!.id,
    ).toBe('free');
    expect(
      matchScopeArea({ id: 'other', areaKey: 'revenue', metricKey: null, name: 'Revenue' }, areas)!
        .id,
    ).toBe('taken');
  });
});

describe('03.4 §24 reassessment hooks', () => {
  const items = [
    { id: 'big', name: 'Revenue', amount: 5000, included: true },
    { id: 'mid', name: 'Trade payables', amount: 800, included: true },
    { id: 'small', name: 'Cash & bank', amount: 100, included: true },
    { id: 'none', name: 'Financial close', amount: null, included: true },
    { id: 'out', name: 'Investments', amount: 800, included: false },
  ];

  it('flags only the map areas that cross the revised OM / PM', () => {
    const affected = materialityAffectedItems(
      items,
      { om: 1000, pm: 600, specific: [] },
      { om: 700, pm: 400, specific: [] },
    );
    expect(affected.map((a) => a.id)).toEqual(['mid']);
    expect(affected[0]!.reason).toContain('above overall materiality');
  });

  it('flags an area a changed specific materiality touches, even without an amount', () => {
    const affected = materialityAffectedItems(
      items,
      { om: 1000, pm: 600, specific: [] },
      { om: 1000, pm: 600, specific: [{ scope: 'Financial close adjustments', amount: 50 }] },
    );
    expect(affected.map((a) => a.id)).toEqual(['none']);
  });

  it('flags every area with an amount when there is no previous determination', () => {
    const affected = materialityAffectedItems(items, null, { om: 700, pm: 400, specific: [] });
    expect(affected.map((a) => a.id)).toEqual(['big', 'mid', 'small']);
  });

  it('maps a Section 05 process to its controls cycle and detects unsupported results', () => {
    expect(cycleForProcess('Order to cash — billing')).toBe('revenue');
    expect(cycleForProcess('Procure to pay')).toBe('procurement');
    expect(cycleForProcess('Monthly payroll run')).toBe('payroll');
    expect(cycleForProcess('Period-end close & journal entries')).toBe('financial_close');
    expect(cycleForProcess('Board minutes')).toBeNull();
    expect(
      controlResultUnsupported({
        design: 'effective',
        implementation: 'implemented',
        operatingEffectiveness: null,
      }),
    ).toBe(false);
    expect(
      controlResultUnsupported({
        design: 'deficiency',
        implementation: null,
        operatingEffectiveness: null,
      }),
    ).toBe(true);
    expect(
      controlResultUnsupported({
        design: null,
        implementation: null,
        operatingEffectiveness: 'exception_identified',
      }),
    ).toBe(true);
  });
});

describe('03.4 §31 methodology library', () => {
  const item = (over: Partial<ScopeMethodologyItemRecord> = {}): ScopeMethodologyItemRecord => ({
    id: 'i',
    itemCode: 'SMI-001',
    version: 1,
    kind: 'controls_cycle',
    itemKey: 'revenue',
    label: 'Revenue',
    options: ['reliance_contemplated', 'no_reliance'],
    hint: null,
    guidance: null,
    sortOrder: 1,
    effectiveFrom: '2000-01-01',
    effectiveTo: null,
    active: true,
    methodologyVersion: 'dhvaj-scope-2026.1',
    changeNote: 'v1',
    createdByName: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

  it('falls back to the built-in lists only when the library is empty', () => {
    const r = resolveDecisionDefs([], '2026-10-01');
    expect(r.defs).toBe(DECISION_DEFS);
    expect(r.methodology).toEqual({ version: SCOPE_METHODOLOGY_VERSION, source: 'built_in' });
  });

  it('uses the latest version effective on the date and keeps retired items aside', () => {
    const r = resolveDecisionDefs(
      [
        item(),
        item({
          id: 'i2',
          version: 2,
          label: 'Revenue & receivables',
          effectiveFrom: '2026-04-01',
          methodologyVersion: 'dhvaj-scope-2026.2',
        }),
        item({ id: 'i3', version: 3, label: 'Future', effectiveFrom: '2027-04-01' }),
        item({ id: 'p1', itemCode: 'SMI-002', itemKey: 'payroll', label: 'Payroll', sortOrder: 2 }),
        item({
          id: 'p2',
          itemCode: 'SMI-002',
          version: 2,
          itemKey: 'payroll',
          label: 'Payroll',
          active: false,
          sortOrder: 2,
        }),
      ],
      '2026-10-01',
    );
    expect(r.defs.controls_cycle.map((d) => [d.key, d.label, d.itemVersion])).toEqual([
      ['revenue', 'Revenue & receivables', 2],
    ]);
    expect(r.retired.get('controls_cycle:payroll')?.label).toBe('Payroll');
    expect(r.defs.timing).toEqual([]);
    expect(r.methodology).toEqual({ version: 'dhvaj-scope-2026.2', source: 'library' });
  });
});

describe('03.4 §6 hand-off and §30 route governance', () => {
  const st = (over: Partial<ScopeState>): ScopeState =>
    ({
      record: { id: 'r', versionLabel: 'v1.0', status: 'complete' },
      triggers: deriveTriggers(facts(), []),
      units: [],
      decisions: [],
      serviceOrgs: [],
      considerations: [],
      dependencies: [],
      limitations: [],
      mapItems: [],
      partnerActions: [],
      ...over,
    }) as unknown as ScopeState;

  it('hands specialists, other-auditor units, timing and open dependencies downstream', () => {
    const h = buildHandoff(
      st({
        considerations: [
          {
            kind: 'specialist',
            response: 'likely_required',
            noLongerTriggered: false,
            observation: 'Valuer',
            note: null,
            signalCode: null,
          },
          {
            kind: 'specialist',
            response: 'not_required',
            noLongerTriggered: false,
            observation: 'Tax',
            note: null,
            signalCode: null,
          },
        ] as unknown as ScopeState['considerations'],
        units: [
          { code: 'SU-001', name: 'Acme', auditor: 'dhvaj', noLongerGenerated: false },
          {
            code: 'SU-002',
            name: 'Sub',
            auditor: 'component_auditor',
            auditorStrategy: 'review_reporting',
            scopeConclusion: 'in_scope',
            noLongerGenerated: false,
          },
        ] as unknown as ScopeState['units'],
      }),
    );
    expect(h.specialists.map((x) => x.observation)).toEqual(['Valuer']);
    expect(h.components.map((x) => x.code)).toEqual(['SU-002']);
    expect(handoffItems(h)).toEqual(['specialist_planning', 'component_planning']);
    expect(handoffItems(buildHandoff(st({})))).toEqual([]);
  });

  it('gates every 03.4 write by a planning capability (team prepares, Manager concludes, EP reviews)', () => {
    const proto = AuditScopeApproachController.prototype as unknown as Record<string, object>;
    const cap = (m: string) =>
      Reflect.getMetadata('planning:capability', proto[m]!) as string[] | undefined;
    expect(Reflect.getMetadata('planning:scope', AuditScopeApproachController)).toBe('03.4');
    expect(cap('summary')).toBeUndefined();
    expect(cap('updateUnit')).toEqual(['addFacts', 'assess']);
    expect(cap('updateMapItem')).toEqual(['addFacts', 'assess']);
    expect(cap('addLimitation')).toEqual(['assess']);
    expect(cap('linkMapArea')).toEqual(['assess']);
    expect(cap('convertMapArea')).toEqual(['assess']);
    expect(cap('partnerAction')).toEqual(['partnerReview']);
    expect(cap('respondPartnerAction')).toEqual(['respondToChallenge']);
  });
});

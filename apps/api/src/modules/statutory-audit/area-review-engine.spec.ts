import type { AreaLibraryProfile, AssertionGroup } from '@hsdg/contracts';
import {
  applicableLibrary,
  assertionSuggestions,
  assessImpacts,
  buildMatrix,
  completionBasis,
  deriveArea,
  sectionStatus,
  signalRefs,
  specificMatchesArea,
  specificMatters,
  suggestSignals,
  tagMatches,
  validations,
  type AreaFacts,
  type AreaSignalFact,
  type DeriveContext,
  type LibraryRow,
  type StoredArea,
} from './area-review-engine';

const profile = (over: Partial<AreaLibraryProfile> = {}): AreaLibraryProfile => ({
  frf: 'as',
  industry: 'general_corporate',
  cfsApplicable: false,
  initialAudit: false,
  ...over,
});

const lib = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  id: 'L-' + (over.areaCode ?? 'REV'),
  libraryVersion: 'v1',
  areaCode: 'REV',
  areaName: 'Revenue',
  areaType: 'profit_loss',
  category: 'income_expenses',
  frameworkProfile: 'both',
  industryProfile: 'general_corporate',
  conditionKey: null,
  defaultAssertions: ['TX_OCC', 'TX_COMP'],
  nonAssertionWorkstream: false,
  defaultAttention: 'standard',
  relatedAuthorities: [],
  signalMappingTags: ['revenue', 'sales'],
  metricKeys: ['revenue'],
  indicatorTags: [],
  assertionAttentionRules: [],
  aliases: ['sales', 'turnover'],
  effectiveFrom: '2020-04-01',
  effectiveTo: null,
  active: true,
  sortOrder: 1,
  ...over,
});

const facts = (over: Partial<AreaFacts> = {}): AreaFacts => ({
  profile: profile(),
  caroApplicable: false,
  metrics: {},
  datasetUnit: 'inr_crore',
  currency: 'INR',
  om: 10_000_000,
  specific: [],
  signals: [],
  ...over,
});

const signal = (over: Partial<AreaSignalFact> = {}): AreaSignalFact => ({
  id: 's1',
  code: 'PS-001',
  observation: 'Revenue increased sharply in March',
  potentialImplications: null,
  ruleKey: 'movement_revenue',
  attention: 'enhanced',
  status: 'open',
  ...over,
});

const stored = (over: Partial<StoredArea> = {}): StoredArea => ({
  id: 'a1',
  seq: 1,
  source: 'library',
  origin: 'population',
  sourceAuditAreaId: 'L-REV',
  areaCode: 'REV',
  libraryVersion: 'v1',
  areaName: 'Revenue',
  areaType: 'profit_loss',
  additionReason: null,
  disposition: 'retained',
  attention: 'standard',
  attentionSource: 'default',
  attentionReason: null,
  removalReasonCode: null,
  removalReasonText: null,
  coveredUnderAreaId: null,
  removedAt: null,
  removedByName: null,
  manualCy: null,
  manualPy: null,
  manualCurrency: null,
  manualUnit: null,
  amountSource: null,
  amountNote: null,
  planningOwnerEmployeeId: null,
  planningOwnerName: null,
  reviewFlag: null,
  reviewFlagSource: null,
  inconsistencyResolution: null,
  version: 1,
  assertions: [
    {
      id: 'x1',
      assertionId: 'TX_OCC',
      origin: 'suggested',
      active: true,
      removalReason: null,
      attention: 'standard',
      suggestedAttention: null,
      suggestionBasis: null,
      attentionReason: null,
      version: 1,
    },
  ],
  signalLinks: [],
  specificLinks: [],
  ...over,
});

const master = new Map<string, { group: AssertionGroup; label: string }>([
  ['TX_OCC', { group: 'transactions', label: 'Occurrence' }],
  ['TX_COMP', { group: 'transactions', label: 'Completeness' }],
]);

const ctx = (
  f: AreaFacts,
  l: LibraryRow | null = lib(),
  names = new Map<string, string>(),
): DeriveContext => ({
  facts: f,
  lib: l,
  signalById: new Map(f.signals.map((s) => [s.id, s])),
  specificByKey: new Map(f.specific.map((s) => [s.key, s])),
  areaName: names,
  priorYear: null,
  authorities: [],
  assertionMaster: master,
});

const derive = (a: StoredArea, f = facts(), l: LibraryRow | null = lib()) =>
  deriveArea(a, ctx(f, l));

const state = (
  areas: ReturnType<typeof derive>[],
  f = facts(),
  resolutions = new Map<string, string>(),
) => ({
  profile: f.profile,
  areas,
  specific: specificMatters(f, areas),
  signals: signalRefs(f, areas, resolutions),
});

const failing = (s: ReturnType<typeof state>) =>
  validations(s)
    .filter((v) => !v.met)
    .map((v) => v.id);

describe('03.5 audit areas & assertions engine', () => {
  it('AT-01: selects the complete applicable library — CFS adds Consolidation, initial audit adds Opening Balances', () => {
    const rows = [
      lib(),
      lib({
        areaCode: 'CONSOL',
        areaName: 'Consolidation',
        conditionKey: 'cfs_applicable',
        sortOrder: 2,
      }),
      lib({
        areaCode: 'OB',
        areaName: 'Opening Balances',
        conditionKey: 'initial_audit',
        sortOrder: 3,
      }),
      lib({ areaCode: 'IND', areaName: 'Ind AS only', frameworkProfile: 'ind_as', sortOrder: 4 }),
      lib({ areaCode: 'OLD', areaName: 'Inactive', active: false, sortOrder: 5 }),
    ];
    expect(applicableLibrary(rows, profile(), '2026-03-31').map((r) => r.areaCode)).toEqual([
      'REV',
    ]);
    expect(
      applicableLibrary(
        rows,
        profile({ cfsApplicable: true, initialAudit: true, frf: 'ind_as' }),
        '2026-03-31',
      ).map((r) => r.areaCode),
    ).toEqual(['REV', 'CONSOL', 'OB', 'IND']);
  });

  it('matches signals to areas through mapping tags (rule key or word-prefix text)', () => {
    expect(tagMatches('revenue', signal())).toBe(true);
    expect(
      tagMatches('rent', signal({ observation: 'Represents a new market', ruleKey: null })),
    ).toBe(false);
    expect(
      tagMatches('subsidiar', signal({ observation: 'New subsidiary acquired', ruleKey: null })),
    ).toBe(true);
    expect(tagMatches('cash_bank', signal({ ruleKey: 'movement_cash_bank' }))).toBe(true);
    expect(
      suggestSignals(lib(), [signal(), signal({ id: 's2', ruleKey: 'x', observation: 'Payroll' })]),
    ).toEqual(['s1']);
  });

  it('suggests Enhanced assertions from §17 scenarios (suggestion, not a conclusion)', () => {
    const m = assertionSuggestions(
      [
        {
          scenario: 'Revenue spike / unusual year-end pattern',
          tags: ['movement_revenue'],
          assertions: ['TX_OCC', 'TX_CUTOFF'],
        },
      ],
      [signal()],
    );
    expect([...m.keys()]).toEqual(['TX_OCC', 'TX_CUTOFF']);
    expect(m.get('TX_OCC')).toContain('PS-001');
  });

  it('suggests the area a specific-materiality matter belongs to', () => {
    const sp = {
      key: 'related party transactions',
      label: 'Related party transactions',
      scopeType: 'disclosure',
      amount: null,
      affectedAreas: [],
    };
    expect(
      specificMatchesArea(sp, {
        areaName: 'Related Parties',
        areaCode: 'RPT',
        aliases: ['related party transactions'],
      }),
    ).toBe(true);
    expect(
      specificMatchesArea(sp, { areaName: 'Revenue', areaCode: 'REV', aliases: ['sales'] }),
    ).toBe(false);
  });

  it('AT-14 / AT-15: zero or below-OM balances are shown, never removed; Above/Below OM is informational', () => {
    const f = facts({ metrics: { revenue: { cy: 0, py: 0.5 } } });
    const a = derive(stored(), f);
    expect(a.disposition).toBe('retained');
    expect(a.omComparison).toBe('below_om');
    expect(a.amountSource).toBe('03.2');
    const big = derive(stored(), facts({ metrics: { revenue: { cy: 82, py: 70 } } }));
    expect(big.omComparison).toBe('above_om');
    expect(big.strongIndicators).toContain('Amount exceeds Overall Materiality');
  });

  it('AT-05: removal warnings show financial data, signal and specific materiality context', () => {
    const f = facts({
      metrics: { revenue: { cy: 82, py: 70 } },
      signals: [signal()],
      specific: [
        {
          key: 'revenue',
          label: 'Revenue',
          scopeType: 'class_of_transactions',
          amount: 5,
          affectedAreas: [],
        },
      ],
    });
    const a = derive(
      stored({
        signalLinks: [{ signalId: 's1', origin: 'auto', active: true }],
        specificLinks: [{ specificKey: 'revenue', origin: 'auto', active: true }],
      }),
      f,
    );
    const keys = a.warnings.map((w) => w.key);
    expect(keys).toEqual(
      expect.arrayContaining(['financial_data', 'above_om', 'specific:revenue', 'signal:s1']),
    );
    expect(a.warnings.find((w) => w.key === 'specific:revenue')!.severity).toBe('high');
    expect(a.suggestedAttention).toBe('enhanced');
  });

  it('AT-06 / AT-07: CFS + Consolidation removed, initial audit + Opening Balances removed → Requires Review, blocked until resolved', () => {
    const f = facts({ profile: profile({ cfsApplicable: true, initialAudit: true }) });
    const consolLib = lib({
      areaCode: 'CONSOL',
      areaName: 'Consolidation',
      conditionKey: 'cfs_applicable',
    });
    const obLib = lib({
      areaCode: 'OB',
      areaName: 'Opening Balances',
      conditionKey: 'initial_audit',
    });
    const removed = {
      disposition: 'removed' as const,
      removalReasonCode: 'NOT_APPLICABLE' as const,
      removalReasonText: 'x',
    };
    const consol = derive(
      stored({ id: 'c', areaCode: 'CONSOL', areaName: 'Consolidation', ...removed }),
      f,
      consolLib,
    );
    const ob = derive(
      stored({ id: 'o', areaCode: 'OB', areaName: 'Opening Balances', ...removed }),
      f,
      obLib,
    );
    expect(consol.displayAttention).toBe('requires_review');
    expect(ob.displayAttention).toBe('requires_review');
    const s = state([consol, ob], f);
    expect(failing(s)).toEqual(expect.arrayContaining(['VAL-06', 'VAL-07', 'VAL-09']));
    expect(sectionStatus('in_progress', validations(s), [])).toBe('requires_review');

    const resolved = [
      derive(
        stored({
          id: 'c',
          areaCode: 'CONSOL',
          areaName: 'Consolidation',
          ...removed,
          inconsistencyResolution: 'Exempt under Rule 6',
        }),
        f,
        consolLib,
      ),
      derive(
        stored({
          id: 'o',
          areaCode: 'OB',
          areaName: 'Opening Balances',
          ...removed,
          inconsistencyResolution: 'Covered by predecessor review',
        }),
        f,
        obLib,
      ),
    ];
    expect(failing(state(resolved, f))).not.toEqual(
      expect.arrayContaining(['VAL-06', 'VAL-07', 'VAL-09']),
    );
  });

  it('AT-09: a retained area with zero active assertions blocks completion (VAL-03)', () => {
    const a = derive(
      stored({ assertions: [{ ...stored().assertions[0]!, active: false, removalReason: 'n/a' }] }),
    );
    expect(failing(state([a]))).toContain('VAL-03');
  });

  it('AT-12 / AT-13: unmapped specific materiality and unmapped Enhanced signals block; a documented no-area resolution clears VAL-05', () => {
    const f = facts({
      signals: [signal()],
      specific: [
        {
          key: 'inventory',
          label: 'Inventory',
          scopeType: 'account_balance',
          amount: 1,
          affectedAreas: [],
        },
      ],
    });
    const a = derive(stored(), f);
    expect(failing(state([a], f))).toEqual(expect.arrayContaining(['VAL-04', 'VAL-05']));
    expect(
      failing(state([a], f, new Map([['s1', 'Entity-level matter; addressed in 03.1 strategy']]))),
    ).not.toContain('VAL-05');
  });

  it('VAL-08 / VAL-10: strong-indicator removal needs rationale; Covered Elsewhere must point to a retained area', () => {
    const f = facts({ metrics: { revenue: { cy: 82, py: 70 } } });
    const removed = derive(
      stored({ disposition: 'removed', removalReasonCode: 'NO_BALANCE_ACTIVITY' }),
      f,
    );
    expect(failing(state([removed], f))).toContain('VAL-08');
    const other = derive(
      stored({
        id: 'b',
        areaCode: 'OI',
        areaName: 'Other Income',
        disposition: 'removed',
        removalReasonCode: 'NOT_APPLICABLE',
      }),
      f,
      null,
    );
    const covered = derive(
      stored({
        id: 'c',
        areaCode: 'X',
        areaName: 'X',
        disposition: 'removed',
        removalReasonCode: 'COVERED_ELSEWHERE',
        coveredUnderAreaId: 'b',
      }),
      f,
      null,
    );
    expect(failing(state([other, covered], f))).toContain('VAL-10');
  });

  it('AT-20: the matrix carries only retained areas and active assertions', () => {
    const kept = derive(stored());
    const gone = derive(
      stored({
        id: 'b',
        areaCode: 'GRANTS',
        areaName: 'Government Grants',
        disposition: 'removed',
        removalReasonCode: 'NO_BALANCE_ACTIVITY',
      }),
    );
    const m = buildMatrix([kept, gone]);
    expect(m.map((r) => r.areaName)).toEqual(['Revenue']);
    expect(m[0]!.assertions.map((x) => x.assertionId)).toEqual(['TX_OCC']);
  });

  it('AT-17: materiality decrease flags removed areas between the old and new thresholds; other upstream changes raise Update Required', () => {
    const before = facts({ om: 100_000_000, metrics: { revenue: { cy: 5, py: 4 } } });
    const basis = completionBasis(before);
    const removed = derive(
      stored({
        disposition: 'removed',
        removalReasonCode: 'NOT_SEPARATELY_SCOPED',
        removalReasonText: 'small',
      }),
      before,
    );
    const after = facts({
      om: 30_000_000,
      metrics: { revenue: { cy: 5, py: 4 }, inventory: { cy: 3, py: 2 } },
      signals: [signal({ id: 's9', code: 'PS-009' })],
      profile: profile({ cfsApplicable: true }),
    });
    const impacts = assessImpacts(
      basis,
      after,
      [removed],
      [lib(), lib({ areaCode: 'INV', areaName: 'Inventory', metricKeys: ['inventory'] })],
    );
    expect(impacts.map((i) => i.kind)).toEqual(
      expect.arrayContaining([
        'materiality_decrease',
        'new_signal',
        'cfs_change',
        'new_financial_area',
      ]),
    );
    expect(impacts.find((i) => i.kind === 'materiality_decrease')!.areaIds).toEqual(['a1']);
    expect(sectionStatus('complete', [], impacts)).toBe('update_required');
    expect(sectionStatus('complete', [], [])).toBe('complete');
    expect(assessImpacts(null, after, [removed], [])).toEqual([]);
  });

  it('never labels anything as a risk rating', () => {
    const a = derive(stored(), facts({ signals: [signal()] }));
    expect(JSON.stringify(a)).not.toMatch(/low risk|medium risk|high risk|significant risk/i);
  });
});

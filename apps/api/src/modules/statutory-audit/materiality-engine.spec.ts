import type {
  MaterialityDatasetInfo,
  MaterialityDetermination,
  ResolvedRule,
  RuleResolver,
} from '@hsdg/contracts';
import {
  buildCandidates,
  buildSensitivity,
  computeMateriality,
  computeMaterialityCompletion,
  methodologyStatus,
  partnerAttentionTriggers,
  qualitativePrompts,
  resolveMaterialityMethodology,
  revisionImpacts,
  roundToStep,
  summariseNormalisation,
  type MaterialityFacts,
} from './materiality-engine';

// Test-only library data (the real ranges live in the Audit Rules Library).
const LIBRARY: Record<string, [number, number | null]> = {
  om_pct_pbt: [5, 10],
  om_pct_normalised_pbt: [5, 10],
  om_pct_revenue: [0.5, 1],
  om_pct_total_assets: [1, 2],
  om_pct_net_assets: [1, 5],
  om_pct_expenditure: [0.5, 2],
  pm_pct_om: [50, 75],
  ctt_pct_om: [3, 5],
  py_change_attention: [25, null],
  volatility_attention: [30, null],
  near_breakeven_margin: [2, null],
  rounding_step: [1000, null],
};

const resolver =
  (lib: Record<string, [number, number | null]> = LIBRARY): RuleResolver =>
  (area, criterion) => {
    const hit = area === 'materiality' ? lib[criterion] : undefined;
    if (!hit) return null;
    return {
      ruleId: criterion,
      ruleCode: `MAT_${criterion.toUpperCase()}`,
      ruleVersionId: `${criterion}-v1`,
      version: 1,
      areaKey: area,
      entityClass: null,
      criterion,
      operator: hit[1] === null ? '>=' : 'between',
      unit: 'percent',
      threshold: hit[0],
      thresholdHigh: hit[1],
      measurementBasis: null,
      outcome: 'guidance',
      effectiveFrom: '2000-04-01',
      authorityProvisionId: null,
      guidanceReference: 'PROVISIONAL placeholder',
      bands: [],
    } as ResolvedRule;
  };

const methodology = resolveMaterialityMethodology(resolver());
const CRORE = 10_000_000;
const dataset: MaterialityDatasetInfo = {
  ready: true,
  reason: null,
  periodEnd: '2026-03-31',
  currency: 'INR',
  units: 'inr_crore',
  unitLabel: '₹ crore',
  unitFactor: CRORE,
  dataStatus: 'draft',
  cySource: 'Draft FS',
};
const facts: MaterialityFacts = {
  initialAudit: false,
  specialEntityTypes: [],
  industryProfile: 'generic',
  changeCategories: [],
  focusAreas: [],
  signals: [],
  covenantsNote: null,
  erpChange: false,
  relatedPartyFigures: false,
  elevatedAnalytics: 0,
};

const det = (over: Partial<MaterialityDetermination> = {}): MaterialityDetermination => ({
  id: 'd1',
  versionNo: 1,
  versionLabel: 'v1.0',
  status: 'draft',
  methodologyVersion: null,
  principalUsers: ['shareholders_promoters'],
  principalUsersOther: null,
  userFocus: ['profit'],
  userFocusOther: null,
  pyOverallMateriality: null,
  pyPerformanceMateriality: null,
  pyClearlyTrivial: null,
  pyBenchmark: null,
  pySource: null,
  pyAuditDifferences: null,
  normalisationRationale: null,
  selectedBenchmark: null,
  otherBenchmarkLabel: null,
  otherBenchmarkAmount: null,
  otherBenchmarkSource: null,
  benchmarkRationale: null,
  benchmarkAmount: null,
  selectedPct: null,
  calculatedOm: null,
  selectedOm: null,
  omAdjustmentReason: null,
  omOverrideReason: null,
  pctFactorsConsidered: [],
  pctFactorsNote: null,
  mat04: null,
  mat04Rationale: null,
  aggregationFactors: [],
  aggregationOther: null,
  pmPct: null,
  calculatedPm: null,
  selectedPm: null,
  pmAdjustmentReason: null,
  pmRationale: null,
  pmOverrideReason: null,
  mat06: null,
  mat06Note: null,
  selectedCtt: null,
  cttRationale: null,
  cttOverrideReason: null,
  mat07: null,
  mat07Note: null,
  revisionTrigger: null,
  revisionReason: null,
  revisionDate: null,
  revisionOwnerEmployeeId: null,
  revisionOwnerName: null,
  conclusionSummary: null,
  mat08: null,
  completedByName: null,
  completedAt: null,
  version: 1,
  ...over,
});

const metrics = {
  revenue: { cy: 82, py: 54 },
  other_income: { cy: 1, py: 1 },
  pbt: { cy: 8.2, py: 6 },
  total_assets: { cy: 120, py: 100 },
  net_worth: { cy: 40, py: 35 },
};

const candidatesFor = (over: Partial<Parameters<typeof buildCandidates>[0]> = {}) =>
  buildCandidates({
    dataset,
    metrics,
    adjustmentsTotal: 0,
    hasAdjustments: false,
    userFocus: ['profit'],
    principalUsers: ['shareholders_promoters'],
    methodology,
    assessments: {},
    facts,
    ...over,
  });

const cand = (list: ReturnType<typeof candidatesFor>, key: string) =>
  list.find((c) => c.key === key)!;

describe('03.3 methodology library', () => {
  it('shows no percentage at all when the DHVAJ library has none (SA 320 prescribes none)', () => {
    const empty = resolveMaterialityMethodology(() => null);
    expect(empty.omGuidance).toEqual({});
    expect(empty.pmGuidance).toBeNull();
    expect(empty.roundingStep).toBeNull();
    const c = candidatesFor({ methodology: empty });
    expect(c.every((x) => x.guidance === null && x.indicativeLowInr === null)).toBe(true);
    expect(methodologyStatus(5, empty.omGuidance.pbt)).toBe('no_guidance');
  });

  it('labels library ranges with rule code + version and flags provisional guidance', () => {
    expect(methodology.omGuidance.pbt).toMatchObject({
      lowPct: 5,
      highPct: 10,
      ruleVersion: 1,
      provisional: true,
    });
    expect(methodology.versionLabel).toContain('MAT_OM_PCT_PBT@1');
    expect(methodology.anyProvisional).toBe(true);
  });
});

describe('03.3.2 candidate benchmarks', () => {
  it('consumes 03.2 metrics, shows CY / PY / movement and never ranks a "best" benchmark', () => {
    const c = candidatesFor();
    expect(c.map((x) => x.key)).toEqual([
      'pbt',
      'normalised_pbt',
      'revenue',
      'total_assets',
      'net_assets',
      'expenditure',
    ]);
    const rev = cand(c, 'revenue');
    expect(rev).toMatchObject({
      cy: 82,
      py: 54,
      movementLabel: '+51.9%',
      status: 'available',
      amountInr: 82 * CRORE,
    });
    expect(rev.volatile).toBe(true); // 51.9% ≥ 30% attention parameter
    expect(rev.indicativeLowInr).toBeCloseTo(0.41 * CRORE);
    for (const x of c) expect(Object.keys(x)).not.toContain('rank');
    expect(cand(c, 'expenditure')).toMatchObject({ cy: 82 + 1 - 8.2, status: 'available' });
  });

  it('a loss / zero benchmark is not meaningful — no invalid percentage calculation', () => {
    const c = candidatesFor({
      metrics: { ...metrics, pbt: { cy: -3, py: 2 }, net_worth: { cy: 0, py: 5 } },
    });
    expect(cand(c, 'pbt')).toMatchObject({
      status: 'not_meaningful',
      amountInr: null,
      indicativeLowInr: null,
    });
    expect(cand(c, 'pbt').prompts.join(' ')).toContain('loss');
    expect(cand(c, 'net_assets').status).toBe('not_meaningful');
  });

  it('PY = 0 shows N/M, never infinity', () => {
    const c = candidatesFor({ metrics: { ...metrics, total_assets: { cy: 10, py: 0 } } });
    expect(cand(c, 'total_assets')).toMatchObject({ movementPct: null, movementLabel: 'N/M' });
  });

  it('nothing is calculable until the 03.2.7 header allows it (no mixed-unit calculation)', () => {
    const c = candidatesFor({
      dataset: { ...dataset, ready: false, unitFactor: null, reason: 'units' },
    });
    expect(c.every((x) => x.status === 'insufficient_data' && x.amountInr === null)).toBe(true);
  });
});

describe('03.3.3 normalisation (spec example)', () => {
  it('reported PBT ₹1.80 cr + ₹2.20 cr non-recurring = normalised PBT ₹4.00 cr; source metric untouched', () => {
    const adj = [
      {
        id: 'a',
        code: 'NA-001',
        description: 'Restructuring',
        amount: 2.2,
        reason: 'Non-recurring',
        recurring: false,
        evidence: null,
        version: 1,
      },
    ];
    const n = summariseNormalisation(adj, 1.8);
    expect(n.normalisedPbt).toBeCloseTo(4.0);
    const c = candidatesFor({
      metrics: { ...metrics, pbt: { cy: 1.8, py: 5 } },
      adjustmentsTotal: 2.2,
      hasAdjustments: true,
    });
    expect(cand(c, 'normalised_pbt').cy).toBeCloseTo(4.0);
    expect(cand(c, 'pbt').cy).toBe(1.8);
    expect(cand(candidatesFor(), 'normalised_pbt').status).toBe('insufficient_data');
  });
});

describe('03.3.5 / 03.3.6 calculations', () => {
  const selected = det({ selectedBenchmark: 'pbt', selectedPct: 5, benchmarkAmount: 8.2 });

  it('OM = benchmark × %, stores unrounded and displays the methodology-rounded amount', () => {
    const c = computeMateriality({
      det: selected,
      candidates: candidatesFor(),
      methodology,
      unitFactor: CRORE,
      aggregation: [],
    });
    expect(c.liveCalculatedOm).toBe(4_100_000);
    expect(roundToStep(4_123_456.78, methodology.roundingStep)).toBe(4_123_000);
    expect(c.omMethodologyStatus).toBe('within_guidance'); // judges the selected % before an OM is chosen
    const withOm = computeMateriality({
      det: { ...selected, selectedOm: 4_100_000 },
      candidates: candidatesFor(),
      methodology,
      unitFactor: CRORE,
      aggregation: [],
    });
    expect(withOm.omMethodologyStatus).toBe('within_guidance');
    const outside = computeMateriality({
      det: { ...selected, selectedPct: 12, selectedOm: 9_840_000 },
      candidates: candidatesFor(),
      methodology,
      unitFactor: CRORE,
      aggregation: [],
    });
    expect(outside.omMethodologyStatus).toBe('outside_guidance');
  });

  it('flags — never silently changes — a selected benchmark whose 03.2 figure changed', () => {
    const moved = candidatesFor({ metrics: { ...metrics, pbt: { cy: 9, py: 6 } } });
    const c = computeMateriality({
      det: { ...selected, selectedOm: 4_100_000 },
      candidates: moved,
      methodology,
      unitFactor: CRORE,
      aggregation: [],
    });
    expect(c.sourceChanged).toBe(true);
    expect(c.sourceChangeDetail).toContain('from 8.2 to 9');
    expect(c.liveCalculatedOm).toBe(4_500_000); // recalculated for display only
  });

  it('PM must be below OM — blocking in the completion checklist', () => {
    const d = det({
      selectedBenchmark: 'pbt',
      selectedPct: 5,
      selectedOm: 4_100_000,
      pmPct: 60,
      selectedPm: 4_100_000,
    });
    const candidates = candidatesFor();
    const computed = computeMateriality({
      det: d,
      candidates,
      methodology,
      unitFactor: CRORE,
      aggregation: [],
    });
    const checks = computeMaterialityCompletion({
      det: d,
      dataset,
      candidates,
      computed,
      adjustments: [],
      specific: [],
      qualitative: [],
      revisionItems: [],
    });
    expect(checks.find((x) => x.key === 'performance')?.detail).toContain('PM must be below OM');
  });
});

describe('03.3.10 sensitivity', () => {
  it('shows ratios with no pass/fail verdict and N/M for a loss PBT', () => {
    const candidates = candidatesFor({ metrics: { ...metrics, pbt: { cy: -1, py: 2 } } });
    const rows = buildSensitivity({
      det: det({
        selectedOm: 4_100_000,
        selectedPm: 3_000_000,
        selectedCtt: 200_000,
        pyOverallMateriality: 3_000_000,
      }),
      candidates,
    });
    const by = (k: string) => rows.find((r) => r.key === k)!;
    expect(by('om_revenue').display).toBe('0.5%');
    expect(by('om_pbt').display).toBe('N/M');
    expect(by('py_change').display).toContain('+36.7%');
    expect(by('pm_om').display).toBe('73.17%');
    for (const r of rows)
      expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['pass', 'fail', 'verdict']));
  });
});

describe('§19 Partner Attention', () => {
  it('normalised / other benchmark, outside guidance, PY change, revision all surface', () => {
    const d = det({
      selectedBenchmark: 'other',
      otherBenchmarkLabel: 'Grant income',
      selectedOm: 4_100_000,
      pyOverallMateriality: 2_000_000,
      versionNo: 2,
      revisionTrigger: 'actual_results',
      revisionReason: 'Final figures',
    });
    const candidates = candidatesFor();
    const computed = computeMateriality({
      det: d,
      candidates,
      methodology,
      unitFactor: CRORE,
      aggregation: [],
    });
    const keys = partnerAttentionTriggers({
      det: d,
      candidates,
      computed: { ...computed, pmMethodologyStatus: 'outside_guidance' },
      methodology,
      adjustments: [
        {
          id: 'a',
          code: 'NA-001',
          description: 'x',
          amount: 1,
          reason: 'r',
          recurring: false,
          evidence: null,
          version: 1,
        },
      ],
      specific: [],
      qualitative: [],
    }).map((t) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'normalised_benchmark',
        'unusual_benchmark',
        'pm_outside_guidance',
        'py_change',
        'revised',
      ]),
    );
  });
});

describe('03.3.11 revision impact', () => {
  const baseline = {
    versionLabel: 'v1.0',
    overallMateriality: 4_100_000,
    performanceMateriality: 3_000_000,
    clearlyTrivial: 200_000,
    specificCount: 0,
    benchmark: 'pbt' as const,
    selectedPct: 5,
  };

  it('a decrease flags sampling, scoping, substantive, analytics and misstatement work', () => {
    const items = revisionImpacts(
      det({ versionNo: 2, selectedOm: 3_000_000, selectedPm: 2_000_000, selectedCtt: 200_000 }),
      baseline,
      0,
    );
    expect(items.map((i) => i.itemKey)).toEqual([
      'sampling',
      'scoping',
      'substantive_procedures',
      'analytics',
      'misstatement_evaluation',
    ]);
  });

  it('an increase never auto-reduces work already performed', () => {
    const items = revisionImpacts(
      det({ versionNo: 2, selectedOm: 5_000_000, selectedPm: 3_500_000, selectedCtt: 250_000 }),
      baseline,
      1,
    );
    expect(items.map((i) => i.itemKey)).toEqual([
      'increase_consideration',
      'misstatement_register',
      'specific_areas',
    ]);
    expect(items[0]!.detail).toContain('do not automatically reduce');
  });

  it('v1.0 has no revision impact', () => {
    expect(revisionImpacts(det(), baseline, 0)).toEqual([]);
  });
});

describe('03.3.9 qualitative prompts', () => {
  it('prompts a profit↔loss flip when PBT is within OM of break-even, even though the amount is below OM', () => {
    const p = qualitativePrompts({ facts, pbtInr: 3_000_000, selectedOm: 4_100_000 });
    expect(p.profit_loss_flip).toContain('could turn profit into loss');
    expect(
      qualitativePrompts({ facts, pbtInr: 90_000_000, selectedOm: 4_100_000 }).profit_loss_flip,
    ).toBeNull();
  });
});

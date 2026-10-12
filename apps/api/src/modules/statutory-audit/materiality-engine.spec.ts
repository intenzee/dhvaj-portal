import type {
  MaterialityDatasetInfo,
  MaterialityDetermination,
  MaterialityMethodologyRuleDef,
} from '@hsdg/contracts';
import {
  buildCandidates,
  buildSensitivity,
  computeMateriality,
  computeMaterialityCompletion,
  methodologyContext,
  methodologyStatus,
  partnerAttentionTriggers,
  qualitativePrompts,
  resolveMaterialityMethodology,
  revisionImpacts,
  roundToStep,
  summariseNormalisation,
  type MaterialityFacts,
  type MethodologyContext,
} from './materiality-engine';

// Test-only library data (the real rules live in the Materiality Methodology Library).
const rule = (
  ruleCode: string,
  over: Partial<MaterialityMethodologyRuleDef>,
): MaterialityMethodologyRuleDef => ({
  ruleCode,
  version: 1,
  kind: 'om_benchmark',
  name: ruleCode,
  benchmarkKey: null,
  benchmarkLabel: null,
  attentionCriterion: null,
  lowPct: null,
  highPct: null,
  parameterValue: null,
  industryProfiles: [],
  circumstances: [],
  considerations: [],
  sourceBasis: 'PROVISIONAL placeholder',
  provisional: true,
  overrideAttention: 'partner_attention',
  effectiveFrom: '2000-01-01',
  effectiveTo: null,
  active: true,
  methodologyVersion: 'test-2026.1',
  ...over,
});
const om = (code: string, key: string, lo: number, hi: number) =>
  rule(code, { benchmarkKey: key, lowPct: lo, highPct: hi });
const LIBRARY: MaterialityMethodologyRuleDef[] = [
  om('MMR-001', 'pbt', 5, 10),
  om('MMR-002', 'normalised_pbt', 5, 10),
  om('MMR-003', 'revenue', 0.5, 1),
  om('MMR-004', 'total_assets', 1, 2),
  om('MMR-005', 'net_assets', 1, 5),
  om('MMR-006', 'expenditure', 0.5, 2),
  rule('MMR-007', { kind: 'pm', lowPct: 50, highPct: 75 }),
  rule('MMR-008', { kind: 'ctt', lowPct: 3, highPct: 5 }),
  rule('MMR-009', { kind: 'attention', attentionCriterion: 'py_change', parameterValue: 25 }),
  rule('MMR-010', { kind: 'attention', attentionCriterion: 'volatility', parameterValue: 30 }),
  rule('MMR-011', { kind: 'attention', attentionCriterion: 'near_breakeven', parameterValue: 2 }),
  rule('MMR-012', { kind: 'rounding', parameterValue: 1000 }),
];
const GENERIC: MethodologyContext = {
  on: '2025-04-01',
  industryProfile: 'generic',
  circumstances: [],
};

const methodology = resolveMaterialityMethodology(LIBRARY, GENERIC);
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
    const empty = resolveMaterialityMethodology([], GENERIC);
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
    expect(methodology.versionLabel).toContain('MMR-001@1');
    expect(methodology.versionLabel).toContain('test-2026.1');
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

describe('§8 methodology applicability, versions and overrides', () => {
  const NBFC_LOAN = rule('MMR-013', {
    benchmarkKey: 'metric:loan_book',
    benchmarkLabel: 'Loans & advances (loan book)',
    industryProfiles: ['nbfc'],
    considerations: ['Users focus on the loan book.'],
  });
  const NPO_EXP = rule('MMR-014', {
    benchmarkKey: 'expenditure',
    lowPct: 1,
    highPct: 3,
    industryProfiles: ['section8'],
  });
  const INITIAL_PM = rule('MMR-015', {
    kind: 'pm',
    lowPct: 50,
    highPct: 60,
    circumstances: ['initial_audit'],
    overrideAttention: 'immediate_partner',
  });
  const LIB = [...LIBRARY, NBFC_LOAN, NPO_EXP, INITIAL_PM];

  it('applies a rule only to files whose profile / circumstance matches; the most specific wins', () => {
    const generic = resolveMaterialityMethodology(LIB, GENERIC);
    expect(generic.metricBenchmarks).toEqual([]);
    expect(generic.omGuidance.expenditure).toMatchObject({ ruleCode: 'MMR-006', lowPct: 0.5 });
    expect(generic.pmGuidance).toMatchObject({
      ruleCode: 'MMR-007',
      applicability: 'All entities',
    });

    const npo = resolveMaterialityMethodology(LIB, { ...GENERIC, industryProfile: 'section8' });
    expect(npo.omGuidance.expenditure).toMatchObject({
      ruleCode: 'MMR-014',
      lowPct: 1,
      highPct: 3,
      applicability: 'Profile: section8',
    });

    const initial = resolveMaterialityMethodology(
      LIB,
      methodologyContext(
        { industryProfile: 'generic', specialEntityTypes: [], initialAudit: true },
        '2025-04-01',
      ),
    );
    expect(initial.pmGuidance).toMatchObject({
      ruleCode: 'MMR-015',
      highPct: 60,
      overrideAttention: 'immediate_partner',
    });
    expect(initial.versionLabel).toContain('MMR-015@1');
    expect(initial.versionLabel).not.toContain('MMR-007@1');
  });

  it('a methodology-defined metric benchmark becomes a candidate — no % when none is configured', () => {
    const nbfc = resolveMaterialityMethodology(LIB, { ...GENERIC, industryProfile: 'nbfc' });
    expect(nbfc.metricBenchmarks).toEqual([
      { key: 'metric:loan_book', metricKey: 'loan_book', label: 'Loans & advances (loan book)' },
    ]);
    const c = candidatesFor({
      methodology: nbfc,
      metrics: { ...metrics, loan_book: { cy: 300, py: 250 } },
    });
    const loan = cand(c, 'metric:loan_book');
    expect(loan).toMatchObject({
      label: 'Loans & advances (loan book)',
      methodologyDefined: true,
      cy: 300,
      movementLabel: '+20%',
      status: 'available',
      indicativeLowInr: null,
    });
    expect(loan.guidance?.considerations).toEqual(['Users focus on the loan book.']);
    expect(methodologyStatus(2, loan.guidance)).toBe('no_guidance');
    // The built-in six are still offered and never ranked.
    expect(c.filter((x) => !x.methodologyDefined)).toHaveLength(6);
    expect(cand(candidatesFor({ methodology: nbfc }), 'metric:loan_book').status).toBe(
      'insufficient_data',
    );
  });

  it('keeps the version in force on the period date; a retired rule gives no guidance', () => {
    const v2 = { ...LIBRARY[0]!, version: 2, lowPct: 3, effectiveFrom: '2026-04-01' };
    const retired = { ...LIBRARY[2]!, version: 2, active: false, effectiveFrom: '2026-04-01' };
    const lib = [...LIBRARY, v2, retired];
    const before = resolveMaterialityMethodology(lib, GENERIC);
    expect(before.omGuidance.pbt).toMatchObject({ ruleVersion: 1, lowPct: 5 });
    expect(before.omGuidance.revenue).toBeDefined();
    const after = resolveMaterialityMethodology(lib, { ...GENERIC, on: '2026-04-01' });
    expect(after.omGuidance.pbt).toMatchObject({ ruleVersion: 2, lowPct: 3 });
    expect(after.omGuidance.revenue).toBeUndefined();
  });

  it('an override is permitted but raises Partner Attention; an IPA rule raises the §19 override trigger', () => {
    const initial = resolveMaterialityMethodology(
      LIB,
      methodologyContext(
        { industryProfile: 'generic', specialEntityTypes: [], initialAudit: true },
        '2025-04-01',
      ),
    );
    const d = det({
      selectedBenchmark: 'pbt',
      selectedPct: 12,
      selectedOm: 9_840_000,
      omOverrideReason: 'Lender covenant on PBT',
      pmPct: 70,
      selectedPm: 6_888_000,
    });
    const candidates = candidatesFor({ methodology: initial });
    const computed = computeMateriality({
      det: d,
      candidates,
      methodology: initial,
      unitFactor: CRORE,
      aggregation: [],
    });
    expect(computed.omMethodologyStatus).toBe('outside_guidance');
    expect(computed.pmMethodologyStatus).toBe('outside_guidance'); // 70% > 60% initial-audit range
    const triggers = partnerAttentionTriggers({
      det: d,
      candidates,
      computed,
      methodology: initial,
      adjustments: [],
      specific: [],
      qualitative: [],
    });
    const by = (k: string) => triggers.find((t) => t.key === k);
    expect(by('om_outside_guidance')).toMatchObject({
      attention: 'partner_attention',
      ruleCode: 'MMR-001',
      ruleVersion: 1,
    });
    expect(by('om_outside_guidance')?.detail).toContain('Lender covenant on PBT');
    expect(by('ipa_override_om')).toBeUndefined();
    expect(by('pm_outside_guidance')).toMatchObject({ ruleCode: 'MMR-015' });
    expect(by('ipa_override_pm')).toMatchObject({
      attention: 'immediate_partner',
      ruleCode: 'MMR-015',
    });
    expect(by('ipa_override_pm')?.detail).toContain('initial audit');
  });

  it('labels a selected metric benchmark from the methodology in triggers and conclusions', () => {
    const nbfc = resolveMaterialityMethodology(LIB, { ...GENERIC, industryProfile: 'nbfc' });
    const candidates = candidatesFor({
      methodology: nbfc,
      metrics: { ...metrics, pbt: { cy: -2, py: 3 }, loan_book: { cy: 300, py: 250 } },
    });
    const d = det({ selectedBenchmark: 'metric:loan_book', selectedPct: 1 });
    const computed = computeMateriality({
      det: d,
      candidates,
      methodology: nbfc,
      unitFactor: CRORE,
      aggregation: [],
    });
    expect(computed.liveCalculatedOm).toBe(30_000_000);
    expect(computed.omMethodologyStatus).toBe('no_guidance');
    const loss = partnerAttentionTriggers({
      det: d,
      candidates,
      computed,
      methodology: nbfc,
      adjustments: [],
      specific: [],
      qualitative: [],
    }).find((t) => t.key === 'loss_breakeven');
    expect(loss?.detail).toContain('Loans & advances (loan book)');
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

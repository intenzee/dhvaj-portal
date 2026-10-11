import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  AnalyticsLibrary,
  BusinessUnderstandingSummary,
  InvestigationCardRecord,
} from '@hsdg/contracts';
import { V1_LIBRARY } from '../src/modules/statutory-audit/analytics-methodology-v1.fixture';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { approveFrameworkForTest } from './framework-approval.helper';

/**
 * 03.2 Analytics Methodology Library (DHVAJ 03.2 §12, §15, §17, §23) and the
 * analytics side of the §24 acceptance tests: the methodology is versioned
 * data the Methodology Admin maintains; a file runs on the versions in force on
 * its period end and a card keeps the rule code + version it was raised under.
 *
 * Library changes made here are dated in a 2031 window and the file under test
 * ends on 2031-03-31, so other suites sharing the database never see them.
 */
describe('Statutory Audit — 03.2 analytics methodology library (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let mp: string;

  jest.setTimeout(30_000);

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(url).set(bearer(t)).send(body);
  const get = (t: string, url: string) => request(app.getHttpServer()).get(url).set(bearer(t));
  const findId = async (path: string): Promise<string> => {
    const res = await get(mp, path).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const LIB = '/api/v1/planning-analytics-library';

  const newAuditFile = async (financialYear: string) => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Analytics Library ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: itr,
      financialYear,
      periodLabel: `P${stamp()}`,
      status: 'accepted',
    }).expect(201);
    const engId = eng.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    const shells = await get(pa, `/api/v1/engagements/${engId}/statutory-audit`).expect(200);
    const shellId = shells.body[0].workflowInstanceId as string;
    await approveFrameworkForTest(shellId);
    return `/api/v1/engagements/${engId}/statutory-audit/${shellId}`;
  };

  const summary = async (base: string): Promise<BusinessUnderstandingSummary> =>
    (await get(pa, `${base}/business-understanding`).expect(200)).body;
  const cards = async (base: string): Promise<InvestigationCardRecord[]> =>
    (await get(pa, `${base}/analytics-exceptions`).expect(200)).body;
  const ratio = (s: BusinessUnderstandingSummary, key: string) =>
    s.analytics.ratios.find((r) => r.key === key);
  const setProfile = async (base: string, industryProfile: string, status: number) => {
    const s = await summary(base);
    return post(pa, `${base}/business-understanding`, {
      industryProfile,
      version: s.record.version,
    }).expect(status);
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('seeds the v1 library exactly as the methodology fixture', async () => {
    const lib = (await get(mp, LIB).expect(200)).body as AnalyticsLibrary;
    const strip = <T extends object>(rows: T[]) =>
      rows
        .filter((r) => (r as { version: number }).version === 1)
        .map((r) => {
          const { id, changeNote, createdByName, createdAt, ...rest } = r as T & {
            id: string;
            changeNote: string | null;
            createdByName: string | null;
            createdAt: string;
          };
          void id;
          void changeNote;
          void createdByName;
          void createdAt;
          return rest;
        });
    const byKey = <T>(rows: T[], k: keyof T) =>
      [...rows].sort((a, b) => String(a[k]).localeCompare(String(b[k])));
    expect(byKey(strip(lib.metrics), 'metricKey')).toEqual(byKey(V1_LIBRARY.metrics, 'metricKey'));
    expect(byKey(strip(lib.profiles), 'profileKey')).toEqual(
      byKey(V1_LIBRARY.profiles, 'profileKey'),
    );
    expect(byKey(strip(lib.rules), 'ruleCode')).toEqual(byKey(V1_LIBRARY.rules, 'ruleCode'));
  });

  it('is methodology administration only — no access without service.manage', async () => {
    await get(pa, LIB).expect(403);
    await post(pa, `${LIB}/rules`, {
      ruleCode: 'PAR-999',
      ruleKey: 'nope',
      name: 'x',
      kind: 'movement',
      formula: 'x',
      definition: { kind: 'movement', metric: 'revenue' },
      changeNote: 'not allowed',
    }).expect(403);
  });

  it('rejects revenue-based inventory days and non-neutral wording', async () => {
    const lib = (await get(mp, LIB).expect(200)).body as AnalyticsLibrary;
    const inv = lib.rules.find((r) => r.ruleKey === 'inventory_days')!;
    const bad = await post(mp, `${LIB}/rules`, {
      ruleCode: inv.ruleCode,
      name: inv.name,
      kind: 'ratio',
      formula: 'Inventory / Revenue × 365',
      definition: {
        kind: 'ratio',
        num: { metric: 'inventory' },
        den: { metric: 'revenue' },
        scale: 365,
        unit: 'days',
      },
      changeNote: 'should be refused',
    }).expect(400);
    expect(bad.body.message).toMatch(/never Revenue/);
    const prof = await post(mp, `${LIB}/profiles`, {
      profileKey: 'generic',
      label: 'Generic',
      debtMetrics: ['total_borrowings'],
      financeCostBasis: 'closing',
      inventoryCostBases: ['revenue'],
      payableCostBases: ['purchases'],
      changeNote: 'should be refused',
    }).expect(400);
    expect(prof.body.message).toMatch(/never Revenue/);
    const mov = lib.rules.find((r) => r.ruleKey === 'movement_revenue')!;
    const loaded = await post(mp, `${LIB}/rules`, {
      ruleCode: mov.ruleCode,
      name: mov.name,
      kind: mov.kind,
      formula: mov.formula,
      definition: mov.definition,
      requiredMetrics: mov.requiredMetrics,
      parameterType: mov.parameterType,
      parameterValue: mov.parameterValue,
      signalWording: mov.signalWording,
      whyMayMatter: 'This is a material misstatement.',
      changeNote: 'should be refused',
    }).expect(400);
    expect(loaded.body.message).toMatch(/neutral/);
  });

  it('§24 analytics on a file: calculations, neutral cards, profiles and versioned rules', async () => {
    const base = await newAuditFile('2030-31');
    const s0 = await summary(base);
    await post(pa, `${base}/financial-dataset`, {
      periodEnd: '2031-03-31',
      pyPeriodEnd: '2030-03-31',
      currency: 'INR',
      units: 'inr_crore',
      dataStatus: 'final',
      version: s0.dataset.version,
    }).expect(201);
    const fig = (metricKey: string, cy: number, py: number) => [
      { metricKey, period: 'cy', amount: cy, sourceType: 'draft_fs', version: 0 },
      { metricKey, period: 'py', amount: py, sourceType: 'audited_py_fs', version: 0 },
    ];
    await post(pa, `${base}/financial-dataset/values`, {
      values: [
        ...fig('revenue', 82, 54),
        ...fig('trade_receivables', 29, 14),
        ...fig('inventory', 10, 8),
        ...fig('other_income', 5, 0),
      ],
    }).expect(201);

    // Calculations: % movement, N/M on a nil prior year, never revenue for inventory days.
    const s1 = await summary(base);
    const mv = (k: string) => s1.analytics.movements.find((m) => m.metricKey === k)!;
    expect(mv('revenue').percentLabel).toBe('+51.9%');
    expect(mv('other_income').percentLabel).toBe('N/M');
    expect(ratio(s1, 'inventory_days')!.status).toBe('insufficient_data');
    expect(ratio(s1, 'inventory_days')!.inputs.map((i) => i.metricKey)).not.toContain('revenue');
    expect(s1.analyticsMethodology).toEqual(
      expect.objectContaining({
        profileKey: 'generic',
        methodologyVersion: 'dhvaj-analytics-2026.1',
        resolvedOn: '2031-03-31',
        debtDefinition: 'Total borrowings',
        financeCostBasis: 'closing',
        staleCards: 0,
      }),
    );
    expect(s1.analytics.rules.find((r) => r.ruleKey === 'movement_revenue')!.outcome).toBe(
      'flagged',
    );

    // The §13 receivables card: neutral wording, rule code + version stored.
    const rel = (await cards(base)).find((c) => c.ruleKey === 'rel_revenue_receivables')!;
    expect(rel.observation).toContain('+107.1%');
    expect(`${rel.observation} ${rel.whyFlagged}`.toLowerCase()).not.toMatch(
      /misstat|significant risk|audit risk/,
    );
    expect(rel).toEqual(
      expect.objectContaining({
        ruleCode: expect.stringMatching(/^PAR-\d{3}$/),
        ruleVersion: 1,
        methodologyVersion: 'dhvaj-analytics-2026.1',
        whyMayMatter: expect.any(String),
      }),
    );

    // Industry profile changes the analytics, not the data model.
    await setProfile(base, 'nbfc', 201);
    const nbfc = await summary(base);
    expect(ratio(nbfc, 'receivable_days')!.status).toBe('not_applicable');
    expect(nbfc.industryConsiderations.length).toBeGreaterThan(0);
    expect(nbfc.analyticsMethodology.financeCostBasis).toBe('average');
    expect(
      (await cards(base)).find((c) => c.ruleKey === 'rel_revenue_receivables')!.noLongerFlagged,
    ).toBe(true);
    await setProfile(base, 'no_such_profile', 400);
    await setProfile(base, 'generic', 201);

    // The Methodology Admin re-parameterises the revenue rule for 2031 periods:
    // it may now suggest Immediate Partner Attention.
    const lib = (await get(mp, LIB).expect(200)).body as AnalyticsLibrary;
    const mov = lib.rules.find((r) => r.ruleKey === 'movement_revenue' && r.version === 1)!;
    const v2 = await post(mp, `${LIB}/rules`, {
      ruleCode: mov.ruleCode,
      name: mov.name,
      kind: mov.kind,
      formula: mov.formula,
      definition: mov.definition,
      requiredMetrics: mov.requiredMetrics,
      parameterType: mov.parameterType,
      parameterValue: 10,
      enhancedAt: 30,
      immediateAt: 45,
      signalWording: mov.signalWording,
      whyMayMatter: mov.whyMayMatter,
      affectedAreas: mov.affectedAreas,
      effectiveFrom: '2031-01-01',
      effectiveTo: '2031-12-31',
      methodologyVersion: 'dhvaj-analytics-2031.1',
      changeNote: 'e2e — 2031 revenue parameter',
    }).expect(201);
    expect(v2.body.version).toBe(2);

    const stale = await summary(base);
    expect(stale.analyticsMethodology.staleCards).toBeGreaterThanOrEqual(1);
    const before = (await cards(base)).find((c) => c.ruleKey === 'movement_revenue')!;
    expect(before.ruleVersion).toBe(1);

    const refreshed = await post(pa, `${base}/analytics/refresh`, {}).expect(201);
    expect(refreshed.body.analyticsMethodology.staleCards).toBe(0);
    const after = (await cards(base)).find((c) => c.ruleKey === 'movement_revenue')!;
    expect(after).toEqual(
      expect.objectContaining({
        ruleCode: mov.ruleCode,
        ruleVersion: 2,
        methodologyVersion: 'dhvaj-analytics-2031.1',
        suggestedAttention: 'immediate_partner',
      }),
    );
  });

  it('a new industry profile adds sector metrics and analytics as data', async () => {
    const window = { effectiveFrom: '2031-01-01', effectiveTo: '2031-12-31' };
    await post(mp, `${LIB}/profiles`, {
      profileKey: 'hospitality_e2e',
      label: 'Hospitality (e2e)',
      description: 'Hotels and resorts',
      subIndustries: ['Business hotels', 'Resorts'],
      considerations: ['Seasonality of occupancy'],
      debtMetrics: ['total_borrowings', 'lease_liabilities'],
      financeCostBasis: 'average',
      inventoryCostBases: ['cost_of_sales'],
      payableCostBases: ['purchases'],
      inventoryTrendFallback: null,
      ...window,
      changeNote: 'e2e — hospitality profile',
    }).expect(201);
    await post(mp, `${LIB}/metrics`, {
      metricKey: 'room_nights_e2e',
      label: 'Room nights sold',
      valueType: 'count',
      appliesTo: ['hospitality_e2e'],
      ...window,
      changeNote: 'e2e — sector metric',
    }).expect(201);
    const lib = (await get(mp, LIB).expect(200)).body as AnalyticsLibrary;
    const used = new Set(lib.rules.map((r) => r.ruleCode));
    let n = 1;
    while (used.has(`PAR-${String(n).padStart(3, '0')}`)) n += 1;
    await post(mp, `${LIB}/rules`, {
      ruleCode: `PAR-${String(n).padStart(3, '0')}`,
      ruleKey: 'revenue_per_room_night_e2e',
      name: 'Revenue per room night',
      kind: 'ratio',
      formula: 'Revenue / Room nights sold',
      definition: {
        kind: 'ratio',
        num: { metric: 'revenue' },
        den: { metric: 'room_nights_e2e' },
        scale: 1,
        unit: 'per_unit',
      },
      requiredMetrics: ['revenue', 'room_nights_e2e'],
      appliesTo: ['hospitality_e2e'],
      ...window,
      changeNote: 'e2e — sector ratio',
    }).expect(201);

    const base = await newAuditFile('2030-31');
    const s0 = await summary(base);
    // The period end rolls forward from the FY: the 2031 profile is offered.
    expect(s0.dataset.periodEnd).toBe('2031-03-31');
    expect(s0.industryProfiles.map((p) => p.key)).toContain('hospitality_e2e');
    // Not offered for a period outside its effective window.
    await post(pa, `${base}/financial-dataset`, {
      periodEnd: '2032-03-31',
      currency: 'INR',
      units: 'inr_lakh',
      dataStatus: 'draft',
      version: s0.dataset.version,
    }).expect(201);
    const outside = await summary(base);
    expect(outside.industryProfiles.map((p) => p.key)).not.toContain('hospitality_e2e');
    await post(pa, `${base}/financial-dataset`, {
      periodEnd: '2031-03-31',
      version: outside.dataset.version,
    }).expect(201);
    expect((await summary(base)).industryProfiles.map((p) => p.key)).toContain('hospitality_e2e');
    await setProfile(base, 'hospitality_e2e', 201);
    const s1 = await summary(base);
    expect(s1.subIndustryOptions).toEqual(['Business hotels', 'Resorts']);
    expect(s1.industryConsiderations).toEqual(['Seasonality of occupancy']);
    expect(s1.analyticsMethodology.debtDefinition).toBe('Total borrowings + Lease liabilities');
    expect(s1.analyticsMethodology.metrics.map((m) => m.key)).toContain('room_nights_e2e');

    await post(pa, `${base}/financial-dataset/values`, {
      values: [
        { metricKey: 'revenue', period: 'cy', amount: 900, sourceType: 'draft_fs', version: 0 },
        {
          metricKey: 'room_nights_e2e',
          period: 'cy',
          amount: 12000,
          sourceType: 'draft_fs',
          version: 0,
        },
      ],
    }).expect(201);
    const s2 = await summary(base);
    expect(ratio(s2, 'revenue_per_room_night_e2e')!.cy).toBeCloseTo(0.08, 4);
    expect(s2.analytics.warnings.map((w) => w.code)).toContain('unaudited_data');

    // A metric outside the file's profile is refused.
    await post(pa, `${base}/financial-dataset/values`, {
      values: [
        { metricKey: 'loan_book', period: 'cy', amount: 1, sourceType: 'draft_fs', version: 0 },
      ],
    }).expect(400);
  });
});

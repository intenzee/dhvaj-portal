import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import type {
  MaterialityMethodologyLibrary,
  MaterialitySummary,
  PlanningGovernanceView,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { approveFrameworkForTest } from './framework-approval.helper';

/**
 * 03.3 Materiality Methodology Library and Partner Attention feed (DHVAJ 03.3
 * §8, §19, §23, §24, §25): the guidance is versioned data the Methodology Admin
 * maintains; a file shows the rules in force for its audit period, labelled as
 * DHVAJ guidance with their rule code and version; a methodology-defined
 * candidate appears only where its rule applies; an override raises Partner
 * Attention on the Partner Planning View and notifies the EP once per trigger
 * per determination version.
 *
 * Library versions added here start in 2033 and only the file under test runs
 * in that window (engagement FY 2034-35), so other suites sharing the database never see them.
 */
describe('Statutory Audit — 03.3 materiality methodology library (e2e)', () => {
  let app: INestApplication;
  let pa: string; // Engagement Partner
  let mx: string; // Engagement Manager
  let mp: string; // Methodology Admin (service.manage)
  let su: Client;
  let managerId: string;

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
  const findId = async (path: string): Promise<string> =>
    (await get(mp, path).expect(200)).body.items[0].id as string;
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const LIB = '/api/v1/materiality-methodology-library';

  const newAuditFile = async (financialYear: string) => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Materiality Library ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: stat,
      financialYear,
      periodLabel: `P${stamp()}`,
      status: 'accepted',
      engagementManagerEmployeeId: managerId,
    }).expect(201);
    const engId = eng.body.id as string;
    const shells = await get(pa, `/api/v1/engagements/${engId}/statutory-audit`).expect(200);
    const shellId = shells.body[0].workflowInstanceId as string;
    await approveFrameworkForTest(shellId);
    return { engId, shellId, base: `/api/v1/engagements/${engId}/statutory-audit/${shellId}` };
  };

  const materiality = async (base: string): Promise<MaterialitySummary> =>
    (await get(mx, `${base}/materiality`).expect(200)).body as MaterialitySummary;
  const save = async (base: string, body: Record<string, unknown>) => {
    const s = await materiality(base);
    return (
      await post(mx, `${base}/materiality`, { ...body, version: s.determination.version }).expect(
        201,
      )
    ).body as MaterialitySummary;
  };
  const setProfile = async (base: string, industryProfile: string) => {
    const bu = (await get(mx, `${base}/business-understanding`).expect(200)).body;
    await post(mx, `${base}/business-understanding`, {
      industryProfile,
      version: bu.record.version,
    }).expect(201);
  };
  const setDataset = async (base: string, values: Array<{ metricKey: string; amount: number }>) => {
    const bu = (await get(mx, `${base}/business-understanding`).expect(200)).body;
    await post(mx, `${base}/financial-dataset`, {
      periodEnd: '2024-03-31',
      currency: 'INR',
      units: 'inr_lakh',
      dataStatus: 'final',
      version: bu.dataset.version ?? 0,
    }).expect(201);
    await post(mx, `${base}/financial-dataset/values`, {
      values: values.map((v) => ({ ...v, period: 'cy', sourceType: 'draft_fs', version: 0 })),
    }).expect(201);
  };
  const epNotes = async (engId: string): Promise<string[]> => {
    const { rows } = await su.query<{ title: string }>(
      `SELECT n.title FROM hsdg.notifications n JOIN hsdg.users u ON u.id = n.recipient_user_id
        WHERE u.email = 'partner.a@dhvaj.in' AND n.type = 'planning_partner_attention'
          AND n.engagement_id = $1 ORDER BY n.created_at`,
      [engId],
    );
    return rows.map((r) => r.title);
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    mp = await token('mp@dhvaj.in');
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    const { rows } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE full_name = 'Manager X'`,
    );
    managerId = rows[0]!.id;
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('is methodology administration only, and append-only', async () => {
    await get(pa, LIB).expect(403);
    await post(pa, `${LIB}/rules`, {
      ruleCode: 'MMR-007',
      kind: 'pm',
      name: 'x',
      sourceBasis: 'x',
      changeNote: 'not allowed',
    }).expect(403);

    const lib = (await get(mp, LIB).expect(200)).body as MaterialityMethodologyLibrary;
    const v1 = lib.rules.filter((r) => r.version === 1);
    expect(v1.map((r) => r.ruleCode).sort()).toEqual(
      Array.from({ length: 15 }, (_, i) => `MMR-${String(i + 1).padStart(3, '0')}`),
    );
    expect(v1.every((r) => r.provisional && r.sourceBasis.length > 0)).toBe(true);
    expect(lib.rules.find((r) => r.ruleCode === 'MMR-013')).toMatchObject({
      benchmarkKey: 'metric:loan_book',
      industryProfiles: ['nbfc'],
    });

    // The app role can never rewrite or delete a version.
    const appDb = new Client({ connectionString: process.env.DATABASE_URL });
    await appDb.connect();
    try {
      await expect(
        appDb.query(`UPDATE hsdg.materiality_methodology_rule SET low_pct = 1`),
      ).rejects.toThrow(/permission denied/);
      await expect(appDb.query(`DELETE FROM hsdg.materiality_methodology_rule`)).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await appDb.end();
    }

    // A rule's kind is fixed; a metric benchmark must be an amount metric.
    await post(mp, `${LIB}/rules`, {
      ruleCode: 'MMR-007',
      kind: 'ctt',
      name: 'x',
      lowPct: 1,
      highPct: 2,
      sourceBasis: 'x',
      changeNote: 'change kind',
    }).expect(400);
    await post(mp, `${LIB}/rules`, {
      ruleCode: 'MMR-099',
      kind: 'om_benchmark',
      name: 'Capital adequacy',
      benchmarkKey: 'metric:capital_adequacy',
      benchmarkLabel: 'CRAR',
      sourceBasis: 'x',
      changeNote: 'percent metric',
    }).expect(400);
  });

  it('§24 guidance on a file: labelled DHVAJ guidance, versioned, applicable by profile', async () => {
    const f = await newAuditFile('2024-25');
    let s = await materiality(f.base);
    // Guidance is DHVAJ methodology with its rule code and version — never an SA %.
    expect(s.methodology.pmGuidance).toMatchObject({
      ruleCode: 'MMR-007',
      ruleVersion: 1,
      lowPct: 50,
      highPct: 75,
      provisional: true,
      methodologyVersion: 'dhvaj-materiality-2026.1',
      applicability: 'All entities',
    });
    expect(s.methodology.omGuidance.pbt?.ruleCode).toBe('MMR-001');
    expect(s.methodology.anyProvisional).toBe(true);
    expect(s.methodology.versionLabel).toMatch(/dhvaj-materiality-2026\.1 · .*MMR-007@1/);
    expect(s.authorityAnchors).toEqual(
      expect.arrayContaining(['view_sa_320', 'view_sa_450', 'view_ig_materiality']),
    );
    // A methodology-defined candidate appears only where its rule applies.
    expect(s.candidates.map((c) => c.key)).not.toContain('metric:loan_book');
    await post(mx, `${f.base}/materiality`, {
      selectedBenchmark: 'metric:loan_book',
      version: s.determination.version,
    }).expect(400);

    await setProfile(f.base, 'nbfc');
    await setDataset(f.base, [{ metricKey: 'loan_book', amount: 5000 }]);
    s = await materiality(f.base);
    const loan = s.candidates.find((c) => c.key === 'metric:loan_book');
    expect(loan).toMatchObject({
      methodologyDefined: true,
      label: 'Loans & advances (loan book)',
      cy: 5000,
      amountInr: 5000 * 100_000, // ₹ lakh
    });
    expect(s.methodology.omGuidance['metric:loan_book']?.applicability).toBe('Profile: nbfc');
    s = await save(f.base, { selectedBenchmark: 'metric:loan_book' });
    expect(s.determination.selectedBenchmark).toBe('metric:loan_book');
    // The determination keeps the methodology versions it was prepared under.
    expect(s.determination.methodologyVersion).toBe(s.methodology.versionLabel);
  });

  it('§19 overrides reach the Partner Planning View and notify the EP once', async () => {
    const f = await newAuditFile('2024-25');
    await materiality(f.base);

    // PM outside the MMR-007 range: permitted with a rationale, Partner Attention.
    let s = await save(f.base, { pmPct: 90, pmOverrideReason: 'Low-risk, well-controlled entity' });
    expect(s.partnerAttention.find((t) => t.key === 'pm_outside_guidance')).toMatchObject({
      attention: 'partner_attention',
      ruleCode: 'MMR-007',
      ruleVersion: 1,
    });
    let gov = (await get(pa, `${f.base}/planning-governance`).expect(200))
      .body as PlanningGovernanceView;
    let items = gov.partnerAttention.items.filter((i) => i.kind === 'materiality');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      code: 'MT-001',
      attention: null, // Partner Attention; only IPA carries a 03.1 attention level
      targetId: s.determination.id,
      status: 'surfaced',
    });
    expect(items[0]!.title).toMatch(/^v1\.0 — Selected PM outside DHVAJ methodology guidance/);
    expect(await epNotes(f.engId)).toHaveLength(1);

    // Saving again (same trigger, same version) never re-notifies.
    await save(f.base, { pmRationale: 'Few prior misstatements' });
    expect(await epNotes(f.engId)).toHaveLength(1);

    // An initial audit brings MMR-015 into force: its override is an Immediate
    // Partner Attention methodology prompt.
    const upd = await su.query(
      `UPDATE hsdg.audit_entity_profile SET initial_audit = true WHERE workflow_instance_id = $1`,
      [f.shellId],
    );
    expect(upd.rowCount).toBe(1);
    s = await save(f.base, { pmPct: 85 });
    expect(s.methodology.pmGuidance).toMatchObject({
      ruleCode: 'MMR-015',
      overrideAttention: 'immediate_partner',
    });
    expect(s.partnerAttention.find((t) => t.key === 'ipa_override_pm')).toMatchObject({
      attention: 'immediate_partner',
      label: 'Manager overrides an Immediate Partner Attention methodology prompt (PM)',
    });
    gov = (await get(pa, `${f.base}/planning-governance`).expect(200))
      .body as PlanningGovernanceView;
    items = gov.partnerAttention.items.filter((i) => i.kind === 'materiality');
    expect(items.map((i) => [i.code, i.attention])).toEqual(
      expect.arrayContaining([
        ['MT-001', null],
        ['MT-002', 'immediate_partner'],
      ]),
    );
    const notes = await epNotes(f.engId);
    expect(notes).toHaveLength(2);
    expect(notes[1]).toMatch(/03\.3 Materiality v1\.0/);

    // Back inside the guidance: the items leave the queue.
    await save(f.base, { pmPct: 60 });
    gov = (await get(pa, `${f.base}/planning-governance`).expect(200))
      .body as PlanningGovernanceView;
    expect(gov.partnerAttention.items.filter((i) => i.kind === 'materiality')).toHaveLength(0);
    expect(await epNotes(f.engId)).toHaveLength(2);
  });

  it('a file runs on the rule versions in force for its audit period', async () => {
    const lib = (await get(mp, LIB).expect(200)).body as MaterialityMethodologyLibrary;
    const pm = lib.rules.find((r) => r.ruleCode === 'MMR-007' && r.version === 1)!;
    const added = await post(mp, `${LIB}/rules`, {
      ruleCode: 'MMR-007',
      kind: 'pm',
      name: pm.name,
      lowPct: 60,
      highPct: 80,
      considerations: pm.considerations,
      sourceBasis: 'DHVAJ methodology — approved range',
      provisional: false,
      effectiveFrom: '2033-04-01',
      methodologyVersion: 'dhvaj-materiality-2033.1',
      changeNote: 'e2e — approved PM range from FY 2033-34',
    }).expect(201);
    const version = added.body.version as number;
    expect(version).toBeGreaterThan(1);

    const later = await newAuditFile('2034-35'); // audit period 2033-04-01 – 2034-03-31
    const s = await materiality(later.base);
    expect(s.methodology.pmGuidance).toMatchObject({
      ruleCode: 'MMR-007',
      ruleVersion: version,
      lowPct: 60,
      highPct: 80,
      provisional: false,
      methodologyVersion: 'dhvaj-materiality-2033.1',
    });
    // An earlier file keeps the version in force for its own period.
    const earlier = await newAuditFile('2024-25');
    expect((await materiality(earlier.base)).methodology.pmGuidance).toMatchObject({
      ruleCode: 'MMR-007',
      ruleVersion: 1,
      lowPct: 50,
    });
  });
});

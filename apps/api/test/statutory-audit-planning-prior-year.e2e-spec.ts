import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Section 03 planning carried forward from last year's audit file (Guide §1):
 * 03.1 intelligence generates itself and brings last year's significant risks
 * and Areas of Focus forward as prior-year matters; 03.2 seeds unsaved sections
 * and the prior-year figures from last year's 03.2; 03.3 fills the prior-year
 * materiality; 03.4 builds its population on first open.
 */
describe('Statutory Audit — Section 03 from last year’s file (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let mp: string;

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
  const get = (url: string) => request(app.getHttpServer()).get(url).set(bearer(pa)).expect(200);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const newAuditFile = async (
    entityId: string,
    financialYear: string,
  ): Promise<{ engId: string; shellId: string; base: string }> => {
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId,
      serviceId: itr,
      financialYear,
      periodLabel: `P${stamp()}`,
      status: 'accepted',
    }).expect(201);
    const engId = eng.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    const shells = await get(`/api/v1/engagements/${engId}/statutory-audit`);
    const shellId = shells.body[0].workflowInstanceId as string;
    return { engId, shellId, base: `/api/v1/engagements/${engId}/statutory-audit/${shellId}` };
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

  it('opens this year’s planning already carrying last year’s file', async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Planning Carry ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const entityId = entity.body.id as string;

    // ── Last year's file ──────────────────────────────────────────────────
    const py = await newAuditFile(entityId, '2023-24');
    await post(pa, `${py.base}/risks`, {
      description: 'Revenue recognised before delivery',
      source: 'fraud',
      rating: 'significant',
      isSignificant: true,
      isFraudRisk: true,
      fsArea: 'Revenue',
    }).expect(201);
    await post(pa, `${py.base}/areas-of-focus`, {
      name: 'Inventory valuation',
      whyRequiresAttention: 'Slow-moving stock',
      partnerAttention: true,
    }).expect(201);

    const bu = await get(`${py.base}/business-understanding`);
    const systems = (bu.body.sections as Array<{ key: string; version: number }>).find(
      (x) => x.key === 'systems',
    );
    await post(pa, `${py.base}/business-understanding/sections/systems`, {
      answers: { erp: 'Tally Prime', finance_org: 'Centralised' },
      version: systems?.version ?? 0,
    }).expect(201);
    await post(pa, `${py.base}/financial-dataset`, {
      periodEnd: '2024-03-31',
      currency: 'INR',
      units: 'inr_lakh',
      dataStatus: 'final',
      version: bu.body.dataset.version ?? 0,
    }).expect(201);
    await post(pa, `${py.base}/financial-dataset/values`, {
      values: [
        { metricKey: 'revenue', period: 'cy', amount: 1250, sourceType: 'draft_fs', version: 0 },
      ],
    }).expect(201);

    // A completed prior-year materiality (written directly: the 03.3 completion
    // flow is covered by its own suite).
    const db = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await db.connect();
    try {
      await db.query(
        `INSERT INTO hsdg.audit_materiality_determination
           (workflow_instance_id, engagement_id, version_no, status, principal_users,
            selected_benchmark, selected_om, selected_pm, selected_ctt)
         VALUES ($1, $2, 1, 'complete', '{lenders}', 'revenue', 1000000, 750000, 50000)`,
        [py.shellId, py.engId],
      );
    } finally {
      await db.end();
    }

    // ── This year's file ──────────────────────────────────────────────────
    const cy = await newAuditFile(entityId, '2024-25');

    const pi = await get(`${cy.base}/planning-intelligence`);
    expect(pi.body.record.intelligenceGeneratedAt).toBeTruthy(); // no "Generate" click
    const pym = await get(`${cy.base}/prior-year-matters`);
    expect(
      (pym.body as Array<{ matterType: string; description: string; sourceEvidence: string }>).map(
        (m) => [m.matterType, m.description],
      ),
    ).toEqual([
      [
        'significant_risk',
        'Significant (fraud) risk — Revenue: Revenue recognised before delivery',
      ],
      ['partner_focus_area', 'Inventory valuation — Slow-moving stock'],
    ]);
    // Re-importing never duplicates.
    const again = await post(pa, `${cy.base}/prior-year-matters/import`, {}).expect(201);
    expect(again.body.added).toBe(0);
    expect(again.body.matters).toHaveLength(2);

    const cbu = await get(`${cy.base}/business-understanding`);
    const cySystems = (
      cbu.body.sections as Array<{ key: string; answers: Record<string, unknown> }>
    ).find((x) => x.key === 'systems');
    expect(cySystems?.answers).toEqual(
      expect.objectContaining({ erp: 'Tally Prime', finance_org: 'Centralised' }),
    );
    const pyRevenue = (
      cbu.body.values as Array<{
        metricKey: string;
        period: string;
        amount: number;
        sourceType: string;
      }>
    ).find((v) => v.metricKey === 'revenue' && v.period === 'py');
    expect(pyRevenue).toEqual(
      expect.objectContaining({ amount: 1250, sourceType: 'audited_py_fs' }),
    );
    expect(cbu.body.dataset.units).toBe('inr_lakh');

    const mat = await get(`${cy.base}/materiality`);
    expect(mat.body.determination.pyOverallMateriality).toBe(1000000);
    expect(mat.body.determination.principalUsers).toEqual(['lenders']);

    const scope = await get(`${cy.base}/scope-approach`);
    expect(scope.body.units.length).toBeGreaterThan(0);
  });
});

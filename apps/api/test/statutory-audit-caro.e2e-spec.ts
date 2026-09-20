import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CARO_OUTCOME, type StatutoryAuditCaro } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.4 CARO 2020 Applicability — end-to-end (Implementation Guide §9.4). Drives
 * the shared sub-assessment through the API: assemble the direct-exemption facts
 * from 02.1, capture the CARO-measurement facts, run the engine, record the
 * professional conclusion, and the §35 outsider check.
 */
describe('Statutory Audit — 02.4 CARO 2020 (e2e §9.4)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePeriod = (): string => `P${Date.now()}${Math.floor(Math.random() * 1000)}`;

  let mp: string;
  let pa: string;
  let pb: string;
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  let engId: string;
  let shellId: string;
  const base = () => `/api/v1/engagements/${engId}/statutory-audit`;

  const getCaro = async (t: string): Promise<StatutoryAuditCaro> => {
    const res = await request(app.getHttpServer()).get(`${base()}/caro`).set(bearer(t)).expect(200);
    return res.body[0] as StatutoryAuditCaro;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const created = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId: primaryServiceId,
        financialYear: '2024-25',
        periodLabel: uniquePeriod(),
        status: 'accepted',
      })
      .expect(201);
    engId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);
    const shells = await request(app.getHttpServer()).get(base()).set(bearer(pa)).expect(200);
    shellId = shells.body[0].workflowInstanceId as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('provisions one 02.4 assessment; without the CARO facts it is information-insufficient', async () => {
    const caro = await getCaro(pa);
    expect(caro.assessment.subSectionKey).toBe('02.4');
    // The seeded "Bharat" entity is a private company; with no captured numbers the
    // cumulative test cannot run yet.
    expect(caro.assessment.systemOutcome).toBe(CARO_OUTCOME.informationInsufficient);
  });

  it('captures the CARO facts and applies when a limit is exceeded', async () => {
    const before = await getCaro(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/facts`)
      .set(bearer(pa))
      .send({
        isHoldingOrSubsidiaryOfPublic: false,
        capitalPlusReserves: 5000000, // ₹0.5cr
        peakBankFiBorrowings: 5000000, // ₹0.5cr
        totalRevenue: 150000000, // ₹15cr — exceeds the ₹10cr limit
        version: before.assessment.version,
      })
      .expect(201);
    const caro = res.body[0] as StatutoryAuditCaro;
    expect(caro.capturedFacts.totalRevenue).toBe(150000000);
    expect(caro.assessment.systemOutcome).toBe(CARO_OUTCOME.applicable);
    expect(caro.detail!.level1Applies).toBe(true);
    expect(caro.detail!.instantiatesClauseProgramme).toBe(true);
    expect(caro.assessment.authorityProvisionId).toBeTruthy(); // CARO_2020 frozen period-correct
  });

  it('records the professional conclusion, and rejects a stale-version write (409)', async () => {
    const caro = await getCaro(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({ conclusion: CARO_OUTCOME.applicable, version: caro.assessment.version })
      .expect(201);
    const decided = res.body[0] as StatutoryAuditCaro;
    expect(decided.assessment.conclusion).toBe(CARO_OUTCOME.applicable);
    expect(decided.assessment.state).toBe('applicable');

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({ conclusion: CARO_OUTCOME.notApplicableExempt, version: caro.assessment.version })
      .expect(409);
  });

  it('overriding to Not-Applicable without a basis is rejected (§19)', async () => {
    const caro = await getCaro(pa);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({ conclusion: CARO_OUTCOME.notApplicableExempt, version: caro.assessment.version })
      .expect(400); // differs from the system's "applicable" → basis required
  });

  it('records an immutable audit event for the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?objectType=audit_framework_subassessment&limit=50`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.caro_decision');
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.4 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/caro`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/run-suggestions`)
      .set(bearer(pb))
      .expect(404);
  });
});

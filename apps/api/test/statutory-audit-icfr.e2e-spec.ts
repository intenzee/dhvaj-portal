import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ICFR_OUTCOME, type StatutoryAuditIcfr } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.5 Internal Financial Controls / ICFR Reporting — end-to-end (Guide §9.5).
 * Drives the shared sub-assessment through the API: assemble classification from
 * 02.1, capture the ICFR facts, run the engine, record the professional
 * conclusion, and the §35 outsider check.
 */
describe('Statutory Audit — 02.5 ICFR (e2e §9.5)', () => {
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

  const getIcfr = async (t: string): Promise<StatutoryAuditIcfr> => {
    const res = await request(app.getHttpServer()).get(`${base()}/icfr`).set(bearer(t)).expect(200);
    return res.body[0] as StatutoryAuditIcfr;
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

    // Give ICFR a turnover figure via the 02.1 profile (reused, not re-asked).
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'turnover', currentValue: 800000000 }) // ₹80cr
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('provisions one 02.5 assessment; a private company over the turnover limit → applicable', async () => {
    // "Bharat" is a private company; ₹80cr turnover already exceeds the ₹50cr limit,
    // so even before capturing borrowings the exemption cannot hold.
    const icfr = await getIcfr(pa);
    expect(icfr.assessment.subSectionKey).toBe('02.5');
    expect(icfr.assessment.systemOutcome).toBe(ICFR_OUTCOME.applicable);
    expect(icfr.detail!.reportingApplies).toBe(true);
    expect(icfr.detail!.controlsPhaseUnaffected).toBe(true);
  });

  it('captures the ICFR facts and a filing default keeps it applicable', async () => {
    const before = await getIcfr(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/facts`)
      .set(bearer(pa))
      .send({
        peakCoveredBorrowings: 100000000,
        filingDefault: true,
        version: before.assessment.version,
      })
      .expect(201);
    const icfr = res.body[0] as StatutoryAuditIcfr;
    expect(icfr.capturedFacts.filingDefault).toBe(true);
    expect(icfr.assessment.systemOutcome).toBe(ICFR_OUTCOME.applicable);
    expect(icfr.assessment.authorityProvisionId).toBeTruthy(); // §143(3)(i) frozen period-correct
  });

  it('records the professional conclusion, and rejects a stale-version write (409)', async () => {
    const icfr = await getIcfr(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/decision`)
      .set(bearer(pa))
      .send({ conclusion: ICFR_OUTCOME.applicable, version: icfr.assessment.version })
      .expect(201);
    const decided = res.body[0] as StatutoryAuditIcfr;
    expect(decided.assessment.conclusion).toBe(ICFR_OUTCOME.applicable);
    expect(decided.assessment.state).toBe('applicable');

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/decision`)
      .set(bearer(pa))
      .send({ conclusion: ICFR_OUTCOME.exempt, version: icfr.assessment.version })
      .expect(409);
  });

  it('overriding to Exempt without a basis is rejected (§19)', async () => {
    const icfr = await getIcfr(pa);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/decision`)
      .set(bearer(pa))
      .send({ conclusion: ICFR_OUTCOME.exempt, version: icfr.assessment.version })
      .expect(400); // differs from the system's "applicable" → basis required
  });

  it('records an immutable audit event for the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?objectType=audit_framework_subassessment&limit=50`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.icfr_decision');
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.5 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/icfr`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/run-suggestions`)
      .set(bearer(pb))
      .expect(404);
  });
});

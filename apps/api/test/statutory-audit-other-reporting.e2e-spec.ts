import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OTHER_REPORTING_OUTCOME, type StatutoryAuditOtherReporting } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.7 Other Companies Act & Statutory Reporting — end-to-end (Guide §9.7).
 * Drives the shared sub-assessment through the API: capture the reporting-matrix
 * facts, run the engine, record the professional conclusion, §35 outsider check.
 */
describe('Statutory Audit — 02.7 Other Reporting (e2e §9.7)', () => {
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

  const getOther = async (t: string): Promise<StatutoryAuditOtherReporting> => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/other-reporting`)
      .set(bearer(t))
      .expect(200);
    return res.body[0] as StatutoryAuditOtherReporting;
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

  it('provisions one 02.7 matrix; Rule 11(g) is in force for FY2024-25', async () => {
    const o = await getOther(pa);
    expect(o.assessment.subSectionKey).toBe('02.7');
    expect(o.baseFacts.auditTrailInForce).toBe(true);
    expect(o.detail!.rule11g.applicable).toBe(true);
  });

  it('captures a reportable fraud and routes it to the Central Government with Rule 13 dates', async () => {
    const before = await getOther(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/other-reporting/facts`)
      .set(bearer(pa))
      .send({
        fraudIdentified: true,
        fraudAmount: 20000000, // ₹2cr → CG route
        fraudEventDate: '2024-06-01',
        version: before.assessment.version,
      })
      .expect(201);
    const o = res.body[0] as StatutoryAuditOtherReporting;
    expect(o.detail!.fraud.route).toBe('central_government');
    expect(o.detail!.fraud.boardReplyByDate).toBe('2024-07-16');
    expect(o.detail!.fraud.cgForwardByDate).toBe('2024-07-31');
    expect(o.assessment.systemOutcome).toBe(OTHER_REPORTING_OUTCOME.attentionRequired);
    expect(o.assessment.authorityProvisionId).toBeTruthy();
  });

  it('records the professional conclusion, and rejects a stale-version write (409)', async () => {
    const o = await getOther(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/other-reporting/decision`)
      .set(bearer(pa))
      .send({
        conclusion: OTHER_REPORTING_OUTCOME.attentionRequired,
        version: o.assessment.version,
      })
      .expect(201);
    const decided = res.body[0] as StatutoryAuditOtherReporting;
    expect(decided.assessment.conclusion).toBe(OTHER_REPORTING_OUTCOME.attentionRequired);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/other-reporting/decision`)
      .set(bearer(pa))
      .send({ conclusion: OTHER_REPORTING_OUTCOME.configured, version: o.assessment.version })
      .expect(409);
  });

  it('overriding to a different conclusion without a basis is rejected (§19)', async () => {
    const o = await getOther(pa);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/other-reporting/decision`)
      .set(bearer(pa))
      .send({ conclusion: OTHER_REPORTING_OUTCOME.configured, version: o.assessment.version })
      .expect(400); // system says attention_required → basis required to override
  });

  it('records an immutable audit event for the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?objectType=audit_framework_subassessment&limit=50`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.other_reporting_decision');
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.7 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/other-reporting`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/other-reporting/run-suggestions`)
      .set(bearer(pb))
      .expect(404);
  });
});

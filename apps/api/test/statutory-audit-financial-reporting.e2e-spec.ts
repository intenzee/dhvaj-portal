import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  REPORTING_FRAMEWORK_CONCLUSIONS,
  type StatutoryAuditFinancialReporting,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.2 Financial Reporting Framework — end-to-end (Implementation Guide §9.2).
 * Drives the shared sub-assessment through the API: read (base facts assembled
 * from 02.1 + masters), capture the 02.2 facts, run the Rule-4 roadmap engine,
 * record the professional conclusion, and the §35 outsider check.
 */
describe('Statutory Audit — 02.2 Financial Reporting (e2e §9.2)', () => {
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
    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    shellId = shells.body[0].workflowInstanceId as string;

    // Give 02.2 a net-worth figure via the 02.1 profile (capture-once, reused).
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'net_worth', currentValue: 6000000000 })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = async (t: string): Promise<StatutoryAuditFinancialReporting> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/financial-reporting`)
      .set(bearer(t))
      .expect(200);
    return res.body[0] as StatutoryAuditFinancialReporting;
  };

  it('provisions one 02.2 assessment with base facts assembled from 02.1 + masters', async () => {
    const fr = await get(pa);
    expect(fr.assessment.subSectionKey).toBe('02.2');
    expect(fr.baseFacts.netWorth).toBe(6000000000); // the 02.1 figure is reused, not re-asked
    expect(fr.assessment.state).not.toBe('applicable');
  });

  it('runs the Rule-4 roadmap engine and persists a suggestion + cited detail', async () => {
    const res = await request(app.getHttpServer())
      .post(
        `/api/v1/engagements/${engId}/statutory-audit/${shellId}/financial-reporting/run-suggestions`,
      )
      .set(bearer(pa))
      .expect(201);
    const fr = res.body[0] as StatutoryAuditFinancialReporting;
    expect(fr.assessment.systemOutcome).toBeTruthy();
    expect(fr.detail).not.toBeNull();
  });

  it('captures the 02.2-specific facts (group trigger) and recomputes', async () => {
    const before = await get(pa);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/financial-reporting/facts`)
      .set(bearer(pa))
      .send({ groupTriggersIndAs: true, version: before.assessment.version })
      .expect(201);
    const fr = res.body[0] as StatutoryAuditFinancialReporting;
    expect(fr.capturedFacts.groupTriggersIndAs).toBe(true);
  });

  it('records the professional conclusion, and rejects a stale-version write (409)', async () => {
    const fr = await get(pa);
    const systemOutcome = fr.assessment.systemOutcome;
    // Choose a conclusion that matches the system suggestion when decisive (no
    // override needed), else default to Accounting Standards.
    const conclusion = REPORTING_FRAMEWORK_CONCLUSIONS.includes(systemOutcome as never)
      ? (systemOutcome as string)
      : 'accounting_standards';
    const res = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/financial-reporting/decision`)
      .set(bearer(pa))
      .send({ conclusion, version: fr.assessment.version })
      .expect(201);
    const decided = res.body[0] as StatutoryAuditFinancialReporting;
    expect(decided.assessment.conclusion).toBe(conclusion);
    expect(['applicable', 'overridden']).toContain(decided.assessment.state);

    // A stale version is rejected (optimistic concurrency).
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/financial-reporting/decision`)
      .set(bearer(pa))
      .send({ conclusion: 'accounting_standards', version: fr.assessment.version })
      .expect(409);
  });

  it('records an immutable audit event for the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?objectType=audit_framework_subassessment&limit=50`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.financial_reporting_decision');
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.2 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/financial-reporting`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(
        `/api/v1/engagements/${engId}/statutory-audit/${shellId}/financial-reporting/run-suggestions`,
      )
      .set(bearer(pb))
      .expect(404);
  });
});

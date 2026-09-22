import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CONSOLIDATION_OUTCOME,
  type StatutoryAuditConsolidation,
  type StatutoryAuditFinancialReporting,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.6 Consolidation / Group Audit Framework — end-to-end (Guide §9.6). Drives
 * the shared sub-assessment through the API: information-insufficient until 02.2
 * is concluded, then classifies the perimeter and decides CFS required under
 * §129(3), records the professional conclusion, and the §35 outsider check.
 */
describe('Statutory Audit — 02.6 Consolidation (e2e §9.6)', () => {
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

  const getConsolidation = async (t: string): Promise<StatutoryAuditConsolidation> => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/consolidation`)
      .set(bearer(t))
      .expect(200);
    return res.body[0] as StatutoryAuditConsolidation;
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

    // A ₹600cr net worth drives 02.2 to Ind AS, which 02.6 routes from.
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'net_worth', currentValue: 6000000000 })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('provisions one 02.6 assessment that is information-insufficient until 02.2 is concluded', async () => {
    const c = await getConsolidation(pa);
    expect(c.assessment.subSectionKey).toBe('02.6');
    expect(c.assessment.systemOutcome).toBe(CONSOLIDATION_OUTCOME.informationInsufficient);
    expect(c.upstreamReady).toBe(false);
  });

  it('classifies a subsidiary and requires CFS once 02.2 concludes Ind AS', async () => {
    // Conclude 02.2 = Ind AS.
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/financial-reporting/run-suggestions`)
      .set(bearer(pa))
      .expect(201);
    const fr = (
      await request(app.getHttpServer())
        .get(`${base()}/financial-reporting`)
        .set(bearer(pa))
        .expect(200)
    ).body[0] as StatutoryAuditFinancialReporting;
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/financial-reporting/decision`)
      .set(bearer(pa))
      .send({ conclusion: 'ind_as', version: fr.assessment.version })
      .expect(201);

    // Capture a controlled subsidiary in the perimeter.
    const before = await getConsolidation(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/facts`)
      .set(bearer(pa))
      .send({
        investees: [{ name: 'Bharat Subsidiary Pvt Ltd', ownershipPercent: 100, hasControl: true }],
        version: before.assessment.version,
      })
      .expect(201);
    const c = res.body[0] as StatutoryAuditConsolidation;
    expect(c.assessment.systemOutcome).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
    expect(c.detail!.cfsTriggered).toBe(true);
    expect(c.detail!.perimeter[0]?.relationship).toBe('subsidiary');
    expect(c.assessment.authorityProvisionId).toBeTruthy(); // §129(3) frozen period-correct
  });

  it('records the professional conclusion, and rejects a stale-version write (409)', async () => {
    const c = await getConsolidation(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/decision`)
      .set(bearer(pa))
      .send({ conclusion: CONSOLIDATION_OUTCOME.cfsRequired, version: c.assessment.version })
      .expect(201);
    const decided = res.body[0] as StatutoryAuditConsolidation;
    expect(decided.assessment.conclusion).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
    expect(decided.assessment.state).toBe('applicable');

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/decision`)
      .set(bearer(pa))
      .send({ conclusion: CONSOLIDATION_OUTCOME.cfsExempt, version: c.assessment.version })
      .expect(409);
  });

  it('overriding to CFS-exempt without a basis is rejected (§19)', async () => {
    const c = await getConsolidation(pa);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/decision`)
      .set(bearer(pa))
      .send({ conclusion: CONSOLIDATION_OUTCOME.cfsExempt, version: c.assessment.version })
      .expect(400); // differs from the system's cfs_required → basis required
  });

  it('records an immutable audit event for the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?objectType=audit_framework_subassessment&limit=50`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.consolidation_decision');
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.6 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/consolidation`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/run-suggestions`)
      .set(bearer(pb))
      .expect(404);
  });
});

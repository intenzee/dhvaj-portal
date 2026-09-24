import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  FS_COMPONENT,
  SCHEDULE_III_OUTCOME,
  type StatutoryAuditFinancialReporting,
  type StatutoryAuditScheduleIii,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.3 Schedule III & Presentation Framework — end-to-end (Implementation Guide
 * §9.3). Drives the shared sub-assessment through the API: it is information-
 * insufficient until 02.2 is concluded, then routes the Division from the 02.2
 * conclusion (citing the period-correct Schedule III provision), records the
 * professional conclusion, and enforces the §35 outsider check.
 */
describe('Statutory Audit — 02.3 Schedule III (e2e §9.3)', () => {
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

  const getScheduleIii = async (t: string): Promise<StatutoryAuditScheduleIii> => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/schedule-iii`)
      .set(bearer(t))
      .expect(200);
    return res.body[0] as StatutoryAuditScheduleIii;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    const entityId = await findId('/api/v1/entities?search=Acme&limit=100');
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

    // A ₹600cr net worth (via the 02.1 profile) drives 02.2 to Ind AS — reused by 02.3.
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'net_worth', currentValue: 6000000000 })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('provisions one 02.3 assessment that is information-insufficient until 02.2 is concluded', async () => {
    const sch = await getScheduleIii(pa);
    expect(sch.assessment.subSectionKey).toBe('02.3');
    expect(sch.assessment.systemOutcome).toBe(SCHEDULE_III_OUTCOME.informationInsufficient);
    expect(sch.upstreamReady).toBe(false);
    expect(sch.assessment.state).not.toBe('applicable');
  });

  it('routes Division II once 02.2 concludes Ind AS, citing the Schedule III provision', async () => {
    // Conclude 02.2 = Ind AS (matches the system suggestion at ₹600cr, no override).
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

    // 02.3 now routes from the 02.2 conclusion.
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/schedule-iii/run-suggestions`)
      .set(bearer(pa))
      .expect(201);
    const sch = res.body as StatutoryAuditScheduleIii;
    expect(sch.assessment.systemOutcome).toBe(SCHEDULE_III_OUTCOME.divisionII);
    expect(sch.detail).not.toBeNull();
    expect(sch.detail!.divisionProvisionCode).toBe('SCH_III_DIV_II');
    expect(sch.assessment.authorityProvisionId).toBeTruthy(); // provision frozen period-correct
    // Ind AS Division II requires the Statement of Changes in Equity + a Cash Flow Statement.
    expect(sch.detail!.requiredComponents).toContain(FS_COMPONENT.statementOfChangesInEquity);
    expect(sch.detail!.requiredComponents).toContain(FS_COMPONENT.cashFlowStatement);
  });

  it('records the professional Schedule III conclusion, and rejects a stale-version write (409)', async () => {
    const sch = await getScheduleIii(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/schedule-iii/decision`)
      .set(bearer(pa))
      .send({ conclusion: SCHEDULE_III_OUTCOME.divisionII, version: sch.assessment.version })
      .expect(201);
    const decided = res.body as StatutoryAuditScheduleIii;
    expect(decided.assessment.conclusion).toBe(SCHEDULE_III_OUTCOME.divisionII);
    expect(decided.assessment.state).toBe('applicable');

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/schedule-iii/decision`)
      .set(bearer(pa))
      // A justified override, so the only fault is the stale version.
      .send({
        conclusion: SCHEDULE_III_OUTCOME.divisionI,
        basis: 'Stale-version check (e2e).',
        version: sch.assessment.version,
      })
      .expect(409);
  });

  it('overriding the routed Division without a basis is rejected (§19)', async () => {
    // The row is already decided; re-deciding a decided row is allowed until approval.
    const sch = await getScheduleIii(pa);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/schedule-iii/decision`)
      .set(bearer(pa))
      .send({ conclusion: SCHEDULE_III_OUTCOME.divisionI, version: sch.assessment.version })
      .expect(400); // Division I differs from the system's Division II → basis required
  });

  it('records an immutable audit event for the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?limit=100`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.schedule_iii_decision');
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.3 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/schedule-iii`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/schedule-iii/run-suggestions`)
      .set(bearer(pb))
      .expect(404);
  });
});

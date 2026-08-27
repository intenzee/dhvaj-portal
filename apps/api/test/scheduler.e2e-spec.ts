import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { ComplianceSchedulerService } from '../src/modules/scheduler/compliance-scheduler.service';

/**
 * Background scheduler (§17/§18/§24). The cron jobs are NOT registered in tests
 * (SCHEDULER_ENABLED defaults false), but the work methods are public and driven
 * directly here — the point under test is that a job with NO HTTP principal
 * bootstraps under 'system', resolves an active managing partner, and runs the
 * firm-wide work under that partner's context. "Today" is the machine clock
 * (2026-08-27); a period_end + 0-day rule places an obligation at a chosen date.
 */
describe('Compliance scheduler (e2e)', () => {
  let app: INestApplication;
  let scheduler: ComplianceSchedulerService;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };

  const createEngagement = async (epToken: string): Promise<string> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `SCH${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  const createExactRule = async (): Promise<string> => {
    const code = `SCH_${unique()}`;
    const rule = await request(app.getHttpServer())
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code, name: code, dueDateCategory: 'STATUTORY_RULE' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
      .set(bearer(mp))
      .send({
        effectiveFrom: '2017-04-01',
        calculationBasis: 'period_end',
        offsetDays: 0,
        workingDayAdjustment: 'none',
      })
      .expect(201);
    return code;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    scheduler = app.get(ComplianceSchedulerService);
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('runs the sweep as the resolved managing-partner operator (no HTTP principal)', async () => {
    const pa = await token('partner.a@hsdg.in');
    const eng = await createEngagement(pa);
    const code = await createExactRule();
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: code, referenceDate: '2026-07-01' }) // critically overdue
      .expect(201);

    // Drive the scheduled job directly — it must resolve the operator itself.
    await scheduler.runSweep();

    // The engagement lead was notified the statutory date passed — proof the
    // job ran firm-wide under a real managing-partner context.
    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications?limit=100')
      .set(bearer(pa))
      .expect(200);
    expect(
      (res.body.items as Array<{ type: string; engagementId: string }>).some(
        (n) => n.type === 'statutory_deadline_overdue' && n.engagementId === eng,
      ),
    ).toBe(true);
  });

  it('rolls the recurring-work horizon without an HTTP principal', async () => {
    // The roll is idempotent and firm-wide; here we assert it completes (resolves
    // the operator and invokes generation) rather than throwing.
    await expect(scheduler.runHorizonRoll()).resolves.toBeUndefined();
  });
});

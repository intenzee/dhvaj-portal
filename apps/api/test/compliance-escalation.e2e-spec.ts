import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Escalation ladder (§24) and calendar views (§22).
 *
 * "Today" is the machine clock (2026-08-27). A period_end + 0-day rule makes the
 * statutory date equal the reference date, so obligations can be placed at
 * precise distances from today to exercise every escalation band, the §22 view
 * filters, and the §24 statutory-overdue notification (with critical → firm).
 */
describe('Compliance escalation & calendar views (e2e)', () => {
  let app: INestApplication;
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
  const findEmployeeId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/employees?limit=100')
      .set(bearer(mp));
    return (res.body.items as Array<{ employeeCode: string; id: string }>).find(
      (e) => e.employeeCode === code,
    )!.id;
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
        periodLabel: `E${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  /** A period_end + 0-day rule ⇒ statutory date == reference date. */
  const createExactRule = async (category = 'STATUTORY_RULE'): Promise<string> => {
    const code = `ESC_${unique()}`;
    const rule = await request(app.getHttpServer())
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code, name: code, dueDateCategory: category })
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

  const scanAs = (t: string) =>
    request(app.getHttpServer()).post('/api/v1/notifications/scan').set(bearer(t)).expect(201);

  const notificationsFor = async (
    t: string,
  ): Promise<Array<{ type: string; engagementId: string }>> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications?limit=100')
      .set(bearer(t))
      .expect(200);
    return res.body.items as Array<{ type: string; engagementId: string }>;
  };

  const generate = (t: string, eng: string, code: string, referenceDate: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(t))
      .send({ complianceRuleCode: code, referenceDate });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('escalation bands (§24)', () => {
    it('classifies each obligation into the right band from its operative date', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();

      // Reference date ⇒ statutory date; distances from today (2026-08-27).
      const cases: Record<string, string> = {
        '2026-07-01': 'critical', // 57 days overdue (> 7)
        '2026-08-24': 'overdue', // 3 days overdue (≤ 7)
        '2026-08-27': 'due_today',
        '2026-08-30': 'due_soon', // 3 days out (≤ 7 lead)
        '2026-12-01': 'upcoming', // far future
      };
      for (const date of Object.keys(cases)) {
        await generate(pa, eng, code, date).expect(201);
      }

      const res = await request(app.getHttpServer())
        .get(`/api/v1/compliance/events?engagementId=${eng}&limit=100`)
        .set(bearer(pa))
        .expect(200);
      const statutory = (
        res.body.items as Array<{ kind: string; dueDate: string; escalation: string }>
      ).filter((e) => e.kind === 'statutory');
      const byDate = Object.fromEntries(statutory.map((e) => [e.dueDate, e.escalation]));
      for (const [date, band] of Object.entries(cases)) {
        expect([date, byDate[date]]).toEqual([date, band]);
      }
    });

    it('a completed obligation escalates to "none"', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();
      const gen = await generate(pa, eng, code, '2026-07-01').expect(201); // would be critical
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/complete`)
        .set(bearer(pa))
        .send({ version: gen.body.version })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/compliance/events?engagementId=${eng}&limit=100`)
        .set(bearer(pa))
        .expect(200);
      const stat = (res.body.items as Array<{ kind: string; escalation: string }>).find(
        (e) => e.kind === 'statutory',
      );
      expect(stat!.escalation).toBe('none');
    });
  });

  describe('calendar views (§22)', () => {
    it('filters the firm-wide calendar by service and by engagement partner', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();
      const gen = await generate(pa, eng, code, '2026-08-24').expect(201);
      const paEmp = await findEmployeeId('EMP003'); // Partner A
      const pbEmp = await findEmployeeId('EMP004'); // Partner B

      const hasIt = async (query: string): Promise<boolean> => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/compliance?${query}&limit=100`)
          .set(bearer(mp))
          .expect(200);
        return (res.body.items as Array<{ id: string }>).some((i) => i.id === gen.body.id);
      };

      expect(await hasIt('serviceCode=ITR_FILING')).toBe(true);
      expect(await hasIt(`partnerId=${paEmp}`)).toBe(true);
      // Partner B's portfolio view must not contain Partner A's obligation.
      expect(await hasIt(`partnerId=${pbEmp}`)).toBe(false);
    });
  });

  describe('statutory-overdue escalation notifications (§24)', () => {
    it('emits a statutory-deadline-overdue notification to the engagement lead', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();
      await generate(pa, eng, code, '2026-07-01').expect(201); // critically overdue

      // The operator (MP) runs the sweep — a fresh, newest-first notification.
      const scan = await request(app.getHttpServer())
        .post('/api/v1/notifications/scan')
        .set(bearer(mp))
        .expect(201);
      expect(scan.body.statutoryDeadlineOverdue).toBeGreaterThanOrEqual(1);

      // The engagement partner (lead) is notified the statutory date has passed.
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

    it('forbids a non-operator from running the sweep (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/notifications/scan')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(403);
    });
  });

  describe('§24 finer escalation routing', () => {
    it('Due Today → a compliance-due-today notification to the lead', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();
      await generate(pa, eng, code, '2026-08-27').expect(201); // due TODAY

      const scan = await scanAs(mp);
      expect(scan.body.complianceDueToday).toBeGreaterThanOrEqual(1);
      expect(
        (await notificationsFor(pa)).some(
          (n) => n.type === 'compliance_due_today' && n.engagementId === eng,
        ),
      ).toBe(true);
    });

    it('Client-commitment overdue → a distinct client-commitment notification, not a statutory breach', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule('CLIENT_COMMITTED');
      await generate(pa, eng, code, '2026-08-20').expect(201); // 7 days overdue

      const scan = await scanAs(mp);
      expect(scan.body.clientCommitmentOverdue).toBeGreaterThanOrEqual(1);
      const mine = (await notificationsFor(pa)).filter((n) => n.engagementId === eng);
      expect(mine.some((n) => n.type === 'client_commitment_overdue')).toBe(true);
      // A client commitment is NOT routed as a statutory-deadline breach.
      expect(mine.some((n) => n.type === 'statutory_deadline_overdue')).toBe(false);
    });

    it('Review overdue → the layer OWNER (reviewer) is notified, leads escalated', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa);
      // Non-statutory parent so no auto review layer collides with the manual one.
      const code = await createExactRule('HSDG_MILESTONE');
      const gen = await generate(pa, eng, code, '2026-12-01').expect(201); // instance itself upcoming
      const reviewer = await findEmployeeId('EMP005'); // Manager X — NOT an engagement lead

      // A manager-review layer whose own due date has already passed.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/deadlines`)
        .set(bearer(pa))
        .send({
          layerType: 'manager_review',
          label: 'Manager review',
          dueDateCategory: 'HSDG_MILESTONE',
          dueDate: '2026-08-20',
          ownerEmployeeId: reviewer,
        })
        .expect(201);

      const scan = await scanAs(mp);
      expect(scan.body.deadlineLayerOverdue).toBeGreaterThanOrEqual(1);

      // The reviewer (layer owner), though not an engagement lead, is notified.
      const mx = await token('manager.x@hsdg.in');
      expect(
        (await notificationsFor(mx)).some(
          (n) => n.type === 'deadline_layer_overdue' && n.engagementId === eng,
        ),
      ).toBe(true);
    });
  });
});

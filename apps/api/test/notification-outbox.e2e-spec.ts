import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { NotificationOutboxService } from '../src/modules/notifications/notification-outbox.service';
import type { RlsContext } from '../src/database/rls-context';

/**
 * Durable delivery outbox. With an external channel enabled, every emitted
 * notification enqueues a delivery row ATOMICALLY with the portal row; a drain
 * pass delivers pending rows through the channel and marks them sent. Delivery
 * is at-least-once and survives a channel outage. The scan is the emit source
 * here (a critically-overdue obligation → statutory-overdue notification).
 */
describe('Notification delivery outbox (e2e)', () => {
  let app: INestApplication;
  let outbox: NotificationOutboxService;
  let mp: string;
  // A firm-wide operator context (role gate only, like the scheduled worker).
  const operator: RlsContext = { userId: '', role: 'managing_partner', officeId: '' };

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

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    outbox = app.get(NotificationOutboxService);
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('enqueues external deliveries on emit and drains them to sent', async () => {
    // Emit at least one notification: a critically-overdue statutory obligation.
    const pa = await token('partner.a@hsdg.in');
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=1');
    const serviceId = await findId('/api/v1/services?search=ITR_FILING&limit=1');
    const eng = (
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `OBX${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;

    const code = `OBX_${unique()}`;
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
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: code, referenceDate: '2026-07-01' }) // critically overdue
      .expect(201);

    // The sweep emits notifications → each enqueues an email delivery.
    await request(app.getHttpServer())
      .post('/api/v1/notifications/scan')
      .set(bearer(mp))
      .expect(201);

    // Drain the outbox as the operator — pending rows are delivered and sent.
    const result = await outbox.drain(operator);
    expect(result.sent).toBeGreaterThanOrEqual(1);

    // A second drain finds nothing left from this batch to send (idempotent).
    const again = await outbox.drain(operator);
    expect(again.sent).toBe(0);
  });
});

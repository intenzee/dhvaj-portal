import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { NotificationOutboxService } from '../src/modules/notifications/notification-outbox.service';
import type { RlsContext } from '../src/database/rls-context';

/**
 * Client-facing delivery (§24 "PBC overdue → client + owner"). A client is not a
 * portal user, so an overdue client dependency (PBC) enqueues an external email
 * delivery to the entity's contact — in addition to the internal owner/EP
 * notification — drained by the same outbox worker. Acme has a seeded contact
 * email (ramesh@acme.example).
 */
describe('Client-facing PBC delivery (e2e)', () => {
  let app: INestApplication;
  let outbox: NotificationOutboxService;
  let mp: string;
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

  const findId = async (t: string, path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(t));
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

  it('enqueues a client email delivery when a PBC is escalation-overdue', async () => {
    const pa = await token('partner.a@hsdg.in');
    const entityId = await findId(mp, '/api/v1/entities?search=Acme&limit=1');
    const serviceId = await findId(mp, '/api/v1/services?search=STAT_AUDIT&limit=1');
    const eng = (
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `CD${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;

    // A client dependency already past its escalation date.
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/client-dependencies`)
      .set(bearer(pa))
      .send({ requestedInfo: 'FY26 bank statements', escalationDate: '2026-01-01' })
      .expect(201);

    // The sweep enqueues the internal escalation AND a client email delivery.
    const scan = await request(app.getHttpServer())
      .post('/api/v1/notifications/scan')
      .set(bearer(mp))
      .expect(201);
    expect(scan.body.clientDependencyOverdue).toBeGreaterThanOrEqual(1);
    expect(scan.body.clientDeliveryEnqueued).toBeGreaterThanOrEqual(1);

    // The client delivery drains (to the contact email) like any other.
    const drained = await outbox.drain(operator);
    expect(drained.sent).toBeGreaterThanOrEqual(1);
  });
});

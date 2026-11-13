import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { QuickTaskDetail, QuickTaskInbox } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Remind (the Today screen): a Partner or the Managing Partner gives someone
 * else a short job with the time allotted. It is an urgent quick task due when
 * that time runs out, so it pops up on their screen. Nobody else may send one.
 */
describe('Remind (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: string;
  let mp: string;
  let sy: string;
  let mx: string;
  let syEmployee: string;
  let paEmployee: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const employee = async (email: string): Promise<string> =>
    (
      await su.query<{ id: string }>(
        `SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id WHERE u.email = $1`,
        [email],
      )
    ).rows[0]!.id;
  const remind = (t: string, body: Record<string, unknown>) =>
    http().post('/api/v1/quick-tasks/remind').set(bearer(t)).send(body);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    [pa, mp, sy, mx] = await Promise.all([
      token('partner.a@dhvaj.in'),
      token('mp@dhvaj.in'),
      token('senior.y@dhvaj.in'),
      token('manager.x@dhvaj.in'),
    ]);
    syEmployee = await employee('senior.y@dhvaj.in');
    paEmployee = await employee('partner.a@dhvaj.in');
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('a Partner reminds Senior Y with 90 minutes; it pops up for Y at once', async () => {
    const before = Date.now();
    const t = (
      await remind(pa, {
        assignedToEmployeeId: syEmployee,
        minutes: 90,
        note: '  Send the   GSTR-1 summary ',
      }).expect(201)
    ).body as QuickTaskDetail;
    expect(t).toMatchObject({
      title: 'Reminder: Send the GSTR-1 summary',
      details: 'Time allotted: 1 h 30 min.',
      urgent: true,
      status: 'sent',
      assignedTo: { id: syEmployee },
    });
    const due = Date.parse(t.dueAt!);
    expect(due).toBeGreaterThanOrEqual(before + 90 * 60_000 - 1000);
    expect(due).toBeLessThanOrEqual(Date.now() + 90 * 60_000 + 1000);

    const box = (await http().get('/api/v1/quick-tasks/inbox').set(bearer(sy)).expect(200))
      .body as QuickTaskInbox;
    expect(box.waiting.map((w) => w.id)).toContain(t.id);
    const { rows } = await su.query(
      `SELECT 1 FROM hsdg.notifications n JOIN hsdg.employees e ON e.user_id = n.recipient_user_id
        WHERE e.id = $1 AND n.object_id = $2 AND n.type = 'quick_task_assigned'`,
      [syEmployee, t.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('the Managing Partner may too, without a note', async () => {
    const t = (await remind(mp, { assignedToEmployeeId: syEmployee, minutes: 120 }).expect(201))
      .body as QuickTaskDetail;
    expect(t.title).toBe('Reminder');
    expect(t.details).toBe('Time allotted: 2 h.');
  });

  it('a Manager or a Senior may not send one', async () => {
    await remind(mx, { assignedToEmployeeId: syEmployee, minutes: 30 }).expect(403);
    await remind(sy, { assignedToEmployeeId: paEmployee, minutes: 30 }).expect(403);
  });

  it('needs someone else and a time between a minute and a week', async () => {
    await remind(pa, { assignedToEmployeeId: paEmployee, minutes: 30 }).expect(400);
    await remind(pa, { assignedToEmployeeId: syEmployee, minutes: 0 }).expect(400);
    await remind(pa, { assignedToEmployeeId: syEmployee, minutes: 7 * 1440 + 1 }).expect(400);
  });
});

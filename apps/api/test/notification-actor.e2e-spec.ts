import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import type { NotificationItem, QuickTaskDetail } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * "Needs action" only for what someone else did to you. Giving a task or
 * answering one notifies the other person, never yourself — at the source
 * (emit_notification skips the actor), and on the read side for rows raised by
 * their own recipient before that.
 */
describe('Notifications never ask the actor to act (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: string;
  let sy: string;
  let paEmployee: string;
  let paUser: string;
  let syEmployee: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const person = async (email: string): Promise<{ employee: string; user: string }> => {
    const { rows } = await su.query<{ employee: string; user: string }>(
      `SELECT e.id AS employee, u.id AS "user"
         FROM hsdg.users u JOIN hsdg.employees e ON e.user_id = u.id
        WHERE u.email = $1`,
      [email],
    );
    return rows[0]!;
  };
  const rowsAbout = async (objectId: string, userId: string) =>
    (
      await su.query<{ type: string; actor_user_id: string | null }>(
        `SELECT type, actor_user_id FROM hsdg.notifications
          WHERE object_id = $1 AND recipient_user_id = $2`,
        [objectId, userId],
      )
    ).rows;
  const list = async (t: string, qs: string): Promise<NotificationItem[]> =>
    (await http().get(`/api/v1/notifications?limit=100${qs}`).set(bearer(t)).expect(200)).body
      .items as NotificationItem[];
  const unread = async (t: string): Promise<number> =>
    (await http().get('/api/v1/notifications/unread-count').set(bearer(t)).expect(200)).body
      .unread as number;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    [pa, sy] = await Promise.all([token('partner.a@dhvaj.in'), token('senior.y@dhvaj.in')]);
    ({ employee: paEmployee, user: paUser } = await person('partner.a@dhvaj.in'));
    ({ employee: syEmployee } = await person('senior.y@dhvaj.in'));
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('a task given and answered reaches the other person only', async () => {
    const task = (
      await http()
        .post('/api/v1/quick-tasks')
        .set(bearer(pa))
        .send({ title: 'Call the client back', assignedToEmployeeId: syEmployee })
        .expect(201)
    ).body as QuickTaskDetail;
    await http()
      .post(`/api/v1/quick-tasks/${task.id}/reply`)
      .set(bearer(sy))
      .send({ body: 'On it' })
      .expect(201);
    await http()
      .post(`/api/v1/quick-tasks/${task.id}/reply`)
      .set(bearer(pa))
      .send({ body: 'Thanks' })
      .expect(201);
    const mine = await rowsAbout(task.id, paUser);
    // Partner A hears only Senior Y's answer — not their own task or their own reply.
    expect(mine.map((r) => r.type)).toEqual(['quick_task_reply']);
    expect(mine[0]!.actor_user_id).not.toBe(paUser);
  });

  it('the emit function records the actor and skips the actor themselves', async () => {
    const objectId = randomUUID();
    const emit = (employee: string) =>
      su.query<{ u: string | null }>(
        `SELECT hsdg.emit_notification($1, 'quick_task_assigned', 'x', NULL, NULL,
                'quick_task', $2, NULL, NULL, NULL, $3) AS u`,
        [employee, objectId, paUser],
      );
    expect((await emit(paEmployee)).rows[0]!.u).toBeNull();
    expect((await emit(syEmployee)).rows[0]!.u).not.toBeNull();
    expect(await rowsAbout(objectId, paUser)).toEqual([]);
  });

  it('an older row its own recipient raised stays out of Needs action and the bell count', async () => {
    const objectId = randomUUID();
    const before = await unread(pa);
    await su.query(
      `SELECT hsdg.emit_notification($1, 'quick_task_assigned', 'Self-raised', NULL, NULL,
              'quick_task', $2, NULL, NULL, NULL)`,
      [paEmployee, objectId],
    );
    // Without an actor it is someone else's doing: it needs action.
    expect((await list(pa, '&unreadOnly=true')).map((n) => n.objectId)).toContain(objectId);
    expect(await unread(pa)).toBe(before + 1);

    await su.query(
      `UPDATE hsdg.notifications SET actor_user_id = recipient_user_id WHERE object_id = $1`,
      [objectId],
    );
    expect((await list(pa, '&unreadOnly=true')).map((n) => n.objectId)).not.toContain(objectId);
    expect((await list(pa, '')).map((n) => n.objectId)).not.toContain(objectId);
    expect(await unread(pa)).toBe(before);
    // Still in the full history.
    expect((await list(pa, '&scope=all')).map((n) => n.objectId)).toContain(objectId);
  });
});

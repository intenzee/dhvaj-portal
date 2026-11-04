import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  QuickTaskDetail,
  QuickTaskInbox,
  QuickTaskPerson,
  QuickTaskSummary,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Quick tasks (New → New task): Partner A gives Senior Y an urgent job on a
 * client; it reaches Y at once (bell and the pop-up's inbox); Y answers
 * Received, then Doing — done in 1 hr, then Done; each answer reaches A.
 * Nobody else on the firm's staff sees it.
 */
describe('Quick tasks (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: string;
  let sy: string;
  let mx: string;
  let senior: QuickTaskPerson;
  let entityId: string;
  let task: QuickTaskDetail;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const inbox = async (t: string) =>
    (await http().get('/api/v1/quick-tasks/inbox').set(bearer(t)).expect(200))
      .body as QuickTaskInbox;
  const reply = (t: string, body: Record<string, unknown>) =>
    http().post(`/api/v1/quick-tasks/${task.id}/reply`).set(bearer(t)).send(body);
  const bell = async (employeeCode: string, type: string) =>
    (
      await su.query<{ title: string; body: string | null }>(
        `SELECT n.title, n.body FROM hsdg.notifications n
           JOIN hsdg.employees e ON e.user_id = n.recipient_user_id
          WHERE e.employee_code = $1 AND n.type = $2 AND n.object_id = $3
          ORDER BY n.created_at`,
        [employeeCode, type, task.id],
      )
    ).rows;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    [pa, sy, mx] = await Promise.all([
      token('partner.a@dhvaj.in'),
      token('senior.y@dhvaj.in'),
      token('manager.x@dhvaj.in'),
    ]);
    const p = `AAAC${'WXYZ'[Math.floor(Math.random() * 4)]}${String(
      Math.floor(Math.random() * 10000),
    ).padStart(4, '0')}Q`;
    entityId = (
      await http()
        .post('/api/v1/entities')
        .set(bearer(pa))
        .send({
          legalName: `Quick ${p} Traders Pvt Ltd`,
          typeSlug: 'private_limited',
          officeCode: 'NORTH',
          pan: p,
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('lists the people a task can go to, for anyone on staff', async () => {
    const people = (await http().get('/api/v1/quick-tasks/people').set(bearer(sy)).expect(200))
      .body as QuickTaskPerson[];
    senior = people.find((x) => x.name && x.role === 'senior')!;
    expect(senior).toBeTruthy();
    expect(people.map((x) => x.role)).toEqual(expect.arrayContaining(['partner', 'manager']));
  });

  it('gives Senior Y an urgent task on the client; it reaches them at once', async () => {
    const res = await http()
      .post('/api/v1/quick-tasks')
      .set(bearer(pa))
      .send({
        entityId,
        title: 'Send the GSTR-3B challan to the client',
        details: 'They are waiting on the call.',
        assignedToEmployeeId: senior.id,
      })
      .expect(201);
    task = res.body as QuickTaskDetail;
    expect(task).toMatchObject({
      status: 'sent',
      urgent: true,
      side: 'sent',
      entityLabel: expect.stringMatching(/^ENT\d+ · Quick /),
      assignedTo: { id: senior.id },
      canSet: expect.arrayContaining(['cancelled']),
    });
    const box = await inbox(sy);
    expect(box.waiting.map((t) => t.id)).toContain(task.id);
    expect(box.unread).toBeGreaterThanOrEqual(1);
    const [n] = await bell(senior.code!, 'quick_task_assigned');
    expect(n!.title).toMatch(/^Urgent task from .+: Send the GSTR-3B challan to the client$/);
    expect(n!.body).toMatch(/Quick .* — They are waiting on the call\.$/);
  });

  it('is seen only by the two people on it', async () => {
    await http().get(`/api/v1/quick-tasks/${task.id}`).set(bearer(mx)).expect(404);
    await http()
      .post(`/api/v1/quick-tasks/${task.id}/reply`)
      .set(bearer(mx))
      .send({ body: 'me too' })
      .expect(404);
    const list = (await http().get('/api/v1/quick-tasks').set(bearer(mx)).expect(200))
      .body as QuickTaskSummary[];
    expect(list.map((t) => t.id)).not.toContain(task.id);
  });

  it('Received, then Doing — done in 1 hr, then Done; each reaches the giver', async () => {
    let t = (await reply(sy, { status: 'received' }).expect(201)).body as QuickTaskDetail;
    expect(t.status).toBe('received');
    expect((await inbox(sy)).waiting.map((w) => w.id)).not.toContain(task.id);

    const before = Date.now();
    t = (await reply(sy, { etaMinutes: 60, body: 'On it' }).expect(201)).body as QuickTaskDetail;
    expect(t.status).toBe('doing');
    const eta = new Date(t.etaAt!).getTime();
    expect(eta - before).toBeGreaterThanOrEqual(59 * 60_000);
    expect(eta - before).toBeLessThan(62 * 60_000);

    // The giver sees the answer unread, then reads it.
    const sent = (await http().get(`/api/v1/quick-tasks/${task.id}`).set(bearer(pa)).expect(200))
      .body as QuickTaskDetail;
    expect(sent.unread).toBe(2);
    expect(sent.messages.map((m) => [m.status, m.body, m.mine])).toEqual([
      ['received', null, false],
      ['doing', 'On it', false],
    ]);
    await http().post(`/api/v1/quick-tasks/${task.id}/read`).set(bearer(pa)).expect(201);
    const seen = (await http().get(`/api/v1/quick-tasks/${task.id}`).set(bearer(sy)).expect(200))
      .body as QuickTaskDetail;
    expect(seen.messages.every((m) => m.readAt)).toBe(true);

    t = (await reply(sy, { status: 'done', body: 'Sent on mail' }).expect(201))
      .body as QuickTaskDetail;
    expect(t).toMatchObject({ status: 'done', canSet: [] });
    const replies = await bell('EMP003', 'quick_task_reply');
    expect(replies.map((r) => r.title.replace(/^[^:]+: /, ''))).toEqual([
      'Received · Send the GSTR-3B challan to the client',
      expect.stringMatching(/^Doing — done by .+ · Send the GSTR-3B challan to the client$/),
      'Done · Send the GSTR-3B challan to the client',
    ]);
  });

  it('only the giver reopens or cancels; only the doer sets the time', async () => {
    await reply(sy, { status: 'sent' }).expect(409);
    await reply(pa, { etaMinutes: 30 }).expect(403);
    let t = (await reply(pa, { status: 'sent', body: 'Client says not received' }).expect(201))
      .body as QuickTaskDetail;
    expect(t).toMatchObject({ status: 'sent', etaAt: null });
    t = (await reply(pa, { status: 'cancelled' }).expect(201)).body as QuickTaskDetail;
    expect(t.status).toBe('cancelled');
    await reply(sy, { status: 'doing' }).expect(409);
    // Writing goes on after it closes.
    await reply(sy, { body: 'Noted' }).expect(201);
  });
});

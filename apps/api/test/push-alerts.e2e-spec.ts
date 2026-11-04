import { clearPushEnv, TEST_VAPID_PUBLIC_KEY } from './push-env';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createECDH, randomBytes } from 'node:crypto';
import * as webpush from 'web-push';
import type { PushAlert, QuickTaskDetail, QuickTaskPerson } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { PushService, type PushTarget } from '../src/modules/live/push.service';

/**
 * Web Push: Senior Y turns alerts on in a browser; Partner A gives Y an urgent
 * task and Y's device gets an encrypted push at once — and again while Y has
 * not picked it up. Answers push back to A. Gone devices are forgotten; no
 * one sees another's devices; only real push services are accepted.
 */
describe('Push alerts (e2e)', () => {
  let app: INestApplication;
  let push: PushService;
  let pa: string;
  let sy: string;
  let mx: string;
  let senior: QuickTaskPerson;
  const sent: { target: PushTarget; alert: PushAlert; topic: string; urgency: string }[] = [];
  const gone = new Set<string>();

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;

  /** A browser's PushSubscription.toJSON(): real P-256 keys, an FCM endpoint. */
  const browser = (name: string) => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return {
      endpoint: `https://fcm.googleapis.com/fcm/send/${name}-${randomBytes(6).toString('hex')}`,
      expirationTime: null,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    };
  };
  const devices = async (t: string): Promise<number> =>
    (await http().get('/api/v1/push/me').set(bearer(t)).expect(200)).body.devices as number;
  const until = async (pred: () => boolean, ms = 5_000): Promise<void> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out; pushes so far: ${JSON.stringify(sent.map((s) => s.alert))}`);
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    push = app.get(PushService);
    push.reRingAfterMs = [400, 800];
    // In place of the push services: encrypt for real (proves the keys), keep it.
    push.transport = async (target, payload, options) => {
      if (gone.has(target.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 });
      const req = webpush.generateRequestDetails(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        options,
      );
      expect(req.headers.Authorization).toMatch(/^vapid t=.+, k=/);
      expect(req.body.length).toBeGreaterThan(payload.length);
      sent.push({
        target,
        alert: JSON.parse(payload) as PushAlert,
        topic: options.topic,
        urgency: options.urgency,
      });
      return 201;
    };
    [pa, sy, mx] = await Promise.all([
      token('partner.a@dhvaj.in'),
      token('senior.y@dhvaj.in'),
      token('manager.x@dhvaj.in'),
    ]);
    const people = (await http().get('/api/v1/quick-tasks/people').set(bearer(pa)).expect(200))
      .body as QuickTaskPerson[];
    senior = people.find((x) => x.role === 'senior')!;
  });

  afterAll(async () => {
    await app?.close();
    clearPushEnv();
  });

  it('tells the web it can push, with its public key', async () => {
    await http().get('/api/v1/push/config').expect(401);
    const res = await http().get('/api/v1/push/config').set(bearer(sy)).expect(200);
    expect(res.body).toEqual({ enabled: true, publicKey: TEST_VAPID_PUBLIC_KEY });
  });

  it('accepts only real push services', async () => {
    const b = browser('bad');
    for (const endpoint of [
      'https://evil.example.com/push/1',
      'http://fcm.googleapis.com/fcm/send/1',
      'https://fcm.googleapis.com:8443/fcm/send/1',
      'https://fcm.googleapis.com.evil.example/fcm/send/1',
    ]) {
      await http()
        .post('/api/v1/push/subscriptions')
        .set(bearer(sy))
        .send({ ...b, endpoint })
        .expect(400);
    }
    expect(await devices(sy)).toBe(0);
  });

  const ys = browser('senior-y');
  const as = browser('partner-a');

  it('an urgent task reaches its person’s device at once, and again while unanswered', async () => {
    await http().post('/api/v1/push/subscriptions').set(bearer(sy)).send(ys).expect(204);
    await http().post('/api/v1/push/subscriptions').set(bearer(sy)).send(ys).expect(204); // idempotent
    expect(await devices(sy)).toBe(1);
    expect(await devices(mx)).toBe(0); // one's own devices only

    const task = (
      await http()
        .post('/api/v1/quick-tasks')
        .set(bearer(pa))
        .send({ title: 'Call the client about the GST notice', assignedToEmployeeId: senior.id })
        .expect(201)
    ).body as QuickTaskDetail;
    await until(() => sent.some((s) => s.alert.taskId === task.id));
    const first = sent.find((s) => s.alert.taskId === task.id)!;
    expect(first.target.endpoint).toBe(ys.endpoint);
    expect(first.urgency).toBe('high');
    expect(first.topic).toBe(task.id.replace(/-/g, ''));
    expect(first.alert).toMatchObject({
      kind: 'quick_task.assigned',
      urgent: true,
      ring: 0,
      body: 'Call the client about the GST notice',
      url: `/quick-tasks?t=${task.id}`,
    });
    expect(first.alert.title).toMatch(/^🔔 Urgent task from /);

    // Still not picked up: it rings again.
    await until(() => sent.some((s) => s.alert.taskId === task.id && s.alert.ring === 1));
    expect(sent.find((s) => s.alert.ring === 1)!.alert.title).toMatch(/^⏰ Still waiting/);

    // Picked up: the reminders stop. A has no device yet, so the answer goes nowhere.
    await http()
      .post(`/api/v1/quick-tasks/${task.id}/reply`)
      .set(bearer(sy))
      .send({ status: 'received' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(sent.filter((s) => s.alert.taskId === task.id).map((s) => s.alert.ring)).toEqual([0, 1]);
    expect(push.pendingReminders).toBe(0);

    // A turns alerts on; Y's next answer reaches A's device.
    await http().post('/api/v1/push/subscriptions').set(bearer(pa)).send(as).expect(204);
    await http()
      .post(`/api/v1/quick-tasks/${task.id}/reply`)
      .set(bearer(sy))
      .send({ status: 'doing', body: 'Calling now' })
      .expect(201);
    await until(() => sent.some((s) => s.target.endpoint === as.endpoint));
    const answer = sent.find((s) => s.target.endpoint === as.endpoint)!.alert;
    expect(answer).toMatchObject({ kind: 'quick_task.reply', urgent: true, ring: 0 });
    expect(answer.title).toMatch(/^💬 .+ answered$/);
    expect(answer.body).toContain('Calling now');
    expect(answer.body).toContain('Call the client about the GST notice');
  });

  it('a normal task pushes once, no reminders', async () => {
    const before = sent.length;
    const task = (
      await http()
        .post('/api/v1/quick-tasks')
        .set(bearer(pa))
        .send({ title: 'Send the letter', assignedToEmployeeId: senior.id, urgent: false })
        .expect(201)
    ).body as QuickTaskDetail;
    await until(() => sent.some((s) => s.alert.taskId === task.id));
    await new Promise((r) => setTimeout(r, 1_000));
    const mine = sent.slice(before).filter((s) => s.alert.taskId === task.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.urgency).toBe('normal');
    expect(mine[0]!.alert.title).toMatch(/^🔔 New task from /);
  });

  it('forgets a device the push service says is gone', async () => {
    gone.add(ys.endpoint);
    await http()
      .post('/api/v1/quick-tasks')
      .set(bearer(pa))
      .send({ title: 'To a gone phone', assignedToEmployeeId: senior.id, urgent: false })
      .expect(201);
    for (let i = 0; i < 100 && (await devices(sy)) > 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(await devices(sy)).toBe(0);
  });

  it('a browser follows whoever signed in on it; turning off removes only one’s own', async () => {
    const shared = browser('shared');
    await http().post('/api/v1/push/subscriptions').set(bearer(sy)).send(shared).expect(204);
    await http().post('/api/v1/push/subscriptions').set(bearer(mx)).send(shared).expect(204);
    expect(await devices(sy)).toBe(0);
    expect(await devices(mx)).toBe(1);
    // Y cannot remove X's device by its endpoint.
    await http()
      .delete('/api/v1/push/subscriptions')
      .set(bearer(sy))
      .send({ endpoint: shared.endpoint })
      .expect(204);
    expect(await devices(mx)).toBe(1);
    await http()
      .delete('/api/v1/push/subscriptions')
      .set(bearer(mx))
      .send({ endpoint: shared.endpoint })
      .expect(204);
    expect(await devices(mx)).toBe(0);
  });
});

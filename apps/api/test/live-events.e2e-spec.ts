import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import {
  LIVE_EVENT,
  parseSseFrames,
  type LiveEvent,
  type QuickTaskDetail,
  type QuickTaskPerson,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { LiveEventsService } from '../src/modules/live/live-events.service';

/**
 * Live task alerts: Partner A gives Senior Y an urgent task and Y's open
 * stream hears it the moment it commits (over pg NOTIFY); Y answers and A's
 * stream hears that. Nobody else hears either; a refused write sends nothing.
 */
describe('Live events (e2e)', () => {
  let app: INestApplication;
  let base: string;
  let pa: string;
  let sy: string;
  let mx: string;
  let senior: QuickTaskPerson;
  let task: QuickTaskDetail;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;

  /** Opens /live/stream as the web does (fetch, bearer header) and collects events. */
  const open = async (t: string) => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/v1/live/stream`, {
      headers: { ...bearer(t), accept: 'text/event-stream' },
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events: LiveEvent[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const { frames, rest } = parseSseFrames(buf + decoder.decode(value, { stream: true }));
          buf = rest;
          for (const f of frames) if (f.event !== 'ping') events.push(JSON.parse(f.data));
        }
      } catch {
        /* aborted */
      }
    })();
    return {
      events,
      until: async (pred: (e: LiveEvent) => boolean, ms = 5_000): Promise<LiveEvent> => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const hit = events.find(pred);
          if (hit) return hit;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`No live event in ${ms} ms; got ${JSON.stringify(events)}`);
      },
      close: async () => {
        ctrl.abort();
        await pump;
      },
    };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp(); // listening on a free port
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [pa, sy, mx] = await Promise.all([
      token('partner.a@dhvaj.in'),
      token('senior.y@dhvaj.in'),
      token('manager.x@dhvaj.in'),
    ]);
    const people = (await http().get('/api/v1/quick-tasks/people').set(bearer(pa)).expect(200))
      .body as QuickTaskPerson[];
    senior = people.find((x) => x.role === 'senior')!;
    // The API is hearing NOTIFY before anything is sent.
    const live = app.get(LiveEventsService);
    for (let i = 0; i < 100 && !live.listening; i++) await new Promise((r) => setTimeout(r, 50));
    expect(live.listening).toBe(true);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('needs a login', async () => {
    await http().get('/api/v1/live/stream').expect(401);
  });

  it('a new task reaches its person’s screen at once; nobody else hears it', async () => {
    const y = await open(sy);
    const m = await open(mx);
    try {
      task = (
        await http()
          .post('/api/v1/quick-tasks')
          .set(bearer(pa))
          .send({ title: 'Call the client about the GST notice', assignedToEmployeeId: senior.id })
          .expect(201)
      ).body as QuickTaskDetail;
      const e = await y.until((x) => x.taskId === task.id);
      expect(e).toMatchObject({
        kind: LIVE_EVENT.quickTaskAssigned,
        urgent: true,
        fromName: expect.any(String),
        id: expect.any(String),
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(m.events.filter((x) => x.taskId === task.id)).toEqual([]);
    } finally {
      await y.close();
      await m.close();
    }
  });

  it('each answer reaches the other person, a message included, as a live chat', async () => {
    const a = await open(pa);
    const y = await open(sy);
    try {
      await http()
        .post(`/api/v1/quick-tasks/${task.id}/reply`)
        .set(bearer(sy))
        .send({ status: 'doing', body: 'On it — calling now' })
        .expect(201);
      const e = await a.until((x) => x.taskId === task.id);
      expect(e).toMatchObject({ kind: LIVE_EVENT.quickTaskReply, urgent: true });
      await http()
        .post(`/api/v1/quick-tasks/${task.id}/reply`)
        .set(bearer(pa))
        .send({ body: 'Thanks — tell me what they say' })
        .expect(201);
      await y.until((x) => x.kind === LIVE_EVENT.quickTaskReply && x.taskId === task.id);
      // A finished task no longer rings.
      await http()
        .post(`/api/v1/quick-tasks/${task.id}/reply`)
        .set(bearer(sy))
        .send({ status: 'done' })
        .expect(201);
      const done = await a.until((x) => x.taskId === task.id && x.urgent === false);
      expect(done.kind).toBe(LIVE_EVENT.quickTaskReply);
    } finally {
      await a.close();
      await y.close();
    }
  });

  it('a refused write sends nothing; a stream closes cleanly', async () => {
    const live = app.get(LiveEventsService);
    const y = await open(sy);
    const before = y.events.length;
    await http()
      .post('/api/v1/quick-tasks')
      .set(bearer(pa))
      .send({ title: 'To nobody', assignedToEmployeeId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
    await new Promise((r) => setTimeout(r, 300));
    expect(y.events.length).toBe(before);
    expect(live.openStreams).toBeGreaterThan(0);
    await y.close();
    for (let i = 0; i < 40 && live.openStreams > 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(live.openStreams).toBe(0);
  });
});

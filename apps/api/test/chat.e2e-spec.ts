import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import {
  CHAT_LIVE_EVENT,
  parseSseFrames,
  type ChatConversation,
  type ChatLiveEvent,
  type ChatMessage,
  type ChatMessagesPage,
  type ChatPerson,
  type ChatUnread,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { LiveEventsService } from '../src/modules/live/live-events.service';

/**
 * Chat: Partner A messages Senior Y. One grey tick when sent; two grey when
 * Y's portal receives it; two blue when Y opens the chat — and A's open
 * stream hears each as it happens. "typing…", online and last seen; photos,
 * voice notes and PDFs; and nobody else (not even the Managing Partner) sees
 * the chat.
 */
describe('Chat (e2e)', () => {
  let app: INestApplication;
  let base: string;
  let pa: string;
  let sy: string;
  let mx: string;
  let mp: string;
  let partner: ChatPerson;
  let senior: ChatPerson;
  let chat: ChatConversation;
  let first: ChatMessage;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const send = (t: string, body: Record<string, unknown>) =>
    http().post(`/api/v1/chat/conversations/${chat.id}/messages`).set(bearer(t)).send(body);
  const page = async (t: string, q = '') =>
    (
      await http()
        .get(`/api/v1/chat/conversations/${chat.id}/messages${q}`)
        .set(bearer(t))
        .expect(200)
    ).body as ChatMessagesPage;

  /** Opens /live/stream as the web does and collects the chat frames. */
  const open = async (t: string) => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/v1/live/stream`, {
      headers: { ...bearer(t), accept: 'text/event-stream' },
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    const events: (ChatLiveEvent & { frame: string })[] = [];
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
          for (const f of frames)
            if (f.event.startsWith('chat.')) events.push({ ...JSON.parse(f.data), frame: f.event });
        }
      } catch {
        /* aborted */
      }
    })();
    return {
      events,
      until: async (pred: (e: ChatLiveEvent) => boolean, ms = 5_000): Promise<ChatLiveEvent> => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const hit = events.find(pred);
          if (hit) return hit;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`No chat event in ${ms} ms; got ${JSON.stringify(events)}`);
      },
      close: async () => {
        ctrl.abort();
        await pump;
      },
    };
  };

  /** A tiny real PNG / PDF / WebM, base64. */
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
  const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]).toString(
    'base64',
  );

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    [pa, sy, mx, mp] = await Promise.all([
      token('partner.a@dhvaj.in'),
      token('senior.y@dhvaj.in'),
      token('manager.x@dhvaj.in'),
      token('mp@dhvaj.in'),
    ]);
    const live = app.get(LiveEventsService);
    for (let i = 0; i < 100 && !live.listening; i++) await new Promise((r) => setTimeout(r, 50));
    expect(live.listening).toBe(true);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists the people you can message, never yourself', async () => {
    const people = (await http().get('/api/v1/chat/people').set(bearer(pa)).expect(200))
      .body as ChatPerson[];
    senior = people.find((p) => p.role === 'senior')!;
    expect(senior).toMatchObject({ name: expect.any(String), online: expect.any(Boolean) });
    const fromY = (await http().get('/api/v1/chat/people').set(bearer(sy)).expect(200))
      .body as ChatPerson[];
    partner = fromY.find((p) => p.role === 'partner' && people.every((q) => q.id !== p.id))!;
    expect(partner).toBeTruthy();
    expect(fromY.map((p) => p.id)).not.toContain(senior.id);
  });

  it('opens one chat per pair, from either side', async () => {
    chat = (
      await http()
        .post('/api/v1/chat/conversations')
        .set(bearer(pa))
        .send({ employeeId: senior.id })
        .expect(200)
    ).body as ChatConversation;
    expect(chat).toMatchObject({ other: { id: senior.id }, lastMessage: null, unread: 0 });
    const again = (
      await http()
        .post('/api/v1/chat/conversations')
        .set(bearer(sy))
        .send({ employeeId: partner.id })
        .expect(200)
    ).body as ChatConversation;
    expect(again.id).toBe(chat.id);
    await http()
      .post('/api/v1/chat/conversations')
      .set(bearer(pa))
      .send({ employeeId: partner.id })
      .expect(400);
  });

  it('sends with one tick; Y’s portal receiving it makes two; A hears it live', async () => {
    const a = await open(pa);
    const y = await open(sy);
    try {
      const ref = '7d0c2a8e-2f7e-4c6b-9a51-0d6f1b3c9e11';
      first = (await send(pa, { body: 'Is the GSTR-1 ready?', clientRef: ref }).expect(201))
        .body as ChatMessage;
      expect(first).toMatchObject({ mine: true, tick: 'sent', body: 'Is the GSTR-1 ready?' });
      // A retried send is the same message.
      const retry = (await send(pa, { body: 'Is the GSTR-1 ready?', clientRef: ref }).expect(201))
        .body as ChatMessage;
      expect(retry.id).toBe(first.id);

      const got = await y.until((e) => e.kind === CHAT_LIVE_EVENT.message);
      expect(got).toMatchObject({
        conversationId: chat.id,
        fromId: partner.id,
        message: { id: first.id, mine: false, body: 'Is the GSTR-1 ready?' },
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(a.events.filter((e) => e.kind === CHAT_LIVE_EVENT.message)).toEqual([]);

      await http()
        .post('/api/v1/chat/delivered')
        .set(bearer(sy))
        .send({ messageIds: [first.id] })
        .expect(200, { delivered: 1 });
      const r = await a.until((e) => e.kind === CHAT_LIVE_EVENT.receipt);
      expect(r.receipt).toMatchObject({ messageIds: [first.id], tick: 'delivered' });
      // The sender cannot turn their own ticks.
      await http()
        .post('/api/v1/chat/delivered')
        .set(bearer(pa))
        .send({ messageIds: [first.id] })
        .expect(200, { delivered: 0 });
    } finally {
      await a.close();
      await y.close();
    }
  });

  it('shows the unread count, then two blue ticks once Y opens the chat', async () => {
    const unread = (await http().get('/api/v1/chat/unread').set(bearer(sy)).expect(200))
      .body as ChatUnread;
    expect(unread.messages).toBeGreaterThanOrEqual(1);
    const list = (await http().get('/api/v1/chat/conversations').set(bearer(sy)).expect(200))
      .body as ChatConversation[];
    expect(list[0]).toMatchObject({ id: chat.id, unread: 1, other: { id: partner.id } });

    const a = await open(pa);
    try {
      await http()
        .post(`/api/v1/chat/conversations/${chat.id}/read`)
        .set(bearer(sy))
        .expect(200, { read: 1 });
      const r = await a.until((e) => e.receipt?.tick === 'read');
      expect(r.receipt!.messageIds).toEqual([first.id]);
    } finally {
      await a.close();
    }
    const mine = await page(pa);
    expect(mine.items.find((m) => m.id === first.id)).toMatchObject({
      tick: 'read',
      deliveredAt: expect.any(String),
      readAt: expect.any(String),
    });
    expect(
      ((await http().get('/api/v1/chat/unread').set(bearer(sy)).expect(200)).body as ChatUnread)
        .messages,
    ).toBe(0);
  });

  it('Y’s typing reaches A; nothing is kept', async () => {
    const a = await open(pa);
    try {
      await http().post(`/api/v1/chat/conversations/${chat.id}/typing`).set(bearer(sy)).expect(204);
      const t = await a.until((e) => e.kind === CHAT_LIVE_EVENT.typing);
      expect(t).toMatchObject({ conversationId: chat.id, fromId: senior.id });
    } finally {
      await a.close();
    }
  });

  it('shows Y online while their portal is open, and last seen after', async () => {
    const y = await open(sy);
    await new Promise((r) => setTimeout(r, 300));
    const on = (
      await http().get(`/api/v1/chat/conversations/${chat.id}`).set(bearer(pa)).expect(200)
    ).body as ChatConversation;
    expect(on.other).toMatchObject({ online: true, lastSeenAt: expect.any(String) });
    await y.close();
    // The stream's close marks them offline.
    let off = on;
    for (let i = 0; i < 40 && off.other.online; i++) {
      await new Promise((r) => setTimeout(r, 100));
      off = (await http().get(`/api/v1/chat/conversations/${chat.id}`).set(bearer(pa)).expect(200))
        .body as ChatConversation;
    }
    expect(off.other).toMatchObject({ online: false, lastSeenAt: expect.any(String) });
  });

  it('shares a photo, a voice note and a PDF; refuses what is not what it says', async () => {
    const photo = (
      await send(sy, {
        body: 'The challan',
        attachment: {
          kind: 'image',
          fileName: 'challan.png',
          contentType: 'image/png',
          contentBase64: PNG,
        },
      }).expect(201)
    ).body as ChatMessage;
    expect(photo.attachment).toMatchObject({
      kind: 'image',
      fileName: 'challan.png',
      sizeBytes: Buffer.from(PNG, 'base64').length,
    });

    const voice = (
      await send(sy, {
        attachment: {
          kind: 'voice',
          fileName: 'voice.webm',
          contentType: 'audio/webm;codecs=opus',
          contentBase64: WEBM,
          durationMs: 4200,
        },
      }).expect(201)
    ).body as ChatMessage;
    expect(voice.attachment).toMatchObject({
      kind: 'voice',
      contentType: 'audio/webm',
      durationMs: 4200,
    });

    const pdf = (
      await send(pa, {
        attachment: {
          kind: 'document',
          fileName: '../../Form 16.pdf',
          contentType: 'application/pdf',
          contentBase64: PDF,
        },
      }).expect(201)
    ).body as ChatMessage;
    expect(pdf.attachment).toMatchObject({ kind: 'document', fileName: 'Form 16.pdf' });

    const img = await http()
      .get(`/api/v1/chat/messages/${photo.id}/file`)
      .set(bearer(pa))
      .expect(200);
    expect(img.headers['content-type']).toMatch(/image\/png/);
    expect(img.headers['content-disposition']).toMatch(/^inline/);
    const doc = await http()
      .get(`/api/v1/chat/messages/${pdf.id}/file`)
      .set(bearer(sy))
      .expect(200);
    expect(doc.headers['content-disposition']).toMatch(/^attachment; filename="Form 16.pdf"/);

    // A "PDF" that is not one; a type the kind does not take; a voice note with no length.
    await send(pa, {
      attachment: {
        kind: 'document',
        fileName: 'x.pdf',
        contentType: 'application/pdf',
        contentBase64: PNG,
      },
    }).expect(400);
    await send(pa, {
      attachment: {
        kind: 'image',
        fileName: 'x.exe',
        contentType: 'application/x-msdownload',
        contentBase64: PNG,
      },
    }).expect(400);
    await send(pa, {
      attachment: {
        kind: 'voice',
        fileName: 'v.webm',
        contentType: 'audio/webm',
        contentBase64: WEBM,
      },
    }).expect(400);
    await send(pa, { body: '   ' }).expect(400);
  });

  it('pages back through older messages', async () => {
    const newest = await page(pa, '?limit=2');
    expect(newest.items).toHaveLength(2);
    expect(newest.hasMore).toBe(true);
    const older = await page(pa, `?limit=50&before=${newest.items[0]!.id}`);
    expect(older.items.map((m) => m.id)).toContain(first.id);
    expect(older.items.every((m) => m.createdAt <= newest.items[0]!.createdAt)).toBe(true);
  });

  it('is seen by its two people only — not a manager, not the Managing Partner', async () => {
    for (const t of [mx, mp]) {
      await http().get(`/api/v1/chat/conversations/${chat.id}`).set(bearer(t)).expect(404);
      await http().get(`/api/v1/chat/conversations/${chat.id}/messages`).set(bearer(t)).expect(404);
      await http()
        .post(`/api/v1/chat/conversations/${chat.id}/messages`)
        .set(bearer(t))
        .send({ body: 'hi' })
        .expect(404);
      await http().get(`/api/v1/chat/messages/${first.id}/file`).set(bearer(t)).expect(404);
      const list = (await http().get('/api/v1/chat/conversations').set(bearer(t)).expect(200))
        .body as ChatConversation[];
      expect(list.map((c) => c.id)).not.toContain(chat.id);
    }
    // Nor can anyone else mark it read.
    await http().post(`/api/v1/chat/conversations/${chat.id}/read`).set(bearer(mx)).expect(404);
  });
});

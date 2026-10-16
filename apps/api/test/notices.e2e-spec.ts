import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { Notice, NoticeListResponse, NoticeType, NotificationItem } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/**
 * Practice Services PS-101 — the notice register's API: record, list, change
 * (versioned), events and their effect on status and hearing, void, close,
 * papers, and the type library. RLS: the engagement team sees a notice; anyone
 * else gets a 404.
 */
describe('Notices (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;
  let sy: string;
  let emp006: string;
  let eng: string;
  let today: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const daysFrom = (iso: string, n: number) =>
    new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const employeeId = async (code: string): Promise<string> =>
    (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = $1`, [
        code,
      ])
    ).rows[0]!.id;
  const tinyPdf = Buffer.from('%PDF-1.4\n% notice\n').toString('base64');

  const create = async (
    t: string,
    body: Record<string, unknown> = {},
    expected = 201,
  ): Promise<Notice> =>
    (
      await http()
        .post('/api/v1/notices')
        .set(bearer(t))
        .send({
          engagementId: eng,
          noticeTypeCode: 'IT_143_2',
          referenceNo: `ITBA/SCR/${unique()}`,
          issuedOn: daysFrom(today, -5),
          receivedOn: daysFrom(today, -4),
          ...body,
        })
        .expect(expected)
    ).body as Notice;
  const event = async (
    t: string,
    n: Notice,
    body: Record<string, unknown>,
    expected = 201,
  ): Promise<Notice> =>
    (
      await http()
        .post(`/api/v1/notices/${n.id}/events`)
        .set(bearer(t))
        .send({ version: n.version, occurredOn: today, ...body })
        .expect(expected)
    ).body as Notice;

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    today = (
      await su.query<{ d: string }>(`SELECT timezone('Asia/Kolkata', now())::date::text AS d`)
    ).rows[0]!.d;
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    emp006 = await employeeId('EMP006');

    const acme = await http().get('/api/v1/entities?search=Acme&limit=10').set(bearer(mp));
    const client = await freshClient(acme.body.items[0].id as string);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          kind: 'compliance',
          entityId: client,
          status: 'accepted',
          financialYear: '2026-27',
          streams: ['gst', 'income_tax', 'tds'],
          years: [{ financialYear: '2026-27' }],
        })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(pa))
      .send({ employeeId: emp006, roleOnEngagement: 'in_charge' })
      .expect(201);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('records a notice with the default reply date and owner, and tells the owner', async () => {
    const n = await create(pa, {
      ownerId: emp006,
      servedVia: 'email',
      amountDemanded: '125000.50',
    });
    expect(n.status).toBe('received');
    expect(n.replyDueOn).toBe(daysFrom(today, 10)); // issued − 5 + 15 days
    expect(n.internalDueOn).not.toBeNull();
    expect(n.internalDueOn! <= n.replyDueOn!).toBe(true);
    expect(n.clock).toMatchObject({ label: 'Reply due', due: n.internalDueOn, overdue: false });
    expect(n.ownerId).toBe(emp006);
    expect(n.noticeType.code).toBe('IT_143_2');
    expect(n.amountDemanded).toBe('125000.50');
    expect(n.can).toEqual({ edit: true, appeal: false, startAppealClock: false });
    expect(n.events).toEqual([]);

    const inbox = (await http().get('/api/v1/notifications?limit=100').set(bearer(sy)).expect(200))
      .body.items as NotificationItem[];
    const note = inbox.find((i) => i.type === 'notice_received' && i.objectId === n.id);
    expect(note).toBeDefined();
    expect(note!.title).toContain(n.referenceNo);

    const mine = await create(sy);
    expect(mine.ownerId).toBe(emp006);
  });

  it('lists notices by clock, filtered and searched, paging with a cursor', async () => {
    const tag = unique();
    const a = await create(sy, { referenceNo: `LST-${tag}-A`, replyDueOn: daysFrom(today, 20) });
    const b = await create(sy, { referenceNo: `LST-${tag}-B`, replyDueOn: daysFrom(today, 5) });
    const c = await create(sy, { referenceNo: `LST-${tag}-C`, replyDueOn: null });

    const all = (
      await http().get(`/api/v1/notices?search=LST-${tag}&status=open`).set(bearer(sy)).expect(200)
    ).body as NoticeListResponse;
    expect(all.items.map((i) => i.id)).toEqual([b.id, a.id, c.id]);
    expect(all.items[2]!.clock).toBeNull();

    const page1 = (
      await http().get(`/api/v1/notices?search=LST-${tag}&limit=2`).set(bearer(sy)).expect(200)
    ).body as NoticeListResponse;
    expect(page1.items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (
      await http()
        .get(`/api/v1/notices?search=LST-${tag}&limit=2&cursor=${page1.nextCursor}`)
        .set(bearer(sy))
        .expect(200)
    ).body as NoticeListResponse;
    expect(page2.items.map((i) => i.id)).toEqual([c.id]);
    expect(page2.nextCursor).toBeNull();

    const soon = (
      await http()
        .get(`/api/v1/notices?search=LST-${tag}&dueBefore=${daysFrom(today, 7)}`)
        .set(bearer(sy))
        .expect(200)
    ).body as NoticeListResponse;
    expect(soon.items.map((i) => i.id)).toEqual([b.id]);

    const byEng = (
      await http()
        .get(`/api/v1/notices?engagementId=${eng}&stream=income_tax&ownerId=${emp006}&limit=100`)
        .set(bearer(sy))
        .expect(200)
    ).body as NoticeListResponse;
    expect(byEng.items.map((i) => i.id)).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
    const mine = (
      await http().get(`/api/v1/notices?search=LST-${tag}&ownerId=me`).set(bearer(sy)).expect(200)
    ).body as NoticeListResponse;
    expect(mine.items).toHaveLength(3);
    const notMine = (
      await http().get(`/api/v1/notices?search=LST-${tag}&ownerId=me`).set(bearer(pa)).expect(200)
    ).body as NoticeListResponse;
    expect(notMine.items).toEqual([]);
    const gst = (
      await http().get(`/api/v1/notices?search=LST-${tag}&stream=gst`).set(bearer(sy)).expect(200)
    ).body as NoticeListResponse;
    expect(gst.items).toEqual([]);

    await http().get('/api/v1/notices?cursor=nope').set(bearer(sy)).expect(400);
  });

  it('changes a notice with the version read; a stale version is a 409', async () => {
    const n = await create(sy);
    const res = await http()
      .patch(`/api/v1/notices/${n.id}`)
      .set(bearer(sy))
      .send({ version: n.version, summary: 'Mismatch in TDS credit', status: 'in_progress' })
      .expect(200);
    expect(res.body).toMatchObject({ summary: 'Mismatch in TDS credit', status: 'in_progress' });
    expect(res.body.version).toBe(n.version + 1);
    await http()
      .patch(`/api/v1/notices/${n.id}`)
      .set(bearer(sy))
      .send({ version: n.version, summary: 'Late edit' })
      .expect(409);
    await http()
      .patch(`/api/v1/notices/${n.id}`)
      .set(bearer(sy))
      .send({ version: res.body.version, status: 'reply_filed' })
      .expect(400);
  });

  it('hides a notice from anyone off the engagement (404), while the team reads it', async () => {
    const n = await create(pa);
    await http().get(`/api/v1/notices/${n.id}`).set(bearer(sy)).expect(200);
    await http().get(`/api/v1/notices/${n.id}`).set(bearer(mx)).expect(404);
    await http().get(`/api/v1/notices/${n.id}`).set(bearer(pb)).expect(404);
    await http()
      .patch(`/api/v1/notices/${n.id}`)
      .set(bearer(mx))
      .send({ version: n.version, summary: 'x' })
      .expect(404);
    const listed = (
      await http().get(`/api/v1/notices?search=${n.referenceNo}`).set(bearer(pb)).expect(200)
    ).body as NoticeListResponse;
    expect(listed.items).toEqual([]);
    // Not on the team: cannot record a notice there either.
    await create(mx, {}, 404);
  });

  it('refuses a second notice of the same type and reference for the client', async () => {
    const ref = `DUP/${unique()}`;
    await create(sy, { referenceNo: ref });
    const res = await create(sy, { referenceNo: ` ${ref.toLowerCase()} ` }, 409);
    expect(JSON.stringify(res)).toContain('already has a notice');
    // Another type may share the reference.
    await create(sy, { referenceNo: ref, noticeTypeCode: 'IT_142_1' });
  });

  it('applies event effects to the status and next hearing; void re-follows the rest', async () => {
    let n = await create(sy);
    n = await event(sy, n, { kind: 'submission', body: 'Asked the client for ledgers' });
    expect(n.status).toBe('in_progress');
    n = await event(sy, n, { kind: 'reply_filed', ackReference: 'ACK-1' });
    expect(n.status).toBe('reply_filed');
    expect(n.clock).toBeNull(); // the reply is in and no hearing yet
    await event(sy, n, { kind: 'hearing' }, 400);
    const h1 = daysFrom(today, 10);
    const h2 = daysFrom(today, 24);
    n = await event(sy, n, { kind: 'hearing', nextDate: h1 });
    expect(n).toMatchObject({ status: 'hearing_scheduled', nextHearingOn: h1 });
    expect(n.clock).toMatchObject({ label: 'Hearing', due: h1 });
    n = await event(sy, n, { kind: 'adjournment_granted', nextDate: h2 });
    expect(n.nextHearingOn).toBe(h2);
    expect(n.events.map((e) => e.kind)).toEqual([
      'adjournment_granted',
      'hearing',
      'reply_filed',
      'submission',
    ]);
    await event(sy, { ...n, version: n.version - 1 }, { kind: 'note', body: 'stale' }, 409);

    const adj = n.events[0]!;
    await http()
      .post(`/api/v1/notices/${n.id}/events/${adj.id}/void`)
      .set(bearer(sy))
      .send({ version: n.version, reason: '  ' })
      .expect(400);
    await http()
      .post(`/api/v1/notices/${n.id}/events/${adj.id}/void`)
      .set(bearer(sy))
      .send({ version: n.version })
      .expect(400);
    let res = await http()
      .post(`/api/v1/notices/${n.id}/events/${adj.id}/void`)
      .set(bearer(sy))
      .send({ version: n.version, reason: 'Recorded on the wrong notice' })
      .expect(200);
    n = res.body as Notice;
    expect(n).toMatchObject({ status: 'hearing_scheduled', nextHearingOn: h1 });
    expect(n.events.find((e) => e.id === adj.id)).toMatchObject({
      voidReason: 'Recorded on the wrong notice',
      voidedAt: expect.any(String),
    });

    n = await event(sy, n, { kind: 'order', body: 'Assessed as returned' });
    expect(n.status).toBe('order_received');
    expect(n.can.appeal).toBe(false); // IT_143_2 is not appealable
    const order = n.events.find((e) => e.kind === 'order')!;
    res = await http()
      .post(`/api/v1/notices/${n.id}/events/${order.id}/void`)
      .set(bearer(sy))
      .send({ version: n.version, reason: 'Wrong date' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'hearing_scheduled', nextHearingOn: h1 });
    await http()
      .post(`/api/v1/notices/${n.id}/events/${order.id}/void`)
      .set(bearer(sy))
      .send({ version: res.body.version, reason: 'Again' })
      .expect(400);
    await event(sy, res.body as Notice, { kind: 'order', occurredOn: daysFrom(today, 2) }, 400);
  });

  it('closes only with an outcome; a closed notice no longer changes', async () => {
    const n = await create(sy);
    await http()
      .post(`/api/v1/notices/${n.id}/close`)
      .set(bearer(sy))
      .send({ version: n.version, closedOn: today })
      .expect(400);
    const res = await http()
      .post(`/api/v1/notices/${n.id}/close`)
      .set(bearer(sy))
      .send({
        version: n.version,
        outcome: 'demand_reduced',
        outcomeAmount: '1000',
        closedOn: today,
      })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'closed',
      outcome: 'demand_reduced',
      outcomeAmount: '1000.00',
      closedOn: today,
      clock: null,
    });
    await event(sy, res.body as Notice, { kind: 'note', body: 'late' }, 400);
    await http()
      .patch(`/api/v1/notices/${n.id}`)
      .set(bearer(sy))
      .send({ version: res.body.version, summary: 'late' })
      .expect(400);
    const open = (
      await http().get(`/api/v1/notices?search=${n.referenceNo}&status=open`).set(bearer(sy))
    ).body as NoticeListResponse;
    expect(open.items).toEqual([]);
  });

  it('files the notice, the reply and the order under the notice', async () => {
    // Intake order: upload the PDF on the engagement first, then record the notice with it.
    const pre = await http()
      .post(`/api/v1/engagements/${eng}/documents`)
      .set(bearer(pa))
      .send({
        title: 'ASMT-10 scan',
        documentType: 'notice',
        filename: 'asmt10.pdf',
        contentType: 'application/pdf',
        contentBase64: tinyPdf,
      })
      .expect(201);
    const n = await create(pa, { noticeTypeCode: 'GST_ASMT10', documentId: pre.body.id });
    expect(n.documents.map((d) => d.id)).toEqual([pre.body.id]);
    await create(pa, { documentId: pre.body.id }, 400); // already under another notice

    const res = await http()
      .post(`/api/v1/notices/${n.id}/documents`)
      .set(bearer(sy))
      .send({
        documentType: 'reply',
        filename: 'reply.pdf',
        contentType: 'application/pdf',
        contentBase64: tinyPdf,
      })
      .expect(201);
    const after = res.body as Notice;
    expect(after.documents).toHaveLength(2);
    expect(after.documents[0]).toMatchObject({ documentType: 'reply', filename: 'reply.pdf' });
    // The engagement's own upload, filed under the notice (what the web app uses).
    const order = await http()
      .post(`/api/v1/engagements/${eng}/documents`)
      .set(bearer(pa))
      .send({
        title: 'Order',
        documentType: 'order',
        classification: 'internal',
        filename: 'order.pdf',
        contentType: 'application/pdf',
        contentBase64: tinyPdf,
        noticeId: n.id,
      })
      .expect(201);
    const withOrder = (await http().get(`/api/v1/notices/${n.id}`).set(bearer(sy)).expect(200))
      .body as Notice;
    expect(withOrder.documents.find((d) => d.id === order.body.id)).toMatchObject({
      documentType: 'order',
    });
    await http()
      .post(`/api/v1/engagements/${eng}/documents`)
      .set(bearer(pa))
      .send({
        title: 'x',
        documentType: 'other',
        filename: 'x.pdf',
        contentBase64: tinyPdf,
        noticeId: n.id,
      })
      .expect(400);
    await http()
      .post(`/api/v1/notices/${n.id}/documents`)
      .set(bearer(mx))
      .send({ documentType: 'reply', filename: 'x.pdf', contentBase64: tinyPdf })
      .expect(404);
  });

  it('serves the type library to staff; workflow.manage maintains it, versioned', async () => {
    const types = (await http().get('/api/v1/notice-types').set(bearer(sy)).expect(200))
      .body as NoticeType[];
    expect(types.find((t) => t.code === 'GST_DRC07')).toMatchObject({
      appealable: true,
      appealRuleCode: 'GST_APPEAL_LIMITATION',
    });
    const code = `E2E_${unique()}`.slice(0, 40);
    const body = {
      stream: 'other',
      title: 'Municipal notice',
      defaultReplyDays: 10,
      appealable: false,
    };
    await http().put(`/api/v1/notice-types/${code}`).set(bearer(sy)).send(body).expect(403);
    const created = (
      await http().put(`/api/v1/notice-types/${code}`).set(bearer(pa)).send(body).expect(200)
    ).body as NoticeType;
    expect(created).toMatchObject({ code, version: 1, isActive: true });
    await http()
      .put(`/api/v1/notice-types/${code}`)
      .set(bearer(pa))
      .send({ ...body, title: 'No version' })
      .expect(400);
    const updated = (
      await http()
        .put(`/api/v1/notice-types/${code}`)
        .set(bearer(pa))
        .send({ ...body, isActive: false, version: 1 })
        .expect(200)
    ).body as NoticeType;
    expect(updated).toMatchObject({ isActive: false, version: 2 });
    await http()
      .put(`/api/v1/notice-types/${code}`)
      .set(bearer(pa))
      .send({ ...body, version: 1 })
      .expect(409);
    // An inactive type takes no new notices.
    await create(sy, { noticeTypeCode: code }, 400);
  });
});

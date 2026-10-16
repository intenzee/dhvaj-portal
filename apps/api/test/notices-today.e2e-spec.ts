import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { NotificationItem, SearchResponse, TodayView } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/**
 * Practice Services PS-102 — a notice reaches its owner: on Today in the
 * Notices group (by its clock date), in Ctrl K search by reference, and in
 * the bell 7 / 3 / 1 days before the internal reply date and 2 days before a
 * hearing. Recording the reply clears the reminder. Notices are written
 * straight to the table here; the register's own API has its own spec.
 */
describe('Notices on Today, search and the bell (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let mx: string;
  let sy: string;
  let pb: string;
  let emp005: string;
  let eng: string;
  let entityId: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const employeeId = async (code: string): Promise<string> =>
    (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = $1`, [
        code,
      ])
    ).rows[0]!.id;
  const today = async (t: string): Promise<TodayView> =>
    (await http().get('/api/v1/work/today').set(bearer(t)).expect(200)).body as TodayView;
  const inbox = async (t: string): Promise<NotificationItem[]> =>
    (await http().get('/api/v1/notifications?limit=100').set(bearer(t)).expect(200)).body
      .items as NotificationItem[];
  const scan = () => http().post('/api/v1/notifications/scan').set(bearer(mp)).expect(201);

  /** A notice owned by Manager X, its internal reply date `replyIn` days from today (IST). */
  const notice = async (
    ref: string,
    opts: { replyIn?: number; hearingIn?: number; status?: string } = {},
  ): Promise<string> => {
    const { rows } = await su.query<{ id: string }>(
      `WITH d AS (SELECT timezone('Asia/Kolkata', now())::date AS today)
       INSERT INTO hsdg.notices
         (entity_id, engagement_id, notice_type_id, reference_no, issued_on, received_on,
          reply_due_on, internal_due_override, next_hearing_on, owner_employee_id, status,
          outcome, closed_on)
       SELECT $1, $2, (SELECT id FROM hsdg.notice_types WHERE code = 'GST_ASMT10'), $3,
              d.today - 10, d.today - 9, d.today + 30,
              CASE WHEN $4::int IS NULL THEN NULL ELSE d.today + $4::int END,
              CASE WHEN $5::int IS NULL THEN NULL ELSE d.today + $5::int END,
              $6, $7,
              CASE WHEN $7 = 'closed' THEN 'dropped' END,
              CASE WHEN $7 = 'closed' THEN d.today END
         FROM d
       RETURNING id`,
      [
        entityId,
        eng,
        ref,
        opts.replyIn ?? null,
        opts.hearingIn ?? null,
        emp005,
        opts.status ?? 'received',
      ],
    );
    return rows[0]!.id;
  };

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    const pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    emp005 = await employeeId('EMP005');

    entityId = await freshClient(
      (await http().get('/api/v1/entities?search=Bharat&limit=100').set(bearer(mp))).body.items[0]
        .id as string,
    );
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `NT${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    await http()
      .patch(`/api/v1/engagements/${eng}`)
      .set(bearer(mp))
      .send({ engagementManagerEmployeeId: emp005 })
      .expect(200);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it("lists the owner's running notices on Today, earliest clock first, opening the notice", async () => {
    const ref = `ZD${unique()}`;
    const later = await notice(`${ref}-L`, { replyIn: 6 });
    const sooner = await notice(`${ref}-S`, { replyIn: 2 });
    const hearing = await notice(`${ref}-H`, { hearingIn: 4, status: 'reply_filed' });
    const closed = await notice(`${ref}-C`, { replyIn: 1, status: 'closed' });

    const view = await today(mx);
    expect(view.groups.map((g) => g.group)).toEqual([
      'prepare',
      'review',
      'notices',
      'waiting',
      'due_soon',
    ]);
    const mine = view.groups
      .find((g) => g.group === 'notices')!
      .items.filter((i) => i.notice?.referenceNo.startsWith(ref));
    expect(mine.map((i) => i.notice!.id)).toEqual([sooner, hearing, later]);
    expect(mine.map((i) => i.notice!.clockLabel)).toEqual(['Reply due', 'Hearing', 'Reply due']);
    expect(mine[0]).toMatchObject({
      kind: 'notice',
      key: `notice:${sooner}`,
      engagementId: eng,
      isOverdue: false,
      link: { engagementId: eng, noticeId: sooner },
    });
    expect(mine.find((i) => i.notice!.id === closed)).toBeUndefined();

    // Not Senior Y's notice: not on their Today.
    const theirs = (await today(sy)).groups.find((g) => g.group === 'notices')!.items;
    expect(theirs.filter((i) => i.notice?.referenceNo.startsWith(ref))).toHaveLength(0);
  });

  it('finds a notice by its reference in search, for the team only', async () => {
    const ref = `DIN${unique()}`;
    const id = await notice(ref, { replyIn: 9 });
    const res = (
      await http()
        .get(`/api/v1/search?q=${encodeURIComponent(ref.toLowerCase())}`)
        .set(bearer(mx))
        .expect(200)
    ).body as SearchResponse;
    const hits = res.groups.find((g) => g.group === 'notices')?.items ?? [];
    expect(hits).toEqual([
      expect.objectContaining({
        id,
        href: `/notices/${id}`,
        link: expect.objectContaining({ noticeId: id }),
      }),
    ]);
    // Partner B (the other office, not on the team) cannot see it.
    const other = (await http().get(`/api/v1/search?q=${ref}`).set(bearer(pb)).expect(200))
      .body as SearchResponse;
    expect(other.groups.find((g) => g.group === 'notices')).toBeUndefined();
  });

  it('nudges the owner before the reply and the hearing; the reply clears it; re-runs never repeat', async () => {
    const ref = `RM${unique()}`;
    const inThree = await notice(`${ref}-3`, { replyIn: 3 });
    const inSix = await notice(`${ref}-6`, { replyIn: 6 });
    const farOff = await notice(`${ref}-F`, { replyIn: 20 });
    const hearing = await notice(`${ref}-H`, { hearingIn: 1, status: 'hearing_scheduled' });

    await scan();
    await scan();
    const about = (items: NotificationItem[], id: string, type: string) =>
      items.filter((n) => n.objectId === id && n.type === type);
    let items = await inbox(mx);
    expect(about(items, inThree, 'notice_reply_due')).toHaveLength(1);
    expect(about(items, inThree, 'notice_reply_due')[0]).toMatchObject({
      kind: 'actionable',
      status: 'unread',
      link: expect.objectContaining({ noticeId: inThree }),
    });
    expect(about(items, inSix, 'notice_reply_due')).toHaveLength(1);
    expect(about(items, farOff, 'notice_reply_due')).toHaveLength(0);
    expect(about(items, hearing, 'notice_hearing_due')).toHaveLength(1);
    expect(about(items, hearing, 'notice_hearing_due')[0]!.title).toMatch(/^Hearing tomorrow/);

    // The reply is filed (as an event would set it): its reminder is done.
    await su.query(`UPDATE hsdg.notices SET status = 'reply_filed' WHERE id = $1`, [inThree]);
    // The hearing is adjourned to a later date: the old nudge is done.
    await su.query(`UPDATE hsdg.notices SET next_hearing_on = next_hearing_on + 20 WHERE id = $1`, [
      hearing,
    ]);
    items = await inbox(mx);
    expect(about(items, inThree, 'notice_reply_due')[0]).toMatchObject({ status: 'read' });
    expect(about(items, inThree, 'notice_reply_due')[0]!.resolvedAt).not.toBeNull();
    expect(about(items, hearing, 'notice_hearing_due')[0]!.resolvedAt).not.toBeNull();
    expect(about(items, inSix, 'notice_reply_due')[0]).toMatchObject({ status: 'unread' });

    // Closing clears whatever is left.
    await su.query(
      `UPDATE hsdg.notices SET status = 'closed', outcome = 'dropped', closed_on = received_on
        WHERE id = $1`,
      [inSix],
    );
    items = await inbox(mx);
    expect(about(items, inSix, 'notice_reply_due')[0]!.resolvedAt).not.toBeNull();
  });
});

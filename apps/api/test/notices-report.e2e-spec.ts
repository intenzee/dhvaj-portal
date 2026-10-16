import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';
import { istToday } from '../src/modules/engagements/time/auto-time';
import { FeatureFlagsService } from '../src/common/feature-flags/feature-flags.service';

/**
 * PS-105 — the partners' notices report. Notices are seeded as the superuser
 * on two engagements, each serviced from an office of its own (so the totals
 * are exact whatever else the suite left behind): Partner A leads the first,
 * Partner B the second. The Managing Partner sees both offices; each partner
 * only their own engagement's notices; ?officeId= narrows to one office.
 */
describe('Notices report for partners (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let sy: string;
  let officeA: string;
  let officeB: string;
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tag = `${Date.now().toString(36).toUpperCase()}`.slice(-6);
  const today = istToday();
  const day = (n: number): string => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const report = (t: string, officeId?: string) =>
    http()
      .get(`/api/v1/reports/notices${officeId ? `?officeId=${officeId}` : ''}`)
      .set(bearer(t));

  const engagementIn = async (
    lead: string,
    clientSearch: string,
    officeId: string,
  ): Promise<{ engagementId: string; entityId: string }> => {
    const entityId = await freshClient(
      (await http().get(`/api/v1/entities?search=${clientSearch}&limit=100`).set(bearer(mp))).body
        .items[0].id as string,
    );
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    const engagementId = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(lead))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `NR${tag}${clientSearch.slice(0, 3)}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    await su.query(`UPDATE hsdg.engagements SET office_id = $2 WHERE id = $1`, [
      engagementId,
      officeId,
    ]);
    return { engagementId, entityId };
  };

  const notice = async (
    key: string,
    on: { engagementId: string; entityId: string },
    n: {
      type: string;
      status: string;
      receivedOn: string;
      amount?: string | null;
      replyDueOn?: string | null;
      nextHearingOn?: string | null;
      outcome?: string | null;
      outcomeAmount?: string | null;
    },
  ): Promise<void> => {
    const r = await su.query<{ id: string }>(
      `INSERT INTO hsdg.notices
         (entity_id, engagement_id, notice_type_id, reference_no, issued_on, received_on,
          amount_demanded, reply_due_on, next_hearing_on, owner_employee_id, status, outcome,
          outcome_amount, closed_on)
       SELECT $1, $2, t.id, $4, $5, $5, $6, $7, $8,
              (SELECT id FROM hsdg.employees WHERE employee_code = 'EMP003'),
              $9, $10, $11, CASE WHEN $9 = 'closed' THEN $5::date + 30 END
         FROM hsdg.notice_types t WHERE t.code = $3
       RETURNING id`,
      [
        on.entityId,
        on.engagementId,
        n.type,
        `REF-${tag}-${key}`,
        n.receivedOn,
        n.amount ?? null,
        n.replyDueOn ?? null,
        n.nextHearingOn ?? null,
        n.status,
        n.outcome ?? null,
        n.outcomeAmount ?? null,
      ],
    );
    ids[key] = r.rows[0]!.id;
  };
  const replyFiled = (key: string, engagementId: string, occurredOn: string, voided = false) =>
    su.query(
      `INSERT INTO hsdg.notice_events (notice_id, engagement_id, kind, occurred_on,
                                       voided_at, void_reason)
       VALUES ($1, $2, 'reply_filed', $3, $4, $5)`,
      [ids[key], engagementId, occurredOn, voided ? new Date() : null, voided ? 'wrong' : null],
    );

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');

    const office = async (code: string, name: string) =>
      (
        await su.query<{ id: string }>(
          `INSERT INTO hsdg.offices (code, name) VALUES ($1, $2) RETURNING id`,
          [code, name],
        )
      ).rows[0]!.id;
    officeA = await office(`NA${tag}`, `Notices A ${tag}`);
    officeB = await office(`NB${tag}`, `Notices B ${tag}`);

    const a = await engagementIn(pa, 'Bharat', officeA);
    const b = await engagementIn(pb, 'Coastal', officeB);

    // Office A — three open, two closed, one withdrawn.
    await notice('a1', a, {
      type: 'GST_ASMT10',
      status: 'received',
      receivedOn: day(-10),
      amount: '100000.00',
      replyDueOn: day(5),
    });
    await notice('a2', a, {
      type: 'IT_143_2',
      status: 'in_progress',
      receivedOn: day(-5),
      replyDueOn: day(40),
    });
    await notice('a3', a, {
      type: 'GST_DRC01',
      status: 'hearing_scheduled',
      receivedOn: day(-30),
      amount: '250000.50',
      replyDueOn: day(-1),
      nextHearingOn: day(3),
    });
    await notice('a4', a, {
      type: 'GST_DRC07',
      status: 'closed',
      receivedOn: day(-90),
      amount: '500000.00',
      outcome: 'demand_reduced',
      outcomeAmount: '120000.25',
    });
    await notice('a5', a, {
      type: 'IT_156',
      status: 'closed',
      receivedOn: day(-60),
      amount: '80000.00',
      outcome: 'dropped',
      outcomeAmount: '0.00',
    });
    await notice('a6', a, {
      type: 'IT_245',
      status: 'withdrawn',
      receivedOn: day(-20),
      amount: '999.00',
      replyDueOn: day(1),
    });
    // a4: first reply 10 days after receipt (a later one does not count).
    await replyFiled('a4', a.engagementId, day(-80));
    await replyFiled('a4', a.engagementId, day(-70));
    // a5: a voided reply on day 2 is ignored; the real one is day 6.
    await replyFiled('a5', a.engagementId, day(-58), true);
    await replyFiled('a5', a.engagementId, day(-54));

    // Office B — one overdue open TDS notice, one closed.
    await notice('b1', b, {
      type: 'TDS_200A',
      status: 'received',
      receivedOn: day(-20),
      amount: '12340.00',
      replyDueOn: day(-2),
    });
    await notice('b2', b, {
      type: 'TDS_154',
      status: 'closed',
      receivedOn: day(-40),
      amount: '5000.00',
      outcome: 'rectified',
      outcomeAmount: '0.00',
    });
    await replyFiled('b2', b.engagementId, day(-36));
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it("matches the seeded notices for one office (the engagement's office)", async () => {
    const res = await report(mp, officeA).expect(200);
    const r = res.body;
    expect(r.asOf).toBe(today);
    expect(r.open).toEqual({
      total: 3,
      amountDemanded: '350000.50',
      byStream: [
        { stream: 'gst', count: 2, amountDemanded: '350000.50' },
        { stream: 'income_tax', count: 1, amountDemanded: '0.00' },
      ],
      byStatus: expect.arrayContaining([
        { status: 'received', count: 1 },
        { status: 'in_progress', count: 1 },
        { status: 'hearing_scheduled', count: 1 },
      ]),
      byOffice: [
        {
          officeId: officeA,
          officeName: `Notices A ${tag}`,
          count: 3,
          amountDemanded: '350000.50',
        },
      ],
    });
    expect(r.open.byStatus).toHaveLength(3);
    expect(r.closed).toEqual({
      count: 2,
      amountDemanded: '580000.00',
      outcomeAmount: '120000.25',
      byOutcome: expect.arrayContaining([
        {
          outcome: 'demand_reduced',
          count: 1,
          amountDemanded: '500000.00',
          outcomeAmount: '120000.25',
        },
        { outcome: 'dropped', count: 1, amountDemanded: '80000.00', outcomeAmount: '0.00' },
      ]),
    });
    expect(r.closed.byOutcome).toHaveLength(2);
    // (10 + 6) / 2.
    expect(r.avgDaysToReply).toBe(8);
  });

  it('lists what falls due within 7 days on the notice clock, soonest first', async () => {
    const r = (await report(mp, officeA).expect(200)).body;
    // a1: the firm's date ahead of the reply on day +5; a3: the hearing on day +3.
    // a2 (day +40) is not due; a6 is withdrawn.
    expect(r.dueSoon.map((n: { id: string }) => n.id).sort()).toEqual([ids.a1, ids.a3].sort());
    const dues = r.dueSoon.map((n: { clock: { due: string } }) => n.clock.due);
    expect([...dues].sort()).toEqual(dues);
    const a3 = r.dueSoon.find((n: { id: string }) => n.id === ids.a3);
    expect(a3).toEqual(
      expect.objectContaining({
        referenceNo: `REF-${tag}-a3`,
        engagementCode: expect.any(String),
        entityName: expect.any(String),
        ownerName: 'Partner A',
        amountDemanded: '250000.50',
        noticeType: expect.objectContaining({ code: 'GST_DRC01', stream: 'gst' }),
        clock: { due: day(3), label: 'Hearing', daysLeft: 3, overdue: false },
      }),
    );
    const a1 = r.dueSoon.find((n: { id: string }) => n.id === ids.a1);
    expect(a1.clock.label).toBe('Reply due');
    expect(a1.clock.due <= day(5)).toBe(true);
  });

  it('shows an overdue notice as due, and the other office its own figures', async () => {
    const r = (await report(mp, officeB).expect(200)).body;
    expect(r.open.total).toBe(1);
    expect(r.open.amountDemanded).toBe('12340.00');
    expect(r.open.byStream).toEqual([{ stream: 'tds', count: 1, amountDemanded: '12340.00' }]);
    expect(r.dueSoon).toHaveLength(1);
    expect(r.dueSoon[0].id).toBe(ids.b1);
    expect(r.dueSoon[0].clock.overdue).toBe(true);
    expect(r.closed.count).toBe(1);
    expect(r.closed.amountDemanded).toBe('5000.00');
    expect(r.avgDaysToReply).toBe(4);
  });

  it('gives the Managing Partner both offices', async () => {
    const r = (await report(mp).expect(200)).body;
    const byId = new Map(
      r.open.byOffice.map((o: { officeId: string }) => [o.officeId, o] as const),
    );
    expect(byId.get(officeA)).toEqual(
      expect.objectContaining({ count: 3, amountDemanded: '350000.50' }),
    );
    expect(byId.get(officeB)).toEqual(
      expect.objectContaining({ count: 1, amountDemanded: '12340.00' }),
    );
    expect(r.open.total).toBeGreaterThanOrEqual(4);
  });

  it("scopes by RLS: each partner sees only their own engagement's notices", async () => {
    const a = (await report(pa).expect(200)).body;
    const aOffices = a.open.byOffice.map((o: { officeId: string }) => o.officeId);
    expect(aOffices).toContain(officeA);
    expect(aOffices).not.toContain(officeB);
    expect(a.dueSoon.map((n: { id: string }) => n.id)).not.toContain(ids.b1);

    const b = (await report(pb).expect(200)).body;
    const bOffices = b.open.byOffice.map((o: { officeId: string }) => o.officeId);
    expect(bOffices).toEqual([officeB]);
    expect(b.open.total).toBe(1);

    // The other office, filtered, is empty for a partner not on its engagements.
    const none = (await report(pa, officeB).expect(200)).body;
    expect(none).toEqual({
      asOf: today,
      open: { total: 0, amountDemanded: '0.00', byStream: [], byStatus: [], byOffice: [] },
      dueSoon: [],
      closed: { count: 0, amountDemanded: '0.00', outcomeAmount: '0.00', byOutcome: [] },
      avgDaysToReply: null,
    });
    expect((await report(pb, officeA).expect(200)).body.open.total).toBe(0);
  });

  it('needs report.read (403), a UUID office (400), and ff_notices (404 when off)', async () => {
    await report(sy).expect(403);
    await http().get('/api/v1/reports/notices?officeId=north').set(bearer(mp)).expect(400);
    const flags = app.get(FeatureFlagsService);
    flags.setRules(new Map([['ff_notices', { mode: 'off', officeCodes: new Set<string>() }]]));
    try {
      await report(mp).expect(404);
    } finally {
      flags.setRules(new Map());
    }
  });
});

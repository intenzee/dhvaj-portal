import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { AppealNoticeResponse, Notice } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/**
 * Practice Services PS-103 — after the order. An order on an appealable notice
 * records a 'notice_order' compliance event on the Compliance engagement; the
 * type's limitation rule generates the "Appeal by" filing (GST: three calendar
 * months; income tax: 30 days) and its date becomes the notice's clock. Voiding
 * the order takes the filing away; "Appeal" opens an Assignment engagement.
 */
describe('Notices — the appeal clock (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let sy: string;
  let eng: string;
  let today: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysFrom = (d: string, n: number) => iso(new Date(parse(d).getTime() + n * 86_400_000));
  /** Calendar months, clamped to the month end (31 Jan + 3 → 30 Apr). */
  const monthsFrom = (d: string, n: number) => {
    const x = parse(d);
    const m = x.getUTCMonth() + n;
    const y = x.getUTCFullYear() + Math.floor(m / 12);
    const mm = ((m % 12) + 12) % 12;
    const last = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(y, mm, Math.min(x.getUTCDate(), last))));
  };

  const create = async (t: string, code: string): Promise<Notice> =>
    (
      await http()
        .post('/api/v1/notices')
        .set(bearer(t))
        .send({
          engagementId: eng,
          noticeTypeCode: code,
          referenceNo: `ORD/${unique()}`,
          issuedOn: daysFrom(today, -20),
          receivedOn: daysFrom(today, -19),
        })
        .expect(201)
    ).body as Notice;
  const order = async (t: string, n: Notice, occurredOn = today, expected = 201) =>
    (
      await http()
        .post(`/api/v1/notices/${n.id}/events`)
        .set(bearer(t))
        .send({ version: n.version, kind: 'order', occurredOn })
        .expect(expected)
    ).body as Notice;
  const voidEvent = async (t: string, n: Notice, eventId: string, expected = 200) =>
    (
      await http()
        .post(`/api/v1/notices/${n.id}/events/${eventId}/void`)
        .set(bearer(t))
        .send({ version: n.version, reason: 'Recorded against the wrong notice' })
        .expect(expected)
    ).body as Notice;
  const filing = async (instanceId: string) =>
    (
      await su.query<{
        code: string;
        due: string;
        status: string;
        details: Record<string, unknown>;
        voided: boolean;
      }>(
        `SELECT r.code, ci.statutory_deadline::text AS due, ci.workflow_status AS status,
                ce.details, ce.voided_at IS NOT NULL AS voided
           FROM hsdg.compliance_instances ci
           JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
           JOIN hsdg.compliance_events ce ON ce.id = ci.compliance_event_id
          WHERE ci.id = $1`,
        [instanceId],
      )
    ).rows[0]!;

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
    sy = await token('senior.y@dhvaj.in');
    const emp006 = (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = 'EMP006'`)
    ).rows[0]!.id;

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

  it('a GST order starts the three-month appeal filing, and the clock reads "Appeal by"', async () => {
    const n = await order(pa, await create(pa, 'GST_DRC07'));
    expect(n.status).toBe('order_received');
    expect(n.appealDueOn).toBe(monthsFrom(today, 3));
    expect(n.clock).toMatchObject({ label: 'Appeal by', due: n.appealDueOn });
    expect(n.can.appeal).toBe(true);
    const f = await filing(n.appealInstanceId!);
    expect(f).toMatchObject({
      code: 'GST_APPEAL_LIMITATION',
      due: n.appealDueOn,
      status: 'not_started',
      voided: false,
      details: { noticeId: n.id, appealRuleCode: 'GST_APPEAL_LIMITATION' },
    });
    // The calendar does not void it behind the notice's back.
    const ce = await su.query<{ id: string }>(
      `SELECT compliance_event_id AS id FROM hsdg.compliance_instances WHERE id = $1`,
      [n.appealInstanceId],
    );
    await http()
      .delete(`/api/v1/engagements/${eng}/compliance-events/${ce.rows[0]!.id}`)
      .set(bearer(pa))
      .send({ reason: 'tidy' })
      .expect(400);
  });

  it('an income-tax order gives 30 days; a TDS order runs on the TDS stream', async () => {
    const orderedOn = daysFrom(today, -5);
    const it = await order(pa, await create(pa, 'IT_156'), orderedOn);
    expect(it.appealDueOn).toBe(daysFrom(orderedOn, 30));
    expect((await filing(it.appealInstanceId!)).code).toBe('IT_APPEAL_LIMITATION');

    const tds = await order(pa, await create(pa, 'TDS_201'));
    expect(tds.appealDueOn).toBe(daysFrom(today, 30));
    expect((await filing(tds.appealInstanceId!)).code).toBe('TDS_APPEAL_LIMITATION');
  });

  it('two orders the same day each get their own filing', async () => {
    const a = await order(pa, await create(pa, 'GST_DRC07'));
    const b = await order(pa, await create(pa, 'GST_DRC07'));
    expect(a.appealInstanceId).not.toBe(b.appealInstanceId);
    expect(a.appealDueOn).toBe(b.appealDueOn);
  });

  it('voiding the order takes the filing away; it can be recorded again', async () => {
    let n = await order(pa, await create(pa, 'GST_DRC07'));
    const instanceId = n.appealInstanceId!;
    const ev = n.events.find((e) => e.kind === 'order')!;
    n = await voidEvent(pa, n, ev.id);
    expect(n).toMatchObject({ status: 'received', appealDueOn: null, appealInstanceId: null });
    expect(n.can.appeal).toBe(false);
    expect(await filing(instanceId)).toMatchObject({ status: 'not_applicable', voided: true });

    n = await order(pa, n);
    expect(n.appealDueOn).toBe(monthsFrom(today, 3));
    expect(n.appealInstanceId).not.toBe(instanceId);
    // One order at a time.
    await order(pa, n, today, 400);
  });

  it('a non-appealable order changes the status only', async () => {
    const before = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.compliance_events WHERE engagement_id = $1`,
      [eng],
    );
    const n = await order(sy, await create(sy, 'IT_143_2'));
    expect(n).toMatchObject({
      status: 'order_received',
      appealDueOn: null,
      appealInstanceId: null,
    });
    expect(n.clock).toBeNull();
    expect(n.can.appeal).toBe(false);
    const after = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.compliance_events WHERE engagement_id = $1`,
      [eng],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('an appealable order is recorded by the engagement partner or manager', async () => {
    const n = await create(sy, 'GST_DRC07');
    await order(sy, n, today, 403);
    const still = (await http().get(`/api/v1/notices/${n.id}`).set(bearer(sy)).expect(200))
      .body as Notice;
    expect(still).toMatchObject({ status: 'received', events: [] });
  });

  it('appeal opens the Assignment engagement, due on the limitation date', async () => {
    let n = await order(pa, await create(pa, 'GST_DRC07'));
    await http()
      .post(`/api/v1/notices/${n.id}/appeal`)
      .set(bearer(pa))
      .send({ version: n.version - 1 })
      .expect(409);
    const res = (
      await http()
        .post(`/api/v1/notices/${n.id}/appeal`)
        .set(bearer(pa))
        .send({ version: n.version, note: 'Strong case on limitation' })
        .expect(200)
    ).body as AppealNoticeResponse;
    expect(res.engagementCode).toBeTruthy();
    n = res.notice;
    expect(n).toMatchObject({
      status: 'appealed',
      appealEngagementId: res.engagementId,
      appealEngagementCode: res.engagementCode,
      clock: null,
      can: { edit: true, appeal: false },
    });
    const appealEng = await su.query<{
      kind: string;
      planned_end_date: string;
      service: string;
      entity_id: string;
    }>(
      `SELECT e.kind, e.planned_end_date::text, s.code AS service, e.entity_id
         FROM hsdg.engagements e JOIN hsdg.services s ON s.id = e.service_id WHERE e.id = $1`,
      [res.engagementId],
    );
    expect(appealEng.rows[0]).toMatchObject({
      kind: 'assignment',
      planned_end_date: n.appealDueOn,
      service: 'GST_APPEAL_MATTER',
      entity_id: n.entityId,
    });
    await http()
      .post(`/api/v1/notices/${n.id}/appeal`)
      .set(bearer(pa))
      .send({ version: n.version })
      .expect(409);
    const ev = n.events.find((e) => e.kind === 'order')!;
    await voidEvent(pa, n, ev.id, 400);
  });

  it('only an order of an appealable type can be appealed', async () => {
    const n = await order(sy, await create(sy, 'IT_143_2'));
    await http()
      .post(`/api/v1/notices/${n.id}/appeal`)
      .set(bearer(pa))
      .send({ version: n.version })
      .expect(400);
    const open = await create(pa, 'GST_DRC07');
    await http()
      .post(`/api/v1/notices/${open.id}/appeal`)
      .set(bearer(pa))
      .send({ version: open.version })
      .expect(400);
  });
});

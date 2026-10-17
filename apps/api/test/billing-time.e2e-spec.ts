import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  BillableTimeEntry,
  BillableTimeReport,
  InvoiceDetail,
  InvoiceTimeEntry,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../src/common/feature-flags/feature-flags.service';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * PS-206 (fix) · Bill from time, billed once.
 *
 * "Bill from time" drafted lines from billable hours but never marked the
 * hours billed. Now every entry drafted onto an invoice is held in
 * time_billings (its billed_invoice_id): it is not listed as unbilled again,
 * a second draft of it is refused with a plain 400, two racing drafts cannot
 * both take it, and voiding the invoice or taking the line off the draft
 * releases it. Without ff_billing_v2 the routes are not there and the old
 * invoice API keeps working for the shipped mobile app.
 */
describe('PS-206 (fix) bill from time, billed once (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let sy: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const superuser = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  const findId = async (path: string): Promise<string> => {
    const res = await http().get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };

  let today: string;

  /** A fresh NORTH client and an engagement Partner A leads, with its primary stream line. */
  const engagement = async (): Promise<{ eng: string; serviceLine: string }> => {
    const bharat = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=GST_MONTHLY&limit=100');
    const entityId = await freshClient(bharat);
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `P${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    const eng = res.body.id as string;
    const { rows } = await superuser((c) =>
      c.query<{ id: string }>(
        `SELECT id FROM hsdg.engagement_services WHERE engagement_id = $1 AND is_primary`,
        [eng],
      ),
    );
    return { eng, serviceLine: rows[0]!.id };
  };

  /** Partner A logs other time today; returns the entry id. */
  const logTime = async (
    eng: string,
    minutes: number,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await http()
      .post(`/api/v1/engagements/${eng}/time/other`)
      .set(bearer(pa))
      .send({ category: 'client_call', minutes, date: today, ...extra })
      .expect(201);
    return res.body.id as string;
  };

  const list = async (eng: string, t = pa): Promise<BillableTimeReport> =>
    (await http().get(`/api/v1/billing/engagements/${eng}/time`).set(bearer(t)).expect(200))
      .body as BillableTimeReport;
  const entryOf = async (eng: string, id: string): Promise<BillableTimeEntry | undefined> =>
    (await list(eng)).entries.find((e) => e.entryId === id);
  const draft = (
    t: string,
    eng: string,
    entryIds: string[],
    rates: { stream: string; ratePerHour: string }[] = [{ stream: 'none', ratePerHour: '2000' }],
  ) =>
    http()
      .post(`/api/v1/billing/engagements/${eng}/time/draft`)
      .set(bearer(t))
      .send({ entryIds, rates, period: 'October 2026' });
  const setStatus = (eng: string, inv: string, body: Record<string, string>) =>
    http().post(`/api/v1/engagements/${eng}/invoices/${inv}/status`).set(bearer(pa)).send(body);
  const openRows = async (entryId: string): Promise<number> =>
    (
      await superuser((c) =>
        c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM hsdg.time_billings
            WHERE time_entry_id = $1 AND released_at IS NULL`,
          [entryId],
        ),
      )
    ).rows[0]!.n;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    const { rows } = await superuser((c) =>
      c.query<{ d: string }>(`SELECT timezone('Asia/Kolkata', now())::date::text AS d`),
    );
    today = rows[0]!.d;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists billable time only, drafts a line per stream, and never bills an entry twice', async () => {
    const { eng, serviceLine } = await engagement();
    const a = await logTime(eng, 90);
    const b = await logTime(eng, 30, { engagementServiceId: serviceLine });
    const nb = await logTime(eng, 45, { isBillable: false });

    const before = await list(eng);
    expect(before.entries.map((e) => e.entryId).sort()).toEqual([a, b].sort());
    expect(before.entries.every((e) => e.status === 'unbilled')).toBe(true);
    expect(before.unbilledSeconds).toBe(120 * 60);
    const stream = before.entries.find((e) => e.entryId === b)!.stream;

    const made = (
      await draft(
        pa,
        eng,
        [a, b],
        [
          { stream: 'none', ratePerHour: '2000' },
          { stream, ratePerHour: '3000' },
        ],
      ).expect(201)
    ).body as InvoiceDetail;
    expect(made).toMatchObject({ status: 'draft', engagementId: eng });
    const qty = made.lines.map((l) => [l.quantity, l.unitAmount]).sort();
    expect(qty).toEqual(
      stream === 'none'
        ? [['2.00', '2000.00']]
        : [
            ['0.50', '3000.00'],
            ['1.50', '2000.00'],
          ],
    );
    expect(made.lines[0]!.description).toMatch(/professional time \(October 2026\)$/);

    // Billed state, and on which invoice (billed_invoice_id).
    const after = await list(eng);
    for (const id of [a, b]) {
      const e = after.entries.find((x) => x.entryId === id)!;
      expect(e).toMatchObject({ status: 'billed', invoiceId: made.id, invoiceStatus: 'draft' });
      expect(made.lines.map((l) => l.id)).toContain(e.invoiceLineId);
    }
    expect(after.unbilledSeconds).toBe(0);
    expect(after.billedSeconds).toBe(120 * 60);
    const { rows } = await superuser((c) =>
      c.query<{ billed_invoice_id: string }>(
        `SELECT billed_invoice_id FROM hsdg.time_billings WHERE time_entry_id = ANY($1::uuid[])`,
        [[a, b]],
      ),
    );
    expect(rows.map((r) => r.billed_invoice_id)).toEqual([made.id, made.id]);

    // The lines say which entries they cover.
    const covered = (
      await http().get(`/api/v1/billing/invoices/${made.id}/time`).set(bearer(pa)).expect(200)
    ).body as InvoiceTimeEntry[];
    expect(covered.map((c) => c.entryId).sort()).toEqual([a, b].sort());
    expect(covered.find((c) => c.entryId === a)).toMatchObject({
      seconds: 5400,
      ratePerHour: '2000.00',
      released: false,
      employeeName: 'Partner A',
    });

    // A second draft is refused in plain words — also once issued.
    const again = await draft(pa, eng, [a]).expect(400);
    expect(again.body.message).toMatch(
      /Already on a live invoice: Partner A, .*1\.50 h on a draft invoice/,
    );
    await setStatus(eng, made.id, { status: 'issued' }).expect(201);
    const issued = await draft(pa, eng, [a]).expect(400);
    expect(issued.body.message).toMatch(/on INV\//);
    expect(await openRows(a)).toBe(1);

    // Non-billable and other engagements' time is refused too.
    await draft(pa, eng, [nb]).expect(400);
    const other = await engagement();
    await draft(pa, other.eng, [a]).expect(400);
  });

  it('voiding the invoice releases its time; taking the line off the draft releases it too', async () => {
    const { eng } = await engagement();
    const a = await logTime(eng, 60);
    const first = (await draft(pa, eng, [a]).expect(201)).body as InvoiceDetail;
    await setStatus(eng, first.id, { status: 'issued' }).expect(201);
    await setStatus(eng, first.id, { status: 'void', reason: 'Wrong rate agreed' }).expect(201);
    expect(await entryOf(eng, a)).toMatchObject({ status: 'unbilled', invoiceId: null });
    expect(await openRows(a)).toBe(0);
    // The voided invoice still shows what it covered, released.
    const covered = (
      await http().get(`/api/v1/billing/invoices/${first.id}/time`).set(bearer(pa)).expect(200)
    ).body as InvoiceTimeEntry[];
    expect(covered).toEqual([expect.objectContaining({ entryId: a, released: true })]);

    // Bills afresh; a discarded draft releases it as well.
    const second = (await draft(pa, eng, [a]).expect(201)).body as InvoiceDetail;
    await setStatus(eng, second.id, { status: 'void' }).expect(201);
    expect((await entryOf(eng, a))!.status).toBe('unbilled');

    // Taking the line off the draft frees the entry.
    const third = (await draft(pa, eng, [a]).expect(201)).body as InvoiceDetail;
    expect((await entryOf(eng, a))!.status).toBe('billed');
    await http()
      .delete(`/api/v1/engagements/${eng}/invoices/${third.id}/lines/${third.lines[0]!.id}`)
      .set(bearer(pa))
      .expect((r) => expect(r.status).toBeLessThan(300));
    expect((await entryOf(eng, a))!.status).toBe('unbilled');
    expect(await openRows(a)).toBe(0);
    await draft(pa, eng, [a]).expect(201);
  });

  it('two drafts racing for the same time: one wins', async () => {
    const { eng } = await engagement();
    const a = await logTime(eng, 60);
    const b = await logTime(eng, 30);
    const race = await Promise.all([draft(pa, eng, [a, b]), draft(mp, eng, [b])]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await openRows(a)).toBeLessThanOrEqual(1);
    expect(await openRows(b)).toBe(1);
  });

  it('the database refuses time on an issued invoice, twice, or from another engagement', async () => {
    const { eng } = await engagement();
    const a = await logTime(eng, 60);
    const made = (await draft(pa, eng, [a]).expect(201)).body as InvoiceDetail;
    const line = made.lines[0]!.id;
    const insert = (entry: string, invoice: string, invoiceLine: string, engagementId = eng) =>
      superuser((c) =>
        c.query(
          `INSERT INTO hsdg.time_billings
             (engagement_id, client_entity_id, time_entry_id, seconds, rate_per_hour,
              billed_invoice_id, invoice_line_id)
           SELECT $1, e.entity_id, $2, 60, 100, $3, $4 FROM hsdg.engagements e WHERE e.id = $1`,
          [engagementId, entry, invoice, invoiceLine],
        ),
      );
    // The unique index: the entry is already on this draft.
    await expect(insert(a, made.id, line)).rejects.toMatchObject({ code: '23505' });
    // Another engagement's entry.
    const other = await engagement();
    const x = await logTime(other.eng, 30);
    await expect(insert(x, made.id, line)).rejects.toThrow(/not this engagement/);
    // An issued invoice.
    const y = await logTime(eng, 30);
    await setStatus(eng, made.id, { status: 'issued' }).expect(201);
    await expect(insert(y, made.id, line)).rejects.toThrow(/draft invoice only/);
    // Released once, and only released.
    await expect(
      superuser((c) =>
        c.query(`UPDATE hsdg.time_billings SET seconds = 1 WHERE time_entry_id = $1`, [a]),
      ),
    ).rejects.toThrow(/only be released/);
  });

  it('a correction to billed time waits until the invoice frees it', async () => {
    const { eng } = await engagement();
    const a = await logTime(eng, 60);
    const made = (await draft(pa, eng, [a]).expect(201)).body as InvoiceDetail;
    const { rows } = await superuser((c) =>
      c.query<{ started_at: Date; ended_at: Date }>(
        `SELECT started_at, ended_at FROM hsdg.engagement_time_entries WHERE id = $1`,
        [a],
      ),
    );
    const body = {
      startedAt: rows[0]!.started_at.toISOString(),
      endedAt: new Date(rows[0]!.ended_at.getTime() - 10 * 60_000).toISOString(),
      reason: 'Call was shorter',
    };
    await http().post(`/api/v1/time/${a}/adjust`).set(bearer(pa)).send(body).expect(409);
    await setStatus(eng, made.id, { status: 'void' }).expect(201);
    await http().post(`/api/v1/time/${a}/adjust`).set(bearer(pa)).send(body).expect(201);
    expect(await entryOf(eng, a)).toMatchObject({ seconds: 50 * 60, status: 'unbilled' });
  });

  it('needs billing.manage to draft, a rate for every stream chosen, and the flag', async () => {
    const { eng } = await engagement();
    const a = await logTime(eng, 60);
    await draft(sy, eng, [a]).expect(403);
    const noRate = await draft(pa, eng, [a], [{ stream: 'gst', ratePerHour: '2000' }]).expect(400);
    expect(noRate.body.message).toMatch(/Type an hourly rate for No stream/);
    await draft(pa, eng, [a], [{ stream: 'none', ratePerHour: 'free' }]).expect(400);
    await draft(pa, '00000000-0000-4000-8000-000000000000', [a]).expect(404);

    const flags = app.get(FeatureFlagsService);
    flags.setRules(new Map([['ff_billing_v2', { mode: 'off', officeCodes: new Set<string>() }]]));
    try {
      await http().get(`/api/v1/billing/engagements/${eng}/time`).set(bearer(pa)).expect(404);
      await draft(pa, eng, [a]).expect(404);
      // The shipped mobile app's invoice API is unchanged.
      await http()
        .post(`/api/v1/engagements/${eng}/invoices`)
        .set(bearer(pa))
        .send({ lines: [{ description: 'Professional time', quantity: '1', unitAmount: '2000' }] })
        .expect(201);
    } finally {
      flags.setRules(new Map());
    }
    expect((await entryOf(eng, a))!.status).toBe('unbilled');
  });
});

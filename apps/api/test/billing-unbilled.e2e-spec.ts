import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  FeeMilestone,
  InvoiceDetail,
  UnbilledEngagement,
  UnbilledReport,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * PS-206 · Unbilled fixed fees into a draft invoice.
 *
 * Done when: a partner turns last month's retainer into a draft invoice in two
 * clicks. Also: a period is never on two live invoices (even when two drafts
 * race), voiding the invoice or taking the line off the draft releases it,
 * and the list keeps to the offices that bill the client. The gaps: a period
 * billed outside the app is set aside with a reason and can be restored; a
 * fee agreed on a milestone or an event joins the list on its date.
 */
describe('PS-206 unbilled fees into a draft invoice (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let pb: string;
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

  /** `YYYY-MM` the given number of months from asOf's month. */
  const monthOf = (asOf: string, delta: number): string => {
    const [y, m] = asOf.split('-').map(Number) as [number, number];
    const t = y * 12 + (m - 1) + delta;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  };

  const unbilled = async (t: string, query = ''): Promise<UnbilledReport> =>
    (await http().get(`/api/v1/billing/unbilled${query}`).set(bearer(t)).expect(200))
      .body as UnbilledReport;
  const rowOf = async (eng: string, t = pa): Promise<UnbilledEngagement | undefined> =>
    (await unbilled(t)).engagements.find((e) => e.engagementId === eng);
  const draft = (t: string, engagementId: string, keys: string[]) =>
    http().post('/api/v1/billing/unbilled/draft').set(bearer(t)).send({ engagementId, keys });
  const setAside = (t: string, engagementId: string, keys: string[], reason = 'Billed in Tally') =>
    http()
      .post('/api/v1/billing/unbilled/set-aside')
      .set(bearer(t))
      .send({ engagementId, keys, reason });
  const restore = (t: string, engagementId: string, key: string) =>
    http().post('/api/v1/billing/unbilled/restore').set(bearer(t)).send({ engagementId, key });
  const milestones = async (eng: string): Promise<FeeMilestone[]> =>
    (
      await http()
        .get(`/api/v1/billing/engagements/${eng}/fee-milestones`)
        .set(bearer(pa))
        .expect(200)
    ).body as FeeMilestone[];
  const addMilestone = (t: string, eng: string, body: Record<string, string>) =>
    http().post(`/api/v1/billing/engagements/${eng}/fee-milestones`).set(bearer(t)).send(body);

  /** A fresh NORTH client, an engagement Partner A leads, and a monthly ₹20,000 retainer from two months back. */
  const retainer = async (withRetainer = true): Promise<{ eng: string; asOf: string }> => {
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
    const { asOf } = await unbilled(pa);
    if (!withRetainer) return { eng, asOf };
    await http()
      .patch(`/api/v1/engagements/${eng}/commercial`)
      .set(bearer(pa))
      .send({
        billingFrequency: 'monthly',
        effectiveDate: `${monthOf(asOf, -2)}-10`,
        retainerAmount: '20000.00',
      })
      .expect(200);
    return { eng, asOf };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it("puts last month's retainer on a draft in two clicks, never twice; voiding releases it", async () => {
    const { eng, asOf } = await retainer();
    const row = (await rowOf(eng))!;
    const last = `retainer:${monthOf(asOf, -1)}`;
    expect(row.items.map((i) => i.key)).toEqual([
      `retainer:${monthOf(asOf, -2)}`,
      last,
      `retainer:${monthOf(asOf, 0)}`,
    ]);
    expect(row).toMatchObject({ total: '60000.00', serviceName: expect.any(String) });
    const item = row.items[1]!;
    expect(item).toMatchObject({ source: 'retainer', amount: '20000.00' });
    expect(item.ageDays).toBeGreaterThan(0);

    // Click two: the draft.
    const made = (await draft(pa, eng, [last]).expect(201)).body as InvoiceDetail;
    expect(made).toMatchObject({ status: 'draft', engagementId: eng, subtotal: '20000.00' });
    expect(made.lines).toHaveLength(1);
    expect(made.lines[0]!.description).toBe(`${row.serviceName} — ${item.label}`);

    // Gone from the list, and refused a second time.
    expect((await rowOf(eng))!.items.map((i) => i.key)).not.toContain(last);
    await draft(pa, eng, [last]).expect(400);

    // Issued then voided: unbilled again, and it drafts afresh.
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${made.id}/status`)
      .set(bearer(pa))
      .send({ status: 'issued' })
      .expect(201);
    await draft(pa, eng, [last]).expect(400);
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${made.id}/status`)
      .set(bearer(pa))
      .send({ status: 'void', reason: 'Wrong client contact' })
      .expect(201);
    expect((await rowOf(eng))!.items.map((i) => i.key)).toContain(last);
    const again = (await draft(pa, eng, [last]).expect(201)).body as InvoiceDetail;

    // Taking the line off the draft releases it too.
    await http()
      .delete(`/api/v1/engagements/${eng}/invoices/${again.id}/lines/${again.lines[0]!.id}`)
      .set(bearer(pa))
      .expect((r) => expect(r.status).toBeLessThan(300));
    expect((await rowOf(eng))!.items.map((i) => i.key)).toContain(last);

    // Two drafts racing for the same period: one wins.
    const race = await Promise.all([draft(pa, eng, [last]), draft(mp, eng, [last])]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 400]);
    const { rows } = await superuser((c) =>
      c.query(
        `SELECT count(*)::int AS n FROM hsdg.fee_billings
          WHERE engagement_id = $1 AND period_key = $2 AND released_at IS NULL`,
        [eng, last],
      ),
    );
    expect(rows[0].n).toBe(1);
  });

  it('a draft takes several periods at once, oldest first; unknown periods are refused', async () => {
    const { eng, asOf } = await retainer();
    const keys = [`retainer:${monthOf(asOf, -1)}`, `retainer:${monthOf(asOf, -2)}`];
    const made = (await draft(pa, eng, keys).expect(201)).body as InvoiceDetail;
    expect(made.subtotal).toBe('40000.00');
    expect(made.lines.map((l) => l.sortOrder)).toEqual([0, 1]);
    expect(made.lines[0]!.description).toMatch(new RegExp(`${monthOf(asOf, -2).slice(0, 4)}$`));
    await draft(pa, eng, ['retainer:1999-01']).expect(400);
    await draft(pa, '00000000-0000-4000-8000-000000000000', ['retainer:1999-01']).expect(404);
    await draft(pa, eng, []).expect(400);
  });

  it('keeps to the offices that bill the client, the partner filter, and fixed fees only', async () => {
    const { eng } = await retainer();
    expect(await rowOf(eng, mp)).toBeDefined();
    expect(await rowOf(eng, pb)).toBeUndefined();
    await http().get('/api/v1/billing/unbilled').set(bearer(sy)).expect(403);
    await draft(sy, eng, ['retainer:x']).expect(403);
    await draft(pb, eng, ['retainer:x']).expect((r) => expect([400, 404]).toContain(r.status));

    const { rows } = await superuser((c) =>
      c.query<{ a: string; b: string }>(
        `SELECT (SELECT engagement_partner_id FROM hsdg.engagements WHERE id = $1) AS a,
                (SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id
                  WHERE u.email = 'partner.b@dhvaj.in') AS b`,
        [eng],
      ),
    );
    const mine = await unbilled(mp, `?partnerId=${rows[0]!.a}`);
    expect(mine.engagements.some((e) => e.engagementId === eng)).toBe(true);
    const theirs = await unbilled(mp, `?partnerId=${rows[0]!.b}`);
    expect(theirs.engagements.some((e) => e.engagementId === eng)).toBe(false);
    expect(mine.notes.join(' ')).toMatch(/PS-302/);

    await superuser((c) =>
      c.query(`UPDATE hsdg.engagements SET billing_model = 'time_and_material' WHERE id = $1`, [
        eng,
      ]),
    );
    expect(await rowOf(eng)).toBeUndefined();
  });

  it('the database refuses a fee on an issued invoice or a line of another invoice', async () => {
    const { eng, asOf } = await retainer();
    const key = `retainer:${monthOf(asOf, -1)}`;
    const made = (await draft(pa, eng, [key]).expect(201)).body as InvoiceDetail;
    const other = (
      await http()
        .post(`/api/v1/engagements/${eng}/invoices`)
        .set(bearer(pa))
        .send({ lines: [{ description: 'Other', unitAmount: '10.00' }] })
        .expect(201)
    ).body as InvoiceDetail;
    const insert = (invoiceId: string, lineId: string, periodKey: string) =>
      superuser((c) =>
        c.query(
          `INSERT INTO hsdg.fee_billings
             (engagement_id, client_entity_id, period_key, period_start, period_end, amount,
              billed_invoice_id, invoice_line_id)
           SELECT $1, i.client_entity_id, $4, current_date, current_date, 1, $2, $3
             FROM hsdg.invoices i WHERE i.id = $2`,
          [eng, invoiceId, lineId, periodKey],
        ),
      );
    await expect(insert(made.id, other.lines[0]!.id, 'x:1')).rejects.toThrow(/not on this/);
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${made.id}/status`)
      .set(bearer(pa))
      .send({ status: 'issued' })
      .expect(201);
    await expect(insert(made.id, made.lines[0]!.id, 'x:2')).rejects.toThrow(/draft invoice only/);
  });

  it('sets a period aside as billed outside the app, with a reason, and restores it', async () => {
    const { eng, asOf } = await retainer();
    const old = `retainer:${monthOf(asOf, -2)}`;
    await setAside(pa, eng, [old], 'ab').expect(400);
    await setAside(sy, eng, [old]).expect(403);
    await setAside(pa, eng, [old], 'Billed in Tally before the switch').expect(201);

    const row = (await rowOf(eng))!;
    expect(row.items.map((i) => i.key)).not.toContain(old);
    expect(row.setAside).toEqual([
      expect.objectContaining({
        key: old,
        amount: '20000.00',
        reason: 'Billed in Tally before the switch',
        label: expect.stringMatching(/\d{4}$/),
        byName: expect.any(String),
      }),
    ]);
    // Neither billed nor set aside twice.
    await draft(pa, eng, [old]).expect(400);
    await setAside(pa, eng, [old]).expect(400);

    // Only an engagement lead restores; once.
    await restore(pb, eng, old).expect(404);
    await restore(pa, eng, old).expect(201);
    await restore(pa, eng, old).expect(404);
    const back = (await rowOf(eng))!;
    expect(back.items.map((i) => i.key)).toContain(old);
    expect(back.setAside).toEqual([]);
    await draft(pa, eng, [old]).expect(201);

    // The ledger only ever releases, and only once.
    await expect(
      superuser((c) =>
        c.query(`UPDATE hsdg.fee_billings SET amount = 1 WHERE engagement_id = $1`, [eng]),
      ),
    ).rejects.toThrow(/only be released/);
  });

  it('a fee milestone joins the list on its date, bills once, and cancels only when off invoices', async () => {
    const { eng } = await retainer(false);
    expect(await rowOf(eng)).toBeUndefined();
    await addMilestone(pa, eng, {
      kind: 'milestone',
      description: 'Valuation',
      amount: '0',
      dueOn: '2026-01-01',
    }).expect(400);
    await addMilestone(sy, eng, {
      kind: 'milestone',
      description: 'Valuation',
      amount: '1.00',
      dueOn: '2026-01-01',
    }).expect(403);
    const due = (
      await addMilestone(pa, eng, {
        kind: 'milestone',
        description: 'Valuation report delivered',
        amount: '75000.00',
        dueOn: '2026-01-15',
      }).expect(201)
    ).body as FeeMilestone;
    const later = (
      await addMilestone(pa, eng, {
        kind: 'event',
        description: 'Board meeting attended',
        amount: '5000.00',
        dueOn: '2999-12-31',
      }).expect(201)
    ).body as FeeMilestone;
    expect(due).toMatchObject({ status: 'due', kind: 'milestone', invoiceId: null });
    expect(later.status).toBe('upcoming');

    const key = `milestone:${due.id}`;
    const row = (await rowOf(eng))!;
    expect(row.items).toEqual([
      expect.objectContaining({
        key,
        source: 'milestone',
        label: 'Valuation report delivered',
        amount: '75000.00',
      }),
    ]);
    await draft(pa, eng, [`milestone:${later.id}`]).expect(400);

    const made = (await draft(pa, eng, [key]).expect(201)).body as InvoiceDetail;
    expect(made.lines[0]!.description).toBe(`${row.serviceName} — Valuation report delivered`);
    expect((await milestones(eng)).find((m) => m.id === due.id)).toMatchObject({
      status: 'billed',
      invoiceId: made.id,
    });
    await http()
      .post(`/api/v1/billing/fee-milestones/${due.id}/cancel`)
      .set(bearer(pa))
      .expect(400);

    // Voided: due again. Set aside, then cancelled: gone, and the set-aside let go.
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${made.id}/status`)
      .set(bearer(pa))
      .send({ status: 'void' })
      .expect(201);
    expect((await milestones(eng)).find((m) => m.id === due.id)!.status).toBe('due');
    await setAside(pa, eng, [key], 'Waived by the partner').expect(201);
    expect((await milestones(eng)).find((m) => m.id === due.id)!.status).toBe('set_aside');
    await http()
      .post(`/api/v1/billing/fee-milestones/${due.id}/cancel`)
      .set(bearer(sy))
      .expect(403);
    const cancelled = (
      await http()
        .post(`/api/v1/billing/fee-milestones/${due.id}/cancel`)
        .set(bearer(pa))
        .expect(201)
    ).body as FeeMilestone;
    expect(cancelled.status).toBe('cancelled');
    expect(await rowOf(eng)).toBeUndefined();
    await http()
      .post(`/api/v1/billing/fee-milestones/${due.id}/cancel`)
      .set(bearer(pa))
      .expect(400);
  });
});

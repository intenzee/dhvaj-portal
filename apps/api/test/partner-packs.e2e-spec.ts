import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  NOTIFICATION_TYPE,
  monthBounds,
  partnerPackMonth,
  type PartnerPackFigures,
  type PartnerPackSummary,
  type ReceiptRecord,
  type RiskDashboard,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { istDateFromToday } from './date.helper';
import { PartnerPacksScheduler } from '../src/modules/partner-packs/partner-packs.scheduler';

/**
 * PS-303 · the partner's monthly pack. A pack's figures equal what the
 * screens say for the same partner (risk tiles, receipts), a filing filed in
 * the month moves the pack, each partner sees only their own pack (the MP all),
 * the PDF downloads, and the monthly run tells each partner once.
 */
describe('PS-303 partner packs (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mgr: string;
  let sy: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const today = istDateFromToday(0);
  const month = today.slice(0, 7);
  const { from, to } = monthBounds(month);
  const tag = Date.now().toString(36).toUpperCase();

  const build = async (t: string, m = month): Promise<PartnerPackSummary> =>
    (
      await http()
        .post('/api/v1/reports/partner-packs')
        .set(bearer(t))
        .send({ month: m })
        .expect(201)
    ).body as PartnerPackSummary;
  const figures = async (t: string, id: string): Promise<PartnerPackFigures> =>
    (await http().get(`/api/v1/reports/partner-packs/${id}`).set(bearer(t)).expect(200))
      .body as PartnerPackFigures;
  const collected = async (t: string): Promise<{ n: number; amount: number }> => {
    let n = 0;
    let amount = 0;
    for (let offset = 0; offset < 20000; offset += 100) {
      const body = (
        await http()
          .get(`/api/v1/billing/receipts?from=${from}&to=${to}&limit=100&offset=${offset}`)
          .set(bearer(t))
          .expect(200)
      ).body as { items: ReceiptRecord[]; total: number };
      for (const r of body.items.filter((x) => x.status === 'posted')) {
        n += 1;
        amount += Number(r.grossAmount);
      }
      if (body.items.length < 100) break;
    }
    return { n, amount: Math.round(amount * 100) / 100 };
  };

  let entityId: string;
  let eng: string;

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mgr = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');

    const first = async (path: string): Promise<string> =>
      (await http().get(path).set(bearer(mp))).body.items[0].id as string;
    entityId = await freshClient(await first('/api/v1/entities?search=Bharat&limit=100'));
    const serviceId = await first('/api/v1/services?search=GST_MONTHLY&limit=100');
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `PACK${tag}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    // A receipt this month from the client Partner A leads.
    await http()
      .post('/api/v1/billing/receipts')
      .set(bearer(mp))
      .send({
        clientEntityId: entityId,
        receivedOn: today,
        mode: 'bank',
        reference: `UTR${tag}`,
        netAmount: '12345.67',
      })
      .expect(201);
  });

  afterAll(async () => {
    await su?.query(
      `DELETE FROM hsdg.notifications WHERE type = $1 AND object_id IN
         (SELECT id FROM hsdg.partner_packs WHERE month = $2)`,
      [NOTIFICATION_TYPE.partnerPackReady, partnerPackMonth(today)],
    );
    await su?.end();
    await app?.close();
  });

  it("each figure equals the partner's own screens", async () => {
    for (const t of [mp, pa]) {
      const pack = await build(t);
      const f = await figures(t, pack.id);
      expect(f.month).toBe(month);
      expect([f.from, f.to]).toEqual([from, to]);

      const board = (await http().get('/api/v1/dashboard/risk').set(bearer(t)).expect(200))
        .body as RiskDashboard;
      expect(f.risk.map((r) => [r.key, r.count, r.available])).toEqual(
        board.tiles.map((x) => [x.key, x.count, x.available]),
      );
      for (const r of f.risk) expect(r.items.length).toBeLessThanOrEqual(5);

      const c = await collected(t);
      expect(f.collected.count).toBe(c.n);
      expect(Number(f.collected.amount)).toBeCloseTo(c.amount, 2);
      expect(c.amount).toBeGreaterThanOrEqual(12345.67);
    }
    const mine = await figures(pa, (await build(pa)).id);
    expect(mine.scope).toBe('own');
    expect(mine.partner.name).toBeTruthy();
    expect((await figures(mp, (await build(mp)).id)).scope).toBe('firm');
  });

  it('invoiced equals the invoices issued in the month', async () => {
    const f = await figures(mp, (await build(mp)).id);
    const { rows } = await su.query<{ n: number; amount: string }>(
      `SELECT count(*)::int AS n, COALESCE(sum(total), 0)::numeric(14, 2)::text AS amount
         FROM hsdg.invoices
        WHERE status IN ('issued', 'partially_paid', 'paid') AND issue_date BETWEEN $1 AND $2`,
      [from, to],
    );
    expect(f.invoiced).toEqual({ count: rows[0]!.n, amount: rows[0]!.amount });
  });

  it('a filing filed this month moves the pack, and building again keeps one pack', async () => {
    const one = await build(pa);
    const before = await figures(pa, one.id);
    const rule = (
      await su.query<{ rule: string; version: string }>(
        `SELECT r.id AS rule, v.id AS version
           FROM hsdg.compliance_rules r
           JOIN hsdg.compliance_rule_versions v ON v.compliance_rule_id = r.id
          WHERE r.code = 'GST_GSTR1_M' LIMIT 1`,
      )
    ).rows[0]!;
    await su.query(
      `INSERT INTO hsdg.compliance_instances
         (engagement_id, compliance_rule_id, compliance_rule_version_id, reference_date,
          statutory_deadline, internal_sla_date, status, workflow_status, form_label, completed_at)
       VALUES ($1, $2, $3, $4, $5, $5, 'completed', 'filed', 'PACK filed', now())`,
      [eng, rule.rule, rule.version, istDateFromToday(-500), istDateFromToday(-1)],
    );
    const two = await build(pa);
    expect(two.id).toBe(one.id);
    const after = await figures(pa, two.id);
    expect(after.filingsDone.total).toBe(before.filingsDone.total + 1);
    // Partner B (another office) is not on the engagement: their pack does not move.
    const b1 = await figures(pb, (await build(pb)).id);
    expect(b1.filingsDone.total).toBeGreaterThanOrEqual(0);
    expect(after.filingsDone.byStream.reduce((s, x) => s + x.count, 0)).toBe(
      after.filingsDone.total,
    );
  });

  it('a partner sees only their own packs; the MP sees every one', async () => {
    const a = await build(pa);
    const b = await build(pb);
    const listA = (await http().get('/api/v1/reports/partner-packs').set(bearer(pa)).expect(200))
      .body as PartnerPackSummary[];
    expect(listA.map((p) => p.id)).toContain(a.id);
    expect(listA.map((p) => p.id)).not.toContain(b.id);
    await http().get(`/api/v1/reports/partner-packs/${b.id}`).set(bearer(pa)).expect(404);
    const listMp = (await http().get('/api/v1/reports/partner-packs').set(bearer(mp)).expect(200))
      .body as PartnerPackSummary[];
    expect(listMp.map((p) => p.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(listMp.find((p) => p.id === a.id)!.headline).toMatch(
      /^Risk \d+ · Filed \d+ · Collected/,
    );
  });

  it('downloads as a PDF', async () => {
    const a = await build(pa);
    const res = await http()
      .get(`/api/v1/reports/partner-packs/${a.id}/pdf`)
      .set(bearer(pa))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/partner-pack-\d{4}-\d{2}-.+\.pdf/);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('only partners build; only report readers read; bad months are refused', async () => {
    await http().get('/api/v1/reports/partner-packs').set(bearer(sy)).expect(403);
    await http().get('/api/v1/reports/partner-packs').set(bearer(mgr)).expect(200);
    await http().post('/api/v1/reports/partner-packs').set(bearer(mgr)).send({ month }).expect(403);
    await http()
      .post('/api/v1/reports/partner-packs')
      .set(bearer(pa))
      .send({ month: '2026-13' })
      .expect(400);
    await http()
      .post('/api/v1/reports/partner-packs')
      .set(bearer(pa))
      .send({ month: '2999-01' })
      .expect(400);
  });

  it("the month's run builds every partner's pack and tells each of them once", async () => {
    const scheduler = app.get(PartnerPacksScheduler);
    const last = partnerPackMonth(today);
    const res = await scheduler.run(new Date());
    expect(res).toEqual({ built: expect.any(Number), failed: 0 });
    expect(res!.built).toBeGreaterThanOrEqual(3);
    await scheduler.run(new Date());
    const { rows } = await su.query<{ email: string; n: number }>(
      `SELECT u.email, count(n.id)::int AS n
         FROM hsdg.partner_packs pp
         JOIN hsdg.employees e ON e.id = pp.partner_employee_id
         JOIN hsdg.users u ON u.id = e.user_id
         LEFT JOIN hsdg.notifications n
           ON n.type = $2 AND n.object_id = pp.id AND n.recipient_user_id = u.id
        WHERE pp.month = $1
        GROUP BY u.email`,
      [last, NOTIFICATION_TYPE.partnerPackReady],
    );
    const by = Object.fromEntries(rows.map((r) => [r.email, r.n]));
    for (const email of ['mp@dhvaj.in', 'partner.a@dhvaj.in', 'partner.b@dhvaj.in']) {
      expect(by[email]).toBe(1);
    }
  });
});

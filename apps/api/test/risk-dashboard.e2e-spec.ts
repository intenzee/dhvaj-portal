import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  RISK_TILES,
  riskItemHref,
  type RiskDashboard,
  type RiskItem,
  type RiskTile,
  type RiskTileKey,
  type UnbilledReport,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { istDateFromToday } from './date.helper';

/**
 * PS-301 · the partner risk dashboard. Seeds one item into (and one just
 * outside) each tile's window on a fresh client Partner A leads, then checks
 * each tile's count moves by exactly what was seeded, its item opens the work,
 * Partner B (another office) sees none of it, and only report readers get in.
 */
describe('PS-301 partner risk dashboard (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let sy: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const day = istDateFromToday;
  const tag = Date.now().toString(36).toUpperCase();

  const tile = async (t: string, key: RiskTileKey, limit = 10, offset = 0): Promise<RiskTile> =>
    (
      await http()
        .get(`/api/v1/dashboard/risk/${key}?limit=${limit}&offset=${offset}`)
        .set(bearer(t))
        .expect(200)
    ).body as RiskTile;
  const counts = async (t: string): Promise<Record<RiskTileKey, { n: number; amount: number }>> => {
    const d = (await http().get('/api/v1/dashboard/risk').set(bearer(t)).expect(200))
      .body as RiskDashboard;
    return Object.fromEntries(
      d.tiles.map((x) => [x.key, { n: x.count, amount: Number(x.amount ?? 0) }]),
    ) as Record<RiskTileKey, { n: number; amount: number }>;
  };
  /** Page through a tile until an item matches. */
  const find = async (
    t: string,
    key: RiskTileKey,
    match: (i: RiskItem) => boolean,
  ): Promise<RiskItem | undefined> => {
    for (let offset = 0; offset < 5000; offset += 100) {
      const page = await tile(t, key, 100, offset);
      const hit = page.items.find(match);
      if (hit || page.items.length < 100) return hit;
    }
    return undefined;
  };

  let entityId: string;
  let eng: string;
  let before: Record<RiskTileKey, { n: number; amount: number }>;
  let beforeB: Record<RiskTileKey, { n: number; amount: number }>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
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
          periodLabel: `RISK${tag}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;

    before = await counts(mp);
    beforeB = await counts(pb);

    // ── Filings ─────────────────────────────────────────────────────────
    const rule = (
      await su.query<{ rule: string; version: string }>(
        `SELECT r.id AS rule, v.id AS version
           FROM hsdg.compliance_rules r
           JOIN hsdg.compliance_rule_versions v ON v.compliance_rule_id = r.id
          WHERE r.code = 'GST_GSTR1_M' LIMIT 1`,
      )
    ).rows[0]!;
    const filing = async (key: string, refDay: number, due: string, workflow: string) => {
      const r = await su.query<{ id: string }>(
        `INSERT INTO hsdg.compliance_instances
           (engagement_id, compliance_rule_id, compliance_rule_version_id, reference_date,
            statutory_deadline, internal_sla_date, status, workflow_status, form_label)
         VALUES ($1, $2, $3, $4, $5, $5, 'open', $6, $7) RETURNING id`,
        [eng, rule.rule, rule.version, day(refDay), due, workflow, `RISK ${key}`],
      );
      ids[key] = r.rows[0]!.id;
    };
    await filing('missed', -400, day(-5), 'in_preparation');
    await filing('filedLate', -401, day(-6), 'filed');
    await filing('notStarted', -402, day(3), 'not_started');
    await filing('noReviewer', -403, day(4), 'in_preparation');
    await filing('reviewed', -404, day(4), 'in_preparation');
    await filing('later', -405, day(20), 'not_started');
    // Only the 'reviewed' filing has a reviewer on its task.
    await su.query(`DELETE FROM hsdg.tasks WHERE source_compliance_instance_id = ANY($1::uuid[])`, [
      Object.values(ids),
    ]);
    await su.query(
      `INSERT INTO hsdg.tasks (engagement_id, title, status, source_compliance_instance_id,
                               assigned_to_employee_id, reviewer_employee_id)
       SELECT $1, 'Prepare', 'in_progress', $2, e.id, r.id
         FROM hsdg.employees e, hsdg.employees r
        WHERE e.employee_code = 'EMP006' AND r.employee_code = 'EMP005'`,
      [eng, ids.reviewed],
    );

    // ── Notices ─────────────────────────────────────────────────────────
    const notice = async (
      key: string,
      status: string,
      d: { reply?: string; hearing?: string; appeal?: string },
    ) => {
      const r = await su.query<{ id: string }>(
        `INSERT INTO hsdg.notices
           (entity_id, engagement_id, notice_type_id, reference_no, issued_on, received_on,
            reply_due_on, next_hearing_on, appeal_due_on, owner_employee_id, status)
         SELECT $1, $2, t.id, $3, $4, $4, $5, $6, $7,
                (SELECT id FROM hsdg.employees WHERE employee_code = 'EMP003'), $8
           FROM hsdg.notice_types t ORDER BY t.code LIMIT 1
         RETURNING id`,
        [
          entityId,
          eng,
          `RISK-${tag}-${key}`,
          day(-10),
          d.reply ?? null,
          d.hearing ?? null,
          d.appeal ?? null,
          status,
        ],
      );
      ids[key] = r.rows[0]!.id;
    };
    await notice('reply', 'received', { reply: day(2) });
    await notice('hearing', 'hearing_scheduled', { hearing: day(5) });
    await notice('replyLater', 'in_progress', { reply: day(20) });
    await notice('appeal', 'order_received', { appeal: day(10) });
    await notice('appealLater', 'order_received', { appeal: day(40) });

    // ── Invoices, and a write-off waiting for a partner ─────────────────
    const invoice = async (amount: string, daysPastDue: number): Promise<string> => {
      const d = await http()
        .post(`/api/v1/engagements/${eng}/invoices`)
        .set(bearer(pa))
        .send({
          dueDate: day(15),
          lines: [{ description: 'Professional fees', unitAmount: amount }],
        })
        .expect(201);
      const id = d.body.id as string;
      await http()
        .post(`/api/v1/engagements/${eng}/invoices/${id}/status`)
        .set(bearer(pa))
        .send({ status: 'issued', issueDate: day(0) })
        .expect(201);
      await su.query(`SET session_replication_role = replica`);
      await su.query(`UPDATE hsdg.invoices SET issue_date = $2, due_date = $3 WHERE id = $1`, [
        id,
        day(-daysPastDue - 15),
        day(-daysPastDue),
      ]);
      await su.query(`SET session_replication_role = DEFAULT`);
      return id;
    };
    ids.old = await invoice('1000.00', 100);
    ids.recent = await invoice('500.00', 30);
    await su.query(
      `INSERT INTO hsdg.write_offs (invoice_id, client_entity_id, amount, reason,
                                    requested_by_employee_id)
       SELECT $1, $2, 200, 'Client disputes the travel line', id
         FROM hsdg.employees WHERE employee_code = 'EMP005'`,
      [ids.recent, entityId],
    );
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('sends the nine tiles, in order, each with a link to its list', async () => {
    const d = (await http().get('/api/v1/dashboard/risk').set(bearer(mp)).expect(200))
      .body as RiskDashboard;
    expect(d.asOf).toBe(day(0));
    expect(d.tiles.map((t) => t.key)).toEqual([...RISK_TILES]);
    for (const t of d.tiles) {
      expect(t.href).toMatch(/^\//);
      expect(t.items.length).toBeLessThanOrEqual(10);
      expect(t.items.length).toBeLessThanOrEqual(t.count);
    }
    // The UDIN and DSC registers (PS-304 / PS-305) are in use under ff_registers.
    const registers = d.tiles.filter((t) => t.key === 'dsc' || t.key === 'udin');
    expect(registers.map((t) => t.available)).toEqual([true, true]);
  });

  it('counts exactly what falls in each window', async () => {
    const after = await counts(mp);
    expect(after.missed.n - before.missed.n).toBe(1);
    expect(after.due_unready.n - before.due_unready.n).toBe(2);
    expect(after.notices.n - before.notices.n).toBe(2);
    expect(after.appeals.n - before.appeals.n).toBe(1);
    expect(after.receivables.n - before.receivables.n).toBe(1);
    expect(after.receivables.amount - before.receivables.amount).toBeCloseTo(1000, 2);
    expect(after.approvals.n - before.approvals.n).toBe(1);
    expect(after.approvals.amount - before.approvals.amount).toBeCloseTo(200, 2);
  });

  it('opens each item on the work itself', async () => {
    const missed = await find(mp, 'missed', (i) => i.ref?.instanceId === ids.missed);
    expect(missed).toMatchObject({ dueOn: day(-5), title: expect.stringContaining('RISK missed') });
    expect(riskItemHref(missed!)).toMatch(new RegExp(`^/engagements/${eng}\\?tab=`));

    const why = async (key: string) =>
      (await find(mp, 'due_unready', (i) => i.ref?.instanceId === ids[key]))?.detail;
    expect(await why('notStarted')).toContain('Not started');
    expect(await why('noReviewer')).toContain('No reviewer');
    expect(await why('reviewed')).toBeUndefined();
    expect(await why('later')).toBeUndefined();

    const reply = await find(mp, 'notices', (i) => i.ref?.noticeId === ids.reply);
    // The firm's internal date (set before the department's) is the one that counts.
    const internal = (
      await su.query<{ d: string }>(
        `SELECT COALESCE(internal_due_on, reply_due_on)::text AS d FROM hsdg.notices WHERE id = $1`,
        [ids.reply],
      )
    ).rows[0]!.d;
    expect(internal <= day(2)).toBe(true);
    expect(reply).toMatchObject({ dueOn: internal, detail: expect.stringContaining('Reply due') });
    expect(riskItemHref(reply!)).toBe(`/notices/${ids.reply}`);
    const hearing = await find(mp, 'notices', (i) => i.ref?.noticeId === ids.hearing);
    expect(hearing).toMatchObject({ dueOn: day(5), detail: expect.stringContaining('Hearing') });
    expect(await find(mp, 'notices', (i) => i.ref?.noticeId === ids.replyLater)).toBeUndefined();

    const appeal = await find(mp, 'appeals', (i) => i.ref?.noticeId === ids.appeal);
    expect(appeal?.dueOn).toBe(day(10));

    const owed = await find(mp, 'receivables', (i) => i.href === `/billing/clients/${entityId}`);
    expect(owed).toMatchObject({ amount: '1000.00', dueOn: day(-100) });
    expect(owed!.detail).toContain('100 days past due');

    const writeOff = await find(mp, 'approvals', (i) => i.detail.includes('travel line'));
    expect(writeOff).toMatchObject({ href: '/billing/approvals', amount: '200.00' });
  });

  it("matches the unbilled report's periods over 60 days", async () => {
    const report = (await http().get('/api/v1/billing/unbilled').set(bearer(mp)).expect(200))
      .body as UnbilledReport;
    const aged = report.engagements.flatMap((e) => e.items.filter((i) => i.ageDays > 60));
    const t = await tile(mp, 'unbilled', 100);
    expect(t.count).toBe(aged.length);
    expect(Number(t.amount)).toBeCloseTo(
      aged.reduce((s, i) => s + Number(i.amount), 0),
      2,
    );
  });

  it("keeps Partner A's client off another office partner's tiles", async () => {
    const afterB = await counts(pb);
    for (const k of RISK_TILES) expect(afterB[k].n).toBe(beforeB[k].n);
    // Partner A, who leads it, sees it.
    expect(await find(pa, 'missed', (i) => i.ref?.instanceId === ids.missed)).toBeDefined();
  });

  it('pages a tile, and refuses the wrong tile or a reader without reports', async () => {
    const all = await tile(mp, 'notices', 100);
    if (all.count >= 2) {
      const second = await tile(mp, 'notices', 1, 1);
      expect(second.items).toHaveLength(1);
      expect(second.items[0]).toEqual(all.items[1]);
      expect(second.count).toBe(all.count);
    }
    await http().get('/api/v1/dashboard/risk/nonsense').set(bearer(mp)).expect(404);
    await http().get('/api/v1/dashboard/risk').set(bearer(sy)).expect(403);
    await http().get('/api/v1/dashboard/risk/missed').set(bearer(sy)).expect(403);
  });

  it('the DSC tile counts a token expiring within the month, from the register', async () => {
    const was = await counts(mp);
    const wasB = await counts(pb);
    const token = (
      await http()
        .post('/api/v1/registers/dsc')
        .set(bearer(mp))
        .send({ holderName: `Risk ${tag}`, entityId, validTo: day(5) })
        .expect(201)
    ).body as { id: string };
    const now = await counts(mp);
    expect(now.dsc.n - was.dsc.n).toBe(1);
    expect((await counts(pb)).dsc.n).toBe(wasB.dsc.n);
    const item = await find(mp, 'dsc', (i) => i.ref?.dscId === token.id);
    expect(item).toMatchObject({ dueOn: day(5) });
    expect(riskItemHref(item!)).toMatch(/^\/registers\/dsc/);
    const t = await tile(mp, 'dsc');
    expect(t.href).toBe('/registers/dsc?view=at_risk');
  });
});

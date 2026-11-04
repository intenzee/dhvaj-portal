import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { ProfitabilityReport, RateCardsResponse, UtilisationReport } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';
import { createTestApp } from './create-test-app';
import { istDateFromToday } from './date.helper';
import { DatabaseService } from '../src/database/database.service';
import { partnerMonthProfitability } from '../src/modules/reports/profitability.service';

/**
 * PS-302 — cost rates, realisation and profitability. "Margins per client,
 * engagement, service and partner." Done when the Managing Partner and the
 * partners set rates by grade (and per person), the report works out time
 * cost, standard value, billed, collected and the margin for a period, rates
 * changing mid-period are applied by the day, and a manager sees no rate,
 * in the API or the database.
 */
describe('Profitability and rate cards (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: Record<string, string>;
  let pa: Record<string, string>;
  let pb: Record<string, string>;
  let mx: Record<string, string>;
  let sy: Record<string, string>;
  let grade: Record<string, string>;
  let emp: Record<string, string>;
  let entityId: string;
  let eng: string;
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const today = istDateFromToday(0);
  const from = istDateFromToday(-20);
  const rateChange = istDateFromToday(-5);
  const report = async (h: Record<string, string>, q: string) =>
    (await http().get(`/api/v1/reports/profitability?${q}`).set(h).expect(200))
      .body as ProfitabilityReport;

  /** A closed entry of `hours` on `day` (IST), from 10:00 plus `startHour` offset. */
  const time = (
    employee: string,
    day: string,
    startHour: number,
    hours: number,
    billable: boolean,
  ) =>
    su.query(
      `INSERT INTO hsdg.engagement_time_entries
         (engagement_id, employee_id, entry_kind, source, is_billable,
          started_at, ended_at, duration_seconds, stopped_reason)
       SELECT $1, $2, 'work', 'manual', $5, s, s + make_interval(hours => $4), $4 * 3600, 'manual'
         FROM (SELECT ($3::date + make_interval(hours => 10 + $6)) AT TIME ZONE 'Asia/Kolkata' AS s) x`,
      [eng, employee, day, hours, billable, startHour],
    );

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await as('mp@dhvaj.in');
    pa = await as('partner.a@dhvaj.in');
    pb = await as('partner.b@dhvaj.in');
    mx = await as('manager.x@dhvaj.in');
    sy = await as('senior.y@dhvaj.in');
    grade = Object.fromEntries(
      (await su.query<{ slug: string; id: string }>(`SELECT slug, id FROM hsdg.grades`)).rows.map(
        (r) => [r.slug, r.id],
      ),
    );
    emp = Object.fromEntries(
      (
        await su.query<{ email: string; id: string }>(
          `SELECT u.email::text, e.id FROM hsdg.users u JOIN hsdg.employees e ON e.user_id = u.id
            WHERE u.email IN ('manager.x@dhvaj.in', 'senior.y@dhvaj.in', 'partner.a@dhvaj.in')`,
        )
      ).rows.map((r) => [r.email, r.id]),
    );
    await su.query(`DELETE FROM hsdg.employee_rates`);
    await su.query(`DELETE FROM hsdg.rate_cards`);

    // A fresh NORTH client and an engagement Partner A leads on it.
    const items = async (path: string) =>
      (await http().get(path).set(mp).expect(200)).body.items as { id: string }[];
    const bharat = (await items('/api/v1/entities?search=Bharat&limit=100'))[0]!.id;
    const serviceId = (await items('/api/v1/services?search=GST_MONTHLY&limit=100'))[0]!.id;
    entityId = await freshClient(bharat);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `PS302-${Date.now()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    // Other suites share the database and expect no firm GST state or rates.
    await su?.query(`UPDATE hsdg.firm_settings SET gstin = NULL, state_code = NULL`);
    await su?.query(
      `UPDATE hsdg.firm_settings SET working_weekdays = '{1,2,3,4,5,6}', working_hours_per_day = 8`,
    );
    await su?.query(`DELETE FROM hsdg.employee_rates`);
    await su?.query(`DELETE FROM hsdg.rate_cards`);
    await su?.end();
    await app?.close();
  });

  it('a manager or a senior sees no rate and no margin: refused, and nothing in the database', async () => {
    for (const h of [mx, sy]) {
      const r = await http().get('/api/v1/rate-cards').set(h).expect(403);
      expect(JSON.stringify(r.body)).toMatch(/permission|Managing Partner|partner/i);
      await http()
        .put('/api/v1/rate-cards')
        .set(h)
        .send({
          effectiveFrom: today,
          rates: [{ gradeId: grade.senior, costRatePerHour: '1', chargeOutRatePerHour: '1' }],
        })
        .expect(403);
      await http().get('/api/v1/reports/profitability').set(h).expect(403);
      await http().get('/api/v1/reports/profitability/csv').set(h).expect(403);
    }

    // Partner A sets a card; a manager's own database session cannot read it.
    await http()
      .put('/api/v1/rate-cards')
      .set(pa)
      .send({
        effectiveFrom: '2020-04-01',
        rates: [{ gradeId: grade.staff, costRatePerHour: '100', chargeOutRatePerHour: '300' }],
      })
      .expect(200);
    const count = async (email: string, roles: string[]) => {
      await su.query('BEGIN');
      try {
        const u = (
          await su.query<{ id: string; office: string; emp: string }>(
            `SELECT u.id, u.primary_office_id AS office, e.id AS emp
               FROM hsdg.users u JOIN hsdg.employees e ON e.user_id = u.id WHERE u.email = $1`,
            [email],
          )
        ).rows[0]!;
        await su.query('SET LOCAL ROLE hsdg_app');
        await su.query(
          `SELECT set_config('hsdg.user_id', $1, true), set_config('hsdg.role', $2, true),
                  set_config('hsdg.roles', $3, true), set_config('hsdg.office_id', $4, true),
                  set_config('hsdg.employee_id', $5, true)`,
          [u.id, roles[0], roles.join(','), u.office, u.emp],
        );
        const n = (await su.query<{ n: string }>(`SELECT count(*) AS n FROM hsdg.rate_cards`))
          .rows[0]!.n;
        return Number(n);
      } finally {
        await su.query('ROLLBACK');
      }
    };
    expect(await count('manager.x@dhvaj.in', ['manager'])).toBe(0);
    expect(await count('partner.a@dhvaj.in', ['partner'])).toBe(1);
  });

  it('partners set rates by grade from a day, a person’s own rate, and the working calendar', async () => {
    const put = await http()
      .put('/api/v1/rate-cards')
      .set(mp)
      .send({
        effectiveFrom: '2020-04-01',
        rates: [
          { gradeId: grade.senior, costRatePerHour: '500', chargeOutRatePerHour: '1500' },
          { gradeId: grade.manager, costRatePerHour: '1000', chargeOutRatePerHour: '3000' },
        ],
      })
      .expect(200);
    expect((put.body as RateCardsResponse).cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gradeId: grade.senior,
          financialYear: '2020-21',
          costRatePerHour: '500.00',
          chargeOutRatePerHour: '1500.00',
          effectiveFrom: '2020-04-01',
        }),
      ]),
    );
    // Seniors' rates rise five days ago.
    await http()
      .put('/api/v1/rate-cards')
      .set(pa)
      .send({
        effectiveFrom: rateChange,
        rates: [{ gradeId: grade.senior, costRatePerHour: '600', chargeOutRatePerHour: '2000' }],
      })
      .expect(200);
    // Manager X has their own rate.
    const own = await http()
      .put('/api/v1/rate-cards/employees')
      .set(pa)
      .send({
        employeeId: emp['manager.x@dhvaj.in'],
        effectiveFrom: '2020-04-01',
        costRatePerHour: '1200',
        chargeOutRatePerHour: '4000',
        note: 'Qualified CA',
      })
      .expect(200);
    expect((own.body as RateCardsResponse).overrides).toEqual([
      expect.objectContaining({
        employeeId: emp['manager.x@dhvaj.in'],
        gradeName: expect.any(String),
        costRatePerHour: '1200.00',
        note: 'Qualified CA',
      }),
    ]);
    // A negative rate is refused, and a grade twice.
    await http()
      .put('/api/v1/rate-cards')
      .set(pa)
      .send({
        effectiveFrom: today,
        rates: [{ gradeId: grade.senior, costRatePerHour: '-1', chargeOutRatePerHour: '1' }],
      })
      .expect(400);

    const cal = await http()
      .put('/api/v1/rate-cards/calendar')
      .set(pa)
      .send({ workingWeekdays: [1, 2, 3, 4, 5], workingHoursPerDay: '7.5' })
      .expect(200);
    expect((cal.body as RateCardsResponse).calendar).toEqual({
      workingWeekdays: [1, 2, 3, 4, 5],
      workingHoursPerDay: '7.50',
    });
    await http()
      .put('/api/v1/rate-cards/calendar')
      .set(mx)
      .send({ workingWeekdays: [1], workingHoursPerDay: '1' })
      .expect(403);

    const audit = await su.query<{ action: string }>(
      `SELECT action FROM hsdg.audit_events
        WHERE action IN ('rate_card.set', 'employee_rate.set', 'working_calendar.set')`,
    );
    expect(new Set(audit.rows.map((r) => r.action))).toEqual(
      new Set(['rate_card.set', 'employee_rate.set', 'working_calendar.set']),
    );
  });

  it('works out time cost, standard value, billed, collected and margin, by the rate of the day', async () => {
    // Senior Y: 10h before the rise (8 billable), 10h after. Manager X: 4h.
    const before = istDateFromToday(-10);
    const after = istDateFromToday(-2);
    await time(emp['senior.y@dhvaj.in']!, before, 0, 8, true);
    await time(emp['senior.y@dhvaj.in']!, before, 8, 2, false);
    await time(emp['senior.y@dhvaj.in']!, after, 0, 10, true);
    await time(emp['manager.x@dhvaj.in']!, after, 0, 4, true);

    // ₹50,000 + 18% GST billed today; ₹5,000 credited; ₹29,500 received.
    const s = await http().get('/api/v1/billing/settings').set(mp).expect(200);
    await http()
      .patch('/api/v1/billing/settings')
      .set(mp)
      .send({ version: s.body.version, gstin: '07AAAFD1234K1Z5' })
      .expect(200);
    const d = await http()
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(pa)
      .send({
        dueDate: istDateFromToday(15),
        lines: [{ description: 'Professional fees', unitAmount: '50000.00' }],
      })
      .expect(201);
    const inv = d.body.id as string;
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${inv}/status`)
      .set(pa)
      .send({ status: 'issued', issueDate: today })
      .expect(201);
    const got = await http().get(`/api/v1/engagements/${eng}/invoices/${inv}`).set(pa).expect(200);
    expect(got.body.total).toBe('59000.00');
    const line = (got.body.lines as { id: string }[])[0]!.id;
    const cn = await http()
      .post(`/api/v1/billing/invoices/${inv}/credit-notes`)
      .set(mx)
      .send({ lines: [{ invoiceLineId: line, taxableValue: '5000' }], reason: 'Scope trimmed' })
      .expect(201);
    await http()
      .post(`/api/v1/billing/credit-notes/${cn.body.id as string}/decision`)
      .set(pa)
      .send({ decision: 'approve', note: null })
      .expect(201);
    await http()
      .post('/api/v1/billing/receipts')
      .set(pa)
      .send({
        clientEntityId: entityId,
        receivedOn: today,
        mode: 'bank',
        reference: `UTR${Date.now()}`,
        netAmount: '29500.00',
        tdsAmount: '0',
      })
      .expect(201);

    const r = await report(pa, `from=${from}&to=${today}&by=client&entityId=${entityId}`);
    expect(r).toMatchObject({ from, to: today, by: 'client', unratedPeople: [] });
    expect(r.rows).toHaveLength(1);
    // Cost 10×500 + 10×600 + 4×1,200 = 15,800. Standard 8×1,500 + 10×2,000 + 4×4,000 = 48,000.
    // Billed 50,000 − 5,000. Collected 29,500 × 50,000 ÷ 59,000 = 25,000 (ex-GST).
    expect(r.rows[0]).toMatchObject({
      key: entityId,
      hours: 24,
      billableHours: 22,
      timeCost: '15800.00',
      standardValue: '48000.00',
      billed: '45000.00',
      collected: '25000.00',
      realisationPct: 93.8,
      collectionPct: 55.6,
      margin: '29200.00',
      marginPct: 64.9,
      unratedHours: 0,
      bottom: false,
    });
    expect(r.totals.margin).toBe('29200.00');

    // By engagement, partner and month: the same money.
    const byEng = await report(pa, `from=${from}&to=${today}&by=engagement&entityId=${entityId}`);
    expect(byEng.rows.map((x) => [x.key, x.margin])).toEqual([[eng, '29200.00']]);
    const byPartner = await report(pa, `from=${from}&to=${today}&by=partner&entityId=${entityId}`);
    expect(byPartner.rows).toEqual([
      expect.objectContaining({ key: emp['partner.a@dhvaj.in'], sub: 'NORTH', margin: '29200.00' }),
    ]);
    const byMonth = await report(pa, `from=${from}&to=${today}&by=month&entityId=${entityId}`);
    expect(byMonth.totals.margin).toBe('29200.00');

    // The period cuts: the hours before the rise only.
    const early = await report(
      pa,
      `from=${from}&to=${istDateFromToday(-6)}&by=client&entityId=${entityId}`,
    );
    expect(early.rows[0]).toMatchObject({
      hours: 10,
      timeCost: '5000.00',
      standardValue: '12000.00',
      billed: '0.00',
    });

    // The Managing Partner sees it; Partner B (another office) does not.
    expect((await report(mp, `from=${from}&to=${today}&entityId=${entityId}`)).rows).toHaveLength(
      1,
    );
    expect((await report(pb, `from=${from}&to=${today}&entityId=${entityId}`)).rows).toEqual([]);

    // PS-303's partner pack: a partner's month totals; nothing for a manager.
    const ctxOf = async (email: string, role: string) => {
      const u = (
        await su.query<{ id: string; office: string; emp: string }>(
          `SELECT u.id, u.primary_office_id AS office, e.id AS emp
             FROM hsdg.users u JOIN hsdg.employees e ON e.user_id = u.id WHERE u.email = $1`,
          [email],
        )
      ).rows[0]!;
      return { userId: u.id, role, roles: [role], employeeId: u.emp, officeId: u.office };
    };
    const pack = async (email: string, role: string) => {
      const ctx = await ctxOf(email, role);
      return app.get(DatabaseService).withRlsContext(ctx, (client) =>
        partnerMonthProfitability(client, ctx, {
          from,
          to: today,
          partnerId: emp['partner.a@dhvaj.in'],
        }),
      );
    };
    const mine = await pack('partner.a@dhvaj.in', 'partner');
    expect(mine).toEqual({
      timeCost: expect.stringMatching(/^\d+\.\d{2}$/),
      standardValue: expect.stringMatching(/^\d+\.\d{2}$/),
      billed: expect.stringMatching(/^-?\d+\.\d{2}$/),
      realisationPct: expect.any(Number),
      margin: expect.stringMatching(/^-?\d+\.\d{2}$/),
    });
    expect(Number(mine!.timeCost)).toBeGreaterThanOrEqual(15800);
    expect(await pack('manager.x@dhvaj.in', 'manager')).toBeNull();

    // A person with no rate: counted, named, costed at nothing.
    await su.query(`DELETE FROM hsdg.employee_rates`);
    await su.query(`DELETE FROM hsdg.rate_cards WHERE grade_id = $1`, [grade.manager]);
    const unrated = await report(pa, `from=${from}&to=${today}&entityId=${entityId}`);
    expect(unrated.rows[0]).toMatchObject({ unratedHours: 4, timeCost: '11000.00' });
    expect(unrated.unratedPeople).toHaveLength(1);

    // The CSV.
    const csv = await http()
      .get(`/api/v1/reports/profitability/csv?from=${from}&to=${today}&entityId=${entityId}`)
      .set(pa)
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toMatch(/^Client,Detail,Hours,Billable hours,Time cost/);
    expect(lines[lines.length - 1]).toMatch(/^Total,,24,22,11000\.00,/);
  });

  it('refuses a backwards or over-long period', async () => {
    await http().get(`/api/v1/reports/profitability?from=${today}&to=${from}`).set(pa).expect(400);
    await http()
      .get('/api/v1/reports/profitability?from=2020-01-01&to=2026-01-01')
      .set(pa)
      .expect(400);
    await http().get('/api/v1/reports/profitability?by=planet').set(pa).expect(400);
    // Defaults to the last full quarter.
    const r = await report(pa, '');
    expect(r.by).toBe('client');
    expect(r.from < r.to).toBe(true);
  });

  it('utilisation shows chargeable hours against the working calendar', async () => {
    await su.query(
      `UPDATE hsdg.firm_settings SET working_weekdays = '{1,2,3,4,5,6,7}', working_hours_per_day = 8`,
    );
    await time(emp['senior.y@dhvaj.in']!, today, 12, 1, true);
    const u = (await http().get('/api/v1/reports/utilisation').set(mp).expect(200))
      .body as UtilisationReport;
    const row = u.rows.find((x) => x.employeeId === emp['senior.y@dhvaj.in'])!;
    expect(row.chargeableHours).toBeGreaterThanOrEqual(1);
    expect(row.availableHours).toBeGreaterThan(0);
    expect(row.chargeablePct).toEqual(expect.any(Number));
  });
});

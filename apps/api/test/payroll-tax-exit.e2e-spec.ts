import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Payroll 2b (docs/accountant-hr-roles-spec.md §4.8): tax declarations and
 * proofs, TDS on salary (s.392), Forms 138 and 130, full and final, bonus.
 *
 * Done when: a person declares and hands in proofs, HR decides them (never
 * their own); the run projects TDS into one input row it owns, HR's own TDS
 * overriding it; the regime is fixed once a run has taxed the person; the
 * Administrator, Partners, Managers and the Accountant read no one else's
 * declaration, proof or settlement; a settlement is prepared by HR, approved
 * by the Managing Partner (never the preparer, never the leaver), frozen once
 * approved, and paid with the run of its month.
 *
 * Uses Accounts A (EMP009) and HR H (EMP010) from 2027 so it never touches
 * the people or months the payroll-core suite uses.
 */
describe('Payroll tax and exits — phase 2b (e2e)', () => {
  let app: INestApplication;
  let userIds: Record<string, string>;
  let hr: string;
  let mp: string;
  let admin: string;
  let accounts: string;
  let pa: string;
  let mx: string;
  const emp: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const su = async <R>(sql: string, params: unknown[] = []): Promise<R[]> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      return (await c.query(sql, params)).rows as R[];
    } finally {
      await c.end();
    }
  };

  /** Run SQL as the application role under a user's context (rolled back). */
  const asApp = async <R>(
    email: string,
    role: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<R[]> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      const e = await c.query<{ id: string | null; office: string }>(
        `SELECT e.id, u.primary_office_id AS office
           FROM hsdg.users u LEFT JOIN hsdg.employees e ON e.user_id = u.id WHERE u.email = $1`,
        [email],
      );
      await c.query('SET LOCAL ROLE hsdg_app');
      await c.query(
        `SELECT set_config('hsdg.user_id', $1, true), set_config('hsdg.role', $2, true),
                set_config('hsdg.roles', $2, true), set_config('hsdg.office_id', $3, true),
                set_config('hsdg.employee_id', $4, true)`,
        [userIds[email], role, e.rows[0]!.office, e.rows[0]!.id ?? ''],
      );
      return (await c.query(sql, params)).rows as R[];
    } finally {
      await c.query('ROLLBACK');
      await c.end();
    }
  };

  const amounts = (over: Record<string, unknown> = {}) => ({
    rentMonthly: '0',
    metroCity: false,
    landlordPanGiven: false,
    lta: '0',
    section80C: '0',
    section80CCD1B: '0',
    section80DSelf: '0',
    selfSenior: false,
    section80DParents: '0',
    parentsSenior: false,
    homeLoanInterest: '0',
    section80E: '0',
    section80G: '0',
    section80TTA: '0',
    otherIncome: '0',
    ...over,
  });
  const pdf = Buffer.from('%PDF-1.4\n% made-up receipt for a test\n').toString('base64');

  /** The month's run, created if need be, computed; returns its detail. */
  const compute = async (month: string) => {
    const list = (await http().get('/api/v1/payroll/runs').set(bearer(hr)).expect(200)).body as {
      id: string;
      month: string;
      kind: string;
    }[];
    let run = list.find((r) => r.month === month && r.kind === 'salary');
    if (!run) {
      run = (
        await http()
          .post('/api/v1/payroll/runs')
          .set(bearer(hr))
          .send({ month, kind: 'salary' })
          .expect(201)
      ).body;
    }
    const cur = (await http().get(`/api/v1/payroll/runs/${run!.id}`).set(bearer(hr)).expect(200))
      .body;
    return (
      await http()
        .post(`/api/v1/payroll/runs/${run!.id}/compute`)
        .set(bearer(hr))
        .send({ version: cur.version })
        .expect(201)
    ).body;
  };
  const lineOf = (run: { lines: { employeeCode: string }[] }, code: string) =>
    run.lines.find((l) => l.employeeCode === code) as unknown as {
      items: { code: string; kind: string; amount: string }[];
      payableDays: number;
    };
  const item = (line: { items: { code: string; amount: string }[] }, code: string) =>
    line.items.find((i) => i.code === code)?.amount ?? null;

  const taxRows = (month: string, employeeId: string) =>
    su<{ amount: string }>(
      `SELECT amount::text FROM hsdg.payroll_inputs
        WHERE month = $1 AND employee_id = $2 AND source = 'tax'`,
      [`${month}-01`, employeeId],
    );

  beforeAll(async () => {
    ({ userIds } = await seedIdentityFixtures());
    app = await createTestApp();
    [hr, mp, admin, accounts, pa, mx] = await Promise.all([
      token('hr@dhvaj.in'),
      token('mp@dhvaj.in'),
      token('admin@dhvaj.in'),
      token('accounts@dhvaj.in'),
      token('partner.a@dhvaj.in'),
      token('manager.x@dhvaj.in'),
    ]);
    for (const r of await su<{ code: string; id: string }>(
      `SELECT employee_code AS code, id FROM hsdg.employees`,
    ))
      emp[r.code] = r.id;

    // Accounts A's pay from January 2027, approved by the Managing Partner.
    const s = await http()
      .post('/api/v1/payroll/structures')
      .set(bearer(hr))
      .send({
        employeeId: emp.EMP009,
        effectiveFrom: '2027-01-01',
        kind: 'salary',
        ctc: String(130000 * 12),
        components: [
          { code: 'basic', label: 'Basic', monthly: '60000.00', pfWage: true },
          { code: 'hra', label: 'HRA', monthly: '30000.00', pfWage: false },
          { code: 'special', label: 'Special', monthly: '40000.00', pfWage: false },
        ],
        pfApplicable: true,
        esiApplicable: false,
        ptApplicable: true,
      })
      .expect(201);
    await http()
      .post(`/api/v1/payroll/structures/${s.body.id}/decision`)
      .set(bearer(mp))
      .send({ decision: 'approve' })
      .expect(201);
    await http()
      .put(`/api/v1/payroll/employees/${emp.EMP009}/pay-details`)
      .set(bearer(hr))
      .send({
        accountHolder: 'Accounts A',
        accountNumber: '999988887777',
        ifsc: 'SBIN0000001',
        pan: 'AAAPA1111A',
      })
      .expect(200);
  });

  // Approved runs and settlements are frozen even to SQL; set the guards aside
  // to leave the database as the other payroll suites expect it.
  afterAll(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL session_replication_role = replica`);
      await c.query(
        `DELETE FROM hsdg.payroll_lines WHERE run_id IN
           (SELECT id FROM hsdg.payroll_runs WHERE month >= '2027-01-01')`,
      );
      await c.query(`DELETE FROM hsdg.exit_settlements`);
      await c.query(`DELETE FROM hsdg.payroll_runs WHERE month >= '2027-01-01'`);
      await c.query(`DELETE FROM hsdg.payroll_inputs WHERE month >= '2027-01-01'`);
      await c.query(`DELETE FROM hsdg.tax_proofs`);
      await c.query(`DELETE FROM hsdg.tax_declarations`);
      await c.query(`DELETE FROM hsdg.hr_documents WHERE kind = 'tax_proof'`);
      await c.query(`DELETE FROM hsdg.salary_structures WHERE employee_id = $1`, [emp.EMP009]);
      await c.query(`DELETE FROM hsdg.employee_pay_details WHERE employee_id = $1`, [emp.EMP009]);
      await c.query(`UPDATE hsdg.employees SET date_of_exit = NULL WHERE id = $1`, [emp.EMP009]);
      await c.query('COMMIT');
    } finally {
      await c.end();
    }
    await app.close();
  });

  describe('declarations and proofs', () => {
    let proofId: string;

    it('lets a person declare for themself, with a previous employer', async () => {
      const blank = (await http().get('/api/v1/me/tax/2026').set(bearer(accounts)).expect(200))
        .body;
      expect(blank.id).toBeNull();
      expect(blank.regime).toBe('new');
      const saved = await http()
        .put('/api/v1/me/tax/2026')
        .set(bearer(accounts))
        .send({
          version: 0,
          regime: 'new',
          amounts: amounts({ section80C: '150000' }),
          previousEmployment: { income: '1500000.00', tds: '100000.00', pf: '0', pt: '0' },
        })
        .expect(200);
      expect(saved.body.id).toEqual(expect.any(String));
      expect(saved.body.previousEmployment.tds).toBe('100000.00');
      expect(saved.body.version).toBe(1);
      // A stale version is refused.
      await http()
        .put('/api/v1/me/tax/2026')
        .set(bearer(accounts))
        .send({ version: 0, regime: 'new', amounts: amounts() })
        .expect(409);
    });

    it('files a proof in the HR vault and HR decides it, never their own', async () => {
      const r = await http()
        .post('/api/v1/me/tax/2026/proofs')
        .set(bearer(accounts))
        .send({
          head: 'section80C',
          amount: '150000.00',
          filename: 'ppf.pdf',
          contentType: 'application/pdf',
          contentBase64: pdf,
        })
        .expect(201);
      expect(r.body.proofs).toHaveLength(1);
      proofId = r.body.proofs[0].id;
      expect(r.body.proofs[0].status).toBe('submitted');
      const vault = await su<{ kind: string }>(
        `SELECT d.kind FROM hsdg.hr_documents d JOIN hsdg.tax_proofs p ON p.hr_document_id = d.id
          WHERE p.id = $1`,
        [proofId],
      );
      expect(vault[0]!.kind).toBe('tax_proof');

      // The person cannot decide it; a reject needs a reason; HR accepts in part.
      await http()
        .post(`/api/v1/payroll/tax/proofs/${proofId}/decision`)
        .set(bearer(accounts))
        .send({ decision: 'accept' })
        .expect(403);
      await http()
        .post(`/api/v1/payroll/tax/proofs/${proofId}/decision`)
        .set(bearer(hr))
        .send({ decision: 'reject' })
        .expect(400);
      const ok = await http()
        .post(`/api/v1/payroll/tax/proofs/${proofId}/decision`)
        .set(bearer(hr))
        .send({ decision: 'accept', acceptedAmount: '100000.00' })
        .expect(201);
      expect(ok.body.proofs[0]).toEqual(
        expect.objectContaining({ status: 'accepted', acceptedAmount: '100000.00' }),
      );
      const file = await http()
        .get(`/api/v1/payroll/tax/proofs/${proofId}/file`)
        .set(bearer(hr))
        .expect(200);
      expect(Buffer.from(file.body as Buffer).toString()).toContain('made-up receipt');

      // HR's own proof: HR cannot decide it.
      await http()
        .put('/api/v1/me/tax/2026')
        .set(bearer(hr))
        .send({ version: 0, regime: 'new', amounts: amounts({ section80C: '50000' }) })
        .expect(200);
      const own = await http()
        .post('/api/v1/me/tax/2026/proofs')
        .set(bearer(hr))
        .send({ head: 'section80C', amount: '50000.00', filename: 'lic.pdf', contentBase64: pdf })
        .expect(201);
      const res = await http()
        .post(`/api/v1/payroll/tax/proofs/${own.body.proofs[0].id}/decision`)
        .set(bearer(hr))
        .send({ decision: 'accept' })
        .expect(403);
      expect(res.body.message).toMatch(/own/i);
    });

    it("shows no one else's declaration or proof to the Administrator, a Partner, a Manager or the Accountant", async () => {
      for (const t of [admin, pa, mx, accounts]) {
        await http().get('/api/v1/payroll/tax/2026/declarations').set(bearer(t)).expect(403);
        await http()
          .get(`/api/v1/payroll/tax/2026/declarations/${emp.EMP010}`)
          .set(bearer(t))
          .expect(403);
        await http().get(`/api/v1/payroll/tax/proofs/${proofId}/file`).set(bearer(t)).expect(403);
      }
      for (const [email, role] of [
        ['admin@dhvaj.in', 'admin'],
        ['partner.a@dhvaj.in', 'partner'],
        ['manager.x@dhvaj.in', 'manager'],
      ] as const) {
        for (const table of ['tax_declarations', 'tax_proofs', 'exit_settlements']) {
          const rows = await asApp(email, role, `SELECT 1 FROM hsdg.${table}`);
          expect(rows).toHaveLength(0);
        }
      }
      // The Accountant reads only their own.
      const own = await asApp<{ employee_id: string }>(
        'accounts@dhvaj.in',
        'accountant',
        `SELECT employee_id FROM hsdg.tax_declarations`,
      );
      expect(own.map((r) => r.employee_id)).toEqual([emp.EMP009]);
      // Nor can a person write someone else's declaration directly.
      await expect(
        asApp(
          'accounts@dhvaj.in',
          'accountant',
          `INSERT INTO hsdg.tax_declarations (employee_id, tax_year, regime, amounts)
           VALUES ($1, 2026, 'new', '{}')`,
          [emp.EMP005],
        ),
      ).rejects.toThrow(/row-level security/);

      const list = (
        await http().get('/api/v1/payroll/tax/2026/declarations').set(bearer(hr)).expect(200)
      ).body as { employeeCode: string; declared: boolean; proofsAccepted: number }[];
      expect(list.find((r) => r.employeeCode === 'EMP009')).toEqual(
        expect.objectContaining({ declared: true, proofsAccepted: 1 }),
      );
    });
  });

  describe('TDS on salary', () => {
    let runId: string;
    let tds: string;

    it('projects TDS into one row the run owns, recomputed idempotently', async () => {
      const run = await compute('2027-01');
      runId = run.id;
      tds = item(lineOf(run, 'EMP009'), 'tds')!;
      expect(Number(tds)).toBeGreaterThan(0);
      expect(await taxRows('2027-01', emp.EMP009!)).toEqual([{ amount: tds }]);
      const again = await compute('2027-01');
      expect(item(lineOf(again, 'EMP009'), 'tds')).toBe(tds);
      expect(await taxRows('2027-01', emp.EMP009!)).toHaveLength(1);

      const why = (
        await http()
          .get(`/api/v1/payroll/tax/tds/${emp.EMP009}?month=2027-01`)
          .set(bearer(hr))
          .expect(200)
      ).body;
      expect(why.tds).toBe(tds);
      expect(why.basis).toBe('declared');
      // HR's inputs screen shows the run's row apart from HR's own.
      const inputs = (
        await http().get('/api/v1/payroll/inputs/2027-01').set(bearer(hr)).expect(200)
      ).body as {
        employeeId: string;
        inputs: unknown[];
        auto?: { kind: string; amount: string }[];
      }[];
      const mine = inputs.find((r) => r.employeeId === emp.EMP009)!;
      expect(mine.inputs).toEqual([]);
      expect(mine.auto).toEqual([
        expect.objectContaining({ kind: 'tds', amount: tds, source: 'tax' }),
      ]);
    });

    it("lets HR's own TDS override the projection", async () => {
      await http()
        .put(`/api/v1/payroll/inputs/2027-01/${emp.EMP009}`)
        .set(bearer(hr))
        .send({ lossOfPayDays: 0, inputs: [{ kind: 'tds', amount: '5000.00' }] })
        .expect(204);
      const run = await compute('2027-01');
      expect(item(lineOf(run, 'EMP009'), 'tds')).toBe('5000.00');
      expect(await taxRows('2027-01', emp.EMP009!)).toHaveLength(0);
      await http()
        .put(`/api/v1/payroll/inputs/2027-01/${emp.EMP009}`)
        .set(bearer(hr))
        .send({ lossOfPayDays: 0, inputs: [] })
        .expect(204);
      const back = await compute('2027-01');
      expect(item(lineOf(back, 'EMP009'), 'tds')).toBe(tds);
    });

    it('fixes the regime once a run that taxed the person is approved', async () => {
      const cur = (await http().get(`/api/v1/payroll/runs/${runId}`).set(bearer(hr)).expect(200))
        .body;
      const sub = await http()
        .post(`/api/v1/payroll/runs/${runId}/submit`)
        .set(bearer(hr))
        .send({ version: cur.version })
        .expect(201);
      await http()
        .post(`/api/v1/payroll/runs/${runId}/approve`)
        .set(bearer(mp))
        .send({ version: sub.body.version })
        .expect(201);
      const mine = (await http().get('/api/v1/me/tax/2026').set(bearer(accounts)).expect(200)).body;
      const res = await http()
        .put('/api/v1/me/tax/2026')
        .set(bearer(accounts))
        .send({ version: mine.version, regime: 'old', amounts: mine.amounts })
        .expect(400);
      expect(res.body.message).toMatch(/regime/i);
    });

    it('gives Form 138 for the quarter and Form 130 Part B to the person', async () => {
      const q = (await http().get('/api/v1/payroll/tax/2026/form138/4').set(bearer(hr)).expect(200))
        .body;
      expect(q.dueOn).toBe('2027-05-31');
      expect(q.deductees).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ employeeCode: 'EMP009', month: '2027-01', tds }),
        ]),
      );
      expect(JSON.stringify(q)).not.toContain('AAAPA1111A');
      const file = await http()
        .get('/api/v1/payroll/tax/2026/form138/4/file')
        .set(bearer(hr))
        .expect(200);
      expect(file.headers['content-type']).toMatch(/spreadsheetml/);
      const audited = await su<{ n: string }>(
        `SELECT count(*)::text AS n FROM hsdg.audit_events WHERE action = 'payroll.form138.exported'`,
      );
      expect(Number(audited[0]!.n)).toBe(1);
      for (const t of [admin, pa, accounts])
        await http().get('/api/v1/payroll/tax/2026/form138/4').set(bearer(t)).expect(403);

      const f130 = (
        await http()
          .get(`/api/v1/payroll/tax/2026/form130/${emp.EMP009}`)
          .set(bearer(hr))
          .expect(200)
      ).body;
      expect(f130.final).toBe(false);
      expect(f130.tdsDeducted).toBe(tds);
      expect(f130.previousEmployment.tds).toBe('100000.00');
      expect(f130.panMasked).toMatch(/111A$/);
      // The person sees their own, counting the payslips released to them (none yet).
      const own = (
        await http().get('/api/v1/me/tax/2026/form130').set(bearer(accounts)).expect(200)
      ).body;
      expect(own.employeeCode).toBe('EMP009');
      expect(own.tdsDeducted).toBe('0.00');
      await http()
        .get(`/api/v1/payroll/tax/2026/form130/${emp.EMP009}`)
        .set(bearer(accounts))
        .expect(403);
    });

    it('locks a declaration: only HR, and then the person cannot change it', async () => {
      const d = (
        await http()
          .get(`/api/v1/payroll/tax/2026/declarations/${emp.EMP009}`)
          .set(bearer(hr))
          .expect(200)
      ).body;
      const locked = await http()
        .post(`/api/v1/payroll/tax/2026/declarations/${emp.EMP009}/lock`)
        .set(bearer(hr))
        .send({ version: d.version, locked: true })
        .expect(201);
      expect(locked.body.lockedAt).toEqual(expect.any(String));
      const res = await http()
        .put('/api/v1/me/tax/2026')
        .set(bearer(accounts))
        .send({ version: locked.body.version, regime: 'new', amounts: amounts() });
      expect([400, 403]).toContain(res.status);
    });
  });

  describe('full and final', () => {
    let version: number;
    const url = () => `/api/v1/payroll/exits/${emp.EMP009}`;

    beforeAll(async () => {
      await su(`UPDATE hsdg.employees SET date_of_exit = '2027-02-15' WHERE id = $1`, [emp.EMP009]);
    });

    it('lists the leaver and previews the defaults; HR prepares it', async () => {
      const list = (await http().get('/api/v1/payroll/exits').set(bearer(hr)).expect(200)).body as {
        employeeCode: string;
        status: string;
        dueBy: string;
      }[];
      expect(list.find((r) => r.employeeCode === 'EMP009')).toEqual(
        expect.objectContaining({ status: 'not_started', dueBy: '2027-02-17' }),
      );
      for (const t of [admin, pa, mx, accounts]) {
        await http().get('/api/v1/payroll/exits').set(bearer(t)).expect(403);
        await http().get(url()).set(bearer(t)).expect(403);
      }

      const saved = await http()
        .put(url())
        .set(bearer(hr))
        .send({
          version: 0,
          leaveDays: 10,
          noticeShortfallDays: 5,
          noticePayDays: 0,
          otherEarnings: [],
          otherDeductions: [{ label: 'Laptop not returned', amount: '5000.00' }],
        })
        .expect(200);
      const w = saved.body.working;
      expect(saved.body.status).toBe('draft');
      expect(saved.body.payMonth).toBe('2027-02');
      // Joined 2021-04-01, left 2027-02-15: five years and ten months count as six.
      expect(w.gratuity).toEqual(expect.objectContaining({ eligible: true, countedYears: 6 }));
      expect(w.items.map((i: { code: string }) => i.code).sort()).toEqual(
        ['gratuity_paid', 'leave_encashment', 'notice_recovery', 'other_deduction_1'].sort(),
      );
      expect(w.lastMonth.payableDays).toBe(15);
      version = saved.body.version;
    });

    it('is approved by the Managing Partner, never the preparer or the leaver', async () => {
      // Nothing to approve until HR submits it.
      await http().post(`${url()}/approve`).set(bearer(mp)).send({ version }).expect(400);
      const sub = await http()
        .post(`${url()}/submit`)
        .set(bearer(hr))
        .send({ version })
        .expect(201);
      version = sub.body.version;
      // Submitted figures are frozen.
      await http()
        .put(url())
        .set(bearer(hr))
        .send({
          version,
          leaveDays: 30,
          noticeShortfallDays: 0,
          noticePayDays: 0,
          otherEarnings: [],
          otherDeductions: [],
        })
        .expect(400);

      await http().post(`${url()}/approve`).set(bearer(hr)).send({ version }).expect(403);
      for (const who of ['hr@dhvaj.in', 'accounts@dhvaj.in']) {
        await http()
          .put('/api/v1/payroll/approvers')
          .set(bearer(mp))
          .send({ userId: userIds[who] })
          .expect(204);
        await http()
          .post(`${url()}/approve`)
          .set(bearer(who === 'hr@dhvaj.in' ? hr : accounts))
          .send({ version })
          .expect(403);
      }
      await http().delete('/api/v1/payroll/approvers').set(bearer(mp)).expect(204);

      await http()
        .post(`${url()}/return`)
        .set(bearer(mp))
        .send({ version, reason: ' ' })
        .expect(400);
      const back = await http()
        .post(`${url()}/return`)
        .set(bearer(mp))
        .send({ version, reason: 'Confirm the leave balance' })
        .expect(201);
      expect(back.body.status).toBe('draft');
      expect(back.body.returnedReason).toBe('Confirm the leave balance');
      const again = await http()
        .post(`${url()}/submit`)
        .set(bearer(hr))
        .send({ version: back.body.version })
        .expect(201);
      const ok = await http()
        .post(`${url()}/approve`)
        .set(bearer(mp))
        .send({ version: again.body.version })
        .expect(201);
      expect(ok.body.status).toBe('approved');
      expect(ok.body.approvedBy).toBe('Managing Partner');

      await expect(
        asApp('mp@dhvaj.in', 'managing_partner', `UPDATE hsdg.exit_settlements SET net = 0`),
      ).rejects.toThrow(/approved/);
      await expect(
        asApp('hr@dhvaj.in', 'hr', `DELETE FROM hsdg.exit_settlements WHERE employee_id = $1`, [
          emp.EMP009,
        ]),
      ).rejects.toThrow(/draft/);
    });

    it('shows the leaver their statement once approved, and no one else', async () => {
      const mine = await http().get('/api/v1/me/full-and-final').set(bearer(accounts)).expect(200);
      expect(mine.body.status).toBe('approved');
      expect(mine.body.employeeCode).toBe('EMP009');
      const other = await http().get('/api/v1/me/full-and-final').set(bearer(mx)).expect(200);
      expect(other.body).toEqual({});
    });

    it('is paid with the run of its month, TDS included', async () => {
      const run = await compute('2027-02');
      const line = lineOf(run, 'EMP009');
      expect(line.payableDays).toBe(15);
      expect(Number(item(line, 'gratuity_paid'))).toBeGreaterThan(0);
      expect(Number(item(line, 'leave_encashment'))).toBeGreaterThan(0);
      expect(Number(item(line, 'notice_recovery'))).toBeGreaterThan(0);
      expect(Number(item(line, 'tds'))).toBeGreaterThan(0);
      const x = (await http().get(url()).set(bearer(hr)).expect(200)).body;
      expect(x.runId).toBe(run.id);
      expect(x.runStatus).toBe('computed');
    });
  });

  describe('statutory bonus', () => {
    it('works out eligibility on the wage ceiling; HR and the approvers only', async () => {
      const b = (
        await http().get('/api/v1/payroll/bonus/2026?rate=8.33').set(bearer(hr)).expect(200)
      ).body;
      expect(b.dueBy).toBe('2027-11-30');
      const a = b.rows.find((r: { employeeCode: string }) => r.employeeCode === 'EMP009');
      expect(a.eligible).toBe(false);
      for (const t of [admin, pa, accounts])
        await http().get('/api/v1/payroll/bonus/2026').set(bearer(t)).expect(403);
    });
  });
});

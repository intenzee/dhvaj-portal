import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Payroll core, phase 2a (docs/accountant-hr-roles-spec.md §4.8, §7.6).
 *
 * Done when: HR proposes and the Managing Partner approves pay (never the
 * same person); a month is computed, submitted, approved by someone other
 * than its preparer, paid from an audited bank file and then frozen even to
 * direct SQL; the Administrator, Partners, Managers and the Accountant read
 * no pay line; a person sees their own payslip only once released; the
 * Accountant's totals and journal agree with the register; a bank change is
 * not paid into until HR verifies it; a revision dated back pays arrears once.
 */
describe('Payroll core — phase 2a (e2e)', () => {
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

  const propose = (
    employeeId: string,
    effectiveFrom: string,
    kind: string,
    comps: [string, string, boolean][],
  ) =>
    http()
      .post('/api/v1/payroll/structures')
      .set(bearer(hr))
      .send({
        employeeId,
        effectiveFrom,
        kind,
        ctc: String(comps.reduce((t, [, m]) => t + Number(m), 0) * 12),
        components: comps.map(([code, monthly, pfWage]) => ({
          code,
          label: code.toUpperCase(),
          monthly,
          pfWage,
        })),
        pfApplicable: kind === 'salary',
        esiApplicable: kind === 'salary',
        ptApplicable: kind === 'salary',
      });

  let runId: string;
  let version: number;

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
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    const { rows } = await c.query<{ code: string; id: string }>(
      `SELECT employee_code AS code, id FROM hsdg.employees`,
    );
    for (const r of rows) emp[r.code] = r.id;
    await c.end();
  });

  afterAll(async () => {
    await app.close();
  });

  it('HR proposes; only the Managing Partner approves', async () => {
    const x = await propose(emp.EMP005!, '2026-04-01', 'salary', [
      ['basic', '40000.00', true],
      ['hra', '20000.00', false],
      ['special', '20000.00', false],
    ]).expect(201);
    expect(x.body.status).toBe('proposed');
    const y = await propose(emp.EMP006!, '2026-04-01', 'salary', [
      ['basic', '15000.00', true],
      ['hra', '5000.00', false],
    ]).expect(201);
    const a = await propose(emp.EMP007!, '2026-04-01', 'stipend', [
      ['stipend', '9000.00', false],
    ]).expect(201);

    // HR is not an approver; nor is a Partner.
    await http()
      .post(`/api/v1/payroll/structures/${x.body.id}/decision`)
      .set(bearer(hr))
      .send({ decision: 'approve' })
      .expect(403);
    await http()
      .post(`/api/v1/payroll/structures/${x.body.id}/decision`)
      .set(bearer(pa))
      .send({ decision: 'approve' })
      .expect(403);
    for (const id of [x.body.id, y.body.id, a.body.id]) {
      const r = await http()
        .post(`/api/v1/payroll/structures/${id}/decision`)
        .set(bearer(mp))
        .send({ decision: 'approve' })
        .expect(201);
      expect(r.body.status).toBe('approved');
    }
    // Approved pay cannot be edited, even directly.
    await expect(
      asApp('hr@dhvaj.in', 'hr', `UPDATE hsdg.salary_structures SET ctc = 1 WHERE id = $1`, [
        x.body.id,
      ]),
    ).rejects.toThrow(/already approved/);
  });

  it('seals bank numbers, masks them and audits a reveal', async () => {
    const r = await http()
      .put(`/api/v1/payroll/employees/${emp.EMP005}/pay-details`)
      .set(bearer(hr))
      .send({
        accountHolder: 'Manager X',
        accountNumber: '111122223333',
        ifsc: 'HDFC0001234',
        pan: 'ABCDE1234F',
        uan: '100200300400',
      })
      .expect(200);
    expect(r.body.accountMasked).toMatch(/3333$/);
    expect(JSON.stringify(r.body)).not.toContain('111122223333');
    await http()
      .put(`/api/v1/payroll/employees/${emp.EMP006}/pay-details`)
      .set(bearer(hr))
      .send({ accountHolder: 'Senior Y', accountNumber: '444455556666', ifsc: 'ICIC0004321' })
      .expect(200);

    const stored = await asApp<{ account_ciphertext: Buffer }>(
      'hr@dhvaj.in',
      'hr',
      `SELECT account_ciphertext FROM hsdg.employee_pay_details WHERE employee_id = $1`,
      [emp.EMP005],
    );
    expect(stored[0]!.account_ciphertext.toString('latin1')).not.toContain('111122223333');

    const shown = await http()
      .post(`/api/v1/payroll/employees/${emp.EMP005}/pay-details/reveal`)
      .set(bearer(hr))
      .send({ field: 'account' })
      .expect(201);
    expect(shown.body.value).toBe('111122223333');
    // The Administrator, a Partner and the Accountant cannot see pay at all.
    for (const t of [admin, pa, accounts]) {
      await http()
        .post(`/api/v1/payroll/employees/${emp.EMP005}/pay-details/reveal`)
        .set(bearer(t))
        .send({ field: 'account' })
        .expect(403);
    }
    // The person sees their own, masked.
    const own = await http().get('/api/v1/me/pay').set(bearer(mx)).expect(200);
    expect(own.body.payDetails.accountMasked).toMatch(/3333$/);
    expect(own.body.structures).toHaveLength(1);
  });

  it('computes the month from structures, inputs and settings', async () => {
    await http()
      .put(`/api/v1/payroll/inputs/2026-07/${emp.EMP006}`)
      .set(bearer(hr))
      .send({ lossOfPayDays: 2, inputs: [] })
      .expect(204);
    await http()
      .put(`/api/v1/payroll/inputs/2026-07/${emp.EMP005}`)
      .set(bearer(hr))
      .send({ lossOfPayDays: 0, inputs: [{ kind: 'incentive', amount: '5000.00' }] })
      .expect(204);

    const created = await http()
      .post('/api/v1/payroll/runs')
      .set(bearer(hr))
      .send({ month: '2026-07', kind: 'salary' })
      .expect(201);
    runId = created.body.id;
    const run = await http()
      .post(`/api/v1/payroll/runs/${runId}/compute`)
      .set(bearer(hr))
      .send({ version: created.body.version })
      .expect(201);
    expect(run.body.status).toBe('computed');
    expect(run.body.lines.map((l: { employeeCode: string }) => l.employeeCode)).toEqual([
      'EMP005',
      'EMP006',
    ]);
    const x = run.body.lines[0];
    expect(x.gross).toBe('85000.00');
    expect(x.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'pf', amount: '1800.00' }),
        expect.objectContaining({ code: 'pt', amount: '200.00' }),
      ]),
    );
    const y = run.body.lines[1];
    expect(y.payableDays).toBe(29);
    expect(y.items.some((i: { code: string }) => i.code === 'esi')).toBe(true);
    expect(run.body.warnings.join(' ')).toMatch(/no approved pay structure/);
    version = run.body.version;
  });

  it('shows no pay line to the Administrator, a Partner, a Manager or the Accountant', async () => {
    for (const t of [admin, pa, mx])
      await http().get(`/api/v1/payroll/runs/${runId}`).set(bearer(t)).expect(403);
    await http().get(`/api/v1/payroll/runs/${runId}`).set(bearer(accounts)).expect(403);
    // The Accountant's list shows no run until its figures are fixed.
    expect(
      (await http().get('/api/v1/payroll/runs').set(bearer(accounts)).expect(200)).body,
    ).toEqual([]);
    for (const [email, role] of [
      ['admin@dhvaj.in', 'admin'],
      ['partner.a@dhvaj.in', 'partner'],
      ['manager.x@dhvaj.in', 'manager'],
      ['accounts@dhvaj.in', 'accountant'],
    ] as const) {
      const [n] = await asApp<{ lines: string; inputs: string; details: string }>(
        email,
        role,
        `SELECT (SELECT count(*) FROM hsdg.payroll_lines) AS lines,
                (SELECT count(*) FROM hsdg.payroll_inputs) AS inputs,
                (SELECT count(*) FROM hsdg.employee_pay_details
                  WHERE employee_id IS DISTINCT FROM hsdg.ctx_employee_id()) AS details`,
      );
      expect([email, Number(n!.lines), Number(n!.inputs), Number(n!.details)]).toEqual([
        email,
        0,
        0,
        0,
      ]);
    }
  });

  it('never lets the preparer approve, and a return needs a reason', async () => {
    const sub = await http()
      .post(`/api/v1/payroll/runs/${runId}/submit`)
      .set(bearer(hr))
      .send({ version })
      .expect(201);
    version = sub.body.version;
    await http()
      .post(`/api/v1/payroll/runs/${runId}/approve`)
      .set(bearer(hr))
      .send({ version })
      .expect(403);

    // Even named as the alternate approver, HR cannot approve their own run.
    await http()
      .put('/api/v1/payroll/approvers')
      .set(bearer(mp))
      .send({ userId: userIds['hr@dhvaj.in'] })
      .expect(204);
    const own = await http()
      .post(`/api/v1/payroll/runs/${runId}/approve`)
      .set(bearer(hr))
      .send({ version })
      .expect(403);
    expect(own.body.message).toMatch(/prepared the run/);
    await http().delete('/api/v1/payroll/approvers').set(bearer(mp)).expect(204);

    // Inputs are fixed once submitted.
    await http()
      .put(`/api/v1/payroll/inputs/2026-07/${emp.EMP006}`)
      .set(bearer(hr))
      .send({ lossOfPayDays: 0, inputs: [] })
      .expect(400);

    await http()
      .post(`/api/v1/payroll/runs/${runId}/return`)
      .set(bearer(mp))
      .send({ version, reason: ' ' })
      .expect(400);
    const back = await http()
      .post(`/api/v1/payroll/runs/${runId}/return`)
      .set(bearer(mp))
      .send({ version, reason: 'Check the incentive' })
      .expect(201);
    expect(back.body.status).toBe('computed');
    expect(back.body.returnedReason).toBe('Check the incentive');
    const again = await http()
      .post(`/api/v1/payroll/runs/${runId}/submit`)
      .set(bearer(hr))
      .send({ version: back.body.version })
      .expect(201);
    const ok = await http()
      .post(`/api/v1/payroll/runs/${runId}/approve`)
      .set(bearer(mp))
      .send({ version: again.body.version })
      .expect(201);
    expect(ok.body.status).toBe('approved');
    expect(ok.body.approvedBy).toBe('Managing Partner');
    version = ok.body.version;
  });

  it('produces an audited bank file, then freezes the paid run even to SQL', async () => {
    const file = await http()
      .get(`/api/v1/payroll/runs/${runId}/bank-file`)
      .set(bearer(hr))
      .expect(200);
    const csv = file.text;
    expect(csv.split('\r\n')[0]).toBe('Beneficiary name,Account number,IFSC,Amount,Narration');
    expect(csv).toContain('111122223333,HDFC0001234');
    expect(csv).toContain('444455556666,ICIC0004321');
    const audit = await asApp<{ n: string }>(
      'mp@dhvaj.in',
      'managing_partner',
      `SELECT count(*) AS n FROM hsdg.audit_events WHERE action = 'payroll.bank_file.downloaded' AND object_id = $1`,
      [runId],
    );
    expect(Number(audit[0]!.n)).toBe(1);

    const paid = await http()
      .post(`/api/v1/payroll/runs/${runId}/paid`)
      .set(bearer(hr))
      .send({ version, bankReference: 'NEFT-BULK-0701' })
      .expect(201);
    expect(paid.body.status).toBe('paid');
    version = paid.body.version;

    await expect(
      asApp('hr@dhvaj.in', 'hr', `UPDATE hsdg.payroll_runs SET net = 0 WHERE id = $1`, [runId]),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      asApp('hr@dhvaj.in', 'hr', `UPDATE hsdg.payroll_lines SET net = 0 WHERE run_id = $1`, [
        runId,
      ]),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      asApp('hr@dhvaj.in', 'hr', `DELETE FROM hsdg.payroll_runs WHERE id = $1`, [runId]),
    ).rejects.toThrow(/cannot be deleted/);
    await http()
      .post(`/api/v1/payroll/runs/${runId}/compute`)
      .set(bearer(hr))
      .send({ version })
      .expect(409);
  });

  it('shows a person their payslip only once released', async () => {
    expect((await http().get('/api/v1/me/pay/payslips').set(bearer(mx)).expect(200)).body).toEqual(
      [],
    );
    await http().get(`/api/v1/me/pay/payslips/${runId}`).set(bearer(mx)).expect(404);

    const rel = await http()
      .post(`/api/v1/payroll/runs/${runId}/release`)
      .set(bearer(hr))
      .send({ version })
      .expect(201);
    version = rel.body.version;
    const list = (await http().get('/api/v1/me/pay/payslips').set(bearer(mx)).expect(200)).body;
    expect(list).toEqual([
      expect.objectContaining({ runId, month: '2026-07', net: expect.any(String) }),
    ]);
    const slip = await http().get(`/api/v1/me/pay/payslips/${runId}`).set(bearer(mx)).expect(200);
    expect(slip.body.bankReference).toBe('NEFT-BULK-0701');
    const pdf = await http()
      .get(`/api/v1/me/pay/payslips/${runId}/pdf`)
      .set(bearer(mx))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // Never someone else's.
    await http()
      .get(`/api/v1/payroll/runs/${runId}/lines/${emp.EMP006}/payslip`)
      .set(bearer(mx))
      .expect(403);
    const others = await asApp<{ n: string }>(
      'manager.x@dhvaj.in',
      'manager',
      `SELECT count(*) AS n FROM hsdg.payroll_lines`,
    );
    expect(Number(others[0]!.n)).toBe(1);
  });

  it('gives the Accountant totals and a journal that agree with the register', async () => {
    const detail = (await http().get(`/api/v1/payroll/runs/${runId}`).set(bearer(hr)).expect(200))
      .body;
    const totals = (
      await http().get(`/api/v1/payroll/runs/${runId}/totals`).set(bearer(accounts)).expect(200)
    ).body;
    expect(JSON.stringify(totals)).not.toMatch(/Manager X|Senior Y|EMP00/);
    const sum = (k: 'gross' | 'net') =>
      detail.lines.reduce((t: number, l: Record<string, string>) => t + Number(l[k]), 0).toFixed(2);
    expect(totals.gross).toBe(sum('gross'));
    expect(totals.net).toBe(sum('net'));
    expect(totals.people).toBe(2);

    const journal = (
      await http().get(`/api/v1/payroll/runs/${runId}/journal`).set(bearer(accounts)).expect(200)
    ).body;
    expect(journal.totalDebit).toBe(journal.totalCredit);
    expect(journal.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: 'Salaries payable', credit: totals.net }),
      ]),
    );
    await http()
      .get(`/api/v1/payroll/runs/${runId}/register.xlsx`)
      .set(bearer(accounts))
      .expect(403);
    await http().get(`/api/v1/payroll/runs/${runId}/register.xlsx`).set(bearer(hr)).expect(200);

    const work = (
      await http().get('/api/v1/payroll/statutory/2026-07').set(bearer(accounts)).expect(200)
    ).body;
    const pf = work.find((w: { kind: string }) => w.kind === 'pf');
    expect(pf.dueOn).toBe('2026-08-15');
    expect(Number(pf.employee)).toBeGreaterThan(0);
    await http()
      .put('/api/v1/payroll/statutory/2026-07/pf')
      .set(bearer(hr))
      .send({ challanNumber: 'PF-123', paidOn: '2026-08-12', amount: pf.total })
      .expect(403);
    const recorded = await http()
      .put('/api/v1/payroll/statutory/2026-07/pf')
      .set(bearer(accounts))
      .send({ challanNumber: 'PF-123', paidOn: '2026-08-12', amount: pf.total })
      .expect(200);
    expect(recorded.body.find((w: { kind: string }) => w.kind === 'pf').challanNumber).toBe(
      'PF-123',
    );

    // The paid, unlocked run sits in the Accounts desk's "Payroll runs to book".
    const desk = (await http().get('/api/v1/accounts/desk').set(bearer(accounts)).expect(200)).body;
    expect(desk.queues.payrollToBook).toBeGreaterThanOrEqual(1);
  });

  it('pays into a new account only after HR verifies it, and flags it', async () => {
    await http()
      .post('/api/v1/me/pay/bank-change')
      .set(bearer(mx))
      .send({ accountHolder: 'Manager X', accountNumber: '999988887777', ifsc: 'SBIN0001111' })
      .expect(201);
    await http()
      .post('/api/v1/me/pay/bank-change')
      .set(bearer(mx))
      .send({ accountHolder: 'Manager X', accountNumber: '999988887770', ifsc: 'SBIN0001111' })
      .expect(409);
    const waiting = (
      await http().get('/api/v1/payroll/bank-changes?status=requested').set(bearer(hr)).expect(200)
    ).body;
    expect(waiting).toHaveLength(1);
    // The person cannot verify their own change.
    await http()
      .post(`/api/v1/payroll/bank-changes/${waiting[0].id}/decision`)
      .set(bearer(mx))
      .send({ decision: 'verify' })
      .expect(403);
    // Unverified, the account on file is unchanged.
    const before = await http()
      .post(`/api/v1/payroll/employees/${emp.EMP005}/pay-details/reveal`)
      .set(bearer(hr))
      .send({ field: 'account' })
      .expect(201);
    expect(before.body.value).toBe('111122223333');

    const done = await http()
      .post(`/api/v1/payroll/bank-changes/${waiting[0].id}/decision`)
      .set(bearer(hr))
      .send({ decision: 'verify' })
      .expect(201);
    expect(done.body.status).toBe('verified');
    const after = await http()
      .post(`/api/v1/payroll/employees/${emp.EMP005}/pay-details/reveal`)
      .set(bearer(hr))
      .send({ field: 'account' })
      .expect(201);
    expect(after.body.value).toBe('999988887777');

    // HR cannot verify a change to HR's own account.
    await http()
      .post('/api/v1/me/pay/bank-change')
      .set(bearer(hr))
      .send({ accountHolder: 'HR H', accountNumber: '123412341234', ifsc: 'SBIN0001111' })
      .expect(201);
    const mine = (
      await http().get('/api/v1/payroll/bank-changes?status=requested').set(bearer(hr)).expect(200)
    ).body;
    await http()
      .post(`/api/v1/payroll/bank-changes/${mine[0].id}/decision`)
      .set(bearer(hr))
      .send({ decision: 'verify' })
      .expect(403);
  });

  it('pays a revision dated back as arrears, once, and flags the bank change', async () => {
    const rev = await propose(emp.EMP005!, '2026-07-01', 'salary', [
      ['basic', '43100.00', true],
      ['hra', '20000.00', false],
      ['special', '20000.00', false],
    ]).expect(201);
    await http()
      .post(`/api/v1/payroll/structures/${rev.body.id}/decision`)
      .set(bearer(mp))
      .send({ decision: 'approve' })
      .expect(201);

    const aug = await http()
      .post('/api/v1/payroll/runs')
      .set(bearer(hr))
      .send({ month: '2026-08', kind: 'salary' })
      .expect(201);
    const run = (
      await http()
        .post(`/api/v1/payroll/runs/${aug.body.id}/compute`)
        .set(bearer(hr))
        .send({ version: aug.body.version })
        .expect(201)
    ).body;
    const x = run.lines.find((l: { employeeCode: string }) => l.employeeCode === 'EMP005');
    expect(x.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'arrears', amount: '3100.00' })]),
    );
    expect(x.bankChanged).toBe(true);
    expect(run.changes.revisions).toEqual(['Manager X']);
    expect(run.changes.bankChanged).toEqual(['Manager X']);

    // Recomputing does not pay it twice within the month; after August is paid, September has none.
    const again = (
      await http()
        .post(`/api/v1/payroll/runs/${aug.body.id}/compute`)
        .set(bearer(hr))
        .send({ version: run.version })
        .expect(201)
    ).body;
    const x2 = again.lines.find((l: { employeeCode: string }) => l.employeeCode === 'EMP005');
    expect(x2.items.filter((i: { code: string }) => i.code === 'arrears')).toHaveLength(1);
    const v = (
      await http()
        .post(`/api/v1/payroll/runs/${aug.body.id}/submit`)
        .set(bearer(hr))
        .send({ version: again.version })
        .expect(201)
    ).body.version;
    await http()
      .post(`/api/v1/payroll/runs/${aug.body.id}/approve`)
      .set(bearer(mp))
      .send({ version: v })
      .expect(201);
    const sep = await http()
      .post('/api/v1/payroll/runs')
      .set(bearer(hr))
      .send({ month: '2026-09', kind: 'salary' })
      .expect(201);
    const sepRun = (
      await http()
        .post(`/api/v1/payroll/runs/${sep.body.id}/compute`)
        .set(bearer(hr))
        .send({ version: sep.body.version })
        .expect(201)
    ).body;
    const x3 = sepRun.lines.find((l: { employeeCode: string }) => l.employeeCode === 'EMP005');
    expect(x3.items.some((i: { code: string }) => i.code === 'arrears')).toBe(false);
  });
});

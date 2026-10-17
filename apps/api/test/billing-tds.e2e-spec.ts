import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { TdsMatchReport } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { TdsPdfReader } from '../src/modules/billing/tds-pdf-reader';

/**
 * PS-204 · TDS on our fees against the firm's 26AS.
 *
 * Done when: Accounts imports a quarter's 26AS and sees every mismatch by
 * client — matched (exact, within the tolerance, split deposits), in the
 * 26AS but not booked, booked but missing — and can ask a client to file or
 * correct. A later 26AS replaces the year; a Form 16A its deductor's quarter.
 * RLS: a credit is seen by those who may bill the client its TAN names.
 */
describe('PS-204 TDS credits against the 26AS (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let pb: string;
  let sy: string;

  const FY = '2026-27';
  const PAN = 'AAAFZ9999Q';
  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const letter = (): string => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const newTan = (): string =>
    `E${letter()}${letter()}${letter()}${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}${letter()}`;

  const superuser = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  /** A fresh NORTH client (Partner A's office), with this TAN on file if given. */
  const client = async (tan: string | null): Promise<string> => {
    const res = await http().get('/api/v1/entities?search=Bharat&limit=100').set(bearer(mp));
    const id = await freshClient(res.body.items[0].id as string);
    if (tan) {
      await superuser((c) =>
        c.query(
          `INSERT INTO hsdg.entity_registrations
             (entity_id, registration_type, registration_number, status)
           VALUES ($1, 'tan', $2, 'active')`,
          [id, tan],
        ),
      );
    }
    return id;
  };

  /** A posted receipt that held back `tds` (194J), kept as an advance. */
  const booked = async (
    clientEntityId: string,
    receivedOn: string,
    tds: string,
  ): Promise<string> => {
    const res = await http()
      .post('/api/v1/billing/receipts')
      .set(bearer(pa))
      .send({
        clientEntityId,
        receivedOn,
        mode: 'bank',
        reference: `UTR-${receivedOn}`,
        netAmount: (Number(tds) * 9).toFixed(2),
        tdsAmount: tds,
        tdsSection: '194J',
        allocations: [],
      })
      .expect(201);
    return res.body.id as string;
  };

  type Row = { tan: string; name: string; date: string; tds: string; status?: string };
  const DATE = (iso: string): string => {
    const [y, m, d] = iso.split('-');
    const mon = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${d}-${mon[Number(m) - 1]}-${y}`;
  };
  /** A 26AS text export in TRACES's layout, one deductor block per TAN. */
  const twentySixAs = (rows: Row[], tag = ''): string => {
    const byTan = new Map<string, Row[]>();
    for (const r of rows) byTan.set(r.tan, [...(byTan.get(r.tan) ?? []), r]);
    const out = [
      'Annual Tax Statement under Section 203AA of the Income Tax Act, 1961',
      `Data updated till^15-Oct-2026${tag}`,
      `Permanent Account Number (PAN)^${PAN}^Current Status of PAN^Active^Financial Year^${FY}^Assessment Year^2027-28`,
      'PART-I - Details of Tax Deducted at Source',
      'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)',
    ];
    let n = 0;
    for (const [tan, rs] of byTan) {
      const total = rs.reduce((t, r) => t + Number(r.tds), 0).toFixed(2);
      out.push(
        `${++n}^${rs[0]!.name}^${tan}^^^^^${(Number(total) * 10).toFixed(2)}^${total}^${total}`,
      );
      out.push(
        '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)',
      );
      rs.forEach((r, i) =>
        out.push(
          `^${i + 1}^194J^${DATE(r.date)}^${r.status ?? 'F'}^31-Oct-2026^-^${(Number(r.tds) * 10).toFixed(2)}^${r.tds}^${r.tds}`,
        ),
      );
    }
    out.push(
      'PART-II - Details of Tax Deducted at Source for 15G / 15H',
      'No Transactions Present',
    );
    return out.join('\r\n');
  };
  const upload = (t: string, text: string, filename = '26AS.txt') =>
    http()
      .post('/api/v1/billing/tds-credits/import')
      .set(bearer(t))
      .send({ filename, contentBase64: Buffer.from(text, 'utf8').toString('base64') });
  const report = async (t: string, quarter?: string): Promise<TdsMatchReport> =>
    (
      await http()
        .get(
          `/api/v1/billing/tds-credits/match?financialYear=${FY}${quarter ? `&quarter=${quarter}` : ''}`,
        )
        .set(bearer(t))
        .expect(200)
    ).body as TdsMatchReport;

  // The story: X's TDS is in the 26AS (exactly, within ₹1, and split in
  // two); Y's July deduction is missing and a June credit is not booked; Z
  // has no TAN on file; one TAN is on no client.
  const tanX = newTan();
  const tanY = newTan();
  const tanU = newTan();
  let x: string;
  let y: string;
  let z: string;
  const r: Record<string, string> = {};
  const firstFile = (): string =>
    twentySixAs([
      { tan: tanX, name: 'X CLIENT LTD', date: '2026-05-12', tds: '10000.00' },
      { tan: tanX, name: 'X CLIENT LTD', date: '2026-08-02', tds: '1180.40' },
      { tan: tanX, name: 'X CLIENT LTD', date: '2026-09-15', tds: '3000.00' },
      { tan: tanX, name: 'X CLIENT LTD', date: '2026-09-16', tds: '2000.00', status: 'P' },
      { tan: tanY, name: 'Y CLIENT LLP', date: '2026-06-30', tds: '900.00' },
      { tan: tanU, name: 'NOT A CLIENT', date: '2026-07-07', tds: '400.00' },
    ]);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    x = await client(tanX);
    y = await client(tanY);
    z = await client(null);
    r.xMay = await booked(x, '2026-05-10', '10000.00');
    r.xAug = await booked(x, '2026-08-01', '1180.00');
    r.xSep = await booked(x, '2026-09-15', '5000.00');
    r.yJul = await booked(y, '2026-07-20', '2500.00');
    r.zAug = await booked(z, '2026-08-20', '700.00');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('imports a 26AS and shows matched, not booked and missing, by client', async () => {
    const imp = await upload(mp, firstFile()).expect(201);
    expect(imp.body).toMatchObject({
      source: '26as_text',
      financialYear: FY,
      pan: PAN,
      credits: 6,
      deductors: 3,
      tdsTotal: '17480.40',
      warnings: [],
    });

    const rep = await report(pa);
    const mine = rep.matched.filter((m) => m.clientId === x);
    expect(mine.map((m) => [m.kind, m.receipts.map((b) => b.receiptId), m.difference])).toEqual([
      ['exact', [r.xMay], '0.00'],
      ['tolerance', [r.xAug], '0.40'],
      ['split', [r.xSep], '0.00'],
    ]);
    expect(mine[2]!.credits.map((c) => c.tdsDeposited)).toEqual(['3000.00', '2000.00']);
    expect(rep.notes.join(' ')).toMatch(/not final in TRACES/);

    const yRow = rep.clients.find((c) => c.clientId === y)!;
    expect(yRow).toMatchObject({
      tans: [tanY],
      missingTotal: '2500.00',
      notBookedTotal: '900.00',
      lastReminder: null,
    });
    expect(yRow.missing.map((b) => b.receiptId)).toEqual([r.yJul]);
    expect(yRow.notBooked.map((c) => [c.transactionDate, c.quarter])).toEqual([
      ['2026-06-30', 'Q1'],
    ]);
    const zRow = rep.clients.find((c) => c.clientId === z)!;
    expect(zRow).toMatchObject({ tans: [], missingTotal: '700.00', notBooked: [] });
    expect(rep.clients.some((c) => c.clientId === x)).toBe(false);
    expect(rep.imports[0]).toMatchObject({ source: '26as_text', credits: 6, pan: PAN });
    expect(rep.pan).toBe(PAN);

    // A quarter cuts the lists to itself.
    const q2 = await report(pa, 'Q2');
    expect(q2.matched.filter((m) => m.clientId === x).map((m) => m.kind)).toEqual([
      'tolerance',
      'split',
    ]);
    expect(q2.clients.find((c) => c.clientId === y)).toMatchObject({
      notBooked: [],
      missingTotal: '2500.00',
    });
  });

  it('shows a TAN on no client to the managing partner only', async () => {
    const asMp = await report(mp);
    expect(asMp.unknownDeductors.map((c) => c.deductorTan)).toContain(tanU);
    const asPa = await report(pa);
    expect(asPa.unknownDeductors.map((c) => c.deductorTan)).not.toContain(tanU);
  });

  it("keeps another office's partner out, and a senior without billing out", async () => {
    const asPb = await report(pb);
    const seen = [...asPb.matched.map((m) => m.clientId), ...asPb.clients.map((c) => c.clientId)];
    expect(seen).not.toContain(x);
    expect(seen).not.toContain(y);
    await http()
      .post('/api/v1/billing/tds-credits/remind')
      .set(bearer(pb))
      .send({ clientId: y, financialYear: FY, channel: 'copy' })
      .expect(404);
    await http()
      .get(`/api/v1/billing/tds-credits/match?financialYear=${FY}`)
      .set(bearer(sy))
      .expect(403);
    await upload(sy, firstFile()).expect(403);
  });

  it('asks a client to file or correct, logs it, and refuses when nothing is missing', async () => {
    const sent = await http()
      .post('/api/v1/billing/tds-credits/remind')
      .set(bearer(pa))
      .send({ clientId: y, financialYear: FY, quarter: 'Q2', channel: 'copy' })
      .expect(201);
    expect(sent.body).toMatchObject({
      clientId: y,
      channel: 'copy',
      tdsAmount: '2500.00',
      receipts: 1,
    });
    expect(sent.body.text).toContain(`PAN ${PAN}`);
    expect(sent.body.text).toContain('TDS ₹2,500.00 under section 194J');
    expect(sent.body.text).toMatch(/Form 26Q/);

    const rep = await report(pa);
    expect(rep.clients.find((c) => c.clientId === y)!.lastReminder).toMatchObject({
      channel: 'copy',
    });

    await http()
      .post('/api/v1/billing/tds-credits/remind')
      .set(bearer(pa))
      .send({ clientId: x, financialYear: FY })
      .expect(400);
    await http()
      .post('/api/v1/billing/tds-credits/remind')
      .set(bearer(pa))
      .send({ clientId: z, financialYear: FY, channel: 'whatsapp' })
      .expect(400);
  });

  it('follows the tolerance setting', async () => {
    const before = (await http().get('/api/v1/billing/settings').set(bearer(mp)).expect(200)).body;
    const set = async (tdsMatchTolerance: string, version: number): Promise<number> =>
      (
        await http()
          .patch('/api/v1/billing/settings')
          .set(bearer(mp))
          .send({ version, tdsMatchTolerance })
          .expect(200)
      ).body.version as number;
    const v = await set('0', before.version as number);
    try {
      const rep = await report(pa);
      expect(rep.tolerance).toBe('0.00');
      expect(rep.matched.filter((m) => m.clientId === x).map((m) => m.kind)).toEqual([
        'exact',
        'split',
      ]);
      const xRow = rep.clients.find((c) => c.clientId === x)!;
      expect(xRow.missing.map((b) => b.receiptId)).toEqual([r.xAug]);
      expect(xRow.notBooked.map((c) => c.tdsDeposited)).toEqual(['1180.40']);
    } finally {
      await set(before.tdsMatchTolerance as string, v);
    }
    await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(mp))
      .send({ version: v + 1, tdsMatchTolerance: '5000' })
      .expect(400);
  });

  it('a Form 16A replaces its quarter; the same file twice is refused; a newer 26AS replaces the year', async () => {
    await upload(mp, firstFile()).expect(409);

    const form16a = [
      'FORM NO. 16A',
      'Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source',
      'Name and address of the deductor Name and address of the deductee',
      'Y CLIENT LLP  EXAMPLE AND CO',
      'PAN of the deductor TAN of the deductor PAN of the deductee',
      `AAAFY0001Y ${tanY} ${PAN}`,
      'CIT (TDS) Assessment Year Period',
      'The Commissioner of Income Tax (TDS) 2027-28 From 01-Jul-2026 To 30-Sep-2026',
      'Summary of payment',
      '1 25,000.00 194J 20-07-2026',
      'Summary of tax deducted at source in respect of deductee',
      'Q2 QWERTYUI 2,500.00 2,500.00',
    ].join('\n');
    const f = await upload(pa, form16a, 'Form16A.pdf.txt').expect(201);
    expect(f.body).toMatchObject({ source: 'form16a_pdf', credits: 1, superseded: 0 });
    let rep = await report(pa);
    expect(rep.matched.find((m) => m.receipts.some((b) => b.receiptId === r.yJul))).toMatchObject({
      kind: 'exact',
      clientId: y,
    });
    // The June credit, another quarter, is untouched.
    expect(rep.clients.find((c) => c.clientId === y)).toMatchObject({
      missing: [],
      notBookedTotal: '900.00',
    });

    // A newer 26AS: only X's May credit. The year's earlier rows give way.
    const newer = await upload(
      mp,
      twentySixAs([{ tan: tanX, name: 'X CLIENT LTD', date: '2026-05-12', tds: '10000.00' }], ' 2'),
    ).expect(201);
    expect(newer.body.superseded).toBeGreaterThanOrEqual(7);
    rep = await report(pa);
    expect(rep.matched.filter((m) => m.clientId === x).map((m) => m.kind)).toEqual(['exact']);
    expect(rep.clients.find((c) => c.clientId === x)!.missingTotal).toBe('6180.00');
    expect(rep.clients.find((c) => c.clientId === y)).toMatchObject({
      missingTotal: '2500.00',
      notBooked: [],
    });

    // The guard: rows go only into the caller's own, unapplied import.
    const batch = rep.imports[0]!.id;
    await expect(
      superuser(async (c) => {
        await c.query('BEGIN');
        try {
          const { rows } = await c.query<{ id: string }>(
            `SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id
              WHERE u.email = 'partner.a@dhvaj.in'`,
          );
          await c.query(`SET LOCAL ROLE hsdg_app`);
          await c.query(`SELECT set_config('hsdg.employee_id', $1, true)`, [rows[0]!.id]);
          await c.query(`SELECT set_config('hsdg.role', 'partner', true)`);
          await c.query(`SELECT hsdg.apply_tds_import($1)`, [batch]);
        } finally {
          await c.query('ROLLBACK');
        }
      }),
    ).rejects.toThrow(/Import not found|already been applied/);
  });

  it('refuses what it cannot read, and a 26AS of another PAN', async () => {
    const bad = await upload(mp, 'Date,Narration,Amount\n01-04-2026,NEFT,100', 'bank.csv').expect(
      400,
    );
    expect(bad.body.message).toMatch(/Export as Text/);

    const { rows } = await superuser((c) =>
      c.query<{ gstin: string | null; state_code: string | null }>(
        `SELECT gstin, state_code FROM hsdg.firm_settings`,
      ),
    );
    const was = rows[0]!;
    await superuser((c) =>
      c.query(`UPDATE hsdg.firm_settings SET gstin = '07AAAFQ1111Q1Z5', state_code = '07'`),
    );
    try {
      const res = await upload(
        mp,
        twentySixAs([{ tan: tanX, name: 'X', date: '2026-05-12', tds: '1.00' }], ' pan'),
      ).expect(400);
      expect(res.body.message).toMatch(/PAN AAAFZ9999Q; the firm's GSTIN is under PAN AAAFQ1111Q/);
    } finally {
      await superuser((c) =>
        c.query(`UPDATE hsdg.firm_settings SET gstin = $1, state_code = $2`, [
          was.gstin,
          was.state_code,
        ]),
      );
    }
  });

  it('opens a password-protected TRACES PDF, and keeps the password nowhere', async () => {
    // pdf.js does not run under jest's VM: stand in for it, password-aware.
    const PASSWORD = '01012000';
    const text = [
      'FORM NO. 16A',
      'PAN of the deductor TAN of the deductor PAN of the deductee',
      `AAAFX0001X ${tanX} ${PAN}`,
      'CIT (TDS) Assessment Year Period',
      'The Commissioner of Income Tax (TDS) 2027-28 From 01-Oct-2026 To 31-Dec-2026',
      'Summary of payment',
      '1 640.00 194J 05-10-2026',
      'Summary of tax deducted at source in respect of deductee',
      'Q3 ZXCVBNMA 64.00 64.00',
    ].join('\n');
    const read = jest
      .spyOn(app.get(TdsPdfReader), 'read')
      .mockImplementation(async (_bytes, password) =>
        password === undefined
          ? { kind: 'password', wrong: false }
          : password === PASSWORD
            ? { kind: 'text', text }
            : { kind: 'password', wrong: true },
      );
    const pdf = (password?: string) =>
      http()
        .post('/api/v1/billing/tds-credits/import')
        .set(bearer(pa))
        .send({
          filename: 'Form16A-Q3.pdf',
          contentBase64: Buffer.from('%PDF-1.7 locked q3').toString('base64'),
          ...(password !== undefined ? { password } : {}),
        });
    try {
      const need = await pdf().expect(400);
      expect(need.body).toMatchObject({ reason: 'TDS_PDF_PASSWORD', wrongPassword: false });
      expect(need.body.message).toMatch(/DDMMYYYY/);
      const wrong = await pdf('31121999').expect(400);
      expect(wrong.body).toMatchObject({ reason: 'TDS_PDF_PASSWORD', wrongPassword: true });

      const ok = await pdf(PASSWORD).expect(201);
      expect(ok.body).toMatchObject({ source: 'form16a_pdf', credits: 1, tdsTotal: '64.00' });
      const rep = await report(pa, 'Q3');
      expect(rep.clients.find((c) => c.clientId === x)?.notBooked).toEqual([
        expect.objectContaining({ tdsDeposited: '64.00', quarter: 'Q3' }),
      ]);

      // Not on the batch, not in the audit trail.
      const leaked = await superuser((c) =>
        c.query(
          `SELECT 1 FROM hsdg.firm_tds_import_batches b WHERE b.id = $1 AND b::text LIKE $2
           UNION ALL
           SELECT 1 FROM hsdg.audit_events a WHERE a.object_id = $3 AND a::text LIKE $2`,
          [ok.body.batchId, `%${PASSWORD}%`, ok.body.batchId],
        ),
      );
      expect(leaked.rows).toEqual([]);

      read.mockResolvedValueOnce({ kind: 'unreadable' });
      const scan = await pdf().expect(400);
      expect(scan.body.message).toMatch(/scan or photo/);
    } finally {
      read.mockRestore();
    }
  });
});

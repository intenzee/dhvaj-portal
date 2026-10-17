import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sumAmounts, toPaise, type TdsMatchReport } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { TdsPdfReader } from '../src/modules/billing/tds-pdf-reader';
import { readTdsZip } from '../src/modules/billing/tds-zip';

/**
 * PS-204 · TDS on our fees against the firm's 26AS.
 *
 * Done when: Accounts imports a 26AS (text, or the ZIP TRACES sends) and sees
 * every mismatch by client — matched (exact, within the tolerance, split
 * deposits), in the 26AS but not booked, booked but missing (late) or not in
 * it yet (awaited) — with what a senior would query, and can ask a client to
 * file or correct, not twice in a week by accident. A later 26AS replaces the
 * year; an older one or the same file is refused; a Form 16A replaces its
 * deductor's quarter. RLS: a credit is seen by those who may bill the client
 * its TAN names.
 */
describe('PS-204 TDS credits against the 26AS (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let pb: string;
  let sy: string;

  // A year whose every return is past due: what is late does not move with today.
  const FY = '2025-26';
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

  type Row = {
    tan: string;
    name: string;
    date: string;
    tds: string;
    status?: string;
    section?: string;
    /** Amount paid; ten times the TDS (10%) when not given. */
    paid?: string;
    remarks?: string;
  };
  const MONTHS = [
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
  const DATE = (iso: string): string => {
    const [y, m, d] = iso.split('-');
    return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
  };
  const paidOf = (r: Row): string => r.paid ?? (Number(r.tds) * 10).toFixed(2);
  /**
   * A 26AS "View As Text" export in TRACES's layout: a header of labels over
   * values (File Creation Date — the as-on date — first), then one deductor
   * block per TAN.
   */
  const twentySixAs = (rows: Row[], asOn: string): string => {
    const [y, m, d] = asOn.split('-');
    const byTan = new Map<string, Row[]>();
    for (const r of rows) byTan.set(r.tan, [...(byTan.get(r.tan) ?? []), r]);
    const out = [
      '^Annual Tax Statement^',
      '',
      'File Creation Date^Permanent Account Number (PAN)^Current Status of PAN^Financial Year^Assessment Year^Name of Assessee',
      `${d}-${m}-${y}^${PAN}^ACTIVE^2025-2026^2026-2027^EXAMPLE AND CO`,
      '',
      '^PART-I - Details of Tax Deducted at Source^',
      'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)',
    ];
    let n = 0;
    for (const [tan, rs] of byTan) {
      const sum = (f: (r: Row) => string): string => sumAmounts(rs.map(f));
      out.push(
        `${++n}^${rs[0]!.name}^${tan}^^^^^${sum(paidOf)}^${sum((r) => r.tds)}^${sum((r) => r.tds)}^`,
      );
      out.push(
        '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)',
      );
      rs.forEach((r, i) =>
        out.push(
          `^${i + 1}^${r.section ?? '194J'}^${DATE(r.date)}^${r.status ?? 'F'}^${DATE(asOn)}^${r.remarks ?? '-'}^${paidOf(r)}^${r.tds}^${r.tds}^`,
        ),
      );
    }
    out.push(
      '',
      '^PART-II - Details of Tax Deducted at Source for 15G / 15H^',
      'No Transactions Present',
    );
    return out.join('\r\n');
  };
  const send = (t: string, bytes: Buffer, filename: string, password?: string) =>
    http()
      .post('/api/v1/billing/tds-credits/import')
      .set(bearer(t))
      .send({
        filename,
        contentBase64: bytes.toString('base64'),
        ...(password !== undefined ? { password } : {}),
      });
  const upload = (t: string, text: string, filename = '26AS.txt') =>
    send(t, Buffer.from(text, 'utf8'), filename);
  const report = async (t: string, quarter?: string): Promise<TdsMatchReport> =>
    (
      await http()
        .get(
          `/api/v1/billing/tds-credits/match?financialYear=${FY}${quarter ? `&quarter=${quarter}` : ''}`,
        )
        .set(bearer(t))
        .expect(200)
    ).body as TdsMatchReport;
  const remind = (t: string, body: Record<string, unknown>) =>
    http()
      .post('/api/v1/billing/tds-credits/remind')
      .set(bearer(t))
      .send({ financialYear: FY, ...body });

  // The story: X's TDS is in the 26AS (exactly, within ₹1, and split in two,
  // with a credit and its reversal); Y's July deduction is missing, its
  // February one not in a 26AS that old yet, and a June credit is not booked;
  // W was deducted at 2% and at 20%; Z has no TAN on file; one TAN is on no
  // client.
  const tanX = newTan();
  const tanY = newTan();
  const tanW = newTan();
  const tanU = newTan();
  let x: string;
  let y: string;
  let w: string;
  let z: string;
  const r: Record<string, string> = {};
  // Before Q4's 26Q shows (31 May + 15 days), after the rest.
  const FIRST_AS_ON = '2026-05-20';
  const firstFile = (): string =>
    twentySixAs(
      [
        { tan: tanX, name: 'X CLIENT LTD', date: '2025-05-12', tds: '10000.00' },
        { tan: tanX, name: 'X CLIENT LTD', date: '2025-08-02', tds: '1180.40' },
        { tan: tanX, name: 'X CLIENT LTD', date: '2025-09-15', tds: '3000.00' },
        { tan: tanX, name: 'X CLIENT LTD', date: '2025-09-16', tds: '2000.00', status: 'P' },
        { tan: tanX, name: 'X CLIENT LTD', date: '2025-09-20', tds: '500.00', remarks: 'B' },
        {
          tan: tanX,
          name: 'X CLIENT LTD',
          date: '2025-09-20',
          tds: '-500.00',
          paid: '-5000.00',
          remarks: 'B',
        },
        { tan: tanY, name: 'Y CLIENT LLP', date: '2025-06-30', tds: '900.00' },
        { tan: tanU, name: 'NOT A CLIENT', date: '2025-07-07', tds: '400.00' },
        {
          tan: tanW,
          name: 'W CLIENT LTD',
          date: '2025-11-05',
          tds: '200.00',
          paid: '10000.00',
          section: '194JA',
        },
        { tan: tanW, name: 'W CLIENT LTD', date: '2025-11-06', tds: '2000.00', paid: '10000.00' },
      ],
      FIRST_AS_ON,
    );

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    x = await client(tanX);
    y = await client(tanY);
    w = await client(tanW);
    z = await client(null);
    r.xMay = await booked(x, '2025-05-10', '10000.00');
    r.xAug = await booked(x, '2025-08-01', '1180.00');
    r.xSep = await booked(x, '2025-09-15', '5000.00');
    r.yJul = await booked(y, '2025-07-20', '2500.00');
    r.yFeb = await booked(y, '2026-02-10', '300.00');
    r.zAug = await booked(z, '2025-08-20', '700.00');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('imports a 26AS and shows matched, not booked, missing and awaited, by client', async () => {
    const imp = await upload(mp, firstFile()).expect(201);
    expect(imp.body).toMatchObject({
      source: '26as_text',
      financialYear: FY,
      pan: PAN,
      asOn: FIRST_AS_ON,
      credits: 10,
      deductors: 4,
      tdsTotal: '19680.40',
      warnings: [],
    });

    const rep = await report(pa);
    expect(rep.asOn).toBe(FIRST_AS_ON);
    const mine = rep.matched.filter((m) => m.clientId === x);
    // The reversal and the credit it reverses are neither matched nor "not booked".
    expect(mine.map((m) => [m.kind, m.receipts.map((b) => b.receiptId), m.difference])).toEqual([
      ['exact', [r.xMay], '0.00'],
      ['tolerance', [r.xAug], '0.40'],
      ['split', [r.xSep], '0.00'],
    ]);
    expect(mine[2]!.credits.map((c) => c.tdsDeposited)).toEqual(['3000.00', '2000.00']);
    expect(mine[0]!.credits[0]).toMatchObject({ sectionKind: 'professional_10', checks: [] });
    expect(rep.notes.join(' ')).toMatch(/not final in TRACES/);

    const yRow = rep.clients.find((c) => c.clientId === y)!;
    expect(yRow).toMatchObject({
      tans: [tanY],
      missingTotal: '2500.00',
      notBookedTotal: '900.00',
      awaitedTotal: '300.00',
      lastReminder: null,
    });
    expect(yRow.missing.map((b) => b.receiptId)).toEqual([r.yJul]);
    expect(yRow.awaited).toEqual([
      expect.objectContaining({
        receiptId: r.yFeb,
        quarter: 'Q4',
        expectedBy: '2026-06-15',
        reason:
          'Your 26AS is as on 20 May 2026; import a newer one (it should show from 15 Jun 2026)',
      }),
    ]);
    expect(yRow.notBooked.map((c) => [c.transactionDate, c.quarter])).toEqual([
      ['2025-06-30', 'Q1'],
    ]);
    const zRow = rep.clients.find((c) => c.clientId === z)!;
    expect(zRow).toMatchObject({ tans: [], missingTotal: '700.00', notBooked: [] });
    expect(rep.clients.some((c) => c.clientId === x)).toBe(false);
    expect(rep.imports[0]).toMatchObject({
      source: '26as_text',
      credits: 10,
      pan: PAN,
      asOn: FIRST_AS_ON,
    });
    expect(rep.pan).toBe(PAN);

    // What a senior would query: 2% (technical rate) and 20% (no PAN).
    expect(rep.checks.find((c) => c.clientId === w)?.checks.map((c) => c.code)).toEqual([
      'rate_2',
      'rate_20',
    ]);

    // A quarter cuts the lists to itself.
    const q2 = await report(pa, 'Q2');
    expect(q2.matched.filter((m) => m.clientId === x).map((m) => m.kind)).toEqual([
      'tolerance',
      'split',
    ]);
    expect(q2.clients.find((c) => c.clientId === y)).toMatchObject({
      notBooked: [],
      missingTotal: '2500.00',
      awaited: [],
    });
  });

  it('adds up: every rupee credited or booked is in exactly one tile', async () => {
    for (const quarter of [undefined, 'Q2', 'Q4']) {
      const rep = await report(mp, quarter);
      const inPeriod = (fy: string, q: string) => fy === FY && (!quarter || q === quarter);
      const matchedBooked = sumAmounts(
        rep.matched.flatMap((m) =>
          m.receipts.filter((b) => inPeriod(b.financialYear, b.quarter)).map((b) => b.tdsAmount),
        ),
      );
      expect(
        toPaise(matchedBooked) + toPaise(rep.totals.missing) + toPaise(rep.totals.awaited),
      ).toBe(toPaise(rep.totals.booked));
      expect(toPaise(rep.totals.matched) + toPaise(rep.totals.notBooked)).toBe(
        toPaise(rep.totals.credited),
      );
    }
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
    await remind(pb, { clientId: y, channel: 'copy' }).expect(404);
    await http()
      .get(`/api/v1/billing/tds-credits/match?financialYear=${FY}`)
      .set(bearer(sy))
      .expect(403);
    await upload(sy, firstFile()).expect(403);
  });

  it('asks a client to file or correct, not twice in a week by accident; never for what is awaited', async () => {
    const sent = await remind(pa, { clientId: y, quarter: 'Q2', channel: 'copy' }).expect(201);
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

    // Again within the week: refused, saying when and how; then on purpose.
    const again = await remind(pa, { clientId: y, quarter: 'Q2', channel: 'copy' }).expect(409);
    expect(again.body.message).toMatch(/was reminded of this on .* by a copied message.*7 days/);
    await remind(pa, { clientId: y, quarter: 'Q2', channel: 'copy', force: true }).expect(201);

    // Q4 is not in a 26AS that old yet: nothing to chase.
    const early = await remind(pa, { clientId: y, quarter: 'Q4', channel: 'copy' }).expect(400);
    expect(early.body.message).toMatch(/awaited \(Your 26AS is as on 20 May 2026/);

    await remind(pa, { clientId: x }).expect(400);
    await remind(pa, { clientId: z, channel: 'whatsapp' }).expect(400);
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

  it('a Form 16A replaces its quarter; the same file or an older 26AS is refused; a newer 26AS replaces the year', async () => {
    const same = await upload(mp, firstFile(), 'again.txt').expect(409);
    expect(same.body.message).toMatch(/This file was imported on .*\(26AS\.txt, 2025-26\)/);
    const older = await upload(
      mp,
      twentySixAs(
        [{ tan: tanX, name: 'X CLIENT LTD', date: '2025-05-12', tds: '10000.00' }],
        '2026-05-01',
      ),
    ).expect(409);
    expect(older.body.message).toMatch(
      /This 26AS is as on 1 May 2026, older than the one imported on .* \(as on 20 May 2026\)/,
    );

    const form16a = [
      'FORM NO. 16A',
      'Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source',
      'Name and address of the deductor Name and address of the deductee',
      'Y CLIENT LLP  EXAMPLE AND CO',
      'PAN of the deductor TAN of the deductor PAN of the deductee',
      `AAAFY0001Y ${tanY} ${PAN}`,
      'CIT (TDS) Assessment Year Period',
      'The Commissioner of Income Tax (TDS) 2026-27 From 01-Jul-2025 To 30-Sep-2025',
      'Summary of payment',
      '1 25,000.00 194J 20-07-2025',
      'Summary of tax deducted at source in respect of deductee',
      'Q2 QWERTYUI 2,500.00 2,500.00',
    ].join('\n');
    const f = await upload(pa, form16a, 'Form16A.pdf.txt').expect(201);
    expect(f.body).toMatchObject({ source: 'form16a_pdf', credits: 1, superseded: 0, asOn: null });
    let rep = await report(pa);
    // A Form 16A says nothing of when the 26AS is as on.
    expect(rep.asOn).toBe(FIRST_AS_ON);
    expect(rep.matched.find((m) => m.receipts.some((b) => b.receiptId === r.yJul))).toMatchObject({
      kind: 'exact',
      clientId: y,
    });
    // The June credit, another quarter, is untouched.
    expect(rep.clients.find((c) => c.clientId === y)).toMatchObject({
      missing: [],
      notBookedTotal: '900.00',
      awaitedTotal: '300.00',
    });

    // A newer 26AS: only X's May credit. The year's earlier rows give way,
    // with a word that the TDS went down; Y's February deduction is now late.
    const newer = await upload(
      mp,
      twentySixAs(
        [{ tan: tanX, name: 'X CLIENT LTD', date: '2025-05-12', tds: '10000.00' }],
        '2026-07-01',
      ),
    ).expect(201);
    expect(newer.body.superseded).toBeGreaterThanOrEqual(11);
    expect(newer.body.warnings).toEqual([
      expect.stringMatching(/₹10,000\.00 of TDS for 2025-26, less than the ₹19,680\.40/),
    ]);
    rep = await report(pa);
    expect(rep.asOn).toBe('2026-07-01');
    expect(rep.matched.filter((m) => m.clientId === x).map((m) => m.kind)).toEqual(['exact']);
    expect(rep.clients.find((c) => c.clientId === x)!.missingTotal).toBe('6180.00');
    expect(rep.clients.find((c) => c.clientId === y)).toMatchObject({
      missingTotal: '2800.00',
      notBooked: [],
      awaited: [],
    });
    expect(rep.clients.some((c) => c.clientId === w)).toBe(false);

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

  it('gives a TAN on two clients to one, the same every time, and says so', async () => {
    const other = await client(null);
    // The same TAN, typed in lower case on a newer client.
    await superuser((c) =>
      c.query(
        `INSERT INTO hsdg.entity_registrations
           (entity_id, registration_type, registration_number, status)
         VALUES ($1, 'tan', $2, 'active')`,
        [other, tanX.toLowerCase()],
      ),
    );
    try {
      const rep = await report(pa);
      expect(rep.matched.filter((m) => m.clientId === x).map((m) => m.kind)).toEqual(['exact']);
      expect(rep.matched.some((m) => m.clientId === other)).toBe(false);
      expect(rep.notes.join(' ')).toContain(`${tanX} is on more than one client`);
    } finally {
      await superuser((c) =>
        c.query(`DELETE FROM hsdg.entity_registrations WHERE entity_id = $1`, [other]),
      );
    }
  });

  it('opens the password-protected ZIP TRACES sends, and knows its text again unzipped', async () => {
    // Made up: the head of a 26AS for 2026-27 as on 20 Nov 2026, zipped with 01042015.
    const zip = readFileSync(
      join(__dirname, '../src/modules/billing/__fixtures__/26as-locked.zip'),
    );
    const need = await send(mp, zip, '26AS.zip').expect(400);
    expect(need.body).toMatchObject({ reason: 'TDS_PDF_PASSWORD', wrongPassword: false });
    expect(need.body.message).toMatch(/ZIP is password-protected.*DDMMYYYY/);
    const wrong = await send(mp, zip, '26AS.zip', '31121999').expect(400);
    expect(wrong.body).toMatchObject({ reason: 'TDS_PDF_PASSWORD', wrongPassword: true });

    const ok = await send(mp, zip, '26AS.zip', '01042015').expect(201);
    expect(ok.body).toMatchObject({
      source: '26as_text',
      financialYear: '2026-27',
      asOn: '2026-11-20',
      credits: 2,
      tdsTotal: '15000.00',
    });
    const inside = readTdsZip(zip, '01042015');
    if (inside.kind !== 'file') throw new Error(inside.kind);
    const again = await send(mp, inside.bytes, inside.name).expect(409);
    expect(again.body.message).toMatch(/This file was imported on .*\(26AS\.zip, 2026-27\)/);

    // Not on the batch, not in the audit trail.
    const leaked = await superuser((c) =>
      c.query(
        `SELECT 1 FROM hsdg.firm_tds_import_batches b WHERE b.id = $1 AND b::text LIKE $2
         UNION ALL
         SELECT 1 FROM hsdg.audit_events a WHERE a.object_id = $3 AND a::text LIKE $2`,
        [ok.body.batchId, '%01042015%', ok.body.batchId],
      ),
    );
    expect(leaked.rows).toEqual([]);
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
        twentySixAs([{ tan: tanX, name: 'X', date: '2025-05-12', tds: '1.00' }], '2026-08-01'),
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
      'The Commissioner of Income Tax (TDS) 2026-27 From 01-Oct-2025 To 31-Dec-2025',
      'Summary of payment',
      '1 640.00 194J 05-10-2025',
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
      send(pa, Buffer.from('%PDF-1.7 locked q3'), 'Form16A-Q3.pdf', password);
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

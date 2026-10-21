import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  fromPaise,
  toPaise,
  type BankMatchResult,
  type BooksExportRecord,
  type BooksMonth,
  type BooksSettings,
  type ClientBillingProfile,
  type GstOutwardRegister,
  type InvoiceDetail,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Accountant role, phase 2c (spec §3.7): Reports → Finance. The GST outward
 * register, the books export (each voucher once) and the bank statement
 * match are the Accountant's and the Managing Partner's alone — partners,
 * managers and seniors are refused at the API and see no books rows in the
 * database.
 */
describe('Finance reports: GST register, books export, bank match (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let mx: string;
  let sy: string;
  let ac: string;
  let today: string;
  let month: string;

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

  /** Row counts of the books tables as the application role in a role context. */
  const booksRowsAs = async (role: string, email: string): Promise<number[]> =>
    superuser(async (c) => {
      await c.query('BEGIN');
      try {
        const office = await c.query<{ id: string }>(
          `SELECT primary_office_id AS id FROM hsdg.users WHERE email = $1`,
          [email],
        );
        await c.query('SET LOCAL ROLE hsdg_app');
        await c.query(
          `SELECT set_config('hsdg.role', $1, true), set_config('hsdg.roles', $1, true),
                  set_config('hsdg.office_id', $2, true)`,
          [role, office.rows[0]!.id],
        );
        const out: number[] = [];
        for (const t of ['books_settings', 'books_exports', 'books_export_items']) {
          const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM hsdg.${t}`);
          out.push(Number(rows[0]!.n));
        }
        return out;
      } finally {
        await c.query('ROLLBACK');
      }
    });

  const findId = async (path: string): Promise<string> => {
    const res = await http().get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };

  /** An issued invoice for a fresh NORTH client: one line of `amount` at 18%. */
  const issuedInvoice = async (amount: string): Promise<{ inv: InvoiceDetail; client: string }> => {
    const bharat = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=GST_MONTHLY&limit=100');
    const client = await freshClient(bharat);
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId: client,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `P${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    const draft = (
      await http()
        .post(`/api/v1/engagements/${eng}/invoices`)
        .set(bearer(mp))
        .send({ lines: [{ description: 'Advisory', quantity: '1', unitAmount: amount }] })
        .expect(201)
    ).body as InvoiceDetail;
    const inv = (
      await http()
        .post(`/api/v1/engagements/${eng}/invoices/${draft.id}/status`)
        .set(bearer(mp))
        .send({ status: 'issued', issueDate: today })
        .expect(201)
    ).body as InvoiceDetail;
    return { inv, client };
  };

  const register = async (t = ac): Promise<GstOutwardRegister> =>
    (
      await http()
        .get(`/api/v1/reports/finance/gst-register?month=${month}`)
        .set(bearer(t))
        .expect(200)
    ).body as GstOutwardRegister;

  const books = async (): Promise<BooksMonth> =>
    (await http().get(`/api/v1/reports/finance/books?month=${month}`).set(bearer(ac)).expect(200))
      .body as BooksMonth;

  const exportBooks = (format: string) =>
    http().post('/api/v1/reports/finance/books/export').set(bearer(ac)).send({ month, format });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    [mp, pa, mx, sy, ac] = await Promise.all([
      token('mp@dhvaj.in'),
      token('partner.a@dhvaj.in'),
      token('manager.x@dhvaj.in'),
      token('senior.y@dhvaj.in'),
      token('accounts@dhvaj.in'),
    ]);
    const { rows } = await superuser((c) =>
      c.query<{ d: string }>(`SELECT timezone('Asia/Kolkata', now())::date::text AS d`),
    );
    today = rows[0]!.d;
    month = today.slice(0, 7);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('who may see the finance reports', () => {
    it('refuses partners, managers and seniors at the API', async () => {
      for (const t of [pa, mx, sy]) {
        await http()
          .get(`/api/v1/reports/finance/gst-register?month=${month}`)
          .set(bearer(t))
          .expect(403);
        await http().get(`/api/v1/reports/finance/books?month=${month}`).set(bearer(t)).expect(403);
        await http()
          .post('/api/v1/reports/finance/books/export')
          .set(bearer(t))
          .send({ month, format: 'journal_csv' })
          .expect(403);
        await http()
          .post('/api/v1/reports/finance/bank-match')
          .set(bearer(t))
          .send({
            filename: 's.csv',
            contentBase64: Buffer.from('Date,Narration,Deposit\n').toString('base64'),
          })
          .expect(403);
      }
      await http()
        .get(`/api/v1/reports/finance/gst-register?month=${month}`)
        .set(bearer(mp))
        .expect(200);
      await http()
        .get(`/api/v1/reports/finance/gst-register?month=2026-13`)
        .set(bearer(ac))
        .expect(400);
    });

    it('gives the books tables to finance and the managing partner only', async () => {
      expect((await booksRowsAs('accountant', 'accounts@dhvaj.in'))[0]).toBe(1);
      expect((await booksRowsAs('managing_partner', 'mp@dhvaj.in'))[0]).toBe(1);
      expect(await booksRowsAs('partner', 'partner.a@dhvaj.in')).toEqual([0, 0, 0]);
      expect(await booksRowsAs('manager', 'manager.x@dhvaj.in')).toEqual([0, 0, 0]);
      expect(await booksRowsAs('senior', 'senior.y@dhvaj.in')).toEqual([0, 0, 0]);
      // Nor may they write one: the policy's WITH CHECK refuses the insert.
      await expect(
        superuser(async (c) => {
          await c.query('BEGIN');
          try {
            await c.query('SET LOCAL ROLE hsdg_app');
            await c.query(
              `SELECT set_config('hsdg.role', 'partner', true), set_config('hsdg.roles', 'partner', true)`,
            );
            await c.query(
              `INSERT INTO hsdg.books_exports (month, format, voucher_count) VALUES (date_trunc('month', now())::date, 'journal_csv', 1)`,
            );
          } finally {
            await c.query('ROLLBACK');
          }
        }),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('GST outward register', () => {
    it('takes in an issued invoice and ties out to the invoices', async () => {
      const before = await register();
      const { inv } = await issuedInvoice('6123.00');
      const after = await register();
      const d = (a: string, b: string) => fromPaise(toPaise(a) - toPaise(b));
      expect(d(after.tieOut.invoices.portal.taxable, before.tieOut.invoices.portal.taxable)).toBe(
        '6123.00',
      );
      expect(
        d(after.tieOut.invoices.register.taxable, before.tieOut.invoices.register.taxable),
      ).toBe('6123.00');
      expect(d(after.tieOut.invoices.portal.total, before.tieOut.invoices.portal.total)).toBe(
        d(inv.total, '0'),
      );
      const issued = after.docs
        .filter((s) => s.nature === 'invoices')
        .reduce((n, s) => n + s.total, 0);
      const was = before.docs
        .filter((s) => s.nature === 'invoices')
        .reduce((n, s) => n + s.total, 0);
      expect(issued - was).toBe(1);
      expect(after.month).toBe(month);
    });

    it('downloads the GSTR-1 sheets and the GSTN JSON', async () => {
      const xlsx = await http()
        .get(`/api/v1/reports/finance/gst-register/file?month=${month}&format=xlsx`)
        .set(bearer(ac))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(xlsx.headers['content-type']).toContain('spreadsheetml');
      expect((xlsx.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
      const json = await http()
        .get(`/api/v1/reports/finance/gst-register/file?month=${month}&format=json`)
        .set(bearer(ac))
        .expect(200);
      const body = JSON.parse(json.text) as { fp: string };
      expect(body.fp).toBe(`${month.slice(5)}${month.slice(0, 4)}`);
      await http()
        .get(`/api/v1/reports/finance/gst-register/file?month=${month}&format=pdf`)
        .set(bearer(ac))
        .expect(400);
    });
  });

  describe('books export', () => {
    it('sends each voucher to the books once, and gives it back when an export is undone', async () => {
      const { inv, client } = await issuedInvoice('4100.00');
      let m = await books();
      const sale = m.vouchers.find((v) => v.source === 'invoice' && v.sourceId === inv.id);
      expect(sale).toMatchObject({ type: 'Sales', number: inv.invoiceNumber, exportedAt: null });
      expect(m.pending).toBeGreaterThan(0);

      const first = (await exportBooks('tally_xml').expect(201)).body as BooksExportRecord;
      expect(first).toMatchObject({ month, format: 'tally_xml', voucherCount: m.pending });
      const xml = await http()
        .get(`/api/v1/reports/finance/books/exports/${first.id}/file`)
        .set(bearer(ac))
        .expect(200);
      expect(xml.text).toContain(`<VOUCHERNUMBER>${inv.invoiceNumber}</VOUCHERNUMBER>`);

      // Nothing goes twice.
      const again = await exportBooks('tally_xml').expect(409);
      expect(again.body.message).toMatch(/Nothing new to export/);
      m = await books();
      expect(m.pending).toBe(0);
      expect(m.vouchers.find((v) => v.sourceId === inv.id)!.exportedAt).not.toBeNull();
      expect(m.exports[0]).toMatchObject({ id: first.id, exportedByName: expect.any(String) });

      // A receipt after the export is the only thing the next one takes.
      const net = fromPaise(toPaise(inv.total) - toPaise('410.00'));
      await http()
        .post('/api/v1/billing/receipts')
        .set(bearer(ac))
        .send({
          clientEntityId: client,
          receivedOn: today,
          mode: 'bank',
          reference: `UTR${unique()}`,
          netAmount: net,
          tdsAmount: '410.00',
          tdsSection: '194J',
          allocations: [{ invoiceId: inv.id, amount: inv.total }],
        })
        .expect(201);
      m = await books();
      expect(m.pending).toBe(1);
      const rcpt = m.vouchers.find((v) => !v.exportedAt)!;
      expect(rcpt).toMatchObject({ source: 'receipt', type: 'Receipt' });
      expect(rcpt.entries).toEqual([
        { ledger: 'Bank', debit: net, credit: '0.00' },
        { ledger: 'TDS Receivable', debit: '410.00', credit: '0.00' },
        { ledger: expect.any(String), debit: '0.00', credit: inv.total },
      ]);
      const second = (await exportBooks('journal_csv').expect(201)).body as BooksExportRecord;
      expect(second.voucherCount).toBe(1);
      const csv = await http()
        .get(`/api/v1/reports/finance/books/exports/${second.id}/file`)
        .set(bearer(ac))
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text.split('\r\n')[0]).toBe(
        'Date,Voucher Type,Voucher No,Ledger,Debit,Credit,Narration',
      );
      expect(csv.text).toContain(rcpt.number);
      expect(csv.text).not.toContain(inv.invoiceNumber + ',');

      // Undo the second export: the receipt is pending again; the first stays.
      await http()
        .delete(`/api/v1/reports/finance/books/exports/${second.id}`)
        .set(bearer(ac))
        .expect(204);
      m = await books();
      expect(m.pending).toBe(1);
      expect(m.exports.map((e) => e.id)).not.toContain(second.id);
      await exportBooks('journal_csv').expect(201);

      // A partner can neither download nor undo an export.
      await http()
        .get(`/api/v1/reports/finance/books/exports/${first.id}/file`)
        .set(bearer(pa))
        .expect(403);
      await http()
        .delete(`/api/v1/reports/finance/books/exports/${first.id}`)
        .set(bearer(pa))
        .expect(403);
      const audit = await superuser((c) =>
        c.query<{ action: string }>(
          `SELECT action FROM hsdg.audit_events WHERE object_type = 'books_export' AND object_id::text = $1`,
          [second.id],
        ),
      );
      expect(audit.rows.map((r) => r.action).sort()).toEqual([
        'books.export_undone',
        'books.exported',
      ]);
    });

    it('posts to the ledger names the firm sets, under a version check', async () => {
      const s = (
        await http().get('/api/v1/reports/finance/books/settings').set(bearer(ac)).expect(200)
      ).body as BooksSettings;
      const renamed = (
        await http()
          .patch('/api/v1/reports/finance/books/settings')
          .set(bearer(ac))
          .send({ version: s.version, bank: 'HDFC Bank Current A/c' })
          .expect(200)
      ).body as BooksSettings;
      expect(renamed).toMatchObject({
        bank: 'HDFC Bank Current A/c',
        sales: s.sales,
        version: s.version + 1,
      });
      await http()
        .patch('/api/v1/reports/finance/books/settings')
        .set(bearer(ac))
        .send({ version: s.version, bank: 'Stale' })
        .expect(409);
      await http()
        .patch('/api/v1/reports/finance/books/settings')
        .set(bearer(ac))
        .send({ version: renamed.version, cash: '   ' })
        .expect(400);
      await http()
        .patch('/api/v1/reports/finance/books/settings')
        .set(bearer(mx))
        .send({ version: renamed.version, bank: 'Mine' })
        .expect(403);
      expect((await books()).ledgers.bank).toBe('HDFC Bank Current A/c');
      await http()
        .patch('/api/v1/reports/finance/books/settings')
        .set(bearer(ac))
        .send({ version: renamed.version, bank: s.bank })
        .expect(200);
    });
  });

  describe('bank statement match', () => {
    it('proposes the invoice a credit pays, less the TDS', async () => {
      // An odd amount, so no other suite's invoice makes the same credit.
      const { inv, client } = await issuedInvoice('7321.00');
      const profile = (
        await http().get(`/api/v1/billing/clients/${client}/profile`).set(bearer(ac)).expect(200)
      ).body as ClientBillingProfile;
      const tds = '732.10';
      const net = fromPaise(toPaise(inv.total) - toPaise(tds));
      const [y, mo, d] = today.split('-');
      const csv = [
        'HDFC BANK LTD',
        'Statement of account',
        '',
        'Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance',
        `${d}/${mo}/${y},NEFT CR-${profile.legalName.toUpperCase()},N${unique()},,${net},100000.00`,
        `${d}/${mo}/${y},POS PURCHASE,,1200.00,,98800.00`,
      ].join('\n');
      const res = await http()
        .post('/api/v1/reports/finance/bank-match')
        .set(bearer(ac))
        .send({ filename: 'statement.csv', contentBase64: Buffer.from(csv).toString('base64') })
        .expect(200);
      const r = res.body as BankMatchResult;
      expect(r).toMatchObject({ credits: 1, debitsSkipped: 1 });
      expect(r.columns).toMatchObject({ date: 'Date', credit: 'Deposit Amt.' });
      const top = r.lines[0]!.proposals[0]!;
      expect(top).toMatchObject({ clientId: client, tds, gross: inv.total, confidence: 'high' });
      expect(top.invoices).toEqual([
        {
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          balance: inv.total,
          allocate: inv.total,
        },
      ]);
    });

    it('says plainly when the file is not a statement', async () => {
      const res = await http()
        .post('/api/v1/reports/finance/bank-match')
        .set(bearer(ac))
        .send({
          filename: 'notes.csv',
          contentBase64: Buffer.from('a,b\n1,2\n').toString('base64'),
        })
        .expect(400);
      expect(res.body.message).toMatch(/No date, narration and credit/);
    });
  });
});

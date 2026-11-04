import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { deflateSync } from 'node:zlib';
import type {
  FirmInvoiceProfile,
  InvoiceService,
  QuickInvoiceResult,
  SendInvoiceResult,
} from '@hsdg/contracts';
import { addMonth } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { istDateFromToday } from './date.helper';
import { RecurringInvoicesService } from '../src/modules/billing/quick/recurring-invoices.service';

/** A 2×2 red PNG. */
function redPng(): Buffer {
  const chunk = (name: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    return Buffer.concat([len, Buffer.from(name, 'latin1'), body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Quick invoices: the firm in full on the PDF (with its logo and bank),
 * a one-row invoice from a service on the engagement, sending it (e-mail,
 * WhatsApp, mail app) with a public 30-day PDF link, and the monthly
 * schedule — active issued, manual a draft, paused nothing.
 */
describe('Quick invoices (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: Record<string, string>;
  let pa: Record<string, string>;
  let mx: Record<string, string>;
  let sy: Record<string, string>;
  let eng: string;
  let entity: string;
  let gst: InvoiceService;
  let incomeTax: InvoiceService;
  let firmBefore: Record<string, unknown>;
  const today = istDateFromToday(0);
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const services = async () =>
    (await http().get(`/api/v1/engagements/${eng}/invoice-services`).set(pa).expect(200))
      .body as InvoiceService[];
  const quick = (h: Record<string, string>, body: Record<string, unknown>) =>
    http().post(`/api/v1/engagements/${eng}/invoices/quick`).set(h).send(body);
  const tokenOf = (link: string) => link.split('/invoice/')[1]!;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    firmBefore = (
      await su.query(`SELECT gstin, state_code, invoice_prefix FROM hsdg.firm_settings LIMIT 1`)
    ).rows[0];
    // GST mode: the firm's state decides CGST + SGST or IGST.
    await su.query(`UPDATE hsdg.firm_settings SET gstin = '07AAAFD1234K1Z5', state_code = '07'`);
    mp = await as('mp@dhvaj.in');
    pa = await as('partner.a@dhvaj.in');
    mx = await as('manager.x@dhvaj.in');
    sy = await as('senior.y@dhvaj.in');
    const emp = Object.fromEntries(
      (
        await su.query<{ email: string; id: string }>(
          `SELECT u.email::text, e.id FROM hsdg.users u JOIN hsdg.employees e ON e.user_id = u.id`,
        )
      ).rows.map((r) => [r.email, r.id]),
    );
    const acme = (
      (await http().get('/api/v1/entities?search=Acme&limit=10').set(mp).expect(200)).body
        .items as { id: string }[]
    )[0]!.id;
    entity = await freshClient(acme);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: entity,
          status: 'accepted',
          engagementPartnerEmployeeId: emp['partner.a@dhvaj.in'],
          engagementManagerEmployeeId: emp['manager.x@dhvaj.in'],
          engagementType: 'recurring_compliance',
          financialYear: '2026-27',
          streams: ['income_tax', 'gst'],
          years: [{ financialYear: '2026-27' }],
          streamLeads: {},
        })
        .expect(201)
    ).body.id as string;
    const list = await services();
    gst = list.find((s) => s.stream === 'gst')!;
    incomeTax = list.find((s) => s.stream === 'income_tax')!;
  });

  afterAll(async () => {
    await su?.query(
      `UPDATE hsdg.firm_settings SET gstin = $1, state_code = $2, pan = NULL, bank_name = NULL,
              bank_account_name = NULL, bank_account_number = NULL, bank_ifsc = NULL,
              logo = NULL, logo_content_type = NULL`,
      [firmBefore?.gstin ?? null, firmBefore?.state_code ?? null],
    );
    await su?.end();
    await app?.close();
  });

  it('lists the engagement’s services to bill, with no schedule yet', () => {
    expect(gst).toMatchObject({ schedule: null, engagementServiceId: expect.any(String) });
    expect(incomeTax).toBeDefined();
  });

  it('partners set the firm’s PAN, bank and logo; bad values and others are refused', async () => {
    const p = await http()
      .patch('/api/v1/billing/firm-profile')
      .set(mp)
      .send({
        pan: 'aaafd1234k',
        bankAccountName: 'Dhvaj & Co',
        bankName: 'HDFC Bank',
        bankAccountNumber: '5020 0012 3456',
        bankIfsc: 'hdfc0001234',
      })
      .expect(200);
    expect(p.body as FirmInvoiceProfile).toMatchObject({
      pan: 'AAAFD1234K',
      bankAccountNumber: '502000123456',
      bankIfsc: 'HDFC0001234',
    });
    const bad = await http()
      .patch('/api/v1/billing/firm-profile')
      .set(mp)
      .send({ bankIfsc: 'NOTANIFSC' })
      .expect(400);
    expect(bad.body.message).toMatch(/IFSC/);
    await http().patch('/api/v1/billing/firm-profile').set(mx).send({ pan: null }).expect(403);
    await http()
      .put('/api/v1/billing/firm-profile/logo')
      .set(mp)
      .send({
        contentType: 'image/png',
        contentBase64: Buffer.from('not a png').toString('base64'),
      })
      .expect(400);
    const logo = await http()
      .put('/api/v1/billing/firm-profile/logo')
      .set(mp)
      .send({ contentType: 'image/png', contentBase64: redPng().toString('base64') })
      .expect(200);
    expect(logo.body.logoContentType).toBe('image/png');
  });

  let issued: QuickInvoiceResult;
  it('a partner: service, amount, GST % → issued at once, CGST + SGST, the service on the line', async () => {
    const r = await quick(pa, {
      engagementServiceId: gst.engagementServiceId,
      amount: '15000',
      gstRate: 18,
    }).expect(201);
    issued = r.body as QuickInvoiceResult;
    expect(issued.issued).toBe(true);
    expect(issued.invoice).toMatchObject({
      status: 'issued',
      subtotal: '15000.00',
      cgst: '1350.00',
      sgst: '1350.00',
      igst: '0.00',
      total: '17700.00',
      hasPdf: true,
    });
    expect(issued.invoice.invoiceNumber).toBeTruthy();
    expect(issued.invoice.lines[0]!.description).toMatch(/ — \w+ \d{4}$/);
    const line = await su.query(
      `SELECT engagement_service_id FROM hsdg.invoice_line_items WHERE invoice_id = $1`,
      [issued.invoice.id],
    );
    expect(line.rows[0].engagement_service_id).toBe(gst.engagementServiceId);
  });

  it('a manager who may not issue gets the draft and the reason; a bad rate or service is refused', async () => {
    const r = await quick(mx, {
      engagementServiceId: incomeTax.engagementServiceId,
      amount: '5000',
      gstRate: 18,
    }).expect(201);
    expect(r.body).toMatchObject({ issued: false, notIssuedReason: expect.any(String) });
    expect(r.body.invoice.status).toBe('draft');
    await quick(pa, {
      engagementServiceId: gst.engagementServiceId,
      amount: '1',
      gstRate: 7,
    }).expect(400);
    await quick(pa, {
      engagementServiceId: '00000000-0000-4000-8000-000000000000',
      amount: '1',
      gstRate: 18,
    }).expect(404);
    await quick(sy, {
      engagementServiceId: gst.engagementServiceId,
      amount: '1',
      gstRate: 18,
    }).expect(403);
  });

  it('sends: options follow the contact; e-mail, WhatsApp and mail app each carry the link and are logged', async () => {
    const inv = issued.invoice.id;
    const base = `/api/v1/engagements/${eng}/invoices/${inv}`;
    const none = await http().get(`${base}/send-options`).set(pa).expect(200);
    expect(none.body).toMatchObject({ email: null, whatsappNumber: null });
    await http().post(`${base}/send`).set(pa).send({ channel: 'whatsapp' }).expect(400);

    await su.query(
      `INSERT INTO hsdg.entity_contacts (entity_id, full_name, email, phone, is_primary)
       VALUES ($1, 'Ravi Kumar', 'ravi@acme.example', '98100 12345', true)`,
      [entity],
    );
    const opts = await http().get(`${base}/send-options`).set(pa).expect(200);
    expect(opts.body).toEqual({
      email: 'ravi@acme.example',
      whatsappNumber: '919810012345',
      emailDelivery: true,
    });

    const wa = (await http().post(`${base}/send`).set(pa).send({ channel: 'whatsapp' }).expect(201))
      .body as SendInvoiceResult;
    expect(wa.waUrl).toMatch(/^https:\/\/wa\.me\/919810012345\?text=/);
    expect(wa.text).toContain(wa.link);
    expect(wa.link).toMatch(/\/invoice\/[A-Za-z0-9_-]{40,}$/);

    const mail = (
      await http().post(`${base}/send`).set(pa).send({ channel: 'mail_app' }).expect(201)
    ).body as SendInvoiceResult;
    expect(mail.mailtoUrl).toMatch(/^mailto:ravi%40acme\.example\?subject=/);

    const email = (await http().post(`${base}/send`).set(pa).send({ channel: 'email' }).expect(201))
      .body as SendInvoiceResult;
    expect(email).toMatchObject({ queued: true, to: 'ravi@acme.example' });
    const outbox = await su.query(
      `SELECT count(*)::int AS n FROM hsdg.notification_deliveries
        WHERE recipient_email = 'ravi@acme.example' AND type = 'invoice_sent'`,
    );
    expect(outbox.rows[0].n).toBeGreaterThan(0);

    const log = await http().get(`${base}/sends`).set(pa).expect(200);
    expect(log.body.map((s: { channel: string }) => s.channel).sort()).toEqual([
      'email',
      'mail_app',
      'whatsapp',
    ]);

    // A draft does not go out.
    const draft = await quick(pa, {
      engagementServiceId: gst.engagementServiceId,
      amount: '100',
      gstRate: 0,
      issue: false,
    }).expect(201);
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${draft.body.invoice.id}/send`)
      .set(pa)
      .send({ channel: 'whatsapp' })
      .expect(400);

    // The client's link: what it is, then the PDF with the firm in full.
    const info = await http()
      .get(`/api/v1/invoice-links/${tokenOf(wa.link)}`)
      .expect(200);
    expect(info.body).toMatchObject({
      valid: true,
      invoiceNumber: issued.invoice.invoiceNumber,
      total: '17700.00',
    });
    const pdf = await http()
      .get(`/api/v1/invoice-links/${tokenOf(wa.link)}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .expect(200);
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Im1 Do');
    expect(text).toContain('(Bank details)');
    expect(text).toContain('PAN: AAAFD1234K');
    expect(text).toContain('IFSC: HDFC0001234');
    expect(
      (
        await su.query(
          `SELECT max(opened_count)::int AS n FROM hsdg.invoice_share_links WHERE invoice_id = $1`,
          [inv],
        )
      ).rows[0].n,
    ).toBe(1);

    const junk = await http()
      .get('/api/v1/invoice-links/not-a-real-token-but-long-enough')
      .expect(200);
    expect(junk.body.valid).toBe(false);
    await http().get('/api/v1/invoice-links/not-a-real-token-but-long-enough/pdf').expect(404);
  });

  it('monthly: active is issued on the day, manual is a draft, paused is nothing; never twice', async () => {
    // Earlier tests billed the GST service by hand today; the runs below are
    // on the 1st of next month, a month not yet billed.
    const due = addMonth(`${today.slice(0, 8)}01`);
    const put = (h: Record<string, string>, svc: InvoiceService, body: Record<string, unknown>) =>
      http()
        .put(`/api/v1/engagements/${eng}/invoice-services/${svc.engagementServiceId}/schedule`)
        .set(h)
        .send(body);
    await put(sy, gst, { amount: '10000', gstRate: 18, dayOfMonth: 1, mode: 'active' }).expect(403);
    await put(pa, gst, { amount: '10000', gstRate: 18, dayOfMonth: 29, mode: 'active' }).expect(
      400,
    );
    // Set on today's day, right after billing this month by hand: it starts next month.
    const todayDay = Math.min(Number(today.slice(8, 10)), 28);
    const first = await put(pa, gst, {
      amount: '10000',
      gstRate: 18,
      dayOfMonth: todayDay,
      mode: 'active',
    }).expect(200);
    expect(first.body.nextRunOn.slice(0, 7) > today.slice(0, 7)).toBe(true);
    const a = await put(pa, gst, {
      amount: '10000',
      gstRate: 18,
      dayOfMonth: 1,
      mode: 'active',
    }).expect(200);
    expect(a.body).toMatchObject({ mode: 'active', amount: '10000.00', dayOfMonth: 1 });
    await put(pa, incomeTax, { amount: '2500', gstRate: 18, dayOfMonth: 1, mode: 'manual' }).expect(
      200,
    );
    const runner = app.get(RecurringInvoicesService);
    // Due today, but the month was billed by hand: skipped to next month, no second invoice.
    await su.query(
      `UPDATE hsdg.recurring_invoice_schedules SET next_run_on = $2::date WHERE engagement_service_id = $1`,
      [gst.engagementServiceId, today],
    );
    const skip = await runner.runDue(today);
    expect(skip).toMatchObject({ issued: 0, skipped: 1 });
    expect((await services()).find((s) => s.stream === 'gst')!.schedule!.nextRunOn > today).toBe(
      true,
    );

    // Both due on the 1st of next month.
    await su.query(
      `UPDATE hsdg.recurring_invoice_schedules SET next_run_on = $2::date WHERE engagement_id = $1`,
      [eng, due],
    );
    const count = async () =>
      (
        await su.query(
          `SELECT status, count(*)::int AS n FROM hsdg.invoices WHERE engagement_id = $1 GROUP BY 1`,
          [eng],
        )
      ).rows as { status: string; n: number }[];
    const before = await count();
    const res = await runner.runDue(due);
    expect(res).toMatchObject({ issued: 1, drafts: 1, failed: 0 });
    const after = await count();
    const n = (rows: { status: string; n: number }[], s: string) =>
      rows.find((r) => r.status === s)?.n ?? 0;
    expect(n(after, 'issued') - n(before, 'issued')).toBe(1);
    expect(n(after, 'draft') - n(before, 'draft')).toBe(1);

    const list = await services();
    const g = list.find((s) => s.stream === 'gst')!.schedule!;
    expect(g.lastRunOn).toBe(due);
    expect(g.nextRunOn > due).toBe(true);
    expect(g.lastInvoiceId).toBeTruthy();
    expect((await runner.runDue(due)).issued).toBe(0);

    // Paused: nothing even when due; resuming starts from the next such day.
    await put(pa, gst, { amount: '10000', gstRate: 18, dayOfMonth: 1, mode: 'paused' }).expect(200);
    await su.query(
      `UPDATE hsdg.recurring_invoice_schedules SET next_run_on = $2::date WHERE engagement_service_id = $1`,
      [gst.engagementServiceId, due],
    );
    expect((await runner.runDue(due)).issued).toBe(0);
    const resumed = await put(pa, gst, {
      amount: '10000',
      gstRate: 18,
      dayOfMonth: 1,
      mode: 'active',
    }).expect(200);
    expect(resumed.body.nextRunOn >= today).toBe(true);

    await http()
      .delete(
        `/api/v1/engagements/${eng}/invoice-services/${incomeTax.engagementServiceId}/schedule`,
      )
      .set(pa)
      .expect(204);
    expect((await services()).find((s) => s.stream === 'income_tax')!.schedule).toBeNull();
  });

  it('a voided invoice’s link no longer opens', async () => {
    const r = await quick(pa, {
      engagementServiceId: gst.engagementServiceId,
      amount: '700',
      gstRate: 18,
    }).expect(201);
    const inv = r.body.invoice.id as string;
    const sent = (
      await http()
        .post(`/api/v1/engagements/${eng}/invoices/${inv}/send`)
        .set(pa)
        .send({ channel: 'mail_app' })
        .expect(201)
    ).body as SendInvoiceResult;
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${inv}/status`)
      .set(mp)
      .send({ status: 'void', reason: 'Raised in error' })
      .expect(201);
    expect(
      (
        await http()
          .get(`/api/v1/invoice-links/${tokenOf(sent.link)}`)
          .expect(200)
      ).body.valid,
    ).toBe(false);
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { NotificationItem, ReceivablesReport } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { istDateFromToday } from './date.helper';

/**
 * PS-203 · Receivables ageing and payment reminders.
 *
 * Done when: the managing partner sees over-90 receivables by partner, and a
 * manager sends a WhatsApp reminder from the invoice that is logged. Also: the
 * age bands at their edges, an office's partner sees only their clients, the
 * scheduler raises invoice_overdue once per band and full payment resolves it.
 */
describe('PS-203 receivables and payment reminders (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const today = istDateFromToday(0);

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

  /** A fresh NORTH client and an engagement Partner A leads on it. */
  const client = async (): Promise<{ entityId: string; eng: string }> => {
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
    return { entityId, eng: res.body.id as string };
  };

  /** An issued invoice of `amount` (no firm GSTIN, so no tax), its due date `daysPastDue` days ago. */
  const invoice = async (eng: string, amount: string, daysPastDue: number): Promise<string> => {
    const d = await http()
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(bearer(pa))
      .send({
        dueDate: istDateFromToday(15),
        lines: [{ description: 'Professional fees', unitAmount: amount }],
      })
      .expect(201);
    const id = d.body.id as string;
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${id}/status`)
      .set(bearer(pa))
      .send({ status: 'issued', issueDate: today })
      .expect(201);
    // Age it: an issued invoice's dates are frozen, so past its triggers.
    await superuser(async (c) => {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`UPDATE hsdg.invoices SET issue_date = $2, due_date = $3 WHERE id = $1`, [
        id,
        istDateFromToday(-daysPastDue - 15),
        istDateFromToday(-daysPastDue),
      ]);
    });
    return id;
  };

  const report = async (t: string): Promise<ReceivablesReport> =>
    (await http().get('/api/v1/reports/receivables').set(bearer(t)).expect(200))
      .body as ReceivablesReport;
  // Only the overdue nudges: a firm-wide scan raises many at one created_at,
  // so an unfiltered first page need not hold this invoice's.
  const inbox = async (t: string): Promise<NotificationItem[]> =>
    (
      await http()
        .get('/api/v1/notifications?type=invoice_overdue&limit=100')
        .set(bearer(t))
        .expect(200)
    ).body.items as NotificationItem[];
  const scan = () => http().post('/api/v1/notifications/scan').set(bearer(mp)).expect(201);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
  });

  afterAll(async () => {
    await superuser((c) => c.query(`UPDATE hsdg.firm_settings SET auto_invoice_reminders = false`));
    await app?.close();
  });

  it('ages each balance into its band, by client and by partner, for the offices that bill it', async () => {
    const { entityId, eng } = await client();
    const ages = [30, 31, 90, 91, 181];
    for (const d of ages) await invoice(eng, '1000.00', d);

    const r = await report(mp);
    const row = r.byClient.find((c) => c.id === entityId)!;
    expect(row).toMatchObject({
      bands: {
        current: '0.00',
        d0_30: '1000.00',
        d31_60: '1000.00',
        d61_90: '1000.00',
        d91_180: '1000.00',
        over_180: '1000.00',
      },
      total: '5000.00',
      over90: '2000.00',
      openInvoices: 5,
      oldestInvoice: expect.objectContaining({ daysPastDue: 181, balance: '1000.00' }),
      lastReceipt: null,
    });
    expect(r.asOf).toBe(today);
    const partnerA = r.byPartner.find((p) => p.name.startsWith('Partner A'));
    expect(partnerA).toBeDefined();
    expect(Number(partnerA!.over90)).toBeGreaterThanOrEqual(2000);

    // A SOUTH partner does not bill a NORTH client.
    expect((await report(pb)).byClient.find((c) => c.id === entityId)).toBeUndefined();
    // Neither billing.manage nor report.read: no report.
    await http()
      .get('/api/v1/reports/receivables')
      .set(bearer(await token('senior.y@dhvaj.in')))
      .expect(403);
  });

  it('a manager sends a WhatsApp reminder from the invoice, and it is logged', async () => {
    const { entityId, eng } = await client();
    const inv = await invoice(eng, '50000.00', 20);
    const remind = (t: string, body: Record<string, unknown>) =>
      http().post(`/api/v1/billing/invoices/${inv}/remind`).set(bearer(t)).send(body);

    // No phone yet: WhatsApp cannot be used.
    await remind(mx, { channel: 'whatsapp' }).expect(400);
    await superuser((c) =>
      c.query(
        `INSERT INTO hsdg.entity_contacts (entity_id, full_name, phone, is_primary)
         VALUES ($1, 'Accounts', '+91 98765-43210', true)`,
        [entityId],
      ),
    );
    const wa = await remind(mx, { channel: 'whatsapp' }).expect(201);
    expect(wa.body).toMatchObject({ invoiceId: inv, channel: 'whatsapp' });
    expect(wa.body.text).toContain('50,000.00');
    expect(wa.body.text).toContain('20 days ago');
    expect(wa.body.waUrl).toBe(
      `https://wa.me/919876543210?text=${encodeURIComponent(wa.body.text as string)}`,
    );
    await remind(mx, { channel: 'copy' }).expect(201);

    const log = await http()
      .get(`/api/v1/billing/invoices/${inv}/reminders`)
      .set(bearer(pa))
      .expect(200);
    expect(log.body).toEqual([
      expect.objectContaining({ channel: 'copy', automatic: false, daysPastDue: 20 }),
      expect.objectContaining({ channel: 'whatsapp', automatic: false, daysPastDue: 20 }),
    ]);
    expect(log.body[1].sentByName).toMatch(/Manager X/i);

    // An article (no billing.manage) cannot; another office's partner cannot see it.
    await remind(await token('senior.y@dhvaj.in'), {}).expect(403);
    await remind(pb, { channel: 'copy' }).expect(404);
  });

  it('the scheduler nudges at 15, 30 and 60 days once per band, and full payment resolves it', async () => {
    const { entityId, eng } = await client();
    const inv = await invoice(eng, '10000.00', 16);
    const about = async () =>
      (await inbox(pa)).filter((n) => n.objectId === inv && n.type === 'invoice_overdue');

    await scan();
    await scan();
    expect(await about()).toHaveLength(1);
    expect((await about())[0]).toMatchObject({ kind: 'actionable', engagementId: eng });
    expect((await about())[0]!.title).toContain('15+ days overdue');

    // Into the next band: one more nudge.
    await superuser(async (c) => {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`UPDATE hsdg.invoices SET due_date = $2 WHERE id = $1`, [
        inv,
        istDateFromToday(-31),
      ]);
    });
    await scan();
    await scan();
    expect(await about()).toHaveLength(2);

    // Paid in full: the nudges resolve.
    await http()
      .post('/api/v1/billing/receipts')
      .set(bearer(pa))
      .send({
        receivedOn: today,
        mode: 'bank',
        reference: `UTR${unique()}`,
        clientEntityId: entityId,
        netAmount: '10000.00',
      })
      .expect(201);
    const after = await about();
    expect(after).toHaveLength(2);
    expect(after.every((n) => n.resolvedAt !== null)).toBe(true);
    // A paid invoice is not chased again.
    await scan();
    expect(await about()).toHaveLength(2);
  });

  it('automatic client e-mails stay off unless the firm turns them on and has a mail channel', async () => {
    const { eng } = await client();
    const inv = await invoice(eng, '10000.00', 40);
    await superuser((c) => c.query(`UPDATE hsdg.firm_settings SET auto_invoice_reminders = true`));
    await scan();
    // The test app has no external channel, so nothing is sent or logged.
    const log = await http()
      .get(`/api/v1/billing/invoices/${inv}/reminders`)
      .set(bearer(pa))
      .expect(200);
    expect(log.body).toEqual([]);

    // The settings round-trip, sorted and once each.
    const s = await http().get('/api/v1/billing/settings').set(bearer(pa)).expect(200);
    const put = await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(pa))
      .send({ version: s.body.version, invoiceReminderDays: [30, 7, 7, 15] })
      .expect(200);
    expect(put.body).toMatchObject({
      invoiceReminderDays: [7, 15, 30],
      autoInvoiceReminders: true,
    });
    await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(pa))
      .send({ version: put.body.version, invoiceReminderDays: [0] })
      .expect(400);
  });
});

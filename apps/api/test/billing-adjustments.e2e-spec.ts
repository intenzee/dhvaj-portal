import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { NotificationItem, TodayView } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { dateFromToday } from './date.helper';

/**
 * PS-205 · Credit notes and write-offs, with a partner's approval.
 *
 * Done when: a manager requests a ₹5,000 write-off, the partner approves it
 * from Today, and the invoice shows it. Also: the requester cannot decide
 * their own request, only approval moves the balance, a rejection leaves it,
 * and a credit note carries the invoice's GST and a CN number.
 */
describe('PS-205 credit notes and write-offs (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let mx: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const today = dateFromToday(0);

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

  /** An issued invoice with one line of `amount` (tax as the firm settings say). */
  const invoice = async (eng: string, amount: string): Promise<string> => {
    const d = await http()
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(bearer(pa))
      .send({
        dueDate: dateFromToday(15),
        lines: [{ description: 'Professional fees', unitAmount: amount }],
      })
      .expect(201);
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${d.body.id as string}/status`)
      .set(bearer(pa))
      .send({ status: 'issued', issueDate: today })
      .expect(201);
    return d.body.id as string;
  };

  const getInvoice = async (eng: string, id: string): Promise<Record<string, unknown>> =>
    (await http().get(`/api/v1/engagements/${eng}/invoices/${id}`).set(bearer(pa)).expect(200))
      .body as Record<string, unknown>;

  const writeOff = (t: string, inv: string, amount: string) =>
    http()
      .post(`/api/v1/billing/invoices/${inv}/write-offs`)
      .set(bearer(t))
      .send({ amount, reason: 'Client disputes the extra visit' });

  const decide = (
    t: string,
    kind: 'write-offs' | 'credit-notes',
    id: string,
    decision: 'approve' | 'reject',
  ) =>
    http()
      .post(`/api/v1/billing/${kind}/${id}/decision`)
      .set(bearer(t))
      .send({ decision, note: decision === 'reject' ? 'Bill it in full' : null });

  const todayView = async (t: string): Promise<TodayView> =>
    (await http().get('/api/v1/work/today').set(bearer(t)).expect(200)).body as TodayView;
  const inbox = async (t: string): Promise<NotificationItem[]> =>
    (await http().get('/api/v1/notifications?limit=100').set(bearer(t)).expect(200)).body
      .items as NotificationItem[];

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
  });

  afterAll(async () => {
    // Other suites share the database and expect no firm GST state.
    await superuser((c) =>
      c.query(`UPDATE hsdg.firm_settings SET gstin = NULL, state_code = NULL`),
    );
    await app?.close();
  });

  it('a manager asks to write off ₹5,000; the partner approves it from Today and the invoice shows it', async () => {
    const { entityId, eng } = await client();
    const inv = await invoice(eng, '100000.00');

    const req = await writeOff(mx, inv, '5000').expect(201);
    expect(req.body).toMatchObject({
      kind: 'write_off',
      status: 'pending',
      total: '5000.00',
      invoiceId: inv,
    });
    const id = req.body.id as string;
    // Asking moves nothing.
    expect(await getInvoice(eng, inv)).toMatchObject({ status: 'issued', balance: '100000.00' });

    // Partner A has it on Today and in the bell; the manager has not.
    const row = (await todayView(pa)).groups
      .find((g) => g.group === 'write_offs')
      ?.items.find((i) => i.key === `write_off:${id}`);
    expect(row).toMatchObject({
      kind: 'write_off',
      engagementId: eng,
      adjustment: { id, amount: '5000.00', invoiceId: inv },
    });
    expect((await todayView(mx)).groups.map((g) => g.group)).not.toContain('write_offs');
    const pending = (await inbox(pa)).filter(
      (n) => n.objectId === id && n.type === 'write_off_pending',
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: 'actionable', status: 'unread', engagementId: eng });

    // Approve it from the Today row.
    const ok = await decide(pa, 'write-offs', row!.adjustment!.id, 'approve').expect(201);
    expect(ok.body).toMatchObject({ status: 'approved', decidedByName: expect.any(String) });
    expect(await getInvoice(eng, inv)).toMatchObject({
      status: 'partially_paid',
      amountSettled: '5000.00',
      balance: '95000.00',
    });
    const done = (await inbox(pa)).find((n) => n.objectId === id)!;
    expect(done.status).toBe('read');
    expect(done.resolvedAt).not.toBeNull();
    expect(
      (await todayView(pa)).groups
        .find((g) => g.group === 'write_offs')
        ?.items.some((i) => i.key === `write_off:${id}`),
    ).toBe(false);

    const listed = await http()
      .get(`/api/v1/billing/adjustments?invoiceId=${inv}`)
      .set(bearer(pa))
      .expect(200);
    expect(listed.body).toEqual([expect.objectContaining({ id, status: 'approved' })]);

    const st = await http()
      .get(`/api/v1/billing/clients/${entityId}/statement`)
      .set(bearer(pa))
      .expect(200);
    expect(st.body.totals).toMatchObject({ credited: '5000.00', balance: '95000.00' });
    expect(st.body.credits).toEqual([
      expect.objectContaining({ id, kind: 'write_off', amount: '5000.00', invoiceId: inv }),
    ]);
    expect((st.body.lines as Array<{ kind: string }>).map((l) => l.kind)).toEqual([
      'invoice',
      'write_off',
    ]);
  });

  it('refuses the requester deciding their own request, in the API and the database', async () => {
    const { eng } = await client();
    const inv = await invoice(eng, '20000.00');
    const id = (await writeOff(pa, inv, '1000').expect(201)).body.id as string;
    await decide(pa, 'write-offs', id, 'approve').expect(403);
    await decide(pa, 'write-offs', id, 'reject').expect(403);
    // Even past the API, the guard holds.
    await expect(
      superuser((c) =>
        c.query(
          `UPDATE hsdg.write_offs SET status = 'approved',
                  decided_by_employee_id = requested_by_employee_id WHERE id = $1`,
          [id],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await getInvoice(eng, inv)).toMatchObject({ balance: '20000.00' });
    // A manager cannot decide at all (no billing.approve).
    await decide(mx, 'write-offs', id, 'approve').expect(403);
    // Someone else can.
    await decide(mp, 'write-offs', id, 'approve').expect(201);
    expect(await getInvoice(eng, inv)).toMatchObject({ balance: '19000.00' });
  });

  it('a rejection leaves the balance; a decided request cannot be decided again', async () => {
    const { eng } = await client();
    const inv = await invoice(eng, '30000.00');
    const id = (await writeOff(mx, inv, '30000').expect(201)).body.id as string;
    const no = await decide(pa, 'write-offs', id, 'reject').expect(201);
    expect(no.body).toMatchObject({ status: 'rejected', decisionNote: 'Bill it in full' });
    expect(await getInvoice(eng, inv)).toMatchObject({ status: 'issued', balance: '30000.00' });
    await decide(pa, 'write-offs', id, 'approve').expect(400);
    // More than is owed is refused at the request.
    await writeOff(mx, inv, '30000.01').expect(400);
  });

  it('a full write-off settles the invoice; a void or paid one cannot be reduced', async () => {
    const { eng } = await client();
    const inv = await invoice(eng, '8000.00');
    const id = (await writeOff(mx, inv, '8000').expect(201)).body.id as string;
    await decide(pa, 'write-offs', id, 'approve').expect(201);
    expect(await getInvoice(eng, inv)).toMatchObject({ status: 'paid', balance: '0.00' });
    await writeOff(mx, inv, '1').expect(400);
  });

  it('a credit note carries the invoice GST and takes a CN number on approval', async () => {
    const settings = await http().get('/api/v1/billing/settings').set(bearer(mp)).expect(200);
    await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(mp))
      .send({ version: settings.body.version, gstin: '07AAAFD1234K1Z5' })
      .expect(200);
    const { entityId, eng } = await client();
    const inv = await invoice(eng, '100000.00');
    expect(await getInvoice(eng, inv)).toMatchObject({ total: '118000.00' });

    const req = await http()
      .post(`/api/v1/billing/invoices/${inv}/credit-notes`)
      .set(bearer(mx))
      .send({ taxableValue: '5000', reason: 'One return dropped from scope' })
      .expect(201);
    expect(req.body).toMatchObject({
      kind: 'credit_note',
      status: 'pending',
      number: null,
      taxableValue: '5000.00',
      gstRate: '18.00',
      cgst: '450.00',
      sgst: '450.00',
      igst: '0.00',
      total: '5900.00',
    });
    expect(await getInvoice(eng, inv)).toMatchObject({ balance: '118000.00' });

    const ok = await decide(pa, 'credit-notes', req.body.id as string, 'approve').expect(201);
    expect(ok.body.number).toMatch(/^CN\/\d{2}-\d{2}\/\d{4,}$/);
    expect(ok.body.creditDate).toBe(today);
    expect(await getInvoice(eng, inv)).toMatchObject({
      status: 'partially_paid',
      balance: '112100.00',
    });
    const st = await http()
      .get(`/api/v1/billing/clients/${entityId}/statement`)
      .set(bearer(pa))
      .expect(200);
    expect(st.body.credits).toEqual([
      expect.objectContaining({ kind: 'credit_note', number: ok.body.number, amount: '5900.00' }),
    ]);
  });
});

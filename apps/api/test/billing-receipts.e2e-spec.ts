import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { tdsQuarterOf } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { dateFromToday } from './date.helper';

/**
 * PS-202 · Receipts, part payments and TDS on our fees.
 *
 * Done when: recording ₹90,000 net plus ₹10,000 TDS against a ₹1,00,000
 * invoice marks it paid and shows ₹10,000 TDS receivable from that client for
 * that quarter. Also: part then full payment, one receipt across two invoices,
 * reversal reopens, over-allocation refused, and office scope.
 */
describe('PS-202 receipts (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const today = dateFromToday(0);

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

  /** An issued invoice of `amount` (no tax), due `dueInDays` from today. */
  const invoice = async (eng: string, amount: string, dueInDays = 15): Promise<string> => {
    const d = await http()
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(bearer(pa))
      .send({
        dueDate: dateFromToday(dueInDays),
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

  const receipt = (t: string, body: Record<string, unknown>) =>
    http()
      .post('/api/v1/billing/receipts')
      .set(bearer(t))
      .send({ receivedOn: today, mode: 'bank', reference: `UTR${unique()}`, ...body });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('settles ₹1,00,000 with ₹90,000 net + ₹10,000 TDS and shows the TDS receivable', async () => {
    const { entityId, eng } = await client();
    const inv = await invoice(eng, '100000.00');
    const r = await receipt(pa, {
      clientEntityId: entityId,
      netAmount: '90000.00',
      tdsAmount: '10000.00',
      tdsSection: '194J',
    }).expect(201);
    expect(r.body).toMatchObject({
      grossAmount: '100000.00',
      netAmount: '90000.00',
      tdsAmount: '10000.00',
      status: 'posted',
      unallocated: '0.00',
      allocations: [{ invoiceId: inv, amount: '100000.00' }],
    });
    expect(await getInvoice(eng, inv)).toMatchObject({ status: 'paid', balance: '0.00' });

    const st = await http()
      .get(`/api/v1/billing/clients/${entityId}/statement`)
      .set(bearer(pa))
      .expect(200);
    expect(st.body.totals).toMatchObject({
      invoiced: '100000.00',
      received: '90000.00',
      tds: '10000.00',
      balance: '0.00',
      advance: '0.00',
    });
    expect(st.body.tdsReceivable).toEqual([{ ...tdsQuarterOf(today), amount: '10000.00' }]);
    expect((st.body.lines as Array<{ kind: string }>).map((l) => l.kind)).toEqual([
      'invoice',
      'receipt',
      'tds',
    ]);
  });

  it('takes a part payment, then the rest', async () => {
    const { entityId, eng } = await client();
    const inv = await invoice(eng, '100000.00');
    await receipt(pa, { clientEntityId: entityId, netAmount: '40000.00' }).expect(201);
    expect(await getInvoice(eng, inv)).toMatchObject({
      status: 'partially_paid',
      amountSettled: '40000.00',
      balance: '60000.00',
    });
    // TDS needs its section.
    await receipt(pa, {
      clientEntityId: entityId,
      netAmount: '54000.00',
      tdsAmount: '6000.00',
    }).expect(400);
    await receipt(pa, {
      clientEntityId: entityId,
      netAmount: '54000.00',
      tdsAmount: '6000.00',
      tdsSection: '194J',
    }).expect(201);
    expect(await getInvoice(eng, inv)).toMatchObject({ status: 'paid', balance: '0.00' });
  });

  it('spreads one receipt over two invoices oldest first, reverses it, and reopens both', async () => {
    const { entityId, eng } = await client();
    const later = await invoice(eng, '50000.00', 30);
    const older = await invoice(eng, '30000.00', 5);
    const r = await receipt(pa, { clientEntityId: entityId, netAmount: '100000.00' }).expect(201);
    expect(r.body.unallocated).toBe('20000.00');
    expect(
      (r.body.allocations as Array<{ invoiceId: string; amount: string }>)
        .map((a) => [a.invoiceId, a.amount])
        .sort(),
    ).toEqual(
      [
        [later, '50000.00'],
        [older, '30000.00'],
      ].sort(),
    );
    expect((await getInvoice(eng, later)).status).toBe('paid');
    expect((await getInvoice(eng, older)).status).toBe('paid');
    const st = await http()
      .get(`/api/v1/billing/clients/${entityId}/statement`)
      .set(bearer(pa))
      .expect(200);
    expect(st.body.totals).toMatchObject({ balance: '-20000.00', advance: '20000.00' });

    // An invoice with money against it is not voided.
    await http()
      .post(`/api/v1/engagements/${eng}/invoices/${older}/status`)
      .set(bearer(pa))
      .send({ status: 'void', reason: 'Wrong client' })
      .expect(400);

    const path = `/api/v1/billing/receipts/${r.body.id as string}/reverse`;
    const mx = await token('manager.x@dhvaj.in');
    await http().post(path).set(bearer(mx)).send({ reason: 'Bounced' }).expect(403);
    await http().post(path).set(bearer(pa)).send({}).expect(400);
    const rev = await http()
      .post(path)
      .set(bearer(pa))
      .send({ reason: 'Cheque returned unpaid' })
      .expect(201);
    expect(rev.body).toMatchObject({
      status: 'reversed',
      reversedReason: 'Cheque returned unpaid',
    });
    expect(await getInvoice(eng, later)).toMatchObject({ status: 'issued', balance: '50000.00' });
    expect(await getInvoice(eng, older)).toMatchObject({ status: 'issued', balance: '30000.00' });
    await http().post(path).set(bearer(pa)).send({ reason: 'Again' }).expect(400);
  });

  it('refuses over-allocation', async () => {
    const { entityId, eng } = await client();
    const inv = await invoice(eng, '100000.00');
    // More than the invoice's balance.
    await receipt(pa, {
      clientEntityId: entityId,
      netAmount: '150000.00',
      allocations: [{ invoiceId: inv, amount: '120000.00' }],
    }).expect(400);
    // More than the receipt.
    await receipt(pa, {
      clientEntityId: entityId,
      netAmount: '10000.00',
      allocations: [{ invoiceId: inv, amount: '20000.00' }],
    }).expect(400);
    // Two receipts that together over-pay it.
    await receipt(pa, {
      clientEntityId: entityId,
      netAmount: '70000.00',
      allocations: [{ invoiceId: inv, amount: '70000.00' }],
    }).expect(201);
    await receipt(pa, {
      clientEntityId: entityId,
      netAmount: '40000.00',
      allocations: [{ invoiceId: inv, amount: '40000.00' }],
    }).expect(400);
    // Another client's invoice.
    const other = await client();
    await receipt(pa, {
      clientEntityId: other.entityId,
      netAmount: '1000.00',
      allocations: [{ invoiceId: inv, amount: '1000.00' }],
    }).expect(400);
    // Nothing half-written: the refused receipts left no trace.
    expect(await getInvoice(eng, inv)).toMatchObject({
      status: 'partially_paid',
      amountSettled: '70000.00',
    });
  });

  it('keeps receipts to the client’s billers', async () => {
    const { entityId, eng } = await client();
    await invoice(eng, '5000.00');
    const r = await receipt(pa, { clientEntityId: entityId, netAmount: '5000.00' }).expect(201);
    const sees = async (t: string): Promise<boolean> => {
      const res = await http()
        .get(`/api/v1/billing/receipts?clientId=${entityId}&limit=100`)
        .set(bearer(t))
        .expect(200);
      return (res.body.items as Array<{ id: string }>).some((x) => x.id === r.body.id);
    };
    expect(await sees(pa)).toBe(true);
    expect(await sees(mp)).toBe(true);
    expect(await sees(await token('manager.x@dhvaj.in'))).toBe(true);
    const pb = await token('partner.b@dhvaj.in');
    expect(await sees(pb)).toBe(false);
    const create = await receipt(pb, { clientEntityId: entityId, netAmount: '1.00' });
    expect([403, 404]).toContain(create.status);
    await http()
      .get('/api/v1/billing/receipts')
      .set(bearer(await token('senior.y@dhvaj.in')))
      .expect(403);
  });
});

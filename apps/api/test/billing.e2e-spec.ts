import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { dateFromToday } from './date.helper';

/**
 * Firm-wide Billing & Collections (spec §31) — the cross-engagement invoice
 * list + rollup at `/invoices`, `/invoices/summary`.
 *
 * Acceptance: gated by `report.read`; RLS-scoped exactly like the per-engagement
 * invoice list (a partner in another office never sees the invoice); the list
 * carries engagement/client context and an `overdue` flag; the summary buckets
 * reconcile with what the caller can see.
 */
describe('Billing & Collections (e2e)', () => {
  let app: INestApplication;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };

  const createEngagement = async (epToken: string): Promise<string> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=GST_MONTHLY&limit=100');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `B${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  /** Create an invoice with one line; optionally issue it (optionally overdue). */
  const makeInvoice = async (
    t: string,
    eng: string,
    opts: { issue?: boolean; overdue?: boolean } = {},
  ): Promise<{ id: string; number: string }> => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(bearer(t))
      .send({
        currency: 'INR',
        dueDate: opts.overdue ? dateFromToday(-10) : dateFromToday(20),
        lines: [{ description: 'Retainer', quantity: '1', unitAmount: '5000.00' }],
      })
      .expect(201);
    const id = created.body.id as string;
    if (opts.issue) {
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/invoices/${id}/status`)
        .set(bearer(t))
        .send({ status: 'issued', issueDate: opts.overdue ? dateFromToday(-30) : dateFromToday(0) })
        .expect(201);
    }
    return { id, number: created.body.invoiceNumber as string };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('permission gating', () => {
    it('lets a manager (report.read) read the firm-wide invoice list and summary', async () => {
      const t = await token('manager.x@dhvaj.in');
      await request(app.getHttpServer()).get('/api/v1/invoices').set(bearer(t)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/invoices/summary').set(bearer(t)).expect(200);
    });

    it('forbids a senior (no report.read) from billing (403)', async () => {
      const t = await token('senior.y@dhvaj.in');
      await request(app.getHttpServer()).get('/api/v1/invoices').set(bearer(t)).expect(403);
      await request(app.getHttpServer()).get('/api/v1/invoices/summary').set(bearer(t)).expect(403);
    });
  });

  describe('cross-engagement list', () => {
    it('lists an issued invoice with engagement + client context', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const inv = await makeInvoice(pa, eng, { issue: true });

      const res = await request(app.getHttpServer())
        .get('/api/v1/invoices?limit=100')
        .set(bearer(pa))
        .expect(200);
      const found = (res.body.items as Array<Record<string, unknown>>).find((i) => i.id === inv.id);
      expect(found).toBeDefined();
      expect(found!.invoiceNumber).toBe(inv.number);
      expect(found!.status).toBe('issued');
      expect(typeof found!.engagementCode).toBe('string');
      expect(found!.entityName).toBeTruthy();
      expect(found!.overdue).toBe(false);
    });

    it('flags an overdue invoice and filters to it with ?overdueOnly=true', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const inv = await makeInvoice(pa, eng, { issue: true, overdue: true });

      const res = await request(app.getHttpServer())
        .get('/api/v1/invoices?overdueOnly=true&limit=100')
        .set(bearer(pa))
        .expect(200);
      const items = res.body.items as Array<Record<string, unknown>>;
      const found = items.find((i) => i.id === inv.id);
      expect(found).toBeDefined();
      expect(found!.overdue).toBe(true);
      // Every row under the overdue filter is genuinely overdue.
      expect(items.every((i) => i.overdue === true)).toBe(true);
    });

    it('is RLS-scoped — a partner in another office never sees the invoice', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const pb = await token('partner.b@dhvaj.in');
      const eng = await createEngagement(pa);
      const inv = await makeInvoice(pa, eng, { issue: true });

      const res = await request(app.getHttpServer())
        .get('/api/v1/invoices?limit=100')
        .set(bearer(pb))
        .expect(200);
      expect((res.body.items as Array<{ id: string }>).some((i) => i.id === inv.id)).toBe(false);
    });
  });

  describe('summary rollup', () => {
    it('counts a fresh issued invoice as outstanding and reconciles buckets', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      await makeInvoice(pa, eng, { issue: true });

      const res = await request(app.getHttpServer())
        .get('/api/v1/invoices/summary')
        .set(bearer(pa))
        .expect(200);
      expect(res.body.issued.count).toBeGreaterThanOrEqual(1);
      // Outstanding is the issued bucket; overdue is a subset of it.
      expect(res.body.outstanding.count).toBe(res.body.issued.count);
      expect(res.body.overdue.count).toBeLessThanOrEqual(res.body.outstanding.count);
      expect(typeof res.body.currency).toBe('string');
    });

    it('partitions outstanding into aging buckets that reconcile', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      await makeInvoice(pa, eng, { issue: true }); // not yet due
      await makeInvoice(pa, eng, { issue: true, overdue: true }); // 10 days overdue → 1–30

      const res = await request(app.getHttpServer())
        .get('/api/v1/invoices/summary')
        .set(bearer(pa))
        .expect(200);
      const aging = res.body.aging as Array<{ key: string; count: number }>;
      // All five bands are present, in order.
      expect(aging.map((b) => b.key)).toEqual(['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']);
      // The bands partition the outstanding bucket.
      const sum = aging.reduce((n, b) => n + b.count, 0);
      expect(sum).toBe(res.body.outstanding.count);
      // The 10-day-overdue invoice lands in the 1–30 band.
      expect(aging.find((b) => b.key === 'd1_30')!.count).toBeGreaterThanOrEqual(1);
    });

    it('scopes the summary by RLS — a partner sees no more issued than the MP', async () => {
      const paTotal = await request(app.getHttpServer())
        .get('/api/v1/invoices/summary')
        .set(bearer(await token('partner.a@dhvaj.in')))
        .expect(200);
      const mpTotal = await request(app.getHttpServer())
        .get('/api/v1/invoices/summary')
        .set(bearer(mp))
        .expect(200);
      expect(paTotal.body.issued.count).toBeLessThanOrEqual(mpTotal.body.issued.count);
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { dateFromToday } from './date.helper';
import { FeatureFlagsService } from '../src/common/feature-flags/feature-flags.service';

/**
 * PS-201 · GST-correct invoices and a billing permission.
 *
 * Done when: an issued invoice has a gap-free number for its financial year,
 * the right CGST/SGST or IGST split, and a PDF; a manager without
 * billing.approve cannot void it. Also: billing scope by office on
 * /billing/invoices, and Billing → Settings for partners only.
 */
describe('PS-201 GST invoices (e2e)', () => {
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

  /** A fresh NORTH client and an engagement Partner A leads. */
  const engagement = async (): Promise<string> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=GST_MONTHLY&limit=100');
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId: await freshClient(entityId),
        serviceId,
        financialYear: '2026-27',
        periodLabel: `P${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  const draft = async (
    eng: string,
    body: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const res = await http()
      .post(`/api/v1/engagements/${eng}/invoices`)
      .set(bearer(pa))
      .send({
        clientGstin: '07AAACB1234C1Z5',
        lines: [
          { description: 'Statutory audit', quantity: '1', unitAmount: '100000.00' },
          { description: 'GST returns', quantity: '3', unitAmount: '2500.50' },
        ],
        ...body,
      })
      .expect(201);
    return res.body as Record<string, unknown>;
  };

  const issue = (t: string, eng: string, id: string, issueDate = dateFromToday(0)) =>
    http()
      .post(`/api/v1/engagements/${eng}/invoices/${id}/status`)
      .set(bearer(t))
      .send({ status: 'issued', issueDate });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    // Listening once: supertest otherwise opens a server per request, and the
    // 50 concurrent issues below then reset connections on CI (read ECONNRESET).
    await app.listen(0, '127.0.0.1');
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    const settings = await http().get('/api/v1/billing/settings').set(bearer(mp)).expect(200);
    await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(mp))
      .send({ version: settings.body.version, gstin: '07AAAFD1234K1Z5', invoicePrefix: 'INV' })
      .expect(200);
  });

  afterAll(async () => {
    // Other suites share the database and expect no firm GST state.
    await superuser((c) =>
      c.query(`UPDATE hsdg.firm_settings SET gstin = NULL, state_code = NULL`),
    );
    await app?.close();
  });

  describe('Billing → Settings', () => {
    it('takes the state from the GSTIN and lets only billing.approve change it', async () => {
      const s = await http().get('/api/v1/billing/settings').set(bearer(pa)).expect(200);
      expect(s.body).toMatchObject({
        gstin: '07AAAFD1234K1Z5',
        stateCode: '07',
        sacDefault: '998221',
      });
      const mx = await token('manager.x@dhvaj.in');
      await http()
        .patch('/api/v1/billing/settings')
        .set(bearer(mx))
        .send({ version: s.body.version, invoiceTermsDays: 30 })
        .expect(403);
      await http()
        .patch('/api/v1/billing/settings')
        .set(bearer(mp))
        .send({ version: s.body.version, gstin: '07AAAFD1234K1Z5', stateCode: '27' })
        .expect(400);
    });
  });

  describe('the tax split', () => {
    it('charges CGST + SGST intra-state and freezes the number, words and PDF at issue', async () => {
      const eng = await engagement();
      const d = await draft(eng);
      expect(d.invoiceNumber).toBeNull();
      // 100000 + 3 × 2500.50 = 107501.50; 9% = 9675.135 → 9675.14 each half.
      expect(d).toMatchObject({
        placeOfSupplyState: '07',
        subtotal: '107501.50',
        cgst: '9675.14',
        sgst: '9675.14',
        igst: '0.00',
        taxAmount: '19350.28',
        total: '126851.78',
      });
      expect((d.lines as Array<Record<string, unknown>>)[0]).toMatchObject({
        sacCode: '998221',
        gstRate: '18.00',
        taxableValue: '100000.00',
      });

      const issued = await issue(pa, eng, d.id as string).expect(201);
      expect(issued.body.status).toBe('issued');
      expect(issued.body.invoiceNumber).toMatch(/^INV\/\d{2}-\d{2}\/\d{4,}$/);
      expect(issued.body.amountInWords).toBe(
        'Rupees One Lakh Twenty-Six Thousand Eight Hundred Fifty-One and Seventy-Eight Paise Only',
      );
      expect(issued.body.dueDate).toBe(dateFromToday(15));
      expect(issued.body.hasPdf).toBe(true);

      const pdf = await http()
        .get(`/api/v1/engagements/${eng}/invoices/${d.id as string}/pdf`)
        .set(bearer(pa))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      const text = (pdf.body as Buffer).toString('latin1');
      expect(text.startsWith('%PDF-')).toBe(true);
      expect(text).toContain(issued.body.invoiceNumber as string);
      expect(text).toContain('(CGST @ 9%)');

      // An issued invoice is frozen.
      await http()
        .patch(`/api/v1/engagements/${eng}/invoices/${d.id as string}`)
        .set(bearer(pa))
        .send({ notes: 'late edit' })
        .expect(400);
    });

    it('charges IGST inter-state and ignores a hand-entered tax', async () => {
      const eng = await engagement();
      const d = await draft(eng, { clientGstin: '27AAACB1234C1Z5' });
      expect(d).toMatchObject({ placeOfSupplyState: '27', cgst: '0.00', igst: '19350.27' });
      // The shipped mobile app always sends taxAmount: the worked split wins.
      const created = await http()
        .post(`/api/v1/engagements/${eng}/invoices`)
        .set(bearer(pa))
        .send({ taxAmount: '100.00', lines: [{ description: 'X', unitAmount: '1000' }] })
        .expect(201);
      expect(created.body.taxAmount).toBe('180.00');
      const edited = await http()
        .patch(`/api/v1/engagements/${eng}/invoices/${created.body.id as string}`)
        .set(bearer(pa))
        .send({ taxAmount: '5.00', notes: 'edited', version: created.body.version })
        .expect(200);
      expect(edited.body).toMatchObject({ taxAmount: '180.00', notes: 'edited' });
    });
  });

  describe('numbering', () => {
    it('gives 50 concurrent issues 50 unique, consecutive numbers', async () => {
      const eng = await engagement();
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const res = await http()
          .post(`/api/v1/engagements/${eng}/invoices`)
          .set(bearer(pa))
          .send({ lines: [{ description: `Fee ${i}`, unitAmount: '1000.00' }] })
          .expect(201);
        ids.push(res.body.id as string);
      }
      const results = await Promise.all(ids.map((id) => issue(pa, eng, id)));
      results.forEach((r) => expect(r.status).toBe(201));
      const numbers = results.map((r) => r.body.invoiceNumber as string);
      expect(new Set(numbers).size).toBe(50);
      const seqs = numbers.map((n) => Number(n.split('/')[2])).sort((a, b) => a - b);
      expect(seqs[49]! - seqs[0]!).toBe(49);
      expect(new Set(numbers.map((n) => n.split('/')[1])).size).toBe(1);
    });
  });

  describe('voiding', () => {
    it('needs billing.approve and a reason, and keeps the number', async () => {
      const eng = await engagement();
      const d = await draft(eng);
      const issued = await issue(pa, eng, d.id as string).expect(201);
      const path = `/api/v1/engagements/${eng}/invoices/${d.id as string}/status`;

      // Manager X bills the NORTH client (home office) but may not void.
      const mx = await token('manager.x@dhvaj.in');
      await http()
        .post(path)
        .set(bearer(mx))
        .send({ status: 'void', reason: 'Wrong client' })
        .expect(403);
      await http().post(path).set(bearer(pa)).send({ status: 'void' }).expect(400);
      const voided = await http()
        .post(path)
        .set(bearer(pa))
        .send({ status: 'void', reason: 'Raised on the wrong engagement' })
        .expect(201);
      expect(voided.body).toMatchObject({
        status: 'void',
        invoiceNumber: issued.body.invoiceNumber,
        voidedReason: 'Raised on the wrong engagement',
        voidedByName: 'Partner A',
      });
    });

    it('lets the shipped mobile app void without a reason while ff_billing_v2 is off', async () => {
      const eng = await engagement();
      const d = await draft(eng);
      await issue(pa, eng, d.id as string).expect(201);
      const path = `/api/v1/engagements/${eng}/invoices/${d.id as string}/status`;
      const flags = app.get(FeatureFlagsService);
      flags.setRules(new Map([['ff_billing_v2', { mode: 'off', officeCodes: new Set<string>() }]]));
      try {
        const mx = await token('manager.x@dhvaj.in');
        await http().post(path).set(bearer(mx)).send({ status: 'void' }).expect(403);
        const voided = await http().post(path).set(bearer(pa)).send({ status: 'void' }).expect(201);
        expect(voided.body).toMatchObject({ status: 'void', voidedReason: '(no reason given)' });
      } finally {
        flags.setRules(new Map());
      }
    });
  });

  describe('/billing/invoices', () => {
    it('shows home-office billers the client’s invoices and nobody else', async () => {
      const eng = await engagement();
      const d = await draft(eng);
      await issue(pa, eng, d.id as string).expect(201);
      const has = async (t: string): Promise<boolean> => {
        const res = await http()
          .get(`/api/v1/billing/invoices?limit=100&search=${encodeURIComponent('E2E')}`)
          .set(bearer(t))
          .expect(200);
        return (res.body.items as Array<{ id: string }>).some((i) => i.id === d.id);
      };
      expect(await has(pa)).toBe(true);
      expect(await has(await token('manager.x@dhvaj.in'))).toBe(true);
      expect(await has(await token('partner.b@dhvaj.in'))).toBe(false);
      await http()
        .get('/api/v1/billing/invoices')
        .set(bearer(await token('senior.y@dhvaj.in')))
        .expect(403);
    });
  });
});

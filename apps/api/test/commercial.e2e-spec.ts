import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Commercial Scope & Billing (spec §31), Notes (§26) and the out-of-scope Task
 * path (§31), through the HTTP API.
 *
 * Headline acceptance: an engagement carries a commercial configuration; a draft
 * invoice's totals are derived from its lines by the DB (subtotal + tax = total);
 * the draft → issued → paid lifecycle is enforced (issuing needs ≥1 line, a
 * paid/void invoice is locked); notes are member-add / author-or-lead-remove; an
 * out-of-scope task can be created and lead-approved; and RLS negatives hold.
 */
describe('Commercial, Notes & Out-of-scope (e2e)', () => {
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

  const findEntityId = async (search: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/entities?search=${search}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findServiceId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/services?search=${code}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const createEngagement = async (epToken: string): Promise<string> => {
    const entityId = await findEntityId('Bharat');
    const serviceId = await findServiceId('GST_MONTHLY');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `C${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });
  afterAll(async () => {
    await app.close();
  });

  describe('Commercial configuration (§31)', () => {
    it('returns a default then persists an upsert', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const engId = await createEngagement(pa);

      const def = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${engId}/commercial`)
        .set(bearer(pa))
        .expect(200);
      expect(def.body.billingFrequency).toBe('monthly');
      expect(def.body.version).toBe(0);

      const saved = await request(app.getHttpServer())
        .patch(`/api/v1/engagements/${engId}/commercial`)
        .set(bearer(pa))
        .send({ billingFrequency: 'quarterly', effectiveDate: '2026-04-01' })
        .expect(200);
      expect(saved.body.billingFrequency).toBe('quarterly');
      expect(saved.body.effectiveDate).toBe('2026-04-01');
      expect(saved.body.version).toBe(1);
    });
  });

  describe('Invoices (§31)', () => {
    it('derives totals from lines and enforces the lifecycle', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const engId = await createEngagement(pa);

      // Create a draft with two lines + tax; the DB computes the totals.
      const created = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/invoices`)
        .set(bearer(pa))
        .send({
          currency: 'INR',
          taxAmount: '180.00',
          lines: [
            { description: 'GST monthly retainer', quantity: '1', unitAmount: '10000.00' },
            { description: 'Reconciliation', quantity: '2', unitAmount: '500.00' },
          ],
        })
        .expect(201);
      expect(created.body.status).toBe('draft');
      expect(created.body.invoiceNumber).toMatch(/^INV-\d{4}-\d{5}$/);
      expect(Number(created.body.subtotal)).toBe(11000);
      expect(Number(created.body.total)).toBe(11180);
      const invId = created.body.id as string;

      // Adding a line re-derives the subtotal/total.
      const withLine = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/invoices/${invId}/lines`)
        .set(bearer(pa))
        .send({ description: 'Advisory', quantity: '1', unitAmount: '2000.00' })
        .expect(201);
      expect(Number(withLine.body.subtotal)).toBe(13000);
      expect(Number(withLine.body.total)).toBe(13180);

      // Issue → issue_date stamped, status locked.
      const issued = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/invoices/${invId}/status`)
        .set(bearer(pa))
        .send({ status: 'issued' })
        .expect(201);
      expect(issued.body.status).toBe('issued');
      expect(issued.body.issueDate).toBeTruthy();

      // A line cannot be added to an issued invoice.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/invoices/${invId}/lines`)
        .set(bearer(pa))
        .send({ description: 'Nope', unitAmount: '1' })
        .expect(400);

      // issued → paid is allowed; paid → draft is not.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/invoices/${invId}/status`)
        .set(bearer(pa))
        .send({ status: 'paid' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/invoices/${invId}/status`)
        .set(bearer(pa))
        .send({ status: 'draft' })
        .expect(400);
    });

    it('refuses to issue an invoice with no lines', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const engId = await createEngagement(pa);
      const created = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/invoices`)
        .set(bearer(pa))
        .send({})
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/invoices/${created.body.id}/status`)
        .set(bearer(pa))
        .send({ status: 'issued' })
        .expect(400);
    });

    it('does not let an unassigned partner see another’s invoices (404)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const engId = await createEngagement(pa);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/invoices`)
        .set(bearer(pa))
        .send({ lines: [{ description: 'X', unitAmount: '1' }] })
        .expect(201);
      const pb = await token('partner.b@dhvaj.in');
      const list = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${engId}/invoices`)
        .set(bearer(pb))
        .expect(404);
      expect(list.body).toBeDefined();
    });
  });

  describe('Notes (§26)', () => {
    it('adds, pins, lists and removes a note', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const engId = await createEngagement(pa);

      const note = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/notes`)
        .set(bearer(pa))
        .send({ body: 'Client prefers email over calls.' })
        .expect(201);
      expect(note.body.body).toContain('email');

      await request(app.getHttpServer())
        .patch(`/api/v1/engagements/${engId}/notes/${note.body.id}`)
        .set(bearer(pa))
        .send({ isPinned: true })
        .expect(200);

      const list = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${engId}/notes`)
        .set(bearer(pa))
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].isPinned).toBe(true);

      await request(app.getHttpServer())
        .delete(`/api/v1/engagements/${engId}/notes/${note.body.id}`)
        .set(bearer(pa))
        .expect(204);
    });
  });

  describe('Registration write-back (§40)', () => {
    it('records a registration-work number into the client Registration Master', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('GST_REGISTRATION');
      const engRes = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `R${unique()}`,
          status: 'accepted',
        })
        .expect(201);
      const engId = engRes.body.id as string;

      // Configure the "New Registration" component as one-time so it yields one
      // work instance to record against.
      const cfg = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/components`)
        .set(bearer(pa))
        .send({ serviceComponentCode: 'GSTR_NEW', frequency: 'one_time', status: 'active' })
        .expect(201);
      const componentId = cfg.body.id as string;

      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/components/${componentId}/instances/generate`)
        .set(bearer(pa))
        .expect(201);
      expect(gen.body.generated.length).toBe(1);
      const instanceId = gen.body.generated[0].id as string;
      expect(gen.body.generated[0].setsRegistrationType).toBe('gstin');

      const gstin = `29TEST${unique()}Z`.slice(0, 15);
      const rec = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/component-work/${instanceId}/record-registration`)
        .set(bearer(pa))
        .send({ registrationNumber: gstin, stateCode: '29', completeInstance: true })
        .expect(201);
      expect(rec.body.status).toBe('completed');

      // The number now lives in the central Registration Master.
      const entity = await request(app.getHttpServer())
        .get(`/api/v1/entities/${entityId}`)
        .set(bearer(mp))
        .expect(200);
      const numbers = entity.body.registrations.map(
        (r: { registrationNumber: string }) => r.registrationNumber,
      );
      expect(numbers).toContain(gstin);
    });
  });

  describe('Out-of-scope task (§31)', () => {
    it('creates an out-of-scope task and a lead approves it billable', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const engId = await createEngagement(pa);

      const task = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/tasks`)
        .set(bearer(pa))
        .send({ title: 'Ad-hoc DPR preparation', isOutOfScope: true })
        .expect(201);
      expect(task.body.isOutOfScope).toBe(true);
      expect(task.body.isBillable).toBe(false);
      expect(task.body.outOfScopeApprovedAt).toBeNull();

      const approved = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/tasks/${task.body.id}/approve-out-of-scope`)
        .set(bearer(pa))
        .send({ isBillable: true })
        .expect(201);
      expect(approved.body.isBillable).toBe(true);
      expect(approved.body.outOfScopeApprovedAt).toBeTruthy();
    });
  });
});

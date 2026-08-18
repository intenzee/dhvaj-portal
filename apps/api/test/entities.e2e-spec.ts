import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Entity master through the HTTP API: RLS-scoped reads, filters/search,
 * duplicate detection, permission-gated + audited writes with nested
 * registrations/contacts, and optimistic concurrency.
 */
describe('Entity Master (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePan = (): string => {
    // Valid PAN shape: 5 letters, 4 digits, 1 letter. Randomised to stay unique.
    const n = Math.floor(1000 + Math.random() * 9000);
    return `AAAPZ${n}Z`;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('reads (RLS-scoped, paginated, filterable)', () => {
    it('gives the Managing Partner all clients', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/entities')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(4);
    });

    it('scopes a Partner to their office', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/entities?limit=100')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
      const names = (res.body.items as Array<{ legalName: string }>).map((e) => e.legalName);
      expect(names).toContain('Acme Manufacturing Pvt Ltd'); // North
      expect(names).not.toContain('Coastal Foods Pvt Ltd'); // South
    });

    // Regression: unknown query params used to 400 under forbidNonWhitelisted.
    it('supports the search filter (200, not 400)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/entities?search=Acme')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.items[0].legalName).toMatch(/Acme/);
    });

    it('rejects a genuinely unknown query param (400)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/entities?bogus=1')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(400);
    });

    it('returns entity detail with registrations and contacts', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/entities?search=Acme')
        .set(bearer(await token('mp@hsdg.in')));
      const id = list.body.items[0].id as string;
      const res = await request(app.getHttpServer())
        .get(`/api/v1/entities/${id}`)
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect(res.body.pan).toBe('AAACA1234A');
      expect(res.body.registrations.length).toBeGreaterThanOrEqual(1);
      expect(res.body.primaryContactName).toBe('Ramesh Gupta');
    });

    it('404s for a cross-office entity by id (scope not leaked)', async () => {
      const all = await request(app.getHttpServer())
        .get('/api/v1/entities?limit=100')
        .set(bearer(await token('mp@hsdg.in')));
      const south = (all.body.items as Array<{ legalName: string; id: string }>).find(
        (e) => e.legalName === 'Coastal Foods Pvt Ltd',
      )!;
      await request(app.getHttpServer())
        .get(`/api/v1/entities/${south.id}`)
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(404);
    });
  });

  describe('duplicate detection', () => {
    it('finds an exact PAN match and a fuzzy name match', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/entities/duplicate-check?legalName=Acme%20Manufactring&pan=AAACA1234A')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const reasons = (res.body as Array<{ matchReason: string }>).map((r) => r.matchReason);
      expect(reasons).toContain('pan');
      expect(reasons).toContain('name');
    });
  });

  describe('writes (permission-gated + audited)', () => {
    it('forbids a Manager (no entity.manage) from creating (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/entities')
        .set(bearer(await token('manager.x@hsdg.in')))
        .send({ legalName: 'X Ltd', typeSlug: 'private_limited', officeCode: 'NORTH' })
        .expect(403);
    });

    it('lets a Partner create a client with nested registration + contact, and audits it', async () => {
      const pan = uniquePan();
      const correlationId = `corr-ent-${Date.now()}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/entities')
        .set(bearer(await token('partner.a@hsdg.in')))
        .set('x-correlation-id', correlationId)
        .send({
          legalName: 'Nova Systems Pvt Ltd',
          typeSlug: 'private_limited',
          officeCode: 'NORTH',
          pan,
          registrations: [
            { registrationType: 'gstin', registrationNumber: `27${pan}1Z2`, stateCode: '27' },
          ],
          contacts: [{ fullName: 'Asha Rao', designation: 'Director', isPrimary: true }],
        })
        .expect(201);
      expect(created.body.entityCode).toMatch(/^ENT\d{5}$/);
      expect(created.body.registrations).toHaveLength(1);
      expect(created.body.contacts).toHaveLength(1);

      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const event = (
        audit.body.items as Array<{ action: string; objectId: string; correlationId: string }>
      ).find((e) => e.action === 'entity.created' && e.correlationId === correlationId);
      expect(event?.objectId).toBe(created.body.id);
    });

    it('blocks a duplicate PAN globally (409)', async () => {
      const partner = await token('partner.a@hsdg.in');
      const pan = uniquePan();
      const body = { legalName: 'First Co', typeSlug: 'private_limited', officeCode: 'NORTH', pan };
      await request(app.getHttpServer())
        .post('/api/v1/entities')
        .set(bearer(partner))
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/entities')
        .set(bearer(partner))
        .send({ ...body, legalName: 'Second Co' })
        .expect(409);
    });

    it('forbids a Partner creating a client for another office (RLS ⇒ 403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/entities')
        .set(bearer(await token('partner.a@hsdg.in')))
        .send({ legalName: 'Sneaky Ltd', typeSlug: 'private_limited', officeCode: 'SOUTH' })
        .expect(403);
    });

    it('validates PAN format (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/entities')
        .set(bearer(await token('partner.a@hsdg.in')))
        .send({
          legalName: 'Bad PAN Co',
          typeSlug: 'private_limited',
          officeCode: 'NORTH',
          pan: 'notapan',
        })
        .expect(400);
    });

    it('enforces optimistic concurrency on update (stale version ⇒ 409)', async () => {
      const partner = await token('partner.a@hsdg.in');
      const created = await request(app.getHttpServer())
        .post('/api/v1/entities')
        .set(bearer(partner))
        .send({ legalName: 'Versioned Co', typeSlug: 'private_limited', officeCode: 'NORTH' })
        .expect(201);
      const v0 = created.body.version as number;
      await request(app.getHttpServer())
        .patch(`/api/v1/entities/${created.body.id}`)
        .set(bearer(partner))
        .send({ status: 'inactive', version: v0 })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/entities/${created.body.id}`)
        .set(bearer(partner))
        .send({ status: 'active', version: v0 })
        .expect(409);
    });

    it('adds a registration to an existing entity (audited)', async () => {
      const partner = await token('partner.a@hsdg.in');
      const created = await request(app.getHttpServer())
        .post('/api/v1/entities')
        .set(bearer(partner))
        .send({ legalName: 'RegAdd Co', typeSlug: 'private_limited', officeCode: 'NORTH' })
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/entities/${created.body.id}/registrations`)
        .set(bearer(partner))
        .send({
          registrationType: 'tan',
          registrationNumber: `DELR${Math.floor(10000 + Math.random() * 89999)}A`,
        })
        .expect(201);
      expect(
        res.body.registrations.some(
          (r: { registrationType: string }) => r.registrationType === 'tan',
        ),
      ).toBe(true);
    });
  });
});

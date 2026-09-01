import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Phase B Slice 2 — client relationships (§2) and the entity factual child
 * resources: addresses (§8), relationships (§13), business activities (§18),
 * listings (§15), regulatory attributes (§19), plus the atomic wizard submit (§4).
 */
describe('Client & entity facts (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(url).set(bearer(t)).send(body);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('clients (§2)', () => {
    it('creates, lists, reads and updates a client (RLS + audit + version)', async () => {
      const t = await token('partner.a@dhvaj.in');
      const created = await post(t, '/api/v1/clients', {
        name: 'Shubham Group',
        clientKind: 'group',
        officeCode: 'NORTH',
      }).expect(201);
      expect(created.body.clientCode).toMatch(/^CLI\d{5}$/);
      expect(created.body.clientKind).toBe('group');
      const id = created.body.id as string;

      const list = await request(app.getHttpServer())
        .get('/api/v1/clients?search=Shubham')
        .set(bearer(t))
        .expect(200);
      expect(list.body.items.some((c: { id: string }) => c.id === id)).toBe(true);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/clients/${id}`)
        .set(bearer(t))
        .send({ shortName: 'SG', version: created.body.version })
        .expect(200);
      expect(updated.body.shortName).toBe('SG');
      // stale version ⇒ 409
      await request(app.getHttpServer())
        .patch(`/api/v1/clients/${id}`)
        .set(bearer(t))
        .send({ shortName: 'X', version: created.body.version })
        .expect(409);
    });

    it('forbids a Manager (no entity.manage) from creating a client (403)', async () => {
      await post(await token('manager.x@dhvaj.in'), '/api/v1/clients', {
        name: 'Nope',
        officeCode: 'NORTH',
      }).expect(403);
    });

    it('links an entity to a client on create, exposed on the entity (§2)', async () => {
      const t = await token('partner.a@dhvaj.in');
      const client = await post(t, '/api/v1/clients', {
        name: `Linked Client ${Date.now()}`,
        officeCode: 'NORTH',
      }).expect(201);
      const entity = await post(t, '/api/v1/entities', {
        legalName: `Linked Entity ${Date.now()}`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
        clientId: client.body.id,
      }).expect(201);
      expect(entity.body.clientId).toBe(client.body.id);
      // The client detail lists the entity it owns.
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/clients/${client.body.id}`)
        .set(bearer(t))
        .expect(200);
      expect(detail.body.entityCount).toBe(1);
      expect(detail.body.entities[0].id).toBe(entity.body.id);
    });
  });

  describe('entity factual children', () => {
    const newEntity = async (t: string): Promise<string> => {
      const res = await post(t, '/api/v1/entities', {
        legalName: `Facts Co ${Date.now()}-${Math.random()}`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
      }).expect(201);
      return res.body.id as string;
    };

    it('adds, updates and removes an address (§8)', async () => {
      const t = await token('partner.a@dhvaj.in');
      const id = await newEntity(t);
      const added = await post(t, `/api/v1/entities/${id}/addresses`, {
        addressType: 'registered',
        line1: '1 MG Road',
        city: 'Mumbai',
        pincode: '400001',
        isPrimary: true,
      }).expect(201);
      const addr = added.body.addresses[0];
      expect(addr.city).toBe('Mumbai');
      const upd = await request(app.getHttpServer())
        .patch(`/api/v1/entities/${id}/addresses/${addr.id}`)
        .set(bearer(t))
        .send({ city: 'Pune' })
        .expect(200);
      expect(upd.body.addresses[0].city).toBe('Pune');
      const del = await request(app.getHttpServer())
        .delete(`/api/v1/entities/${id}/addresses/${addr.id}`)
        .set(bearer(t))
        .expect(200);
      expect(del.body.addresses).toHaveLength(0);
    });

    it('wires a structured relationship between two accessible entities (§13)', async () => {
      const t = await token('partner.a@dhvaj.in');
      const parent = await newEntity(t);
      const child = await newEntity(t);
      const res = await post(t, `/api/v1/entities/${parent}/relationships`, {
        toEntityId: child,
        relationshipType: 'subsidiary',
        shareholdingPct: 75,
      }).expect(201);
      const rel = res.body.relationships[0];
      expect(rel.relationshipType).toBe('subsidiary');
      expect(rel.shareholdingPct).toBe(75);
      expect(rel.toEntityId).toBe(child);
    });

    it('rejects a relationship to an entity outside scope (RLS ⇒ 400/403)', async () => {
      const north = await token('partner.a@dhvaj.in');
      const parent = await newEntity(north);
      // A South entity id the North partner cannot see.
      const mp = await token('mp@dhvaj.in');
      const all = await request(app.getHttpServer())
        .get('/api/v1/entities?limit=100')
        .set(bearer(mp));
      const south = (all.body.items as Array<{ legalName: string; id: string }>).find(
        (e) => e.legalName === 'Coastal Foods Pvt Ltd',
      )!;
      const res = await post(north, `/api/v1/entities/${parent}/relationships`, {
        toEntityId: south.id,
        relationshipType: 'associate',
      });
      expect([400, 403]).toContain(res.status);
    });

    it('adds a business activity by industry slug + NIC, and removes it (§18)', async () => {
      const t = await token('partner.a@dhvaj.in');
      const id = await newEntity(t);
      const res = await post(t, `/api/v1/entities/${id}/business-activities`, {
        industrySlug: 'manufacturing',
        isPrimary: true,
      }).expect(201);
      const act = res.body.businessActivities[0];
      expect(act.industrySlug).toBe('manufacturing');
      expect(act.isPrimary).toBe(true);
      await request(app.getHttpServer())
        .delete(`/api/v1/entities/${id}/business-activities/${act.id}`)
        .set(bearer(t))
        .expect(200);
    });

    it('rejects an unknown industry slug (400)', async () => {
      const t = await token('partner.a@dhvaj.in');
      const id = await newEntity(t);
      await post(t, `/api/v1/entities/${id}/business-activities`, {
        industrySlug: 'no_such_industry',
      }).expect(400);
    });

    it('adds a listing line (§15)', async () => {
      const t = await token('partner.a@dhvaj.in');
      const id = await newEntity(t);
      const res = await post(t, `/api/v1/entities/${id}/listings`, {
        exchange: 'nse',
        securityType: 'equity',
        symbol: 'FACTS',
      }).expect(201);
      expect(res.body.listings[0].exchange).toBe('nse');
      expect(res.body.listings[0].symbol).toBe('FACTS');
    });

    it('records a structured regulatory FACT — never a conclusion (§19)', async () => {
      const t = await token('partner.a@dhvaj.in');
      const id = await newEntity(t);
      const res = await post(t, `/api/v1/entities/${id}/regulatory-attributes`, {
        attributeCode: 'regulated_sector',
        valueText: 'nbfc',
        source: 'client',
      }).expect(201);
      expect(res.body.regulatoryAttributes[0].attributeCode).toBe('regulated_sector');
      expect(res.body.regulatoryAttributes[0].valueText).toBe('nbfc');
    });

    it('rejects an unknown regulatory attribute code (400)', async () => {
      const t = await token('partner.a@dhvaj.in');
      const id = await newEntity(t);
      await post(t, `/api/v1/entities/${id}/regulatory-attributes`, {
        attributeCode: 'made_up_code',
        valueText: 'x',
      }).expect(400);
    });
  });

  it('serves the industries reference list for the wizard (§18)', async () => {
    const t = await token('partner.a@dhvaj.in');
    const res = await request(app.getHttpServer())
      .get('/api/v1/industries')
      .set(bearer(t))
      .expect(200);
    const slugs = (res.body as Array<{ slug: string }>).map((i) => i.slug);
    expect(slugs).toEqual(expect.arrayContaining(['manufacturing', 'it_software', 'nbfc']));
  });

  it('updates business-activity flags on an entity (§18)', async () => {
    const t = await token('partner.a@dhvaj.in');
    const created = await post(t, '/api/v1/entities', {
      legalName: `Flags Co ${Date.now()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/entities/${created.body.id}`)
      .set(bearer(t))
      .send({ activities: { manufacturing: true, ecommerce: true } })
      .expect(200);
    expect(res.body.activities.manufacturing).toBe(true);
    expect(res.body.activities.ecommerce).toBe(true);
    expect(res.body.activities.trading).toBe(false);
  });

  it('atomic wizard submit: entity + all children in one transaction (§4)', async () => {
    const t = await token('partner.a@dhvaj.in');
    const res = await post(t, '/api/v1/entities', {
      legalName: `Wizard Co ${Date.now()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
      status: 'draft',
      addresses: [{ addressType: 'registered', line1: '9 Ring Road', isPrimary: true }],
      businessActivities: [{ industrySlug: 'it_software', isPrimary: true }],
      listings: [{ exchange: 'bse', securityType: 'equity' }],
      regulatoryAttributes: [{ attributeCode: 'is_government_company', valueBoolean: false }],
      financialProfiles: [{ financialYear: '2024-25', turnover: 1200000 }],
      contacts: [{ fullName: 'Wizard Admin', isPrimary: true }],
      activities: { services: true, export: true },
    }).expect(201);
    expect(res.body.addresses).toHaveLength(1);
    expect(res.body.businessActivities).toHaveLength(1);
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.regulatoryAttributes).toHaveLength(1);
    expect(res.body.financialProfiles).toHaveLength(1);
    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.activities.services).toBe(true);
    expect(res.body.activities.export).toBe(true);
    expect(res.body.activities.manufacturing).toBe(false);
  });

  it('rolls back the whole wizard submit if one child is invalid (§4 atomicity)', async () => {
    const t = await token('partner.a@dhvaj.in');
    const legalName = `Rollback Co ${Date.now()}`;
    await post(t, '/api/v1/entities', {
      legalName,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
      businessActivities: [{ industrySlug: 'no_such_industry' }], // fails mid-transaction
    }).expect(400);
    // The entity must NOT have been created (transaction rolled back).
    const list = await request(app.getHttpServer())
      .get(`/api/v1/entities?search=${encodeURIComponent(legalName)}`)
      .set(bearer(t))
      .expect(200);
    expect(list.body.items).toHaveLength(0);
  });
});

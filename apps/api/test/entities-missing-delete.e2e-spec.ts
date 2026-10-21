import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * The Clients list's "Missing data" marker and filter, and the Managing
 * Partner's delete of a client entered by mistake:
 *   • each list row carries the same missing items as the client page;
 *   • ?missing=any|none|<item> filters before paging;
 *   • only the Managing Partner deletes; the client's own master goes with it
 *     (registrations, contacts, logins, GST return marks); a client with an
 *     engagement — its own, or a place in another's — is refused with 409.
 */
describe('Clients: missing data and delete (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  const tag = `MD${Date.now().toString(36)}`;
  const pan = `AAAFM${String(Date.now() % 10000).padStart(4, '0')}C`;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const create = async (t: string, body: Record<string, unknown>): Promise<string> =>
    (await http().post('/api/v1/entities').set(bearer(t)).send(body).expect(201)).body.id as string;
  type Row = { id: string; missingInfo: { code: string; label: string }[] };
  const list = async (t: string, q: string): Promise<Row[]> =>
    (await http().get(`/api/v1/entities?search=${tag}&limit=100${q}`).set(bearer(t)).expect(200))
      .body.items as Row[];

  let pa: string;
  let mp: string;
  let bare: string;
  let complete: string;
  let noPan: string;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = await token('partner.a@dhvaj.in');
    mp = await token('mp@dhvaj.in');

    bare = await create(pa, {
      legalName: `${tag} Bare Pvt Ltd`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    });
    complete = await create(pa, {
      legalName: `${tag} Complete & Co`,
      typeSlug: 'partnership',
      officeCode: 'NORTH',
      pan,
      legalStatus: 'active',
      incorporationDate: '2015-04-01',
      registrations: [{ registrationType: 'gstin', registrationNumber: `07${pan}1Z5` }],
      contacts: [{ fullName: 'Asha Partner', isPrimary: true }],
      financialProfiles: [{ financialYear: '2025-26', turnover: 1000000 }],
    });
    noPan = await create(pa, {
      legalName: `${tag} No PAN Traders`,
      typeSlug: 'proprietorship',
      officeCode: 'NORTH',
      legalStatus: 'active',
      incorporationDate: '2019-01-01',
      contacts: [{ fullName: 'Ravi Owner', isPrimary: true }],
    });
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('gives each list row the missing items the client page shows', async () => {
    const rows = await list(pa, '');
    expect(rows.map((r) => r.id).sort()).toEqual([bare, complete, noPan].sort());
    for (const r of rows) {
      const detail = (await http().get(`/api/v1/entities/${r.id}`).set(bearer(pa)).expect(200))
        .body;
      expect(r.missingInfo).toEqual(detail.missingInfo);
    }
    const byId = new Map(rows.map((r) => [r.id, r.missingInfo.map((m) => m.code)]));
    expect(byId.get(bare)).toEqual([
      'pan',
      'incorporation_date',
      'legal_status',
      'registrations',
      'primary_contact',
      'financials',
      'cin',
    ]);
    expect(byId.get(complete)).toEqual([]);
    expect(byId.get(noPan)).toEqual(['pan', 'registrations', 'financials']);
    expect(rows.find((r) => r.id === noPan)!.missingInfo[0]!.label).toBe('PAN not recorded');
  });

  it('filters by missing data before paging', async () => {
    const ids = async (q: string) => (await list(pa, q)).map((r) => r.id).sort();
    expect(await ids('&missing=any')).toEqual([bare, noPan].sort());
    expect(await ids('&missing=none')).toEqual([complete]);
    expect(await ids('&missing=pan')).toEqual([bare, noPan].sort());
    expect(await ids('&missing=cin')).toEqual([bare]);
    expect(await ids('&missing=primary_contact')).toEqual([bare]);
    // Paging counts the filtered set.
    const page = await http()
      .get(`/api/v1/entities?search=${tag}&missing=any&limit=1`)
      .set(bearer(pa))
      .expect(200);
    expect(page.body.total).toBe(2);
    expect(page.body.items).toHaveLength(1);
    await http().get('/api/v1/entities?missing=gstin').set(bearer(pa)).expect(400);
  });

  it('lets only the Managing Partner delete a client', async () => {
    await http().delete(`/api/v1/entities/${bare}`).set(bearer(pa)).expect(403);
    const admin = await token('admin@dhvaj.in');
    await http().delete(`/api/v1/entities/${bare}`).set(bearer(admin)).expect(403);
    await http().get(`/api/v1/entities/${bare}`).set(bearer(pa)).expect(200);
    await http()
      .delete('/api/v1/entities/00000000-0000-4000-8000-000000000000')
      .set(bearer(mp))
      .expect(404);
  });

  it("deletes the client's own master with it, and audits the delete", async () => {
    const reg = (
      await su.query<{ id: string }>(
        `SELECT id FROM hsdg.entity_registrations WHERE entity_id = $1`,
        [complete],
      )
    ).rows[0]!.id;
    await su.query(
      `INSERT INTO hsdg.client_return_marks (entity_id, registration_id, return_form, period_key, mark)
       VALUES ($1, $2, 'GSTR3B', '2026-04', 'filed'), ($1, NULL, 'GSTR1', '2026-05', 'filed')`,
      [complete, reg],
    );
    await su.query(
      `INSERT INTO hsdg.client_credentials
         (id, entity_id, portal, username_hint, ciphertext, iv, auth_tag, key_version)
       VALUES (gen_random_uuid(), $1, 'gst', 'as***', '\\x00',
               decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 1)`,
      [complete],
    );

    await http().delete(`/api/v1/entities/${complete}`).set(bearer(mp)).expect(204);
    await http().get(`/api/v1/entities/${complete}`).set(bearer(mp)).expect(404);

    const left = await su.query<{ t: string; n: string }>(
      `SELECT 'entities' t, count(*) n FROM hsdg.entities WHERE id = $1
       UNION ALL SELECT 'registrations', count(*) FROM hsdg.entity_registrations WHERE entity_id = $1
       UNION ALL SELECT 'contacts', count(*) FROM hsdg.entity_contacts WHERE entity_id = $1
       UNION ALL SELECT 'financials', count(*) FROM hsdg.entity_financial_profiles WHERE entity_id = $1
       UNION ALL SELECT 'logins', count(*) FROM hsdg.client_credentials WHERE entity_id = $1
       UNION ALL SELECT 'marks', count(*) FROM hsdg.client_return_marks WHERE entity_id = $1`,
      [complete],
    );
    expect(left.rows.filter((r) => r.n !== '0')).toEqual([]);

    const audit = await su.query<{ actor_role: string; before_state: { legalName: string } }>(
      `SELECT actor_role, before_state FROM hsdg.audit_events
        WHERE action = 'entity.deleted' AND object_type = 'entity' AND object_id = $1`,
      [complete],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_role).toBe('managing_partner');
    expect(audit.rows[0]!.before_state.legalName).toBe(`${tag} Complete & Co`);
  });

  it('refuses (409) a client with an engagement, or a place in another one', async () => {
    const service = (
      await http().get('/api/v1/services?search=STAT_AUDIT&limit=100').set(bearer(pa)).expect(200)
    ).body.items[0].id as string;
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId: noPan,
          serviceId: service,
          financialYear: '2025-26',
          periodLabel: tag,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;

    const own = await http().delete(`/api/v1/entities/${noPan}`).set(bearer(mp)).expect(409);
    expect(own.body.message).toMatch(/1 engagement\b/);
    await http().get(`/api/v1/entities/${noPan}`).set(bearer(mp)).expect(200);

    // Bare is covered by No PAN's engagement (a group engagement's other client).
    await su.query(
      `INSERT INTO hsdg.engagement_entities (engagement_id, entity_id) VALUES ($1, $2)`,
      [eng, bare],
    );
    const covered = await http().delete(`/api/v1/entities/${bare}`).set(bearer(mp)).expect(409);
    expect(covered.body.message).toMatch(/another client’s engagement/);
    await http().get(`/api/v1/entities/${bare}`).set(bearer(mp)).expect(200);

    // Once that place is gone it can go.
    await su.query(`DELETE FROM hsdg.engagement_entities WHERE entity_id = $1`, [bare]);
    await http().delete(`/api/v1/entities/${bare}`).set(bearer(mp)).expect(204);
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { ChangeLogEntry, Paginated } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * The change log: every add, edit and removal on a client (and its
 * registrations, contacts, portal logins …) or an engagement is kept by the
 * database, with who made it and each field's old → new value. Only the
 * Managing Partner and an administrator read it.
 */
describe('Change log (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let admin: string;
  let pa: string;
  let entityId: string;
  let registrationId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const p = `AAAC${'QRSTUV'[Math.floor(Math.random() * 6)]}${String(
    Math.floor(Math.random() * 10000),
  ).padStart(4, '0')}L`;
  const gstin = (state: string) => `${state}${p}1Z5`;
  const log = async (t: string, q: Record<string, string>) =>
    (
      await http()
        .get(`/api/v1/change-log?${new URLSearchParams(q).toString()}`)
        .set(bearer(t))
        .expect(200)
    ).body as Paginated<ChangeLogEntry>;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    [mp, admin, pa] = await Promise.all([
      token('mp@dhvaj.in'),
      token('admin@dhvaj.in'),
      token('partner.a@dhvaj.in'),
    ]);
    const res = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `Logbook ${p} Pvt Ltd`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
        pan: p,
        registrations: [{ registrationType: 'gstin', registrationNumber: gstin('07') }],
      })
      .expect(201);
    entityId = res.body.id as string;
    registrationId = res.body.registrations[0].id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('records the client and its GSTIN as added, by whom', async () => {
    const page = await log(mp, { entityId });
    const added = page.items.filter((i) => i.op === 'insert').map((i) => [i.area, i.label]);
    expect(added).toEqual(
      expect.arrayContaining([
        ['Client', `Logbook ${p} Pvt Ltd`],
        ['Registration', gstin('07')],
      ]),
    );
    const client = page.items.find((i) => i.table === 'entities' && i.op === 'insert')!;
    expect(client.actorName).toBeTruthy();
    expect(client.entityCode).toMatch(/^ENT/);
    expect(client.fields.find((f) => f.field === 'pan')).toMatchObject({ before: null, after: p });
  });

  it('records a GSTIN edited in place with its old and new number', async () => {
    await http()
      .patch(`/api/v1/entities/${entityId}/registrations/${registrationId}`)
      .set(bearer(pa))
      .send({ registrationNumber: gstin('09') })
      .expect(200);
    const page = await log(admin, { entityId, table: 'entity_registrations', op: 'update' });
    const edit = page.items.find((i) => i.fields.some((f) => f.field === 'registration_number'))!;
    expect(edit.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'registration_number',
          label: 'Registration number',
          before: gstin('07'),
          after: gstin('09'),
        }),
        expect.objectContaining({ field: 'state_code', before: '07', after: '09' }),
      ]),
    );
    // Bookkeeping columns are not changes.
    expect(edit.fields.map((f) => f.field)).not.toContain('updated_at');
  });

  it('names the people and offices behind ids, and finds entries by text', async () => {
    const page = await log(mp, { q: `Logbook ${p}`, table: 'entities' });
    const client = page.items.find((i) => i.op === 'insert')!;
    expect(client.fields.find((f) => f.field === 'home_office_id')?.after).toMatch(/NORTH/);
  });

  it('records a removal', async () => {
    const added = await http()
      .post(`/api/v1/entities/${entityId}/addresses`)
      .set(bearer(pa))
      .send({ line1: '12 Logkeeper Lane', city: 'New Delhi', stateCode: '07' })
      .expect(201);
    const address = (added.body.addresses as Array<{ id: string; line1: string }>).find(
      (a) => a.line1 === '12 Logkeeper Lane',
    )!;
    await http()
      .delete(`/api/v1/entities/${entityId}/addresses/${address.id}`)
      .set(bearer(pa))
      .expect(200);
    const page = await log(mp, { entityId, table: 'entity_addresses' });
    expect(page.items.map((i) => [i.op, i.label])).toEqual([
      ['delete', '12 Logkeeper Lane'],
      ['insert', '12 Logkeeper Lane'],
    ]);
    expect(page.items[0]!.fields.find((f) => f.field === 'city')).toMatchObject({
      before: 'New Delhi',
      after: null,
    });
  });

  it('is for the Managing Partner and administrators only', async () => {
    await http().get('/api/v1/change-log').set(bearer(pa)).expect(403);
    const hr = await token('hr@dhvaj.in');
    await http().get('/api/v1/change-log').set(bearer(hr)).expect(403);
  });
});

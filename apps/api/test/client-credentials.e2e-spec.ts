import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import {
  gstinCheckChar,
  type EntityCredentials,
  type GstImportPreview,
  type GstImportResult,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * ADR-0035 — clients' GST logins: imported from a spreadsheet, stored only
 * encrypted, unreadable to the app role, shown only through the logged,
 * rate-limited reveal, and only to the client's partner (or the managing
 * partner, or its engagement team).
 */
describe('Client portal credentials (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;
  let sy: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;

  // Fresh PANs every run: GSTINs and PANs are unique across the database.
  const letters = (n: number) =>
    Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
      '',
    );
  const pan = (kind: string) =>
    `${letters(3)}${kind}${letters(1)}${String(Math.floor(Math.random() * 9000) + 1000)}${letters(1)}`;
  const gstin = (state: string, p: string) => {
    const first14 = `${state}${p}1Z`;
    return first14 + gstinCheckChar(first14);
  };
  const company = pan('C');
  const firm = pan('F');
  const G1 = gstin('07', company);
  const G2 = gstin('27', company);
  const G3 = gstin('07', firm);
  const PASSWORDS = ['Pw-Company-Delhi-91!', 'Pw-Company-Mum-27!', 'Pw-Firm-Delhi-07!'];
  const tag = `Vault${Date.now()}`;

  const file = (): string => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Client GST Login Details'],
        ['S.No', 'Name of Client', 'GSTIN', 'User ID', 'Password', 'Mobile', 'Email'],
        [1, `${tag} Company Pvt Ltd`, G1, 'company_dl', PASSWORDS[0], '9876543210', 'a@b.in'],
        [2, `${tag} Company Pvt Ltd`, G2, 'company_mh', PASSWORDS[1], '', ''],
        [3, `${tag} Firm`, G3, 'firm_dl', PASSWORDS[2], '', ''],
        [4, `${tag} Typo`, `${G3.slice(0, 14)}${G3[14] === 'A' ? 'B' : 'A'}`, '', '', '', ''],
      ]),
      'Clients',
    );
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };
  const body = () => ({ filename: 'clients.xlsx', contentBase64: file(), officeCode: 'NORTH' });
  const credentialsOf = async (t: string, entityId: string): Promise<EntityCredentials> =>
    (await http().get(`/api/v1/credentials?entityId=${entityId}`).set(bearer(t)).expect(200))
      .body as EntityCredentials;

  let companyId: string;
  let firmId: string;
  let loginId: string;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
  });

  afterAll(async () => {
    await su.end();
    await app.close();
  });

  it('previews the file without ever returning a password', async () => {
    const res = await http()
      .post('/api/v1/client-imports/gst/preview')
      .set(bearer(pa))
      .send(body())
      .expect(200);
    const preview = res.body as GstImportPreview;
    for (const p of PASSWORDS) expect(res.text).not.toContain(p);
    expect(preview.sheet).toBe('Clients');
    expect(preview.mapping).toMatchObject({ gstin: 'GSTIN', password: 'Password' });
    expect(preview.vaultReady).toBe(true);
    expect(preview.rows.map((r) => r.action)).toEqual([
      'create_client',
      'create_client',
      'create_client',
      'error',
    ]);
    expect(preview.rows[0]).toMatchObject({
      row: 3,
      pan: company,
      typeSlug: 'private_limited',
      hasLogin: true,
      usernameHint: 'co•••dl',
    });
    expect(preview.rows[2]).toMatchObject({ typeSlug: 'partnership' });
  });

  it('is for partners and managers only', async () => {
    await http()
      .post('/api/v1/client-imports/gst/preview')
      .set(bearer(sy))
      .send(body())
      .expect(403);
  });

  it('imports one client per PAN with its GSTINs, contact and sealed logins', async () => {
    const result = (
      await http().post('/api/v1/client-imports/gst').set(bearer(pa)).send(body()).expect(200)
    ).body as GstImportResult;
    expect(result).toMatchObject({
      clientsCreated: 2,
      registrationsAdded: 3,
      loginsSaved: 3,
      unchanged: 0,
    });
    expect(result.failed).toEqual([
      expect.objectContaining({ row: 6, message: expect.stringMatching(/not a valid GSTIN/) }),
    ]);

    const { rows: entities } = await su.query<{ id: string; pan: string }>(
      `SELECT id, pan FROM hsdg.entities WHERE pan = ANY($1)`,
      [[company, firm]],
    );
    companyId = entities.find((e) => e.pan === company)!.id;
    firmId = entities.find((e) => e.pan === firm)!.id;
    const detail = (await http().get(`/api/v1/entities/${companyId}`).set(bearer(pa)).expect(200))
      .body as {
      registrations: { registrationNumber: string; stateCode: string }[];
      contacts: { email: string | null; phone: string | null }[];
    };
    expect(detail.registrations.map((r) => r.registrationNumber).sort()).toEqual([G1, G2].sort());
    expect(detail.contacts[0]).toMatchObject({ email: 'a@b.in', phone: '9876543210' });

    const list = await credentialsOf(pa, companyId);
    expect(list.items).toHaveLength(2);
    expect(list.items.map((i) => i.usernameHint).sort()).toEqual(['co•••dl', 'co•••mh']);
    loginId = list.items.find((i) => i.usernameHint === 'co•••dl')!.id;
  });

  it('stores only ciphertext, which the app role cannot even select', async () => {
    const { rows } = await su.query<{ ciphertext: Buffer }>(
      `SELECT c.ciphertext FROM hsdg.registration_credentials c
         JOIN hsdg.entity_registrations r ON r.id = c.registration_id
        WHERE r.entity_id = ANY($1)`,
      [[companyId, firmId]],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows)
      for (const p of PASSWORDS) expect(r.ciphertext.toString()).not.toContain(p);

    const appDb = new Client({ connectionString: process.env.DATABASE_URL });
    await appDb.connect();
    try {
      await expect(
        appDb.query(`SELECT ciphertext FROM hsdg.registration_credentials`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        appDb.query(`INSERT INTO hsdg.credential_access_log (credential_id, registration_id, user_id, role)
                   VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x')`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await appDb.end();
    }

    const { rows: audit } = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.audit_events
        WHERE coalesce(after_state::text, '') || coalesce(before_state::text, '') ~ $1`,
      [PASSWORDS.map((p) => p.replace(/[!-]/g, '.')).join('|')],
    );
    expect(audit[0]!.n).toBe(0);
  });

  it("shows the login to the client's partner and the managing partner, never cached", async () => {
    const res = await http()
      .post(`/api/v1/credentials/${loginId}/reveal`)
      .set(bearer(pa))
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      id: loginId,
      portal: 'gst',
      username: 'company_dl',
      password: PASSWORDS[0],
    });
    await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(mp)).expect(200);
  });

  it('refuses a manager who is not on its engagements, and hides it from other offices', async () => {
    await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(mx)).expect(403);
    await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(pb)).expect(404);
    expect((await credentialsOf(pb, companyId)).items).toEqual([]);
  });

  it('logs every reveal for the partners to see', async () => {
    const list = await credentialsOf(pa, companyId);
    expect(list.recentAccess.filter((a) => a.credentialId === loginId)).toEqual([
      expect.objectContaining({ userName: 'Managing Partner', role: 'managing_partner' }),
      expect.objectContaining({ userName: 'Partner A', role: 'partner' }),
    ]);
    // A manager can manage logins but does not read the log.
    expect((await credentialsOf(mx, companyId)).recentAccess).toEqual([]);
  });

  it('lets a manager of the office change or remove a login; not another office', async () => {
    const registrationId = (await credentialsOf(pa, firmId)).items[0]!.registrationId;
    const saved = await http()
      .put('/api/v1/credentials')
      .set(bearer(mx))
      .send({ registrationId, username: 'firm_new', password: 'New-Pw-1' })
      .expect(200);
    expect(saved.body).toMatchObject({ usernameHint: 'fi•••ew', updatedBy: 'Manager X' });
    expect(JSON.stringify(saved.body)).not.toContain('New-Pw-1');
    await http()
      .put('/api/v1/credentials')
      .set(bearer(pb))
      .send({ registrationId, username: 'x', password: 'y' })
      .expect(404);
    await http().delete(`/api/v1/credentials/${saved.body.id}`).set(bearer(sy)).expect(403);
    await http().delete(`/api/v1/credentials/${saved.body.id}`).set(bearer(mx)).expect(204);
    expect((await credentialsOf(pa, firmId)).items).toEqual([]);
  });

  it('a second import of the same file only refreshes the logins', async () => {
    const preview = (
      await http()
        .post('/api/v1/client-imports/gst/preview')
        .set(bearer(pa))
        .send(body())
        .expect(200)
    ).body as GstImportPreview;
    expect(preview.counts).toMatchObject({ update_login: 3, create_client: 0, error: 1 });
    const result = (
      await http().post('/api/v1/client-imports/gst').set(bearer(pa)).send(body()).expect(200)
    ).body as GstImportResult;
    expect(result).toMatchObject({ clientsCreated: 0, registrationsAdded: 0, loginsSaved: 3 });
  });

  it('stops after 60 reveals an hour', async () => {
    const { rows } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.users WHERE email = 'partner.a@dhvaj.in'`,
    );
    await su.query(
      `INSERT INTO hsdg.credential_access_log (credential_id, registration_id, user_id, role)
       SELECT c.id, c.registration_id, $2, 'partner' FROM hsdg.registration_credentials c, generate_series(1, 60)
        WHERE c.id = $1`,
      [loginId, rows[0]!.id],
    );
    await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(pa)).expect(429);
    await http().post(`/api/v1/credentials/${loginId}/reveal`).set(bearer(mp)).expect(200);
  });
});

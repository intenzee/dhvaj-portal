import './client-upload-env';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { ClientUploadService } from '../src/modules/documents/client-upload/client-upload.service';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * The magic link a client uploads through, end to end:
 *   • a link minted for a client request opens (valid, with what is asked)
 *     and takes a file, which lands on the engagement as a client document;
 *   • a revoked or unknown token shows invalid;
 *   • with client upload switched off, no link is minted (they could only
 *     ever say "expired") and the public page answers 404.
 */
describe('Client upload links (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: string;
  let eng: string;
  let dep: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const linksUrl = () => `/api/v1/engagements/${eng}/client-dependencies/${dep}/upload-links`;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = await token('partner.a@dhvaj.in');
    const mp = await token('mp@dhvaj.in');
    const emps = await http().get('/api/v1/employees?limit=100').set(bearer(mp)).expect(200);
    const partnerA = (emps.body.items as Array<{ id: string; employeeCode: string }>).find(
      (e) => e.employeeCode === 'EMP003',
    )!.id;
    const tag = `UL${Date.now().toString(36)}`;
    const entity = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `${tag} Uploaders Pvt Ltd`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
      })
      .expect(201);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId: entity.body.id,
          kind: 'compliance',
          status: 'accepted',
          engagementPartnerEmployeeId: partnerA,
          engagementManagerEmployeeId: partnerA,
          financialYear: '2026-27',
          engagementType: 'recurring_compliance',
          years: [{ financialYear: '2026-27' }],
          streams: ['gst'],
          streamLeads: {},
        })
        .expect(201)
    ).body.id as string;
    dep = (
      await su.query<{ id: string }>(
        `INSERT INTO hsdg.client_dependencies (engagement_id, requested_info)
         VALUES ($1, 'Sales register for April') RETURNING id`,
        [eng],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('opens a fresh link and takes a file through it', async () => {
    const link = await http().post(linksUrl()).set(bearer(pa)).send({}).expect(201);
    const raw = link.body.token as string;
    expect(raw).toBeTruthy();

    const info = await http().get(`/api/v1/client-upload/${raw}`).expect(200);
    expect(info.body).toMatchObject({
      valid: true,
      requestedInfo: 'Sales register for April',
      entityName: expect.stringContaining('Uploaders Pvt Ltd'),
      uploadsRemaining: 20,
    });

    await http()
      .post(`/api/v1/client-upload/${raw}`)
      .send({
        filename: 'sales-april.csv',
        contentType: 'text/csv',
        contentBase64: Buffer.from('invoice,amount\n1,100\n').toString('base64'),
      })
      .expect(201);
    const after = await http().get(`/api/v1/client-upload/${raw}`).expect(200);
    expect(after.body).toMatchObject({ valid: true, uploadsRemaining: 19 });
    const docs = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.documents WHERE engagement_id = $1`,
      [eng],
    );
    expect(docs.rows[0]!.n).toBe(1);

    await http().post(`${linksUrl()}/${link.body.id}/revoke`).set(bearer(pa)).expect(204);
    expect((await http().get(`/api/v1/client-upload/${raw}`).expect(200)).body.valid).toBe(false);
  });

  it('shows an unknown token as invalid', async () => {
    const res = await http().get('/api/v1/client-upload/not-a-real-token').expect(200);
    expect(res.body.valid).toBe(false);
  });

  it('mints no link while client upload is switched off', async () => {
    // The validated config is cached for the process: switch the flag off here.
    const off = jest.spyOn(app.get(ClientUploadService), 'enabled', 'get').mockReturnValue(false);
    try {
      const res = await http().post(linksUrl()).set(bearer(pa)).send({}).expect(400);
      expect(res.body.message).toMatch(/switched off/);
      await http().get('/api/v1/client-upload/anything').expect(404);
    } finally {
      off.mockRestore();
    }
  });
});

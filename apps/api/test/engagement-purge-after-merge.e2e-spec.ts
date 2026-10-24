import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { gstinCheckChar } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { dateFromToday } from './date.helper';

/**
 * Engagements a client merge moved or folded can still be deleted: the one
 * that moved with its issued invoice, and the kept client's Compliance
 * engagement together with the one folded into it. The receipt stays with
 * the client.
 */
describe('Engagement purge after a client merge (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let admin: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const letters = (n: number) =>
    Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
      '',
    );
  const digits = (n: number) =>
    String(Math.floor(Math.random() * 9 * 10 ** (n - 1)) + 10 ** (n - 1));

  const tag = `Prg${Date.now().toString(36)}`;
  const PAN = `${letters(3)}C${letters(1)}${digits(4)}${letters(1)}`;
  const GSTIN = `07${PAN}1Z` + gstinCheckChar(`07${PAN}1Z`);

  const engagement = async (body: Record<string, unknown>) => {
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({ status: 'accepted', financialYear: '2026-27', ...body });
    if (res.status !== 201)
      throw new Error(`engagement: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string; engagementCode: string };
  };
  const purge = async (e: { id: string; engagementCode: string }) => {
    const res = await http()
      .delete(`/api/v1/engagement-purge/${e.id}`)
      .set(bearer(admin))
      .send({ confirmCode: e.engagementCode });
    expect([res.status, res.body.message]).toEqual([200, undefined]);
  };
  const exists = async (table: string, column: string, id: string): Promise<number> =>
    Number(
      (
        await su.query<{ n: string }>(
          `SELECT count(*) AS n FROM hsdg.${table} WHERE ${column} = $1`,
          [id],
        )
      ).rows[0]!.n,
    );

  let keepCompliance: { id: string; engagementCode: string };
  let dropCompliance: { id: string; engagementCode: string };
  let moved: { id: string; engagementCode: string };
  let invoiceId: string;
  let keepId: string;
  let firmWas:
    { gstin: string | null; state_code: string | null; invoice_prefix: string } | undefined;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    admin = await token('admin@dhvaj.in');
    // Issuing an invoice needs the firm's GSTIN; afterAll puts the settings back.
    firmWas = (
      await su.query<{ gstin: string | null; state_code: string | null; invoice_prefix: string }>(
        `SELECT gstin, state_code, invoice_prefix FROM hsdg.firm_settings`,
      )
    ).rows[0];
    const settings = await http().get('/api/v1/billing/settings').set(bearer(mp)).expect(200);
    await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(mp))
      .send({ version: settings.body.version, gstin: '07AAAFD1234K1Z5', invoicePrefix: 'INV' })
      .expect(200);

    const client = async (body: Record<string, unknown>) =>
      (
        await http()
          .post('/api/v1/entities')
          .set(bearer(pa))
          .send({ officeCode: 'NORTH', ...body })
          .expect(201)
      ).body as { id: string };
    const drop = await client({ legalName: `${tag} Labs - Firm`, typeSlug: 'partnership' });
    const keep = await client({
      legalName: `${tag} Labs Private Limited`,
      typeSlug: 'private_limited',
      pan: PAN,
    });
    keepId = keep.id;
    keepCompliance = await engagement({
      kind: 'compliance',
      entityId: keep.id,
      streams: ['gst'],
      years: [{ financialYear: '2026-27' }],
    });
    dropCompliance = await engagement({
      kind: 'compliance',
      entityId: drop.id,
      streams: ['gst', 'tds'],
      years: [{ financialYear: '2026-27' }, { financialYear: '2027-28' }],
    });
    await http()
      .post(`/api/v1/entities/${drop.id}/registrations`)
      .set(bearer(pa))
      .send({ registrationType: 'gstin', registrationNumber: GSTIN, stateCode: '07' })
      .expect(201);
    const services = (
      await http().get('/api/v1/services?search=ADVISORY_GEN&limit=100').set(bearer(mp))
    ).body.items as Array<{ id: string; code: string }>;
    moved = await engagement({
      kind: 'assignment',
      serviceId: services.find((s) => s.code === 'ADVISORY_GEN')!.id,
      entityId: drop.id,
      periodLabel: `M${tag}`,
    });
    const inv = await http()
      .post(`/api/v1/engagements/${moved.id}/invoices`)
      .set(bearer(pa))
      .send({
        clientGstin: GSTIN,
        lines: [{ description: 'Advice', quantity: '1', unitAmount: '10000.00' }],
      })
      .expect(201);
    invoiceId = inv.body.id as string;
    await http()
      .post(`/api/v1/engagements/${moved.id}/invoices/${invoiceId}/status`)
      .set(bearer(pa))
      .send({ status: 'issued', issueDate: dateFromToday(0) })
      .expect(201);
    await http()
      .post('/api/v1/billing/receipts')
      .set(bearer(pa))
      .send({
        receivedOn: dateFromToday(0),
        mode: 'bank',
        reference: `UTR${tag}`,
        clientEntityId: drop.id,
        netAmount: '11800.00',
      })
      .expect(201);

    await http()
      .post(`/api/v1/entities/${keep.id}/merge`)
      .set(bearer(pa))
      .send({ dropId: drop.id })
      .expect(201);
  });

  afterAll(async () => {
    if (firmWas)
      await su.query(
        `UPDATE hsdg.firm_settings SET gstin = $1, state_code = $2, invoice_prefix = $3`,
        [firmWas.gstin, firmWas.state_code, firmWas.invoice_prefix],
      );
    await su?.end();
    await app?.close();
  });

  it('deletes the engagement that moved, with its issued invoice; the receipt stays', async () => {
    await purge(moved);
    expect(await exists('engagements', 'id', moved.id)).toBe(0);
    expect(await exists('invoices', 'id', invoiceId)).toBe(0);
    const { rows } = await su.query<{ client_entity_id: string }>(
      `SELECT client_entity_id FROM hsdg.receipts WHERE reference = $1`,
      [`UTR${tag}`],
    );
    expect(rows).toEqual([{ client_entity_id: keepId }]);
  });

  it('deletes the kept Compliance engagement and the one folded into it', async () => {
    const preview = await http()
      .get(`/api/v1/engagement-purge?code=${keepCompliance.engagementCode}`)
      .set(bearer(admin))
      .expect(200);
    expect(preview.body).toMatchObject({ id: keepCompliance.id, merged: 1 });
    await purge(keepCompliance);
    for (const e of [keepCompliance, dropCompliance]) {
      expect(await exists('engagements', 'id', e.id)).toBe(0);
      expect(await exists('compliance_instances', 'engagement_id', e.id)).toBe(0);
      expect(await exists('tasks', 'engagement_id', e.id)).toBe(0);
    }
  });
});

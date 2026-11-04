import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  Certificate,
  CertificateRegisterRow,
  CertificateTemplate,
  UdinListResponse,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/**
 * PS-402 — the certificates desk. "Done when a certificate cannot be issued
 * without a UDIN, revocation needs a reason, template variables are
 * validated, and the certificate appears in both registers."
 */
describe('Certificates (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: Record<string, string>;
  let sy: Record<string, string>;
  let partnerA: string;
  let oldProfile: { membership_no: string | null; cop_valid_until: string | null };
  let eng: string;
  let compliance: string;
  let today: string;
  const savedFlags = process.env.FEATURE_FLAGS;
  // A fresh UDIN series each run: digits 3–8 are Partner A's membership number.
  const tag = Array.from(
    { length: 4 },
    () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)],
  ).join('');
  const udin = (n: number) => `26123456CE${tag}${String(n).padStart(4, '0')}`;
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const base = () => `/api/v1/engagements/${eng}/certificates`;
  const netWorth = {
    person_name: 'Ravi Kumar',
    person_pan: 'abcpk1234f',
    as_on_date: '2026-03-31',
    total_assets: '1,25,00,000.00',
    total_liabilities: '25,00,000',
    net_worth: '10000000',
    basis: 'Immovable property at the stamp duty value; deposits at their balance.',
  };
  const remittance = {
    remitter_name: 'Acme Exports Pvt Ltd',
    remitter_pan: 'AAACA1234B',
    remittee_name: 'Globex GmbH',
    remittee_country: 'Germany',
    nature_of_remittance: 'Software licence fee',
    purpose_code: 'S0902',
    currency: 'EUR',
    amount_fcy: '10000',
    amount_inr: '920000',
    bank_name: 'HDFC Bank, Connaught Place',
    bsr_code: '0510001',
    remittance_date: '2026-11-10',
    taxable_in_india: 'yes',
    provision: 'Article 12 of the India–Germany DTAA',
    trc_obtained: 'Yes',
    tds_rate: '10',
    tds_amount: '92000',
  };
  const create = (body: Record<string, unknown>, h = sy) => http().post(base()).set(h).send(body);
  const act = (
    c: Certificate,
    what: string,
    body: Record<string, unknown>,
    h: Record<string, string>,
  ) =>
    http()
      .post(`${base()}/${c.id}/${what}`)
      .set(h)
      .send({ version: c.version, ...body });
  /** Prepared by Senior Y, sent for review and approved by Partner A. */
  const reviewed = async (body: Record<string, unknown>): Promise<Certificate> => {
    let c = (await create(body).expect(201)).body as Certificate;
    c = (await act(c, 'submit', {}, sy).expect(200)).body as Certificate;
    return (await act(c, 'review', { decision: 'approve' }, pa).expect(200)).body as Certificate;
  };

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    today = (
      await su.query<{ d: string }>(`SELECT timezone('Asia/Kolkata', now())::date::text AS d`)
    ).rows[0]!.d;
    pa = await as('partner.a@dhvaj.in');
    sy = await as('senior.y@dhvaj.in');
    partnerA = (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = 'EMP003'`)
    ).rows[0]!.id;
    oldProfile = (
      await su.query<{ membership_no: string | null; cop_valid_until: string | null }>(
        `SELECT membership_no, cop_valid_until::text AS cop_valid_until
           FROM hsdg.partner_profiles WHERE employee_id = $1`,
        [partnerA],
      )
    ).rows[0]!;
    await su.query(
      `UPDATE hsdg.partner_profiles
          SET membership_no = '123456', cop_no = COALESCE(cop_no, 'COP-A'),
              cop_valid_until = DATE '2099-03-31'
        WHERE employee_id = $1`,
      [partnerA],
    );
    const acme = (await http().get('/api/v1/entities?search=Acme&limit=10').set(pa).expect(200))
      .body.items[0].id as string;
    const entity = await freshClient(acme);
    const service = (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.services WHERE code = 'CERTIFICATION'`)
    ).rows[0]!.id;
    const res = await http().post('/api/v1/engagements').set(pa).send({
      kind: 'assignment',
      entityId: entity,
      serviceId: service,
      status: 'accepted',
      financialYear: '2026-27',
    });
    if (res.status !== 201)
      throw new Error(`engagement: ${res.status} ${JSON.stringify(res.body)}`);
    eng = res.body.id as string;
    const seniorY = (
      await su.query<{ id: string }>(
        `SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id
          WHERE u.email = 'senior.y@dhvaj.in'`,
      )
    ).rows[0]!.id;
    await su.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [eng, seniorY],
    );
    compliance = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: await freshClient(acme),
          status: 'accepted',
          financialYear: '2026-27',
          streams: ['income_tax'],
          years: [{ financialYear: '2026-27' }],
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await su
      ?.query(
        `UPDATE hsdg.partner_profiles SET membership_no = $2, cop_valid_until = $3::date
          WHERE employee_id = $1`,
        [partnerA, oldProfile?.membership_no ?? null, oldProfile?.cop_valid_until ?? null],
      )
      .catch(() => undefined);
    await su?.end();
    await app?.close();
    if (savedFlags === undefined) delete process.env.FEATURE_FLAGS;
    else process.env.FEATURE_FLAGS = savedFlags;
  });

  it('offers the templates in force: Form 146 from 1 April 2026, Form 15CB before', async () => {
    const now = (await http().get('/api/v1/certificates/templates').set(sy).expect(200))
      .body as CertificateTemplate[];
    expect(now.map((t) => t.code)).toEqual(
      expect.arrayContaining(['CERT_15CB', 'CERT_NET_WORTH', 'CERT_TURNOVER', 'CERT_BANK']),
    );
    const cb = now.find((t) => t.code === 'CERT_15CB')!;
    expect(cb).toMatchObject({ version: 2, formLabel: 'Form 146', recordsForm15ca: true });
    const old = (
      await http().get('/api/v1/certificates/templates?asOn=2026-03-31').set(sy).expect(200)
    ).body as CertificateTemplate[];
    expect(old.find((t) => t.code === 'CERT_15CB')).toMatchObject({
      version: 1,
      formLabel: 'Form 15CB',
    });
  });

  it('validates the template variables', async () => {
    const bad = await create({
      templateCode: 'CERT_NET_WORTH',
      purpose: 'Visa application',
      addressee: 'The Consulate General',
      figures: { ...netWorth, person_pan: 'NOTAPAN', net_worth: '9999999', colour: 'blue' },
    }).expect(400);
    expect(bad.body.errors).toMatchObject({
      person_pan: expect.stringContaining('PAN'),
      net_worth: expect.stringContaining('must equal Total assets (INR) less'),
      colour: 'Not a field of this certificate.',
    });
    const missing = await create({
      templateCode: 'CERT_NET_WORTH',
      purpose: 'Visa application',
      addressee: 'The Consulate General',
      figures: { person_name: 'Ravi Kumar' },
    }).expect(400);
    expect(missing.body.errors.as_on_date).toBe('As on is required.');
  });

  it('is issued on an Assignment engagement only', async () => {
    await http()
      .post(`/api/v1/engagements/${compliance}/certificates`)
      .set(pa)
      .send({ templateCode: 'CERT_NET_WORTH', purpose: 'x', addressee: 'y', figures: netWorth })
      .expect(400);
  });

  it('is reviewed by someone other than the preparer, and signed by a partner with a UDIN', async () => {
    let c = (
      await create({
        templateCode: 'CERT_NET_WORTH',
        purpose: 'Visa application',
        addressee: 'The Consulate General of Germany, New Delhi',
        figures: netWorth,
      }).expect(201)
    ).body as Certificate;
    expect(c).toMatchObject({ status: 'draft', templateVersion: 1 });
    expect(c.figures).toMatchObject({ person_pan: 'ABCPK1234F', total_assets: '12500000.00' });
    expect(c.can).toMatchObject({ edit: true, submit: true, sign: false });

    c = (await act(c, 'submit', {}, sy).expect(200)).body as Certificate;
    expect(c.status).toBe('in_review');
    // The preparer does not review it; nothing is signed or issued before the review.
    await act(c, 'review', { decision: 'approve' }, sy).expect(403);
    await act(c, 'sign', { udin: udin(1) }, pa).expect(400);
    await act(c, 'issue', {}, pa).expect(400);

    // Returned with a note, changed, sent again.
    await act(c, 'review', { decision: 'return' }, pa).expect(400);
    c = (await act(c, 'review', { decision: 'return', note: 'Add the basis' }, pa).expect(200))
      .body as Certificate;
    expect(c).toMatchObject({ status: 'draft', reviewNote: 'Add the basis' });
    c = (
      await http()
        .patch(`${base()}/${c.id}`)
        .set(sy)
        .send({ version: c.version, figures: { ...netWorth, basis: 'At cost.' } })
        .expect(200)
    ).body as Certificate;
    await http()
      .patch(`${base()}/${c.id}`)
      .set(sy)
      .send({ version: c.version - 1, purpose: 'Stale' })
      .expect(409);
    c = (await act(c, 'submit', {}, sy).expect(200)).body as Certificate;
    c = (await act(c, 'review', { decision: 'approve' }, pa).expect(200)).body as Certificate;
    expect(c.reviewedBy?.id).toBeTruthy();

    // A senior does not sign; the UDIN must be on the partner's membership number.
    await act(c, 'sign', { udin: udin(1) }, sy).expect(403);
    const wrong = await act(c, 'sign', { udin: `26654321CE${tag}0001` }, pa).expect(400);
    expect(wrong.body.message).toContain('membership number');
    c = (await act(c, 'sign', { udin: udin(1) }, pa).expect(200)).body as Certificate;
    expect(c).toMatchObject({
      status: 'signed',
      udin: udin(1),
      signedOn: today,
      signingPartner: { membershipNo: '123456' },
    });
    // Signed means fixed.
    await http()
      .patch(`${base()}/${c.id}`)
      .set(sy)
      .send({ version: c.version, purpose: 'Changed' })
      .expect(400);

    c = (await act(c, 'issue', {}, pa).expect(200)).body as Certificate;
    expect(c.status).toBe('issued');
    expect(c.certificateNo).toMatch(/^CERT\/\d{4}-\d{2}\/\d{4}$/);
    expect(c.documentId).toBeTruthy();
    const pdf = await http().get(`${base()}/${c.id}/pdf`).set(sy).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    // Both registers.
    const reg = (
      await http()
        .get(`/api/v1/registers/certificates?search=${encodeURIComponent(c.certificateNo!)}`)
        .set(pa)
        .expect(200)
    ).body as CertificateRegisterRow[];
    expect(reg).toEqual([
      expect.objectContaining({
        id: c.id,
        status: 'issued',
        udin: udin(1),
        templateCode: 'CERT_NET_WORTH',
      }),
    ]);
    const udins = (
      await http()
        .get(`/api/v1/registers/udin?search=${udin(1)}`)
        .set(pa)
        .expect(200)
    ).body as UdinListResponse;
    expect(udins.items).toEqual([
      expect.objectContaining({ udin: udin(1), source: 'certificate', status: 'active' }),
    ]);

    // The same UDIN on another certificate is refused.
    const other = await reviewed({
      templateCode: 'CERT_NET_WORTH',
      purpose: 'Bank',
      addressee: 'The Manager',
      figures: netWorth,
    });
    await act(other, 'sign', { udin: udin(1) }, pa).expect(409);

    // The register does not revoke a certificate's UDIN on its own.
    const entry = udins.items[0]!;
    await http()
      .post(`/api/v1/registers/udin/${entry.id}/revoke`)
      .set(pa)
      .send({ reason: 'Wrong', version: entry.version })
      .expect(409);

    // Revoking needs a reason and the signing partner; the UDIN is revoked with it.
    await act(c, 'revoke', { reason: '  ' }, pa).expect(400);
    await act(c, 'revoke', { reason: 'Issued to the wrong consulate' }, sy).expect(403);
    c = (await act(c, 'revoke', { reason: 'Issued to the wrong consulate' }, pa).expect(200))
      .body as Certificate;
    expect(c).toMatchObject({ status: 'revoked', revokedReason: 'Issued to the wrong consulate' });
    const after = (
      await http()
        .get(`/api/v1/registers/udin?search=${udin(1)}`)
        .set(pa)
        .expect(200)
    ).body as UdinListResponse;
    expect(after.items[0]).toMatchObject({ status: 'revoked' });
    const audit = await su.query<{ action: string }>(
      `SELECT action FROM hsdg.audit_events WHERE object_type = 'certificate' AND object_id = $1
        ORDER BY occurred_at`,
      [c.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'certificate.created',
        'certificate.reviewed',
        'certificate.signed',
        'certificate.issued',
        'certificate.revoked',
      ]),
    );
  });

  it('Form 146 records the Form 145 acknowledgement once signed', async () => {
    let c = await reviewed({
      templateCode: 'CERT_15CB',
      purpose: 'Remittance of the software licence fee',
      addressee: 'HDFC Bank, Connaught Place',
      figures: remittance,
    });
    expect(c).toMatchObject({ formLabel: 'Form 146', templateVersion: 2 });
    expect(c.figures).toMatchObject({ taxable_in_india: 'Yes' });
    await act(c, 'form-15ca', { ackNo: '123456789012345', filedOn: today }, sy).expect(400);
    c = (await act(c, 'sign', { udin: udin(2) }, pa).expect(200)).body as Certificate;
    await act(c, 'form-15ca', { ackNo: 'ab', filedOn: today }, sy).expect(400);
    c = (await act(c, 'form-15ca', { ackNo: '1234 5678 9012 345', filedOn: today }, sy).expect(200))
      .body as Certificate;
    expect(c.form15caAckNo).toBe('123456789012345');
    const reg = (
      await http().get('/api/v1/registers/certificates?template=CERT_15CB').set(pa).expect(200)
    ).body as CertificateRegisterRow[];
    expect(reg.find((r) => r.id === c.id)).toMatchObject({
      formLabel: 'Form 146',
      form15caAckNo: '123456789012345',
      status: 'signed',
    });

    // A net worth certificate has no Form 145.
    const nw = await reviewed({
      templateCode: 'CERT_NET_WORTH',
      purpose: 'Tender',
      addressee: 'The Tender Committee',
      figures: netWorth,
    });
    const signed = (await act(nw, 'sign', { udin: udin(3) }, pa).expect(200)).body as Certificate;
    await act(signed, 'form-15ca', { ackNo: '123456789012345', filedOn: today }, sy).expect(400);
  });
});

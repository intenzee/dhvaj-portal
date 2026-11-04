import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  KYC_RULE,
  type ClientKyc,
  type KycRegisterResponse,
  type KycSettings,
  type RiskTile,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/**
 * PS-404 — client KYC. "Every active client has a KYC status, and the risk
 * dashboard counts clients without one." Tests: the warning and override
 * audit, and the review date calculation.
 */
describe('Client KYC (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: Record<string, string>;
  let pa: Record<string, string>;
  let pb: Record<string, string>;
  let mx: Record<string, string>;
  let sy: Record<string, string>;
  let acme: string;
  let service: string;
  let today: string;
  let oldSettings: { gate: string; high: number; other: number };
  const savedFlags = process.env.FEATURE_FLAGS;
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const kyc = (entity: string) => `/api/v1/entities/${entity}/kyc`;
  let period = 0;
  const assignment = (entity: string, h: Record<string, string>, extra = {}) =>
    http()
      .post('/api/v1/engagements')
      .set(h)
      .send({
        kind: 'assignment',
        entityId: entity,
        serviceId: service,
        status: 'accepted',
        financialYear: '2026-27',
        periodLabel: `KYC${++period}`,
        ...extra,
      });
  const settings = async (patch: Partial<KycSettings>) => {
    const s = (await http().get('/api/v1/client-kyc/settings').set(mp).expect(200))
      .body as KycSettings;
    return (
      await http()
        .patch('/api/v1/client-kyc/settings')
        .set(mp)
        .send({ ...patch, version: s.version })
        .expect(200)
    ).body as KycSettings;
  };
  const allTicked = (k: ClientKyc) => Object.fromEntries(k.checklist.map((i) => [i.code, true]));
  const auditOf = async (id: string) =>
    (
      await su.query<{ action: string; reason: string | null }>(
        `SELECT action, reason FROM hsdg.audit_events
          WHERE object_type = 'engagement' AND object_id = $1 AND action LIKE 'engagement.kyc%'`,
        [id],
      )
    ).rows;

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
    oldSettings = (
      await su.query<{ gate: string; high: number; other: number }>(
        `SELECT kyc_gate AS gate, kyc_review_years_high AS high, kyc_review_years_other AS other
           FROM hsdg.firm_settings LIMIT 1`,
      )
    ).rows[0]!;
    mp = await as('mp@dhvaj.in');
    pa = await as('partner.a@dhvaj.in');
    pb = await as('partner.b@dhvaj.in');
    mx = await as('manager.x@dhvaj.in');
    sy = await as('senior.y@dhvaj.in');
    acme = (await http().get('/api/v1/entities?search=Acme&limit=10').set(pa).expect(200)).body
      .items[0].id as string;
    service = (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.services WHERE code = 'CERTIFICATION'`)
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await su
      ?.query(
        `UPDATE hsdg.firm_settings
            SET kyc_gate = $1, kyc_review_years_high = $2, kyc_review_years_other = $3`,
        [oldSettings?.gate ?? 'warn', oldSettings?.high ?? 1, oldSettings?.other ?? 3],
      )
      .catch(() => undefined);
    await su?.end();
    await app?.close();
    if (savedFlags === undefined) delete process.env.FEATURE_FLAGS;
    else process.env.FEATURE_FLAGS = savedFlags;
  });

  it('a client with nothing on file is pending, with the checklist in force', async () => {
    const entity = await freshClient(acme);
    // Senior Y sees a client only through its engagements (RLS).
    await http().get(kyc(entity)).set(sy).expect(404);
    const k = (await http().get(kyc(entity)).set(mx).expect(200)).body as ClientKyc;
    expect(k).toMatchObject({ status: 'pending', onFile: false, version: 0, riskRating: null });
    expect(k.checklist.map((i) => i.code)).toEqual(
      expect.arrayContaining(['PAN', 'ADDRESS', 'IDENTITY', 'BENEFICIAL_OWNERS']),
    );
    expect(k.checklist.find((i) => i.code === 'PAN')).toMatchObject({
      mandatory: true,
      done: false,
    });
    // Another office's partner cannot see the client, nor its KYC.
    await http().get(kyc(entity)).set(pb).expect(404);
    await http().put(kyc(entity)).set(pb).send({ version: 0, panVerified: true }).expect(404);
  });

  it('completes only with the PAN verified, a rating and the mandatory items; review dates by risk', async () => {
    await settings({ reviewYearsHigh: 1, reviewYearsOther: 3 });
    const entity = await freshClient(acme);
    let k = (await http().get(kyc(entity)).set(mx).expect(200)).body as ClientKyc;
    k = (
      await http()
        .put(kyc(entity))
        .set(mx)
        .send({
          version: 0,
          checklist: { PAN: true },
          beneficialOwners: [
            { name: 'Ravi Kumar', pan: 'abcpk1234f', holdingPercent: '60', role: 'Shareholder' },
          ],
        })
        .expect(200)
    ).body as ClientKyc;
    expect(k).toMatchObject({ onFile: true, version: 1, status: 'pending' });
    expect(k.beneficialOwners[0]).toMatchObject({ pan: 'ABCPK1234F', holdingPercent: '60' });
    // A stale version is refused.
    await http().put(kyc(entity)).set(mx).send({ version: 0, notes: 'x' }).expect(409);
    // An unknown checklist code is refused.
    await http()
      .put(kyc(entity))
      .set(mx)
      .send({ version: 1, checklist: { NOPE: true } })
      .expect(400);

    const missing = await http()
      .post(`${kyc(entity)}/complete`)
      .set(mx)
      .send({ version: 1 })
      .expect(400);
    expect(missing.body.message).toMatch(/Verify the PAN/);
    expect(missing.body.message).toMatch(/Rate the client/);
    expect(missing.body.message).toMatch(/Still to collect/);

    k = (
      await http()
        .put(kyc(entity))
        .set(mx)
        .send({ version: 1, panVerified: true, riskRating: 'medium', checklist: allTicked(k) })
        .expect(200)
    ).body as ClientKyc;
    // A senior on the client's engagement collects the KYC but cannot mark it complete.
    const eng = (await assignment(entity, pa).expect(201)).body.id as string;
    await su.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id)
       SELECT $1, e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id
        WHERE u.email = 'senior.y@dhvaj.in' ON CONFLICT DO NOTHING`,
      [eng],
    );
    expect((await http().get(kyc(entity)).set(sy).expect(200)).body.can).toEqual({
      edit: true,
      complete: false,
    });
    await http()
      .post(`${kyc(entity)}/complete`)
      .set(sy)
      .send({ version: k.version })
      .expect(403);
    k = (
      await http()
        .post(`${kyc(entity)}/complete`)
        .set(mx)
        .send({ version: k.version, reviewedOn: '2024-02-29' })
        .expect(200)
    ).body as ClientKyc;
    // Medium: three years on; 29 February falls back to the 28th.
    expect(k).toMatchObject({ reviewedOn: '2024-02-29', nextReviewOn: '2027-02-28' });
    expect(k.reviewedBy?.name).toBeTruthy();

    // High risk: every year — and changing a complete KYC reopens it.
    k = (
      await http()
        .put(kyc(entity))
        .set(mx)
        .send({ version: k.version, riskRating: 'high' })
        .expect(200)
    ).body as ClientKyc;
    expect(k).toMatchObject({ status: 'pending', reviewedOn: null, nextReviewOn: null });
    k = (
      await http()
        .post(`${kyc(entity)}/complete`)
        .set(pa)
        .send({ version: k.version, reviewedOn: '2026-04-15' })
        .expect(200)
    ).body as ClientKyc;
    expect(k).toMatchObject({ nextReviewOn: '2027-04-15' });

    // The firm setting moves the period.
    await settings({ reviewYearsHigh: 2 });
    k = (
      await http()
        .put(kyc(entity))
        .set(mx)
        .send({ version: k.version, notes: 'Re-checked' })
        .expect(200)
    ).body as ClientKyc;
    k = (
      await http()
        .post(`${kyc(entity)}/complete`)
        .set(mx)
        .send({ version: k.version, reviewedOn: '2026-04-15' })
        .expect(200)
    ).body as ClientKyc;
    expect(k.nextReviewOn).toBe('2028-04-15');
    await settings({ reviewYearsHigh: 1 });
    // A review date in the future is refused.
    await http()
      .post(`${kyc(entity)}/complete`)
      .set(mx)
      .send({ version: k.version, reviewedOn: '2999-01-01' })
      .expect((r) => expect([400, 409]).toContain(r.status));
  });

  it('a complete KYC past its review date is due again', async () => {
    const entity = await freshClient(acme);
    await su.query(
      `INSERT INTO hsdg.client_kyc (entity_id, status, pan_verified, pan_verified_on, risk_rating,
                                    reviewed_on, next_review_on, reviewed_by_employee_id)
       SELECT $1, 'complete', true, DATE '2023-01-10', 'low', DATE '2023-01-10', $2::date - 5,
              (SELECT id FROM hsdg.employees WHERE employee_code = 'EMP003')`,
      [entity, today],
    );
    const k = (await http().get(kyc(entity)).set(pa).expect(200)).body as ClientKyc;
    expect(k.status).toBe('expired');
  });

  it('warns on a new engagement (audited); when required, a partner overrides with a reason', async () => {
    await settings({ gate: 'warn' });
    const entity = await freshClient(acme);
    const warned = await assignment(entity, pa).expect(201);
    expect(await auditOf(warned.body.id)).toEqual([
      expect.objectContaining({ action: 'engagement.kyc_pending' }),
    ]);

    await settings({ gate: 'require' });
    // Required: refused without a reason …
    const refused = await assignment(entity, pa).expect(409);
    expect(refused.body).toMatchObject({ rule: KYC_RULE, kycStatus: 'pending' });
    // … a manager cannot override, reason or not …
    await assignment(entity, mx, {
      status: 'pending_acceptance',
      engagementPartnerEmployeeId: undefined,
      kycOverrideReason: 'Urgent',
    }).expect(409);
    // … a partner can, and the reason is audited.
    const over = await assignment(entity, pa, {
      kycOverrideReason: 'Client onboarding documents promised by Friday',
    }).expect(201);
    expect(await auditOf(over.body.id)).toEqual([
      expect.objectContaining({
        action: 'engagement.kyc_override',
        reason: 'Client onboarding documents promised by Friday',
      }),
    ]);

    // Once complete, no check and no audit.
    let k = (await http().get(kyc(entity)).set(mx).expect(200)).body as ClientKyc;
    k = (
      await http()
        .put(kyc(entity))
        .set(mx)
        .send({ version: k.version, panVerified: true, riskRating: 'low', checklist: allTicked(k) })
        .expect(200)
    ).body as ClientKyc;
    await http()
      .post(`${kyc(entity)}/complete`)
      .set(mx)
      .send({ version: k.version })
      .expect(200);
    const clean = await assignment(entity, pa).expect(201);
    expect(await auditOf(clean.body.id)).toEqual([]);

    // Statutory audit has its own acceptance: the KYC gate does not apply (not tested here
    // for want of an audit fixture); 'off' switches the check off.
    await settings({ gate: 'off' });
    const other = await freshClient(acme);
    const off = await assignment(other, pa).expect(201);
    expect(await auditOf(off.body.id)).toEqual([]);
    await settings({ gate: 'warn' });
  });

  it('only the managing partner or admin sets the rules', async () => {
    const s = (await http().get('/api/v1/client-kyc/settings').set(pa).expect(200))
      .body as KycSettings;
    await http()
      .patch('/api/v1/client-kyc/settings')
      .set(pa)
      .send({ gate: 'off', version: s.version })
      .expect(403);
    await http()
      .patch('/api/v1/client-kyc/settings')
      .set(mp)
      .send({ reviewYearsOther: 11, version: s.version })
      .expect(400);
  });

  it('the register and the risk tile count active clients without a complete KYC', async () => {
    const pending = await freshClient(acme);
    const reg = (await http().get('/api/v1/client-kyc?status=open&limit=500').set(mp).expect(200))
      .body as KycRegisterResponse;
    expect(reg.items.some((r) => r.entityId === pending)).toBe(true);
    expect(reg.items.every((r) => r.status !== 'complete')).toBe(true);
    expect(reg.counts.pending + reg.counts.expired).toBe(reg.total);
    const all = (await http().get('/api/v1/client-kyc?limit=1').set(mp).expect(200))
      .body as KycRegisterResponse;
    expect(all.total).toBe(all.counts.pending + all.counts.expired + all.counts.complete);
    // Partner B's office does not have this client.
    const theirs = (
      await http().get('/api/v1/client-kyc?status=open&limit=500').set(pb).expect(200)
    ).body as KycRegisterResponse;
    expect(theirs.items.some((r) => r.entityId === pending)).toBe(false);

    const tile = (await http().get('/api/v1/dashboard/risk/kyc?limit=5').set(mp).expect(200))
      .body as RiskTile;
    expect(tile).toMatchObject({ key: 'kyc', available: true, count: reg.total });
    expect(tile.items[0]?.href).toMatch(/^\/entities\//);
  });
});

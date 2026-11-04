import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  RegisterRiskTile,
  TaxAuditRow,
  UdinEntry,
  UdinListResponse,
  UdinPendingResponse,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';
import { FeatureFlagsService } from '../src/common/feature-flags/feature-flags.service';
import { DatabaseService } from '../src/database/database.service';
import { udinOverdue } from '../src/modules/registers/register-risk';

/**
 * PS-304 — the UDIN register. "Every attest report and certificate needs a
 * UDIN, generated within ICAI's time limit. Peer review checks the register."
 * Done when a report signed without a UDIN shows up, the partner is nudged
 * before the window ends, and the archive's UDINs are in the register.
 */
describe('UDIN register (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: Record<string, string>;
  let pa: Record<string, string>;
  let sy: Record<string, string>;
  let acct: Record<string, string>;
  let partnerA: string;
  let oldMembership: string | null;
  let today: string;
  /** Signed with its UDIN on the tax audit (write-through). */
  let engSigned: string;
  let auditSigned: string;
  /** Signed 55 days ago without one (window closing). */
  let engClosing: string;
  let auditClosing: string;
  let entityClosing: string;
  /** Signed 70 days ago without one (window closed). */
  let engClosed: string;
  let auditClosed: string;
  let entityClosed: string;
  const FY = '2025-26';
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const daysAgo = (n: number) =>
    su
      .query<{ d: string }>(`SELECT ($1::date - $2::int)::text AS d`, [today, n])
      .then((r) => r.rows[0]!.d);
  const list = async (h: Record<string, string>, q = '') =>
    (await http().get(`/api/v1/registers/udin${q}`).set(h).expect(200)).body as UdinListResponse;
  const pending = async (view = 'all') =>
    (await http().get(`/api/v1/registers/udin/pending?view=${view}`).set(pa).expect(200))
      .body as UdinPendingResponse;

  /** A tax audit engagement on a fresh client; its FY row, signed by Partner A `daysAgo` ago. */
  const signedAudit = async (
    acme: string,
    signedDaysAgo: number,
    udin: string | null,
  ): Promise<{ eng: string; audit: string; entity: string }> => {
    const entity = await freshClient(acme);
    await su.query(`UPDATE hsdg.entities SET annual_turnover = 25000000 WHERE id = $1`, [entity]);
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: entity,
          status: 'accepted',
          financialYear: FY,
          streams: ['income_tax', 'tax_audit'],
          years: [{ financialYear: FY }],
        })
        .expect(201)
    ).body.id as string;
    const rows = (await http().get(`/api/v1/engagements/${eng}/tax-audits`).set(pa).expect(200))
      .body as TaxAuditRow[];
    const audit = rows.find((r) => r.financialYear === FY)!.id;
    await su.query(
      `UPDATE hsdg.tax_audits
          SET signing_partner_id = $2, signed_by_employee_id = $2,
              signed_at = (($3::date)::timestamp + interval '11 hours') AT TIME ZONE 'Asia/Kolkata',
              udin = $4
        WHERE id = $1`,
      [audit, partnerA, await daysAgo(signedDaysAgo), udin],
    );
    return { eng, audit, entity };
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
    mp = await as('mp@dhvaj.in');
    pa = await as('partner.a@dhvaj.in');
    sy = await as('senior.y@dhvaj.in');
    acct = await as('accounts@dhvaj.in');
    partnerA = (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = 'EMP003'`)
    ).rows[0]!.id;
    oldMembership = (
      await su.query<{ m: string | null }>(
        `SELECT membership_no AS m FROM hsdg.partner_profiles WHERE employee_id = $1`,
        [partnerA],
      )
    ).rows[0]!.m;
    await su.query(
      `UPDATE hsdg.partner_profiles
          SET membership_no = '123456', cop_no = COALESCE(cop_no, 'COP-A'),
              cop_valid_until = GREATEST(COALESCE(cop_valid_until, DATE '2099-03-31'), DATE '2099-03-31')
        WHERE employee_id = $1`,
      [partnerA],
    );

    const acme = (await http().get('/api/v1/entities?search=Acme&limit=10').set(pa).expect(200))
      .body.items[0].id as string;
    ({ eng: engSigned, audit: auditSigned } = await signedAudit(acme, 20, '26123456ABCDEF1234'));
    ({
      eng: engClosing,
      audit: auditClosing,
      entity: entityClosing,
    } = await signedAudit(acme, 55, null));
    ({
      eng: engClosed,
      audit: auditClosed,
      entity: entityClosed,
    } = await signedAudit(acme, 70, null));
  });

  afterAll(async () => {
    await su
      ?.query(`UPDATE hsdg.partner_profiles SET membership_no = $2 WHERE employee_id = $1`, [
        partnerA,
        oldMembership,
      ])
      .catch(() => undefined);
    await su?.end();
    await app?.close();
  });

  it("a tax audit's UDIN is written through to the register", async () => {
    const r = await list(pa, '?search=26123456ABCDEF1234');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      udin: '26123456ABCDEF1234',
      documentKind: 'tax_audit',
      source: 'tax_audit',
      status: 'active',
      engagementId: engSigned,
      signingPartnerId: partnerA,
      membershipNo: '123456',
      financialYear: FY,
      late: false,
      link: { udinId: r.items[0]!.id },
    });
    expect(r.windowDays).toBe(60);
    expect(r.canManage).toBe(true);
    // Writing it again (a re-save of the audit) adds nothing.
    await su.query(`UPDATE hsdg.tax_audits SET udin = udin WHERE id = $1`, [auditSigned]);
    expect((await list(pa, '?search=26123456ABCDEF1234')).total).toBe(1);
  });

  it('lists the reports signed without one against the window, closed ones as overdue', async () => {
    const all = await pending();
    const mine = all.items.filter((i) => [auditClosing, auditClosed].includes(i.sourceId));
    expect(mine.map((i) => [i.sourceId, i.daysLeft, i.overdue])).toEqual([
      [auditClosed, -10, true],
      [auditClosing, 5, false],
    ]);
    expect(all.items.some((i) => i.sourceId === auditSigned)).toBe(false);
    const overdue = await pending('overdue');
    expect(overdue.items.map((i) => i.sourceId)).toContain(auditClosed);
    expect(overdue.items.map((i) => i.sourceId)).not.toContain(auditClosing);
  });

  it('the risk tile counts the overdue ones (PS-301)', async () => {
    const { rows } = await su.query<{ user_id: string; employee_id: string; office_id: string }>(
      `SELECT u.id AS user_id, emp.id AS employee_id, u.primary_office_id AS office_id
         FROM hsdg.users u JOIN hsdg.employees emp ON emp.user_id = u.id
        WHERE u.email = 'mp@dhvaj.in'`,
    );
    const ctx = {
      userId: rows[0]!.user_id,
      role: 'managing_partner',
      roles: ['managing_partner'],
      employeeId: rows[0]!.employee_id,
      officeId: rows[0]!.office_id,
    };
    const tile: RegisterRiskTile = await app
      .get(DatabaseService)
      .withRlsContext(ctx, (client) => udinOverdue(client, ctx, { today, limit: 50 }));
    expect(tile.href).toBe('/registers/udin?view=overdue');
    const item = tile.items.find((i) => i.ref.engagementId === engClosed);
    expect(item).toMatchObject({ dueOn: await daysAgo(10) });
    expect(item!.detail).toMatch(/no UDIN, window closed/);
    expect(tile.items.some((i) => i.ref.engagementId === engClosing)).toBe(false);
    expect(tile.count).toBeGreaterThanOrEqual(1);
  });

  it('nudges the signing partner a week before the window ends, once', async () => {
    await http().post('/api/v1/notifications/scan').set(mp).expect(201);
    await http().post('/api/v1/notifications/scan').set(mp).expect(201);
    const { rows } = await su.query<{ object_id: string; status: string; recipient: string }>(
      `SELECT n.object_id, n.status, emp.id AS recipient
         FROM hsdg.notifications n
         JOIN hsdg.employees emp ON emp.user_id = n.recipient_user_id
        WHERE n.type = 'udin_window_closing' AND n.engagement_id = ANY($1::uuid[])`,
      [[engClosing, engClosed, engSigned]],
    );
    expect(rows).toEqual([{ object_id: auditClosing, status: 'unread', recipient: partnerA }]);
  });

  it('refuses a malformed UDIN, one of another member, and a duplicate', async () => {
    const base = {
      documentKind: 'certificate',
      entityId: entityClosing,
      signingPartnerId: partnerA,
      signedOn: await daysAgo(3),
      generatedOn: await daysAgo(2),
    };
    const bad = await http()
      .post('/api/v1/registers/udin')
      .set(pa)
      .send({ ...base, udin: '26123456ABC' })
      .expect(400);
    expect(bad.body.message).toMatch(/18 characters/);
    const other = await http()
      .post('/api/v1/registers/udin')
      .set(pa)
      .send({ ...base, udin: '26654321ABCDEF1234' })
      .expect(400);
    expect(other.body.message).toMatch(/membership no\. 654321.*123456/);
    const late = await http()
      .post('/api/v1/registers/udin')
      .set(pa)
      .send({ ...base, udin: '26123456CERT000001', generatedOn: await daysAgo(4) })
      .expect(400);
    expect(late.body.message).toMatch(/on or after/);
    const dup = await http()
      .post('/api/v1/registers/udin')
      .set(pa)
      .send({ ...base, udin: '26123456abcdef1234' })
      .expect(409);
    expect(dup.body.message).toMatch(/already in the register/);
  });

  it("adding the report's UDIN takes it off the list and clears the nudge", async () => {
    const e = (
      await http()
        .post('/api/v1/registers/udin')
        .set(pa)
        .send({
          udin: '26123456CLOSE00001',
          documentKind: 'tax_audit',
          entityId: entityClosing,
          engagementId: engClosing,
          signingPartnerId: partnerA,
          signedOn: await daysAgo(55),
          generatedOn: today,
          financialYear: FY,
        })
        .expect(201)
    ).body as UdinEntry;
    expect(e).toMatchObject({ source: 'manual', status: 'active', late: false, version: 1 });
    expect((await pending()).items.some((i) => i.sourceId === auditClosing)).toBe(false);
    const { rows } = await su.query<{ status: string }>(
      `SELECT status FROM hsdg.notifications WHERE type = 'udin_window_closing' AND object_id = $1`,
      [auditClosing],
    );
    expect(rows.map((r) => r.status)).toEqual(['read']);
    const { rows: audit } = await su.query(
      `SELECT action FROM hsdg.audit_events WHERE object_type = 'udin_register' AND object_id = $1`,
      [e.id],
    );
    expect(audit.map((a) => a.action)).toEqual(['udin.registered']);
  });

  it('a UDIN generated after the window is marked late; the engagement must be the client’s', async () => {
    const body = {
      udin: '26123456CLOSED0001',
      documentKind: 'tax_audit',
      entityId: entityClosing,
      engagementId: engClosed,
      signingPartnerId: partnerA,
      signedOn: await daysAgo(70),
      generatedOn: today,
      financialYear: FY,
    };
    const wrong = await http().post('/api/v1/registers/udin').set(pa).send(body).expect(403);
    expect(wrong.body.message).toMatch(/one of their engagements/);
    const e = (
      await http()
        .post('/api/v1/registers/udin')
        .set(pa)
        .send({ ...body, entityId: entityClosed })
        .expect(201)
    ).body as UdinEntry;
    expect(e.late).toBe(true);
  });

  it('revokes only with a reason and the version read; the UDIN stays', async () => {
    const [e] = (await list(pa, '?search=26123456CLOSE00001')).items;
    await http()
      .post(`/api/v1/registers/udin/${e!.id}/revoke`)
      .set(pa)
      .send({ reason: '  ', version: e!.version })
      .expect(400);
    await http()
      .post(`/api/v1/registers/udin/${e!.id}/revoke`)
      .set(pa)
      .send({ reason: 'Wrong year', version: e!.version + 1 })
      .expect(409);
    const r = (
      await http()
        .post(`/api/v1/registers/udin/${e!.id}/revoke`)
        .set(pa)
        .send({ reason: 'Generated against the wrong year.', version: e!.version })
        .expect(200)
    ).body as UdinEntry;
    expect(r).toMatchObject({
      status: 'revoked',
      revokedReason: 'Generated against the wrong year.',
    });
    await http()
      .post(`/api/v1/registers/udin/${e!.id}/revoke`)
      .set(pa)
      .send({ reason: 'Again', version: r.version })
      .expect(409);
    expect((await list(pa, '?status=revoked')).items.map((i) => i.id)).toContain(e!.id);
    // A revoked UDIN no longer counts: the report is back on the list.
    expect((await pending()).items.some((i) => i.sourceId === auditClosing)).toBe(true);
  });

  it('exports the register as CSV', async () => {
    const res = await http()
      .get('/api/v1/registers/udin/csv?documentKind=tax_audit')
      .set(pa)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const text = res.text as string;
    expect(text.split('\r\n')[0]).toMatch(/^UDIN,Document,Client/);
    expect(text).toContain('26123456ABCDEF1234');
    expect(text).toContain('Generated against the wrong year.');
  });

  it('a senior reads it; only register keepers add; the accountant keeps it', async () => {
    const r = await list(sy);
    expect(r.canManage).toBe(false);
    await http()
      .post('/api/v1/registers/udin')
      .set(sy)
      .send({
        udin: '26123456SENIOR0001',
        documentKind: 'certificate',
        entityId: entityClosing,
        signingPartnerId: partnerA,
        signedOn: today,
        generatedOn: today,
      })
      .expect(403);
    expect((await list(acct)).canManage).toBe(true);
    const partners = (await http().get('/api/v1/registers/udin/partners').set(pa).expect(200))
      .body as Array<{ employeeId: string; membershipNo: string | null }>;
    expect(partners.find((p) => p.employeeId === partnerA)?.membershipNo).toBe('123456');
  });

  it('is behind ff_registers: 404 when the firm has it off', async () => {
    const flags = app.get(FeatureFlagsService);
    flags.setRules(new Map([['ff_registers', { mode: 'off', officeCodes: new Set<string>() }]]));
    try {
      await http().get('/api/v1/registers/udin').set(pa).expect(404);
      await http().get('/api/v1/registers/udin/pending').set(pa).expect(404);
    } finally {
      flags.setRules(new Map());
    }
  });
});

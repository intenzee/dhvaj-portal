import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import type { DscListResponse, DscTokenDetail, RegisterRiskTile } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';
import { FeatureFlagsService } from '../src/common/feature-flags/feature-flags.service';
import { DatabaseService } from '../src/database/database.service';
import { dscAtRisk } from '../src/modules/registers/register-risk';

/**
 * PS-305 — the DSC register and custody. "Every token the office holds, when
 * it expires and who has it. The PIN is kept in the logins vault, never in the
 * register." Done when a token checked out and not back nudges, an expiring
 * one nudges at 30 and 7 days, and the PIN is revealed only through the vault.
 */
describe('DSC register (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: Record<string, string>;
  let sy: Record<string, string>;
  let acct: Record<string, string>;
  let mpEmployee: string;
  let entity: string;
  let today: string;
  let soon: DscTokenDetail;
  let later: DscTokenDetail;
  const PIN = 'pin-4471-e2e';
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const plus = (n: number) =>
    su
      .query<{ d: string }>(`SELECT ($1::date + $2::int)::text AS d`, [today, n])
      .then((r) => r.rows[0]!.d);
  const list = async (h: Record<string, string>, q = '') =>
    (await http().get(`/api/v1/registers/dsc${q}`).set(h).expect(200)).body as DscListResponse;
  const one = async (h: Record<string, string>, id: string) =>
    (await http().get(`/api/v1/registers/dsc/${id}`).set(h).expect(200)).body as DscTokenDetail;
  const nudges = (type: string, id: string) =>
    su
      .query<{ status: string; recipient: string; dedup_key: string }>(
        `SELECT n.status, emp.id AS recipient, n.dedup_key
           FROM hsdg.notifications n JOIN hsdg.employees emp ON emp.user_id = n.recipient_user_id
          WHERE n.type = $1 AND n.object_id = $2 ORDER BY n.created_at`,
        [type, id],
      )
      .then((r) => r.rows);

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
    sy = await as('senior.y@dhvaj.in');
    acct = await as('accounts@dhvaj.in');
    mpEmployee = (
      await su.query<{ id: string }>(
        `SELECT emp.id FROM hsdg.employees emp JOIN hsdg.users u ON u.id = emp.user_id
          WHERE u.email = 'mp@dhvaj.in'`,
      )
    ).rows[0]!.id;
    const acme = (await http().get('/api/v1/entities?search=Acme&limit=10').set(mp).expect(200))
      .body.items[0].id as string;
    entity = await freshClient(acme);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('adds tokens; the PIN goes to the vault, not the register', async () => {
    soon = (
      await http()
        .post('/api/v1/registers/dsc')
        .set(mp)
        .send({
          holderName: 'Ravi Mehta',
          holderPan: 'abcpm1234k',
          din: '09876543',
          entityId: entity,
          validFrom: await plus(-700),
          validTo: await plus(5),
          tokenSerial: 'EPASS-1',
          location: 'Cabinet 2',
          pin: PIN,
        })
        .expect(201)
    ).body as DscTokenDetail;
    expect(soon).toMatchObject({
      holderName: 'Ravi Mehta',
      holderPan: 'ABCPM1234K',
      status: 'active',
      inOffice: true,
      hasPin: true,
      canPin: true,
      daysToExpiry: 5,
      version: 1,
      link: { dscId: soon.id },
    });
    later = (
      await http()
        .post('/api/v1/registers/dsc')
        .set(mp)
        .send({ holderName: 'Sita Rao', entityId: entity, validTo: await plus(400) })
        .expect(201)
    ).body as DscTokenDetail;
    expect(later.hasPin).toBe(false);

    const { rows } = await su.query<{ portal: string; account: string; username_hint: string }>(
      `SELECT portal, account, username_hint FROM hsdg.client_credentials WHERE dsc_token_id = $1`,
      [soon.id],
    );
    expect(rows).toEqual([{ portal: 'dsc', account: 'main', username_hint: expect.any(String) }]);
    const raw = await su.query(
      `SELECT row_to_json(t)::text AS j FROM hsdg.dsc_tokens t WHERE id = $1`,
      [soon.id],
    );
    expect(raw.rows[0].j).not.toContain(PIN);
  });

  it('lists by view and search; the expiring one is at risk', async () => {
    const atRisk = await list(mp, '?view=at_risk&limit=500');
    expect(atRisk.items.some((t) => t.id === soon.id)).toBe(true);
    expect(atRisk.items.some((t) => t.id === later.id)).toBe(false);
    const found = await list(mp, '?search=EPASS-1');
    expect(found.items.map((t) => t.id)).toEqual([soon.id]);
    expect(found.canManage).toBe(true);
    expect((await list(mp, `?id=${later.id}`)).items.map((t) => t.id)).toEqual([later.id]);
  });

  it('keeps the PIN out of the logins list and the Client Master export', async () => {
    const creds = (await http().get(`/api/v1/credentials?entityId=${entity}`).set(mp).expect(200))
      .body;
    expect(JSON.stringify(creds)).not.toMatch(/"dsc"/);
    const file = (
      await http()
        .get('/api/v1/client-imports/master/export?passwords=true')
        .set(mp)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200)
    ).body as Buffer;
    const wb = XLSX.read(file, { type: 'buffer' });
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name]!;
      for (const ref of Object.keys(ws)) {
        if (ref.startsWith('!')) continue;
        expect(String((ws[ref] as XLSX.CellObject).v ?? '')).not.toContain(PIN);
      }
    }
    // Nor can it be removed from the logins screen.
    const credId = (
      await su.query<{ id: string }>(
        `SELECT id FROM hsdg.client_credentials WHERE dsc_token_id = $1`,
        [soon.id],
      )
    ).rows[0]!.id;
    const del = await http().delete(`/api/v1/credentials/${credId}`).set(mp).expect(400);
    expect(del.body.message).toMatch(/DSC register/);
  });

  it('reveals the PIN only through the vault, and logs it', async () => {
    const shown = (
      await http().post(`/api/v1/registers/dsc/${soon.id}/pin/reveal`).set(mp).expect(200)
    ).body;
    expect(shown).toEqual({ pin: PIN, showSeconds: expect.any(Number) });
    const { rows } = await su.query(
      `SELECT l.role FROM hsdg.credential_access_log l
         JOIN hsdg.client_credentials c ON c.id = l.credential_id
        WHERE c.dsc_token_id = $1`,
      [soon.id],
    );
    expect(rows.length).toBe(1);
    // No PIN kept → 404 with who can see it.
    const none = await http()
      .post(`/api/v1/registers/dsc/${later.id}/pin/reveal`)
      .set(mp)
      .expect(404);
    expect(none.body.message).toMatch(/No PIN is kept/);
    // The accountant keeps the register but not the vault.
    await http().post(`/api/v1/registers/dsc/${soon.id}/pin/reveal`).set(acct).expect(403);
    const acctPin = await http()
      .post('/api/v1/registers/dsc')
      .set(acct)
      .send({ holderName: 'Desk token', validTo: await plus(200), pin: '1111' })
      .expect(403);
    expect(acctPin.body.message).toMatch(/partner or manager/);
    const acctView = await one(acct, soon.id).catch(() => null);
    if (acctView) expect(acctView.canPin).toBe(false);
  });

  it('checks a token out and in, with the movements; a stale version is refused', async () => {
    const out = (
      await http()
        .post(`/api/v1/registers/dsc/${soon.id}/check-out`)
        .set(mp)
        .send({
          version: soon.version,
          withName: 'Mr Mehta (director)',
          purpose: 'Sign the AOC-4',
          expectedBackOn: today,
        })
        .expect(200)
    ).body as DscTokenDetail;
    expect(out).toMatchObject({ inOffice: false, outWithName: 'Mr Mehta (director)' });
    expect(out.expectedBackAt).toBeTruthy();
    const again = await http()
      .post(`/api/v1/registers/dsc/${soon.id}/check-out`)
      .set(mp)
      .send({ version: out.version, withName: 'X', purpose: 'Y', expectedBackOn: today })
      .expect(409);
    expect(again.body.message).toMatch(/already out/);
    const stale = await http()
      .post(`/api/v1/registers/dsc/${soon.id}/check-in`)
      .set(mp)
      .send({ version: soon.version })
      .expect(409);
    expect(stale.body.message).toMatch(/Reload/);
    expect((await list(mp, '?view=out&limit=500')).items.some((t) => t.id === soon.id)).toBe(true);
    soon = out;
  });

  it('nudges when the token is not back, and at the expiry band, once each', async () => {
    // It was due back yesterday.
    await su.query(
      `UPDATE hsdg.dsc_tokens SET expected_back_at = now() - interval '1 day' WHERE id = $1`,
      [soon.id],
    );
    await http().post('/api/v1/notifications/scan').set(mp).expect(201);
    await http().post('/api/v1/notifications/scan').set(mp).expect(201);
    expect(await nudges('dsc_overdue_return', soon.id)).toEqual([
      {
        status: 'unread',
        recipient: mpEmployee,
        dedup_key: expect.stringMatching(/^dsc_overdue_return:/),
      },
    ]);
    expect(await nudges('dsc_expiring', soon.id)).toEqual([
      { status: 'unread', recipient: mpEmployee, dedup_key: expect.stringMatching(/:7$/) },
    ]);
    expect(await nudges('dsc_expiring', later.id)).toEqual([]);

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
      .withRlsContext(ctx, (client) => dscAtRisk(client, ctx, { today, limit: 500 }));
    expect(tile.href).toBe('/registers/dsc?view=at_risk');
    const item = tile.items.find((i) => i.ref.dscId === soon.id);
    expect(item?.detail).toMatch(/Expires .*; out with Mr Mehta \(director\), due back/);
    expect(tile.items.some((i) => i.ref.dscId === later.id)).toBe(false);
  });

  it('checking it in resolves the "not back" nudge; renewing resolves the expiry one', async () => {
    const back = (
      await http()
        .post(`/api/v1/registers/dsc/${soon.id}/check-in`)
        .set(mp)
        .send({ version: (await one(mp, soon.id)).version, location: 'Cabinet 3' })
        .expect(200)
    ).body as DscTokenDetail;
    expect(back).toMatchObject({ inOffice: true, location: 'Cabinet 3', outWithName: null });
    expect(back.movements.map((m) => m.kind)).toEqual(['in', 'out']);
    expect((await nudges('dsc_overdue_return', soon.id)).map((n) => n.status)).toEqual(['read']);

    const renewed = (
      await http()
        .patch(`/api/v1/registers/dsc/${soon.id}`)
        .set(mp)
        .send({ version: back.version, validTo: await plus(730) })
        .expect(200)
    ).body as DscTokenDetail;
    expect(renewed.daysToExpiry).toBe(730);
    expect((await nudges('dsc_expiring', soon.id)).map((n) => n.status)).toEqual(['read']);
  });

  it('a senior checks their office’s tokens out and in but cannot add or edit one', async () => {
    const office = (
      await su.query<{ id: string }>(
        `SELECT primary_office_id AS id FROM hsdg.users WHERE email = 'senior.y@dhvaj.in'`,
      )
    ).rows[0]!.id;
    const created = (
      await http()
        .post('/api/v1/registers/dsc')
        .set(mp)
        .send({ holderName: 'Office token', officeId: office, validTo: await plus(300) })
        .expect(201)
    ).body as DscTokenDetail;
    const t = await one(sy, created.id);
    expect(t.canPin).toBe(false);
    expect((await list(sy)).canManage).toBe(false);
    const out = await http()
      .post(`/api/v1/registers/dsc/${t.id}/check-out`)
      .set(sy)
      .send({
        version: t.version,
        withName: 'Courier',
        purpose: 'MCA filing',
        expectedBackOn: today,
      })
      .expect(200);
    await http()
      .post(`/api/v1/registers/dsc/${t.id}/check-in`)
      .set(sy)
      .send({ version: out.body.version })
      .expect(200);
    await http()
      .patch(`/api/v1/registers/dsc/${t.id}`)
      .set(sy)
      .send({ version: 3, notes: 'x' })
      .expect(403);
    await http()
      .post('/api/v1/registers/dsc')
      .set(sy)
      .send({ holderName: 'Nope', validTo: await plus(10) })
      .expect(403);
    await http()
      .post(`/api/v1/registers/dsc/${later.id}/release`)
      .set(sy)
      .send({ version: 1, status: 'lost', reason: 'x' })
      .expect(403);
  });

  it('returned to the holder: leaves the register, and its PIN leaves the vault', async () => {
    const cur = await one(mp, soon.id);
    const gone = (
      await http()
        .post(`/api/v1/registers/dsc/${soon.id}/release`)
        .set(mp)
        .send({ version: cur.version, status: 'returned_to_holder', reason: 'Director resigned' })
        .expect(200)
    ).body as DscTokenDetail;
    expect(gone).toMatchObject({
      status: 'returned_to_holder',
      statusReason: 'Director resigned',
      inOffice: false,
      outWithName: 'Ravi Mehta',
      hasPin: false,
    });
    expect((await list(mp, '?view=gone&limit=500')).items.some((t) => t.id === soon.id)).toBe(true);
    expect((await list(mp, '?limit=500')).items.some((t) => t.id === soon.id)).toBe(false);
    await http()
      .post(`/api/v1/registers/dsc/${soon.id}/check-out`)
      .set(mp)
      .send({ version: gone.version, withName: 'X', purpose: 'Y', expectedBackOn: today })
      .expect(409);
    const { rows } = await su.query(
      `SELECT action FROM hsdg.audit_events WHERE object_type = 'dsc_token' AND object_id = $1
        ORDER BY occurred_at, id`,
      [soon.id],
    );
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'dsc.added',
        'dsc.checked_out',
        'dsc.checked_in',
        'dsc.updated',
        'dsc.returned',
        'dsc.returned_to_holder',
      ]),
    );
  });

  it('refuses a bad PAN, a bad DIN, and a token valid after it expires', async () => {
    const base = { holderName: 'Bad', validTo: await plus(10) };
    await http()
      .post('/api/v1/registers/dsc')
      .set(mp)
      .send({ ...base, holderPan: 'ABC' })
      .expect(400);
    await http()
      .post('/api/v1/registers/dsc')
      .set(mp)
      .send({ ...base, din: '12' })
      .expect(400);
    const order = await http()
      .post('/api/v1/registers/dsc')
      .set(mp)
      .send({ ...base, validFrom: await plus(20) })
      .expect(400);
    expect(order.body.message).toMatch(/on or before its expiry/);
  });

  it('is behind ff_registers: 404 when the firm has it off', async () => {
    const flags = app.get(FeatureFlagsService);
    flags.setRules(new Map([['ff_registers', { mode: 'off', officeCodes: new Set<string>() }]]));
    try {
      await http().get('/api/v1/registers/dsc').set(mp).expect(404);
      await http().post(`/api/v1/registers/dsc/${later.id}/pin/reveal`).set(mp).expect(404);
    } finally {
      flags.setRules(new Map());
    }
  });
});

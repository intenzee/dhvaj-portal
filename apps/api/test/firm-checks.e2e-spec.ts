import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { STRICT_FIRM_CHECKS, type WorkflowSettings } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * The firm's checks (Admin → Workflow → Checks): everyone reads them; only the
 * managing partner or the administrator switches them, with a lock and an
 * audit row, and the database refuses anyone else. hsdg.firm_check answers
 * for SQL under any role. The checks are put back on for the suites after.
 */
describe("The firm's checks (e2e)", () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let admin: string;
  let pa: string;
  let mx: string;
  let sy: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const settings = async (t: string): Promise<WorkflowSettings> =>
    (await http().get('/api/v1/workflow-settings').set(bearer(t)).expect(200))
      .body as WorkflowSettings;
  const patch = (t: string, body: object) =>
    http().patch('/api/v1/workflow-settings/checks').set(bearer(t)).send(body);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    admin = await token('admin@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
  });

  afterAll(async () => {
    await su?.query(`UPDATE hsdg.firm_settings SET strict_checks = $1::jsonb`, [
      JSON.stringify(STRICT_FIRM_CHECKS),
    ]);
    await su?.end();
    await app?.close();
  });

  it('everyone reads the checks; only the managing partner and the administrator may switch them', async () => {
    const seen = await settings(sy);
    expect(seen.checks).toEqual(STRICT_FIRM_CHECKS);
    expect(seen.checksEditable).toBe(false);
    expect((await settings(pa)).checksEditable).toBe(false);
    expect((await settings(mp)).checksEditable).toBe(true);
    expect((await settings(admin)).checksEditable).toBe(true);

    const off = { version: seen.version, checks: { review_required: false } };
    await patch(sy, off).expect(403);
    await patch(mx, off).expect(403);
    await patch(pa, off).expect(403);
    await patch(mp, { version: seen.version, checks: { no_such_check: false } }).expect(400);
    await patch(mp, { version: seen.version, checks: { review_required: 'no' } }).expect(400);
    await patch(mp, { version: seen.version, checks: {} }).expect(400);

    const after = (await patch(mp, off).expect(200)).body as WorkflowSettings;
    expect(after.checks).toEqual({ ...STRICT_FIRM_CHECKS, review_required: false });
    expect(after).toMatchObject({ version: seen.version + 1, updatedByName: 'Managing Partner' });
    // The version read is stale now.
    await patch(admin, { version: seen.version, checks: { review_required: true } }).expect(409);

    const audit = await su.query<{ before_state: unknown; after_state: unknown }>(
      `SELECT before_state, after_state FROM hsdg.audit_events
        WHERE action = 'workflow_settings.checks_updated' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toEqual({
      before_state: { review_required: true },
      after_state: { review_required: false },
    });

    // The administrator switches everything off; only checks that are on are stored.
    const allOff = Object.fromEntries(Object.keys(STRICT_FIRM_CHECKS).map((k) => [k, false]));
    const relaxed = (await patch(admin, { version: after.version, checks: allOff }).expect(200))
      .body as WorkflowSettings;
    expect(Object.values(relaxed.checks).every((on) => on === false)).toBe(true);
    const stored = await su.query<{ s: unknown }>(
      `SELECT strict_checks AS s FROM hsdg.firm_settings`,
    );
    expect(stored.rows[0]!.s).toEqual({});
  });

  it('hsdg.firm_check answers under the app role, and the database refuses a partner', async () => {
    await su.query(`UPDATE hsdg.firm_settings SET strict_checks = '{"task_blockers": true}'`);
    await su.query('BEGIN');
    try {
      await su.query('SET LOCAL ROLE hsdg_app');
      const { rows } = await su.query<{ on: boolean; off: boolean; unknown: boolean }>(
        `SELECT hsdg.firm_check('task_blockers') AS on, hsdg.firm_check('review_required') AS off,
                hsdg.firm_check('no_such_check') AS unknown`,
      );
      expect(rows[0]).toEqual({ on: true, off: false, unknown: false });

      await su.query(`SELECT set_config('hsdg.role', 'partner', true)`);
      await su.query('SAVEPOINT partner');
      await expect(
        su.query(`UPDATE hsdg.firm_settings SET strict_checks = '{}'`),
      ).rejects.toMatchObject({ code: '42501' });
      await su.query('ROLLBACK TO SAVEPOINT partner');

      await su.query(`SELECT set_config('hsdg.role', 'managing_partner', true)`);
      await su.query(`UPDATE hsdg.firm_settings SET strict_checks = '{}'`);
      const after = await su.query<{ on: boolean }>(
        `SELECT hsdg.firm_check('task_blockers') AS on`,
      );
      expect(after.rows[0]!.on).toBe(false);
    } finally {
      await su.query('ROLLBACK');
    }
  });
});

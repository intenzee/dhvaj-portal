import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { EngagementTabs } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';
import { createTestApp } from './create-test-app';

/**
 * Changing a stream's lead after set-up: an administrator or the Managing
 * Partner only — even one not on the engagement — audited, refused for
 * everyone else in the API and the database.
 */
describe('Stream lead change (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: Record<string, string>;
  let admin: Record<string, string>;
  let pa: Record<string, string>;
  let mx: Record<string, string>;
  let sy: Record<string, string>;
  let emp: Record<string, string>;
  let eng: string;
  let line: string;
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const setLead = (h: Record<string, string>, employeeId: string | null, lineId = line) =>
    http()
      .put(`/api/v1/engagements/${eng}/service-lines/${lineId}/lead`)
      .set(h)
      .send({ employeeId });
  const tabs = async () =>
    (await http().get(`/api/v1/engagements/${eng}/tabs`).set(mp).expect(200))
      .body as EngagementTabs;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await as('mp@dhvaj.in');
    admin = await as('admin@dhvaj.in');
    pa = await as('partner.a@dhvaj.in');
    mx = await as('manager.x@dhvaj.in');
    sy = await as('senior.y@dhvaj.in');
    emp = Object.fromEntries(
      (
        await su.query<{ email: string; id: string }>(
          `SELECT u.email::text, e.id FROM hsdg.users u JOIN hsdg.employees e ON e.user_id = u.id
            WHERE u.email LIKE '%@dhvaj.in'`,
        )
      ).rows.map((r) => [r.email, r.id]),
    );
    const acme = (
      (await http().get('/api/v1/entities?search=Acme&limit=10').set(mp).expect(200)).body
        .items as { id: string }[]
    )[0]!.id;
    const entity = await freshClient(acme);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: entity,
          status: 'accepted',
          engagementPartnerEmployeeId: emp['partner.a@dhvaj.in'],
          engagementManagerEmployeeId: emp['manager.x@dhvaj.in'],
          engagementType: 'recurring_compliance',
          financialYear: '2026-27',
          streams: ['income_tax', 'gst'],
          years: [{ financialYear: '2026-27' }],
          streamLeads: { gst: emp['manager.x@dhvaj.in'] },
        })
        .expect(201)
    ).body.id as string;
    const t = await tabs();
    line = t.streams.find((s) => s.stream === 'gst')!.engagementServiceId!;
    expect(t.streams.find((s) => s.stream === 'gst')!.leadEmployeeId).toBe(
      emp['manager.x@dhvaj.in'],
    );
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('refuses the engagement’s own partner, a manager and a senior, and names who can', async () => {
    for (const h of [pa, mx, sy]) {
      const r = await setLead(h, emp['senior.y@dhvaj.in']!).expect(403);
      expect(r.body.message).toBe(
        'Only an administrator or the Managing Partner changes a stream lead.',
      );
    }
    expect((await tabs()).streams.find((s) => s.stream === 'gst')!.leadEmployeeId).toBe(
      emp['manager.x@dhvaj.in'],
    );
  });

  it('the Managing Partner changes it; the Team tab shows it; it is audited', async () => {
    const r = await setLead(mp, emp['senior.y@dhvaj.in']!).expect(200);
    expect(r.body).toEqual({
      engagementServiceId: line,
      leadEmployeeId: emp['senior.y@dhvaj.in'],
      leadName: expect.any(String),
      previousLeadEmployeeId: emp['manager.x@dhvaj.in'],
    });
    const gst = (await tabs()).streams.find((s) => s.stream === 'gst')!;
    expect(gst).toMatchObject({
      leadEmployeeId: emp['senior.y@dhvaj.in'],
      leadName: r.body.leadName,
    });
    const audit = await su.query<{
      before_state: { leadEmployeeId: string };
      after_state: { leadEmployeeId: string };
    }>(
      `SELECT before_state, after_state FROM hsdg.audit_events
        WHERE action = 'engagement_service.lead_changed' AND object_id = $1::text
        ORDER BY occurred_at DESC LIMIT 1`,
      [line],
    );
    expect(audit.rows[0]).toMatchObject({
      before_state: { leadEmployeeId: emp['manager.x@dhvaj.in'] },
      after_state: { leadEmployeeId: emp['senior.y@dhvaj.in'] },
    });
  });

  it('an administrator — not on the engagement — changes it too, and can clear it', async () => {
    await setLead(admin, emp['partner.b@dhvaj.in']!).expect(200);
    expect((await tabs()).streams.find((s) => s.stream === 'gst')!.leadEmployeeId).toBe(
      emp['partner.b@dhvaj.in'],
    );
    const cleared = await setLead(admin, null).expect(200);
    expect(cleared.body).toMatchObject({ leadEmployeeId: null, leadName: null });
    expect((await tabs()).streams.find((s) => s.stream === 'gst')!.leadName).toBeNull();
  });

  it('refuses a person who has left, a line not on the engagement, and a bad id', async () => {
    const left = (
      await su.query<{ id: string }>(
        `INSERT INTO hsdg.employees
           (employee_code, full_name, grade_id, primary_office_id, employment_status,
            date_of_joining, date_of_exit)
         SELECT 'LEFT' || floor(random() * 1e6)::int, 'Gone Person', grade_id, primary_office_id,
                'exited', '2020-01-01', '2025-01-01'
           FROM hsdg.employees WHERE id = $1 RETURNING id`,
        [emp['senior.y@dhvaj.in']],
      )
    ).rows[0]!.id;
    const r = await setLead(mp, left).expect(400);
    expect(r.body.message).toBe('The lead must be a current employee.');
    await setLead(mp, emp['senior.y@dhvaj.in']!, '00000000-0000-4000-8000-000000000000').expect(
      404,
    );
    await setLead(mp, 'not-a-uuid').expect(400);
  });

  it('the database refuses a direct change by anyone else', async () => {
    const u = (
      await su.query<{ id: string; office: string; emp: string }>(
        `SELECT u.id, u.primary_office_id AS office, e.id AS emp
           FROM hsdg.users u JOIN hsdg.employees e ON e.user_id = u.id
          WHERE u.email = 'partner.a@dhvaj.in'`,
      )
    ).rows[0]!;
    await su.query('BEGIN');
    try {
      await su.query('SET LOCAL ROLE hsdg_app');
      await su.query(
        `SELECT set_config('hsdg.user_id', $1, true), set_config('hsdg.role', 'partner', true),
                set_config('hsdg.roles', 'partner', true), set_config('hsdg.office_id', $2, true),
                set_config('hsdg.employee_id', $3, true)`,
        [u.id, u.office, u.emp],
      );
      await expect(
        su.query(`SELECT * FROM hsdg.set_service_line_lead($1, $2, $3)`, [eng, line, u.emp]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await su.query('ROLLBACK');
    }
  });
});

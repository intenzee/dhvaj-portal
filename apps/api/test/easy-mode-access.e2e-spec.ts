import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { STRICT_FIRM_CHECKS } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Easy mode, Track B: with the firm's checks off, office staff work on their
 * office's engagements, anyone on the team moves a task, a task goes to anyone
 * in the office, an accepted engagement needs no partner, and independence
 * warnings are for information. Office separation and the hard ICAI blocks
 * stay. The checks are put back on for the suites after.
 */
describe('Easy mode — access, tasks and engagement creation (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;
  let sy: string;
  let coastal: string; // private limited company, South
  let bharat: string; // LLP, North
  let itr: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const entityId = async (search: string): Promise<string> =>
    (await http().get(`/api/v1/entities?search=${search}&limit=100`).set(bearer(mp))).body.items[0]
      .id as string;
  const serviceId = async (code: string): Promise<string> => {
    const res = await http().get(`/api/v1/services?search=${code}&limit=100`).set(bearer(mp));
    return (res.body.items as Array<{ id: string; code: string }>).find((s) => s.code === code)!.id;
  };
  const employeeId = async (code: string): Promise<string> => {
    const { rows } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE employee_code = $1`,
      [code],
    );
    return rows[0]!.id;
  };
  const setChecks = (checks: Record<string, boolean>) =>
    su.query(`UPDATE hsdg.firm_settings SET strict_checks = $1::jsonb`, [JSON.stringify(checks)]);
  const assignment = (t: string, entity: string, body: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/engagements')
      .set(bearer(t))
      .send({
        entityId: entity,
        serviceId: itr,
        financialYear: '2026-27',
        periodLabel: `E${unique()}`,
        status: 'accepted',
        ...body,
      });
  const move = (t: string, eng: string, task: string, action: string, body: object = {}) =>
    http().post(`/api/v1/engagements/${eng}/tasks/${task}/${action}`).set(bearer(t)).send(body);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    await setChecks({});
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    coastal = await entityId('Coastal');
    bharat = await entityId('Bharat');
    itr = await serviceId('ITR_FILING');
  });

  afterAll(async () => {
    await setChecks(STRICT_FIRM_CHECKS);
    await su?.end();
    await app?.close();
  });

  describe('office staff work on their office’s engagements', () => {
    let eng: string;

    beforeAll(async () => {
      eng = (await assignment(pb, await freshClient(coastal)).expect(201)).body.id as string;
    });

    afterEach(() => setChecks({}));

    it('a senior of the office opens it without being on the team; another office does not', async () => {
      await http().get(`/api/v1/engagements/${eng}`).set(bearer(sy)).expect(200);
      const north = await http().get(`/api/v1/engagements/${eng}`).set(bearer(pa));
      expect([403, 404]).toContain(north.status);

      await setChecks({ team_only_access: true });
      const strict = await http().get(`/api/v1/engagements/${eng}`).set(bearer(sy));
      expect([403, 404]).toContain(strict.status);
    });

    it('adds a task for anyone in the office, who joins the team; not someone from another office', async () => {
      const articleSouth = await employeeId('EMP008');
      const res = await http()
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(sy))
        .send({ title: 'Collect Form 16', assignedToEmployeeId: articleSouth })
        .expect(201);
      expect(res.body.assignedToEmployeeId ?? res.body.assignedToId).toBe(articleSouth);
      const team = await su.query(
        `SELECT role_on_engagement FROM hsdg.engagement_team
          WHERE engagement_id = $1 AND employee_id = $2`,
        [eng, articleSouth],
      );
      expect(team.rows).toEqual([{ role_on_engagement: 'member' }]);

      const north = await http()
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(sy))
        .send({ title: 'Not for the North', assignedToEmployeeId: await employeeId('EMP005') });
      expect(north.status).toBeGreaterThanOrEqual(400);
    });

    it('a teammate who is not the assignee starts, completes and reopens a task', async () => {
      const task = (
        await http()
          .post(`/api/v1/engagements/${eng}/tasks`)
          .set(bearer(pb))
          .send({ title: 'Prepare computation', assignedToEmployeeId: await employeeId('EMP008') })
          .expect(201)
      ).body.id as string;

      const started = await move(sy, eng, task, 'start');
      expect(started.status).toBeLessThan(300);
      expect(started.body.task.status).toBe('in_progress');

      const done = await move(sy, eng, task, 'complete');
      expect(done.status).toBeLessThan(300);
      expect(done.body.task.status).toBe('done');

      const reopened = await move(sy, eng, task, 'reopen');
      expect(reopened.status).toBeLessThan(300);

      const audit = await su.query(
        `SELECT count(*)::int AS n FROM hsdg.audit_events WHERE object_id = $1`,
        [task],
      );
      expect(audit.rows[0]!.n).toBeGreaterThanOrEqual(3);
    });
  });

  describe('engagement creation', () => {
    it('an accepted engagement needs no partner while engagement_partner_required is off', async () => {
      const client = await freshClient(bharat);
      const res = await assignment(mx, client).expect(201);
      expect(res.body.engagementPartnerId ?? null).toBeNull();

      await setChecks({ engagement_partner_required: true });
      try {
        await assignment(mx, await freshClient(bharat)).expect(400);
      } finally {
        await setChecks({});
      }
    });

    it('independence warnings are for information; a non-partner tick is not taken', async () => {
      const plain = await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          kind: 'statutory_audit',
          entityId: await freshClient(bharat),
          financialYear: '2026-27',
          status: 'accepted',
        })
        .expect(201);
      const ticked = await http()
        .post('/api/v1/engagements')
        .set(bearer(mx))
        .send({
          kind: 'statutory_audit',
          entityId: await freshClient(bharat),
          financialYear: '2026-27',
          status: 'pending_acceptance',
          acknowledgedIndependenceRules: ['NON_COMPANY_AUDIT_ACK'],
        })
        .expect(201);
      const { rows } = await su.query<{ rule_code: string; acked: string | null }>(
        `SELECT rule_code, acknowledged_by_employee_id AS acked
           FROM hsdg.engagement_independence_checks
          WHERE engagement_id = ANY($1::uuid[]) AND outcome = 'warn'`,
        [[plain.body.id, ticked.body.id]],
      );
      expect(rows).toEqual([
        { rule_code: 'NON_COMPANY_AUDIT_ACK', acked: null },
        { rule_code: 'NON_COMPANY_AUDIT_ACK', acked: null },
      ]);

      await setChecks({ independence_ack_required: true });
      try {
        const strict = await http()
          .post('/api/v1/engagements')
          .set(bearer(pa))
          .send({
            kind: 'statutory_audit',
            entityId: await freshClient(bharat),
            financialYear: '2026-27',
            status: 'accepted',
          })
          .expect(409);
        expect(strict.body.rule).toBe('ACKNOWLEDGEMENT_REQUIRED');
      } finally {
        await setChecks({});
      }
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * An engagement's partner, manager and team. The Managing Partner and the
 * administrator change them at any stage. While it is open, its own Engagement
 * Partner changes the manager and team, and its Manager the team. Everyone
 * else only sees them. Removing someone hands their open tasks over.
 */
describe('Who changes an engagement’s people (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let admin: string;
  let pa: string;
  let mx: string;
  let sy: string;
  let managingPartner: string;
  let partnerB: string;
  let managerX: string;
  let seniorY: string;
  let serviceId: string;
  /** Every engagement this suite makes — Partner B comes off them all afterwards. */
  const made: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const employee = async (code: string): Promise<string> =>
    (await su.query(`SELECT id FROM hsdg.employees WHERE employee_code = $1`, [code])).rows[0]!
      .id as string;

  /** A running engagement: Partner A leads, Manager X manages, Senior Y is on the team. */
  const running = async (): Promise<{ id: string; version: number }> => {
    const tag = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const entity = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `People ${tag} Pvt Ltd`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
      })
      .expect(201);
    const created = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId: entity.body.id,
        serviceId,
        financialYear: '2025-26',
        periodLabel: `P${tag}`,
        status: 'accepted',
        engagementManagerEmployeeId: managerX,
      })
      .expect(201);
    const id = created.body.id as string;
    made.push(id);
    await http()
      .post(`/api/v1/engagements/${id}/team`)
      .set(bearer(mp))
      .send({ employeeId: seniorY })
      .expect(201);
    const started = await http()
      .post(`/api/v1/engagements/${id}/start`)
      .set(bearer(pa))
      .send({})
      .expect(201);
    expect(started.body.status).toBe('active');
    return { id, version: started.body.version as number };
  };

  const audited = async (id: string, action: string): Promise<number> =>
    Number(
      (
        await su.query(
          `SELECT count(*) AS n FROM hsdg.audit_events WHERE object_id = $1 AND action = $2`,
          [id, action],
        )
      ).rows[0]!.n,
    );

  /** Titles of the notifications of a type an employee got about an engagement, oldest first. */
  const notified = async (employeeId: string, type: string, id: string): Promise<string[]> =>
    (
      await su.query<{ title: string }>(
        `SELECT n.title FROM hsdg.notifications n
           JOIN hsdg.employees e ON e.user_id = n.recipient_user_id
          WHERE e.id = $1 AND n.type = $2 AND n.engagement_id = $3
          ORDER BY n.created_at, n.title`,
        [employeeId, type, id],
      )
    ).rows.map((r) => r.title);

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
    managingPartner = await employee('EMP001');
    partnerB = await employee('EMP004');
    managerX = await employee('EMP005');
    seniorY = await employee('EMP006');
    serviceId = (await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp)))
      .body.items[0].id as string;
  });

  afterAll(async () => {
    // A Partner sees whoever shares an engagement with them: leave Partner A
    // (North) and Partner B (South) on no team together, or the organisation
    // suite's office scoping no longer holds.
    if (su && made.length) {
      const partnerA = await employee('EMP003');
      await su.query(
        `UPDATE hsdg.engagements SET engagement_partner_id = $2 WHERE id = ANY($1) AND engagement_partner_id = $3`,
        [made, partnerA, partnerB],
      );
      await su.query(
        `UPDATE hsdg.engagements SET engagement_manager_id = $2 WHERE id = ANY($1) AND engagement_manager_id = $3`,
        [made, managerX, partnerB],
      );
      await su.query(
        `DELETE FROM hsdg.engagement_team WHERE engagement_id = ANY($1) AND employee_id = $2`,
        [made, partnerB],
      );
    }
    await su?.end();
    await app?.close();
  });

  it('the Managing Partner changes partner, manager and team on a running engagement', async () => {
    const { id, version } = await running();
    const partner = await http()
      .post(`/api/v1/engagements/${id}/reassign-partner`)
      .set(bearer(mp))
      .send({ engagementPartnerEmployeeId: partnerB, reason: 'handover', version })
      .expect(201);
    expect(partner.body.engagementPartnerId).toBe(partnerB);
    const manager = await http()
      .post(`/api/v1/engagements/${id}/reassign-manager`)
      .set(bearer(mp))
      .send({ engagementManagerEmployeeId: managingPartner, reason: 'cover' })
      .expect(201);
    expect(manager.body.engagementManagerId).toBe(managingPartner);
    const team = await http()
      .delete(`/api/v1/engagements/${id}/team/${seniorY}`)
      .set(bearer(mp))
      .expect(200);
    expect(team.body.team).toEqual([]);
    expect(await audited(id, 'engagement.manager_changed')).toBe(1);
  });

  it('an administrator opens any engagement and changes its people', async () => {
    const { id } = await running();
    const seen = await http().get(`/api/v1/engagements/${id}`).set(bearer(admin)).expect(200);
    expect(seen.body.team).toHaveLength(1);
    const leads = await http().get('/api/v1/employees/leads').set(bearer(admin)).expect(200);
    expect(leads.body.map((l: { id: string }) => l.id)).toContain(partnerB);

    await http()
      .post(`/api/v1/engagements/${id}/reassign-partner`)
      .set(bearer(admin))
      .send({ engagementPartnerEmployeeId: partnerB })
      .expect(201);
    await http()
      .post(`/api/v1/engagements/${id}/reassign-manager`)
      .set(bearer(admin))
      .send({ engagementManagerEmployeeId: managingPartner })
      .expect(201);
    await http().delete(`/api/v1/engagements/${id}/team/${seniorY}`).set(bearer(admin)).expect(200);
    const added = await http()
      .post(`/api/v1/engagements/${id}/team`)
      .set(bearer(admin))
      .send({ employeeId: seniorY })
      .expect(201);
    expect(added.body.engagementPartnerId).toBe(partnerB);
    expect(added.body.engagementManagerId).toBe(managingPartner);
    expect(added.body.team.map((m: { employeeId: string }) => m.employeeId)).toEqual([seniorY]);
  });

  it('gives the administrator a say over the engagement’s work, like the Managing Partner (B-1)', async () => {
    const { id } = await running();
    await http()
      .post(`/api/v1/engagements/${id}/put-on-hold`)
      .set(bearer(admin))
      .send({ reason: 'waiting on the client', expectedResumeDate: '2026-12-01' })
      .expect(201);
  });

  it('the Engagement Partner changes the manager and team, the Manager the team; neither the partner', async () => {
    const { id } = await running();
    for (const who of [pa, mx]) {
      await http()
        .post(`/api/v1/engagements/${id}/reassign-partner`)
        .set(bearer(who))
        .send({ engagementPartnerEmployeeId: partnerB })
        .expect(403);
    }
    // The Manager adds and removes team, but cannot replace themself.
    await http()
      .post(`/api/v1/engagements/${id}/reassign-manager`)
      .set(bearer(mx))
      .send({ engagementManagerEmployeeId: partnerB })
      .expect(403);
    const added = await http()
      .post(`/api/v1/engagements/${id}/team`)
      .set(bearer(mx))
      .send({ employeeId: partnerB })
      .expect(201);
    expect(added.body.team.map((m: { employeeId: string }) => m.employeeId)).toContain(partnerB);
    await http().delete(`/api/v1/engagements/${id}/team/${partnerB}`).set(bearer(mx)).expect(200);

    // The EP changes the manager.
    const manager = await http()
      .post(`/api/v1/engagements/${id}/reassign-manager`)
      .set(bearer(pa))
      .send({ engagementManagerEmployeeId: managingPartner, reason: 'cover' })
      .expect(201);
    expect(manager.body.engagementManagerId).toBe(managingPartner);
    expect(await audited(id, 'engagement.manager_changed')).toBe(1);
    expect(await notified(managerX, 'team_changed', id)).toEqual([
      expect.stringMatching(/^No longer the Manager/),
    ]);
    expect(await notified(partnerB, 'team_changed', id)).toEqual([
      expect.stringMatching(/^Added to the team/),
      expect.stringMatching(/^Off the team/),
    ]);
  });

  it('a team member only sees them', async () => {
    const { id } = await running();
    const seen = await http().get(`/api/v1/engagements/${id}`).set(bearer(sy)).expect(200);
    expect(seen.body.team).toHaveLength(1);
    await http()
      .post(`/api/v1/engagements/${id}/reassign-partner`)
      .set(bearer(sy))
      .send({ engagementPartnerEmployeeId: partnerB })
      .expect(403);
    await http()
      .post(`/api/v1/engagements/${id}/reassign-manager`)
      .set(bearer(sy))
      .send({ engagementManagerEmployeeId: partnerB })
      .expect(403);
    await http()
      .post(`/api/v1/engagements/${id}/team`)
      .set(bearer(sy))
      .send({ employeeId: partnerB })
      .expect(403);
    await http().delete(`/api/v1/engagements/${id}/team/${seniorY}`).set(bearer(sy)).expect(403);
  });

  it('the partner and manager are changed, not removed', async () => {
    const { id } = await running();
    const refused = await http()
      .delete(`/api/v1/engagements/${id}/team/${managerX}`)
      .set(bearer(pa))
      .expect(409);
    expect(refused.body.message).toContain('Change the Manager first');
  });

  it('removing someone with open tasks hands them to someone on the engagement', async () => {
    const { id } = await running();
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.tasks (engagement_id, title, status, assigned_to_employee_id, completed_at)
       VALUES ($1, 'Prepare GSTR-1', 'todo', $2, NULL), ($1, 'Bank recon', 'in_progress', $2, NULL),
              ($1, 'Old one', 'done', $2, now())
       RETURNING id`,
      [id, seniorY],
    );
    const seen = await http().get(`/api/v1/engagements/${id}`).set(bearer(mx)).expect(200);
    expect(seen.body.team[0]).toMatchObject({ employeeId: seniorY, openTaskCount: 2 });

    const asked = await http()
      .delete(`/api/v1/engagements/${id}/team/${seniorY}`)
      .set(bearer(mx))
      .expect(409);
    expect(asked.body.message).toContain('has 2 open tasks');
    await http()
      .delete(`/api/v1/engagements/${id}/team/${seniorY}?handoverTo=${partnerB}`)
      .set(bearer(mx))
      .expect(400);

    const done = await http()
      .delete(`/api/v1/engagements/${id}/team/${seniorY}?handoverTo=${managerX}`)
      .set(bearer(mx))
      .expect(200);
    expect(done.body.team).toEqual([]);
    const owners = await su.query<{ title: string; assigned_to_employee_id: string }>(
      `SELECT title, assigned_to_employee_id FROM hsdg.tasks WHERE id = ANY($1::uuid[]) ORDER BY title`,
      [rows.map((r) => r.id)],
    );
    expect(owners.rows).toEqual([
      { title: 'Bank recon', assigned_to_employee_id: managerX },
      { title: 'Old one', assigned_to_employee_id: seniorY },
      { title: 'Prepare GSTR-1', assigned_to_employee_id: managerX },
    ]);
    expect(await notified(seniorY, 'team_changed', id)).toEqual([
      expect.stringMatching(/^Added to the team/),
      expect.stringMatching(/^Off the team/),
    ]);
    expect(await notified(managerX, 'task_assigned', id)).toEqual([
      expect.stringMatching(/^2 tasks handed to you/),
    ]);
  });

  it('a finished engagement’s people are the Managing Partner’s or an administrator’s to change', async () => {
    const { id } = await running();
    await su.query(`UPDATE hsdg.engagements SET status = 'completed' WHERE id = $1`, [id]);
    for (const who of [pa, mx]) {
      await http()
        .post(`/api/v1/engagements/${id}/team`)
        .set(bearer(who))
        .send({ employeeId: partnerB })
        .expect(403);
    }
    await http()
      .post(`/api/v1/engagements/${id}/reassign-manager`)
      .set(bearer(pa))
      .send({ engagementManagerEmployeeId: partnerB })
      .expect(403);
    await http()
      .post(`/api/v1/engagements/${id}/team`)
      .set(bearer(mp))
      .send({ employeeId: partnerB })
      .expect(201);
  });

  it('a lead keeps the rest of the update, but not the manager through it', async () => {
    const { id } = await running();
    await http()
      .patch(`/api/v1/engagements/${id}`)
      .set(bearer(pa))
      .send({ engagementManagerEmployeeId: partnerB })
      .expect(403);
    const updated = await http()
      .patch(`/api/v1/engagements/${id}`)
      .set(bearer(pa))
      .send({ plannedEndDate: '2026-12-31' })
      .expect(200);
    expect(updated.body.plannedEndDate).toContain('2026-12-31');
    expect(updated.body.engagementManagerId).toBe(managerX);
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * An engagement's partner, manager and team, at any stage: the Managing
 * Partner and the administrator change them, everyone else only sees them.
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

  it('gives the administrator no say over the engagement’s work', async () => {
    const { id } = await running();
    await http()
      .post(`/api/v1/engagements/${id}/put-on-hold`)
      .set(bearer(admin))
      .send({ reason: 'not theirs to do' })
      .expect(403);
    await http()
      .patch(`/api/v1/engagements/${id}`)
      .set(bearer(admin))
      .send({ plannedEndDate: '2026-12-31' })
      .expect(403);
  });

  it('everyone else only sees them: partner, manager and team member are all refused', async () => {
    const { id } = await running();
    for (const who of [pa, mx, sy]) {
      const seen = await http().get(`/api/v1/engagements/${id}`).set(bearer(who)).expect(200);
      expect(seen.body.team).toHaveLength(1);
      await http()
        .post(`/api/v1/engagements/${id}/reassign-partner`)
        .set(bearer(who))
        .send({ engagementPartnerEmployeeId: partnerB })
        .expect(403);
      await http()
        .post(`/api/v1/engagements/${id}/reassign-manager`)
        .set(bearer(who))
        .send({ engagementManagerEmployeeId: partnerB })
        .expect(403);
      await http()
        .post(`/api/v1/engagements/${id}/team`)
        .set(bearer(who))
        .send({ employeeId: partnerB })
        .expect(403);
      await http().delete(`/api/v1/engagements/${id}/team/${seniorY}`).set(bearer(who)).expect(403);
    }
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

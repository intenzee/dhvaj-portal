import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  type AuditProcedure,
  type StatutoryAuditTeam,
  type TeamBalanceResult,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { answerSection01Clean, recommendSection01 } from './section01.helper';

/**
 * Team plans itself from the file: planned hours estimated from the work each
 * person owns and reviews (until someone sets them), "Balance the work" hands
 * the manager's not-started procedures to the team by grade and load, and
 * each person's flags say what needs attention.
 */
describe('Statutory Audit — Team from the file (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let pb: string;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(url).set(bearer(t)).send(body);
  const get = (t: string, url: string) =>
    request(app.getHttpServer()).get(url).set(bearer(t)).expect(200);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  /** A released 03.5 library with two areas (the test DB ships none). */
  const seedLibrary = async (): Promise<void> => {
    const su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    try {
      const { rows } = await su.query(`SELECT 1 FROM hsdg.audit_area_library_release LIMIT 1`);
      if (rows[0]) return;
      await su.query(
        `INSERT INTO hsdg.audit_area_library_release (library_version, note)
         VALUES ('e2e-work-1', 'e2e') ON CONFLICT DO NOTHING`,
      );
      await su.query(
        `INSERT INTO hsdg.audit_area_library
           (library_version, area_code, area_name, area_type, category, default_assertions, aliases)
         VALUES ('e2e-work-1', 'CASH', 'Cash and bank balances', 'balance_sheet', 'assets',
                 ARRAY['BAL_EXIST','BAL_COMP'], ARRAY['Bank']),
                ('e2e-work-1', 'REV', 'Revenue from operations', 'profit_loss', 'income_expenses',
                 ARRAY['TX_OCC','TX_CUTOFF'], ARRAY['Sales'])`,
      );
    } finally {
      await su.end();
    }
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    await seedLibrary();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('estimates planned hours, balances the work and keeps hours a person sets', async () => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    const { rows } = await c.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM hsdg.employees
        WHERE full_name IN ('Manager X', 'Senior Y', 'Article North')`,
    );
    await c.end();
    const ids = new Map(rows.map((r) => [r.full_name, r.id]));
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Team Seed ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: itr,
      financialYear: '2024-25',
      periodLabel: `P${stamp()}`,
      status: 'accepted',
      engagementManagerEmployeeId: ids.get('Manager X'),
    }).expect(201);
    const engId = eng.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const shellId = (await get(pa, base)).body[0].workflowInstanceId as string;

    // Section 01 accepted, Section 02 approved.
    // The Engagement Manager declares independence too (01.5).
    await answerSection01Clean(app, pa, engId, [await token('manager.x@dhvaj.in')]);
    await recommendSection01(app, pa, engId, shellId);
    await post(pa, `${base}/${shellId}/acceptance/approve`, {
      conclusion: 'accept',
      memo: 'Accepted (e2e).',
    }).expect(201);
    const fw = await get(pa, `${base}/framework`);
    for (const a of fw.body[0].assessments as Array<{
      id: string;
      areaKey: string;
      version: number;
    }>) {
      await post(pa, `${base}/framework/${a.id}/decision`, {
        conclusion: a.areaKey === 'caro' ? 'applicable' : 'not_applicable',
        basis: 'E2E professional basis.',
        version: a.version,
      }).expect(201);
    }
    await post(pa, `${base}/${shellId}/framework/approve`, { memo: 'Approved (e2e).' }).expect(201);

    // The team: a senior and an article join the engagement.
    for (const [name, role] of [
      ['Senior Y', 'in_charge'],
      ['Article North', 'member'],
    ] as const) {
      await post(pa, `/api/v1/engagements/${engId}/team`, {
        employeeId: ids.get(name),
        roleOnEngagement: role,
      }).expect(201);
    }
    // The audit work builds itself — every procedure starts with the manager.
    await get(pa, `${base}/work-areas`);
    const procs = (await get(pa, `${base}/procedures`)).body[0].procedures as AuditProcedure[];
    expect(procs.every((p) => p.ownerEmployeeId === ids.get('Manager X'))).toBe(true);

    // First open: planned hours are the estimate; balance proposes moves.
    let team = (await get(pa, `${base}/team`)).body[0] as StatutoryAuditTeam;
    const member = (name: string) => team.members.find((m) => m.name === name)!;
    expect(member('Manager X')).toMatchObject({ plannedSuggested: true, grade: 'Manager' });
    expect(member('Manager X').plannedHours).toBe(member('Manager X').estimatedHours);
    expect(member('Manager X').planBasis).toMatch(/^Estimated from \d+ procedure\(s\)/);
    expect(member('Senior Y').flags.map((f) => f.key)).toContain('no_work');
    const owners = team.balance.filter((m) => m.field === 'owner');
    expect(owners.length).toBe(procs.length);
    expect(new Set(owners.map((m) => m.toName))).toEqual(new Set(['Senior Y', 'Article North']));

    // Apply in one click: the work moves and the estimates follow it.
    const applied = (await post(pa, `${base}/${shellId}/team/balance`, {}).expect(201))
      .body as TeamBalanceResult;
    expect(applied.moved).toBeGreaterThanOrEqual(owners.length);
    team = applied.team;
    expect(team.balance).toEqual([]);
    expect(member('Senior Y').progress.total).toBeGreaterThan(0);
    expect(member('Senior Y').plannedHours).toBe(member('Senior Y').estimatedHours);
    expect(member('Senior Y').flags.map((f) => f.key)).not.toContain('no_work');
    const after = (await get(pa, `${base}/procedures`)).body[0].procedures as AuditProcedure[];
    expect(after.some((p) => p.ownerEmployeeId === ids.get('Manager X'))).toBe(false);
    // Nothing left to balance → a clear 409.
    await post(pa, `${base}/${shellId}/team/balance`, {}).expect(409);

    // Hours a person sets are theirs: never re-estimated.
    team = (
      await post(pa, `${base}/${shellId}/team/allocations`, {
        employeeId: ids.get('Article North'),
        plannedHours: 40,
      }).expect(201)
    ).body as StatutoryAuditTeam;
    expect(member('Article North')).toMatchObject({ plannedHours: 40, plannedSuggested: false });
    team = (await get(pa, `${base}/team`)).body[0] as StatutoryAuditTeam;
    expect(member('Article North').plannedHours).toBe(40);

    // An outsider cannot balance the work.
    const res = await post(pb, `${base}/${shellId}/team/balance`, {});
    expect([403, 404]).toContain(res.status);
  }, 30_000);
});

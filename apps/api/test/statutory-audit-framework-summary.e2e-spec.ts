import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type StatutoryAuditFrameworkSummary } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.8 Audit Framework Summary & Approval — end-to-end (Guide §9.8, §13). Covers
 * the dashboard aggregation, the AF-01 gate blocking until every sub-section is
 * decided, and the §35 outsider check. (The full AF-01 → AF-02 → reopen happy
 * path requires all six 02.x sub-sections decided + the 02.1 profile confirmed;
 * the pure gate logic is exhaustively covered in framework-summary.spec.ts.)
 */
describe('Statutory Audit — 02.8 Framework Summary (e2e §9.8)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePeriod = (): string => `P${Date.now()}${Math.floor(Math.random() * 1000)}`;

  let mp: string;
  let pa: string;
  let pb: string;
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  let engId: string;
  let shellId: string;
  const base = () => `/api/v1/engagements/${engId}/statutory-audit`;

  const getSummary = async (t: string): Promise<StatutoryAuditFrameworkSummary> => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/framework-summary`)
      .set(bearer(t))
      .expect(200);
    return res.body[0] as StatutoryAuditFrameworkSummary;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const created = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId: primaryServiceId,
        financialYear: '2024-25',
        periodLabel: uniquePeriod(),
        status: 'accepted',
      })
      .expect(201);
    engId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);
    const shells = await request(app.getHttpServer()).get(base()).set(bearer(pa)).expect(200);
    shellId = shells.body[0].workflowInstanceId as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('aggregates the six Section 02 sub-sections and reports the gates', async () => {
    const s = await getSummary(pa);
    expect(s.sections).toHaveLength(6);
    expect(s.sections.map((x) => x.subSectionKey).sort()).toEqual([
      '02.2',
      '02.3',
      '02.4',
      '02.5',
      '02.6',
      '02.7',
    ]);
    // Nothing decided yet → AF-01 is blocked and no baseline exists.
    expect(s.gates.allSectionsDecided).toBe(false);
    expect(s.gates.canConfirm).toBe(false);
    expect(s.baseline).toBeNull();
    expect(s.planningUnlocked).toBe(false);
  });

  it('AF-01 is rejected while sub-sections are undecided', async () => {
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/framework-summary/confirm`)
      .set(bearer(pa))
      .send({ recordVersion: 0 })
      .expect(400);
  });

  it('AF-02 is rejected without a Manager-confirmed baseline', async () => {
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/framework-summary/approve`)
      .set(bearer(pa))
      .send({ recordVersion: 1 })
      .expect(400);
  });

  it('an outsider (not on the engagement) cannot read or drive 02.8 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/framework-summary`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/framework-summary/confirm`)
      .set(bearer(pb))
      .send({ recordVersion: 0 })
      .expect(404);
  });
});

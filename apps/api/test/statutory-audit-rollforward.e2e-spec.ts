import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type RollForwardComparison } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Prior-year roll-forward — end-to-end (Implementation Guide §12). Creates a
 * prior-year (FY2023-24) and a current-year (FY2024-25) statutory-audit file for
 * the same entity, then checks the comparison surfaces the prior year, highlights
 * the financial-year change, and that apply is gated + audited. §35 outsider check.
 */
describe('Statutory Audit — prior-year roll-forward (e2e §12)', () => {
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

  let entityId: string;
  let statAuditId: string;
  let primaryServiceId: string;
  let currentEngId: string;
  let currentShellId: string;

  const createAuditFile = async (
    financialYear: string,
  ): Promise<{ engId: string; shellId: string }> => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId: primaryServiceId,
        financialYear,
        periodLabel: uniquePeriod(),
        status: 'accepted',
      })
      .expect(201);
    const engId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);
    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    return { engId, shellId: shells.body[0].workflowInstanceId as string };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    entityId = await findId('/api/v1/entities?search=Acme&limit=100');
    primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');

    await createAuditFile('2023-24'); // prior year
    const current = await createAuditFile('2024-25'); // current year
    currentEngId = current.engId;
    currentShellId = current.shellId;
  });

  afterAll(async () => {
    await app?.close();
  });

  const base = () =>
    `/api/v1/engagements/${currentEngId}/statutory-audit/${currentShellId}/roll-forward`;

  it('surfaces the prior-year file and highlights the financial-year change', async () => {
    const res = await request(app.getHttpServer()).get(base()).set(bearer(pa)).expect(200);
    const cmp = res.body as RollForwardComparison;
    expect(cmp.hasPriorYear).toBe(true);
    expect(cmp.priorFinancialYear).toBe('2023-24');
    expect(cmp.currentFinancialYear).toBe('2024-25');
    expect(cmp.sections).toHaveLength(6);
    const fy = cmp.profileChanges.find((c) => c.field === 'financialYear');
    expect(fy?.changed).toBe(true);
  });

  it('applies the roll-forward (carry-forward + re-evaluation flags) and audits it', async () => {
    await request(app.getHttpServer()).post(`${base()}/apply`).set(bearer(pa)).expect(201);
    const events = await request(app.getHttpServer())
      .get(`/api/v1/audit?limit=100`)
      .set(bearer(mp))
      .expect(200);
    const actions = (events.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.rollforward_applied');
  });

  it('an outsider (not on the engagement) cannot read or apply the roll-forward (§35)', async () => {
    await request(app.getHttpServer()).get(base()).set(bearer(pb)).expect(404);
    await request(app.getHttpServer()).post(`${base()}/apply`).set(bearer(pb)).expect(404);
  });
});

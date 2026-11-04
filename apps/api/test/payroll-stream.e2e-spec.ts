import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/**
 * Practice Services PS-405 — the Payroll & Labour stream: PF, ESI and PT
 * filings on the client's PF, ESIC and PT registrations, PT on the state's
 * own date, its service line, and the month's filing run.
 */
describe('Payroll & Labour stream (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let client: string;
  let eng: string;
  const regs: Record<'pf' | 'esic' | 'pt', string> = { pf: '', esic: '', pt: '' };
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const WINDOW = 'from=2026-04-01&to=2027-06-30';
  const unique = () => `${Date.now()}${Math.floor(Math.random() * 1e4)}`;

  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };

  interface Row {
    stream: string;
    ruleCode: string;
    formLabel: string | null;
    registrationId: string | null;
    registrationType: string | null;
    periodKey: string | null;
    dueDate: string;
    needsVerification: boolean;
  }
  const calendar = async (): Promise<Row[]> => {
    const res = await http()
      .get(`/api/v1/compliance/calendar?${WINDOW}&entityId=${client}&stream=payroll`)
      .set(bearer(pa))
      .expect(200);
    return res.body.items as Row[];
  };

  const flagsBefore = process.env.FEATURE_FLAGS;

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    const acme = await http().get('/api/v1/entities?search=Acme&limit=10').set(bearer(mp));
    client = await freshClient(acme.body.items[0].id as string);

    // A Karnataka employer: PF and ESIC codes and a Karnataka PT enrolment.
    const su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    try {
      for (const [type, number, state] of [
        ['pf', `KNBNG${unique()}`, null],
        ['esic', `5300${unique()}`, null],
        ['pt', `PT29${unique()}`, '29'],
      ] as const) {
        const { rows } = await su.query<{ id: string }>(
          `INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [client, type, number, state],
        );
        regs[type] = rows[0]!.id;
      }
    } finally {
      await su.end();
    }

    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        kind: 'compliance',
        entityId: client,
        status: 'accepted',
        financialYear: '2026-27',
        streams: ['payroll'],
        years: [{ financialYear: '2026-27' }],
      })
      .expect(201);
    eng = res.body.id as string;
  });

  afterAll(async () => {
    await app?.close();
    if (flagsBefore === undefined) delete process.env.FEATURE_FLAGS;
    else process.env.FEATURE_FLAGS = flagsBefore;
  });

  it('builds the month’s PF and ESI filings on their own registrations', async () => {
    const rows = await calendar();
    const pf = rows.filter((r) => r.ruleCode === 'PAY_PF_ECR');
    const esi = rows.filter((r) => r.ruleCode === 'PAY_ESI_MONTHLY');
    expect(pf).toHaveLength(12);
    expect(esi).toHaveLength(12);
    expect(pf.every((r) => r.registrationId === regs.pf && r.formLabel === 'ECR')).toBe(true);
    expect(esi.every((r) => r.registrationId === regs.esic)).toBe(true);
    expect(pf.find((r) => r.periodKey === '2026-06')!.dueDate).toBe('2026-07-15');
    expect(pf.every((r) => !r.needsVerification)).toBe(true);

    const returns = rows.filter((r) => r.ruleCode === 'PAY_ESI_RETURN');
    expect(returns.map((r) => r.periodKey).sort()).toEqual(['2026-27:H1', '2026-27:H2']);
    expect(returns.every((r) => r.needsVerification)).toBe(true);
  });

  it('puts Professional Tax on the PT state’s own date, marked to verify', async () => {
    const rows = await calendar();
    const pt = rows.filter((r) => r.ruleCode === 'PAY_PT_MONTHLY');
    expect(pt).toHaveLength(12);
    expect(rows.some((r) => r.ruleCode === 'PAY_PT_HALF_YEARLY')).toBe(false);
    const oct = pt.find((r) => r.periodKey === '2026-10')!;
    expect(oct).toMatchObject({
      registrationId: regs.pt,
      formLabel: 'PT return (Form 5)',
      dueDate: '2026-11-20',
      needsVerification: true,
    });
  });

  it('gives the engagement a Payroll & Labour line that carries the filings', async () => {
    const res = await http().get(`/api/v1/engagements/${eng}`).set(bearer(pa)).expect(200);
    const line = (res.body.services as Array<{ id: string; serviceCode: string }>).find(
      (s) => s.serviceCode === 'STREAM_PAYROLL',
    );
    expect(line).toBeDefined();
    const su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    try {
      const { rows } = await su.query<{ off: string }>(
        `SELECT count(*)::text AS off FROM hsdg.compliance_instances
          WHERE engagement_id = $1 AND engagement_service_id IS DISTINCT FROM $2`,
        [eng, line!.id],
      );
      expect(rows[0]!.off).toBe('0');
    } finally {
      await su.end();
    }
  });

  it('lists the month’s PF filings as a filing run', async () => {
    const run = await http()
      .get('/api/v1/compliance/runs?rule=PAY_PF_ECR&period=2026-09')
      .set(bearer(pa))
      .expect(200);
    expect(run.body).toMatchObject({ rule: 'PAY_PF_ECR', formLabel: 'ECR', periodKey: '2026-09' });
    const mine = (run.body.items as Array<{ engagementId: string; statutoryDate: string }>).filter(
      (i) => i.engagementId === eng,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.statutoryDate).toBe('2026-10-15');
  });
});

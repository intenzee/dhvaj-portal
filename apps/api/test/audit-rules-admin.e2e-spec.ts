import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { AuditRuleRecord, StatutoryAuditFinancialReporting } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Rules Library administration (DHVAJ 02.2 spec §2, acceptance test 10):
 * changing a threshold for a future effective date changes future-period
 * results with no code change, and never alters historical periods.
 */
describe('Rules Library administration (02.2 spec §2)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  const RULE = 'FRF_INDAS_CORP_UNLISTED_P2';
  const FUTURE = '2090-04-01';

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const post = (t: string, path: string, body: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set(bearer(t))
      .send(body as object);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  /** Remove this suite's far-future versions so reruns start from the seeded library. */
  const cleanup = async (): Promise<void> => {
    const client = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await client.connect();
    try {
      await client.query(
        `DELETE FROM hsdg.audit_rule_version v USING hsdg.audit_rule r
          WHERE r.id = v.audit_rule_id AND r.code = $1 AND v.effective_from >= '2090-01-01'`,
        [RULE],
      );
    } finally {
      await client.end();
    }
  };

  const rule = async (): Promise<AuditRuleRecord> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-rules')
      .set(bearer(mp))
      .expect(200);
    return (res.body as AuditRuleRecord[]).find((r) => r.code === RULE)!;
  };

  /** An unlisted public company with ₹300 cr net worth at the end of the preceding year. */
  const unlistedAt300 = async (
    financialYear: string,
  ): Promise<StatutoryAuditFinancialReporting> => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Rules Admin Co ${stamp()}`,
      typeSlug: 'public_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: itr,
      financialYear,
      periodLabel: `P${stamp()}`,
      status: 'accepted',
    }).expect(201);
    const engId = eng.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const shells = await request(app.getHttpServer()).get(base).set(bearer(pa)).expect(200);
    const shellId = shells.body[0].workflowInstanceId as string;
    await post(pa, `${base}/${shellId}/profile/financials`, {
      parameter: 'net_worth',
      priorValue: 3_000_000_000,
    }).expect(201);
    const res = await request(app.getHttpServer())
      .get(`${base}/financial-reporting`)
      .set(bearer(pa))
      .expect(200);
    return res.body[0] as StatutoryAuditFinancialReporting;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    await cleanup();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
    await cleanup();
  });

  it('lists every rule with its dated versions and cited provision', async () => {
    const r = await rule();
    expect(r.operator).toBe('>=');
    expect(r.versions[0]).toMatchObject({
      effectiveFrom: '2017-04-01',
      threshold: 2_500_000_000,
      supersededFrom: null,
    });
    expect(r.versions[0]!.authorityProvisionCode).toBeTruthy();
    const provisions = await request(app.getHttpServer())
      .get('/api/v1/audit-rules/provisions')
      .set(bearer(mp))
      .expect(200);
    expect(provisions.body.some((p: { code: string }) => p.code === 'INDAS_RULE_4')).toBe(true);
  });

  it('is limited to the methodology administrators', async () => {
    await request(app.getHttpServer()).get('/api/v1/audit-rules').set(bearer(pa)).expect(403);
    const r = await rule();
    await post(pa, `/api/v1/audit-rules/${r.id}/versions`, {
      effectiveFrom: FUTURE,
      threshold: 4_000_000_000,
      notes: 'Not allowed',
      version: r.version,
    }).expect(403);
  });

  it('refuses to rewrite history, a missing reason or a stale write', async () => {
    const r = await rule();
    await post(mp, `/api/v1/audit-rules/${r.id}/versions`, {
      effectiveFrom: '2017-04-01',
      threshold: 4_000_000_000,
      notes: 'Back-dated change',
      version: r.version,
    }).expect(400);
    await post(mp, `/api/v1/audit-rules/${r.id}/versions`, {
      effectiveFrom: FUTURE,
      threshold: 4_000_000_000,
      notes: '',
      version: r.version,
    }).expect(400);
    await post(mp, `/api/v1/audit-rules/${r.id}/versions`, {
      effectiveFrom: FUTURE,
      threshold: null,
      notes: 'Threshold removed',
      version: r.version,
    }).expect(400);
    await post(mp, `/api/v1/audit-rules/${r.id}/versions`, {
      effectiveFrom: FUTURE,
      threshold: 4_000_000_000,
      notes: 'Stale copy',
      version: r.version - 1,
    }).expect(409);
  });

  it('a future threshold changes future periods only — no code change, history intact (test 10)', async () => {
    // Before: ₹300 cr ≥ ₹250 cr → Ind AS in both periods.
    expect((await unlistedAt300('2024-25')).assessment.systemOutcome).toBe('ind_as');

    const r = await rule();
    const res = await post(mp, `/api/v1/audit-rules/${r.id}/versions`, {
      effectiveFrom: FUTURE,
      threshold: 4_000_000_000,
      notes: 'Test amendment — unlisted limit raised to ₹400 crore',
      version: r.version,
    }).expect(201);
    const after = res.body as AuditRuleRecord;
    expect(after.version).toBe(r.version + 1);
    expect(after.versions).toHaveLength(r.versions.length + 1);
    expect(after.versions[0]).toMatchObject({
      version: r.versions[0]!.version + 1,
      effectiveFrom: FUTURE,
      threshold: 4_000_000_000,
      // Carried forward: the Rule 4 timing condition and the cited provision.
      condition: r.versions[0]!.condition,
      authorityProvisionId: r.versions[0]!.authorityProvisionId,
    });
    expect(after.versions[1]).toMatchObject({
      effectiveFrom: '2017-04-01',
      supersededFrom: FUTURE,
    });

    // History: a FY 2024-25 file still resolves against the ₹250 cr version.
    const past = await unlistedAt300('2024-25');
    expect(past.assessment.systemOutcome).toBe('ind_as');
    expect(past.detail?.netWorth?.threshold).toBe(2_500_000_000);

    // Future: FY 2090-91 resolves against ₹400 cr — ₹300 cr no longer triggers Ind AS.
    const future = await unlistedAt300('2090-91');
    expect(
      future.detail?.rulesApplied?.some((x) => x.ruleCode === RULE && x.result === 'triggered'),
    ).toBe(false);
    expect(future.assessment.systemOutcome).not.toBe('ind_as');

    // Audited, with the reason and the before/after threshold.
    const client = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await client.connect();
    try {
      const ev = await client.query<{
        reason: string;
        before_state: { threshold: number };
        after_state: { threshold: number };
      }>(
        `SELECT reason, before_state, after_state FROM hsdg.audit_events
          WHERE action = 'audit_rule.version_added' AND object_id = $1
          ORDER BY occurred_at DESC LIMIT 1`,
        [r.id],
      );
      expect(ev.rows[0]).toMatchObject({
        reason: 'Test amendment — unlisted limit raised to ₹400 crore',
        before_state: { threshold: 2_500_000_000 },
        after_state: { threshold: 4_000_000_000 },
      });
    } finally {
      await client.end();
    }
  });
});

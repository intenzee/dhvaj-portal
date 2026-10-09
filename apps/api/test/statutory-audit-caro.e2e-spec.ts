import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CARO_OUTCOME, type StatutoryAuditCaro } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.4 CARO 2020 Applicability — end-to-end (Implementation Guide §9.4). Drives
 * the shared sub-assessment through the API: assemble the direct-exemption facts
 * from 02.1, capture the CARO-measurement facts, run the engine, record the
 * professional conclusion, and the §35 outsider check.
 */
describe('Statutory Audit — 02.4 CARO 2020 (e2e §9.4)', () => {
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

  const getCaro = async (t: string): Promise<StatutoryAuditCaro> => {
    const res = await request(app.getHttpServer()).get(`${base()}/caro`).set(bearer(t)).expect(200);
    return res.body[0] as StatutoryAuditCaro;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    const entityId = await findId('/api/v1/entities?search=Acme&limit=100');
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

  it('provisions one 02.4 assessment; without the CARO facts it is information-insufficient', async () => {
    const caro = await getCaro(pa);
    expect(caro.assessment.subSectionKey).toBe('02.4');
    // The seeded "Acme" entity is a private company (Bharat is an LLP, outside CARO); with no captured numbers the
    // cumulative test cannot run yet.
    expect(caro.assessment.systemOutcome).toBe(CARO_OUTCOME.informationInsufficient);
  });

  it('CARO-05 waits for the 02.1 small-company result — never recalculated in 02.4', async () => {
    const caro = await getCaro(pa);
    const smallTest = caro.detail!.directTests.find((t) => t.code === 'CARO-05')!;
    expect(smallTest.answer).toBe('pending');
    expect(smallTest.provisionCodes).toContain('COS_ACT_2_85');

    // 02.1 records its small-company conclusion; 02.4 consumes it.
    const profile = await request(app.getHttpServer())
      .get(`${base()}/profile`)
      .set(bearer(pa))
      .expect(200);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/profile/small-company`)
      .set(bearer(pa))
      .send({
        action: 'override',
        outcome: 'not_small',
        reason: 'E2E: above the small-company limits.',
        version: profile.body[0].version,
      })
      .expect(201);
    const after = await getCaro(pa);
    expect(after.detail!.directTests.find((t) => t.code === 'CARO-05')!.answer).toBe('no');
  });

  it('captures the CARO facts and applies when a limit is exceeded', async () => {
    const before = await getCaro(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/facts`)
      .set(bearer(pa))
      .send({
        isHoldingOrSubsidiaryOfPublic: false,
        capitalPlusReserves: 5000000, // ₹0.5cr
        peakBankFiBorrowings: 5000000, // ₹0.5cr
        totalRevenue: 150000000, // ₹15cr — exceeds the ₹10cr limit
        version: before.assessment.version,
      })
      .expect(201);
    const caro = res.body as StatutoryAuditCaro;
    expect(caro.capturedFacts.totalRevenue).toBe(150000000);
    expect(caro.assessment.systemOutcome).toBe(CARO_OUTCOME.applicable);
    expect(caro.detail!.level1Applies).toBe(true);
    expect(caro.detail!.instantiatesClauseProgramme).toBe(true);
    expect(caro.assessment.authorityProvisionId).toBeTruthy(); // CARO_2020 frozen period-correct
    // §8: the structured conclusion names the failed condition, value and configured limit.
    expect(caro.detail!.conclusion).toMatchObject({
      entityRoute: 'private_company',
      privateExemption: 'not_qualified',
      failedCondition: 'Total revenue',
      actualValue: '₹15.00 cr',
      configuredLimit: '₹10.00 cr',
    });
    expect(caro.detail!.privateTest!.conditions.map((c) => c.ruleCode)).toEqual([
      'CARO_PVT_PUBLIC_GROUP',
      'CARO_PVT_CAPITAL_RESERVES',
      'CARO_PVT_BORROWINGS',
      'CARO_PVT_REVENUE',
    ]);
    // The Phase-02 list mirrors 02.4 — one CARO answer everywhere.
    const fw = await request(app.getHttpServer())
      .get(`${base()}/framework`)
      .set(bearer(pa))
      .expect(200);
    const area = (
      fw.body[0].assessments as Array<{
        areaKey: string;
        systemSuggestion: string;
        systemBasis: string;
      }>
    ).find((a) => a.areaKey === 'caro')!;
    expect(area.systemSuggestion).toBe('applicable');
    expect(area.systemBasis).toMatch(/^02\.4 CARO:/);
  });

  it('a borrowing schedule is aggregated across lenders; year-end-only data is Pending', async () => {
    const before = await getCaro(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/facts`)
      .set(bearer(pa))
      .send({
        borrowingDataBasis: 'year_end_only',
        peakBankFiBorrowings: null,
        borrowingSchedule: [
          { asOn: '2025-03-31', lender: 'HDFC Bank', lenderType: 'bank', amount: 4000000 },
          {
            asOn: '2025-03-31',
            lender: 'SIDBI',
            lenderType: 'financial_institution',
            amount: 3000000,
          },
        ],
        version: before.assessment.version,
      })
      .expect(201);
    const borrowings = (res.body as StatutoryAuditCaro).detail!.privateTest!.conditions.find(
      (c) => c.key === 'borrowings',
    )!;
    expect(borrowings.result).toBe('pending');
    expect(borrowings.pendingReason).toMatch(/year-end/);
    // Back to the captured peak for the rest of the suite.
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/facts`)
      .set(bearer(pa))
      .send({
        borrowingDataBasis: 'monthly',
        borrowingSchedule: null,
        peakBankFiBorrowings: 5000000,
        version: (res.body as StatutoryAuditCaro).assessment.version,
      })
      .expect(201);
  });

  it('CARO-06 Information Pending must name the blocking fact', async () => {
    const caro = await getCaro(pa);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({ action: 'information_pending', version: caro.assessment.version })
      .expect(400); // nothing is missing, so the reason must say what is pending
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({
        action: 'information_pending',
        pendingReason: 'Awaiting monthly bank statements.',
        version: caro.assessment.version,
      })
      .expect(201);
    expect((res.body as StatutoryAuditCaro).assessment.state).toBe('pending_information');
    expect((res.body as StatutoryAuditCaro).pendingReason).toBe(
      'Awaiting monthly bank statements.',
    );
  });

  it('records the professional conclusion, and rejects a stale-version write (409)', async () => {
    const caro = await getCaro(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({ conclusion: CARO_OUTCOME.applicable, version: caro.assessment.version })
      .expect(201);
    const decided = res.body as StatutoryAuditCaro;
    expect(decided.assessment.conclusion).toBe(CARO_OUTCOME.applicable);
    expect(decided.assessment.state).toBe('applicable');

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      // A justified override, so the only fault is the stale version.
      .send({
        conclusion: CARO_OUTCOME.notApplicableExempt,
        basis: 'Stale-version check (e2e).',
        version: caro.assessment.version,
      })
      .expect(409);
  });

  it('overriding to Not-Applicable without a basis is rejected (§19)', async () => {
    const caro = await getCaro(pa);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({ conclusion: CARO_OUTCOME.notApplicableExempt, version: caro.assessment.version })
      .expect(400); // differs from the system's "applicable" → basis required
    // A reason alone is not enough: the technical basis and evidence are mandatory too.
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({
        action: 'override',
        conclusion: CARO_OUTCOME.notApplicableExempt,
        basis: 'Revenue restated.',
        version: caro.assessment.version,
      })
      .expect(400);
  });

  it('an override keeps the system result and needs the Engagement Partner (CARO-06)', async () => {
    const caro = await getCaro(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({
        action: 'override',
        conclusion: CARO_OUTCOME.notApplicableExempt,
        basis: 'Revenue restated below the limit after the audit adjustment.',
        technicalBasis: 'ICAI Guidance Note on CARO 2020 — total revenue as per the audited FS.',
        supportingEvidence: 'Adjusted trial balance and the restated revenue note.',
        version: caro.assessment.version,
      })
      .expect(201);
    const over = res.body as StatutoryAuditCaro;
    expect(over.assessment).toMatchObject({
      conclusion: CARO_OUTCOME.notApplicableExempt,
      systemOutcome: CARO_OUTCOME.applicable,
      isOverridden: true,
      state: 'overridden',
    });
    expect(over.partnerApproval).toMatchObject({ required: true, approvedAt: null });
    expect(over.completion!.items.find((i) => i.key === 'partner_approval')!.met).toBe(false);

    const approve = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/partner-approve`)
      .set(bearer(pa))
      .send({ note: 'Agreed.', version: over.assessment.version });
    if (over.viewerIsPartner) {
      expect(approve.status).toBe(201);
      expect((approve.body as StatutoryAuditCaro).partnerApproval!.approvedAt).toBeTruthy();
    } else {
      expect(approve.status).toBe(403);
    }

    // The Phase-02 area shows the same overridden conclusion.
    const fw = await request(app.getHttpServer())
      .get(`${base()}/framework`)
      .set(bearer(pa))
      .expect(200);
    const area = (
      fw.body[0].assessments as Array<{ areaKey: string; conclusion: string; state: string }>
    ).find((a) => a.areaKey === 'caro')!;
    expect(area).toMatchObject({ conclusion: 'not_applicable', state: 'overridden' });
  });

  it('the §19 checklist and report contexts are returned', async () => {
    const caro = await getCaro(pa);
    expect(caro.completion!.items.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        'version_resolved',
        'direct_exemptions',
        'private_test',
        'measurement',
        'report_context',
        'professional_conclusion',
        'partner_approval',
        'no_blocking_matter',
      ]),
    );
    expect(caro.detail!.reportContexts.map((c) => c.context)).toEqual([
      'standalone',
      'consolidated',
    ]);
  });

  it('records an immutable audit event for the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?limit=100`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.caro_decision');
  });

  it('CFS in scope (02.6) → clause 3(xxi) only, configured beside the paragraph 3 programme', async () => {
    const cfs = await request(app.getHttpServer())
      .get(`${base()}/consolidation`)
      .set(bearer(pa))
      .expect(200);
    const cfsRow = cfs.body[0] as { assessment: { systemOutcome: string | null; version: number } };
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/decision`)
      .set(bearer(pa))
      .send({
        conclusion: 'cfs_required',
        basis: 'E2E: the company has a subsidiary and prepares CFS.',
        version: cfsRow.assessment.version,
      })
      .expect(201);

    // 02.4 is confirmed applicable for the standalone report.
    const before = await getCaro(pa);
    const confirmed = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/decision`)
      .set(bearer(pa))
      .send({ action: 'confirm', version: before.assessment.version })
      .expect(201);
    const caro = confirmed.body as StatutoryAuditCaro;
    expect(caro.assessment.conclusion).toBe(CARO_OUTCOME.applicable);
    expect(caro.detail!.reportContexts[1]).toMatchObject({
      context: 'consolidated',
      status: 'applicable',
      scope: 'clause_3_xxi',
    });

    const prog = await request(app.getHttpServer())
      .get(`${base()}/${shellId}/caro/programme`)
      .set(bearer(pa))
      .expect(200);
    expect((prog.body.standalone as unknown[]).length).toBeGreaterThan(0);
    expect(prog.body.consolidated).toMatchObject({ reportContext: 'consolidated' });
    // The CFS item is the single 3(xxi) clause — never a duplicate paragraph 3 programme.
    expect(
      (prog.body.standalone as Array<{ reportContext: string }>).every(
        (i) => i.reportContext === 'standalone',
      ),
    ).toBe(true);

    const after = await getCaro(pa);
    expect(after.completion!.items.find((i) => i.key === 'work_programme')?.met).toBe(true);
    expect(after.completion!.items.find((i) => i.key === 'clause_3_xxi')?.met).toBe(true);
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.4 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/caro`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/caro/run-suggestions`)
      .set(bearer(pb))
      .expect(404);
  });
});

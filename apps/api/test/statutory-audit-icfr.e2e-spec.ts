import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ICFR_OUTCOME, type StatutoryAuditIcfr } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.5 Internal Financial Controls / ICFR Reporting — end-to-end (Guide §9.5;
 * DHVAJ 02.5 spec v1.1). Drives the shared sub-assessment through the API:
 * classification + small-company result from 02.1, turnover from the latest
 * audited FS, IFC-02 borrowing schedule (covered sources, intra-year peak),
 * IFC-03 traceable filings, IFC-04 confirm / override / information pending,
 * Engagement Partner approval, re-evaluation, the Section 02 mirror and the §35
 * outsider check.
 */
describe('Statutory Audit — 02.5 ICFR (e2e §9.5)', () => {
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
  const CRORE = 10_000_000;

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

  const getIcfr = async (t: string): Promise<StatutoryAuditIcfr> => {
    const res = await request(app.getHttpServer()).get(`${base()}/icfr`).set(bearer(t)).expect(200);
    return res.body[0] as StatutoryAuditIcfr;
  };
  const setFacts = async (body: Record<string, unknown>, status = 201) => {
    const icfr = await getIcfr(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/facts`)
      .set(bearer(pa))
      .send({ ...body, version: icfr.assessment.version })
      .expect(status);
    return res.body as StatutoryAuditIcfr;
  };
  const ifcArea = async () => {
    const fw = await request(app.getHttpServer())
      .get(`${base()}/framework`)
      .set(bearer(pa))
      .expect(200);
    return (
      fw.body[0].assessments as Array<{
        areaKey: string;
        systemSuggestion: string | null;
        systemBasis: string | null;
        conclusion: string | null;
        state: string;
      }>
    ).find((a) => a.areaKey === 'ifc')!;
  };
  const cond = (icfr: StatutoryAuditIcfr, key: string) =>
    icfr.detail!.conditions!.find((c) => c.key === key)!;

  /** Traceable on-time §137 / §92 filings (team-recorded IFC-03 records). */
  const ON_TIME = [
    {
      form: 'AOC-4',
      section: '137',
      period: '2023-24',
      dueDate: '2024-10-29',
      filedOn: '2024-10-20',
      srn: 'AB1234567',
      source: 'mca',
    },
    {
      form: 'MGT-7',
      section: '92',
      period: '2023-24',
      dueDate: '2024-11-28',
      filedOn: '2024-11-25',
      srn: 'AB7654321',
      source: 'mca',
    },
  ];

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

    // 02.1 financial data: a current-year (unaudited) ₹80cr and the preceding
    // year's audited ₹40cr turnover; paid-up capital decides "not small" in 02.1.
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'turnover', currentValue: 80 * CRORE, priorValue: 40 * CRORE })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'paid_up_capital', currentValue: 10 * CRORE, priorValue: 10 * CRORE })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('provisions one 02.5 assessment from 02.1: private route, turnover from the latest audited FS', async () => {
    const icfr = await getIcfr(pa);
    expect(icfr.assessment.subSectionKey).toBe('02.5');
    expect(icfr.detail!.entityRoute).toBe('private_company');
    expect(icfr.detail!.notificationVersion).toMatchObject({ code: 'MCA_ICFR_PVT_EXEMPTION' });
    // The preceding year's audited figure — never the current-year ₹80cr.
    expect(icfr.detail!.turnover).toMatchObject({ amount: 40 * CRORE, period: '2023-24' });
    expect(cond(icfr, 'turnover')).toMatchObject({
      result: 'satisfied',
      operator: '<',
      ruleCode: 'ICFR_EXEMPT_TURNOVER',
      measurementBasis: 'latest_audited_fs',
    });
    expect(icfr.detail!.routes!.map((r) => r.key)).toEqual(['opc', 'small_company']);
    expect(icfr.detail!.controlsPhaseUnaffected).toBe(true);
    expect(icfr.detail!.rule11gSeparate).toBe(true);
  });

  it('IFC-02: covered body-corporate debt is aggregated by date; the intra-year peak fails the limit', async () => {
    const icfr = await setFacts({
      filings: ON_TIME,
      borrowingDataBasis: 'monthly',
      borrowingSchedule: [
        { asOn: '2024-09-30', lender: 'HDFC Bank', source: 'bank', amount: 15 * CRORE },
        {
          asOn: '2024-09-30',
          lender: 'Acme Holdings',
          source: 'body_corporate',
          amount: 12 * CRORE,
        },
        { asOn: '2024-09-30', lender: 'Promoter', source: 'other', amount: 5 * CRORE },
        { asOn: '2025-03-31', lender: 'HDFC Bank', source: 'bank', amount: 15 * CRORE },
      ],
    });
    expect(icfr.detail!.borrowing).toMatchObject({
      maximumAggregate: 27 * CRORE,
      peakDate: '2024-09-30',
      excludedSources: ['other'],
      method: 'schedule',
    });
    expect(cond(icfr, 'borrowings').result).toBe('failed');
    expect(cond(icfr, 'filing').result).toBe('satisfied');
    expect(icfr.assessment.systemOutcome).toBe(ICFR_OUTCOME.applicable);
    expect(icfr.detail!.conclusion!.reason).toMatch(/Borrowing condition failed/);
    expect(icfr.assessment.authorityProvisionId).toBeTruthy();

    // The Section 02 list mirrors 02.5 — one ICFR answer everywhere.
    const area = await ifcArea();
    expect(area.systemSuggestion).toBe('applicable');
    expect(area.systemBasis).toMatch(/^02\.5 ICFR:/);
  });

  it('rejects an untraceable filing and a bad borrowing source', async () => {
    await setFacts({ filings: [{ form: 'AOC-4', section: '137', source: 'manual' }] }, 400);
    await setFacts(
      { borrowingSchedule: [{ asOn: '2024-09-30', lender: 'X', source: 'friend', amount: 1 }] },
      400,
    );
  });

  it('year-end-only data cannot prove "at any point"; IFC-04 Information Pending names it', async () => {
    const icfr = await setFacts({
      borrowingSchedule: null,
      peakCoveredBorrowings: 15 * CRORE,
      borrowingDataBasis: 'year_end_only',
    });
    expect(icfr.assessment.systemOutcome).toBe(ICFR_OUTCOME.informationInsufficient);
    expect(cond(icfr, 'borrowings').pendingReason).toMatch(/year-end/);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/decision`)
      .set(bearer(pa))
      .send({ action: 'confirm', version: icfr.assessment.version })
      .expect(400); // nothing decisive to confirm

    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/decision`)
      .set(bearer(pa))
      .send({ action: 'information_pending', version: icfr.assessment.version })
      .expect(201);
    const pending = res.body as StatutoryAuditIcfr;
    expect(pending.assessment.state).toBe('pending_information');
    expect(pending.pendingReason).toMatch(/Maximum aggregate covered borrowings/);
    expect((await ifcArea()).state).toBe('pending_information');
  });

  it('within both limits with traceable on-time filings → Exempt; Section 05 controls stay on', async () => {
    const icfr = await setFacts({
      peakCoveredBorrowings: 20 * CRORE,
      peakDate: '2024-12-31',
      borrowingDataBasis: 'monthly',
    });
    expect(icfr.assessment.systemOutcome).toBe(ICFR_OUTCOME.exempt);
    expect(icfr.detail!.monetaryTest).toEqual({
      tested: true,
      turnoverWithinLimit: true,
      borrowingsWithinLimit: true,
    });
    expect(icfr.detail!.monetaryJoin).toBe('and');
    expect(icfr.detail!.reportingApplies).toBe(false);
    expect(icfr.detail!.controlsPhaseUnaffected).toBe(true);
    expect((await ifcArea()).systemSuggestion).toBe('not_applicable');
  });

  it('a late filing makes the exemption unavailable even though both monetary tests pass', async () => {
    const late = [{ ...ON_TIME[0], filedOn: '2024-12-15' }, ON_TIME[1]];
    const icfr = await setFacts({ filings: late });
    expect(icfr.assessment.systemOutcome).toBe(ICFR_OUTCOME.applicable);
    expect(icfr.detail!.filingDefaultBlocks).toBe(true);
    expect(icfr.detail!.filing!.status).toBe('default_identified');
    // Back to traceable on-time filings.
    expect((await setFacts({ filings: ON_TIME })).assessment.systemOutcome).toBe(
      ICFR_OUTCOME.exempt,
    );
  });

  it('IFC-04 Confirm records the conclusion; a stale-version write is rejected (409)', async () => {
    const icfr = await getIcfr(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/decision`)
      .set(bearer(pa))
      .send({ action: 'confirm', version: icfr.assessment.version })
      .expect(201);
    const decided = res.body as StatutoryAuditIcfr;
    expect(decided.assessment).toMatchObject({
      conclusion: ICFR_OUTCOME.exempt,
      state: 'not_applicable',
      isOverridden: false,
    });
    expect(decided.professionalAction).toBe('confirm');
    expect(decided.partnerApproval!.required).toBe(false);
    expect(await ifcArea()).toMatchObject({
      conclusion: 'not_applicable',
      state: 'not_applicable',
    });

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/decision`)
      .set(bearer(pa))
      .send({ action: 'confirm', version: icfr.assessment.version })
      .expect(409);
  });

  it('a changed source fact flags Needs Re-evaluation naming the affected rule', async () => {
    const icfr = await setFacts({ peakCoveredBorrowings: 30 * CRORE });
    expect(icfr.assessment.conclusion).toBe(ICFR_OUTCOME.exempt); // frozen
    expect(icfr.reevaluation!.required).toBe(true);
    const change = icfr.reevaluation!.changes.find((c) => c.key === 'peak_borrowings')!;
    expect(change.affectedRules).toContain('ICFR_EXEMPT_BORROWINGS');
    expect(icfr.assessment.systemOutcome).toBe(ICFR_OUTCOME.applicable); // live, beside it
  });

  it('an override needs reason, technical basis and evidence, keeps the system result and needs the EP', async () => {
    const icfr = await getIcfr(pa);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/decision`)
      .set(bearer(pa))
      .send({
        action: 'override',
        conclusion: ICFR_OUTCOME.exempt,
        basis: 'Peak was a one-day overdraft swept the same day.',
        version: icfr.assessment.version,
      })
      .expect(400); // no technical basis / evidence

    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/decision`)
      .set(bearer(pa))
      .send({
        action: 'override',
        conclusion: ICFR_OUTCOME.exempt,
        basis: 'Peak was a one-day overdraft swept the same day.',
        technicalBasis: 'Management confirms the sweep; MCA notification read with the ICAI FAQ.',
        supportingEvidence: 'Bank statement for 30-Sep and the sweep confirmation.',
        version: icfr.assessment.version,
      })
      .expect(201);
    const over = res.body as StatutoryAuditIcfr;
    expect(over.assessment).toMatchObject({
      conclusion: ICFR_OUTCOME.exempt,
      systemOutcome: ICFR_OUTCOME.applicable,
      isOverridden: true,
      state: 'overridden',
    });
    expect(over.capturedFacts.technicalBasis).toMatch(/sweep/);
    expect(over.partnerApproval).toMatchObject({ required: true, approvedAt: null });
    expect(over.memoSuggested).toBe(true);
    expect(over.completion!.items.find((i) => i.key === 'partner_approval')!.met).toBe(false);

    const approve = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/partner-approve`)
      .set(bearer(pa))
      .send({ note: 'Agreed.', version: over.assessment.version });
    if (over.viewerIsPartner) {
      expect(approve.status).toBe(201);
      expect((approve.body as StatutoryAuditIcfr).partnerApproval!.approvedAt).toBeTruthy();
    } else {
      expect(approve.status).toBe(403);
    }
    expect(await ifcArea()).toMatchObject({ conclusion: 'not_applicable', state: 'overridden' });
  });

  it('returns the §23 checklist, report contexts and Facts Used', async () => {
    const icfr = await getIcfr(pa);
    expect(icfr.completion!.items.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        'version_resolved',
        'entity_route',
        'routes_evaluated',
        'turnover',
        'borrowings',
        'filing',
        'system_conclusion',
        'professional_conclusion',
        'partner_approval',
        'consolidated',
        'no_blocking_matter',
      ]),
    );
    expect(icfr.detail!.reportContexts!.map((c) => c.context)).toEqual([
      'standalone',
      'consolidated',
    ]);
    expect(icfr.detail!.factsUsed!.map((f) => f.key)).toEqual(
      expect.arrayContaining(['company_type', 'opc', 'small_company', 'turnover', 'filing']),
    );
  });

  it('records immutable audit events for the facts and the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?limit=100`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['statutory_audit.icfr_decision', 'statutory_audit.icfr_facts_set']),
    );
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.5 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/icfr`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/run-suggestions`)
      .set(bearer(pb))
      .expect(404);
    const approve = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/icfr/partner-approve`)
      .set(bearer(pb))
      .send({ version: 1 });
    expect([403, 404]).toContain(approve.status);
  });
});

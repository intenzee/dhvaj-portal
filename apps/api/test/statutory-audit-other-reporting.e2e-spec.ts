import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  OTHER_REPORTING_OUTCOME,
  REPORTING_CARD_KEYS,
  type StatutoryAuditOtherReporting,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.7 Other Companies Act & Statutory Reporting — end-to-end (Guide §9.7).
 * Drives the shared sub-assessment through the API: capture the reporting-matrix
 * facts, run the engine, record the professional conclusion, §35 outsider check.
 */
describe('Statutory Audit — 02.7 Other Reporting (e2e §9.7)', () => {
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

  const getOther = async (t: string): Promise<StatutoryAuditOtherReporting> => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/other-reporting`)
      .set(bearer(t))
      .expect(200);
    return res.body[0] as StatutoryAuditOtherReporting;
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

  it('provisions one 02.7 matrix; Rule 11(g) is in force for FY2024-25', async () => {
    const o = await getOther(pa);
    expect(o.assessment.subSectionKey).toBe('02.7');
    expect(o.baseFacts.auditTrailInForce).toBe(true);
    expect(o.detail!.rule11g.applicable).toBe(true);
  });

  const post = (t: string, path: string, body: object) =>
    request(app.getHttpServer())
      .post(`${base()}/${shellId}/other-reporting/${path}`)
      .set(bearer(t))
      .send(body)
      .expect((r) => {
        if (process.env.E2E_DEBUG && r.status >= 400)
          console.log(path, r.status, JSON.stringify(r.body));
      });
  const legacyAreas = async () => {
    const fw = await request(app.getHttpServer())
      .get(`${base()}/framework`)
      .set(bearer(pa))
      .expect(200);
    const rows = fw.body[0].assessments as Array<{
      areaKey: string;
      conclusion: string | null;
      state: string;
      systemBasis: string | null;
    }>;
    return Object.fromEntries(
      rows
        .filter((r) => r.areaKey === 'rule_11' || r.areaKey === 'section_143')
        .map((r) => [r.areaKey, r]),
    );
  };
  const blocking = (o: StatutoryAuditOtherReporting) =>
    o.detail!.missingFacts.filter((m) => m.blocking).map((m) => m.key);

  it('instantiates the full requirement matrix; a private company does not activate Section 197(16)', async () => {
    const o = await getOther(pa);
    expect(o.detail!.cards.length).toBe(REPORTING_CARD_KEYS.length);
    const s197 = o.detail!.cards.find((c) => c.key === 's197_16_remuneration')!;
    expect(s197.applicability).toBe('not_applicable');
    expect(o.detail!.remuneration.applicable).toBe(false);
    expect(o.detail!.rule11Version).toBeTruthy();
    // Nothing answered yet → blocking pending facts, and Confirm is refused.
    expect(blocking(o).length).toBeGreaterThan(0);
    expect(o.assessment.systemOutcome).toBe(OTHER_REPORTING_OUTCOME.informationInsufficient);
    await post(pa, 'decision', { action: 'confirm', version: o.assessment.version }).expect(400);
  });

  it('Information Pending records the blocking facts', async () => {
    const o = await getOther(pa);
    const res = await post(pa, 'decision', {
      action: 'information_pending',
      version: o.assessment.version,
    }).expect(201);
    const p = res.body as StatutoryAuditOtherReporting;
    expect(p.assessment.state).toBe('pending_information');
    expect(p.pendingReason).toMatch(/^Blocked on: /);
  });

  it('captures the facts; a reportable fraud routes to the Central Government with Rule 13 dates', async () => {
    const before = await getOther(pa);
    const res = await post(pa, 'facts', {
      booksProper: 'yes',
      informationObtained: 'yes',
      adverseObservations: 'no',
      accountsQualification: 'no',
      softwareSystems: [
        {
          name: 'Tally Prime',
          module: 'gl',
          featureStatus: 'available',
          enabledThroughout: 'yes',
          transactionsCovered: 'complete',
          canAlterOrDisable: 'no',
          tampering: 'no',
          preservation: 'compliant',
        },
      ],
      litigation: { identified: 'no' },
      foreseeableLosses: { hasLongTermContracts: 'no', hasDerivativeContracts: 'no' },
      iepf: { status: 'not_applicable' },
      dividend: { declaredOrPaid: false },
      rule11eAdvanced: {
        transactionsIdentified: 'no',
        representationObtained: 'yes',
        contraryMatter: 'no',
      },
      rule11eReceived: {
        transactionsIdentified: 'no',
        representationObtained: 'yes',
        contraryMatter: 'no',
      },
      fraudIdentified: true,
      fraudAmount: 20000000, // ₹2cr → CG route
      fraudEventDate: '2024-06-01',
      version: before.assessment.version,
    }).expect(201);
    const o = res.body as StatutoryAuditOtherReporting;
    expect(o.detail!.fraud.route).toBe('central_government');
    expect(o.detail!.fraud.boardReplyByDate).toBe('2024-07-16');
    expect(o.detail!.fraud.cgForwardByDate).toBe('2024-07-31');
    expect(o.detail!.rule11g.systems[0]!.conclusion).toBe('compliant');
    expect(o.detail!.rule11g.retentionYears).toBe(8);
    expect(blocking(o)).toEqual([]);
    expect(o.assessment.systemOutcome).toBe(OTHER_REPORTING_OUTCOME.attentionRequired);
    expect(o.assessment.authorityProvisionId).toBeTruthy();
  });

  it('Confirm concludes 02.7 and the Section 02 Rule 11 / Section 143 areas; a stale write is 409', async () => {
    const o = await getOther(pa);
    const res = await post(pa, 'decision', {
      action: 'confirm',
      version: o.assessment.version,
    }).expect(201);
    const decided = res.body as StatutoryAuditOtherReporting;
    expect(decided.assessment.conclusion).toBe(OTHER_REPORTING_OUTCOME.attentionRequired);
    expect(decided.partnerApproval!.required).toBe(false);
    const areas = await legacyAreas();
    expect(areas.rule_11).toMatchObject({ conclusion: 'applicable', state: 'applicable' });
    expect(areas.section_143).toMatchObject({ conclusion: 'applicable', state: 'applicable' });
    expect(areas.rule_11!.systemBasis).toMatch(/02\.7/);

    await post(pa, 'decision', {
      conclusion: OTHER_REPORTING_OUTCOME.configured,
      basis: 'Stale-version check (e2e).',
      technicalBasis: 'n/a',
      supportingEvidence: 'n/a',
      version: o.assessment.version,
    }).expect(409);
  });

  it('an override needs a reason, a technical basis and supporting evidence (§3)', async () => {
    const o = await getOther(pa);
    const v = o.assessment.version;
    const conclusion = OTHER_REPORTING_OUTCOME.configured;
    await post(pa, 'decision', { conclusion, version: v }).expect(400);
    await post(pa, 'decision', {
      conclusion,
      basis: 'Fraud already reported last year.',
      version: v,
    }).expect(400);
    await post(pa, 'decision', {
      conclusion,
      basis: 'Fraud already reported last year.',
      technicalBasis: 'Section 143(12) report filed in FY2023-24 (ADT-4).',
      version: v,
    }).expect(400);
  });

  it('a significant override needs the Engagement Partner, and the cards stay workable after approval', async () => {
    const o = await getOther(pa);
    const res = await post(pa, 'decision', {
      conclusion: OTHER_REPORTING_OUTCOME.configured,
      basis: 'Fraud already reported last year.',
      technicalBasis: 'Section 143(12) report filed in FY2023-24 (ADT-4).',
      supportingEvidence: 'ADT-4 SRN on file.',
      version: o.assessment.version,
    }).expect(201);
    const over = res.body as StatutoryAuditOtherReporting;
    expect(over.assessment.state).toBe('overridden');
    expect(over.partnerApproval!.required).toBe(true);
    expect(over.completion!.items.find((i) => i.key === 'partner_approval')!.met).toBe(false);
    expect((await legacyAreas()).rule_11!.conclusion).toBe('applicable');

    const approve = await post(pa, 'partner-approve', {
      note: 'Agreed.',
      version: over.assessment.version,
    });
    expect(over.viewerIsPartner).toBe(true);
    expect(approve.status).toBe(201);
    const approved = approve.body as StatutoryAuditOtherReporting;
    expect(approved.partnerApproval!.approvedAt).toBeTruthy();
    expect(approved.completion!.items.find((i) => i.key === 'partner_approval')!.met).toBe(true);

    // Cards remain Work Pending after approval (spec §20) and are still workable.
    expect(approved.detail!.cards.every((c) => c.state.workStatus === 'not_started')).toBe(true);
    await post(pa, 'cards/s143_3_a_information', {
      workStatus: 'complete',
      exceptions: 1,
      version: 0,
    }).expect(400);
    const card = await post(pa, 'cards/s143_3_a_information', {
      workStatus: 'complete',
      reportingStatus: 'unmodified_expected',
      exceptions: 0,
      reviewed: true,
      version: 0,
    }).expect(201);
    const c = (card.body as StatutoryAuditOtherReporting).detail!.cards.find(
      (x) => x.key === 's143_3_a_information',
    )!;
    expect(c.state.workStatus).toBe('complete');
    expect(c.state.reviewedByName).toBeTruthy();
    expect(c.state.version).toBe(1);
    await post(pa, 'cards/s143_3_a_information', { workStatus: 'in_progress', version: 0 }).expect(
      409,
    );
    await post(pa, 'cards/not_a_card', { workStatus: 'in_progress', version: 0 }).expect(400);
  });

  it('a fact change after the decision: an exception refreshes, an applicability change flags re-evaluation', async () => {
    const o = await getOther(pa);
    const exception = await post(pa, 'facts', {
      booksProper: 'no',
      version: o.assessment.version,
    }).expect(201);
    const e = exception.body as StatutoryAuditOtherReporting;
    expect(e.assessment.needsReevaluation).toBe(false);
    expect(e.detail!.cards.find((c) => c.key === 's143_3_b_books')!.systemExceptions.length).toBe(
      1,
    );
    const route = await post(pa, 'facts', {
      dividend: { declaredOrPaid: true, kind: 'final', section123Compliant: 'yes' },
      version: e.assessment.version,
    }).expect(201);
    expect((route.body as StatutoryAuditOtherReporting).assessment.needsReevaluation).toBe(true);
  });

  it('records an immutable audit event for the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?limit=100`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'statutory_audit.other_reporting_decision',
        'statutory_audit.other_reporting_partner_approved',
        'statutory_audit.other_reporting_card_updated',
      ]),
    );
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.7 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/other-reporting`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/other-reporting/run-suggestions`)
      .set(bearer(pb))
      .expect(404);
  });
});

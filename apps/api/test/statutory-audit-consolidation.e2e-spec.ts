import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CONSOLIDATION_OUTCOME,
  type StatutoryAuditConsolidation,
  type StatutoryAuditFinancialReporting,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.6 Consolidation / Group Audit Framework — end-to-end (Guide §9.6). Drives
 * the shared sub-assessment through the API: information-insufficient until 02.2
 * is concluded, then classifies the perimeter and decides CFS required under
 * §129(3), records the professional conclusion, and the §35 outsider check.
 */
describe('Statutory Audit — 02.6 Consolidation (e2e §9.6)', () => {
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

  const getConsolidation = async (t: string): Promise<StatutoryAuditConsolidation> => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/consolidation`)
      .set(bearer(t))
      .expect(200);
    return res.body[0] as StatutoryAuditConsolidation;
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

    // A ₹600cr net worth drives 02.2 to Ind AS, which 02.6 routes from.
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'net_worth', currentValue: 6000000000 })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('provisions one 02.6 assessment that is information-insufficient until 02.2 is concluded', async () => {
    const c = await getConsolidation(pa);
    expect(c.assessment.subSectionKey).toBe('02.6');
    expect(c.assessment.systemOutcome).toBe(CONSOLIDATION_OUTCOME.informationInsufficient);
    expect(c.upstreamReady).toBe(false);
  });

  it('classifies a subsidiary and requires CFS once 02.2 concludes Ind AS', async () => {
    // Conclude 02.2 = Ind AS.
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/financial-reporting/run-suggestions`)
      .set(bearer(pa))
      .expect(201);
    const fr = (
      await request(app.getHttpServer())
        .get(`${base()}/financial-reporting`)
        .set(bearer(pa))
        .expect(200)
    ).body[0] as StatutoryAuditFinancialReporting;
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/financial-reporting/decision`)
      .set(bearer(pa))
      .send({ conclusion: 'ind_as', version: fr.assessment.version })
      .expect(201);

    // Capture a controlled subsidiary in the perimeter.
    const before = await getConsolidation(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/facts`)
      .set(bearer(pa))
      .send({
        investees: [{ name: 'Bharat Subsidiary Pvt Ltd', ownershipPercent: 100, hasControl: true }],
        version: before.assessment.version,
      })
      .expect(201);
    const c = res.body as StatutoryAuditConsolidation;
    expect(c.assessment.systemOutcome).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
    expect(c.detail!.cfsTriggered).toBe(true);
    expect(c.detail!.perimeter[0]?.relationship).toBe('subsidiary');
    expect(c.assessment.authorityProvisionId).toBeTruthy(); // §129(3) frozen period-correct
  });

  it('records the professional conclusion, and rejects a stale-version write (409)', async () => {
    const c = await getConsolidation(pa);
    const res = await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/decision`)
      .set(bearer(pa))
      .send({ conclusion: CONSOLIDATION_OUTCOME.cfsRequired, version: c.assessment.version })
      .expect(201);
    const decided = res.body as StatutoryAuditConsolidation;
    expect(decided.assessment.conclusion).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
    expect(decided.assessment.state).toBe('applicable');

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/decision`)
      .set(bearer(pa))
      // A justified override, so the only fault is the stale version.
      .send({
        conclusion: CONSOLIDATION_OUTCOME.cfsExempt,
        basis: 'Stale-version check (e2e).',
        version: c.assessment.version,
      })
      .expect(409);
  });

  it('overriding to CFS-exempt without a basis is rejected (§19)', async () => {
    const c = await getConsolidation(pa);
    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/decision`)
      .set(bearer(pa))
      .send({ conclusion: CONSOLIDATION_OUTCOME.cfsExempt, version: c.assessment.version })
      .expect(400); // differs from the system's cfs_required → basis required
  });

  it('records an immutable audit event for the decision', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?limit=100`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.consolidation_decision');
  });

  it('an outsider (not on the engagement) cannot read or mutate 02.6 (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/consolidation`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/run-suggestions`)
      .set(bearer(pb))
      .expect(404);
  });

  // ── Track A: Section 02 mirror, perimeter, CFS-05 EP approval, CFS-04, roll-forward ──

  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`${base()}/${shellId}/consolidation/${path}`)
      .set(bearer(t))
      .send(body);
  const employeeId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/employees?limit=100')
      .set(bearer(mp))
      .expect(200);
    return (res.body.items as Array<{ employeeCode: string; id: string }>).find(
      (e) => e.employeeCode === code,
    )!.id;
  };
  const cfsArea = async () => {
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
    ).find((a) => a.areaKey === 'cfs')!;
  };
  const SUB_NAME = 'Bharat Subsidiary Pvt Ltd';
  const DISPUTED = 'Disputed Holdings Ltd';

  it('the Section 02 "CFS" area mirrors the 02.6 conclusion — one answer everywhere', async () => {
    const area = await cfsArea();
    expect(area.systemSuggestion).toBe('applicable');
    expect(area.conclusion).toBe('applicable');
    expect(area.systemBasis).toMatch(/^02\.6 Consolidation:/);
  });

  it('rejects a duplicate component, both subsidiary flags and an unexplained perimeter change', async () => {
    const c = await getConsolidation(pa);
    const v = c.assessment.version;
    const sub = c.capturedFacts.investees.find((i) => i.name === SUB_NAME)!;
    expect(sub.id).toBeTruthy(); // a stable component id, shared with Track B
    await post(pa, 'facts', {
      investees: [{ name: 'Twin Ltd' }, { name: 'twin ltd' }],
      version: v,
    }).expect(400);
    await post(pa, 'facts', {
      isWhollyOwnedSubsidiary: true,
      isPartiallyOwnedSubsidiary: true,
      version: v,
    }).expect(400);
    const res = await post(pa, 'facts', {
      investees: [
        { id: sub.id, name: SUB_NAME, ownershipPercent: 100, hasControl: true, included: 'no' },
      ],
      version: v,
    }).expect(400);
    expect(res.body.message).toMatch(/reason for changing the system's inclusion proposal/);
  });

  it('a control dispute needs the Engagement Partner, and only the EP approves (CFS-05)', async () => {
    const eng = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}`)
      .set(bearer(pa))
      .expect(200);
    expect(eng.body.engagementPartnerId).toBe(await employeeId('EMP003')); // partner.a

    let c = await getConsolidation(pa);
    const sub = c.capturedFacts.investees.find((i) => i.name === SUB_NAME)!;
    c = (
      await post(pa, 'facts', {
        investees: [
          {
            id: sub.id,
            name: SUB_NAME,
            ownershipPercent: 100,
            hasControl: true,
            controlConclusion: 'yes',
          },
          {
            name: DISPUTED,
            votingDirect: 60,
            controlConclusion: 'no',
            significantInfluence: 'yes',
          },
        ],
        version: c.assessment.version,
      }).expect(201)
    ).body as StatutoryAuditConsolidation;
    expect(c.assessment.systemOutcome).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
    expect(c.capturedFacts.investees.find((i) => i.name === SUB_NAME)!.id).toBe(sub.id);
    // The decided perimeter changed → the conclusion is flagged for re-evaluation.
    expect(c.assessment.needsReevaluation).toBe(true);
    expect(c.detail!.perimeter.find((p) => p.name === DISPUTED)?.presumptionRebutted).toMatch(
      /No control concluded/,
    );

    c = (
      await post(pa, 'decision', { action: 'confirm', version: c.assessment.version }).expect(201)
    ).body as StatutoryAuditConsolidation;
    expect(c.assessment.needsReevaluation).toBe(false);
    expect(c.partnerApproval?.required).toBe(true);
    expect(c.partnerApproval?.reason).toMatch(new RegExp(DISPUTED));
    expect(c.completion?.complete).toBe(false);

    await post(mp, 'partner-approval', { version: c.assessment.version }).expect(403);
    c = (
      await post(pa, 'partner-approval', {
        note: 'Reviewed the control memo for Disputed Holdings.',
        version: c.assessment.version,
      }).expect(201)
    ).body as StatutoryAuditConsolidation;
    expect(c.partnerApproval?.approvedAt).toBeTruthy();
    expect(c.completion?.items.find((i) => i.key === 'manager_and_partner')?.met).toBe(true);
    await post(pa, 'partner-approval', { version: c.assessment.version }).expect(400);
  });

  it('a component on another GAAP gets a CFS-04 conversion work item through to completion', async () => {
    let c = await getConsolidation(pa);
    const sub = c.capturedFacts.investees.find((i) => i.name === SUB_NAME)!;
    const disputed = c.capturedFacts.investees.find((i) => i.name === DISPUTED)!;
    const disputedDto = {
      id: disputed.id,
      name: DISPUTED,
      votingDirect: 60,
      controlConclusion: 'no',
      significantInfluence: 'yes',
    };
    const subDto = (localFramework: string) => ({
      id: sub.id,
      name: SUB_NAME,
      ownershipPercent: 100,
      hasControl: true,
      controlConclusion: 'yes',
      reportingDate: '2025-03-31',
      localFramework,
    });
    c = (
      await post(pa, 'facts', {
        investees: [subDto('ifrs'), disputedDto],
        version: c.assessment.version,
      }).expect(201)
    ).body as StatutoryAuditConsolidation;
    const conv = c.conversions!.find((x) => x.componentId === sub.id)!;
    expect(conv).toMatchObject({
      status: 'open',
      localFramework: 'ifrs',
      groupFramework: 'ind_as',
    });

    const patch = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .patch(`${base()}/${shellId}/consolidation/conversions/${conv.id}`)
        .set(bearer(pa))
        .send(body);
    // Completed needs the reviewer AND the final adjusted group TB.
    await patch({ status: 'completed', version: conv.version }).expect(400);
    // The reviewer must be on the engagement team.
    await patch({ reviewerEmployeeId: await employeeId('EMP004'), version: conv.version }).expect(
      400,
    );
    await patch({ status: 'withdrawn', version: conv.version }).expect(400);

    const doc = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/documents`)
      .set(bearer(pa))
      .send({
        title: 'Adjusted group TB — Bharat Subsidiary',
        documentType: 'working_paper',
        filename: 'adjusted-tb.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from('adjusted tb').toString('base64'),
      })
      .expect(201);
    const done = (
      await patch({
        status: 'completed',
        reviewerEmployeeId: await employeeId('EMP003'),
        adjustedTbDocumentId: doc.body.id,
        differences: [
          {
            area: 'Revenue',
            description: 'IFRS 15 vs Ind AS 115 — no difference',
            adjustmentReference: 'ADJ-1',
          },
        ],
        version: conv.version,
      }).expect(200)
    ).body as StatutoryAuditConsolidation;
    const item = done.conversions!.find((x) => x.id === conv.id)!;
    expect(item).toMatchObject({
      status: 'completed',
      reviewerName: 'Partner A',
      adjustedTbName: 'Adjusted group TB — Bharat Subsidiary',
    });
    expect(item.differences).toHaveLength(1);
    expect(item.reviewedAt).toBeTruthy();
    // Clearing the TB of a completed item is refused (400, not a constraint 500).
    await patch({ adjustedTbDocumentId: null, version: item.version }).expect(400);
    await patch({ status: 'open', version: conv.version }).expect(409); // stale

    // Aligning the component withdraws the work item — never deleted.
    c = await getConsolidation(pa);
    c = (
      await post(pa, 'facts', {
        investees: [subDto('ind_as'), disputedDto],
        version: c.assessment.version,
      }).expect(201)
    ).body as StatutoryAuditConsolidation;
    expect(c.conversions!.find((x) => x.id === conv.id)?.status).toBe('withdrawn');
  });

  it('Information Pending names what is pending; the Section 02 area shows it pending', async () => {
    let c = await getConsolidation(pa);
    c = (
      await post(pa, 'decision', {
        action: 'information_pending',
        pendingReason: 'Awaiting the shareholder agreement for Disputed Holdings Ltd.',
        version: c.assessment.version,
      }).expect(201)
    ).body as StatutoryAuditConsolidation;
    expect(c.assessment.state).toBe('pending_information');
    expect(c.professionalAction).toBe('information_pending');
    expect(c.pendingReason).toMatch(/shareholder agreement/);
    expect(c.completion?.complete).toBe(false);
    const area = await cfsArea();
    expect(area.state).toBe('pending_information');
    expect(area.conclusion).toBeNull();
  });

  it('an override needs the reason, technical basis and evidence, then the Engagement Partner', async () => {
    let c = await getConsolidation(pa);
    const v = c.assessment.version;
    const override = {
      action: 'override',
      conclusion: CONSOLIDATION_OUTCOME.cfsExempt,
      basis: 'Intermediate wholly-owned subsidiary; Rule 6 conditions met.',
      version: v,
    };
    await post(pa, 'decision', override).expect(400); // no technical basis
    await post(pa, 'decision', {
      ...override,
      technicalBasis: 'Rule 6, Companies (Accounts) Rules 2014',
    }).expect(400); // no supporting evidence
    c = (
      await post(pa, 'decision', {
        ...override,
        technicalBasis: 'Rule 6, Companies (Accounts) Rules 2014',
        supportingEvidence: 'Ultimate parent CFS filed with the ROC; members no-objection on file.',
      }).expect(201)
    ).body as StatutoryAuditConsolidation;
    expect(c.assessment).toMatchObject({
      conclusion: CONSOLIDATION_OUTCOME.cfsExempt,
      systemOutcome: CONSOLIDATION_OUTCOME.cfsRequired,
      isOverridden: true,
      state: 'overridden',
    });
    expect(c.partnerApproval?.required).toBe(true);
    expect(c.partnerApproval?.reason).toMatch(/significant override/);
    expect(c.memoSuggested).toBe(true);
    expect(await cfsArea()).toMatchObject({
      systemSuggestion: 'applicable',
      conclusion: 'not_applicable',
      state: 'overridden',
    });
  });

  it('rolls the prior-year perimeter forward with stable component ids (spec §21)', async () => {
    const entityId = await findId('/api/v1/entities?search=Acme&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    // Years no other spec uses, so "the prior year" is unambiguous.
    const open = async (financialYear: string): Promise<{ eng: string; shell: string }> => {
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
      const eng = created.body.id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/services`)
        .set(bearer(pa))
        .send({ serviceId: statAuditId })
        .expect(201);
      const shells = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/statutory-audit`)
        .set(bearer(pa))
        .expect(200);
      return { eng, shell: shells.body[0].workflowInstanceId as string };
    };
    const consolidationOf = async (eng: string): Promise<StatutoryAuditConsolidation> =>
      (
        await request(app.getHttpServer())
          .get(`/api/v1/engagements/${eng}/statutory-audit/consolidation`)
          .set(bearer(pa))
          .expect(200)
      ).body[0] as StatutoryAuditConsolidation;

    const prior = await open('2031-32');
    const p0 = await consolidationOf(prior.eng);
    const saved = (
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${prior.eng}/statutory-audit/${prior.shell}/consolidation/facts`)
        .set(bearer(pa))
        .send({
          investees: [
            { name: 'Rollforward Sub Ltd', ownershipPercent: 75, controlConclusion: 'yes' },
          ],
          version: p0.assessment.version,
        })
        .expect(201)
    ).body as StatutoryAuditConsolidation;
    const priorId = saved.capturedFacts.investees.find((i) => i.name === 'Rollforward Sub Ltd')!.id;

    const current = await open('2032-33');
    const c = await consolidationOf(current.eng);
    const rolled = c.capturedFacts.investees.find((i) => i.name === 'Rollforward Sub Ltd');
    expect(rolled?.id).toBe(priorId);
    expect(rolled?.ownershipPercent).toBe(75);
    expect(c.priorYear?.financialYear).toBe('2031-32');
  });
});

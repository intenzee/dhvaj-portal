import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import type {
  AnalyticsLibrary,
  BusinessUnderstandingSummary,
  InvestigationCardRecord,
  PlanningEvidenceView,
  UnderstandingRevisionDetail,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { approveFrameworkForTest } from './framework-approval.helper';

/**
 * 03.2 governance (DHVAJ 03.2 §7, §18, §20, §21, §23):
 *   G1 the §23 role matrix — the team records facts, the Manager reviews /
 *      assesses / completes, the EP challenges;
 *   G2 §21 a figure rolled forward from last year's approved 03.2 needs a
 *      reason to change;
 *   G3 §7 the Manager confirms each suggested industry consideration;
 *   G4 evidence on 03.2 records;
 *   G5 an open EP challenge blocks completion until answered;
 *   G6 §20 completion freezes 03.2 (writes and evidence → 409); reopening makes
 *      v1.1 with a frozen baseline and a diff of what changed;
 *   G7 a methodology change after completion (Refresh analytics) that surfaces
 *      a new exception flags the completed 03.2 for reassessment (v1.2).
 */
describe('Statutory Audit — 03.2 governance (e2e)', () => {
  let app: INestApplication;
  let pa: string; // Engagement Partner
  let mx: string; // Engagement Manager
  let sy: string; // Senior (engagement team)
  let mp: string; // Methodology Admin (service.manage)
  let su: Client;
  let ids: Map<string, string>;
  let engId: string;
  let shellId: string;
  let base: string;
  let eng: string;

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
  const get = (t: string, url: string) => request(app.getHttpServer()).get(url).set(bearer(t));
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const findId = async (path: string): Promise<string> =>
    (await get(pa, path).expect(200)).body.items[0].id as string;
  const summary = async (t = mx): Promise<BusinessUnderstandingSummary> =>
    (await get(t, `${base}/business-understanding`).expect(200))
      .body as BusinessUnderstandingSummary;
  const cards = async (): Promise<InvestigationCardRecord[]> =>
    (await get(mx, `${base}/analytics-exceptions`).expect(200)).body as InvestigationCardRecord[];
  const notes = async (email: string, type: string): Promise<string[]> => {
    const { rows } = await su.query<{ title: string }>(
      `SELECT n.title FROM hsdg.notifications n JOIN hsdg.users u ON u.id = n.recipient_user_id
        WHERE u.email = $1 AND n.type = $2 AND n.engagement_id = $3 ORDER BY n.created_at`,
      [email, type, engId],
    );
    return rows.map((r) => r.title);
  };

  const newFile = async (entityId: string, financialYear: string) => {
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const e = await post(pa, '/api/v1/engagements', {
      entityId,
      serviceId: stat,
      financialYear,
      periodLabel: `P${stamp()}`,
      status: 'accepted',
      engagementManagerEmployeeId: ids.get('Manager X'),
    }).expect(201);
    const id = e.body.id as string;
    await post(pa, `/api/v1/engagements/${id}/team`, {
      employeeId: ids.get('Senior Y'),
      roleOnEngagement: 'in_charge',
    }).expect(201);
    const e2 = `/api/v1/engagements/${id}/statutory-audit`;
    const shell = (await get(pa, e2).expect(200)).body[0].workflowInstanceId as string;
    await approveFrameworkForTest(shell);
    return { id, shell, eng: e2, base: `${e2}/${shell}` };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    mp = await token('mp@dhvaj.in');
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    const { rows } = await su.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM hsdg.employees WHERE full_name IN ('Manager X', 'Senior Y')`,
    );
    ids = new Map(rows.map((r) => [r.full_name, r.id]));

    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Understanding Governance ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    // Last year's file: revenue 1,000 in its 03.2, which was completed (approved).
    const py = await newFile(entity.body.id as string, '2023-24');
    const pyBu = (await get(mx, `${py.base}/business-understanding`).expect(200))
      .body as BusinessUnderstandingSummary;
    await post(mx, `${py.base}/financial-dataset`, {
      periodEnd: '2024-03-31',
      currency: 'INR',
      units: 'inr_lakh',
      dataStatus: 'final',
      cySource: 'Audited FS FY24',
      version: pyBu.dataset.version ?? 0,
    }).expect(201);
    await post(mx, `${py.base}/financial-dataset/values`, {
      values: [
        { metricKey: 'revenue', period: 'cy', amount: 1000, sourceType: 'draft_fs', version: 0 },
      ],
    }).expect(201);
    await su.query(
      `UPDATE hsdg.audit_business_understanding SET status = 'complete', ba01 = 'yes_complete'
        WHERE workflow_instance_id = $1`,
      [py.shell],
    );

    const cy = await newFile(entity.body.id as string, '2024-25');
    engId = cy.id;
    shellId = cy.shell;
    eng = cy.eng;
    base = cy.base;
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('G1 — the team records facts; the Manager reviews and assesses; the EP reviews', async () => {
    // The Senior's first open seeds 03.2 from the masters and last year's file.
    const team = await summary(sy);
    expect(team.access).toMatchObject({ role: 'team', locked: false });
    expect(team.access.capabilities).toMatchObject({
      addFacts: true,
      assess: false,
      reopen: false,
    });
    expect(team.versionInfo.versionLabel).toBe('v1.0');
    expect(team.authorityAnchors).toEqual(expect.arrayContaining(['view_sa_315', 'view_sa_520']));

    const bm = team.sections.find((x) => x.key === 'business_model')!;
    const saved = await post(sy, `${base}/business-understanding/sections/business_model`, {
      anythingChanged: 'yes',
      answers: { activities: ['Services'], activities_note: 'IT consulting' },
      version: bm.version,
    }).expect(201);
    // Marking reviewed is the Manager's.
    await post(sy, `${base}/business-understanding/sections/business_model`, {
      reviewed: true,
      version: saved.body.version,
    }).expect(403);
    // BA-01 and the industry profile are the Manager's too.
    await post(sy, `${base}/business-understanding`, {
      industryProfile: 'construction',
      version: team.record.version,
    }).expect(403);

    const ep = await summary(pa);
    expect(ep.access.capabilities).toMatchObject({ partnerReview: true, assess: false });
    const mgr = await summary(mx);
    expect(mgr.access).toMatchObject({ role: 'manager' });
    expect(mgr.access.capabilities).toMatchObject({ assess: true, respondToChallenge: true });
  });

  it('G2 — a figure rolled forward from last year’s approved 03.2 needs a reason to change', async () => {
    const s = await summary();
    const pyRevenue = s.values.find((v) => v.metricKey === 'revenue' && v.period === 'py')!;
    expect(pyRevenue.amount).toBe(1000);
    expect(pyRevenue.rolledForward).toMatchObject({
      amount: 1000,
      approved: true,
      fromFinancialYear: '2023-24',
    });

    await post(sy, `${base}/financial-dataset/values`, {
      values: [
        {
          metricKey: 'revenue',
          period: 'py',
          amount: 1100,
          sourceType: 'audited_py_fs',
          version: pyRevenue.version,
        },
      ],
    }).expect(400);
    // Same figure, no reason needed; current-year figures are free.
    await post(sy, `${base}/financial-dataset/values`, {
      values: [
        {
          metricKey: 'revenue',
          period: 'py',
          amount: 1000,
          sourceType: 'audited_py_fs',
          version: pyRevenue.version,
        },
        { metricKey: 'revenue', period: 'cy', amount: 1000, sourceType: 'draft_fs', version: 0 },
      ],
    }).expect(201);
    const after = await summary();
    const v = after.values.find((x) => x.metricKey === 'revenue' && x.period === 'py')!;
    const changed = (
      await post(sy, `${base}/financial-dataset/values`, {
        values: [
          {
            metricKey: 'revenue',
            period: 'py',
            amount: 1010,
            sourceType: 'audited_py_fs',
            overrideReason: 'PY restated — note 42 of the FY25 statements',
            version: v.version,
          },
        ],
      }).expect(201)
    ).body as BusinessUnderstandingSummary;
    expect(
      changed.values.find((x) => x.metricKey === 'revenue' && x.period === 'py'),
    ).toMatchObject({
      amount: 1010,
      overrideReason: 'PY restated — note 42 of the FY25 statements',
    });
  });

  it('G3 — the Manager confirms each suggested industry consideration', async () => {
    const s = await summary();
    const profiled = (
      await post(mx, `${base}/business-understanding`, {
        industryProfile: 'construction',
        version: s.record.version,
      }).expect(201)
    ).body as BusinessUnderstandingSummary;
    expect(profiled.industryConsiderations.length).toBeGreaterThan(0);
    expect(profiled.completion.find((c) => c.key === 'considerations')?.met).toBe(false);
    const [first, ...rest] = profiled.industryConsiderations;
    await post(sy, `${base}/business-understanding/considerations`, {
      consideration: first,
      relevant: true,
    }).expect(403);
    await post(mx, `${base}/business-understanding/considerations`, {
      consideration: 'Not on the list',
      relevant: true,
    }).expect(400);
    let out = (
      await post(mx, `${base}/business-understanding/considerations`, {
        consideration: first,
        relevant: true,
        note: 'Long-term contracts',
      }).expect(201)
    ).body as BusinessUnderstandingSummary;
    expect(out.industryConsiderationDecisions[first!]).toMatchObject({
      relevant: true,
      note: 'Long-term contracts',
      byName: 'Manager X',
    });
    for (const c of rest) {
      out = (
        await post(mx, `${base}/business-understanding/considerations`, {
          consideration: c,
          relevant: false,
        }).expect(201)
      ).body as BusinessUnderstandingSummary;
    }
    expect(out.completion.find((c) => c.key === 'considerations')?.met).toBe(true);
    // Clearing a decision takes it back.
    out = (
      await post(mx, `${base}/business-understanding/considerations`, {
        consideration: first,
        relevant: null,
      }).expect(201)
    ).body as BusinessUnderstandingSummary;
    expect(out.industryConsiderationDecisions[first!]).toBeUndefined();
    await post(mx, `${base}/business-understanding/considerations`, {
      consideration: first,
      relevant: true,
    }).expect(201);
  });

  it('G4 — evidence attaches to 03.2 sections and expectations', async () => {
    const s = await summary();
    const sectionId = s.recordIds.sections.business_model!;
    expect(sectionId).toBeTruthy();
    const q = `${base}/planning-evidence?targetType=understanding_section&targetId=${sectionId}`;
    const view = (
      await post(mx, `${base}/planning-evidence/add`, {
        targetType: 'understanding_section',
        targetId: sectionId,
        filename: 'org-chart.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from('Org chart').toString('base64'),
      }).expect(201)
    ).body as PlanningEvidenceView;
    expect(view.files).toHaveLength(1);
    expect(((await get(sy, q).expect(200)).body as PlanningEvidenceView).files).toHaveLength(1);
    expect((await summary()).evidenceCounts[sectionId]).toBe(1);
    // A record on another file is refused.
    await post(mx, `${base}/planning-evidence/add`, {
      targetType: 'understanding_section',
      targetId: '00000000-0000-4000-8000-000000000000',
      filename: 'x.txt',
      contentBase64: Buffer.from('x').toString('base64'),
    }).expect(404);
  });

  it('G5 — an open EP challenge blocks completion until the Manager answers it', async () => {
    const raised = (
      await post(pa, `${base}/business-understanding/challenges`, {
        targetType: 'section',
        targetRef: 'business_model',
        kind: 'challenge',
        body: 'Is consulting really the only revenue stream?',
      }).expect(201)
    ).body as BusinessUnderstandingSummary;
    const c = { body: raised.challenges[0]! };
    expect(c.body).toMatchObject({
      code: 'PC-001',
      status: 'open',
      targetLabel: '03.2.1 Business & Operating Model',
    });
    expect(await notes('manager.x@dhvaj.in', 'planning_understanding_challenge')).toHaveLength(1);
    // Only the EP challenges; only the Manager responds.
    await post(mx, `${base}/business-understanding/challenges`, {
      targetType: 'conclusion',
      kind: 'comment',
      body: 'x',
    }).expect(403);
    await post(pa, `${eng}/understanding-challenges/${c.body.id}/respond`, {
      response: 'x',
      version: c.body.version,
    }).expect(403);
    // A challenge is not closed before a response.
    await post(pa, `${eng}/understanding-challenges/${c.body.id}/close`, {
      version: c.body.version,
    }).expect(409);
    expect((await summary()).completion.find((x) => x.key === 'challenges')?.met).toBe(false);

    const responded = (
      await post(mx, `${eng}/understanding-challenges/${c.body.id}/respond`, {
        response: 'Yes — training income is under 1% of revenue.',
        version: c.body.version,
      }).expect(201)
    ).body as BusinessUnderstandingSummary;
    const r = responded.challenges.find((x) => x.id === c.body.id)!;
    expect(r).toMatchObject({ status: 'responded', respondedByName: 'Manager X' });
    expect(responded.completion.find((x) => x.key === 'challenges')?.met).toBe(true);
    expect(await notes('partner.a@dhvaj.in', 'planning_understanding_challenge')).toHaveLength(1);
    const closed = (
      await post(pa, `${eng}/understanding-challenges/${c.body.id}/close`, {
        version: r.version,
      }).expect(201)
    ).body as BusinessUnderstandingSummary;
    expect(closed.challenges.find((x) => x.id === c.body.id)?.status).toBe('closed');
  });

  it('G6 — completion freezes 03.2; reopening makes v1.1 with a diff against v1.0', async () => {
    let s = await summary();
    // Close every completion gap as the Manager would.
    for (const sec of s.sections) {
      await post(mx, `${base}/business-understanding/sections/${sec.key}`, {
        anythingChanged: sec.anythingChanged ?? 'no',
        reviewed: true,
        version: sec.version,
      }).expect(201);
    }
    s = await summary();
    await post(mx, `${base}/financial-dataset`, {
      periodEnd: '2033-03-31',
      currency: 'INR',
      units: 'inr_lakh',
      dataStatus: 'final',
      cySource: 'Draft FS FY25',
      version: s.dataset.version ?? 0,
    }).expect(201);
    for (const card of await cards()) {
      await post(mx, `${eng}/analytics-exceptions/${card.id}`, {
        assessment: 'reasonable',
        signalDecision: 'none',
        noSignalRationale: 'Explained and corroborated.',
        version: card.version,
      }).expect(201);
    }
    s = await summary();
    const done = await post(mx, `${base}/business-understanding`, {
      ba01: 'yes_complete',
      conclusionSummary: 'Revenue flat; no new risks from the understanding.',
      version: s.record.version,
    });
    if (done.status !== 201) throw new Error(`03.2 did not complete: ${JSON.stringify(done.body)}`);
    s = done.body as BusinessUnderstandingSummary;
    expect(s.record.status).toBe('complete');
    expect(s.access).toMatchObject({ locked: true });
    expect(s.versionInfo).toMatchObject({ versionLabel: 'v1.0', completedByName: 'Manager X' });

    // Frozen: facts, figures and evidence.
    const bm = s.sections.find((x) => x.key === 'business_model')!;
    await post(sy, `${base}/business-understanding/sections/business_model`, {
      answers: { activities_note: 'Changed after completion' },
      version: bm.version,
    }).expect(409);
    await post(mx, `${base}/financial-dataset/values`, {
      values: [
        { metricKey: 'revenue', period: 'cy', amount: 2000, sourceType: 'draft_fs', version: 99 },
      ],
    }).expect(409);
    await post(mx, `${base}/planning-evidence/add`, {
      targetType: 'understanding_section',
      targetId: s.recordIds.sections.business_model,
      filename: 'late.txt',
      contentBase64: Buffer.from('late').toString('base64'),
    }).expect(409);
    // The team cannot reopen; the Manager can, with a reason.
    await post(sy, `${base}/business-understanding/reopen`, {
      reason: 'x',
      version: s.record.version,
    }).expect(403);
    const reopened = (
      await post(mx, `${base}/business-understanding/reopen`, {
        reason: 'Client restated the business description',
        version: s.record.version,
      }).expect(201)
    ).body as BusinessUnderstandingSummary;
    expect(reopened.record.status).toBe('in_progress');
    expect(reopened.record.ba01).toBeNull();
    expect(reopened.versionInfo.versionLabel).toBe('v1.1');
    expect(reopened.revisions).toHaveLength(1);
    expect(reopened.revisions[0]).toMatchObject({
      fromLabel: 'v1.0',
      toLabel: 'v1.1',
      status: 'open',
    });

    const bm2 = reopened.sections.find((x) => x.key === 'business_model')!;
    const edited = await post(sy, `${base}/business-understanding/sections/business_model`, {
      answers: { ...bm2.answers, activities_note: 'IT consulting and managed services' },
      version: bm2.version,
    }).expect(201);
    // Editing cleared "reviewed": the Manager reviews it again.
    expect(edited.body.reviewed).toBe(false);

    const diff = (
      await get(mx, `${base}/business-understanding/revisions/${reopened.revisions[0]!.id}`).expect(
        200,
      )
    ).body as UnderstandingRevisionDetail;
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'section',
          before: 'IT consulting',
          after: 'IT consulting and managed services',
        }),
      ]),
    );
    const { rows } = await su.query<{ status: string; version_no: number }>(
      `SELECT status, version_no FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
      [shellId],
    );
    expect(rows[0]).toEqual({ status: 'in_progress', version_no: 2 });
  });

  it('G7 — a rule change after completion that surfaces a new exception flags reassessment', async () => {
    // Complete the v1.1 revision again (the edited section is reviewed again).
    let s = await summary();
    const bm = s.sections.find((x) => x.key === 'business_model')!;
    await post(mx, `${base}/business-understanding/sections/business_model`, {
      anythingChanged: bm.anythingChanged ?? 'yes',
      reviewed: true,
      version: bm.version,
    }).expect(201);
    s = await summary();
    const done = await post(mx, `${base}/business-understanding`, {
      ba01: 'yes_complete',
      conclusionSummary: 'Revenue flat; business description restated.',
      version: s.record.version,
    });
    if (done.status !== 201) throw new Error(`03.2 did not complete: ${JSON.stringify(done.body)}`);
    expect((done.body as BusinessUnderstandingSummary).versionInfo.versionLabel).toBe('v1.1');
    const before = (await cards()).filter((c) => !c.noLongerFlagged).length;

    // The Methodology Admin tightens the revenue movement rule for 2033 periods.
    const lib = (await get(mp, '/api/v1/planning-analytics-library').expect(200))
      .body as AnalyticsLibrary;
    const mov = lib.rules.find((r) => r.ruleKey === 'movement_revenue' && r.version === 1)!;
    await post(mp, '/api/v1/planning-analytics-library/rules', {
      ruleCode: mov.ruleCode,
      name: mov.name,
      kind: mov.kind,
      formula: mov.formula,
      definition: mov.definition,
      requiredMetrics: mov.requiredMetrics,
      parameterType: mov.parameterType,
      parameterValue: 0.5,
      enhancedAt: 30,
      immediateAt: 45,
      signalWording: mov.signalWording,
      whyMayMatter: mov.whyMayMatter,
      affectedAreas: mov.affectedAreas,
      effectiveFrom: '2033-01-01',
      effectiveTo: '2033-12-31',
      methodologyVersion: 'dhvaj-analytics-2033.e2e',
      changeNote: 'e2e — 03.2 reassessment after completion',
    }).expect(201);

    // Anyone who records facts may refresh, even on a completed 03.2.
    const refreshed = (await post(sy, `${base}/analytics/refresh`, {}).expect(201))
      .body as BusinessUnderstandingSummary;
    expect((await cards()).filter((c) => !c.noLongerFlagged).length).toBe(before + 1);
    expect(refreshed.record.status).toBe('reassessment_required');
    expect(refreshed.record.ba01).toBeNull();
    expect(refreshed.versionInfo).toMatchObject({
      versionLabel: 'v1.2',
      reassessmentReason: expect.stringMatching(/AX-\d{3}/),
    });
    expect(refreshed.access.locked).toBe(false);
    expect(refreshed.revisions[0]).toMatchObject({
      fromLabel: 'v1.1',
      toLabel: 'v1.2',
      openedByName: null,
    });
    expect(await notes('manager.x@dhvaj.in', 'planning_understanding_reassessment')).toHaveLength(
      1,
    );
    // The new card must be assessed before 03.2 completes again.
    expect(refreshed.completion.find((c) => c.key === 'exceptions')?.met).toBe(false);
  });
});

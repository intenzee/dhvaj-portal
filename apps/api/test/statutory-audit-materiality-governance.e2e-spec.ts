import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import type {
  BusinessUnderstandingSummary,
  MaterialitySummary,
  PlanningEvidenceView,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { approveFrameworkForTest } from './framework-approval.helper';

/**
 * 03.3 governance (DHVAJ 03.3 §20, §21, §23):
 *   M1 the §23 role matrix — the team prepares context / PY / normalisation,
 *      the Manager determines, the EP reviews;
 *   M2 §21 evidence on 03.3 records; normalisation adjustments need support;
 *   M3 an open EP challenge blocks completion until answered and closed;
 *   M4 a completed version freezes its evidence; the EP requires reassessment
 *      and the Manager records "reassessed — no change";
 *   M5 a 03.2 figure change flags a completed 03.3; a revision takes the flag
 *      over and carries the evidence forward.
 */
describe('Statutory Audit — 03.3 governance (e2e)', () => {
  let app: INestApplication;
  let pa: string; // Engagement Partner
  let mx: string; // Engagement Manager
  let sy: string; // Senior (engagement team)
  let su: Client;
  let ids: Map<string, string>;
  let engId: string;
  let shellId: string;
  let eng: string;
  let base: string;
  let adjustmentId: string;

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
  const summary = async (t = mx): Promise<MaterialitySummary> =>
    (await get(t, `${base}/materiality`).expect(200)).body as MaterialitySummary;
  const check = (s: MaterialitySummary, key: string) => s.completion.find((c) => c.key === key);
  const notes = async (email: string, type: string): Promise<string[]> => {
    const { rows } = await su.query<{ title: string }>(
      `SELECT n.title FROM hsdg.notifications n JOIN hsdg.users u ON u.id = n.recipient_user_id
        WHERE u.email = $1 AND n.type = $2 AND n.engagement_id = $3 ORDER BY n.created_at`,
      [email, type, engId],
    );
    return rows.map((r) => r.title);
  };
  const itemState = async (): Promise<string> => {
    const { rows } = await su.query<{ state: string }>(
      `SELECT state FROM hsdg.audit_planning_items
        WHERE workflow_instance_id = $1 AND item_key = 'materiality'`,
      [shellId],
    );
    return rows[0]!.state;
  };
  const addEvidence = (t: string, targetType: string, targetId: string, name: string) =>
    post(t, `${base}/planning-evidence/add`, {
      targetType,
      targetId,
      filename: name,
      contentType: 'text/plain',
      contentBase64: Buffer.from(name).toString('base64'),
    });
  const setRevenue = async (t: string, amount: number) => {
    const bu = (await get(t, `${base}/business-understanding`).expect(200))
      .body as BusinessUnderstandingSummary;
    const v = bu.values.find((x) => x.metricKey === 'revenue' && x.period === 'cy');
    await post(t, `${base}/financial-dataset/values`, {
      values: [
        {
          metricKey: 'revenue',
          period: 'cy',
          amount,
          sourceType: 'draft_fs',
          version: v?.version ?? 0,
        },
      ],
    }).expect(201);
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    const { rows } = await su.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM hsdg.employees WHERE full_name IN ('Manager X', 'Senior Y')`,
    );
    ids = new Map(rows.map((r) => [r.full_name, r.id]));

    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Materiality Governance ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const e = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: itr,
      financialYear: '2024-25',
      periodLabel: `P${stamp()}`,
      status: 'accepted',
      engagementManagerEmployeeId: ids.get('Manager X'),
    }).expect(201);
    engId = e.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    await post(pa, `/api/v1/engagements/${engId}/team`, {
      employeeId: ids.get('Senior Y'),
      roleOnEngagement: 'in_charge',
    }).expect(201);
    eng = `/api/v1/engagements/${engId}/statutory-audit`;
    shellId = (await get(pa, eng).expect(200)).body[0].workflowInstanceId as string;
    await approveFrameworkForTest(shellId);
    base = `${eng}/${shellId}`;

    // 03.2: dataset header + revenue 1,000 lakh — the 03.3 benchmark source.
    const bu = (await get(mx, `${base}/business-understanding`).expect(200))
      .body as BusinessUnderstandingSummary;
    await post(mx, `${base}/financial-dataset`, {
      periodEnd: '2025-03-31',
      currency: 'INR',
      units: 'inr_lakh',
      dataStatus: 'final',
      cySource: 'Audited FS FY25',
      version: bu.dataset.version ?? 0,
    }).expect(201);
    await setRevenue(mx, 1000);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('M1 — the team prepares; only the Manager determines materiality', async () => {
    const team = await summary(sy);
    expect(team.governance.access).toMatchObject({ role: 'team', planningApproved: false });
    expect(team.governance.access.capabilities).toMatchObject({ addFacts: true, assess: false });
    expect(team.governance.challenges).toEqual([]);
    expect(team.governance.reassessment).toBeNull();

    // Context and prior-year materiality are the team's to prepare.
    const prepared = (
      await post(sy, `${base}/materiality`, {
        principalUsers: ['lenders_banks', 'shareholders_promoters'],
        pyOverallMateriality: 900000,
        pySource: 'PY planning memo',
        version: team.determination.version,
      }).expect(201)
    ).body as MaterialitySummary;
    expect(prepared.determination.principalUsers).toEqual([
      'lenders_banks',
      'shareholders_promoters',
    ]);

    // The benchmark, OM and specific materiality are the Manager's judgments.
    const refused = await post(sy, `${base}/materiality`, {
      selectedBenchmark: 'revenue',
      version: prepared.determination.version,
    }).expect(403);
    expect(refused.body.message).toMatch(/Only the Engagement Manager/);
    await post(sy, `${base}/materiality/specific`, {
      scopeType: 'disclosure',
      scope: 'Related parties',
      thresholdType: 'qualitative',
      reason: 'x',
    }).expect(403);
    await post(sy, `${base}/materiality/benchmarks/revenue`, {
      assessment: 'appropriate',
      rationale: 'x',
    }).expect(403);

    // The team prepares the normalisation schedule.
    const adj = (
      await post(sy, `${base}/materiality/adjustments`, {
        description: 'One-off litigation settlement',
        amount: 50,
        reason: 'Non-recurring',
        recurring: false,
      }).expect(201)
    ).body as MaterialitySummary;
    adjustmentId = adj.adjustments[0]!.id;

    const mgr = await summary(mx);
    expect(mgr.governance.access).toMatchObject({ role: 'manager' });
    expect(mgr.governance.access.capabilities).toMatchObject({
      assess: true,
      respondToChallenge: true,
    });
    const ep = await summary(pa);
    expect(ep.governance.access.capabilities).toMatchObject({ partnerReview: true, assess: false });
    // MAT-08 is the Engagement Manager's — the EP challenges / approves at 03.12, never completes 03.3.
    await post(pa, `${base}/materiality`, {
      mat08: 'yes_complete',
      version: ep.determination.version,
    }).expect(403);
  });

  it('M2 — evidence on 03.3 records; normalisation adjustments need support', async () => {
    let s = await summary();
    expect(check(s, 'normalisation_evidence')).toMatchObject({ met: false });
    expect(check(s, 'normalisation_evidence')?.detail).toContain(s.adjustments[0]!.code);

    // New files are the Manager's / EP's; the team links an existing engagement file.
    await addEvidence(sy, 'materiality_adjustment', adjustmentId, 'x.txt').expect(403);
    const view = (
      await addEvidence(mx, 'materiality_adjustment', adjustmentId, 'settlement-deed.txt').expect(
        201,
      )
    ).body as PlanningEvidenceView;
    expect(view.files).toHaveLength(1);
    const linked = (
      await post(sy, `${base}/planning-evidence/link`, {
        targetType: 'materiality_determination',
        targetId: s.determination.id,
        documentId: view.files[0]!.documentId,
      }).expect(201)
    ).body as PlanningEvidenceView;
    expect(linked).toMatchObject({ canAdd: true, canUpload: false });

    s = await summary();
    expect(s.governance.evidenceCounts[adjustmentId]).toBe(1);
    expect(s.governance.evidenceCounts[s.determination.id!]).toBe(1);
    expect(check(s, 'normalisation_evidence')).toMatchObject({ met: true });

    // A record on another file is refused.
    await addEvidence(
      mx,
      'materiality_adjustment',
      '00000000-0000-4000-8000-000000000000',
      'x.txt',
    ).expect(404);
  });

  it('M3 — an open EP challenge blocks completion until answered and closed', async () => {
    await post(mx, `${base}/materiality/challenges`, {
      targetType: 'overall',
      kind: 'challenge',
      body: 'x',
    }).expect(403);
    const raised = (
      await post(pa, `${base}/materiality/challenges`, {
        targetType: 'normalisation',
        targetRef: 'One-off litigation settlement',
        kind: 'challenge',
        body: 'Is the settlement really non-recurring?',
      }).expect(201)
    ).body as MaterialitySummary;
    const c = raised.governance.challenges[0]!;
    expect(c).toMatchObject({
      code: 'PC-001',
      status: 'open',
      versionLabel: 'v1.0',
      targetLabel: '03.3.3 Normalised benchmark — One-off litigation settlement',
    });
    expect(check(raised, 'challenges')).toMatchObject({ met: false });
    expect(await notes('manager.x@dhvaj.in', 'planning_materiality_challenge')).toEqual([
      'Engagement Partner challenge on 03.3 — 03.3.3 Normalised benchmark — One-off litigation settlement',
    ]);

    // Completion is refused while the challenge is open.
    const s = await summary();
    const blocked = await post(mx, `${base}/materiality`, {
      mat08: 'yes_complete',
      version: s.determination.version,
    }).expect(409);
    expect(blocked.body.message).toMatch(/PC-001 awaits the Manager's response/);

    const url = `${eng}/materiality-challenges/${c.id}`;
    // The EP cannot close an unanswered challenge; the team cannot answer it.
    await post(pa, `${url}/close`, { version: c.version }).expect(409);
    await post(sy, `${url}/respond`, { response: 'x', version: c.version }).expect(403);
    const answered = (
      await post(mx, `${url}/respond`, {
        response: 'Yes — a one-time settlement, see the deed.',
        version: c.version,
      }).expect(201)
    ).body as MaterialitySummary;
    const r = answered.governance.challenges[0]!;
    expect(r).toMatchObject({ status: 'responded', respondedByName: 'Manager X' });
    // A responded challenge no longer blocks; the EP closes it.
    expect(check(answered, 'challenges')).toMatchObject({ met: true });
    await post(mx, `${url}/close`, { version: r.version }).expect(403);
    const closed = (await post(pa, `${url}/close`, { version: r.version }).expect(201))
      .body as MaterialitySummary;
    expect(closed.governance.challenges[0]!.status).toBe('closed');
    await post(pa, `${url}/close`, { version: r.version + 1 }).expect(409);
  });

  it('M4 — a completed version freezes; the EP requires reassessment, the Manager resolves it', async () => {
    // Complete v1.0 directly (the completion workflow has its own suite).
    await su.query(
      `UPDATE hsdg.audit_materiality_determination
          SET status = 'complete', selected_benchmark = 'revenue', benchmark_amount = 1000,
              selected_pct = 1, selected_om = 1000000, selected_pm = 750000, selected_ctt = 50000,
              completed_at = now(), version = version + 1
        WHERE workflow_instance_id = $1`,
      [shellId],
    );
    await su.query(
      `UPDATE hsdg.audit_planning_items SET state = 'complete'
        WHERE workflow_instance_id = $1 AND item_key = 'materiality'`,
      [shellId],
    );
    let s = await summary();
    expect(s.determination.status).toBe('complete');
    await addEvidence(mx, 'materiality_determination', s.determination.id!, 'late.txt').expect(409);

    // A reasonless or team request is refused; a draft-only action on a complete row too.
    await post(sy, `${base}/materiality/require-reassessment`, {
      reason: 'x',
      version: s.determination.version,
    }).expect(403);
    await post(pa, `${base}/materiality/require-reassessment`, {
      reason: 'Covenant reset',
      version: s.determination.version - 1,
    }).expect(409);
    s = (
      await post(pa, `${base}/materiality/require-reassessment`, {
        reason: 'Lenders reset the covenant — reconsider the benchmark.',
        version: s.determination.version,
      }).expect(201)
    ).body as MaterialitySummary;
    expect(s.governance.reassessment).toMatchObject({
      open: true,
      source: 'partner',
      reason: 'Lenders reset the covenant — reconsider the benchmark.',
    });
    expect(await itemState()).toBe('needs_attention');
    expect(await notes('manager.x@dhvaj.in', 'planning_materiality_reassessment')).toEqual([
      'Engagement Partner requires reassessment of materiality v1.0',
    ]);
    await post(pa, `${base}/materiality/require-reassessment`, {
      reason: 'again',
      version: s.determination.version,
    }).expect(409);

    // Resolving is the Manager's, with a reason.
    await post(sy, `${base}/materiality/resolve-reassessment`, {
      resolution: 'x',
      version: s.determination.version,
    }).expect(403);
    await post(mx, `${base}/materiality/resolve-reassessment`, {
      resolution: '   ',
      version: s.determination.version,
    }).expect(400);
    s = (
      await post(mx, `${base}/materiality/resolve-reassessment`, {
        resolution: 'Covenant still on revenue; v1.0 stands.',
        version: s.determination.version,
      }).expect(201)
    ).body as MaterialitySummary;
    expect(s.governance.reassessment).toMatchObject({
      open: false,
      resolution: 'Covenant still on revenue; v1.0 stands.',
      resolvedByName: 'Manager X',
    });
    expect(s.determination.status).toBe('complete');
    expect(await itemState()).toBe('complete');
  });

  it('M5 — a 03.2 change flags the completed 03.3; a revision takes it over with its evidence', async () => {
    // An unchanged figure does not flag.
    await setRevenue(sy, 1000);
    expect((await summary()).governance.reassessment?.open).toBe(false);

    // The team changes revenue in 03.2 → the completed 03.3 needs reassessment.
    await setRevenue(sy, 1200);
    let s = await summary();
    expect(s.determination.status).toBe('complete');
    expect(s.determination.selectedOm).toBe(1000000);
    expect(s.governance.reassessment).toMatchObject({ open: true, source: 'source_change' });
    expect(s.governance.reassessment!.reason).toMatch(/1,000 to 1,200/);
    expect(await itemState()).toBe('needs_attention');
    expect(await notes('manager.x@dhvaj.in', 'planning_materiality_reassessment')).toEqual(
      expect.arrayContaining(['Materiality v1.0 needs reassessment — 03.2 figures changed']),
    );
    // A further change keeps one flag with the latest figures.
    await setRevenue(sy, 1300);
    s = await summary();
    expect(s.governance.reassessment!.reason).toMatch(/1,000 to 1,300/);
    const { rows: flags } = await su.query(
      `SELECT 1 FROM hsdg.audit_materiality_determination
        WHERE workflow_instance_id = $1 AND reassessment_flagged_at IS NOT NULL`,
      [shellId],
    );
    expect(flags).toHaveLength(1);

    // The team cannot revise; the Manager does, and the revision takes the flag over.
    await post(sy, `${base}/materiality/revisions`, {
      trigger: 'changed_circumstances',
      reason: 'x',
    }).expect(403);
    const oldId = s.determination.id!;
    const revised = (
      await post(mx, `${base}/materiality/revisions`, {
        trigger: 'changed_circumstances',
        reason: 'Revenue restated in 03.2',
      }).expect(201)
    ).body as MaterialitySummary;
    expect(revised.determination).toMatchObject({ versionLabel: 'v1.1', status: 'draft' });
    expect(revised.governance.reassessment).toBeNull();
    const { rows: old } = await su.query<{ reassessment_resolution: string }>(
      `SELECT reassessment_resolution FROM hsdg.audit_materiality_determination WHERE id = $1`,
      [oldId],
    );
    expect(old[0]!.reassessment_resolution).toMatch(/^Taken over by revision v1\.1/);

    // Evidence travels with the copied records; the new draft is open for more.
    const newId = revised.determination.id!;
    expect(newId).not.toBe(oldId);
    expect(revised.governance.evidenceCounts[newId]).toBe(1);
    const newAdj = revised.adjustments[0]!.id;
    expect(newAdj).not.toBe(adjustmentId);
    expect(revised.governance.evidenceCounts[newAdj]).toBe(1);
    await addEvidence(mx, 'materiality_determination', newId, 'restated-fs.txt').expect(201);
    // The EP's challenges stay on the file with the version they were raised on.
    expect(revised.governance.challenges[0]).toMatchObject({
      code: 'PC-001',
      versionLabel: 'v1.0',
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import type {
  AuditAreaReviewSummary,
  PlanningEvidenceView,
  ScopeApproachSummary,
  ScopeHandoff,
  ScopeMapItem,
  ScopeMethodologyLibrary,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { approveFrameworkForTest } from './framework-approval.helper';

/**
 * 03.4 Audit Scope & Approach — governance, links and hand-offs (DHVAJ 03.4):
 *   S1 the §30 role split (team prepares facts and indicators; the Manager
 *      concludes; the EP reviews) and per-branch units from 02.6;
 *   S2 the §23 Approach Map → 03.5 link / convert and 03.5 VAL-11;
 *   S3 §28 evidence on 03.4 records;
 *   S4 §26 Partner actions: the Manager is notified, answers, the EP is notified;
 *       limitations reach the attention queue;
 *   S5 §31 the Methodology Admin library drives the 03.4 decision lists;
 *   S6 §25 a revision flags the affected modules' completed planning rows;
 *   S7 hand-offs to 03.8 / 03.9 / 03.11 and the §32 authority links.
 */
describe('Statutory Audit — 03.4 scope & approach governance (e2e)', () => {
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
  let scope: string;

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

  const summary = async (t = mx): Promise<ScopeApproachSummary> =>
    (await get(t, scope).expect(200)).body as ScopeApproachSummary;
  const areas = async (): Promise<AuditAreaReviewSummary> =>
    (await get(mx, `${base}/audit-areas`).expect(200)).body as AuditAreaReviewSummary;
  const mapItem = async (pred: (m: ScopeMapItem) => boolean): Promise<ScopeMapItem> => {
    const m = (await summary()).mapItems.find(pred);
    expect(m).toBeDefined();
    return m!;
  };
  const notes = async (email: string, type: string): Promise<string[]> => {
    const { rows } = await su.query<{ title: string }>(
      `SELECT n.title FROM hsdg.notifications n JOIN hsdg.users u ON u.id = n.recipient_user_id
        WHERE u.email = $1 AND n.type = $2 AND n.engagement_id = $3 ORDER BY n.created_at`,
      [email, type, engId],
    );
    return rows.map((r) => r.title);
  };
  const itemState = async (key: string): Promise<string> =>
    (
      await su.query<{ state: string }>(
        `SELECT state FROM hsdg.audit_planning_items WHERE workflow_instance_id = $1 AND item_key = $2`,
        [shellId, key],
      )
    ).rows[0]!.state;

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
      legalName: `Scope Governance ${stamp()}`,
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
    const eng = `/api/v1/engagements/${engId}/statutory-audit`;
    shellId = (await get(pa, eng).expect(200)).body[0].workflowInstanceId as string;
    base = `${eng}/${shellId}`;
    scope = `${base}/scope-approach`;
    await approveFrameworkForTest(shellId);

    // 03.2: a dataset with revenue, so the Approach Map has an automatic area.
    const bu = await get(mx, `${base}/business-understanding`).expect(200);
    await post(mx, `${base}/financial-dataset`, {
      periodEnd: '2025-03-31',
      currency: 'INR',
      units: 'inr_lakh',
      dataStatus: 'final',
      version: bu.body.dataset.version ?? 0,
    }).expect(201);
    await post(mx, `${base}/financial-dataset/values`, {
      values: [
        { metricKey: 'revenue', period: 'cy', amount: 1250, sourceType: 'draft_fs', version: 0 },
      ],
    }).expect(201);

    // 02.6: two branches audited by a branch auditor.
    const { rows: ga } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.audit_group_audit (workflow_instance_id, engagement_id)
       VALUES ($1, $2) RETURNING id`,
      [shellId, engId],
    );
    await su.query(
      `INSERT INTO hsdg.audit_group_branch
         (group_audit_id, workflow_instance_id, engagement_id, branch_name, location, country, firm_name)
       VALUES ($1, $2, $3, 'Pune Branch', 'Pune', 'India', 'Branch & Co'),
              ($1, $2, $3, 'Chennai Branch', 'Chennai', 'India', NULL)`,
      [ga[0]!.id, shellId, engId],
    );
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('S1 — the team prepares facts; only the Manager concludes; branches become units', async () => {
    const team = await summary(sy);
    expect(team.access).toMatchObject({
      role: 'team',
      prepare: true,
      conclude: false,
      partnerReview: false,
      respond: false,
    });
    expect((await summary(mx)).access).toMatchObject({ role: 'manager', conclude: true });
    expect((await summary(pa)).access).toMatchObject({ role: 'partner', partnerReview: true });

    await post(mx, `${scope}/generate`, {}).expect(201);
    const s = await summary();
    const branches = s.units.filter((u) => u.unitType === 'branch');
    expect(branches.map((u) => u.name).sort()).toEqual(['Chennai Branch', 'Pune Branch']);
    expect(branches.find((u) => u.name === 'Pune Branch')).toMatchObject({
      location: 'Pune, India',
    });
    expect(s.intelligence.map((i) => i.value).join(' ')).toContain('Pune Branch');

    // The Senior records indicators but cannot conclude a unit's scope.
    const unit = branches[0]!;
    const saved = (
      await post(sy, `${scope}/units/${unit.id}`, {
        employees: 42,
        transactionVolume: 1800,
        volumeNote: 'Invoices per month',
        version: unit.version,
      }).expect(201)
    ).body as ScopeApproachSummary;
    expect(saved.units.find((u) => u.id === unit.id)).toMatchObject({
      employees: 42,
      transactionVolume: 1800,
      volumeNote: 'Invoices per month',
    });
    const fresh = saved.units.find((u) => u.id === unit.id)!;
    await post(sy, `${scope}/units/${unit.id}`, {
      scopeConclusion: 'in_scope',
      version: fresh.version,
    }).expect(403);
    await post(sy, scope, { ap01: 'combined', version: saved.record.version }).expect(403);
    await post(sy, `${scope}/partner-actions`, { action: 'agree' }).expect(403);
    await post(sy, `${scope}/limitations`, { matter: 'x' }).expect(403);
    // …and may still record the team's own record facts.
    await post(sy, scope, {
      icfrNote: 'Walkthroughs planned',
      version: saved.record.version,
    }).expect(201);
  });

  it('S2 — the Approach Map is carried into 03.5 (auto link, convert, manual unlink, VAL-11)', async () => {
    await post(mx, `${base}/audit-areas/populate`, {}).expect(201);
    await get(mx, scope).expect(200);
    const revenue = await mapItem((m) => m.metricKey === 'revenue');
    expect(revenue.linkedArea).not.toBeNull();
    expect((await summary()).areaLink.available).toBe(true);

    // A custom map area that matches nothing is flagged by VAL-11 until converted.
    let s = (
      await post(mx, `${scope}/map`, { name: 'Crypto holdings zz', included: true }).expect(201)
    ).body as ScopeApproachSummary;
    let custom = s.mapItems.find((m) => m.name === 'Crypto holdings zz')!;
    expect(custom.linkedArea).toBeNull();
    expect(s.areaLink.unconverted).toBeGreaterThanOrEqual(1);
    let val11 = (await areas()).validations.find((v) => v.id === 'VAL-11')!;
    expect(val11).toMatchObject({ met: false });
    expect(val11.detail).toContain('Crypto holdings zz');

    await post(sy, `${scope}/map/${custom.id}/convert`, { version: custom.version }).expect(403);
    s = (
      await post(mx, `${scope}/map/${custom.id}/convert`, { version: custom.version }).expect(201)
    ).body as ScopeApproachSummary;
    custom = s.mapItems.find((m) => m.id === custom.id)!;
    expect(custom.linkedArea).toMatchObject({ origin: 'scope_map', name: 'Crypto holdings zz' });
    await post(mx, `${scope}/map/${custom.id}/convert`, { version: custom.version }).expect(409);

    const review = await areas();
    const carried = review.areas.find((a) => a.id === custom.linkedArea!.id)!;
    expect(carried.scopeStrategy).toMatchObject({ mapItemId: custom.id });

    // A manual unlink sticks: regeneration does not re-link it.
    const rev = await mapItem((m) => m.metricKey === 'revenue');
    await post(sy, `${scope}/map/${rev.id}/link`, { areaId: null, version: rev.version }).expect(
      403,
    );
    await post(mx, `${scope}/map/${rev.id}/link`, { areaId: null, version: rev.version }).expect(
      201,
    );
    await post(mx, `${scope}/generate`, {}).expect(201);
    expect((await mapItem((m) => m.id === rev.id)).linkedArea).toBeNull();
    val11 = (await areas()).validations.find((v) => v.id === 'VAL-11')!;
    expect(val11.detail).toContain(rev.name);

    // Re-link by hand to the area it came from.
    const revArea = review.areas.find((a) => a.id === revenue.linkedArea!.id)!;
    const again = await mapItem((m) => m.id === rev.id);
    await post(mx, `${scope}/map/${rev.id}/link`, {
      areaId: revArea.id,
      version: again.version,
    }).expect(201);
    expect((await mapItem((m) => m.id === rev.id)).linkedArea?.id).toBe(revArea.id);
    // An area already carrying another map area cannot take a second one.
    const c2 = await mapItem((m) => m.id === custom.id);
    await post(mx, `${scope}/map/${c2.id}/link`, {
      areaId: revArea.id,
      version: c2.version,
    }).expect(409);
    expect((await areas()).validations.find((v) => v.id === 'VAL-11')).toMatchObject({
      met: true,
    });
  });

  it('S3 — evidence on 03.4 records shows in the 03.4 counts', async () => {
    const unit = (await summary()).units[0]!;
    // The team links engagement files; uploading is the Manager's (as in 03.1).
    await post(sy, `${base}/planning-evidence/add`, {
      targetType: 'scope_unit',
      targetId: unit.id,
      filename: 'x.txt',
      contentBase64: Buffer.from('x').toString('base64'),
    }).expect(403);
    const view = (
      await post(mx, `${base}/planning-evidence/add`, {
        targetType: 'scope_unit',
        targetId: unit.id,
        filename: 'branch-list.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from('Branch list').toString('base64'),
      }).expect(201)
    ).body as PlanningEvidenceView;
    expect(view.files).toHaveLength(1);
    expect((await summary()).evidenceCounts[unit.id]).toBe(1);
  });

  it('S4 — Partner challenge → Manager response, both notified; limitations reach the queue', async () => {
    await post(mx, `${scope}/limitations`, {
      matter: 'Chennai records unavailable',
      affected: 'Chennai Branch',
    }).expect(201);
    const s = await summary();
    const { rows: queue } = await su.query<{ scope_trigger_key: string }>(
      `SELECT scope_trigger_key FROM hsdg.audit_planning_attention WHERE scope_id = $1`,
      [s.record.id],
    );
    expect(queue.some((q) => q.scope_trigger_key.startsWith('limitation'))).toBe(true);

    await post(mx, `${scope}/partner-actions`, { action: 'challenge', note: 'x' }).expect(403);
    const after = (
      await post(pa, `${scope}/partner-actions`, {
        action: 'challenge',
        note: 'Why is Chennai not separately scoped?',
      }).expect(201)
    ).body as ScopeApproachSummary;
    const action = after.partnerActions.find((a) => a.action === 'challenge')!;
    expect(action).toMatchObject({ status: 'open', scopeVersionLabel: 'v1.0' });
    expect(
      (await notes('manager.x@dhvaj.in', 'planning_scope_partner_action')).length,
    ).toBeGreaterThanOrEqual(1);

    await post(pa, `${scope}/partner-actions/${action.id}`, {
      response: 'x',
      version: action.version,
    }).expect(403);
    const answered = (
      await post(mx, `${scope}/partner-actions/${action.id}`, {
        response: 'Chennai is below the component threshold.',
        version: action.version,
      }).expect(201)
    ).body as ScopeApproachSummary;
    expect(answered.partnerActions.find((a) => a.id === action.id)).toMatchObject({
      status: 'addressed',
      respondedByName: 'Manager X',
    });
    expect(
      (await notes('partner.a@dhvaj.in', 'planning_scope_partner_action')).length,
    ).toBeGreaterThanOrEqual(1);
    // Answered once: a second response is refused.
    await post(mx, `${scope}/partner-actions/${action.id}`, {
      response: 'again',
      version: action.version + 1,
    }).expect((r) => expect([404, 409]).toContain(r.status));
  });

  it('S5 — the Methodology Admin library drives the 03.4 decision lists', async () => {
    const LIB = '/api/v1/scope-methodology-library';
    await get(pa, LIB).expect(403);
    const lib = (await get(mp, LIB).expect(200)).body as ScopeMethodologyLibrary;
    expect(lib.items.find((i) => i.itemCode === 'SMI-001')).toMatchObject({
      kind: 'controls_cycle',
      itemKey: 'revenue',
    });
    await post(mx, `${LIB}/items`, {}).expect(403);
    await post(mp, `${LIB}/items`, {
      itemCode: 'SMI-001',
      kind: 'controls_cycle',
      itemKey: 'other_key',
      label: 'x',
      options: ['reliance_contemplated', 'no_reliance'],
      changeNote: 'wrong key',
    }).expect(400);
    const v2 = await post(mp, `${LIB}/items`, {
      itemCode: 'SMI-001',
      kind: 'controls_cycle',
      itemKey: 'revenue',
      label: 'Revenue & receivables',
      options: ['reliance_contemplated', 'no_reliance', 'further_assessment'],
      guidance: 'Consider the order-to-cash cycle end to end.',
      changeNote: 'Broadened to receivables',
    }).expect(201);
    expect(v2.body).toMatchObject({ version: 2 });

    const d = (await summary()).decisions.find(
      (x) => x.kind === 'controls_cycle' && x.itemKey === 'revenue',
    );
    expect(d).toMatchObject({
      label: 'Revenue & receivables',
      itemCode: 'SMI-001',
      guidance: 'Consider the order-to-cash cycle end to end.',
      retired: false,
    });
  });

  it('S6 — a revision flags the affected modules’ completed planning rows', async () => {
    await su.query(
      `UPDATE hsdg.audit_scope_approach SET status = 'complete', completed_at = now()
        WHERE workflow_instance_id = $1`,
      [shellId],
    );
    await su.query(
      `UPDATE hsdg.audit_planning_items SET state = 'complete'
        WHERE workflow_instance_id = $1
          AND item_key IN ('areas_and_assertions','team_allocation','specialist_planning','risk_to_response')`,
      [shellId],
    );
    await post(sy, `${scope}/revisions`, { trigger: 'other', reason: 'x' }).expect(403);
    await post(mx, `${scope}/revisions`, {
      trigger: 'new_significant_transaction',
      reason: 'Acquisition of a subsidiary in Q4.',
      affectedModules: ['03.5', '03.8'],
    }).expect(201);
    expect(await itemState('areas_and_assertions')).toBe('needs_attention');
    expect(await itemState('team_allocation')).toBe('needs_attention');
    expect(await itemState('specialist_planning')).toBe('needs_attention');
    expect(await itemState('risk_to_response')).toBe('complete');
    const s = await summary();
    expect(s.record.versionNo).toBe(2);
    expect(s.revisions[0]).toMatchObject({ affectedModules: ['03.5', '03.8'] });
  });

  it('S7 — hand-offs to 03.8 / 03.9 / 03.11 and the §32 authority links', async () => {
    const h = (await get(sy, `${scope}/handoff`).expect(200)).body as ScopeHandoff;
    expect(h).toMatchObject({ available: true, versionLabel: 'v1.1' });
    expect(Array.isArray(h.specialists)).toBe(true);
    expect(Array.isArray(h.timing)).toBe(true);
    // 03.9 receives the units another firm audits (Pune); DHVAJ's own branch stays out.
    expect(h.components.map((c) => c.name)).toEqual(['Pune Branch']);
    expect(h.components[0]!.auditor).not.toBe('dhvaj');

    const auth = (await summary()).authorities;
    expect(auth.length).toBeGreaterThan(0);
    expect(auth.map((a) => a.anchor)).toEqual(expect.arrayContaining(['view_sa_300']));
  });

  it('S8 — a Section 05 control result flags only the map areas of that cycle', async () => {
    const rev = await mapItem((m) => m.metricKey === 'revenue');
    const custom = await mapItem((m) => m.name === 'Crypto holdings zz');
    await post(mx, `${scope}/map/${rev.id}`, {
      controlsStrategy: 'reliance_contemplated',
      version: rev.version,
    }).expect(201);
    await post(mx, `${scope}/map/${custom.id}`, {
      controlsStrategy: 'reliance_contemplated',
      version: custom.version,
    }).expect(201);
    await post(sy, `${scope}/reassessment`, {
      source: 'section_05',
      reason: 'x',
      cycleKey: 'revenue',
    }).expect(403);
    await post(mx, `${scope}/reassessment`, {
      source: 'section_05',
      reason: 'Revenue cut-off control exception (C-07).',
      cycleKey: 'revenue',
    }).expect(201);
    const s = await summary();
    expect(s.mapItems.find((m) => m.id === rev.id)).toMatchObject({
      reassessmentRequired: true,
      reassessmentReason: 'Revenue cut-off control exception (C-07).',
    });
    expect(s.mapItems.find((m) => m.id === custom.id)!.reassessmentRequired).toBe(false);
  });
});

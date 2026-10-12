import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import type {
  AuditAreaLibraryAdminView,
  AuditAreaReviewSummary,
  EngagementAuditArea,
  PlanningEvidenceView,
  StatutoryAuditRiskRegister,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { approveFrameworkForTest } from './framework-approval.helper';

/**
 * 03.5 Audit Areas & Assertions — governance and lineage (DHVAJ 03.5):
 *   A1 §27 role matrix: only the Manager populates and prepares; the EP reviews;
 *      a Senior prepares only with a grant; outsiders and oversight get nothing;
 *   A2 §5 grants — prepare vs manager-equivalent, revocation;
 *   A3 §24 lineage — a risk sits in a retained area with that area's assertions;
 *      §9.1 an area referenced downstream cannot be removed;
 *   A4 §25 a downstream area request blocks AA-01 (VAL-09) until the Manager
 *      answers it with an area; the risk is then linked;
 *   A5 §27 EP comment / challenge / reassessment, notifications; a reassessment
 *      on a completed 03.5 makes it Update Required;
 *   A6 §28 evidence on an area and on an assertion;
 *   A7 §4/§7 library administration — draft, edit, publish; engagements see a
 *      methodology update, never a silent change.
 */
describe('Statutory Audit — 03.5 audit areas & assertions (e2e)', () => {
  let app: INestApplication;
  let pa: string; // Engagement Partner
  let pb: string; // a partner not on the engagement
  let mx: string; // Engagement Manager
  let sy: string; // Senior (engagement team)
  let mp: string; // Methodology Admin (service.manage)
  let su: Client;
  let ids: Map<string, string>;
  let engId: string;
  let shellId: string;
  let eng: string;
  let areasUrl: string;

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
  const del = (t: string, url: string) => request(app.getHttpServer()).delete(url).set(bearer(t));
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const findId = async (path: string): Promise<string> =>
    (await get(pa, path).expect(200)).body.items[0].id as string;

  const summary = async (t = mx): Promise<AuditAreaReviewSummary> =>
    (await get(t, areasUrl).expect(200)).body as AuditAreaReviewSummary;
  const area = (s: AuditAreaReviewSummary, code: string): EngagementAuditArea => {
    const a = s.areas.find((x) => x.areaCode === code);
    expect(a).toBeDefined();
    return a!;
  };
  const register = async (): Promise<StatutoryAuditRiskRegister> =>
    ((await get(mx, `${eng}/risks`).expect(200)).body as StatutoryAuditRiskRegister[])[0]!;
  const notes = async (email: string, type: string): Promise<string[]> => {
    const { rows } = await su.query<{ title: string }>(
      `SELECT n.title FROM hsdg.notifications n JOIN hsdg.users u ON u.id = n.recipient_user_id
        WHERE u.email = $1 AND n.type = $2 AND n.engagement_id = $3 ORDER BY n.created_at`,
      [email, type, engId],
    );
    return rows.map((r) => r.title);
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
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
      legalName: `Audit Areas ${stamp()}`,
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
    areasUrl = `${eng}/${shellId}/audit-areas`;
    await approveFrameworkForTest(shellId);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('A1 — the §27 role matrix: Manager populates and prepares, EP reviews, team needs a grant', async () => {
    // Nobody but the Manager (or a grantee) creates the population.
    await post(sy, `${areasUrl}/populate`, {}).expect(403);
    await post(pa, `${areasUrl}/populate`, {}).expect(403);
    const s = (await post(mx, `${areasUrl}/populate`, {}).expect(201))
      .body as AuditAreaReviewSummary;
    expect(s.access).toMatchObject({ role: 'manager', grant: null });
    expect(s.access.capabilities).toMatchObject({
      prepare: true,
      complete: true,
      manageGrants: true,
    });
    expect(s.areas.length).toBeGreaterThan(10);
    expect(s.areas.every((a) => a.disposition === 'retained')).toBe(true);
    // Each area reports its downstream use and evidence (none yet).
    expect(area(s, 'CASH')).toMatchObject({
      downstreamDetail: { risks: 0, procedures: 0, workAreas: 0 },
      evidenceCount: 0,
    });
    expect(s.grantCandidates.map((c) => c.employeeId)).toContain(ids.get('Senior Y'));

    const ep = await summary(pa);
    expect(ep.access).toMatchObject({ role: 'partner', actingAsManager: false });
    expect(ep.access.capabilities).toMatchObject({ partnerReview: true, prepare: false });
    expect(ep.grantCandidates).toEqual([]);
    const team = await summary(sy);
    expect(team.access.capabilities).toMatchObject({ prepare: false, requestArea: true });

    // Neither the EP nor an un-granted Senior may change a decision.
    const cash = area(s, 'CASH');
    for (const t of [pa, sy]) {
      await post(t, `${areasUrl}/areas/${cash.id}`, {
        attention: 'enhanced',
        version: cash.version,
      }).expect(403);
    }
    // A partner outside the engagement cannot read it.
    const out = await get(pb, areasUrl);
    expect([403, 404]).toContain(out.status);
  });

  it('A2 — §5 grants: prepare lets a Senior prepare, never complete or grant; revoking ends it', async () => {
    const senior = ids.get('Senior Y')!;
    await post(sy, `${areasUrl}/permissions`, { employeeId: senior, level: 'prepare' }).expect(403);
    let s = (
      await post(mx, `${areasUrl}/permissions`, {
        employeeId: senior,
        level: 'prepare',
        note: 'Prepares the balance-sheet areas',
      }).expect(201)
    ).body as AuditAreaReviewSummary;
    const grant = s.grants.find((g) => g.employeeId === senior)!;
    expect(grant).toMatchObject({ level: 'prepare', employeeName: 'Senior Y' });
    expect(await notes('senior.y@dhvaj.in', 'planning_areas_review')).not.toHaveLength(0);

    const team = await summary(sy);
    expect(team.access).toMatchObject({ role: 'team', grant: 'prepare' });
    expect(team.access.capabilities).toMatchObject({
      prepare: true,
      complete: false,
      manageGrants: false,
    });
    const cash = area(team, 'CASH');
    s = (
      await post(sy, `${areasUrl}/areas/${cash.id}`, {
        attention: 'enhanced',
        attentionReason: 'Multiple bank accounts',
        version: cash.version,
      }).expect(201)
    ).body as AuditAreaReviewSummary;
    expect(area(s, 'CASH').attention).toBe('enhanced');
    await post(sy, `${areasUrl}/complete`, { confirm: true, version: s.record!.version }).expect(
      403,
    );
    await post(sy, `${areasUrl}/permissions`, {
      employeeId: senior,
      level: 'manager_equivalent',
    }).expect(403);
    // Only engagement team members can be granted.
    const { rows } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE full_name = 'Partner B'`,
    );
    if (rows[0]) {
      await post(mx, `${areasUrl}/permissions`, {
        employeeId: rows[0].id,
        level: 'prepare',
      }).expect(400);
    }

    await del(mx, `${areasUrl}/permissions/${grant.id}`).expect(200);
    const after = await summary(sy);
    expect(after.access.grant).toBeNull();
    const cash2 = area(after, 'CASH');
    await post(sy, `${areasUrl}/areas/${cash2.id}`, {
      attention: 'standard',
      attentionReason: 'x',
      version: cash2.version,
    }).expect(403);
  });

  it('A3 — §24 a risk sits in a retained area with its assertions; §9.1 a referenced area cannot be removed', async () => {
    const s = await summary();
    const inv = area(s, 'INV');
    const reg = await register();
    const opt = reg.areaOptions.find((o) => o.id === inv.id)!;
    expect(opt.name).toBe(inv.areaName);
    expect(opt.assertions.map((a) => a.id)).toEqual(
      expect.arrayContaining(['BAL_EXIST', 'BAL_VAL']),
    );

    // An assertion that is not active on the area is refused.
    await post(mx, `${eng}/${shellId}/risks`, {
      description: 'Inventory cut-off',
      source: 'error',
      rating: 'moderate',
      auditAreaId: inv.id,
      assertionIds: ['TX_OCC'],
    }).expect(400);
    await post(mx, `${eng}/${shellId}/risks`, {
      description: 'Inventory may be overstated at year end',
      source: 'error',
      rating: 'high',
      auditAreaId: inv.id,
      assertionIds: ['BAL_EXIST', 'BAL_VAL'],
    }).expect(201);
    const risk = (await register()).risks.find((r) => r.auditAreaId === inv.id)!;
    expect(risk).toMatchObject({ fsArea: inv.areaName, assertionIds: ['BAL_EXIST', 'BAL_VAL'] });

    const now = area(await summary(), 'INV');
    expect(now.downstreamDetail.risks).toBe(1);
    const res = await post(mx, `${areasUrl}/areas/${inv.id}/remove`, {
      reasonCode: 'NOT_APPLICABLE',
      reasonText: 'Service company',
      version: now.version,
    }).expect(409);
    expect(res.body.message).toMatch(/risk/i);
  });

  it('A4 — §25 a downstream request blocks AA-01 until the Manager answers it with an area', async () => {
    const reg = await register();
    await post(mx, `${eng}/${shellId}/risks`, {
      description: 'Derivative contracts may be unrecorded',
      source: 'error',
      rating: 'high',
    }).expect(201);
    const risk = (await register()).risks.find((r) => r.description.startsWith('Derivative'))!;
    expect(reg.areaOptions.some((o) => /derivative/i.test(o.name))).toBe(false);

    // Duplicates of a retained area are pointed back at it.
    await post(sy, `${areasUrl}/requests`, {
      proposedAreaName: 'Inventory',
      reason: 'x',
      riskId: risk.id,
    }).expect(409);
    let s = (
      await post(sy, `${areasUrl}/requests`, {
        proposedAreaName: 'Derivatives',
        reason: 'Forward contracts entered in Q4',
        riskId: risk.id,
      }).expect(201)
    ).body as AuditAreaReviewSummary;
    const req = s.comments.find((c) => c.kind === 'downstream_request')!;
    expect(req).toMatchObject({
      status: 'open',
      proposedAreaName: 'Derivatives',
      sourceModule: 'section_04',
      sourceRiskId: risk.id,
    });
    expect(s.openReviewItems).toBeGreaterThanOrEqual(1);
    expect(s.validations.find((v) => v.id === 'VAL-09')).toMatchObject({ met: false });
    expect(await notes('manager.x@dhvaj.in', 'planning_areas_review')).not.toHaveLength(0);

    // Only the Manager answers; the EP and the team cannot.
    await post(pa, `${areasUrl}/comments/${req.id}`, { response: 'Added' }).expect(403);
    await post(sy, `${areasUrl}/comments/${req.id}`, { response: 'Added' }).expect(403);
    s = (
      await post(mx, `${areasUrl}/custom`, {
        name: 'Derivatives',
        areaType: 'balance_sheet',
        reason: 'Requested by the risk assessment (R-derivatives).',
      }).expect(201)
    ).body as AuditAreaReviewSummary;
    const deriv = s.areas.find((a) => a.areaName === 'Derivatives')!;
    // A custom area needs its assertions (VAL-03).
    for (const x of ['BAL_EXIST', 'BAL_VAL', 'PD_COMP']) {
      await post(mx, `${areasUrl}/areas/${deriv.id}/assertions/${x}`, { action: 'add' }).expect(
        201,
      );
    }
    s = (
      await post(mx, `${areasUrl}/comments/${req.id}`, {
        response: 'Added as a custom area.',
        resolvedAreaId: deriv.id,
      }).expect(201)
    ).body as AuditAreaReviewSummary;
    expect(s.comments.find((c) => c.id === req.id)).toMatchObject({
      status: 'addressed',
      resolvedAreaId: deriv.id,
      respondedByName: 'Manager X',
    });
    expect(s.validations.find((v) => v.id === 'VAL-09')).toMatchObject({ met: true });
    // The requesting risk now sits in the new area.
    expect((await register()).risks.find((r) => r.id === risk.id)?.auditAreaId).toBe(deriv.id);
  });

  it('A5 — §27 EP review; a reassessment request on a completed 03.5 makes it Update Required', async () => {
    // The Senior cannot challenge; the EP can.
    await post(sy, `${areasUrl}/comments`, { kind: 'challenge', body: 'x' }).expect(403);
    let s = (
      await post(pa, `${areasUrl}/comments`, {
        kind: 'challenge',
        body: 'Why is Government Grants retained?',
      }).expect(201)
    ).body as AuditAreaReviewSummary;
    const ch = s.comments.find((c) => c.kind === 'challenge')!;
    expect(s.validations.find((v) => v.id === 'VAL-09')).toMatchObject({ met: false });
    s = (
      await post(mx, `${areasUrl}/comments/${ch.id}`, { response: 'Grant received in FY.' }).expect(
        201,
      )
    ).body as AuditAreaReviewSummary;
    expect(await notes('partner.a@dhvaj.in', 'planning_areas_review')).not.toHaveLength(0);

    // Complete (whatever is still outstanding blocks — then the test reports it).
    const blocking = s.validations.filter((v) => !v.met);
    expect(blocking.map((v) => `${v.id}: ${v.detail}`)).toEqual([]);
    s = (
      await post(mx, `${areasUrl}/complete`, { confirm: true, version: s.record!.version }).expect(
        201,
      )
    ).body as AuditAreaReviewSummary;
    expect(s.status).toBe('complete');
    expect(s.matrix.length).toBeGreaterThan(0);
    // Completed = frozen.
    const cash = area(s, 'CASH');
    await post(mx, `${areasUrl}/areas/${cash.id}`, {
      attention: 'standard',
      attentionReason: 'x',
      version: cash.version,
    }).expect(409);

    s = (
      await post(pa, `${areasUrl}/comments`, {
        kind: 'reassessment_request',
        body: 'Reassess Inventory after the count results.',
        areaId: area(s, 'INV').id,
      }).expect(201)
    ).body as AuditAreaReviewSummary;
    expect(s.status).toBe('update_required');
    expect(s.impacts.some((i) => i.kind === 'partner_reassessment')).toBe(true);
    expect(await notes('manager.x@dhvaj.in', 'planning_areas_update_required')).not.toHaveLength(0);

    // The EP cannot reopen; the Manager can.
    await post(pa, `${areasUrl}/reopen`, { reason: 'x' }).expect(403);
    s = (await post(mx, `${areasUrl}/reopen`, { reason: 'EP reassessment request' }).expect(201))
      .body as AuditAreaReviewSummary;
    expect(s.record!.status).toBe('in_progress');
  });

  it('A6 — §28 evidence on an area and on one of its assertions', async () => {
    const s = await summary();
    const inv = area(s, 'INV');
    const assertion = inv.assertions.find((x) => x.active)!;
    const evidence = `${eng}/${shellId}/planning-evidence`;
    await post(pb, `${evidence}/add`, {
      targetType: 'audit_area',
      targetId: inv.id,
      filename: 'x.txt',
      contentBase64: Buffer.from('x').toString('base64'),
    }).expect((r) => expect([403, 404]).toContain(r.status));
    const v = (
      await post(mx, `${evidence}/add`, {
        targetType: 'audit_area',
        targetId: inv.id,
        filename: 'stock-sheets.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from('Count sheets').toString('base64'),
      }).expect(201)
    ).body as PlanningEvidenceView;
    expect(v.files).toHaveLength(1);
    await post(mx, `${evidence}/add`, {
      targetType: 'area_assertion',
      targetId: assertion.id,
      filename: 'valuation.txt',
      contentType: 'text/plain',
      contentBase64: Buffer.from('NRV workings').toString('base64'),
    }).expect(201);
    const after = await summary();
    expect(area(after, 'INV').evidenceCount).toBe(1);
    expect(after.assertionEvidenceCounts[assertion.id]).toBe(1);
  });

  it('A7 — §4/§7 library administration: draft → publish; engagements see a methodology update', async () => {
    await get(pa, '/api/v1/audit-area-library').expect(403);
    const view = (await get(mp, '/api/v1/audit-area-library').expect(200))
      .body as AuditAreaLibraryAdminView;
    const current = view.releases.find((r) => r.current)!;
    expect(current.status).toBe('released');
    expect(view.rows.length).toBeGreaterThan(10);

    const version = `e2e-035-${Date.now()}`;
    let draft = (
      await post(mp, '/api/v1/audit-area-library/drafts', {
        libraryVersion: version,
        note: 'Adds an Ind AS transition-only e2e area.',
      }).expect(201)
    ).body as AuditAreaLibraryAdminView;
    expect(draft.selected).toMatchObject({
      libraryVersion: version,
      status: 'draft',
      basedOn: current.libraryVersion,
    });
    expect(draft.rows).toHaveLength(view.rows.length);
    // One draft at a time.
    await post(mp, '/api/v1/audit-area-library/drafts', {
      libraryVersion: `${version}-b`,
      note: 'second',
    }).expect(409);
    // Validation: unknown assertion.
    const row = {
      areaCode: 'E2E_TR',
      areaName: 'E2E transition reconciliations',
      areaType: 'cross_cutting',
      category: 'disclosure_cross_cutting',
      frameworkProfile: 'ind_as',
      industryProfile: 'general_corporate',
      conditionKey: 'ind_as_transition',
      defaultAssertions: ['PD_COMP'],
      nonAssertionWorkstream: false,
      defaultAttention: 'standard',
      relatedAuthorities: ['INDAS_101'],
      signalMappingTags: ['e2e transition'],
      metricKeys: [],
      indicatorTags: [],
      aliases: ['e2e transition'],
      effectiveFrom: '2020-04-01',
      effectiveTo: null,
      active: true,
      sortOrder: 999,
    };
    await post(mp, `/api/v1/audit-area-library/${version}/areas`, {
      ...row,
      defaultAssertions: [],
    }).expect(400);
    draft = (await post(mp, `/api/v1/audit-area-library/${version}/areas`, row).expect(201))
      .body as AuditAreaLibraryAdminView;
    expect(draft.rows.some((r) => r.areaCode === 'E2E_TR')).toBe(true);
    // A released version is never edited.
    const released = view.rows[0]!;
    await post(mp, `/api/v1/audit-area-library/${current.libraryVersion}/areas/${released.id}`, {
      ...row,
      areaCode: released.areaCode,
    }).expect(409);

    const pub = (await post(mp, `/api/v1/audit-area-library/${version}/publish`, {}).expect(201))
      .body as AuditAreaLibraryAdminView;
    expect(pub.releases.find((r) => r.libraryVersion === version)).toMatchObject({
      status: 'released',
      current: true,
    });

    // The engagement keeps its version and is told an update exists.
    const s = await summary();
    expect(s.record!.libraryVersion).toBe(current.libraryVersion);
    expect(s.methodologyUpdateAvailable).toBe(true);
    expect(s.currentLibraryVersion).toBe(version);
  });
});

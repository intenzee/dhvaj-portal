import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CARO_OUTCOME,
  type CaroClauseItem,
  type CaroClauseLibraryView,
  type CaroReportingSummary,
  type FrameworkEvidenceView,
  type StatutoryAuditCaro,
  type StatutoryAuditCaroProgramme,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.4 CARO 2020 — the Level-2 clause work programme end to end (DHVAJ 02.4
 * spec §11–§16, §18, §20 acceptance tests): nothing before the applicability
 * conclusion; the versioned library instantiated on read once CARO applies;
 * idempotent; Not Applicable to Facts never changes Level 1; clause review
 * and the draft annexure; withdrawn (never deleted) when CARO is concluded not
 * applicable and reactivated with its work when it applies again.
 */
describe('Statutory Audit — 02.4 CARO clause programme (e2e)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer();

  const token = async (email: string): Promise<string> => {
    const res = await request(http()).post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePeriod = (): string => `P${Date.now()}${Math.floor(Math.random() * 1000)}`;

  let mp: string;
  let pa: string;
  let pb: string;
  let engId: string;
  let shellId: string;
  const base = () => `/api/v1/engagements/${engId}/statutory-audit`;
  const caroUrl = () => `${base()}/${shellId}/caro`;

  const findId = async (path: string): Promise<string> => {
    const res = await request(http()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const getCaro = async (): Promise<StatutoryAuditCaro> =>
    (await request(http()).get(`${base()}/caro`).set(bearer(pa)).expect(200))
      .body[0] as StatutoryAuditCaro;
  const getProgramme = async (t = pa): Promise<StatutoryAuditCaroProgramme> =>
    (await request(http()).get(`${caroUrl()}/programme`).set(bearer(t)).expect(200))
      .body as StatutoryAuditCaroProgramme;
  const clause = (p: StatutoryAuditCaroProgramme, ref: string): CaroClauseItem =>
    p.standalone.find((i) => i.clauseRef === ref)!;
  const patchClause = (i: CaroClauseItem, body: Record<string, unknown>, status = 200) =>
    request(http())
      .patch(`${caroUrl()}/clauses/${i.id}`)
      .set(bearer(pa))
      .send({ ...body, version: i.version })
      .expect(status);
  const review = (i: CaroClauseItem, action: string, status = 201, extra = {}) =>
    request(http())
      .post(`${caroUrl()}/clauses/${i.id}/review`)
      .set(bearer(pa))
      .send({ action, version: i.version, ...extra })
      .expect(status);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    const entityId = await findId('/api/v1/entities?search=Acme&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const created = await request(http())
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
    await request(http())
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);
    const shells = await request(http()).get(base()).set(bearer(pa)).expect(200);
    shellId = shells.body[0].workflowInstanceId as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('resolves the clause library by date — none before CARO 2020 commences', async () => {
    const before = (
      await request(http())
        .get('/api/v1/caro-clause-library?on=2020-04-01')
        .set(bearer(pa))
        .expect(200)
    ).body as CaroClauseLibraryView;
    expect(before.orderVersion).toBeNull();
    expect(before.clauses).toEqual([]);
    const lib = (
      await request(http())
        .get('/api/v1/caro-clause-library?on=2024-04-01')
        .set(bearer(pa))
        .expect(200)
    ).body as CaroClauseLibraryView;
    expect(lib.orderVersion?.orderCode).toBe('CARO_2020');
    expect(lib.clauses.map((c) => c.clauseRef)).toContain('3(xxi)');
    expect(lib.clauses.every((c) => c.provisionCode.startsWith('CARO_2020_3_'))).toBe(true);
  });

  it('generates nothing before the 02.4 applicability is confirmed', async () => {
    const p = await getProgramme();
    expect(p.state).toBe('awaiting_conclusion');
    expect(p.programme).toBeNull();
    expect(p.standalone).toEqual([]);
  });

  it('instantiates the versioned paragraph 3 programme once CARO applies — idempotently', async () => {
    // 02.1 small-company result, then the CARO facts: revenue above the limit.
    const profile = await request(http()).get(`${base()}/profile`).set(bearer(pa)).expect(200);
    await request(http())
      .post(`${base()}/${shellId}/profile/small-company`)
      .set(bearer(pa))
      .send({
        action: 'override',
        outcome: 'not_small',
        reason: 'E2E: above the small-company limits.',
        version: profile.body[0].version,
      })
      .expect(201);
    let caro = await getCaro();
    caro = (
      await request(http())
        .post(`${caroUrl()}/facts`)
        .set(bearer(pa))
        .send({
          isHoldingOrSubsidiaryOfPublic: false,
          capitalPlusReserves: 5000000,
          peakBankFiBorrowings: 5000000,
          totalRevenue: 150000000,
          version: caro.assessment.version,
        })
        .expect(201)
    ).body;
    expect(caro.assessment.systemOutcome).toBe(CARO_OUTCOME.applicable);
    await request(http())
      .post(`${caroUrl()}/decision`)
      .set(bearer(pa))
      .send({ action: 'confirm', version: caro.assessment.version })
      .expect(201);

    const p = await getProgramme();
    expect(p.state).toBe('active');
    expect(p.programme).toMatchObject({ orderCode: 'CARO_2020', periodStart: '2024-04-01' });
    // Every sub-clause and leaf clause carries work; headings with sub-clauses do not.
    expect(p.standalone).toHaveLength(47);
    expect(p.standalone.some((i) => i.clauseRef === '3(i)')).toBe(false);
    expect(p.standalone.some((i) => i.clauseRef === '3(xxi)')).toBe(false); // CFS only
    expect(p.consolidated).toBeNull();
    expect(p.summary).toMatchObject({ total: 47, assessmentRequired: 47, approved: 0 });
    const td = clause(p, '3(i)(c)');
    expect(td).toMatchObject({
      provisionCode: 'CARO_2020_3_I_C',
      guidanceProvisionCode: 'ICAI_GN_CARO_2020',
      scheduleIiiKeys: ['ARI_TITLE_DEEDS'],
      relevance: 'assessment_required',
    });
    expect(td.procedures.length).toBeGreaterThan(0);

    const again = await getProgramme();
    expect(again.standalone.map((i) => i.id)).toEqual(p.standalone.map((i) => i.id));
  });

  it('every clause reference resolves through the Provision Library for the period', async () => {
    const p = await getProgramme();
    const i = clause(p, '3(vii)(a)');
    const prov = await request(http())
      .get(`/api/v1/authority-provisions/${i.provisionCode}?on=2024-04-01`)
      .set(bearer(pa))
      .expect(200);
    expect(prov.body).toMatchObject({ code: 'CARO_2020_3_VII_A', authority: 'MCA' });
    await request(http())
      .get(`/api/v1/authority-provisions/${i.provisionCode}?on=2020-04-01`)
      .set(bearer(pa))
      .expect(404);
    const refs = await request(http())
      .get('/api/v1/authority-provisions/references/02.4?on=2024-04-01')
      .set(bearer(pa))
      .expect(200);
    expect((refs.body as Array<{ code: string; provision: unknown }>).map((r) => r.code)).toEqual([
      'CARO_2020',
      'CARO_2020_PARA_1',
      'ICAI_GN_CARO_2020',
      'COS_ACT_8',
      'COS_ACT_2_62',
      'COS_ACT_2_85',
      'COS_ACT_143_11',
    ]);
    expect((refs.body as Array<{ provision: unknown }>).every((r) => r.provision)).toBe(true);
  });

  it('a clause Not Applicable to Facts is reasoned, approved — and never changes Level 1', async () => {
    let p = await getProgramme();
    let nidhi = clause(p, '3(xii)(a)');
    p = (
      await patchClause(nidhi, {
        relevance: 'not_applicable_to_facts',
        conclusion: 'not_applicable_to_facts',
      })
    ).body;
    nidhi = clause(p, '3(xii)(a)');
    expect(nidhi.approvalBlockers).toEqual([
      'Give the reason the clause is not applicable to the facts.',
    ]);
    await review(nidhi, 'submit', 400);
    p = (await patchClause(nidhi, { relevanceReason: 'The Company is not a Nidhi company.' })).body;
    nidhi = clause(p, '3(xii)(a)');
    p = (await review(nidhi, 'submit')).body;
    nidhi = clause(p, '3(xii)(a)');
    expect(nidhi.reviewState).toBe('submitted');
    p = (await review(nidhi, 'approve')).body;
    expect(clause(p, '3(xii)(a)')).toMatchObject({ reviewState: 'approved', approvalBlockers: [] });

    const caro = await getCaro();
    expect(caro.assessment.conclusion).toBe(CARO_OUTCOME.applicable);
  });

  it('a reportable matter needs its finding and drafted language; approval locks it', async () => {
    let p = await getProgramme();
    let pv = clause(p, '3(i)(b)');
    p = (
      await patchClause(pv, {
        relevance: 'applicable',
        workPerformed: 'Reviewed the verification programme.',
        conclusion: 'reportable_matter',
        draftReporting:
          'Property, plant and equipment were not physically verified during the year.',
        managementResponse: 'A full verification is planned for next year.',
      })
    ).body;
    pv = clause(p, '3(i)(b)');
    await review(pv, 'submit', 400); // no finding behind the reportable matter
    p = (
      await request(http())
        .post(`${caroUrl()}/clauses/${pv.id}/findings`)
        .set(bearer(pa))
        .send({
          description: 'No physical verification in the year.',
          severity: 'high',
          workAreaKey: 'caro',
        })
        .expect(201)
    ).body;
    pv = clause(p, '3(i)(b)');
    expect(pv.findings[0]).toMatchObject({ code: 'CF-001', includeInReport: true, status: 'open' });
    p = (await review(pv, 'submit')).body;
    pv = clause(p, '3(i)(b)');
    await review(pv, 'return', 400); // a return needs a note
    p = (await review(pv, 'approve')).body;
    pv = clause(p, '3(i)(b)');
    expect(pv.reviewState).toBe('approved');
    await patchClause(pv, { conclusionNote: 'late edit' }, 409);
    expect(p.summary).toMatchObject({ approved: 2, reportable: 1, openFindings: 1 });

    // Controlled reopen — the approval falls away; the trail keeps it.
    p = (await review(pv, 'reopen')).body;
    pv = clause(p, '3(i)(b)');
    expect(pv).toMatchObject({ reviewState: 'open', approvedAt: null });
    p = (await review(pv, 'submit')).body;
    p = (await review(clause(p, '3(i)(b)'), 'approve')).body;
  });

  it('reuses evidence already on the file — a link, never a second upload', async () => {
    const caro = await getCaro();
    const ev = (
      await request(http())
        .post(`${base()}/${shellId}/framework/${caro.assessment.id}/evidence/add`)
        .set(bearer(pa))
        .send({
          filename: 'Fixed asset verification report.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('verification (e2e)', 'utf8').toString('base64'),
        })
        .expect(201)
    ).body as FrameworkEvidenceView;
    const documentId = ev.files[0]!.documentId;
    let p = await getProgramme();
    const far = clause(p, '3(i)(a)(A)');
    p = (
      await request(http())
        .post(`${caroUrl()}/clauses/${far.id}/evidence`)
        .set(bearer(pa))
        .send({ documentId })
        .expect(201)
    ).body;
    expect(clause(p, '3(i)(a)(A)').evidence[0]).toMatchObject({
      documentId,
      title: 'Fixed asset verification report',
    });
    await request(http())
      .post(`${caroUrl()}/clauses/${far.id}/evidence`)
      .set(bearer(pa))
      .send({ documentId })
      .expect(409);
    await request(http())
      .post(`${caroUrl()}/clauses/${far.id}/evidence`)
      .set(bearer(pa))
      .send({ documentId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
  });

  it('builds the draft CARO annexure from the approved clause conclusions', async () => {
    const a = (await request(http()).get(`${caroUrl()}/annexure`).set(bearer(pa)).expect(200))
      .body as CaroReportingSummary;
    expect(a.consolidated).toBeNull();
    const sfs = a.standalone!;
    expect(sfs).toMatchObject({
      totalCount: 47,
      approvedCount: 2,
      reportableCount: 1,
      complete: false,
    });
    const byRef = new Map(sfs.paragraphs.map((x) => [x.clauseRef, x]));
    expect(byRef.get('3(i)(b)')?.text).toBe(
      'Property, plant and equipment were not physically verified during the year.',
    );
    expect(byRef.get('3(xii)(a)')?.text).toMatch(/not applicable to the Company/);
    expect(byRef.get('3(ii)(a)')?.text).toBeNull();
  });

  it('the CARO memo needs an approved firm template', async () => {
    const res = await request(http())
      .post(`${caroUrl()}/memo`)
      .set(bearer(pa))
      .send({})
      .expect(400);
    expect(res.body.message).toMatch(/CARO 2020 Applicability/);
  });

  it('withdraws (never deletes) when CARO is concluded not applicable, and reactivates with the work kept', async () => {
    let caro = await getCaro();
    await request(http())
      .post(`${caroUrl()}/decision`)
      .set(bearer(pa))
      .send({
        action: 'override',
        conclusion: CARO_OUTCOME.notApplicableExempt,
        basis: 'Revenue restated below the limit (e2e).',
        technicalBasis: 'CARO 2020 paragraph 1(2)(v).',
        supportingEvidence: 'Restated financial statements.',
        version: caro.assessment.version,
      })
      .expect(201);
    let p = await getProgramme();
    expect(p.state).toBe('withdrawn');
    expect(p.programme?.status).toBe('withdrawn');
    expect(p.standalone).toHaveLength(47);
    expect(p.standalone.every((i) => i.withdrawn)).toBe(true);
    expect(p.summary.total).toBe(0);
    await patchClause(clause(p, '3(ii)(a)'), { relevance: 'applicable' }, 409);

    caro = await getCaro();
    await request(http())
      .post(`${caroUrl()}/decision`)
      .set(bearer(pa))
      .send({ action: 'confirm', version: caro.assessment.version })
      .expect(201);
    p = await getProgramme();
    expect(p.state).toBe('active');
    expect(p.standalone.every((i) => !i.withdrawn)).toBe(true);
    expect(clause(p, '3(xii)(a)').reviewState).toBe('approved');
    expect(clause(p, '3(i)(b)').findings).toHaveLength(1);
  });

  it('an outsider cannot read or change the programme', async () => {
    const res = await request(http()).get(`${caroUrl()}/programme`).set(bearer(pb));
    expect([403, 404]).toContain(res.status);
    const p = await getProgramme();
    await request(http())
      .patch(`${caroUrl()}/clauses/${p.standalone[0]!.id}`)
      .set(bearer(pb))
      .send({ relevance: 'applicable', version: p.standalone[0]!.version })
      .expect((r) => expect([403, 404]).toContain(r.status));
  });
});

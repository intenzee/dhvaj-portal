import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  FrameworkEvidenceView,
  IcfrControl,
  IcfrDeficiency,
  IcfrLibraryArea,
  IcfrProcessArea,
  IcfrReportingSummary,
  StatutoryAuditIcfr,
  StatutoryAuditIcfrConsolidated,
  StatutoryAuditIcfrWorkstream,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.5 Track B — the Section 05 ICFR workstream and the consolidated ICFR
 * consideration end to end (DHVAJ 02.5 spec §13–§17, §19, §22): nothing before
 * 02.5 is decisive; the versioned process-area framework configured once ICFR
 * reporting applies; scoping kept once the team decides; the integrated
 * control record with D / I / OE kept separate; the deficiency register and
 * its methodology; prior-year follow-up; withdrawn (never deleted) when
 * reporting is exempt; the consolidated consideration; the partner-only
 * conclusions. The 02.5 Level-1 result is set directly on the stored
 * sub-assessment (as the superuser) so this suite exercises Track B alone.
 */
describe('Statutory Audit — 02.5 ICFR workstream & consolidated (e2e)', () => {
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
  let su: Client;

  interface File {
    engId: string;
    wf: string;
  }
  let prior: File;
  let cur: File;
  const base = (f: File) => `/api/v1/engagements/${f.engId}/statutory-audit`;
  const icfrUrl = (f: File) => `${base(f)}/${f.wf}/icfr`;

  const findId = async (path: string): Promise<string> => {
    const res = await request(http()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  const createFile = async (financialYear: string): Promise<File> => {
    const entityId = await findId('/api/v1/entities?search=Acme&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const created = await request(http())
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
    const engId = created.body.id as string;
    await request(http())
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);
    const shells = await request(http())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    return { engId, wf: shells.body[0].workflowInstanceId as string };
  };

  /** Open 02.5 (seeds its row) — returns the assessment the evidence hangs on. */
  const openIcfr = async (f: File): Promise<StatutoryAuditIcfr> =>
    (
      await request(http())
        .get(`${base(f)}/icfr`)
        .set(bearer(pa))
        .expect(200)
    ).body[0] as StatutoryAuditIcfr;

  /** Set the 02.5 Level-1 result as 02.5 would have stored it. */
  const setLevel1 = async (
    f: File,
    outcome: 'applicable' | 'exempt' | null,
    opts: { cfsInScope?: boolean } = {},
  ) => {
    const state =
      outcome === 'applicable'
        ? 'applicable'
        : outcome === 'exempt'
          ? 'not_applicable'
          : 'not_assessed';
    const factsUsed =
      opts.cfsInScope === undefined
        ? []
        : [{ key: 'cfs_in_scope', value: opts.cfsInScope ? 'Yes' : 'No' }];
    await su.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET state = $2, conclusion = $3, system_outcome = $3,
              decided_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END,
              system_detail = jsonb_set(COALESCE(system_detail, '{}'::jsonb), '{factsUsed}', $4::jsonb)
        WHERE workflow_instance_id = $1 AND sub_section_key = '02.5' AND area_key = 'ifc'`,
      [f.wf, state, outcome, JSON.stringify(factsUsed)],
    );
  };

  const getWs = async (f: File, t = pa): Promise<StatutoryAuditIcfrWorkstream> =>
    (
      await request(http())
        .get(`${icfrUrl(f)}/workstream`)
        .set(bearer(t))
        .expect(200)
    ).body as StatutoryAuditIcfrWorkstream;
  const getCons = async (f: File): Promise<StatutoryAuditIcfrConsolidated> =>
    (
      await request(http())
        .get(`${icfrUrl(f)}/consolidated`)
        .set(bearer(pa))
        .expect(200)
    ).body as StatutoryAuditIcfrConsolidated;
  const area = (w: StatutoryAuditIcfrWorkstream, key: string): IcfrProcessArea =>
    w.processAreas.find((a) => a.areaKey === key)!;
  const control = (w: StatutoryAuditIcfrWorkstream, ref: string): IcfrControl =>
    w.controls.find((c) => c.controlRef === ref)!;
  const deficiency = (w: StatutoryAuditIcfrWorkstream, ref: string): IcfrDeficiency =>
    w.deficiencies.find((d) => d.ref === ref)!;
  /** Assert the status, naming the server's message when it differs. */
  const expectStatus = (status: number) => (r: request.Response) => {
    if (r.status !== status)
      throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body?.message)}`);
  };
  const post = (f: File, path: string, body: object, status = 201, t = pa) =>
    request(http())
      .post(`${icfrUrl(f)}/${path}`)
      .set(bearer(t))
      .send(body)
      .expect(expectStatus(status));
  const patch = (f: File, path: string, body: object, status = 200, t = pa) =>
    request(http())
      .patch(`${icfrUrl(f)}/${path}`)
      .set(bearer(t))
      .send(body)
      .expect(expectStatus(status));

  /** A key ICFR control on an area, tested effective, evidenced and reviewed. */
  const reviewedControl = async (
    f: File,
    areaId: string,
    description: string,
    documentId: string,
  ): Promise<StatutoryAuditIcfrWorkstream> => {
    let w = (
      await post(f, 'controls', {
        processAreaId: areaId,
        description,
        purposeFsAudit: true,
        purposeIcfr: true,
        nature: 'manual',
        frequency: 'monthly',
        isKey: true,
      })
    ).body as StatutoryAuditIcfrWorkstream;
    let c = w.controls.find((x) => x.description === description)!;
    w = (
      await patch(f, `controls/${c.id}`, {
        design: 'adequate',
        implementation: 'implemented',
        operatingEffectiveness: 'effective',
        version: c.version,
      })
    ).body;
    c = control(w, c.controlRef);
    w = (await post(f, `controls/${c.id}/evidence`, { documentId })).body;
    c = control(w, c.controlRef);
    w = (await post(f, `controls/${c.id}/review`, { action: 'submit', version: c.version })).body;
    c = control(w, c.controlRef);
    return (await post(f, `controls/${c.id}/review`, { action: 'review', version: c.version }))
      .body;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    // Far-future years keep this suite's prior file the only one for the pair.
    prior = await createFile('2031-32');
    cur = await createFile('2032-33');
    await su.query(`UPDATE hsdg.engagements SET predecessor_engagement_id = $1 WHERE id = $2`, [
      prior.engId,
      cur.engId,
    ]);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('resolves the process-area framework by date — none before it is in force', async () => {
    const before = (
      await request(http())
        .get('/api/v1/icfr-process-area-library?on=2014-04-01')
        .set(bearer(pa))
        .expect(200)
    ).body as IcfrLibraryArea[];
    expect(before).toEqual([]);
    const lib = (
      await request(http())
        .get('/api/v1/icfr-process-area-library?on=2024-04-01')
        .set(bearer(pa))
        .expect(200)
    ).body as IcfrLibraryArea[];
    expect(lib.map((a) => a.areaKey)).toEqual([
      'entity_level',
      'financial_close',
      'revenue',
      'purchases',
      'inventory',
      'ppe',
      'payroll',
      'treasury',
      'taxation',
      'itgc',
      'other_significant',
    ]);
  });

  it('configures nothing before 02.5 is decisive', async () => {
    let w = await getWs(prior);
    expect(w.state).toBe('awaiting_conclusion');
    expect(w.workstream).toBeNull();
    await openIcfr(prior);
    await setLevel1(prior, null);
    w = await getWs(prior);
    expect(w.state).toBe('awaiting_conclusion');
    expect(w.processAreas).toEqual([]);
    await post(
      prior,
      'controls',
      {
        description: 'Board approves budget',
        purposeFsAudit: false,
        purposeIcfr: true,
        process: 'Governance',
      },
      400,
    );
  });

  it('configures the framework in Section 05 once reporting applies — idempotently', async () => {
    await setLevel1(prior, 'applicable');
    const w = await getWs(prior);
    expect(w.state).toBe('active');
    expect(w.workstream).toMatchObject({ frameworkCode: 'DHVAJ_ICFR', status: 'active' });
    expect(w.processAreas).toHaveLength(11);
    expect(area(w, 'entity_level').scoping).toBe('in_scope'); // always
    expect(area(w, 'financial_close').scoping).toBe('in_scope'); // always
    expect(area(w, 'other_significant').scoping).toBe('to_be_scoped'); // scoping
    expect(area(w, 'revenue').procedures.length).toBeGreaterThan(0);
    expect(w.methodology.partnerConclusionFor).toEqual([
      'significant_deficiency',
      'material_weakness',
    ]);
    const again = await getWs(prior);
    expect(again.processAreas.map((a) => a.id)).toEqual(w.processAreas.map((a) => a.id));
  });

  it('a prior-year material weakness, left unremediated, is followed up next year', async () => {
    const w = (
      await post(prior, 'deficiencies', {
        classification: 'material_weakness',
        description: 'No review of manual journals posted at year end.',
        processAreaId: area(await getWs(prior), 'financial_close').id,
        magnitude: 'material',
        likelihood: 'probable',
        reportingImpact: 'icfr_opinion_modified',
        remediationAction: 'Introduce a maker-checker on manual journals.',
        remediationStatus: 'not_remediated',
      })
    ).body as StatutoryAuditIcfrWorkstream;
    expect(deficiency(w, 'ICD-001')).toMatchObject({
      classification: 'material_weakness',
      suggestedClassification: 'material_weakness',
      partnerRequired: true,
      processTitle: 'Financial Close & Reporting',
    });
  });

  let docId: string;

  it('the current file opens with the prior-year follow-up and context', async () => {
    const icfr = await openIcfr(cur);
    const ev = (
      await request(http())
        .post(`${base(cur)}/${cur.wf}/framework/${icfr.assessment.id}/evidence/add`)
        .set(bearer(pa))
        .send({
          filename: 'Walkthrough and test of controls.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('ICFR testing (e2e)', 'utf8').toString('base64'),
        })
        .expect(201)
    ).body as FrameworkEvidenceView;
    docId = ev.files[0]!.documentId;

    await setLevel1(cur, 'applicable');
    const w = await getWs(cur);
    expect(w.state).toBe('active');
    expect(w.priorYear).toMatchObject({ financialYear: '2031-32', applicability: 'applicable' });
    expect(w.priorYear!.materialWeaknesses).toHaveLength(1);
    expect(w.followUps).toHaveLength(1);
    expect(w.followUps[0]).toMatchObject({
      priorRef: 'ICD-001',
      priorClassification: 'material_weakness',
      status: 'open',
    });
    expect(w.conclusionBlockers.join(' ')).toMatch(/prior-year follow-up on ICD-001/);
    expect((await getWs(cur)).followUps).toHaveLength(1); // idempotent
  });

  it('keeps a team scoping decision, and adds another significant process', async () => {
    let w = await getWs(cur);
    await patch(
      cur,
      `process-areas/${area(w, 'itgc').id}`,
      { scoping: 'not_in_scope', version: area(w, 'itgc').version },
      400,
    ); // reason required
    w = (
      await patch(cur, `process-areas/${area(w, 'itgc').id}`, {
        scoping: 'not_in_scope',
        scopingReason: 'Records are kept manually; no financial IT system (e2e).',
        version: area(w, 'itgc').version,
      })
    ).body;
    expect(area(w, 'itgc')).toMatchObject({ scoping: 'not_in_scope', scopingSource: 'team' });
    const other = area(w, 'other_significant');
    w = (
      await patch(cur, `process-areas/${other.id}`, {
        scoping: 'not_in_scope',
        scopingReason: 'No other significant process (e2e).',
        version: other.version,
      })
    ).body;
    w = (
      await post(cur, 'process-areas', {
        title: 'Government grants',
        scopingReason: 'Capital subsidy received this year (e2e).',
      })
    ).body;
    expect(area(w, 'other_government_grants')).toMatchObject({
      source: 'manual',
      scoping: 'in_scope',
      scopingSource: 'team',
    });
    // A stale write is refused.
    await patch(
      cur,
      `process-areas/${other.id}`,
      { scoping: 'in_scope', scopingReason: 'x', version: other.version },
      409,
    );
    // The re-read keeps the team's decision.
    expect(area(await getWs(cur), 'itgc').scoping).toBe('not_in_scope');
  });

  it('keeps design, implementation and operating effectiveness separate on one control record', async () => {
    let w = await getWs(cur);
    w = (
      await post(cur, 'controls', {
        processAreaId: area(w, 'entity_level').id,
        description: 'Audit committee reviews the quarterly results.',
        purposeFsAudit: true,
        purposeIcfr: true,
        assertions: ['presentation_and_disclosure'],
        isKey: true,
      })
    ).body;
    let c = control(w, 'IC-001');
    expect(c).toMatchObject({ process: 'Entity-Level Controls', overall: 'not_assessed' });
    // Submit is blocked until D, I and OE and the evidence are concluded.
    const blocked = await post(
      cur,
      `controls/${c.id}/review`,
      { action: 'submit', version: c.version },
      400,
    );
    expect(blocked.body.message).toMatch(/design/);
    expect(blocked.body.message).toMatch(/operating-effectiveness/);
    w = (
      await patch(cur, `controls/${c.id}`, {
        design: 'adequate',
        implementation: 'implemented',
        operatingEffectiveness: 'exception_identified',
        version: c.version,
      })
    ).body;
    c = control(w, 'IC-001');
    expect(c).toMatchObject({
      design: 'adequate',
      implementation: 'implemented',
      operatingEffectiveness: 'exception_identified',
    });
    expect(c.blockers.join(' ')).toMatch(/Raise the deficiency/);
    w = (await post(cur, `controls/${c.id}/evidence`, { documentId: docId })).body;
    c = control(w, 'IC-001');
    expect(c.evidence[0]).toMatchObject({ documentId: docId });
    // An FS-audit-only control is allowed without OE.
    w = (
      await post(cur, 'controls', {
        process: 'Inventory',
        description: 'Stock count sheets are signed by the warehouse head.',
        purposeFsAudit: true,
        purposeIcfr: false,
      })
    ).body;
    expect(control(w, 'IC-002')).toMatchObject({ purposeIcfr: false, processAreaId: null });
    expect(w.summary.controls).toMatchObject({ total: 2, icfr: 1, fsAuditOnly: 1 });
  });

  it('classifies deficiencies by the methodology; MW and SD need the partner', async () => {
    let w = await getWs(cur);
    const c = control(w, 'IC-001');
    w = (
      await post(cur, 'deficiencies', {
        controlId: c.id,
        classification: 'significant_deficiency',
        description: 'Audit committee review not evidenced for Q2 and Q3.',
        affectedAccount: 'Financial statements as a whole',
        assertions: ['presentation_and_disclosure'],
        auditImpact: 'Extended substantive review of quarterly results.',
        magnitude: 'material',
        likelihood: 'probable',
      })
    ).body;
    let d = deficiency(w, 'ICD-001');
    expect(d).toMatchObject({
      suggestedClassification: 'material_weakness',
      controlRef: 'IC-001',
      processTitle: 'Entity-Level Controls',
      partnerRequired: true,
    });
    expect(control(w, 'IC-001').deficiencies).toEqual(['ICD-001']);
    // Below the suggestion without compensating controls → the review is blocked.
    let r = await post(
      cur,
      `deficiencies/${d.id}/review`,
      { action: 'manager_review', version: d.version },
      400,
    );
    expect(r.body.message).toMatch(/compensating/i);
    w = (
      await patch(cur, `deficiencies/${d.id}`, {
        classification: 'material_weakness',
        reportingImpact: 'icfr_opinion_modified',
        remediationAction: 'Minute the audit committee review every quarter.',
        version: d.version,
      })
    ).body;
    d = deficiency(w, 'ICD-001');
    w = (
      await post(cur, `deficiencies/${d.id}/review`, {
        action: 'manager_review',
        version: d.version,
      })
    ).body;
    d = deficiency(w, 'ICD-001');
    expect(d.reviewedAt).not.toBeNull();
    // Reviewed: the classification is locked.
    await patch(
      cur,
      `deficiencies/${d.id}`,
      { classification: 'control_deficiency', version: d.version },
      409,
    );
    // The partner concludes with a note.
    r = await post(
      cur,
      `deficiencies/${d.id}/review`,
      { action: 'partner_conclude', version: d.version },
      400,
    );
    expect(r.body.message).toMatch(/Partner's conclusion/);
    w = (
      await post(cur, `deficiencies/${d.id}/review`, {
        action: 'partner_conclude',
        partnerConclusion: 'Material weakness — the ICFR opinion is modified.',
        version: d.version,
      })
    ).body;
    expect(deficiency(w, 'ICD-001').partnerAt).not.toBeNull();
  });

  it('a follow-up that persists raises a current-year deficiency', async () => {
    let w = await getWs(cur);
    const f = w.followUps[0]!;
    await patch(cur, `follow-ups/${f.id}`, { status: 'persists', version: f.version }, 400);
    w = (
      await patch(cur, `follow-ups/${f.id}`, {
        status: 'persists',
        conclusionNote: 'Manual journals are still posted without review (e2e).',
        version: f.version,
      })
    ).body;
    expect(w.followUps[0]).toMatchObject({ status: 'persists', deficiencyRef: 'ICD-002' });
    expect(deficiency(w, 'ICD-002')).toMatchObject({
      classification: 'material_weakness',
      followUpId: f.id,
    });
  });

  it('only the Engagement Partner concludes the workstream, once nothing is outstanding', async () => {
    let w = await getWs(cur);
    const ws = w.workstream!;
    let r = await post(
      cur,
      'workstream/conclusion',
      { conclusion: 'modified_material_weakness', version: ws.version },
      400,
    );
    expect(r.body.message).toMatch(
      /Financial Close & Reporting is in scope but has no key ICFR control/,
    );

    // Clear the outstanding work: key controls for every in-scope area, the
    // raised deficiency reviewed and concluded.
    for (const key of ['financial_close', 'other_government_grants']) {
      w = await reviewedControl(cur, area(w, key).id, `Key control for ${key} (e2e)`, docId);
    }
    let d = deficiency(w, 'ICD-002');
    w = (
      await patch(cur, `deficiencies/${d.id}`, {
        reportingImpact: 'icfr_opinion_modified',
        remediationAction: 'Maker-checker on manual journals.',
        affectedAccount: 'Journal entries',
        assertions: ['accuracy', 'occurrence'],
        auditImpact: 'Journal-entry testing extended to the full year.',
        magnitude: 'material',
        likelihood: 'probable',
        version: d.version,
      })
    ).body;
    d = deficiency(w, 'ICD-002');
    w = (
      await post(cur, `deficiencies/${d.id}/review`, {
        action: 'manager_review',
        version: d.version,
      })
    ).body;
    d = deficiency(w, 'ICD-002');
    w = (
      await post(cur, `deficiencies/${d.id}/review`, {
        action: 'partner_conclude',
        partnerConclusion: 'Persisting material weakness.',
        version: d.version,
      })
    ).body;
    // IC-001 (not effective) still needs its review.
    let c = control(w, 'IC-001');
    w = (await post(cur, `controls/${c.id}/review`, { action: 'submit', version: c.version })).body;
    c = control(w, 'IC-001');
    w = (await post(cur, `controls/${c.id}/review`, { action: 'review', version: c.version })).body;
    expect(w.conclusionBlockers).toEqual([]);

    r = await post(
      cur,
      'workstream/conclusion',
      { conclusion: 'unmodified', version: w.workstream!.version },
      400,
    );
    expect(r.body.message).toMatch(/cannot be unmodified/);
    w = (
      await post(cur, 'workstream/conclusion', {
        conclusion: 'modified_material_weakness',
        note: 'Two material weaknesses (e2e).',
        version: w.workstream!.version,
      })
    ).body;
    expect(w.workstream).toMatchObject({ conclusion: 'modified_material_weakness' });

    const rep = (
      await request(http())
        .get(`${icfrUrl(cur)}/reporting`)
        .set(bearer(pa))
        .expect(200)
    ).body as IcfrReportingSummary;
    expect(rep).toMatchObject({
      workstreamActive: true,
      concluded: true,
      conclusion: 'modified_material_weakness',
    });
    expect(rep.materialWeaknesses.map((m) => m.ref)).toEqual(['ICD-001', 'ICD-002']);
    expect(rep.deficiencies).toMatchObject({ materialWeaknesses: 2, awaitingPartner: 0 });
  });

  it('withdraws (never deletes) when reporting is exempt, and reactivates with the work kept', async () => {
    await setLevel1(cur, 'exempt');
    let w = await getWs(cur);
    expect(w.state).toBe('withdrawn');
    expect(w.workstream?.status).toBe('withdrawn');
    expect(w.controls.length).toBeGreaterThan(0); // the record is kept
    await post(
      cur,
      'controls',
      { process: 'Payroll', description: 'x', purposeFsAudit: false, purposeIcfr: true },
      400,
    );
    // FS-audit controls stay available.
    await post(cur, 'controls', {
      process: 'Payroll',
      description: 'Payroll register reviewed by HR head.',
      purposeFsAudit: true,
      purposeIcfr: false,
    });
    const rep = (
      await request(http())
        .get(`${icfrUrl(cur)}/reporting`)
        .set(bearer(pa))
        .expect(200)
    ).body as IcfrReportingSummary;
    expect(rep.workstreamActive).toBe(false);

    await setLevel1(cur, 'applicable');
    w = await getWs(cur);
    expect(w.state).toBe('active');
    expect(w.workstream?.conclusion).toBe('modified_material_weakness');
    expect(area(w, 'itgc').scoping).toBe('not_in_scope');
  });

  it('the consolidated consideration exists only with CFS in scope, and the partner concludes it', async () => {
    let c = await getCons(cur);
    expect(c.state).toBe('pending'); // 02.6 has not said whether a CFS is in scope
    await setLevel1(cur, 'applicable', { cfsInScope: false });
    c = await getCons(cur);
    expect(c.state).toBe('not_required');
    expect(c.consolidated).toBeNull();

    await setLevel1(cur, 'applicable', { cfsInScope: true });
    c = await getCons(cur);
    expect(c.state).toBe('active');
    c = (
      await post(cur, 'consolidated/components', {
        componentName: 'Acme Overseas Ltd',
        relationship: 'subsidiary',
      })
    ).body;
    let m = c.components.find((x) => x.componentName === 'Acme Overseas Ltd')!;
    expect(m).toMatchObject({ source: 'manual', componentIcfr: 'pending' });
    expect(m.missing.length).toBeGreaterThan(0);
    let r = await post(
      cur,
      'consolidated/conclusion',
      { parentConclusion: 'unmodified', version: c.consolidated!.version },
      400,
    );
    expect(r.body.message).toMatch(/Acme Overseas Ltd/);

    c = (
      await patch(cur, `consolidated/components/${m.id}`, {
        indianCompany: 'no',
        version: m.version,
      })
    ).body;
    m = c.components.find((x) => x.id === m.id)!;
    expect(m.missing).toEqual([]);
    expect(c.summary).toMatchObject({ components: 1, pending: 0, indianCompanies: 0 });
    // The parent's own material weakness points the suggestion.
    expect(c.suggestedConclusion).toBe('modified_parent_material_weakness');
    r = await post(
      cur,
      'consolidated/conclusion',
      { parentConclusion: 'unmodified', version: c.consolidated!.version },
      400,
    );
    expect(r.body.message).toMatch(/material weakness/i);
    c = (
      await post(cur, 'consolidated/conclusion', {
        parentConclusion: 'modified_parent_material_weakness',
        note: 'Parent material weaknesses carry to the group (e2e).',
        version: c.consolidated!.version,
      })
    ).body;
    expect(c.consolidated).toMatchObject({ parentConclusion: 'modified_parent_material_weakness' });
    const rep = (
      await request(http())
        .get(`${icfrUrl(cur)}/reporting`)
        .set(bearer(pa))
        .expect(200)
    ).body as IcfrReportingSummary;
    expect(rep.consolidated).toMatchObject({
      active: true,
      parentConclusion: 'modified_parent_material_weakness',
    });
  });

  it('the ICFR memo needs an approved firm template', async () => {
    const res = await request(http())
      .post(`${icfrUrl(cur)}/memo`)
      .set(bearer(pa))
      .send({})
      .expect(400);
    expect(res.body.message).toMatch(/ICFR Reporting Applicability/);
  });

  it('records immutable audit events', async () => {
    const res = await request(http()).get('/api/v1/audit?limit=100').set(bearer(mp)).expect(200);
    const actions = new Set((res.body.items as Array<{ action: string }>).map((e) => e.action));
    for (const a of [
      'statutory_audit.icfr_control_created',
      'statutory_audit.icfr_deficiency_raised',
      'statutory_audit.icfr_control_review',
    ])
      expect(actions.has(a)).toBe(true);
  });

  it('an outsider cannot read or change the workstream', async () => {
    const res = await request(http())
      .get(`${icfrUrl(cur)}/workstream`)
      .set(bearer(pb));
    expect([403, 404]).toContain(res.status);
    const w = await getWs(cur);
    await request(http())
      .patch(`${icfrUrl(cur)}/process-areas/${w.processAreas[0]!.id}`)
      .set(bearer(pb))
      .send({ scoping: 'in_scope', scopingReason: 'x', version: w.processAreas[0]!.version })
      .expect((r) => expect([403, 404]).toContain(r.status));
  });
});

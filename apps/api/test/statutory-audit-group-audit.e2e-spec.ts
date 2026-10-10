import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  ConsolidationWorkProgramme,
  GroupAuditComponent,
  StatutoryAuditGroupAudit,
  StatutoryAuditIcfrConsolidated,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.6 Part B — group / component / branch auditor framework end-to-end
 * (DHVAJ 02.6 spec §12–§17, §19–§21). 02.6's result is set as Track A's
 * assessment stores it; this suite drives the matrix, SA 600 answers, the
 * reporting package (approved evidence never silently replaced), findings,
 * branch auditors, the work programme and the prior-year roll-forward.
 */
describe('Statutory Audit — 02.6 group audit framework (e2e)', () => {
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
  const gaUrl = (f: File) => `${base(f)}/${f.wf}/group-audit`;

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
    const f = { engId, wf: shells.body[0].workflowInstanceId as string };
    // Open 02.6 so its row exists.
    await request(http())
      .get(`${base(f)}/consolidation`)
      .set(bearer(pa))
      .expect(200);
    return f;
  };

  const ALPHA = { id: 'cmp-alpha', name: 'Alpha Overseas Ltd' };
  const BETA = { id: 'cmp-beta', name: 'Beta Components Pvt Ltd' };

  /** Store 02.6's result as Track A's assessment does. */
  const set026 = async (
    f: File,
    outcome: 'cfs_required' | 'cfs_exempt' | null,
    opts: { hasBranches?: boolean; withBeta?: boolean; withExcluded?: boolean } = {},
  ) => {
    const perimeter = [
      {
        id: ALPHA.id,
        name: ALPHA.name,
        relationship: 'subsidiary',
        method: 'full_consolidation',
        included: 'yes',
        country: 'Singapore',
        isIndianCompany: false,
        auditedByOtherAuditor: true,
      },
      ...(opts.withBeta === false
        ? []
        : [
            {
              id: BETA.id,
              name: BETA.name,
              relationship: 'associate',
              method: 'equity_method',
              included: 'yes',
              country: 'India',
              isIndianCompany: true,
            },
          ]),
      // Outside the period / excluded — kept on the perimeter, never a component.
      ...(opts.withExcluded
        ? [
            {
              id: 'cmp-gamma',
              name: 'Gamma Trading Ltd',
              relationship: 'subsidiary',
              method: 'full_consolidation',
              included: 'no',
              country: 'India',
              isIndianCompany: true,
            },
          ]
        : []),
    ];
    await su.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET state = $2, conclusion = $3, system_outcome = $3,
              decided_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END,
              system_detail = jsonb_set(COALESCE(system_detail, '{}'::jsonb), '{perimeter}', $4::jsonb),
              facts = jsonb_set(COALESCE(facts, '{}'::jsonb), '{hasBranches}', to_jsonb($5::boolean))
        WHERE workflow_instance_id = $1 AND sub_section_key = '02.6' AND area_key = 'cfs'`,
      [
        f.wf,
        outcome === 'cfs_required' ? 'applicable' : outcome ? 'not_applicable' : 'not_assessed',
        outcome,
        JSON.stringify(perimeter),
        opts.hasBranches === true,
      ],
    );
  };

  const expectStatus = (status: number) => (r: request.Response) => {
    if (r.status !== status)
      throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body?.message)}`);
  };
  const getGa = async (f: File, t = pa): Promise<StatutoryAuditGroupAudit> =>
    (await request(http()).get(gaUrl(f)).set(bearer(t)).expect(expectStatus(200)))
      .body as StatutoryAuditGroupAudit;
  const send = (
    method: 'post' | 'patch',
    f: File,
    path: string,
    body: object,
    status = method === 'post' ? 201 : 200,
    t = pa,
  ) =>
    request(http())
      [method](`${gaUrl(f)}${path ? `/${path}` : ''}`)
      .set(bearer(t))
      .send(body)
      .expect(expectStatus(status));
  const comp = (g: StatutoryAuditGroupAudit, id: string): GroupAuditComponent =>
    g.components.find((c) => c.componentId === id)!;
  const pdf = (text: string) => ({
    contentType: 'application/pdf',
    contentBase64: Buffer.from(text, 'utf8').toString('base64'),
  });

  beforeAll(async () => {
    await seedIdentityFixtures();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    prior = await createFile('2035-36');
    cur = await createFile('2036-37');
    await su.query(`UPDATE hsdg.engagements SET predecessor_engagement_id = $1 WHERE id = $2`, [
      prior.engId,
      cur.engId,
    ]);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('waits for 02.6 — no matrix and no work programme until CFS is decided', async () => {
    const g = await getGa(prior);
    expect(g.matrixState).toBe('awaiting');
    expect(g.components).toEqual([]);
    const wp = (
      await request(http())
        .get(`${gaUrl(prior)}/work-programme`)
        .set(bearer(pa))
    ).body as ConsolidationWorkProgramme;
    expect(wp.state).toBe('awaiting');
  });

  it('builds one matrix row per included component, keyed on its stable id (§12)', async () => {
    await set026(prior, 'cfs_required');
    const g = await getGa(prior);
    expect(g.matrixState).toBe('active');
    expect(g.components.map((c) => c.componentId).sort()).toEqual([ALPHA.id, BETA.id]);
    expect(comp(g, ALPHA.id)).toMatchObject({
      auditorType: 'other_auditor',
      auditorSource: 'system',
      sa600: 'required',
      isIndianCompany: false,
    });
    expect(comp(g, BETA.id).auditorType).toBe('tbd');
    expect(g.status.matrixComplete).toBe(false); // Beta's auditor is still TBD
    expect(g.ga01).toBe('further_assessment');
    expect((await getGa(prior)).components).toHaveLength(2); // idempotent
  });

  it('records the auditor and the SA 600 answers; a Yes / No needs its basis (§13)', async () => {
    let g = await getGa(prior);
    const beta = comp(g, BETA.id);
    g = (
      await send('patch', prior, `components/${beta.id}`, {
        auditorType: 'dhvaj',
        version: beta.version,
      })
    ).body;
    expect(comp(g, BETA.id)).toMatchObject({
      auditorType: 'dhvaj',
      auditorSource: 'team',
      sa600: 'not_applicable',
    });
    // Stale version.
    await send(
      'patch',
      prior,
      `components/${beta.id}`,
      { significance: 'significant', version: beta.version },
      409,
    );

    let alpha = comp(g, ALPHA.id);
    await send(
      'patch',
      prior,
      `components/${alpha.id}`,
      { ga04: 'yes', version: alpha.version },
      400,
    );
    g = (
      await send('patch', prior, `components/${alpha.id}`, {
        firmName: 'Tan & Lee LLP',
        auditorCountry: 'Singapore',
        professionalBody: 'ISCA',
        periodFrom: '2035-04-01',
        periodTo: '2036-03-31',
        reportType: 'unmodified',
        significance: 'significant',
        ga02: 'yes',
        ga02Basis: 'Member firm of a recognised network; ISCA registered (e2e).',
        ga03: 'yes',
        ga04: 'pending',
        version: alpha.version,
      })
    ).body;
    alpha = comp(g, ALPHA.id);
    expect(alpha).toMatchObject({ firmName: 'Tan & Lee LLP', significance: 'significant' });
    expect(g.status.matrixComplete).toBe(true);
    // A significant other-auditor component with GA-04 pending blocks completion.
    expect(g.status.blockingMatters.join(' ')).toMatch(/Alpha Overseas Ltd/);
  });

  it('feeds the matrix auditor into the consolidated ICFR components — one record per component (§20)', async () => {
    await set026(prior, 'cfs_required', { withExcluded: true });
    expect((await getGa(prior)).components.map((c) => c.componentId)).not.toContain('cmp-gamma');
    // 02.5 Level 1: applicable, with a CFS in scope.
    await request(http())
      .get(`${base(prior)}/icfr`)
      .set(bearer(pa))
      .expect(200);
    await su.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET state = 'applicable', conclusion = 'applicable', system_outcome = 'applicable',
              decided_at = now(),
              system_detail = jsonb_set(COALESCE(system_detail, '{}'::jsonb), '{factsUsed}',
                '[{"key":"cfs_in_scope","value":"Yes"}]'::jsonb)
        WHERE workflow_instance_id = $1 AND sub_section_key = '02.5' AND area_key = 'ifc'`,
      [prior.wf],
    );
    const c = (
      await request(http())
        .get(`${base(prior)}/${prior.wf}/icfr/consolidated`)
        .set(bearer(pa))
        .expect(200)
    ).body as StatutoryAuditIcfrConsolidated;
    const live = c.components.filter((x) => !x.withdrawn);
    expect(live.map((x) => x.componentName).sort()).toEqual([ALPHA.name, BETA.name]);
    expect(live.find((x) => x.componentName === ALPHA.name)).toMatchObject({
      source: '02.6',
      auditor: 'other',
      auditorName: 'Tan & Lee LLP',
    });
    expect(live.find((x) => x.componentName === BETA.name)).toMatchObject({
      auditor: 'dhvaj',
      auditorName: 'DHVAJ',
    });
    await set026(prior, 'cfs_required'); // restore the perimeter for the rest of the suite
  });

  it('a foreign component takes no CARO / ICFR package documents (§15)', async () => {
    const g = await getGa(prior);
    const pkg = comp(g, ALPHA.id).package;
    expect(pkg).toHaveLength(10);
    expect(pkg.find((p) => p.key === 'caro_report')).toMatchObject({ relevant: false });
    expect(pkg.find((p) => p.key === 'icfr_report')).toMatchObject({ relevant: false });
    expect(pkg.find((p) => p.key === 'audit_report')).toMatchObject({
      relevant: true,
      status: 'pending',
    });
    expect(comp(g, BETA.id).package).toEqual([]); // audited by DHVAJ
  });

  it('never silently replaces approved package evidence (§15)', async () => {
    let g = await getGa(prior);
    const alpha = comp(g, ALPHA.id);
    const url = `components/${alpha.id}/package/audit_report`;
    await send('patch', prior, url, { status: 'approved' }, 400); // nothing to approve yet
    g = (
      await send('post', prior, 'files/add', {
        slot: 'package',
        ownerId: alpha.id,
        packageKey: 'audit_report',
        filename: 'Alpha audit report FY36.pdf',
        ...pdf('component audit report v1 (e2e)'),
      })
    ).body;
    expect(comp(g, ALPHA.id).package.find((p) => p.key === 'audit_report')).toMatchObject({
      status: 'received',
    });
    g = (await send('patch', prior, url, { status: 'approved' })).body;
    const approved = comp(g, ALPHA.id).package.find((p) => p.key === 'audit_report')!;
    expect(approved.status).toBe('approved');
    expect(approved.approvedByName).toBeTruthy();

    const v2 = {
      slot: 'package',
      ownerId: alpha.id,
      packageKey: 'audit_report',
      filename: 'Alpha audit report FY36 (signed).pdf',
      ...pdf('component audit report v2 (e2e)'),
    };
    const r = await send('post', prior, 'files/add', v2, 400);
    expect(r.body.message).toMatch(/approved — give a reason/);
    g = (await send('post', prior, 'files/add', { ...v2, replaceReason: 'Signed copy received.' }))
      .body;
    const replaced = comp(g, ALPHA.id).package.find((p) => p.key === 'audit_report')!;
    expect(replaced.status).toBe('received'); // needs approving again
    expect(replaced.file?.filename).toBe('Alpha audit report FY36 (signed).pdf');
    expect(replaced.superseded).toHaveLength(1);

    // N/A needs a note for a relevant document.
    await send(
      'patch',
      prior,
      `components/${alpha.id}/package/related_party`,
      { status: 'not_applicable' },
      400,
    );
  });

  it('raises findings with the allowed impacts; fraud is always escalated (§16)', async () => {
    let g = await getGa(prior);
    const alpha = comp(g, ALPHA.id);
    await send(
      'post',
      prior,
      'findings',
      {
        subjectKind: 'component',
        subjectId: alpha.id,
        category: 'fraud',
        impacts: ['no_impact'],
        description: 'x',
      },
      400,
    );
    g = (
      await send('post', prior, 'findings', {
        subjectKind: 'component',
        subjectId: alpha.id,
        category: 'fraud',
        impacts: ['escalation_audit_response'],
        description: 'Suspected misappropriation of inventory at the Singapore warehouse.',
      })
    ).body;
    expect(g.findings[0]).toMatchObject({
      ref: 'GF-001',
      subjectName: ALPHA.name,
      escalated: true,
      reportingConsideration: true,
      status: 'open',
    });
    expect(g.status.blockingMatters.join(' ')).toMatch(/GF-001/);
    // Resolving needs the principal auditor's response.
    const f = g.findings[0]!;
    await send('patch', prior, `findings/${f.id}`, { status: 'resolved', version: f.version }, 400);
  });

  it('records branch auditors; BR-01 No is rejected while a branch record is live (§17)', async () => {
    let g = (await send('post', prior, 'branches', { branchName: 'Pune branch', location: 'Pune' }))
      .body as StatutoryAuditGroupAudit;
    expect(g.br01).toBe('yes'); // system: a live branch record
    const b = g.branches[0]!;
    g = (
      await send('patch', prior, `branches/${b.id}`, {
        firmName: 'Joshi & Associates',
        appointmentBasis: 'board_authorised',
        version: b.version,
      })
    ).body;
    await send('patch', prior, '', { br01: 'no', br01Basis: 'x', version: g.version }, 400);
    const live = g.branches[0]!;
    await send(
      'patch',
      prior,
      `branches/${live.id}`,
      { conclusion: 'relied', version: live.version },
      400, // needs the principal auditor's response
    );
  });

  it('generates the 15-item consolidation work programme with applicability (§19)', async () => {
    const wp = (
      await request(http())
        .get(`${gaUrl(prior)}/work-programme`)
        .set(bearer(pa))
        .expect(200)
    ).body as ConsolidationWorkProgramme;
    expect(wp.state).toBe('active');
    expect(wp.items).toHaveLength(15);
    expect(wp.items.every((i) => i.basis.length > 0)).toBe(true);
    expect(wp.items.find((i) => i.itemKey === 'mapping_perimeter')?.applicable).toBe(true);
  });

  it('rolls last year forward as suggestions and follow-ups, never conclusions (§21)', async () => {
    await set026(cur, 'cfs_required');
    const g = await getGa(cur);
    const alpha = comp(g, ALPHA.id);
    expect(alpha).toMatchObject({
      auditorType: 'other_auditor',
      auditorSource: 'prior_year',
      firmName: 'Tan & Lee LLP',
      priorYear: { auditorType: 'other_auditor', firmName: 'Tan & Lee LLP' },
    });
    expect(alpha.answers.ga04).toBe('pending'); // answers start fresh
    expect(comp(g, BETA.id)).toMatchObject({ auditorType: 'dhvaj', auditorSource: 'prior_year' });
    expect(g.branches).toHaveLength(1);
    expect(g.branches[0]).toMatchObject({
      branchName: 'Pune branch',
      firmName: 'Joshi & Associates',
      fromPriorYear: true,
      conclusion: 'pending',
    });
    expect(g.findings).toHaveLength(1);
    expect(g.findings[0]!.priorYearRef).toBe('GF-001 (2035-36)');
    expect(g.findings[0]!.description).toMatch(/^Follow-up of last year's GF-001/);
    expect((await getGa(cur)).findings).toHaveLength(1); // idempotent
  });

  it('withdraws (never deletes) when a component leaves the perimeter or CFS stops', async () => {
    await set026(cur, 'cfs_required', { withBeta: false });
    let g = await getGa(cur);
    expect(comp(g, BETA.id).withdrawn).toBe(true);
    await send(
      'patch',
      cur,
      `components/${comp(g, BETA.id).id}`,
      { significance: 'significant', version: comp(g, BETA.id).version },
      409,
    );

    await set026(cur, 'cfs_exempt');
    g = await getGa(cur);
    expect(g.matrixState).toBe('not_required');
    expect(g.components.every((c) => c.withdrawn)).toBe(true);
    const wp = (
      await request(http())
        .get(`${gaUrl(cur)}/work-programme`)
        .set(bearer(pa))
        .expect(200)
    ).body as ConsolidationWorkProgramme;
    expect(wp.state).toBe('withdrawn');
    expect(wp.items.every((i) => i.withdrawn)).toBe(true);
    await set026(cur, 'cfs_required');
    g = await getGa(cur);
    expect(comp(g, ALPHA.id).withdrawn).toBe(false); // reactivated with the record kept
  });

  it('the instructions and the 02.6 memo need an approved firm template', async () => {
    const g = await getGa(prior);
    const r = await send('post', prior, `components/${comp(g, ALPHA.id).id}/instructions`, {}, 400);
    expect(r.body.message).toMatch(/Component Auditor Instructions/);
    await send('post', prior, `components/${comp(g, BETA.id).id}/instructions`, {}, 400); // DHVAJ
    const m = await request(http())
      .post(`${base(prior)}/${prior.wf}/consolidation/memo`)
      .set(bearer(pa))
      .send({})
      .expect(400);
    expect(m.body.message).toMatch(/Consolidation & Group Audit Framework/);
  });

  it('records immutable audit events', async () => {
    const res = await request(http()).get('/api/v1/audit?limit=100').set(bearer(mp)).expect(200);
    const actions = new Set((res.body.items as Array<{ action: string }>).map((e) => e.action));
    for (const a of [
      'statutory_audit.group_component_updated',
      'statutory_audit.group_package_updated',
      'statutory_audit.group_file_added',
      'statutory_audit.group_finding_created',
      'statutory_audit.group_branch_created',
    ])
      expect(actions.has(a)).toBe(true);
  });

  it('an outsider cannot read or change the framework', async () => {
    const res = await request(http()).get(gaUrl(prior)).set(bearer(pb));
    expect([403, 404]).toContain(res.status);
    await request(http())
      .post(`${gaUrl(prior)}/branches`)
      .set(bearer(pb))
      .send({ branchName: 'Intruder branch' })
      .expect((r) => expect([403, 404]).toContain(r.status));
  });
});

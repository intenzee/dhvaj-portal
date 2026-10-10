import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import JSZip from 'jszip';
import { Client } from 'pg';
import type {
  AuthorityReference,
  DocumentTemplateRecord,
  FinancialReportingDownstreamView,
  FrameworkEvidenceView,
  FrameworkMemoCreated,
  StatutoryAuditFinancialReporting,
  StatutoryAuditWorkGeneration,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { tinyDocx } from './section01-files.helper';

/**
 * 02.2 Financial Reporting Framework — evidence, technical memo, provision
 * library and downstream impact (DHVAJ 02.2 spec §7, §18, §19, §20; acceptance
 * tests 11 and 12):
 *   • every 02.2 reference resolves through the central Provision Library for
 *     the engagement period, with its MCA / ICAI source link;
 *   • evidence is added (engagement workspace) or linked (never copied), opens
 *     with its version history, and is removed softly; outsiders see nothing;
 *   • the technical memo is created from the firm's approved Word template with
 *     the 02.2 assessment facts merged in;
 *   • the downstream panel previews what the conclusion activates.
 */
jest.setTimeout(30_000);

describe('Statutory Audit — 02.2 evidence, memo, references, downstream (e2e)', () => {
  let app: INestApplication;
  let mp: string; // Managing Partner — firm-wide admin (templates).
  let pa: string; // Partner A — the Engagement Partner / lead.
  let pb: string; // Partner B — not on the engagement.
  let engId: string;
  let shellId: string;
  let subId: string;

  const token = async (email: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/api/v1/auth/dev-token').send({ email }).expect(201))
      .body.accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePeriod = (): string => `P${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const findId = async (path: string): Promise<string> =>
    (await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200)).body.items[0]
      .id as string;
  const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    const http = app.getHttpServer();

    const entityId = await findId('/api/v1/entities?search=Acme&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    engId = (
      await request(http)
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId: primaryServiceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    await request(http)
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);
    shellId = (
      await request(http)
        .get(`/api/v1/engagements/${engId}/statutory-audit`)
        .set(bearer(pa))
        .expect(200)
    ).body[0].workflowInstanceId as string;
    // Opening 02.2 seeds its sub-assessment.
    subId = (
      await request(http)
        .get(`/api/v1/engagements/${engId}/statutory-audit/financial-reporting`)
        .set(bearer(pa))
        .expect(200)
    ).body[0].assessment.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  const evidenceUrl = () =>
    `/api/v1/engagements/${engId}/statutory-audit/${shellId}/framework/${subId}/evidence`;
  const memoUrl = () =>
    `/api/v1/engagements/${engId}/statutory-audit/${shellId}/financial-reporting/memo`;

  // ── §20 / acceptance test 11: the central Provision Library ───────────────

  it('resolves every 02.2 reference through the library for the engagement period', async () => {
    const http = app.getHttpServer();
    const refs = (
      await request(http)
        .get('/api/v1/authority-provisions/references/02.2?on=2024-04-01')
        .set(bearer(pa))
        .expect(200)
    ).body as AuthorityReference[];
    const byAnchor = new Map(refs.map((r) => [r.anchor, r]));
    expect([...byAnchor.keys()]).toEqual([
      'indas_applicability',
      'rule_4',
      'rule_4_1_i',
      'rule_4_proviso',
      'rule_4_nbfc',
      'group_applicability',
      'net_worth',
      'current_indas',
      'as_rules',
      'smc_definition',
      'indas_101',
    ]);
    expect(byAnchor.get('indas_applicability')!.label).toBe('View Ind AS Applicability Provision');
    // Every one resolves to a version in force, with a summary and an official source.
    for (const r of refs) {
      expect(r.provision).not.toBeNull();
      expect(r.provision!.sourceUrl).toMatch(
        /^https:\/\/(www\.mca\.gov\.in|www\.indiacode\.nic\.in)\//,
      );
      expect(r.provision!.summary).toBeTruthy();
    }
    expect(byAnchor.get('net_worth')!.provision!.provisionNumber).toBe('Section 2(57)');
    expect(byAnchor.get('indas_101')!.provision!.referenceKind).toBe('standard');

    // A pre-2021 period: the 2021 AS Rules were not yet in force — the viewer says so.
    const old = (
      await request(http)
        .get('/api/v1/authority-provisions/references/02.2?on=2019-04-01')
        .set(bearer(pa))
        .expect(200)
    ).body as AuthorityReference[];
    expect(old.find((r) => r.anchor === 'as_rules')!.provision).toBeNull();

    // A cited provision version (the triggered rule's) is appended once.
    const smc2006 = (
      await request(http)
        .get('/api/v1/authority-provisions/AS_RULES_2006_SMC?on=2019-04-01')
        .set(bearer(pa))
        .expect(200)
    ).body as { id: string; sourceUrl: string };
    expect(smc2006.sourceUrl).toMatch(/^https:\/\/www\.mca\.gov\.in\//);
    const cited = (
      await request(http)
        .get(`/api/v1/authority-provisions/references/02.2?on=2019-04-01&cited=${smc2006.id}`)
        .set(bearer(pa))
        .expect(200)
    ).body as AuthorityReference[];
    expect(cited).toHaveLength(old.length + 1);
    expect(cited.at(-1)!.code).toBe('AS_RULES_2006_SMC');

    await request(http)
      .get('/api/v1/authority-provisions/references/bad')
      .set(bearer(pa))
      .expect(400);
    await request(http)
      .get('/api/v1/authority-provisions/references/02.2?cited=not-a-uuid')
      .set(bearer(pa))
      .expect(400);
  });

  // ── §7 / §18: evidence ─────────────────────────────────────────────────

  it('adds, links (no copy), opens history for and removes 02.2 evidence', async () => {
    const http = app.getHttpServer();
    let view = (await request(http).get(evidenceUrl()).set(bearer(pa)).expect(200))
      .body as FrameworkEvidenceView;
    expect(view).toMatchObject({ subSectionKey: '02.2', readOnly: false, files: [] });
    expect(view.memo).not.toBeNull();

    const bytes = Buffer.from('Prior-year Ind AS financial statements (e2e)', 'utf8');
    view = (
      await request(http)
        .post(`${evidenceUrl()}/add`)
        .set(bearer(pa))
        .send({
          filename: 'FS 2023-24.pdf',
          contentType: 'application/pdf',
          contentBase64: bytes.toString('base64'),
        })
        .expect(201)
    ).body;
    expect(view.files).toHaveLength(1);
    const added = view.files[0]!;
    expect(added).toMatchObject({
      kind: 'evidence',
      filename: 'FS 2023-24.pdf',
      currentVersionNo: 1,
    });

    // The same document twice is refused; history falls back to the portal's.
    await request(http)
      .post(`${evidenceUrl()}/link`)
      .set(bearer(pa))
      .send({ documentId: added.documentId })
      .expect(409);
    const history = await request(http)
      .get(`${evidenceUrl()}/${added.id}/versions`)
      .set(bearer(pa))
      .expect(200);
    expect(history.body.source).toBe('portal');

    // Remove keeps the document on the engagement — link it back without a copy.
    view = (
      await request(http)
        .post(`${evidenceUrl()}/${added.id}/unlink`)
        .set(bearer(pa))
        .send({})
        .expect(201)
    ).body;
    expect(view.files).toHaveLength(0);
    view = (
      await request(http)
        .post(`${evidenceUrl()}/link`)
        .set(bearer(pa))
        .send({ documentId: added.documentId })
        .expect(201)
    ).body;
    expect(view.files.map((f) => f.documentId)).toEqual([added.documentId]);

    // A document from another engagement cannot be linked.
    await request(http)
      .post(`${evidenceUrl()}/link`)
      .set(bearer(pa))
      .send({ documentId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);

    // An outsider sees nothing (RLS) and cannot change it.
    await request(http).get(evidenceUrl()).set(bearer(pb)).expect(404);
    await request(http)
      .post(`${evidenceUrl()}/add`)
      .set(bearer(pb))
      .send({ filename: 'x.pdf', contentBase64: bytes.toString('base64') })
      .expect(404);
  });

  // ── §18: technical memo from the DHVAJ Word template ────────────────────

  it('creates the technical memo from the approved template with the 02.2 facts merged in', async () => {
    const http = app.getHttpServer();
    // No approved template yet → the panel says what an administrator must do.
    let view = (await request(http).get(evidenceUrl()).set(bearer(pa)).expect(200))
      .body as FrameworkEvidenceView;
    expect(view.memo).toMatchObject({ templateAvailable: false, memoFileId: null });
    expect(view.memo!.reason).toMatch(/administrator must upload and approve/);
    await request(http).post(memoUrl()).set(bearer(pa)).send({}).expect(400);

    // The firm uploads and approves its memo template.
    const templates = (
      await request(http).get('/api/v1/document-templates').set(bearer(mp)).expect(200)
    ).body as DocumentTemplateRecord[];
    const standard = templates.find(
      (t) => t.templateKey === 'financial_reporting_framework_memo' && t.variantKey === 'standard',
    )!;
    expect(standard).toBeDefined();
    const bytes = await tinyDocx([
      'Financial Reporting Framework memo — {{client.name}} FY {{engagement.financialYear}}',
      'Framework: {{frf.framework}} · Rule: {{frf.ruleApplied}} · Overridden: {{frf.overridden}}',
    ]);
    const uploaded = (
      await request(http)
        .post(`/api/v1/document-templates/${standard.id}/versions`)
        .set(bearer(mp))
        .send({ filename: 'FRF memo v1.docx', contentBase64: bytes.toString('base64') })
        .expect(201)
    ).body as DocumentTemplateRecord;
    expect(uploaded.versions[0]!.unknownFields).toEqual([]);
    await request(http)
      .post(
        `/api/v1/document-templates/${standard.id}/versions/${uploaded.versions[0]!.id}/approve`,
      )
      .set(bearer(mp))
      .expect(201);

    // Section 01's template list stays its own.
    const s01 = (
      await request(http)
        .get(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/acceptance/files`)
        .set(bearer(pa))
        .expect(200)
    ).body as { templates: Array<{ templateKey: string }> };
    expect(s01.templates.map((t) => t.templateKey)).not.toContain(
      'financial_reporting_framework_memo',
    );

    const created = (await request(http).post(memoUrl()).set(bearer(pa)).send({}).expect(201))
      .body as FrameworkMemoCreated;
    expect(created.editorUrl).toBeNull(); // Microsoft 365 is off in e2e — opens in the portal.
    const memo = created.evidence.files.find((f) => f.id === created.fileId)!;
    expect(memo).toMatchObject({ kind: 'technical_memo', templateVersionNo: 1 });
    expect(memo.filename).toMatch(/^Financial Reporting Framework Memo - .*\.docx$/);
    expect(created.evidence.memo!.memoFileId).toBe(created.fileId);

    const download = await request(http)
      .get(`/api/v1/engagements/${engId}/documents/${created.documentId}/download`)
      .set(bearer(pa))
      .buffer(true)
      .parse(binary)
      .expect(200);
    const xml = await (
      await JSZip.loadAsync(download.body as Buffer)
    )
      .file('word/document.xml')!
      .async('string');
    expect(xml).toContain('FY 2024-25');
    expect(xml).toContain('Overridden: No');
    expect(xml).not.toContain('{{client.name}}');
    expect(xml).not.toContain('{{frf.framework}}');

    // One live memo per 02.2.
    await request(http).post(memoUrl()).set(bearer(pa)).send({}).expect(409);
    view = (await request(http).get(evidenceUrl()).set(bearer(pa)).expect(200)).body;
    expect(view.files[0]!.kind).toBe('technical_memo'); // The memo lists first.
    // Only a lead creates it.
    await request(http).post(memoUrl()).set(bearer(pb)).send({}).expect(404);
  });

  // ── §5 / §19: downstream impact ────────────────────────────────────────

  it('previews what the 02.2 conclusion activates, pending until Section 02 is approved', async () => {
    const http = app.getHttpServer();
    const v = (
      await request(http)
        .get(
          `/api/v1/engagements/${engId}/statutory-audit/${shellId}/financial-reporting/downstream`,
        )
        .set(bearer(pa))
        .expect(200)
    ).body as FinancialReportingDownstreamView;
    expect(v.approved).toBe(false);
    for (const item of v.items) expect(item.status).toBe('pending');
    if (v.framework === 'ind_as') expect(v.scheduleIiiDivision).toMatch(/^(II|III)$/);
    if (v.framework === 'accounting_standards') {
      expect(v.scheduleIiiDivision).toBe('I');
      expect(v.items.map((i) => i.key)).toContain('as_review');
    }
    await request(http)
      .get(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/financial-reporting/downstream`)
      .set(bearer(pb))
      .expect(404);
  });

  it('Section 02 approval (AF-02) activates first-time Ind AS work and generation picks it up', async () => {
    const http = app.getHttpServer();
    // A fresh FY 2024-25 file whose 02.2 concludes Ind AS (net worth ₹600 crore)
    // with first-time adoption.
    const entityId = await findId('/api/v1/entities?search=Acme&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = (
      await request(http)
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId: primaryServiceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    await request(http)
      .post(`/api/v1/engagements/${eng}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);
    const wf = (
      await request(http)
        .get(`/api/v1/engagements/${eng}/statutory-audit`)
        .set(bearer(pa))
        .expect(200)
    ).body[0].workflowInstanceId as string;
    const fr = `/api/v1/engagements/${eng}/statutory-audit/${wf}/financial-reporting`;
    await request(http)
      .post(`/api/v1/engagements/${eng}/statutory-audit/${wf}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'net_worth', currentValue: 6000000000 })
      .expect(201);
    let cur = (await request(http).post(`${fr}/run-suggestions`).set(bearer(pa)).expect(201))
      .body as StatutoryAuditFinancialReporting;
    cur = (
      await request(http)
        .post(`${fr}/facts`)
        .set(bearer(pa))
        .send({
          firstTimeAdoption: true,
          firstTimeAdoptionReason: 'First Ind AS financial statements (e2e).',
          version: cur.assessment.version,
        })
        .expect(201)
    ).body as StatutoryAuditFinancialReporting;
    expect(cur.assessment.systemOutcome).toBe('ind_as');
    await request(http)
      .post(`${fr}/decision`)
      .set(bearer(pa))
      .send({ conclusion: 'ind_as', version: cur.assessment.version })
      .expect(201);

    const downstream = `${fr}/downstream`;
    const before = (await request(http).get(downstream).set(bearer(pa)).expect(200))
      .body as FinancialReportingDownstreamView;
    expect(before.approved).toBe(false);
    expect(before.scheduleIiiDivision).toBe('II');
    expect(before.items.map((i) => [i.key, i.status])).toEqual([
      ['ind_as_review', 'pending'],
      ['ind_as_101_transition', 'pending'],
    ]);

    // AF-01 (the Manager confirmation over all six sub-sections) is exercised in
    // its own suite; here the baseline is placed Manager-confirmed and AF-02 runs
    // for real. The legacy memo approval is what gates work generation.
    const su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    try {
      await su.query(
        `INSERT INTO hsdg.audit_framework_baseline
           (workflow_instance_id, engagement_id, version, status, manager_confirmed_at, record_version)
         VALUES ($1, $2, '1.0', 'manager_confirmed', now(), 1)`,
        [wf, eng],
      );
      await su.query(
        `INSERT INTO hsdg.audit_framework_approvals (workflow_instance_id, engagement_id, version, snapshot)
         VALUES ($1, $2, 1, '[]'::jsonb)`,
        [wf, eng],
      );
    } finally {
      await su.end();
    }
    await request(http)
      .post(`/api/v1/engagements/${eng}/statutory-audit/${wf}/framework-summary/approve`)
      .set(bearer(pa))
      .send({ recordVersion: 1 })
      .expect(201);

    const after = (await request(http).get(downstream).set(bearer(pa)).expect(200))
      .body as FinancialReportingDownstreamView;
    expect(after.approved).toBe(true);
    expect(after.items.map((i) => [i.key, i.status])).toEqual([
      ['ind_as_review', 'activated'],
      ['ind_as_101_transition', 'activated'],
    ]);
    for (const i of after.items) expect(i.activatedAt).toBeTruthy();

    const gen = (
      await request(http)
        .post(`/api/v1/engagements/${eng}/statutory-audit/${wf}/work-areas/generate`)
        .set(bearer(pa))
        .expect(201)
    ).body as StatutoryAuditWorkGeneration;
    const keysGenerated = gen.areas.map((a) => a.workAreaKey);
    expect(keysGenerated).toContain('ind_as_review');
    expect(keysGenerated).toContain('ind_as_first_time_adoption');
    expect(keysGenerated).not.toContain('schedule_iii_work');
  });

  // ── §6–§7 per-question evidence; §10 net worth "Open Source" ────────────

  it('files evidence under FRF-02 / FRF-03 and opens the net-worth source statements', async () => {
    const http = app.getHttpServer();
    const bytes = Buffer.from('Ind AS financial statements FY 2023-24 (e2e)', 'utf8');
    const v1 = (
      await request(http)
        .post(`${evidenceUrl()}/add`)
        .set(bearer(pa))
        .send({
          filename: 'Ind AS FS 2023-24.pdf',
          contentType: 'application/pdf',
          contentBase64: bytes.toString('base64'),
          questionKey: 'frf_02',
        })
        .expect(201)
    ).body as FrameworkEvidenceView;
    const fs = v1.files.find((f) => f.filename === 'Ind AS FS 2023-24.pdf')!;
    expect(fs.questionKey).toBe('frf_02');

    // The same statements may also support FRF-03 and the assessment as a whole …
    const v2 = (
      await request(http)
        .post(`${evidenceUrl()}/link`)
        .set(bearer(pa))
        .send({ documentId: fs.documentId, questionKey: 'frf_03' })
        .expect(201)
    ).body as FrameworkEvidenceView;
    expect(
      v2.files
        .filter((f) => f.documentId === fs.documentId)
        .map((f) => f.questionKey)
        .sort(),
    ).toEqual(['frf_02', 'frf_03']);
    // … but not twice under one question, and only under known questions.
    await request(http)
      .post(`${evidenceUrl()}/link`)
      .set(bearer(pa))
      .send({ documentId: fs.documentId, questionKey: 'frf_02' })
      .expect(409);
    await request(http)
      .post(`${evidenceUrl()}/link`)
      .set(bearer(pa))
      .send({ documentId: fs.documentId, questionKey: 'frf_09' })
      .expect(400);
    // An 02.6 relationship key (spec §5) files only on 02.6.
    await request(http)
      .post(`${evidenceUrl()}/link`)
      .set(bearer(pa))
      .send({ documentId: fs.documentId, questionKey: 'rel_0123456789abcdef' })
      .expect(400);

    // §10: the 02.1 net-worth figure's statements become the 02.2E "Open Source".
    await request(http)
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'net_worth', priorValue: 3200000000, documentId: fs.documentId })
      .expect(201);
    const fr = (
      await request(http)
        .post(
          `/api/v1/engagements/${engId}/statutory-audit/${shellId}/financial-reporting/run-suggestions`,
        )
        .set(bearer(pa))
        .expect(201)
    ).body as StatutoryAuditFinancialReporting;
    expect(fr.detail?.netWorth?.value).toBe(3200000000);
    expect(fr.detail?.netWorth?.sourceDocumentId).toBe(fs.documentId);
  });
});

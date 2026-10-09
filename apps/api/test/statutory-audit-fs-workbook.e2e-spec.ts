import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type {
  AuthorityReference,
  DocumentTemplateRecord,
  FileVersionHistory,
  FrameworkEvidenceView,
  FrameworkMemoCreated,
  FsWorkbookCreated,
  FsWorkbookView,
  ScheduleIiiDetail,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { tinyDocx } from './section01-files.helper';

/**
 * 02.3 Schedule III — references, Financial Statements Workbook, technical memo
 * and per-question evidence (DHVAJ 02.3 spec §4, §16, §17, §18, §22;
 * acceptance tests 6, 10, 11, 12):
 *   • every 02.3 "View …" reference resolves through the central Provision
 *     Library for the engagement period (the rounding requirement by version);
 *   • the workbook is offered once 02.2 and 02.3 establish the framework; the
 *     template is chosen by framework + Division + entity type + financial
 *     year + template effective version and created in the engagement
 *     workspace with its version metadata; a later template version leaves it
 *     unchanged;
 *   • the 02.3 memo merges the `sch.*` facts; SCH-02 / SCH-04 evidence.
 *
 * The 02.3 engine is exercised by its own suite; here the concluded 02.3 row
 * (frozen framework version) is written directly so this suite does not depend
 * on the library data the engine reads.
 */
jest.setTimeout(30_000);

describe('Statutory Audit — 02.3 references, FS workbook, memo, evidence (e2e)', () => {
  let app: INestApplication;
  let mp: string; // Managing Partner — firm-wide admin (templates).
  let pa: string; // Partner A — the Engagement Partner / lead.
  let pb: string; // Partner B — not on the engagement.
  let engId: string;
  let shellId: string;
  let schSubId: string;
  let frfSubId: string;
  let entitySlug: string;
  const frameworkVersionId = randomUUID();

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
  const su = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };
  const tinyXlsx = async (cells: string[]): Promise<Buffer> => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/workbook.xml', '<workbook/>');
    zip.file(
      'xl/sharedStrings.xml',
      `<sst count="${cells.length}">${cells.map((c) => `<si><t>${c}</t></si>`).join('')}</sst>`,
    );
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData/></worksheet>');
    return zip.generateAsync({ type: 'nodebuffer' });
  };
  const templateOf = async (key: string, variant = 'standard') =>
    (
      (
        await request(app.getHttpServer())
          .get('/api/v1/document-templates')
          .set(bearer(mp))
          .expect(200)
      ).body as DocumentTemplateRecord[]
    ).find((t) => t.templateKey === key && t.variantKey === variant)!;
  const uploadAndApprove = async (templateId: string, filename: string, bytes: Buffer) => {
    const http = app.getHttpServer();
    const rec = (
      await request(http)
        .post(`/api/v1/document-templates/${templateId}/versions`)
        .set(bearer(mp))
        .send({ filename, contentBase64: bytes.toString('base64') })
        .expect(201)
    ).body as DocumentTemplateRecord;
    const draft = rec.versions[0]!;
    await request(http)
      .post(`/api/v1/document-templates/${templateId}/versions/${draft.id}/approve`)
      .set(bearer(mp))
      .expect(201);
    return draft;
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
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    shellId = (await request(http).get(base).set(bearer(pa)).expect(200)).body[0]
      .workflowInstanceId as string;
    // Opening 02.2 and 02.3 seeds their sub-assessments.
    frfSubId = (await request(http).get(`${base}/financial-reporting`).set(bearer(pa)).expect(200))
      .body[0].assessment.id as string;
    schSubId = (await request(http).get(`${base}/schedule-iii`).set(bearer(pa)).expect(200)).body[0]
      .assessment.id as string;
    entitySlug = await su(async (c) => {
      const { rows } = await c.query<{ slug: string }>(
        `SELECT et.slug FROM hsdg.entities e JOIN hsdg.entity_types et ON et.id = e.entity_type_id
          WHERE e.id = $1`,
        [entityId],
      );
      return rows[0]!.slug;
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const workbookUrl = () =>
    `/api/v1/engagements/${engId}/statutory-audit/${shellId}/schedule-iii/workbook`;
  const evidenceUrl = (sub: string) =>
    `/api/v1/engagements/${engId}/statutory-audit/${shellId}/framework/${sub}/evidence`;

  /** Conclude 02.2 (Ind AS) and 02.3 (Division II) with a frozen framework version. */
  const conclude = async (): Promise<void> => {
    const detail: Partial<ScheduleIiiDetail> = {
      division: 'division_ii',
      divisionProvisionCode: 'SCH_III_DIV_II',
      cashFlowRequired: true,
      cashFlowExemptionReason: null,
      cashFlowProvisionId: null,
      requiredComponents: [],
      roundingThreshold: 1000000000,
      roundingUnits: ['lakhs', 'millions', 'crores'],
      disclosures: [],
      frameworkVersion: {
        id: frameworkVersionId,
        frameworkId: 'SCHEDULE_III_DIVISION_II',
        division: 'II',
        title: 'Schedule III Division II',
        versionLabel: 'As amended by G.S.R. 207(E), 24 March 2021',
        effectiveFrom: '2021-04-01',
        effectiveTo: null,
        notificationReference: 'G.S.R. 207(E)',
        provisionCode: 'SCH_III_DIV_II',
        provisionId: null,
        guidanceProvisionCode: 'ICAI_GN_SCH_III_DIV_II',
        guidanceProvisionId: null,
        guidanceVersion: 'Revised January 2022',
        templateKey: 'fs_workbook_indas_div_ii',
        status: 'active',
      },
      componentLines: [
        { key: 'balance_sheet', label: 'Balance Sheet', required: true, basis: 'Division II' },
        {
          key: 'statement_of_profit_and_loss',
          label: 'Statement of Profit and Loss',
          required: true,
          basis: 'Division II',
          includesOci: true,
        },
      ],
    };
    await su(async (c) => {
      await c.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET conclusion = 'ind_as', decided_at = now()
          WHERE id = $1`,
        [frfSubId],
      );
      await c.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET conclusion = 'division_ii', system_outcome = 'division_ii',
                state = 'applicable', decided_at = now(), professional_action = 'confirm',
                system_detail = $2::jsonb
          WHERE id = $1`,
        [schSubId, JSON.stringify(detail)],
      );
    });
  };

  // ── §4, §22 / acceptance test 12: references through the Provision Library ─

  it('resolves every 02.3 reference period-correct through the library', async () => {
    const http = app.getHttpServer();
    const refsOn = async (on: string) =>
      new Map(
        (
          (
            await request(http)
              .get(`/api/v1/authority-provisions/references/02.3?on=${on}`)
              .set(bearer(pa))
              .expect(200)
          ).body as AuthorityReference[]
        ).map((r) => [r.anchor, r]),
      );
    const fy2024 = await refsOn('2024-04-01');
    expect([...fy2024.keys()]).toEqual([
      'section_129',
      'schedule_iii_div_i',
      'schedule_iii_div_ii',
      'schedule_iii_div_iii',
      'icai_gn_div_i',
      'icai_gn_div_ii',
      'icai_gn_div_iii',
      'section_2_40',
      'rounding',
    ]);
    expect(fy2024.get('section_129')!.label).toBe('View Section 129');
    for (const r of fy2024.values()) {
      expect(r.provision).not.toBeNull();
      expect(r.provision!.sourceUrl).toMatch(
        /^https:\/\/(www\.indiacode\.nic\.in|publication\.icai\.org)\//,
      );
      expect(r.provision!.summary).toBeTruthy();
    }
    expect(fy2024.get('icai_gn_div_ii')!.provision!.authority).toBe('ICAI');
    // The rounding requirement resolves by version: total income from 2021, turnover before.
    expect(fy2024.get('rounding')!.provision!).toMatchObject({ versionNo: 2 });
    expect(fy2024.get('rounding')!.provision!.summary).toMatch(/total income/);
    const fy2019 = await refsOn('2019-04-01');
    expect(fy2019.get('rounding')!.provision!).toMatchObject({ versionNo: 1 });
    expect(fy2019.get('rounding')!.provision!.summary).toMatch(/turnover/);
    // Division III did not exist before 11 October 2018.
    expect((await refsOn('2017-04-01')).get('schedule_iii_div_iii')!.provision).toBeNull();
  });

  // ── §16 / acceptance tests 10, 11: Create Financial Statements Workbook ──

  it('is offered only once 02.2 and 02.3 establish the framework', async () => {
    const http = app.getHttpServer();
    const view = (await request(http).get(workbookUrl()).set(bearer(pa)).expect(200))
      .body as FsWorkbookView;
    expect(view).toMatchObject({ available: false, workbook: null, selection: null });
    expect(view.reason).toMatch(/Conclude 02\.2/);
    await request(http).post(workbookUrl()).set(bearer(pa)).send({}).expect(400);
    // Outsiders see nothing.
    await request(http).get(workbookUrl()).set(bearer(pb)).expect(404);
  });

  it('selects the template by framework, Division, entity type and period, and creates it', async () => {
    const http = app.getHttpServer();
    await conclude();

    // Framework established, but the firm has no approved workbook template yet.
    let view = (await request(http).get(workbookUrl()).set(bearer(pa)).expect(200))
      .body as FsWorkbookView;
    expect(view.available).toBe(false);
    expect(view.reason).toMatch(/administrator must upload and approve/);
    expect(view.selection).toMatchObject({
      templateKey: 'fs_workbook_indas_div_ii',
      frameworkVersionId,
      frameworkId: 'SCHEDULE_III_DIVISION_II',
      division: 'II',
      financialYear: '2024-25',
      periodStart: '2024-04-01',
      entityTypeSlug: entitySlug,
      templateId: null,
    });

    // A workbook template is Excel: a Word upload is refused.
    const standard = await templateOf('fs_workbook_indas_div_ii');
    await request(http)
      .post(`/api/v1/document-templates/${standard.id}/versions`)
      .set(bearer(mp))
      .send({
        filename: 'FS workbook.docx',
        contentBase64: (await tinyDocx(['x'])).toString('base64'),
      })
      .expect(400);
    await uploadAndApprove(
      standard.id,
      'FS workbook standard.xlsx',
      await tinyXlsx(['STANDARD {{client.name}}']),
    );

    // An entity-type variant beats the standard one; a variant dated for later
    // periods (the next template effective version) does not apply to FY 2024-25.
    const variant = async (variantKey: string, appliesWhen: object) =>
      (
        (
          await request(http)
            .post('/api/v1/document-templates')
            .set(bearer(mp))
            .send({ templateKey: 'fs_workbook_indas_div_ii', variantKey, appliesWhen })
            .expect(201)
        ).body as DocumentTemplateRecord
      ).id;
    const entityVariantId = await variant('e2e_entity', { entityTypeSlugs: [entitySlug] });
    const futureVariantId = await variant('e2e_fy2025', {
      entityTypeSlugs: [entitySlug],
      periodFrom: '2025-04-01',
    });
    await uploadAndApprove(
      entityVariantId,
      'FS workbook entity.xlsx',
      await tinyXlsx([
        'Financial statements of {{client.name}}',
        'FY {{engagement.financialYear}}',
        'Framework: {{sch.presentationFramework}} · {{sch.frameworkVersion}}',
        'Components: {{sch.components}}',
      ]),
    );
    await uploadAndApprove(futureVariantId, 'FS workbook 2025.xlsx', await tinyXlsx(['FUTURE']));
    await request(http)
      .post('/api/v1/document-templates')
      .set(bearer(mp))
      .send({
        templateKey: 'fs_workbook_indas_div_ii',
        variantKey: 'e2e_bad_period',
        appliesWhen: { periodFrom: '1 April 2025' },
      })
      .expect(400);

    view = (await request(http).get(workbookUrl()).set(bearer(pa)).expect(200)).body;
    expect(view.available).toBe(true);
    expect(view.selection).toMatchObject({
      templateVariantKey: 'e2e_entity',
      templateVersionNo: 1,
    });

    // A source fact changed after the conclusion: re-evaluate before creating.
    const flag = (on: boolean) =>
      su((c) =>
        c.query(
          `UPDATE hsdg.audit_framework_subassessment SET needs_reevaluation = $2 WHERE id = $1`,
          [schSubId, on],
        ),
      );
    await flag(true);
    view = (await request(http).get(workbookUrl()).set(bearer(pa)).expect(200)).body;
    expect(view.available).toBe(false);
    expect(view.reason).toMatch(/re-evaluate/);
    await request(http).post(workbookUrl()).set(bearer(pa)).send({}).expect(400);
    await flag(false);

    // Only a lead creates it.
    await request(http).post(workbookUrl()).set(bearer(pb)).send({}).expect(404);
    const created = (await request(http).post(workbookUrl()).set(bearer(pa)).send({}).expect(201))
      .body as FsWorkbookCreated;
    expect(created.editorUrl).toBeNull(); // Microsoft 365 is off in e2e.
    const wb = created.view.workbook!;
    expect(wb).toMatchObject({
      documentId: created.documentId,
      templateKey: 'fs_workbook_indas_div_ii',
      templateId: entityVariantId,
      templateVariantKey: 'e2e_entity',
      templateVersionNo: 1,
      frameworkVersionId,
      frameworkId: 'SCHEDULE_III_DIVISION_II',
      division: 'II',
      financialYear: '2024-25',
      entityTypeSlug: entitySlug,
      createdByName: expect.any(String),
    });
    expect(wb.filename).toMatch(/^Financial Statements Workbook FY 2024-25 - .*\.xlsx$/);
    expect(created.view.available).toBe(false);
    expect(created.view.reason).toBeNull();

    // The workbook holds the merged engagement and 02.3 facts.
    const download = await request(http)
      .get(`/api/v1/engagements/${engId}/documents/${created.documentId}/download`)
      .set(bearer(pa))
      .buffer(true)
      .parse(binary)
      .expect(200);
    const ss = await (
      await JSZip.loadAsync(download.body as Buffer)
    )
      .file('xl/sharedStrings.xml')!
      .async('string');
    expect(ss).toContain('FY 2024-25');
    expect(ss).toContain(
      'Framework: Schedule III Division II · Schedule III Division II — As amended',
    );
    expect(ss).toContain('Statement of Profit and Loss (with OCI)');
    expect(ss).not.toContain('{{client.name}}');

    // No silent replacement; version history from the file card.
    await request(http).post(workbookUrl()).set(bearer(pa)).send({}).expect(409);
    const history = (
      await request(http).get(`${workbookUrl()}/versions`).set(bearer(pa)).expect(200)
    ).body as FileVersionHistory;
    expect(history).toMatchObject({ source: 'portal' });
    expect(history.entries.length).toBeGreaterThanOrEqual(1);

    // A later template version does not change the historical workbook record.
    await uploadAndApprove(entityVariantId, 'FS workbook entity v2.xlsx', await tinyXlsx(['V2']));
    view = (await request(http).get(workbookUrl()).set(bearer(pa)).expect(200)).body;
    expect(view.workbook).toMatchObject({ templateVersionNo: 1, frameworkVersionId });

    const audited = await su(async (c) => {
      const { rows } = await c.query<{ after_state: Record<string, unknown> }>(
        `SELECT after_state FROM hsdg.audit_events
          WHERE action = 'statutory_audit.fs_workbook_created' AND object_id = $1`,
        [wb.id],
      );
      return rows;
    });
    expect(audited).toHaveLength(1);
    expect(audited[0]!.after_state).toMatchObject({
      templateVersionNo: 1,
      frameworkVersionId,
      financialYear: '2024-25',
    });
  });

  // ── §17: the 02.3 technical memo ──────────────────────────────────────────

  it('creates the 02.3 technical memo with the sch.* facts merged in', async () => {
    const http = app.getHttpServer();
    const memoUrl = `/api/v1/engagements/${engId}/statutory-audit/${shellId}/schedule-iii/memo`;
    let view = (await request(http).get(evidenceUrl(schSubId)).set(bearer(pa)).expect(200))
      .body as FrameworkEvidenceView;
    expect(view.memo).toMatchObject({ templateAvailable: false, memoFileId: null });
    expect(view.memo!.reason).toMatch(/Schedule III Presentation Framework memo/);
    await request(http).post(memoUrl).set(bearer(pa)).send({}).expect(400);

    const standard = await templateOf('schedule_iii_presentation_memo');
    await uploadAndApprove(
      standard.id,
      'Schedule III memo.docx',
      await tinyDocx([
        'Schedule III memo — {{client.name}}',
        'Conclusion: {{sch.professionalConclusion}} · Version: {{sch.guidanceVersion}} · Overridden: {{sch.overridden}}',
      ]),
    );
    const created = (await request(http).post(memoUrl).set(bearer(pa)).send({}).expect(201))
      .body as FrameworkMemoCreated;
    const memo = created.evidence.files.find((f) => f.id === created.fileId)!;
    expect(memo).toMatchObject({ kind: 'technical_memo', templateVersionNo: 1 });
    expect(memo.filename).toMatch(/^Schedule III Presentation Framework Memo - .*\.docx$/);
    expect(created.evidence.subAssessmentId).toBe(schSubId);
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
    expect(xml).toContain(
      'Conclusion: Schedule III Division II · Version: Revised January 2022 · Overridden: No',
    );
    await request(http).post(memoUrl).set(bearer(pa)).send({}).expect(409);
    view = (await request(http).get(evidenceUrl(schSubId)).set(bearer(pa)).expect(200)).body;
    expect(view.memo!.memoFileId).toBe(created.fileId);
    // The 02.2 memo is untouched by the 02.3 one.
    const frf = (await request(http).get(evidenceUrl(frfSubId)).set(bearer(pa)).expect(200))
      .body as FrameworkEvidenceView;
    expect(frf.memo!.memoFileId).toBeNull();
  });

  // ── §7, §13: SCH-02 / SCH-04 evidence ────────────────────────────────────

  it('files evidence under SCH-02 and SCH-04, and only on 02.3', async () => {
    const http = app.getHttpServer();
    const added = (
      await request(http)
        .post(`${evidenceUrl(schSubId)}/add`)
        .set(bearer(pa))
        .send({
          filename: 'Prior year financial statements.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('%PDF-1.4 prior year').toString('base64'),
          questionKey: 'sch_04',
        })
        .expect(201)
    ).body as FrameworkEvidenceView;
    const prior = added.files.find((f) => f.questionKey === 'sch_04')!;
    expect(prior.title).toBe('Prior year financial statements');
    const linked = (
      await request(http)
        .post(`${evidenceUrl(schSubId)}/link`)
        .set(bearer(pa))
        .send({ documentId: prior.documentId, questionKey: 'sch_02' })
        .expect(201)
    ).body as FrameworkEvidenceView;
    expect(linked.files.filter((f) => f.documentId === prior.documentId)).toHaveLength(2);
    await request(http)
      .post(`${evidenceUrl(schSubId)}/link`)
      .set(bearer(pa))
      .send({ documentId: prior.documentId, questionKey: 'sch_04' })
      .expect(409);
    // A question belongs to its own sub-assessment.
    await request(http)
      .post(`${evidenceUrl(schSubId)}/link`)
      .set(bearer(pa))
      .send({ documentId: prior.documentId, questionKey: 'frf_02' })
      .expect(400);
    await request(http)
      .post(`${evidenceUrl(frfSubId)}/link`)
      .set(bearer(pa))
      .send({ documentId: prior.documentId, questionKey: 'sch_04' })
      .expect(400);
  });
});

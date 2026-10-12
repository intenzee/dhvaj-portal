import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  AuditCompletionItem,
  DocumentTemplateRecord,
  FileVersionHistory,
  FrameworkImpactView,
  FrameworkMemoCard,
  FrameworkMemoHistoryItem,
  FrameworkMemorandumCreated,
  FrameworkSummaryMatter,
  FrameworkSystemOverride,
  StatutoryAuditCompletion,
  StatutoryAuditFrameworkSummary,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { tinyDocx } from './section01-files.helper';

/**
 * 02.8 Track B records — end to end through the HTTP API (spec v1.0 §5–§8,
 * §10–§11, §14–§17):
 *   • the triggered requirements / downstream preview / matters are derived
 *     from 02.1–02.7; matter impact, Partner Attention and Return to source;
 *   • the Audit Framework Memorandum is created from the approved DHVAJ
 *     template only after AF-01, once per baseline, submitted for AF-02 and
 *     controlled (file locked) when the Engagement Partner approves;
 *   • the controlled reopen supersedes the memo, computes the change impact
 *     against the approved baseline, needs a professional confirmation (voided
 *     by a later change) before AF-01, notifies, and is surfaced in Section 07
 *     until the revision — with its NEW memorandum — is re-approved.
 *
 * 02.1–02.7 are decided directly (superuser); their own suites test them.
 */
jest.setTimeout(60_000);

describe('Statutory Audit — 02.8 Track B records (e2e)', () => {
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

  let mp: string; // firm-wide lead
  let pa: string; // the Engagement Partner
  let pb: string; // outsider
  let engId: string;
  let shellId: string;
  const base = () => `/api/v1/engagements/${engId}/statutory-audit`;
  const fs = () => `${base()}/${shellId}/framework-summary`;
  const get = (t: string, path: string) => request(app.getHttpServer()).get(path).set(bearer(t));
  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set(bearer(t)).send(body);
  const findId = async (path: string): Promise<string> =>
    (await get(mp, path).expect(200)).body.items[0].id as string;
  const summary = async (t: string = pa): Promise<StatutoryAuditFrameworkSummary> =>
    (await get(t, `${base()}/framework-summary`).expect(200)).body[0];

  const su = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  /** 02.1 confirmed, 02.2–02.7 and the other areas decided, seeded matters resolved. */
  const decideSection02 = () =>
    su(async (c) => {
      await c.query(
        `UPDATE hsdg.audit_entity_profile SET state = 'confirmed', confirmed_at = now(),
                needs_reevaluation = false
          WHERE workflow_instance_id = $1`,
        [shellId],
      );
      await c.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET state = CASE WHEN sub_section_key = '02.2' THEN 'approved'
                             ELSE 'not_applicable' END,
                conclusion = COALESCE(conclusion, system_outcome, 'not_applicable'),
                needs_reevaluation = false, decided_at = now()
          WHERE workflow_instance_id = $1`,
        [shellId],
      );
      await c.query(
        `UPDATE hsdg.audit_framework_assessments
            SET state = 'not_applicable', conclusion = 'not_applicable', decided_at = now()
          WHERE workflow_instance_id = $1`,
        [shellId],
      );
      await c.query(
        `UPDATE hsdg.audit_matter SET status = 'resolved', resolution = 'e2e'
          WHERE workflow_instance_id = $1 AND status <> 'resolved'`,
        [shellId],
      );
    });

  const af01 = async (): Promise<StatutoryAuditFrameworkSummary> => {
    const s = await summary();
    return (
      await post(pa, `${fs()}/confirm`, {
        decision: 'submit_for_partner_approval',
        previewReviewed: true,
        recordVersion: s.recordVersion,
      }).expect(201)
    ).body;
  };
  const af02 = async (): Promise<StatutoryAuditFrameworkSummary> => {
    const s = await summary();
    return (
      await post(pa, `${fs()}/approve`, {
        decision: 'approve',
        recordVersion: s.recordVersion,
      }).expect(201)
    ).body;
  };
  const memoLocked = (documentId: string) =>
    su(
      async (c) =>
        (
          await c.query<{ edit_locked: boolean }>(
            `SELECT edit_locked FROM hsdg.documents WHERE id = $1`,
            [documentId],
          )
        ).rows[0]!.edit_locked,
    );
  const caroOf = () =>
    su(
      async (c) =>
        (
          await c.query<{ conclusion: string | null }>(
            `SELECT conclusion FROM hsdg.audit_framework_subassessment
            WHERE workflow_instance_id = $1 AND sub_section_key = '02.4' AND area_key = 'caro'`,
            [shellId],
          )
        ).rows[0]?.conclusion ?? null,
    );
  const setSub = (sub: string, area: string, conclusion: string) =>
    su((c) =>
      c.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET conclusion = $3, state = 'applicable', needs_reevaluation = false, decided_at = now()
          WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $4`,
        [shellId, sub, conclusion, area],
      ),
    );

  let matterId: string;
  let firstMemo: FrameworkMemorandumCreated;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    engId = (
      await post(pa, '/api/v1/engagements', {
        entityId,
        serviceId: statAuditId,
        financialYear: '2024-25',
        periodLabel: uniquePeriod(),
        status: 'accepted',
      }).expect(201)
    ).body.id;
    shellId = (await get(pa, base()).expect(200)).body[0].workflowInstanceId;
    await su((c) =>
      c.query(
        `UPDATE hsdg.engagements SET engagement_partner_id =
           (SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id
             WHERE u.email = 'partner.a@dhvaj.in')
          WHERE id = $1`,
        [engId],
      ),
    );
    await summary(); // seeds 02.1–02.7

    // The firm's DHVAJ Audit Framework Memorandum template (uploaded + approved).
    const templates = (await get(mp, '/api/v1/document-templates').expect(200))
      .body as DocumentTemplateRecord[];
    const standard = templates.find(
      (t) => t.templateKey === 'audit_framework_memorandum' && t.variantKey === 'standard',
    )!;
    expect(standard).toBeDefined();
    const bytes = await tinyDocx([
      'Audit Framework Memorandum v{{afm.baselineVersion}} — {{client.name}}',
      '{{afm.s03ReportingFramework}}',
      '{{afm.numericTests}}',
      '{{afm.s10TriggeredConsiderations}}',
    ]);
    const uploaded = (
      await post(mp, `/api/v1/document-templates/${standard.id}/versions`, {
        filename: 'AFM v1.docx',
        contentBase64: bytes.toString('base64'),
      }).expect(201)
    ).body as DocumentTemplateRecord;
    expect(uploaded.versions[0]!.unknownFields).toEqual([]);
    await post(
      mp,
      `/api/v1/document-templates/${standard.id}/versions/${uploaded.versions[0]!.id}/approve`,
    ).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('derives the §6 preview from 02.1–02.7 (12 items, 02.6 dashboard keys)', async () => {
    const s = await summary();
    expect(s.downstreamPreview.map((p) => p.key)).toEqual(
      expect.arrayContaining(['fs_review', 'component_auditor_work', 'branch_auditor_work']),
    );
    expect(s.downstreamPreview).toHaveLength(12);
    expect(Array.isArray(s.triggeredRequirements)).toBe(true);
    expect(s.priorYear.available).toBe(false);
    expect(s.priorYear.reason).toBeTruthy();
  });

  it('records impact / Partner Attention on a matter and returns it to its source', async () => {
    await decideSection02();
    matterId = await su(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO hsdg.audit_matter
           (workflow_instance_id, engagement_id, seq, section, source, title, category, is_auto)
         SELECT $1, $2, COALESCE(MAX(seq), 0) + 1, 'framework', 'area:caro',
                'Clause (vii) statutory dues', 'technical_judgment', false
           FROM hsdg.audit_matter WHERE workflow_instance_id = $1
         RETURNING id`,
        [shellId, engId],
      );
      return rows[0]!.id;
    });
    let m = (
      await post(pa, `${fs()}/matters/${matterId}`, {
        partnerAttention: true,
        impact: 'CARO clause (vii) wording',
        dueDate: '2025-06-30',
      }).expect(201)
    ).body as FrameworkSummaryMatter;
    expect(m).toMatchObject({
      source: '02.4',
      partnerAttention: true,
      impact: 'CARO clause (vii) wording',
      dueDate: '2025-06-30',
      status: 'open',
    });
    await post(pa, `${fs()}/matters/${matterId}/return`, { note: '  ' }).expect(400);
    m = (
      await post(pa, `${fs()}/matters/${matterId}/return`, {
        note: 'Reconcile the dues listing',
      }).expect(201)
    ).body;
    expect(m.status).toBe('under_review');
    await post(pb, `${fs()}/matters/${matterId}`, { partnerAttention: false }).expect(404);
    await su((c) =>
      c.query(
        `UPDATE hsdg.audit_matter SET status = 'resolved', resolution = 'Done' WHERE id = $1`,
        [matterId],
      ),
    );
    await post(pa, `${fs()}/matters/${matterId}/return`, { note: 'again' }).expect(409);
  });

  it('creates the memorandum only after AF-01, once per baseline', async () => {
    await post(pa, `${fs()}/memo`).expect(400);
    const s = await af01();
    expect(s.gates.canCreateMemo).toBe(true);
    firstMemo = (await post(pa, `${fs()}/memo`).expect(201)).body;
    expect(firstMemo.memo).toMatchObject({ status: 'draft', baselineVersion: '1.0' });
    expect(firstMemo.memo.fileName).toMatch(/^Audit Framework Memorandum v1\.0 - .+\.docx$/);
    expect(firstMemo.editorUrl).toBeNull(); // Microsoft 365 off in e2e
    await post(pa, `${fs()}/memo`).expect(409);
    await post(pb, `${fs()}/memo`).expect(404);

    const after = await summary();
    expect(after.memo?.documentId).toBe(firstMemo.memo.documentId);
    expect(after.gates.canApprove).toBe(false); // not submitted yet
    const versions = (await get(pa, `${fs()}/memo/${firstMemo.memoId}/versions`).expect(200))
      .body as FileVersionHistory;
    expect(versions.entries.length).toBeGreaterThan(0);
  });

  it('Submit for Review enables AF-02; approval controls and locks the memo', async () => {
    const submitted = (await post(pa, `${fs()}/memo/${firstMemo.memoId}/submit`).expect(201))
      .body as FrameworkMemoCard;
    expect(submitted.status).toBe('submitted');
    await post(pa, `${fs()}/memo/${firstMemo.memoId}/submit`).expect(409);
    expect((await summary()).gates.canApprove).toBe(true);

    const s = await af02();
    expect(s.baseline?.status).toBe('approved');
    expect(s.memo).toMatchObject({ status: 'approved' });
    expect(await memoLocked(firstMemo.memo.documentId)).toBe(true);
    await post(pa, `${fs()}/memo`).expect(400); // approved → reopen to revise
  });

  it('reopen supersedes the memo, computes the impact and notifies', async () => {
    const before = await summary();
    const s = (
      await post(pa, `${fs()}/reopen`, {
        reason: 'CARO applicability re-examined',
        affectedSections: ['02.4'],
        identifiedAt: new Date().toISOString(),
        reapprovalRequired: true,
        recordVersion: before.recordVersion,
      }).expect(201)
    ).body as StatutoryAuditFrameworkSummary;
    expect(s.baseline).toMatchObject({ version: '1.1', status: 'draft' });
    expect(s.memo).toBeNull();
    expect(s.impact).toMatchObject({ baselineVersion: '1.1', comparedToVersion: '1.0' });

    const memos = (await get(pa, `${fs()}/memos`).expect(200)).body as FrameworkMemoHistoryItem[];
    expect(memos).toEqual([
      expect.objectContaining({ memoId: firstMemo.memoId, status: 'superseded' }),
    ]);
    const notified = await su(async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*) AS n FROM hsdg.notifications
              WHERE engagement_id = $1 AND type = 'framework_reopened'`,
            [engId],
          )
        ).rows[0]!.n,
      ),
    );
    expect(notified).toBeGreaterThan(0);
  });

  it('a changed conclusion becomes an impact item; AF-01 waits for its confirmation', async () => {
    const was = await caroOf();
    await setSub('02.4', 'caro', was === 'applicable' ? 'not_applicable_exempt' : 'applicable');
    let s = await summary();
    expect(s.impact!.items.map((i) => i.label).join(' ')).toMatch(/CARO/);
    expect(s.impact!.confirmedAt).toBeNull();
    expect(s.gates.impactConfirmed).toBe(false);
    expect(s.gates.canConfirm).toBe(false);

    // Section 07 carries the revision until it is re-approved.
    const completion = (await get(pa, `${base()}/completion`).expect(200))
      .body[0] as StatutoryAuditCompletion;
    const report = completion.items.find(
      (i: AuditCompletionItem) => i.itemKey === 'auditors_report',
    );
    expect(report).toBeDefined();
    expect(report!.evidence.facts[0]).toMatch(/Audit Framework reopened — revision v1\.1/);
    expect(report!.evidence.ready).toBe(false);

    await post(pb, `${fs()}/impact/confirm`, {}).expect(404);
    const confirmed = (
      await post(pa, `${fs()}/impact/confirm`, { note: 'Reviewed; CARO work re-planned' }).expect(
        201,
      )
    ).body as FrameworkImpactView;
    expect(confirmed.analysis?.confirmedAt).not.toBeNull();
    expect(confirmed.analysis?.confirmationNote).toBe('Reviewed; CARO work re-planned');
    s = await summary();
    expect(s.gates.impactConfirmed).toBe(true);

    // A later change in the facts voids the confirmation.
    await setSub('02.5', 'ifc', 'applicable');
    s = await summary();
    expect(s.impact!.items.some((i) => /ICFR|IFC/.test(i.label))).toBe(true);
    expect(s.impact!.confirmedAt).toBeNull();
    expect(s.gates.impactConfirmed).toBe(false);
    await post(pa, `${fs()}/impact/confirm`, {}).expect(201);
  });

  it('the revision gets a NEW memorandum; re-approval clears the Section 07 notice', async () => {
    let s = await summary();
    expect(s.gates.canConfirm).toBe(true);
    await af01();
    const second = (await post(pa, `${fs()}/memo`).expect(201)).body as FrameworkMemorandumCreated;
    expect(second.memo.baselineVersion).toBe('1.1');
    expect(second.memo.documentId).not.toBe(firstMemo.memo.documentId);
    await post(pa, `${fs()}/memo/${firstMemo.memoId}/submit`).expect(409); // superseded memo
    await post(pa, `${fs()}/memo/${second.memoId}/submit`).expect(201);
    s = await af02();
    expect(s.baseline).toMatchObject({ version: '1.1', status: 'approved' });

    const memos = (await get(pa, `${fs()}/memos`).expect(200)).body as FrameworkMemoHistoryItem[];
    expect(memos.map((m) => [m.baselineVersion, m.status])).toEqual([
      ['1.1', 'approved'],
      ['1.0', 'superseded'],
    ]);
    const completion = (await get(pa, `${base()}/completion`).expect(200))
      .body[0] as StatutoryAuditCompletion;
    for (const i of completion.items)
      expect(i.evidence.facts.join(' ')).not.toMatch(/Audit Framework reopened/);
  });

  it('§12 lists every system result a professional overrode, with the reason', async () => {
    expect((await get(pa, `${fs()}/overrides`).expect(200)).body).toEqual([]);
    await su(async (c) => {
      await c.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET system_outcome = 'ind_as', conclusion = 'accounting_standards', is_overridden = true,
                basis = 'Net worth measured on the standalone accounts', decided_at = now()
          WHERE workflow_instance_id = $1 AND sub_section_key = '02.2'`,
        [shellId],
      );
      await c.query(
        `UPDATE hsdg.audit_framework_assessments
            SET system_suggestion = 'applicable', conclusion = 'not_applicable',
                is_overridden = true, basis = 'Below the CSR thresholds'
          WHERE workflow_instance_id = $1 AND area_key = 'csr'`,
        [shellId],
      );
    });
    const overrides = (await get(pa, `${fs()}/overrides`).expect(200))
      .body as FrameworkSystemOverride[];
    expect(overrides).toEqual([
      expect.objectContaining({
        source: '02.2',
        systemResult: 'Ind AS',
        conclusion: 'Accounting Standards (AS)',
        reason: 'Net worth measured on the standalone accounts',
      }),
      expect.objectContaining({
        source: 'other_areas',
        systemResult: 'Applicable',
        conclusion: 'Not applicable',
        reason: 'Below the CSR thresholds',
      }),
    ]);
  });

  it('an outsider sees no memoranda, no impact and no overrides', async () => {
    await get(pb, `${fs()}/memos`).expect(404);
    await get(pb, `${fs()}/impact`).expect(404);
    await get(pb, `${fs()}/overrides`).expect(404);
  });
});

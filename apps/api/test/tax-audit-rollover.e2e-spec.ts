import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { TaxAuditAcceptance, TaxAuditRow, TaxAuditWorkspace } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * F-10 — the year rolls over. "When a year's audit is Filed, next year's row
 * is made at Not started. Last year's answers are copied in as drafts, and
 * the same team is proposed." Done when every audited client has its
 * next-year row, with last year's answers carried as drafts.
 */
describe('Tax audit year rollover (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: Record<string, string>;
  let partnerA: string;
  let eng: string;
  let auditId: string;
  let instanceId: string;
  let nextId: string;
  let libId: string;
  const FY = '2023-24';
  const NEXT = '2024-25';
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const audits = async () =>
    (await http().get(`/api/v1/engagements/${eng}/tax-audits`).set(pa).expect(200))
      .body as TaxAuditRow[];
  const acceptance = async (id: string) =>
    (await http().get(`/api/v1/engagements/${eng}/tax-audits/${id}/acceptance`).set(pa).expect(200))
      .body as TaxAuditAcceptance;
  const setFiled = (status: 'filed' | 'in_preparation') =>
    su.query(
      `UPDATE hsdg.compliance_instances
          SET workflow_status = $2,
              completed_at = CASE WHEN $2 = 'filed' THEN TIMESTAMPTZ '2024-09-20T10:00:00+05:30' END
        WHERE id = $1`,
      [instanceId, status],
    );

  /** A done working paper of the clause on the audit, on the first library. */
  const donePaper = (audit: string, no: string, answer: Record<string, string>) =>
    su.query(
      `WITH c AS (
             SELECT c.id, c.clause_no, c.default_package, c.default_grade
               FROM hsdg.tax_audit_clause_library c
              WHERE c.library_version_id = $3 AND c.clause_no = $4),
           p AS (
             INSERT INTO hsdg.tax_audit_clause_packages (tax_audit_id, engagement_id, package, grade)
             SELECT $1, $2, c.default_package, c.default_grade FROM c
             ON CONFLICT DO NOTHING RETURNING id, package)
           INSERT INTO hsdg.tax_audit_working_papers
             (tax_audit_id, engagement_id, package_id, library_clause_id, clause_no, status, answer, done_at)
           SELECT $1, $2,
                  COALESCE((SELECT id FROM p),
                           (SELECT k.id FROM hsdg.tax_audit_clause_packages k, c
                             WHERE k.tax_audit_id = $1 AND k.package = c.default_package)),
                  c.id, c.clause_no, 'done', $5::jsonb, now()
             FROM c`,
      [audit, eng, libId, no, JSON.stringify(answer)],
    );

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = await as('partner.a@dhvaj.in');

    const { rows: emp } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE employee_code = 'EMP003'`,
    );
    partnerA = emp[0]!.id;
    await su.query(
      `UPDATE hsdg.partner_profiles SET cop_no = 'COP-A', cop_valid_until = DATE '2099-03-31'
        WHERE employee_id = $1`,
      [partnerA],
    );

    const acme = await http().get('/api/v1/entities?search=Acme&limit=10').set(pa).expect(200);
    const entity = await freshClient(acme.body.items[0].id as string);
    await su.query(`UPDATE hsdg.entities SET annual_turnover = 25000000 WHERE id = $1`, [entity]);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: entity,
          status: 'accepted',
          financialYear: FY,
          streams: ['income_tax', 'tax_audit'],
          years: [{ financialYear: FY }],
        })
        .expect(201)
    ).body.id as string;
    const [a] = await audits();
    auditId = a!.id;
    instanceId = a!.instanceId!;

    // This year's audit: Form 3CA, signed by Partner A, on the first library,
    // with its business (10) and TDS (34) clauses done.
    const {
      rows: [lib],
    } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.tax_audit_clause_library_versions WHERE version_no = 1`,
    );
    await su.query(
      `UPDATE hsdg.tax_audits
          SET form_type = '3CA', signing_partner_id = $2, clause_library_version_id = $3,
              stage = 'clause_work'
        WHERE id = $1`,
      [auditId, partnerA, lib!.id],
    );
    libId = lib!.id;
    await donePaper(auditId, '10', { a: 'Trading in textiles\t09005', b: 'No change' });
    await donePaper(auditId, '34', {
      a: '26Q\t194C\t120000\t0',
      b: '26Q\tQ1\t2023-07-31\t2023-07-20\tYes',
    });
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('filing the report makes next year’s audit, Not started', async () => {
    expect((await audits()).map((r) => r.financialYear)).toEqual([FY]);

    await setFiled('filed');
    const rows = await audits();
    expect(rows.map((r) => [r.financialYear, r.stage])).toEqual([
      [NEXT, 'not_started'],
      [FY, 'filed'],
    ]);
    nextId = rows[0]!.id;
    const { rows: db } = await su.query<{ rolled_from_audit_id: string; revision: number }>(
      `SELECT rolled_from_audit_id, revision FROM hsdg.tax_audits WHERE id = $1`,
      [nextId],
    );
    expect(db[0]).toEqual({ rolled_from_audit_id: auditId, revision: 0 });
  });

  it('filing again makes no second row', async () => {
    await setFiled('in_preparation');
    await setFiled('filed');
    const { rows } = await su.query<{ id: string; rolled_from_audit_id: string }>(
      `SELECT id, rolled_from_audit_id FROM hsdg.tax_audits
        WHERE engagement_id = $1 AND financial_year = $2`,
      [eng, NEXT],
    );
    expect(rows).toEqual([{ id: nextId, rolled_from_audit_id: auditId }]);
  });

  it('the acceptance desk proposes last year’s form, partner and team', async () => {
    const v = await acceptance(nextId);
    expect(v.formType).toBeNull();
    expect(v.signingPartnerId).toBeNull();
    expect(v.proposal).toMatchObject({
      fromAuditId: auditId,
      fromFinancialYear: FY,
      formType: '3CA',
      signingPartnerId: partnerA,
    });
    expect(v.proposal!.team.length).toBeGreaterThan(0);
    expect(v.proposal!.team.some((t) => t.includes('(engagement partner)'))).toBe(true);
    // Last year's audit proposes nothing: it was not rolled from another.
    expect((await acceptance(auditId)).proposal).toBeNull();

    // Taking the proposal is an ordinary save; the partner is checked again.
    const saved = (
      await http()
        .put(`/api/v1/engagements/${eng}/tax-audits/${nextId}/acceptance`)
        .set(pa)
        .send({ version: v.version, formType: '3CA', signingPartnerId: partnerA })
        .expect(200)
    ).body as TaxAuditAcceptance;
    expect(saved).toMatchObject({ formType: '3CA', signingPartnerId: partnerA });
  });

  it('opening next year’s 3CD work carries last year’s filed answers as drafts', async () => {
    // A revised report of last year, still in hand, its clause 10 already
    // done differently: not what was reported, so not carried.
    const { rows: cols } = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'hsdg' AND table_name = 'tax_audits' AND column_name = 'revision_reason'`,
    );
    const revised = cols[0]!.n > 0; // F-8 asks a revision for its reason.
    const {
      rows: [rev],
    } = await su.query<{ id: string }>(
      revised
        ? `INSERT INTO hsdg.tax_audits
             (engagement_id, financial_year, revision, stage, clause_library_version_id,
              revised_from_id, revision_reason)
           VALUES ($1, $2, 1, 'clause_work', $3, $4, 'Turnover corrected.') RETURNING id`
        : `INSERT INTO hsdg.tax_audits
             (engagement_id, financial_year, revision, stage, clause_library_version_id)
           VALUES ($1, $2, 1, 'clause_work', $3) RETURNING id`,
      revised ? [eng, FY, libId, auditId] : [eng, FY, libId],
    );
    await donePaper(rev!.id, '10', { a: 'Revised: trading in yarn\t09006', b: 'Changed' });

    await su.query(`UPDATE hsdg.tax_audits SET stage = 'information' WHERE id = $1`, [nextId]);
    const base = `/api/v1/engagements/${eng}/tax-audits/${nextId}`;
    const v0 = (await http().get(`${base}/clauses`).set(pa).expect(200)).body as TaxAuditWorkspace;
    const v = (
      await http().post(`${base}/clauses/open`).set(pa).send({ version: v0.version }).expect(200)
    ).body as TaxAuditWorkspace;
    const paper = (no: string) => v.papers.find((p) => p.clauseNo === no)!;

    expect(paper('10')).toMatchObject({
      draftSource: 'last_year',
      draftAnswer: { a: 'Trading in textiles\t09005', b: 'No change' },
      draftConfirmedAt: null,
      answer: {},
    });
    expect(paper('10').draftNote).toMatch(/FY 2023-24 tax audit/);
    // No TDS return filed for FY 2024-25: last year's answer is the draft.
    expect(paper('34')).toMatchObject({
      draftSource: 'last_year',
      draftAnswer: { b: '26Q\tQ1\t2023-07-31\t2023-07-20\tYes' },
    });
    // A clause last year left undone carries nothing.
    expect(paper('21')?.draftSource ?? null).not.toBe('last_year');
  });
});

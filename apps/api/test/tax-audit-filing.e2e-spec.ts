import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { TaxAuditFiling, TaxAuditWorkspace } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * F-8 — sign and file. The signing Partner signs (UDIN on their membership
 * number, the signed report) only once the review is signed off; the
 * engagement's leads record the upload and the client's answer (a rejection
 * goes back to review); filing lodges the year's IT_TAX_AUDIT filing with the
 * acknowledgement, which the filing itself refuses until the client accepts.
 * The audit-case ITR waits on the filed report. A filed report is revised as
 * the next revision, from its clauses.
 */
describe('Tax audit sign and file (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: Record<string, string>;
  let pb: Record<string, string>;
  let mgr: Record<string, string>;
  let senior: Record<string, string>;
  let eng: string;
  let auditId: string;
  let instanceId: string;
  let pbEmp: string;
  let mgrEmp: string;
  let srEmp: string;
  let membershipBefore: string | null;
  const FY = '2025-26';
  // UDINs are unique across reports: a fresh one each run, on Partner B's membership number.
  const letters = (n: number) =>
    Array.from({ length: 6 }, (_, i) =>
      String.fromCharCode(65 + (Math.floor(n / 26 ** i) % 26)),
    ).join('');
  const UDIN = `26123456${letters(Date.now())}${String(Date.now() % 10000).padStart(4, '0')}`;
  const pdf = Buffer.from('%PDF-1.4 signed report').toString('base64');
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const base = () => `/api/v1/engagements/${eng}/tax-audits/${auditId}/filing`;
  const filing = async (who = pa) =>
    (await http().get(base()).set(who).expect(200)).body as TaxAuditFiling;
  const today = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const empOf = async (email: string) =>
    (
      await su.query<{ id: string }>(
        `SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id WHERE u.email = $1`,
        [email],
      )
    ).rows[0]!.id;
  /** The whole review chain signs off (F-7 is tested on its own). */
  const signOffChain = async (levels = ['senior', 'manager', 'partner']) => {
    const by: Record<string, string> = { senior: srEmp, manager: mgrEmp, partner: pbEmp };
    for (const level of levels) {
      await su.query(
        `INSERT INTO hsdg.tax_audit_review_signoffs (tax_audit_id, engagement_id, level, employee_id)
         VALUES ($1, $2, $3, $4)`,
        [auditId, eng, level, by[level]],
      );
    }
  };
  const sign = (version: number, udin = UDIN, who = pb) =>
    http().post(`${base()}/sign`).set(who).send({
      udin,
      filename: 'TAR FY 2025-26.pdf',
      contentType: 'application/pdf',
      contentBase64: pdf,
      version,
    });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = await as('partner.a@dhvaj.in');
    pb = await as('partner.b@dhvaj.in');
    mgr = await as('manager.x@dhvaj.in');
    senior = await as('senior.y@dhvaj.in');

    const acme = await http().get('/api/v1/entities?search=Acme&limit=10').set(pa).expect(200);
    const client = await freshClient(acme.body.items[0].id as string);
    await su.query(`UPDATE hsdg.entities SET annual_turnover = 25000000 WHERE id = $1`, [client]);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: client,
          status: 'accepted',
          financialYear: FY,
          streams: ['income_tax', 'tax_audit'],
          years: [{ financialYear: FY }],
        })
        .expect(201)
    ).body.id as string;
    const audits = (await http().get(`/api/v1/engagements/${eng}/tax-audits`).set(pa).expect(200))
      .body as { id: string; financialYear: string }[];
    auditId = audits.find((a) => a.financialYear === FY)!.id;
    instanceId = (
      await su.query<{ compliance_instance_id: string }>(
        `SELECT compliance_instance_id FROM hsdg.tax_audits WHERE id = $1`,
        [auditId],
      )
    ).rows[0]!.compliance_instance_id;

    const paEmp = await empOf('partner.a@dhvaj.in');
    pbEmp = await empOf('partner.b@dhvaj.in');
    mgrEmp = await empOf('manager.x@dhvaj.in');
    srEmp = await empOf('senior.y@dhvaj.in');
    await su.query(
      `UPDATE hsdg.engagements SET engagement_partner_id = $2, engagement_manager_id = $3
        WHERE id = $1`,
      [eng, paEmp, mgrEmp],
    );
    for (const emp of [srEmp, pbEmp]) {
      await su.query(
        `INSERT INTO hsdg.engagement_team (engagement_id, employee_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [eng, emp],
      );
    }
    membershipBefore = (
      await su.query<{ membership_no: string | null }>(
        `SELECT membership_no FROM hsdg.partner_profiles WHERE employee_id = $1`,
        [pbEmp],
      )
    ).rows[0]!.membership_no;
    await su.query(
      `UPDATE hsdg.partner_profiles
          SET cop_no = 'COP-B', cop_valid_until = DATE '2099-03-31', membership_no = '123456'
        WHERE employee_id = $1`,
      [pbEmp],
    );
    await su.query(
      `UPDATE hsdg.tax_audits SET stage = 'information', signing_partner_id = $2, form_type = '3CB'
        WHERE id = $1`,
      [auditId, pbEmp],
    );
    const ws = (
      await http()
        .get(`/api/v1/engagements/${eng}/tax-audits/${auditId}/clauses`)
        .set(pa)
        .expect(200)
    ).body as TaxAuditWorkspace;
    await http()
      .post(`/api/v1/engagements/${eng}/tax-audits/${auditId}/clauses/open`)
      .set(pa)
      .send({ version: ws.version })
      .expect(200);
    // Every clause settled and the 3CD in review (F-5 and F-7 are tested on their own).
    await su.query('BEGIN');
    await su.query(`SET LOCAL session_replication_role = replica`);
    await su.query(
      `UPDATE hsdg.tax_audit_working_papers
          SET status = 'done', done_at = now(), done_by_employee_id = $2,
              draft_confirmed_at = CASE WHEN draft_source IS NOT NULL THEN now() END
        WHERE tax_audit_id = $1 AND status <> 'not_applicable'`,
      [auditId, srEmp],
    );
    await su.query(`UPDATE hsdg.tax_audits SET stage = 'review' WHERE id = $1`, [auditId]);
    await su.query('COMMIT');
  });

  afterAll(async () => {
    await su?.query(
      `UPDATE hsdg.partner_profiles SET cop_no = NULL, cop_valid_until = NULL, membership_no = $2
        WHERE employee_id = $1`,
      [pbEmp, membershipBefore],
    );
    await su?.end();
    await app?.close();
  });

  it('is signed by the signing Partner alone, on a signed-off review and their UDIN', async () => {
    let f = await filing(pb);
    expect(f).toMatchObject({ stage: 'review', signingPartnerName: expect.any(String) });
    expect(f.signingBlockers).toEqual(['The signing Partner has not signed off the review.']);
    expect(f.can.sign).toBe(false);
    await sign(f.version)
      .expect(400)
      .expect((r) =>
        expect(r.body.message).toBe('The signing Partner has not signed off the review.'),
      );

    await signOffChain();
    f = await filing(pb);
    expect(f.can).toMatchObject({ sign: true, upload: false });
    expect((await filing(mgr)).can.sign).toBe(false);
    await sign(f.version, UDIN, mgr).expect(403);
    await sign(f.version, '26999999ABCDEF1234')
      .expect(400)
      .expect((r) =>
        expect(r.body.message).toBe(
          'This UDIN is not on the signing Partner’s membership number (123456).',
        ),
      );
    f = (await sign(f.version, ` ${UDIN.toLowerCase()} `).expect(200)).body as TaxAuditFiling;
    expect(f).toMatchObject({ stage: 'signed', udin: UDIN, can: { withdraw: true } });
    expect(f.signedReport?.title).toMatch(
      /^Signed tax audit report — Form 3CB and 3CD, FY 2025-26/,
    );
  });

  it('keeps the year’s filing for the desk until the client accepts the report', async () => {
    await http()
      .post(`/api/v1/compliance-instances/${instanceId}/lodge`)
      .set(mgr)
      .send({ referenceNo: '123456789012345', filedOn: today() })
      .expect(409)
      .expect((r) => expect(r.body.message).toMatch(/^The tax audit report is at Signed: sign it/));
    const ws = await http().get(`/api/v1/compliance-instances/${instanceId}`).set(mgr).expect(200);
    expect(ws.body.can.lodge).toBe(false);
    expect(ws.body.warnings.map((w: { code: string }) => w.code)).toContain('tax_audit_pending');
  });

  it('goes back to review when the signature is withdrawn or the client rejects it', async () => {
    let f = await filing(pb);
    f = (
      await http()
        .post(`${base()}/withdraw`)
        .set(pb)
        .send({ reason: 'Wrong form type on the cover.', version: f.version })
        .expect(200)
    ).body as TaxAuditFiling;
    expect(f).toMatchObject({ stage: 'review', udin: null, signedReport: null });
    expect(f.signingBlockers).toEqual(['The signing Partner has not signed off the review.']);

    await signOffChain(['partner']);
    f = (await sign((await filing(pb)).version).expect(200)).body as TaxAuditFiling;
    await http()
      .post(`${base()}/uploaded`)
      .set(senior)
      .send({ uploadedOn: today(), version: f.version })
      .expect(403);
    await http()
      .post(`${base()}/uploaded`)
      .set(mgr)
      .send({ uploadedOn: '2026-01-01', version: f.version })
      .expect(400)
      .expect((r) =>
        expect(r.body.message).toMatch(/^The upload date cannot be before the signing/),
      );
    f = (
      await http()
        .post(`${base()}/uploaded`)
        .set(mgr)
        .send({ uploadedOn: today(), version: f.version })
        .expect(200)
    ).body as TaxAuditFiling;
    expect(f).toMatchObject({
      stage: 'uploaded',
      uploadedOn: today(),
      can: { clientDecision: true },
    });

    f = (
      await http()
        .post(`${base()}/client-rejected`)
        .set(mgr)
        .send({ rejectedOn: today(), reason: 'Depreciation schedule differs.', version: f.version })
        .expect(200)
    ).body as TaxAuditFiling;
    expect(f).toMatchObject({
      stage: 'review',
      uploadedOn: null,
      udin: null,
      clientRejectedOn: today(),
      clientRejectionReason: 'Depreciation schedule differs.',
    });
    const { rows } = await su.query<{ superseded_reason: string }>(
      `SELECT superseded_reason FROM hsdg.tax_audit_review_signoffs
        WHERE tax_audit_id = $1 AND level = 'partner' ORDER BY signed_off_at DESC LIMIT 1`,
      [auditId],
    );
    expect(rows[0]!.superseded_reason).toBe(
      'The client rejected the report: Depreciation schedule differs.',
    );
  });

  it('is filed with the acknowledgement, lodging the year’s filing; the ITR follows', async () => {
    await signOffChain(['partner']);
    let f = (await sign((await filing(pb)).version).expect(200)).body as TaxAuditFiling;
    f = (
      await http()
        .post(`${base()}/uploaded`)
        .set(pb)
        .send({ uploadedOn: today(), version: f.version })
        .expect(200)
    ).body as TaxAuditFiling;
    f = (
      await http()
        .post(`${base()}/client-accepted`)
        .set(mgr)
        .send({ acceptedOn: today(), version: f.version })
        .expect(200)
    ).body as TaxAuditFiling;
    expect(f).toMatchObject({ stage: 'client_accepted', can: { file: true } });

    f = (
      await http()
        .post(`${base()}/filed`)
        .set(mgr)
        .send({
          acknowledgementNo: '7654 3210 9876 543',
          filedOn: today(),
          filename: 'ack.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('%PDF-1.4 ack').toString('base64'),
          version: f.version,
        })
        .expect(200)
    ).body as TaxAuditFiling;
    expect(f).toMatchObject({
      stage: 'filed',
      filedOn: today(),
      acknowledgementNo: '765432109876543',
      can: { revise: true },
    });
    expect(f.acknowledgement).not.toBeNull();
    const inst = await su.query<{ workflow_status: string }>(
      `SELECT workflow_status FROM hsdg.compliance_instances WHERE id = $1`,
      [instanceId],
    );
    expect(inst.rows[0]!.workflow_status).toBe('filed');
  });

  it('holds the audit-case ITR while the report is in hand', async () => {
    const itr = await su.query<{ id: string }>(
      `SELECT ci.id FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
        WHERE ci.engagement_id = $1 AND ci.financial_year = $2 AND r.code = 'IT_ITR_AUDIT'`,
      [eng, FY],
    );
    expect(itr.rows).toHaveLength(1);
    const itrId = itr.rows[0]!.id;
    // Filed: nothing waits.
    let ws = await http().get(`/api/v1/compliance-instances/${itrId}`).set(mgr).expect(200);
    expect(ws.body.warnings.map((w: { code: string }) => w.code)).not.toContain(
      'tax_audit_pending',
    );
    // Back in hand (as if the filing were undone and the report rejected): the ITR waits.
    await su.query(`UPDATE hsdg.tax_audits SET stage = 'review' WHERE id = $1`, [auditId]);
    ws = await http().get(`/api/v1/compliance-instances/${itrId}`).set(mgr).expect(200);
    expect(ws.body.can.lodge).toBe(false);
    expect(ws.body.warnings).toContainEqual({
      code: 'tax_audit_pending',
      message:
        'The tax audit report for FY 2025-26 is not filed yet (Review); the ITR waits on it.',
    });
    await http()
      .post(`/api/v1/compliance-instances/${itrId}/lodge`)
      .set(mgr)
      .send({ referenceNo: '111122223333444', filedOn: today() })
      .expect(409);
    await su.query(`UPDATE hsdg.tax_audits SET stage = 'filed' WHERE id = $1`, [auditId]);
  });

  it('revises a filed report as the next revision, from its clauses', async () => {
    const f = await filing(mgr);
    await http()
      .post(`${base()}/revise`)
      .set(senior)
      .send({ reason: 'Clause 34 revised after TDS correction.', version: f.version })
      .expect(403);
    const rev = (
      await http()
        .post(`${base()}/revise`)
        .set(mgr)
        .send({ reason: 'Clause 34 revised after TDS correction.', version: f.version })
        .expect(200)
    ).body as TaxAuditFiling;
    expect(rev).toMatchObject({
      revision: 1,
      revisedFromId: auditId,
      revisionReason: 'Clause 34 revised after TDS correction.',
      stage: 'clause_work',
      udin: null,
      complianceInstanceId: null,
    });
    expect(rev.revisions.map((r) => [r.revision, r.stage])).toEqual([
      [0, 'filed'],
      [1, 'clause_work'],
    ]);
    const papers = await su.query<{ n: number }>(
      `SELECT count(*) FILTER (WHERE tax_audit_id = $1)::int - count(*) FILTER (WHERE tax_audit_id = $2)::int AS n
         FROM hsdg.tax_audit_working_papers WHERE tax_audit_id IN ($1, $2)`,
      [auditId, rev.auditId],
    );
    expect(papers.rows[0]!.n).toBe(0);
    const again = await filing(mgr);
    expect(again.can.revise).toBe(false);
    await http()
      .post(`${base()}/revise`)
      .set(mgr)
      .send({ reason: 'Again.', version: again.version })
      .expect(409);
  });
});

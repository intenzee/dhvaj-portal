import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { TaxAuditReview, TaxAuditWorkspace } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * F-7 — the Tax Audit review and observations register. Once every clause is
 * settled the 3CD goes for review: Senior, then Manager, then the signing
 * Partner, each signing off once the points raised at their level are
 * cleared. Matters flagged for the report are decided by the signing Partner.
 * The Partner cannot sign off with a point open, a draft unconfirmed or a
 * flag undecided; the report lists every accepted entry; a later point or a
 * reopened clause takes the sign-offs away.
 */
describe('Tax audit review and observations (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: Record<string, string>;
  let pb: Record<string, string>;
  let mgr: Record<string, string>;
  let senior: Record<string, string>;
  let art: Record<string, string>;
  let eng: string;
  let auditId: string;
  let wp34: string;
  const FY = '2026-27';
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const base = () => `/api/v1/engagements/${eng}/tax-audits/${auditId}`;
  const review = async (who = pa) =>
    (await http().get(`${base()}/review`).set(who).expect(200)).body as TaxAuditReview;
  const empOf = async (email: string) =>
    (
      await su.query<{ id: string }>(
        `SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id WHERE u.email = $1`,
        [email],
      )
    ).rows[0]!.id;
  const signed = (r: TaxAuditReview) => r.chain.filter((c) => c.signoff).map((c) => c.level);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = await as('partner.a@dhvaj.in');
    pb = await as('partner.b@dhvaj.in');
    mgr = await as('manager.x@dhvaj.in');
    senior = await as('senior.y@dhvaj.in');

    const email = `article.rv.${Date.now()}@dhvaj.in`;
    // Free Article North from an earlier suite's login first.
    await su.query(`UPDATE hsdg.employees SET user_id = NULL WHERE employee_code = 'EMP007'`);
    const user = await http()
      .post('/api/v1/users')
      .set(await as('admin@dhvaj.in'))
      .send({ email, displayName: 'Article North', officeCode: 'NORTH', roles: ['article'] })
      .expect(201);
    const artEmp = (
      await su.query<{ id: string }>(
        `UPDATE hsdg.employees SET user_id = $1 WHERE employee_code = 'EMP007' RETURNING id`,
        [user.body.id],
      )
    ).rows[0]!.id;
    art = await as(email);

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
    auditId = (await http().get(`/api/v1/engagements/${eng}/tax-audits`).set(pa).expect(200))
      .body[0].id as string;

    const [paEmp, pbEmp, mgrEmp, srEmp] = await Promise.all(
      ['partner.a', 'partner.b', 'manager.x', 'senior.y'].map((n) => empOf(`${n}@dhvaj.in`)),
    );
    await su.query(
      `UPDATE hsdg.engagements SET engagement_partner_id = $2, engagement_manager_id = $3
        WHERE id = $1`,
      [eng, paEmp, mgrEmp],
    );
    for (const emp of [artEmp, srEmp, pbEmp]) {
      await su.query(
        `INSERT INTO hsdg.engagement_team (engagement_id, employee_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [eng, emp],
      );
    }
    await su.query(
      `UPDATE hsdg.partner_profiles SET cop_no = 'COP-B', cop_valid_until = DATE '2099-03-31'
        WHERE employee_id = $1`,
      [pbEmp],
    );
    // Accepted, Partner B signs; open the 3CD work as the partner.
    await su.query(
      `UPDATE hsdg.tax_audits SET stage = 'information', signing_partner_id = $2 WHERE id = $1`,
      [auditId, pbEmp],
    );
    const ws = (await http().get(`${base()}/clauses`).set(pa).expect(200))
      .body as TaxAuditWorkspace;
    const opened = (
      await http().post(`${base()}/clauses/open`).set(pa).send({ version: ws.version }).expect(200)
    ).body as TaxAuditWorkspace;
    wp34 = opened.papers.find((p) => p.clauseNo === '34')!.id;
    // Every clause but 34 is settled, its portal draft (F-6) confirmed (straight
    // in the table, the task trigger off).
    await su.query('BEGIN');
    await su.query(`SET LOCAL session_replication_role = replica`);
    await su.query(
      `UPDATE hsdg.tax_audit_working_papers
          SET status = 'done', done_at = now(), done_by_employee_id = $2, preparer_employee_id = $3,
              draft_confirmed_at = CASE WHEN draft_source IS NOT NULL THEN now() END,
              draft_confirmed_by_employee_id = CASE WHEN draft_source IS NOT NULL THEN $2::uuid END
        WHERE tax_audit_id = $1 AND status <> 'not_applicable' AND clause_no <> '34'`,
      [auditId, srEmp, artEmp],
    );
    await su.query(
      `UPDATE hsdg.tax_audit_working_papers
          SET status = 'in_progress', answer = '{"a": true}', preparer_employee_id = $2
        WHERE id = $1`,
      [wp34, artEmp],
    );
    await su.query('COMMIT');
  });

  afterAll(async () => {
    await su?.query(
      `UPDATE hsdg.partner_profiles SET cop_no = NULL, cop_valid_until = NULL
        WHERE employee_id = (SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id
                              WHERE u.email = 'partner.b@dhvaj.in')`,
    );
    await su?.end();
    await app?.close();
  });

  it('goes for review only once every clause is settled, sent by a Senior or above', async () => {
    let r = await review(senior);
    expect(r).toMatchObject({ stage: 'clause_work', myLevel: 'senior', canStart: true });
    expect(r.startBlockers).toEqual(['Finish clause 34 first.']);
    expect((await review(art)).myLevel).toBeNull();
    expect((await review(pb)).myLevel).toBe('partner');
    expect((await review(mgr)).myLevel).toBe('manager');

    await http().post(`${base()}/review/start`).set(art).send({ version: r.version }).expect(403);
    await http()
      .post(`${base()}/review/start`)
      .set(senior)
      .send({ version: r.version })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('Finish clause 34 first.'));

    await su.query('BEGIN');
    await su.query(`SET LOCAL session_replication_role = replica`);
    await su.query(
      `UPDATE hsdg.tax_audit_working_papers SET status = 'done', done_at = now() WHERE id = $1`,
      [wp34],
    );
    await su.query('COMMIT');
    r = (
      await http()
        .post(`${base()}/review/start`)
        .set(senior)
        .send({ version: r.version })
        .expect(200)
    ).body as TaxAuditReview;
    expect(r.stage).toBe('review');
    expect(r.canSignOff).toBe('senior');
  });

  it('signs off Senior, then Manager, once each level’s points are cleared', async () => {
    let r = (
      await http()
        .post(`${base()}/review/points`)
        .set(senior)
        .send({ body: 'Tie the 194C total to the TDS returns.', workingPaperId: wp34 })
        .expect(200)
    ).body as TaxAuditReview;
    const point = r.points[0]!;
    expect(point).toMatchObject({ clauseNo: '34', level: 'senior', status: 'open' });

    // The Manager cannot sign off before the Senior; the Senior not with a point open.
    await http()
      .post(`${base()}/review/sign-off`)
      .set(mgr)
      .send({ level: 'manager', version: r.version })
      .expect(403)
      .expect((res) => expect(res.body.message).toBe('Senior review comes first.'));
    await http()
      .post(`${base()}/review/sign-off`)
      .set(senior)
      .send({ level: 'senior', version: r.version })
      .expect(400);

    // The Senior cannot respond to their own point; the Article can, and cannot clear it.
    await http()
      .post(`${base()}/review/points/${point.id}/respond`)
      .set(senior)
      .send({ response: 'x', version: point.version })
      .expect(403);
    r = (
      await http()
        .post(`${base()}/review/points/${point.id}/respond`)
        .set(art)
        .send({ response: 'Tied: ₹4,12,000 both sides.', version: point.version })
        .expect(200)
    ).body as TaxAuditReview;
    const responded = r.points[0]!;
    expect(responded).toMatchObject({ status: 'responded', canClear: false, canRespond: true });
    await http()
      .post(`${base()}/review/points/${point.id}/clear`)
      .set(art)
      .send({ version: responded.version })
      .expect(403);
    r = (
      await http()
        .post(`${base()}/review/points/${point.id}/clear`)
        .set(senior)
        .send({ version: responded.version })
        .expect(200)
    ).body as TaxAuditReview;
    expect(r.points[0]!.status).toBe('cleared');

    r = (
      await http()
        .post(`${base()}/review/sign-off`)
        .set(senior)
        .send({ level: 'senior', version: r.version })
        .expect(200)
    ).body as TaxAuditReview;
    expect(signed(r)).toEqual(['senior']);
    // The Senior signed one level; the Manager signs the next.
    expect(r.canSignOff).toBeNull();
    expect((await review(mgr)).canSignOff).toBe('manager');
    r = (
      await http()
        .post(`${base()}/review/sign-off`)
        .set(mgr)
        .send({ level: 'manager', version: r.version })
        .expect(200)
    ).body as TaxAuditReview;
    expect(signed(r)).toEqual(['senior', 'manager']);
    // Only the signing Partner signs off the last level.
    await http()
      .post(`${base()}/review/sign-off`)
      .set(pa)
      .send({ level: 'partner', version: r.version })
      .expect(403);
  });

  it('lets only the signing Partner decide flags, and lists accepted ones in the report', async () => {
    let r = (
      await http()
        .post(`${base()}/observations`)
        .set(art)
        .send({ wording: 'TDS on rent paid late in Q3.', workingPaperId: wp34 })
        .expect(200)
    ).body as TaxAuditReview;
    r = (
      await http()
        .post(`${base()}/observations`)
        .set(senior)
        .send({ wording: 'Stock records kept only at year end.' })
        .expect(200)
    ).body as TaxAuditReview;
    const [late, stock] = r.observations;
    expect(late).toMatchObject({ clauseNo: '34', status: 'proposed', canEdit: false });
    expect(stock).toMatchObject({ clauseNo: null, status: 'proposed' });

    // The Partner cannot sign off with flags undecided.
    await http()
      .post(`${base()}/review/sign-off`)
      .set(pb)
      .send({ level: 'partner', version: r.version })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('Decide 2 flagged matters for the report.'));

    await http()
      .post(`${base()}/observations/${late!.id}/decide`)
      .set(pa)
      .send({ outcome: 'qualification', version: late!.version })
      .expect(403);
    await http()
      .post(`${base()}/observations/${stock!.id}/decide`)
      .set(pb)
      .send({ outcome: 'dropped', version: stock!.version })
      .expect(400);
    r = (
      await http()
        .post(`${base()}/observations/${late!.id}/decide`)
        .set(pb)
        .send({ outcome: 'observation', version: late!.version })
        .expect(200)
    ).body as TaxAuditReview;
    r = (
      await http()
        .post(`${base()}/observations/${stock!.id}/decide`)
        .set(pb)
        .send({ outcome: 'qualification', version: stock!.version })
        .expect(200)
    ).body as TaxAuditReview;
    // Qualifications first, then observations.
    expect(r.report.map((o) => [o.kind, o.clauseNo])).toEqual([
      ['qualification', null],
      ['observation', '34'],
    ]);

    r = await review(pb);
    expect(r.canSignOff).toBe('partner');
    expect(r.signingBlockers).toEqual(['The signing Partner has not signed off the review.']);
    r = (
      await http()
        .post(`${base()}/review/sign-off`)
        .set(pb)
        .send({ level: 'partner', version: r.version })
        .expect(200)
    ).body as TaxAuditReview;
    expect(signed(r)).toEqual(['senior', 'manager', 'partner']);
    expect(r.signingBlockers).toEqual([]);
  });

  it('takes sign-offs away for a later point, an unconfirmed draft blocks, a reopened clause sends it back', async () => {
    // A Manager's point takes the Manager and Partner sign-offs away.
    let r = (
      await http()
        .post(`${base()}/review/points`)
        .set(mgr)
        .send({ body: 'Recheck the MSME list.' })
        .expect(200)
    ).body as TaxAuditReview;
    expect(signed(r)).toEqual(['senior']);
    expect(r.signingBlockers).toEqual([
      'Clear 1 open review point.',
      'The signing Partner has not signed off the review.',
    ]);
    // An open point at Manager level does not stop the Partner clearing it from above.
    const p = r.points.find((x) => x.level === 'manager')!;
    expect((await review(pb)).points.find((x) => x.id === p.id)!.canClear).toBe(true);

    // A portal draft nobody confirmed blocks signing.
    await su.query(
      `UPDATE hsdg.tax_audit_working_papers SET draft_source = 'tds_filings' WHERE id = $1`,
      [wp34],
    );
    r = await review();
    expect(r.unconfirmedDrafts).toEqual(['34']);
    expect(r.signingBlockers).toContain('Confirm the portal draft on clause 34.');
    await su.query(
      `UPDATE hsdg.tax_audit_working_papers
          SET draft_confirmed_at = now(), draft_confirmed_by_employee_id = preparer_employee_id
        WHERE id = $1`,
      [wp34],
    );

    // Reopening a done clause sends the 3CD back to clause work; every level looks again.
    const ws = (await http().get(`${base()}/clauses`).set(pa).expect(200))
      .body as TaxAuditWorkspace;
    const v34 = ws.papers.find((x) => x.id === wp34)!.version;
    await http()
      .post(`${base()}/clauses/${wp34}/reopen`)
      .set(pa)
      .send({ version: v34 })
      .expect(200);
    r = await review();
    expect(r.stage).toBe('clause_work');
    expect(signed(r)).toEqual([]);

    const { rows } = await su.query<{ action: string }>(
      `SELECT action FROM hsdg.audit_events
        WHERE action LIKE 'tax_audit.review%' OR action LIKE 'tax_audit.observation%'
          AND object_id IN (SELECT id::text FROM hsdg.tax_audit_observations WHERE tax_audit_id = $1)
        ORDER BY occurred_at`,
      [auditId],
    );
    const actions = rows.map((x) => x.action);
    for (const a of [
      'tax_audit.review_started',
      'tax_audit.review_point_raised',
      'tax_audit.review_point_responded',
      'tax_audit.review_point_cleared',
      'tax_audit.review_signed_off',
      'tax_audit.observation_flagged',
      'tax_audit.observation_decided',
    ]) {
      expect(actions).toContain(a);
    }
  });
});

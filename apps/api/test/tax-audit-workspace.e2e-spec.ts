import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { TaxAuditWorkspace } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * F-5 — the Form 3CD clause workspace. The partner opens the 3CD work on the
 * library version published for the year: each package becomes a task given
 * out through Assign work, each clause a working paper, and a clause the
 * audit's facts rule out opens as Not applicable with its reason. An Article
 * finishes clause 34 with evidence and sends it for review without leaving
 * the workspace; a Senior sends it back or marks it done. The standard
 * information list goes to the client as client requests.
 */
describe('Tax audit clause workspace (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: Record<string, string>;
  let senior: Record<string, string>;
  let art: Record<string, string>;
  let artEmp: string;
  let eng: string;
  let auditId: string;
  const FY = '2026-27';
  const http = () => request(app.getHttpServer());
  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const base = () => `/api/v1/engagements/${eng}/tax-audits/${auditId}`;
  const view = async (who = pa) =>
    (await http().get(`${base()}/clauses`).set(who).expect(200)).body as TaxAuditWorkspace;
  const paper = (v: TaxAuditWorkspace, no: string) => v.papers.find((p) => p.clauseNo === no)!;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = await as('partner.a@dhvaj.in');
    senior = await as('senior.y@dhvaj.in');

    // An article with a login, linked to the seeded Article North.
    const email = `article.ws.${Date.now()}@dhvaj.in`;
    // Free Article North from an earlier suite's login first.
    await su.query(`UPDATE hsdg.employees SET user_id = NULL WHERE employee_code = 'EMP007'`);
    const user = await http()
      .post('/api/v1/users')
      .set(await as('admin@dhvaj.in'))
      .send({ email, displayName: 'Article North', officeCode: 'NORTH', roles: ['article'] })
      .expect(201);
    artEmp = (
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
    const { rows: team } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees e WHERE e.user_id =
         (SELECT id FROM hsdg.users WHERE email = 'senior.y@dhvaj.in')`,
    );
    for (const emp of [artEmp, team[0]!.id]) {
      await su.query(
        `INSERT INTO hsdg.engagement_team (engagement_id, employee_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [eng, emp],
      );
    }
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('opens only after acceptance, by the partner, on the year’s library version', async () => {
    let v = await view();
    expect(v).toMatchObject({ library: null, papers: [], canLead: true, editable: true });
    await http()
      .post(`${base()}/clauses/open`)
      .set(pa)
      .send({ version: v.version })
      .expect(400)
      .expect((r) => expect(r.body.message).toContain('Accept the audit first'));

    await su.query(`UPDATE hsdg.tax_audits SET stage = 'information' WHERE id = $1`, [auditId]);
    v = await view();
    await http().post(`${base()}/clauses/open`).set(art).send({ version: v.version }).expect(403);
    v = (
      await http()
        .put(`${base()}/facts`)
        .set(pa)
        .send({ version: v.version, facts: { loansOrDeposits: false, presumptiveIncome: false } })
        .expect(200)
    ).body as TaxAuditWorkspace;
    await http()
      .put(`${base()}/facts`)
      .set(pa)
      .send({ version: v.version, facts: { hasYacht: true } })
      .expect(400);

    v = (
      await http().post(`${base()}/clauses/open`).set(pa).send({ version: v.version }).expect(200)
    ).body as TaxAuditWorkspace;
    const { rows: lib } = await su.query<{ version_no: number; n: number }>(
      `SELECT v.version_no, (SELECT count(*)::int FROM hsdg.tax_audit_clause_library c
                              WHERE c.library_version_id = v.id) AS n
         FROM hsdg.tax_audit_clause_library_versions v
        WHERE v.status = 'published' AND v.applies_from_fy <= $1
        ORDER BY v.applies_from_fy DESC, v.version_no DESC LIMIT 1`,
      [FY],
    );
    expect(v.stage).toBe('clause_work');
    expect(v.library!.versionNo).toBe(lib[0]!.version_no);
    expect(v.papers).toHaveLength(lib[0]!.n);
    // The facts rule clause 31 out: it opens Not applicable with the library's reason.
    expect(paper(v, '31')).toMatchObject({
      status: 'not_applicable',
      notApplicableSource: 'condition',
    });
    expect(paper(v, '31').notApplicableReason).toBeTruthy();
    expect(paper(v, '34').status).toBe('not_started');

    // Each package is an engagement task, unassigned, ready for Assign work.
    expect(v.packages.length).toBeGreaterThan(5);
    const { rows: tasks } = await su.query<{ id: string; title: string; status: string }>(
      `SELECT id, title, status FROM hsdg.tasks WHERE id = ANY($1::uuid[])`,
      [v.packages.map((p) => p.taskId)],
    );
    expect(tasks).toHaveLength(v.packages.length);
    const tds = v.packages.find((p) => p.package === 'tds_tcs')!;
    expect(tds.clauseNos).toContain('34');
    expect(tasks.find((t) => t.id === tds.taskId)).toMatchObject({
      status: 'todo',
      title: expect.stringContaining(`Tax audit FY ${FY} — TDS`),
    });

    await http().post(`${base()}/clauses/open`).set(pa).send({ version: v.version }).expect(409);
  });

  it('facts bring a ruled-out clause back, and rule it out again', async () => {
    let v = await view();
    v = (
      await http()
        .put(`${base()}/facts`)
        .set(pa)
        .send({ version: v.version, facts: { ...v.facts, loansOrDeposits: true } })
        .expect(200)
    ).body as TaxAuditWorkspace;
    expect(paper(v, '31')).toMatchObject({ status: 'not_started', notApplicableReason: null });
    v = (
      await http()
        .put(`${base()}/facts`)
        .set(pa)
        .send({ version: v.version, facts: { ...v.facts, loansOrDeposits: false } })
        .expect(200)
    ).body as TaxAuditWorkspace;
    expect(paper(v, '31').status).toBe('not_applicable');
  });

  it('an Article finishes clause 34 with evidence and sends it for review without leaving the workspace', async () => {
    const before = await view();
    const tds = before.packages.find((p) => p.package === 'tds_tcs')!;
    const task = (
      await http().get(`/api/v1/engagements/${eng}/tasks/${tds.taskId}`).set(pa).expect(200)
    ).body as { version: number };
    await http()
      .patch(`/api/v1/engagements/${eng}/tasks/${tds.taskId}`)
      .set(pa)
      .send({ assignedToEmployeeId: artEmp, version: task.version })
      .expect(200);

    let v = await view(art);
    let p34 = paper(v, '34');
    expect(p34).toMatchObject({ canPrepare: true, status: 'not_started' });
    expect(p34.blockers.join(' ')).toContain('Attach the evidence');
    // Not the article's package: clause 18 is someone else's.
    expect(paper(v, '18').canPrepare).toBe(false);
    await http()
      .put(`${base()}/clauses/${paper(v, '18').id}`)
      .set(art)
      .send({ version: paper(v, '18').version, answer: {} })
      .expect(403);

    await http()
      .post(`${base()}/clauses/${p34.id}/send-for-review`)
      .set(art)
      .send({ version: p34.version })
      .expect(400);
    await http()
      .put(`${base()}/clauses/${p34.id}`)
      .set(art)
      .send({ version: p34.version, answer: { a: 5 } })
      .expect(400);
    await http()
      .put(`${base()}/clauses/${p34.id}`)
      .set(art)
      .send({ version: p34.version, answer: { z: 'x' } })
      .expect(400);

    v = (
      await http()
        .put(`${base()}/clauses/${p34.id}`)
        .set(art)
        .send({
          version: p34.version,
          answer: {
            a: '194C\tContract\t12,40,000\tNil short\n194J\tProfessional\t3,10,000\tNil short',
            b: 'All quarterly statements furnished within time',
            c: 'Nil',
          },
        })
        .expect(200)
    ).body as TaxAuditWorkspace;
    p34 = paper(v, '34');
    expect(p34).toMatchObject({ status: 'in_progress', preparerId: artEmp });
    expect(p34.blockers).toEqual([expect.stringContaining('Attach the evidence')]);
    expect(v.packages.find((p) => p.package === 'tds_tcs')!.taskStatus).toBe('in_progress');

    v = (
      await http()
        .post(`${base()}/clauses/${p34.id}/evidence`)
        .set(art)
        .send({
          filename: 'traces-default-summary.txt',
          contentType: 'text/plain',
          contentBase64: Buffer.from('No defaults for FY 2026-27').toString('base64'),
        })
        .expect(200)
    ).body as TaxAuditWorkspace;
    p34 = paper(v, '34');
    expect(p34.documents).toHaveLength(1);
    expect(p34.blockers).toEqual([]);
    const { rows: doc } = await su.query<{ task_id: string; document_type: string }>(
      `SELECT task_id, document_type FROM hsdg.documents WHERE id = $1`,
      [p34.documents[0]!.documentId],
    );
    expect(doc[0]).toEqual({ task_id: tds.taskId, document_type: 'evidence' });

    v = (
      await http()
        .post(`${base()}/clauses/${p34.id}/send-for-review`)
        .set(art)
        .send({ version: p34.version })
        .expect(200)
    ).body as TaxAuditWorkspace;
    p34 = paper(v, '34');
    expect(p34.status).toBe('in_review');
    expect(p34.canReview).toBe(false); // not their own work
    await http()
      .put(`${base()}/clauses/${p34.id}`)
      .set(art)
      .send({ version: p34.version, answer: {} })
      .expect(400);
    await http()
      .post(`${base()}/clauses/${p34.id}/review`)
      .set(art)
      .send({ version: p34.version, outcome: 'done' })
      .expect(403);

    // The Senior sends it back with a comment, then marks it done.
    expect(paper(await view(senior), '34').canReview).toBe(true);
    await http()
      .post(`${base()}/clauses/${p34.id}/review`)
      .set(senior)
      .send({ version: p34.version, outcome: 'send_back' })
      .expect(400);
    v = (
      await http()
        .post(`${base()}/clauses/${p34.id}/review`)
        .set(senior)
        .send({ version: p34.version, outcome: 'send_back', comment: 'Add the 194Q line.' })
        .expect(200)
    ).body as TaxAuditWorkspace;
    p34 = paper(v, '34');
    expect(p34.status).toBe('in_progress');
    expect(p34.comments.map((c) => c.body)).toEqual(['Add the 194Q line.']);
    v = (
      await http()
        .post(`${base()}/clauses/${p34.id}/send-for-review`)
        .set(art)
        .send({ version: p34.version })
        .expect(200)
    ).body as TaxAuditWorkspace;
    v = (
      await http()
        .post(`${base()}/clauses/${p34.id}/review`)
        .set(senior)
        .send({ version: paper(v, '34').version, outcome: 'done' })
        .expect(200)
    ).body as TaxAuditWorkspace;
    expect(paper(v, '34')).toMatchObject({ status: 'done', doneByName: expect.any(String) });
    const pkg = v.packages.find((p) => p.package === 'tds_tcs')!;
    const settled = pkg.counts.done + pkg.counts.not_applicable === pkg.clauseNos.length;
    // The Senior may not see the Article's task; it follows the clauses all the same.
    const { rows: done } = await su.query<{ status: string }>(
      `SELECT status FROM hsdg.tasks WHERE id = $1`,
      [pkg.taskId],
    );
    expect(done[0]!.status).toBe(settled ? 'done' : 'in_progress');

    const { rows: events } = await su.query<{ action: string }>(
      `SELECT action FROM hsdg.audit_events WHERE object_id = $1 ORDER BY occurred_at`,
      [p34.id],
    );
    expect(events.map((e) => e.action)).toEqual([
      'tax_audit_wp.evidence_added',
      'tax_audit_wp.sent_for_review',
      'tax_audit_wp.sent_back',
      'tax_audit_wp.sent_for_review',
      'tax_audit_wp.reviewed',
    ]);
  });

  it('Not applicable needs a reason, and reopens', async () => {
    let v = await view();
    const p = paper(v, '36A');
    await http()
      .post(`${base()}/clauses/${p.id}/not-applicable`)
      .set(pa)
      .send({ version: p.version, reason: '   ' })
      .expect(400);
    v = (
      await http()
        .post(`${base()}/clauses/${p.id}/not-applicable`)
        .set(pa)
        .send({ version: p.version, reason: 'Not a closely held company; no deemed dividend.' })
        .expect(200)
    ).body as TaxAuditWorkspace;
    expect(paper(v, '36A')).toMatchObject({
      status: 'not_applicable',
      notApplicableSource: 'person',
    });
    v = (
      await http()
        .post(`${base()}/clauses/${p.id}/reopen`)
        .set(pa)
        .send({ version: paper(v, '36A').version })
        .expect(200)
    ).body as TaxAuditWorkspace;
    expect(paper(v, '36A')).toMatchObject({ status: 'not_started', notApplicableReason: null });
  });

  it('the standard information list goes to the client once, as client requests', async () => {
    await http().post(`${base()}/information-requests`).set(art).send({}).expect(403);
    let v = (await http().post(`${base()}/information-requests`).set(pa).send({}).expect(200))
      .body as TaxAuditWorkspace;
    expect(v.requests).toHaveLength(10);
    expect(v.requests[0]).toMatchObject({ item: 'accounts', status: 'pending', documentCount: 0 });
    v = (await http().post(`${base()}/information-requests`).set(pa).send({}).expect(200))
      .body as TaxAuditWorkspace;
    expect(v.requests).toHaveLength(10);
    const { rows } = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.client_dependencies
        WHERE engagement_id = $1 AND tax_audit_id = $2`,
      [eng, auditId],
    );
    expect(rows[0]!.n).toBe(10);
  });

  it('a signed report closes the 3CD work', async () => {
    await su.query(`UPDATE hsdg.tax_audits SET stage = 'signed' WHERE id = $1`, [auditId]);
    const v = await view(art);
    expect(v.editable).toBe(false);
    const p = paper(v, '36A');
    expect(p.canPrepare).toBe(false);
    await http()
      .post(`${base()}/clauses/${p.id}/not-applicable`)
      .set(pa)
      .send({ version: p.version, reason: 'x' })
      .expect(400);
  });
});

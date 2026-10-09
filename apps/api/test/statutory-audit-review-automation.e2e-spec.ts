import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  type AuditProcedure,
  type StatutoryAuditReview,
  type StatutoryAuditWorkGeneration,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { answerSection01Clean, recommendSection01 } from './section01.helper';

/**
 * Review reads the file: each queued procedure / area carries pre-review
 * checks and suggested notes (raised in one click, dismissed for good); a note
 * raised from a suggestion says when the issue is fixed in the file; approve
 * and return are one step; a reviewed area leaves the queue until its
 * conclusion changes.
 */
describe('Statutory Audit — Review from the file (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let pb: string;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(url).set(bearer(t)).send(body);
  const get = (t: string, url: string) =>
    request(app.getHttpServer()).get(url).set(bearer(t)).expect(200);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  /** A released 03.5 library with two areas (the test DB ships none). */
  const seedLibrary = async (): Promise<void> => {
    const su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    try {
      const { rows } = await su.query(`SELECT 1 FROM hsdg.audit_area_library_release LIMIT 1`);
      if (rows[0]) return;
      await su.query(
        `INSERT INTO hsdg.audit_area_library_release (library_version, note)
         VALUES ('e2e-work-1', 'e2e') ON CONFLICT DO NOTHING`,
      );
      await su.query(
        `INSERT INTO hsdg.audit_area_library
           (library_version, area_code, area_name, area_type, category, default_assertions, aliases)
         VALUES ('e2e-work-1', 'CASH', 'Cash and bank balances', 'balance_sheet', 'assets',
                 ARRAY['BAL_EXIST','BAL_COMP'], ARRAY['Bank']),
                ('e2e-work-1', 'REV', 'Revenue from operations', 'profit_loss', 'income_expenses',
                 ARRAY['TX_OCC','TX_CUTOFF'], ARRAY['Sales'])`,
      );
    } finally {
      await su.end();
    }
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    await seedLibrary();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('checks queued work, suggests the notes and approves / returns in one step', async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Review Seed ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: itr,
      financialYear: '2024-25',
      periodLabel: `P${stamp()}`,
      status: 'accepted',
    }).expect(201);
    const engId = eng.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const shellId = (await get(pa, base)).body[0].workflowInstanceId as string;

    // Section 01 accepted, Section 02 approved.
    await answerSection01Clean(app, pa, engId);
    await recommendSection01(app, pa, engId, shellId);
    await post(pa, `${base}/${shellId}/acceptance/approve`, {
      conclusion: 'accept',
      memo: 'Accepted (e2e).',
    }).expect(201);
    const fw = await get(pa, `${base}/framework`);
    for (const a of fw.body[0].assessments as Array<{
      id: string;
      areaKey: string;
      version: number;
    }>) {
      await post(pa, `${base}/framework/${a.id}/decision`, {
        conclusion: a.areaKey === 'caro' ? 'applicable' : 'not_applicable',
        basis: 'E2E professional basis.',
        version: a.version,
      }).expect(201);
    }
    await post(pa, `${base}/${shellId}/framework/approve`, { memo: 'Approved (e2e).' }).expect(201);

    // A small file: the CARO workstream and overall responses, with procedures.
    const gen = (await get(pa, `${base}/work-areas`)).body[0] as StatutoryAuditWorkGeneration;
    const caro = gen.areas.find((a) => a.workAreaKey === 'caro')!;
    const procs = (await get(pa, `${base}/procedures`)).body[0].procedures as AuditProcedure[];
    // A CARO clause procedure from the 02.4 programme (spec §18).
    const clauses = procs.find((p) => p.sourceKey === 'caro:CARO_2020_3_I_B')!;
    const review = async (): Promise<StatutoryAuditReview> =>
      (await get(pa, `${base}/review`)).body[0] as StatutoryAuditReview;
    const decide = (body: Record<string, unknown>) =>
      post(pa, `${base}/${shellId}/review/decide`, body);
    const procVersion = async (id: string): Promise<number> =>
      ((await get(pa, `${base}/procedures`)).body[0].procedures as AuditProcedure[]).find(
        (p) => p.id === id,
      )!.version;

    // The preparer sends it for review with no conclusion and no evidence.
    await post(pa, `${base}/procedures/${clauses.id}/state`, {
      state: 'ready_for_review',
      version: clauses.version,
    }).expect(201);
    let r = await review();
    let item = r.queue.find((q) => q.targetId === clauses.id)!;
    expect(item.checks.map((c) => [c.key, c.ok])).toEqual([
      ['objective', true],
      ['conclusion', false],
      ['evidence', false],
      ['exceptions', true],
    ]);
    expect(item.ready).toBe(false);
    expect(item.isMine).toBe(true); // the partner reviews it
    expect(r.forMe.toReview).toBeGreaterThanOrEqual(1);
    expect(item.suggestedNotes.map((n) => [n.sourceKey, n.isBlocking])).toEqual([
      [`proc:${clauses.id}:conclusion`, true],
      [`proc:${clauses.id}:evidence`, false],
    ]);

    // Approving work without a conclusion is refused by the completion rules.
    await decide({ targetType: 'procedure', targetId: clauses.id, decision: 'approve' }).expect(
      400,
    );

    // Raise the suggestions in one click; they are no longer offered.
    r = (
      await post(pa, `${base}/${shellId}/review/suggestions/raise`, {
        targetId: clauses.id,
      }).expect(201)
    ).body as StatutoryAuditReview;
    item = r.queue.find((q) => q.targetId === clauses.id)!;
    expect(item.suggestedNotes).toEqual([]);
    expect(item.openNotes).toBe(2);
    expect(r.summary.blockingOpenNotes).toBe(1);
    // Live notes stop approval.
    await decide({ targetType: 'procedure', targetId: clauses.id, decision: 'approve' }).expect(
      409,
    );

    // Return it — the raised notes go back with it.
    r = (
      await decide({ targetType: 'procedure', targetId: clauses.id, decision: 'return' }).expect(
        201,
      )
    ).body as StatutoryAuditReview;
    expect(r.queue.some((q) => q.targetId === clauses.id)).toBe(false);

    // The preparer fixes the conclusion: that note says it is fixed in the file.
    await post(pa, `${base}/procedures/${clauses.id}`, {
      conclusion: 'All 21 CARO clauses worked through; no adverse reporting required.',
      version: await procVersion(clauses.id),
    }).expect(201);
    r = await review();
    const note = (key: string) => r.notes.find((n) => n.sourceKey === `proc:${clauses.id}:${key}`)!;
    expect(note('conclusion').resolvedInFile).toBe(true);
    expect(note('evidence').resolvedInFile).toBe(false);

    // Clear both; the evidence suggestion comes back until it is dismissed.
    for (const key of ['conclusion', 'evidence']) {
      await post(pa, `${base}/review/notes/${note(key).id}/clear`, {
        version: note(key).version,
      }).expect(201);
    }
    await post(pa, `${base}/procedures/${clauses.id}/state`, {
      state: 'ready_for_review',
      version: await procVersion(clauses.id),
    }).expect(201);
    r = await review();
    item = r.queue.find((q) => q.targetId === clauses.id)!;
    expect(item.suggestedNotes.map((n) => n.sourceKey)).toEqual([`proc:${clauses.id}:evidence`]);
    r = (
      await post(pa, `${base}/${shellId}/review/suggestions/dismiss`, {
        sourceKey: `proc:${clauses.id}:evidence`,
      }).expect(201)
    ).body as StatutoryAuditReview;
    expect(r.queue.find((q) => q.targetId === clauses.id)!.suggestedNotes).toEqual([]);

    // Approve in one step → the procedure is complete.
    r = (
      await decide({ targetType: 'procedure', targetId: clauses.id, decision: 'approve' }).expect(
        201,
      )
    ).body as StatutoryAuditReview;
    expect(r.queue.some((q) => q.targetId === clauses.id)).toBe(false);
    expect(
      ((await get(pa, `${base}/procedures`)).body[0].procedures as AuditProcedure[]).find(
        (p) => p.id === clauses.id,
      )!.state,
    ).toBe('complete');

    // An area: submitted, returned with a typed note, resubmitted, approved.
    const submit = async (conclusion: string): Promise<void> => {
      const g = (await get(pa, `${base}/work-areas`)).body[0] as StatutoryAuditWorkGeneration;
      const a = g.areas.find((x) => x.id === caro.id)!;
      await post(pa, `${base}/areas/${caro.id}/detail`, {
        conclusion,
        conclusionState: 'submitted',
        detailVersion: a.detail.detailVersion,
      }).expect(201);
    };
    await submit('CARO reporting concluded; see clause working.');
    r = await review();
    const areaItem = r.queue.find((q) => q.targetId === caro.id)!;
    expect(areaItem.checks[0]).toMatchObject({ key: 'procedures', ok: false });
    await decide({ targetType: 'work_area', targetId: caro.id, decision: 'return' }).expect(400);
    r = (
      await decide({
        targetType: 'work_area',
        targetId: caro.id,
        decision: 'return',
        note: 'Finish the statutory dues procedure first.',
      }).expect(201)
    ).body as StatutoryAuditReview;
    expect(r.queue.some((q) => q.targetId === caro.id)).toBe(false);
    const typed = r.notes.find((n) => n.body === 'Finish the statutory dues procedure first.')!;
    expect(typed.sourceKey).toBeNull();
    await post(pa, `${base}/review/notes/${typed.id}/clear`, { version: typed.version }).expect(
      201,
    );

    await submit('CARO reporting concluded; see clause working.');
    r = (
      await decide({ targetType: 'work_area', targetId: caro.id, decision: 'approve' }).expect(201)
    ).body as StatutoryAuditReview;
    expect(r.queue.some((q) => q.targetId === caro.id)).toBe(false);
    // Changing a reviewed conclusion puts it back in the queue.
    await submit('CARO reporting concluded; clause 3(vii) updated after review.');
    expect((await review()).queue.some((q) => q.targetId === caro.id)).toBe(true);

    // An outsider cannot decide.
    const res = await post(pb, `${base}/${shellId}/review/decide`, {
      targetType: 'work_area',
      targetId: caro.id,
      decision: 'approve',
    });
    expect([403, 404]).toContain(res.status);
  }, 30_000);
});

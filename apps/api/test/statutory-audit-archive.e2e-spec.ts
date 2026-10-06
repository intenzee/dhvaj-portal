import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { ACCEPTANCE_QUESTIONS, type StatutoryAuditCompletion } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Section 10 — archiving reads the signed-off file: the assembly deadline and
 * retention from the report date, the UDIN, what archiving would freeze and
 * what next year's file brings forward; the drafted archive note is recorded
 * when none is typed. Kept apart from the Section 07 suite (which stops at 09).
 *
 * Section 07 / 08 — the completion and reporting checklist keeps itself in
 * line with the file: reports the framework rules out are not applicable,
 * items follow their linked procedures, notes and the completion memo are
 * drafted, and nothing a person set is ever re-drafted.
 */
describe('Statutory Audit — Section 10 archiving from the file (e2e)', () => {
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

  it('archives a signed-off file with its deadlines, UDIN and drafted note', async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Archive Seed ${stamp()}`,
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
    const acc = await get(pa, `${base}/acceptance`);
    const segIdByKey = new Map(
      (acc.body[0].segments as Array<{ id: string; segmentKey: string }>).map((s) => [
        s.segmentKey,
        s.id,
      ]),
    );
    for (const q of ACCEPTANCE_QUESTIONS) {
      const segmentId = segIdByKey.get(q.segmentKey);
      if (!segmentId) continue;
      await post(pa, `${base}/acceptance/segments/${segmentId}/answer`, {
        questionKey: q.questionKey,
        answer: q.adverseAnswer === 'no' ? 'yes' : 'no',
      }).expect(201);
    }
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

    // A small file: the framework workstreams only (no 03.5 population).
    const work = (await get(pa, `${base}/work-areas`)).body[0] as {
      areas: Array<{ id: string; isActive: boolean; detail: { detailVersion: number } }>;
    };
    const read = async (): Promise<StatutoryAuditCompletion> =>
      (await get(pa, `${base}/completion`)).body[0] as StatutoryAuditCompletion;
    const chk = (c: StatutoryAuditCompletion, key: string) =>
      c.archivePack.checks.find((x) => x.key === key)!;

    // Before sign-off the archive pack says why it can't archive yet.
    let c = await read();
    expect(c.archivePack.ready).toBe(false);
    expect(chk(c, 'signed_off')).toMatchObject({
      ok: false,
      blocking: true,
      goTo: { phaseKey: 'sign_off' },
    });
    expect(c.archivePack.assemblyDueBy).toBeNull();

    // Close the file: every item resolved, every area concluded, signed off.
    for (const i of c.items) {
      await post(pa, `${base}/completion/items/${i.id}`, {
        state: 'complete',
        version: i.version,
      }).expect(201);
    }
    for (const a of work.areas.filter((x) => x.isActive)) {
      await post(pa, `${base}/areas/${a.id}/detail`, {
        conclusion: 'Concluded (e2e).',
        conclusionState: 'submitted',
        detailVersion: a.detail.detailVersion,
      }).expect(201);
    }
    await post(pa, `${base}/${shellId}/completion/approve`, {}).expect(201);
    await post(pa, `${base}/${shellId}/sign-off`, {}).expect(201);

    c = await read();
    const today = new Date().toISOString().slice(0, 10);
    expect(c.archivePack.ready).toBe(true);
    expect(c.reportDate).toBe(today);
    expect(c.archivePack.daysToAssemble).toBe(60);
    // Every procedure is still open — archiving would freeze them.
    expect(chk(c, 'loose_ends').ok).toBe(false);
    expect(chk(c, 'loose_ends').facts[0]).toBe(
      'Archiving freezes these as they are — close them first:',
    );
    expect(chk(c, 'udin').ok).toBe(false);

    // Bad UDIN and a future report date are refused.
    await post(pa, `${base}/${shellId}/archive`, { udin: 'NOT-A-UDIN' }).expect(400);
    await post(pa, `${base}/${shellId}/archive`, { reportDate: '2999-01-01' }).expect(400);
    // An outsider cannot archive.
    const res = await post(pb, `${base}/${shellId}/archive`, {});
    expect([400, 403, 404]).toContain(res.status);

    // Archive with the report date and UDIN, no note → the drafted note.
    const reportDate = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const archived = (
      await post(pa, `${base}/${shellId}/archive`, {
        reportDate,
        udin: '25123456abcdefghij',
      }).expect(201)
    ).body as StatutoryAuditCompletion;
    const y = Number(reportDate.slice(0, 4)) + 7;
    expect(archived).toMatchObject({
      reportDate,
      udin: '25123456ABCDEFGHIJ',
      retainUntil: `${y}${reportDate.slice(4)}`,
      status: 'archived',
    });
    expect(archived.gate.archived).toBe(true);
    expect(archived.archivePack.ready).toBe(false);
    expect(archived.archivePack.daysToAssemble).toBe(50);
    expect(archived.archiveNote).toMatch(/^Final audit file for financial year 2024-25/);
    expect(archived.archiveNote).toContain('10 day(s) after the auditor');
    expect(archived.archiveNote).toContain('UDIN 25123456ABCDEFGHIJ');
    expect(archived.archiveNote).toContain(`Retained until ${archived.retainUntil}`);

    // Locked: archiving again is refused.
    await post(pa, `${base}/${shellId}/archive`, {}).expect(400);
  }, 30_000);
});

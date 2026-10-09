import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  type AuditCompletionItem,
  type AuditProcedure,
  type StatutoryAuditCompletion,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { answerSection01Clean, recommendSection01 } from './section01.helper';

/**
 * Section 07 / 08 — the completion and reporting checklist keeps itself in
 * line with the file: reports the framework rules out are not applicable,
 * items follow their linked procedures, notes and the completion memo are
 * drafted, and nothing a person set is ever re-drafted.
 */
describe('Statutory Audit — Section 07 completion from the file (e2e)', () => {
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

  it('drafts the checklist from the file and keeps what the team sets', async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Completion Seed ${stamp()}`,
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

    // 03.5 populated from the library.
    await post(pa, `${base}/${shellId}/audit-areas/populate`, {}).expect(201);

    // Opening the audit work builds the procedures.
    await get(pa, `${base}/work-areas`);
    const procs = (await get(pa, `${base}/procedures`)).body[0].procedures as AuditProcedure[];

    const read = async (): Promise<StatutoryAuditCompletion> =>
      (await get(pa, `${base}/completion`)).body[0] as StatutoryAuditCompletion;
    const item = (c: StatutoryAuditCompletion, key: string): AuditCompletionItem =>
      c.items.find((i) => i.itemKey === key)!;

    // First open: framework facts flow in.
    let c = await read();
    expect(item(c, 'ifc')).toMatchObject({ state: 'not_applicable', stateSuggested: true });
    expect(item(c, 'ifc').note).toMatch(/^Not applicable — Section 02 framework/);
    expect(item(c, 'other_reports').state).toBe('not_applicable');
    expect(item(c, 'caro')).toMatchObject({ state: 'not_started', noteSuggested: true });
    expect(item(c, 'caro').evidence.facts[0]).toBe('Section 02: CARO 2020 applicable.');
    expect(item(c, 'subsequent_events').evidence.goTo?.phaseKey).toBe('audit_areas');
    expect(item(c, 'completion_memo').note).toMatch(/^Completion memo — financial year 2024-25/);
    expect(c.items.every((i) => i.state !== 'complete')).toBe(true);

    // Starting the linked procedure moves the item along.
    // (The overall SA 560 step, or the 03.5 Subsequent Events area's own.)
    const se = procs.find(
      (p) =>
        p.sourceKey === 'std:overall_responses:subsequent_events' ||
        p.sourceKey === 'fs:fs_subseq:substantive',
    )!;
    await post(pa, `${base}/procedures/${se.id}/state`, {
      state: 'in_progress',
      version: se.version,
    }).expect(201);
    await post(pa, `${base}/procedures/${se.id}/exceptions`, {
      description: 'Post-year-end write-off not adjusted',
      severity: 'high',
      status: 'carried_forward',
    }).expect(201);
    const refreshed = await post(pa, `${base}/${shellId}/completion/suggest`, {}).expect(201);
    c = refreshed.body.completion as StatutoryAuditCompletion;
    expect(refreshed.body.itemsUpdated).toBeGreaterThan(0);
    expect(item(c, 'subsequent_events').state).toBe('in_progress');
    expect(item(c, 'subsequent_events').note).toContain(se.procedureRef);
    expect(item(c, 'misstatements').note).toContain('Post-year-end write-off not adjusted (high)');

    // What a person sets is theirs: neither the state nor the note is re-drafted.
    const caro = item(c, 'caro');
    await post(pa, `${base}/completion/items/${caro.id}`, {
      state: 'in_progress',
      note: 'Our own CARO wording.',
      version: caro.version,
    }).expect(201);
    const ifc = item(c, 'ifc');
    await post(pa, `${base}/completion/items/${ifc.id}`, {
      state: 'not_started',
      version: ifc.version,
    }).expect(201);
    await post(pa, `${base}/${shellId}/completion/suggest`, {}).expect(201);
    c = await read();
    expect(item(c, 'caro')).toMatchObject({
      state: 'in_progress',
      note: 'Our own CARO wording.',
      stateSuggested: false,
      noteSuggested: false,
    });
    expect(item(c, 'ifc').state).toBe('not_started');

    // Completion approved without typing a memo → the drafted memo is used.
    for (const i of c.items.filter((x) => x.section === 'completion')) {
      await post(pa, `${base}/completion/items/${i.id}`, {
        state: 'complete',
        version: i.version,
      }).expect(201);
    }
    const memo = item(await read(), 'completion_memo').note;
    const approved = await post(pa, `${base}/${shellId}/completion/approve`, {}).expect(201);
    expect(approved.body.completionMemo).toBe(memo);

    // Section 09: the sign-off pack reads the file and says what is left.
    const pack = (approved.body as StatutoryAuditCompletion).signOffPack;
    const chk = (key: string) => pack.checks.find((x) => x.key === key)!;
    expect(chk('completion_approved').ok).toBe(true);
    expect(chk('reporting_resolved')).toMatchObject({
      ok: false,
      blocking: true,
      goTo: { phaseKey: 'reporting' },
    });
    expect(chk('misstatements').facts[1]).toContain('Post-year-end write-off not adjusted');
    expect(pack.ready).toBe(false);
    expect(pack.draftMemo).toMatch(/^Partner sign-off — financial year 2024-25/);
    const phases = (await get(pa, base)).body[0].phases as Array<{
      phaseKey: string;
      state: string;
    }>;
    expect(phases.find((p) => p.phaseKey === 'sign_off')?.state).toBe('in_progress');

    // An outsider cannot refresh the checklist.
    const res = await post(pb, `${base}/${shellId}/completion/suggest`, {});
    expect([403, 404]).toContain(res.status);
    // Builds a whole file end to end (01 → 07/09), so it needs more than jest's 5s.
  }, 30_000);
});

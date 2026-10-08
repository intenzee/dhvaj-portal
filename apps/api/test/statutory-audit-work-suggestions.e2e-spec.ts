import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  ACCEPTANCE_QUESTIONS,
  type AuditProcedure,
  type AuditWorkArea,
  type StatutoryAuditWorkGeneration,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Section 05 / 06 — the audit work builds itself once the framework is
 * approved: work areas for the framework workstreams, each 03.5 area and the
 * overall responses; blank area detail filled from the engagement; and
 * suggested procedures (risk responses, area and workstream programmes). A
 * deleted suggestion is never suggested again.
 */
describe('Statutory Audit — Section 05 suggested work (e2e)', () => {
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

  it('builds the work on first open, fills area detail and never re-suggests a deleted procedure', async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Work Seed ${stamp()}`,
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

    // 03.5 populated from the library.
    await post(pa, `${base}/${shellId}/audit-areas/populate`, {}).expect(201);

    // A member who is not a lead reads without building anything.
    const outsider = await request(app.getHttpServer()).get(`${base}/work-areas`).set(bearer(pb));
    expect([200, 403, 404]).toContain(outsider.status);
    if (outsider.status === 200) expect(outsider.body).toEqual([]);

    // First open by the lead builds the work — no "Generate" click.
    const gen = (await get(pa, `${base}/work-areas`)).body[0] as StatutoryAuditWorkGeneration;
    const byKey = new Map(gen.areas.map((a) => [a.workAreaKey, a] as [string, AuditWorkArea]));
    expect(byKey.get('caro')?.isActive).toBe(true);
    expect(byKey.get('overall_responses')?.isActive).toBe(true);
    expect(byKey.get('fs_cash')?.title).toBe('Cash & Bank');
    expect(byKey.get('fs_rev')?.source).toBe('planning:03.5');
    // Area detail filled from the engagement's leads.
    for (const a of gen.areas.filter((x) => x.isActive)) {
      expect(a.detail.ownerEmployeeId).not.toBeNull();
      expect(a.detail.reviewerEmployeeId).not.toBeNull();
    }
    expect(byKey.get('fs_cash')?.detail.riskLevel).toBe('low');
    // The SA 240 revenue presumption lands on the revenue area → significant.
    expect(byKey.get('fs_rev')?.detail.riskLevel).toBe('significant');

    const procs = (await get(pa, `${base}/procedures`)).body[0].procedures as AuditProcedure[];
    const bySource = new Map(procs.map((p) => [p.sourceKey, p]));
    const revRisk = procs.find((p) => p.riskId && p.linkedAreas[0]?.workAreaKey === 'fs_rev');
    expect(revRisk?.sourceNote).toMatch(/^Section 04 risk R\d+ \(significant\)$/);
    expect(revRisk?.objective).toMatch(/Cut-off testing/);
    const override = procs.find((p) => p.riskId && p.linkedAreas[0]?.workAreaKey === 'fs_je');
    expect(override?.title).toMatch(/management override/i);
    expect(bySource.has('fs:fs_cash:substantive')).toBe(true);
    expect(bySource.has('fs:fs_cash:confirm')).toBe(true);
    expect(bySource.has('fs:fs_rev:cutoff')).toBe(true);
    expect(bySource.has('std:caro:clauses')).toBe(true);
    expect(bySource.has('std:ifc:walkthroughs')).toBe(false); // IFC not applicable
    expect(procs.every((p) => p.ownerEmployeeId && p.reviewerEmployeeId)).toBe(true);

    // The team deletes a suggestion; a refresh never brings it back.
    const confirm = bySource.get('fs:fs_cash:confirm')!;
    await request(app.getHttpServer())
      .delete(`${base}/procedures/${confirm.id}`)
      .set(bearer(pa))
      .expect(200);
    const again = await post(pa, `${base}/${shellId}/work-areas/suggest`, {}).expect(201);
    expect(again.body.proceduresAdded).toBe(0);
    expect(again.body.areasAdded).toBe(0);
    const after = (await get(pa, `${base}/procedures`)).body[0].procedures as AuditProcedure[];
    expect(after.some((p) => p.sourceKey === 'fs:fs_cash:confirm')).toBe(false);
    expect(after).toHaveLength(procs.length - 1);

    // What the team typed is never overwritten by a refresh.
    const cash = (again.body.generation as StatutoryAuditWorkGeneration).areas.find(
      (a) => a.workAreaKey === 'fs_cash',
    )!;
    await post(pa, `${base}/areas/${cash.id}/detail`, {
      riskLevel: 'high',
      detailVersion: cash.detail.detailVersion,
    }).expect(201);
    const kept = await post(pa, `${base}/${shellId}/work-areas/suggest`, {}).expect(201);
    expect(
      (kept.body.generation as StatutoryAuditWorkGeneration).areas.find(
        (a) => a.workAreaKey === 'fs_cash',
      )?.detail.riskLevel,
    ).toBe('high');

    // ── The pack: what finishing the work needs, with a link to the area.
    const gen2 = kept.body.generation as StatutoryAuditWorkGeneration;
    const packCheck = (key: string) => gen2.pack.checks.find((c) => c.key === key)!;
    expect(gen2.pack.ready).toBe(false);
    expect(packCheck('procedures_complete').goTo?.anchor).toMatch(/^area-/);
    expect(packCheck('significant_risks').ok).toBe(false);
    // IFC is not applicable here, so Section 05 has nothing to do.
    expect(gen2.controlsPack.ready).toBe(true);

    // Complete the CARO procedures; a blank submission records the drafted conclusion.
    const caro = gen2.areas.find((a) => a.workAreaKey === 'caro')!;
    const caroProcs = after.filter((p) => p.linkedAreas[0]?.workAreaId === caro.id);
    expect(caroProcs.length).toBeGreaterThan(0);
    // Not while procedures are open.
    await post(pa, `${base}/areas/${caro.id}/detail`, {
      conclusionState: 'submitted',
      detailVersion: caro.detail.detailVersion,
    }).expect(400);
    for (const p of caroProcs) {
      const upd = await post(pa, `${base}/procedures/${p.id}`, {
        objective: p.objective ?? 'CARO clause reporting.',
        conclusion: `${p.title} — reported.`,
        version: p.version,
      }).expect(201);
      const v = (upd.body.procedures as AuditProcedure[]).find((x) => x.id === p.id)!.version;
      await post(pa, `${base}/procedures/${p.id}/state`, { state: 'complete', version: v }).expect(
        201,
      );
    }
    let caroNow = (
      (await get(pa, `${base}/work-areas`)).body[0] as StatutoryAuditWorkGeneration
    ).areas.find((a) => a.id === caro.id)!;
    expect(caroNow.draftConclusion?.split('\n').at(-1)).toMatch(
      /^Conclusion: based on the procedures performed/,
    );
    const submitted = await post(pa, `${base}/areas/${caro.id}/detail`, {
      conclusionState: 'submitted',
      detailVersion: caroNow.detail.detailVersion,
    }).expect(201);
    caroNow = (submitted.body as StatutoryAuditWorkGeneration).areas.find((a) => a.id === caro.id)!;
    expect(caroNow.detail.conclusionState).toBe('submitted');
    expect(caroNow.detail.conclusion).toBe(caroNow.draftConclusion);
    expect(
      (submitted.body as StatutoryAuditWorkGeneration).pack.checks
        .find((c) => c.key === 'conclusions_reviewed')!
        .facts.join(' '),
    ).toContain(caro.title);

    // An outsider cannot build or refresh work.
    const res = await post(pb, `${base}/${shellId}/work-areas/suggest`, {});
    expect([403, 404]).toContain(res.status);
  });
});

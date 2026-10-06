import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  ACCEPTANCE_QUESTIONS,
  type AuditProcedure,
  type StatutoryAuditReassessment,
  type StatutoryAuditWorkGeneration,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Reassessment detects changes in the file: a moved completion date (raised in
 * one click, moving the due dates still on the old date) and a significant
 * risk with no response (dismissed for good). A raised detection carries its
 * key, is not offered again, and says when it is ready to resolve.
 */
describe('Statutory Audit — Reassessment from the file (e2e)', () => {
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

  it('detects changes, raises one in a click with its follow-through and dismisses another', async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Reassess Seed ${stamp()}`,
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
      plannedEndDate: '2025-09-30',
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

    // The audit work: every area and procedure due on the planned end date.
    await get(pa, `${base}/work-areas`);
    const read = async (): Promise<StatutoryAuditReassessment> =>
      (await get(pa, `${base}/reassessments`)).body[0] as StatutoryAuditReassessment;
    let r = await read();
    expect(r.detections.some((d) => d.key.startsWith('date:'))).toBe(false);

    // The planned completion moves → detected, with what raising it does.
    await request(app.getHttpServer())
      .patch(`/api/v1/engagements/${engId}`)
      .set(bearer(pa))
      .send({ plannedEndDate: '2025-10-31' })
      .expect(200);
    r = await read();
    const date = r.detections.find((d) => d.key === 'date:2025-09-30->2025-10-31')!;
    expect(date).toMatchObject({
      changeType: 'reporting_date_changed',
      followThrough:
        'Moves the due dates on 2025-09-30 to 2025-10-31 (the original date stays in this record).',
    });

    // Raise it in one click — no type or reason typed.
    r = (await post(pa, `${base}/${shellId}/reassessments`, { detectionKey: date.key }).expect(201))
      .body as StatutoryAuditReassessment;
    const ev = r.events.find((e) => e.detectionKey === date.key)!;
    expect(ev).toMatchObject({
      changeType: 'reporting_date_changed',
      status: 'open',
      readyToResolve: true,
    });
    expect(ev.reason).toBe(date.reason);
    expect(ev.affectedSummary).toMatch(/due dates moved from 2025-09-30 to 2025-10-31/);
    expect(r.detections.some((d) => d.key === date.key)).toBe(false);
    const gen = (await get(pa, `${base}/work-areas`)).body[0] as StatutoryAuditWorkGeneration;
    expect(
      gen.areas.filter((a) => a.isActive).every((a) => a.detail.dueDate === '2025-10-31'),
    ).toBe(true);
    const procs = (await get(pa, `${base}/procedures`)).body[0].procedures as AuditProcedure[];
    expect(procs.every((p) => p.dueDate === '2025-10-31')).toBe(true);
    // The same change cannot be raised twice.
    await post(pa, `${base}/${shellId}/reassessments`, { detectionKey: date.key }).expect(409);

    // A new significant risk with no response → detected; dismissed for good.
    await post(pa, `${base}/${shellId}/risks`, {
      description: 'Undisclosed related-party sales channel',
      source: 'fraud',
      rating: 'significant',
      isSignificant: true,
    }).expect(201);
    r = await read();
    const risk = r.detections.find((d) => d.changeType === 'risk_changed')!;
    expect(risk.reason).toMatch(/has no procedure responding to it/);
    r = (
      await post(pa, `${base}/${shellId}/reassessments/detections/dismiss`, {
        detectionKey: risk.key,
      }).expect(201)
    ).body as StatutoryAuditReassessment;
    expect(r.detections.some((d) => d.key === risk.key)).toBe(false);

    // A manual raise still needs a type and reason; an unknown detection is refused.
    await post(pa, `${base}/${shellId}/reassessments`, { reason: 'Something changed.' }).expect(
      400,
    );
    await post(pa, `${base}/${shellId}/reassessments`, { detectionKey: 'date:nope' }).expect(409);

    // An outsider cannot dismiss.
    const res = await post(pb, `${base}/${shellId}/reassessments/detections/dismiss`, {
      detectionKey: 'x',
    });
    expect([403, 404]).toContain(res.status);
  }, 30_000);
});

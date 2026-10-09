import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  type AuditPbcItem,
  type PbcSuggestionResult,
  type StatutoryAuditPbc,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { answerSection01Clean, recommendSection01 } from './section01.helper';

/**
 * PBC — the tracker builds itself once Planning is approved: the standard
 * list, requests for the 03.5 areas and Section 04 risks, and the completion
 * stage, each linked, owned and dated. Linking a received document moves a
 * request to Received; the chase list drafts a reminder per client contact;
 * a deleted suggestion never comes back.
 */
describe('Statutory Audit — PBC tracker from the file (e2e)', () => {
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

  /** Superuser helper — rows the API has no endpoint for in this test. */
  const su = async (sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      return (await c.query(sql, params)).rows;
    } finally {
      await c.end();
    }
  };

  it('builds the tracker on first open, chases the client and never re-suggests a deleted request', async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `PBC Seed ${stamp()}`,
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

    // The client's CFO, with an email, answers the finance requests.
    await su(
      `INSERT INTO hsdg.entity_contacts
         (entity_id, full_name, designation, contact_type, email, is_primary, is_signatory,
          is_portal_user)
       VALUES ($1, 'Asha Rao', 'CFO', 'cfo', 'asha@example.in', true, false, false)`,
      [entity.body.id],
    );
    // The audit work (03.5 areas, Section 04 risks) is built on first open.
    await get(pa, `${base}/work-areas`);

    // Before Planning is approved, opening the tracker builds nothing.
    let t = (await get(pa, `${base}/pbc`)).body[0] as StatutoryAuditPbc;
    expect(t.items).toHaveLength(0);

    await su(
      `INSERT INTO hsdg.audit_planning_approvals
         (workflow_instance_id, engagement_id, version, memo, snapshot)
       VALUES ($1, $2, 1, 'Approved (e2e).', '{}'::jsonb)`,
      [shellId, engId],
    );

    // A member who is not a lead reads without building anything.
    const outsider = await request(app.getHttpServer()).get(`${base}/pbc`).set(bearer(pb));
    expect([200, 403, 404]).toContain(outsider.status);

    // First open by the lead builds the tracker — no button.
    t = (await get(pa, `${base}/pbc`)).body[0] as StatutoryAuditPbc;
    const byKey = new Map(t.items.map((i) => [i.sourceKey, i] as [string | null, AuditPbcItem]));
    const bank = t.items.find((i) => /^Bank statements/.test(i.requirement))!;
    expect(bank).toMatchObject({
      clientOwner: 'Asha Rao (CFO)',
      workAreaTitle: 'Cash & Bank',
      sourceNote: 'Standard request list (client master)',
      status: 'requested',
    });
    expect(byKey.get('area:fs_rev:cutoff')?.workAreaTitle).toBe('Revenue');
    expect(byKey.get('risk:journal_entries')?.sourceNote).toMatch(/^Section 04 risk R\d+/);
    const rep = byKey.get('stage:rep_letter')!;
    expect(rep.dueDate! > bank.dueDate!).toBe(true);
    expect(t.items.every((i) => i.dueDate && i.sourceKey)).toBe(true);
    expect(t.summary.outstanding).toBe(t.items.length);
    expect(t.chase).toHaveLength(0); // nothing due yet

    // Linking the received document is the receipt.
    const [doc] = await su(
      `INSERT INTO hsdg.documents (engagement_id, title) VALUES ($1, 'Bank statements FY25')
       RETURNING id`,
      [engId],
    );
    t = (
      await post(pa, `${base}/pbc/${bank.id}`, {
        documentId: doc!.id,
        version: bank.version,
      }).expect(201)
    ).body as StatutoryAuditPbc;
    const received = t.items.find((i) => i.id === bank.id)!;
    expect(received.status).toBe('received');
    expect(received.receivedDate).toBe(new Date().toISOString().slice(0, 10));
    expect(t.summary.toReview).toBe(1);

    // An overdue request lands in the chase list, drafted to the CFO.
    const cutoff = byKey.get('area:fs_rev:cutoff')!;
    await post(pa, `${base}/pbc/${cutoff.id}`, {
      dueDate: '2025-01-15',
      version: cutoff.version,
    }).expect(201);
    t = (await get(pa, `${base}/pbc`)).body[0] as StatutoryAuditPbc;
    const [chase] = t.chase;
    expect(chase).toMatchObject({ owner: 'Asha Rao (CFO)', email: 'asha@example.in', overdue: 1 });
    expect(chase!.pbcIds).toEqual([cutoff.id]);
    expect(chase!.body).toMatch(/^Dear Asha,/);
    t = (await post(pa, `${base}/${shellId}/pbc/chased`, { pbcIds: chase!.pbcIds }).expect(201))
      .body as StatutoryAuditPbc;
    expect(t.chase[0]!.lastChasedOn).toBe(new Date().toISOString().slice(0, 10));

    // The team deletes a suggestion; a refresh never brings it back.
    await request(app.getHttpServer()).delete(`${base}/pbc/${rep.id}`).set(bearer(pa)).expect(200);
    const again = (await post(pa, `${base}/${shellId}/pbc/suggest`, {}).expect(201))
      .body as PbcSuggestionResult;
    expect(again.added).toBe(0);
    expect(again.tracker.items.some((i) => i.sourceKey === 'stage:rep_letter')).toBe(false);

    // A request typed by hand gets a blank owner and area filled, never overwritten.
    const typed = (
      await post(pa, `${base}/${shellId}/pbc`, {
        requirement: 'Debtor confirmations for top 20 parties',
      }).expect(201)
    ).body as StatutoryAuditPbc;
    const mine = typed.items.find((i) => /^Debtor confirmations/.test(i.requirement))!;
    expect(mine.clientOwner).toBeNull();
    const filled = (await post(pa, `${base}/${shellId}/pbc/suggest`, {}).expect(201))
      .body as PbcSuggestionResult;
    expect(filled.filled).toBeGreaterThan(0);
    const after = filled.tracker.items.find((i) => i.id === mine.id)!;
    expect(after.clientOwner).toBe('Asha Rao (CFO)');
    expect(after.dueDate).not.toBeNull();

    // An outsider cannot refresh or chase.
    const res = await post(pb, `${base}/${shellId}/pbc/suggest`, {});
    expect([403, 404]).toContain(res.status);
  }, 30_000);
});

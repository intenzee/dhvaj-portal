import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

interface Hit {
  group: string;
  id: string;
  title: string;
  href: string;
  link: { instanceId?: string; taskId?: string } | null;
}
interface Res {
  understood: { text: string[]; forms: string[]; period: string | null };
  groups: { group: string; items: Hit[] }[];
}

/**
 * Staff Workflow WF-304 — Ctrl K. "<client> gstr1 sep" finds that client's
 * September GSTR-1 first, and every hit opens the exact place. Each group
 * reads through RLS: a partner never finds another office's engagement, its
 * filings, tasks or documents. Behind ff_filing_runs (North only here).
 */
describe('Search (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;
  let managerX: string;
  let ruleCode: string;
  const tag = `qz${Date.now().toString(36)}`;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const search = async (t: string, q: string): Promise<Res> =>
    (
      await http()
        .get(`/api/v1/search?q=${encodeURIComponent(q)}`)
        .set(bearer(t))
        .expect(200)
    ).body as Res;
  const group = (res: Res, g: string): Hit[] => res.groups.find((x) => x.group === g)?.items ?? [];
  const ids = (res: Res, g: string): string[] => group(res, g).map((h) => h.id);

  /** A Compliance engagement on a fresh client named `name`, with its September GSTR-1. */
  const filing = async (
    lead: string,
    seeded: string,
    name: string,
    manager?: string,
  ): Promise<{ eng: string; inst: string; entity: string }> => {
    const entity = await freshClient(
      (await http().get(`/api/v1/entities?search=${seeded}&limit=100`).set(bearer(mp))).body
        .items[0].id as string,
    );
    await su.query(`UPDATE hsdg.entities SET legal_name = $2 WHERE id = $1`, [entity, name]);
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(lead))
        .send({
          entityId: entity,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `SR${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    if (manager)
      await http()
        .patch(`/api/v1/engagements/${eng}`)
        .set(bearer(mp))
        .send({ engagementManagerEmployeeId: manager })
        .expect(200);
    const inst = (
      await http()
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(lead))
        .send({ complianceRuleCode: ruleCode, referenceDate: '2026-09-30' })
        .expect(201)
    ).body.id as string;
    const gstin = `19AAAS${unique().slice(-9)}`.slice(0, 15).padEnd(15, 'Z');
    const reg = await su.query<{ id: string }>(
      `INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code)
       VALUES ($1,'gstin',$2,'19') RETURNING id`,
      [entity, gstin],
    );
    await su.query(
      `UPDATE hsdg.compliance_instances
          SET registration_id = $2, section = 'outward', financial_year = '2026-27',
              period_key = '2026-09', period_start = '2026-09-01', period_end = '2026-09-30',
              statutory_deadline = '2026-10-11', internal_sla_override = '2026-10-08'
        WHERE id = $1`,
      [inst, reg.rows[0]!.id],
    );
    return { eng, inst, entity };
  };

  let north: { eng: string; inst: string; entity: string };
  let south: { eng: string; inst: string; entity: string };
  let northTask: string;
  let northDoc: string;
  let southDoc: string;

  const doc = async (eng: string, inst: string, title: string): Promise<string> =>
    (
      await su.query<{ id: string }>(
        `INSERT INTO hsdg.documents (engagement_id, title, document_type, compliance_instance_id,
                                     period_section, slot_code)
         VALUES ($1, $2, 'evidence', $3, 'outward', 'BANK_STATEMENT') RETURNING id`,
        [eng, title, inst],
      )
    ).rows[0]!.id;

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    process.env.FEATURE_FLAG_OFFICES = 'ff_filing_runs:NORTH';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    managerX = (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = 'EMP005'`)
    ).rows[0]!.id;

    ruleCode = `GST_GSTR1_${unique()}`;
    const ruleId = (
      await http()
        .post('/api/v1/compliance-rules')
        .set(bearer(mp))
        .send({ code: ruleCode, name: 'GSTR-1', dueDateCategory: 'STATUTORY_RULE' })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/v1/compliance-rules/${ruleId}/versions`)
      .set(bearer(mp))
      .send({
        effectiveFrom: '2017-04-01',
        calculationBasis: 'period_end',
        offsetDays: 11,
        workingDayAdjustment: 'none',
      })
      .expect(201);
    await su.query(
      `UPDATE hsdg.compliance_rule_versions SET stream = 'gst', section = 'outward', form_label = 'GSTR-1'
        WHERE compliance_rule_id = $1`,
      [ruleId],
    );

    // North: partner A's engagement, manager X on it. South: partner B's own.
    // Each filing comes with its task.
    north = await filing(pa, 'Bharat', `${tag} Textiles`, managerX);
    south = await filing(pb, 'Coastal', `${tag} Coastal`);
    northTask = (
      await su.query<{ id: string }>(
        `UPDATE hsdg.tasks SET title = 'Reconcile outward supplies'
          WHERE source_compliance_instance_id = $1 RETURNING id`,
        [north.inst],
      )
    ).rows[0]!.id;
    await su.query(
      `UPDATE hsdg.tasks SET title = 'Reconcile outward supplies'
        WHERE source_compliance_instance_id = $1`,
      [south.inst],
    );
    northDoc = await doc(north.eng, north.inst, 'Bank statement Sep');
    southDoc = await doc(south.eng, south.inst, 'Bank statement Sep');
  });

  afterAll(async () => {
    delete process.env.FEATURE_FLAG_OFFICES;
    await su?.end();
    await app?.close();
  });

  it('is behind ff_filing_runs: 404 for an office it is not rolled out to', async () => {
    await http().get(`/api/v1/search?q=${tag}`).set(bearer(pb)).expect(404);
  });

  it('refuses a query too short or too long', async () => {
    await http().get('/api/v1/search?q=a').set(bearer(pa)).expect(400);
    await http()
      .get(`/api/v1/search?q=${'x'.repeat(121)}`)
      .set(bearer(pa))
      .expect(400);
    await http().get('/api/v1/search').set(bearer(pa)).expect(400);
  });

  it('"<client> gstr1 sep" puts the filing first and opens its section', async () => {
    const res = await search(pa, `${tag} gstr1 sep`);
    expect(res.understood).toMatchObject({ text: [tag], forms: ['gstr1'], period: '2026-09' });
    expect(res.groups[0]!.group).toBe('filings');
    const hits = group(res, 'filings');
    expect(hits.map((h) => h.id)).toEqual([north.inst]);
    expect(hits[0]!.title).toContain('GSTR-1 · Sep 2026');
    expect(hits[0]!.href).toMatch(new RegExp(`^/engagements/${north.eng}\\?tab=gst&fy=2026-27`));
    expect(hits[0]!.href).toContain('m=9');
    expect(hits[0]!.href).toContain('part=outward');
    // The task on that filing comes with it, opening the filing with the task highlighted.
    const task = group(res, 'tasks').find((h) => h.id === northTask);
    expect(task?.href).toContain(`task=${northTask}`);
    // A month that has no filing finds none.
    expect(ids(await search(pa, `${tag} gstr1 aug`), 'filings')).toEqual([]);
  });

  it('matches the form however it is typed, and by the GSTIN', async () => {
    expect(ids(await search(pa, `${tag} GSTR-1`), 'filings')).toEqual([north.inst]);
    expect(ids(await search(pa, `${tag} gstr 1 sep-26`), 'filings')).toEqual([north.inst]);
    const gstin = (
      await su.query<{ n: string }>(
        `SELECT er.registration_number AS n FROM hsdg.compliance_instances ci
           JOIN hsdg.entity_registrations er ON er.id = ci.registration_id WHERE ci.id = $1`,
        [north.inst],
      )
    ).rows[0]!.n;
    expect(ids(await search(pa, `${gstin} sep`), 'filings')).toEqual([north.inst]);
  });

  it('a name alone lists clients and engagements first, never other offices’ work (RLS)', async () => {
    const res = await search(pa, tag);
    expect(res.groups[0]!.group).toBe('clients');
    expect(ids(res, 'clients')).toContain(north.entity);
    expect(ids(res, 'engagements')).toEqual([north.eng]);
    expect(ids(res, 'filings')).toEqual([north.inst]);
    expect(ids(res, 'tasks')).toEqual([northTask]);
    // No word names a document, so the client's files are not all listed.
    expect(ids(res, 'documents')).toEqual([]);
    for (const g of ['engagements', 'filings', 'tasks', 'documents'])
      expect(ids(res, g)).not.toEqual(expect.arrayContaining([south.eng, south.inst, southDoc]));
  });

  it('finds documents by title, linked to their filing’s section', async () => {
    const res = await search(pa, `${tag} statement`);
    expect(ids(res, 'documents')).toEqual([northDoc]);
    expect(group(res, 'documents')[0]!.href).toContain('part=outward');
    // With the period too, only documents on a matching filing.
    expect(ids(await search(pa, `${tag} statement sep`), 'documents')).toEqual([northDoc]);
    expect(ids(await search(pa, `${tag} statement aug`), 'documents')).toEqual([]);
  });

  it('a manager finds the engagement they manage; the firm-wide partner finds both', async () => {
    const x = await search(mx, `${tag} gstr1 sep`);
    expect(ids(x, 'filings')).toEqual([north.inst]);
    const all = await search(mp, `${tag} gstr1 sep`);
    expect(ids(all, 'filings').sort()).toEqual([north.inst, south.inst].sort());
    expect(ids(await search(mp, `${tag} statement`), 'documents').sort()).toEqual(
      [northDoc, southDoc].sort(),
    );
  });
});

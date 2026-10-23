import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

// (c) proves the generate-calendar route is not behind ff_calendar_v2: boot
// with no flags at all, whatever the shell exported.
delete process.env.FEATURE_FLAGS;

/**
 * GST for a client with more than one GSTIN.
 *
 * - A Compliance engagement with the GST stream on a client with two GSTINs
 *   used to 500 (compliance_instances_unique keyed rule + date, and both
 *   GSTINs' GSTR-1 for a month share them). It is now keyed per registration.
 * - A GSTIN added (or activated) after the engagement exists rebuilds the
 *   client's open Compliance calendars, so its filings appear.
 * - POST /engagements/:id/compliance/generate-calendar is unflagged.
 */
describe('GST with several GSTINs (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let partnerA: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  type TreeItem = { instanceId: string; ruleCode: string; section: string | null };
  type TreePeriod = {
    periodKey: string;
    sections: Record<string, TreeItem[]>;
    items: TreeItem[];
  };
  type Tree = {
    registrations: Array<{ id: string; number: string; stateCode: string | null }>;
    registrationId: string | null;
    financialYear: string | null;
    periods: TreePeriod[];
    annual: TreeItem[];
  };

  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const superuser = async <T>(work: (db: Client) => Promise<T>): Promise<T> => {
    const db = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await db.connect();
    try {
      return await work(db);
    } finally {
      await db.end();
    }
  };
  /** A private company PAN no other spec uses: AAAC + letter + 4 digits + letter. */
  const pan = (letter: string): string =>
    `AAAC${letter}${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}M`;
  const gstin = (state: string, p: string) => `${state}${p}1Z5`;

  const createClient = async (
    name: string,
    p: string,
    registrations: Array<Record<string, unknown>>,
  ): Promise<{ id: string; registrations: Array<{ id: string; registrationNumber: string }> }> => {
    const res = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `${name} ${p} Pvt Ltd`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
        pan: p,
        registrations,
      })
      .expect(201);
    return res.body;
  };
  const createGstEngagement = (entityId: string, extra: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        kind: 'compliance',
        status: 'accepted',
        engagementPartnerEmployeeId: partnerA,
        engagementManagerEmployeeId: partnerA,
        financialYear: '2026-27',
        engagementType: 'recurring_compliance',
        years: [{ financialYear: '2026-27' }],
        streams: ['gst'],
        streamLeads: {},
        ...extra,
      });
  const gstTree = async (engagementId: string, registrationId?: string): Promise<Tree> => {
    const q = new URLSearchParams({ fy: '2026-27' });
    if (registrationId) q.set('registrationId', registrationId);
    const res = await http()
      .get(`/api/v1/engagements/${engagementId}/streams/gst/tree?${q.toString()}`)
      .set(bearer(pa))
      .expect(200);
    return res.body as Tree;
  };
  const allItems = (t: Tree): TreeItem[] => [
    ...t.annual,
    ...t.periods.flatMap((p) => [...p.items, ...Object.values(p.sections).flat()]),
  ];
  /** Every month of the year carries outward (GSTR-1), inward (ITC recon) and summary (GSTR-3B). */
  const expectSectionedYear = (t: Tree): void => {
    expect(t.financialYear).toBe('2026-27');
    expect(t.periods).toHaveLength(12);
    const empty = t.periods
      .filter((p) => ['outward', 'inward', 'summary'].some((s) => !p.sections[s]?.length))
      .map((p) => `${p.periodKey}: ${Object.keys(p.sections).join(',') || '(none)'}`);
    expect(empty).toEqual([]);
    const codes = new Set(allItems(t).map((i) => i.ruleCode));
    expect([...codes]).toEqual(
      expect.arrayContaining(['GST_GSTR1_M', 'GST_GSTR3B_M', 'GST_ITC_RECON_M']),
    );
  };
  const countsByRegistration = (engagementId: string) =>
    superuser(async (db) => {
      const { rows } = await db.query<{ registration_id: string; code: string; n: number }>(
        `SELECT ci.registration_id, r.code, count(*)::int AS n
           FROM hsdg.compliance_instances ci
           JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
          WHERE ci.engagement_id = $1 AND ci.financial_year = '2026-27'
            AND ci.workflow_status <> 'not_applicable'
          GROUP BY ci.registration_id, r.code`,
        [engagementId],
      );
      const out: Record<string, Record<string, number>> = {};
      for (const r of rows) (out[r.registration_id ?? 'none'] ??= {})[r.code] = r.n;
      return out;
    });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    const emps = await http().get('/api/v1/employees?limit=100').set(bearer(mp)).expect(200);
    partnerA = (emps.body.items as Array<{ id: string; employeeCode: string }>).find(
      (e) => e.employeeCode === 'EMP003',
    )!.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('(a) a client with two GSTINs in different states', () => {
    let eng: string;
    let wb: string;
    let mh: string;

    beforeAll(async () => {
      const p = pan('G');
      const entity = await createClient('Two State Traders', p, [
        { registrationType: 'gstin', registrationNumber: gstin('19', p), stateCode: '19' },
        { registrationType: 'gstin', registrationNumber: gstin('27', p), stateCode: '27' },
      ]);
      wb = entity.registrations.find((r) => r.registrationNumber === gstin('19', p))!.id;
      mh = entity.registrations.find((r) => r.registrationNumber === gstin('27', p))!.id;

      const res = await createGstEngagement(entity.id, { streamRegistrations: { gst: [wb, mh] } });
      // Was a 500 (duplicate key on compliance_instances_unique).
      expect({ status: res.status, body: res.status === 201 ? null : res.body }).toEqual({
        status: 201,
        body: null,
      });
      eng = res.body.id as string;
    });

    it('generates each GSTIN its own 12 GSTR-1, 12 GSTR-3B and 12 Inward reconciliations', async () => {
      const counts = await countsByRegistration(eng);
      for (const reg of [wb, mh]) {
        expect(counts[reg]).toMatchObject({
          GST_GSTR1_M: 12,
          GST_GSTR3B_M: 12,
          GST_ITC_RECON_M: 12,
        });
      }
    });

    it('lists both GSTINs on the GST tab, each with a sectioned year of its own filings', async () => {
      const first = await gstTree(eng);
      expect(first.registrations.map((r) => r.id).sort()).toEqual([wb, mh].sort());

      const trees = await Promise.all([gstTree(eng, wb), gstTree(eng, mh)]);
      expect(trees.map((t) => t.registrationId)).toEqual([wb, mh]);
      for (const t of trees) expectSectionedYear(t);

      // The two trees are distinct filings, not the same rows shown twice.
      const ids = trees.map((t) => new Set(allItems(t).map((i) => i.instanceId)));
      const shared = [...ids[0]!].filter((id) => ids[1]!.has(id));
      expect(shared).toEqual([]);
    });

    it('regenerating the calendar is idempotent for both GSTINs', async () => {
      const res = await http()
        .post(`/api/v1/engagements/${eng}/compliance/generate-calendar`)
        .set(bearer(pa))
        .send({})
        .expect(200);
      expect(res.body).toMatchObject({ created: 0, notApplicable: 0 });
      const counts = await countsByRegistration(eng);
      expect(counts[wb]).toMatchObject({ GST_GSTR1_M: 12, GST_GSTR3B_M: 12 });
      expect(counts[mh]).toMatchObject({ GST_GSTR1_M: 12, GST_GSTR3B_M: 12 });
    });
  });

  describe('(b) a GSTIN added after the engagement exists', () => {
    let entityId: string;
    let eng: string;
    let p: string;

    beforeAll(async () => {
      p = pan('H');
      const entity = await createClient('Late GST Traders', p, []);
      entityId = entity.id;
      const res = await createGstEngagement(entityId).expect(201);
      eng = res.body.id as string;
    });

    it('starts with no GSTIN and no GST filings', async () => {
      const t = await gstTree(eng);
      expect(t.registrations).toEqual([]);
      expect(t.registrationId).toBeNull();
      expect(allItems(t)).toEqual([]);
    });

    it('adding a GSTIN puts it and its sectioned filings on the GST tab', async () => {
      const added = await http()
        .post(`/api/v1/entities/${entityId}/registrations`)
        .set(bearer(pa))
        .send({ registrationType: 'gstin', registrationNumber: gstin('07', p), stateCode: '07' })
        .expect(201);
      const reg = (
        added.body.registrations as Array<{ id: string; registrationNumber: string }>
      ).find((r) => r.registrationNumber === gstin('07', p))!.id;

      const t = await gstTree(eng);
      expect(t.registrations.map((r) => r.id)).toEqual([reg]);
      expect(t.registrationId).toBe(reg);
      expectSectionedYear(t);
    });

    it('a second GSTIN, added pending and then made active, joins the first', async () => {
      const number = gstin('29', p);
      const added = await http()
        .post(`/api/v1/entities/${entityId}/registrations`)
        .set(bearer(pa))
        .send({
          registrationType: 'gstin',
          registrationNumber: number,
          stateCode: '29',
          status: 'pending',
        })
        .expect(201);
      const reg = (
        added.body.registrations as Array<{ id: string; registrationNumber: string }>
      ).find((r) => r.registrationNumber === number)!.id;
      // Pending: nothing to file yet.
      expect((await countsByRegistration(eng))[reg]).toBeUndefined();

      await http()
        .patch(`/api/v1/entities/${entityId}/registrations/${reg}`)
        .set(bearer(pa))
        .send({ status: 'active' })
        .expect(200);
      const t = await gstTree(eng, reg);
      expect(t.registrations).toHaveLength(2);
      expect(t.registrationId).toBe(reg);
      expectSectionedYear(t);
    });
  });

  describe('(c) generate-calendar without feature flags', () => {
    it('answers 200 for the lead with an empty body', async () => {
      expect(process.env.FEATURE_FLAGS).toBeUndefined();
      const p = pan('J');
      const entity = await createClient('Unflagged Traders', p, [
        { registrationType: 'gstin', registrationNumber: gstin('19', p), stateCode: '19' },
      ]);
      const eng = (await createGstEngagement(entity.id).expect(201)).body.id as string;
      const res = await http()
        .post(`/api/v1/engagements/${eng}/compliance/generate-calendar`)
        .set(bearer(pa))
        .send({})
        .expect(200);
      expect(res.body).toEqual({
        created: expect.any(Number),
        moved: expect.any(Number),
        flagged: expect.any(Number),
        notApplicable: expect.any(Number),
      });
    });
  });

  describe('(d) removing a GSTIN recorded in error', () => {
    let entityId: string;
    let eng: string;
    let right: string;
    let wrong: string;

    beforeAll(async () => {
      const p = pan('K');
      const entity = await createClient('Typo GST Traders', p, [
        { registrationType: 'gstin', registrationNumber: gstin('19', p), stateCode: '19' },
        { registrationType: 'gstin', registrationNumber: gstin('29', p), stateCode: '29' },
      ]);
      entityId = entity.id;
      right = entity.registrations.find((r) => r.registrationNumber === gstin('19', p))!.id;
      wrong = entity.registrations.find((r) => r.registrationNumber === gstin('29', p))!.id;
      eng = (await createGstEngagement(entityId).expect(201)).body.id as string;
    });

    const firstFiling = (registrationId: string) =>
      superuser(async (db) => {
        const { rows } = await db.query<{ id: string; compliance_rule_id: string }>(
          `SELECT id, compliance_rule_id FROM hsdg.compliance_instances
            WHERE engagement_id = $1 AND registration_id = $2
            ORDER BY period_key, id LIMIT 1`,
          [eng, registrationId],
        );
        return rows[0]!;
      });

    it('takes its generated filings with it (was "A referenced record does not exist.")', async () => {
      expect(Object.keys(await countsByRegistration(eng)).sort()).toEqual([right, wrong].sort());
      const filing = await firstFiling(wrong);
      const request = await superuser(
        async (db) =>
          (
            await db.query<{ id: string }>(
              `INSERT INTO hsdg.client_dependencies (engagement_id, compliance_instance_id, requested_info)
               VALUES ($1, $2, 'Sales register') RETURNING id`,
              [eng, filing.id],
            )
          ).rows[0]!.id,
      );

      const res = await http()
        .delete(`/api/v1/entities/${entityId}/registrations/${wrong}`)
        .set(bearer(pa))
        .expect(200);
      expect(res.body.registrations.map((r: { id: string }) => r.id)).toEqual([right]);

      const counts = await countsByRegistration(eng);
      expect(Object.keys(counts)).toEqual([right]);
      expect(counts[right]).toMatchObject({ GST_GSTR1_M: 12, GST_GSTR3B_M: 12 });
      // The client is no longer asked for data for a filing that is gone.
      const left = await superuser(
        async (db) =>
          (
            await db.query<{ status: string; compliance_instance_id: string | null }>(
              `SELECT status, compliance_instance_id FROM hsdg.client_dependencies WHERE id = $1`,
              [request],
            )
          ).rows[0],
      );
      expect(left).toEqual({ status: 'cancelled', compliance_instance_id: null });
      // The calendar rebuilds cleanly without it.
      await http()
        .post(`/api/v1/engagements/${eng}/compliance/generate-calendar`)
        .set(bearer(pa))
        .send({})
        .expect(200);
      expect(Object.keys(await countsByRegistration(eng))).toEqual([right]);
    });

    it('refuses (409) a GSTIN with a return lodged in the portal', async () => {
      const filing = await firstFiling(right);
      // A lodging without its acknowledgement: the firm's checks are off for
      // this insert only, and back as they were before it commits.
      await superuser(async (db) => {
        await db.query('BEGIN');
        const { rows } = await db.query<{ strict_checks: object }>(
          `SELECT strict_checks FROM hsdg.firm_settings`,
        );
        await db.query(`UPDATE hsdg.firm_settings SET strict_checks = '{}'::jsonb`);
        await db.query(
          `INSERT INTO hsdg.filing_records
             (compliance_instance_id, engagement_id, registration_id, compliance_rule_id,
              reference_kind, reference_no, filed_on)
           VALUES ($1, $2, $3, $4, 'arn', 'AA1904261234567', '2026-05-11')`,
          [filing.id, eng, right, filing.compliance_rule_id],
        );
        await db.query(`UPDATE hsdg.firm_settings SET strict_checks = $1::jsonb`, [
          JSON.stringify(rows[0]!.strict_checks),
        ]);
        await db.query('COMMIT');
      });
      const res = await http()
        .delete(`/api/v1/entities/${entityId}/registrations/${right}`)
        .set(bearer(pa))
        .expect(409);
      expect(res.body.message).toMatch(/has a return lodged in the portal.*Cancelled instead/);
      const entity = await http().get(`/api/v1/entities/${entityId}`).set(bearer(pa)).expect(200);
      expect(entity.body.registrations.map((r: { id: string }) => r.id)).toEqual([right]);
    });
  });

  describe('(e) a GSTIN already recorded on a client', () => {
    it('names the client holding it, even one of another office', async () => {
      // South's client, which Partner A (North) cannot see.
      const p = pan('L');
      const taken = gstin('29', p);
      const pb = await token('partner.b@dhvaj.in');
      const south = await http()
        .post('/api/v1/entities')
        .set(bearer(pb))
        .send({
          legalName: `Southern Holder ${p} Pvt Ltd`,
          typeSlug: 'private_limited',
          officeCode: 'SOUTH',
          pan: p,
          registrations: [{ registrationType: 'gstin', registrationNumber: taken }],
        })
        .expect(201);
      await http().get(`/api/v1/entities/${south.body.id}`).set(bearer(pa)).expect(404);

      const mine = await createClient('Northern Adder', pan('M'), [
        { registrationType: 'gstin', registrationNumber: gstin('07', p) },
      ]);
      const add = (registrationNumber: string) =>
        http()
          .post(`/api/v1/entities/${mine.id}/registrations`)
          .set(bearer(pa))
          .send({ registrationType: 'gstin', registrationNumber });

      const other = await add(taken).expect(409);
      expect(other.body.message).toBe(
        `GSTIN ${taken} is already recorded on Southern Holder ${p} Pvt Ltd. If it was put there by mistake, remove it from that client first.`,
      );
      const own = await add(gstin('07', p)).expect(409);
      expect(own.body.message).toBe(`GSTIN ${gstin('07', p)} is already recorded on this client.`);

      // Changing a number to one already recorded says the same.
      const edit = await http()
        .patch(`/api/v1/entities/${mine.id}/registrations/${mine.registrations[0]!.id}`)
        .set(bearer(pa))
        .send({ registrationNumber: taken })
        .expect(409);
      expect(edit.body.message).toMatch(`already recorded on Southern Holder ${p} Pvt Ltd`);

      // A new GSTIN still goes in.
      const ok = await add(gstin('09', p)).expect(201);
      expect(ok.body.registrations).toHaveLength(2);
    });
  });
});

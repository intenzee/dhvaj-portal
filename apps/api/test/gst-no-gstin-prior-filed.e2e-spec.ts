import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { gstinCheckChar, type PriorFiledResult } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * A GST engagement for a client whose GSTIN is not on file yet, and periods
 * the client filed before the portal.
 *
 * - The GST months are built without a GSTIN; the GST tab says "GSTIN
 *   missing" until the engagement's partner or manager adds it from there,
 *   when the same months move onto it (anything filed stays filed).
 * - Periods ticked "filed before the portal" on create are created filed;
 *   on an existing stream the lead marks them, or puts them back.
 * - The firm's GST sheet marks kept on the client (no GSTIN) close the months.
 */
describe('GST without a GSTIN, and periods filed before the portal (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: string;
  let mx: string;
  let sy: string;
  let partnerA: string;
  let managerX: string;
  let seniorY: string;
  const PRIOR_NOTE = 'Filed before the portal';

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;

  const letters = (n: number) =>
    Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
      '',
    );
  const digits = (n: number) =>
    String(Math.floor(Math.random() * 9 * 10 ** (n - 1)) + 10 ** (n - 1));
  const freshPan = () => `${letters(3)}C${letters(1)}${digits(4)}${letters(1)}`;
  const gstinOf = (state: string, p: string) => {
    const first14 = `${state}${p}1Z`;
    return first14 + gstinCheckChar(first14);
  };

  const createClient = async (p: string): Promise<string> =>
    (
      await http()
        .post('/api/v1/entities')
        .set(bearer(pa))
        .send({
          legalName: `NoGstin ${p} Pvt Ltd`,
          typeSlug: 'private_limited',
          officeCode: 'NORTH',
          pan: p,
          registrations: [],
        })
        .expect(201)
    ).body.id as string;
  const createGst = (entityId: string, extra: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        kind: 'compliance',
        status: 'accepted',
        engagementPartnerEmployeeId: partnerA,
        engagementManagerEmployeeId: managerX,
        financialYear: '2026-27',
        engagementType: 'recurring_compliance',
        years: [{ financialYear: '2026-27' }],
        streams: ['gst'],
        streamLeads: {},
        ...extra,
      });

  /** Each live GST filing: 'CODE period' → its state. */
  const filings = async (
    engagementId: string,
  ): Promise<
    Map<string, { id: string; workflow: string; notes: string | null; registration: string | null }>
  > => {
    const { rows } = await su.query<{
      id: string;
      code: string;
      period_key: string;
      workflow_status: string;
      notes: string | null;
      registration_id: string | null;
    }>(
      `SELECT ci.id, r.code, ci.period_key, ci.workflow_status, ci.notes, ci.registration_id
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
        WHERE ci.engagement_id = $1 AND r.code LIKE 'GST\\_%'`,
      [engagementId],
    );
    return new Map(
      rows.map((r) => [
        `${r.code} ${r.period_key}`,
        {
          id: r.id,
          workflow: r.workflow_status,
          notes: r.notes,
          registration: r.registration_id,
        },
      ]),
    );
  };
  const tree = async (engagementId: string, t = pa) =>
    (
      await http()
        .get(`/api/v1/engagements/${engagementId}/streams/gst/tree?fy=2026-27`)
        .set(bearer(t))
        .expect(200)
    ).body as { registrationId: string | null; registrationPending: boolean };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    const mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    const emps = (await http().get('/api/v1/employees?limit=100').set(bearer(mp)).expect(200)).body
      .items as Array<{ id: string; employeeCode: string }>;
    const emp = (code: string) => emps.find((e) => e.employeeCode === code)!.id;
    partnerA = emp('EMP003');
    managerX = emp('EMP005');
    seniorY = emp('EMP006');
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  describe('a client with no GSTIN, Apr–Jun filed before the portal', () => {
    let p: string;
    let entityId: string;
    let eng: string;

    beforeAll(async () => {
      p = freshPan();
      entityId = await createClient(p);
      eng = (
        await createGst(entityId, {
          priorFiled: { gst: ['2026-04', '2026-05', '2026-06'] },
        }).expect(201)
      ).body.id as string;
      await http()
        .post(`/api/v1/engagements/${eng}/team`)
        .set(bearer(pa))
        .send({ employeeId: seniorY, roleOnEngagement: 'in_charge' })
        .expect(201);
    });

    it('builds the GST months without a GSTIN and says the GSTIN is missing', async () => {
      const f = await filings(eng);
      expect(f.size).toBeGreaterThan(24);
      expect([...f.values()].every((x) => x.registration === null)).toBe(true);
      expect(f.has('GST_GSTR1_M 2026-04')).toBe(true);
      expect(f.has('GST_GSTR3B_M 2027-03')).toBe(true);
      expect(await tree(eng)).toMatchObject({ registrationId: null, registrationPending: true });
    });

    it('creates the ticked months filed, and only those', async () => {
      const f = await filings(eng);
      for (const m of ['2026-04', '2026-05', '2026-06']) {
        for (const code of ['GST_GSTR1_M', 'GST_GSTR3B_M']) {
          expect({ key: `${code} ${m}`, workflow: f.get(`${code} ${m}`)?.workflow }).toEqual({
            key: `${code} ${m}`,
            workflow: 'filed',
          });
          expect(f.get(`${code} ${m}`)?.notes).toMatch(new RegExp(`^${PRIOR_NOTE}`));
        }
      }
      expect(f.get('GST_GSTR1_M 2026-07')?.workflow).not.toMatch(/filed|not_applicable/);
      const audit = await su.query(
        `SELECT 1 FROM hsdg.audit_events WHERE action = 'filing.prior_filed_marked' AND object_id = $1`,
        [eng],
      );
      expect(audit.rowCount).toBeGreaterThan(0);
    });

    it('lets only the engagement’s leads add the GSTIN or mark periods', async () => {
      await http()
        .post(`/api/v1/engagements/${eng}/streams/gst/registration`)
        .set(bearer(sy))
        .send({ registrationNumber: gstinOf('07', p) })
        .expect(403);
      await http()
        .post(`/api/v1/engagements/${eng}/streams/gst/prior-filed`)
        .set(bearer(sy))
        .send({ periods: ['2026-07'] })
        .expect(403);
    });

    it('rejects a malformed GSTIN, or a stream that does not wait on one', async () => {
      await http()
        .post(`/api/v1/engagements/${eng}/streams/gst/registration`)
        .set(bearer(mx))
        .send({ registrationNumber: 'NOTAGSTIN' })
        .expect(400);
      await http()
        .post(`/api/v1/engagements/${eng}/streams/tds/registration`)
        .set(bearer(mx))
        .send({ registrationNumber: gstinOf('07', p) })
        .expect(400);
      await http()
        .post(`/api/v1/engagements/${eng}/streams/gst/prior-filed`)
        .set(bearer(mx))
        .send({ periods: ['2026-13'] })
        .expect(400);
    });

    it('the manager adds the GSTIN from the GST tab; the months move onto it, still filed', async () => {
      const before = await filings(eng);
      const number = gstinOf('07', p);
      const res = await http()
        .post(`/api/v1/engagements/${eng}/streams/gst/registration`)
        .set(bearer(mx))
        .send({ registrationNumber: number.toLowerCase() })
        .expect(201);
      const reg = (
        res.body.registrations as Array<{
          id: string;
          registrationNumber: string;
          stateCode: string;
        }>
      ).find((r) => r.registrationNumber === number)!;
      expect(reg.stateCode).toBe('07');

      const after = await filings(eng);
      expect([...after.values()].every((x) => x.registration === reg.id)).toBe(true);
      // Moved, not rebuilt: the same rows, and what was filed stays filed.
      expect(after.get('GST_GSTR1_M 2026-04')).toMatchObject({
        id: before.get('GST_GSTR1_M 2026-04')!.id,
        workflow: 'filed',
      });
      expect(after.get('GST_GSTR1_M 2026-07')?.id).toBe(before.get('GST_GSTR1_M 2026-07')!.id);
      expect(await tree(eng)).toMatchObject({ registrationId: reg.id, registrationPending: false });
    });

    it('marks a month filed on the existing stream, and puts marked months back', async () => {
      const marked = (
        await http()
          .post(`/api/v1/engagements/${eng}/streams/gst/prior-filed`)
          .set(bearer(mx))
          .send({ periods: ['2026-07'] })
          .expect(201)
      ).body as PriorFiledResult;
      expect(marked.filings).toBeGreaterThanOrEqual(2);
      let f = await filings(eng);
      expect(f.get('GST_GSTR1_M 2026-07')?.workflow).toBe('filed');
      expect(f.get('GST_GSTR3B_M 2026-07')?.workflow).toBe('filed');

      // Again: nothing left to mark.
      const again = (
        await http()
          .post(`/api/v1/engagements/${eng}/streams/gst/prior-filed`)
          .set(bearer(mx))
          .send({ periods: ['2026-07'] })
          .expect(201)
      ).body as PriorFiledResult;
      expect(again.filings).toBe(0);

      const undone = (
        await http()
          .post(`/api/v1/engagements/${eng}/streams/gst/prior-filed/undo`)
          .set(bearer(mx))
          .send({ periods: ['2026-04', '2026-07'] })
          .expect(201)
      ).body as PriorFiledResult;
      expect(undone.filings).toBe(marked.filings * 2);
      f = await filings(eng);
      for (const key of ['GST_GSTR1_M 2026-04', 'GST_GSTR1_M 2026-07']) {
        expect(f.get(key)?.workflow).not.toMatch(/filed|not_applicable/);
        expect(f.get(key)?.notes ?? '').not.toContain(PRIOR_NOTE);
      }
      expect(f.get('GST_GSTR1_M 2026-05')?.workflow).toBe('filed');
    });
  });

  describe('a TDS engagement for a client with no TAN', () => {
    let entityId: string;
    let eng: string;
    const tdsFilings = async () =>
      (
        await su.query<{ id: string; code: string; registration_id: string | null }>(
          `SELECT ci.id, r.code, ci.registration_id
             FROM hsdg.compliance_instances ci
             JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
            WHERE ci.engagement_id = $1 AND r.code IN ('TDS_F131', 'TDS_F140', 'TDS_CHALLAN')`,
          [eng],
        )
      ).rows;

    beforeAll(async () => {
      entityId = await createClient(freshPan());
      eng = (await createGst(entityId, { streams: ['tds'] }).expect(201)).body.id as string;
    });

    it('builds the TDS quarters without a TAN and says the TAN is missing', async () => {
      const f = await tdsFilings();
      expect(f.length).toBeGreaterThan(4);
      expect(f.every((x) => x.registration_id === null)).toBe(true);
      const t = (
        await http()
          .get(`/api/v1/engagements/${eng}/streams/tds/tree?fy=2026-27`)
          .set(bearer(pa))
          .expect(200)
      ).body as { registrationPending: boolean };
      expect(t.registrationPending).toBe(true);
    });

    it('the TAN added later takes the quarters, even with an empty TAN pick saved on the year', async () => {
      // The Services tab saves the year's picks; before the TAN existed it saved none.
      await su.query(
        `UPDATE hsdg.compliance_engagement_years SET stream_registrations = '{"tds": []}'
          WHERE engagement_id = $1`,
        [eng],
      );
      const before = await tdsFilings();
      await http()
        .post(`/api/v1/engagements/${eng}/streams/tds/registration`)
        .set(bearer(mx))
        .send({ registrationNumber: 'NOTATAN' })
        .expect(400);
      const tan = `${letters(4)}${digits(5)}${letters(1)}`;
      const res = await http()
        .post(`/api/v1/engagements/${eng}/streams/tds/registration`)
        .set(bearer(mx))
        .send({ registrationNumber: tan.toLowerCase() })
        .expect(201);
      const reg = (
        res.body.registrations as Array<{ id: string; registrationNumber: string }>
      ).find((r) => r.registrationNumber === tan)!;
      const after = await tdsFilings();
      expect(after.every((x) => x.registration_id === reg.id)).toBe(true);
      // Moved, not rebuilt.
      expect(after.map((x) => x.id).sort()).toEqual(before.map((x) => x.id).sort());
    });
  });

  it('takes the GST sheet’s marks kept on a client with no GSTIN', async () => {
    const entityId = await createClient(freshPan());
    await su.query(
      `INSERT INTO hsdg.client_return_marks (entity_id, return_form, period_key, mark)
       VALUES ($1, 'GSTR1', '2026-08', 'filed'), ($1, 'GSTR3B', '2026-08', 'filed')`,
      [entityId],
    );
    const eng = (await createGst(entityId).expect(201)).body.id as string;
    const f = await filings(eng);
    expect(f.get('GST_GSTR1_M 2026-08')).toMatchObject({ workflow: 'filed', registration: null });
    expect(f.get('GST_GSTR3B_M 2026-08')?.workflow).toBe('filed');
    expect(f.get('GST_GSTR1_M 2026-09')?.workflow).not.toMatch(/filed|not_applicable/);
  });

  it('refuses periods filed before the portal on a one-off engagement', async () => {
    const entityId = await createClient(freshPan());
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        kind: 'statutory_audit',
        status: 'accepted',
        engagementPartnerEmployeeId: partnerA,
        financialYear: '2026-27',
        periodLabel: 'FY',
        engagementType: 'audit',
        priorFiled: { gst: ['2026-04'] },
      });
    expect(res.status).toBe(400);
  });
});

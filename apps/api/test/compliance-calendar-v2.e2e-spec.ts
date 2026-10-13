import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * The firm calendar (spec Change 4 "Calendar views") and its .xlsx export,
 * the stream-grouped catalogue (Change 2) and the merged-code alias on the
 * engagement search (Change 1 data migration).
 */
describe('Firm calendar v2 (e2e)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;
  let sy: string;
  let client: string;
  let eng: string;
  let code: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const WINDOW = 'from=2026-04-01&to=2028-03-31';

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

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    const acme = await http().get('/api/v1/entities?search=Acme&limit=10').set(bearer(mp));
    client = await freshClient(acme.body.items[0].id as string);
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        kind: 'compliance',
        entityId: client,
        status: 'accepted',
        financialYear: '2026-27',
        streams: ['gst', 'income_tax', 'roc'],
        years: [{ financialYear: '2026-27' }],
      })
      .expect(201);
    eng = res.body.id as string;
    code = res.body.engagementCode as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /compliance/calendar', () => {
    it('lists the client’s filings with due band, days left and the engagement', async () => {
      const res = await http()
        .get(`/api/v1/compliance/calendar?${WINDOW}&entityId=${client}`)
        .set(bearer(pa))
        .expect(200);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.items.length).toBe(res.body.total);
      for (const row of res.body.items) {
        expect(row).toMatchObject({ entityId: client, engagementId: eng, engagementCode: code });
        expect(['red', 'amber', 'grey', 'none']).toContain(row.band);
        expect(typeof row.daysLeft).toBe('number');
        expect(typeof row.needsVerification).toBe('boolean');
      }
      const streams = new Set(res.body.items.map((r: { stream: string }) => r.stream));
      expect([...streams].sort()).toEqual(['gst', 'income_tax', 'roc']);
    });

    it('filters by stream and by status', async () => {
      const gst = await http()
        .get(`/api/v1/compliance/calendar?${WINDOW}&entityId=${client}&stream=gst`)
        .set(bearer(pa))
        .expect(200);
      expect(gst.body.total).toBeGreaterThan(0);
      expect(gst.body.items.every((r: { stream: string }) => r.stream === 'gst')).toBe(true);

      const filed = await http()
        .get(`/api/v1/compliance/calendar?${WINDOW}&entityId=${client}&status=filed`)
        .set(bearer(pa))
        .expect(200);
      expect(filed.body.total).toBe(0);
    });

    it('shows a legacy filing moved into the engagement under its service’s stream', async () => {
      const id = await superuser(async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO hsdg.compliance_instances
             (engagement_id, compliance_rule_id, compliance_rule_version_id,
              reference_date, statutory_deadline, internal_sla_date)
           SELECT $1, cr.id, v.id, '2026-11-01', '2026-12-20', '2026-12-15'
             FROM hsdg.compliance_rules cr
             JOIN hsdg.compliance_rule_versions v ON v.compliance_rule_id = cr.id
            WHERE cr.code = 'GSTR3B_MONTHLY' AND v.stream IS NULL
            LIMIT 1
           RETURNING id`,
          [eng],
        );
        return rows[0]!.id;
      });
      const res = await http()
        .get(`/api/v1/compliance/calendar?${WINDOW}&entityId=${client}&stream=gst`)
        .set(bearer(pa))
        .expect(200);
      expect(res.body.items.find((r: { id: string }) => r.id === id)).toMatchObject({
        stream: 'gst',
        periodKey: null,
        periodLabel: 'Nov 2026',
      });
      await superuser((db) =>
        db.query(`DELETE FROM hsdg.compliance_instances WHERE id = $1`, [id]),
      );
    });

    it('generates each filing with its checklist', async () => {
      const { rows } = await superuser((db) =>
        db.query<{ seeded: number; total: number }>(
          `SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM hsdg.instance_checklist_items it
                                                   WHERE it.compliance_instance_id = ci.id))::int AS seeded,
                  count(*)::int AS total
             FROM hsdg.compliance_instances ci WHERE ci.engagement_id = $1`,
          [eng],
        ),
      );
      expect(rows[0]!.total).toBeGreaterThan(0);
      expect(rows[0]!.seeded).toBeGreaterThan(rows[0]!.total / 2);
    });

    it('rejects an unknown stream', async () => {
      await http().get(`/api/v1/compliance/calendar?stream=vat`).set(bearer(pa)).expect(400);
    });

    it('shows a member only what RLS lets them see', async () => {
      const res = await http()
        .get(`/api/v1/compliance/calendar?${WINDOW}&entityId=${client}`)
        .set(bearer(sy))
        .expect(200);
      expect(res.body.total).toBe(0);
    });
  });

  describe('the .xlsx export', () => {
    it.each(['calendar.xlsx', 'calendar/export'])('is served at /compliance/%s', async (path) => {
      const res = await http()
        .get(`/api/v1/compliance/${path}?${WINDOW}&entityId=${client}`)
        .set(bearer(pa))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename=".+\.xlsx"/);
      expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    });
  });

  describe('GET /services by stream', () => {
    it('carries each service’s stream and the engagement kind that may hold it', async () => {
      const res = await http().get('/api/v1/services?limit=100').set(bearer(mp)).expect(200);
      const byCode = new Map(
        (
          res.body.items as Array<{ code: string; stream: string | null; engagementKind: string }>
        ).map((s) => [s.code, s]),
      );
      expect(byCode.get('STREAM_GST')).toMatchObject({
        stream: 'gst',
        engagementKind: 'compliance',
      });
      expect(byCode.get('STAT_AUDIT')).toMatchObject({
        stream: null,
        engagementKind: 'statutory_audit',
      });
    });

    it('filters to one stream', async () => {
      const res = await http()
        .get('/api/v1/services?stream=roc&limit=100')
        .set(bearer(mp))
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.every((s: { stream: string }) => s.stream === 'roc')).toBe(true);
      await http().get('/api/v1/services?stream=vat').set(bearer(mp)).expect(400);
    });
  });

  describe('engagement search', () => {
    it('finds the standing engagement by a code merged into it', async () => {
      const other = await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          kind: 'assignment',
          entityId: client,
          serviceId: (
            (await http().get('/api/v1/services?search=CERTIFICATION&limit=10').set(bearer(mp)))
              .body.items as Array<{ id: string; code: string }>
          ).find((s) => s.code === 'CERTIFICATION')!.id,
          status: 'accepted',
          financialYear: '2025-26',
        })
        .expect(201);
      await superuser((db) =>
        db.query(
          `UPDATE hsdg.engagements SET status = 'merged', merged_into_id = $2 WHERE id = $1`,
          [other.body.id, eng],
        ),
      );

      const res = await http()
        .get(`/api/v1/engagements?search=${encodeURIComponent(other.body.engagementCode)}`)
        .set(bearer(pa))
        .expect(200);
      const ids = res.body.items.map((e: { id: string }) => e.id);
      expect(ids).toContain(eng);
    });
  });

  describe('firm-policy items: Inward reconciliation, Bookkeeping, MIS', () => {
    let firmEng: string;

    beforeAll(async () => {
      const n = String(Date.now()).slice(-4);
      const pan = `AAACF${n}Q`;
      const entity = await http()
        .post('/api/v1/entities')
        .set(bearer(pa))
        .send({
          legalName: `Firm Policy Traders ${n} Pvt Ltd`,
          typeSlug: 'private_limited',
          officeCode: 'NORTH',
          pan,
          registrations: [
            { registrationType: 'gstin', registrationNumber: `19${pan}1Z5`, stateCode: '19' },
          ],
        })
        .expect(201);
      const res = await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          kind: 'compliance',
          entityId: entity.body.id,
          status: 'accepted',
          financialYear: '2026-27',
          streams: ['gst', 'bookkeeping', 'mis'],
          years: [{ financialYear: '2026-27' }],
        })
        .expect(201);
      firmEng = res.body.id as string;
    });

    it('gives a regular GSTIN 12 GSTR-1, 12 GSTR-3B and 12 Inward reconciliations, and 12 month-ends', async () => {
      const { rows } = await superuser((db) =>
        db.query<{ code: string; n: number }>(
          `SELECT r.code, count(*)::int AS n
             FROM hsdg.compliance_instances ci
             JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
            WHERE ci.engagement_id = $1 AND ci.financial_year = '2026-27'
            GROUP BY r.code`,
          [firmEng],
        ),
      );
      const n = Object.fromEntries(rows.map((r) => [r.code, r.n]));
      expect(n).toMatchObject({
        GST_GSTR1_M: 12,
        GST_GSTR3B_M: 12,
        GST_ITC_RECON_M: 12,
        BK_MONTH_CLOSE: 12,
        MIS_MONTHLY_PACK: 12,
      });
      expect(n.GST_ITC_RECON_Q).toBeUndefined();

      const tree = await http()
        .get(`/api/v1/engagements/${firmEng}/streams/bookkeeping/tree?fy=2026-27`)
        .set(bearer(pa))
        .expect(200);
      expect(tree.body.periods).toHaveLength(12);
      const sep = tree.body.periods.find((p: { periodKey: string }) => p.periodKey === '2026-09');
      expect(sep.items[0]).toMatchObject({
        ruleCode: 'BK_MONTH_CLOSE',
        label: 'Books closed',
        dueDate: '2026-10-15',
        requiredTotal: 6,
      });
    });

    it('closes an Inward reconciliation with an internal reference and no late fee', async () => {
      const tree = await http()
        .get(`/api/v1/engagements/${firmEng}/streams/gst/tree?fy=2026-27`)
        .set(bearer(pa))
        .expect(200);
      const sep = tree.body.periods.find((p: { periodKey: string }) => p.periodKey === '2026-09');
      const inward = sep.sections.inward[0];
      expect(inward).toMatchObject({ ruleCode: 'GST_ITC_RECON_M', dueDate: '2026-10-18' });

      const ws = await http()
        .get(`/api/v1/compliance-instances/${inward.instanceId}`)
        .set(bearer(pa))
        .expect(200);
      expect(ws.body.instance.lateCharges).toBeNull();
      expect(ws.body.checklist.at(-1)).toMatchObject({
        itemCode: 'LODGE',
        label: 'Mark reconciled',
      });

      const up = await http()
        .post(`/api/v1/compliance-instances/${inward.instanceId}/slots/ITC_RECON/documents`)
        .set(bearer(pa))
        .send({
          filename: 'itc-recon.xlsx',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('books vs 2B').toString('base64'),
        })
        .expect(201);
      const doc = up.body.slots.find((s: { slotCode: string }) => s.slotCode === 'ITC_RECON')
        .documents[0].id as string;
      const lodged = await http()
        .post(`/api/v1/compliance-instances/${inward.instanceId}/lodge`)
        .set(bearer(pa))
        .send({ referenceNo: 'REC-2026-09', filedOn: '2026-10-12', ackDocumentId: doc })
        .expect(201);
      expect(lodged.body.instance.workflowStatus).toBe('filed');
      expect(lodged.body.filing).toMatchObject({
        referenceKind: 'internal',
        referenceNo: 'REC-2026-09',
        isLate: false,
      });
    });

    it('ending a stream takes its open items off the calendar and its tab; re-adding brings them back', async () => {
      const misItems = async () =>
        (
          await http()
            .get(`/api/v1/engagements/${firmEng}/streams/mis/tree?fy=2026-27`)
            .set(bearer(pa))
            .expect(200)
        ).body.periods.flatMap((p: { items: unknown[] }) => p.items) as Array<{
          instanceId: string;
          workflowStatus: string;
        }>;
      const tabStreams = async () =>
        (await http().get(`/api/v1/engagements/${firmEng}/tabs`).set(bearer(pa)).expect(200)).body
          .streams as Array<{ stream: string; financialYears: string[] }>;
      const years = async () =>
        (await http().get(`/api/v1/engagements/${firmEng}/years`).set(bearer(pa)).expect(200))
          .body[0] as { version: number };

      // September's MIS pack is assigned before the stream is ended.
      const items = await misItems();
      expect(items).toHaveLength(12);
      const assigned = items[5]!.instanceId;
      const emps = await http().get('/api/v1/employees?limit=100').set(bearer(pa)).expect(200);
      const managerX = (emps.body.items as Array<{ id: string; employeeCode: string }>).find(
        (e) => e.employeeCode === 'EMP005',
      )!.id;
      await http()
        .post(`/api/v1/engagements/${firmEng}/team`)
        .set(bearer(pa))
        .send({ employeeId: managerX, roleOnEngagement: 'in_charge' })
        .expect(201);
      await http()
        .post(`/api/v1/engagements/${firmEng}/tasks`)
        .set(bearer(pa))
        .send({
          title: 'MIS pack · 2026-09',
          assignedToEmployeeId: managerX,
          complianceInstanceId: assigned,
        })
        .expect(201);

      const ended = await http()
        .patch(`/api/v1/engagements/${firmEng}/years/2026-27/streams`)
        .set(bearer(pa))
        .send({ end: ['mis'], version: (await years()).version })
        .expect(200);
      expect(ended.body.streams).not.toContain('mis');
      const after = await superuser((db) =>
        db.query<{ id: string; workflow_status: string; flagged: boolean }>(
          `SELECT ci.id, ci.workflow_status, ci.profile_changed_at IS NOT NULL AS flagged
             FROM hsdg.compliance_instances ci
             JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
            WHERE ci.engagement_id = $1 AND r.code = 'MIS_MONTHLY_PACK'`,
          [firmEng],
        ),
      );
      const kept = after.rows.find((r) => r.id === assigned)!;
      expect(kept).toMatchObject({ workflow_status: 'not_started', flagged: true });
      expect(
        after.rows
          .filter((r) => r.id !== assigned)
          .every((r) => r.workflow_status === 'not_applicable'),
      ).toBe(true);
      // The assigned item keeps the tab; once it too is marked not applicable, the tab goes.
      expect((await tabStreams()).find((s) => s.stream === 'mis')?.financialYears).toEqual([
        '2026-27',
      ]);
      await superuser((db) =>
        db.query(
          `UPDATE hsdg.compliance_instances SET workflow_status = 'not_applicable' WHERE id = $1`,
          [assigned],
        ),
      );
      expect((await tabStreams()).find((s) => s.stream === 'mis')?.financialYears ?? []).toEqual(
        [],
      );
      await superuser((db) =>
        db.query(
          `UPDATE hsdg.compliance_instances SET workflow_status = 'not_started' WHERE id = $1`,
          [assigned],
        ),
      );

      // Re-adding the stream brings the items it took off back as not started.
      await http()
        .patch(`/api/v1/engagements/${firmEng}/years/2026-27/streams`)
        .set(bearer(pa))
        .send({ add: ['mis'], version: (await years()).version })
        .expect(200);
      const back = await misItems();
      expect(back).toHaveLength(12);
      expect(back.every((i) => i.workflowStatus === 'not_started')).toBe(true);
      expect((await tabStreams()).find((s) => s.stream === 'mis')?.financialYears).toEqual([
        '2026-27',
      ]);
    });
  });
});

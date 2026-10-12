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
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Service Components & Component Configuration (spec §11–§13, §16, §24, §36),
 * through the HTTP API.
 *
 * Headline acceptance: the Component Discovery engine categorises the service's
 * catalogue (mandatory / applicable / optional) and previews the statutory
 * deadline where a compliance rule governs a component (§11/§12); a component
 * can be selected and configured (§13); a duplicate live configuration is
 * blocked (§16/§35); removal is a soft-cancel that preserves history and allows
 * re-adding (§24); and role/RLS negatives hold (leads write, members read).
 */
describe('Service Components & Configuration (e2e)', () => {
  let app: INestApplication;
  let mp: string; // Managing Partner: firm-wide + service.manage (catalogue authority)

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const findEntityId = async (search: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/entities?search=${search}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findServiceId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/services?search=${code}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };

  /** A partner-owned engagement (partner becomes EP), on the given service. */
  const createEngagement = async (
    epToken: string,
    serviceCode = 'GST_MONTHLY',
    financialYear = '2026-27',
  ): Promise<string> => {
    const entityId = await findEntityId('Bharat');
    const serviceId = await findServiceId(serviceCode);
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear,
        periodLabel: `C${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Catalogue (firm-wide config) ─────────────────────────────────────────

  describe('component catalogue', () => {
    it('lists the seeded components for a service', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/service-components?serviceCode=GST_MONTHLY&limit=100')
        .set(bearer(mp))
        .expect(200);
      const codes = res.body.items.map((c: { code: string }) => c.code);
      expect(codes).toEqual(expect.arrayContaining(['GSTR1', 'GSTR3B', 'ITC_RECON']));
      const gstr1 = res.body.items.find((c: { code: string }) => c.code === 'GSTR1');
      expect(gstr1.defaultApplicability).toBe('mandatory');
      expect(gstr1.defaultFrequency).toBe('monthly');
    });

    it('lets the MP create a component but blocks a partner (service.manage)', async () => {
      const code = `C_${unique()}`;
      await request(app.getHttpServer())
        .post('/api/v1/service-components')
        .set(bearer(mp))
        .send({ serviceCode: 'GST_MONTHLY', code, name: 'Custom Component' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/service-components')
        .set(bearer(await token('partner.a@hsdg.in')))
        .send({ serviceCode: 'GST_MONTHLY', code: `C_${unique()}`, name: 'Nope' })
        .expect(403);
    });
  });

  // ── Discovery (§11/§12) ──────────────────────────────────────────────────

  describe('component discovery', () => {
    it('categorises the catalogue for the engagement’s service', async () => {
      const pa = await token('partner.a@hsdg.in');
      const engId = await createEngagement(pa, 'GST_MONTHLY');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${engId}/components/discovery`)
        .set(bearer(pa))
        .expect(200);

      expect(res.body.serviceCode).toBe('GST_MONTHLY');
      const byCode = Object.fromEntries(
        res.body.rows.map((r: { code: string }) => [r.code, r]),
      );
      expect(byCode.GSTR1.category).toBe('mandatory');
      expect(byCode.GSTR3B.category).toBe('mandatory');
      expect(byCode.ITC_RECON.category).toBe('applicable'); // recommended → applicable
      expect(res.body.counts.mandatory).toBeGreaterThanOrEqual(2);
    });

    it('previews the statutory deadline for a compliance-linked component', async () => {
      // A rule with an fy_end version → a preview is determinable at discovery.
      const ruleCode = `PREV_${unique()}`;
      const rule = await request(app.getHttpServer())
        .post('/api/v1/compliance-rules')
        .set(bearer(mp))
        .send({ code: ruleCode, name: 'Preview Rule', category: 'gst' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
        .set(bearer(mp))
        .send({
          effectiveFrom: '2020-04-01',
          calculationBasis: 'fy_end',
          offsetMonths: 6,
          internalSlaOffsetDays: 15,
        })
        .expect(201);

      const compCode = `PC_${unique()}`;
      await request(app.getHttpServer())
        .post('/api/v1/service-components')
        .set(bearer(mp))
        .send({
          serviceCode: 'GST_MONTHLY',
          code: compCode,
          name: 'Preview Component',
          defaultApplicability: 'recommended',
          complianceRuleCode: ruleCode,
        })
        .expect(201);

      const pa = await token('partner.a@hsdg.in');
      const engId = await createEngagement(pa, 'GST_MONTHLY');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${engId}/components/discovery`)
        .set(bearer(pa))
        .expect(200);
      const row = res.body.rows.find((r: { code: string }) => r.code === compCode);
      // fy_end (31 Mar 2027) + 6 months → 30 Sep 2027; SLA 15 days earlier.
      expect(row.statutoryDeadlinePreview).toBe('2027-09-30');
      expect(row.internalDeadlinePreview).toBe('2027-09-15');
      expect(row.complianceRuleVersionId).toBeTruthy();
    });
  });

  // ── Configuration + duplication + removal (§13/§16/§24) ──────────────────

  describe('component configuration', () => {
    it('selects, dedupes, amends, removes, then re-adds a component', async () => {
      const pa = await token('partner.a@hsdg.in');
      const engId = await createEngagement(pa, 'GST_MONTHLY');

      // Select GSTR1 — applicability defaults from the catalogue (mandatory).
      const created = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/components`)
        .set(bearer(pa))
        .send({ serviceComponentCode: 'GSTR1' })
        .expect(201);
      expect(created.body.applicabilityStatus).toBe('mandatory');
      expect(created.body.status).toBe('draft');
      const componentId = created.body.id as string;

      // Duplicate live configuration → 409 (§16/§35).
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/components`)
        .set(bearer(pa))
        .send({ serviceComponentCode: 'GSTR1' })
        .expect(409);

      // Amend — activate + set frequency; version increments.
      const amended = await request(app.getHttpServer())
        .patch(`/api/v1/engagements/${engId}/components/${componentId}`)
        .set(bearer(pa))
        .send({ status: 'active', frequency: 'monthly', epReviewRequired: true })
        .expect(200);
      expect(amended.body.status).toBe('active');
      expect(amended.body.version).toBe(created.body.version + 1);

      // Remove — soft-cancel (§24); history preserved.
      const removed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/components/${componentId}/remove`)
        .set(bearer(pa))
        .send({ reason: 'Out of scope for this period' })
        .expect(201);
      expect(removed.body.status).toBe('cancelled');

      // The list still contains the cancelled row (history), and re-adding works.
      const listCancelled = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${engId}/components?status=cancelled`)
        .set(bearer(pa))
        .expect(200);
      expect(listCancelled.body.items.length).toBe(1);

      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/components`)
        .set(bearer(pa))
        .send({ serviceComponentCode: 'GSTR1' })
        .expect(201);
    });
  });

  // ── Role / RLS negatives ─────────────────────────────────────────────────

  describe('access control', () => {
    it('blocks a role without engagement.manage from configuring (403)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const engId = await createEngagement(pa, 'GST_MONTHLY');
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/components`)
        .set(bearer(await token('senior.y@hsdg.in')))
        .send({ serviceComponentCode: 'GSTR1' })
        .expect(403);
    });

    it('does not let an unassigned partner discover or configure another’s engagement (404)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const engId = await createEngagement(pa, 'GST_MONTHLY');
      const pb = await token('partner.b@hsdg.in');

      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${engId}/components/discovery`)
        .set(bearer(pb))
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/components`)
        .set(bearer(pb))
        .send({ serviceComponentCode: 'GSTR1' })
        .expect(404);
    });
  });
});

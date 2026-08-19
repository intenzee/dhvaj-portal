import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Phase 8 — Compliance Engine, through the HTTP API.
 *
 * Headline acceptance (§10): change a FUTURE rule (add a new effective-dated
 * version) — an existing compliance instance stays exactly as it was
 * calculated, because instances snapshot the version they used and are never
 * recomputed. Plus: two separate clocks (statutory + internal SLA), conditional
 * applicability, audited overrides, working-day config, and role/RLS negatives.
 */
describe('Compliance Engine (e2e)', () => {
  let app: INestApplication;
  let mp: string; // Managing Partner: firm-wide + compliance.manage (config authority)

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

  /** A partner-owned engagement (partner becomes EP), at the given financial year. */
  const createEngagement = async (epToken: string, financialYear: string): Promise<string> => {
    const entityId = await findEntityId('Bharat'); // North client
    const serviceId = await findServiceId('ITR_FILING');
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

  /** Create a compliance rule + a first version (as the firm-wide MP). */
  const createRule = async (
    code: string,
    version: Record<string, unknown>,
    ruleExtra: Record<string, unknown> = {},
  ): Promise<string> => {
    const rule = await request(app.getHttpServer())
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code, name: code, ...ruleExtra })
      .expect(201);
    const ruleId = rule.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/compliance-rules/${ruleId}/versions`)
      .set(bearer(mp))
      .send(version)
      .expect(201);
    return ruleId;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── HEADLINE ACCEPTANCE ──────────────────────────────────────────────────
  describe('changing a future rule leaves historical instances unchanged', () => {
    it('an instance keeps its snapshotted version + deadline after a new future version is added', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `ITR_${unique()}`;
      // v1: FY end + 7 months, no working-day adjustment ⇒ deterministic.
      await createRule(code, {
        effectiveFrom: '2020-04-01',
        calculationBasis: 'fy_end',
        offsetMonths: 7,
        workingDayAdjustment: 'none',
        internalSlaOffsetDays: 30,
      });

      // Engagement for FY 2026-27 (FY end 2027-03-31 ⇒ statutory 2027-10-31).
      const eng = await createEngagement(pa, '2026-27');
      const generated = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code })
        .expect(201);
      const instanceId = generated.body.id as string;
      expect(generated.body.statutoryDeadline).toBe('2027-10-31');
      expect(generated.body.complianceRuleVersion).toBe(1);
      // Two distinct clocks; SLA is before the statutory deadline.
      expect(generated.body.effectiveInternalSlaDate < generated.body.statutoryDeadline).toBe(true);

      // The firm CHANGES the rule for the future: v2 effective 2028-01-01, +8 months.
      const ruleRes = await request(app.getHttpServer())
        .get(`/api/v1/compliance-rules/${code}`)
        .set(bearer(mp))
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/compliance-rules/${ruleRes.body.id}/versions`)
        .set(bearer(mp))
        .send({
          effectiveFrom: '2028-01-01',
          calculationBasis: 'fy_end',
          offsetMonths: 8,
          workingDayAdjustment: 'none',
          internalSlaOffsetDays: 30,
        })
        .expect(201);

      // The existing instance is UNCHANGED — same version, same deadline.
      const after = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/compliance/${instanceId}`)
        .set(bearer(pa))
        .expect(200);
      expect(after.body.complianceRuleVersion).toBe(1);
      expect(after.body.statutoryDeadline).toBe('2027-10-31');
    });

    it('a future-period engagement picks up the newer version (selection by reference date)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `ITR2_${unique()}`;
      await createRule(code, {
        effectiveFrom: '2020-04-01',
        calculationBasis: 'fy_end',
        offsetMonths: 7,
        workingDayAdjustment: 'none',
      });
      const ruleRes = await request(app.getHttpServer())
        .get(`/api/v1/compliance-rules/${code}`)
        .set(bearer(mp));
      await request(app.getHttpServer())
        .post(`/api/v1/compliance-rules/${ruleRes.body.id}/versions`)
        .set(bearer(mp))
        .send({
          effectiveFrom: '2028-01-01',
          calculationBasis: 'fy_end',
          offsetMonths: 8,
          workingDayAdjustment: 'none',
        })
        .expect(201);

      // FY 2028-29 (FY end 2029-03-31 ≥ 2028-01-01) ⇒ v2, +8 months ⇒ 2029-11-30.
      const eng = await createEngagement(pa, '2028-29');
      const generated = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code })
        .expect(201);
      expect(generated.body.complianceRuleVersion).toBe(2);
      expect(generated.body.statutoryDeadline).toBe('2029-11-30');
    });
  });

  // ── Two clocks + overdue + override ──────────────────────────────────────
  describe('two clocks, overdue detection, and audited overrides', () => {
    it('computes a period-end deadline, flags it overdue, then an override clears it (audited)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `GST_${unique()}`;
      // GST: period end + 20 days.
      await createRule(
        code,
        {
          effectiveFrom: '2017-07-01',
          calculationBasis: 'period_end',
          offsetDays: 20,
          workingDayAdjustment: 'none',
          internalSlaOffsetDays: 5,
        },
        { category: 'gst' },
      );
      const eng = await createEngagement(pa, '2020-21');
      // Period ending 2020-01-31 ⇒ statutory 2020-02-20 (in the past ⇒ overdue).
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2020-01-31' })
        .expect(201);
      expect(gen.body.statutoryDeadline).toBe('2020-02-20');
      // Internal SLA (separate clock) = statutory − 5 = Sat 2020-02-15 → previous → Fri 2020-02-14.
      expect(gen.body.internalSlaDate).toBe('2020-02-14');
      expect(gen.body.effectiveInternalSlaDate).toBe('2020-02-14');
      expect(gen.body.isStatutoryOverdue).toBe(true);
      expect(gen.body.isInternallyOverdue).toBe(true);

      const instanceId = gen.body.id as string;
      const correlationId = `corr-ovr-${unique()}`;
      // Override the statutory clock to a future date (reason required).
      const overridden = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${instanceId}/override`)
        .set(bearer(pa))
        .set('x-correlation-id', correlationId)
        .send({
          clock: 'statutory',
          newDate: '2099-12-31',
          reason: 'CBDT extension',
          evidenceReference: 'NOTIF/123',
        })
        .expect(201);
      expect(overridden.body.statutoryDeadlineOverride).toBe('2099-12-31');
      expect(overridden.body.effectiveStatutoryDeadline).toBe('2099-12-31');
      expect(overridden.body.isStatutoryOverdue).toBe(false); // future now
      // The computed snapshot is preserved alongside the override.
      expect(overridden.body.statutoryDeadline).toBe('2020-02-20');
      expect(overridden.body.overrides[0].reason).toBe('CBDT extension');

      // The override is in the audit trail.
      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(mp))
        .expect(200);
      expect(
        (audit.body.items as Array<{ action: string; correlationId: string }>).some(
          (e) => e.action === 'compliance.deadline_overridden' && e.correlationId === correlationId,
        ),
      ).toBe(true);
    });

    it('applies working-day adjustment (next) over a weekend + holiday', async () => {
      const pa = await token('partner.a@hsdg.in');
      // Seed a holiday on Mon 2026-06-22 (tolerate 409 if a prior run added it —
      // the holiday calendar is a fixed-date firm-wide table on a shared dev DB).
      const holiday = await request(app.getHttpServer())
        .post('/api/v1/compliance-holidays')
        .set(bearer(mp))
        .send({ date: '2026-06-22', name: 'Test Holiday' });
      expect([201, 409]).toContain(holiday.status);
      const code = `WD_${unique()}`;
      await createRule(code, {
        effectiveFrom: '2017-07-01',
        calculationBasis: 'period_end',
        offsetDays: 0,
        workingDayAdjustment: 'next',
      });
      const eng = await createEngagement(pa, '2026-27');
      // 2026-06-20 is a Saturday; Sun 21; Mon 22 holiday ⇒ next working day Tue 2026-06-23.
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2026-06-20' })
        .expect(201);
      expect(gen.body.statutoryDeadline).toBe('2026-06-23');
    });
  });

  // ── Conditional applicability ────────────────────────────────────────────
  describe('conditional rules', () => {
    it('applies only when the supplied context satisfies the condition', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `COND_${unique()}`;
      await createRule(code, {
        effectiveFrom: '2017-07-01',
        calculationBasis: 'fy_end',
        offsetMonths: 6,
        workingDayAdjustment: 'none',
        condition: { field: 'turnover', op: '>', value: 10_000_000 },
      });
      const eng = await createEngagement(pa, '2026-27');
      // Below threshold ⇒ does not apply.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, context: { turnover: 5_000_000 } })
        .expect(400);
      // Above threshold ⇒ applies.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, context: { turnover: 50_000_000 } })
        .expect(201);
    });
  });

  // ── Complete / duplicate ─────────────────────────────────────────────────
  describe('instance lifecycle', () => {
    it('completes an obligation and prevents a duplicate for the same period (409)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `DUP_${unique()}`;
      await createRule(code, {
        effectiveFrom: '2017-07-01',
        calculationBasis: 'fy_end',
        offsetMonths: 6,
        workingDayAdjustment: 'none',
      });
      const eng = await createEngagement(pa, '2026-27');
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code })
        .expect(201);
      // Duplicate (same engagement + rule + reference date) is rejected.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code })
        .expect(409);
      // Complete it.
      const done = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/complete`)
        .set(bearer(pa))
        .send({ version: gen.body.version })
        .expect(201);
      expect(done.body.status).toBe('completed');
      expect(done.body.isStatutoryOverdue).toBe(false);
      // A completed obligation cannot be completed again.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/complete`)
        .set(bearer(pa))
        .send({})
        .expect(400);
    });
  });

  // ── Authority & RLS ──────────────────────────────────────────────────────
  describe('authority & RLS', () => {
    it('forbids a Partner (no compliance.manage) from configuring rules (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/compliance-rules')
        .set(bearer(await token('partner.a@hsdg.in')))
        .send({ code: `X_${unique()}`, name: 'x' })
        .expect(403);
    });

    it('lets the platform admin configure rules but NOT manage engagement compliance', async () => {
      const admin = await token('admin@hsdg.in');
      const code = `ADM_${unique()}`;
      // admin has compliance.manage (config authority).
      const rule = await request(app.getHttpServer())
        .post('/api/v1/compliance-rules')
        .set(bearer(admin))
        .send({ code, name: code })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
        .set(bearer(admin))
        .send({ effectiveFrom: '2020-04-01', calculationBasis: 'fy_end', offsetMonths: 7 })
        .expect(201);
      // …but no engagement.manage ⇒ cannot generate on an engagement.
      const pa = await token('partner.a@hsdg.in');
      const eng = await createEngagement(pa, '2026-27');
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(admin))
        .send({ complianceRuleCode: code })
        .expect(403);
    });

    it('forbids a Senior (no engagement.manage) from generating an instance (403)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `SEN_${unique()}`;
      await createRule(code, {
        effectiveFrom: '2020-04-01',
        calculationBasis: 'fy_end',
        offsetMonths: 7,
      });
      const eng = await createEngagement(pa, '2026-27');
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(await token('senior.y@hsdg.in')))
        .send({ complianceRuleCode: code })
        .expect(403);
    });

    it('does not let an unassigned partner generate/list compliance on another’s engagement (404)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `RLS_${unique()}`;
      await createRule(code, {
        effectiveFrom: '2020-04-01',
        calculationBasis: 'fy_end',
        offsetMonths: 7,
      });
      const eng = await createEngagement(pa, '2026-27');
      const pb = await token('partner.b@hsdg.in');
      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pb))
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pb))
        .send({ complianceRuleCode: code })
        .expect(404);
    });
  });
});

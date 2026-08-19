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
  const createEngagement = async (
    epToken: string,
    financialYear: string,
    serviceCode = 'ITR_FILING',
  ): Promise<string> => {
    const entityId = await findEntityId('Bharat'); // North client
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

  // ── Version selection for DERIVED reference dates (fixed_date / event_date) ──
  describe('version selection for derived reference dates', () => {
    it('fixed_date: picks the version in force at FY end and uses its month/day', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `FIX_${unique()}`;
      // v1: 31 Oct; v2 (future): 30 Nov.
      const ruleId = await createRule(code, {
        effectiveFrom: '2020-04-01',
        calculationBasis: 'fixed_date',
        fixedMonth: 10,
        fixedDay: 31,
        workingDayAdjustment: 'none',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/compliance-rules/${ruleId}/versions`)
        .set(bearer(mp))
        .send({
          effectiveFrom: '2028-01-01',
          calculationBasis: 'fixed_date',
          fixedMonth: 11,
          fixedDay: 30,
          workingDayAdjustment: 'none',
        })
        .expect(201);

      // FY 2026-27 (FY end 2027-03-31 < 2028-01-01) ⇒ v1 ⇒ 2027-10-31.
      const engA = await createEngagement(pa, '2026-27');
      const a = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engA}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code })
        .expect(201);
      expect(a.body.complianceRuleVersion).toBe(1);
      expect(a.body.statutoryDeadline).toBe('2027-10-31');

      // FY 2028-29 (FY end 2029-03-31 ≥ 2028-01-01) ⇒ v2 ⇒ 2029-11-30.
      const engB = await createEngagement(pa, '2028-29');
      const b = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engB}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code })
        .expect(201);
      expect(b.body.complianceRuleVersion).toBe(2);
      expect(b.body.statutoryDeadline).toBe('2029-11-30');
    });

    it('event_date: selects the version as of the event date and rejects both dates', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `EVT_${unique()}`;
      const ruleId = await createRule(code, {
        effectiveFrom: '2020-04-01',
        calculationBasis: 'event_date',
        offsetDays: 30,
        workingDayAdjustment: 'none',
      });
      await request(app.getHttpServer())
        .post(`/api/v1/compliance-rules/${ruleId}/versions`)
        .set(bearer(mp))
        .send({
          effectiveFrom: '2027-01-01',
          calculationBasis: 'event_date',
          offsetDays: 45,
          workingDayAdjustment: 'none',
        })
        .expect(201);
      const eng = await createEngagement(pa, '2026-27');

      // Event before v2 ⇒ v1 (+30d): 2026-08-15 → 2026-09-14.
      const a = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, eventDate: '2026-08-15' })
        .expect(201);
      expect(a.body.complianceRuleVersion).toBe(1);
      expect(a.body.statutoryDeadline).toBe('2026-09-14');

      // Event on/after v2 ⇒ v2 (+45d): 2027-06-01 → 2027-07-16.
      const b = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, eventDate: '2027-06-01' })
        .expect(201);
      expect(b.body.complianceRuleVersion).toBe(2);
      expect(b.body.statutoryDeadline).toBe('2027-07-16');

      // Supplying both referenceDate AND eventDate is ambiguous ⇒ 400.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, eventDate: '2026-08-15', referenceDate: '2026-08-15' })
        .expect(400);
    });
  });

  // ── Bulk generation, list filter, firm-wide calendar ─────────────────────
  describe('bulk generation, status filter, and the firm-wide calendar', () => {
    it('generates obligations for every derivable rule on the service, skipping the rest', async () => {
      const pa = await token('partner.a@hsdg.in');
      // Two fy_end rules on ROC_ANNUAL (derivable) + one period_end rule (needs a date ⇒ skipped).
      const okA = `BULKA_${unique()}`;
      const okB = `BULKB_${unique()}`;
      const needsDate = `BULKC_${unique()}`;
      await createRule(
        okA,
        { effectiveFrom: '2020-04-01', calculationBasis: 'fy_end', offsetMonths: 7 },
        { serviceCode: 'ROC_ANNUAL' },
      );
      await createRule(
        okB,
        { effectiveFrom: '2020-04-01', calculationBasis: 'fy_end', offsetMonths: 9 },
        { serviceCode: 'ROC_ANNUAL' },
      );
      await createRule(
        needsDate,
        { effectiveFrom: '2020-04-01', calculationBasis: 'period_end', offsetDays: 20 },
        { serviceCode: 'ROC_ANNUAL' },
      );

      const eng = await createEngagement(pa, '2026-27', 'ROC_ANNUAL');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/generate-for-service`)
        .set(bearer(pa))
        .send({})
        .expect(201);
      const generatedCodes = (res.body.generated as Array<{ complianceRuleCode: string }>).map(
        (g) => g.complianceRuleCode,
      );
      expect(generatedCodes).toEqual(expect.arrayContaining([okA, okB]));
      const skippedCodes = (res.body.skipped as Array<{ rule: string }>).map((s) => s.rule);
      expect(skippedCodes).toContain(needsDate); // period_end needs an explicit date
    });

    it('filters the per-engagement list by status', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `LST_${unique()}`;
      await createRule(code, {
        effectiveFrom: '2020-04-01',
        calculationBasis: 'fy_end',
        offsetMonths: 7,
      });
      const eng = await createEngagement(pa, '2026-27');
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/complete`)
        .set(bearer(pa))
        .send({ version: gen.body.version })
        .expect(201);
      // Only-open filter now returns nothing; completed filter returns it.
      const open = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/compliance?status=open`)
        .set(bearer(pa))
        .expect(200);
      expect(open.body.total).toBe(0);
      const done = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/compliance?status=completed`)
        .set(bearer(pa))
        .expect(200);
      expect(done.body.total).toBe(1);
    });

    it('exposes an RLS-scoped firm-wide calendar with overdue filtering', async () => {
      const pa = await token('partner.a@hsdg.in');
      const code = `CAL_${unique()}`;
      await createRule(code, {
        effectiveFrom: '2017-07-01',
        calculationBasis: 'period_end',
        offsetDays: 20,
        workingDayAdjustment: 'none',
      });
      const eng = await createEngagement(pa, '2020-21');
      // A past-due obligation (2020-02-20).
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2020-01-31' })
        .expect(201);

      // The EP sees it on their calendar (tight window), enriched with context.
      const window = '?status=open&dueFrom=2020-02-20&dueTo=2020-02-20&overdueOnly=true&limit=100';
      const cal = await request(app.getHttpServer())
        .get(`/api/v1/compliance${window}`)
        .set(bearer(pa))
        .expect(200);
      const mine = (
        cal.body.items as Array<{ id: string; engagementCode: string; entityName: string }>
      ).find((i) => i.id === gen.body.id);
      expect(mine).toBeDefined();
      expect(mine!.entityName).toBe('Bharat Textiles LLP');

      // An unrelated partner does NOT see it on their calendar (RLS-scoped).
      const pbCal = await request(app.getHttpServer())
        .get(`/api/v1/compliance${window}`)
        .set(bearer(await token('partner.b@hsdg.in')))
        .expect(200);
      expect((pbCal.body.items as Array<{ id: string }>).some((i) => i.id === gen.body.id)).toBe(
        false,
      );
    });

    it('?activeOnly=false is parsed correctly (regression: Boolean("false") is truthy)', async () => {
      const code = `INACT_${unique()}`;
      const ruleId = await createRule(code, {
        effectiveFrom: '2020-04-01',
        calculationBasis: 'fy_end',
        offsetMonths: 7,
      });
      // Deactivate it.
      await request(app.getHttpServer())
        .patch(`/api/v1/compliance-rules/${ruleId}/active`)
        .set(bearer(mp))
        .send({ isActive: false })
        .expect(200);
      // activeOnly=false must include inactive rules (not coerce to true).
      const res = await request(app.getHttpServer())
        .get(`/api/v1/compliance-rules?activeOnly=false&limit=100`)
        .set(bearer(mp))
        .expect(200);
      expect((res.body.items as Array<{ code: string }>).some((r) => r.code === code)).toBe(true);
    });
  });
});

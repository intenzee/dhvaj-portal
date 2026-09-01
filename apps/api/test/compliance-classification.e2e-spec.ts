import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Due-Date Classification & Service-Component Mapping (spec §2/§3/§6–§15/§19),
 * through the HTTP API. Covers the three gaps closed on top of the Phase 8
 * compliance engine:
 *
 *   1. Frozen due-date CATEGORY (§2) + SOURCE (§3) on rules, instances and
 *      catalogue components (independent of the statutory DOMAIN category).
 *   2. Government EXTENSIONS as append-only overlays (§19): revised operative
 *      date with the original retained; applied to an obligation by reference.
 *   3. Effective-statutory precedence: manual override (§20) ▸ extension (§19)
 *      ▸ computed snapshot — and the calendar surfaces the operative date.
 */
describe('Due-Date Classification & Government Extensions (e2e)', () => {
  let app: INestApplication;
  let mp: string; // Managing Partner: firm-wide + compliance.manage + service.manage

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

  const createEngagement = async (
    epToken: string,
    financialYear: string,
    serviceCode = 'ITR_FILING',
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

  /** A GST-style rule: period end + 20 days, no working-day adjustment (deterministic). */
  const gstVersion = {
    effectiveFrom: '2017-07-01',
    calculationBasis: 'period_end',
    offsetDays: 20,
    workingDayAdjustment: 'none',
    internalSlaOffsetDays: 5,
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── 1. Due-date CATEGORY + SOURCE on rules and instances ─────────────────
  describe('frozen due-date category (§2) and source (§3)', () => {
    it('stores category + source on a rule and surfaces them on generated instances', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const code = `CLS_${unique()}`;
      await createRule(code, gstVersion, {
        category: 'gst',
        dueDateCategory: 'STATUTORY_FIXED',
        dueDateSource: 'LAW_RULE',
      });

      // The rule carries both classification axes independently of the domain.
      const rule = await request(app.getHttpServer())
        .get(`/api/v1/compliance-rules/${code}`)
        .set(bearer(mp))
        .expect(200);
      expect(rule.body.category).toBe('gst'); // statutory DOMAIN
      expect(rule.body.dueDateCategory).toBe('STATUTORY_FIXED'); // §2 how-generated
      expect(rule.body.dueDateSource).toBe('LAW_RULE'); // §3 authority

      // Generated obligations inherit the rule's classification for the calendar.
      const eng = await createEngagement(pa, '2020-21');
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2020-01-31' })
        .expect(201);
      expect(gen.body.dueDateCategory).toBe('STATUTORY_FIXED');
      expect(gen.body.dueDateSource).toBe('LAW_RULE');
      expect(gen.body.isExtended).toBe(false);
      expect(gen.body.governmentExtension).toBeNull();
    });

    it('defaults an unclassified rule to NO_FIXED_DATE and lets it be classified later', async () => {
      const code = `UNCLS_${unique()}`;
      const ruleId = await createRule(code, gstVersion); // no classification supplied
      const created = await request(app.getHttpServer())
        .get(`/api/v1/compliance-rules/${code}`)
        .set(bearer(mp))
        .expect(200);
      expect(created.body.dueDateCategory).toBe('NO_FIXED_DATE');
      expect(created.body.dueDateSource).toBeNull();

      // Classify it in place (no new rule version).
      const classified = await request(app.getHttpServer())
        .patch(`/api/v1/compliance-rules/${ruleId}/classification`)
        .set(bearer(mp))
        .send({ dueDateCategory: 'HSDG_RECURRING', dueDateSource: 'HSDG_POLICY' })
        .expect(200);
      expect(classified.body.dueDateCategory).toBe('HSDG_RECURRING');
      expect(classified.body.dueDateSource).toBe('HSDG_POLICY');
    });

    it('filters the rule list by due-date category', async () => {
      const code = `EVT_${unique()}`;
      await createRule(code, gstVersion, { dueDateCategory: 'EVENT_SLA' });
      const res = await request(app.getHttpServer())
        .get(`/api/v1/compliance-rules?dueDateCategory=EVENT_SLA&search=${code}&limit=100`)
        .set(bearer(mp))
        .expect(200);
      expect((res.body.items as Array<{ code: string }>).some((r) => r.code === code)).toBe(true);
    });

    it('rejects an invalid due-date category (frozen set enforced)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/compliance-rules')
        .set(bearer(mp))
        .send({ code: `BAD_${unique()}`, name: 'bad', dueDateCategory: 'NOT_A_CATEGORY' })
        .expect(400);
    });
  });

  // ── 2. Government extensions (§19) — firm-wide config + authority ─────────
  describe('government extensions: firm-wide config (§19)', () => {
    it('lets the MP import an extension and forbids a partner without compliance.manage', async () => {
      const code = `GX_${unique()}`;
      await createRule(code, gstVersion, { dueDateCategory: 'STATUTORY_FIXED' });

      const created = await request(app.getHttpServer())
        .post('/api/v1/compliance-extensions')
        .set(bearer(mp))
        .send({
          complianceRuleCode: code,
          originalDueDate: '2026-01-20',
          revisedDueDate: '2026-01-31',
          notificationReference: 'CBIC 01/2026',
          applicablePopulation: 'All GSTR-3B filers',
          effectiveDate: '2026-01-18',
        })
        .expect(201);
      expect(created.body.revisedDueDate).toBe('2026-01-31');
      expect(created.body.originalDueDate).toBe('2026-01-20');
      expect(created.body.notificationReference).toBe('CBIC 01/2026');
      expect(created.body.complianceRuleCode).toBe(code);

      // It is listable and fetchable.
      const list = await request(app.getHttpServer())
        .get(`/api/v1/compliance-extensions?complianceRuleCode=${code}&limit=100`)
        .set(bearer(mp))
        .expect(200);
      expect((list.body.items as Array<{ id: string }>).some((e) => e.id === created.body.id)).toBe(
        true,
      );

      // A partner (no compliance.manage) cannot import one.
      await request(app.getHttpServer())
        .post('/api/v1/compliance-extensions')
        .set(bearer(await token('partner.a@dhvaj.in')))
        .send({
          complianceRuleCode: code,
          originalDueDate: '2026-01-20',
          revisedDueDate: '2026-01-31',
          notificationReference: 'X',
          applicablePopulation: 'Y',
          effectiveDate: '2026-01-18',
        })
        .expect(403);
    });

    it('rejects a revised date earlier than the original (CHECK constraint)', async () => {
      const code = `GXBAD_${unique()}`;
      await createRule(code, gstVersion);
      await request(app.getHttpServer())
        .post('/api/v1/compliance-extensions')
        .set(bearer(mp))
        .send({
          complianceRuleCode: code,
          originalDueDate: '2026-01-31',
          revisedDueDate: '2026-01-20', // earlier ⇒ invalid
          notificationReference: 'N',
          applicablePopulation: 'P',
          effectiveDate: '2026-01-18',
        })
        .expect(400);
    });
  });

  // ── 3. Applying an extension: overlay, precedence, calendar ──────────────
  describe('applying an extension overlay (§19/§20/§24)', () => {
    it('overlays the revised date, retains the original, and is audited', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const code = `APX_${unique()}`;
      await createRule(code, gstVersion, { dueDateCategory: 'STATUTORY_FIXED' });
      const eng = await createEngagement(pa, '2020-21');
      // Computed statutory 2020-02-20 for period end 2020-01-31.
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2020-01-31' })
        .expect(201);
      expect(gen.body.statutoryDeadline).toBe('2020-02-20');
      expect(gen.body.effectiveStatutoryDeadline).toBe('2020-02-20');

      // A government notification revises 2020-02-20 → 2020-03-31.
      const ext = await request(app.getHttpServer())
        .post('/api/v1/compliance-extensions')
        .set(bearer(mp))
        .send({
          complianceRuleCode: code,
          originalDueDate: '2020-02-20',
          revisedDueDate: '2020-03-31',
          notificationReference: 'CBIC-EXT/2020',
          applicablePopulation: 'All filers FY2019-20',
          effectiveDate: '2020-02-18',
        })
        .expect(201);

      const correlationId = `corr-ext-${unique()}`;
      const applied = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/apply-extension`)
        .set(bearer(pa))
        .set('x-correlation-id', correlationId)
        .send({ governmentExtensionId: ext.body.id })
        .expect(201);

      // Operative date is the revised one; the original computed date is retained.
      expect(applied.body.effectiveStatutoryDeadline).toBe('2020-03-31');
      expect(applied.body.revisedStatutoryDeadline).toBe('2020-03-31');
      expect(applied.body.statutoryDeadline).toBe('2020-02-20');
      expect(applied.body.isExtended).toBe(true);
      expect(applied.body.governmentExtension.notificationReference).toBe('CBIC-EXT/2020');
      expect(applied.body.governmentExtension.originalDueDate).toBe('2020-02-20');

      // The application is on the audit trail.
      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(mp))
        .expect(200);
      expect(
        (audit.body.items as Array<{ action: string; correlationId: string }>).some(
          (e) => e.action === 'compliance.extension_applied' && e.correlationId === correlationId,
        ),
      ).toBe(true);

      // Clearing the overlay reverts to the original computed date.
      const cleared = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/clear-extension`)
        .set(bearer(pa))
        .send({})
        .expect(201);
      expect(cleared.body.isExtended).toBe(false);
      expect(cleared.body.effectiveStatutoryDeadline).toBe('2020-02-20');
      expect(cleared.body.governmentExtension).toBeNull();
    });

    it('manual override (§20) takes precedence over a government extension (§19)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const code = `PREC_${unique()}`;
      await createRule(code, gstVersion);
      const eng = await createEngagement(pa, '2020-21');
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2020-01-31' })
        .expect(201);
      const ext = await request(app.getHttpServer())
        .post('/api/v1/compliance-extensions')
        .set(bearer(mp))
        .send({
          complianceRuleCode: code,
          originalDueDate: '2020-02-20',
          revisedDueDate: '2020-03-31',
          notificationReference: 'N',
          applicablePopulation: 'P',
          effectiveDate: '2020-02-18',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/apply-extension`)
        .set(bearer(pa))
        .send({ governmentExtensionId: ext.body.id })
        .expect(201);
      // Now a manual override wins over the extension.
      const overridden = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/override`)
        .set(bearer(pa))
        .send({ clock: 'statutory', newDate: '2020-04-15', reason: 'Bespoke approval' })
        .expect(201);
      expect(overridden.body.effectiveStatutoryDeadline).toBe('2020-04-15');
      // Both the extension and the original remain recorded underneath.
      expect(overridden.body.isExtended).toBe(true);
      expect(overridden.body.revisedStatutoryDeadline).toBe('2020-03-31');
      expect(overridden.body.statutoryDeadline).toBe('2020-02-20');
    });

    it('rejects applying an extension that targets a different rule (400)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const codeA = `XRA_${unique()}`;
      const codeB = `XRB_${unique()}`;
      await createRule(codeA, gstVersion);
      await createRule(codeB, gstVersion);
      const eng = await createEngagement(pa, '2020-21');
      const instB = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: codeB, referenceDate: '2020-01-31' })
        .expect(201);
      const extA = await request(app.getHttpServer())
        .post('/api/v1/compliance-extensions')
        .set(bearer(mp))
        .send({
          complianceRuleCode: codeA,
          originalDueDate: '2020-02-20',
          revisedDueDate: '2020-03-31',
          notificationReference: 'N',
          applicablePopulation: 'P',
          effectiveDate: '2020-02-18',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${instB.body.id}/apply-extension`)
        .set(bearer(pa))
        .send({ governmentExtensionId: extA.body.id })
        .expect(400);
    });

    it('surfaces the revised (operative) date on the firm-wide calendar, not the original', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const code = `CALX_${unique()}`;
      await createRule(code, gstVersion);
      const eng = await createEngagement(pa, '2020-21');
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2020-01-31' })
        .expect(201);
      const ext = await request(app.getHttpServer())
        .post('/api/v1/compliance-extensions')
        .set(bearer(mp))
        .send({
          complianceRuleCode: code,
          originalDueDate: '2020-02-20',
          revisedDueDate: '2020-03-31',
          notificationReference: 'N',
          applicablePopulation: 'P',
          effectiveDate: '2020-02-18',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/apply-extension`)
        .set(bearer(pa))
        .send({ governmentExtensionId: ext.body.id })
        .expect(201);

      // A window around the REVISED date includes it…
      const revisedWindow = await request(app.getHttpServer())
        .get('/api/v1/compliance?dueFrom=2020-03-31&dueTo=2020-03-31&limit=100')
        .set(bearer(pa))
        .expect(200);
      expect(
        (revisedWindow.body.items as Array<{ id: string }>).some((i) => i.id === gen.body.id),
      ).toBe(true);

      // …and a window around the ORIGINAL date no longer does (deadline moved).
      const originalWindow = await request(app.getHttpServer())
        .get('/api/v1/compliance?dueFrom=2020-02-20&dueTo=2020-02-20&limit=100')
        .set(bearer(pa))
        .expect(200);
      expect(
        (originalWindow.body.items as Array<{ id: string }>).some((i) => i.id === gen.body.id),
      ).toBe(false);
    });
  });

  // ── 4. Component mapping (§6–§15): classification on the catalogue ────────
  describe('catalogue component classification (§6–§15)', () => {
    it('tags a service component with a due-date category + source and reads them back', async () => {
      const code = `COMPCLS${unique()}`.slice(0, 40).toUpperCase();
      const created = await request(app.getHttpServer())
        .post('/api/v1/service-components')
        .set(bearer(mp))
        .send({
          serviceCode: 'GST_MONTHLY',
          code,
          name: 'GSTR-1 classified',
          defaultFrequency: 'monthly',
          dueDateCategory: 'STATUTORY_FIXED',
          dueDateSource: 'LAW_RULE',
        })
        .expect(201);
      expect(created.body.dueDateCategory).toBe('STATUTORY_FIXED');
      expect(created.body.dueDateSource).toBe('LAW_RULE');

      // Re-classify via update.
      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/service-components/${created.body.id}`)
        .set(bearer(mp))
        .send({ dueDateCategory: 'HSDG_RECURRING', dueDateSource: null })
        .expect(200);
      expect(updated.body.dueDateCategory).toBe('HSDG_RECURRING');
      expect(updated.body.dueDateSource).toBeNull();

      // A brand-new component with no classification defaults to NO_FIXED_DATE.
      const plain = await request(app.getHttpServer())
        .post('/api/v1/service-components')
        .set(bearer(mp))
        .send({ serviceCode: 'GST_MONTHLY', code: `${code}B`.slice(0, 50), name: 'plain' })
        .expect(201);
      expect(plain.body.dueDateCategory).toBe('NO_FIXED_DATE');
    });

    it('ships the seeded catalogue pre-classified per the spec mapping (§6–§15)', async () => {
      // The 0029 migration classified the seeded components. Spot-check the
      // three archetypes: statutory-fixed filing, internal recurring, milestone.
      const expected: Record<string, [string, string]> = {
        GSTR1: ['STATUTORY_FIXED', 'LAW_RULE'],
        GSTR3B: ['STATUTORY_FIXED', 'LAW_RULE'],
        GSTR9: ['STATUTORY_RULE', 'LAW_RULE'],
        ITR_FILE: ['STATUTORY_RULE', 'LAW_RULE'],
        ITC_RECON: ['HSDG_RECURRING', 'HSDG_POLICY'],
        BK_CLOSE: ['HSDG_RECURRING', 'HSDG_POLICY'],
        SA_PLANNING: ['HSDG_MILESTONE', 'WORKFLOW'],
        BK_MIS: ['CLIENT_COMMITTED', 'CLIENT_COMMITMENT'],
      };
      for (const [code, [cat, src]] of Object.entries(expected)) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/service-components/${code}`)
          .set(bearer(mp))
          .expect(200);
        expect([code, res.body.dueDateCategory]).toEqual([code, cat]);
        expect([code, res.body.dueDateSource]).toEqual([code, src]);
      }
    });

    it('ships the FULL §6–§15 catalogue expansion, each component classified', async () => {
      // The 0034 migration populates the rest of the firm offering. Spot-check
      // one archetype from each spec section, spanning every §2 category family.
      const expected: Record<string, [string, string | null]> = {
        SA_PBC: ['CLIENT_COMMITTED', 'CLIENT_COMMITMENT'], // §6 audit PBC
        IFC_TESTING: ['HSDG_MILESTONE', 'WORKFLOW'], // §6 IFC
        TDS_PAYMENT: ['STATUTORY_FIXED', 'LAW_RULE'], // §7 TDS deposit
        TXA_NOTICE: ['STATUTORY_EVENT', 'LAW_RULE'], // §7 assessment
        GST_EWAYBILL: ['EVENT_SLA', 'LAW_RULE'], // §8 event + SLA
        CMP08: ['STATUTORY_FIXED', 'LAW_RULE'], // §8 GST
        BK_BANKREC: ['HSDG_RECURRING', 'HSDG_POLICY'], // §9 accounting
        LC_PF: ['STATUTORY_FIXED', 'LAW_RULE'], // §10 labour PF
        ROCE_FILING: ['STATUTORY_EVENT', 'LAW_RULE'], // §11 MCA event
        REG_RENEWAL: ['STATUTORY_FIXED', 'LAW_RULE'], // §12 licence renewal
        TXN_AGREEMENT: ['TASK_DEADLINE', 'USER_ENTERED'], // §13 ad-hoc task
        VAL_REPORT: ['CLIENT_COMMITTED', 'CLIENT_COMMITMENT'], // §14 valuation
        VCFO_CLOSE: ['HSDG_RECURRING', 'HSDG_POLICY'], // §15 CFO close
      };
      for (const [code, [cat, src]] of Object.entries(expected)) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/service-components/${code}`)
          .set(bearer(mp))
          .expect(200);
        expect([code, res.body.dueDateCategory]).toEqual([code, cat]);
        expect([code, res.body.dueDateSource]).toEqual([code, src]);
      }
    });

    it('exposes the new §10/§12 service lines and their services', async () => {
      const services = await request(app.getHttpServer())
        .get('/api/v1/services?limit=100')
        .set(bearer(mp))
        .expect(200);
      const codes = (services.body.items as Array<{ code: string }>).map((s) => s.code);
      for (const code of ['PAYROLL', 'LABOUR_COMPLIANCE', 'REGISTRATIONS', 'FEMA', 'VIRTUAL_CFO']) {
        expect(codes).toContain(code);
      }
    });
  });

  // ── §4 calculation methods ───────────────────────────────────────────────
  describe('calculation methods (§4)', () => {
    it('computes a working-days offset (WORKING_DAYS) end to end', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const code = `WDAYS_${unique()}`;
      // period_end + 2 WORKING days, no weekend nudge.
      await createRule(code, {
        effectiveFrom: '2017-04-01',
        calculationBasis: 'period_end',
        offsetDays: 2,
        offsetWorkingDays: true,
        workingDayAdjustment: 'none',
      });
      const eng = await createEngagement(pa, '2026-27');
      // Reference Fri 2026-11-13 + 2 working days ⇒ Tue 2026-11-17 (skips Sat/Sun).
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2026-11-13' })
        .expect(201);
      expect(gen.body.statutoryDeadline).toBe('2026-11-17');

      // The rule version round-trips the flag.
      const rule = await request(app.getHttpServer())
        .get(`/api/v1/compliance-rules/${code}`)
        .set(bearer(mp))
        .expect(200);
      expect(rule.body.versions[0].offsetWorkingDays).toBe(true);
    });

    it('accepts the period_start basis', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const code = `PSTART_${unique()}`;
      await createRule(code, {
        effectiveFrom: '2017-04-01',
        calculationBasis: 'period_start',
        offsetDays: 10,
        workingDayAdjustment: 'none',
      });
      const eng = await createEngagement(pa, '2026-27');
      // period_start 2026-04-01 + 10 days ⇒ 2026-04-11.
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2026-04-01' })
        .expect(201);
      expect(gen.body.statutoryDeadline).toBe('2026-04-11');
    });
  });

  // ── Statutory-rule coverage completion (0038) ──────────────────────────────
  describe('event-based statutory rule coverage (§7/§8/§11/§14)', () => {
    it('binds the event-limitation rules to their components', async () => {
      const expected: Record<string, string> = {
        TXP_LIMITATION: 'IT_APPEAL_LIMITATION',
        GAP_LIMITATION: 'GST_APPEAL_LIMITATION',
        ITR_VERIFY: 'ITR_VERIFICATION_DUE',
        ROCE_SHARE: 'PAS3_ALLOTMENT',
        ROCE_BEN: 'BEN2_DECLARATION',
        ROCE_FILING: 'ROC_EVENT_FILING',
        INC_INITIAL: 'INC20A_COMMENCEMENT',
        FEMA_FDI: 'FCGPR_REPORTING',
        GSTR_AMEND: 'GST_AMENDMENT_LIMITATION',
        GOV_MEETINGS: 'BOARD_MEETING_QUARTERLY',
      };
      for (const [code, ruleCode] of Object.entries(expected)) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/service-components/${code}`)
          .set(bearer(mp))
          .expect(200);
        expect([code, res.body.complianceRuleCode]).toEqual([code, ruleCode]);
      }
    });

    it('generates an event-based statutory deadline from the seeded limitation rule', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa, '2026-27', 'TAX_APPEAL');
      // IT_APPEAL_LIMITATION: event_date + 30 (working-day 'next'). Order served
      // Mon 2026-06-15 ⇒ Wed 2026-07-15 (a weekday, no nudge).
      const gen = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: 'IT_APPEAL_LIMITATION', eventDate: '2026-06-15' })
        .expect(201);
      expect(gen.body.statutoryDeadline).toBe('2026-07-15');
      expect(gen.body.dueDateCategory).toBe('STATUTORY_EVENT');
      expect(gen.body.dueDateSource).toBe('LAW_RULE');
    });

    it('lists the service’s event-triggered rules for the record-event flow', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa, '2026-27', 'TAX_APPEAL');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/compliance/event-rules`)
        .set(bearer(pa))
        .expect(200);
      const rules = res.body as Array<{
        code: string;
        offsetDays: number;
        dueDateCategory: string;
      }>;
      const appeal = rules.find((r) => r.code === 'IT_APPEAL_LIMITATION');
      expect(appeal).toBeDefined();
      expect(appeal!.offsetDays).toBe(30);
      expect(appeal!.dueDateCategory).toBe('STATUTORY_EVENT');
    });

    it('excludes recurring (non-event) rules from the record-event options', async () => {
      const pa = await token('partner.a@dhvaj.in');
      // ITR_FILING carries both an event rule (ITR_VERIFICATION_DUE, event_date)
      // and a recurring one (ITR_FILING_DUE, fy_end) — only the event rule is an
      // option, since bulk generate-for-service already handles the recurring one.
      const eng = await createEngagement(pa, '2026-27', 'ITR_FILING');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/compliance/event-rules`)
        .set(bearer(pa))
        .expect(200);
      const codes = (res.body as Array<{ code: string }>).map((r) => r.code);
      expect(codes).toContain('ITR_VERIFICATION_DUE');
      expect(codes).not.toContain('ITR_FILING_DUE');
    });
  });
});

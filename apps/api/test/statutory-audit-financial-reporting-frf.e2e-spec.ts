import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditMatterRecord, StatutoryAuditFinancialReporting } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.2 Financial Reporting Framework — the Section 02.2 spec flows end to end:
 * listing route from the listings master (§12), Rules Library citations (§9),
 * FRF-01..03/06 answers, FRF-05 confirm / override / information pending,
 * Engagement Partner approval, the §21 completion items and the §19 blocking
 * Framework Review for a specialised entity.
 */
describe('Statutory Audit — 02.2 FRF workflow (spec §6–§21)', () => {
  let app: INestApplication;
  let mp: string;
  let pa: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const post = (t: string, path: string, body: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set(bearer(t))
      .send(body as object);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  const newAuditFile = async (
    name: string,
    setup?: (entityId: string) => Promise<void>,
  ): Promise<{ engId: string; shellId: string; base: string }> => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `${name} ${stamp()}`,
      typeSlug: 'public_limited',
      officeCode: 'NORTH',
    }).expect(201);
    if (setup) await setup(entity.body.id as string);
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
    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    return {
      engId,
      shellId: shells.body[0].workflowInstanceId as string,
      base: `/api/v1/engagements/${engId}/statutory-audit`,
    };
  };

  const read = async (base: string): Promise<StatutoryAuditFinancialReporting> => {
    const res = await request(app.getHttpServer())
      .get(`${base}/financial-reporting`)
      .set(bearer(pa))
      .expect(200);
    return res.body[0] as StatutoryAuditFinancialReporting;
  };
  const item = (fr: StatutoryAuditFinancialReporting, key: string) =>
    fr.completion?.items.find((i) => i.key === key)?.met;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('listed company below ₹250 cr', () => {
    let f: { engId: string; shellId: string; base: string };

    beforeAll(async () => {
      f = await newAuditFile('FRF Listed Co', async (entityId) => {
        await post(pa, `/api/v1/entities/${entityId}/listings`, {
          exchange: 'nse',
          securityType: 'equity',
          status: 'listed',
        }).expect(201);
      });
      // ₹100 cr at the end of the preceding year (02.1 Card D prior column).
      await post(pa, `${f.base}/${f.shellId}/profile/financials`, {
        parameter: 'net_worth',
        priorValue: 1_000_000_000,
      }).expect(201);
    });

    it('resolves Ind AS through the listing route, citing the Rules Library rule (§3, §12)', async () => {
      const fr = await read(f.base);
      expect(fr.baseFacts.listingStatus).toBe('listed');
      expect(fr.assessment.systemOutcome).toBe('ind_as');
      expect(fr.detail?.limitApplied).toBe('Not applicable (listing route)');
      const fired = fr.detail?.rulesApplied?.find((r) => r.result === 'triggered');
      expect(fired?.ruleCode).toBe('FRF_INDAS_CORP_LISTED_P2');
      expect(fired?.authorityProvisionId).toBeTruthy();
      expect(fr.assessment.authorityProvisionId).toBe(fired?.authorityProvisionId);
      expect(fr.detail?.listing).toMatchObject({
        status: 'listed',
        smeOrItp: false,
        provisoApplies: false,
      });
      expect(fr.viewerIsPartner).toBe(true);
    });

    it('captures FRF-01..03 and validates the FY format', async () => {
      let fr = await read(f.base);
      await post(pa, `${f.base}/${f.shellId}/financial-reporting/facts`, {
        firstIndAsFy: '2024',
        version: fr.assessment.version,
      }).expect(400);
      const res = await post(pa, `${f.base}/${f.shellId}/financial-reporting/facts`, {
        priorFramework: 'accounting_standards',
        priorFrameworkSource: 'FY 2023-24 audited financial statements',
        indAsAlreadyApplicable: 'no',
        voluntaryAnswer: 'no',
        version: fr.assessment.version,
      }).expect(201);
      fr = res.body as StatutoryAuditFinancialReporting;
      expect(fr.capturedFacts.priorFramework).toBe('accounting_standards');
      // Newly listed after an AS year → first Ind AS year is the audit year.
      expect(fr.detail?.effectiveFromFy).toBe('2024-25');
      expect(fr.firstTimeAdoption?.system).toBe(true);
      expect(item(fr, 'prior_framework')).toBe(true);
      expect(item(fr, 'voluntary')).toBe(true);
      expect(item(fr, 'exception')).toBe(true);
      expect(item(fr, 'professional_conclusion')).toBe(false);
    });

    it('FRF-05 confirm: takes the system outcome; FRF-06 override needs a reason', async () => {
      let fr = await read(f.base);
      const res = await post(pa, `${f.base}/${f.shellId}/financial-reporting/decision`, {
        action: 'confirm',
        version: fr.assessment.version,
      }).expect(201);
      fr = res.body as StatutoryAuditFinancialReporting;
      expect(fr.assessment.conclusion).toBe('ind_as');
      expect(fr.assessment.state).toBe('applicable');
      expect(fr.partnerApproval?.required).toBe(false);
      expect(item(fr, 'first_time')).toBe(false);

      await post(pa, `${f.base}/${f.shellId}/financial-reporting/facts`, {
        firstTimeAdoption: false,
        version: fr.assessment.version,
      }).expect(400);
      const ok = await post(pa, `${f.base}/${f.shellId}/financial-reporting/facts`, {
        firstTimeAdoption: true,
        version: fr.assessment.version,
      }).expect(201);
      fr = ok.body as StatutoryAuditFinancialReporting;
      // FRF-06 sits on top of the conclusion — it does not clear it.
      expect(fr.assessment.conclusion).toBe('ind_as');
      expect(fr.firstTimeAdoption?.effective).toBe(true);
      expect(item(fr, 'first_time')).toBe(true);
    });

    it('FRF-05 override needs a basis and Engagement Partner approval (not just any lead)', async () => {
      let fr = await read(f.base);
      await post(pa, `${f.base}/${f.shellId}/financial-reporting/decision`, {
        action: 'override',
        conclusion: 'accounting_standards',
        version: fr.assessment.version,
      }).expect(400);
      const res = await post(pa, `${f.base}/${f.shellId}/financial-reporting/decision`, {
        action: 'override',
        conclusion: 'accounting_standards',
        basis: 'Listing withdrawn before the year end (e2e).',
        version: fr.assessment.version,
      }).expect(201);
      fr = res.body as StatutoryAuditFinancialReporting;
      expect(fr.assessment.state).toBe('overridden');
      expect(fr.partnerApproval).toMatchObject({ required: true, approvedAt: null });
      expect(fr.memoSuggested).toBe(true);
      expect(item(fr, 'partner_approval')).toBe(false);

      // The managing partner is a firm lead but not this engagement's partner.
      await post(mp, `${f.base}/${f.shellId}/financial-reporting/partner-approve`, {
        version: fr.assessment.version,
      }).expect(403);
      const approved = await post(
        pa,
        `${f.base}/${f.shellId}/financial-reporting/partner-approve`,
        {
          note: 'Agreed (e2e).',
          version: fr.assessment.version,
        },
      ).expect(201);
      fr = approved.body as StatutoryAuditFinancialReporting;
      expect(fr.partnerApproval?.approvedByName).toBeTruthy();
      expect(item(fr, 'partner_approval')).toBe(true);

      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(mp))
        .expect(200);
      expect((audit.body.items as Array<{ action: string }>).map((e) => e.action)).toContain(
        'statutory_audit.financial_reporting_partner_approved',
      );
    });

    it('a changed fact clears the recorded conclusion and its approval', async () => {
      const fr = await read(f.base);
      const res = await post(pa, `${f.base}/${f.shellId}/financial-reporting/facts`, {
        voluntaryAnswer: 'pending',
        version: fr.assessment.version,
      }).expect(201);
      const after = res.body as StatutoryAuditFinancialReporting;
      expect(after.assessment.conclusion).toBeNull();
      expect(after.partnerApproval?.approvedAt).toBeNull();
    });

    it('FRF-05 Information Pending needs a reason and raises a blocking matter', async () => {
      let fr = await read(f.base);
      await post(pa, `${f.base}/${f.shellId}/financial-reporting/decision`, {
        action: 'information_pending',
        version: fr.assessment.version,
      }).expect(400);
      const res = await post(pa, `${f.base}/${f.shellId}/financial-reporting/decision`, {
        action: 'information_pending',
        pendingReason: 'Board minute on the listing withdrawal',
        version: fr.assessment.version,
      }).expect(201);
      fr = res.body as StatutoryAuditFinancialReporting;
      expect(fr.assessment.state).toBe('pending_information');
      expect(fr.professionalAction).toBe('information_pending');
      expect(fr.pendingReason).toBe('Board minute on the listing withdrawal');
      const matters = await request(app.getHttpServer())
        .get(`${f.base}/${f.shellId}/matters?section=framework`)
        .set(bearer(pa))
        .expect(200);
      const m = (matters.body as AuditMatterRecord[]).find(
        (x) => x.source === 'framework:02.2:information',
      );
      expect(m?.isBlocking).toBe(true);
      expect(m?.title).toContain('Board minute');
    });
  });

  describe('banking company', () => {
    let f: { engId: string; shellId: string; base: string };

    beforeAll(async () => {
      f = await newAuditFile('FRF Bank');
      const profile = await request(app.getHttpServer())
        .get(`${f.base}/profile`)
        .set(bearer(pa))
        .expect(200);
      await post(pa, `${f.base}/${f.shellId}/profile`, {
        specialEntityTypes: ['bank'],
        version: profile.body[0].version,
      }).expect(201);
    });

    it('routes to the specialised framework and opens a blocking Framework Review (§8, §19)', async () => {
      const first = await read(f.base);
      // Persist the suggestion so the matter register reflects it.
      await post(pa, `${f.base}/${f.shellId}/financial-reporting/run-suggestions`, {}).expect(201);
      const fr = await read(f.base);
      expect(first.assessment.systemOutcome).toBe('specialised_framework');
      expect(fr.detail?.entityBranch).toBe('bank');
      expect(fr.detail?.rulesApplied?.[0]?.ruleCode).toBe('FRF_ROUTE_BANK');
      expect(fr.blockingReviewOpen).toBe(true);
      expect(item(fr, 'no_blocking_review')).toBe(false);
    });

    it('closes the review once concluded and Partner-approved', async () => {
      let fr = await read(f.base);
      const res = await post(pa, `${f.base}/${f.shellId}/financial-reporting/decision`, {
        action: 'confirm',
        version: fr.assessment.version,
      }).expect(201);
      fr = res.body as StatutoryAuditFinancialReporting;
      expect(fr.assessment.conclusion).toBe('specialised_framework');
      expect(fr.partnerApproval?.required).toBe(true);
      expect(fr.blockingReviewOpen).toBe(true);
      const ok = await post(pa, `${f.base}/${f.shellId}/financial-reporting/partner-approve`, {
        version: fr.assessment.version,
      }).expect(201);
      fr = ok.body as StatutoryAuditFinancialReporting;
      expect(fr.blockingReviewOpen).toBe(false);
      expect(item(fr, 'no_blocking_review')).toBe(true);
    });
  });
});

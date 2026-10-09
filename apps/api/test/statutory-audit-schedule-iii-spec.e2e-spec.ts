import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  StatutoryAuditEntityProfile,
  StatutoryAuditFinancialReporting,
  StatutoryAuditScheduleIii,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

const CRORE = 10_000_000;

/**
 * 02.3 Schedule III & Presentation Framework — the DHVAJ Section 02.3 spec
 * end to end: the versioned framework for the audit period (§8), components
 * (§9), cash flow consuming 02.1 (§10), the disclosure library + triggers
 * (§11, §12), comparatives (§13), rounding from rule data (§14), presentation
 * materiality (§15), SCH-02 specialised format (§7), SCH-06 confirm / override
 * / information pending with Engagement Partner approval (§17), completion
 * (§20) and the §21 acceptance tests (re-evaluation when 02.2 changes,
 * historical version by period).
 */
describe('Statutory Audit — 02.3 Schedule III spec (§5–§21)', () => {
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

  interface File {
    entityId: string;
    engId: string;
    shellId: string;
    base: string;
  }

  const newEngagement = async (entityId: string, financialYear: string): Promise<File> => {
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId,
      serviceId: itr,
      financialYear,
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
      entityId,
      engId,
      shellId: shells.body[0].workflowInstanceId as string,
      base: `/api/v1/engagements/${engId}/statutory-audit`,
    };
  };

  const newAuditFile = async (
    name: string,
    opts: { typeSlug?: string; incorporationDate?: string; financialYear?: string } = {},
  ): Promise<File> => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `${name} ${stamp()}`,
      typeSlug: opts.typeSlug ?? 'public_limited',
      officeCode: 'NORTH',
      ...(opts.incorporationDate ? { incorporationDate: opts.incorporationDate } : {}),
    }).expect(201);
    return newEngagement(entity.body.id as string, opts.financialYear ?? '2024-25');
  };

  const figures = async (f: File, values: Record<string, number>) => {
    for (const [parameter, currentValue] of Object.entries(values)) {
      await post(pa, `${f.base}/${f.shellId}/profile/financials`, {
        parameter,
        currentValue,
        priorValue: currentValue,
      }).expect(201);
    }
  };

  const getProfile = async (f: File): Promise<StatutoryAuditEntityProfile> =>
    (await request(app.getHttpServer()).get(`${f.base}/profile`).set(bearer(pa)).expect(200))
      .body[0] as StatutoryAuditEntityProfile;

  /** Confirm every open 02.1 card, then the profile itself. */
  const confirmProfile = async (f: File) => {
    const draft = await getProfile(f);
    await post(pa, `${f.base}/${f.shellId}/profile`, {
      listingAnswer: 'no',
      listingInProcess: 'no',
      jointAudit: false,
      accountingEnvironment: 'outsourced_service_organisation',
      accountingSoftware: 'tally',
      recordsElectronic: 'yes',
      serviceOrg: 'yes',
      serviceOrgService: 'Payroll processing',
      serviceOrgProvider: 'PayCo Services Pvt Ltd',
      version: draft.version,
    }).expect(201);
    let profile = await getProfile(f);
    const open = new Set<string>();
    for (const item of profile.completeness.items) {
      if (item.kind === 'unconfirmed' || item.key.startsWith('stale:'))
        open.add(item.card as string);
    }
    for (const card of open) {
      const res =
        card === 'E'
          ? await post(pa, `${f.base}/${f.shellId}/profile/small-company`, {
              action: 'confirm',
              version: profile.version,
            })
          : await post(pa, `${f.base}/${f.shellId}/profile/cards/confirm`, {
              card,
              version: profile.version,
            });
      if (res.status !== 201)
        throw new Error(`02.1 card ${card} → ${res.status}: ${JSON.stringify(res.body)}`);
      profile = res.body as StatutoryAuditEntityProfile;
    }
    const res = await post(pa, `${f.base}/${f.shellId}/profile/confirm`, { acknowledged: true });
    if (res.status !== 201) {
      throw new Error(
        `02.1 confirm failed: ${JSON.stringify(res.body)} ${JSON.stringify(profile.completeness.items.filter((i) => i.blocking))}`,
      );
    }
  };

  const readFr = async (f: File): Promise<StatutoryAuditFinancialReporting> =>
    (
      await request(app.getHttpServer())
        .get(`${f.base}/financial-reporting`)
        .set(bearer(pa))
        .expect(200)
    ).body[0] as StatutoryAuditFinancialReporting;

  const conclude02_2 = async (f: File, body: Record<string, unknown> = { action: 'confirm' }) => {
    const fr = await readFr(f);
    return post(pa, `${f.base}/${f.shellId}/financial-reporting/decision`, {
      ...body,
      version: fr.assessment.version,
    }).expect(201);
  };

  const read = async (f: File): Promise<StatutoryAuditScheduleIii> =>
    (await request(app.getHttpServer()).get(`${f.base}/schedule-iii`).set(bearer(pa)).expect(200))
      .body[0] as StatutoryAuditScheduleIii;
  const item = (s: StatutoryAuditScheduleIii, key: string) =>
    s.completion?.items.find((i) => i.key === key)?.met;
  /** POST with the current version; asserts the status and returns the body. */
  const send = async (f: File, path: string, body: Record<string, unknown>, status: number) => {
    const s = await read(f);
    const res = await post(pa, `${f.base}/${f.shellId}/schedule-iii/${path}`, {
      ...body,
      version: s.assessment.version,
    });
    if (res.status !== status)
      throw new Error(`${path} → ${res.status} (expected ${status}): ${JSON.stringify(res.body)}`);
    return res.body as StatutoryAuditScheduleIii;
  };
  const facts = (f: File, body: Record<string, unknown>, status = 201) =>
    send(f, 'facts', body, status);
  const decide = (f: File, body: Record<string, unknown>, status = 201) =>
    send(f, 'decision', body, status);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Ind AS company, FY 2024-25 (Division II)', () => {
    let f: File;

    beforeAll(async () => {
      f = await newAuditFile('SCH Ind AS Co', { incorporationDate: '2005-06-01' });
      await newEngagement(f.entityId, '2023-24'); // the prior-year file on the portal (SCH-04)
      await figures(f, {
        paid_up_capital: 50 * CRORE,
        net_worth: 600 * CRORE,
        turnover: 800 * CRORE,
        total_assets: 1500 * CRORE,
        borrowings: 120 * CRORE,
      });
      await confirmProfile(f);
      await conclude02_2(f);
    });

    it('routes Division II from the version in force for the period (tests 2, 6)', async () => {
      const s = await read(f);
      expect(s.upstreamReady).toBe(true);
      expect(s.assessment.systemOutcome).toBe('division_ii');
      const fv = s.detail!.frameworkVersion!;
      expect(fv.frameworkId).toBe('SCHEDULE_III_DIVISION_II');
      expect(fv.effectiveFrom).toBe('2021-04-01');
      expect(fv.versionLabel).toMatch(/G\.S\.R\. 207\(E\)/);
      expect(fv.guidanceProvisionCode).toBe('ICAI_GN_SCH_III_DIV_II');
      expect(fv.guidanceVersion).toBeTruthy();
      expect(fv.templateKey).toBe('fs_workbook_indas_div_ii');
      expect(fv.provisionId).toBeTruthy();
      expect(s.assessment.authorityProvisionId).toBe(fv.provisionId);
      expect(s.detail!.sch01).toBe('yes');
      expect(s.detail!.specialised?.systemSuggested).toBe('no');
    });

    it('loads components, cash flow and the disclosure library from the version (tests 7, 9)', async () => {
      const d = (await read(f)).detail!;
      const keys = d.componentLines!.filter((c) => c.required).map((c) => c.key);
      expect(keys).toEqual([
        'balance_sheet',
        'statement_of_profit_and_loss',
        'statement_of_changes_in_equity',
        'cash_flow_statement',
        'notes_to_accounts',
      ]);
      expect(
        d.componentLines!.find((c) => c.key === 'statement_of_profit_and_loss')?.includesOci,
      ).toBe(true);
      expect(d.cashFlow?.status).toBe('required');
      expect(d.cashFlow?.provisionCode).toBe('COS_ACT_2_40');
      const lib = Object.fromEntries(d.disclosureLibrary!.map((x) => [x.code, x]));
      expect(lib.SCH3_II_ARI_CRYPTO?.applicability).toBe('baseline');
      expect(lib.SCH3_II_ARI_CHARGES?.applicability).toBe('triggered'); // 02.1 borrowings ₹120 cr
      expect(lib.SCH3_II_ARI_CSR?.crossLink).toBe('02.7');
      expect(lib.SCH3_II_CFS_ADDITIONAL_INFO?.crossLink).toBe('02.6');
      expect(lib.SCH3_III_ARI_RATIOS_NBFC).toBeUndefined();
      expect(lib.SCH3_II_ARI_TITLE_DEEDS?.provisionId).toBeTruthy();
    });

    it('rounds from rule data and keeps presentation materiality separate from SA 320 (tests 8, §15)', async () => {
      const d = (await read(f)).detail!;
      expect(d.rounding?.ruleCode).toBe('SCH_III_ROUNDING');
      expect(d.rounding?.effectiveFrom).toBe('2021-04-01');
      expect(d.rounding?.band).toBe('at_or_above');
      expect(d.rounding?.permittedUnits).toEqual(['lakhs', 'millions', 'crores']);
      expect(d.rounding?.systemUnit).toBe('crores');
      expect(d.rounding?.sourceLabel).toMatch(/Total income/);
      expect(d.presentationMateriality?.ruleCode).toBe('SCH_III_PRES_MAT_DIV_II');
      expect(d.presentationMateriality?.amount).toBe(8 * CRORE);
      expect(d.presentationMateriality?.auditMaterialityNote).toMatch(/Section 03/);
      expect(d.rulesApplied?.map((r) => r.ruleCode)).toEqual([
        'SCH_III_ROUNDING',
        'SCH_III_PRES_MAT_DIV_II',
      ]);
    });

    it('SCH-04 finds the prior-year engagement; SCH-05 validates the unit against the rule', async () => {
      let s = await read(f);
      expect(s.detail?.comparatives?.status).toBe('required');
      expect(s.detail?.comparatives?.priorPeriod).toBe('2023-24');
      expect(s.detail?.comparatives?.priorEngagementId).toBeTruthy();

      await facts(f, { roundingUnit: 'hundreds' }, 400); // not permitted at ≥ ₹100 cr
      await facts(f, { roundingUnit: 'lakhs' }, 400); // differs from the system → reason
      s = await facts(f, { roundingUnit: 'lakhs', roundingReason: 'Group reporting in lakhs.' });
      expect(s.detail?.rounding?.selectedUnit).toBe('lakhs');
      expect(s.detail?.rounding?.overridden).toBe(true);
      expect(item(s, 'rounding')).toBe(true);
    });

    it('SCH-06: confirm completes 02.3; an override needs a reason AND a technical basis', async () => {
      await decide(f, { action: 'override', conclusion: 'division_i', basis: 'x' }, 400);
      await decide(f, { action: 'confirm', conclusion: 'division_i' }, 400);
      const s = await decide(f, { action: 'confirm' });
      expect(s.assessment.conclusion).toBe('division_ii');
      expect(s.assessment.state).toBe('applicable');
      expect(s.partnerApproval?.required).toBe(false);
      expect(s.completion?.complete).toBe(true);
      expect(s.workbookAvailable).toBe(true);
      expect(s.memoSuggested).toBe(false);
    });

    it('changing the 02.2 conclusion marks 02.3 Needs Re-evaluation (test 5)', async () => {
      await conclude02_2(f, {
        action: 'override',
        conclusion: 'accounting_standards',
        basis: 'Re-evaluation check (e2e).',
      });
      const s = await read(f);
      expect(s.assessment.needsReevaluation).toBe(true);
      expect(s.assessment.conclusion).toBe('division_ii'); // the recorded conclusion is kept
      expect(s.assessment.systemOutcome).toBe('division_i'); // the live suggestion shows the change
      expect(item(s, 'blocking')).toBe(false);
      expect(s.completion?.complete).toBe(false);

      // Re-confirming against the new route clears the flag and freezes Division I.
      const again = await decide(f, { action: 'confirm' });
      expect(again.assessment.needsReevaluation).toBe(false);
      expect(again.assessment.conclusion).toBe('division_i');
      expect(again.detail?.frameworkVersion?.frameworkId).toBe('SCHEDULE_III_DIVISION_I');

      // Recording the same 02.2 conclusion again does not re-flag 02.3.
      await conclude02_2(f, {
        action: 'override',
        conclusion: 'accounting_standards',
        basis: 'Same conclusion recorded again (e2e).',
      });
      expect((await read(f)).assessment.needsReevaluation).toBe(false);
    });

    it('a significant override keeps the system conclusion and needs the Engagement Partner (test 13)', async () => {
      const s = await decide(f, {
        action: 'override',
        conclusion: 'division_ii',
        basis: 'Voluntary Ind AS adoption approved by the Board.',
        technicalBasis: 'Rule 4(1)(i) Companies (Ind AS) Rules 2015.',
      });
      expect(s.assessment.isOverridden).toBe(true);
      expect(s.assessment.systemOutcome).toBe('division_i');
      expect(s.assessment.conclusion).toBe('division_ii');
      expect(s.capturedFacts?.technicalBasis).toMatch(/Rule 4/);
      expect(s.detail?.frameworkVersion?.frameworkId).toBe('SCHEDULE_III_DIVISION_II'); // frozen for the concluded Division
      expect(s.partnerApproval?.required).toBe(true);
      expect(s.memoSuggested).toBe(true);
      expect(item(s, 'partner')).toBe(false);

      // The managing partner is a firm lead but not this engagement's partner.
      await post(mp, `${f.base}/${f.shellId}/schedule-iii/partner-approve`, {
        version: s.assessment.version,
      }).expect(403);
      const ok = (
        await post(pa, `${f.base}/${f.shellId}/schedule-iii/partner-approve`, {
          note: 'Agreed (e2e).',
          version: s.assessment.version,
        }).expect(201)
      ).body as StatutoryAuditScheduleIii;
      expect(ok.partnerApproval?.approvedByName).toBeTruthy();
      expect(item(ok, 'partner')).toBe(true);

      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(mp))
        .expect(200);
      const actions = (audit.body.items as Array<{ action: string }>).map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'statutory_audit.schedule_iii_decision',
          'statutory_audit.schedule_iii_facts_set',
          'statutory_audit.schedule_iii_partner_approved',
        ]),
      );
    });
  });

  describe('historical engagement, FY 2020-21 (tests 6, 11)', () => {
    let f: File;

    beforeAll(async () => {
      f = await newAuditFile('SCH Historical Co', {
        incorporationDate: '2001-04-01',
        financialYear: '2020-21',
      });
      await figures(f, { turnover: 40 * CRORE, net_worth: 20 * CRORE });
      await conclude02_2(f);
    });

    it('resolves the pre-2021 version, the turnover-measured rounding rule and no 2021 disclosures', async () => {
      const s = await read(f);
      expect(s.assessment.systemOutcome).toBe('division_i');
      expect(s.detail?.frameworkVersion?.effectiveFrom).toBe('2014-04-01');
      expect(s.detail?.frameworkVersion?.status).toBe('superseded');
      expect(s.detail?.rounding?.effectiveFrom).toBe('2014-04-01');
      expect(s.detail?.rounding?.sourceLabel).toBe('Turnover (02.1)');
      const codes = s.detail!.disclosureLibrary!.map((d) => d.code);
      expect(codes).toContain('SCH3_I_BS_CLASSIFICATION');
      expect(codes).not.toContain('SCH3_I_ARI_CRYPTO');
      expect(s.detail?.presentationMateriality?.amount).toBe(40 * CRORE * 0.01);
    });

    it('stays tied to the frozen version after the conclusion is recorded', async () => {
      const s = await decide(f, { action: 'confirm' });
      expect(s.detail?.frameworkVersion?.versionLabel).toMatch(/Companies Act, 2013/);
      const again = await read(f);
      expect(again.detail?.frameworkVersion?.id).toBe(s.detail?.frameworkVersion?.id);
    });
  });

  describe('One Person Company in its first financial year (tests 1, 7)', () => {
    let f: File;

    beforeAll(async () => {
      f = await newAuditFile('SCH OPC', { typeSlug: 'opc', incorporationDate: '2024-07-15' });
      await figures(f, { turnover: 5 * CRORE, net_worth: 1 * CRORE });
      await conclude02_2(f);
    });

    it('AS → Division I; the cash-flow exemption consumes the 02.1 OPC classification', async () => {
      const s = await read(f);
      expect(s.assessment.systemOutcome).toBe('division_i');
      expect(s.detail?.cashFlow?.status).toBe('exempt');
      expect(s.detail?.cashFlow?.basis).toMatch(/One Person Company/);
      expect(s.detail?.cashFlow?.provisionId).toBeTruthy();
      expect(s.detail?.componentLines?.find((c) => c.key === 'cash_flow_statement')?.required).toBe(
        false,
      );
      expect(
        s.detail?.componentLines?.find((c) => c.key === 'statement_of_changes_in_equity'),
      ).toBeUndefined();
      expect(s.detail?.rounding?.band).toBe('below');
      expect(s.detail?.rounding?.systemUnit).toBe('lakhs');
    });

    it('first financial year → comparatives not applicable from entity history (§13)', async () => {
      const c = (await read(f)).detail!.comparatives!;
      expect(c.firstFinancialYear).toBe(true);
      expect(c.status).toBe('not_applicable');
      expect(c.priorPeriod).toBeNull();
    });

    it('Information Pending needs the blocking information and is recorded', async () => {
      await decide(f, { action: 'information_pending' }, 400);
      const s = await decide(f, {
        action: 'information_pending',
        pendingReason: 'Awaiting the incorporation certificate.',
      });
      expect(s.professionalAction).toBe('information_pending');
      expect(s.assessment.state).toBe('pending_information');
      expect(s.pendingReason).toMatch(/incorporation/);
      expect(item(s, 'blocking')).toBe(false);
    });
  });

  describe('banking company (test 4, SCH-01 / SCH-02)', () => {
    let f: File;

    beforeAll(async () => {
      f = await newAuditFile('SCH Bank');
      const profile = await getProfile(f);
      await post(pa, `${f.base}/${f.shellId}/profile`, {
        specialEntityTypes: ['bank'],
        version: profile.version,
      }).expect(201);
      await conclude02_2(f);
    });

    it('is not forced into a Division — the specialised-format rule applies', async () => {
      const s = await read(f);
      expect(s.assessment.systemOutcome).toBe('specialised_format');
      expect(s.detail?.division).toBeNull();
      expect(s.detail?.sch01).toBe('specialised_format');
      const sp = s.detail!.specialised!;
      expect(sp.systemSuggested).toBe('yes');
      expect(sp.matchedRules.map((r) => r.code)).toEqual(['SPEC_FMT_BANK']);
      expect(sp.effect).toBe('replaces');
      expect(sp.governingAuthority).toMatch(/Reserve Bank/);
      expect(sp.resolved).toBe(false);
      expect(s.assessment.authorityProvisionId).toBeTruthy();
      expect(s.detail?.blockingReview).toBe(true);
    });

    it('SCH-02 answered → resolved; confirming needs the Engagement Partner', async () => {
      await facts(f, { specialisedEffect: 'rewrites' }, 400);
      let s = await facts(f, { specialisedAnswer: 'yes' });
      expect(s.detail?.specialised?.resolved).toBe(true);
      expect(s.detail?.blockingReview).toBe(false);

      s = await decide(f, { action: 'confirm' });
      expect(s.assessment.conclusion).toBe('specialised_format');
      expect(s.partnerApproval?.required).toBe(true);
      expect(s.workbookAvailable).toBe(false);
      expect(item(s, 'division')).toBeNull();
      expect(item(s, 'specialised')).toBe(true);
    });
  });
});

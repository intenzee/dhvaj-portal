import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StatutoryAuditCaro, StatutoryAuditConsolidation } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.4 CARO + 02.6 consolidation facts filled from the client master (Guide §1,
 * capture once): group relationships, listing, branches and the audit year's
 * financial profile answer the facts on first open, "Fill from client master"
 * never overwrites the team, and the 02.9 summary shows outcomes, not blanks.
 */
describe('Statutory Audit — 02.4 / 02.6 facts from the client master (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let pb: string;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(url).set(bearer(t)).send(body);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const newEntity = async (typeSlug: string, name: string): Promise<string> => {
    const res = await post(pa, '/api/v1/entities', {
      legalName: `${name} ${stamp()}`,
      typeSlug,
      officeCode: 'NORTH',
    }).expect(201);
    return res.body.id as string;
  };

  const newAuditFile = async (
    entityId: string,
    financialYear = '2024-25',
  ): Promise<{ engId: string; shellId: string }> => {
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
    return { engId, shellId: shells.body[0].workflowInstanceId as string };
  };

  let clientId: string;
  let subName: string;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mp = await token('mp@dhvaj.in');

    clientId = await newEntity('private_limited', 'Prefill Client');
    const parentId = await newEntity('public_limited', 'Prefill Parent');
    const subId = await newEntity('private_limited', 'Prefill Sub');
    const sub = await request(app.getHttpServer())
      .get(`/api/v1/entities/${subId}`)
      .set(bearer(pa))
      .expect(200);
    subName = sub.body.legalName as string;

    // "Client IS subsidiary OF Parent (public)" and "Sub IS wholly-owned subsidiary OF Client".
    await post(pa, `/api/v1/entities/${clientId}/relationships`, {
      toEntityId: parentId,
      relationshipType: 'subsidiary',
      shareholdingPct: 60,
    }).expect(201);
    await post(pa, `/api/v1/entities/${subId}/relationships`, {
      toEntityId: clientId,
      relationshipType: 'wholly_owned_subsidiary',
      shareholdingPct: 100,
    }).expect(201);
    await post(pa, `/api/v1/entities/${clientId}/addresses`, {
      addressType: 'branch',
      line1: '5 Ring Road',
      city: 'Delhi',
      pincode: '110001',
    }).expect(201);
    await post(pa, `/api/v1/entities/${clientId}/financial-profiles`, {
      financialYear: '2024-25',
      revenue: 120000000,
      otherIncome: 5000000,
      netWorth: 40000000,
      totalBorrowings: 2000000,
      source: 'provisional_financials',
    }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('first open fills CARO from the master; peak borrowings stays with the team', async () => {
    const { engId } = await newAuditFile(clientId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/caro`)
      .set(bearer(pa))
      .expect(200);
    const caro = res.body[0] as StatutoryAuditCaro;
    expect(caro.capturedFacts).toEqual({
      isHoldingOrSubsidiaryOfPublic: true,
      capitalPlusReserves: 40000000,
      totalRevenue: 125000000,
      peakBankFiBorrowings: null,
    });
    expect(caro.masterFacts.length).toBeGreaterThan(0);
    // A private subsidiary of a public company cannot take the private exemption.
    expect(caro.assessment.systemOutcome).toBe('applicable');
  });

  it('first open fills consolidation: investees, parent ownership, branches', async () => {
    const { engId } = await newAuditFile(clientId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/consolidation`)
      .set(bearer(pa))
      .expect(200);
    const c = res.body[0] as StatutoryAuditConsolidation;
    expect(c.capturedFacts.investees).toEqual([
      expect.objectContaining({ name: subName, ownershipPercent: 100, hasControl: true }),
    ]);
    expect(c.capturedFacts.isPartiallyOwnedSubsidiary).toBe(true);
    expect(c.capturedFacts.isWhollyOwnedSubsidiary).toBe(false);
    expect(c.capturedFacts.hasBranches).toBe(true);
    expect(c.capturedFacts.parentFilesCompliantCfs).toBeNull();
  });

  it('"Fill from client master" never overwrites what the team entered', async () => {
    const { engId, shellId } = await newAuditFile(clientId);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const first = await request(app.getHttpServer())
      .get(`${base}/caro`)
      .set(bearer(pa))
      .expect(200);
    await post(pa, `${base}/${shellId}/caro/facts`, {
      capitalPlusReserves: 1,
      version: first.body[0].assessment.version,
    }).expect(201);
    const filled = await post(pa, `${base}/${shellId}/caro/fill-from-master`, {}).expect(201);
    expect(filled.body.filled).toEqual([]);
    expect(filled.body.caro.capturedFacts.capitalPlusReserves).toBe(1);

    // An outsider cannot fill someone else's file.
    const res = await post(pb, `${base}/${shellId}/consolidation/fill-from-master`, {});
    expect([403, 404]).toContain(res.status);
  });

  it('the 02.9 summary shows CARO and consolidation outcomes on first open', async () => {
    const { engId } = await newAuditFile(clientId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/framework-summary`)
      .set(bearer(pa))
      .expect(200);
    const sections = res.body[0].sections as Array<{
      subSectionKey: string;
      systemOutcome: string | null;
    }>;
    expect(sections.find((s) => s.subSectionKey === '02.4')?.systemOutcome).toBe('applicable');
    expect(sections.find((s) => s.subSectionKey === '02.6')?.systemOutcome).toBeTruthy();
  });

  it('02.5 / 02.7: directors from contacts, software from last year, filing record shown', async () => {
    const entityId = await newEntity('private_limited', 'Prefill Reporting');
    await post(pa, `/api/v1/entities/${entityId}/contacts`, {
      fullName: 'Vikram Shah',
      designation: 'Managing Director',
      contactType: 'director',
    }).expect(201);

    // Last year's file lists the accounting software.
    const prior = await newAuditFile(entityId, '2023-24');
    const priorBase = `/api/v1/engagements/${prior.engId}/statutory-audit`;
    const priorOr = await request(app.getHttpServer())
      .get(`${priorBase}/other-reporting`)
      .set(bearer(pa))
      .expect(200);
    await post(pa, `${priorBase}/${prior.shellId}/other-reporting/facts`, {
      softwareSystems: [
        { name: 'Tally Prime', hasAuditTrailFeature: true, auditTrailOperatedAllYear: true },
      ],
      version: priorOr.body[0].assessment.version,
    }).expect(201);

    const { engId, shellId } = await newAuditFile(entityId);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const or = await request(app.getHttpServer())
      .get(`${base}/other-reporting`)
      .set(bearer(pa))
      .expect(200);
    expect(or.body[0].capturedFacts.hasManagingOrWholeTimeDirector).toBe(true);
    expect(or.body[0].capturedFacts.softwareSystems).toEqual([
      { name: 'Tally Prime', hasAuditTrailFeature: true, auditTrailOperatedAllYear: false },
    ]);
    expect(or.body[0].capturedFacts.fraudIdentified).toBe(false);

    const icfr = await request(app.getHttpServer()).get(`${base}/icfr`).set(bearer(pa)).expect(200);
    expect(icfr.body[0].capturedFacts.filingDefault).toBe(false);
    expect((icfr.body[0].masterFacts as Array<{ label: string }>).map((f) => f.label)).toContain(
      'ROC filing record (§92 / §137)',
    );

    const again = await post(pa, `${base}/${shellId}/other-reporting/fill-from-master`, {}).expect(
      201,
    );
    expect(again.body.filled).toEqual([]);
    const res = await post(pb, `${base}/${shellId}/icfr/fill-from-master`, {});
    expect([403, 404]).toContain(res.status);
  });

  it('02.5: an overdue AOC-4 on the compliance calendar marks the ROC filing default', async () => {
    const entityId = await newEntity('private_limited', 'Prefill Late Filer');
    const roc = await findId('/api/v1/services?search=ROC_ANNUAL&limit=100');
    const rocEng = await post(pa, '/api/v1/engagements', {
      entityId,
      serviceId: roc,
      financialYear: '2023-24',
      periodLabel: `R${stamp()}`,
      status: 'accepted',
    }).expect(201);
    // AOC-4 for FY 2023-24 fell due in 2024 and is still open → a §137 default.
    await post(pa, `/api/v1/engagements/${rocEng.body.id}/compliance`, {
      complianceRuleCode: 'ROC_AOC4_DUE',
    }).expect(201);

    const { engId } = await newAuditFile(entityId);
    const icfr = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/icfr`)
      .set(bearer(pa))
      .expect(200);
    expect(icfr.body[0].capturedFacts.filingDefault).toBe(true);
    const record = (icfr.body[0].masterFacts as Array<{ label: string; value: string }>).find(
      (f) => f.label === 'ROC filing record (§92 / §137)',
    );
    expect(record?.value).toMatch(/^Default — AOC-4 due \d{4}-\d{2}-\d{2} not filed/);
  });

  it('02.1: special entity types come from the master and feed CARO', async () => {
    const entityId = await newEntity('private_limited', 'Prefill Foundation');
    await post(pa, `/api/v1/entities/${entityId}/business-activities`, {
      industrySlug: 'nbfc',
    }).expect(201);
    await post(pa, `/api/v1/entities/${entityId}/regulatory-attributes`, {
      attributeCode: 'special_regulatory_status',
      valueText: 'Section 8 company',
    }).expect(201);

    const { engId, shellId } = await newAuditFile(entityId);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    // The 02.9 summary fills 02.1 first, so CARO sees the Section 8 exemption.
    const summary = await request(app.getHttpServer())
      .get(`${base}/framework-summary`)
      .set(bearer(pa))
      .expect(200);
    const caro = (
      summary.body[0].sections as Array<{ subSectionKey: string; systemOutcome: string | null }>
    ).find((x) => x.subSectionKey === '02.4');
    expect(caro?.systemOutcome).toBe('not_applicable_exempt');

    const profile = await request(app.getHttpServer())
      .get(`${base}/profile`)
      .set(bearer(pa))
      .expect(200);
    expect([...profile.body[0].specialEntityTypes].sort()).toEqual(['nbfc', 'section_8']);
    expect(
      (profile.body[0].masterFacts as Array<{ label: string; value: string }>).find(
        (f) => f.label === 'Special entity type(s)',
      )?.value,
    ).toMatch(/NBFC \(Industry: NBFC\)/);

    // The team narrows the list; a refill adds back only what the master shows,
    // and a cleared list is never refilled automatically.
    await post(pa, `${base}/${shellId}/profile`, {
      specialEntityTypes: [],
      version: profile.body[0].version,
    }).expect(201);
    const reopened = await request(app.getHttpServer())
      .get(`${base}/profile`)
      .set(bearer(pa))
      .expect(200);
    expect(reopened.body[0].specialEntityTypes).toEqual([]);
    const refill = await post(pa, `${base}/${shellId}/profile/fill-from-master`, {}).expect(201);
    expect([...refill.body.filled].sort()).toEqual(['NBFC', 'Section 8 company']);

    const res = await post(pb, `${base}/${shellId}/profile/fill-from-master`, {});
    expect([403, 404]).toContain(res.status);
  });

  it("02.2: SME listing, last year's Ind AS and a listed parent fill the facts", async () => {
    const entityId = await newEntity('public_limited', 'Prefill SME Co');
    await post(pa, `/api/v1/entities/${entityId}/listings`, {
      exchange: 'sme',
      securityType: 'equity',
      status: 'listed',
    }).expect(201);
    const parentId = await newEntity('public_limited', 'Prefill Listed Parent');
    await post(pa, `/api/v1/entities/${parentId}/listings`, {
      exchange: 'nse',
      securityType: 'equity',
      status: 'listed',
    }).expect(201);
    // "SME Co IS subsidiary OF Listed Parent".
    await post(pa, `/api/v1/entities/${entityId}/relationships`, {
      toEntityId: parentId,
      relationshipType: 'subsidiary',
      shareholdingPct: 55,
    }).expect(201);

    // Last year's file concluded Ind AS.
    const prior = await newAuditFile(entityId, '2023-24');
    const priorBase = `/api/v1/engagements/${prior.engId}/statutory-audit`;
    const priorFr = await request(app.getHttpServer())
      .get(`${priorBase}/financial-reporting`)
      .set(bearer(pa))
      .expect(200);
    await post(pa, `${priorBase}/${prior.shellId}/financial-reporting/decision`, {
      conclusion: 'ind_as',
      basis: 'Ind AS applied (e2e).',
      version: priorFr.body[0].assessment.version,
    }).expect(201);

    const { engId, shellId } = await newAuditFile(entityId);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const fr = await request(app.getHttpServer())
      .get(`${base}/financial-reporting`)
      .set(bearer(pa))
      .expect(200);
    expect(fr.body[0].capturedFacts).toEqual({
      isListedOnSmeExchange: true,
      priorIndAs: true,
      voluntaryIndAs: false,
      groupTriggersIndAs: true,
    });
    expect(fr.body[0].assessment.systemOutcome).toBe('ind_as');
    expect(
      (fr.body[0].masterFacts as Array<{ label: string; value: string }>).find(
        (f) => f.label === 'Group company applying Ind AS',
      )?.value,
    ).toMatch(/holding company; listed on NSE\/BSE/);

    const again = await post(
      pa,
      `${base}/${shellId}/financial-reporting/fill-from-master`,
      {},
    ).expect(201);
    expect(again.body.filled).toEqual([]);
    const res = await post(pb, `${base}/${shellId}/financial-reporting/fill-from-master`, {});
    expect([403, 404]).toContain(res.status);
  });

  it("02.3 routes from the 02.2 suggestion (provisional) and can't be concluded early", async () => {
    const entityId = await newEntity('private_limited', 'Prefill Sch III');
    await post(pa, `/api/v1/entities/${entityId}/financial-profiles`, {
      financialYear: '2024-25',
      turnover: 80000000,
      netWorth: 20000000,
      source: 'provisional_financials',
    }).expect(201);
    const { engId, shellId } = await newAuditFile(entityId);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const summary = await request(app.getHttpServer())
      .get(`${base}/framework-summary`)
      .set(bearer(pa))
      .expect(200);
    const s3 = (
      summary.body[0].sections as Array<{ subSectionKey: string; systemOutcome: string | null }>
    ).find((x) => x.subSectionKey === '02.3');
    expect(s3?.systemOutcome).toBe('division_i'); // AS → Division I, before 02.2 is concluded

    const sch = await request(app.getHttpServer())
      .get(`${base}/schedule-iii`)
      .set(bearer(pa))
      .expect(200);
    expect(sch.body[0].assessment.systemBasis).toMatch(/^Provisional/);
    expect(sch.body[0].upstreamReady).toBe(false);
    await post(pa, `${base}/${shellId}/schedule-iii/decision`, {
      conclusion: 'division_i',
      version: sch.body[0].assessment.version,
    }).expect(409);
  });

  it('every client-master fact and pending area links to the form that fixes it', async () => {
    const entityId = await newEntity('private_limited', 'Prefill Links');
    const { engId } = await newAuditFile(entityId);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;

    const caro = await request(app.getHttpServer()).get(`${base}/caro`).set(bearer(pa)).expect(200);
    const facts = caro.body[0].masterFacts as Array<{
      label: string;
      fix?: { entityId: string; section: string; financialYear?: string };
    }>;
    expect(facts.find((f) => f.label === 'Holding / subsidiary of a public company')?.fix).toEqual({
      entityId,
      section: 'relationships',
    });

    const profile = await request(app.getHttpServer())
      .get(`${base}/profile`)
      .set(bearer(pa))
      .expect(200);
    // No figures on the master: small-company status is pending → link to the figures form.
    const p = profile.body[0];
    const i = (p.missingFacts as string[]).findIndex((m) => m.startsWith('Small Company'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(p.missingFactFixes[i]).toEqual({
      entityId,
      section: 'financials',
      financialYear: '2024-25',
    });

    const fw = await request(app.getHttpServer())
      .get(`${base}/framework`)
      .set(bearer(pa))
      .expect(200);
    const pending = (
      fw.body[0].assessments as Array<{ state: string; areaKey: string; fix: unknown }>
    ).filter((a) => a.state === 'pending_information');
    expect(pending.length).toBeGreaterThan(0);
    for (const a of pending) {
      expect(a.fix).toEqual(
        expect.objectContaining({
          entityId,
          section: a.areaKey === 'cfs' ? 'relationships' : 'financials',
        }),
      );
    }
  });

  it("02.1 carries last year's accounting environment and joint audit forward", async () => {
    const entityId = await newEntity('private_limited', 'Prefill Carry');
    const prior = await newAuditFile(entityId, '2023-24');
    const priorBase = `/api/v1/engagements/${prior.engId}/statutory-audit`;
    const pp = await request(app.getHttpServer())
      .get(`${priorBase}/profile`)
      .set(bearer(pa))
      .expect(200);
    await post(pa, `${priorBase}/${prior.shellId}/profile`, {
      accountingEnvironment: 'outsourced_service_organisation',
      jointAudit: true,
      version: pp.body[0].version,
    }).expect(201);

    const { engId } = await newAuditFile(entityId);
    const profile = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/profile`)
      .set(bearer(pa))
      .expect(200);
    expect(profile.body[0].accountingEnvironment).toBe('outsourced_service_organisation');
    expect(profile.body[0].jointAudit).toBe(true);
    const triggered = (profile.body[0].saTriggers as Array<{ code: string; triggered: boolean }>)
      .filter((t) => t.triggered)
      .map((t) => t.code);
    expect(triggered).toEqual(expect.arrayContaining(['SA 402', 'SA 299']));
  });
});

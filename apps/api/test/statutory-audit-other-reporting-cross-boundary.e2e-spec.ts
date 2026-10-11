import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  FRAUD_MATTER_ROUTE,
  OTHER_REPORTING_OUTCOME,
  REPORTING_CARD,
  type ReportingCardKey,
  type StatutoryAuditCompletion,
  type StatutoryAuditOtherReporting,
  type StatutoryAuditReportingRecords,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.7 spec §21 across the Track A / Track B boundary: the Fraud Matter register
 * (Track B) drives the Section 143(12) card and the completion checklist (Track
 * A), the §164(2) workpaper drives Section 143(3)(g), and the 02.4 / 02.5 / 02.6
 * results reach the cross-reference cards through the records reader — one file,
 * end to end.
 */
describe('Statutory Audit — 02.7 cross-boundary (§21, e2e)', () => {
  let app: INestApplication;
  let su: Client;
  const http = () => app.getHttpServer();

  const token = async (email: string): Promise<string> => {
    const res = await request(http()).post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  let mp: string;
  let pa: string;
  const findId = async (path: string): Promise<string> => {
    const res = await request(http()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  let engId: string;
  let shellId: string;
  const base = () => `/api/v1/engagements/${engId}/statutory-audit`;
  const recordsUrl = () => `${base()}/${shellId}/reporting-records`;

  const getRecords = async (): Promise<StatutoryAuditReportingRecords> =>
    (await request(http()).get(recordsUrl()).set(bearer(pa)).expect(200))
      .body as StatutoryAuditReportingRecords;
  const getOther = async (): Promise<StatutoryAuditOtherReporting> =>
    (await request(http()).get(`${base()}/other-reporting`).set(bearer(pa)).expect(200))
      .body[0] as StatutoryAuditOtherReporting;
  const card = (o: StatutoryAuditOtherReporting, key: ReportingCardKey) =>
    o.detail!.cards.find((c) => c.key === key)!;
  const createMatter = async (body: object) =>
    (
      await request(http())
        .post(`${recordsUrl()}/fraud-matters`)
        .set(bearer(pa))
        .send(body)
        .expect(201)
    ).body as StatutoryAuditReportingRecords;
  const patchMatter = async (id: string, body: object) =>
    (
      await request(http())
        .patch(`${recordsUrl()}/fraud-matters/${id}`)
        .set(bearer(pa))
        .send(body)
        .expect(200)
    ).body as StatutoryAuditReportingRecords;

  beforeAll(async () => {
    await seedIdentityFixtures();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');

    const entity = await request(http())
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `Boundary Co ${stamp()}`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
      })
      .expect(201);
    const entityId = entity.body.id as string;
    for (const [fullName, designation] of [
      ['Vikram Shah', 'Managing Director'],
      ['Asha Rao', 'Director'],
    ])
      await request(http())
        .post(`/api/v1/entities/${entityId}/contacts`)
        .set(bearer(pa))
        .send({ fullName, designation, contactType: 'director' })
        .expect(201);

    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await request(http())
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId: itr,
        financialYear: '2024-25',
        periodLabel: `P${stamp()}`,
        status: 'accepted',
      })
      .expect(201);
    engId = eng.body.id as string;
    await request(http())
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: stat })
      .expect(201);
    const shells = await request(http()).get(base()).set(bearer(pa)).expect(200);
    shellId = shells.body[0].workflowInstanceId as string;

    // Open 02.4 / 02.5 / 02.6 / 02.7 so their rows exist.
    for (const p of ['caro', 'icfr', 'consolidation', 'other-reporting'])
      await request(http()).get(`${base()}/${p}`).set(bearer(pa)).expect(200);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('routes a fraud at the ₹1 crore line by the Rule 13 version in force on the knowledge date', async () => {
    let r = await createMatter({
      nature: 'Vendor kickbacks',
      amount: 10000000, // ₹1,00,00,000 — at the threshold (>=)
      knowledgeDate: '2024-06-03',
    });
    expect(r.fraud.matters.find((m) => m.ref === 'FM-001')!.route).toBe(
      FRAUD_MATTER_ROUTE.centralGovernment,
    );

    r = await createMatter({
      nature: 'Inventory pilferage',
      amount: 9999999, // ₹99,99,999 — one rupee below
      knowledgeDate: '2024-06-03',
    });
    expect(r.fraud.matters.find((m) => m.ref === 'FM-002')!.route).toBe(
      FRAUD_MATTER_ROUTE.auditCommitteeBoard,
    );

    // The same amount, known before the 14 Dec 2015 amendment: Rule 13 as
    // enacted sends every fraud to the Central Government.
    r = await createMatter({
      nature: 'Old payroll fraud',
      amount: 9999999,
      knowledgeDate: '2015-12-13',
    });
    let fm3 = r.fraud.matters.find((m) => m.ref === 'FM-003')!;
    expect(fm3.route).toBe(FRAUD_MATTER_ROUTE.centralGovernment);
    // Known on the amendment date → the ₹1 crore threshold applies.
    r = await patchMatter(fm3.id, { knowledgeDate: '2015-12-14', version: fm3.version });
    fm3 = r.fraud.matters.find((m) => m.ref === 'FM-003')!;
    expect(fm3.route).toBe(FRAUD_MATTER_ROUTE.auditCommitteeBoard);

    expect(r.fraud.status).toMatchObject({ centralGovernmentRoute: 1, belowThreshold: 2, open: 3 });
  });

  it('runs the 2 / 45 / 15-day Rule 13 deadlines from the Rules Library', async () => {
    let r = await getRecords();
    const fm1 = r.fraud.matters.find((m) => m.ref === 'FM-001')!;
    expect(fm1.deadlines.find((d) => d.key === 'initial_notice')).toMatchObject({
      fromDate: '2024-06-03',
      days: 2,
      dueDate: '2024-06-05',
    });
    // The Board route has the initial notice only.
    const fm2 = r.fraud.matters.find((m) => m.ref === 'FM-002')!;
    expect(fm2.deadlines.map((d) => d.key)).toEqual(['initial_notice']);
    expect(fm2.deadlines[0]!.dueDate).toBe('2024-06-05');

    r = await patchMatter(fm1.id, { boardReportedOn: '2024-06-05', version: fm1.version });
    let m = r.fraud.matters.find((x) => x.ref === 'FM-001')!;
    expect(m.deadlines.find((d) => d.key === 'initial_notice')!.metOn).toBe('2024-06-05');
    expect(m.deadlines.find((d) => d.key === 'reply_due')).toMatchObject({
      fromDate: '2024-06-05',
      days: 45,
      dueDate: '2024-07-20',
    });

    r = await patchMatter(m.id, { replyReceivedOn: '2024-07-15', version: m.version });
    m = r.fraud.matters.find((x) => x.ref === 'FM-001')!;
    expect(m.deadlines.find((d) => d.key === 'cg_forward')).toMatchObject({
      fromDate: '2024-07-15',
      days: 15,
      dueDate: '2024-07-30',
    });
  });

  it('the register drives the Section 143(12) card in 02.7', async () => {
    const o = await getOther();
    expect(o.detail!.fraud).toMatchObject({
      identified: true,
      route: 'central_government',
      formReference: 'ADT-4',
    });
    expect(o.detail!.fraud.basis).toMatch(
      /^3 fraud matter\(s\) on the register \(1 Central Government route, 2 below the threshold\)/,
    );
    const fraud = card(o, REPORTING_CARD.s143_12Fraud);
    expect(fraud.systemReportingStatus).toBe('modified_wording_expected');
    // FM-002 / FM-003 were never reported to the Board — the initial notice is overdue.
    expect(fraud.systemExceptions.join(' ')).toMatch(/Rule 13 deadline\(s\) overdue/);
  });

  it('a director disqualified u/s 164(2) makes Section 143(3)(g) modified wording', async () => {
    let r = await getRecords();
    expect(r.directors.rows.map((d) => d.name).sort()).toEqual(['Asha Rao', 'Vikram Shah']);
    expect(card(await getOther(), REPORTING_CARD.s143Directors).systemReportingStatus).toBe(
      'not_determined',
    );

    const vikram = r.directors.rows.find((d) => d.name === 'Vikram Shah')!;
    r = (
      await request(http())
        .patch(`${recordsUrl()}/directors/${vikram.id}`)
        .set(bearer(pa))
        .send({
          disqualified: 'no',
          legalAnalysis: 'DIR-8 on file; MCA master shows no §164(2) default.',
          version: vikram.version,
        })
        .expect(200)
    ).body;
    const asha = r.directors.rows.find((d) => d.name === 'Asha Rao')!;
    await request(http())
      .patch(`${recordsUrl()}/directors/${asha.id}`)
      .set(bearer(pa))
      .send({
        disqualified: 'yes',
        legalAnalysis: 'Director of a company that has not filed its returns for three years.',
        version: asha.version,
      })
      .expect(200);

    const dir = card(await getOther(), REPORTING_CARD.s143Directors);
    expect(dir.systemReportingStatus).toBe('modified_wording_expected');
    expect(dir.systemExceptions).toEqual(['1 director(s) disqualified u/s 164(2)']);
    expect(dir.applicabilityBasis).toMatch(/2 director\(s\) on the 02\.7 director workpaper/);
  });

  it('the 02.4 / 02.5 / 02.6 results reach the cross-reference cards', async () => {
    // Nothing concluded upstream yet.
    let o = await getOther();
    expect(card(o, REPORTING_CARD.caro)).toMatchObject({
      applicability: 'cross_reference',
      systemReportingStatus: 'cross_reference',
    });
    expect(card(o, REPORTING_CARD.caro).applicabilityBasis).toMatch(/Concluded in 02\.4 — pending/);
    expect(card(o, REPORTING_CARD.s143Icfr).applicability).toBe('cross_reference');
    // 02.6 BR-01's own suggestion: no branch on the master → "No".
    expect(card(o, REPORTING_CARD.branchReporting)).toMatchObject({
      applicability: 'not_applicable_to_facts',
      applicabilityBasis: 'No branches (02.6 BR-01).',
    });

    // 02.4: CARO exempt; 02.5: ICFR exempt; 02.6: branches, as each workspace stores them.
    const decide = (sub: string, area: string, state: string, conclusion: string) =>
      su.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET state = $4, conclusion = $5, system_outcome = $5, decided_at = now()
          WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
        [shellId, sub, area, state, conclusion],
      );
    await decide('02.4', 'caro', 'not_applicable', 'not_applicable_exempt');
    await decide('02.5', 'ifc', 'not_applicable', 'exempt');
    await decide('02.6', 'cfs', 'not_applicable', 'cfs_exempt');
    await su.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET facts = jsonb_set(COALESCE(facts, '{}'::jsonb), '{hasBranches}', 'true'::jsonb)
        WHERE workflow_instance_id = $1 AND sub_section_key = '02.6' AND area_key = 'cfs'`,
      [shellId],
    );
    const ga = `${base()}/${shellId}/group-audit`;
    await request(http()).get(ga).set(bearer(pa)).expect(200);
    await request(http())
      .post(`${ga}/branches`)
      .set(bearer(pa))
      .send({ branchName: 'Pune branch', location: 'Pune' })
      .expect(201);

    const r = await getRecords();
    expect(r.crossRefs.caro).toMatchObject({
      applicable: false,
      conclusion: 'not_applicable_exempt',
    });
    expect(r.crossRefs.icfr).toMatchObject({ reportingRequired: false, conclusion: 'exempt' });
    expect(r.crossRefs.group).toMatchObject({
      branchesExist: true,
      branchAuditors: 1,
      branchReportsDealt: 0,
      branchReportsPending: 1,
      branchReturnsReceived: false,
    });

    o = await getOther();
    expect(card(o, REPORTING_CARD.caro)).toMatchObject({
      applicability: 'not_applicable',
      systemReportingStatus: 'not_applicable',
    });
    expect(card(o, REPORTING_CARD.caro).applicabilityBasis).toMatch(
      /02\.4 concluded CARO does not apply \(not_applicable_exempt\)/,
    );
    expect(card(o, REPORTING_CARD.s143Icfr)).toMatchObject({
      applicability: 'not_applicable',
      systemReportingStatus: 'not_applicable',
    });
    expect(card(o, REPORTING_CARD.branchReporting).applicability).toBe('applicable');
    expect(card(o, REPORTING_CARD.branchReporting).applicabilityBasis).toBe(
      '1 branch auditor(s); 0 report(s) dealt with, 1 pending (02.6 — no second register).',
    );
    expect(card(o, REPORTING_CARD.s143BranchReport).applicability).toBe('applicable');
    expect(card(o, REPORTING_CARD.s143BranchReturns)).toMatchObject({
      systemExceptions: ['Proper returns not received from branches not visited'],
      systemReportingStatus: 'modified_wording_expected',
    });
  });

  it('the completion checklist (Rule 11 / Section 143) reads the real 02.7 decision', async () => {
    const readItem = async () => {
      const c = (await request(http()).get(`${base()}/completion`).set(bearer(pa)).expect(200))
        .body[0] as StatutoryAuditCompletion;
      return c.items.find((i) => i.itemKey === 'rule_11_143')!;
    };
    let item = await readItem();
    expect(item.evidence.facts).toContain('02.7: other Companies Act reporting not yet concluded.');

    const before = await getOther();
    await request(http())
      .post(`${base()}/${shellId}/other-reporting/facts`)
      .set(bearer(pa))
      .send({
        booksProper: 'yes',
        informationObtained: 'yes',
        adverseObservations: 'no',
        accountsQualification: 'no',
        softwareSystems: [
          {
            name: 'Tally Prime',
            module: 'gl',
            featureStatus: 'available',
            enabledThroughout: 'yes',
            transactionsCovered: 'complete',
            canAlterOrDisable: 'no',
            tampering: 'no',
            preservation: 'compliant',
          },
        ],
        litigation: { identified: 'no' },
        foreseeableLosses: { hasLongTermContracts: 'no', hasDerivativeContracts: 'no' },
        iepf: { status: 'not_applicable' },
        dividend: { declaredOrPaid: false },
        rule11eAdvanced: {
          transactionsIdentified: 'no',
          representationObtained: 'yes',
          contraryMatter: 'no',
        },
        rule11eReceived: {
          transactionsIdentified: 'no',
          representationObtained: 'pending',
          contraryMatter: 'no',
        },
        version: before.assessment.version,
      })
      .expect(201);
    const o = await getOther();
    const decided = (
      await request(http())
        .post(`${base()}/${shellId}/other-reporting/decision`)
        .set(bearer(pa))
        .send({ action: 'confirm', version: o.assessment.version })
        .expect(201)
    ).body as StatutoryAuditOtherReporting;
    expect(decided.assessment.conclusion).toBe(OTHER_REPORTING_OUTCOME.attentionRequired);

    item = await readItem();
    const facts = item.evidence.facts.join('\n');
    expect(facts).not.toMatch(/not yet concluded/);
    expect(facts).toMatch(
      /Section 143\(12\): 3 Fraud Matter\(s\) — 1 Central Government route, 2 below the threshold; 3 open/,
    );
    expect(facts).toMatch(
      /Section 164\(2\): 2 director\(s\) — 1 not disqualified, 1 disqualified, 0 pending\./,
    );
    expect(facts).toMatch(/Modified wording expected: .*Section 143\(3\)\(g\)/);
    expect(facts).toMatch(/MRL .*: representation pending\./);
    // Open Fraud Matters and a pending MRL representation keep the item open.
    expect(item.evidence.ready).toBe(false);
    expect(item.state).toBe('in_progress');
    expect(item.noteSuggested).toBe(true);
    expect(item.note).toMatch(
      /1 director\(s\) disqualified under Section 164\(2\) — reported under Section 143\(3\)\(g\)\./,
    );
    expect(item.note).toMatch(
      /3 Fraud Matter\(s\) considered under Section 143\(12\) and Rule 13\./,
    );
  });
});

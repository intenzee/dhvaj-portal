import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  FRAUD_CONCLUSION,
  FRAUD_MATTER_ROUTE,
  REPORTING_CARD,
  type FrameworkEvidenceView,
  type StatutoryAuditOtherReporting,
  type StatutoryAuditReportingRecords,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.7 Track B records — end-to-end: the legacy single-fraud facts become FM-001,
 * Rule 13 deadlines from the Rules Library, the Engagement Partner consultation
 * gate, the §164(2) director workpaper filled from the contacts master, per-card
 * evidence links, the 02.4 / 02.5 / 02.6 cross-references and the §35 outsider.
 */
describe('Statutory Audit — 02.7 reporting records (e2e)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer();

  const token = async (email: string): Promise<string> => {
    const res = await request(http()).post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  let mp: string;
  let pa: string;
  let pb: string;
  const findId = async (path: string): Promise<string> => {
    const res = await request(http()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  let engId: string;
  let shellId: string;
  const base = () => `/api/v1/engagements/${engId}/statutory-audit`;
  const recordsUrl = () => `${base()}/${shellId}/reporting-records`;

  const getRecords = async (t = pa): Promise<StatutoryAuditReportingRecords> =>
    (await request(http()).get(recordsUrl()).set(bearer(t)).expect(200))
      .body as StatutoryAuditReportingRecords;
  const getOther = async (): Promise<StatutoryAuditOtherReporting> =>
    (await request(http()).get(`${base()}/other-reporting`).set(bearer(pa)).expect(200))
      .body[0] as StatutoryAuditOtherReporting;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    const entity = await request(http())
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `Records Co ${stamp()}`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
      })
      .expect(201);
    const entityId = entity.body.id as string;
    for (const [fullName, designation] of [
      ['Vikram Shah', 'Managing Director'],
      ['Asha Rao', 'Independent Director'],
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

    // The earlier single-fraud facts, captured before Fraud Matters existed.
    const before = await getOther();
    await request(http())
      .post(`${base()}/${shellId}/other-reporting/facts`)
      .set(bearer(pa))
      .send({
        fraudIdentified: true,
        fraudAmount: 20000000,
        fraudEventDate: '2024-06-01',
        version: before.assessment.version,
      })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('moves the legacy fraud facts into FM-001 once, and fills directors from the contacts master', async () => {
    const r = await getRecords();
    expect(r.canManage).toBe(true);
    expect(r.viewerIsPartner).toBe(true);
    expect(r.fraud.matters).toHaveLength(1);
    const fm = r.fraud.matters[0]!;
    expect(fm).toMatchObject({
      ref: 'FM-001',
      fromLegacy: true,
      amount: 20000000,
      knowledgeDate: '2024-06-01',
      route: FRAUD_MATTER_ROUTE.centralGovernment,
    });
    expect(r.directors.rows.map((d) => d.name).sort()).toEqual(['Asha Rao', 'Vikram Shah']);
    expect(r.directors.rows.every((d) => d.source === 'contacts')).toBe(true);
    expect(r.directors.contactsAvailable).toBe(0);
    expect(r.crossRefLinks.map((l) => l.key)).toEqual(['caro', 'icfr', 'group']);

    // A second open never duplicates.
    const again = await getRecords();
    expect(again.fraud.matters).toHaveLength(1);
    expect(again.directors.rows).toHaveLength(2);
  });

  it('runs the Rule 13 deadlines from the Board report, with the threshold read by knowledge date', async () => {
    let r = await getRecords();
    const fm = r.fraud.matters[0]!;
    r = (
      await request(http())
        .patch(`${recordsUrl()}/fraud-matters/${fm.id}`)
        .set(bearer(pa))
        .send({ boardReportedOn: '2024-06-03', version: fm.version })
        .expect(200)
    ).body;
    const m = r.fraud.matters[0]!;
    const reply = m.deadlines.find((d) => d.key === 'reply_due')!;
    expect(reply).toMatchObject({ fromDate: '2024-06-03', days: 45, dueDate: '2024-07-18' });
    const noReply = m.deadlines.find((d) => d.key === 'cg_forward_no_reply')!;
    expect(noReply.dueDate).toBe('2024-07-18');
    expect(r.fraud.status.open).toBe(1);
    expect(r.fraud.status.centralGovernmentRoute).toBe(1);

    r = (
      await request(http())
        .patch(`${recordsUrl()}/fraud-matters/${m.id}`)
        .set(bearer(pa))
        .send({ replyReceivedOn: '2024-07-10', version: m.version })
        .expect(200)
    ).body;
    const fwd = r.fraud.matters[0]!.deadlines.find((d) => d.key === 'cg_forward')!;
    expect(fwd).toMatchObject({ fromDate: '2024-07-10', days: 15, dueDate: '2024-07-25' });
  });

  it('rejects dates out of order', async () => {
    const m = (await getRecords()).fraud.matters[0]!;
    await request(http())
      .patch(`${recordsUrl()}/fraud-matters/${m.id}`)
      .set(bearer(pa))
      .send({ boardReportedOn: '2024-05-01', version: m.version })
      .expect(400);
  });

  it('concludes only after the Engagement Partner consultation, on the route the amount sets', async () => {
    let m = (await getRecords()).fraud.matters[0]!;
    await request(http())
      .patch(`${recordsUrl()}/fraud-matters/${m.id}`)
      .set(bearer(pa))
      .send({
        conclusion: FRAUD_CONCLUSION.reportedCentralGovernment,
        conclusionNote: 'Forwarded with the Board reply.',
        cgForwardedOn: '2024-07-20',
        version: m.version,
      })
      .expect(400); // no partner consultation yet

    m = (
      await request(http())
        .post(`${recordsUrl()}/fraud-matters/${m.id}/partner-consultation`)
        .set(bearer(pa))
        .send({ note: 'Consulted — ₹2 crore is at or above the threshold.', version: m.version })
        .expect(201)
    ).body.fraud.matters[0];
    expect(m.partnerConsultedAt).toBeTruthy();

    // ₹2 crore → never the Board route.
    await request(http())
      .patch(`${recordsUrl()}/fraud-matters/${m.id}`)
      .set(bearer(pa))
      .send({
        conclusion: FRAUD_CONCLUSION.reportedAuditCommitteeBoard,
        conclusionNote: 'Wrong route.',
        version: m.version,
      })
      .expect(400);

    const r = (
      await request(http())
        .patch(`${recordsUrl()}/fraud-matters/${m.id}`)
        .set(bearer(pa))
        .send({
          conclusion: FRAUD_CONCLUSION.reportedCentralGovernment,
          conclusionNote: 'Forwarded with the Board reply.',
          cgForwardedOn: '2024-07-20',
          adt4Reference: 'SRN-E2E-1',
          version: m.version,
        })
        .expect(200)
    ).body as StatutoryAuditReportingRecords;
    expect(r.fraud.matters[0]).toMatchObject({
      conclusion: FRAUD_CONCLUSION.reportedCentralGovernment,
      overdue: false,
    });
    expect(r.fraud.status.open).toBe(0);
  });

  it('a below-threshold matter takes the Audit Committee / Board route', async () => {
    const r = (
      await request(http())
        .post(`${recordsUrl()}/fraud-matters`)
        .set(bearer(pa))
        .send({ nature: 'Petty cash misappropriation', amount: 50000, knowledgeDate: '2024-09-01' })
        .expect(201)
    ).body as StatutoryAuditReportingRecords;
    const fm = r.fraud.matters.find((m) => m.ref === 'FM-002')!;
    expect(fm.route).toBe(FRAUD_MATTER_ROUTE.auditCommitteeBoard);
    expect(fm.deadlines.some((d) => d.key === 'cg_forward')).toBe(false);
    expect(r.fraud.status.belowThreshold).toBe(1);
  });

  it('a stale version is a conflict (409)', async () => {
    const m = (await getRecords()).fraud.matters[0]!;
    await request(http())
      .patch(`${recordsUrl()}/fraud-matters/${m.id}`)
      .set(bearer(pa))
      .send({ regulatoryNote: 'stale', version: m.version - 1 })
      .expect(409);
  });

  it('the director workpaper needs a legal analysis for a conclusion; DIN is 8 digits', async () => {
    let r = await getRecords();
    const d = r.directors.rows.find((x) => x.name === 'Vikram Shah')!;
    await request(http())
      .patch(`${recordsUrl()}/directors/${d.id}`)
      .set(bearer(pa))
      .send({ din: '123', version: d.version })
      .expect(400);
    await request(http())
      .patch(`${recordsUrl()}/directors/${d.id}`)
      .set(bearer(pa))
      .send({ disqualified: 'no', version: d.version })
      .expect(400);
    r = (
      await request(http())
        .patch(`${recordsUrl()}/directors/${d.id}`)
        .set(bearer(pa))
        .send({
          din: '01234567',
          disqualified: 'no',
          legalAnalysis: 'DIR-8 received; MCA master data shows no default under §164(2)(a)/(b).',
          version: d.version,
        })
        .expect(200)
    ).body;
    expect(r.directors.status).toMatchObject({ total: 2, cleared: 1, pending: 1 });
    expect(r.directors.status.conclusion).toBe('pending');

    r = (
      await request(http())
        .post(`${recordsUrl()}/directors`)
        .set(bearer(pa))
        .send({ name: 'New Director', designation: 'Director' })
        .expect(201)
    ).body;
    expect(r.directors.rows.find((x) => x.name === 'New Director')?.source).toBe('team');
  });

  it('links evidence to a card, counts it, and keeps the unlink in history', async () => {
    const other = await getOther();
    const ev = (
      await request(http())
        .post(`${base()}/${shellId}/framework/${other.assessment.id}/evidence/add`)
        .set(bearer(pa))
        .send({
          filename: 'DIR-8 Vikram Shah.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('dir-8 (e2e)', 'utf8').toString('base64'),
        })
        .expect(201)
    ).body as FrameworkEvidenceView;
    const documentId = ev.files[0]!.documentId;
    let r = await getRecords();
    const d = r.directors.rows.find((x) => x.name === 'Vikram Shah')!;

    // Director evidence belongs on the §143(3)(g) card.
    await request(http())
      .post(`${recordsUrl()}/evidence`)
      .set(bearer(pa))
      .send({ cardKey: REPORTING_CARD.s143_12Fraud, documentId, directorId: d.id })
      .expect(400);

    r = (
      await request(http())
        .post(`${recordsUrl()}/evidence`)
        .set(bearer(pa))
        .send({
          cardKey: REPORTING_CARD.s143Directors,
          documentId,
          directorId: d.id,
          kind: 'mca_record',
        })
        .expect(201)
    ).body;
    expect(r.evidence.counts[REPORTING_CARD.s143Directors]).toBe(1);
    expect(r.directors.rows.find((x) => x.id === d.id)).toMatchObject({
      evidenceCount: 1,
      mcaLinks: 1,
    });
    // The same document twice on the same card is one link.
    await request(http())
      .post(`${recordsUrl()}/evidence`)
      .set(bearer(pa))
      .send({
        cardKey: REPORTING_CARD.s143Directors,
        documentId,
        directorId: d.id,
        kind: 'mca_record',
      })
      .expect(409);

    const link = r.evidence.links.find((l) => l.cardKey === REPORTING_CARD.s143Directors)!;
    r = (
      await request(http())
        .post(`${recordsUrl()}/evidence/${link.id}/unlink`)
        .set(bearer(pa))
        .expect(201)
    ).body;
    expect(r.evidence.counts[REPORTING_CARD.s143Directors] ?? 0).toBe(0);
  });

  it('records audit events for the Fraud Matter and director changes', async () => {
    const res = await request(http()).get('/api/v1/audit?limit=100').set(bearer(mp)).expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'statutory_audit.fraud_matter_created',
        'statutory_audit.fraud_matter_updated',
        'statutory_audit.fraud_matter_partner_consulted',
        'statutory_audit.director_check_updated',
        'statutory_audit.reporting_evidence_linked',
      ]),
    );
  });

  it('an outsider (not on the engagement) cannot read or change the records (§35)', async () => {
    await request(http()).get(recordsUrl()).set(bearer(pb)).expect(404);
    await request(http())
      .post(`${recordsUrl()}/fraud-matters`)
      .set(bearer(pb))
      .send({ nature: 'Outsider' })
      .expect(404);
  });
});

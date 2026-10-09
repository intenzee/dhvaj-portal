import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  COMPLETENESS_STATUS,
  PROFILE_CONFIRMATION_STATEMENT,
  SMALL_COMPANY_OUTCOME,
  type ConfirmableProfileCard,
  type StatutoryAuditEntityProfile,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.1 Entity & Regulatory Profile — end-to-end (Implementation Guide §9.1;
 * DHVAJ 02.1 web developer specification). The fact foundation: Cards A–J
 * captured and confirmed card by card, the Small Company status computed from
 * the §2(85) rule version with a reasoned professional override, the SA
 * 510/402/299 triggers, evidence files, CONFIRM PROFILE behind the
 * confirmation statement, a controlled reopen, master-change detection after
 * confirmation, and the date-resolved provision viewer. Plus the §35
 * assignment-scoped security check for an outsider.
 */
describe('Statutory Audit — 02.1 Profile (e2e §9.1)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePeriod = (): string => `P${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

  let mp: string; // Managing Partner — firm-wide reads (id lookups + audit).
  let pa: string; // Partner A (North) — the EP/lead who performs the audit.
  let pb: string; // Partner B (South) — NOT on this engagement (the outsider).

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  let entityId: string;
  let engId: string;
  let shellId: string;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    entityId = await findId('/api/v1/entities?search=Acme&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const created = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId: primaryServiceId,
        financialYear: '2024-25',
        periodLabel: uniquePeriod(),
        status: 'accepted',
      })
      .expect(201);
    engId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);
    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    shellId = shells.body[0].workflowInstanceId as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  const base = () => `/api/v1/engagements/${engId}/statutory-audit/${shellId}/profile`;
  const getProfile = async (t: string): Promise<StatutoryAuditEntityProfile> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/profile`)
      .set(bearer(t))
      .expect(200);
    return res.body[0] as StatutoryAuditEntityProfile;
  };
  const post = (path: string, body: object, t = pa) =>
    request(app.getHttpServer()).post(path).set(bearer(t)).send(body);
  const auditActions = async (): Promise<string[]> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?limit=100`)
      .set(bearer(mp))
      .expect(200);
    return (res.body.items as Array<{ action: string }>).map((e) => e.action);
  };
  const financialReportingFlagged = async (): Promise<boolean> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/financial-reporting`)
      .set(bearer(pa))
      .expect(200);
    return res.body[0].assessment.needsReevaluation as boolean;
  };

  /** Confirm every card Card J still lists as unconfirmed / changed since confirmation. */
  const confirmOpenCards = async (): Promise<StatutoryAuditEntityProfile> => {
    let profile = await getProfile(pa);
    const open = new Set<ConfirmableProfileCard>();
    for (const item of profile.completeness.items) {
      if (item.kind === 'unconfirmed' || item.key.startsWith('stale:'))
        open.add(item.card as ConfirmableProfileCard);
    }
    for (const card of open) {
      const res =
        card === 'E'
          ? await post(`${base()}/small-company`, { action: 'confirm', version: profile.version })
          : await post(`${base()}/cards/confirm`, { card, version: profile.version });
      expect(res.status).toBe(201);
      profile = res.body as StatutoryAuditEntityProfile;
    }
    return profile;
  };

  it('provisions a draft profile with the master classification, nav and provision links', async () => {
    const profile = await getProfile(pa);
    expect(profile.state).toBe('draft');
    expect(profile.classification.category).not.toBeNull();
    expect(profile.confirmation).toBeNull();
    // Every SA trigger is present, defaulting to not-triggered.
    expect(profile.saTriggers.map((t) => t.code).sort()).toEqual(['SA 299', 'SA 402', 'SA 510']);
    // Left navigation 02.1–02.10 with statuses.
    expect(profile.sectionNav.map((n) => n.key)).toEqual([
      '02.1',
      '02.2',
      '02.3',
      '02.4',
      '02.5',
      '02.6',
      '02.7',
      '02.8',
      '02.9',
      '02.10',
    ]);
    // View Provision / View Standard resolved by the engagement period.
    const refs = new Map(profile.references.map((r) => [r.anchor, r]));
    expect(refs.get('small_company')?.code).toBe('COS_ACT_2_85');
    expect(refs.get('initial_audit')?.provision?.referenceKind).toBe('standard');
    expect(refs.get('service_organisation')?.code).toBe('SA_402');
    expect(refs.get('joint_audit')?.code).toBe('SA_299');
    expect(refs.get('financial_year')?.provision?.summary).toBeTruthy();
    // Nothing confirmed yet — Card J lists the open work, not "complete".
    expect(profile.completeness.status).not.toBe(COMPLETENESS_STATUS.complete);
    expect(profile.readyToConfirm).toBe(false);
    expect(profile.cards.map((c) => c.key)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
    ]);
  });

  it('captures the reusable financial block with preparer, source date and prior-year column', async () => {
    await post(`${base()}/financials`, {
      parameter: 'paid_up_capital',
      currentValue: 20000000,
      priorValue: 20000000,
      source: 'audited_financials',
    }).expect(201);
    // The other required parameters (net worth, total assets, borrowings).
    for (const [parameter, currentValue] of [
      ['net_worth', 60000000],
      ['total_assets', 400000000],
      ['borrowings', 50000000],
    ] as const) {
      await post(`${base()}/financials`, {
        parameter,
        currentValue,
        source: 'audited_financials',
      }).expect(201);
    }
    const res = await post(`${base()}/financials`, {
      parameter: 'turnover',
      currentValue: 300000000,
      priorValue: 250000000,
      source: 'audited_financials',
    }).expect(201);
    const profile = res.body as StatutoryAuditEntityProfile;
    const turnover = profile.financialRows.find((r) => r.parameter === 'turnover');
    expect(turnover?.current.value).toBe(300000000);
    expect(turnover?.prior.value).toBe(250000000);
    expect(turnover?.captured?.preparer).toBeTruthy();
    expect(profile.financials.find((f) => f.parameter === 'turnover')?.preparer).toBeTruthy();
    expect(profile.smallCompany.outcome).not.toBe(SMALL_COMPANY_OUTCOME.pending);
    if (
      profile.smallCompany.outcome === SMALL_COMPANY_OUTCOME.small ||
      profile.smallCompany.outcome === SMALL_COMPANY_OUTCOME.notSmall
    ) {
      expect(profile.smallCompany.authorityProvisionId).not.toBeNull();
      expect(profile.smallCompany.ruleVersionId).not.toBeNull();
    }
  });

  it('Save Draft records Cards A/B/F/H/I and fires SA 299 + SA 402 from the facts', async () => {
    const draft = await getProfile(pa);
    await post(base(), {
      listingAnswer: draft.listing.masterListed ? 'yes' : 'no',
      listingInProcess: draft.listing.masterInProcess ? 'yes' : 'no',
      ...(draft.specialEntityTypes.includes('other_regulator') ? { regulator: 'rbi' } : {}),
      ...(draft.period.nonStandard ? { differentFyApproved: 'yes' } : {}),
      jointAudit: true,
      accountingEnvironment: 'outsourced_service_organisation',
      accountingSoftware: 'tally',
      recordsElectronic: 'yes',
      serviceOrg: 'yes',
      serviceOrgService: 'Payroll processing',
      serviceOrgProvider: 'PayCo Services Pvt Ltd',
      version: draft.version,
    }).expect(201);

    const updated = await getProfile(pa);
    const trig = new Map(updated.saTriggers.map((t) => [t.code, t.triggered]));
    expect(trig.get('SA 299')).toBe(true);
    expect(trig.get('SA 402')).toBe(true);
    expect(updated.accounting.software).toBe('tally');
    expect(updated.accounting.serviceOrg).toBe('yes');
    expect(updated.header.lastUpdatedByName).toBeTruthy();
    // A stale version is refused (optimistic concurrency).
    await post(base(), { jointAudit: true, version: draft.version }).expect(409);
  });

  it('adds an evidence file to a field and unlinks it (the document is kept)', async () => {
    const added = await post(`${base()}/files/add`, {
      slot: 'service_org',
      filename: 'service-agreement.txt',
      contentType: 'text/plain',
      contentBase64: b64('PayCo service agreement'),
    }).expect(201);
    const files = (added.body as StatutoryAuditEntityProfile).files;
    expect(files).toHaveLength(1);
    const [file] = files as [(typeof files)[number]];
    expect(file.slot).toBe('service_org');
    expect(file.filename).toBe('service-agreement.txt');
    expect(file.inSharePoint).toBe(false); // Microsoft 365 is off in e2e.

    // Re-linking the same document to another field works; then unlink both.
    const linked = await post(`${base()}/files/link`, {
      slot: 'joint_audit',
      documentId: file.documentId,
    }).expect(201);
    expect((linked.body as StatutoryAuditEntityProfile).files).toHaveLength(2);
    for (const f of (linked.body as StatutoryAuditEntityProfile).files) {
      await post(`${base()}/files/${f.id}/unlink`, {}).expect(201);
    }
    expect((await getProfile(pa)).files).toHaveLength(0);
    // An unknown slot is refused at the boundary.
    await post(`${base()}/files/link`, { slot: 'bogus', documentId: file.documentId }).expect(400);
  });

  it('Card I cannot be confirmed until the other joint auditor is recorded', async () => {
    let profile = await getProfile(pa);
    await post(`${base()}/cards/confirm`, { card: 'I', version: profile.version }).expect(400);
    const saved = await post(base(), {
      jointAuditors: [{ firmName: 'Mehta & Co', frn: '123456W', contact: 'audit@mehta.example' }],
      version: profile.version,
    }).expect(201);
    profile = saved.body as StatutoryAuditEntityProfile;
    expect(profile.jointAuditors).toEqual([
      expect.objectContaining({ firmName: 'Mehta & Co', frn: '123456W' }),
    ]);
    const confirmed = await post(`${base()}/cards/confirm`, {
      card: 'I',
      version: profile.version,
    }).expect(201);
    const cardI = (confirmed.body as StatutoryAuditEntityProfile).cards.find((c) => c.key === 'I');
    expect(cardI?.status).toBe('confirmed');
    expect(cardI?.confirmation?.confirmedByName).toBeTruthy();
  });

  it('Card E keeps the system result beside a reasoned professional override', async () => {
    let profile = await getProfile(pa);
    const system = profile.smallCompanyConclusion.systemOutcome;
    const other = system === SMALL_COMPANY_OUTCOME.small ? 'not_small' : 'small';
    // An override needs a reason.
    await post(`${base()}/small-company`, {
      action: 'override',
      outcome: other,
      version: profile.version,
    }).expect(400);
    const overridden = await post(`${base()}/small-company`, {
      action: 'override',
      outcome: other,
      reason: 'Paid-up capital was increased after the balance sheet date (e2e).',
      version: profile.version,
    }).expect(201);
    profile = overridden.body as StatutoryAuditEntityProfile;
    expect(profile.smallCompanyConclusion.systemOutcome).toBe(system);
    expect(profile.smallCompanyConclusion.finalOutcome).toBe(other);
    expect(profile.smallCompanyConclusion.override?.reason).toMatch(/Paid-up capital/);

    // Clear the override and confirm the system assessment instead.
    const cleared = await post(`${base()}/small-company`, {
      action: 'clear_override',
      version: profile.version,
    }).expect(201);
    profile = cleared.body as StatutoryAuditEntityProfile;
    expect(profile.smallCompanyConclusion.override).toBeNull();
    expect(profile.smallCompanyConclusion.finalOutcome).toBe(system);
    expect(await auditActions()).toContain('statutory_audit.profile_small_company_overridden');
  });

  it('CONFIRM PROFILE needs the confirmation statement and no blocking Card J item', async () => {
    // The statement must be accepted.
    await post(`${base()}/confirm`, { note: 'x' }).expect(400);
    // Cards still unconfirmed → blocked.
    const blocked = await post(`${base()}/confirm`, { acknowledged: true });
    expect(blocked.status).toBe(400);
  });

  it('CONFIRM PROFILE freezes the fact set + methodology version, and blocks further edits', async () => {
    // Seed 02.2 so the downstream flags have a row to mark later.
    expect(await financialReportingFlagged()).toBe(false);

    const ready = await confirmOpenCards();
    expect(ready.readyToConfirm).toBe(true);
    expect(ready.completeness.items.filter((i) => i.blocking)).toEqual([]);

    const res = await post(`${base()}/confirm`, {
      note: 'Profile confirmed (e2e).',
      acknowledged: true,
    }).expect(201);
    const confirmed = res.body as StatutoryAuditEntityProfile;
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.confirmation?.methodologyVersion).toBe('v2026.1');
    expect(confirmed.confirmation?.confirmedAt).toBeTruthy();
    expect(confirmed.confirmation?.statement).toBe(PROFILE_CONFIRMATION_STATEMENT);
    expect(confirmed.completeness.status).toBe(COMPLETENESS_STATUS.complete);
    expect(confirmed.completeness.percent).toBe(100);
    expect(confirmed.sectionNav.find((n) => n.key === '02.1')?.status).toBe('complete');

    // A confirmed profile is frozen — edits require a controlled reopen.
    await post(base(), { jointAudit: false, version: confirmed.version }).expect(409);
  });

  it('records immutable audit events for the cards and the confirmation', async () => {
    const actions = await auditActions();
    expect(actions).toContain('statutory_audit.profile_confirmed');
    expect(actions).toContain('statutory_audit.profile_card_confirmed');
  });

  it('a controlled reopen (reason required) re-flags the affected downstream sections', async () => {
    await post(`${base()}/reopen`, {}).expect(400);
    const reopened = await post(`${base()}/reopen`, {
      reason: 'Turnover corrected after the final audited figures.',
    }).expect(201);
    expect((reopened.body as StatutoryAuditEntityProfile).reopen?.reason).toMatch(/Turnover/);

    await post(`${base()}/financials`, {
      parameter: 'turnover',
      currentValue: 1200000000,
      priorValue: 250000000,
      source: 'audited_financials',
    }).expect(201);
    const ready = await confirmOpenCards();
    expect(ready.readyToConfirm).toBe(true);
    await post(`${base()}/confirm`, { acknowledged: true }).expect(201);

    // Turnover drives 02.2 (financial reporting framework) → Needs Re-evaluation.
    expect(await financialReportingFlagged()).toBe(true);
    const after = await getProfile(pa);
    expect(after.state).toBe('confirmed');
    expect(after.needsReevaluation).toBe(false);
  });

  it('flags the profile when the Entity Master changes after confirmation', async () => {
    const added = await request(app.getHttpServer())
      .post(`/api/v1/entities/${entityId}/listings`)
      .set(bearer(mp))
      .send({ exchange: 'nse', securityType: 'equity', status: 'in_process' })
      .expect(201);
    const lines = added.body.listings as Array<{ id: string; status: string }>;
    const lineId = lines.find((l) => l.status === 'in_process')?.id as string;
    try {
      const profile = await getProfile(pa);
      expect(profile.needsReevaluation).toBe(true);
      expect(await auditActions()).toContain('statutory_audit.profile_change_detected');
    } finally {
      await request(app.getHttpServer())
        .delete(`/api/v1/entities/${entityId}/listings/${lineId}`)
        .set(bearer(mp));
    }
  });

  it('resolves a provision by date for the viewer; only an admin maintains its content', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/authority-provisions/COS_ACT_2_85?on=2024-04-01')
      .set(bearer(pa))
      .expect(200);
    expect(res.body.code).toBe('COS_ACT_2_85');
    expect(res.body.summary).toBeTruthy();
    expect(res.body.sourceUrl).toBe('https://www.indiacode.nic.in/handle/123456789/2114');
    await request(app.getHttpServer())
      .get('/api/v1/authority-provisions/COS_ACT_2_85?on=01-04-2024')
      .set(bearer(pa))
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/authority-provisions/${res.body.id}`)
      .set(bearer(pa))
      .send({ sourceUrl: 'https://www.mca.gov.in/' })
      .expect(403);
  });

  it('an outsider (not on the engagement) cannot read or confirm the profile (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/profile`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0); // RLS returns no rows for a non-member.

    await post(`${base()}/confirm`, { acknowledged: true }, pb).expect(404); // Invisible under RLS.
  });
});

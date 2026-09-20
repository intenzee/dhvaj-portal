import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SMALL_COMPANY_OUTCOME, type StatutoryAuditEntityProfile } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 02.1 Entity & Regulatory Profile — end-to-end (Implementation Guide §9.1). The
 * fact foundation: capture the reusable financial block, compute the Small
 * Company status from the §2(85) rule version (never a checkbox), carry the
 * SA 510/402/299 triggers, and CONFIRM to freeze the fact set + methodology
 * version. Plus the §35 assignment-scoped security check for an outsider.
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

  let mp: string; // Managing Partner — firm-wide reads (id lookups + audit).
  let pa: string; // Partner A (North) — the EP/lead who performs the audit.
  let pb: string; // Partner B (South) — NOT on this engagement (the outsider).

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  let engId: string;
  let shellId: string;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
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

  const getProfile = async (t: string): Promise<StatutoryAuditEntityProfile> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/profile`)
      .set(bearer(t))
      .expect(200);
    return res.body[0] as StatutoryAuditEntityProfile;
  };

  it('provisions a draft profile with the master classification pre-populated (Card A)', async () => {
    const profile = await getProfile(pa);
    expect(profile.state).toBe('draft');
    expect(profile.classification.category).not.toBeNull();
    expect(profile.confirmation).toBeNull();
    // Every SA trigger is present, defaulting to not-triggered.
    expect(profile.saTriggers.map((t) => t.code).sort()).toEqual(['SA 299', 'SA 402', 'SA 510']);
  });

  it('captures the reusable financial block and updates the professional facts', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'paid_up_capital', currentValue: 20000000, source: 'audited_financials' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/profile/financials`)
      .set(bearer(pa))
      .send({ parameter: 'turnover', currentValue: 300000000, source: 'audited_financials' })
      .expect(201);

    const draft = await getProfile(pa);
    // Joint audit + service organisation → SA 299 & SA 402 fire from the facts.
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/profile`)
      .set(bearer(pa))
      .send({
        jointAudit: true,
        accountingEnvironment: 'outsourced_service_organisation',
        version: draft.version,
      })
      .expect(201);

    const updated = await getProfile(pa);
    const trig = new Map(updated.saTriggers.map((t) => [t.code, t.triggered]));
    expect(trig.get('SA 299')).toBe(true);
    expect(trig.get('SA 402')).toBe(true);
    expect(updated.financials.map((f) => f.parameter).sort()).toEqual([
      'paid_up_capital',
      'turnover',
    ]);
  });

  it('computes the Small Company status from the §2(85) rule, not a checkbox', async () => {
    const profile = await getProfile(pa);
    // The outcome is computed (never pending once the deciding facts exist) and,
    // where a rule drove it, cites the actual §2(85) provision + rule version.
    expect(profile.smallCompany.outcome).not.toBe(SMALL_COMPANY_OUTCOME.pending);
    if (
      profile.smallCompany.outcome === SMALL_COMPANY_OUTCOME.small ||
      profile.smallCompany.outcome === SMALL_COMPANY_OUTCOME.notSmall
    ) {
      expect(profile.smallCompany.authorityProvisionId).not.toBeNull();
      expect(profile.smallCompany.ruleVersionId).not.toBeNull();
    }
    expect(profile.readyToConfirm).toBe(true);
  });

  it('CONFIRM PROFILE freezes the fact set + methodology version, and blocks further edits', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/profile/confirm`)
      .set(bearer(pa))
      .send({ note: 'Profile confirmed (e2e).' })
      .expect(201);
    const confirmed = res.body[0] as StatutoryAuditEntityProfile;
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.confirmation?.methodologyVersion).toBe('v2026.1');
    expect(confirmed.confirmation?.confirmedAt).toBeTruthy();

    // A confirmed profile is frozen — edits require a controlled reassessment.
    const draftVersion = confirmed.version;
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/profile`)
      .set(bearer(pa))
      .send({ jointAudit: false, version: draftVersion })
      .expect(409);
  });

  it('records an immutable audit event for the confirmation', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit?objectType=audit_entity_profile&limit=50`)
      .set(bearer(mp))
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('statutory_audit.profile_confirmed');
  });

  it('an outsider (not on the engagement) cannot read or confirm the profile (§35)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/profile`)
      .set(bearer(pb))
      .expect(200);
    expect(res.body).toHaveLength(0); // RLS returns no rows for a non-member.

    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/profile/confirm`)
      .set(bearer(pb))
      .send({})
      .expect(404); // The shell is invisible under RLS.
  });
});

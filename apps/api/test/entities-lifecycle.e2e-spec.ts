import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Phase B — Entity Master write-path lifecycle:
 *   • progressive completion (create on minimum identity; missing-info surfaced,
 *     never "Not Applicable")
 *   • registration obtained later (§34) + verification (§11)
 *   • year-wise financials are append-only (§16) — superseded, never overwritten
 *   • a complete regulatory profile is flagged Needs Reassessment on change (§28)
 */
describe('Entity Master lifecycle (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const create = async (t: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/v1/entities').set(bearer(t)).send(body).expect(201);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('creates on minimum identity and surfaces missing info (§5/§27)', async () => {
    const t = await token('partner.a@hsdg.in');
    const res = await create(t, {
      legalName: 'Minimal Identity Pvt Ltd',
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
      status: 'draft',
    });
    expect(res.body.status).toBe('draft');
    expect(res.body.regulatoryProfileStatus).toBe('incomplete');
    const codes = (res.body.missingInfo as Array<{ code: string }>).map((m) => m.code);
    // Absent facts are reported as missing — never as Not Applicable.
    expect(codes).toEqual(
      expect.arrayContaining(['pan', 'registrations', 'primary_contact', 'financials', 'cin']),
    );
    expect(
      (res.body.missingInfo as Array<{ severity: string }>).every((m) => m.severity !== undefined),
    ).toBe(true);
  });

  it('round-trips the new identity/constitution/regulatory fields', async () => {
    const t = await token('partner.a@hsdg.in');
    const res = await create(t, {
      legalName: 'Fielded Co Pvt Ltd',
      tradeName: 'Fielded',
      shortName: 'FCO',
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
      legalStatus: 'under_incorporation',
      listingStatus: 'unlisted',
      currentAccountingFramework: 'ind_as',
      countryOfIncorporation: 'in',
      authorisedCapital: 1000000,
    });
    expect(res.body.tradeName).toBe('Fielded');
    expect(res.body.legalStatus).toBe('under_incorporation');
    expect(res.body.currentAccountingFramework).toBe('ind_as');
    expect(res.body.countryOfIncorporation).toBe('IN');
    expect(res.body.authorisedCapital).toBe(1000000);
  });

  it('registration obtained later: pending → active + verified (§34/§11)', async () => {
    const t = await token('partner.a@hsdg.in');
    const created = await create(t, {
      legalName: 'GST Later Pvt Ltd',
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
      registrations: [
        {
          registrationType: 'gstin',
          registrationNumber: `PENDING-${Date.now()}`,
          status: 'pending',
        },
      ],
    });
    const id = created.body.id as string;
    const reg = created.body.registrations[0];
    expect(reg.status).toBe('pending');
    expect(reg.applicability).toBe('unknown');
    expect(reg.verified).toBe(false);

    const issued = `27ABCDE${Math.floor(1000 + Math.random() * 8999)}F1Z5`;
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/entities/${id}/registrations/${reg.id}`)
      .set(bearer(t))
      .send({
        registrationNumber: issued,
        status: 'active',
        applicability: 'applicable',
        validFrom: '2025-04-01',
        jurisdiction: 'Maharashtra',
        source: 'government_portal',
      })
      .expect(200);
    const u = updated.body.registrations.find((r: { id: string }) => r.id === reg.id);
    expect(u.status).toBe('active');
    expect(u.registrationNumber).toBe(issued);
    expect(u.jurisdiction).toBe('Maharashtra');

    const verified = await request(app.getHttpServer())
      .post(`/api/v1/entities/${id}/registrations/${reg.id}/verify`)
      .set(bearer(t))
      .expect(201);
    const v = verified.body.registrations.find((r: { id: string }) => r.id === reg.id);
    expect(v.verified).toBe(true);
    expect(v.verifiedBy).toBeTruthy();
    expect(v.verifiedAt).toBeTruthy();
  });

  it('financials are append-only per year — superseded, never overwritten (§16)', async () => {
    const t = await token('partner.a@hsdg.in');
    const created = await create(t, {
      legalName: 'Finance History Pvt Ltd',
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    });
    const id = created.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/entities/${id}/financial-profiles`)
      .set(bearer(t))
      .send({ financialYear: '2024-25', turnover: 5000000, source: 'provisional_financials' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/v1/entities/${id}/financial-profiles`)
      .set(bearer(t))
      .send({ financialYear: '2024-25', turnover: 7500000, source: 'audited_financials' })
      .expect(201);

    const profiles = second.body.financialProfiles as Array<{
      financialYear: string;
      turnover: number;
      isCurrent: boolean;
      source: string;
      supersedesId: string | null;
    }>;
    const fy = profiles.filter((p) => p.financialYear === '2024-25');
    expect(fy).toHaveLength(2); // both retained
    const current = fy.filter((p) => p.isCurrent);
    expect(current).toHaveLength(1);
    const cur = current[0]!;
    expect(cur.turnover).toBe(7500000);
    expect(cur.source).toBe('audited_financials');
    expect(cur.supersedesId).toBeTruthy();
    const superseded = fy.find((p) => !p.isCurrent)!;
    expect(superseded.turnover).toBe(5000000); // prior figures preserved
  });

  it('flags a complete regulatory profile Needs Reassessment on master change (§28)', async () => {
    const t = await token('partner.a@hsdg.in');
    const created = await create(t, {
      legalName: 'Reassess Co Pvt Ltd',
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    });
    const id = created.body.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/entities/${id}`)
      .set(bearer(t))
      .send({ regulatoryProfileStatus: 'complete' })
      .expect(200);
    const after = await request(app.getHttpServer())
      .post(`/api/v1/entities/${id}/financial-profiles`)
      .set(bearer(t))
      .send({ financialYear: '2023-24', netWorth: 250000 })
      .expect(201);
    expect(after.body.regulatoryProfileStatus).toBe('needs_reassessment');
  });
});

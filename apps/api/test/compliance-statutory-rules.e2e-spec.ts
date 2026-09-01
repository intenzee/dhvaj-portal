import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Seeded statutory rules (§4/§6–§15, migration 0035). The catalogue now ships
 * real due-date rules, so generating an obligation yields the correct Indian
 * statutory deadline out of the box. "Today" is the machine clock (2026-08-27);
 * FY 2026-27 ends 2027-03-31. working_day_adjustment='next' shifts a deadline
 * that lands on a weekend/holiday to the next working day (only ITR below does).
 */
describe('Seeded statutory compliance rules (e2e)', () => {
  let app: INestApplication;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };

  const createEngagement = async (epToken: string): Promise<string> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `STR${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  const generate = (t: string, eng: string, complianceRuleCode: string, referenceDate?: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(t))
      .send(referenceDate ? { complianceRuleCode, referenceDate } : { complianceRuleCode });

  let pa: string;
  let eng: string;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    eng = await createEngagement(pa);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('computes the right period-anchored monthly/quarterly statutory deadlines', async () => {
    // period_end 2026-04-30 → Nth of the following month.
    const cases: Array<[string, string]> = [
      ['GSTR1_MONTHLY', '2026-05-11'], // 11th
      ['GSTR3B_MONTHLY', '2026-05-20'], // 20th
      ['TDS_PAYMENT_MONTHLY', '2026-05-07'], // 7th
      ['PF_MONTHLY', '2026-05-15'], // 15th
    ];
    for (const [code, expected] of cases) {
      const res = await generate(pa, eng, code, '2026-04-30').expect(201);
      expect([code, res.body.statutoryDeadline]).toEqual([code, expected]);
    }
  });

  it('computes the right FY-anchored annual/audit statutory deadlines', async () => {
    // fy_end 2027-03-31 + month offset; no referenceDate (derived from FY).
    const taxAudit = await generate(pa, eng, 'TAX_AUDIT_44AB').expect(201);
    expect(taxAudit.body.statutoryDeadline).toBe('2027-09-30'); // +6 months

    const gstr9 = await generate(pa, eng, 'GSTR9_ANNUAL').expect(201);
    expect(gstr9.body.statutoryDeadline).toBe('2027-12-31'); // +9 months

    // ITR: +4 months = 2027-07-31 (a Saturday) → next working day 2027-08-02.
    const itr = await generate(pa, eng, 'ITR_FILING_DUE').expect(201);
    expect(itr.body.statutoryDeadline).toBe('2027-08-02');
  });

  it('keeps the internal SLA on or before the statutory date (two distinct clocks §5)', async () => {
    const res = await generate(pa, eng, 'GSTR3B_MONTHLY', '2026-06-30').expect(201);
    expect(res.body.statutoryDeadline).toBe('2026-07-20');
    // internal SLA = statutory − buffer (3 days here), pulled to a working day.
    expect(new Date(res.body.internalSlaDate).getTime()).toBeLessThan(
      new Date(res.body.statutoryDeadline).getTime(),
    );
  });

  it('computes the broadened §6–§15 statutory obligations (TCS, DIR-3 KYC, advance tax, LUT)', async () => {
    // Period-anchored: TCS monthly deposit = period_end + 7.
    const tcs = await generate(pa, eng, 'TCS_COLLECTION_MONTHLY', '2026-04-30').expect(201);
    expect(tcs.body.statutoryDeadline).toBe('2026-05-07');

    // FY-anchored, no referenceDate: DIR-3 KYC = fy_end + 6 = 30 Sep 2027.
    const kyc = await generate(pa, eng, 'DIR3_KYC_ANNUAL').expect(201);
    expect(kyc.body.statutoryDeadline).toBe('2027-09-30');

    // GSTR-9C = fy_end + 9 = 31 Dec 2027; LUT = fy_end + 0 = 31 Mar 2027.
    expect((await generate(pa, eng, 'GSTR9C_ANNUAL').expect(201)).body.statutoryDeadline).toBe(
      '2027-12-31',
    );
    expect((await generate(pa, eng, 'GST_LUT_ANNUAL').expect(201)).body.statutoryDeadline).toBe(
      '2027-03-31',
    );

    // Advance tax first instalment = fixed 15 June of the FY-end year (2027).
    const at = await generate(pa, eng, 'ADVANCE_TAX_Q1').expect(201);
    expect(at.body.statutoryDeadline).toBe('2027-06-15');
  });

  it('surfaces the seeded rules pre-classified and linked to their components', async () => {
    const gstr1 = await request(app.getHttpServer())
      .get('/api/v1/service-components/GSTR1')
      .set(bearer(mp))
      .expect(200);
    expect(gstr1.body.dueDateCategory).toBe('STATUTORY_FIXED');
    // The component now links its statutory rule (was NULL before 0035).
    expect(gstr1.body.complianceRuleId).toBeTruthy();
  });
});

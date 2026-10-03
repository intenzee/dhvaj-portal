import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditRisk } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Section 04 — the risk register seeds itself from what the file knows: the
 * SA 240 presumptions, planning signals the Manager raised, related parties
 * and opening balances; owner/reviewer from the engagement; a deleted
 * suggestion is never suggested again.
 */
describe('Statutory Audit — Section 04 suggested risks (e2e)', () => {
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
  const get = (url: string) => request(app.getHttpServer()).get(url).set(bearer(pa)).expect(200);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('opens with the suggested risks, owned and reviewed, and never re-suggests a deleted one', async () => {
    const mk = async (name: string) =>
      (
        await post(pa, '/api/v1/entities', {
          legalName: `${name} ${stamp()}`,
          typeSlug: 'private_limited',
          officeCode: 'NORTH',
        }).expect(201)
      ).body.id as string;
    const entityId = await mk('Risk Seed');
    const parentId = await mk('Risk Seed Parent');
    await post(pa, `/api/v1/entities/${entityId}/relationships`, {
      toEntityId: parentId,
      relationshipType: 'subsidiary',
    }).expect(201);

    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId,
      serviceId: itr,
      financialYear: '2024-25',
      periodLabel: `P${stamp()}`,
      status: 'accepted',
    }).expect(201);
    const engId = eng.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    const shells = await get(`/api/v1/engagements/${engId}/statutory-audit`);
    const shellId = shells.body[0].workflowInstanceId as string;
    const base = `/api/v1/engagements/${engId}/statutory-audit`;

    // A planning signal the Manager raised to Enhanced attention.
    const sig = await post(pa, `${base}/${shellId}/planning-signals`, {
      source: 'manager',
      observation: 'Customer concentration rose to 70% of revenue',
      whyMayMatter: 'Recoverability and cut-off',
      suggestedAttention: 'enhanced',
    });
    expect([200, 201]).toContain(sig.status);

    const reg = await get(`${base}/risks`);
    const risks = reg.body[0].risks as AuditRisk[];
    const byKey = new Map(risks.map((r) => [r.sourceKey, r]));
    expect(byKey.get('sa240:management_override')).toEqual(
      expect.objectContaining({
        isSignificant: true,
        isFraudRisk: true,
        status: 'response_planned',
      }),
    );
    expect(byKey.get('sa240:revenue_recognition')?.fsArea).toBe('Revenue');
    expect(byKey.has('sa550:related_parties')).toBe(true);
    expect(byKey.has('sa510:opening_balances')).toBe(true); // no earlier file → first-year audit
    const fromSignal = risks.find((r) => r.sourceKey?.startsWith('signal:'));
    expect(fromSignal?.description).toMatch(/Customer concentration/);
    expect(fromSignal?.sourceNote).toMatch(/^Planning signal PS-\d{3} \(Enhanced\)$/);
    // Owner and reviewer come from the engagement's leads.
    expect(risks.every((r) => r.reviewerEmployeeId != null)).toBe(true);
    // The SA 240 responses are planned, so nothing significant lacks a response.
    expect(reg.body[0].significantRisksWithoutResponse).toBe(0);

    // The team deletes a suggestion; a refresh never brings it back.
    const rp = byKey.get('sa550:related_parties')!;
    await request(app.getHttpServer()).delete(`${base}/risks/${rp.id}`).set(bearer(pa)).expect(200);
    const again = await post(pa, `${base}/${shellId}/risks/suggest`, {}).expect(201);
    expect(again.body.added).toBe(0);
    expect(
      (again.body.register.risks as AuditRisk[]).some(
        (r) => r.sourceKey === 'sa550:related_parties',
      ),
    ).toBe(false);

    // An outsider cannot add suggestions.
    const res = await post(pb, `${base}/${shellId}/risks/suggest`, {});
    expect([403, 404]).toContain(res.status);
  });
});

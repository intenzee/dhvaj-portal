import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Engagement core through the HTTP API: assignment-based access (independent of
 * office), audited creation/management, EP-reassignment governance, and
 * engagement identity uniqueness.
 */
describe('Engagement Core (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const codes = (items: Array<{ engagementCode: string }>): string[] =>
    items.map((e) => e.engagementCode).sort();
  // Unique period label per run so tests don't collide on engagement identity
  // in a shared dev DB (CI runs against a fresh database).
  const uniquePeriod = (): string => `P${Date.now()}${Math.floor(Math.random() * 1000)}`;

  // Resolve some ids via the API as the Managing Partner (sees everything).
  let mp: string;
  const findEntityId = async (search: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/entities?search=${search}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findServiceId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/services?search=${code}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findEmployeeId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/employees?limit=100`)
      .set(bearer(mp));
    return (res.body.items as Array<{ employeeCode: string; id: string }>).find(
      (e) => e.employeeCode === code,
    )!.id;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('assignment-based reads (independent of office)', () => {
    it('gives the Managing Partner every engagement', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/engagements')
        .set(bearer(mp))
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('shows the EP their own engagement', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/engagements')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
      expect(codes(res.body.items)).toContain('ENG00001');
    });

    it('gives a cross-office team member the engagement + client + roster', async () => {
      // Senior Y (South office) is on the North Acme engagement's team.
      const sy = await token('senior.y@hsdg.in');
      const list = await request(app.getHttpServer())
        .get('/api/v1/engagements')
        .set(bearer(sy))
        .expect(200);
      expect(codes(list.body.items)).toContain('ENG00001');

      const eng = list.body.items.find(
        (e: { engagementCode: string }) => e.engagementCode === 'ENG00001',
      );
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng.id}`)
        .set(bearer(sy))
        .expect(200);
      // The North EP's name is visible to the South team member (shared engagement).
      expect(detail.body.engagementPartnerName).toBe('Partner A');
      expect(detail.body.entityName).toBe('Acme Manufacturing Pvt Ltd');
      expect(detail.body.team.length).toBeGreaterThanOrEqual(2);
    });

    it('does NOT show an unassigned partner another partner’s engagement (404 by id)', async () => {
      const list = await request(app.getHttpServer()).get('/api/v1/engagements').set(bearer(mp));
      const acme = list.body.items.find(
        (e: { engagementCode: string }) => e.engagementCode === 'ENG00001',
      );
      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${acme.id}`)
        .set(bearer(await token('partner.b@hsdg.in')))
        .expect(404);
    });

    it('supports ?mine=true', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/engagements?mine=true')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
      expect(codes(res.body.items)).toContain('ENG00001');
    });

    it('forbids the platform admin (no engagement.read) from listing engagements (403)', async () => {
      // Checkpoint role separation: technical admin has no engagement access.
      await request(app.getHttpServer())
        .get('/api/v1/engagements')
        .set(bearer(await token('admin@hsdg.in')))
        .expect(403);
    });
  });

  describe('creation & management (audited)', () => {
    it('lets a Partner create their own engagement (becomes EP), audited', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat'); // North client
      const serviceId = await findServiceId('ITR_FILING');
      const correlationId = `corr-eng-${Date.now()}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .set('x-correlation-id', correlationId)
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201);
      expect(created.body.engagementCode).toMatch(/^ENG\d{5}$/);
      expect(created.body.engagementPartnerName).toBe('Partner A');
      expect(created.body.acceptedAt).toBeTruthy();

      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(mp));
      const event = (
        audit.body.items as Array<{ action: string; objectId: string; correlationId: string }>
      ).find((e) => e.action === 'engagement.created' && e.correlationId === correlationId);
      expect(event?.objectId).toBe(created.body.id);
    });

    it('enforces engagement identity uniqueness (409)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('GST_MONTHLY');
      const body = { entityId, serviceId, financialYear: '2023-24', periodLabel: uniquePeriod() };
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send(body)
        .expect(409);
    });

    it('forbids a Senior (no engagement.manage) from creating (403)', async () => {
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ITR_FILING');
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(await token('senior.y@hsdg.in')))
        .send({ entityId, serviceId, financialYear: '2022-23' })
        .expect(403);
    });

    it('assigns and removes a team member (audited)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('BOOKKEEPING');
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201);
      const articleN = await findEmployeeId('EMP007');

      const assigned = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/team`)
        .set(bearer(pa))
        .send({ employeeId: articleN, roleOnEngagement: 'member' })
        .expect(201);
      expect(
        assigned.body.team.some((t: { employeeId: string }) => t.employeeId === articleN),
      ).toBe(true);

      const removed = await request(app.getHttpServer())
        .delete(`/api/v1/engagements/${created.body.id}/team/${articleN}`)
        .set(bearer(pa))
        .expect(200);
      expect(removed.body.team.some((t: { employeeId: string }) => t.employeeId === articleN)).toBe(
        false,
      );
    });

    it('reassigns the EP only with firm-wide authority (governance)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('TAX_ADVISORY');
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201);
      const partnerB = await findEmployeeId('EMP004');

      // The EP (a partner) cannot hand off accountability themselves.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/reassign-partner`)
        .set(bearer(pa))
        .send({ engagementPartnerEmployeeId: partnerB })
        .expect(403);

      // The Managing Partner can.
      const ok = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/reassign-partner`)
        .set(bearer(mp))
        .send({ engagementPartnerEmployeeId: partnerB, reason: 'handoff' })
        .expect(201);
      expect(ok.body.engagementPartnerName).toBe('Partner B');
    });

    it('enforces optimistic concurrency on update (stale version ⇒ 409)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ROC_ANNUAL');
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201);
      const v0 = created.body.version as number;
      await request(app.getHttpServer())
        .patch(`/api/v1/engagements/${created.body.id}`)
        .set(bearer(pa))
        .send({ status: 'active', version: v0 })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/engagements/${created.body.id}`)
        .set(bearer(pa))
        .send({ status: 'on_hold', version: v0 })
        .expect(409);
    });
  });

  describe('accountability grade rules (checkpoint)', () => {
    it('rejects a non-partner Engagement Partner (400)', async () => {
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ITR_FILING');
      const seniorEmp = await findEmployeeId('EMP006'); // Senior Y
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(mp)) // firm-wide, so RLS is not the gate — the grade trigger is
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          engagementPartnerEmployeeId: seniorEmp,
        })
        .expect(400);
    });

    it('rejects a non-manager Engagement Manager (400)', async () => {
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ITR_FILING');
      const articleEmp = await findEmployeeId('EMP007'); // Article North
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(mp))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          engagementManagerEmployeeId: articleEmp,
        })
        .expect(400);
    });

    it('a Manager creating becomes the engagement Manager (not the EP)', async () => {
      const entityId = await findEntityId('Bharat'); // North client
      const serviceId = await findServiceId('GST_MONTHLY');
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(await token('manager.x@hsdg.in')))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'prospect',
        })
        .expect(201);
      expect(created.body.engagementManagerName).toBe('Manager X');
      expect(created.body.engagementPartnerId).toBeNull();
    });
  });

  describe('concurrency consistency (checkpoint)', () => {
    it('bumps the engagement version when the team changes', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('INT_AUDIT');
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201);
      const article = await findEmployeeId('EMP007');
      const assigned = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/team`)
        .set(bearer(pa))
        .send({ employeeId: article, roleOnEngagement: 'member' })
        .expect(201);
      expect(assigned.body.version).toBeGreaterThan(created.body.version);
    });

    it('reassign honours optimistic concurrency (stale version ⇒ 409)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('TAX_ADVISORY');
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201);
      const v0 = created.body.version as number;
      const partnerB = await findEmployeeId('EMP004');
      const partnerA = await findEmployeeId('EMP003');
      // Correct version succeeds (firm-wide MP performs the governance action).
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/reassign-partner`)
        .set(bearer(mp))
        .send({ engagementPartnerEmployeeId: partnerB, version: v0 })
        .expect(201);
      // Re-using the now-stale version is rejected.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/reassign-partner`)
        .set(bearer(mp))
        .send({ engagementPartnerEmployeeId: partnerA, version: v0 })
        .expect(409);
    });
  });
});

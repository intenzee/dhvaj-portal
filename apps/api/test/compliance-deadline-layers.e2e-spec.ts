import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Deadline layers (spec §16) — one obligation, many deadline events.
 *
 * A compliance obligation carries two anchor clocks (statutory + internal SLA);
 * on top of those, leads can attach deadline LAYERS — a preparation target and
 * review/stage gates — each its own categorised event. The flattened
 * /compliance/events stream fans one obligation out into separate events.
 */
describe('Compliance deadline layers & events (e2e)', () => {
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

  const createEngagement = async (epToken: string, fy: string): Promise<string> => {
    const entityId = await findEntityId('Bharat');
    const serviceId = await findServiceId('ITR_FILING');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: fy,
        periodLabel: `C${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  /** A rule + one fy_end version, and a generated obligation on a fresh engagement. */
  const obligationFor = async (
    epToken: string,
  ): Promise<{ engagementId: string; instanceId: string; code: string }> => {
    const code = `LYR_${unique()}`;
    // A non-statutory parent so auto-generated review layers (§16, on statutory
    // obligations) don't interfere with the MANUAL layer CRUD under test here.
    const rule = await request(app.getHttpServer())
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code, name: code, dueDateCategory: 'HSDG_MILESTONE' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
      .set(bearer(mp))
      .send({
        effectiveFrom: '2020-04-01',
        calculationBasis: 'fy_end',
        offsetMonths: 7,
        workingDayAdjustment: 'none',
      })
      .expect(201);
    const engagementId = await createEngagement(epToken, '2026-27');
    const gen = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engagementId}/compliance`)
      .set(bearer(epToken))
      .send({ complianceRuleCode: code })
      .expect(201);
    return { engagementId, instanceId: gen.body.id as string, code };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('adding, completing and removing layers', () => {
    it('attaches several distinct-category deadline layers, ordered by due date', async () => {
      const pa = await token('partner.a@hsdg.in');
      const { engagementId, instanceId } = await obligationFor(pa);
      const add = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(`/api/v1/engagements/${engagementId}/compliance/${instanceId}/deadlines`)
          .set(bearer(pa))
          .send(body);

      await add({
        layerType: 'hsdg_preparation',
        label: 'Prep',
        dueDateCategory: 'HSDG_RECURRING',
        dueDate: '2027-09-01',
      }).expect(201);
      await add({
        layerType: 'ep_review',
        label: 'EP review',
        dueDateCategory: 'HSDG_MILESTONE',
        dueDate: '2027-10-20',
      }).expect(201);
      const last = await add({
        layerType: 'manager_review',
        label: 'Manager review',
        dueDateCategory: 'HSDG_MILESTONE',
        dueDate: '2027-10-10',
      }).expect(201);

      // Detail returns the layers ordered by due date, each with its own category.
      const layers = last.body.deadlines as Array<{
        layerType: string;
        dueDate: string;
        dueDateCategory: string;
      }>;
      expect(layers.map((l) => l.layerType)).toEqual([
        'hsdg_preparation',
        'manager_review',
        'ep_review',
      ]);
      expect(layers.map((l) => l.dueDateCategory)).toEqual([
        'HSDG_RECURRING',
        'HSDG_MILESTONE',
        'HSDG_MILESTONE',
      ]);
    });

    it('enforces one of each standard layer per obligation, but allows repeated custom layers', async () => {
      const pa = await token('partner.a@hsdg.in');
      const { engagementId, instanceId } = await obligationFor(pa);
      const add = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(`/api/v1/engagements/${engagementId}/compliance/${instanceId}/deadlines`)
          .set(bearer(pa))
          .send(body);

      await add({
        layerType: 'manager_review',
        label: 'MR',
        dueDateCategory: 'HSDG_MILESTONE',
        dueDate: '2027-10-10',
      }).expect(201);
      // A second manager_review is rejected (standard layer is unique).
      await add({
        layerType: 'manager_review',
        label: 'MR2',
        dueDateCategory: 'HSDG_MILESTONE',
        dueDate: '2027-10-11',
      }).expect(409);
      // Two custom layers are fine.
      await add({
        layerType: 'custom',
        label: 'Client sign-off',
        dueDateCategory: 'CLIENT_COMMITTED',
        dueDate: '2027-10-05',
      }).expect(201);
      await add({
        layerType: 'custom',
        label: 'Second custom',
        dueDateCategory: 'TASK_DEADLINE',
        dueDate: '2027-10-06',
      }).expect(201);
    });

    it('completes a layer, waives another, and removes a third', async () => {
      const pa = await token('partner.a@hsdg.in');
      const { engagementId, instanceId } = await obligationFor(pa);
      const base = `/api/v1/engagements/${engagementId}/compliance/${instanceId}/deadlines`;
      const add = (body: Record<string, unknown>) =>
        request(app.getHttpServer()).post(base).set(bearer(pa)).send(body).expect(201);

      const a = await add({
        layerType: 'hsdg_preparation',
        label: 'Prep',
        dueDateCategory: 'HSDG_RECURRING',
        dueDate: '2027-09-01',
      });
      const b = await add({
        layerType: 'manager_review',
        label: 'MR',
        dueDateCategory: 'HSDG_MILESTONE',
        dueDate: '2027-10-10',
      });
      const c = await add({
        layerType: 'ep_review',
        label: 'EP',
        dueDateCategory: 'HSDG_MILESTONE',
        dueDate: '2027-10-20',
      });
      const layerId = (
        r: { body: { deadlines: Array<{ id: string; layerType: string }> } },
        type: string,
      ) => r.body.deadlines.find((l) => l.layerType === type)!.id;

      const prepId = layerId(a, 'hsdg_preparation');
      const mrId = layerId(b, 'manager_review');
      const epId = layerId(c, 'ep_review');

      const completed = await request(app.getHttpServer())
        .post(`${base}/${prepId}/complete`)
        .set(bearer(pa))
        .send({})
        .expect(201);
      expect(completed.body.deadlines.find((l: { id: string }) => l.id === prepId).status).toBe(
        'completed',
      );
      // Cannot complete twice.
      await request(app.getHttpServer())
        .post(`${base}/${prepId}/complete`)
        .set(bearer(pa))
        .send({})
        .expect(400);

      await request(app.getHttpServer())
        .post(`${base}/${mrId}/waive`)
        .set(bearer(pa))
        .send({ reason: 'Not required this cycle' })
        .expect(201);
      const removed = await request(app.getHttpServer())
        .delete(`${base}/${epId}`)
        .set(bearer(pa))
        .expect(200);
      expect((removed.body.deadlines as Array<{ id: string }>).some((l) => l.id === epId)).toBe(
        false,
      );
    });
  });

  describe('flattened calendar events (§16)', () => {
    it('fans one obligation into statutory + internal-SLA + per-layer events', async () => {
      const pa = await token('partner.a@hsdg.in');
      const { engagementId, instanceId } = await obligationFor(pa);
      const base = `/api/v1/engagements/${engagementId}/compliance/${instanceId}/deadlines`;
      await request(app.getHttpServer())
        .post(base)
        .set(bearer(pa))
        .send({
          layerType: 'hsdg_preparation',
          label: 'Prep',
          dueDateCategory: 'HSDG_RECURRING',
          dueDate: '2027-09-01',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(base)
        .set(bearer(pa))
        .send({
          layerType: 'manager_review',
          label: 'MR',
          dueDateCategory: 'HSDG_MILESTONE',
          dueDate: '2027-10-10',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/compliance/events?engagementId=${engagementId}&limit=100`)
        .set(bearer(pa))
        .expect(200);
      const mine = (
        res.body.items as Array<{
          complianceInstanceId: string;
          kind: string;
          label: string;
          dueDateCategory: string;
        }>
      ).filter((e) => e.complianceInstanceId === instanceId);
      const kinds = mine.map((e) => e.kind).sort();
      // statutory + internal_sla + 2 layers = 4 events for this one obligation.
      expect(kinds).toEqual(['internal_sla', 'layer', 'layer', 'statutory']);
      const statutory = mine.find((e) => e.kind === 'statutory')!;
      // The obligation carries its parent rule's frozen category (§2); this
      // suite's fixtures use a non-statutory parent to keep manual layer CRUD
      // free of auto-generated review layers.
      expect(statutory.dueDateCategory).toBe('HSDG_MILESTONE');
    });

    it('scopes the events stream by RLS — an unrelated partner sees none of them', async () => {
      const pa = await token('partner.a@hsdg.in');
      const { instanceId } = await obligationFor(pa);
      const pb = await token('partner.b@hsdg.in');
      const res = await request(app.getHttpServer())
        .get('/api/v1/compliance/events?dueFrom=2027-01-01&dueTo=2027-12-31&limit=100')
        .set(bearer(pb))
        .expect(200);
      expect(
        (res.body.items as Array<{ complianceInstanceId: string }>).some(
          (e) => e.complianceInstanceId === instanceId,
        ),
      ).toBe(false);
    });
  });

  describe('authority & RLS', () => {
    it('forbids a Senior (no engagement.manage) from adding a layer (403)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const { engagementId, instanceId } = await obligationFor(pa);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engagementId}/compliance/${instanceId}/deadlines`)
        .set(bearer(await token('senior.y@hsdg.in')))
        .send({
          layerType: 'manager_review',
          label: 'MR',
          dueDateCategory: 'HSDG_MILESTONE',
          dueDate: '2027-10-10',
        })
        .expect(403);
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { workItemHref, type TodayView, type WorkItemRef } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Staff Workflow · audit file links — a statutory-audit task about one area of
 * the audit file carries that area, and every list that links to the task
 * (Today, My Work) opens the audit file on it.
 */
describe('Audit file links (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let pa: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    pa = (
      await http().post('/api/v1/auth/dev-token').send({ email: 'partner.a@dhvaj.in' }).expect(201)
    ).body.accessToken as string;
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('a task about an area links to that area of the audit file', async () => {
    const me = (
      (await http().get('/api/v1/auth/me').set(bearer(pa)).expect(200)).body as {
        principal: { employeeId: string };
      }
    ).principal;
    const entity = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({ legalName: `Links ${stamp()}`, typeSlug: 'private_limited', officeCode: 'NORTH' })
      .expect(201);
    const stat = (
      await http().get('/api/v1/services?search=STAT_AUDIT&limit=100').set(bearer(pa)).expect(200)
    ).body.items[0].id as string;
    const engId = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId: entity.body.id,
          serviceId: stat,
          financialYear: '2024-25',
          periodLabel: `P${stamp()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    const shellId = (
      await http().get(`/api/v1/engagements/${engId}/statutory-audit`).set(bearer(pa)).expect(200)
    ).body[0].workflowInstanceId as string;
    const areaId = (
      await su.query<{ id: string }>(
        `INSERT INTO hsdg.audit_work_areas
           (workflow_instance_id, engagement_id, work_area_key, title, source, sort_order)
         VALUES ($1, $2, 'receivables', 'Trade receivables', 'e2e', 1) RETURNING id`,
        [shellId, engId],
      )
    ).rows[0]!.id;

    // An area that is not in this engagement's audit file is refused.
    await http()
      .post(`/api/v1/engagements/${engId}/tasks`)
      .set(bearer(pa))
      .send({ title: 'Nowhere', auditAreaId: '7f1c2a9e-3b4d-4c5e-8f6a-0b1c2d3e4f5a' })
      .expect(400);

    const task = (
      await http()
        .post(`/api/v1/engagements/${engId}/tasks`)
        .set(bearer(pa))
        .send({
          title: 'Confirm the receivables',
          assignedToEmployeeId: me.employeeId,
          auditAreaId: areaId,
        })
        .expect(201)
    ).body as { id: string; auditAreaId: string | null; version: number };
    expect(task.auditAreaId).toBe(areaId);

    const expected = `/engagements/${engId}?tab=audit_file&phase=audit_areas&area=${areaId}&task=${task.id}`;
    const today = (
      await http().get(`/api/v1/work/today?engagementId=${engId}`).set(bearer(pa)).expect(200)
    ).body as TodayView;
    const item = today.groups.flatMap((g) => g.items).find((i) => i.key === `task:${task.id}`);
    expect(item?.link.auditAreaId).toBe(areaId);
    expect(workItemHref(item!.link)).toBe(expected);

    const mine = (await http().get('/api/v1/work/tasks?limit=100').set(bearer(pa)).expect(200))
      .body as { items: Array<{ id: string; link: WorkItemRef }> };
    expect(workItemHref(mine.items.find((t) => t.id === task.id)!.link)).toBe(expected);

    // Cleared, the task opens the audit file at the top again.
    const cleared = (
      await http()
        .patch(`/api/v1/engagements/${engId}/tasks/${task.id}`)
        .set(bearer(pa))
        .send({ auditAreaId: null, version: task.version })
        .expect(200)
    ).body as { auditAreaId: string | null };
    expect(cleared.auditAreaId).toBeNull();
    const again = (await http().get('/api/v1/work/tasks?limit=100').set(bearer(pa)).expect(200))
      .body as { items: Array<{ id: string; link: WorkItemRef }> };
    expect(workItemHref(again.items.find((t) => t.id === task.id)!.link)).toBe(
      `/engagements/${engId}?tab=audit_file&task=${task.id}`,
    );
  });
});

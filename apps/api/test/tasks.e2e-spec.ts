import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Phase 9 — Tasks & Client Dependencies, through the HTTP API.
 *
 * Acceptance (§11): client information is requested → the engagement becomes
 * WAITING FOR CLIENT; and INTERNALLY OVERDUE (a task past its due date) is
 * visible separately from CLIENT DELAY (a dependency past its escalation date).
 * Plus: task assignment/status by the assignee, dependency blocking + cycle
 * rejection, the "My Work" views, and role/RLS negatives.
 */
describe('Tasks & Client Dependencies (e2e)', () => {
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
  const findEmployeeId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/employees?limit=100`)
      .set(bearer(mp));
    return (res.body.items as Array<{ employeeCode: string; id: string }>).find(
      (e) => e.employeeCode === code,
    )!.id;
  };

  const createEngagement = async (epToken: string): Promise<string> => {
    const entityId = await findEntityId('Bharat');
    const serviceId = await findServiceId('ITR_FILING');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `T${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };
  const getEngagement = async (t: string, id: string) =>
    (await request(app.getHttpServer()).get(`/api/v1/engagements/${id}`).set(bearer(t)).expect(200))
      .body;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── ACCEPTANCE ────────────────────────────────────────────────────────────
  describe('waiting-for-client vs internally-overdue are distinct', () => {
    it('requesting client info makes the engagement waiting-for-client, separate from task overdue', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);

      let detail = await getEngagement(pa, eng);
      expect(detail.isWaitingForClient).toBe(false);
      expect(detail.internallyOverdueTaskCount).toBe(0);
      expect(detail.clientOverdueCount).toBe(0);

      // An internal task, already past its due date ⇒ INTERNAL delay.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(pa))
        .send({ title: 'Prepare computation', dueDate: '2020-01-01' })
        .expect(201);

      detail = await getEngagement(pa, eng);
      expect(detail.internallyOverdueTaskCount).toBe(1);
      expect(detail.isWaitingForClient).toBe(false); // still not waiting on the client

      // Request info from the client, with an escalation date in the past ⇒ CLIENT delay.
      const dep = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/client-dependencies`)
        .set(bearer(pa))
        .send({ requestedInfo: 'Bank statements FY26-27', escalationDate: '2020-02-01' })
        .expect(201);
      expect(dep.body.status).toBe('pending');
      expect(dep.body.isOpen).toBe(true);
      expect(dep.body.isOverdue).toBe(true);

      // Both delays are now visible AND distinct on the engagement.
      detail = await getEngagement(pa, eng);
      expect(detail.isWaitingForClient).toBe(true);
      expect(detail.clientOverdueCount).toBe(1); // client delay
      expect(detail.internallyOverdueTaskCount).toBe(1); // internal delay (unchanged)

      // Receiving the information fully clears waiting-for-client (but not the task).
      const received = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/client-dependencies/${dep.body.id}/receive`)
        .set(bearer(pa))
        .send({ fully: true, version: dep.body.version })
        .expect(201);
      expect(received.body.status).toBe('received');
      expect(received.body.isOpen).toBe(false);

      detail = await getEngagement(pa, eng);
      expect(detail.isWaitingForClient).toBe(false);
      expect(detail.clientOverdueCount).toBe(0);
      expect(detail.internallyOverdueTaskCount).toBe(1); // internal delay remains
    });
  });

  // ── Tasks: assignment, status by assignee, dependencies ──────────────────
  describe('tasks', () => {
    it('lets a lead assign a task to a team member, who then progresses it (task.update)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const seniorY = await findEmployeeId('EMP006');
      // Add Senior Y to the team so they can be assigned + see the task.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/team`)
        .set(bearer(pa))
        .send({ employeeId: seniorY, roleOnEngagement: 'in_charge' })
        .expect(201);

      const task = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(pa))
        .send({ title: 'Draft financials', assignedToEmployeeId: seniorY, priority: 'high' })
        .expect(201);
      expect(task.body.assignedToName).toBe('Senior Y');

      // The senior (assignee, not a lead) progresses their own task.
      const sy = await token('senior.y@dhvaj.in');
      const inProgress = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks/${task.body.id}/status`)
        .set(bearer(sy))
        .send({ status: 'in_progress', version: task.body.version })
        .expect(201);
      expect(inProgress.body.status).toBe('in_progress');
      const done = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks/${task.body.id}/status`)
        .set(bearer(sy))
        .send({ status: 'done', version: inProgress.body.version })
        .expect(201);
      expect(done.body.status).toBe('done');
      expect(done.body.completedByName).toBe('Senior Y');

      // The senior shows the task under "My Work".
      const myWork = await request(app.getHttpServer())
        .get('/api/v1/work/tasks?status=done')
        .set(bearer(sy))
        .expect(200);
      expect((myWork.body.items as Array<{ id: string }>).some((t) => t.id === task.body.id)).toBe(
        true,
      );
    });

    it('cannot assign a task to someone not on the engagement (400)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const partnerB = await findEmployeeId('EMP004'); // not on this engagement
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(pa))
        .send({ title: 'x', assignedToEmployeeId: partnerB })
        .expect(400);
    });

    it('blocks completing a task while a blocker is unfinished, and rejects dependency cycles', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const a = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(pa))
        .send({ title: 'Task A' })
        .expect(201);
      const b = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(pa))
        .send({ title: 'Task B' })
        .expect(201);
      // A depends on B.
      const linked = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks/${a.body.id}/dependencies`)
        .set(bearer(pa))
        .send({ dependsOnTaskId: b.body.id })
        .expect(201);
      expect(linked.body.blockedByOpenCount).toBe(1);

      // A cannot be completed while B is open.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks/${a.body.id}/status`)
        .set(bearer(pa))
        .send({ status: 'done' })
        .expect(400);

      // B → A would create a cycle ⇒ rejected.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks/${b.body.id}/dependencies`)
        .set(bearer(pa))
        .send({ dependsOnTaskId: a.body.id })
        .expect(400);

      // Finish B, then A can complete.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks/${b.body.id}/status`)
        .set(bearer(pa))
        .send({ status: 'done' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks/${a.body.id}/status`)
        .set(bearer(pa))
        .send({ status: 'done' })
        .expect(201);
    });
  });

  // ── Client dependencies: my view + partial receipt ───────────────────────
  describe('client dependencies', () => {
    it('surfaces open dependencies on the firm-wide view, and partial receipt keeps it open', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const dep = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/client-dependencies`)
        .set(bearer(pa))
        .send({ requestedInfo: 'Invoices + ledgers', escalationDate: '2020-03-01' })
        .expect(201);

      // Partial receipt ⇒ still open (waiting for the rest).
      const partial = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/client-dependencies/${dep.body.id}/receive`)
        .set(bearer(pa))
        .send({
          fully: false,
          outstandingItems: 'Ledgers still pending',
          version: dep.body.version,
        })
        .expect(201);
      expect(partial.body.status).toBe('partially_received');
      expect(partial.body.isOpen).toBe(true);

      // The EP sees it under "My Work → Client Dependencies", overdue-filtered.
      const mine = await request(app.getHttpServer())
        .get('/api/v1/work/client-dependencies?overdueOnly=true&limit=100')
        .set(bearer(pa))
        .expect(200);
      const row = (mine.body.items as Array<{ id: string; entityName: string }>).find(
        (i) => i.id === dep.body.id,
      );
      expect(row).toBeDefined();
      expect(row!.entityName).toBe('Bharat Textiles LLP');

      // An unrelated partner does not see it.
      const pb = await token('partner.b@dhvaj.in');
      const notMine = await request(app.getHttpServer())
        .get('/api/v1/work/client-dependencies?limit=100')
        .set(bearer(pb))
        .expect(200);
      expect((notMine.body.items as Array<{ id: string }>).some((i) => i.id === dep.body.id)).toBe(
        false,
      );
    });
  });

  // ── Authority & RLS ──────────────────────────────────────────────────────
  describe('authority & RLS', () => {
    it('forbids a Senior (no engagement.manage) from creating a task (403)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(await token('senior.y@dhvaj.in')))
        .send({ title: 'unauthorised' })
        .expect(403);
    });

    it('does not let an unassigned partner see another engagement’s tasks or client deps (404)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const pb = await token('partner.b@dhvaj.in');
      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(pb))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng}/client-dependencies`)
        .set(bearer(pb))
        .expect(404);
    });

    it('does not let a non-assignee non-lead update a task (403)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const seniorY = await findEmployeeId('EMP006');
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/team`)
        .set(bearer(pa))
        .send({ employeeId: seniorY })
        .expect(201);
      // Task assigned to nobody (or to the EP), so Senior Y is a member but not the assignee.
      const task = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(pa))
        .send({ title: 'EP-owned task' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/tasks/${task.body.id}/status`)
        .set(bearer(await token('senior.y@dhvaj.in')))
        .send({ status: 'in_progress' })
        .expect(403);
    });
  });
});

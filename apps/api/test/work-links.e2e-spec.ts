import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { WorkItemRef, WorkReviewItem, WorkReviewQueue } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Staff Workflow Phase 1 — every list row carries a `link` to the work itself
 * (WF-102), the review queue lists what is waiting for my review (WF-105), and
 * a lead can see their team's tasks (WF-106 scope=team). RLS is unchanged: a
 * partner off the engagement sees none of it.
 */
describe('Work links, review queue and team tasks (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;
  let sy: string;
  let emp005: string;
  let emp006: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const employeeId = async (code: string): Promise<string> => {
    const r = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE employee_code = $1`,
      [code],
    );
    return r.rows[0]!.id;
  };

  interface TaskRow {
    id: string;
    engagementKind: string;
    section: string | null;
    financialYear: string | null;
    periodKey: string | null;
    registrationNumber: string | null;
    filing: {
      instanceId: string;
      formLabel: string;
      periodLabel: string;
      registrationNumber: string | null;
      internalDate: string | null;
      statutoryDate: string | null;
    } | null;
    link: WorkItemRef;
  }

  /**
   * An engagement (EP partner A, manager X, Senior Y on the team) with one
   * GSTR-3B filing for September 2026 on a GSTIN, its task prepared by Y and
   * reviewed by X (the filing-workspace fixture).
   */
  const setup = async (): Promise<{ eng: string; inst: string; task: string; gstin: string }> => {
    const entityId = await freshClient(
      (await http().get('/api/v1/entities?search=Bharat&limit=100').set(bearer(mp))).body.items[0]
        .id as string,
    );
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    const created = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `WL${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    const eng = created.body.id as string;
    await http()
      .patch(`/api/v1/engagements/${eng}`)
      .set(bearer(mp))
      .send({ engagementManagerEmployeeId: emp005 })
      .expect(200);
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(pa))
      .send({ employeeId: emp006, roleOnEngagement: 'in_charge' })
      .expect(201);

    const code = `GST_GSTR3B_${unique()}`;
    const rule = await http()
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code, name: 'GSTR-3B monthly', dueDateCategory: 'STATUTORY_RULE' })
      .expect(201);
    await http()
      .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
      .set(bearer(mp))
      .send({
        effectiveFrom: '2017-04-01',
        calculationBasis: 'period_end',
        offsetDays: 20,
        workingDayAdjustment: 'none',
      })
      .expect(201);
    const gen = await http()
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: code, referenceDate: '2026-09-30' })
      .expect(201);
    const inst = gen.body.id as string;

    const gstin = `19AAAC${unique().slice(-9)}`.slice(0, 15).padEnd(15, 'Z');
    const reg = await su.query<{ id: string }>(
      `INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code)
       VALUES ($1,'gstin',$2,'19') RETURNING id`,
      [entityId, gstin],
    );
    await su.query(
      `UPDATE hsdg.compliance_rule_versions SET stream = 'gst', section = 'summary', form_label = 'GSTR-3B'
        WHERE compliance_rule_id = $1`,
      [rule.body.id],
    );
    await su.query(
      `UPDATE hsdg.compliance_instances
          SET registration_id = $2, section = 'summary', financial_year = '2026-27', period_key = '2026-09',
              period_start = '2026-09-01', period_end = '2026-09-30', statutory_deadline = '2026-10-20',
              internal_sla_date = '2026-10-17'
        WHERE id = $1`,
      [inst, reg.rows[0]!.id],
    );
    const t = await su.query<{ id: string }>(
      `UPDATE hsdg.tasks SET assigned_to_employee_id = $2, reviewer_employee_id = $3
        WHERE source_compliance_instance_id = $1 RETURNING id`,
      [inst, emp006, emp005],
    );
    return { eng, inst, task: t.rows[0]!.id, gstin };
  };

  const myTasks = async (t: string, qs = ''): Promise<TaskRow[]> =>
    (await http().get(`/api/v1/work/tasks?limit=100${qs}`).set(bearer(t)).expect(200)).body
      .items as TaskRow[];
  const reviews = async (t: string): Promise<WorkReviewItem[]> =>
    ((await http().get('/api/v1/work/reviews').set(bearer(t)).expect(200)).body as WorkReviewQueue)
      .items;
  const act = (t: string, eng: string, task: string, action: string, body: object = {}) =>
    http().post(`/api/v1/engagements/${eng}/tasks/${task}/${action}`).set(bearer(t)).send(body);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    emp005 = await employeeId('EMP005');
    emp006 = await employeeId('EMP006');
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  describe('WF-102 — list rows carry a link', () => {
    it('a GST filing task returns its stream, period, part, GSTIN and filing context', async () => {
      const { eng, inst, task, gstin } = await setup();
      const row = (await myTasks(sy)).find((r) => r.id === task);
      expect(row).toBeDefined();
      expect(row!.link).toEqual({
        engagementId: eng,
        engagementKind: row!.engagementKind,
        instanceId: inst,
        stream: 'gst',
        financialYear: '2026-27',
        periodKey: '2026-09',
        section: 'summary',
        registrationNumber: gstin,
        taskId: task,
      });
      expect(row).toMatchObject({
        section: 'summary',
        financialYear: '2026-27',
        periodKey: '2026-09',
        registrationNumber: gstin,
        filing: {
          instanceId: inst,
          formLabel: 'GSTR-3B',
          periodLabel: 'Sep 2026',
          registrationNumber: gstin,
          internalDate: '2026-10-17',
          statutoryDate: '2026-10-20',
        },
      });
    });

    it('a task with no filing links to its engagement with the task id only', async () => {
      const { eng } = await setup();
      const created = await http()
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(pa))
        .send({ title: `Call the client ${unique()}`, assignedToEmployeeId: emp006 })
        .expect(201);
      const row = (await myTasks(sy)).find((r) => r.id === created.body.id);
      expect(row!.link).toEqual({
        engagementId: eng,
        engagementKind: row!.engagementKind,
        taskId: created.body.id,
      });
      expect(row!.filing).toBeNull();
      expect(row!.section).toBeNull();
    });

    it('a partner off the engagement sees neither task', async () => {
      const { task } = await setup();
      const ids = (await myTasks(pb)).map((r) => r.id);
      expect(ids).not.toContain(task);
      // Not even via the team view: partner B neither manages nor partners it.
      expect((await myTasks(pb, '&scope=team')).map((r) => r.id)).not.toContain(task);
    });

    it('a client request on a filing links to that filing with the request id', async () => {
      const { eng, inst, gstin } = await setup();
      const dep = await http()
        .post(`/api/v1/engagements/${eng}/client-dependencies`)
        .set(bearer(pa))
        .send({ requestedInfo: `Sales register ${unique()}`, responsibleEmployeeId: emp006 })
        .expect(201);
      await su.query(
        `UPDATE hsdg.client_dependencies
            SET compliance_instance_id = $2, period_section = 'outward', slot_code = 'SALES_REGISTER'
          WHERE id = $1`,
        [dep.body.id, inst],
      );
      const items = (
        await http().get('/api/v1/work/client-dependencies?limit=100').set(bearer(sy)).expect(200)
      ).body.items as Array<{
        id: string;
        complianceInstanceId: string | null;
        periodSection: string | null;
        slotCode: string | null;
        link: WorkItemRef;
      }>;
      const row = items.find((r) => r.id === dep.body.id)!;
      expect(row).toMatchObject({
        complianceInstanceId: inst,
        periodSection: 'outward',
        slotCode: 'SALES_REGISTER',
      });
      expect(row.link).toMatchObject({
        engagementId: eng,
        instanceId: inst,
        stream: 'gst',
        financialYear: '2026-27',
        periodKey: '2026-09',
        section: 'outward',
        registrationNumber: gstin,
        requestId: dep.body.id,
      });
      expect(row.link.taskId).toBeUndefined();
    });

    it('both compliance calendars return the filing link', async () => {
      const { eng, inst, gstin } = await setup();
      const legacy = (
        await http()
          .get('/api/v1/compliance?dueFrom=2026-10-01&dueTo=2026-10-31&limit=100')
          .set(bearer(pa))
          .expect(200)
      ).body.items as Array<{ id: string; section: string | null; link: WorkItemRef }>;
      const lrow = legacy.find((r) => r.id === inst)!;
      expect(lrow.section).toBe('summary');
      expect(lrow.link).toMatchObject({
        engagementId: eng,
        instanceId: inst,
        stream: 'gst',
        periodKey: '2026-09',
        section: 'summary',
        registrationNumber: gstin,
      });

      const v2 = (
        await http()
          .get(`/api/v1/compliance/calendar?engagementId=${eng}&from=2026-10-01&to=2026-10-31`)
          .set(bearer(pa))
          .expect(200)
      ).body.items as Array<{ id: string; section: string | null; link: WorkItemRef }>;
      const vrow = v2.find((r) => r.id === inst)!;
      expect(vrow.section).toBe('summary');
      expect(vrow.link).toEqual({
        engagementId: eng,
        engagementKind: 'compliance',
        instanceId: inst,
        stream: 'gst',
        financialYear: '2026-27',
        periodKey: '2026-09',
        section: 'summary',
        registrationNumber: gstin,
      });
    });

    it('a filing document on the Documents page links to its filing part and task (WF-103)', async () => {
      const { eng, inst, task, gstin } = await setup();
      const created = await http()
        .post(`/api/v1/engagements/${eng}/documents`)
        .set(bearer(pa))
        .send({
          title: `Sales register ${unique()}`,
          documentType: 'working_paper',
          classification: 'internal',
          taskId: task,
          filename: 'sales.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('%PDF-1.4 sales').toString('base64'),
        })
        .expect(201);
      // As a slot upload would file it: the filing and its Outward part.
      await su.query(
        `UPDATE hsdg.documents SET compliance_instance_id = $2, period_section = 'outward' WHERE id = $1`,
        [created.body.id, inst],
      );
      const plain = await http()
        .post(`/api/v1/engagements/${eng}/documents`)
        .set(bearer(pa))
        .send({
          title: `Engagement letter ${unique()}`,
          documentType: 'engagement_letter',
          classification: 'client_shared',
          filename: 'letter.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('%PDF-1.4 letter').toString('base64'),
        })
        .expect(201);

      const docs = (await http().get('/api/v1/documents?limit=100').set(bearer(mx)).expect(200)).body
        .items as Array<{ id: string; engagementId: string; link: WorkItemRef }>;
      const filed = docs.find((d) => d.id === created.body.id);
      expect(filed?.link).toEqual({
        engagementId: eng,
        engagementKind: filed!.link.engagementKind,
        instanceId: inst,
        stream: 'gst',
        financialYear: '2026-27',
        periodKey: '2026-09',
        section: 'outward',
        registrationNumber: gstin,
        taskId: task,
      });
      // A plain engagement document still opens its engagement.
      const letter = docs.find((d) => d.id === plain.body.id);
      expect(letter?.link).toEqual({ engagementId: eng, engagementKind: letter!.link.engagementKind });
      // Off the engagement, RLS hides both.
      const other = (await http().get('/api/v1/documents?limit=100').set(bearer(pb)).expect(200)).body
        .items as Array<{ id: string }>;
      expect(other.map((d) => d.id)).not.toContain(created.body.id);
    });
  });

  describe('WF-105 — the review queue', () => {
    it('a filing sent for review reaches its reviewer only, and leaves on approval', async () => {
      const { eng, inst, task } = await setup();
      const before = (await reviews(mx)).map((i) => i.id);
      expect(before).not.toContain(task);

      await act(sy, eng, task, 'start').expect(201);
      await act(sy, eng, task, 'send-for-review').expect(201);

      const queue = await reviews(mx);
      const item = queue.find((i) => i.id === task);
      expect(item).toMatchObject({
        type: 'filing_review',
        taskId: task,
        engagementId: eng,
        title: 'GSTR-3B · Sep 2026',
        preparerId: emp006,
        internalDate: '2026-10-17',
        statutoryDate: '2026-10-20',
        daysWaiting: 0,
        reviewStarted: false,
        link: { instanceId: inst, stream: 'gst', section: 'summary', taskId: task },
      });
      // Oldest first.
      const since = queue.map((i) => i.waitingSince);
      expect([...since].sort()).toEqual(since);
      const count = await http().get('/api/v1/work/reviews/count').set(bearer(mx)).expect(200);
      expect(count.body.total).toBe(queue.length);

      // Not the preparer's, not the EP's (not the reviewer), not another partner's.
      expect((await reviews(sy)).map((i) => i.id)).not.toContain(task);
      expect((await reviews(pa)).map((i) => i.id)).not.toContain(task);
      expect((await reviews(pb)).map((i) => i.id)).not.toContain(task);

      await act(mx, eng, task, 'start-review').expect(201);
      expect((await reviews(mx)).find((i) => i.id === task)).toMatchObject({
        reviewStarted: true,
      });
      await act(mx, eng, task, 'approve').expect(201);
      expect((await reviews(mx)).map((i) => i.id)).not.toContain(task);
    });

    it('lists open review points for the manager and an EP sign-off once cleared', async () => {
      const { eng } = await setup();
      const detail = await http().get(`/api/v1/engagements/${eng}`).set(bearer(pa)).expect(200);
      await http()
        .post(`/api/v1/engagements/${eng}/start`)
        .set(bearer(pa))
        .send({ version: detail.body.version })
        .expect(201);
      const started = await http().get(`/api/v1/engagements/${eng}`).set(bearer(pa)).expect(200);
      await http()
        .post(`/api/v1/engagements/${eng}/review-plan`)
        .set(bearer(pa))
        .send({ reviewModelSlug: 'full_ep_review', version: started.body.version })
        .expect(201);

      await http()
        .post(`/api/v1/engagements/${eng}/reviews`)
        .set(bearer(pa))
        .send({
          reviewType: 'ep_review',
          outcome: 'returned',
          reviewPoints: [{ matter: `Tie GSTR-3B to books ${unique()}`, isKeyMatter: true }],
        })
        .expect(201);
      const point = (await reviews(mx)).find(
        (i) => i.type === 'review_point' && i.engagementId === eng,
      );
      expect(point).toMatchObject({
        type: 'review_point',
        isKeyMatter: true,
        raisedById: expect.any(String),
      });
      expect(point!.link).toEqual({ engagementId: eng, engagementKind: point!.engagementKind });
      // The partner raised it; it waits on the manager, not on another partner.
      expect((await reviews(pb)).some((i) => i.engagementId === eng)).toBe(false);
      // No sign-off while a point is open.
      expect((await reviews(pa)).some((i) => i.type === 'sign_off' && i.engagementId === eng)).toBe(
        false,
      );

      await http()
        .post(`/api/v1/engagements/${eng}/review-points/${point!.id}/resolve`)
        .set(bearer(mx))
        .send({ resolution: 'Tied out' })
        .expect(201);
      expect((await reviews(mx)).some((i) => i.id === point!.id)).toBe(false);

      await http()
        .post(`/api/v1/engagements/${eng}/reviews`)
        .set(bearer(mx))
        .send({ reviewType: 'manager_review', outcome: 'cleared' })
        .expect(201);
      const signOff = (await reviews(pa)).find(
        (i) => i.type === 'sign_off' && i.engagementId === eng,
      );
      expect(signOff).toMatchObject({
        type: 'sign_off',
        id: eng,
        reviewModelName: expect.any(String),
      });
      expect((await reviews(mx)).some((i) => i.type === 'sign_off' && i.engagementId === eng)).toBe(
        false,
      );

      await http().post(`/api/v1/engagements/${eng}/sign-off`).set(bearer(pa)).send({}).expect(201);
      expect((await reviews(pa)).some((i) => i.engagementId === eng)).toBe(false);
    });
  });

  describe('WF-106 — scope=team', () => {
    it('a senior is refused the team view', async () => {
      await http().get('/api/v1/work/tasks?scope=team').set(bearer(sy)).expect(403);
    });

    it("a manager sees every task on engagements they manage, and no one else's", async () => {
      const mine = await setup();
      const other = await setup();
      // The second engagement is not X's to manage.
      await su.query(`UPDATE hsdg.engagements SET engagement_manager_id = NULL WHERE id = $1`, [
        other.eng,
      ]);
      const team = (await myTasks(mx, '&scope=team')).map((r) => r.id);
      expect(team).toContain(mine.task); // assigned to Senior Y, not to X
      expect(team).not.toContain(other.task);
      // Without scope, X sees only tasks assigned to X.
      expect((await myTasks(mx)).map((r) => r.id)).not.toContain(mine.task);
      // The partner sees both through the team view.
      const paTeam = (await myTasks(pa, '&scope=team')).map((r) => r.id);
      expect(paTeam).toEqual(expect.arrayContaining([mine.task, other.task]));
    });
  });
});

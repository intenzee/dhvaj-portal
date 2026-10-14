import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { TodayGroup, TodayItem, TodayView } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Staff Workflow WF-201 — GET /work/today: my day in four groups (to prepare,
 * to review, waiting on client, due this week), each overdue first then by
 * internal date, with a `link` on every row. RLS-scoped: a partner off the
 * engagement sees none of it.
 */
describe('Today (e2e)', () => {
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
  const employeeId = async (code: string): Promise<string> =>
    (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = $1`, [
        code,
      ])
    ).rows[0]!.id;

  const today = async (t: string, qs = ''): Promise<TodayView> =>
    (await http().get(`/api/v1/work/today${qs}`).set(bearer(t)).expect(200)).body as TodayView;
  const group = (v: TodayView, g: TodayGroup): TodayItem[] =>
    v.groups.find((x) => x.group === g)!.items;
  const keys = (v: TodayView, g: TodayGroup): string[] => group(v, g).map((i) => i.key);
  const act = (t: string, eng: string, task: string, action: string, body: object) =>
    http().post(`/api/v1/engagements/${eng}/tasks/${task}/${action}`).set(bearer(t)).send(body);
  const versionOf = async (task: string): Promise<number> =>
    (await su.query<{ version: number }>(`SELECT version FROM hsdg.tasks WHERE id = $1`, [task]))
      .rows[0]!.version;

  /** IST today + n days, in SQL (the endpoint's own clock). */
  const inDays = (n: number): string => `(timezone('Asia/Kolkata', now())::date + ${n})`;

  /**
   * An engagement (EP partner A, manager X, Senior Y on the team) with a
   * GSTR-3B filing for September 2026 due internally in `dueIn` days, its task
   * prepared by Y and reviewed by X.
   */
  const setup = async (
    dueIn = 3,
  ): Promise<{ eng: string; inst: string; task: string; ruleCode: string }> => {
    const entityId = await freshClient(
      (await http().get('/api/v1/entities?search=Bharat&limit=100').set(bearer(mp))).body.items[0]
        .id as string,
    );
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `TD${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
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

    const ruleCode = `GST_GSTR3B_${unique()}`;
    const rule = await http()
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code: ruleCode, name: 'GSTR-3B monthly', dueDateCategory: 'STATUTORY_RULE' })
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
    await su.query(
      `UPDATE hsdg.compliance_rule_versions SET stream = 'gst', section = 'summary', form_label = 'GSTR-3B'
        WHERE compliance_rule_id = $1`,
      [rule.body.id],
    );
    const inst = await addFiling(eng, ruleCode, '2026-09', dueIn);
    const t = await su.query<{ id: string }>(
      `UPDATE hsdg.tasks SET assigned_to_employee_id = $2, reviewer_employee_id = $3
        WHERE source_compliance_instance_id = $1 RETURNING id`,
      [inst, emp006, emp005],
    );
    return { eng, inst, task: t.rows[0]!.id, ruleCode };
  };

  /** Another month of the same filing, due internally in `dueIn` days. */
  const addFiling = async (
    eng: string,
    ruleCode: string,
    month: string,
    dueIn: number,
  ): Promise<string> => {
    const gen = await http()
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: ruleCode, referenceDate: `${month}-28` })
      .expect(201);
    const inst = gen.body.id as string;
    await su.query(
      `UPDATE hsdg.compliance_instances
          SET section = 'summary', financial_year = '2026-27', period_key = $2,
              statutory_deadline = ${inDays(dueIn + 3)}, internal_sla_date = ${inDays(dueIn)}
        WHERE id = $1`,
      [inst, month],
    );
    return inst;
  };

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

  it('To prepare lists my filing task with its link, filing and task; the count matches My Work', async () => {
    const { eng, inst, task } = await setup();
    const view = await today(sy);
    expect(view.groups.map((g) => g.group)).toEqual(['prepare', 'review', 'waiting', 'due_soon']);
    const row = group(view, 'prepare').find((i) => i.key === `task:${task}`);
    expect(row).toMatchObject({
      kind: 'task',
      engagementId: eng,
      title: expect.any(String),
      status: 'todo',
      isOverdue: false,
      filing: { instanceId: inst, formLabel: 'GSTR-3B', periodLabel: 'Sep 2026' },
      task: { id: task, status: 'todo', assignedToId: emp006, reviewerId: emp005 },
      link: {
        engagementId: eng,
        instanceId: inst,
        stream: 'gst',
        periodKey: '2026-09',
        taskId: task,
      },
    });
    // Not repeated under Due this week.
    expect(keys(view, 'due_soon')).not.toContain(`filing:${inst}`);

    const myWork = async (status: string): Promise<number> =>
      (await http().get(`/api/v1/work/tasks?limit=1&status=${status}`).set(bearer(sy)).expect(200))
        .body.total as number;
    const prepare = view.groups.find((g) => g.group === 'prepare')!.total;
    expect(prepare).toBe(
      (await myWork('todo')) + (await myWork('in_progress')) + (await myWork('paused')),
    );
  });

  it('overdue first, then by internal date', async () => {
    const { eng, ruleCode, task } = await setup(5);
    const late = await addFiling(eng, ruleCode, '2026-08', -2);
    await su.query(
      `UPDATE hsdg.tasks SET assigned_to_employee_id = $2 WHERE source_compliance_instance_id = $1`,
      [late, emp006],
    );
    const mine = group(await today(sy, `?engagementId=${eng}`), 'prepare');
    expect(mine.map((i) => i.link.instanceId)).toEqual([late, expect.any(String)]);
    expect(mine[0]!.isOverdue).toBe(true);
    expect(mine[1]!.key).toBe(`task:${task}`);
  });

  it('Waiting on client: my blocked task once (not its raised request), and a request I am responsible for', async () => {
    const { eng, inst, task } = await setup();
    await act(sy, eng, task, 'block', {
      version: await versionOf(task),
      reason: 'Purchase register',
    }).expect(201);
    const dep = await http()
      .post(`/api/v1/engagements/${eng}/client-dependencies`)
      .set(bearer(pa))
      .send({ requestedInfo: `Bank statement ${unique()}`, responsibleEmployeeId: emp006 })
      .expect(201);

    const view = await today(sy, `?engagementId=${eng}`);
    expect(keys(view, 'prepare')).toEqual([]);
    expect(keys(view, 'waiting').sort()).toEqual(
      [`task:${task}`, `client_request:${dep.body.id}`].sort(),
    );
    const req = group(view, 'waiting').find((i) => i.kind === 'client_request')!;
    expect(req.link).toEqual({
      engagementId: eng,
      engagementKind: req.engagementKind,
      requestId: dep.body.id,
    });
    expect(keys(view, 'due_soon')).not.toContain(`filing:${inst}`);
  });

  it('To review: the reviewer sees the filing with its task, and can start the review from the row', async () => {
    const { eng, inst, task } = await setup();
    await act(sy, eng, task, 'send-for-review', { version: await versionOf(task) }).expect(201);

    const xs = await today(mx, `?engagementId=${eng}`);
    const row = group(xs, 'review').find((i) => i.key === `task:${task}`)!;
    expect(row).toMatchObject({
      kind: 'task',
      status: 'in_review',
      task: { id: task, assignedToId: emp006, reviewerId: emp005, reviewStartedAt: null },
      link: { instanceId: inst, taskId: task },
    });
    await act(mx, eng, task, 'start-review', { version: row.task!.version }).expect(201);
    const started = group(await today(mx, `?engagementId=${eng}`), 'review')[0]!;
    expect(started.task!.reviewStartedAt).toEqual(expect.any(String));

    // The preparer no longer has it to prepare, but the filing is still due this week.
    const ys = await today(sy, `?engagementId=${eng}`);
    expect(keys(ys, 'prepare')).toEqual([]);
    expect(group(ys, 'due_soon').map((i) => i.key)).toEqual([`filing:${inst}`]);
    expect(group(ys, 'due_soon')[0]).toMatchObject({ status: 'in_review', task: { id: task } });
  });

  it('Due this week includes a filing with no task on a stream I lead, and not one due later', async () => {
    const { eng, ruleCode } = await setup();
    const es = await su.query<{ id: string }>(
      `UPDATE hsdg.engagement_services SET lead_employee_id = $2
        WHERE engagement_id = $1 AND is_primary RETURNING id`,
      [eng, emp006],
    );
    const soon = await addFiling(eng, ruleCode, '2026-07', 4);
    const later = await addFiling(eng, ruleCode, '2026-06', 30);
    await su.query(
      `UPDATE hsdg.compliance_instances SET engagement_service_id = $2 WHERE id = ANY($1::uuid[])`,
      [[soon, later], es.rows[0]!.id],
    );
    await su.query(`DELETE FROM hsdg.tasks WHERE source_compliance_instance_id = ANY($1::uuid[])`, [
      [soon, later],
    ]);
    const due = group(await today(sy, `?engagementId=${eng}`), 'due_soon');
    const row = due.find((i) => i.key === `filing:${soon}`);
    expect(row).toMatchObject({
      kind: 'filing',
      task: null,
      title: 'GSTR-3B · Jul 2026',
      link: { engagementId: eng, instanceId: soon, periodKey: '2026-07' },
    });
    expect(row!.link.taskId).toBeUndefined();
    expect(due.map((i) => i.key)).not.toContain(`filing:${later}`);
  });

  it('RLS: a partner off the engagement sees none of it, even naming the engagement', async () => {
    const { eng, task, inst } = await setup();
    const all = await today(pb);
    const everything = all.groups.flatMap((g) => g.items);
    expect(everything.map((i) => i.key)).not.toContain(`task:${task}`);
    expect(everything.map((i) => i.link.instanceId)).not.toContain(inst);
    const named = await today(pb, `?engagementId=${eng}`);
    expect(named.groups.every((g) => g.total === 0)).toBe(true);
  });

  it('rejects a malformed engagementId', async () => {
    await http().get('/api/v1/work/today?engagementId=nope').set(bearer(sy)).expect(400);
  });

  it('answers in under 300 ms with 500 open items', async () => {
    const { eng } = await setup();
    await su.query(
      `INSERT INTO hsdg.tasks (engagement_id, title, assigned_to_employee_id, status, due_date,
                               created_by_employee_id)
       SELECT $1, 'Bulk ' || g, $2, 'todo', CURRENT_DATE + (g % 20), $2
         FROM generate_series(1, 500) g`,
      [eng, emp006],
    );
    await today(sy); // warm
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const v = await today(sy);
      times.push(performance.now() - t0);
      expect(v.groups[0]!.total).toBeGreaterThanOrEqual(500);
    }
    times.sort((a, b) => a - b);
    expect(times[1]).toBeLessThan(300);
  });
});

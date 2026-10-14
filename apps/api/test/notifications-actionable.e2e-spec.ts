import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { workItemHref, type NotificationDigest, type NotificationItem } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/**
 * Staff Workflow WF-305 — fewer, actionable notifications. The bell carries
 * what needs doing; each notification stores the exact place it opens; the
 * informational ones wait in the daily digest unless moved to the bell; and a
 * notification is read once the action it asked for is done — by whoever does
 * it. Behind ff_filing_runs (North only here): the South office keeps the old bell.
 */
describe('Actionable notifications (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;
  let sy: string;
  let emp005: string;
  let emp006: string;
  let emp004: string;

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
  const act = (t: string, eng: string, task: string, action: string, body: object) =>
    http().post(`/api/v1/engagements/${eng}/tasks/${task}/${action}`).set(bearer(t)).send(body);
  const versionOf = async (task: string): Promise<number> =>
    (await su.query<{ version: number }>(`SELECT version FROM hsdg.tasks WHERE id = $1`, [task]))
      .rows[0]!.version;
  const inbox = async (t: string, qs = ''): Promise<NotificationItem[]> =>
    (await http().get(`/api/v1/notifications?limit=100${qs}`).set(bearer(t)).expect(200)).body
      .items as NotificationItem[];
  const unread = async (t: string): Promise<number> =>
    (await http().get('/api/v1/notifications/unread-count').set(bearer(t)).expect(200)).body
      .unread as number;
  const about = (items: NotificationItem[], objectId: string, type: string) =>
    items.find((n) => n.objectId === objectId && n.type === type);
  /** Emit as the domain would, straight through the definer function. */
  const emit = (
    employee: string,
    type: string,
    title: string,
    eng: string,
    objType: string,
    objId: string,
  ) =>
    su.query(`SELECT hsdg.emit_notification($1,$2,$3,NULL,$4,$5,$6,NULL,NULL)`, [
      employee,
      type,
      title,
      eng,
      objType,
      objId,
    ]);

  /** Partner A's engagement, manager X, Senior Y on the team; a September GSTR-1 task Y prepares, X reviews. */
  const setup = async (): Promise<{ eng: string; inst: string; task: string }> => {
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
          periodLabel: `NT${unique()}`,
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
    const inst = (
      await http()
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: ruleCode, referenceDate: '2026-09-30' })
        .expect(201)
    ).body.id as string;
    await su.query(
      `UPDATE hsdg.compliance_instances
          SET section = 'outward', financial_year = '2026-27', period_key = '2026-09'
        WHERE id = $1`,
      [inst],
    );
    const t = await su.query<{ id: string }>(
      `UPDATE hsdg.tasks SET assigned_to_employee_id = $2, reviewer_employee_id = $3
        WHERE source_compliance_instance_id = $1 RETURNING id`,
      [inst, emp006, emp005],
    );
    return { eng, inst, task: t.rows[0]!.id };
  };

  let ruleCode: string;

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    process.env.FEATURE_FLAG_OFFICES = 'ff_filing_runs:NORTH';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    emp004 = await employeeId('EMP004');
    emp005 = await employeeId('EMP005');
    emp006 = await employeeId('EMP006');

    ruleCode = `GST_GSTR1_${unique()}`;
    const ruleId = (
      await http()
        .post('/api/v1/compliance-rules')
        .set(bearer(mp))
        .send({ code: ruleCode, name: 'GSTR-1', dueDateCategory: 'STATUTORY_RULE' })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/v1/compliance-rules/${ruleId}/versions`)
      .set(bearer(mp))
      .send({
        effectiveFrom: '2017-04-01',
        calculationBasis: 'period_end',
        offsetDays: 11,
        workingDayAdjustment: 'none',
      })
      .expect(201);
    await su.query(
      `UPDATE hsdg.compliance_rule_versions SET stream = 'gst', section = 'outward', form_label = 'GSTR-1'
        WHERE compliance_rule_id = $1`,
      [ruleId],
    );
  });

  afterAll(async () => {
    delete process.env.FEATURE_FLAG_OFFICES;
    await su?.end();
    await app?.close();
  });

  it('completing a review clears its notification', async () => {
    const { eng, inst, task } = await setup();
    const before = await unread(mx);
    await act(sy, eng, task, 'send-for-review', { version: await versionOf(task) }).expect(201);

    const asked = about(await inbox(mx), task, 'task_review_requested')!;
    expect(asked).toMatchObject({ kind: 'actionable', status: 'unread', resolvedAt: null });
    // It opens the filing's section with the task highlighted.
    expect(asked.link).toMatchObject({
      engagementId: eng,
      instanceId: inst,
      stream: 'gst',
      periodKey: '2026-09',
      section: 'outward',
      taskId: task,
    });
    expect(workItemHref(asked.link!)).toContain('part=outward');
    expect(workItemHref(asked.link!)).toContain(`task=${task}`);
    expect(await unread(mx)).toBe(before + 1);

    await act(mx, eng, task, 'start-review', { version: await versionOf(task) }).expect(201);
    await act(mx, eng, task, 'approve', { version: await versionOf(task) }).expect(201);

    const done = about(await inbox(mx, '&scope=all'), task, 'task_review_requested')!;
    expect(done.status).toBe('read');
    expect(done.resolvedAt).toEqual(expect.any(String));
    expect(await unread(mx)).toBe(before);
  });

  it('a return clears the request; sending it back for review clears the return', async () => {
    const { eng, task } = await setup();
    await act(sy, eng, task, 'send-for-review', { version: await versionOf(task) }).expect(201);
    await act(mx, eng, task, 'return', {
      version: await versionOf(task),
      reason: 'Reconcile the B2B invoices',
    }).expect(201);
    expect(about(await inbox(mx, '&scope=all'), task, 'task_review_requested')!.status).toBe(
      'read',
    );
    expect(about(await inbox(sy), task, 'task_returned')!.status).toBe('unread');

    await act(sy, eng, task, 'send-for-review', { version: await versionOf(task) }).expect(201);
    const returned = about(await inbox(sy, '&scope=all'), task, 'task_returned')!;
    expect(returned).toMatchObject({ status: 'read', resolvedAt: expect.any(String) });
    // The second request is new, and unread.
    const requests = (await inbox(mx)).filter(
      (n) => n.objectId === task && n.type === 'task_review_requested' && n.status === 'unread',
    );
    expect(requests).toHaveLength(1);
  });

  it('a client request received clears its chase, whoever records it', async () => {
    const { eng } = await setup();
    const dep = (
      await http()
        .post(`/api/v1/engagements/${eng}/client-dependencies`)
        .set(bearer(pa))
        .send({ requestedInfo: `Sales register ${unique()}`, responsibleEmployeeId: emp006 })
        .expect(201)
    ).body.id as string;
    await emit(
      emp006,
      'client_dependency_overdue',
      'Sales register overdue',
      eng,
      'client_dependency',
      dep,
    );
    expect(about(await inbox(sy), dep, 'client_dependency_overdue')!.status).toBe('unread');

    await http()
      .post(`/api/v1/engagements/${eng}/client-dependencies/${dep}/receive`)
      .set(bearer(pa))
      .send({ fully: true })
      .expect(201);
    expect(about(await inbox(sy, '&scope=all'), dep, 'client_dependency_overdue')!.status).toBe(
      'read',
    );
  });

  it('informational notices go to the digest, not the bell, until moved there', async () => {
    const { eng, inst } = await setup();
    const before = await unread(mx);
    await emit(
      emp005,
      'filing_lodged',
      `GSTR-1 lodged ${unique()}`,
      eng,
      'compliance_instance',
      inst,
    );

    // Not in the bell or its count…
    expect(about(await inbox(mx), inst, 'filing_lodged')).toBeUndefined();
    expect(await unread(mx)).toBe(before);
    // …but listed with everything, and in today's digest under its heading.
    expect(about(await inbox(mx, '&scope=all'), inst, 'filing_lodged')!.kind).toBe('informational');
    const digest = (await http().get('/api/v1/notifications/digest').set(bearer(mx)).expect(200))
      .body as NotificationDigest;
    const lodged = digest.groups.find((g) => g.type === 'filing_lodged')!;
    expect(lodged.label).toBe('Filing lodged');
    expect(lodged.items.map((n) => n.objectId)).toContain(inst);

    // Moved to the bell, it counts; turned off, it is nowhere.
    await http()
      .put('/api/v1/notifications/preferences')
      .set(bearer(mx))
      .send({ items: [{ type: 'filing_lodged', delivery: 'bell' }] })
      .expect(200);
    expect(about(await inbox(mx), inst, 'filing_lodged')).toBeDefined();
    expect(await unread(mx)).toBe(before + 1);
    await http()
      .put('/api/v1/notifications/preferences')
      .set(bearer(mx))
      .send({ items: [{ type: 'filing_lodged', delivery: 'off' }] })
      .expect(200);
    expect(about(await inbox(mx), inst, 'filing_lodged')).toBeUndefined();
    const off = (await http().get('/api/v1/notifications/digest').set(bearer(mx)).expect(200))
      .body as NotificationDigest;
    expect(off.groups.find((g) => g.type === 'filing_lodged')).toBeUndefined();
    await http()
      .put('/api/v1/notifications/preferences')
      .set(bearer(mx))
      .send({ items: [{ type: 'filing_lodged', delivery: 'digest' }] })
      .expect(200);
  });

  it('settings are per user, and an actionable type cannot leave the bell', async () => {
    await http()
      .put('/api/v1/notifications/preferences')
      .set(bearer(pa))
      .send({ items: [{ type: 'task_review_requested', delivery: 'digest' }] })
      .expect(400);
    await http()
      .put('/api/v1/notifications/preferences')
      .set(bearer(pa))
      .send({ items: [{ type: 'ep_changed', delivery: 'bell' }] })
      .expect(200);
    const mine = (await http().get('/api/v1/notifications/preferences').set(bearer(pa)).expect(200))
      .body as { type: string; delivery: string; editable: boolean }[];
    expect(mine).toHaveLength(33);
    expect(mine.find((p) => p.type === 'ep_changed')).toMatchObject({
      delivery: 'bell',
      editable: true,
    });
    expect(mine.find((p) => p.type === 'task_returned')).toMatchObject({
      delivery: 'bell',
      editable: false,
    });
    // Partner A's choice is theirs alone (RLS on the preferences).
    const xs = (await http().get('/api/v1/notifications/preferences').set(bearer(mx)).expect(200))
      .body as { type: string; delivery: string }[];
    expect(xs.find((p) => p.type === 'ep_changed')!.delivery).toBe('digest');
    const rows = await su.query(
      `SELECT 1 FROM hsdg.notification_preferences p JOIN hsdg.employees e ON e.user_id = p.user_id
        WHERE e.id = $1 AND p.type = 'ep_changed'`,
      [emp005],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('an office it is not rolled out to keeps the old bell', async () => {
    const { eng, inst } = await setup();
    await emit(
      emp004,
      'filing_lodged',
      `GSTR-1 lodged ${unique()}`,
      eng,
      'compliance_instance',
      inst,
    );
    // Partner B (South) sees informational notices in the bell, and no digest.
    expect(about(await inbox(pb), inst, 'filing_lodged')).toBeDefined();
    await http().get('/api/v1/notifications/digest').set(bearer(pb)).expect(404);
    await http().get('/api/v1/notifications/preferences').set(bearer(pb)).expect(404);
  });

  it('refuses a malformed digest day', async () => {
    await http().get('/api/v1/notifications/digest?date=14-10-2026').set(bearer(mx)).expect(400);
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { FormInternalDueList, WorkflowSettings } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/**
 * Staff Workflow · Questions for the partners, as firm settings. Partners (not
 * managers or seniors) change the policy, with an optimistic lock and an audit
 * row; a form's internal due date re-dates its open filings at once and new
 * filings follow it; the default reviewer follows the firm's choice; and a
 * stream lead may bulk-assign their stream's filings only while the firm allows
 * it. The firm row is put back as it was for the suites that follow.
 */
describe('Workflow settings (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let mx: string;
  let sy: string;
  let seniorY: string;
  let managerX: string;
  let articleNorth: string;
  let ruleCode: string;
  let ruleId: string;
  let firmBefore: Record<string, unknown>;

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
  const settings = async (t: string): Promise<WorkflowSettings> =>
    (await http().get('/api/v1/workflow-settings').set(bearer(t)).expect(200)).body;
  const patch = (t: string, body: object) =>
    http().patch('/api/v1/workflow-settings').set(bearer(t)).send(body);

  /** Partner A + Manager X on a fresh client, Senior Y on the team; September's filing of the test rule. */
  const filing = async (): Promise<{ eng: string; inst: string; line: string }> => {
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
          periodLabel: `WS${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    await http()
      .patch(`/api/v1/engagements/${eng}`)
      .set(bearer(mp))
      .send({ engagementManagerEmployeeId: managerX })
      .expect(200);
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(pa))
      .send({ employeeId: seniorY, roleOnEngagement: 'in_charge' })
      .expect(201);
    // The rule's stream is the engagement's stream line, so the line's lead is its stream lead.
    const line = (
      await su.query<{ id: string; stream: string }>(
        `SELECT es.id, s.stream FROM hsdg.engagement_services es
           JOIN hsdg.services s ON s.id = es.service_id
          WHERE es.engagement_id = $1 LIMIT 1`,
        [eng],
      )
    ).rows[0]!;
    await su.query(
      `UPDATE hsdg.compliance_rule_versions SET stream = $2 WHERE compliance_rule_id = $1`,
      [ruleId, line.stream],
    );
    const inst = (
      await http()
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: ruleCode, referenceDate: '2026-09-30' })
        .expect(201)
    ).body.id as string;
    return { eng, inst, line: line.id };
  };
  const internalDate = async (inst: string): Promise<string> =>
    (
      await su.query<{ d: string }>(
        `SELECT internal_sla_date::text AS d FROM hsdg.compliance_instances WHERE id = $1`,
        [inst],
      )
    ).rows[0]!.d;

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    seniorY = await employeeId('EMP006');
    managerX = await employeeId('EMP005');
    articleNorth = await employeeId('EMP007');
    firmBefore = (
      await su.query(
        `SELECT default_reviewer, article_client_scope, client_reminder_channel, bulk_assign_scope,
                client_reminder_days, client_escalation_days FROM hsdg.firm_settings`,
      )
    ).rows[0] as Record<string, unknown>;

    ruleCode = `WS_GSTR1_${unique()}`;
    ruleId = (
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
        internalSlaOffsetDays: 2,
      })
      .expect(201);
    await su.query(
      `UPDATE hsdg.compliance_rule_versions SET form_label = 'GSTR-1' WHERE compliance_rule_id = $1`,
      [ruleId],
    );
  });

  afterAll(async () => {
    const f = firmBefore;
    await su?.query(
      `UPDATE hsdg.firm_settings
          SET default_reviewer = $1, article_client_scope = $2, client_reminder_channel = $3,
              bulk_assign_scope = $4, client_reminder_days = $5, client_escalation_days = $6`,
      [
        f.default_reviewer,
        f.article_client_scope,
        f.client_reminder_channel,
        f.bulk_assign_scope,
        f.client_reminder_days,
        f.client_escalation_days,
      ],
    );
    await su?.query(`DELETE FROM hsdg.firm_internal_due WHERE compliance_rule_id = $1`, [ruleId]);
    await su?.end();
    await app?.close();
  });

  it('anyone signed in reads the policy; only partners change it, with a lock and an audit row', async () => {
    const s = await settings(sy);
    expect(s).toMatchObject({
      defaultReviewer: expect.any(String),
      articleClientScope: expect.any(String),
      clientReminderChannel: expect.any(String),
      bulkAssignScope: expect.any(String),
    });

    await patch(sy, { version: s.version, defaultReviewer: 'engagement_partner' }).expect(403);
    await patch(mx, { version: s.version, defaultReviewer: 'engagement_partner' }).expect(403);
    await patch(pa, { version: s.version, defaultReviewer: 'nobody' }).expect(400);
    await patch(pa, { version: s.version, clientReminderDays: 2, clientEscalationDays: 5 }).expect(
      400,
    );

    const after = (
      await patch(pa, {
        version: s.version,
        defaultReviewer: 'engagement_partner',
        clientReminderChannel: 'copy',
      }).expect(200)
    ).body as WorkflowSettings;
    expect(after).toMatchObject({
      defaultReviewer: 'engagement_partner',
      clientReminderChannel: 'copy',
      version: s.version + 1,
      updatedByName: 'Partner A',
    });
    // The version read is stale now.
    await patch(mp, { version: s.version, defaultReviewer: 'stream_lead' }).expect(409);

    const audit = await su.query<{ after_state: Record<string, unknown> }>(
      `SELECT after_state FROM hsdg.audit_events
        WHERE action = 'workflow_settings.updated' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(audit.rows[0]!.after_state).toEqual({
      defaultReviewer: 'engagement_partner',
      clientReminderChannel: 'copy',
    });
  });

  it('a form’s internal due date re-dates its open filings and new ones follow', async () => {
    const a = await filing();
    // Statutory 11 Oct 2026 (a Sunday) − 2 → Friday 9 Oct.
    expect(await internalDate(a.inst)).toBe('2026-10-09');
    // One with a manual internal date keeps it.
    const kept = await filing();
    await su.query(
      `UPDATE hsdg.compliance_instances SET internal_sla_override = '2026-10-01' WHERE id = $1`,
      [kept.inst],
    );

    const list = (
      await http().get('/api/v1/workflow-settings/internal-due').set(bearer(sy)).expect(200)
    ).body as FormInternalDueList;
    expect(list.items.find((f) => f.ruleId === ruleId)).toMatchObject({
      label: 'GSTR-1',
      internalSlaOffsetDays: 2,
      suggestedDays: 2,
    });

    const url = `/api/v1/workflow-settings/internal-due/${ruleId}`;
    await http().patch(url).set(bearer(mx)).send({ internalSlaOffsetDays: 4 }).expect(403);
    await http().patch(url).set(bearer(pa)).send({ internalSlaOffsetDays: 61 }).expect(400);
    const res = await http()
      .patch(url)
      .set(bearer(pa))
      .send({ internalSlaOffsetDays: 4 })
      .expect(200);
    expect(res.body.item.internalSlaOffsetDays).toBe(4);
    expect(res.body.filingsRedated).toBe(1); // not the one with its own date

    // 11 Oct − 4 = Wednesday 7 Oct; the overridden one still shows its own date.
    expect(await internalDate(a.inst)).toBe('2026-10-07');
    const keptRow = await su.query<{ d: string }>(
      `SELECT COALESCE(internal_sla_override, internal_sla_date)::text AS d
         FROM hsdg.compliance_instances WHERE id = $1`,
      [kept.inst],
    );
    expect(keptRow.rows[0]!.d).toBe('2026-10-01');

    // A filing generated afterwards is dated with the firm's answer.
    const b = await filing();
    expect(await internalDate(b.inst)).toBe('2026-10-07');

    // 9 days lands on Friday 2 Oct (a holiday-free week): 11 − 9 = Fri 2 Oct.
    await http().patch(url).set(bearer(mp)).send({ internalSlaOffsetDays: 9 }).expect(200);
    expect(await internalDate(b.inst)).toBe('2026-10-02');
  });

  it('a task sent for review without a reviewer goes to whom the firm chose', async () => {
    const { eng, line } = await filing();
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(pa))
      .send({ employeeId: articleNorth, roleOnEngagement: 'member' })
      .expect(201);
    await su.query(`UPDATE hsdg.engagement_services SET lead_employee_id = $2 WHERE id = $1`, [
      line,
      articleNorth,
    ]);

    const sendAs = async (policy: string): Promise<string | null> => {
      await su.query(`UPDATE hsdg.firm_settings SET default_reviewer = $1`, [policy]);
      const task = (
        await http()
          .post(`/api/v1/engagements/${eng}/tasks`)
          .set(bearer(pa))
          .send({ title: `Review policy ${policy}`, assignedToEmployeeId: seniorY })
          .expect(201)
      ).body.id as string;
      await su.query(`UPDATE hsdg.tasks SET engagement_service_id = $2 WHERE id = $1`, [
        task,
        line,
      ]);
      const v = async () =>
        (
          await su.query<{ version: number }>(`SELECT version FROM hsdg.tasks WHERE id = $1`, [
            task,
          ])
        ).rows[0]!.version;
      await http()
        .post(`/api/v1/engagements/${eng}/tasks/${task}/start`)
        .set(bearer(sy))
        .send({ version: await v() })
        .expect(201);
      await http()
        .post(`/api/v1/engagements/${eng}/tasks/${task}/send-for-review`)
        .set(bearer(sy))
        .send({ version: await v() })
        .expect(201);
      return (
        await su.query<{ r: string | null }>(
          `SELECT reviewer_employee_id AS r FROM hsdg.tasks WHERE id = $1`,
          [task],
        )
      ).rows[0]!.r;
    };

    expect(await sendAs('engagement_manager')).toBe(managerX);
    expect(await sendAs('engagement_partner')).toBe(await employeeId('EMP003'));
    expect(await sendAs('stream_lead')).toBe(articleNorth);
  });

  it('a stream lead bulk-assigns their stream’s filings only while the firm allows it', async () => {
    const { inst, line } = await filing();
    await su.query(`UPDATE hsdg.engagement_services SET lead_employee_id = $2 WHERE id = $1`, [
      line,
      seniorY,
    ]);
    await su.query(`DELETE FROM hsdg.tasks WHERE source_compliance_instance_id = $1`, [inst]);
    const assign = (t: string) =>
      http()
        .post('/api/v1/compliance/runs/assign')
        .set(bearer(t))
        .send({ instanceIds: [inst], preparerId: seniorY, reviewerId: managerX })
        .expect(200);

    await su.query(`UPDATE hsdg.firm_settings SET bulk_assign_scope = 'managers'`);
    expect((await assign(sy)).body.failed).toHaveLength(1);

    await su.query(`UPDATE hsdg.firm_settings SET bulk_assign_scope = 'managers_and_leads'`);
    const ok = (await assign(sy)).body;
    expect(ok).toEqual({ succeeded: [inst], failed: [] });
    const task = await su.query<{ a: string; r: string }>(
      `SELECT assigned_to_employee_id AS a, reviewer_employee_id AS r
         FROM hsdg.tasks WHERE source_compliance_instance_id = $1`,
      [inst],
    );
    expect(task.rows[0]).toEqual({ a: seniorY, r: managerX });

    // Not the lead of another stream line's filing: still refused.
    const other = await filing();
    expect(
      (
        await http()
          .post('/api/v1/compliance/runs/assign')
          .set(bearer(sy))
          .send({ instanceIds: [other.inst], reviewerId: managerX })
          .expect(200)
      ).body.failed,
    ).toHaveLength(1);
  });
});

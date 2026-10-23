import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { STRICT_FIRM_CHECKS } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Easy mode — lodging and the checklist with the firm's checks off (Admin →
 * Checks). Anyone on the filing lodges at any stage, without the
 * acknowledgement or the reference, and fills them in later; the lodge closes
 * the task whoever records it; the team undoes within 7 days and marks a
 * filing Not applicable; a required step goes Not applicable without a
 * reason; a hand tick on the review step stands; the client's approval no
 * longer holds the filing. The database keeps each rule while its check is on.
 */
describe('Easy mode: lodging and the checklist (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let mx: string;
  let sy: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const employeeId = async (code: string): Promise<string> =>
    (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = $1`, [
        code,
      ])
    ).rows[0]!.id;
  const setChecks = (checks: object) =>
    su.query(`UPDATE hsdg.firm_settings SET strict_checks = $1::jsonb`, [JSON.stringify(checks)]);

  /**
   * An engagement (partner A, manager X, Senior Y on the team) with one
   * September 3B whose task is Article North's, reviewed by Manager X — so
   * Senior Y is on the filing but neither its assignee nor its reviewer.
   */
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
          periodLabel: `EM${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    await http()
      .patch(`/api/v1/engagements/${eng}`)
      .set(bearer(mp))
      .send({ engagementManagerEmployeeId: await employeeId('EMP005') })
      .expect(200);
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(pa))
      .send({ employeeId: await employeeId('EMP006'), roleOnEngagement: 'in_charge' })
      .expect(201);

    const code = `GST_GSTR3B_${unique()}`;
    const rule = await http()
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code, name: 'GSTR-3B', dueDateCategory: 'STATUTORY_RULE' })
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
    const inst = (
      await http()
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(pa))
        .send({ complianceRuleCode: code, referenceDate: '2026-09-30' })
        .expect(201)
    ).body.id as string;
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
              period_start = '2026-09-01', period_end = '2026-09-30', statutory_deadline = '2026-10-20'
        WHERE id = $1`,
      [inst, reg.rows[0]!.id],
    );
    const task = (
      await su.query<{ id: string }>(
        `UPDATE hsdg.tasks SET assigned_to_employee_id = $2, reviewer_employee_id = $3
          WHERE source_compliance_instance_id = $1 RETURNING id`,
        [inst, await employeeId('EMP007'), await employeeId('EMP005')],
      )
    ).rows[0]!.id;
    return { eng, inst, task };
  };

  const ws = (t: string, inst: string) =>
    http().get(`/api/v1/compliance-instances/${inst}`).set(bearer(t));
  interface Item {
    id: string;
    itemCode: string;
    status: string;
    version: number;
    naReason: string | null;
  }
  const item = (body: { checklist: Item[] }, code: string): Item =>
    body.checklist.find((c) => c.itemCode === code)!;
  const codes = (body: { warnings: Array<{ code: string }> }) => body.warnings.map((w) => w.code);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
  });

  beforeEach(() => setChecks({}));

  afterAll(async () => {
    await setChecks(STRICT_FIRM_CHECKS);
    await su?.end();
    await app?.close();
  });

  it('lets anyone on the filing lodge with just the date, then fill in the ack and reference', async () => {
    const { inst, task } = await setup();
    const first = (await ws(sy, inst).expect(200)).body;
    expect(first.instance.workflowStatus).toBe('not_started');
    expect(first.can).toMatchObject({ lodge: true, waive: true, edit: true });

    // The assignee's clock is running when someone else lodges.
    const running = (
      await su.query<{ id: string }>(
        `INSERT INTO hsdg.engagement_time_entries
           (engagement_id, employee_id, task_id, entry_kind, source, started_at)
         SELECT engagement_id, $2, id, 'work', 'auto', now() - interval '20 minutes'
           FROM hsdg.tasks WHERE id = $1 RETURNING id`,
        [task, await employeeId('EMP007')],
      )
    ).rows[0]!.id;

    // Just "Mark filed": no reference, no acknowledgement, no date, no figures.
    const lodged = (
      await http().post(`/api/v1/compliance-instances/${inst}/lodge`).set(bearer(sy)).send({})
    ).body;
    expect(lodged.instance.workflowStatus).toBe('filed');
    expect(lodged.filing).toMatchObject({ referenceNo: null, ackDocumentId: null });
    // The firm's today is India's.
    expect(lodged.filing.filedOn).toBe(
      new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
    );
    expect(codes(lodged)).toEqual(
      expect.arrayContaining(['ack_missing', 'reference_missing', 'figures_missing']),
    );
    expect(lodged.can).toMatchObject({ lodge: false, undo: true });

    // The task closed (Senior Y is neither its assignee nor its reviewer) and
    // the assignee's clock stopped.
    const after = await su.query<{ status: string; ended: boolean }>(
      `SELECT t.status, te.ended_at IS NOT NULL AS ended
         FROM hsdg.tasks t JOIN hsdg.engagement_time_entries te ON te.id = $2
        WHERE t.id = $1`,
      [task, running],
    );
    expect(after.rows[0]).toEqual({ status: 'done', ended: true });

    // The acknowledgement slot still takes the upload, and it becomes the ack.
    const withAck = (
      await http()
        .post(`/api/v1/compliance-instances/${inst}/slots/ACK_3B/documents`)
        .set(bearer(sy))
        .send({
          filename: 'ack.pdf',
          contentType: 'application/pdf',
          contentBase64: b64('ack bytes'),
        })
        .expect(201)
    ).body;
    expect(withAck.filing.ackDocumentId).toEqual(expect.any(String));
    expect(codes(withAck)).not.toContain('ack_missing');
    // Other slots stay locked with the filing.
    await http()
      .post(`/api/v1/compliance-instances/${inst}/slots/CLIENT_APPROVAL/documents`)
      .set(bearer(sy))
      .send({ filename: 'a.pdf', contentType: 'application/pdf', contentBase64: b64('a') })
      .expect(409);

    // The reference: filled in by the team, replaced only by a lead.
    const withRef = (
      await http()
        .patch(`/api/v1/compliance-instances/${inst}/lodge`)
        .set(bearer(sy))
        .send({ referenceNo: 'aa1909261234567' })
        .expect(200)
    ).body;
    expect(withRef.filing.referenceNo).toBe('AA1909261234567');
    expect(codes(withRef)).not.toContain('reference_missing');
    await http()
      .patch(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({ referenceNo: 'AA1909261234568' })
      .expect(403);
    const replaced = await http()
      .patch(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(mx))
      .send({ referenceNo: 'AA1909261234568' })
      .expect(200);
    expect(replaced.body.filing.referenceNo).toBe('AA1909261234568');
    const audit = await su.query(
      `SELECT 1 FROM hsdg.audit_events WHERE action = 'filing.lodge_completed' AND object_id = $1`,
      [inst],
    );
    expect(audit.rowCount).toBe(3);
  });

  it('lets the team undo within 7 days, then only a partner; and waive and lift a filing', async () => {
    const { inst } = await setup();
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({ filedOn: '2026-10-10' })
      .expect(201);
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge/undo`)
      .set(bearer(sy))
      .send({ reason: 'Wrong month' })
      .expect(201);

    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({ filedOn: '2026-10-10' })
      .expect(201);
    await su.query(
      `UPDATE hsdg.filing_records SET created_at = now() - interval '8 days'
        WHERE compliance_instance_id = $1 AND undone_at IS NULL`,
      [inst],
    );
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge/undo`)
      .set(bearer(sy))
      .send({ reason: 'Wrong month' })
      .expect(403);
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge/undo`)
      .set(bearer(mx))
      .send({ reason: 'Wrong month' })
      .expect(403);
    const undone = await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge/undo`)
      .set(bearer(pa))
      .send({ reason: 'Wrong month' })
      .expect(201);
    expect(undone.body.filing).toBeNull();

    // Not applicable: the team's call, and lifted by the team.
    const waived = await http()
      .post(`/api/v1/compliance-instances/${inst}/not-applicable`)
      .set(bearer(sy))
      .send({ reason: 'No business this month' })
      .expect(201);
    expect(waived.body.instance.workflowStatus).toBe('not_applicable');
    const lifted = await http()
      .post(`/api/v1/compliance-instances/${inst}/not-applicable/lift`)
      .set(bearer(sy))
      .send({})
      .expect(201);
    expect(lifted.body.instance.workflowStatus).not.toBe('not_applicable');
  });

  it('keeps hand ticks, takes Not applicable without a reason, and does not wait on the client', async () => {
    const { eng, inst, task } = await setup();
    const body = (await ws(sy, inst).expect(200)).body;

    // A required step Not applicable, no reason.
    const approval = item(body, 'CLIENT_APPROVAL');
    const na = await http()
      .patch(`/api/v1/compliance-instances/${inst}/items/${approval.id}`)
      .set(bearer(sy))
      .send({ status: 'not_applicable', version: approval.version })
      .expect(200);
    expect(item(na.body, 'CLIENT_APPROVAL')).toMatchObject({
      status: 'not_applicable',
      naReason: null,
    });

    // The review step ticked by hand stands after the next open.
    const review = item(na.body, 'REVIEW');
    await http()
      .patch(`/api/v1/compliance-instances/${inst}/items/${review.id}`)
      .set(bearer(sy))
      .send({ status: 'done', version: review.version })
      .expect(200);
    expect(item((await ws(sy, inst).expect(200)).body, 'REVIEW').status).toBe('done');

    // Back to open, then the review approved with the client's approval still
    // open: the filing is Ready to file.
    const reopened = item((await ws(sy, inst)).body, 'CLIENT_APPROVAL');
    await http()
      .patch(`/api/v1/compliance-instances/${inst}/items/${reopened.id}`)
      .set(bearer(sy))
      .send({ status: 'open', version: reopened.version })
      .expect(200);
    const act = (t: string, action: string) =>
      http().post(`/api/v1/engagements/${eng}/tasks/${task}/${action}`).set(bearer(t)).send({});
    await act(mx, 'send-for-review').expect(201);
    await act(mx, 'start-review').expect(201);
    await act(mx, 'approve').expect(201);
    const ready = (await ws(sy, inst).expect(200)).body;
    expect(item(ready, 'CLIENT_APPROVAL').status).toBe('open');
    expect(ready.instance.workflowStatus).toBe('ready_to_file');
  });

  it('keeps every rule while its check is on, in the API and the database', async () => {
    await setChecks(STRICT_FIRM_CHECKS);
    const { inst } = await setup();
    const body = (await ws(sy, inst).expect(200)).body;
    expect(body.can).toMatchObject({ lodge: false, waive: false });
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({})
      .expect(403);
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(mx))
      .send({ filedOn: '2026-10-10' })
      .expect(400);
    const approval = item(body, 'CLIENT_APPROVAL');
    await http()
      .patch(`/api/v1/compliance-instances/${inst}/items/${approval.id}`)
      .set(bearer(mx))
      .send({ status: 'not_applicable', version: approval.version })
      .expect(400);

    // A lodge without its acknowledgement, straight into the database.
    await setChecks({});
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(mx))
      .send({ filedOn: '2026-10-10', referenceNo: 'AA1909261234567' })
      .expect(201);
    await setChecks(STRICT_FIRM_CHECKS);
    const copyLodge = `
      INSERT INTO hsdg.filing_records
      SELECT (jsonb_populate_record(NULL::hsdg.filing_records,
                to_jsonb(f) - 'reference_no' || jsonb_build_object('id', gen_random_uuid()))).*
        FROM hsdg.filing_records f WHERE f.compliance_instance_id = $1 AND f.undone_at IS NULL`;
    await expect(su.query(copyLodge, [inst])).rejects.toMatchObject({ code: '23514' });

    // Senior Y, as the app: may fill in the missing ack, may not touch the
    // reference — and only a lead undoes while undo_lead_only is on.
    await su.query('BEGIN');
    try {
      await su.query(
        `SELECT set_config('hsdg.user_id', u.id::text, true),
                set_config('hsdg.role', 'senior', true),
                set_config('hsdg.roles', 'senior', true),
                set_config('hsdg.office_id', u.primary_office_id::text, true),
                set_config('hsdg.employee_id', e.id::text, true)
           FROM hsdg.users u JOIN hsdg.employees e ON e.user_id = u.id
          WHERE u.email = 'senior.y@dhvaj.in'`,
      );
      await su.query('SET LOCAL ROLE hsdg_app');
      const tryUpdate = async (set: string) => {
        await su.query('SAVEPOINT s');
        try {
          await su.query(
            `UPDATE hsdg.filing_records SET ${set}
              WHERE compliance_instance_id = $1 AND undone_at IS NULL`,
            [inst],
          );
          await su.query('RELEASE SAVEPOINT s');
          return 'ok';
        } catch (err) {
          await su.query('ROLLBACK TO SAVEPOINT s');
          return (err as { code?: string }).code;
        }
      };
      expect(await tryUpdate(`reference_no = 'AA1909261234569'`)).toBe('42501');
      expect(
        await tryUpdate(`undone_at = now(), undo_reason = 'x', undone_by_employee_id = NULL`),
      ).toBe('42501');
      expect(await tryUpdate(`version = version + 1`)).toBe('ok');
    } finally {
      await su.query('ROLLBACK');
    }
  });
});

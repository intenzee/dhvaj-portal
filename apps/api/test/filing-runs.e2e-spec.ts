import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { freshClient } from './fresh-client.helper';

/**
 * Staff Workflow WF-301 / WF-302 — filing runs and client chasing. One GSTR-1
 * for September across clients: a lead bulk-assigns preparer and reviewer (a
 * task is created where the filing had none), bulk-reminds the clients (one
 * request per required client-data slot, idempotent), and an upload into the
 * slot closes the request server-side. RLS: a filing on someone else's
 * engagement never shows in a run and fails per row in a bulk call. The run
 * is behind ff_filing_runs — here on for the North office only.
 */
describe('Filing runs + client chasing (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let pb: string;
  let mx: string;
  let sy: string;
  let seniorY: string;
  let managerX: string;
  let ruleCode: string;
  let ruleId: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const employeeId = async (code: string): Promise<string> => {
    const r = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE employee_code = $1`,
      [code],
    );
    return r.rows[0]!.id;
  };

  /**
   * A Compliance engagement led by `lead` on a fresh copy of `clientSearch`,
   * with one September GSTR-1 (Outward) on its own GSTIN.
   */
  const filing = async (
    lead: string,
    clientSearch: string,
    opts: { manager?: string; team?: string } = {},
  ): Promise<{ eng: string; inst: string }> => {
    const entityId = await freshClient(
      (await http().get(`/api/v1/entities?search=${clientSearch}&limit=100`).set(bearer(mp))).body
        .items[0].id as string,
    );
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(lead))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `FR${unique()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    if (opts.manager)
      await http()
        .patch(`/api/v1/engagements/${eng}`)
        .set(bearer(mp))
        .send({ engagementManagerEmployeeId: opts.manager })
        .expect(200);
    if (opts.team)
      await http()
        .post(`/api/v1/engagements/${eng}/team`)
        .set(bearer(lead))
        .send({ employeeId: opts.team, roleOnEngagement: 'in_charge' })
        .expect(201);
    const inst = (
      await http()
        .post(`/api/v1/engagements/${eng}/compliance`)
        .set(bearer(lead))
        .send({ complianceRuleCode: ruleCode, referenceDate: '2026-09-30' })
        .expect(201)
    ).body.id as string;
    const gstin = `19AAAR${unique().slice(-9)}`.slice(0, 15).padEnd(15, 'Z');
    const reg = await su.query<{ id: string }>(
      `INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code)
       VALUES ($1,'gstin',$2,'19') RETURNING id`,
      [entityId, gstin],
    );
    await su.query(
      `UPDATE hsdg.compliance_instances
          SET registration_id = $2, section = 'outward', financial_year = '2026-27',
              period_key = '2026-09', period_start = '2026-09-01', period_end = '2026-09-30',
              statutory_deadline = '2026-10-11', internal_sla_override = '2026-10-08'
        WHERE id = $1`,
      [inst, reg.rows[0]!.id],
    );
    return { eng, inst };
  };

  const runs = (t: string, scope?: string) =>
    http()
      .get(
        `/api/v1/compliance/runs?rule=${ruleCode}&period=2026-09${scope ? `&scope=${scope}` : ''}`,
      )
      .set(bearer(t));
  const chase = (t: string, inst: string) =>
    http().get(`/api/v1/compliance-instances/${inst}/client-chase`).set(bearer(t));

  let a: { eng: string; inst: string };
  let c: { eng: string; inst: string };
  let south: { eng: string; inst: string };

  beforeAll(async () => {
    // The run is rolled out to the North office only; South gets a 404. Set
    // before the app (and its config) is loaded.
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
    seniorY = await employeeId('EMP006');
    managerX = await employeeId('EMP005');

    ruleCode = `GST_GSTR1_${unique()}`;
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
      })
      .expect(201);
    await su.query(
      `UPDATE hsdg.compliance_rule_versions SET stream = 'gst', section = 'outward', form_label = 'GSTR-1'
        WHERE compliance_rule_id = $1`,
      [ruleId],
    );

    // A: partner A + manager X, Senior Y on the team; the filing has its task.
    a = await filing(pa, 'Bharat', { manager: managerX, team: seniorY });
    // C: partner A + manager X; the filing has no task yet.
    c = await filing(pa, 'Acme', { manager: managerX, team: seniorY });
    await su.query(`DELETE FROM hsdg.tasks WHERE source_compliance_instance_id = $1`, [c.inst]);
    // South: partner B's own engagement — nobody in the North is on it.
    south = await filing(pb, 'Coastal');
  });

  afterAll(async () => {
    delete process.env.FEATURE_FLAG_OFFICES;
    await su?.end();
    await app?.close();
  });

  it('is behind ff_filing_runs: 404 for an office it is not rolled out to', async () => {
    await http().get('/api/v1/compliance/runs/forms').set(bearer(pb)).expect(404);
    await http()
      .get(`/api/v1/compliance/runs?rule=${ruleCode}&period=2026-09`)
      .set(bearer(pb))
      .expect(404);
    await http()
      .post('/api/v1/compliance/runs/assign')
      .set(bearer(pb))
      .send({ instanceIds: [south.inst], preparerId: seniorY })
      .expect(404);
    await http()
      .post('/api/v1/compliance/runs/remind')
      .set(bearer(pb))
      .send({ instanceIds: [south.inst] })
      .expect(404);
  });

  it('lists the form for the picker and the run, without other teams’ filings', async () => {
    const forms = await http().get('/api/v1/compliance/runs/forms').set(bearer(pa)).expect(200);
    // The run is due 2026-10-11; the picker window is relative to today, so
    // only check the shape when it is in range.
    const mine = (forms.body as Array<{ rule: string }>).find((f) => f.rule === ruleCode);
    if (mine)
      expect(mine).toMatchObject({ periodKey: '2026-09', periodLabel: 'Sep 2026', total: 2 });

    const run = await runs(pa).expect(200);
    expect(run.body).toMatchObject({
      rule: ruleCode,
      formLabel: 'GSTR-1',
      periodKey: '2026-09',
      periodLabel: 'Sep 2026',
      total: 2,
      filed: 0,
    });
    const ids = (run.body.items as Array<{ instanceId: string }>).map((i) => i.instanceId);
    expect(ids.sort()).toEqual([a.inst, c.inst].sort());
    expect(ids).not.toContain(south.inst);
    const rowC = run.body.items.find((i: { instanceId: string }) => i.instanceId === c.inst);
    expect(rowC).toMatchObject({
      taskId: null,
      canAssign: true,
      canLodge: true,
      filed: null,
      statutoryDate: '2026-10-11',
      internalDate: '2026-10-08',
      link: { instanceId: c.inst, stream: 'gst', periodKey: '2026-09', section: 'outward' },
    });

    // The managing partner is firm-wide: the South filing is in their run.
    const all = await runs(mp).expect(200);
    expect(all.body.total).toBe(3);
  });

  it('bulk-assigns per filing: creates the missing task, refuses what RLS hides', async () => {
    const res = await http()
      .post('/api/v1/compliance/runs/assign')
      .set(bearer(pa))
      .send({
        instanceIds: [a.inst, c.inst, south.inst],
        preparerId: seniorY,
        reviewerId: managerX,
      })
      .expect(200);
    expect(res.body.succeeded.sort()).toEqual([a.inst, c.inst].sort());
    expect(res.body.failed).toEqual([{ instanceId: south.inst, message: 'Filing not found.' }]);

    const run = await runs(pa).expect(200);
    for (const row of run.body.items) {
      expect(row).toMatchObject({
        preparerId: seniorY,
        preparerName: 'Senior Y',
        reviewerId: managerX,
        reviewerName: 'Manager X',
      });
    }
    const task = await su.query<{ title: string; due_date: string; work_type: string }>(
      `SELECT title, due_date::text, work_type FROM hsdg.tasks WHERE source_compliance_instance_id = $1`,
      [c.inst],
    );
    expect(task.rows).toHaveLength(1);
    expect(task.rows[0]).toMatchObject({ due_date: '2026-10-08', work_type: 'filing' });
    expect(task.rows[0]!.title).toMatch(/^GSTR-1 · 2026-09 · 19AAAR/);

    // The same person cannot prepare and review.
    const same = await http()
      .post('/api/v1/compliance/runs/assign')
      .set(bearer(pa))
      .send({ instanceIds: [a.inst], reviewerId: seniorY })
      .expect(200);
    expect(same.body.succeeded).toEqual([]);
    expect(same.body.failed[0].message).toMatch(/other than the preparer/);

    const audit = await su.query(
      `SELECT 1 FROM hsdg.audit_events WHERE action = 'filing_run.assigned'
          AND after_state -> 'succeeded' ? $1`,
      [c.inst],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('scopes the run to mine (preparer / reviewer) and team (engagements I lead)', async () => {
    const mine = await runs(mx, 'mine').expect(200);
    expect(
      (mine.body.items as Array<{ instanceId: string }>).map((i) => i.instanceId).sort(),
    ).toEqual([a.inst, c.inst].sort());
    const team = await runs(mx, 'team').expect(200);
    expect(team.body.total).toBe(2);
    const mpMine = await runs(mp, 'mine').expect(200);
    expect(mpMine.body.total).toBe(0);
  });

  it('bulk-reminds: one request per required client-data slot, idempotent, RLS per row', async () => {
    const res = await http()
      .post('/api/v1/compliance/runs/remind')
      .set(bearer(pa))
      .send({ instanceIds: [a.inst, south.inst] })
      .expect(200);
    expect(res.body.succeeded).toEqual([a.inst]);
    expect(res.body.failed).toEqual([{ instanceId: south.inst, message: 'Filing not found.' }]);

    const deps = await su.query(
      `SELECT slot_code, period_section, status, reminder_date::text, escalation_date::text,
              responsible_employee_id
         FROM hsdg.client_dependencies WHERE compliance_instance_id = $1`,
      [a.inst],
    );
    expect(deps.rows).toHaveLength(1);
    expect(deps.rows[0]).toMatchObject({
      slot_code: 'SALES_REGISTER',
      period_section: 'outward',
      status: 'pending',
      responsible_employee_id: seniorY,
    });
    // T-7 / T-3 from the internal date, never before today.
    const today = (
      await su.query<{ d: string }>(`SELECT timezone('Asia/Kolkata', now())::date::text AS d`)
    ).rows[0]!.d;
    const max = (x: string, y: string) => (x > y ? x : y);
    expect(deps.rows[0].reminder_date).toBe(max('2026-10-01', today));
    expect(deps.rows[0].escalation_date).toBe(max('2026-10-05', max('2026-10-01', today)));

    const view = await chase(sy, a.inst).expect(200);
    expect(view.body).toMatchObject({
      instanceId: a.inst,
      notRequested: [],
      canEmail: false,
    });
    expect(view.body.waitingOn).toHaveLength(1);
    expect(view.body.waitingOn[0]).toMatchObject({
      slotCode: 'SALES_REGISTER',
      label: 'Sales register',
    });
    expect(view.body.reminderText).toContain('• Sales register');

    // A second reminder (single filing, copy-text: no e-mail channel here) asks nothing new.
    const again = await http()
      .post(`/api/v1/compliance-instances/${a.inst}/client-chase/remind`)
      .set(bearer(sy))
      .expect(200);
    expect(again.body).toMatchObject({ channel: 'copy', raised: 0, waitingOn: ['Sales register'] });
    expect(again.body.text).toContain('To prepare your GSTR-1 for Sep 2026');
    const count = await su.query(
      `SELECT 1 FROM hsdg.client_dependencies WHERE compliance_instance_id = $1`,
      [a.inst],
    );
    expect(count.rowCount).toBe(1);

    // Partner B is not on A's engagement: chasing it is refused.
    await chase(pb, a.inst).expect(404);
  });

  it('an upload into the slot closes the matching request, server-side and audited', async () => {
    const dep = (
      await su.query<{ id: string }>(
        `SELECT id FROM hsdg.client_dependencies WHERE compliance_instance_id = $1`,
        [a.inst],
      )
    ).rows[0]!.id;
    // Senior Y (the preparer) uploads; they cannot write the request themselves.
    await http()
      .post(`/api/v1/compliance-instances/${a.inst}/slots/SALES_REGISTER/documents`)
      .set(bearer(sy))
      .send({
        filename: 'sales-register.pdf',
        contentType: 'application/pdf',
        contentBase64: b64('sales register bytes'),
      })
      .expect(201);

    const after = await su.query<{ status: string; received_date: string | null }>(
      `SELECT status, received_date::text FROM hsdg.client_dependencies WHERE id = $1`,
      [dep],
    );
    expect(after.rows[0]!.status).toBe('received');
    expect(after.rows[0]!.received_date).not.toBeNull();
    const audit = await su.query<{ actor_role: string }>(
      `SELECT actor_role FROM hsdg.audit_events
        WHERE action = 'client_dependency.auto_received' AND object_id = $1`,
      [dep],
    );
    expect(audit.rows).toEqual([{ actor_role: 'senior' }]);

    expect((await chase(sy, a.inst).expect(200)).body.waitingOn).toEqual([]);
    const row = (await runs(pa).expect(200)).body.items.find(
      (i: { instanceId: string }) => i.instanceId === a.inst,
    );
    expect(row.data).toMatchObject({
      slotsRequired: 1,
      slotsFilled: 1,
      requestsTotal: 1,
      requestsOpen: 0,
      waitingOn: [],
    });

    // Nothing left to chase.
    await http()
      .post(`/api/v1/compliance-instances/${a.inst}/client-chase/remind`)
      .set(bearer(sy))
      .expect(400);
  });

  it('escalates an overdue client request to the stream lead as well', async () => {
    await http()
      .post(`/api/v1/compliance-instances/${c.inst}/client-chase/remind`)
      .set(bearer(pa))
      .expect(200);
    const es = (
      await su.query<{ id: string }>(
        `UPDATE hsdg.engagement_services SET lead_employee_id = $2
          WHERE engagement_id = $1 RETURNING id`,
        [c.eng, managerX],
      )
    ).rows[0]!.id;
    const dep = (
      await su.query<{ id: string }>(
        `UPDATE hsdg.client_dependencies SET engagement_service_id = $2, escalation_date = '2026-01-01'
          WHERE compliance_instance_id = $1 RETURNING id`,
        [c.inst, es],
      )
    ).rows[0]!.id;

    await http().post('/api/v1/notifications/scan').set(bearer(mp)).expect(201);

    const to = await su.query<{ email: string }>(
      `SELECT u.email::text AS email FROM hsdg.notifications n
         JOIN hsdg.users u ON u.id = n.recipient_user_id
        WHERE n.object_type = 'client_dependency' AND n.object_id::text = $1
          AND n.title LIKE 'PBC overdue%'`,
      [dep],
    );
    expect(to.rows.map((r) => r.email).sort()).toEqual([
      'manager.x@dhvaj.in',
      'partner.a@dhvaj.in',
      'senior.y@dhvaj.in',
    ]);
  });

  it('follows the firm’s reminder channel: a WhatsApp link, copy without a phone, or copy', async () => {
    const setChannel = async (clientReminderChannel: 'email' | 'whatsapp' | 'copy') => {
      const { version } = (
        await http().get('/api/v1/workflow-settings').set(bearer(mp)).expect(200)
      ).body as { version: number };
      await http()
        .patch('/api/v1/workflow-settings')
        .set(bearer(mp))
        .send({ version, clientReminderChannel })
        .expect(200);
    };
    const d = await filing(pa, 'Bharat', { manager: managerX });
    const entityId = (
      await su.query<{ entity_id: string }>(
        `SELECT entity_id FROM hsdg.engagements WHERE id = $1`,
        [d.eng],
      )
    ).rows[0]!.entity_id;
    await su.query(`DELETE FROM hsdg.entity_contacts WHERE entity_id = $1`, [entityId]);
    await su.query(
      `INSERT INTO hsdg.entity_contacts (entity_id, full_name, phone, is_primary)
       VALUES ($1, 'Accounts', '+91 98765-43210', true)`,
      [entityId],
    );
    const reminded = async () =>
      (
        await su.query<{ after_state: { channel: string; fallback: string | null } }>(
          `SELECT after_state FROM hsdg.audit_events
            WHERE action = 'filing.client_reminded' AND object_id = $1
            ORDER BY occurred_at DESC, id DESC LIMIT 1`,
          [d.inst],
        )
      ).rows[0]!.after_state;

    try {
      await setChannel('whatsapp');
      expect((await chase(pa, d.inst).expect(200)).body).toMatchObject({
        channel: 'whatsapp',
        fallback: null,
        clientPhone: '+91 98765-43210',
      });
      const bulk = await http()
        .post('/api/v1/compliance/runs/remind')
        .set(bearer(pa))
        .send({ instanceIds: [d.inst] })
        .expect(200);
      expect(bulk.body.succeeded).toEqual([d.inst]);
      const wa = bulk.body.reminders[0];
      expect(wa).toMatchObject({ instanceId: d.inst, channel: 'whatsapp', raised: 1 });
      expect(wa.waUrl).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(wa.text)}`);
      expect(wa.text).toContain('• Sales register');
      expect(await reminded()).toMatchObject({ channel: 'whatsapp', fallback: null });

      // No usable phone: the reminder falls back to copy and says why — not an error.
      await su.query(`UPDATE hsdg.entity_contacts SET phone = NULL WHERE entity_id = $1`, [
        entityId,
      ]);
      const noPhone = await http()
        .post(`/api/v1/compliance-instances/${d.inst}/client-chase/remind`)
        .set(bearer(pa))
        .expect(200);
      expect(noPhone.body).toMatchObject({ channel: 'copy', fallback: 'no_phone' });
      expect(noPhone.body.waUrl).toBeUndefined();
      expect(await reminded()).toMatchObject({ channel: 'copy', fallback: 'no_phone' });

      await setChannel('copy');
      const copied = await http()
        .post(`/api/v1/compliance-instances/${d.inst}/client-chase/remind`)
        .set(bearer(pa))
        .expect(200);
      expect(copied.body).toMatchObject({ channel: 'copy', fallback: null });
      expect(await reminded()).toMatchObject({ channel: 'copy', fallback: null });
    } finally {
      await setChannel('email');
    }
  });

  it('sends by the channel asked for (PS-001), and refuses one the client cannot be reached on', async () => {
    // The firm's channel stays e-mail (off in e2e, so it would fall back to copy).
    const d = await filing(pa, 'Bharat', { manager: managerX });
    const entityId = (
      await su.query<{ entity_id: string }>(
        `SELECT entity_id FROM hsdg.engagements WHERE id = $1`,
        [d.eng],
      )
    ).rows[0]!.entity_id;
    await su.query(`DELETE FROM hsdg.entity_contacts WHERE entity_id = $1`, [entityId]);
    const remind = (channel?: string) =>
      http()
        .post(`/api/v1/compliance-instances/${d.inst}/client-chase/remind`)
        .set(bearer(pa))
        .send(channel ? { channel } : {});
    const requests = async () =>
      Number(
        (
          await su.query<{ n: string }>(
            `SELECT count(*) AS n FROM hsdg.client_dependencies WHERE compliance_instance_id = $1`,
            [d.inst],
          )
        ).rows[0]!.n,
      );

    // No phone: WhatsApp is refused before anything is asked of the client.
    expect((await chase(pa, d.inst).expect(200)).body).toMatchObject({ canWhatsapp: false });
    const refused = await remind('whatsapp').expect(400);
    expect(refused.body.message).toMatch(/no phone number/i);
    expect(await requests()).toBe(0);
    await remind('email').expect(400);
    await remind('sms').expect(400);

    await su.query(
      `INSERT INTO hsdg.entity_contacts (entity_id, full_name, phone, is_primary)
       VALUES ($1, 'Accounts', '98765 43210', true)`,
      [entityId],
    );
    expect((await chase(pa, d.inst).expect(200)).body).toMatchObject({
      channel: 'copy',
      fallback: 'no_email',
      canWhatsapp: true,
    });
    const wa = (await remind('whatsapp').expect(200)).body;
    expect(wa).toMatchObject({ instanceId: d.inst, channel: 'whatsapp', raised: 1 });
    expect(wa.waUrl).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(wa.text)}`);
    const audit = await su.query<{ after_state: Record<string, unknown> }>(
      `SELECT after_state FROM hsdg.audit_events
        WHERE action = 'filing.client_reminded' AND object_id = $1
        ORDER BY occurred_at DESC, id DESC`,
      [d.inst],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.after_state).toMatchObject({
      channel: 'whatsapp',
      fallback: null,
      requested: 'whatsapp',
    });

    // Without a channel the firm's setting still decides.
    expect((await remind().expect(200)).body).toMatchObject({
      channel: 'copy',
      fallback: 'no_email',
    });
  });
});

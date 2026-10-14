import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { MonthlyDataRequestScheduler } from '../src/modules/filing-workspace/monthly-data-request.scheduler';

/**
 * Change 5 / 6 — the filing workspace (GST tab month-section). A junior on the
 * team works the checklist, uploads into slots and lodges once Ready to file;
 * only a lead waives; undo is a lead within 24 h; another engagement's partner
 * sees nothing. workflow_status follows the facts (SQL-derived).
 */
describe('Filing workspace (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let mx: string;
  let sy: string;

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

  /** An engagement (EP partner A, manager X, Senior Y on the team) with one 3B filing. */
  const setup = async (): Promise<{
    eng: string;
    inst: string;
    task: string;
    reg: string;
    entityId: string;
  }> => {
    // One standing Compliance engagement per client, so each setup gets its own.
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
        periodLabel: `FW${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    const eng = created.body.id as string;
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
    const gen = await http()
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: code, referenceDate: '2026-09-30' })
      .expect(201);
    const inst = gen.body.id as string;

    // Shape it as a GST summary filing for September on a GSTIN (the
    // calendar generator does this on main; here the superuser stands in).
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
    const t = await su.query<{ id: string }>(
      `UPDATE hsdg.tasks SET assigned_to_employee_id = $2, reviewer_employee_id = $3
        WHERE source_compliance_instance_id = $1 RETURNING id`,
      [inst, await employeeId('EMP006'), await employeeId('EMP005')],
    );
    return { eng, inst, task: t.rows[0]!.id, reg: reg.rows[0]!.id, entityId };
  };

  const ws = (t: string, inst: string) =>
    http().get(`/api/v1/compliance-instances/${inst}`).set(bearer(t));
  const upload = (t: string, inst: string, slot: string) =>
    http()
      .post(`/api/v1/compliance-instances/${inst}/slots/${slot}/documents`)
      .set(bearer(t))
      .send({
        filename: `${slot}.pdf`,
        contentType: 'application/pdf',
        contentBase64: b64(`${slot} bytes`),
      });
  const act = (t: string, eng: string, task: string, action: string, body: object = {}) =>
    http().post(`/api/v1/engagements/${eng}/tasks/${task}/${action}`).set(bearer(t)).send(body);

  const fullFigures = Object.fromEntries(
    ['output', 'itc', 'cash'].flatMap((p) =>
      ['igst', 'cgst', 'sgst', 'cess'].map((h) => [`${p}_${h}`, 100]),
    ),
  );

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

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('seeds the checklist on first open and walks a junior from preparation to lodge', async () => {
    const { eng, inst, task } = await setup();

    const first = await ws(sy, inst).expect(200);
    const codes = (first.body.checklist as Array<{ itemCode: string }>).map((c) => c.itemCode);
    expect(codes).toEqual([
      'LIABILITY',
      'ITC_CONFIRMED',
      'INTEREST_FEE',
      'CLIENT_APPROVAL',
      'PAYMENT',
      'REVIEW',
      'LODGE',
    ]);
    expect(first.body.instance.workflowStatus).toBe('not_started');
    // A member from another office still sees the GSTIN it files for.
    expect(first.body.instance.registrationNumber).toMatch(/^19AAAC/);
    expect(first.body.figuresRequiredToLodge).toBe(true);
    expect(first.body.can).toMatchObject({ lodge: false, waive: false, edit: true });

    // Idempotent: a second open adds nothing.
    expect((await ws(sy, inst).expect(200)).body.checklist).toHaveLength(7);

    // The junior cannot waive — a required step or the whole filing.
    const approval = first.body.checklist.find(
      (c: { itemCode: string }) => c.itemCode === 'CLIENT_APPROVAL',
    );
    await http()
      .patch(`/api/v1/compliance-instances/${inst}/items/${approval.id}`)
      .set(bearer(sy))
      .send({ status: 'not_applicable', naReason: 'n/a', version: approval.version })
      .expect(403);
    await http()
      .post(`/api/v1/compliance-instances/${inst}/not-applicable`)
      .set(bearer(sy))
      .send({ reason: 'no business' })
      .expect(403);

    // Not Ready to file → the junior cannot lodge yet.
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({ referenceNo: 'AA1909261234567', filedOn: '2026-10-10', ackDocumentId: inst })
      .expect(409);

    // Work: start → in_preparation; send for review; manager approves.
    await act(sy, eng, task, 'start').expect(201);
    expect((await ws(sy, inst)).body.instance.workflowStatus).toBe('in_preparation');
    await act(sy, eng, task, 'send-for-review').expect(201);
    expect((await ws(sy, inst)).body.instance.workflowStatus).toBe('in_review');
    await act(mx, eng, task, 'start-review').expect(201);
    await act(mx, eng, task, 'approve').expect(201);
    // Task approved, but no client approval recorded yet → still in review.
    const afterApprove = (await ws(sy, inst)).body;
    expect(afterApprove.instance.workflowStatus).toBe('in_review');
    expect(
      afterApprove.checklist.find((c: { itemCode: string }) => c.itemCode === 'REVIEW').status,
    ).toBe('done');

    // Uploading the client approval ticks it → Ready to file.
    const up = await upload(sy, inst, 'CLIENT_APPROVAL').expect(201);
    expect(up.body.instance.workflowStatus).toBe('ready_to_file');
    expect(
      up.body.checklist.find((c: { itemCode: string }) => c.itemCode === 'CLIENT_APPROVAL').status,
    ).toBe('done');
    expect(up.body.can.lodge).toBe(true);

    // Unknown slot → 400.
    await upload(sy, inst, 'NOT_A_SLOT').expect(400);

    const withAck = (await upload(sy, inst, 'ACK_3B').expect(201)).body;
    const ack = withAck.slots.find((s: { slotCode: string }) => s.slotCode === 'ACK_3B')
      .documents[0].id as string;

    // Figures are required to lodge a 3B; an ARN is 15 characters.
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({ referenceNo: 'AA1909261234567', filedOn: '2026-10-10', ackDocumentId: ack })
      .expect(400);
    await http()
      .put(`/api/v1/compliance-instances/${inst}/figures`)
      .set(bearer(sy))
      .send({ figures: fullFigures })
      .expect(200);
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({ referenceNo: 'SHORT', filedOn: '2026-10-10', ackDocumentId: ack })
      .expect(400);
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({ referenceNo: 'AA1909261234567', filedOn: '2026-09-15', ackDocumentId: ack })
      .expect(400); // before the period ends

    const lodged = await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({ referenceNo: 'aa1909261234567', filedOn: '2026-10-10', ackDocumentId: ack })
      .expect(201);
    expect(lodged.body.instance.workflowStatus).toBe('filed');
    expect(lodged.body.filing).toMatchObject({
      referenceKind: 'arn',
      referenceNo: 'AA1909261234567',
      isLate: false,
    });
    expect(lodged.body.instance.isLocked).toBe(true);
    expect(
      lodged.body.checklist.find((c: { itemCode: string }) => c.itemCode === 'LODGE').status,
    ).toBe('done');
    expect(lodged.body.can).toMatchObject({ lodge: false, undo: false });

    // Locked: no more figures.
    await http()
      .put(`/api/v1/compliance-instances/${inst}/figures`)
      .set(bearer(sy))
      .send({ figures: fullFigures, version: lodged.body.figuresVersion })
      .expect(409);

    // The manager is notified.
    const n = await su.query(
      `SELECT 1 FROM hsdg.notifications WHERE type = 'filing_lodged' AND object_id = $1`,
      [inst],
    );
    expect(n.rowCount).toBe(1);

    // A correction note, then undo: junior no, manager yes (within 24 h).
    await http()
      .post(`/api/v1/compliance-instances/${inst}/corrections`)
      .set(bearer(sy))
      .send({ note: 'Invoice 114 corrected in Dec 2026 GSTR-1.' })
      .expect(201);
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge/undo`)
      .set(bearer(sy))
      .send({ reason: 'typo' })
      .expect(403);
    const undone = await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge/undo`)
      .set(bearer(mx))
      .send({ reason: 'Typo in ARN' })
      .expect(201);
    expect(undone.body.instance.workflowStatus).toBe('ready_to_file');
    expect(undone.body.filing).toBeNull();
    expect(undone.body.filingHistory[0]).toMatchObject({
      undoReason: 'Typo in ARN',
      undoneByName: 'Manager X',
    });
    expect(undone.body.corrections).toHaveLength(1);
  });

  it('feeds Activity → Timeline: filings with ARN, task moves, documents, pinned comments; members only', async () => {
    const { eng, inst, task } = await setup();
    await ws(sy, inst).expect(200);
    await act(sy, eng, task, 'start').expect(201);
    await act(sy, eng, task, 'send-for-review').expect(201);
    await act(mx, eng, task, 'start-review').expect(201);
    await act(mx, eng, task, 'approve').expect(201);
    await upload(sy, inst, 'CLIENT_APPROVAL').expect(201);
    const withAck = (await upload(sy, inst, 'ACK_3B').expect(201)).body;
    const ack = withAck.slots.find((s: { slotCode: string }) => s.slotCode === 'ACK_3B')
      .documents[0].id as string;
    await http()
      .put(`/api/v1/compliance-instances/${inst}/figures`)
      .set(bearer(sy))
      .send({ figures: fullFigures })
      .expect(200);
    await http()
      .post(`/api/v1/compliance-instances/${inst}/lodge`)
      .set(bearer(sy))
      .send({ referenceNo: 'AA1909261234567', filedOn: '2026-10-10', ackDocumentId: ack })
      .expect(201);
    await http()
      .post(`/api/v1/engagements/${eng}/notes`)
      .set(bearer(mx))
      .send({ body: 'Client prefers WhatsApp for approvals.', isPinned: true })
      .expect(201);
    await http()
      .post(`/api/v1/engagements/${eng}/notes`)
      .set(bearer(sy))
      .send({ body: 'Called the accountant.' })
      .expect(201);

    const feed = (t: string, qs = '') =>
      http().get(`/api/v1/engagements/${eng}/activity${qs}`).set(bearer(t));
    type Item = {
      id: string;
      kind: string;
      occurredAt: string;
      title: string;
      meta: Record<string, unknown>;
    };
    const all = (await feed(sy).expect(200)).body as { items: Item[]; nextCursor: string | null };
    const kinds = new Set(all.items.map((i) => i.kind));
    for (const k of ['task_event', 'document_uploaded', 'filing_lodged', 'comment'])
      expect(kinds).toContain(k);
    // Newest first.
    const times = all.items.map((i) => i.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);

    const filing = all.items.find((i) => i.kind === 'filing_lodged')!;
    expect(filing.title).toBe('GSTR-3B Sep 2026 filed — ARN AA1909261234567');
    expect(filing).toMatchObject({
      stream: 'gst',
      complianceInstanceId: inst,
      actorName: 'Senior Y',
    });
    const move = all.items.find((i) => i.kind === 'task_event' && i.meta.to === 'in_review')!;
    expect(move.title).toMatch(/In progress → In review$/);

    // Filters: stream, person, pinned comments.
    const gst = (await feed(sy, '?stream=gst').expect(200)).body.items as Array<{ stream: string }>;
    expect(gst.length).toBeGreaterThan(0);
    expect(gst.every((i) => i.stream === 'gst')).toBe(true);
    expect((await feed(sy, '?stream=roc').expect(200)).body.items).toHaveLength(0);
    const mxId = await employeeId('EMP005');
    const byMx = (await feed(sy, `?person=${mxId}`).expect(200)).body.items as Array<{
      actorId: string;
    }>;
    expect(byMx.length).toBeGreaterThan(0);
    expect(byMx.every((i) => i.actorId === mxId)).toBe(true);
    const pinned = (await feed(sy, '?pinned=true').expect(200)).body.items as Array<{
      title: string;
      isPinned: boolean;
    }>;
    expect(pinned).toEqual([
      expect.objectContaining({ title: 'Client prefers WhatsApp for approvals.', isPinned: true }),
    ]);
    await feed(sy, '?kind=bogus').expect(400);
    await feed(sy, '?cursor=not-a-cursor').expect(400);

    // Keyset paging: two at a time covers the same feed, no repeats.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const pg = (await feed(sy, qs).expect(200)).body as {
        items: Array<{ id: string }>;
        nextCursor: string | null;
      };
      seen.push(...pg.items.map((i) => i.id));
      cursor = pg.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.items.map((i) => i.id));

    // Documents tab filters: by filing section / year / stream, with slot links.
    const docs = (
      await http()
        .get(
          `/api/v1/engagements/${eng}/documents?section=summary&financialYear=2026-27&stream=gst`,
        )
        .set(bearer(sy))
        .expect(200)
    ).body.items as Array<{ slotCode: string; complianceInstanceId: string; periodKey: string }>;
    expect(docs.map((d) => d.slotCode).sort()).toEqual(['ACK_3B', 'CLIENT_APPROVAL']);
    expect(docs[0]).toMatchObject({ complianceInstanceId: inst, periodKey: '2026-09' });
    const none = await http()
      .get(`/api/v1/engagements/${eng}/documents?stream=roc`)
      .set(bearer(sy))
      .expect(200);
    expect(none.body.items).toHaveLength(0);
    // Time summary takes a date range (bill from time).
    const future = await http()
      .get(`/api/v1/engagements/${eng}/time/summary?by=stream&from=2099-01-01`)
      .set(bearer(sy))
      .expect(200);
    expect(future.body.rows).toHaveLength(0);
    await http()
      .get(`/api/v1/engagements/${eng}/time/summary?from=12-10-2026`)
      .set(bearer(sy))
      .expect(400);

    // Another engagement's partner sees nothing.
    const pb = await token('partner.b@dhvaj.in');
    await feed(pb).expect(404);
  });

  it('lays out the engagement tabs: kind, years, GST in scope with its lead, Overview widgets', async () => {
    const { eng, inst } = await setup();
    const tabs = (await http().get(`/api/v1/engagements/${eng}/tabs`).set(bearer(sy)).expect(200))
      .body as {
      kind: string;
      financialYears: string[];
      streams: Array<{ stream: string; financialYears: string[] }>;
      overview: {
        dueNext30: Array<{ instanceId: string; periodLabel: string }>;
        overdue: Array<{ instanceId: string }>;
        hoursThisMonth: number;
        unbilledAmount: number | null;
      };
    };
    expect(tabs.financialYears).toContain('2026-27');
    const gst = tabs.streams.find((s) => s.stream === 'gst');
    expect(gst?.financialYears).toContain('2026-27');
    const all = [...tabs.overview.dueNext30, ...tabs.overview.overdue].map((d) => d.instanceId);
    expect(all).toContain(inst);
    expect(typeof tabs.overview.hoursThisMonth).toBe('number');
    const pb = await token('partner.b@dhvaj.in');
    await http().get(`/api/v1/engagements/${eng}/tabs`).set(bearer(pb)).expect(404);
  });

  it('lets only a lead waive the filing, and shows nothing to another engagement', async () => {
    const { eng, inst } = await setup();
    const pb = await token('partner.b@dhvaj.in');
    await ws(pb, inst).expect(404);
    await http().get(`/api/v1/engagements/${eng}/streams/gst/tree`).set(bearer(pb)).expect(404);

    const na = await http()
      .post(`/api/v1/compliance-instances/${inst}/not-applicable`)
      .set(bearer(mx))
      .send({ reason: 'Registration cancelled' })
      .expect(201);
    expect(na.body.instance).toMatchObject({
      workflowStatus: 'not_applicable',
      notApplicableReason: 'Registration cancelled',
    });
    const lifted = await http()
      .post(`/api/v1/compliance-instances/${inst}/not-applicable/lift`)
      .set(bearer(mx))
      .expect(201);
    expect(lifted.body.instance.workflowStatus).toBe('not_started');
  });

  it('serves one filing under its engagement (WF-202): same workspace, 404 elsewhere or off the team', async () => {
    const { eng, inst } = await setup();
    const other = (await setup()).eng;
    const pb = await token('partner.b@dhvaj.in');
    const byId = (await ws(sy, inst).expect(200)).body;
    const scoped = await http()
      .get(`/api/v1/engagements/${eng}/filings/${inst}`)
      .set(bearer(sy))
      .expect(200);
    expect(scoped.body.instance).toEqual(byId.instance);
    expect(scoped.body.checklist.map((i: { id: string }) => i.id)).toEqual(
      byId.checklist.map((i: { id: string }) => i.id),
    );
    // Addressed under another engagement it is not found, never cross-linked.
    await http().get(`/api/v1/engagements/${other}/filings/${inst}`).set(bearer(sy)).expect(404);
    // RLS: a partner off the engagement sees nothing.
    await http().get(`/api/v1/engagements/${eng}/filings/${inst}`).set(bearer(pb)).expect(404);
    await http().get(`/api/v1/engagements/${eng}/filings/not-a-uuid`).set(bearer(sy)).expect(400);
  });

  it('builds the GST year tree: twelve months, sections, next action', async () => {
    const { eng, inst } = await setup();
    const tree = await http()
      .get(`/api/v1/engagements/${eng}/streams/gst/tree?fy=2026-27`)
      .set(bearer(sy))
      .expect(200);
    expect(tree.body.financialYear).toBe('2026-27');
    expect(tree.body.periods).toHaveLength(12);
    expect(tree.body.periods[0].periodKey).toBe('2026-04');
    const sep = tree.body.periods.find((p: { periodKey: string }) => p.periodKey === '2026-09');
    expect(sep.sections.summary[0]).toMatchObject({
      instanceId: inst,
      requiredTotal: 6,
      requiredDone: 0,
    });
    expect(sep.nextAction).toMatch(/^GSTR-3B (due|overdue)/);
    expect(tree.body.registrations).toHaveLength(1);
    // WF-203: the filing is Senior Y's to prepare — not the partner's.
    expect(sep.sections.summary[0].mine).toBe(true);
    const asPartner = await http()
      .get(`/api/v1/engagements/${eng}/streams/gst/tree?fy=2026-27`)
      .set(bearer(pa))
      .expect(200);
    const sepPa = asPartner.body.periods.find(
      (p: { periodKey: string }) => p.periodKey === '2026-09',
    );
    expect(sepPa.sections.summary[0].mine).toBe(false);
  });

  it('raises the monthly data request per filing, one item per required client-data slot', async () => {
    const { inst, reg, entityId } = await setup();
    await su.query(
      `UPDATE hsdg.compliance_instances SET section = 'outward', internal_sla_override = '2026-10-08'
        WHERE id = $1`,
      [inst],
    );
    await su.query(
      `INSERT INTO hsdg.registration_compliance_profiles (entity_id, registration_id, scope, effective_from, gst_scheme, attributes)
       VALUES ($1,$2,'gstin','2026-04-01','regular','{"monthlyDataRequest": true}')`,
      [entityId, reg],
    );
    const job = app.get(MonthlyDataRequestScheduler);
    const first = await job.run(new Date('2026-10-01T04:00:00Z'));
    expect(first).toMatchObject({ periodKey: '2026-09', failed: 0 });
    expect(first!.requested).toBeGreaterThanOrEqual(1);
    const dep = await su.query<{
      reminder_date: string;
      escalation_date: string;
      slot_code: string | null;
      period_section: string;
    }>(
      `SELECT reminder_date::text, escalation_date::text, slot_code, period_section
         FROM hsdg.client_dependencies WHERE compliance_instance_id = $1`,
      [inst],
    );
    // Outward asks for the sales register only (IRN / exports are profile-gated);
    // reminded T-7 and escalated T-3 against the internal date.
    expect(dep.rows).toEqual([
      {
        reminder_date: '2026-10-01',
        escalation_date: '2026-10-05',
        slot_code: 'SALES_REGISTER',
        period_section: 'outward',
      },
    ]);
    // The same day again asks nothing new.
    const again = await job.run(new Date('2026-10-01T06:00:00Z'));
    expect(again!.requested).toBe(0);
    expect(
      (
        await su.query(`SELECT 1 FROM hsdg.client_dependencies WHERE compliance_instance_id = $1`, [
          inst,
        ])
      ).rowCount,
    ).toBe(1);
    // The open request shows the filing as awaiting data.
    expect((await ws(sy, inst)).body.instance.workflowStatus).toBe('awaiting_data');
  });
});

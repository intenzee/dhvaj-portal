import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { FilingCleanupResult, StreamTree } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Removing old filings from the portal. "Remove this month" on a stream tab
 * (lead only) waives the period's open filings, cancels their open tasks and
 * waives their open client requests; Restore puts the filing and tasks back.
 * Start fresh (the Managing Partner only) does the same firm-wide for overdue
 * filings whose period ended before a date — previewed first, and never a
 * filing that is not yet due or already lodged.
 */
describe('Filing cleanup: remove a month, start fresh (e2e)', () => {
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
  const employeeId = async (code: string): Promise<string> =>
    (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = $1`, [
        code,
      ])
    ).rows[0]!.id;

  /** '2024-12-01' → '2024-25'. */
  const fyOf = (date: string): string => {
    const [y, m] = date.split('-').map(Number) as [number, number];
    const start = m >= 4 ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  };

  interface Filing {
    inst: string;
    task: string;
    dep: string;
  }

  /**
   * An engagement (partner A, manager X, Senior Y on the team) on a GSTIN with
   * one GSTR-3B per `periods` entry, each with its task and a pending client
   * request.
   */
  const setup = async (
    periods: Array<{ key: string; start: string; end: string; due: string }>,
  ): Promise<{ eng: string; reg: string; filings: Filing[] }> => {
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
          periodLabel: `FC${unique()}`,
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
    await su.query(
      `UPDATE hsdg.compliance_rule_versions SET stream = 'gst', section = 'summary', form_label = 'GSTR-3B'
        WHERE compliance_rule_id = $1`,
      [rule.body.id],
    );
    const gstin = `19AAAC${unique().slice(-9)}`.slice(0, 15).padEnd(15, 'Z');
    const reg = (
      await su.query<{ id: string }>(
        `INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code)
         VALUES ($1,'gstin',$2,'19') RETURNING id`,
        [entityId, gstin],
      )
    ).rows[0]!.id;

    const filings: Filing[] = [];
    for (const p of periods) {
      const inst = (
        await http()
          .post(`/api/v1/engagements/${eng}/compliance`)
          .set(bearer(pa))
          .send({ complianceRuleCode: code, referenceDate: p.end })
          .expect(201)
      ).body.id as string;
      await su.query(
        `UPDATE hsdg.compliance_instances
            SET registration_id = $2, section = 'summary', period_key = $3,
                period_start = $4, period_end = $5, statutory_deadline = $6, financial_year = $7
          WHERE id = $1`,
        [inst, reg, p.key, p.start, p.end, p.due, fyOf(p.start)],
      );
      const task = (
        await su.query<{ id: string }>(
          `UPDATE hsdg.tasks SET assigned_to_employee_id = $2, status = 'in_progress'
            WHERE source_compliance_instance_id = $1 RETURNING id`,
          [inst, await employeeId('EMP006')],
        )
      ).rows[0]!.id;
      const dep = (
        await su.query<{ id: string }>(
          `INSERT INTO hsdg.client_dependencies (engagement_id, compliance_instance_id, requested_info)
           VALUES ($1, $2, 'Sales register') RETURNING id`,
          [eng, inst],
        )
      ).rows[0]!.id;
      filings.push({ inst, task, dep });
    }
    return { eng, reg, filings };
  };

  const state = async (
    f: Filing,
  ): Promise<{ status: string; workflow: string; task: string; dep: string }> =>
    (
      await su.query(
        `SELECT ci.status, ci.workflow_status AS workflow, t.status AS task, d.status AS dep
           FROM hsdg.compliance_instances ci
           JOIN hsdg.tasks t ON t.id = $2
           JOIN hsdg.client_dependencies d ON d.id = $3
          WHERE ci.id = $1`,
        [f.inst, f.task, f.dep],
      )
    ).rows[0];

  const period = (t: string, eng: string, key: string, action: 'remove' | 'restore', reg: string) =>
    http()
      .post(`/api/v1/engagements/${eng}/streams/gst/periods/${key}/${action}`)
      .set(bearer(t))
      .send({ registrationId: reg });

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

  it('removes a month for the lead only, leaves other months, and restores it', async () => {
    const { eng, reg, filings } = await setup([
      { key: '2024-12', start: '2024-12-01', end: '2024-12-31', due: '2025-01-20' },
      { key: '2025-01', start: '2025-01-01', end: '2025-01-31', due: '2025-02-20' },
    ]);
    const [dec, jan] = filings as [Filing, Filing];

    await period(sy, eng, '2024-12', 'remove', reg).expect(403);

    const removed = (await period(mx, eng, '2024-12', 'remove', reg).expect(201))
      .body as FilingCleanupResult;
    expect(removed).toEqual({ filings: 1, tasks: 1, requests: 1 });
    expect(await state(dec)).toEqual({
      status: 'waived',
      workflow: 'not_applicable',
      task: 'cancelled',
      dep: 'waived',
    });
    expect(await state(jan)).toMatchObject({ status: 'open', task: 'in_progress', dep: 'pending' });

    // The stream tab no longer counts December overdue.
    const tree = (
      await http()
        .get(`/api/v1/engagements/${eng}/streams/gst/tree?registrationId=${reg}&fy=2024-25`)
        .set(bearer(mx))
        .expect(200)
    ).body as StreamTree;
    const decItems = tree.periods.find((p) => p.periodKey === '2024-12')?.sections.summary ?? [];
    expect(decItems.find((i) => i.instanceId === dec.inst)).toMatchObject({
      workflowStatus: 'not_applicable',
      isOverdue: false,
      removed: true,
    });

    // A second remove finds nothing left to do.
    expect((await period(mx, eng, '2024-12', 'remove', reg).expect(201)).body).toEqual({
      filings: 0,
      tasks: 0,
      requests: 0,
    });

    await period(sy, eng, '2024-12', 'restore', reg).expect(403);
    expect((await period(mx, eng, '2024-12', 'restore', reg).expect(201)).body).toEqual({
      filings: 1,
      tasks: 1,
      requests: 0,
    });
    const back = await state(dec);
    expect(back).toMatchObject({ status: 'open', task: 'in_progress', dep: 'waived' });
    expect(back.workflow).not.toBe('not_applicable');
    const notes = await su.query<{ notes: string | null }>(
      `SELECT notes FROM hsdg.compliance_instances WHERE id = $1`,
      [dec.inst],
    );
    expect(notes.rows[0]!.notes ?? '').not.toContain('[removed]');
  });

  it('starts fresh firm-wide for the Managing Partner: preview, then overdue old periods only', async () => {
    const { filings } = await setup([
      // Overdue, period before the cut-off: goes.
      { key: '2018-11', start: '2018-11-01', end: '2018-11-30', due: '2018-12-20' },
      // Period before the cut-off but not yet due: kept.
      { key: '2018-12', start: '2018-12-01', end: '2018-12-31', due: '2099-01-20' },
      // Period on/after the cut-off, overdue: kept.
      { key: '2019-01', start: '2019-01-01', end: '2019-01-31', due: '2019-02-20' },
    ]);
    const [old, notDue, after] = filings as [Filing, Filing, Filing];

    await http()
      .post('/api/v1/filings/start-fresh')
      .set(bearer(pa))
      .send({ from: '2019-01-01', dryRun: true })
      .expect(403);
    await http()
      .post('/api/v1/filings/start-fresh')
      .set(bearer(mp))
      .send({ from: 'Sept 2026' })
      .expect(400);

    const preview = (
      await http()
        .post('/api/v1/filings/start-fresh')
        .set(bearer(mp))
        .send({ from: '2019-01-01', dryRun: true })
        .expect(201)
    ).body as FilingCleanupResult;
    expect(preview).toMatchObject({ dryRun: true, from: '2019-01-01' });
    expect(preview.filings).toBeGreaterThanOrEqual(1);
    expect(preview.tasks).toBeGreaterThanOrEqual(1);
    expect(preview.requests).toBeGreaterThanOrEqual(1);
    expect(await state(old)).toMatchObject({ status: 'open', task: 'in_progress' });

    const done = (
      await http()
        .post('/api/v1/filings/start-fresh')
        .set(bearer(mp))
        .send({ from: '2019-01-01' })
        .expect(201)
    ).body as FilingCleanupResult;
    expect(done).toMatchObject({ dryRun: false, filings: preview.filings });
    expect(await state(old)).toEqual({
      status: 'waived',
      workflow: 'not_applicable',
      task: 'cancelled',
      dep: 'waived',
    });
    expect(await state(notDue)).toMatchObject({
      status: 'open',
      task: 'in_progress',
      dep: 'pending',
    });
    expect(await state(after)).toMatchObject({
      status: 'open',
      task: 'in_progress',
      dep: 'pending',
    });

    const audit = await su.query(
      `SELECT 1 FROM hsdg.audit_events WHERE action = 'filing.start_fresh' AND object_id = '2019-01-01'`,
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(1);
  });
});

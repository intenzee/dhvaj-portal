import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  TaxAuditBoard,
  TaxAuditMilestones,
  TodayView,
  WorkflowSettings,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * F-9 — tax audit milestones and the firm board. Internal dates are counted
 * back from the report's due date by the firm's offsets; a missed milestone
 * puts the audit on its owner's Today under Overdue and on the board as At
 * risk; a late audit shows its s.271B exposure.
 */
describe('Tax audit milestones and board (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: Record<string, string>;
  let pa: Record<string, string>;
  let pb: Record<string, string>;
  let mx: Record<string, string>;
  let sy: Record<string, string>;
  let eng: string;
  let auditId: string;
  let instanceId: string;
  const FY = '2026-27';
  const emp: Record<'a' | 'mx' | 'sy', string> = { a: '', mx: '', sy: '' };
  const http = () => request(app.getHttpServer());
  const base = () => `/api/v1/engagements/${eng}/tax-audits/${auditId}/milestones`;

  const as = async (email: string) => ({
    Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body.accessToken}`,
  });
  const istToday = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const shift = (date: string, days: number): string => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const view = async (who = pa) =>
    (await http().get(base()).set(who).expect(200)).body as TaxAuditMilestones;
  // Narrowed to the audit's engagement: other suites' overdue work would push
  // it past the group's limit on a shared database.
  const overdue = async (who: Record<string, string>) => {
    const v = (await http().get(`/api/v1/work/today?engagementId=${eng}`).set(who).expect(200))
      .body as TodayView;
    return v.groups.find((g) => g.group === 'overdue')!.items;
  };
  const setDue = (date: string) =>
    su.query(
      `UPDATE hsdg.compliance_instances SET statutory_deadline_override = $2 WHERE id = $1`,
      [instanceId, date],
    );

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await as('mp@dhvaj.in');
    pa = await as('partner.a@dhvaj.in');
    pb = await as('partner.b@dhvaj.in');
    mx = await as('manager.x@dhvaj.in');
    sy = await as('senior.y@dhvaj.in');
    const { rows } = await su.query<{ code: string; id: string }>(
      `SELECT employee_code AS code, id FROM hsdg.employees
        WHERE employee_code IN ('EMP003', 'EMP005', 'EMP006')`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.code, r.id]));
    emp.a = by.EMP003!;
    emp.mx = by.EMP005!;
    emp.sy = by.EMP006!;

    const acme = await http().get('/api/v1/entities?search=Acme&limit=10').set(mp).expect(200);
    const client = await freshClient(acme.body.items[0].id as string);
    await su.query(`UPDATE hsdg.entities SET annual_turnover = 25000000 WHERE id = $1`, [client]);
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          kind: 'compliance',
          entityId: client,
          status: 'accepted',
          financialYear: FY,
          streams: ['income_tax', 'tax_audit'],
          years: [{ financialYear: FY }],
        })
        .expect(201)
    ).body.id as string;
    // Partner A leads, Manager X manages, Senior Y is the team's in-charge.
    await su.query(
      `UPDATE hsdg.engagements SET engagement_partner_id = $2, engagement_manager_id = $3 WHERE id = $1`,
      [eng, emp.a, emp.mx],
    );
    await su.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
       VALUES ($1, $2, 'in_charge') ON CONFLICT (engagement_id, employee_id)
       DO UPDATE SET role_on_engagement = 'in_charge'`,
      [eng, emp.sy],
    );
    const audits = await http().get(`/api/v1/engagements/${eng}/tax-audits`).set(pa).expect(200);
    auditId = audits.body[0].id as string;
    instanceId = audits.body[0].instanceId as string;
    // Due in 20 days: everything up to clause work (30 days before) is missed.
    await setDue(shift(istToday(), 20));
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('counts each milestone back from the due date, with its owner by role', async () => {
    const v = await view();
    const due = shift(istToday(), 20);
    expect(v).toMatchObject({ stage: 'not_started', dueDate: due, canNameOwners: true });
    const m = Object.fromEntries(v.milestones.map((x) => [x.key, x]));
    expect(v.milestones.map((x) => x.key)).toEqual([
      'applicability',
      'accepted',
      'info_requests',
      'info_received',
      'clause_work',
      'review',
      'signed',
      'uploaded',
      'client_accepted',
    ]);
    expect(m.applicability).toMatchObject({
      dueOn: shift(due, -90),
      missed: true,
      role: 'manager',
      ownerId: emp.mx,
      ownerName: 'Manager X',
      canTick: false,
    });
    expect(m.accepted).toMatchObject({ dueOn: shift(due, -75), missed: true, ownerId: emp.a });
    expect(m.info_requests).toMatchObject({ missed: true, ownerId: emp.sy, canTick: true });
    expect(m.clause_work).toMatchObject({ dueOn: shift(due, -30), missed: true });
    expect(m.review).toMatchObject({ dueOn: shift(due, -15), missed: false });
  });

  it('puts the audit on each owner’s Today under Overdue, naming what they missed', async () => {
    const senior = (await overdue(sy)).find((i) => i.key === `tax_audit_milestone:${auditId}`);
    expect(senior).toMatchObject({
      kind: 'tax_audit_milestone',
      group: 'overdue',
      isOverdue: true,
      engagementId: eng,
      title: `Tax audit FY ${FY}: Information requests sent and 2 more`,
      taxAudit: {
        auditId,
        missed: ['Information requests sent', 'Client information received', 'Clause work done'],
      },
      link: { engagementId: eng, instanceId, stream: 'tax_audit' },
    });
    const manager = (await overdue(mx)).find((i) => i.key === `tax_audit_milestone:${auditId}`);
    expect(manager?.title).toBe(`Tax audit FY ${FY}: Applicability confirmed`);
    const partner = (await overdue(pa)).find((i) => i.key === `tax_audit_milestone:${auditId}`);
    expect(partner?.title).toBe(`Tax audit FY ${FY}: Accepted, appointment letter signed`);
  });

  it('lets the owner tick a milestone no desk moves yet, and refuses the rest', async () => {
    let v = (await http().put(`${base()}/info_requests`).set(sy).send({ done: true }).expect(200))
      .body as TaxAuditMilestones;
    const ticked = v.milestones.find((m) => m.key === 'info_requests')!;
    expect(ticked).toMatchObject({ done: true, missed: false, doneByName: 'Senior Y' });

    const signed = await http().put(`${base()}/signed`).set(pa).send({ done: true }).expect(400);
    expect(signed.body.message).toContain('follows its desk');
    // Someone outside the engagement does not reach it.
    const outsider = await http().put(`${base()}/info_received`).set(pb).send({ done: true });
    expect([403, 404]).toContain(outsider.status);
    // Only the partner or manager names an owner.
    const naming = await http()
      .put(`${base()}/clause_work`)
      .set(sy)
      .send({ ownerId: emp.mx })
      .expect(403);
    expect(naming.body.message).toContain('partner or manager');

    const senior = (await overdue(sy)).find((i) => i.key === `tax_audit_milestone:${auditId}`);
    expect(senior?.taxAudit?.missed).toEqual(['Client information received', 'Clause work done']);

    // Untick: missed again.
    v = (await http().put(`${base()}/info_requests`).set(sy).send({ done: false }).expect(200))
      .body as TaxAuditMilestones;
    expect(v.milestones.find((m) => m.key === 'info_requests')).toMatchObject({
      done: false,
      missed: true,
    });
  });

  it('moves a milestone to the person the manager names, and back', async () => {
    let v = (
      await http().put(`${base()}/clause_work`).set(mx).send({ ownerId: emp.mx }).expect(200)
    ).body as TaxAuditMilestones;
    expect(v.milestones.find((m) => m.key === 'clause_work')).toMatchObject({
      ownerId: emp.mx,
      ownerNamed: true,
    });
    const manager = (await overdue(mx)).find((i) => i.key === `tax_audit_milestone:${auditId}`);
    expect(manager?.taxAudit?.missed).toEqual(['Applicability confirmed', 'Clause work done']);
    const senior = (await overdue(sy)).find((i) => i.key === `tax_audit_milestone:${auditId}`);
    expect(senior?.taxAudit?.missed).not.toContain('Clause work done');

    v = (await http().put(`${base()}/clause_work`).set(mx).send({ ownerId: null }).expect(200))
      .body as TaxAuditMilestones;
    expect(v.milestones.find((m) => m.key === 'clause_work')).toMatchObject({
      ownerId: emp.sy,
      ownerNamed: false,
    });
  });

  it('takes the firm’s offsets from Workflow settings', async () => {
    const s = (await http().get('/api/v1/workflow-settings').set(mp).expect(200))
      .body as WorkflowSettings;
    expect(s.taxAuditMilestoneOffsets.review).toBe(15);
    const bad = await http()
      .patch('/api/v1/workflow-settings')
      .set(mp)
      .send({ version: s.version, taxAuditMilestoneOffsets: { review: 400 } })
      .expect(400);
    expect(bad.body.message).toContain('Review done');
    const next = (
      await http()
        .patch('/api/v1/workflow-settings')
        .set(mp)
        .send({ version: s.version, taxAuditMilestoneOffsets: { review: 25 } })
        .expect(200)
    ).body as WorkflowSettings;
    expect(next.taxAuditMilestoneOffsets).toMatchObject({ review: 25, signed: 7 });
    const v = await view();
    expect(v.milestones.find((m) => m.key === 'review')).toMatchObject({
      dueOn: shift(v.dueDate!, -25),
      missed: true,
    });
    await http()
      .patch('/api/v1/workflow-settings')
      .set(mp)
      .send({ version: next.version, taxAuditMilestoneOffsets: { review: 15 } })
      .expect(200);
  });

  it('shows Partners the board: stage counts, at-risk audits and partner load', async () => {
    const b = (await http().get(`/api/v1/tax-audits/board?financialYear=${FY}`).set(mp).expect(200))
      .body as TaxAuditBoard;
    expect(b.counts.not_started).toBeGreaterThanOrEqual(1);
    const row = b.atRisk.find((r) => r.auditId === auditId);
    expect(row).toMatchObject({
      engagementId: eng,
      stage: 'not_started',
      daysLate: null,
      exposure: null,
    });
    expect(row!.missed[0]).toMatchObject({ key: 'applicability', ownerName: 'Manager X' });
    expect(b.partners.find((p) => p.employeeId === emp.a)?.summary).toBe(
      `Partner A: 0 of ${b.limit} for FY ${FY}`,
    );
    await http().get(`/api/v1/tax-audits/board?financialYear=${FY}`).set(pa).expect(200);
    const refused = await http()
      .get(`/api/v1/tax-audits/board?financialYear=${FY}`)
      .set(mx)
      .expect(403);
    expect(refused.body.message).toContain('Managing Partner and Partners');
  });

  it('shows a late audit’s s.271B exposure: 0.5% of turnover, up to ₹1.5 lakh', async () => {
    await setDue(shift(istToday(), -3));
    try {
      const b = (
        await http().get(`/api/v1/tax-audits/board?financialYear=${FY}`).set(mp).expect(200)
      ).body as TaxAuditBoard;
      const row = b.atRisk.find((r) => r.auditId === auditId)!;
      expect(row).toMatchObject({ daysLate: 3, turnover: 25000000, exposure: 125000 });
      expect(b.totalExposure).toBeGreaterThanOrEqual(125000);
    } finally {
      await setDue(shift(istToday(), 20));
    }
  });
});

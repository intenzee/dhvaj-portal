import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { type StatutoryAuditFrameworkSummary, type StatutoryAuditPlanning } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { approveFrameworkForTest } from './framework-approval.helper';

/**
 * 02.8 Audit Framework Summary & Approval — end-to-end through the HTTP API:
 * the dashboard aggregation, AF-01 (submit / return to the source section),
 * the returned-item loop, AF-02 Engagement-Partner-only decisions (return,
 * approve, approve subject to conditions), the Section 03 lock, the single
 * Section 02 approval Planning reads, the immutable approval record and the
 * controlled reopen v1.0 → v1.1.
 *
 * 02.1–02.7 have their own suites; here their decided state is set directly
 * (superuser), so this suite tests 02.8 and nothing else.
 */
describe('Statutory Audit — 02.8 Framework Summary & Approval (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePeriod = (): string => `P${Date.now()}${Math.floor(Math.random() * 1000)}`;

  let mp: string; // firm-wide lead, NOT the Engagement Partner
  let pa: string; // the Engagement Partner
  let pb: string; // outsider
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  let engId: string;
  let shellId: string;
  const base = () => `/api/v1/engagements/${engId}/statutory-audit`;
  const get = (t: string, path: string) => request(app.getHttpServer()).get(path).set(bearer(t));
  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set(bearer(t)).send(body);

  const getSummary = async (t: string = pa): Promise<StatutoryAuditFrameworkSummary> => {
    const res = await get(t, `${base()}/framework-summary`).expect(200);
    return res.body[0] as StatutoryAuditFrameworkSummary;
  };
  const getPlanning = async (): Promise<StatutoryAuditPlanning> =>
    (await get(pa, `${base()}/planning`).expect(200)).body[0] as StatutoryAuditPlanning;

  const su = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  /** 02.1 confirmed, 02.2–02.7 and every other Phase-02 area decided. */
  const decideSection02 = (wf: string = shellId) =>
    su(async (c) => {
      const shellId = wf;
      await c.query(
        `UPDATE hsdg.audit_entity_profile SET state = 'confirmed', confirmed_at = now(),
                needs_reevaluation = false
          WHERE workflow_instance_id = $1`,
        [shellId],
      );
      // 02.2 counts as decided once COMPLETE (its own suite); approved stands in here.
      await c.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET state = CASE WHEN sub_section_key = '02.2' THEN 'approved'
                             ELSE 'not_applicable' END,
                conclusion = COALESCE(conclusion, system_outcome, 'not_applicable'),
                needs_reevaluation = false, decided_at = now()
          WHERE workflow_instance_id = $1`,
        [shellId],
      );
      await c.query(
        `UPDATE hsdg.audit_framework_assessments
            SET state = 'not_applicable', conclusion = 'not_applicable', decided_at = now()
          WHERE workflow_instance_id = $1`,
        [shellId],
      );
      // Framework matters raised from the seeded facts are not this suite's concern.
      await c.query(
        `UPDATE hsdg.audit_matter SET status = 'resolved', resolution = 'e2e'
          WHERE workflow_instance_id = $1 AND status <> 'resolved'`,
        [shellId],
      );
    });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');

    ({ engId, shellId } = await newFile());
  });

  /** A fresh audit file on its own engagement, Partner A its Engagement Partner (AF-02 is EP-only). */
  const newFile = async (): Promise<{ engId: string; shellId: string }> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const created = await post(pa, '/api/v1/engagements', {
      entityId,
      serviceId: primaryServiceId,
      financialYear: '2024-25',
      periodLabel: uniquePeriod(),
      status: 'accepted',
    }).expect(201);
    const eng = created.body.id as string;
    await post(pa, `/api/v1/engagements/${eng}/services`, { serviceId: statAuditId }).expect(201);
    const wf = (await get(pa, `/api/v1/engagements/${eng}/statutory-audit`).expect(200)).body[0]
      .workflowInstanceId as string;
    await su((c) =>
      c.query(
        `UPDATE hsdg.engagements SET engagement_partner_id =
           (SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id
             WHERE u.email = 'partner.a@dhvaj.in')
          WHERE id = $1`,
        [eng],
      ),
    );
    return { engId: eng, shellId: wf };
  };

  afterAll(async () => {
    await app?.close();
  });

  it('aggregates 02.1, the six sub-sections and the other areas; AF-01 is blocked', async () => {
    const s = await getSummary();
    expect(s.sections.map((x) => x.subSectionKey)).toEqual([
      '02.2',
      '02.3',
      '02.4',
      '02.5',
      '02.6',
      '02.7',
    ]);
    expect(s.dashboard.map((r) => r.section)).toEqual([
      '02.1',
      '02.2',
      '02.3',
      '02.4',
      '02.5',
      '02.6',
      '02.7',
      'other_areas',
    ]);
    expect(s.gates.checks).toHaveLength(10);
    expect(s.gates.canConfirm).toBe(false);
    expect(s.gates.confirmBlockers.join(' ')).toMatch(/Complete the source sections/);
    expect(s.baseline).toBeNull();
    expect(s.planning).toMatchObject({ unlocked: false, route: 'locked' });
    expect(s.header.periodLabel).toMatch(/FY 2024-25/);
    expect(s.header.viewerIsPartner).toBe(true);

    await post(pa, `${base()}/${shellId}/framework-summary/confirm`, {
      decision: 'submit_for_partner_approval',
      previewReviewed: true,
      recordVersion: 0,
    }).expect(400);
  });

  it('Section 03 is locked and the legacy Phase-02 approve is retired', async () => {
    const planning = await getPlanning();
    expect(planning.frameworkApproved).toBe(false);
    expect(planning.frameworkGate.unlocked).toBe(false);
    const item = planning.items[0]!;
    const res = await post(pa, `/api/v1/engagements/${engId}/statutory-audit/planning/${item.id}`, {
      state: 'in_progress',
      version: item.version,
    }).expect(409);
    expect(res.body.message).toMatch(/Engagement Partner approves the Audit Framework/);
    await post(pa, `${base()}/${shellId}/framework/approve`, { memo: 'x' }).expect(409);
  });

  it('AF-01 "No" returns the named section; the item blocks AF-01 until cleared', async () => {
    await decideSection02();
    let s = await getSummary();
    expect(s.gates.allSectionsDecided).toBe(true);
    expect(s.gates.canConfirm).toBe(true);
    expect(s.header.status).toBe('ready_for_manager_review');

    await post(pa, `${base()}/${shellId}/framework-summary/confirm`, {
      decision: 'further_work_required',
      recordVersion: 0,
    }).expect(400);
    s = (
      await post(pa, `${base()}/${shellId}/framework-summary/confirm`, {
        decision: 'further_work_required',
        returnItems: [{ section: '02.4', action: 'Re-check clause (vii) dues' }],
        note: 'One CARO point',
        recordVersion: 0,
      }).expect(201)
    ).body as StatutoryAuditFrameworkSummary;
    expect(s.baseline).toMatchObject({
      version: '1.0',
      status: 'draft',
      managerNote: 'One CARO point',
    });
    expect(s.returns).toHaveLength(1);
    expect(s.gates.openReturnCount).toBe(1);
    expect(s.gates.canConfirm).toBe(false);
    expect(s.dashboard.find((r) => r.section === '02.4')!.attention).toContain(
      'Returned (AF-01): Re-check clause (vii) dues',
    );

    // An outsider cannot clear it; a lead can.
    await post(pb, `${base()}/framework-summary/returns/${s.returns[0]!.id}/resolve`, {
      resolution: 'x',
    }).expect(404);
    s = (
      await post(pa, `${base()}/framework-summary/returns/${s.returns[0]!.id}/resolve`, {
        resolution: 'Dues reconciled in 02.4',
      }).expect(201)
    ).body;
    expect(s.returns[0]).toMatchObject({
      status: 'resolved',
      resolution: 'Dues reconciled in 02.4',
    });
    expect(s.gates.canConfirm).toBe(true);
  });

  it('AF-01 "Yes" needs the reviewed preview and a fresh record version', async () => {
    const before = await getSummary();
    await post(pa, `${base()}/${shellId}/framework-summary/confirm`, {
      decision: 'submit_for_partner_approval',
      recordVersion: before.recordVersion,
    }).expect(400);
    await post(pa, `${base()}/${shellId}/framework-summary/confirm`, {
      decision: 'submit_for_partner_approval',
      previewReviewed: true,
      recordVersion: before.recordVersion - 1,
    }).expect(409);
    const s = (
      await post(mp, `${base()}/${shellId}/framework-summary/confirm`, {
        decision: 'submit_for_partner_approval',
        previewReviewed: true,
        note: 'Reviewed with the team',
        recordVersion: before.recordVersion,
      }).expect(201)
    ).body as StatutoryAuditFrameworkSummary;
    expect(s.baseline).toMatchObject({
      status: 'manager_confirmed',
      managerNote: 'Reviewed with the team',
    });
    expect(s.baseline!.previewReviewedAt).not.toBeNull();
    expect(s.header.status).toBe('partner_review');
    expect(s.gates.canCreateMemo).toBe(true);
    expect(s.gates.checks.find((c) => c.key === 'manager_confirmed')!.met).toBe(true);
  });

  it('AF-02 is Engagement-Partner-only and needs the submitted memorandum', async () => {
    const s = await getSummary();
    // Managing Partner is a lead but not the EP.
    await post(mp, `${base()}/${shellId}/framework-summary/approve`, {
      decision: 'approve',
      recordVersion: s.recordVersion,
    }).expect(403);
    const viewedByMp = await getSummary(mp);
    expect(viewedByMp.gates.approveBlockers).toContain(
      'Only the Engagement Partner can record AF-02.',
    );
    if (!s.memo || s.memo.status !== 'submitted') {
      await post(pa, `${base()}/${shellId}/framework-summary/approve`, {
        decision: 'approve',
        recordVersion: s.recordVersion,
      }).expect(400);
    }
    // Conditions are validated before anything is written.
    await post(pa, `${base()}/${shellId}/framework-summary/approve`, {
      decision: 'approve_subject_to_conditions',
      conditions: [],
      recordVersion: s.recordVersion,
    }).expect(400);
  });

  it('AF-02 "Return for Further Work" sends the framework back to draft with the reason', async () => {
    const before = await getSummary();
    await post(pa, `${base()}/${shellId}/framework-summary/approve`, {
      decision: 'return_for_further_work',
      returnReason: 'Explain the ICFR scoping',
      recordVersion: before.recordVersion,
    }).expect(400);
    const s = (
      await post(pa, `${base()}/${shellId}/framework-summary/approve`, {
        decision: 'return_for_further_work',
        returnReason: 'Explain the ICFR scoping',
        returnSections: ['02.5'],
        recordVersion: before.recordVersion,
      }).expect(201)
    ).body as StatutoryAuditFrameworkSummary;
    expect(s.baseline).toMatchObject({ status: 'draft', managerConfirmedAt: null });
    const open = s.returns.filter((r) => r.status === 'open');
    expect(open).toEqual([
      expect.objectContaining({
        gate: 'AF-02',
        section: '02.5',
        action: 'Explain the ICFR scoping',
      }),
    ]);
    expect(s.gates.canConfirm).toBe(false);
    await post(pa, `${base()}/framework-summary/returns/${open[0]!.id}/resolve`, {
      resolution: 'ICFR scoping memo added in 02.5',
    }).expect(201);
  });

  it('an outsider cannot read or drive 02.8', async () => {
    const res = await get(pb, `${base()}/framework-summary`).expect(200);
    expect(res.body).toHaveLength(0);
    await post(pb, `${base()}/${shellId}/framework-summary/confirm`, {
      decision: 'submit_for_partner_approval',
      previewReviewed: true,
      recordVersion: 0,
    }).expect(404);
  });
  describe('an approved baseline', () => {
    let eng2: string;
    let wf2: string;
    const base2 = () => `/api/v1/engagements/${eng2}/statutory-audit`;
    const summary2 = async (): Promise<StatutoryAuditFrameworkSummary> =>
      (await get(pa, `${base2()}/framework-summary`).expect(200))
        .body[0] as StatutoryAuditFrameworkSummary;

    beforeAll(async () => {
      ({ engId: eng2, shellId: wf2 } = await newFile());
      // Prefill/seed the sections first, then decide and approve them.
      await get(pa, `${base2()}/framework-summary`).expect(200);
      await decideSection02(wf2);
      await approveFrameworkForTest(wf2);
    });

    it('is approved, opens Planning, and cannot be changed in place', async () => {
      const s = await summary2();
      expect(s.baseline).toMatchObject({ version: '1.0', status: 'approved' });
      expect(s.header.status).toBe('approved');
      expect(s.planning).toMatchObject({ unlocked: true, route: 'approved' });
      expect(s.gates.canReopen).toBe(true);
      const planning = (await get(pa, `${base2()}/planning`).expect(200))
        .body[0] as StatutoryAuditPlanning;
      expect(planning.frameworkApproved).toBe(true);
      expect(planning.frameworkGate.unlocked).toBe(true);

      // §14: the approved row is immutable — even to a direct UPDATE.
      await expect(
        su((c) =>
          c.query(`UPDATE hsdg.audit_framework_baseline SET snapshot = '{}'::jsonb WHERE id = $1`, [
            s.baseline!.id,
          ]),
        ),
      ).rejects.toThrow(/immutable|preserved/);
    });

    it('02.1 is never reopened in place while the framework is approved (§14)', async () => {
      const res = await post(pa, `${base2()}/${wf2}/profile/reopen`, {
        reason: 'Turnover corrected after approval',
      }).expect(409);
      expect(res.body.message).toMatch(/Controlled Reopen/);
      expect((await summary2()).baseline).toMatchObject({ version: '1.0', status: 'approved' });
    });

    it('reopens v1.0 → draft v1.1 with the §15 fields, flagging only the affected sections', async () => {
      const before = await summary2();
      // The evidence must be this engagement's document; the identifier a real person.
      const { evidenceId, foreignId, ravi } = await su(async (c) => {
        const doc = (sql: string, id: string) =>
          c.query<{ id: string }>(sql, [id]).then((r) => r.rows[0]!.id);
        const ins = `INSERT INTO hsdg.documents (engagement_id, title) VALUES ($1, 'NSE intimation') RETURNING id`;
        return {
          evidenceId: await doc(ins, eng2),
          foreignId: await doc(ins, engId),
          ravi: (
            await c.query<{ id: string }>(
              `SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id
                WHERE u.email = 'mp@dhvaj.in'`,
            )
          ).rows[0]!.id,
        };
      });
      const valid = {
        reason: 'Debt listed after approval',
        affectedSections: ['02.4'],
        identifiedAt: new Date().toISOString(),
        reapprovalRequired: true,
        recordVersion: before.recordVersion,
      };
      await post(pa, `${base2()}/${wf2}/framework-summary/reopen`, {
        ...valid,
        evidenceDocumentId: foreignId,
      }).expect(400);
      await post(pa, `${base2()}/${wf2}/framework-summary/reopen`, {
        ...valid,
        identifiedByEmployeeId: '00000000-0000-4000-8000-000000000000',
      }).expect(400);
      // Every §15 field is mandatory; an outsider and a stale version are refused.
      await post(pa, `${base2()}/${wf2}/framework-summary/reopen`, {
        reason: 'Debt listed after approval',
        affectedSections: [],
        identifiedAt: new Date().toISOString(),
        reapprovalRequired: true,
        recordVersion: before.recordVersion,
      }).expect(400);
      await post(pb, `${base2()}/${wf2}/framework-summary/reopen`, {
        reason: 'x',
        affectedSections: ['02.4'],
        identifiedAt: new Date().toISOString(),
        reapprovalRequired: true,
        recordVersion: before.recordVersion,
      }).expect(404);
      await post(pa, `${base2()}/${wf2}/framework-summary/reopen`, {
        reason: 'Debt listed after approval',
        affectedSections: ['02.4'],
        identifiedAt: new Date().toISOString(),
        reapprovalRequired: true,
        recordVersion: before.recordVersion + 1,
      }).expect(409);
      const s = (
        await post(pa, `${base2()}/${wf2}/framework-summary/reopen`, {
          reason: 'Debt listed after approval',
          affectedSections: ['02.4'],
          identifiedAt: new Date().toISOString(),
          identifiedByEmployeeId: ravi,
          evidenceNote: 'Stock exchange intimation dated 12 Sep',
          evidenceDocumentId: evidenceId,
          reapprovalRequired: true,
          recordVersion: before.recordVersion,
        }).expect(201)
      ).body as StatutoryAuditFrameworkSummary;
      expect(s.baseline).toMatchObject({ version: '1.1', status: 'draft' });
      expect(s.baseline!.reopen).toMatchObject({
        reason: 'Debt listed after approval',
        affectedSections: ['02.4'],
        fromVersion: '1.0',
        reapprovalRequired: true,
        evidenceDocumentId: evidenceId,
      });
      expect(s.baseline!.reopen!.identifiedByName).toBeTruthy();
      expect(s.header.status).toBe('reopened');
      expect(s.history.map((b) => [b.version, b.status])).toEqual([
        ['1.1', 'draft'],
        ['1.0', 'superseded'],
      ]);
      // Only 02.4 goes back for re-evaluation; 02.5 stays as it was.
      const subs = await su(
        async (c) =>
          (
            await c.query<{ k: string; re: boolean }>(
              `SELECT sub_section_key AS k, needs_reevaluation AS re
                 FROM hsdg.audit_framework_subassessment WHERE workflow_instance_id = $1`,
              [wf2],
            )
          ).rows,
      );
      expect(subs.find((r) => r.k === '02.4')!.re).toBe(true);
      expect(subs.find((r) => r.k === '02.5')!.re).toBe(false);

      // Planning keeps going on the approved v1.0, but cannot be approved, and no new
      // work is generated, until the revision is re-approved.
      const planning = (await get(pa, `${base2()}/planning`).expect(200))
        .body[0] as StatutoryAuditPlanning;
      expect(planning.frameworkReopened).toBe(true);
      expect(planning.frameworkGate.unlocked).toBe(true);
      const gen = await post(pa, `${base2()}/${wf2}/work-areas/generate`).expect(409);
      expect(gen.body.message).toMatch(/controlled revision/);
      // Reopening again needs an approved baseline.
      await post(pa, `${base2()}/${wf2}/framework-summary/reopen`, {
        reason: 'Again',
        affectedSections: ['02.4'],
        identifiedAt: new Date().toISOString(),
        reapprovalRequired: true,
        recordVersion: s.recordVersion,
      }).expect(400);
    });

    it('a Section 08 reassessment with framework impact reopens the next approved version', async () => {
      // Re-approve (stands in for AF-01 → AF-02 of v1.1), then a new subsidiary arrives.
      await decideSection02(wf2);
      await approveFrameworkForTest(wf2);
      expect((await summary2()).baseline).toMatchObject({ status: 'approved' });
      const res = await post(pa, `${base2()}/${wf2}/reassessments`, {
        changeType: 'new_subsidiary',
        reason: 'Acquired a subsidiary in Q4',
      }).expect(201);
      expect(JSON.stringify(res.body)).toMatch(/audit framework v1\.\d → draft v1\.\d/);
      const s = await summary2();
      expect(s.baseline).toMatchObject({ status: 'draft' });
      expect(s.baseline!.reopen!.reason).toBe(
        'Section 08 reassessment: Acquired a subsidiary in Q4',
      );
      expect(s.header.status).toBe('reopened');
    });

    it('a client-master change after approval opens the next version, never a silent edit', async () => {
      await decideSection02(wf2);
      await approveFrameworkForTest(wf2);
      const approvedVersion = (await summary2()).baseline!.version;
      // The confirmed 02.1 snapshot recorded a different financial year than the master now has.
      await su((c) =>
        c.query(
          `UPDATE hsdg.audit_entity_profile
              SET snapshot = jsonb_set(COALESCE(snapshot, '{}'::jsonb), '{tracked}',
                                       '{"period": "FY 1999-00"}'::jsonb)
            WHERE workflow_instance_id = $1`,
          [wf2],
        ),
      );
      await get(pa, `${base2()}/profile`).expect(200);
      const s = await summary2();
      expect(s.baseline).toMatchObject({ status: 'draft' });
      expect(s.baseline!.reopen).toMatchObject({
        fromVersion: approvedVersion,
        reapprovalRequired: true,
      });
      expect(s.baseline!.reopen!.reason).toMatch(
        /^Client master changed after framework approval: Financial year/,
      );
      expect(s.baseline!.reopen!.affectedSections).toContain('02.1');
      // The 02.1 profile is flagged through the reopen (not edited in place).
      const flagged = await su(
        async (c) =>
          (
            await c.query<{ re: boolean }>(
              `SELECT needs_reevaluation AS re FROM hsdg.audit_entity_profile
                WHERE workflow_instance_id = $1`,
              [wf2],
            )
          ).rows[0]!.re,
      );
      expect(flagged).toBe(true);
    });
  });
  describe('AF-02 "Approve Subject to Conditions"', () => {
    let eng3: string;
    let wf3: string;
    const base3 = () => `/api/v1/engagements/${eng3}/statutory-audit`;
    const summary3 = async (): Promise<StatutoryAuditFrameworkSummary> =>
      (await get(pa, `${base3()}/framework-summary`).expect(200))
        .body[0] as StatutoryAuditFrameworkSummary;
    const planning3 = async (): Promise<StatutoryAuditPlanning> =>
      (await get(pa, `${base3()}/planning`).expect(200)).body[0] as StatutoryAuditPlanning;
    /** 03.1's state, read past RLS: when it was generated and how many signals it holds. */
    const intelligence3 = () =>
      su(async (c) => {
        const { rows } = await c.query<{ generated: Date | null; signals: number }>(
          `SELECT (SELECT intelligence_generated_at FROM hsdg.audit_planning_intelligence
                    WHERE workflow_instance_id = $1) AS generated,
                  (SELECT count(*)::int FROM hsdg.audit_planning_signal
                    WHERE workflow_instance_id = $1) AS signals`,
          [wf3],
        );
        return rows[0]!;
      });

    beforeAll(async () => {
      ({ engId: eng3, shellId: wf3 } = await newFile());
      await get(pa, `${base3()}/framework-summary`).expect(200);
      await decideSection02(wf3);
      // AF-01 for real; the memorandum (its own suite drafts it from the template) is
      // placed submitted, so AF-02 is open to the Engagement Partner.
      const s = await summary3();
      const confirmed = (
        await post(pa, `${base3()}/${wf3}/framework-summary/confirm`, {
          decision: 'submit_for_partner_approval',
          previewReviewed: true,
          recordVersion: s.recordVersion,
        }).expect(201)
      ).body as StatutoryAuditFrameworkSummary;
      await su(async (c) => {
        const { rows: doc } = await c.query<{ id: string }>(
          `INSERT INTO hsdg.documents (engagement_id, title)
           VALUES ($1, 'Audit Framework Memorandum v1.0') RETURNING id`,
          [eng3],
        );
        await c.query(
          `INSERT INTO hsdg.audit_framework_memo
             (baseline_id, workflow_instance_id, engagement_id, baseline_version, document_id,
              status, submitted_at)
           VALUES ($1, $2, $3, '1.0', $4, 'submitted', now())`,
          [confirmed.baseline!.id, wf3, eng3, doc[0]!.id],
        );
      });
    });

    it('a condition that bars Planning keeps Section 03 locked until it is resolved', async () => {
      const before = await summary3();
      expect(before.gates.canApprove).toBe(true);
      const s = (
        await post(pa, `${base3()}/${wf3}/framework-summary/approve`, {
          decision: 'approve_subject_to_conditions',
          conditions: [
            {
              condition: 'Obtain the bank sanction letter',
              dueDate: '2026-11-30',
              impact: 'CARO 3(ii)(b) quarterly returns',
              planningMayCommence: false,
            },
          ],
          recordVersion: before.recordVersion,
        }).expect(201)
      ).body as StatutoryAuditFrameworkSummary;
      expect(s.baseline).toMatchObject({
        status: 'approved',
        epDecision: 'approve_subject_to_conditions',
      });
      expect(s.memo).toMatchObject({ status: 'approved' });
      expect(s.approval).toMatchObject({
        decision: 'approve_subject_to_conditions',
        baselineVersion: '1.0',
      });
      expect(s.approval!.conditions).toEqual([
        expect.objectContaining({ status: 'open', planningMayCommence: false }),
      ]);
      expect(s.planning).toMatchObject({ unlocked: false, route: 'locked' });
      // 03.1 §22: nothing is derived while Section 03 is locked.
      expect(await intelligence3()).toEqual({ generated: null, signals: 0 });

      // Section 03 stays locked: a write is refused with the condition's reason.
      let planning = await planning3();
      expect(planning.frameworkGate.unlocked).toBe(false);
      const item = planning.items[0]!;
      const refused = await post(pa, `${base3()}/planning/${item.id}`, {
        state: 'in_progress',
        version: item.version,
      }).expect(409);
      expect(refused.body.message).toMatch(/condition/);

      // An outsider cannot resolve it; the Engagement Partner can.
      const conditionId = s.approval!.conditions[0]!.id;
      await post(pb, `${base3()}/framework-summary/conditions/${conditionId}/resolve`, {
        resolution: 'x',
      }).expect(404);
      const after = (
        await post(pa, `${base3()}/framework-summary/conditions/${conditionId}/resolve`, {
          resolution: 'Sanction letter on file',
        }).expect(201)
      ).body as StatutoryAuditFrameworkSummary;
      expect(after.approval!.conditions[0]).toMatchObject({
        status: 'resolved',
        resolution: 'Sanction letter on file',
      });
      expect(after.planning).toMatchObject({ unlocked: true, route: 'conditional' });
      // 03.1 §22: the decision that opened Section 03 derived the Engagement
      // Intelligence, so whoever opens 03.1 first finds it ready.
      const ready = await intelligence3();
      expect(ready.generated).not.toBeNull();
      // … and it is complete: the Manager's open finds nothing to re-derive.
      await get(pa, `${base3()}/${wf3}/planning-intelligence`).expect(200);
      expect(await intelligence3()).toEqual(ready);

      planning = await planning3();
      expect(planning.frameworkApproved).toBe(true);
      // Re-read: deriving 03.1 above moved its planning row on.
      const fresh = planning.items.find((i) => i.id === item.id)!;
      await post(pa, `${base3()}/planning/${item.id}`, {
        state: 'in_progress',
        version: fresh.version,
      }).expect(201);
    });
  });
});

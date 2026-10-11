import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import type {
  PlanningCompletionCheck,
  PlanningEvidenceView,
  PlanningGovernanceView,
  PlanningSignalRecord,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { approveFrameworkForTest } from './framework-approval.helper';

/**
 * 03.1 governance & dynamics (DHVAJ 03.1 §10, §16, §18–§20, §23, §24):
 *   B1 the §23 role matrix on the API (Senior proposes / records facts; the
 *      Manager assesses and completes; the EP reviews; admin has no access);
 *   B2 the EP's Immediate Partner Attention queue (surface / challenge /
 *      respond / acknowledge / flag) and the real §20 "surfaced to the EP" check;
 *   B3 the Manager alert for every new Enhanced / Immediate signal;
 *   B4 AS-01 orientation and Area-of-Focus changes flag downstream planning;
 *   B5 the controlled revision of 03.1 after 03.12 approval (v1.0 → v1.1);
 *   B6 SharePoint-backed evidence on 03.1 records;
 *   B7 discussion actions and "Create Planning Signal" in the discussion.
 */
describe('Statutory Audit — 03.1 governance & dynamics (e2e)', () => {
  let app: INestApplication;
  let pa: string; // Engagement Partner
  let mx: string; // Engagement Manager
  let sy: string; // Senior (engagement team)
  let admin: string;
  let su: Client;
  let ids: Map<string, string>;
  let engId: string;
  let shellId: string;
  let base: string; // …/statutory-audit/:shellId
  let eng: string; // …/engagements/:engId/statutory-audit

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(url).set(bearer(t)).send(body);
  const get = (t: string, url: string) => request(app.getHttpServer()).get(url).set(bearer(t));
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const findId = async (path: string): Promise<string> =>
    (await get(pa, path).expect(200)).body.items[0].id as string;

  const governance = async (t: string): Promise<PlanningGovernanceView> =>
    (await get(t, `${base}/planning-governance`).expect(200)).body as PlanningGovernanceView;
  const signals = async (): Promise<PlanningSignalRecord[]> =>
    (await get(mx, `${base}/planning-signals`).expect(200)).body as PlanningSignalRecord[];
  const completion = async (): Promise<PlanningCompletionCheck[]> =>
    (await get(mx, `${base}/planning-intelligence`).expect(200)).body
      .completion as PlanningCompletionCheck[];
  const notes = async (email: string, type: string): Promise<string[]> => {
    const { rows } = await su.query<{ title: string }>(
      `SELECT n.title FROM hsdg.notifications n JOIN hsdg.users u ON u.id = n.recipient_user_id
        WHERE u.email = $1 AND n.type = $2 AND n.engagement_id = $3 ORDER BY n.created_at`,
      [email, type, engId],
    );
    return rows.map((r) => r.title);
  };
  const itemState = async (key: string): Promise<string> =>
    (
      await su.query<{ state: string }>(
        `SELECT state FROM hsdg.audit_planning_items WHERE workflow_instance_id = $1 AND item_key = $2`,
        [shellId, key],
      )
    ).rows[0]!.state;
  const setItems = (keys: string[], state: string) =>
    su.query(
      `UPDATE hsdg.audit_planning_items SET state = $3
        WHERE workflow_instance_id = $1 AND item_key = ANY($2::text[])`,
      [shellId, keys, state],
    );

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    admin = await token('admin@dhvaj.in');
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    const { rows } = await su.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM hsdg.employees
        WHERE full_name IN ('Manager X', 'Senior Y', 'Partner B')`,
    );
    ids = new Map(rows.map((r) => [r.full_name, r.id]));

    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Planning Governance ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const e = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: itr,
      financialYear: '2024-25',
      periodLabel: `P${stamp()}`,
      status: 'accepted',
      engagementManagerEmployeeId: ids.get('Manager X'),
    }).expect(201);
    engId = e.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    await post(pa, `/api/v1/engagements/${engId}/team`, {
      employeeId: ids.get('Senior Y'),
      roleOnEngagement: 'in_charge',
    }).expect(201);
    eng = `/api/v1/engagements/${engId}/statutory-audit`;
    shellId = (await get(pa, eng).expect(200)).body[0].workflowInstanceId as string;
    base = `${eng}/${shellId}`;
    await approveFrameworkForTest(shellId);
    // The Manager opens 03.1 first: the intelligence generates itself.
    await get(mx, `${base}/planning-intelligence`).expect(200);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('B1 — enforces the §23 role matrix on the engagement assignment', async () => {
    const team = await governance(sy);
    expect(team.access.role).toBe('team');
    expect(team.access.employeeId).toBe(ids.get('Senior Y'));
    expect(team.access.capabilities).toMatchObject({
      proposeSignals: true,
      addFacts: true,
      assess: false,
      focusAreas: false,
      partnerReview: false,
    });
    expect((await governance(mx)).access).toMatchObject({
      role: 'manager',
      actingAsManager: false,
    });
    const ep = (await governance(pa)).access;
    expect(ep).toMatchObject({ role: 'partner', actingAsManager: false });
    expect(ep.capabilities).toMatchObject({
      assess: false,
      partnerReview: true,
      partnerSignals: true,
    });
    // Platform Admin: no client data by role alone.
    await get(admin, `${base}/planning-governance`).expect(403);

    // A Senior's signal is a PROPOSAL the Manager assesses.
    const proposal = await post(sy, `${base}/planning-signals`, {
      source: 'manager',
      observation: 'Client mentioned a new export market in the kick-off call.',
      suggestedAttention: 'enhanced',
    }).expect(201);
    const pid = proposal.body.id as string;
    expect(proposal.body.managerAssessment).toBeNull();
    expect((await governance(mx)).proposals[pid]?.proposedByName).toBe('Senior Y');
    await post(sy, `${base}/planning-signals`, {
      source: 'partner',
      observation: 'Not mine to raise',
    }).expect(403);

    // Facts: the team records them; strategy and assessment are not theirs.
    await post(sy, `${base}/planning-changes`, {
      category: 'key_management',
      description: 'New CFO appointed in June.',
    }).expect(201);
    await post(sy, `${base}/planning-changes`, {
      category: 'key_management',
      description: 'And make it a signal',
      createSignal: true,
    }).expect(403);
    await post(sy, `${base}/prior-year-matters`, {
      matterType: 'control_deficiency',
      description: 'PY: weak access review on the ERP.',
    }).expect(201);
    await post(sy, `${base}/areas-of-focus`, { name: 'Not allowed' }).expect(403);
    // The team reads all of 03.1 (no record is created on their read).
    for (const path of [
      'planning-signals',
      'planning-changes',
      'planning-considerations',
      'prior-year-matters',
      'planning-discussion',
      'planning-matters',
      'areas-of-focus',
      'acceptance-carry-forward',
    ]) {
      await get(sy, `${base}/${path}`).expect(200);
    }
    const rec = (await get(sy, `${base}/planning-intelligence`).expect(200)).body.record;
    await post(sy, `${base}/planning-intelligence`, {
      orientation: 'combined',
      version: rec.version,
    }).expect(403);
    await post(sy, `${eng}/planning-signals/${pid}`, {
      managerAssessment: 'normal_planning',
      version: 1,
    }).expect(403);
    // The EP (with a Manager on the job) reviews — it does not assess.
    await post(pa, `${eng}/planning-signals/${pid}`, {
      managerAssessment: 'normal_planning',
      version: proposal.body.version,
    }).expect(403);
    await post(pa, `${base}/planning-intelligence`, {
      orientation: 'combined',
      version: rec.version,
    }).expect(403);

    // The Manager assesses the proposal; it leaves the proposals list.
    await post(mx, `${eng}/planning-signals/${pid}`, {
      managerAssessment: 'normal_planning',
      version: proposal.body.version,
    }).expect(201);
    expect((await governance(mx)).proposals[pid]).toBeUndefined();
  });

  it('B3 — alerts the Manager once for each new Enhanced / Immediate signal', async () => {
    // The Senior's Enhanced proposal (B1) reached the Manager.
    expect((await notes('manager.x@dhvaj.in', 'planning_signal_alert')).join('|')).toMatch(
      /Enhanced Attention signal PS-\d{3}/,
    );
    const before = (await notes('manager.x@dhvaj.in', 'planning_signal_alert')).length;
    // A standard signal raises no alert; the Manager's own signal neither.
    await post(sy, `${base}/planning-signals`, {
      source: 'manager',
      observation: 'Routine: office moved floors.',
    }).expect(201);
    await post(mx, `${base}/planning-signals`, {
      source: 'manager',
      observation: 'Manager-raised enhanced matter.',
      suggestedAttention: 'enhanced',
    }).expect(201);
    expect((await notes('manager.x@dhvaj.in', 'planning_signal_alert')).length).toBe(before);
    // The EP's Partner signal does alert the Manager.
    await post(pa, `${base}/planning-signals`, {
      source: 'partner',
      observation: 'Promoter group under regulatory inquiry.',
      suggestedAttention: 'enhanced',
    }).expect(201);
    expect((await notes('manager.x@dhvaj.in', 'planning_signal_alert')).length).toBe(before + 1);
  });

  it('B2 — surfaces IPA to the EP; challenge → response → acknowledge drives §20', async () => {
    const ipa = await post(mx, `${base}/planning-signals`, {
      source: 'manager',
      observation: 'Whistle-blower complaint about revenue cut-off.',
      suggestedAttention: 'immediate_partner',
    }).expect(201);
    const ipaId = ipa.body.id as string;
    expect((await notes('partner.a@dhvaj.in', 'planning_partner_attention')).join('|')).toMatch(
      /Immediate Partner Attention/,
    );
    let queue = (await governance(pa)).partnerAttention;
    const item = queue.items.find((i) => i.targetId === ipaId)!;
    expect(item).toMatchObject({ kind: 'signal', status: 'surfaced', raisedByPartner: false });
    expect(queue.outstanding).toBeGreaterThan(0);
    expect((await completion()).find((c) => c.key === 'partner_attention')?.met).toBe(false);

    // Only the EP reviews; only the Manager answers a challenge.
    await post(mx, `${base}/planning-attention/${item.id}/acknowledge`, {
      version: item.version,
    }).expect(403);
    await post(pa, `${base}/planning-attention/${item.id}/respond`, {
      response: 'n/a',
      version: item.version,
    }).expect(403);
    await post(pa, `${base}/planning-attention/${item.id}/challenge`, {
      challenge: '',
      version: item.version,
    }).expect(400);
    let v = (
      await post(pa, `${base}/planning-attention/${item.id}/challenge`, {
        challenge: 'Has forensic support been considered?',
        version: item.version,
      }).expect(201)
    ).body as PlanningGovernanceView;
    let it2 = v.partnerAttention.items.find((i) => i.id === item.id)!;
    expect(it2.status).toBe('challenged');
    expect((await notes('manager.x@dhvaj.in', 'planning_partner_attention')).join('|')).toMatch(
      /EP challenged PS-/,
    );
    v = (
      await post(mx, `${base}/planning-attention/${item.id}/respond`, {
        response: 'Yes — forensic specialist to be scoped in 03.8.',
        version: it2.version,
      }).expect(201)
    ).body as PlanningGovernanceView;
    it2 = v.partnerAttention.items.find((i) => i.id === item.id)!;
    expect(it2).toMatchObject({ status: 'responded', respondedByName: 'Manager X' });
    // Acknowledge everything outstanding (auto-generated IPA signals included).
    queue = (await governance(pa)).partnerAttention;
    for (const i of queue.items.filter((x) => x.status !== 'acknowledged')) {
      await post(pa, `${base}/planning-attention/${i.id}/acknowledge`, {
        note: 'Seen.',
        version: i.version,
      }).expect(201);
    }
    queue = (await governance(pa)).partnerAttention;
    expect(queue.outstanding).toBe(0);
    expect(queue.items.find((i) => i.id === item.id)?.reviewedByName).toBe('Partner A');
    expect((await completion()).find((c) => c.key === 'partner_attention')?.met).toBe(true);

    // EP flags a standard signal → IPA, raised by the EP, acknowledged on the spot.
    const std = (await signals()).find((s) => s.attention === 'standard' && s.status !== 'closed')!;
    v = (
      await post(pa, `${base}/planning-attention/flag`, {
        signalId: std.id,
        note: 'I want to see this one.',
      }).expect(201)
    ).body as PlanningGovernanceView;
    const flagged = v.partnerAttention.items.find((i) => i.targetId === std.id)!;
    expect(flagged).toMatchObject({ status: 'acknowledged', raisedByPartner: true });
    expect((await notes('manager.x@dhvaj.in', 'planning_partner_attention')).join('|')).toMatch(
      /EP flagged PS-/,
    );
    // Downgrading IPA (even one the EP set) needs a rationale; it then leaves the queue.
    const cur = (await signals()).find((s) => s.id === std.id)!;
    expect(cur.attention).toBe('immediate_partner');
    await post(mx, `${eng}/planning-signals/${std.id}`, {
      attention: 'enhanced',
      version: cur.version,
    }).expect(400);
    await post(mx, `${eng}/planning-signals/${std.id}`, {
      attention: 'enhanced',
      attentionRationale: 'Discussed with EP; enhanced attention suffices.',
      version: cur.version,
    }).expect(201);
    expect(
      (await governance(pa)).partnerAttention.items.find((i) => i.targetId === std.id),
    ).toBeUndefined();

    // An Area of Focus the EP raises is a Partner focus area in the queue.
    const fa = await post(pa, `${base}/areas-of-focus`, {
      name: 'Related-party transactions',
      whyRequiresAttention: 'Promoter-controlled suppliers.',
    }).expect(201);
    expect(fa.body.partnerAttention).toBe(true);
    const faItem = (await governance(pa)).partnerAttention.items.find(
      (i) => i.targetId === fa.body.id,
    )!;
    expect(faItem).toMatchObject({
      kind: 'focus_area',
      status: 'acknowledged',
      raisedByPartner: true,
    });
  });

  it('B4 — AS-01 and Area-of-Focus changes flag downstream planning', async () => {
    let rec = (await get(mx, `${base}/planning-intelligence`).expect(200)).body.record;
    rec = (
      await post(mx, `${base}/planning-intelligence`, {
        orientation: 'predominantly_substantive',
        version: rec.version,
      }).expect(201)
    ).body.record;
    await setItems(['risk_to_response', 'audit_programme', 'team_allocation'], 'complete');
    // Recording the first orientation flags nothing; changing it does.
    await post(mx, `${base}/planning-intelligence`, {
      orientation: 'combined',
      version: rec.version,
    }).expect(201);
    expect(await itemState('risk_to_response')).toBe('needs_attention');
    expect(await itemState('audit_programme')).toBe('needs_attention');
    expect(await itemState('team_allocation')).toBe('complete');
    const flags = (await governance(mx)).downstreamFlags.map((f) => f.module);
    expect(flags).toEqual(expect.arrayContaining(['03.6', '03.7']));

    // Superseding a focus area routed to 03.8 reopens team allocation.
    const fa = await post(mx, `${base}/areas-of-focus`, {
      name: 'IT general controls',
      destinations: ['03.8'],
    }).expect(201);
    await setItems(['team_allocation'], 'complete');
    await post(mx, `${eng}/areas-of-focus/${fa.body.id}`, {
      status: 'superseded',
      version: fa.body.version,
    }).expect(201);
    expect(await itemState('team_allocation')).toBe('needs_attention');
    await setItems(['risk_to_response', 'audit_programme', 'team_allocation'], 'not_started');
  });

  it('B6 — evidence: add / link / remove / version history on 03.1 records', async () => {
    const sig = (await signals())[0]!;
    const changes = (await get(mx, `${base}/planning-changes`).expect(200)).body as Array<{
      id: string;
    }>;
    const q = (type: string, id: string) =>
      `${base}/planning-evidence?targetType=${type}&targetId=${id}`;
    let view = (await get(mx, q('signal', sig.id)).expect(200)).body as PlanningEvidenceView;
    expect(view).toMatchObject({ files: [], canAdd: true, canUpload: true });
    view = (
      await post(mx, `${base}/planning-evidence/add`, {
        targetType: 'signal',
        targetId: sig.id,
        filename: 'board-minutes.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from('Board minutes June').toString('base64'),
      }).expect(201)
    ).body as PlanningEvidenceView;
    expect(view.files).toHaveLength(1);
    const managerFile = view.files[0]!;
    expect(managerFile).toMatchObject({ title: 'board-minutes', linkedByName: 'Manager X' });

    // The Senior links the existing engagement file (never a copy) to the change.
    expect(
      ((await get(sy, q('change', changes[0]!.id)).expect(200)).body as PlanningEvidenceView)
        .canUpload,
    ).toBe(false);
    await post(sy, `${base}/planning-evidence/add`, {
      targetType: 'change',
      targetId: changes[0]!.id,
      filename: 'x.txt',
      contentBase64: Buffer.from('x').toString('base64'),
    }).expect(403);
    const linked = (
      await post(sy, `${base}/planning-evidence/link`, {
        targetType: 'change',
        targetId: changes[0]!.id,
        documentId: managerFile.documentId,
      }).expect(201)
    ).body as PlanningEvidenceView;
    expect(linked.files[0]).toMatchObject({ documentId: managerFile.documentId, removable: true });
    await post(sy, `${base}/planning-evidence/link`, {
      targetType: 'change',
      targetId: changes[0]!.id,
      documentId: managerFile.documentId,
    }).expect(409);
    // A record on another file / the wrong type is rejected.
    await get(mx, q('prior_year', sig.id)).expect(404);

    const counts = (await governance(mx)).evidenceCounts;
    expect(counts[sig.id]).toBe(1);
    expect(counts[changes[0]!.id]).toBe(1);
    await get(mx, `${base}/planning-evidence/${managerFile.id}/versions`).expect(200);

    // The Senior may not remove the Manager's file, but may remove their own link.
    await post(sy, `${base}/planning-evidence/${managerFile.id}/unlink`, {}).expect(403);
    const after = (
      await post(sy, `${base}/planning-evidence/${linked.files[0]!.id}/unlink`, {}).expect(201)
    ).body as PlanningEvidenceView;
    expect(after.files).toHaveLength(0);
  });

  it('B7 — discussion actions and signals raised in the discussion', async () => {
    const s = await post(mx, `${base}/planning-discussion/signals`, {
      observation: 'Team noted unusual year-end credit notes.',
      suggestedAttention: 'enhanced',
    }).expect(201);
    expect(s.body.signalCode).toMatch(/^PS-\d{3}$/);
    const disc = (await get(mx, `${base}/planning-discussion`).expect(200)).body;
    expect(disc.signalIds).toContain(s.body.id);
    const sig = (await signals()).find((x) => x.id === s.body.id)!;
    expect(sig).toMatchObject({ source: 'manager', sourceLink: '03.1/discussion' });
    await post(sy, `${base}/planning-discussion/signals`, { observation: 'no' }).expect(403);

    await post(mx, `${base}/planning-discussion/actions`, {
      title: 'Obtain credit-note register',
      ownerEmployeeId: ids.get('Partner B'),
    }).expect(400);
    const action = await post(mx, `${base}/planning-discussion/actions`, {
      title: 'Obtain credit-note register',
      ownerEmployeeId: ids.get('Senior Y'),
      dueDate: '2025-04-30',
      category: 'information',
    }).expect(201);
    expect(action.body).toMatchObject({
      origin: 'discussion',
      ownerName: 'Senior Y',
      dueDate: '2025-04-30',
      status: 'open',
    });
    // The owner progresses their own action — status / resolution only.
    const progressed = await post(sy, `${eng}/planning-matters/${action.body.id}`, {
      status: 'in_progress',
      version: action.body.version,
    }).expect(201);
    await post(sy, `${eng}/planning-matters/${action.body.id}`, {
      title: 'Renamed',
      version: progressed.body.version,
    }).expect(403);
  });

  it('B5 — 03.1 freezes on 03.12 approval and reopens as a controlled revision', async () => {
    // 03.12 approval (its own flow is covered by the planning suite).
    await su.query(
      `INSERT INTO hsdg.audit_planning_approvals
         (workflow_instance_id, engagement_id, version, memo, snapshot, approved_by_employee_id)
       SELECT $1, $2, 1, 'Approved (e2e).', '{}'::jsonb, e.engagement_partner_id
         FROM hsdg.engagements e WHERE e.id = $2`,
      [shellId, engId],
    );
    await su.query(
      `UPDATE hsdg.audit_workflow_phases SET state = 'complete'
        WHERE workflow_instance_id = $1 AND phase_key = 'planning'`,
      [shellId],
    );
    let access = (await governance(mx)).access;
    expect(access).toMatchObject({ approved: true, locked: true, versionLabel: 'v1.0' });
    expect(access.lockReason).toMatch(/frozen/);
    await post(mx, `${base}/planning-signals`, {
      source: 'manager',
      observation: 'After approval',
    }).expect(409);
    await post(sy, `${base}/prior-year-matters`, {
      matterType: 'caro_exception',
      description: 'After approval',
    }).expect(409);

    // Section 01/02 facts move after approval: opening the frozen 03.1 must not
    // re-derive signals into the approved baseline (only the stale marker stays).
    const fingerprint = async () =>
      (
        await su.query<{ facts_fingerprint: string | null; intelligence_generated_at: Date }>(
          `SELECT facts_fingerprint, intelligence_generated_at
             FROM hsdg.audit_planning_intelligence WHERE workflow_instance_id = $1`,
          [shellId],
        )
      ).rows[0]!;
    await su.query(
      `UPDATE hsdg.audit_planning_intelligence SET facts_fingerprint = 'moved-after-approval'
        WHERE workflow_instance_id = $1`,
      [shellId],
    );
    const frozenBefore = await fingerprint();
    const signalsBefore = (await signals()).map((x) => `${x.id}:${x.version}`);
    await get(mx, `${base}/planning-intelligence`).expect(200);
    await get(pa, `${base}/planning-intelligence`).expect(200);
    expect(await fingerprint()).toEqual(frozenBefore);
    expect((await signals()).map((x) => `${x.id}:${x.version}`)).toEqual(signalsBefore);
    await post(mx, `${base}/planning-intelligence/generate`, {}).expect(409);

    await post(mx, `${base}/planning-governance/reopen`, { reason: '' }).expect(400);
    await post(sy, `${base}/planning-governance/reopen`, { reason: 'x' }).expect(403);
    const reopened = (
      await post(mx, `${base}/planning-governance/reopen`, {
        reason: 'Acquisition announced after approval.',
      }).expect(201)
    ).body as PlanningGovernanceView;
    access = reopened.access;
    expect(access).toMatchObject({ locked: false, versionNo: 2, versionLabel: 'v1.1' });
    expect(access.openRevision).toMatchObject({
      fromVersionLabel: 'v1.0',
      toVersionLabel: 'v1.1',
      status: 'open',
    });
    await post(mx, `${base}/planning-governance/reopen`, { reason: 'again' }).expect(409);
    expect((await notes('partner.a@dhvaj.in', 'planning_strategy_reopened'))[0]).toMatch(
      /v1\.0 → v1\.1/,
    );
    const phase = await su.query<{ state: string }>(
      `SELECT state FROM hsdg.audit_workflow_phases
        WHERE workflow_instance_id = $1 AND phase_key = 'planning'`,
      [shellId],
    );
    expect(phase.rows[0]!.state).toBe('needs_attention');

    // The approved baseline is frozen with the revision.
    const baselineSignals = (
      await get(sy, `${base}/planning-governance/revisions/${access.openRevision!.id}`).expect(200)
    ).body.baseline.signals as unknown[];
    const live = await signals();
    expect(baselineSignals).toHaveLength(live.length);
    await post(mx, `${base}/planning-signals`, {
      source: 'manager',
      observation: 'Acquisition of a subsidiary announced.',
    }).expect(201);
    await expect(
      su.query(
        `UPDATE hsdg.audit_planning_intelligence_revision SET baseline = '{}'::jsonb WHERE id = $1`,
        [access.openRevision!.id],
      ),
    ).rejects.toThrow(/immutable/);
    // Under the open revision the next open re-derives from the moved facts.
    await get(mx, `${base}/planning-intelligence`).expect(200);
    expect((await fingerprint()).facts_fingerprint).not.toBe('moved-after-approval');

    // Completing 03.1 again closes the revision (ready for 03.12 re-approval).
    await completeIntelligence();
    access = (await governance(mx)).access;
    expect(access.openRevision).toBeNull();
    expect(access.revisions[0]).toMatchObject({
      status: 'completed',
      completedByName: 'Manager X',
    });
    expect(access).toMatchObject({ locked: true, versionLabel: 'v1.1' });
  });

  /** Satisfy every §20 check as the Manager and complete 03.1. */
  async function completeIntelligence(): Promise<void> {
    for (const s of await signals()) {
      if (s.status === 'closed' || s.managerAssessment) continue;
      await post(mx, `${eng}/planning-signals/${s.id}`, {
        managerAssessment: 'normal_planning',
        version: s.version,
      }).expect(201);
    }
    const queue = (await governance(pa)).partnerAttention;
    for (const i of queue.items.filter((x) => x.status !== 'acknowledged')) {
      await post(pa, `${base}/planning-attention/${i.id}/acknowledge`, {
        version: i.version,
      }).expect(201);
    }
    for (const c of (await get(mx, `${base}/planning-considerations`).expect(200)).body as Array<{
      id: string;
      assessment: string | null;
      version: number;
    }>) {
      if (c.assessment) continue;
      await post(mx, `${eng}/planning-considerations/${c.id}`, {
        assessment: 'not_required',
        rationale: 'Not needed (e2e).',
        version: c.version,
      }).expect(201);
    }
    for (const p of (await get(mx, `${base}/prior-year-matters`).expect(200)).body as Array<{
      id: string;
      assessment: string | null;
      version: number;
    }>) {
      if (p.assessment) continue;
      await post(mx, `${eng}/prior-year-matters/${p.id}`, {
        assessment: 'still_relevant',
        version: p.version,
      }).expect(201);
    }
    const disc = (await get(mx, `${base}/planning-discussion`).expect(200)).body;
    await post(mx, `${base}/planning-discussion`, {
      discussionDate: '2025-04-01',
      participantEmployeeIds: [ids.get('Manager X'), ids.get('Senior Y')],
      signalIds: disc.signalIds,
      focusIds: disc.focusIds,
      version: disc.version,
    }).expect(201);
    // §8 — the Manager records the review of the generated Engagement Intelligence.
    await post(mx, `${base}/planning-intelligence/review`, {}).expect(201);
    const rec = (await get(mx, `${base}/planning-intelligence`).expect(200)).body.record;
    const res = await post(mx, `${base}/planning-intelligence`, {
      additionalScopeRequired: false,
      priorYearReviewed: true,
      strategySummary: 'Combined approach; focus on revenue cut-off (e2e).',
      status: 'complete',
      version: rec.version,
    });
    if (res.status !== 201) throw new Error(`03.1 completion failed: ${JSON.stringify(res.body)}`);
  }

  /**
   * 03.1 generates itself when the Engagement Partner records AF-02 (02.8), so a
   * team member who opens Planning first finds the intelligence ready — the
   * lead-only RLS on the 03.1 tables never meets a Senior's first read.
   */
  describe('auto-generation at AF-02', () => {
    /** A fresh file (EP Partner A, EM Manager X, Senior Y in charge) at AF-02. */
    const fileAtAf02 = async (): Promise<{ eng: string; wf: string; base: string }> => {
      const entity = await post(pa, '/api/v1/entities', {
        legalName: `Planning Autogen ${stamp()}`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
      }).expect(201);
      const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
      const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
      const e = await post(pa, '/api/v1/engagements', {
        entityId: entity.body.id,
        serviceId: itr,
        financialYear: '2024-25',
        periodLabel: `P${stamp()}`,
        status: 'accepted',
        engagementManagerEmployeeId: ids.get('Manager X'),
      }).expect(201);
      const id = e.body.id as string;
      await post(pa, `/api/v1/engagements/${id}/services`, { serviceId: stat }).expect(201);
      await post(pa, `/api/v1/engagements/${id}/team`, {
        employeeId: ids.get('Senior Y'),
        roleOnEngagement: 'in_charge',
      }).expect(201);
      await su.query(
        `UPDATE hsdg.engagements SET engagement_partner_id =
           (SELECT e.id FROM hsdg.employees e JOIN hsdg.users u ON u.id = e.user_id
             WHERE u.email = 'partner.a@dhvaj.in')
          WHERE id = $1`,
        [id],
      );
      const root = `/api/v1/engagements/${id}/statutory-audit`;
      const wf = (await get(pa, root).expect(200)).body[0].workflowInstanceId as string;
      // Seed 02.8, then decide 02.1–02.7 directly (their own suites drive them).
      await get(pa, `${root}/framework-summary`).expect(200);
      await su.query(
        `UPDATE hsdg.audit_entity_profile SET state = 'confirmed', confirmed_at = now(),
                needs_reevaluation = false
          WHERE workflow_instance_id = $1`,
        [wf],
      );
      await su.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET state = CASE WHEN sub_section_key = '02.2' THEN 'approved' ELSE 'not_applicable' END,
                conclusion = COALESCE(conclusion, system_outcome, 'not_applicable'),
                needs_reevaluation = false, decided_at = now()
          WHERE workflow_instance_id = $1`,
        [wf],
      );
      await su.query(
        `UPDATE hsdg.audit_framework_assessments
            SET state = 'not_applicable', conclusion = 'not_applicable', decided_at = now()
          WHERE workflow_instance_id = $1`,
        [wf],
      );
      await su.query(
        `UPDATE hsdg.audit_matter SET status = 'resolved', resolution = 'e2e'
          WHERE workflow_instance_id = $1 AND status <> 'resolved'`,
        [wf],
      );
      // AF-01 for real; the memorandum (its own suite) is placed submitted.
      const s = (await get(pa, `${root}/framework-summary`).expect(200)).body[0];
      const confirmed = (
        await post(pa, `${root}/${wf}/framework-summary/confirm`, {
          decision: 'submit_for_partner_approval',
          previewReviewed: true,
          recordVersion: s.recordVersion,
        }).expect(201)
      ).body;
      const { rows: doc } = await su.query<{ id: string }>(
        `INSERT INTO hsdg.documents (engagement_id, title)
         VALUES ($1, 'Audit Framework Memorandum v1.0') RETURNING id`,
        [id],
      );
      await su.query(
        `INSERT INTO hsdg.audit_framework_memo
           (baseline_id, workflow_instance_id, engagement_id, baseline_version, document_id,
            status, submitted_at)
         VALUES ($1, $2, $3, '1.0', $4, 'submitted', now())`,
        [confirmed.baseline.id, wf, id, doc[0]!.id],
      );
      return { eng: root, wf, base: `${root}/${wf}` };
    };
    const generatedAt = async (wf: string): Promise<Date | null> =>
      (
        await su.query<{ at: Date | null }>(
          `SELECT intelligence_generated_at AS at FROM hsdg.audit_planning_intelligence
            WHERE workflow_instance_id = $1`,
          [wf],
        )
      ).rows[0]?.at ?? null;
    const recordVersion = async (root: string): Promise<number> =>
      (await get(pa, `${root}/framework-summary`).expect(200)).body[0].recordVersion as number;

    it('a Senior opening 03.1 first after AF-02 "Approve" sees generated intelligence', async () => {
      const f = await fileAtAf02();
      await post(pa, `${f.base}/framework-summary/approve`, {
        decision: 'approve',
        recordVersion: await recordVersion(f.eng),
      }).expect(201);
      expect(await generatedAt(f.wf)).not.toBeNull();

      // No lead has opened Planning: the Senior is the first reader.
      const res = await get(sy, `${f.base}/planning-intelligence`).expect(200);
      expect(res.body.record.intelligenceGeneratedAt).not.toBeNull();
      expect(res.body.totalSignals).toBeGreaterThan(0);
      const seen = (await get(sy, `${f.base}/planning-signals`).expect(200))
        .body as PlanningSignalRecord[];
      expect(seen.length).toBe(res.body.totalSignals);
    });

    it('a condition that bars Planning defers generation until the EP resolves it', async () => {
      const f = await fileAtAf02();
      const approved = (
        await post(pa, `${f.base}/framework-summary/approve`, {
          decision: 'approve_subject_to_conditions',
          conditions: [
            {
              condition: 'Obtain the bank sanction letter',
              dueDate: '2026-11-30',
              impact: 'CARO 3(ii)(b) quarterly returns',
              planningMayCommence: false,
            },
          ],
          recordVersion: await recordVersion(f.eng),
        }).expect(201)
      ).body;
      expect(approved.planning).toMatchObject({ unlocked: false });
      expect(await generatedAt(f.wf)).toBeNull();

      await post(
        pa,
        `${f.eng}/framework-summary/conditions/${approved.approval.conditions[0].id}/resolve`,
        { resolution: 'Sanction letter on file' },
      ).expect(201);
      expect(await generatedAt(f.wf)).not.toBeNull();
      const res = await get(sy, `${f.base}/planning-intelligence`).expect(200);
      expect(res.body.record.intelligenceGeneratedAt).not.toBeNull();
      expect(res.body.totalSignals).toBeGreaterThan(0);
    });
  });
});

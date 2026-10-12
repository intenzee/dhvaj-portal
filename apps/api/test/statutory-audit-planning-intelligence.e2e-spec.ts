import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { approveFrameworkForTest } from './framework-approval.helper';

/**
 * DHVAJ 03.1 Planning Intelligence — the library-driven engine end to end:
 * signals come from versioned Planning Signal Library rules over the Section
 * 01/02 facts; generation waits for the approved framework (02.8 AF-02); a
 * fact that moves regenerates the intelligence, invalidates its review and
 * flags (never deletes) the signal whose source no longer holds until the
 * Manager reassesses it; current-year changes fire their category rule; the
 * library itself is insert-only and versioned (admin, service.manage).
 */
describe('Statutory Audit — 03.1 Planning Intelligence engine (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let mp: string;
  const TEST_RULE = 'PSR-099';
  const TEST_CONSIDERATION = 'PCR-099';

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
  const get = (url: string, t = pa) =>
    request(app.getHttpServer()).get(url).set(bearer(t)).expect(200);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const su = async <T>(fn: (db: Client) => Promise<T>): Promise<T> => {
    const db = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await db.connect();
    try {
      return await fn(db);
    } finally {
      await db.end();
    }
  };
  const setArea = (shellId: string, areaKey: string, conclusion: string) =>
    su((db) =>
      db.query(
        `UPDATE hsdg.audit_framework_assessments SET conclusion = $3
          WHERE workflow_instance_id = $1 AND area_key = $2`,
        [shellId, areaKey, conclusion],
      ),
    );

  const newAuditFile = async (
    approve = true,
  ): Promise<{ engId: string; shellId: string; base: string }> => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Planning Intel ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: stat,
      financialYear: '2024-25',
      periodLabel: `P${stamp()}`,
      status: 'accepted',
    }).expect(201);
    const engId = eng.body.id as string;
    const shells = await get(`/api/v1/engagements/${engId}/statutory-audit`);
    const shellId = shells.body[0].workflowInstanceId as string;
    if (approve) await approveFrameworkForTest(shellId);
    return { engId, shellId, base: `/api/v1/engagements/${engId}/statutory-audit/${shellId}` };
  };

  type Signal = {
    id: string;
    ruleKey: string | null;
    ruleCode: string | null;
    ruleVersion: number | null;
    source: string;
    sourceLink: string | null;
    sourceSection: string | null;
    guidanceAnchors: string[];
    suggestedAttention: string;
    sourceChangedAt: string | null;
    sourceChangeAcknowledgedAt: string | null;
    isAuto: boolean;
    version: number;
  };
  type Check = { key: string; met: boolean };
  const signals = async (base: string) => (await get(`${base}/planning-signals`)).body as Signal[];
  const check = (summary: { completion: Check[] }, key: string) =>
    summary.completion.find((c) => c.key === key)!.met;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await su((db) =>
      db.query(`DELETE FROM hsdg.planning_signal_rule WHERE rule_code = $1`, [TEST_RULE]),
    );
    await su((db) =>
      db.query(`DELETE FROM hsdg.planning_consideration_rule WHERE rule_code = $1`, [
        TEST_CONSIDERATION,
      ]),
    );
    await app?.close();
  });

  it('generates library signals, regenerates on a moved fact and flags the source change', async () => {
    const f = await newAuditFile();
    await setArea(f.shellId, 'internal_audit', 'applicable');

    // First open generates (no "Generate" click) from the library.
    const first = await get(`${f.base}/planning-intelligence`);
    expect(first.body.record.intelligenceGeneratedAt).toBeTruthy();
    const all = await signals(f.base);
    const auto = all.filter((s) => s.isAuto && s.source !== 'current_year_change');
    expect(auto.length).toBeGreaterThan(0);
    for (const s of auto) {
      expect(s.ruleCode).toMatch(/^PSR-\d{3}$/);
      expect(s.ruleVersion).toBeGreaterThanOrEqual(1);
      expect(s.sourceSection).toMatch(/^\d{2}(\.\d{1,2})?$/);
      if (s.sourceLink) expect(s.sourceLink).toMatch(/^[a-z_]+:[A-Za-z0-9_.-]+$/);
    }
    const ia = all.find((s) => s.ruleKey === 'internal_audit_function')!;
    expect(ia).toEqual(
      expect.objectContaining({
        ruleCode: 'PSR-008',
        ruleVersion: 1,
        sourceSection: '02.1',
        sourceLink: 'framework:02.1',
        guidanceAnchors: ['sa_610'],
        sourceChangedAt: null,
      }),
    );

    // The facts view: gate open, grouped facts with source links, not stale.
    const facts = await get(`${f.base}/planning-intelligence/facts`);
    expect(facts.body.gate.unlocked).toBe(true);
    expect(facts.body.stale).toBe(false);
    const items = (
      facts.body.groups as Array<{
        items: Array<{ key: string; value: string; sourceLink: string }>;
      }>
    ).flatMap((g) => g.items);
    expect(items.find((i) => i.key === 'internal_audit')).toEqual(
      expect.objectContaining({ value: 'Yes', sourceLink: 'framework:02.1' }),
    );

    // Re-generating with unchanged facts changes nothing (the review stands).
    const reviewed = await post(pa, `${f.base}/planning-intelligence/review`, {}).expect(201);
    expect(reviewed.body.record.intelligenceReviewedAt).toBeTruthy();
    expect(reviewed.body.record.intelligenceReviewedByName).toBeTruthy();
    expect(check(reviewed.body, 'intelligence')).toBe(true);
    const same = await post(pa, `${f.base}/planning-intelligence/generate`, {}).expect(201);
    expect(same.body.record.intelligenceGeneratedAt).toBe(
      reviewed.body.record.intelligenceGeneratedAt,
    );
    expect(check(same.body, 'intelligence')).toBe(true);

    // The fact moves: the next open regenerates, flags the signal and asks for a new review.
    await setArea(f.shellId, 'internal_audit', 'not_applicable');
    expect((await get(`${f.base}/planning-intelligence/facts`)).body.stale).toBe(true);
    const moved = await get(`${f.base}/planning-intelligence`);
    expect(check(moved.body, 'intelligence')).toBe(false);
    expect(check(moved.body, 'source_changes')).toBe(false);
    const flagged = (await signals(f.base)).find((s) => s.id === ia.id)!;
    expect(flagged.sourceChangedAt).toBeTruthy(); // never deleted
    expect((await get(`${f.base}/planning-intelligence/facts`)).body).toEqual(
      expect.objectContaining({ stale: false, sourceChangedSignals: 1 }),
    );

    // The Manager's reassessment acknowledges the change.
    const assessed = await post(
      pa,
      `/api/v1/engagements/${f.engId}/statutory-audit/planning-signals/${ia.id}`,
      {
        managerAssessment: 'not_relevant',
        assessmentRationale: 'No internal audit function this year.',
        version: flagged.version,
      },
    ).expect(201);
    expect(assessed.body.sourceChangeAcknowledgedAt).toBeTruthy();
    const after = await get(`${f.base}/planning-intelligence`);
    expect(check(after.body, 'source_changes')).toBe(true);

    // The fact holds again: the flag clears.
    await setArea(f.shellId, 'internal_audit', 'applicable');
    await get(`${f.base}/planning-intelligence`);
    const back = (await signals(f.base)).find((s) => s.id === ia.id)!;
    expect(back.sourceChangedAt).toBeNull();
  });

  it('waits for the approved framework before generating', async () => {
    const f = await newAuditFile(false);
    const facts = await get(`${f.base}/planning-intelligence/facts`);
    expect(facts.body.gate.unlocked).toBe(false);
    const summary = await get(`${f.base}/planning-intelligence`);
    expect(summary.body.record.intelligenceGeneratedAt).toBeNull();
    await post(pa, `${f.base}/planning-intelligence/generate`, {}).expect(409);
    expect(await signals(f.base)).toHaveLength(0);
  });

  it('reads the 02.8 baseline, overrides and conditions and fires their rules (§5)', async () => {
    const f = await newAuditFile();
    // An override of a system result and an open AF-02 condition that lets
    // Planning commence — recorded on the approved baseline.
    await su((db) =>
      db.query(
        `UPDATE hsdg.audit_framework_assessments
            SET is_overridden = true, system_suggestion = 'not_applicable',
                conclusion = 'applicable', basis = 'Group policy requires it (e2e).',
                decided_at = now()
          WHERE workflow_instance_id = $1 AND area_key = 'cost_records'`,
        [f.shellId],
      ),
    );
    const conditionId = await su(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO hsdg.audit_framework_condition
           (baseline_id, workflow_instance_id, engagement_id, condition, due_date, impact,
            planning_may_commence)
         SELECT b.id, b.workflow_instance_id, b.engagement_id,
                'Obtain the board resolution on CSR applicability', CURRENT_DATE + 30,
                'CSR reporting route', true
           FROM hsdg.audit_framework_baseline b
          WHERE b.workflow_instance_id = $1 AND b.ep_approved_at IS NOT NULL
         RETURNING id`,
        [f.shellId],
      );
      return rows[0]!.id;
    });

    await get(`${f.base}/planning-intelligence`);
    const facts = await get(`${f.base}/planning-intelligence/facts`);
    expect(facts.body.gate.route).toBe('conditional');
    const g = (
      facts.body.groups as Array<{
        key: string;
        section: string;
        items: Array<{ key: string; value: string; sourceLink: string }>;
      }>
    ).find((x) => x.key === 'changes')!;
    expect(g.section).toBe('02.8');
    const value = (k: string) => g.items.find((i) => i.key === k)?.value;
    expect(value('baseline')).toMatch(/^v1\.\d+ approved .*subject to conditions/);
    expect(value('overrides')).toContain('Not applicable → Applicable');
    expect(value('overrides')).toContain('Group policy requires it');
    expect(value('conditions')).toBe(
      '1 of 1 open — Obtain the board resolution on CSR applicability',
    );
    for (const i of g.items) expect(i.sourceLink).toBe('framework:02.8');

    const all = await signals(f.base);
    const override = all.find((s) => s.ruleKey === 'framework_overrides')!;
    const conditional = all.find((s) => s.ruleKey === 'framework_open_conditions')!;
    expect(override).toEqual(
      expect.objectContaining({
        ruleCode: 'PSR-027',
        suggestedAttention: 'standard',
        sourceSection: '02.8',
      }),
    );
    expect(conditional).toEqual(
      expect.objectContaining({
        ruleCode: 'PSR-028',
        suggestedAttention: 'enhanced',
        sourceSection: '02.8',
      }),
    );

    // Resolving the condition moves the fact: the next open flags the signal.
    await su((db) =>
      db.query(
        `UPDATE hsdg.audit_framework_condition
            SET status = 'resolved', resolution = 'Resolution obtained (e2e).', resolved_at = now()
          WHERE id = $1`,
        [conditionId],
      ),
    );
    expect((await get(`${f.base}/planning-intelligence/facts`)).body.stale).toBe(true);
    await get(`${f.base}/planning-intelligence`);
    const after = (await signals(f.base)).find((s) => s.id === conditional.id)!;
    expect(after.sourceChangedAt).toBeTruthy();
    const resolved = await get(`${f.base}/planning-intelligence/facts`);
    const items = (
      resolved.body.groups as Array<{ key: string; items: Array<{ key: string; value: string }> }>
    ).find((x) => x.key === 'changes')!.items;
    expect(items.find((i) => i.key === 'conditions')?.value).toBe('All 1 resolved');
  });

  it('fires the change-category rule for a current-year change', async () => {
    const f = await newAuditFile();
    await get(`${f.base}/planning-intelligence`);
    const change = await post(pa, `${f.base}/planning-changes`, {
      category: 'fraud',
      description: 'Whistle-blower complaint on vendor payments',
      createSignal: true,
    }).expect(201);
    const sig = (await signals(f.base)).find((s) => s.id === change.body.signalId)!;
    expect(sig).toEqual(
      expect.objectContaining({
        source: 'current_year_change',
        ruleCode: 'PSR-116',
        suggestedAttention: 'immediate_partner',
        sourceSection: '03.1',
      }),
    );
    expect(sig.guidanceAnchors.length).toBeGreaterThan(0);
  });

  it('drafts the Strategy Summary from the on-screen AS-01/AS-02 answers without saving them', async () => {
    const f = await newAuditFile();
    await get(`${f.base}/planning-intelligence`);
    const draft = async (body: Record<string, unknown>) =>
      (await post(pa, `${f.base}/planning-intelligence/strategy-draft`, body).expect(201)).body
        .draft as string;

    expect(await draft({})).toContain('Not yet recorded (AS-01).');
    const onScreen = await draft({
      orientation: 'combined',
      orientationNote: 'Revenue controls tested at interim.',
      additionalScopeRequired: true,
      additionalScope: 'Stock count at the new warehouse.',
    });
    expect(onScreen).toContain('Combined controls and substantive (preliminary;');
    expect(onScreen).toContain('- Revenue controls tested at interim.');
    expect(onScreen).toContain('- Stock count at the new warehouse.');
    expect(onScreen).not.toContain('Not yet recorded (AS-01).');
    await post(pa, `${f.base}/planning-intelligence/strategy-draft`, {
      orientation: 'nope',
    }).expect(400);

    // Nothing was saved.
    const record = (await get(`${f.base}/planning-intelligence`)).body.record;
    expect(record.orientation).toBeNull();
    expect(record.additionalScope).toBeNull();
  });

  it('offers the Area of Focus pick-lists and keeps the chosen assertions', async () => {
    const f = await newAuditFile();
    const lists = await get(`${f.base}/planning-intelligence/focus-pick-lists`);
    expect(lists.body.fsAreas.length).toBeGreaterThan(0);
    expect(lists.body.assertions.length).toBeGreaterThan(0);
    const area = lists.body.fsAreas[0].name as string;
    const assertion = `${lists.body.assertions[0].label} (${lists.body.assertions[0].group})`;
    const created = await post(pa, `${f.base}/areas-of-focus`, {
      name: 'Revenue cut-off',
      potentialFsAreas: [area],
      potentialAssertions: [assertion],
    }).expect(201);
    expect(created.body.potentialFsAreas).toEqual([area]);
    expect(created.body.potentialAssertions).toEqual([assertion]);
  });

  it('keeps the library insert-only and versioned (service.manage)', async () => {
    const lib = await get('/api/v1/planning-signal-rules', mp);
    const codes = new Set((lib.body as Array<{ ruleCode: string }>).map((r) => r.ruleCode));
    expect(codes.has('PSR-001')).toBe(true);
    expect(codes.has('PSR-118')).toBe(true);
    await request(app.getHttpServer())
      .get('/api/v1/planning-signal-rules')
      .set(bearer(pa))
      .expect(403);

    const rule = {
      ruleCode: TEST_RULE,
      ruleKey: 'e2e_test_rule',
      name: 'E2E rule',
      triggerSource: 'section_02',
      triggerSection: '02.1',
      triggerCondition: { fact: 'internal_audit', op: 'truthy' },
      observationTemplate: 'E2E observation.',
      whyMayMatter: 'Testing.',
      potentialImplications: 'None.',
      guidanceAnchors: ['sa_610'],
      destinations: ['03.9'],
      suggestedAttention: 'standard',
      sourceLink: 'framework:02.1',
      // Far in the future, so no other suite's file ever fires it.
      effectiveFrom: '2099-04-01',
      changeNote: 'E2E',
    };
    await post(mp, '/api/v1/planning-signal-rules', {
      ...rule,
      triggerCondition: { fact: 'internal_audit', op: 'nope' },
    }).expect(400);
    await post(mp, '/api/v1/planning-signal-rules', {
      ...rule,
      guidanceAnchors: ['no_such'],
    }).expect(400);
    await post(mp, '/api/v1/planning-signal-rules', { ...rule, ruleKey: 'caro_applicable' }).expect(
      409,
    );
    const v1 = await post(mp, '/api/v1/planning-signal-rules', rule).expect(201);
    expect(v1.body).toEqual(expect.objectContaining({ version: 1, conditionVersion: 1 }));
    const v2 = await post(mp, '/api/v1/planning-signal-rules', {
      ...rule,
      ruleKey: undefined,
      observationTemplate: 'E2E observation, reworded.',
      changeNote: 'Reworded',
    }).expect(201);
    expect(v2.body).toEqual(
      expect.objectContaining({ version: 2, conditionVersion: 1, ruleKey: 'e2e_test_rule' }),
    );
    const v3 = await post(mp, '/api/v1/planning-signal-rules', {
      ...rule,
      ruleKey: undefined,
      triggerCondition: { fact: 'internal_audit', op: 'eq', value: true },
      changeNote: 'New condition',
    }).expect(201);
    expect(v3.body.conditionVersion).toBe(2);

    // Not in force for a 2024-25 file.
    const f = await newAuditFile();
    await setArea(f.shellId, 'internal_audit', 'applicable');
    await get(`${f.base}/planning-intelligence`);
    expect((await signals(f.base)).some((s) => s.ruleCode === TEST_RULE)).toBe(false);

    // Insert-only for the application role.
    await su(async (db) => {
      await db.query(`SET ROLE hsdg_app`);
      await expect(
        db.query(`UPDATE hsdg.planning_signal_rule SET name = 'x' WHERE rule_code = $1`, [
          TEST_RULE,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('derives considerations from the versioned Strategic Consideration Library (§13.2–13.3, §21)', async () => {
    const url = '/api/v1/planning-consideration-rules';
    const lib = await get(url, mp);
    const codes = new Set((lib.body as Array<{ ruleCode: string }>).map((r) => r.ruleCode));
    expect(codes.has('PCR-001')).toBe(true);
    expect(codes.has('PCR-017')).toBe(true);
    await request(app.getHttpServer()).get(url).set(bearer(pa)).expect(403);

    const rule = {
      ruleCode: TEST_CONSIDERATION,
      considerationKey: 'e2e_test_consideration',
      kind: 'resource',
      label: 'E2E consideration',
      basis: 'Testing.',
      matchChangeCategories: ['fraud'],
      // Far in the future: only a file whose period ends after it sees the rule.
      effectiveFrom: '2099-04-01',
      changeNote: 'E2E',
    };
    await post(mp, url, { ...rule, matchChangeCategories: [] }).expect(400);
    await post(mp, url, { ...rule, matchRuleKeys: ['no_such_rule'] }).expect(400);
    await post(mp, url, { ...rule, considerationKey: 'tax_expertise' }).expect(409);
    const v1 = await post(mp, url, rule).expect(201);
    expect(v1.body).toEqual(expect.objectContaining({ version: 1, kind: 'resource' }));
    await post(mp, url, { ...rule, considerationKey: undefined, kind: 'timing' }).expect(400);
    const v2 = await post(mp, url, {
      ...rule,
      considerationKey: undefined,
      label: 'E2E consideration, reworded',
      changeNote: 'Reworded',
    }).expect(201);
    expect(v2.body).toEqual(
      expect.objectContaining({ version: 2, considerationKey: 'e2e_test_consideration' }),
    );

    type Consideration = {
      considerationKey: string;
      label: string;
      ruleCode: string | null;
      ruleVersion: number | null;
    };
    const fraudFile = async (financialYear?: string) => {
      const f = await newAuditFile();
      if (financialYear) {
        await su((db) =>
          db.query(`UPDATE hsdg.engagements SET financial_year = $2 WHERE id = $1`, [
            f.engId,
            financialYear,
          ]),
        );
      }
      await get(`${f.base}/planning-intelligence`);
      await post(pa, `${f.base}/planning-changes`, {
        category: 'fraud',
        description: 'Whistle-blower complaint on vendor payments',
        createSignal: true,
      }).expect(201);
      return (await get(`${f.base}/planning-considerations`)).body as Consideration[];
    };

    // A 2024-25 file reads the seeded library only.
    const now = await fraudFile();
    expect(now.find((c) => c.considerationKey === 'forensic_expertise')).toEqual(
      expect.objectContaining({ ruleCode: 'PCR-016', ruleVersion: 1 }),
    );
    expect(now.some((c) => c.considerationKey === 'e2e_test_consideration')).toBe(false);

    // A file whose period ends after the rule's effective date gets its latest version.
    const later = await fraudFile('2099-00');
    expect(later.find((c) => c.considerationKey === 'e2e_test_consideration')).toEqual(
      expect.objectContaining({
        label: 'E2E consideration, reworded',
        ruleCode: TEST_CONSIDERATION,
        ruleVersion: 2,
      }),
    );

    // Insert-only for the application role.
    await su(async (db) => {
      await db.query(`SET ROLE hsdg_app`);
      await expect(
        db.query(`UPDATE hsdg.planning_consideration_rule SET label = 'x' WHERE rule_code = $1`, [
          TEST_CONSIDERATION,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

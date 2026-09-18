import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StatutoryAuditCompletion } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Statutory Audit — end-to-end acceptance + security (Audit Spec §35, §36). SA-10.
 *
 * Drives the professional audit file through the HTTP API exactly as the app
 * does — provisioning, framework applicability, work generation, review, the
 * completion/sign-off/archive gates, and controlled reassessment — and asserts
 * the §36 acceptance table plus the §35 assignment-scoped security. The
 * individual slices ship pure-unit specs; this is the full-stack pass that binds
 * them together (build sequence §38 item 18).
 */
describe('Statutory Audit (e2e §35/§36)', () => {
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

  let mp: string; // Managing Partner — reads across the firm (for id lookups + audit).
  let pa: string; // Partner A (North) — the EP/lead who performs the audit.
  let pb: string; // Partner B (South) — NOT on these engagements (the outsider).

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── helpers that build an audit file to a chosen depth ──────────────────────

  /** Create a North-client engagement and add Statutory Audit → provisions the shell. */
  const newAuditFile = async (): Promise<{ engId: string; shellId: string }> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const primaryServiceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const statAuditId = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');

    const created = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId: primaryServiceId,
        financialYear: '2024-25',
        periodLabel: uniquePeriod(),
        status: 'accepted',
      })
      .expect(201);
    const engId = created.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/services`)
      .set(bearer(pa))
      .send({ serviceId: statAuditId })
      .expect(201);

    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    return { engId, shellId: shells.body[0].workflowInstanceId as string };
  };

  /** Conclude every framework area (caro optionally not-applicable) and approve. */
  const approveFramework = async (
    engId: string,
    shellId: string,
    opts: { caroApplicable?: boolean } = {},
  ): Promise<void> => {
    const fw = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/framework`)
      .set(bearer(pa))
      .expect(200);
    const assessments = fw.body[0].assessments as Array<{
      id: string;
      areaKey: string;
      version: number;
    }>;
    for (const a of assessments) {
      const conclusion =
        opts.caroApplicable === false && a.areaKey === 'caro' ? 'not_applicable' : 'applicable';
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/statutory-audit/framework/${a.id}/decision`)
        .set(bearer(pa))
        .send({ conclusion, basis: 'E2E professional basis.', version: a.version })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/framework/approve`)
      .set(bearer(pa))
      .send({ memo: 'Framework approved (e2e).' })
      .expect(201);
  };

  const generate = async (
    engId: string,
    shellId: string,
  ): Promise<Array<{ id: string; workAreaKey: string; isActive: boolean }>> => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/work-areas/generate`)
      .set(bearer(pa))
      .expect(201);
    return res.body.areas;
  };

  const getWorkAreas = async (
    engId: string,
  ): Promise<
    Array<{ id: string; workAreaKey: string; isActive: boolean; detail: { detailVersion: number } }>
  > => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/work-areas`)
      .set(bearer(pa))
      .expect(200);
    return res.body[0].areas;
  };

  /** Submit a conclusion on every active area (so the §29 completion gate clears). */
  const concludeAllAreas = async (engId: string): Promise<void> => {
    const areas = await getWorkAreas(engId);
    for (const a of areas.filter((x) => x.isActive)) {
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/statutory-audit/areas/${a.id}/detail`)
        .set(bearer(pa))
        .send({
          conclusion: 'Work performed; concluded.',
          conclusionState: 'submitted',
          detailVersion: a.detail.detailVersion,
        })
        .expect(201);
    }
  };

  /** Mark every completion + reporting checklist item complete. */
  const resolveAllCompletionItems = async (engId: string): Promise<void> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/completion`)
      .set(bearer(pa))
      .expect(200);
    const items = res.body[0].items as Array<{ id: string; version: number }>;
    for (const it of items) {
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${engId}/statutory-audit/completion/items/${it.id}`)
        .set(bearer(pa))
        .send({ state: 'complete', version: it.version })
        .expect(201);
    }
  };

  const getCompletion = async (engId: string): Promise<StatutoryAuditCompletion> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/completion`)
      .set(bearer(pa))
      .expect(200);
    return res.body[0];
  };

  // ── §36: provisioning ───────────────────────────────────────────────────────

  it('Add Statutory Audit → one service instance + one ten-phase workflow shell', async () => {
    const { engId } = await newAuditFile();
    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    expect(shells.body).toHaveLength(1);
    expect(shells.body[0].phases).toHaveLength(10);
    const framework = shells.body[0].phases.find(
      (p: { phaseKey: string }) => p.phaseKey === 'framework',
    );
    const completion = shells.body[0].phases.find(
      (p: { phaseKey: string }) => p.phaseKey === 'completion',
    );
    expect(framework.state).toBe('in_progress');
    expect(completion.state).toBe('locked');
  });

  // ── §36: generation gating + idempotency ────────────────────────────────────

  it('Framework incomplete → generation does not incorrectly unlock work (409)', async () => {
    const { engId, shellId } = await newAuditFile();
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/work-areas/generate`)
      .set(bearer(pa))
      .expect(409);
    // The Audit Areas phase stays locked until work is generated.
    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    const areasPhase = shells.body[0].phases.find(
      (p: { phaseKey: string }) => p.phaseKey === 'audit_areas',
    );
    expect(areasPhase.state).toBe('locked');
  });

  it('Run generation twice → no duplicate work areas, and Audit Areas unlocks', async () => {
    const { engId, shellId } = await newAuditFile();
    await approveFramework(engId, shellId, { caroApplicable: true });
    const first = await generate(engId, shellId);
    const second = await generate(engId, shellId);
    const activeKeys = (as: Array<{ workAreaKey: string; isActive: boolean }>) =>
      as
        .filter((a) => a.isActive)
        .map((a) => a.workAreaKey)
        .sort();
    expect(activeKeys(second)).toEqual(activeKeys(first));

    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pa))
      .expect(200);
    const phases = shells.body[0].phases as Array<{ phaseKey: string; state: string }>;
    expect(phases.find((p) => p.phaseKey === 'audit_areas')!.state).toBe('in_progress');
    expect(phases.find((p) => p.phaseKey === 'completion')!.state).toBe('not_started');
  });

  // ── §36: CARO activation / deactivation ─────────────────────────────────────

  it('CARO applicable → CARO workstream activated', async () => {
    const { engId, shellId } = await newAuditFile();
    await approveFramework(engId, shellId, { caroApplicable: true });
    const areas = await generate(engId, shellId);
    const caro = areas.find((a) => a.workAreaKey === 'caro');
    expect(caro?.isActive).toBe(true);
  });

  it('CARO not applicable → no active CARO work; the not-applicable reason is retained', async () => {
    const { engId, shellId } = await newAuditFile();
    await approveFramework(engId, shellId, { caroApplicable: false });
    const areas = await generate(engId, shellId);
    const caroActive = areas.some((a) => a.workAreaKey === 'caro' && a.isActive);
    expect(caroActive).toBe(false);

    const fw = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/framework`)
      .set(bearer(pa))
      .expect(200);
    const caroAssessment = (
      fw.body[0].assessments as Array<{ areaKey: string; conclusion: string }>
    ).find((a) => a.areaKey === 'caro');
    expect(caroAssessment?.conclusion).toBe('not_applicable');
  });

  // ── §36: completion blocked by an open blocking review note ─────────────────

  it('Blocking review note open → completion cannot be approved until it is cleared', async () => {
    const { engId, shellId } = await newAuditFile();
    await approveFramework(engId, shellId, { caroApplicable: true });
    const areas = await generate(engId, shellId);
    await resolveAllCompletionItems(engId);

    // Raise a BLOCKING review note against an active area.
    const target = areas.find((a) => a.isActive)!;
    const raised = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/review/notes`)
      .set(bearer(pa))
      .send({
        targetType: 'work_area',
        targetId: target.id,
        body: 'Significant matter — resolve before completion.',
        isBlocking: true,
      })
      .expect(201);
    const note = (
      raised.body.notes as Array<{ id: string; isBlocking: boolean; version: number }>
    ).find((n) => n.isBlocking)!;

    // Completion approval is blocked by the open blocking note (§29).
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/completion/approve`)
      .set(bearer(pa))
      .send({})
      .expect(400);

    // Clear the note → completion can now be approved.
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/review/notes/${note.id}/clear`)
      .set(bearer(pa))
      .send({ version: note.version })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/completion/approve`)
      .set(bearer(pa))
      .send({})
      .expect(201);
  });

  // ── §36: full completion → sign-off → archive → locked ──────────────────────

  it('Sign-off is gated, then Archive locks the file (recoverable, immutable)', async () => {
    const { engId, shellId } = await newAuditFile();
    await approveFramework(engId, shellId, { caroApplicable: true });
    await generate(engId, shellId);

    // Before areas are concluded, sign-off is refused (§29 — areas open).
    await resolveAllCompletionItems(engId);
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/completion/approve`)
      .set(bearer(pa))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/sign-off`)
      .set(bearer(pa))
      .send({})
      .expect(400);

    // Conclude every area → sign-off now permitted.
    await concludeAllAreas(engId);
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/sign-off`)
      .set(bearer(pa))
      .send({ memo: 'Signed off (e2e).' })
      .expect(201);

    // Archive + lock.
    const archived = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/archive`)
      .set(bearer(pa))
      .send({ note: 'Archived (e2e).' })
      .expect(201);
    expect(archived.body.gate.archived).toBe(true);
    expect(archived.body.status).toBe('archived');

    // Locked: a further checklist edit is rejected, and the evidence is still readable.
    const items = archived.body.items as Array<{ id: string; version: number }>;
    const firstItem = items[0]!;
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/completion/items/${firstItem.id}`)
      .set(bearer(pa))
      .send({ state: 'in_progress', version: firstItem.version })
      .expect(409);

    const stillReadable = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/completion`)
      .set(bearer(pa))
      .expect(200);
    expect(stillReadable.body[0].gate.archived).toBe(true);
  });

  // ── §36/§30: reassessment re-opens a completed file ─────────────────────────

  it('Materiality revised → affected work flagged and a completion-approved file re-opens', async () => {
    const { engId, shellId } = await newAuditFile();
    await approveFramework(engId, shellId, { caroApplicable: true });
    await generate(engId, shellId);
    await resolveAllCompletionItems(engId);
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/completion/approve`)
      .set(bearer(pa))
      .send({})
      .expect(201);
    expect((await getCompletion(engId)).gate.completionApproved).toBe(true);

    // Raise a materiality reassessment → the file re-opens (approval cleared).
    const re = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/reassessments`)
      .set(bearer(pa))
      .send({
        changeType: 'materiality_revised',
        reason: 'Benchmark restated after year-end adjustment.',
      })
      .expect(201);
    expect(re.body.openCount).toBe(1);
    expect(re.body.events[0].impact).toMatchObject({ planning: true, work: true });

    expect((await getCompletion(engId)).gate.completionApproved).toBe(false);
  });

  // ── §35: assignment-scoped security ─────────────────────────────────────────

  it('Unauthorized user (not on the engagement) cannot retrieve or mutate protected data', async () => {
    const { engId, shellId } = await newAuditFile();
    await approveFramework(engId, shellId, { caroApplicable: true });

    // RLS filters reads to members — the outsider sees nothing.
    const shells = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit`)
      .set(bearer(pb))
      .expect(200);
    expect(shells.body).toEqual([]);

    const fw = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/statutory-audit/framework`)
      .set(bearer(pb))
      .expect(200);
    expect(fw.body).toEqual([]);

    // And a mutation is refused (the shell is invisible under RLS → 404).
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/statutory-audit/${shellId}/work-areas/generate`)
      .set(bearer(pb))
      .expect(404);
  });

  // ── §36/§35: professional approvals are immutable audit events ──────────────

  it('Professional approvals create immutable audit events', async () => {
    const { engId, shellId } = await newAuditFile();
    await approveFramework(engId, shellId, { caroApplicable: true });

    const audit = await request(app.getHttpServer())
      .get('/api/v1/audit?limit=100')
      .set(bearer(mp))
      .expect(200);
    const actions = (audit.body.items as Array<{ action: string; objectId: string }>)
      .filter((e) => e.objectId === shellId)
      .map((e) => e.action);
    expect(actions).toContain('statutory_audit.framework_approved');
    expect(actions).toContain('statutory_audit.workflow_provisioned');
  });
});

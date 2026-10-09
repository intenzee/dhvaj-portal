import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  type AuditMatterRecord,
  type SignOffCheck,
  type StatutoryAuditAcceptance,
  type StatutoryAuditFramework,
  type StatutoryAuditPlanning,
  type StatutoryAuditRiskRegister,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { answerSection01, answerSection01Clean, recommendSection01 } from './section01.helper';

/**
 * Sections 01–04 drafted from the file: each section's pack mirrors its
 * approval rule, a matter is accepted with the basis the answer already gave,
 * and a blank memo records the draft.
 */
describe('Statutory Audit — Sections 01–04 packs (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(url).set(bearer(t)).send(body);
  const get = (t: string, url: string) =>
    request(app.getHttpServer()).get(url).set(bearer(t)).expect(200);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const check = (checks: SignOffCheck[], key: string): SignOffCheck =>
    checks.find((c) => c.key === key)!;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('drafts 01–04 from the file and records the draft on a blank memo', async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Pack Seed ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: itr,
      financialYear: '2024-25',
      periodLabel: `P${stamp()}`,
      status: 'accepted',
    }).expect(201);
    const engId = eng.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const shellId = (await get(pa, base)).body[0].workflowInstanceId as string;
    const acceptance = async (): Promise<StatutoryAuditAcceptance> =>
      (await get(pa, `${base}/acceptance`)).body[0] as StatutoryAuditAcceptance;

    // ── 01: nothing answered — the pack names the open segments.
    let acc = await acceptance();
    expect(acc.pack.ready).toBe(false);
    const open = check(acc.pack.checks, 'segments_resolved');
    expect(open.ok).toBe(false);
    expect(open.goTo?.anchor).toMatch(/^segment-/);

    // Answer everything favourably except one independence threat, explained.
    await answerSection01Clean(app, pa, engId);
    await answerSection01(app, pa, engId, 'independence_ethics', 'ind_02', 'yes', {
      threat: 'familiarity',
      person: 'Article assistant',
      description: "The article assistant is the CFO's nephew.",
      significance: 'high',
      consultation: 'no',
      conclusion: 'safeguards',
      safeguard: 'Article assistant rotated off the engagement.',
    });
    acc = await acceptance();
    expect(check(acc.pack.checks, 'blocking_matters')).toMatchObject({ ok: false });
    expect(check(acc.pack.checks, 'adverse_answers').facts.join(' ')).toMatch(
      /IND-02/,
    );
    expect(acc.pack.suggestedConclusion).toBe('accept_with_conditions');
    expect(acc.pack.ready).toBe(false);

    // The matter carries the explanation already given — accepted in one step.
    const matters = (await get(pa, `${base}/${shellId}/matters?section=acceptance`))
      .body as AuditMatterRecord[];
    const threat = matters.find((m) => m.source.endsWith(':ind_02'))!;
    expect(threat.suggestedResolution).toBe('Article assistant rotated off the engagement.');
    await post(pa, `${base}/matters/${threat.id}`, {
      status: 'accepted_with_approval',
      resolution: threat.suggestedResolution,
      version: threat.version,
    }).expect(201);
    acc = await acceptance();
    expect(acc.pack.ready).toBe(true);
    expect(acc.pack.draftMemo).toMatch(/^Engagement acceptance — financial year 2024-25/);

    // Approve with a blank memo and a different conclusion: the draft is
    // recorded, ending on the conclusion chosen.
    await recommendSection01(app, pa, engId, shellId);
    await post(pa, `${base}/${shellId}/acceptance/approve`, { conclusion: 'accept' }).expect(201);
    acc = await acceptance();
    expect(acc.approval?.memo).toMatch(/^Engagement acceptance — financial year 2024-25/);
    expect(acc.approval?.memo).toContain('Article assistant rotated off the engagement.');
    expect(acc.approval?.memo?.split('\n').at(-1)).toMatch(/^Conclusion: accept —/);

    // ── 02: undecided areas block; deciding them makes it ready.
    let fw = (await get(pa, `${base}/framework`)).body[0] as StatutoryAuditFramework;
    expect(fw.pack.ready).toBe(fw.undecidedCount === 0);
    for (const a of fw.assessments) {
      await post(pa, `${base}/framework/${a.id}/decision`, {
        conclusion: a.areaKey === 'caro' ? 'applicable' : 'not_applicable',
        basis: 'E2E professional basis.',
        version: a.version,
      }).expect(201);
    }
    fw = (await get(pa, `${base}/framework`)).body[0] as StatutoryAuditFramework;
    expect(check(fw.pack.checks, 'areas_decided').ok).toBe(true);
    expect(fw.pack.draftMemo).toMatch(/^Audit framework — financial year 2024-25/);
    await post(pa, `${base}/${shellId}/framework/approve`, {}).expect(201);
    fw = (await get(pa, `${base}/framework`)).body[0] as StatutoryAuditFramework;
    expect(fw.approval?.memo).toMatch(/^Audit framework — financial year 2024-25/);

    // ── 03: framework now approved; open sub-areas are named with a place to go.
    const planning = (await get(pa, `${base}/planning`)).body[0] as StatutoryAuditPlanning;
    expect(check(planning.pack.checks, 'framework_approved').ok).toBe(true);
    const items = check(planning.pack.checks, 'items_complete');
    expect(items.ok).toBe(false);
    expect(items.goTo?.anchor).toMatch(/^planning-/);
    expect(planning.pack.draftMemo).toMatch(/^Audit planning — financial year 2024-25/);

    // ── 04: the register is not ready until planning is approved.
    const risk = (await get(pa, `${base}/risks`)).body[0] as StatutoryAuditRiskRegister;
    expect(check(risk.pack.checks, 'planning_approved')).toMatchObject({
      ok: false,
      goTo: { phaseKey: 'planning' },
    });
    expect(risk.pack.ready).toBe(false);
    expect(risk.pack.draftMemo).toBeNull();
  }, 30_000);
});

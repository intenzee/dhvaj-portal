import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StatutoryAuditAcceptance, StatutoryAuditReview } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { answerSection01 } from './section01.helper';

/**
 * Section 01 context panel (spec §13): a continuing audit starts a segment
 * from last year's answers (never its dates), and the reviewer leaves review
 * notes on a segment where the work is done.
 */
describe('Statutory Audit — Section 01 roll-forward and review notes (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let pb: string;
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

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it("rolls last year's answers forward and takes review notes on a segment", async () => {
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Roll Forward Seed ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const file = async (financialYear: string): Promise<string> => {
      const eng = await post(pa, '/api/v1/engagements', {
        entityId: entity.body.id,
        serviceId: itr,
        financialYear,
        periodLabel: `P${stamp()}`,
        status: 'accepted',
      }).expect(201);
      await post(pa, `/api/v1/engagements/${eng.body.id}/services`, { serviceId: stat }).expect(
        201,
      );
      return eng.body.id as string;
    };

    // Last year: the checklist and the appointment date were answered.
    const priorId = await file('2023-24');
    await answerSection01(app, pa, priorId, 'appointment_eligibility', 'el_firm', 'clear');
    await answerSection01(app, pa, priorId, 'appointment_eligibility', 'el_tenure', 'na');
    await answerSection01(app, pa, priorId, 'appointment_eligibility', 'app_02', '2023-09-30');

    // This year: a continuing audit with last year's file in DHVAJ.
    const engId = await file('2024-25');
    const accUrl = `/api/v1/engagements/${engId}/statutory-audit/acceptance`;
    let acc = (await get(pa, accUrl)).body[0] as StatutoryAuditAcceptance;
    expect(acc.context.firstYear).toBe(false);
    expect(acc.context.priorYear?.answers.el_firm?.answer).toBe('clear');
    expect(acc.context.priorYear?.answers.app_02?.answer).toBe('2023-09-30');
    const seg = acc.segments.find((s) => s.segmentKey === 'appointment_eligibility')!;
    await answerSection01(app, pa, engId, 'appointment_eligibility', 'el_tenure', 'clear');

    acc = (await post(pa, `${accUrl}/segments/${seg.id}/roll-forward`).expect(201)).body;
    const answers = acc.segments.find((s) => s.id === seg.id)!.answers;
    const answerOf = (k: string) => answers.find((a) => a.questionKey === k)?.answer;
    expect(answerOf('el_firm')).toBe('clear');
    // This year's own answer stays; dates are this year's to give.
    expect(answerOf('el_tenure')).toBe('clear');
    expect(answerOf('app_02')).toBeUndefined();
    // Nothing left to copy → a clear 400; an outsider cannot roll forward.
    await post(pa, `${accUrl}/segments/${seg.id}/roll-forward`).expect(400);
    expect([403, 404]).toContain(
      (await post(pb, `${accUrl}/segments/${seg.id}/roll-forward`)).status,
    );

    // A review note on the segment: Partner-level, labelled with the segment.
    const shellId = acc.workflowInstanceId;
    await post(pa, `/api/v1/engagements/${engId}/statutory-audit/${shellId}/review/notes`, {
      targetType: 'acceptance_segment',
      targetId: seg.id,
      body: 'Attach the consent certificate before approval.',
    }).expect(201);
    const review = (await get(pa, `/api/v1/engagements/${engId}/statutory-audit/review`))
      .body[0] as StatutoryAuditReview;
    expect(review.notes.find((n) => n.targetId === seg.id)).toMatchObject({
      targetType: 'acceptance_segment',
      targetLabel: 'Section 01 · Appointment & Eligibility',
      reviewLevel: 'partner',
      status: 'open',
    });
    // A segment of another engagement is refused.
    const otherSeg = (await get(pa, `/api/v1/engagements/${priorId}/statutory-audit/acceptance`))
      .body[0].segments[0].id as string;
    await post(pa, `/api/v1/engagements/${engId}/statutory-audit/${shellId}/review/notes`, {
      targetType: 'acceptance_segment',
      targetId: otherSeg,
      body: 'Wrong file.',
    }).expect(400);
  }, 30_000);
});

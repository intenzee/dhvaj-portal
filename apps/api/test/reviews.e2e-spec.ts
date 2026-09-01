import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Phase 7 — Review & Sign-off Engine, through the HTTP API.
 *
 * The two mandated acceptance scenarios:
 *   1. ITR (manager_review): manager reviews AND completes; EP stays accountable.
 *   2. Statutory Audit (full_ep_review): a manager cannot sign off / complete
 *      without EP sign-off — the system blocks it.
 * Plus: review points + resolution, escalate-only review plan, reopen
 * invalidating the sign-off, sign-off history, and role/RLS negatives.
 */
describe('Review & Sign-off Engine (e2e)', () => {
  let app: INestApplication;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePeriod = (): string => `R${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const findEntityId = async (search: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/entities?search=${search}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findServiceId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/services?search=${code}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findEmployeeId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/employees?limit=100`)
      .set(bearer(mp));
    return (res.body.items as Array<{ employeeCode: string; id: string }>).find(
      (e) => e.employeeCode === code,
    )!.id;
  };

  /** Create → (assign manager) → start, leaving the engagement ACTIVE and signable. */
  const setupActive = async (opts: {
    epToken: string;
    serviceCode: string;
    managerCode?: string;
    entitySearch?: string;
  }): Promise<{ id: string; version: number; epId: string }> => {
    const entityId = await findEntityId(opts.entitySearch ?? 'Bharat'); // North client
    const serviceId = await findServiceId(opts.serviceCode);
    const created = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(opts.epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2024-25',
        periodLabel: uniquePeriod(),
        status: 'accepted',
      })
      .expect(201);
    const id = created.body.id as string;
    let version = created.body.version as number;
    if (opts.managerCode) {
      const mgrId = await findEmployeeId(opts.managerCode);
      const patched = await request(app.getHttpServer())
        .patch(`/api/v1/engagements/${id}`)
        .set(bearer(mp))
        .send({ engagementManagerEmployeeId: mgrId })
        .expect(200);
      version = patched.body.version;
    }
    const started = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${id}/start`)
      .set(bearer(opts.epToken))
      .send({ version })
      .expect(201);
    return { id, version: started.body.version, epId: created.body.engagementPartnerId };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('effective review model surfaced on the engagement', () => {
    it('inherits the service default (manager_review for ITR, full_ep_review for statutory audit)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const itr = await setupActive({ epToken: pa, serviceCode: 'ITR_FILING' });
      const itrDetail = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${itr.id}`)
        .set(bearer(pa))
        .expect(200);
      expect(itrDetail.body.effectiveReviewModel.slug).toBe('manager_review');
      expect(itrDetail.body.effectiveReviewModel.requiresEpSignoff).toBe(false);
      expect(itrDetail.body.reviewPlanModel).toBeNull();
      expect(itrDetail.body.isSignedOff).toBe(false);

      const audit = await setupActive({ epToken: pa, serviceCode: 'STAT_AUDIT' });
      const auditDetail = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${audit.id}`)
        .set(bearer(pa))
        .expect(200);
      expect(auditDetail.body.effectiveReviewModel.slug).toBe('full_ep_review');
      expect(auditDetail.body.effectiveReviewModel.requiresEpSignoff).toBe(true);
    });
  });

  // ── ACCEPTANCE SCENARIO 1 ────────────────────────────────────────────────
  describe('Scenario 1 — ITR: manager reviews AND completes (EP stays accountable)', () => {
    it('lets the manager review, sign off, and complete a manager_review service', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const mgr = await token('manager.x@dhvaj.in');
      const eng = await setupActive({
        epToken: pa,
        serviceCode: 'ITR_FILING',
        managerCode: 'EMP005',
      });

      // Manager records a manager review.
      const reviewed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(mgr))
        .send({ reviewType: 'manager_review', outcome: 'cleared', notes: 'return checks out' })
        .expect(201);
      expect(reviewed.body.openReviewPointCount).toBe(0);

      // Manager signs off — permitted because the model is manager_review.
      const signedOff = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(mgr))
        .send({ version: reviewed.body.version })
        .expect(201);
      expect(signedOff.body.isSignedOff).toBe(true);
      expect(signedOff.body.signedOffByName).toBe('Manager X');

      // Manager completes — allowed at manager level for this service.
      const completed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/complete`)
        .set(bearer(mgr))
        .send({ version: signedOff.body.version })
        .expect(201);
      expect(completed.body.status).toBe('completed');
      // EP remains accountable throughout (§2.1).
      expect(completed.body.engagementPartnerName).toBe('Partner A');
    });
  });

  // ── ACCEPTANCE SCENARIO 2 ────────────────────────────────────────────────
  describe('Scenario 2 — Statutory Audit: manager cannot complete without EP sign-off', () => {
    it('blocks the manager at sign-off (403) and at completion (400); the EP unblocks it', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const mgr = await token('manager.x@dhvaj.in');
      const eng = await setupActive({
        epToken: pa,
        serviceCode: 'STAT_AUDIT',
        managerCode: 'EMP005',
      });

      // Manager may do their normal review…
      const reviewed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(mgr))
        .send({ reviewType: 'manager_review', outcome: 'cleared' })
        .expect(201);

      // …but may NOT sign off a full_ep_review service.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(mgr))
        .send({ version: reviewed.body.version })
        .expect(403);

      // …nor record an EP review (only the accountable EP may).
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(mgr))
        .send({ reviewType: 'ep_review', outcome: 'cleared' })
        .expect(403);

      // …and completion is blocked while unsigned.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/complete`)
        .set(bearer(mgr))
        .send({})
        .expect(400);

      // The accountable EP performs the EP review + sign-off, then completes.
      const epReview = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(pa))
        .send({ reviewType: 'ep_review', outcome: 'cleared', notes: 'key matters reviewed' })
        .expect(201);
      const epSigned = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(pa))
        .send({ version: epReview.body.version })
        .expect(201);
      expect(epSigned.body.signedOffByName).toBe('Partner A');
      const completed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/complete`)
        .set(bearer(pa))
        .send({ version: epSigned.body.version })
        .expect(201);
      expect(completed.body.status).toBe('completed');
    });
  });

  // ── Review points & resolution ───────────────────────────────────────────
  describe('review points block sign-off until resolved', () => {
    it('raises a point on an EP review, blocks sign-off, then clears after resolution', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'STAT_AUDIT' });

      const reviewed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(pa))
        .send({
          reviewType: 'ep_review',
          outcome: 'returned',
          notes: 'address before sign-off',
          reviewPoints: [
            { matter: 'Confirm related-party disclosures', isKeyMatter: true },
            { matter: 'Recompute deferred tax' },
          ],
        })
        .expect(201);
      expect(reviewed.body.openReviewPointCount).toBe(2);

      // Sign-off blocked while points are open.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(pa))
        .send({})
        .expect(400);

      // Find the points via the review history and resolve them.
      const history = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(pa))
        .expect(200);
      const points = (history.body.items as Array<{ points: Array<{ id: string }> }>).flatMap(
        (r) => r.points,
      );
      expect(points.length).toBe(2);

      let version = reviewed.body.version as number;
      for (const point of points) {
        const resolved = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${eng.id}/review-points/${point.id}/resolve`)
          .set(bearer(pa))
          .send({ resolution: 'addressed and re-reviewed' })
          .expect(201);
        version = resolved.body.version;
      }
      const cleared = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng.id}`)
        .set(bearer(pa))
        .expect(200);
      expect(cleared.body.openReviewPointCount).toBe(0);

      // Now sign-off + complete succeed.
      const signed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(pa))
        .send({ version })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/complete`)
        .set(bearer(pa))
        .send({ version: signed.body.version })
        .expect(201);
    });
  });

  // ── Review plan escalation (§2.1 / §2.4) ─────────────────────────────────
  describe('review plan is escalate-only', () => {
    it('lets the EP raise ITR to full EP review (then the manager can no longer sign off)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const mgr = await token('manager.x@dhvaj.in');
      const eng = await setupActive({
        epToken: pa,
        serviceCode: 'ITR_FILING',
        managerCode: 'EMP005',
      });

      // Escalate the review plan to full EP review.
      const escalated = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/review-plan`)
        .set(bearer(pa))
        .send({ reviewModelSlug: 'full_ep_review', version: eng.version })
        .expect(201);
      expect(escalated.body.reviewPlanModel.slug).toBe('full_ep_review');
      expect(escalated.body.effectiveReviewModel.requiresEpSignoff).toBe(true);

      // Manager can no longer sign off — the plan now requires EP sign-off.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(mgr))
        .send({})
        .expect(403);
    });

    it('rejects weakening the review plan below the service requirement (400)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      // Statutory audit requires full_ep_review; manager_review is weaker.
      const eng = await setupActive({ epToken: pa, serviceCode: 'STAT_AUDIT' });
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/review-plan`)
        .set(bearer(pa))
        .send({ reviewModelSlug: 'manager_review', version: eng.version })
        .expect(400);
    });

    it('forbids a non-EP lead (the manager) from setting the review plan (403)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const mgr = await token('manager.x@dhvaj.in');
      const eng = await setupActive({
        epToken: pa,
        serviceCode: 'ITR_FILING',
        managerCode: 'EMP005',
      });
      // The plan is the accountable EP's decision — a lead manager cannot set it.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/review-plan`)
        .set(bearer(mgr))
        .send({ reviewModelSlug: 'full_ep_review' })
        .expect(403);
    });
  });

  // ── Sign-off is terminal to further review changes ───────────────────────
  describe('sign-off is terminal to review changes (no silent gate bypass)', () => {
    it('blocks recording a new review once signed off (409)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'ITR_FILING' });
      const signed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(pa))
        .send({ version: eng.version })
        .expect(201);
      expect(signed.body.isSignedOff).toBe(true);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(pa))
        .send({
          reviewType: 'manager_review',
          outcome: 'returned',
          reviewPoints: [{ matter: 'late finding' }],
        })
        .expect(409);
    });

    it('blocks escalating the review plan once signed off — so a manager sign-off cannot be silently invalidated (400)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const mgr = await token('manager.x@dhvaj.in');
      const eng = await setupActive({
        epToken: pa,
        serviceCode: 'ITR_FILING',
        managerCode: 'EMP005',
      });
      // Manager validly signs off a manager_review engagement.
      const signed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(mgr))
        .send({ version: eng.version })
        .expect(201);
      expect(signed.body.isSignedOff).toBe(true);
      // The EP cannot now escalate to an EP-required model behind the sign-off —
      // that would leave a manager sign-off passing an EP-required completion gate.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/review-plan`)
        .set(bearer(pa))
        .send({ reviewModelSlug: 'full_ep_review', version: signed.body.version })
        .expect(400);
    });
  });

  // ── Reopen invalidates the sign-off ──────────────────────────────────────
  describe('reopening a completed engagement invalidates its sign-off', () => {
    it('requires a fresh sign-off before it can complete again', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'ITR_FILING' });

      const signed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(pa))
        .send({ version: eng.version })
        .expect(201);
      const completed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/complete`)
        .set(bearer(pa))
        .send({ version: signed.body.version })
        .expect(201);

      // MP reopens — the prior sign-off is superseded.
      const reopened = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reopen`)
        .set(bearer(mp))
        .send({ reason: 'client provided revised figures', version: completed.body.version })
        .expect(201);
      expect(reopened.body.status).toBe('active');
      expect(reopened.body.isSignedOff).toBe(false);

      // Completion is blocked again until a fresh sign-off is recorded.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/complete`)
        .set(bearer(pa))
        .send({ version: reopened.body.version })
        .expect(400);

      const resigned = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(pa))
        .send({ version: reopened.body.version })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/complete`)
        .set(bearer(pa))
        .send({ version: resigned.body.version })
        .expect(201);
    });
  });

  // ── Sign-off history (deliverable 8) ─────────────────────────────────────
  describe('sign-off history', () => {
    it('lists every review + sign-off, newest first, with review points', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'STAT_AUDIT' });
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(pa))
        .send({
          reviewType: 'ep_review',
          outcome: 'cleared',
          reviewPoints: [{ matter: 'note for file' }],
        })
        .expect(201);
      // resolve the point so we can sign off
      const hist0 = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(pa))
        .expect(200);
      const pt = (hist0.body.items as Array<{ points: Array<{ id: string }> }>).flatMap(
        (r) => r.points,
      )[0]!;
      const resolved = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/review-points/${pt.id}/resolve`)
        .set(bearer(pa))
        .send({ resolution: 'noted' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(pa))
        .send({ version: resolved.body.version })
        .expect(201);

      const history = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(pa))
        .expect(200);
      const types = (history.body.items as Array<{ reviewType: string }>).map((r) => r.reviewType);
      expect(types).toContain('sign_off');
      expect(types).toContain('ep_review');
      // Newest first: the sign-off (recorded last) leads.
      expect(history.body.items[0].reviewType).toBe('sign_off');
    });
  });

  // ── Role / RLS negatives ─────────────────────────────────────────────────
  describe('authority & RLS', () => {
    it('forbids a Senior (no engagement.manage) from recording a review (403)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'STAT_AUDIT' });
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(await token('senior.y@dhvaj.in')))
        .send({ reviewType: 'manager_review', outcome: 'cleared' })
        .expect(403);
    });

    it('does not let an unassigned partner sign off another partner’s engagement (404)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'ITR_FILING' });
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(await token('partner.b@dhvaj.in')))
        .send({})
        .expect(404);
    });

    it('cannot record a review on an engagement that is not active (400)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ITR_FILING');
      // Created at 'accepted' but never started.
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/sign-off`)
        .set(bearer(pa))
        .send({})
        .expect(400);
    });
  });
});

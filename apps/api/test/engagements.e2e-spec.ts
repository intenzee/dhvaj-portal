import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Engagement core through the HTTP API: assignment-based access (independent of
 * office), audited creation/management, EP-reassignment governance, and
 * engagement identity uniqueness.
 */
describe('Engagement Core (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const codes = (items: Array<{ engagementCode: string }>): string[] =>
    items.map((e) => e.engagementCode).sort();
  // Unique period label per run so tests don't collide on engagement identity
  // in a shared dev DB (CI runs against a fresh database).
  const uniquePeriod = (): string => `P${Date.now()}${Math.floor(Math.random() * 1000)}`;

  // Resolve some ids via the API as the Managing Partner (sees everything).
  let mp: string;
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

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('assignment-based reads (independent of office)', () => {
    it('gives the Managing Partner every engagement', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/engagements')
        .set(bearer(mp))
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('shows the EP their own engagement', async () => {
      // limit=100: partner.a accrues many engagements across the suite (incl.
      // Phase 6's lifecycle tests below), so the default page can't be relied
      // on to still contain the oldest (seeded) one.
      const res = await request(app.getHttpServer())
        .get('/api/v1/engagements?limit=100')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
      expect(codes(res.body.items)).toContain('ENG00001');
    });

    it('gives a cross-office team member the engagement + client + roster', async () => {
      // Senior Y (South office) is on the North Acme engagement's team.
      const sy = await token('senior.y@hsdg.in');
      const list = await request(app.getHttpServer())
        .get('/api/v1/engagements')
        .set(bearer(sy))
        .expect(200);
      expect(codes(list.body.items)).toContain('ENG00001');

      const eng = list.body.items.find(
        (e: { engagementCode: string }) => e.engagementCode === 'ENG00001',
      );
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng.id}`)
        .set(bearer(sy))
        .expect(200);
      // The North EP's name is visible to the South team member (shared engagement).
      expect(detail.body.engagementPartnerName).toBe('Partner A');
      expect(detail.body.entityName).toBe('Acme Manufacturing Pvt Ltd');
      expect(detail.body.team.length).toBeGreaterThanOrEqual(2);
    });

    it('does NOT show an unassigned partner another partner’s engagement (404 by id)', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/engagements?limit=100')
        .set(bearer(mp));
      const acme = list.body.items.find(
        (e: { engagementCode: string }) => e.engagementCode === 'ENG00001',
      );
      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${acme.id}`)
        .set(bearer(await token('partner.b@hsdg.in')))
        .expect(404);
    });

    it('supports ?mine=true', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/engagements?mine=true&limit=100')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
      expect(codes(res.body.items)).toContain('ENG00001');
    });

    it('forbids the platform admin (no engagement.read) from listing engagements (403)', async () => {
      // Checkpoint role separation: technical admin has no engagement access.
      await request(app.getHttpServer())
        .get('/api/v1/engagements')
        .set(bearer(await token('admin@hsdg.in')))
        .expect(403);
    });
  });

  describe('creation & management (audited)', () => {
    it('lets a Partner create their own engagement (becomes EP), audited', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat'); // North client
      const serviceId = await findServiceId('ITR_FILING');
      const correlationId = `corr-eng-${Date.now()}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .set('x-correlation-id', correlationId)
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201);
      expect(created.body.engagementCode).toMatch(/^ENG\d{5}$/);
      expect(created.body.engagementPartnerName).toBe('Partner A');
      expect(created.body.acceptedAt).toBeTruthy();

      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(mp));
      const event = (
        audit.body.items as Array<{ action: string; objectId: string; correlationId: string }>
      ).find((e) => e.action === 'engagement.created' && e.correlationId === correlationId);
      expect(event?.objectId).toBe(created.body.id);
    });

    it('enforces engagement identity uniqueness (409)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('GST_MONTHLY');
      const body = { entityId, serviceId, financialYear: '2023-24', periodLabel: uniquePeriod() };
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send(body)
        .expect(409);
    });

    it('forbids a Senior (no engagement.manage) from creating (403)', async () => {
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ITR_FILING');
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(await token('senior.y@hsdg.in')))
        .send({ entityId, serviceId, financialYear: '2022-23' })
        .expect(403);
    });

    it('assigns and removes a team member (audited)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('BOOKKEEPING');
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
      const articleN = await findEmployeeId('EMP007');

      const assigned = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/team`)
        .set(bearer(pa))
        .send({ employeeId: articleN, roleOnEngagement: 'member' })
        .expect(201);
      expect(
        assigned.body.team.some((t: { employeeId: string }) => t.employeeId === articleN),
      ).toBe(true);

      const removed = await request(app.getHttpServer())
        .delete(`/api/v1/engagements/${created.body.id}/team/${articleN}`)
        .set(bearer(pa))
        .expect(200);
      expect(removed.body.team.some((t: { employeeId: string }) => t.employeeId === articleN)).toBe(
        false,
      );
    });

    it('reassigns the EP only with firm-wide authority (governance)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('TAX_ADVISORY');
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
      const partnerB = await findEmployeeId('EMP004');

      // The EP (a partner) cannot hand off accountability themselves.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/reassign-partner`)
        .set(bearer(pa))
        .send({ engagementPartnerEmployeeId: partnerB })
        .expect(403);

      // The Managing Partner can.
      const ok = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/reassign-partner`)
        .set(bearer(mp))
        .send({ engagementPartnerEmployeeId: partnerB, reason: 'handoff' })
        .expect(201);
      expect(ok.body.engagementPartnerName).toBe('Partner B');
    });

    it('enforces optimistic concurrency on update (stale version ⇒ 409)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ROC_ANNUAL');
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
        })
        .expect(201);
      const v0 = created.body.version as number;
      await request(app.getHttpServer())
        .patch(`/api/v1/engagements/${created.body.id}`)
        .set(bearer(pa))
        .send({ plannedStartDate: '2024-04-01', version: v0 })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/engagements/${created.body.id}`)
        .set(bearer(pa))
        .send({ plannedEndDate: '2025-03-31', version: v0 })
        .expect(409);
    });

    it('rejects "status" on the generic PATCH — lifecycle moves only through transition endpoints (Phase 6)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ROC_ANNUAL');
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({ entityId, serviceId, financialYear: '2022-23', periodLabel: uniquePeriod() })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/engagements/${created.body.id}`)
        .set(bearer(pa))
        .send({ status: 'active' })
        .expect(400);
    });
  });

  describe('accountability grade rules (checkpoint)', () => {
    it('rejects a non-partner Engagement Partner (400)', async () => {
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ITR_FILING');
      const seniorEmp = await findEmployeeId('EMP006'); // Senior Y
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(mp)) // firm-wide, so RLS is not the gate — the grade trigger is
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          engagementPartnerEmployeeId: seniorEmp,
        })
        .expect(400);
    });

    it('rejects a non-manager Engagement Manager (400)', async () => {
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('ITR_FILING');
      const articleEmp = await findEmployeeId('EMP007'); // Article North
      await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(mp))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          engagementManagerEmployeeId: articleEmp,
        })
        .expect(400);
    });

    it('a Manager creating becomes the engagement Manager (not the EP)', async () => {
      const entityId = await findEntityId('Bharat'); // North client
      const serviceId = await findServiceId('GST_MONTHLY');
      const created = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(await token('manager.x@hsdg.in')))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'prospect',
        })
        .expect(201);
      expect(created.body.engagementManagerName).toBe('Manager X');
      expect(created.body.engagementPartnerId).toBeNull();
    });
  });

  describe('concurrency consistency (checkpoint)', () => {
    it('bumps the engagement version when the team changes', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('INT_AUDIT');
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
      const article = await findEmployeeId('EMP007');
      const assigned = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/team`)
        .set(bearer(pa))
        .send({ employeeId: article, roleOnEngagement: 'member' })
        .expect(201);
      expect(assigned.body.version).toBeGreaterThan(created.body.version);
    });

    it('reassign honours optimistic concurrency (stale version ⇒ 409)', async () => {
      const pa = await token('partner.a@hsdg.in');
      const entityId = await findEntityId('Bharat');
      const serviceId = await findServiceId('TAX_ADVISORY');
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
      const v0 = created.body.version as number;
      const partnerB = await findEmployeeId('EMP004');
      const partnerA = await findEmployeeId('EMP003');
      // Correct version succeeds (firm-wide MP performs the governance action).
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/reassign-partner`)
        .set(bearer(mp))
        .send({ engagementPartnerEmployeeId: partnerB, version: v0 })
        .expect(201);
      // Re-using the now-stale version is rejected.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${created.body.id}/reassign-partner`)
        .set(bearer(mp))
        .send({ engagementPartnerEmployeeId: partnerA, version: v0 })
        .expect(409);
    });
  });

  // ── Phase 6: lifecycle transitions & the service-workflow instance ────────
  describe('lifecycle transitions (Phase 6)', () => {
    /** Create directly at 'accepted' (existing pattern) so a test can start mid-chain. */
    const createAccepted = async (
      actorToken: string,
      serviceCode: string,
      entitySearch = 'Bharat',
    ): Promise<{ id: string; version: number; engagementPartnerId: string }> => {
      const entityId = await findEntityId(entitySearch);
      const serviceId = await findServiceId(serviceCode);
      const res = await request(app.getHttpServer())
        .post('/api/v1/engagements')
        .set(bearer(actorToken))
        .send({
          entityId,
          serviceId,
          financialYear: '2024-25',
          periodLabel: uniquePeriod(),
          status: 'accepted',
        })
        .expect(201);
      return {
        id: res.body.id,
        version: res.body.version,
        engagementPartnerId: res.body.engagementPartnerId,
      };
    };

    describe('the primary chain + side states', () => {
      it('walks prospect → pending_acceptance → accepted → active → completed → closed, audited and versioned throughout', async () => {
        const mgr = await token('manager.x@hsdg.in');
        const entityId = await findEntityId('Bharat');
        const serviceId = await findServiceId('GST_MONTHLY'); // short filing_workflow chain
        // Manager creates: defaults to manager, NOT EP (grade-aware defaulting).
        const created = await request(app.getHttpServer())
          .post('/api/v1/engagements')
          .set(bearer(mgr))
          .send({ entityId, serviceId, financialYear: '2024-25', periodLabel: uniquePeriod() })
          .expect(201);
        expect(created.body.status).toBe('prospect');
        expect(created.body.engagementPartnerId).toBeNull();
        let version = created.body.version as number;
        const id = created.body.id as string;

        // 1. prospect -> pending_acceptance
        const submitted = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${id}/submit-for-acceptance`)
          .set(bearer(mgr))
          .send({ version })
          .expect(201);
        expect(submitted.body.status).toBe('pending_acceptance');
        expect(submitted.body.version).toBeGreaterThan(version); // §21 test 21
        version = submitted.body.version;

        // §25 test 24: a failed transition leaves no misleading audit event.
        // submit-for-acceptance above already left one legitimate
        // 'engagement.status_changed' event for this engagement — so the
        // proof is that the COUNT doesn't grow from the failed attempt below,
        // not that it's zero.
        const countStatusChangedEvents = async (): Promise<number> => {
          const res = await request(app.getHttpServer())
            .get('/api/v1/audit?limit=100')
            .set(bearer(mp))
            .expect(200);
          return (res.body.items as Array<{ action: string; objectId: string }>).filter(
            (e) => e.action === 'engagement.status_changed' && e.objectId === id,
          ).length;
        };
        const countBeforeFailedAccept = await countStatusChangedEvents();
        expect(countBeforeFailedAccept).toBeGreaterThanOrEqual(1); // from submit-for-acceptance

        // No EP yet: accept must fail (§7, §25 test 11).
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${id}/accept`)
          .set(bearer(mgr))
          .send({})
          .expect(400);
        expect(submitted.body.status).toBe('pending_acceptance'); // unchanged by the failed attempt
        expect(await countStatusChangedEvents()).toBe(countBeforeFailedAccept); // no misleading event added

        // MP assigns the EP (governance: only firm-wide may set the EP away
        // from nobody-in-particular via reassign-partner).
        const partnerA = await findEmployeeId('EMP003');
        const withEp = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${id}/reassign-partner`)
          .set(bearer(mp))
          .send({ engagementPartnerEmployeeId: partnerA, version })
          .expect(201);
        expect(withEp.body.engagementPartnerId).toBe(partnerA);
        version = withEp.body.version;

        // 2. pending_acceptance -> accepted (§25 test 12: accepted always has an EP)
        const accepted = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${id}/accept`)
          .set(bearer(mp))
          .send({ version })
          .expect(201);
        expect(accepted.body.status).toBe('accepted');
        expect(accepted.body.engagementPartnerId).toBe(partnerA);
        expect(accepted.body.acceptedAt).toBeTruthy();
        version = accepted.body.version;

        // 3. accepted -> active, initialising the service workflow from config.
        const started = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${id}/start`)
          .set(bearer(mp))
          .send({ version })
          .expect(201);
        expect(started.body.status).toBe('active');
        expect(started.body.currentWorkflowState.slug).toBe('preparation'); // filing_workflow's initial state
        version = started.body.version;

        // 4. Cannot complete before sign-off (Phase 7 gate, which replaced the
        // Phase 6 workflow-terminal check). No sign-off yet ⇒ 400.
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${id}/complete`)
          .set(bearer(mp))
          .send({ version })
          .expect(400);

        // Walk the workflow to its terminal state (preparation -> review -> filing -> completed).
        for (let i = 0; i < 3; i += 1) {
          const advanced = await request(app.getHttpServer())
            .post(`/api/v1/engagements/${id}/workflow-transitions`)
            .set(bearer(mp))
            .send({ action: 'advance', version })
            .expect(201);
          expect(advanced.body.status).toBe('active'); // lifecycle untouched by workflow moves
          version = advanced.body.version;
        }

        const readyToComplete = await request(app.getHttpServer())
          .get(`/api/v1/engagements/${id}`)
          .set(bearer(mp))
          .expect(200);
        expect(readyToComplete.body.currentWorkflowState.slug).toBe('completed');
        expect(readyToComplete.body.currentWorkflowState.isTerminal).toBe(true);

        // Phase 7: completion requires a valid sign-off. GST_MONTHLY is a
        // manager_review service, so any engagement lead (here the firm-wide MP)
        // may sign off — no EP sign-off is mandated.
        const signedOff = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${id}/sign-off`)
          .set(bearer(mp))
          .send({ version })
          .expect(201);
        expect(signedOff.body.isSignedOff).toBe(true);
        version = signedOff.body.version;

        // active -> completed
        const completed = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${id}/complete`)
          .set(bearer(mp))
          .send({ version })
          .expect(201);
        expect(completed.body.status).toBe('completed');
        version = completed.body.version;

        // completed -> closed. COMPLETED and CLOSED are distinct (§10): the
        // service workflow's own terminal state did NOT auto-close the engagement.
        const closed = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${id}/close`)
          .set(bearer(mp))
          .send({ version })
          .expect(201);
        expect(closed.body.status).toBe('closed');

        // §25 test 22/26: every hop left an audit event and a history row.
        const history = await request(app.getHttpServer())
          .get(`/api/v1/engagements/${id}/lifecycle-history`)
          .set(bearer(mp))
          .expect(200);
        const actions = (history.body.items as Array<{ action: string }>).map((h) => h.action);
        expect(actions).toEqual(
          expect.arrayContaining(['submit_for_acceptance', 'accept', 'start', 'complete', 'close']),
        );
      });

      it('invalid transition is rejected (400) — e.g. "start" on a fresh prospect', async () => {
        const pa = await token('partner.a@hsdg.in');
        const entityId = await findEntityId('Bharat');
        const serviceId = await findServiceId('TAX_ADVISORY');
        const created = await request(app.getHttpServer())
          .post('/api/v1/engagements')
          .set(bearer(pa))
          .send({ entityId, serviceId, financialYear: '2024-25', periodLabel: uniquePeriod() })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${created.body.id}/start`)
          .set(bearer(pa))
          .send({})
          .expect(400);
      });

      it('declines a pending-acceptance engagement', async () => {
        const pa = await token('partner.a@hsdg.in');
        const entityId = await findEntityId('Bharat');
        const serviceId = await findServiceId('TAX_ADVISORY');
        const created = await request(app.getHttpServer())
          .post('/api/v1/engagements')
          .set(bearer(pa))
          .send({ entityId, serviceId, financialYear: '2024-25', periodLabel: uniquePeriod() })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${created.body.id}/submit-for-acceptance`)
          .set(bearer(pa))
          .send({})
          .expect(201);
        const declined = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${created.body.id}/decline`)
          .set(bearer(pa))
          .send({ reason: 'client went with another firm' })
          .expect(201);
        expect(declined.body.status).toBe('declined');
      });

      it('active -> on_hold -> resume returns to the recorded previous status, not always "active"', async () => {
        const pa = await token('partner.a@hsdg.in');
        const acc = await createAccepted(pa, 'INT_AUDIT');
        const started = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/start`)
          .set(bearer(pa))
          .send({ version: acc.version })
          .expect(201);
        expect(started.body.status).toBe('active');

        const held = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/put-on-hold`)
          .set(bearer(pa))
          .send({ reason: 'awaiting client documents', expectedResumeDate: '2026-09-01' })
          .expect(201);
        expect(held.body.status).toBe('on_hold');
        expect(held.body.onHoldReason).toBe('awaiting client documents');
        expect(held.body.onHoldPreviousStatus).toBe('active');
        // Workflow state is untouched by the hold (§17, §36).
        expect(held.body.currentWorkflowState.slug).toBe(started.body.currentWorkflowState.slug);

        const resumed = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/resume`)
          .set(bearer(pa))
          .send({})
          .expect(201);
        expect(resumed.body.status).toBe('active');
        expect(resumed.body.onHoldReason).toBeNull();
        expect(resumed.body.onHoldPreviousStatus).toBeNull();
      });

      it('put-on-hold requires a reason (400 without one)', async () => {
        const pa = await token('partner.a@hsdg.in');
        const acc = await createAccepted(pa, 'ROC_ANNUAL');
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/start`)
          .set(bearer(pa))
          .send({ version: acc.version })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/put-on-hold`)
          .set(bearer(pa))
          .send({})
          .expect(400);
      });

      it('withdraws an active engagement', async () => {
        const pa = await token('partner.a@hsdg.in');
        const acc = await createAccepted(pa, 'ADVISORY_GEN');
        const started = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/start`)
          .set(bearer(pa))
          .send({ version: acc.version })
          .expect(201);
        const withdrawn = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/withdraw`)
          .set(bearer(pa))
          .send({ reason: 'client ceased operations', version: started.body.version })
          .expect(201);
        expect(withdrawn.body.status).toBe('withdrawn');
      });
    });

    describe('authority (§9, §25 tests 14-19)', () => {
      /**
       * Create (as `pa`), start, walk GST_MONTHLY's short filing_workflow to
       * its terminal state, and complete — so reopen (completed/closed only)
       * has a legal `from_status` to work with. Optionally assigns Manager X
       * so a manager-authority test can reach the guard instead of a 404.
       */
      const completeEngagement = async (
        pa: string,
        withManager = false,
      ): Promise<{ id: string; version: number }> => {
        const acc = await createAccepted(pa, 'GST_MONTHLY');
        let acceptedVersion = acc.version;
        if (withManager) {
          const managerXId = await findEmployeeId('EMP005');
          const withMgr = await request(app.getHttpServer())
            .patch(`/api/v1/engagements/${acc.id}`)
            .set(bearer(mp))
            .send({ engagementManagerEmployeeId: managerXId })
            .expect(200);
          acceptedVersion = withMgr.body.version; // the PATCH bumped version too
        }
        const started = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/start`)
          .set(bearer(pa))
          .send({ version: acceptedVersion })
          .expect(201);
        let version = started.body.version as number;
        for (let i = 0; i < 3; i += 1) {
          const advanced = await request(app.getHttpServer())
            .post(`/api/v1/engagements/${acc.id}/workflow-transitions`)
            .set(bearer(pa))
            .send({ action: 'advance', version })
            .expect(201);
          version = advanced.body.version;
        }
        // Phase 7 sign-off gate: GST_MONTHLY is manager_review, so the EP (pa,
        // a lead) may sign off before completion.
        const signedOff = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/sign-off`)
          .set(bearer(pa))
          .send({ version })
          .expect(201);
        version = signedOff.body.version;
        const completed = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/complete`)
          .set(bearer(pa))
          .send({ version })
          .expect(201);
        return { id: acc.id, version: completed.body.version };
      };

      it('the EP itself cannot reopen (MP-only governance action)', async () => {
        const pa = await token('partner.a@hsdg.in');
        const eng = await completeEngagement(pa);
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${eng.id}/reopen`)
          .set(bearer(pa))
          .send({ reason: 'attempted self-service reopen' })
          .expect(403);
      });

      it('a Manager assigned to the engagement cannot reopen (MP-only governance action)', async () => {
        const pa = await token('partner.a@hsdg.in');
        const eng = await completeEngagement(pa, true);
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${eng.id}/reopen`)
          .set(bearer(await token('manager.x@hsdg.in')))
          .send({ reason: 'manager attempted reopen' })
          .expect(403);
      });

      it('the platform admin cannot reopen — no business-firm-wide governance merely from the admin role', async () => {
        const pa = await token('partner.a@hsdg.in');
        const eng = await completeEngagement(pa);
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${eng.id}/reopen`)
          .set(bearer(await token('admin@hsdg.in')))
          .send({ reason: 'admin attempted reopen' })
          .expect(403);
      });

      it('a Senior (no engagement.manage) cannot perform any lifecycle action', async () => {
        const pa = await token('partner.a@hsdg.in');
        const acc = await createAccepted(pa, 'STAT_AUDIT');
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/start`)
          .set(bearer(await token('senior.y@hsdg.in')))
          .send({})
          .expect(403);
      });

      it('the Managing Partner can reopen a completed engagement (permitted governance action)', async () => {
        const pa = await token('partner.a@hsdg.in');
        const eng = await completeEngagement(pa);

        // Reopen requires a reason (§12, §25 test 38).
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${eng.id}/reopen`)
          .set(bearer(mp))
          .send({ version: eng.version })
          .expect(400);

        // §25 test 41: a STALE version (same status, older version number) is
        // 409 — distinct from a wrong-status attempt, which is 400. Bump the
        // version via an unrelated field first so status stays 'completed'.
        const bumped = await request(app.getHttpServer())
          .patch(`/api/v1/engagements/${eng.id}`)
          .set(bearer(mp))
          .send({ plannedStartDate: '2024-04-01', version: eng.version })
          .expect(200);
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${eng.id}/reopen`)
          .set(bearer(mp))
          .send({ reason: 'stale retry', version: eng.version })
          .expect(409);

        const reopened = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${eng.id}/reopen`)
          .set(bearer(mp))
          .send({ reason: 'client requested additional fieldwork', version: bumped.body.version })
          .expect(201);
        expect(reopened.body.status).toBe('active');

        // Reopen left a history row and an audit event (§25 tests 39-40).
        const history = await request(app.getHttpServer())
          .get(`/api/v1/engagements/${eng.id}/lifecycle-history`)
          .set(bearer(mp))
          .expect(200);
        expect(
          (history.body.items as Array<{ action: string; toStatus: string }>).some(
            (h) => h.action === 'reopen' && h.toStatus === 'active',
          ),
        ).toBe(true);
        const audit = await request(app.getHttpServer())
          .get('/api/v1/audit?limit=100')
          .set(bearer(mp))
          .expect(200);
        expect(
          (audit.body.items as Array<{ action: string; objectId: string }>).some(
            (e) => e.action === 'engagement.status_changed' && e.objectId === eng.id,
          ),
        ).toBe(true);

        // A second reopen attempt is now a genuinely invalid transition
        // (status is already 'active', not 'completed'/'closed') — 400, not 409.
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${eng.id}/reopen`)
          .set(bearer(mp))
          .send({ reason: 'already active', version: reopened.body.version })
          .expect(400);
      });
    });

    describe('service workflow independence (§16-19, §25 tests 33-36)', () => {
      it('gets the correct workflow family + initial state on start, advances independently of lifecycle, and rejects an unconfigured action', async () => {
        const pa = await token('partner.a@hsdg.in');
        const acc = await createAccepted(pa, 'STAT_AUDIT');
        const started = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/start`)
          .set(bearer(pa))
          .send({ version: acc.version })
          .expect(201);
        expect(started.body.currentWorkflowState.slug).toBe('planning'); // audit_workflow's initial state

        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/workflow-transitions`)
          .set(bearer(pa))
          .send({ action: 'not_a_configured_action' })
          .expect(400);

        const advanced = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/workflow-transitions`)
          .set(bearer(pa))
          .send({ action: 'advance', version: started.body.version })
          .expect(201);
        expect(advanced.body.currentWorkflowState.slug).toBe('fieldwork');
        expect(advanced.body.status).toBe('active');

        // Lifecycle changes; workflow state must stay put (independence, §17).
        const held = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/put-on-hold`)
          .set(bearer(pa))
          .send({ reason: 'pausing fieldwork', version: advanced.body.version })
          .expect(201);
        expect(held.body.status).toBe('on_hold');
        expect(held.body.currentWorkflowState.slug).toBe('fieldwork');
      });

      it('cannot advance the workflow while the engagement is not active', async () => {
        const pa = await token('partner.a@hsdg.in');
        const acc = await createAccepted(pa, 'STAT_AUDIT'); // still 'accepted', not started
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/workflow-transitions`)
          .set(bearer(pa))
          .send({ action: 'advance' })
          .expect(400);
      });
    });

    describe('RLS-backed access (§25 tests 28-32)', () => {
      it('an unrelated partner cannot see or act on lifecycle history for an engagement they are not assigned to', async () => {
        const pa = await token('partner.a@hsdg.in');
        const acc = await createAccepted(pa, 'GST_MONTHLY');
        const pb = await token('partner.b@hsdg.in');
        await request(app.getHttpServer())
          .get(`/api/v1/engagements/${acc.id}/lifecycle-history`)
          .set(bearer(pb))
          .expect(404);
        await request(app.getHttpServer())
          .post(`/api/v1/engagements/${acc.id}/start`)
          .set(bearer(pb))
          .send({})
          .expect(404);
      });

      it('a manager shared across two partners can operate lifecycle transitions on both engagements', async () => {
        const pa = await token('partner.a@hsdg.in');
        const pb = await token('partner.b@hsdg.in');
        const mgr = await token('manager.x@hsdg.in');
        const managerXId = await findEmployeeId('EMP005');

        const engA = await createAccepted(pa, 'TAX_ADVISORY', 'Bharat'); // North client
        const engB = await createAccepted(pb, 'ADVISORY_GEN', 'Coastal'); // South client
        // MP assigns Manager X onto both, as the engagement manager (shared
        // resource across partners — ADR-0008's model, applied to Phase 6).
        await request(app.getHttpServer())
          .patch(`/api/v1/engagements/${engA.id}`)
          .set(bearer(mp))
          .send({ engagementManagerEmployeeId: managerXId })
          .expect(200);
        await request(app.getHttpServer())
          .patch(`/api/v1/engagements/${engB.id}`)
          .set(bearer(mp))
          .send({ engagementManagerEmployeeId: managerXId })
          .expect(200);

        const startedA = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${engA.id}/start`)
          .set(bearer(mgr))
          .send({})
          .expect(201);
        expect(startedA.body.status).toBe('active');
        const startedB = await request(app.getHttpServer())
          .post(`/api/v1/engagements/${engB.id}/start`)
          .set(bearer(mgr))
          .send({})
          .expect(201);
        expect(startedB.body.status).toBe('active');
      });
    });
  });
});

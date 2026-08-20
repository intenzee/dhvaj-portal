import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Phase 11 — Notifications, through the HTTP API.
 *
 * The framework: material events become per-recipient notifications, delivered
 * to the in-app portal (persisted) and pluggable external channels. Covered:
 * task assignment, EP change, reopen, EP-sign-off-pending and high-risk (key
 * matter) emissions; the recipient-scoped read side (list / unread-count / mark
 * read) with RLS negatives; and the idempotent date-driven scan with its
 * operator-only permission.
 */
describe('Notifications (e2e)', () => {
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
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

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

  interface MyNotification {
    id: string;
    type: string;
    status: string;
    engagementId: string | null;
  }
  const myNotifications = async (t: string, query = ''): Promise<MyNotification[]> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/notifications?limit=100${query}`)
      .set(bearer(t))
      .expect(200);
    return res.body.items as MyNotification[];
  };

  /** Create → optionally assign a manager → start, leaving the engagement ACTIVE. */
  const setupActive = async (opts: {
    epToken: string;
    serviceCode: string;
    managerCode?: string;
  }): Promise<{ id: string; version: number }> => {
    const entityId = await findEntityId('Bharat');
    const serviceId = await findServiceId(opts.serviceCode);
    const created = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(opts.epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `N${unique()}`,
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
    return { id, version: started.body.version };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── Task assignment → the assignee is notified (portal) ───────────────────
  describe('task assignment', () => {
    it('notifies the assignee, is recipient-scoped, and supports read + unread-count', async () => {
      const pa = await token('partner.a@hsdg.in');
      const sy = await token('senior.y@hsdg.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'ITR_FILING' });
      const seniorY = await findEmployeeId('EMP006');
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/team`)
        .set(bearer(pa))
        .send({ employeeId: seniorY, roleOnEngagement: 'in_charge' })
        .expect(201);

      const before = (
        await request(app.getHttpServer())
          .get('/api/v1/notifications/unread-count')
          .set(bearer(sy))
          .expect(200)
      ).body.unread as number;

      const task = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/tasks`)
        .set(bearer(pa))
        .send({ title: 'Draft the computation', assignedToEmployeeId: seniorY })
        .expect(201);

      // Senior Y (assignee) has a task_assigned notification for this engagement.
      const notes = await myNotifications(sy, '&unreadOnly=true');
      const hit = notes.find((n) => n.type === 'task_assigned' && n.engagementId === eng.id);
      expect(hit).toBeDefined();

      const after = (
        await request(app.getHttpServer())
          .get('/api/v1/notifications/unread-count')
          .set(bearer(sy))
          .expect(200)
      ).body.unread as number;
      expect(after).toBe(before + 1);

      // An unrelated partner never sees Senior Y's notification…
      const pb = await token('partner.b@hsdg.in');
      expect((await myNotifications(pb)).some((n) => n.id === hit!.id)).toBe(false);
      // …and cannot mark it read (RLS scopes the UPDATE → 404, no leak).
      await request(app.getHttpServer())
        .post(`/api/v1/notifications/${hit!.id}/read`)
        .set(bearer(pb))
        .expect(404);

      // The recipient marks it read; the badge drops.
      const read = await request(app.getHttpServer())
        .post(`/api/v1/notifications/${hit!.id}/read`)
        .set(bearer(sy))
        .expect(201);
      expect(read.body.status).toBe('read');
      const badge = (
        await request(app.getHttpServer())
          .get('/api/v1/notifications/unread-count')
          .set(bearer(sy))
          .expect(200)
      ).body.unread as number;
      expect(badge).toBe(before);
      void task;
    });

    it('does not notify on self-assignment', async () => {
      const pa = await token('partner.a@hsdg.in');
      const partnerA = await findEmployeeId('EMP003');
      const eng = await setupActive({ epToken: pa, serviceCode: 'ITR_FILING' });
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/tasks`)
        .set(bearer(pa))
        .send({ title: 'EP self task', assignedToEmployeeId: partnerA })
        .expect(201);
      const notes = await myNotifications(pa, '&unreadOnly=true');
      expect(notes.some((n) => n.type === 'task_assigned' && n.engagementId === eng.id)).toBe(
        false,
      );
    });
  });

  // ── Review-driven emissions to the accountable EP ─────────────────────────
  describe('review engine emissions', () => {
    it('notifies the EP that sign-off is pending when a manager clears a full-EP-review engagement', async () => {
      const pa = await token('partner.a@hsdg.in');
      const mgr = await token('manager.x@hsdg.in');
      const eng = await setupActive({
        epToken: pa,
        serviceCode: 'STAT_AUDIT',
        managerCode: 'EMP005',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(mgr))
        .send({ reviewType: 'manager_review', outcome: 'cleared' })
        .expect(201);

      const notes = await myNotifications(pa, '&unreadOnly=true');
      expect(notes.some((n) => n.type === 'ep_signoff_pending' && n.engagementId === eng.id)).toBe(
        true,
      );
    });

    it('flags a high-risk exception to the EP when a key-matter review point is raised', async () => {
      const pa = await token('partner.a@hsdg.in');
      const mgr = await token('manager.x@hsdg.in');
      const eng = await setupActive({
        epToken: pa,
        serviceCode: 'STAT_AUDIT',
        managerCode: 'EMP005',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(mgr))
        .send({
          reviewType: 'manager_review',
          outcome: 'returned',
          reviewPoints: [{ matter: 'Revenue cutoff needs EP attention', isKeyMatter: true }],
        })
        .expect(201);

      const notes = await myNotifications(pa, '&unreadOnly=true');
      expect(notes.some((n) => n.type === 'high_risk_exception' && n.engagementId === eng.id)).toBe(
        true,
      );
      // Sign-off is NOT pending while a point is open.
      expect(notes.some((n) => n.type === 'ep_signoff_pending' && n.engagementId === eng.id)).toBe(
        false,
      );
    });
  });

  // ── EP change and reopen ──────────────────────────────────────────────────
  describe('engagement events', () => {
    it('notifies the incoming EP when the partner is reassigned', async () => {
      const pa = await token('partner.a@hsdg.in');
      const pb = await token('partner.b@hsdg.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'ITR_FILING' });
      const partnerB = await findEmployeeId('EMP004');

      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reassign-partner`)
        .set(bearer(mp)) // firm-wide authority
        .send({ engagementPartnerEmployeeId: partnerB, reason: 'load balancing' })
        .expect(201);

      const notes = await myNotifications(pb, '&unreadOnly=true');
      expect(notes.some((n) => n.type === 'ep_changed' && n.engagementId === eng.id)).toBe(true);
    });

    it('notifies the EP when a completed engagement is reopened', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'ITR_FILING' });
      // ITR is manager_review: the EP (a lead) may review, sign off, and complete.
      const reviewed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reviews`)
        .set(bearer(pa))
        .send({ reviewType: 'manager_review', outcome: 'cleared' })
        .expect(201);
      const signed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/sign-off`)
        .set(bearer(pa))
        .send({ version: reviewed.body.version })
        .expect(201);
      const completed = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/complete`)
        .set(bearer(pa))
        .send({ version: signed.body.version })
        .expect(201);

      // Only the MP may reopen — and the EP is then notified.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/reopen`)
        .set(bearer(mp))
        .send({ version: completed.body.version, reason: 'client sent revised figures' })
        .expect(201);

      const notes = await myNotifications(pa, '&unreadOnly=true');
      expect(notes.some((n) => n.type === 'engagement_reopened' && n.engagementId === eng.id)).toBe(
        true,
      );
    });
  });

  // ── The date-driven scan ──────────────────────────────────────────────────
  describe('date-driven scan', () => {
    it('emits client-dependency reminders, is idempotent, and is operator-only', async () => {
      const pa = await token('partner.a@hsdg.in');
      const eng = await setupActive({ epToken: pa, serviceCode: 'ITR_FILING' });
      const partnerA = await findEmployeeId('EMP003');

      // A client dependency whose reminder date is already in the past.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/client-dependencies`)
        .set(bearer(pa))
        .send({
          requestedInfo: 'Bank statements FY26-27',
          responsibleEmployeeId: partnerA,
          reminderDate: '2020-01-01',
        })
        .expect(201);

      // A non-operator cannot trigger the sweep.
      await request(app.getHttpServer())
        .post('/api/v1/notifications/scan')
        .set(bearer(pa))
        .expect(403);

      // The operator (MP) runs it — the responsible partner gets a reminder.
      const first = await request(app.getHttpServer())
        .post('/api/v1/notifications/scan')
        .set(bearer(mp))
        .expect(201);
      expect(first.body.clientDependencyReminder).toBeGreaterThanOrEqual(1);

      const notes = await myNotifications(pa, '&unreadOnly=true');
      const reminder = notes.find(
        (n) => n.type === 'client_dependency_reminder' && n.engagementId === eng.id,
      );
      expect(reminder).toBeDefined();

      // Running it again does not duplicate (dedup_key) — this dependency no longer counts.
      const before = (await myNotifications(pa, '&unreadOnly=true')).length;
      await request(app.getHttpServer())
        .post('/api/v1/notifications/scan')
        .set(bearer(mp))
        .expect(201);
      const afterCount = (await myNotifications(pa, '&unreadOnly=true')).length;
      expect(afterCount).toBe(before);
    });
  });
});

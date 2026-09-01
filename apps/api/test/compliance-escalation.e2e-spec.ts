import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { escalationAction, type EscalationLevel } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { dateFromToday } from './date.helper';

/**
 * Escalation ladder (§24) and calendar views (§22).
 *
 * "Today" is the machine clock. A period_end + 0-day rule makes the statutory
 * date equal the reference date, so obligations can be placed (via dateFromToday)
 * at precise distances from today to exercise every escalation band, the §22 view
 * filters, and the §24 statutory-overdue notification (with critical → firm).
 */
describe('Compliance escalation & calendar views (e2e)', () => {
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

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findEmployeeId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/employees?limit=100')
      .set(bearer(mp));
    return (res.body.items as Array<{ employeeCode: string; id: string }>).find(
      (e) => e.employeeCode === code,
    )!.id;
  };

  const createEngagement = async (epToken: string): Promise<string> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `E${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  /** A period_end + 0-day rule ⇒ statutory date == reference date. */
  const createExactRule = async (category = 'STATUTORY_RULE'): Promise<string> => {
    const code = `ESC_${unique()}`;
    const rule = await request(app.getHttpServer())
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code, name: code, dueDateCategory: category })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
      .set(bearer(mp))
      .send({
        effectiveFrom: '2017-04-01',
        calculationBasis: 'period_end',
        offsetDays: 0,
        workingDayAdjustment: 'none',
      })
      .expect(201);
    return code;
  };

  const scanAs = (t: string) =>
    request(app.getHttpServer()).post('/api/v1/notifications/scan').set(bearer(t)).expect(201);

  const notificationsFor = async (
    t: string,
  ): Promise<Array<{ type: string; engagementId: string }>> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/notifications?limit=100')
      .set(bearer(t))
      .expect(200);
    return res.body.items as Array<{ type: string; engagementId: string }>;
  };

  const generate = (t: string, eng: string, code: string, referenceDate: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(t))
      .send({ complianceRuleCode: code, referenceDate });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('escalation bands (§24)', () => {
    it('classifies each obligation into the right band from its operative date', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();

      // Reference date ⇒ statutory date; distances measured from today.
      const cases: Record<string, string> = {
        [dateFromToday(-57)]: 'critical', // 57 days overdue (> 7)
        [dateFromToday(-4)]: 'overdue', // 4 days overdue (≤ 7)
        [dateFromToday(0)]: 'due_today',
        [dateFromToday(3)]: 'due_soon', // 3 days out (≤ 7 lead)
        [dateFromToday(95)]: 'upcoming', // far future
      };
      for (const date of Object.keys(cases)) {
        await generate(pa, eng, code, date).expect(201);
      }

      const res = await request(app.getHttpServer())
        .get(`/api/v1/compliance/events?engagementId=${eng}&limit=100`)
        .set(bearer(pa))
        .expect(200);
      const statutory = (
        res.body.items as Array<{ kind: string; dueDate: string; escalation: string }>
      ).filter((e) => e.kind === 'statutory');
      const byDate = Object.fromEntries(statutory.map((e) => [e.dueDate, e.escalation]));
      for (const [date, band] of Object.entries(cases)) {
        expect([date, byDate[date]]).toEqual([date, band]);
      }
    });

    it('a completed obligation escalates to "none"', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();
      const gen = await generate(pa, eng, code, dateFromToday(-57)).expect(201); // would be critical
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/complete`)
        .set(bearer(pa))
        .send({ version: gen.body.version })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/compliance/events?engagementId=${eng}&limit=100`)
        .set(bearer(pa))
        .expect(200);
      const stat = (res.body.items as Array<{ kind: string; escalation: string }>).find(
        (e) => e.kind === 'statutory',
      );
      expect(stat!.escalation).toBe('none');
    });
  });

  describe('calendar views (§22)', () => {
    it('filters the firm-wide calendar by service and by engagement partner', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();
      const gen = await generate(pa, eng, code, dateFromToday(-4)).expect(201);
      const paEmp = await findEmployeeId('EMP003'); // Partner A
      const pbEmp = await findEmployeeId('EMP004'); // Partner B

      const hasIt = async (query: string): Promise<boolean> => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/compliance?${query}&limit=100`)
          .set(bearer(mp))
          .expect(200);
        return (res.body.items as Array<{ id: string }>).some((i) => i.id === gen.body.id);
      };

      expect(await hasIt('serviceCode=ITR_FILING')).toBe(true);
      expect(await hasIt(`partnerId=${paEmp}`)).toBe(true);
      // Partner B's portfolio view must not contain Partner A's obligation.
      expect(await hasIt(`partnerId=${pbEmp}`)).toBe(false);
    });
  });

  describe('statutory-overdue escalation notifications (§24)', () => {
    it('emits a statutory-deadline-overdue notification to the engagement lead', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();
      await generate(pa, eng, code, dateFromToday(-57)).expect(201); // critically overdue

      // The operator (MP) runs the sweep — a fresh, newest-first notification.
      const scan = await request(app.getHttpServer())
        .post('/api/v1/notifications/scan')
        .set(bearer(mp))
        .expect(201);
      expect(scan.body.statutoryDeadlineOverdue).toBeGreaterThanOrEqual(1);

      // The engagement partner (lead) is notified the statutory date has passed.
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications?limit=100')
        .set(bearer(pa))
        .expect(200);
      expect(
        (res.body.items as Array<{ type: string; engagementId: string }>).some(
          (n) => n.type === 'statutory_deadline_overdue' && n.engagementId === eng,
        ),
      ).toBe(true);
    });

    it('forbids a non-operator from running the sweep (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/notifications/scan')
        .set(bearer(await token('partner.a@dhvaj.in')))
        .expect(403);
    });
  });

  describe('§24 finer escalation routing', () => {
    it('Due Today → a compliance-due-today notification to the lead', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule();
      await generate(pa, eng, code, dateFromToday(0)).expect(201); // due TODAY

      const scan = await scanAs(mp);
      expect(scan.body.complianceDueToday).toBeGreaterThanOrEqual(1);
      expect(
        (await notificationsFor(pa)).some(
          (n) => n.type === 'compliance_due_today' && n.engagementId === eng,
        ),
      ).toBe(true);
    });

    it('Client-commitment overdue → a distinct client-commitment notification, not a statutory breach', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createExactRule('CLIENT_COMMITTED');
      await generate(pa, eng, code, dateFromToday(-7)).expect(201); // 7 days overdue

      const scan = await scanAs(mp);
      expect(scan.body.clientCommitmentOverdue).toBeGreaterThanOrEqual(1);
      const mine = (await notificationsFor(pa)).filter((n) => n.engagementId === eng);
      expect(mine.some((n) => n.type === 'client_commitment_overdue')).toBe(true);
      // A client commitment is NOT routed as a statutory-deadline breach.
      expect(mine.some((n) => n.type === 'statutory_deadline_overdue')).toBe(false);
    });

    it('Review overdue → the layer OWNER (reviewer) is notified, leads escalated', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      // Non-statutory parent so no auto review layer collides with the manual one.
      const code = await createExactRule('HSDG_MILESTONE');
      const gen = await generate(pa, eng, code, dateFromToday(95)).expect(201); // instance itself upcoming
      const reviewer = await findEmployeeId('EMP005'); // Manager X — NOT an engagement lead

      // A manager-review layer whose own due date has already passed.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/deadlines`)
        .set(bearer(pa))
        .send({
          layerType: 'manager_review',
          label: 'Manager review',
          dueDateCategory: 'HSDG_MILESTONE',
          dueDate: dateFromToday(-8),
          ownerEmployeeId: reviewer,
        })
        .expect(201);

      const scan = await scanAs(mp);
      expect(scan.body.deadlineLayerOverdue).toBeGreaterThanOrEqual(1);

      // The reviewer (layer owner), though not an engagement lead, is notified.
      const mx = await token('manager.x@dhvaj.in');
      expect(
        (await notificationsFor(mx)).some(
          (n) => n.type === 'deadline_layer_overdue' && n.engagementId === eng,
        ),
      ).toBe(true);
    });
  });

  // ── Parts 2/3: the point-in-time calendar picture (§16/§22/§23/§24) ────────
  // The event fan-out is field-complete (source, owner, extension), views can be
  // scoped by clock and by service, and every event carries its DISTINCT §24
  // escalation action — the "picture in time" the calendar renders.
  describe('point-in-time calendar picture (§16/§22/§23/§24)', () => {
    interface EventRow {
      eventId: string;
      kind: 'statutory' | 'internal_sla' | 'layer';
      layerType: string | null;
      complianceInstanceId: string;
      serviceCode: string;
      dueDate: string;
      dueDateSource: string | null;
      ownerName: string | null;
      isExtended: boolean;
      escalation: EscalationLevel;
      escalationAction: string;
    }

    /** A period_end + 0-day rule with an explicit §2 category and §3 source. */
    const createSourcedRule = async (category: string, source: string | null): Promise<string> => {
      const code = `PIT_${unique()}`;
      const rule = await request(app.getHttpServer())
        .post('/api/v1/compliance-rules')
        .set(bearer(mp))
        .send({
          code,
          name: code,
          dueDateCategory: category,
          ...(source ? { dueDateSource: source } : {}),
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
        .set(bearer(mp))
        .send({
          effectiveFrom: '2017-04-01',
          calculationBasis: 'period_end',
          offsetDays: 0,
          workingDayAdjustment: 'none',
          internalSlaOffsetDays: 3,
        })
        .expect(201);
      return code;
    };

    const employeeName = async (empCode: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees?limit=100')
        .set(bearer(mp));
      return (res.body.items as Array<{ employeeCode: string; fullName: string }>).find(
        (e) => e.employeeCode === empCode,
      )!.fullName;
    };

    const eventsFor = async (t: string, query: string): Promise<EventRow[]> => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/compliance/events?${query}&limit=100`)
        .set(bearer(t))
        .expect(200);
      return res.body.items as EventRow[];
    };

    it('fans one obligation into a field-complete event picture (§16/§23)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createSourcedRule('STATUTORY_RULE', 'LAW_RULE');
      // A STATUTORY obligation 3 days out ⇒ due_soon. Generation auto-materialises
      // the standard §16 review layer(s); with no manager staffed, the engagement
      // partner (Partner A) owns the manager review.
      const gen = await generate(pa, eng, code, dateFromToday(3)).expect(201);
      const partnerName = await employeeName('EMP003'); // Partner A — the EP

      const events = (await eventsFor(pa, `engagementId=${eng}`)).filter(
        (e) => e.complianceInstanceId === gen.body.id,
      );
      const statutory = events.find((e) => e.kind === 'statutory')!;
      const sla = events.find((e) => e.kind === 'internal_sla')!;
      const layer = events.find((e) => e.kind === 'layer' && e.layerType === 'manager_review')!;

      // §23 field completeness — source flows to statutory, HSDG_POLICY to the SLA.
      expect(statutory.dueDateSource).toBe('LAW_RULE');
      expect(statutory.ownerName).toBeNull();
      expect(statutory.isExtended).toBe(false);
      expect(sla.dueDateSource).toBe('HSDG_POLICY');
      // §16 standard review layer is auto-materialised and carries its OWNER.
      expect(layer).toBeDefined();
      expect(layer.ownerName).toBe(partnerName);

      // §24 — the statutory event is in the "due soon" band and its distinct
      // action is to notify the owner; every event agrees with the shared policy.
      expect(statutory.escalation).toBe('due_soon');
      expect(statutory.escalationAction).toBe(escalationAction('due_soon').action);
      for (const e of events) {
        expect(e.escalationAction).toBe(escalationAction(e.escalation).action);
      }
    });

    it('scopes the event stream by clock (Internal-SLA view) and by service (§22)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createSourcedRule('STATUTORY_RULE', 'LAW_RULE');
      await generate(pa, eng, code, dateFromToday(-4)).expect(201); // overdue

      // Internal-SLA view: only the SLA clock, nothing else.
      const sla = await eventsFor(pa, `engagementId=${eng}&kind=internal_sla`);
      expect(sla.length).toBeGreaterThanOrEqual(1);
      expect(sla.every((e) => e.kind === 'internal_sla')).toBe(true);

      // Statutory view: only statutory events.
      const stat = await eventsFor(pa, `engagementId=${eng}&kind=statutory`);
      expect(stat.every((e) => e.kind === 'statutory')).toBe(true);

      // Component/service view over the same stream.
      const matched = await eventsFor(pa, `engagementId=${eng}&serviceCode=ITR_FILING`);
      expect(matched.length).toBeGreaterThanOrEqual(1);
      const none = await eventsFor(pa, `engagementId=${eng}&serviceCode=NONEXISTENT`);
      expect(none.length).toBe(0);
    });

    it('carries the distinct §24 action on the firm-wide calendar row', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createSourcedRule('STATUTORY_RULE', 'LAW_RULE');
      const gen = await generate(pa, eng, code, dateFromToday(-57)).expect(201); // critical

      const res = await request(app.getHttpServer())
        .get('/api/v1/compliance?status=open&limit=100')
        .set(bearer(mp))
        .expect(200);
      const row = (
        res.body.items as Array<{
          id: string;
          escalation: EscalationLevel;
          escalationAction: string;
        }>
      ).find((r) => r.id === gen.body.id)!;
      expect(row.escalation).toBe('critical');
      expect(row.escalationAction).toBe(escalationAction('critical').action);
    });

    it('flips isExtended on the statutory event when a government extension applies (§19/§23)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      const eng = await createEngagement(pa);
      const code = await createSourcedRule('STATUTORY_FIXED', 'LAW_RULE');
      const statDate = dateFromToday(10);
      const gen = await generate(pa, eng, code, statDate).expect(201);
      expect(gen.body.statutoryDeadline).toBe(statDate);

      const revised = dateFromToday(40);
      const ext = await request(app.getHttpServer())
        .post('/api/v1/compliance-extensions')
        .set(bearer(mp))
        .send({
          complianceRuleCode: code,
          originalDueDate: statDate,
          revisedDueDate: revised,
          notificationReference: `PIT-EXT/${unique()}`,
          applicablePopulation: 'All filers',
          effectiveDate: dateFromToday(1),
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng}/compliance/${gen.body.id}/apply-extension`)
        .set(bearer(pa))
        .send({ governmentExtensionId: ext.body.id, version: gen.body.version })
        .expect(201);

      const events = await eventsFor(pa, `engagementId=${eng}&kind=statutory`);
      const statutory = events.find((e) => e.complianceInstanceId === gen.body.id)!;
      // The event now shows the extension: operative date is the revised date.
      expect(statutory.isExtended).toBe(true);
      expect(statutory.dueDate).toBe(revised);
    });
  });
});

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { NoticeStream } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';
import {
  ComplianceCalendarV2Service,
  NOTICE_ORDER_EVENT,
} from '../compliance/compliance-calendar-v2.service';
import { financialYearOf } from '../compliance/compliance-periods';
import { EngagementsService } from '../engagements/engagements.service';
import type { NoticeRow } from './notices.types';

/** The Assignment service an appeal opens, by the notice's stream (migration 1772300630000). */
export const APPEAL_SERVICE_BY_STREAM: Record<NoticeStream, string> = {
  gst: 'GST_APPEAL_MATTER',
  income_tax: 'TAX_APPEAL_MATTER',
  tds: 'TAX_APPEAL_MATTER',
  roc: 'OTHER_PROF',
  other: 'OTHER_PROF',
};

const LEAD_ONLY =
  'The appeal limitation filing goes on the compliance calendar — ' +
  'the engagement partner or manager starts its clock.';
const OPEN_STATUSES_SQL = `status NOT IN ('closed', 'merged', 'cancelled', 'declined', 'withdrawn')`;

/**
 * Practice Services PS-103 — what an order does beyond the notice itself.
 *
 * An order on an appealable type records a compliance event 'notice_order'
 * ({noticeId, appealRuleCode}) on the client's Compliance engagement through
 * the calendar's own event machinery; the type's limitation rule (an event rule
 * gated on its code) generates the "Appeal by" filing, whose date becomes the
 * notice's appeal_due_on. Voiding the order voids the event (the filing falls
 * away) and clears both fields. "Appeal" opens an Assignment engagement for it.
 * All on the notice's transaction.
 *
 * Calendar writes are lead-only, so when someone else on the team (a senior
 * owning the notice) records the order, the order stands and the clock waits:
 * the partner or manager starts it with POST /notices/:id/appeal-clock
 * ({@link startClock}), which runs the same steps on the live order.
 */
@Injectable()
export class NoticeAppealService {
  constructor(
    private readonly calendar: ComplianceCalendarV2Service,
    private readonly engagements: EngagementsService,
  ) {}

  /**
   * Start the appeal clock for an order just recorded. Returns false when it
   * waits: no Compliance engagement to keep it on, or the caller isn't its lead
   * (then `strict` — the explicit "start the clock" — refuses instead).
   */
  async onOrderRecorded(
    client: PoolClient,
    ctx: RlsContext,
    notice: NoticeRow,
    event: { id: string; occurredOn: string },
    opts: { strict?: boolean } = {},
  ): Promise<boolean> {
    if (!notice.type_appealable || !notice.type_appeal_rule_code) return false;
    const engagementId = await this.complianceEngagement(client, notice);
    if (!engagementId) {
      if (opts.strict)
        throw new BadRequestException(
          'The client has no open Compliance engagement to keep the appeal date on.',
        );
      return false;
    }
    const { rows: lead } = await client.query<{ lead: boolean }>(
      `SELECT hsdg.is_engagement_lead($1) AS lead`,
      [engagementId],
    );
    if (!lead[0]?.lead) {
      if (opts.strict) throw new ForbiddenException(LEAD_ONLY);
      return false;
    }

    const recorded = await this.calendar.recordEventWith(client, ctx, engagementId, {
      eventType: NOTICE_ORDER_EVENT,
      eventDate: event.occurredOn,
      registrationId: notice.registration_id,
      notes: `Order on notice ${notice.type_form ?? notice.type_title} ${notice.reference_no}`,
      details: { noticeId: notice.id, appealRuleCode: notice.type_appeal_rule_code },
    });
    const complianceEventId = recorded.event.id;
    await client.query(`UPDATE hsdg.notice_events SET compliance_event_id = $2 WHERE id = $1`, [
      event.id,
      complianceEventId,
    ]);
    const { rows } = await client.query<{ id: string; due: string }>(
      `SELECT id, statutory_deadline::text AS due FROM hsdg.compliance_instances
        WHERE engagement_id = $1 AND compliance_event_id = $2
          AND workflow_status <> 'not_applicable'
        ORDER BY statutory_deadline LIMIT 1`,
      [engagementId, complianceEventId],
    );
    await client.query(
      `UPDATE hsdg.notices SET appeal_instance_id = $2, appeal_due_on = $3 WHERE id = $1`,
      [notice.id, rows[0]?.id ?? null, rows[0]?.due ?? null],
    );
    return true;
  }

  /**
   * The notice closes without an appeal (accepted, dropped, settled): its
   * "Appeal by" filing would otherwise sit on the calendar and go overdue, so
   * the order's event is voided and the filing falls away. An appeal that was
   * opened keeps its filing — the appeal engagement works it.
   */
  async onClosed(
    client: PoolClient,
    ctx: RlsContext,
    notice: NoticeRow,
    outcome: string,
  ): Promise<void> {
    if (notice.appeal_engagement_id) return;
    const { rows } = await client.query<{ ce: string; engagement_id: string }>(
      `SELECT ce.id AS ce, ce.engagement_id
         FROM hsdg.notice_events e
         JOIN hsdg.compliance_events ce ON ce.id = e.compliance_event_id
        WHERE e.notice_id = $1 AND e.kind = 'order' AND e.voided_at IS NULL
          AND ce.voided_at IS NULL`,
      [notice.id],
    );
    for (const r of rows) {
      const { rows: lead } = await client.query<{ lead: boolean }>(
        `SELECT hsdg.is_engagement_lead($1) AS lead`,
        [r.engagement_id],
      );
      if (!lead[0]?.lead)
        throw new ForbiddenException(
          'The appeal clock is running on the compliance calendar — the engagement partner or manager closes this notice.',
        );
      await this.calendar.voidEventWith(
        client,
        ctx,
        r.engagement_id,
        r.ce,
        `Notice closed without an appeal (${outcome.replace(/_/g, ' ')})`,
        { fromNotice: true },
      );
    }
  }

  /** POST /notices/:id/appeal-clock — a lead starts the clock an earlier order left waiting. */
  async startClock(client: PoolClient, ctx: RlsContext, notice: NoticeRow): Promise<void> {
    if (notice.appeal_instance_id)
      throw new ConflictException('The appeal clock is already running.');
    const { rows } = await client.query<{ id: string; d: string; ce: string | null }>(
      `SELECT id, occurred_on::text AS d, compliance_event_id AS ce FROM hsdg.notice_events
        WHERE notice_id = $1 AND kind = 'order' AND voided_at IS NULL
        ORDER BY occurred_on DESC, created_at DESC LIMIT 1`,
      [notice.id],
    );
    const order = rows[0];
    if (!order) throw new BadRequestException('Record the order first.');
    if (order.ce) throw new ConflictException('The appeal clock is already running.');
    if (!notice.type_appealable || !notice.type_appeal_rule_code)
      throw new BadRequestException('This type of notice has no appeal period.');
    await this.onOrderRecorded(
      client,
      ctx,
      notice,
      { id: order.id, occurredOn: order.d },
      { strict: true },
    );
  }

  async onOrderVoided(
    client: PoolClient,
    ctx: RlsContext,
    notice: NoticeRow,
    event: { id: string; complianceEventId: string | null },
    reason: string,
  ): Promise<void> {
    if (event.complianceEventId) {
      const { rows } = await client.query<{ engagement_id: string; voided: boolean }>(
        `SELECT engagement_id, voided_at IS NOT NULL AS voided
           FROM hsdg.compliance_events WHERE id = $1`,
        [event.complianceEventId],
      );
      const ce = rows[0];
      if (ce && !ce.voided) {
        const { rows: lead } = await client.query<{ lead: boolean }>(
          `SELECT hsdg.is_engagement_lead($1) AS lead`,
          [ce.engagement_id],
        );
        if (!lead[0]?.lead)
          throw new ForbiddenException(
            'This order started the appeal limitation filing — the engagement partner or manager voids it.',
          );
        await this.calendar.voidEventWith(
          client,
          ctx,
          ce.engagement_id,
          event.complianceEventId,
          `Order voided on the notice: ${reason}`,
          { fromNotice: true },
        );
      }
    }
    await client.query(
      `UPDATE hsdg.notices SET appeal_instance_id = NULL, appeal_due_on = NULL WHERE id = $1`,
      [notice.id],
    );
  }

  /**
   * POST /notices/:id/appeal — open the Assignment engagement the appeal is
   * worked under, on the notice's transaction. Partner defaults to the notice
   * engagement's partner; manager to the owner when they are a manager, else
   * the notice engagement's manager. Its planned end (the firm's own due date)
   * is the appeal limitation date.
   */
  async openAppeal(
    client: PoolClient,
    ctx: RlsContext,
    notice: NoticeRow,
    input: { partnerId?: string; managerId?: string },
  ): Promise<{ id: string; code: string }> {
    const { rows: engs } = await client.query<{
      partner: string | null;
      manager: string | null;
      owner_is_manager: boolean;
    }>(
      `SELECT e.engagement_partner_id AS partner, e.engagement_manager_id AS manager,
              EXISTS (SELECT 1 FROM hsdg.employees o JOIN hsdg.grades g ON g.id = o.grade_id
                       WHERE o.id = $2 AND NOT g.is_partner_grade
                         AND g.rank >= (SELECT rank FROM hsdg.grades WHERE slug = 'manager'))
                AS owner_is_manager
         FROM hsdg.engagements e WHERE e.id = $1`,
      [notice.engagement_id, notice.owner_employee_id],
    );
    const eng = engs[0];
    const partnerId = input.partnerId ?? eng?.partner ?? undefined;
    const managerId =
      input.managerId ??
      (eng?.owner_is_manager ? notice.owner_employee_id : (eng?.manager ?? undefined));
    if (!partnerId) throw new BadRequestException('Choose the partner for the appeal.');
    const { rows: svc } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.services WHERE code = $1 AND is_active`,
      [APPEAL_SERVICE_BY_STREAM[notice.type_stream]],
    );
    if (!svc[0]) throw new BadRequestException('The appeal service is not set up.');
    const orderOn = await this.orderDate(client, notice.id);
    const detail = await this.engagements.createEngagementWith(client, ctx, {
      kind: 'assignment',
      entityId: notice.entity_id,
      serviceId: svc[0].id,
      financialYear: notice.financial_year ?? financialYearOf(orderOn ?? notice.received_on),
      periodLabel: `Appeal ${notice.reference_no}`.slice(0, 80),
      engagementPartnerEmployeeId: partnerId,
      ...(managerId ? { engagementManagerEmployeeId: managerId } : {}),
      status: 'accepted',
      engagementType: 'litigation',
      ...(orderOn ? { plannedStartDate: orderOn } : {}),
      ...(notice.appeal_due_on ? { plannedEndDate: notice.appeal_due_on } : {}),
    });
    return { id: detail.id, code: detail.engagementCode };
  }

  /** The live order's date, if any. */
  async orderDate(client: PoolClient, noticeId: string): Promise<string | null> {
    const { rows } = await client.query<{ d: string }>(
      `SELECT occurred_on::text AS d FROM hsdg.notice_events
        WHERE notice_id = $1 AND kind = 'order' AND voided_at IS NULL
        ORDER BY occurred_on DESC, created_at DESC LIMIT 1`,
      [noticeId],
    );
    return rows[0]?.d ?? null;
  }

  /** The notice's own engagement when it is Compliance, else the client's open one. */
  private async complianceEngagement(
    client: PoolClient,
    notice: NoticeRow,
  ): Promise<string | null> {
    if (notice.engagement_kind === 'compliance') return notice.engagement_id;
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.engagements
        WHERE entity_id = $1 AND kind = 'compliance' AND ${OPEN_STATUSES_SQL}
        ORDER BY created_at DESC LIMIT 1`,
      [notice.entity_id],
    );
    return rows[0]?.id ?? null;
  }
}

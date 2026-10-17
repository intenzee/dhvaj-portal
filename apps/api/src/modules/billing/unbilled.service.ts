import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FEE_WAIVER_REASON_MIN,
  NOTIFICATION_TYPE,
  formatInr,
  sumAmounts,
  type BillingFrequency,
  type CreateFeeMilestoneInput,
  type DecideAdjustmentInput,
  type DraftFromUnbilledInput,
  type FeeMilestone,
  type FeeMilestoneStatus,
  type FeeWaiver,
  type FeeWaiverPeriod,
  type FeeWaiverStatus,
  type InvoiceDetail,
  type RestoreFeeInput,
  type SetAsideFee,
  type SetAsideFeesInput,
  type SetAsideFeesResult,
  type SetAsideKind,
  type UnbilledEngagement,
  type UnbilledItem,
  type UnbilledReport,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { CommercialService, translateInvoiceError } from '../commercial/commercial.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dueFeeItems, type FeeTerms } from './unbilled';

const NOTES = [
  'Time is not listed yet: it joins once charge-out rates and approved, billable time arrive (PS-302).',
];

interface TermsRow {
  id: string;
  engagement_code: string;
  service_name: string;
  entity_id: string;
  client_name: string;
  partner_id: string | null;
  partner_name: string | null;
  billing_model: string | null;
  status: string;
  planned_start_date: string | null;
  billing_frequency: BillingFrequency | null;
  effective_date: string | null;
  end_date: string | null;
  retainer_amount: string | null;
  years: FeeTerms['years'];
  milestones: NonNullable<FeeTerms['milestones']>;
}

interface OpenRow {
  engagement_id: string;
  period_key: string;
  billed_invoice_id: string | null;
  label: string | null;
  skip_reason: string | null;
  skip_kind: SetAsideKind | null;
  external_invoice_number: string | null;
  external_invoice_date: string | null;
  amount: string;
  period_start: string;
  period_end: string;
  by_name: string | null;
  created_at: Date;
}

interface MilestoneRow {
  id: string;
  engagement_id: string;
  kind: FeeMilestone['kind'];
  description: string;
  amount: string;
  due_on: string;
  cancelled: boolean;
  billed_invoice_id: string | null;
  open: boolean;
  created_by_name: string | null;
  created_at: Date;
}

interface WaiverRow {
  id: string;
  engagement_id: string;
  client_entity_id: string;
  client_name: string;
  engagement_code: string | null;
  service_name: string | null;
  periods: FeeWaiverPeriod[];
  amount: string;
  reason: string;
  status: FeeWaiverStatus;
  requested_by_employee_id: string | null;
  requested_by_name: string | null;
  created_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  version: number;
}

// The engagement may be out of the decider's sight: its code and service are then null.
const WAIVER_SELECT = `
  SELECT w.id, w.engagement_id, w.client_entity_id, ent.legal_name AS client_name,
         e.engagement_code, s.name AS service_name, w.periods, w.amount::text, w.reason,
         w.status, w.requested_by_employee_id, rb.full_name AS requested_by_name, w.created_at,
         db.full_name AS decided_by_name, w.decided_at, w.decision_note, w.version
    FROM hsdg.fee_waivers w
    JOIN hsdg.entities ent ON ent.id = w.client_entity_id
    LEFT JOIN hsdg.engagements e ON e.id = w.engagement_id
    LEFT JOIN hsdg.services s ON s.id = e.service_id
    LEFT JOIN hsdg.employees rb ON rb.id = w.requested_by_employee_id
    LEFT JOIN hsdg.employees db ON db.id = w.decided_by_employee_id`;

const MILESTONE_SELECT = `
  SELECT m.id, m.engagement_id, m.kind, m.description, m.amount::text, m.due_on::text,
         m.cancelled_at IS NOT NULL AS cancelled, fb.billed_invoice_id,
         fb.id IS NOT NULL AS open, ce.full_name AS created_by_name, m.created_at
    FROM hsdg.engagement_fee_milestones m
    LEFT JOIN hsdg.fee_billings fb
      ON fb.engagement_id = m.engagement_id AND fb.period_key = 'milestone:' || m.id
     AND fb.released_at IS NULL
    LEFT JOIN hsdg.employees ce ON ce.id = m.created_by_employee_id`;

/**
 * PS-206 · fixed fees that are due and on no invoice — the retainer per
 * period, or a compliance year's fee shared by the billing frequency — and
 * a draft invoice from the ones chosen. fee_billings holds each period put on
 * a live invoice, so none is billed twice; voiding the invoice releases them.
 * A period billed outside the app is set aside at once, naming the outside
 * invoice; not billing one is a waiver a partner (billing.approve, not the
 * requester) approves, as a write-off. Either can be restored. Fee milestones
 * and events join the list on their date. Billers: ctx_may_bill_engagement.
 */
@Injectable()
export class UnbilledService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly commercial: CommercialService,
    private readonly notifications: NotificationsService,
  ) {}

  report(ctx: RlsContext, partnerId: string | null): Promise<UnbilledReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      const asOf = await istToday(client);
      const billingFrom = await billingFromOf(client);
      const engagements = await this.unbilled(client, asOf, { partnerId }, billingFrom);
      return {
        asOf,
        billingFrom,
        engagements,
        total: sumAmounts(engagements.map((e) => e.total)),
        notes: NOTES,
      };
    });
  }

  /** The chosen periods onto a new draft invoice for the engagement. */
  draft(ctx: RlsContext, input: DraftFromUnbilledInput): Promise<InvoiceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { eng, items } = await this.pick(client, input.engagementId, input.keys);
      const invoice = await this.commercial.createInvoiceWith(client, ctx, eng.engagementId, {
        lines: items.map((i, n) => ({
          description: `${eng.serviceName} — ${i.label}`,
          quantity: '1',
          unitAmount: i.amount,
          sortOrder: n,
        })),
      });
      const lineBySort = new Map(invoice.lines.map((l) => [l.sortOrder, l.id]));
      try {
        for (const [n, i] of items.entries()) {
          await client.query(
            `INSERT INTO hsdg.fee_billings
               (engagement_id, client_entity_id, period_key, period_start, period_end, amount,
                billed_invoice_id, invoice_line_id, created_by_employee_id, label)
             VALUES ($1, $2, $3, $4::date, $5::date, $6::numeric, $7, $8, $9, $10)`,
            [
              eng.engagementId,
              eng.clientId,
              i.key,
              i.periodStart,
              i.periodEnd,
              i.amount,
              invoice.id,
              lineBySort.get(n),
              ctx.employeeId ?? null,
              i.label,
            ],
          );
        }
      } catch (err) {
        throw raced(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.drafted_from_unbilled',
        objectType: 'invoice',
        objectId: invoice.id,
        after: { engagementId: eng.engagementId, periods: items.map((i) => i.key) },
      });
      return invoice;
    });
  }

  /**
   * Set due periods aside without an invoice. Billed outside the app: at once,
   * naming the outside invoice. Not billing them: a waiver request the
   * client's partners are asked to decide; the periods stay unbilled till then.
   */
  setAside(ctx: RlsContext, input: SetAsideFeesInput): Promise<SetAsideFeesResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const reason = input.reason?.trim() ?? '';
      if (input.kind === 'not_billing') {
        if (reason.length < FEE_WAIVER_REASON_MIN) {
          throw new BadRequestException(
            `Say why the firm is not billing this, in at least ${FEE_WAIVER_REASON_MIN} characters; a partner decides.`,
          );
        }
        return { setAside: 0, waiver: await this.requestWaiver(client, ctx, input, reason) };
      }
      const number = input.externalInvoiceNumber?.trim() ?? '';
      const date = input.externalInvoiceDate ?? '';
      if (!number || !date) {
        throw new BadRequestException(
          'Give the number and date of the invoice raised outside the app.',
        );
      }
      if (date > (await istToday(client))) {
        throw new BadRequestException('The outside invoice cannot be dated after today.');
      }
      const { eng, items } = await this.pick(client, input.engagementId, input.keys, true);
      const why = reason || `Billed outside the app: ${number} of ${date}`;
      try {
        for (const i of items) {
          await client.query(
            `INSERT INTO hsdg.fee_billings
               (engagement_id, client_entity_id, period_key, period_start, period_end, amount,
                label, skip_reason, skip_kind, external_invoice_number, external_invoice_date,
                created_by_employee_id)
             VALUES ($1, $2, $3, $4::date, $5::date, $6::numeric, $7, $8, 'billed_outside', $9,
                     $10::date, $11)`,
            [
              eng.engagementId,
              eng.clientId,
              i.key,
              i.periodStart,
              i.periodEnd,
              i.amount,
              i.label,
              why,
              number,
              date,
              ctx.employeeId ?? null,
            ],
          );
        }
      } catch (err) {
        throw raced(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'fee.set_aside',
        objectType: 'engagement',
        objectId: eng.engagementId,
        after: {
          periods: items.map((i) => i.key),
          kind: 'billed_outside',
          externalInvoice: { number, date },
        },
        reason: why,
      });
      return { setAside: items.length, waiver: null };
    });
  }

  /** Waivers the caller may see, newest first; `pending` for those waiting on a partner. */
  waivers(ctx: RlsContext, status: FeeWaiverStatus | null): Promise<FeeWaiver[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<WaiverRow>(
        `${WAIVER_SELECT} WHERE ($1::text IS NULL OR w.status = $1)
          ORDER BY w.created_at DESC LIMIT 200`,
        [status],
      );
      return rows.map(mapWaiver);
    });
  }

  /** Approve (the periods are set aside as not billed) or reject someone else's waiver. */
  decideWaiver(ctx: RlsContext, id: string, input: DecideAdjustmentInput): Promise<FeeWaiver> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.loadWaiver(client, id);
      if (before.status !== 'pending') {
        throw new BadRequestException(`This waiver is already ${before.status}.`);
      }
      if (input.version !== undefined && input.version !== before.version) {
        throw new ConflictException(
          `The waiver was changed by someone else (expected v${input.version}, found v${before.version}).`,
        );
      }
      if (ctx.employeeId && before.requestedById === ctx.employeeId) {
        throw new ForbiddenException('You asked for this; another partner must decide it.');
      }
      const approve = input.decision === 'approve';
      const note = input.note?.trim() || null;
      let changed: number;
      try {
        const res = await client.query(
          `UPDATE hsdg.fee_waivers
              SET status = $2, decided_by_employee_id = $3, decided_at = now(),
                  decision_note = $4, version = version + 1
            WHERE id = $1`,
          [id, approve ? 'approved' : 'rejected', ctx.employeeId ?? null, note],
        );
        changed = res.rowCount ?? 0;
      } catch (err) {
        throw translateInvoiceError(err);
      }
      if (changed === 0) {
        throw new ForbiddenException('Only a partner who bills the client decides its waivers.');
      }
      const after = await this.loadWaiver(client, id);
      await this.audit.recordWith(client, ctx, {
        action: `fee_waiver.${approve ? 'approved' : 'rejected'}`,
        objectType: 'fee_waiver',
        objectId: id,
        before: { status: before.status },
        after: {
          status: after.status,
          engagement: after.engagementId,
          periods: after.periods.map((p) => p.key),
          amount: after.amount,
        },
        ...(note ? { reason: note } : {}),
      });
      return after;
    });
  }

  /** Not billing the periods: a request, and the client's partners asked to decide it. */
  private async requestWaiver(
    client: PoolClient,
    ctx: RlsContext,
    input: SetAsideFeesInput,
    reason: string,
  ): Promise<FeeWaiver> {
    const { eng, items } = await this.pick(client, input.engagementId, input.keys, true);
    const periods: FeeWaiverPeriod[] = items.map((i) => ({
      key: i.key,
      label: i.label,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
      amount: i.amount,
    }));
    const amount = sumAmounts(periods.map((p) => p.amount));
    let id: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.fee_waivers
           (engagement_id, client_entity_id, periods, amount, reason, requested_by_employee_id)
         VALUES ($1, $2, $3::jsonb, $4::numeric, $5, $6) RETURNING id`,
        [
          eng.engagementId,
          eng.clientId,
          JSON.stringify(periods),
          amount,
          reason,
          ctx.employeeId ?? null,
        ],
      );
      id = rows[0]!.id;
    } catch (err) {
      throw translateInvoiceError(err);
    }
    const waiver = await this.loadWaiver(client, id);
    await this.audit.recordWith(client, ctx, {
      action: 'fee_waiver.requested',
      objectType: 'fee_waiver',
      objectId: id,
      after: { engagement: eng.engagementId, periods: periods.map((p) => p.key), amount },
      reason,
    });
    const { rows: approvers } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.billing_approvers($1) AS t(id) WHERE id IS DISTINCT FROM $2`,
      [eng.clientId, ctx.employeeId ?? null],
    );
    await this.notifications.emitWith(client, ctx, {
      type: NOTIFICATION_TYPE.writeOffPending,
      recipientEmployeeIds: approvers.map((r) => r.id),
      title: `Not billing ${formatInr(amount)} to approve · ${eng.clientName}`,
      body: `${eng.serviceName}, ${periods.map((p) => p.label).join(', ')}: ${reason}`,
      engagementId: eng.engagementId,
      objectType: 'fee_waiver',
      objectId: id,
    });
    return waiver;
  }

  private async loadWaiver(client: PoolClient, id: string): Promise<FeeWaiver> {
    const { rows } = await client.query<WaiverRow>(`${WAIVER_SELECT} WHERE w.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Waiver not found.');
    return mapWaiver(rows[0]);
  }

  /** List a set-aside period as unbilled again (the engagement's billers). */
  restore(ctx: RlsContext, input: RestoreFeeInput): Promise<{ restored: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `UPDATE hsdg.fee_billings SET released_at = now()
          WHERE engagement_id = $1 AND period_key = $2
            AND released_at IS NULL AND billed_invoice_id IS NULL
          RETURNING id`,
        [input.engagementId, input.key],
      );
      if (!rows[0]) throw new NotFoundException('Nothing set aside under that period.');
      await this.audit.recordWith(client, ctx, {
        action: 'fee.restored',
        objectType: 'engagement',
        objectId: input.engagementId,
        after: { period: input.key },
      });
      return { restored: input.key };
    });
  }

  /** The engagement's fee milestones and events, by date, with where each stands. */
  milestones(ctx: RlsContext, engagementId: string): Promise<FeeMilestone[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (!(await this.visible(client, engagementId))) {
        throw new NotFoundException('Engagement not found.');
      }
      const asOf = await istToday(client);
      const { rows } = await client.query<MilestoneRow>(
        `${MILESTONE_SELECT} WHERE m.engagement_id = $1 ORDER BY m.due_on, m.created_at`,
        [engagementId],
      );
      return rows.map((r) => mapMilestone(r, asOf));
    });
  }

  /** Agree a fee on a milestone or an event (engagement leads with billing.manage). */
  addMilestone(
    ctx: RlsContext,
    engagementId: string,
    input: CreateFeeMilestoneInput,
  ): Promise<FeeMilestone> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (!(await this.visible(client, engagementId))) {
        throw new NotFoundException('Engagement not found.');
      }
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_fee_milestones
             (engagement_id, kind, description, amount, due_on, created_by_employee_id)
           VALUES ($1, $2, $3, $4::numeric, $5::date, $6) RETURNING id`,
          [
            engagementId,
            input.kind,
            input.description.trim(),
            input.amount,
            input.dueOn,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateInvoiceError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'fee_milestone.added',
        objectType: 'engagement_fee_milestone',
        objectId: id,
        after: { engagementId, kind: input.kind, amount: input.amount, dueOn: input.dueOn },
      });
      return this.loadMilestone(client, id);
    });
  }

  /** Cancel a fee milestone that is on no live invoice; a set-aside one is let go. */
  cancelMilestone(ctx: RlsContext, id: string): Promise<FeeMilestone> {
    return this.db.withRlsContext(ctx, async (client) => {
      const m = await this.loadMilestone(client, id);
      if (m.status === 'cancelled') throw new BadRequestException('Already cancelled.');
      if (m.status === 'billed') {
        throw new BadRequestException(
          'It is on an invoice: void the invoice or take the line off the draft first.',
        );
      }
      const res = await client.query(
        `UPDATE hsdg.engagement_fee_milestones
            SET cancelled_at = now(), cancelled_by_employee_id = $2
          WHERE id = $1 AND cancelled_at IS NULL`,
        [id, ctx.employeeId ?? null],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ForbiddenException('Only the engagement partner or manager can cancel it.');
      }
      if (m.status === 'set_aside') {
        await client.query(
          `UPDATE hsdg.fee_billings SET released_at = now()
            WHERE engagement_id = $1 AND period_key = $2
              AND released_at IS NULL AND billed_invoice_id IS NULL`,
          [m.engagementId, `milestone:${id}`],
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'fee_milestone.cancelled',
        objectType: 'engagement_fee_milestone',
        objectId: id,
        before: { status: m.status },
      });
      return this.loadMilestone(client, id);
    });
  }

  private async loadMilestone(client: PoolClient, id: string): Promise<FeeMilestone> {
    const asOf = await istToday(client);
    const { rows } = await client.query<MilestoneRow>(`${MILESTONE_SELECT} WHERE m.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Fee milestone not found.');
    return mapMilestone(rows[0], asOf);
  }

  /**
   * The engagement's due, unbilled periods named by `keys` — locked so one
   * caller at a time takes them; fee_billings_once is the backstop. Setting
   * aside refuses a period whose waiver waits for a partner.
   */
  private async pick(
    client: PoolClient,
    engagementId: string,
    keys: string[],
    settingAside = false,
  ): Promise<{ eng: UnbilledEngagement; items: UnbilledItem[] }> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('fee_billings:' || $1))`, [
      engagementId,
    ]);
    const asOf = await istToday(client);
    const [eng] = await this.unbilled(client, asOf, { engagementId }, await billingFromOf(client));
    if (settingAside) {
      const waiting = (eng?.items ?? []).filter((i) => i.waiverId && keys.includes(i.key));
      if (waiting.length) {
        throw new BadRequestException(
          `A waiver of ${waiting.map((i) => i.label).join(', ')} is waiting for a partner.`,
        );
      }
    }
    const wanted = [...new Set(keys)];
    const due = new Set((eng?.items ?? []).map((i) => i.key));
    const missing = wanted.filter((k) => !due.has(k));
    if (!eng && !(await this.visible(client, engagementId))) {
      throw new NotFoundException('Engagement not found.');
    }
    if (!eng || missing.length || !wanted.length) {
      throw new BadRequestException(
        `Not due, or already on an invoice or set aside: ${(missing.length ? missing : wanted).join(', ')}.`,
      );
    }
    return { eng, items: eng.items.filter((i) => wanted.includes(i.key)) };
  }

  private async visible(client: PoolClient, engagementId: string): Promise<boolean> {
    const { rows } = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
      engagementId,
    ]);
    return rows.length > 0;
  }

  /**
   * Engagements the caller bills (ctx_may_bill_engagement) with fixed fees due
   * and not yet on an invoice, from the firm's billing go-live when set.
   */
  private async unbilled(
    client: PoolClient,
    asOf: string,
    filter: { partnerId?: string | null; engagementId?: string },
    billingFrom: string | null,
  ): Promise<UnbilledEngagement[]> {
    const { rows } = await client.query<TermsRow>(
      `SELECT e.id, e.engagement_code, s.name AS service_name, e.entity_id,
              ent.legal_name AS client_name, e.engagement_partner_id AS partner_id,
              ep.full_name AS partner_name, e.billing_model, e.status,
              e.planned_start_date::text, ec.billing_frequency, ec.effective_date::text,
              ec.end_date::text, ec.retainer_amount::text,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', y.id, 'financialYear', y.financial_year,
                         'feeAmount', y.fee_amount::text, 'billingModel', y.billing_model,
                         'closed', y.status = 'closed') ORDER BY y.financial_year)
                  FROM hsdg.compliance_engagement_years y
                 WHERE y.engagement_id = e.id AND y.fee_amount > 0), '[]'::json) AS years,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', m.id, 'description', m.description,
                         'amount', m.amount::text, 'dueOn', m.due_on::text) ORDER BY m.due_on)
                  FROM hsdg.engagement_fee_milestones m
                 WHERE m.engagement_id = e.id AND m.cancelled_at IS NULL), '[]'::json) AS milestones
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.services s ON s.id = e.service_id
         LEFT JOIN hsdg.employees ep ON ep.id = e.engagement_partner_id
         LEFT JOIN hsdg.engagement_commercial ec ON ec.engagement_id = e.id
        WHERE hsdg.ctx_may_bill_engagement(e.id)
          AND e.status IN ('accepted', 'active', 'on_hold', 'completed', 'closed')
          AND ($1::uuid IS NULL OR e.engagement_partner_id = $1)
          AND ($2::uuid IS NULL OR e.id = $2)
          AND (ec.retainer_amount > 0
               OR EXISTS (SELECT 1 FROM hsdg.compliance_engagement_years y
                           WHERE y.engagement_id = e.id AND y.fee_amount > 0)
               OR EXISTS (SELECT 1 FROM hsdg.engagement_fee_milestones m
                           WHERE m.engagement_id = e.id AND m.cancelled_at IS NULL)
               OR EXISTS (SELECT 1 FROM hsdg.fee_billings fb
                           WHERE fb.engagement_id = e.id AND fb.released_at IS NULL
                             AND fb.billed_invoice_id IS NULL))`,
      [filter.partnerId ?? null, filter.engagementId ?? null],
    );
    if (!rows.length) return [];
    const { rows: open } = await client.query<OpenRow>(
      `SELECT fb.engagement_id, fb.period_key, fb.billed_invoice_id, fb.label, fb.skip_reason,
              fb.skip_kind, fb.external_invoice_number, fb.external_invoice_date::text,
              fb.amount::text, fb.period_start::text, fb.period_end::text,
              e.full_name AS by_name, fb.created_at
         FROM hsdg.fee_billings fb
         LEFT JOIN hsdg.employees e ON e.id = fb.created_by_employee_id
        WHERE fb.released_at IS NULL AND fb.engagement_id = ANY($1::uuid[])
        ORDER BY fb.period_start, fb.period_key`,
      [rows.map((r) => r.id)],
    );
    const { rows: pending } = await client.query<WaiverRow>(
      `${WAIVER_SELECT} WHERE w.status = 'pending' AND w.engagement_id = ANY($1::uuid[])
        ORDER BY w.created_at`,
      [rows.map((r) => r.id)],
    );
    const waivers = pending.map(mapWaiver);
    const waiverOf = new Map(
      waivers.flatMap((w) => w.periods.map((p) => [`${w.engagementId}|${p.key}`, w.id] as const)),
    );
    const taken = new Set(open.map((b) => `${b.engagement_id}|${b.period_key}`));
    const out: UnbilledEngagement[] = [];
    for (const r of rows) {
      const items = dueFeeItems(
        {
          frequency: r.billing_frequency,
          startDate: r.effective_date ?? r.planned_start_date,
          endDate: r.end_date,
          retainerAmount: r.retainer_amount,
          billingModel: r.billing_model,
          completed: r.status === 'completed' || r.status === 'closed',
          years: r.years,
          milestones: r.milestones,
        },
        asOf,
        billingFrom,
      )
        .filter((i) => !taken.has(`${r.id}|${i.key}`))
        .map((i) => ({ ...i, waiverId: waiverOf.get(`${r.id}|${i.key}`) ?? null }));
      const setAside: SetAsideFee[] = open
        .filter(
          (o) =>
            o.engagement_id === r.id &&
            !o.billed_invoice_id &&
            (!billingFrom || o.period_end >= billingFrom),
        )
        .map((o) => ({
          key: o.period_key,
          label: o.label ?? o.period_key,
          periodStart: o.period_start,
          periodEnd: o.period_end,
          amount: o.amount,
          kind: o.skip_kind,
          externalInvoiceNumber: o.external_invoice_number,
          externalInvoiceDate: o.external_invoice_date,
          reason: o.skip_reason ?? '',
          byName: o.by_name,
          at: o.created_at.toISOString(),
        }));
      if (!items.length && !setAside.length) continue;
      out.push({
        engagementId: r.id,
        engagementCode: r.engagement_code,
        serviceName: r.service_name,
        clientId: r.entity_id,
        clientName: r.client_name,
        partnerId: r.partner_id,
        partnerName: r.partner_name,
        items,
        total: sumAmounts(items.map((i) => i.amount)),
        setAside,
        waivers: waivers.filter((w) => w.engagementId === r.id),
      });
    }
    // The oldest unbilled period first, then the most money.
    return out.sort(
      (a, b) =>
        (b.items[0]?.ageDays ?? -1) - (a.items[0]?.ageDays ?? -1) ||
        Number(b.total) - Number(a.total) ||
        a.clientName.localeCompare(b.clientName),
    );
  }
}

async function istToday(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ d: string }>(
    `SELECT timezone('Asia/Kolkata', now())::date::text AS d`,
  );
  return rows[0]!.d;
}

/** The firm's billing go-live (Billing settings): the unbilled list starts there. */
async function billingFromOf(client: PoolClient): Promise<string | null> {
  const { rows } = await client.query<{ d: string | null }>(
    `SELECT billing_from::text AS d FROM hsdg.firm_settings LIMIT 1`,
  );
  return rows[0]?.d ?? null;
}

function mapWaiver(r: WaiverRow): FeeWaiver {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    clientId: r.client_entity_id,
    clientName: r.client_name,
    engagementCode: r.engagement_code,
    serviceName: r.service_name,
    periods: r.periods,
    amount: r.amount,
    reason: r.reason,
    status: r.status,
    requestedById: r.requested_by_employee_id,
    requestedByName: r.requested_by_name,
    at: r.created_at.toISOString(),
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at?.toISOString() ?? null,
    decisionNote: r.decision_note,
    version: r.version,
  };
}

/** Another caller took one of the periods between our read and our write. */
function raced(err: unknown): Error {
  if ((err as { code?: string }).code === '23505') {
    return new ConflictException('Someone has just billed or set aside one of these periods.');
  }
  return translateInvoiceError(err);
}

function mapMilestone(r: MilestoneRow, asOf: string): FeeMilestone {
  const status: FeeMilestoneStatus = r.cancelled
    ? 'cancelled'
    : r.billed_invoice_id
      ? 'billed'
      : r.open
        ? 'set_aside'
        : r.due_on <= asOf
          ? 'due'
          : 'upcoming';
  return {
    id: r.id,
    engagementId: r.engagement_id,
    kind: r.kind,
    description: r.description,
    amount: r.amount,
    dueOn: r.due_on,
    status,
    invoiceId: r.billed_invoice_id,
    createdByName: r.created_by_name,
    createdAt: r.created_at.toISOString(),
  };
}

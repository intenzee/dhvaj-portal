import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  sumAmounts,
  type BillingFrequency,
  type CreateFeeMilestoneInput,
  type DraftFromUnbilledInput,
  type FeeMilestone,
  type FeeMilestoneStatus,
  type InvoiceDetail,
  type RestoreFeeInput,
  type SetAsideFee,
  type SetAsideFeesInput,
  type UnbilledEngagement,
  type UnbilledItem,
  type UnbilledReport,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { CommercialService, translateInvoiceError } from '../commercial/commercial.service';
import { dueFeeItems, lookbackStart, type FeeTerms } from './unbilled';

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
 * A period billed outside the app (or not billed) is set aside with a reason
 * and can be restored; fee milestones and events join the list on their date.
 */
@Injectable()
export class UnbilledService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly commercial: CommercialService,
  ) {}

  report(ctx: RlsContext, partnerId: string | null): Promise<UnbilledReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      const asOf = await istToday(client);
      const engagements = await this.unbilled(client, asOf, { partnerId });
      return {
        asOf,
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

  /** Set due periods aside without an invoice: billed outside the app, or not billed. */
  setAside(ctx: RlsContext, input: SetAsideFeesInput): Promise<{ setAside: number }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { eng, items } = await this.pick(client, input.engagementId, input.keys);
      const reason = input.reason.trim();
      try {
        for (const i of items) {
          await client.query(
            `INSERT INTO hsdg.fee_billings
               (engagement_id, client_entity_id, period_key, period_start, period_end, amount,
                label, skip_reason, created_by_employee_id)
             VALUES ($1, $2, $3, $4::date, $5::date, $6::numeric, $7, $8, $9)`,
            [
              eng.engagementId,
              eng.clientId,
              i.key,
              i.periodStart,
              i.periodEnd,
              i.amount,
              i.label,
              reason,
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
        after: { periods: items.map((i) => i.key), reason },
      });
      return { setAside: items.length };
    });
  }

  /** List a set-aside period as unbilled again (engagement leads). */
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
   * caller at a time takes them; fee_billings_once is the backstop.
   */
  private async pick(
    client: PoolClient,
    engagementId: string,
    keys: string[],
  ): Promise<{ eng: UnbilledEngagement; items: UnbilledItem[] }> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('fee_billings:' || $1))`, [
      engagementId,
    ]);
    const asOf = await istToday(client);
    const [eng] = await this.unbilled(client, asOf, { engagementId });
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

  /** Engagements the caller bills with fixed fees due and not yet on an invoice. */
  private async unbilled(
    client: PoolClient,
    asOf: string,
    filter: { partnerId?: string | null; engagementId?: string },
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
        WHERE hsdg.ctx_can_bill(e.entity_id)
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
              fb.amount::text, fb.period_start::text, fb.period_end::text,
              e.full_name AS by_name, fb.created_at
         FROM hsdg.fee_billings fb
         LEFT JOIN hsdg.employees e ON e.id = fb.created_by_employee_id
        WHERE fb.released_at IS NULL AND fb.engagement_id = ANY($1::uuid[])
        ORDER BY fb.period_start, fb.period_key`,
      [rows.map((r) => r.id)],
    );
    const taken = new Set(open.map((b) => `${b.engagement_id}|${b.period_key}`));
    const from = lookbackStart(asOf);
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
      ).filter((i) => !taken.has(`${r.id}|${i.key}`));
      const setAside: SetAsideFee[] = open
        .filter((o) => o.engagement_id === r.id && !o.billed_invoice_id && o.period_end >= from)
        .map((o) => ({
          key: o.period_key,
          label: o.label ?? o.period_key,
          periodStart: o.period_start,
          periodEnd: o.period_end,
          amount: o.amount,
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

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  sumAmounts,
  type BillingFrequency,
  type DraftFromUnbilledInput,
  type InvoiceDetail,
  type UnbilledEngagement,
  type UnbilledReport,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { CommercialService } from '../commercial/commercial.service';
import { dueFeeItems, type FeeTerms } from './unbilled';

const NOTES = [
  'Time is not listed yet: it joins once charge-out rates and approved, billable time arrive (PS-302).',
  'Milestone and event fees are not listed: bill them from the engagement.',
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
}

/**
 * PS-206 · fixed fees that are due and on no invoice — the retainer per
 * period, or a compliance year's fee shared by the billing frequency — and
 * a draft invoice from the ones chosen. fee_billings holds each period put on
 * a live invoice, so none is billed twice; voiding the invoice releases them.
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
      // One drafter at a time per engagement; fee_billings_once is the backstop.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('fee_billings:' || $1))`, [
        input.engagementId,
      ]);
      const asOf = await istToday(client);
      const [eng] = await this.unbilled(client, asOf, { engagementId: input.engagementId });
      const keys = [...new Set(input.keys)];
      const due = new Map((eng?.items ?? []).map((i) => [i.key, i]));
      const missing = keys.filter((k) => !due.has(k));
      if (!eng && !(await this.visible(client, input.engagementId))) {
        throw new NotFoundException('Engagement not found.');
      }
      if (!eng || missing.length) {
        throw new BadRequestException(
          `Not due, or already on an invoice: ${(missing.length ? missing : keys).join(', ')}.`,
        );
      }
      const items = eng.items.filter((i) => keys.includes(i.key));
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
                billed_invoice_id, invoice_line_id, created_by_employee_id)
             VALUES ($1, $2, $3, $4::date, $5::date, $6::numeric, $7, $8, $9)`,
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
            ],
          );
        }
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('Someone has just put one of these periods on an invoice.');
        }
        throw err;
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
                 WHERE y.engagement_id = e.id AND y.fee_amount > 0), '[]'::json) AS years
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.services s ON s.id = e.service_id
         LEFT JOIN hsdg.employees ep ON ep.id = e.engagement_partner_id
         LEFT JOIN hsdg.engagement_commercial ec ON ec.engagement_id = e.id
        WHERE hsdg.ctx_can_bill(e.entity_id)
          AND e.status IN ('accepted', 'active', 'on_hold', 'completed', 'closed')
          AND ($1::uuid IS NULL OR e.engagement_partner_id = $1)
          AND ($2::uuid IS NULL OR e.id = $2)
          AND (ec.retainer_amount > 0 OR EXISTS (
                SELECT 1 FROM hsdg.compliance_engagement_years y
                 WHERE y.engagement_id = e.id AND y.fee_amount > 0))`,
      [filter.partnerId ?? null, filter.engagementId ?? null],
    );
    if (!rows.length) return [];
    const { rows: billed } = await client.query<{ engagement_id: string; period_key: string }>(
      `SELECT engagement_id, period_key FROM hsdg.fee_billings
        WHERE released_at IS NULL AND engagement_id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)],
    );
    const taken = new Set(billed.map((b) => `${b.engagement_id}|${b.period_key}`));
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
        },
        asOf,
      ).filter((i) => !taken.has(`${r.id}|${i.key}`));
      if (!items.length) continue;
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
      });
    }
    // The oldest unbilled period first, then the most money.
    return out.sort(
      (a, b) =>
        b.items[0]!.ageDays - a.items[0]!.ageDays ||
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

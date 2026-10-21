import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  financialYearOf,
  formatInr,
  fromPaise,
  stateCodeFromName,
  toPaise,
  type AccountsDesk,
  type ApprovalItem,
  type ApprovalListQuery,
  type BillingClientRow,
  type ClientBillingProfile,
  type EngagementCommercialView,
  type InvoiceIssueRequest,
  type InvoiceStatus,
  type IssueRequestClosedReason,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { DAYS_PAST_DUE_SQL, ReceivablesService } from '../billing/receivables.service';
import { AdjustmentsService } from '../billing/adjustments.service';
import { TdsCreditsService } from '../billing/tds-credits.service';
import { UnbilledService } from '../billing/unbilled.service';
import { CommercialService } from '../commercial/commercial.service';
import { NotificationsService } from '../notifications/notifications.service';

interface ProfileRow {
  id: string;
  entity_code: string;
  legal_name: string;
  display_name: string | null;
  pan: string | null;
  status: string;
  gstin: string | null;
  gstin_count: number;
  billing_address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_pincode: string | null;
  address_country: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  terms_days: number | null;
}

interface IssueRequestRow {
  id: string;
  invoice_id: string;
  engagement_id: string;
  client_entity_id: string;
  client_name: string;
  total: string;
  note: string | null;
  requested_by_employee_id: string | null;
  requested_by_name: string | null;
  created_at: Date;
  closed_at: Date | null;
  closed_reason: IssueRequestClosedReason | null;
  invoice_number: string | null;
}

const ISSUE_REQUEST_SELECT = `
  SELECT r.id, r.invoice_id, r.engagement_id, r.client_entity_id, p.legal_name AS client_name,
         i.total::text, i.invoice_number, r.note, r.requested_by_employee_id,
         n.full_name AS requested_by_name, r.created_at, r.closed_at, r.closed_reason
    FROM hsdg.invoice_issue_requests r
    JOIN hsdg.invoices i ON i.id = r.invoice_id
    JOIN hsdg.entity_billing_profiles p ON p.id = r.client_entity_id
    LEFT JOIN hsdg.employee_names n ON n.id = r.requested_by_employee_id`;

/** Days in the past an approval stays on the "recent" list once decided. */
const RECENT_DAYS = 30;

/**
 * The Accountant's desk (spec §3.4): a client's billing profile, an
 * engagement's commercial view, the desk's numbers and queues, and asking a
 * partner to issue an ad-hoc invoice (decision 9.3). Reads go through the
 * billing views, so a partner or manager sees exactly what billing shows them
 * today and the Accountant every client it may bill, never the work.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly commercial: CommercialService,
    private readonly receivables: ReceivablesService,
    private readonly adjustments: AdjustmentsService,
    private readonly unbilled: UnbilledService,
    private readonly tds: TdsCreditsService,
  ) {}

  profile(ctx: RlsContext, entityId: string): Promise<ClientBillingProfile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ProfileRow>(
        `SELECT p.id, p.entity_code, p.legal_name, p.display_name, p.pan, p.status, p.gstin,
                p.gstin_count, p.billing_address, p.address_line1, p.address_line2,
                p.address_city, p.address_state, p.address_pincode, p.address_country,
                p.contact_name, p.contact_email, p.contact_phone,
                (SELECT f.invoice_terms_days FROM hsdg.firm_settings f LIMIT 1) AS terms_days
           FROM hsdg.entity_billing_profiles p
          WHERE p.id = $1 AND hsdg.ctx_can_bill(p.id)`,
        [entityId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Client not found.');
      const hasAddress = r.address_line1 !== null || r.address_state !== null;
      return {
        id: r.id,
        entityCode: r.entity_code,
        legalName: r.legal_name,
        displayName: r.display_name,
        pan: r.pan,
        status: r.status,
        gstin: r.gstin,
        gstinCount: r.gstin_count,
        stateCode: r.gstin
          ? r.gstin.slice(0, 2)
          : r.address_state && (r.address_country ?? 'IN') === 'IN'
            ? stateCodeFromName(r.address_state)
            : null,
        billingAddress: r.billing_address,
        address: hasAddress
          ? {
              line1: r.address_line1,
              line2: r.address_line2,
              city: r.address_city,
              state: r.address_state,
              pincode: r.address_pincode,
              country: r.address_country,
            }
          : null,
        contact: { name: r.contact_name, email: r.contact_email, phone: r.contact_phone },
        creditTermsDays: r.terms_days,
      };
    });
  }

  /** The clients the caller may bill, largest balance first. */
  clients(
    ctx: RlsContext,
    query: { q?: string; owing?: boolean; limit?: number },
  ): Promise<BillingClientRow[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const q = query.q?.trim() ? `%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%` : null;
      const { rows } = await client.query<{
        id: string;
        entity_code: string;
        legal_name: string;
        gstin: string | null;
        outstanding: string;
        open_invoices: number;
      }>(
        `SELECT p.id, p.entity_code, p.legal_name, p.gstin,
                COALESCE(o.outstanding, 0)::numeric(14, 2)::text AS outstanding,
                COALESCE(o.n, 0)::int AS open_invoices
           FROM hsdg.entity_billing_profiles p
           LEFT JOIN LATERAL (
             SELECT sum(i.total - i.amount_settled) AS outstanding, count(*) AS n
               FROM hsdg.invoices i
              WHERE i.client_entity_id = p.id AND i.status IN ('issued', 'partially_paid')
                AND i.total > i.amount_settled) o ON true
          WHERE hsdg.ctx_can_bill(p.id)
            AND ($1::text IS NULL OR p.legal_name ILIKE $1 OR p.entity_code ILIKE $1
                 OR p.gstin ILIKE $1 OR p.display_name ILIKE $1)
            AND (NOT $2::boolean OR COALESCE(o.outstanding, 0) > 0)
          ORDER BY COALESCE(o.outstanding, 0) DESC, p.legal_name
          LIMIT $3`,
        [q, query.owing ?? false, query.limit ?? 50],
      );
      return rows.map((r) => ({
        id: r.id,
        entityCode: r.entity_code,
        legalName: r.legal_name,
        gstin: r.gstin,
        outstanding: r.outstanding,
        openInvoices: r.open_invoices,
      }));
    });
  }

  /** The engagement as billing needs it: header, fees, hours by person, invoices. */
  async engagement(ctx: RlsContext, engagementId: string): Promise<EngagementCommercialView> {
    const view = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        engagement_code: string;
        entity_id: string;
        client_name: string;
        service_name: string | null;
        financial_year: string | null;
        period_label: string | null;
        status: string;
        kind: string | null;
        billing_model: string | null;
        currency: string | null;
        engagement_partner_id: string | null;
        engagement_partner_name: string | null;
        engagement_manager_id: string | null;
        engagement_manager_name: string | null;
      }>(
        `SELECT h.id, h.engagement_code, h.entity_id, p.legal_name AS client_name, h.service_name,
                h.financial_year, h.period_label, h.status, h.kind, h.billing_model, h.currency,
                h.engagement_partner_id, h.engagement_partner_name,
                h.engagement_manager_id, h.engagement_manager_name
           FROM hsdg.engagement_billing_headers h
           JOIN hsdg.entity_billing_profiles p ON p.id = h.entity_id
          WHERE h.id = $1 AND hsdg.ctx_can_bill(h.entity_id)`,
        [engagementId],
      );
      const h = rows[0];
      if (!h) throw new NotFoundException('Engagement not found.');
      // Hours and rate per person; the entries themselves never leave here.
      const { rows: hours } = await client.query<{
        employee_id: string;
        employee_name: string;
        billable: string;
        billed: string;
        last_rate: string | null;
      }>(
        `WITH t AS MATERIALIZED (
           SELECT b.entry_id, b.employee_id, b.duration_seconds
             FROM hsdg.billable_time_entries b
            WHERE b.engagement_id = $1 AND b.ended_at IS NOT NULL AND b.is_billable
              AND b.duration_seconds > 0)
         SELECT t.employee_id, COALESCE(n.full_name, 'Team member') AS employee_name,
                sum(t.duration_seconds)::text AS billable,
                COALESCE(sum(t.duration_seconds) FILTER (WHERE tb.id IS NOT NULL), 0)::text AS billed,
                (array_agg(tb.rate_per_hour::text ORDER BY tb.created_at DESC)
                   FILTER (WHERE tb.id IS NOT NULL))[1] AS last_rate
           FROM t
           LEFT JOIN hsdg.time_billings tb
             ON tb.time_entry_id = t.entry_id AND tb.released_at IS NULL
           LEFT JOIN hsdg.employee_names n ON n.id = t.employee_id
          GROUP BY t.employee_id, n.full_name
          ORDER BY sum(t.duration_seconds) DESC`,
        [engagementId],
      );
      const { rows: invoices } = await client.query<{
        id: string;
        invoice_number: string | null;
        status: InvoiceStatus;
        issue_date: string | null;
        total: string;
        balance: string;
      }>(
        `SELECT i.id, i.invoice_number, i.status, i.issue_date::text, i.total::text,
                (i.total - i.amount_settled)::text AS balance
           FROM hsdg.invoices i
          WHERE i.engagement_id = $1
          ORDER BY i.created_at DESC
          LIMIT 100`,
        [engagementId],
      );
      return {
        id: h.id,
        engagementCode: h.engagement_code,
        clientId: h.entity_id,
        clientName: h.client_name,
        serviceName: h.service_name,
        financialYear: h.financial_year,
        periodLabel: h.period_label,
        status: h.status,
        kind: h.kind,
        billingModel: h.billing_model,
        currency: h.currency,
        partner: h.engagement_partner_id
          ? { id: h.engagement_partner_id, name: h.engagement_partner_name ?? 'Partner' }
          : null,
        manager: h.engagement_manager_id
          ? { id: h.engagement_manager_id, name: h.engagement_manager_name ?? 'Manager' }
          : null,
        hours: hours.map((r) => {
          const billable = Number(r.billable);
          const billed = Number(r.billed);
          return {
            employeeId: r.employee_id,
            employeeName: r.employee_name,
            billableSeconds: billable,
            billedSeconds: billed,
            unbilledSeconds: billable - billed,
            lastRatePerHour: r.last_rate,
          };
        }),
        invoices: invoices.map((r) => ({
          id: r.id,
          invoiceNumber: r.invoice_number,
          status: r.status,
          issueDate: r.issue_date,
          total: r.total,
          balance: r.balance,
        })),
      };
    });
    const feeMilestones = await this.unbilled.milestones(ctx, engagementId);
    return { ...view, feeMilestones };
  }

  /** Ask a partner to issue a draft that has an ad-hoc line (decision 9.3). */
  requestIssue(
    ctx: RlsContext,
    invoiceId: string,
    note: string | null,
  ): Promise<InvoiceIssueRequest> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        status: InvoiceStatus;
        engagement_id: string;
        client_entity_id: string;
        total: string;
        client_name: string;
        partner_id: string | null;
      }>(
        `SELECT i.status, i.engagement_id, i.client_entity_id, i.total::text,
                p.legal_name AS client_name, h.engagement_partner_id AS partner_id
           FROM hsdg.invoices i
           JOIN hsdg.entity_billing_profiles p ON p.id = i.client_entity_id
           LEFT JOIN hsdg.engagement_billing_headers h ON h.id = i.engagement_id
          WHERE i.id = $1
          FOR UPDATE OF i`,
        [invoiceId],
      );
      const inv = rows[0];
      if (!inv) throw new NotFoundException('Invoice not found.');
      if (inv.status !== 'draft') {
        throw new BadRequestException('Only a draft invoice waits to be issued.');
      }
      const adHoc = await this.commercial.adHocLines(client, invoiceId);
      if (adHoc.length === 0) {
        throw new BadRequestException(
          'An agreed fee or billable time stands behind every line: issue it yourself.',
        );
      }
      const text = note?.trim() || null;
      let id: string;
      try {
        const { rows: made } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.invoice_issue_requests (invoice_id, requested_by_employee_id, note)
           VALUES ($1, $2, $3) RETURNING id`,
          [invoiceId, ctx.employeeId ?? null, text],
        );
        id = made[0]!.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('A partner has already been asked to issue this invoice.');
        }
        throw err;
      }
      const lines = adHoc.map((l) => l.description);
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.issue_requested',
        objectType: 'invoice',
        objectId: invoiceId,
        after: { request: id, adHocLines: lines, total: inv.total },
        reason: text,
      });
      // The engagement partner decides; with none, whoever may approve billing.
      let recipients = inv.partner_id ? [inv.partner_id] : [];
      if (recipients.length === 0) {
        const { rows: approvers } = await client.query<{ id: string }>(
          `SELECT id FROM hsdg.billing_approvers($1) AS t(id)`,
          [inv.client_entity_id],
        );
        recipients = approvers.map((r) => r.id);
      }
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.writeOffPending,
        recipientEmployeeIds: recipients.filter((r) => r !== ctx.employeeId),
        title: `Invoice of ${formatInr(inv.total)} to issue · ${inv.client_name}`,
        body: `Not from an agreed fee or billable time: ${lines.join(', ')}${text ? `. ${text}` : ''}`,
        engagementId: inv.engagement_id,
        objectType: 'invoice',
        objectId: invoiceId,
      });
      return this.loadIssueRequest(client, id, lines);
    });
  }

  /** The requester takes the request back (the draft stays). */
  withdrawIssueRequest(ctx: RlsContext, id: string): Promise<InvoiceIssueRequest> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ invoice_id: string }>(
        `UPDATE hsdg.invoice_issue_requests
            SET closed_at = now(), closed_reason = 'withdrawn'
          WHERE id = $1 AND closed_at IS NULL AND requested_by_employee_id = $2
          RETURNING invoice_id`,
        [id, ctx.employeeId ?? null],
      );
      if (!rows[0]) throw new NotFoundException('No open request of yours to withdraw.');
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.issue_request_withdrawn',
        objectType: 'invoice',
        objectId: rows[0].invoice_id,
        after: { request: id },
      });
      return this.loadIssueRequest(client, id, []);
    });
  }

  /** Requests to partners of every kind: the caller's own, or all they may see. */
  async approvals(ctx: RlsContext, query: ApprovalListQuery): Promise<ApprovalItem[]> {
    const pendingOnly = (query.status ?? 'pending') === 'pending';
    const [requests, adjustments, waivers] = await Promise.all([
      this.db.withRlsContext(ctx, async (client) => {
        const { rows } = await client.query<IssueRequestRow>(
          `${ISSUE_REQUEST_SELECT}
            WHERE r.closed_at IS NULL
               OR (NOT $1::boolean AND r.closed_at > now() - make_interval(days => $2))
            ORDER BY r.created_at DESC LIMIT 200`,
          [pendingOnly, RECENT_DAYS],
        );
        return rows;
      }),
      this.adjustments.list(ctx, pendingOnly ? { status: 'pending' } : {}),
      this.unbilled.waivers(ctx, pendingOnly ? 'pending' : null),
    ]);
    const since = Date.now() - RECENT_DAYS * 86_400_000;
    const recent = (status: string, decidedAt: string | null): boolean =>
      status === 'pending' || (decidedAt !== null && Date.parse(decidedAt) >= since);
    const items: ApprovalItem[] = [
      ...requests.map((r): ApprovalItem => ({
        kind: 'invoice_issue',
        id: r.id,
        clientId: r.client_entity_id,
        clientName: r.client_name,
        engagementId: r.engagement_id,
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        amount: r.total,
        reason: r.note,
        status: r.closed_reason ?? 'pending',
        requestedById: r.requested_by_employee_id,
        requestedByName: r.requested_by_name,
        at: r.created_at.toISOString(),
        decidedByName: null,
        decidedAt: r.closed_at?.toISOString() ?? null,
        decisionNote: null,
      })),
      ...adjustments
        .filter((a) => recent(a.status, a.decidedAt))
        .map((a): ApprovalItem => ({
          kind: a.kind,
          id: a.id,
          clientId: a.clientEntityId,
          clientName: a.clientName,
          engagementId: a.engagementId,
          invoiceId: a.invoiceId,
          invoiceNumber: a.invoiceNumber,
          amount: a.total,
          reason: a.reason,
          status: a.status,
          requestedById: a.requestedById,
          requestedByName: a.requestedByName,
          at: a.requestedAt,
          decidedByName: a.decidedByName,
          decidedAt: a.decidedAt,
          decisionNote: a.decisionNote,
        })),
      ...waivers
        .filter((w) => recent(w.status, w.decidedAt))
        .map((w): ApprovalItem => ({
          kind: 'fee_waiver',
          id: w.id,
          clientId: w.clientId,
          clientName: w.clientName,
          engagementId: w.engagementId,
          invoiceId: null,
          invoiceNumber: null,
          amount: w.amount,
          reason: w.reason,
          status: w.status,
          requestedById: w.requestedById,
          requestedByName: w.requestedByName,
          at: w.at,
          decidedByName: w.decidedByName,
          decidedAt: w.decidedAt,
          decisionNote: w.decisionNote,
        })),
    ];
    const mine = (query.scope ?? 'mine') === 'mine';
    return items
      .filter((i) => !mine || (ctx.employeeId && i.requestedById === ctx.employeeId))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** The Accounts desk: this month's money, what is owed, and the work queues. */
  async desk(ctx: RlsContext): Promise<AccountsDesk> {
    const [base, payrollToBook] = await this.db.withRlsContext(
      ctx,
      async (client) => [await this.deskFigures(client), await this.payrollToBook(client)] as const,
    );
    const [receivables, unbilled, pending, tdsMissing] = await Promise.all([
      this.receivables.report(ctx),
      this.unbilled.report(ctx, null),
      this.approvals(ctx, { scope: 'all', status: 'pending' }),
      this.tds
        .match(ctx, financialYearOf(base.asOf), null)
        .then((r) => r.clients.reduce((n, c) => n + c.missing.length, 0))
        // No 26AS imported yet, or nothing to match: nothing to chase.
        .catch(() => 0),
    ]);
    return {
      asOf: base.asOf,
      month: base.month,
      kpis: {
        billed: base.billed,
        collected: base.collected,
        outstanding: receivables.totals.total,
        over90: receivables.totals.over90,
        over90Count: base.over90Count,
      },
      queues: {
        readyToIssue: base.drafts,
        unbilledFeesDue: unbilled.engagements.reduce((n, e) => n + e.items.length, 0),
        receiptsUnallocated: base.unallocated,
        tdsNotIn26as: tdsMissing,
        remindersDueToday: base.remindersDue,
        waitingForPartner: pending.length,
        payrollToBook,
      },
      byPartner: receivables.byPartner.map((p) => ({
        partnerId: p.id,
        partnerName: p.name,
        outstanding: p.total,
      })),
      collections: base.collections,
    };
  }

  /**
   * Approved or paid payroll runs HR has not yet locked: the Accountant's to
   * book (/payroll/books). Null for anyone outside finance.
   */
  private async payrollToBook(client: PoolClient): Promise<number | null> {
    const { rows } = await client.query<{ n: number | null }>(
      `SELECT CASE WHEN hsdg.ctx_is_finance() THEN count(*)::int END AS n
         FROM hsdg.payroll_runs WHERE status IN ('approved', 'paid')`,
    );
    return rows[0]?.n ?? null;
  }

  private async deskFigures(client: PoolClient) {
    const { rows } = await client.query<{
      as_of: string;
      month_start: string;
      month_end: string;
      billed: string;
      collected: string;
      over90_count: number;
      drafts: number;
      unallocated: number;
      reminders_due: number;
    }>(
      `WITH d AS (
         SELECT timezone('Asia/Kolkata', now())::date AS today,
                date_trunc('month', timezone('Asia/Kolkata', now()))::date AS m0),
       firm AS (SELECT f.invoice_reminder_days AS days FROM hsdg.firm_settings f LIMIT 1),
       open AS (
         SELECT i.id, ${DAYS_PAST_DUE_SQL('i')} AS dpd
           FROM hsdg.invoices i
          WHERE i.status IN ('issued', 'partially_paid') AND i.total > i.amount_settled)
       SELECT d.today::text AS as_of, d.m0::text AS month_start,
              (d.m0 + interval '1 month' - interval '1 day')::date::text AS month_end,
              (SELECT COALESCE(sum(i.total), 0)::text FROM hsdg.invoices i
                WHERE i.status IN ('issued', 'partially_paid', 'paid')
                  AND i.issue_date >= d.m0 AND i.issue_date <= d.today) AS billed,
              (SELECT COALESCE(sum(r.gross_amount), 0)::text FROM hsdg.receipts r
                WHERE r.status = 'posted' AND r.received_on >= d.m0
                  AND r.received_on <= d.today) AS collected,
              (SELECT count(*)::int FROM open WHERE open.dpd > 90) AS over90_count,
              (SELECT count(*)::int FROM hsdg.invoices i
                WHERE i.status = 'draft' AND i.total > 0) AS drafts,
              (SELECT count(*)::int FROM hsdg.receipts r
                WHERE r.status = 'posted'
                  AND r.gross_amount > COALESCE((SELECT sum(a.amount)
                                                   FROM hsdg.receipt_allocations a
                                                  WHERE a.receipt_id = r.id), 0)) AS unallocated,
              -- The latest reminder day an invoice has reached, with no reminder
              -- (by hand or automatic) sent since it reached it.
              (SELECT count(*)::int FROM open
                CROSS JOIN LATERAL (
                  SELECT max(x) AS reached FROM unnest((SELECT days FROM firm)) x
                   WHERE x <= open.dpd) due
                WHERE due.reached IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM hsdg.invoice_reminders r
                                   WHERE r.invoice_id = open.id
                                     AND r.days_past_due >= due.reached)) AS reminders_due
         FROM d`,
    );
    const r = rows[0]!;
    const { rows: months } = await client.query<{ month: string; amount: string }>(
      `WITH m AS (
         SELECT generate_series(
                  date_trunc('month', timezone('Asia/Kolkata', now())) - interval '5 months',
                  date_trunc('month', timezone('Asia/Kolkata', now())),
                  interval '1 month')::date AS m0)
       SELECT to_char(m.m0, 'YYYY-MM') AS month,
              COALESCE(sum(r.gross_amount), 0)::text AS amount
         FROM m
         LEFT JOIN hsdg.receipts r
           ON r.status = 'posted' AND r.received_on >= m.m0
          AND r.received_on < (m.m0 + interval '1 month')::date
        GROUP BY m.m0 ORDER BY m.m0`,
    );
    return {
      asOf: r.as_of,
      month: { start: r.month_start, end: r.month_end },
      billed: fromPaise(toPaise(r.billed)),
      collected: fromPaise(toPaise(r.collected)),
      over90Count: r.over90_count,
      drafts: r.drafts,
      unallocated: r.unallocated,
      remindersDue: r.reminders_due,
      collections: months.map((m) => ({ month: m.month, amount: fromPaise(toPaise(m.amount)) })),
    };
  }

  private async loadIssueRequest(
    client: PoolClient,
    id: string,
    adHocLines: string[],
  ): Promise<InvoiceIssueRequest> {
    const { rows } = await client.query<IssueRequestRow>(
      `${ISSUE_REQUEST_SELECT} WHERE r.id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Request not found.');
    return {
      id: r.id,
      invoiceId: r.invoice_id,
      engagementId: r.engagement_id,
      clientId: r.client_entity_id,
      clientName: r.client_name,
      total: r.total,
      adHocLines,
      note: r.note,
      requestedById: r.requested_by_employee_id,
      requestedByName: r.requested_by_name,
      at: r.created_at.toISOString(),
      closedAt: r.closed_at?.toISOString() ?? null,
      closedReason: r.closed_reason,
    };
  }
}

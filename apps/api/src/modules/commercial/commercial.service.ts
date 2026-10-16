import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  AGING_BUCKET,
  BILLING_FREQUENCY,
  INVOICE_STATUS,
  PERMISSION,
  amountInWords,
  gstSplit,
  type AgingBucket,
  type AgingBucketKey,
  type BillingSummary,
  type EngagementCommercial,
  type GlobalInvoiceRecord,
  type InvoiceDetail,
  type InvoiceLineItem,
  type InvoiceRecord,
  type InvoiceStatus,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { translatePgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../documents/storage/storage-provider';
import { istToday } from '../compliance/compliance-profile';
import { renderInvoicePdf } from '../billing/invoice-pdf';
import type {
  CreateInvoiceInput,
  InvoiceLineInput,
  SetInvoiceStatusInput,
  UpdateInvoiceInput,
  UpsertCommercialInput,
} from './commercial.types';

interface CommercialRow {
  engagement_id: string;
  billing_frequency: EngagementCommercial['billingFrequency'];
  effective_date: string | null;
  end_date: string | null;
  retainer_amount: string | null;
  scope_notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface InvoiceRow {
  id: string;
  engagement_id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  notes: string | null;
  created_by_employee_id: string | null;
  created_by_name: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  client_entity_id: string | null;
  client_gstin: string | null;
  place_of_supply_state: string | null;
  is_reverse_charge: boolean;
  cgst: string;
  sgst: string;
  igst: string;
  amount_in_words: string | null;
  financial_year: string | null;
  issued_at: Date | null;
  issued_by_name: string | null;
  voided_reason: string | null;
  voided_at: Date | null;
  voided_by_name: string | null;
  has_pdf: boolean;
}

interface LineRow {
  id: string;
  invoice_id: string;
  engagement_component_id: string | null;
  component_name: string | null;
  description: string;
  quantity: string;
  unit_amount: string;
  amount: string;
  sort_order: number;
  sac_code: string | null;
  taxable_value: string;
  gst_rate: string;
}

const INVOICE_COLUMNS = `
  i.id, i.engagement_id, i.invoice_number, i.status, i.currency,
  i.issue_date::text, i.due_date::text, i.subtotal, i.tax_amount, i.total,
  i.notes, i.created_by_employee_id, ce.full_name AS created_by_name,
  i.version, i.created_at, i.updated_at,
  i.client_entity_id, i.client_gstin, i.place_of_supply_state, i.is_reverse_charge,
  i.cgst, i.sgst, i.igst, i.amount_in_words, i.financial_year, i.issued_at,
  ie.full_name AS issued_by_name, i.voided_reason, i.voided_at, ve.full_name AS voided_by_name,
  (i.pdf_storage_reference IS NOT NULL) AS has_pdf`;

const INVOICE_JOINS = `
  LEFT JOIN hsdg.employees ce ON ce.id = i.created_by_employee_id
  LEFT JOIN hsdg.employees ie ON ie.id = i.issued_by_employee_id
  LEFT JOIN hsdg.employees ve ON ve.id = i.voided_by_employee_id`;

const INVOICE_BASE = `SELECT ${INVOICE_COLUMNS} FROM hsdg.invoices i ${INVOICE_JOINS}`;

/** The firm-wide invoice list adds engagement/client context and an overdue flag. */
interface GlobalInvoiceRow extends InvoiceRow {
  engagement_code: string | null;
  entity_id: string | null;
  entity_name: string | null;
  overdue: boolean;
}

// PS-201: a home-office partner or manager may bill a client without being on
// the engagement, so the engagement is a LEFT JOIN and the client comes from
// the invoice.
const GLOBAL_INVOICE_BASE = `
  SELECT ${INVOICE_COLUMNS},
         eng.engagement_code, i.client_entity_id AS entity_id, ent.legal_name AS entity_name,
         (i.status = 'issued' AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE) AS overdue
  FROM hsdg.invoices i
  ${INVOICE_JOINS}
  LEFT JOIN hsdg.engagements eng ON eng.id = i.engagement_id
  LEFT JOIN hsdg.entities ent ON ent.id = i.client_entity_id`;

/** Legal invoice status transitions (spec §31). */
const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  [INVOICE_STATUS.draft]: [INVOICE_STATUS.issued, INVOICE_STATUS.void],
  [INVOICE_STATUS.issued]: [INVOICE_STATUS.paid, INVOICE_STATUS.void],
  [INVOICE_STATUS.paid]: [],
  [INVOICE_STATUS.void]: [],
};

/**
 * Commercial Scope & Billing (spec §31). The engagement carries a 1:1 commercial
 * configuration and a set of invoices; every read is engagement-member-scoped
 * and every write is engagement-lead-scoped through RLS, so a platform admin
 * never touches a client's commercials. Invoice totals are maintained by DB
 * triggers — this service never computes them by hand.
 */
@Injectable()
export class CommercialService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ── Commercial configuration (§31) ──────────────────────────────────────

  /** The engagement's commercial config, or a sensible default if none is set. */
  async getCommercial(ctx: RlsContext, engagementId: string): Promise<EngagementCommercial> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEngagementVisible(client, engagementId);
      const { rows } = await client.query<CommercialRow>(
        `SELECT engagement_id, billing_frequency, effective_date::text, end_date::text,
                retainer_amount, scope_notes, version, created_at, updated_at
         FROM hsdg.engagement_commercial WHERE engagement_id = $1`,
        [engagementId],
      );
      if (rows[0]) return mapCommercial(rows[0]);
      // Not yet configured — return an unpersisted default (version 0).
      return {
        engagementId,
        billingFrequency: BILLING_FREQUENCY.monthly,
        effectiveDate: null,
        endDate: null,
        retainerAmount: null,
        scopeNotes: null,
        version: 0,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
    });
  }

  /** Create or amend the engagement's commercial config (upsert; audited). */
  async upsertCommercial(
    ctx: RlsContext,
    engagementId: string,
    input: UpsertCommercialInput,
  ): Promise<EngagementCommercial> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEngagementVisible(client, engagementId);
      let row: CommercialRow;
      try {
        const { rows } = await client.query<CommercialRow>(
          `INSERT INTO hsdg.engagement_commercial
             (engagement_id, billing_frequency, effective_date, end_date, retainer_amount, scope_notes)
           VALUES ($1, COALESCE($2,'monthly'), $3, $4, $5, $6)
           ON CONFLICT (engagement_id) DO UPDATE SET
             billing_frequency = COALESCE($2, hsdg.engagement_commercial.billing_frequency),
             effective_date    = $3,
             end_date          = $4,
             retainer_amount   = $5,
             scope_notes       = $6,
             version           = hsdg.engagement_commercial.version + 1
           RETURNING engagement_id, billing_frequency, effective_date::text, end_date::text,
                     retainer_amount, scope_notes, version, created_at, updated_at`,
          [
            engagementId,
            input.billingFrequency ?? null,
            input.effectiveDate ?? null,
            input.endDate ?? null,
            input.retainerAmount ?? null,
            input.scopeNotes ?? null,
          ],
        );
        row = rows[0]!;
      } catch (err) {
        throw translateInvoiceError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'commercial.configured',
        objectType: 'engagement_commercial',
        objectId: engagementId,
        after: { billingFrequency: row.billing_frequency },
      });
      return mapCommercial(row);
    });
  }

  // ── Invoices (§31) ──────────────────────────────────────────────────────

  async listInvoices(
    ctx: RlsContext,
    engagementId: string,
    page: PageParams,
    filter: { status?: InvoiceStatus },
  ): Promise<PageResult<InvoiceRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEngagementVisible(client, engagementId);
      const params: unknown[] = [engagementId];
      let statusClause = '';
      if (filter.status) {
        params.push(filter.status);
        statusClause = `AND i.status = $${params.length}`;
      }
      params.push(page.limit, page.offset);
      const { rows } = await client.query<InvoiceRow & { total_count: string }>(
        `SELECT x.*, count(*) OVER() AS total_count
         FROM (${INVOICE_BASE} WHERE i.engagement_id = $1 ${statusClause}) x
         ORDER BY x.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: rows.map(mapInvoice),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  // ── Firm-wide Billing & Collections (§31) ───────────────────────────────
  // Read-only views across every engagement the caller can see. Access is the
  // same as the per-engagement list — the invoices SELECT policy is
  // is_engagement_member — so no extra scoping is needed here; RLS does it.

  /** Invoices across all accessible engagements, with client/engagement context. */
  async listAllInvoices(
    ctx: RlsContext,
    page: PageParams,
    filter: { status?: InvoiceStatus; overdueOnly?: boolean; search?: string },
  ): Promise<PageResult<GlobalInvoiceRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (filter.status) {
        params.push(filter.status);
        conds.push(`i.status = $${params.length}`);
      }
      if (filter.overdueOnly) {
        conds.push(`i.status = 'issued' AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE`);
      }
      if (filter.search) {
        params.push(`%${filter.search}%`);
        conds.push(
          `(i.invoice_number ILIKE $${params.length} OR ent.legal_name ILIKE $${params.length} OR eng.engagement_code ILIKE $${params.length})`,
        );
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      params.push(page.limit, page.offset);
      const { rows } = await client.query<GlobalInvoiceRow & { total_count: string }>(
        `SELECT x.*, count(*) OVER() AS total_count
         FROM (${GLOBAL_INVOICE_BASE} ${where}) x
         ORDER BY x.overdue DESC, x.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: rows.map(mapGlobalInvoice),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  /** Firm-wide billing rollup (counts + summed totals) over visible invoices. */
  async billingSummary(ctx: RlsContext): Promise<BillingSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        draft_cnt: string;
        draft_amt: string;
        issued_cnt: string;
        issued_amt: string;
        paid_cnt: string;
        paid_amt: string;
        void_cnt: string;
        void_amt: string;
        outstanding_cnt: string;
        outstanding_amt: string;
        overdue_cnt: string;
        overdue_amt: string;
        currency: string | null;
      }>(
        `SELECT
           count(*) FILTER (WHERE status = 'draft')                      AS draft_cnt,
           COALESCE(sum(total) FILTER (WHERE status = 'draft'), 0)       AS draft_amt,
           count(*) FILTER (WHERE status = 'issued')                     AS issued_cnt,
           COALESCE(sum(total) FILTER (WHERE status = 'issued'), 0)      AS issued_amt,
           count(*) FILTER (WHERE status = 'paid')                       AS paid_cnt,
           COALESCE(sum(total) FILTER (WHERE status = 'paid'), 0)        AS paid_amt,
           count(*) FILTER (WHERE status = 'void')                       AS void_cnt,
           COALESCE(sum(total) FILTER (WHERE status = 'void'), 0)        AS void_amt,
           count(*) FILTER (WHERE status = 'issued')                     AS outstanding_cnt,
           COALESCE(sum(total) FILTER (WHERE status = 'issued'), 0)      AS outstanding_amt,
           count(*) FILTER (WHERE status = 'issued'
             AND due_date IS NOT NULL AND due_date < CURRENT_DATE)       AS overdue_cnt,
           COALESCE(sum(total) FILTER (WHERE status = 'issued'
             AND due_date IS NOT NULL AND due_date < CURRENT_DATE), 0)   AS overdue_amt,
           (SELECT currency FROM hsdg.invoices
             GROUP BY currency ORDER BY count(*) DESC LIMIT 1)           AS currency
         FROM hsdg.invoices`,
      );
      const r = rows[0];
      const bucket = (cnt: string, amt: string): BillingSummary['draft'] => ({
        count: Number(cnt),
        amount: amt,
      });
      return {
        currency: r?.currency ?? 'INR',
        draft: bucket(r?.draft_cnt ?? '0', r?.draft_amt ?? '0'),
        issued: bucket(r?.issued_cnt ?? '0', r?.issued_amt ?? '0'),
        paid: bucket(r?.paid_cnt ?? '0', r?.paid_amt ?? '0'),
        void: bucket(r?.void_cnt ?? '0', r?.void_amt ?? '0'),
        outstanding: bucket(r?.outstanding_cnt ?? '0', r?.outstanding_amt ?? '0'),
        overdue: bucket(r?.overdue_cnt ?? '0', r?.overdue_amt ?? '0'),
        aging: await this.agingBuckets(client),
      };
    });
  }

  /**
   * Receivables aging over the outstanding (issued, unpaid) invoices, bucketed
   * by days past the due date. Runs under the caller's RLS context — same scope
   * as the rest of the summary. Every band is returned (zero-filled) in order.
   */
  private async agingBuckets(client: PoolClient): Promise<AgingBucket[]> {
    const { rows } = await client.query<{ bucket: AgingBucketKey; cnt: string; amt: string }>(
      `SELECT
         CASE
           WHEN due_date IS NULL OR due_date >= CURRENT_DATE THEN 'not_due'
           WHEN CURRENT_DATE - due_date <= 30 THEN 'd1_30'
           WHEN CURRENT_DATE - due_date <= 60 THEN 'd31_60'
           WHEN CURRENT_DATE - due_date <= 90 THEN 'd61_90'
           ELSE 'd90_plus'
         END AS bucket,
         count(*)::text AS cnt,
         COALESCE(sum(total), 0)::text AS amt
       FROM hsdg.invoices
       WHERE status = 'issued'
       GROUP BY bucket`,
    );
    const by = new Map(rows.map((x) => [x.bucket, x]));
    const order: { key: AgingBucketKey; label: string }[] = [
      { key: AGING_BUCKET.notDue, label: 'Not yet due' },
      { key: AGING_BUCKET.d1_30, label: '1–30 days' },
      { key: AGING_BUCKET.d31_60, label: '31–60 days' },
      { key: AGING_BUCKET.d61_90, label: '61–90 days' },
      { key: AGING_BUCKET.d90Plus, label: '90+ days' },
    ];
    return order.map(({ key, label }) => ({
      key,
      label,
      count: Number(by.get(key)?.cnt ?? '0'),
      amount: by.get(key)?.amt ?? '0',
    }));
  }

  async getInvoice(
    ctx: RlsContext,
    engagementId: string,
    invoiceId: string,
  ): Promise<InvoiceDetail> {
    return this.db.withRlsContext(ctx, (client) =>
      this.selectInvoiceDetail(client, engagementId, invoiceId),
    );
  }

  /** Create a draft invoice with optional initial lines (one transaction; audited). */
  async createInvoice(
    ctx: RlsContext,
    engagementId: string,
    input: CreateInvoiceInput,
  ): Promise<InvoiceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertEngagementVisible(client, engagementId);
      // GST mode: the split worked from the lines wins over a sent taxAmount
      // (the shipped mobile app always sends one).
      if (await this.firmStateCode(client)) input = { ...input, taxAmount: undefined };
      const clientGstin =
        input.clientGstin !== undefined
          ? input.clientGstin
          : await this.soleClientGstin(client, engagementId);
      const placeOfSupply = input.placeOfSupplyState ?? clientGstin?.slice(0, 2) ?? null;
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.invoices
             (engagement_id, currency, due_date, tax_amount, notes, created_by_employee_id,
              client_gstin, place_of_supply_state, is_reverse_charge)
           VALUES ($1, COALESCE($2,'INR'), $3::date, COALESCE($4::numeric,0), $5, $6, $7, $8,
                   COALESCE($9, false))
           RETURNING id`,
          [
            engagementId,
            input.currency ?? null,
            input.dueDate ?? null,
            input.taxAmount ?? null,
            input.notes ?? null,
            ctx.employeeId ?? null,
            clientGstin,
            placeOfSupply,
            input.isReverseCharge ?? null,
          ],
        );
        id = rows[0]!.id;
        for (const [i, line] of (input.lines ?? []).entries()) {
          await this.insertLine(client, engagementId, id, line, i);
        }
        await this.retax(client, id);
      } catch (err) {
        throw translateInvoiceError(err);
      }
      const detail = await this.selectInvoiceDetail(client, engagementId, id);
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.created',
        objectType: 'invoice',
        objectId: id,
        after: { engagementId, lines: detail.lines.length, total: detail.total },
      });
      return detail;
    });
  }

  /** Amend a DRAFT invoice header (tax/due/notes/currency). Optimistic-locked. */
  async updateInvoice(
    ctx: RlsContext,
    engagementId: string,
    invoiceId: string,
    input: UpdateInvoiceInput,
  ): Promise<InvoiceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadInvoiceRow(client, engagementId, invoiceId);
      this.assertDraft(current, 'edited');
      if (input.version !== undefined && input.version !== current.version) {
        throw new ConflictException(
          `Invoice was modified by someone else (expected v${input.version}, found v${current.version}).`,
        );
      }
      if (input.taxAmount !== undefined && (await this.firmStateCode(client))) {
        input = { ...input, taxAmount: undefined };
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.currency !== undefined) push('currency', input.currency);
      if (input.issueDate !== undefined) push('issue_date', input.issueDate);
      if (input.dueDate !== undefined) push('due_date', input.dueDate);
      if (input.taxAmount !== undefined) push('tax_amount', input.taxAmount);
      if (input.notes !== undefined) push('notes', input.notes);
      if (input.clientGstin !== undefined) push('client_gstin', input.clientGstin);
      if (input.placeOfSupplyState !== undefined) {
        push('place_of_supply_state', input.placeOfSupplyState);
      } else if (input.clientGstin) {
        // A registered client's GSTIN names the place of supply.
        push('place_of_supply_state', input.clientGstin.slice(0, 2));
      }
      if (input.isReverseCharge !== undefined) push('is_reverse_charge', input.isReverseCharge);
      if (sets.length === 0) return this.selectInvoiceDetail(client, engagementId, invoiceId);
      params.push(invoiceId, engagementId, current.version);
      try {
        const result = await client.query(
          `UPDATE hsdg.invoices SET ${sets.join(', ')}, version = version + 1
           WHERE id = $${params.length - 2} AND engagement_id = $${params.length - 1}
             AND version = $${params.length}`,
          params,
        );
        if ((result.rowCount ?? 0) === 0) {
          throw new ConflictException('Invoice was modified concurrently — reload and retry.');
        }
        await this.retax(client, invoiceId);
      } catch (err) {
        throw translateInvoiceError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.updated',
        objectType: 'invoice',
        objectId: invoiceId,
        after: { fields: sets.map((s) => s.split(' = ')[0]) },
      });
      return this.selectInvoiceDetail(client, engagementId, invoiceId);
    });
  }

  /**
   * Transition an invoice's status (§31: draft→issued→paid; →void). Audited.
   * PS-201: issuing needs billing.manage and goes through hsdg.issue_invoice,
   * which numbers the invoice gap-free for its financial year; the PDF is
   * written in the same transaction. Voiding an issued invoice needs
   * billing.approve and a reason; the number stays taken.
   */
  async setStatus(
    ctx: RlsContext,
    engagementId: string,
    invoiceId: string,
    input: SetInvoiceStatusInput,
    caller: { permissions: readonly string[]; reasonRequired: boolean },
  ): Promise<InvoiceDetail> {
    const { permissions } = caller;
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadInvoiceRow(client, engagementId, invoiceId);
      if (current.status === input.status) {
        throw new BadRequestException(`Invoice is already ${input.status}.`);
      }
      if (!INVOICE_TRANSITIONS[current.status].includes(input.status)) {
        throw new BadRequestException(
          `Cannot move an invoice from ${current.status} to ${input.status}.`,
        );
      }
      const reason = input.reason?.trim() || null;
      if (input.status === INVOICE_STATUS.issued) {
        if (!permissions.includes(PERMISSION.billingManage)) {
          throw new ForbiddenException('Issuing an invoice needs the billing.manage permission.');
        }
        const issueDate = input.issueDate ?? current.issue_date ?? istToday();
        try {
          await this.retax(client, invoiceId);
          await client.query(`SELECT hsdg.issue_invoice($1, $2::date)`, [invoiceId, issueDate]);
        } catch (err) {
          throw translateInvoiceError(err);
        }
        await this.storePdf(client, engagementId, invoiceId);
      } else if (input.status === INVOICE_STATUS.void) {
        if (current.status !== INVOICE_STATUS.draft) {
          if (!permissions.includes(PERMISSION.billingApprove)) {
            throw new ForbiddenException(
              'Voiding an issued invoice needs the billing.approve permission.',
            );
          }
          // Without ff_billing_v2 the shipped mobile app voids with no reason.
          if (!reason && caller.reasonRequired) {
            throw new BadRequestException('Say why the invoice is being voided.');
          }
        }
        const voidReason =
          reason ?? (current.status === INVOICE_STATUS.draft ? 'Draft discarded' : NO_REASON);
        await client.query(
          `UPDATE hsdg.invoices
              SET status = 'void', voided_reason = $3,
                  voided_by_employee_id = $4, voided_at = now(), version = version + 1
            WHERE id = $1 AND engagement_id = $2`,
          [invoiceId, engagementId, voidReason, ctx.employeeId ?? null],
        );
      } else {
        const result = await client.query(
          `UPDATE hsdg.invoices SET status = $1, version = version + 1
            WHERE id = $2 AND engagement_id = $3`,
          [input.status, invoiceId, engagementId],
        );
        if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Invoice not found.');
      }
      const after = await this.selectInvoiceDetail(client, engagementId, invoiceId);
      await this.audit.recordWith(client, ctx, {
        action: `invoice.${input.status}`,
        objectType: 'invoice',
        objectId: invoiceId,
        before: { status: current.status },
        after: {
          status: input.status,
          ...(after.invoiceNumber ? { invoiceNumber: after.invoiceNumber } : {}),
          ...(reason ? { reason } : {}),
        },
      });
      return after;
    });
  }

  /** The kept PDF of an issued invoice. */
  async invoicePdf(
    ctx: RlsContext,
    engagementId: string,
    invoiceId: string,
  ): Promise<{ filename: string; data: Buffer }> {
    const row = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ number: string | null; ref: string | null }>(
        `SELECT invoice_number AS number, pdf_storage_reference AS ref
           FROM hsdg.invoices WHERE id = $1 AND engagement_id = $2`,
        [invoiceId, engagementId],
      );
      return rows[0];
    });
    if (!row) throw new NotFoundException('Invoice not found.');
    if (!row.ref || !row.number) {
      throw new NotFoundException('This invoice has no PDF: it is a draft or was issued before.');
    }
    return {
      filename: `${row.number.replace(/\//g, '-')}.pdf`,
      data: await this.storage.read(row.ref),
    };
  }

  // ── Invoice line items (draft only) ─────────────────────────────────────

  async addLine(
    ctx: RlsContext,
    engagementId: string,
    invoiceId: string,
    input: InvoiceLineInput,
  ): Promise<InvoiceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadInvoiceRow(client, engagementId, invoiceId);
      this.assertDraft(current, 'edited');
      const { rows } = await client.query<{ next: number }>(
        `SELECT COALESCE(max(sort_order) + 1, 0) AS next
         FROM hsdg.invoice_line_items WHERE invoice_id = $1`,
        [invoiceId],
      );
      try {
        await this.insertLine(client, engagementId, invoiceId, input, rows[0]?.next ?? 0);
        await this.retax(client, invoiceId);
      } catch (err) {
        throw translateInvoiceError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.line_added',
        objectType: 'invoice',
        objectId: invoiceId,
        after: { description: input.description },
      });
      return this.selectInvoiceDetail(client, engagementId, invoiceId);
    });
  }

  async removeLine(
    ctx: RlsContext,
    engagementId: string,
    invoiceId: string,
    lineId: string,
  ): Promise<InvoiceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const current = await this.loadInvoiceRow(client, engagementId, invoiceId);
      this.assertDraft(current, 'edited');
      const result = await client.query(
        `DELETE FROM hsdg.invoice_line_items WHERE id = $1 AND invoice_id = $2`,
        [lineId, invoiceId],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Line item not found.');
      await this.retax(client, invoiceId);
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.line_removed',
        objectType: 'invoice',
        objectId: invoiceId,
        after: { lineId },
      });
      return this.selectInvoiceDetail(client, engagementId, invoiceId);
    });
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async insertLine(
    client: PoolClient,
    engagementId: string,
    invoiceId: string,
    line: InvoiceLineInput,
    sortOrder: number,
  ): Promise<void> {
    // engagement_id is synced from the invoice by a trigger; a value is still
    // required by NOT NULL at insert time, so pass the known engagement.
    await client.query(
      `INSERT INTO hsdg.invoice_line_items
         (invoice_id, engagement_id, engagement_component_id, description, quantity, unit_amount,
          sort_order, sac_code, gst_rate)
       VALUES ($1, $2, $3, $4, COALESCE($5::numeric,1), COALESCE($6::numeric,0), $7,
               COALESCE($8, (SELECT sac_default FROM hsdg.firm_settings LIMIT 1)),
               COALESCE($9::numeric, 18))`,
      [
        invoiceId,
        engagementId,
        line.engagementComponentId ?? null,
        line.description,
        line.quantity ?? null,
        line.unitAmount ?? null,
        line.sortOrder ?? sortOrder,
        line.sacCode ?? null,
        line.gstRate ?? null,
      ],
    );
  }

  /** The firm's GST state; null until Billing → Settings names it (no GST split then). */
  private async firmStateCode(client: PoolClient): Promise<string | null> {
    const { rows } = await client.query<{ state_code: string | null }>(
      `SELECT state_code FROM hsdg.firm_settings LIMIT 1`,
    );
    return rows[0]?.state_code ?? null;
  }

  /** The client's GSTIN when it has exactly one active, well-formed registration. */
  private async soleClientGstin(client: PoolClient, engagementId: string): Promise<string | null> {
    const { rows } = await client.query<{ gstin: string }>(
      `SELECT r.registration_number AS gstin
         FROM hsdg.entity_registrations r
         JOIN hsdg.engagements e ON e.entity_id = r.entity_id
        WHERE e.id = $1 AND r.registration_type = 'gstin' AND r.status = 'active'
          AND r.registration_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'
        LIMIT 2`,
      [engagementId],
    );
    return rows.length === 1 ? rows[0]!.gstin : null;
  }

  /**
   * Work out a draft's tax from its lines (PS-201). With the firm's GST state
   * set, tax = the CGST/SGST or IGST split by gstSplit (nil collected on
   * reverse charge); without it the hand-entered tax stands. The total in
   * words follows either way.
   */
  private async retax(client: PoolClient, invoiceId: string): Promise<void> {
    const firmState = await this.firmStateCode(client);
    const { rows } = await client.query<{
      place_of_supply_state: string | null;
      is_reverse_charge: boolean;
    }>(`SELECT place_of_supply_state, is_reverse_charge FROM hsdg.invoices WHERE id = $1`, [
      invoiceId,
    ]);
    const inv = rows[0];
    if (!inv) throw new NotFoundException('Invoice not found.');
    if (firmState) {
      const { rows: lines } = await client.query<{ taxable_value: string; gst_rate: string }>(
        `SELECT taxable_value, gst_rate FROM hsdg.invoice_line_items WHERE invoice_id = $1`,
        [invoiceId],
      );
      const split = gstSplit(
        lines.map((l) => ({ taxableValue: l.taxable_value, gstRate: l.gst_rate })),
        firmState,
        inv.place_of_supply_state,
      );
      await client.query(
        `UPDATE hsdg.invoices SET cgst = $2, sgst = $3, igst = $4, tax_amount = $5 WHERE id = $1`,
        [invoiceId, split.cgst, split.sgst, split.igst, inv.is_reverse_charge ? '0' : split.tax],
      );
    } else {
      await client.query(`UPDATE hsdg.invoices SET cgst = 0, sgst = 0, igst = 0 WHERE id = $1`, [
        invoiceId,
      ]);
    }
    await client.query(
      `UPDATE hsdg.invoices SET amount_in_words = $2 WHERE id = $1 AND amount_in_words IS DISTINCT FROM $2`,
      [invoiceId, amountInWords((await this.totalOf(client, invoiceId)) ?? '0')],
    );
  }

  private async totalOf(client: PoolClient, invoiceId: string): Promise<string | null> {
    const { rows } = await client.query<{ total: string }>(
      `SELECT total FROM hsdg.invoices WHERE id = $1`,
      [invoiceId],
    );
    return rows[0]?.total ?? null;
  }

  /** Render the just-issued invoice and keep the PDF beside it. */
  private async storePdf(
    client: PoolClient,
    engagementId: string,
    invoiceId: string,
  ): Promise<void> {
    const inv = await this.selectInvoiceDetail(client, engagementId, invoiceId);
    const { rows: firmRows } = await client.query<{
      firm_name: string;
      address: string | null;
      gstin: string | null;
      state_code: string | null;
    }>(`SELECT firm_name, address, gstin, state_code FROM hsdg.firm_settings LIMIT 1`);
    const { rows: clientRows } = await client.query<{ legal_name: string; pan: string | null }>(
      `SELECT legal_name, pan FROM hsdg.entities WHERE id = $1`,
      [inv.clientEntityId],
    );
    const firm = firmRows[0];
    const split = gstSplit(
      inv.lines.map((l) => ({ taxableValue: l.taxableValue, gstRate: l.gstRate })),
      firm?.state_code ?? null,
      inv.placeOfSupplyState,
    );
    const pdf = renderInvoicePdf({
      firm: {
        name: firm?.firm_name ?? '',
        address: firm?.address ?? null,
        gstin: firm?.gstin ?? null,
        stateCode: firm?.state_code ?? null,
      },
      client: {
        name: clientRows[0]?.legal_name ?? '',
        pan: clientRows[0]?.pan ?? null,
        gstin: inv.clientGstin,
      },
      invoiceNumber: inv.invoiceNumber!,
      issueDate: inv.issueDate!,
      dueDate: inv.dueDate,
      placeOfSupplyState: inv.placeOfSupplyState,
      isReverseCharge: inv.isReverseCharge,
      lines: inv.lines.map((l) => ({
        description: l.description,
        sacCode: l.sacCode,
        quantity: l.quantity,
        unitAmount: l.unitAmount,
        gstRate: l.gstRate,
        taxableValue: l.taxableValue,
      })),
      // Without a firm GST state no split was charged; print the tax as entered.
      split: firm?.state_code ? split : { ...split, byRate: [], tax: inv.taxAmount },
      taxAmount: inv.taxAmount,
      total: inv.total,
      amountInWords: inv.amountInWords ?? amountInWords(inv.total),
      notes: inv.notes,
    });
    const reference = this.storage.newReference(engagementId, invoiceId);
    await this.storage.write(reference, pdf, 'application/pdf');
    await client.query(`UPDATE hsdg.invoices SET pdf_storage_reference = $2 WHERE id = $1`, [
      invoiceId,
      reference,
    ]);
  }

  private assertDraft(row: InvoiceRow, verb: string): void {
    if (row.status !== INVOICE_STATUS.draft) {
      throw new BadRequestException(
        `Only a draft invoice can be ${verb}; this invoice is ${row.status}.`,
      );
    }
  }

  private async loadInvoiceRow(
    client: PoolClient,
    engagementId: string,
    invoiceId: string,
  ): Promise<InvoiceRow> {
    const { rows } = await client.query<InvoiceRow>(
      `${INVOICE_BASE} WHERE i.id = $1 AND i.engagement_id = $2`,
      [invoiceId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Invoice not found.');
    return rows[0];
  }

  private async selectInvoiceDetail(
    client: PoolClient,
    engagementId: string,
    invoiceId: string,
  ): Promise<InvoiceDetail> {
    const header = mapInvoice(await this.loadInvoiceRow(client, engagementId, invoiceId));
    const { rows } = await client.query<LineRow>(
      `SELECT li.id, li.invoice_id, li.engagement_component_id, sc.name AS component_name,
              li.description, li.quantity, li.unit_amount, li.amount, li.sort_order,
              li.sac_code, li.taxable_value, li.gst_rate
       FROM hsdg.invoice_line_items li
       LEFT JOIN hsdg.engagement_components ec ON ec.id = li.engagement_component_id
       LEFT JOIN hsdg.service_components sc ON sc.id = ec.service_component_id
       WHERE li.invoice_id = $1
       ORDER BY li.sort_order, li.created_at`,
      [invoiceId],
    );
    return { ...header, lines: rows.map(mapLine) };
  }

  private async assertEngagementVisible(client: PoolClient, engagementId: string): Promise<void> {
    const { rows } = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
      engagementId,
    ]);
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
  }
}

function mapCommercial(row: CommercialRow): EngagementCommercial {
  return {
    engagementId: row.engagement_id,
    billingFrequency: row.billing_frequency,
    effectiveDate: row.effective_date,
    endDate: row.end_date,
    retainerAmount: row.retainer_amount,
    scopeNotes: row.scope_notes,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    currency: row.currency,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    subtotal: row.subtotal,
    taxAmount: row.tax_amount,
    total: row.total,
    notes: row.notes,
    createdByEmployeeId: row.created_by_employee_id,
    createdByName: row.created_by_name,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    clientEntityId: row.client_entity_id,
    clientGstin: row.client_gstin,
    placeOfSupplyState: row.place_of_supply_state,
    isReverseCharge: row.is_reverse_charge,
    cgst: row.cgst,
    sgst: row.sgst,
    igst: row.igst,
    amountInWords: row.amount_in_words,
    financialYear: row.financial_year,
    issuedAt: row.issued_at?.toISOString() ?? null,
    issuedByName: row.issued_by_name,
    voidedReason: row.voided_reason,
    voidedAt: row.voided_at?.toISOString() ?? null,
    voidedByName: row.voided_by_name,
    hasPdf: row.has_pdf,
  };
}

function mapGlobalInvoice(row: GlobalInvoiceRow): GlobalInvoiceRecord {
  return {
    ...mapInvoice(row),
    engagementCode: row.engagement_code,
    entityId: row.entity_id,
    entityName: row.entity_name,
    overdue: row.overdue,
  };
}

function mapLine(row: LineRow): InvoiceLineItem {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    engagementComponentId: row.engagement_component_id,
    componentName: row.component_name,
    description: row.description,
    quantity: row.quantity,
    unitAmount: row.unit_amount,
    amount: row.amount,
    sortOrder: row.sort_order,
    sacCode: row.sac_code,
    taxableValue: row.taxable_value,
    gstRate: row.gst_rate,
  };
}

/** Stored when a legacy client voids an issued invoice without saying why. */
const NO_REASON = '(no reason given)';

/** Map invoice/commercial PG violations to clean HTTP errors. */
export function translateInvoiceError(err: unknown): Error {
  const e = err as { code?: string; message?: string };
  // hsdg.issue_invoice and the issued-invoice guards.
  if (e.code === '22023') return new BadRequestException(e.message);
  if (e.code === 'P0002') return new NotFoundException(e.message);
  return translatePgError(err, {
    uniqueDefault: 'That value must be unique.',
    foreignKey: 'A referenced record does not exist.',
    check: (message) =>
      message && message.length <= 200 ? message : 'A value violates a check constraint.',
    forbidden: 'Not permitted to write this invoice.',
  });
}

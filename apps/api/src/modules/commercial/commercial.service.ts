import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  BILLING_FREQUENCY,
  INVOICE_STATUS,
  type EngagementCommercial,
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
  invoice_number: string;
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
}

const INVOICE_BASE = `
  SELECT i.id, i.engagement_id, i.invoice_number, i.status, i.currency,
         i.issue_date::text, i.due_date::text, i.subtotal, i.tax_amount, i.total,
         i.notes, i.created_by_employee_id, ce.full_name AS created_by_name,
         i.version, i.created_at, i.updated_at
  FROM hsdg.invoices i
  LEFT JOIN hsdg.employees ce ON ce.id = i.created_by_employee_id`;

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
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.invoices
             (engagement_id, currency, due_date, tax_amount, notes, created_by_employee_id)
           VALUES ($1, COALESCE($2,'INR'), $3::date, COALESCE($4::numeric,0), $5, $6)
           RETURNING id`,
          [
            engagementId,
            input.currency ?? null,
            input.dueDate ?? null,
            input.taxAmount ?? null,
            input.notes ?? null,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
        for (const [i, line] of (input.lines ?? []).entries()) {
          await this.insertLine(client, engagementId, id, line, i);
        }
      } catch (err) {
        throw translateInvoiceError(err);
      }
      const detail = await this.selectInvoiceDetail(client, engagementId, id);
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.created',
        objectType: 'invoice',
        objectId: id,
        after: { engagementId, invoiceNumber: detail.invoiceNumber, lines: detail.lines.length },
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

  /** Transition an invoice's status (§31: draft→issued→paid; →void). Audited. */
  async setStatus(
    ctx: RlsContext,
    engagementId: string,
    invoiceId: string,
    input: SetInvoiceStatusInput,
  ): Promise<InvoiceDetail> {
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
      // Issuing requires at least one line and stamps the issue date.
      let issueDateSet = '';
      const params: unknown[] = [input.status];
      if (input.status === INVOICE_STATUS.issued) {
        const { rows } = await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM hsdg.invoice_line_items WHERE invoice_id = $1`,
          [invoiceId],
        );
        if (Number(rows[0]?.n ?? 0) === 0) {
          throw new BadRequestException('Cannot issue an invoice with no line items.');
        }
        params.push(input.issueDate ?? new Date().toISOString().slice(0, 10));
        issueDateSet = `, issue_date = COALESCE(issue_date, $${params.length})`;
      }
      params.push(invoiceId, engagementId);
      const result = await client.query(
        `UPDATE hsdg.invoices SET status = $1${issueDateSet}, version = version + 1
         WHERE id = $${params.length - 1} AND engagement_id = $${params.length}`,
        params,
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Invoice not found.');
      await this.audit.recordWith(client, ctx, {
        action: `invoice.${input.status}`,
        objectType: 'invoice',
        objectId: invoiceId,
        before: { status: current.status },
        after: { status: input.status },
      });
      return this.selectInvoiceDetail(client, engagementId, invoiceId);
    });
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
         (invoice_id, engagement_id, engagement_component_id, description, quantity, unit_amount, sort_order)
       VALUES ($1, $2, $3, $4, COALESCE($5::numeric,1), COALESCE($6::numeric,0), $7)`,
      [
        invoiceId,
        engagementId,
        line.engagementComponentId ?? null,
        line.description,
        line.quantity ?? null,
        line.unitAmount ?? null,
        line.sortOrder ?? sortOrder,
      ],
    );
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
              li.description, li.quantity, li.unit_amount, li.amount, li.sort_order
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
  };
}

/** Map invoice/commercial PG violations to clean HTTP errors. */
export function translateInvoiceError(err: unknown): Error {
  return translatePgError(err, {
    uniqueDefault: 'That value must be unique.',
    foreignKey: 'A referenced record does not exist.',
    check: (message) =>
      message && message.length <= 200 ? message : 'A value violates a check constraint.',
    forbidden: 'Not permitted to write this invoice.',
  });
}

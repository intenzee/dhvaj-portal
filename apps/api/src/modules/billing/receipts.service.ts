import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  allocateOldestFirst,
  fromPaise,
  sumAmounts,
  tdsQuarterOf,
  toPaise,
  type ClientStatement,
  type CreateReceiptInput,
  type OpenInvoice,
  type ReceiptMode,
  type ReceiptRecord,
  type ReceiptStatus,
  type ReverseReceiptInput,
  type StatementLine,
  type TdsSection,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { translateInvoiceError } from '../commercial/commercial.service';

interface ReceiptRow {
  id: string;
  client_entity_id: string;
  client_name: string;
  received_on: string;
  mode: ReceiptMode;
  reference: string | null;
  gross_amount: string;
  tds_amount: string;
  tds_section: TdsSection | null;
  net_amount: string;
  bank_account: string | null;
  status: ReceiptStatus;
  reversed_reason: string | null;
  reversed_at: Date | null;
  recorded_by_name: string | null;
  version: number;
  created_at: Date;
}

interface AllocationRow {
  receipt_id: string;
  invoice_id: string;
  invoice_number: string | null;
  amount: string;
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  engagement_id: string;
  issue_date: string | null;
  due_date: string | null;
  status: string;
  total: string;
  amount_settled: string;
}

const RECEIPT_BASE = `
  SELECT r.id, r.client_entity_id, e.legal_name AS client_name, r.received_on::text,
         r.mode, r.reference, r.gross_amount, r.tds_amount, r.tds_section, r.net_amount,
         r.bank_account, r.status, r.reversed_reason, r.reversed_at,
         rb.full_name AS recorded_by_name, r.version, r.created_at
    FROM hsdg.receipts r
    JOIN hsdg.entity_billing_profiles e ON e.id = r.client_entity_id
    LEFT JOIN hsdg.employee_names rb ON rb.id = r.recorded_by_employee_id`;

/**
 * PS-202 · money in from clients. A receipt is what reached the bank plus the
 * TDS the client deducted; its gross settles invoices through allocations, and
 * hsdg.settle_invoice keeps each invoice's settled amount and status (issued →
 * partially_paid → paid) in step, under the invoice's row lock. What is not
 * allocated stays on the receipt as an advance. RLS: the client's billers.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(
    ctx: RlsContext,
    page: PageParams,
    filter: { clientId?: string; from?: string; to?: string },
  ): Promise<PageResult<ReceiptRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (filter.clientId) {
        params.push(filter.clientId);
        conds.push(`r.client_entity_id = $${params.length}`);
      }
      if (filter.from) {
        params.push(filter.from);
        conds.push(`r.received_on >= $${params.length}::date`);
      }
      if (filter.to) {
        params.push(filter.to);
        conds.push(`r.received_on <= $${params.length}::date`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      params.push(page.limit, page.offset);
      const { rows } = await client.query<ReceiptRow & { total_count: string }>(
        `SELECT x.*, count(*) OVER() AS total_count
           FROM (${RECEIPT_BASE} ${where}) x
          ORDER BY x.received_on DESC, x.created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: await this.withAllocations(client, rows),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  get(ctx: RlsContext, id: string): Promise<ReceiptRecord> {
    return this.db.withRlsContext(ctx, (client) => this.load(client, id));
  }

  /**
   * Record a receipt and allocate it. Without `allocations` the gross goes to
   * the client's open invoices oldest due first; `[]` keeps it as an advance.
   */
  create(ctx: RlsContext, input: CreateReceiptInput): Promise<ReceiptRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertClient(client, input.clientEntityId);
      const tds = input.tdsAmount ?? '0';
      if (toPaise(tds) > 0n && !input.tdsSection) {
        throw new BadRequestException('Say which section the client deducted TDS under.');
      }
      const gross = fromPaise(toPaise(input.netAmount) + toPaise(tds));
      const allocations =
        input.allocations ??
        allocateOldestFirst(gross, await this.openInvoices(client, input.clientEntityId))
          .allocations;
      const seen = new Set<string>();
      for (const a of allocations) {
        if (seen.has(a.invoiceId)) {
          throw new BadRequestException('Allocate to each invoice once.');
        }
        seen.add(a.invoiceId);
      }
      if (toPaise(sumAmounts(allocations.map((a) => a.amount))) > toPaise(gross)) {
        throw new BadRequestException(
          `The allocations exceed the receipt's gross of ${gross} (net plus TDS).`,
        );
      }
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.receipts
             (client_entity_id, received_on, mode, reference, gross_amount, tds_amount,
              tds_section, bank_account, recorded_by_employee_id)
           VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            input.clientEntityId,
            input.receivedOn,
            input.mode,
            input.reference?.trim() || null,
            gross,
            tds,
            input.tdsSection ?? null,
            input.bankAccount?.trim() || null,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
        // In invoice order, so concurrent receipts lock invoices in one order.
        for (const a of [...allocations].sort((x, y) => x.invoiceId.localeCompare(y.invoiceId))) {
          await client.query(
            `INSERT INTO hsdg.receipt_allocations (receipt_id, invoice_id, amount)
             VALUES ($1, $2, $3)`,
            [id, a.invoiceId, a.amount],
          );
        }
      } catch (err) {
        throw translateReceiptError(err);
      }
      const after = await this.load(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'receipt.recorded',
        objectType: 'receipt',
        objectId: id,
        after: {
          client: input.clientEntityId,
          gross,
          tds,
          net: input.netAmount,
          allocations: after.allocations.map((a) => ({ invoice: a.invoiceId, amount: a.amount })),
        },
      });
      return after;
    });
  }

  /** Reverse a receipt (a bounced cheque, a mistake): its invoices reopen. */
  reverse(ctx: RlsContext, id: string, input: ReverseReceiptInput): Promise<ReceiptRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.load(client, id);
      if (before.status === 'reversed') {
        throw new BadRequestException('This receipt is already reversed.');
      }
      if (input.version !== undefined && input.version !== before.version) {
        throw new ConflictException(
          `Receipt was changed by someone else (expected v${input.version}, found v${before.version}).`,
        );
      }
      try {
        await client.query(
          `UPDATE hsdg.receipts
              SET status = 'reversed', reversed_reason = $2, reversed_at = now(),
                  reversed_by_employee_id = $3, version = version + 1
            WHERE id = $1`,
          [id, input.reason.trim(), ctx.employeeId ?? null],
        );
      } catch (err) {
        throw translateReceiptError(err);
      }
      const after = await this.load(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'receipt.reversed',
        objectType: 'receipt',
        objectId: id,
        before: { status: before.status },
        after: { status: after.status, invoices: before.allocations.map((a) => a.invoiceId) },
        reason: input.reason.trim(),
      });
      return after;
    });
  }

  /** Invoices, receipts, credits and the running balance for one client. */
  statement(ctx: RlsContext, entityId: string): Promise<ClientStatement> {
    return this.db.withRlsContext(ctx, async (client) => {
      const entityName = await this.assertClient(client, entityId);
      const invoices = await client.query<InvoiceRow>(
        `SELECT i.id, i.invoice_number, i.engagement_id, i.issue_date::text, i.due_date::text,
                i.status, i.total, i.amount_settled
           FROM hsdg.invoices i
          WHERE i.client_entity_id = $1 AND i.status IN ('issued', 'partially_paid', 'paid')
          ORDER BY i.issue_date, i.invoice_number`,
        [entityId],
      );
      const receiptRows = await client.query<ReceiptRow>(
        `${RECEIPT_BASE} WHERE r.client_entity_id = $1 ORDER BY r.received_on, r.created_at`,
        [entityId],
      );
      const receipts = await this.withAllocations(client, receiptRows.rows);
      const posted = receipts.filter((r) => r.status === 'posted');
      // PS-205: approved credit notes and write-offs, dated the day they were approved.
      const credits = await client.query<{
        id: string;
        kind: 'credit_note' | 'write_off';
        invoice_id: string;
        invoice_number: string | null;
        number: string | null;
        date: string;
        amount: string;
      }>(
        `SELECT a.id, a.kind, a.invoice_id, i.invoice_number, a.number, a.date, a.amount
           FROM (SELECT c.id, 'credit_note'::text AS kind, c.invoice_id,
                        c.credit_note_number AS number, c.credit_date::text AS date,
                        c.total AS amount, c.decided_at
                   FROM hsdg.credit_notes c
                  WHERE c.client_entity_id = $1 AND c.status = 'approved'
                 UNION ALL
                 SELECT w.id, 'write_off', w.invoice_id, NULL,
                        timezone('Asia/Kolkata', w.decided_at)::date::text, w.amount, w.decided_at
                   FROM hsdg.write_offs w
                  WHERE w.client_entity_id = $1 AND w.status = 'approved') a
           JOIN hsdg.invoices i ON i.id = a.invoice_id
          ORDER BY a.date, a.decided_at`,
        [entityId],
      );

      type Entry = Omit<StatementLine, 'balance'> & { order: number };
      const entries: Entry[] = [];
      for (const inv of invoices.rows) {
        entries.push({
          date: inv.issue_date ?? '',
          kind: 'invoice',
          reference: inv.invoice_number,
          debit: inv.total,
          credit: '0.00',
          invoiceId: inv.id,
          receiptId: null,
          order: 0,
        });
        // Marked paid by hand before receipts existed: settle it on the statement.
        if (inv.status === 'paid' && toPaise(inv.amount_settled) === 0n) {
          entries.push({
            date: inv.issue_date ?? '',
            kind: 'marked_paid',
            reference: inv.invoice_number,
            debit: '0.00',
            credit: inv.total,
            invoiceId: inv.id,
            receiptId: null,
            order: 1,
          });
        }
      }
      for (const r of posted) {
        entries.push({
          date: r.receivedOn,
          kind: 'receipt',
          reference: r.reference,
          debit: '0.00',
          credit: r.netAmount,
          invoiceId: null,
          receiptId: r.id,
          order: 2,
        });
        if (toPaise(r.tdsAmount) > 0n) {
          entries.push({
            date: r.receivedOn,
            kind: 'tds',
            reference: r.tdsSection ? `TDS u/s ${r.tdsSection}` : 'TDS',
            debit: '0.00',
            credit: r.tdsAmount,
            invoiceId: null,
            receiptId: r.id,
            order: 3,
          });
        }
      }
      for (const c of credits.rows) {
        entries.push({
          date: c.date,
          kind: c.kind,
          // A write-off has no number of its own: the invoice it came off.
          reference:
            c.kind === 'credit_note'
              ? `${c.number} on ${c.invoice_number ?? 'invoice'}`
              : (c.invoice_number ?? 'invoice'),
          debit: '0.00',
          credit: c.amount,
          invoiceId: c.invoice_id,
          receiptId: null,
          order: 4,
        });
      }
      entries.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
      let running = 0n;
      const lines: StatementLine[] = entries.map(({ order: _order, ...e }) => {
        running += toPaise(e.debit) - toPaise(e.credit);
        return { ...e, balance: fromPaise(running) };
      });

      const markedPaid = entries.filter((e) => e.kind === 'marked_paid').map((e) => e.credit);
      const tdsByQuarter = new Map<string, bigint>();
      for (const r of posted) {
        if (toPaise(r.tdsAmount) === 0n) continue;
        const q = tdsQuarterOf(r.receivedOn);
        const key = `${q.financialYear}|${q.quarter}`;
        tdsByQuarter.set(key, (tdsByQuarter.get(key) ?? 0n) + toPaise(r.tdsAmount));
      }
      return {
        entityId,
        entityName,
        invoices: invoices.rows.map(toOpenInvoice),
        receipts,
        credits: credits.rows.map((c) => ({
          id: c.id,
          kind: c.kind,
          invoiceId: c.invoice_id,
          number: c.number,
          date: c.date,
          amount: c.amount,
        })),
        lines,
        totals: {
          invoiced: sumAmounts(invoices.rows.map((i) => i.total)),
          received: sumAmounts([...posted.map((r) => r.netAmount), ...markedPaid]),
          tds: sumAmounts(posted.map((r) => r.tdsAmount)),
          credited: sumAmounts(credits.rows.map((c) => c.amount)),
          balance: fromPaise(running),
          advance: sumAmounts(posted.map((r) => r.unallocated)),
        },
        tdsReceivable: [...tdsByQuarter]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, amount]) => {
            const [financialYear, quarter] = key.split('|') as [string, 'Q1' | 'Q2' | 'Q3' | 'Q4'];
            return { financialYear, quarter, amount: fromPaise(amount) };
          }),
      };
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /** The client's name, or 404 when the caller cannot see it. */
  private async assertClient(client: PoolClient, entityId: string): Promise<string> {
    const { rows } = await client.query<{ legal_name: string }>(
      `SELECT legal_name FROM hsdg.entity_billing_profiles WHERE id = $1`,
      [entityId],
    );
    if (!rows[0]) throw new NotFoundException('Client not found.');
    return rows[0].legal_name;
  }

  private async openInvoices(client: PoolClient, entityId: string): Promise<OpenInvoice[]> {
    const { rows } = await client.query<InvoiceRow>(
      `SELECT i.id, i.invoice_number, i.engagement_id, i.issue_date::text, i.due_date::text,
              i.status, i.total, i.amount_settled
         FROM hsdg.invoices i
        WHERE i.client_entity_id = $1 AND i.status IN ('issued', 'partially_paid')`,
      [entityId],
    );
    return rows.map(toOpenInvoice);
  }

  private async load(client: PoolClient, id: string): Promise<ReceiptRecord> {
    const { rows } = await client.query<ReceiptRow>(`${RECEIPT_BASE} WHERE r.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Receipt not found.');
    return (await this.withAllocations(client, rows))[0]!;
  }

  private async withAllocations(client: PoolClient, rows: ReceiptRow[]): Promise<ReceiptRecord[]> {
    if (!rows.length) return [];
    const { rows: allocs } = await client.query<AllocationRow>(
      `SELECT a.receipt_id, a.invoice_id, i.invoice_number, a.amount
         FROM hsdg.receipt_allocations a
         LEFT JOIN hsdg.invoices i ON i.id = a.invoice_id
        WHERE a.receipt_id = ANY($1::uuid[])
        ORDER BY i.issue_date, i.invoice_number`,
      [rows.map((r) => r.id)],
    );
    const by = new Map<string, AllocationRow[]>();
    for (const a of allocs) by.set(a.receipt_id, [...(by.get(a.receipt_id) ?? []), a]);
    return rows.map((r) => {
      const mine = by.get(r.id) ?? [];
      return {
        id: r.id,
        clientEntityId: r.client_entity_id,
        clientName: r.client_name,
        receivedOn: r.received_on,
        mode: r.mode,
        reference: r.reference,
        grossAmount: r.gross_amount,
        tdsAmount: r.tds_amount,
        tdsSection: r.tds_section,
        netAmount: r.net_amount,
        bankAccount: r.bank_account,
        status: r.status,
        reversedReason: r.reversed_reason,
        reversedAt: r.reversed_at?.toISOString() ?? null,
        recordedByName: r.recorded_by_name,
        allocations: mine.map((a) => ({
          invoiceId: a.invoice_id,
          invoiceNumber: a.invoice_number,
          amount: a.amount,
        })),
        unallocated: fromPaise(
          toPaise(r.gross_amount) - toPaise(sumAmounts(mine.map((a) => a.amount))),
        ),
        tdsQuarter: tdsQuarterOf(r.received_on),
        version: r.version,
        createdAt: r.created_at.toISOString(),
      };
    });
  }
}

function toOpenInvoice(i: InvoiceRow): OpenInvoice {
  return {
    id: i.id,
    invoiceNumber: i.invoice_number,
    engagementId: i.engagement_id,
    issueDate: i.issue_date,
    dueDate: i.due_date,
    total: i.total,
    balance: fromPaise(toPaise(i.total) - toPaise(i.amount_settled)),
  };
}

/** The receipt guards speak 22023; the rest maps as for invoices. */
function translateReceiptError(err: unknown): Error {
  const e = err as { code?: string };
  if (e.code === '42501') {
    return new ForbiddenException(
      "Only the client's home-office partners and managers (or the managing partner) record its receipts.",
    );
  }
  return translateInvoiceError(err);
}

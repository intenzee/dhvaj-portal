import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  formatInr,
  type DecideAdjustmentInput,
  type RequestReversalInput,
  type ReversalKind,
  type ReversalRequest,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReceiptsService } from './receipts.service';

interface ReversalRow {
  id: string;
  kind: ReversalKind;
  invoice_id: string | null;
  invoice_number: string | null;
  receipt_id: string | null;
  receipt_reference: string | null;
  client_entity_id: string;
  client_name: string;
  engagement_id: string | null;
  amount: string;
  reason: string;
  status: ReversalRequest['status'];
  requested_by_employee_id: string | null;
  requested_by_name: string | null;
  created_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  version: number;
}

const BASE = `
  SELECT q.id, q.kind, q.invoice_id, i.invoice_number, q.receipt_id,
         r.reference AS receipt_reference, q.client_entity_id, e.legal_name AS client_name,
         q.engagement_id, q.amount, q.reason, q.status, q.requested_by_employee_id,
         rb.full_name AS requested_by_name, q.created_at, db.full_name AS decided_by_name,
         q.decided_at, q.decision_note, q.version
    FROM hsdg.billing_reversal_requests q
    JOIN hsdg.entity_billing_profiles e ON e.id = q.client_entity_id
    LEFT JOIN hsdg.invoices i ON i.id = q.invoice_id
    LEFT JOIN hsdg.receipts r ON r.id = q.receipt_id
    LEFT JOIN hsdg.employee_names rb ON rb.id = q.requested_by_employee_id
    LEFT JOIN hsdg.employee_names db ON db.id = q.decided_by_employee_id`;

const NOUN: Record<ReversalKind, string> = {
  invoice_void: 'Void of invoice',
  receipt_reversal: 'Reversal of receipt',
};

/**
 * Spec §3.5 · maker–checker for undoing money already on the books. Voiding an
 * issued invoice and reversing a receipt need billing.approve; the Accountant
 * (billing.manage) asks here instead, and a partner other than the one who
 * asked approves — the void or reversal then happens in the same transaction,
 * in the partner's name — or rejects. RLS: the client's billers. The database
 * refuses a decision by the requester and any change to what was asked.
 */
@Injectable()
export class ReversalRequestsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly receipts: ReceiptsService,
  ) {}

  list(
    ctx: RlsContext,
    filter: { status?: ReversalRequest['status']; invoiceId?: string; receiptId?: string } = {},
  ): Promise<ReversalRequest[]> {
    return this.db.withRlsContext(ctx, (client) => this.listWith(client, filter));
  }

  async listWith(
    client: PoolClient,
    filter: { status?: ReversalRequest['status']; invoiceId?: string; receiptId?: string },
  ): Promise<ReversalRequest[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`q.status = $${params.length}`);
    }
    if (filter.invoiceId) {
      params.push(filter.invoiceId);
      where.push(`q.invoice_id = $${params.length}`);
    }
    if (filter.receiptId) {
      params.push(filter.receiptId);
      where.push(`q.receipt_id = $${params.length}`);
    }
    const { rows } = await client.query<ReversalRow>(
      `${BASE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY q.created_at DESC LIMIT 500`,
      params,
    );
    return rows.map(toRequest);
  }

  /** Ask for a void or a reversal; the client's partners (not the asker) are told. */
  request(ctx: RlsContext, input: RequestReversalInput): Promise<ReversalRequest> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertTargetOpen(client, input.kind, input.invoiceId ?? input.receiptId ?? '');
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.billing_reversal_requests
             (kind, invoice_id, receipt_id, reason, requested_by_employee_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            input.kind,
            input.kind === 'invoice_void' ? input.invoiceId : null,
            input.kind === 'receipt_reversal' ? input.receiptId : null,
            input.reason.trim(),
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateReversalError(err);
      }
      const q = await this.load(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'billing.reversal_requested',
        objectType: 'billing_reversal_request',
        objectId: id,
        after: {
          kind: q.kind,
          ...(q.invoiceId ? { invoice: q.invoiceId } : {}),
          ...(q.receiptId ? { receipt: q.receiptId } : {}),
          amount: q.amount,
        },
        reason: q.reason,
      });
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.billing_approvers($1) AS t(id) WHERE id IS DISTINCT FROM $2`,
        [q.clientId, ctx.employeeId ?? null],
      );
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.writeOffPending,
        recipientEmployeeIds: rows.map((r) => r.id),
        title: `${NOUN[q.kind]} ${targetLabel(q)} to approve · ${formatInr(q.amount)}`,
        body: `${q.clientName}: ${q.reason}`,
        engagementId: q.engagementId,
        objectType: 'billing_reversal_request',
        objectId: id,
      });
      return q;
    });
  }

  /**
   * A partner who did not ask approves or rejects. Approval voids the invoice
   * or reverses the receipt now, in the decider's name, with the asked reason.
   */
  decide(ctx: RlsContext, id: string, input: DecideAdjustmentInput): Promise<ReversalRequest> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.load(client, id, true);
      if (before.status !== 'pending') {
        throw new BadRequestException(`This request is already ${before.status}.`);
      }
      if (input.version !== undefined && input.version !== before.version) {
        throw new ConflictException(
          `Request was changed by someone else (expected v${input.version}, found v${before.version}).`,
        );
      }
      if (ctx.employeeId && before.requestedById === ctx.employeeId) {
        throw new ForbiddenException('You asked for this; another partner must decide it.');
      }
      const approve = input.decision === 'approve';
      if (approve) {
        if (before.kind === 'invoice_void') await this.voidInvoice(client, ctx, before);
        else {
          await this.assertTargetOpen(client, 'receipt_reversal', before.receiptId!);
          await this.receipts.reverseWith(client, ctx, before.receiptId!, {
            reason: before.reason,
          });
        }
      }
      try {
        await client.query(
          `UPDATE hsdg.billing_reversal_requests
              SET status = $2, decided_by_employee_id = $3, decided_at = now(),
                  decision_note = $4, version = version + 1
            WHERE id = $1`,
          [
            id,
            approve ? 'approved' : 'rejected',
            ctx.employeeId ?? null,
            input.note?.trim() || null,
          ],
        );
      } catch (err) {
        throw translateReversalError(err);
      }
      const after = await this.load(client, id);
      await this.audit.recordWith(client, ctx, {
        action: `billing.reversal_${approve ? 'approved' : 'rejected'}`,
        objectType: 'billing_reversal_request',
        objectId: id,
        before: { status: before.status },
        after: {
          status: after.status,
          kind: after.kind,
          ...(after.invoiceId ? { invoice: after.invoiceId } : {}),
          ...(after.receiptId ? { receipt: after.receiptId } : {}),
          amount: after.amount,
        },
        ...(input.note?.trim() ? { reason: input.note.trim() } : {}),
      });
      return after;
    });
  }

  /** The asker takes it back while it is still pending. */
  withdraw(ctx: RlsContext, id: string): Promise<ReversalRequest> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.load(client, id, true);
      if (before.status !== 'pending') {
        throw new BadRequestException(`This request is already ${before.status}.`);
      }
      if (!ctx.employeeId || before.requestedById !== ctx.employeeId) {
        throw new ForbiddenException('Only the person who asked can withdraw this request.');
      }
      await client.query(
        `UPDATE hsdg.billing_reversal_requests
            SET status = 'withdrawn', decided_at = now(), version = version + 1
          WHERE id = $1`,
        [id],
      );
      const after = await this.load(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'billing.reversal_withdrawn',
        objectType: 'billing_reversal_request',
        objectId: id,
        before: { status: before.status },
        after: { status: after.status },
      });
      return after;
    });
  }

  /** The approved void, as the partner's own void of an issued invoice. */
  private async voidInvoice(
    client: PoolClient,
    ctx: RlsContext,
    q: ReversalRequest,
  ): Promise<void> {
    const status = await this.assertTargetOpen(client, 'invoice_void', q.invoiceId!);
    await client.query(
      `UPDATE hsdg.invoices
          SET status = 'void', voided_reason = $2,
              voided_by_employee_id = $3, voided_at = now(), version = version + 1
        WHERE id = $1`,
      [q.invoiceId, q.reason, ctx.employeeId ?? null],
    );
    await client.query(
      `UPDATE hsdg.invoice_issue_requests SET closed_at = now(), closed_reason = 'void'
        WHERE invoice_id = $1 AND closed_at IS NULL`,
      [q.invoiceId],
    );
    await this.audit.recordWith(client, ctx, {
      action: 'invoice.void',
      objectType: 'invoice',
      objectId: q.invoiceId!,
      before: { status },
      after: {
        status: 'void',
        ...(q.invoiceNumber ? { invoiceNumber: q.invoiceNumber } : {}),
        reason: q.reason,
        request: q.id,
      },
    });
  }

  /**
   * Only an issued, unpaid invoice can be voided (one with money against it is
   * reversed receipt by receipt first), and only a posted receipt reversed.
   * Locks the row so the decision and a receipt cannot cross.
   */
  private async assertTargetOpen(
    client: PoolClient,
    kind: ReversalKind,
    targetId: string,
  ): Promise<string> {
    if (kind === 'invoice_void') {
      const { rows } = await client.query<{ status: string }>(
        `SELECT status FROM hsdg.invoices WHERE id = $1 FOR UPDATE`,
        [targetId],
      );
      if (!rows[0]) throw new NotFoundException('Invoice not found.');
      if (rows[0].status !== 'issued') {
        throw new BadRequestException(
          rows[0].status === 'draft'
            ? 'A draft is discarded, not voided: no partner is needed.'
            : `Only an issued, unpaid invoice can be voided; this one is ${rows[0].status.replace('_', ' ')}. Reverse its receipts first.`,
        );
      }
      return rows[0].status;
    }
    const { rows } = await client.query<{ status: string }>(
      `SELECT status FROM hsdg.receipts WHERE id = $1 FOR UPDATE`,
      [targetId],
    );
    if (!rows[0]) throw new NotFoundException('Receipt not found.');
    if (rows[0].status !== 'posted') {
      throw new BadRequestException('This receipt is already reversed.');
    }
    return rows[0].status;
  }

  private async load(client: PoolClient, id: string, lock = false): Promise<ReversalRequest> {
    if (lock) {
      await client.query(`SELECT 1 FROM hsdg.billing_reversal_requests WHERE id = $1 FOR UPDATE`, [
        id,
      ]);
    }
    const { rows } = await client.query<ReversalRow>(`${BASE} WHERE q.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Request not found.');
    return toRequest(rows[0]);
  }
}

function targetLabel(q: ReversalRequest): string {
  if (q.kind === 'invoice_void') return q.invoiceNumber ?? 'invoice';
  return q.receiptReference ? `(${q.receiptReference})` : '';
}

function toRequest(r: ReversalRow): ReversalRequest {
  return {
    id: r.id,
    kind: r.kind,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    receiptId: r.receipt_id,
    receiptReference: r.receipt_reference,
    clientId: r.client_entity_id,
    clientName: r.client_name,
    engagementId: r.engagement_id,
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

function translateReversalError(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code === '23505') {
    return new ConflictException(
      'A request is already open for this; decide or withdraw it first.',
    );
  }
  if (e.code === 'P0002') return new NotFoundException(e.message ?? 'Not found.');
  if (e.code === '23514' && e.constraint === 'billing_reversal_requests_checker') {
    return new ForbiddenException('You asked for this; another partner must decide it.');
  }
  if (e.code === '23514' || e.code === '42501') {
    return new BadRequestException(e.message ?? 'The request was refused.');
  }
  return err;
}

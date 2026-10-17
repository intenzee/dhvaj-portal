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
  NOTIFICATION_TYPE,
  amountInWords,
  creditNoteLines,
  creditNoteVoidBlock,
  formatInr,
  fromPaise,
  toPaise,
  type AdjustmentKind,
  type AdjustmentStatus,
  type CreditNoteLine,
  type CreditableLine,
  type DecideAdjustmentInput,
  type InvoiceAdjustment,
  type RequestCreditNoteInput,
  type RequestWriteOffInput,
  type VoidCreditNoteInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { translateInvoiceError } from '../commercial/commercial.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../documents/storage/storage-provider';
import { NotificationsService } from '../notifications/notifications.service';
import { renderCreditNotePdf, type CreditNotePdfData } from './credit-note-pdf';

interface AdjustmentRow {
  id: string;
  kind: AdjustmentKind;
  invoice_id: string;
  invoice_number: string | null;
  engagement_id: string;
  client_entity_id: string;
  client_name: string;
  number: string | null;
  credit_date: string | null;
  reason: string;
  taxable_value: string;
  gst_rate: string | null;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  status: AdjustmentStatus;
  requested_by_employee_id: string | null;
  requested_by_name: string | null;
  created_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  version: number;
  void_reason: string | null;
  voided_at: Date | null;
  voided_by_name: string | null;
  lines: CreditNoteLine[];
}

/** Both kinds as one row shape; a write-off is its own taxable value and total. */
const ADJUSTMENTS = `
  SELECT * FROM (
    SELECT c.id, 'credit_note'::text AS kind, c.invoice_id, c.client_entity_id,
           c.credit_note_number AS number, c.credit_date::text, c.reason, c.taxable_value,
           c.gst_rate, c.cgst, c.sgst, c.igst, c.total, c.status, c.requested_by_employee_id,
           c.decided_by_employee_id, c.created_at, c.decided_at, c.decision_note, c.version,
           c.void_reason, c.voided_at, c.voided_by_employee_id
      FROM hsdg.credit_notes c
    UNION ALL
    SELECT w.id, 'write_off', w.invoice_id, w.client_entity_id, NULL, NULL, w.reason, w.amount,
           0, 0, 0, 0, w.amount, w.status, w.requested_by_employee_id, w.decided_by_employee_id,
           w.created_at, w.decided_at, w.decision_note, w.version, NULL, NULL, NULL
      FROM hsdg.write_offs w
  ) a`;

const ADJUSTMENT_BASE = `
  SELECT a.id, a.kind, a.invoice_id, i.invoice_number, i.engagement_id, a.client_entity_id,
         e.legal_name AS client_name, a.number, a.credit_date, a.reason, a.taxable_value,
         a.gst_rate, a.cgst, a.sgst, a.igst, a.total, a.status, a.requested_by_employee_id,
         rb.full_name AS requested_by_name, a.created_at, db.full_name AS decided_by_name,
         a.decided_at, a.decision_note, a.version, a.void_reason, a.voided_at,
         vb.full_name AS voided_by_name,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'invoiceLineId', cl.invoice_line_id, 'description', cl.description,
                    'taxableValue', cl.taxable_value::text, 'gstRate', cl.gst_rate::text,
                    'cgst', cl.cgst::text, 'sgst', cl.sgst::text, 'igst', cl.igst::text,
                    'total', cl.total::text) ORDER BY li.sort_order, cl.created_at)
             FROM hsdg.credit_note_lines cl
             JOIN hsdg.invoice_line_items li ON li.id = cl.invoice_line_id
            WHERE a.kind = 'credit_note' AND cl.credit_note_id = a.id), '[]'::json) AS lines
    FROM (${ADJUSTMENTS}) a
    JOIN hsdg.invoices i ON i.id = a.invoice_id
    JOIN hsdg.entities e ON e.id = a.client_entity_id
    LEFT JOIN hsdg.employees rb ON rb.id = a.requested_by_employee_id
    LEFT JOIN hsdg.employees db ON db.id = a.decided_by_employee_id
    LEFT JOIN hsdg.employees vb ON vb.id = a.voided_by_employee_id`;

const TABLE: Record<AdjustmentKind, string> = {
  credit_note: 'hsdg.credit_notes',
  write_off: 'hsdg.write_offs',
};

const NOUN: Record<AdjustmentKind, string> = {
  credit_note: 'Credit note',
  write_off: 'Write-off',
};

interface InvoiceFacts {
  id: string;
  invoice_number: string | null;
  engagement_id: string;
  client_entity_id: string;
  status: string;
  total: string;
  amount_settled: string;
  place_of_supply_state: string | null;
  is_reverse_charge: boolean;
  tax_charged: boolean;
}

/**
 * PS-205 · reducing a bill: a credit note (on named invoice lines, each with its
 * own GST rate) or a
 * write-off. Anyone who bills the client (billing.manage) asks; a partner
 * (billing.approve) who did not ask decides. Triggers number an approved
 * credit note, refuse a requester's own decision, and settle the invoice so
 * only approved reductions move its balance. RLS: the client's billers.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /** Pending requests (the approvers' queue), or one invoice's history. */
  list(
    ctx: RlsContext,
    filter: { invoiceId?: string; status?: AdjustmentStatus },
  ): Promise<InvoiceAdjustment[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (filter.invoiceId) {
        params.push(filter.invoiceId);
        conds.push(`a.invoice_id = $${params.length}`);
      }
      if (filter.status) {
        params.push(filter.status);
        conds.push(`a.status = $${params.length}`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await client.query<AdjustmentRow>(
        `${ADJUSTMENT_BASE} ${where} ORDER BY a.created_at DESC LIMIT 200`,
        params,
      );
      return rows.map(toAdjustment);
    });
  }

  requestCreditNote(
    ctx: RlsContext,
    invoiceId: string,
    input: RequestCreditNoteInput,
  ): Promise<InvoiceAdjustment> {
    return this.db.withRlsContext(ctx, async (client) => {
      const inv = await this.openInvoice(client, invoiceId);
      const { rows: lines } = await client.query<CreditableLine>(
        `SELECT l.id, l.description, l.taxable_value::text AS "taxableValue",
                l.gst_rate::text AS "gstRate",
                COALESCE((SELECT sum(cl.taxable_value) FROM hsdg.credit_note_lines cl
                            JOIN hsdg.credit_notes cn ON cn.id = cl.credit_note_id
                           WHERE cl.invoice_line_id = l.id
                             AND cn.status IN ('pending', 'approved')), 0)::text AS credited
           FROM hsdg.invoice_line_items l
          WHERE l.invoice_id = $1
          ORDER BY l.sort_order, l.created_at`,
        [inv.id],
      );
      const note = creditNoteLines(input.lines, lines, {
        firmState: await firmStateCode(client),
        placeOfSupply: inv.place_of_supply_state,
        charged: inv.tax_charged && !inv.is_reverse_charge,
      });
      if (!note.ok) throw new BadRequestException(note.error);
      assertWithinBalance(inv, note.total);
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.credit_notes
             (invoice_id, client_entity_id, reason, taxable_value, gst_rate, cgst, sgst, igst,
              requested_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            inv.id,
            inv.client_entity_id,
            input.reason.trim(),
            note.taxableValue,
            note.gstRate,
            note.cgst,
            note.sgst,
            note.igst,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
        for (const l of note.lines) {
          await client.query(
            `INSERT INTO hsdg.credit_note_lines
               (credit_note_id, invoice_line_id, description, taxable_value, gst_rate,
                cgst, sgst, igst)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, l.invoiceLineId, l.description, l.taxableValue, l.gstRate, l.cgst, l.sgst, l.igst],
          );
        }
      } catch (err) {
        throw translateAdjustmentError(err);
      }
      return this.afterRequest(client, ctx, 'credit_note', id);
    });
  }

  requestWriteOff(
    ctx: RlsContext,
    invoiceId: string,
    input: RequestWriteOffInput,
  ): Promise<InvoiceAdjustment> {
    return this.db.withRlsContext(ctx, async (client) => {
      const inv = await this.openInvoice(client, invoiceId);
      const amount = fromPaise(toPaise(input.amount));
      assertWithinBalance(inv, amount);
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.write_offs
             (invoice_id, client_entity_id, amount, reason, requested_by_employee_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [inv.id, inv.client_entity_id, amount, input.reason.trim(), ctx.employeeId ?? null],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translateAdjustmentError(err);
      }
      return this.afterRequest(client, ctx, 'write_off', id);
    });
  }

  /** Approve or reject someone else's request; approval reduces the balance. */
  decide(
    ctx: RlsContext,
    kind: AdjustmentKind,
    id: string,
    input: DecideAdjustmentInput,
  ): Promise<InvoiceAdjustment> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.load(client, id, kind, true);
      if (before.status !== 'pending') {
        throw new BadRequestException(
          `This ${NOUN[kind].toLowerCase()} is already ${before.status}.`,
        );
      }
      if (input.version !== undefined && input.version !== before.version) {
        throw new ConflictException(
          `${NOUN[kind]} was changed by someone else (expected v${input.version}, found v${before.version}).`,
        );
      }
      if (ctx.employeeId && before.requestedById === ctx.employeeId) {
        throw new ForbiddenException('You asked for this; another partner must decide it.');
      }
      const approve = input.decision === 'approve';
      if (approve) {
        // The balance may have moved since the request (a receipt came in).
        const inv = await this.invoiceFacts(client, before.invoiceId);
        if (!inv || !['issued', 'partially_paid'].includes(inv.status)) {
          throw new BadRequestException('The invoice is no longer open; reject this request.');
        }
        assertWithinBalance(inv, before.total);
      }
      try {
        await client.query(
          `UPDATE ${TABLE[kind]}
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
        throw translateAdjustmentError(err);
      }
      // An approved credit note is a tax document: keep its PDF as issued.
      if (approve && kind === 'credit_note') await this.storePdf(client, id);
      const after = await this.load(client, id, kind);
      await this.audit.recordWith(client, ctx, {
        action: `${kind}.${approve ? 'approved' : 'rejected'}`,
        objectType: kind,
        objectId: id,
        before: { status: before.status },
        after: {
          status: after.status,
          invoice: after.invoiceId,
          total: after.total,
          ...(after.number ? { number: after.number } : {}),
        },
        ...(input.note?.trim() ? { reason: input.note.trim() } : {}),
      });
      return after;
    });
  }

  /**
   * Void an approved credit note: a partner other than its requester, with a
   * reason, while the GST return for its date is not yet filed. The number
   * stays used (never reissued) and the invoice's balance comes back through
   * settle_invoice; the database holds the same rules.
   */
  voidCreditNote(
    ctx: RlsContext,
    id: string,
    input: VoidCreditNoteInput,
  ): Promise<InvoiceAdjustment> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.load(client, id, 'credit_note', true);
      if (before.status !== 'approved') {
        throw new BadRequestException(
          `Only an approved credit note can be voided; this one is ${before.status}.`,
        );
      }
      if (input.version !== undefined && input.version !== before.version) {
        throw new ConflictException(
          `Credit note was changed by someone else (expected v${input.version}, found v${before.version}).`,
        );
      }
      if (ctx.employeeId && before.requestedById === ctx.employeeId) {
        throw new ForbiddenException(
          'You asked for this credit note; another partner must void it.',
        );
      }
      const inv = await this.invoiceFacts(client, before.invoiceId);
      if (inv?.status === 'void') {
        throw new BadRequestException('The invoice is void; its credit notes stay as they are.');
      }
      const filed = await gstFiledThrough(client);
      const blocked = creditNoteVoidBlock(before, filed);
      if (blocked) throw new BadRequestException(blocked);
      const reason = input.reason.trim();
      try {
        await client.query(
          `UPDATE hsdg.credit_notes
              SET status = 'void', void_reason = $2, voided_by_employee_id = $3,
                  version = version + 1
            WHERE id = $1`,
          [id, reason, ctx.employeeId ?? null],
        );
      } catch (err) {
        throw translateVoidError(err);
      }
      const after = await this.load(client, id, 'credit_note');
      await this.audit.recordWith(client, ctx, {
        action: 'credit_note.voided',
        objectType: 'credit_note',
        objectId: id,
        before: { status: before.status },
        after: {
          status: after.status,
          number: after.number,
          invoice: after.invoiceId,
          total: after.total,
          creditDate: after.creditDate,
          // The GST position the void was made in, for whoever reviews it.
          gstFiledThrough: filed ?? 'not recorded',
        },
        reason,
      });
      return after;
    });
  }

  /** The credit note's PDF: as kept at approval, or (void, or older notes) drawn now. */
  creditNotePdf(ctx: RlsContext, id: string): Promise<{ filename: string; data: Buffer }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const note = await this.load(client, id, 'credit_note');
      if ((note.status !== 'approved' && note.status !== 'void') || !note.number) {
        throw new NotFoundException('Only an approved credit note has a PDF.');
      }
      const filename = `${note.number.replace(/\//g, '-')}.pdf`;
      const { rows } = await client.query<{ ref: string | null }>(
        `SELECT pdf_storage_reference AS ref FROM hsdg.credit_notes WHERE id = $1`,
        [id],
      );
      if (note.status === 'approved' && rows[0]?.ref) {
        return { filename, data: await this.storage.read(rows[0].ref) };
      }
      return { filename, data: renderCreditNotePdf(await this.pdfData(client, note)) };
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async storePdf(client: PoolClient, id: string): Promise<void> {
    const note = await this.load(client, id, 'credit_note');
    const pdf = renderCreditNotePdf(await this.pdfData(client, note));
    const reference = this.storage.newReference(note.engagementId, id);
    await this.storage.write(reference, pdf, 'application/pdf');
    await client.query(`UPDATE hsdg.credit_notes SET pdf_storage_reference = $2 WHERE id = $1`, [
      id,
      reference,
    ]);
  }

  /** What rule 53 asks the credit note to show, from the note, its invoice and the firm. */
  private async pdfData(client: PoolClient, note: InvoiceAdjustment): Promise<CreditNotePdfData> {
    const { rows: firmRows } = await client.query<{
      firm_name: string;
      address: string | null;
      gstin: string | null;
      state_code: string | null;
      sac_default: string;
    }>(`SELECT firm_name, address, gstin, state_code, sac_default FROM hsdg.firm_settings LIMIT 1`);
    const firm = firmRows[0];
    const { rows: invRows } = await client.query<{
      invoice_number: string | null;
      issue_date: string | null;
      client_gstin: string | null;
      place_of_supply_state: string | null;
      is_reverse_charge: boolean;
      legal_name: string;
      pan: string | null;
    }>(
      `SELECT i.invoice_number, i.issue_date::text, i.client_gstin, i.place_of_supply_state,
              i.is_reverse_charge, e.legal_name, e.pan
         FROM hsdg.invoices i JOIN hsdg.entities e ON e.id = i.client_entity_id
        WHERE i.id = $1`,
      [note.invoiceId],
    );
    const inv = invRows[0];
    if (!inv) throw new NotFoundException('Invoice not found.');
    // Registered, then business, then any address; primary first.
    const { rows: addrRows } = await client.query<{ address: string }>(
      `SELECT concat_ws(', ', a.line1, NULLIF(a.line2, ''), NULLIF(a.city, ''),
                        NULLIF(concat_ws(' ', NULLIF(a.state, ''), a.pincode), '')) AS address
         FROM hsdg.entity_addresses a
        WHERE a.entity_id = $1
        ORDER BY (a.address_type = 'registered') DESC, (a.address_type = 'business') DESC,
                 a.is_primary DESC, a.created_at
        LIMIT 1`,
      [note.clientEntityId],
    );
    const { rows: sacRows } = await client.query<{ id: string; sac_code: string | null }>(
      `SELECT id, sac_code FROM hsdg.invoice_line_items WHERE invoice_id = $1`,
      [note.invoiceId],
    );
    const sac = new Map(sacRows.map((r) => [r.id, r.sac_code]));
    const firmState = firm?.state_code ?? null;
    const pos = inv.place_of_supply_state;
    const intraState =
      toPaise(note.igst) > 0n
        ? false
        : toPaise(note.cgst) > 0n || !pos || !firmState || pos === firmState;
    return {
      firm: {
        name: firm?.firm_name ?? '',
        address: firm?.address ?? null,
        gstin: firm?.gstin ?? null,
        stateCode: firmState,
      },
      client: {
        name: inv.legal_name,
        gstin: inv.client_gstin,
        pan: inv.pan,
        address: addrRows[0]?.address ?? null,
        stateCode: inv.client_gstin?.slice(0, 2) ?? pos,
      },
      creditNoteNumber: note.number!,
      creditDate: note.creditDate!,
      invoiceNumber: inv.invoice_number ?? '',
      invoiceDate: inv.issue_date,
      placeOfSupplyState: pos,
      isReverseCharge: inv.is_reverse_charge,
      reason: note.reason,
      intraState,
      lines: note.lines.map((l) => ({
        description: l.description,
        sacCode: sac.get(l.invoiceLineId) ?? firm?.sac_default ?? null,
        taxableValue: l.taxableValue,
        gstRate: l.gstRate,
        cgst: l.cgst,
        sgst: l.sgst,
        igst: l.igst,
        total: l.total,
      })),
      taxableValue: note.taxableValue,
      cgst: note.cgst,
      sgst: note.sgst,
      igst: note.igst,
      total: note.total,
      amountInWords: amountInWords(note.total),
      voided:
        note.status === 'void' && note.voidedAt
          ? {
              on: new Date(note.voidedAt).toLocaleDateString('en-CA', {
                timeZone: 'Asia/Kolkata',
              }),
              reason: note.voidReason ?? '',
            }
          : null,
    };
  }

  /** Audit the request and ask the client's partners (not the requester) to decide. */
  private async afterRequest(
    client: PoolClient,
    ctx: RlsContext,
    kind: AdjustmentKind,
    id: string,
  ): Promise<InvoiceAdjustment> {
    const a = await this.load(client, id, kind);
    await this.audit.recordWith(client, ctx, {
      action: `${kind}.requested`,
      objectType: kind,
      objectId: id,
      after: { invoice: a.invoiceId, total: a.total, taxable: a.taxableValue },
      reason: a.reason,
    });
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.billing_approvers($1) AS t(id) WHERE id IS DISTINCT FROM $2`,
      [a.clientEntityId, ctx.employeeId ?? null],
    );
    await this.notifications.emitWith(client, ctx, {
      type: NOTIFICATION_TYPE.writeOffPending,
      recipientEmployeeIds: rows.map((r) => r.id),
      title: `${NOUN[kind]} of ${formatInr(a.total)} to approve · ${a.invoiceNumber ?? 'invoice'}`,
      body: `${a.clientName}: ${a.reason}`,
      engagementId: a.engagementId,
      objectType: kind,
      objectId: id,
    });
    return a;
  }

  private async load(
    client: PoolClient,
    id: string,
    kind: AdjustmentKind,
    lock = false,
  ): Promise<InvoiceAdjustment> {
    if (lock) {
      await client.query(`SELECT 1 FROM ${TABLE[kind]} WHERE id = $1 FOR UPDATE`, [id]);
    }
    const { rows } = await client.query<AdjustmentRow>(
      `${ADJUSTMENT_BASE} WHERE a.id = $1 AND a.kind = $2`,
      [id, kind],
    );
    if (!rows[0]) throw new NotFoundException(`${NOUN[kind]} not found.`);
    return toAdjustment(rows[0]);
  }

  private async invoiceFacts(client: PoolClient, invoiceId: string): Promise<InvoiceFacts | null> {
    const { rows } = await client.query<InvoiceFacts>(
      `SELECT i.id, i.invoice_number, i.engagement_id, i.client_entity_id, i.status, i.total,
              i.amount_settled, i.place_of_supply_state, i.is_reverse_charge,
              (i.cgst + i.sgst + i.igst) > 0 AS tax_charged
         FROM hsdg.invoices i
        WHERE i.id = $1`,
      [invoiceId],
    );
    return rows[0] ?? null;
  }

  /** An issued, unpaid invoice of a client the caller bills. */
  private async openInvoice(client: PoolClient, invoiceId: string): Promise<InvoiceFacts> {
    const inv = await this.invoiceFacts(client, invoiceId);
    if (!inv) throw new NotFoundException('Invoice not found.');
    if (!['issued', 'partially_paid'].includes(inv.status)) {
      throw new BadRequestException('Only an issued, unpaid invoice can be reduced.');
    }
    return inv;
  }
}

/** The request must fit what is still owed (receipts and approved reductions count). */
function assertWithinBalance(
  inv: Pick<InvoiceFacts, 'total' | 'amount_settled' | 'invoice_number'>,
  amount: string,
): void {
  const balance = toPaise(inv.total) - toPaise(inv.amount_settled);
  if (toPaise(amount) > balance) {
    throw new BadRequestException(
      `${formatInr(amount)} is more than the ${formatInr(fromPaise(balance))} still owed on ${inv.invoice_number ?? 'the invoice'}.`,
    );
  }
}

async function gstFiledThrough(client: PoolClient): Promise<string | null> {
  const { rows } = await client.query<{ through: string | null }>(
    `SELECT gst_filed_through::text AS through FROM hsdg.firm_settings LIMIT 1`,
  );
  return rows[0]?.through ?? null;
}

async function firmStateCode(client: PoolClient): Promise<string | null> {
  const { rows } = await client.query<{ state_code: string | null }>(
    `SELECT state_code FROM hsdg.firm_settings LIMIT 1`,
  );
  return rows[0]?.state_code ?? null;
}

function toAdjustment(r: AdjustmentRow): InvoiceAdjustment {
  return {
    id: r.id,
    kind: r.kind,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    engagementId: r.engagement_id,
    clientEntityId: r.client_entity_id,
    clientName: r.client_name,
    number: r.number,
    creditDate: r.credit_date,
    reason: r.reason,
    taxableValue: r.taxable_value,
    gstRate: r.gst_rate,
    cgst: r.cgst,
    sgst: r.sgst,
    igst: r.igst,
    total: r.total,
    status: r.status,
    requestedById: r.requested_by_employee_id,
    requestedByName: r.requested_by_name,
    requestedAt: r.created_at.toISOString(),
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at?.toISOString() ?? null,
    decisionNote: r.decision_note,
    version: r.version,
    voidReason: r.void_reason,
    voidedAt: r.voided_at?.toISOString() ?? null,
    voidedByName: r.voided_by_name,
    lines: r.lines,
  };
}

/** The decision guard's 42501 is a self-approval; the rest maps as for invoices. */
function translateAdjustmentError(err: unknown): Error {
  const e = err as { code?: string; message?: string };
  if (e.code === '42501') {
    return new ForbiddenException(
      e.message?.startsWith('Someone other')
        ? 'You asked for this; another partner must decide it.'
        : "Only the client's home-office partners and managers (or the managing partner) reduce its bills.",
    );
  }
  return translateInvoiceError(err);
}

/** The void guard's 42501 is the requester voiding their own note. */
function translateVoidError(err: unknown): Error {
  if ((err as { code?: string }).code === '42501') {
    return new ForbiddenException('You asked for this credit note; another partner must void it.');
  }
  return translateInvoiceError(err);
}

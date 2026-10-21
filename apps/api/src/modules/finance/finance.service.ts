import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import * as XLSX from 'xlsx';
import {
  type BankMatchResult,
  type BooksExportRecord,
  type BooksFormat,
  type BooksLedgers,
  type BooksMonth,
  type BooksSettings,
  type BooksVoucher,
  type GstOutwardRegister,
  type UpdateBooksSettingsInput,
  type VoucherSource,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { matchCredits, parseStatement, type OpenInvoice, type PostedReceipt } from './bank-match';
import {
  buildVouchers,
  journalCsv,
  tallyXml,
  voucherKey,
  type BooksCreditNoteRow,
  type BooksInvoiceRow,
  type BooksReceiptRow,
  type BooksWriteOffRow,
} from './books';
import {
  buildGstRegister,
  monthEnd,
  type RegisterCreditNote,
  type RegisterCreditNoteLine,
  type RegisterInvoice,
  type RegisterLine,
  type VoidedFromEarlier,
} from './gst-register';
import { gstr1Json, gstr1Workbook } from './gst-register-export';

/** A bank statement is a few thousand rows at most. */
export const BANK_STATEMENT_MAX_BYTES = 5 * 1024 * 1024;

/** The IST calendar day of a timestamp column, as 'YYYY-MM-DD'. */
const istDay = (col: string): string => `((${col}) AT TIME ZONE 'Asia/Kolkata')::date`;

const CLIENT_NAME = `coalesce(p.legal_name, 'Client')`;

export interface FinanceFile {
  buffer: Buffer;
  filename: string;
  type: string;
}

interface SettingsRow {
  sales_ledger: string;
  output_cgst_ledger: string;
  output_sgst_ledger: string;
  output_igst_ledger: string;
  tds_receivable_ledger: string;
  bank_ledger: string;
  cash_ledger: string;
  bad_debts_ledger: string;
  adjustment_ledger: string;
  version: number;
}

const LEDGER_COLUMNS: Record<keyof BooksLedgers, keyof SettingsRow> = {
  sales: 'sales_ledger',
  outputCgst: 'output_cgst_ledger',
  outputSgst: 'output_sgst_ledger',
  outputIgst: 'output_igst_ledger',
  tdsReceivable: 'tds_receivable_ledger',
  bank: 'bank_ledger',
  cash: 'cash_ledger',
  badDebts: 'bad_debts_ledger',
  adjustment: 'adjustment_ledger',
};

function settingsOf(r: SettingsRow): BooksSettings {
  const out = { version: r.version } as BooksSettings;
  for (const [key, col] of Object.entries(LEDGER_COLUMNS) as [
    keyof BooksLedgers,
    keyof SettingsRow,
  ][]) {
    out[key] = String(r[col]);
  }
  return out;
}

interface ExportRow {
  id: string;
  month: string;
  format: BooksFormat;
  voucher_count: number;
  exported_by_name: string | null;
  created_at: Date;
}

const exportOf = (r: ExportRow): BooksExportRecord => ({
  id: r.id,
  month: r.month,
  format: r.format,
  voucherCount: r.voucher_count,
  exportedByName: r.exported_by_name,
  at: r.created_at.toISOString(),
});

const EXPORT_SELECT = `
  SELECT b.id, to_char(b.month, 'YYYY-MM') AS month, b.format, b.voucher_count,
         n.full_name AS exported_by_name, b.created_at
    FROM hsdg.books_exports b
    LEFT JOIN hsdg.employee_names n ON n.id = b.exported_by_employee_id`;

const BOOKS_FILE: Record<
  BooksFormat,
  { ext: string; type: string; write: (v: BooksVoucher[]) => string }
> = {
  tally_xml: { ext: 'xml', type: 'application/xml', write: tallyXml },
  journal_csv: { ext: 'csv', type: 'text/csv', write: journalCsv },
};

/**
 * Accountant role, phase 2c (spec §3.7): Reports → Finance. Reads the firm's
 * billing under the caller's row-level security (finance and the managing
 * partner see every client) and hands the rows to the pure builders.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── GST outward register ──

  gstRegister(ctx: RlsContext, month: string): Promise<GstOutwardRegister> {
    return this.db.withRlsContext(ctx, (client) => this.loadRegister(client, month));
  }

  async gstRegisterFile(
    ctx: RlsContext,
    month: string,
    format: 'xlsx' | 'json',
  ): Promise<FinanceFile> {
    const register = await this.gstRegister(ctx, month);
    const base = `GSTR-1 ${month}`;
    if (format === 'json') {
      return {
        buffer: Buffer.from(JSON.stringify(gstr1Json(register), null, 2), 'utf8'),
        filename: `${base}.json`,
        type: 'application/json',
      };
    }
    return {
      buffer: gstr1Workbook(register),
      filename: `${base}.xlsx`,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private async loadRegister(client: PoolClient, month: string): Promise<GstOutwardRegister> {
    const start = `${month}-01`;
    const end = monthEnd(month);
    const firm = await client.query<{
      gstin: string | null;
      state_code: string | null;
      sac_default: string | null;
      gst_filed_through: string | null;
    }>(
      `SELECT gstin, state_code, sac_default, gst_filed_through::text AS gst_filed_through
         FROM hsdg.firm_settings LIMIT 1`,
    );
    const f = firm.rows[0];

    const inv = await client.query<{
      id: string;
      number: string;
      issue_date: string;
      status: string;
      voided_on: string | null;
      client_gstin: string | null;
      client_name: string;
      place_of_supply_state: string | null;
      is_reverse_charge: boolean;
      subtotal: string;
      cgst: string;
      sgst: string;
      igst: string;
      total: string;
    }>(
      `SELECT i.id, i.invoice_number AS number, i.issue_date::text AS issue_date, i.status,
              ${istDay('i.voided_at')}::text AS voided_on, i.client_gstin,
              ${CLIENT_NAME} AS client_name, i.place_of_supply_state, i.is_reverse_charge,
              i.subtotal::text, i.cgst::text, i.sgst::text, i.igst::text, i.total::text
         FROM hsdg.invoices i
         LEFT JOIN hsdg.entity_billing_profiles p ON p.id = i.client_entity_id
        WHERE i.status <> 'draft' AND i.invoice_number IS NOT NULL
          AND i.issue_date BETWEEN $1::date AND $2::date
        ORDER BY i.issue_date, i.invoice_number`,
      [start, end],
    );
    const lines = await this.lines(
      client,
      inv.rows.map((r) => r.id),
    );

    const invoices: RegisterInvoice[] = inv.rows.map((r) => ({
      id: r.id,
      number: r.number,
      issueDate: r.issue_date,
      status: r.status,
      voidedOn: r.voided_on,
      clientGstin: r.client_gstin,
      clientName: r.client_name,
      placeOfSupply: r.place_of_supply_state,
      reverseCharge: r.is_reverse_charge,
      subtotal: r.subtotal,
      cgst: r.cgst,
      sgst: r.sgst,
      igst: r.igst,
      total: r.total,
      lines: lines.get(r.id) ?? [],
    }));

    const cn = await client.query<{
      id: string;
      number: string;
      date: string;
      status: string;
      voided_on: string | null;
      invoice_number: string | null;
      invoice_date: string | null;
      invoice_total: string;
      client_gstin: string | null;
      client_name: string;
      place_of_supply_state: string | null;
      is_reverse_charge: boolean;
      rate: string | null;
      taxable: string;
      cgst: string;
      sgst: string;
      igst: string;
      total: string;
      sac: string | null;
    }>(
      `SELECT c.id, c.credit_note_number AS number, c.credit_date::text AS date, c.status,
              ${istDay('c.voided_at')}::text AS voided_on,
              i.invoice_number, i.issue_date::text AS invoice_date, i.total::text AS invoice_total,
              i.client_gstin, ${CLIENT_NAME} AS client_name, i.place_of_supply_state, i.is_reverse_charge,
              c.gst_rate::text AS rate, c.taxable_value::text AS taxable,
              c.cgst::text, c.sgst::text, c.igst::text, c.total::text,
              (SELECT l.sac_code FROM hsdg.invoice_line_items l
                WHERE l.invoice_id = i.id AND l.sac_code IS NOT NULL
                ORDER BY l.taxable_value DESC, l.sort_order LIMIT 1) AS sac
         FROM hsdg.credit_notes c
         JOIN hsdg.invoices i ON i.id = c.invoice_id
         LEFT JOIN hsdg.entity_billing_profiles p ON p.id = c.client_entity_id
        WHERE c.status IN ('approved', 'void') AND c.credit_date BETWEEN $1::date AND $2::date
        ORDER BY c.credit_date, c.credit_note_number`,
      [start, end],
    );
    const cnLines = await this.creditNoteLines(
      client,
      cn.rows.map((r) => r.id),
    );
    const creditNotes: RegisterCreditNote[] = cn.rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: r.date,
      status: r.status,
      voidedOn: r.voided_on,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      invoiceTotal: r.invoice_total,
      clientGstin: r.client_gstin,
      clientName: r.client_name,
      placeOfSupply: r.place_of_supply_state,
      reverseCharge: r.is_reverse_charge,
      rate: r.rate,
      taxable: r.taxable,
      cgst: r.cgst,
      sgst: r.sgst,
      igst: r.igst,
      total: r.total,
      sac: r.sac,
      lines: cnLines.get(r.id) ?? [],
    }));

    const earlier = await client.query<{
      id: string;
      number: string;
      issue_date: string;
      voided_on: string;
    }>(
      `SELECT i.id, i.invoice_number AS number, i.issue_date::text AS issue_date,
              ${istDay('i.voided_at')}::text AS voided_on
         FROM hsdg.invoices i
        WHERE i.status = 'void' AND i.invoice_number IS NOT NULL
          AND i.issue_date < $1::date
          AND ${istDay('i.voided_at')} BETWEEN $1::date AND $2::date
        ORDER BY i.issue_date, i.invoice_number`,
      [start, end],
    );
    const voidedFromEarlier: VoidedFromEarlier[] = earlier.rows.map((r) => ({
      id: r.id,
      number: r.number,
      issueDate: r.issue_date,
      voidedOn: r.voided_on,
    }));

    return buildGstRegister({
      month,
      firmGstin: f?.gstin ?? null,
      firmState: f?.state_code ?? null,
      filedThrough: f?.gst_filed_through ?? null,
      sacDefault: f?.sac_default ?? null,
      invoices,
      creditNotes,
      voidedFromEarlier,
    });
  }

  private async lines(client: PoolClient, ids: string[]): Promise<Map<string, RegisterLine[]>> {
    const out = new Map<string, RegisterLine[]>();
    if (!ids.length) return out;
    const { rows } = await client.query<{
      invoice_id: string;
      sac: string | null;
      rate: string;
      taxable: string;
    }>(
      `SELECT invoice_id, sac_code AS sac, gst_rate::text AS rate, taxable_value::text AS taxable
         FROM hsdg.invoice_line_items
        WHERE invoice_id = ANY($1::uuid[])
        ORDER BY sort_order, created_at`,
      [ids],
    );
    for (const r of rows) {
      out.set(r.invoice_id, [
        ...(out.get(r.invoice_id) ?? []),
        { sac: r.sac, rate: r.rate, taxable: r.taxable },
      ]);
    }
    return out;
  }

  private async creditNoteLines(
    client: PoolClient,
    ids: string[],
  ): Promise<Map<string, RegisterCreditNoteLine[]>> {
    const out = new Map<string, RegisterCreditNoteLine[]>();
    if (!ids.length) return out;
    const { rows } = await client.query<RegisterCreditNoteLine & { credit_note_id: string }>(
      `SELECT cl.credit_note_id, l.sac_code AS sac, cl.gst_rate::text AS rate,
              cl.taxable_value::text AS taxable, cl.igst::text AS igst,
              cl.cgst::text AS cgst, cl.sgst::text AS sgst
         FROM hsdg.credit_note_lines cl
         JOIN hsdg.invoice_line_items l ON l.id = cl.invoice_line_id
        WHERE cl.credit_note_id = ANY($1::uuid[])
        ORDER BY l.sort_order, cl.created_at`,
      [ids],
    );
    for (const { credit_note_id: id, ...line } of rows) {
      out.set(id, [...(out.get(id) ?? []), line]);
    }
    return out;
  }

  // ── Books ──

  booksSettings(ctx: RlsContext): Promise<BooksSettings> {
    return this.db.withRlsContext(ctx, (client) => this.loadSettings(client));
  }

  async updateBooksSettings(
    ctx: RlsContext,
    input: UpdateBooksSettingsInput,
  ): Promise<BooksSettings> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.loadSettings(client);
      if (before.version !== input.version) {
        throw new ConflictException(
          'Someone changed the ledger names since you opened them. Reload and try again.',
        );
      }
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [key, col] of Object.entries(LEDGER_COLUMNS) as [keyof BooksLedgers, string][]) {
        const v = input[key];
        if (v === undefined) continue;
        const name = v.trim();
        if (!name) throw new BadRequestException('A ledger name cannot be blank.');
        values.push(name);
        sets.push(`${col} = $${values.length}`);
      }
      if (!sets.length) return before;
      values.push(ctx.employeeId ?? null, input.version);
      const { rowCount } = await client.query(
        `UPDATE hsdg.books_settings
            SET ${sets.join(', ')}, updated_by_employee_id = $${values.length - 1},
                version = version + 1
          WHERE version = $${values.length}`,
        values,
      );
      if (!rowCount) {
        throw new ConflictException(
          'Someone changed the ledger names since you opened them. Reload and try again.',
        );
      }
      const after = await this.loadSettings(client);
      await this.audit.recordWith(client, ctx, {
        action: 'books_settings.updated',
        objectType: 'books_settings',
        before,
        after,
      });
      return after;
    });
  }

  private async loadSettings(client: PoolClient): Promise<BooksSettings> {
    const { rows } = await client.query<SettingsRow>(
      `SELECT sales_ledger, output_cgst_ledger, output_sgst_ledger, output_igst_ledger,
              tds_receivable_ledger, bank_ledger, cash_ledger, bad_debts_ledger,
              adjustment_ledger, version
         FROM hsdg.books_settings LIMIT 1`,
    );
    // The row is always there; none means the caller may not see it.
    if (!rows[0])
      throw new ForbiddenException(
        'The books export is for the Accountant and the Managing Partner.',
      );
    return settingsOf(rows[0]);
  }

  booksMonth(ctx: RlsContext, month: string): Promise<BooksMonth> {
    return this.db.withRlsContext(ctx, async (client) => {
      const ledgers = await this.loadSettings(client);
      const vouchers = await this.vouchers(client, month, ledgers);
      const exports = await client.query<ExportRow>(
        `${EXPORT_SELECT} WHERE b.month = $1::date ORDER BY b.created_at DESC`,
        [`${month}-01`],
      );
      return {
        month,
        vouchers,
        pending: vouchers.filter((v) => !v.exportedAt).length,
        exports: exports.rows.map(exportOf),
        ledgers,
      };
    });
  }

  /**
   * Marks the month's pending vouchers exported, once: a voucher already in
   * an export (or exported by someone else a moment ago) refuses the lot.
   */
  exportBooks(ctx: RlsContext, month: string, format: BooksFormat): Promise<BooksExportRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const ledgers = await this.loadSettings(client);
      const pending = (await this.vouchers(client, month, ledgers)).filter((v) => !v.exportedAt);
      if (!pending.length) {
        throw new ConflictException(
          `Nothing new to export for ${month}: every voucher has gone to the books.`,
        );
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.books_exports (month, format, voucher_count, exported_by_employee_id)
         VALUES ($1::date, $2, $3, $4) RETURNING id`,
        [`${month}-01`, format, pending.length, ctx.employeeId ?? null],
      );
      const id = rows[0]!.id;
      try {
        await client.query(
          `INSERT INTO hsdg.books_export_items (source, source_id, export_id)
           SELECT s, sid, $3 FROM unnest($1::text[], $2::uuid[]) AS t(s, sid)`,
          [pending.map((v) => v.source), pending.map((v) => v.sourceId), id],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          throw new ConflictException(
            'Someone exported these vouchers a moment ago. Reload to see the export.',
          );
        }
        throw e;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'books.exported',
        objectType: 'books_export',
        objectId: id,
        after: { month, format, vouchers: pending.length },
      });
      const out = await client.query<ExportRow>(`${EXPORT_SELECT} WHERE b.id = $1`, [id]);
      return exportOf(out.rows[0]!);
    });
  }

  /** The file of an export, rebuilt from the vouchers it took. */
  exportFile(ctx: RlsContext, exportId: string): Promise<FinanceFile> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ExportRow>(`${EXPORT_SELECT} WHERE b.id = $1`, [
        exportId,
      ]);
      const rec = rows[0];
      if (!rec) throw new NotFoundException('No such export.');
      const items = await client.query<{ source: VoucherSource; source_id: string }>(
        `SELECT source, source_id FROM hsdg.books_export_items WHERE export_id = $1`,
        [exportId],
      );
      const keys = new Set(items.rows.map((r) => voucherKey(r.source, r.source_id)));
      const ledgers = await this.loadSettings(client);
      const vouchers = (await this.vouchers(client, rec.month, ledgers)).filter((v) =>
        keys.has(voucherKey(v.source, v.sourceId)),
      );
      const file = BOOKS_FILE[rec.format];
      const stamp = rec.created_at.toISOString().slice(0, 16).replace(/[-:T]/g, '');
      return {
        buffer: Buffer.from(file.write(vouchers), 'utf8'),
        filename: `Books ${rec.month} ${stamp}.${file.ext}`,
        type: file.type,
      };
    });
  }

  /** Undo an export: its vouchers become pending again. */
  deleteExport(ctx: RlsContext, exportId: string): Promise<void> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ExportRow>(`${EXPORT_SELECT} WHERE b.id = $1`, [
        exportId,
      ]);
      const rec = rows[0];
      if (!rec) throw new NotFoundException('No such export.');
      await client.query('DELETE FROM hsdg.books_exports WHERE id = $1', [exportId]);
      await this.audit.recordWith(client, ctx, {
        action: 'books.export_undone',
        objectType: 'books_export',
        objectId: exportId,
        before: exportOf(rec),
      });
    });
  }

  private async vouchers(
    client: PoolClient,
    month: string,
    ledgers: BooksLedgers,
  ): Promise<BooksVoucher[]> {
    const start = `${month}-01`;
    const end = monthEnd(month);
    const range = [start, end];
    const invoices = await client.query<BooksInvoiceRow>(
      `SELECT i.id, i.invoice_number AS number, i.issue_date::text AS date, ${CLIENT_NAME} AS "clientName",
              i.subtotal::text AS subtotal, i.cgst::text AS cgst, i.sgst::text AS sgst,
              i.igst::text AS igst, i.total::text AS total,
              CASE WHEN i.status = 'void' THEN ${istDay('i.voided_at')}::text END AS "voidedOn"
         FROM hsdg.invoices i
         LEFT JOIN hsdg.entity_billing_profiles p ON p.id = i.client_entity_id
        WHERE i.status <> 'draft' AND i.invoice_number IS NOT NULL
          AND (i.issue_date BETWEEN $1::date AND $2::date
               OR (i.status = 'void' AND ${istDay('i.voided_at')} BETWEEN $1::date AND $2::date))`,
      range,
    );
    const receipts = await client.query<BooksReceiptRow>(
      `SELECT r.id, r.received_on::text AS date, ${CLIENT_NAME} AS "clientName", r.mode, r.reference,
              r.gross_amount::text AS gross, r.tds_amount::text AS tds, r.tds_section AS "tdsSection",
              r.net_amount::text AS net,
              (SELECT string_agg(i.invoice_number, ', ' ORDER BY i.invoice_number)
                 FROM hsdg.receipt_allocations a JOIN hsdg.invoices i ON i.id = a.invoice_id
                WHERE a.receipt_id = r.id) AS against,
              CASE WHEN r.status = 'reversed' THEN ${istDay('r.reversed_at')}::text END AS "reversedOn"
         FROM hsdg.receipts r
         LEFT JOIN hsdg.entity_billing_profiles p ON p.id = r.client_entity_id
        WHERE r.received_on BETWEEN $1::date AND $2::date
           OR (r.status = 'reversed' AND ${istDay('r.reversed_at')} BETWEEN $1::date AND $2::date)`,
      range,
    );
    const creditNotes = await client.query<BooksCreditNoteRow>(
      `SELECT c.id, c.credit_note_number AS number, c.credit_date::text AS date, ${CLIENT_NAME} AS "clientName",
              i.invoice_number AS "invoiceNumber", c.taxable_value::text AS taxable,
              c.cgst::text AS cgst, c.sgst::text AS sgst, c.igst::text AS igst, c.total::text AS total,
              CASE WHEN c.status = 'void' THEN ${istDay('c.voided_at')}::text END AS "voidedOn"
         FROM hsdg.credit_notes c
         JOIN hsdg.invoices i ON i.id = c.invoice_id
         LEFT JOIN hsdg.entity_billing_profiles p ON p.id = c.client_entity_id
        WHERE c.status IN ('approved', 'void')
          AND (c.credit_date BETWEEN $1::date AND $2::date
               OR (c.status = 'void' AND ${istDay('c.voided_at')} BETWEEN $1::date AND $2::date))`,
      range,
    );
    const writeOffs = await client.query<BooksWriteOffRow>(
      `SELECT w.id, ${istDay('w.decided_at')}::text AS date, ${CLIENT_NAME} AS "clientName",
              i.invoice_number AS "invoiceNumber", w.amount::text AS amount
         FROM hsdg.write_offs w
         JOIN hsdg.invoices i ON i.id = w.invoice_id
         LEFT JOIN hsdg.entity_billing_profiles p ON p.id = w.client_entity_id
        WHERE w.status = 'approved' AND ${istDay('w.decided_at')} BETWEEN $1::date AND $2::date`,
      range,
    );
    const ids = [
      ...invoices.rows.map((r) => r.id),
      ...receipts.rows.map((r) => r.id),
      ...creditNotes.rows.map((r) => r.id),
      ...writeOffs.rows.map((r) => r.id),
    ];
    const exported = new Map<string, string>();
    if (ids.length) {
      const done = await client.query<{ source: VoucherSource; source_id: string; at: Date }>(
        `SELECT x.source, x.source_id, b.created_at AS at
           FROM hsdg.books_export_items x JOIN hsdg.books_exports b ON b.id = x.export_id
          WHERE x.source_id = ANY($1::uuid[])`,
        [ids],
      );
      for (const r of done.rows)
        exported.set(voucherKey(r.source, r.source_id), r.at.toISOString());
    }
    return buildVouchers({
      month,
      ledgers,
      invoices: invoices.rows,
      receipts: receipts.rows,
      creditNotes: creditNotes.rows,
      writeOffs: writeOffs.rows,
      exported,
    });
  }

  // ── Bank statement match ──

  async bankMatch(
    ctx: RlsContext,
    input: { filename: string; contentBase64: string },
  ): Promise<BankMatchResult> {
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (bytes.length === 0) throw new BadRequestException('The file is empty.');
    if (bytes.length > BANK_STATEMENT_MAX_BYTES) {
      throw new BadRequestException(
        'The file is larger than a month’s bank statement can be. Export one month at a time.',
      );
    }
    let rows: unknown[][];
    try {
      const book = XLSX.read(bytes, { type: 'buffer', raw: true, cellDates: false });
      const sheet = book.Sheets[book.SheetNames[0] ?? ''];
      rows = sheet
        ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
        : [];
    } catch {
      throw new BadRequestException(
        'This file could not be read. Download the statement from the bank as CSV or Excel.',
      );
    }
    const statement = parseStatement(rows as Parameters<typeof parseStatement>[0]);
    if (!statement) {
      throw new BadRequestException(
        'No date, narration and credit (deposit) columns found. Download the statement from the bank as CSV or Excel, with its header row.',
      );
    }
    if (!statement.credits.length) {
      return {
        columns: statement.columns,
        credits: 0,
        debitsSkipped: statement.debitsSkipped,
        lines: [],
      };
    }
    const dates = statement.credits.map((c) => c.date).sort();
    return this.db.withRlsContext(ctx, async (client) => {
      const open = await client.query<OpenInvoice>(
        `SELECT i.id, i.invoice_number AS number, i.client_entity_id AS "clientId",
                ${CLIENT_NAME} AS "clientName", i.issue_date::text AS "issueDate",
                (i.total - i.amount_settled)::text AS balance, i.subtotal::text AS subtotal,
                i.total::text AS total
           FROM hsdg.invoices i
           LEFT JOIN hsdg.entity_billing_profiles p ON p.id = i.client_entity_id
          WHERE i.status IN ('issued', 'partially_paid') AND i.total > i.amount_settled`,
      );
      const posted = await client.query<PostedReceipt>(
        `SELECT r.id, r.received_on::text AS date, r.net_amount::text AS net
           FROM hsdg.receipts r
          WHERE r.status = 'posted'
            AND r.received_on BETWEEN $1::date - 3 AND $2::date + 3`,
        [dates[0], dates[dates.length - 1]],
      );
      return {
        columns: statement.columns,
        credits: statement.credits.length,
        debitsSkipped: statement.debitsSkipped,
        lines: matchCredits(statement.credits, open.rows, posted.rows),
      };
    });
  }
}

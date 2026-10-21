import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  canRemindBy,
  formatInr,
  fromPaise,
  reminderChannelFor,
  sumAmounts,
  tdsQuarterLabel,
  tdsQuarterOf,
  tdsReminderText,
  tdsSectionKind,
  TDS_FILE_PASSWORD_CODE,
  TDS_REMINDER_GAP_DAYS,
  toPaise,
  whatsappUrl,
  type ImportTdsCreditsInput,
  type RemindTdsInput,
  type TdsAwaitedLine,
  type TdsBookedLine,
  type TdsCheck,
  type TdsClientMismatch,
  type TdsCreditLine,
  type TdsImportBatch,
  type TdsImportResult,
  type TdsMatchReport,
  type TdsMatchedGroup,
  type TdsQuarter,
  type TdsReminderResult,
  type TdsSection,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { istToday } from '../compliance/compliance-profile';
import { NotificationsService } from '../notifications/notifications.service';
import { workflowPolicy } from '../workflow-settings/workflow-policy';
import { awaitedFor, bookedChecks, creditChecks, longDate } from './tds-checks';
import { TdsParseError, parseTdsText } from './tds-parsers';
import { TdsPdfReader } from './tds-pdf-reader';
import { matchTds, quarterIndex, type MatchCredit, type MatchReceipt } from './tds-match';
import { isZip, readTdsZip } from './tds-zip';

/** The largest file taken: a year's 26AS text is tens of kilobytes. */
export const TDS_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** The e-mail's type on the client delivery queue. */
const TDS_REMINDER_DELIVERY = 'tds_missing_from_26as';
const CHANNEL_WORDS = { email: 'e-mail', whatsapp: 'WhatsApp', copy: 'a copied message' } as const;

type Quarter = TdsQuarter['quarter'];

interface CreditRow {
  id: string;
  deductor_tan: string;
  deductor_name: string;
  section: string;
  transaction_date: string;
  amount_paid: string;
  tax_deducted: string;
  tds_deposited: string;
  booking_status: string | null;
  remarks: string | null;
  client_id: string | null;
  client_name: string | null;
}

interface ReceiptRow {
  id: string;
  client_entity_id: string;
  client_name: string;
  received_on: string;
  reference: string | null;
  gross_amount: string;
  tds_amount: string;
  tds_section: TdsSection | null;
  /** The fee before GST it settled, when fully allocated to invoices. */
  taxable: string | null;
}

/**
 * PS-204 · TDS on our fees against the firm's 26AS. Import what TRACES gives
 * (the 26AS text export, or a Form 16A), match it to the TDS booked on
 * receipts by the client's TAN, quarter and amount, and ask a client whose
 * deductions are missing to file or correct their return, on the
 * client-chase channels. RLS keeps each biller to their own clients' credits.
 */
@Injectable()
export class TdsCreditsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly pdf: TdsPdfReader,
  ) {}

  async import(ctx: RlsContext, input: ImportTdsCreditsInput): Promise<TdsImportResult> {
    if (!ctx.employeeId) {
      throw new ForbiddenException(
        'Your sign-in is not linked to a staff record, so the import cannot be credited to you. Ask an administrator to link it under Administration → People.',
      );
    }
    let bytes: Buffer = Buffer.from(input.contentBase64, 'base64');
    if (bytes.length === 0) throw new BadRequestException('The file is empty.');
    if (bytes.length > TDS_IMPORT_MAX_BYTES) {
      throw new BadRequestException('The file is larger than a 26AS or Form 16A can be.');
    }
    const password = input.password || undefined;
    // TRACES sends the 26AS text in a ZIP: the statement is the file inside.
    if (isZip(bytes)) bytes = this.unzip(bytes, password);
    const isPdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    let text: string;
    if (isPdf) {
      const read = await this.pdf.read(bytes, password);
      if (read.kind === 'password') {
        throw new BadRequestException({
          message: read.wrong
            ? 'That password does not open this PDF. TRACES uses the date of birth or incorporation of the PAN holder, as DDMMYYYY.'
            : 'This PDF is password-protected. Enter its password — TRACES uses the date of birth or incorporation of the PAN holder, as DDMMYYYY.',
          reason: TDS_FILE_PASSWORD_CODE,
          wrongPassword: read.wrong,
        });
      }
      if (read.kind === 'unreadable') {
        throw new BadRequestException(
          'This PDF has no text to read (a scan or photo). Import the Form 16A as TRACES issues it, or the 26AS text export.',
        );
      }
      text = read.text;
    } else {
      text = bytes.toString('utf8');
    }
    let parsed;
    try {
      parsed = parseTdsText(text);
    } catch (err) {
      if (err instanceof TdsParseError) throw new BadRequestException(err.message);
      throw err;
    }
    const financialYear = parsed.financialYear!;
    const sha = createHash('sha256').update(bytes).digest('hex');
    const tdsTotal = sumAmounts(parsed.credits.map((c) => c.tdsDeposited));
    // A Form 16A, or a 26AS that does not say: as on the day it is imported.
    const asOn = parsed.asOn ?? istToday();
    const warnings = [...parsed.warnings];

    return this.db.withRlsContext(ctx, async (client) => {
      // One import of a year at a time, so supersession is in file order.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('tds_import:' || $1))`, [
        financialYear,
      ]);
      const { rows: firm } = await client.query<{ gstin: string | null }>(
        `SELECT gstin FROM hsdg.firm_settings LIMIT 1`,
      );
      const firmPan = firm[0]?.gstin ? firm[0].gstin.slice(2, 12) : null;
      if (firmPan && parsed.pan && parsed.pan !== firmPan) {
        throw new BadRequestException(
          `This file is for PAN ${parsed.pan}; the firm's GSTIN is under PAN ${firmPan}.`,
        );
      }
      // The same statement again, whenever it was first imported.
      const { rows: seen } = await client.query<{
        created_at: Date;
        file_name: string;
        financial_year: string;
      }>(
        `SELECT created_at, file_name, financial_year FROM hsdg.firm_tds_import_batches
          WHERE file_sha256 = $1 ORDER BY created_at LIMIT 1`,
        [sha],
      );
      if (seen[0]) {
        throw new ConflictException(
          `This file was imported on ${longDate(istToday(seen[0].created_at))} (${seen[0].file_name}, ${seen[0].financial_year}); there is nothing new in it.`,
        );
      }
      if (parsed.source === '26as_text') {
        const { rows: active } = await client.query<{
          as_on: string | null;
          tds_total: string;
          created_at: Date;
        }>(
          `SELECT as_on::text, tds_total::text, created_at FROM hsdg.firm_tds_import_batches
            WHERE financial_year = $1 AND source = '26as_text'
            ORDER BY created_at DESC LIMIT 1`,
          [financialYear],
        );
        const prev = active[0];
        if (prev?.as_on && prev.as_on > asOn) {
          throw new ConflictException(
            `This 26AS is as on ${longDate(asOn)}, older than the one imported on ${longDate(istToday(prev.created_at))} (as on ${longDate(prev.as_on)}). Download a fresh 26AS from TRACES.`,
          );
        }
        if (prev && toPaise(tdsTotal) < toPaise(prev.tds_total)) {
          warnings.push(
            `This 26AS shows ₹${formatInr(tdsTotal)} of TDS for ${financialYear}, less than the ₹${formatInr(prev.tds_total)} in the one it replaces: a deductor may have revised a return downwards. Check before claiming the credit.`,
          );
        }
      }

      const { rows: batch } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.firm_tds_import_batches
           (source, file_name, file_sha256, pan, financial_year, credits_count, tds_total,
            imported_by_employee_id, as_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          parsed.source,
          input.filename.trim().slice(0, 400),
          sha,
          parsed.pan,
          financialYear,
          parsed.credits.length,
          tdsTotal,
          ctx.employeeId,
          asOn,
        ],
      );
      const batchId = batch[0]!.id;
      const cs = parsed.credits;
      // No RETURNING: the importer need not see every client's rows.
      await client.query(
        `INSERT INTO hsdg.firm_tds_credits
           (import_batch_id, deductor_tan, deductor_name, section, transaction_date,
            amount_paid, tax_deducted, tds_deposited, booking_status, booking_date,
            quarter, financial_year, remarks)
         SELECT $1, t.tan, t.name, t.section, t.d, t.paid, t.deducted, t.deposited, t.status,
                t.booked, t.quarter, $2, t.remarks
           FROM unnest($3::text[], $4::text[], $5::text[], $6::date[], $7::numeric[],
                       $8::numeric[], $9::numeric[], $10::text[], $11::date[], $12::text[],
                       $13::text[])
             AS t(tan, name, section, d, paid, deducted, deposited, status, booked, quarter,
                  remarks)`,
        [
          batchId,
          financialYear,
          cs.map((c) => c.deductorTan),
          cs.map((c) => c.deductorName.slice(0, 300)),
          cs.map((c) => c.section.slice(0, 20)),
          cs.map((c) => c.transactionDate),
          cs.map((c) => c.amountPaid),
          cs.map((c) => c.taxDeducted),
          cs.map((c) => c.tdsDeposited),
          cs.map((c) => c.bookingStatus),
          cs.map((c) => c.bookingDate),
          cs.map((c) => tdsQuarterOf(c.transactionDate).quarter),
          cs.map((c) => c.remarks),
        ],
      );
      const { rows: applied } = await client.query<{ n: number }>(
        `SELECT hsdg.apply_tds_import($1) AS n`,
        [batchId],
      );
      const superseded = applied[0]!.n;
      const deductors = new Set(cs.map((c) => c.deductorTan)).size;
      await this.audit.recordWith(client, ctx, {
        action: 'tds_credits.imported',
        objectType: 'tds_import_batch',
        objectId: batchId,
        after: {
          source: parsed.source,
          fileName: input.filename,
          financialYear,
          credits: cs.length,
          deductors,
          tdsTotal,
          asOn,
          superseded,
          warnings: warnings.length,
        },
      });
      return {
        batchId,
        source: parsed.source,
        financialYear,
        pan: parsed.pan,
        credits: cs.length,
        deductors,
        tdsTotal,
        superseded,
        asOn: parsed.source === '26as_text' ? asOn : null,
        warnings,
      };
    });
  }

  /** The statement inside the ZIP TRACES sends; what is wrong said in words. */
  private unzip(zip: Buffer, password: string | undefined): Buffer {
    const read = readTdsZip(zip, password);
    switch (read.kind) {
      case 'file':
        return read.bytes;
      case 'password':
        throw new BadRequestException({
          message: read.wrong
            ? "That password does not open this ZIP. TRACES uses the date of birth or incorporation of the PAN holder, as DDMMYYYY; a deductor's Form 16A ZIP, its TAN."
            : 'This ZIP is password-protected. Enter its password — TRACES uses the date of birth or incorporation of the PAN holder, as DDMMYYYY.',
          reason: TDS_FILE_PASSWORD_CODE,
          wrongPassword: read.wrong,
        });
      case 'aes':
        throw new BadRequestException(
          'This ZIP is AES-encrypted, which is not read here. Unzip it on your computer and import the .txt file inside.',
        );
      case 'empty':
        throw new BadRequestException('The ZIP holds no .txt or .pdf file to import.');
      case 'too_large':
        throw new BadRequestException(
          'The file in the ZIP is larger than a 26AS or Form 16A can be.',
        );
      default:
        throw new BadRequestException('This ZIP cannot be read. Download it from TRACES again.');
    }
  }

  match(ctx: RlsContext, financialYear: string, quarter: Quarter | null): Promise<TdsMatchReport> {
    return this.db.withRlsContext(ctx, (client) => this.compute(client, financialYear, quarter));
  }

  /** Ask the client to file or correct their TDS return for what is missing. */
  remind(ctx: RlsContext, input: RemindTdsInput): Promise<TdsReminderResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: who } = await client.query<{
        name: string;
        can_bill: boolean;
        email: string | null;
        phone: string | null;
        firm_name: string;
      }>(
        `SELECT e.legal_name AS name, hsdg.ctx_can_bill(e.id) AS can_bill,
                e.contact_email AS email, e.contact_phone AS phone,
                (SELECT f.firm_name FROM hsdg.firm_settings f LIMIT 1) AS firm_name
           FROM hsdg.entity_billing_profiles e WHERE e.id = $1`,
        [input.clientId],
      );
      const c = who[0];
      if (!c?.can_bill) throw new NotFoundException('Client not found.');
      const quarter = input.quarter ?? null;
      const report = await this.compute(client, input.financialYear, quarter);
      if (report.imports.length === 0) {
        throw new BadRequestException(`Import the 26AS for ${input.financialYear} first.`);
      }
      const row = report.clients.find((m) => m.clientId === input.clientId);
      const missing = row?.missing ?? [];
      if (missing.length === 0) {
        const awaited = row?.awaited[0];
        throw new BadRequestException(
          awaited
            ? `None of this client's TDS is late for that period: what is not in the 26AS yet is awaited (${awaited.reason}).`
            : "None of this client's TDS is missing from the 26AS for that period.",
        );
      }
      const { rows: last } = await client.query<{
        channel: keyof typeof CHANNEL_WORDS;
        created_at: Date;
        by_name: string | null;
      }>(
        `SELECT t.channel, t.created_at, e.full_name AS by_name
           FROM hsdg.tds_reminders t
           LEFT JOIN hsdg.employee_names e ON e.id = t.sent_by_employee_id
          WHERE t.client_entity_id = $1 AND t.financial_year = $2
            AND t.quarter IS NOT DISTINCT FROM $3
            AND t.created_at > now() - make_interval(days => $4)
          ORDER BY t.created_at DESC LIMIT 1`,
        [input.clientId, input.financialYear, quarter, TDS_REMINDER_GAP_DAYS],
      );
      if (last[0] && !input.force) {
        const l = last[0];
        throw new ConflictException(
          `${c.name} was reminded of this on ${longDate(istToday(l.created_at))} by ${CHANNEL_WORDS[l.channel]}${l.by_name ? ` (${l.by_name})` : ''}. Give them ${TDS_REMINDER_GAP_DAYS} days, or send again anyway.`,
        );
      }

      const reach = {
        canEmail: Boolean(c.email) && this.notifications.hasExternalChannels,
        phone: c.phone,
      };
      const requested = input.channel;
      if (requested && !canRemindBy(requested, reach)) {
        throw new BadRequestException(
          requested === 'whatsapp'
            ? 'The client has no phone number WhatsApp can use.'
            : 'The client cannot be e-mailed: no address, or e-mail is off.',
        );
      }
      const { channel, fallback } = requested
        ? { channel: requested, fallback: null }
        : reminderChannelFor((await workflowPolicy(client)).clientReminderChannel, reach);
      const text = tdsReminderText({
        clientName: c.name,
        firmName: c.firm_name,
        pan: report.pan,
        financialYear: input.financialYear,
        quarter,
        lines: missing,
      });
      const tdsAmount = sumAmounts(missing.map((m) => m.tdsAmount));
      if (channel === 'email') {
        await this.notifications.enqueueClientDeliveryWith(client, {
          recipientEmail: c.email,
          type: TDS_REMINDER_DELIVERY,
          title: `TDS missing from our Form 26AS — ${
            quarter ? tdsQuarterLabel(input.financialYear, quarter) : input.financialYear
          }`,
          body: text,
        });
      }
      await client.query(
        `INSERT INTO hsdg.tds_reminders
           (client_entity_id, financial_year, quarter, channel, receipt_ids, tds_amount,
            sent_by_employee_id)
         VALUES ($1, $2, $3, $4, $5::uuid[], $6, $7)`,
        [
          input.clientId,
          input.financialYear,
          quarter,
          channel,
          missing.map((m) => m.receiptId),
          tdsAmount,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tds.client_reminded',
        objectType: 'entity',
        objectId: input.clientId,
        after: {
          channel,
          fallback,
          requested: requested ?? null,
          financialYear: input.financialYear,
          quarter,
          tdsAmount,
          receipts: missing.length,
          ...(last[0] ? { repeatWithinDays: TDS_REMINDER_GAP_DAYS } : {}),
        },
      });
      const common = {
        clientId: input.clientId,
        client: c.name,
        text,
        tdsAmount,
        receipts: missing.length,
      };
      if (channel === 'email') return { ...common, channel, to: c.email as string };
      if (channel === 'whatsapp') {
        return { ...common, channel, waUrl: whatsappUrl(c.phone, text) as string };
      }
      return { ...common, channel: 'copy', fallback };
    });
  }

  /**
   * The year's credits and booked TDS — with a quarter either side, so a
   * deduction booked across the year's edge still finds its pair — matched,
   * then cut to the period asked for. Booked TDS not in the 26AS is late
   * (missing) or not yet (awaited) by the 26AS's as-on date; every line
   * carries what a senior would query.
   */
  private async compute(
    client: PoolClient,
    financialYear: string,
    quarter: Quarter | null,
  ): Promise<TdsMatchReport> {
    const start = Number(financialYear.slice(0, 4));
    const window = [`${start}-01-01`, `${start + 1}-06-30`];
    const today = istToday();
    const { rows: settings } = await client.query<{ tolerance: string }>(
      `SELECT tds_match_tolerance::text AS tolerance FROM hsdg.firm_settings LIMIT 1`,
    );
    const tolerance = settings[0]?.tolerance ?? '1.00';

    // The client a TAN is on: an active registration first, then a client
    // the caller bills, then the oldest — the same answer every time.
    const { rows: creditRows } = await client.query<CreditRow>(
      `SELECT c.id, c.deductor_tan, c.deductor_name, c.section, c.transaction_date::text,
              c.amount_paid::text, c.tax_deducted::text, c.tds_deposited::text,
              c.booking_status, c.remarks,
              owner.entity_id AS client_id, owner.legal_name AS client_name
         FROM hsdg.firm_tds_credits c
         LEFT JOIN LATERAL (
           SELECT r.entity_id, e.legal_name
             FROM hsdg.client_tans r
             JOIN hsdg.entity_billing_profiles e ON e.id = r.entity_id
            WHERE r.tan = c.deductor_tan
            ORDER BY COALESCE(r.status = 'active', false) DESC,
                     hsdg.ctx_can_bill(r.entity_id) DESC, r.created_at, r.id
            LIMIT 1) owner ON true
        WHERE c.superseded_by_batch_id IS NULL
          AND c.transaction_date BETWEEN $1::date AND $2::date
        ORDER BY c.transaction_date, c.id`,
      window,
    );
    const { rows: receiptRows } = await client.query<ReceiptRow>(
      `SELECT r.id, r.client_entity_id, e.legal_name AS client_name, r.received_on::text,
              r.reference, r.gross_amount::text, r.tds_amount::text, r.tds_section,
              CASE WHEN a.allocated = r.gross_amount THEN a.taxable::text END AS taxable
         FROM hsdg.receipts r
         JOIN hsdg.entity_billing_profiles e ON e.id = r.client_entity_id
         LEFT JOIN LATERAL (
           SELECT sum(x.amount) AS allocated,
                  round(sum(x.amount * i.subtotal / NULLIF(i.total, 0)), 2) AS taxable
             FROM hsdg.receipt_allocations x
             JOIN hsdg.invoices i ON i.id = x.invoice_id
            WHERE x.receipt_id = r.id) a ON true
        WHERE r.status = 'posted' AND r.tds_amount > 0
          AND r.received_on BETWEEN $1::date AND $2::date
        ORDER BY r.received_on, r.id`,
      window,
    );
    const { rows: batchRows } = await client.query<{
      id: string;
      source: TdsImportBatch['source'];
      file_name: string;
      financial_year: string;
      pan: string | null;
      credits_count: number;
      superseded_count: number | null;
      as_on: string | null;
      by_name: string | null;
      created_at: Date;
    }>(
      `SELECT b.id, b.source, b.file_name, b.financial_year, b.pan, b.credits_count,
              b.superseded_count, b.as_on::text, e.full_name AS by_name, b.created_at
         FROM hsdg.firm_tds_import_batches b
         LEFT JOIN hsdg.employee_names e ON e.id = b.imported_by_employee_id
        WHERE b.financial_year = $1
        ORDER BY b.created_at DESC
        LIMIT 10`,
      [financialYear],
    );
    const imports: TdsImportBatch[] = batchRows.map((b) => ({
      id: b.id,
      source: b.source,
      fileName: b.file_name,
      financialYear: b.financial_year,
      pan: b.pan,
      credits: b.credits_count,
      superseded: b.superseded_count ?? 0,
      asOn: b.source === '26as_text' ? b.as_on : null,
      importedByName: b.by_name,
      importedAt: b.created_at.toISOString(),
    }));
    const { rows: latest26as } = await client.query<{ as_on: string | null }>(
      `SELECT as_on::text FROM hsdg.firm_tds_import_batches
        WHERE financial_year = $1 AND source = '26as_text'
        ORDER BY created_at DESC LIMIT 1`,
      [financialYear],
    );
    const asOn = latest26as[0]?.as_on ?? null;

    const qi = (iso: string): number => {
      const q = tdsQuarterOf(iso);
      return quarterIndex(q.financialYear, q.quarter);
    };
    const inScope = (iso: string): boolean => {
      const q = tdsQuarterOf(iso);
      return q.financialYear === financialYear && (!quarter || q.quarter === quarter);
    };

    // A reversal (a negative row) cancels the row it reverses: the same TAN,
    // quarter and amount. Neither is matched.
    const reversed = new Set<string>();
    const negatives = creditRows.filter((c) => toPaise(c.tds_deposited) < 0n);
    for (const n of negatives) {
      const pair = creditRows.find(
        (c) =>
          !reversed.has(c.id) &&
          c.deductor_tan === n.deductor_tan &&
          toPaise(c.tds_deposited) === -toPaise(n.tds_deposited) &&
          qi(c.transaction_date) === qi(n.transaction_date),
      );
      if (pair) {
        reversed.add(pair.id);
        reversed.add(n.id);
      }
    }
    const live = creditRows.filter((c) => !reversed.has(c.id) && toPaise(c.tds_deposited) > 0n);

    const outcome = matchTds(
      live.map<MatchCredit>((c) => ({
        id: c.id,
        clientId: c.client_id,
        quarterIndex: qi(c.transaction_date),
        date: c.transaction_date,
        tds: toPaise(c.tds_deposited),
      })),
      receiptRows.map<MatchReceipt>((r) => ({
        id: r.id,
        clientId: r.client_entity_id,
        quarterIndex: qi(r.received_on),
        date: r.received_on,
        tds: toPaise(r.tds_amount),
      })),
      toPaise(tolerance),
    );

    const credits = new Map(creditRows.map((c) => [c.id, c]));
    const receipts = new Map(receiptRows.map((r) => [r.id, r]));
    const creditLine = (c: CreditRow): TdsCreditLine => {
      const q = tdsQuarterOf(c.transaction_date);
      return {
        id: c.id,
        deductorTan: c.deductor_tan,
        deductorName: c.deductor_name,
        section: c.section,
        sectionKind: tdsSectionKind(c.section),
        transactionDate: c.transaction_date,
        amountPaid: c.amount_paid,
        taxDeducted: c.tax_deducted,
        tdsDeposited: c.tds_deposited,
        bookingStatus: c.booking_status,
        remarks: c.remarks,
        financialYear: q.financialYear,
        quarter: q.quarter,
        checks: creditChecks({
          section: c.section,
          amountPaid: c.amount_paid,
          taxDeducted: c.tax_deducted,
          tdsDeposited: c.tds_deposited,
          bookingStatus: c.booking_status,
          remarks: c.remarks,
        }),
      };
    };
    const bookedLine = (r: ReceiptRow): TdsBookedLine => {
      const q = tdsQuarterOf(r.received_on);
      return {
        receiptId: r.id,
        receivedOn: r.received_on,
        reference: r.reference,
        grossAmount: r.gross_amount,
        tdsAmount: r.tds_amount,
        tdsSection: r.tds_section,
        financialYear: q.financialYear,
        quarter: q.quarter,
        checks: bookedChecks({ tdsAmount: r.tds_amount, taxable: r.taxable }),
      };
    };
    const clientName = new Map<string, string>();
    for (const r of receiptRows) clientName.set(r.client_entity_id, r.client_name);
    for (const c of creditRows) if (c.client_id) clientName.set(c.client_id, c.client_name!);

    const matched: TdsMatchedGroup[] = outcome.matches
      .filter(
        (m) =>
          m.creditIds.some((id) => inScope(credits.get(id)!.transaction_date)) ||
          m.receiptIds.some((id) => inScope(receipts.get(id)!.received_on)),
      )
      .map((m) => ({
        kind: m.kind,
        clientId: m.clientId,
        clientName: clientName.get(m.clientId) ?? '',
        credits: m.creditIds.map((id) => creditLine(credits.get(id)!)),
        receipts: m.receiptIds.map((id) => bookedLine(receipts.get(id)!)),
        difference: fromPaise(m.difference),
      }))
      .sort(
        (a, b) =>
          a.clientName.localeCompare(b.clientName) ||
          (a.receipts[0]?.receivedOn ?? '').localeCompare(b.receipts[0]?.receivedOn ?? ''),
      );

    const notBooked = outcome.notBooked
      .map((id) => credits.get(id)!)
      .filter((c) => inScope(c.transaction_date));
    // Not in the 26AS: late once a 26AS old enough lacks it, else awaited.
    const late: ReceiptRow[] = [];
    const awaited = new Map<string, TdsAwaitedLine>();
    for (const id of outcome.missing) {
      const r = receipts.get(id)!;
      if (!inScope(r.received_on)) continue;
      const q = tdsQuarterOf(r.received_on);
      const wait = awaitedFor(q.financialYear, q.quarter, asOn, today);
      if (wait) awaited.set(r.id, { ...bookedLine(r), ...wait });
      else late.push(r);
    }
    const awaitedOf = (clientId: string): TdsAwaitedLine[] =>
      [...awaited.values()].filter((a) => receipts.get(a.receiptId)!.client_entity_id === clientId);

    const clientIds = [
      ...new Set([
        ...notBooked.flatMap((c) => (c.client_id ? [c.client_id] : [])),
        ...late.map((r) => r.client_entity_id),
        ...[...awaited.keys()].map((id) => receipts.get(id)!.client_entity_id),
      ]),
    ];
    const tans = new Map<string, string[]>();
    const lastReminder = new Map<string, TdsClientMismatch['lastReminder']>();
    if (clientIds.length) {
      const { rows: tanRows } = await client.query<{ entity_id: string; tans: string[] }>(
        `SELECT entity_id, array_agg(DISTINCT tan) AS tans
           FROM hsdg.client_tans
          WHERE entity_id = ANY($1::uuid[])
          GROUP BY entity_id`,
        [clientIds],
      );
      for (const t of tanRows) tans.set(t.entity_id, t.tans.sort());
      const { rows: sent } = await client.query<{
        client_entity_id: string;
        channel: 'email' | 'whatsapp' | 'copy';
        created_at: Date;
        by_name: string | null;
      }>(
        `SELECT DISTINCT ON (t.client_entity_id) t.client_entity_id, t.channel, t.created_at,
                e.full_name AS by_name
           FROM hsdg.tds_reminders t
           LEFT JOIN hsdg.employee_names e ON e.id = t.sent_by_employee_id
          WHERE t.financial_year = $1 AND t.client_entity_id = ANY($2::uuid[])
          ORDER BY t.client_entity_id, t.created_at DESC`,
        [financialYear, clientIds],
      );
      for (const s of sent) {
        lastReminder.set(s.client_entity_id, {
          channel: s.channel,
          at: s.created_at.toISOString(),
          byName: s.by_name,
        });
      }
    }
    const clients: TdsClientMismatch[] = clientIds
      .map((id) => {
        const nb = notBooked.filter((c) => c.client_id === id).map(creditLine);
        const ms = late.filter((r) => r.client_entity_id === id).map(bookedLine);
        const aw = awaitedOf(id);
        return {
          clientId: id,
          clientName: clientName.get(id) ?? '',
          tans: tans.get(id) ?? [],
          notBooked: nb,
          notBookedTotal: sumAmounts(nb.map((c) => c.tdsDeposited)),
          missing: ms,
          missingTotal: sumAmounts(ms.map((r) => r.tdsAmount)),
          awaited: aw,
          awaitedTotal: sumAmounts(aw.map((r) => r.tdsAmount)),
          lastReminder: lastReminder.get(id) ?? null,
        };
      })
      .sort(
        (a, b) =>
          Number(toPaise(b.missingTotal) - toPaise(a.missingTotal)) ||
          Number(toPaise(b.notBookedTotal) - toPaise(a.notBookedTotal)) ||
          Number(toPaise(b.awaitedTotal) - toPaise(a.awaitedTotal)) ||
          a.clientName.localeCompare(b.clientName),
      );
    const unknownDeductors = notBooked.filter((c) => !c.client_id).map(creditLine);

    // The period's flags, risks and notes, by client.
    const byClient = new Map<
      string,
      { clientId: string | null; clientName: string; checks: TdsCheck[] }
    >();
    const addChecks = (clientId: string | null, name: string, checks: TdsCheck[]): void => {
      if (!checks.length) return;
      const key = clientId ?? '';
      let entry = byClient.get(key);
      if (!entry) byClient.set(key, (entry = { clientId, clientName: name, checks: [] }));
      for (const c of checks) {
        if (!entry.checks.some((x) => x.message === c.message)) entry.checks.push(c);
      }
    };
    for (const m of matched) {
      for (const c of m.credits)
        if (inScope(c.transactionDate)) addChecks(m.clientId, m.clientName, c.checks);
      for (const r of m.receipts)
        if (inScope(r.receivedOn)) addChecks(m.clientId, m.clientName, r.checks);
    }
    for (const row of clients) {
      for (const c of row.notBooked) addChecks(row.clientId, row.clientName, c.checks);
      for (const r of [...row.missing, ...row.awaited])
        addChecks(row.clientId, row.clientName, r.checks);
    }
    for (const c of unknownDeductors) addChecks(null, 'TANs on no client', c.checks);
    const checks = [...byClient.values()].sort(
      (a, b) =>
        Number(a.clientId === null) - Number(b.clientId === null) ||
        a.clientName.localeCompare(b.clientName),
    );

    const scopedCredits = creditRows.filter((c) => inScope(c.transaction_date));
    const scopedReceipts = receiptRows.filter((r) => inScope(r.received_on));
    const notes: string[] = [];
    if (!asOn) {
      notes.push(
        `No 26AS imported for ${financialYear} yet: until one is, TDS whose return is long past due shows as missing.`,
      );
    }
    const pending = matched
      .flatMap((m) => m.credits)
      .filter((c) => c.bookingStatus && c.bookingStatus !== 'F').length;
    if (pending) {
      notes.push(
        `${pending} matched credit${pending === 1 ? ' is' : 's are'} not final in TRACES (status P or U): the deductor's challan does not match yet, so the credit may not be available.`,
      );
    }
    const noTan = clients.filter((c) => c.tans.length === 0).length;
    if (noTan) {
      notes.push(
        `${noTan} client${noTan === 1 ? ' has' : 's have'} no TAN on file; add it under the client's registrations so their TDS can match.`,
      );
    }
    const unpaired = negatives.filter((n) => !reversed.has(n.id) && inScope(n.transaction_date));
    if (unpaired.length) {
      notes.push(
        `${unpaired.length} reversal${unpaired.length === 1 ? '' : 's'} in the 26AS cancel${unpaired.length === 1 ? 's' : ''} no credit of the same amount: see ${unpaired.map((n) => n.deductor_name).join(', ')} on TRACES.`,
      );
    }
    const seenTans = [...new Set(creditRows.map((c) => c.deductor_tan))];
    if (seenTans.length) {
      const { rows: shared } = await client.query<{ tan: string }>(
        `SELECT tan
           FROM hsdg.client_tans
          WHERE tan = ANY($1::text[])
          GROUP BY 1 HAVING count(DISTINCT entity_id) > 1
          ORDER BY 1`,
        [seenTans],
      );
      if (shared.length) {
        notes.push(
          `${shared.map((t) => t.tan).join(', ')} ${shared.length === 1 ? 'is' : 'are'} on more than one client: the credit goes to the active registration, then a client you bill, then the oldest. Take the TAN off the client it does not belong to.`,
        );
      }
    }

    return {
      financialYear,
      quarter,
      tolerance,
      pan: imports[0]?.pan ?? null,
      asOn,
      imports,
      matched,
      clients,
      unknownDeductors,
      totals: {
        credited: sumAmounts(scopedCredits.map((c) => c.tds_deposited)),
        booked: sumAmounts(scopedReceipts.map((r) => r.tds_amount)),
        // Only the period's own lines of a group that reaches across its edge.
        matched: sumAmounts(
          matched.flatMap((m) =>
            m.credits.filter((c) => inScope(c.transactionDate)).map((c) => c.tdsDeposited),
          ),
        ),
        notBooked: sumAmounts(notBooked.map((c) => c.tds_deposited)),
        missing: sumAmounts(late.map((r) => r.tds_amount)),
        awaited: sumAmounts([...awaited.values()].map((r) => r.tdsAmount)),
      },
      checks,
      notes,
    };
  }
}

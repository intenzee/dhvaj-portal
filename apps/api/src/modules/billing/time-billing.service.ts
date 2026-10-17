import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NO_STREAM_KEY,
  STREAM_LABEL,
  hoursOf,
  timeBillingLines,
  type BillableTimeEntry,
  type BillableTimeReport,
  type BillableTimeStatus,
  type DraftFromTimeInput,
  type InvoiceDetail,
  type InvoiceStatus,
  type InvoiceTimeEntry,
  type Stream,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { CommercialService, translateInvoiceError } from '../commercial/commercial.service';

/** More entries than this in one range is a range to narrow. */
const MAX_ENTRIES = 2000;

interface EntryRow {
  entry_id: string;
  employee_id: string;
  employee_name: string;
  worked_on: string;
  seconds: number;
  stream: string | null;
  task_title: string | null;
  category: string | null;
  note: string | null;
  pending: boolean;
  billed_invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: InvoiceStatus | null;
  invoice_line_id: string | null;
  rate_per_hour: string | null;
}

/**
 * Effective, stopped, billable time of an engagement keyed by the ORIGINAL
 * entry (an approved correction stands in for its original), with the live
 * invoice each is on. $1 engagement; $2/$3 IST date range; $4 entry ids.
 */
const ENTRY_SELECT = `
  SELECT e.entry_id, e.employee_id, COALESCE(emp.full_name, 'Team member') AS employee_name,
         (e.started_at AT TIME ZONE 'Asia/Kolkata')::date::text AS worked_on,
         e.duration_seconds AS seconds, sv.stream,
         (SELECT t.title FROM hsdg.tasks t WHERE t.id = e.task_id) AS task_title,
         e.category, COALESCE(e.note, o.note) AS note,
         EXISTS (SELECT 1 FROM hsdg.engagement_time_entries a
                  WHERE a.adjusts_entry_id = e.entry_id AND a.adjustment_status = 'pending') AS pending,
         tb.billed_invoice_id, i.invoice_number, i.status AS invoice_status, tb.invoice_line_id,
         tb.rate_per_hour::text
    FROM (SELECT COALESCE(te.adjusts_entry_id, te.id) AS entry_id, te.*
            FROM hsdg.effective_time_entries te
           WHERE te.engagement_id = $1 AND te.ended_at IS NOT NULL AND te.is_billable
             AND te.duration_seconds > 0) e
    JOIN hsdg.engagement_time_entries o ON o.id = e.entry_id
    LEFT JOIN hsdg.employees emp ON emp.id = e.employee_id
    LEFT JOIN hsdg.engagement_services es ON es.id = e.engagement_service_id
    LEFT JOIN hsdg.services sv ON sv.id = es.service_id
    LEFT JOIN hsdg.time_billings tb ON tb.time_entry_id = e.entry_id AND tb.released_at IS NULL
    LEFT JOIN hsdg.invoices i ON i.id = tb.billed_invoice_id
   WHERE ($2::date IS NULL OR (e.started_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date)
     AND ($3::date IS NULL OR (e.started_at AT TIME ZONE 'Asia/Kolkata')::date <= $3::date)
     AND ($4::uuid[] IS NULL OR e.entry_id = ANY($4::uuid[]))
   ORDER BY e.started_at, e.entry_id
   LIMIT ${MAX_ENTRIES}`;

/**
 * Bill from time, billed once. Lists an engagement's billable time with where
 * each entry stands, and drafts an invoice from the chosen entries — a line
 * per stream at the hourly rate typed in. time_billings holds each entry put
 * on a live invoice (its billed_invoice_id), so none is billed twice; voiding
 * the invoice releases them and taking the line off the draft takes the rows
 * with it. Charge-out rate cards are PS-302.
 */
@Injectable()
export class TimeBillingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly commercial: CommercialService,
  ) {}

  report(
    ctx: RlsContext,
    engagementId: string,
    range: { from?: string; to?: string },
  ): Promise<BillableTimeReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.requireVisible(client, engagementId);
      const entries = await this.entries(client, engagementId, range, null);
      const sum = (s: BillableTimeStatus): number =>
        entries.filter((e) => e.status === s).reduce((n, e) => n + e.seconds, 0);
      return {
        engagementId,
        from: range.from ?? null,
        to: range.to ?? null,
        entries,
        unbilledSeconds: sum('unbilled'),
        billedSeconds: sum('billed'),
      };
    });
  }

  /** The chosen entries onto a new draft invoice: a line per stream at its rate. */
  draft(ctx: RlsContext, engagementId: string, input: DraftFromTimeInput): Promise<InvoiceDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      // One caller at a time takes this engagement's time; time_billings_once
      // is the backstop.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('time_billings:' || $1))`, [
        engagementId,
      ]);
      await this.requireVisible(client, engagementId);
      const wanted = [...new Set(input.entryIds)];
      const found = await this.entries(client, engagementId, {}, wanted);
      const byId = new Map(found.map((e) => [e.entryId, e]));
      const missing = wanted.filter((id) => !byId.has(id));
      if (missing.length) {
        throw new BadRequestException(
          `Not stopped, billable time on this engagement: ${count(missing.length)}.`,
        );
      }
      const billed = found.filter((e) => e.status === 'billed');
      if (billed.length) {
        throw new BadRequestException(
          `Already on a live invoice: ${billed.map(describeBilled).join('; ')}. ` +
            'Void that invoice or take the line off the draft first.',
        );
      }
      const pending = found.filter((e) => e.status === 'correction_pending');
      if (pending.length) {
        throw new BadRequestException(
          `A correction awaits a lead's approval: ${pending.map(describe).join('; ')}.`,
        );
      }
      const rates = Object.fromEntries(input.rates.map((r) => [r.stream, r.ratePerHour]));
      const { lines, unpriced, tooShort } = timeBillingLines(found, rates, input.period ?? '');
      if (unpriced.length) {
        throw new BadRequestException(`Type an hourly rate for ${unpriced.join(', ')}.`);
      }
      if (tooShort.length) {
        throw new BadRequestException(`Too little time to bill for ${tooShort.join(', ')}.`);
      }
      const period = input.period?.trim();
      const invoice = await this.commercial.createInvoiceWith(client, ctx, engagementId, {
        lines: lines.map(({ description, quantity, unitAmount, sortOrder }) => ({
          description,
          quantity,
          unitAmount,
          sortOrder,
        })),
        notes: `Billed from recorded time${period ? `, ${period}` : ''}.`,
      });
      const lineBySort = new Map(invoice.lines.map((l) => [l.sortOrder, l.id]));
      // client_entity_id is the invoice's, set by the guard.
      try {
        for (const line of lines) {
          for (const e of line.entries) {
            await client.query(
              `INSERT INTO hsdg.time_billings
                 (engagement_id, time_entry_id, seconds, rate_per_hour,
                  billed_invoice_id, invoice_line_id, created_by_employee_id)
               VALUES ($1, $2, $3, $4::numeric, $5, $6, $7)`,
              [
                engagementId,
                e.entryId,
                e.seconds,
                line.unitAmount,
                invoice.id,
                lineBySort.get(line.sortOrder),
                ctx.employeeId ?? null,
              ],
            );
          }
        }
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new BadRequestException(
            'Someone has just put some of this time on another invoice. Reload and choose again.',
          );
        }
        throw translateInvoiceError(err);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.drafted_from_time',
        objectType: 'invoice',
        objectId: invoice.id,
        after: {
          engagementId,
          entries: wanted.length,
          seconds: found.reduce((n, e) => n + e.seconds, 0),
          lines: lines.map((l) => ({ stream: l.stream, hours: l.quantity, rate: l.unitAmount })),
        },
      });
      return invoice;
    });
  }

  /** The time each line of an invoice covers (released once the invoice is voided). */
  invoiceTime(ctx: RlsContext, invoiceId: string): Promise<InvoiceTimeEntry[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const inv = await client.query(`SELECT 1 FROM hsdg.invoices WHERE id = $1`, [invoiceId]);
      if (!inv.rows[0]) throw new NotFoundException('Invoice not found.');
      const { rows } = await client.query<{
        invoice_line_id: string;
        time_entry_id: string;
        employee_name: string;
        worked_on: string;
        seconds: number;
        rate_per_hour: string;
        released: boolean;
      }>(
        `SELECT tb.invoice_line_id, tb.time_entry_id,
                COALESCE(emp.full_name, 'Team member') AS employee_name,
                (te.started_at AT TIME ZONE 'Asia/Kolkata')::date::text AS worked_on,
                tb.seconds, tb.rate_per_hour::text, tb.released_at IS NOT NULL AS released
           FROM hsdg.time_billings tb
           JOIN hsdg.engagement_time_entries te ON te.id = tb.time_entry_id
           LEFT JOIN hsdg.employees emp ON emp.id = te.employee_id
          WHERE tb.billed_invoice_id = $1
          ORDER BY te.started_at, tb.time_entry_id`,
        [invoiceId],
      );
      return rows.map((r) => ({
        lineId: r.invoice_line_id,
        entryId: r.time_entry_id,
        employeeName: r.employee_name,
        workedOn: r.worked_on,
        seconds: r.seconds,
        ratePerHour: r.rate_per_hour,
        released: r.released,
      }));
    });
  }

  private async entries(
    client: PoolClient,
    engagementId: string,
    range: { from?: string; to?: string },
    ids: string[] | null,
  ): Promise<BillableTimeEntry[]> {
    const { rows } = await client.query<EntryRow>(ENTRY_SELECT, [
      engagementId,
      range.from ?? null,
      range.to ?? null,
      ids,
    ]);
    return rows.map(mapEntry);
  }

  private async requireVisible(client: PoolClient, engagementId: string): Promise<void> {
    const { rows } = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
      engagementId,
    ]);
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
  }
}

function mapEntry(r: EntryRow): BillableTimeEntry {
  const stream = r.stream ?? NO_STREAM_KEY;
  return {
    entryId: r.entry_id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    workedOn: r.worked_on,
    seconds: r.seconds,
    stream,
    streamLabel: STREAM_LABEL[stream as Stream] ?? (r.stream ? r.stream : 'No stream'),
    taskTitle: r.task_title,
    category: r.category,
    note: r.note,
    status: r.billed_invoice_id ? 'billed' : r.pending ? 'correction_pending' : 'unbilled',
    invoiceId: r.billed_invoice_id,
    invoiceNumber: r.invoice_number,
    invoiceStatus: r.invoice_status,
    invoiceLineId: r.invoice_line_id,
    billedRatePerHour: r.rate_per_hour,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Asha Rao, 12 Sep 2026, 1.50 h". */
function describe(e: BillableTimeEntry): string {
  const [y, m, d] = e.workedOn.split('-');
  return `${e.employeeName}, ${Number(d)} ${MONTHS[Number(m) - 1]} ${y}, ${hoursOf(e.seconds)} h`;
}

/** "… on INV/26-27/0004", or "… on a draft invoice". */
function describeBilled(e: BillableTimeEntry): string {
  return `${describe(e)} on ${e.invoiceNumber ?? 'a draft invoice'}`;
}

function count(n: number): string {
  return n === 1 ? '1 entry' : `${n} entries`;
}

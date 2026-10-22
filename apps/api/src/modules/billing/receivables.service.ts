import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  canRemindBy,
  invoiceReminderText,
  reminderChannelFor,
  whatsappUrl,
  type InvoiceReminderRecord,
  type InvoiceReminderResult,
  type ReceivablesReport,
  type RemindInvoiceInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { workflowPolicy } from '../workflow-settings/workflow-policy';
import { buildReceivables, type OpenReceivable } from './receivables';

/** Days since the due date (else the issue date), counted to today in IST. */
export const DAYS_PAST_DUE_SQL = (alias: string): string =>
  `(timezone('Asia/Kolkata', now())::date - COALESCE(${alias}.due_date, ${alias}.issue_date))`;

interface RemindRow {
  id: string;
  invoice_number: string | null;
  engagement_id: string;
  client_entity_id: string;
  client_name: string;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  balance: string;
  days_past_due: number;
  client_email: string | null;
  client_phone: string | null;
  firm_name: string;
}

/**
 * PS-203 · who owes what and for how long, and chasing it in one click: the
 * receivables report over the open invoices the caller bills (RLS), and a
 * payment reminder on the client-chase channels (PS-001) — e-mailed, a
 * WhatsApp link, or text to copy — logged on the invoice.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  report(ctx: RlsContext): Promise<ReceivablesReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: today } = await client.query<{ d: string }>(
        `SELECT timezone('Asia/Kolkata', now())::date::text AS d`,
      );
      const { rows } = await client.query<{
        id: string;
        invoice_number: string | null;
        engagement_id: string;
        client_entity_id: string;
        client_name: string;
        partner_id: string | null;
        partner_name: string | null;
        due_date: string | null;
        days_past_due: number;
        balance: string;
      }>(
        `SELECT i.id, i.invoice_number, i.engagement_id, i.client_entity_id,
                ent.legal_name AS client_name, eng.engagement_partner_id AS partner_id,
                ep.full_name AS partner_name, i.due_date::text,
                ${DAYS_PAST_DUE_SQL('i')} AS days_past_due,
                (i.total - i.amount_settled)::text AS balance
           FROM hsdg.invoices i
           JOIN hsdg.entity_billing_profiles ent ON ent.id = i.client_entity_id
           LEFT JOIN hsdg.engagement_billing_headers eng ON eng.id = i.engagement_id
           LEFT JOIN hsdg.employee_names ep ON ep.id = eng.engagement_partner_id
          WHERE i.status IN ('issued', 'partially_paid') AND i.total > i.amount_settled`,
      );
      const open: OpenReceivable[] = rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        engagementId: r.engagement_id,
        clientId: r.client_entity_id,
        clientName: r.client_name,
        partnerId: r.partner_id,
        partnerName: r.partner_name,
        dueDate: r.due_date,
        daysPastDue: Number(r.days_past_due ?? 0),
        balance: r.balance,
      }));
      const clientIds = [...new Set(open.map((o) => o.clientId))];
      const last = new Map<string, { date: string; amount: string }>();
      if (clientIds.length) {
        const { rows: receipts } = await client.query<{
          client_entity_id: string;
          date: string;
          amount: string;
        }>(
          `SELECT DISTINCT ON (r.client_entity_id) r.client_entity_id,
                  r.received_on::text AS date, r.gross_amount AS amount
             FROM hsdg.receipts r
            WHERE r.status = 'posted' AND r.client_entity_id = ANY($1::uuid[])
            ORDER BY r.client_entity_id, r.received_on DESC, r.created_at DESC`,
          [clientIds],
        );
        for (const r of receipts) last.set(r.client_entity_id, { date: r.date, amount: r.amount });
      }
      return buildReceivables(today[0]!.d, open, last);
    });
  }

  /** Remind the client of an open invoice on the firm's channel, or the one asked for. */
  remind(
    ctx: RlsContext,
    invoiceId: string,
    input: RemindInvoiceInput,
  ): Promise<InvoiceReminderResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const inv = await this.load(client, invoiceId);
      if (!['issued', 'partially_paid'].includes(inv.status)) {
        throw new BadRequestException('Only an issued, unpaid invoice needs a reminder.');
      }
      const reach = {
        canEmail: Boolean(inv.client_email) && this.notifications.hasExternalChannels,
        phone: inv.client_phone,
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
      const text = invoiceReminderText({
        clientName: inv.client_name,
        invoiceNumber: inv.invoice_number,
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        balance: inv.balance,
        daysPastDue: inv.days_past_due,
        firmName: inv.firm_name,
      });
      if (channel === 'email') {
        await this.notifications.enqueueClientDeliveryWith(client, {
          recipientEmail: inv.client_email,
          type: NOTIFICATION_TYPE.invoiceOverdue,
          title: `Payment reminder — ${inv.invoice_number ?? 'invoice'}`,
          body: text,
          engagementId: inv.engagement_id,
        });
      }
      await client.query(
        `INSERT INTO hsdg.invoice_reminders
           (invoice_id, client_entity_id, engagement_id, channel, days_past_due,
            sent_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          inv.id,
          inv.client_entity_id,
          inv.engagement_id,
          channel,
          inv.days_past_due,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.client_reminded',
        objectType: 'invoice',
        objectId: inv.id,
        after: { channel, fallback, requested: requested ?? null, balance: inv.balance },
      });
      const common = { invoiceId: inv.id, client: inv.client_name, text };
      if (channel === 'email') return { ...common, channel, to: inv.client_email as string };
      if (channel === 'whatsapp') {
        return { ...common, channel, waUrl: whatsappUrl(inv.client_phone, text) as string };
      }
      return { ...common, channel: 'copy', fallback };
    });
  }

  /** The reminders sent about an invoice, newest first. */
  reminders(ctx: RlsContext, invoiceId: string): Promise<InvoiceReminderRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.load(client, invoiceId);
      const { rows } = await client.query<{
        id: string;
        channel: InvoiceReminderRecord['channel'];
        auto_at_days: number | null;
        days_past_due: number | null;
        sent_by_name: string | null;
        created_at: Date;
      }>(
        `SELECT r.id, r.channel, r.auto_at_days, r.days_past_due,
                e.full_name AS sent_by_name, r.created_at
           FROM hsdg.invoice_reminders r
           LEFT JOIN hsdg.employee_names e ON e.id = r.sent_by_employee_id
          WHERE r.invoice_id = $1
          ORDER BY r.created_at DESC`,
        [invoiceId],
      );
      return rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        automatic: r.auto_at_days !== null,
        daysPastDue: r.days_past_due,
        sentByName: r.sent_by_name,
        createdAt: r.created_at.toISOString(),
      }));
    });
  }

  private async load(client: PoolClient, invoiceId: string): Promise<RemindRow> {
    const { rows } = await client.query<RemindRow>(
      `SELECT i.id, i.invoice_number, i.engagement_id, i.client_entity_id,
              ent.legal_name AS client_name, i.status, i.issue_date::text, i.due_date::text,
              (i.total - i.amount_settled)::text AS balance,
              ${DAYS_PAST_DUE_SQL('i')} AS days_past_due,
              ent.contact_email AS client_email, ent.contact_phone AS client_phone,
              (SELECT f.firm_name FROM hsdg.firm_settings f LIMIT 1) AS firm_name
         FROM hsdg.invoices i
         JOIN hsdg.entity_billing_profiles ent ON ent.id = i.client_entity_id
        WHERE i.id = $1`,
      [invoiceId],
    );
    if (!rows[0]) throw new NotFoundException('Invoice not found.');
    return { ...rows[0], days_past_due: Number(rows[0].days_past_due ?? 0) };
  }
}

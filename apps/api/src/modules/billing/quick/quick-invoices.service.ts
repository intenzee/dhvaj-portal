import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  INVOICE_SEND_CHANNEL,
  INVOICE_SHARE_LINK_DAYS,
  INVOICE_STATUS,
  invoiceMailtoUrl,
  invoiceSendText,
  quickInvoiceDescription,
  whatsappNumber,
  whatsappUrl,
  type InvoiceSendOptions,
  type InvoiceSendRecord,
  type InvoiceService,
  type InvoiceShareInfo,
  type QuickInvoiceInput,
  type QuickInvoiceResult,
  type RecurringInvoiceSchedule,
  type SendInvoiceInput,
  type SendInvoiceResult,
} from '@hsdg/contracts';
import { AppConfigService } from '../../../config/config.module';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { AuditService } from '../../audit/audit.service';
import { CommercialService } from '../../commercial/commercial.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../../documents/storage/storage-provider';
import { istToday } from '../../engagements/time/auto-time';
import { NotificationsService } from '../../notifications/notifications.service';

export const sha256Hex = (v: string): string => createHash('sha256').update(v).digest('hex');

interface ScheduleRow {
  id: string;
  engagement_service_id: string;
  description: string | null;
  amount: string;
  gst_rate: string;
  day_of_month: number;
  mode: RecurringInvoiceSchedule['mode'];
  next_run_on: string;
  last_run_on: string | null;
  last_invoice_id: string | null;
  last_error: string | null;
  version: number;
}

export const SCHEDULE_COLUMNS = `r.id, r.engagement_service_id, r.description, r.amount::text,
  r.gst_rate::text, r.day_of_month, r.mode, r.next_run_on::text, r.last_run_on::text,
  r.last_invoice_id, r.last_error, r.version`;

export function mapSchedule(r: ScheduleRow): RecurringInvoiceSchedule {
  return {
    id: r.id,
    engagementServiceId: r.engagement_service_id,
    description: r.description,
    amount: r.amount,
    gstRate: Number(r.gst_rate),
    dayOfMonth: r.day_of_month,
    mode: r.mode,
    nextRunOn: r.next_run_on,
    lastRunOn: r.last_run_on,
    lastInvoiceId: r.last_invoice_id,
    lastError: r.last_error,
    version: r.version,
  };
}

/** Who issues: the caller's permissions, and whether a void needs a reason. */
export interface IssueCaller {
  permissions: readonly string[];
  reasonRequired: boolean;
}

interface SendRow {
  id: string;
  engagement_id: string;
  invoice_number: string | null;
  status: string;
  total: string;
  due_date: string | null;
  has_pdf: boolean;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  firm_name: string;
}

/**
 * Quick invoices: a one-row invoice from a service already on the engagement
 * (issued at once when the caller may), sending it to the client — e-mail
 * through the outbox, a WhatsApp link, or the biller's own mail app, each with
 * a signed 30-day PDF link — and the public read of that link.
 */
@Injectable()
export class QuickInvoicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly commercial: CommercialService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /** The engagement's live services, each with its monthly schedule (if any). */
  services(ctx: RlsContext, engagementId: string): Promise<InvoiceService[]> {
    return this.db.withRlsContext(ctx, (client) => this.servicesWith(client, engagementId));
  }

  async servicesWith(client: PoolClient, engagementId: string): Promise<InvoiceService[]> {
    const { rows } = await client.query<
      ScheduleRow & {
        es_id: string;
        name: string;
        stream: string | null;
        financial_year: string | null;
        period_label: string | null;
        has_schedule: boolean;
      }
    >(
      `SELECT es.id AS es_id, s.name, s.stream, es.financial_year, es.period_label,
              r.id IS NOT NULL AS has_schedule, ${SCHEDULE_COLUMNS}
         FROM hsdg.engagement_services es
         JOIN hsdg.services s ON s.id = es.service_id
         LEFT JOIN hsdg.recurring_invoice_schedules r ON r.engagement_service_id = es.id
        WHERE es.engagement_id = $1 AND es.status <> 'cancelled'
        ORDER BY es.is_primary DESC, s.name, es.financial_year NULLS LAST`,
      [engagementId],
    );
    return rows.map((r) => ({
      engagementServiceId: r.es_id,
      name: r.name,
      stream: r.stream,
      financialYear: r.financial_year,
      periodLabel: r.period_label,
      schedule: r.has_schedule ? mapSchedule(r) : null,
    }));
  }

  /**
   * One line — the service, the amount, the GST rate — then issued when asked
   * and allowed. A caller who may not issue it (a partner issues a fee no
   * agreement stands behind) gets the draft and the reason.
   */
  async quick(
    ctx: RlsContext,
    engagementId: string,
    input: QuickInvoiceInput,
    caller: IssueCaller,
    today = istToday(new Date()),
  ): Promise<QuickInvoiceResult> {
    const service = (await this.services(ctx, engagementId)).find(
      (s) => s.engagementServiceId === input.engagementServiceId,
    );
    if (!service) throw new NotFoundException('That service is not on this engagement.');
    const description = input.description?.trim() || quickInvoiceDescription(service.name, today);
    const draft = await this.commercial.createInvoice(ctx, engagementId, {
      lines: [
        {
          description,
          quantity: '1',
          unitAmount: input.amount,
          gstRate: input.gstRate,
          engagementServiceId: service.engagementServiceId,
        },
      ],
    });
    if (input.issue === false) return { invoice: draft, issued: false, notIssuedReason: null };
    try {
      const invoice = await this.commercial.setStatus(
        ctx,
        engagementId,
        draft.id,
        { status: INVOICE_STATUS.issued },
        caller,
      );
      return { invoice, issued: true, notIssuedReason: null };
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof BadRequestException) {
        const res = err.getResponse();
        const message =
          typeof res === 'string'
            ? res
            : String((res as { message?: unknown }).message ?? err.message);
        return { invoice: draft, issued: false, notIssuedReason: message };
      }
      throw err;
    }
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  sendOptions(
    ctx: RlsContext,
    engagementId: string,
    invoiceId: string,
  ): Promise<InvoiceSendOptions> {
    return this.db.withRlsContext(ctx, async (client) => {
      const inv = await this.loadForSend(client, engagementId, invoiceId);
      return {
        email: inv.client_email,
        whatsappNumber: whatsappNumber(inv.client_phone),
        emailDelivery: this.notifications.hasExternalChannels,
      };
    });
  }

  send(
    ctx: RlsContext,
    engagementId: string,
    invoiceId: string,
    input: SendInvoiceInput,
  ): Promise<SendInvoiceResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const inv = await this.loadForSend(client, engagementId, invoiceId);
      if (
        inv.status === INVOICE_STATUS.draft ||
        inv.status === INVOICE_STATUS.void ||
        !inv.has_pdf
      ) {
        throw new BadRequestException('Only an issued invoice goes to the client.');
      }
      const channel = input.channel;
      if (channel !== INVOICE_SEND_CHANNEL.whatsapp && !inv.client_email) {
        throw new BadRequestException(
          'The client has no e-mail address on file — add it on the client, or send on WhatsApp.',
        );
      }
      if (channel === INVOICE_SEND_CHANNEL.whatsapp && !whatsappNumber(inv.client_phone)) {
        throw new BadRequestException(
          'The client has no phone number WhatsApp can use — add it on the client, or e-mail it.',
        );
      }
      if (channel === INVOICE_SEND_CHANNEL.email && !this.notifications.hasExternalChannels) {
        throw new BadRequestException(
          'The portal does not send e-mail yet — use Open in mail app instead.',
        );
      }
      const link = await this.mintLink(client, ctx, invoiceId);
      const { subject, text } = invoiceSendText({
        clientName: inv.client_name,
        invoiceNumber: inv.invoice_number ?? '',
        total: inv.total,
        dueDate: inv.due_date,
        firmName: inv.firm_name,
        link,
      });
      let queued = false;
      if (channel === INVOICE_SEND_CHANNEL.email) {
        queued =
          (await this.notifications.enqueueClientDeliveryWith(client, {
            recipientEmail: inv.client_email,
            type: 'invoice_sent',
            title: subject,
            body: text,
            engagementId,
          })) > 0;
      }
      const to =
        channel === INVOICE_SEND_CHANNEL.whatsapp
          ? whatsappNumber(inv.client_phone)
          : inv.client_email;
      await client.query(
        `INSERT INTO hsdg.invoice_sends (invoice_id, channel, recipient, sent_by_employee_id)
         VALUES ($1, $2, $3, $4)`,
        [invoiceId, channel, to, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'invoice.sent',
        objectType: 'invoice',
        objectId: invoiceId,
        after: { channel, to, queued },
      });
      return {
        channel,
        to,
        subject,
        text,
        link,
        waUrl:
          channel === INVOICE_SEND_CHANNEL.whatsapp ? whatsappUrl(inv.client_phone, text) : null,
        mailtoUrl:
          channel === INVOICE_SEND_CHANNEL.whatsapp
            ? null
            : invoiceMailtoUrl(inv.client_email as string, subject, text),
        queued,
      };
    });
  }

  sends(ctx: RlsContext, engagementId: string, invoiceId: string): Promise<InvoiceSendRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.loadForSend(client, engagementId, invoiceId);
      const { rows } = await client.query<{
        id: string;
        channel: InvoiceSendRecord['channel'];
        recipient: string | null;
        automatic: boolean;
        sent_by_name: string | null;
        created_at: Date;
      }>(
        `SELECT s.id, s.channel, s.recipient, s.automatic, e.full_name AS sent_by_name, s.created_at
           FROM hsdg.invoice_sends s
           LEFT JOIN hsdg.employee_names e ON e.id = s.sent_by_employee_id
          WHERE s.invoice_id = $1
          ORDER BY s.created_at DESC`,
        [invoiceId],
      );
      return rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        recipient: r.recipient,
        automatic: r.automatic,
        sentByName: r.sent_by_name,
        createdAt: r.created_at.toISOString(),
      }));
    });
  }

  private async mintLink(client: PoolClient, ctx: RlsContext, invoiceId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO hsdg.invoice_share_links (invoice_id, token_hash, expires_at, created_by_employee_id)
       VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
      [invoiceId, sha256Hex(token), INVOICE_SHARE_LINK_DAYS, ctx.employeeId ?? null],
    );
    return `${this.config.get('WEB_PUBLIC_URL').replace(/\/$/, '')}/invoice/${token}`;
  }

  private async loadForSend(
    client: PoolClient,
    engagementId: string,
    invoiceId: string,
  ): Promise<SendRow> {
    const { rows } = await client.query<SendRow>(
      `SELECT i.id, i.engagement_id, i.invoice_number, i.status, i.total::text, i.due_date::text,
              i.pdf_storage_reference IS NOT NULL AS has_pdf,
              COALESCE(p.legal_name, '') AS client_name,
              NULLIF(trim(p.contact_email), '') AS client_email,
              NULLIF(trim(p.contact_phone), '') AS client_phone,
              (SELECT f.firm_name FROM hsdg.firm_settings f LIMIT 1) AS firm_name
         FROM hsdg.invoices i
         LEFT JOIN hsdg.entity_billing_profiles p ON p.id = i.client_entity_id
        WHERE i.id = $1 AND i.engagement_id = $2`,
      [invoiceId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Invoice not found.');
    return rows[0];
  }

  // ── Public (the token is the authorisation) ──────────────────────────────

  async publicInfo(token: string): Promise<InvoiceShareInfo> {
    const row = await this.open(token, false);
    if (!row?.valid) {
      return {
        valid: false,
        invoiceNumber: null,
        issueDate: null,
        dueDate: null,
        total: null,
        balance: null,
        firmName: null,
        clientName: null,
      };
    }
    return {
      valid: true,
      invoiceNumber: row.invoice_number,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      total: row.total,
      balance: row.balance,
      firmName: row.firm_name,
      clientName: row.client_name,
    };
  }

  async publicPdf(token: string): Promise<{ filename: string; data: Buffer }> {
    const row = await this.open(token, true);
    if (!row?.valid || !row.pdf_storage_reference || !row.invoice_number) {
      throw new NotFoundException('This invoice link has expired or is no longer valid.');
    }
    return {
      filename: `${row.invoice_number.replace(/\//g, '-')}.pdf`,
      data: await this.storage.read(row.pdf_storage_reference),
    };
  }

  private async open(token: string, count: boolean) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const { rows } = await this.db.query<{
      valid: boolean;
      invoice_number: string | null;
      issue_date: string | null;
      due_date: string | null;
      total: string | null;
      balance: string | null;
      firm_name: string | null;
      client_name: string | null;
      pdf_storage_reference: string | null;
    }>(
      `SELECT valid, invoice_number, issue_date::text, due_date::text, total::text, balance::text,
              firm_name, client_name, pdf_storage_reference
         FROM hsdg.invoice_share_link_open($1, $2)`,
      [sha256Hex(token), count],
    );
    return rows[0] ?? null;
  }
}

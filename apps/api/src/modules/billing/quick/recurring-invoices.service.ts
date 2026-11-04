import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  PERMISSION,
  RECURRING_INVOICE_MODE,
  SYSTEM_ROLE,
  addMonth,
  firstRunOn,
  quickInvoiceDescription,
  type RecurringInvoiceSchedule,
  type SetRecurringInvoiceInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';

import { AuditService } from '../../audit/audit.service';
import { istToday } from '../../engagements/time/auto-time';
import { QuickInvoicesService, SCHEDULE_COLUMNS, mapSchedule } from './quick-invoices.service';

/** The next run strictly after `today`, stepping a month at a time from `from`. Pure — tested. */
export function nextAfter(from: string, today: string): string {
  let next = addMonth(from);
  while (next <= today) next = addMonth(next);
  return next;
}

/**
 * Whether the service already has an invoice (not void) for the month of
 * `day` — dated in it, or a draft made in it. A month billed by hand is not
 * billed again by the schedule.
 */
async function billedInMonth(
  client: PoolClient,
  engagementServiceId: string,
  day: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM hsdg.invoice_line_items l
       JOIN hsdg.invoices i ON i.id = l.invoice_id
      WHERE l.engagement_service_id = $1 AND i.status <> 'void'
        AND date_trunc('month', COALESCE(i.issue_date, (i.created_at AT TIME ZONE 'Asia/Kolkata')::date))
            = date_trunc('month', $2::date)
      LIMIT 1`,
    [engagementServiceId, day],
  );
  return rows.length > 0;
}

/**
 * A monthly invoice per engagement service: active (issued as is on the
 * day), manual (a draft on the day, to change and issue) or paused. The
 * daily run acts as the Managing Partner, as the other firm jobs do.
 */
@Injectable()
export class RecurringInvoicesService {
  private readonly logger = new Logger(RecurringInvoicesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly quick: QuickInvoicesService,
  ) {}

  set(
    ctx: RlsContext,
    engagementId: string,
    engagementServiceId: string,
    input: SetRecurringInvoiceInput,
    today = istToday(new Date()),
  ): Promise<RecurringInvoiceSchedule> {
    return this.db.withRlsContext(ctx, async (client) => {
      const services = await this.quick.servicesWith(client, engagementId);
      const service = services.find((s) => s.engagementServiceId === engagementServiceId);
      if (!service) throw new NotFoundException('That service is not on this engagement.');
      const before = service.schedule;
      // A new schedule, a new day, or a resume starts from the next such day:
      // months missed while paused are not billed after the fact.
      const restart =
        !before ||
        before.dayOfMonth !== input.dayOfMonth ||
        (before.mode === RECURRING_INVOICE_MODE.paused &&
          input.mode !== RECURRING_INVOICE_MODE.paused);
      let nextRunOn = restart ? firstRunOn(today, input.dayOfMonth) : before.nextRunOn;
      // "Repeat this every month" right after billing this month starts next month.
      if (restart && (await billedInMonth(client, engagementServiceId, nextRunOn))) {
        nextRunOn = addMonth(nextRunOn);
      }
      const { rows } = await client.query(
        `INSERT INTO hsdg.recurring_invoice_schedules AS r
           (engagement_id, engagement_service_id, description, amount, gst_rate, day_of_month, mode,
            next_run_on, created_by_employee_id, updated_by_employee_id)
         VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8::date, $9, $9)
         ON CONFLICT (engagement_service_id) DO UPDATE
           SET description = EXCLUDED.description, amount = EXCLUDED.amount,
               gst_rate = EXCLUDED.gst_rate, day_of_month = EXCLUDED.day_of_month,
               mode = EXCLUDED.mode, next_run_on = EXCLUDED.next_run_on,
               updated_by_employee_id = EXCLUDED.updated_by_employee_id,
               last_error = CASE WHEN EXCLUDED.mode = 'paused' THEN r.last_error ELSE NULL END,
               version = r.version + 1, updated_at = now()
         RETURNING ${SCHEDULE_COLUMNS}`,
        [
          engagementId,
          engagementServiceId,
          input.description?.trim() || null,
          input.amount,
          input.gstRate,
          input.dayOfMonth,
          input.mode,
          nextRunOn,
          ctx.employeeId ?? null,
        ],
      );
      const after = mapSchedule(rows[0]);
      await this.audit.recordWith(client, ctx, {
        action: before ? 'invoice_schedule.updated' : 'invoice_schedule.created',
        objectType: 'recurring_invoice_schedule',
        objectId: after.id,
        before: before
          ? {
              amount: before.amount,
              gstRate: before.gstRate,
              dayOfMonth: before.dayOfMonth,
              mode: before.mode,
            }
          : null,
        after: {
          amount: after.amount,
          gstRate: after.gstRate,
          dayOfMonth: after.dayOfMonth,
          mode: after.mode,
        },
      });
      return after;
    });
  }

  remove(ctx: RlsContext, engagementId: string, engagementServiceId: string): Promise<void> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `DELETE FROM hsdg.recurring_invoice_schedules
          WHERE engagement_id = $1 AND engagement_service_id = $2 RETURNING id`,
        [engagementId, engagementServiceId],
      );
      if (!rows[0]) throw new NotFoundException('That service has no monthly invoice.');
      await this.audit.recordWith(client, ctx, {
        action: 'invoice_schedule.removed',
        objectType: 'recurring_invoice_schedule',
        objectId: rows[0].id,
      });
    });
  }

  /**
   * Every schedule due on or before `today`: active → issued, manual → a
   * draft; then the next run is the next such day after today. A run that
   * could not even make the draft keeps its day and tries again tomorrow.
   */
  async runDue(
    today = istToday(new Date()),
  ): Promise<{ issued: number; drafts: number; failed: number; skipped: number }> {
    const ctx = await this.operatorContext();
    const tally = { issued: 0, drafts: 0, failed: 0, skipped: 0 };
    if (!ctx) return tally;
    const due = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        engagement_id: string;
        engagement_service_id: string;
        description: string | null;
        service_name: string;
        amount: string;
        gst_rate: string;
        mode: string;
        next_run_on: string;
      }>(
        `SELECT r.id, r.engagement_id, r.engagement_service_id, r.description, s.name AS service_name,
                r.amount::text, r.gst_rate::text, r.mode, r.next_run_on::text
           FROM hsdg.recurring_invoice_schedules r
           JOIN hsdg.engagement_services es ON es.id = r.engagement_service_id
           JOIN hsdg.services s ON s.id = es.service_id
          WHERE r.mode <> 'paused' AND r.next_run_on <= $1::date AND es.status <> 'cancelled'
          ORDER BY r.next_run_on, r.id`,
        [today],
      );
      return rows;
    });
    const caller = {
      permissions: [PERMISSION.billingManage, PERMISSION.billingApprove],
      reasonRequired: false,
    };
    for (const s of due) {
      let invoiceId: string | null = null;
      let error: string | null = null;
      let made = false;
      const already = await this.db.withRlsContext(ctx, (client) =>
        billedInMonth(client, s.engagement_service_id, s.next_run_on),
      );
      if (already) {
        // Billed by hand this month: skip to the next month, no second invoice.
        await this.db.withRlsContext(ctx, (client) =>
          client.query(
            `UPDATE hsdg.recurring_invoice_schedules
                SET last_error = NULL, next_run_on = $2::date WHERE id = $1`,
            [s.id, nextAfter(s.next_run_on, today)],
          ),
        );
        tally.skipped += 1;
        continue;
      }
      try {
        const res = await this.quick.quick(
          ctx,
          s.engagement_id,
          {
            engagementServiceId: s.engagement_service_id,
            amount: s.amount,
            gstRate: Number(s.gst_rate) as 18,
            description: quickInvoiceDescription(s.description ?? s.service_name, s.next_run_on),
            issue: s.mode === RECURRING_INVOICE_MODE.active,
          },
          caller,
          s.next_run_on,
        );
        made = true;
        invoiceId = res.invoice.id;
        if (res.issued) tally.issued += 1;
        else tally.drafts += 1;
        if (s.mode === RECURRING_INVOICE_MODE.active && !res.issued) {
          error = `Left as a draft: ${res.notIssuedReason ?? 'it could not be issued.'}`;
        }
      } catch (err) {
        tally.failed += 1;
        error = (err as Error).message;
        this.logger.warn(`Monthly invoice ${s.id} failed: ${error}`);
      }
      await this.db.withRlsContext(ctx, (client) =>
        client.query(
          `UPDATE hsdg.recurring_invoice_schedules
              SET last_error = $2,
                  last_run_on = CASE WHEN $3 THEN $4::date ELSE last_run_on END,
                  last_invoice_id = COALESCE($5, last_invoice_id),
                  next_run_on = CASE WHEN $3 THEN $6::date ELSE next_run_on END
            WHERE id = $1`,
          [s.id, error, made, today, invoiceId, nextAfter(s.next_run_on, today)],
        ),
      );
    }
    return tally;
  }

  private async operatorContext(): Promise<RlsContext | null> {
    return this.db.withRlsContext(
      { userId: '', role: SYSTEM_ROLE, officeId: '' },
      async (client) => {
        const { rows } = await client.query<{
          user_id: string;
          office_id: string;
          employee_id: string | null;
        }>(
          `SELECT u.id AS user_id, u.primary_office_id AS office_id, emp.id AS employee_id
           FROM hsdg.users u
           JOIN hsdg.user_roles ur ON ur.user_id = u.id
           JOIN hsdg.roles r ON r.id = ur.role_id
           LEFT JOIN hsdg.employees emp ON emp.user_id = u.id
          WHERE r.slug = 'managing_partner' AND u.is_active = true
          ORDER BY u.created_at
          LIMIT 1`,
        );
        const row = rows[0];
        if (!row) return null;
        return {
          userId: row.user_id,
          role: 'managing_partner',
          officeId: row.office_id,
          ...(row.employee_id ? { employeeId: row.employee_id } : {}),
        };
      },
    );
  }
}

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { NOTIFICATION_TYPE, SYSTEM_ROLE } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AppConfigService } from '../../config/config.module';
import { NotificationsService } from '../notifications/notifications.service';
import { ClientUploadService } from '../documents/client-upload/client-upload.service';
import { istToday } from '../engagements/time/auto-time';
import { periodLabel } from './filing-rules';

/** Marks the request so a re-run on the same day never asks twice. */
export const MONTHLY_REQUEST_PREFIX = 'Monthly data request — ';
const ITEMS = 'Sales register; Purchase register; Bank statement';

/** The month before `today` (YYYY-MM-DD) as a period key, and the 5th of this month. */
export function previousMonth(today: string): { periodKey: string; dueBy: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return {
    periodKey: `${py}-${String(pm).padStart(2, '0')}`,
    dueBy: `${today.slice(0, 7)}-05`,
  };
}

export interface MonthlyRequestResult {
  periodKey: string;
  requested: number;
  linked: number;
  emailed: number;
}

/**
 * Change 6 — the monthly data request. On the 1st, every GSTIN whose
 * compliance profile has `monthlyDataRequest` on gets ONE client request for
 * last month's sales register, purchase register and bank statement, filed
 * against that month's Outward filing (internal due date the 5th, firm
 * policy), with a secure upload link e-mailed to the client's primary contact
 * when client upload is enabled. Idempotent per GSTIN and month.
 *
 * Identity mirrors the other schedulers: the first active managing partner.
 */
@Injectable()
export class MonthlyDataRequestScheduler implements OnModuleInit {
  private readonly logger = new Logger(MonthlyDataRequestScheduler.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly notifications: NotificationsService,
    private readonly uploads: ClientUploadService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('SCHEDULER_ENABLED')) return;
    const job = new CronJob(this.config.get('SCHEDULER_GST_DATA_REQUEST_CRON'), () => {
      void this.run();
    });
    this.registry.addCronJob(
      'gst-monthly-data-request',
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
    job.start();
  }

  /** One pass. Public for the HTTP cron trigger and tests. */
  async run(now: Date = new Date()): Promise<MonthlyRequestResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const ctx = await this.operatorContext();
      if (!ctx) {
        this.logger.warn('No active managing partner found; monthly data request skipped.');
        return null;
      }
      const res = await this.requestFor(ctx, istToday(now));
      if (res.requested) {
        this.logger.log(
          `Monthly data request ${res.periodKey}: ${res.requested} request(s), ${res.emailed} e-mailed.`,
        );
      }
      return res;
    } catch (err) {
      const e = err as Error;
      this.logger.error(`Monthly data request failed: ${e.message}`, e.stack);
      return null;
    } finally {
      this.running = false;
    }
  }

  async requestFor(ctx: RlsContext, today: string): Promise<MonthlyRequestResult> {
    const { periodKey, dueBy } = previousMonth(today);
    const what = `${MONTHLY_REQUEST_PREFIX}${periodLabel(periodKey)}`;
    const created = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        dependency_id: string;
        engagement_id: string;
        engagement_code: string;
        registration_number: string;
        client_email: string | null;
      }>(
        `WITH due AS (
           SELECT DISTINCT ON (ci.registration_id)
                  ci.id AS instance_id, ci.engagement_id, ci.engagement_service_id, ci.section,
                  e.engagement_code, e.engagement_manager_id, e.engagement_partner_id, e.entity_id,
                  r.registration_number
             FROM hsdg.compliance_instances ci
             JOIN hsdg.engagements e ON e.id = ci.engagement_id
             JOIN hsdg.entity_registrations r ON r.id = ci.registration_id
             JOIN LATERAL (
               SELECT p.attributes FROM hsdg.registration_compliance_profiles p
                WHERE p.registration_id = ci.registration_id AND p.effective_from <= $2::date
                  AND (p.effective_to IS NULL OR p.effective_to >= $2::date)
                ORDER BY p.effective_from DESC LIMIT 1) p ON true
            WHERE ci.period_key = $1 AND ci.section = 'outward'
              AND ci.workflow_status NOT IN ('filed','not_applicable')
              AND e.status NOT IN ('completed','closed','cancelled','declined','withdrawn','merged')
              AND (p.attributes ->> 'monthlyDataRequest')::boolean IS TRUE
              AND NOT EXISTS (
                SELECT 1 FROM hsdg.client_dependencies d
                  JOIN hsdg.compliance_instances di ON di.id = d.compliance_instance_id
                 WHERE di.registration_id = ci.registration_id AND di.period_key = $1
                   AND d.requested_info LIKE $4 || '%')
            ORDER BY ci.registration_id, ci.created_at
         ), ins AS (
           INSERT INTO hsdg.client_dependencies
             (engagement_id, requested_info, outstanding_items, responsible_employee_id,
              escalation_date, engagement_service_id, compliance_instance_id, period_section,
              task_id)
           SELECT d.engagement_id, $3, $6,
                  COALESCE(t.assigned_to_employee_id, d.engagement_manager_id, d.engagement_partner_id),
                  $5::date,
                  d.engagement_service_id, d.instance_id, d.section, t.id
             FROM due d
             LEFT JOIN LATERAL (
               SELECT t.id, t.assigned_to_employee_id FROM hsdg.tasks t
                WHERE t.source_compliance_instance_id = d.instance_id AND t.status <> 'cancelled'
                ORDER BY t.created_at DESC LIMIT 1) t ON true
           RETURNING id, engagement_id, compliance_instance_id
         )
         SELECT ins.id AS dependency_id, ins.engagement_id, d.engagement_code, d.registration_number,
                (SELECT c.email::text FROM hsdg.entity_contacts c
                  WHERE c.entity_id = d.entity_id AND c.email IS NOT NULL
                  ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS client_email
           FROM ins JOIN due d ON d.instance_id = ins.compliance_instance_id`,
        [
          periodKey,
          today,
          `${what}: ${ITEMS.toLowerCase().replace(/; /g, ', ')}.`,
          MONTHLY_REQUEST_PREFIX,
          dueBy,
          ITEMS,
        ],
      );
      return rows;
    });

    let linked = 0;
    let emailed = 0;
    if (this.uploads.enabled) {
      const base = this.config.get('WEB_PUBLIC_URL').replace(/\/$/, '');
      for (const r of created) {
        const link = await this.uploads.createLink(ctx, r.engagement_id, r.dependency_id, {});
        linked += 1;
        emailed += await this.db.withRlsContext(ctx, (client) =>
          this.notifications.enqueueClientDeliveryWith(client, {
            recipientEmail: r.client_email,
            type: NOTIFICATION_TYPE.clientDependencyReminder,
            title: `${what} — GSTIN ${r.registration_number}`,
            body:
              `Please upload last month's ${ITEMS.toLowerCase().replace(/; /g, ', ')} by ${dueBy} ` +
              `using this secure link (no login needed): ${base}/client-upload/${link.token}`,
            engagementId: r.engagement_id,
          }),
        );
      }
    }
    return { periodKey, requested: created.length, linked, emailed };
  }

  private async operatorContext(): Promise<RlsContext | null> {
    return this.db.withRlsContext({ userId: '', role: SYSTEM_ROLE, officeId: '' }, async (client) => {
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
    });
  }
}

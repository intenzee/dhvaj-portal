import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { NOTIFICATION_TYPE, REMINDER_CHANNEL_SETTING, SYSTEM_ROLE } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AppConfigService } from '../../config/config.module';
import { NotificationsService } from '../notifications/notifications.service';
import { ClientUploadService } from '../documents/client-upload/client-upload.service';
import { istToday } from '../engagements/time/auto-time';
import { periodLabel } from './filing-rules';
import { workflowPolicy } from '../workflow-settings/workflow-policy';
import { chasingPolicy, raiseSlotRequests, reminderText } from './client-chase';

/** The month before `today` (YYYY-MM-DD) as a period key. */
export function previousMonth(today: string): { periodKey: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return { periodKey: `${py}-${String(pm).padStart(2, '0')}` };
}

/** The GST sections whose data comes from the client each month. */
export const MONTHLY_REQUEST_SECTIONS = ['outward', 'inward'] as const;

export interface MonthlyRequestResult {
  periodKey: string;
  /** Filings that got at least one new request this run. */
  requested: number;
  /** Request items (one per client-data slot) raised this run. */
  items: number;
  linked: number;
  emailed: number;
  /**
   * Filings whose new requests were not e-mailed because the firm reminds
   * clients by WhatsApp or by hand: the team sends them from the filing.
   */
  held: number;
  failed: number;
}

interface DueFilingRow {
  instance_id: string;
  engagement_id: string;
  entity_name: string;
  form: string;
  internal_due: string | null;
  client_email: string | null;
}

/**
 * Change 6 / Staff Workflow WF-302 — the monthly data request. On the 1st,
 * every last-month Outward and Inward filing of a GSTIN whose compliance
 * profile has `monthlyDataRequest` on gets one client request per required
 * client-data slot (sales register, purchase register, …) from its own
 * checklist, dated from its internal due date (firm policy T-7 / T-3). An
 * upload into the slot closes the request (documents_close_slot_requests).
 * When client upload is enabled and the firm reminds clients by e-mail
 * (`client_reminder_channel`), the client's primary contact is e-mailed once
 * per filing with a secure link per item; under WhatsApp or copy nothing goes
 * to the client — the team sends the reminder from the filing. One transaction per filing; a slot
 * already asked for is never asked again, so a re-run is a no-op.
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
      if (res.requested || res.failed) {
        this.logger.log(
          `Monthly data request ${res.periodKey}: ${res.items} item(s) on ${res.requested} ` +
            `filing(s), ${res.emailed} e-mailed, ${res.held} held for the team, ${res.failed} failed.`,
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
    const { periodKey } = previousMonth(today);
    const result: MonthlyRequestResult = {
      periodKey,
      requested: 0,
      items: 0,
      linked: 0,
      emailed: 0,
      held: 0,
      failed: 0,
    };
    const { due, byEmail } = await this.db.withRlsContext(ctx, async (client) => {
      const byEmail =
        (await workflowPolicy(client)).clientReminderChannel === REMINDER_CHANNEL_SETTING.email;
      const { rows } = await client.query<DueFilingRow>(
        `SELECT ci.id AS instance_id, ci.engagement_id, ent.legal_name AS entity_name,
                COALESCE(ci.form_label, rv.form_label, cr.name) AS form,
                COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS internal_due,
                (SELECT c.email::text FROM hsdg.entity_contacts c
                  WHERE c.entity_id = e.entity_id AND c.email IS NOT NULL
                  ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS client_email
           FROM hsdg.compliance_instances ci
           JOIN hsdg.engagements e ON e.id = ci.engagement_id
           JOIN hsdg.entities ent ON ent.id = e.entity_id
           JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
           LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
           JOIN LATERAL (
             SELECT p.attributes FROM hsdg.registration_compliance_profiles p
              WHERE p.registration_id = ci.registration_id AND p.effective_from <= $2::date
                AND (p.effective_to IS NULL OR p.effective_to >= $2::date)
              ORDER BY p.effective_from DESC LIMIT 1) p ON true
          WHERE ci.period_key = $1 AND ci.section = ANY($3::text[])
            AND ci.workflow_status NOT IN ('filed','not_applicable')
            AND e.status NOT IN ('completed','closed','cancelled','declined','withdrawn','merged')
            AND (p.attributes ->> 'monthlyDataRequest')::boolean IS TRUE
          ORDER BY ci.registration_id, ci.section, ci.created_at`,
        [periodKey, today, MONTHLY_REQUEST_SECTIONS],
      );
      return { due: rows, byEmail };
    });

    const base = this.config.get('WEB_PUBLIC_URL').replace(/\/$/, '');
    for (const f of due) {
      try {
        const raised = await this.db.withRlsContext(ctx, async (client) =>
          raiseSlotRequests(client, f.instance_id, {
            today,
            createdBy: null,
            policy: await chasingPolicy(client),
          }),
        );
        if (raised.length === 0) continue;
        result.requested += 1;
        result.items += raised.length;
        if (!byEmail) {
          result.held += 1;
          continue;
        }
        if (!this.uploads.enabled) continue;
        const items: { label: string; uploadUrl: string }[] = [];
        for (const r of raised) {
          const link = await this.uploads.createLink(ctx, f.engagement_id, r.dependencyId, {});
          result.linked += 1;
          items.push({ label: r.label, uploadUrl: `${base}/client-upload/${link.token}` });
        }
        result.emailed += await this.db.withRlsContext(ctx, (client) =>
          this.notifications.enqueueClientDeliveryWith(client, {
            recipientEmail: f.client_email,
            type: NOTIFICATION_TYPE.clientDependencyReminder,
            title: `Documents needed — ${f.form} ${periodLabel(periodKey)}`,
            body: reminderText({
              entityName: f.entity_name,
              formLabel: f.form,
              periodKey,
              items,
              dueBy: f.internal_due,
            }),
            engagementId: f.engagement_id,
          }),
        );
      } catch (err) {
        result.failed += 1;
        this.logger.warn(
          `Monthly data request for filing ${f.instance_id}: ${(err as Error).message}`,
        );
      }
    }
    return result;
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

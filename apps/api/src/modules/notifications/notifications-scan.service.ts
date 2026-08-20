import { Injectable } from '@nestjs/common';
import { NOTIFICATION_TYPE } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AppConfigService } from '../../config/config.module';
import { NotificationsService } from './notifications.service';

/** What one sweep produced, by event type. */
export interface ScanResult {
  internalSlaOverdue: number;
  internalSlaApproaching: number;
  statutoryDeadlineApproaching: number;
  clientDependencyReminder: number;
  total: number;
}

interface DueComplianceRow {
  id: string;
  engagement_id: string;
  engagement_code: string;
  entity_name: string;
  engagement_partner_id: string | null;
  engagement_manager_id: string | null;
  effective_sla: string;
  effective_statutory: string;
  sla_overdue: boolean;
  sla_approaching: boolean;
  statutory_approaching: boolean;
}

interface DueDependencyRow {
  id: string;
  engagement_id: string;
  engagement_code: string;
  entity_name: string;
  requested_info: string;
  responsible_employee_id: string | null;
  engagement_partner_id: string | null;
}

/**
 * The date-driven notification sweep (Phase 11). Turns the two clocks recorded
 * by Phases 8–9 into notifications: internal SLA overdue/approaching, statutory
 * deadline approaching, and client-dependency reminders. Idempotent — every
 * emission carries an object-scoped `dedupKey`, so re-running the scan never
 * duplicates a nudge.
 *
 * Reads run under the caller's RLS context, so what is scanned is exactly what
 * the caller can see; the firm-wide operator (Managing Partner) — the identity a
 * scheduled worker authenticates as — sweeps the whole firm. Recipients (the
 * engagement leads / responsible staff) are resolved and written by the
 * SECURITY DEFINER emit path regardless of the caller.
 */
@Injectable()
export class NotificationsScanService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(ctx: RlsContext): Promise<ScanResult> {
    const slaLead = this.config.get('NOTIFICATION_SLA_LEAD_DAYS');
    const deadlineLead = this.config.get('NOTIFICATION_DEADLINE_LEAD_DAYS');

    return this.db.withRlsContext(ctx, async (client) => {
      const result: ScanResult = {
        internalSlaOverdue: 0,
        internalSlaApproaching: 0,
        statutoryDeadlineApproaching: 0,
        clientDependencyReminder: 0,
        total: 0,
      };

      // ── Compliance clocks (open instances only) ──────────────────────────
      const { rows: compliance } = await client.query<DueComplianceRow>(
        `SELECT ci.id, ci.engagement_id, e.engagement_code, ent.legal_name AS entity_name,
                e.engagement_partner_id, e.engagement_manager_id,
                COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS effective_sla,
                COALESCE(ci.statutory_deadline_override, ci.statutory_deadline)::text AS effective_statutory,
                COALESCE(ci.internal_sla_override, ci.internal_sla_date) < CURRENT_DATE AS sla_overdue,
                COALESCE(ci.internal_sla_override, ci.internal_sla_date)
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int AS sla_approaching,
                COALESCE(ci.statutory_deadline_override, ci.statutory_deadline)
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + $2::int AS statutory_approaching
         FROM hsdg.compliance_instances ci
         JOIN hsdg.engagements e ON e.id = ci.engagement_id
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         WHERE ci.status = 'open'`,
        [slaLead, deadlineLead],
      );

      for (const row of compliance) {
        const leads = [row.engagement_partner_id, row.engagement_manager_id];
        const context = `${row.engagement_code} · ${row.entity_name}`;
        if (row.sla_overdue) {
          result.internalSlaOverdue += await this.notifications.emitWith(client, ctx, {
            type: NOTIFICATION_TYPE.internalSlaOverdue,
            recipientEmployeeIds: leads,
            title: `Internal SLA overdue — ${context}`,
            body: `The internal SLA date (${row.effective_sla}) has passed for ${context}.`,
            engagementId: row.engagement_id,
            objectType: 'compliance_instance',
            objectId: row.id,
            dedupKey: `sla_overdue:${row.id}`,
          });
        } else if (row.sla_approaching) {
          result.internalSlaApproaching += await this.notifications.emitWith(client, ctx, {
            type: NOTIFICATION_TYPE.internalSlaApproaching,
            recipientEmployeeIds: leads,
            title: `Internal SLA approaching — ${context}`,
            body: `The internal SLA date (${row.effective_sla}) is near for ${context}.`,
            engagementId: row.engagement_id,
            objectType: 'compliance_instance',
            objectId: row.id,
            dedupKey: `sla_approaching:${row.id}`,
          });
        }
        if (row.statutory_approaching) {
          result.statutoryDeadlineApproaching += await this.notifications.emitWith(client, ctx, {
            type: NOTIFICATION_TYPE.statutoryDeadlineApproaching,
            recipientEmployeeIds: leads,
            title: `Statutory deadline approaching — ${context}`,
            body: `The statutory deadline (${row.effective_statutory}) is near for ${context}.`,
            engagementId: row.engagement_id,
            objectType: 'compliance_instance',
            objectId: row.id,
            dedupKey: `stat_approaching:${row.id}`,
          });
        }
      }

      // ── Client-dependency reminders (open deps whose reminder date has come) ─
      const { rows: deps } = await client.query<DueDependencyRow>(
        `SELECT cd.id, cd.engagement_id, e.engagement_code, ent.legal_name AS entity_name,
                cd.requested_info, cd.responsible_employee_id, e.engagement_partner_id
         FROM hsdg.client_dependencies cd
         JOIN hsdg.engagements e ON e.id = cd.engagement_id
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         WHERE cd.status IN ('pending','partially_received')
           AND cd.reminder_date IS NOT NULL AND cd.reminder_date <= CURRENT_DATE`,
      );

      for (const row of deps) {
        const context = `${row.engagement_code} · ${row.entity_name}`;
        result.clientDependencyReminder += await this.notifications.emitWith(client, ctx, {
          type: NOTIFICATION_TYPE.clientDependencyReminder,
          // Prefer the responsible staff member; fall back to the EP.
          recipientEmployeeIds: [row.responsible_employee_id ?? row.engagement_partner_id],
          title: `Client information reminder — ${context}`,
          body: `Still awaiting from the client: ${row.requested_info}.`,
          engagementId: row.engagement_id,
          objectType: 'client_dependency',
          objectId: row.id,
          dedupKey: `dep_reminder:${row.id}`,
        });
      }

      result.total =
        result.internalSlaOverdue +
        result.internalSlaApproaching +
        result.statutoryDeadlineApproaching +
        result.clientDependencyReminder;
      return result;
    });
  }
}

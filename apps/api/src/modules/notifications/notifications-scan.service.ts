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
  statutoryDeadlineOverdue: number;
  complianceDueToday: number;
  clientCommitmentOverdue: number;
  deadlineLayerOverdue: number;
  clientDependencyOverdue: number;
  clientDependencyReminder: number;
  clientDeliveryEnqueued: number;
  total: number;
}

interface DueComplianceRow {
  id: string;
  engagement_id: string;
  engagement_code: string;
  entity_name: string;
  engagement_partner_id: string | null;
  engagement_manager_id: string | null;
  /** Frozen category (§2), joined from the obligation's rule — drives routing. */
  due_date_category: string;
  effective_sla: string;
  effective_statutory: string;
  sla_overdue: boolean;
  sla_approaching: boolean;
  statutory_approaching: boolean;
  statutory_due_today: boolean;
  statutory_overdue: boolean;
  statutory_critical: boolean;
}

interface DueLayerRow {
  id: string;
  compliance_instance_id: string;
  engagement_id: string;
  engagement_code: string;
  entity_name: string;
  layer_type: string;
  label: string;
  due_date: string;
  owner_employee_id: string | null;
  engagement_partner_id: string | null;
  engagement_manager_id: string | null;
}

interface DueDependencyRow {
  id: string;
  engagement_id: string;
  engagement_code: string;
  entity_name: string;
  requested_info: string;
  responsible_employee_id: string | null;
  engagement_partner_id: string | null;
  client_email: string | null;
  escalation_overdue: boolean;
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
    const criticalDays = this.config.get('COMPLIANCE_CRITICAL_OVERDUE_DAYS');

    return this.db.withRlsContext(ctx, async (client) => {
      const result: ScanResult = {
        internalSlaOverdue: 0,
        internalSlaApproaching: 0,
        statutoryDeadlineApproaching: 0,
        statutoryDeadlineOverdue: 0,
        complianceDueToday: 0,
        clientCommitmentOverdue: 0,
        deadlineLayerOverdue: 0,
        clientDependencyOverdue: 0,
        clientDependencyReminder: 0,
        clientDeliveryEnqueued: 0,
        total: 0,
      };

      // The firm (managing partner) — the top of the §24 escalation ladder for a
      // critically overdue statutory deadline. Loaded once, RLS-scoped.
      const { rows: mps } = await client.query<{ id: string }>(
        `SELECT DISTINCT emp.id FROM hsdg.employees emp
         JOIN hsdg.users u ON u.id = emp.user_id
         JOIN hsdg.user_roles ur ON ur.user_id = u.id
         JOIN hsdg.roles r ON r.id = ur.role_id
         WHERE r.slug = 'managing_partner' AND emp.employment_status = 'active'`,
      );
      const managingPartnerIds = mps.map((m) => m.id);

      // ── Compliance clocks (open instances only) ──────────────────────────
      // Effective statutory = manual override ▸ government extension ▸ snapshot
      // (§20 ▸ §19 ▸ §10 — matches EFFECTIVE_STATUTORY in the calendar service).
      const { rows: compliance } = await client.query<DueComplianceRow>(
        `SELECT ci.id, ci.engagement_id, e.engagement_code, ent.legal_name AS entity_name,
                e.engagement_partner_id, e.engagement_manager_id,
                cr.due_date_category,
                COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS effective_sla,
                COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)::text
                  AS effective_statutory,
                COALESCE(ci.internal_sla_override, ci.internal_sla_date) < CURRENT_DATE AS sla_overdue,
                COALESCE(ci.internal_sla_override, ci.internal_sla_date)
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int AS sla_approaching,
                COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)
                  BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + $2::int AS statutory_approaching,
                COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)
                  = CURRENT_DATE AS statutory_due_today,
                COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)
                  < CURRENT_DATE AS statutory_overdue,
                COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)
                  < CURRENT_DATE - $3::int AS statutory_critical
         FROM hsdg.compliance_instances ci
         JOIN hsdg.engagements e ON e.id = ci.engagement_id
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
         LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
         WHERE ci.status = 'open'`,
        [slaLead, deadlineLead, criticalDays],
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
        // A CLIENT_COMMITTED obligation is a contractual commitment, not a
        // statutory breach — the operative date lives in the same column, but
        // §24 routes and labels it distinctly ("Client commitment overdue").
        const isClientCommitment = row.due_date_category === 'CLIENT_COMMITTED';
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
        } else if (row.statutory_due_today) {
          // §24 Due Today → owner/reviewer emphasis (distinct from "approaching").
          result.complianceDueToday += await this.notifications.emitWith(client, ctx, {
            type: NOTIFICATION_TYPE.complianceDueToday,
            recipientEmployeeIds: leads,
            title: `Due today — ${context}`,
            body: `${isClientCommitment ? 'The committed deadline' : 'The statutory deadline'} (${row.effective_statutory}) is due TODAY for ${context}.`,
            engagementId: row.engagement_id,
            objectType: 'compliance_instance',
            objectId: row.id,
            dedupKey: `due_today:${row.id}`,
          });
        } else if (row.statutory_overdue && isClientCommitment) {
          // §24 Client commitment overdue → owner / manager (the engagement leads).
          result.clientCommitmentOverdue += await this.notifications.emitWith(client, ctx, {
            type: NOTIFICATION_TYPE.clientCommitmentOverdue,
            recipientEmployeeIds: leads,
            title: `Client commitment overdue — ${context}`,
            body: `The client-committed deadline (${row.effective_statutory}) has passed for ${context}.`,
            engagementId: row.engagement_id,
            objectType: 'compliance_instance',
            objectId: row.id,
            dedupKey: `client_commitment_overdue:${row.id}`,
          });
        } else if (row.statutory_overdue) {
          // §24 escalation ladder: overdue → engagement leads; when CRITICAL
          // (past the threshold) escalate up to the firm (managing partner).
          const recipients = row.statutory_critical ? [...leads, ...managingPartnerIds] : leads;
          const severity = row.statutory_critical ? 'CRITICAL — ' : '';
          result.statutoryDeadlineOverdue += await this.notifications.emitWith(client, ctx, {
            type: NOTIFICATION_TYPE.statutoryDeadlineOverdue,
            recipientEmployeeIds: recipients,
            title: `${severity}Statutory deadline overdue — ${context}`,
            body: `The statutory deadline (${row.effective_statutory}) has passed for ${context}.`,
            engagementId: row.engagement_id,
            objectType: 'compliance_instance',
            objectId: row.id,
            // Distinct dedup per severity, so escalating to critical emits once more.
            dedupKey: `stat_overdue${row.statutory_critical ? '_critical' : ''}:${row.id}`,
          });
        }
      }

      // ── Deadline layers (§16/§24 Review overdue → reviewer + escalation) ──
      // Each added layer (preparation, manager/EP review, PBC/fieldwork gates)
      // carries its OWN owner and due date. When one is overdue, the layer owner
      // (the reviewer/preparer) is notified first, with the engagement leads as
      // the escalation — a review milestone slipping is exactly what §24 wants
      // routed to "reviewer + escalation".
      const { rows: layers } = await client.query<DueLayerRow>(
        `SELECT d.id, d.compliance_instance_id, d.engagement_id,
                e.engagement_code, ent.legal_name AS entity_name,
                d.layer_type, d.label, d.due_date::text AS due_date, d.owner_employee_id,
                e.engagement_partner_id, e.engagement_manager_id
         FROM hsdg.compliance_instance_deadlines d
         JOIN hsdg.engagements e ON e.id = d.engagement_id
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         WHERE d.status = 'open' AND d.due_date < CURRENT_DATE`,
      );

      for (const row of layers) {
        const context = `${row.engagement_code} · ${row.entity_name}`;
        const isReview = row.layer_type === 'manager_review' || row.layer_type === 'ep_review';
        // Owner (reviewer/preparer) first; leads are the escalation. De-duped so
        // an unassigned layer still escalates to the leads.
        const recipients = [
          row.owner_employee_id,
          row.engagement_partner_id,
          row.engagement_manager_id,
        ];
        result.deadlineLayerOverdue += await this.notifications.emitWith(client, ctx, {
          type: NOTIFICATION_TYPE.deadlineLayerOverdue,
          recipientEmployeeIds: recipients,
          title: `${isReview ? 'Review' : 'Deadline layer'} overdue — ${row.label} · ${context}`,
          body: `The ${row.label} deadline (${row.due_date}) has passed for ${context}.`,
          engagementId: row.engagement_id,
          objectType: 'compliance_instance_deadline',
          objectId: row.id,
          dedupKey: `layer_overdue:${row.id}`,
        });
      }

      // ── Client-dependency reminders + PBC overdue escalation ──────────────
      // reminder_date reached → gentle reminder to the responsible staff/EP.
      // escalation_date passed → §24 "PBC overdue → client + owner": escalate to
      // the responsible owner AND the engagement partner. (Client-facing delivery
      // rides the same row via the portal's client surface.)
      const { rows: deps } = await client.query<DueDependencyRow>(
        `SELECT cd.id, cd.engagement_id, e.engagement_code, ent.legal_name AS entity_name,
                cd.requested_info, cd.responsible_employee_id, e.engagement_partner_id,
                pc.email::text AS client_email,
                (cd.escalation_date IS NOT NULL AND cd.escalation_date <= CURRENT_DATE) AS escalation_overdue
         FROM hsdg.client_dependencies cd
         JOIN hsdg.engagements e ON e.id = cd.engagement_id
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         LEFT JOIN LATERAL (
           SELECT email FROM hsdg.entity_contacts
           WHERE entity_id = ent.id AND email IS NOT NULL
           ORDER BY is_primary DESC, created_at
           LIMIT 1
         ) pc ON true
         WHERE cd.status IN ('pending','partially_received')
           AND (
             (cd.reminder_date IS NOT NULL AND cd.reminder_date <= CURRENT_DATE)
             OR (cd.escalation_date IS NOT NULL AND cd.escalation_date <= CURRENT_DATE)
           )`,
      );

      for (const row of deps) {
        const context = `${row.engagement_code} · ${row.entity_name}`;
        if (row.escalation_overdue) {
          result.clientDependencyOverdue += await this.notifications.emitWith(client, ctx, {
            type: NOTIFICATION_TYPE.clientDependencyOverdue,
            recipientEmployeeIds: [row.responsible_employee_id, row.engagement_partner_id],
            title: `PBC overdue — ${context}`,
            body: `Client information is overdue and has been escalated: ${row.requested_info}.`,
            engagementId: row.engagement_id,
            objectType: 'client_dependency',
            objectId: row.id,
            dedupKey: `dep_overdue:${row.id}`,
          });
          // §24 "PBC overdue → client + owner": also reach the CLIENT directly,
          // via the delivery outbox to their contact email (no portal row).
          result.clientDeliveryEnqueued += await this.notifications.enqueueClientDeliveryWith(
            client,
            {
              recipientEmail: row.client_email,
              type: NOTIFICATION_TYPE.clientDependencyOverdue,
              title: `Information overdue — ${row.engagement_code}`,
              body: `The following is overdue; please provide it at the earliest: ${row.requested_info}.`,
              engagementId: row.engagement_id,
            },
          );
        } else {
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
      }

      result.total =
        result.internalSlaOverdue +
        result.internalSlaApproaching +
        result.statutoryDeadlineApproaching +
        result.statutoryDeadlineOverdue +
        result.complianceDueToday +
        result.clientCommitmentOverdue +
        result.deadlineLayerOverdue +
        result.clientDependencyOverdue +
        result.clientDependencyReminder;
      return result;
    });
  }
}

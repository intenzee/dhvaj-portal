import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CLIENT_REMINDER_CHANNEL,
  NOTIFICATION_TYPE,
  type ClientChase,
  type ClientChaseItem,
  type ClientReminderResult,
  type FilingRunBulkResult,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AppConfigService } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClientUploadService } from '../documents/client-upload/client-upload.service';
import { istToday } from '../engagements/time/auto-time';
import {
  CLIENT_DATA_SLOTS,
  chasingPolicy,
  raiseSlotRequests,
  reminderText,
  slotItemLabel,
} from './client-chase';

interface ChaseInstanceRow {
  id: string;
  engagement_id: string;
  entity_name: string;
  form: string;
  period_key: string | null;
  internal_due: string | null;
  workflow_status: string;
  is_member: boolean;
  client_email: string | null;
  firm_name: string | null;
}

interface OpenRequestRow {
  id: string;
  slot_code: string | null;
  label: string;
  request_date: string;
  reminder_date: string | null;
  escalation_date: string | null;
}

const CHASE_INSTANCE_SQL = `
  SELECT ci.id, ci.engagement_id, ent.legal_name AS entity_name,
         COALESCE(ci.form_label, rv.form_label, cr.name) AS form, ci.period_key,
         COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS internal_due,
         ci.workflow_status,
         hsdg.is_engagement_member(ci.engagement_id) AS is_member,
         (SELECT c.email::text FROM hsdg.entity_contacts c
           WHERE c.entity_id = e.entity_id AND c.email IS NOT NULL
           ORDER BY c.is_primary DESC, c.created_at LIMIT 1) AS client_email,
         (SELECT f.firm_name FROM hsdg.firm_settings f LIMIT 1) AS firm_name
    FROM hsdg.compliance_instances ci
    JOIN hsdg.engagements e ON e.id = ci.engagement_id
    JOIN hsdg.entities ent ON ent.id = e.entity_id
    JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
    LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
   WHERE ci.id = $1`;

const DONE_STATUSES = ['filed', 'not_applicable'];

/**
 * Staff Workflow WF-302 — client chasing on a filing. Reads what the filing is
 * waiting on from the client; a reminder first raises a request for every
 * required client-data slot nobody has asked for yet, then goes to the client
 * by e-mail (with fresh upload links when client upload is on) or comes back
 * as text to paste into WhatsApp. Any engagement member may chase; RLS scopes
 * every read and write.
 */
@Injectable()
export class ClientChaseService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly uploads: ClientUploadService,
  ) {}

  /** GET /compliance-instances/:id/client-chase */
  async get(ctx: RlsContext, id: string): Promise<ClientChase> {
    const today = istToday(new Date());
    return this.db.withRlsContext(ctx, async (client) => {
      const inst = await this.load(client, id);
      const open = await this.openRequests(client, id);
      const { rows: missing } = await client.query<{ slot_code: string; label: string }>(
        `SELECT DISTINCT ON (it.slot_code) it.slot_code, it.label
           FROM hsdg.instance_checklist_items it
          WHERE it.compliance_instance_id = $1 AND it.required AND it.status = 'open'
            AND it.auto_tick = 'document' AND it.document_id IS NULL
            AND it.slot_code = ANY($2::text[])
            AND NOT EXISTS (SELECT 1 FROM hsdg.client_dependencies d
                             WHERE d.compliance_instance_id = it.compliance_instance_id
                               AND d.slot_code = it.slot_code
                               AND d.status NOT IN ('cancelled', 'waived'))
          ORDER BY it.slot_code, it.sequence`,
        [id, CLIENT_DATA_SLOTS],
      );
      const waitingOn: ClientChaseItem[] = open.map((r) => ({
        dependencyId: r.id,
        slotCode: r.slot_code,
        label: r.label,
        requestDate: r.request_date,
        reminderDate: r.reminder_date,
        escalationDate: r.escalation_date,
        overdue: r.escalation_date !== null && r.escalation_date <= today,
      }));
      const notRequested = missing.map((m) => ({
        slotCode: m.slot_code,
        label: slotItemLabel(m.label),
      }));
      const items = [...waitingOn, ...notRequested].map((i) => ({ label: i.label }));
      return {
        instanceId: id,
        waitingOn,
        notRequested,
        clientEmail: inst.client_email,
        canEmail: this.canEmail(inst),
        reminderText: this.text(inst, items),
      };
    });
  }

  /** POST /compliance-instances/:id/client-chase/remind */
  async remind(ctx: RlsContext, id: string): Promise<ClientReminderResult> {
    const today = istToday(new Date());
    const { inst, raised, open } = await this.db.withRlsContext(ctx, async (client) => {
      const inst = await this.load(client, id);
      if (DONE_STATUSES.includes(inst.workflow_status))
        throw new BadRequestException('This filing is closed — there is nothing to chase.');
      const policy = await chasingPolicy(client);
      const raised = await raiseSlotRequests(client, id, {
        today,
        createdBy: ctx.employeeId ?? null,
        policy,
      });
      const open = await this.openRequests(client, id);
      return { inst, raised, open };
    });
    if (open.length === 0)
      throw new BadRequestException('Nothing on this filing is waiting on the client.');

    const channel = this.canEmail(inst)
      ? CLIENT_REMINDER_CHANNEL.email
      : CLIENT_REMINDER_CHANNEL.copy;
    // A fresh secure link per item, so the reminder is one tap from the upload.
    const base = this.config.get('WEB_PUBLIC_URL').replace(/\/$/, '');
    const items: { label: string; uploadUrl: string | null }[] = [];
    for (const r of open) {
      let uploadUrl: string | null = null;
      if (this.uploads.enabled && r.slot_code) {
        const link = await this.uploads.createLink(ctx, inst.engagement_id, r.id, {});
        uploadUrl = `${base}/client-upload/${link.token}`;
      }
      items.push({ label: r.label, uploadUrl });
    }
    const text = this.text(inst, items);

    await this.db.withRlsContext(ctx, async (client) => {
      if (channel === CLIENT_REMINDER_CHANNEL.email) {
        await this.notifications.enqueueClientDeliveryWith(client, {
          recipientEmail: inst.client_email,
          type: NOTIFICATION_TYPE.clientDependencyReminder,
          title: `Documents needed — ${[inst.form, inst.period_key].filter(Boolean).join(' ')}`,
          body: text,
          engagementId: inst.engagement_id,
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'filing.client_reminded',
        objectType: 'compliance_instance',
        objectId: id,
        after: {
          channel,
          dependencyIds: open.map((r) => r.id),
          raised: raised.map((r) => r.dependencyId),
        },
      });
    });
    return {
      instanceId: id,
      channel,
      text,
      waitingOn: open.map((r) => r.label),
      raised: raised.length,
    };
  }

  /** Filing-run bulk remind: one transaction per filing, failures reported per row. */
  async remindMany(ctx: RlsContext, instanceIds: string[]): Promise<FilingRunBulkResult> {
    const result: FilingRunBulkResult = { succeeded: [], failed: [] };
    for (const instanceId of instanceIds) {
      try {
        await this.remind(ctx, instanceId);
        result.succeeded.push(instanceId);
      } catch (err) {
        result.failed.push({ instanceId, message: (err as Error).message });
      }
    }
    return result;
  }

  private canEmail(inst: ChaseInstanceRow): boolean {
    return Boolean(inst.client_email) && this.notifications.hasExternalChannels;
  }

  private text(inst: ChaseInstanceRow, items: { label: string; uploadUrl?: string | null }[]) {
    return reminderText({
      entityName: inst.entity_name,
      formLabel: inst.form,
      periodKey: inst.period_key,
      items,
      dueBy: inst.internal_due,
      firmName: inst.firm_name,
    });
  }

  private async load(client: PoolClient, id: string): Promise<ChaseInstanceRow> {
    const { rows } = await client.query<ChaseInstanceRow>(CHASE_INSTANCE_SQL, [id]);
    const row = rows[0];
    if (!row) throw new NotFoundException('Filing not found.');
    if (!row.is_member)
      throw new ForbiddenException('Only the engagement team can chase this client.');
    return row;
  }

  /** The filing's open client requests, labelled by their checklist step. */
  private async openRequests(client: PoolClient, id: string): Promise<OpenRequestRow[]> {
    const { rows } = await client.query<OpenRequestRow>(
      `SELECT d.id, d.slot_code,
              COALESCE((SELECT it.label FROM hsdg.instance_checklist_items it
                         WHERE it.compliance_instance_id = d.compliance_instance_id
                           AND it.slot_code = d.slot_code
                         ORDER BY it.sequence LIMIT 1),
                       d.requested_info) AS label,
              d.request_date::text, d.reminder_date::text, d.escalation_date::text
         FROM hsdg.client_dependencies d
        WHERE d.compliance_instance_id = $1 AND d.status IN ('pending', 'partially_received')
        ORDER BY d.created_at`,
      [id],
    );
    return rows.map((r) => ({ ...r, label: slotItemLabel(r.label) }));
  }
}

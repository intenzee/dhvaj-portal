import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  EngagementKind,
  FilingRun,
  FilingRunBulkResult,
  FilingRunForm,
  FilingRunRow,
  FilingStatus,
  PeriodSection,
  TaskStatus,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import {
  WORK_LINK_COLUMNS,
  workLinkFilingOf,
  workLinkJoin,
  workLinkOf,
} from '../../common/work-links';
import type { WorkLinkSqlRow } from '../../common/work-links';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../tasks/tasks.service';
import { istToday } from '../engagements/time/auto-time';
import { CLIENT_DATA_SLOTS } from './client-chase';
import { ClientChaseService } from './client-chase.service';
import { periodLabel } from './filing-rules';

export type FilingRunScope = 'mine' | 'team';

/** Engagements that never carry live work (a filing on one is out of every run). */
const DEAD_ENGAGEMENT = ['cancelled', 'declined', 'withdrawn', 'merged'];

/**
 * `scope` as SQL on the run query (alias ci + t). The ARRAY() sub-selects run
 * once (InitPlans) — the same shape as My Work's team scope.
 */
function scopeSql(scope: FilingRunScope | undefined): string {
  if (scope === 'mine')
    return `AND (t.assigned_to_employee_id = hsdg.ctx_employee_id()
                 OR t.reviewer_employee_id = hsdg.ctx_employee_id())`;
  if (scope === 'team')
    return `AND (ci.engagement_id = ANY(ARRAY(SELECT teng.id FROM hsdg.engagements teng
                                               WHERE teng.engagement_manager_id = hsdg.ctx_employee_id()
                                                  OR teng.engagement_partner_id = hsdg.ctx_employee_id()))
                 OR ci.engagement_service_id = ANY(ARRAY(SELECT tes.id FROM hsdg.engagement_services tes
                                                          WHERE tes.lead_employee_id = hsdg.ctx_employee_id())))`;
  return '';
}

interface RunSqlRow extends WorkLinkSqlRow {
  instance_id: string;
  engagement_id: string;
  engagement_code: string;
  engagement_kind: EngagementKind;
  entity_name: string;
  registration_number: string | null;
  form_label: string;
  slots_required: number;
  slots_filled: number;
  requests_total: number;
  requests_open: number;
  waiting_on: string[];
  task_id: string | null;
  task_status: TaskStatus | null;
  task_version: number | null;
  preparer_id: string | null;
  preparer_name: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  workflow_status: FilingStatus;
  internal_date: string | null;
  statutory_date: string | null;
  reference_no: string | null;
  filed_on: string | null;
  is_lead: boolean;
}

interface AssignInstanceRow {
  id: string;
  engagement_id: string;
  title: string;
  internal_date: string | null;
  workflow_status: FilingStatus;
  is_lead: boolean;
  task_id: string | null;
  task_status: TaskStatus | null;
  task_version: number | null;
  preparer_id: string | null;
  reviewer_id: string | null;
}

/**
 * Staff Workflow WF-301 — filing runs: one form and period across every
 * client the caller can see (RLS), with bulk assign and bulk remind. Each bulk
 * row runs in its own transaction, so one refused filing never blocks the rest;
 * the answer lists what succeeded and why each failure failed.
 */
@Injectable()
export class FilingRunsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly tasks: TasksService,
    private readonly chase: ClientChaseService,
  ) {}

  /**
   * GET /compliance/runs/forms — every form-and-period with a filing due from
   * 60 days back to 45 ahead, earliest statutory date first (the picker's
   * default is the first one not fully filed).
   */
  async forms(ctx: RlsContext, scope?: FilingRunScope): Promise<FilingRunForm[]> {
    const today = istToday(new Date());
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        rule: string;
        form_label: string;
        section: PeriodSection | null;
        period_key: string;
        statutory_date: string | null;
        total: number;
        filed: number;
      }>(
        `SELECT cr.code AS rule,
                MIN(COALESCE(ci.form_label, rv.form_label, cr.name)) AS form_label,
                MIN(ci.section) AS section, ci.period_key,
                MIN(COALESCE(ci.statutory_deadline_override, ge.revised_due_date,
                             ci.statutory_deadline))::text AS statutory_date,
                count(*)::int AS total,
                count(*) FILTER (WHERE ci.workflow_status = 'filed')::int AS filed
           FROM hsdg.compliance_instances ci
           JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
           JOIN hsdg.engagements e ON e.id = ci.engagement_id
           LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
           LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
           LEFT JOIN LATERAL (
             SELECT t.assigned_to_employee_id, t.reviewer_employee_id FROM hsdg.tasks t
              WHERE t.source_compliance_instance_id = ci.id
              ORDER BY (t.status = 'cancelled'), t.created_at DESC LIMIT 1) t ON true
          WHERE ci.period_key IS NOT NULL AND ci.workflow_status <> 'not_applicable'
            AND e.status <> ALL($1::text[])
            AND COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)
                BETWEEN $2::date - 60 AND $2::date + 45
            ${scopeSql(scope)}
          GROUP BY cr.code, ci.period_key
          ORDER BY statutory_date NULLS LAST, form_label, ci.period_key`,
        [DEAD_ENGAGEMENT, today],
      );
      return rows.map((r) => ({
        rule: r.rule,
        formLabel: r.form_label,
        section: r.section,
        periodKey: r.period_key,
        periodLabel: periodLabel(r.period_key),
        statutoryDate: r.statutory_date,
        total: r.total,
        filed: r.filed,
      }));
    });
  }

  /** GET /compliance/runs?rule=&period=[&scope=] — one row per filing. */
  async run(
    ctx: RlsContext,
    rule: string,
    periodKey: string,
    scope?: FilingRunScope,
  ): Promise<FilingRun> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<RunSqlRow>(
        `SELECT p.*, ${WORK_LINK_COLUMNS}
           FROM (
             SELECT ci.id AS instance_id, ci.engagement_id, e.engagement_code,
                    e.kind AS engagement_kind, ent.legal_name AS entity_name, r.registration_number,
                    COALESCE(ci.form_label, rv.form_label, cr.name) AS form_label,
                    COALESCE(ck.required, 0)::int AS slots_required,
                    COALESCE(ck.filled, 0)::int AS slots_filled,
                    COALESCE(dp.total, 0)::int AS requests_total,
                    COALESCE(dp.open, 0)::int AS requests_open,
                    COALESCE(dp.waiting_on, '{}') AS waiting_on,
                    t.id AS task_id, t.status AS task_status, t.version AS task_version,
                    t.assigned_to_employee_id AS preparer_id, pe.full_name AS preparer_name,
                    t.reviewer_employee_id AS reviewer_id, re.full_name AS reviewer_name,
                    ci.workflow_status,
                    COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS internal_date,
                    COALESCE(ci.statutory_deadline_override, ge.revised_due_date,
                             ci.statutory_deadline)::text AS statutory_date,
                    fr.reference_no, fr.filed_on::text AS filed_on,
                    hsdg.is_engagement_lead(ci.engagement_id) AS is_lead
               FROM hsdg.compliance_instances ci
               JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
               JOIN hsdg.engagements e ON e.id = ci.engagement_id
               JOIN hsdg.entities ent ON ent.id = e.entity_id
               LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
               LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
               LEFT JOIN hsdg.entity_registrations r ON r.id = ci.registration_id
               LEFT JOIN LATERAL (
                 SELECT t.id, t.status, t.version, t.assigned_to_employee_id, t.reviewer_employee_id
                   FROM hsdg.tasks t
                  WHERE t.source_compliance_instance_id = ci.id
                  ORDER BY (t.status = 'cancelled'), t.created_at DESC LIMIT 1) t ON true
               LEFT JOIN hsdg.employees pe ON pe.id = t.assigned_to_employee_id
               LEFT JOIN hsdg.employees re ON re.id = t.reviewer_employee_id
               LEFT JOIN LATERAL (
                 SELECT count(*) FILTER (WHERE it.slot_code = ANY($4::text[])) AS required,
                        count(*) FILTER (WHERE it.slot_code = ANY($4::text[])
                                           AND it.document_id IS NOT NULL) AS filled
                   FROM hsdg.instance_checklist_items it
                  WHERE it.compliance_instance_id = ci.id AND it.required
                    AND it.auto_tick = 'document' AND it.status <> 'not_applicable') ck ON true
               LEFT JOIN LATERAL (
                 SELECT count(*) AS total,
                        count(*) FILTER (WHERE d.status IN ('pending','partially_received')) AS open,
                        array_agg(d.requested_info ORDER BY d.created_at)
                          FILTER (WHERE d.status IN ('pending','partially_received')) AS waiting_on
                   FROM hsdg.client_dependencies d
                  WHERE d.compliance_instance_id = ci.id
                    AND d.status NOT IN ('cancelled','waived')) dp ON true
               LEFT JOIN hsdg.filing_records fr
                 ON fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL
              WHERE cr.code = $1 AND ci.period_key = $2
                AND ci.workflow_status <> 'not_applicable'
                AND e.status <> ALL($3::text[])
                ${scopeSql(scope)}
           ) p
           ${workLinkJoin('p.instance_id')}
          ORDER BY p.entity_name, p.registration_number NULLS LAST, p.instance_id`,
        [rule, periodKey, DEAD_ENGAGEMENT, CLIENT_DATA_SLOTS],
      );
      const items = rows.map((r) => this.toRow(r, ctx.employeeId ?? null));
      return {
        rule,
        formLabel: rows[0]?.form_label ?? rule,
        periodKey,
        periodLabel: periodLabel(periodKey),
        total: items.length,
        filed: items.filter((i) => i.workflowStatus === 'filed').length,
        items,
      };
    });
  }

  /**
   * POST /compliance/runs/assign — set the preparer and/or reviewer on each
   * filing's task, creating the task when the filing has none (a preparer is
   * then required). Lead-only per filing (RLS on tasks agrees); one
   * transaction per filing through TasksService, so assignment notifications
   * and audit match the single-filing path.
   */
  async assign(
    ctx: RlsContext,
    instanceIds: string[],
    who: { preparerId?: string | null; reviewerId?: string | null },
  ): Promise<FilingRunBulkResult> {
    if (who.preparerId === undefined && who.reviewerId === undefined)
      throw new BadRequestException('Choose a preparer or a reviewer to assign.');
    const result: FilingRunBulkResult = { succeeded: [], failed: [] };
    for (const instanceId of unique(instanceIds)) {
      try {
        await this.assignOne(ctx, instanceId, who);
        result.succeeded.push(instanceId);
      } catch (err) {
        result.failed.push({ instanceId, message: (err as Error).message });
      }
    }
    await this.db.withRlsContext(ctx, (client) =>
      this.audit.recordWith(client, ctx, {
        action: 'filing_run.assigned',
        objectType: 'filing_run',
        objectId: 'bulk',
        after: {
          preparerId: who.preparerId ?? null,
          reviewerId: who.reviewerId ?? null,
          succeeded: result.succeeded,
          failed: result.failed.map((f) => f.instanceId),
        },
      }),
    );
    return result;
  }

  /** POST /compliance/runs/remind — WF-302's reminder on each filing. */
  async remind(ctx: RlsContext, instanceIds: string[]): Promise<FilingRunBulkResult> {
    const result = await this.chase.remindMany(ctx, unique(instanceIds));
    await this.db.withRlsContext(ctx, (client) =>
      this.audit.recordWith(client, ctx, {
        action: 'filing_run.reminded',
        objectType: 'filing_run',
        objectId: 'bulk',
        after: { succeeded: result.succeeded, failed: result.failed.map((f) => f.instanceId) },
      }),
    );
    return result;
  }

  private async assignOne(
    ctx: RlsContext,
    instanceId: string,
    who: { preparerId?: string | null; reviewerId?: string | null },
  ): Promise<void> {
    const inst = await this.db.withRlsContext(ctx, (client) =>
      this.loadForAssign(client, instanceId),
    );
    if (!inst.is_lead)
      throw new ForbiddenException(
        'Only the engagement partner or manager can assign this filing.',
      );
    if (inst.workflow_status === 'filed')
      throw new BadRequestException('This filing is already lodged.');
    if (inst.task_status === 'cancelled')
      throw new BadRequestException('This filing’s task was cancelled — reopen it first.');
    const preparer = who.preparerId !== undefined ? who.preparerId : inst.preparer_id;
    const reviewer = who.reviewerId !== undefined ? who.reviewerId : inst.reviewer_id;
    if (preparer && reviewer && preparer === reviewer)
      throw new BadRequestException('The reviewer must be someone other than the preparer.');

    if (!inst.task_id) {
      if (!preparer)
        throw new BadRequestException('Choose a preparer — this filing has no task yet.');
      await this.tasks.create(ctx, inst.engagement_id, {
        title: inst.title,
        assignedToEmployeeId: preparer,
        ...(reviewer ? { reviewerEmployeeId: reviewer } : {}),
        ...(inst.internal_date ? { dueDate: inst.internal_date } : {}),
        complianceInstanceId: instanceId,
      });
      return;
    }
    await this.tasks.update(ctx, inst.engagement_id, inst.task_id, {
      ...(who.preparerId !== undefined ? { assignedToEmployeeId: who.preparerId } : {}),
      ...(who.reviewerId !== undefined ? { reviewerEmployeeId: who.reviewerId } : {}),
      version: inst.task_version!,
    });
  }

  private async loadForAssign(client: PoolClient, id: string): Promise<AssignInstanceRow> {
    const { rows } = await client.query<AssignInstanceRow>(
      `SELECT ci.id, ci.engagement_id,
              concat_ws(' · ', COALESCE(ci.form_label, rv.form_label, cr.name),
                        COALESCE(ci.period_key, ci.financial_year), r.registration_number) AS title,
              COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS internal_date,
              ci.workflow_status, hsdg.is_engagement_lead(ci.engagement_id) AS is_lead,
              t.id AS task_id, t.status AS task_status, t.version AS task_version,
              t.assigned_to_employee_id AS preparer_id, t.reviewer_employee_id AS reviewer_id
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
         LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
         LEFT JOIN hsdg.entity_registrations r ON r.id = ci.registration_id
         LEFT JOIN LATERAL (
           SELECT t.id, t.status, t.version, t.assigned_to_employee_id, t.reviewer_employee_id
             FROM hsdg.tasks t
            WHERE t.source_compliance_instance_id = ci.id
            ORDER BY (t.status = 'cancelled'), t.created_at DESC LIMIT 1) t ON true
        WHERE ci.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Filing not found.');
    return row;
  }

  private toRow(r: RunSqlRow, me: string | null): FilingRunRow {
    const filed = r.workflow_status === 'filed';
    return {
      instanceId: r.instance_id,
      engagementId: r.engagement_id,
      engagementCode: r.engagement_code,
      engagementKind: r.engagement_kind,
      entityName: r.entity_name,
      registrationNumber: r.registration_number,
      data: {
        slotsRequired: r.slots_required,
        slotsFilled: r.slots_filled,
        requestsTotal: r.requests_total,
        requestsOpen: r.requests_open,
        waitingOn: r.waiting_on.map((w) => w.split(' — ')[0]!),
      },
      taskId: r.task_id,
      taskStatus: r.task_status,
      taskVersion: r.task_version,
      preparerId: r.preparer_id,
      preparerName: r.preparer_name,
      reviewerId: r.reviewer_id,
      reviewerName: r.reviewer_name,
      workflowStatus: r.workflow_status,
      internalDate: r.internal_date,
      statutoryDate: r.statutory_date,
      filed:
        r.reference_no && r.filed_on ? { referenceNo: r.reference_no, filedOn: r.filed_on } : null,
      canLodge: !filed && (r.is_lead || (me !== null && r.preparer_id === me)),
      canAssign: !filed && r.is_lead,
      link: workLinkOf(
        { engagementId: r.engagement_id, engagementKind: r.engagement_kind, taskId: r.task_id },
        workLinkFilingOf(r),
      ),
    };
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  reassessmentImpact,
  REASSESSMENT_STATUS,
  type AuditReassessment,
  type ReassessmentChangeType,
  type ReassessmentImpact,
  type ReassessmentStatus,
  type StatutoryAuditReassessment,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

interface ShellRow {
  id: string;
  engagement_service_id: string;
  engagement_id: string;
  archived: boolean;
  reopenable: boolean;
}

interface EventRow {
  id: string;
  change_type: ReassessmentChangeType;
  impact: ReassessmentImpact;
  reason: string;
  status: ReassessmentStatus;
  affected_summary: string | null;
  raised_by_name: string | null;
  created_at: Date;
  resolved_by_name: string | null;
  resolved_at: Date | null;
  version: number;
}

export interface RaiseReassessmentInput {
  changeType: ReassessmentChangeType;
  reason: string;
}

/**
 * Statutory Audit — Change-Impact / Reassessment (Audit Spec §29, §30).
 *
 * Change-impact is CONTROLLED: raising a reassessment records the change and
 * FLAGS the affected downstream work for reconsideration — it never deletes it
 * (§30). The controlled impact reuses the first-class attention states the
 * earlier slices already model: framework areas → `reassessment_required`
 * (re-enabling the SA-2 re-approval path), active work areas → `needs_attention`
 * with the conclusion reset to draft (so the SA-8 completion gate re-blocks), and
 * the affected phases → `needs_attention`. A completion-approved or signed-off
 * file is re-opened (its approval cleared). An archived file is locked (§37) and
 * rejects reassessment. Impact maths is the shared pure {@link reassessmentImpact}.
 */
@Injectable()
export class AuditReassessmentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditReassessment[]> {
    return this.db.withRlsContext(ctx, (client) => this.readReassessment(client, engagementId));
  }

  private async readReassessment(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditReassessment[]> {
    const shells = await this.shellsFor(client, engagementId);
    if (shells.length === 0) return [];
    const shellIds = shells.map((s) => s.id);

    const { rows: events } = await client.query<EventRow & { workflow_instance_id: string }>(
      `SELECT r.id, r.workflow_instance_id, r.change_type, r.impact, r.reason, r.status,
              r.affected_summary, rb.full_name AS raised_by_name, r.created_at,
              cb.full_name AS resolved_by_name, r.resolved_at, r.version
         FROM hsdg.audit_reassessments r
         LEFT JOIN hsdg.employees rb ON rb.id = r.raised_by_employee_id
         LEFT JOIN hsdg.employees cb ON cb.id = r.resolved_by_employee_id
        WHERE r.workflow_instance_id = ANY($1::uuid[])
        ORDER BY r.created_at DESC`,
      [shellIds],
    );

    return shells.map((shell) => {
      const shellEvents = events.filter((e) => e.workflow_instance_id === shell.id).map(mapEvent);
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        locked: shell.archived,
        openCount: shellEvents.filter((e) => e.status === REASSESSMENT_STATUS.open).length,
        events: shellEvents,
      };
    });
  }

  // ── Raise a reassessment (§30) ──────────────────────────────────────────────

  async raise(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RaiseReassessmentInput,
  ): Promise<StatutoryAuditReassessment> {
    return this.db.withRlsContext(ctx, async (client) => {
      const shell = await this.assertShell(client, engagementId, workflowInstanceId);
      if (shell.archived) {
        throw new ConflictException('This audit file is archived and locked (§37).');
      }
      const impact = reassessmentImpact(input.changeType);
      const parts: string[] = [];

      // Framework applicability → re-open approved areas for re-conclusion (§30).
      if (impact.framework) {
        const r = await client.query(
          `UPDATE hsdg.audit_framework_assessments
              SET state = 'reassessment_required'
            WHERE workflow_instance_id = $1 AND state = 'approved'`,
          [workflowInstanceId],
        );
        if (r.rowCount) parts.push(`${r.rowCount} framework area(s)`);
        await this.reopenPhase(client, workflowInstanceId, 'framework');
      }

      // Audit-area work → flag progressed active areas and reset their conclusion,
      // so they must be re-done and re-reviewed before the §29 completion gate
      // clears (§30 "reassess response/procedures / affected areas").
      if (impact.work) {
        const r = await client.query(
          `UPDATE hsdg.audit_work_areas
              SET state = 'needs_attention', conclusion_state = 'draft'
            WHERE workflow_instance_id = $1 AND is_active = true
              AND state IN ('in_progress','complete','needs_attention')`,
          [workflowInstanceId],
        );
        if (r.rowCount) parts.push(`${r.rowCount} work area(s)`);
        await this.reopenPhase(client, workflowInstanceId, 'audit_areas');
      }

      // Planning / risk phases re-open for re-approval (the SA-3/SA-9 reopen path).
      if (impact.planning) await this.reopenPhase(client, workflowInstanceId, 'planning');
      if (impact.risk) await this.reopenPhase(client, workflowInstanceId, 'risk');

      // A completion-approved or signed-off (but not archived) file is re-opened:
      // clear the approval so §29 re-blocks, and move its phases back to attention.
      if (shell.reopenable) {
        await client.query(
          `UPDATE hsdg.service_workflow_instances
              SET completion_approved_at = NULL, completion_approved_by_employee_id = NULL,
                  completion_memo = NULL,
                  signed_off_at = NULL, signed_off_by_employee_id = NULL, signoff_memo = NULL,
                  status = 'active'
            WHERE id = $1`,
          [workflowInstanceId],
        );
        await this.reopenPhase(client, workflowInstanceId, 'completion');
        await this.reopenPhase(client, workflowInstanceId, 'reporting');
        await this.reopenPhase(client, workflowInstanceId, 'sign_off');
        parts.push('completion/sign-off re-opened');
      }

      const affectedSummary = parts.length ? `Flagged ${parts.join(', ')}.` : null;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_reassessments
           (workflow_instance_id, engagement_id, change_type, reason, impact, affected_summary,
            raised_by_employee_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          input.changeType,
          input.reason.trim(),
          JSON.stringify(impact),
          affectedSummary,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.reassessment_raised',
        objectType: 'audit_reassessment',
        objectId: rows[0]!.id,
        after: { changeType: input.changeType, impact, affectedSummary },
      });
      return this.readOne(client, engagementId, workflowInstanceId);
    });
  }

  /** Resolve a reassessment once the flagged work has been addressed (§30). */
  async resolve(
    ctx: RlsContext,
    engagementId: string,
    reassessmentId: string,
    input: { version: number },
  ): Promise<StatutoryAuditReassessment> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        workflow_instance_id: string;
        status: ReassessmentStatus;
      }>(
        `SELECT workflow_instance_id, status FROM hsdg.audit_reassessments
          WHERE id = $1 AND engagement_id = $2`,
        [reassessmentId, engagementId],
      );
      if (!rows[0]) throw new NotFoundException('Reassessment not found on this engagement.');
      if (rows[0].status === REASSESSMENT_STATUS.resolved) {
        throw new ConflictException('This reassessment is already resolved.');
      }
      const result = await client.query(
        `UPDATE hsdg.audit_reassessments
            SET status = 'resolved', resolved_by_employee_id = $3, resolved_at = now(),
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [reassessmentId, input.version, ctx.employeeId ?? null],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This reassessment changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.reassessment_resolved',
        objectType: 'audit_reassessment',
        objectId: reassessmentId,
      });
      return this.readOne(client, engagementId, rows[0].workflow_instance_id);
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async shellsFor(client: PoolClient, engagementId: string): Promise<ShellRow[]> {
    const { rows } = await client.query<ShellRow>(
      `SELECT id, engagement_service_id, engagement_id,
              (archived_at IS NOT NULL OR status = 'archived') AS archived,
              (archived_at IS NULL AND status <> 'archived'
                 AND (completion_approved_at IS NOT NULL OR signed_off_at IS NOT NULL)) AS reopenable
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1
        ORDER BY created_at ASC`,
      [engagementId],
    );
    return rows;
  }

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<ShellRow> {
    const shells = await this.shellsFor(client, engagementId);
    const shell = shells.find((s) => s.id === workflowInstanceId);
    if (!shell) {
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    }
    return shell;
  }

  /**
   * Re-open a COMPLETED phase for reassessment (complete → needs_attention).
   * Only completed phases are flagged — §30 is about re-opening finished
   * downstream work, not disturbing a phase already in progress. `needs_attention`
   * on the planning phase is also the signal the SA-3 re-approval guard keys on.
   */
  private async reopenPhase(
    client: PoolClient,
    workflowInstanceId: string,
    phaseKey: string,
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_workflow_phases
          SET state = 'needs_attention'
        WHERE workflow_instance_id = $1 AND phase_key = $2 AND state = 'complete'`,
      [workflowInstanceId, phaseKey],
    );
  }

  private async readOne(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditReassessment> {
    const all = await this.readReassessment(client, engagementId);
    return all.find((r) => r.workflowInstanceId === workflowInstanceId) ?? all[0]!;
  }
}

function mapEvent(r: EventRow): AuditReassessment {
  return {
    id: r.id,
    changeType: r.change_type,
    impact: r.impact,
    reason: r.reason,
    status: r.status,
    affectedSummary: r.affected_summary,
    raisedByName: r.raised_by_name,
    createdAt: r.created_at.toISOString(),
    resolvedByName: r.resolved_by_name,
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    version: r.version,
  };
}

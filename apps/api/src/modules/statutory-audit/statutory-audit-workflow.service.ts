import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  AUDIT_PHASES,
  FRAMEWORK_AREAS,
  PLANNING_ITEMS,
  STATUTORY_AUDIT_TEMPLATE_VERSION,
  STATUTORY_AUDIT_WORKFLOW_KEY,
  type AuditPhaseKey,
  type AuditPhaseState,
  type AuditWorkflowStatus,
  type StatutoryAuditWorkflow,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

interface WorkflowRow {
  id: string;
  engagement_service_id: string;
  engagement_id: string;
  workflow_key: string;
  template_version: string;
  status: AuditWorkflowStatus;
}

interface PhaseRow {
  id: string;
  workflow_instance_id: string;
  phase_no: number;
  phase_key: AuditPhaseKey;
  title: string;
  state: AuditPhaseState;
  sort_order: number;
}

/**
 * Statutory Audit — the versioned workflow shell (Audit Spec §5–§8, §33).
 *
 * Provisioning creates ONE shell (ten-phase audit-file skeleton) per statutory-
 * audit service instance — not detailed procedures. It is idempotent: a UNIQUE
 * constraint on engagement_service_id means a repeated add can never create a
 * second shell (§36 "Run generation twice → No duplicate objects"), and the
 * insert uses ON CONFLICT DO NOTHING so the phases + audit event are written
 * only on genuine first creation.
 *
 * This service is deliberately decoupled from EngagementsModule (it imports only
 * AuditModule) so EngagementsModule can depend on it to provision at add-service
 * time without a circular import.
 */
@Injectable()
export class StatutoryAuditWorkflowService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Provision the workflow shell for a statutory-audit service instance, inside
   * the caller's existing transaction (so it commits atomically with the
   * add-service mutation). Idempotent — returns the existing shell's id if one
   * is already present and writes nothing further.
   *
   * @returns the workflow instance id, and whether it was created just now.
   */
  async provision(
    client: PoolClient,
    ctx: RlsContext,
    args: { engagementServiceId: string; engagementId: string },
  ): Promise<{ workflowInstanceId: string; created: boolean }> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO hsdg.service_workflow_instances
         (engagement_service_id, engagement_id, workflow_key, template_version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (engagement_service_id) DO NOTHING
       RETURNING id`,
      [
        args.engagementServiceId,
        args.engagementId,
        STATUTORY_AUDIT_WORKFLOW_KEY,
        STATUTORY_AUDIT_TEMPLATE_VERSION,
      ],
    );

    // Already provisioned — nothing more to do (idempotent).
    if (!inserted.rows[0]) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.service_workflow_instances WHERE engagement_service_id = $1`,
        [args.engagementServiceId],
      );
      return { workflowInstanceId: existing.rows[0]!.id, created: false };
    }

    const workflowInstanceId = inserted.rows[0].id;

    // Seed exactly the canonical ten phases (§8) in a single multi-row insert.
    const values: string[] = [];
    const params: unknown[] = [workflowInstanceId, args.engagementId];
    for (const phase of AUDIT_PHASES) {
      const base = params.length;
      values.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      params.push(phase.phaseNo, phase.phaseKey, phase.title, phase.initialState, phase.phaseNo);
    }
    await client.query(
      `INSERT INTO hsdg.audit_workflow_phases
         (workflow_instance_id, engagement_id, phase_no, phase_key, title, state, sort_order)
       VALUES ${values.join(', ')}`,
      params,
    );

    // Seed the Framework (Phase 02) assessment areas alongside the shell (§5,
    // §18) so every engagement member can read the framework without a lead
    // having to initialise it first. Idempotent via ON CONFLICT.
    const fwValues: string[] = [];
    const fwParams: unknown[] = [workflowInstanceId, args.engagementId];
    for (const area of FRAMEWORK_AREAS) {
      const base = fwParams.length;
      fwValues.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      fwParams.push(area.areaKey, area.title, area.kind, area.sortOrder);
    }
    await client.query(
      `INSERT INTO hsdg.audit_framework_assessments
         (workflow_instance_id, engagement_id, area_key, title, kind, sort_order)
       VALUES ${fwValues.join(', ')}
       ON CONFLICT (workflow_instance_id, area_key) DO NOTHING`,
      fwParams,
    );

    // Seed the Planning (Phase 03) sub-areas alongside the shell (§21) so every
    // engagement member can read the planning file without a lead initialising
    // it. Idempotent via ON CONFLICT; existing shells were seeded in migration
    // 1762400000000.
    const planValues: string[] = [];
    const planParams: unknown[] = [workflowInstanceId, args.engagementId];
    for (const item of PLANNING_ITEMS) {
      const base = planParams.length;
      planValues.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3})`);
      planParams.push(item.itemKey, item.title, item.sortOrder);
    }
    await client.query(
      `INSERT INTO hsdg.audit_planning_items
         (workflow_instance_id, engagement_id, item_key, title, sort_order)
       VALUES ${planValues.join(', ')}
       ON CONFLICT (workflow_instance_id, item_key) DO NOTHING`,
      planParams,
    );

    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.workflow_provisioned',
      objectType: 'service_workflow_instance',
      objectId: workflowInstanceId,
      after: {
        engagementServiceId: args.engagementServiceId,
        workflowKey: STATUTORY_AUDIT_WORKFLOW_KEY,
        templateVersion: STATUTORY_AUDIT_TEMPLATE_VERSION,
        phaseCount: AUDIT_PHASES.length,
      },
    });

    return { workflowInstanceId, created: true };
  }

  /**
   * The statutory-audit workflow shells on an engagement, each with its phases —
   * the Services readiness strip (§7) and the Work-tab left navigation (§8, §10).
   * RLS-scoped: only engagement members get rows back.
   */
  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditWorkflow[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: workflows } = await client.query<WorkflowRow>(
        `SELECT id, engagement_service_id, engagement_id, workflow_key, template_version, status
           FROM hsdg.service_workflow_instances
          WHERE engagement_id = $1
          ORDER BY created_at ASC`,
        [engagementId],
      );
      if (workflows.length === 0) return [];

      const { rows: phases } = await client.query<PhaseRow>(
        `SELECT id, workflow_instance_id, phase_no, phase_key, title, state, sort_order
           FROM hsdg.audit_workflow_phases
          WHERE workflow_instance_id = ANY($1::uuid[])
          ORDER BY sort_order ASC`,
        [workflows.map((w) => w.id)],
      );

      return workflows.map((w) => ({
        workflowInstanceId: w.id,
        engagementServiceId: w.engagement_service_id,
        engagementId: w.engagement_id,
        workflowKey: w.workflow_key,
        templateVersion: w.template_version,
        status: w.status,
        phases: phases
          .filter((p) => p.workflow_instance_id === w.id)
          .map((p) => ({
            id: p.id,
            phaseNo: p.phase_no,
            phaseKey: p.phase_key,
            title: p.title,
            state: p.state,
            sortOrder: p.sort_order,
          })),
      }));
    });
  }
}

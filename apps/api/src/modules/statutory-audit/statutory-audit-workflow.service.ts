import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ACCEPTANCE_SEGMENTS,
  ALL_COMPLETION_ITEMS,
  AUDIT_PHASES,
  FRAMEWORK_AREAS,
  PLANNING_ITEMS,
  STATUTORY_AUDIT_SERVICE_CODE,
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

    // Seed the Section 01 (Acceptance) segments alongside the shell (Guide §8.3)
    // so every engagement member can read the acceptance file without a lead
    // initialising it. Idempotent via ON CONFLICT; existing shells self-heal on
    // the acceptance read.
    const accValues: string[] = [];
    const accParams: unknown[] = [workflowInstanceId, args.engagementId];
    for (const seg of ACCEPTANCE_SEGMENTS) {
      const base = accParams.length;
      accValues.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      accParams.push(seg.segmentKey, seg.title, seg.readOnly ?? false, seg.sortOrder);
    }
    await client.query(
      `INSERT INTO hsdg.audit_acceptance_segments
         (workflow_instance_id, engagement_id, segment_key, title, read_only, sort_order)
       VALUES ${accValues.join(', ')}
       ON CONFLICT (workflow_instance_id, segment_key) DO NOTHING`,
      accParams,
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

    // Seed the 02.1 Entity & Regulatory Profile row alongside the shell (§9.1) —
    // the fact foundation every member can read from the start. Idempotent via
    // ON CONFLICT; existing shells self-heal on the profile read.
    await client.query(
      `INSERT INTO hsdg.audit_entity_profile (workflow_instance_id, engagement_id)
       VALUES ($1, $2)
       ON CONFLICT (workflow_instance_id) DO NOTHING`,
      [workflowInstanceId, args.engagementId],
    );

    // Seed the 02.2 Financial Reporting Framework sub-assessment (§9.2) on the
    // shared per-sub-section table. Idempotent; existing shells self-heal on read.
    await client.query(
      `INSERT INTO hsdg.audit_framework_subassessment
         (workflow_instance_id, engagement_id, sub_section_key, area_key, title)
       VALUES ($1, $2, '02.2', 'financial_reporting_framework', 'Applicable Financial Reporting Framework')
       ON CONFLICT (workflow_instance_id, sub_section_key, area_key) DO NOTHING`,
      [workflowInstanceId, args.engagementId],
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

    // Seed the Completion (Phase 07) and Reporting (Phase 08) checklists (§27)
    // alongside the shell so every engagement member can read them from the start
    // of the file. Idempotent via ON CONFLICT; existing shells were seeded in
    // migration 1762800000000.
    const compValues: string[] = [];
    const compParams: unknown[] = [workflowInstanceId, args.engagementId];
    for (const item of ALL_COMPLETION_ITEMS) {
      const base = compParams.length;
      compValues.push(`($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      compParams.push(item.section, item.itemKey, item.title, item.sortOrder);
    }
    await client.query(
      `INSERT INTO hsdg.audit_completion_items
         (workflow_instance_id, engagement_id, section, item_key, title, sort_order)
       VALUES ${compValues.join(', ')}
       ON CONFLICT (workflow_instance_id, section, item_key) DO NOTHING`,
      compParams,
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
      // Self-heal: a statutory-audit service line added before provisioning was
      // wired into engagement creation (or one that predates SA-1) may have no
      // shell, so the Work-tab file would render nothing. When the caller is a
      // lead — exactly who RLS lets write — provision the missing shell(s) now.
      // provision() is idempotent, so this is safe and drift-free (it reuses the
      // canonical seed), and it is skipped for non-leads (the read still returns).
      await this.ensureProvisioned(client, ctx, engagementId);

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

  /**
   * Provision any statutory-audit service line on the engagement that is missing
   * its workflow shell, when the caller is a lead (so the RLS INSERT is allowed).
   * Idempotent and gated: non-leads are skipped so a member's read is unaffected,
   * and a lead's first visit backfills historical engagements. Runs inside the
   * caller's transaction/client.
   */
  private async ensureProvisioned(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
  ): Promise<void> {
    const { rows: missing } = await client.query<{ engagement_service_id: string }>(
      `SELECT es.id AS engagement_service_id
         FROM hsdg.engagement_services es
         JOIN hsdg.services s ON s.id = es.service_id
        WHERE es.engagement_id = $1
          AND s.code = $2
          AND es.status <> 'cancelled'
          AND NOT EXISTS (
            SELECT 1 FROM hsdg.service_workflow_instances w
             WHERE w.engagement_service_id = es.id
          )`,
      [engagementId, STATUTORY_AUDIT_SERVICE_CODE],
    );
    if (missing.length === 0) return;

    // Only a lead may INSERT under RLS; check first so we never abort the
    // read transaction with a policy violation for a plain member.
    const { rows: lead } = await client.query<{ lead: boolean }>(
      `SELECT hsdg.is_engagement_lead($1) AS lead`,
      [engagementId],
    );
    if (!lead[0]?.lead) return;

    for (const row of missing) {
      await this.provision(client, ctx, {
        engagementServiceId: row.engagement_service_id,
        engagementId,
      });
    }
  }
}

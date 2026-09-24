import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  type Materiality,
  type PlanningApproval,
  type PlanningItem,
  type PlanningItemState,
  type StatutoryAuditPlanning,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { incompletePlanningCount } from './plan-risk';

interface PlanningItemRow {
  id: string;
  workflow_instance_id: string;
  item_key: string;
  title: string;
  state: PlanningItemState;
  narrative: string | null;
  updated_by_name: string | null;
  content_updated_at: Date | null;
  sort_order: number;
  version: number;
}

interface MaterialityRow {
  workflow_instance_id: string;
  overall_materiality: string | null;
  performance_materiality: string | null;
  clearly_trivial_threshold: string | null;
  benchmark: string | null;
  basis: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
}

interface ApprovalRow {
  id: string;
  workflow_instance_id: string;
  version: number;
  memo: string | null;
  approved_by_name: string | null;
  approved_at: Date;
}

/**
 * Statutory Audit — Planning (Phase 03) service (Audit Spec §21).
 *
 * Planning consumes the approved framework and documents strategy, materiality,
 * risks, areas, responses, resources, PBC and timing. Approving Planning (gated
 * on Framework approval and every sub-area complete) freezes it in a versioned
 * snapshot, marks Phase 03 complete and UNLOCKS Risk (Phase 04).
 */
@Injectable()
export class AuditPlanningService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditPlanning[]> {
    return this.db.withRlsContext(ctx, (client) => this.readPlanning(client, engagementId));
  }

  private async readPlanning(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditPlanning[]> {
    const { rows: shells } = await client.query<{
      id: string;
      engagement_service_id: string;
      engagement_id: string;
    }>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1
        ORDER BY created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];
    const shellIds = shells.map((s) => s.id);

    const { rows: items } = await client.query<PlanningItemRow>(
      `SELECT pi.id, pi.workflow_instance_id, pi.item_key, pi.title, pi.state, pi.narrative,
              emp.full_name AS updated_by_name, pi.content_updated_at, pi.sort_order, pi.version
         FROM hsdg.audit_planning_items pi
         LEFT JOIN hsdg.employees emp ON emp.id = pi.updated_by_employee_id
        WHERE pi.workflow_instance_id = ANY($1::uuid[])
        ORDER BY pi.sort_order ASC`,
      [shellIds],
    );

    const { rows: materiality } = await client.query<MaterialityRow>(
      `SELECT m.workflow_instance_id, m.overall_materiality, m.performance_materiality,
              m.clearly_trivial_threshold, m.benchmark, m.basis,
              emp.full_name AS decided_by_name, m.decided_at, m.version
         FROM hsdg.audit_materiality m
         LEFT JOIN hsdg.employees emp ON emp.id = m.decided_by_employee_id
        WHERE m.workflow_instance_id = ANY($1::uuid[])`,
      [shellIds],
    );

    const { rows: approvals } = await client.query<ApprovalRow>(
      `SELECT ap.id, ap.workflow_instance_id, ap.version, ap.memo,
              emp.full_name AS approved_by_name, ap.approved_at
         FROM hsdg.audit_planning_approvals ap
         LEFT JOIN hsdg.employees emp ON emp.id = ap.approved_by_employee_id
        WHERE ap.workflow_instance_id = ANY($1::uuid[])
        ORDER BY ap.version DESC`,
      [shellIds],
    );

    // Whether each shell's framework is approved (the planning-approval gate).
    const { rows: fwApproved } = await client.query<{ workflow_instance_id: string }>(
      `SELECT DISTINCT workflow_instance_id
         FROM hsdg.audit_framework_approvals
        WHERE workflow_instance_id = ANY($1::uuid[])`,
      [shellIds],
    );
    const frameworkApprovedSet = new Set(fwApproved.map((r) => r.workflow_instance_id));

    return shells.map((shell) => {
      const shellItems = items.filter((i) => i.workflow_instance_id === shell.id);
      const mat = materiality.find((m) => m.workflow_instance_id === shell.id) ?? null;
      const latestApproval = approvals.find((ap) => ap.workflow_instance_id === shell.id) ?? null;
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        frameworkApproved: frameworkApprovedSet.has(shell.id),
        items: shellItems.map(mapItem),
        materiality: mat ? mapMateriality(mat) : null,
        approval: latestApproval ? mapApproval(latestApproval) : null,
        incompleteCount: incompletePlanningCount(shellItems.map((i) => i.state)),
      };
    });
  }

  // ── Update a planning sub-area (§21) ────────────────────────────────────────

  async updateItem(
    ctx: RlsContext,
    engagementId: string,
    itemId: string,
    input: { state?: PlanningItemState; narrative?: string | null; version: number },
  ): Promise<StatutoryAuditPlanning> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string; workflow_instance_id: string }>(
        `SELECT id, workflow_instance_id FROM hsdg.audit_planning_items
          WHERE id = $1 AND engagement_id = $2`,
        [itemId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Planning item not found.');
      await this.assertNotApproved(client, current.workflow_instance_id);

      // PATCH semantics: state and narrative are each updated only when the
      // caller supplies them (undefined ⇒ unchanged). This keeps a state-only
      // toggle from wiping an already-recorded narrative, and vice versa.
      const result = await client.query(
        `UPDATE hsdg.audit_planning_items
            SET state = COALESCE($3, state),
                narrative = CASE WHEN $4 THEN $5 ELSE narrative END,
                updated_by_employee_id = $6,
                content_updated_at = now(),
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          itemId,
          input.version,
          input.state ?? null,
          input.narrative !== undefined,
          input.narrative?.trim() || null,
          ctx.employeeId ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('This planning item changed since you loaded it; refresh.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_item_updated',
        objectType: 'audit_planning_item',
        objectId: itemId,
        after: { state: input.state },
      });
      const [planning] = await this.readPlanning(client, engagementId);
      return planning!;
    });
  }

  // ── Materiality (§21) ───────────────────────────────────────────────────────

  async setMateriality(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: {
      overallMateriality?: number | null;
      performanceMateriality?: number | null;
      clearlyTrivialThreshold?: number | null;
      benchmark?: string | null;
      basis?: string | null;
      version?: number;
    },
  ): Promise<StatutoryAuditPlanning> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertNotApproved(client, workflowInstanceId);
      // Once 03.3 is in use it owns the determination and publishes this row.
      const { rows: determined } = await client.query(
        `SELECT 1 FROM hsdg.audit_materiality_determination WHERE workflow_instance_id = $1 LIMIT 1`,
        [workflowInstanceId],
      );
      if (determined[0]) {
        throw new ConflictException(
          'Materiality is determined in 03.3 Materiality — change it there (a completed version needs a revision).',
        );
      }

      const { rows: existing } = await client.query<{ version: number }>(
        `SELECT version FROM hsdg.audit_materiality WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const params = [
        workflowInstanceId,
        engagementId,
        input.overallMateriality ?? null,
        input.performanceMateriality ?? null,
        input.clearlyTrivialThreshold ?? null,
        input.benchmark?.trim() || null,
        input.basis?.trim() || null,
        ctx.employeeId ?? null,
      ];

      if (!existing[0]) {
        await client.query(
          `INSERT INTO hsdg.audit_materiality
             (workflow_instance_id, engagement_id, overall_materiality, performance_materiality,
              clearly_trivial_threshold, benchmark, basis, decided_by_employee_id, decided_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
          params,
        );
      } else {
        // Optimistic concurrency when the caller supplies the version it saw.
        if (input.version != null && input.version !== existing[0].version) {
          throw new ConflictException(
            'Materiality changed since you loaded it; refresh and retry.',
          );
        }
        await client.query(
          `UPDATE hsdg.audit_materiality
              SET overall_materiality = $3, performance_materiality = $4,
                  clearly_trivial_threshold = $5, benchmark = $6, basis = $7,
                  decided_by_employee_id = $8, decided_at = now(), version = version + 1
            WHERE workflow_instance_id = $1`,
          params,
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_set',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { overall: input.overallMateriality ?? null },
      });
      const [planning] = await this.readPlanning(client, engagementId);
      return planning!;
    });
  }

  // ── Planning approval (§21) ─────────────────────────────────────────────────

  /**
   * Approve Planning: the framework must be approved and every sub-area complete.
   * Freezes a versioned snapshot, marks Phase 03 complete and unlocks Phase 04
   * (Risk). Blocked if already approved (until a reassessment reopens it).
   */
  async approvePlanning(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { memo?: string | null },
  ): Promise<StatutoryAuditPlanning> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);

      const { rows: fw } = await client.query(
        `SELECT 1 FROM hsdg.audit_framework_approvals WHERE workflow_instance_id = $1 LIMIT 1`,
        [workflowInstanceId],
      );
      if (!fw[0]) {
        throw new ConflictException('Approve the Framework Memo before approving Planning (§21).');
      }

      const { rows: items } = await client.query<{ item_key: string; state: PlanningItemState }>(
        `SELECT item_key, state FROM hsdg.audit_planning_items
          WHERE workflow_instance_id = $1 ORDER BY sort_order ASC`,
        [workflowInstanceId],
      );
      if (items.length === 0) throw new NotFoundException('Planning not initialised.');
      const incomplete = incompletePlanningCount(items.map((i) => i.state));
      if (incomplete > 0) {
        throw new BadRequestException(`${incomplete} planning sub-area(s) are not yet complete.`);
      }

      const { rows: existingApproval } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
           FROM hsdg.audit_planning_approvals WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const version = existingApproval[0]!.next;
      if (version > 1) {
        // Already approved at least once. Re-approval is permitted only when a
        // SA-9 reassessment has re-opened planning (its phase → needs_attention);
        // otherwise history is never rewritten (§30).
        const { rows: phase } = await client.query<{ state: string }>(
          `SELECT state FROM hsdg.audit_workflow_phases
            WHERE workflow_instance_id = $1 AND phase_key = 'planning'`,
          [workflowInstanceId],
        );
        if (phase[0]?.state !== 'needs_attention') {
          throw new ConflictException('Planning is already approved.');
        }
      }

      const { rows: matRows } = await client.query<MaterialityRow>(
        `SELECT workflow_instance_id, overall_materiality, performance_materiality,
                clearly_trivial_threshold, benchmark, basis, null AS decided_by_name,
                decided_at, version
           FROM hsdg.audit_materiality WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const snapshot = {
        items: items.map((i) => ({ itemKey: i.item_key, state: i.state })),
        materiality: matRows[0]
          ? {
              overallMateriality: num(matRows[0].overall_materiality),
              performanceMateriality: num(matRows[0].performance_materiality),
              clearlyTrivialThreshold: num(matRows[0].clearly_trivial_threshold),
              benchmark: matRows[0].benchmark,
              basis: matRows[0].basis,
            }
          : null,
      };

      try {
        await client.query(
          `INSERT INTO hsdg.audit_planning_approvals
             (workflow_instance_id, engagement_id, version, memo, snapshot, approved_by_employee_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            workflowInstanceId,
            engagementId,
            version,
            input.memo?.trim() || null,
            JSON.stringify(snapshot),
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('Planning was approved concurrently; refresh and retry.');
        }
        throw err;
      }

      // Mark Phase 03 complete and unlock Phase 04 (Risk) — the §7 progressive
      // unlock. Only lift the lock; never downgrade risk if it is already open.
      await client.query(
        `UPDATE hsdg.audit_workflow_phases
            SET state = 'complete'
          WHERE workflow_instance_id = $1 AND phase_key = 'planning'`,
        [workflowInstanceId],
      );
      await client.query(
        `UPDATE hsdg.audit_workflow_phases
            SET state = 'in_progress'
          WHERE workflow_instance_id = $1 AND phase_key = 'risk' AND state = 'locked'`,
        [workflowInstanceId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_approved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { version, items: items.length },
      });

      const [planning] = await this.readPlanning(client, engagementId);
      return planning!;
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }

  /** Planning content is frozen once approved (history is never rewritten, §30). */
  private async assertNotApproved(client: PoolClient, workflowInstanceId: string): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_planning_approvals WHERE workflow_instance_id = $1 LIMIT 1`,
      [workflowInstanceId],
    );
    if (rows[0]) {
      throw new ConflictException('Planning is approved; reopen it before editing.');
    }
  }
}

function mapItem(r: PlanningItemRow): PlanningItem {
  return {
    id: r.id,
    itemKey: r.item_key,
    title: r.title,
    state: r.state,
    narrative: r.narrative,
    updatedByName: r.updated_by_name,
    updatedAt: r.content_updated_at ? r.content_updated_at.toISOString() : null,
    sortOrder: r.sort_order,
    version: r.version,
  };
}

function mapMateriality(r: MaterialityRow): Materiality {
  return {
    overallMateriality: num(r.overall_materiality),
    performanceMateriality: num(r.performance_materiality),
    clearlyTrivialThreshold: num(r.clearly_trivial_threshold),
    benchmark: r.benchmark,
    basis: r.basis,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    version: r.version,
  };
}

function mapApproval(r: ApprovalRow): PlanningApproval {
  return {
    id: r.id,
    version: r.version,
    memo: r.memo,
    approvedByName: r.approved_by_name,
    approvedAt: r.approved_at.toISOString(),
  };
}

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

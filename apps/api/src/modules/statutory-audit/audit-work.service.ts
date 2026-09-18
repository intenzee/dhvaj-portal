import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  financialMovement,
  WORK_AREA_PROGRESSED_STATES,
  type AreaConclusionState,
  type AreaRiskLevel,
  type AuditWorkArea,
  type FrameworkConclusion,
  type StatutoryAuditWorkGeneration,
  type WorkAreaState,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { planWorkAreas, type FrameworkConclusionMap } from './work-generation';

interface WorkAreaRow {
  id: string;
  work_area_key: string;
  title: string;
  scope: string | null;
  source: string;
  origin_area_key: string | null;
  state: WorkAreaState;
  is_active: boolean;
  generated_from_version: number | null;
  sort_order: number;
  // §11 area-detail overlay (SA-5).
  owner_employee_id: string | null;
  owner_name: string | null;
  reviewer_employee_id: string | null;
  reviewer_name: string | null;
  risk_level: AreaRiskLevel | null;
  materiality: string | null;
  // DATE columns come back as raw 'YYYY-MM-DD' strings (see database/pg-types.ts).
  due_date: string | null;
  financial_current: string | null;
  financial_prior: string | null;
  financial_source: string | null;
  conclusion: string | null;
  conclusion_state: AreaConclusionState;
  detail_version: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Statutory Audit — Framework → Dynamic Work Generation (Audit Spec §20).
 *
 * Generation reads the APPROVED framework conclusions and materialises the
 * applicable work areas. It is idempotent (§20, §36): the desired set is upserted
 * by (workflow_instance_id, work_area_key), so re-running never duplicates. An
 * area a later framework change makes not-applicable is DEACTIVATED, never
 * deleted — completed work is preserved (§20 "Existing completed work is never
 * silently deleted", §30).
 */
@Injectable()
export class AuditWorkService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  /** The generated work-area layer for an engagement's statutory-audit shell(s). */
  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditWorkGeneration[]> {
    return this.db.withRlsContext(ctx, (client) => this.readGeneration(client, engagementId));
  }

  private async readGeneration(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditWorkGeneration[]> {
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

    const { rows: areas } = await client.query<WorkAreaRow & { workflow_instance_id: string }>(
      `SELECT a.id, a.workflow_instance_id, a.work_area_key, a.title, a.scope, a.source,
              a.origin_area_key, a.state, a.is_active, a.generated_from_version, a.sort_order,
              a.owner_employee_id, owner.full_name AS owner_name,
              a.reviewer_employee_id, reviewer.full_name AS reviewer_name,
              a.risk_level, a.materiality, a.due_date, a.financial_current, a.financial_prior,
              a.financial_source, a.conclusion, a.conclusion_state, a.detail_version,
              a.created_at, a.updated_at
         FROM hsdg.audit_work_areas a
         LEFT JOIN hsdg.employees owner ON owner.id = a.owner_employee_id
         LEFT JOIN hsdg.employees reviewer ON reviewer.id = a.reviewer_employee_id
        WHERE a.workflow_instance_id = ANY($1::uuid[])
        ORDER BY a.is_active DESC, a.sort_order ASC`,
      [shellIds],
    );

    // Latest framework approval version per shell (the generation gate + provenance).
    const { rows: approvals } = await client.query<{
      workflow_instance_id: string;
      version: number;
    }>(
      `SELECT DISTINCT ON (workflow_instance_id) workflow_instance_id, version
         FROM hsdg.audit_framework_approvals
        WHERE workflow_instance_id = ANY($1::uuid[])
        ORDER BY workflow_instance_id, version DESC`,
      [shellIds],
    );

    return shells.map((shell) => {
      const shellAreas = areas.filter((a) => a.workflow_instance_id === shell.id);
      const approvalVersion =
        approvals.find((ap) => ap.workflow_instance_id === shell.id)?.version ?? null;
      const generatedVersions = shellAreas
        .map((a) => a.generated_from_version)
        .filter((v): v is number => v != null);
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        frameworkApproved: approvalVersion != null,
        generatedFromVersion: generatedVersions.length ? Math.max(...generatedVersions) : null,
        areas: shellAreas.map(mapWorkArea),
        activeCount: shellAreas.filter((a) => a.is_active).length,
      };
    });
  }

  // ── Generation (§20) ────────────────────────────────────────────────────────

  /**
   * Generate (or re-generate) the applicable work areas from the approved
   * framework. Blocked until the Framework Memo is approved (§20 "APPROVED
   * FRAMEWORK → APPLICABLE WORK AREAS"). Idempotent — a repeat run produces no
   * duplicate and only diffs against what already exists. Lead-only.
   */
  async generate(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditWorkGeneration> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);

      // Gate: the framework must be approved (§20). The version is provenance.
      const { rows: verRows } = await client.query<{ version: number }>(
        `SELECT version FROM hsdg.audit_framework_approvals
          WHERE workflow_instance_id = $1
          ORDER BY version DESC LIMIT 1`,
        [workflowInstanceId],
      );
      const approvalVersion = verRows[0]?.version ?? null;
      if (approvalVersion == null) {
        throw new ConflictException('Approve the Framework Memo before generating work (§20).');
      }

      // The approved applicability conclusions drive WHAT applies.
      const { rows: conclusionRows } = await client.query<{
        area_key: string;
        conclusion: FrameworkConclusion | null;
      }>(
        `SELECT area_key, conclusion
           FROM hsdg.audit_framework_assessments
          WHERE workflow_instance_id = $1 AND conclusion IS NOT NULL`,
        [workflowInstanceId],
      );
      const conclusions: FrameworkConclusionMap = new Map(
        conclusionRows
          .filter(
            (r): r is { area_key: string; conclusion: FrameworkConclusion } => r.conclusion != null,
          )
          .map((r) => [r.area_key, r.conclusion]),
      );
      const desired = planWorkAreas(conclusions);
      const desiredKeys = new Set<string>(desired.map((d) => d.workAreaKey));

      // Existing areas (to diff — never blindly delete/recreate).
      const { rows: existing } = await client.query<{
        work_area_key: string;
        state: WorkAreaState;
        is_active: boolean;
      }>(
        `SELECT work_area_key, state, is_active
           FROM hsdg.audit_work_areas
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const existingByKey = new Map(existing.map((e) => [e.work_area_key, e]));

      let created = 0;
      let reactivated = 0;

      // Upsert the desired set. ON CONFLICT reactivates + refreshes provenance,
      // but never touches the professional state (progress is preserved).
      for (const d of desired) {
        const prior = existingByKey.get(d.workAreaKey);
        const result = await client.query(
          `INSERT INTO hsdg.audit_work_areas
             (workflow_instance_id, engagement_id, work_area_key, title, scope, source,
              origin_area_key, sort_order, is_active, generated_from_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
           ON CONFLICT (workflow_instance_id, work_area_key) DO UPDATE
             SET title = EXCLUDED.title,
                 scope = EXCLUDED.scope,
                 source = EXCLUDED.source,
                 origin_area_key = EXCLUDED.origin_area_key,
                 sort_order = EXCLUDED.sort_order,
                 is_active = true,
                 generated_from_version = EXCLUDED.generated_from_version`,
          [
            workflowInstanceId,
            engagementId,
            d.workAreaKey,
            d.title,
            d.scope,
            d.source,
            d.originAreaKey,
            d.sortOrder,
            approvalVersion,
          ],
        );
        if (!prior) created += 1;
        else if (!prior.is_active) reactivated += 1;
        void result;
      }

      // Deactivate areas no longer applicable — never delete (§20). Progressed
      // areas are flagged needs_attention so the reviewer sees an area that has
      // work but is no longer indicated; untouched ones simply go inactive.
      let deactivated = 0;
      for (const e of existing) {
        if (desiredKeys.has(e.work_area_key) || !e.is_active) continue;
        const hasProgress = WORK_AREA_PROGRESSED_STATES.includes(e.state);
        await client.query(
          `UPDATE hsdg.audit_work_areas
              SET is_active = false${hasProgress ? ", state = 'needs_attention'" : ''}
            WHERE workflow_instance_id = $1 AND work_area_key = $2`,
          [workflowInstanceId, e.work_area_key],
        );
        deactivated += 1;
      }

      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.work_generated',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: {
          frameworkVersion: approvalVersion,
          desired: desired.length,
          created,
          reactivated,
          deactivated,
        },
      });

      const [generation] = await this.readGeneration(client, engagementId);
      return generation!;
    });
  }

  // ── §11 area-detail overlay (SA-5) ──────────────────────────────────────────

  /**
   * Update the §11 professional detail on a work area — ownership, risk,
   * materiality, timing, financial data and conclusion (incl. draft/submitted).
   * PATCH semantics (an omitted field is unchanged; explicit null clears) with
   * optimistic concurrency on `detailVersion`. Never touches the generation
   * provenance, so a later framework regeneration still preserves it.
   */
  async updateAreaDetail(
    ctx: RlsContext,
    engagementId: string,
    workAreaId: string,
    input: {
      ownerEmployeeId?: string | null;
      reviewerEmployeeId?: string | null;
      riskLevel?: AreaRiskLevel | null;
      materiality?: number | null;
      dueDate?: string | null;
      financialCurrent?: number | null;
      financialPrior?: number | null;
      financialSource?: string | null;
      conclusion?: string | null;
      conclusionState?: AreaConclusionState;
      detailVersion: number;
    },
  ): Promise<StatutoryAuditWorkGeneration> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.audit_work_areas WHERE id = $1 AND engagement_id = $2`,
        [workAreaId, engagementId],
      );
      if (!rows[0]) throw new NotFoundException('Audit area not found on this engagement.');

      const params: unknown[] = [workAreaId, input.detailVersion];
      const sets: string[] = [];
      const set = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.ownerEmployeeId !== undefined)
        set('owner_employee_id', input.ownerEmployeeId ?? null);
      if (input.reviewerEmployeeId !== undefined)
        set('reviewer_employee_id', input.reviewerEmployeeId ?? null);
      if (input.riskLevel !== undefined) set('risk_level', input.riskLevel ?? null);
      if (input.materiality !== undefined) set('materiality', input.materiality ?? null);
      if (input.dueDate !== undefined) set('due_date', input.dueDate ?? null);
      if (input.financialCurrent !== undefined)
        set('financial_current', input.financialCurrent ?? null);
      if (input.financialPrior !== undefined) set('financial_prior', input.financialPrior ?? null);
      if (input.financialSource !== undefined)
        set('financial_source', input.financialSource?.trim() || null);
      if (input.conclusion !== undefined) set('conclusion', input.conclusion?.trim() || null);
      if (input.conclusionState !== undefined) set('conclusion_state', input.conclusionState);

      if (sets.length === 0) throw new BadRequestException('No area-detail fields to update.');

      const result = await client.query(
        `UPDATE hsdg.audit_work_areas
            SET ${sets.join(', ')}, detail_version = detail_version + 1
          WHERE id = $1 AND detail_version = $2`,
        params,
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('This area changed since you loaded it; refresh and retry.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.area_detail_updated',
        objectType: 'audit_work_area',
        objectId: workAreaId,
        after: { conclusionState: input.conclusionState },
      });
      const [generation] = await this.readGeneration(client, engagementId);
      return generation!;
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
}

function mapWorkArea(a: WorkAreaRow): AuditWorkArea {
  const current = num(a.financial_current);
  const prior = num(a.financial_prior);
  return {
    id: a.id,
    workAreaKey: a.work_area_key,
    title: a.title,
    scope: a.scope,
    source: a.source,
    originAreaKey: a.origin_area_key,
    state: a.state,
    isActive: a.is_active,
    generatedFromVersion: a.generated_from_version,
    sortOrder: a.sort_order,
    detail: {
      ownerEmployeeId: a.owner_employee_id,
      ownerName: a.owner_name,
      reviewerEmployeeId: a.reviewer_employee_id,
      reviewerName: a.reviewer_name,
      riskLevel: a.risk_level,
      materiality: num(a.materiality),
      dueDate: a.due_date,
      financialCurrent: current,
      financialPrior: prior,
      financialMovement: financialMovement(current, prior),
      financialSource: a.financial_source,
      conclusion: a.conclusion,
      conclusionState: a.conclusion_state,
      detailVersion: a.detail_version,
    },
    createdAt: a.created_at.toISOString(),
    updatedAt: a.updated_at.toISOString(),
  };
}

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

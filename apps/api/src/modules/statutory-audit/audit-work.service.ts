import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FINANCIAL_UNIT_LABEL,
  financialMovement,
  nextProcedureRef,
  WORK_AREA_PROGRESSED_STATES,
  type AreaConclusionState,
  type AreaRiskLevel,
  type AuditWorkArea,
  type ExceptionStatus,
  type FrameworkConclusion,
  type ProcedureState,
  type StatutoryAuditWorkGeneration,
  type WorkAreaState,
  type WorkSuggestionResult,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { planWorkAreas, type FrameworkConclusionMap } from './work-generation';
import { AuditAreaReviewService } from './audit-area-review.service';
import { AuditRiskService } from './audit-risk.service';
import { AuditFrameworkDownstreamService } from './audit-framework-downstream.service';
import { AuditCaroProgrammeService } from './audit-caro-programme.service';
import { AuditIcfrControlsService } from './audit-icfr-controls.service';
import { AuditGroupAuditService } from './audit-group-audit.service';
import { isEngagementLead } from './master-facts';
import {
  areaForRisk,
  fsWorkAreaKey,
  planAreaDetail,
  planPlanningWorkAreas,
  suggestProcedures,
  type FsAreaInput,
  type RiskInput,
} from './work-automation';
import {
  conclusionReady,
  draftAreaConclusion,
  planWork,
  proceduresIn,
  type WorkPackFacts,
  type WorkPackProcedure,
  type WorkPackRisk,
} from './work-packs';

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
  reviewed_at: Date | null;
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
    private readonly areaReview: AuditAreaReviewService,
    private readonly risk: AuditRiskService,
    private readonly downstream: AuditFrameworkDownstreamService,
    private readonly caroProgramme: AuditCaroProgrammeService,
    private readonly icfrControls: AuditIcfrControlsService,
    private readonly groupAudit: AuditGroupAuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * The generated work-area layer for an engagement's statutory-audit shell(s).
   * Once the framework is approved, the first open by a lead (and the first
   * open after a new framework approval) builds the audit work itself — no
   * "Generate work" click needed.
   */
  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditWorkGeneration[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: due } = await client.query<{ id: string }>(
        `SELECT swi.id
           FROM hsdg.service_workflow_instances swi
           JOIN LATERAL (SELECT max(version) AS v FROM hsdg.audit_framework_approvals fa
                          WHERE fa.workflow_instance_id = swi.id) ap ON ap.v IS NOT NULL
          WHERE swi.engagement_id = $1 AND swi.status <> 'cancelled'
            AND (NOT EXISTS (SELECT 1 FROM hsdg.audit_work_suggestion_log l
                              WHERE l.workflow_instance_id = swi.id AND l.source_key = 'seeded')
                 OR ap.v > COALESCE((SELECT max(generated_from_version) FROM hsdg.audit_work_areas w
                                      WHERE w.workflow_instance_id = swi.id), 0))`,
        [engagementId],
      );
      if (due.length && (await isEngagementLead(client, engagementId))) {
        for (const sh of due) await this.buildWork(client, ctx, engagementId, sh.id, true);
      }
      return this.readGeneration(client, engagementId);
    });
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
        WHERE engagement_id = $1 AND status <> 'cancelled'
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
              a.reviewed_at, a.created_at, a.updated_at
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

    const facts = await this.readPackFacts(client, shellIds);
    const today = new Date().toISOString().slice(0, 10);

    return shells.map((shell) => {
      const shellAreas = areas.filter((a) => a.workflow_instance_id === shell.id);
      const procedures = facts.procedures.get(shell.id) ?? [];
      const approvalVersion =
        approvals.find((ap) => ap.workflow_instance_id === shell.id)?.version ?? null;
      const generatedVersions = shellAreas
        .map((a) => a.generated_from_version)
        .filter((v): v is number => v != null);
      const workFacts: WorkPackFacts = {
        frameworkApproved: approvalVersion != null,
        areas: shellAreas.map((a) => ({
          id: a.id,
          workAreaKey: a.work_area_key,
          title: a.title,
          isActive: a.is_active,
          ownerName: a.owner_name,
          reviewerName: a.reviewer_name,
          dueDate: a.due_date,
          materiality: num(a.materiality),
          conclusion: a.conclusion,
          conclusionState: a.conclusion_state,
          reviewed: a.reviewed_at != null,
        })),
        procedures,
        risks: facts.risks.get(shell.id) ?? [],
        today,
      };
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        frameworkApproved: approvalVersion != null,
        generatedFromVersion: generatedVersions.length ? Math.max(...generatedVersions) : null,
        areas: shellAreas.map((a) =>
          mapWorkArea(
            a,
            draftAreaConclusion(
              { title: a.title, materiality: num(a.materiality) },
              proceduresIn(a.id, procedures),
            ),
          ),
        ),
        activeCount: shellAreas.filter((a) => a.is_active).length,
        pack: planWork(workFacts, 'audit_areas'),
        controlsPack: planWork(workFacts, 'controls'),
      };
    });
  }

  /** Procedures (with their areas, evidence and exceptions) and risks, per shell. */
  private async readPackFacts(
    client: PoolClient,
    shellIds: string[],
  ): Promise<{
    procedures: Map<string, WorkPackProcedure[]>;
    risks: Map<string, WorkPackRisk[]>;
  }> {
    const { rows: procs } = await client.query<{
      id: string;
      workflow_instance_id: string;
      procedure_ref: string;
      title: string;
      state: ProcedureState;
      conclusion: string | null;
      work_area_id: string;
      risk_id: string | null;
      linked: string[] | null;
      evidence: number;
    }>(
      `SELECT p.id, p.workflow_instance_id, p.procedure_ref, p.title, p.state, p.conclusion,
              p.work_area_id, p.risk_id,
              (SELECT array_agg(pa.work_area_id) FROM hsdg.audit_procedure_areas pa
                WHERE pa.procedure_id = p.id) AS linked,
              (SELECT count(*)::int FROM hsdg.audit_evidence_procedures ep
                WHERE ep.procedure_id = p.id) AS evidence
         FROM hsdg.audit_procedures p
        WHERE p.workflow_instance_id = ANY($1::uuid[])
        ORDER BY p.created_at ASC`,
      [shellIds],
    );
    const { rows: exceptions } = await client.query<{
      procedure_id: string;
      description: string;
      status: ExceptionStatus;
      resolution: string | null;
    }>(
      `SELECT x.procedure_id, x.description, x.status, x.resolution
         FROM hsdg.audit_exceptions x
         JOIN hsdg.audit_procedures p ON p.id = x.procedure_id
        WHERE p.workflow_instance_id = ANY($1::uuid[])
        ORDER BY x.created_at ASC`,
      [shellIds],
    );
    const { rows: risks } = await client.query<{
      id: string;
      workflow_instance_id: string;
      risk_ref: string;
      description: string;
      is_significant: boolean;
    }>(
      `SELECT id, workflow_instance_id, risk_ref, description, is_significant
         FROM hsdg.audit_risks WHERE workflow_instance_id = ANY($1::uuid[])
        ORDER BY created_at ASC`,
      [shellIds],
    );

    const procedures = new Map<string, WorkPackProcedure[]>();
    for (const p of procs) {
      const list = procedures.get(p.workflow_instance_id) ?? [];
      list.push({
        ref: p.procedure_ref,
        title: p.title,
        state: p.state,
        conclusion: p.conclusion,
        areaIds: [p.work_area_id, ...(p.linked ?? []).filter((id) => id !== p.work_area_id)],
        riskId: p.risk_id,
        evidenceCount: p.evidence,
        exceptions: exceptions
          .filter((x) => x.procedure_id === p.id)
          .map((x) => ({ description: x.description, status: x.status, resolution: x.resolution })),
      });
      procedures.set(p.workflow_instance_id, list);
    }
    const byShell = new Map<string, WorkPackRisk[]>();
    for (const r of risks) {
      const list = byShell.get(r.workflow_instance_id) ?? [];
      list.push({
        id: r.id,
        riskRef: r.risk_ref,
        description: r.description,
        isSignificant: r.is_significant,
      });
      byShell.set(r.workflow_instance_id, list);
    }
    return { procedures, risks: byShell };
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
      await this.buildWork(client, ctx, engagementId, workflowInstanceId, false);
      const [generation] = await this.readGeneration(client, engagementId);
      return generation!;
    });
  }

  /**
   * "Refresh suggested work": re-runs generation, fills any blank area detail
   * and adds procedures Sections 03–04 now point to that were never suggested
   * on this file (a deleted suggestion stays deleted). Lead-only.
   */
  async suggestWork(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<WorkSuggestionResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const counts = await this.buildWork(client, ctx, engagementId, workflowInstanceId, false);
      const [generation] = await this.readGeneration(client, engagementId);
      return { generation: generation!, ...counts };
    });
  }

  /**
   * Generate the work areas (framework workstreams + 03.5 areas + overall
   * responses), fill blank area detail and suggest procedures. Blocked until
   * the Framework Memo is approved (§20).
   */
  private async buildWork(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    automatic: boolean,
  ): Promise<Omit<WorkSuggestionResult, 'generation'>> {
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
    // Section 04's suggested risks first, so their responses become procedures.
    await this.risk.ensureSeeded(client, ctx, engagementId, workflowInstanceId);
    const planning = await this.areaReview.retainedForWork(client, workflowInstanceId);
    const unitLabel = planning.datasetUnit ? FINANCIAL_UNIT_LABEL[planning.datasetUnit] : null;
    const fsAreas: FsAreaInput[] = planning.areas.map((a) => ({
      id: a.id,
      seq: a.seq,
      code: a.areaCode,
      name: a.areaName,
      aliases: a.aliases ?? [],
      attention: a.attention,
      cy: a.cyAmount,
      py: a.pyAmount,
      unitLabel: a.unit ? FINANCIAL_UNIT_LABEL[a.unit] : unitLabel,
      assertions: a.assertions.filter((x) => x.active).map((x) => x.assertionId),
    }));
    const areasAdded = await this.generateIn(
      client,
      ctx,
      engagementId,
      workflowInstanceId,
      approvalVersion,
      fsAreas,
    );
    const detailsFilled = await this.fillAreaDetail(
      client,
      engagementId,
      workflowInstanceId,
      fsAreas,
    );
    const proceduresAdded = await this.suggestOn(
      client,
      ctx,
      engagementId,
      workflowInstanceId,
      fsAreas,
      automatic,
    );
    await client.query(
      `INSERT INTO hsdg.audit_work_suggestion_log (workflow_instance_id, engagement_id, source_key)
       VALUES ($1, $2, 'seeded') ON CONFLICT DO NOTHING`,
      [workflowInstanceId, engagementId],
    );
    return { areasAdded, detailsFilled, proceduresAdded };
  }

  private async generateIn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    approvalVersion: number,
    fsAreas: readonly FsAreaInput[],
  ): Promise<number> {
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
    // The approved 02.2 result's downstream actions (02.2 §19): the Ind AS / AS
    // review framework and the Ind AS 101 transition work. A key the framework
    // blueprint already plans keeps the blueprint's provenance.
    const planned = [...planWorkAreas(conclusions), ...planPlanningWorkAreas(fsAreas)];
    const plannedKeys = new Set<string>(planned.map((d) => d.workAreaKey));
    const fromDownstream = (await this.downstream.workAreasOn(client, workflowInstanceId))
      .filter((a) => !plannedKeys.has(a.workAreaKey))
      .map((a) => ({
        workAreaKey: a.workAreaKey,
        title: a.title,
        scope: a.scope,
        source: `framework:02.2:${a.actionKey}`,
        originAreaKey: 'financial_reporting_framework',
        sortOrder: a.sortOrder,
      }));
    const desired = [...planned, ...fromDownstream];
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

    // Unlock the Audit Areas phase (§7 progressive unlock): generation is the
    // moment the audit file gains work, so Phase 06 moves locked → in_progress.
    // Only lift the lock — never downgrade a phase that is already progressing.
    // Without this the phase stays locked forever and the Audit Areas panel is
    // unreachable through the audit-file nav (nav gates clicks on !== locked).
    await client.query(
      `UPDATE hsdg.audit_workflow_phases
          SET state = 'in_progress'
        WHERE workflow_instance_id = $1 AND phase_key = 'audit_areas' AND state IN ('locked', 'not_started')`,
      [workflowInstanceId],
    );
    // Make the Completion phase (07) reachable too: the completion checklist
    // (subsequent events, going concern, …) runs alongside fieldwork, and the
    // hard §28/§29 gates live on the Approve/Sign-off/Archive actions, not on
    // opening the panel (§31 — locks are informational, RLS is the real gate).
    // Lift only the lock, to not_started, so the nav can open it without
    // overstating progress. Reporting/Sign-off/Archive stay locked until their
    // own SA-8 gates (approveCompletion → reporting, signOff → archiving).
    await client.query(
      `UPDATE hsdg.audit_workflow_phases
          SET state = 'not_started'
        WHERE workflow_instance_id = $1 AND phase_key = 'completion' AND state = 'locked'`,
      [workflowInstanceId],
    );

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
    return created + reactivated;
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
      let conclusion =
        input.conclusion === undefined ? undefined : input.conclusion?.trim() || null;
      if (input.conclusionState === 'submitted') {
        // Submitted with the conclusion blank: record the one drafted from the
        // area's procedures — only once every procedure is complete.
        const gen = (await this.readGeneration(client, engagementId)).find((g) =>
          g.areas.some((a) => a.id === workAreaId),
        );
        const area = gen?.areas.find((a) => a.id === workAreaId);
        const blank = conclusion === undefined ? !area?.detail.conclusion : conclusion == null;
        if (blank) {
          const facts = await this.readPackFacts(client, [gen!.workflowInstanceId]);
          const procs = proceduresIn(
            workAreaId,
            facts.procedures.get(gen!.workflowInstanceId) ?? [],
          );
          if (!conclusionReady(procs) || !area?.draftConclusion) {
            throw new BadRequestException(
              procs.length === 0
                ? 'Write the conclusion — this area has no procedures to draft it from.'
                : `Write the conclusion, or complete the ${procs.filter((p) => p.state !== 'complete').length} open procedure(s) to have it drafted.`,
            );
          }
          conclusion = area.draftConclusion;
        }
      }
      if (conclusion !== undefined) set('conclusion', conclusion);
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

  // ── Section 05 / 06 automation ─────────────────────────────────────────────

  private async readRisks(client: PoolClient, wi: string): Promise<RiskInput[]> {
    const { rows } = await client.query<{
      id: string;
      risk_ref: string;
      description: string;
      fs_area: string | null;
      assertion: RiskInput['assertion'];
      rating: RiskInput['rating'];
      is_significant: boolean;
      is_fraud_risk: boolean;
      response: string | null;
      status: string;
      source_key: string | null;
    }>(
      `SELECT id, risk_ref, description, fs_area, assertion, rating, is_significant,
              is_fraud_risk, response, status, source_key
         FROM hsdg.audit_risks WHERE workflow_instance_id = $1 ORDER BY created_at`,
      [wi],
    );
    return rows.map((r) => ({
      id: r.id,
      ref: r.risk_ref,
      description: r.description,
      fsArea: r.fs_area,
      assertion: r.assertion,
      rating: r.rating,
      isSignificant: r.is_significant,
      isFraudRisk: r.is_fraud_risk,
      response: r.response,
      status: r.status,
      sourceKey: r.source_key,
    }));
  }

  private async readLeads(
    client: PoolClient,
    engagementId: string,
  ): Promise<{ owner: string | null; reviewer: string | null; dueDate: string | null }> {
    const { rows } = await client.query<{
      engagement_partner_id: string | null;
      engagement_manager_id: string | null;
      planned_end_date: string | null;
    }>(
      `SELECT engagement_partner_id, engagement_manager_id, planned_end_date
         FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    const e = rows[0];
    return {
      owner: e?.engagement_manager_id ?? e?.engagement_partner_id ?? null,
      reviewer: e?.engagement_partner_id ?? null,
      dueDate: e?.planned_end_date ?? null,
    };
  }

  /** Owner, reviewer, risk, materiality, due date and figures — blanks only. */
  private async fillAreaDetail(
    client: PoolClient,
    engagementId: string,
    wi: string,
    fsAreas: readonly FsAreaInput[],
  ): Promise<number> {
    const leads = await this.readLeads(client, engagementId);
    const { rows: mat } = await client.query<{ id: string; selected_pm: string | null }>(
      `SELECT id, selected_pm::text FROM hsdg.audit_materiality_determination
        WHERE workflow_instance_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [wi],
    );
    const { rows: specific } = mat[0]
      ? await client.query<{ specific_pm: string | null; affected_areas: string[] }>(
          `SELECT specific_pm::text, affected_areas FROM hsdg.audit_materiality_specific
            WHERE determination_id = $1`,
          [mat[0].id],
        )
      : { rows: [] };
    const facts = {
      ownerId: leads.owner,
      reviewerId: leads.reviewer,
      dueDate: leads.dueDate,
      performanceMateriality: num(mat[0]?.selected_pm ?? null),
      specific: specific.map((x) => ({
        pm: num(x.specific_pm),
        affectedAreas: x.affected_areas ?? [],
      })),
    };
    const risks = (await this.readRisks(client, wi)).filter((r) => r.status !== 'concluded');
    const fsByKey = new Map(fsAreas.map((a) => [fsWorkAreaKey(a), a]));
    const risksByKey = new Map<string, RiskInput[]>();
    for (const r of risks) {
      const a = areaForRisk(r, fsAreas);
      const key = a ? fsWorkAreaKey(a) : 'overall_responses';
      risksByKey.set(key, [...(risksByKey.get(key) ?? []), r]);
    }
    const { rows: areas } = await client.query<WorkAreaRow>(
      `SELECT * FROM hsdg.audit_work_areas WHERE workflow_instance_id = $1 AND is_active`,
      [wi],
    );
    let filled = 0;
    for (const a of areas) {
      const patch = planAreaDetail({
        workAreaKey: a.work_area_key,
        current: {
          ownerEmployeeId: a.owner_employee_id,
          reviewerEmployeeId: a.reviewer_employee_id,
          riskLevel: a.risk_level,
          materiality: num(a.materiality),
          dueDate: a.due_date,
          financialCurrent: num(a.financial_current),
          financialPrior: num(a.financial_prior),
        },
        fsArea: fsByKey.get(a.work_area_key) ?? null,
        risks: risksByKey.get(a.work_area_key) ?? [],
        facts,
      });
      const cols: Record<string, string> = {
        ownerEmployeeId: 'owner_employee_id',
        reviewerEmployeeId: 'reviewer_employee_id',
        riskLevel: 'risk_level',
        materiality: 'materiality',
        dueDate: 'due_date',
        financialCurrent: 'financial_current',
        financialPrior: 'financial_prior',
        financialSource: 'financial_source',
      };
      const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
      if (entries.length === 0) continue;
      const params: unknown[] = [a.id];
      const sets = entries.map(([k, v]) => {
        params.push(v);
        return `${cols[k]} = $${params.length}`;
      });
      await client.query(
        `UPDATE hsdg.audit_work_areas
            SET ${sets.join(', ')}, detail_version = detail_version + 1
          WHERE id = $1`,
        params,
      );
      filled += entries.filter(([k]) => k !== 'financialSource').length;
    }
    return filled;
  }

  /** Insert the suggested procedures never suggested on this file before. */
  private async suggestOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    wi: string,
    fsAreas: readonly FsAreaInput[],
    automatic: boolean,
  ): Promise<number> {
    const { rows: areas } = await client.query<{
      id: string;
      work_area_key: string;
      owner_employee_id: string | null;
      reviewer_employee_id: string | null;
      due_date: string | null;
    }>(
      `SELECT id, work_area_key, owner_employee_id, reviewer_employee_id, due_date
         FROM hsdg.audit_work_areas WHERE workflow_instance_id = $1 AND is_active`,
      [wi],
    );
    const areaByKey = new Map(areas.map((a) => [a.work_area_key, a]));
    const planned = suggestProcedures({
      areaKeys: new Set(areaByKey.keys()),
      fsAreas,
      risks: await this.readRisks(client, wi),
      smcRelaxations: await this.downstream.smcRelaxationsOn(client, wi),
      caroClauses: await this.caroProgramme.clauseProceduresOn(client, ctx, engagementId, wi),
      icfrProcedures: await this.icfrControls.icfrProceduresOn(client, ctx, engagementId, wi),
      consolidationProcedures: await this.groupAudit.consolidationProceduresOn(
        client,
        engagementId,
        wi,
      ),
    });
    const { rows: logged } = await client.query<{ source_key: string }>(
      `SELECT source_key FROM hsdg.audit_work_suggestion_log WHERE workflow_instance_id = $1`,
      [wi],
    );
    const seen = new Set(logged.map((l) => l.source_key));
    const fresh = planned.filter((p) => !seen.has(p.sourceKey));
    if (fresh.length === 0) return 0;
    const leads = await this.readLeads(client, engagementId);
    const { rows: existing } = await client.query<{ procedure_ref: string }>(
      `SELECT procedure_ref FROM hsdg.audit_procedures WHERE engagement_id = $1`,
      [engagementId],
    );
    const refs = existing.map((r) => r.procedure_ref);
    let added = 0;
    for (const p of fresh) {
      const area = areaByKey.get(p.workAreaKey)!;
      const ref = nextProcedureRef(refs);
      refs.push(ref);
      const res = await client.query(
        `INSERT INTO hsdg.audit_procedures
           (workflow_instance_id, engagement_id, work_area_id, procedure_ref, title, objective,
            assertions, risk_id, owner_employee_id, reviewer_employee_id, due_date,
            expected_evidence, source_key, source_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT DO NOTHING`,
        [
          wi,
          engagementId,
          area.id,
          ref,
          p.title,
          p.objective,
          p.assertions,
          p.riskId,
          area.owner_employee_id ?? leads.owner,
          area.reviewer_employee_id ?? leads.reviewer,
          area.due_date ?? leads.dueDate,
          p.expectedEvidence,
          p.sourceKey,
          p.sourceNote,
        ],
      );
      added += res.rowCount ?? 0;
      await client.query(
        `INSERT INTO hsdg.audit_work_suggestion_log (workflow_instance_id, engagement_id, source_key)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [wi, engagementId, p.sourceKey],
      );
    }
    await this.caroProgramme.linkProceduresOn(client, wi);
    await this.icfrControls.linkProceduresOn(client, wi);
    await this.groupAudit.linkProceduresOn(client, wi);
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.work_suggested',
      objectType: 'service_workflow_instance',
      objectId: wi,
      after: { added: fresh.map((p) => p.sourceKey), automatic },
    });
    return added;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }
}

function mapWorkArea(a: WorkAreaRow, draftConclusion: string | null): AuditWorkArea {
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
    draftConclusion,
    reviewed: a.reviewed_at != null,
    createdAt: a.created_at.toISOString(),
    updatedAt: a.updated_at.toISOString(),
  };
}

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

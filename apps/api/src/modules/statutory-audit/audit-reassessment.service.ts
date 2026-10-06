import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  reassessmentImpact,
  REASSESSMENT_STATUS,
  type AuditReassessment,
  type ReassessmentChangeType,
  type ReassessmentImpact,
  type FrameworkConclusion,
  type ReassessmentDetection,
  type ReassessmentStatus,
  type StatutoryAuditReassessment,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { groupStructure, readEngagementMasterFacts } from './master-facts';
import {
  detectChanges,
  openDetections,
  reassessmentProgress,
  type DetectionFacts,
} from './reassessment-automation';
import { areaForRisk, type FsAreaInput } from './work-automation';
import { planWorkAreas } from './work-generation';

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
  detection_key: string | null;
  affected_area_ids: string[];
  affected_phases: string[];
}

export interface RaiseReassessmentInput {
  /** Required unless raising a detected change (which carries its own). */
  changeType?: ReassessmentChangeType;
  /** Optional when raising a detected change — its reason is used. */
  reason?: string | null;
  /** Raise this detected change: its type, reason, targeted scope and follow-through. */
  detectionKey?: string | null;
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
              cb.full_name AS resolved_by_name, r.resolved_at, r.version,
              r.detection_key, r.affected_area_ids, r.affected_phases
         FROM hsdg.audit_reassessments r
         LEFT JOIN hsdg.employees rb ON rb.id = r.raised_by_employee_id
         LEFT JOIN hsdg.employees cb ON cb.id = r.resolved_by_employee_id
        WHERE r.workflow_instance_id = ANY($1::uuid[])
        ORDER BY r.created_at DESC`,
      [shellIds],
    );

    const { rows: areas } = await client.query<{ id: string; concluded: boolean }>(
      `SELECT id, (conclusion_state = 'submitted' OR NOT is_active) AS concluded
         FROM hsdg.audit_work_areas WHERE workflow_instance_id = ANY($1::uuid[])`,
      [shellIds],
    );
    const concluded = new Map(areas.map((a) => [a.id, a.concluded]));
    const { rows: openPhases } = await client.query<{
      workflow_instance_id: string;
      phase_key: string;
    }>(
      `SELECT workflow_instance_id, phase_key FROM hsdg.audit_workflow_phases
        WHERE workflow_instance_id = ANY($1::uuid[]) AND state = 'needs_attention'`,
      [shellIds],
    );
    const { rows: dismissals } = await client.query<{
      workflow_instance_id: string;
      detection_key: string;
    }>(
      `SELECT workflow_instance_id, detection_key FROM hsdg.audit_reassessment_dismissals
        WHERE workflow_instance_id = ANY($1::uuid[])`,
      [shellIds],
    );
    const result: StatutoryAuditReassessment[] = [];
    for (const shell of shells) {
      const mine = events.filter((e) => e.workflow_instance_id === shell.id);
      const stillOpen = new Set(
        openPhases.filter((p) => p.workflow_instance_id === shell.id).map((p) => p.phase_key),
      );
      const shellEvents = mine.map((e) =>
        mapEvent(
          e,
          reassessmentProgress({
            status: e.status,
            flaggedAreas: (e.affected_area_ids ?? []).map((id) => ({
              concluded: concluded.get(id) ?? true,
            })),
            phasesStillOpen: (e.affected_phases ?? []).filter((p) => stillOpen.has(p)).length,
          }),
        ),
      );
      const detections = shell.archived
        ? []
        : openDetections(
            await this.detect(client, engagementId, shell.id),
            new Set(mine.map((e) => e.detection_key).filter((k): k is string => k != null)),
            new Set(
              dismissals
                .filter((d) => d.workflow_instance_id === shell.id)
                .map((d) => d.detection_key),
            ),
          );
      result.push({
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        locked: shell.archived,
        openCount: shellEvents.filter((e) => e.status === REASSESSMENT_STATUS.open).length,
        events: shellEvents,
        detections,
      });
    }
    return result;
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
      // A detected change is re-read from the file now — its type, reason,
      // scope and follow-through are the file's, not the caller's.
      let detection: ReassessmentDetection | null = null;
      if (input.detectionKey) {
        detection =
          (await this.detect(client, engagementId, workflowInstanceId)).find(
            (d) => d.key === input.detectionKey,
          ) ?? null;
        if (!detection) {
          throw new ConflictException('That change is no longer in the file — refresh.');
        }
        const { rows: raised } = await client.query(
          `SELECT 1 FROM hsdg.audit_reassessments
            WHERE workflow_instance_id = $1 AND detection_key = $2`,
          [workflowInstanceId, detection.key],
        );
        if (raised[0]) throw new ConflictException('This change has already been raised.');
      }
      const changeType = detection?.changeType ?? input.changeType;
      const reason = input.reason?.trim() || detection?.reason;
      if (!changeType) throw new BadRequestException('Choose the kind of change.');
      if (!reason) throw new BadRequestException('Give the reason for the change.');
      const impact = reassessmentImpact(changeType);
      const parts: string[] = [];
      const phases: string[] = [];
      const reopen = async (phase: string): Promise<void> => {
        if (await this.reopenPhase(client, workflowInstanceId, phase)) phases.push(phase);
      };
      // Framework applicability → re-open approved areas for re-conclusion (§30).
      if (impact.framework) {
        const r = await client.query(
          `UPDATE hsdg.audit_framework_assessments
              SET state = 'reassessment_required'
            WHERE workflow_instance_id = $1 AND state = 'approved'`,
          [workflowInstanceId],
        );
        if (r.rowCount) parts.push(`${r.rowCount} framework area(s)`);
        await reopen('framework');
      }
      // Audit-area work → flag progressed active areas and reset their conclusion,
      // so they must be re-done and re-reviewed before the §29 completion gate
      // clears (§30). A detected change flags only the areas it concerns.
      let flagged: string[] = [];
      if (impact.work) {
        const scope = detection?.scopeAreaIds ?? [];
        const { rows } = await client.query<{ id: string }>(
          `UPDATE hsdg.audit_work_areas
              SET state = 'needs_attention', conclusion_state = 'draft'
            WHERE workflow_instance_id = $1 AND is_active = true
              AND state IN ('in_progress','complete','needs_attention')
              AND (cardinality($2::uuid[]) = 0 OR id = ANY($2::uuid[]))
            RETURNING id`,
          [workflowInstanceId, scope],
        );
        flagged = rows.map((r) => r.id);
        if (flagged.length) parts.push(`${flagged.length} work area(s)`);
        await reopen('audit_areas');
      }
      // Planning / risk phases re-open for re-approval (the SA-3/SA-9 reopen path).
      if (impact.planning) await reopen('planning');
      if (impact.risk) await reopen('risk');
      // Follow-through the detection promised.
      if (detection)
        parts.push(...(await this.followThrough(client, workflowInstanceId, detection)));
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
        await reopen('completion');
        await reopen('reporting');
        await reopen('sign_off');
        parts.push('completion/sign-off re-opened');
      }
      const affectedSummary = parts.length ? `Flagged ${parts.join(', ')}.` : null;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_reassessments
           (workflow_instance_id, engagement_id, change_type, reason, impact, affected_summary,
            raised_by_employee_id, detection_key, affected_area_ids, affected_phases)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::uuid[],$10::text[])
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          changeType,
          reason,
          JSON.stringify(impact),
          affectedSummary,
          ctx.employeeId ?? null,
          detection?.key ?? null,
          flagged,
          phases,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.reassessment_raised',
        objectType: 'audit_reassessment',
        objectId: rows[0]!.id,
        after: { changeType, impact, affectedSummary, detectionKey: detection?.key ?? null },
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
        WHERE engagement_id = $1 AND status <> 'cancelled'
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
  ): Promise<boolean> {
    const r = await client.query(
      `UPDATE hsdg.audit_workflow_phases
          SET state = 'needs_attention'
        WHERE workflow_instance_id = $1 AND phase_key = $2 AND state = 'complete'`,
      [workflowInstanceId, phaseKey],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** What raising a detected change also does (its `followThrough`). */
  private async followThrough(
    client: PoolClient,
    workflowInstanceId: string,
    d: ReassessmentDetection,
  ): Promise<string[]> {
    if (d.changeType === 'materiality_revised' && d.scopeAreaIds.length > 0) {
      const pm = Number(d.key.slice('materiality:'.length));
      const r = await client.query(
        `UPDATE hsdg.audit_work_areas
            SET materiality = $3, detail_version = detail_version + 1
          WHERE workflow_instance_id = $1 AND id = ANY($2::uuid[])`,
        [workflowInstanceId, d.scopeAreaIds, pm],
      );
      return r.rowCount ? [`materiality updated on ${r.rowCount} area(s)`] : [];
    }
    if (d.changeType === 'reporting_date_changed') {
      const m = /^date:(\d{4}-\d{2}-\d{2})->(\d{4}-\d{2}-\d{2})$/.exec(d.key);
      if (!m) return [];
      const [, from, to] = m;
      const a = await client.query(
        `UPDATE hsdg.audit_work_areas
            SET due_date = $3, detail_version = detail_version + 1
          WHERE workflow_instance_id = $1 AND is_active AND due_date = $2::date`,
        [workflowInstanceId, from, to],
      );
      const p = await client.query(
        `UPDATE hsdg.audit_procedures
            SET due_date = $3, version = version + 1
          WHERE workflow_instance_id = $1 AND state <> 'complete' AND due_date = $2::date`,
        [workflowInstanceId, from, to],
      );
      return [
        `due dates moved from ${from} to ${to} on ${a.rowCount ?? 0} area(s) and ${p.rowCount ?? 0} procedure(s)`,
      ];
    }
    return [];
  }

  /** The changes the file shows against what the work was planned on. */
  private async detect(
    client: PoolClient,
    engagementId: string,
    wi: string,
  ): Promise<ReassessmentDetection[]> {
    return detectChanges(await this.loadDetectionFacts(client, engagementId, wi));
  }

  private async loadDetectionFacts(
    client: PoolClient,
    engagementId: string,
    wi: string,
  ): Promise<DetectionFacts> {
    const num = (v: string | null): number | null => (v == null ? null : Number(v));
    const { rows: mat } = await client.query<{ id: string; pm: string | null }>(
      `SELECT id, selected_pm::text AS pm FROM hsdg.audit_materiality_determination
        WHERE workflow_instance_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [wi],
    );
    const { rows: specific } = mat[0]
      ? await client.query<{ pm: string | null }>(
          `SELECT specific_pm::text AS pm FROM hsdg.audit_materiality_specific
            WHERE determination_id = $1`,
          [mat[0].id],
        )
      : { rows: [] as Array<{ pm: string | null }> };
    const { rows: areas } = await client.query<{
      id: string;
      work_area_key: string;
      title: string;
      source: string;
      materiality: string | null;
      due_date: string | null;
    }>(
      `SELECT id, work_area_key, title, source, materiality::text AS materiality, due_date
         FROM hsdg.audit_work_areas
        WHERE workflow_instance_id = $1 AND is_active ORDER BY sort_order`,
      [wi],
    );
    const { rows: procDates } = await client.query<{ due_date: string }>(
      `SELECT due_date FROM hsdg.audit_procedures
        WHERE workflow_instance_id = $1 AND state <> 'complete' AND due_date IS NOT NULL`,
      [wi],
    );
    const { rows: risks } = await client.query<{
      id: string;
      risk_ref: string;
      description: string;
      fs_area: string | null;
      source_key: string | null;
    }>(
      `SELECT r.id, r.risk_ref, r.description, r.fs_area, r.source_key
         FROM hsdg.audit_risks r
        WHERE r.workflow_instance_id = $1 AND r.is_significant AND r.status <> 'concluded'
          AND NOT EXISTS (SELECT 1 FROM hsdg.audit_procedures p WHERE p.risk_id = r.id)
        ORDER BY r.risk_ref`,
      [wi],
    );
    const { rows: fw } = await client.query<{
      area_key: string;
      conclusion: FrameworkConclusion | null;
    }>(
      `SELECT area_key, conclusion FROM hsdg.audit_framework_assessments
        WHERE workflow_instance_id = $1`,
      [wi],
    );
    const { rows: approval } = await client.query<{ v: number | null }>(
      `SELECT max(version)::int AS v FROM hsdg.audit_framework_approvals
        WHERE workflow_instance_id = $1`,
      [wi],
    );
    const { rows: eng } = await client.query<{ planned_end_date: string | null }>(
      `SELECT planned_end_date::text AS planned_end_date FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    const master = await readEngagementMasterFacts(client, wi);

    const fsAreas: FsAreaInput[] = areas
      .filter((a) => a.source === 'planning:03.5')
      .map((a, i) => ({
        id: a.id,
        seq: i + 1,
        code: null,
        name: a.title,
        aliases: [],
        attention: 'standard',
        cy: null,
        py: null,
        unitLabel: null,
        assertions: [],
      }));
    const frameworkApproved = (approval[0]?.v ?? null) != null;
    const conclusions = new Map(
      fw
        .filter(
          (r): r is { area_key: string; conclusion: FrameworkConclusion } => r.conclusion != null,
        )
        .map((r) => [r.area_key, r.conclusion]),
    );
    const activeWorkstreams = areas
      .filter((a) => a.source.startsWith('framework:'))
      .map((a) => ({ id: a.id, key: a.work_area_key, title: a.title }));
    return {
      performanceMateriality: num(mat[0]?.pm ?? null),
      specificMateriality: specific.map((x) => num(x.pm)).filter((n): n is number => n != null),
      areas: areas.map((a) => ({
        id: a.id,
        key: a.work_area_key,
        title: a.title,
        isFs: a.source === 'planning:03.5',
        materiality: num(a.materiality),
        dueDate: a.due_date,
      })),
      procedureDueDates: procDates.map((p) => p.due_date),
      unansweredRisks: risks.map((r) => ({
        id: r.id,
        ref: r.risk_ref,
        description: r.description,
        areaId:
          areaForRisk(
            {
              id: r.id,
              ref: r.risk_ref,
              description: r.description,
              fsArea: r.fs_area,
              assertion: null,
              rating: 'significant',
              isSignificant: true,
              isFraudRisk: false,
              response: null,
              status: 'identified',
              sourceKey: r.source_key,
            },
            fsAreas,
          )?.id ?? null,
      })),
      // Only an approved framework says what the work should be.
      requiredWorkstreams: frameworkApproved
        ? planWorkAreas(conclusions).map((w) => ({ key: w.workAreaKey, title: w.title }))
        : activeWorkstreams.map((w) => ({ key: w.key, title: w.title })),
      activeWorkstreams,
      frameworkVersion: approval[0]?.v ?? null,
      investees: master
        ? groupStructure(master.relationships).investees.map((i) => i.counterparty)
        : [],
      cfsConclusion: conclusions.get('cfs') ?? null,
      plannedEndDate: eng[0]?.planned_end_date ?? null,
    };
  }

  /** Never offer this detected change again on this file. */
  async dismissDetection(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    detectionKey: string,
  ): Promise<StatutoryAuditReassessment> {
    return this.db.withRlsContext(ctx, async (client) => {
      const shell = await this.assertShell(client, engagementId, workflowInstanceId);
      if (shell.archived) {
        throw new ConflictException('This audit file is archived and locked (§37).');
      }
      await client.query(
        `INSERT INTO hsdg.audit_reassessment_dismissals
           (workflow_instance_id, engagement_id, detection_key, dismissed_by_employee_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [workflowInstanceId, engagementId, detectionKey, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.reassessment_detection_dismissed',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { detectionKey },
      });
      return this.readOne(client, engagementId, workflowInstanceId);
    });
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

function mapEvent(
  r: EventRow,
  p: Pick<AuditReassessment, 'progress' | 'readyToResolve'>,
): AuditReassessment {
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
    detectionKey: r.detection_key,
    ...p,
  };
}

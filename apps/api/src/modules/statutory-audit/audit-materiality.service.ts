import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CANDIDATE_BENCHMARKS,
  FINANCIAL_UNIT_FACTOR,
  MATERIALITY_CHALLENGE_KINDS,
  MATERIALITY_CHALLENGE_TARGET_LABEL,
  MATERIALITY_CHALLENGE_TARGETS,
  MATERIALITY_TEAM_FIELDS,
  NOTIFICATION_TYPE,
  PLANNING_ACTOR_ROLE_LABEL,
  FINANCIAL_UNIT_LABEL,
  MATERIALITY_BENCHMARK_LABEL,
  PRINCIPAL_USER_LABEL,
  QUALITATIVE_CONSIDERATIONS,
  USER_FOCUS_LABEL,
  materialityVersionLabel,
  type AssessBenchmarkInput,
  type CloseMaterialityChallengeInput,
  type CreateMaterialityChallengeInput,
  type MaterialityChallengeRecord,
  type MaterialityGovernance,
  type MaterialityReassessment,
  type MaterialityReassessmentSource,
  type PlanningCompletionCheck,
  type RequireMaterialityReassessmentInput,
  type ResolveMaterialityReassessmentInput,
  type RespondMaterialityChallengeInput,
  type BenchmarkAssessment,
  type BenchmarkCandidate,
  type CandidateBenchmark,
  type MaterialityAuthorityRef,
  type MaterialityBaseline,
  type MaterialityContextItem,
  type MaterialityDatasetInfo,
  type MaterialityDetermination,
  type MaterialityDeterminationStatus,
  type MaterialityMethodology,
  type MaterialitySummary,
  type MaterialityVersionHistory,
  type NormalisationAdjustment,
  type NormalisationAdjustmentInput,
  type PlanningChangeCategory,
  type QualitativeChallengeItem,
  type RevisionImpactItem,
  type SaveQualitativeInput,
  type SpecialEntityType,
  type SpecificMaterialityInput,
  type SpecificMaterialityRecord,
  type StartRevisionInput,
  type UpdateMaterialityInput,
  type UpdateRevisionItemInput,
  PLANNING_CHANGE_CATEGORY_LABEL,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { AuditBusinessUnderstandingService } from './audit-business-understanding.service';
import { AuditAreaReviewService } from './audit-area-review.service';
import { flagScopeReassessment } from './audit-scope-approach.service';
import {
  MATERIALITY_IMPACT_PREVIEW,
  QUALITATIVE_KEYS,
  aggregationRiskFactors,
  buildCandidates,
  buildSensitivity,
  composeMaterialityConclusion,
  computeMateriality,
  computeMaterialityCompletion,
  matchesCalculated,
  partnerAttentionTriggers,
  percentageFactors,
  qualitativePrompts,
  resolveMaterialityMethodology,
  revisionImpacts,
  roundToStep,
  selectedBenchmarkAmount,
  specificMaterialityPrompts,
  summariseNormalisation,
  type MaterialityFacts,
} from './materiality-engine';
import {
  assertShell,
  assertSignalsInShell,
  clean,
  cleanList,
  displayCode,
} from './planning-shared';
import { isEngagementLead, readPriorAuditFile } from './master-facts';
import {
  notifyPlanning,
  readPlanningLock,
  resolvePlanningActor,
  type PlanningActor,
} from './planning-governance';

/** The Phase 03 checklist row 03.3 rolls its state up into. */
const MATERIALITY_ITEM_KEY = 'materiality';
const PCT = 100;
const AUTHORITY_CODES: [string, string][] = [
  ['SA_320', 'View SA 320'],
  ['SA_450', 'View SA 450'],
  ['IG_MATERIALITY', 'View Materiality Implementation Guide'],
  ['SA_300', 'View SA 300'],
];

interface DetRow {
  id: string;
  version_no: number;
  status: MaterialityDeterminationStatus;
  methodology_version: string | null;
  principal_users: string[];
  principal_users_other: string | null;
  user_focus: string[];
  user_focus_other: string | null;
  py_overall_materiality: string | null;
  py_performance_materiality: string | null;
  py_clearly_trivial: string | null;
  py_benchmark: string | null;
  py_source: string | null;
  py_audit_differences: string | null;
  normalisation_rationale: string | null;
  selected_benchmark: MaterialityDetermination['selectedBenchmark'];
  other_benchmark_label: string | null;
  other_benchmark_amount: string | null;
  other_benchmark_source: string | null;
  benchmark_rationale: string | null;
  benchmark_amount: string | null;
  unit_factor: string | null;
  selected_pct: string | null;
  calculated_om: string | null;
  selected_om: string | null;
  om_adjustment_reason: string | null;
  om_override_reason: string | null;
  pct_factors_considered: string[];
  pct_factors_note: string | null;
  mat04: MaterialityDetermination['mat04'];
  mat04_rationale: string | null;
  aggregation_factors: string[];
  aggregation_other: string | null;
  pm_pct: string | null;
  calculated_pm: string | null;
  selected_pm: string | null;
  pm_adjustment_reason: string | null;
  pm_rationale: string | null;
  pm_override_reason: string | null;
  mat06: MaterialityDetermination['mat06'];
  mat06_note: string | null;
  selected_ctt: string | null;
  ctt_rationale: string | null;
  ctt_override_reason: string | null;
  mat07: MaterialityDetermination['mat07'];
  mat07_note: string | null;
  revision_trigger: MaterialityDetermination['revisionTrigger'];
  revision_reason: string | null;
  revision_date: string | null;
  revision_owner_employee_id: string | null;
  revision_owner_name: string | null;
  conclusion_summary: string | null;
  mat08: MaterialityDetermination['mat08'];
  completed_by_name: string | null;
  completed_at: Date | null;
  reassessment_source: MaterialityReassessmentSource | null;
  reassessment_reason: string | null;
  reassessment_flagged_at: Date | null;
  reassessment_flagged_by_employee_id: string | null;
  reassessment_resolution: string | null;
  reassessment_resolved_at: Date | null;
  reassessment_resolved_by_employee_id: string | null;
  reassessed_benchmark_amount: string | null;
  version: number;
}

const DET_SELECT = `
  SELECT d.*, d.revision_date::text AS revision_date,
         ro.full_name AS revision_owner_name, cb.full_name AS completed_by_name
    FROM hsdg.audit_materiality_determination d
    LEFT JOIN hsdg.employees ro ON ro.id = d.revision_owner_employee_id
    LEFT JOIN hsdg.employees cb ON cb.id = d.completed_by_employee_id`;

const num = (v: string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Everything 03.3 derives for one determination (built once per request). */
interface Workspace {
  det: MaterialityDetermination;
  dataset: MaterialityDatasetInfo;
  metrics: Record<string, { cy: number | null; py: number | null }>;
  facts: MaterialityFacts;
  methodology: MaterialityMethodology;
  adjustments: NormalisationAdjustment[];
  candidates: BenchmarkCandidate[];
  specific: SpecificMaterialityRecord[];
  qualitative: QualitativeChallengeItem[];
}

/**
 * 03.3 Materiality (DHVAJ 03.3). The portal exposes measures, stability, user
 * focus, qualitative factors and sensitivity; the Engagement Manager selects
 * and concludes. Candidate amounts come live from the 03.2 canonical dataset;
 * guidance from the versioned Materiality Methodology Library. A completed
 * determination is never overwritten — revisions create the next version.
 */
@Injectable()
export class AuditMaterialityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
    private readonly understanding: AuditBusinessUnderstandingService,
    private readonly areaReview: AuditAreaReviewService,
  ) {
    // §20 — a 03.2 figure change re-checks a completed determination.
    understanding.onFiguresChanged((client, ctx, engagementId, workflowInstanceId) =>
      this.afterSourceChange(client, ctx, engagementId, workflowInstanceId),
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  async getSummary(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<MaterialitySummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      await this.prefillPriorYearOn(client, ctx, engagementId, workflowInstanceId);
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  /**
   * Prior-year materiality (03.3.2) from last year's completed determination:
   * OM / PM / clearly trivial / benchmark fill the PY columns of the draft, and
   * a brand-new v1.0 also starts from last year's users and focus (MAT-01/02)
   * for the team to confirm. Blank fields only; lead only; never touches a
   * completed version.
   */
  private async prefillPriorYearOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const current = await this.readCurrentRow(client, workflowInstanceId);
    if (current && (current.status !== 'draft' || current.py_overall_materiality != null)) return;
    const prior = await readPriorAuditFile(client, workflowInstanceId);
    if (!prior || !(await isEngagementLead(client, engagementId))) return;
    const { rows } = await client.query<{
      version_no: number;
      selected_om: string | null;
      selected_pm: string | null;
      selected_ctt: string | null;
      selected_benchmark: string | null;
      principal_users: string[];
      principal_users_other: string | null;
      user_focus: string[];
      user_focus_other: string | null;
    }>(
      `SELECT version_no, selected_om::text, selected_pm::text, selected_ctt::text,
              selected_benchmark, principal_users, principal_users_other, user_focus,
              user_focus_other
         FROM hsdg.audit_materiality_determination
        WHERE workflow_instance_id = $1 AND status = 'complete' AND selected_om IS NOT NULL
        ORDER BY version_no DESC LIMIT 1`,
      [prior.workflowInstanceId],
    );
    const py = rows[0];
    if (!py) return;
    const source = `FY ${prior.financialYear} audit file — materiality ${materialityVersionLabel(py.version_no)}`;
    if (!current) {
      await client.query(
        `INSERT INTO hsdg.audit_materiality_determination
           (workflow_instance_id, engagement_id, version_no, principal_users, principal_users_other,
            user_focus, user_focus_other)
         VALUES ($1, $2, 1, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [
          workflowInstanceId,
          engagementId,
          py.principal_users ?? [],
          py.principal_users_other,
          py.user_focus ?? [],
          py.user_focus_other,
        ],
      );
    }
    const res = await client.query(
      `UPDATE hsdg.audit_materiality_determination
          SET py_overall_materiality = COALESCE(py_overall_materiality, $2),
              py_performance_materiality = COALESCE(py_performance_materiality, $3),
              py_clearly_trivial = COALESCE(py_clearly_trivial, $4),
              py_benchmark = COALESCE(py_benchmark, $5),
              py_source = COALESCE(py_source, $6),
              version = version + 1
        WHERE workflow_instance_id = $1 AND status = 'draft' AND py_overall_materiality IS NULL`,
      [
        workflowInstanceId,
        py.selected_om,
        py.selected_pm,
        py.selected_ctt,
        py.selected_benchmark,
        source,
      ],
    );
    if ((res.rowCount ?? 0) > 0) {
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_prior_year_prefilled',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { from: prior.financialYear, version: py.version_no, automatic: true },
      });
    }
  }

  async draftConclusion(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ draft: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const s = await this.buildSummary(client, workflowInstanceId);
      return {
        draft: composeMaterialityConclusion({
          det: s.determination,
          candidates: s.candidates,
          adjustments: s.adjustments,
          normalisation: s.normalisation,
          specific: s.specific,
          qualitative: s.qualitative,
          partnerAttention: s.partnerAttention,
          computed: s.computed,
          labels: {
            users: s.determination.principalUsers.map((u) => PRINCIPAL_USER_LABEL[u]),
            focus: s.determination.userFocus.map((f) => USER_FOCUS_LABEL[f]),
          },
          unitLabel: s.dataset.unitLabel,
        }),
      };
    });
  }

  // ── Determination (MAT-01…MAT-08) ──────────────────────────────────────────

  async updateDetermination(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: UpdateMaterialityInput,
  ): Promise<MaterialitySummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      assertMaterialityFields(await resolvePlanningActor(client, engagementId), input);
      const { row, created } = await this.ensureDraft(
        client,
        ctx,
        engagementId,
        workflowInstanceId,
      );
      if (!(created && input.version === 0) && input.version !== row.version) {
        throw new ConflictException('Materiality changed since you loaded it; refresh and retry.');
      }
      const ws = await this.workspace(client, workflowInstanceId, mapDet(row));
      const cur = ws.det;
      const pick = <T>(v: T | undefined, c: T): T => (v !== undefined ? v : c);
      const txt = (v: string | null | undefined, c: string | null) =>
        v !== undefined ? clean(v) : c;

      const next: MaterialityDetermination = {
        ...cur,
        principalUsers: input.principalUsers
          ? (cleanList(input.principalUsers) as MaterialityDetermination['principalUsers'])
          : cur.principalUsers,
        principalUsersOther: txt(input.principalUsersOther, cur.principalUsersOther),
        userFocus: input.userFocus
          ? (cleanList(input.userFocus) as MaterialityDetermination['userFocus'])
          : cur.userFocus,
        userFocusOther: txt(input.userFocusOther, cur.userFocusOther),
        pyOverallMateriality: pick(input.pyOverallMateriality, cur.pyOverallMateriality),
        pyPerformanceMateriality: pick(
          input.pyPerformanceMateriality,
          cur.pyPerformanceMateriality,
        ),
        pyClearlyTrivial: pick(input.pyClearlyTrivial, cur.pyClearlyTrivial),
        pyBenchmark: txt(input.pyBenchmark, cur.pyBenchmark),
        pySource: txt(input.pySource, cur.pySource),
        pyAuditDifferences: txt(input.pyAuditDifferences, cur.pyAuditDifferences),
        normalisationRationale: txt(input.normalisationRationale, cur.normalisationRationale),
        selectedBenchmark: pick(input.selectedBenchmark, cur.selectedBenchmark),
        otherBenchmarkLabel: txt(input.otherBenchmarkLabel, cur.otherBenchmarkLabel),
        otherBenchmarkAmount: pick(input.otherBenchmarkAmount, cur.otherBenchmarkAmount),
        otherBenchmarkSource: txt(input.otherBenchmarkSource, cur.otherBenchmarkSource),
        benchmarkRationale: txt(input.benchmarkRationale, cur.benchmarkRationale),
        selectedPct: pick(input.selectedPct, cur.selectedPct),
        selectedOm: pick(input.selectedOm, cur.selectedOm),
        omAdjustmentReason: txt(input.omAdjustmentReason, cur.omAdjustmentReason),
        omOverrideReason: txt(input.omOverrideReason, cur.omOverrideReason),
        pctFactorsConsidered: input.pctFactorsConsidered
          ? cleanList(input.pctFactorsConsidered)
          : cur.pctFactorsConsidered,
        pctFactorsNote: txt(input.pctFactorsNote, cur.pctFactorsNote),
        mat04: pick(input.mat04, cur.mat04),
        mat04Rationale: txt(input.mat04Rationale, cur.mat04Rationale),
        aggregationFactors: input.aggregationFactors
          ? cleanList(input.aggregationFactors)
          : cur.aggregationFactors,
        aggregationOther: txt(input.aggregationOther, cur.aggregationOther),
        pmPct: pick(input.pmPct, cur.pmPct),
        selectedPm: pick(input.selectedPm, cur.selectedPm),
        pmAdjustmentReason: txt(input.pmAdjustmentReason, cur.pmAdjustmentReason),
        pmRationale: txt(input.pmRationale, cur.pmRationale),
        pmOverrideReason: txt(input.pmOverrideReason, cur.pmOverrideReason),
        mat06: pick(input.mat06, cur.mat06),
        mat06Note: txt(input.mat06Note, cur.mat06Note),
        selectedCtt: pick(input.selectedCtt, cur.selectedCtt),
        cttRationale: txt(input.cttRationale, cur.cttRationale),
        cttOverrideReason: txt(input.cttOverrideReason, cur.cttOverrideReason),
        mat07: pick(input.mat07, cur.mat07),
        mat07Note: txt(input.mat07Note, cur.mat07Note),
        conclusionSummary: txt(input.conclusionSummary, cur.conclusionSummary),
        mat08: pick(input.mat08, cur.mat08),
      };

      // ── Benchmark snapshot + calculated OM (source traceable, spec §20) ──
      const factor = ws.dataset.unitFactor;
      const benchmarkChanged =
        next.selectedBenchmark !== cur.selectedBenchmark ||
        next.selectedPct !== cur.selectedPct ||
        next.otherBenchmarkAmount !== cur.otherBenchmarkAmount ||
        input.reconfirmSource === true;
      if (benchmarkChanged) {
        if (next.selectedBenchmark && next.selectedBenchmark !== 'other') {
          const c = ws.candidates.find((x) => x.key === next.selectedBenchmark)!;
          if (c.status !== 'available') {
            throw new BadRequestException(
              `${MATERIALITY_BENCHMARK_LABEL[c.key]} is not available as a benchmark: ${c.reason}`,
            );
          }
        }
        if (next.selectedBenchmark && !factor) {
          throw new BadRequestException(
            ws.dataset.reason ?? 'Complete the 03.2.7 dataset header before selecting a benchmark.',
          );
        }
        const live = selectedBenchmarkAmount(next, ws.candidates);
        next.benchmarkAmount = next.selectedBenchmark ? live : null;
        const prevCalc = cur.calculatedOm;
        const prevRounded = roundToStep(prevCalc, ws.methodology.roundingStep);
        next.calculatedOm =
          live !== null && factor && next.selectedPct !== null
            ? (live * factor * next.selectedPct) / PCT
            : null;
        // Selected OM defaults to the (methodology-rounded) calculated amount
        // unless the auditor has deliberately chosen a different amount.
        const auditorAdjusted =
          cur.selectedOm !== null && !matchesCalculated(cur.selectedOm, prevCalc, prevRounded);
        if (input.selectedOm === undefined && !auditorAdjusted) {
          next.selectedOm = roundToStep(next.calculatedOm, ws.methodology.roundingStep);
        }
      }
      if (next.selectedOm !== cur.selectedOm || next.pmPct !== cur.pmPct) {
        const prevCalcPm = cur.calculatedPm;
        const prevRoundedPm = roundToStep(prevCalcPm, ws.methodology.roundingStep);
        next.calculatedPm =
          next.selectedOm !== null && next.pmPct !== null
            ? (next.selectedOm * next.pmPct) / PCT
            : null;
        const auditorAdjusted =
          cur.selectedPm !== null && !matchesCalculated(cur.selectedPm, prevCalcPm, prevRoundedPm);
        if (input.selectedPm === undefined && !auditorAdjusted) {
          next.selectedPm = roundToStep(next.calculatedPm, ws.methodology.roundingStep);
        }
      }

      // ── Blocking validations ──
      if (
        next.selectedOm !== null &&
        next.selectedPm !== null &&
        next.selectedPm >= next.selectedOm
      ) {
        throw new BadRequestException(
          'Performance materiality must be below overall materiality (MAT-05).',
        );
      }
      if (
        next.selectedOm !== null &&
        next.selectedCtt !== null &&
        next.selectedCtt >= next.selectedOm
      ) {
        throw new BadRequestException(
          'The clearly trivial threshold must be below overall materiality.',
        );
      }
      if (
        next.selectedOm !== null &&
        ws.specific.some((s) => s.amount !== null && s.amount >= next.selectedOm!)
      ) {
        throw new BadRequestException(
          'A specific materiality amount is not below the selected overall materiality — review MAT-06 first.',
        );
      }
      if (next.mat04 === 'no_adjust' && !next.mat04Rationale) {
        throw new BadRequestException('MAT-04 "No — Adjust" requires a rationale.');
      }

      const completing = input.mat08 === 'yes_complete';
      if (completing) {
        const after: Workspace = { ...ws, det: next };
        const computed = this.compute(after);
        const revisionItems = await this.readRevisionItems(client, row.id);
        const pending = revisionImpacts(
          next,
          await this.readBaseline(client, workflowInstanceId, next.versionNo),
          ws.specific.length,
        );
        const checks = computeMaterialityCompletion({
          det: next,
          dataset: ws.dataset,
          candidates: ws.candidates,
          computed,
          adjustments: ws.adjustments,
          specific: ws.specific,
          qualitative: ws.qualitative,
          revisionItems: pending.map((p) => ({
            applicable: true,
            ownerEmployeeId:
              revisionItems.find((i) => i.itemKey === p.itemKey)?.ownerEmployeeId ?? null,
          })),
        });
        checks.push(
          ...governanceCompletion(
            await this.readChallenges(client, workflowInstanceId),
            ws.adjustments,
            await this.readEvidenceCounts(client, workflowInstanceId),
          ),
        );
        const problems = checks.filter((c) => !c.met).map((c) => c.detail ?? c.label);
        if (problems.length) {
          throw new ConflictException(`03.3 cannot be completed yet: ${problems.join(' ')}`);
        }
      }

      const status: MaterialityDeterminationStatus = completing ? 'complete' : 'draft';
      const result = await client.query(
        `UPDATE hsdg.audit_materiality_determination SET
            principal_users = $3, principal_users_other = $4, user_focus = $5, user_focus_other = $6,
            py_overall_materiality = $7, py_performance_materiality = $8, py_clearly_trivial = $9,
            py_benchmark = $10, py_source = $11, py_audit_differences = $12,
            normalisation_rationale = $13, selected_benchmark = $14, other_benchmark_label = $15,
            other_benchmark_amount = $16, other_benchmark_source = $17, benchmark_rationale = $18,
            benchmark_amount = $19, unit_factor = $20, selected_pct = $21, calculated_om = $22,
            selected_om = $23, om_adjustment_reason = $24, om_override_reason = $25,
            pct_factors_considered = $26, pct_factors_note = $27, mat04 = $28, mat04_rationale = $29,
            aggregation_factors = $30, aggregation_other = $31, pm_pct = $32, calculated_pm = $33,
            selected_pm = $34, pm_adjustment_reason = $35, pm_rationale = $36,
            pm_override_reason = $37, mat06 = $38, mat06_note = $39, selected_ctt = $40,
            ctt_rationale = $41, ctt_override_reason = $42, mat07 = $43, mat07_note = $44,
            conclusion_summary = $45, mat08 = $46, status = $47, methodology_version = $48,
            completed_by_employee_id = CASE WHEN $47 = 'complete' THEN $49::uuid ELSE NULL END,
            completed_at = CASE WHEN $47 = 'complete' THEN now() ELSE NULL END,
            version = version + 1
          WHERE id = $1 AND version = $2 AND status = 'draft'`,
        [
          row.id,
          row.version,
          next.principalUsers,
          next.principalUsersOther,
          next.userFocus,
          next.userFocusOther,
          next.pyOverallMateriality,
          next.pyPerformanceMateriality,
          next.pyClearlyTrivial,
          next.pyBenchmark,
          next.pySource,
          next.pyAuditDifferences,
          next.normalisationRationale,
          next.selectedBenchmark,
          next.otherBenchmarkLabel,
          next.otherBenchmarkAmount,
          next.otherBenchmarkSource,
          next.benchmarkRationale,
          next.benchmarkAmount,
          next.selectedBenchmark ? factor : null,
          next.selectedPct,
          next.calculatedOm,
          next.selectedOm,
          next.omAdjustmentReason,
          next.omOverrideReason,
          next.pctFactorsConsidered,
          next.pctFactorsNote,
          next.mat04,
          next.mat04Rationale,
          next.aggregationFactors,
          next.aggregationOther,
          next.pmPct,
          next.calculatedPm,
          next.selectedPm,
          next.pmAdjustmentReason,
          next.pmRationale,
          next.pmOverrideReason,
          next.mat06,
          next.mat06Note,
          next.selectedCtt,
          next.cttRationale,
          next.cttOverrideReason,
          next.mat07,
          next.mat07Note,
          next.conclusionSummary,
          next.mat08,
          status,
          ws.methodology.versionLabel,
          ctx.employeeId ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('Materiality changed since you loaded it; refresh and retry.');
      }

      if (completing) {
        // A completed revision supersedes the baseline; publish the new current version.
        await client.query(
          `UPDATE hsdg.audit_materiality_determination
              SET status = 'superseded', version = version + 1
            WHERE workflow_instance_id = $1 AND status = 'complete' AND id <> $2`,
          [workflowInstanceId, row.id],
        );
        await this.publish(client, ctx, engagementId, workflowInstanceId, next);
        await this.rollUp(client, ctx, workflowInstanceId, 'complete');
        // §25 (03.5): a completed Audit Area review affected by the new materiality → Update Required.
        await this.areaReview.markImpacted(client, workflowInstanceId);
        if (next.versionNo > 1) {
          // §24 (03.4): a materiality revision flags affected scope / map items — never silently.
          await flagScopeReassessment(
            client,
            workflowInstanceId,
            'materiality_revision',
            `Materiality revised to ${materialityVersionLabel(next.versionNo)} (OM ₹${(next.selectedOm ?? 0).toLocaleString('en-IN')}): ${next.revisionReason ?? ''}`.trim(),
          );
        }
      } else {
        await this.syncRevisionItems(client, engagementId, workflowInstanceId, row.id);
        await this.rollUp(client, ctx, workflowInstanceId, 'in_progress');
      }
      await this.audit.recordWith(client, ctx, {
        action: completing
          ? 'statutory_audit.materiality_completed'
          : 'statutory_audit.materiality_updated',
        objectType: 'audit_materiality_determination',
        objectId: row.id,
        before: {
          om: cur.selectedOm,
          pm: cur.selectedPm,
          ctt: cur.selectedCtt,
          benchmark: cur.selectedBenchmark,
        },
        after: {
          om: next.selectedOm,
          calculatedOm: next.calculatedOm,
          pm: next.selectedPm,
          ctt: next.selectedCtt,
          benchmark: next.selectedBenchmark,
          pct: next.selectedPct,
          status,
          methodology: ws.methodology.versionLabel,
        },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  // ── 03.3.2 Benchmark assessment ────────────────────────────────────────────

  async assessBenchmark(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    candidateKey: string,
    input: AssessBenchmarkInput,
  ): Promise<MaterialitySummary> {
    if (!CANDIDATE_BENCHMARKS.includes(candidateKey as CandidateBenchmark)) {
      throw new NotFoundException('Unknown candidate benchmark.');
    }
    const rationale = clean(input.rationale);
    if (input.assessment === 'normalised_required' && !rationale) {
      throw new BadRequestException('Explain why a normalised benchmark is required.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { row } = await this.ensureDraft(client, ctx, engagementId, workflowInstanceId);
      const res =
        input.version === 0
          ? await client.query(
              `INSERT INTO hsdg.audit_materiality_benchmark
                 (determination_id, engagement_id, candidate_key, assessment, rationale)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT (determination_id, candidate_key) DO NOTHING`,
              [row.id, engagementId, candidateKey, input.assessment, rationale],
            )
          : await client.query(
              `UPDATE hsdg.audit_materiality_benchmark
                  SET assessment = $3, rationale = $4, version = version + 1
                WHERE determination_id = $1 AND candidate_key = $2 AND version = $5`,
              [row.id, candidateKey, input.assessment, rationale, input.version],
            );
      if ((res.rowCount ?? 0) === 0) {
        throw new ConflictException('This benchmark assessment changed; refresh and retry.');
      }
      await this.touched(client, ctx, workflowInstanceId, row.id, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_benchmark_assessed',
        objectType: 'audit_materiality_determination',
        objectId: row.id,
        after: { candidate: candidateKey, assessment: input.assessment },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  // ── 03.3.3 Normalisation schedule ──────────────────────────────────────────

  async saveAdjustment(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    adjustmentId: string | null,
    input: NormalisationAdjustmentInput,
  ): Promise<MaterialitySummary> {
    const description = clean(input.description);
    if (!description) throw new BadRequestException('Describe the adjustment.');
    if (!Number.isFinite(input.amount) || input.amount === 0) {
      throw new BadRequestException('Enter a non-zero adjustment amount (+ or −).');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { row } = await this.ensureDraft(client, ctx, engagementId, workflowInstanceId);
      if (adjustmentId === null) {
        await client.query(
          `INSERT INTO hsdg.audit_materiality_adjustment
             (determination_id, engagement_id, seq, description, amount, reason, recurring, evidence)
           VALUES ($1, $2,
                   (SELECT COALESCE(MAX(seq), 0) + 1 FROM hsdg.audit_materiality_adjustment
                     WHERE determination_id = $1),
                   $3, $4, $5, $6, $7)`,
          [
            row.id,
            engagementId,
            description,
            input.amount,
            clean(input.reason),
            input.recurring ?? false,
            clean(input.evidence),
          ],
        );
      } else {
        const res = await client.query(
          `UPDATE hsdg.audit_materiality_adjustment
              SET description = $3, amount = $4, reason = $5, recurring = $6, evidence = $7,
                  version = version + 1
            WHERE id = $1 AND determination_id = $2 AND version = $8`,
          [
            adjustmentId,
            row.id,
            description,
            input.amount,
            clean(input.reason),
            input.recurring ?? false,
            clean(input.evidence),
            input.version ?? -1,
          ],
        );
        if ((res.rowCount ?? 0) === 0) {
          throw new ConflictException(
            'This adjustment changed or is not in the current draft; refresh.',
          );
        }
      }
      await this.touched(client, ctx, workflowInstanceId, row.id, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_adjustment_saved',
        objectType: 'audit_materiality_determination',
        objectId: row.id,
        after: { description, amount: input.amount, adjustmentId },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  async deleteAdjustment(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    adjustmentId: string,
  ): Promise<MaterialitySummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { row } = await this.ensureDraft(client, ctx, engagementId, workflowInstanceId);
      const res = await client.query(
        `DELETE FROM hsdg.audit_materiality_adjustment WHERE id = $1 AND determination_id = $2
         RETURNING description, amount`,
        [adjustmentId, row.id],
      );
      if (!res.rows[0]) throw new NotFoundException('Adjustment not found in the current draft.');
      await this.touched(client, ctx, workflowInstanceId, row.id, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_adjustment_removed',
        objectType: 'audit_materiality_determination',
        objectId: row.id,
        before: res.rows[0] as Record<string, unknown>,
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  // ── 03.3.7 Specific materiality ────────────────────────────────────────────

  async saveSpecific(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    specificId: string | null,
    input: SpecificMaterialityInput,
  ): Promise<MaterialitySummary> {
    const scope = clean(input.scope);
    const reason = clean(input.reason);
    if (!scope) throw new BadRequestException('Identify the class, balance or disclosure.');
    if (!reason) throw new BadRequestException('Record why a lower / special threshold is needed.');
    const monetary = input.thresholdType === 'monetary';
    const amount = monetary ? (input.amount ?? null) : null;
    const specificPm = monetary ? (input.specificPm ?? null) : null;
    if (monetary && (amount === null || amount <= 0)) {
      throw new BadRequestException(
        'Enter the specific materiality amount, or choose "qualitative / no fixed threshold".',
      );
    }
    if (specificPm !== null && amount !== null && specificPm >= amount) {
      throw new BadRequestException(
        'Specific performance materiality must be below the specific materiality amount.',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { row } = await this.ensureDraft(client, ctx, engagementId, workflowInstanceId);
      const om = num(row.selected_om);
      if (om !== null && amount !== null && amount >= om) {
        throw new BadRequestException(
          'Specific materiality is a LOWER threshold — it must be below overall materiality.',
        );
      }
      const areas = cleanList(input.affectedAreas);
      if (specificId === null) {
        await client.query(
          `INSERT INTO hsdg.audit_materiality_specific
             (determination_id, engagement_id, seq, scope_type, scope, threshold_type, amount,
              specific_pm, reason, affected_areas)
           VALUES ($1, $2,
                   (SELECT COALESCE(MAX(seq), 0) + 1 FROM hsdg.audit_materiality_specific
                     WHERE determination_id = $1),
                   $3, $4, $5, $6, $7, $8, $9)`,
          [
            row.id,
            engagementId,
            input.scopeType,
            scope,
            input.thresholdType,
            amount,
            specificPm,
            reason,
            areas,
          ],
        );
      } else {
        const res = await client.query(
          `UPDATE hsdg.audit_materiality_specific
              SET scope_type = $3, scope = $4, threshold_type = $5, amount = $6, specific_pm = $7,
                  reason = $8, affected_areas = $9, version = version + 1
            WHERE id = $1 AND determination_id = $2 AND version = $10`,
          [
            specificId,
            row.id,
            input.scopeType,
            scope,
            input.thresholdType,
            amount,
            specificPm,
            reason,
            areas,
            input.version ?? -1,
          ],
        );
        if ((res.rowCount ?? 0) === 0) {
          throw new ConflictException(
            'This record changed or is not in the current draft; refresh.',
          );
        }
      }
      await this.touched(client, ctx, workflowInstanceId, row.id, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_specific_saved',
        objectType: 'audit_materiality_determination',
        objectId: row.id,
        after: { scope, thresholdType: input.thresholdType, amount, specificId },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  async deleteSpecific(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    specificId: string,
  ): Promise<MaterialitySummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { row } = await this.ensureDraft(client, ctx, engagementId, workflowInstanceId);
      const res = await client.query(
        `DELETE FROM hsdg.audit_materiality_specific WHERE id = $1 AND determination_id = $2
         RETURNING scope, amount`,
        [specificId, row.id],
      );
      if (!res.rows[0]) throw new NotFoundException('Record not found in the current draft.');
      await this.touched(client, ctx, workflowInstanceId, row.id, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_specific_removed',
        objectType: 'audit_materiality_determination',
        objectId: row.id,
        before: res.rows[0] as Record<string, unknown>,
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  // ── 03.3.9 Qualitative challenge ───────────────────────────────────────────

  async saveQualitative(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    key: string,
    input: SaveQualitativeInput,
  ): Promise<MaterialitySummary> {
    if (!QUALITATIVE_KEYS.includes(key))
      throw new NotFoundException('Unknown qualitative consideration.');
    const note = clean(input.note);
    if (input.response !== 'no_special_implication' && !note && !input.signalId && !input.focusId) {
      throw new BadRequestException(
        'Explain the response, or link the existing Planning Signal / Area of Focus that records it.',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { row } = await this.ensureDraft(client, ctx, engagementId, workflowInstanceId);
      if (input.signalId) await assertSignalsInShell(client, workflowInstanceId, [input.signalId]);
      if (input.focusId) {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.audit_area_of_focus WHERE id = $1 AND workflow_instance_id = $2`,
          [input.focusId, workflowInstanceId],
        );
        if (!rows[0])
          throw new BadRequestException('That Area of Focus is not in this audit file.');
      }
      const params = [
        row.id,
        engagementId,
        key,
        input.response,
        note,
        input.signalId ?? null,
        input.focusId ?? null,
        input.significant ?? false,
      ];
      const res =
        input.version === 0
          ? await client.query(
              `INSERT INTO hsdg.audit_materiality_qualitative
                 (determination_id, engagement_id, consideration_key, response, note, signal_id,
                  focus_id, significant)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (determination_id, consideration_key) DO NOTHING`,
              params,
            )
          : await client.query(
              `UPDATE hsdg.audit_materiality_qualitative
                  SET response = $4, note = $5, signal_id = $6, focus_id = $7, significant = $8,
                      version = version + 1
                WHERE determination_id = $1 AND engagement_id = $2 AND consideration_key = $3
                  AND version = $9`,
              [...params, input.version],
            );
      if ((res.rowCount ?? 0) === 0) {
        throw new ConflictException('This consideration changed since you loaded it; refresh.');
      }
      await this.touched(client, ctx, workflowInstanceId, row.id, engagementId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_qualitative_saved',
        objectType: 'audit_materiality_determination',
        objectId: row.id,
        after: { key, response: input.response, significant: input.significant ?? false },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  // ── 03.3.11 Revision during the audit ──────────────────────────────────────

  /** Start v1.(n): copies the completed version into a new draft; v1.(n−1) stays in force. */
  async startRevision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: StartRevisionInput,
  ): Promise<MaterialitySummary> {
    const reason = clean(input.reason);
    if (!reason) throw new BadRequestException('A revision needs a reason.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const current = await this.readCurrentRow(client, workflowInstanceId);
      if (!current || current.status !== 'complete') {
        throw new ConflictException(
          'Only a completed determination can be revised; edit the current draft instead.',
        );
      }
      const nextNo = current.version_no + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_materiality_determination
           (workflow_instance_id, engagement_id, version_no, status, methodology_version,
            principal_users, principal_users_other, user_focus, user_focus_other,
            py_overall_materiality, py_performance_materiality, py_clearly_trivial, py_benchmark,
            py_source, py_audit_differences, normalisation_rationale, selected_benchmark,
            other_benchmark_label, other_benchmark_amount, other_benchmark_source,
            benchmark_rationale, benchmark_amount, unit_factor, selected_pct, calculated_om,
            selected_om, om_adjustment_reason, om_override_reason, pct_factors_considered,
            pct_factors_note, mat04, mat04_rationale, aggregation_factors, aggregation_other,
            pm_pct, calculated_pm, selected_pm, pm_adjustment_reason, pm_rationale,
            pm_override_reason, mat06, mat06_note, selected_ctt, ctt_rationale,
            ctt_override_reason, mat07, mat07_note,
            revision_trigger, revision_reason, revision_date, revision_owner_employee_id)
         SELECT workflow_instance_id, engagement_id, $2, 'draft', methodology_version,
            principal_users, principal_users_other, user_focus, user_focus_other,
            py_overall_materiality, py_performance_materiality, py_clearly_trivial, py_benchmark,
            py_source, py_audit_differences, normalisation_rationale, selected_benchmark,
            other_benchmark_label, other_benchmark_amount, other_benchmark_source,
            benchmark_rationale, benchmark_amount, unit_factor, selected_pct, calculated_om,
            selected_om, om_adjustment_reason, om_override_reason, pct_factors_considered,
            pct_factors_note, mat04, mat04_rationale, aggregation_factors, aggregation_other,
            pm_pct, calculated_pm, selected_pm, pm_adjustment_reason, pm_rationale,
            pm_override_reason, mat06, mat06_note, selected_ctt, ctt_rationale,
            ctt_override_reason, NULL, NULL,
            $3, $4, COALESCE($5::date, current_date), $6
           FROM hsdg.audit_materiality_determination WHERE id = $1
         RETURNING id`,
        [
          current.id,
          nextNo,
          input.trigger,
          reason,
          input.revisionDate ?? null,
          input.ownerEmployeeId ?? null,
        ],
      );
      const newId = rows[0]!.id;
      // Children travel with the version; the completed version keeps its own copy.
      await client.query(
        `INSERT INTO hsdg.audit_materiality_benchmark (determination_id, engagement_id, candidate_key, assessment, rationale)
         SELECT $2, engagement_id, candidate_key, assessment, rationale
           FROM hsdg.audit_materiality_benchmark WHERE determination_id = $1`,
        [current.id, newId],
      );
      await client.query(
        `INSERT INTO hsdg.audit_materiality_adjustment
           (determination_id, engagement_id, seq, description, amount, reason, recurring, evidence)
         SELECT $2, engagement_id, seq, description, amount, reason, recurring, evidence
           FROM hsdg.audit_materiality_adjustment WHERE determination_id = $1`,
        [current.id, newId],
      );
      await client.query(
        `INSERT INTO hsdg.audit_materiality_specific
           (determination_id, engagement_id, seq, scope_type, scope, threshold_type, amount,
            specific_pm, reason, affected_areas)
         SELECT $2, engagement_id, seq, scope_type, scope, threshold_type, amount, specific_pm,
                reason, affected_areas
           FROM hsdg.audit_materiality_specific WHERE determination_id = $1`,
        [current.id, newId],
      );
      await client.query(
        `INSERT INTO hsdg.audit_materiality_qualitative
           (determination_id, engagement_id, consideration_key, response, note, signal_id,
            focus_id, significant)
         SELECT $2, engagement_id, consideration_key, response, note, signal_id, focus_id, significant
           FROM hsdg.audit_materiality_qualitative WHERE determination_id = $1`,
        [current.id, newId],
      );
      await this.carryEvidence(client, current.id, newId);
      // An open reassessment flag is taken over by the revision (§20).
      if (current.reassessment_flagged_at && !current.reassessment_resolved_at) {
        await client.query(
          `UPDATE hsdg.audit_materiality_determination
              SET reassessment_resolution = $2, reassessment_resolved_at = now(),
                  reassessment_resolved_by_employee_id = hsdg.ctx_employee_id(),
                  version = version + 1
            WHERE id = $1`,
          [current.id, `Taken over by revision ${materialityVersionLabel(nextNo)}: ${reason}`],
        );
      }
      await this.rollUp(client, ctx, workflowInstanceId, 'in_progress');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_revision_started',
        objectType: 'audit_materiality_determination',
        objectId: newId,
        before: {
          version: materialityVersionLabel(current.version_no),
          om: num(current.selected_om),
        },
        after: { version: materialityVersionLabel(nextNo), trigger: input.trigger, reason },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  async updateRevisionItem(
    ctx: RlsContext,
    engagementId: string,
    itemId: string,
    input: UpdateRevisionItemInput,
  ): Promise<RevisionImpactItem> {
    const resolution = input.resolution !== undefined ? clean(input.resolution) : undefined;
    if (input.status === 'resolved' && !resolution) {
      throw new BadRequestException('Record how the affected work was reassessed.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const res = await client.query<{ determination_id: string }>(
        `UPDATE hsdg.audit_materiality_revision_item
            SET owner_employee_id = CASE WHEN $3::boolean THEN $4::uuid ELSE owner_employee_id END,
                status = COALESCE($5, status),
                resolution = CASE WHEN $6::boolean THEN $7 ELSE resolution END,
                version = version + 1
          WHERE id = $1 AND engagement_id = $2 AND version = $8
        RETURNING determination_id`,
        [
          itemId,
          engagementId,
          input.ownerEmployeeId !== undefined,
          input.ownerEmployeeId ?? null,
          input.status ?? null,
          resolution !== undefined,
          resolution ?? null,
          input.version,
        ],
      );
      if (!res.rows[0]) {
        throw new ConflictException('This item changed or was not found; refresh and retry.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_revision_item_updated',
        objectType: 'audit_materiality_revision_item',
        objectId: itemId,
        after: { owner: input.ownerEmployeeId, status: input.status },
      });
      const items = await this.readRevisionItems(client, res.rows[0].determination_id);
      return items.find((i) => i.id === itemId)!;
    });
  }

  // ── §20 / §23 reassessment of a completed version ──────────────────────────

  /**
   * §20 — 03.2 figures moved. A COMPLETED determination whose benchmark no
   * longer matches its source is flagged for reassessment: the approved OM is
   * never changed, the checklist row needs attention and the Manager is told.
   * Runs inside the 03.2 write's transaction (any team member's context).
   */
  async afterSourceChange(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const row = await this.readCurrentRow(client, workflowInstanceId);
    if (
      !row ||
      row.status !== 'complete' ||
      !row.selected_benchmark ||
      row.selected_benchmark === 'other' ||
      row.benchmark_amount === null
    ) {
      return;
    }
    const det = mapDet(row);
    const ws = await this.workspace(client, workflowInstanceId, det);
    const live = selectedBenchmarkAmount(det, ws.candidates);
    const ref = num(row.reassessed_benchmark_amount) ?? num(row.benchmark_amount)!;
    if (live !== null && Math.abs(live - ref) <= 0.005) return;
    const label = MATERIALITY_BENCHMARK_LABEL[row.selected_benchmark];
    const units = ws.dataset.unitLabel ?? 'dataset units';
    const amt = (n: number) => n.toLocaleString('en-IN');
    const reason =
      (live === null
        ? `${label} is no longer available in 03.2 (was ${amt(ref)}, ${units})`
        : `${label} changed in 03.2 from ${amt(ref)} to ${amt(live)} (${units})`) +
      ` after materiality ${det.versionLabel} was completed. The approved amounts are unchanged — revise materiality (03.3.11) or record why ${det.versionLabel} still stands.`;
    const open = !!row.reassessment_flagged_at && !row.reassessment_resolved_at;
    if (!open) {
      await this.flagReassessment(
        client,
        ctx,
        engagementId,
        workflowInstanceId,
        row,
        'source_change',
        reason,
      );
      return;
    }
    // Already flagged: keep one flag, with the latest figures in its reason.
    const merged =
      row.reassessment_source === 'source_change'
        ? reason
        : `${(row.reassessment_reason ?? '').split(' Also: ')[0]} Also: ${reason}`;
    if (merged === row.reassessment_reason) return;
    await client.query(
      `UPDATE hsdg.audit_materiality_determination
          SET reassessment_reason = $2, version = version + 1 WHERE id = $1`,
      [row.id, merged],
    );
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.materiality_reassessment_updated',
      objectType: 'audit_materiality_determination',
      objectId: row.id,
      after: { reason: merged },
    });
  }

  /** §23 — the Engagement Partner sends the completed version back for reassessment. */
  async requireReassessment(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RequireMaterialityReassessmentInput,
  ): Promise<MaterialitySummary> {
    const reason = clean(input.reason);
    if (!reason) throw new BadRequestException('Say why materiality must be reassessed.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const row = await this.readCurrentRow(client, workflowInstanceId);
      if (!row || row.status !== 'complete') {
        throw new ConflictException(
          'Only a completed determination can be sent back for reassessment — challenge the draft instead.',
        );
      }
      if (row.version !== input.version) {
        throw new ConflictException('Materiality changed since you loaded it; refresh and retry.');
      }
      if (row.reassessment_flagged_at && !row.reassessment_resolved_at) {
        throw new ConflictException('A reassessment is already pending on this version.');
      }
      await this.flagReassessment(
        client,
        ctx,
        engagementId,
        workflowInstanceId,
        row,
        'partner',
        reason,
      );
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  /**
   * The Manager reassessed and the version in force still stands ("no
   * change", with the reason). A change instead goes through a revision,
   * which takes the flag over.
   */
  async resolveReassessment(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ResolveMaterialityReassessmentInput,
  ): Promise<MaterialitySummary> {
    const resolution = clean(input.resolution);
    if (!resolution) {
      throw new BadRequestException(
        'Record why the version in force still stands — or start a revision (03.3.11).',
      );
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const row = await this.readCurrentRow(client, workflowInstanceId);
      if (
        !row ||
        row.status !== 'complete' ||
        !row.reassessment_flagged_at ||
        row.reassessment_resolved_at
      ) {
        throw new ConflictException('No reassessment is pending on the version in force.');
      }
      if (row.version !== input.version) {
        throw new ConflictException('Materiality changed since you loaded it; refresh and retry.');
      }
      // The live benchmark the Manager reassessed against: the next 03.2 change compares with it.
      let live: number | null = null;
      if (row.selected_benchmark && row.selected_benchmark !== 'other') {
        const det = mapDet(row);
        const ws = await this.workspace(client, workflowInstanceId, det);
        live = selectedBenchmarkAmount(det, ws.candidates);
      }
      await client.query(
        `UPDATE hsdg.audit_materiality_determination
            SET reassessment_resolution = $2, reassessment_resolved_at = now(),
                reassessment_resolved_by_employee_id = hsdg.ctx_employee_id(),
                reassessed_benchmark_amount = COALESCE($3, reassessed_benchmark_amount),
                version = version + 1
          WHERE id = $1`,
        [row.id, resolution, live],
      );
      await this.rollUp(client, ctx, workflowInstanceId, 'complete');
      const actor = await resolvePlanningActor(client, engagementId);
      await notifyPlanning(client, [actor.partnerId], {
        type: NOTIFICATION_TYPE.planningMaterialityReassessment,
        title: `Materiality ${materialityVersionLabel(row.version_no)} reassessed — no change`,
        body: resolution,
        engagementId,
        objectType: 'audit_materiality_determination',
        objectId: row.id,
        dedup: `m033-reassess-resolved:${row.id}:${row.version}`,
        except: ctx.employeeId ?? null,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_reassessment_resolved',
        objectType: 'audit_materiality_determination',
        objectId: row.id,
        before: { reason: row.reassessment_reason, source: row.reassessment_source },
        after: { resolution, reassessedBenchmarkAmount: live },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  // ── §23 Engagement Partner comments / challenges ───────────────────────────

  async createChallenge(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateMaterialityChallengeInput,
  ): Promise<MaterialitySummary> {
    const body = clean(input.body);
    if (!body) throw new BadRequestException('Write the comment or challenge.');
    if (!MATERIALITY_CHALLENGE_TARGETS.includes(input.targetType)) {
      throw new BadRequestException('Unknown 03.3 area.');
    }
    if (!MATERIALITY_CHALLENGE_KINDS.includes(input.kind)) {
      throw new BadRequestException('Choose comment or challenge.');
    }
    const targetRef = clean(input.targetRef);
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const current = await this.readCurrentRow(client, workflowInstanceId);
      const { rows } = await client.query<{ id: string; seq: number }>(
        `INSERT INTO hsdg.audit_materiality_challenge
           (workflow_instance_id, engagement_id, seq, determination_version_no, target_type,
            target_ref, kind, body, raised_by_employee_id)
         SELECT $1, $2, COALESCE(MAX(seq), 0) + 1, $3, $4, $5, $6, $7, hsdg.ctx_employee_id()
           FROM hsdg.audit_materiality_challenge WHERE workflow_instance_id = $1
         RETURNING id, seq`,
        [
          workflowInstanceId,
          engagementId,
          current?.version_no ?? 1,
          input.targetType,
          targetRef,
          input.kind,
          body,
        ],
      );
      const created = rows[0]!;
      const target = challengeTargetLabel(input.targetType, targetRef);
      const actor = await resolvePlanningActor(client, engagementId);
      await notifyPlanning(client, [actor.managerId], {
        type: NOTIFICATION_TYPE.planningMaterialityChallenge,
        title: `Engagement Partner ${input.kind} on 03.3 — ${target}`,
        body,
        engagementId,
        objectType: 'audit_materiality_challenge',
        objectId: created.id,
        dedup: `m033-challenge:${created.id}`,
        except: ctx.employeeId ?? null,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_challenge_raised',
        objectType: 'audit_materiality_challenge',
        objectId: created.id,
        after: { code: displayCode('PC', created.seq), target, kind: input.kind },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  /** The Engagement Manager answers (a completed version stays in force — revise to act on it). */
  async respondChallenge(
    ctx: RlsContext,
    engagementId: string,
    challengeId: string,
    input: RespondMaterialityChallengeInput,
  ): Promise<MaterialitySummary> {
    const response = clean(input.response);
    if (!response) throw new BadRequestException('Write the response.');
    return this.db.withRlsContext(ctx, async (client) => {
      const c = await this.loadChallenge(client, engagementId, challengeId);
      if (c.status === 'closed') throw new ConflictException('This challenge is already closed.');
      const res = await client.query(
        `UPDATE hsdg.audit_materiality_challenge
            SET response = $3, responded_by_employee_id = hsdg.ctx_employee_id(),
                responded_at = now(), status = 'responded', version = version + 1
          WHERE id = $1 AND version = $2`,
        [challengeId, input.version, response],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This challenge changed since you loaded it; refresh and retry.',
        );
      }
      const actor = await resolvePlanningActor(client, engagementId);
      await notifyPlanning(client, [actor.partnerId], {
        type: NOTIFICATION_TYPE.planningMaterialityChallenge,
        title: `Manager responded to ${displayCode('PC', c.seq)} on 03.3`,
        body: response,
        engagementId,
        objectType: 'audit_materiality_challenge',
        objectId: challengeId,
        dedup: `m033-challenge-response:${challengeId}:${c.version}`,
        except: ctx.employeeId ?? null,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_challenge_responded',
        objectType: 'audit_materiality_challenge',
        objectId: challengeId,
        after: { response },
      });
      return this.buildSummary(client, c.workflow_instance_id);
    });
  }

  /** The Engagement Partner closes a comment, or a challenge once answered. */
  async closeChallenge(
    ctx: RlsContext,
    engagementId: string,
    challengeId: string,
    input: CloseMaterialityChallengeInput,
  ): Promise<MaterialitySummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const c = await this.loadChallenge(client, engagementId, challengeId);
      if (c.status === 'closed') throw new ConflictException('This challenge is already closed.');
      if (c.kind === 'challenge' && !c.response) {
        throw new ConflictException(
          'The Engagement Manager has not responded to this challenge yet.',
        );
      }
      const res = await client.query(
        `UPDATE hsdg.audit_materiality_challenge
            SET status = 'closed', closed_by_employee_id = hsdg.ctx_employee_id(),
                closed_at = now(), version = version + 1
          WHERE id = $1 AND version = $2`,
        [challengeId, input.version],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This challenge changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.materiality_challenge_closed',
        objectType: 'audit_materiality_challenge',
        objectId: challengeId,
      });
      return this.buildSummary(client, c.workflow_instance_id);
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Raise the reassessment flag on the completed version, roll it up and tell the Manager. */
  private async flagReassessment(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    row: DetRow,
    source: MaterialityReassessmentSource,
    reason: string,
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_materiality_determination
          SET reassessment_source = $2, reassessment_reason = $3, reassessment_flagged_at = now(),
              reassessment_flagged_by_employee_id = hsdg.ctx_employee_id(),
              reassessment_resolution = NULL, reassessment_resolved_at = NULL,
              reassessment_resolved_by_employee_id = NULL, version = version + 1
        WHERE id = $1 AND status = 'complete'`,
      [row.id, source, reason],
    );
    await this.rollUp(client, ctx, workflowInstanceId, 'needs_attention');
    const actor = await resolvePlanningActor(client, engagementId);
    const label = materialityVersionLabel(row.version_no);
    await notifyPlanning(client, [actor.managerId ?? actor.partnerId], {
      type: NOTIFICATION_TYPE.planningMaterialityReassessment,
      title:
        source === 'partner'
          ? `Engagement Partner requires reassessment of materiality ${label}`
          : `Materiality ${label} needs reassessment — 03.2 figures changed`,
      body: reason,
      engagementId,
      objectType: 'audit_materiality_determination',
      objectId: row.id,
      dedup: `m033-reassess:${row.id}:${row.version}`,
      except: ctx.employeeId ?? null,
    });
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.materiality_reassessment_required',
      objectType: 'audit_materiality_determination',
      objectId: row.id,
      after: { source, reason, version: label },
    });
  }

  /** §21 — a revision carries the evidence of every record it copies (the old version keeps its own). */
  private async carryEvidence(client: PoolClient, fromId: string, toId: string): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.audit_planning_evidence
         (workflow_instance_id, engagement_id, target_type, target_id, document_id,
          linked_by_employee_id, linked_at)
       SELECT ev.workflow_instance_id, ev.engagement_id, ev.target_type, m.new_id, ev.document_id,
              ev.linked_by_employee_id, ev.linked_at
         FROM hsdg.audit_planning_evidence ev
         JOIN (
           SELECT 'materiality_determination'::text AS t, $1::uuid AS old_id, $2::uuid AS new_id
           UNION ALL
           SELECT 'materiality_adjustment', o.id, n.id
             FROM hsdg.audit_materiality_adjustment o
             JOIN hsdg.audit_materiality_adjustment n ON n.determination_id = $2 AND n.seq = o.seq
            WHERE o.determination_id = $1
           UNION ALL
           SELECT 'materiality_specific', o.id, n.id
             FROM hsdg.audit_materiality_specific o
             JOIN hsdg.audit_materiality_specific n ON n.determination_id = $2 AND n.seq = o.seq
            WHERE o.determination_id = $1
           UNION ALL
           SELECT 'materiality_qualitative', o.id, n.id
             FROM hsdg.audit_materiality_qualitative o
             JOIN hsdg.audit_materiality_qualitative n
               ON n.determination_id = $2 AND n.consideration_key = o.consideration_key
            WHERE o.determination_id = $1
         ) m ON m.t = ev.target_type AND m.old_id = ev.target_id
        WHERE ev.removed_at IS NULL
       ON CONFLICT DO NOTHING`,
      [fromId, toId],
    );
  }

  /** §20 / §21 / §23 block of the summary. */
  private async readGovernance(
    client: PoolClient,
    workflowInstanceId: string,
    row: DetRow | null,
  ): Promise<MaterialityGovernance> {
    const { rows: wf } = await client.query<{ engagement_id: string }>(
      `SELECT engagement_id FROM hsdg.service_workflow_instances WHERE id = $1`,
      [workflowInstanceId],
    );
    const actor = await resolvePlanningActor(client, wf[0]!.engagement_id);
    const lock = await readPlanningLock(client, workflowInstanceId);
    return {
      access: {
        role: actor.role,
        roleLabel: PLANNING_ACTOR_ROLE_LABEL[actor.role],
        actingAsManager: actor.actingAsManager,
        capabilities: actor.capabilities,
        planningApproved: lock.approved,
      },
      challenges: await this.readChallenges(client, workflowInstanceId),
      reassessment: await this.readReassessment(client, row),
      evidenceCounts: await this.readEvidenceCounts(client, workflowInstanceId),
    };
  }

  private async readReassessment(
    client: PoolClient,
    row: DetRow | null,
  ): Promise<MaterialityReassessment | null> {
    if (!row?.reassessment_flagged_at || !row.reassessment_source) return null;
    const ids = [
      row.reassessment_flagged_by_employee_id,
      row.reassessment_resolved_by_employee_id,
    ].filter((x): x is string => !!x);
    const names = new Map<string, string>();
    if (ids.length) {
      const { rows } = await client.query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM hsdg.employees WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      for (const r of rows) names.set(r.id, r.full_name);
    }
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return {
      open: !row.reassessment_resolved_at,
      source: row.reassessment_source,
      reason: row.reassessment_reason ?? '',
      flaggedAt: row.reassessment_flagged_at.toISOString(),
      flaggedByName: name(row.reassessment_flagged_by_employee_id),
      resolution: row.reassessment_resolution,
      resolvedAt: row.reassessment_resolved_at ? row.reassessment_resolved_at.toISOString() : null,
      resolvedByName: name(row.reassessment_resolved_by_employee_id),
    };
  }

  private async readChallenges(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<MaterialityChallengeRecord[]> {
    const { rows } = await client.query<
      ChallengeRow & {
        raised_by_name: string | null;
        responded_by_name: string | null;
        raised_at: Date;
        responded_at: Date | null;
        determination_version_no: number;
      }
    >(
      `SELECT c.*, rb.full_name AS raised_by_name, rs.full_name AS responded_by_name
         FROM hsdg.audit_materiality_challenge c
         LEFT JOIN hsdg.employees rb ON rb.id = c.raised_by_employee_id
         LEFT JOIN hsdg.employees rs ON rs.id = c.responded_by_employee_id
        WHERE c.workflow_instance_id = $1
        ORDER BY c.seq DESC`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({
      id: r.id,
      code: displayCode('PC', r.seq)!,
      targetType: r.target_type,
      targetRef: r.target_ref,
      targetLabel: challengeTargetLabel(r.target_type, r.target_ref),
      versionLabel: materialityVersionLabel(r.determination_version_no),
      kind: r.kind,
      body: r.body,
      raisedByName: r.raised_by_name,
      raisedAt: r.raised_at.toISOString(),
      response: r.response,
      respondedByName: r.responded_by_name,
      respondedAt: r.responded_at ? r.responded_at.toISOString() : null,
      status: r.status,
      version: r.version,
    }));
  }

  private async loadChallenge(
    client: PoolClient,
    engagementId: string,
    challengeId: string,
  ): Promise<ChallengeRow> {
    const { rows } = await client.query<ChallengeRow>(
      `SELECT * FROM hsdg.audit_materiality_challenge WHERE id = $1 AND engagement_id = $2`,
      [challengeId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Challenge not found.');
    return rows[0];
  }

  /** Live evidence files per 03.3 record id. */
  private async readEvidenceCounts(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<Record<string, number>> {
    const { rows } = await client.query<{ target_id: string; n: string }>(
      `SELECT target_id, count(*) AS n FROM hsdg.audit_planning_evidence
        WHERE workflow_instance_id = $1 AND removed_at IS NULL
          AND target_type IN ('materiality_determination','materiality_adjustment',
                              'materiality_specific','materiality_qualitative')
        GROUP BY target_id`,
      [workflowInstanceId],
    );
    return Object.fromEntries(rows.map((r) => [r.target_id, Number(r.n)]));
  }

  /** Highest version — the current draft, or the completed version in force. */
  private async readCurrentRow(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<DetRow | null> {
    const { rows } = await client.query<DetRow>(
      `${DET_SELECT} WHERE d.workflow_instance_id = $1 ORDER BY d.version_no DESC LIMIT 1`,
      [workflowInstanceId],
    );
    return rows[0] ?? null;
  }

  /**
   * The editable draft, creating v1.0 on first use. A completed determination
   * is never edited in place — the caller must start a revision.
   */
  private async ensureDraft(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ row: DetRow; created: boolean }> {
    const current = await this.readCurrentRow(client, workflowInstanceId);
    if (current?.status === 'draft') return { row: current, created: false };
    if (current) {
      throw new ConflictException(
        `Materiality ${materialityVersionLabel(current.version_no)} is complete and in use. Start a revision (03.3.11) to change it — the approved determination is never overwritten.`,
      );
    }
    await client.query(
      `INSERT INTO hsdg.audit_materiality_determination (workflow_instance_id, engagement_id, version_no)
       VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
      [workflowInstanceId, engagementId],
    );
    await this.rollUp(client, ctx, workflowInstanceId, 'in_progress');
    const row = await this.readCurrentRow(client, workflowInstanceId);
    return { row: row!, created: true };
  }

  /** Child record changed: bump the draft (so stale forms conflict) and refresh revision flags. */
  private async touched(
    client: PoolClient,
    ctx: RlsContext,
    workflowInstanceId: string,
    determinationId: string,
    engagementId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_materiality_determination SET version = version + 1 WHERE id = $1`,
      [determinationId],
    );
    await this.syncRevisionItems(client, engagementId, workflowInstanceId, determinationId);
    await this.rollUp(client, ctx, workflowInstanceId, 'in_progress');
  }

  private async rollUp(
    client: PoolClient,
    ctx: RlsContext,
    workflowInstanceId: string,
    state: 'in_progress' | 'complete' | 'needs_attention',
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_planning_items
          SET state = $3, updated_by_employee_id = $4, content_updated_at = now(),
              version = version + 1
        WHERE workflow_instance_id = $1 AND item_key = $2 AND state <> $3`,
      [workflowInstanceId, MATERIALITY_ITEM_KEY, state, ctx.employeeId ?? null],
    );
  }

  /** Publish the completed version to the flat current-version cache (§16). */
  private async publish(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    det: MaterialityDetermination,
  ): Promise<void> {
    const benchmark = det.selectedBenchmark
      ? `${det.selectedBenchmark === 'other' ? (det.otherBenchmarkLabel ?? 'Other') : MATERIALITY_BENCHMARK_LABEL[det.selectedBenchmark]} @ ${det.selectedPct ?? '—'}%`
      : null;
    const basis =
      `03.3 Materiality ${materialityVersionLabel(det.versionNo)}. ${det.benchmarkRationale ?? ''}`.trim();
    await client.query(
      `INSERT INTO hsdg.audit_materiality
         (workflow_instance_id, engagement_id, overall_materiality, performance_materiality,
          clearly_trivial_threshold, benchmark, basis, decided_by_employee_id, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (workflow_instance_id) DO UPDATE
         SET overall_materiality = EXCLUDED.overall_materiality,
             performance_materiality = EXCLUDED.performance_materiality,
             clearly_trivial_threshold = EXCLUDED.clearly_trivial_threshold,
             benchmark = EXCLUDED.benchmark, basis = EXCLUDED.basis,
             decided_by_employee_id = EXCLUDED.decided_by_employee_id, decided_at = now(),
             version = hsdg.audit_materiality.version + 1`,
      [
        workflowInstanceId,
        engagementId,
        det.selectedOm,
        det.selectedPm,
        det.selectedCtt,
        benchmark,
        basis,
        ctx.employeeId ?? null,
      ],
    );
  }

  private async syncRevisionItems(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    determinationId: string,
  ): Promise<void> {
    const { rows } = await client.query<DetRow>(`${DET_SELECT} WHERE d.id = $1`, [determinationId]);
    const det = mapDet(rows[0]!);
    if (det.versionNo <= 1 || det.status !== 'draft') return;
    const baseline = await this.readBaseline(client, workflowInstanceId, det.versionNo);
    const specific = await this.readSpecific(client, determinationId);
    const impacts = revisionImpacts(det, baseline, specific.length);
    for (const i of impacts) {
      await client.query(
        `INSERT INTO hsdg.audit_materiality_revision_item
           (determination_id, engagement_id, item_key, label, detail)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (determination_id, item_key) DO UPDATE
           SET label = EXCLUDED.label, detail = EXCLUDED.detail, applicable = true,
               version = hsdg.audit_materiality_revision_item.version + 1
           WHERE hsdg.audit_materiality_revision_item.detail IS DISTINCT FROM EXCLUDED.detail
              OR NOT hsdg.audit_materiality_revision_item.applicable`,
        [determinationId, engagementId, i.itemKey, i.label, i.detail],
      );
    }
    // Items that no longer apply are kept (never deleted) but marked not applicable.
    await client.query(
      `UPDATE hsdg.audit_materiality_revision_item
          SET applicable = false, version = version + 1
        WHERE determination_id = $1 AND applicable AND NOT (item_key = ANY($2::text[]))`,
      [determinationId, impacts.map((i) => i.itemKey)],
    );
  }

  private async readBaseline(
    client: PoolClient,
    workflowInstanceId: string,
    versionNo: number,
  ): Promise<MaterialityBaseline | null> {
    if (versionNo <= 1) return null;
    const { rows } = await client.query<DetRow>(
      `${DET_SELECT} WHERE d.workflow_instance_id = $1 AND d.version_no < $2
          AND d.status IN ('complete','superseded')
        ORDER BY d.version_no DESC LIMIT 1`,
      [workflowInstanceId, versionNo],
    );
    const b = rows[0];
    if (!b) return null;
    const { rows: c } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM hsdg.audit_materiality_specific WHERE determination_id = $1`,
      [b.id],
    );
    return {
      versionLabel: materialityVersionLabel(b.version_no),
      overallMateriality: num(b.selected_om),
      performanceMateriality: num(b.selected_pm),
      clearlyTrivial: num(b.selected_ctt),
      specificCount: Number(c[0]?.n ?? 0),
      benchmark: b.selected_benchmark,
      selectedPct: num(b.selected_pct),
    };
  }

  private compute(ws: Workspace) {
    return computeMateriality({
      det: ws.det,
      candidates: ws.candidates,
      methodology: ws.methodology,
      unitFactor: ws.dataset.unitFactor,
      aggregation: aggregationRiskFactors({ facts: ws.facts, det: ws.det }),
    });
  }

  /** Load everything 03.3 derives from 02 / 03.1 / 03.2 for a determination. */
  private async workspace(
    client: PoolClient,
    workflowInstanceId: string,
    det: MaterialityDetermination,
  ): Promise<Workspace> {
    const { header, analytics } = await this.understanding.readFinancialBasis(
      client,
      workflowInstanceId,
    );
    const factor = header.units ? FINANCIAL_UNIT_FACTOR[header.units] : null;
    const ready = analytics.ready && factor !== null;
    const dataset: MaterialityDatasetInfo = {
      ready,
      reason: !analytics.ready
        ? 'Complete the 03.2.7 dataset header (period end, currency, units) first.'
        : factor === null
          ? 'The 03.2.7 dataset uses units that cannot be converted to rupees — materiality needs convertible units.'
          : null,
      periodEnd: header.periodEnd,
      currency: header.currency,
      units: header.units,
      unitLabel: header.units ? FINANCIAL_UNIT_LABEL[header.units] : null,
      unitFactor: factor,
      dataStatus: header.dataStatus,
      cySource: header.cySource,
    };
    const metrics: Workspace['metrics'] = {};
    for (const m of analytics.movements) metrics[m.metricKey] = { cy: m.cy, py: m.py };

    const periodStart = header.periodEnd
      ? periodStartFor(header.periodEnd)
      : new Date().toISOString().slice(0, 10);
    const methodology = resolveMaterialityMethodology(
      await this.rules.buildResolverOn(client, periodStart),
    );
    const facts = await this.readFacts(client, workflowInstanceId);
    facts.relatedPartyFigures = metrics.related_party?.cy != null;

    const adjustments = det.id ? await this.readAdjustments(client, det.id) : [];
    const assessments: Parameters<typeof buildCandidates>[0]['assessments'] = {};
    if (det.id) {
      const { rows } = await client.query<{
        candidate_key: CandidateBenchmark;
        assessment: BenchmarkAssessment;
        rationale: string | null;
        version: number;
      }>(
        `SELECT candidate_key, assessment, rationale, version FROM hsdg.audit_materiality_benchmark
          WHERE determination_id = $1`,
        [det.id],
      );
      for (const r of rows) {
        assessments[r.candidate_key] = {
          assessment: r.assessment,
          rationale: r.rationale,
          version: r.version,
        };
      }
    }
    const candidates = buildCandidates({
      dataset,
      metrics,
      adjustmentsTotal: adjustments.reduce((s, a) => s + a.amount, 0),
      hasAdjustments: adjustments.length > 0,
      userFocus: det.userFocus,
      principalUsers: det.principalUsers,
      methodology,
      assessments,
      facts,
    });
    const specific = det.id ? await this.readSpecific(client, det.id) : [];
    const pbt = candidates.find((c) => c.key === 'pbt')!;
    const prompts = qualitativePrompts({
      facts,
      pbtInr: pbt.cy !== null && factor ? pbt.cy * factor : null,
      selectedOm: det.selectedOm,
    });
    const qualitative = await this.readQualitative(client, det.id, prompts);
    return {
      det,
      dataset,
      metrics,
      facts,
      methodology,
      adjustments,
      candidates,
      specific,
      qualitative,
    };
  }

  private async buildSummary(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<MaterialitySummary> {
    const row = await this.readCurrentRow(client, workflowInstanceId);
    const det = row ? mapDet(row) : emptyDetermination();
    const ws = await this.workspace(client, workflowInstanceId, det);
    const computed = this.compute(ws);
    const baseline = await this.readBaseline(client, workflowInstanceId, det.versionNo);
    const revisionItems = det.id ? await this.readRevisionItems(client, det.id) : [];
    const partnerAttention = partnerAttentionTriggers({
      det,
      candidates: ws.candidates,
      computed,
      methodology: ws.methodology,
      adjustments: ws.adjustments,
      specific: ws.specific,
      qualitative: ws.qualitative,
    });
    const governance = await this.readGovernance(client, workflowInstanceId, row);
    const completion = [
      ...computeMaterialityCompletion({
        det,
        dataset: ws.dataset,
        candidates: ws.candidates,
        computed,
        adjustments: ws.adjustments,
        specific: ws.specific,
        qualitative: ws.qualitative,
        revisionItems,
      }),
      ...governanceCompletion(governance.challenges, ws.adjustments, governance.evidenceCounts),
    ];
    return {
      determination: det,
      baseline,
      history: await this.readHistory(client, workflowInstanceId),
      dataset: ws.dataset,
      context: await this.readContext(client, workflowInstanceId, ws),
      methodology: ws.methodology,
      candidates: ws.candidates,
      adjustments: ws.adjustments,
      normalisation: summariseNormalisation(ws.adjustments, ws.metrics.pbt?.cy ?? null),
      pctFactors: percentageFactors({
        facts: ws.facts,
        det,
        candidates: ws.candidates,
        borrowingsCy: ws.metrics.total_borrowings?.cy ?? null,
      }),
      aggregationFactors: aggregationRiskFactors({ facts: ws.facts, det }),
      specificPrompts: specificMaterialityPrompts(ws.facts),
      specific: ws.specific,
      qualitative: ws.qualitative,
      sensitivity: buildSensitivity({ det, candidates: ws.candidates }),
      computed,
      partnerAttention,
      revisionItems,
      impactPreview: MATERIALITY_IMPACT_PREVIEW.map((i) => ({ ...i })),
      authorities: await this.readAuthorities(client),
      completion,
      governance,
    };
  }

  private async readFacts(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<MaterialityFacts> {
    const { rows: profile } = await client.query<{
      initial_audit: boolean;
      special_entity_types: SpecialEntityType[];
    }>(
      `SELECT initial_audit, special_entity_types FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const { rows: bu } = await client.query<{ industry_profile: string }>(
      `SELECT industry_profile FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const { rows: changes } = await client.query<{ category: PlanningChangeCategory }>(
      `SELECT DISTINCT category FROM hsdg.audit_planning_change
        WHERE workflow_instance_id = $1 AND category <> 'no_significant_change'`,
      [workflowInstanceId],
    );
    const { rows: focus } = await client.query<{ seq: number; name: string }>(
      `SELECT seq, name FROM hsdg.audit_area_of_focus WHERE workflow_instance_id = $1 ORDER BY seq`,
      [workflowInstanceId],
    );
    const { rows: signals } = await client.query<{
      seq: number;
      observation: string;
      rule_key: string | null;
      attention: string;
    }>(
      `SELECT seq, observation, rule_key, attention FROM hsdg.audit_planning_signal
        WHERE workflow_instance_id = $1 AND status <> 'closed'
          AND manager_assessment IS DISTINCT FROM 'not_relevant'
        ORDER BY seq`,
      [workflowInstanceId],
    );
    const { rows: sections } = await client.query<{
      section_key: string;
      answers: Record<string, unknown>;
    }>(
      `SELECT section_key, answers FROM hsdg.audit_understanding_section
        WHERE workflow_instance_id = $1 AND section_key IN ('performance','systems')`,
      [workflowInstanceId],
    );
    const { rows: elevated } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM hsdg.audit_analytics_exception
        WHERE workflow_instance_id = $1 AND NOT no_longer_flagged AND suggested_attention <> 'standard'`,
      [workflowInstanceId],
    );
    const answer = (section: string, key: string) =>
      sections.find((s) => s.section_key === section)?.answers?.[key];
    const covenants = answer('performance', 'covenants');
    return {
      initialAudit: profile[0] ? profile[0].initial_audit : null,
      specialEntityTypes: profile[0]?.special_entity_types ?? [],
      industryProfile: bu[0]?.industry_profile ?? null,
      changeCategories: changes.map((c) => c.category),
      focusAreas: focus.map((f) => ({ code: displayCode('FA', f.seq)!, name: f.name })),
      signals: signals.map((s) => ({
        code: displayCode('PS', s.seq)!,
        observation: s.observation,
        ruleKey: s.rule_key,
        attention: s.attention,
      })),
      covenantsNote: typeof covenants === 'string' && covenants.trim() ? covenants.trim() : null,
      erpChange: answer('systems', 'erp_change') === 'Yes',
      relatedPartyFigures: false,
      elevatedAnalytics: Number(elevated[0]?.n ?? 0),
    };
  }

  /** 03.3.1 — prefilled context; nothing here is re-keyed. */
  private async readContext(
    client: PoolClient,
    workflowInstanceId: string,
    ws: Workspace,
  ): Promise<MaterialityContextItem[]> {
    const { facts, dataset, det } = ws;
    const out: MaterialityContextItem[] = [];
    const add = (label: string, value: string | null | undefined, source: string) => {
      if (value) out.push({ label, value, source });
    };
    const { rows: eng } = await client.query<{
      legal_name: string | null;
      engagement_code: string | null;
      period_label: string | null;
    }>(
      `SELECT en.legal_name, e.engagement_code, e.period_label
         FROM hsdg.service_workflow_instances wi
         JOIN hsdg.engagements e ON e.id = wi.engagement_id
         LEFT JOIN hsdg.entities en ON en.id = e.entity_id
        WHERE wi.id = $1`,
      [workflowInstanceId],
    );
    add(
      'Entity / engagement',
      [eng[0]?.legal_name, eng[0]?.engagement_code, eng[0]?.period_label]
        .filter(Boolean)
        .join(' · ') || null,
      'Engagement',
    );
    add('Period end', dataset.periodEnd, '03.2.7');
    add(
      'Currency / units',
      [dataset.currency, dataset.unitLabel].filter(Boolean).join(' · ') || null,
      '03.2.7',
    );
    add(
      'Source status',
      dataset.dataStatus
        ? `${dataset.dataStatus.replace(/_/g, ' ')}${dataset.cySource ? ` — ${dataset.cySource}` : ''}`
        : null,
      '03.2.7',
    );
    add(
      'Audit type',
      facts.initialAudit === null
        ? null
        : facts.initialAudit
          ? 'Initial audit'
          : 'Continuing audit',
      '02.1',
    );
    add(
      'Entity classification / public-interest characteristics',
      facts.specialEntityTypes.length
        ? facts.specialEntityTypes.join(', ').replace(/_/g, ' ')
        : 'None recorded',
      '02.1',
    );
    add('Industry analytics profile', facts.industryProfile, '03.2');
    add(
      'Significant current-year changes',
      facts.changeCategories.map((c) => PLANNING_CHANGE_CATEGORY_LABEL[c]).join(', ') ||
        'None recorded',
      '03.1 PI-01',
    );
    add(
      'Areas of Focus',
      facts.focusAreas.map((f) => `${f.code} ${f.name}`).join('; ') || 'None',
      '03.1',
    );
    add(
      'Prior-year materiality',
      det.pyOverallMateriality !== null
        ? `OM ₹${det.pyOverallMateriality.toLocaleString('en-IN')}${det.pyBenchmark ? ` (${det.pyBenchmark})` : ''}${det.pySource ? ` — ${det.pySource}` : ''}`
        : 'Not recorded (no prior-year portal file — enter below where available)',
      'Prior engagement',
    );
    return out;
  }

  private async readAuthorities(client: PoolClient): Promise<MaterialityAuthorityRef[]> {
    const { rows } = await client.query<{ code: string; title: string; provision_number: string }>(
      `SELECT DISTINCT ON (code) code, title, provision_number FROM hsdg.authority_provision
        WHERE code = ANY($1::text[]) ORDER BY code, effective_from DESC`,
      [AUTHORITY_CODES.map(([c]) => c)],
    );
    return AUTHORITY_CODES.map(([code, label]) => {
      const r = rows.find((x) => x.code === code);
      return { code, label, title: r?.title ?? null, provisionNumber: r?.provision_number ?? null };
    });
  }

  private async readHistory(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<MaterialityVersionHistory[]> {
    const { rows } = await client.query<DetRow>(
      `${DET_SELECT} WHERE d.workflow_instance_id = $1 ORDER BY d.version_no`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({
      versionNo: r.version_no,
      versionLabel: materialityVersionLabel(r.version_no),
      status: r.status,
      overallMateriality: num(r.selected_om),
      performanceMateriality: num(r.selected_pm),
      clearlyTrivial: num(r.selected_ctt),
      revisionTrigger: r.revision_trigger,
      revisionReason: r.revision_reason,
      completedByName: r.completed_by_name,
      completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    }));
  }

  private async readAdjustments(
    client: PoolClient,
    determinationId: string,
  ): Promise<NormalisationAdjustment[]> {
    const { rows } = await client.query<{
      id: string;
      seq: number;
      description: string;
      amount: string;
      reason: string | null;
      recurring: boolean;
      evidence: string | null;
      version: number;
    }>(
      `SELECT id, seq, description, amount, reason, recurring, evidence, version
         FROM hsdg.audit_materiality_adjustment WHERE determination_id = $1 ORDER BY seq`,
      [determinationId],
    );
    return rows.map((r) => ({
      id: r.id,
      code: displayCode('NA', r.seq)!,
      description: r.description,
      amount: Number(r.amount),
      reason: r.reason,
      recurring: r.recurring,
      evidence: r.evidence,
      version: r.version,
    }));
  }

  private async readSpecific(
    client: PoolClient,
    determinationId: string,
  ): Promise<SpecificMaterialityRecord[]> {
    const { rows } = await client.query<{
      id: string;
      seq: number;
      scope_type: SpecificMaterialityRecord['scopeType'];
      scope: string;
      threshold_type: SpecificMaterialityRecord['thresholdType'];
      amount: string | null;
      specific_pm: string | null;
      reason: string;
      affected_areas: string[];
      version: number;
    }>(
      `SELECT id, seq, scope_type, scope, threshold_type, amount, specific_pm, reason,
              affected_areas, version
         FROM hsdg.audit_materiality_specific WHERE determination_id = $1 ORDER BY seq`,
      [determinationId],
    );
    return rows.map((r) => ({
      id: r.id,
      code: displayCode('SM', r.seq)!,
      scopeType: r.scope_type,
      scope: r.scope,
      thresholdType: r.threshold_type,
      amount: num(r.amount),
      specificPm: num(r.specific_pm),
      reason: r.reason,
      affectedAreas: r.affected_areas ?? [],
      version: r.version,
    }));
  }

  private async readQualitative(
    client: PoolClient,
    determinationId: string | null,
    prompts: Record<string, string | null>,
  ): Promise<QualitativeChallengeItem[]> {
    const rows = determinationId
      ? (
          await client.query<{
            id: string;
            consideration_key: string;
            response: QualitativeChallengeItem['response'];
            note: string | null;
            signal_id: string | null;
            signal_seq: number | null;
            focus_id: string | null;
            focus_seq: number | null;
            significant: boolean;
            version: number;
          }>(
            `SELECT q.id, q.consideration_key, q.response, q.note, q.signal_id, s.seq AS signal_seq,
                    q.focus_id, f.seq AS focus_seq, q.significant, q.version
               FROM hsdg.audit_materiality_qualitative q
               LEFT JOIN hsdg.audit_planning_signal s ON s.id = q.signal_id
               LEFT JOIN hsdg.audit_area_of_focus f ON f.id = q.focus_id
              WHERE q.determination_id = $1`,
            [determinationId],
          )
        ).rows
      : [];
    return QUALITATIVE_CONSIDERATIONS.map(({ key, label }) => {
      const r = rows.find((x) => x.consideration_key === key);
      return {
        id: r?.id ?? null,
        key,
        label,
        prompt: prompts[key] ?? null,
        response: r?.response ?? null,
        note: r?.note ?? null,
        signalId: r?.signal_id ?? null,
        signalCode: displayCode('PS', r?.signal_seq),
        focusId: r?.focus_id ?? null,
        focusCode: displayCode('FA', r?.focus_seq),
        significant: r?.significant ?? false,
        version: r?.version ?? 0,
      };
    });
  }

  private async readRevisionItems(
    client: PoolClient,
    determinationId: string,
  ): Promise<RevisionImpactItem[]> {
    const { rows } = await client.query<{
      id: string;
      item_key: string;
      label: string;
      detail: string | null;
      applicable: boolean;
      owner_employee_id: string | null;
      owner_name: string | null;
      status: 'open' | 'resolved';
      resolution: string | null;
      version: number;
    }>(
      `SELECT i.id, i.item_key, i.label, i.detail, i.applicable, i.owner_employee_id,
              e.full_name AS owner_name, i.status, i.resolution, i.version
         FROM hsdg.audit_materiality_revision_item i
         LEFT JOIN hsdg.employees e ON e.id = i.owner_employee_id
        WHERE i.determination_id = $1 ORDER BY i.applicable DESC, i.created_at`,
      [determinationId],
    );
    return rows.map((r) => ({
      id: r.id,
      itemKey: r.item_key,
      label: r.label,
      detail: r.detail,
      applicable: r.applicable,
      ownerEmployeeId: r.owner_employee_id,
      ownerName: r.owner_name,
      status: r.status,
      resolution: r.resolution,
      version: r.version,
    }));
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────────

/**
 * §23 — the engagement team prepares (user context, prior-year figures, the
 * normalisation rationale draft); every other field is the Engagement
 * Manager's materiality judgment.
 */
const TEAM_FIELDS = new Set<string>(MATERIALITY_TEAM_FIELDS);

function assertMaterialityFields(actor: PlanningActor, input: UpdateMaterialityInput): void {
  if (actor.capabilities.assess) return;
  const judgments = Object.entries(input).filter(
    ([k, v]) => k !== 'version' && v !== undefined && !TEAM_FIELDS.has(k),
  );
  if (judgments.length) {
    throw new ForbiddenException(
      `Only the Engagement Manager selects the benchmark, determines OM / PM / specific / clearly trivial and completes 03.3 — the engagement team prepares the context, prior-year figures and normalisation schedule. (You are: ${PLANNING_ACTOR_ROLE_LABEL[actor.role]}.)`,
    );
  }
}

interface ChallengeRow {
  id: string;
  workflow_instance_id: string;
  seq: number;
  target_type: MaterialityChallengeRecord['targetType'];
  target_ref: string | null;
  kind: MaterialityChallengeRecord['kind'];
  body: string;
  response: string | null;
  status: MaterialityChallengeRecord['status'];
  version: number;
}

function challengeTargetLabel(
  targetType: MaterialityChallengeRecord['targetType'],
  targetRef: string | null,
): string {
  const area = MATERIALITY_CHALLENGE_TARGET_LABEL[targetType];
  return targetRef ? `${area} — ${targetRef}` : area;
}

/** §22 / §23 checks the engine does not see: EP challenges and normalisation evidence. */
function governanceCompletion(
  challenges: readonly MaterialityChallengeRecord[],
  adjustments: readonly NormalisationAdjustment[],
  evidenceCounts: Record<string, number>,
): PlanningCompletionCheck[] {
  const open = challenges.filter((c) => c.kind === 'challenge' && c.status === 'open');
  const checks: PlanningCompletionCheck[] = [
    {
      key: 'challenges',
      label: 'Engagement Partner challenges answered',
      met: open.length === 0,
      detail: open.length
        ? `${open.map((c) => c.code).join(', ')} await${open.length === 1 ? 's' : ''} the Manager's response.`
        : null,
    },
  ];
  if (adjustments.length) {
    const unsupported = adjustments.filter(
      (a) => !a.evidence && !((evidenceCounts[a.id] ?? 0) > 0),
    );
    checks.push({
      key: 'normalisation_evidence',
      label: 'Normalisation adjustments supported by evidence',
      met: unsupported.length === 0,
      detail: unsupported.length
        ? `Add or link the evidence (or cite the source) for ${unsupported.map((a) => a.code).join(', ')}.`
        : null,
    });
  }
  return checks;
}

/** Audit period start for methodology resolution: the day after the prior period end. */
function periodStartFor(periodEnd: string): string {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function emptyDetermination(): MaterialityDetermination {
  return mapDet(null);
}

function mapDet(r: DetRow | null): MaterialityDetermination {
  const versionNo = r?.version_no ?? 1;
  return {
    id: r?.id ?? null,
    versionNo,
    versionLabel: materialityVersionLabel(versionNo),
    status: r?.status ?? 'draft',
    methodologyVersion: r?.methodology_version ?? null,
    principalUsers: (r?.principal_users ?? []) as MaterialityDetermination['principalUsers'],
    principalUsersOther: r?.principal_users_other ?? null,
    userFocus: (r?.user_focus ?? []) as MaterialityDetermination['userFocus'],
    userFocusOther: r?.user_focus_other ?? null,
    pyOverallMateriality: num(r?.py_overall_materiality),
    pyPerformanceMateriality: num(r?.py_performance_materiality),
    pyClearlyTrivial: num(r?.py_clearly_trivial),
    pyBenchmark: r?.py_benchmark ?? null,
    pySource: r?.py_source ?? null,
    pyAuditDifferences: r?.py_audit_differences ?? null,
    normalisationRationale: r?.normalisation_rationale ?? null,
    selectedBenchmark: r?.selected_benchmark ?? null,
    otherBenchmarkLabel: r?.other_benchmark_label ?? null,
    otherBenchmarkAmount: num(r?.other_benchmark_amount),
    otherBenchmarkSource: r?.other_benchmark_source ?? null,
    benchmarkRationale: r?.benchmark_rationale ?? null,
    benchmarkAmount: num(r?.benchmark_amount),
    selectedPct: num(r?.selected_pct),
    calculatedOm: num(r?.calculated_om),
    selectedOm: num(r?.selected_om),
    omAdjustmentReason: r?.om_adjustment_reason ?? null,
    omOverrideReason: r?.om_override_reason ?? null,
    pctFactorsConsidered: r?.pct_factors_considered ?? [],
    pctFactorsNote: r?.pct_factors_note ?? null,
    mat04: r?.mat04 ?? null,
    mat04Rationale: r?.mat04_rationale ?? null,
    aggregationFactors: r?.aggregation_factors ?? [],
    aggregationOther: r?.aggregation_other ?? null,
    pmPct: num(r?.pm_pct),
    calculatedPm: num(r?.calculated_pm),
    selectedPm: num(r?.selected_pm),
    pmAdjustmentReason: r?.pm_adjustment_reason ?? null,
    pmRationale: r?.pm_rationale ?? null,
    pmOverrideReason: r?.pm_override_reason ?? null,
    mat06: r?.mat06 ?? null,
    mat06Note: r?.mat06_note ?? null,
    selectedCtt: num(r?.selected_ctt),
    cttRationale: r?.ctt_rationale ?? null,
    cttOverrideReason: r?.ctt_override_reason ?? null,
    mat07: r?.mat07 ?? null,
    mat07Note: r?.mat07_note ?? null,
    revisionTrigger: r?.revision_trigger ?? null,
    revisionReason: r?.revision_reason ?? null,
    revisionDate: r?.revision_date ?? null,
    revisionOwnerEmployeeId: r?.revision_owner_employee_id ?? null,
    revisionOwnerName: r?.revision_owner_name ?? null,
    conclusionSummary: r?.conclusion_summary ?? null,
    mat08: r?.mat08 ?? null,
    completedByName: r?.completed_by_name ?? null,
    completedAt: r?.completed_at ? r.completed_at.toISOString() : null,
    version: r?.version ?? 0,
  };
}

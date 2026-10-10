import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CONSOLIDATION_CONCLUSIONS,
  CONSOLIDATION_OUTCOME,
  CONSOLIDATION_PROFESSIONAL_ACTION,
  CONSOLIDATION_PROVISION_CODE,
  CONVERSION_STATUS,
  EMPTY_RULE6_EVIDENCE,
  FRAMEWORK_AREA_KEY,
  PERIMETER_INCLUSION,
  POLICY_ALIGNMENT,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type ConsolidationCapturedFacts,
  type ConsolidationConversion,
  type ConsolidationDetail,
  type ConsolidationFacts,
  type ConsolidationOutcome,
  type ConsolidationPriorYear,
  type ConsolidationProfessionalAction,
  type ConsolidationResult,
  type ConversionDifference,
  type ConversionStatus,
  type FrameworkConclusion,
  type FrameworkState,
  type FrameworkSubAssessment,
  type InvesteeInput,
  type LocalFramework,
  type PartnerApproveConsolidationInput,
  type RecordConsolidationDecisionInput,
  type ReportingFrameworkOutcome,
  type SetConsolidationFactsInput,
  type StatutoryAuditConsolidation,
  type StatutoryAuditConsolidationMasterFillResult,
  type UpdateConsolidationConversionInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { fillConsolidation, consolidationFromMaster } from './framework-facts-prefill';
import { isEngagementLead, readEngagementMasterFacts } from './master-facts';
import { AuditMattersService } from './audit-matters.service';
import { assessConsolidation } from './consolidation';
import {
  CONSOLIDATION_DECISIVE,
  consolidationCompletion,
  consolidationLegacyMirror,
  consolidationPartnerApprovalReason,
  consolidationSummary,
  isConsolidationDecided,
  perimeterFingerprint,
  priorYearChanges,
} from './consolidation-completion';
import { groupAuditStatusOn } from './consolidation-group-read';
import { consolidationCrossLinksOn } from './consolidation-read';
import { flagScheduleIiiReevaluationOn } from './schedule-iii-reevaluation';

const SUB = SUB_SECTION_KEY.consolidation;
const AREA = FRAMEWORK_AREA_KEY.cfs;
const TITLE = 'Consolidation / Group Audit Framework';
const A = CONSOLIDATION_PROFESSIONAL_ACTION;

const FR_SUB = SUB_SECTION_KEY.financialReporting;
const FR_AREA = FRAMEWORK_AREA_KEY.financialReportingFramework;

/** 02.2 states from which its conclusion is authoritative enough to route 02.6. */
const FR_DECIDED = new Set<string>(['applicable', 'overridden', 'approved']);

const DEFAULT_CAPTURED: ConsolidationCapturedFacts = {
  investees: [],
  isWhollyOwnedSubsidiary: false,
  isPartiallyOwnedSubsidiary: false,
  otherMembersIntimatedNoObjection: false,
  securitiesListedOrInProcess: false,
  parentFilesCompliantCfs: null,
  hasBranches: false,
};

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: ConsolidationDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: Partial<ConsolidationCapturedFacts> | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
  financial_year: string | null;
  entity_id: string;
  professional_action: ConsolidationProfessionalAction | null;
  pending_reason: string | null;
  partner_approved_by_name: string | null;
  partner_approved_at: Date | null;
  partner_note: string | null;
  engagement_partner_id: string | null;
}

const ROW_SQL = `
  SELECT s.id, s.workflow_instance_id, swi.engagement_service_id, s.engagement_id, s.state,
         s.system_outcome, s.system_basis, s.system_detail, s.rule_version_id,
         s.authority_provision_id, s.conclusion, s.is_overridden, s.basis, s.impact,
         s.facts, s.needs_reevaluation, emp.full_name AS decided_by_name, s.decided_at,
         s.version, e.financial_year, e.entity_id, s.professional_action, s.pending_reason,
         pemp.full_name AS partner_approved_by_name, s.partner_approved_at, s.partner_note,
         e.engagement_partner_id
    FROM hsdg.audit_framework_subassessment s
    JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
    JOIN hsdg.engagements e ON e.id = s.engagement_id
    LEFT JOIN hsdg.employees emp ON emp.id = s.decided_by_employee_id
    LEFT JOIN hsdg.employees pemp ON pemp.id = s.partner_approved_by_employee_id`;

interface ConversionRow {
  id: string;
  component_id: string;
  component_name: string;
  local_framework: LocalFramework | null;
  group_framework: LocalFramework | null;
  status: ConversionStatus;
  differences: ConversionDifference[];
  reviewer_employee_id: string | null;
  reviewer_name: string | null;
  reporting_package_document_id: string | null;
  reporting_package_name: string | null;
  adjusted_tb_document_id: string | null;
  adjusted_tb_name: string | null;
  reviewed_at: Date | null;
  version: number;
}

/**
 * 02.6 Consolidation & Group Audit Framework service — Track A (DHVAJ 02.6
 * spec v1.0 §3–§11, §21, §22, §24). Routes the consolidation standards from
 * the concluded 02.2 assessment; captures the relationship assessment (control
 * / significant influence / joint control, never the percentage alone), the
 * Rule 6 evidence and the perimeter; runs the pure engine against the Rules
 * Library in force for the audit period (CFS-01..CFS-04); records the CFS-05
 * conclusion (confirm / override with reason + technical basis + evidence /
 * information pending) with Engagement Partner approval of a significant
 * override or a control / perimeter dispute; keeps one CFS-04 conversion work
 * item per component whose framework differs (the component's statutory
 * accounts are never altered); and mirrors the legacy Section 02 "CFS" area so
 * every consumer reads one answer. Track B's group-audit status is read
 * DI-free (consolidation-group-read.ts). Reuses the shared sub-assessment
 * table (guide §6).
 */
@Injectable()
export class AuditConsolidationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
    private readonly matters: AuditMattersService,
  ) {}

  // ── Seed (idempotent, self-healing) ─────────────────────────────────────────

  async seedOn(
    client: PoolClient,
    workflowInstanceId: string,
    engagementId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.audit_framework_subassessment
         (workflow_instance_id, engagement_id, sub_section_key, area_key, title)
       SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::text
        WHERE hsdg.is_engagement_lead($2::uuid) -- lead-only insert (RLS); others read or 404
       ON CONFLICT (workflow_instance_id, sub_section_key, area_key) DO NOTHING`,
      [workflowInstanceId, engagementId, SUB, AREA, TITLE],
    );
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditConsolidation[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: shells } = await client.query<{ id: string }>(
        `SELECT swi.id
           FROM hsdg.service_workflow_instances swi
          WHERE swi.engagement_id = $1 AND swi.status <> 'cancelled'
            AND NOT EXISTS (
              SELECT 1 FROM hsdg.audit_framework_subassessment s
               WHERE s.workflow_instance_id = swi.id
                 AND s.sub_section_key = $2 AND s.area_key = $3)`,
        [engagementId, SUB, AREA],
      );
      for (const s of shells) await this.seedOn(client, s.id, engagementId);
      await this.prefillOn(client, ctx, engagementId);
      return this.read(client, engagementId, { viewerEmployeeId: ctx.employeeId ?? null });
    });
  }

  private async read(
    client: PoolClient,
    engagementId: string,
    opts: { workflowInstanceId?: string; viewerEmployeeId?: string | null } = {},
  ): Promise<StatutoryAuditConsolidation[]> {
    const { rows } = await client.query<SubRow>(
      `${ROW_SQL}
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
          AND ($4::uuid IS NULL OR s.workflow_instance_id = $4::uuid)
        ORDER BY swi.created_at ASC`,
      [engagementId, SUB, AREA, opts.workflowInstanceId ?? null],
    );
    const lead = rows.length > 0 && (await isEngagementLead(client, engagementId));

    const out: StatutoryAuditConsolidation[] = [];
    for (const r of rows) {
      const master = await readEngagementMasterFacts(client, r.workflow_instance_id);
      // Every component carries a stable id (other modules key off it).
      if (lead && r.facts && needsIds(r.facts.investees)) {
        r.facts = { ...r.facts, investees: withIds(r.facts.investees ?? [], [], true) };
        await client.query(
          `UPDATE hsdg.audit_framework_subassessment SET facts = $2::jsonb WHERE id = $1`,
          [r.id, JSON.stringify(r.facts)],
        );
      }
      const captured = mergeCaptured(r.facts);
      const { facts, upstreamReady } = await this.assembleFacts(
        client,
        r.workflow_instance_id,
        captured,
      );
      const live = await this.runEngine(client, engagementId, facts);

      const decided = isConsolidationDecided(r.state, r.conclusion);
      let assessment: FrameworkSubAssessment;
      let detail: ConsolidationDetail | null;
      if (decided) {
        // The frozen conclusion stays; a changed perimeter / framework / Rule 6
        // result is flagged for re-evaluation — the live suggestion shows beside it.
        const changed =
          perimeterFingerprint(r.system_outcome, r.system_detail) !==
          perimeterFingerprint(live.outcome, live.detail);
        if (changed && !r.needs_reevaluation && r.state !== 'approved' && lead) {
          await client.query(
            `UPDATE hsdg.audit_framework_subassessment SET needs_reevaluation = true WHERE id = $1`,
            [r.id],
          );
          r.needs_reevaluation = true;
        }
        assessment = r.needs_reevaluation
          ? {
              ...mapAssessment(r),
              systemOutcome: live.outcome,
              systemBasis: live.basis,
              systemDetail: live.detail,
            }
          : mapAssessment(r);
        detail = r.needs_reevaluation ? live.detail : r.system_detail;
      } else {
        assessment = {
          ...liveAssessment(r, live),
          state:
            r.professional_action === A.informationPending ? 'pending_information' : live.state,
        };
        detail = live.detail;
      }

      if (lead && r.state !== 'approved')
        await this.syncConversionsOn(client, r.engagement_id, r.workflow_instance_id, detail);
      const conversions = await this.readConversions(client, r.workflow_instance_id);
      const groupAudit = await groupAuditStatusOn(client, r.workflow_instance_id);
      const crossLinks = await consolidationCrossLinksOn(client, r.workflow_instance_id);

      const conclusion = decided ? (r.conclusion as ConsolidationOutcome | null) : null;
      const partnerReason = decided
        ? consolidationPartnerApprovalReason({
            conclusion,
            systemOutcome: (r.system_outcome as ConsolidationOutcome | null) ?? null,
            isOverridden: r.is_overridden,
            detail: r.system_detail,
          })
        : null;
      const completion = consolidationCompletion({
        detail,
        conclusion,
        decided,
        professionalAction: r.professional_action,
        partnerRequired: partnerReason != null,
        partnerApproved: r.partner_approved_at != null,
        needsReevaluation: r.needs_reevaluation,
        upstreamReady,
        provisionResolved: assessment.authorityProvisionId != null,
        started: r.professional_action != null || r.facts != null,
        isSubsidiary: facts.isWhollyOwnedSubsidiary || facts.isPartiallyOwnedSubsidiary,
        groupAudit,
        crossLinks,
        conversionsOpen: conversions.filter(
          (c) => c.status === CONVERSION_STATUS.open || c.status === CONVERSION_STATUS.inReview,
        ).length,
      });

      out.push({
        workflowInstanceId: r.workflow_instance_id,
        engagementServiceId: r.engagement_service_id,
        engagementId: r.engagement_id,
        assessment,
        detail,
        capturedFacts: captured,
        baseFacts: facts,
        upstreamReady,
        masterFacts: master ? consolidationFromMaster(master).facts : [],
        memoSuggested:
          r.is_overridden ||
          partnerReason != null ||
          r.professional_action === A.informationPending ||
          live.outcome === CONSOLIDATION_OUTCOME.furtherAssessment,
        professionalAction: r.professional_action,
        pendingReason: r.pending_reason,
        partnerApproval: {
          required: partnerReason != null,
          reason: partnerReason,
          approvedByName: r.partner_approved_by_name,
          approvedAt: r.partner_approved_at ? r.partner_approved_at.toISOString() : null,
          note: r.partner_note,
        },
        completion,
        summary: consolidationSummary(conclusion ?? live.outcome, detail, groupAudit),
        conversions,
        groupAudit,
        crossLinks,
        priorYear: await this.priorYear(client, r, live.outcome, live.detail),
        periodStart: facts.periodStart ?? undefined,
        approved: r.state === 'approved',
        viewerIsPartner:
          opts.viewerEmployeeId != null && opts.viewerEmployeeId === r.engagement_partner_id,
      });
    }
    return out;
  }

  private async readOne(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditConsolidation> {
    const [c] = await this.read(client, engagementId, {
      workflowInstanceId,
      viewerEmployeeId: ctx.employeeId ?? null,
    });
    if (!c) throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    return c;
  }

  // ── Capture the relationship assessment, perimeter and Rule 6 facts (§5–§11) ─

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetConsolidationFactsInput,
  ): Promise<StatutoryAuditConsolidation> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();
      const current = mergeCaptured(row.facts);
      const investees =
        input.investees !== undefined
          ? withIds(input.investees, current.investees)
          : current.investees;
      const ids = investees.map((i) => i.id!);
      if (new Set(ids).size !== ids.length)
        throw new BadRequestException('Two related entities share the same id.');
      const names = investees.map((i) => i.name.trim().toLowerCase());
      if (new Set(names).size !== names.length)
        throw new BadRequestException('Each related entity can be listed once.');
      const merged: ConsolidationCapturedFacts = {
        ...current,
        investees,
        isWhollyOwnedSubsidiary: input.isWhollyOwnedSubsidiary ?? current.isWhollyOwnedSubsidiary,
        isPartiallyOwnedSubsidiary:
          input.isPartiallyOwnedSubsidiary ?? current.isPartiallyOwnedSubsidiary,
        otherMembersIntimatedNoObjection:
          input.otherMembersIntimatedNoObjection ?? current.otherMembersIntimatedNoObjection,
        securitiesListedOrInProcess:
          input.securitiesListedOrInProcess ?? current.securitiesListedOrInProcess,
        parentFilesCompliantCfs:
          input.parentFilesCompliantCfs !== undefined
            ? input.parentFilesCompliantCfs
            : current.parentFilesCompliantCfs,
        hasBranches: input.hasBranches ?? current.hasBranches,
        rule6Evidence:
          input.rule6Evidence !== undefined
            ? { ...EMPTY_RULE6_EVIDENCE, ...current.rule6Evidence, ...input.rule6Evidence }
            : current.rule6Evidence,
      };
      if (merged.isWhollyOwnedSubsidiary && merged.isPartiallyOwnedSubsidiary)
        throw new BadRequestException(
          'The company is either a wholly-owned or a partially-owned subsidiary, not both.',
        );

      // A perimeter decision that differs from the system proposal needs its reason (spec §8).
      const { facts } = await this.assembleFacts(client, workflowInstanceId, merged);
      const res = await this.runEngine(client, engagementId, facts);
      const unexplained = res.detail.perimeter.filter((p) => {
        const inv = merged.investees.find((i) => i.id === p.id);
        return inv?.included && inv.included !== p.systemIncluded && !inv.inclusionReason?.trim();
      });
      if (unexplained.length)
        throw new BadRequestException(
          `Give the reason for changing the system's inclusion proposal: ${unexplained.map((p) => p.name).join(', ')}.`,
        );

      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1`,
        [row.id, JSON.stringify(merged)],
      );
      await this.persistSuggestion(client, engagementId, row.id, merged);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.consolidation_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        before: row.facts,
        after: merged,
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Fill from the client master + prior year (Guide §1 capture once, spec §21) ─

  /**
   * First open by a lead fills the never-touched 02.6 facts — the prior-year
   * perimeter (stable component ids, relationship conclusions) rolled forward
   * as System Suggested, plus the client master's current group structure —
   * and runs the engine, so the assessment starts answered. One-shot: only
   * rows whose facts were never stored. Public so the 02.9 summary and the
   * legacy Section 02 area can trigger it too.
   */
  async prefillOn(client: PoolClient, ctx: RlsContext, engagementId: string): Promise<void> {
    const { rows } = await client.query<{
      id: string;
      workflow_instance_id: string;
      state: FrameworkState;
      conclusion: string | null;
    }>(
      `SELECT s.id, s.workflow_instance_id, s.state, s.conclusion
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
          AND s.facts IS NULL AND swi.status <> 'cancelled'`,
      [engagementId, SUB, AREA],
    );
    const open = rows.filter((r) => !isConsolidationDecided(r.state, r.conclusion));
    if (open.length === 0 || !(await isEngagementLead(client, engagementId))) return;
    for (const r of open) {
      const master = await readEngagementMasterFacts(client, r.workflow_instance_id);
      const prior = await this.priorCaptured(client, r.workflow_instance_id);
      if (!master && !prior) continue;
      const fill = master ? consolidationFromMaster(master) : { values: {}, facts: [] };
      const base = prior ? rollForward(prior, fill.values.investees ?? []) : mergeCaptured(null);
      const { next, filled } = fillConsolidation(base, fill);
      next.investees = withIds(next.investees, []);
      if (prior) filled.unshift(`${prior.investees.length} component(s) rolled forward`);
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1 AND facts IS NULL`,
        [r.id, JSON.stringify(next)],
      );
      await this.persistSuggestion(client, engagementId, r.id, next);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.consolidation_prefilled',
        objectType: 'audit_framework_subassessment',
        objectId: r.id,
        after: { filled, automatic: true },
      });
    }
  }

  /**
   * "Fill from client master": fills blank facts (and switches on yes/no facts
   * the master shows) without overwriting anything the team entered.
   */
  async fillFromMaster(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditConsolidationMasterFillResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const master = await readEngagementMasterFacts(client, workflowInstanceId);
      if (!master) throw new NotFoundException('Statutory-audit workflow not found.');
      const { next, filled } = fillConsolidation(
        mergeCaptured(row.facts),
        consolidationFromMaster(master),
      );
      next.investees = withIds(next.investees, []);
      if (filled.length > 0 || row.facts == null) {
        await client.query(
          `UPDATE hsdg.audit_framework_subassessment
              SET facts = $2::jsonb, version = version + 1
            WHERE id = $1`,
          [row.id, JSON.stringify(next)],
        );
        await this.persistSuggestion(client, engagementId, row.id, next);
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.consolidation_prefilled',
          objectType: 'audit_framework_subassessment',
          objectId: row.id,
          after: { filled },
        });
        await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      }
      const consolidation = await this.readOne(client, ctx, engagementId, workflowInstanceId);
      return { consolidation, filled };
    });
  }

  // ── Run the suggestion engine ───────────────────────────────────────────────

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditConsolidation> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      await this.persistSuggestion(client, engagementId, row.id, mergeCaptured(row.facts));
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.consolidation_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── CFS-05 professional conclusion (spec §22) ──────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordConsolidationDecisionInput,
  ): Promise<StatutoryAuditConsolidation> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.recordDecisionOn(client, ctx, engagementId, workflowInstanceId, input);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  /**
   * CFS-05 inside the caller's transaction (the legacy Section 02 decision
   * routes here so both records always agree). Stores the system result and
   * the professional conclusion separately, freezes the detail (perimeter, rule
   * versions), mirrors the Section 02 area and flags 02.3's CFS presentation.
   */
  async recordDecisionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordConsolidationDecisionInput,
  ): Promise<void> {
    const row = await this.loadRow(client, engagementId, workflowInstanceId);
    this.assertNotApproved(row);
    if (row.version !== input.version) throw stale();

    const captured = mergeCaptured(row.facts);
    const { facts } = await this.assembleFacts(client, workflowInstanceId, captured);
    const res = await this.runEngine(client, engagementId, facts);

    const action: ConsolidationProfessionalAction =
      input.action ??
      (input.conclusion && input.conclusion !== res.outcome ? A.override : A.confirm);

    if (action === A.informationPending) {
      const reason = input.pendingReason?.trim();
      const blocking = (res.detail.missingFacts ?? [])
        .filter((m) => m.blocking)
        .map((m) => m.label);
      if (!reason && blocking.length === 0)
        throw new BadRequestException(
          'Information Pending must identify the blocking fact(s) — say which information is pending.',
        );
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET conclusion = NULL, is_overridden = false, basis = NULL, impact = $2,
                state = 'pending_information', professional_action = 'information_pending',
                pending_reason = $3, system_outcome = $4, system_basis = $5,
                system_detail = $6::jsonb, rule_version_id = $7, authority_provision_id = $8,
                decided_by_employee_id = $9, decided_at = now(),
                partner_approved_by_employee_id = NULL, partner_approved_at = NULL,
                partner_note = NULL, needs_reevaluation = false, version = version + 1
          WHERE id = $1`,
        [
          row.id,
          input.impact?.trim() || null,
          reason || `Blocked on: ${blocking.join('; ')}`,
          res.outcome,
          res.basis,
          JSON.stringify(res.detail),
          res.ruleVersionId,
          res.authorityProvisionId,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.consolidation_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { action, pendingReason: reason ?? null, blockingFacts: blocking },
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return;
    }

    let conclusion: ConsolidationOutcome;
    if (action === A.confirm) {
      if (!CONSOLIDATION_DECISIVE.has(res.outcome))
        throw new BadRequestException(
          'The system could not determine whether CFS is required — override with a conclusion, reason, technical basis and supporting evidence, or mark Information Pending.',
        );
      if (input.conclusion && input.conclusion !== res.outcome)
        throw new BadRequestException(
          'Confirm takes the system assessment; use Override to change it.',
        );
      conclusion = res.outcome;
    } else {
      if (!input.conclusion || !CONSOLIDATION_CONCLUSIONS.includes(input.conclusion))
        throw new BadRequestException(
          'Select the final conclusion: CFS Required, CFS Exempt (Rule 6), Not Applicable or Further Assessment Required.',
        );
      conclusion = input.conclusion;
      if (CONSOLIDATION_DECISIVE.has(res.outcome) && conclusion === res.outcome)
        throw new BadRequestException('The override matches the system assessment — use Confirm.');
    }
    const isOverridden = CONSOLIDATION_DECISIVE.has(res.outcome) && conclusion !== res.outcome;
    const basis = input.basis?.trim() || null;
    const technicalBasis = input.technicalBasis?.trim() || null;
    const supportingEvidence = input.supportingEvidence?.trim() || null;
    if (action === A.override) {
      if (!basis || !technicalBasis)
        throw new BadRequestException(
          'An override needs the final conclusion, a mandatory reason and the technical basis.',
        );
      if (!supportingEvidence && !(await this.hasEvidenceFile(client, row.id)))
        throw new BadRequestException(
          'An override needs supporting evidence — describe it or link a file to 02.6.',
        );
    }
    const state: FrameworkState = isOverridden ? 'overridden' : decisiveState(conclusion);

    await client.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET conclusion = $2, is_overridden = $3, basis = $4, impact = $5, state = $6,
              system_outcome = $7, system_basis = $8, system_detail = $9::jsonb,
              rule_version_id = $10, authority_provision_id = $11,
              decided_by_employee_id = $12, decided_at = now(),
              professional_action = $13, pending_reason = NULL,
              partner_approved_by_employee_id = NULL, partner_approved_at = NULL,
              partner_note = NULL, needs_reevaluation = false,
              facts = $14::jsonb, version = version + 1
        WHERE id = $1`,
      [
        row.id,
        conclusion,
        isOverridden,
        basis,
        input.impact?.trim() || null,
        state,
        res.outcome,
        res.basis,
        JSON.stringify(res.detail),
        res.ruleVersionId,
        res.authorityProvisionId,
        ctx.employeeId ?? null,
        action === A.override || isOverridden ? A.override : A.confirm,
        JSON.stringify({ ...captured, technicalBasis, supportingEvidence }),
      ],
    );
    // The consolidated-presentation flag and CFS disclosures in 02.3.
    await flagScheduleIiiReevaluationOn(client, workflowInstanceId, {
      factKey: 'cfs_required',
      newValue:
        conclusion === CONSOLIDATION_OUTCOME.cfsRequired
          ? 'Yes'
          : conclusion === CONSOLIDATION_OUTCOME.cfsExempt ||
              conclusion === CONSOLIDATION_OUTCOME.notApplicable
            ? 'No'
            : 'Not known',
    });
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.consolidation_decision',
      objectType: 'audit_framework_subassessment',
      objectId: row.id,
      before: { systemOutcome: res.outcome, conclusion: row.conclusion },
      after: { action, conclusion, isOverridden, basis, technicalBasis, supportingEvidence },
    });
    await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
  }

  // ── CFS-05 Engagement Partner approval ─────────────────────────────────────

  async partnerApprove(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: PartnerApproveConsolidationInput,
  ): Promise<StatutoryAuditConsolidation> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();
      if (!ctx.employeeId || ctx.employeeId !== row.engagement_partner_id)
        throw new ForbiddenException('Only the Engagement Partner can approve this conclusion.');
      const live = await this.readOne(client, ctx, engagementId, workflowInstanceId);
      if (!isConsolidationDecided(live.assessment.state, live.assessment.conclusion))
        throw new BadRequestException('Record the Manager conclusion before Partner approval.');
      if (!live.partnerApproval?.required)
        throw new BadRequestException('This conclusion does not need Partner approval.');
      if (live.partnerApproval.approvedAt)
        throw new BadRequestException(
          'The Engagement Partner has already approved this conclusion.',
        );
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET partner_approved_by_employee_id = $2, partner_approved_at = now(),
                partner_note = $3, version = version + 1
          WHERE id = $1`,
        [row.id, ctx.employeeId, input.note?.trim() || null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.consolidation_partner_approved',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { reason: live.partnerApproval.reason, note: input.note ?? null },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── CFS-04 conversion work items (spec §11) ────────────────────────────────

  async updateConversion(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    conversionId: string,
    input: UpdateConsolidationConversionInput,
  ): Promise<StatutoryAuditConsolidation> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const { rows } = await client.query<{
        id: string;
        status: ConversionStatus;
        version: number;
        reviewer_employee_id: string | null;
        adjusted_tb_document_id: string | null;
      }>(
        `SELECT id, status, version, reviewer_employee_id, adjusted_tb_document_id
           FROM hsdg.audit_consolidation_conversion
          WHERE id = $1 AND workflow_instance_id = $2`,
        [conversionId, workflowInstanceId],
      );
      const cur = rows[0];
      if (!cur) throw new NotFoundException('Conversion work item not found.');
      if (cur.version !== input.version) throw stale();
      if (cur.status === CONVERSION_STATUS.withdrawn)
        throw new BadRequestException(
          'This component no longer needs a conversion — the work item is withdrawn.',
        );
      if (input.status === CONVERSION_STATUS.withdrawn)
        throw new BadRequestException(
          'A conversion is withdrawn only when its component leaves the perimeter or aligns.',
        );
      for (const docId of [input.reportingPackageDocumentId, input.adjustedTbDocumentId])
        if (docId) await this.assertDocument(client, engagementId, docId);
      if (input.reviewerEmployeeId)
        await this.assertMember(client, engagementId, input.reviewerEmployeeId);
      const reviewer =
        input.reviewerEmployeeId !== undefined
          ? input.reviewerEmployeeId
          : cur.reviewer_employee_id;
      const tb =
        input.adjustedTbDocumentId !== undefined
          ? input.adjustedTbDocumentId
          : cur.adjusted_tb_document_id;
      // The effective status: clearing the reviewer / TB of a completed item is refused too.
      if ((input.status ?? cur.status) === CONVERSION_STATUS.completed && (!reviewer || !tb))
        throw new BadRequestException(
          'A completed conversion names its reviewer and links the final adjusted group TB.',
        );
      const differences =
        input.differences?.map((d) => ({
          area: d.area.trim(),
          description: d.description.trim(),
          adjustmentReference: d.adjustmentReference?.trim() || null,
          amount: d.amount ?? null,
        })) ?? null;
      if (differences?.some((d) => !d.area || !d.description))
        throw new BadRequestException(
          'Each GAAP / policy difference needs an area and a description.',
        );
      await client.query(
        `UPDATE hsdg.audit_consolidation_conversion
            SET status = COALESCE($2, status),
                differences = COALESCE($3::jsonb, differences),
                reviewer_employee_id = $4,
                reporting_package_document_id = CASE WHEN $5::boolean THEN $6::uuid
                                                     ELSE reporting_package_document_id END,
                adjusted_tb_document_id = $7,
                reviewed_at = CASE WHEN COALESCE($2, status) = 'completed'
                                   THEN COALESCE(reviewed_at, now()) ELSE NULL END,
                version = version + 1
          WHERE id = $1`,
        [
          conversionId,
          input.status ?? null,
          differences ? JSON.stringify(differences) : null,
          reviewer,
          input.reportingPackageDocumentId !== undefined,
          input.reportingPackageDocumentId ?? null,
          tb,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.consolidation_conversion_updated',
        objectType: 'audit_consolidation_conversion',
        objectId: conversionId,
        after: input,
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  /**
   * One conversion item per included component whose framework / policies
   * need conversion (CFS-04 "Conversion Required"); an item whose component
   * aligned or left the perimeter is withdrawn, never deleted. Lead-only (RLS).
   */
  private async syncConversionsOn(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    detail: ConsolidationDetail | null,
  ): Promise<void> {
    const need = (detail?.perimeter ?? []).filter(
      (p) =>
        p.included !== PERIMETER_INCLUSION.no &&
        p.policy?.result === POLICY_ALIGNMENT.conversionRequired,
    );
    for (const p of need) {
      await client.query(
        `INSERT INTO hsdg.audit_consolidation_conversion
           (workflow_instance_id, engagement_id, component_id, component_name,
            local_framework, group_framework)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workflow_instance_id, component_id) DO UPDATE
            SET component_name = EXCLUDED.component_name,
                local_framework = EXCLUDED.local_framework,
                group_framework = EXCLUDED.group_framework,
                status = CASE WHEN audit_consolidation_conversion.status = 'withdrawn'
                              THEN 'open' ELSE audit_consolidation_conversion.status END,
                withdrawn_at = NULL,
                version = audit_consolidation_conversion.version + 1
          WHERE audit_consolidation_conversion.status = 'withdrawn'
             OR audit_consolidation_conversion.component_name IS DISTINCT FROM EXCLUDED.component_name
             OR audit_consolidation_conversion.local_framework IS DISTINCT FROM EXCLUDED.local_framework
             OR audit_consolidation_conversion.group_framework IS DISTINCT FROM EXCLUDED.group_framework`,
        [
          workflowInstanceId,
          engagementId,
          p.id,
          p.name,
          p.policy?.localFramework ?? null,
          p.policy?.groupFramework ?? null,
        ],
      );
    }
    await client.query(
      `UPDATE hsdg.audit_consolidation_conversion
          SET status = 'withdrawn', withdrawn_at = now(), version = version + 1
        WHERE workflow_instance_id = $1 AND status <> 'withdrawn'
          AND NOT (component_id = ANY($2::text[]))`,
      [workflowInstanceId, need.map((p) => p.id)],
    );
  }

  private async readConversions(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<ConsolidationConversion[]> {
    const { rows } = await client.query<ConversionRow>(
      `SELECT c.id, c.component_id, c.component_name, c.local_framework, c.group_framework,
              c.status, c.differences, c.reviewer_employee_id, rv.full_name AS reviewer_name,
              c.reporting_package_document_id, rp.title AS reporting_package_name,
              c.adjusted_tb_document_id, tb.title AS adjusted_tb_name, c.reviewed_at, c.version
         FROM hsdg.audit_consolidation_conversion c
         LEFT JOIN hsdg.employees rv ON rv.id = c.reviewer_employee_id
         LEFT JOIN hsdg.documents rp ON rp.id = c.reporting_package_document_id AND rp.deleted_at IS NULL
         LEFT JOIN hsdg.documents tb ON tb.id = c.adjusted_tb_document_id AND tb.deleted_at IS NULL
        WHERE c.workflow_instance_id = $1
        ORDER BY (c.status = 'withdrawn'), c.component_name`,
      [workflowInstanceId],
    );
    return rows.map((c) => ({
      id: c.id,
      componentId: c.component_id,
      componentName: c.component_name,
      localFramework: c.local_framework,
      groupFramework: c.group_framework,
      status: c.status,
      differences: c.differences ?? [],
      reviewerEmployeeId: c.reviewer_employee_id,
      reviewerName: c.reviewer_name,
      reportingPackageDocumentId: c.reporting_package_document_id,
      reportingPackageName: c.reporting_package_name,
      adjustedTbDocumentId: c.adjusted_tb_document_id,
      adjustedTbName: c.adjusted_tb_name,
      reviewedAt: c.reviewed_at ? c.reviewed_at.toISOString() : null,
      version: c.version,
    }));
  }

  // ── Legacy Section 02 "CFS" mirror ─────────────────────────────────────────

  /**
   * The Section 02 "CFS" area's suggestion, taken from the 02.6 engine (the
   * old "has subsidiaries → CFS required" branch in framework-suggestions.ts
   * ignored Rule 6 and the relationship judgments). Seeds / prefills 02.6
   * first so the area never shows a different answer.
   */
  async legacySuggestionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ suggestion: FrameworkConclusion | null; basis: string; state: FrameworkState }> {
    await this.seedOn(client, workflowInstanceId, engagementId);
    await this.prefillOn(client, ctx, engagementId);
    const { rows } = await client.query<{ facts: Partial<ConsolidationCapturedFacts> | null }>(
      `SELECT facts FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB, AREA],
    );
    const { facts } = await this.assembleFacts(
      client,
      workflowInstanceId,
      mergeCaptured(rows[0]?.facts ?? null),
    );
    const res = await this.runEngine(client, engagementId, facts);
    const m = consolidationLegacyMirror(res.outcome, null, false);
    return { suggestion: m.suggestion, basis: `02.6 Consolidation: ${res.basis}`, state: m.state };
  }

  /**
   * Bulk "Accept suggestions" on the Section 02 list: confirm a decisive 02.6
   * system assessment (the same as CFS-05 Confirm). Returns whether it decided.
   */
  async acceptSuggestionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<boolean> {
    const row = await this.loadRow(client, engagementId, workflowInstanceId);
    if (isConsolidationDecided(row.state, row.conclusion) || row.state === 'approved') return false;
    const { facts } = await this.assembleFacts(
      client,
      workflowInstanceId,
      mergeCaptured(row.facts),
    );
    const res = await this.runEngine(client, engagementId, facts);
    if (!CONSOLIDATION_DECISIVE.has(res.outcome)) return false;
    await this.recordDecisionOn(client, ctx, engagementId, workflowInstanceId, {
      action: A.confirm,
      version: row.version,
    });
    return true;
  }

  /**
   * A Section 02 list decision on the CFS area (kept for API compatibility):
   * recorded as the CFS-05 conclusion so the two never differ. "Not
   * applicable" maps to CFS Exempt when §129(3) triggers, else Not Applicable.
   * A differing conclusion is an override carrying the list's basis as its
   * reason, technical basis and evidence note — the 02.6 workspace is the full
   * path.
   */
  async decideFromFrameworkOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { conclusion: FrameworkConclusion; basis?: string | null; impact?: string | null },
  ): Promise<void> {
    const row = await this.loadRow(client, engagementId, workflowInstanceId);
    const { facts } = await this.assembleFacts(
      client,
      workflowInstanceId,
      mergeCaptured(row.facts),
    );
    const res = await this.runEngine(client, engagementId, facts);
    const conclusion: ConsolidationOutcome =
      input.conclusion === 'applicable'
        ? CONSOLIDATION_OUTCOME.cfsRequired
        : res.outcome === CONSOLIDATION_OUTCOME.cfsExempt || res.detail.cfsTriggered
          ? CONSOLIDATION_OUTCOME.cfsExempt
          : CONSOLIDATION_OUTCOME.notApplicable;
    const basis = input.basis?.trim() || null;
    if (res.outcome === conclusion) {
      await this.recordDecisionOn(client, ctx, engagementId, workflowInstanceId, {
        action: A.confirm,
        impact: input.impact,
        version: row.version,
      });
      return;
    }
    if (!basis)
      throw new BadRequestException(
        'A basis is required when the conclusion overrides the system suggestion.',
      );
    await this.recordDecisionOn(client, ctx, engagementId, workflowInstanceId, {
      action: A.override,
      conclusion,
      basis,
      technicalBasis: basis,
      supportingEvidence: `Recorded on the Section 02 framework list: ${basis}`,
      impact: input.impact,
      version: row.version,
    });
  }

  /** Write the 02.6 state onto the Section 02 "CFS" area (never an approved one). */
  private async syncLegacyOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query<{
      state: FrameworkState;
      conclusion: string | null;
      is_overridden: boolean;
      basis: string | null;
      impact: string | null;
      system_outcome: string | null;
      system_basis: string | null;
      decided_by_employee_id: string | null;
    }>(
      `SELECT state, conclusion, is_overridden, basis, impact, system_outcome, system_basis,
              decided_by_employee_id
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB, AREA],
    );
    const s = rows[0];
    if (!s) return;
    const decided = isConsolidationDecided(s.state, s.conclusion);
    const m = consolidationLegacyMirror(
      (s.system_outcome as ConsolidationOutcome | null) ??
        CONSOLIDATION_OUTCOME.informationInsufficient,
      decided ? (s.conclusion as ConsolidationOutcome | null) : null,
      s.is_overridden,
      s.state === 'pending_information',
    );
    const { rowCount } = await client.query(
      `UPDATE hsdg.audit_framework_assessments
          SET system_suggestion = $2, system_basis = $3, state = $4, conclusion = $5,
              is_overridden = $6, basis = $7, impact = $8,
              decided_by_employee_id = CASE WHEN $5::text IS NULL THEN NULL ELSE $9::uuid END,
              decided_at = CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,
              version = version + 1
        WHERE workflow_instance_id = $1 AND area_key = 'cfs' AND state <> 'approved'
          AND (system_suggestion IS DISTINCT FROM $2 OR system_basis IS DISTINCT FROM $3
               OR state IS DISTINCT FROM $4 OR conclusion IS DISTINCT FROM $5
               OR is_overridden IS DISTINCT FROM $6 OR basis IS DISTINCT FROM $7
               OR impact IS DISTINCT FROM $8)`,
      [
        workflowInstanceId,
        m.suggestion,
        s.system_basis ? `02.6 Consolidation: ${s.system_basis}` : null,
        m.state,
        m.conclusion,
        m.conclusion != null && s.is_overridden,
        decided ? s.basis : null,
        decided ? s.impact : null,
        s.decided_by_employee_id,
      ],
    );
    if ((rowCount ?? 0) > 0)
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /**
   * Run the pure engine (rules resolved by audit period START) and freeze the
   * period-correct §129(3) provision onto a decisive result.
   */
  private async runEngine(
    client: PoolClient,
    engagementId: string,
    facts: ConsolidationFacts,
  ): Promise<ConsolidationResult> {
    const start = facts.periodStart ?? (await this.auditPeriod(client, engagementId)).start;
    const resolve = await this.rules.buildResolverOn(client, start);
    const res = assessConsolidation(facts, resolve);
    if (CONSOLIDATION_DECISIVE.has(res.outcome)) {
      const prov = await this.rules.resolveProvisionOn(
        client,
        CONSOLIDATION_PROVISION_CODE.section129_3,
        start,
      );
      res.authorityProvisionId = prov?.id ?? null;
    }
    return res;
  }

  /**
   * Persist the engine result for the captured facts. Undecided: the live
   * suggestion. Decided: the conclusion stays frozen — if the conclusion-
   * relevant perimeter (fingerprint) is unchanged, the stored detail is
   * refreshed so CFS-03 / CFS-04 work (reporting dates, local GAAP,
   * conversions) follows the facts; otherwise the row needs re-evaluation.
   */
  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    captured: ConsolidationCapturedFacts,
  ): Promise<void> {
    const { rows } = await client.query<{
      state: FrameworkState;
      workflow_instance_id: string;
      conclusion: string | null;
      system_outcome: string | null;
      system_detail: ConsolidationDetail | null;
    }>(
      `SELECT state, workflow_instance_id, conclusion, system_outcome, system_detail
         FROM hsdg.audit_framework_subassessment WHERE id = $1`,
      [rowId],
    );
    const row = rows[0];
    if (!row || row.state === 'approved') return;
    const { facts } = await this.assembleFacts(client, row.workflow_instance_id, captured);
    const res = await this.runEngine(client, engagementId, facts);
    if (isConsolidationDecided(row.state, row.conclusion)) {
      if (
        perimeterFingerprint(row.system_outcome, row.system_detail) ===
        perimeterFingerprint(res.outcome, res.detail)
      )
        await client.query(
          `UPDATE hsdg.audit_framework_subassessment SET system_detail = $2::jsonb WHERE id = $1`,
          [rowId, JSON.stringify(res.detail)],
        );
      else
        await client.query(
          `UPDATE hsdg.audit_framework_subassessment SET needs_reevaluation = true WHERE id = $1`,
          [rowId],
        );
      return;
    }
    await client.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET system_outcome = $2, system_basis = $3, system_detail = $4::jsonb,
              rule_version_id = $5, authority_provision_id = $6,
              state = CASE WHEN professional_action = 'information_pending'
                           THEN 'pending_information' ELSE $7 END
        WHERE id = $1`,
      [
        rowId,
        res.outcome,
        res.basis,
        JSON.stringify(res.detail),
        res.ruleVersionId,
        res.authorityProvisionId,
        res.state,
      ],
    );
  }

  private async loadRow(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<SubRow> {
    await this.seedOn(client, workflowInstanceId, engagementId);
    const { rows } = await client.query<SubRow>(
      `${ROW_SQL}
        WHERE s.workflow_instance_id = $1 AND s.engagement_id = $2
          AND s.sub_section_key = $3 AND s.area_key = $4`,
      [workflowInstanceId, engagementId, SUB, AREA],
    );
    if (!rows[0]) {
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    }
    return rows[0];
  }

  private assertNotApproved(row: SubRow): void {
    if (row.state === 'approved' && !row.needs_reevaluation) {
      throw new ConflictException(
        'The framework is approved; a controlled reassessment must reopen it before editing 02.6.',
      );
    }
  }

  /** Assemble the base facts: the 02.2 conclusion, the audit period and the captured 02.6 facts. */
  private async assembleFacts(
    client: PoolClient,
    workflowInstanceId: string,
    captured: ConsolidationCapturedFacts,
  ): Promise<{ facts: ConsolidationFacts; upstreamReady: boolean }> {
    const { rows } = await client.query<{
      fr_state: string | null;
      fr_conclusion: string | null;
      profile_state: string | null;
      financial_year: string | null;
    }>(
      `SELECT fr.state AS fr_state, fr.conclusion AS fr_conclusion, p.state AS profile_state,
              e.financial_year
         FROM hsdg.service_workflow_instances swi
         JOIN hsdg.engagements e ON e.id = swi.engagement_id
         LEFT JOIN hsdg.audit_framework_subassessment fr
           ON fr.workflow_instance_id = swi.id AND fr.sub_section_key = $2 AND fr.area_key = $3
         LEFT JOIN hsdg.audit_entity_profile p ON p.workflow_instance_id = swi.id
        WHERE swi.id = $1`,
      [workflowInstanceId, FR_SUB, FR_AREA],
    );
    const r = rows[0];
    const reportingFramework =
      r?.fr_state && FR_DECIDED.has(r.fr_state) && r.fr_conclusion
        ? (r.fr_conclusion as ReportingFrameworkOutcome)
        : null;
    const period = periodOf(r?.financial_year ?? null);
    return {
      facts: {
        reportingFramework,
        investees: captured.investees,
        isWhollyOwnedSubsidiary: captured.isWhollyOwnedSubsidiary,
        isPartiallyOwnedSubsidiary: captured.isPartiallyOwnedSubsidiary,
        otherMembersIntimatedNoObjection: captured.otherMembersIntimatedNoObjection,
        securitiesListedOrInProcess: captured.securitiesListedOrInProcess,
        parentFilesCompliantCfs: captured.parentFilesCompliantCfs,
        hasBranches: captured.hasBranches,
        rule6Evidence: captured.rule6Evidence,
        periodStart: period.start,
        periodEnd: period.end,
      },
      upstreamReady: r?.profile_state === 'confirmed' && reportingFramework != null,
    };
  }

  private async auditPeriod(
    client: PoolClient,
    engagementId: string,
  ): Promise<{ start: string; end: string }> {
    const fy = await client.query<{ financial_year: string }>(
      `SELECT financial_year FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    return periodOf(fy.rows[0]?.financial_year ?? null);
  }

  /** A file linked to 02.6 (the shared Section 02 evidence table) counts as supporting evidence. */
  private async hasEvidenceFile(client: PoolClient, subassessmentId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM hsdg.audit_framework_files
        WHERE subassessment_id = $1 AND removed_at IS NULL LIMIT 1`,
      [subassessmentId],
    );
    return (rowCount ?? 0) > 0;
  }

  private async assertDocument(
    client: PoolClient,
    engagementId: string,
    documentId: string,
  ): Promise<void> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
      [documentId, engagementId],
    );
    if (!rowCount) throw new BadRequestException('Link a document held on this engagement.');
  }

  private async assertMember(
    client: PoolClient,
    engagementId: string,
    employeeId: string,
  ): Promise<void> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM hsdg.engagement_team WHERE engagement_id = $1 AND employee_id = $2
       UNION ALL
       SELECT 1 FROM hsdg.engagements
        WHERE id = $1 AND $2::uuid IN (engagement_partner_id, engagement_manager_id)`,
      [engagementId, employeeId],
    );
    if (!rowCount) throw new BadRequestException('The reviewer must be on the engagement team.');
  }

  /** The prior-year captured 02.6 facts for the entity (roll-forward source). */
  private async priorCaptured(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<ConsolidationCapturedFacts | null> {
    const { rows } = await client.query<{ facts: Partial<ConsolidationCapturedFacts> | null }>(
      `SELECT ps.facts
         FROM hsdg.service_workflow_instances swi
         JOIN hsdg.engagements e ON e.id = swi.engagement_id
         JOIN hsdg.engagements pe ON pe.entity_id = e.entity_id AND pe.financial_year < e.financial_year
         JOIN hsdg.audit_framework_subassessment ps
           ON ps.engagement_id = pe.id AND ps.sub_section_key = $2 AND ps.area_key = $3
         JOIN hsdg.service_workflow_instances pswi
           ON pswi.id = ps.workflow_instance_id AND pswi.status <> 'cancelled'
        WHERE swi.id = $1 AND ps.facts IS NOT NULL
        ORDER BY pe.financial_year DESC, ps.updated_at DESC
        LIMIT 1`,
      [workflowInstanceId, SUB, AREA],
    );
    return rows[0]?.facts ? mergeCaptured(rows[0].facts) : null;
  }

  /** Prior-year 02.6 with the roll-forward change indicators (spec §21) — context only. */
  private async priorYear(
    client: PoolClient,
    r: SubRow,
    currentOutcome: ConsolidationOutcome,
    current: ConsolidationDetail,
  ): Promise<ConsolidationPriorYear | null> {
    if (!r.financial_year) return null;
    const { rows } = await client.query<{
      financial_year: string;
      conclusion: string | null;
      system_outcome: string | null;
      system_basis: string | null;
      basis: string | null;
      system_detail: ConsolidationDetail | null;
    }>(
      `SELECT e.financial_year, s.conclusion, s.system_outcome, s.system_basis, s.basis,
              s.system_detail
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
         JOIN hsdg.engagements e ON e.id = s.engagement_id
        WHERE e.entity_id = $1 AND e.financial_year < $2 AND s.workflow_instance_id <> $3
          AND s.sub_section_key = $4 AND s.area_key = $5 AND swi.status <> 'cancelled'
        ORDER BY e.financial_year DESC, s.updated_at DESC
        LIMIT 1`,
      [r.entity_id, r.financial_year, r.workflow_instance_id, SUB, AREA],
    );
    const p = rows[0];
    if (!p) return null;
    const outcome = (p.conclusion ?? p.system_outcome) as ConsolidationOutcome | null;
    return {
      financialYear: p.financial_year,
      outcome,
      basis: p.basis ?? p.system_basis,
      components: (p.system_detail?.perimeter ?? []).filter(
        (x) => x.included === PERIMETER_INCLUSION.yes,
      ).length,
      changes: priorYearChanges(
        { outcome, detail: p.system_detail },
        { outcome: currentOutcome, detail: current },
      ),
    };
  }
}

function stale(): ConflictException {
  return new ConflictException('This assessment changed since you loaded it; refresh and retry.');
}

function periodOf(financialYear: string | null): { start: string; end: string } {
  const start = financialYear
    ? auditPeriodStartFromFinancialYear(financialYear)
    : new Date().toISOString().slice(0, 10);
  return { start, end: `${Number(start.slice(0, 4)) + 1}-03-31` };
}

function mergeCaptured(
  facts: Partial<ConsolidationCapturedFacts> | null,
): ConsolidationCapturedFacts {
  return {
    ...DEFAULT_CAPTURED,
    ...(facts ?? {}),
    investees: facts?.investees ?? DEFAULT_CAPTURED.investees,
  };
}

function needsIds(investees: InvesteeInput[] | undefined): boolean {
  return (investees ?? []).some((i) => !i.id);
}

/**
 * Give every investee a stable id: kept when supplied, else matched by name to
 * the current list, else a new uuid. `legacy` keys records captured before ids
 * existed by the `name:` id the engine already derived for them, so links
 * other modules made to those components keep resolving.
 */
function withIds(
  investees: InvesteeInput[],
  current: InvesteeInput[],
  legacy = false,
): InvesteeInput[] {
  const byName = new Map(
    current.filter((c) => c.id).map((c) => [c.name.trim().toLowerCase(), c.id!]),
  );
  return investees.map((i) => {
    if (i.id) return i;
    const key = i.name.trim().toLowerCase();
    return { ...i, id: byName.get(key) ?? (legacy ? `name:${key}` : randomUUID()) };
  });
}

/** Next year's start date for a carried component reporting date (same day/month). */
function nextYear(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
}

/**
 * Roll the prior-year perimeter forward as System Suggested (spec §21): keep
 * each component's id, relationship conclusions and frameworks; take the
 * master's current ownership; clear the period-specific evidence (inclusion
 * decisions, reporting-date reasons, Rule 6 filing proof); and add master
 * components that are new this year.
 */
function rollForward(
  prior: ConsolidationCapturedFacts,
  masterInvestees: InvesteeInput[],
): ConsolidationCapturedFacts {
  const master = new Map(masterInvestees.map((m) => [m.name.trim().toLowerCase(), m]));
  const carried = prior.investees.map((i): InvesteeInput => {
    const m = master.get(i.name.trim().toLowerCase());
    return {
      ...i,
      ownershipPercent: m?.ownershipPercent ?? i.ownershipPercent,
      included: null,
      inclusionReason: null,
      reportingDate: nextYear(i.reportingDate),
      reportingDateReason: null,
      interimInformation: null,
      interveningTransactions: null,
    };
  });
  const known = new Set(carried.map((i) => i.name.trim().toLowerCase()));
  const added = masterInvestees.filter((m) => !known.has(m.name.trim().toLowerCase()));
  return {
    ...prior,
    investees: [...carried, ...added],
    otherMembersIntimatedNoObjection: false,
    parentFilesCompliantCfs: null,
    rule6Evidence: undefined,
    technicalBasis: null,
    supportingEvidence: null,
  };
}

/** Map a decisive consolidation conclusion to the stored framework state. */
function decisiveState(conclusion: ConsolidationOutcome): FrameworkState {
  if (
    conclusion === CONSOLIDATION_OUTCOME.cfsExempt ||
    conclusion === CONSOLIDATION_OUTCOME.notApplicable
  )
    return 'not_applicable';
  if (conclusion === CONSOLIDATION_OUTCOME.furtherAssessment)
    return 'professional_judgement_required';
  return 'applicable';
}

function mapAssessment(r: SubRow): FrameworkSubAssessment {
  return {
    id: r.id,
    subSectionKey: SUB,
    areaKey: AREA,
    title: TITLE,
    state: r.state,
    systemOutcome: r.system_outcome,
    systemBasis: r.system_basis,
    systemDetail: r.system_detail,
    ruleVersionId: r.rule_version_id,
    authorityProvisionId: r.authority_provision_id,
    conclusion: r.conclusion,
    isOverridden: r.is_overridden,
    basis: r.basis,
    impact: r.impact,
    facts: r.facts,
    needsReevaluation: r.needs_reevaluation,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    version: r.version,
  };
}

function liveAssessment(r: SubRow, res: ConsolidationResult): FrameworkSubAssessment {
  return {
    id: r.id,
    subSectionKey: SUB,
    areaKey: AREA,
    title: TITLE,
    state: res.state,
    systemOutcome: res.outcome,
    systemBasis: res.basis,
    systemDetail: res.detail,
    ruleVersionId: res.ruleVersionId,
    authorityProvisionId: res.authorityProvisionId,
    conclusion: null,
    isOverridden: false,
    basis: null,
    impact: null,
    facts: r.facts,
    needsReevaluation: r.needs_reevaluation,
    decidedByName: null,
    decidedAt: null,
    version: r.version,
  };
}

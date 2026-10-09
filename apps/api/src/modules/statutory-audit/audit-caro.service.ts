import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CARO_BORROWING_DATA_BASES,
  CARO_CONCLUSIONS,
  CARO_CONTEXT_STATUS,
  CARO_OUTCOME,
  CARO_PROFESSIONAL_ACTION,
  CARO_PROVISION_CODE,
  CONSOLIDATION_OUTCOME,
  FRAMEWORK_AREA_KEY,
  FRAMEWORK_DECIDED_STATES,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type CaroApprovedResult,
  type CaroCapturedFacts,
  type CaroCompletion,
  type CaroDetail,
  type CaroFacts,
  type CaroOutcome,
  type CaroPriorYear,
  type CaroProfessionalAction,
  type CaroReevaluationChange,
  type CaroResult,
  type FrameworkConclusion,
  type FrameworkState,
  type FrameworkSubAssessment,
  type PartnerApproveCaroInput,
  type RecordCaroDecisionInput,
  type SetCaroFactsInput,
  type StatutoryAuditCaro,
  type StatutoryAuditCaroMasterFillResult,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { fillCaro, caroFromMaster } from './framework-facts-prefill';
import { isEngagementLead, readEngagementMasterFacts } from './master-facts';
import { AuditMattersService } from './audit-matters.service';
import { AuditProfileService } from './audit-profile.service';
import { assessCaro } from './caro';
import {
  affectedRulesFor,
  caroCompletion,
  caroPartnerApprovalReason,
  cfsInScopeOf,
  contextStatuses,
  legacyMirror,
} from './caro-completion';

const SUB = SUB_SECTION_KEY.caro;
const AREA = FRAMEWORK_AREA_KEY.caro;
const TITLE = 'CARO 2020 Applicability';
const A = CARO_PROFESSIONAL_ACTION;

/** Outcomes the system can decisively suggest (so a differing conclusion is an override). */
const DECISIVE = new Set<string>([CARO_OUTCOME.applicable, CARO_OUTCOME.notApplicableExempt]);

const DEFAULT_CAPTURED: CaroCapturedFacts = {
  isHoldingOrSubsidiaryOfPublic: null,
  capitalPlusReserves: null,
  peakBankFiBorrowings: null,
  totalRevenue: null,
};

/** The money facts a team may capture (validated ≥ 0). */
const MONEY_KEYS = [
  'paidUpCapital',
  'reservesAndSurplus',
  'capitalPlusReserves',
  'peakBankFiBorrowings',
  'revenueFromOperations',
  'otherIncome',
  'discontinuedOperationsRevenue',
  'totalRevenue',
] as const;

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: CaroDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: Partial<CaroCapturedFacts> | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
  financial_year: string | null;
  entity_id: string;
  professional_action: CaroProfessionalAction | null;
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

/**
 * 02.4 CARO 2020 Applicability service (Implementation Guide §9.4; DHVAJ 02.4
 * spec). Assembles the direct-exemption and classification facts from 02.1, the
 * CFS context from 02.6 and the client master (never recomputing them), captures
 * the CARO measurement facts, runs the pure engine against the Rules Library in
 * force for the audit period, and records the CARO-06 conclusion (confirm /
 * override with reason + technical basis + evidence / information pending) with
 * Engagement Partner approval of a significant override. The legacy Phase-02
 * "CARO" area is a mirror of this assessment, so completion, Section 08 and
 * planning read one CARO answer. Reuses the shared sub-assessment table.
 */
@Injectable()
export class AuditCaroService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
    private readonly matters: AuditMattersService,
    private readonly profile: AuditProfileService,
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

  async listForEngagement(ctx: RlsContext, engagementId: string): Promise<StatutoryAuditCaro[]> {
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
  ): Promise<StatutoryAuditCaro[]> {
    const { rows } = await client.query<SubRow>(
      `${ROW_SQL}
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
          AND ($4::uuid IS NULL OR s.workflow_instance_id = $4::uuid)
        ORDER BY swi.created_at ASC`,
      [engagementId, SUB, AREA, opts.workflowInstanceId ?? null],
    );

    const out: StatutoryAuditCaro[] = [];
    for (const r of rows) {
      const master = await readEngagementMasterFacts(client, r.workflow_instance_id);
      const captured = { ...DEFAULT_CAPTURED, ...(r.facts ?? {}) };
      const { facts, upstreamReady } = await this.assembleFacts(
        client,
        engagementId,
        r.workflow_instance_id,
        captured,
      );
      const live = await this.runEngine(client, engagementId, facts);

      const decided = isDecided(r.state, r.conclusion);
      let assessment: FrameworkSubAssessment;
      let detail: CaroDetail | null;
      let changes: CaroReevaluationChange[] = [];
      if (decided) {
        // The frozen conclusion stays; a changed source fact is flagged and named
        // (spec §2) — the live suggestion is shown beside it.
        changes = factChanges(r.system_detail, live.detail);
        if (changes.length > 0 && !r.needs_reevaluation && r.state !== 'approved') {
          await client.query(
            `UPDATE hsdg.audit_framework_subassessment SET needs_reevaluation = true
              WHERE id = $1 AND hsdg.is_engagement_lead($2::uuid)`,
            [r.id, engagementId],
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

      const conclusion = decided ? (r.conclusion as CaroOutcome | null) : null;
      const partnerReason = decided
        ? caroPartnerApprovalReason({
            conclusion,
            systemOutcome: (r.system_outcome as CaroOutcome | null) ?? null,
            isOverridden: r.is_overridden,
          })
        : null;
      const programmeContexts = await this.programmeContexts(client, r.workflow_instance_id);
      const completion: CaroCompletion = caroCompletion({
        detail,
        conclusion,
        decided,
        professionalAction: r.professional_action,
        partnerRequired: partnerReason != null,
        partnerApproved: r.partner_approved_at != null,
        needsReevaluation: r.needs_reevaluation,
        upstreamReady,
        programmeContexts,
        blockingMatterOpen: await this.blockingMatterOpen(client, r.workflow_instance_id),
        started: r.professional_action != null || r.facts != null,
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
        masterFacts: master ? caroFromMaster(master).facts : [],
        auditFinancialYear: r.financial_year ?? undefined,
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
        reevaluation: { required: r.needs_reevaluation, changes },
        priorYear: await this.priorYear(client, r, live.detail),
        approved: r.state === 'approved',
        viewerIsPartner:
          opts.viewerEmployeeId != null && opts.viewerEmployeeId === r.engagement_partner_id,
        memoSuggested:
          r.is_overridden ||
          partnerReason != null ||
          r.professional_action === A.informationPending ||
          live.outcome === CARO_OUTCOME.furtherAssessment,
      });
    }
    return out;
  }

  private async readOne(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditCaro> {
    const [caro] = await this.read(client, engagementId, {
      workflowInstanceId,
      viewerEmployeeId: ctx.employeeId ?? null,
    });
    if (!caro)
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    return caro;
  }

  /**
   * The 02.4 result downstream reads (the clause programme, 3(xxi), Section 08):
   * the frozen conclusion when decided, else the live suggestion. Runs inside the
   * caller's RLS transaction.
   */
  async readResultOn(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<CaroApprovedResult | null> {
    const { rows } = await client.query<{ engagement_id: string; financial_year: string }>(
      `SELECT swi.engagement_id, e.financial_year
         FROM hsdg.service_workflow_instances swi
         JOIN hsdg.engagements e ON e.id = swi.engagement_id
        WHERE swi.id = $1`,
      [workflowInstanceId],
    );
    if (!rows[0]) return null;
    const [caro] = await this.read(client, rows[0].engagement_id, { workflowInstanceId });
    if (!caro) return null;
    const decided = isDecided(caro.assessment.state, caro.assessment.conclusion);
    const outcome = ((decided ? caro.assessment.conclusion : caro.assessment.systemOutcome) ??
      null) as CaroOutcome | null;
    const contexts = reportContextsFor(outcome, caro.detail);
    return {
      workflowInstanceId,
      outcome,
      decided,
      complete: caro.completion?.complete ?? false,
      standalone: contexts.standalone,
      consolidated: contexts.consolidated,
      financialYear: rows[0].financial_year,
      periodStart: auditPeriodStartFromFinancialYear(rows[0].financial_year),
    };
  }

  // ── Capture the 02.4-specific facts (spec §6, §7) ───────────────────────────

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetCaroFactsInput,
  ): Promise<StatutoryAuditCaro> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();

      const before = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      const merged: CaroCapturedFacts = { ...before };
      for (const k of MONEY_KEYS) {
        const v = input[k];
        if (v === undefined) continue;
        if (v != null && (!Number.isFinite(v) || (k !== 'reservesAndSurplus' && v < 0)))
          throw new BadRequestException(`${k} must be a non-negative amount in rupees.`);
        merged[k] = v;
      }
      if (input.isHoldingOrSubsidiaryOfPublic !== undefined)
        merged.isHoldingOrSubsidiaryOfPublic = input.isHoldingOrSubsidiaryOfPublic;
      if (input.publicGroupNote !== undefined)
        merged.publicGroupNote = input.publicGroupNote?.trim() || null;
      if (input.borrowingDataBasis !== undefined) {
        if (
          input.borrowingDataBasis != null &&
          !CARO_BORROWING_DATA_BASES.includes(input.borrowingDataBasis)
        )
          throw new BadRequestException(
            'Borrowing data basis must be daily, monthly, quarterly or year_end_only.',
          );
        merged.borrowingDataBasis = input.borrowingDataBasis;
      }
      if (input.borrowingSchedule !== undefined) {
        for (const p of input.borrowingSchedule ?? []) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(p.asOn ?? ''))
            throw new BadRequestException('Each borrowing balance needs an ISO date (asOn).');
          if (!p.lender?.trim())
            throw new BadRequestException('Each borrowing balance needs the lender.');
          if (p.lenderType !== 'bank' && p.lenderType !== 'financial_institution')
            throw new BadRequestException('lenderType must be bank or financial_institution.');
          if (!Number.isFinite(p.amount) || p.amount < 0)
            throw new BadRequestException('Each borrowing balance needs a non-negative amount.');
        }
        merged.borrowingSchedule = input.borrowingSchedule?.length
          ? input.borrowingSchedule.map((p) => ({ ...p, lender: p.lender.trim() }))
          : null;
      }

      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1`,
        [row.id, JSON.stringify(merged)],
      );
      if (!isDecided(row.state, row.conclusion))
        await this.persistSuggestion(client, engagementId, row.id, merged);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        before: before as unknown as Record<string, unknown>,
        after: merged as unknown as Record<string, unknown>,
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Fill from the client master (Guide §1, capture once) ───────────────────

  /**
   * First open by a lead fills the never-touched 02.4 facts from the client
   * master and runs the engine, so the assessment starts answered instead of
   * "information insufficient". One-shot: only rows whose facts were never
   * stored, so a team's later edits are never refilled. Public so the 02.9
   * summary can trigger it too.
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
    const open = rows.filter((r) => !isDecided(r.state, r.conclusion));
    if (open.length === 0 || !(await isEngagementLead(client, engagementId))) return;
    for (const r of open) {
      const master = await readEngagementMasterFacts(client, r.workflow_instance_id);
      if (!master) continue;
      const { next, filled } = fillCaro({ ...DEFAULT_CAPTURED }, caroFromMaster(master));
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1 AND facts IS NULL`,
        [r.id, JSON.stringify(next)],
      );
      await this.persistSuggestion(client, engagementId, r.id, next);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_prefilled',
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
  ): Promise<StatutoryAuditCaroMasterFillResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const master = await readEngagementMasterFacts(client, workflowInstanceId);
      if (!master) throw new NotFoundException('Statutory-audit workflow not found.');
      const { next, filled } = fillCaro(
        { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) },
        caroFromMaster(master),
      );
      if (filled.length > 0 || row.facts == null) {
        await client.query(
          `UPDATE hsdg.audit_framework_subassessment
              SET facts = $2::jsonb, version = version + 1
            WHERE id = $1`,
          [row.id, JSON.stringify(next)],
        );
        if (!isDecided(row.state, row.conclusion))
          await this.persistSuggestion(client, engagementId, row.id, next);
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.caro_prefilled',
          objectType: 'audit_framework_subassessment',
          objectId: row.id,
          after: { filled },
        });
      }
      return { caro: await this.readOne(client, ctx, engagementId, workflowInstanceId), filled };
    });
  }

  // ── Run the suggestion engine ───────────────────────────────────────────────

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditCaro> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      await this.persistSuggestion(client, engagementId, row.id, captured);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── CARO-06 professional conclusion (spec §9) ───────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordCaroDecisionInput,
  ): Promise<StatutoryAuditCaro> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.recordDecisionOn(client, ctx, engagementId, workflowInstanceId, input);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  /**
   * CARO-06 inside the caller's transaction (the legacy Phase-02 decision routes
   * here so both records always agree). Stores the system result and the
   * professional conclusion separately, freezes the detail, mirrors the
   * Phase-02 area and reconciles Framework Matters.
   */
  async recordDecisionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordCaroDecisionInput,
  ): Promise<void> {
    const row = await this.loadRow(client, engagementId, workflowInstanceId);
    this.assertNotApproved(row);
    if (row.version !== input.version) throw stale();

    const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
    const { facts } = await this.assembleFacts(client, engagementId, workflowInstanceId, captured);
    const res = await this.runEngine(client, engagementId, facts);

    const action: CaroProfessionalAction =
      input.action ??
      (input.conclusion && input.conclusion !== res.outcome ? A.override : A.confirm);

    if (action === A.informationPending) {
      const reason = input.pendingReason?.trim();
      const blocking = res.detail.missingFacts.map((m) => m.label);
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
          reason || `Blocked on: ${blocking.join(', ')}.`,
          res.outcome,
          res.basis,
          JSON.stringify(res.detail),
          res.ruleVersionId,
          res.authorityProvisionId,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { action, pendingReason: reason ?? null, blockingFacts: blocking },
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return;
    }

    let conclusion: CaroOutcome;
    if (action === A.confirm) {
      if (!DECISIVE.has(res.outcome))
        throw new BadRequestException(
          'The system could not determine CARO applicability — override with a conclusion, reason, technical basis and supporting evidence, or mark Information Pending.',
        );
      if (input.conclusion && input.conclusion !== res.outcome)
        throw new BadRequestException(
          'Confirm takes the system assessment; use Override to change it.',
        );
      conclusion = res.outcome;
    } else {
      if (!input.conclusion || !CARO_CONCLUSIONS.includes(input.conclusion))
        throw new BadRequestException(
          'Select the final CARO conclusion: Applicable, Not Applicable - Exempt or Further Assessment Required.',
        );
      conclusion = input.conclusion;
      if (DECISIVE.has(res.outcome) && conclusion === res.outcome)
        throw new BadRequestException('The override matches the system assessment — use Confirm.');
    }
    const isOverridden = DECISIVE.has(res.outcome) && conclusion !== res.outcome;
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
          'An override needs supporting evidence — describe it or link a file to 02.4.',
        );
    }
    const state: FrameworkState = isOverridden
      ? 'overridden'
      : conclusion === CARO_OUTCOME.notApplicableExempt
        ? 'not_applicable'
        : conclusion === CARO_OUTCOME.furtherAssessment
          ? 'professional_judgement_required'
          : 'applicable';

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
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.caro_decision',
      objectType: 'audit_framework_subassessment',
      objectId: row.id,
      before: { systemOutcome: res.outcome, conclusion: row.conclusion },
      after: { action, conclusion, isOverridden, basis, technicalBasis, supportingEvidence },
    });
    await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
  }

  // ── CARO-06 Engagement Partner approval ─────────────────────────────────────

  async partnerApprove(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: PartnerApproveCaroInput,
  ): Promise<StatutoryAuditCaro> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();
      if (!ctx.employeeId || ctx.employeeId !== row.engagement_partner_id)
        throw new ForbiddenException('Only the Engagement Partner can approve this conclusion.');
      const live = await this.readOne(client, ctx, engagementId, workflowInstanceId);
      if (!isDecided(live.assessment.state, live.assessment.conclusion))
        throw new BadRequestException('Record the Manager conclusion before Partner approval.');
      if (!live.partnerApproval?.required)
        throw new BadRequestException('This conclusion does not need Partner approval.');
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET partner_approved_by_employee_id = $2, partner_approved_at = now(),
                partner_note = $3, version = version + 1
          WHERE id = $1`,
        [row.id, ctx.employeeId, input.note?.trim() || null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_partner_approved',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { reason: live.partnerApproval.reason, note: input.note ?? null },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Legacy Phase-02 mirror ──────────────────────────────────────────────────

  /**
   * The Phase-02 "CARO" area's suggestion, taken from the 02.4 engine (the old
   * simplified branch in framework-suggestions.ts is retired). Seeds/prefills
   * 02.4 first so the area never shows a different answer.
   */
  async legacySuggestionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ suggestion: FrameworkConclusion | null; basis: string; state: FrameworkState }> {
    await this.seedOn(client, workflowInstanceId, engagementId);
    await this.prefillOn(client, ctx, engagementId);
    const { rows } = await client.query<{ facts: Partial<CaroCapturedFacts> | null }>(
      `SELECT facts FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB, AREA],
    );
    const captured = { ...DEFAULT_CAPTURED, ...(rows[0]?.facts ?? {}) };
    const { facts } = await this.assembleFacts(client, engagementId, workflowInstanceId, captured);
    const res = await this.runEngine(client, engagementId, facts);
    const m = legacyMirror(res.outcome, null, false);
    return { suggestion: m.suggestion, basis: `02.4 CARO: ${res.basis}`, state: m.state };
  }

  /**
   * Bulk "Accept suggestions" on the Phase-02 list: confirm a decisive 02.4
   * system assessment (the same as CARO-06 Confirm). Returns whether it decided.
   */
  async acceptSuggestionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<boolean> {
    const row = await this.loadRow(client, engagementId, workflowInstanceId);
    if (isDecided(row.state, row.conclusion)) return false;
    const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
    const { facts } = await this.assembleFacts(client, engagementId, workflowInstanceId, captured);
    const res = await this.runEngine(client, engagementId, facts);
    if (!DECISIVE.has(res.outcome)) return false;
    await this.recordDecisionOn(client, ctx, engagementId, workflowInstanceId, {
      action: A.confirm,
      version: row.version,
    });
    return true;
  }

  /**
   * A Phase-02 list decision on the CARO area (pre-02.4 path, kept for API
   * compatibility): recorded as the CARO-06 conclusion so the two never differ.
   * A differing conclusion is an override carrying the list's basis as its
   * reason, technical basis and evidence note — the 02.4 workspace is the full path.
   */
  async decideFromFrameworkOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { conclusion: FrameworkConclusion; basis?: string | null; impact?: string | null },
  ): Promise<void> {
    const row = await this.loadRow(client, engagementId, workflowInstanceId);
    const conclusion: CaroOutcome =
      input.conclusion === 'applicable'
        ? CARO_OUTCOME.applicable
        : CARO_OUTCOME.notApplicableExempt;
    const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
    const { facts } = await this.assembleFacts(client, engagementId, workflowInstanceId, captured);
    const res = await this.runEngine(client, engagementId, facts);
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

  /** Write the 02.4 state onto the Phase-02 "CARO" area (never an approved one). */
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
    const m = legacyMirror(
      (s.system_outcome as CaroOutcome | null) ?? CARO_OUTCOME.informationInsufficient,
      isDecided(s.state, s.conclusion) ? (s.conclusion as CaroOutcome | null) : null,
      s.is_overridden,
      s.state === 'pending_information',
    );
    await client.query(
      `UPDATE hsdg.audit_framework_assessments
          SET system_suggestion = $2, system_basis = $3, state = $4, conclusion = $5,
              is_overridden = $6, basis = $7, impact = $8,
              decided_by_employee_id = CASE WHEN $5::text IS NULL THEN NULL ELSE $9::uuid END,
              decided_at = CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,
              version = version + 1
        WHERE workflow_instance_id = $1 AND area_key = 'caro' AND state <> 'approved'`,
      [
        workflowInstanceId,
        m.suggestion,
        s.system_basis ? `02.4 CARO: ${s.system_basis}` : null,
        m.state,
        m.conclusion,
        m.conclusion != null && s.is_overridden,
        s.basis,
        s.impact,
        s.decided_by_employee_id,
      ],
    );
    await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Run the pure engine and freeze the period-correct CARO 2020 provision. */
  private async runEngine(
    client: PoolClient,
    engagementId: string,
    facts: CaroFacts,
  ): Promise<CaroResult> {
    const auditPeriodStart = await this.auditPeriodStart(client, engagementId);
    const resolve = await this.rules.buildResolverOn(client, auditPeriodStart);
    const res = assessCaro(facts, resolve);
    if (res.detail.orderVersion) {
      const prov = await this.rules.resolveProvisionOn(
        client,
        CARO_PROVISION_CODE.order,
        auditPeriodStart,
      );
      res.authorityProvisionId = prov?.id ?? null;
    }
    return res;
  }

  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    captured: CaroCapturedFacts,
  ): Promise<void> {
    const { rows } = await client.query<{
      state: FrameworkState;
      workflow_instance_id: string;
      conclusion: string | null;
    }>(
      `SELECT state, workflow_instance_id, conclusion
         FROM hsdg.audit_framework_subassessment WHERE id = $1`,
      [rowId],
    );
    if (!rows[0] || isDecided(rows[0].state, rows[0].conclusion)) return;
    const { facts } = await this.assembleFacts(
      client,
      engagementId,
      rows[0].workflow_instance_id,
      captured,
    );
    const res = await this.runEngine(client, engagementId, facts);
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
        'The framework is approved; a controlled reassessment must reopen it before editing 02.4.',
      );
    }
  }

  /** Assemble the base facts from 02.1 + 02.6 + masters + captured facts. */
  private async assembleFacts(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    captured: CaroCapturedFacts,
  ): Promise<{ facts: CaroFacts; upstreamReady: boolean }> {
    let isCompany: boolean | null = null;
    let isPrivateCompany: boolean | null = null;
    let isOpc: boolean | null = null;
    const type = await client.query<{ slug: string; category: string }>(
      `SELECT et.slug, et.category
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE e.id = $1`,
      [engagementId],
    );
    if (type.rows[0]) {
      isCompany = type.rows[0].category === 'company';
      isPrivateCompany = isCompany ? ['private_limited', 'opc'].includes(type.rows[0].slug) : false;
      isOpc = type.rows[0].slug === 'opc';
    }

    const profile = await client.query<{
      special_entity_types: string[];
      state: string;
    }>(
      `SELECT special_entity_types, state
         FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const p = profile.rows[0];
    const special = p?.special_entity_types ?? null;
    const profileConfirmed = p?.state === 'confirmed';
    const has = (k: string) => (special == null ? null : special.includes(k));

    // 02.1's final §2(85) conclusion (override wins; frozen once confirmed) —
    // never recomputed here. Before 02.1 is confirmed it is marked provisional;
    // COMPLETE still requires the confirmed 02.1 (spec §19).
    const sc = p
      ? await this.profile.smallCompanyResultOn(client, engagementId, workflowInstanceId)
      : null;
    const isSmallCompany: boolean | null =
      sc?.outcome === 'small'
        ? true
        : sc?.outcome === 'not_small' || sc?.outcome === 'not_applicable'
          ? false
          : null;
    const smallCompanyBasis =
      sc && isSmallCompany != null
        ? `${sc.basis}${sc.confirmed ? '' : ' — provisional, 02.1 not yet confirmed'}`
        : null;

    // 02.6 consolidated FS scope (the decided conclusion, or a "no group" system answer).
    const cfs = await client.query<{
      state: FrameworkState;
      conclusion: string | null;
      system_outcome: string | null;
      system_basis: string | null;
    }>(
      `SELECT state, conclusion, system_outcome, system_basis
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2`,
      [workflowInstanceId, SUB_SECTION_KEY.consolidation],
    );
    const c = cfs.rows[0];
    let cfsInScope: boolean | null = null;
    let cfsBasis: string | null = null;
    const cfsOutcome = c && FRAMEWORK_DECIDED_STATES.includes(c.state) ? c.conclusion : null;
    if (cfsOutcome === CONSOLIDATION_OUTCOME.cfsRequired) cfsInScope = true;
    else if (
      cfsOutcome === CONSOLIDATION_OUTCOME.cfsExempt ||
      cfsOutcome === CONSOLIDATION_OUTCOME.notApplicable
    ) {
      cfsInScope = false;
      cfsBasis = `02.6 concluded: ${cfsOutcome.replace(/_/g, ' ')} — no consolidated financial statements.`;
    } else if (c?.system_outcome === CONSOLIDATION_OUTCOME.notApplicable) {
      cfsInScope = false;
      cfsBasis =
        '02.6: no subsidiary, associate or joint venture — no consolidated financial statements.';
    }

    const master = await readEngagementMasterFacts(client, workflowInstanceId);
    const counterparties = master
      ? (caroFromMaster(master)
          .facts.find((m) => m.label === 'Holding / subsidiary of a public company')
          ?.value?.replace(/^Yes — /, '')
          .split(', ')
          .filter((x) => x && !x.startsWith('No public')) ?? [])
      : [];

    return {
      facts: {
        isCompany,
        isPrivateCompany,
        isBanking: has('bank'),
        isInsurance: has('insurance'),
        isSection8: has('section_8'),
        isOpc,
        isSmallCompany,
        smallCompanyBasis,
        profileAvailable: p != null,
        isHoldingOrSubsidiaryOfPublic: captured.isHoldingOrSubsidiaryOfPublic ?? null,
        publicGroupCounterparties: captured.isHoldingOrSubsidiaryOfPublic ? counterparties : [],
        paidUpCapital: captured.paidUpCapital ?? null,
        reservesAndSurplus: captured.reservesAndSurplus ?? null,
        capitalPlusReserves: captured.capitalPlusReserves,
        borrowingSchedule: captured.borrowingSchedule ?? null,
        borrowingDataBasis: captured.borrowingDataBasis ?? null,
        peakBankFiBorrowings: captured.peakBankFiBorrowings,
        revenueFromOperations: captured.revenueFromOperations ?? null,
        otherIncome: captured.otherIncome ?? null,
        discontinuedOperationsRevenue: captured.discontinuedOperationsRevenue ?? null,
        totalRevenue: captured.totalRevenue,
        cfsInScope,
        cfsBasis,
      },
      upstreamReady: profileConfirmed,
    };
  }

  private async auditPeriodStart(client: PoolClient, engagementId: string): Promise<string> {
    const fy = await client.query<{ financial_year: string }>(
      `SELECT financial_year FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    return fy.rows[0]
      ? auditPeriodStartFromFinancialYear(fy.rows[0].financial_year)
      : new Date().toISOString().slice(0, 10);
  }

  /** A file linked to 02.4 (the shared Section 02 evidence table) counts as supporting evidence. */
  private async hasEvidenceFile(client: PoolClient, subassessmentId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM hsdg.audit_framework_files
        WHERE subassessment_id = $1 AND removed_at IS NULL LIMIT 1`,
      [subassessmentId],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * The report contexts whose Level-2 clause programme is instantiated (Track B
   * owns hsdg.audit_caro_programme; null before that migration runs).
   */
  private async programmeContexts(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<string[] | null> {
    const t = await client.query<{ t: string | null }>(
      `SELECT to_regclass('hsdg.audit_caro_programme')::text AS t`,
    );
    if (!t.rows[0]?.t) return null;
    const { rows } = await client.query<{ report_context: string }>(
      `SELECT DISTINCT report_context FROM hsdg.audit_caro_programme
        WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL`,
      [workflowInstanceId],
    );
    return rows.map((r) => r.report_context);
  }

  /** An open blocking Framework Matter raised on the CARO area (spec §19). */
  private async blockingMatterOpen(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<boolean> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM hsdg.audit_matter
        WHERE workflow_instance_id = $1 AND section = 'framework' AND is_blocking
          AND status IN ('open','under_review','blocking')
          AND source LIKE 'framework:caro:%'
        LIMIT 1`,
      [workflowInstanceId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Prior-year CARO context — display only; the current year always reruns (spec §15). */
  private async priorYear(
    client: PoolClient,
    r: SubRow,
    current: CaroDetail,
  ): Promise<CaroPriorYear | null> {
    if (!r.financial_year) return null;
    const { rows } = await client.query<{
      workflow_instance_id: string;
      financial_year: string;
      conclusion: string | null;
      system_outcome: string | null;
      is_overridden: boolean;
      system_basis: string | null;
      basis: string | null;
      system_detail: CaroDetail | null;
      decided_at: Date | null;
    }>(
      `SELECT s.workflow_instance_id, e.financial_year, s.conclusion, s.system_outcome,
              s.is_overridden, s.system_basis, s.basis, s.system_detail, s.decided_at
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
         JOIN hsdg.engagements e ON e.id = s.engagement_id
        WHERE e.entity_id = $1 AND e.financial_year < $2 AND s.workflow_instance_id <> $3
          AND s.sub_section_key = $4 AND s.area_key = $5 AND swi.status <> 'cancelled'
        ORDER BY e.financial_year DESC
        LIMIT 1`,
      [r.entity_id, r.financial_year, r.workflow_instance_id, SUB, AREA],
    );
    const p = rows[0];
    if (!p) return null;
    const outcome = (p.conclusion ?? p.system_outcome) as CaroOutcome | null;
    const changed = factChanges(p.system_detail, current).map((c) => ({
      label: c.label,
      prior: c.before,
      current: c.after,
    }));
    return {
      workflowInstanceId: p.workflow_instance_id,
      financialYear: p.financial_year,
      outcome,
      isOverridden: p.is_overridden,
      exemptionBasis:
        outcome === CARO_OUTCOME.notApplicableExempt
          ? (p.system_detail?.exemptionReason ?? p.basis ?? p.system_basis)
          : null,
      decidedAt: p.decided_at ? p.decided_at.toISOString() : null,
      changedFacts: changed,
    };
  }
}

/**
 * A professional conclusion is recorded: a decided state, or a recorded
 * "Further Assessment Required" conclusion (state professional_judgement_required
 * with a conclusion — the system's own undecided state never carries one).
 */
function isDecided(state: FrameworkState, conclusion: string | null = null): boolean {
  return (
    state === 'applicable' ||
    state === 'not_applicable' ||
    state === 'overridden' ||
    state === 'approved' ||
    state === 'reassessment_required' ||
    (state === 'professional_judgement_required' && conclusion != null)
  );
}

function stale(): ConflictException {
  return new ConflictException('This assessment changed since you loaded it; refresh and retry.');
}

/** Source facts that differ between a frozen detail and the live one (spec §2, §15). */
function factChanges(frozen: CaroDetail | null, live: CaroDetail): CaroReevaluationChange[] {
  const before = new Map((frozen?.factsUsed ?? []).map((f) => [f.key, f]));
  const out: CaroReevaluationChange[] = [];
  for (const f of live.factsUsed) {
    const b = before.get(f.key);
    if (!b || b.value === f.value) continue;
    out.push({
      key: f.key,
      label: f.label,
      before: b.value,
      after: f.value,
      affectedRules: affectedRulesFor(f.key, live),
    });
  }
  return out;
}

/** The report contexts for an outcome — the consolidated component follows Level 1. */
function reportContextsFor(
  outcome: CaroOutcome | null,
  detail: CaroDetail | null,
): Pick<CaroApprovedResult, 'standalone' | 'consolidated'> {
  const inScope = cfsInScopeOf(detail);
  const s = contextStatuses(outcome, inScope);
  const applies = (x: string) =>
    x === CARO_CONTEXT_STATUS.pending ? null : x === CARO_CONTEXT_STATUS.applicable;
  return {
    standalone: { status: s.standalone, applies: applies(s.standalone) },
    consolidated: {
      status: s.consolidated,
      applies: applies(s.consolidated),
      cfsInScope: inScope === true,
    },
  };
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

function liveAssessment(r: SubRow, res: CaroResult): FrameworkSubAssessment {
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

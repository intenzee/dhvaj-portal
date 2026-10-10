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
  EMPTY_OTHER_REPORTING_CAPTURED,
  FRAMEWORK_AREA_KEY,
  OTHER_REPORTING_ACTION,
  OTHER_REPORTING_CONCLUSIONS,
  OTHER_REPORTING_PROVISION_CODE,
  REPORTING_APPLICABILITIES,
  REPORTING_CARD_KEYS,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type FrameworkConclusion,
  type FrameworkState,
  type FrameworkSubAssessment,
  type OtherReportingAction,
  type OtherReportingBaseFacts,
  type OtherReportingCapturedFacts,
  type OtherReportingDetail,
  type OtherReportingOutcome,
  type OtherReportingResult,
  type PartnerApproveOtherReportingInput,
  type RecordOtherReportingDecisionInput,
  type ReportingApplicability,
  type ReportingApplicabilityOverride,
  type ReportingCardKey,
  type SetOtherReportingFactsInput,
  type StatutoryAuditOtherReporting,
  type StatutoryAuditOtherReportingMasterFillResult,
  type UpdateReportingCardInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { AuditMattersService } from './audit-matters.service';
import { fillOtherReporting, otherReportingFromSources } from './framework-facts-prefill';
import { isEngagementLead, readEngagementMasterFacts, readReportingSources } from './master-facts';
import { assessOtherReporting, normaliseCaptured } from './other-reporting';
import {
  OTHER_REPORTING_DECISIVE,
  isOtherReportingDecided,
  otherReportingCompletion,
  otherReportingFingerprint,
  otherReportingLegacyMirror,
  otherReportingPartnerApprovalReason,
} from './other-reporting-completion';
import { readCardStatesOn, withCardStates } from './other-reporting-read';
import {
  directorDisqualificationStatusOn,
  fraudFrameworkStatusOn,
  reportingCrossRefsOn,
  reportingEvidenceCountsOn,
} from './other-reporting-records-read';

const SUB = SUB_SECTION_KEY.otherReporting;
const AREA = FRAMEWORK_AREA_KEY.otherRegulatory;
const TITLE = 'Other Companies Act & Statutory Reporting';
const A = OTHER_REPORTING_ACTION;
const P = OTHER_REPORTING_PROVISION_CODE;
/** The Section 02 areas 02.7 mirrors (applicability of auditor reporting). */
const LEGACY_AREAS = [FRAMEWORK_AREA_KEY.rule11, FRAMEWORK_AREA_KEY.section143];

const CARD_KEYS = new Set<string>(REPORTING_CARD_KEYS);
const APPLICABILITIES = new Set<string>(REPORTING_APPLICABILITIES);

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: OtherReportingDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: Partial<OtherReportingCapturedFacts> | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
  professional_action: OtherReportingAction | null;
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
         s.version, s.professional_action, s.pending_reason,
         pemp.full_name AS partner_approved_by_name, s.partner_approved_at, s.partner_note,
         e.engagement_partner_id
    FROM hsdg.audit_framework_subassessment s
    JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
    JOIN hsdg.engagements e ON e.id = s.engagement_id
    LEFT JOIN hsdg.employees emp ON emp.id = s.decided_by_employee_id
    LEFT JOIN hsdg.employees pemp ON pemp.id = s.partner_approved_by_employee_id`;

/**
 * 02.7 Other Companies Act & Statutory Reporting service — Track A (DHVAJ 02.7
 * spec v1.0 §3–§13, §16, §17, §20). Assembles the base facts (company /
 * public-company route from the entity master and 02.4, the Rule 11 version
 * and Rule 11(g) in force for the audit period, Track B's fraud / director /
 * cross-reference / evidence status, DI-free), runs the pure configurator
 * against the Rules Library, records the conclusion (Confirm / Override with
 * reason + technical basis + evidence / Information Pending) with Engagement
 * Partner approval of a significant override, keeps each requirement card's
 * work state (workable after approval), and mirrors the Section 02 rule_11 /
 * section_143 areas so every consumer reads one answer. Reuses the shared
 * sub-assessment table.
 */
@Injectable()
export class AuditOtherReportingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
    private readonly matters: AuditMattersService,
  ) {}

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
  ): Promise<StatutoryAuditOtherReporting[]> {
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
  ): Promise<StatutoryAuditOtherReporting[]> {
    const { rows } = await client.query<SubRow>(
      `${ROW_SQL}
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
          AND ($4::uuid IS NULL OR s.workflow_instance_id = $4::uuid)
        ORDER BY swi.created_at ASC`,
      [engagementId, SUB, AREA, opts.workflowInstanceId ?? null],
    );
    const lead = rows.length > 0 && (await isEngagementLead(client, engagementId));

    const out: StatutoryAuditOtherReporting[] = [];
    for (const r of rows) {
      const fill = await this.masterFill(client, r.workflow_instance_id);
      const captured = normaliseCaptured(r.facts);
      const { facts, upstreamReady } = await this.assembleFacts(
        client,
        engagementId,
        r.workflow_instance_id,
        captured,
      );
      const live = await this.runEngine(client, facts);
      const decided = isOtherReportingDecided(r.state);

      let assessment: FrameworkSubAssessment;
      let detail: OtherReportingDetail;
      if (decided && r.system_detail?.cards) {
        // The frozen conclusion stays; a change to what it rests on (card
        // applicability, Rule 11(g), §197 route, Rule 11 version) is flagged.
        const changed =
          otherReportingFingerprint(r.system_outcome, r.system_detail) !==
          otherReportingFingerprint(live.outcome, live.detail);
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
        assessment = decided
          ? mapAssessment(r)
          : {
              ...liveAssessment(r, live),
              state:
                r.professional_action === A.informationPending ? 'pending_information' : live.state,
            };
        detail = live.detail;
      }
      // Card work and evidence are live (cards stay workable after approval, §20).
      detail = {
        ...detail,
        cards: withCardStates(
          detail.cards.map((c) => ({ ...c, evidenceCount: facts.evidenceCounts[c.key] ?? 0 })),
          await readCardStatesOn(client, r.workflow_instance_id),
        ),
      };

      const conclusion = decided ? (r.conclusion as OtherReportingOutcome | null) : null;
      const partnerReason = decided
        ? otherReportingPartnerApprovalReason({
            conclusion,
            isOverridden: r.is_overridden,
            detail: r.system_detail,
          })
        : null;
      const completion = otherReportingCompletion({
        detail,
        decided,
        professionalAction: r.professional_action,
        partnerRequired: partnerReason != null,
        partnerApproved: r.partner_approved_at != null,
        needsReevaluation: r.needs_reevaluation,
        isCompany: facts.isCompany,
        started: r.facts != null || r.professional_action != null,
        fraud: facts.fraud,
        directors: facts.directors,
        crossRefs: facts.crossRefs,
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
        masterFacts: fill?.facts ?? [],
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
  ): Promise<StatutoryAuditOtherReporting> {
    const [o] = await this.read(client, engagementId, {
      workflowInstanceId,
      viewerEmployeeId: ctx.employeeId ?? null,
    });
    if (!o) throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    return o;
  }

  // ── Capture the facts (spec §4–§13) ────────────────────────────────────────

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetOtherReportingFactsInput,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();
      const merged = mergeInput(normaliseCaptured(row.facts), input);
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1`,
        [row.id, JSON.stringify(merged)],
      );
      await this.persistSuggestion(client, engagementId, row.id, merged);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.other_reporting_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        before: row.facts,
        after: merged,
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Fill from the client master and portal records (Guide §1) ──────────────

  /** What the portal already knows for 02.7, or null when the shell is gone. */
  private async masterFill(client: PoolClient, workflowInstanceId: string) {
    const master = await readEngagementMasterFacts(client, workflowInstanceId);
    if (!master) return null;
    const src = await readReportingSources(client, workflowInstanceId);
    return otherReportingFromSources(src.directors, src.priorOtherReporting, master);
  }

  /**
   * First open by a lead fills the never-touched 02.7 facts from the portal
   * (directors → managerial persons, last year's software register) and runs
   * the engine. One-shot: only rows whose facts were never stored. Public so
   * the 02.9 summary can trigger it too.
   */
  async prefillOn(client: PoolClient, ctx: RlsContext, engagementId: string): Promise<void> {
    const { rows } = await client.query<{
      id: string;
      workflow_instance_id: string;
      state: FrameworkState;
    }>(
      `SELECT s.id, s.workflow_instance_id, s.state
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
          AND s.facts IS NULL AND swi.status <> 'cancelled'`,
      [engagementId, SUB, AREA],
    );
    const open = rows.filter((r) => !isOtherReportingDecided(r.state));
    if (open.length === 0 || !(await isEngagementLead(client, engagementId))) return;
    for (const r of open) {
      const fill = await this.masterFill(client, r.workflow_instance_id);
      if (!fill) continue;
      const { next, filled } = fillOtherReporting(normaliseCaptured(null), fill);
      const withIds = assignIds(next);
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1 AND facts IS NULL`,
        [r.id, JSON.stringify(withIds)],
      );
      await this.persistSuggestion(client, engagementId, r.id, withIds);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.other_reporting_prefilled',
        objectType: 'audit_framework_subassessment',
        objectId: r.id,
        after: { filled, automatic: true },
      });
      await this.syncLegacyOn(client, ctx, engagementId, r.workflow_instance_id);
    }
  }

  /** "Fill from client master": fills blanks only; never overwrites the team. */
  async fillFromMaster(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditOtherReportingMasterFillResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const fill = await this.masterFill(client, workflowInstanceId);
      if (!fill) throw new NotFoundException('Statutory-audit workflow not found.');
      const { next, filled } = fillOtherReporting(normaliseCaptured(row.facts), fill);
      if (filled.length > 0 || row.facts == null) {
        const withIds = assignIds(next);
        await client.query(
          `UPDATE hsdg.audit_framework_subassessment
              SET facts = $2::jsonb, version = version + 1
            WHERE id = $1`,
          [row.id, JSON.stringify(withIds)],
        );
        await this.persistSuggestion(client, engagementId, row.id, withIds);
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.other_reporting_prefilled',
          objectType: 'audit_framework_subassessment',
          objectId: row.id,
          after: { filled },
        });
        await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      }
      const otherReporting = await this.readOne(client, ctx, engagementId, workflowInstanceId);
      return { otherReporting, filled };
    });
  }

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      await this.persistSuggestion(client, engagementId, row.id, normaliseCaptured(row.facts));
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.other_reporting_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Professional conclusion (spec §3, §20) ─────────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordOtherReportingDecisionInput,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.recordDecisionOn(client, ctx, engagementId, workflowInstanceId, input);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  /**
   * Confirm Framework / Override / Information Pending inside the caller's
   * transaction. Stores the system result and the professional conclusion
   * separately, freezes the matrix (cards, rule versions, Rule 11 version) and
   * mirrors the Section 02 rule_11 / section_143 areas.
   */
  async recordDecisionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordOtherReportingDecisionInput,
  ): Promise<void> {
    const row = await this.loadRow(client, engagementId, workflowInstanceId);
    this.assertNotApproved(row);
    if (row.version !== input.version) throw stale();

    const captured = normaliseCaptured(row.facts);
    const { facts } = await this.assembleFacts(client, engagementId, workflowInstanceId, captured);
    const res = await this.runEngine(client, facts);

    const action: OtherReportingAction =
      input.action ??
      (input.conclusion && input.conclusion !== res.outcome ? A.override : A.confirm);

    if (action === A.informationPending) {
      const reason = input.pendingReason?.trim();
      const blocking = res.detail.missingFacts.filter((m) => m.blocking).map((m) => m.label);
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
        action: 'statutory_audit.other_reporting_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { action, pendingReason: reason ?? null, blockingFacts: blocking },
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return;
    }

    let conclusion: OtherReportingOutcome;
    if (action === A.confirm) {
      if (!OTHER_REPORTING_DECISIVE.has(res.outcome))
        throw new BadRequestException(
          'Pending facts block the reporting matrix — answer them, override with a conclusion, reason, technical basis and supporting evidence, or mark Information Pending.',
        );
      if (input.conclusion && input.conclusion !== res.outcome)
        throw new BadRequestException(
          'Confirm takes the system assessment; use Override to change it.',
        );
      conclusion = res.outcome;
    } else {
      if (!input.conclusion || !OTHER_REPORTING_CONCLUSIONS.includes(input.conclusion))
        throw new BadRequestException(
          'Select the final conclusion: Framework configured or Attention required.',
        );
      conclusion = input.conclusion;
      if (OTHER_REPORTING_DECISIVE.has(res.outcome) && conclusion === res.outcome)
        throw new BadRequestException('The override matches the system assessment — use Confirm.');
    }
    const isOverridden = conclusion !== res.outcome;
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
          'An override needs supporting evidence — describe it or link a file to 02.7.',
        );
    }
    const state: FrameworkState = isOverridden
      ? 'overridden'
      : facts.isCompany === false
        ? 'not_applicable'
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
        isOverridden ? A.override : A.confirm,
        JSON.stringify({ ...captured, technicalBasis, supportingEvidence }),
      ],
    );
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.other_reporting_decision',
      objectType: 'audit_framework_subassessment',
      objectId: row.id,
      before: { systemOutcome: res.outcome, conclusion: row.conclusion },
      after: { action, conclusion, isOverridden, basis, technicalBasis, supportingEvidence },
    });
    await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
  }

  async partnerApprove(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: PartnerApproveOtherReportingInput,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();
      if (!ctx.employeeId || ctx.employeeId !== row.engagement_partner_id)
        throw new ForbiddenException('Only the Engagement Partner can approve this conclusion.');
      const live = await this.readOne(client, ctx, engagementId, workflowInstanceId);
      if (!isOtherReportingDecided(live.assessment.state))
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
        action: 'statutory_audit.other_reporting_partner_approved',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { reason: live.partnerApproval.reason, note: input.note ?? null },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Requirement card work state (spec §16; workable after approval, §20) ───

  async updateCard(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    cardKey: string,
    input: UpdateReportingCardInput,
  ): Promise<StatutoryAuditOtherReporting> {
    if (!CARD_KEYS.has(cardKey)) throw new BadRequestException('Not a 02.7 requirement card.');
    return this.db.withRlsContext(ctx, async (client) => {
      await this.loadRow(client, engagementId, workflowInstanceId);
      const { rows } = await client.query<{
        id: string;
        version: number;
        exceptions: number;
        exception_note: string | null;
      }>(
        `SELECT id, version, exceptions, exception_note FROM hsdg.audit_reporting_card
          WHERE workflow_instance_id = $1 AND card_key = $2`,
        [workflowInstanceId, cardKey],
      );
      const cur = rows[0];
      if ((cur?.version ?? 0) !== input.version) throw stale();
      const exceptions = input.exceptions ?? cur?.exceptions ?? 0;
      const note =
        input.exceptionNote !== undefined
          ? input.exceptionNote?.trim() || null
          : (cur?.exception_note ?? null);
      if (exceptions > 0 && !note)
        throw new BadRequestException('Describe the exception(s) recorded on this card.');
      const reviewedBy =
        input.reviewed === true ? (ctx.employeeId ?? null) : input.reviewed === false ? null : undefined;
      if (input.reviewed === true && !reviewedBy)
        throw new ForbiddenException('Only an employee can mark a card reviewed.');

      const sets: string[] = [];
      const vals: unknown[] = [];
      const set = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length + 2}`);
      };
      if (input.workStatus !== undefined) set('work_status', input.workStatus);
      if (input.reportingStatus !== undefined) set('reporting_status', input.reportingStatus);
      if (input.proposedConclusion !== undefined)
        set('proposed_conclusion', input.proposedConclusion?.trim() || null);
      set('exceptions', exceptions);
      set('exception_note', note);
      if (input.sourceWorkpaper !== undefined)
        set('source_workpaper', input.sourceWorkpaper?.trim() || null);
      if (reviewedBy !== undefined) {
        set('reviewed_by_employee_id', reviewedBy);
        sets.push(reviewedBy ? 'reviewed_at = now()' : 'reviewed_at = NULL');
      }

      if (!cur) {
        await client.query(
          `INSERT INTO hsdg.audit_reporting_card (workflow_instance_id, engagement_id, card_key)
           VALUES ($1, $2, $3)`,
          [workflowInstanceId, engagementId, cardKey],
        );
      }
      await client.query(
        `UPDATE hsdg.audit_reporting_card
            SET ${sets.join(', ')}, version = version + ${cur ? 1 : 0}
          WHERE workflow_instance_id = $1 AND card_key = $2`,
        [workflowInstanceId, cardKey, ...vals],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.other_reporting_card_updated',
        objectType: 'audit_reporting_card',
        objectId: cur?.id ?? null,
        after: { cardKey, ...input },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Section 02 rule_11 / section_143 mirror ────────────────────────────────

  /**
   * The Section 02 rule_11 / section_143 suggestion, carried with the 02.7
   * matrix status so the area and the workspace never disagree. Seeds /
   * prefills 02.7 first.
   */
  async legacySuggestionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ suggestion: FrameworkConclusion | null; basis: string; state: FrameworkState }> {
    await this.seedOn(client, workflowInstanceId, engagementId);
    await this.prefillOn(client, ctx, engagementId);
    const { rows } = await client.query<{ facts: Partial<OtherReportingCapturedFacts> | null }>(
      `SELECT facts FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB, AREA],
    );
    const { facts } = await this.assembleFacts(
      client,
      engagementId,
      workflowInstanceId,
      normaliseCaptured(rows[0]?.facts ?? null),
    );
    const res = await this.runEngine(client, facts);
    const m = otherReportingLegacyMirror(facts.isCompany, false, false);
    return { suggestion: m.suggestion, basis: legacyBasis(facts.isCompany, res.basis), state: m.state };
  }

  /** Write the 02.7 state onto the Section 02 rule_11 / section_143 areas. */
  private async syncLegacyOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query<{
      state: FrameworkState;
      basis: string | null;
      impact: string | null;
      system_basis: string | null;
      decided_by_employee_id: string | null;
    }>(
      `SELECT state, basis, impact, system_basis, decided_by_employee_id
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB, AREA],
    );
    const s = rows[0];
    if (!s) return;
    const isCompany = await this.isCompanyOn(client, engagementId);
    const decided = isOtherReportingDecided(s.state);
    const m = otherReportingLegacyMirror(isCompany, decided, false);
    const basis = legacyBasis(isCompany, s.system_basis);
    // A decided 02.7 concludes the areas (never an approved one); an undecided
    // 02.7 only refreshes the suggestion of an area the team has not decided.
    const { rowCount } = decided
      ? await client.query(
          `UPDATE hsdg.audit_framework_assessments
              SET system_suggestion = $2, system_basis = $3, state = $4, conclusion = $5,
                  is_overridden = false, basis = $6, impact = $7,
                  decided_by_employee_id = $8, decided_at = now(), version = version + 1
            WHERE workflow_instance_id = $1 AND area_key = ANY($9::text[]) AND state <> 'approved'
              AND (system_suggestion IS DISTINCT FROM $2 OR system_basis IS DISTINCT FROM $3
                   OR state IS DISTINCT FROM $4 OR conclusion IS DISTINCT FROM $5
                   OR basis IS DISTINCT FROM $6 OR impact IS DISTINCT FROM $7)`,
          [
            workflowInstanceId,
            m.suggestion,
            basis,
            m.state,
            m.conclusion,
            s.basis ?? '02.7 reporting matrix concluded.',
            s.impact,
            s.decided_by_employee_id,
            LEGACY_AREAS,
          ],
        )
      : await client.query(
          `UPDATE hsdg.audit_framework_assessments
              SET system_suggestion = $2, system_basis = $3, state = $4
            WHERE workflow_instance_id = $1 AND area_key = ANY($5::text[])
              AND state NOT IN ('applicable','not_applicable','overridden','approved')
              AND (system_suggestion IS DISTINCT FROM $2 OR system_basis IS DISTINCT FROM $3
                   OR state IS DISTINCT FROM $4)`,
          [workflowInstanceId, m.suggestion, basis, m.state, LEGACY_AREAS],
        );
    if ((rowCount ?? 0) > 0)
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Run the pure engine (rules by audit-period START) and freeze the §143(3) provision. */
  private async runEngine(
    client: PoolClient,
    facts: OtherReportingBaseFacts,
  ): Promise<OtherReportingResult> {
    const start = facts.periodStart ?? new Date().toISOString().slice(0, 10);
    const resolve = await this.rules.buildResolverOn(client, start);
    const res = assessOtherReporting(facts, resolve);
    if (facts.isCompany !== false) {
      const prov = await this.rules.resolveProvisionOn(client, P.section143_3, start);
      res.authorityProvisionId = prov?.id ?? null;
    }
    return res;
  }

  /**
   * Persist the engine result. Undecided: the live suggestion. Decided: the
   * conclusion stays frozen — the stored detail refreshes while the
   * fingerprint is unchanged, otherwise the row needs re-evaluation.
   */
  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    captured: OtherReportingCapturedFacts,
  ): Promise<void> {
    const { rows } = await client.query<{
      state: FrameworkState;
      workflow_instance_id: string;
      system_outcome: string | null;
      system_detail: OtherReportingDetail | null;
    }>(
      `SELECT state, workflow_instance_id, system_outcome, system_detail
         FROM hsdg.audit_framework_subassessment WHERE id = $1`,
      [rowId],
    );
    const row = rows[0];
    if (!row || row.state === 'approved') return;
    const { facts } = await this.assembleFacts(
      client,
      engagementId,
      row.workflow_instance_id,
      captured,
    );
    const res = await this.runEngine(client, facts);
    if (isOtherReportingDecided(row.state)) {
      if (
        otherReportingFingerprint(row.system_outcome, row.system_detail) ===
        otherReportingFingerprint(res.outcome, res.detail)
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
        'The framework is approved; a controlled reassessment must reopen it before editing 02.7.',
      );
    }
  }

  private async isCompanyOn(client: PoolClient, engagementId: string): Promise<boolean | null> {
    const { rows } = await client.query<{ category: string }>(
      `SELECT et.category
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE e.id = $1`,
      [engagementId],
    );
    return rows[0] ? rows[0].category === 'company' : null;
  }

  /**
   * Base facts: company / public-company route (entity master, with 02.4's
   * public-group answer flagging a possible deemed public company), the audit
   * period, the Rule 11 version and Rule 11(g) in force, and Track B's status.
   */
  private async assembleFacts(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    captured: OtherReportingCapturedFacts,
  ): Promise<{ facts: OtherReportingBaseFacts; upstreamReady: boolean }> {
    const { rows } = await client.query<{
      slug: string | null;
      category: string | null;
      financial_year: string | null;
      public_group: boolean | null;
    }>(
      `SELECT et.slug, et.category, e.financial_year,
              (caro.facts ->> 'isHoldingOrSubsidiaryOfPublic')::boolean AS public_group
         FROM hsdg.engagements e
         LEFT JOIN hsdg.entities ent ON ent.id = e.entity_id
         LEFT JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
         LEFT JOIN hsdg.audit_framework_subassessment caro
           ON caro.workflow_instance_id = $2 AND caro.sub_section_key = $3 AND caro.area_key = $4
        WHERE e.id = $1`,
      [engagementId, workflowInstanceId, SUB_SECTION_KEY.caro, FRAMEWORK_AREA_KEY.caro],
    );
    const r = rows[0];
    const isCompany = r?.category ? r.category === 'company' : null;
    let isPublicCompany: boolean | null = null;
    let publicCompanySource: string | null = null;
    if (isCompany === false) {
      isPublicCompany = false;
      publicCompanySource = 'Entity master — not a company';
    } else if (r?.slug === 'public_limited') {
      isPublicCompany = true;
      publicCompanySource = 'Entity master — public limited company';
    } else if (r?.slug === 'private_limited' || r?.slug === 'opc') {
      if (r.public_group === true) {
        publicCompanySource =
          '02.4 records a public-company group relationship — confirm whether the company is a deemed public company (Section 2(71) proviso) by overriding the Section 197(16) card';
      } else {
        isPublicCompany = false;
        publicCompanySource = `Entity master — ${r.slug === 'opc' ? 'one person company' : 'private company'}`;
      }
    } else if (isCompany) {
      publicCompanySource = 'Company type not recorded on the entity master';
    }

    const periodStart = r?.financial_year
      ? auditPeriodStartFromFinancialYear(r.financial_year)
      : null;
    const on = periodStart ?? new Date().toISOString().slice(0, 10);
    const trailProv = await this.rules.resolveProvisionOn(client, P.rule11g, on);
    const rule11 = await this.rules.resolveProvisionOn(client, P.rule11, on);

    const [fraud, directors, crossRefs, evidenceCounts] = [
      await fraudFrameworkStatusOn(client, workflowInstanceId, on),
      await directorDisqualificationStatusOn(client, workflowInstanceId),
      await reportingCrossRefsOn(client, workflowInstanceId),
      await reportingEvidenceCountsOn(client, workflowInstanceId),
    ];

    return {
      facts: {
        ...captured,
        isCompany,
        isPublicCompany,
        publicCompanySource,
        auditTrailInForce: trailProv != null,
        auditTrailEffectiveFrom: trailProv?.effectiveFrom ?? null,
        periodStart,
        rule11Version: rule11 ? { code: rule11.code, effectiveFrom: rule11.effectiveFrom } : null,
        fraud,
        directors,
        crossRefs,
        evidenceCounts,
        scheduleVBands: [],
      },
      upstreamReady: isCompany != null,
    };
  }

  /** A file linked to 02.7 (the shared Section 02 evidence table) counts as supporting evidence. */
  private async hasEvidenceFile(client: PoolClient, subassessmentId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM hsdg.audit_framework_files
        WHERE subassessment_id = $1 AND removed_at IS NULL LIMIT 1`,
      [subassessmentId],
    );
    return (rowCount ?? 0) > 0;
  }
}

function stale(): ConflictException {
  return new ConflictException('This assessment changed since you loaded it; refresh and retry.');
}

function legacyBasis(isCompany: boolean | null, otherReportingBasis: string | null): string {
  const head =
    isCompany === true
      ? 'Company audit — auditor reporting under Sec 143 / Rule 11 applies.'
      : isCompany === false
        ? 'Not a company — auditor reporting under the Companies Act does not apply.'
        : 'Entity type unknown — confirm auditor-reporting applicability.';
  return otherReportingBasis ? `${head} 02.7 reporting matrix: ${otherReportingBasis}` : head;
}

/** Stable ids on every register row (cards, evidence and MRL links key off them). */
function assignIds(f: OtherReportingCapturedFacts): OtherReportingCapturedFacts {
  return {
    ...f,
    softwareSystems: f.softwareSystems.map((s) =>
      s.id && !/^sys-\d+$/.test(s.id) ? s : { ...s, id: randomUUID() },
    ),
    managerialPersons: f.managerialPersons.map((p) =>
      p.id && !/^mp-\d+$/.test(p.id) ? p : { ...p, id: randomUUID() },
    ),
  };
}

function validOverrides(
  raw: SetOtherReportingFactsInput['applicabilityOverrides'],
  current: OtherReportingCapturedFacts['applicabilityOverrides'],
): OtherReportingCapturedFacts['applicabilityOverrides'] {
  if (raw === undefined) return current;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new BadRequestException('applicabilityOverrides must be an object keyed by card.');
  const next: Partial<Record<ReportingCardKey, ReportingApplicabilityOverride>> = { ...current };
  for (const [key, value] of Object.entries(raw)) {
    if (!CARD_KEYS.has(key)) throw new BadRequestException(`Unknown requirement card: ${key}.`);
    const k = key as ReportingCardKey;
    if (value === null) {
      delete next[k];
      continue;
    }
    const v = value as Partial<ReportingApplicabilityOverride>;
    if (!v || typeof v !== 'object' || !APPLICABILITIES.has(v.applicability as string))
      throw new BadRequestException(`Choose a valid applicability for ${key}.`);
    const reason = typeof v.reason === 'string' ? v.reason.trim() : '';
    if (!reason) throw new BadRequestException(`Give the reason for overriding ${key}.`);
    if (reason.length > 4000) throw new BadRequestException('The reason is too long.');
    next[k] = { applicability: v.applicability as ReportingApplicability, reason };
  }
  return next;
}

/** Merge a facts input over the current captured facts (omitted = unchanged). */
export function mergeInput(
  c: OtherReportingCapturedFacts,
  input: SetOtherReportingFactsInput,
): OtherReportingCapturedFacts {
  const opt = <T>(v: T | undefined, cur: T): T => (v !== undefined ? v : cur);
  const names = (input.softwareSystems ?? []).map((s) => s.name.trim().toLowerCase());
  if (new Set(names).size !== names.length)
    throw new BadRequestException('Each accounting system can be listed once.');
  const merged: OtherReportingCapturedFacts = {
    ...c,
    softwareSystems: input.softwareSystems
      ? input.softwareSystems.map((s) => ({
          ...s,
          name: s.name.trim(),
          // Keep the legacy booleans in step with the register (older readers use them).
          hasAuditTrailFeature: s.featureStatus
            ? s.featureStatus === 'available'
            : !!s.hasAuditTrailFeature,
          auditTrailOperatedAllYear: s.enabledThroughout
            ? s.enabledThroughout === 'yes'
            : !!s.auditTrailOperatedAllYear,
        }))
      : c.softwareSystems,
    managerialRemunerationPaid: opt(input.managerialRemunerationPaid, c.managerialRemunerationPaid),
    section198NetProfit: opt(input.section198NetProfit, c.section198NetProfit),
    hasManagingOrWholeTimeDirector: opt(
      input.hasManagingOrWholeTimeDirector,
      c.hasManagingOrWholeTimeDirector,
    ),
    managerialPersons: input.managerialPersons
      ? input.managerialPersons.map((p) => ({ ...p, name: p.name.trim() }))
      : c.managerialPersons,
    approvals: input.approvals ? { ...c.approvals, ...input.approvals } : c.approvals,
    effectiveCapital: opt(input.effectiveCapital, c.effectiveCapital),
    inadequateProfits: opt(input.inadequateProfits, c.inadequateProfits),
    fraudIdentified: opt(input.fraudIdentified, c.fraudIdentified),
    fraudAmount: opt(input.fraudAmount, c.fraudAmount),
    fraudEventDate: opt(input.fraudEventDate, c.fraudEventDate),
    rule11eAdvanced: input.rule11eAdvanced
      ? { ...c.rule11eAdvanced, ...input.rule11eAdvanced }
      : c.rule11eAdvanced,
    rule11eReceived: input.rule11eReceived
      ? { ...c.rule11eReceived, ...input.rule11eReceived }
      : c.rule11eReceived,
    litigation: input.litigation ? { ...c.litigation, ...input.litigation } : c.litigation,
    foreseeableLosses: input.foreseeableLosses
      ? { ...c.foreseeableLosses, ...input.foreseeableLosses }
      : c.foreseeableLosses,
    iepf: input.iepf ? { ...c.iepf, ...input.iepf } : c.iepf,
    dividend: input.dividend ? { ...c.dividend, ...input.dividend } : c.dividend,
    booksProper: opt(input.booksProper, c.booksProper),
    informationObtained: opt(input.informationObtained, c.informationObtained),
    adverseObservations: opt(input.adverseObservations, c.adverseObservations),
    accountsQualification: opt(input.accountsQualification, c.accountsQualification),
    applicabilityOverrides: validOverrides(input.applicabilityOverrides, c.applicabilityOverrides),
  };
  // The legacy flags follow the structured facts (older readers / prefill use them).
  const a = merged.rule11eAdvanced;
  const r = merged.rule11eReceived;
  merged.intermediaryFundsAdvanced = opt(
    input.intermediaryFundsAdvanced,
    a.transactionsIdentified === 'yes',
  );
  merged.ultimateBeneficiaryFundsReceived = opt(
    input.ultimateBeneficiaryFundsReceived,
    r.transactionsIdentified === 'yes',
  );
  merged.fundingRepresentationsObtained = opt(
    input.fundingRepresentationsObtained,
    a.representationObtained === 'yes' && r.representationObtained === 'yes',
  );
  merged.dividendCompliesSec123 = opt(
    input.dividendCompliesSec123,
    merged.dividend.section123Compliant === 'pending'
      ? null
      : merged.dividend.section123Compliant === 'yes',
  );
  merged.pendingLitigationDisclosed = opt(
    input.pendingLitigationDisclosed,
    merged.litigation.disclosure === 'pending' ? null : merged.litigation.disclosure === 'disclosed',
  );
  merged.foreseeableLossesProvided = opt(
    input.foreseeableLossesProvided,
    merged.foreseeableLosses.provisionAdequate === 'pending'
      ? null
      : merged.foreseeableLosses.provisionAdequate === 'yes',
  );
  merged.iepfTransferDelay = opt(
    input.iepfTransferDelay,
    merged.iepf.status === 'pending' || merged.iepf.status === 'not_applicable'
      ? null
      : merged.iepf.status === 'delay',
  );
  return assignIds(normaliseCaptured({ ...EMPTY_OTHER_REPORTING_CAPTURED, ...merged }));
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

function liveAssessment(r: SubRow, res: OtherReportingResult): FrameworkSubAssessment {
  return {
    ...mapAssessment(r),
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
    decidedByName: null,
    decidedAt: null,
  };
}

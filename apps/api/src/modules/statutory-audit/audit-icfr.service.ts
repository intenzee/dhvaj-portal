import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CONSOLIDATION_OUTCOME,
  FRAMEWORK_AREA_KEY,
  FRAMEWORK_DECIDED_STATES,
  ICFR_BORROWING_DATA_BASES,
  ICFR_BORROWING_SOURCES,
  ICFR_CONCLUSIONS,
  ICFR_OUTCOME,
  ICFR_PROFESSIONAL_ACTION,
  ICFR_PROVISION_CODE,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type FrameworkConclusion,
  type FrameworkState,
  type FrameworkSubAssessment,
  type IcfrCapturedFacts,
  type IcfrDetail,
  type IcfrFacts,
  type IcfrOutcome,
  type IcfrPriorYear,
  type IcfrProfessionalAction,
  type IcfrReevaluationChange,
  type IcfrResult,
  type PartnerApproveIcfrInput,
  type RecordIcfrDecisionInput,
  type SetIcfrFactsInput,
  type StatutoryAuditIcfr,
  type StatutoryAuditIcfrMasterFillResult,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import {
  calendarFilings,
  fillIcfr,
  icfrFromSources,
  precedingFinancialYear,
} from './framework-facts-prefill';
import { isEngagementLead, readEngagementMasterFacts, readReportingSources } from './master-facts';
import { AuditMattersService } from './audit-matters.service';
import { AuditProfileService } from './audit-profile.service';
import { assessIcfr } from './icfr';
import {
  affectedRulesFor,
  icfrCompletion,
  icfrPartnerApprovalReason,
  isIcfrDecided as isDecided,
  legacyMirror,
} from './icfr-completion';
import { icfrBlockingMatterOpen, icfrDownstreamStatusOn } from './icfr-read';

const SUB = SUB_SECTION_KEY.icfr;
const AREA = FRAMEWORK_AREA_KEY.ifc;
const TITLE = 'Internal Financial Controls / ICFR Reporting';
const A = ICFR_PROFESSIONAL_ACTION;

/** Outcomes the system can decisively suggest (so a differing conclusion is an override). */
const DECISIVE = new Set<string>([ICFR_OUTCOME.applicable, ICFR_OUTCOME.exempt]);

const DEFAULT_CAPTURED: IcfrCapturedFacts = {
  peakCoveredBorrowings: null,
  filingDefault: null,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: IcfrDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: Partial<IcfrCapturedFacts> | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
  financial_year: string | null;
  entity_id: string;
  professional_action: IcfrProfessionalAction | null;
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
 * 02.5 Internal Financial Controls / ICFR Reporting service (Guide §9.5; DHVAJ
 * 02.5 spec v1.1). Assembles the classification and OPC / Small Company results
 * from 02.1 (never recomputed), the CFS scope from 02.6, turnover from the
 * latest audited financial statements and the §137 / §92 filings from the
 * compliance calendar; captures IFC-01..03; runs the pure engine against the
 * Rules Library in force for the audit period; and records the IFC-04
 * conclusion (confirm / override with reason + technical basis + evidence /
 * information pending) with Engagement Partner approval of a significant
 * override. The legacy Section 02 "IFC" area mirrors this assessment, so
 * Section 05 activation, Section 08 Annexure B, planning and completion all read
 * one ICFR answer. Reuses the shared sub-assessment table (guide §6).
 */
@Injectable()
export class AuditIcfrService {
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

  async listForEngagement(ctx: RlsContext, engagementId: string): Promise<StatutoryAuditIcfr[]> {
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
  ): Promise<StatutoryAuditIcfr[]> {
    const { rows } = await client.query<SubRow>(
      `${ROW_SQL}
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
          AND ($4::uuid IS NULL OR s.workflow_instance_id = $4::uuid)
        ORDER BY swi.created_at ASC`,
      [engagementId, SUB, AREA, opts.workflowInstanceId ?? null],
    );

    const out: StatutoryAuditIcfr[] = [];
    for (const r of rows) {
      const fill = await this.masterFill(client, r.workflow_instance_id);
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
      let detail: IcfrDetail | null;
      let changes: IcfrReevaluationChange[] = [];
      if (decided) {
        // The frozen conclusion stays; a changed source fact is flagged and named
        // with the rules it feeds (spec §2) — the live suggestion shows beside it.
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

      const conclusion = decided ? (r.conclusion as IcfrOutcome | null) : null;
      const partnerReason = decided
        ? icfrPartnerApprovalReason({
            conclusion,
            systemOutcome: (r.system_outcome as IcfrOutcome | null) ?? null,
            isOverridden: r.is_overridden,
          })
        : null;
      const completion = icfrCompletion({
        detail,
        conclusion,
        decided,
        professionalAction: r.professional_action,
        partnerRequired: partnerReason != null,
        partnerApproved: r.partner_approved_at != null,
        needsReevaluation: r.needs_reevaluation,
        upstreamReady,
        blockingMatterOpen: await icfrBlockingMatterOpen(client, r.workflow_instance_id),
        started: r.professional_action != null || r.facts != null,
        downstream: await icfrDownstreamStatusOn(client, r.workflow_instance_id),
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
          live.outcome === ICFR_OUTCOME.furtherAssessment,
      });
    }
    return out;
  }

  private async readOne(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditIcfr> {
    const [icfr] = await this.read(client, engagementId, {
      workflowInstanceId,
      viewerEmployeeId: ctx.employeeId ?? null,
    });
    if (!icfr)
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    return icfr;
  }

  // ── Capture IFC-01 / IFC-02 / IFC-03 (spec §7–§9) ──────────────────────────

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetIcfrFactsInput,
  ): Promise<StatutoryAuditIcfr> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();

      const before = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      const merged: IcfrCapturedFacts = { ...before };
      const money = (k: 'peakCoveredBorrowings' | 'auditedTurnover') => {
        const v = input[k];
        if (v === undefined) return;
        if (v != null && (!Number.isFinite(v) || v < 0))
          throw new BadRequestException(`${k} must be a non-negative amount in rupees.`);
        merged[k] = v;
      };
      money('peakCoveredBorrowings');
      money('auditedTurnover');
      const text = (k: 'auditedTurnoverPeriod' | 'auditedTurnoverSource' | 'filingEvidence') => {
        const v = input[k];
        if (v !== undefined) merged[k] = v?.trim() || null;
      };
      text('auditedTurnoverPeriod');
      text('auditedTurnoverSource');
      text('filingEvidence');
      if (input.peakDate !== undefined) {
        if (input.peakDate != null && !ISO_DATE.test(input.peakDate))
          throw new BadRequestException('peakDate must be an ISO date.');
        merged.peakDate = input.peakDate;
      }
      if (input.borrowingDataBasis !== undefined) {
        if (
          input.borrowingDataBasis != null &&
          !ICFR_BORROWING_DATA_BASES.includes(input.borrowingDataBasis)
        )
          throw new BadRequestException(
            'Borrowing data basis must be daily, monthly, quarterly or year_end_only.',
          );
        merged.borrowingDataBasis = input.borrowingDataBasis;
      }
      if (input.borrowingSchedule !== undefined) {
        for (const p of input.borrowingSchedule ?? []) {
          if (!ISO_DATE.test(p.asOn ?? ''))
            throw new BadRequestException('Each borrowing balance needs an ISO date (asOn).');
          if (!p.lender?.trim())
            throw new BadRequestException('Each borrowing balance needs the lender.');
          if (!ICFR_BORROWING_SOURCES.includes(p.source))
            throw new BadRequestException(
              'source must be bank, financial_institution, body_corporate or other.',
            );
          if (!Number.isFinite(p.amount) || p.amount < 0)
            throw new BadRequestException('Each borrowing balance needs a non-negative amount.');
        }
        merged.borrowingSchedule = input.borrowingSchedule?.length
          ? input.borrowingSchedule.map((p) => ({
              asOn: p.asOn,
              lender: p.lender.trim(),
              source: p.source,
              amount: p.amount,
            }))
          : null;
      }
      if (input.filings !== undefined) {
        for (const f of input.filings ?? []) {
          if (!f.form?.trim()) throw new BadRequestException('Each filing needs the form.');
          if (f.section !== '137' && f.section !== '92')
            throw new BadRequestException('Each filing section must be 137 or 92.');
          for (const d of [f.dueDate, f.filedOn])
            if (d != null && !ISO_DATE.test(d))
              throw new BadRequestException('Filing dates must be ISO dates.');
          if (!f.dueDate)
            throw new BadRequestException('Each filing needs its due date for traceability.');
        }
        merged.filings = input.filings?.length
          ? input.filings.map((f) => ({
              form: f.form.trim(),
              section: f.section,
              period: f.period?.trim() || null,
              dueDate: f.dueDate ?? null,
              filedOn: f.filedOn ?? null,
              srn: f.srn?.trim() || null,
              source: f.source ?? 'manual',
              note: f.note?.trim() || null,
            }))
          : null;
      }
      if (input.filingDefault !== undefined) merged.filingDefault = input.filingDefault;

      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1`,
        [row.id, JSON.stringify(merged)],
      );
      if (!isDecided(row.state, row.conclusion))
        await this.persistSuggestion(client, engagementId, row.id, merged);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        before: before as unknown as Record<string, unknown>,
        after: merged as unknown as Record<string, unknown>,
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Fill from the client master and portal records (Guide §1) ──────────────

  /** What the portal already knows for 02.5, or null when the shell is gone. */
  private async masterFill(client: PoolClient, workflowInstanceId: string) {
    const master = await readEngagementMasterFacts(client, workflowInstanceId);
    if (!master) return null;
    const src = await readReportingSources(client, workflowInstanceId);
    return icfrFromSources(master, src.rocFilings, new Date().toISOString().slice(0, 10));
  }

  /**
   * First open by a lead fills the never-touched 02.5 facts from the portal
   * and runs the engine. One-shot: only rows whose facts were never stored, so
   * the team's later edits are never refilled. Public so the 02.9 summary can
   * trigger it too.
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
      const fill = await this.masterFill(client, r.workflow_instance_id);
      if (!fill) continue;
      const { next, filled } = fillIcfr({ ...DEFAULT_CAPTURED }, fill);
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1 AND facts IS NULL`,
        [r.id, JSON.stringify(next)],
      );
      await this.persistSuggestion(client, engagementId, r.id, next);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_prefilled',
        objectType: 'audit_framework_subassessment',
        objectId: r.id,
        after: { filled, automatic: true },
      });
    }
  }

  /** "Fill from client master": fills blanks only; never overwrites the team. */
  async fillFromMaster(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditIcfrMasterFillResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const fill = await this.masterFill(client, workflowInstanceId);
      if (!fill) throw new NotFoundException('Statutory-audit workflow not found.');
      const { next, filled } = fillIcfr({ ...DEFAULT_CAPTURED, ...(row.facts ?? {}) }, fill);
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
          action: 'statutory_audit.icfr_prefilled',
          objectType: 'audit_framework_subassessment',
          objectId: row.id,
          after: { filled },
        });
      }
      return { icfr: await this.readOne(client, ctx, engagementId, workflowInstanceId), filled };
    });
  }

  // ── Run the suggestion engine ───────────────────────────────────────────────

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditIcfr> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      await this.persistSuggestion(client, engagementId, row.id, captured);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.icfr_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── IFC-04 professional conclusion (spec §11) ──────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordIcfrDecisionInput,
  ): Promise<StatutoryAuditIcfr> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.recordDecisionOn(client, ctx, engagementId, workflowInstanceId, input);
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  /**
   * IFC-04 inside the caller's transaction (the legacy Section 02 decision
   * routes here so both records always agree). Stores the system result and the
   * professional conclusion separately, freezes the detail, mirrors the
   * Section 02 area and reconciles Framework Matters.
   */
  async recordDecisionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordIcfrDecisionInput,
  ): Promise<void> {
    const row = await this.loadRow(client, engagementId, workflowInstanceId);
    this.assertNotApproved(row);
    if (row.version !== input.version) throw stale();

    const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
    const { facts } = await this.assembleFacts(client, engagementId, workflowInstanceId, captured);
    const res = await this.runEngine(client, engagementId, facts);

    const action: IcfrProfessionalAction =
      input.action ??
      (input.conclusion && input.conclusion !== res.outcome ? A.override : A.confirm);

    if (action === A.informationPending) {
      const reason = input.pendingReason?.trim();
      const blocking = (res.detail.missingFacts ?? []).map((m) => m.label);
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
        action: 'statutory_audit.icfr_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { action, pendingReason: reason ?? null, blockingFacts: blocking },
      });
      await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
      return;
    }

    let conclusion: IcfrOutcome;
    if (action === A.confirm) {
      if (!DECISIVE.has(res.outcome))
        throw new BadRequestException(
          'The system could not determine ICFR reporting applicability — override with a conclusion, reason, technical basis and supporting evidence, or mark Information Pending.',
        );
      if (input.conclusion && input.conclusion !== res.outcome)
        throw new BadRequestException(
          'Confirm takes the system assessment; use Override to change it.',
        );
      conclusion = res.outcome;
    } else {
      if (!input.conclusion || !ICFR_CONCLUSIONS.includes(input.conclusion))
        throw new BadRequestException(
          'Select the final conclusion: Reporting Applicable, Reporting Exempt or Further Assessment Required.',
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
          'An override needs supporting evidence — describe it or link a file to 02.5.',
        );
    }
    const state: FrameworkState = isOverridden
      ? 'overridden'
      : conclusion === ICFR_OUTCOME.exempt
        ? 'not_applicable'
        : conclusion === ICFR_OUTCOME.furtherAssessment
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
      action: 'statutory_audit.icfr_decision',
      objectType: 'audit_framework_subassessment',
      objectId: row.id,
      before: { systemOutcome: res.outcome, conclusion: row.conclusion },
      after: { action, conclusion, isOverridden, basis, technicalBasis, supportingEvidence },
    });
    await this.syncLegacyOn(client, ctx, engagementId, workflowInstanceId);
  }

  // ── IFC-04 Engagement Partner approval ─────────────────────────────────────

  async partnerApprove(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: PartnerApproveIcfrInput,
  ): Promise<StatutoryAuditIcfr> {
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
        action: 'statutory_audit.icfr_partner_approved',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { reason: live.partnerApproval.reason, note: input.note ?? null },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Legacy Section 02 "IFC" mirror (spec §22) ──────────────────────────────

  /**
   * The Section 02 "IFC" area's suggestion, taken from the 02.5 engine (the old
   * "any company → applicable" branch in framework-suggestions.ts is retired).
   * Seeds / prefills 02.5 first so the area never shows a different answer.
   */
  async legacySuggestionOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ suggestion: FrameworkConclusion | null; basis: string; state: FrameworkState }> {
    await this.seedOn(client, workflowInstanceId, engagementId);
    await this.prefillOn(client, ctx, engagementId);
    const { rows } = await client.query<{ facts: Partial<IcfrCapturedFacts> | null }>(
      `SELECT facts FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB, AREA],
    );
    const captured = { ...DEFAULT_CAPTURED, ...(rows[0]?.facts ?? {}) };
    const { facts } = await this.assembleFacts(client, engagementId, workflowInstanceId, captured);
    const res = await this.runEngine(client, engagementId, facts);
    const m = legacyMirror(res.outcome, null, false);
    return { suggestion: m.suggestion, basis: `02.5 ICFR: ${res.basis}`, state: m.state };
  }

  /**
   * Bulk "Accept suggestions" on the Section 02 list: confirm a decisive 02.5
   * system assessment (the same as IFC-04 Confirm). Returns whether it decided.
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
   * A Section 02 list decision on the IFC area (kept for API compatibility):
   * recorded as the IFC-04 conclusion so the two never differ. A differing
   * conclusion is an override carrying the list's basis as its reason,
   * technical basis and evidence note — the 02.5 workspace is the full path.
   */
  async decideFromFrameworkOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { conclusion: FrameworkConclusion; basis?: string | null; impact?: string | null },
  ): Promise<void> {
    const row = await this.loadRow(client, engagementId, workflowInstanceId);
    const conclusion: IcfrOutcome =
      input.conclusion === 'applicable' ? ICFR_OUTCOME.applicable : ICFR_OUTCOME.exempt;
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

  /** Write the 02.5 state onto the Section 02 "IFC" area (never an approved one). */
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
      (s.system_outcome as IcfrOutcome | null) ?? ICFR_OUTCOME.informationInsufficient,
      isDecided(s.state, s.conclusion) ? (s.conclusion as IcfrOutcome | null) : null,
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
        WHERE workflow_instance_id = $1 AND area_key = 'ifc' AND state <> 'approved'`,
      [
        workflowInstanceId,
        m.suggestion,
        s.system_basis ? `02.5 ICFR: ${s.system_basis}` : null,
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

  /**
   * Run the pure engine (rules resolved by audit period START) and freeze the
   * provision: the MCA private-company exemption notification resolved by audit
   * period END for a private company tested under it, else §143(3)(i).
   */
  private async runEngine(
    client: PoolClient,
    engagementId: string,
    facts: IcfrFacts,
  ): Promise<IcfrResult> {
    const { start, end } = await this.auditPeriod(client, engagementId);
    const resolve = await this.rules.buildResolverOn(client, start);
    const res = assessIcfr(facts, resolve);
    if (res.outcome === ICFR_OUTCOME.applicable || res.outcome === ICFR_OUTCOME.exempt) {
      const viaNotification =
        res.detail.notificationVersion != null
          ? await this.rules.resolveProvisionOn(
              client,
              ICFR_PROVISION_CODE.exemptionNotification,
              end,
            )
          : null;
      const prov =
        viaNotification ??
        (await this.rules.resolveProvisionOn(client, ICFR_PROVISION_CODE.section143_3_i, start));
      res.authorityProvisionId = prov?.id ?? null;
    }
    return res;
  }

  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    captured: IcfrCapturedFacts,
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
        'The framework is approved; a controlled reassessment must reopen it before editing 02.5.',
      );
    }
  }

  /** Assemble the base facts from 02.1 + 02.6 + financial data + filings + captured facts. */
  private async assembleFacts(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    captured: IcfrCapturedFacts,
  ): Promise<{ facts: IcfrFacts; upstreamReady: boolean }> {
    let isCompany: boolean | null = null;
    let isPrivateCompany: boolean | null = null;
    let isOpc: boolean | null = null;
    const type = await client.query<{ slug: string; category: string; financial_year: string }>(
      `SELECT et.slug, et.category, e.financial_year
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

    const profile = await client.query<{ state: string }>(
      `SELECT state FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const p = profile.rows[0];
    const profileConfirmed = p?.state === 'confirmed';

    // 02.1's final §2(85) conclusion (override wins) — consumed, never recomputed.
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
    }>(
      `SELECT state, conclusion, system_outcome
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

    const fy = type.rows[0]?.financial_year ?? null;
    const turnover = await this.turnover(client, engagementId, fy, captured);
    const today = new Date().toISOString().slice(0, 10);
    const filings = captured.filings?.length
      ? captured.filings
      : calendarFilings(
          (await readReportingSources(client, workflowInstanceId)).rocFilings,
          fy ? auditPeriodStartFromFinancialYear(fy) : null,
        );

    return {
      facts: {
        isCompany,
        isPrivateCompany,
        isOpc,
        isSmallCompany,
        smallCompanyBasis,
        turnover: turnover.amount,
        turnoverPeriod: turnover.period,
        turnoverSource: turnover.source,
        turnoverAudited: turnover.audited,
        borrowingSchedule: captured.borrowingSchedule ?? null,
        borrowingDataBasis: captured.borrowingDataBasis ?? null,
        peakCoveredBorrowings: captured.peakCoveredBorrowings,
        peakDate: captured.peakDate ?? null,
        filings,
        filingDefault: captured.filingDefault ?? null,
        filingEvidence: captured.filingEvidence ?? null,
        today,
        cfsInScope,
        cfsBasis,
      },
      upstreamReady: profileConfirmed,
    };
  }

  /**
   * IFC-01 turnover per the latest audited financial statements (spec §7):
   * the team's audited figure, else the 02.1 preceding-year comparative, else a
   * 02.1 current figure marked audited, else the preceding year's audited
   * financial profile. A provisional / unaudited figure is surfaced but never
   * accepted (the engine keeps the test Pending).
   */
  private async turnover(
    client: PoolClient,
    engagementId: string,
    fy: string | null,
    captured: IcfrCapturedFacts,
  ): Promise<{
    amount: number | null;
    period: string | null;
    source: string | null;
    audited: boolean | null;
  }> {
    const prevFy = fy ? precedingFinancialYear(fy) : null;
    if (captured.auditedTurnover != null)
      return {
        amount: captured.auditedTurnover,
        period: captured.auditedTurnoverPeriod ?? prevFy,
        source: `02.5 IFC-01 — ${captured.auditedTurnoverSource ?? 'audited financial statements (team entry)'}`,
        audited: true,
      };
    const prof = await client.query<{
      current_value: string | null;
      prior_value: string | null;
      source: string | null;
    }>(
      `SELECT f.current_value::text, f.prior_value::text, f.source
         FROM hsdg.audit_profile_financials f
         JOIN hsdg.audit_entity_profile p ON p.id = f.profile_id
         JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
        WHERE swi.engagement_id = $1 AND f.parameter = 'turnover'
        LIMIT 1`,
      [engagementId],
    );
    const pr = prof.rows[0];
    const prior = num(pr?.prior_value ?? null);
    if (prior != null)
      return {
        amount: prior,
        period: prevFy,
        source: '02.1 financial data — preceding-year audited comparative',
        audited: true,
      };
    const current = num(pr?.current_value ?? null);
    if (current != null && pr?.source === 'audited_financials')
      return {
        amount: current,
        period: fy,
        source: '02.1 financial data — audited financial statements',
        audited: true,
      };
    if (prevFy) {
      const fin = await client.query<{ turnover: string | null; source: string }>(
        `SELECT COALESCE(fp.turnover, fp.revenue)::text AS turnover, fp.source
           FROM hsdg.entity_financial_profiles fp
           JOIN hsdg.engagements e ON e.entity_id = fp.entity_id
          WHERE e.id = $1 AND fp.financial_year = $2
          ORDER BY fp.created_at DESC
          LIMIT 1`,
        [engagementId, prevFy],
      );
      const f = fin.rows[0];
      const amount = num(f?.turnover ?? null);
      if (amount != null)
        return {
          amount,
          period: prevFy,
          source: `Client financial profile ${prevFy} (${f!.source.replace(/_/g, ' ')})`,
          audited: f!.source === 'audited_financials',
        };
    }
    if (current != null)
      return {
        amount: current,
        period: fy,
        source: `02.1 financial data — current year${pr?.source ? ` (${pr.source.replace(/_/g, ' ')})` : ''}`,
        audited: false,
      };
    return { amount: null, period: prevFy, source: null, audited: null };
  }

  private async auditPeriod(
    client: PoolClient,
    engagementId: string,
  ): Promise<{ start: string; end: string }> {
    const fy = await client.query<{ financial_year: string }>(
      `SELECT financial_year FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    const start = fy.rows[0]
      ? auditPeriodStartFromFinancialYear(fy.rows[0].financial_year)
      : new Date().toISOString().slice(0, 10);
    return { start, end: `${Number(start.slice(0, 4)) + 1}-03-31` };
  }

  /** A file linked to 02.5 (the shared Section 02 evidence table) counts as supporting evidence. */
  private async hasEvidenceFile(client: PoolClient, subassessmentId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM hsdg.audit_framework_files
        WHERE subassessment_id = $1 AND removed_at IS NULL LIMIT 1`,
      [subassessmentId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Prior-year ICFR applicability — context only; the current year always reruns (spec §19). */
  private async priorYear(
    client: PoolClient,
    r: SubRow,
    current: IcfrDetail,
  ): Promise<IcfrPriorYear | null> {
    if (!r.financial_year) return null;
    const { rows } = await client.query<{
      workflow_instance_id: string;
      financial_year: string;
      conclusion: string | null;
      system_outcome: string | null;
      is_overridden: boolean;
      system_basis: string | null;
      basis: string | null;
      system_detail: IcfrDetail | null;
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
    const outcome = (p.conclusion ?? p.system_outcome) as IcfrOutcome | null;
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
        outcome === ICFR_OUTCOME.exempt
          ? (p.system_detail?.exemptionReason ?? p.basis ?? p.system_basis)
          : null,
      decidedAt: p.decided_at ? p.decided_at.toISOString() : null,
      changedFacts: changed,
    };
  }
}

function stale(): ConflictException {
  return new ConflictException('This assessment changed since you loaded it; refresh and retry.');
}

/** Source facts that differ between a frozen detail and the live one (spec §2, §19). */
function factChanges(frozen: IcfrDetail | null, live: IcfrDetail): IcfrReevaluationChange[] {
  const before = new Map((frozen?.factsUsed ?? []).map((f) => [f.key, f]));
  const out: IcfrReevaluationChange[] = [];
  for (const f of live.factsUsed ?? []) {
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

function liveAssessment(r: SubRow, res: IcfrResult): FrameworkSubAssessment {
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

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

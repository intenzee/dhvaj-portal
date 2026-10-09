import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  COMPARATIVES_STATUSES,
  CONSOLIDATION_OUTCOME,
  FRAMEWORK_AREA_KEY,
  FRAMEWORK_DECIDED_STATES,
  REPORTING_FRAMEWORK_CONCLUSIONS,
  SCH_ANSWERS,
  SCH_PROFESSIONAL_ACTION,
  SCH_PROVISION_CODE,
  SCHEDULE_III_CONCLUSIONS,
  SCHEDULE_III_OUTCOME,
  SPECIALISED_EFFECTS,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type DisclosureCategory,
  type DisclosureTrigger,
  type FrameworkState,
  type FrameworkSubAssessment,
  type PartnerApproveScheduleIiiInput,
  type RecordScheduleIiiDecisionInput,
  type ReportingFrameworkOutcome,
  type SchProfessionalAction,
  type ScheduleIiiApprovedResult,
  type ScheduleIiiCapturedFacts,
  type ScheduleIiiDetail,
  type ScheduleIiiFacts,
  type ScheduleIiiFrameworkVersion,
  type ScheduleIiiOutcome,
  type ScheduleIiiResult,
  type ScheduleIiiSpecialisedRule,
  type SetScheduleIiiFactsInput,
  type SpecialisedEffect,
  type StatutoryAuditScheduleIii,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { readFinancialReportingResult } from './financial-reporting-result';
import {
  assessScheduleIii,
  scheduleIiiCompletion,
  type ScheduleIiiComponentSpec,
  type ScheduleIiiContext,
  type ScheduleIiiLibrary,
  type ScheduleIiiRequirementRow,
} from './schedule-iii';

const SUB = SUB_SECTION_KEY.scheduleIii;
const AREA = FRAMEWORK_AREA_KEY.scheduleIii;
const TITLE = 'Schedule III & Presentation Framework';

/** Outcomes the system can decisively suggest (so a differing conclusion is an override). */
const DECISIVE = new Set<string>(SCHEDULE_III_CONCLUSIONS);

/** Audit-area codes (03.5 library) whose presence answers a disclosure trigger. */
const AREA_TRIGGERS: Array<{ trigger: DisclosureTrigger; codes: string[] }> = [
  { trigger: 'ppe_exists', codes: ['PPE', 'CWIP'] },
  { trigger: 'immovable_property_exists', codes: ['PPE'] },
  { trigger: 'intangibles_exist', codes: ['INTANG', 'GW'] },
  { trigger: 'borrowings_exist', codes: ['BORR'] },
  { trigger: 'loans_given', codes: ['LOANS'] },
  { trigger: 'investments_exist', codes: ['INVEST'] },
];

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: ScheduleIiiDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: ScheduleIiiCapturedFacts | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
  financial_year: string | null;
  professional_action: SchProfessionalAction | null;
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
         s.version, e.financial_year, s.professional_action, s.pending_reason,
         pemp.full_name AS partner_approved_by_name, s.partner_approved_at, s.partner_note,
         e.engagement_partner_id
    FROM hsdg.audit_framework_subassessment s
    JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
    JOIN hsdg.engagements e ON e.id = s.engagement_id
    LEFT JOIN hsdg.employees emp ON emp.id = s.decided_by_employee_id
    LEFT JOIN hsdg.employees pemp ON pemp.id = s.partner_approved_by_employee_id`;

interface Assembled {
  facts: ScheduleIiiFacts;
  upstreamReady: boolean;
  provisional: boolean;
  periodStart: string;
  entityTypeSlug: string | null;
  ctx: ScheduleIiiContext;
}

/**
 * 02.3 Schedule III & Presentation Framework service (Implementation Guide
 * §9.3; DHVAJ Section 02.3 spec). Assembles the facts from 02.1, 02.2, 02.6 and
 * the Section 02 CSR area (never re-asking one), loads the presentation library
 * in force for the audit period, runs the pure engine, freezes the
 * period-correct provisions, and records the SCH-02/04/05 answers, the SCH-06
 * conclusion and the Engagement Partner approval. Reuses the shared
 * sub-assessment table (guide §6).
 */
@Injectable()
export class AuditScheduleIiiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
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
  ): Promise<StatutoryAuditScheduleIii[]> {
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
      return this.read(client, engagementId, { viewerEmployeeId: ctx.employeeId ?? null });
    });
  }

  private async read(
    client: PoolClient,
    engagementId: string,
    opts: { workflowInstanceId?: string; viewerEmployeeId?: string | null } = {},
  ): Promise<StatutoryAuditScheduleIii[]> {
    const { rows } = await client.query<SubRow>(
      `${ROW_SQL}
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
          AND ($4::uuid IS NULL OR s.workflow_instance_id = $4::uuid)
        ORDER BY swi.created_at ASC`,
      [engagementId, SUB, AREA, opts.workflowInstanceId ?? null],
    );

    const out: StatutoryAuditScheduleIii[] = [];
    for (const r of rows) {
      const captured = r.facts ?? {};
      const a = await this.assembleFacts(client, engagementId, r.workflow_instance_id, r.id);

      let assessment: FrameworkSubAssessment;
      let detail: ScheduleIiiDetail | null;
      const decided = isDecided(r.state);
      if (decided && !r.needs_reevaluation) {
        assessment = mapAssessment(r);
        detail = r.system_detail;
      } else {
        // Undecided, or decided but flagged: show the live suggestion beside
        // the recorded conclusion so the team sees what changed.
        const res = await this.runEngine(client, a, captured);
        detail = res.detail;
        assessment = decided
          ? {
              ...mapAssessment(r),
              systemOutcome: res.outcome,
              systemBasis: res.basis,
              systemDetail: res.detail,
            }
          : {
              ...liveAssessment(r, res),
              state:
                r.professional_action === SCH_PROFESSIONAL_ACTION.informationPending
                  ? 'pending_information'
                  : res.state,
            };
      }

      const conclusion = decided ? (r.conclusion as ScheduleIiiOutcome | null) : null;
      const partnerReason = decided
        ? partnerApprovalReason(conclusion, assessment.systemOutcome, r.is_overridden)
        : null;
      const completion = scheduleIiiCompletion({
        detail,
        conclusion,
        professionalAction: r.professional_action,
        partnerRequired: partnerReason != null,
        partnerApproved: r.partner_approved_at != null,
        needsReevaluation: r.needs_reevaluation,
        started: r.professional_action != null || Object.keys(captured).length > 0,
      });
      const workbookOutcome = conclusion ?? null;
      out.push({
        workflowInstanceId: r.workflow_instance_id,
        engagementServiceId: r.engagement_service_id,
        engagementId: r.engagement_id,
        assessment,
        detail,
        baseFacts: a.facts,
        upstreamReady: a.upstreamReady,
        auditFinancialYear: r.financial_year ?? undefined,
        capturedFacts: captured,
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
        memoSuggested:
          r.is_overridden ||
          partnerReason != null ||
          r.professional_action === SCH_PROFESSIONAL_ACTION.informationPending ||
          detail?.sch01 === 'specialised_format' ||
          detail?.sch01 === 'further_assessment' ||
          detail?.blockingReview === true,
        workbookAvailable:
          a.upstreamReady &&
          workbookOutcome != null &&
          workbookOutcome !== SCHEDULE_III_OUTCOME.specialisedFormat &&
          !!detail?.frameworkVersion?.templateKey,
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
  ): Promise<StatutoryAuditScheduleIii> {
    const [sch] = await this.read(client, engagementId, {
      workflowInstanceId,
      viewerEmployeeId: ctx.employeeId ?? null,
    });
    if (!sch) throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    return sch;
  }

  /**
   * The 02.3 result as downstream work reads it (FS workbook, 02.6, completion):
   * the frozen conclusion when decided, else the live suggestion. Runs inside
   * the caller's RLS transaction.
   */
  async readResultOn(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<ScheduleIiiApprovedResult | null> {
    const { rows } = await client.query<{ engagement_id: string }>(
      `SELECT engagement_id FROM hsdg.service_workflow_instances WHERE id = $1`,
      [workflowInstanceId],
    );
    if (!rows[0]) return null;
    const [sch] = await this.read(client, rows[0].engagement_id, { workflowInstanceId });
    if (!sch) return null;
    const d = sch.detail;
    const decided = isDecided(sch.assessment.state);
    const slug = await client.query<{ slug: string }>(
      `SELECT et.slug
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE e.id = $1`,
      [sch.engagementId],
    );
    return {
      workflowInstanceId,
      outcome: ((decided ? sch.assessment.conclusion : sch.assessment.systemOutcome) ??
        null) as ScheduleIiiOutcome | null,
      decided,
      complete: sch.completion?.complete ?? false,
      approved: sch.approved ?? false,
      reportingFramework: sch.baseFacts.reportingFramework,
      frameworkVersion: d?.frameworkVersion ?? null,
      componentLines: d?.componentLines ?? [],
      cashFlowRequired: d?.cashFlowRequired ?? false,
      roundingUnit: d?.rounding?.selectedUnit ?? d?.rounding?.systemUnit ?? null,
      disclosureCodes: (d?.disclosureLibrary ?? [])
        .filter((x) => x.applicability !== 'not_triggered')
        .map((x) => x.code),
      cfsPresentationRequired: d?.cfsPresentationRequired ?? false,
      entityTypeSlug: slug.rows[0]?.slug ?? null,
      financialYear: sch.auditFinancialYear ?? null,
    };
  }

  /**
   * Store the live suggestion on every undecided 02.3 row of the engagement,
   * so the 02.9 summary shows the Division instead of "not assessed". Lead-only
   * writes (RLS); safe to repeat. Called by the summary after 02.1 / 02.2 fill.
   */
  async refreshOn(client: PoolClient, engagementId: string): Promise<void> {
    const { rows } = await client.query<{ id: string; workflow_instance_id: string }>(
      `SELECT s.id, s.workflow_instance_id
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
          AND swi.status <> 'cancelled'`,
      [engagementId, SUB, AREA],
    );
    for (const r of rows) {
      await this.persistSuggestion(client, engagementId, r.id, r.workflow_instance_id);
    }
  }

  // ── Run the suggestion engine (§9.3) ────────────────────────────────────────

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      await this.persistSuggestion(client, engagementId, row.id, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.schedule_iii_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── SCH-02 / SCH-04 / SCH-05 answers ────────────────────────────────────────

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetScheduleIiiFactsInput,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();

      const before = row.facts ?? {};
      const merged: ScheduleIiiCapturedFacts = { ...before };
      const keys: Array<keyof SetScheduleIiiFactsInput & keyof ScheduleIiiCapturedFacts> = [
        'specialisedAnswer',
        'governingAuthority',
        'frameworkName',
        'specialisedEffect',
        'specialisedVersion',
        'specialisedProvisionId',
        'specialisedReference',
        'comparativesStatus',
        'comparativesReason',
        'roundingUnit',
        'roundingReason',
      ];
      for (const k of keys) {
        if (input[k] === undefined) continue;
        const v = input[k];
        (merged as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() || null : v;
      }

      if (merged.specialisedAnswer != null && !SCH_ANSWERS.includes(merged.specialisedAnswer))
        throw new BadRequestException('SCH-02 must be yes, no or further_assessment.');
      if (
        merged.specialisedEffect != null &&
        !SPECIALISED_EFFECTS.includes(merged.specialisedEffect as SpecialisedEffect)
      )
        throw new BadRequestException('Effect must be replaces, modifies or supplements.');
      if (
        merged.comparativesStatus != null &&
        !COMPARATIVES_STATUSES.includes(merged.comparativesStatus)
      )
        throw new BadRequestException(
          'SCH-04 must be required, not_applicable or further_assessment.',
        );
      if (merged.specialisedProvisionId) {
        const p = await client.query(`SELECT 1 FROM hsdg.authority_provision WHERE id = $1`, [
          merged.specialisedProvisionId,
        ]);
        if (!p.rowCount)
          throw new BadRequestException(
            'The governing provision was not found in the Provision Library.',
          );
      }

      // Validate against the live assessment: units come from the rule version,
      // and a departure from the system needs a reason (spec §13, §14).
      const a = await this.assembleFacts(client, engagementId, workflowInstanceId, row.id);
      const res = await this.runEngine(client, a, merged);
      const rounding = res.detail.rounding;
      if (merged.roundingUnit != null) {
        if (!rounding || !rounding.permittedUnits.includes(merged.roundingUnit))
          throw new BadRequestException(
            `Choose a unit the applicable Schedule III version permits: ${(rounding?.permittedUnits ?? []).join(', ') || 'none resolved'}.`,
          );
        if (merged.roundingUnit !== rounding.systemUnit && !merged.roundingReason)
          throw new BadRequestException(
            'A reason is required to override the system rounding unit.',
          );
      }
      const comps = res.detail.comparatives;
      if (
        merged.comparativesStatus != null &&
        comps &&
        merged.comparativesStatus !== comps.system &&
        !merged.comparativesReason
      )
        throw new BadRequestException('A reason is required when SCH-04 differs from the system.');
      if (
        merged.specialisedAnswer != null &&
        res.detail.specialised &&
        merged.specialisedAnswer !== res.detail.specialised.systemSuggested &&
        !merged.specialisedReference
      )
        throw new BadRequestException(
          'Record the authoritative reference when SCH-02 differs from the system suggestion.',
        );

      // A decided 02.3 keeps its conclusion: refresh the frozen detail when the
      // route is unchanged; otherwise flag it for re-evaluation.
      const decided = isDecided(row.state);
      const sameRoute = decided && res.outcome === row.system_outcome;
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1,
                system_detail = CASE WHEN $3 THEN $4::jsonb ELSE system_detail END,
                system_basis  = CASE WHEN $3 THEN $5 ELSE system_basis END,
                needs_reevaluation = CASE WHEN $6 THEN true ELSE needs_reevaluation END
          WHERE id = $1`,
        [
          row.id,
          JSON.stringify(merged),
          sameRoute,
          JSON.stringify(res.detail),
          res.basis,
          decided && !sameRoute,
        ],
      );
      if (!decided) await this.persistSuggestion(client, engagementId, row.id, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.schedule_iii_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        before: before as Record<string, unknown>,
        after: merged as Record<string, unknown>,
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── SCH-06 professional conclusion ──────────────────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordScheduleIiiDecisionInput,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();

      const a = await this.assembleFacts(client, engagementId, workflowInstanceId, row.id);
      if (a.provisional) {
        throw new ConflictException(
          '02.3 is provisional until the 02.2 reporting framework is concluded — conclude 02.2 first.',
        );
      }
      const captured: ScheduleIiiCapturedFacts = { ...(row.facts ?? {}) };
      const res = await this.runEngine(client, a, captured);

      const action: SchProfessionalAction =
        input.action ??
        (input.conclusion && input.conclusion !== res.outcome
          ? SCH_PROFESSIONAL_ACTION.override
          : SCH_PROFESSIONAL_ACTION.confirm);

      if (action === SCH_PROFESSIONAL_ACTION.informationPending) {
        const reason = input.pendingReason?.trim();
        if (!reason)
          throw new BadRequestException('Say which information is pending (pendingReason).');
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
            reason,
            res.outcome,
            res.basis,
            JSON.stringify(res.detail),
            res.ruleVersionId,
            res.authorityProvisionId,
            ctx.employeeId ?? null,
          ],
        );
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.schedule_iii_decision',
          objectType: 'audit_framework_subassessment',
          objectId: row.id,
          after: {
            action,
            pendingReason: reason,
            blockingFacts: (res.detail.missingFacts ?? []).map((m) => m.label),
          },
        });
        return this.readOne(client, ctx, engagementId, workflowInstanceId);
      }

      let conclusion: ScheduleIiiOutcome;
      if (action === SCH_PROFESSIONAL_ACTION.confirm) {
        if (!DECISIVE.has(res.outcome))
          throw new BadRequestException(
            'The system could not determine the presentation framework — override with a framework, reason and technical basis, or mark Information Pending.',
          );
        if (input.conclusion && input.conclusion !== res.outcome)
          throw new BadRequestException(
            'Confirm takes the system assessment; use Override to change it.',
          );
        conclusion = res.outcome;
      } else {
        if (!input.conclusion || !SCHEDULE_III_CONCLUSIONS.includes(input.conclusion))
          throw new BadRequestException(
            'Select the presentation framework the override concludes.',
          );
        conclusion = input.conclusion;
        if (DECISIVE.has(res.outcome) && conclusion === res.outcome)
          throw new BadRequestException(
            'The override matches the system assessment — use Confirm.',
          );
      }
      const isOverridden = DECISIVE.has(res.outcome) && conclusion !== res.outcome;
      const basis = input.basis?.trim() || null;
      const technicalBasis = input.technicalBasis?.trim() || null;
      if (action === SCH_PROFESSIONAL_ACTION.override && (!basis || !technicalBasis))
        throw new BadRequestException(
          'An override needs the selected presentation framework, a reason and the technical basis.',
        );
      const state: FrameworkState = isOverridden ? 'overridden' : 'applicable';
      // The decision freezes the detail of the framework it concludes: when the
      // professional overrides to a Division, freeze that Division's library.
      const frozen =
        isOverridden || !DECISIVE.has(res.outcome)
          ? await this.runEngine(client, a, captured, conclusion)
          : res;

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
          JSON.stringify(frozen.detail),
          frozen.ruleVersionId,
          frozen.authorityProvisionId,
          ctx.employeeId ?? null,
          action === SCH_PROFESSIONAL_ACTION.override || isOverridden
            ? SCH_PROFESSIONAL_ACTION.override
            : SCH_PROFESSIONAL_ACTION.confirm,
          JSON.stringify({ ...captured, technicalBasis }),
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.schedule_iii_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        before: { systemOutcome: res.outcome, conclusion: row.conclusion },
        after: { action, conclusion, isOverridden, basis, technicalBasis },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── SCH-06 Engagement Partner approval ──────────────────────────────────────

  async partnerApprove(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: PartnerApproveScheduleIiiInput,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();
      if (!ctx.employeeId || ctx.employeeId !== row.engagement_partner_id)
        throw new ForbiddenException('Only the Engagement Partner can approve this conclusion.');
      const live = await this.readOne(client, ctx, engagementId, workflowInstanceId);
      if (!isDecided(live.assessment.state))
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
        action: 'statutory_audit.schedule_iii_partner_approved',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { reason: live.partnerApproval.reason, note: input.note ?? null },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /**
   * Run the pure engine against the library in force for the audit period and
   * freeze the period-correct provisions onto the result. `asOutcome` re-routes
   * to a professionally concluded Division so its library is what is frozen.
   */
  private async runEngine(
    client: PoolClient,
    a: Assembled,
    captured: ScheduleIiiCapturedFacts,
    asOutcome?: ScheduleIiiOutcome,
  ): Promise<ScheduleIiiResult> {
    const resolve = await this.rules.buildResolverOn(client, a.periodStart);
    const library = await this.loadLibrary(client, a.periodStart);
    let facts = a.facts;
    if (asOutcome === SCHEDULE_III_OUTCOME.divisionI)
      facts = {
        ...facts,
        reportingFramework: 'accounting_standards' as ReportingFrameworkOutcome,
        specialEntityTypes: [],
        isBankOrInsurance: false,
      };
    else if (
      asOutcome === SCHEDULE_III_OUTCOME.divisionII ||
      asOutcome === SCHEDULE_III_OUTCOME.divisionIII
    )
      facts = {
        ...facts,
        reportingFramework: 'ind_as' as ReportingFrameworkOutcome,
        isNbfc: asOutcome === SCHEDULE_III_OUTCOME.divisionIII,
        specialEntityTypes: [],
        isBankOrInsurance: false,
      };
    const engineCaptured =
      asOutcome === SCHEDULE_III_OUTCOME.specialisedFormat
        ? { ...captured, specialisedAnswer: captured.specialisedAnswer ?? ('yes' as const) }
        : asOutcome
          ? { ...captured, specialisedAnswer: 'no' as const }
          : captured;
    const res = assessScheduleIii(facts, resolve, library, engineCaptured, a.ctx);
    if (a.provisional) {
      res.basis = `Provisional — routed from the 02.2 system suggestion; conclude 02.2 to freeze it. ${res.basis}`;
    }
    await this.resolveProvisions(client, res, a.periodStart);
    return res;
  }

  /** Freeze provision ids (period-correct) onto every citation in the detail. */
  private async resolveProvisions(
    client: PoolClient,
    res: ScheduleIiiResult,
    periodStart: string,
  ): Promise<void> {
    const cache = new Map<string, string | null>();
    const id = async (code: string | null | undefined): Promise<string | null> => {
      if (!code) return null;
      if (!cache.has(code)) {
        const p = await this.rules.resolveProvisionOn(client, code, periodStart);
        cache.set(code, p?.id ?? null);
      }
      return cache.get(code) ?? null;
    };
    const d = res.detail;
    if (d.divisionProvisionCode) res.authorityProvisionId = await id(d.divisionProvisionCode);
    if (res.outcome === SCHEDULE_III_OUTCOME.specialisedFormat && d.specialised) {
      res.authorityProvisionId =
        d.specialised.provisionId ?? (await id(d.specialised.matchedRules[0]?.provisionCode));
    }
    if (d.cashFlow) {
      d.cashFlow.provisionId = await id(d.cashFlow.provisionCode);
      if (d.cashFlow.status === 'exempt') d.cashFlowProvisionId = d.cashFlow.provisionId;
    }
    if (d.rounding && d.division) d.rounding.provisionId = await id(SCH_PROVISION_CODE.rounding);
    for (const r of d.disclosureLibrary ?? []) r.provisionId = await id(r.provisionCode);
  }

  /** The presentation library in force on the audit-period start (spec §8). */
  private async loadLibrary(client: PoolClient, periodStart: string): Promise<ScheduleIiiLibrary> {
    const fv = await client.query<{
      id: string;
      framework_id: string;
      division: 'I' | 'II' | 'III';
      title: string;
      version_label: string;
      effective_from: string;
      effective_to: string | null;
      notification_reference: string | null;
      provision_code: string | null;
      guidance_provision_code: string | null;
      guidance_version: string | null;
      components: ScheduleIiiComponentSpec[];
      template_key: string | null;
    }>(
      `SELECT DISTINCT ON (division)
              id, framework_id, division, title, version_label,
              effective_from::text AS effective_from, effective_to::text AS effective_to,
              notification_reference, provision_code, guidance_provision_code, guidance_version,
              components, template_key
         FROM hsdg.schedule_iii_framework_version
        WHERE effective_from <= $1::date AND (effective_to IS NULL OR effective_to >= $1::date)
        ORDER BY division, effective_from DESC`,
      [periodStart],
    );
    const library: ScheduleIiiLibrary = {
      frameworkVersions: {},
      requirements: {},
      specialisedRules: [],
    };
    for (const v of fv.rows) {
      const prov = v.provision_code
        ? await this.rules.resolveProvisionOn(client, v.provision_code, periodStart)
        : null;
      const guide = v.guidance_provision_code
        ? await this.rules.resolveProvisionOn(client, v.guidance_provision_code, periodStart)
        : null;
      const version: ScheduleIiiFrameworkVersion = {
        id: v.id,
        frameworkId: v.framework_id,
        division: v.division,
        title: v.title,
        versionLabel: v.version_label,
        effectiveFrom: v.effective_from,
        effectiveTo: v.effective_to,
        notificationReference: v.notification_reference,
        provisionCode: v.provision_code,
        provisionId: prov?.id ?? null,
        guidanceProvisionCode: v.guidance_provision_code,
        guidanceProvisionId: guide?.id ?? null,
        guidanceVersion: v.guidance_version,
        templateKey: v.template_key,
        status: v.effective_to == null ? 'active' : 'superseded',
      };
      library.frameworkVersions[v.division] = { version, components: v.components ?? [] };
      const req = await client.query<{
        code: string;
        category: DisclosureCategory;
        label: string;
        description: string | null;
        trigger_fact: DisclosureTrigger | null;
        provision_code: string | null;
        cross_link: string | null;
        effective_from: string;
      }>(
        `SELECT code, category, label, description, trigger_fact, provision_code, cross_link,
                effective_from::text AS effective_from
           FROM hsdg.schedule_iii_disclosure_requirement
          WHERE framework_id = $1 AND effective_from <= $2::date
            AND (effective_to IS NULL OR effective_to >= $2::date)
          ORDER BY sort_order, code`,
        [v.framework_id, periodStart],
      );
      library.requirements[v.division] = req.rows.map((r): ScheduleIiiRequirementRow => ({
        code: r.code,
        category: r.category,
        label: r.label,
        description: r.description,
        trigger: r.trigger_fact,
        provisionCode: r.provision_code,
        crossLink: r.cross_link,
        effectiveFrom: r.effective_from,
      }));
    }
    const spec = await client.query<{
      code: string;
      entity_category: string;
      governing_authority: string;
      framework_name: string;
      effect: SpecialisedEffect;
      provision_code: string | null;
      effective_from: string;
    }>(
      `SELECT code, entity_category, governing_authority, framework_name, effect, provision_code,
              effective_from::text AS effective_from
         FROM hsdg.schedule_iii_specialised_format_rule
        WHERE effective_from <= $1::date AND (effective_to IS NULL OR effective_to >= $1::date)
        ORDER BY code`,
      [periodStart],
    );
    for (const s of spec.rows) {
      const prov = s.provision_code
        ? await this.rules.resolveProvisionOn(client, s.provision_code, periodStart)
        : null;
      library.specialisedRules.push({
        code: s.code,
        entityCategory: s.entity_category,
        governingAuthority: s.governing_authority,
        frameworkName: s.framework_name,
        effect: s.effect,
        provisionCode: s.provision_code,
        provisionId: prov?.id ?? null,
        effectiveFrom: s.effective_from,
      } satisfies ScheduleIiiSpecialisedRule);
    }
    return library;
  }

  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    // Never overwrite a professional conclusion (§19).
    const { rows } = await client.query<{
      state: FrameworkState;
      facts: ScheduleIiiCapturedFacts | null;
      professional_action: string | null;
    }>(
      `SELECT state, facts, professional_action FROM hsdg.audit_framework_subassessment WHERE id = $1`,
      [rowId],
    );
    if (rows[0] && isDecided(rows[0].state)) return;
    const a = await this.assembleFacts(client, engagementId, workflowInstanceId, rowId);
    const res = await this.runEngine(client, a, rows[0]?.facts ?? {});
    const keepPending = rows[0]?.professional_action === SCH_PROFESSIONAL_ACTION.informationPending;
    await client.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET system_outcome = $2, system_basis = $3, system_detail = $4::jsonb,
              rule_version_id = $5, authority_provision_id = $6, state = $7
        WHERE id = $1`,
      [
        rowId,
        res.outcome,
        res.basis,
        JSON.stringify(res.detail),
        res.ruleVersionId,
        res.authorityProvisionId,
        keepPending ? 'pending_information' : res.state,
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
          AND s.sub_section_key = $3 AND s.area_key = $4
        FOR UPDATE OF s`,
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
        'The framework is approved; a controlled reassessment must reopen it before editing 02.3.',
      );
    }
  }

  /**
   * Assemble the base facts from 02.1, 02.2, 02.6, the Section 02 CSR area,
   * the audit areas and the entity master for THIS workflow instance. Nothing
   * already established elsewhere is captured on 02.3.
   */
  private async assembleFacts(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    rowId: string,
  ): Promise<Assembled> {
    // 02.1 profile: special entities + small-company outcome + confirmation.
    const profile = await client.query<{
      special_entity_types: string[];
      state: string;
      small_company_outcome: string | null;
    }>(
      `SELECT special_entity_types, state, small_company_outcome
         FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const special = profile.rows[0]?.special_entity_types ?? [];
    const profileConfirmed = profile.rows[0]?.state === 'confirmed';
    const isSmallCompany = profileConfirmed && profile.rows[0]?.small_company_outcome === 'small';

    // Entity master: type (OPC), incorporation date, financial year.
    const ent = await client.query<{
      slug: string | null;
      incorporation_date: string | null;
      financial_year: string | null;
      entity_id: string;
    }>(
      `SELECT et.slug, ent.incorporation_date::text AS incorporation_date, e.financial_year,
              e.entity_id
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         LEFT JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE e.id = $1`,
      [engagementId],
    );
    const e = ent.rows[0];
    const financialYear = e?.financial_year ?? null;
    const periodStart = financialYear
      ? auditPeriodStartFromFinancialYear(financialYear)
      : new Date().toISOString().slice(0, 10);

    // 02.2 — its decided conclusion, else its decisive suggestion (provisional).
    const fr = await readFinancialReportingResult(client, workflowInstanceId);
    let reportingFramework: ReportingFrameworkOutcome | null = null;
    let provisional = false;
    if (fr?.framework) reportingFramework = fr.framework;
    else if (
      fr?.systemOutcome &&
      (REPORTING_FRAMEWORK_CONCLUSIONS as readonly string[]).includes(fr.systemOutcome)
    ) {
      reportingFramework = fr.systemOutcome;
      provisional = true;
    }
    const firstTimeIndAs = reportingFramework === 'ind_as' && (fr?.firstTimeAdoption ?? false);

    // 02.1 figures: turnover (rounding / presentation threshold) and borrowings.
    const turnover = await this.turnover(client, engagementId);
    const borrowings = await this.profileFigure(client, workflowInstanceId, 'borrowings');

    // Disclosure triggers (spec §12): audit areas, 02.1 borrowings, CSR, 02.6.
    const triggers: Partial<Record<DisclosureTrigger, boolean | null>> = {};
    const areas = await client.query<{ area_code: string; retained: boolean; no_balance: boolean }>(
      `SELECT area_code, bool_or(disposition = 'retained') AS retained,
              bool_and(disposition = 'removed' AND removal_reason_code = 'NO_BALANCE_ACTIVITY') AS no_balance
         FROM hsdg.audit_engagement_area
        WHERE engagement_id = $1 AND area_code IS NOT NULL
        GROUP BY area_code`,
      [engagementId],
    );
    const areaMap = new Map(areas.rows.map((r) => [r.area_code, r]));
    for (const t of AREA_TRIGGERS) {
      const hits = t.codes.map((c) => areaMap.get(c)).filter(Boolean) as Array<{
        retained: boolean;
        no_balance: boolean;
      }>;
      if (hits.some((h) => h.retained)) triggers[t.trigger] = true;
      else if (hits.length > 0 && hits.every((h) => h.no_balance)) triggers[t.trigger] = false;
      else triggers[t.trigger] = null;
    }
    if (borrowings != null && borrowings > 0) triggers.borrowings_exist = true;
    else if (borrowings === 0 && triggers.borrowings_exist == null)
      triggers.borrowings_exist = false;
    const csr = await client.query<{ v: string | null }>(
      `SELECT COALESCE(conclusion, system_suggestion) AS v
         FROM hsdg.audit_framework_assessments
        WHERE workflow_instance_id = $1 AND area_key = 'csr'`,
      [workflowInstanceId],
    );
    const csrV = csr.rows[0]?.v ?? null;
    triggers.csr_applicable =
      csrV === 'applicable' ? true : csrV === 'not_applicable' ? false : null;
    const cfs = await client.query<{ v: string | null }>(
      `SELECT COALESCE(conclusion, system_outcome) AS v
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2`,
      [workflowInstanceId, SUB_SECTION_KEY.consolidation],
    );
    const cfsV = cfs.rows[0]?.v ?? null;
    triggers.cfs_required =
      cfsV === CONSOLIDATION_OUTCOME.cfsRequired
        ? true
        : cfsV === CONSOLIDATION_OUTCOME.cfsExempt || cfsV === CONSOLIDATION_OUTCOME.notApplicable
          ? false
          : null;
    triggers.first_time_ind_as = reportingFramework === 'ind_as' ? firstTimeIndAs : false;

    // SCH-04 context: the prior-year engagement and the linked prior-year FS.
    let priorEngagementId: string | null = null;
    if (financialYear && e) {
      const start = Number(financialYear.slice(0, 4)) - 1;
      const prior = `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
      const pe = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.engagements
          WHERE entity_id = $1 AND financial_year = $2 AND id <> $3
          ORDER BY created_at DESC LIMIT 1`,
        [e.entity_id, prior, engagementId],
      );
      priorEngagementId = pe.rows[0]?.id ?? null;
    }
    const files = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM hsdg.audit_framework_files
        WHERE subassessment_id = $1 AND question_key = 'sch_04' AND removed_at IS NULL`,
      [rowId],
    );

    return {
      facts: {
        reportingFramework,
        isNbfc: special.includes('nbfc') || special.includes('hfc'),
        isBankOrInsurance: special.includes('bank') || special.includes('insurance'),
        isOpc: e?.slug === 'opc',
        isSmallCompany,
        isDormant: special.includes('dormant'),
        firstTimeIndAs,
        turnover,
        specialEntityTypes: special,
        borrowings,
        triggers,
        incorporationDate: e?.incorporation_date ?? null,
        financialYear,
        profileConfirmed,
      },
      upstreamReady: profileConfirmed && reportingFramework != null && !provisional,
      provisional,
      periodStart,
      entityTypeSlug: e?.slug ?? null,
      ctx: { priorEngagementId, priorYearFileCount: Number(files.rows[0]?.n ?? 0) },
    };
  }

  private async profileFigure(
    client: PoolClient,
    workflowInstanceId: string,
    parameter: string,
  ): Promise<number | null> {
    const { rows } = await client.query<{ current_value: string | null }>(
      `SELECT f.current_value::text
         FROM hsdg.audit_profile_financials f
         JOIN hsdg.audit_entity_profile p ON p.id = f.profile_id
        WHERE p.workflow_instance_id = $1 AND f.parameter = $2
        LIMIT 1`,
      [workflowInstanceId, parameter],
    );
    return num(rows[0]?.current_value ?? null);
  }

  private async turnover(client: PoolClient, engagementId: string): Promise<number | null> {
    const captured = await client.query<{ current_value: string | null }>(
      `SELECT f.current_value::text
         FROM hsdg.audit_profile_financials f
         JOIN hsdg.audit_entity_profile p ON p.id = f.profile_id
         JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
        WHERE swi.engagement_id = $1 AND f.parameter = 'turnover'
        LIMIT 1`,
      [engagementId],
    );
    const fromProfile = num(captured.rows[0]?.current_value ?? null);
    if (fromProfile != null) return fromProfile;
    // The audit year's financial profile first, then the current one.
    const fin = await client.query<{ turnover: string | null }>(
      `SELECT COALESCE(fp.turnover, fp.revenue) AS turnover
         FROM hsdg.entity_financial_profiles fp
         JOIN hsdg.engagements e ON e.entity_id = fp.entity_id
        WHERE e.id = $1 AND (fp.financial_year = e.financial_year OR fp.is_current)
        ORDER BY (fp.financial_year = e.financial_year) DESC, fp.is_current DESC, fp.created_at DESC
        LIMIT 1`,
      [engagementId],
    );
    return num(fin.rows[0]?.turnover ?? null);
  }
}

function isDecided(state: FrameworkState): boolean {
  return FRAMEWORK_DECIDED_STATES.includes(state);
}

function stale(): ConflictException {
  return new ConflictException('This assessment changed since you loaded it; refresh and retry.');
}

/**
 * SCH-06: an override of the presentation framework is significant and needs
 * the Engagement Partner; so does a specialised statutory format or a
 * conclusion the system could not reach on its own (complex cases).
 */
function partnerApprovalReason(
  conclusion: ScheduleIiiOutcome | null,
  systemOutcome: string | null,
  isOverridden: boolean,
): string | null {
  if (!conclusion) return null;
  if (isOverridden) return 'Override of the system presentation framework (significant override).';
  if (conclusion === SCHEDULE_III_OUTCOME.specialisedFormat)
    return 'Specialised statutory format concluded — complex case.';
  if (!systemOutcome || !DECISIVE.has(systemOutcome))
    return 'The system could not determine the framework — professional determination.';
  return null;
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
    facts: r.facts as Record<string, unknown> | null,
    needsReevaluation: r.needs_reevaluation,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    version: r.version,
  };
}

/** Build the display assessment for an undecided row from a fresh engine run. */
function liveAssessment(r: SubRow, res: ScheduleIiiResult): FrameworkSubAssessment {
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
  };
}

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

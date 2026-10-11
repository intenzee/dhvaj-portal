import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  AF01_DECISION,
  AF02_DECISION,
  DEFAULT_METHODOLOGY_VERSION,
  FRAMEWORK_AREA_KEY,
  FRAMEWORK_DECIDED_STATES,
  SUB_SECTION_KEY,
  type ApproveFrameworkInput,
  type ConfirmFrameworkInput,
  type FrameworkApprovalCondition,
  type FrameworkApprovalRecord,
  type FrameworkBaselineRecord,
  type FrameworkBaselineSnapshot,
  type FrameworkBaselineStatus,
  type FrameworkReturnItem,
  type FrameworkRuleVersionRef,
  type FrameworkSourceSection,
  type FrameworkState,
  type FrameworkSummarySection,
  type ReopenFrameworkInput,
  type ResolveFrameworkConditionInput,
  type ResolveFrameworkReturnInput,
  type StatutoryAuditFrameworkSummary,
  type SubSectionKey,
  type Af02Decision,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditCaroService } from './audit-caro.service';
import { AuditConsolidationService } from './audit-consolidation.service';
import { AuditFinancialReportingService } from './audit-financial-reporting.service';
import { AuditFrameworkDownstreamService } from './audit-framework-downstream.service';
import { readFinancialReportingResult } from './financial-reporting-result';
import { AuditIcfrService } from './audit-icfr.service';
import { AuditMattersService } from './audit-matters.service';
import { AuditPlanningIntelligenceService } from './audit-planning-intelligence.service';
import { AuditOtherReportingService } from './audit-other-reporting.service';
import { AuditProfileService } from './audit-profile.service';
import { isEngagementLead } from './master-facts';
import { AuditScheduleIiiService } from './audit-schedule-iii.service';
import { readFrameworkApprovalOn } from './framework-approval-read';
import {
  OTHER_AREA_KEYS,
  SECTION_02_RULE_AREAS,
  auditPeriodLabel,
  buildDashboard,
  evaluateCompletion,
  sectionForRuleArea,
  summaryStatus,
  undocumentedOverrides,
  validateConditions,
  validateReopen,
  validateReturnForFurtherWork,
  validateReturnItems,
  type OtherAreaFacts,
  type ProfileSummaryFacts,
} from './framework-summary-engine';
import { lockFrameworkBaselineOn, reopenFrameworkBaselineOn } from './framework-reopen';
import { onFrameworkApprovedOn, readImpactOn } from './framework-summary-impact';
import { withFrameworkInputsCacheOn } from './framework-summary-inputs';
import { readFrameworkMattersOn } from './framework-summary-matters';
import {
  controlFrameworkMemoOn,
  readFrameworkMemoOn,
  returnFrameworkMemoOn,
} from './framework-summary-memo';
import { readDownstreamPreviewOn } from './framework-summary-preview';
import { readPriorYearChangesOn, readSnapshotFactsOn } from './framework-summary-prior-year';
import { readTriggeredRequirementsOn } from './framework-summary-triggers';

/** The six Section-02 sub-sections the summary aggregates, in dashboard order. */
const SECTIONS: Array<{ sub: SubSectionKey; area: string; title: string }> = [
  {
    sub: SUB_SECTION_KEY.financialReporting,
    area: FRAMEWORK_AREA_KEY.financialReportingFramework,
    title: 'Financial Reporting Framework',
  },
  { sub: SUB_SECTION_KEY.scheduleIii, area: FRAMEWORK_AREA_KEY.scheduleIii, title: 'Schedule III' },
  { sub: SUB_SECTION_KEY.caro, area: FRAMEWORK_AREA_KEY.caro, title: 'CARO 2020' },
  { sub: SUB_SECTION_KEY.icfr, area: FRAMEWORK_AREA_KEY.ifc, title: 'ICFR' },
  { sub: SUB_SECTION_KEY.consolidation, area: FRAMEWORK_AREA_KEY.cfs, title: 'CFS / Group Audit' },
  {
    sub: SUB_SECTION_KEY.otherReporting,
    area: FRAMEWORK_AREA_KEY.otherRegulatory,
    title: 'Other Statutory Reporting',
  },
];

const DECIDED = new Set<string>(FRAMEWORK_DECIDED_STATES);
const APPROVABLE_STATES = ['applicable', 'not_applicable', 'overridden'];

const BASELINE_COLUMNS = `
  b.id, b.version, b.status, b.methodology_version, b.memo_document_id, b.memo_version,
  b.memo_reference, b.manager_note, b.ep_decision, b.audit_period, b.rule_versions,
  b.preview_reviewed_at, pr.full_name AS preview_reviewed_by_name,
  b.manager_confirmed_at, mc.full_name AS manager_confirmed_by_name,
  b.ep_approved_at, ep.full_name AS ep_approved_by_name,
  b.reopen_reason, b.reopen_affected_sections, b.reopen_identified_at,
  ib.full_name AS reopen_identified_by_name, b.reopen_evidence_note,
  b.reopen_evidence_document_id, b.reopen_reapproval_required,
  rb.full_name AS reopened_by_name, b.reopened_at, b.reopened_from_version,
  b.record_version, b.created_at`;
const BASELINE_JOINS = `
  LEFT JOIN hsdg.employees pr ON pr.id = b.preview_reviewed_by_employee_id
  LEFT JOIN hsdg.employees mc ON mc.id = b.manager_confirmed_by_employee_id
  LEFT JOIN hsdg.employees ep ON ep.id = b.ep_approved_by_employee_id
  LEFT JOIN hsdg.employees ib ON ib.id = b.reopen_identified_by_employee_id
  LEFT JOIN hsdg.employees rb ON rb.id = b.reopened_by_employee_id`;

interface BaselineRow {
  id: string;
  version: string;
  status: FrameworkBaselineStatus;
  methodology_version: string | null;
  memo_document_id: string | null;
  memo_version: string | null;
  memo_reference: string | null;
  manager_note: string | null;
  ep_decision: Af02Decision | null;
  audit_period: string | null;
  rule_versions: FrameworkRuleVersionRef[];
  preview_reviewed_at: Date | null;
  preview_reviewed_by_name: string | null;
  manager_confirmed_at: Date | null;
  manager_confirmed_by_name: string | null;
  ep_approved_at: Date | null;
  ep_approved_by_name: string | null;
  reopen_reason: string | null;
  reopen_affected_sections: FrameworkSourceSection[];
  reopen_identified_at: Date | null;
  reopen_identified_by_name: string | null;
  reopen_evidence_note: string | null;
  reopen_evidence_document_id: string | null;
  reopen_reapproval_required: boolean | null;
  reopened_by_name: string | null;
  reopened_at: Date | null;
  reopened_from_version: string | null;
  record_version: number;
  created_at: Date;
}

interface EngagementRow {
  financial_year: string;
  period_label: string;
  engagement_partner_id: string | null;
  partner_name: string | null;
  engagement_manager_id: string | null;
  manager_name: string | null;
}

/**
 * 02.8 Audit Framework Summary & Approval service (spec v1.0). Aggregates 02.1,
 * the 02.2–02.7 sub-assessments and the remaining Phase-02 area cards into a
 * read-only dashboard, and drives AF-01 (Manager review: submit or return to the
 * source section), the Audit Framework Memorandum gate, AF-02 (Engagement
 * Partner: approve, approve subject to conditions, or return), the immutable
 * approval record + baseline, the single Section 02 approval that Planning reads,
 * and the controlled reopen. It never edits a 02.x fact — only its own records and
 * (on approval / reopen) the frozen states.
 */
@Injectable()
export class AuditFrameworkSummaryService {
  private readonly logger = new Logger(AuditFrameworkSummaryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly caro: AuditCaroService,
    private readonly consolidation: AuditConsolidationService,
    private readonly icfr: AuditIcfrService,
    private readonly otherReporting: AuditOtherReportingService,
    private readonly profile: AuditProfileService,
    private readonly financialReporting: AuditFinancialReportingService,
    private readonly scheduleIii: AuditScheduleIiiService,
    private readonly frameworkDownstream: AuditFrameworkDownstreamService,
    private readonly matters: AuditMattersService,
    private readonly planningIntelligence: AuditPlanningIntelligenceService,
  ) {}

  // ── Read / aggregate ─────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditFrameworkSummary[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: shells } = await client.query<{ id: string; engagement_service_id: string }>(
        `SELECT id, engagement_service_id FROM hsdg.service_workflow_instances WHERE engagement_id = $1
            AND status <> 'cancelled'
          ORDER BY created_at ASC`,
        [engagementId],
      );
      if (shells.length === 0) return [];
      // An approved, live baseline freezes 02.1–02.7: seeding and prefilling
      // would change nothing, so a read of an approved framework skips them.
      const { rows: frozen } = await client.query<{ n: number }>(
        `SELECT count(DISTINCT workflow_instance_id)::int AS n
           FROM hsdg.audit_framework_baseline
          WHERE workflow_instance_id = ANY($1::uuid[]) AND status = 'approved'`,
        [shells.map((s) => s.id)],
      );
      if (frozen[0]!.n < shells.length)
        await this.seedAndPrefill(client, ctx, engagementId, shells);
      const out: StatutoryAuditFrameworkSummary[] = [];
      for (const s of shells)
        out.push(await this.build(client, ctx, engagementId, s.id, s.engagement_service_id));
      return out;
    });
  }

  /**
   * Facts the portal already holds (02.1, 02.2, 02.4–02.7) are filled on
   * first sight, so the summary shows outcomes, not blanks.
   */
  private async seedAndPrefill(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    shells: Array<{ id: string }>,
  ): Promise<void> {
    for (const s of shells) {
      await this.profile.seedProfileOn(client, s.id, engagementId);
      await this.financialReporting.seedOn(client, s.id, engagementId);
      await this.scheduleIii.seedOn(client, s.id, engagementId);
      await this.caro.seedOn(client, s.id, engagementId);
      await this.consolidation.seedOn(client, s.id, engagementId);
      await this.icfr.seedOn(client, s.id, engagementId);
      await this.otherReporting.seedOn(client, s.id, engagementId);
    }
    // 02.1 first: CARO / ICFR read its special entity types.
    await this.profile.prefillOn(client, ctx, engagementId);
    await this.financialReporting.prefillOn(client, ctx, engagementId);
    // 02.3 captures nothing: it routes from 02.1 / 02.2, so refresh it now.
    if (await isEngagementLead(client, engagementId))
      await this.scheduleIii.refreshOn(client, engagementId);
    await this.caro.prefillOn(client, ctx, engagementId);
    await this.consolidation.prefillOn(client, ctx, engagementId);
    await this.icfr.prefillOn(client, ctx, engagementId);
    await this.otherReporting.prefillOn(client, ctx, engagementId);
  }

  /** The summary is a read: Track B's hooks share one read of the record inputs. */
  private build(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    engagementServiceId?: string,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return withFrameworkInputsCacheOn(client, () =>
      this.buildSummary(client, ctx, engagementId, workflowInstanceId, engagementServiceId),
    );
  }

  private async buildSummary(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    engagementServiceId?: string,
  ): Promise<StatutoryAuditFrameworkSummary> {
    const eng = await this.engagement(client, engagementId);
    const period = auditPeriodLabel(eng.financial_year, eng.period_label);
    const sections = await this.sections(client, workflowInstanceId);
    const sectionBases = await this.sectionBases(client, workflowInstanceId);
    const profile = await this.profileFacts(client, workflowInstanceId);
    const otherAreas = await this.otherAreas(client, workflowInstanceId);
    const matters = await readFrameworkMattersOn(client, workflowInstanceId);
    const history = await this.baselines(client, workflowInstanceId);
    const current = history.find((b) => b.status !== 'superseded') ?? null;
    const lastApproved = history.find((b) => b.ep_approved_at != null) ?? null;
    const returns = await this.returns(client, workflowInstanceId);
    const conditions = lastApproved ? await this.conditions(client, lastApproved.id) : [];
    const triggeredRequirements = await readTriggeredRequirementsOn(
      client,
      workflowInstanceId,
      sections,
    );
    const downstreamPreview = await readDownstreamPreviewOn(client, workflowInstanceId, sections);
    const priorYear = await readPriorYearChangesOn(client, workflowInstanceId);
    const memo = await readFrameworkMemoOn(client, workflowInstanceId, current?.id ?? null);
    const impact = await readImpactOn(client, workflowInstanceId, current?.id ?? null);
    const approvalState = await readFrameworkApprovalOn(client, workflowInstanceId);
    const preparedByName = await this.preparer(client, workflowInstanceId);

    const openReturns = returns.filter((r) => r.status === 'open');
    const dashboard = buildDashboard({
      profile,
      sections,
      otherAreas,
      matters,
      returns: openReturns,
      preview: downstreamPreview,
    });
    const isRevision = current?.reopened_from_version != null;
    const impactConfirmed = !isRevision || impact == null || impact.confirmedAt != null;
    const viewerIsPartner = ctx.employeeId != null && ctx.employeeId === eng.engagement_partner_id;
    const completion = evaluateCompletion({
      dashboard,
      sections,
      matters,
      undocumentedOverrides: undocumentedOverrides({
        sections: sections.map((s) => ({
          title: s.title,
          isOverridden: s.isOverridden,
          basis: sectionBases.get(s.subSectionKey) ?? null,
        })),
        otherAreas,
        profile,
      }),
      openReturns: openReturns.length,
      baselineStatus: current?.status ?? null,
      previewReviewed: current?.preview_reviewed_at != null,
      previewItemCount: downstreamPreview.length,
      memo,
      isRevision,
      impactConfirmed,
      versionsStored:
        current?.status === 'approved' &&
        current.methodology_version != null &&
        current.rule_versions.length > 0,
      viewerIsPartner,
    });

    const baseline = current ? mapBaseline(current) : null;
    const status = summaryStatus({
      baselineStatus: current?.status ?? null,
      isRevision,
      canConfirm: completion.canConfirm,
    });
    const version = current?.version ?? '1.0';

    return {
      workflowInstanceId,
      engagementServiceId:
        engagementServiceId ?? (await this.serviceIdOf(client, workflowInstanceId)),
      engagementId,
      header: {
        status,
        preparedByName,
        engagementManagerName: eng.manager_name,
        engagementPartnerName: eng.partner_name,
        periodLabel: period.label,
        frameworkVersion: current?.status === 'approved' ? `v${version}` : `Draft v${version}`,
        methodologyVersion:
          current?.methodology_version ??
          lastApproved?.methodology_version ??
          DEFAULT_METHODOLOGY_VERSION,
        openMatterCount: matters.filter((m) => m.open).length,
        blockingMatterCount: matters.filter((m) => m.blocking).length,
        viewerIsPartner,
        viewerIsManager: ctx.employeeId != null && ctx.employeeId === eng.engagement_manager_id,
      },
      profileConfirmed: profile.state === 'confirmed',
      dashboard,
      sections,
      triggeredRequirements,
      downstreamPreview,
      matters,
      priorYear,
      memo,
      impact,
      returns,
      baseline,
      history: history.map(mapBaseline),
      approval: lastApproved ? mapApproval(lastApproved, conditions) : null,
      gates: {
        allSectionsDecided: completion.allSectionsDecided,
        profileConfirmed: profile.state === 'confirmed',
        hasBlockingMatter: completion.hasBlockingMatter,
        openReturnCount: openReturns.length,
        impactConfirmed,
        canConfirm: completion.canConfirm,
        canCreateMemo: completion.canCreateMemo,
        canApprove: completion.canApprove,
        canReopen: completion.canReopen,
        confirmBlockers: completion.confirmBlockers,
        approveBlockers: completion.approveBlockers,
        checks: completion.checks,
      },
      planning: approvalState.planning,
      planningUnlocked: approvalState.planning.unlocked,
      recordVersion: current?.record_version ?? 0,
    };
  }

  private async engagement(client: PoolClient, engagementId: string): Promise<EngagementRow> {
    const { rows } = await client.query<EngagementRow>(
      `SELECT e.financial_year, e.period_label,
              e.engagement_partner_id, ep.full_name AS partner_name,
              e.engagement_manager_id, em.full_name AS manager_name
         FROM hsdg.engagements e
         LEFT JOIN hsdg.employees ep ON ep.id = e.engagement_partner_id
         LEFT JOIN hsdg.employees em ON em.id = e.engagement_manager_id
        WHERE e.id = $1`,
      [engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Engagement not found.');
    return rows[0];
  }

  private async serviceIdOf(client: PoolClient, workflowInstanceId: string): Promise<string> {
    const { rows } = await client.query<{ engagement_service_id: string }>(
      `SELECT engagement_service_id FROM hsdg.service_workflow_instances WHERE id = $1`,
      [workflowInstanceId],
    );
    return rows[0]?.engagement_service_id ?? '';
  }

  private async sections(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FrameworkSummarySection[]> {
    const { rows } = await client.query<{
      sub_section_key: string;
      area_key: string;
      state: FrameworkState;
      system_outcome: string | null;
      conclusion: string | null;
      rule_version_id: string | null;
      authority_provision_id: string | null;
      needs_reevaluation: boolean;
      is_overridden: boolean;
    }>(
      `SELECT sub_section_key, area_key, state, system_outcome, conclusion,
              rule_version_id, authority_provision_id, needs_reevaluation, is_overridden
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const byKey = new Map(rows.map((r) => [`${r.sub_section_key}|${r.area_key}`, r]));
    // 02.2 counts as decided only once COMPLETE (spec §21: conclusion, Partner
    // approval where required, SMC / first-time status, no open Framework Review).
    const frf = byKey.get(
      `${SUB_SECTION_KEY.financialReporting}|${FRAMEWORK_AREA_KEY.financialReportingFramework}`,
    );
    const frfComplete =
      frf && DECIDED.has(frf.state) && frf.state !== 'approved'
        ? ((await readFinancialReportingResult(client, workflowInstanceId))?.complete ?? false)
        : true;
    return SECTIONS.map(({ sub, area, title }) => {
      const r = byKey.get(`${sub}|${area}`);
      const state: FrameworkState = (r?.state ?? 'not_assessed') as FrameworkState;
      return {
        subSectionKey: sub,
        areaKey: area,
        title,
        state,
        systemOutcome: r?.system_outcome ?? null,
        conclusion: r?.conclusion ?? null,
        ruleVersionId: r?.rule_version_id ?? null,
        authorityProvisionId: r?.authority_provision_id ?? null,
        needsReevaluation: r?.needs_reevaluation ?? false,
        isOverridden: r?.is_overridden ?? false,
        decided:
          r != null &&
          DECIDED.has(state) &&
          (sub !== SUB_SECTION_KEY.financialReporting || frfComplete),
      };
    });
  }

  /** The professional basis recorded on each sub-assessment (for the override check). */
  private async sectionBases(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<Map<string, string | null>> {
    const { rows } = await client.query<{ sub_section_key: string; basis: string | null }>(
      `SELECT sub_section_key, basis FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND area_key = ANY($2::text[])`,
      [workflowInstanceId, SECTIONS.map((s) => s.area)],
    );
    return new Map(rows.map((r) => [r.sub_section_key, r.basis]));
  }

  private async profileFacts(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<ProfileSummaryFacts> {
    const { rows } = await client.query<{
      state: 'draft' | 'confirmed';
      listing_answer: string | null;
      small_company_outcome: string | null;
      small_company_override: string | null;
      small_company_override_reason: string | null;
      initial_audit: boolean | null;
      joint_audit: boolean | null;
      special_entity_types: string[] | null;
      needs_reevaluation: boolean;
    }>(
      `SELECT state, listing_answer, small_company_outcome, small_company_override,
              small_company_override_reason, initial_audit, joint_audit,
              special_entity_types, needs_reevaluation
         FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const p = rows[0];
    return {
      state: p?.state ?? null,
      listingAnswer: p?.listing_answer ?? null,
      smallCompanyOutcome: p?.small_company_outcome ?? null,
      smallCompanyOverride: p?.small_company_override ?? null,
      smallCompanyOverrideReason: p?.small_company_override_reason ?? null,
      initialAudit: p?.initial_audit ?? null,
      jointAudit: p?.joint_audit ?? null,
      specialEntityTypes: p?.special_entity_types ?? [],
      needsReevaluation: p?.needs_reevaluation ?? false,
    };
  }

  private async otherAreas(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<OtherAreaFacts[]> {
    const { rows } = await client.query<{
      area_key: string;
      title: string;
      state: FrameworkState;
      conclusion: string | null;
      is_overridden: boolean;
      basis: string | null;
    }>(
      `SELECT area_key, title, state, conclusion, is_overridden, basis
         FROM hsdg.audit_framework_assessments
        WHERE workflow_instance_id = $1 AND area_key = ANY($2::text[])
        ORDER BY sort_order ASC`,
      [workflowInstanceId, [...OTHER_AREA_KEYS]],
    );
    return rows.map((r) => ({
      areaKey: r.area_key,
      title: r.title,
      state: r.state,
      conclusion: r.conclusion,
      isOverridden: r.is_overridden,
      basis: r.basis,
    }));
  }

  /** Current preparer: whoever last recorded a Section 02 conclusion. */
  private async preparer(client: PoolClient, workflowInstanceId: string): Promise<string | null> {
    const { rows } = await client.query<{ full_name: string }>(
      `SELECT e.full_name FROM (
          SELECT decided_by_employee_id AS emp, decided_at AS at
            FROM hsdg.audit_framework_subassessment WHERE workflow_instance_id = $1
          UNION ALL
          SELECT decided_by_employee_id, decided_at
            FROM hsdg.audit_framework_assessments WHERE workflow_instance_id = $1
          UNION ALL
          SELECT COALESCE(updated_by_employee_id, confirmed_by_employee_id), COALESCE(confirmed_at, updated_at)
            FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1
        ) x JOIN hsdg.employees e ON e.id = x.emp
        WHERE x.at IS NOT NULL
        ORDER BY x.at DESC LIMIT 1`,
      [workflowInstanceId],
    );
    return rows[0]?.full_name ?? null;
  }

  /** Every baseline version, newest first. */
  private async baselines(client: PoolClient, workflowInstanceId: string): Promise<BaselineRow[]> {
    const { rows } = await client.query<BaselineRow>(
      `SELECT ${BASELINE_COLUMNS}
         FROM hsdg.audit_framework_baseline b ${BASELINE_JOINS}
        WHERE b.workflow_instance_id = $1
        ORDER BY b.created_at DESC`,
      [workflowInstanceId],
    );
    return rows;
  }

  private async returns(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FrameworkReturnItem[]> {
    const { rows } = await client.query<{
      id: string;
      gate: 'AF-01' | 'AF-02';
      section: FrameworkSourceSection;
      action: string;
      owner_employee_id: string | null;
      owner_name: string | null;
      status: 'open' | 'resolved';
      raised_by_name: string | null;
      raised_at: Date;
      resolved_by_name: string | null;
      resolved_at: Date | null;
      resolution: string | null;
    }>(
      `SELECT r.id, r.gate, r.section, r.action, r.owner_employee_id, o.full_name AS owner_name,
              r.status, rb.full_name AS raised_by_name, r.raised_at,
              sb.full_name AS resolved_by_name, r.resolved_at, r.resolution
         FROM hsdg.audit_framework_return r
         LEFT JOIN hsdg.employees o ON o.id = r.owner_employee_id
         LEFT JOIN hsdg.employees rb ON rb.id = r.raised_by_employee_id
         LEFT JOIN hsdg.employees sb ON sb.id = r.resolved_by_employee_id
        WHERE r.workflow_instance_id = $1
        ORDER BY (r.status = 'open') DESC, r.raised_at DESC`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({
      id: r.id,
      gate: r.gate,
      section: r.section,
      action: r.action,
      ownerEmployeeId: r.owner_employee_id,
      ownerName: r.owner_name,
      status: r.status,
      raisedByName: r.raised_by_name,
      raisedAt: r.raised_at.toISOString(),
      resolvedByName: r.resolved_by_name,
      resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
      resolution: r.resolution,
    }));
  }

  private async conditions(
    client: PoolClient,
    baselineId: string,
  ): Promise<FrameworkApprovalCondition[]> {
    const { rows } = await client.query<{
      id: string;
      condition: string;
      owner_employee_id: string | null;
      owner_name: string | null;
      due_date: string;
      impact: string;
      planning_may_commence: boolean;
      status: 'open' | 'resolved';
      resolved_by_name: string | null;
      resolved_at: Date | null;
      resolution: string | null;
    }>(
      `SELECT c.id, c.condition, c.owner_employee_id, o.full_name AS owner_name,
              c.due_date::text AS due_date, c.impact, c.planning_may_commence, c.status,
              rb.full_name AS resolved_by_name, c.resolved_at, c.resolution
         FROM hsdg.audit_framework_condition c
         LEFT JOIN hsdg.employees o ON o.id = c.owner_employee_id
         LEFT JOIN hsdg.employees rb ON rb.id = c.resolved_by_employee_id
        WHERE c.baseline_id = $1
        ORDER BY c.created_at ASC`,
      [baselineId],
    );
    return rows.map((r) => ({
      id: r.id,
      condition: r.condition,
      ownerEmployeeId: r.owner_employee_id,
      ownerName: r.owner_name,
      dueDate: r.due_date,
      impact: r.impact,
      planningMayCommence: r.planning_may_commence,
      status: r.status,
      resolvedByName: r.resolved_by_name,
      resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
      resolution: r.resolution,
    }));
  }

  /**
   * The rule versions the approved framework relied on (§13): every version the
   * 02.1–02.7 conclusions cite, plus each Section 02 rule's version in force at
   * the period end.
   */
  private async ruleVersions(
    client: PoolClient,
    workflowInstanceId: string,
    citedIds: string[],
    periodEnd: string,
  ): Promise<FrameworkRuleVersionRef[]> {
    const { rows: profileRule } = await client.query<{ id: string | null }>(
      `SELECT small_company_rule_version_id AS id FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const cited = [...citedIds, ...profileRule.map((r) => r.id).filter((x): x is string => !!x)];
    const { rows } = await client.query<{
      id: string;
      code: string;
      version: number;
      area_key: string;
    }>(
      `SELECT rv.id, r.code, rv.version, r.area_key
         FROM hsdg.audit_rule_version rv
         JOIN hsdg.audit_rule r ON r.id = rv.audit_rule_id
        WHERE rv.id = ANY($1::uuid[])
           OR (r.is_active AND r.area_key = ANY($2::text[])
               AND rv.effective_from <= $3::date
               AND (rv.effective_to IS NULL OR rv.effective_to >= $3::date))
        ORDER BY r.area_key, r.code, rv.version`,
      [cited, SECTION_02_RULE_AREAS, periodEnd],
    );
    return rows.map((r) => ({
      ruleVersionId: r.id,
      ruleCode: r.code,
      versionLabel: `v${r.version}`,
      section: sectionForRuleArea(r.area_key) ?? 'other_areas',
    }));
  }

  // ── AF-01 Manager review (§9) ─────────────────────────────────────────────────

  async confirmManager(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ConfirmFrameworkInput,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertLead(client, engagementId);
      await this.lockBaseline(client, workflowInstanceId);
      const existing = await this.rawCurrent(client, workflowInstanceId);
      if ((existing?.record_version ?? 0) !== input.recordVersion) throw staleConflict();

      if (input.decision === AF01_DECISION.furtherWork) {
        const err = validateReturnItems(input.returnItems);
        if (err) throw new BadRequestException(err);
        if (existing && existing.status !== 'draft')
          throw new ConflictException('AF-01 can only return a draft framework.');
        const baselineId =
          existing?.id ?? (await this.insertDraft(client, workflowInstanceId, engagementId, '1.0'));
        for (const it of input.returnItems!) {
          await client.query(
            `INSERT INTO hsdg.audit_framework_return
               (baseline_id, workflow_instance_id, engagement_id, gate, section, action,
                owner_employee_id, raised_by_employee_id)
             VALUES ($1, $2, $3, 'AF-01', $4, $5, $6, $7)`,
            [
              baselineId,
              workflowInstanceId,
              engagementId,
              it.section,
              it.action.trim(),
              it.ownerEmployeeId ?? null,
              ctx.employeeId ?? null,
            ],
          );
        }
        await client.query(
          `UPDATE hsdg.audit_framework_baseline
              SET manager_note = COALESCE($2, manager_note), record_version = record_version + 1
            WHERE id = $1`,
          [baselineId, input.note?.trim() || null],
        );
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.framework_manager_returned',
          objectType: 'audit_framework_baseline',
          objectId: workflowInstanceId,
          after: { sections: input.returnItems!.map((r) => r.section) },
        });
        return this.build(client, ctx, engagementId, workflowInstanceId);
      }

      if (input.decision !== AF01_DECISION.submit)
        throw new BadRequestException('Unknown AF-01 decision.');
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
      const summary = await this.build(client, ctx, engagementId, workflowInstanceId);
      if (!summary.gates.canConfirm)
        throw new BadRequestException(summary.gates.confirmBlockers.join(' '));
      if (!input.previewReviewed)
        throw new BadRequestException(
          'Review the Downstream Configuration Preview before submitting for Partner approval.',
        );
      if (existing) {
        await client.query(
          `UPDATE hsdg.audit_framework_baseline
              SET status = 'manager_confirmed', manager_confirmed_by_employee_id = $2,
                  manager_confirmed_at = now(), preview_reviewed_by_employee_id = $2,
                  preview_reviewed_at = now(), manager_note = $3,
                  record_version = record_version + 1
            WHERE id = $1`,
          [existing.id, ctx.employeeId ?? null, input.note?.trim() || null],
        );
      } else {
        await client.query(
          `INSERT INTO hsdg.audit_framework_baseline
             (workflow_instance_id, engagement_id, version, status,
              manager_confirmed_by_employee_id, manager_confirmed_at,
              preview_reviewed_by_employee_id, preview_reviewed_at, manager_note)
           VALUES ($1, $2, '1.0', 'manager_confirmed', $3, now(), $3, now(), $4)`,
          [workflowInstanceId, engagementId, ctx.employeeId ?? null, input.note?.trim() || null],
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_manager_confirmed',
        objectType: 'audit_framework_baseline',
        objectId: workflowInstanceId,
        after: { version: existing?.version ?? '1.0' },
      });
      return this.build(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── AF-02 Engagement Partner conclusion (§12–§14) ─────────────────────────────

  async approve(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ApproveFrameworkInput,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.lockBaseline(client, workflowInstanceId);
      const existing = await this.rawCurrent(client, workflowInstanceId);
      if (!existing || existing.status !== 'manager_confirmed') {
        throw new BadRequestException('AF-02 requires a Manager-confirmed (AF-01) framework.');
      }
      if (existing.record_version !== input.recordVersion) throw staleConflict();
      const eng = await this.engagement(client, engagementId);
      if (!ctx.employeeId || ctx.employeeId !== eng.engagement_partner_id)
        throw new ForbiddenException('Only the Engagement Partner can record AF-02.');

      if (input.decision === AF02_DECISION.returnForFurtherWork) {
        const err = validateReturnForFurtherWork(input.returnReason, input.returnSections);
        if (err) throw new BadRequestException(err);
        await client.query(
          `UPDATE hsdg.audit_framework_baseline
              SET status = 'draft', manager_confirmed_by_employee_id = NULL,
                  manager_confirmed_at = NULL, preview_reviewed_by_employee_id = NULL,
                  preview_reviewed_at = NULL, record_version = record_version + 1
            WHERE id = $1`,
          [existing.id],
        );
        for (const section of new Set(input.returnSections!)) {
          await client.query(
            `INSERT INTO hsdg.audit_framework_return
               (baseline_id, workflow_instance_id, engagement_id, gate, section, action,
                owner_employee_id, raised_by_employee_id)
             VALUES ($1, $2, $3, 'AF-02', $4, $5, $6, $7)`,
            [
              existing.id,
              workflowInstanceId,
              engagementId,
              section,
              input.returnReason!.trim(),
              eng.engagement_manager_id,
              ctx.employeeId,
            ],
          );
        }
        await returnFrameworkMemoOn(client, ctx, existing.id);
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.framework_ep_returned',
          objectType: 'audit_framework_baseline',
          objectId: workflowInstanceId,
          after: { version: existing.version, sections: input.returnSections },
        });
        return this.build(client, ctx, engagementId, workflowInstanceId);
      }

      if (
        input.decision !== AF02_DECISION.approve &&
        input.decision !== AF02_DECISION.approveWithConditions
      )
        throw new BadRequestException('Unknown AF-02 decision.');
      if (input.decision === AF02_DECISION.approveWithConditions) {
        const err = validateConditions(input.conditions);
        if (err) throw new BadRequestException(err);
      }
      // §10 — reconcile framework matters, then block on any open Blocking Matter.
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
      const summary = await this.build(client, ctx, engagementId, workflowInstanceId);
      if (summary.gates.hasBlockingMatter)
        throw new BadRequestException('A Blocking Matter prevents framework approval.');
      if (!summary.memo || summary.memo.status !== 'submitted')
        throw new BadRequestException(
          'Create and submit the Audit Framework Memorandum before AF-02.',
        );

      const before = await readFrameworkApprovalOn(client, workflowInstanceId);
      const memoRef = await controlFrameworkMemoOn(client, ctx, existing.id);
      const period = auditPeriodLabel(eng.financial_year, eng.period_label);
      const cited = summary.sections
        .map((s) => s.ruleVersionId)
        .filter((v): v is string => v != null);
      const ruleVersions = await this.ruleVersions(client, workflowInstanceId, cited, period.end);
      const methodologyVersion = input.methodologyVersion?.trim() || DEFAULT_METHODOLOGY_VERSION;
      const snapshot: FrameworkBaselineSnapshot = {
        generatedAt: new Date().toISOString(),
        dashboard: summary.dashboard,
        sections: summary.sections,
        triggeredRequirements: summary.triggeredRequirements,
        downstreamPreview: summary.downstreamPreview,
        facts: {
          ...(await readSnapshotFactsOn(client, workflowInstanceId)),
          methodologyVersion,
        },
      };
      await client.query(
        `UPDATE hsdg.audit_framework_baseline
            SET status = 'approved', ep_decision = $2, methodology_version = $3,
                snapshot = $4::jsonb, rule_version_ids = $5::uuid[], rule_versions = $6::jsonb,
                ep_approved_by_employee_id = $7, ep_approved_at = now(), audit_period = $8,
                memo_document_id = COALESCE($9, memo_document_id), memo_version = $10,
                memo_reference = $11, record_version = record_version + 1
          WHERE id = $1`,
        [
          existing.id,
          input.decision,
          methodologyVersion,
          JSON.stringify(snapshot),
          ruleVersions.map((r) => r.ruleVersionId),
          JSON.stringify(ruleVersions),
          ctx.employeeId,
          period.label,
          memoRef?.documentId ?? summary.memo.documentId,
          memoRef?.version ?? summary.memo.version,
          memoRef?.reference ?? summary.memo.fileName,
        ],
      );
      if (input.decision === AF02_DECISION.approveWithConditions) {
        for (const c of input.conditions!) {
          await client.query(
            `INSERT INTO hsdg.audit_framework_condition
               (baseline_id, workflow_instance_id, engagement_id, condition, owner_employee_id,
                due_date, impact, planning_may_commence, created_by_employee_id)
             VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)`,
            [
              existing.id,
              workflowInstanceId,
              engagementId,
              c.condition.trim(),
              c.ownerEmployeeId ?? null,
              c.dueDate,
              c.impact.trim(),
              c.planningMayCommence,
              ctx.employeeId,
            ],
          );
        }
      }
      // Section 02 APPROVED: freeze each decided sub-assessment …
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET state = 'approved', needs_reevaluation = false
          WHERE workflow_instance_id = $1 AND state = ANY($2::text[])`,
        [workflowInstanceId, APPROVABLE_STATES],
      );
      await client.query(
        `UPDATE hsdg.audit_entity_profile SET needs_reevaluation = false
          WHERE workflow_instance_id = $1 AND needs_reevaluation`,
        [workflowInstanceId],
      );
      // … and record the ONE Section 02 approval the rest of the file reads.
      await this.syncLegacyApproval(client, ctx, engagementId, workflowInstanceId, {
        version: existing.version,
        memoRef: memoRef?.reference ?? summary.memo.fileName,
      });
      // 02.2 §19: the approved framework result activates its downstream work.
      await this.frameworkDownstream.applyOn(client, ctx, workflowInstanceId);
      await onFrameworkApprovedOn(client, ctx, {
        workflowInstanceId,
        engagementId,
        baselineId: existing.id,
        version: existing.version,
        supersededBaselineId:
          before.approvedBaselineId && before.approvedBaselineId !== existing.id
            ? before.approvedBaselineId
            : null,
      });
      await this.preparePlanningOn(client, ctx, engagementId, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_ep_approved',
        objectType: 'audit_framework_baseline',
        objectId: workflowInstanceId,
        after: {
          version: existing.version,
          decision: input.decision,
          methodologyVersion,
          ruleVersions: ruleVersions.length,
          conditions: input.conditions?.length ?? 0,
        },
      });
      return this.build(client, ctx, engagementId, workflowInstanceId);
    });
  }

  /**
   * The single Section 02 approval (§13, §20): the legacy Phase-02 record that
   * Planning, Work and Reassessment have always read, the frozen Phase-02 area
   * cards and the completed 'framework' phase — written only by AF-02.
   */
  private async syncLegacyApproval(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { version: string; memoRef: string | null },
  ): Promise<void> {
    const { rows: areas } = await client.query<{
      area_key: string;
      conclusion: string | null;
      is_overridden: boolean;
    }>(
      `UPDATE hsdg.audit_framework_assessments
          SET state = 'approved'
        WHERE workflow_instance_id = $1 AND state = ANY($2::text[])
        RETURNING area_key, conclusion, is_overridden`,
      [workflowInstanceId, APPROVABLE_STATES],
    );
    await client.query(
      `INSERT INTO hsdg.audit_framework_approvals
         (workflow_instance_id, engagement_id, version, memo, snapshot, approved_by_employee_id)
       SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $3, $4::jsonb, $5
         FROM hsdg.audit_framework_approvals WHERE workflow_instance_id = $1`,
      [
        workflowInstanceId,
        engagementId,
        `Audit Framework Baseline v${input.version} approved in 02.8` +
          (input.memoRef ? ` — memorandum ${input.memoRef}` : ''),
        JSON.stringify(
          areas.map((a) => ({
            areaKey: a.area_key,
            conclusion: a.conclusion,
            isOverridden: a.is_overridden,
          })),
        ),
        ctx.employeeId ?? null,
      ],
    );
    await client.query(
      `UPDATE hsdg.audit_workflow_phases SET state = 'complete'
        WHERE workflow_instance_id = $1 AND phase_key = 'framework'`,
      [workflowInstanceId],
    );
  }

  // ── Controlled reopen (§15) — preserves v1.0, opens v1.1 ───────────────────────

  async reopen(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ReopenFrameworkInput,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertLead(client, engagementId);
      await this.lockBaseline(client, workflowInstanceId);
      const err = validateReopen(input);
      if (err) throw new BadRequestException(err);
      if (input.evidenceDocumentId) {
        const { rowCount } = await client.query(
          `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
          [input.evidenceDocumentId, engagementId],
        );
        if (!rowCount)
          throw new BadRequestException('Evidence document not found on this engagement.');
      }
      if (input.identifiedByEmployeeId) {
        const { rowCount } = await client.query(`SELECT 1 FROM hsdg.employees WHERE id = $1`, [
          input.identifiedByEmployeeId,
        ]);
        if (!rowCount)
          throw new BadRequestException('The person who identified the change was not found.');
      }
      const existing = await this.rawCurrent(client, workflowInstanceId);
      if (!existing || existing.status !== 'approved') {
        throw new BadRequestException('Only an approved framework baseline can be reopened.');
      }
      if (existing.record_version !== input.recordVersion) throw staleConflict();

      const r = await reopenFrameworkBaselineOn(
        client,
        ctx,
        engagementId,
        workflowInstanceId,
        existing,
        input,
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_reopened',
        objectType: 'audit_framework_baseline',
        objectId: workflowInstanceId,
        after: {
          from: r.fromVersion,
          to: r.toVersion,
          reason: input.reason.trim(),
          affectedSections: r.affectedSections,
          reapprovalRequired: input.reapprovalRequired,
        },
      });
      return this.build(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Returned items and approval conditions ────────────────────────────────────

  /** Clear an AF-01 / AF-02 return once the source section addressed it (owner or lead). */
  async resolveReturn(
    ctx: RlsContext,
    engagementId: string,
    returnId: string,
    input: ResolveFrameworkReturnInput,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        workflow_instance_id: string;
        owner_employee_id: string | null;
        status: string;
      }>(
        `SELECT workflow_instance_id, owner_employee_id, status FROM hsdg.audit_framework_return
          WHERE id = $1 AND engagement_id = $2 FOR UPDATE`,
        [returnId, engagementId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Returned item not found on this engagement.');
      if (r.status !== 'open') throw new ConflictException('This item is already cleared.');
      if (!input.resolution?.trim())
        throw new BadRequestException('Record how the source section addressed it.');
      const lead = await isEngagementLead(client, engagementId);
      if (!lead && (!ctx.employeeId || ctx.employeeId !== r.owner_employee_id))
        throw new ForbiddenException('Only the item owner or an engagement lead can clear it.');
      await client.query(
        `UPDATE hsdg.audit_framework_return
            SET status = 'resolved', resolution = $2, resolved_by_employee_id = $3,
                resolved_at = now()
          WHERE id = $1`,
        [returnId, input.resolution.trim(), ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_return_resolved',
        objectType: 'audit_framework_return',
        objectId: returnId,
      });
      return this.build(client, ctx, engagementId, r.workflow_instance_id);
    });
  }

  /** Resolve an Approve-Subject-to-Conditions condition (owner, lead or EP). */
  async resolveCondition(
    ctx: RlsContext,
    engagementId: string,
    conditionId: string,
    input: ResolveFrameworkConditionInput,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        workflow_instance_id: string;
        owner_employee_id: string | null;
        status: string;
      }>(
        `SELECT workflow_instance_id, owner_employee_id, status FROM hsdg.audit_framework_condition
          WHERE id = $1 AND engagement_id = $2 FOR UPDATE`,
        [conditionId, engagementId],
      );
      const c = rows[0];
      if (!c) throw new NotFoundException('Condition not found on this engagement.');
      if (c.status !== 'open') throw new ConflictException('This condition is already resolved.');
      if (!input.resolution?.trim())
        throw new BadRequestException('Record how the condition was resolved.');
      const lead = await isEngagementLead(client, engagementId);
      if (!lead && (!ctx.employeeId || ctx.employeeId !== c.owner_employee_id))
        throw new ForbiddenException(
          'Only the condition owner or an engagement lead can resolve it.',
        );
      await client.query(
        `UPDATE hsdg.audit_framework_condition
            SET status = 'resolved', resolution = $2, resolved_by_employee_id = $3,
                resolved_at = now()
          WHERE id = $1`,
        [conditionId, input.resolution.trim(), ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_condition_resolved',
        objectType: 'audit_framework_condition',
        objectId: conditionId,
      });
      // The last blocking condition resolved opens Section 03 (02.8 §12).
      await this.preparePlanningOn(client, ctx, engagementId, c.workflow_instance_id);
      return this.build(client, ctx, engagementId, c.workflow_instance_id);
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /**
   * DHVAJ 03.1 §22 — the decision that opens Section 03 also derives the 03.1
   * Engagement Intelligence, as the approving lead, so whoever opens 03.1 first
   * finds it ready (team members cannot write 03.1 themselves). A no-op while
   * Section 03 stays locked or 03.1 is frozen. Under a savepoint: a planning
   * failure never undoes the framework decision — the next lead's open of
   * 03.1 retries it.
   */
  private async preparePlanningOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    await client.query('SAVEPOINT planning_autogen');
    try {
      await this.planningIntelligence.autoGenerateOn(client, ctx, engagementId, workflowInstanceId);
      await client.query('RELEASE SAVEPOINT planning_autogen');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT planning_autogen');
      this.logger.warn(
        `03.1 intelligence was not derived on the framework decision for ${workflowInstanceId}; ` +
          `the next lead's open retries: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * AF-01 / AF-02 / reopen read the current baseline, check it, then write: a
   * per-audit-file transaction lock makes that atomic (a double-submit cannot
   * create two v1.0 / v1.1 rows or approve twice). Advisory, so RLS-agnostic.
   */
  private async lockBaseline(client: PoolClient, workflowInstanceId: string): Promise<void> {
    await lockFrameworkBaselineOn(client, workflowInstanceId);
  }

  private async insertDraft(
    client: PoolClient,
    workflowInstanceId: string,
    engagementId: string,
    version: string,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_framework_baseline (workflow_instance_id, engagement_id, version, status)
       VALUES ($1, $2, $3, 'draft') RETURNING id`,
      [workflowInstanceId, engagementId, version],
    );
    return rows[0]!.id;
  }

  private async rawCurrent(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<{
    id: string;
    version: string;
    status: FrameworkBaselineStatus;
    record_version: number;
  } | null> {
    const { rows } = await client.query<{
      id: string;
      version: string;
      status: FrameworkBaselineStatus;
      record_version: number;
    }>(
      `SELECT id, version, status, record_version FROM hsdg.audit_framework_baseline
        WHERE workflow_instance_id = $1 AND status <> 'superseded'
        ORDER BY created_at DESC LIMIT 1`,
      [workflowInstanceId],
    );
    return rows[0] ?? null;
  }

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
      [workflowInstanceId, engagementId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    }
  }

  private async assertLead(client: PoolClient, engagementId: string): Promise<void> {
    if (!(await isEngagementLead(client, engagementId)))
      throw new ForbiddenException('Only an engagement lead can drive the framework approval.');
  }
}

function staleConflict(): ConflictException {
  return new ConflictException(
    'The framework baseline changed since you loaded it; refresh and retry.',
  );
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function mapBaseline(r: BaselineRow): FrameworkBaselineRecord {
  return {
    id: r.id,
    version: r.version,
    status: r.status,
    methodologyVersion: r.methodology_version,
    previewReviewedByName: r.preview_reviewed_by_name,
    previewReviewedAt: iso(r.preview_reviewed_at),
    managerConfirmedByName: r.manager_confirmed_by_name,
    managerConfirmedAt: iso(r.manager_confirmed_at),
    managerNote: r.manager_note,
    epApprovedByName: r.ep_approved_by_name,
    epApprovedAt: iso(r.ep_approved_at),
    epDecision: r.ep_decision,
    memoDocumentId: r.memo_document_id,
    reopen:
      r.reopened_from_version != null && r.reopen_reason
        ? {
            reason: r.reopen_reason,
            affectedSections: r.reopen_affected_sections,
            identifiedAt: iso(r.reopen_identified_at) ?? iso(r.created_at)!,
            identifiedByName: r.reopen_identified_by_name,
            evidenceNote: r.reopen_evidence_note,
            evidenceDocumentId: r.reopen_evidence_document_id,
            reapprovalRequired: r.reopen_reapproval_required ?? true,
            reopenedByName: r.reopened_by_name,
            reopenedAt: iso(r.reopened_at) ?? iso(r.created_at)!,
            fromVersion: r.reopened_from_version,
          }
        : null,
    recordVersion: r.record_version,
  };
}

function mapApproval(
  r: BaselineRow,
  conditions: FrameworkApprovalCondition[],
): FrameworkApprovalRecord {
  return {
    decision: r.ep_decision ?? 'approve',
    partnerName: r.ep_approved_by_name,
    approvedAt: r.ep_approved_at!.toISOString(),
    auditPeriod: r.audit_period ?? '',
    baselineVersion: r.version,
    methodologyVersion: r.methodology_version ?? DEFAULT_METHODOLOGY_VERSION,
    ruleVersions: r.rule_versions ?? [],
    memoDocumentId: r.memo_document_id,
    memoVersion: r.memo_version,
    memoReference: r.memo_reference,
    conditions,
  };
}

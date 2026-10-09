import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  FRAMEWORK_DECIDED_STATES,
  FRF_PROFESSIONAL_ACTION,
  MATTER_CLOSED_STATUSES,
  REPORTING_FRAMEWORK_CONCLUSIONS,
  REPORTING_FRAMEWORK_OUTCOME,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type FinancialReportingCapturedFacts,
  type FinancialReportingDetail,
  type FinancialReportingFacts,
  type FrameworkState,
  type FrameworkSubAssessment,
  type FrfListingStatus,
  type FrfProfessionalAction,
  type NetWorthPoint,
  type PartnerApproveFinancialReportingInput,
  type PriorFramework,
  type RecordFinancialReportingDecisionInput,
  type RelatedEntityFact,
  type ReportingFrameworkOutcome,
  type RuleResolver,
  type SetFinancialReportingFactsInput,
  type StatutoryAuditFinancialReporting,
  type StatutoryAuditFinancialReportingMasterFillResult,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService, buildRuleResolverOn } from '../catalogue/audit-rules.service';
import { AuditMattersService } from './audit-matters.service';
import { fillFinancialReporting, financialReportingFromSources } from './framework-facts-prefill';
import {
  groupStructure,
  isEngagementLead,
  readEngagementMasterFacts,
  readPriorSubAssessment,
} from './master-facts';
import { assessFinancialReporting, fyOf } from './financial-reporting';
import {
  financialReportingCompletion,
  partnerApprovalReason,
} from './financial-reporting-completion';

const SUB = SUB_SECTION_KEY.financialReporting;
const AREA = FRAMEWORK_AREA_KEY.financialReportingFramework;
const TITLE = 'Applicable Financial Reporting Framework';
/** Source key of the §19 blocking Framework Review matter. */
export const FRF_REVIEW_MATTER_SOURCE = 'framework:02.2:review';

/** Outcomes the system can decisively suggest (so a differing conclusion is an override). */
const DECISIVE = new Set<string>(REPORTING_FRAMEWORK_CONCLUSIONS);
const FY_RE = /^\d{4}-\d{2}$/;

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: FinancialReportingDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: Partial<FinancialReportingCapturedFacts> | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
  financial_year: string | null;
  professional_action: FrfProfessionalAction | null;
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

export const DEFAULT_CAPTURED: FinancialReportingCapturedFacts = {
  isListedOnSmeExchange: false,
  priorIndAs: false,
  voluntaryIndAs: false,
  groupTriggersIndAs: false,
};

export function isDecided(state: FrameworkState): boolean {
  return FRAMEWORK_DECIDED_STATES.includes(state);
}

type ResolverFactory = (client: PoolClient, auditPeriodStart: string) => Promise<RuleResolver>;

// ── Fact assembly (module-level so the downstream helper shares it) ───────────

/** Assemble the base facts from confirmed 02.1 + masters + the captured facts. */
export async function assembleFinancialReportingFacts(
  client: PoolClient,
  engagementId: string,
  workflowInstanceId: string,
  captured: FinancialReportingCapturedFacts,
): Promise<{ facts: FinancialReportingFacts; profileConfirmed: boolean }> {
  const eng = await client.query<{
    slug: string | null;
    category: string | null;
    financial_year: string;
    entity_id: string;
    listing_status: string | null;
  }>(
    `SELECT et.slug, et.category, e.financial_year, e.entity_id, ent.listing_status
       FROM hsdg.engagements e
       JOIN hsdg.entities ent ON ent.id = e.entity_id
       LEFT JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
      WHERE e.id = $1`,
    [engagementId],
  );
  const er = eng.rows[0];
  const auditFinancialYear = er?.financial_year ?? fyOf(new Date().toISOString().slice(0, 10));
  const auditPeriodStart = auditPeriodStartFromFinancialYear(auditFinancialYear);
  const isCompany = er?.category ? er.category === 'company' : null;
  const isPrivateCompany = isCompany
    ? ['private_limited', 'opc'].includes(er?.slug ?? '')
    : isCompany === false
      ? false
      : null;

  // §12 listing status: a live listing line wins, then an in-process line / status.
  const lines = await client.query<{ exchange: string; status: string }>(
    `SELECT exchange, status FROM hsdg.entity_listings
      WHERE entity_id = $1 AND status IN ('listed','in_process')`,
    [er?.entity_id ?? null],
  );
  const listed = lines.rows.filter((l) => l.status === 'listed');
  const inProc = lines.rows.filter((l) => l.status === 'in_process');
  const listingStatus: FrfListingStatus = listed.length
    ? 'listed'
    : inProc.length || er?.listing_status === 'in_process'
      ? 'in_process'
      : er?.listing_status === 'listed'
        ? 'listed'
        : 'unlisted';
  const listingExchanges = [...new Set((listed.length ? listed : inProc).map((l) => l.exchange))];

  // Special entities come from the 02.1 profile (bank / insurance / NBFC / HFC / …).
  const profile = await client.query<{ id: string; special_entity_types: string[]; state: string }>(
    `SELECT p.id, p.special_entity_types, p.state
       FROM hsdg.audit_entity_profile p
       JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
      WHERE swi.engagement_id = $1
      ORDER BY (p.workflow_instance_id = $2) DESC, swi.created_at ASC
      LIMIT 1`,
    [engagementId, workflowInstanceId],
  );
  const special = profile.rows[0]?.special_entity_types ?? [];
  const isNbfc = special.includes('nbfc') || special.includes('hfc');
  const isBank = special.includes('bank');
  const isInsurance = special.includes('insurance');
  const profileConfirmed = profile.rows[0]?.state === 'confirmed';

  // §10 net worth: preceding-year figures (02.1 prior column, then the master).
  const fin02 = await client.query<{
    parameter: string;
    current_value: string | null;
    prior_value: string | null;
    document_id: string | null;
  }>(
    `SELECT f.parameter, f.current_value::text, f.prior_value::text,
            -- "Open Source" (§10): the figure's own document, else the latest
            -- file linked to the 02.1 field.
            COALESCE(
              (SELECT d.id FROM hsdg.documents d
                WHERE d.id = f.document_id AND d.deleted_at IS NULL),
              (SELECT pf.document_id
                 FROM hsdg.audit_profile_files pf
                 JOIN hsdg.documents d ON d.id = pf.document_id AND d.deleted_at IS NULL
                WHERE pf.profile_id = f.profile_id AND pf.slot = 'financial:' || f.parameter
                  AND pf.removed_at IS NULL
                ORDER BY pf.linked_at DESC
                LIMIT 1)) AS document_id
       FROM hsdg.audit_profile_financials f
      WHERE f.profile_id = $1`,
    [profile.rows[0]?.id ?? null],
  );
  const p02 = new Map(fin02.rows.map((r) => [r.parameter, r]));
  const nwDocumentId = p02.get('net_worth')?.document_id ?? null;
  const masterFins = await client.query<{
    financial_year: string;
    net_worth: string | null;
    turnover: string | null;
    total_borrowings: string | null;
    public_deposits: string | null;
    source: string | null;
    supporting_document_ref: string | null;
  }>(
    `SELECT financial_year, net_worth::text, turnover::text, total_borrowings::text,
            public_deposits::text, source, supporting_document_ref
       FROM hsdg.entity_financial_profiles
      WHERE entity_id = $1 AND is_current
      ORDER BY financial_year`,
    [er?.entity_id ?? null],
  );
  const precedingFy = prevFy(auditFinancialYear);
  const history = new Map<string, NetWorthPoint>();
  for (const m of masterFins.rows) {
    const v = num(m.net_worth);
    if (v == null || m.financial_year >= auditFinancialYear) continue;
    history.set(m.financial_year, {
      asAt: fyEnd(m.financial_year),
      financialYear: m.financial_year,
      value: v,
      source: `Client master — FY ${m.financial_year} financials${m.source ? ` (${m.source.replace(/_/g, ' ')})` : ''}`,
      sourceUrl: httpsOnly(m.supporting_document_ref),
    });
  }
  const nwPrior = num(p02.get('net_worth')?.prior_value ?? null);
  if (nwPrior != null)
    history.set(precedingFy, {
      asAt: fyEnd(precedingFy),
      financialYear: precedingFy,
      value: nwPrior,
      source: `02.1 Card D — FY ${precedingFy} (prior-year column)`,
      sourceDocumentId: nwDocumentId,
    });
  const masterCy = masterFins.rows.find((m) => m.financial_year === auditFinancialYear);
  const masterPy = masterFins.rows.find((m) => m.financial_year === precedingFy);
  const nwCurrent =
    num(p02.get('net_worth')?.current_value ?? null) ?? num(masterCy?.net_worth ?? null);
  const netWorthHistory = [...history.values()].sort((a, b) => a.asAt.localeCompare(b.asAt));
  if (!netWorthHistory.length && nwCurrent != null) {
    // Only an audit-year figure exists: use it as the best available measure,
    // labelled so the team can capture the preceding-year figure in 02.1.
    netWorthHistory.push({
      asAt: fyEnd(precedingFy),
      financialYear: precedingFy,
      value: nwCurrent,
      source: '02.1 Card D — current-year figure (no preceding-year figure captured)',
      sourceDocumentId: p02.get('net_worth')?.current_value != null ? nwDocumentId : null,
      sourceUrl:
        p02.get('net_worth')?.current_value != null
          ? null
          : httpsOnly(masterCy?.supporting_document_ref ?? null),
    });
  }
  const netWorth = netWorthHistory.length
    ? netWorthHistory[netWorthHistory.length - 1]!.value
    : null;

  const pick = (param: string, py: string | null | undefined, cy: string | null | undefined) =>
    num(p02.get(param)?.prior_value ?? null) ??
    num(py ?? null) ??
    num(p02.get(param)?.current_value ?? null) ??
    num(cy ?? null);
  const turnover = pick('turnover', masterPy?.turnover, masterCy?.turnover);
  const borrowingsBase = pick('borrowings', masterPy?.total_borrowings, masterCy?.total_borrowings);
  const borrowings = captured.smcMaxBorrowings ?? borrowingsBase;

  // FRF-01: the team's answer, else last year's portal file.
  let priorFramework: PriorFramework | null = captured.priorFramework ?? null;
  let priorFrameworkSource = captured.priorFrameworkSource ?? null;
  if (!priorFramework) {
    const prior = await readPriorSubAssessment(client, workflowInstanceId, { sub: SUB, area: AREA });
    if (prior?.conclusion === 'ind_as' || prior?.conclusion === 'accounting_standards') {
      priorFramework = prior.conclusion;
      priorFrameworkSource = `FY ${prior.financialYear} audit file on the portal`;
    }
  }

  // §11 group companies from the master (no duplicate entry).
  const master = await readEngagementMasterFacts(client, workflowInstanceId);
  const relatedEntities: RelatedEntityFact[] = [];
  if (master) {
    const g = groupStructure(master.relationships);
    const toFact = (
      r: (typeof master.relationships)[number],
      relationship: RelatedEntityFact['relationship'],
    ): RelatedEntityFact => ({
      name: r.counterparty,
      relationship,
      framework: r.counterpartyIndAs
        ? 'ind_as'
        : r.counterpartyAsFile
          ? 'accounting_standards'
          : 'unknown',
      frameworkSource:
        r.counterpartyIndAs === 'listed'
          ? 'Listed on NSE/BSE'
          : r.counterpartyIndAs === 'ind_as_file'
            ? 'Its audit file concluded Ind AS'
            : r.counterpartyAsFile
              ? 'Its audit file concluded AS'
              : null,
    });
    for (const p of g.parents) relatedEntities.push(toFact(p, 'holding'));
    for (const i of g.investees)
      relatedEntities.push(
        toFact(
          i,
          i.kind === 'associate'
            ? 'associate'
            : i.kind === 'joint_venture'
              ? 'joint_venture'
              : 'subsidiary',
        ),
      );
  }

  return {
    profileConfirmed,
    facts: {
      isCompany,
      isPrivateCompany,
      isListed: listingStatus !== 'unlisted',
      listingStatus,
      listingExchanges,
      isListedOnSmeExchange: captured.isListedOnSmeExchange,
      isNbfc,
      isBankOrInsurance: isBank || isInsurance,
      isBank,
      isInsurance,
      specialEntityTypes: special,
      priorIndAs: captured.priorIndAs,
      voluntaryIndAs: captured.voluntaryIndAs,
      groupTriggersIndAs: captured.groupTriggersIndAs,
      netWorth,
      netWorthHistory,
      turnover,
      borrowings,
      priorFramework,
      priorFrameworkSource,
      indAsAlreadyApplicable: captured.indAsAlreadyApplicable ?? null,
      firstIndAsFy: captured.firstIndAsFy ?? null,
      originalTrigger: captured.originalTrigger ?? null,
      voluntaryAnswer: captured.voluntaryAnswer ?? null,
      voluntaryFirstIndAsFy: captured.voluntaryFirstIndAsFy ?? null,
      relatedEntities,
      groupAnswer: captured.groupAnswer ?? null,
      groupNonSmc: captured.groupNonSmc ?? null,
      auditFinancialYear,
      auditPeriodStart,
    },
  };
}

/**
 * Read the 02.2 assessments of an engagement (optionally one workflow) — live
 * suggestion while undecided, the stored conclusion once decided — with the
 * FRF-05/06 state and the §21 completion. No writes.
 */
export async function loadFinancialReportingOn(
  client: PoolClient,
  engagementId: string,
  opts: {
    workflowInstanceId?: string;
    viewerEmployeeId?: string | null;
    resolver?: ResolverFactory;
    withMasterFill?: boolean;
  } = {},
): Promise<StatutoryAuditFinancialReporting[]> {
  const resolverFor = opts.resolver ?? buildRuleResolverOn;
  const { rows } = await client.query<SubRow>(
    `${ROW_SQL}
      WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
        AND ($4::uuid IS NULL OR s.workflow_instance_id = $4::uuid)
      ORDER BY swi.created_at ASC`,
    [engagementId, SUB, AREA, opts.workflowInstanceId ?? null],
  );
  const out: StatutoryAuditFinancialReporting[] = [];
  for (const r of rows) {
    const captured = { ...DEFAULT_CAPTURED, ...(r.facts ?? {}) };
    const { facts, profileConfirmed } = await assembleFinancialReportingFacts(
      client,
      engagementId,
      r.workflow_instance_id,
      captured,
    );
    let assessment: FrameworkSubAssessment;
    let detail: FinancialReportingDetail | null;
    if (isDecided(r.state)) {
      assessment = mapAssessment(r);
      detail = r.system_detail;
    } else {
      const resolve = await resolverFor(client, facts.auditPeriodStart!);
      const res = assessFinancialReporting(facts, resolve);
      detail = res.detail;
      assessment = {
        ...mapAssessment(r),
        state: r.professional_action === 'information_pending' ? 'pending_information' : res.state,
        systemOutcome: res.outcome,
        systemBasis: res.basis,
        systemDetail: res.detail,
        ruleVersionId: res.ruleVersionId,
        authorityProvisionId: res.authorityProvisionId,
        conclusion: null,
        isOverridden: false,
        facts: captured,
      };
    }
    const decision = {
      state: assessment.state,
      conclusion: assessment.conclusion,
      systemOutcome: assessment.systemOutcome,
      isOverridden: assessment.isOverridden,
    };
    const partnerReason = isDecided(assessment.state)
      ? partnerApprovalReason(decision, detail)
      : null;
    const blockingReviewOpen = await reviewMatterOpen(client, r.workflow_instance_id);
    const framework = isDecided(assessment.state) ? assessment.conclusion : null;
    const firstSystem =
      (framework ?? assessment.systemOutcome) === REPORTING_FRAMEWORK_OUTCOME.indAs &&
      (detail?.firstTimeIndAs ?? false);
    const confirmedFirst = captured.firstTimeAdoption ?? null;
    const completion = financialReportingCompletion({
      decision,
      detail,
      facts,
      captured,
      profileConfirmed,
      partnerRequired: partnerReason != null,
      partnerApproved: r.partner_approved_at != null,
      blockingReviewOpen,
    });
    const fill = opts.withMasterFill
      ? await masterFillOn(client, r.workflow_instance_id)
      : null;
    out.push({
      workflowInstanceId: r.workflow_instance_id,
      engagementServiceId: r.engagement_service_id,
      engagementId: r.engagement_id,
      assessment,
      detail,
      capturedFacts: captured,
      baseFacts: facts,
      profileConfirmed,
      masterFacts: fill?.facts ?? [],
      auditFinancialYear: facts.auditFinancialYear,
      professionalAction: r.professional_action,
      pendingReason: r.pending_reason,
      partnerApproval: {
        required: partnerReason != null,
        reason: partnerReason,
        approvedByName: r.partner_approved_by_name,
        approvedAt: r.partner_approved_at ? r.partner_approved_at.toISOString() : null,
        note: r.partner_note,
      },
      firstTimeAdoption: {
        system: firstSystem,
        confirmed: confirmedFirst,
        effective:
          (framework ?? assessment.systemOutcome) === REPORTING_FRAMEWORK_OUTCOME.indAs &&
          (confirmedFirst ?? firstSystem),
        reason: captured.firstTimeAdoptionReason ?? null,
      },
      completion,
      memoSuggested:
        assessment.isOverridden ||
        partnerReason != null ||
        blockingReviewOpen ||
        r.professional_action === 'information_pending' ||
        detail?.confidence === 'professional_review_required',
      blockingReviewOpen,
      approved: r.state === 'approved',
      viewerIsPartner:
        opts.viewerEmployeeId != null && opts.viewerEmployeeId === r.engagement_partner_id,
    });
  }
  return out;
}

async function reviewMatterOpen(client: PoolClient, workflowInstanceId: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM hsdg.audit_matter
      WHERE workflow_instance_id = $1 AND source = $2 AND is_blocking
        AND status <> ALL($3::text[])`,
    [workflowInstanceId, FRF_REVIEW_MATTER_SOURCE, MATTER_CLOSED_STATUSES],
  );
  return (rowCount ?? 0) > 0;
}

/** What the portal already knows for 02.2, or null when the shell is gone. */
async function masterFillOn(client: PoolClient, workflowInstanceId: string) {
  const master = await readEngagementMasterFacts(client, workflowInstanceId);
  if (!master) return null;
  const prior = await readPriorSubAssessment(client, workflowInstanceId, { sub: SUB, area: AREA });
  return financialReportingFromSources(master, prior);
}

/**
 * 02.2 Financial Reporting Framework service (Section 02.2 spec). Reads the
 * confirmed 02.1 facts + masters (never re-asking them), captures the FRF-01..06
 * answers, runs the pure Rule-4 engine, and records the FRF-05 professional
 * conclusion (confirm / override with basis / information pending), the
 * Engagement Partner approval of a significant override or complex conclusion,
 * and keeps the §19 blocking Framework Review matter in step.
 */
@Injectable()
export class AuditFinancialReportingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
    private readonly matters: AuditMattersService,
  ) {}

  private readonly resolverFactory: ResolverFactory = (client, start) =>
    this.rules.buildResolverOn(client, start);

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
  ): Promise<StatutoryAuditFinancialReporting[]> {
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
      return this.read(client, ctx, engagementId);
    });
  }

  private read(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId?: string,
  ): Promise<StatutoryAuditFinancialReporting[]> {
    return loadFinancialReportingOn(client, engagementId, {
      workflowInstanceId,
      viewerEmployeeId: ctx.employeeId ?? null,
      resolver: this.resolverFactory,
      withMasterFill: true,
    });
  }

  private async readOne(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditFinancialReporting> {
    const [fr] = await this.read(client, ctx, engagementId, workflowInstanceId);
    if (!fr) throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    return fr;
  }

  // ── Capture the 02.2 answers (FRF-01..04, 06, group, SMC) ───────────────────

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetFinancialReportingFactsInput,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();
      const current = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      const merged: FinancialReportingCapturedFacts = { ...current };
      const keys = [
        'isListedOnSmeExchange',
        'priorIndAs',
        'voluntaryIndAs',
        'groupTriggersIndAs',
        'priorFramework',
        'priorFrameworkSource',
        'indAsAlreadyApplicable',
        'firstIndAsFy',
        'originalTrigger',
        'voluntaryAnswer',
        'voluntaryFirstIndAsFy',
        'groupAnswer',
        'groupNonSmc',
        'smcMaxBorrowings',
        'firstTimeAdoption',
        'firstTimeAdoptionReason',
      ] as const;
      for (const k of keys) {
        if (input[k] === undefined) continue;
        const v = input[k];
        (merged as unknown as Record<string, unknown>)[k] =
          typeof v === 'string' ? v.trim() || null : v;
      }
      for (const fy of [merged.firstIndAsFy, merged.voluntaryFirstIndAsFy]) {
        if (fy != null && !FY_RE.test(fy))
          throw new BadRequestException('Financial years must be in the form YYYY-YY.');
      }
      // Keep the legacy booleans in step with the FRF answers.
      if (input.indAsAlreadyApplicable !== undefined)
        merged.priorIndAs = merged.indAsAlreadyApplicable === 'yes';
      if (input.voluntaryAnswer !== undefined)
        merged.voluntaryIndAs = merged.voluntaryAnswer === 'yes';
      if (input.voluntaryIndAs !== undefined && input.voluntaryAnswer === undefined)
        merged.voluntaryAnswer = input.voluntaryIndAs ? 'yes' : 'no';
      if (input.groupAnswer !== undefined) merged.groupTriggersIndAs = merged.groupAnswer === 'yes';

      // FRF-06 override of the system suggestion needs a reason.
      if (input.firstTimeAdoption !== undefined && merged.firstTimeAdoption != null) {
        const [live] = await this.read(client, ctx, engagementId, workflowInstanceId);
        if (
          live &&
          merged.firstTimeAdoption !== live.firstTimeAdoption?.system &&
          !merged.firstTimeAdoptionReason
        )
          throw new BadRequestException(
            'A reason is required when overriding the first-time adoption suggestion.',
          );
      }

      const onlyFirstTime = keys.every(
        (k) =>
          k === 'firstTimeAdoption' || k === 'firstTimeAdoptionReason' || input[k] === undefined,
      );
      // A changed fact invalidates a recorded conclusion (it must reflect the facts);
      // FRF-06 sits on top of the conclusion and does not.
      const clearDecision = isDecided(row.state) && !onlyFirstTime;
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1`,
        [row.id, JSON.stringify(merged)],
      );
      if (clearDecision) await this.clearDecision(client, row.id);
      await this.persistSuggestion(client, engagementId, row.id, workflowInstanceId, merged);
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_reporting_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        before: current,
        after: { ...merged, decisionCleared: clearDecision },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── Fill from the client master and portal records (Guide §1) ──────────────

  /**
   * First open by a lead fills the never-touched 02.2 facts from the portal
   * and runs the engine. One-shot: only rows whose facts were never stored, so
   * the team's later edits are never refilled. Public so the 02.9 summary can
   * trigger it too.
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
    const open = rows.filter((r) => !isDecided(r.state));
    if (open.length === 0 || !(await isEngagementLead(client, engagementId))) return;
    for (const r of open) {
      const fill = await masterFillOn(client, r.workflow_instance_id);
      if (!fill) continue;
      const { next, filled } = fillFinancialReporting({ ...DEFAULT_CAPTURED }, fill);
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $2::jsonb, version = version + 1
          WHERE id = $1 AND facts IS NULL`,
        [r.id, JSON.stringify(next)],
      );
      await this.persistSuggestion(client, engagementId, r.id, r.workflow_instance_id, next);
      await this.matters.syncFrameworkOn(client, ctx, engagementId, r.workflow_instance_id);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_reporting_prefilled',
        objectType: 'audit_framework_subassessment',
        objectId: r.id,
        after: { filled, automatic: true },
      });
    }
  }

  /** "Fill from client master": fills blanks / switches on facts; never overwrites the team. */
  async fillFromMaster(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditFinancialReportingMasterFillResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const fill = await masterFillOn(client, workflowInstanceId);
      if (!fill) throw new NotFoundException('Statutory-audit workflow not found.');
      const { next, filled } = fillFinancialReporting(
        { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) },
        fill,
      );
      if (filled.length > 0 || row.facts == null) {
        await client.query(
          `UPDATE hsdg.audit_framework_subassessment
              SET facts = $2::jsonb, version = version + 1
            WHERE id = $1`,
          [row.id, JSON.stringify(next)],
        );
        if (filled.length > 0 && isDecided(row.state)) await this.clearDecision(client, row.id);
        await this.persistSuggestion(client, engagementId, row.id, workflowInstanceId, next);
        await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.financial_reporting_prefilled',
          objectType: 'audit_framework_subassessment',
          objectId: row.id,
          after: { filled },
        });
      }
      return {
        financialReporting: await this.readOne(client, ctx, engagementId, workflowInstanceId),
        filled,
      };
    });
  }

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      await this.persistSuggestion(client, engagementId, row.id, workflowInstanceId, captured);
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_reporting_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── FRF-05 professional conclusion ──────────────────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordFinancialReportingDecisionInput,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (row.version !== input.version) throw stale();

      const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      const { facts } = await assembleFinancialReportingFacts(
        client,
        engagementId,
        workflowInstanceId,
        captured,
      );
      const resolve = await this.rules.buildResolverOn(client, facts.auditPeriodStart!);
      const res = assessFinancialReporting(facts, resolve);

      const action: FrfProfessionalAction =
        input.action ??
        (input.conclusion && input.conclusion !== res.outcome
          ? FRF_PROFESSIONAL_ACTION.override
          : FRF_PROFESSIONAL_ACTION.confirm);

      if (action === FRF_PROFESSIONAL_ACTION.informationPending) {
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
        await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
        await this.audit.recordWith(client, ctx, {
          action: 'statutory_audit.financial_reporting_decision',
          objectType: 'audit_framework_subassessment',
          objectId: row.id,
          after: { action, pendingReason: reason },
        });
        return this.readOne(client, ctx, engagementId, workflowInstanceId);
      }

      let conclusion: ReportingFrameworkOutcome;
      if (action === FRF_PROFESSIONAL_ACTION.confirm) {
        if (!DECISIVE.has(res.outcome))
          throw new BadRequestException(
            'The system could not determine the framework — override with a conclusion and basis, or mark Information Pending.',
          );
        if (input.conclusion && input.conclusion !== res.outcome)
          throw new BadRequestException('Confirm takes the system assessment; use Override to change it.');
        conclusion = res.outcome;
      } else {
        if (!input.conclusion || !REPORTING_FRAMEWORK_CONCLUSIONS.includes(input.conclusion))
          throw new BadRequestException('Not a valid reporting-framework conclusion.');
        conclusion = input.conclusion;
      }
      const isOverridden = DECISIVE.has(res.outcome) && conclusion !== res.outcome;
      const basis = input.basis?.trim() || null;
      if ((isOverridden || action === FRF_PROFESSIONAL_ACTION.override) && !basis)
        throw new BadRequestException(
          'A basis is required when the conclusion overrides the system suggestion.',
        );
      const state: FrameworkState = isOverridden ? 'overridden' : 'applicable';

      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET conclusion = $2, is_overridden = $3, basis = $4, impact = $5, state = $6,
                system_outcome = $7, system_basis = $8, system_detail = $9::jsonb,
                rule_version_id = $10, authority_provision_id = $11,
                decided_by_employee_id = $12, decided_at = now(),
                professional_action = $13, pending_reason = NULL,
                partner_approved_by_employee_id = NULL, partner_approved_at = NULL,
                partner_note = NULL, needs_reevaluation = false, version = version + 1
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
          isOverridden ? FRF_PROFESSIONAL_ACTION.override : action,
        ],
      );
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_reporting_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { action, conclusion, isOverridden },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── FRF-05 Engagement Partner approval ──────────────────────────────────────

  async partnerApprove(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: PartnerApproveFinancialReportingInput,
  ): Promise<StatutoryAuditFinancialReporting> {
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
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_reporting_partner_approved',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { reason: live.partnerApproval.reason, note: input.note ?? null },
      });
      return this.readOne(client, ctx, engagementId, workflowInstanceId);
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async clearDecision(client: PoolClient, rowId: string): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET conclusion = NULL, is_overridden = false, basis = NULL, state = 'not_assessed',
              decided_by_employee_id = NULL, decided_at = NULL, professional_action = NULL,
              pending_reason = NULL, partner_approved_by_employee_id = NULL,
              partner_approved_at = NULL, partner_note = NULL
        WHERE id = $1`,
      [rowId],
    );
  }

  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    workflowInstanceId: string,
    captured: FinancialReportingCapturedFacts,
  ): Promise<void> {
    // Never overwrite a professional conclusion (§19).
    const { rows } = await client.query<{ state: FrameworkState; professional_action: string | null }>(
      `SELECT state, professional_action FROM hsdg.audit_framework_subassessment WHERE id = $1`,
      [rowId],
    );
    if (rows[0] && isDecided(rows[0].state)) return;
    const { facts } = await assembleFinancialReportingFacts(
      client,
      engagementId,
      workflowInstanceId,
      captured,
    );
    const resolve = await this.rules.buildResolverOn(client, facts.auditPeriodStart!);
    const res = assessFinancialReporting(facts, resolve);
    const keepPending = rows[0]?.professional_action === 'information_pending';
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
        'The framework is approved; a controlled reassessment must reopen it before editing 02.2.',
      );
    }
  }
}

function stale(): ConflictException {
  return new ConflictException('This assessment changed since you loaded it; refresh and retry.');
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

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function prevFy(fy: string): string {
  const s = Number(fy.slice(0, 4)) - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

function fyEnd(fy: string): string {
  return `${Number(fy.slice(0, 4)) + 1}-03-31`;
}

/** A supporting reference opens only when it is an https link (never a bare path). */
function httpsOnly(ref: string | null): string | null {
  const v = ref?.trim();
  return v && /^https:\/\/\S+$/.test(v) ? v : null;
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CUSTOM_METRIC_PREFIX,
  FINANCIAL_UNIT_FACTOR,
  FINANCIAL_METRIC_DEFS,
  INDUSTRY_PROFILE_LABEL,
  NOTIFICATION_TYPE,
  PLANNING_ACTOR_ROLE_LABEL,
  REGULATOR_LABEL,
  SPECIAL_ENTITY_LABEL,
  UNDERSTANDING_CHALLENGE_KINDS,
  UNDERSTANDING_CHALLENGE_TARGETS,
  planningVersionLabel,
  type CreateUnderstandingChallengeInput,
  type DecideIndustryConsiderationInput,
  type IndustryConsiderationDecision,
  type Regulator,
  type ReopenUnderstandingInput,
  type RespondUnderstandingChallengeInput,
  type CloseUnderstandingChallengeInput,
  type SpecialEntityType,
  type UnderstandingAccess,
  type UnderstandingChallengeRecord,
  type UnderstandingChallengeTarget,
  type UnderstandingFocusLink,
  type UnderstandingRevisionChange,
  type UnderstandingRevisionDetail,
  type UnderstandingRevisionRecord,
  type UnderstandingVersionInfo,
  INVESTIGATION_ASSESSMENT,
  EXPECTATION_CONCLUSION_LABEL,
  INVESTIGATION_ASSESSMENT_LABEL,
  INVESTIGATION_SIGNAL_DECISION,
  PLANNING_ATTENTION,
  PLANNING_CHANGE_CATEGORY_LABEL,
  PLANNING_SIGNAL_SOURCE,
  UNDERSTANDING_SECTION_DEFS,
  UNDERSTANDING_SECTIONS,
  type AnalyticsResult,
  type AssessInvestigationInput,
  type Ba01Answer,
  type BusinessUnderstandingRecord,
  type BusinessUnderstandingSummary,
  type CreatePlanningExpectationInput,
  type CustomMetricRecord,
  type ExpectationBasis,
  type ExpectationConclusion,
  type ExpectationDirection,
  type ExpectationType,
  type FinancialDatasetHeader,
  type FinancialPeriod,
  type FinancialUnit,
  type FinancialValueRecord,
  type IndustryProfile,
  type InvestigationAssessment,
  type InvestigationCardRecord,
  type InvestigationSignalDecision,
  type InvestigationStatus,
  type MetricSourceType,
  type PlanningAttention,
  type PlanningChangeCategory,
  type PlanningCompletionCheck,
  type PlanningExpectationRecord,
  type SaveFinancialValuesInput,
  type UnderstandingAnswer,
  type UnderstandingContextItem,
  type UnderstandingSectionKey,
  type UnderstandingSectionRecord,
  type UnderstandingStatus,
  type UpdateBusinessUnderstandingInput,
  type UpdateFinancialDatasetInput,
  type UpdatePlanningExpectationInput,
  type UpdateUnderstandingSectionInput,
  type DatasetStatus,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditPlanningStrategyService } from './audit-planning-strategy.service';
import {
  assertPlanningCapability,
  notifyPlanning,
  readPlanningLock,
  resolvePlanningActor,
} from './planning-governance';
import {
  planUnderstandingPrefill,
  readEngagementMasterFacts,
  readPriorAuditFile,
  understandingContextFacts,
} from './master-facts';
import { INDUSTRY_PROFILE_CONFIG, runPreliminaryAnalytics } from './planning-analytics-engine';
import {
  assertShell,
  assertSignalsInShell,
  clean,
  displayCode,
  insertSignal,
} from './planning-shared';
import { mergePriorSections, priorYearValues } from './planning-prior-year';

/** The Phase 03 checklist row 03.2 rolls its state up into. */
const UNDERSTANDING_ITEM_KEY = 'engagement_understanding';

const CANONICAL_KEYS = new Set<string>(FINANCIAL_METRIC_DEFS.map((d) => d.key));

/** PI-01 change categories surfaced as read-only context per section (never re-asked). */
const SECTION_CHANGE_CONTEXT: Partial<
  Record<UnderstandingSectionKey, PlanningChangeCategory[] | 'all'>
> = {
  business_model: 'all',
  governance: ['ownership_promoters', 'key_management', 'related_parties'],
  industry: ['regulatory_environment', 'geography_locations'],
  systems: ['erp_accounting_system', 'accounting_policies'],
  objectives: [
    'acquisition_disposal',
    'restructuring',
    'business_model',
    'subsidiary_jv_associate',
  ],
  performance: ['borrowings_financing', 'going_concern'],
};

interface RecordRow {
  id: string;
  engagement_id: string;
  status: UnderstandingStatus;
  industry_profile: IndustryProfile;
  ba01: Ba01Answer | null;
  conclusion_summary: string | null;
  master_prefilled_at: Date | null;
  version: number;
  version_no: number;
  completed_at: Date | null;
  completed_by_employee_id: string | null;
  reassessment_reason: string | null;
  reassessment_flagged_at: Date | null;
  industry_consideration_decisions: Record<string, IndustryConsiderationDecision> | null;
}

/** 03.2 as it stood when completed — frozen into a revision (§20). */
export interface UnderstandingSnapshot {
  record: { ba01: Ba01Answer | null; conclusionSummary: string | null; industryProfile: string };
  sections: Array<{
    key: UnderstandingSectionKey;
    anythingChanged: 'yes' | 'no' | null;
    answers: Record<string, UnderstandingAnswer>;
    reviewed: boolean;
  }>;
  values: Array<{ metricKey: string; label: string; period: FinancialPeriod; amount: number }>;
  cards: Array<{
    id: string;
    code: string;
    observation: string;
    assessment: InvestigationAssessment | null;
    signalCode: string | null;
    status: InvestigationStatus;
  }>;
  expectations: Array<{ id: string; label: string; conclusion: ExpectationConclusion | null }>;
}

interface RevisionRow {
  id: string;
  from_version_no: number;
  to_version_no: number;
  reason: string;
  status: 'open' | 'completed';
  opened_by_name: string | null;
  opened_at: Date;
  completed_by_name: string | null;
  completed_at: Date | null;
}

interface ChallengeRow {
  id: string;
  seq: number;
  target_type: UnderstandingChallengeTarget;
  target_ref: string | null;
  kind: 'comment' | 'challenge';
  body: string;
  raised_by_name: string | null;
  raised_at: Date;
  response: string | null;
  responded_by_name: string | null;
  responded_at: Date | null;
  status: 'open' | 'responded' | 'closed';
  version: number;
}

const SCOPE = '03.2';

/** The §25 references every 03.2 shows, plus industry guidance by profile. */
const GENERIC_AUTHORITY_ANCHORS = ['view_sa_315', 'view_sa_520', 'view_sa_300', 'view_ig_rba'];
const INDUSTRY_AUTHORITY_ANCHORS: Partial<Record<string, string[]>> = {
  construction: ['industry_construction', 'industry_construction_as'],
  nbfc: ['industry_nbfc'],
};

/** §20 — a completed 03.2 is frozen until it is reopened for a controlled revision. */
function assertWritable(r: Pick<RecordRow, 'status' | 'version_no'>): void {
  if (r.status === 'complete') {
    throw new ConflictException(
      `03.2 ${planningVersionLabel(r.version_no)} is complete — reopen it for a controlled revision to change it.`,
    );
  }
}

interface SectionRow {
  section_key: UnderstandingSectionKey;
  anything_changed: 'yes' | 'no' | null;
  answers: Record<string, UnderstandingAnswer>;
  reviewed: boolean;
  reviewed_at: Date | null;
  version: number;
}

interface DatasetRow {
  period_end: string | null;
  py_period_end: string | null;
  currency: string | null;
  units: FinancialUnit | null;
  py_units: FinancialUnit | null;
  cy_source: string | null;
  py_source: string | null;
  data_status: DatasetStatus | null;
  source_date: string | null;
  prepared_by_name: string | null;
  version: number;
}

interface ValueRow {
  metric_key: string;
  period: FinancialPeriod;
  amount: string;
  source_type: MetricSourceType;
  source_ref: string | null;
  note: string | null;
  entered_by_name: string | null;
  entered_at: Date;
  version: number;
  rolled_forward_amount: string | null;
  rolled_forward_approved: boolean;
  override_reason: string | null;
  rolled_forward_fy: string | null;
}

interface ExceptionRow {
  id: string;
  seq: number;
  rule_key: string;
  observation: string;
  why_flagged: string;
  suggested_attention: PlanningAttention;
  values: Record<string, number | null>;
  management_explanation: string | null;
  explanation_by: string | null;
  explanation_date: string | null;
  evidence: string | null;
  assessment: InvestigationAssessment | null;
  affected_areas: string[];
  signal_decision: InvestigationSignalDecision | null;
  no_signal_rationale: string | null;
  signal_id: string | null;
  signal_seq: number | null;
  owner_employee_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  status: InvestigationStatus;
  needs_reassessment: boolean;
  no_longer_flagged: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface ExpectationRow {
  id: string;
  metric_key: string;
  expectation_type: ExpectationType;
  expected_amount: string | null;
  expected_low: string | null;
  expected_high: string | null;
  expected_direction: ExpectationDirection | null;
  tolerance_pct: string | null;
  basis: ExpectationBasis;
  basis_note: string | null;
  requires_investigation: boolean | null;
  conclusion: ExpectationConclusion | null;
  signal_id: string | null;
  signal_seq: number | null;
  version: number;
}

const EXCEPTION_SELECT = `
  SELECT x.id, x.seq, x.rule_key, x.observation, x.why_flagged, x.suggested_attention, x.values,
         x.management_explanation, x.explanation_by, x.explanation_date::text, x.evidence,
         x.assessment, x.affected_areas, x.signal_decision, x.no_signal_rationale, x.signal_id,
         s.seq AS signal_seq, x.owner_employee_id, owner.full_name AS owner_name,
         x.due_date::text, x.status, x.needs_reassessment, x.no_longer_flagged, x.version,
         x.created_at, x.updated_at
    FROM hsdg.audit_analytics_exception x
    LEFT JOIN hsdg.audit_planning_signal s ON s.id = x.signal_id
    LEFT JOIN hsdg.employees owner ON owner.id = x.owner_employee_id`;

const EXPECTATION_SELECT = `
  SELECT e.id, e.metric_key, e.expectation_type, e.expected_amount, e.expected_low,
         e.expected_high, e.expected_direction, e.tolerance_pct, e.basis, e.basis_note,
         e.requires_investigation, e.conclusion, e.signal_id, s.seq AS signal_seq, e.version
    FROM hsdg.audit_planning_expectation e
    LEFT JOIN hsdg.audit_planning_signal s ON s.id = e.signal_id`;

const num = (v: string | null): number | null => (v === null ? null : Number(v));

const metricLabel = (key: string): string =>
  FINANCIAL_METRIC_DEFS.find((d) => d.key === key)?.label ?? key;

/** Investigation Card fields only the Engagement Manager sets (§23). */
const MANAGER_CARD_FIELDS = [
  'assessment',
  'signalDecision',
  'linkSignalId',
  'noSignalRationale',
  'ownerEmployeeId',
  'dueDate',
] as const;

/**
 * 03.2 Business Understanding & Preliminary Analytics (DHVAJ 03.2).
 *
 * The portal calculates and relates; the auditor interprets. Analytical
 * exceptions open Investigation Cards; findings become Planning Signals in the
 * SAME register as 03.1. Nothing here concludes misstatement, RMM or
 * materiality, and there is no trial-balance import in v1.
 */
@Injectable()
export class AuditBusinessUnderstandingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly strategy: AuditPlanningStrategyService,
  ) {}

  // ── Summary / record ───────────────────────────────────────────────────────

  async getSummary(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<BusinessUnderstandingSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const record = await this.ensureRecord(client, engagementId, workflowInstanceId);
      // Capture-once: the first open by anyone who records facts (§23 — Article
      // and up) seeds 03.2 from the masters (one-shot, so a figure the team
      // later removes is never silently put back). A completed or frozen 03.2
      // is never touched; a viewer without the capability sees it as it is.
      if (!record.master_prefilled_at && record.status !== 'complete') {
        const actor = await resolvePlanningActor(client, engagementId);
        if (
          actor.capabilities.addFacts &&
          !(await readPlanningLock(client, workflowInstanceId)).locked
        ) {
          await this.applyMasterPrefill(client, ctx, engagementId, workflowInstanceId);
        }
      }
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  /**
   * "Fill from client master" — re-run the prefill on request after the master
   * has been updated. Only blanks are filled; recorded figures and saved
   * sections are never overwritten.
   */
  async prefillFromMasters(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<BusinessUnderstandingSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      assertWritable(await this.ensureRecord(client, engagementId, workflowInstanceId));
      await this.applyMasterPrefill(client, ctx, engagementId, workflowInstanceId);
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  /** Industry profile and BA-01 (§19). BA-01 "Yes — Complete" completes 03.2. */
  async updateRecord(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: UpdateBusinessUnderstandingInput,
  ): Promise<BusinessUnderstandingSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const current = await this.ensureRecord(client, engagementId, workflowInstanceId);
      assertWritable(current);
      const nextProfile = input.industryProfile ?? current.industry_profile;
      const nextBa01 = input.ba01 !== undefined ? input.ba01 : current.ba01;
      const nextSummary =
        input.conclusionSummary !== undefined
          ? clean(input.conclusionSummary)
          : current.conclusion_summary;

      if (nextProfile !== current.industry_profile) {
        // The profile changes the analytics; refresh the cards before checking completion.
        await client.query(
          `UPDATE hsdg.audit_business_understanding SET industry_profile = $2
            WHERE workflow_instance_id = $1`,
          [workflowInstanceId, nextProfile],
        );
        await this.syncExceptions(client, ctx, engagementId, workflowInstanceId);
      }
      if (nextBa01 === 'yes_complete') {
        const checks = await this.computeCompletion(client, workflowInstanceId, {
          ba01: nextBa01,
          conclusionSummary: nextSummary,
        });
        const problems = checks.filter((c) => !c.met).map((c) => c.detail ?? c.label);
        if (problems.length) {
          throw new ConflictException(`03.2 cannot be completed yet: ${problems.join(' ')}`);
        }
      }
      const completing = nextBa01 === 'yes_complete';
      // A system-flagged reassessment stays flagged until 03.2 is completed again.
      const status: UnderstandingStatus = completing
        ? 'complete'
        : current.status === 'reassessment_required'
          ? 'reassessment_required'
          : 'in_progress';
      const { rows } = await client.query<RecordRow>(
        `UPDATE hsdg.audit_business_understanding
            SET industry_profile = $3, ba01 = $4, conclusion_summary = $5, status = $6,
                completed_at = CASE WHEN $7 THEN now() END,
                completed_by_employee_id = CASE WHEN $7 THEN $8::uuid END,
                reassessment_reason = CASE WHEN $7 THEN NULL ELSE reassessment_reason END,
                reassessment_flagged_at = CASE WHEN $7 THEN NULL ELSE reassessment_flagged_at END,
                version = version + 1
          WHERE workflow_instance_id = $1 AND version = $2
        RETURNING *`,
        [
          workflowInstanceId,
          input.version,
          nextProfile,
          nextBa01,
          nextSummary,
          status,
          completing,
          ctx.employeeId ?? null,
        ],
      );
      if (!rows[0]) {
        throw new ConflictException('03.2 changed since you loaded it; refresh and retry.');
      }
      if (completing) {
        // Completing a revision closes it: v1.n is now the concluded version.
        await client.query(
          `UPDATE hsdg.audit_understanding_revision
              SET status = 'completed', completed_by_employee_id = $2, completed_at = now()
            WHERE workflow_instance_id = $1 AND status = 'open'`,
          [workflowInstanceId, ctx.employeeId ?? null],
        );
      }
      await this.rollUp(client, ctx, workflowInstanceId, status);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.business_understanding_updated',
        objectType: 'audit_business_understanding',
        objectId: rows[0].id,
        before: { profile: current.industry_profile, ba01: current.ba01 },
        after: { profile: nextProfile, ba01: nextBa01, status },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  /** Generate the §19 conclusion block from structured data (not persisted). */
  async draftConclusion(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ draft: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      await this.ensureRecord(client, engagementId, workflowInstanceId);
      const summary = await this.buildSummary(client, workflowInstanceId);
      const cards = await this.readExceptions(client, workflowInstanceId);
      return { draft: composeUnderstandingConclusion(summary, cards) };
    });
  }

  // ── 03.2.1–03.2.6 Sections ─────────────────────────────────────────────────

  async saveSection(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    sectionKey: UnderstandingSectionKey,
    input: UpdateUnderstandingSectionInput,
  ): Promise<UnderstandingSectionRecord> {
    const def = UNDERSTANDING_SECTION_DEFS.find((d) => d.key === sectionKey);
    if (!def) throw new NotFoundException('Unknown 03.2 section.');
    const answers = input.answers ? validateAnswers(sectionKey, input.answers) : undefined;

    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      assertWritable(await this.ensureRecord(client, engagementId, workflowInstanceId));
      // A content change by anyone clears "reviewed" — the Manager reviews what
      // is there now. Marking (or un-marking) reviewed is the Manager's (§23).
      const { rows: cur } = await client.query<{ changed: boolean; reviewed: boolean }>(
        `SELECT ($3::jsonb IS NOT NULL AND $3::jsonb IS DISTINCT FROM answers)
                OR ($4::boolean AND $5::text IS DISTINCT FROM anything_changed) AS changed,
                reviewed
           FROM hsdg.audit_understanding_section
          WHERE workflow_instance_id = $1 AND section_key = $2`,
        [
          workflowInstanceId,
          sectionKey,
          answers ? JSON.stringify(answers) : null,
          input.anythingChanged !== undefined,
          input.anythingChanged ?? null,
        ],
      );
      if (input.reviewed !== undefined && input.reviewed !== (cur[0]?.reviewed ?? false)) {
        assertPlanningCapability(await resolvePlanningActor(client, engagementId), 'assess', SCOPE);
      }
      const reviewed = input.reviewed ?? (cur[0]?.changed ? false : undefined);
      const result =
        input.version === 0
          ? await client.query(
              `INSERT INTO hsdg.audit_understanding_section
                 (workflow_instance_id, engagement_id, section_key, anything_changed, answers,
                  reviewed, reviewed_at, reviewed_by_employee_id)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6,
                       CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN $7::uuid END)
               ON CONFLICT (workflow_instance_id, section_key) DO NOTHING`,
              [
                workflowInstanceId,
                engagementId,
                sectionKey,
                input.anythingChanged ?? null,
                JSON.stringify(answers ?? {}),
                reviewed ?? false,
                ctx.employeeId ?? null,
              ],
            )
          : await client.query(
              `UPDATE hsdg.audit_understanding_section
                  SET anything_changed = CASE WHEN $4::boolean THEN $5 ELSE anything_changed END,
                      answers = COALESCE($6::jsonb, answers),
                      reviewed = COALESCE($7, reviewed),
                      reviewed_at = CASE WHEN $7 IS TRUE AND NOT reviewed THEN now()
                                         WHEN $7 IS FALSE THEN NULL ELSE reviewed_at END,
                      reviewed_by_employee_id = CASE WHEN $7 IS TRUE AND NOT reviewed THEN $8::uuid
                                                     WHEN $7 IS FALSE THEN NULL
                                                     ELSE reviewed_by_employee_id END,
                      version = version + 1
                WHERE workflow_instance_id = $1 AND section_key = $2 AND version = $3`,
              [
                workflowInstanceId,
                sectionKey,
                input.version,
                input.anythingChanged !== undefined,
                input.anythingChanged ?? null,
                answers ? JSON.stringify(answers) : null,
                reviewed ?? null,
                ctx.employeeId ?? null,
              ],
            );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('This section changed since you loaded it; refresh and retry.');
      }
      await this.markInProgress(client, ctx, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.understanding_section_saved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { section: sectionKey, reviewed: reviewed ?? null },
      });
      const sections = await this.readSections(client, workflowInstanceId);
      return sections.find((s) => s.key === sectionKey)!;
    });
  }

  // ── 03.2.7 Focused Financial Dataset ───────────────────────────────────────

  async saveDataset(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: UpdateFinancialDatasetInput,
  ): Promise<BusinessUnderstandingSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      assertWritable(await this.ensureRecord(client, engagementId, workflowInstanceId));
      // [column, provided?, value] — omitted fields stay unchanged.
      const fields: Array<[string, boolean, unknown]> = [
        ['period_end', input.periodEnd !== undefined, input.periodEnd ?? null],
        ['py_period_end', input.pyPeriodEnd !== undefined, input.pyPeriodEnd ?? null],
        ['currency', input.currency !== undefined, clean(input.currency)?.toUpperCase() ?? null],
        ['units', input.units !== undefined, input.units ?? null],
        ['py_units', input.pyUnits !== undefined, input.pyUnits ?? null],
        ['cy_source', input.cySource !== undefined, clean(input.cySource)],
        ['py_source', input.pySource !== undefined, clean(input.pySource)],
        ['data_status', input.dataStatus !== undefined, input.dataStatus ?? null],
        ['source_date', input.sourceDate !== undefined, input.sourceDate ?? null],
      ];
      if (input.version === 0) {
        const ins = await client.query(
          `INSERT INTO hsdg.audit_financial_dataset
             (workflow_instance_id, engagement_id, prepared_by_employee_id)
           VALUES ($1, $2, $3) ON CONFLICT (workflow_instance_id) DO NOTHING`,
          [workflowInstanceId, engagementId, ctx.employeeId ?? null],
        );
        if ((ins.rowCount ?? 0) === 0) {
          throw new ConflictException(
            'The dataset header changed since you loaded it; refresh and retry.',
          );
        }
      }
      // Each column: $n = provided?, $n+1 = value. Dates cast explicitly.
      const casts: Record<string, string> = {
        period_end: '::date',
        py_period_end: '::date',
        source_date: '::date',
      };
      const sets = fields.map(
        ([col], i) =>
          `${col} = CASE WHEN $${i * 2 + 3}::boolean THEN $${i * 2 + 4}${casts[col] ?? ''} ELSE ${col} END`,
      );
      const result = await client.query(
        `UPDATE hsdg.audit_financial_dataset
            SET ${sets.join(',\n                ')},
                prepared_by_employee_id = COALESCE(prepared_by_employee_id, $${fields.length * 2 + 3}::uuid),
                version = version + 1
          WHERE workflow_instance_id = $1 AND version = $2`,
        [
          workflowInstanceId,
          input.version === 0 ? 1 : input.version,
          ...fields.flatMap(([, provided, value]) => [provided, value]),
          ctx.employeeId ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'The dataset header changed since you loaded it; refresh and retry.',
        );
      }
      await this.syncExceptions(client, ctx, engagementId, workflowInstanceId);
      await this.markInProgress(client, ctx, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_dataset_saved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: Object.fromEntries(fields.filter(([, p]) => p).map(([c, , v]) => [c, v])),
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  async addCustomMetric(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    label: string,
  ): Promise<CustomMetricRecord> {
    const name = label?.trim();
    if (!name) throw new BadRequestException('A custom metric needs a label.');
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 50);
    if (!slug) throw new BadRequestException('Use letters or digits in the metric label.');
    const key = `${CUSTOM_METRIC_PREFIX}${slug}`;
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      assertWritable(await this.ensureRecord(client, engagementId, workflowInstanceId));
      const ins = await client.query(
        `INSERT INTO hsdg.audit_financial_custom_metric (workflow_instance_id, engagement_id, metric_key, label)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [workflowInstanceId, engagementId, key, name],
      );
      if ((ins.rowCount ?? 0) === 0) throw new ConflictException('That metric already exists.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_custom_metric_added',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { key, label: name },
      });
      return { key, label: name };
    });
  }

  /**
   * Save dataset figures. Period, currency and units must be recorded first;
   * every figure needs a source. Saving recalculates the analytics and reopens
   * any assessed Investigation Card whose underlying figures changed (§21).
   */
  async saveValues(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SaveFinancialValuesInput,
  ): Promise<BusinessUnderstandingSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      assertWritable(await this.ensureRecord(client, engagementId, workflowInstanceId));
      const header = await this.readDataset(client, workflowInstanceId);
      if (!header.periodEnd || !header.currency || !header.units) {
        throw new BadRequestException(
          'Record the period end, currency and units before entering figures.',
        );
      }
      const custom = new Set(
        (await this.readCustomMetrics(client, workflowInstanceId)).map((c) => c.key),
      );
      // §21 — a prior-year figure rolled forward from last year's APPROVED file
      // is never silently overwritten: changing or clearing it needs a reason.
      const { rows: rolled } = await client.query<{
        metric_key: string;
        period: FinancialPeriod;
        rolled_forward_amount: string;
      }>(
        `SELECT metric_key, period, rolled_forward_amount FROM hsdg.audit_financial_value
          WHERE workflow_instance_id = $1 AND rolled_forward_approved
            AND rolled_forward_amount IS NOT NULL`,
        [workflowInstanceId],
      );
      const rolledAmount = new Map(
        rolled.map((r) => [`${r.metric_key}:${r.period}`, Number(r.rolled_forward_amount)]),
      );
      const overrides: Array<{
        metric: string;
        period: FinancialPeriod;
        rolledForward: number;
        amount: number | null;
        reason: string;
      }> = [];
      for (const v of input.values) {
        if (!CANONICAL_KEYS.has(v.metricKey) && !custom.has(v.metricKey)) {
          throw new BadRequestException(`Unknown metric "${v.metricKey}".`);
        }
        const rolledForward = rolledAmount.get(`${v.metricKey}:${v.period}`);
        const overrideReason = clean(v.overrideReason);
        const departs =
          rolledForward !== undefined &&
          (v.amount === null || Math.abs(Number(v.amount) - rolledForward) >= 0.005);
        if (departs && !overrideReason) {
          throw new BadRequestException(
            `${metricLabel(v.metricKey)} (${v.period.toUpperCase()}) was rolled forward from last year's approved audit file — give a reason to ${v.amount === null ? 'remove' : 'change'} it.`,
          );
        }
        if (departs) {
          overrides.push({
            metric: v.metricKey,
            period: v.period,
            rolledForward: rolledForward!,
            amount: v.amount,
            reason: overrideReason!,
          });
        }
        let result;
        if (v.amount === null) {
          result = await client.query(
            `DELETE FROM hsdg.audit_financial_value
              WHERE workflow_instance_id = $1 AND metric_key = $2 AND period = $3 AND version = $4`,
            [workflowInstanceId, v.metricKey, v.period, v.version],
          );
        } else {
          if (!v.sourceType) {
            throw new BadRequestException(
              `Record the source of ${v.metricKey} (${v.period.toUpperCase()}).`,
            );
          }
          result =
            v.version === 0
              ? await client.query(
                  `INSERT INTO hsdg.audit_financial_value
                     (workflow_instance_id, engagement_id, metric_key, period, amount, source_type,
                      source_ref, note, entered_by_employee_id)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                   ON CONFLICT (workflow_instance_id, metric_key, period) DO NOTHING`,
                  [
                    workflowInstanceId,
                    engagementId,
                    v.metricKey,
                    v.period,
                    v.amount,
                    v.sourceType,
                    clean(v.sourceRef),
                    clean(v.note),
                    ctx.employeeId ?? null,
                  ],
                )
              : await client.query(
                  `UPDATE hsdg.audit_financial_value
                      SET amount = $5, source_type = $6, source_ref = $7, note = $8,
                          entered_by_employee_id = $9, entered_at = now(),
                          override_reason = $10, version = version + 1
                    WHERE workflow_instance_id = $1 AND metric_key = $2 AND period = $3
                      AND version = $4`,
                  [
                    workflowInstanceId,
                    v.metricKey,
                    v.period,
                    v.version,
                    v.amount,
                    v.sourceType,
                    clean(v.sourceRef),
                    clean(v.note),
                    ctx.employeeId ?? null,
                    departs ? overrideReason : null,
                  ],
                );
        }
        if ((result.rowCount ?? 0) === 0) {
          throw new ConflictException(
            `${v.metricKey} (${v.period.toUpperCase()}) changed since you loaded it; refresh and retry.`,
          );
        }
      }
      await this.syncExceptions(client, ctx, engagementId, workflowInstanceId);
      await this.markInProgress(client, ctx, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_values_saved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { count: input.values.length, ...(overrides.length ? { overrides } : {}) },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  // ── 03.2.9 Investigation Cards ─────────────────────────────────────────────

  async listExceptions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<InvestigationCardRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      return this.readExceptions(client, workflowInstanceId);
    });
  }

  /**
   * Record the investigation of an exception (§16). A management explanation on
   * its own never closes the card — only the auditor's assessment does.
   */
  async assessException(
    ctx: RlsContext,
    engagementId: string,
    cardId: string,
    input: AssessInvestigationInput,
  ): Promise<InvestigationCardRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ExceptionRow & { workflow_instance_id: string }>(
        `${EXCEPTION_SELECT.replace('SELECT x.id,', 'SELECT x.workflow_instance_id, x.id,')}
          WHERE x.id = $1 AND x.engagement_id = $2`,
        [cardId, engagementId],
      );
      const card = rows[0];
      if (!card) throw new NotFoundException('Investigation card not found.');
      const wi = card.workflow_instance_id;
      assertWritable(await this.ensureRecord(client, engagementId, wi));
      // §23 — the team records the explanation, evidence and affected areas;
      // the auditor's assessment, the signal decision and owner/due are the Manager's.
      const current: Record<(typeof MANAGER_CARD_FIELDS)[number], unknown> = {
        assessment: card.assessment,
        signalDecision: card.signal_decision,
        linkSignalId: card.signal_id,
        noSignalRationale: card.no_signal_rationale,
        ownerEmployeeId: card.owner_employee_id,
        dueDate: card.due_date,
      };
      const touched = MANAGER_CARD_FIELDS.filter((f) => {
        const next = f === 'noSignalRationale' ? clean(input[f]) : input[f];
        return input[f] !== undefined && (next ?? null) !== (current[f] ?? null);
      });
      if (touched.length) {
        assertPlanningCapability(await resolvePlanningActor(client, engagementId), 'assess', SCOPE);
      }

      const pick = <T>(v: T | undefined, cur: T): T => (v !== undefined ? v : cur);
      const assessment = pick(input.assessment, card.assessment);
      const owner = pick(input.ownerEmployeeId, card.owner_employee_id);
      const decision = pick(input.signalDecision, card.signal_decision);
      const rationale =
        input.noSignalRationale !== undefined
          ? clean(input.noSignalRationale)
          : card.no_signal_rationale;

      if (assessment === INVESTIGATION_ASSESSMENT.furtherInformation && !owner) {
        throw new BadRequestException('Further information required needs an owner.');
      }
      if (
        decision === INVESTIGATION_SIGNAL_DECISION.none &&
        card.suggested_attention !== PLANNING_ATTENTION.standard &&
        !rationale
      ) {
        throw new BadRequestException(
          'Not raising a signal for an Enhanced / Immediate Partner Attention exception needs a rationale.',
        );
      }
      if (
        decision === INVESTIGATION_SIGNAL_DECISION.link &&
        !input.linkSignalId &&
        !card.signal_id
      ) {
        throw new BadRequestException('Choose the existing signal that explains this exception.');
      }

      let signalId: string | null =
        decision === INVESTIGATION_SIGNAL_DECISION.none ? null : card.signal_id;
      if (decision === INVESTIGATION_SIGNAL_DECISION.link && input.linkSignalId) {
        await assertSignalsInShell(client, wi, [input.linkSignalId]);
        signalId = input.linkSignalId;
      } else if (decision === INVESTIGATION_SIGNAL_DECISION.create && !card.signal_id) {
        const areas = input.affectedAreas ?? card.affected_areas;
        signalId = await insertSignal(client, engagementId, wi, {
          source: PLANNING_SIGNAL_SOURCE.analytics,
          sourceRef: card.id,
          sourceLink: '03.2/analytics',
          observation: card.observation,
          whyMayMatter: card.why_flagged,
          potentialImplications: areas.length
            ? `Potentially affected areas: ${areas.join(', ')}.`
            : null,
          attention: card.suggested_attention,
        });
        await this.strategy.syncConsiderations(client, engagementId, wi);
      }

      const status: InvestigationStatus =
        assessment === null
          ? 'open'
          : assessment === INVESTIGATION_ASSESSMENT.furtherInformation
            ? 'awaiting_information'
            : 'assessed';
      const reassessed = input.assessment !== undefined && input.assessment !== null;

      const result = await client.query(
        `UPDATE hsdg.audit_analytics_exception
            SET management_explanation = $3, explanation_by = $4, explanation_date = $5::date,
                evidence = $6, assessment = $7, affected_areas = $8, signal_decision = $9,
                no_signal_rationale = $10, signal_id = $11, owner_employee_id = $12,
                due_date = $13::date, status = $14,
                needs_reassessment = CASE WHEN $15 THEN false ELSE needs_reassessment END,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          cardId,
          input.version,
          input.managementExplanation !== undefined
            ? clean(input.managementExplanation)
            : card.management_explanation,
          input.explanationBy !== undefined ? clean(input.explanationBy) : card.explanation_by,
          pick(input.explanationDate, card.explanation_date),
          input.evidence !== undefined ? clean(input.evidence) : card.evidence,
          assessment,
          input.affectedAreas
            ? [...new Set(input.affectedAreas.map((a) => a.trim()).filter(Boolean))]
            : card.affected_areas,
          decision,
          decision === INVESTIGATION_SIGNAL_DECISION.none ? rationale : null,
          signalId,
          owner,
          pick(input.dueDate, card.due_date),
          status,
          reassessed,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This investigation card changed since you loaded it; refresh and retry.',
        );
      }
      await this.markInProgress(client, ctx, wi);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.analytics_exception_assessed',
        objectType: 'audit_analytics_exception',
        objectId: cardId,
        before: { assessment: card.assessment, decision: card.signal_decision },
        after: { assessment, decision, signalId, status },
      });
      return (await this.readExceptions(client, wi)).find((c) => c.id === cardId)!;
    });
  }

  // ── §14 Expectation vs Actual ──────────────────────────────────────────────

  async listExpectations(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningExpectationRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      return this.readExpectations(client, workflowInstanceId);
    });
  }

  async createExpectation(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreatePlanningExpectationInput,
  ): Promise<PlanningExpectationRecord> {
    if (input.expectationType === 'amount' && input.expectedAmount == null) {
      throw new BadRequestException('Enter the expected amount.');
    }
    if (
      input.expectationType === 'range' &&
      (input.expectedLow == null ||
        input.expectedHigh == null ||
        input.expectedLow > input.expectedHigh)
    ) {
      throw new BadRequestException('Enter a valid expected range (low ≤ high).');
    }
    if (input.expectationType === 'direction' && !input.expectedDirection) {
      throw new BadRequestException('Choose the expected direction.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      assertWritable(await this.ensureRecord(client, engagementId, workflowInstanceId));
      const custom = new Set(
        (await this.readCustomMetrics(client, workflowInstanceId)).map((c) => c.key),
      );
      if (!CANONICAL_KEYS.has(input.metricKey) && !custom.has(input.metricKey)) {
        throw new BadRequestException('Unknown metric.');
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_planning_expectation
           (workflow_instance_id, engagement_id, metric_key, expectation_type, expected_amount,
            expected_low, expected_high, expected_direction, tolerance_pct, basis, basis_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          input.metricKey,
          input.expectationType,
          input.expectationType === 'amount' ? input.expectedAmount : null,
          input.expectationType === 'range' ? input.expectedLow : null,
          input.expectationType === 'range' ? input.expectedHigh : null,
          input.expectationType === 'direction' ? input.expectedDirection : null,
          input.tolerancePct ?? null,
          input.basis,
          clean(input.basisNote),
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_expectation_created',
        objectType: 'audit_planning_expectation',
        objectId: rows[0]!.id,
        after: { metric: input.metricKey, type: input.expectationType },
      });
      return (await this.readExpectations(client, workflowInstanceId)).find(
        (e) => e.id === rows[0]!.id,
      )!;
    });
  }

  /** Auditor confirms investigation need and the planning conclusion; "Planning Signal" raises one. */
  async updateExpectation(
    ctx: RlsContext,
    engagementId: string,
    expectationId: string,
    input: UpdatePlanningExpectationInput,
  ): Promise<PlanningExpectationRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        workflow_instance_id: string;
        signal_id: string | null;
      }>(
        `SELECT workflow_instance_id, signal_id FROM hsdg.audit_planning_expectation
          WHERE id = $1 AND engagement_id = $2`,
        [expectationId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Expectation not found.');
      const wi = current.workflow_instance_id;
      assertWritable(await this.ensureRecord(client, engagementId, wi));
      let signalId = current.signal_id;
      if (input.conclusion === 'planning_signal' && !signalId) {
        const exp = (await this.readExpectations(client, wi)).find((e) => e.id === expectationId)!;
        signalId = await insertSignal(client, engagementId, wi, {
          source: PLANNING_SIGNAL_SOURCE.analytics,
          sourceRef: expectationId,
          sourceLink: '03.2/expectations',
          observation: `${exp.metricLabel}: actual ${exp.actual ?? '—'} differs from the planning expectation (${describeExpectation(exp)}).`,
          whyMayMatter: 'Actual performance departs from the team’s planning expectation.',
          attention: PLANNING_ATTENTION.standard,
        });
        await this.strategy.syncConsiderations(client, engagementId, wi);
      }
      const result = await client.query(
        `UPDATE hsdg.audit_planning_expectation
            SET requires_investigation = CASE WHEN $3::boolean THEN $4 ELSE requires_investigation END,
                conclusion = CASE WHEN $5::boolean THEN $6 ELSE conclusion END,
                signal_id = $7, version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          expectationId,
          input.version,
          input.requiresInvestigation !== undefined,
          input.requiresInvestigation ?? null,
          input.conclusion !== undefined,
          input.conclusion ?? null,
          signalId,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This expectation changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_expectation_updated',
        objectType: 'audit_planning_expectation',
        objectId: expectationId,
        after: { conclusion: input.conclusion, signalId },
      });
      return (await this.readExpectations(client, wi)).find((e) => e.id === expectationId)!;
    });
  }

  // ── §20 controlled revision ────────────────────────────────────────────────

  /**
   * Reopen a completed 03.2 for a controlled revision (v1.0 → v1.1). What was
   * concluded is frozen into the revision baseline first; BA-01 is cleared so
   * the Manager re-confirms the revised understanding.
   */
  async reopen(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ReopenUnderstandingInput,
  ): Promise<BusinessUnderstandingSummary> {
    const reason = clean(input.reason);
    if (!reason) throw new BadRequestException('Give the reason for reopening 03.2.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const rec = await this.ensureRecord(client, engagementId, workflowInstanceId);
      if (rec.status !== 'complete') {
        throw new ConflictException('03.2 is not complete — there is nothing to reopen.');
      }
      if (rec.version !== input.version) {
        throw new ConflictException('03.2 changed since you loaded it; refresh and retry.');
      }
      await this.openRevision(
        client,
        engagementId,
        workflowInstanceId,
        rec,
        reason,
        ctx.employeeId ?? null,
      );
      await client.query(
        `UPDATE hsdg.audit_business_understanding
            SET status = 'in_progress', ba01 = NULL, version_no = version_no + 1,
                completed_at = NULL, completed_by_employee_id = NULL, version = version + 1
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      await this.rollUp(client, ctx, workflowInstanceId, 'in_progress');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.business_understanding_reopened',
        objectType: 'audit_business_understanding',
        objectId: rec.id,
        before: { version: planningVersionLabel(rec.version_no) },
        after: { version: planningVersionLabel(rec.version_no + 1), reason },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  /** One revision with what changed between its frozen baseline and what followed. */
  async revisionDetail(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    revisionId: string,
  ): Promise<UnderstandingRevisionDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const revisions = await this.readRevisions(client, workflowInstanceId);
      const rev = revisions.find((r) => r.id === revisionId);
      if (!rev) throw new NotFoundException('Revision not found.');
      const { rows } = await client.query<{
        to_version_no: number;
        baseline: UnderstandingSnapshot;
      }>(
        `SELECT to_version_no, baseline FROM hsdg.audit_understanding_revision
          WHERE workflow_instance_id = $1 AND to_version_no IN ($2, $2 + 1)`,
        [workflowInstanceId, rev.toVersionNo],
      );
      const before = rows.find((r) => r.to_version_no === rev.toVersionNo)!.baseline;
      // A completed revision ends where the next one's baseline begins; the
      // latest runs to 03.2 as it is now.
      const after =
        rows.find((r) => r.to_version_no === rev.toVersionNo + 1)?.baseline ??
        (await this.snapshot(client, workflowInstanceId));
      return { ...rev, changes: diffUnderstandingSnapshots(before, after) };
    });
  }

  // ── §23 Engagement Partner comments / challenges ───────────────────────────

  async createChallenge(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateUnderstandingChallengeInput,
  ): Promise<BusinessUnderstandingSummary> {
    const body = clean(input.body);
    if (!body) throw new BadRequestException('Write the comment or challenge.');
    if (!UNDERSTANDING_CHALLENGE_TARGETS.includes(input.targetType)) {
      throw new BadRequestException('Unknown 03.2 area.');
    }
    if (!UNDERSTANDING_CHALLENGE_KINDS.includes(input.kind)) {
      throw new BadRequestException('Choose comment or challenge.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      await this.ensureRecord(client, engagementId, workflowInstanceId);
      const target = await this.resolveChallengeTarget(
        client,
        workflowInstanceId,
        input.targetType,
        clean(input.targetRef),
      );
      const { rows } = await client.query<{ id: string; seq: number }>(
        `INSERT INTO hsdg.audit_understanding_challenge
           (workflow_instance_id, engagement_id, seq, target_type, target_ref, kind, body,
            raised_by_employee_id)
         SELECT $1, $2, COALESCE(MAX(seq), 0) + 1, $3, $4, $5, $6, hsdg.ctx_employee_id()
           FROM hsdg.audit_understanding_challenge WHERE workflow_instance_id = $1
         RETURNING id, seq`,
        [workflowInstanceId, engagementId, input.targetType, target.ref, input.kind, body],
      );
      const created = rows[0]!;
      const actor = await resolvePlanningActor(client, engagementId);
      await notifyPlanning(client, [actor.managerId], {
        type: NOTIFICATION_TYPE.planningUnderstandingChallenge,
        title: `Engagement Partner ${input.kind} on 03.2 — ${target.label}`,
        body,
        engagementId,
        objectType: 'audit_understanding_challenge',
        objectId: created.id,
        dedup: `u032-challenge:${created.id}`,
        except: ctx.employeeId ?? null,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.understanding_challenge_raised',
        objectType: 'audit_understanding_challenge',
        objectId: created.id,
        after: { code: displayCode('PC', created.seq), target: target.label, kind: input.kind },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  /** The Engagement Manager answers (a completed 03.2 stays frozen — reopen to act on it). */
  async respondChallenge(
    ctx: RlsContext,
    engagementId: string,
    challengeId: string,
    input: RespondUnderstandingChallengeInput,
  ): Promise<BusinessUnderstandingSummary> {
    const response = clean(input.response);
    if (!response) throw new BadRequestException('Write the response.');
    return this.db.withRlsContext(ctx, async (client) => {
      const c = await this.loadChallenge(client, engagementId, challengeId);
      if (c.status === 'closed') throw new ConflictException('This challenge is already closed.');
      const res = await client.query(
        `UPDATE hsdg.audit_understanding_challenge
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
        type: NOTIFICATION_TYPE.planningUnderstandingChallenge,
        title: `Manager responded to ${displayCode('PC', c.seq)} on 03.2`,
        body: response,
        engagementId,
        objectType: 'audit_understanding_challenge',
        objectId: challengeId,
        dedup: `u032-challenge-response:${challengeId}:${c.version}`,
        except: ctx.employeeId ?? null,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.understanding_challenge_responded',
        objectType: 'audit_understanding_challenge',
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
    input: CloseUnderstandingChallengeInput,
  ): Promise<BusinessUnderstandingSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const c = await this.loadChallenge(client, engagementId, challengeId);
      if (c.status === 'closed') throw new ConflictException('This challenge is already closed.');
      if (c.kind === 'challenge' && !c.response) {
        throw new ConflictException(
          'The Engagement Manager has not responded to this challenge yet.',
        );
      }
      const res = await client.query(
        `UPDATE hsdg.audit_understanding_challenge
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
        action: 'statutory_audit.understanding_challenge_closed',
        objectType: 'audit_understanding_challenge',
        objectId: challengeId,
      });
      return this.buildSummary(client, c.workflow_instance_id);
    });
  }

  // ── §7 suggested industry considerations ──────────────────────────────────

  /** The Manager confirms whether each suggested consideration is relevant here. */
  async decideConsideration(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: DecideIndustryConsiderationInput,
  ): Promise<BusinessUnderstandingSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const rec = await this.ensureRecord(client, engagementId, workflowInstanceId);
      assertWritable(rec);
      const suggested = await this.considerationsFor(client, rec.industry_profile);
      if (!suggested.includes(input.consideration)) {
        throw new BadRequestException(
          'That is not a suggested consideration for this industry profile.',
        );
      }
      if (input.relevant === null) {
        await client.query(
          `UPDATE hsdg.audit_business_understanding
              SET industry_consideration_decisions = industry_consideration_decisions - $2::text
            WHERE workflow_instance_id = $1`,
          [workflowInstanceId, input.consideration],
        );
      } else {
        const decision: IndustryConsiderationDecision = {
          relevant: input.relevant,
          note: clean(input.note),
          byName: null,
          at: new Date().toISOString(),
        };
        await client.query(
          `UPDATE hsdg.audit_business_understanding
              SET industry_consideration_decisions = industry_consideration_decisions
                    || jsonb_build_object($2::text, $3::jsonb || jsonb_build_object(
                         'byName', (SELECT full_name FROM hsdg.employees
                                     WHERE id = hsdg.ctx_employee_id())))
            WHERE workflow_instance_id = $1`,
          [workflowInstanceId, input.consideration, JSON.stringify(decision)],
        );
      }
      await this.markInProgress(client, ctx, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.industry_consideration_decided',
        objectType: 'audit_business_understanding',
        objectId: rec.id,
        after: { consideration: input.consideration, relevant: input.relevant },
      });
      return this.buildSummary(client, workflowInstanceId);
    });
  }

  /**
   * The 03.2.7 header and calculated analytics, read by 03.3 Materiality so it
   * consumes the canonical metric ids instead of keeping a second financial
   * master. Runs inside the caller's RLS transaction.
   */
  async readFinancialBasis(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<{ header: FinancialDatasetHeader; analytics: AnalyticsResult }> {
    return {
      header: await this.readDataset(client, workflowInstanceId),
      analytics: await this.computeAnalytics(client, workflowInstanceId),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Run the engine and reconcile Investigation Cards by rule_key: insert new
   * exceptions, refresh changed ones (reopening an assessed card whose figures
   * moved), and mark — never delete — cards whose rule no longer flags.
   */
  private async syncExceptions(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const analytics = await this.computeAnalytics(client, workflowInstanceId);
    const { rows: existing } = await client.query<{
      seq: number;
      rule_key: string;
      values: Record<string, number | null>;
      status: InvestigationStatus;
      no_longer_flagged: boolean;
      signal_id: string | null;
    }>(
      `SELECT seq, rule_key, values, status, no_longer_flagged, signal_id
         FROM hsdg.audit_analytics_exception
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    // §21 — cards newly flagged, or whose figures moved under worked conclusions.
    const impacted: string[] = [];
    const impactedSignals: string[] = [];
    const byKey = new Map(existing.map((e) => [e.rule_key, e]));
    const { rows: seqRows } = await client.query<{ m: number }>(
      `SELECT COALESCE(MAX(seq), 0) AS m FROM hsdg.audit_analytics_exception WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    let seq = Number(seqRows[0]?.m ?? 0);

    for (const e of analytics.exceptions) {
      const prior = byKey.get(e.ruleKey);
      if (!prior) {
        seq += 1;
        await client.query(
          `INSERT INTO hsdg.audit_analytics_exception
             (workflow_instance_id, engagement_id, seq, rule_key, methodology_version, observation,
              why_flagged, suggested_attention, values, affected_areas)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [
            workflowInstanceId,
            engagementId,
            seq,
            e.ruleKey,
            analytics.methodologyVersion,
            e.observation,
            e.whyFlagged,
            e.suggestedAttention,
            JSON.stringify(e.values),
            e.affectedAreas,
          ],
        );
        impacted.push(displayCode('AX', seq)!);
        continue;
      }
      const changed = JSON.stringify(sortKeys(prior.values)) !== JSON.stringify(sortKeys(e.values));
      if (!changed && !prior.no_longer_flagged) continue;
      if (prior.no_longer_flagged || (changed && prior.status !== 'open')) {
        impacted.push(displayCode('AX', prior.seq)!);
        if (changed && prior.signal_id) impactedSignals.push(prior.signal_id);
      }
      await client.query(
        `UPDATE hsdg.audit_analytics_exception
            SET observation = $3, why_flagged = $4, suggested_attention = $5, values = $6::jsonb,
                methodology_version = $7, no_longer_flagged = false,
                needs_reassessment = needs_reassessment OR (status <> 'open' AND $8),
                version = version + 1
          WHERE workflow_instance_id = $1 AND rule_key = $2`,
        [
          workflowInstanceId,
          e.ruleKey,
          e.observation,
          e.whyFlagged,
          e.suggestedAttention,
          JSON.stringify(e.values),
          analytics.methodologyVersion,
          changed,
        ],
      );
    }
    const flagged = new Set(analytics.exceptions.map((e) => e.ruleKey));
    const gone = existing
      .filter((e) => !flagged.has(e.rule_key) && !e.no_longer_flagged)
      .map((e) => e.rule_key);
    if (gone.length) {
      await client.query(
        `UPDATE hsdg.audit_analytics_exception
            SET no_longer_flagged = true, version = version + 1
          WHERE workflow_instance_id = $1 AND rule_key = ANY($2::text[])`,
        [workflowInstanceId, gone],
      );
    }
    if (impacted.length) {
      await this.afterAnalyticsChange(
        client,
        ctx,
        engagementId,
        workflowInstanceId,
        impacted,
        impactedSignals,
      );
    }
  }

  /**
   * §21 "reopen impacted investigations / signals". A Planning Signal linked to
   * a card whose figures moved goes back to the Manager (unless Planning is
   * frozen in 03.12). A COMPLETED 03.2 is flagged for reassessment: what was
   * concluded is frozen into a revision baseline, BA-01 is cleared, the
   * checklist row needs attention and the Manager is told.
   */
  private async afterAnalyticsChange(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    impacted: string[],
    signalIds: string[],
  ): Promise<void> {
    let reopenedSignals = 0;
    if (signalIds.length && !(await readPlanningLock(client, workflowInstanceId)).locked) {
      const res = await client.query(
        `UPDATE hsdg.audit_planning_signal SET status = 'open', version = version + 1
          WHERE workflow_instance_id = $1 AND id = ANY($2::uuid[]) AND status = 'assessed'`,
        [workflowInstanceId, [...new Set(signalIds)]],
      );
      reopenedSignals = res.rowCount ?? 0;
    }
    const { rows } = await client.query<RecordRow>(
      `SELECT * FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const rec = rows[0];
    const flag = rec?.status === 'complete';
    if (flag) {
      const reason = `Figures changed after 03.2 ${planningVersionLabel(rec.version_no)} was completed: ${impacted.join(', ')} ${impacted.length === 1 ? 'needs' : 'need'} reassessment.`;
      await this.openRevision(client, engagementId, workflowInstanceId, rec, reason, null);
      await client.query(
        `UPDATE hsdg.audit_business_understanding
            SET status = 'reassessment_required', ba01 = NULL, version_no = version_no + 1,
                completed_at = NULL, completed_by_employee_id = NULL,
                reassessment_reason = $2, reassessment_flagged_at = now(), version = version + 1
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId, reason],
      );
      await this.rollUp(client, ctx, workflowInstanceId, 'reassessment_required');
      const actor = await resolvePlanningActor(client, engagementId);
      await notifyPlanning(client, [actor.managerId ?? actor.partnerId], {
        type: NOTIFICATION_TYPE.planningUnderstandingReassessment,
        title: '03.2 Business Understanding needs reassessment',
        body: reason,
        engagementId,
        objectType: 'audit_business_understanding',
        objectId: rec.id,
        dedup: `u032-reassess:${rec.id}:${rec.version_no}`,
        except: ctx.employeeId ?? null,
      });
    }
    if (flag || reopenedSignals) {
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.business_understanding_reassessment',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { cards: impacted, reopenedSignals, flagged: flag },
      });
    }
  }

  private async computeAnalytics(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<AnalyticsResult> {
    const { rows: rec } = await client.query<{ industry_profile: IndustryProfile }>(
      `SELECT industry_profile FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const header = await this.readDataset(client, workflowInstanceId);
    const values = await this.readValues(client, workflowInstanceId);
    const customMetrics = await this.readCustomMetrics(client, workflowInstanceId);
    const map: Record<string, { cy?: number | null; py?: number | null }> = {};
    for (const v of values) (map[v.metricKey] ??= {})[v.period] = v.amount;
    return runPreliminaryAnalytics({
      profile: rec[0]?.industry_profile ?? 'generic',
      header,
      values: map,
      customMetrics,
    });
  }

  /** §22 completion checklist. */
  private async computeCompletion(
    client: PoolClient,
    workflowInstanceId: string,
    override: { ba01?: Ba01Answer | null; conclusionSummary?: string | null } = {},
    // What buildSummary has already read — not recomputed.
    known: {
      sections?: UnderstandingSectionRecord[];
      header?: FinancialDatasetHeader;
      values?: FinancialValueRecord[];
      analytics?: AnalyticsResult;
      considerations?: string[];
    } = {},
  ): Promise<PlanningCompletionCheck[]> {
    const { rows: rec } = await client.query<RecordRow>(
      `SELECT * FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const r = rec[0]!;
    const ba01 = override.ba01 !== undefined ? override.ba01 : r.ba01;
    const summaryText =
      override.conclusionSummary !== undefined ? override.conclusionSummary : r.conclusion_summary;
    const sections = known.sections ?? (await this.readSections(client, workflowInstanceId));
    const unreviewed = sections.filter((s) => !s.reviewed);
    const header = known.header ?? (await this.readDataset(client, workflowInstanceId));
    const values = known.values ?? (await this.readValues(client, workflowInstanceId));
    const analytics = known.analytics ?? (await this.computeAnalytics(client, workflowInstanceId));
    const considerations =
      known.considerations ?? (await this.considerationsFor(client, r.industry_profile));
    const decisions = r.industry_consideration_decisions ?? {};
    const undecidedConsiderations = considerations.filter((c) => !decisions[c]);
    const { rows: c } = await client.query<{
      unassessed: string;
      stale: string;
      undecided: string;
      exp_open: string;
      challenges: string;
    }>(
      `SELECT
         (SELECT count(*) FROM hsdg.audit_analytics_exception
           WHERE workflow_instance_id = $1 AND NOT no_longer_flagged
             AND assessment IS NULL AND owner_employee_id IS NULL) AS unassessed,
         (SELECT count(*) FROM hsdg.audit_analytics_exception
           WHERE workflow_instance_id = $1 AND needs_reassessment) AS stale,
         (SELECT count(*) FROM hsdg.audit_analytics_exception
           WHERE workflow_instance_id = $1 AND status = 'assessed'
             AND signal_decision IS NULL) AS undecided,
         (SELECT count(*) FROM hsdg.audit_planning_expectation
           WHERE workflow_instance_id = $1 AND requires_investigation IS TRUE
             AND conclusion IS NULL) AS exp_open,
         (SELECT count(*) FROM hsdg.audit_understanding_challenge
           WHERE workflow_instance_id = $1 AND kind = 'challenge'
             AND status = 'open') AS challenges`,
      [workflowInstanceId],
    );
    const n = (k: keyof (typeof c)[number]) => Number(c[0]?.[k] ?? 0);
    const titleOf = (k: string) => UNDERSTANDING_SECTION_DEFS.find((d) => d.key === k)!.code;
    const check = (
      key: string,
      label: string,
      met: boolean,
      detail: string,
    ): PlanningCompletionCheck => ({
      key,
      label,
      met,
      detail: met ? null : detail,
    });
    const headerComplete = !!(
      header.periodEnd &&
      header.currency &&
      header.units &&
      header.cySource &&
      header.dataStatus
    );
    return [
      check(
        'sections',
        'Business, governance, industry, systems, objectives and KPIs reviewed (03.2.1–03.2.6)',
        unreviewed.length === 0,
        `Mark reviewed: ${unreviewed.map((s) => titleOf(s.key)).join(', ')}.`,
      ),
      check(
        'considerations',
        'Suggested industry considerations confirmed relevant or not (03.2.3)',
        undecidedConsiderations.length === 0,
        `${undecidedConsiderations.length} suggested industry consideration(s) not yet confirmed.`,
      ),
      check(
        'dataset',
        'Focused financial dataset completed with sources (03.2.7)',
        headerComplete &&
          values.some((v) => v.period === 'cy') &&
          values.some((v) => v.period === 'py'),
        headerComplete
          ? 'Enter at least the available current- and prior-year figures.'
          : 'Complete the dataset header (period end, currency, units, CY source, data status).',
      ),
      check(
        'analytics',
        'Preliminary analytics calculated (03.2.8)',
        analytics.ready &&
          analytics.movements.some((m) => m.percent !== null || m.percentLabel === 'N/M'),
        'Analytics need comparable current- and prior-year figures.',
      ),
      check(
        'exceptions',
        'Every flagged exception assessed or assigned (03.2.9)',
        n('unassessed') === 0 && n('stale') === 0,
        [
          n('unassessed') ? `${n('unassessed')} exception(s) not yet assessed or owned.` : '',
          n('stale') ? `${n('stale')} exception(s) need reassessment after figures changed.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      ),
      check(
        'signals',
        'Findings linked to existing or new Planning Signals',
        n('undecided') === 0,
        `${n('undecided')} assessed exception(s) still need a signal decision.`,
      ),
      check(
        'expectations',
        'Expectations needing investigation concluded',
        n('exp_open') === 0,
        `${n('exp_open')} expectation(s) flagged for investigation have no conclusion.`,
      ),
      check(
        'summary',
        'Understanding & analytics conclusion generated',
        !!summaryText,
        'Draft and save the conclusion.',
      ),
      check(
        'challenges',
        'Engagement Partner challenges answered',
        n('challenges') === 0,
        `${n('challenges')} Engagement Partner challenge(s) await the Manager's response.`,
      ),
      check(
        'ba01',
        'BA-01 answered "Yes — Complete" by the Engagement Manager',
        ba01 === 'yes_complete',
        'Answer BA-01.',
      ),
    ];
  }

  private async buildSummary(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<BusinessUnderstandingSummary> {
    const { rows } = await client.query<RecordRow & { completed_by_name: string | null }>(
      `SELECT u.*, cb.full_name AS completed_by_name
         FROM hsdg.audit_business_understanding u
         LEFT JOIN hsdg.employees cb ON cb.id = u.completed_by_employee_id
        WHERE u.workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const r = rows[0]!;
    const record: BusinessUnderstandingRecord = {
      status: r.status,
      industryProfile: r.industry_profile,
      ba01: r.ba01,
      conclusionSummary: r.conclusion_summary,
      version: r.version,
    };
    const { rows: open } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM hsdg.audit_analytics_exception
        WHERE workflow_instance_id = $1 AND NOT no_longer_flagged
          AND (status <> 'assessed' OR needs_reassessment)`,
      [workflowInstanceId],
    );
    // Read once, shared with the completion checklist.
    const sections = await this.readSections(client, workflowInstanceId);
    const dataset = await this.readDataset(client, workflowInstanceId);
    const values = await this.readValues(client, workflowInstanceId);
    const analytics = await this.computeAnalytics(client, workflowInstanceId);
    const considerations = await this.considerationsFor(client, r.industry_profile);

    const actor = await resolvePlanningActor(client, r.engagement_id);
    const lock = await readPlanningLock(client, workflowInstanceId);
    const complete = r.status === 'complete';
    const label = planningVersionLabel(r.version_no);
    const access: UnderstandingAccess = {
      role: actor.role,
      roleLabel: PLANNING_ACTOR_ROLE_LABEL[actor.role],
      actingAsManager: actor.actingAsManager,
      capabilities: actor.capabilities,
      locked: complete || lock.locked,
      lockReason: lock.locked
        ? 'Planning was approved in 03.12 — 03.2 is frozen with it until Planning is reopened for a controlled revision.'
        : complete
          ? `03.2 ${label} is complete — reopen it for a controlled revision to change it.`
          : null,
      planningLocked: lock.locked,
    };
    const versionInfo: UnderstandingVersionInfo = {
      versionNo: r.version_no,
      versionLabel: label,
      completedAt: r.completed_at?.toISOString() ?? null,
      completedByName: r.completed_by_name,
      reassessmentReason: r.reassessment_reason,
      reassessmentFlaggedAt: r.reassessment_flagged_at?.toISOString() ?? null,
    };
    const { rows: ids } = await client.query<{ kind: string; id: string; key: string | null }>(
      `SELECT 'section' AS kind, id, section_key AS key FROM hsdg.audit_understanding_section
        WHERE workflow_instance_id = $1
       UNION ALL
       SELECT 'dataset', id, NULL FROM hsdg.audit_financial_dataset WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const { rows: counts } = await client.query<{ target_id: string; n: string }>(
      `SELECT target_id, count(*) AS n FROM hsdg.audit_planning_evidence
        WHERE workflow_instance_id = $1 AND removed_at IS NULL
          AND target_type IN ('understanding_section','financial_dataset',
                              'analytics_exception','planning_expectation')
        GROUP BY target_id`,
      [workflowInstanceId],
    );
    return {
      record,
      access,
      versionInfo,
      revisions: await this.readRevisions(client, workflowInstanceId),
      challenges: await this.readChallenges(client, workflowInstanceId),
      evidenceCounts: Object.fromEntries(counts.map((c) => [c.target_id, Number(c.n)])),
      authorityAnchors: [
        ...GENERIC_AUTHORITY_ANCHORS,
        ...(INDUSTRY_AUTHORITY_ANCHORS[r.industry_profile] ?? []),
      ],
      industryConsiderationDecisions: r.industry_consideration_decisions ?? {},
      recordIds: {
        sections: Object.fromEntries(
          ids.filter((i) => i.kind === 'section').map((i) => [i.key!, i.id]),
        ),
        dataset: ids.find((i) => i.kind === 'dataset')?.id ?? null,
      },
      sections,
      industryConsiderations: considerations,
      dataset,
      customMetrics: await this.readCustomMetrics(client, workflowInstanceId),
      values,
      analytics,
      openInvestigations: Number(open[0]?.n ?? 0),
      completion: await this.computeCompletion(
        client,
        workflowInstanceId,
        {},
        { sections, header: dataset, values, analytics, considerations },
      ),
    };
  }

  /** The suggested industry considerations for a profile (§7, methodology-configured). */
  private async considerationsFor(
    _client: PoolClient,
    profile: IndustryProfile,
  ): Promise<string[]> {
    return [...(INDUSTRY_PROFILE_CONFIG[profile]?.considerations ?? [])];
  }

  private async readRevisions(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<UnderstandingRevisionRecord[]> {
    const { rows } = await client.query<RevisionRow>(
      `SELECT r.id, r.from_version_no, r.to_version_no, r.reason, r.status,
              ob.full_name AS opened_by_name, r.opened_at,
              cb.full_name AS completed_by_name, r.completed_at
         FROM hsdg.audit_understanding_revision r
         LEFT JOIN hsdg.employees ob ON ob.id = r.opened_by_employee_id
         LEFT JOIN hsdg.employees cb ON cb.id = r.completed_by_employee_id
        WHERE r.workflow_instance_id = $1
        ORDER BY r.to_version_no DESC`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({
      id: r.id,
      fromVersionNo: r.from_version_no,
      toVersionNo: r.to_version_no,
      fromLabel: planningVersionLabel(r.from_version_no),
      toLabel: planningVersionLabel(r.to_version_no),
      reason: r.reason,
      status: r.status,
      openedByName: r.opened_by_name,
      openedAt: r.opened_at.toISOString(),
      completedByName: r.completed_by_name,
      completedAt: r.completed_at?.toISOString() ?? null,
    }));
  }

  private async readChallenges(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<UnderstandingChallengeRecord[]> {
    const { rows } = await client.query<
      ChallengeRow & { card_seq: number | null; metric_key: string | null }
    >(
      `SELECT c.id, c.seq, c.target_type, c.target_ref, c.kind, c.body,
              rb.full_name AS raised_by_name, c.raised_at, c.response,
              sb.full_name AS responded_by_name, c.responded_at, c.status, c.version,
              x.seq AS card_seq, e.metric_key
         FROM hsdg.audit_understanding_challenge c
         LEFT JOIN hsdg.employees rb ON rb.id = c.raised_by_employee_id
         LEFT JOIN hsdg.employees sb ON sb.id = c.responded_by_employee_id
         LEFT JOIN hsdg.audit_analytics_exception x
                ON c.target_type = 'exception' AND x.id::text = c.target_ref
         LEFT JOIN hsdg.audit_planning_expectation e
                ON c.target_type = 'expectation' AND e.id::text = c.target_ref
        WHERE c.workflow_instance_id = $1
        ORDER BY (c.status = 'closed'), c.seq DESC`,
      [workflowInstanceId],
    );
    return rows.map((c) => ({
      id: c.id,
      code: displayCode('PC', c.seq)!,
      targetType: c.target_type,
      targetRef: c.target_ref,
      targetLabel: challengeTargetLabel(c.target_type, c.target_ref, c.card_seq, c.metric_key),
      kind: c.kind,
      body: c.body,
      raisedByName: c.raised_by_name,
      raisedAt: c.raised_at.toISOString(),
      response: c.response,
      respondedByName: c.responded_by_name,
      respondedAt: c.responded_at?.toISOString() ?? null,
      status: c.status,
      version: c.version,
    }));
  }

  private async loadChallenge(
    client: PoolClient,
    engagementId: string,
    challengeId: string,
  ): Promise<{
    workflow_instance_id: string;
    seq: number;
    kind: 'comment' | 'challenge';
    response: string | null;
    status: 'open' | 'responded' | 'closed';
    version: number;
  }> {
    const { rows } = await client.query(
      `SELECT workflow_instance_id, seq, kind, response, status, version
         FROM hsdg.audit_understanding_challenge WHERE id = $1 AND engagement_id = $2`,
      [challengeId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Challenge not found.');
    return rows[0];
  }

  /** Validate what a challenge points at and name it. */
  private async resolveChallengeTarget(
    client: PoolClient,
    workflowInstanceId: string,
    targetType: UnderstandingChallengeTarget,
    ref: string | null,
  ): Promise<{ ref: string | null; label: string }> {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (targetType === 'section') {
      if (!ref || !UNDERSTANDING_SECTIONS.includes(ref as UnderstandingSectionKey)) {
        throw new BadRequestException('Choose the 03.2 section.');
      }
      return { ref, label: challengeTargetLabel('section', ref, null, null) };
    }
    if (targetType === 'exception' || targetType === 'expectation') {
      if (!ref || !UUID.test(ref)) throw new BadRequestException('Choose the item.');
      const { rows } = await client.query<{ seq: number | null; metric_key: string | null }>(
        targetType === 'exception'
          ? `SELECT seq, NULL AS metric_key FROM hsdg.audit_analytics_exception
              WHERE id = $1 AND workflow_instance_id = $2`
          : `SELECT NULL::int AS seq, metric_key FROM hsdg.audit_planning_expectation
              WHERE id = $1 AND workflow_instance_id = $2`,
        [ref, workflowInstanceId],
      );
      if (!rows[0]) throw new NotFoundException('That item is not on this audit file.');
      return {
        ref,
        label: challengeTargetLabel(targetType, ref, rows[0].seq, rows[0].metric_key),
      };
    }
    return { ref: null, label: challengeTargetLabel(targetType, null, null, null) };
  }

  /** Freeze a completed 03.2 into a new revision's baseline (§20). */
  private async openRevision(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    rec: RecordRow,
    reason: string,
    openedBy: string | null,
  ): Promise<void> {
    const baseline = await this.snapshot(client, workflowInstanceId);
    await client.query(
      `INSERT INTO hsdg.audit_understanding_revision
         (workflow_instance_id, engagement_id, from_version_no, to_version_no, reason, baseline,
          opened_by_employee_id)
       VALUES ($1, $2, $3, $3 + 1, $4, $5::jsonb, $6)`,
      [
        workflowInstanceId,
        engagementId,
        rec.version_no,
        reason,
        JSON.stringify(baseline),
        openedBy,
      ],
    );
  }

  /** 03.2 as it stands, in the shape a revision freezes. */
  private async snapshot(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<UnderstandingSnapshot> {
    const { rows: rec } = await client.query<RecordRow>(
      `SELECT * FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const { rows: sections } = await client.query<SectionRow>(
      `SELECT section_key, anything_changed, answers, reviewed FROM hsdg.audit_understanding_section
        WHERE workflow_instance_id = $1 ORDER BY section_key`,
      [workflowInstanceId],
    );
    const custom = await this.readCustomMetrics(client, workflowInstanceId);
    const label = (k: string) => custom.find((c) => c.key === k)?.label ?? metricLabel(k);
    const { rows: values } = await client.query<{
      metric_key: string;
      period: FinancialPeriod;
      amount: string;
    }>(
      `SELECT metric_key, period, amount FROM hsdg.audit_financial_value
        WHERE workflow_instance_id = $1 ORDER BY metric_key, period`,
      [workflowInstanceId],
    );
    const cards = await this.readExceptions(client, workflowInstanceId);
    const { rows: exps } = await client.query<{
      id: string;
      metric_key: string;
      conclusion: ExpectationConclusion | null;
    }>(
      `SELECT id, metric_key, conclusion FROM hsdg.audit_planning_expectation
        WHERE workflow_instance_id = $1 ORDER BY created_at`,
      [workflowInstanceId],
    );
    return {
      record: {
        ba01: rec[0]?.ba01 ?? null,
        conclusionSummary: rec[0]?.conclusion_summary ?? null,
        industryProfile: rec[0]?.industry_profile ?? 'generic',
      },
      sections: sections.map((x) => ({
        key: x.section_key,
        anythingChanged: x.anything_changed,
        answers: x.answers ?? {},
        reviewed: x.reviewed,
      })),
      values: values.map((v) => ({
        metricKey: v.metric_key,
        label: label(v.metric_key),
        period: v.period,
        amount: Number(v.amount),
      })),
      cards: cards.map((c) => ({
        id: c.id,
        code: c.cardCode,
        observation: c.observation,
        assessment: c.assessment,
        signalCode: c.signalCode,
        status: c.status,
      })),
      expectations: exps.map((e) => ({
        id: e.id,
        label: label(e.metric_key),
        conclusion: e.conclusion,
      })),
    };
  }

  private async readSections(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<UnderstandingSectionRecord[]> {
    const { rows } = await client.query<SectionRow>(
      `SELECT section_key, anything_changed, answers, reviewed, reviewed_at, version
         FROM hsdg.audit_understanding_section WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const context = await this.readContext(client, workflowInstanceId);
    return UNDERSTANDING_SECTIONS.map((key) => {
      const row = rows.find((x) => x.section_key === key);
      return {
        key,
        anythingChanged: row?.anything_changed ?? null,
        answers: row?.answers ?? {},
        reviewed: row?.reviewed ?? false,
        reviewedAt: row?.reviewed_at ? row.reviewed_at.toISOString() : null,
        context: context[key] ?? [],
        version: row?.version ?? 0,
      };
    });
  }

  /** Read-only facts consumed from Section 02 and 03.1 PI-01 — never asked again. */
  private async readContext(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<Partial<Record<UnderstandingSectionKey, UnderstandingContextItem[]>>> {
    const { rows: changes } = await client.query<{
      category: PlanningChangeCategory;
      description: string | null;
      effective_date: string | null;
    }>(
      `SELECT category, description, effective_date::text FROM hsdg.audit_planning_change
        WHERE workflow_instance_id = $1 AND category <> 'no_significant_change'
        ORDER BY created_at`,
      [workflowInstanceId],
    );
    const { rows: profile } = await client.query<{
      accounting_environment: string | null;
      initial_audit: boolean;
      regulator: Regulator | null;
      regulator_name: string | null;
      special_entity_types: SpecialEntityType[] | null;
    }>(
      `SELECT accounting_environment, initial_audit, regulator, regulator_name,
              special_entity_types
         FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const { rows: branches } = await client.query<{
      branch_name: string;
      location: string | null;
      country: string | null;
    }>(
      `SELECT branch_name, location, country FROM hsdg.audit_group_branch
        WHERE workflow_instance_id = $1 ORDER BY branch_name`,
      [workflowInstanceId],
    );
    const { rows: components } = await client.query<{
      component_name: string;
      relationship: string;
      country: string | null;
    }>(
      `SELECT component_name, relationship, country FROM hsdg.audit_group_component
        WHERE workflow_instance_id = $1 AND included <> 'no' ORDER BY component_name`,
      [workflowInstanceId],
    );
    const out: Partial<Record<UnderstandingSectionKey, UnderstandingContextItem[]>> = {};
    const master = await readEngagementMasterFacts(client, workflowInstanceId);
    const masterContext = master ? understandingContextFacts(master) : null;
    for (const key of UNDERSTANDING_SECTIONS) {
      const filter = SECTION_CHANGE_CONTEXT[key];
      out[key] = changes
        .filter((c) => filter === 'all' || filter?.includes(c.category))
        .map((c) => ({
          label: `PI-01 change — ${PLANNING_CHANGE_CATEGORY_LABEL[c.category]}`,
          value:
            [c.description, c.effective_date && `effective ${c.effective_date}`]
              .filter(Boolean)
              .join(', ') || 'Recorded',
          source: '03.1',
        }));
    }
    if (masterContext) {
      out.business_model!.unshift(...masterContext.businessModel);
      out.governance!.unshift(...masterContext.governance);
      out.industry!.unshift(...masterContext.industry);
    }
    const env = profile[0]?.accounting_environment;
    if (env) {
      out.systems!.unshift({
        label: 'Accounting environment',
        value:
          env === 'outsourced_service_organisation'
            ? 'Outsourced to a service organisation'
            : env === 'hybrid'
              ? 'Hybrid (partly outsourced)'
              : 'In-house',
        source: 'Section 02',
      });
    }
    if (branches.length) {
      out.business_model!.push({
        label: 'Branches',
        value: listOf(
          branches.map((b) =>
            [b.branch_name, [b.location, b.country].filter(Boolean).join(', ')]
              .filter(Boolean)
              .join(' — '),
          ),
        ),
        source: '02.6',
      });
    }
    if (components.length) {
      out.governance!.push({
        label: 'Group components',
        value: listOf(
          components.map(
            (c) =>
              `${c.component_name} (${c.relationship.replace(/_/g, ' ')}${c.country ? `, ${c.country}` : ''})`,
          ),
        ),
        source: '02.6',
      });
    }
    const p = profile[0];
    if (p?.regulator) {
      out.industry!.push({
        label: 'Regulator',
        value:
          p.regulator === 'other'
            ? (p.regulator_name ?? REGULATOR_LABEL.other)
            : REGULATOR_LABEL[p.regulator],
        source: '02.1',
      });
    }
    if (p?.special_entity_types?.length) {
      out.industry!.push({
        label: 'Special entity type',
        value: p.special_entity_types.map((t) => SPECIAL_ENTITY_LABEL[t] ?? t).join(', '),
        source: '02.1',
      });
    }
    if (profile[0]) {
      out.business_model!.unshift({
        label: 'Audit type',
        value: profile[0].initial_audit
          ? 'Initial audit — no prior-year file to roll forward'
          : 'Continuing audit',
        source: 'Section 02',
      });
    }
    return out;
  }

  private async readDataset(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FinancialDatasetHeader> {
    const { rows } = await client.query<DatasetRow>(
      `SELECT d.period_end::text, d.py_period_end::text, d.currency, d.units, d.py_units,
              d.cy_source, d.py_source, d.data_status, d.source_date::text,
              emp.full_name AS prepared_by_name, d.version
         FROM hsdg.audit_financial_dataset d
         LEFT JOIN hsdg.employees emp ON emp.id = d.prepared_by_employee_id
        WHERE d.workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const d = rows[0];
    return {
      periodEnd: d?.period_end ?? null,
      pyPeriodEnd: d?.py_period_end ?? null,
      currency: d?.currency ?? null,
      units: d?.units ?? null,
      pyUnits: d?.py_units ?? null,
      cySource: d?.cy_source ?? null,
      pySource: d?.py_source ?? null,
      dataStatus: d?.data_status ?? null,
      sourceDate: d?.source_date ?? null,
      preparedByName: d?.prepared_by_name ?? null,
      version: d?.version ?? 0,
    };
  }

  private async readCustomMetrics(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<CustomMetricRecord[]> {
    const { rows } = await client.query<{ metric_key: string; label: string }>(
      `SELECT metric_key, label FROM hsdg.audit_financial_custom_metric
        WHERE workflow_instance_id = $1 ORDER BY created_at`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({ key: r.metric_key, label: r.label }));
  }

  private async readValues(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FinancialValueRecord[]> {
    const { rows } = await client.query<ValueRow>(
      `SELECT v.metric_key, v.period, v.amount, v.source_type, v.source_ref, v.note,
              emp.full_name AS entered_by_name, v.entered_at, v.version,
              v.rolled_forward_amount, v.rolled_forward_approved, v.override_reason,
              pe.financial_year AS rolled_forward_fy
         FROM hsdg.audit_financial_value v
         LEFT JOIN hsdg.employees emp ON emp.id = v.entered_by_employee_id
         LEFT JOIN hsdg.service_workflow_instances pw ON pw.id = v.rolled_forward_from_instance_id
         LEFT JOIN hsdg.engagements pe ON pe.id = pw.engagement_id
        WHERE v.workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows.map((v) => ({
      rolledForward:
        v.rolled_forward_amount === null
          ? null
          : {
              fromFinancialYear: v.rolled_forward_fy,
              amount: Number(v.rolled_forward_amount),
              approved: v.rolled_forward_approved,
            },
      overrideReason: v.override_reason,
      metricKey: v.metric_key,
      period: v.period,
      amount: Number(v.amount),
      sourceType: v.source_type,
      sourceRef: v.source_ref,
      note: v.note,
      enteredByName: v.entered_by_name,
      enteredAt: v.entered_at.toISOString(),
      version: v.version,
    }));
  }

  private async readExceptions(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<InvestigationCardRecord[]> {
    const { rows } = await client.query<ExceptionRow>(
      `${EXCEPTION_SELECT} WHERE x.workflow_instance_id = $1 ORDER BY x.no_longer_flagged, x.seq`,
      [workflowInstanceId],
    );
    const { rows: focus } = await client.query<{
      signal_id: string;
      id: string;
      seq: number;
      name: string;
    }>(
      `SELECT fs.signal_id, f.id, f.seq, f.name
         FROM hsdg.audit_focus_signal fs
         JOIN hsdg.audit_area_of_focus f ON f.id = fs.focus_id
        WHERE f.workflow_instance_id = $1 AND f.status <> 'superseded'
        ORDER BY f.seq`,
      [workflowInstanceId],
    );
    const bySignal = new Map<string, UnderstandingFocusLink[]>();
    for (const f of focus) {
      const list = bySignal.get(f.signal_id) ?? [];
      list.push({ id: f.id, code: displayCode('FA', f.seq)!, name: f.name });
      bySignal.set(f.signal_id, list);
    }
    return rows.map((x) => mapException(x, bySignal));
  }

  private async readExpectations(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<PlanningExpectationRecord[]> {
    const { rows } = await client.query<ExpectationRow>(
      `${EXPECTATION_SELECT} WHERE e.workflow_instance_id = $1 ORDER BY e.created_at`,
      [workflowInstanceId],
    );
    const analytics = await this.computeAnalytics(client, workflowInstanceId);
    const custom = await this.readCustomMetrics(client, workflowInstanceId);
    const labelOf = (k: string) =>
      FINANCIAL_METRIC_DEFS.find((d) => d.key === k)?.label ??
      custom.find((c) => c.key === k)?.label ??
      k;
    return rows.map((e) => {
      const mv = analytics.movements.find((m) => m.metricKey === e.metric_key);
      const rec: PlanningExpectationRecord = {
        id: e.id,
        metricKey: e.metric_key,
        metricLabel: labelOf(e.metric_key),
        expectationType: e.expectation_type,
        expectedAmount: num(e.expected_amount),
        expectedLow: num(e.expected_low),
        expectedHigh: num(e.expected_high),
        expectedDirection: e.expected_direction,
        tolerancePct: num(e.tolerance_pct),
        basis: e.basis,
        basisNote: e.basis_note,
        actual: mv?.cy ?? null,
        variance: null,
        suggestedInvestigation: null,
        requiresInvestigation: e.requires_investigation,
        conclusion: e.conclusion,
        signalId: e.signal_id,
        signalCode: displayCode('PS', e.signal_seq),
        version: e.version,
      };
      return { ...rec, ...evaluateExpectation(rec, mv?.py ?? null) };
    });
  }

  /** Apply the pure prefill plan (master-facts.ts) inside the caller's transaction. */
  private async applyMasterPrefill(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const master = await readEngagementMasterFacts(client, workflowInstanceId);
    const markDone = () =>
      client.query(
        `UPDATE hsdg.audit_business_understanding SET master_prefilled_at = now()
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
    if (!master) {
      await markDone();
      return;
    }
    const header = await this.readDataset(client, workflowInstanceId);
    const values = await this.readValues(client, workflowInstanceId);
    const sections = await client.query<{ section_key: UnderstandingSectionKey }>(
      `SELECT section_key FROM hsdg.audit_understanding_section WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const record = await this.ensureRecord(client, engagementId, workflowInstanceId);
    const special = await client.query<{ special_entity_types: string[] | null }>(
      `SELECT special_entity_types FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );

    const plan = planUnderstandingPrefill(master, {
      header: { ...header, exists: header.version > 0 },
      recordedValues: new Set(values.map((v) => `${v.metricKey}:${v.period}`)),
      savedSections: new Set(sections.rows.map((r) => r.section_key)),
      industryProfile: record.industry_profile,
      specialEntityTypes: special.rows[0]?.special_entity_types ?? [],
    });

    // Last year's audit file: its section answers seed the unsaved sections,
    // and its current-year figures become this year's prior-year column.
    const prior = await readPriorAuditFile(client, workflowInstanceId);
    const priorSections = prior
      ? (
          await client.query<{ section_key: string; answers: Record<string, unknown> }>(
            `SELECT section_key, answers FROM hsdg.audit_understanding_section
              WHERE workflow_instance_id = $1`,
            [prior.workflowInstanceId],
          )
        ).rows.map((r) => ({ key: r.section_key, answers: r.answers ?? {} }))
      : [];
    const mergedSections = mergePriorSections(
      plan.sections,
      priorSections,
      new Set(sections.rows.map((r) => r.section_key)),
    );
    let priorValues: Array<{ metricKey: string; amount: number }> = [];
    let priorValueSource: { type: MetricSourceType; ref: string } | null = null;
    // Last year's 03.2 completed = its figures are approved: protected here (§21).
    let priorApproved = false;
    if (prior) {
      const ps = await client.query<{ status: string }>(
        `SELECT status FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
        [prior.workflowInstanceId],
      );
      priorApproved = ps.rows[0]?.status === 'complete';
      const pd = await client.query<{ units: FinancialUnit | null; data_status: string | null }>(
        `SELECT units, data_status FROM hsdg.audit_financial_dataset WHERE workflow_instance_id = $1`,
        [prior.workflowInstanceId],
      );
      const priorUnits = pd.rows[0]?.units ?? null;
      if (priorUnits && !header.units && !plan.header.units) plan.header.units = priorUnits;
      const targetUnits = header.pyUnits ?? header.units ?? plan.header.units ?? null;
      const pf = priorUnits ? FINANCIAL_UNIT_FACTOR[priorUnits] : null;
      const tf = targetUnits ? FINANCIAL_UNIT_FACTOR[targetUnits] : null;
      if (pf && tf) {
        const pv = await client.query<{ metric_key: string; amount: string }>(
          `SELECT v.metric_key, v.amount::text FROM hsdg.audit_financial_value v
            WHERE v.workflow_instance_id = $1 AND v.period = 'cy'
              AND NOT EXISTS (SELECT 1 FROM hsdg.audit_financial_custom_metric c
                               WHERE c.workflow_instance_id = v.workflow_instance_id
                                 AND c.metric_key = v.metric_key)`,
          [prior.workflowInstanceId],
        );
        priorValues = priorYearValues(
          pv.rows.map((r) => ({ metricKey: r.metric_key, amount: Number(r.amount) })),
          { priorUnits: pf, targetUnits: tf },
          new Set(values.map((v) => `${v.metricKey}:${v.period}`)),
        );
        priorValueSource = {
          type: pd.rows[0]?.data_status === 'final' ? 'audited_py_fs' : 'other',
          ref: `FY ${prior.financialYear} audit file — 03.2 financial dataset`,
        };
      }
    }

    const headerCols = Object.entries(plan.header);
    if (headerCols.length) {
      await client.query(
        `INSERT INTO hsdg.audit_financial_dataset (workflow_instance_id, engagement_id)
         VALUES ($1, $2) ON CONFLICT (workflow_instance_id) DO NOTHING`,
        [workflowInstanceId, engagementId],
      );
      // Only blank columns are in the plan; COALESCE guards a concurrent save.
      const casts: Record<string, string> = { period_end: '::date', py_period_end: '::date' };
      await client.query(
        `UPDATE hsdg.audit_financial_dataset
            SET ${headerCols.map(([c], i) => `${c} = COALESCE(${c}, $${i + 2}${casts[c] ?? ''})`).join(', ')},
                version = version + 1
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId, ...headerCols.map(([, v]) => v)],
      );
    }
    let valuesAdded = 0;
    // Last year's own figures first: they win over the master's prior-year profile.
    for (const v of priorValues) {
      const ins = await client.query(
        `INSERT INTO hsdg.audit_financial_value
           (workflow_instance_id, engagement_id, metric_key, period, amount, source_type, source_ref,
            rolled_forward_from_instance_id, rolled_forward_amount, rolled_forward_approved)
         VALUES ($1, $2, $3, 'py', $4, $5, $6, $7, $4, $8)
         ON CONFLICT (workflow_instance_id, metric_key, period) DO NOTHING`,
        [
          workflowInstanceId,
          engagementId,
          v.metricKey,
          v.amount,
          priorValueSource!.type,
          priorValueSource!.ref,
          prior!.workflowInstanceId,
          priorApproved,
        ],
      );
      valuesAdded += ins.rowCount ?? 0;
    }
    for (const v of plan.values) {
      const ins = await client.query(
        `INSERT INTO hsdg.audit_financial_value
           (workflow_instance_id, engagement_id, metric_key, period, amount, source_type, source_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workflow_instance_id, metric_key, period) DO NOTHING`,
        [
          workflowInstanceId,
          engagementId,
          v.metricKey,
          v.period,
          v.amount,
          v.sourceType,
          v.sourceRef,
        ],
      );
      valuesAdded += ins.rowCount ?? 0;
    }
    for (const sec of mergedSections) {
      await client.query(
        `INSERT INTO hsdg.audit_understanding_section
           (workflow_instance_id, engagement_id, section_key, answers)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (workflow_instance_id, section_key) DO NOTHING`,
        [workflowInstanceId, engagementId, sec.key, JSON.stringify(sec.answers)],
      );
    }
    if (plan.industryProfile) {
      await client.query(
        `UPDATE hsdg.audit_business_understanding SET industry_profile = $2
          WHERE workflow_instance_id = $1 AND industry_profile = 'generic'`,
        [workflowInstanceId, plan.industryProfile],
      );
    }
    if (valuesAdded || plan.industryProfile) {
      await this.syncExceptions(client, ctx, engagementId, workflowInstanceId);
    }
    await markDone();
    if (headerCols.length || valuesAdded || mergedSections.length || plan.industryProfile) {
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.business_understanding_prefilled',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: {
          header: headerCols.map(([c]) => c),
          values: valuesAdded,
          sections: mergedSections.map((x) => x.key),
          priorYear: prior?.financialYear ?? null,
          industryProfile: plan.industryProfile,
        },
      });
    }
  }

  private async ensureRecord(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<RecordRow> {
    await client.query(
      `INSERT INTO hsdg.audit_business_understanding (workflow_instance_id, engagement_id)
       VALUES ($1, $2) ON CONFLICT (workflow_instance_id) DO NOTHING`,
      [workflowInstanceId, engagementId],
    );
    const { rows } = await client.query<RecordRow>(
      `SELECT * FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows[0]!;
  }

  /** First piece of work moves 03.2 (and its checklist row) to in progress. */
  private async markInProgress(
    client: PoolClient,
    ctx: RlsContext,
    workflowInstanceId: string,
  ): Promise<void> {
    const res = await client.query(
      `UPDATE hsdg.audit_business_understanding SET status = 'in_progress', version = version + 1
        WHERE workflow_instance_id = $1 AND status = 'not_started'`,
      [workflowInstanceId],
    );
    if ((res.rowCount ?? 0) > 0) await this.rollUp(client, ctx, workflowInstanceId, 'in_progress');
  }

  private async rollUp(
    client: PoolClient,
    ctx: RlsContext,
    workflowInstanceId: string,
    status: UnderstandingStatus,
  ): Promise<void> {
    const state = status === 'reassessment_required' ? 'needs_attention' : status;
    await client.query(
      `UPDATE hsdg.audit_planning_items
          SET state = $3, updated_by_employee_id = $4, content_updated_at = now(),
              version = version + 1
        WHERE workflow_instance_id = $1 AND item_key = $2 AND state <> $3`,
      [workflowInstanceId, UNDERSTANDING_ITEM_KEY, state, ctx.employeeId ?? null],
    );
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────────

/** At most eight items, then "+n more". */
function listOf(items: string[]): string {
  return items.length > 8
    ? `${items.slice(0, 8).join('; ')}; +${items.length - 8} more`
    : items.join('; ');
}

const CHALLENGE_AREA_LABEL: Record<UnderstandingChallengeTarget, string> = {
  section: '03.2 section',
  dataset: '03.2.7 Focused financial dataset',
  analytics: '03.2.8 Preliminary analytics',
  exception: 'Investigation Card',
  expectation: 'Expectation vs actual',
  conclusion: '03.2.10 Understanding & analytics conclusion',
};

export function challengeTargetLabel(
  type: UnderstandingChallengeTarget,
  ref: string | null,
  cardSeq: number | null,
  metricKey: string | null,
): string {
  if (type === 'section') {
    const def = UNDERSTANDING_SECTION_DEFS.find((d) => d.key === ref);
    return def ? `${def.code} ${def.title}` : CHALLENGE_AREA_LABEL.section;
  }
  if (type === 'exception' && cardSeq !== null) return displayCode('AX', cardSeq)!;
  if (type === 'expectation' && metricKey) return `Expectation — ${metricLabel(metricKey)}`;
  return CHALLENGE_AREA_LABEL[type];
}

/** An answer in full for the revision view — table rows by content, not by count. */
const diffText = (v: UnderstandingAnswer | undefined): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (v.length && Array.isArray(v[0])) {
    return (v as string[][]).map((row) => row.filter(Boolean).join(' | ')).join('; ');
  }
  return (v as string[]).join(', ') || null;
};

const fmtAmount = (n: number): string => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * What changed between two 03.2 snapshots (§20 revision view): figures,
 * section answers, Investigation Cards and the conclusion. Exported for tests.
 */
export function diffUnderstandingSnapshots(
  before: UnderstandingSnapshot,
  after: UnderstandingSnapshot,
): UnderstandingRevisionChange[] {
  const out: UnderstandingRevisionChange[] = [];
  const push = (
    area: UnderstandingRevisionChange['area'],
    label: string,
    b: string | null,
    a: string | null,
  ) => {
    if (b !== a) out.push({ area, label, before: b, after: a });
  };

  const fig = (s: UnderstandingSnapshot) =>
    new Map(s.values.map((v) => [`${v.metricKey}:${v.period}`, v]));
  const fb = fig(before);
  const fa = fig(after);
  for (const key of new Set([...fb.keys(), ...fa.keys()])) {
    const v = fa.get(key) ?? fb.get(key)!;
    push(
      'figure',
      `${v.label} (${v.period.toUpperCase()})`,
      fb.has(key) ? fmtAmount(fb.get(key)!.amount) : null,
      fa.has(key) ? fmtAmount(fa.get(key)!.amount) : null,
    );
  }

  for (const def of UNDERSTANDING_SECTION_DEFS) {
    const sb = before.sections.find((x) => x.key === def.key);
    const sa = after.sections.find((x) => x.key === def.key);
    push(
      'section',
      `${def.code} Anything changed?`,
      sb?.anythingChanged ?? null,
      sa?.anythingChanged ?? null,
    );
    for (const f of def.fields) {
      push(
        'section',
        `${def.code} ${f.label}`,
        diffText(sb?.answers[f.key]),
        diffText(sa?.answers[f.key]),
      );
    }
  }

  const cardText = (c: UnderstandingSnapshot['cards'][number] | undefined) =>
    c
      ? [c.assessment ? INVESTIGATION_ASSESSMENT_LABEL[c.assessment] : 'Not assessed', c.signalCode]
          .filter(Boolean)
          .join(' · ')
      : null;
  const cb = new Map(before.cards.map((c) => [c.id, c]));
  const ca = new Map(after.cards.map((c) => [c.id, c]));
  for (const id of new Set([...cb.keys(), ...ca.keys()])) {
    const c = ca.get(id) ?? cb.get(id)!;
    push('exception', `${c.code} ${c.observation}`, cardText(cb.get(id)), cardText(ca.get(id)));
  }

  const eb = new Map(before.expectations.map((e) => [e.id, e]));
  const ea = new Map(after.expectations.map((e) => [e.id, e]));
  for (const id of new Set([...eb.keys(), ...ea.keys()])) {
    const e = ea.get(id) ?? eb.get(id)!;
    const text = (x: typeof e | undefined) =>
      x ? (x.conclusion ? EXPECTATION_CONCLUSION_LABEL[x.conclusion] : 'Not concluded') : null;
    push('conclusion', `Expectation — ${e.label}`, text(eb.get(id)), text(ea.get(id)));
  }

  push(
    'conclusion',
    'Understanding & analytics conclusion',
    before.record.conclusionSummary,
    after.record.conclusionSummary,
  );
  push(
    'conclusion',
    'Industry profile',
    before.record.industryProfile,
    after.record.industryProfile,
  );
  return out;
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

/** Validate section answers against the field catalogue (unknown keys / bad shapes rejected). */
export function validateAnswers(
  sectionKey: UnderstandingSectionKey,
  answers: Record<string, UnderstandingAnswer>,
): Record<string, UnderstandingAnswer> {
  const def = UNDERSTANDING_SECTION_DEFS.find((d) => d.key === sectionKey)!;
  const out: Record<string, UnderstandingAnswer> = {};
  for (const [key, value] of Object.entries(answers)) {
    const field = def.fields.find((f) => f.key === key);
    if (!field) throw new BadRequestException(`Unknown field "${key}" for ${def.code}.`);
    if (value === null || value === '') {
      out[key] = null;
      continue;
    }
    const bad = () => new BadRequestException(`Invalid value for "${field.label}".`);
    switch (field.type) {
      case 'text':
        if (typeof value !== 'string' || value.length > 4000) throw bad();
        out[key] = value.trim() || null;
        break;
      case 'yes_no':
      case 'yes_no_unknown':
      case 'select':
        if (typeof value !== 'string' || !field.options?.includes(value)) throw bad();
        out[key] = value;
        break;
      case 'multi':
        if (
          !Array.isArray(value) ||
          value.some((x) => typeof x !== 'string' || !field.options?.includes(x))
        ) {
          throw bad();
        }
        out[key] = [...new Set(value as string[])];
        break;
      case 'repeat': {
        const cols = field.columns?.length ?? 0;
        if (
          !Array.isArray(value) ||
          value.length > 50 ||
          value.some(
            (row) =>
              !Array.isArray(row) ||
              row.length !== cols ||
              row.some((c) => typeof c !== 'string' || c.length > 500),
          )
        ) {
          throw bad();
        }
        out[key] = (value as string[][])
          .map((row) => row.map((c) => c.trim()))
          .filter((row) => row.some(Boolean));
        break;
      }
    }
  }
  return out;
}

function describeExpectation(e: PlanningExpectationRecord): string {
  if (e.expectationType === 'amount') return `expected ${e.expectedAmount}`;
  if (e.expectationType === 'range') return `expected ${e.expectedLow}–${e.expectedHigh}`;
  return `expected to ${e.expectedDirection === 'stable' ? 'remain stable' : e.expectedDirection}`;
}

/** Variance and the system's investigation suggestion (§14). The auditor confirms. */
export function evaluateExpectation(
  e: PlanningExpectationRecord,
  py: number | null,
): Pick<PlanningExpectationRecord, 'variance' | 'suggestedInvestigation'> {
  const a = e.actual;
  if (a === null) return { variance: null, suggestedInvestigation: null };
  const tol = e.tolerancePct ?? 0;
  if (e.expectationType === 'amount' && e.expectedAmount !== null) {
    const variance = a - e.expectedAmount;
    const base = Math.abs(e.expectedAmount) || 1;
    return { variance, suggestedInvestigation: (Math.abs(variance) / base) * 100 > tol };
  }
  if (e.expectationType === 'range' && e.expectedLow !== null && e.expectedHigh !== null) {
    const variance =
      a < e.expectedLow ? a - e.expectedLow : a > e.expectedHigh ? a - e.expectedHigh : 0;
    return { variance, suggestedInvestigation: variance !== 0 };
  }
  if (e.expectationType === 'direction' && py !== null && py !== 0) {
    const change = ((a - py) / Math.abs(py)) * 100;
    const band = Math.max(tol, 0);
    const actualDir = change > band ? 'increase' : change < -band ? 'decrease' : 'stable';
    return { variance: a - py, suggestedInvestigation: actualDir !== e.expectedDirection };
  }
  return { variance: null, suggestedInvestigation: null };
}

const answerText = (v: UnderstandingAnswer | undefined): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (v.length && Array.isArray(v[0])) return `${v.length} item(s)`;
  return (v as string[]).join(', ');
};

/**
 * Compose the §19 Understanding & Analytics conclusion from structured data.
 * Exported for unit tests. Reports facts and codes; never a risk conclusion.
 */
export function composeUnderstandingConclusion(
  s: BusinessUnderstandingSummary,
  cards: readonly InvestigationCardRecord[],
): string {
  const sec = (k: UnderstandingSectionKey) => s.sections.find((x) => x.key === k)!;
  const lines: string[] = [];
  const block = (title: string, items: (string | null | false | undefined)[], empty: string) => {
    const kept = items.filter((x): x is string => !!x);
    if (lines.length) lines.push('');
    lines.push(title, ...(kept.length ? kept.map((x) => `- ${x}`) : [`- ${empty}`]));
  };
  const changed = (k: UnderstandingSectionKey) =>
    sec(k).anythingChanged === 'yes'
      ? 'Changes reported this year.'
      : sec(k).anythingChanged === 'no'
        ? 'No change from prior understanding.'
        : null;

  const bm = sec('business_model').answers;
  block(
    'How the entity operates',
    [
      answerText(bm.activities) && `Activities: ${answerText(bm.activities)}`,
      answerText(bm.activities_note),
      answerText(bm.revenue_streams) &&
        `Revenue streams recorded: ${answerText(bm.revenue_streams)}`,
      answerText(bm.channels) && `Channels: ${answerText(bm.channels)}`,
      bm.seasonality === 'Yes' && `Seasonal: ${answerText(bm.seasonality_note) ?? 'yes'}`,
      changed('business_model'),
    ],
    'Not yet documented (03.2.1).',
  );
  const gv = sec('governance').answers;
  block(
    'Ownership / governance changes',
    [
      answerText(gv.ownership_changes),
      answerText(gv.management_observation),
      changed('governance'),
    ],
    'Not yet documented (03.2.2).',
  );
  const ind = sec('industry').answers;
  block(
    'External / industry matters',
    [
      `Industry profile: ${INDUSTRY_PROFILE_LABEL[s.record.industryProfile]}`,
      answerText(ind.competition) && `Competition: ${answerText(ind.competition)}`,
      answerText(ind.demand_pricing),
      ind.regulatory_change === 'Yes' &&
        `Regulatory change: ${answerText(ind.regulatory_change_note) ?? 'yes'}`,
    ],
    'Not yet documented (03.2.3).',
  );
  const sy = sec('systems').answers;
  block(
    'Systems / process changes',
    [
      answerText(sy.erp) && `System: ${answerText(sy.erp)}`,
      sy.erp_change === 'Yes' && 'Major system change / migration during the year.',
      sy.spreadsheets === 'Yes' &&
        `Significant manual processes: ${answerText(sy.spreadsheets_note) ?? 'yes'}`,
      changed('systems'),
    ],
    'Not yet documented (03.2.4).',
  );
  const ob = sec('objectives').answers;
  block(
    'Objectives / business risks',
    [
      answerText(ob.objectives) && `Objectives: ${answerText(ob.objectives)}`,
      answerText(ob.fr_effect),
    ],
    'Not yet documented (03.2.5).',
  );
  const pf = sec('performance').answers;
  block(
    'Management KPIs / performance',
    [
      answerText(pf.kpis) && `KPIs tracked: ${answerText(pf.kpis)}`,
      answerText(pf.covenants) && `Covenants: ${answerText(pf.covenants)}`,
      answerText(pf.under_over_performance),
    ],
    'Not yet documented (03.2.6).',
  );
  const top = s.analytics.movements
    .filter((m) => m.percent !== null)
    .sort((a, b) => Math.abs(b.percent!) - Math.abs(a.percent!))
    .slice(0, 6);
  block(
    'Key financial movements',
    top.map((m) => `${m.label}: ${m.percentLabel} (CY ${m.cy} vs PY ${m.py})`),
    'No comparable figures entered (03.2.7).',
  );
  const active = cards.filter((c) => !c.noLongerFlagged);
  block(
    'Unusual relationships investigated',
    active
      .filter((c) => c.assessment)
      .map(
        (c) => `${c.cardCode} ${c.observation} — ${INVESTIGATION_ASSESSMENT_LABEL[c.assessment!]}`,
      ),
    'None assessed yet.',
  );
  block(
    'Planning Signals generated / linked',
    active.filter((c) => c.signalCode).map((c) => `${c.signalCode} ← ${c.cardCode}`),
    'None.',
  );
  block(
    'Matters requiring further information',
    active
      .filter((c) => c.status !== 'assessed' || c.needsReassessment)
      .map((c) => `${c.cardCode} ${c.observation}${c.ownerName ? ` (owner ${c.ownerName})` : ''}`),
    'None.',
  );
  return lines.join('\n');
}

function mapException(
  x: ExceptionRow,
  focusBySignal: ReadonlyMap<string, UnderstandingFocusLink[]> = new Map(),
): InvestigationCardRecord {
  return {
    id: x.id,
    cardCode: displayCode('AX', x.seq)!,
    ruleKey: x.rule_key,
    observation: x.observation,
    whyFlagged: x.why_flagged,
    suggestedAttention: x.suggested_attention,
    values: x.values ?? {},
    managementExplanation: x.management_explanation,
    explanationBy: x.explanation_by,
    explanationDate: x.explanation_date,
    evidence: x.evidence,
    assessment: x.assessment,
    affectedAreas: x.affected_areas ?? [],
    signalDecision: x.signal_decision,
    noSignalRationale: x.no_signal_rationale,
    signalId: x.signal_id,
    signalCode: displayCode('PS', x.signal_seq),
    focusAreas: x.signal_id ? (focusBySignal.get(x.signal_id) ?? []) : [],
    ownerEmployeeId: x.owner_employee_id,
    ownerName: x.owner_name,
    dueDate: x.due_date,
    status: x.status,
    needsReassessment: x.needs_reassessment,
    noLongerFlagged: x.no_longer_flagged,
    version: x.version,
    createdAt: x.created_at.toISOString(),
    updatedAt: x.updated_at.toISOString(),
  };
}

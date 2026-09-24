import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CUSTOM_METRIC_PREFIX,
  FINANCIAL_METRIC_DEFS,
  INDUSTRY_PROFILE_LABEL,
  INVESTIGATION_ASSESSMENT,
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
import { INDUSTRY_PROFILE_CONFIG, runPreliminaryAnalytics } from './planning-analytics-engine';
import {
  assertShell,
  assertSignalsInShell,
  clean,
  displayCode,
  insertSignal,
} from './planning-shared';

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
  status: UnderstandingStatus;
  industry_profile: IndustryProfile;
  ba01: Ba01Answer | null;
  conclusion_summary: string | null;
  version: number;
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
      await this.ensureRecord(client, engagementId, workflowInstanceId);
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
        await this.syncExceptions(client, engagementId, workflowInstanceId);
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
      const status: UnderstandingStatus = nextBa01 === 'yes_complete' ? 'complete' : 'in_progress';
      const { rows } = await client.query<RecordRow>(
        `UPDATE hsdg.audit_business_understanding
            SET industry_profile = $3, ba01 = $4, conclusion_summary = $5, status = $6,
                version = version + 1
          WHERE workflow_instance_id = $1 AND version = $2
        RETURNING *`,
        [workflowInstanceId, input.version, nextProfile, nextBa01, nextSummary, status],
      );
      if (!rows[0]) {
        throw new ConflictException('03.2 changed since you loaded it; refresh and retry.');
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
      await this.ensureRecord(client, engagementId, workflowInstanceId);
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
                input.reviewed ?? false,
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
                input.reviewed ?? null,
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
        after: { section: sectionKey, reviewed: input.reviewed ?? null },
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
      await this.ensureRecord(client, engagementId, workflowInstanceId);
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
      await this.syncExceptions(client, engagementId, workflowInstanceId);
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
      await this.ensureRecord(client, engagementId, workflowInstanceId);
      const header = await this.readDataset(client, workflowInstanceId);
      if (!header.periodEnd || !header.currency || !header.units) {
        throw new BadRequestException(
          'Record the period end, currency and units before entering figures.',
        );
      }
      const custom = new Set(
        (await this.readCustomMetrics(client, workflowInstanceId)).map((c) => c.key),
      );
      for (const v of input.values) {
        if (!CANONICAL_KEYS.has(v.metricKey) && !custom.has(v.metricKey)) {
          throw new BadRequestException(`Unknown metric "${v.metricKey}".`);
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
                          entered_by_employee_id = $9, entered_at = now(), version = version + 1
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
                  ],
                );
        }
        if ((result.rowCount ?? 0) === 0) {
          throw new ConflictException(
            `${v.metricKey} (${v.period.toUpperCase()}) changed since you loaded it; refresh and retry.`,
          );
        }
      }
      await this.syncExceptions(client, engagementId, workflowInstanceId);
      await this.markInProgress(client, ctx, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_values_saved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { count: input.values.length },
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
      const { rows: out } = await client.query<ExceptionRow>(
        `${EXCEPTION_SELECT} WHERE x.id = $1`,
        [cardId],
      );
      return mapException(out[0]!);
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
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const analytics = await this.computeAnalytics(client, workflowInstanceId);
    const { rows: existing } = await client.query<{
      rule_key: string;
      values: Record<string, number | null>;
      status: InvestigationStatus;
      no_longer_flagged: boolean;
    }>(
      `SELECT rule_key, values, status, no_longer_flagged FROM hsdg.audit_analytics_exception
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
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
        continue;
      }
      const changed = JSON.stringify(sortKeys(prior.values)) !== JSON.stringify(sortKeys(e.values));
      if (!changed && !prior.no_longer_flagged) continue;
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
  ): Promise<PlanningCompletionCheck[]> {
    const { rows: rec } = await client.query<RecordRow>(
      `SELECT * FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const r = rec[0]!;
    const ba01 = override.ba01 !== undefined ? override.ba01 : r.ba01;
    const summaryText =
      override.conclusionSummary !== undefined ? override.conclusionSummary : r.conclusion_summary;
    const sections = await this.readSections(client, workflowInstanceId);
    const unreviewed = sections.filter((s) => !s.reviewed);
    const header = await this.readDataset(client, workflowInstanceId);
    const values = await this.readValues(client, workflowInstanceId);
    const analytics = await this.computeAnalytics(client, workflowInstanceId);
    const { rows: c } = await client.query<{
      unassessed: string;
      stale: string;
      undecided: string;
      exp_open: string;
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
             AND conclusion IS NULL) AS exp_open`,
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
    const { rows } = await client.query<RecordRow>(
      `SELECT * FROM hsdg.audit_business_understanding WHERE workflow_instance_id = $1`,
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
    return {
      record,
      sections: await this.readSections(client, workflowInstanceId),
      industryConsiderations: [...INDUSTRY_PROFILE_CONFIG[r.industry_profile].considerations],
      dataset: await this.readDataset(client, workflowInstanceId),
      customMetrics: await this.readCustomMetrics(client, workflowInstanceId),
      values: await this.readValues(client, workflowInstanceId),
      analytics: await this.computeAnalytics(client, workflowInstanceId),
      openInvestigations: Number(open[0]?.n ?? 0),
      completion: await this.computeCompletion(client, workflowInstanceId),
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
    }>(
      `SELECT accounting_environment, initial_audit FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const out: Partial<Record<UnderstandingSectionKey, UnderstandingContextItem[]>> = {};
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
              emp.full_name AS entered_by_name, v.entered_at, v.version
         FROM hsdg.audit_financial_value v
         LEFT JOIN hsdg.employees emp ON emp.id = v.entered_by_employee_id
        WHERE v.workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows.map((v) => ({
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
    return rows.map(mapException);
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
    await client.query(
      `UPDATE hsdg.audit_planning_items
          SET state = $3, updated_by_employee_id = $4, content_updated_at = now(),
              version = version + 1
        WHERE workflow_instance_id = $1 AND item_key = $2 AND state <> $3`,
      [workflowInstanceId, UNDERSTANDING_ITEM_KEY, status, ctx.employeeId ?? null],
    );
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────────

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

function mapException(x: ExceptionRow): InvestigationCardRecord {
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

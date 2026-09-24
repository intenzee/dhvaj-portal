import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  AUDIT_ORIENTATION_LABEL,
  PLANNING_ATTENTION,
  PLANNING_CHANGE_CATEGORY,
  PLANNING_CHANGE_CATEGORY_LABEL,
  PLANNING_DESTINATIONS,
  PLANNING_INTELLIGENCE_STATUS,
  PLANNING_SIGNAL_ASSESSMENT,
  PLANNING_SIGNAL_MANUAL_SOURCES,
  PLANNING_SIGNAL_SOURCE,
  PLANNING_SIGNAL_STATUS,
  type AreaOfFocusRecord,
  type AreaOfFocusStatus,
  type AssessPlanningSignalInput,
  type AuditOrientation,
  type CreateAreaOfFocusInput,
  type CreatePlanningChangeInput,
  type CreatePlanningSignalInput,
  type PlanningAttention,
  type PlanningChangeCategory,
  type PlanningChangeFrImpact,
  type PlanningChangeRecord,
  type PlanningDestination,
  type PlanningIntelligenceRecord,
  type PlanningIntelligenceStatus,
  type PlanningIntelligenceSummary,
  type PlanningSignalAssessment,
  type PlanningSignalRecord,
  type PlanningSignalSource,
  type PlanningSignalStatus,
  type UpdateAreaOfFocusInput,
  type UpdatePlanningChangeInput,
  type UpdatePlanningIntelligenceInput,
  type AcceptanceCarryForwardRecord,
  type PlanningCompletionCheck,
  type PlanningConsiderationRecord,
  type PriorYearMatterRecord,
  PLANNING_CONSIDERATION_ASSESSMENT_LABEL,
  PRIOR_YEAR_ASSESSMENT_LABEL,
  PRIOR_YEAR_MATTER_TYPE_LABEL,
  ACCEPTANCE_CARRY_FORWARD_ACTION_LABEL,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditPlanningStrategyService } from './audit-planning-strategy.service';
import { AuditAreaReviewService } from './audit-area-review.service';
import {
  deriveEngagementSignals,
  type EngagementIntelligenceFacts,
} from './planning-signals-generation';
import {
  assertShell,
  assertSignalsInShell,
  clean,
  cleanList,
  insertSignal,
  maxSeq,
} from './planning-shared';

/** The planning sub-area 03.1 rolls its state up into (existing Phase 03 checklist). */
const STRATEGY_ITEM_KEY = 'audit_strategy';

interface SignalRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  seq: number;
  source: PlanningSignalSource;
  rule_key: string | null;
  source_ref: string | null;
  source_link: string | null;
  observation: string;
  why_may_matter: string | null;
  potential_implications: string | null;
  suggested_attention: PlanningAttention;
  attention: PlanningAttention;
  attention_rationale: string | null;
  manager_assessment: PlanningSignalAssessment | null;
  assessment_rationale: string | null;
  owner_name: string | null;
  destinations: PlanningDestination[];
  status: PlanningSignalStatus;
  is_auto: boolean;
  document_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface FocusRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  seq: number;
  name: string;
  why_requires_attention: string | null;
  potential_fs_areas: string[];
  expected_strategic_implication: string | null;
  partner_attention: boolean;
  destinations: PlanningDestination[];
  status: AreaOfFocusStatus;
  signal_ids: string[] | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface ChangeRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  category: PlanningChangeCategory;
  description: string | null;
  effective_date: string | null;
  source_evidence: string | null;
  fr_impact_known: PlanningChangeFrImpact | null;
  signal_id: string | null;
  document_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface IntelligenceRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  status: PlanningIntelligenceStatus;
  orientation: AuditOrientation | null;
  orientation_note: string | null;
  additional_scope_required: boolean | null;
  additional_scope: string | null;
  prior_year_reviewed: boolean;
  strategy_summary: string | null;
  intelligence_generated_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const SIGNAL_SELECT = `
  SELECT s.id, s.workflow_instance_id, s.engagement_id, s.seq, s.source, s.rule_key,
         s.source_ref, s.source_link, s.observation, s.why_may_matter,
         s.potential_implications, s.suggested_attention, s.attention,
         s.attention_rationale, s.manager_assessment, s.assessment_rationale,
         owner.full_name AS owner_name, s.destinations, s.status, s.is_auto,
         s.document_id, s.version, s.created_at, s.updated_at
    FROM hsdg.audit_planning_signal s
    LEFT JOIN hsdg.employees owner ON owner.id = s.owner_employee_id`;

const FOCUS_SELECT = `
  SELECT f.id, f.workflow_instance_id, f.engagement_id, f.seq, f.name,
         f.why_requires_attention, f.potential_fs_areas,
         f.expected_strategic_implication, f.partner_attention, f.destinations,
         f.status, f.version, f.created_at, f.updated_at,
         (SELECT array_agg(fs.signal_id ORDER BY fs.created_at)
            FROM hsdg.audit_focus_signal fs WHERE fs.focus_id = f.id) AS signal_ids
    FROM hsdg.audit_area_of_focus f`;

const CHANGE_SELECT = `
  SELECT c.id, c.workflow_instance_id, c.engagement_id, c.category, c.description,
         c.effective_date::text, c.source_evidence, c.fr_impact_known, c.signal_id,
         c.document_id, c.version, c.created_at, c.updated_at
    FROM hsdg.audit_planning_change c`;

/**
 * Planning Signal Register + 03.1 Planning Intelligence & Overall Audit Strategy
 * (DHVAJ 03.1; docs/section-03-planning-build-spec.md §4, §5.1).
 *
 * The register is the ONE engagement-scoped signal store shared by all of
 * Section 03. This service GENERATES baseline signals from the confirmed
 * Section 01/02 facts (never re-entered), lets the Manager assess them, group
 * them into Areas of Focus and record the preliminary overall audit direction.
 * A signal is never an RMM conclusion — nothing here writes `audit_risks`.
 */
@Injectable()
export class AuditPlanningIntelligenceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly strategy: AuditPlanningStrategyService,
    private readonly areaReview: AuditAreaReviewService,
  ) {}

  // ── Control room (§4) ──────────────────────────────────────────────────────

  async getSummary(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningIntelligenceSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const record = await this.ensureRecord(client, engagementId, workflowInstanceId);
      return this.buildSummary(client, workflowInstanceId, record);
    });
  }

  /**
   * 03.1.1 Engagement Intelligence — derive baseline signals from Section 01/02
   * facts. Idempotent: upserts by rule_key and refreshes the factual text, but
   * never overwrites the Manager's attention, assessment, owner or status, and
   * never silently deletes a signal whose source fact has since changed.
   */
  async generateIntelligence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningIntelligenceSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      await this.ensureRecord(client, engagementId, workflowInstanceId);

      const facts = await this.readFacts(client, workflowInstanceId);
      const derived = deriveEngagementSignals(facts);

      let nextSeq = await maxSeq(client, 'audit_planning_signal', workflowInstanceId);
      let created = 0;
      for (const d of derived) {
        const { rows: existing } = await client.query(
          `SELECT 1 FROM hsdg.audit_planning_signal
            WHERE workflow_instance_id = $1 AND rule_key = $2`,
          [workflowInstanceId, d.ruleKey],
        );
        if (existing[0]) {
          // Refresh the factual text only when it actually changed, so a
          // re-run never bumps `version` under a Manager's open form.
          await client.query(
            `UPDATE hsdg.audit_planning_signal
                SET observation = $3,
                    why_may_matter = $4,
                    potential_implications = $5,
                    suggested_attention = $6,
                    source_link = $7,
                    version = version + 1
              WHERE workflow_instance_id = $1 AND rule_key = $2
                AND (observation, why_may_matter, potential_implications,
                     suggested_attention, source_link)
                    IS DISTINCT FROM ($3, $4, $5, $6, $7)`,
            [
              workflowInstanceId,
              d.ruleKey,
              d.observation,
              d.whyMayMatter,
              d.potentialImplications,
              d.suggestedAttention,
              d.sourceLink,
            ],
          );
        } else {
          nextSeq += 1;
          const ins = await client.query(
            `INSERT INTO hsdg.audit_planning_signal
               (workflow_instance_id, engagement_id, seq, source, rule_key, source_link,
                observation, why_may_matter, potential_implications,
                suggested_attention, attention, destinations, is_auto)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, true)
             ON CONFLICT DO NOTHING`,
            [
              workflowInstanceId,
              engagementId,
              nextSeq,
              d.source,
              d.ruleKey,
              d.sourceLink,
              d.observation,
              d.whyMayMatter,
              d.potentialImplications,
              d.suggestedAttention,
              d.destinations,
            ],
          );
          created += ins.rowCount ?? 0;
        }
      }

      await this.strategy.syncConsiderations(client, engagementId, workflowInstanceId);

      const { rows } = await client.query<IntelligenceRow>(
        `UPDATE hsdg.audit_planning_intelligence
            SET intelligence_generated_at = now(),
                status = CASE WHEN status = 'not_started' THEN 'intelligence_generated'
                              ELSE status END,
                version = version + 1
          WHERE workflow_instance_id = $1
        RETURNING *`,
        [workflowInstanceId],
      );
      await this.rollUpStrategyItem(client, ctx, workflowInstanceId, rows[0]!.status);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_intelligence_generated',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { derived: derived.length, created },
      });
      return this.buildSummary(client, workflowInstanceId, mapIntelligence(rows[0]!));
    });
  }

  /** Update the 03.1 record: AS-01 orientation, AS-02 scope, strategy summary, status. */
  async updateIntelligence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: UpdatePlanningIntelligenceInput,
  ): Promise<PlanningIntelligenceSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      await this.ensureRecord(client, engagementId, workflowInstanceId);

      if (input.status === PLANNING_INTELLIGENCE_STATUS.complete) {
        await this.assertCompletable(client, workflowInstanceId, input);
      }

      const { rows } = await client.query<IntelligenceRow>(
        `UPDATE hsdg.audit_planning_intelligence
            SET status = COALESCE($3, status),
                orientation = CASE WHEN $4::boolean THEN $5 ELSE orientation END,
                orientation_note = CASE WHEN $6::boolean THEN $7 ELSE orientation_note END,
                additional_scope = CASE WHEN $8::boolean THEN $9 ELSE additional_scope END,
                strategy_summary = CASE WHEN $10::boolean THEN $11 ELSE strategy_summary END,
                additional_scope_required =
                  CASE WHEN $12::boolean THEN $13 ELSE additional_scope_required END,
                prior_year_reviewed = COALESCE($14, prior_year_reviewed),
                version = version + 1
          WHERE workflow_instance_id = $1 AND version = $2
        RETURNING *`,
        [
          workflowInstanceId,
          input.version,
          input.status ?? null,
          input.orientation !== undefined,
          input.orientation ?? null,
          input.orientationNote !== undefined,
          clean(input.orientationNote),
          input.additionalScope !== undefined,
          clean(input.additionalScope),
          input.strategySummary !== undefined,
          clean(input.strategySummary),
          input.additionalScopeRequired !== undefined,
          input.additionalScopeRequired ?? null,
          input.priorYearReviewed ?? null,
        ],
      );
      const row = rows[0];
      if (!row) {
        throw new ConflictException(
          'Planning Intelligence changed since you loaded it; refresh and retry.',
        );
      }
      await this.rollUpStrategyItem(client, ctx, workflowInstanceId, row.status);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_intelligence_updated',
        objectType: 'audit_planning_intelligence',
        objectId: row.id,
        after: { status: row.status, orientation: row.orientation },
      });
      return this.buildSummary(client, workflowInstanceId, mapIntelligence(row));
    });
  }

  /**
   * Generate a draft Strategy Summary (§17) from the structured data. The
   * Manager edits the commentary; the structured records stay authoritative.
   * Returns the draft text without persisting it.
   */
  async draftStrategySummary(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ draft: string }> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const record = await this.ensureRecord(client, engagementId, workflowInstanceId);
      const signals = await this.readSignals(client, workflowInstanceId);
      const focus = await this.readFocusAreas(client, workflowInstanceId);
      const extras = await this.readStrategyExtras(client, workflowInstanceId);
      return { draft: composeStrategySummary(record, signals, focus, extras) };
    });
  }

  // ── Signals (§7–§10) ───────────────────────────────────────────────────────

  async listSignals(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningSignalRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      return this.readSignals(client, workflowInstanceId);
    });
  }

  /** Raise a signal by hand (Manager / Partner / prior-year matter). */
  async createSignal(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreatePlanningSignalInput,
  ): Promise<PlanningSignalRecord> {
    if (!PLANNING_SIGNAL_MANUAL_SOURCES.includes(input.source)) {
      throw new BadRequestException(
        'Only prior-year, Manager or Partner signals can be raised by hand; other sources are generated.',
      );
    }
    const observation = input.observation?.trim();
    if (!observation) throw new BadRequestException('A signal needs a factual observation.');

    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const attention = input.suggestedAttention ?? PLANNING_ATTENTION.standard;
      const id = await insertSignal(client, engagementId, workflowInstanceId, {
        source: input.source,
        sourceLink: clean(input.sourceLink),
        observation,
        whyMayMatter: clean(input.whyMayMatter),
        potentialImplications: clean(input.potentialImplications),
        attention,
        documentId: input.documentId ?? null,
      });
      await this.strategy.syncConsiderations(client, engagementId, workflowInstanceId);
      // §25 (03.5): a new Enhanced / Immediate signal can make a completed 03.5 Update Required.
      await this.areaReview.markImpacted(client, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_signal_created',
        objectType: 'audit_planning_signal',
        objectId: id,
        after: { source: input.source, attention },
      });
      return this.readSignalById(client, id);
    });
  }

  /**
   * Assess a signal in place (§9). Enforces the rationale gates: `not_relevant`
   * needs an assessment rationale; downgrading a system-suggested Immediate
   * Partner Attention needs an attention rationale (§10). A signal can never
   * become an RMM / significant risk here.
   */
  async assessSignal(
    ctx: RlsContext,
    engagementId: string,
    signalId: string,
    input: AssessPlanningSignalInput,
  ): Promise<PlanningSignalRecord> {
    assertDestinations(input.destinations);
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        workflow_instance_id: string;
        suggested_attention: PlanningAttention;
        attention: PlanningAttention;
        attention_rationale: string | null;
        manager_assessment: PlanningSignalAssessment | null;
        assessment_rationale: string | null;
        owner_employee_id: string | null;
      }>(
        `SELECT workflow_instance_id, suggested_attention, attention, attention_rationale,
                manager_assessment, assessment_rationale, owner_employee_id
           FROM hsdg.audit_planning_signal
          WHERE id = $1 AND engagement_id = $2`,
        [signalId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Planning Signal not found.');

      const nextAttention = input.attention ?? current.attention;
      const nextAttentionRationale =
        input.attentionRationale !== undefined
          ? clean(input.attentionRationale)
          : current.attention_rationale;
      const nextAssessment =
        input.managerAssessment !== undefined
          ? input.managerAssessment
          : current.manager_assessment;
      const nextAssessmentRationale =
        input.assessmentRationale !== undefined
          ? clean(input.assessmentRationale)
          : current.assessment_rationale;
      const nextOwner =
        input.ownerEmployeeId !== undefined ? input.ownerEmployeeId : current.owner_employee_id;

      const downgradesIpa =
        current.suggested_attention === PLANNING_ATTENTION.immediatePartner &&
        nextAttention !== PLANNING_ATTENTION.immediatePartner;
      if (downgradesIpa && !nextAttentionRationale) {
        throw new BadRequestException(
          'Downgrading a system-suggested Immediate Partner Attention signal requires a rationale.',
        );
      }
      if (nextAssessment === PLANNING_SIGNAL_ASSESSMENT.notRelevant && !nextAssessmentRationale) {
        throw new BadRequestException('Marking a signal Not Relevant requires a rationale.');
      }
      if (nextAssessment === PLANNING_SIGNAL_ASSESSMENT.furtherInformationRequired && !nextOwner) {
        throw new BadRequestException('A signal needing further information must have an owner.');
      }

      // Status follows the assessment unless the caller sets it explicitly.
      const nextStatus: PlanningSignalStatus | null =
        input.status ??
        (input.managerAssessment === undefined
          ? null
          : nextAssessment === PLANNING_SIGNAL_ASSESSMENT.furtherInformationRequired
            ? PLANNING_SIGNAL_STATUS.awaitingInformation
            : nextAssessment === PLANNING_SIGNAL_ASSESSMENT.notRelevant
              ? PLANNING_SIGNAL_STATUS.closed
              : nextAssessment
                ? PLANNING_SIGNAL_STATUS.assessed
                : null);

      const result = await client.query(
        `UPDATE hsdg.audit_planning_signal
            SET attention = $3,
                attention_rationale = $4,
                manager_assessment = $5,
                assessment_rationale = $6,
                owner_employee_id = $7,
                destinations = COALESCE($8::text[], destinations),
                status = COALESCE($9, status),
                document_id = CASE WHEN $10::boolean THEN $11 ELSE document_id END,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          signalId,
          input.version,
          nextAttention,
          nextAttentionRationale,
          nextAssessment,
          nextAssessmentRationale,
          nextOwner,
          input.destinations ?? null,
          nextStatus,
          input.documentId !== undefined,
          input.documentId ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('This signal changed since you loaded it; refresh and retry.');
      }
      await this.strategy.syncConsiderations(client, engagementId, current.workflow_instance_id);
      await this.areaReview.markImpacted(client, current.workflow_instance_id);
      // The first assessment moves 03.1 into Manager Assessment (§4 status flow).
      const advanced = await client.query(
        `UPDATE hsdg.audit_planning_intelligence
            SET status = 'manager_assessment', version = version + 1
          WHERE workflow_instance_id = $1
            AND status IN ('not_started','intelligence_generated')`,
        [current.workflow_instance_id],
      );
      if ((advanced.rowCount ?? 0) > 0) {
        await this.rollUpStrategyItem(
          client,
          ctx,
          current.workflow_instance_id,
          PLANNING_INTELLIGENCE_STATUS.managerAssessment,
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_signal_assessed',
        objectType: 'audit_planning_signal',
        objectId: signalId,
        before: { attention: current.attention, managerAssessment: current.manager_assessment },
        after: { attention: nextAttention, managerAssessment: nextAssessment, status: nextStatus },
      });
      return this.readSignalById(client, signalId);
    });
  }

  // ── Areas of Focus (§11) ───────────────────────────────────────────────────

  async listFocusAreas(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<AreaOfFocusRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      return this.readFocusAreas(client, workflowInstanceId);
    });
  }

  async createFocusArea(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateAreaOfFocusInput,
  ): Promise<AreaOfFocusRecord> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('An Area of Focus needs a name.');
    assertDestinations(input.destinations);

    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const seq = (await maxSeq(client, 'audit_area_of_focus', workflowInstanceId)) + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_area_of_focus
           (workflow_instance_id, engagement_id, seq, name, why_requires_attention,
            potential_fs_areas, expected_strategic_implication, partner_attention,
            destinations)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          seq,
          name,
          clean(input.whyRequiresAttention),
          cleanList(input.potentialFsAreas),
          clean(input.expectedStrategicImplication),
          input.partnerAttention ?? false,
          input.destinations ?? [],
        ],
      );
      const id = rows[0]!.id;
      if (input.signalIds?.length) {
        await this.replaceFocusSignals(
          client,
          engagementId,
          workflowInstanceId,
          id,
          input.signalIds,
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.area_of_focus_created',
        objectType: 'audit_area_of_focus',
        objectId: id,
        after: { name, signals: input.signalIds?.length ?? 0 },
      });
      return this.readFocusById(client, id);
    });
  }

  async updateFocusArea(
    ctx: RlsContext,
    engagementId: string,
    focusId: string,
    input: UpdateAreaOfFocusInput,
  ): Promise<AreaOfFocusRecord> {
    if (input.name !== undefined && !input.name.trim()) {
      throw new BadRequestException('An Area of Focus needs a name.');
    }
    assertDestinations(input.destinations);

    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ workflow_instance_id: string }>(
        `SELECT workflow_instance_id FROM hsdg.audit_area_of_focus
          WHERE id = $1 AND engagement_id = $2`,
        [focusId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Area of Focus not found.');

      const result = await client.query(
        `UPDATE hsdg.audit_area_of_focus
            SET name = COALESCE($3, name),
                why_requires_attention = CASE WHEN $4::boolean THEN $5 ELSE why_requires_attention END,
                potential_fs_areas = COALESCE($6::text[], potential_fs_areas),
                expected_strategic_implication =
                  CASE WHEN $7::boolean THEN $8 ELSE expected_strategic_implication END,
                partner_attention = COALESCE($9, partner_attention),
                destinations = COALESCE($10::text[], destinations),
                status = COALESCE($11, status),
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          focusId,
          input.version,
          input.name?.trim() ?? null,
          input.whyRequiresAttention !== undefined,
          clean(input.whyRequiresAttention),
          input.potentialFsAreas ? cleanList(input.potentialFsAreas) : null,
          input.expectedStrategicImplication !== undefined,
          clean(input.expectedStrategicImplication),
          input.partnerAttention ?? null,
          input.destinations ?? null,
          input.status ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This Area of Focus changed since you loaded it; refresh and retry.',
        );
      }
      if (input.signalIds) {
        await this.replaceFocusSignals(
          client,
          engagementId,
          current.workflow_instance_id,
          focusId,
          input.signalIds,
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.area_of_focus_updated',
        objectType: 'audit_area_of_focus',
        objectId: focusId,
        after: { status: input.status, signals: input.signalIds?.length },
      });
      return this.readFocusById(client, focusId);
    });
  }

  // ── 03.1.2 Significant changes (PI-01) ─────────────────────────────────────

  async listChanges(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningChangeRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { rows } = await client.query<ChangeRow>(
        `${CHANGE_SELECT} WHERE c.workflow_instance_id = $1 ORDER BY c.created_at ASC`,
        [workflowInstanceId],
      );
      return rows.map(mapChange);
    });
  }

  /**
   * Record a current-year change. Captures only what changed / effective date /
   * source / whether FR impact is known — never asks the user to name the audit
   * risk (§6). Optionally generates one linked Planning Signal.
   */
  async createChange(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreatePlanningChangeInput,
  ): Promise<PlanningChangeRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_planning_change
           (workflow_instance_id, engagement_id, category, description, effective_date,
            source_evidence, fr_impact_known, document_id)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          input.category,
          clean(input.description),
          input.effectiveDate ?? null,
          clean(input.sourceEvidence),
          input.frImpactKnown ?? null,
          input.documentId ?? null,
        ],
      );
      const id = rows[0]!.id;
      if (input.createSignal && input.category !== PLANNING_CHANGE_CATEGORY.noSignificantChange) {
        await this.signalFromChange(client, engagementId, workflowInstanceId, id);
        await this.strategy.syncConsiderations(client, engagementId, workflowInstanceId);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_change_created',
        objectType: 'audit_planning_change',
        objectId: id,
        after: { category: input.category, createSignal: !!input.createSignal },
      });
      return this.readChangeById(client, id);
    });
  }

  async updateChange(
    ctx: RlsContext,
    engagementId: string,
    changeId: string,
    input: UpdatePlanningChangeInput,
  ): Promise<PlanningChangeRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        workflow_instance_id: string;
        category: PlanningChangeCategory;
        signal_id: string | null;
      }>(
        `SELECT workflow_instance_id, category, signal_id FROM hsdg.audit_planning_change
          WHERE id = $1 AND engagement_id = $2`,
        [changeId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Change not found.');

      const result = await client.query(
        `UPDATE hsdg.audit_planning_change
            SET description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                effective_date = CASE WHEN $5::boolean THEN $6::date ELSE effective_date END,
                source_evidence = CASE WHEN $7::boolean THEN $8 ELSE source_evidence END,
                fr_impact_known = CASE WHEN $9::boolean THEN $10 ELSE fr_impact_known END,
                document_id = CASE WHEN $11::boolean THEN $12 ELSE document_id END,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          changeId,
          input.version,
          input.description !== undefined,
          clean(input.description),
          input.effectiveDate !== undefined,
          input.effectiveDate ?? null,
          input.sourceEvidence !== undefined,
          clean(input.sourceEvidence),
          input.frImpactKnown !== undefined,
          input.frImpactKnown ?? null,
          input.documentId !== undefined,
          input.documentId ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This change was edited since you loaded it; refresh and retry.',
        );
      }
      if (
        input.createSignal &&
        !current.signal_id &&
        current.category !== PLANNING_CHANGE_CATEGORY.noSignificantChange
      ) {
        await this.signalFromChange(client, engagementId, current.workflow_instance_id, changeId);
        await this.strategy.syncConsiderations(client, engagementId, current.workflow_instance_id);
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_change_updated',
        objectType: 'audit_planning_change',
        objectId: changeId,
        after: { createSignal: !!input.createSignal },
      });
      return this.readChangeById(client, changeId);
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Generate the one Planning Signal a change may produce, and link it. */
  private async signalFromChange(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    changeId: string,
  ): Promise<void> {
    const { rows } = await client.query<{
      category: PlanningChangeCategory;
      description: string | null;
      signal_id: string | null;
    }>(`SELECT category, description, signal_id FROM hsdg.audit_planning_change WHERE id = $1`, [
      changeId,
    ]);
    const change = rows[0]!;
    if (change.signal_id) return;

    const label = PLANNING_CHANGE_CATEGORY_LABEL[change.category];
    const observation = change.description
      ? `Current-year change — ${label}: ${change.description}`
      : `Current-year change reported: ${label}.`;
    // Fraud and going-concern changes surface to the Partner promptly (§10).
    const attention =
      change.category === PLANNING_CHANGE_CATEGORY.fraud ||
      change.category === PLANNING_CHANGE_CATEGORY.goingConcern
        ? PLANNING_ATTENTION.immediatePartner
        : PLANNING_ATTENTION.standard;

    const signalId = await insertSignal(client, engagementId, workflowInstanceId, {
      source: PLANNING_SIGNAL_SOURCE.currentYearChange,
      sourceRef: changeId,
      observation,
      attention,
    });
    await client.query(`UPDATE hsdg.audit_planning_change SET signal_id = $2 WHERE id = $1`, [
      changeId,
      signalId,
    ]);
  }

  /** Read the Section 01/02 facts the intelligence generator consumes. */
  private async readFacts(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<EngagementIntelligenceFacts> {
    const { rows: profile } = await client.query<{
      initial_audit: boolean;
      joint_audit: boolean;
      accounting_environment: EngagementIntelligenceFacts['accountingEnvironment'];
      sa510_flag: boolean;
      sa402_flag: boolean;
      sa299_flag: boolean;
    }>(
      `SELECT initial_audit, joint_audit, accounting_environment,
              sa510_flag, sa402_flag, sa299_flag
         FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const { rows: areas } = await client.query<{
      area_key: string;
      conclusion: 'applicable' | 'not_applicable';
    }>(
      `SELECT area_key, conclusion FROM hsdg.audit_framework_assessments
        WHERE workflow_instance_id = $1 AND conclusion IS NOT NULL`,
      [workflowInstanceId],
    );
    const p = profile[0];
    return {
      initialAudit: p?.initial_audit ?? false,
      jointAudit: p?.joint_audit ?? false,
      accountingEnvironment: p?.accounting_environment ?? null,
      sa510: p?.sa510_flag ?? false,
      sa402: p?.sa402_flag ?? false,
      sa299: p?.sa299_flag ?? false,
      frameworkConclusions: Object.fromEntries(areas.map((a) => [a.area_key, a.conclusion])),
    };
  }

  /**
   * §20 completion checklist, computed from the structured record. `override`
   * lets an update be checked against the values it is about to save.
   */
  private async computeCompletion(
    client: PoolClient,
    workflowInstanceId: string,
    override: Partial<UpdatePlanningIntelligenceInput> = {},
  ): Promise<{ checks: PlanningCompletionCheck[]; initialAudit: boolean }> {
    const { rows: recRows } = await client.query<IntelligenceRow>(
      `SELECT * FROM hsdg.audit_planning_intelligence WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const rec = recRows[0]!;
    const pick = <K extends keyof UpdatePlanningIntelligenceInput>(
      key: K,
      fallback: UpdatePlanningIntelligenceInput[K],
    ) => (override[key] !== undefined ? override[key] : fallback);
    const orientation = pick('orientation', rec.orientation);
    const scopeRequired = pick('additionalScopeRequired', rec.additional_scope_required);
    const scopeText =
      override.additionalScope !== undefined
        ? clean(override.additionalScope)
        : rec.additional_scope;
    const priorYearReviewed = pick('priorYearReviewed', rec.prior_year_reviewed);
    const summaryText =
      override.strategySummary !== undefined
        ? clean(override.strategySummary)
        : rec.strategy_summary;

    const { rows } = await client.query<{
      initial_audit: boolean | null;
      unassessed: string;
      ipa_unassessed: string;
      changes: string;
      considerations_open: string;
      py_total: string;
      py_open: string;
      acceptance_open: string;
      discussion_ok: boolean;
      matters_unowned: string;
    }>(
      `SELECT
         (SELECT initial_audit FROM hsdg.audit_entity_profile
           WHERE workflow_instance_id = $1) AS initial_audit,
         (SELECT count(*) FROM hsdg.audit_planning_signal
           WHERE workflow_instance_id = $1 AND status <> 'closed'
             AND manager_assessment IS NULL AND owner_employee_id IS NULL) AS unassessed,
         (SELECT count(*) FROM hsdg.audit_planning_signal
           WHERE workflow_instance_id = $1 AND status <> 'closed'
             AND attention = 'immediate_partner' AND manager_assessment IS NULL) AS ipa_unassessed,
         (SELECT count(*) FROM hsdg.audit_planning_change
           WHERE workflow_instance_id = $1) AS changes,
         (SELECT count(*) FROM hsdg.audit_planning_consideration
           WHERE workflow_instance_id = $1 AND assessment IS NULL) AS considerations_open,
         (SELECT count(*) FROM hsdg.audit_prior_year_matter
           WHERE workflow_instance_id = $1) AS py_total,
         (SELECT count(*) FROM hsdg.audit_prior_year_matter
           WHERE workflow_instance_id = $1 AND assessment IS NULL) AS py_open,
         (SELECT count(*) FROM hsdg.audit_matter m
           WHERE m.workflow_instance_id = $1 AND m.section = 'acceptance'
             AND m.status <> 'resolved'
             AND NOT EXISTS (SELECT 1 FROM hsdg.audit_acceptance_carry_forward cf
                              WHERE cf.matter_id = m.id)) AS acceptance_open,
         EXISTS (SELECT 1 FROM hsdg.audit_planning_discussion d
                  WHERE d.workflow_instance_id = $1 AND d.discussion_date IS NOT NULL
                    AND cardinality(d.participant_employee_ids) > 0) AS discussion_ok,
         (SELECT count(*) FROM hsdg.audit_planning_matter
           WHERE workflow_instance_id = $1 AND status IN ('open','in_progress')
             AND owner_employee_id IS NULL) AS matters_unowned`,
      [workflowInstanceId],
    );
    const r = rows[0]!;
    const n = (v: string) => Number(v ?? 0);
    const initialAudit = r.initial_audit ?? false;
    const check = (
      key: string,
      label: string,
      met: boolean,
      detail: string,
    ): PlanningCompletionCheck => ({ key, label, met, detail: met ? null : detail });

    const checks: PlanningCompletionCheck[] = [
      check(
        'intelligence',
        'Engagement Intelligence generated',
        rec.intelligence_generated_at !== null,
        'Generate Engagement Intelligence from Sections 01/02.',
      ),
      check(
        'pi01',
        'Significant changes assessed (PI-01)',
        n(r.changes) > 0,
        'Record each change, or confirm "No significant change".',
      ),
      check(
        'signals',
        'Every active signal assessed or owned',
        n(r.unassessed) === 0,
        `${n(r.unassessed)} open signal(s) need an assessment or an owner.`,
      ),
      check(
        'partner_attention',
        'Immediate Partner Attention signals surfaced',
        n(r.ipa_unassessed) === 0,
        `${n(r.ipa_unassessed)} Immediate Partner Attention signal(s) not yet assessed.`,
      ),
      check(
        'as01',
        'Overall audit orientation recorded (AS-01)',
        !!orientation,
        'Record the preliminary overall audit orientation.',
      ),
      check(
        'as02',
        'Additional scope considerations answered (AS-02)',
        scopeRequired === false || (scopeRequired === true && !!scopeText),
        scopeRequired === true
          ? 'Describe the additional scope consideration.'
          : 'Answer AS-02 (No / Yes).',
      ),
      check(
        'timing_resource',
        'Timing and resource considerations assessed',
        n(r.considerations_open) === 0,
        `${n(r.considerations_open)} consideration(s) still to assess.`,
      ),
      check(
        'prior_year',
        'Prior-year matters reassessed',
        n(r.py_open) === 0 && (initialAudit || n(r.py_total) > 0 || !!priorYearReviewed),
        n(r.py_open) > 0
          ? `${n(r.py_open)} prior-year matter(s) still to reassess.`
          : 'Add the prior-year matters, or confirm there are none to carry.',
      ),
      check(
        'acceptance',
        'Acceptance matters carried forward or concluded',
        n(r.acceptance_open) === 0,
        `${n(r.acceptance_open)} Section 01 matter(s) still to convert, link or conclude.`,
      ),
      check(
        'discussion',
        'Team planning discussion recorded',
        r.discussion_ok,
        'Record the discussion date and participants.',
      ),
      check(
        'summary',
        'Strategy Summary generated',
        !!summaryText,
        'Draft the Strategy Summary from structured data and save it.',
      ),
      check(
        'matters',
        'Open Planning Matters have owners',
        n(r.matters_unowned) === 0,
        `${n(r.matters_unowned)} open Planning Matter(s) have no owner.`,
      ),
    ];
    return { checks, initialAudit };
  }

  private async assertCompletable(
    client: PoolClient,
    workflowInstanceId: string,
    input: UpdatePlanningIntelligenceInput,
  ): Promise<void> {
    const { checks } = await this.computeCompletion(client, workflowInstanceId, input);
    const problems = checks.filter((c) => !c.met).map((c) => c.detail ?? c.label);
    if (problems.length) {
      throw new ConflictException(`03.1 cannot be completed yet: ${problems.join(' ')}`);
    }
  }

  private async readStrategyExtras(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<StrategySummaryExtras> {
    return {
      considerations: await this.strategy.readConsiderations(client, workflowInstanceId),
      priorYear: await this.strategy.readPriorYear(client, workflowInstanceId),
      acceptance: await this.strategy.readAcceptance(client, workflowInstanceId),
    };
  }

  /** Mirror 03.1 status onto the existing Phase 03 `audit_strategy` checklist row. */
  private async rollUpStrategyItem(
    client: PoolClient,
    ctx: RlsContext,
    workflowInstanceId: string,
    status: PlanningIntelligenceStatus,
  ): Promise<void> {
    const state =
      status === PLANNING_INTELLIGENCE_STATUS.complete
        ? 'complete'
        : status === PLANNING_INTELLIGENCE_STATUS.notStarted
          ? 'not_started'
          : 'in_progress';
    await client.query(
      `UPDATE hsdg.audit_planning_items
          SET state = $3,
              updated_by_employee_id = $4,
              content_updated_at = now(),
              version = version + 1
        WHERE workflow_instance_id = $1 AND item_key = $2 AND state <> $3`,
      [workflowInstanceId, STRATEGY_ITEM_KEY, state, ctx.employeeId ?? null],
    );
  }

  private async replaceFocusSignals(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    focusId: string,
    signalIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(signalIds)];
    await assertSignalsInShell(client, workflowInstanceId, unique);
    await client.query(
      `DELETE FROM hsdg.audit_focus_signal
        WHERE focus_id = $1 AND NOT (signal_id = ANY($2::uuid[]))`,
      [focusId, unique],
    );
    for (const signalId of unique) {
      await client.query(
        `INSERT INTO hsdg.audit_focus_signal (focus_id, signal_id, engagement_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [focusId, signalId, engagementId],
      );
    }
  }

  private async ensureRecord(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningIntelligenceRecord> {
    await client.query(
      `INSERT INTO hsdg.audit_planning_intelligence (workflow_instance_id, engagement_id)
       VALUES ($1, $2) ON CONFLICT (workflow_instance_id) DO NOTHING`,
      [workflowInstanceId, engagementId],
    );
    const { rows } = await client.query<IntelligenceRow>(
      `SELECT * FROM hsdg.audit_planning_intelligence WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return mapIntelligence(rows[0]!);
  }

  private async buildSummary(
    client: PoolClient,
    workflowInstanceId: string,
    record: PlanningIntelligenceRecord,
  ): Promise<PlanningIntelligenceSummary> {
    const { rows } = await client.query<{
      total: string;
      open: string;
      further: string;
      partner_signals: string;
      focus: string;
      partner_focus: string;
      open_matters: string;
    }>(
      `SELECT
         (SELECT count(*) FROM hsdg.audit_planning_signal
           WHERE workflow_instance_id = $1) AS total,
         (SELECT count(*) FROM hsdg.audit_planning_signal
           WHERE workflow_instance_id = $1 AND status = 'open') AS open,
         (SELECT count(*) FROM hsdg.audit_planning_signal
           WHERE workflow_instance_id = $1 AND status = 'awaiting_information') AS further,
         (SELECT count(*) FROM hsdg.audit_planning_signal
           WHERE workflow_instance_id = $1 AND attention = 'immediate_partner'
             AND status <> 'closed') AS partner_signals,
         (SELECT count(*) FROM hsdg.audit_area_of_focus
           WHERE workflow_instance_id = $1 AND status <> 'superseded') AS focus,
         (SELECT count(*) FROM hsdg.audit_area_of_focus
           WHERE workflow_instance_id = $1 AND partner_attention
             AND status <> 'superseded') AS partner_focus,
         (SELECT count(*) FROM hsdg.audit_planning_matter
           WHERE workflow_instance_id = $1
             AND status IN ('open','in_progress')) AS open_matters`,
      [workflowInstanceId],
    );
    const r = rows[0]!;
    const { checks, initialAudit } = await this.computeCompletion(client, workflowInstanceId);
    return {
      record,
      openPlanningMatters: Number(r.open_matters),
      initialAudit,
      completion: checks,
      totalSignals: Number(r.total),
      openSignals: Number(r.open),
      furtherInformationRequired: Number(r.further),
      managerFocusAreas: Number(r.focus),
      partnerAttention: Number(r.partner_signals) + Number(r.partner_focus),
    };
  }

  private async readSignals(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<PlanningSignalRecord[]> {
    const { rows } = await client.query<SignalRow>(
      `${SIGNAL_SELECT} WHERE s.workflow_instance_id = $1 ORDER BY s.seq ASC`,
      [workflowInstanceId],
    );
    return rows.map(mapSignal);
  }

  private async readSignalById(client: PoolClient, id: string): Promise<PlanningSignalRecord> {
    const { rows } = await client.query<SignalRow>(`${SIGNAL_SELECT} WHERE s.id = $1`, [id]);
    return mapSignal(rows[0]!);
  }

  private async readFocusAreas(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<AreaOfFocusRecord[]> {
    const { rows } = await client.query<FocusRow>(
      `${FOCUS_SELECT} WHERE f.workflow_instance_id = $1 ORDER BY f.seq ASC`,
      [workflowInstanceId],
    );
    return rows.map(mapFocus);
  }

  private async readFocusById(client: PoolClient, id: string): Promise<AreaOfFocusRecord> {
    const { rows } = await client.query<FocusRow>(`${FOCUS_SELECT} WHERE f.id = $1`, [id]);
    return mapFocus(rows[0]!);
  }

  private async readChangeById(client: PoolClient, id: string): Promise<PlanningChangeRecord> {
    const { rows } = await client.query<ChangeRow>(`${CHANGE_SELECT} WHERE c.id = $1`, [id]);
    return mapChange(rows[0]!);
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────────

function assertDestinations(v: readonly string[] | undefined): void {
  if (v && v.some((d) => !PLANNING_DESTINATIONS.includes(d as PlanningDestination))) {
    throw new BadRequestException('Unknown carry-forward destination.');
  }
}

/** Structured 03.1 records beyond signals/focus that feed the §17 summary. */
export interface StrategySummaryExtras {
  considerations: readonly PlanningConsiderationRecord[];
  priorYear: readonly PriorYearMatterRecord[];
  acceptance: readonly AcceptanceCarryForwardRecord[];
}

const NO_EXTRAS: StrategySummaryExtras = { considerations: [], priorYear: [], acceptance: [] };

/** Rule keys whose signals describe components / other auditors (02.6). */
const COMPONENT_RULE_KEYS = new Set(['cfs_required', 'joint_audit']);

/**
 * Compose the §17 Strategy Summary draft from structured data only. Exported for
 * unit tests. It never introduces a risk rating — it reports attention levels,
 * and every line traces to a signal (PS-), focus area (FA-) or record code.
 */
export function composeStrategySummary(
  record: PlanningIntelligenceRecord,
  signals: readonly PlanningSignalRecord[],
  focus: readonly AreaOfFocusRecord[],
  extras: StrategySummaryExtras = NO_EXTRAS,
): string {
  const active = signals.filter((s) => s.status !== PLANNING_SIGNAL_STATUS.closed);
  const lines: string[] = [];
  const section = (title: string, items: string[], empty?: string) => {
    if (!items.length && !empty) return;
    if (lines.length) lines.push('');
    lines.push(title);
    lines.push(...(items.length ? items : [`- ${empty}`]));
  };

  const characteristics = active.filter(
    (s) =>
      s.source === PLANNING_SIGNAL_SOURCE.section01 ||
      s.source === PLANNING_SIGNAL_SOURCE.section02,
  );
  section(
    'Engagement characteristics',
    characteristics.map((s) => `- ${s.signalCode} ${s.observation}`),
    'No Section 01/02 signals generated yet.',
  );

  const established = focus.filter((f) => f.status !== 'superseded');
  section(
    'Factors directing engagement-team effort',
    established.map(
      (f) =>
        `- ${f.focusCode} ${f.name}${f.whyRequiresAttention ? ` — ${f.whyRequiresAttention}` : ''}`,
    ),
    'No Areas of Focus established yet.',
  );

  const direction = [
    record.orientation
      ? `- ${AUDIT_ORIENTATION_LABEL[record.orientation]} (preliminary; final control reliance and responses are determined after risk/control assessment).`
      : '- Not yet recorded (AS-01).',
  ];
  if (record.orientationNote) direction.push(`- ${record.orientationNote}`);
  section('Overall audit direction', direction);

  if (record.additionalScopeRequired === true && record.additionalScope) {
    section('Scope considerations', [`- ${record.additionalScope}`]);
  } else if (record.additionalScopeRequired === false) {
    section('Scope considerations', [
      '- No additional scope considerations beyond Section 02 (AS-02).',
    ]);
  } else if (record.additionalScope) {
    section('Scope considerations', [`- ${record.additionalScope}`]);
  }

  const kept = (kind: 'timing' | 'resource') =>
    extras.considerations
      .filter(
        (c) =>
          c.kind === kind &&
          c.assessment !== null &&
          c.assessment !== 'not_relevant' &&
          c.assessment !== 'not_required',
      )
      .map(
        (c) =>
          `- ${c.label} (${PLANNING_CONSIDERATION_ASSESSMENT_LABEL[c.assessment!]})${c.signalCode ? ` [${c.signalCode}]` : ''}`,
      );
  const timing = kept('timing');
  if (timing.length) timing.push('- Detailed scheduling is performed in 03.11.');
  section('Timing considerations', timing);
  const resources = kept('resource');
  if (resources.length) resources.push('- Staffing and specialist scope are determined in 03.8.');
  section('Resource considerations', resources);

  section(
    'Component / other auditor considerations',
    active
      .filter((s) => s.ruleKey !== null && COMPONENT_RULE_KEYS.has(s.ruleKey))
      .map((s) => `- ${s.signalCode} ${s.observation}`),
  );

  const carried = [
    ...extras.priorYear
      .filter((p) => p.assessment !== null && p.assessment !== 'resolved')
      .map(
        (p) =>
          `- ${p.matterCode} ${PRIOR_YEAR_MATTER_TYPE_LABEL[p.matterType]}: ${p.description} (${PRIOR_YEAR_ASSESSMENT_LABEL[p.assessment!]})${p.signalCode ? ` [${p.signalCode}]` : ''}`,
      ),
    ...extras.acceptance
      .filter((a) => a.action !== null && a.action !== 'no_implication')
      .map(
        (a) =>
          `- ${a.matterCode} ${a.title} (${ACCEPTANCE_CARRY_FORWARD_ACTION_LABEL[a.action!]})${a.signalCode ? ` [${a.signalCode}]` : ''}`,
      ),
  ];
  section('Prior-year / acceptance matters', carried);

  const partner = active.filter((s) => s.attention === PLANNING_ATTENTION.immediatePartner);
  const partnerFocus = established.filter((f) => f.partnerAttention);
  section(
    'Matters requiring Partner attention',
    [
      ...partner.map((s) => `- ${s.signalCode} ${s.observation}`),
      ...partnerFocus.map((f) => `- ${f.focusCode} ${f.name}`),
    ],
    'None identified.',
  );

  const enhanced = active.filter((s) => s.attention === PLANNING_ATTENTION.enhanced);
  section(
    'Signals carrying Enhanced Attention',
    enhanced.map((s) => `- ${s.signalCode} ${s.observation}`),
  );
  return lines.join('\n');
}

function mapSignal(s: SignalRow): PlanningSignalRecord {
  return {
    id: s.id,
    workflowInstanceId: s.workflow_instance_id,
    engagementId: s.engagement_id,
    signalCode: `PS-${String(s.seq).padStart(3, '0')}`,
    source: s.source,
    ruleKey: s.rule_key,
    sourceRef: s.source_ref,
    sourceLink: s.source_link,
    observation: s.observation,
    whyMayMatter: s.why_may_matter,
    potentialImplications: s.potential_implications,
    suggestedAttention: s.suggested_attention,
    attention: s.attention,
    attentionRationale: s.attention_rationale,
    managerAssessment: s.manager_assessment,
    assessmentRationale: s.assessment_rationale,
    ownerName: s.owner_name,
    destinations: s.destinations ?? [],
    status: s.status,
    isAuto: s.is_auto,
    documentId: s.document_id,
    version: s.version,
    createdAt: s.created_at.toISOString(),
    updatedAt: s.updated_at.toISOString(),
  };
}

function mapFocus(f: FocusRow): AreaOfFocusRecord {
  return {
    id: f.id,
    workflowInstanceId: f.workflow_instance_id,
    engagementId: f.engagement_id,
    focusCode: `FA-${String(f.seq).padStart(3, '0')}`,
    name: f.name,
    whyRequiresAttention: f.why_requires_attention,
    potentialFsAreas: f.potential_fs_areas ?? [],
    expectedStrategicImplication: f.expected_strategic_implication,
    partnerAttention: f.partner_attention,
    destinations: f.destinations ?? [],
    status: f.status,
    signalIds: f.signal_ids ?? [],
    version: f.version,
    createdAt: f.created_at.toISOString(),
    updatedAt: f.updated_at.toISOString(),
  };
}

function mapChange(c: ChangeRow): PlanningChangeRecord {
  return {
    id: c.id,
    workflowInstanceId: c.workflow_instance_id,
    engagementId: c.engagement_id,
    category: c.category,
    description: c.description,
    effectiveDate: c.effective_date,
    sourceEvidence: c.source_evidence,
    frImpactKnown: c.fr_impact_known,
    signalId: c.signal_id,
    documentId: c.document_id,
    version: c.version,
    createdAt: c.created_at.toISOString(),
    updatedAt: c.updated_at.toISOString(),
  };
}

function mapIntelligence(r: IntelligenceRow): PlanningIntelligenceRecord {
  return {
    id: r.id,
    workflowInstanceId: r.workflow_instance_id,
    engagementId: r.engagement_id,
    status: r.status,
    orientation: r.orientation,
    orientationNote: r.orientation_note,
    additionalScopeRequired: r.additional_scope_required,
    additionalScope: r.additional_scope,
    priorYearReviewed: r.prior_year_reviewed,
    strategySummary: r.strategy_summary,
    intelligenceGeneratedAt: r.intelligence_generated_at
      ? r.intelligence_generated_at.toISOString()
      : null,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

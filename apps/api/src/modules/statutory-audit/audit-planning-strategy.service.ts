import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ACCEPTANCE_CARRY_FORWARD_ACTION,
  PLANNING_ATTENTION,
  PLANNING_CONSIDERATION_ASSESSMENT,
  PLANNING_CONSIDERATION_ASSESSMENTS_BY_KIND,
  PLANNING_MATTER_ORIGIN,
  PLANNING_MATTER_STATUS,
  PLANNING_SIGNAL_SOURCE,
  PRIOR_YEAR_ASSESSMENT,
  PRIOR_YEAR_MATTER_TYPE,
  PRIOR_YEAR_MATTER_TYPE_LABEL,
  PRIOR_YEAR_SIGNAL_ASSESSMENTS,
  type AcceptanceCarryForwardAction,
  type AcceptanceCarryForwardRecord,
  type AssessPlanningConsiderationInput,
  type AssessPriorYearMatterInput,
  type ConcludeAcceptanceMatterInput,
  type CreatePlanningConsiderationInput,
  type CreatePlanningMatterInput,
  type CreatePriorYearMatterInput,
  type PlanningAffectedModule,
  type PlanningAttention,
  type PlanningChangeCategory,
  type PlanningConsiderationAssessment,
  type PlanningConsiderationKind,
  type PlanningConsiderationRecord,
  type PlanningDiscussionRecord,
  type PlanningMatterCategory,
  type PlanningMatterOrigin,
  type PlanningMatterRecord,
  type PlanningMatterStatus,
  type PlanningSignalStatus,
  type PriorYearAssessment,
  type PriorYearMatterRecord,
  type PriorYearMatterType,
  type UpdatePlanningDiscussionInput,
  type UpdatePlanningMatterInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { deriveStrategicConsiderations } from './planning-considerations-generation';
import {
  assertShell,
  assertSignalsInShell,
  clean,
  displayCode,
  insertSignal,
  maxSeq,
} from './planning-shared';

interface ConsiderationRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  kind: PlanningConsiderationKind;
  consideration_key: string | null;
  label: string;
  basis: string | null;
  signal_id: string | null;
  signal_seq: number | null;
  signal_attention: PlanningAttention | null;
  is_auto: boolean;
  assessment: PlanningConsiderationAssessment | null;
  rationale: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface PriorYearRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  seq: number;
  matter_type: PriorYearMatterType;
  description: string;
  source_evidence: string | null;
  document_id: string | null;
  assessment: PriorYearAssessment | null;
  assessment_note: string | null;
  signal_id: string | null;
  signal_seq: number | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface AcceptanceRow {
  matter_id: string;
  matter_seq: number;
  title: string;
  category: string;
  severity: string | null;
  matter_status: string;
  matter_resolution: string | null;
  action: AcceptanceCarryForwardAction | null;
  signal_id: string | null;
  signal_seq: number | null;
  reason: string | null;
  version: number | null;
}

interface DiscussionRow {
  id: string;
  discussion_date: string | null;
  participant_employee_ids: string[];
  participant_names: string[] | null;
  signal_ids: string[];
  focus_ids: string[];
  additional_matters: string | null;
  skepticism_areas: string | null;
  observations: string | null;
  version: number;
  updated_at: Date;
}

interface MatterRow {
  id: string;
  workflow_instance_id: string;
  engagement_id: string;
  seq: number;
  origin: PlanningMatterOrigin;
  signal_id: string | null;
  focus_id: string | null;
  title: string;
  category: PlanningMatterCategory;
  owner_employee_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  partner_attention: boolean;
  affected_module: PlanningAffectedModule | null;
  status: PlanningMatterStatus;
  resolution: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const CONSIDERATION_SELECT = `
  SELECT c.id, c.workflow_instance_id, c.engagement_id, c.kind, c.consideration_key,
         c.label, c.basis, c.signal_id, s.seq AS signal_seq, s.attention AS signal_attention,
         c.is_auto, c.assessment, c.rationale, c.version, c.created_at, c.updated_at
    FROM hsdg.audit_planning_consideration c
    LEFT JOIN hsdg.audit_planning_signal s ON s.id = c.signal_id`;

const PRIOR_YEAR_SELECT = `
  SELECT p.id, p.workflow_instance_id, p.engagement_id, p.seq, p.matter_type, p.description,
         p.source_evidence, p.document_id, p.assessment, p.assessment_note, p.signal_id,
         s.seq AS signal_seq, p.version, p.created_at, p.updated_at
    FROM hsdg.audit_prior_year_matter p
    LEFT JOIN hsdg.audit_planning_signal s ON s.id = p.signal_id`;

/** Unresolved/conditional acceptance matters, plus any already carried forward. */
const ACCEPTANCE_SELECT = `
  SELECT m.id AS matter_id, m.seq AS matter_seq, m.title, m.category, m.severity,
         m.status AS matter_status, m.resolution AS matter_resolution,
         cf.action, cf.signal_id, s.seq AS signal_seq, cf.reason, cf.version
    FROM hsdg.audit_matter m
    LEFT JOIN hsdg.audit_acceptance_carry_forward cf ON cf.matter_id = m.id
    LEFT JOIN hsdg.audit_planning_signal s ON s.id = cf.signal_id
   WHERE m.workflow_instance_id = $1 AND m.section = 'acceptance'
     AND (m.status <> 'resolved' OR cf.id IS NOT NULL)`;

const MATTER_SELECT = `
  SELECT m.id, m.workflow_instance_id, m.engagement_id, m.seq, m.origin, m.signal_id,
         m.focus_id, m.title, m.category, m.owner_employee_id, owner.full_name AS owner_name,
         m.due_date::text, m.partner_attention, m.affected_module, m.status, m.resolution,
         m.version, m.created_at, m.updated_at
    FROM hsdg.audit_planning_matter m
    LEFT JOIN hsdg.employees owner ON owner.id = m.owner_employee_id`;

/** Attention for a signal converted from a Section 01 acceptance matter. */
function acceptanceAttention(severity: string | null, isBlocking: boolean): PlanningAttention {
  if (severity === 'critical' || isBlocking) return PLANNING_ATTENTION.immediatePartner;
  if (severity === 'high') return PLANNING_ATTENTION.enhanced;
  return PLANNING_ATTENTION.standard;
}

/** Attention for a signal created from a reassessed prior-year matter. */
function priorYearAttention(type: PriorYearMatterType): PlanningAttention {
  return type === PRIOR_YEAR_MATTER_TYPE.modifiedOpinion ||
    type === PRIOR_YEAR_MATTER_TYPE.significantRisk
    ? PLANNING_ATTENTION.enhanced
    : PLANNING_ATTENTION.standard;
}

/**
 * 03.1 remaining sub-sections (DHVAJ 03.1 §13.2–13.3, §14–§16, §18):
 * strategic timing/resource considerations, prior-year intelligence, acceptance
 * matters carried forward, the team planning discussion and the Planning
 * Matter/Action register. All write into — or link to — the ONE shared Planning
 * Signal Register; nothing here becomes an RMM conclusion.
 */
@Injectable()
export class AuditPlanningStrategyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── §13.2–13.3 Strategic considerations ────────────────────────────────────

  /**
   * Re-derive strategic considerations from the register. Idempotent by key:
   * new ones are inserted, existing ones have their factual text refreshed only
   * when it changed; the Manager's assessment is never overwritten and a
   * consideration whose prompt disappeared is never silently deleted.
   */
  async syncConsiderations(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows: signals } = await client.query<{
      id: string;
      rule_key: string | null;
      change_category: PlanningChangeCategory | null;
      attention: PlanningAttention;
      status: PlanningSignalStatus;
    }>(
      `SELECT s.id, s.rule_key, ch.category AS change_category, s.attention, s.status
         FROM hsdg.audit_planning_signal s
         LEFT JOIN hsdg.audit_planning_change ch ON ch.signal_id = s.id
        WHERE s.workflow_instance_id = $1
        ORDER BY s.seq ASC`,
      [workflowInstanceId],
    );
    const derived = deriveStrategicConsiderations(
      signals.map((s) => ({
        id: s.id,
        ruleKey: s.rule_key,
        changeCategory: s.change_category,
        attention: s.attention,
        status: s.status,
      })),
    );
    for (const d of derived) {
      await client.query(
        `INSERT INTO hsdg.audit_planning_consideration
           (workflow_instance_id, engagement_id, kind, consideration_key, label, basis,
            signal_id, is_auto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         ON CONFLICT (workflow_instance_id, consideration_key)
           WHERE consideration_key IS NOT NULL
         DO UPDATE SET label = EXCLUDED.label,
                       basis = EXCLUDED.basis,
                       signal_id = EXCLUDED.signal_id,
                       version = hsdg.audit_planning_consideration.version + 1
         WHERE (hsdg.audit_planning_consideration.label,
                hsdg.audit_planning_consideration.basis,
                hsdg.audit_planning_consideration.signal_id)
               IS DISTINCT FROM (EXCLUDED.label, EXCLUDED.basis, EXCLUDED.signal_id)`,
        [workflowInstanceId, engagementId, d.kind, d.key, d.label, d.basis, d.signalId],
      );
    }
  }

  async listConsiderations(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningConsiderationRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      return this.readConsiderations(client, workflowInstanceId);
    });
  }

  /** Add a Manager consideration the generator did not propose. */
  async createConsideration(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreatePlanningConsiderationInput,
  ): Promise<PlanningConsiderationRecord> {
    const label = input.label?.trim();
    if (!label) throw new BadRequestException('A consideration needs a label.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      if (input.signalId) await assertSignalsInShell(client, workflowInstanceId, [input.signalId]);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_planning_consideration
           (workflow_instance_id, engagement_id, kind, label, basis, signal_id, is_auto)
         VALUES ($1, $2, $3, $4, $5, $6, false)
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          input.kind,
          label,
          clean(input.basis),
          input.signalId ?? null,
        ],
      );
      const id = rows[0]!.id;
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_consideration_created',
        objectType: 'audit_planning_consideration',
        objectId: id,
        after: { kind: input.kind, label },
      });
      return this.readConsiderationById(client, id);
    });
  }

  /**
   * Assess a consideration (§13.2 Relevant / Not Relevant / Further Assessment;
   * §13.3 Likely Required / Consider in 03.8 / Not Required). "Not Required"
   * needs a rationale when the prompting signal is Enhanced/Immediate Partner.
   */
  async assessConsideration(
    ctx: RlsContext,
    engagementId: string,
    considerationId: string,
    input: AssessPlanningConsiderationInput,
  ): Promise<PlanningConsiderationRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ConsiderationRow>(
        `${CONSIDERATION_SELECT} WHERE c.id = $1 AND c.engagement_id = $2`,
        [considerationId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Consideration not found.');
      if (!PLANNING_CONSIDERATION_ASSESSMENTS_BY_KIND[current.kind].includes(input.assessment)) {
        throw new BadRequestException(
          `That assessment does not apply to a ${current.kind} consideration.`,
        );
      }
      const rationale = clean(input.rationale);
      if (
        input.assessment === PLANNING_CONSIDERATION_ASSESSMENT.notRequired &&
        current.signal_attention !== null &&
        current.signal_attention !== PLANNING_ATTENTION.standard &&
        !rationale
      ) {
        throw new BadRequestException(
          'Marking a resource Not Required needs a rationale when its signal carries Enhanced or Immediate Partner Attention.',
        );
      }
      const result = await client.query(
        `UPDATE hsdg.audit_planning_consideration
            SET assessment = $3, rationale = $4, version = version + 1
          WHERE id = $1 AND version = $2`,
        [considerationId, input.version, input.assessment, rationale],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This consideration changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_consideration_assessed',
        objectType: 'audit_planning_consideration',
        objectId: considerationId,
        before: { assessment: current.assessment },
        after: { assessment: input.assessment },
      });
      return this.readConsiderationById(client, considerationId);
    });
  }

  // ── 03.1.6 Prior-year intelligence ─────────────────────────────────────────

  async listPriorYear(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PriorYearMatterRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      return this.readPriorYear(client, workflowInstanceId);
    });
  }

  /** v1: controlled manual addition with source evidence (no PY portal data yet). */
  async createPriorYear(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreatePriorYearMatterInput,
  ): Promise<PriorYearMatterRecord> {
    const description = input.description?.trim();
    if (!description) throw new BadRequestException('Describe the prior-year matter.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const seq = (await maxSeq(client, 'audit_prior_year_matter', workflowInstanceId)) + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_prior_year_matter
           (workflow_instance_id, engagement_id, seq, matter_type, description,
            source_evidence, document_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          seq,
          input.matterType,
          description,
          clean(input.sourceEvidence),
          input.documentId ?? null,
        ],
      );
      const id = rows[0]!.id;
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.prior_year_matter_created',
        objectType: 'audit_prior_year_matter',
        objectId: id,
        after: { matterType: input.matterType },
      });
      return this.readPriorYearById(client, id);
    });
  }

  /**
   * Reassess a prior-year matter for the current year (§14). Resolved needs a
   * note and cannot carry a signal; the other outcomes may create or link one.
   */
  async assessPriorYear(
    ctx: RlsContext,
    engagementId: string,
    matterId: string,
    input: AssessPriorYearMatterInput,
  ): Promise<PriorYearMatterRecord> {
    const note = clean(input.assessmentNote);
    const resolved = input.assessment === PRIOR_YEAR_ASSESSMENT.resolved;
    if (resolved && !note) {
      throw new BadRequestException('Explain how the prior-year matter was resolved.');
    }
    const wantsSignal = !!input.createSignal || !!input.linkSignalId;
    if (wantsSignal && !PRIOR_YEAR_SIGNAL_ASSESSMENTS.includes(input.assessment)) {
      throw new BadRequestException(
        'A resolved prior-year matter does not carry a current-year signal.',
      );
    }
    if (input.createSignal && input.linkSignalId) {
      throw new BadRequestException(
        'Either create a new signal or link an existing one, not both.',
      );
    }

    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<PriorYearRow>(
        `${PRIOR_YEAR_SELECT} WHERE p.id = $1 AND p.engagement_id = $2`,
        [matterId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Prior-year matter not found.');
      const wi = current.workflow_instance_id;

      let signalId: string | null = current.signal_id;
      if (input.linkSignalId) {
        await assertSignalsInShell(client, wi, [input.linkSignalId]);
        signalId = input.linkSignalId;
      } else if (input.createSignal && !current.signal_id) {
        signalId = await insertSignal(client, engagementId, wi, {
          source: PLANNING_SIGNAL_SOURCE.priorYear,
          sourceRef: current.id,
          sourceLink: '03.1/prior-year',
          observation: `Prior-year matter — ${PRIOR_YEAR_MATTER_TYPE_LABEL[current.matter_type]}: ${current.description}`,
          whyMayMatter: note,
          attention: priorYearAttention(current.matter_type),
          documentId: current.document_id,
        });
      }

      const result = await client.query(
        `UPDATE hsdg.audit_prior_year_matter
            SET assessment = $3, assessment_note = $4, signal_id = $5, version = version + 1
          WHERE id = $1 AND version = $2`,
        [matterId, input.version, input.assessment, note, signalId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This prior-year matter changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.prior_year_matter_assessed',
        objectType: 'audit_prior_year_matter',
        objectId: matterId,
        before: { assessment: current.assessment },
        after: { assessment: input.assessment, signalId },
      });
      return this.readPriorYearById(client, matterId);
    });
  }

  // ── 03.1.7 Acceptance matters carried forward ──────────────────────────────

  async listAcceptance(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<AcceptanceCarryForwardRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { rows } = await client.query<AcceptanceRow>(
        `${ACCEPTANCE_SELECT} ORDER BY m.seq ASC`,
        [workflowInstanceId],
      );
      return rows.map(mapAcceptance);
    });
  }

  /**
   * Conclude a Section 01 acceptance matter in 03.1: convert it to a signal,
   * link it to an existing signal, or record "no further planning implication"
   * with a mandatory reason. Keeps acceptance issues from vanishing (§15).
   */
  async concludeAcceptance(
    ctx: RlsContext,
    engagementId: string,
    matterId: string,
    input: ConcludeAcceptanceMatterInput,
  ): Promise<AcceptanceCarryForwardRecord> {
    const reason = clean(input.reason);
    if (input.action === ACCEPTANCE_CARRY_FORWARD_ACTION.noImplication && !reason) {
      throw new BadRequestException('Give the reason there is no further planning implication.');
    }
    if (input.action === ACCEPTANCE_CARRY_FORWARD_ACTION.linkSignal && !input.signalId) {
      throw new BadRequestException('Choose the signal that already addresses this matter.');
    }

    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        workflow_instance_id: string;
        title: string;
        severity: string | null;
        is_blocking: boolean;
        cf_signal_id: string | null;
        cf_action: AcceptanceCarryForwardAction | null;
      }>(
        `SELECT m.workflow_instance_id, m.title, m.severity, m.is_blocking,
                cf.signal_id AS cf_signal_id, cf.action AS cf_action
           FROM hsdg.audit_matter m
           LEFT JOIN hsdg.audit_acceptance_carry_forward cf ON cf.matter_id = m.id
          WHERE m.id = $1 AND m.engagement_id = $2 AND m.section = 'acceptance'`,
        [matterId, engagementId],
      );
      const matter = rows[0];
      if (!matter) throw new NotFoundException('Acceptance matter not found.');
      const wi = matter.workflow_instance_id;

      let signalId: string | null = null;
      if (input.action === ACCEPTANCE_CARRY_FORWARD_ACTION.linkSignal) {
        await assertSignalsInShell(client, wi, [input.signalId!]);
        signalId = input.signalId!;
      } else if (input.action === ACCEPTANCE_CARRY_FORWARD_ACTION.createSignal) {
        // Re-concluding as "create" reuses the signal it already generated.
        signalId =
          matter.cf_action === ACCEPTANCE_CARRY_FORWARD_ACTION.createSignal && matter.cf_signal_id
            ? matter.cf_signal_id
            : await insertSignal(client, engagementId, wi, {
                source: PLANNING_SIGNAL_SOURCE.section01,
                sourceRef: matterId,
                sourceLink: 'section-01/acceptance',
                observation: `Acceptance matter carried forward: ${matter.title}`,
                whyMayMatter:
                  'An unresolved or conditional acceptance/continuance matter may affect planning.',
                attention: acceptanceAttention(matter.severity, matter.is_blocking),
              });
      }

      const result =
        input.version === 0
          ? await client.query(
              `INSERT INTO hsdg.audit_acceptance_carry_forward
                 (workflow_instance_id, engagement_id, matter_id, action, signal_id, reason)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (matter_id) DO NOTHING`,
              [wi, engagementId, matterId, input.action, signalId, reason],
            )
          : await client.query(
              `UPDATE hsdg.audit_acceptance_carry_forward
                  SET action = $3, signal_id = $4, reason = $5, version = version + 1
                WHERE matter_id = $1 AND version = $2`,
              [matterId, input.version, input.action, signalId, reason],
            );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This acceptance matter changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.acceptance_matter_carried_forward',
        objectType: 'audit_matter',
        objectId: matterId,
        before: { action: matter.cf_action },
        after: { action: input.action, signalId },
      });
      const { rows: out } = await client.query<AcceptanceRow>(
        `${ACCEPTANCE_SELECT} AND m.id = $2`,
        [wi, matterId],
      );
      return mapAcceptance(out[0]!);
    });
  }

  // ── 03.1.8 Team planning discussion ────────────────────────────────────────

  async getDiscussion(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningDiscussionRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      return this.readDiscussion(client, workflowInstanceId);
    });
  }

  async saveDiscussion(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: UpdatePlanningDiscussionInput,
  ): Promise<PlanningDiscussionRecord> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const participants = [...new Set(input.participantEmployeeIds ?? [])];
      if (participants.length) {
        const { rows } = await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM hsdg.employees emp
            WHERE emp.id = ANY($2::uuid[])
              AND (EXISTS (SELECT 1 FROM hsdg.engagement_team t
                            WHERE t.engagement_id = $1 AND t.employee_id = emp.id)
                   OR EXISTS (SELECT 1 FROM hsdg.engagements e
                               WHERE e.id = $1 AND emp.id IN
                                 (e.engagement_partner_id, e.engagement_manager_id)))`,
          [engagementId, participants],
        );
        if (Number(rows[0]?.n ?? 0) !== participants.length) {
          throw new BadRequestException('Participants must be on the engagement team.');
        }
      }
      if (input.signalIds) await assertSignalsInShell(client, workflowInstanceId, input.signalIds);
      if (input.focusIds?.length) {
        const unique = [...new Set(input.focusIds)];
        const { rows } = await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM hsdg.audit_area_of_focus
            WHERE workflow_instance_id = $1 AND id = ANY($2::uuid[])`,
          [workflowInstanceId, unique],
        );
        if (Number(rows[0]?.n ?? 0) !== unique.length) {
          throw new BadRequestException(
            'Every linked Area of Focus must belong to this audit file.',
          );
        }
      }

      // The discussion is one structured record, saved whole (§16).
      const values = [
        input.discussionDate ?? null,
        participants,
        [...new Set(input.signalIds ?? [])],
        [...new Set(input.focusIds ?? [])],
        clean(input.additionalMatters),
        clean(input.skepticismAreas),
        clean(input.observations),
      ];
      const result =
        input.version === 0
          ? await client.query(
              `INSERT INTO hsdg.audit_planning_discussion
                 (workflow_instance_id, discussion_date, participant_employee_ids, signal_ids,
                  focus_ids, additional_matters, skepticism_areas, observations, engagement_id)
               VALUES ($1, $2::date, $3::uuid[], $4::uuid[], $5::uuid[], $6, $7, $8, $9)
               ON CONFLICT (workflow_instance_id) DO NOTHING`,
              [workflowInstanceId, ...values, engagementId],
            )
          : await client.query(
              `UPDATE hsdg.audit_planning_discussion
                  SET discussion_date = $2::date,
                      participant_employee_ids = $3::uuid[],
                      signal_ids = $4::uuid[],
                      focus_ids = $5::uuid[],
                      additional_matters = $6,
                      skepticism_areas = $7,
                      observations = $8,
                      version = version + 1
                WHERE workflow_instance_id = $1 AND version = $9`,
              [workflowInstanceId, ...values, input.version],
            );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'The planning discussion changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_discussion_saved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { participants: participants.length, date: input.discussionDate ?? null },
      });
      return this.readDiscussion(client, workflowInstanceId);
    });
  }

  // ── §18 Planning Matter / Action register ──────────────────────────────────

  async listMatters(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningMatterRecord[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { rows } = await client.query<MatterRow>(
        `${MATTER_SELECT} WHERE m.workflow_instance_id = $1 ORDER BY m.seq ASC`,
        [workflowInstanceId],
      );
      return rows.map(mapMatter);
    });
  }

  async createMatter(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreatePlanningMatterInput,
  ): Promise<PlanningMatterRecord> {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('A Planning Matter needs a title.');
    if (input.origin === PLANNING_MATTER_ORIGIN.signal && !input.signalId) {
      throw new BadRequestException('Choose the signal this matter comes from.');
    }
    if (input.origin === PLANNING_MATTER_ORIGIN.focusArea && !input.focusId) {
      throw new BadRequestException('Choose the Area of Focus this matter comes from.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const signalId = input.origin === PLANNING_MATTER_ORIGIN.signal ? input.signalId! : null;
      const focusId = input.origin === PLANNING_MATTER_ORIGIN.focusArea ? input.focusId! : null;
      if (signalId) await assertSignalsInShell(client, workflowInstanceId, [signalId]);
      if (focusId) {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.audit_area_of_focus WHERE id = $1 AND workflow_instance_id = $2`,
          [focusId, workflowInstanceId],
        );
        if (!rows[0])
          throw new BadRequestException('That Area of Focus is not on this audit file.');
      }
      const seq = (await maxSeq(client, 'audit_planning_matter', workflowInstanceId)) + 1;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_planning_matter
           (workflow_instance_id, engagement_id, seq, origin, signal_id, focus_id, title,
            category, owner_employee_id, due_date, partner_attention, affected_module)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12)
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          seq,
          input.origin,
          signalId,
          focusId,
          title,
          input.category,
          input.ownerEmployeeId ?? null,
          input.dueDate ?? null,
          input.partnerAttention ?? false,
          input.affectedModule ?? null,
        ],
      );
      const id = rows[0]!.id;
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_matter_created',
        objectType: 'audit_planning_matter',
        objectId: id,
        after: { origin: input.origin, category: input.category },
      });
      return this.readMatterById(client, id);
    });
  }

  async updateMatter(
    ctx: RlsContext,
    engagementId: string,
    matterId: string,
    input: UpdatePlanningMatterInput,
  ): Promise<PlanningMatterRecord> {
    if (input.title !== undefined && !input.title.trim()) {
      throw new BadRequestException('A Planning Matter needs a title.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<MatterRow>(
        `${MATTER_SELECT} WHERE m.id = $1 AND m.engagement_id = $2`,
        [matterId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Planning Matter not found.');
      const nextStatus = input.status ?? current.status;
      const nextResolution =
        input.resolution !== undefined ? clean(input.resolution) : current.resolution;
      if (nextStatus === PLANNING_MATTER_STATUS.resolved && !nextResolution) {
        throw new BadRequestException('Record the resolution before closing a Planning Matter.');
      }
      const result = await client.query(
        `UPDATE hsdg.audit_planning_matter
            SET title = COALESCE($3, title),
                category = COALESCE($4, category),
                owner_employee_id = CASE WHEN $5::boolean THEN $6 ELSE owner_employee_id END,
                due_date = CASE WHEN $7::boolean THEN $8::date ELSE due_date END,
                partner_attention = COALESCE($9, partner_attention),
                affected_module = CASE WHEN $10::boolean THEN $11 ELSE affected_module END,
                status = $12,
                resolution = $13,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          matterId,
          input.version,
          input.title?.trim() ?? null,
          input.category ?? null,
          input.ownerEmployeeId !== undefined,
          input.ownerEmployeeId ?? null,
          input.dueDate !== undefined,
          input.dueDate ?? null,
          input.partnerAttention ?? null,
          input.affectedModule !== undefined,
          input.affectedModule ?? null,
          nextStatus,
          nextResolution,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This Planning Matter changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_matter_updated',
        objectType: 'audit_planning_matter',
        objectId: matterId,
        before: { status: current.status },
        after: { status: nextStatus },
      });
      return this.readMatterById(client, matterId);
    });
  }

  // ── reads shared with the 03.1 summary / completion checks ─────────────────

  async readConsiderations(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<PlanningConsiderationRecord[]> {
    const { rows } = await client.query<ConsiderationRow>(
      `${CONSIDERATION_SELECT} WHERE c.workflow_instance_id = $1
        ORDER BY c.kind DESC, c.is_auto DESC, c.created_at ASC`,
      [workflowInstanceId],
    );
    return rows.map(mapConsideration);
  }

  async readPriorYear(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<PriorYearMatterRecord[]> {
    const { rows } = await client.query<PriorYearRow>(
      `${PRIOR_YEAR_SELECT} WHERE p.workflow_instance_id = $1 ORDER BY p.seq ASC`,
      [workflowInstanceId],
    );
    return rows.map(mapPriorYear);
  }

  async readAcceptance(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<AcceptanceCarryForwardRecord[]> {
    const { rows } = await client.query<AcceptanceRow>(`${ACCEPTANCE_SELECT} ORDER BY m.seq ASC`, [
      workflowInstanceId,
    ]);
    return rows.map(mapAcceptance);
  }

  async readDiscussion(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<PlanningDiscussionRecord> {
    const { rows } = await client.query<DiscussionRow>(
      `SELECT d.id, d.discussion_date::text, d.participant_employee_ids,
              (SELECT array_agg(emp.full_name ORDER BY emp.full_name)
                 FROM hsdg.employees emp
                WHERE emp.id = ANY(d.participant_employee_ids)) AS participant_names,
              d.signal_ids, d.focus_ids, d.additional_matters, d.skepticism_areas,
              d.observations, d.version, d.updated_at
         FROM hsdg.audit_planning_discussion d
        WHERE d.workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const d = rows[0];
    if (!d) {
      return {
        id: null,
        discussionDate: null,
        participantEmployeeIds: [],
        participantNames: [],
        signalIds: [],
        focusIds: [],
        additionalMatters: null,
        skepticismAreas: null,
        observations: null,
        version: 0,
        updatedAt: null,
      };
    }
    return {
      id: d.id,
      discussionDate: d.discussion_date,
      participantEmployeeIds: d.participant_employee_ids ?? [],
      participantNames: d.participant_names ?? [],
      signalIds: d.signal_ids ?? [],
      focusIds: d.focus_ids ?? [],
      additionalMatters: d.additional_matters,
      skepticismAreas: d.skepticism_areas,
      observations: d.observations,
      version: d.version,
      updatedAt: d.updated_at.toISOString(),
    };
  }

  private async readConsiderationById(
    client: PoolClient,
    id: string,
  ): Promise<PlanningConsiderationRecord> {
    const { rows } = await client.query<ConsiderationRow>(
      `${CONSIDERATION_SELECT} WHERE c.id = $1`,
      [id],
    );
    return mapConsideration(rows[0]!);
  }

  private async readPriorYearById(client: PoolClient, id: string): Promise<PriorYearMatterRecord> {
    const { rows } = await client.query<PriorYearRow>(`${PRIOR_YEAR_SELECT} WHERE p.id = $1`, [id]);
    return mapPriorYear(rows[0]!);
  }

  private async readMatterById(client: PoolClient, id: string): Promise<PlanningMatterRecord> {
    const { rows } = await client.query<MatterRow>(`${MATTER_SELECT} WHERE m.id = $1`, [id]);
    return mapMatter(rows[0]!);
  }
}

// ── mappers ──────────────────────────────────────────────────────────────────

function mapConsideration(c: ConsiderationRow): PlanningConsiderationRecord {
  return {
    id: c.id,
    workflowInstanceId: c.workflow_instance_id,
    engagementId: c.engagement_id,
    kind: c.kind,
    considerationKey: c.consideration_key,
    label: c.label,
    basis: c.basis,
    signalId: c.signal_id,
    signalCode: displayCode('PS', c.signal_seq),
    signalAttention: c.signal_attention,
    isAuto: c.is_auto,
    assessment: c.assessment,
    rationale: c.rationale,
    version: c.version,
    createdAt: c.created_at.toISOString(),
    updatedAt: c.updated_at.toISOString(),
  };
}

function mapPriorYear(p: PriorYearRow): PriorYearMatterRecord {
  return {
    id: p.id,
    workflowInstanceId: p.workflow_instance_id,
    engagementId: p.engagement_id,
    matterCode: displayCode('PY', p.seq)!,
    matterType: p.matter_type,
    description: p.description,
    sourceEvidence: p.source_evidence,
    documentId: p.document_id,
    assessment: p.assessment,
    assessmentNote: p.assessment_note,
    signalId: p.signal_id,
    signalCode: displayCode('PS', p.signal_seq),
    version: p.version,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
  };
}

function mapAcceptance(a: AcceptanceRow): AcceptanceCarryForwardRecord {
  return {
    matterId: a.matter_id,
    matterCode: displayCode('M', a.matter_seq)!,
    title: a.title,
    category: a.category,
    severity: a.severity,
    matterStatus: a.matter_status,
    matterResolution: a.matter_resolution,
    action: a.action,
    signalId: a.signal_id,
    signalCode: displayCode('PS', a.signal_seq),
    reason: a.reason,
    version: a.version ?? 0,
  };
}

function mapMatter(m: MatterRow): PlanningMatterRecord {
  return {
    id: m.id,
    workflowInstanceId: m.workflow_instance_id,
    engagementId: m.engagement_id,
    matterCode: displayCode('PM', m.seq)!,
    origin: m.origin,
    signalId: m.signal_id,
    focusId: m.focus_id,
    title: m.title,
    category: m.category,
    ownerEmployeeId: m.owner_employee_id,
    ownerName: m.owner_name,
    dueDate: m.due_date,
    partnerAttention: m.partner_attention,
    affectedModule: m.affected_module,
    status: m.status,
    resolution: m.resolution,
    version: m.version,
    createdAt: m.created_at.toISOString(),
    updatedAt: m.updated_at.toISOString(),
  };
}

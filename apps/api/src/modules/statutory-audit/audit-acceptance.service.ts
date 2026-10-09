import { planAcceptance } from './section-packs';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ACCEPTANCE_SEGMENTS,
  ACCEPTANCE_SEGMENT_KEY,
  SEGMENT_RESOLVED_STATES,
  evaluateSegment,
  type AcceptanceAnswer,
  type AcceptanceAnswerRecord,
  type AcceptanceConclusion,
  type AcceptanceContext,
  type AcceptanceSegment,
  type AcceptanceSegmentKey,
  type AnswersByKey,
  type RecordAcceptanceAnswerInput,
  type SegmentEvaluation,
  type SegmentState,
  type StatutoryAuditAcceptance,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditMattersService } from './audit-matters.service';
import { deriveAcceptanceMatters } from './acceptance-matters';
import { readAcceptanceContext } from './acceptance-context';
import { validateAcceptanceAnswer } from './acceptance-validation';
import { engagementProfileFacts, readEngagementMasterFacts } from './master-facts';

const FINAL = ACCEPTANCE_SEGMENT_KEY.finalAcceptance;

interface SegmentRow {
  id: string;
  workflow_instance_id: string;
  segment_key: AcceptanceSegmentKey;
  title: string;
  state: SegmentState;
  read_only: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  sort_order: number;
  version: number;
}
interface AnswerRow {
  id: string;
  segment_id: string;
  question_key: string;
  answer: AcceptanceAnswer | null;
  details: Record<string, unknown>;
  narrative: string | null;
  document_id: string | null;
  answered_by_name: string | null;
  version: number;
  updated_at: Date;
}

/**
 * Section 01 — Engagement & Acceptance service (Implementation Guide §8).
 *
 * The 8-segment acceptance workflow: prefilled from the masters, Yes/No/NA
 * answers whose adverse responses raise Acceptance Matters through the shared
 * Matters engine (§10), and an Engagement Partner approval (FINAL-02) that
 * freezes the answers, marks Section 01 complete and UNLOCKS Section 02.
 */
@Injectable()
export class AuditAcceptanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly matters: AuditMattersService,
  ) {}

  // ── Seed (called by provisioning; idempotent, self-healing) ─────────────────

  /** Seed the 8 acceptance segments for a shell. Safe to repeat (ON CONFLICT). */
  async seedSegmentsOn(
    client: PoolClient,
    workflowInstanceId: string,
    engagementId: string,
  ): Promise<void> {
    for (const s of ACCEPTANCE_SEGMENTS) {
      await client.query(
        `INSERT INTO hsdg.audit_acceptance_segments
           (workflow_instance_id, engagement_id, segment_key, title, state, read_only, sort_order)
         VALUES ($1, $2, $3, $4, 'not_started', $5, $6)
         ON CONFLICT (workflow_instance_id, segment_key) DO NOTHING`,
        [workflowInstanceId, engagementId, s.segmentKey, s.title, s.readOnly ?? false, s.sortOrder],
      );
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditAcceptance[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      // Self-heal: seed segments for any shell provisioned before this phase.
      const { rows: shells } = await client.query<{ id: string }>(
        `SELECT swi.id
           FROM hsdg.service_workflow_instances swi
          WHERE swi.engagement_id = $1 AND swi.status <> 'cancelled'
            AND NOT EXISTS (
              SELECT 1 FROM hsdg.audit_acceptance_segments s
               WHERE s.workflow_instance_id = swi.id)`,
        [engagementId],
      );
      for (const s of shells) await this.seedSegmentsOn(client, s.id, engagementId);
      return this.readAcceptance(client, engagementId);
    });
  }

  private async readAcceptance(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditAcceptance[]> {
    const { rows: shells } = await client.query<{
      id: string;
      engagement_service_id: string;
      engagement_id: string;
      financial_year: string | null;
    }>(
      `SELECT swi.id, swi.engagement_service_id, swi.engagement_id, e.financial_year
         FROM hsdg.service_workflow_instances swi
         JOIN hsdg.engagements e ON e.id = swi.engagement_id
        WHERE swi.engagement_id = $1 AND swi.status <> 'cancelled'
        ORDER BY swi.created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];
    const shellIds = shells.map((s) => s.id);

    const { rows: segments } = await client.query<SegmentRow>(
      `SELECT s.id, s.workflow_instance_id, s.segment_key, s.title, s.state, s.read_only,
              emp.full_name AS decided_by_name, s.decided_at, s.sort_order, s.version
         FROM hsdg.audit_acceptance_segments s
         LEFT JOIN hsdg.employees emp ON emp.id = s.decided_by_employee_id
        WHERE s.workflow_instance_id = ANY($1::uuid[])
        ORDER BY s.sort_order ASC`,
      [shellIds],
    );
    const segmentIds = segments.map((s) => s.id);
    const { rows: answers } = segmentIds.length
      ? await client.query<AnswerRow>(
          `SELECT a.id, a.segment_id, a.question_key, a.answer, a.details, a.narrative,
                  a.document_id, emp.full_name AS answered_by_name, a.version, a.updated_at
             FROM hsdg.audit_acceptance_answers a
             LEFT JOIN hsdg.employees emp ON emp.id = a.answered_by_employee_id
            WHERE a.segment_id = ANY($1::uuid[])`,
          [segmentIds],
        )
      : { rows: [] as AnswerRow[] };

    const { rows: approvals } = await client.query<{
      id: string;
      workflow_instance_id: string;
      version: number;
      conclusion: AcceptanceConclusion;
      memo: string | null;
      reason: string | null;
      safeguards: string | null;
      approved_by_name: string | null;
      approved_at: Date;
    }>(
      // The live approving decision only — returned / declined / reopened ones
      // are history (see the sign-off read).
      `SELECT ap.id, ap.workflow_instance_id, ap.version, ap.conclusion, ap.memo,
              ap.reason, ap.safeguards,
              emp.full_name AS approved_by_name, ap.approved_at
         FROM hsdg.audit_acceptance_approvals ap
         LEFT JOIN hsdg.employees emp ON emp.id = ap.approved_by_employee_id
        WHERE ap.workflow_instance_id = ANY($1::uuid[])
          AND ap.conclusion IN ('accept','continue','accept_with_conditions')
          AND ap.reopened_at IS NULL
        ORDER BY ap.version DESC`,
      [shellIds],
    );

    const { rows: phases } = await client.query<{ workflow_instance_id: string; state: string }>(
      `SELECT workflow_instance_id, state
         FROM hsdg.audit_workflow_phases
        WHERE workflow_instance_id = ANY($1::uuid[]) AND phase_key = 'acceptance'`,
      [shellIds],
    );

    const out: StatutoryAuditAcceptance[] = [];
    for (const shell of shells) {
      const shellSegments = segments.filter((s) => s.workflow_instance_id === shell.id);
      const openBlocking = await this.matters.countOpenBlockingMatters(
        client,
        shell.id,
        'acceptance',
      );
      const context = await readAcceptanceContext(client, shell.engagement_id, shell.id);
      const evaluations = await this.evaluateAndStore(
        client,
        shell.id,
        shellSegments,
        answers,
        context,
      );
      const unresolved = shellSegments.filter(
        (s) => s.segment_key !== FINAL && !SEGMENT_RESOLVED_STATES.includes(s.state),
      ).length;
      const approval = approvals.find((a) => a.workflow_instance_id === shell.id) ?? null;
      const master = await readEngagementMasterFacts(client, shell.id);
      const openMatters = await this.matters.listOpenMatters(client, shell.id, 'acceptance');
      const engagementProfile = master
        ? engagementProfileFacts(master, {
            initialAudit: context.firstYear === null ? null : !context.firstYear,
            previousAuditor: detailString(answers, shellSegments, 'pa_details', 'firmName'),
            appointmentDate: answerOf(answers, shellSegments, 'app_02'),
          })
        : [];
      const mappedSegments = shellSegments.map((s) =>
        mapSegment(s, answers, evaluations.get(s.id)),
      );
      out.push({
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        phaseState: phases.find((p) => p.workflow_instance_id === shell.id)?.state ?? 'in_progress',
        engagementProfile,
        segments: mappedSegments,
        approval: approval
          ? {
              id: approval.id,
              version: approval.version,
              conclusion: approval.conclusion,
              memo: approval.memo,
              reason: approval.reason,
              safeguards: approval.safeguards,
              approvedByName: approval.approved_by_name,
              approvedAt: approval.approved_at.toISOString(),
            }
          : null,
        unresolvedSegmentCount: unresolved,
        openBlockingMatterCount: openBlocking,
        readyForApproval: unresolved === 0 && openBlocking === 0 && approval === null,
        pack: planAcceptance({
          financialYear: shell.financial_year,
          segments: mappedSegments,
          openMatters,
          missingMasterFacts: engagementProfile.filter((f) => f.value == null).map((f) => f.label),
          fileStatuses: context.fileStatuses,
        }),
        context,
      });
    }
    return out;
  }

  // ── Record an answer (spec §4–§9) ───────────────────────────────────────────

  async recordAnswer(
    ctx: RlsContext,
    engagementId: string,
    segmentId: string,
    input: RecordAcceptanceAnswerInput,
  ): Promise<StatutoryAuditAcceptance> {
    return this.db.withRlsContext(ctx, async (client) => {
      const seg = await this.loadSegment(client, engagementId, segmentId);
      await this.assertNotApproved(client, seg.workflow_instance_id);
      if (seg.segment_key === FINAL) {
        throw new BadRequestException('Final acceptance is recorded through the approval steps.');
      }
      const context = await readAcceptanceContext(client, engagementId, seg.workflow_instance_id);
      const clean = validateAcceptanceAnswer(seg.segment_key, input, context);

      // A linked evidence document must belong to this engagement.
      if (input.documentId) {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2`,
          [input.documentId, engagementId],
        );
        if (!rows[0]) {
          throw new BadRequestException('The linked document does not belong to this engagement.');
        }
      }

      if (clean.answer === null && Object.keys(clean.details).length === 0) {
        await client.query(
          `DELETE FROM hsdg.audit_acceptance_answers WHERE segment_id = $1 AND question_key = $2`,
          [segmentId, input.questionKey],
        );
      } else {
        await client.query(
          `INSERT INTO hsdg.audit_acceptance_answers
             (segment_id, engagement_id, question_key, answer, details, narrative, document_id,
              answered_by_employee_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
           ON CONFLICT (segment_id, question_key) DO UPDATE
             SET answer = EXCLUDED.answer,
                 details = EXCLUDED.details,
                 narrative = EXCLUDED.narrative,
                 document_id = COALESCE(EXCLUDED.document_id, hsdg.audit_acceptance_answers.document_id),
                 answered_by_employee_id = EXCLUDED.answered_by_employee_id,
                 version = hsdg.audit_acceptance_answers.version + 1`,
          [
            segmentId,
            engagementId,
            input.questionKey,
            clean.answer,
            JSON.stringify(clean.details),
            input.narrative?.trim() || null,
            input.documentId ?? null,
            ctx.employeeId ?? null,
          ],
        );
      }

      await this.reconcileMatters(client, ctx, engagementId, seg.workflow_instance_id);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.acceptance_answer_recorded',
        objectType: 'audit_acceptance_segment',
        objectId: segmentId,
        after: { questionKey: input.questionKey, answer: clean.answer, details: clean.details },
      });
      const [acc] = await this.readForShell(client, engagementId, seg.workflow_instance_id);
      return acc!;
    });
  }

  // ── Segment state ───────────────────────────────────────────────────────────

  /**
   * Segment status follows the answers (spec §3), so there is nothing to set by
   * hand: this re-evaluates the segment and returns the file. Kept for older
   * clients that still post "mark complete".
   */
  async setSegmentState(
    ctx: RlsContext,
    engagementId: string,
    segmentId: string,
    input: { state: SegmentState; version: number },
  ): Promise<StatutoryAuditAcceptance> {
    return this.db.withRlsContext(ctx, async (client) => {
      const seg = await this.loadSegment(client, engagementId, segmentId);
      await this.assertNotApproved(client, seg.workflow_instance_id);
      const [acc] = await this.readForShell(client, engagementId, seg.workflow_instance_id);
      const now = acc!.segments.find((s) => s.id === segmentId);
      if (now && now.state !== input.state && seg.segment_key !== FINAL) {
        throw new BadRequestException(
          now.pending[0] ??
            now.attention[0] ??
            "A segment's status follows its answers — answer its questions to move it on.",
        );
      }
      return acc!;
    });
  }

  /**
   * Re-evaluate 01.1–01.7 against their answers and store the derived status,
   * so the approval gate and other sections read the same status the screen
   * shows. 01.8 is left to the sign-off. Safe for any reader: RLS lets only
   * leads update, so a member's read changes nothing.
   */
  async refreshSegmentStates(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    await this.readForShell(client, engagementId, workflowInstanceId);
  }

  private async evaluateAndStore(
    client: PoolClient,
    workflowInstanceId: string,
    segments: SegmentRow[],
    answers: AnswerRow[],
    context: AcceptanceContext,
  ): Promise<Map<string, SegmentEvaluation>> {
    const { rows: blocking } = await client.query<{ source: string }>(
      `SELECT source FROM hsdg.audit_matter
        WHERE workflow_instance_id = $1 AND section = 'acceptance' AND is_blocking = true
          AND status IN ('open','under_review','blocking')`,
      [workflowInstanceId],
    );
    const evalCtx = {
      firstYear: context.firstYear,
      otherServiceIds: context.otherServices.map((o) => o.engagementServiceId),
      declarationsPending: context.independence.pending,
      fileStatuses: context.fileStatuses,
      openBlockingSources: blocking.map((b) => b.source),
    };
    const out = new Map<string, SegmentEvaluation>();
    for (const s of segments) {
      if (s.segment_key === FINAL) continue;
      const byKey: Record<string, { answer: string | null; details: Record<string, unknown> }> = {};
      for (const a of answers) {
        if (a.segment_id === s.id)
          byKey[a.question_key] = { answer: a.answer, details: a.details ?? {} };
      }
      const ev = evaluateSegment(s.segment_key, byKey as AnswersByKey, evalCtx);
      out.set(s.id, ev);
      if (ev.state !== s.state) {
        const res = await client.query(
          `UPDATE hsdg.audit_acceptance_segments
              SET state = $2,
                  decided_at = CASE WHEN $2 IN ('complete','not_applicable') THEN now() ELSE NULL END,
                  decided_by_employee_id = CASE WHEN $2 IN ('complete','not_applicable')
                                                THEN hsdg.ctx_employee_id() ELSE NULL END,
                  version = version + 1
            WHERE id = $1 AND state IS DISTINCT FROM $2
              AND NOT EXISTS (
                SELECT 1 FROM hsdg.audit_acceptance_approvals ap
                 WHERE ap.workflow_instance_id = hsdg.audit_acceptance_segments.workflow_instance_id
                   AND ap.conclusion IN ('accept','continue','accept_with_conditions')
                   AND ap.reopened_at IS NULL)`,
          [s.id, ev.state],
        );
        if ((res.rowCount ?? 0) > 0) s.state = ev.state;
      }
    }
    return out;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** The Section 01 read for one shell, inside the caller's transaction. */
  async readForShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditAcceptance[]> {
    const all = await this.readAcceptance(client, engagementId);
    return all.filter((a) => a.workflowInstanceId === workflowInstanceId);
  }

  /** Re-derive the answer-raised Acceptance Matters (used before a partner decision). */
  async reconcileMatters(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query<{
      segment_key: string;
      question_key: string;
      answer: string | null;
      details: Record<string, unknown>;
    }>(
      `SELECT s.segment_key, a.question_key, a.answer, a.details
         FROM hsdg.audit_acceptance_answers a
         JOIN hsdg.audit_acceptance_segments s ON s.id = a.segment_id
        WHERE s.workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const derived = deriveAcceptanceMatters(
      rows.map((r) => ({
        segmentKey: r.segment_key,
        questionKey: r.question_key,
        answer: r.answer,
        details: r.details ?? {},
      })),
    );
    await this.matters.reconcileOn(
      client,
      ctx,
      engagementId,
      workflowInstanceId,
      'acceptance',
      derived,
    );
  }

  private async loadSegment(
    client: PoolClient,
    engagementId: string,
    segmentId: string,
  ): Promise<{ workflow_instance_id: string; segment_key: AcceptanceSegmentKey }> {
    const { rows } = await client.query<{
      workflow_instance_id: string;
      segment_key: AcceptanceSegmentKey;
    }>(
      `SELECT workflow_instance_id, segment_key
         FROM hsdg.audit_acceptance_segments
        WHERE id = $1 AND engagement_id = $2`,
      [segmentId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Acceptance segment not found.');
    return rows[0];
  }

  private async assertNotApproved(client: PoolClient, workflowInstanceId: string): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_acceptance_approvals
        WHERE workflow_instance_id = $1
          AND conclusion IN ('accept','continue','accept_with_conditions')
          AND reopened_at IS NULL
        LIMIT 1`,
      [workflowInstanceId],
    );
    if (rows[0]) {
      throw new ConflictException(
        'Section 01 is approved; the Engagement Partner must reopen it before it changes.',
      );
    }
  }
}

/** The recorded answer to a question in this shell, or null. */
function answerOf(
  answers: AnswerRow[],
  segments: SegmentRow[],
  questionKey: string,
): string | null {
  const ids = new Set(segments.map((s) => s.id));
  return (
    answers.find((a) => ids.has(a.segment_id) && a.question_key === questionKey)?.answer ?? null
  );
}

/** A text detail recorded with a question in this shell, or null. */
function detailString(
  answers: AnswerRow[],
  segments: SegmentRow[],
  questionKey: string,
  field: string,
): string | null {
  const ids = new Set(segments.map((s) => s.id));
  const v = answers.find((a) => ids.has(a.segment_id) && a.question_key === questionKey)?.details?.[
    field
  ];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function mapSegment(
  s: SegmentRow,
  answers: AnswerRow[],
  ev: SegmentEvaluation | undefined,
): AcceptanceSegment {
  return {
    id: s.id,
    segmentKey: s.segment_key,
    title: s.title,
    state: s.state,
    sortOrder: s.sort_order,
    readOnly: s.read_only,
    decidedByName: s.decided_by_name,
    decidedAt: s.decided_at ? s.decided_at.toISOString() : null,
    version: s.version,
    answers: answers
      .filter((a) => a.segment_id === s.id)
      .map((a): AcceptanceAnswerRecord => ({
        id: a.id,
        segmentId: a.segment_id,
        questionKey: a.question_key,
        answer: a.answer,
        details: a.details ?? {},
        narrative: a.narrative,
        documentId: a.document_id,
        answeredByName: a.answered_by_name,
        version: a.version,
        updatedAt: a.updated_at.toISOString(),
      })),
    required: ev?.required ?? 0,
    answered: ev?.answered ?? 0,
    pending: ev?.pending ?? [],
    attention: ev?.attention ?? [],
    attentionItems: ev?.items ?? [],
    notApplicableReason: ev?.notApplicableReason ?? null,
  };
}

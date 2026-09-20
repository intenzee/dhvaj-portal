import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ACCEPTANCE_QUESTIONS,
  ACCEPTANCE_SEGMENTS,
  ACCEPTANCE_SEGMENT_KEY,
  SEGMENT_RESOLVED_STATES,
  SEGMENT_STATE,
  type AcceptanceAnswer,
  type AcceptanceAnswerRecord,
  type AcceptanceConclusion,
  type AcceptanceSegment,
  type AcceptanceSegmentKey,
  type RecordAcceptanceAnswerInput,
  type SegmentState,
  type StatutoryAuditAcceptance,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditMattersService } from './audit-matters.service';
import { deriveAcceptanceMatters } from './acceptance-matters';

/** Question keys per segment, from the methodology catalogue (guide §8.3). */
const QUESTIONS_BY_SEGMENT = new Map<string, string[]>();
for (const q of ACCEPTANCE_QUESTIONS) {
  const list = QUESTIONS_BY_SEGMENT.get(q.segmentKey) ?? [];
  list.push(q.questionKey);
  QUESTIONS_BY_SEGMENT.set(q.segmentKey, list);
}
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
  narrative: string | null;
  document_id: string | null;
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
          WHERE swi.engagement_id = $1
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
    }>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1
        ORDER BY created_at ASC`,
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
          `SELECT id, segment_id, question_key, answer, narrative, document_id, version, updated_at
             FROM hsdg.audit_acceptance_answers
            WHERE segment_id = ANY($1::uuid[])`,
          [segmentIds],
        )
      : { rows: [] as AnswerRow[] };

    const { rows: approvals } = await client.query<{
      id: string;
      workflow_instance_id: string;
      version: number;
      conclusion: AcceptanceConclusion;
      memo: string | null;
      approved_by_name: string | null;
      approved_at: Date;
    }>(
      `SELECT ap.id, ap.workflow_instance_id, ap.version, ap.conclusion, ap.memo,
              emp.full_name AS approved_by_name, ap.approved_at
         FROM hsdg.audit_acceptance_approvals ap
         LEFT JOIN hsdg.employees emp ON emp.id = ap.approved_by_employee_id
        WHERE ap.workflow_instance_id = ANY($1::uuid[])
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
      const unresolved = shellSegments.filter(
        (s) => s.segment_key !== FINAL && !SEGMENT_RESOLVED_STATES.includes(s.state),
      ).length;
      const approval = approvals.find((a) => a.workflow_instance_id === shell.id) ?? null;
      out.push({
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        phaseState: phases.find((p) => p.workflow_instance_id === shell.id)?.state ?? 'in_progress',
        segments: shellSegments.map((s) => mapSegment(s, answers)),
        approval: approval
          ? {
              id: approval.id,
              version: approval.version,
              conclusion: approval.conclusion,
              memo: approval.memo,
              approvedByName: approval.approved_by_name,
              approvedAt: approval.approved_at.toISOString(),
            }
          : null,
        unresolvedSegmentCount: unresolved,
        openBlockingMatterCount: openBlocking,
        readyForApproval: unresolved === 0 && openBlocking === 0 && approval === null,
      });
    }
    return out;
  }

  // ── Record an answer (§8.3) ─────────────────────────────────────────────────

  async recordAnswer(
    ctx: RlsContext,
    engagementId: string,
    segmentId: string,
    input: RecordAcceptanceAnswerInput,
  ): Promise<StatutoryAuditAcceptance> {
    return this.db.withRlsContext(ctx, async (client) => {
      const seg = await this.loadSegment(client, engagementId, segmentId);
      await this.assertNotApproved(client, seg.workflow_instance_id);

      const validKeys = QUESTIONS_BY_SEGMENT.get(seg.segment_key) ?? [];
      if (!validKeys.includes(input.questionKey)) {
        throw new BadRequestException('Unknown question for this segment.');
      }
      // A linked evidence document must belong to this engagement (§16).
      if (input.documentId) {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2`,
          [input.documentId, engagementId],
        );
        if (!rows[0]) {
          throw new BadRequestException('The linked document does not belong to this engagement.');
        }
      }

      await client.query(
        `INSERT INTO hsdg.audit_acceptance_answers
           (segment_id, engagement_id, question_key, answer, narrative, document_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (segment_id, question_key) DO UPDATE
           SET answer = EXCLUDED.answer,
               narrative = EXCLUDED.narrative,
               document_id = EXCLUDED.document_id,
               version = hsdg.audit_acceptance_answers.version + 1`,
        [
          segmentId,
          engagementId,
          input.questionKey,
          input.answer,
          input.narrative?.trim() || null,
          input.documentId ?? null,
        ],
      );

      // Advance segment state: in_progress, or complete when all questions answered.
      const answered = await this.answeredKeys(client, segmentId);
      const allAnswered = validKeys.every((k) => answered.has(k));
      const nextState: SegmentState = allAnswered
        ? SEGMENT_STATE.complete
        : SEGMENT_STATE.inProgress;
      await client.query(
        `UPDATE hsdg.audit_acceptance_segments
            SET state = $2,
                decided_by_employee_id = CASE WHEN $2 = 'complete' THEN $3 ELSE decided_by_employee_id END,
                decided_at = CASE WHEN $2 = 'complete' THEN now() ELSE decided_at END,
                version = version + 1
          WHERE id = $1 AND state <> 'complete'`,
        [segmentId, nextState, ctx.employeeId ?? null],
      );

      await this.reconcileMatters(client, ctx, engagementId, seg.workflow_instance_id);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.acceptance_answer_recorded',
        objectType: 'audit_acceptance_segment',
        objectId: segmentId,
        after: { questionKey: input.questionKey, answer: input.answer },
      });
      const [acc] = await this.readForShell(client, engagementId, seg.workflow_instance_id);
      return acc!;
    });
  }

  // ── Segment state (mark NA / reopen) ────────────────────────────────────────

  async setSegmentState(
    ctx: RlsContext,
    engagementId: string,
    segmentId: string,
    input: { state: SegmentState; version: number },
  ): Promise<StatutoryAuditAcceptance> {
    return this.db.withRlsContext(ctx, async (client) => {
      const seg = await this.loadSegment(client, engagementId, segmentId);
      await this.assertNotApproved(client, seg.workflow_instance_id);

      if (input.state === SEGMENT_STATE.complete) {
        const validKeys = QUESTIONS_BY_SEGMENT.get(seg.segment_key) ?? [];
        const answered = await this.answeredKeys(client, segmentId);
        if (!validKeys.every((k) => answered.has(k))) {
          throw new BadRequestException('Answer every question before completing the segment.');
        }
      }
      const result = await client.query(
        `UPDATE hsdg.audit_acceptance_segments
            SET state = $3,
                decided_by_employee_id = $4,
                decided_at = CASE WHEN $3 IN ('complete','not_applicable') THEN now() ELSE decided_at END,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [segmentId, input.version, input.state, ctx.employeeId ?? null],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('This segment changed since you loaded it; refresh and retry.');
      }
      await this.reconcileMatters(client, ctx, engagementId, seg.workflow_instance_id);
      const [acc] = await this.readForShell(client, engagementId, seg.workflow_instance_id);
      return acc!;
    });
  }

  // ── Partner approval (FINAL-02) — unlocks Section 02 (§8.5) ──────────────────

  async approve(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { conclusion: AcceptanceConclusion; memo?: string | null },
  ): Promise<StatutoryAuditAcceptance> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertNotApproved(client, workflowInstanceId);

      const { rows: segments } = await client.query<{
        segment_key: string;
        state: SegmentState;
      }>(
        `SELECT segment_key, state
           FROM hsdg.audit_acceptance_segments
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      if (segments.length === 0) throw new NotFoundException('Acceptance not initialised.');

      const unresolved = segments.filter(
        (s) => s.segment_key !== FINAL && !SEGMENT_RESOLVED_STATES.includes(s.state),
      );
      if (unresolved.length > 0 && input.conclusion !== 'decline') {
        throw new BadRequestException(
          `${unresolved.length} acceptance segment(s) still need completion before approval.`,
        );
      }
      // Reconcile and block on any open blocking acceptance matter (§8.4).
      await this.reconcileMatters(client, ctx, engagementId, workflowInstanceId);
      if (input.conclusion !== 'decline') {
        await this.matters.assertNoOpenBlockingMatters(client, workflowInstanceId, 'acceptance');
      }

      const { rows: verRows } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
           FROM hsdg.audit_acceptance_approvals WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const version = verRows[0]!.next;

      const { rows: answerSnap } = await client.query(
        `SELECT s.segment_key, a.question_key, a.answer
           FROM hsdg.audit_acceptance_answers a
           JOIN hsdg.audit_acceptance_segments s ON s.id = a.segment_id
          WHERE s.workflow_instance_id = $1`,
        [workflowInstanceId],
      );

      try {
        await client.query(
          `INSERT INTO hsdg.audit_acceptance_approvals
             (workflow_instance_id, engagement_id, version, conclusion, memo, snapshot, approved_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [
            workflowInstanceId,
            engagementId,
            version,
            input.conclusion,
            input.memo?.trim() || null,
            JSON.stringify(answerSnap),
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('Acceptance was approved concurrently; refresh and retry.');
        }
        throw err;
      }

      // Mark 01.8 complete and freeze Section 01.
      await client.query(
        `UPDATE hsdg.audit_acceptance_segments
            SET state = 'complete', decided_at = now(), decided_by_employee_id = $2
          WHERE workflow_instance_id = $1 AND segment_key = $3`,
        [workflowInstanceId, ctx.employeeId ?? null, FINAL],
      );

      // §8.5 gate: a decline leaves Section 02 locked; acceptance/accept-with-
      // conditions completes Section 01 and UNLOCKS the Framework.
      if (input.conclusion === 'decline') {
        await client.query(
          `UPDATE hsdg.audit_workflow_phases SET state = 'needs_attention'
            WHERE workflow_instance_id = $1 AND phase_key = 'acceptance'`,
          [workflowInstanceId],
        );
      } else {
        await client.query(
          `UPDATE hsdg.audit_workflow_phases SET state = 'complete'
            WHERE workflow_instance_id = $1 AND phase_key = 'acceptance'`,
          [workflowInstanceId],
        );
        await client.query(
          `UPDATE hsdg.audit_workflow_phases SET state = 'in_progress'
            WHERE workflow_instance_id = $1 AND phase_key = 'framework' AND state = 'locked'`,
          [workflowInstanceId],
        );
      }

      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.acceptance_approved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { version, conclusion: input.conclusion },
      });
      const [acc] = await this.readForShell(client, engagementId, workflowInstanceId);
      return acc!;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async readForShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditAcceptance[]> {
    const all = await this.readAcceptance(client, engagementId);
    return all.filter((a) => a.workflowInstanceId === workflowInstanceId);
  }

  private async reconcileMatters(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query<{
      segment_key: string;
      question_key: string;
      answer: string | null;
    }>(
      `SELECT s.segment_key, a.question_key, a.answer
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

  private async answeredKeys(client: PoolClient, segmentId: string): Promise<Set<string>> {
    const { rows } = await client.query<{ question_key: string }>(
      `SELECT question_key FROM hsdg.audit_acceptance_answers
        WHERE segment_id = $1 AND answer IS NOT NULL`,
      [segmentId],
    );
    return new Set(rows.map((r) => r.question_key));
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
        WHERE workflow_instance_id = $1 AND conclusion <> 'decline' LIMIT 1`,
      [workflowInstanceId],
    );
    if (rows[0]) {
      throw new ConflictException(
        'Section 01 is approved; reopen it (controlled reopen) before editing.',
      );
    }
  }

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }
}

function mapSegment(s: SegmentRow, answers: AnswerRow[]): AcceptanceSegment {
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
        narrative: a.narrative,
        documentId: a.document_id,
        version: a.version,
        updatedAt: a.updated_at.toISOString(),
      })),
  };
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  isReviewOverdue,
  procedureCompletionBlock,
  reviewLevelFor,
  summarizeReview,
  PBC_OUTSTANDING_STATUSES,
  REVIEW_NOTE_STATUS,
  REVIEW_TARGET_TYPE,
  type AuditReviewNote,
  type ReviewDecision,
  type ReviewLevel,
  type ReviewNoteStatus,
  type ReviewQueueItem,
  type ReviewTargetType,
  type StatutoryAuditReview,
  type SuggestedReviewNote,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import {
  areaKey,
  openSuggestions,
  procedureKey,
  resolvedInFile,
  reviewArea,
  reviewProcedure,
  type ItemReview,
} from './review-automation';

interface ShellRow {
  id: string;
  engagement_service_id: string;
  engagement_id: string;
}

interface NoteRow {
  id: string;
  target_type: ReviewTargetType;
  target_id: string;
  target_label: string | null;
  review_level: ReviewLevel;
  body: string;
  status: ReviewNoteStatus;
  is_blocking: boolean;
  raised_by_name: string | null;
  response: string | null;
  responded_by_name: string | null;
  responded_at: Date | null;
  cleared_by_name: string | null;
  cleared_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  workflow_instance_id: string;
  source_key: string | null;
  raised_by_employee_id: string | null;
  target_owner_id: string | null;
  target_reviewer_id: string | null;
}

interface ProcRow {
  workflow_instance_id: string;
  id: string;
  procedure_ref: string;
  title: string;
  state: string;
  objective: string | null;
  conclusion: string | null;
  sampling_method: string | null;
  sample_size: number | null;
  due_date: string | null;
  work_area_id: string;
  owner_employee_id: string | null;
  reviewer_employee_id: string | null;
  owner_name: string | null;
  reviewer_name: string | null;
  area_title: string | null;
  evidence_count: number;
  open_exceptions: number;
  carried_exceptions: number;
  risk_ref: string | null;
  risk_significant: boolean | null;
}

interface AreaRow {
  workflow_instance_id: string;
  id: string;
  title: string;
  conclusion: string | null;
  conclusion_state: string;
  reviewed_at: Date | null;
  due_date: string | null;
  owner_employee_id: string | null;
  reviewer_employee_id: string | null;
  owner_name: string | null;
  reviewer_name: string | null;
}

/** Everything Review reads from the file, for one engagement. */
interface FileReview {
  procedures: ProcRow[];
  areas: AreaRow[];
  /** Pre-review result per procedure / area id. */
  reviews: Map<string, ItemReview>;
  /** Source keys whose check passes right now. */
  passing: Set<string>;
  dismissed: Map<string, Set<string>>;
}

export interface ReviewNoteInput {
  targetType: ReviewTargetType;
  targetId: string;
  body: string;
  isBlocking?: boolean;
  /** When omitted, the level is derived from the target's reviewer vs the EP. */
  reviewLevel?: ReviewLevel;
}

/**
 * Statutory Audit — Review service (Audit Spec §25, §29, §344).
 *
 * Review is first-class: a note is anchored to a specific procedure, audit area
 * or piece of evidence and moves open → responded → cleared. The dashboard's
 * pending-review queue and headline counts are DERIVED from procedure/area state
 * (procedures Ready for Review, areas with a submitted conclusion), split into
 * manager/partner level by whether the reviewer is the engagement's EP. An open
 * blocking note is the completion gate consumed by SA-8 (§29).
 */
@Injectable()
export class AuditReviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listForEngagement(ctx: RlsContext, engagementId: string): Promise<StatutoryAuditReview[]> {
    return this.db.withRlsContext(ctx, (client) =>
      this.readReview(client, engagementId, ctx.employeeId ?? null),
    );
  }

  private async readReview(
    client: PoolClient,
    engagementId: string,
    viewerId: string | null,
  ): Promise<StatutoryAuditReview[]> {
    const { rows: shells } = await client.query<ShellRow>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1 AND status <> 'cancelled'
        ORDER BY created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];
    const shellIds = shells.map((s) => s.id);
    const partnerId = await this.engagementPartnerId(client, engagementId);
    const today = new Date().toISOString().slice(0, 10);

    const { rows: notes } = await client.query<NoteRow>(
      `SELECT rn.id, rn.workflow_instance_id, rn.target_type, rn.target_id,
              CASE rn.target_type
                WHEN 'procedure' THEN p.procedure_ref || ' · ' || p.title
                WHEN 'work_area' THEN wa.title
                WHEN 'evidence' THEN ev.title
              END AS target_label,
              CASE rn.target_type
                WHEN 'procedure' THEN p.owner_employee_id
                WHEN 'work_area' THEN wa.owner_employee_id
              END AS target_owner_id,
              CASE rn.target_type
                WHEN 'procedure' THEN p.reviewer_employee_id
                WHEN 'work_area' THEN wa.reviewer_employee_id
              END AS target_reviewer_id,
              rn.review_level, rn.body, rn.status, rn.is_blocking, rn.source_key,
              rn.raised_by_employee_id,
              rb.full_name AS raised_by_name, rn.response,
              pb.full_name AS responded_by_name, rn.responded_at,
              cb.full_name AS cleared_by_name, rn.cleared_at,
              rn.version, rn.created_at, rn.updated_at
         FROM hsdg.audit_review_notes rn
         LEFT JOIN hsdg.employees rb ON rb.id = rn.raised_by_employee_id
         LEFT JOIN hsdg.employees pb ON pb.id = rn.responded_by_employee_id
         LEFT JOIN hsdg.employees cb ON cb.id = rn.cleared_by_employee_id
         LEFT JOIN hsdg.audit_procedures p ON rn.target_type = 'procedure' AND p.id = rn.target_id
         LEFT JOIN hsdg.audit_work_areas wa ON rn.target_type = 'work_area' AND wa.id = rn.target_id
         LEFT JOIN hsdg.audit_evidence ev ON rn.target_type = 'evidence' AND ev.id = rn.target_id
        WHERE rn.workflow_instance_id = ANY($1::uuid[])
        ORDER BY rn.created_at DESC`,
      [shellIds],
    );
    const file = await this.loadFileReview(client, shellIds);
    const live = notes.filter((n) => n.status !== REVIEW_NOTE_STATUS.cleared);
    const liveKeys = new Set(live.map((n) => n.source_key).filter((k): k is string => k != null));
    const liveOn = (targetId: string): number =>
      live.filter((n) => n.target_id === targetId).length;

    return shells.map((shell) => {
      const dismissed = file.dismissed.get(shell.id) ?? new Set<string>();
      const enrich = (
        targetId: string,
        reviewerId: string | null,
      ): Pick<
        ReviewQueueItem,
        'checks' | 'context' | 'ready' | 'suggestedNotes' | 'openNotes' | 'isMine'
      > => {
        const r = file.reviews.get(targetId);
        return {
          checks: r?.checks ?? [],
          context: r?.context ?? [],
          ready: r?.ready ?? false,
          suggestedNotes: r ? openSuggestions(r.suggestions, liveKeys, dismissed) : [],
          openNotes: liveOn(targetId),
          isMine: viewerId != null && reviewerId === viewerId,
        };
      };
      const queue: ReviewQueueItem[] = [
        ...file.procedures
          .filter((p) => p.workflow_instance_id === shell.id && p.state === 'ready_for_review')
          .map((p) => ({
            targetType: REVIEW_TARGET_TYPE.procedure,
            targetId: p.id,
            label: `${p.procedure_ref} · ${p.title}`,
            workAreaTitle: p.area_title,
            preparerName: p.owner_name,
            reviewerName: p.reviewer_name,
            reviewLevel: reviewLevelFor(p.reviewer_employee_id, partnerId),
            state: p.state,
            dueDate: p.due_date,
            isOverdue: isReviewOverdue({ dueDate: p.due_date }, today),
            ...enrich(p.id, p.reviewer_employee_id),
          })),
        ...file.areas
          .filter(
            (a) =>
              a.workflow_instance_id === shell.id &&
              a.conclusion_state === 'submitted' &&
              a.reviewed_at == null,
          )
          .map((a) => ({
            targetType: REVIEW_TARGET_TYPE.workArea,
            targetId: a.id,
            label: a.title,
            workAreaTitle: a.title,
            preparerName: a.owner_name,
            reviewerName: a.reviewer_name,
            reviewLevel: reviewLevelFor(a.reviewer_employee_id, partnerId),
            state: a.conclusion_state,
            dueDate: a.due_date,
            isOverdue: isReviewOverdue({ dueDate: a.due_date }, today),
            ...enrich(a.id, a.reviewer_employee_id),
          })),
      ];
      const shellNotes = notes
        .filter((n) => n.workflow_instance_id === shell.id)
        .map((n) => mapNote(n, file.passing, viewerId));
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        summary: summarizeReview(queue, shellNotes),
        queue,
        notes: shellNotes,
        forMe: {
          toReview: queue.filter((q) => q.isMine).length,
          toAnswer: shellNotes.filter((n) => n.forMeToAnswer).length,
          toClear: shellNotes.filter((n) => n.forMeToClear).length,
        },
      };
    });
  }

  /** Procedures and areas with the facts their pre-review checks read. */
  private async loadFileReview(client: PoolClient, shellIds: string[]): Promise<FileReview> {
    const { rows: procedures } = await client.query<ProcRow>(
      `SELECT p.workflow_instance_id, p.id, p.procedure_ref, p.title, p.state, p.objective,
              p.conclusion, p.sampling_method, p.sample_size, p.due_date, p.work_area_id,
              p.owner_employee_id, p.reviewer_employee_id,
              own.full_name AS owner_name, rev.full_name AS reviewer_name, wa.title AS area_title,
              (SELECT count(*)::int FROM hsdg.audit_evidence_procedures ep
                WHERE ep.procedure_id = p.id) AS evidence_count,
              (SELECT count(*)::int FROM hsdg.audit_exceptions x
                WHERE x.procedure_id = p.id AND x.status = 'open') AS open_exceptions,
              (SELECT count(*)::int FROM hsdg.audit_exceptions x
                WHERE x.procedure_id = p.id AND x.status = 'carried_forward') AS carried_exceptions,
              r.risk_ref, r.is_significant AS risk_significant
         FROM hsdg.audit_procedures p
         LEFT JOIN hsdg.employees own ON own.id = p.owner_employee_id
         LEFT JOIN hsdg.employees rev ON rev.id = p.reviewer_employee_id
         LEFT JOIN hsdg.audit_work_areas wa ON wa.id = p.work_area_id
         LEFT JOIN hsdg.audit_risks r ON r.id = p.risk_id
        WHERE p.workflow_instance_id = ANY($1::uuid[])
        ORDER BY p.due_date NULLS LAST, p.procedure_ref`,
      [shellIds],
    );
    const { rows: areas } = await client.query<AreaRow>(
      `SELECT wa.workflow_instance_id, wa.id, wa.title, wa.conclusion, wa.conclusion_state,
              wa.reviewed_at, wa.due_date, wa.owner_employee_id, wa.reviewer_employee_id,
              own.full_name AS owner_name, rev.full_name AS reviewer_name
         FROM hsdg.audit_work_areas wa
         LEFT JOIN hsdg.employees own ON own.id = wa.owner_employee_id
         LEFT JOIN hsdg.employees rev ON rev.id = wa.reviewer_employee_id
        WHERE wa.workflow_instance_id = ANY($1::uuid[]) AND wa.is_active = true
        ORDER BY wa.due_date NULLS LAST, wa.title`,
      [shellIds],
    );
    const { rows: pbc } = await client.query<{ work_area_id: string; pbc_ref: string }>(
      `SELECT work_area_id, pbc_ref FROM hsdg.audit_pbc_items
        WHERE workflow_instance_id = ANY($1::uuid[]) AND work_area_id IS NOT NULL
          AND status = ANY($2::text[])
        ORDER BY pbc_ref`,
      [shellIds, PBC_OUTSTANDING_STATUSES],
    );
    const { rows: dismissals } = await client.query<{
      workflow_instance_id: string;
      source_key: string;
    }>(
      `SELECT workflow_instance_id, source_key FROM hsdg.audit_review_dismissals
        WHERE workflow_instance_id = ANY($1::uuid[])`,
      [shellIds],
    );

    const reviews = new Map<string, ItemReview>();
    const passing = new Set<string>();
    const record = (id: string, key: (id: string, check: string) => string, r: ItemReview) => {
      reviews.set(id, r);
      for (const c of r.checks) if (c.ok) passing.add(key(id, c.key));
    };
    for (const p of procedures) {
      record(
        p.id,
        procedureKey,
        reviewProcedure({
          id: p.id,
          ref: p.procedure_ref,
          objective: p.objective,
          conclusion: p.conclusion,
          samplingMethod: p.sampling_method,
          sampleSize: p.sample_size,
          evidenceCount: p.evidence_count,
          openExceptions: p.open_exceptions,
          carriedExceptions: p.carried_exceptions,
          significantRisks: p.risk_significant && p.risk_ref ? [p.risk_ref] : [],
        }),
      );
    }
    for (const a of areas) {
      const inArea = procedures.filter((p) => p.work_area_id === a.id);
      record(
        a.id,
        areaKey,
        reviewArea({
          id: a.id,
          title: a.title,
          conclusion: a.conclusion,
          procedures: inArea.map((p) => ({ ref: p.procedure_ref, state: p.state })),
          outstandingPbc: pbc.filter((x) => x.work_area_id === a.id).map((x) => x.pbc_ref),
          significantRisks: [
            ...new Set(
              inArea.filter((p) => p.risk_significant && p.risk_ref).map((p) => p.risk_ref!),
            ),
          ],
          carriedExceptions: inArea.reduce((n, p) => n + p.carried_exceptions, 0),
        }),
      );
    }
    const dismissed = new Map<string, Set<string>>();
    for (const d of dismissals) {
      const set = dismissed.get(d.workflow_instance_id) ?? new Set<string>();
      set.add(d.source_key);
      dismissed.set(d.workflow_instance_id, set);
    }
    return { procedures, areas, reviews, passing, dismissed };
  }

  // ── Raise a review note (§344) ──────────────────────────────────────────────

  async raiseNote(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ReviewNoteInput,
  ): Promise<StatutoryAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const reviewLevel =
        input.reviewLevel ??
        (await this.deriveLevel(client, engagementId, input.targetType, input.targetId));

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_review_notes
           (workflow_instance_id, engagement_id, target_type, target_id, review_level,
            body, is_blocking, raised_by_employee_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          workflowInstanceId,
          engagementId,
          input.targetType,
          input.targetId,
          reviewLevel,
          input.body.trim(),
          input.isBlocking ?? false,
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.review_note_raised',
        objectType: 'audit_review_note',
        objectId: rows[0]!.id,
        after: {
          targetType: input.targetType,
          targetId: input.targetId,
          isBlocking: input.isBlocking ?? false,
        },
      });
      const [review] = await this.readReview(client, engagementId, ctx.employeeId ?? null);
      return review!;
    });
  }

  /** Edit a note's body / blocking flag / level (PATCH semantics; §344). */
  async updateNote(
    ctx: RlsContext,
    engagementId: string,
    noteId: string,
    input: { body?: string; isBlocking?: boolean; reviewLevel?: ReviewLevel; version: number },
  ): Promise<StatutoryAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertNote(client, engagementId, noteId);
      const params: unknown[] = [noteId, input.version];
      const sets: string[] = [];
      const set = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.body !== undefined) {
        if (!input.body.trim()) throw new BadRequestException('A review note needs a comment.');
        set('body', input.body.trim());
      }
      if (input.isBlocking !== undefined) set('is_blocking', input.isBlocking);
      if (input.reviewLevel !== undefined) set('review_level', input.reviewLevel);
      if (sets.length === 0) {
        const [review] = await this.readReview(client, engagementId, ctx.employeeId ?? null);
        return review!;
      }
      const result = await client.query(
        `UPDATE hsdg.audit_review_notes
            SET ${sets.join(', ')}, version = version + 1
          WHERE id = $1 AND version = $2`,
        params,
      );
      this.assertRowChanged(result.rowCount);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.review_note_updated',
        objectType: 'audit_review_note',
        objectId: noteId,
      });
      const [review] = await this.readReview(client, engagementId, ctx.employeeId ?? null);
      return review!;
    });
  }

  /** The preparer responds to an open note (§344). */
  async respondNote(
    ctx: RlsContext,
    engagementId: string,
    noteId: string,
    input: { response: string; version: number },
  ): Promise<StatutoryAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const status = await this.assertNote(client, engagementId, noteId);
      if (status === REVIEW_NOTE_STATUS.cleared) {
        throw new ConflictException('This review note is already cleared.');
      }
      if (!input.response.trim()) throw new BadRequestException('A response is required.');
      const result = await client.query(
        `UPDATE hsdg.audit_review_notes
            SET status = 'responded', response = $3,
                responded_by_employee_id = $4, responded_at = now(),
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [noteId, input.version, input.response.trim(), ctx.employeeId ?? null],
      );
      this.assertRowChanged(result.rowCount);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.review_note_responded',
        objectType: 'audit_review_note',
        objectId: noteId,
      });
      const [review] = await this.readReview(client, engagementId, ctx.employeeId ?? null);
      return review!;
    });
  }

  /** The reviewer clears a note — accepted/closed (§25 "Clear"). */
  async clearNote(
    ctx: RlsContext,
    engagementId: string,
    noteId: string,
    input: { version: number },
  ): Promise<StatutoryAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const status = await this.assertNote(client, engagementId, noteId);
      if (status === REVIEW_NOTE_STATUS.cleared) {
        throw new ConflictException('This review note is already cleared.');
      }
      const result = await client.query(
        `UPDATE hsdg.audit_review_notes
            SET status = 'cleared', cleared_by_employee_id = $3, cleared_at = now(),
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [noteId, input.version, ctx.employeeId ?? null],
      );
      this.assertRowChanged(result.rowCount);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.review_note_cleared',
        objectType: 'audit_review_note',
        objectId: noteId,
      });
      const [review] = await this.readReview(client, engagementId, ctx.employeeId ?? null);
      return review!;
    });
  }

  async deleteNote(
    ctx: RlsContext,
    engagementId: string,
    noteId: string,
  ): Promise<StatutoryAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `DELETE FROM hsdg.audit_review_notes WHERE id = $1 AND engagement_id = $2`,
        [noteId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Review note not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.review_note_deleted',
        objectType: 'audit_review_note',
        objectId: noteId,
      });
      const [review] = await this.readReview(client, engagementId, ctx.employeeId ?? null);
      return review!;
    });
  }

  // ── One-click review (reads the file) ─────────────────────────────────────

  /**
   * The reviewer's decision on a queued procedure or area. Approve completes a
   * procedure (its completion rules apply) or signs off an area's conclusion;
   * it is refused while review notes on it are still live. Return sends it
   * back to the preparer — a procedure to Returned, an area's conclusion to
   * draft — with the typed note and / or the suggested notes raised in the
   * same step.
   */
  async decide(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: {
      targetType: ReviewTargetType;
      targetId: string;
      decision: ReviewDecision;
      note?: string | null;
      raiseSuggested?: boolean;
    },
  ): Promise<StatutoryAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const target = await this.lockTarget(
        client,
        workflowInstanceId,
        input.targetType,
        input.targetId,
      );
      const { rows: liveRows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hsdg.audit_review_notes
          WHERE target_id = $1 AND status IN ('open','responded')`,
        [input.targetId],
      );
      const liveNotes = liveRows[0]?.n ?? 0;

      if (input.decision === 'approve') {
        if (liveNotes > 0) {
          throw new ConflictException(
            `Clear the ${liveNotes} open review note(s) on it before approving.`,
          );
        }
        if (input.targetType === REVIEW_TARGET_TYPE.procedure) {
          if (target.state !== 'ready_for_review') {
            throw new ConflictException('This procedure is not waiting for review.');
          }
          const block = procedureCompletionBlock({
            objective: target.objective,
            conclusion: target.conclusion,
            openExceptions: target.openExceptions,
          });
          if (block) throw new BadRequestException(block);
          await client.query(
            `UPDATE hsdg.audit_procedures SET state = 'complete', version = version + 1
              WHERE id = $1`,
            [input.targetId],
          );
        } else {
          if (target.state !== 'submitted' || target.reviewedAt) {
            throw new ConflictException('This area conclusion is not waiting for review.');
          }
          await client.query(
            `UPDATE hsdg.audit_work_areas
                SET reviewed_at = now(), reviewed_by_employee_id = $2
              WHERE id = $1`,
            [input.targetId, ctx.employeeId ?? null],
          );
        }
      } else {
        const notes: Array<{ body: string; isBlocking: boolean; sourceKey: string | null }> = [];
        if (input.note?.trim()) {
          notes.push({ body: input.note.trim(), isBlocking: false, sourceKey: null });
        }
        if (input.raiseSuggested) {
          notes.push(...(await this.suggestionsFor(client, ctx, engagementId, input.targetId)));
        }
        if (notes.length === 0 && liveNotes === 0) {
          throw new BadRequestException(
            'Say what needs doing — type a note or raise the suggested ones.',
          );
        }
        if (input.targetType === REVIEW_TARGET_TYPE.procedure) {
          if (target.state !== 'ready_for_review') {
            throw new ConflictException('This procedure is not waiting for review.');
          }
          await client.query(
            `UPDATE hsdg.audit_procedures SET state = 'returned', version = version + 1
              WHERE id = $1`,
            [input.targetId],
          );
        } else {
          if (target.state !== 'submitted') {
            throw new ConflictException('This area conclusion is not waiting for review.');
          }
          // The reset trigger clears any sign-off when the conclusion goes back to draft.
          await client.query(
            `UPDATE hsdg.audit_work_areas
                SET conclusion_state = 'draft', detail_version = detail_version + 1
              WHERE id = $1`,
            [input.targetId],
          );
        }
        for (const n of notes) {
          await this.insertNote(client, ctx, engagementId, workflowInstanceId, {
            targetType: input.targetType,
            targetId: input.targetId,
            ...n,
          });
        }
      }
      await this.audit.recordWith(client, ctx, {
        action:
          input.decision === 'approve'
            ? 'statutory_audit.review_approved'
            : 'statutory_audit.review_returned',
        objectType: input.targetType === 'procedure' ? 'audit_procedure' : 'audit_work_area',
        objectId: input.targetId,
      });
      const [review] = await this.readReview(client, engagementId, ctx.employeeId ?? null);
      return review!;
    });
  }

  /** Raise the suggested notes on a target (all of them, or the keys given). */
  async raiseSuggested(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { targetId: string; sourceKeys?: string[] },
  ): Promise<StatutoryAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const targetType = await this.targetTypeOf(client, workflowInstanceId, input.targetId);
      const wanted = input.sourceKeys?.length ? new Set(input.sourceKeys) : null;
      const notes = (await this.suggestionsFor(client, ctx, engagementId, input.targetId)).filter(
        (n) => !wanted || wanted.has(n.sourceKey),
      );
      if (notes.length === 0) {
        throw new ConflictException('Nothing left to raise — the file has moved on; refresh.');
      }
      for (const n of notes) {
        await this.insertNote(client, ctx, engagementId, workflowInstanceId, {
          targetType,
          targetId: input.targetId,
          ...n,
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.review_notes_suggested_raised',
        objectType: targetType === 'procedure' ? 'audit_procedure' : 'audit_work_area',
        objectId: input.targetId,
        after: { count: notes.length },
      });
      const [review] = await this.readReview(client, engagementId, ctx.employeeId ?? null);
      return review!;
    });
  }

  /** Never offer this suggestion again on this file. */
  async dismissSuggestion(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    sourceKey: string,
  ): Promise<StatutoryAuditReview> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await client.query(
        `INSERT INTO hsdg.audit_review_dismissals
           (workflow_instance_id, engagement_id, source_key, dismissed_by_employee_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [workflowInstanceId, engagementId, sourceKey, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.review_suggestion_dismissed',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { sourceKey },
      });
      const [review] = await this.readReview(client, engagementId, ctx.employeeId ?? null);
      return review!;
    });
  }

  /** The suggestions still on offer for one target, as the dashboard shows them. */
  private async suggestionsFor(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    targetId: string,
  ): Promise<SuggestedReviewNote[]> {
    const all = await this.readReview(client, engagementId, ctx.employeeId ?? null);
    for (const shell of all) {
      const item = shell.queue.find((q) => q.targetId === targetId);
      if (item) return item.suggestedNotes;
    }
    return [];
  }

  private async insertNote(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    n: {
      targetType: ReviewTargetType;
      targetId: string;
      body: string;
      isBlocking: boolean;
      sourceKey: string | null;
    },
  ): Promise<void> {
    const level = await this.deriveLevel(client, engagementId, n.targetType, n.targetId);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_review_notes
         (workflow_instance_id, engagement_id, target_type, target_id, review_level,
          body, is_blocking, raised_by_employee_id, source_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (workflow_instance_id, source_key)
         WHERE source_key IS NOT NULL AND status IN ('open', 'responded')
         DO NOTHING
       RETURNING id`,
      [
        workflowInstanceId,
        engagementId,
        n.targetType,
        n.targetId,
        level,
        n.body,
        n.isBlocking,
        ctx.employeeId ?? null,
        n.sourceKey,
      ],
    );
    if (rows[0]) {
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.review_note_raised',
        objectType: 'audit_review_note',
        objectId: rows[0].id,
        after: { targetType: n.targetType, targetId: n.targetId, isBlocking: n.isBlocking },
      });
    }
  }

  /** Lock a procedure / area on this file for a decision and read what it needs. */
  private async lockTarget(
    client: PoolClient,
    workflowInstanceId: string,
    targetType: ReviewTargetType,
    targetId: string,
  ): Promise<{
    state: string;
    objective: string | null;
    conclusion: string | null;
    openExceptions: number;
    reviewedAt: Date | null;
  }> {
    if (targetType === REVIEW_TARGET_TYPE.procedure) {
      const { rows } = await client.query<{
        state: string;
        objective: string | null;
        conclusion: string | null;
      }>(
        `SELECT state, objective, conclusion FROM hsdg.audit_procedures
          WHERE id = $1 AND workflow_instance_id = $2 FOR UPDATE`,
        [targetId, workflowInstanceId],
      );
      if (!rows[0]) throw new NotFoundException('Procedure not found on this file.');
      const { rows: ex } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hsdg.audit_exceptions
          WHERE procedure_id = $1 AND status = 'open'`,
        [targetId],
      );
      return { ...rows[0], openExceptions: ex[0]?.n ?? 0, reviewedAt: null };
    }
    if (targetType === REVIEW_TARGET_TYPE.workArea) {
      const { rows } = await client.query<{
        conclusion_state: string;
        conclusion: string | null;
        reviewed_at: Date | null;
      }>(
        `SELECT conclusion_state, conclusion, reviewed_at FROM hsdg.audit_work_areas
          WHERE id = $1 AND workflow_instance_id = $2 AND is_active FOR UPDATE`,
        [targetId, workflowInstanceId],
      );
      if (!rows[0]) throw new NotFoundException('Audit area not found on this file.');
      return {
        state: rows[0].conclusion_state,
        objective: null,
        conclusion: rows[0].conclusion,
        openExceptions: 0,
        reviewedAt: rows[0].reviewed_at,
      };
    }
    throw new BadRequestException('Only procedures and audit areas are reviewed this way.');
  }

  private async targetTypeOf(
    client: PoolClient,
    workflowInstanceId: string,
    targetId: string,
  ): Promise<ReviewTargetType> {
    const { rows } = await client.query<{ t: ReviewTargetType }>(
      `SELECT 'procedure'::text AS t FROM hsdg.audit_procedures
        WHERE id = $1 AND workflow_instance_id = $2
       UNION ALL
       SELECT 'work_area' FROM hsdg.audit_work_areas
        WHERE id = $1 AND workflow_instance_id = $2`,
      [targetId, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('Nothing to review with that id on this file.');
    return rows[0].t;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }

  private async assertNote(
    client: PoolClient,
    engagementId: string,
    noteId: string,
  ): Promise<ReviewNoteStatus> {
    const { rows } = await client.query<{ status: ReviewNoteStatus }>(
      `SELECT status FROM hsdg.audit_review_notes WHERE id = $1 AND engagement_id = $2`,
      [noteId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Review note not found.');
    return rows[0].status;
  }

  private assertRowChanged(rowCount: number | null): void {
    if ((rowCount ?? 0) === 0) {
      throw new ConflictException(
        'This review note changed since you loaded it; refresh and retry.',
      );
    }
  }

  private async engagementPartnerId(
    client: PoolClient,
    engagementId: string,
  ): Promise<string | null> {
    const { rows } = await client.query<{ engagement_partner_id: string | null }>(
      `SELECT engagement_partner_id FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    return rows[0]?.engagement_partner_id ?? null;
  }

  /**
   * Validate the note's target is on this engagement and derive the review level
   * from its reviewer (partner where the reviewer is the EP, else manager). A
   * polymorphic FK is not expressible, so the target is checked here per type.
   */
  private async deriveLevel(
    client: PoolClient,
    engagementId: string,
    targetType: ReviewTargetType,
    targetId: string,
  ): Promise<ReviewLevel> {
    const partnerId = await this.engagementPartnerId(client, engagementId);
    if (targetType === REVIEW_TARGET_TYPE.procedure) {
      const { rows } = await client.query<{ reviewer_employee_id: string | null }>(
        `SELECT reviewer_employee_id FROM hsdg.audit_procedures WHERE id = $1 AND engagement_id = $2`,
        [targetId, engagementId],
      );
      if (!rows[0]) throw new BadRequestException('Procedure not found on this engagement.');
      return reviewLevelFor(rows[0].reviewer_employee_id, partnerId);
    }
    if (targetType === REVIEW_TARGET_TYPE.workArea) {
      const { rows } = await client.query<{ reviewer_employee_id: string | null }>(
        `SELECT reviewer_employee_id FROM hsdg.audit_work_areas WHERE id = $1 AND engagement_id = $2`,
        [targetId, engagementId],
      );
      if (!rows[0]) throw new BadRequestException('Audit area not found on this engagement.');
      return reviewLevelFor(rows[0].reviewer_employee_id, partnerId);
    }
    // Evidence carries no reviewer of its own; default to manager review.
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.audit_evidence WHERE id = $1 AND engagement_id = $2`,
      [targetId, engagementId],
    );
    if (!rows[0]) throw new BadRequestException('Evidence not found on this engagement.');
    return reviewLevelFor(null, partnerId);
  }
}

function mapNote(
  n: NoteRow,
  passing: ReadonlySet<string>,
  viewerId: string | null,
): AuditReviewNote {
  return {
    id: n.id,
    targetType: n.target_type,
    targetId: n.target_id,
    targetLabel: n.target_label,
    reviewLevel: n.review_level,
    body: n.body,
    status: n.status,
    isBlocking: n.is_blocking,
    raisedByName: n.raised_by_name,
    response: n.response,
    respondedByName: n.responded_by_name,
    respondedAt: n.responded_at ? n.responded_at.toISOString() : null,
    clearedByName: n.cleared_by_name,
    clearedAt: n.cleared_at ? n.cleared_at.toISOString() : null,
    version: n.version,
    createdAt: n.created_at.toISOString(),
    updatedAt: n.updated_at.toISOString(),
    sourceKey: n.source_key,
    resolvedInFile:
      n.status !== REVIEW_NOTE_STATUS.cleared && resolvedInFile(n.source_key, passing),
    forMeToAnswer:
      viewerId != null && n.status === REVIEW_NOTE_STATUS.open && n.target_owner_id === viewerId,
    forMeToClear:
      viewerId != null &&
      n.status === REVIEW_NOTE_STATUS.responded &&
      (n.raised_by_employee_id === viewerId || n.target_reviewer_id === viewerId),
  };
}

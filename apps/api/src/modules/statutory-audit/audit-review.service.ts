import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  isReviewOverdue,
  reviewLevelFor,
  summarizeReview,
  REVIEW_NOTE_STATUS,
  REVIEW_TARGET_TYPE,
  type AuditReviewNote,
  type ReviewLevel,
  type ReviewNoteStatus,
  type ReviewQueueItem,
  type ReviewTargetType,
  type StatutoryAuditReview,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

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
    return this.db.withRlsContext(ctx, (client) => this.readReview(client, engagementId));
  }

  private async readReview(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditReview[]> {
    const { rows: shells } = await client.query<ShellRow>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1
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
              rn.review_level, rn.body, rn.status, rn.is_blocking,
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

    // Pending review — procedures Ready for Review (§8) + areas with a submitted
    // conclusion (§11). Their reviewer decides manager vs partner level (§25).
    const { rows: procQueue } = await client.query<{
      workflow_instance_id: string;
      id: string;
      procedure_ref: string;
      title: string;
      state: string;
      due_date: string | null;
      reviewer_employee_id: string | null;
      owner_name: string | null;
      reviewer_name: string | null;
      area_title: string | null;
    }>(
      `SELECT p.workflow_instance_id, p.id, p.procedure_ref, p.title, p.state, p.due_date,
              p.reviewer_employee_id, own.full_name AS owner_name, rev.full_name AS reviewer_name,
              wa.title AS area_title
         FROM hsdg.audit_procedures p
         LEFT JOIN hsdg.employees own ON own.id = p.owner_employee_id
         LEFT JOIN hsdg.employees rev ON rev.id = p.reviewer_employee_id
         LEFT JOIN hsdg.audit_work_areas wa ON wa.id = p.work_area_id
        WHERE p.workflow_instance_id = ANY($1::uuid[]) AND p.state = 'ready_for_review'
        ORDER BY p.due_date NULLS LAST, p.procedure_ref`,
      [shellIds],
    );

    const { rows: areaQueue } = await client.query<{
      workflow_instance_id: string;
      id: string;
      title: string;
      conclusion_state: string;
      due_date: string | null;
      reviewer_employee_id: string | null;
      owner_name: string | null;
      reviewer_name: string | null;
    }>(
      `SELECT wa.workflow_instance_id, wa.id, wa.title, wa.conclusion_state, wa.due_date,
              wa.reviewer_employee_id, own.full_name AS owner_name, rev.full_name AS reviewer_name
         FROM hsdg.audit_work_areas wa
         LEFT JOIN hsdg.employees own ON own.id = wa.owner_employee_id
         LEFT JOIN hsdg.employees rev ON rev.id = wa.reviewer_employee_id
        WHERE wa.workflow_instance_id = ANY($1::uuid[])
          AND wa.is_active = true AND wa.conclusion_state = 'submitted'
        ORDER BY wa.due_date NULLS LAST, wa.title`,
      [shellIds],
    );

    return shells.map((shell) => {
      const shellNotes = notes.filter((n) => n.workflow_instance_id === shell.id).map(mapNote);
      const queue: ReviewQueueItem[] = [
        ...procQueue
          .filter((p) => p.workflow_instance_id === shell.id)
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
          })),
        ...areaQueue
          .filter((a) => a.workflow_instance_id === shell.id)
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
          })),
      ];
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        summary: summarizeReview(queue, shellNotes),
        queue,
        notes: shellNotes,
      };
    });
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
      const [review] = await this.readReview(client, engagementId);
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
        const [review] = await this.readReview(client, engagementId);
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
      const [review] = await this.readReview(client, engagementId);
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
      const [review] = await this.readReview(client, engagementId);
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
      const [review] = await this.readReview(client, engagementId);
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
      const [review] = await this.readReview(client, engagementId);
      return review!;
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

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

function mapNote(n: NoteRow): AuditReviewNote {
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
  };
}

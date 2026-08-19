import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ClsService } from 'nestjs-cls';
import {
  ENGAGEMENT_STATUS,
  REVIEW_TYPE,
  type EngagementStatus,
  type ReviewOutcome,
  type ReviewPointStatus,
  type ReviewType,
} from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import type { PageParams, PageResult } from '../../../common/pagination/pagination.dto';
import { resolveAmbientCorrelationId } from '../../../common/context/request-context';
import { AuditService } from '../../audit/audit.service';
import { selectEngagementDetail } from '../engagement-detail.query';
import { translatePgError } from '../engagements.service';
import type { EngagementDetail } from '../engagements.types';
import type {
  RecordReviewInput,
  ResolveReviewPointInput,
  ReviewPointRecord,
  ReviewRecord,
  SetReviewPlanInput,
  SignOffInput,
} from './reviews.types';

/** Statuses at which the engagement is not open to planning changes. */
const TERMINAL_STATUSES: EngagementStatus[] = [
  ENGAGEMENT_STATUS.completed,
  ENGAGEMENT_STATUS.closed,
  ENGAGEMENT_STATUS.declined,
  ENGAGEMENT_STATUS.withdrawn,
  ENGAGEMENT_STATUS.cancelled,
];

interface ReviewRow {
  id: string;
  engagement_id: string;
  review_type: ReviewType;
  reviewer_employee_id: string;
  reviewer_name: string | null;
  reviewer_role: string | null;
  outcome: ReviewOutcome;
  notes: string | null;
  superseded_at: Date | null;
  superseded_reason: string | null;
  created_at: Date;
}

interface PointRow {
  id: string;
  review_id: string;
  raised_by_employee_id: string;
  raised_by_name: string | null;
  matter: string;
  is_key_matter: boolean;
  status: ReviewPointStatus;
  resolved_by_employee_id: string | null;
  resolved_by_name: string | null;
  resolution: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

/**
 * The review & sign-off engine (Phase 7, ADR-0012).
 *
 * The RLS floor (is_engagement_lead) already restricts writes to engagement
 * leads; this service adds the finer professional authority on top — an EP
 * review, and any EP-required sign-off, must be the *accountable* EP, not
 * merely any lead. Completion is gated elsewhere (reviewSignedOffGuard) on the
 * sign-off + open-points state this service maintains.
 */
@Injectable()
export class EngagementReviewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  /** Record a manager or EP review, optionally raising review points. */
  async recordReview(
    ctx: RlsContext,
    id: string,
    input: RecordReviewInput,
  ): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = this.requireActive(await selectEngagementDetail(client, id), ctx);
      // Sign-off is terminal: no further review evidence or points may be added
      // once signed off, or the engagement could sit "signed off" yet carry
      // newer, unresolved findings. To revise the review, reopen it first (which
      // supersedes the sign-off). Sign-off ⇒ zero open points, so this also keeps
      // the "no open points while signed off" invariant intact.
      if (before.isSignedOff) {
        throw new ConflictException(
          'Cannot record a review: the engagement is already signed off. Reopen it to revise the review.',
        );
      }
      // EP review must be the accountable EP (the RLS lead floor also admits the
      // manager; this is the professional ceiling on top of it).
      if (
        input.reviewType === REVIEW_TYPE.epReview &&
        ctx.employeeId !== before.engagementPartnerId
      ) {
        throw new ForbiddenException(
          'Only the accountable Engagement Partner may record an EP review.',
        );
      }

      const correlationId = resolveAmbientCorrelationId(this.cls) ?? null;
      await this.bumpVersion(client, id, input.version);
      let reviewId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_reviews
             (engagement_id, review_type, reviewer_employee_id, reviewer_role, outcome, notes, correlation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            id,
            input.reviewType,
            ctx.employeeId,
            ctx.role,
            input.outcome,
            input.notes ?? null,
            correlationId,
          ],
        );
        reviewId = rows[0]!.id;
        for (const point of input.reviewPoints ?? []) {
          await client.query(
            `INSERT INTO hsdg.engagement_review_points
               (engagement_id, review_id, raised_by_employee_id, matter, is_key_matter)
             VALUES ($1,$2,$3,$4,$5)`,
            [id, reviewId, ctx.employeeId, point.matter, point.isKeyMatter ?? false],
          );
        }
      } catch (err) {
        throw translatePgError(err);
      }

      const after = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.review_recorded',
        objectType: 'engagement',
        objectId: id,
        after: {
          reviewId,
          reviewType: input.reviewType,
          outcome: input.outcome,
          reviewPoints: (input.reviewPoints ?? []).length,
        },
        correlationId,
      });
      return after!;
    });
  }

  /**
   * Perform the terminal sign-off. Who may sign off is decided by the effective
   * review model: an EP-required model (key-matter / full EP) demands the
   * accountable EP; a manager-review model admits any lead (→ manager-level
   * completion). Blocked while any review point is open, or if already signed off.
   */
  async signOff(ctx: RlsContext, id: string, input: SignOffInput): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = this.requireActive(await selectEngagementDetail(client, id), ctx);
      const model = before.effectiveReviewModel;

      if (model.requiresEpSignoff && ctx.employeeId !== before.engagementPartnerId) {
        throw new ForbiddenException(
          `Only the accountable Engagement Partner may sign off this engagement — its review ` +
            `model "${model.name}" requires EP sign-off.`,
        );
      }
      if (before.openReviewPointCount > 0) {
        throw new BadRequestException(
          `Cannot sign off: ${before.openReviewPointCount} review point(s) are still open.`,
        );
      }
      if (before.isSignedOff) {
        throw new ConflictException('The engagement is already signed off.');
      }

      const correlationId = resolveAmbientCorrelationId(this.cls) ?? null;
      await this.bumpVersion(client, id, input.version);
      let reviewId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.engagement_reviews
             (engagement_id, review_type, reviewer_employee_id, reviewer_role, outcome, notes, correlation_id)
           VALUES ($1,'sign_off',$2,$3,'signed_off',$4,$5) RETURNING id`,
          [id, ctx.employeeId, ctx.role, input.notes ?? null, correlationId],
        );
        reviewId = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err);
      }

      const after = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.signed_off',
        objectType: 'engagement',
        objectId: id,
        after: { reviewId, reviewModel: model.slug, signedOffByEmployeeId: ctx.employeeId },
        correlationId,
      });
      return after!;
    });
  }

  /** Resolve an open review point. Any engagement lead (RLS) may confirm resolution. */
  async resolveReviewPoint(
    ctx: RlsContext,
    id: string,
    pointId: string,
    input: ResolveReviewPointInput,
  ): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      this.requireActive(await selectEngagementDetail(client, id), ctx);

      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.engagement_review_points
           SET status = 'resolved', resolved_by_employee_id = $1, resolution = $2, resolved_at = now()
           WHERE id = $3 AND engagement_id = $4 AND status = 'open'`,
          [ctx.employeeId, input.resolution, pointId, id],
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translatePgError(err);
      }
      if (updated === 0) {
        throw new NotFoundException('Open review point not found on this engagement.');
      }

      await this.bumpVersion(client, id);
      const after = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.review_point_resolved',
        objectType: 'engagement',
        objectId: id,
        after: { reviewPointId: pointId, resolution: input.resolution },
      });
      return after!;
    });
  }

  /**
   * Set (escalate) the engagement's review plan — the EP choosing a more
   * rigorous review model than the service's default. Escalate-only: the
   * database trigger rejects any model weaker than the service requires
   * (§2.4 — "never allow a lower review model where the service requires Full
   * EP Review").
   */
  async setReviewPlan(
    ctx: RlsContext,
    id: string,
    input: SetReviewPlanInput,
  ): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await selectEngagementDetail(client, id);
      if (!before) throw new NotFoundException('Engagement not found.');
      if (TERMINAL_STATUSES.includes(before.status)) {
        throw new BadRequestException(
          `Cannot change the review plan of a "${before.status}" engagement.`,
        );
      }
      // The review plan is the EP's professional judgement (§2.1) — only the
      // accountable EP sets it, not merely any engagement lead (the RLS floor
      // also admits the manager and firm-wide MP; this is the ceiling on top).
      if (!ctx.employeeId || ctx.employeeId !== before.engagementPartnerId) {
        throw new ForbiddenException(
          "Only the accountable Engagement Partner may set the engagement's review plan.",
        );
      }
      // Changing the plan after sign-off would silently invalidate it — e.g.
      // escalating a manager-signed engagement to an EP-required model would
      // leave an insufficient sign-off that still passes the completion gate.
      // Reopen (which supersedes the sign-off) is the governed way back.
      if (before.isSignedOff) {
        throw new BadRequestException(
          'Cannot change the review plan of a signed-off engagement. Reopen it first.',
        );
      }
      const modelId = await this.resolveReviewModelId(client, input.reviewModelSlug);

      const params: unknown[] = [modelId, id];
      let versionClause = '';
      if (input.version !== undefined) {
        params.push(input.version);
        versionClause = ` AND version = $${params.length}`;
      }
      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.engagements SET review_model_id = $1, version = version + 1
           WHERE id = $2${versionClause}`,
          params,
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translatePgError(err); // P0001 (escalate-only) → 400
      }
      if (updated === 0) {
        throw new ConflictException(
          'Engagement was modified by someone else. Refresh and retry (stale version).',
        );
      }

      const after = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.review_plan_set',
        objectType: 'engagement',
        objectId: id,
        before: { reviewModel: before.reviewPlanModel?.slug ?? null },
        after: { reviewModel: input.reviewModelSlug },
      });
      return after!;
    });
  }

  /** The engagement's review & sign-off history, newest first, with review points. */
  async listReviews(
    ctx: RlsContext,
    id: string,
    page: PageParams,
  ): Promise<PageResult<ReviewRecord>> {
    return this.db.withRlsContext(ctx, async (client) => {
      const engagement = await selectEngagementDetail(client, id);
      if (!engagement) throw new NotFoundException('Engagement not found.');

      const { rows } = await client.query<ReviewRow & { total_count: string }>(
        `SELECT r.id, r.engagement_id, r.review_type, r.reviewer_employee_id,
                rev.full_name AS reviewer_name, r.reviewer_role, r.outcome, r.notes,
                r.superseded_at, r.superseded_reason, r.created_at,
                count(*) OVER() AS total_count
         FROM hsdg.engagement_reviews r
         LEFT JOIN hsdg.employees rev ON rev.id = r.reviewer_employee_id
         WHERE r.engagement_id = $1
         ORDER BY r.created_at DESC
         LIMIT $2 OFFSET $3`,
        [id, page.limit, page.offset],
      );

      const reviewIds = rows.map((r) => r.id);
      const pointsByReview = await this.pointsForReviews(client, reviewIds);
      return {
        items: rows.map((r) => ({
          id: r.id,
          engagementId: r.engagement_id,
          reviewType: r.review_type,
          reviewerId: r.reviewer_employee_id,
          reviewerName: r.reviewer_name,
          reviewerRole: r.reviewer_role,
          outcome: r.outcome,
          notes: r.notes,
          supersededAt: r.superseded_at ? r.superseded_at.toISOString() : null,
          supersededReason: r.superseded_reason,
          createdAt: r.created_at.toISOString(),
          points: pointsByReview.get(r.id) ?? [],
        })),
        total: rows[0] ? Number(rows[0].total_count) : 0,
      };
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  /**
   * A review write requires an active engagement the caller can see (RLS gates
   * visibility) and a caller linked to an employee record (to attribute the
   * review). Returns the loaded engagement for the caller to use.
   */
  private requireActive(before: EngagementDetail | null, ctx: RlsContext): EngagementDetail {
    if (!before) throw new NotFoundException('Engagement not found.');
    if (!ctx.employeeId) {
      throw new BadRequestException(
        'You must be linked to an employee record to act on engagement reviews.',
      );
    }
    if (before.status !== ENGAGEMENT_STATUS.active) {
      throw new BadRequestException(
        `Reviews can only be recorded while the engagement is "active" (currently "${before.status}").`,
      );
    }
    return before;
  }

  private async bumpVersion(
    client: PoolClient,
    id: string,
    expectedVersion?: number,
  ): Promise<void> {
    const params: unknown[] = [id];
    let versionClause = '';
    if (expectedVersion !== undefined) {
      params.push(expectedVersion);
      versionClause = ` AND version = $${params.length}`;
    }
    const result = await client.query(
      `UPDATE hsdg.engagements SET version = version + 1 WHERE id = $1${versionClause}`,
      params,
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new ConflictException(
        'Engagement was modified by someone else. Refresh and retry (stale version).',
      );
    }
  }

  private async resolveReviewModelId(client: PoolClient, slug: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.review_models WHERE slug = $1`,
      [slug],
    );
    if (!rows[0]) throw new BadRequestException(`Unknown review model "${slug}".`);
    return rows[0].id;
  }

  private async pointsForReviews(
    client: PoolClient,
    reviewIds: string[],
  ): Promise<Map<string, ReviewPointRecord[]>> {
    const byReview = new Map<string, ReviewPointRecord[]>();
    if (reviewIds.length === 0) return byReview;
    const { rows } = await client.query<PointRow>(
      `SELECT p.id, p.review_id, p.raised_by_employee_id, rb.full_name AS raised_by_name,
              p.matter, p.is_key_matter, p.status,
              p.resolved_by_employee_id, rs.full_name AS resolved_by_name,
              p.resolution, p.resolved_at, p.created_at
       FROM hsdg.engagement_review_points p
       LEFT JOIN hsdg.employees rb ON rb.id = p.raised_by_employee_id
       LEFT JOIN hsdg.employees rs ON rs.id = p.resolved_by_employee_id
       WHERE p.review_id = ANY($1::uuid[])
       ORDER BY p.created_at`,
      [reviewIds],
    );
    for (const row of rows) {
      const record: ReviewPointRecord = {
        id: row.id,
        reviewId: row.review_id,
        raisedById: row.raised_by_employee_id,
        raisedByName: row.raised_by_name,
        matter: row.matter,
        isKeyMatter: row.is_key_matter,
        status: row.status,
        resolvedById: row.resolved_by_employee_id,
        resolvedByName: row.resolved_by_name,
        resolution: row.resolution,
        resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
        createdAt: row.created_at.toISOString(),
      };
      const list = byReview.get(row.review_id);
      if (list) list.push(record);
      else byReview.set(row.review_id, [record]);
    }
    return byReview;
  }
}

import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  WORK_REVIEW_TYPE,
  type EngagementKind,
  type FilingReviewItem,
  type ReviewPointItem,
  type SignOffItem,
  type WorkReviewItem,
  type WorkReviewQueue,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import {
  WORK_LINK_COLUMNS,
  type WorkLinkSqlRow,
  workFilingContextOf,
  workLinkFilingOf,
  workLinkJoin,
  workLinkOf,
} from '../../common/work-links';

/** Whole IST calendar days from a timestamp to today. */
const DAYS_WAITING = (ts: string): string =>
  `(timezone('Asia/Kolkata', now())::date - timezone('Asia/Kolkata', ${ts})::date)`;

interface EngagementCols {
  engagement_id: string;
  engagement_code: string;
  engagement_kind: EngagementKind;
  entity_name: string;
  waiting_since: Date;
  days_waiting: number;
}

interface FilingReviewRow extends EngagementCols, WorkLinkSqlRow {
  id: string;
  title: string;
  preparer_id: string | null;
  preparer_name: string | null;
  due_date: string | null;
  review_started: boolean;
  version: number;
}

interface ReviewPointRow extends EngagementCols {
  id: string;
  matter: string;
  raised_by_id: string;
  raised_by_name: string | null;
  is_key_matter: boolean;
}

interface SignOffRow extends EngagementCols {
  review_model_name: string;
  cleared_by_name: string | null;
}

/**
 * Staff Workflow WF-105 — "To review": everything waiting for the caller's
 * review, oldest first, read through their RLS.
 *
 * - filing_review: tasks sent to me for review (reviewer = me, in_review).
 * - review_point: open review points on active engagements I lead and must
 *   clear — I'm the engagement manager, or the partner where there is none
 *   (review points carry no assignee; clearing them is the manager's job).
 * - sign_off: active engagements I'm the partner on whose review model needs
 *   EP sign-off, with no open points and the latest review cleared (the moment
 *   the "EP sign-off pending" notification fires).
 */
@Injectable()
export class WorkReviewsService {
  constructor(private readonly db: DatabaseService) {}

  async queue(ctx: RlsContext): Promise<WorkReviewQueue> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (!ctx.employeeId) return { items: [], total: 0 };
      const me = ctx.employeeId;
      const [filings, points, signOffs] = [
        await this.filingReviews(client, me),
        await this.reviewPoints(client, me),
        await this.signOffs(client, me),
      ];
      const items: WorkReviewItem[] = [...filings, ...points, ...signOffs].sort(
        (a, b) => a.waitingSince.localeCompare(b.waitingSince) || a.id.localeCompare(b.id),
      );
      return { items, total: items.length };
    });
  }

  /** How many items are waiting (the sidebar badge) — same rules, counts only. */
  async count(ctx: RlsContext): Promise<{ total: number }> {
    const { total } = await this.queue(ctx);
    return { total };
  }

  private async filingReviews(client: PoolClient, me: string): Promise<FilingReviewItem[]> {
    const { rows } = await client.query<FilingReviewRow>(
      `SELECT t.id, t.title, t.engagement_id, eng.engagement_code, eng.kind AS engagement_kind,
              ent.legal_name AS entity_name,
              t.assigned_to_employee_id AS preparer_id, ae.full_name AS preparer_name,
              t.due_date::text, (t.review_started_at IS NOT NULL) AS review_started, t.version,
              COALESCE(t.sent_for_review_at, t.updated_at) AS waiting_since,
              ${DAYS_WAITING('COALESCE(t.sent_for_review_at, t.updated_at)')} AS days_waiting,
              ${WORK_LINK_COLUMNS}
         FROM hsdg.tasks t
         JOIN hsdg.engagements eng ON eng.id = t.engagement_id
         JOIN hsdg.entities ent ON ent.id = eng.entity_id
         LEFT JOIN hsdg.employees ae ON ae.id = t.assigned_to_employee_id
         ${workLinkJoin('t.source_compliance_instance_id')}
        WHERE t.reviewer_employee_id = $1 AND t.status = 'in_review'
        ORDER BY COALESCE(t.sent_for_review_at, t.updated_at), t.id`,
      [me],
    );
    return rows.map((r) => {
      const filing = workFilingContextOf(r);
      return {
        ...engagementOf(r),
        id: r.id,
        type: WORK_REVIEW_TYPE.filingReview,
        title: filing ? `${filing.formLabel} · ${filing.periodLabel}` : r.title,
        taskId: r.id,
        preparerId: r.preparer_id,
        preparerName: r.preparer_name,
        dueDate: r.due_date,
        internalDate: filing?.internalDate ?? r.due_date,
        statutoryDate: filing?.statutoryDate ?? null,
        reviewStarted: r.review_started,
        taskVersion: r.version,
        filing,
        link: workLinkOf(
          { engagementId: r.engagement_id, engagementKind: r.engagement_kind, taskId: r.id },
          workLinkFilingOf(r),
        ),
      };
    });
  }

  private async reviewPoints(client: PoolClient, me: string): Promise<ReviewPointItem[]> {
    const { rows } = await client.query<ReviewPointRow>(
      `SELECT rp.id, rp.matter, rp.engagement_id, eng.engagement_code,
              eng.kind AS engagement_kind, ent.legal_name AS entity_name,
              rp.raised_by_employee_id AS raised_by_id, rb.full_name AS raised_by_name,
              rp.is_key_matter, rp.created_at AS waiting_since,
              ${DAYS_WAITING('rp.created_at')} AS days_waiting
         FROM hsdg.engagement_review_points rp
         JOIN hsdg.engagements eng ON eng.id = rp.engagement_id
         JOIN hsdg.entities ent ON ent.id = eng.entity_id
         LEFT JOIN hsdg.employees rb ON rb.id = rp.raised_by_employee_id
        WHERE rp.status = 'open' AND eng.status = 'active'
          AND (eng.engagement_manager_id = $1
               OR (eng.engagement_manager_id IS NULL AND eng.engagement_partner_id = $1))
        ORDER BY rp.created_at, rp.id`,
      [me],
    );
    return rows.map((r) => ({
      ...engagementOf(r),
      id: r.id,
      type: WORK_REVIEW_TYPE.reviewPoint,
      title: r.matter,
      reviewPointId: r.id,
      raisedById: r.raised_by_id,
      raisedByName: r.raised_by_name,
      isKeyMatter: r.is_key_matter,
      link: workLinkOf({ engagementId: r.engagement_id, engagementKind: r.engagement_kind }),
    }));
  }

  private async signOffs(client: PoolClient, me: string): Promise<SignOffItem[]> {
    const { rows } = await client.query<SignOffRow>(
      `SELECT eng.id AS engagement_id, eng.engagement_code, eng.kind AS engagement_kind,
              ent.legal_name AS entity_name,
              COALESCE(rmplan.name, rmreq.name) AS review_model_name,
              lr.created_at AS waiting_since, ${DAYS_WAITING('lr.created_at')} AS days_waiting,
              lrb.full_name AS cleared_by_name
         FROM hsdg.engagements eng
         JOIN hsdg.entities ent ON ent.id = eng.entity_id
         JOIN hsdg.services s ON s.id = eng.service_id
         LEFT JOIN hsdg.review_models rmreq ON rmreq.id = s.required_review_model_id
         LEFT JOIN hsdg.review_models rmplan ON rmplan.id = eng.review_model_id
         JOIN LATERAL (
           SELECT r.created_at, r.outcome, r.reviewer_employee_id
             FROM hsdg.engagement_reviews r
            WHERE r.engagement_id = eng.id AND r.superseded_at IS NULL
              AND r.review_type IN ('manager_review', 'ep_review')
            ORDER BY r.created_at DESC
            LIMIT 1
         ) lr ON true
         LEFT JOIN hsdg.employees lrb ON lrb.id = lr.reviewer_employee_id
        WHERE eng.engagement_partner_id = $1 AND eng.status = 'active'
          AND COALESCE(rmplan.requires_ep_signoff, rmreq.requires_ep_signoff)
          AND lr.outcome = 'cleared'
          AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_reviews so
                           WHERE so.engagement_id = eng.id AND so.review_type = 'sign_off'
                             AND so.superseded_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_review_points rp
                           WHERE rp.engagement_id = eng.id AND rp.status = 'open')
        ORDER BY lr.created_at, eng.id`,
      [me],
    );
    return rows.map((r) => ({
      ...engagementOf(r),
      id: r.engagement_id,
      type: WORK_REVIEW_TYPE.signOff,
      title: `Sign off ${r.engagement_code}`,
      reviewModelName: r.review_model_name,
      clearedByName: r.cleared_by_name,
      link: workLinkOf({ engagementId: r.engagement_id, engagementKind: r.engagement_kind }),
    }));
  }
}

function engagementOf(r: EngagementCols): {
  engagementId: string;
  engagementCode: string;
  engagementKind: EngagementKind;
  entityName: string;
  waitingSince: string;
  daysWaiting: number;
} {
  return {
    engagementId: r.engagement_id,
    engagementCode: r.engagement_code,
    engagementKind: r.engagement_kind,
    entityName: r.entity_name,
    waitingSince: r.waiting_since.toISOString(),
    daysWaiting: Number(r.days_waiting),
  };
}

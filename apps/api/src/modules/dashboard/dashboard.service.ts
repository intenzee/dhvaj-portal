import { Injectable } from '@nestjs/common';
import type { DashboardSummary } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';

interface SummaryRow {
  active_engagements: string;
  overdue_compliance: string;
  due_soon_compliance: string;
  pending_reviews: string;
  pending_signoffs: string;
  open_client_dependencies: string;
  high_risk: string;
  my_open_tasks: string;
  my_overdue_tasks: string;
  unread_notifications: string;
}

/**
 * Home-dashboard counts (Phase 12). Every count is a scalar subquery over an
 * RLS-protected table, so the whole summary is scoped to what the caller can
 * see — firm-wide for the Managing Partner, assignment-scoped for everyone else —
 * in a single round-trip. The web chooses which cards to render per role; the
 * database has already scoped the numbers.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async summary(ctx: RlsContext, dueSoonDays: number): Promise<DashboardSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<SummaryRow>(
        `SELECT
           (SELECT count(*) FROM hsdg.engagements e WHERE e.status = 'active') AS active_engagements,

           (SELECT count(*) FROM hsdg.compliance_instances ci
              WHERE ci.status = 'open'
                AND COALESCE(ci.statutory_deadline_override, ci.statutory_deadline) < CURRENT_DATE)
             AS overdue_compliance,

           (SELECT count(*) FROM hsdg.compliance_instances ci
              WHERE ci.status = 'open'
                AND COALESCE(ci.statutory_deadline_override, ci.statutory_deadline)
                    BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int)
             AS due_soon_compliance,

           (SELECT count(*) FROM hsdg.engagements e
              WHERE e.status = 'active'
                AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_reviews r
                                WHERE r.engagement_id = e.id AND r.review_type = 'sign_off'
                                  AND r.superseded_at IS NULL)
                AND EXISTS (SELECT 1 FROM hsdg.engagement_review_points rp
                            WHERE rp.engagement_id = e.id AND rp.status = 'open'))
             AS pending_reviews,

           (SELECT count(*) FROM hsdg.engagements e
              JOIN hsdg.services s ON s.id = e.service_id
              JOIN hsdg.review_models rmreq ON rmreq.id = s.required_review_model_id
              LEFT JOIN hsdg.review_models rmplan ON rmplan.id = e.review_model_id
              WHERE e.status = 'active'
                AND COALESCE(rmplan.requires_ep_signoff, rmreq.requires_ep_signoff) = true
                AND e.engagement_partner_id = hsdg.ctx_employee_id()
                AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_reviews r
                                WHERE r.engagement_id = e.id AND r.review_type = 'sign_off'
                                  AND r.superseded_at IS NULL)
                AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_review_points rp
                                WHERE rp.engagement_id = e.id AND rp.status = 'open'))
             AS pending_signoffs,

           (SELECT count(*) FROM hsdg.client_dependencies cd
              WHERE cd.status IN ('pending', 'partially_received')) AS open_client_dependencies,

           (SELECT count(*) FROM hsdg.engagement_review_points rp
              WHERE rp.status = 'open' AND rp.is_key_matter = true) AS high_risk,

           (SELECT count(*) FROM hsdg.tasks t
              WHERE t.assigned_to_employee_id = hsdg.ctx_employee_id()
                AND t.status NOT IN ('done', 'cancelled')) AS my_open_tasks,

           (SELECT count(*) FROM hsdg.tasks t
              WHERE t.assigned_to_employee_id = hsdg.ctx_employee_id()
                AND t.status NOT IN ('done', 'cancelled')
                AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE) AS my_overdue_tasks,

           (SELECT count(*) FROM hsdg.notifications n WHERE n.status = 'unread')
             AS unread_notifications`,
        [dueSoonDays],
      );
      const r = rows[0]!;
      return {
        activeEngagements: Number(r.active_engagements),
        overdueCompliance: Number(r.overdue_compliance),
        dueSoonCompliance: Number(r.due_soon_compliance),
        pendingReviews: Number(r.pending_reviews),
        pendingSignoffs: Number(r.pending_signoffs),
        openClientDependencies: Number(r.open_client_dependencies),
        highRisk: Number(r.high_risk),
        myOpenTasks: Number(r.my_open_tasks),
        myOverdueTasks: Number(r.my_overdue_tasks),
        unreadNotifications: Number(r.unread_notifications),
        dueSoonWindowDays: dueSoonDays,
      };
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  ComplianceMisReport,
  EngagementMisReport,
  ResourceGroupRow,
  ResourceWorkloadReport,
  UtilisationReport,
  UtilisationRow,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';

/**
 * Reports & MIS (management aggregations). Every query runs under the caller's
 * RLS context, so each figure is scoped to what the caller can see — firm-wide
 * for the Managing Partner, assignment-scoped for a partner/manager — in exactly
 * the same way the Home dashboard is scoped. The database filters the rows;
 * these methods only roll them up.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  async engagementMis(ctx: RlsContext): Promise<EngagementMisReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      const byStatus = await client.query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count
         FROM hsdg.engagements
         GROUP BY status
         ORDER BY count(*) DESC`,
      );

      const byServiceLine = await client.query<{ service_line: string; count: string }>(
        `SELECT sl.name AS service_line, count(*)::text AS count
         FROM hsdg.engagements e
         JOIN hsdg.services s ON s.id = e.service_id
         JOIN hsdg.service_lines sl ON sl.id = s.service_line_id
         GROUP BY sl.name
         ORDER BY count(*) DESC, sl.name`,
      );

      const byOffice = await client.query<{ office_code: string; count: string }>(
        `SELECT o.code AS office_code, count(*)::text AS count
         FROM hsdg.engagements e
         JOIN hsdg.offices o ON o.id = e.office_id
         GROUP BY o.code
         ORDER BY count(*) DESC, o.code`,
      );

      const byPartner = await client.query<{
        partner_id: string;
        partner_name: string;
        active: string;
        total: string;
      }>(
        `SELECT ep.id AS partner_id, ep.full_name AS partner_name,
                count(*) FILTER (WHERE e.status = 'active')::text AS active,
                count(*)::text AS total
         FROM hsdg.engagements e
         JOIN hsdg.employees ep ON ep.id = e.engagement_partner_id
         GROUP BY ep.id, ep.full_name
         ORDER BY count(*) FILTER (WHERE e.status = 'active') DESC, count(*) DESC`,
      );

      const derived = await client.query<{
        total: string;
        active: string;
        on_hold: string;
        completed: string;
        waiting_for_client: string;
        signed_off: string;
      }>(
        `SELECT
           count(*)::text AS total,
           count(*) FILTER (WHERE status = 'active')::text AS active,
           count(*) FILTER (WHERE status = 'on_hold')::text AS on_hold,
           count(*) FILTER (WHERE status = 'completed')::text AS completed,
           (SELECT count(DISTINCT e.id) FROM hsdg.engagements e
              JOIN hsdg.client_dependencies cd ON cd.engagement_id = e.id
              WHERE cd.status IN ('pending', 'partially_received'))::text AS waiting_for_client,
           (SELECT count(*) FROM hsdg.engagements e
              WHERE EXISTS (SELECT 1 FROM hsdg.engagement_reviews r
                            WHERE r.engagement_id = e.id AND r.review_type = 'sign_off'
                              AND r.superseded_at IS NULL))::text AS signed_off
         FROM hsdg.engagements`,
      );
      const d = derived.rows[0]!;

      return {
        totals: {
          total: Number(d.total),
          active: Number(d.active),
          onHold: Number(d.on_hold),
          completed: Number(d.completed),
          waitingForClient: Number(d.waiting_for_client),
          signedOff: Number(d.signed_off),
        },
        byStatus: byStatus.rows.map((r) => ({ status: r.status, count: Number(r.count) })),
        byServiceLine: byServiceLine.rows.map((r) => ({
          serviceLine: r.service_line,
          count: Number(r.count),
        })),
        byOffice: byOffice.rows.map((r) => ({ officeCode: r.office_code, count: Number(r.count) })),
        byPartner: byPartner.rows.map((r) => ({
          partnerId: r.partner_id,
          partnerName: r.partner_name,
          active: Number(r.active),
          total: Number(r.total),
        })),
      };
    });
  }

  async complianceMis(ctx: RlsContext, dueSoonDays: number): Promise<ComplianceMisReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      // Effective statutory date = override, else computed. `open` obligations are
      // classified overdue (< today) or due-soon (within the window).
      const eff = 'COALESCE(ci.statutory_deadline_override, ci.statutory_deadline)';
      const byCategory = await client.query<{
        category: string;
        open: string;
        overdue: string;
        due_soon: string;
      }>(
        `SELECT cr.category,
                count(*) FILTER (WHERE ci.status = 'open')::text AS open,
                count(*) FILTER (WHERE ci.status = 'open' AND ${eff} < CURRENT_DATE)::text AS overdue,
                count(*) FILTER (WHERE ci.status = 'open'
                   AND ${eff} BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int)::text AS due_soon
         FROM hsdg.compliance_instances ci
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
         GROUP BY cr.category
         ORDER BY count(*) FILTER (WHERE ci.status = 'open') DESC, cr.category`,
        [dueSoonDays],
      );

      const totals = await client.query<{
        open: string;
        overdue: string;
        due_soon: string;
        completed: string;
        waived: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE ci.status = 'open')::text AS open,
           count(*) FILTER (WHERE ci.status = 'open' AND ${eff} < CURRENT_DATE)::text AS overdue,
           count(*) FILTER (WHERE ci.status = 'open'
              AND ${eff} BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int)::text AS due_soon,
           count(*) FILTER (WHERE ci.status = 'completed')::text AS completed,
           count(*) FILTER (WHERE ci.status = 'waived')::text AS waived
         FROM hsdg.compliance_instances ci`,
        [dueSoonDays],
      );
      const t = totals.rows[0]!;

      return {
        dueSoonWindowDays: dueSoonDays,
        totals: {
          open: Number(t.open),
          overdue: Number(t.overdue),
          dueSoon: Number(t.due_soon),
          completed: Number(t.completed),
          waived: Number(t.waived),
        },
        byCategory: byCategory.rows.map((r) => ({
          category: r.category,
          open: Number(r.open),
          overdue: Number(r.overdue),
          dueSoon: Number(r.due_soon),
        })),
      };
    });
  }

  async utilisation(ctx: RlsContext): Promise<UtilisationReport> {
    return this.db.withRlsContext(ctx, async (client) => ({
      rows: await this.utilisationRows(client),
    }));
  }

  /**
   * Resource Management view: the per-person utilisation rows plus office and
   * grade rollups and headline totals. Same RLS scoping as `utilisation` — the
   * database filters the rows; this only groups them.
   */
  async resourceWorkload(ctx: RlsContext): Promise<ResourceWorkloadReport> {
    return this.db.withRlsContext(ctx, async (client) => {
      const rows = await this.utilisationRows(client);
      const byOffice = groupWorkload(
        rows,
        (r) => r.officeCode,
        (r) => r.officeCode,
      );
      const byGrade = groupWorkload(
        rows,
        (r) => r.gradeName ?? 'unassigned',
        (r) => r.gradeName ?? 'Unassigned',
      );
      const totals = {
        people: rows.length,
        activeAssignments: rows.reduce((n, r) => n + r.asEp + r.asManager + r.asMember, 0),
        openTasks: rows.reduce((n, r) => n + r.openTasks, 0),
        overdueTasks: rows.reduce((n, r) => n + r.overdueTasks, 0),
        overloaded: rows.filter((r) => r.overdueTasks > 0).length,
      };
      return { rows, byOffice, byGrade, totals };
    });
  }

  /** Per-employee workload over engagements/tasks the caller can see (RLS-scoped). */
  private async utilisationRows(client: PoolClient): Promise<UtilisationRow[]> {
    // The inner subqueries are RLS-scoped, so counts reflect visible rows only;
    // the outer WHERE drops employees with no visible involvement.
    const { rows } = await client.query<{
      employee_id: string;
      employee_name: string;
      grade_name: string | null;
      office_code: string;
      as_ep: string;
      as_manager: string;
      as_member: string;
      open_tasks: string;
      overdue_tasks: string;
    }>(
      `SELECT * FROM (
           SELECT emp.id AS employee_id, emp.full_name AS employee_name,
                  g.name AS grade_name, o.code AS office_code,
                  (SELECT count(*) FROM hsdg.engagements e
                     WHERE e.engagement_partner_id = emp.id AND e.status = 'active') AS as_ep,
                  (SELECT count(*) FROM hsdg.engagements e
                     WHERE e.engagement_manager_id = emp.id AND e.status = 'active') AS as_manager,
                  (SELECT count(*) FROM hsdg.engagement_team t
                     JOIN hsdg.engagements e ON e.id = t.engagement_id
                     WHERE t.employee_id = emp.id AND e.status = 'active') AS as_member,
                  (SELECT count(*) FROM hsdg.tasks tk
                     WHERE tk.assigned_to_employee_id = emp.id
                       AND tk.status NOT IN ('done', 'cancelled')) AS open_tasks,
                  (SELECT count(*) FROM hsdg.tasks tk
                     WHERE tk.assigned_to_employee_id = emp.id
                       AND tk.status NOT IN ('done', 'cancelled')
                       AND tk.due_date IS NOT NULL AND tk.due_date < CURRENT_DATE) AS overdue_tasks
           FROM hsdg.employees emp
           JOIN hsdg.grades g ON g.id = emp.grade_id
           JOIN hsdg.offices o ON o.id = emp.primary_office_id
         ) u
         WHERE (u.as_ep + u.as_manager + u.as_member + u.open_tasks) > 0
         ORDER BY (u.as_ep + u.as_manager + u.as_member) DESC, u.open_tasks DESC, u.employee_name`,
    );

    return rows.map((r) => ({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      gradeName: r.grade_name,
      officeCode: r.office_code,
      asEp: Number(r.as_ep),
      asManager: Number(r.as_manager),
      asMember: Number(r.as_member),
      openTasks: Number(r.open_tasks),
      overdueTasks: Number(r.overdue_tasks),
    }));
  }
}

/** Roll utilisation rows up into a stable, count-ordered group list. */
function groupWorkload(
  rows: UtilisationRow[],
  keyOf: (r: UtilisationRow) => string,
  labelOf: (r: UtilisationRow) => string,
): ResourceGroupRow[] {
  const groups = new Map<string, ResourceGroupRow>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = groups.get(key) ?? {
      key,
      label: labelOf(r),
      people: 0,
      activeAssignments: 0,
      openTasks: 0,
      overdueTasks: 0,
    };
    g.people += 1;
    g.activeAssignments += r.asEp + r.asManager + r.asMember;
    g.openTasks += r.openTasks;
    g.overdueTasks += r.overdueTasks;
    groups.set(key, g);
  }
  return [...groups.values()].sort(
    (a, b) => b.activeAssignments - a.activeAssignments || b.openTasks - a.openTasks,
  );
}

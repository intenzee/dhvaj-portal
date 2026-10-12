import { Injectable, NotFoundException } from '@nestjs/common';
import {
  STREAMS,
  type EngagementKind,
  type EngagementTabs,
  type FilingStatus,
  type OverviewDueItem,
  type PeriodSection,
  type Stream,
  type StreamScope,
} from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { istToday } from '../time/auto-time';
import { periodLabel } from '../../filing-workspace/filing-rules';

/** The Indian financial year (Apr–Mar) a YYYY-MM-DD date falls in, e.g. '2026-27'. */
export function fyOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function fyRange(fy: string): { from: string; to: string } {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

const isStream = (s: string | null): s is Stream => !!s && (STREAMS as string[]).includes(s);

interface DueRow {
  id: string;
  stream: string | null;
  label: string;
  period_key: string | null;
  section: PeriodSection | null;
  due: string;
  days_left: number;
  workflow_status: FilingStatus;
  registration_number: string | null;
}

/**
 * Change 3 — the engagement page's layout data: kind, years and stream tabs
 * in scope (with leads), and the Overview widgets. Read-only; every number
 * comes from tables the caller can already read under RLS.
 */
@Injectable()
export class EngagementTabsService {
  constructor(private readonly db: DatabaseService) {}

  async get(ctx: RlsContext, engagementId: string): Promise<EngagementTabs> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query<{ kind: EngagementKind | null }>(
        `SELECT kind FROM hsdg.engagements WHERE id = $1`,
        [engagementId],
      );
      if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');
      const kind: EngagementKind = eng.rows[0].kind ?? 'assignment';
      const today = istToday(new Date());

      // Years in scope: compliance years, else the years instances fall in.
      const years = await client.query<{ fy: string; streams: string[] }>(
        `SELECT financial_year AS fy, streams FROM hsdg.compliance_engagement_years
          WHERE engagement_id = $1 ORDER BY financial_year DESC`,
        [engagementId],
      );
      const instYears = await client.query<{ fy: string; stream: string | null }>(
        `SELECT DISTINCT ci.financial_year AS fy, COALESCE(rv.stream, sv.stream) AS stream
           FROM hsdg.compliance_instances ci
           LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
           LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
           LEFT JOIN hsdg.services sv ON sv.id = es.service_id
          WHERE ci.engagement_id = $1 AND ci.financial_year IS NOT NULL`,
        [engagementId],
      );
      const byYear = new Map<string, Set<Stream>>();
      const add = (fy: string, s: string | null) => {
        const set = byYear.get(fy) ?? new Set<Stream>();
        if (isStream(s)) set.add(s);
        byYear.set(fy, set);
      };
      for (const y of years.rows) {
        add(y.fy, null);
        for (const s of y.streams) add(y.fy, s);
      }
      // Instance years fill in only when the engagement has no year rows yet.
      if (years.rows.length === 0) for (const r of instYears.rows) add(r.fy, r.stream);
      const financialYears = [...byYear.keys()].sort().reverse();
      const currentFy = fyOf(today);
      const financialYear = financialYears.includes(currentFy)
        ? currentFy
        : (financialYears[0] ?? null);

      const lines = await client.query<{
        stream: string;
        engagement_service_id: string;
        lead_employee_id: string | null;
        lead_name: string | null;
      }>(
        `SELECT DISTINCT ON (sv.stream) sv.stream, es.id AS engagement_service_id,
                es.lead_employee_id, emp.full_name AS lead_name
           FROM hsdg.engagement_services es
           JOIN hsdg.services sv ON sv.id = es.service_id
           LEFT JOIN hsdg.employees emp ON emp.id = es.lead_employee_id
          WHERE es.engagement_id = $1 AND sv.stream IS NOT NULL
            AND es.status NOT IN ('cancelled')
          ORDER BY sv.stream, (sv.folded_into_service_id IS NULL) DESC, es.created_at`,
        [engagementId],
      );
      const lineBy = new Map(lines.rows.map((l) => [l.stream, l]));
      const streams: StreamScope[] = STREAMS.filter(
        (s) => lineBy.has(s) || [...byYear.values()].some((set) => set.has(s)),
      ).map((s) => {
        const l = lineBy.get(s);
        return {
          stream: s,
          engagementServiceId: l?.engagement_service_id ?? null,
          leadEmployeeId: l?.lead_employee_id ?? null,
          leadName: l?.lead_name ?? null,
          financialYears: financialYears.filter((fy) => byYear.get(fy)?.has(s)),
        };
      });

      const due = await client.query<DueRow>(
        `SELECT ci.id, COALESCE(rv.stream, sv.stream) AS stream, COALESCE(rv.form_label, cr.name) AS label,
                ci.period_key, ci.section, x.due::text AS due, (x.due - $2::date) AS days_left,
                ci.workflow_status, r.registration_number
           FROM hsdg.compliance_instances ci
           JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
           LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
           LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
           LEFT JOIN hsdg.services sv ON sv.id = es.service_id
           LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
           LEFT JOIN hsdg.entity_registrations r ON r.id = ci.registration_id
           CROSS JOIN LATERAL (SELECT COALESCE(ci.statutory_deadline_override, ge.revised_due_date,
                                               ci.statutory_deadline) AS due) x
          WHERE ci.engagement_id = $1
            AND ci.workflow_status NOT IN ('filed', 'not_applicable')
            AND x.due <= $2::date + 30
          ORDER BY x.due, label
          LIMIT 200`,
        [engagementId, today],
      );
      const toDue = (r: DueRow): OverviewDueItem => ({
        instanceId: r.id,
        stream: isStream(r.stream) ? r.stream : null,
        label: r.label,
        periodKey: r.period_key,
        periodLabel: r.period_key ? periodLabel(r.period_key) : null,
        section: r.section,
        dueDate: r.due,
        daysLeft: r.days_left,
        workflowStatus: r.workflow_status,
        registrationNumber: r.registration_number,
      });

      const waiting = await client.query<{
        id: string;
        requested_info: string;
        stream: string | null;
        request_date: string;
        escalation_date: string | null;
      }>(
        `SELECT cd.id, cd.requested_info, COALESCE(rv.stream, sv.stream) AS stream,
                cd.request_date::text, cd.escalation_date::text
           FROM hsdg.client_dependencies cd
           LEFT JOIN hsdg.compliance_instances ci ON ci.id = cd.compliance_instance_id
           LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
           LEFT JOIN hsdg.engagement_services es
                  ON es.id = COALESCE(cd.engagement_service_id, ci.engagement_service_id)
           LEFT JOIN hsdg.services sv ON sv.id = es.service_id
          WHERE cd.engagement_id = $1 AND cd.status IN ('pending', 'partially_received')
          ORDER BY cd.escalation_date NULLS LAST, cd.request_date
          LIMIT 50`,
        [engagementId],
      );

      const fy = financialYear ?? currentFy;
      const range = fyRange(fy);
      const money = await client.query<{
        month_s: string;
        year_s: string;
        fee: string | null;
        budget: string | null;
        invoiced: string;
      }>(
        `SELECT
           (SELECT COALESCE(sum(te.duration_seconds), 0) FROM hsdg.effective_time_entries te
             WHERE te.engagement_id = $1 AND te.ended_at IS NOT NULL
               AND (te.started_at AT TIME ZONE 'Asia/Kolkata')::date >= date_trunc('month', $2::date)::date
               AND (te.started_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date)::text AS month_s,
           (SELECT COALESCE(sum(te.duration_seconds), 0) FROM hsdg.effective_time_entries te
             WHERE te.engagement_id = $1 AND te.ended_at IS NOT NULL
               AND (te.started_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $3::date AND $4::date)::text AS year_s,
           (SELECT y.fee_amount::text FROM hsdg.compliance_engagement_years y
             WHERE y.engagement_id = $1 AND y.financial_year = $5) AS fee,
           (SELECT (SELECT sum(v::numeric) FROM jsonb_each_text(y.budget_hours) AS b(k, v))::text
              FROM hsdg.compliance_engagement_years y
             WHERE y.engagement_id = $1 AND y.financial_year = $5) AS budget,
           (SELECT COALESCE(sum(i.total), 0) FROM hsdg.invoices i
             WHERE i.engagement_id = $1 AND i.status IN ('issued', 'paid')
               AND i.issue_date BETWEEN $3::date AND $4::date)::text AS invoiced`,
        [engagementId, today, range.from, range.to, fy],
      );
      const m = money.rows[0]!;
      const fee = m.fee === null ? null : Number(m.fee);
      const invoiced = Number(m.invoiced);
      const hours = (s: string) => Math.round((Number(s) / 3600) * 10) / 10;

      return {
        kind,
        financialYears,
        financialYear,
        streams,
        overview: {
          dueNext30: due.rows.filter((r) => r.days_left >= 0).map(toDue),
          overdue: due.rows.filter((r) => r.days_left < 0).map(toDue),
          waitingOnClient: waiting.rows.map((w) => ({
            id: w.id,
            requestedInfo: w.requested_info,
            stream: isStream(w.stream) ? w.stream : null,
            requestDate: w.request_date,
            escalationDate: w.escalation_date,
            isOverdue: !!w.escalation_date && w.escalation_date < today,
          })),
          hoursThisMonth: hours(m.month_s),
          hoursThisYear: hours(m.year_s),
          budgetHoursThisYear: m.budget === null ? null : Number(m.budget),
          feeAmount: fee,
          invoicedAmount: invoiced,
          unbilledAmount:
            fee === null ? null : Math.max(0, Math.round((fee - invoiced) * 100) / 100),
        },
      };
    });
  }
}

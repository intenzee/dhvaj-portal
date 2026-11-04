import { Injectable, NotFoundException } from '@nestjs/common';
import {
  isBusinessFirmwide,
  PROGRESS_GROUP,
  type ProgressFilters,
  type ProgressGroup,
  type ProgressHolder,
  type ProgressItem,
  type ProgressItemsQuery,
  type ProgressRow,
  type ProgressScope,
  type ProgressStatus,
  type ProgressView,
  type TaskTimeline,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import type { PageParams, PageResult } from '../../common/pagination/pagination.dto';
import { istToday } from '../engagements/time/auto-time';
import {
  buildTimeline,
  COUNTS_SQL,
  countsOf,
  filingKey,
  filingLabel,
  NO_ONE,
  overdueSql,
  parseFilingKey,
  PROGRESS_SQL,
  sortProgressRows,
  ZERO_COUNTS,
  type AssignmentRow,
  type CountsRow,
  type FilingRow,
  type StatusEventRow,
  type TaskHeadRow,
} from './progress';

/** A filing's form, as every list names it (work-links.ts). */
const FORM_LABEL_SQL = `COALESCE(ci.form_label, crv.form_label, cr.name)`;
const PERIOD_KEY_SQL = `COALESCE(ci.period_key, to_char(ci.reference_date, 'YYYY-MM'))`;

/**
 * Phase 3, D-1 — the Progress tracker. One base query (the period, the
 * filters, the caller's reach and the status mapping) feeds both the counts
 * and the drill-down, so a row's numbers always match its list.
 *
 * Reach: firm-wide roles see every task; everyone else the work held by their
 * reporting tree (hsdg.ctx_subtree(): a Partner / Manager their tree, a Senior
 * themselves and their Articles, an Article themselves) — and, on top, only
 * what row-level security already lets them read.
 */
@Injectable()
export class ProgressService {
  constructor(private readonly db: DatabaseService) {}

  async view(ctx: RlsContext, groupBy: ProgressGroup, f: ProgressFilters): Promise<ProgressView> {
    const today = istToday();
    const firmwide = isBusinessFirmwide(ctx.role, ctx.roles ?? []);
    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [today];
      const base = baseSql(firmwide, f, params, groupBy === PROGRESS_GROUP.filing);
      const keys =
        groupBy === PROGRESS_GROUP.person
          ? ['assignee']
          : groupBy === PROGRESS_GROUP.client
            ? ['engagement_id']
            : ['form_label', 'period_key'];
      const sets =
        groupBy === PROGRESS_GROUP.filing
          ? `(form_label, period_key), (form_label, period_key, assignee), ()`
          : `(${keys.join(', ')}), ()`;
      const groupCols = groupBy === PROGRESS_GROUP.filing ? [...keys, 'assignee'] : keys;
      const { rows } = await client.query<
        CountsRow & {
          is_total: boolean;
          is_holder: boolean;
          assignee: string | null;
          engagement_id: string | null;
          form_label: string | null;
          period_key: string | null;
          open: number;
        }
      >(
        `WITH base AS MATERIALIZED (${base})
         SELECT GROUPING(${keys[0]}) = 1 AS is_total,
                ${groupBy === PROGRESS_GROUP.filing ? 'GROUPING(assignee) = 0' : 'false'} AS is_holder,
                ${groupCols.join(', ')}${groupBy === PROGRESS_GROUP.filing ? '' : groupBy === PROGRESS_GROUP.person ? ', NULL::uuid AS engagement_id, NULL::text AS form_label, NULL::text AS period_key' : ', NULL::uuid AS assignee, NULL::text AS form_label, NULL::text AS period_key'},
                ${COUNTS_SQL},
                count(*) FILTER (WHERE progress <> 'completed')::int AS open
           FROM base
          GROUP BY GROUPING SETS (${sets})`,
        params,
      );
      const totalRow = rows.find((r) => r.is_total);
      const totals = totalRow ? countsOf(totalRow) : ZERO_COUNTS;
      const groups = rows.filter((r) => !r.is_total && !r.is_holder);

      let out: ProgressRow[];
      if (groupBy === PROGRESS_GROUP.person) {
        const names = await this.names(
          client,
          groups.map((g) => g.assignee),
        );
        out = groups.map((g) => ({
          key: g.assignee ?? NO_ONE,
          label: g.assignee
            ? (names.get(g.assignee) ?? 'Someone outside your view')
            : 'Not assigned',
          employeeId: g.assignee,
          ...countsOf(g),
        }));
      } else if (groupBy === PROGRESS_GROUP.client) {
        const ids = groups.map((g) => g.engagement_id!).filter(Boolean);
        const { rows: engs } = await client.query<{
          id: string;
          engagement_code: string;
          client_id: string | null;
          client_name: string | null;
          entity_name: string;
          engagement_label: string;
        }>(
          `SELECT g.id, g.engagement_code, c.id AS client_id, c.name AS client_name,
                  COALESCE(en.display_name, en.legal_name) AS entity_name,
                  concat_ws(' · ', s.name, COALESCE(g.period_label, g.financial_year)) AS engagement_label
             FROM hsdg.engagements g
             JOIN hsdg.entities en ON en.id = g.entity_id
             LEFT JOIN hsdg.clients c ON c.id = en.client_id
             LEFT JOIN hsdg.services s ON s.id = g.service_id
            WHERE g.id = ANY ($1::uuid[])`,
          [ids],
        );
        const byId = new Map(engs.map((e) => [e.id, e]));
        out = groups.map((g) => {
          const e = byId.get(g.engagement_id!);
          return {
            key: g.engagement_id!,
            label: e ? (e.client_name ?? e.entity_name) : 'Engagement',
            engagementId: g.engagement_id!,
            engagementCode: e?.engagement_code ?? '',
            engagementLabel: e?.engagement_label || e?.engagement_code || '',
            clientId: e?.client_id ?? null,
            clientName: e?.client_name ?? e?.entity_name ?? null,
            ...countsOf(g),
          };
        });
      } else {
        // Work with no filing has no row here; the totals still count it.
        const filingGroups = groups.filter((g) => g.form_label !== null);
        const holderRows = rows.filter((r) => r.is_holder && r.form_label !== null && r.open > 0);
        const names = await this.names(
          client,
          holderRows.map((h) => h.assignee),
        );
        out = filingGroups.map((g) => {
          const holders: ProgressHolder[] = holderRows
            .filter((h) => h.form_label === g.form_label && h.period_key === g.period_key)
            .sort((a, b) => b.open - a.open)
            .slice(0, 3)
            .map((h) => ({
              employeeId: h.assignee,
              fullName: h.assignee ? (names.get(h.assignee) ?? null) : null,
              open: h.open,
            }));
          return {
            key: filingKey(g.form_label!, g.period_key),
            label: filingLabel(g.form_label!, g.period_key),
            formLabel: g.form_label!,
            periodKey: g.period_key,
            holders,
            ...countsOf(g),
          };
        });
      }
      return {
        groupBy,
        scope: await this.scope(client, firmwide),
        today,
        filters: f,
        totals,
        rows: sortProgressRows(out),
      };
    });
  }

  async items(
    ctx: RlsContext,
    q: ProgressItemsQuery,
    page: PageParams,
  ): Promise<PageResult<ProgressItem>> {
    const today = istToday();
    const firmwide = isBusinessFirmwide(ctx.role, ctx.roles ?? []);
    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [today];
      const base = baseSql(firmwide, q, params, true);
      const conds: string[] = [];
      const p = (v: unknown): string => {
        params.push(v);
        return `$${params.length}`;
      };
      if (q.key && q.groupBy === PROGRESS_GROUP.person) {
        conds.push(q.key === NO_ONE ? 'b.assignee IS NULL' : `b.assignee = ${p(q.key)}::uuid`);
      } else if (q.key && q.groupBy === PROGRESS_GROUP.client) {
        conds.push(`b.engagement_id = ${p(q.key)}::uuid`);
      } else if (q.key && q.groupBy === PROGRESS_GROUP.filing) {
        const k = parseFilingKey(q.key);
        conds.push(`b.form_label = ${p(k.formLabel)}`);
        conds.push(`b.period_key IS NOT DISTINCT FROM ${p(k.periodKey)}::text`);
      }
      if (q.progress) conds.push(`b.progress = ${p(q.progress)}`);
      if (q.overdueOnly) conds.push('b.overdue');
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const limit = p(page.limit);
      const offset = p(page.offset);
      const { rows } = await client.query<{
        id: string;
        title: string;
        status: string;
        progress: ProgressStatus;
        overdue: boolean;
        due_date: string | null;
        engagement_id: string;
        engagement_code: string;
        entity_name: string;
        client_name: string | null;
        assignee: string | null;
        assignee_name: string | null;
        reviewer_name: string | null;
        form_label: string | null;
        period_key: string | null;
        stream: string | null;
        total: number;
      }>(
        `WITH base AS MATERIALIZED (${base})
         SELECT b.id, t.title, b.status, b.progress, b.overdue, t.due_date::text,
                b.engagement_id, g.engagement_code,
                COALESCE(en.display_name, en.legal_name) AS entity_name, c.name AS client_name,
                b.assignee, ae.full_name AS assignee_name, re.full_name AS reviewer_name,
                b.form_label, b.period_key, COALESCE(sv.stream, g.kind) AS stream,
                count(*) OVER ()::int AS total
           FROM base b
           JOIN hsdg.tasks t ON t.id = b.id
           JOIN hsdg.engagements g ON g.id = b.engagement_id
           JOIN hsdg.entities en ON en.id = g.entity_id
           LEFT JOIN hsdg.clients c ON c.id = en.client_id
           LEFT JOIN hsdg.employees ae ON ae.id = b.assignee
           LEFT JOIN hsdg.employees re ON re.id = t.reviewer_employee_id
           LEFT JOIN hsdg.engagement_services es ON es.id = t.engagement_service_id
           LEFT JOIN hsdg.services sv ON sv.id = es.service_id
           ${where}
          ORDER BY b.overdue DESC, t.due_date NULLS LAST, t.created_at, b.id
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return {
        total:
          rows[0]?.total ??
          (page.offset > 0 ? await this.countItems(client, base, where, params) : 0),
        items: rows.map((r) => ({
          taskId: r.id,
          title: r.title,
          status: r.status,
          progress: r.progress,
          isOverdue: r.overdue,
          dueDate: r.due_date,
          engagementId: r.engagement_id,
          engagementCode: r.engagement_code,
          entityName: r.entity_name,
          clientName: r.client_name,
          assigneeId: r.assignee,
          assigneeName: r.assignee_name,
          reviewerName: r.reviewer_name,
          filingLabel: r.form_label ? filingLabel(r.form_label, r.period_key) : null,
          stream: r.stream,
        })),
      };
    });
  }

  /** A task's history: created, hand-overs, each status change and the filing. */
  async timeline(ctx: RlsContext, taskId: string): Promise<TaskTimeline> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<
        TaskHeadRow & { title: string; source_compliance_instance_id: string | null }
      >(
        `SELECT t.title, t.created_at::text, ce.full_name AS created_by_name,
                ae.full_name AS assignee_name, ge.full_name AS assigned_by_name,
                t.assigned_at::text, t.source_compliance_instance_id
           FROM hsdg.tasks t
           LEFT JOIN hsdg.employees ce ON ce.id = t.created_by_employee_id
           LEFT JOIN hsdg.employees ae ON ae.id = t.assigned_to_employee_id
           LEFT JOIN hsdg.employees ge ON ge.id = t.assigned_by_employee_id
          WHERE t.id = $1`,
        [taskId],
      );
      const head = rows[0];
      if (!head) throw new NotFoundException('Task not found.');
      const [events, assignments, filings] = await Promise.all([
        client.query<StatusEventRow>(
          `SELECT ev.from_status, ev.to_status, e.full_name AS actor_name, ev.reason,
                  ev.created_at::text AS at
             FROM hsdg.task_events ev
             LEFT JOIN hsdg.employees e ON e.id = ev.actor_employee_id
            WHERE ev.task_id = $1
            ORDER BY ev.created_at, ev.id`,
          [taskId],
        ),
        client.query<AssignmentRow>(
          `SELECT a.kind, b.full_name AS by_name, t.full_name AS to_name, a.reason, a.at::text AS at
             FROM hsdg.task_assignments a
             LEFT JOIN hsdg.employees b ON b.id = a.by_employee_id
             LEFT JOIN hsdg.employees t ON t.id = a.to_employee_id
            WHERE a.task_id = $1
            ORDER BY a.at, a.id`,
          [taskId],
        ),
        head.source_compliance_instance_id
          ? client.query<FilingRow>(
              `SELECT e.full_name AS filed_by_name, fr.reference_no, fr.created_at::text AS at
                 FROM hsdg.filing_records fr
                 LEFT JOIN hsdg.employees e ON e.id = COALESCE(fr.filed_by_employee_id, fr.recorded_by_employee_id)
                WHERE fr.compliance_instance_id = $1 AND fr.undone_at IS NULL`,
              [head.source_compliance_instance_id],
            )
          : Promise.resolve({ rows: [] as FilingRow[] }),
      ]);
      return {
        taskId,
        title: head.title,
        entries: buildTimeline(head, events.rows, assignments.rows, filings.rows),
      };
    });
  }

  private async countItems(
    client: { query: DatabaseClientQuery },
    base: string,
    where: string,
    params: unknown[],
  ): Promise<number> {
    const { rows } = await client.query<{ n: number }>(
      `WITH base AS MATERIALIZED (${base}) SELECT count(*)::int AS n FROM base b ${where}`,
      params.slice(0, params.length - 2),
    );
    return rows[0]?.n ?? 0;
  }

  private async names(
    client: { query: DatabaseClientQuery },
    ids: (string | null)[],
  ): Promise<Map<string, string>> {
    const want = [...new Set(ids.filter((i): i is string => !!i))];
    if (want.length === 0) return new Map();
    const { rows } = await client.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM hsdg.employees WHERE id = ANY ($1::uuid[])`,
      [want],
    );
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  private async scope(
    client: { query: DatabaseClientQuery },
    firmwide: boolean,
  ): Promise<ProgressScope> {
    if (firmwide) return 'firm';
    const { rows } = await client.query<{ n: number }>(
      `SELECT cardinality(hsdg.ctx_subtree())::int AS n`,
    );
    return (rows[0]?.n ?? 0) > 1 ? 'tree' : 'own';
  }
}

type DatabaseClientQuery = <R>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }>;

/**
 * The tasks the tracker counts, one row each with its tracker status, the
 * overdue overlay and the grouping keys. `params[0]` is the IST date; filters
 * append to `params`.
 */
function baseSql(
  firmwide: boolean,
  f: ProgressFilters,
  params: unknown[],
  withFiling: boolean,
): string {
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  const conds = [`t.status <> 'cancelled'`];
  // Not firm-wide: the work held by the caller's reporting tree (themselves included).
  if (!firmwide)
    conds.push(`t.assigned_to_employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[])`);
  if (f.from) conds.push(`t.due_date >= ${p(f.from)}::date`);
  if (f.to) conds.push(`t.due_date <= ${p(f.to)}::date`);
  if (f.officeId) conds.push(`g.office_id = ${p(f.officeId)}::uuid`);
  if (f.teamId) conds.push(`en.team_id = ${p(f.teamId)}::uuid`);
  if (f.stream) {
    const s = p(f.stream);
    conds.push(`(g.kind = ${s} OR EXISTS (SELECT 1 FROM hsdg.engagement_services ses
                                          JOIN hsdg.services ss ON ss.id = ses.service_id
                                         WHERE ses.id = t.engagement_service_id AND ss.stream = ${s}))`);
  }
  const filingCols = withFiling
    ? `, CASE WHEN ci.id IS NULL THEN NULL ELSE ${FORM_LABEL_SQL} END AS form_label,
         CASE WHEN ci.id IS NULL THEN NULL ELSE ${PERIOD_KEY_SQL} END AS period_key`
    : '';
  const filingJoins = withFiling
    ? `LEFT JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
       LEFT JOIN hsdg.compliance_rule_versions crv ON crv.id = ci.compliance_rule_version_id`
    : '';
  return `SELECT t.id, t.assigned_to_employee_id AS assignee, t.engagement_id, t.status,
                 ${PROGRESS_SQL} AS progress,
                 ${overdueSql('$1')} AS overdue${filingCols}
            FROM hsdg.tasks t
            JOIN hsdg.engagements g ON g.id = t.engagement_id
            JOIN hsdg.entities en ON en.id = g.entity_id
            LEFT JOIN hsdg.compliance_instances ci ON ci.id = t.source_compliance_instance_id
            ${filingJoins}
           WHERE ${conds.join(' AND ')}`;
}

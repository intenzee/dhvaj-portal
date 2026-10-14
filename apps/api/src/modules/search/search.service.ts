import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ENGAGEMENT_KIND_LABEL,
  FILING_STATUS_LABEL,
  SEARCH_GROUP,
  periodKeyLabel,
  workItemHref,
  type EngagementKind,
  type FilingStatus,
  type SearchGroup,
  type SearchHit,
  type SearchResponse,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import {
  withWorkLinks,
  workLinkFilingOf,
  workLinkOf,
  type WorkLinkSqlRow,
} from '../../common/work-links';
import { istToday } from '../engagements/time/auto-time';
import { namesWork, parseSearchQuery, type ParsedSearch } from './search-query';

/** Engagements that never carry live work. */
const DEAD_ENGAGEMENT = ['cancelled', 'declined', 'withdrawn', 'merged'];
const LIMIT: Record<SearchGroup, number> = {
  clients: 5,
  engagements: 5,
  filings: 8,
  tasks: 5,
  documents: 5,
};

/** Builds a WHERE clause with numbered parameters. */
class Where {
  readonly params: unknown[] = [];
  readonly conds: string[] = [];
  p(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
  add(cond: string): void {
    this.conds.push(cond);
  }
  /** Every word must match one of `columns` (ILIKE). */
  everyWord(words: string[], columns: string[]): void {
    for (const w of words) {
      const p = this.p(`%${w}%`);
      this.add(`(${columns.map((c) => `${c} ILIKE ${p}`).join(' OR ')})`);
    }
  }
  sql(): string {
    return this.conds.length ? `WHERE ${this.conds.join(' AND ')}` : '';
  }
}

/** The filing's form label, punctuation stripped ("GSTR-1" → gstr1). */
const FORM_LABEL_FLAT = (ci: string, rv: string, cr: string): string =>
  `regexp_replace(lower(COALESCE(${ci}.form_label, ${rv}.form_label, ${cr}.name)), '[^a-z0-9]', '', 'g')`;

/**
 * The form and period filters on a filing (aliases ci / rv / cr). A form
 * matches the flattened label, or a whole segment of the rule code
 * (GST_GSTR1_M answers to gstr1).
 */
function filingFilters(w: Where, parsed: ParsedSearch, ci = 'ci', rv = 'rv', cr = 'cr'): void {
  if (parsed.forms.length > 0) {
    const f = w.p(parsed.forms);
    w.add(`EXISTS (SELECT 1 FROM unnest(${f}::text[]) sf(form)
                    WHERE ${FORM_LABEL_FLAT(ci, rv, cr)} = sf.form
                       OR lower(${cr}.code) ~ ('(^|_)' || sf.form || '(_|$)'))`);
  }
  if (parsed.period) {
    const p = w.p(parsed.period);
    if (parsed.periodKind === 'month')
      w.add(`(${ci}.period_key = ${p}
              OR (${ci}.period_key IS NULL AND to_char(${ci}.reference_date, 'YYYY-MM') = ${p}))`);
    else if (parsed.periodKind === 'fy') w.add(`${ci}.financial_year = ${p}`);
    else w.add(`${ci}.period_key = ${p}`);
  }
}

interface FilingSqlRow extends WorkLinkSqlRow {
  id: string;
  engagement_id: string;
  engagement_kind: EngagementKind;
  engagement_code: string;
  entity_name: string;
  workflow_status: FilingStatus;
}

interface TaskSqlRow extends WorkLinkSqlRow {
  id: string;
  title: string;
  status: string;
  engagement_id: string;
  engagement_kind: EngagementKind;
  engagement_code: string;
  entity_name: string;
  assignee_name: string | null;
}

interface DocumentSqlRow extends WorkLinkSqlRow {
  id: string;
  title: string;
  task_id: string | null;
  period_section: string | null;
  engagement_id: string;
  engagement_kind: EngagementKind;
  engagement_code: string;
  entity_name: string;
}

/**
 * Staff Workflow WF-304 — Ctrl K across clients, engagements, filings, tasks
 * and documents. Every group reads through the caller's RLS, so a search
 * never reveals what the caller could not open; every hit carries the exact
 * place it opens (`workItemHref`).
 */
@Injectable()
export class SearchService {
  constructor(private readonly db: DatabaseService) {}

  async search(
    ctx: RlsContext,
    q: string,
    opts: { clients: boolean },
    now: Date = new Date(),
  ): Promise<SearchResponse> {
    const parsed = parseSearchQuery(q, istToday(now));
    const understood = {
      text: parsed.text,
      forms: parsed.forms,
      period: parsed.period,
      periodLabel: parsed.periodLabel,
    };
    const work = namesWork(parsed);
    const hasText = parsed.text.length > 0;
    if (!hasText && !work) return { q, understood, groups: [] };

    const found = await this.db.withRlsContext(ctx, async (client) => ({
      clients: hasText && opts.clients ? await this.clients(client, parsed) : [],
      engagements: hasText && !work ? await this.engagements(client, parsed) : [],
      filings: await this.filings(client, parsed),
      tasks: await this.tasks(client, parsed),
      documents: hasText ? await this.documents(client, parsed) : [],
    }));

    // Filings first when the query names a form or a period.
    const order: SearchGroup[] = work
      ? ['filings', 'tasks', 'documents', 'clients', 'engagements']
      : ['clients', 'engagements', 'filings', 'tasks', 'documents'];
    return {
      q,
      understood,
      groups: order.filter((g) => found[g].length > 0).map((g) => ({ group: g, items: found[g] })),
    };
  }

  private async clients(client: PoolClient, parsed: ParsedSearch): Promise<SearchHit[]> {
    const w = new Where();
    w.everyWord(parsed.text, ['ent.legal_name', 'ent.entity_code', 'ent.pan']);
    const { rows } = await client.query<{ id: string; legal_name: string; entity_code: string }>(
      `SELECT ent.id, ent.legal_name, ent.entity_code
         FROM hsdg.entities ent
         ${w.sql()}
        ORDER BY (ent.status = 'active') DESC, ent.legal_name
        LIMIT ${LIMIT.clients}`,
      w.params,
    );
    return rows.map((r) => ({
      group: SEARCH_GROUP.clients,
      id: r.id,
      title: r.legal_name,
      subtitle: r.entity_code,
      href: `/entities/${r.id}`,
      link: null,
    }));
  }

  private async engagements(client: PoolClient, parsed: ParsedSearch): Promise<SearchHit[]> {
    const w = new Where();
    w.add(`eng.status <> ALL(${w.p(DEAD_ENGAGEMENT)}::text[])`);
    w.everyWord(parsed.text, ['eng.engagement_code', 'ent.legal_name']);
    const { rows } = await client.query<{
      id: string;
      engagement_code: string;
      kind: EngagementKind;
      entity_name: string;
    }>(
      `SELECT eng.id, eng.engagement_code, eng.kind, ent.legal_name AS entity_name
         FROM hsdg.engagements eng
         JOIN hsdg.entities ent ON ent.id = eng.entity_id
         ${w.sql()}
        ORDER BY ent.legal_name, eng.engagement_code
        LIMIT ${LIMIT.engagements}`,
      w.params,
    );
    return rows.map((r) => {
      const link = { engagementId: r.id, engagementKind: r.kind };
      return {
        group: SEARCH_GROUP.engagements,
        id: r.id,
        title: `${r.engagement_code} — ${r.entity_name}`,
        subtitle: ENGAGEMENT_KIND_LABEL[r.kind] ?? r.kind,
        href: workItemHref(link),
        link,
      };
    });
  }

  private async filings(client: PoolClient, parsed: ParsedSearch): Promise<SearchHit[]> {
    const w = new Where();
    w.add(`eng.status <> ALL(${w.p(DEAD_ENGAGEMENT)}::text[])`);
    w.everyWord(parsed.text, ['ent.legal_name', 'eng.engagement_code', 'er.registration_number']);
    filingFilters(w, parsed);
    // My own filings first, then open before filed, then by internal date.
    const paged = `SELECT ci.id, ci.engagement_id, eng.kind AS engagement_kind,
                          eng.engagement_code, ent.legal_name AS entity_name,
                          ci.workflow_status,
                          (ci.workflow_status IN ('filed', 'not_applicable')) AS done,
                          EXISTS (SELECT 1 FROM hsdg.tasks mt
                                   WHERE mt.source_compliance_instance_id = ci.id
                                     AND hsdg.ctx_employee_id() IN
                                         (mt.assigned_to_employee_id, mt.reviewer_employee_id)) AS mine,
                          COALESCE(ci.internal_sla_override, ci.internal_sla_date) AS internal_date
                     FROM hsdg.compliance_instances ci
                     JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
                     LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
                     JOIN hsdg.engagements eng ON eng.id = ci.engagement_id
                     JOIN hsdg.entities ent ON ent.id = eng.entity_id
                     LEFT JOIN hsdg.entity_registrations er ON er.id = ci.registration_id
                     ${w.sql()}
                    ORDER BY mine DESC, done, internal_date NULLS LAST, ent.legal_name
                    LIMIT ${LIMIT.filings}`;
    const { rows } = await client.query<FilingSqlRow>(
      withWorkLinks(paged, 'id', 'p.mine DESC, p.done, p.internal_date NULLS LAST, p.entity_name'),
      w.params,
    );
    return rows.map((r) => {
      const link = workLinkOf(
        { engagementId: r.engagement_id, engagementKind: r.engagement_kind },
        workLinkFilingOf(r),
      );
      const period = periodKeyLabel(r.wl_period_key ?? r.wl_reference_month);
      return {
        group: SEARCH_GROUP.filings,
        id: r.id,
        title: `${r.wl_form_label ?? 'Filing'} · ${period} — ${r.entity_name}`,
        subtitle: [
          r.wl_registration_number,
          FILING_STATUS_LABEL[r.workflow_status],
          r.engagement_code,
        ]
          .filter(Boolean)
          .join(' · '),
        href: workItemHref(link),
        link,
      };
    });
  }

  private async tasks(client: PoolClient, parsed: ParsedSearch): Promise<SearchHit[]> {
    const w = new Where();
    w.add(`t.status <> 'cancelled'`);
    w.add(`eng.status <> ALL(${w.p(DEAD_ENGAGEMENT)}::text[])`);
    w.everyWord(parsed.text, ['t.title', 'ent.legal_name']);
    const join = namesWork(parsed)
      ? `JOIN hsdg.compliance_instances ci ON ci.id = t.source_compliance_instance_id
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
         LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id`
      : '';
    if (namesWork(parsed)) filingFilters(w, parsed);
    const paged = `SELECT t.id, t.title, t.status, t.engagement_id, t.source_compliance_instance_id,
                          eng.kind AS engagement_kind, eng.engagement_code,
                          ent.legal_name AS entity_name, ae.full_name AS assignee_name,
                          (t.status = 'done') AS done,
                          (t.assigned_to_employee_id = hsdg.ctx_employee_id()
                           OR t.reviewer_employee_id = hsdg.ctx_employee_id()) AS mine,
                          t.due_date
                     FROM hsdg.tasks t
                     JOIN hsdg.engagements eng ON eng.id = t.engagement_id
                     JOIN hsdg.entities ent ON ent.id = eng.entity_id
                     LEFT JOIN hsdg.employees ae ON ae.id = t.assigned_to_employee_id
                     ${join}
                     ${w.sql()}
                    ORDER BY done, mine DESC NULLS LAST, t.due_date NULLS LAST, t.title
                    LIMIT ${LIMIT.tasks}`;
    const { rows } = await client.query<TaskSqlRow>(
      withWorkLinks(
        paged,
        'source_compliance_instance_id',
        'p.done, p.mine DESC NULLS LAST, p.due_date NULLS LAST, p.title',
      ),
      w.params,
    );
    return rows.map((r) => {
      const link = workLinkOf(
        { engagementId: r.engagement_id, engagementKind: r.engagement_kind, taskId: r.id },
        workLinkFilingOf(r),
      );
      return {
        group: SEARCH_GROUP.tasks,
        id: r.id,
        title: r.title,
        subtitle: [r.entity_name, r.assignee_name, r.status.replace(/_/g, ' ')]
          .filter(Boolean)
          .join(' · '),
        href: workItemHref(link),
        link,
      };
    });
  }

  private async documents(client: PoolClient, parsed: ParsedSearch): Promise<SearchHit[]> {
    const w = new Where();
    w.add(`d.deleted_at IS NULL`);
    w.add(`d.status = 'active'`);
    w.everyWord(parsed.text, ['d.title', 'cv.filename', 'ent.legal_name']);
    const work = namesWork(parsed);
    if (!work) {
      // A name alone would list every file of that client: one word must name the document.
      const any = w.p(parsed.text.map((t) => `%${t}%`));
      w.add(`(d.title ILIKE ANY(${any}::text[]) OR cv.filename ILIKE ANY(${any}::text[]))`);
    }
    const join = work
      ? `JOIN hsdg.compliance_instances ci ON ci.id = d.compliance_instance_id
         JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
         LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id`
      : '';
    if (work) filingFilters(w, parsed);
    const paged = `SELECT d.id, d.title, d.task_id, d.period_section, d.compliance_instance_id,
                          d.engagement_id, d.updated_at,
                          eng.kind AS engagement_kind, eng.engagement_code,
                          ent.legal_name AS entity_name
                     FROM hsdg.documents d
                     LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
                     JOIN hsdg.engagements eng ON eng.id = d.engagement_id
                     JOIN hsdg.entities ent ON ent.id = eng.entity_id
                     ${join}
                     ${w.sql()}
                    ORDER BY d.updated_at DESC
                    LIMIT ${LIMIT.documents}`;
    const { rows } = await client.query<DocumentSqlRow>(
      withWorkLinks(paged, 'compliance_instance_id', 'p.updated_at DESC'),
      w.params,
    );
    return rows.map((r) => {
      const filing = workLinkFilingOf(r);
      const link = workLinkOf(
        { engagementId: r.engagement_id, engagementKind: r.engagement_kind, taskId: r.task_id },
        { ...filing, section: (r.period_section as typeof filing.section) ?? filing.section },
      );
      return {
        group: SEARCH_GROUP.documents,
        id: r.id,
        title: r.title,
        subtitle: [r.entity_name, r.engagement_code].join(' · '),
        href: workItemHref(link),
        link,
      };
    });
  }
}

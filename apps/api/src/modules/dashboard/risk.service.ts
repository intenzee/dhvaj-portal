import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FEATURE_FLAG,
  RISK_TILES,
  RISK_WINDOW,
  formatInr,
  periodKeyLabel,
  sumAmounts,
  type EngagementKind,
  type RiskDashboard,
  type RiskTile,
  type RiskTileKey,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import type { RlsContext } from '../../database/rls-context';
import {
  workLinkFilingOf,
  workLinkJoin,
  workLinkOf,
  WORK_LINK_COLUMNS,
  type WorkLinkSqlRow,
} from '../../common/work-links';
import { CLOSED_ENGAGEMENT_STATUSES } from '../compliance/compliance-calendar-v2.service';
import { DAYS_PAST_DUE_SQL } from '../billing/receivables.service';
import { UnbilledService } from '../billing/unbilled.service';
import { dscTile, udinTile, type RegisterTileFn } from './risk-registers';

interface Page {
  today: string;
  limit: number;
  offset: number;
}

type TileBody = Omit<RiskTile, 'key' | 'href'>;

const TILE_HREF: Record<RiskTileKey, string> = {
  missed: '/compliance?filter=overdue',
  due_unready: '/compliance?filter=due-soon',
  notices: '/notices',
  appeals: '/notices',
  receivables: '/billing/receivables',
  unbilled: '/billing/unbilled',
  dsc: '/registers/dsc?view=at_risk',
  udin: '/registers/udin?view=overdue',
  approvals: '/billing/approvals',
};

interface EngagementCols {
  engagement_id: string;
  engagement_code: string;
  engagement_kind: EngagementKind;
  entity_name: string;
}

const ENGAGEMENT_COLS = `eng.id AS engagement_id, eng.engagement_code,
  eng.kind AS engagement_kind, ent.legal_name AS entity_name`;

/** An open filing's statutory date, extensions and overrides applied. */
const FILING_DUE = `COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)`;

/** Open filings on live engagements: the base of the two filing tiles. */
const OPEN_FILINGS = `
  FROM hsdg.compliance_instances ci
  JOIN hsdg.engagements eng ON eng.id = ci.engagement_id
  LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
 WHERE ci.status = 'open' AND ci.workflow_status NOT IN ('filed', 'not_applicable')
   AND eng.status <> ALL($2::text[])`;

/** A filing has a reviewer when its task names one. */
const NO_REVIEWER = `NOT EXISTS (SELECT 1 FROM hsdg.tasks rt
                     WHERE rt.source_compliance_instance_id = ci.id
                       AND rt.reviewer_employee_id IS NOT NULL)`;

/** A notice's reply date (while a reply is still to file) or its next hearing, in the window. */
const NOTICE_IN_WINDOW = `n.status NOT IN ('closed', 'withdrawn', 'appealed', 'order_received')
   AND ((n.status IN ('received', 'in_progress')
         AND COALESCE(n.internal_due_on, n.reply_due_on) <= $1::date + ${RISK_WINDOW.noticeDays})
        OR n.next_hearing_on BETWEEN $1::date AND $1::date + ${RISK_WINDOW.noticeDays})`;

const NOTICE_DUE = `LEAST(CASE WHEN n.status IN ('received', 'in_progress')
                              THEN COALESCE(n.internal_due_on, n.reply_due_on) END,
                         CASE WHEN n.next_hearing_on >= $1::date THEN n.next_hearing_on END)`;

const OPEN_BALANCE = `i.status IN ('issued', 'partially_paid') AND i.total > i.amount_settled
   AND ${DAYS_PAST_DUE_SQL('i')} > ${RISK_WINDOW.receivableDays}`;

const PENDING_ADJUSTMENTS = `(SELECT w.id, 'write_off'::text AS kind, w.invoice_id, w.amount,
         w.reason, w.created_at
    FROM hsdg.write_offs w WHERE w.status = 'pending'
  UNION ALL
  SELECT c.id, 'credit_note', c.invoice_id, c.total, c.reason, c.created_at
    FROM hsdg.credit_notes c WHERE c.status = 'pending')`;

/**
 * PS-301 · the partner risk dashboard. Each tile is its own pair of queries
 * (a count and a page) in its own RLS transaction, so the web can load them
 * one by one and a slow tile holds up nothing else. The database scopes every
 * one: an office partner sees their office, the Managing Partner the firm.
 */
@Injectable()
export class RiskService {
  constructor(
    private readonly db: DatabaseService,
    private readonly unbilled: UnbilledService,
    private readonly flags: FeatureFlagsService,
  ) {}

  async dashboard(ctx: RlsContext, limit: number): Promise<RiskDashboard> {
    const tiles = await Promise.all(RISK_TILES.map((k) => this.tile(ctx, k, limit, 0)));
    return { asOf: tiles[0]!.asOf, tiles: tiles.map((t) => t.tile) };
  }

  async tile(
    ctx: RlsContext,
    key: RiskTileKey,
    limit: number,
    offset: number,
  ): Promise<{ asOf: string; tile: RiskTile }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const today = await istToday(client);
      const page: Page = { today, limit, offset };
      const body = await this.read(client, ctx, key, page);
      return { asOf: today, tile: { key, href: TILE_HREF[key], ...body } };
    });
  }

  private read(
    client: PoolClient,
    ctx: RlsContext,
    key: RiskTileKey,
    page: Page,
  ): Promise<TileBody> {
    switch (key) {
      case 'missed':
        return this.filings(
          client,
          page,
          `${FILING_DUE} < $1::date`,
          () => 'Statutory date passed',
        );
      case 'due_unready':
        return this.filings(
          client,
          page,
          `${FILING_DUE} BETWEEN $1::date AND $1::date + ${RISK_WINDOW.dueDays}
           AND (ci.workflow_status = 'not_started' OR ${NO_REVIEWER})`,
          (r) =>
            [
              r.workflow_status === 'not_started' ? 'Not started' : null,
              r.no_reviewer ? 'No reviewer' : null,
            ]
              .filter(Boolean)
              .join(' · '),
        );
      case 'notices':
        return this.notices(client, page);
      case 'appeals':
        return this.appeals(client, page);
      case 'receivables':
        return this.receivables(client, page);
      case 'unbilled':
        return this.unbilledTile(client, page);
      case 'dsc':
        return this.register(client, ctx, page, dscTile);
      case 'udin':
        return this.register(client, ctx, page, udinTile);
      case 'approvals':
        return this.approvals(client, page);
    }
  }

  private async filings(
    client: PoolClient,
    page: Page,
    where: string,
    why: (r: { workflow_status: string; no_reviewer: boolean }) => string,
  ): Promise<TileBody> {
    const params = [page.today, CLOSED_ENGAGEMENT_STATUSES];
    // One scan: the count rides on the page (each row's RLS check is a call, so
    // a second count query would pay for every filing twice).
    const { rows } = await client.query<
      EngagementCols &
        WorkLinkSqlRow & {
          workflow_status: string;
          no_reviewer: boolean;
          due: string;
          total: number;
        }
    >(
      `SELECT p.*, ${ENGAGEMENT_COLS}, ${WORK_LINK_COLUMNS}
         FROM (SELECT f.*, ${NO_REVIEWER.replace(/ci\.id/g, 'f.id')} AS no_reviewer
                 FROM (SELECT ci.id, ci.engagement_id AS eid, ci.workflow_status,
                              ${FILING_DUE}::text AS due, count(*) OVER ()::int AS total
                         ${OPEN_FILINGS} AND ${where}
                        ORDER BY ${FILING_DUE}, ci.id
                        LIMIT $3 OFFSET $4) f) p
         JOIN hsdg.engagements eng ON eng.id = p.eid
         JOIN hsdg.entities ent ON ent.id = eng.entity_id
         ${workLinkJoin('p.id')}
        ORDER BY p.due, p.id`,
      [...params, page.limit, page.offset],
    );
    const count =
      rows[0]?.total ??
      (page.offset === 0
        ? 0
        : (
            await client.query<{ n: number }>(
              `SELECT count(*)::int AS n ${OPEN_FILINGS} AND ${where}`,
              params,
            )
          ).rows[0]!.n);
    return {
      count,
      available: true,
      items: rows.map((r) => {
        const filing = workLinkFilingOf(r);
        const period = periodKeyLabel(r.wl_period_key ?? r.wl_reference_month);
        return {
          ref: workLinkOf(
            { engagementId: r.engagement_id, engagementKind: r.engagement_kind },
            filing,
          ),
          title: [r.wl_form_label, period].filter(Boolean).join(' · ') || 'Filing',
          detail: [r.entity_name, r.wl_registration_number, why(r)].filter(Boolean).join(' · '),
          dueOn: r.due,
        };
      }),
    };
  }

  private async notices(client: PoolClient, page: Page): Promise<TileBody> {
    const { rows: c } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.notices n WHERE ${NOTICE_IN_WINDOW}`,
      [page.today],
    );
    const { rows } = await client.query<
      EngagementCols & {
        id: string;
        reference_no: string;
        type_title: string;
        due: string;
        hearing: boolean;
      }
    >(
      `SELECT ${ENGAGEMENT_COLS}, n.id, n.reference_no, nt.title AS type_title,
              ${NOTICE_DUE}::text AS due,
              (${NOTICE_DUE} IS NOT DISTINCT FROM n.next_hearing_on) AS hearing
         FROM hsdg.notices n
         JOIN hsdg.notice_types nt ON nt.id = n.notice_type_id
         JOIN hsdg.engagements eng ON eng.id = n.engagement_id
         JOIN hsdg.entities ent ON ent.id = eng.entity_id
        WHERE ${NOTICE_IN_WINDOW}
        ORDER BY ${NOTICE_DUE}, n.id
        LIMIT $2 OFFSET $3`,
      [page.today, page.limit, page.offset],
    );
    return {
      count: c[0]!.n,
      available: true,
      items: rows.map((r) => ({
        ref: { engagementId: r.engagement_id, engagementKind: r.engagement_kind, noticeId: r.id },
        title: `${r.type_title} · ${r.reference_no}`,
        detail: `${r.entity_name} · ${r.hearing ? 'Hearing' : 'Reply due'}`,
        dueOn: r.due,
      })),
    };
  }

  private async appeals(client: PoolClient, page: Page): Promise<TileBody> {
    const where = `n.status = 'order_received' AND n.appeal_due_on IS NOT NULL
                   AND n.appeal_due_on <= $1::date + ${RISK_WINDOW.appealDays}`;
    const { rows: c } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.notices n WHERE ${where}`,
      [page.today],
    );
    const { rows } = await client.query<
      EngagementCols & { id: string; reference_no: string; type_title: string; due: string }
    >(
      `SELECT ${ENGAGEMENT_COLS}, n.id, n.reference_no, nt.title AS type_title,
              n.appeal_due_on::text AS due
         FROM hsdg.notices n
         JOIN hsdg.notice_types nt ON nt.id = n.notice_type_id
         JOIN hsdg.engagements eng ON eng.id = n.engagement_id
         JOIN hsdg.entities ent ON ent.id = eng.entity_id
        WHERE ${where}
        ORDER BY n.appeal_due_on, n.id
        LIMIT $2 OFFSET $3`,
      [page.today, page.limit, page.offset],
    );
    return {
      count: c[0]!.n,
      available: true,
      items: rows.map((r) => ({
        ref: { engagementId: r.engagement_id, engagementKind: r.engagement_kind, noticeId: r.id },
        title: `Appeal · ${r.type_title} · ${r.reference_no}`,
        detail: `${r.entity_name} · order received, appeal by the limitation date`,
        dueOn: r.due,
      })),
    };
  }

  private async receivables(client: PoolClient, page: Page): Promise<TileBody> {
    const { rows: c } = await client.query<{ n: number; amount: string }>(
      `SELECT count(*)::int AS n, COALESCE(sum(i.total - i.amount_settled), 0)::text AS amount
         FROM hsdg.invoices i WHERE ${OPEN_BALANCE}`,
    );
    const { rows } = await client.query<{
      id: string;
      invoice_number: string | null;
      client_entity_id: string;
      client_name: string;
      engagement_code: string | null;
      due: string | null;
      days: number;
      balance: string;
    }>(
      `SELECT i.id, i.invoice_number, i.client_entity_id, ent.legal_name AS client_name,
              eng.engagement_code, COALESCE(i.due_date, i.issue_date)::text AS due,
              ${DAYS_PAST_DUE_SQL('i')} AS days, (i.total - i.amount_settled)::text AS balance
         FROM hsdg.invoices i
         JOIN hsdg.entity_billing_profiles ent ON ent.id = i.client_entity_id
         LEFT JOIN hsdg.engagement_billing_headers eng ON eng.id = i.engagement_id
        WHERE ${OPEN_BALANCE}
        ORDER BY i.total - i.amount_settled DESC, i.id
        LIMIT $1 OFFSET $2`,
      [page.limit, page.offset],
    );
    return {
      count: c[0]!.n,
      amount: c[0]!.amount,
      available: true,
      items: rows.map((r) => ({
        ref: null,
        href: `/billing/clients/${r.client_entity_id}`,
        title: `${r.invoice_number ?? 'Invoice'} · ${formatInr(r.balance)}`,
        detail: [r.client_name, r.engagement_code, `${r.days} days past due`]
          .filter(Boolean)
          .join(' · '),
        dueOn: r.due,
        amount: r.balance,
      })),
    };
  }

  private async unbilledTile(client: PoolClient, page: Page): Promise<TileBody> {
    const items = await this.unbilled.agedItems(client, page.today, RISK_WINDOW.unbilledDays);
    items.sort(
      (a, b) => Number(b.amount) - Number(a.amount) || a.periodEnd.localeCompare(b.periodEnd),
    );
    return {
      count: items.length,
      amount: sumAmounts(items.map((i) => i.amount)),
      available: true,
      items: items.slice(page.offset, page.offset + page.limit).map((i) => ({
        ref: null,
        href: `/billing/engagements/${i.engagementId}`,
        title: `${i.label} · ${formatInr(i.amount)}`,
        detail: [i.clientName, i.engagementCode, `ended ${i.ageDays} days ago`].join(' · '),
        dueOn: i.periodEnd,
        amount: i.amount,
      })),
    };
  }

  private async approvals(client: PoolClient, page: Page): Promise<TileBody> {
    const { rows: c } = await client.query<{ n: number; amount: string }>(
      `SELECT count(*)::int AS n, COALESCE(sum(a.amount), 0)::text AS amount
         FROM ${PENDING_ADJUSTMENTS} a
         JOIN hsdg.invoices i ON i.id = a.invoice_id`,
    );
    const { rows } = await client.query<
      EngagementCols & {
        id: string;
        kind: 'write_off' | 'credit_note';
        invoice_number: string | null;
        amount: string;
        reason: string;
        requested_on: string;
      }
    >(
      `SELECT ${ENGAGEMENT_COLS}, a.id, a.kind, i.invoice_number, a.amount::text, a.reason,
              timezone('Asia/Kolkata', a.created_at)::date::text AS requested_on
         FROM ${PENDING_ADJUSTMENTS} a
         JOIN hsdg.invoices i ON i.id = a.invoice_id
         JOIN hsdg.engagements eng ON eng.id = i.engagement_id
         JOIN hsdg.entities ent ON ent.id = eng.entity_id
        ORDER BY a.created_at, a.id
        LIMIT $1 OFFSET $2`,
      [page.limit, page.offset],
    );
    return {
      count: c[0]!.n,
      amount: c[0]!.amount,
      available: true,
      items: rows.map((r) => ({
        ref: null,
        href: '/billing/approvals',
        title: `${r.kind === 'write_off' ? 'Write off' : 'Credit note'} ${formatInr(r.amount)} on ${r.invoice_number ?? 'an invoice'}`,
        detail: `${r.entity_name} · ${r.reason}`,
        dueOn: r.requested_on,
        amount: r.amount,
      })),
    };
  }

  private async register(
    client: PoolClient,
    ctx: RlsContext,
    page: Page,
    fn: RegisterTileFn,
  ): Promise<TileBody> {
    // The registers' own switch: off, they are not in use (never a false zero).
    const got = this.flags.isOn(FEATURE_FLAG.registers) ? await fn(client, ctx, page) : null;
    if (!got) return { count: 0, items: [], available: false };
    return { count: got.count, items: got.items, available: true };
  }
}

async function istToday(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ d: string }>(
    `SELECT timezone('Asia/Kolkata', now())::date::text AS d`,
  );
  return rows[0]!.d;
}

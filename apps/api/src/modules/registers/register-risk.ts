import type { PoolClient } from 'pg';
import { UDIN_DOCUMENT_KIND_LABEL, type RegisterRiskTile } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';
import { istToday } from '../engagements/time/auto-time';
import {
  UDIN_PENDING_SQL,
  pendingItem,
  udinWindowDays,
  type PendingRow,
} from './udin-register.service';
import { DSC_AT_RISK_SQL } from './dsc-register.service';

export interface RegisterRiskOptions {
  /** IST today by default. */
  today?: string;
  /** 10 by default. */
  limit?: number;
  offset?: number;
}

/**
 * PS-301's UDIN tile: reports signed without a UDIN in the register whose
 * window (firm_settings.udin_window_days) has passed. Runs on a client already
 * inside withRlsContext, so it sees only what the caller may see.
 */
export async function udinOverdue(
  client: PoolClient,
  _ctx: RlsContext,
  opts: RegisterRiskOptions = {},
): Promise<RegisterRiskTile> {
  const windowDays = await udinWindowDays(client);
  const { rows } = await client.query<PendingRow>(
    `SELECT x.*, sp.full_name AS partner_name, count(*) OVER () AS total
       FROM (${UDIN_PENDING_SQL}) x
       LEFT JOIN hsdg.employees sp ON sp.id = x.partner_id
      WHERE x.days_left < 0
      ORDER BY x.window_ends_on, x.entity_name
      LIMIT $3 OFFSET $4`,
    [opts.today ?? istToday(), windowDays, opts.limit ?? 10, opts.offset ?? 0],
  );
  return {
    count: Number(rows[0]?.total ?? 0),
    items: rows.map((r) => {
      const p = pendingItem(r);
      return {
        ref: p.link,
        title: `${p.entityName} — ${UDIN_DOCUMENT_KIND_LABEL[p.documentKind]}${p.financialYear ? ` FY ${p.financialYear}` : ''}`,
        detail: `Signed ${p.signedOn}${p.signingPartnerName ? ` by ${p.signingPartnerName}` : ''}; no UDIN, window closed ${p.windowEndsOn}`,
        dueOn: p.windowEndsOn,
      };
    }),
    href: '/registers/udin?view=overdue',
  };
}

/**
 * PS-301's DSC tile: active tokens expiring within DSC_AT_RISK_DAYS, plus
 * those out of the office past the day they were due back. Runs on a client
 * already inside withRlsContext, so it sees only what the caller may see.
 */
export async function dscAtRisk(
  client: PoolClient,
  _ctx: RlsContext,
  opts: RegisterRiskOptions = {},
): Promise<RegisterRiskTile> {
  const { rows } = await client.query<{
    id: string;
    holder_name: string;
    entity_name: string | null;
    valid_to: string;
    days_left: number;
    overdue_return: boolean;
    out_with: string | null;
    expected_back_on: string | null;
    total: string;
  }>(
    `SELECT t.id, t.holder_name, ent.legal_name AS entity_name, t.valid_to::text,
            (t.valid_to - $1::date) AS days_left,
            (NOT t.in_office AND t.expected_back_at < now()) AS overdue_return,
            COALESCE(ow.full_name, t.out_with_name) AS out_with,
            (t.expected_back_at AT TIME ZONE 'Asia/Kolkata')::date::text AS expected_back_on,
            count(*) OVER () AS total
       FROM hsdg.dsc_tokens t
       LEFT JOIN hsdg.entities ent ON ent.id = t.entity_id
       LEFT JOIN hsdg.employees ow ON ow.id = t.out_with_employee_id
      WHERE ${DSC_AT_RISK_SQL}
      ORDER BY LEAST(t.valid_to, (t.expected_back_at AT TIME ZONE 'Asia/Kolkata')::date), t.holder_name
      LIMIT $2 OFFSET $3`,
    [opts.today ?? istToday(), opts.limit ?? 10, opts.offset ?? 0],
  );
  return {
    count: Number(rows[0]?.total ?? 0),
    items: rows.map((r) => {
      const days = Number(r.days_left);
      const expiry =
        days < 0 ? `expired ${r.valid_to}` : days === 0 ? 'expires today' : `expires ${r.valid_to}`;
      const out = r.overdue_return
        ? `; out with ${r.out_with ?? 'someone'}, due back ${r.expected_back_on}`
        : '';
      return {
        ref: { engagementId: '', engagementKind: 'compliance', dscId: r.id },
        title: `DSC — ${r.holder_name}${r.entity_name ? ` (${r.entity_name})` : ''}`,
        detail: `${expiry.charAt(0).toUpperCase()}${expiry.slice(1)}${out}`,
        dueOn:
          r.overdue_return && r.expected_back_on && r.expected_back_on < r.valid_to
            ? r.expected_back_on
            : r.valid_to,
      };
    }),
    href: '/registers/dsc?view=at_risk',
  };
}

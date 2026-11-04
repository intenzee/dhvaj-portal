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

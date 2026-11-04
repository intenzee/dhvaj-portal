import type { PoolClient } from 'pg';
import type { RiskItem } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';
import { dscAtRisk, udinOverdue } from '../registers/register-risk';

/**
 * The register tiles (PS-304 UDIN, PS-305 DSC) read through the registers'
 * own risk queries, on the dashboard's RLS-scoped client. A tile answers
 * `null` while its register is not in use: the dashboard then shows it as
 * coming, never as a false zero.
 */
export interface RegisterTileResult {
  count: number;
  items: RiskItem[];
}

export type RegisterTileFn = (
  client: PoolClient,
  ctx: RlsContext,
  opts: { today: string; limit: number; offset: number },
) => Promise<RegisterTileResult | null>;

export const udinTile: RegisterTileFn = (client, ctx, opts) => udinOverdue(client, ctx, opts);
export const dscTile: RegisterTileFn = (client, ctx, opts) => dscAtRisk(client, ctx, opts);

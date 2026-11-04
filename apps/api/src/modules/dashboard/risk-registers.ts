import type { PoolClient } from 'pg';
import type { RiskItem } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';

/**
 * The register tiles (PS-304 UDIN, PS-305 DSC) read through the registers'
 * own risk queries. Until a register is in this build its tile says so
 * (`null`): the dashboard shows it as coming, never as a false zero.
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

export const udinTile: RegisterTileFn = async () => null;
export const dscTile: RegisterTileFn = async () => null;

import type { PoolClient } from 'pg';
import { ROLE, toFirmChecks, type FirmCheckKey, type FirmChecks } from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';

/**
 * The firm's checks (Admin → Workflow → Checks), read once per request.
 * While a check is off the service lets the work through and warns instead.
 */
export async function firmChecks(client: PoolClient): Promise<FirmChecks> {
  const { rows } = await client.query<{ strict_checks: Record<string, unknown> | null }>(
    `SELECT strict_checks FROM hsdg.firm_settings LIMIT 1`,
  );
  return toFirmChecks(rows[0]?.strict_checks);
}

/** Whether a check is on. */
export function isStrict(checks: FirmChecks, key: FirmCheckKey): boolean {
  return checks[key] === true;
}

/** Only the managing partner or the administrator switches checks. */
export function canSwitchChecks(ctx: Pick<RlsContext, 'role' | 'roles'>): boolean {
  const mine = new Set([ctx.role, ...(ctx.roles ?? [])]);
  return mine.has(ROLE.managingPartner) || mine.has(ROLE.admin);
}

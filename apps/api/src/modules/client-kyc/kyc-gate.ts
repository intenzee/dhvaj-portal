import type { PoolClient } from 'pg';
import { kycEffectiveStatus, type KycGate, type KycStatus } from '@hsdg/contracts';

/** The client's KYC status today and the firm's gate (PS-404). Runs on the caller's RLS client. */
export async function kycStatusFor(
  client: PoolClient,
  entityId: string,
  today: string,
): Promise<{ status: KycStatus; gate: KycGate }> {
  const { rows } = await client.query<{
    status: 'pending' | 'complete' | null;
    next_review_on: string | null;
    gate: KycGate | null;
  }>(
    `SELECT k.status, k.next_review_on::text AS next_review_on,
            (SELECT kyc_gate FROM hsdg.firm_settings LIMIT 1) AS gate
       FROM (SELECT 1) one
       LEFT JOIN hsdg.client_kyc k ON k.entity_id = $1`,
    [entityId],
  );
  const r = rows[0];
  return {
    status: kycEffectiveStatus(r?.status ?? null, r?.next_review_on ?? null, today),
    gate: r?.gate ?? 'warn',
  };
}

/** The effective status in SQL, for a client_kyc row aliased `k` and today as `$today`. */
export const KYC_STATUS_SQL = (today: string) => `CASE
  WHEN k.status = 'complete' AND k.next_review_on > ${today} THEN 'complete'
  WHEN k.status = 'complete' THEN 'expired'
  ELSE 'pending' END`;

'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { FEATURE_FLAG, ROLE, type EngagementKind } from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { hasRole } from '@/lib/principal';
import { clientKycKey, fetchClientKyc } from '@/lib/client-kyc-api';
import { Field, Textarea } from '@/components/form';

export interface KycGateState {
  /** Show the notice. */
  show: boolean;
  /** The firm requires KYC and the caller cannot go ahead (not a partner). */
  blocked: boolean;
  /** The firm requires KYC and a partner must give a reason. */
  needsReason: boolean;
}

/**
 * PS-404 · whether a new engagement meets the firm's KYC gate: only for
 * compliance and assignment work (statutory audit has its own acceptance),
 * only while ff_client_kyc is on. The API checks the same and has the last word.
 */
export function useKycGate(entityId: string | undefined, kind: EngagementKind | null) {
  const { isOn } = useFeatureFlags();
  const { principal } = useAuth();
  const applies =
    !!entityId && (kind === 'compliance' || kind === 'assignment') && isOn(FEATURE_FLAG.clientKyc);
  const kyc = useQuery({
    queryKey: clientKycKey(entityId ?? ''),
    queryFn: () => fetchClientKyc(entityId!),
    enabled: applies,
  });
  const k = applies ? kyc.data : undefined;
  const open = !!k && k.status !== 'complete' && k.settings.gate !== 'off';
  const require = open && k!.settings.gate === 'require';
  const partner = hasRole(principal, ROLE.partner, ROLE.managingPartner);
  const state: KycGateState = {
    show: open,
    blocked: require && !partner,
    needsReason: require && partner,
  };
  return { kyc: k, state };
}

export function KycNotice({
  entityId,
  status,
  state,
  reason,
  onReason,
}: {
  entityId: string;
  status: 'pending' | 'expired' | 'complete';
  state: KycGateState;
  reason: string;
  onReason: (v: string) => void;
}): JSX.Element | null {
  if (!state.show) return null;
  const what = status === 'expired' ? 'is due for review' : 'is not complete';
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800"
    >
      <p className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          This client&rsquo;s KYC {what}.{' '}
          <Link href={`/entities/${entityId}`} className="font-medium underline" target="_blank">
            Open the client
          </Link>{' '}
          to collect it.
          {state.blocked && ' The firm requires KYC first — ask a partner to open this engagement.'}
          {!state.blocked &&
            !state.needsReason &&
            ' You can still create the engagement; it is noted.'}
        </span>
      </p>
      {state.needsReason && (
        <Field label="Reason to go ahead without KYC" required hint="Recorded in the audit trail.">
          <Textarea
            value={reason}
            maxLength={1000}
            onChange={(e) => onReason(e.target.value)}
            placeholder="e.g. Documents promised by Friday; urgent filing"
          />
        </Field>
      )}
    </div>
  );
}

import {
  FEATURE_FLAG,
  GST_STATES,
  PERMISSION,
  type BillingSettings,
  type InvoiceRecord,
} from '@hsdg/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';

/** PS-201: a draft has no number until it is issued. Pure — tested. */
export function invoiceNumberLabel(inv: Pick<InvoiceRecord, 'invoiceNumber'>): string {
  return inv.invoiceNumber ?? 'Draft (numbered at issue)';
}

/** 'Delhi (07)'; '—' when unknown. Pure — tested. */
export function stateLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return GST_STATES[code] ? `${GST_STATES[code]} (${code})` : code;
}

/**
 * The tax lines under an invoice's subtotal: CGST + SGST or IGST once the
 * firm's GST state is set, else the single hand-entered tax. Pure — tested.
 */
export function taxRows(
  inv: Pick<InvoiceRecord, 'cgst' | 'sgst' | 'igst' | 'taxAmount' | 'isReverseCharge'>,
): { label: string; amount: string }[] {
  const split = Number(inv.cgst) + Number(inv.sgst) + Number(inv.igst) > 0;
  if (!split) return [{ label: 'Tax', amount: inv.taxAmount }];
  const suffix = inv.isReverseCharge ? ' (reverse charge, payable by the client)' : '';
  return Number(inv.igst) > 0
    ? [{ label: `IGST${suffix}`, amount: inv.igst }]
    : [
        { label: `CGST${suffix}`, amount: inv.cgst },
        { label: `SGST${suffix}`, amount: inv.sgst },
      ];
}

/** Who may do what to an invoice, by permission. Pure — tested. */
export function invoiceActions(
  inv: Pick<InvoiceRecord, 'status'>,
  permissions: readonly string[],
): { issue: boolean; voidDraft: boolean; voidIssued: boolean; markPaid: boolean } {
  const has = (p: string): boolean => permissions.includes(p);
  return {
    issue: inv.status === 'draft' && has(PERMISSION.billingManage),
    voidDraft: inv.status === 'draft',
    voidIssued: inv.status === 'issued' && has(PERMISSION.billingApprove),
    markPaid: inv.status === 'issued',
  };
}

export const billingSettingsQuery = {
  queryKey: ['billing', 'settings'] as const,
  queryFn: () => apiFetch<BillingSettings>('/billing/settings'),
};

/**
 * The firm's billing settings while ff_billing_v2 is on; `gstMode` is true
 * once the firm's GST state is set, when tax comes from each line's rate.
 */
export function useBillingSettings(): { settings: BillingSettings | undefined; gstMode: boolean } {
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.billing);
  const q = useQuery({ ...billingSettingsQuery, enabled: on });
  const settings = on ? q.data : undefined;
  return { settings, gstMode: !!settings?.stateCode };
}

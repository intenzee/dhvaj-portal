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
  // No GST charged: no tax line at all (not a "Tax ₹0.00").
  if (!split) return Number(inv.taxAmount) > 0 ? [{ label: 'Tax', amount: inv.taxAmount }] : [];
  const suffix = inv.isReverseCharge ? ' (reverse charge, payable by the client)' : '';
  return Number(inv.igst) > 0
    ? [{ label: `IGST${suffix}`, amount: inv.igst }]
    : [
        { label: `CGST${suffix}`, amount: inv.cgst },
        { label: `SGST${suffix}`, amount: inv.sgst },
      ];
}

/** '18%' beside a line's SAC; '' when no GST is charged on it. Pure — tested. */
export function lineRateLabel(gstRate: string | number | null | undefined): string {
  const r = Number(gstRate ?? 0);
  return r > 0 ? `${r}%` : '';
}

/**
 * Who may do what to an invoice, by permission. With receipts (ff_billing_v2)
 * payment is recorded as a receipt, not marked by hand. Anyone who bills may
 * edit or delete an invoice until money, a credit note or a filed GSTR-1 is
 * against it (editBlockedReason). Pure — tested.
 */
export function invoiceActions(
  inv: Pick<InvoiceRecord, 'status'> & { editBlockedReason?: string | null },
  permissions: readonly string[],
  receipts = false,
): {
  issue: boolean;
  voidDraft: boolean;
  voidIssued: boolean;
  markPaid: boolean;
  recordReceipt: boolean;
  edit: boolean;
  remove: boolean;
} {
  const has = (p: string): boolean => permissions.includes(p);
  const open = inv.status === 'issued' || inv.status === 'partially_paid';
  const bills = has(PERMISSION.billingManage) || has(PERMISSION.engagementManage);
  const changeable = inv.status === 'draft' || (inv.status === 'issued' && !inv.editBlockedReason);
  return {
    edit: bills && changeable,
    remove: bills && inv.status === 'issued' && !inv.editBlockedReason,
    issue: inv.status === 'draft' && has(PERMISSION.billingManage),
    voidDraft: inv.status === 'draft',
    voidIssued: inv.status === 'issued' && has(PERMISSION.billingApprove),
    markPaid: inv.status === 'issued' && !receipts,
    recordReceipt: open && receipts && has(PERMISSION.billingManage),
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

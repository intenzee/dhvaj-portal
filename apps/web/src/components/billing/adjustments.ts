import {
  creditNoteSplit,
  fromPaise,
  toPaise,
  type AdjustmentKind,
  type AdjustmentStatus,
  type InvoiceDetail,
} from '@hsdg/contracts';

/** "Write-off" / "Credit note". */
export function adjustmentKindLabel(kind: AdjustmentKind): string {
  return kind === 'write_off' ? 'Write-off' : 'Credit note';
}

export function adjustmentStatusLabel(status: AdjustmentStatus): string {
  switch (status) {
    case 'pending':
      return 'Waiting for a partner';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    default:
      return 'Void';
  }
}

/** The invoice's highest line rate — a credit note's default. */
export function topGstRate(lines: Pick<InvoiceDetail['lines'][number], 'gstRate'>[]): number {
  return lines.reduce((m, l) => Math.max(m, Number(l.gstRate) || 0), 0);
}

/**
 * What a request would take off the invoice, or why it cannot be sent: a
 * write-off is its amount; a credit note adds GST as the invoice charged it
 * (none when it charged none). Never more than the balance. Pure — tested.
 */
export function adjustmentPreview(
  kind: AdjustmentKind,
  amount: string,
  invoice: Pick<
    InvoiceDetail,
    'balance' | 'cgst' | 'sgst' | 'igst' | 'placeOfSupplyState' | 'isReverseCharge'
  >,
  gst: { firmState: string | null; rate: number },
):
  | { ok: true; taxable: string; cgst: string; sgst: string; igst: string; total: string }
  | { ok: false; error: string } {
  let paise: bigint;
  try {
    paise = toPaise(amount.trim());
  } catch {
    return { ok: false, error: 'Enter an amount.' };
  }
  if (paise <= 0n) return { ok: false, error: 'Enter an amount.' };
  const taxable = fromPaise(paise);
  const charged =
    kind === 'credit_note' &&
    !invoice.isReverseCharge &&
    toPaise(invoice.cgst) + toPaise(invoice.sgst) + toPaise(invoice.igst) > 0n;
  const split = creditNoteSplit(taxable, gst.rate, {
    firmState: gst.firmState,
    placeOfSupply: invoice.placeOfSupplyState,
    charged,
  });
  if (toPaise(split.total) > toPaise(invoice.balance)) {
    return { ok: false, error: `More than the ${invoice.balance} still owed.` };
  }
  return { ok: true, taxable, ...split };
}

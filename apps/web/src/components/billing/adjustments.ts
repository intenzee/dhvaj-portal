import {
  creditNoteLines,
  creditNoteSplit,
  fromPaise,
  toPaise,
  type AdjustmentKind,
  type AdjustmentStatus,
  type CreditNoteLine,
  type InvoiceAdjustment,
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

/** Before tax, what pending and approved credit notes already take off each invoice line. Pure — tested. */
export function creditedByLine(adjustments: readonly InvoiceAdjustment[]): Map<string, string> {
  const paise = new Map<string, bigint>();
  for (const a of adjustments) {
    if (a.kind !== 'credit_note' || (a.status !== 'pending' && a.status !== 'approved')) continue;
    for (const l of a.lines) {
      paise.set(l.invoiceLineId, (paise.get(l.invoiceLineId) ?? 0n) + toPaise(l.taxableValue));
    }
  }
  return new Map([...paise].map(([id, p]) => [id, fromPaise(p)]));
}

/**
 * A credit note over the invoice's lines — `amounts` by line id, blanks left
 * out — each line taxed at its own rate as the API will (creditNoteLines),
 * and never more than the balance. Pure — tested.
 */
export function creditNotePreview(
  amounts: Record<string, string>,
  invoice: Pick<
    InvoiceDetail,
    'balance' | 'cgst' | 'sgst' | 'igst' | 'placeOfSupplyState' | 'isReverseCharge' | 'lines'
  >,
  firmState: string | null,
  credited: Map<string, string>,
):
  | { ok: true; lines: CreditNoteLine[]; taxable: string; total: string }
  | { ok: false; error: string } {
  const asked = invoice.lines
    .filter((l) => (amounts[l.id] ?? '').trim() !== '')
    .map((l) => ({ invoiceLineId: l.id, taxableValue: amounts[l.id]!.trim() }));
  const r = creditNoteLines(
    asked,
    invoice.lines.map((l) => ({
      id: l.id,
      description: l.description,
      taxableValue: l.taxableValue,
      gstRate: l.gstRate,
      credited: credited.get(l.id) ?? '0',
    })),
    {
      firmState,
      placeOfSupply: invoice.placeOfSupplyState,
      charged:
        !invoice.isReverseCharge &&
        toPaise(invoice.cgst) + toPaise(invoice.sgst) + toPaise(invoice.igst) > 0n,
    },
  );
  if (!r.ok) return r;
  if (toPaise(r.total) > toPaise(invoice.balance)) {
    return { ok: false, error: `More than the ${invoice.balance} still owed.` };
  }
  return { ok: true, lines: r.lines, taxable: r.taxableValue, total: r.total };
}

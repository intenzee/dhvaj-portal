import {
  creditNoteLines,
  creditNoteSplit,
  fromPaise,
  toPaise,
  type AdjustmentKind,
  type AdjustmentStatus,
  type CreditableLine,
  type CreditNoteLine,
  type InvoiceAdjustment,
  type InvoiceDetail,
} from '@hsdg/contracts';
import { formatDate } from '@/lib/format';

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
 * Whether this person may void a credit note: an approved one on a live
 * invoice, with billing.approve, and not the one who asked for it (the API
 * also refuses once its GST return is filed). Pure — tested.
 */
export function mayVoidCreditNote(
  a: Pick<InvoiceAdjustment, 'kind' | 'status' | 'requestedById'>,
  me: { employeeId: string | null; canApprove: boolean },
  invoiceStatus: string,
): boolean {
  return (
    a.kind === 'credit_note' &&
    a.status === 'approved' &&
    invoiceStatus !== 'void' &&
    me.canApprove &&
    (me.employeeId === null || a.requestedById !== me.employeeId)
  );
}

/** "Voided by Asha Rao, 20 Oct 2026: raised against the wrong invoice". */
export function voidLine(
  a: Pick<InvoiceAdjustment, 'voidedByName' | 'voidedAt' | 'voidReason'>,
): string {
  const who = [a.voidedByName, a.voidedAt ? formatDate(a.voidedAt) : null].filter(Boolean);
  return `Voided${who.length ? ` by ${who.join(', ')}` : ''}${a.voidReason ? `: ${a.voidReason}` : ''}`;
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

/** What pending and approved credit notes already take off an invoice line, and the GST they reverse. */
export type CreditedSoFar = Pick<
  CreditableLine,
  'credited' | 'creditedCgst' | 'creditedSgst' | 'creditedIgst'
>;

/** CreditedSoFar for each invoice line. Pure — tested. */
export function creditedByLine(
  adjustments: readonly InvoiceAdjustment[],
): Map<string, CreditedSoFar> {
  const sums = new Map<string, [bigint, bigint, bigint, bigint]>();
  for (const a of adjustments) {
    if (a.kind !== 'credit_note' || (a.status !== 'pending' && a.status !== 'approved')) continue;
    for (const l of a.lines) {
      const [v, c, s, i] = sums.get(l.invoiceLineId) ?? [0n, 0n, 0n, 0n];
      sums.set(l.invoiceLineId, [
        v + toPaise(l.taxableValue),
        c + toPaise(l.cgst ?? '0'),
        s + toPaise(l.sgst ?? '0'),
        i + toPaise(l.igst ?? '0'),
      ]);
    }
  }
  return new Map(
    [...sums].map(([id, [v, c, s, i]]) => [
      id,
      {
        credited: fromPaise(v),
        creditedCgst: fromPaise(c),
        creditedSgst: fromPaise(s),
        creditedIgst: fromPaise(i),
      },
    ]),
  );
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
  credited: Map<string, CreditedSoFar>,
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
      credited: '0',
      creditedCgst: '0',
      creditedSgst: '0',
      creditedIgst: '0',
      ...credited.get(l.id),
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

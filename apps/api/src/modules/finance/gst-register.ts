import {
  B2CL_THRESHOLD,
  fromPaise,
  gstSplit,
  toPaise,
  type GstB2bInvoice,
  type GstB2clInvoice,
  type GstB2csRow,
  type GstDocNature,
  type GstDocSeries,
  type GstHsnRow,
  type GstNote,
  type GstOutwardRegister,
  type GstRegisterItem,
  type GstRegisterWarning,
  type GstTotals,
} from '@hsdg/contracts';

/**
 * Phase 2c · the firm's GST outward register for a month, in the GSTR-1
 * layout. Pure: the service reads the rows, this files them. Tax per rate is
 * worked as the invoice worked it (gstSplit on the lines), so the register
 * ties to the invoices; the tie-out says where an invoice's stored tax
 * differs from its lines.
 */

export interface RegisterLine {
  sac: string | null;
  rate: string;
  taxable: string;
}

export interface RegisterInvoice {
  id: string;
  number: string;
  issueDate: string;
  status: string;
  /** IST date it was voided; null when live. */
  voidedOn: string | null;
  clientGstin: string | null;
  clientName: string;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  subtotal: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  lines: RegisterLine[];
}

export interface RegisterCreditNote {
  id: string;
  number: string;
  date: string;
  status: string;
  voidedOn: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceTotal: string;
  clientGstin: string | null;
  clientName: string;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  /** The lines' one rate; null when they differ. */
  rate: string | null;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  /** SAC for a note without lines: its invoice's main line. */
  sac: string | null;
  /** The invoice lines it reduces, each at that line's rate (notes since PS-205). */
  lines: RegisterCreditNoteLine[];
}

export interface RegisterCreditNoteLine {
  sac: string | null;
  rate: string;
  taxable: string;
  igst: string;
  cgst: string;
  sgst: string;
}

/** An invoice issued in an earlier month and voided in this one. */
export interface VoidedFromEarlier {
  id: string;
  number: string;
  issueDate: string;
  voidedOn: string;
}

export interface RegisterInput {
  month: string;
  firmGstin: string | null;
  firmState: string | null;
  filedThrough: string | null;
  sacDefault: string | null;
  invoices: RegisterInvoice[];
  creditNotes: RegisterCreditNote[];
  voidedFromEarlier: VoidedFromEarlier[];
}

interface Tax {
  taxable: bigint;
  igst: bigint;
  cgst: bigint;
  sgst: bigint;
}

const ZERO = (): Tax => ({ taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n });

function add(into: Tax, t: Tax, sign = 1n): void {
  into.taxable += sign * t.taxable;
  into.igst += sign * t.igst;
  into.cgst += sign * t.cgst;
  into.sgst += sign * t.sgst;
}

function totals(t: Tax): GstTotals {
  return {
    taxable: fromPaise(t.taxable),
    igst: fromPaise(t.igst),
    cgst: fromPaise(t.cgst),
    sgst: fromPaise(t.sgst),
    total: fromPaise(t.taxable + t.igst + t.cgst + t.sgst),
  };
}

function item(rate: string, t: Tax): GstRegisterItem {
  return {
    rate,
    taxable: fromPaise(t.taxable),
    igst: fromPaise(t.igst),
    cgst: fromPaise(t.cgst),
    sgst: fromPaise(t.sgst),
    cess: '0.00',
  };
}

function itemTax(i: GstRegisterItem): Tax {
  return {
    taxable: toPaise(i.taxable),
    igst: toPaise(i.igst),
    cgst: toPaise(i.cgst),
    sgst: toPaise(i.sgst),
  };
}

/** '18.00' / '18' → '18'; '2.50' → '2.5'. */
export function normRate(rate: string): string {
  return fromPaise(toPaise(rate)).replace(/\.?0+$/, '') || '0';
}

/** The last day of 'YYYY-MM'. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/** a × part / whole rounded half up; whole > 0, signs carried by a. */
function share(a: bigint, part: bigint, whole: bigint): bigint {
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const v = (abs * part * 2n + whole) / (2n * whole);
  return neg ? -v : v;
}

/** 'INV/26-27/0007' → ['INV/26-27/', 7]. */
export function seriesOf(number: string): { series: string; seq: number } {
  const m = /^(.*?)(\d+)$/.exec(number);
  if (!m) return { series: number, seq: 0 };
  return { series: m[1]!, seq: Number(m[2]) };
}

export function buildGstRegister(input: RegisterInput): GstOutwardRegister {
  const end = monthEnd(input.month);
  const firmState = input.firmState;
  const warnings: GstRegisterWarning[] = [];
  const warn = (
    code: GstRegisterWarning['code'],
    message: string,
    ref: string | null = null,
  ): void => {
    warnings.push({ code, message, ref });
  };
  if (!input.firmGstin) {
    warn('no_firm_gstin', "The firm's GSTIN is not set in the billing settings.");
  }

  const b2b: GstB2bInvoice[] = [];
  const b2cl: GstB2clInvoice[] = [];
  const b2cs = new Map<
    string,
    { row: Omit<GstB2csRow, 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess'>; tax: Tax }
  >();
  const cdnr: GstNote[] = [];
  const cdnur: GstNote[] = [];
  const hsn = {
    b2b: new Map<string, { sac: string; rate: string; tax: Tax }>(),
    b2c: new Map<string, { sac: string; rate: string; tax: Tax }>(),
  };
  const portalInv = ZERO();
  const registerInv = ZERO();
  const portalCn = ZERO();
  const registerCn = ZERO();

  const posOf = (pos: string | null, ref: string, label: string): string => {
    if (pos) return pos;
    warn(
      'no_place_of_supply',
      `${label} has no place of supply; taken as the firm's state${firmState ? ` (${firmState})` : ''}.`,
      ref,
    );
    return firmState ?? '';
  };
  const isInter = (pos: string): boolean => !!firmState && !!pos && pos !== firmState;
  const sacOf = (sac: string | null, ref: string, label: string): string => {
    if (sac) return sac;
    if (input.sacDefault) return input.sacDefault;
    warn('no_sac', `${label} has a line with no SAC.`, ref);
    return '';
  };
  const addB2cs = (pos: string, rate: string, t: Tax, sign = 1n): void => {
    const supplyType = isInter(pos) ? 'INTER' : 'INTRA';
    const key = `${supplyType}|${pos}|${rate}`;
    const cur = b2cs.get(key) ?? { row: { supplyType, placeOfSupply: pos, rate }, tax: ZERO() };
    add(cur.tax, t, sign);
    b2cs.set(key, cur);
  };
  const addHsn = (tab: 'b2b' | 'b2c', sac: string, rate: string, t: Tax, sign = 1n): void => {
    const key = `${sac}|${rate}`;
    const cur = hsn[tab].get(key) ?? { sac, rate, tax: ZERO() };
    add(cur.tax, t, sign);
    hsn[tab].set(key, cur);
  };

  // ── Invoices ──
  const docRows: { nature: GstDocNature; number: string; cancelled: boolean }[] = [];
  for (const inv of input.invoices) {
    const cancelled = inv.status === 'void' && !!inv.voidedOn && inv.voidedOn <= end;
    docRows.push({ nature: 'invoices', number: inv.number, cancelled });
    if (cancelled) continue;
    const label = `Invoice ${inv.number}`;
    if (inv.status === 'void') {
      warn(
        'voided_after_month',
        `${label} was voided on ${inv.voidedOn ?? 'a later day'}, after this month; it stays in this month's return. Report a credit note or an amendment in the month it was voided.`,
        inv.id,
      );
    }
    const pos = posOf(inv.placeOfSupply, inv.id, label);
    const split = gstSplit(
      inv.lines.map((l) => ({ taxableValue: l.taxable, gstRate: l.rate })),
      firmState,
      pos || null,
    );
    const items = split.byRate.map((b) =>
      item(b.rate, {
        taxable: toPaise(b.taxable),
        igst: toPaise(b.igst),
        cgst: toPaise(b.cgst),
        sgst: toPaise(b.sgst),
      }),
    );
    const stored: Tax = {
      taxable: toPaise(inv.subtotal),
      igst: toPaise(inv.igst),
      cgst: toPaise(inv.cgst),
      sgst: toPaise(inv.sgst),
    };
    add(portalInv, stored);
    const fromLines = ZERO();
    for (const i of items) add(fromLines, itemTax(i));
    add(registerInv, fromLines);
    if (
      !inv.reverseCharge &&
      (fromLines.taxable !== stored.taxable ||
        fromLines.igst !== stored.igst ||
        fromLines.cgst !== stored.cgst ||
        fromLines.sgst !== stored.sgst)
    ) {
      warn(
        'tax_differs_from_lines',
        `${label}: the tax on the invoice (${fromPaise(stored.igst + stored.cgst + stored.sgst)}) is not what its lines' rates give (${fromPaise(fromLines.igst + fromLines.cgst + fromLines.sgst)}). The register uses the lines; check the invoice before filing.`,
        inv.id,
      );
    }

    const registered = !!inv.clientGstin;
    if (registered) {
      b2b.push({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        invoiceDate: inv.issueDate,
        clientGstin: inv.clientGstin!,
        clientName: inv.clientName,
        placeOfSupply: pos,
        reverseCharge: inv.reverseCharge,
        invoiceValue: inv.total,
        items,
      });
    } else if (isInter(pos) && toPaise(inv.total) > toPaise(B2CL_THRESHOLD)) {
      b2cl.push({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        invoiceDate: inv.issueDate,
        clientName: inv.clientName,
        placeOfSupply: pos,
        invoiceValue: inv.total,
        items,
      });
    } else {
      for (const i of items) addB2cs(pos, i.rate, itemTax(i));
    }

    // HSN: each rate's tax shared across its SACs by taxable value.
    const tab = registered ? 'b2b' : 'b2c';
    for (const i of items) {
      const band = itemTax(i);
      const bySac = new Map<string, bigint>();
      for (const l of inv.lines) {
        if (normRate(l.rate) !== i.rate) continue;
        const sac = sacOf(l.sac, inv.id, label);
        bySac.set(sac, (bySac.get(sac) ?? 0n) + toPaise(l.taxable));
      }
      const groups = [...bySac].sort((a, b) => a[0].localeCompare(b[0]));
      const left = { ...band };
      groups.forEach(([sac, taxable], idx) => {
        const last = idx === groups.length - 1;
        const part: Tax =
          last || band.taxable === 0n
            ? { ...left }
            : {
                taxable,
                igst: share(band.igst, taxable, band.taxable),
                cgst: share(band.cgst, taxable, band.taxable),
                sgst: share(band.sgst, taxable, band.taxable),
              };
        if (!last && band.taxable === 0n) return;
        add(left, part, -1n);
        addHsn(tab, sac, i.rate, part);
      });
    }
  }

  // ── Credit notes ──
  for (const cn of input.creditNotes) {
    const cancelled = cn.status === 'void' && !!cn.voidedOn && cn.voidedOn <= end;
    docRows.push({ nature: 'credit_notes', number: cn.number, cancelled });
    if (cancelled) continue;
    const label = `Credit note ${cn.number}`;
    if (cn.status === 'void') {
      warn(
        'voided_after_month',
        `${label} was voided on ${cn.voidedOn ?? 'a later day'}, after this month; it stays in this month's return.`,
        cn.id,
      );
    }
    const pos = posOf(cn.placeOfSupply, cn.id, label);
    const t: Tax = {
      taxable: toPaise(cn.taxable),
      igst: toPaise(cn.igst),
      cgst: toPaise(cn.cgst),
      sgst: toPaise(cn.sgst),
    };
    add(portalCn, t);
    // Each line at its own rate; a note from before lines is one part at its rate.
    const parts: RegisterCreditNoteLine[] = cn.lines.length
      ? cn.lines
      : [
          {
            sac: cn.sac,
            rate: cn.rate ?? '0',
            taxable: cn.taxable,
            igst: cn.igst,
            cgst: cn.cgst,
            sgst: cn.sgst,
          },
        ];
    const byRate = new Map<string, Tax>();
    const noteTax = ZERO();
    const hsnParts: { sac: string; rate: string; tax: Tax }[] = [];
    for (const l of parts) {
      const lt: Tax = {
        taxable: toPaise(l.taxable),
        igst: toPaise(l.igst),
        cgst: toPaise(l.cgst),
        sgst: toPaise(l.sgst),
      };
      const rate = normRate(l.rate);
      const cur = byRate.get(rate) ?? ZERO();
      add(cur, lt);
      byRate.set(rate, cur);
      add(noteTax, lt);
      hsnParts.push({ sac: sacOf(l.sac ?? cn.sac, cn.id, label), rate, tax: lt });
    }
    add(registerCn, noteTax);
    if (
      noteTax.taxable !== t.taxable ||
      noteTax.igst !== t.igst ||
      noteTax.cgst !== t.cgst ||
      noteTax.sgst !== t.sgst
    ) {
      warn(
        'tax_differs_from_lines',
        `${label}: its total differs from the sum of its lines.`,
        cn.id,
      );
    }
    const rates = [...byRate.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
    const note: GstNote = {
      creditNoteId: cn.id,
      noteNumber: cn.number,
      noteDate: cn.date,
      invoiceNumber: cn.invoiceNumber,
      invoiceDate: cn.invoiceDate,
      clientGstin: cn.clientGstin,
      clientName: cn.clientName,
      placeOfSupply: pos,
      reverseCharge: cn.reverseCharge,
      noteValue: cn.total,
      items: rates.map(([rate, rt]) => item(rate, rt)),
    };
    const tab = cn.clientGstin ? 'b2b' : 'b2c';
    if (cn.clientGstin) {
      cdnr.push(note);
    } else if (isInter(pos) && toPaise(cn.invoiceTotal) > toPaise(B2CL_THRESHOLD)) {
      cdnur.push(note);
    } else {
      for (const [rate, rt] of rates) addB2cs(pos, rate, rt, -1n);
    }
    for (const h of hsnParts) addHsn(tab, h.sac, h.rate, h.tax, -1n);
  }

  for (const v of input.voidedFromEarlier) {
    warn(
      'voided_from_earlier_month',
      `Invoice ${v.number} of ${v.issueDate} was voided on ${v.voidedOn}. If its month's GSTR-1 is filed, report a credit note or an amendment.`,
      v.id,
    );
  }

  // ── Documents issued ──
  const docs: GstDocSeries[] = [];
  const bySeries = new Map<
    string,
    {
      nature: GstDocNature;
      series: string;
      rows: { seq: number; number: string; cancelled: boolean }[];
    }
  >();
  for (const d of docRows) {
    const { series, seq } = seriesOf(d.number);
    const key = `${d.nature}|${series}`;
    const cur = bySeries.get(key) ?? { nature: d.nature, series, rows: [] };
    cur.rows.push({ seq, number: d.number, cancelled: d.cancelled });
    bySeries.set(key, cur);
  }
  for (const s of [...bySeries.values()].sort((a, b) =>
    a.nature === b.nature ? a.series.localeCompare(b.series) : a.nature === 'invoices' ? -1 : 1,
  )) {
    const rows = s.rows.sort((a, b) => a.seq - b.seq);
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const cancelled = rows.filter((r) => r.cancelled).length;
    docs.push({
      nature: s.nature,
      series: s.series,
      from: first.number,
      to: last.number,
      total: rows.length,
      cancelled,
      netIssued: rows.length - cancelled,
    });
    const span = last.seq - first.seq + 1;
    if (span !== rows.length) {
      warn(
        'number_gap',
        `${first.number} to ${last.number} spans ${span} numbers but ${rows.length} are dated this month; the rest are dated in another month.`,
      );
    }
  }

  const b2csRows: GstB2csRow[] = [...b2cs.values()]
    .map(({ row, tax }) => ({ ...row, ...item(row.rate, tax) }))
    .sort(
      (a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || Number(b.rate) - Number(a.rate),
    );
  for (const r of b2csRows) {
    if (toPaise(r.taxable) < 0n) {
      warn(
        'b2cs_negative',
        `B2CS for state ${r.placeOfSupply} at ${r.rate}% is negative: this month's credit notes exceed its sales there.`,
      );
    }
  }
  const hsnRows = (m: Map<string, { sac: string; rate: string; tax: Tax }>): GstHsnRow[] =>
    [...m.values()]
      .sort((a, b) => a.sac.localeCompare(b.sac) || Number(b.rate) - Number(a.rate))
      .map(({ sac, rate, tax }) => ({
        sac,
        uqc: 'NA' as const,
        quantity: '0',
        ...item(rate, tax),
        totalValue: fromPaise(tax.taxable + tax.igst + tax.cgst + tax.sgst),
      }));

  const inv = { portal: totals(portalInv), register: totals(registerInv) };
  const cn = { portal: totals(portalCn), register: totals(registerCn) };
  const same = (a: GstTotals, b: GstTotals): boolean =>
    a.taxable === b.taxable && a.igst === b.igst && a.cgst === b.cgst && a.sgst === b.sgst;

  return {
    month: input.month,
    firmGstin: input.firmGstin,
    firmState,
    filed: !!input.filedThrough && input.filedThrough >= end,
    b2b: b2b.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
    b2cl: b2cl.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
    b2cs: b2csRows,
    cdnr: cdnr.sort((a, b) => a.noteNumber.localeCompare(b.noteNumber)),
    cdnur: cdnur.sort((a, b) => a.noteNumber.localeCompare(b.noteNumber)),
    hsnB2b: hsnRows(hsn.b2b),
    hsnB2c: hsnRows(hsn.b2c),
    docs,
    tieOut: {
      invoices: inv,
      creditNotes: cn,
      ok: same(inv.portal, inv.register) && same(cn.portal, cn.register),
    },
    warnings,
  };
}

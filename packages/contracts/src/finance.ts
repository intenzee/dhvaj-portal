/**
 * Accountant role, phase 2c (spec docs/accountant-hr-roles-spec.md §3.7):
 * Reports → Finance. The firm's GST outward register for a month in the
 * GSTR-1 layout, the books export (Tally vouchers or a journal CSV) with a
 * "last exported" marker, and the bank statement match. Amounts are rupee
 * strings with two decimals, as in billing; months are 'YYYY-MM' (IST).
 */

// ── GST outward register (GSTR-1) ───────────────────────────────────────

/**
 * B2CL: an inter-state invoice to an unregistered person above this value
 * (₹1 lakh from 1 Aug 2024, Notification 12/2024-CT). Below it, B2CS.
 */
export const B2CL_THRESHOLD = '100000.00';

/** One rate on an invoice or note: GSTR-1 reports items by rate. */
export interface GstRegisterItem {
  rate: string;
  taxable: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
}

/** Table 4A: an invoice to a registered client. */
export interface GstB2bInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  clientGstin: string;
  clientName: string;
  /** Two-digit state code. */
  placeOfSupply: string;
  reverseCharge: boolean;
  invoiceValue: string;
  items: GstRegisterItem[];
}

/** Table 5: an inter-state invoice to an unregistered person above B2CL_THRESHOLD. */
export interface GstB2clInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  clientName: string;
  placeOfSupply: string;
  invoiceValue: string;
  items: GstRegisterItem[];
}

/** Table 7: everything else to unregistered persons, by state and rate, net of its credit notes. */
export interface GstB2csRow {
  supplyType: 'INTRA' | 'INTER';
  placeOfSupply: string;
  rate: string;
  taxable: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
}

/** Table 9B: a credit note (CDNR to a registered client; CDNUR against a B2CL invoice). */
export interface GstNote {
  creditNoteId: string;
  noteNumber: string;
  noteDate: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  clientGstin: string | null;
  clientName: string;
  placeOfSupply: string;
  reverseCharge: boolean;
  noteValue: string;
  items: GstRegisterItem[];
}

/** Table 12: by SAC and rate. Services: UQC 'NA', quantity 0. Net of credit notes. */
export interface GstHsnRow {
  sac: string;
  uqc: 'NA';
  quantity: string;
  rate: string;
  taxable: string;
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
  totalValue: string;
}

export const GST_DOC_NATURES = ['invoices', 'credit_notes'] as const;
export type GstDocNature = (typeof GST_DOC_NATURES)[number];

/** Table 13: a numbering series used in the month. */
export interface GstDocSeries {
  nature: GstDocNature;
  series: string;
  from: string;
  to: string;
  total: number;
  cancelled: number;
  netIssued: number;
}

export interface GstTotals {
  taxable: string;
  igst: string;
  cgst: string;
  sgst: string;
  total: string;
}

export interface GstRegisterWarning {
  code:
    | 'no_place_of_supply'
    | 'tax_differs_from_lines'
    | 'voided_after_month'
    | 'voided_from_earlier_month'
    | 'number_gap'
    | 'b2cs_negative'
    | 'no_sac'
    | 'no_firm_gstin';
  message: string;
  /** The invoice or credit note it is about. */
  ref: string | null;
}

/** GET /reports/finance/gst-register?month=YYYY-MM */
export interface GstOutwardRegister {
  month: string;
  firmGstin: string | null;
  firmState: string | null;
  /** The month's GSTR-1 is filed (firm_settings.gst_filed_through covers it). */
  filed: boolean;
  b2b: GstB2bInvoice[];
  b2cl: GstB2clInvoice[];
  b2cs: GstB2csRow[];
  cdnr: GstNote[];
  cdnur: GstNote[];
  hsnB2b: GstHsnRow[];
  hsnB2c: GstHsnRow[];
  docs: GstDocSeries[];
  /** The register against the invoices and credit notes as the portal holds them. */
  tieOut: {
    invoices: { portal: GstTotals; register: GstTotals };
    creditNotes: { portal: GstTotals; register: GstTotals };
    ok: boolean;
  };
  warnings: GstRegisterWarning[];
}

// ── Books export ──────────────────────────────────────────────────────────

/** The firm's Tally ledger names the export posts to. */
export interface BooksLedgers {
  sales: string;
  outputCgst: string;
  outputSgst: string;
  outputIgst: string;
  tdsReceivable: string;
  bank: string;
  cash: string;
  badDebts: string;
  /** Receipts recorded as an adjustment (e.g. set off against a payable). */
  adjustment: string;
}

export const DEFAULT_BOOKS_LEDGERS: BooksLedgers = {
  sales: 'Professional Fees',
  outputCgst: 'Output CGST',
  outputSgst: 'Output SGST',
  outputIgst: 'Output IGST',
  tdsReceivable: 'TDS Receivable',
  bank: 'Bank',
  cash: 'Cash',
  badDebts: 'Bad Debts Written Off',
  adjustment: 'Adjustment',
};

export interface BooksSettings extends BooksLedgers {
  version: number;
}

export type UpdateBooksSettingsInput = Partial<BooksLedgers> & { version: number };

export const VOUCHER_SOURCES = [
  'invoice',
  'invoice_void',
  'receipt',
  'receipt_reversal',
  'credit_note',
  'credit_note_void',
  'write_off',
] as const;
export type VoucherSource = (typeof VOUCHER_SOURCES)[number];

export type VoucherType = 'Sales' | 'Receipt' | 'Credit Note' | 'Journal';

export interface VoucherEntry {
  ledger: string;
  debit: string;
  credit: string;
}

/** One voucher; debits equal credits. */
export interface BooksVoucher {
  source: VoucherSource;
  sourceId: string;
  date: string;
  type: VoucherType;
  number: string;
  party: string;
  narration: string;
  entries: VoucherEntry[];
  /** When it went out in an earlier export; null until then. */
  exportedAt: string | null;
}

export const BOOKS_FORMATS = ['tally_xml', 'journal_csv'] as const;
export type BooksFormat = (typeof BOOKS_FORMATS)[number];

export interface BooksExportRecord {
  id: string;
  month: string;
  format: BooksFormat;
  voucherCount: number;
  exportedByName: string | null;
  at: string;
}

/** GET /reports/finance/books?month=YYYY-MM */
export interface BooksMonth {
  month: string;
  vouchers: BooksVoucher[];
  pending: number;
  exports: BooksExportRecord[];
  ledgers: BooksSettings;
}

/** POST /reports/finance/books/export — marks the pending vouchers exported. */
export interface BooksExportInput {
  month: string;
  format: BooksFormat;
}

// ── Bank statement match ──────────────────────────────────────────────────

/** POST /reports/finance/bank-match — a CSV or Excel statement, never stored. */
export interface BankMatchInput {
  filename: string;
  contentBase64: string;
}

export interface BankCredit {
  /** Row in the file, from 1. */
  row: number;
  date: string;
  narration: string;
  reference: string | null;
  amount: string;
}

export interface BankMatchInvoice {
  invoiceId: string;
  invoiceNumber: string;
  balance: string;
  /** What this credit settles on it, TDS included. */
  allocate: string;
}

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface BankMatchProposal {
  clientId: string;
  clientName: string;
  invoices: BankMatchInvoice[];
  /** Gross = credit + TDS; TDS assumed at 10% of the taxable value (194J). */
  gross: string;
  tds: string;
  confidence: MatchConfidence;
  reasons: string[];
}

export interface BankMatchLine {
  credit: BankCredit;
  /** A posted receipt of this net amount on this date already exists. */
  recordedReceiptId: string | null;
  proposals: BankMatchProposal[];
}

export interface BankMatchResult {
  /** How the columns were read, so the Accountant can tell a misread file. */
  columns: { date: string; narration: string; credit: string; reference: string | null };
  credits: number;
  debitsSkipped: number;
  lines: BankMatchLine[];
}

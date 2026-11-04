/**
 * Form 3CD clause library (Phase 4, F-4). Form 3CD is data, not code: a
 * versioned library Admin and the Managing Partner edit. A published version
 * is immutable; changes are made on one draft (a copy of a published version,
 * or a whole version imported as JSON) and published as the next version.
 * Each tax audit stays on the version it started with: the newest published
 * version whose first year is on or before the audit's year.
 */

/** The Act a library version reports under. */
export const TAX_AUDIT_ACTS = ['1961', '2025'] as const;
export type TaxAuditAct = (typeof TAX_AUDIT_ACTS)[number];

export const TAX_AUDIT_LIBRARY_STATUSES = ['draft', 'published'] as const;
export type TaxAuditLibraryStatus = (typeof TAX_AUDIT_LIBRARY_STATUSES)[number];

/** Who prepares a clause by default (the signing partner reviews key clauses). */
export const TAX_AUDIT_GRADES = ['article', 'senior', 'manager'] as const;
export type TaxAuditGrade = (typeof TAX_AUDIT_GRADES)[number];

export const TAX_AUDIT_GRADE_LABEL: Record<TaxAuditGrade, string> = {
  article: 'Article',
  senior: 'Senior',
  manager: 'Manager',
};

/**
 * Work packages: clauses are given out a package at a time (F-5), each as a
 * task. The split follows the plan's Form 3CD work list.
 */
export const TAX_AUDIT_PACKAGES = [
  'general',
  'accounting_methods',
  'stock',
  'depreciation',
  'inadmissible',
  'cash_payments',
  'msme',
  'statutory_payments',
  'loans_deposits',
  'losses',
  'tds_tcs',
  'ratios',
  'gst_breakup',
] as const;
export type TaxAuditPackage = (typeof TAX_AUDIT_PACKAGES)[number];

export const TAX_AUDIT_PACKAGE_LABEL: Record<TaxAuditPackage, string> = {
  general: 'General clauses and regime',
  accounting_methods: 'Method of accounting and ICDS',
  stock: 'Stock valuation and quantities',
  depreciation: 'Depreciation',
  inadmissible: 'Inadmissible amounts',
  cash_payments: 'Cash payments, s.40A(3)',
  msme: 'MSME payments, s.43B(h)',
  statutory_payments: 'Statutory dues, s.43B',
  loans_deposits: 'Loans and deposits, s.269SS / 269T',
  losses: 'Losses brought forward',
  tds_tcs: 'TDS and TCS',
  ratios: 'Accounting ratios',
  gst_breakup: 'GST break-up of expenses',
};

/** Where a clause's first draft can come from (F-6). */
export const TAX_AUDIT_DRAFT_SOURCES = [
  'client_master',
  'tds_filings',
  'gst_filings',
  'last_year',
  'msme_list',
] as const;
export type TaxAuditDraftSource = (typeof TAX_AUDIT_DRAFT_SOURCES)[number];

export const TAX_AUDIT_DRAFT_SOURCE_LABEL: Record<TaxAuditDraftSource, string> = {
  client_master: 'Client master',
  tds_filings: 'TDS returns the firm filed',
  gst_filings: 'GST returns the firm filed',
  last_year: "Last year's report",
  msme_list: 'MSME supplier list',
};

/** The kinds of field the e-filing utility asks for in a clause. */
export const TAX_AUDIT_FIELD_KINDS = ['text', 'yes_no', 'amount', 'date', 'table'] as const;
export type TaxAuditFieldKind = (typeof TAX_AUDIT_FIELD_KINDS)[number];

export interface TaxAuditSubItem {
  /** Stable within the clause: 'a', 'b', 'ba' … or a short key. */
  key: string;
  label: string;
  kind: TaxAuditFieldKind;
}

/**
 * The audit facts a clause's "applies when" reads. A fact not yet known never
 * takes a clause out: the clause opens Not started until someone answers it.
 */
export const TAX_AUDIT_FACTS = {
  isCompany: 'The assessee is a company',
  isFirmOrAop: 'The assessee is a firm, LLP, AOP or BOI',
  closelyHeldCompany: 'A company in which the public are not substantially interested',
  presumptiveIncome: 'Has income on a presumptive basis',
  holdsStock: 'Holds stock-in-trade or inventory',
  tradesGoods: 'Trades in goods',
  manufactures: 'Manufactures or processes goods',
  loansOrDeposits: 'Took or repaid loans, deposits or specified sums',
  broughtForwardLosses: 'Has losses or depreciation brought forward',
  internationalTransactions: 'Has international or specified domestic transactions',
  gstRegistered: 'Registered under GST',
} as const;
export type TaxAuditFact = keyof typeof TAX_AUDIT_FACTS;
export const TAX_AUDIT_FACT_KEYS = Object.keys(TAX_AUDIT_FACTS) as TaxAuditFact[];
export type TaxAuditFacts = Partial<Record<TaxAuditFact, boolean>>;

/** {fact, is} | {all} | {any} | {not}: a clause applies when this holds. */
export type TaxAuditCondition =
  | { fact: TaxAuditFact; is: boolean }
  | { all: TaxAuditCondition[] }
  | { any: TaxAuditCondition[] }
  | { not: TaxAuditCondition };

/** true / false, or null while a fact it reads is not yet known. */
export function evaluateClauseCondition(
  cond: TaxAuditCondition | null,
  facts: TaxAuditFacts,
): boolean | null {
  if (cond === null) return true;
  if ('fact' in cond) {
    const v = facts[cond.fact];
    return v === undefined ? null : v === cond.is;
  }
  if ('not' in cond) {
    const v = evaluateClauseCondition(cond.not, facts);
    return v === null ? null : !v;
  }
  const parts = ('all' in cond ? cond.all : cond.any).map((c) => evaluateClauseCondition(c, facts));
  if ('all' in cond) {
    if (parts.includes(false)) return false;
    return parts.includes(null) ? null : true;
  }
  if (parts.includes(true)) return true;
  return parts.includes(null) ? null : false;
}

/** The problems with a condition (unknown facts, empty groups); [] when sound. */
export function conditionProblems(cond: unknown, path = 'appliesWhen'): string[] {
  if (cond === null || cond === undefined) return [];
  if (typeof cond !== 'object' || Array.isArray(cond)) return [`${path} must be an object.`];
  const c = cond as Record<string, unknown>;
  const keys = Object.keys(c);
  if ('fact' in c) {
    const out: string[] = [];
    if (!TAX_AUDIT_FACT_KEYS.includes(c.fact as TaxAuditFact)) {
      out.push(`${path}: "${String(c.fact)}" is not an audit fact.`);
    }
    if (typeof c.is !== 'boolean') out.push(`${path}: "is" must be true or false.`);
    if (keys.some((k) => k !== 'fact' && k !== 'is')) out.push(`${path}: only fact and is.`);
    return out;
  }
  if (keys.length !== 1) return [`${path} must have exactly one of fact, all, any or not.`];
  if ('not' in c) return conditionProblems(c.not, `${path}.not`);
  const group = (c.all ?? c.any) as unknown;
  const name = 'all' in c ? 'all' : 'any' in c ? 'any' : null;
  if (!name) return [`${path}: unknown key "${keys[0]}".`];
  if (!Array.isArray(group) || group.length === 0) return [`${path}.${name} needs conditions.`];
  return group.flatMap((g, i) => conditionProblems(g, `${path}.${name}[${i}]`));
}

/** "Holds stock-in-trade or inventory and not: …" — a condition in words, for the library screen. */
export function describeCondition(cond: TaxAuditCondition | null): string {
  if (cond === null) return 'Always';
  const words = (c: TaxAuditCondition): string => {
    if ('fact' in c) {
      const fact = TAX_AUDIT_FACTS[c.fact];
      const lower = fact.charAt(0).toLowerCase() + fact.slice(1);
      return c.is ? lower : `not: ${lower}`;
    }
    if ('not' in c) return `not (${words(c.not)})`;
    return ('all' in c ? c.all : c.any).map(words).join('all' in c ? ' and ' : ' or ');
  };
  const text = words(cond);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface TaxAuditLibraryClause {
  id: string;
  clauseNo: string;
  part: 'A' | 'B';
  title: string;
  subItems: TaxAuditSubItem[];
  appliesWhen: TaxAuditCondition | null;
  notApplicableReason: string | null;
  defaultPackage: TaxAuditPackage;
  defaultGrade: TaxAuditGrade;
  evidence: string[];
  draftSource: TaxAuditDraftSource | null;
  partnerReview: boolean;
  sortOrder: number;
}

export interface TaxAuditLibraryVersion {
  id: string;
  versionNo: number;
  label: string;
  act: TaxAuditAct;
  form: string;
  /** The first financial year audited on this version. */
  appliesFromFy: string;
  status: TaxAuditLibraryStatus;
  notes: string | null;
  basedOnVersionNo: number | null;
  clauseCount: number;
  publishedAt: string | null;
  publishedByName: string | null;
  version: number;
}

export interface TaxAuditLibraryView {
  versions: TaxAuditLibraryVersion[];
  /** The version shown: the one asked for, else the draft, else the newest published. */
  selected: TaxAuditLibraryVersion | null;
  clauses: TaxAuditLibraryClause[];
}

/** One clause as written to a draft or carried in an import. */
export interface TaxAuditLibraryClauseInput {
  clauseNo: string;
  part: 'A' | 'B';
  title: string;
  subItems: TaxAuditSubItem[];
  appliesWhen: TaxAuditCondition | null;
  notApplicableReason: string | null;
  defaultPackage: TaxAuditPackage;
  defaultGrade: TaxAuditGrade;
  evidence: string[];
  draftSource: TaxAuditDraftSource | null;
  partnerReview: boolean;
  sortOrder: number;
}

export interface CreateTaxAuditLibraryDraftInput {
  label: string;
  act: TaxAuditAct;
  appliesFromFy: string;
  notes?: string | null;
  /** Copy this published version's clauses; leave out to copy the newest. */
  basedOnVersionNo?: number;
  /** A whole version's clauses, instead of a copy (a new form, loaded as data). */
  clauses?: TaxAuditLibraryClauseInput[];
}

/** '8a' < '9' < '21(a)' < '21(b)' < '29A' < '30'. */
export function compareClauseNo(a: string, b: string): number {
  const parse = (s: string): [number, string, string] => {
    const m = /^(\d+)([A-Za-z]?)(?:\(([a-z]+)\))?$/.exec(s);
    return m ? [Number(m[1]), m[2] ?? '', m[3] ?? ''] : [Number.MAX_SAFE_INTEGER, s, ''];
  };
  const [an, as, ap] = parse(a);
  const [bn, bs, bp] = parse(b);
  return an - bn || as.localeCompare(bs) || ap.length - bp.length || ap.localeCompare(bp);
}

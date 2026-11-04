/**
 * Practice Services PS-403 — individual returns at volume (the ITR desk).
 *
 * Hundreds of ITRs a season, mostly individuals, HUFs and proprietors: one
 * grid of every client's return for the year, with the filing run's bulk
 * assign and remind (WF-301) on it. A return carries what the filing itself
 * doesn't: the form and regime, the 30-day e-verification after filing, the
 * refund until it is credited (or set off under s.245), the 143(1)
 * intimation, and the income the department already knows (26AS / AIS / TIS)
 * against the client's own figures.
 *
 * The filing (acknowledgement no. and date) stays the filing record's — the
 * return is lodged in the filing drawer like any other filing — so the
 * return's stage is read from it, never stored twice.
 *
 * The Income-tax Act, 2025 replaces the 1961 Act from 1 April 2026: the year
 * of income becomes the "tax year" (Form 168 replaces 26AS / AIS from tax year
 * 2026-27), 143(1) becomes s.270 and 245 becomes s.438. The 1961 references
 * stay for the returns of FY 2025-26 and earlier. Section mappings here are
 * marked 'verify' until a partner confirms them.
 */
import type { ClientReminderChannel, ClientReminderFallback } from './client-chase';
import { assessmentYearOf } from './tax-audit-acceptance';

export const ITR_FORMS = ['ITR-1', 'ITR-2', 'ITR-3', 'ITR-4', 'ITR-5', 'ITR-6', 'ITR-7'] as const;
export type ItrForm = (typeof ITR_FORMS)[number];
export const ITR_FORM_LABEL: Record<ItrForm, string> = {
  'ITR-1': 'ITR-1 (Sahaj) — salary, one house, other sources',
  'ITR-2': 'ITR-2 — no business income',
  'ITR-3': 'ITR-3 — business or profession',
  'ITR-4': 'ITR-4 (Sugam) — presumptive income',
  'ITR-5': 'ITR-5 — firms, LLPs, AOPs',
  'ITR-6': 'ITR-6 — companies',
  'ITR-7': 'ITR-7 — trusts and institutions',
};

export const ITR_REGIMES = ['new', 'old'] as const;
export type ItrRegime = (typeof ITR_REGIMES)[number];
export const ITR_REGIME_LABEL: Record<ItrRegime, string> = {
  new: 'New regime (default)',
  old: 'Old regime',
};

export const ITR_RETURN_TYPES = ['original', 'belated', 'revised', 'updated'] as const;
export type ItrReturnType = (typeof ITR_RETURN_TYPES)[number];
export const ITR_RETURN_TYPE_LABEL: Record<ItrReturnType, string> = {
  original: 'Original',
  belated: 'Belated',
  revised: 'Revised',
  updated: 'Updated (ITR-U)',
};

/**
 * Where a return is, read from its filing and its own dates:
 * preparing (not lodged) → awaiting e-verification → verified → processed
 * (the 143(1) intimation is on file).
 */
export const ITR_STAGES = ['preparing', 'awaiting_verification', 'verified', 'processed'] as const;
export type ItrStage = (typeof ITR_STAGES)[number];
export const ITR_STAGE_LABEL: Record<ItrStage, string> = {
  preparing: 'Preparing',
  awaiting_verification: 'Awaiting e-verification',
  verified: 'E-verified',
  processed: 'Processed',
};

export function itrStage(r: {
  filedOn: string | null;
  eVerifiedOn: string | null;
  intimationOn: string | null;
}): ItrStage {
  if (!r.filedOn) return 'preparing';
  if (r.intimationOn) return 'processed';
  if (r.eVerifiedOn) return 'verified';
  return 'awaiting_verification';
}

export const ITR_VERIFY_MODES = [
  'aadhaar_otp',
  'evc_bank',
  'evc_demat',
  'net_banking',
  'dsc',
  'itr_v',
] as const;
export type ItrVerifyMode = (typeof ITR_VERIFY_MODES)[number];
export const ITR_VERIFY_MODE_LABEL: Record<ItrVerifyMode, string> = {
  aadhaar_otp: 'Aadhaar OTP',
  evc_bank: 'EVC — bank account',
  evc_demat: 'EVC — demat account',
  net_banking: 'Net banking',
  dsc: 'Digital signature',
  itr_v: 'ITR-V posted to CPC',
};

/** Days from filing to e-verify when the rule data can't be read (CBDT Notification 5/2022). */
export const ITR_VERIFY_DAYS_DEFAULT = 30;
/** Today's "Due this week" window for an unverified return. */
export const ITR_VERIFY_WARN_DAYS = 7;
/**
 * The ITR filings the desk's grid is built on (a proprietor in tax audit files
 * under IT_ITR_AUDIT), and the rule that holds the e-verify days.
 */
export const ITR_RULE_CODES = ['IT_ITR', 'IT_ITR_AUDIT', 'IT_ITR_TP'] as const;
export const ITR_VERIFY_RULE_CODE = 'ITR_VERIFICATION_DUE';
/** Client types the desk lists (entity_types.category). */
export const ITR_DESK_CATEGORIES = ['individual', 'huf', 'proprietorship'] as const;

/** filedOn + the rule's days (YYYY-MM-DD, calendar days). */
export function eVerifyDueOn(filedOn: string, days = ITR_VERIFY_DAYS_DEFAULT): string {
  const d = new Date(`${filedOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * How the year is named on the return: "AY 2026-27" for FY 2025-26 and
 * earlier (1961 Act), "Tax year 2026-27" from then on (2025 Act — verify).
 */
export function itrYearLabel(financialYear: string): string {
  return Number(financialYear.slice(0, 4)) >= 2026
    ? `Tax year ${financialYear}`
    : `AY ${assessmentYearOf(financialYear)}`;
}

// ── Refunds ────────────────────────────────────────────────────────────────

export const ITR_REFUND_STATUSES = ['none', 'pending', 'issued', 'adjusted', 'failed'] as const;
export type ItrRefundStatus = (typeof ITR_REFUND_STATUSES)[number];
export const ITR_REFUND_STATUS_LABEL: Record<ItrRefundStatus, string> = {
  none: 'No refund',
  pending: 'Refund due',
  issued: 'Refund credited',
  adjusted: 'Set off against a demand',
  failed: 'Refund failed',
};

/**
 * The refund's moves. A failed refund (bank account not pre-validated, name
 * mismatch) goes back to pending once the client re-issues it; an issued or
 * set-off refund is final (a correction is a new intimation).
 */
export const ITR_REFUND_MOVES: Record<ItrRefundStatus, ItrRefundStatus[]> = {
  none: ['pending'],
  pending: ['issued', 'adjusted', 'failed', 'none'],
  failed: ['pending', 'issued'],
  issued: [],
  adjusted: [],
};

export function canMoveRefund(from: ItrRefundStatus, to: ItrRefundStatus): boolean {
  return ITR_REFUND_MOVES[from].includes(to);
}

// ── Intimations ────────────────────────────────────────────────────────────

/** What the department's processing said. */
export const ITR_INTIMATION_KINDS = ['143_1', '245'] as const;
export type ItrIntimationKind = (typeof ITR_INTIMATION_KINDS)[number];
export const ITR_INTIMATION_KIND_LABEL: Record<ItrIntimationKind, string> = {
  '143_1': 'Intimation u/s 143(1) (s.270 of the 2025 Act — verify)',
  '245': 'Proposed set-off u/s 245 (s.438 of the 2025 Act — verify)',
};
/** The notice type each intimation opens on the notice register. */
export const ITR_INTIMATION_NOTICE_TYPE: Record<ItrIntimationKind, string> = {
  '143_1': 'IT_143_1',
  '245': 'IT_245',
};

export const ITR_INTIMATION_RESULTS = ['no_change', 'refund', 'demand'] as const;
export type ItrIntimationResult = (typeof ITR_INTIMATION_RESULTS)[number];
export const ITR_INTIMATION_RESULT_LABEL: Record<ItrIntimationResult, string> = {
  no_change: 'Accepted as filed',
  refund: 'Refund determined',
  demand: 'Demand raised',
};

// ── Income the department knows ─────────────────────────────────────────────

export const ITR_INCOME_SOURCES = ['26as', 'ais', 'tis', 'client'] as const;
export type ItrIncomeSource = (typeof ITR_INCOME_SOURCES)[number];
export const ITR_INCOME_SOURCE_LABEL: Record<ItrIncomeSource, string> = {
  '26as': 'Form 26AS',
  ais: 'AIS',
  tis: 'TIS',
  client: "Client's figures",
};

export const ITR_INCOME_HEADS = [
  'salary',
  'house_property',
  'business',
  'capital_gains',
  'other_sources',
  'exempt',
  'unclassified',
] as const;
export type ItrIncomeHead = (typeof ITR_INCOME_HEADS)[number];
export const ITR_INCOME_HEAD_LABEL: Record<ItrIncomeHead, string> = {
  salary: 'Salary',
  house_property: 'House property',
  business: 'Business or profession',
  capital_gains: 'Capital gains',
  other_sources: 'Other sources',
  exempt: 'Exempt income',
  unclassified: 'Not classified',
};

/**
 * The head a TDS / TCS section's receipt usually falls under for the payee
 * (1961 Act sections, as Form 26AS prints them). A starting point the
 * preparer overrides; marked verify — the 2025 Act renumbers these.
 * 194N (cash withdrawal) and TCS sections are not income: they are unclassified.
 */
export const TDS_SECTION_HEAD: Record<string, ItrIncomeHead> = {
  '192': 'salary',
  '192A': 'other_sources',
  '193': 'other_sources',
  '194': 'other_sources',
  '194A': 'other_sources',
  '194B': 'other_sources',
  '194BB': 'other_sources',
  '194C': 'business',
  '194D': 'business',
  '194DA': 'other_sources',
  '194E': 'business',
  '194G': 'business',
  '194H': 'business',
  '194I': 'house_property',
  '194IA': 'capital_gains',
  '194IB': 'house_property',
  '194IC': 'business',
  '194J': 'business',
  '194K': 'other_sources',
  '194LA': 'capital_gains',
  '194M': 'business',
  '194O': 'business',
  '194Q': 'business',
  '194R': 'business',
  '194S': 'capital_gains',
  '194T': 'business',
};
export const TDS_SECTION_HEAD_VERIFICATION = 'verify' as const;

/** The head for a section code as printed ("194A", "194-I(b)", "Sec 194J"). */
export function headForSection(section: string | null | undefined): ItrIncomeHead {
  if (!section) return 'unclassified';
  const code = section
    .toUpperCase()
    .replace(/^SEC(TION)?\.?\s*/, '')
    .replace(/\(.*$/, '')
    .replace(/[^0-9A-Z]/g, '');
  return TDS_SECTION_HEAD[code] ?? 'unclassified';
}

/** One line of income from a statement or the client. Amounts are decimal strings. */
export interface ItrIncomeLine {
  id: string;
  source: ItrIncomeSource;
  head: ItrIncomeHead;
  section: string | null;
  description: string | null;
  payerName: string | null;
  payerTan: string | null;
  amount: string;
  taxDeducted: string;
  /** The date of the transaction or credit, when the statement gives it. */
  transactionOn: string | null;
}

/** POST /itr/returns/:id/statements — a 26AS text export, or a CSV / Excel sheet. */
export interface ImportItrStatementInput {
  source: ItrIncomeSource;
  filename: string;
  contentBase64: string;
  /** Replace this source's lines (default true — a statement is re-downloaded whole). */
  replace?: boolean;
}
export interface ImportItrStatementResult {
  source: ItrIncomeSource;
  /** The format the file was read as ("26AS text export", "CSV sheet" …). */
  format: string;
  imported: number;
  skipped: number;
  warnings: string[];
}

/** POST /itr/returns/:id/lines — one figure by hand (usually the client's). */
export interface AddItrIncomeLineInput {
  source: ItrIncomeSource;
  head: ItrIncomeHead;
  section?: string | null;
  description?: string | null;
  payerName?: string | null;
  payerTan?: string | null;
  amount: string;
  taxDeducted?: string | null;
  transactionOn?: string | null;
}

export const ITR_MATCH_STATUSES = ['matched', 'mismatch', 'not_in_client', 'only_client'] as const;
export type ItrMatchStatus = (typeof ITR_MATCH_STATUSES)[number];
export const ITR_MATCH_STATUS_LABEL: Record<ItrMatchStatus, string> = {
  matched: 'Matches',
  mismatch: 'Amounts differ',
  not_in_client: "Missing from the client's figures",
  only_client: 'Only in the client’s figures',
};

/** A payer under a head, with each source's total for it. */
export interface ItrMatchRow {
  key: string;
  head: ItrIncomeHead;
  payerName: string | null;
  payerTan: string | null;
  amounts: Partial<Record<ItrIncomeSource, string>>;
  taxDeducted: Partial<Record<ItrIncomeSource, string>>;
  /** The largest gap between the sources present (decimal string, ≥ 0). */
  difference: string;
  status: ItrMatchStatus;
}

export interface ItrMatching {
  rows: ItrMatchRow[];
  /** Per head, each source's total. */
  totals: { head: ItrIncomeHead; amounts: Partial<Record<ItrIncomeSource, string>> }[];
  counts: Record<ItrMatchStatus, number>;
}

/** A gap up to a rupee is rounding, not a mismatch. */
export const ITR_MATCH_TOLERANCE_PAISE = 100;

const toPaise = (s: string): number => {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return 0;
  const p = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -p : p;
};
const fromPaise = (p: number): string => {
  const sign = p < 0 ? '-' : '';
  const a = Math.abs(p);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};
const payerKey = (l: Pick<ItrIncomeLine, 'payerTan' | 'payerName'>): string => {
  const tan = l.payerTan?.trim().toUpperCase();
  if (tan) return `tan:${tan}`;
  const name = l.payerName
    ?.toUpperCase()
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|THE|M\/S)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
  return name ? `name:${name}` : 'none';
};

/**
 * Lines matched by payer (TAN, else the name without "Pvt Ltd" and the like)
 * within a head. The department's sources are compared with each other and
 * with the client's: a payer the department reports that the client left out
 * is the gap that draws a 143(1)(a) adjustment, so it sorts first.
 */
export function matchIncomeLines(lines: ItrIncomeLine[]): ItrMatching {
  const groups = new Map<string, ItrIncomeLine[]>();
  for (const l of lines) {
    const key = `${l.head}|${payerKey(l)}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const rank: Record<ItrMatchStatus, number> = {
    not_in_client: 0,
    mismatch: 1,
    only_client: 2,
    matched: 3,
  };
  const rows: ItrMatchRow[] = [...groups.entries()].map(([key, ls]) => {
    const amt: Partial<Record<ItrIncomeSource, number>> = {};
    const tds: Partial<Record<ItrIncomeSource, number>> = {};
    for (const l of ls) {
      amt[l.source] = (amt[l.source] ?? 0) + toPaise(l.amount);
      tds[l.source] = (tds[l.source] ?? 0) + toPaise(l.taxDeducted);
    }
    const present = Object.values(amt) as number[];
    const diff = Math.max(...present) - Math.min(...present);
    const dept = ITR_INCOME_SOURCES.filter((s) => s !== 'client' && amt[s] !== undefined);
    const status: ItrMatchStatus =
      amt.client === undefined
        ? 'not_in_client'
        : dept.length === 0
          ? 'only_client'
          : diff > ITR_MATCH_TOLERANCE_PAISE
            ? 'mismatch'
            : 'matched';
    const named = ls.find((l) => l.payerName) ?? ls[0]!;
    return {
      key,
      head: ls[0]!.head,
      payerName: named.payerName,
      payerTan: ls.find((l) => l.payerTan)?.payerTan?.toUpperCase() ?? null,
      amounts: Object.fromEntries(
        Object.entries(amt).map(([s, p]) => [s, fromPaise(p as number)]),
      ) as ItrMatchRow['amounts'],
      taxDeducted: Object.fromEntries(
        Object.entries(tds).map(([s, p]) => [s, fromPaise(p as number)]),
      ) as ItrMatchRow['taxDeducted'],
      difference: fromPaise(diff),
      status,
    };
  });
  rows.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      ITR_INCOME_HEADS.indexOf(a.head) - ITR_INCOME_HEADS.indexOf(b.head) ||
      (a.payerName ?? '').localeCompare(b.payerName ?? ''),
  );
  const totals = ITR_INCOME_HEADS.flatMap((head) => {
    const inHead = lines.filter((l) => l.head === head);
    if (inHead.length === 0) return [];
    const sums: Partial<Record<ItrIncomeSource, number>> = {};
    for (const l of inHead) sums[l.source] = (sums[l.source] ?? 0) + toPaise(l.amount);
    return [
      {
        head,
        amounts: Object.fromEntries(
          Object.entries(sums).map(([s, p]) => [s, fromPaise(p as number)]),
        ) as ItrMatchRow['amounts'],
      },
    ];
  });
  const counts = Object.fromEntries(ITR_MATCH_STATUSES.map((s) => [s, 0])) as Record<
    ItrMatchStatus,
    number
  >;
  for (const r of rows) counts[r.status] += 1;
  return { rows, totals, counts };
}

// ── The return and the season ──────────────────────────────────────────────

export interface ItrReturn {
  id: string;
  complianceInstanceId: string;
  engagementId: string;
  engagementCode: string;
  entityId: string;
  entityName: string;
  pan: string | null;
  financialYear: string;
  assessmentYear: string;
  /** "AY 2026-27" or "Tax year 2026-27". */
  yearLabel: string;
  itrForm: ItrForm | null;
  regime: ItrRegime | null;
  returnType: ItrReturnType;
  stage: ItrStage;
  /** The filing's workflow status (not_started … filed). */
  workflowStatus: string;
  statutoryDate: string | null;
  /** From the filing record (lodged in the filing drawer). */
  filedOn: string | null;
  ackNo: string | null;
  eVerifyDueOn: string | null;
  eVerifyOverdue: boolean;
  eVerifiedOn: string | null;
  eVerifyMode: ItrVerifyMode | null;
  /**
   * Verified after the window: the return counts as filed on the day it was
   * verified, which can make it belated and draw the s.234F fee.
   */
  verifiedLate: boolean;
  refundClaimed: string | null;
  refundStatus: ItrRefundStatus;
  refundAmount: string | null;
  refundOn: string | null;
  refundNote: string | null;
  intimationOn: string | null;
  intimationResult: ItrIntimationResult | null;
  intimationAmount: string | null;
  /** Notices opened from this return's intimations. */
  notices: { id: string; referenceNo: string; typeCode: string; status: string }[];
  lineCounts: Partial<Record<ItrIncomeSource, number>>;
  notes: string | null;
  version: number;
  can: { edit: boolean };
}

/** GET /itr/returns/:id/income — the lines and how they match. */
export interface ItrIncome {
  lines: ItrIncomeLine[];
  matching: ItrMatching;
}

/** PATCH /itr/returns/:id/lines/:lineId — classify a line (a statement without the section). */
export interface UpdateItrIncomeLineInput {
  head: ItrIncomeHead;
}

/** POST /itr/returns — the return for an ITR filing (the existing one when there is one). */
export interface OpenItrReturnInput {
  complianceInstanceId: string;
}

/** PATCH /itr/returns/:id */
export interface UpdateItrReturnInput {
  version: number;
  itrForm?: ItrForm | null;
  regime?: ItrRegime | null;
  returnType?: ItrReturnType;
  refundClaimed?: string | null;
  notes?: string | null;
}

/** POST /itr/returns/:id/e-verify — on or after filing, within the window or late. */
export interface EVerifyItrInput {
  version: number;
  eVerifiedOn: string;
  mode: ItrVerifyMode;
}

/** POST /itr/returns/:id/refund */
export interface MoveItrRefundInput {
  version: number;
  to: ItrRefundStatus;
  /** The amount credited or set off (issued / adjusted). */
  amount?: string | null;
  on?: string | null;
  note?: string | null;
}

/**
 * POST /itr/returns/:id/intimation — a 143(1) intimation (any result) or a
 * 245 set-off proposal. A demand or a 245 opens a notice on the register,
 * linked to the return, with its reply clock.
 */
export interface RecordItrIntimationInput {
  version: number;
  kind: ItrIntimationKind;
  referenceNo: string;
  issuedOn: string;
  receivedOn: string;
  /** 143(1) only. */
  result?: ItrIntimationResult;
  /** The refund determined, the demand, or the amount proposed for set-off. */
  amount?: string | null;
  /** Default: on for a demand and a 245, off otherwise. */
  openNotice?: boolean;
  summary?: string | null;
}
export interface RecordItrIntimationResult {
  return: ItrReturn;
  noticeId: string | null;
}

/** POST /itr/returns/:id/remind-verify — omit `channel` for the firm's. */
export interface RemindItrVerifyInput {
  channel?: ClientReminderChannel;
}
export interface ItrVerifyReminder {
  returnId: string;
  channel: ClientReminderChannel;
  text: string;
  /** E-mail: the address it went to. */
  to?: string;
  /** WhatsApp: the wa.me link with the text filled in. */
  waUrl?: string;
  fallback?: ClientReminderFallback | null;
}

/** The client's reminder to e-verify a filed return. */
export function eVerifyReminderText(r: {
  entityName: string;
  yearLabel: string;
  filedOn: string;
  ackNo: string | null;
  dueOn: string;
  firmName: string | null;
}): string {
  const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  return [
    `Dear ${r.entityName},`,
    '',
    `Your income-tax return for ${r.yearLabel} was filed on ${dmy(r.filedOn)}${
      r.ackNo ? ` (acknowledgement no. ${r.ackNo})` : ''
    }. It must be e-verified by ${dmy(r.dueOn)} or it is treated as not filed.`,
    '',
    'Please e-verify it on the income-tax portal (Aadhaar OTP is quickest), or share the OTP with us when we call.',
    '',
    `Regards,`,
    r.firmName ?? 'Your chartered accountants',
  ].join('\n');
}

/** One client's return on the season grid. */
export interface ItrSeasonRow {
  instanceId: string;
  returnId: string | null;
  engagementId: string;
  engagementCode: string;
  entityId: string;
  entityName: string;
  entityType: string;
  pan: string | null;
  itrForm: ItrForm | null;
  preparerName: string | null;
  reviewerName: string | null;
  workflowStatus: string;
  statutoryDate: string | null;
  requestsOpen: number;
  stage: ItrStage;
  filedOn: string | null;
  ackNo: string | null;
  eVerifyDueOn: string | null;
  eVerifyOverdue: boolean;
  refundStatus: ItrRefundStatus;
  /** May the caller assign this filing (the filing run's rule). */
  canAssign: boolean;
}

/** GET /itr/season?financialYear=&scope= (scope as the filing run's: mine / team / all). */
export interface ItrSeason {
  financialYear: string;
  yearLabel: string;
  total: number;
  stages: Record<ItrStage, number>;
  eVerifyOverdue: number;
  refundsPending: number;
  items: ItrSeasonRow[];
}

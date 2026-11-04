/**
 * Form 3CD clause workspace (Phase 4, F-5). An audit opens its 3CD work on the
 * library version published for its year; its clauses fall into work
 * packages, each an engagement task given out through Assign work (C-3), and
 * each clause gets one working paper. The standard information list goes to
 * the client as client requests.
 */
import type { TaxAuditStage } from './tax-audits';
import {
  evaluateClauseCondition,
  type TaxAuditCondition,
  type TaxAuditDraftSource,
  type TaxAuditFacts,
  type TaxAuditGrade,
  type TaxAuditPackage,
  type TaxAuditSubItem,
} from './tax-audit-clauses';

export const TAX_AUDIT_WP_STATUSES = [
  'not_started',
  'in_progress',
  'in_review',
  'done',
  'not_applicable',
] as const;
export type TaxAuditWpStatus = (typeof TAX_AUDIT_WP_STATUSES)[number];

export const TAX_AUDIT_WP_STATUS_LABEL: Record<TaxAuditWpStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  not_applicable: 'Not applicable',
};

/** The stages in which the 3CD work can still change. */
export const TAX_AUDIT_WORK_STAGES: readonly TaxAuditStage[] = [
  'information',
  'clause_work',
  'review',
];

/** The standard list the client is asked for (plan, "Information requests"). */
export const TAX_AUDIT_INFO_ITEMS = [
  'accounts',
  'ledgers',
  'fixed_assets',
  'stock',
  'gst_returns',
  'form_26as',
  'tds_returns',
  'loan_confirmations',
  'msme_list',
  'last_year_3cd',
] as const;
export type TaxAuditInfoItem = (typeof TAX_AUDIT_INFO_ITEMS)[number];

export const TAX_AUDIT_INFO_ITEM_LABEL: Record<TaxAuditInfoItem, string> = {
  accounts: 'Audited or final accounts',
  ledgers: 'General ledger and party ledgers',
  fixed_assets: 'Fixed asset register',
  stock: 'Stock records and valuation',
  gst_returns: 'GST returns',
  form_26as: 'Form 26AS, AIS and TIS',
  tds_returns: 'TDS returns and challans',
  loan_confirmations: 'Loan and deposit confirmations',
  msme_list: 'List of MSME suppliers',
  last_year_3cd: 'Last year’s Form 3CD',
};

/**
 * One sub-item's answer: text, a date or a table (rows, tab-separated) as a
 * string; yes / no as a boolean; an amount as a number.
 */
export type TaxAuditAnswerValue = string | number | boolean;
export type TaxAuditAnswer = Record<string, TaxAuditAnswerValue>;

/** The key a clause with no sub-items keeps its one free-text answer under. */
export const TAX_AUDIT_FREE_ANSWER_KEY = 'text';

/** The fields a working paper's answer has: the clause's sub-items, or one free text. */
export function answerFields(subItems: readonly TaxAuditSubItem[]): TaxAuditSubItem[] {
  return subItems.length
    ? [...subItems]
    : [{ key: TAX_AUDIT_FREE_ANSWER_KEY, label: 'Answer', kind: 'text' }];
}

const blank = (v: TaxAuditAnswerValue | undefined): boolean =>
  v === undefined || (typeof v === 'string' && v.trim() === '');

/** Why an answer cannot be stored as it is (a wrong type, a field the clause has not). */
export function answerProblems(
  subItems: readonly TaxAuditSubItem[],
  answer: Record<string, unknown>,
): string[] {
  const fields = answerFields(subItems);
  const problems: string[] = [];
  for (const k of Object.keys(answer)) {
    const f = fields.find((x) => x.key === k);
    if (!f) {
      problems.push(`"${k}" is not a field of this clause.`);
      continue;
    }
    const v = answer[k];
    const ok =
      f.kind === 'yes_no'
        ? typeof v === 'boolean'
        : f.kind === 'amount'
          ? typeof v === 'number' && Number.isFinite(v)
          : f.kind === 'date'
            ? typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v))
            : typeof v === 'string' && v.length <= 20000;
    if (!ok) problems.push(`${f.label}: ${KIND_WORDS[f.kind]}.`);
  }
  return problems;
}

const KIND_WORDS: Record<TaxAuditSubItem['kind'], string> = {
  text: 'give text',
  table: 'give the rows as text',
  yes_no: 'answer yes or no',
  amount: 'give an amount',
  date: 'give a date',
};

/** The fields still blank: a working paper goes for review only when none are. */
export function answerMissing(
  subItems: readonly TaxAuditSubItem[],
  answer: TaxAuditAnswer,
): string[] {
  return answerFields(subItems)
    .filter((f) => blank(answer[f.key]))
    .map((f) => f.label);
}

/** How a clause opens on an audit: Not applicable only when the facts rule it out. */
export function openingStatus(
  cond: TaxAuditCondition | null,
  facts: TaxAuditFacts,
): 'not_started' | 'not_applicable' {
  return evaluateClauseCondition(cond, facts) === false ? 'not_applicable' : 'not_started';
}

/** What stops a working paper going for review; empty when it may go. */
export function sendForReviewBlockers(p: {
  subItems: readonly TaxAuditSubItem[];
  answer: TaxAuditAnswer;
  evidenceRequired: readonly string[];
  evidenceCount: number;
  draftSource: TaxAuditDraftSource | null;
  draftConfirmedAt: string | null;
}): string[] {
  const out: string[] = [];
  const missing = answerMissing(p.subItems, p.answer);
  if (missing.length) out.push(`Answer ${missing.join('; ')}.`);
  if (p.evidenceRequired.length && p.evidenceCount === 0) {
    out.push(`Attach the evidence: ${p.evidenceRequired.join(', ')}.`);
  }
  if (p.draftSource && !p.draftConfirmedAt) out.push('Confirm the draft from the portal first.');
  return out;
}

export interface TaxAuditWpDocument {
  documentId: string;
  title: string;
  addedByName: string | null;
  addedAt: string;
}

export interface TaxAuditWpComment {
  id: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

export interface TaxAuditWorkingPaper {
  id: string;
  packageId: string;
  clauseNo: string;
  part: 'A' | 'B';
  title: string;
  subItems: TaxAuditSubItem[];
  appliesWhen: TaxAuditCondition | null;
  evidenceRequired: string[];
  partnerReview: boolean;
  status: TaxAuditWpStatus;
  notApplicableSource: 'condition' | 'person' | null;
  notApplicableReason: string | null;
  answer: TaxAuditAnswer;
  preparerId: string | null;
  preparerName: string | null;
  reviewerName: string | null;
  draftSource: TaxAuditDraftSource | null;
  draftAnswer: TaxAuditAnswer | null;
  draftNote: string | null;
  draftConfirmedAt: string | null;
  draftConfirmedByName: string | null;
  sentForReviewAt: string | null;
  doneAt: string | null;
  doneByName: string | null;
  documents: TaxAuditWpDocument[];
  comments: TaxAuditWpComment[];
  /** What stops it going for review now (empty = it may go). */
  blockers: string[];
  canPrepare: boolean;
  canReview: boolean;
  version: number;
}

export interface TaxAuditPackageRow {
  id: string;
  package: TaxAuditPackage;
  grade: TaxAuditGrade;
  taskId: string | null;
  taskStatus: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  clauseNos: string[];
  counts: Record<TaxAuditWpStatus, number>;
}

export interface TaxAuditInfoRequest {
  id: string;
  item: TaxAuditInfoItem;
  label: string;
  status: string;
  requestDate: string;
  reminderDate: string | null;
  receivedDate: string | null;
  documentCount: number;
}

export interface TaxAuditWorkspace {
  auditId: string;
  engagementId: string;
  financialYear: string;
  stage: TaxAuditStage;
  /** Null until the 3CD work is opened. */
  library: { versionNo: number; label: string; act: string } | null;
  facts: TaxAuditFacts;
  openedAt: string | null;
  packages: TaxAuditPackageRow[];
  papers: TaxAuditWorkingPaper[];
  requests: TaxAuditInfoRequest[];
  /** The engagement's partner or manager: opens the work, sets the facts, asks the client. */
  canLead: boolean;
  /** Whether the 3CD work can still change (not yet signed). */
  editable: boolean;
  version: number;
}

export interface TaxAuditVersionInput {
  version: number;
}

export interface SaveTaxAuditFactsInput {
  facts: TaxAuditFacts;
  version: number;
}

export interface RequestTaxAuditInformationInput {
  /** Leave out for the whole standard list; items already asked for are skipped. */
  items?: TaxAuditInfoItem[];
}

export interface SaveTaxAuditWorkingPaperInput {
  answer: TaxAuditAnswer;
  version: number;
}

export interface MarkTaxAuditWorkingPaperNaInput {
  reason: string;
  version: number;
}

export interface ReviewTaxAuditWorkingPaperInput {
  outcome: 'done' | 'send_back';
  /** Required when sending back. */
  comment?: string;
  version: number;
}

export interface AddTaxAuditWpCommentInput {
  body: string;
}

export interface UploadTaxAuditWpEvidenceInput {
  filename: string;
  contentType?: string;
  contentBase64: string;
}

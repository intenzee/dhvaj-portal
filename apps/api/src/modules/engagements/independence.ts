import {
  INDEPENDENCE_RULE,
  STREAM_LABEL,
  type EngagementKind,
  type IndependenceFinding,
  type Stream,
} from '@hsdg/contracts';

/**
 * Independence and conflict rules (spec Change 1), pure. The service layer
 * loads the client's facts (hsdg.entity_independence_facts — every engagement
 * the firm holds for the client, whoever can see it) and asks what adding the
 * proposed engagement, years or streams would break. Blocks are hard (no
 * override); warnings are recorded, and the non-company audit one needs a
 * partner's acknowledgement.
 */

export type IndependenceFactKind =
  'statutory_audit' | 'compliance' | 'bookkeeping' | 'mis' | 'internal_audit' | 'tax_audit';

export interface IndependenceFact {
  engagementId: string;
  engagementCode: string;
  financialYear: string;
  fact: IndependenceFactKind;
}

export interface IndependenceProposal {
  /** The client is a company (s.144 applies to companies only). */
  isCompany: boolean;
  kind: EngagementKind;
  /** SA: the year audited; Compliance: the years the streams are added for;
   *  assignment: its financial year. */
  financialYears: readonly string[];
  /** Compliance: the streams being added. */
  streams?: readonly Stream[];
  /** Assignment: the catalogue codes it carries. */
  serviceCodes?: readonly string[];
  /** s.144 board / audit-committee approval reference, when given. */
  s144ApprovalRef?: string | null;
  /** Adding to an existing engagement: its own facts are not a conflict. */
  engagementId?: string;
}

/** Bookkeeping, MIS (management services) and internal audit — s.144(a), (b), (d). */
const S144_PROHIBITED_STREAMS: readonly Stream[] = ['bookkeeping', 'mis'];
/** Filing streams a company's auditor may provide with board approval. */
const S144_PERMITTED_STREAMS: readonly Stream[] = ['gst', 'tds', 'income_tax', 'roc'];

export const INTERNAL_AUDIT_SERVICE_CODE = 'INT_AUDIT';
export const TAX_AUDIT_SERVICE_CODE = 'TAX_AUDIT';

const FACT_LABEL: Record<IndependenceFactKind, string> = {
  statutory_audit: 'the statutory audit',
  compliance: 'the Compliance engagement',
  bookkeeping: STREAM_LABEL.bookkeeping,
  mis: STREAM_LABEL.mis,
  internal_audit: 'Internal Audit',
  tax_audit: 'the tax audit',
};

/** "FY 2025-26 (SA/00012)" / "FY 2025-26 (SA/00012) and FY 2026-27 (SA/00031)". */
function where(facts: readonly IndependenceFact[]): string {
  const parts = [
    ...new Map(facts.map((f) => [`${f.financialYear}|${f.engagementCode}`, f])).values(),
  ]
    .sort((a, b) => a.financialYear.localeCompare(b.financialYear))
    .map((f) => `FY ${f.financialYear} (${f.engagementCode})`);
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function firstYear(facts: readonly IndependenceFact[]): string | null {
  return facts.map((f) => f.financialYear).sort()[0] ?? null;
}

export function evaluateIndependence(
  p: IndependenceProposal,
  allFacts: readonly IndependenceFact[],
): IndependenceFinding[] {
  const years = new Set(p.financialYears);
  const facts = allFacts.filter((f) => f.engagementId !== p.engagementId);
  const overlapping = (...kinds: IndependenceFactKind[]): IndependenceFact[] =>
    facts.filter((f) => kinds.includes(f.fact) && years.has(f.financialYear));
  const streams = p.kind === 'compliance' ? (p.streams ?? []) : [];
  const codes = p.kind === 'assignment' ? (p.serviceCodes ?? []) : [];
  const findings: IndependenceFinding[] = [];

  // ── s.144: the company's auditor may not keep its books, run MIS or do its
  //    internal audit — either direction, for any overlapping year.
  if (p.isCompany) {
    const audits = overlapping('statutory_audit');
    const prohibited = [
      ...S144_PROHIBITED_STREAMS.filter((s) => streams.includes(s)).map((s) => STREAM_LABEL[s]),
      ...(codes.includes(INTERNAL_AUDIT_SERVICE_CODE) ? ['Internal Audit'] : []),
    ];
    if (prohibited.length && audits.length) {
      findings.push({
        rule: INDEPENDENCE_RULE.s144Prohibited,
        outcome: 'block',
        financialYear: firstYear(audits),
        message:
          `Section 144 of the Companies Act, 2013: the firm audits this company for ` +
          `${where(audits)}, so it cannot also provide ${prohibited.join(' or ')} for that year.`,
      });
    }

    if (p.kind === 'statutory_audit') {
      const conflicts = overlapping('bookkeeping', 'mis', 'internal_audit');
      if (conflicts.length) {
        const what = [...new Set(conflicts.map((f) => FACT_LABEL[f.fact]))].join(' and ');
        findings.push({
          rule: INDEPENDENCE_RULE.s144Reverse,
          outcome: 'block',
          financialYear: firstYear(conflicts),
          message:
            `Section 144 of the Companies Act, 2013: ${what} is in scope for this company for ` +
            `${where(conflicts)}. End it for those years before the firm takes the audit.`,
        });
      }
    }

    const permitted = S144_PERMITTED_STREAMS.filter((s) => streams.includes(s));
    if (permitted.length && audits.length) {
      const approved = Boolean(p.s144ApprovalRef?.trim());
      findings.push({
        rule: INDEPENDENCE_RULE.s144Permitted,
        outcome: approved ? 'pass' : 'warn',
        financialYear: firstYear(audits),
        message: approved
          ? `Section 144 permitted services with approval ${p.s144ApprovalRef!.trim()}.`
          : `The firm audits this company for ${where(audits)}. ` +
            `${permitted.map((s) => STREAM_LABEL[s]).join(', ')} ` +
            `${permitted.length === 1 ? 'is' : 'are'} permitted under section 144 with the ` +
            `board's or audit committee's approval — record its reference on the year.`,
      });
    }
  }

  // ── s.44AB: the accountant who keeps the books cannot do the tax audit.
  const addsBooks = streams.includes('bookkeeping');
  const addsTaxAudit = codes.includes(TAX_AUDIT_SERVICE_CODE);
  const taxConflicts = [
    ...(addsBooks ? overlapping('tax_audit') : []),
    ...(addsTaxAudit ? overlapping('bookkeeping') : []),
  ];
  if (taxConflicts.length) {
    findings.push({
      rule: INDEPENDENCE_RULE.taxAuditBookkeeper,
      outcome: 'block',
      financialYear: firstYear(taxConflicts),
      message: addsBooks
        ? `Section 44AB: the firm does this client's tax audit for ${where(taxConflicts)}, ` +
          `so it cannot also keep its books for that year (ICAI guidance).`
        : `Section 44AB: the firm keeps this client's books for ${where(taxConflicts)}, ` +
          `so it cannot also do the tax audit for that year (ICAI guidance).`,
    });
  }

  // ── A statutory audit of a firm, trust or society: the partner acknowledges.
  if (p.kind === 'statutory_audit' && !p.isCompany) {
    findings.push({
      rule: INDEPENDENCE_RULE.nonCompanyAudit,
      outcome: 'warn',
      financialYear: p.financialYears[0] ?? null,
      requiresAcknowledgement: true,
      message:
        'This client is not a company, so section 144 does not apply. The partner confirms ' +
        'the firm is independent of it (no bookkeeping, management or internal audit role).',
    });
  }

  return findings;
}

/** The first hard block, if any. */
export function independenceBlock(findings: readonly IndependenceFinding[]) {
  return findings.find((f) => f.outcome === 'block') ?? null;
}

/** Warnings that still need an acknowledgement the caller has not given. */
export function unacknowledged(
  findings: readonly IndependenceFinding[],
  acknowledged: readonly string[] = [],
): IndependenceFinding[] {
  return findings.filter((f) => f.requiresAcknowledgement && !acknowledged.includes(f.rule));
}

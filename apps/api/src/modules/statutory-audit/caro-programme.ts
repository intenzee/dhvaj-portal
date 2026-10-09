import {
  CARO_CLAUSE_CONCLUSION,
  CARO_CONSOLIDATED_STATE,
  CARO_PROGRAMME_STATE,
  CARO_RELEVANCE,
  CARO_REPORT_CONTEXT,
  type CaroAnnexureDraft,
  type CaroClauseConclusion,
  type CaroComponentApplicable,
  type CaroConsolidatedState,
  type CaroLibraryClause,
  type CaroProgrammeLevel1,
  type CaroProgrammeState,
  type CaroProgrammeSummary,
  type CaroRelevance,
  type CaroReportContext,
} from '@hsdg/contracts';

/**
 * 02.4 CARO 2020 clause work programme — pure planning (DHVAJ 02.4 spec §11–§14,
 * §18). The service reads Level 1, the library and the stored items, and writes
 * what this plans; nothing here touches a database, so it unit-tests directly.
 *
 *   • Which library rows are in force for the audit period, and which of them
 *     carry work (a clause with sub-clauses is only a heading).
 *   • What the Level-1 conclusion asks of the programme: instantiate the
 *     standalone paragraph-3 items, configure 3(xxi) for the CFS, or withdraw.
 *     Level 2 (a clause's relevance to the facts) never feeds back into it.
 *   • What still blocks a clause's approval, the programme summary and the
 *     draft CARO annexure built from the approved conclusions.
 */

// ── Library ──────────────────────────────────────────────────────────────────

const inForce = (c: { effectiveFrom: string; effectiveTo: string | null }, on: string) =>
  c.effectiveFrom <= on && (c.effectiveTo == null || c.effectiveTo >= on);

/** The library rows in force on `on`, one per clause code (latest version wins). */
export function clausesInForce(
  library: readonly CaroLibraryClause[],
  on: string,
): CaroLibraryClause[] {
  const byCode = new Map<string, CaroLibraryClause>();
  for (const c of library) {
    if (!inForce(c, on)) continue;
    const seen = byCode.get(c.clauseCode);
    if (!seen || seen.effectiveFrom < c.effectiveFrom) byCode.set(c.clauseCode, c);
  }
  return [...byCode.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface WorkClause extends CaroLibraryClause {
  parentTitle: string | null;
}

/**
 * The clauses that carry work, for one report context: every sub-clause, and
 * every clause without sub-clauses. A clause with sub-clauses is a heading.
 */
export function workClauses(
  clauses: readonly CaroLibraryClause[],
  context: CaroReportContext,
): WorkClause[] {
  const parents = new Set(clauses.map((c) => c.parentClauseCode).filter(Boolean));
  const titles = new Map(clauses.map((c) => [c.clauseCode, c.title]));
  return clauses
    .filter((c) => c.reportContext === context && !parents.has(c.clauseCode))
    .map((c) => ({
      ...c,
      parentTitle: c.parentClauseCode ? (titles.get(c.parentClauseCode) ?? null) : null,
    }));
}

/** 02.3 requirement IDs for the library's division-agnostic Schedule III keys. */
export function scheduleIiiRequirementCodes(
  keys: readonly string[],
  division: string | null,
): string[] {
  if (!division) return [];
  return keys.map((k) => `SCH3_${division}_${k}`);
}

// ── Level 1 → programme ──────────────────────────────────────────────────────

export type ContextAction = 'ensure' | 'withdraw' | 'keep';

export interface ProgrammePlan {
  state: CaroProgrammeState;
  reason: string;
  standalone: ContextAction;
  consolidated: ContextAction;
  consolidatedState: CaroConsolidatedState;
}

/**
 * What the 02.4 Level-1 result asks of the programme (spec §11, §12, §14).
 *
 * Nothing is generated before a professional conclusion; once decided, the
 * standalone items exist exactly when CARO applies to the standalone report and
 * the 3(xxi) item exists when consolidated financial statements are in scope
 * and CARO is not concluded inapplicable to them (pending 02.6 configures it as
 * pending). Anything no longer required is withdrawn, never deleted. While
 * 02.4 is reopened (no conclusion), existing items are left as they are.
 */
export function planProgramme(
  level1: CaroProgrammeLevel1 | null,
  existing: { status: 'active' | 'withdrawn' } | null,
  hasLibrary: boolean,
): ProgrammePlan {
  if (!level1 || !level1.decided) {
    return {
      state: existing ? existing.status : CARO_PROGRAMME_STATE.awaitingConclusion,
      reason: existing
        ? '02.4 is being re-evaluated — the clause programme stays as it is until the applicability is concluded again.'
        : 'The CARO work programme is generated once the applicability conclusion is confirmed.',
      standalone: 'keep',
      consolidated: 'keep',
      consolidatedState:
        level1?.cfsInScope && existing
          ? CARO_CONSOLIDATED_STATE.pending
          : CARO_CONSOLIDATED_STATE.notRequired,
    };
  }

  const standaloneNeeded = level1.standaloneApplies === true;
  const consolidatedNeeded =
    level1.cfsInScope &&
    (level1.consolidatedApplies === true || level1.consolidatedStatus === 'pending');
  const consolidatedState: CaroConsolidatedState = !consolidatedNeeded
    ? CARO_CONSOLIDATED_STATE.notRequired
    : level1.consolidatedStatus === 'pending'
      ? CARO_CONSOLIDATED_STATE.pending
      : CARO_CONSOLIDATED_STATE.configured;

  if (!standaloneNeeded && !consolidatedNeeded) {
    return {
      state: existing ? CARO_PROGRAMME_STATE.withdrawn : CARO_PROGRAMME_STATE.notApplicable,
      reason: existing
        ? 'CARO is now concluded not applicable — the clause items are withdrawn and kept for the record.'
        : 'CARO does not apply to this report, so there is no clause work programme.',
      standalone: existing ? 'withdraw' : 'keep',
      consolidated: existing ? 'withdraw' : 'keep',
      consolidatedState,
    };
  }
  if (!hasLibrary) {
    return {
      state: CARO_PROGRAMME_STATE.noLibrary,
      reason:
        'CARO applies, but the clause library has no Order version in force for this audit period — a methodology administrator must add it.',
      standalone: 'keep',
      consolidated: 'keep',
      consolidatedState,
    };
  }
  return {
    state: CARO_PROGRAMME_STATE.active,
    reason: standaloneNeeded
      ? consolidatedNeeded
        ? 'CARO applies to the standalone report (paragraph 3 programme) and the consolidated report (clause 3(xxi) only).'
        : 'CARO applies to the standalone report — the paragraph 3 clause programme is instantiated.'
      : 'CARO applies to the consolidated report only to the extent of clause 3(xxi).',
    standalone: standaloneNeeded ? 'ensure' : existing ? 'withdraw' : 'keep',
    consolidated: consolidatedNeeded ? 'ensure' : existing ? 'withdraw' : 'keep',
    consolidatedState,
  };
}

// ── Approval ─────────────────────────────────────────────────────────────────

export interface BlockerInput {
  relevance: CaroRelevance;
  relevanceReason: string | null;
  conclusion: CaroClauseConclusion | null;
  draftReporting: string | null;
  requiresPartnerReview: boolean;
  partnerReviewed: boolean;
  findings: ReadonlyArray<{ status: 'open' | 'resolved'; includeInReport: boolean; withdrawn: boolean }>;
  components: ReadonlyArray<{
    caroApplicable: CaroComponentApplicable;
    qualificationIdentified: boolean | null;
    paragraphRefs: string | null;
    withdrawn: boolean;
  }>;
}

const blank = (s: string | null | undefined) => !s || s.trim().length === 0;

/**
 * What still stops a clause conclusion from being submitted / approved. The
 * partner review (3(xxi), or any clause the library flags) is needed for
 * approval only — `forSubmit` leaves it out.
 */
export function approvalBlockers(i: BlockerInput, forSubmit = false): string[] {
  const out: string[] = [];
  const N = CARO_CLAUSE_CONCLUSION;
  if (i.relevance === CARO_RELEVANCE.assessmentRequired) {
    out.push("Decide the clause's relevance to the entity's facts.");
  }
  if (i.relevance === CARO_RELEVANCE.notApplicableToFacts && blank(i.relevanceReason)) {
    out.push('Give the reason the clause is not applicable to the facts.');
  }
  if (i.conclusion == null) {
    out.push('Record the clause conclusion.');
  } else if (i.conclusion === N.furtherWorkRequired) {
    out.push('Further work is required — complete it and record the final conclusion.');
  } else if (
    (i.conclusion === N.notApplicableToFacts) !==
    (i.relevance === CARO_RELEVANCE.notApplicableToFacts)
  ) {
    out.push(
      i.conclusion === N.notApplicableToFacts
        ? 'A clause concluded Not applicable to facts must be marked Not Applicable to Facts.'
        : 'A clause Not Applicable to Facts concludes Not applicable to facts.',
    );
  }
  if (
    (i.conclusion === N.noReportableException || i.conclusion === N.reportableMatter) &&
    blank(i.draftReporting)
  ) {
    out.push('Draft the proposed reporting language.');
  }
  const live = i.findings.filter((f) => !f.withdrawn);
  if (i.conclusion === N.reportableMatter && !live.some((f) => f.includeInReport)) {
    out.push('Record the finding behind the reportable matter (included in reporting).');
  }
  if (
    i.conclusion === N.noReportableException &&
    live.some((f) => f.status === 'open' && f.includeInReport)
  ) {
    out.push(
      'Open findings are marked for reporting — resolve or exclude them, or conclude Reportable matter.',
    );
  }
  const comps = i.components.filter((c) => !c.withdrawn);
  if (comps.some((c) => c.caroApplicable === 'pending')) {
    out.push('Decide whether CARO applies to each company included in the CFS.');
  }
  if (comps.some((c) => c.caroApplicable === 'yes' && c.qualificationIdentified == null)) {
    out.push("Record whether each component's CARO report has qualifications or adverse remarks.");
  }
  if (comps.some((c) => c.qualificationIdentified === true && blank(c.paragraphRefs))) {
    out.push('Capture the CARO paragraph numbers of each qualification or adverse remark.');
  }
  if (!forSubmit && i.requiresPartnerReview && !i.partnerReviewed) {
    out.push('Engagement Partner review is required before approval.');
  }
  return out;
}

// ── Summary + annexure ───────────────────────────────────────────────────────

export interface SummaryItem {
  relevance: CaroRelevance;
  conclusion: CaroClauseConclusion | null;
  reviewState: string;
  withdrawn: boolean;
  openFindings: number;
}

export function summarise(items: readonly SummaryItem[]): CaroProgrammeSummary {
  const live = items.filter((i) => !i.withdrawn);
  return {
    total: live.length,
    applicable: live.filter((i) => i.relevance === CARO_RELEVANCE.applicable).length,
    notApplicableToFacts: live.filter((i) => i.relevance === CARO_RELEVANCE.notApplicableToFacts)
      .length,
    assessmentRequired: live.filter((i) => i.relevance === CARO_RELEVANCE.assessmentRequired)
      .length,
    approved: live.filter((i) => i.reviewState === 'approved').length,
    reportable: live.filter((i) => i.conclusion === CARO_CLAUSE_CONCLUSION.reportableMatter)
      .length,
    openFindings: live.reduce((n, i) => n + i.openFindings, 0),
  };
}

export interface AnnexureItem {
  clauseCode: string;
  clauseRef: string;
  title: string;
  reportContext: CaroReportContext;
  conclusion: CaroClauseConclusion | null;
  draftReporting: string | null;
  reviewState: string;
  withdrawn: boolean;
  sortOrder: number;
}

/**
 * The draft CARO annexure for one report context (spec §18): every live clause
 * in library order, with its approved reporting language. Unapproved clauses
 * appear without text so the draft shows what is outstanding. A clause
 * approved Not applicable to facts with no drafted wording reports the
 * standard non-applicability statement.
 */
export function buildAnnexure(
  workflowInstanceId: string,
  items: readonly AnnexureItem[],
  context: CaroReportContext,
  order: { title: string; versionLabel: string } | null,
): CaroAnnexureDraft {
  const live = items
    .filter((i) => !i.withdrawn && i.reportContext === context)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const paragraphs = live.map((i) => {
    const approved = i.reviewState === 'approved';
    let text: string | null = null;
    if (approved) {
      text = i.draftReporting?.trim() || null;
      if (!text && i.conclusion === CARO_CLAUSE_CONCLUSION.notApplicableToFacts) {
        text = `The provisions of clause ${i.clauseRef} of the Order are not applicable to the Company.`;
      }
    }
    return {
      clauseCode: i.clauseCode,
      clauseRef: i.clauseRef,
      title: i.title,
      text,
      conclusion: i.conclusion,
      approved,
      reportable: i.conclusion === CARO_CLAUSE_CONCLUSION.reportableMatter,
    };
  });
  const approvedCount = paragraphs.filter((p) => p.approved).length;
  return {
    workflowInstanceId,
    reportContext: context,
    heading:
      context === CARO_REPORT_CONTEXT.consolidated
        ? `${order?.title ?? 'CARO'} — clause 3(xxi) (consolidated financial statements)`
        : `Annexure to the Independent Auditor's Report — ${order?.title ?? 'CARO'}`,
    orderVersionLabel: order?.versionLabel ?? null,
    paragraphs,
    complete: paragraphs.length > 0 && approvedCount === paragraphs.length,
    approvedCount,
    totalCount: paragraphs.length,
    reportableCount: paragraphs.filter((p) => p.reportable).length,
  };
}

// ── Section 06 procedures (spec §18 — replaces the generic CARO templates) ───

export interface ClauseProcedureInput {
  clauseCode: string;
  clauseRef: string;
  title: string;
  requirement: string;
  relevance: CaroRelevance;
  reportContext: CaroReportContext;
  procedures: ReadonlyArray<{ title: string; objective: string; evidence: string | null }>;
  withdrawn: boolean;
}

export interface PlannedClauseProcedure {
  sourceKey: string;
  sourceNote: string;
  title: string;
  objective: string;
  expectedEvidence: string | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The Section 06 source key of a clause's procedure. */
export const caroProcedureSourceKey = (clauseCode: string) => `caro:${clauseCode}`;

/**
 * One Section 06 procedure per live clause item in the CARO work area — the
 * methodology procedures of the clause folded into one workpaper. A clause
 * the team marked Not Applicable to Facts gets none.
 */
export function planClauseProcedures(
  items: readonly ClauseProcedureInput[],
): PlannedClauseProcedure[] {
  return items
    .filter((i) => !i.withdrawn && i.relevance !== CARO_RELEVANCE.notApplicableToFacts)
    .map((i) => ({
      sourceKey: caroProcedureSourceKey(i.clauseCode),
      sourceNote: `02.4 CARO clause ${i.clauseRef}${
        i.reportContext === CARO_REPORT_CONTEXT.consolidated ? ' (consolidated)' : ''
      }`,
      title: clip(`CARO ${i.clauseRef} — ${i.title}`, 160),
      objective: clip(
        i.procedures.length
          ? i.procedures.map((p) => `${p.title}: ${p.objective}`).join(' ')
          : i.requirement,
        4000,
      ),
      expectedEvidence:
        i.procedures
          .map((p) => p.evidence)
          .filter((e): e is string => !!e)
          .join(' ') || null,
    }));
}

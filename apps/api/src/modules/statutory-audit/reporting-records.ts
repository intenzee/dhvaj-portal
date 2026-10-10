import {
  REPORTING_APPLICABILITY,
  REPORTING_WORK_CONFIGURED,
  type DirectorDisqualificationStatus,
  type FraudFrameworkStatus,
  type OtherReportingCompletionSummary,
  type ReportingCard,
  type ReportingCardKey,
  type ReportingCrossRefLink,
  type ReportingCrossRefs,
  type Tri,
} from '@hsdg/contracts';

/**
 * 02.7 Track B — pure planning over the 02.7 cards and records (no I/O):
 *
 *   • the Section 06 procedures, one per card with a reporting obligation
 *     (spec §17 "Work configured"), replacing the single generic
 *     auditor's-reporting procedure;
 *   • the 02.4 / 02.5 / 02.6 cross-reference lines (spec §15, §17) — status read
 *     from the source module, never a copied conclusion;
 *   • the Section 07 completion summary and the Rule 11(e) representations the
 *     Management Representation Letter carries.
 */

/** The Section 06 work area for auditor's reporting (rule_11 / section_143 workstream). */
export const REPORTING_WORK_AREA_KEY = 'auditor_reporting';
export const reportingProcedureSourceKey = (cardKey: string) => `r027:${cardKey}`;

export interface PlannedReportingProcedure {
  sourceKey: string;
  sourceNote: string;
  title: string;
  objective: string;
  expectedEvidence: string | null;
}

const CARD_WORK: Partial<Record<ReportingCardKey, { objective: string; evidence: string }>> = {
  s143_3_a_information: {
    objective:
      'Confirm all information and explanations necessary for the audit were sought and obtained; list any request not met and its effect on the report.',
    evidence: 'Information request log; unresolved requests with management responses.',
  },
  s143_3_b_books: {
    objective:
      'Assess whether proper books of account as required by law have been kept, so far as appears from the examination of those books, including backup and the audit-trail bearing on the books.',
    evidence:
      'Books of account review; Section 128 compliance notes; backup / server location evidence.',
  },
  s143_3_b_branch_returns: {
    objective:
      'Confirm proper returns adequate for the audit were received from branches not visited, and record any gap.',
    evidence: 'Branch returns received; list of branches not visited (02.6).',
  },
  s143_3_c_branch_report: {
    objective:
      'Confirm each branch auditor’s report under Section 143(8) was sent to us and record how it was dealt with in preparing this report.',
    evidence: 'Branch auditor reports; principal-auditor responses (02.6).',
  },
  s143_3_d_agreement: {
    objective:
      'Agree the balance sheet, statement of profit and loss (and cash flow statement) with the books of account and the branch returns.',
    evidence: 'Trial balance to financial statements reconciliation; branch return tie-out.',
  },
  s143_3_e_standards: {
    objective:
      'Conclude whether the financial statements comply with the accounting standards specified under Section 133, consistent with the 02.2 framework and the AS / Ind AS checklist.',
    evidence: 'Completed AS / Ind AS compliance checklist; departures and their effect.',
  },
  s143_3_f_adverse_comments: {
    objective:
      'Identify observations or comments on financial transactions or matters with any adverse effect on the functioning of the company, and draft the wording where one exists.',
    evidence: 'Schedule of matters considered; draft comment with its basis.',
  },
  s143_3_g_director_disqualification: {
    objective:
      'Complete the Section 164(2) workpaper for every director: written representations taken on record by the Board, MCA / DIR-8 evidence and the legal analysis — never a DIN-status shortcut.',
    evidence:
      'Directors’ written representations (DIR-8); Board minutes; MCA records; 164(2) workpaper.',
  },
  s143_3_h_accounts_qualification: {
    objective:
      'Identify any qualification, reservation or adverse remark relating to the maintenance of accounts and other matters connected with it.',
    evidence: 'Books-of-account exceptions; cross-reference to Rule 11(g) audit-trail findings.',
  },
  s143_3_i_icfr: {
    objective:
      'Report on the adequacy and operating effectiveness of internal financial controls with reference to financial statements, from the 02.5 ICFR workstream conclusion.',
    evidence: 'ICFR workstream conclusion and deficiency evaluation (02.5).',
  },
  s143_3_j_other_prescribed: {
    objective:
      'Cover the other matters prescribed under Rule 11 and Section 197(16) in the report, consistent with the Rule 11 cards.',
    evidence: 'Rule 11 workings; Section 197(16) computation.',
  },
  rule_11_a_litigation: {
    objective:
      'Obtain the list of pending litigations, legal confirmations and management’s assessment; check the impact on the financial position is disclosed in the financial statements.',
    evidence: 'Litigation register; legal confirmations; contingent-liability / provision note.',
  },
  rule_11_b_foreseeable_losses: {
    objective:
      'Check provision is made, as required under law or accounting standards, for material foreseeable losses on long-term contracts including derivative contracts.',
    evidence:
      'Schedule of long-term and derivative contracts; loss assessment; provision workings.',
  },
  rule_11_c_iepf: {
    objective:
      'Check amounts required to be transferred to the Investor Education and Protection Fund were transferred without delay, and quantify any delay.',
    evidence: 'Unpaid dividend account ageing; IEPF-1 / IEPF-4 filings; transfer challans.',
  },
  rule_11_e_funds_advanced: {
    objective:
      'Obtain management’s Rule 11(e)(i) representation on funds advanced, loaned or invested through intermediaries for ultimate beneficiaries, and perform procedures supporting the Rule 11(e)(iii) statement.',
    evidence:
      'Management representation (MRL); loans / advances / investments testing; related-party review.',
  },
  rule_11_e_funds_received: {
    objective:
      'Obtain management’s Rule 11(e)(ii) representation on funds received from funding parties for ultimate beneficiaries, and perform procedures supporting the Rule 11(e)(iii) statement.',
    evidence: 'Management representation (MRL); borrowings / receipts testing.',
  },
  rule_11_f_dividend: {
    objective:
      'Check dividend declared or paid during the year (interim and final) complies with Section 123.',
    evidence: 'Board / AGM resolutions; profit availability workings; dividend bank account.',
  },
  rule_11_g_audit_trail: {
    objective:
      'For each accounting software / module: audit trail (edit log) feature, operated throughout the year for all relevant transactions, not tampered with, and preserved as required.',
    evidence: 'Audit-trail register; system configuration evidence; service-organisation reports.',
  },
  s197_16_remuneration: {
    objective:
      'Recompute managerial remuneration against Section 197 and Schedule V limits on Section 198 net profits, and check the approvals; quantify any excess.',
    evidence:
      'Section 198 computation; remuneration schedule; shareholder / Central Government approvals.',
  },
  s143_12_fraud: {
    objective:
      'Consider whether any fraud by officers or employees is being or has been committed against the company; for each Fraud Matter apply the Rule 13 route and deadlines and record the conclusion.',
    evidence:
      'Fraud Matter records; Board / Audit Committee communications; Form ADT-4 where filed.',
  },
};

/**
 * One Section 06 procedure per card with a reporting obligation. Cross-reference
 * cards (CARO, ICFR, branch reporting where 02.4 / 02.5 / 02.6 hold the work)
 * plan none — their own modules supply the work.
 */
export function planReportingProcedures(
  cards: ReadonlyArray<
    Pick<ReportingCard, 'key' | 'requirement' | 'clause' | 'applicability' | 'workConfigured'>
  >,
): PlannedReportingProcedure[] {
  const out: PlannedReportingProcedure[] = [];
  for (const c of cards) {
    if (
      c.applicability !== REPORTING_APPLICABILITY.applicable &&
      c.applicability !== REPORTING_APPLICABILITY.conditional
    )
      continue;
    if (c.workConfigured === REPORTING_WORK_CONFIGURED.crossReference) continue;
    if (c.workConfigured === REPORTING_WORK_CONFIGURED.no) continue;
    const work = CARD_WORK[c.key];
    const title = `${c.clause} — ${c.requirement}`;
    out.push({
      sourceKey: reportingProcedureSourceKey(c.key),
      sourceNote:
        c.applicability === REPORTING_APPLICABILITY.conditional
          ? '02.7 — Other Companies Act reporting (conditional)'
          : '02.7 — Other Companies Act reporting',
      title: title.length > 160 ? `${title.slice(0, 157)}…` : title,
      objective:
        work?.objective ??
        `Perform the work supporting the ${c.clause} reporting and record the conclusion on the 02.7 card.`,
      expectedEvidence: work?.evidence ?? null,
    });
  }
  return out;
}

// ── Cross-references (spec §15, §17) ───────────────────────────────────────

const yesNo = (v: boolean | null, yes: string, no: string, unknown: string) =>
  v === null ? unknown : v ? yes : no;
const human = (s: string | null) => (s ? s.replace(/_/g, ' ') : null);

export function crossRefLinksOf(x: ReportingCrossRefs): ReportingCrossRefLink[] {
  const caroLines = [
    yesNo(
      x.caro.applicable,
      'CARO 2020 applies',
      'CARO 2020 does not apply',
      'CARO applicability not yet decided',
    ),
  ];
  if (x.caro.conclusion) caroLines.push(`02.4 conclusion: ${human(x.caro.conclusion)}`);
  if (x.caro.applicable) {
    caroLines.push(
      x.caro.reportableClauses > 0
        ? `${x.caro.reportableClauses} clause(s) with a reportable matter`
        : 'No clause with a reportable matter recorded',
    );
  }
  caroLines.push(x.caro.complete ? '02.4 complete' : '02.4 not yet complete');

  const icfrLines = [
    yesNo(
      x.icfr.reportingRequired,
      'Section 143(3)(i) reporting required',
      'Section 143(3)(i) reporting not required (exempt)',
      'ICFR applicability not yet decided',
    ),
  ];
  if (x.icfr.conclusion) icfrLines.push(`02.5 conclusion: ${human(x.icfr.conclusion)}`);
  if (x.icfr.reportingRequired) {
    icfrLines.push(
      x.icfr.deficiencies > 0
        ? `${x.icfr.deficiencies} open deficiency(ies) in the ICFR workstream`
        : 'No open ICFR deficiency',
    );
  }
  icfrLines.push(x.icfr.complete ? '02.5 complete' : '02.5 not yet complete');

  const g = x.group;
  const groupLines: string[] = [];
  groupLines.push(
    g.cfsConclusion ? `02.6 conclusion: ${human(g.cfsConclusion)}` : '02.6 not yet concluded',
  );
  groupLines.push(
    yesNo(
      g.branchesExist,
      `Branch audit present — ${g.branchAuditors} branch auditor(s) (BR-01)`,
      'No branch audited by another auditor (BR-01)',
      'Branch audit (BR-01) not yet answered',
    ),
  );
  if (g.branchesExist) {
    groupLines.push(
      `${g.branchReportsDealt} branch report(s) dealt with, ${g.branchReportsPending} pending`,
    );
    groupLines.push(
      g.branchReturnsReceived === null
        ? 'Branch returns: not recorded'
        : g.branchReturnsReceived
          ? 'Proper returns received from every branch not visited'
          : 'Proper returns still missing from a branch not visited',
    );
  }

  return [
    {
      key: 'caro',
      label: 'CARO 2020 (02.4)',
      subSectionKey: '02.4',
      finalStage: '02.4 CARO conclusion and clause programme',
      lines: caroLines,
      attention: x.caro.applicable === null || (x.caro.applicable === true && !x.caro.complete),
    },
    {
      key: 'icfr',
      label: 'Internal financial controls — Section 143(3)(i) (02.5)',
      subSectionKey: '02.5',
      finalStage: '02.5 ICFR workstream conclusion',
      lines: icfrLines,
      attention:
        x.icfr.reportingRequired === null ||
        (x.icfr.reportingRequired === true && (!x.icfr.complete || x.icfr.deficiencies > 0)),
    },
    {
      key: 'group',
      label: 'Consolidation and branch reporting (02.6)',
      subSectionKey: '02.6',
      finalStage: '02.6 group / branch audit conclusion',
      lines: groupLines,
      attention:
        g.branchesExist === null ||
        (g.branchesExist === true &&
          (g.branchReportsPending > 0 || g.branchReturnsReceived === false)),
    },
  ];
}

// ── Section 07 / MRL ───────────────────────────────────────────────────────

/** The Rule 11(e) representations the MRL carries (spec §9 — linked to Section 07). */
export function mrlRepresentationsOf(
  advanced: { representationObtained?: Tri } | null | undefined,
  received: { representationObtained?: Tri } | null | undefined,
): OtherReportingCompletionSummary['mrlRepresentations'] {
  return [
    {
      key: 'rule_11_e_i',
      label:
        'Rule 11(e)(i) — no funds advanced, loaned or invested by the company to or in any intermediary for onward lending or investment in, or guarantee or security for, ultimate beneficiaries (other than as disclosed).',
      obtained: advanced?.representationObtained ?? 'pending',
    },
    {
      key: 'rule_11_e_ii',
      label:
        'Rule 11(e)(ii) — no funds received by the company from any funding party for onward lending or investment in, or guarantee or security for, ultimate beneficiaries (other than as disclosed).',
      obtained: received?.representationObtained ?? 'pending',
    },
  ];
}

export function completionSummaryOf(input: {
  decided: boolean;
  cards: ReadonlyArray<
    Pick<
      ReportingCard,
      'key' | 'requirement' | 'clause' | 'applicability' | 'systemReportingStatus' | 'state'
    >
  >;
  fraud: FraudFrameworkStatus;
  directors: DirectorDisqualificationStatus;
  rule11eAdvanced: { representationObtained?: Tri } | null | undefined;
  rule11eReceived: { representationObtained?: Tri } | null | undefined;
}): OtherReportingCompletionSummary {
  return {
    decided: input.decided,
    cards: input.cards
      .filter(
        (c) =>
          c.applicability === REPORTING_APPLICABILITY.applicable ||
          c.applicability === REPORTING_APPLICABILITY.conditional,
      )
      .map((c) => ({
        key: c.key,
        requirement: c.requirement,
        clause: c.clause,
        workStatus: c.state?.workStatus ?? 'not_started',
        reportingStatus: c.state?.reportingStatus ?? c.systemReportingStatus,
      })),
    fraud: input.fraud,
    directors: input.directors,
    mrlRepresentations: mrlRepresentationsOf(input.rule11eAdvanced, input.rule11eReceived),
  };
}

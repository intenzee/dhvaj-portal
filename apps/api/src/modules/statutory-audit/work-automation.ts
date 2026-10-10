import type { PlannedClauseProcedure } from './caro-programme';
import { CONSOLIDATION_WORK_AREA_KEY, type PlannedConsolidationProcedure } from './group-audit';
import { REPORTING_WORK_AREA_KEY, type PlannedReportingProcedure } from './reporting-records';
import { ICFR_WORK_AREA_KEY, type PlannedIcfrProcedure } from './icfr-controls';
import type {
  AreaRiskLevel,
  AssertionId,
  ProcedureAssertion,
  RiskRating,
  SmcRelaxation,
} from '@hsdg/contracts';

/**
 * Section 05 / 06 audit work, from what the file already knows (Guide §1,
 * capture once). Pure: the service reads Sections 03–04 and writes what this
 * plans.
 *
 *   • Work areas — besides the framework workstreams (§20), every audit area
 *     the team retained in 03.5 becomes a work area of its own, plus one area
 *     for the overall / cross-cutting responses (SA 240 / SA 330).
 *   • Area detail — owner, reviewer, risk level, materiality, due date and the
 *     current / prior-year figures, filled only where the team left a blank.
 *   • Procedures — one per Section 04 risk (its planned response, in the area
 *     it belongs to), a substantive set per 03.5 area, and the standard
 *     programme for each framework workstream. Each has a stable `sourceKey`
 *     so a suggestion the team deleted is never suggested again.
 */

export const OVERALL_WORK_AREA_KEY = 'overall_responses';
/** The framework workstream the 02.4 CARO clause procedures live in. */
export const CARO_WORK_AREA_KEY = 'caro';

export interface FsAreaInput {
  id: string;
  seq: number;
  code: string | null;
  name: string;
  aliases: string[];
  attention: 'standard' | 'enhanced';
  cy: number | null;
  py: number | null;
  unitLabel: string | null;
  /** Active 03.5 assertions. */
  assertions: AssertionId[];
}

export interface RiskInput {
  id: string;
  ref: string;
  description: string;
  fsArea: string | null;
  assertion: ProcedureAssertion | null;
  rating: RiskRating;
  isSignificant: boolean;
  isFraudRisk: boolean;
  response: string | null;
  status: string;
  sourceKey: string | null;
}

export interface PlannedArea {
  workAreaKey: string;
  title: string;
  scope: string;
  source: string;
  originAreaKey: string | null;
  sortOrder: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function fsWorkAreaKey(a: { code: string | null; name: string }): string {
  const slug = (a.code ?? a.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 57);
  return `fs_${slug || 'area'}`;
}

/** The 03.5 areas and the overall-responses area as work areas. */
export function planPlanningWorkAreas(areas: readonly FsAreaInput[]): PlannedArea[] {
  const out: PlannedArea[] = [
    {
      workAreaKey: OVERALL_WORK_AREA_KEY,
      title: 'Overall responses & cross-cutting procedures',
      scope:
        'Responses to risks not tied to one area — management override (SA 240), journal entries, estimates, opening balances, final analytics.',
      source: 'planning:section_04',
      originAreaKey: null,
      sortOrder: 50,
    },
  ];
  const seen = new Set<string>([OVERALL_WORK_AREA_KEY]);
  for (const a of areas) {
    const key = fsWorkAreaKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      workAreaKey: key,
      title: a.name,
      scope: `Substantive work on ${a.name}${a.attention === 'enhanced' ? ' (Enhanced attention in 03.5)' : ''}.`,
      source: 'planning:03.5',
      originAreaKey: a.code,
      sortOrder: 100 + a.seq,
    });
  }
  return out;
}

// ── Risk → area ────────────────────────────────────────────────────────────

const STOP = new Set([
  'and',
  'the',
  'for',
  'from',
  'other',
  'with',
  'balance',
  'account',
  'net',
  'total',
  'current',
  'non',
  'closing',
]);
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/s$/, ''))
    .filter((t) => t.length > 2 && !STOP.has(t));

/** The 03.5 area a risk belongs to, or null (→ overall responses). */
export function areaForRisk(risk: RiskInput, areas: readonly FsAreaInput[]): FsAreaInput | null {
  if (risk.sourceKey?.startsWith('area:')) {
    const id = risk.sourceKey.slice('area:'.length);
    const hit = areas.find((a) => a.id === id);
    if (hit) return hit;
  }
  if (!risk.fsArea) return null;
  const want = new Set(tokens(risk.fsArea));
  if (want.size === 0) return null;
  let best: FsAreaInput | null = null;
  let bestScore = 0;
  for (const a of areas) {
    const have = new Set([a.name, ...a.aliases].flatMap(tokens));
    let score = 0;
    for (const t of want) if (have.has(t)) score += 1;
    if (score > bestScore) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}

// ── Area detail ────────────────────────────────────────────────────────────

const RANK: Record<AreaRiskLevel, number> = { low: 0, moderate: 1, high: 2, significant: 3 };

export interface AreaDetailFacts {
  ownerId: string | null;
  reviewerId: string | null;
  dueDate: string | null;
  performanceMateriality: number | null;
  specific: Array<{ pm: number | null; affectedAreas: string[] }>;
}

export interface AreaDetailPatch {
  ownerEmployeeId?: string;
  reviewerEmployeeId?: string;
  riskLevel?: AreaRiskLevel;
  materiality?: number;
  dueDate?: string;
  financialCurrent?: number;
  financialPrior?: number;
  financialSource?: string;
}

/**
 * The detail to write on one work area — blanks only. `current` is what the
 * area holds now; a field the team has filled is never in the patch.
 */
export function planAreaDetail(input: {
  workAreaKey: string;
  current: {
    ownerEmployeeId: string | null;
    reviewerEmployeeId: string | null;
    riskLevel: AreaRiskLevel | null;
    materiality: number | null;
    dueDate: string | null;
    financialCurrent: number | null;
    financialPrior: number | null;
  };
  fsArea: FsAreaInput | null;
  risks: readonly RiskInput[];
  facts: AreaDetailFacts;
}): AreaDetailPatch {
  const { current: c, fsArea, risks, facts } = input;
  const p: AreaDetailPatch = {};
  if (!c.ownerEmployeeId && facts.ownerId) p.ownerEmployeeId = facts.ownerId;
  if (!c.reviewerEmployeeId && facts.reviewerId) p.reviewerEmployeeId = facts.reviewerId;
  if (!c.dueDate && facts.dueDate) p.dueDate = facts.dueDate;

  if (!c.riskLevel) {
    let level: AreaRiskLevel | null = null;
    for (const r of risks) {
      const l: AreaRiskLevel = r.isSignificant ? 'significant' : r.rating;
      if (!level || RANK[l] > RANK[level]) level = l;
    }
    if (!level && fsArea) level = fsArea.attention === 'enhanced' ? 'moderate' : 'low';
    if (level) p.riskLevel = level;
  }

  const isPlanningArea = fsArea != null || input.workAreaKey === OVERALL_WORK_AREA_KEY;
  if (c.materiality == null && isPlanningArea) {
    const names = fsArea
      ? new Set(
          [fsArea.code, fsArea.name, ...fsArea.aliases]
            .filter((x): x is string => !!x)
            .map((x) => x.toLowerCase()),
        )
      : new Set<string>();
    const specific = facts.specific
      .filter((s) => s.pm != null && s.affectedAreas.some((x) => names.has(x.toLowerCase())))
      .map((s) => s.pm as number);
    const m = specific.length ? Math.min(...specific) : facts.performanceMateriality;
    if (m != null) p.materiality = m;
  }

  if (fsArea && c.financialCurrent == null && c.financialPrior == null) {
    if (fsArea.cy != null) p.financialCurrent = fsArea.cy;
    if (fsArea.py != null) p.financialPrior = fsArea.py;
    if (fsArea.cy != null || fsArea.py != null) {
      p.financialSource = `03.5 audit area review${fsArea.unitLabel ? ` (${fsArea.unitLabel})` : ''}`;
    }
  }
  return p;
}

// ── Procedures ─────────────────────────────────────────────────────────────

export interface SuggestedProcedure {
  sourceKey: string;
  sourceNote: string;
  workAreaKey: string;
  title: string;
  objective: string;
  assertions: ProcedureAssertion[];
  riskId: string | null;
  expectedEvidence: string | null;
}

const ASSERTION_MAP: Record<AssertionId, ProcedureAssertion> = {
  TX_OCC: 'occurrence',
  TX_COMP: 'completeness',
  TX_ACC: 'accuracy',
  TX_CUTOFF: 'cutoff',
  TX_CLASS: 'classification',
  BAL_EXIST: 'existence',
  BAL_RO: 'rights_and_obligations',
  BAL_COMP: 'completeness',
  BAL_VAL: 'valuation',
  PD_OCC_RO: 'presentation_and_disclosure',
  PD_COMP: 'presentation_and_disclosure',
  PD_CLASS_UND: 'presentation_and_disclosure',
  PD_ACC_VAL: 'presentation_and_disclosure',
};

export function procedureAssertions(ids: readonly AssertionId[]): ProcedureAssertion[] {
  return [...new Set(ids.map((i) => ASSERTION_MAP[i]).filter(Boolean))];
}

interface Template {
  key: string;
  title: string;
  objective: string;
  evidence: string;
  assertions: ProcedureAssertion[];
}

/** Area-specific procedures by keyword in the 03.5 area name. */
const FS_TEMPLATES: Array<{ match: RegExp; items: Template[] }> = [
  {
    match: /cash|bank/,
    items: [
      {
        key: 'confirm',
        title: 'Bank confirmations and reconciliations',
        objective:
          'Confirm period-end balances directly with each bank (SA 505) and test the bank reconciliations, following up old reconciling items.',
        evidence: 'Bank confirmations; bank reconciliations; post-period statements.',
        assertions: ['existence', 'completeness', 'rights_and_obligations'],
      },
    ],
  },
  {
    match: /receivable|debtor/,
    items: [
      {
        key: 'confirm',
        title: 'Receivables confirmations and ageing',
        objective:
          'Circularise a sample of balances (SA 505), perform alternative procedures on non-replies, and assess the ageing for expected credit loss / provisioning.',
        evidence: 'Confirmation replies; subsequent receipts; ageing analysis; ECL working.',
        assertions: ['existence', 'valuation'],
      },
    ],
  },
  {
    match: /payable|creditor/,
    items: [
      {
        key: 'unrecorded',
        title: 'Search for unrecorded liabilities and supplier confirmations',
        objective:
          'Examine payments and invoices after the period end for liabilities not recorded; confirm a sample of supplier balances (SA 505); check MSME dues and disclosure.',
        evidence: 'Post-period payments register; supplier statements / confirmations; MSME list.',
        assertions: ['completeness', 'cutoff'],
      },
    ],
  },
  {
    match: /^inventor|stock/,
    items: [
      {
        key: 'count',
        title: 'Inventory count attendance and valuation',
        objective:
          'Attend the physical count (SA 501) or perform alternative procedures; test cut-off; test valuation at lower of cost and NRV.',
        evidence: 'Count sheets and test counts; cut-off documents; NRV workings.',
        assertions: ['existence', 'valuation', 'cutoff'],
      },
    ],
  },
  {
    match: /revenue|sale|turnover/,
    items: [
      {
        key: 'cutoff',
        title: 'Revenue cut-off and occurrence testing',
        objective:
          'Test transactions either side of the period end for cut-off and vouch a sample of sales to contracts, dispatch documents and receipts.',
        evidence: 'Invoices; delivery / dispatch notes; contracts; credit notes after period end.',
        assertions: ['occurrence', 'cutoff', 'accuracy'],
      },
    ],
  },
  {
    match: /borrowing|debenture/,
    items: [
      {
        key: 'confirm',
        title: 'Borrowings confirmation, covenants and charges',
        objective:
          'Confirm balances with lenders, recompute interest, check covenant compliance and that charges are registered with the ROC.',
        evidence:
          'Lender confirmations; sanction letters; covenant calculations; ROC charge records.',
        assertions: ['completeness', 'presentation_and_disclosure', 'rights_and_obligations'],
      },
    ],
  },
  {
    match: /property|plant|equipment|fixed asset|ppe|capital work/,
    items: [
      {
        key: 'additions',
        title: 'Additions, disposals and depreciation',
        objective:
          'Vouch significant additions and disposals, recompute depreciation, and check physical verification and title deeds.',
        evidence: 'Invoices; capitalisation notes; fixed-asset register; title deeds.',
        assertions: ['existence', 'valuation', 'rights_and_obligations'],
      },
    ],
  },
  {
    match: /investment/,
    items: [
      {
        key: 'valuation',
        title: 'Investments existence and valuation',
        objective:
          'Confirm holdings with custodians / registrars and test the valuation and classification of investments.',
        evidence: 'Demat / custodian statements; valuation reports; board approvals.',
        assertions: ['existence', 'valuation', 'classification'],
      },
    ],
  },
  {
    match: /employee|payroll|salar|gratuity|benefit/,
    items: [
      {
        key: 'payroll',
        title: 'Payroll analytics and employee-benefit valuation',
        objective:
          'Perform payroll analytics against headcount, test statutory dues and review the actuarial valuation of employee benefits.',
        evidence: 'Payroll registers; PF / ESI challans; actuarial report.',
        assertions: ['occurrence', 'accuracy', 'valuation'],
      },
    ],
  },
  {
    match: /tax/,
    items: [
      {
        key: 'tax',
        title: 'Current and deferred tax computation',
        objective:
          'Review the tax computation, deferred-tax workings and the status of assessments and disputes.',
        evidence: 'Tax computation; returns; assessment orders; deferred-tax working.',
        assertions: ['valuation', 'completeness', 'presentation_and_disclosure'],
      },
    ],
  },
  {
    match: /provision|contingen|litigation/,
    items: [
      {
        key: 'legal',
        title: 'Provisions, litigation and legal confirmations',
        objective:
          'Obtain legal confirmations and management representations on claims (SA 501), and assess the recognition and disclosure of provisions and contingencies.',
        evidence: 'Lawyer letters; case list; board minutes; provision workings.',
        assertions: ['completeness', 'valuation', 'presentation_and_disclosure'],
      },
    ],
  },
  {
    match: /related part/,
    items: [
      {
        key: 'rpt',
        title: 'Related-party transactions and disclosure',
        objective:
          'Compare the related-party list with the group master and registers, test approvals and arm’s-length terms, and check the disclosures.',
        evidence: 'RPT register; Section 188 approvals; board / audit-committee minutes.',
        assertions: ['completeness', 'presentation_and_disclosure'],
      },
    ],
  },
];

/** The standard programme for each framework workstream (§20). */
const WORKSTREAM_TEMPLATES: Record<string, Template[]> = {
  // CARO, IFC and CFS have no standard programme here: the 02.4 clause
  // programme supplies one procedure per clause (spec §18) through
  // `caroClauses`, the 02.5 ICFR workstream one per in-scope process area
  // through `icfrProcedures`, and the 02.6 consolidation work programme one
  // per applicable item (02.6 spec §19) through `consolidationProcedures`.
  ind_as_review: [
    {
      key: 'disclosure',
      title: 'Ind AS disclosure checklist',
      objective:
        'Complete the Ind AS presentation and disclosure checklist and review significant judgements and estimates.',
      evidence: 'Completed disclosure checklist; note references.',
      assertions: ['presentation_and_disclosure'],
    },
  ],
  // 02.2 §17/§19: activated only by a first-time Ind AS conclusion.
  ind_as_first_time_adoption: [
    {
      key: 'opening_balance_sheet',
      title: 'Opening Ind AS balance sheet at the date of transition (Ind AS 101)',
      objective:
        'Agree the opening Ind AS balance sheet to the previous-GAAP closing balances and test the transition adjustments: recognition and derecognition, reclassification and measurement under Ind AS.',
      evidence: 'Transition-date balance sheet; adjustment schedule with computations.',
      assertions: ['existence', 'completeness', 'accuracy', 'classification'],
    },
    {
      key: 'exemptions_exceptions',
      title: 'Ind AS 101 exceptions and optional exemptions applied',
      objective:
        'Confirm the mandatory exceptions were applied and that each optional exemption elected (deemed cost, business combinations, cumulative translation differences …) is permitted and consistently applied.',
      evidence: 'Management’s schedule of exemptions elected; supporting computations.',
      assertions: ['accuracy', 'presentation_and_disclosure'],
    },
    {
      key: 'reconciliations',
      title: 'Previous-GAAP reconciliations and first Ind AS disclosures',
      objective:
        'Check the reconciliations of equity and total comprehensive income from previous GAAP to Ind AS and the other first-time adoption disclosures required by Ind AS 101.',
      evidence: 'Equity and total comprehensive income reconciliations; disclosure checklist.',
      assertions: ['presentation_and_disclosure'],
    },
  ],
  schedule_iii_work: [
    {
      key: 'presentation',
      title: 'Schedule III presentation and AS compliance',
      objective:
        'Check the financial statements against Schedule III requirements and the applicable Accounting Standards.',
      evidence: 'Schedule III checklist; AS compliance checklist.',
      assertions: ['presentation_and_disclosure', 'classification'],
    },
  ],
  internal_audit_reliance: [
    {
      key: 'sa610',
      title: 'Evaluate the internal audit function (SA 610)',
      objective:
        'Assess the objectivity and competence of internal audit, read its reports, and decide the extent of use of its work.',
      evidence: 'Internal audit reports; evaluation memo.',
      assertions: [],
    },
  ],
  auditor_reporting: [
    {
      key: 'report',
      title: 'Draft auditor’s report — Section 143(3) and Rule 11 matters',
      objective:
        'Prepare the auditor’s report with the Section 143(3) matters and Rule 11 clauses, consistent with the work performed.',
      evidence:
        'Draft report; Rule 11 working (audit trail, funding, dividends, pending litigation).',
      assertions: [],
    },
  ],
  [OVERALL_WORK_AREA_KEY]: [
    {
      key: 'final_analytics',
      title: 'Final analytical review (SA 520)',
      objective:
        'Perform analytical procedures near the end of the audit to confirm the financial statements are consistent with our understanding.',
      evidence: 'Final analytics with explanations for significant movements.',
      assertions: [],
    },
    {
      key: 'subsequent_events',
      title: 'Subsequent events review (SA 560)',
      objective:
        'Identify events between the period end and the report date that require adjustment or disclosure.',
      evidence: 'Post-period minutes, management accounts and enquiries.',
      assertions: ['completeness', 'presentation_and_disclosure'],
    },
  ],
};

export function suggestProcedures(input: {
  areaKeys: ReadonlySet<string>;
  fsAreas: readonly FsAreaInput[];
  risks: readonly RiskInput[];
  /**
   * The SMC exemptions/relaxations an approved 02.2 AS + SMC conclusion
   * activated (02.2 §19) — the AS review marks these items. Empty otherwise.
   */
  smcRelaxations?: readonly SmcRelaxation[];
  /**
   * The 02.4 CARO clause programme (spec §18): one procedure per live clause
   * item in the CARO work area, replacing a generic CARO programme.
   */
  caroClauses?: readonly PlannedClauseProcedure[];
  /**
   * The 02.5 ICFR workstream (spec §13): one procedure per step of each
   * in-scope process area plus the deficiency evaluation, in the IFC work
   * area — never the generic IFC programme.
   */
  icfrProcedures?: readonly PlannedIcfrProcedure[];
  /**
   * The 02.6 consolidation work programme (spec §19): one procedure per
   * applicable item in the CFS work area — never the generic CFS programme.
   */
  consolidationProcedures?: readonly PlannedConsolidationProcedure[];
  /**
   * The 02.7 reporting cards (spec §17): one procedure per card with a
   * reporting obligation in the auditor's-reporting work area — replacing the
   * single generic report procedure once 02.7 has run.
   */
  reportingProcedures?: readonly PlannedReportingProcedure[];
}): SuggestedProcedure[] {
  const out: SuggestedProcedure[] = [];
  const has = (k: string) => input.areaKeys.has(k);

  // Risk responses — in the risk's area, else overall responses.
  for (const r of input.risks) {
    if (r.status === 'concluded') continue;
    const area = areaForRisk(r, input.fsAreas);
    const workAreaKey = area ? fsWorkAreaKey(area) : OVERALL_WORK_AREA_KEY;
    if (!has(workAreaKey)) continue;
    out.push({
      sourceKey: `risk:${r.id}`,
      sourceNote: `Section 04 risk ${r.ref}${r.isSignificant ? ' (significant)' : ''}`,
      workAreaKey,
      title: clip(`Respond to ${r.ref}: ${r.description.trim()}`, 160),
      objective:
        r.response?.trim() ||
        `Design and perform further procedures responsive to ${r.ref} (SA 330)${r.isSignificant ? ', including tests of details for this significant risk (SA 330.21)' : ''}.`,
      assertions: r.assertion ? [r.assertion] : area ? procedureAssertions(area.assertions) : [],
      riskId: r.id,
      expectedEvidence: null,
    });
  }

  // Substantive programme for each 03.5 area.
  for (const a of input.fsAreas) {
    const key = fsWorkAreaKey(a);
    if (!has(key)) continue;
    const assertions = procedureAssertions(a.assertions);
    out.push({
      sourceKey: `fs:${key}:substantive`,
      sourceNote: `03.5 audit area${a.attention === 'enhanced' ? ' (Enhanced attention)' : ''}`,
      workAreaKey: key,
      title: `Substantive procedures — ${a.name}`,
      objective: `Obtain sufficient appropriate evidence over ${a.name}${
        assertions.length ? ` for ${assertions.map((x) => x.replace(/_/g, ' ')).join(', ')}` : ''
      }: agree the lead schedule to the trial balance, analyse movements against last year and test details on a sample.`,
      assertions,
      riskId: null,
      expectedEvidence: 'Lead schedule agreed to the trial balance; analytics; sample testing.',
    });
    const name = a.name.toLowerCase();
    for (const group of FS_TEMPLATES) {
      if (!group.match.test(name)) continue;
      for (const t of group.items) {
        out.push({
          sourceKey: `fs:${key}:${t.key}`,
          sourceNote: '03.5 audit area — standard procedure',
          workAreaKey: key,
          title: t.title,
          objective: t.objective,
          assertions: t.assertions,
          riskId: null,
          expectedEvidence: t.evidence,
        });
      }
    }
  }

  // Standard programme for the framework workstreams and overall responses
  // (an overall step is skipped when 03.5 has an area of its own for it).
  const fsNames = input.fsAreas.map((a) => a.name.toLowerCase()).join(' | ');
  for (const [areaKey, items] of Object.entries(WORKSTREAM_TEMPLATES)) {
    if (!has(areaKey)) continue;
    // 02.7 supplies the auditor's-reporting programme card by card.
    if (areaKey === REPORTING_WORK_AREA_KEY && (input.reportingProcedures ?? []).length > 0)
      continue;
    for (const t of items) {
      if (
        areaKey === OVERALL_WORK_AREA_KEY &&
        t.key === 'subsequent_events' &&
        /subsequent/.test(fsNames)
      )
        continue;
      if (
        areaKey === OVERALL_WORK_AREA_KEY &&
        t.key === 'final_analytics' &&
        /analytic/.test(fsNames)
      )
        continue;
      out.push({
        sourceKey: `std:${areaKey}:${t.key}`,
        sourceNote:
          areaKey === OVERALL_WORK_AREA_KEY
            ? 'Standard completion procedure'
            : 'Standard workstream procedure',
        workAreaKey: areaKey,
        title: t.title,
        objective: t.objective,
        assertions: t.assertions,
        riskId: null,
        expectedEvidence: t.evidence,
      });
    }
  }
  if (has(CARO_WORK_AREA_KEY)) {
    for (const c of input.caroClauses ?? []) {
      out.push({
        sourceKey: c.sourceKey,
        sourceNote: c.sourceNote,
        workAreaKey: CARO_WORK_AREA_KEY,
        title: c.title,
        objective: c.objective,
        assertions: [],
        riskId: null,
        expectedEvidence: c.expectedEvidence,
      });
    }
  }
  if (has(ICFR_WORK_AREA_KEY)) {
    for (const p of input.icfrProcedures ?? []) {
      out.push({
        sourceKey: p.sourceKey,
        sourceNote: p.sourceNote,
        workAreaKey: ICFR_WORK_AREA_KEY,
        title: p.title,
        objective: p.objective,
        assertions: [],
        riskId: null,
        expectedEvidence: p.expectedEvidence,
      });
    }
  }
  if (has(REPORTING_WORK_AREA_KEY)) {
    for (const p of input.reportingProcedures ?? []) {
      out.push({
        sourceKey: p.sourceKey,
        sourceNote: p.sourceNote,
        workAreaKey: REPORTING_WORK_AREA_KEY,
        title: p.title,
        objective: p.objective,
        assertions: [],
        riskId: null,
        expectedEvidence: p.expectedEvidence,
      });
    }
  }
  if (has(CONSOLIDATION_WORK_AREA_KEY)) {
    for (const p of input.consolidationProcedures ?? []) {
      out.push({
        sourceKey: p.sourceKey,
        sourceNote: p.sourceNote,
        workAreaKey: CONSOLIDATION_WORK_AREA_KEY,
        title: p.title,
        objective: p.objective,
        assertions: [],
        riskId: null,
        expectedEvidence: p.expectedEvidence,
      });
    }
  }
  // AS + SMC (02.2 §19): the AS compliance review applies the SMC
  // exemptions/relaxations — the exempt items are listed on the procedure.
  const smc = input.smcRelaxations ?? [];
  if (smc.length > 0 && has('schedule_iii_work')) {
    out.push({
      sourceKey: 'std:schedule_iii_work:smc_relaxations',
      sourceNote: '02.2 — AS applies and the company is an SMC',
      workAreaKey: 'schedule_iii_work',
      title: 'Apply the SMC exemptions and relaxations in the AS compliance review',
      objective: clip(
        `Mark these items as exempt or relaxed on the AS compliance checklist and check that the financial statements disclose the SMC status: ${smc
          .map(
            (r) =>
              `${r.standardLabel}${r.paragraphs ? ` (paras ${r.paragraphs})` : ''} — ${r.relaxation}`,
          )
          .join(' ')}`,
        4000,
      ),
      assertions: ['presentation_and_disclosure'],
      riskId: null,
      expectedEvidence: 'AS compliance checklist with the SMC items marked; SMC status note.',
    });
  }
  return out;
}

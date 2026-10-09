import { TEMPLATE_MERGE_FIELDS } from '@hsdg/contracts';
import { caroMergeValues, type CaroMemoInput } from './caro-memo-values';

const base: CaroMemoInput = {
  systemOutcome: 'applicable',
  systemBasis: 'Private company — total revenue exceeds the configured limit.',
  conclusion: 'applicable',
  basis: null,
  isOverridden: false,
  technicalBasis: null,
  supportingEvidence: null,
  decidedByName: 'Asha Manager',
  decidedAt: '2025-05-02T10:00:00.000Z',
  professionalAction: null,
  pendingReason: null,
  partnerApprovedByName: null,
  partnerApprovedAt: null,
  exemptionReason: null,
  summary: {
    result: 'applicable',
    entityRoute: 'private_company',
    directExemption: null,
    privateExemption: 'not_qualified',
    failedConditions: ['revenue'],
    failedCondition: 'Total revenue',
    actualValue: 'INR 14.82 crore',
    configuredLimit: 'INR 10 crore',
    orderVersion: 'CARO 2020 (effective 2021-04-01)',
  },
  programme: {
    orderTitle: "Companies (Auditor's Report) Order, 2020",
    orderVersionLabel: 'CARO 2020 — applicable from FY 2021-22',
    periodStart: '2024-04-01',
    status: 'active',
  },
  clauses: [
    {
      clauseRef: '3(i)(b)',
      title: 'Physical verification',
      reportContext: 'standalone',
      relevance: 'applicable',
      conclusion: 'reportable_matter',
      reviewState: 'approved',
    },
    {
      clauseRef: '3(xii)',
      title: 'Nidhi company',
      reportContext: 'standalone',
      relevance: 'not_applicable_to_facts',
      conclusion: 'not_applicable_to_facts',
      reviewState: 'open',
    },
  ],
};

describe('CARO Applicability Memo merge values (02.4 §16)', () => {
  it('fills only known merge fields', () => {
    const known = new Set(TEMPLATE_MERGE_FIELDS.map((f) => f.key));
    for (const k of Object.keys(caroMergeValues(base))) expect(known.has(k)).toBe(true);
  });

  it('merges the conclusion, scope and clause programme', () => {
    const v = caroMergeValues(base);
    expect(v).toMatchObject({
      'caro.applicability': 'CARO Applicable',
      'caro.exemptionBasis': 'None',
      'caro.entityRoute': 'Private company',
      'caro.directExemption': 'None',
      'caro.privateExemption': 'Not qualified',
      'caro.failedCondition':
        'Total revenue — actual INR 14.82 crore — configured limit INR 10 crore',
      'caro.orderVersion':
        "Companies (Auditor's Report) Order, 2020 — CARO 2020 — applicable from FY 2021-22",
      'caro.standaloneScope':
        'Paragraph 3 clause programme — 2 clause items (1 not applicable to facts)',
      'caro.consolidatedScope': 'Not required — no consolidated CARO reporting',
      'caro.clauseProgress': '1 of 2 clause conclusions approved',
      'caro.reportableClauses': '3(i)(b) Physical verification',
      'caro.overridden': 'No',
      'caro.decidedAt': '2 May 2025',
    });
  });

  it('an override keeps its reason, technical basis and the partner trail', () => {
    const v = caroMergeValues({
      ...base,
      conclusion: 'not_applicable_exempt',
      isOverridden: true,
      basis: 'Borrowings peak data shows the limit was never exceeded.',
      technicalBasis: 'ICAI Guidance Note on CARO 2020.',
      programme: null,
      clauses: [],
    });
    expect(v['caro.applicability']).toBe('CARO Not Applicable - Exempt');
    expect(v['caro.systemConclusion']).toBe('CARO Applicable');
    expect(v['caro.partnerApproval']).toBe('Pending — Engagement Partner approval required');
    expect(v['caro.standaloneScope']).toBe('No paragraph 3 clause programme — CARO does not apply');
    expect(v['caro.technicalBasis']).toBe('ICAI Guidance Note on CARO 2020.');
  });

  it('leaves blanks rather than guessing when 02.4 is not open', () => {
    expect(caroMergeValues(null)).toEqual({});
  });
});

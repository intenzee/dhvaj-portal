import { ICFR_CONTROL_REMINDER, TEMPLATE_MERGE_FIELDS } from '@hsdg/contracts';
import { icfrMergeValues, type IcfrMemoInput } from './icfr-memo-values';

const base: IcfrMemoInput = {
  systemOutcome: 'applicable',
  systemBasis: 'Private company — turnover exceeds the configured limit.',
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
    opc: 'no',
    smallCompany: 'no',
    turnover: 'INR 62 crore',
    turnoverLimit: 'INR 50 crore',
    peakBorrowings: 'INR 4 crore',
    borrowingLimit: 'INR 25 crore',
    filingCondition: 'satisfied',
    reason: 'Turnover exceeds INR 50 crore.',
    notificationVersion: 'G.S.R. 583(E) (effective 2017-06-13)',
  },
  workstream: {
    status: 'active',
    frameworkLabel: 'ICAI Guidance Note on Audit of IFC',
    inScopeAreas: ['Entity-level controls', 'Revenue'],
    conclusion: null,
  },
  deficiencies: { total: 3, materialWeaknesses: 1, significantDeficiencies: 1 },
  consolidated: null,
};

describe('ICFR Reporting Applicability Memo merge values (02.5 §20)', () => {
  it('fills only known merge fields', () => {
    const known = new Set(TEMPLATE_MERGE_FIELDS.map((f) => f.key));
    for (const k of Object.keys(icfrMergeValues(base))) expect(known.has(k)).toBe(true);
  });

  it('is empty when 02.5 is not open', () => {
    expect(icfrMergeValues(null)).toEqual({});
  });

  it('states the routes, measures and workstream of an applicable conclusion', () => {
    const v = icfrMergeValues(base);
    expect(v['icfr.applicability']).toBe('Section 143(3)(i) Reporting Applicable');
    expect(v['icfr.entityRoute']).toBe('Private company');
    expect(v['icfr.opcRoute']).toBe('Not applicable');
    expect(v['icfr.turnover']).toBe('INR 62 crore (limit INR 50 crore)');
    expect(v['icfr.filingCondition']).toBe('Satisfied');
    expect(v['icfr.systemReason']).toBe('Turnover exceeds INR 50 crore.');
    expect(v['icfr.workstream']).toBe(
      'ICAI Guidance Note on Audit of IFC configured in Section 05 — in scope: Entity-level controls, Revenue',
    );
    expect(v['icfr.deficiencies']).toBe(
      '3 recorded — 1 material weakness(es), 1 significant deficiency',
    );
    expect(v['icfr.consolidated']).toBe('Not required — no consolidated ICFR consideration');
    expect(v['icfr.controlReminder']).toBe(ICFR_CONTROL_REMINDER);
    expect(v['icfr.overridden']).toBe('No');
    expect(v['icfr.technicalBasis']).toBe('Not applicable');
    expect(v['icfr.partnerApproval']).toBe('Not required');
    expect(v['icfr.decidedBy']).toBe('Asha Manager');
    expect(v['icfr.decidedAt']).toMatch(/2025/);
  });

  it('records an override with its basis, evidence and pending partner approval', () => {
    const v = icfrMergeValues({
      ...base,
      conclusion: 'exempt',
      isOverridden: true,
      basis: 'Turnover restated after audit adjustments.',
      technicalBasis: 'Rule 11 notification — turnover per audited FS.',
      supportingEvidence: 'Restated trial balance',
      workstream: { ...base.workstream!, status: 'withdrawn' },
    });
    expect(v['icfr.applicability']).toBe('Reporting Exempt');
    expect(v['icfr.systemConclusion']).toBe('Section 143(3)(i) Reporting Applicable');
    expect(v['icfr.overridden']).toBe('Yes');
    expect(v['icfr.overrideReason']).toBe('Turnover restated after audit adjustments.');
    expect(v['icfr.technicalBasis']).toBe('Rule 11 notification — turnover per audited FS.');
    expect(v['icfr.supportingEvidence']).toBe('Restated trial balance');
    expect(v['icfr.partnerApproval']).toBe('Pending — Engagement Partner approval required');
    expect(v['icfr.workstream']).toMatch(/^Withdrawn/);
  });

  it('leaves the measures blank without an engine summary and shows pending information', () => {
    const v = icfrMergeValues({
      ...base,
      summary: null,
      conclusion: null,
      professionalAction: 'information_pending',
      pendingReason: 'Awaiting the borrowing schedule.',
      workstream: null,
      consolidated: { status: 'active', components: 2, parentConclusion: 'unmodified' },
    });
    expect(v['icfr.turnover']).toBeNull();
    expect(v['icfr.applicability']).toBe('Section 143(3)(i) Reporting Applicable');
    expect(v['icfr.professionalConclusion']).toBe('Information Pending');
    expect(v['icfr.pendingReason']).toBe('Awaiting the borrowing schedule.');
    expect(v['icfr.workstream']).toBeNull();
    expect(v['icfr.deficiencies']).toBe('Not applicable');
    expect(v['icfr.consolidated']).toBe(
      'Configured — 2 components. Conclusion: Unmodified for the group',
    );
    expect(v['icfr.decidedBy']).toBeNull();
  });
});

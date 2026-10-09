import { selectTemplateVariant, type ScheduleIiiDetail } from '@hsdg/contracts';
import { scheduleIiiMergeValues, type ScheduleIiiMemoInput } from './schedule-iii-memo-values';

const detail = (over: Partial<ScheduleIiiDetail> = {}): ScheduleIiiDetail => ({
  division: 'division_i',
  divisionProvisionCode: 'SCH_III_DIV_I',
  cashFlowRequired: false,
  cashFlowExemptionReason: 'Small company (02.1)',
  cashFlowProvisionId: null,
  requiredComponents: [],
  roundingThreshold: 1e9,
  roundingUnits: [],
  disclosures: [],
  ...over,
});
const input = (over: Partial<ScheduleIiiMemoInput> = {}): ScheduleIiiMemoInput => ({
  systemOutcome: 'division_i',
  systemBasis: 'AS company — Division I.',
  conclusion: null,
  basis: null,
  isOverridden: false,
  decidedByName: null,
  decidedAt: null,
  professionalAction: null,
  pendingReason: null,
  partnerApprovedByName: null,
  partnerApprovedAt: null,
  detail: detail(),
  facts: {},
  ...over,
});

describe('scheduleIiiMergeValues', () => {
  it('leaves everything blank without an assessment', () => {
    expect(scheduleIiiMergeValues(null)).toEqual({});
  });

  it('describes an open assessment from the system result', () => {
    const v = scheduleIiiMergeValues(input());
    expect(v['sch.presentationFramework']).toBe('Schedule III Division I');
    expect(v['sch.professionalConclusion']).toBe('Not yet concluded');
    expect(v['sch.cashFlow']).toBe('Exempt — Small company (02.1)');
    expect(v['sch.frameworkVersion']).toBeNull(); // a gap, never a guess
    expect(v['sch.partnerApproval']).toBe('Not required');
    expect(v['sch.decidedAt']).toBeNull();
  });

  it('describes an override with its technical basis and pending partner approval', () => {
    const v = scheduleIiiMergeValues(
      input({
        conclusion: 'division_ii',
        isOverridden: true,
        basis: 'Ind AS adopted voluntarily from 1 April 2024.',
        decidedByName: 'Partner A',
        decidedAt: '2025-06-30T10:00:00.000Z',
        facts: { technicalBasis: 'Rule 4(1)(i) voluntary adoption.' },
        detail: detail({
          rounding: {
            sourceLabel: 'Total income',
            sourceAmount: 5e8,
            ruleCode: 'SCH_III_ROUNDING',
            ruleVersionId: 'v2',
            effectiveFrom: '2021-04-01',
            threshold: 1e9,
            band: 'below',
            permittedUnits: ['hundreds', 'thousands', 'lakhs', 'millions'],
            systemUnit: 'lakhs',
            selectedUnit: 'thousands',
            overridden: true,
            reason: 'Client reports in thousands.',
            provisionId: null,
            basis: 'Total income below ₹100 cr.',
          },
          presentationMateriality: {
            label: 'Presentation materiality',
            ruleCode: 'SCH_III_PM',
            ruleVersionId: 'v1',
            percentOfRevenue: 1,
            floor: 100000,
            measureLabel: 'Revenue',
            measureAmount: 5e8,
            amount: 5e6,
            basis: '1% of revenue or ₹1 lakh, whichever is higher.',
            provisionId: null,
            auditMaterialityNote: 'Section 03',
          },
        }),
      }),
    );
    expect(v['sch.professionalConclusion']).toBe('Schedule III Division II');
    expect(v['sch.overridden']).toBe('Yes');
    expect(v['sch.overrideReason']).toBe('Ind AS adopted voluntarily from 1 April 2024.');
    expect(v['sch.technicalBasis']).toBe('Rule 4(1)(i) voluntary adoption.');
    expect(v['sch.partnerApproval']).toBe('Pending — Engagement Partner approval required');
    expect(v['sch.rounding']).toBe(
      'thousands (permitted: hundreds, thousands, lakhs, millions) — changed from lakhs: Client reports in thousands. Total income below ₹100 cr.',
    );
    expect(v['sch.presentationMateriality']).toBe(
      'Presentation materiality: ₹50,00,000 — 1% of revenue or ₹1 lakh, whichever is higher.',
    );
    expect(v['sch.decidedAt']).toMatch(/2025/);
  });

  it('records Information Pending with its blocking reason', () => {
    const v = scheduleIiiMergeValues(
      input({ professionalAction: 'information_pending', pendingReason: 'Awaiting RBI CoR.' }),
    );
    expect(v['sch.professionalConclusion']).toBe('Information Pending');
    expect(v['sch.pendingReason']).toBe('Awaiting RBI CoR.');
  });
});

describe('template effective version (02.3 §16)', () => {
  const variants = [
    { variantKey: 'standard', appliesWhen: {} },
    { variantKey: 'fy2026', appliesWhen: { periodFrom: '2026-04-01' } },
    {
      variantKey: 'fy2021_2025',
      appliesWhen: { periodFrom: '2021-04-01', periodTo: '2025-04-01' },
    },
  ];
  const pick = (periodStart: string | null) =>
    selectTemplateVariant(variants, {
      listed: false,
      entityTypeSlug: null,
      hasGroup: false,
      periodStart,
    })?.variantKey;

  it('selects the variant dated for the audit period', () => {
    expect(pick('2026-04-01')).toBe('fy2026');
    expect(pick('2024-04-01')).toBe('fy2021_2025');
    expect(pick('2025-04-01')).toBe('fy2021_2025');
    expect(pick('2019-04-01')).toBe('standard');
  });

  it('never applies a dated variant when the period is unknown', () => {
    expect(pick(null)).toBe('standard');
  });
});

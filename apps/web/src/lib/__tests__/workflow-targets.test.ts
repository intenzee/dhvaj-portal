import {
  PERMISSION,
  changeOnBaseline,
  measureOnTrack,
  workflowTargetLabel,
  type WorkflowTarget,
} from '@hsdg/contracts';
import {
  baselineBlocker,
  changedTargets,
  formatChange,
  targetProblem,
} from '@/components/reports/workflow-measures';

const NORTH = 'north-office';
const person = (role: 'managing_partner' | 'partner' | 'manager', manage = role !== 'manager') => ({
  officeId: NORTH,
  roles: [role],
  effectiveRole: role,
  permissions: manage
    ? [PERMISSION.reportRead, PERMISSION.workflowManage]
    : [PERMISSION.reportRead],
});
const scope = { from: '2026-09-01', to: '2026-09-30', officeId: '' };
const TODAY = '2026-10-15';

describe('measureOnTrack', () => {
  it('judges a ceiling or a floor on the value alone', () => {
    expect(measureOnTrack(2, null, { rule: 'at_most', value: 2 })).toBe(true);
    expect(measureOnTrack(2.5, null, { rule: 'at_most', value: 2 })).toBe(false);
    expect(measureOnTrack(90, null, { rule: 'at_least', value: 90 })).toBe(true);
    expect(measureOnTrack(89.9, 50, { rule: 'at_least', value: 90 })).toBe(false);
  });

  it('judges a change only against a baseline', () => {
    const cut = { rule: 'change_by', value: -30 } as const;
    expect(measureOnTrack(7, null, cut)).toBeNull();
    expect(measureOnTrack(7, 10, cut)).toBe(true);
    expect(measureOnTrack(7.1, 10, cut)).toBe(false);
    const rise = { rule: 'change_by', value: 20 } as const;
    expect(measureOnTrack(12, 10, rise)).toBe(true);
    expect(measureOnTrack(11, 10, rise)).toBe(false);
  });

  it('on a zero baseline, a cut holds at zero and a rise needs any', () => {
    expect(measureOnTrack(0, 0, { rule: 'change_by', value: -25 })).toBe(true);
    expect(measureOnTrack(1, 0, { rule: 'change_by', value: -25 })).toBe(false);
    expect(measureOnTrack(1, 0, { rule: 'change_by', value: 10 })).toBe(true);
  });

  it('has nothing to judge without a value', () => {
    expect(measureOnTrack(null, 10, { rule: 'at_most', value: 2 })).toBeNull();
  });
});

describe('changeOnBaseline and formatChange', () => {
  it('is a signed per cent to one decimal, or nothing', () => {
    expect(changeOnBaseline(7, 10)).toBe(-30);
    expect(changeOnBaseline(1, 3)).toBe(-66.7);
    expect(changeOnBaseline(5, 0)).toBeNull();
    expect(changeOnBaseline(null, 3)).toBeNull();
    expect(formatChange(-30)).toBe('−30%');
    expect(formatChange(12.5)).toBe('+12.5%');
    expect(formatChange(0)).toBe('±0%');
    expect(formatChange(null)).toBeNull();
  });
});

describe('workflowTargetLabel', () => {
  it('reads as the plan writes it', () => {
    expect(workflowTargetLabel({ rule: 'at_most', value: 2 }, 'steps')).toBe('≤ 2 steps');
    expect(workflowTargetLabel({ rule: 'at_most', value: 1 }, 'steps')).toBe('≤ 1 step');
    expect(workflowTargetLabel({ rule: 'at_least', value: 90 }, 'percent')).toBe('≥ 90%');
    expect(workflowTargetLabel({ rule: 'at_most', value: 4 }, 'hours')).toBe('≤ 4 h');
    expect(workflowTargetLabel({ rule: 'change_by', value: -30 }, 'hours')).toBe(
      '−30% on the baseline',
    );
    expect(workflowTargetLabel({ rule: 'change_by', value: 15 }, 'days')).toBe(
      '+15% on the baseline',
    );
  });
});

describe('baselineBlocker', () => {
  it('lets the managing partner baseline the firm or an office', () => {
    expect(baselineBlocker(person('managing_partner'), scope, TODAY)).toBeNull();
    expect(
      baselineBlocker(person('managing_partner'), { ...scope, officeId: 'south' }, TODAY),
    ).toBeNull();
  });

  it('keeps a partner to their own office', () => {
    expect(baselineBlocker(person('partner'), scope, TODAY)).toMatch(/their own office/);
    expect(baselineBlocker(person('partner'), { ...scope, officeId: 'south' }, TODAY)).toMatch(
      /their own office/,
    );
    expect(baselineBlocker(person('partner'), { ...scope, officeId: NORTH }, TODAY)).toBeNull();
  });

  it('refuses people without workflow.manage and windows still running', () => {
    expect(baselineBlocker(person('manager'), scope, TODAY)).toMatch(/Only the partners/);
    expect(baselineBlocker(null, scope, TODAY)).toMatch(/Only the partners/);
    expect(
      baselineBlocker(person('managing_partner'), { ...scope, to: '2026-10-16' }, TODAY),
    ).toMatch(/already measured/);
    expect(baselineBlocker(person('managing_partner'), { ...scope, to: TODAY }, TODAY)).toBeNull();
  });
});

describe('targetProblem and changedTargets', () => {
  it('mirrors the API checks', () => {
    expect(targetProblem({ rule: 'at_most', value: 0 })).toBeNull();
    expect(targetProblem({ rule: 'at_least', value: -1 })).toBe('Zero or more');
    expect(targetProblem({ rule: 'change_by', value: -100 })).toBeNull();
    expect(targetProblem({ rule: 'change_by', value: -101 })).toMatch(/−100%/);
    expect(targetProblem({ rule: 'at_most', value: NaN })).toBe('Enter a number');
  });

  it('sends only what the draft changed', () => {
    const saved: WorkflowTarget[] = [
      { key: 'steps_to_first_action', rule: 'at_most', value: 2 },
      { key: 'review_wait', rule: 'change_by', value: -30 },
      { key: 'unread_per_user', rule: 'at_most', value: 10 },
    ];
    expect(
      changedTargets(saved, {
        steps_to_first_action: { rule: 'at_most', value: 2 },
        review_wait: { rule: 'change_by', value: -40 },
        unread_per_user: { rule: 'at_least', value: 10 },
      }),
    ).toEqual([
      { key: 'review_wait', rule: 'change_by', value: -40 },
      { key: 'unread_per_user', rule: 'at_least', value: 10 },
    ]);
    expect(changedTargets(saved, {})).toEqual([]);
  });
});

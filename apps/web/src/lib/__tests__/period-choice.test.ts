import type { TreeItem, TreePeriod } from '@hsdg/contracts';
import { defaultPeriodKey } from '../period-choice';
import { rememberedHref, rememberPlace } from '../last-place';

const item = (over: Partial<TreeItem> = {}): TreeItem => ({
  instanceId: 'i',
  ruleCode: 'GSTR1',
  label: 'GSTR-1',
  section: 'outward',
  dueDate: '2026-10-11',
  workflowStatus: 'not_started',
  filedOn: null,
  isLate: false,
  isOverdue: false,
  isProvisional: false,
  verify: false,
  requiredDone: 0,
  requiredTotal: 0,
  mine: false,
  ...over,
});
const month = (periodKey: string, items: TreeItem[] = []): TreePeriod => ({
  periodKey,
  label: periodKey,
  quarter: null,
  sections: { outward: items },
  items: [],
  nextAction: null,
});
const filed = item({ workflowStatus: 'filed' });

/** A GST year: Apr–Jun filed, Jul open, Aug open and mine, Sep open. */
const tree = [
  month('2026-04', [filed]),
  month('2026-05', [filed]),
  month('2026-06', [filed]),
  month('2026-07', [item()]),
  month('2026-08', [item({ mine: true })]),
  month('2026-09', [item()]),
  month('2026-10'),
];

describe('defaultPeriodKey (WF-203)', () => {
  it('opens the earliest period with an open item of mine', () => {
    expect(defaultPeriodKey(tree, '2026-10-14')).toBe('2026-08');
  });

  it('a filed item of mine does not count', () => {
    const t = tree.map((p) =>
      p.periodKey === '2026-08'
        ? month('2026-08', [item({ mine: true, workflowStatus: 'filed' })])
        : p,
    );
    expect(defaultPeriodKey(t, '2026-10-14')).toBe('2026-07');
  });

  it('with nothing of mine, the earliest open period', () => {
    const t = tree.map((p) => (p.periodKey === '2026-08' ? month('2026-08', [item()]) : p));
    expect(defaultPeriodKey(t, '2026-10-14')).toBe('2026-07');
  });

  it('with everything filed, the current month, else the current quarter, else none', () => {
    const allFiled = tree.map((p) => month(p.periodKey, [filed]));
    expect(defaultPeriodKey(allFiled, '2026-10-14')).toBe('2026-10');
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'].map((q) => ({
      ...month(`2026-27:${q}`, [filed]),
      sections: {},
      items: [filed],
    }));
    expect(defaultPeriodKey(quarters, '2026-10-14')).toBe('2026-27:Q3');
    expect(defaultPeriodKey(quarters, '2027-02-01')).toBe('2026-27:Q4');
    expect(defaultPeriodKey([], '2026-10-14')).toBeNull();
  });

  it('items with no section (TDS / IT / ROC) count too', () => {
    const p = { ...month('2026-27:Q2'), sections: {}, items: [item({ mine: true })] };
    expect(defaultPeriodKey([month('2026-27:Q1', [filed]), p], '2026-10-14')).toBe('2026-27:Q2');
  });
});

describe('last place', () => {
  beforeEach(() => window.localStorage.clear());

  it('remembers the tab and period, and nothing else', () => {
    rememberPlace('e1', '?tab=gst&fy=2026-27&gstin=19AAA&m=8&open=i1&task=t1');
    expect(rememberedHref('e1')).toBe('/engagements/e1?tab=gst&fy=2026-27&gstin=19AAA&m=8');
    expect(rememberedHref('e2')).toBeNull();
  });

  it('survives blocked storage', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberPlace('e1', '?tab=gst&m=8')).not.toThrow();
    expect(rememberedHref('e1')).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});
